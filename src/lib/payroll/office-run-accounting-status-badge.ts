import type { StatusBadgeSpec } from '@/components/ui/status-badge';
import type { PayrollRunStatus } from '@/lib/types';

/**
 * Accounting payout-queue labels for office runs (not the HR office-payroll list copy).
 * Kept separate from `OfficePayrollRunStatusBadge` on purpose.
 */
export function officeRunAccountingStatusBadge(
  status: PayrollRunStatus | string,
): StatusBadgeSpec {
  switch (status) {
    case 'HR_APPROVED':
      return {
        label: 'รอทำจ่าย (บัญชี)',
        tone: 'warning',
        className: 'border-transparent bg-amber-600 text-white hover:bg-amber-600',
      };
    case 'FINANCE_APPROVED':
      return {
        label: 'อนุมัติการเงินแล้ว',
        tone: 'info',
        className: 'border-transparent bg-blue-600 text-white hover:bg-blue-600',
      };
    case 'LOCKED':
      return {
        label: 'ล็อกแล้ว',
        tone: 'default',
        className: 'bg-primary hover:bg-primary',
      };
    case 'PAID':
      return { label: 'PAID', tone: 'secondary' };
    default:
      return { label: String(status), tone: 'outline' };
  }
}
