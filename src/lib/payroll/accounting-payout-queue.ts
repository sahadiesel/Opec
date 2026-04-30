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
 * ลูกจ้าง: อนุมัติผู้จัดการ/OPS แล้ว แต่ยังไม่มีใครกด「ส่งต่อบัญชี」→ ยังไม่ใช่งาน **ตัดจ่าย/ทำ bank** ของบัญชี
 * (ฝ่ายอื่นต้องส่งต่อจนเป็น FINANCE_PREPARED ก่อน)
 */
export const WORKER_BATCH_STATUSES_AWAITING_FINANCE_HANDOFF: PayrollBatchStatus[] = ['HR_APPROVED'];

/**
 * ชุดจ่ายลูกจ้างที่ **บัญชี** ใช้ลงรายการจ่าย/ตรวจ bank — เริ่มต่อเมื่อ **ส่งถึงฝ่ายบัญชีแล้ว (FINANCE_PREPARED+)** ห้ามรวม HR_APPROVED
 */
export const WORKER_BATCH_STATUSES_FOR_ACCOUNTING_PAYOUT: PayrollBatchStatus[] = [
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
