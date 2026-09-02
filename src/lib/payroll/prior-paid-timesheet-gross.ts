/**
 * ยอดรายวันที่จ่ายไปแล้วในงวด NORMAL อื่นของ period เดียวกัน
 * — ใช้ตอน generate/recalc เต็มเดือน: วัน LOCKED ที่จ่ายแล้วต้องคงยอดเดิม
 *   ไม่คำนวณซ้ำด้วยอัตราทะเบียน/สัญญาปัจจุบัน
 */
import { collection, doc, getDoc, getDocs, query, where, type Firestore } from 'firebase/firestore';
import type {
  PayrollBatch,
  PayrollBatchLine,
  PayrollBatchLineDailyRowSnapshot,
  PriorPeriodAllowanceItem,
} from '@/lib/types';
import { payrollBatchChronologyMs } from '@/lib/payroll/payslip-model';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type PriorPaidFrozenPayrollSlice = {
  /** timesheetId → ยอดที่จ่ายแล้ว */
  byTimesheetId: Record<string, number>;
  /** yyyy-MM-dd → ยอด (เมื่อไม่มี timesheetGrossById บนงวดเก่า) */
  byDate: Record<string, number>;
  /** ใบงานที่อยู่ใน sourceTimesheetIds ของงวดที่จ่ายแล้ว */
  lockedSourceTimesheetIds: Set<string>;
  /** ฐานแพ็กที่ใช่ตอนจ่าย (ถ้ามี snapshot) — ใช้คำนวณซ้ำเมื่อไม่มียอดรายวัน */
  frozenPackageBaseRate: number | null;
  frozenWorkMode: 'onshore' | 'offshore' | null;
  /** OT ตกเบิก / รายได้ย้อนหลังที่รวมในงวดที่จ่ายแล้ว */
  priorPeriodAllowanceItems: PriorPeriodAllowanceItem[];
  /** สรุปงวดที่จ่ายแล้ว (สำหรับ UI) */
  priorPaidSummaries: Array<{
    batchId: string;
    paymentLabel: string;
    netAmount: number;
    grossAmount: number;
    dailyRows: PayrollBatchLineDailyRowSnapshot[];
    priorPeriodAllowanceItems: PriorPeriodAllowanceItem[];
  }>;
};

function emptySlice(): PriorPaidFrozenPayrollSlice {
  return {
    byTimesheetId: {},
    byDate: {},
    lockedSourceTimesheetIds: new Set(),
    frozenPackageBaseRate: null,
    frozenWorkMode: null,
    priorPeriodAllowanceItems: [],
    priorPaidSummaries: [],
  };
}

function mergeFrozenFromLine(
  slice: PriorPaidFrozenPayrollSlice,
  line: PayrollBatchLine,
): void {
  const byId = line.timesheetGrossById;
  if (byId && typeof byId === 'object') {
    for (const [tid, raw] of Object.entries(byId)) {
      const id = String(tid || '').trim();
      const n = Number(raw);
      if (!id || !Number.isFinite(n) || n <= 0) continue;
      slice.byTimesheetId[id] = round2(n);
    }
  }

  const rows = line.dailyRowSnapshots as PayrollBatchLineDailyRowSnapshot[] | undefined;
  if (Array.isArray(rows)) {
    for (const row of rows) {
      const id = String(row?.timesheetId || '').trim();
      const ymd = String(row?.date || '').slice(0, 10);
      const n = Number(row?.amount);
      if (!Number.isFinite(n) || n <= 0) continue;
      if (id && slice.byTimesheetId[id] == null) slice.byTimesheetId[id] = round2(n);
      if (/^\d{4}-\d{2}-\d{2}$/.test(ymd) && slice.byDate[ymd] == null) {
        slice.byDate[ymd] = round2(n);
      }
    }
  }

  for (const tid of line.sourceTimesheetIds ?? []) {
    const id = String(tid || '').trim();
    if (id) slice.lockedSourceTimesheetIds.add(id);
  }

  const snapRate = Number(line.laborCostResolutionSnapshot?.effectiveBaseRate);
  if (Number.isFinite(snapRate) && snapRate > 0 && slice.frozenPackageBaseRate == null) {
    slice.frozenPackageBaseRate = snapRate;
    const wm = line.laborCostResolutionSnapshot?.workMode;
    slice.frozenWorkMode = wm === 'onshore' || wm === 'offshore' ? wm : null;
  }

  for (const it of line.hrLineAdjustments?.priorPeriodAllowanceItems ?? []) {
    const amount = Math.max(0, Number(it.amount) || 0);
    if (amount <= 0) continue;
    slice.priorPeriodAllowanceItems.push({
      sourceYearMonth: String(it.sourceYearMonth || '').trim(),
      label: String(it.label || '').trim(),
      amount,
    });
  }
}

/**
 * รวมยอดรายวัน + รายละเอียดตกเบิก จากงวด NORMAL ที่ PAID/LOCKED ก่อน currentBatch
 */
