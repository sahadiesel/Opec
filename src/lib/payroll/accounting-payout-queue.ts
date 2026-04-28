import type { PayrollBatchStatus, PayrollRunStatus, User } from '@/lib/types';
import { isSystemAdmin } from '@/lib/permission-core';
import { isSimpleAccounting } from '@/lib/simple-tier-model';
import { canCreate } from '@/lib/permissions';

/**
 * งวด office ที่ "บัญชี" ใช้ตัดจ่าย — หลัง HR/Manager อนุมัติแล้ว ไม่รวม DRAFT/CALCULATED รอฝ่าย HR
 */
export const OFFICE_RUN_STATUSES_FOR_ACCOUNTING_PAYOUT: PayrollRunStatus[] = [
  'HR_APPROVED',
  'FINANCE_APPROVED',
  'PAID',
  'LOCKED',
];

/**
 * ชุดจ่ายลูกจ้างที่บัญชีเกี่ยวข้อง — หลัง manager/HR อนุมัติ batch แล้ว
 */
export const WORKER_BATCH_STATUSES_FOR_ACCOUNTING_PAYOUT: PayrollBatchStatus[] = [
  'HR_APPROVED',
  'FINANCE_PREPARED',
  'PAYMENT_EXPORTED',
  'PAID',
  'LOCKED',
];

/**
 * บทบาท "บัญชีล้วน" (accounting officer/manager) ไม่สร้างงวดเอง — ดูเฉพาะคิวรอตัดจ่าย
 * แอดมิน/ผู้ที่สร้างงวด office หรือ batch ได้ → เห็นรายการเต็ม
 */
export function shouldFilterToAccountingPayoutQueue(
  user: User | null | undefined,
  opts: {
    canCreateOfficePayroll: boolean;
    canCreateWorkerPayroll: boolean;
    canPrepareWorkerPayroll: boolean;
  },
): boolean {
  if (!user) return false;
  if (isSystemAdmin(user)) return false;
  if (!isSimpleAccounting(user)) return false;
  if (opts.canCreateOfficePayroll || opts.canCreateWorkerPayroll || opts.canPrepareWorkerPayroll) {
    return false;
  }
  return true;
}

/**
 * ใช้ร่วมกับ canCreate(office) / canPreparePayroll
 */
export function canCreateOfficePayrollFlag(user: User | null | undefined): boolean {
  if (!user) return false;
  return canCreate(user, 'office_payroll');
}
