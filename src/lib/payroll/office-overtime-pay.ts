import {
  computeOfficeOvertimePayFromTimeRange,
  resolveOfficeHolidayNormalWorkMultiplier,
  resolveOfficeHolidayOvertimeMultiplier,
  resolveOfficeWeekdayOvertimeMultiplier,
  type OfficeOvertimeIntervalPayResult,
  type OfficeOvertimePaySegment,
} from '@/lib/payroll/office-overtime-interval-pay';
import { normalizeAttendanceHmInput } from '@/lib/attendance/overtime-time';
import {
  DEFAULT_MONTHLY_WORK_NORM,
  absenceLatePayrollRates,
  evaluateOfficeScanInForPayrollHalf,
  officeShiftMinuteBounds,
  type MonthlyWorkNormPolicyConfig,
} from '@/lib/hr/monthly-work-norm-policy';
import {
  isBangkokWeeklyRestDayYmd,
  type WeeklyRestPatternForCalendar,
} from '@/lib/attendance/bangkok-calendar';
import { isHrSettingsCalendarHolidayYmd } from '@/lib/payroll/worker-global-labor-policy';
import type { CalendarHolidayEntry } from '@/lib/contract-position-rate-extras';
import type { AttendanceDayEffectiveRow } from '@/lib/attendance/correction-merge';
import type { OfficeStaff } from '@/lib/types';
import { normalizeStaffDateYmd } from '@/lib/payroll/office-staff-date-ymd';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type OfficeOvertimePayBreakdown = {
  monthlySalary: number;
  dailyRate: number;
  hourlyRate: number;
  multiplier: number;
  approvedHours: number;
  amount: number;
};

type ApprovedOvertimeRequestForPay = {
  subjectId: string;
  workDateYmd: string;
  status: string;
  requestedAt?: number | null;
  reviewedAt?: number | null;
  requestedOtHours?: number | null;
  approvedOtHours?: number | null;
  approvedOtStartHm?: string | null;
  approvedOtEndHm?: string | null;
  monthlySalarySnapshot?: number | null;
  otPayAmountSnapshot?: number | null;
};

function resolveMonthlyWorkNormDays(norm: MonthlyWorkNormPolicyConfig): number {
  const days = Math.round(Number(norm.standardWorkingDaysPerMonth));
  if (Number.isFinite(days) && days >= 1 && days <= 31) return days;
  return DEFAULT_MONTHLY_WORK_NORM.standardWorkingDaysPerMonth;
}

function resolveMonthlyWorkNormHoursPerDay(norm: MonthlyWorkNormPolicyConfig): number {
  const hours = Number(norm.normalWorkingHoursPerDay);
  if (Number.isFinite(hours) && hours > 0 && hours <= 24) return hours;
  return DEFAULT_MONTHLY_WORK_NORM.normalWorkingHoursPerDay;
}

/** @deprecated ใช้ resolveOfficeWeekdayOvertimeMultiplier */
export function resolveOfficeOvertimeHourMultiplier(norm: MonthlyWorkNormPolicyConfig): number {
  return resolveOfficeWeekdayOvertimeMultiplier(norm);
}

/** ตัวคูณค่าลงเวลาวันหยุด (เวลาปกติ) — ค่าเริ่มต้น 1.0 */
export function resolveOfficeHolidayWorkMultiplier(norm: MonthlyWorkNormPolicyConfig): number {
  return resolveOfficeHolidayNormalWorkMultiplier(norm);
}

export type { OfficeOvertimeIntervalPayResult, OfficeOvertimePaySegment };
export {
  computeOfficeOvertimePayFromTimeRange,
  resolveOfficeHolidayNormalWorkMultiplier,
  resolveOfficeHolidayOvertimeMultiplier,
  resolveOfficeWeekdayOvertimeMultiplier,
};

