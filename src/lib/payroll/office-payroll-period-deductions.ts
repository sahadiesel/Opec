import {
  isBangkokWeeklyRestDayYmd,
  type WeeklyRestPatternForCalendar,
} from '@/lib/attendance/bangkok-calendar';
import { assignFourScanSlots } from '@/lib/attendance/office-attendance-grid-day-cell';
import type { AttendanceDayEffectiveRow } from '@/lib/attendance/correction-merge';
import type { AttendancePunchDoc, OfficeLeaveEntitlementsDoc } from '@/lib/attendance/types';
import {
  absenceLatePayrollRates,
  evaluateOfficeScanInForPayrollHalf,
  monthlyWorkNormFromUnknownConfig,
  officeShiftMinuteBounds,
  type MonthlyWorkNormPolicyConfig,
  type OfficePayrollWorkingHalf,
} from '@/lib/hr/monthly-work-norm-policy';
import {
  entitlementForStaff,
  isEligibleForVacation,
  OFFICE_LEAVE_TYPE_LABELS,
  vacationEligibleFromDate,
} from '@/lib/leaves/policy';
import type { OfficeLeaveRequestDoc, OfficeLeaveHalfDaySession, OfficeLeaveType } from '@/lib/leaves/types';
import { officeStaffAppliesScanTimeDeductions } from '@/lib/payroll/office-staff-payroll-attendance-basis';
import { countPartialMonthUnpaidWorkDays } from '@/lib/payroll/office-payroll-partial-month';
import { normalizeStaffDateYmd } from '@/lib/payroll/office-staff-date-ymd';
import { formatYmdLocalThaiBE } from '@/lib/date-thai';
import type { CalendarHolidayEntry } from '@/lib/contract-position-rate-extras';
import {
  isHrSettingsCalendarHolidayYmd,
} from '@/lib/payroll/worker-global-labor-policy';
import type {
  OfficePayrollLineAttendanceSummary,
  OfficePayrollLineLeaveSummaryRow,
  OfficeStaff,
} from '@/lib/types';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** รายการวัน yyyy-MM-dd ตั้งแต่ start ถึง end (รวมปลายทาง) */
export function enumerateYmdsInclusive(startYmd: string, endYmd: string): string[] {
  const a = Date.parse(`${startYmd.slice(0, 10)}T00:00:00+07:00`);
  const b = Date.parse(`${endYmd.slice(0, 10)}T00:00:00+07:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return [];
  const out: string[] = [];
  for (let t = a; t <= b; t += 86_400_000) {
    out.push(new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }));
  }
  return out;
}

function bangkokMinutesFromMidnight(ms: number): number {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(ms));
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

function isScheduledWorkDay(
  ymd: string,
  weeklyRestPattern: WeeklyRestPatternForCalendar,
  calendarHolidays: CalendarHolidayEntry[],
): boolean {
  if (isBangkokWeeklyRestDayYmd(ymd, weeklyRestPattern)) return false;
  if (isHrSettingsCalendarHolidayYmd(ymd, calendarHolidays)) return false;
  return true;
}

type ExpandedLeaveDay = {
  ymd: string;
  fraction: number;
  leaveType: OfficeLeaveType;
  status: OfficeLeaveRequestDoc['status'];
  halfDaySession?: OfficeLeaveHalfDaySession | null;
};

/** ช่วงที่ต้องมาทำงานจริง — ลาครึ่งเช้า = ทำงานบ่าย, ลาครึ่งบ่าย = ทำงานเช้า */
function resolvePayrollWorkingHalf(
  approvedFraction: number,
  approvedLeaves: ExpandedLeaveDay[],
): OfficePayrollWorkingHalf {
  if (approvedFraction >= 1) return 'FULL';
  if (approvedFraction <= 0) return 'FULL';
  const half = approvedLeaves.find((l) => l.status === 'APPROVED' && l.fraction > 0 && l.fraction < 1);
  if (!half?.halfDaySession) return 'FULL';
  if (half.halfDaySession === 'MORNING') return 'AFTERNOON';
  if (half.halfDaySession === 'AFTERNOON') return 'MORNING';
  return 'FULL';
}

/** ขยายคำขอลาเป็นวันเดียวๆ ที่ทับกับงวดจ่าย */
export function expandLeaveRequestDaysInPeriod(
  req: OfficeLeaveRequestDoc,
  periodStart: string,
  periodEnd: string,
): ExpandedLeaveDay[] {
  const statuses = new Set<OfficeLeaveRequestDoc['status']>(['APPROVED', 'REJECTED']);
  if (!statuses.has(req.status)) return [];

  const ps = periodStart.slice(0, 10);
  const pe = periodEnd.slice(0, 10);
  const rs = req.startDate.slice(0, 10);
  const re = req.endDate.slice(0, 10);
  if (re < ps || rs > pe) return [];

  const out: ExpandedLeaveDay[] = [];
  if (req.isHalfDay) {
    if (rs >= ps && rs <= pe) {
      out.push({
        ymd: rs,
        fraction: 0.5,
        leaveType: req.leaveType,
        status: req.status,
        halfDaySession: req.halfDaySession ?? null,
      });
    }
    return out;
  }

  for (const ymd of enumerateYmdsInclusive(
    rs < ps ? ps : rs,
    re > pe ? pe : re,
  )) {
    out.push({ ymd, fraction: 1, leaveType: req.leaveType, status: req.status });
  }
  return out;
}

function approvedDaysBeforePeriod(
  requests: OfficeLeaveRequestDoc[],
  staffId: string,
  year: number,
  periodStart: string,
  leaveType: OfficeLeaveType,
): number {
  let total = 0;
  for (const req of requests) {
    if (req.staffId !== staffId || req.status !== 'APPROVED' || req.leaveType !== leaveType) continue;
    if (req.year !== year) continue;
    const endBefore = req.endDate.slice(0, 10) < periodStart.slice(0, 10);
    if (!endBefore) continue;
    total += Number(req.days) || 0;
  }
  return total;
}

function approvedDaysInPeriodByType(
  expandedApproved: ExpandedLeaveDay[],
): Record<OfficeLeaveType, number> {
  const out: Record<OfficeLeaveType, number> = { SICK: 0, PERSONAL: 0, VACATION: 0 };
  for (const d of expandedApproved) {
    if (d.status !== 'APPROVED') continue;
    out[d.leaveType] += d.fraction;
  }
  return out;
}

export type OfficePayrollPeriodAdjustmentResult = {
  preStatutoryDeductions: Array<{ code: string; amount: number }>;
  leaveSummary: OfficePayrollLineLeaveSummaryRow[];
  attendanceSummary: OfficePayrollLineAttendanceSummary | null;
};

export type ComputeOfficePayrollPeriodAdjustmentsInput = {
  staff: OfficeStaff;
  periodStart: string;
  periodEnd: string;
  /** epoch ms สิ้นงวด — ใช้ตัดสิทธิ์ลาพักร้อน */
  periodEndMs: number;
  leaveRequests: OfficeLeaveRequestDoc[];
  attendanceDayRows: AttendanceDayEffectiveRow[];
  /** สแกนดิบ — ใช้คำนวณสายเข้าบ่ายเมื่อมาเช้าตรงเวลา */
  attendancePunches?: AttendancePunchDoc[];
  leaveEntitlements: Pick<
    OfficeLeaveEntitlementsDoc,
    'sickDaysPerYear' | 'personalDaysPerYear' | 'annualVacationDaysPerYear'
  > | null;
  monthlyWorkNorm: MonthlyWorkNormPolicyConfig;
  weeklyRestPattern: WeeklyRestPatternForCalendar;
  calendarHolidays: CalendarHolidayEntry[];
};

/**
 * คำนวณหักสาย/ขาดจากสแกน + หักลาเกินสิทธิ์/ลาไม่อนุมัติแล้วไม่มาทำงาน
 * — ใช้กับพนักงานรายเดือนที่ยังอ้างอิงเวลาเข้างาน
 */
export function computeOfficePayrollPeriodAdjustments(
  input: ComputeOfficePayrollPeriodAdjustmentsInput,
): OfficePayrollPeriodAdjustmentResult {
  const empty: OfficePayrollPeriodAdjustmentResult = {
    preStatutoryDeductions: [],
    leaveSummary: [],
    attendanceSummary: null,
  };

  if (input.staff.salaryType !== 'MONTHLY') {
    return empty;
  }

  const baseSalary = Math.max(0, Number(input.staff.monthlySalary) || 0);
  if (baseSalary <= 0) return empty;

  const rates = absenceLatePayrollRates(baseSalary, input.monthlyWorkNorm);
  const staffStartYmd = normalizeStaffDateYmd(input.staff.startDate);
  const employmentEndYmd = normalizeStaffDateYmd(input.staff.employmentEndDate);
  const { preEmploymentDays, postEmploymentDays } = countPartialMonthUnpaidWorkDays(
    input.periodStart,
    input.periodEnd,
    input.staff,
  );
  const preEmploymentDeductionAmount = round2(preEmploymentDays * rates.perDay);
  const postEmploymentDeductionAmount = round2(postEmploymentDays * rates.perDay);

  const preStatutoryDeductions: Array<{ code: string; amount: number }> = [];
  if (preEmploymentDeductionAmount > 0) {
    preStatutoryDeductions.push({ code: 'pre_employment_deduction', amount: preEmploymentDeductionAmount });
  }
  if (postEmploymentDeductionAmount > 0) {
    preStatutoryDeductions.push({ code: 'post_employment_deduction', amount: postEmploymentDeductionAmount });
  }

  const partialMonthAttendanceSummary: OfficePayrollLineAttendanceSummary | null =
    preEmploymentDays > 0 || postEmploymentDays > 0
      ? {
          scanDeductionsApplied: false,
          lateMinutes: 0,
          scanAbsenceDays: 0,
          unpaidLeaveDays: 0,
          lateDeductionAmount: 0,
          scanAbsenceDeductionAmount: 0,
          unpaidLeaveDeductionAmount: 0,
          preEmploymentDays,
          postEmploymentDays,
          preEmploymentDeductionAmount,
          postEmploymentDeductionAmount,
        }
      : null;

  if (input.staff.monthlyAttendanceExempt) {
    return {
      preStatutoryDeductions,
      leaveSummary: [],
      attendanceSummary: partialMonthAttendanceSummary,
    };
  }

  const applyScan = officeStaffAppliesScanTimeDeductions(input.staff);
  const periodYmds = enumerateYmdsInclusive(input.periodStart, input.periodEnd);
  const year = Number(input.periodStart.slice(0, 4)) || new Date().getFullYear();

  const staffLeaves = input.leaveRequests.filter((r) => r.staffId === input.staff.id);
  const expandedAll: ExpandedLeaveDay[] = [];
  for (const req of staffLeaves) {
    expandedAll.push(...expandLeaveRequestDaysInPeriod(req, input.periodStart, input.periodEnd));
  }

  const attendanceByYmd = new Map(input.attendanceDayRows.map((r) => [r.ymd, r]));

  let totalLateMinutes = 0;
  let totalScanAbsenceDays = 0;
  let unpaidLeaveDays = 0;

  for (const ymd of periodYmds) {
    if (!isScheduledWorkDay(ymd, input.weeklyRestPattern, input.calendarHolidays)) continue;
    if (staffStartYmd && ymd < staffStartYmd) continue;
    if (employmentEndYmd && ymd > employmentEndYmd) continue;

    const dayLeaves = expandedAll.filter((d) => d.ymd === ymd);
    const approvedLeave = dayLeaves.filter((d) => d.status === 'APPROVED');
    const rejectedLeave = dayLeaves.filter((d) => d.status === 'REJECTED');
    const approvedFraction = approvedLeave.reduce((s, d) => s + d.fraction, 0);
    const rejectedFraction = rejectedLeave.reduce((s, d) => s + d.fraction, 0);

    const row = attendanceByYmd.get(ymd);
    const hasScan = row?.effectiveInMs != null;

    if (applyScan && approvedFraction < 1 && rejectedFraction > 0 && !hasScan) {
      unpaidLeaveDays += Math.min(1 - approvedFraction, rejectedFraction);
      continue;
    }

    if (approvedFraction >= 1) continue;

    if (applyScan) {
      const remainingFraction = Math.max(0, 1 - approvedFraction);
      const workingHalf = resolvePayrollWorkingHalf(approvedFraction, approvedLeave);
      if (!hasScan) {
        totalScanAbsenceDays += remainingFraction;
        continue;
      }
      const inMin = bangkokMinutesFromMidnight(row!.effectiveInMs!);
      const ev = evaluateOfficeScanInForPayrollHalf(inMin, input.monthlyWorkNorm, workingHalf);
      totalScanAbsenceDays += ev.absenceDayFraction * remainingFraction;
      totalLateMinutes += ev.lateMinutes;

      if (workingHalf === 'FULL' && input.attendancePunches?.length) {
        const bounds = officeShiftMinuteBounds(input.monthlyWorkNorm);
        if (bounds) {
          const dayPunches = input.attendancePunches.filter((p) => {
            const pYmd = new Date(p.punchedAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
            return pYmd === ymd;
          });
          const ins = dayPunches
            .filter((p) => p.direction === 'IN')
            .map((p) => p.punchedAt)
            .sort((a, b) => a - b);
          const outs = dayPunches
            .filter((p) => p.direction === 'OUT')
            .map((p) => p.punchedAt)
            .sort((a, b) => a - b);
          const slots = assignFourScanSlots(ins, outs, bounds);
          if (slots.morningInMs != null && slots.afternoonInMs != null) {
            const afternoonInMin = bangkokMinutesFromMidnight(slots.afternoonInMs);
            if (
              afternoonInMin > bounds.afternoonLateCutoffMin
              && afternoonInMin <= bounds.afternoonEndMin
            ) {
              totalLateMinutes += afternoonInMin - bounds.afternoonLateCutoffMin;
            }
          }
        }
      }
    }
  }

  const entitlement = entitlementForStaff(input.staff, input.leaveEntitlements, input.periodEndMs);
  const approvedInPeriod = approvedDaysInPeriodByType(expandedAll);
  const leaveSummary: OfficePayrollLineLeaveSummaryRow[] = [];
  const leaveTypes: OfficeLeaveType[] = ['SICK', 'PERSONAL', 'VACATION'];

  for (const leaveType of leaveTypes) {
    const usedInPeriod = round2(approvedInPeriod[leaveType]);
    const ytdBefore = approvedDaysBeforePeriod(staffLeaves, input.staff.id, year, input.periodStart, leaveType);
    const usedYtd = round2(ytdBefore + usedInPeriod);
    const ent = entitlement[leaveType];
    const remainingBefore = Math.max(0, ent - ytdBefore);
    const paidInPeriod = Math.min(usedInPeriod, remainingBefore);
    const unpaidFromQuota = Math.max(0, usedInPeriod - paidInPeriod);
    unpaidLeaveDays += unpaidFromQuota;

    const row: OfficePayrollLineLeaveSummaryRow = {
      leaveType,
      entitlementDays: ent,
      usedInPeriodDays: usedInPeriod,
      usedYtdDays: usedYtd,
      paidInPeriodDays: round2(paidInPeriod),
      unpaidInPeriodDays: round2(unpaidFromQuota),
    };
    if (leaveType === 'VACATION') {
      row.vacationEligible = isEligibleForVacation(input.staff, input.periodEndMs);
      row.vacationEligibleFrom = vacationEligibleFromDate(input.staff);
    }
    leaveSummary.push(row);
  }

  unpaidLeaveDays = round2(unpaidLeaveDays);
  totalScanAbsenceDays = round2(totalScanAbsenceDays);

  const lateDeductionAmount = round2(totalLateMinutes * rates.perMinute);
  const scanAbsenceDeductionAmount = round2(totalScanAbsenceDays * rates.perDay);
  const unpaidLeaveDeductionAmount = round2(unpaidLeaveDays * rates.perDay);

  if (applyScan && lateDeductionAmount > 0) {
    preStatutoryDeductions.push({ code: 'late_deduction', amount: lateDeductionAmount });
  }
  if (applyScan && scanAbsenceDeductionAmount > 0) {
    preStatutoryDeductions.push({ code: 'absence_deduction', amount: scanAbsenceDeductionAmount });
  }
  if (unpaidLeaveDeductionAmount > 0) {
    preStatutoryDeductions.push({ code: 'unpaid_leave_deduction', amount: unpaidLeaveDeductionAmount });
  }

  const attendanceSummary: OfficePayrollLineAttendanceSummary = {
    scanDeductionsApplied: applyScan,
    lateMinutes: totalLateMinutes,
    scanAbsenceDays: totalScanAbsenceDays,
    unpaidLeaveDays,
    lateDeductionAmount,
    scanAbsenceDeductionAmount,
    unpaidLeaveDeductionAmount,
    ...(preEmploymentDays > 0 || postEmploymentDays > 0
      ? {
          preEmploymentDays,
          postEmploymentDays,
          preEmploymentDeductionAmount,
          postEmploymentDeductionAmount,
        }
      : {}),
  };

  return { preStatutoryDeductions, leaveSummary, attendanceSummary };
}

export function monthlyWorkNormFromPolicyRecord(
  rec: { config?: Record<string, unknown> } | null | undefined,
): MonthlyWorkNormPolicyConfig {
  const raw = rec?.config && typeof rec.config === 'object' ? rec.config : undefined;
  return monthlyWorkNormFromUnknownConfig(raw);
}

export function leaveSummaryLabelTh(row: OfficePayrollLineLeaveSummaryRow): string {
  const typeLabel = OFFICE_LEAVE_TYPE_LABELS[row.leaveType];
  if (row.leaveType === 'VACATION' && row.vacationEligible === false) {
    const from = row.vacationEligibleFrom;
    return `${typeLabel}: ยังไม่มีสิทธิ์${from ? ` (ครบ 365 วันเมื่อ ${formatYmdLocalThaiBE(from)})` : ' (ทำงานครบ 1 ปี)'}`;
  }
  return `${typeLabel}: ลาในงวด ${row.usedInPeriodDays} วัน · สิทธิ์ ${row.entitlementDays} วัน/ปี · ใช้สะสมปีนี้ ${row.usedYtdDays} วัน`;
}
