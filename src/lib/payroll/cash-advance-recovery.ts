import {
  collection,
  deleteField,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type { CashAdvanceRequest, CashAdvanceStatus, PayrollLineD8Snapshot } from '@/lib/types';

/** คีย์ใน `PayrollBatchLine.deductionsBreakdown` — หักคืนเบิกล่วงหน้า */
export const CASH_ADVANCE_PAYROLL_DEDUCTION_KEY = 'cash_advance_recovery';

/** คำขอที่ฝ่ายบัญชีทำจ่ายแล้วและยังไม่ผูกหักใน payroll batch */
export const CASH_ADVANCE_STATUSES_ELIGIBLE_FOR_SALARY_RECOVERY: CashAdvanceStatus[] = [
  'PAID_PETTY_CASH',
  'PAID_OTHER',
];

export type CashAdvanceRecoveryRow = {
  id: string;
  requestNo: string;
  amountBaht: number;
};

function round2Payroll(n: number): number {
  return Math.round(n * 100) / 100;
}

function isCashAdvancePaidForRecovery(r: CashAdvanceRequest): boolean {
  return (
    (typeof r.paidAt === 'number' && r.paidAt > 0) ||
    !!(r.cashbookEntryId || r.pettyCashEntryId || r.paymentBankAccountId || r.pettyCashBankAccountId)
  );
}

function isRecoveryBatchEligible(
  r: CashAdvanceRequest,
  payrollRecoveryBatchId?: string | null,
): boolean {
  if (!r.payrollRecoveryBatchId) return true;
  if (payrollRecoveryBatchId && r.payrollRecoveryBatchId === payrollRecoveryBatchId) return true;
  return false;
}

/**
 * เดือนที่ใช้หักคืนเงินเดือน = เดือนที่จ่ายเงินเบิก (Petty/โอน) ตามเวลาไทย
 * ยังไม่จ่าย → ใช้วันที่สร้างเอกสาร
 */
export function cashAdvanceDocumentYearMonth(r: Pick<CashAdvanceRequest, 'createdAt' | 'paidAt'>): string | null {
  const fromPaid = bangkokYearMonthFromMs(Number(r.paidAt));
  if (fromPaid) return fromPaid;
  return bangkokYearMonthFromMs(Number(r.createdAt));
}

function bangkokYearMonthFromMs(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const ym = new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 7);
  return /^\d{4}-\d{2}$/.test(ym) ? ym : null;
}

/**
 * หักคืนในงวดเงินเดือนเดือนที่จ่ายเงินเบิก (หรือเดือนก่อนหน้าที่ยังไม่หัก)
 * จ่าย พ.ย. ห้ามไปหักงวด ต.ค. — รอหักในงวด พ.ย.
 */
export function cashAdvanceEligibleForPayrollMonth(
  r: Pick<CashAdvanceRequest, 'createdAt' | 'paidAt'>,
  payrollYearMonth: string | null | undefined,
): boolean {
  const payrollYm = String(payrollYearMonth || '').trim().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(payrollYm)) return false;
  const advanceYm = cashAdvanceDocumentYearMonth(r);
  if (!advanceYm) return false;
  return advanceYm <= payrollYm;
}

function collectEligibleCashAdvanceRows(
  docs: Array<{ id: string; data: () => object }>,
  filter: (r: CashAdvanceRequest) => boolean,
  payrollYearMonth: string | null | undefined,
  payrollRecoveryBatchId?: string | null,
): CashAdvanceRecoveryRow[] {
  const eligible = new Set(CASH_ADVANCE_STATUSES_ELIGIBLE_FOR_SALARY_RECOVERY);
  const advances: CashAdvanceRecoveryRow[] = [];
  for (const d of docs) {
    const r = { id: d.id, ...(d.data() as object) } as CashAdvanceRequest;
    if (!filter(r)) continue;
    if (!eligible.has(r.status)) continue;
    if (!isRecoveryBatchEligible(r, payrollRecoveryBatchId)) continue;
    if (!isCashAdvancePaidForRecovery(r)) continue;
    if (!cashAdvanceEligibleForPayrollMonth(r, payrollYearMonth)) continue;
    const amt = Math.max(0, Number(r.amountBaht) || 0);
    if (amt <= 0) continue;
    advances.push({ id: r.id, requestNo: r.requestNo || r.id, amountBaht: amt });
  }
  return advances;
}

