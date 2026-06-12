import type { PayrollBatchStatus } from '@/lib/types';

/** ป้ายภาษาไทยสำหรับสถานะ batch ลูกจ้าง — ค่าใน Firestore ยังเป็นรหัสภาษาอังกฤษ */
const WORKER_BATCH_STATUS_LABEL_TH: Record<PayrollBatchStatus, string> = {
  DRAFT: 'ร่าง',
  GENERATED: 'ตรวจแล้ว (ยังไม่ส่งขออนุมัติ)',
  HR_REVIEWED: 'รอผู้จัดการอนุมัติ',
  HR_APPROVED: 'ผู้จัดการอนุมัติแล้ว',
  FINANCE_PREPARED: 'บัญชีจัดเตรียมจ่าย',
  PAYMENT_EXPORTED: 'ส่งออกชำระแล้ว',
  PAID: 'ชำระแล้ว',
  LOCKED: 'ล็อก (snapshot)',
};

export function workerPayrollBatchStatusLabelTh(status: PayrollBatchStatus | string): string {
  return WORKER_BATCH_STATUS_LABEL_TH[status as PayrollBatchStatus] ?? String(status);
}

const PAYROLL_LINE_EXPORT_STATUS_LABEL_TH: Record<'pending' | 'exported' | 'failed', string> = {
  pending: 'รอ export',
  exported: 'export แล้ว',
  failed: 'export ไม่สำเร็จ',
};

/** ป้ายภาษาไทยสำหรับ exportStatus บรรทัด settlement */
export function payrollLineExportStatusLabelTh(status: string | undefined | null): string {
  if (!status) return '—';
  return PAYROLL_LINE_EXPORT_STATUS_LABEL_TH[status as keyof typeof PAYROLL_LINE_EXPORT_STATUS_LABEL_TH] ?? status;
}
