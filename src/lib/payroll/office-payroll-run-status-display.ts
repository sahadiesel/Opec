import type { PayrollRunStatus } from '@/lib/types';

/** ป้ายภาษาไทยสำหรับสถานะงวด office — ค่าใน Firestore ยังเป็นรหัสภาษาอังกฤษ */
const OFFICE_RUN_STATUS_LABEL_TH: Partial<Record<PayrollRunStatus, string>> = {
  DRAFT: 'ร่าง',
  CALCULATED: 'คำนวณแล้ว (ยังไม่ส่งขออนุมัติ)',
  PROCESSING: 'กำลังคำนวณ',
  HR_REVIEW: 'รอผู้จัดการอนุมัติ',
  HR_APPROVED: 'อนุมัติแล้ว · รอบัญชีจ่าย',
  FINANCE_APPROVED: 'บัญชีอนุมัติจ่ายแล้ว',
  PAID: 'จ่ายแล้ว',
  LOCKED: 'ล็อก (snapshot)',
  CANCELLED: 'ยกเลิก',
};

export function officePayrollRunStatusLabelTh(status: PayrollRunStatus | string): string {
  return OFFICE_RUN_STATUS_LABEL_TH[status as PayrollRunStatus] ?? String(status);
}

/** งวดที่อยู่ในคิวผู้จัดการ (หลังฝ่ายเงินเดือนกดส่งอนุมัติ) */
export function isOfficeRunPendingManagerApproval(status: PayrollRunStatus | string): boolean {
  return status === 'HR_REVIEW';
}

/** งวดที่ฝ่ายบัญชีควรเห็นในคิวทำจ่าย */
export function isOfficeRunPendingAccountingPayout(status: PayrollRunStatus | string): boolean {
  return status === 'HR_APPROVED';
}
