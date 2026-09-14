import type { StatusBadgeSpec } from '@/components/ui/status-badge';
import type { PayrollBatchStatus } from '@/lib/types';

/**
 * Accounting payout-queue labels for worker batches (not the HR batches-list copy).
 * Kept separate from `workerBatchStatusBadge` on purpose.
 */
export function workerBatchAccountingStatusBadge(
  status: PayrollBatchStatus | string,
): StatusBadgeSpec {
  switch (status) {
    case 'FINANCE_PREPARED':
      return {
        label: 'รอทำจ่าย (บัญชี)',
        tone: 'warning',
        className: 'border-transparent bg-amber-600 text-white hover:bg-amber-600',
      };
    case 'PAYMENT_EXPORTED':
      return {
        label: 'ส่งไฟล์จ่ายแล้ว',
        tone: 'info',
        className: 'border-transparent bg-blue-600 text-white hover:bg-blue-600',
      };
    case 'PAID':
      return { label: 'PAID', tone: 'success', className: 'bg-green-700 hover:bg-green-700' };
    case 'LOCKED':
      return { label: 'ล็อกแล้ว', tone: 'secondary' };
    default:
      return { label: String(status), tone: 'outline' };
  }
}