export async function loadPriorPaidFrozenPayrollSlice(
  db: Firestore,
  input: {
    payrollPeriodId: string;
    workerId: string;
    currentBatchId?: string | null;
    currentBatchChronologyMs?: number;
  },
): Promise<PriorPaidFrozenPayrollSlice> {
  const periodId = String(input.payrollPeriodId || '').trim();
  const workerId = String(input.workerId || '').trim();
  if (!periodId || !workerId) return emptySlice();

  const currentId = String(input.currentBatchId || '').trim();
  const currentMs = Number(input.currentBatchChronologyMs) || 0;

  const batchSnaps = await getDocs(
    query(collection(db, 'payroll_batches'), where('payrollPeriodId', '==', periodId)),
  );

  const slice = emptySlice();
  for (const bd of batchSnaps.docs) {
    if (currentId && bd.id === currentId) continue;
    const nb = { ...(bd.data() as PayrollBatch), id: bd.id };
    /** รวมสถานะที่บัญชีรับยอดแล้ว — ไม่ใช่แค่ PAID */
    if (
      nb.status !== 'PAID' &&
      nb.status !== 'LOCKED' &&
      nb.status !== 'FINANCE_PREPARED' &&
      nb.status !== 'PAYMENT_EXPORTED'
    ) {
      continue;
    }
    const priorMs = payrollBatchChronologyMs(nb);
    if (currentMs > 0 && priorMs > 0 && priorMs >= currentMs) continue;

    const lineId = `${nb.id}_${workerId}`;
    const lineSnap = await getDoc(doc(db, 'payroll_batches', nb.id, 'lines', lineId));
    if (!lineSnap.exists()) continue;
    const line = { ...(lineSnap.data() as PayrollBatchLine), id: lineSnap.id };

    /**
     * SUPPLEMENTAL = ตกเบิกอย่างเดียว — เก็บรายการ prior-period เพื่ออนุมานอัตราก่อน remob
     * แต่ไม่แช่แข็ง timesheet / วัน (งวดนั้นไม่ได้จ่ายค่าแรงรายวันเดือนปัจจุบัน)
     */
    if (nb.batchType === 'SUPPLEMENTAL') {
      for (const it of line.hrLineAdjustments?.priorPeriodAllowanceItems ?? []) {
        const amount = Math.max(0, Number(it.amount) || 0);
        if (amount <= 0) continue;
        slice.priorPeriodAllowanceItems.push({
          sourceYearMonth: String(it.sourceYearMonth || '').trim(),
          label: String(it.label || '').trim(),
          amount,
        });
      }
      const paidAt = nb.paidAt ?? nb.financePreparedAt ?? nb.lockedAt ?? nb.createdAt;
      slice.priorPaidSummaries.push({
        batchId: nb.id,
        paymentLabel:
          typeof paidAt === 'number' && Number.isFinite(paidAt)
            ? new Date(paidAt).toLocaleDateString('th-TH')
            : nb.id,
        netAmount: round2(Number(line.netAmount) || 0),
        grossAmount: round2(Number(line.grossAmount) || 0),
        dailyRows: [],
        priorPeriodAllowanceItems: [...(line.hrLineAdjustments?.priorPeriodAllowanceItems ?? [])].filter(
          (it) => Number(it.amount) > 0,
        ),
      });
      continue;
    }

    if (nb.batchType && nb.batchType !== 'NORMAL') continue;

    mergeFrozenFromLine(slice, line);

    const paidAt = nb.paidAt ?? nb.financePreparedAt ?? nb.lockedAt ?? nb.createdAt;
    slice.priorPaidSummaries.push({
      batchId: nb.id,
      paymentLabel:
        typeof paidAt === 'number' && Number.isFinite(paidAt)
          ? new Date(paidAt).toLocaleDateString('th-TH')
          : nb.id,
      netAmount: round2(Number(line.netAmount) || 0),
      grossAmount: round2(Number(line.grossAmount) || 0),
      dailyRows: Array.isArray(line.dailyRowSnapshots) ? [...line.dailyRowSnapshots] : [],
      priorPeriodAllowanceItems: [...(line.hrLineAdjustments?.priorPeriodAllowanceItems ?? [])].filter(
        (it) => Number(it.amount) > 0,
      ),
    });
  }
  return slice;
}

/** @deprecated ใช้ loadPriorPaidFrozenPayrollSlice */
export async function loadPriorPaidFrozenTimesheetGrossById(
  db: Firestore,
  input: {
    payrollPeriodId: string;
    workerId: string;
    currentBatchId?: string | null;
    currentBatchChronologyMs?: number;
  },
): Promise<Record<string, number>> {
  const slice = await loadPriorPaidFrozenPayrollSlice(db, input);
  return slice.byTimesheetId;
}

/** หา frozen amount สำหรับใบงานหนึ่งใบ */
export function resolveFrozenTimesheetGrossAmount(
  ts: { id?: string; date?: string; status?: string },
  slice: Pick<
    PriorPaidFrozenPayrollSlice,
    'byTimesheetId' | 'byDate' | 'lockedSourceTimesheetIds'
  > | null | undefined,
): number | null {
  if (!slice) return null;
  const id = String(ts.id || '').trim();
  const ymd = String(ts.date || '').slice(0, 10);
  if (id && slice.byTimesheetId[id] != null) return slice.byTimesheetId[id];
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd) && slice.byDate[ymd] != null) {
    /** ใช้ยอดตามวันที่เมื่อใบนี้อยู่ในงวดที่จ่ายแล้ว หรือสถานะ LOCKED */
    if (ts.status === 'LOCKED' || (id && slice.lockedSourceTimesheetIds.has(id))) {
      return slice.byDate[ymd];
    }
  }
  return null;
}
