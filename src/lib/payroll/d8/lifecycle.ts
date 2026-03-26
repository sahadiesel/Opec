import type { PayrollBatchStatus, PayrollLifecycleStatus, PayrollRunStatus } from '@/lib/types';

/** แมป legacy batch → D8 (สำหรับอ่าน/เขียน d8LifecycleStatus) */
export function batchStatusToD8Lifecycle(status: PayrollBatchStatus): PayrollLifecycleStatus {
  switch (status) {
    case 'DRAFT':
      return 'draft';
    case 'GENERATED':
    case 'HR_REVIEWED':
      return 'reviewed';
    case 'HR_APPROVED':
      return 'approved';
    case 'FINANCE_PREPARED':
    case 'PAYMENT_EXPORTED':
      return 'readyForFinance';
    case 'PAID':
      return 'paid';
    case 'LOCKED':
      return 'locked';
    default:
      return 'reviewed';
  }
}

export function runStatusToD8Lifecycle(status: PayrollRunStatus): PayrollLifecycleStatus {
  switch (status) {
    case 'DRAFT':
      return 'draft';
    case 'CALCULATED':
    case 'PROCESSING':
    case 'HR_REVIEW':
      return 'reviewed';
    case 'HR_APPROVED':
      return 'approved';
    case 'FINANCE_APPROVED':
      return 'readyForFinance';
    case 'PAID':
      return 'paid';
    case 'LOCKED':
      return 'locked';
    case 'CANCELLED':
      return 'draft';
    default:
      return 'reviewed';
  }
}
