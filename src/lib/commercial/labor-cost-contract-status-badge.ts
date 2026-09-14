import type { StatusBadgeSpec } from '@/components/ui/status-badge';
import type { LaborCostContractStatus } from '@/lib/types';

/** Status badge for labor cost contract terms (not scope badges). */
export function laborCostContractStatusBadge(
  status: LaborCostContractStatus | string,
): StatusBadgeSpec {
  switch (status) {
    case 'DRAFT':
      return { label: 'DRAFT', tone: 'outline', className: 'bg-slate-50 text-slate-600 border-slate-200' };
    case 'ACTIVE':
      return { label: 'ACTIVE', tone: 'success' };
    case 'EXPIRED':
      return { label: 'EXPIRED', tone: 'destructive' };
    case 'CLOSED':
      return { label: 'CLOSED', tone: 'secondary' };
    default:
      return { label: String(status), tone: 'outline' };
  }
}
