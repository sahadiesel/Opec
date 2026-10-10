import { collection, getDocs, query, where, type Firestore } from 'firebase/firestore';
import type { PayrollBatch, PayrollBatchStatus } from '@/lib/types';

function payrollPeriodIdForYearMonth(yearMonth: string): string {
  return `worker_ym_${yearMonth.replace(/-/g, '_')}`;
}

/** ส่งบัญชีหรือจ่ายแล้ว — ห้ามปิดงวดซ้ำหรือใส่รายการจ่ายเข้าเดือนนี้อีก */
export const COMMITTED_NORMAL_PAYROLL_STATUSES: readonly PayrollBatchStatus[] = [
  'FINANCE_PREPARED',
  'PAYMENT_EXPORTED',
  'PAID',
  'LOCKED',
];

export function isCommittedNormalPayrollBatch(batch: {
  status?: string;
  batchType?: string;
  totalWorkers?: number;
}): boolean {
  if (batch.batchType === 'SUPPLEMENTAL') return false;
  if ((Number(batch.totalWorkers) || 0) <= 0) return false;
  return (COMMITTED_NORMAL_PAYROLL_STATUSES as readonly string[]).includes(String(batch.status || ''));
}

export async function yearMonthHasCommittedNormalPayroll(db: Firestore, yearMonth: string): Promise<boolean> {
  const ym = yearMonth.trim();
  if (!/^\d{4}-\d{2}$/.test(ym)) return false;
  const snap = await getDocs(
    query(
      collection(db, 'payroll_batches'),
      where('payrollPeriodId', '==', payrollPeriodIdForYearMonth(ym)),
    ),
  );
  return snap.docs.some((d) => isCommittedNormalPayrollBatch(d.data() as PayrollBatch));
}

export async function assertPayrollMonthOpenForNewPayItems(db: Firestore, yearMonth: string): Promise<void> {
  if (!(await yearMonthHasCommittedNormalPayroll(db, yearMonth))) return;
  throw new Error(
    `งวด payroll ${yearMonth} ส่งจ่ายแล้ว — ปิดงวดซ้ำหรือใส่รายการจ่ายในงวดนี้ไม่ได้ ให้เลือกงวดถัดไป`,
  );
}