/**
 * ดึงคำขอเบิกล่วงหน้าของลูกจ้างที่ต้องหักจากเงินเดือนในงวดจ่าย (ยังไม่มี payrollRecoveryBatchId)
 */
export async function fetchWorkerCashAdvancesPendingSalaryRecovery(
  db: Firestore,
  workerId: string,
  payrollYearMonth: string | null | undefined,
  payrollRecoveryBatchId?: string | null,
): Promise<{ total: number; advances: CashAdvanceRecoveryRow[] }> {
  const snap = await getDocs(
    query(collection(db, 'cash_advance_requests'), where('workerId', '==', workerId)),
  );
  const advances = collectEligibleCashAdvanceRows(
    snap.docs,
    (r) => r.subjectType === 'worker',
    payrollYearMonth,
    payrollRecoveryBatchId,
  );
  const total = round2Payroll(advances.reduce((s, a) => s + a.amountBaht, 0));
  return { total, advances };
}

/** ดึงเบิกล่วงหน้าของหลายคนพร้อมกัน — ไม่วนรอรายคนตอน generate batch */
export async function fetchWorkerCashAdvancesPendingSalaryRecoveryForWorkers(
  db: Firestore,
  workerIds: readonly string[],
  payrollYearMonth: string | null | undefined,
  payrollRecoveryBatchId?: string | null,
): Promise<Map<string, { total: number; advances: CashAdvanceRecoveryRow[] }>> {
  const ids = [...new Set(workerIds.map((id) => String(id || '').trim()).filter(Boolean))];
  const out = new Map<string, { total: number; advances: CashAdvanceRecoveryRow[] }>();
  await Promise.all(
    ids.map(async (workerId) => {
      out.set(
        workerId,
        await fetchWorkerCashAdvancesPendingSalaryRecovery(db, workerId, payrollYearMonth, payrollRecoveryBatchId),
      );
    }),
  );
  return out;
}

/**
 * ดึงคำขอเบิกล่วงหน้าของพนักงานออฟฟิศที่ต้องหักจากเงินเดือนในงวด office payroll
 * @param payrollRecoveryBatchId — ส่ง runId เมื่อคำนวณใหม่/แก้รายคน เพื่อรวมรายการที่ผูกกับงวดนี้แล้ว
 */
export async function fetchOfficeStaffCashAdvancesPendingSalaryRecovery(
  db: Firestore,
  officeStaffId: string,
  payrollYearMonth: string | null | undefined,
  payrollRecoveryBatchId?: string | null,
): Promise<{ total: number; advances: CashAdvanceRecoveryRow[] }> {
  const snap = await getDocs(
    query(collection(db, 'cash_advance_requests'), where('officeStaffId', '==', officeStaffId)),
  );
  const advances = collectEligibleCashAdvanceRows(
    snap.docs,
    (r) => r.subjectType !== 'worker' && r.officeStaffId === officeStaffId,
    payrollYearMonth,
    payrollRecoveryBatchId,
  );
  const total = round2Payroll(advances.reduce((s, a) => s + a.amountBaht, 0));
  return { total, advances };
}

export type OfficePayrollD8LineResult = {
  grossPay: number;
  tax: number;
  socialSecurity: number;
  deductions: number;
  netPay: number;
  snapshot: PayrollLineD8Snapshot;
};

