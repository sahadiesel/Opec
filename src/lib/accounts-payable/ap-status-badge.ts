import type { StatusBadgeSpec } from '@/components/ui/status-badge';
import type { APStatus } from '@/lib/types';

/** Status badge for accounts payable list rows. */
export function apStatusBadge(status: APStatus | string): StatusBadgeSpec {
  switch (status) {
    case 'OPEN':
      return { label: 'OPEN', tone: 'info' };
    case 'PARTIALLY_PAID':
      return { label: 'PARTIAL', tone: 'warning', className: 'text-amber-700' };
    case 'PAID':
      return { label: 'PAID', tone: 'success' };
    case 'OVERDUE':
      return { label: 'OVERDUE', tone: 'destructive' };
    default:
      return { label: String(status), tone: 'outline' };
  }
}
