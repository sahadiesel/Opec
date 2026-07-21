import {
  collection,
  getDocs,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';
import type { CashAdvanceRequest, CashAdvanceStatus } from '@/lib/types';

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

/**
 * ดึงคำขอเบิกล่วงหน้าของลูกจ้างที่ต้องหักจากเงินเดือนในงวดจ่าย (ยังไม่มี payrollRecoveryBatchId)
 */
export async function fetchWorkerCashAdvancesPendingSalaryRecovery(
  db: Firestore,
  workerId: string,
): Promise<{ total: number; advances: CashAdvanceRecoveryRow[] }> {
  const snap = await getDocs(
    query(collection(db, 'cash_advance_requests'), where('workerId', '==', workerId)),
  );
  const eligible = new Set(CASH_ADVANCE_STATUSES_ELIGIBLE_FOR_SALARY_RECOVERY);
  const advances: CashAdvanceRecoveryRow[] = [];
  for (const d of snap.docs) {
    const r = { id: d.id, ...(d.data() as object) } as CashAdvanceRequest;
    if (r.subjectType !== 'worker') continue;
    if (!eligible.has(r.status)) continue;
    if (r.payrollRecoveryBatchId) continue;
    // กันข้อมูลเก่า/สถานะผิดพลาด — หักจากสลิปได้เฉพาะรายการที่ทำจ่ายจริงแล้ว
    const paid =
      (typeof r.paidAt === 'number' && r.paidAt > 0) ||
      !!(r.cashbookEntryId || r.pettyCashEntryId || r.paymentBankAccountId || r.pettyCashBankAccountId);
    if (!paid) continue;
    const amt = Math.max(0, Number(r.amountBaht) || 0);
    if (amt <= 0) continue;
    advances.push({ id: r.id, requestNo: r.requestNo || r.id, amountBaht: amt });
  }
  const total = Math.round(advances.reduce((s, a) => s + a.amountBaht, 0) * 100) / 100;
  return { total, advances };
}