/** วันหยุดประจำสัปดาห์หรือวันหยุดในปฏิทิน HR */
export function isOfficeRestOrHolidayDay(
  ymd: string,
  weeklyRestPattern: WeeklyRestPatternForCalendar,
  calendarHolidays: CalendarHolidayEntry[] | null | undefined,
): boolean {
  const d = ymd.slice(0, 10);
  if (isBangkokWeeklyRestDayYmd(d, weeklyRestPattern)) return true;
  if (isHrSettingsCalendarHolidayYmd(d, calendarHolidays)) return true;
  return false;
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

/**
 * สัดส่วนวันทำงานจากสแกนเข้า–ออกบนวันหยุด
 * - เช้าอย่างเดียว (เข้า–ออกก่อนจบช่วงเช้า) = 0.5
 * - บ่ายอย่างเดียว (เข้าหลังจบช่วงเช้า) = 0.5
 * - ทั้งวัน (เข้าช่วงเช้า) = 1
 * - เข้าหลังเลิกงาน = 0
 */
export function officeRestDayWorkedFractionFromScan(
  effectiveInMs: number | null | undefined,
  effectiveOutMs: number | null | undefined,
  norm: MonthlyWorkNormPolicyConfig,
): number {
  if (effectiveInMs == null || !Number.isFinite(effectiveInMs)) return 0;
  const inMin = bangkokMinutesFromMidnight(effectiveInMs);
  const bounds = officeShiftMinuteBounds(norm);
  if (!bounds) {
    const ev = evaluateOfficeScanInForPayrollHalf(inMin, norm, 'FULL');
    return Math.max(0, Math.min(1, 1 - ev.absenceDayFraction));
  }

  if (inMin > bounds.afternoonEndMin) return 0;

  const outMin =
    effectiveOutMs != null && Number.isFinite(effectiveOutMs)
      ? bangkokMinutesFromMidnight(effectiveOutMs)
      : null;

  // เช้าอย่างเดียว: เข้าเช้าและออกไม่เกินจบช่วงเช้า
  if (
    inMin <= bounds.morningEndMin &&
    outMin != null &&
    outMin <= bounds.morningEndMin
  ) {
    return 0.5;
  }

  // บ่ายอย่างเดียว: เข้าหลังจบช่วงเช้า
  if (inMin > bounds.morningEndMin) {
    return 0.5;
  }

  // เข้าช่วงเช้า (มีหรือไม่มีออกหลังบ่าย) = ทั้งวัน
  return 1;
}

/** ค่า OT แบบ legacy (ชั่วโมงเดียว × ตัวคูณ B) — ใช้เมื่อไม่มีช่วงเวลา */
export function computeOfficeOvertimePayAmount(
  monthlySalary: number,
  norm: MonthlyWorkNormPolicyConfig,
  approvedHours: number,
): OfficeOvertimePayBreakdown {
  const salary = Math.max(0, Number(monthlySalary) || 0);
  const hours = Math.max(0, Number(approvedHours) || 0);
  const days = resolveMonthlyWorkNormDays(norm);
  const hoursPerDay = resolveMonthlyWorkNormHoursPerDay(norm);
  const multiplier = resolveOfficeWeekdayOvertimeMultiplier(norm);
  const dailyRate = round2(salary / days);
  const hourlyRate = round2(dailyRate / hoursPerDay);
  const amount = round2(hourlyRate * multiplier * hours);
  return {
    monthlySalary: salary,
    dailyRate,
    hourlyRate,
    multiplier,
    approvedHours: hours,
    amount,
  };
}

export function computeOfficeOvertimePayForApprovedRequest(
  monthlySalary: number,
  norm: MonthlyWorkNormPolicyConfig,
  input: {
    workDateYmd: string;
    approvedHours?: number | null;
    approvedStartHm?: string | null;
    approvedEndHm?: string | null;
    isHoliday: boolean;
  },
): OfficeOvertimeIntervalPayResult | OfficeOvertimePayBreakdown {
  const startHm = normalizeAttendanceHmInput(input.approvedStartHm);
  const endHm = normalizeAttendanceHmInput(input.approvedEndHm);
  if (startHm && endHm) {
    const interval = computeOfficeOvertimePayFromTimeRange({
      monthlySalary,
      norm,
      startHm,
      endHm,
      isHoliday: input.isHoliday,
    });
    if (interval) return interval;
  }

  const hours = Number(input.approvedHours);
  return computeOfficeOvertimePayAmount(monthlySalary, norm, hours);
}

/** รวมยอด OT ที่อนุมัติแล้วในช่วงงวดจ่าย — ใช้ช่วงเวลา + ตัวคูณ A/B/C
 * นับเฉพาะคำขอล่าสุดต่อคนต่อวัน (กันซ้ำเมื่อขอแก้ไขแล้วอนุมัติใหม่)
 */
export function sumApprovedOfficeOvertimePayInPeriod(
  staffId: string,
  periodStart: string,
  periodEnd: string,
  requests: ApprovedOvertimeRequestForPay[],
  computeOpts: {
    monthlySalary: number;
    monthlyWorkNorm: MonthlyWorkNormPolicyConfig;
    weeklyRestPattern: WeeklyRestPatternForCalendar;
    calendarHolidays: CalendarHolidayEntry[];
  },
): number {
  const ps = periodStart.slice(0, 10);
  const pe = periodEnd.slice(0, 10);
  const latestByDay = new Map<string, ApprovedOvertimeRequestForPay>();
  for (const r of requests) {
    if (r.subjectId !== staffId || r.status !== 'APPROVED') continue;
    const ymd = r.workDateYmd.slice(0, 10);
    if (ymd < ps || ymd > pe) continue;
    const cur = latestByDay.get(ymd);
    const rAt = Number(r.requestedAt) || 0;
    const cAt = cur ? Number(cur.requestedAt) || 0 : 0;
    // Prefer reviewedAt when present (amend / re-approve), then requestedAt
    const rReviewed = Number(r.reviewedAt) || 0;
    const cReviewed = cur ? Number(cur.reviewedAt) || 0 : 0;
    const rScore = Math.max(rReviewed, rAt);
    const cScore = Math.max(cReviewed, cAt);
    if (!cur || rScore >= cScore) latestByDay.set(ymd, r);
  }

  let total = 0;
  for (const r of latestByDay.values()) {
    const ymd = r.workDateYmd.slice(0, 10);
    const approvedHours = Number(r.approvedOtHours ?? r.requestedOtHours);
    const snapshotAmt = Number(r.otPayAmountSnapshot);
    if (Number.isFinite(snapshotAmt) && snapshotAmt >= 0 && snapshotAmt > 0) {
      total += round2(snapshotAmt);
      continue;
    }
    if (!Number.isFinite(approvedHours) || approvedHours <= 0) {
      const startHm = normalizeAttendanceHmInput(r.approvedOtStartHm);
      const endHm = normalizeAttendanceHmInput(r.approvedOtEndHm);
      if (!startHm || !endHm) continue;
    }

    const payrollSalary = Math.max(0, Number(computeOpts.monthlySalary) || 0);
    const salarySnapshot = Number(r.monthlySalarySnapshot);
    const salary =
      payrollSalary > 0
        ? payrollSalary
        : Number.isFinite(salarySnapshot) && salarySnapshot > 0
          ? salarySnapshot
          : 0;

    const isHoliday = isOfficeRestOrHolidayDay(
      ymd,
      computeOpts.weeklyRestPattern,
      computeOpts.calendarHolidays,
    );
    const pay = computeOfficeOvertimePayForApprovedRequest(salary, computeOpts.monthlyWorkNorm, {
      workDateYmd: ymd,
      approvedHours,
      approvedStartHm: r.approvedOtStartHm,
      approvedEndHm: r.approvedOtEndHm,
      isHoliday,
    });
    total += 'totalAmount' in pay ? pay.totalAmount : pay.amount;
  }
  return round2(total);
}

export type OfficeRestDayWorkedPayResult = {
  days: number;
  amount: number;
};

/**
 * ค่าทำงานวันหยุดจากสแกน (วันอาทิตย์/วันหยุดปฏิทิน)
 * = (เงินเดือน ÷ วันมาตรฐาน/เดือน) × ตัวคูณวันหยุด × สัดส่วนวันจากสแกน
 */
export function sumOfficeRestDayWorkedPayInPeriod(
  staff: Pick<OfficeStaff, 'id' | 'startDate' | 'employmentEndDate' | 'excludeFromPayrollRuns' | 'salaryType'>,
  periodStart: string,
  periodEnd: string,
  attendanceDayRows: AttendanceDayEffectiveRow[],
  computeOpts: {
    monthlySalary: number;
    monthlyWorkNorm: MonthlyWorkNormPolicyConfig;
    weeklyRestPattern: WeeklyRestPatternForCalendar;
    calendarHolidays: CalendarHolidayEntry[];
  },
): OfficeRestDayWorkedPayResult {
  if (staff.excludeFromPayrollRuns) return { days: 0, amount: 0 };
  if (staff.salaryType && staff.salaryType !== 'MONTHLY') return { days: 0, amount: 0 };

  const ps = periodStart.slice(0, 10);
  const pe = periodEnd.slice(0, 10);
  const staffStart = normalizeStaffDateYmd(staff.startDate);
  const staffEnd = normalizeStaffDateYmd(staff.employmentEndDate);
  const rates = absenceLatePayrollRates(computeOpts.monthlySalary, computeOpts.monthlyWorkNorm);
  const mult = resolveOfficeHolidayWorkMultiplier(computeOpts.monthlyWorkNorm);

  let days = 0;
  let amount = 0;
  for (const row of attendanceDayRows) {
    const ymd = row.ymd.slice(0, 10);
    if (ymd < ps || ymd > pe) continue;
    if (staffStart && ymd < staffStart) continue;
    if (staffEnd && ymd > staffEnd) continue;
    if (
      !isOfficeRestOrHolidayDay(
        ymd,
        computeOpts.weeklyRestPattern,
        computeOpts.calendarHolidays,
      )
    ) {
      continue;
    }
    const fraction = officeRestDayWorkedFractionFromScan(
      row.effectiveInMs,
      row.effectiveOutMs,
      computeOpts.monthlyWorkNorm,
    );
    if (fraction <= 0) continue;
    days += fraction;
    amount += rates.perDay * mult * fraction;
  }
  return { days: round2(days), amount: round2(amount) };
}
