import type { StatusBadgeSpec } from '@/components/ui/status-badge';
import type { QuotationStatus } from '@/lib/types';

/** Status badge for quotation list rows. */
export function quotationStatusBadge(status: QuotationStatus | string): StatusBadgeSpec {
  switch (status) {
    case 'draft':
      return { label: 'DRAFT', tone: 'outline', className: 'bg-slate-50 text-slate-600 border-slate-200' };
    case 'sent':
      return { label: 'SENT', tone: 'info', className: 'text-blue-600' };
    case 'accepted':
      return { label: 'ACCEPTED', tone: 'success' };
    case 'rejected':
      return { label: 'REJECTED', tone: 'destructive' };
    case 'cancelled':
      return { label: 'CANCELLED', tone: 'secondary' };
    case 'expired':
      return { label: 'EXPIRED', tone: 'outline', className: 'text-orange-600 border-orange-200' };
    case 'revised':
      return { label: 'REVISED', tone: 'secondary', className: 'bg-violet-100 text-violet-700' };
    default:
      return { label: String(status), tone: 'outline' };
  }
}
