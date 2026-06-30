import type { Firestore } from 'firebase/firestore';
import type { AttendanceDayEffectiveRow } from '@/lib/attendance/correction-merge';
import type { OfficeLeaveRequestDoc } from '@/lib/leaves/types';
import type { CalendarHolidayEntry } from '@/lib/contract-position-rate-extras';
import type { WeeklyRestPatternForCalendar } from '@/lib/attendance/bangkok-calendar';
import { isBangkokWeeklyRestDayYmd } from '@/lib/attendance/bangkok-calendar';
import { formatDateThaiBE } from '@/lib/date-thai';
import { loadPayrollPoliciesFromFirestore } from '@/lib/payroll/d8';
import {
  expandLeaveRequestDaysInPeriod,
  enumerateYmdsInclusive,
} from '@/lib/payroll/office-payroll-period-deductions';
import {
  loadOfficePayrollRunComputationContext,
  type OfficePayrollRunComputationContext,
} from '@/lib/payroll/office-payroll-run-context';
import { officeStaffAppliesScanTimeDeductions } from '@/lib/payroll/office-staff-payroll-attendance-basis';
import { isHrSettingsCalendarHolidayYmd } from '@/lib/payroll/worker-global-labor-policy';
import type { OfficePayrollRun, OfficeStaff } from '@/lib/types';

export type OfficeScanAttendanceIncompleteDay = {
  workDateYmd: string;
  /** เวลาที่ยังขาด — ใช้แสดงข้อความเตือน */
  missing: 'IN' | 'OUT';
};

export type OfficeScanAttendanceBlocker = {
  staff: Pick<OfficeStaff, 'id' | 'fullName' | 'staffCode'>;
  incompleteDays: OfficeScanAttendanceIncompleteDay[];
};

function isScheduledWorkDay(
  ymd: string,
  weeklyRestPattern: WeeklyRestPatternForCalendar,
  calendarHolidays: CalendarHolidayEntry[],
): boolean {
  if (isBangkokWeeklyRestDayYmd(ymd, weeklyRestPattern)) return false;
  if (isHrSettingsCalendarHolidayYmd(ymd, calendarHolidays)) return false;
  return true;
}

function approvedLeaveFractionOnYmd(
  staffId: string,
  ymd: string,
  leaveRequests: OfficeLeaveRequestDoc[],
  periodStart: string,
  periodEnd: string,
): number {
  let fraction = 0;
  for (const req of leaveRequests) {
    if (req.staffId !== staffId || req.status !== 'APPROVED') continue;
    for (const d of expandLeaveRequestDaysInPeriod(req, periodStart, periodEnd)) {
      if (d.ymd === ymd && d.status === 'APPROVED') fraction += d.fraction;
    }
  }
  return fraction;
}

function incompleteAttendanceIssue(row: AttendanceDayEffectiveRow): 'IN' | 'OUT' | null {
  const hasIn = row.effectiveInMs != null;
  const hasOut = row.effectiveOutMs != null;
  if (hasIn && !hasOut) return 'OUT';
  if (!hasIn && hasOut) return 'IN';
  return null;
}

function missingAttendanceLabelTh(missing: 'IN' | 'OUT'): string {
  return missing === 'OUT' ? 'ขาดเวลาออกงาน' : 'ขาดเวลาเข้างาน';
}