/** หักคืนเบิกล่วงหน้าหลัง D8 — ไม่กระทบฐานภาษี/ประกันสังคม (เหมือนลูกจ้าง) */
export function applyCashAdvanceRecoveryToOfficeD8Line(
  d8: OfficePayrollD8LineResult,
  recovery: { total: number; advances: CashAdvanceRecoveryRow[] },
): {
  deductions: number;
  netPay: number;
  snapshot: PayrollLineD8Snapshot;
  advanceIds: string[];
} {
  if (recovery.total <= 0) {
    return {
      deductions: d8.deductions,
      netPay: d8.netPay,
      snapshot: d8.snapshot,
      advanceIds: [],
    };
  }
  const recoveryAmt = round2Payroll(recovery.total);
  const netPay = round2Payroll(d8.netPay - recoveryAmt);
  return {
    deductions: round2Payroll(d8.deductions + recoveryAmt),
    netPay,
    snapshot: {
      ...d8.snapshot,
      deductions: {
        ...d8.snapshot.deductions,
        [CASH_ADVANCE_PAYROLL_DEDUCTION_KEY]: recoveryAmt,
      },
      net: netPay,
    },
    advanceIds: recovery.advances.map((a) => a.id),
  };
}

/** คืนสถานะคำขอเบิกล่วงหน้าเมื่อลบ/คำนวณใหม่ payroll batch หรือ office payroll run */
export async function clearCashAdvanceRecoveriesForPayrollBatch(
  db: Firestore,
  batchId: string,
): Promise<void> {
  const snap = await getDocs(
    query(collection(db, 'cash_advance_requests'), where('payrollRecoveryBatchId', '==', batchId)),
  );
  if (snap.empty) return;
  let wb = writeBatch(db);
  let n = 0;
  for (const d of snap.docs) {
    wb.update(d.ref, { payrollRecoveryBatchId: deleteField(), updatedAt: Date.now() });
    n++;
    if (n >= 400) {
      await wb.commit();
      wb = writeBatch(db);
      n = 0;
    }
  }
  if (n > 0) await wb.commit();
}

/** ผูกคำขอเบิกกับงวด payroll ที่หักคืนแล้ว */
export async function linkCashAdvancesToPayrollRecoveryBatch(
  db: Firestore,
  batchId: string,
  advanceIds: string[],
): Promise<void> {
  const unique = [...new Set(advanceIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (unique.length === 0) return;
  const now = Date.now();
  let wb = writeBatch(db);
  let n = 0;
  for (const advId of unique) {
    wb.update(doc(db, 'cash_advance_requests', advId), {
      payrollRecoveryBatchId: batchId,
      updatedAt: now,
    });
    n++;
    if (n >= 400) {
      await wb.commit();
      wb = writeBatch(db);
      n = 0;
    }
  }
  if (n > 0) await wb.commit();
}

/**
 * คำนวณใหม่รายคน — ผูกเบิกที่หักในงวดนี้ และปลดเบิกเดือนถัดไปที่เคยถูกผูกผิด
 */
export async function syncWorkerCashAdvancesForPayrollBatch(
  db: Firestore,
  batchId: string,
  workerId: string,
  nextAdvanceIds: string[],
): Promise<void> {
  const keep = new Set(nextAdvanceIds.map((id) => String(id || '').trim()).filter(Boolean));
  const snap = await getDocs(
    query(collection(db, 'cash_advance_requests'), where('workerId', '==', workerId)),
  );
  const now = Date.now();
  let wb = writeBatch(db);
  let n = 0;
  for (const d of snap.docs) {
    const r = d.data() as CashAdvanceRequest;
    if (r.payrollRecoveryBatchId !== batchId) continue;
    if (keep.has(d.id)) continue;
    wb.update(d.ref, { payrollRecoveryBatchId: deleteField(), updatedAt: now });
    n++;
    if (n >= 400) {
      await wb.commit();
      wb = writeBatch(db);
      n = 0;
    }
  }
  if (n > 0) await wb.commit();
  await linkCashAdvancesToPayrollRecoveryBatch(db, batchId, [...keep]);
}
