import {
  DEFAULT_MONTHLY_WORK_NORM,
  officeShiftMinuteBounds,
  type MonthlyWorkNormPolicyConfig,
  type OfficeShiftMinuteBounds,
} from '@/lib/hr/monthly-work-norm-policy';
import {
  formatAttendanceHm,
  normalizeAttendanceHmInput,
  otHoursFromHmRange,
  parseAttendanceHm,
} from '@/lib/attendance/overtime-time';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type OfficeOvertimePaySegmentCategory =
  | 'holiday_normal_work'
  | 'weekday_overtime'
  | 'holiday_overtime';

export type OfficeOvertimePaySegment = {
  category: OfficeOvertimePaySegmentCategory;
  startHm: string;
  endHm: string;
  hours: number;
  multiplier: number;
  amount: number;
  label: string;
};

export type OfficeOvertimeIntervalPayResult = {
  monthlySalary: number;
  dailyRate: number;
  hourlyRate: number;
  totalHours: number;
  totalAmount: number;
  isHoliday: boolean;
  /** ตัวคูณเฉลี่ยถ่วงน้ำหนัก — ใช้ snapshot ย้อนหลัง */
  effectiveMultiplier: number;
  segments: OfficeOvertimePaySegment[];
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

/** A — ทำงานในวันหยุด ช่วงเวลาปกติ */
export function resolveOfficeHolidayNormalWorkMultiplier(norm: MonthlyWorkNormPolicyConfig): number {
  const a = Number(norm.officeHolidayNormalWorkMultiplier);
  if (Number.isFinite(a) && a > 0) return Math.min(10, a);
  const legacy = Number(norm.officeHolidayHourMultiplier);
  if (Number.isFinite(legacy) && legacy > 0) return Math.min(10, legacy);
  return DEFAULT_MONTHLY_WORK_NORM.officeHolidayNormalWorkMultiplier ?? 1;
}

/** B — OT วันทำงานปกติ (ก่อน/หลังเวลางาน) */
export function resolveOfficeWeekdayOvertimeMultiplier(norm: MonthlyWorkNormPolicyConfig): number {
  const b = Number(norm.officeWeekdayOvertimeMultiplier);
  if (Number.isFinite(b) && b > 0) return Math.min(10, b);
  const legacy = Number(norm.officeOvertimeHourMultiplier);
  if (Number.isFinite(legacy) && legacy > 0) return Math.min(10, legacy);
  return DEFAULT_MONTHLY_WORK_NORM.officeWeekdayOvertimeMultiplier ?? 1.5;
}

/** C — OT ในวันหยุดนักขัตฤกษ์/วันอาทิตย์ */
export function resolveOfficeHolidayOvertimeMultiplier(norm: MonthlyWorkNormPolicyConfig): number {
  const c = Number(norm.officeHolidayOvertimeMultiplier);
  if (Number.isFinite(c) && c > 0) return Math.min(10, c);
  const legacy = Number(norm.officeOvertimeHourMultiplier);
  if (Number.isFinite(legacy) && legacy > 0) return Math.min(10, legacy);
  return DEFAULT_MONTHLY_WORK_NORM.officeHolidayOvertimeMultiplier ?? 1.5;
}

function isNormalWorkMinute(minute: number, bounds: OfficeShiftMinuteBounds): boolean {
  return (
    (minute >= bounds.workStartMin && minute < bounds.morningEndMin) ||
    (minute >= bounds.afternoonStartMin && minute < bounds.afternoonEndMin)
  );
}

function collectSplitPoints(
  startMin: number,
  endMin: number,
  bounds: OfficeShiftMinuteBounds,
): number[] {
  const points = new Set<number>([startMin, endMin]);
  for (const p of [
    bounds.workStartMin,
    bounds.morningEndMin,
    bounds.afternoonStartMin,
    bounds.afternoonEndMin,
  ]) {
    if (p > startMin && p < endMin) points.add(p);
  }
  return [...points].sort((a, b) => a - b);
}

function segmentLabel(category: OfficeOvertimePaySegmentCategory): string {
  switch (category) {
    case 'holiday_normal_work':
      return 'ทำงานวันหยุด (เวลาปกติ)';
    case 'weekday_overtime':
      return 'OT วันทำงานปกติ';
    case 'holiday_overtime':
      return 'OT วันหยุด';
  }
}

function isBreakMinute(minute: number, bounds: OfficeShiftMinuteBounds): boolean {
  return minute >= bounds.morningEndMin && minute < bounds.afternoonStartMin;
}

function classifySegment(
  midMin: number,
  isHoliday: boolean,
  bounds: OfficeShiftMinuteBounds,
): OfficeOvertimePaySegmentCategory | null {
  if (isBreakMinute(midMin, bounds)) return null;
  const inNormal = isNormalWorkMinute(midMin, bounds);
  if (isHoliday) {
    return inNormal ? 'holiday_normal_work' : 'holiday_overtime';
  }
  return inNormal ? null : 'weekday_overtime';
}

function multiplierForCategory(
  category: OfficeOvertimePaySegmentCategory,
  norm: MonthlyWorkNormPolicyConfig,
): number {
  switch (category) {
    case 'holiday_normal_work':
      return resolveOfficeHolidayNormalWorkMultiplier(norm);
    case 'weekday_overtime':
      return resolveOfficeWeekdayOvertimeMultiplier(norm);
    case 'holiday_overtime':
      return resolveOfficeHolidayOvertimeMultiplier(norm);
  }
}

/**
 * คำนวณค่า OT จากช่วงเวลา — แบ่งตามกรอบเวลางานและประเภทวัน
 * ตัวอย่างวันอาทิตย์ 16:00–18:00 (เลิก 17:00): 16–17 ใช้ A, 17–18 ใช้ C
 */
export function computeOfficeOvertimePayFromTimeRange(input: {
  monthlySalary: number;
  norm: MonthlyWorkNormPolicyConfig;
  startHm: string;
  endHm: string;
  isHoliday: boolean;
}): OfficeOvertimeIntervalPayResult | null {
  const startHm = normalizeAttendanceHmInput(input.startHm);
  const endHm = normalizeAttendanceHmInput(input.endHm);
  if (!startHm || !endHm) return null;

  const startMin = parseAttendanceHm(startHm);
  const endMin = parseAttendanceHm(endHm);
  if (startMin === null || endMin === null || endMin <= startMin) return null;

  const bounds = officeShiftMinuteBounds(input.norm);
  if (!bounds) return null;

  const salary = Math.max(0, Number(input.monthlySalary) || 0);
  const days = resolveMonthlyWorkNormDays(input.norm);
  const hoursPerDay = resolveMonthlyWorkNormHoursPerDay(input.norm);
  const dailyRate = round2(salary / days);
  const hourlyRate = round2(dailyRate / hoursPerDay);

  const splitPoints = collectSplitPoints(startMin, endMin, bounds);
  const segments: OfficeOvertimePaySegment[] = [];

  for (let i = 0; i < splitPoints.length - 1; i += 1) {
    const segStart = splitPoints[i]!;
    const segEnd = splitPoints[i + 1]!;
    if (segEnd <= segStart) continue;
    const mid = (segStart + segEnd) / 2;
    const category = classifySegment(mid, input.isHoliday, bounds);
    if (!category) continue;

    const hours = round2((segEnd - segStart) / 60);
    if (hours <= 0) continue;
    const multiplier = multiplierForCategory(category, input.norm);
    const amount = round2(hourlyRate * multiplier * hours);
    segments.push({
      category,
      startHm: formatAttendanceHm(segStart),
      endHm: formatAttendanceHm(segEnd),
      hours,
      multiplier,
      amount,
      label: segmentLabel(category),
    });
  }

  const totalHours = round2(segments.reduce((s, seg) => s + seg.hours, 0));
  const totalAmount = round2(segments.reduce((s, seg) => s + seg.amount, 0));
  const effectiveMultiplier =
    totalHours > 0 && hourlyRate > 0
      ? round2(totalAmount / (hourlyRate * totalHours))
      : resolveOfficeWeekdayOvertimeMultiplier(input.norm);

  return {
    monthlySalary: salary,
    dailyRate,
    hourlyRate,
    totalHours,
    totalAmount,
    isHoliday: input.isHoliday,
    effectiveMultiplier,
    segments,
  };
}

/** ตรวจสอบช่วงเวลา OT ก่อนบันทึก */
export function validateOfficeOvertimeHmRange(
  startHm: string,
  endHm: string,
  norm?: MonthlyWorkNormPolicyConfig | null,
): string | null {
  const start = normalizeAttendanceHmInput(startHm);
  const end = normalizeAttendanceHmInput(endHm);
  if (!start || !end) return 'กรุณาระบุเวลาเริ่มและเวลาสิ้นสุด (HH:mm)';
  const bounds = norm ? officeShiftMinuteBounds(norm) : null;
  const hours = otHoursFromHmRange(start, end, bounds);
  if (hours === null || hours <= 0) return 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม (หลังหักพัก)';
  if (hours > 24) return 'ช่วง OT ต้องไม่เกิน 24 ชม.';
  return null;
}