export function findIncompleteScanAttendanceDaysForStaff(
  staff: OfficeStaff,
  input: {
    periodStart: string;
    periodEnd: string;
    attendanceDayRows: AttendanceDayEffectiveRow[];
    leaveRequests: OfficeLeaveRequestDoc[];
    weeklyRestPattern: WeeklyRestPatternForCalendar;
    calendarHolidays: CalendarHolidayEntry[];
  },
): OfficeScanAttendanceIncompleteDay[] {
  if (!officeStaffAppliesScanTimeDeductions(staff)) return [];

  const periodYmds = enumerateYmdsInclusive(input.periodStart, input.periodEnd);
  const attendanceByYmd = new Map(input.attendanceDayRows.map((r) => [r.ymd, r]));
  const staffStartYmd = staff.startDate?.slice(0, 10);
  const employmentEndYmd = staff.employmentEndDate?.slice(0, 10);
  const incompleteDays: OfficeScanAttendanceIncompleteDay[] = [];

  for (const ymd of periodYmds) {
    if (!isScheduledWorkDay(ymd, input.weeklyRestPattern, input.calendarHolidays)) continue;
    if (staffStartYmd && ymd < staffStartYmd) continue;
    if (employmentEndYmd && ymd > employmentEndYmd) continue;

    const approvedLeave = approvedLeaveFractionOnYmd(
      staff.id,
      ymd,
      input.leaveRequests,
      input.periodStart,
      input.periodEnd,
    );
    if (approvedLeave >= 1) continue;

    const row = attendanceByYmd.get(ymd);
    if (!row) continue;
    const missing = incompleteAttendanceIssue(row);
    if (missing) incompleteDays.push({ workDateYmd: ymd, missing });
  }

  return incompleteDays;
}

export function listScanAttendanceBlockersForOfficePayroll(
  staffList: OfficeStaff[],
  ctx: Pick<
    OfficePayrollRunComputationContext,
    | 'attendanceRowsByStaffId'
    | 'leaveRequests'
    | 'weeklyRestPattern'
    | 'calendarHolidays'
    | 'periodYmds'
  >,
  run: Pick<OfficePayrollRun, 'payrollPeriodStart' | 'payrollPeriodEnd'>,
): OfficeScanAttendanceBlocker[] {
  const blockers: OfficeScanAttendanceBlocker[] = [];
  for (const staff of staffList) {
    const incompleteDays = findIncompleteScanAttendanceDaysForStaff(staff, {
      periodStart: run.payrollPeriodStart,
      periodEnd: run.payrollPeriodEnd,
      attendanceDayRows: ctx.attendanceRowsByStaffId.get(staff.id) ?? [],
      leaveRequests: ctx.leaveRequests,
      weeklyRestPattern: ctx.weeklyRestPattern,
      calendarHolidays: ctx.calendarHolidays,
    });
    if (incompleteDays.length === 0) continue;
    blockers.push({
      staff: { id: staff.id, fullName: staff.fullName, staffCode: staff.staffCode },
      incompleteDays,
    });
  }
  return blockers;
}

export function formatScanAttendanceBlockersMessage(blockers: OfficeScanAttendanceBlocker[]): string {
  return blockers
    .map((b) => {
      const days = b.incompleteDays
        .map((d) => `${formatDateThaiBE(d.workDateYmd)} (${missingAttendanceLabelTh(d.missing)})`)
        .join(', ');
      return `${b.staff.fullName} (${b.staff.staffCode}): ${days}`;
    })
    .join('\n');
}

export function scanAttendanceBlockersErrorMessage(blockers: OfficeScanAttendanceBlocker[]): string {
  return `การบันทึกเวลาจากการสแกนยังไม่ครบ — กรุณาแก้ไขเวลาให้เรียบร้อยก่อนคำนวณเงินเดือน:\n${formatScanAttendanceBlockersMessage(blockers)}`;
}

export function scanAttendanceBlockerSummaryTh(b: OfficeScanAttendanceBlocker): string {
  const days = b.incompleteDays
    .map((d) => `${formatDateThaiBE(d.workDateYmd)} (${missingAttendanceLabelTh(d.missing)})`)
    .join(', ');
  return `${b.staff.fullName} (${b.staff.staffCode}): ${days}`;
}

export async function loadOfficeScanAttendanceBlockersForRun(
  firestore: Firestore,
  run: Pick<OfficePayrollRun, 'payrollMonth' | 'payrollPeriodStart' | 'payrollPeriodEnd'>,
  staffList: OfficeStaff[],
): Promise<OfficeScanAttendanceBlocker[]> {
  if (staffList.length === 0) return [];
  const policyRecords = await loadPayrollPoliciesFromFirestore(firestore);
  const ctx = await loadOfficePayrollRunComputationContext(firestore, run, policyRecords);
  return listScanAttendanceBlockersForOfficePayroll(staffList, ctx, run);
}
