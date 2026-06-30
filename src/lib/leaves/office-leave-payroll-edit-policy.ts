import type { OfficeLeaveRequestDoc } from '@/lib/leaves/types';
import type { OfficePayrollRun, PayrollRunStatus } from '@/lib/types';

const PAYROLL_EDITABLE_STATUSES: ReadonlySet<PayrollRunStatus> = new Set(['DRAFT', 'CALCULATED']);

/** ใบลาทับกับเดือนงวดจ่าย YYYY-MM */
export function officeLeaveOverlapsPayrollMonth(
  leave: Pick<OfficeLeaveRequestDoc, 'startDate' | 'endDate'>,
  payrollMonth: string,
): boolean {
  const ym = payrollMonth.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(ym)) return false;
  const [y, m] = ym.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const monthStart = `${ym}-01`;
  const monthEnd = `${ym}-${String(lastDay).padStart(2, '0')}`;
  const start = leave.startDate.slice(0, 10);
  const end = leave.endDate.slice(0, 10);
  return start <= monthEnd && end >= monthStart;
}

export function payrollMonthFromLeaveStart(startDate: string): string {
  return startDate.slice(0, 7);
}

export function officePayrollRunsForLeaveMonth(
  leave: Pick<OfficeLeaveRequestDoc, 'startDate' | 'endDate'>,
  runs: readonly Pick<OfficePayrollRun, 'payrollMonth' | 'status'>[],
): Pick<OfficePayrollRun, 'payrollMonth' | 'status'>[] {
  return runs.filter((r) => officeLeaveOverlapsPayrollMonth(leave, r.payrollMonth));
}

/** งวดจ่ายเดือนนั้นยังแก้ใบลาได้ (มีอย่างน้อย 1 งวด DRAFT/CALCULATED และไม่มีงวดที่ล็อก/ส่งอนุมัติแล้ว) */
export function isOfficeLeavePayrollMonthEditable(
  leave: Pick<OfficeLeaveRequestDoc, 'startDate' | 'endDate'>,
  runs: readonly Pick<OfficePayrollRun, 'payrollMonth' | 'status'>[],
): boolean {
  const monthRuns = officePayrollRunsForLeaveMonth(leave, runs);
  if (monthRuns.length === 0) return true;
  const hasEditable = monthRuns.some((r) => PAYROLL_EDITABLE_STATUSES.has(r.status));
  const hasFrozen = monthRuns.some((r) => !PAYROLL_EDITABLE_STATUSES.has(r.status));
  return hasEditable && !hasFrozen;
}

export function canEditOfficeLeaveRequest(
  leave: Pick<OfficeLeaveRequestDoc, 'status' | 'startDate' | 'endDate'>,
  runs: readonly Pick<OfficePayrollRun, 'payrollMonth' | 'status'>[],
): boolean {
  if (leave.status === 'DRAFT' || leave.status === 'SUBMITTED') return true;
  if (leave.status === 'REJECTED' || leave.status === 'CANCELLED') return false;
  if (leave.status === 'APPROVED') {
    return isOfficeLeavePayrollMonthEditable(leave, runs);
  }
  return false;
}

export function calculatedPayrollRunsNeedingRecalcAfterLeaveChange(
  leave: Pick<OfficeLeaveRequestDoc, 'startDate' | 'endDate'>,
  runs: readonly Pick<OfficePayrollRun, 'id' | 'payrollMonth' | 'status' | 'payrollRunNo'>[],
): Array<Pick<OfficePayrollRun, 'id' | 'payrollMonth' | 'status' | 'payrollRunNo'>> {
  return runs.filter(
    (r) => r.status === 'CALCULATED' && officeLeaveOverlapsPayrollMonth(leave, r.payrollMonth),
  );
}
