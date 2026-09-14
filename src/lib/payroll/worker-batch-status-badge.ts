import type { StatusBadgeSpec } from '@/components/ui/status-badge';
import type { PayrollBatchStatus } from '@/lib/types';
import { workerPayrollBatchStatusLabelTh } from '@/lib/payroll/worker-batch-status-display';

/** Status badge for worker `PayrollBatch.status` (HR / payroll batches list). */
export function workerBatchStatusBadge(status: PayrollBatchStatus | string): StatusBadgeSpec {
  const label = workerPayrollBatchStatusLabelTh(status);
  switch (status) {
    case 'GENERATED':
      return { label, tone: 'info', className: 'border-transparent text-blue-700', title: status };
    case 'HR_REVIEWED':
      return {
        label,
        tone: 'warning',
        className: 'border-amber-500/60 text-amber-950',
        title: status,
      };
    case 'HR_APPROVED':
      return {
        label,
        tone: 'outline',
        className: 'bg-green-50 text-green-700 border-green-200',
        title: status,
      };
    case 'FINANCE_PREPARED':
      return {
        label,
        tone: 'warning',
        className: 'border-transparent bg-amber-500 text-white hover:bg-amber-500',
        title: status,
      };
    case 'PAYMENT_EXPORTED':
      return {
        label,
        tone: 'info',
        className: 'border-transparent bg-blue-600 text-white hover:bg-blue-600',
        title: status,
      };
    case 'PAID':
      return { label, tone: 'success', title: status };
    case 'LOCKED':
      return { label, tone: 'secondary', title: status };
    case 'DRAFT':
    default:
      return { label, tone: 'outline', title: status };
  }
}
