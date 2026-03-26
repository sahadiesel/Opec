import { WAVE_TIMESHEET_DEPLOYMENT_STATUSES } from '@/lib/constants/timesheet-wave';
import type {
  Assignment,
  DailyTimesheet,
  DeploymentStatus,
  OfficePayrollLine,
  OfficeStaff,
} from '@/lib/types';

export function isActiveOfficePayrollStaff(s: OfficeStaff): boolean {
  return s.status === 'ACTIVE' && s.payrollBand !== 'EXECUTIVE';
}

export function officeStaffHasBank(s: OfficeStaff): boolean {
  return Boolean(s.bankAccountNumber?.trim() && s.bankName?.trim());
}

export function officeStaffHasTax(s: OfficeStaff): boolean {
  return Boolean(s.taxId?.trim());
}

export function officeStaffHasSalary(s: OfficeStaff): boolean {
  return (s.monthlySalary ?? 0) > 0;
}

export function officeMasterDataComplete(s: OfficeStaff): boolean {
  return officeStaffHasBank(s) && officeStaffHasTax(s) && officeStaffHasSalary(s);
}

export function isTimesheetPayrollReady(ts: DailyTimesheet): boolean {
  if (ts.status === 'LOCKED') return true;
  if (ts.status === 'CORRECTION_REQUIRED' || ts.status === 'REJECTED') return false;
  return ts.readyForPayroll === true;
}

export function assignmentOverlapsPeriod(a: Assignment, pStart: string, pEnd: string): boolean {
  return a.startDate <= pEnd && a.endDate >= pStart;
}

export function assignmentInWaveBoard(a: Assignment): boolean {
  return WAVE_TIMESHEET_DEPLOYMENT_STATUSES.includes(a.deploymentStatus as DeploymentStatus);
}

export function buildOfficeLineStaffIdSet(lines: OfficePayrollLine[] | undefined): Set<string> {
  const set = new Set<string>();
  if (!lines) return set;
  for (const l of lines) {
    if (l.staffId) set.add(l.staffId);
  }
  return set;
}

/** Per (waveId, workerId): all timesheets in window are payroll-ready (or LOCKED). */
export function workerWavePayrollComplete(
  timesheets: DailyTimesheet[],
  waveId: string,
  workerId: string
): boolean {
  const rows = timesheets.filter((t) => t.waveId === waveId && t.workerId === workerId);
  if (rows.length === 0) return false;
  return rows.every(isTimesheetPayrollReady);
}

export function workerWaveHasTimesheet(
  timesheets: DailyTimesheet[],
  waveId: string,
  workerId: string
): boolean {
  return timesheets.some((t) => t.waveId === waveId && t.workerId === workerId);
}
