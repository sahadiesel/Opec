import type { StatusBadgeSpec } from '@/components/ui/status-badge';
import type { TaxInvoiceStatus } from '@/lib/types';

const COMPACT = 'h-5 px-1.5 text-[10px] font-semibold leading-none';

/** Status badge for tax invoice list rows (compact). */
export function taxInvoiceStatusBadge(status: TaxInvoiceStatus | string): StatusBadgeSpec {
  switch (status) {
    case 'DRAFT':
      return {
        label: 'DRAFT',
        tone: 'outline',
        className: `${COMPACT} bg-slate-50 text-slate-600 border-slate-200`,
      };
    case 'ISSUED':
      return { label: 'ISSUED', tone: 'success', className: COMPACT };
    case 'CANCELLED':
      return { label: 'CXL', tone: 'secondary', className: COMPACT, title: 'CANCELLED' };
    default:
      return { label: String(status), tone: 'outline', className: COMPACT };
  }
}
