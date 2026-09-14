'use client';

import { Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { StatusBadge, type StatusBadgeSpec } from '@/components/ui/status-badge';
import type { PayrollRunStatus } from '@/lib/types';
import { officePayrollRunStatusLabelTh } from '@/lib/payroll/office-payroll-run-status-display';

/** Label / styling flavor — keep Thai office copy and executive English badges distinct. */
export type OfficePayrollRunStatusBadgeFlavor = 'office' | 'executive';

const EXECUTIVE_RUN_STATUS_LABEL_EN: Partial<Record<PayrollRunStatus, string>> = {
  DRAFT: 'DRAFT',
  CALCULATED: 'CALCULATED',
  HR_REVIEW: 'HR REVIEW',
  HR_APPROVED: 'HR APPROVED',
  FINANCE_APPROVED: 'FINANCE APPROVED',
  PAID: 'PAID',
  LOCKED: 'LOCKED',
  CANCELLED: 'CANCELLED',
};

function labelForFlavor(
  status: PayrollRunStatus | string,
  flavor: OfficePayrollRunStatusBadgeFlavor,
): string {
  if (flavor === 'office') return officePayrollRunStatusLabelTh(status);
  return EXECUTIVE_RUN_STATUS_LABEL_EN[status as PayrollRunStatus] ?? String(status);
}

function officeRunStatusBadgeSpec(
  status: PayrollRunStatus | string,
  flavor: OfficePayrollRunStatusBadgeFlavor,
): StatusBadgeSpec {
  const label = labelForFlavor(status, flavor);
  switch (status) {
    case 'DRAFT':
      return { label, tone: 'outline', className: 'bg-slate-50 text-slate-600 border-slate-200' };
    case 'CALCULATED':
    case 'PROCESSING':
      return { label, tone: 'info', className: 'text-blue-600' };
    case 'HR_REVIEW':
      return flavor === 'office'
        ? {
            label,
            tone: 'warning',
            className: 'border-transparent bg-amber-600 text-white hover:bg-amber-600',
          }
        : { label, tone: 'warning', className: 'text-amber-700' };
    case 'HR_APPROVED':
      return {
        label,
        tone: 'outline',
        className: 'bg-green-50 text-green-700 border-green-200',
      };
    case 'FINANCE_APPROVED':
    case 'PAID':
      return { label, tone: 'success' };
    case 'LOCKED':
      return { label, tone: 'default', className: 'bg-primary text-primary-foreground' };
    case 'CANCELLED':
      return { label, tone: 'secondary' };
    default:
      return { label, tone: 'outline' };
  }
}

/**
 * Shared run-status badge for Office / Executive list pages.
 * Preserves per-flavor labels and the HR_REVIEW style difference (office solid vs executive outline).
 */
export function OfficePayrollRunStatusBadge({
  status,
  flavor,
}: {
  status: PayrollRunStatus | string;
  flavor: OfficePayrollRunStatusBadgeFlavor;
}) {
  const spec = officeRunStatusBadgeSpec(status, flavor);

  if (status === 'LOCKED') {
    return (
      <Badge className="bg-primary text-primary-foreground">
        <Clock className="h-3 w-3 mr-1" /> {spec.label}
      </Badge>
    );
  }

  return <StatusBadge {...spec} />;
}
