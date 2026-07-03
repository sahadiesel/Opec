/**
 * Payroll labor cost from PO / position **cost package** (ต้นทุนต่อวัน) + ชม.ในแพ็ก (8|12)
 * + ตัวคูณ OT ฝั่งต้นทุน — สอดคล้องกับกฎหมายไทย (normal สูงสุด 8 ชม./วัน วันทำงานปกติ)
 */

import type { DailyTimesheet, MainContract } from '@/lib/types';
import {
  LEGAL_NORMAL_HOURS_PER_DAY,
  PACKAGE_OT_TIER_MULT,
  derivePackageNormalHourlyRate,
} from '@/lib/commercial/package-hourly-rate';
import type { StatedPackageHours } from '@/lib/commercial/package-hourly-rate';
import { parseWorkDayHours } from '@/lib/commercial/package-work-day-hours';
import type { ParsedWorkDayHours } from '@/lib/commercial/package-work-day-hours';

/** @deprecated ใช้ LEGAL_NORMAL_HOURS_PER_DAY */
export const THAI_LEGAL_NORMAL_HOURS_PER_DAY = LEGAL_NORMAL_HOURS_PER_DAY;

/** @deprecated ใช้ PACKAGE_OT_TIER_MULT */
export const PAYROLL_OT_TIER_MULT = PACKAGE_OT_TIER_MULT;

export type { StatedPackageHours };

export interface DeriveHourlyInput {
  /** ต้นทุนรายวันตามแพ็ก (เช่น costBaselineSnapshot) */
  costPackagePerDay: number;
  /** แพ็กระบุว่าเป็นต่อ 8 หรือ 12 ชม. */
  statedHours: StatedPackageHours;
  /** ตัวคูณ OT หลังเลิกกะ (ฝั่งต้นทุน) เช่น 1, 1.5, 2 */
  otAfterShiftMultiplier: number;
}

export function deriveCostNormalHourlyRate(input: DeriveHourlyInput): number {
  return derivePackageNormalHourlyRate(
    input.costPackagePerDay,
    input.statedHours,
    input.otAfterShiftMultiplier,
  );
}

/** ฝั่งจ่าย (payroll cost): M1 / D1 / SB คิดแพ็ก standby — billing แยกตาม rate ขาย */
export function isPayrollCostStandbyPackageEvent(
  eventType: DailyTimesheet['eventType'],
): boolean {
  return (
    eventType === 'standby_day' ||
    eventType === 'mobilization_day' ||
    eventType === 'demobilization_day'
  );
}

/** ชม.ที่จ่าย standby / M1 / D1 — ใช้ normalHours ที่ลงไว้; ถ้าไม่มี ใช้ชม.ในแพ็ก PO (12 หรือ 8) × standbyUnits */
export function resolveStandbyPaidHours(
  ts: Pick<DailyTimesheet, 'normalHours' | 'standbyUnits'>,
  statedPackageHours: StatedPackageHours = 8,
): number {
  const nh = Number(ts.normalHours);
  if (Number.isFinite(nh) && nh > 0) {
    return Math.min(24, nh) * Math.max(1, Number(ts.standbyUnits ?? 1));
  }
  const units = Math.max(1, Number(ts.standbyUnits ?? 1));
  const defaultDayHours = statedPackageHours === 12 ? 12 : LEGAL_NORMAL_HOURS_PER_DAY;
  return units * defaultDayHours;
}

export interface StandbyDayPackageCostInput {
  timesheet: Pick<DailyTimesheet, 'normalHours' | 'standbyUnits'>;
  costPackagePerDay: number;
  statedHours: StatedPackageHours;
  otAfterShiftMultiplier: number;
  /** ตัวคูณ standby ฝั่งต้นทุน (สัญญา/HR Settings — ปกติ 0.5) */
  standbyCostMultiplier: number;
}

/**
 * Standby / mobilization / demobilization (ฝั่งจ่าย) = แพ็กต้นทุนรายวัน × สัดส่วนชม.ที่ลง / ชม.ในแพ็ก × ตัวคูณ standby
 * ตัวอย่าง แพ็ก 12 ชม. ฿1,700 × standby 0.5 × 12/12 = ฿850 · 8 ชม. → × 8/12
 */
export function computeStandbyDayCostFromPackage(input: StandbyDayPackageCostInput): number {
  const pkg = Math.max(0, input.costPackagePerDay);
  if (pkg <= 0) return 0;
  const stated = input.statedHours === 12 ? 12 : 8;
  const hours = resolveStandbyPaidHours(input.timesheet, input.statedHours);
  const mult = Math.max(0, input.standbyCostMultiplier);
  const fraction = Math.min(1, hours / stated);
  return roundMoney(pkg * fraction * mult);
}

/** ปฏิทิน + ตัวคูณวันหยุดสำหรับ payroll ลูกจ้าง — จาก HR Settings */
export type PayrollRestDaySchedule = {
  weeklyRestPattern: 'none' | 'sat_sun' | 'sunday_only';
  calendarHolidays: { date: string; label: string }[];
  costMultipliers: {
    publicHoliday: number;
    sunday: number;
    sundayOt: number;
  };
};

export interface RestDayResolution {
  active: boolean;
  kind: 'none' | 'public_holiday' | 'weekly_rest';
  /**
   * วันหยุดในปฏิทินสัญญา (ฝั่งต้นทุน): คูณทั้งยอดหลังแยก 8 ชม. + OT ตามกฎหมาย
   * (ใช้ rateMultiplierPolicy.cost.publicHoliday)
   */
  publicHolidayWrap?: number;
  /**
   * เสาร์–อาทิตย์ / อาทิตย์อย่างเดียว: ตัวคูณฐานชม.ต้นทุน (เช่น 1.5) — ใช้ขยาย h ก่อนคิด 8+4 ชม.
   */
  weeklyNormalMult?: number;
  /**
   * @deprecated สูตร work_day แพ็กไม่คูณแยก overflow/tier ด้วยค่านี้อีก — เก็บไว้เพื่ออ่านจากสัญญา/แสดงผล
   */
  weeklyOtMult?: number;
}

/**
 * วันหยุดตามปฏิทินกลาง (HR Settings) + รูปแบบวันหยุดประจำสัปดาห์
 */
export function resolvePayrollRestDay(dateStr: string, schedule: PayrollRestDaySchedule | undefined): RestDayResolution {
  if (!schedule) return { active: false, kind: 'none' };

  const cost = schedule.costMultipliers;
  const holidays = schedule.calendarHolidays || [];
  if (holidays.some((h) => h.date === dateStr)) {
    return {
      active: true,
      kind: 'public_holiday',
      publicHolidayWrap: Number(cost.publicHoliday ?? 1),
    };
  }

  const parts = dateStr.split('-').map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return { active: false, kind: 'none' };

  const local = new Date(y, m - 1, d);
  const dow = local.getDay();

  const pattern = schedule.weeklyRestPattern || 'none';
  const sunday = Number(cost.sunday ?? 1);
  const sundayOt = Number(cost.sundayOt ?? cost.sunday ?? 1);

  if (pattern === 'sunday_only' && dow === 0) {
    return {
      active: true,
      kind: 'weekly_rest',
      weeklyNormalMult: sunday,
      weeklyOtMult: sundayOt,
    };
  }
  if (pattern === 'sat_sun' && (dow === 0 || dow === 6)) {
    return {
      active: true,
      kind: 'weekly_rest',
      weeklyNormalMult: sunday,
      weeklyOtMult: sundayOt,
    };
  }

  if (dow === 0) {
    return {
      active: true,
      kind: 'weekly_rest',
      weeklyNormalMult: sunday,
      weeklyOtMult: sundayOt,
    };
  }

  return { active: false, kind: 'none' };
}

/** @deprecated ใช้ resolvePayrollRestDay + ตารางจาก HR Settings — คงไว้สำหรับโค้ดที่ยังอ้างสัญญา */
export function resolveCostRestDay(dateStr: string, contract: MainContract | undefined): RestDayResolution {
  const cost = contract?.rateMultiplierPolicy?.cost;
  if (!cost) return { active: false, kind: 'none' };
  return resolvePayrollRestDay(dateStr, {
    weeklyRestPattern: contract?.contractCostWeeklyRestPattern || 'none',
    calendarHolidays: contract?.contractCostCalendarHolidays || [],
    costMultipliers: {
      publicHoliday: Number(cost.publicHoliday ?? 1),
      sunday: Number(cost.sunday ?? 1),
      sundayOt: Number(cost.sundayOt ?? cost.sunday ?? 1),
    },
  });
}

function roundMoney(n: number): number {
  return Math.round(Math.max(0, n) * 100) / 100;
}

export function totalWorkedHoursFromTimesheet(ts: DailyTimesheet): number {
  const n = Math.max(0, ts.normalHours || 0);
  const ot =
    (ts.ot15Hours || 0) + (ts.ot20Hours || 0) + (ts.ot30Hours || 0);
  return Math.min(24, n + ot);
}

export interface WorkDayPackageCostInput {
  timesheet: DailyTimesheet;
  costPackagePerDay: number;
  statedHours: StatedPackageHours;
  otAfterShiftMultiplier: number;
  /** ปฏิทิน/ตัวคูณวันหยุดลูกจ้างจาก HR Settings */
  payrollRestSchedule: PayrollRestDaySchedule;
}

export interface WorkDayPackageCostResult {
  amount: number;
  hourlyNormal: number;
  totalWorkedHours: number;
  /** ชม.ปกติในกรอบ 8 ชม.แรก (จากฟิลด์ normalHours) */
  normalPaidHours: number;
  /** ชม.ที่คิดแบบ OT: เกิน 8 ใน normalHours + ot15 + ot20 + ot30 */
  otPaidHours: number;
  restDay: RestDayResolution;
  mode: 'weekday_split' | 'public_holiday_wrap' | 'weekly_rest_split';
}

/**
 * ยอดฐาน: กรอบ 8 ชม.ปกติ + ส่วนเกินใน normal × ตัวคูณ OT สัญญา (เมื่อใช้) + OT แยก tier
 */
function computeBaseWorkAmount(
  h: number,
  otContract: number,
  w: ParsedWorkDayHours,
  overflowMultiplyOtContract: boolean,
): { normalPart: number; overflowPart: number; tierPart: number } {
  const tierPart =
    h *
    (w.o15 * PACKAGE_OT_TIER_MULT.OT_1_5 +
      w.o20 * PACKAGE_OT_TIER_MULT.OT_2_0 +
      w.o30 * PACKAGE_OT_TIER_MULT.OT_3_0);
  const normalPart = w.legalNormal * h;
  const overflowPart =
    w.overflowNormal * h * (overflowMultiplyOtContract ? otContract : 1);
  return { normalPart, overflowPart, tierPart };
}

/**
 * ค่าจ้าง work_day จากแพ็กต้นทุน + ชม.ทำงานจริง
 *
 * - กรอบ 8 ชม.แรกจาก normalHours × ฐานชม.
 * - normalHours เกิน 8: ส่วนเกิน × ฐาน × ตัวคูณ OT สัญญา/PO (โครงเดิมเมื่อไม่แยก tier)
 * - ot15 / ot20 / ot30: × 1.5 / × 2 / × 3 ของฐานชม. (ไม่ซ้อนกับตัวคูณ OT สัญญา — tier เป็นตัวกำหนดอัตราแล้ว)
 * - วันหยุดในปฏิทิน / เสาร์–อาทิตย์ (ฝั่งต้นทุน): ขยายฐานชม.ด้วยตัวคูณสัญญา แล้วคิด 8 ชม. + ส่วนเกินใน normalHours
 *   ที่ **อัตราเดียวกัน** — ไม่ซ้อน otContract กับตัวคูณวันหยุด (กันยอด 4 ชม.ถูกคูณ 1.5 ซ้ำ)
 *   ตัวอย่าง: แพ็ก 12 ชม. ฐาน 100, OT สัญญา 1.5 → วันธรรมดา 1400; อาทิตย์ ×1.5 → 150/ชม. ×12 = 1800
 */
export interface WorkDayPayslipAmountParts {
  gross: number;
  /** ชม.ปกติในกรอบ 8 ชม. (ไม่รวม OT) */
  baseAmount: number;
  otAmount: number;
  ot15Hours: number;
  ot20Hours: number;
  ot30Hours: number;
  overflowNormalHours: number;
  ot15Amount: number;
  ot20Amount: number;
  ot30Amount: number;
  /** OT จาก normalHours เกิน 8 (แพ็ก 8 ชม. / onshore) */
  overflowOtAmount: number;
  /** OT จาก normalHours เกิน 12 (แพ็ก 12 ชม. / offshore) */
  overflowBeyond12Hours?: number;
  overflowBeyond12Amount?: number;
  restDay: RestDayResolution;
}

function resolveWorkDayHourlyAndParts(
  input: WorkDayPackageCostInput,
): {
  baseH: number;
  effectiveH: number;
  w: ParsedWorkDayHours;
  rest: RestDayResolution;
  otContract: number;
  overflowMultiplyOtContract: boolean;
  mode: WorkDayPackageCostResult['mode'];
} {
  const baseH = deriveCostNormalHourlyRate({
    costPackagePerDay: input.costPackagePerDay,
    statedHours: input.statedHours,
    otAfterShiftMultiplier: input.otAfterShiftMultiplier,
  });
  const w = parseWorkDayHours(input.timesheet);
  const rest = resolvePayrollRestDay(input.timesheet.date, input.payrollRestSchedule);
  const otContract = Math.max(0, input.otAfterShiftMultiplier);

  if (!rest.active) {
    return {
      baseH,
      effectiveH: baseH,
      w,
      rest,
      otContract,
      overflowMultiplyOtContract: true,
      mode: 'weekday_split',
    };
  }
  if (rest.kind === 'public_holiday') {
    const mult = Math.max(0, rest.publicHolidayWrap ?? 1);
    return {
      baseH,
      effectiveH: baseH * mult,
      w,
      rest,
      otContract,
      overflowMultiplyOtContract: false,
      mode: 'public_holiday_wrap',
    };
  }
  const sm = Math.max(0, rest.weeklyNormalMult ?? 1);
  return {
    baseH,
    effectiveH: baseH * sm,
    w,
    rest,
    otContract,
    overflowMultiplyOtContract: false,
    mode: 'weekly_rest_split',
  };
}

/** แพ็ก offshore — ชม.ในแพ็กตามสัญญา (ค่าแรงรายวัน = ราคาเต็มแพ็ก ไม่แยก 8+4) */
export const OFFSHORE_PACKAGE_HOURS = 12 as const;

/** แยกยอด work_day เป็นค่าแรงฐาน vs OT สำหรับสลิป */
export function computeWorkDayPayslipAmountParts(
  input: WorkDayPackageCostInput,
): WorkDayPayslipAmountParts {
  const { effectiveH, w, rest, otContract, overflowMultiplyOtContract } =
    resolveWorkDayHourlyAndParts(input);
  const { normalPart, overflowPart } = computeBaseWorkAmount(
    effectiveH,
    otContract,
    w,
    overflowMultiplyOtContract,
  );
  const ot15Amount = roundMoney(effectiveH * w.o15 * PACKAGE_OT_TIER_MULT.OT_1_5);
  const ot20Amount = roundMoney(effectiveH * w.o20 * PACKAGE_OT_TIER_MULT.OT_2_0);
  const ot30Amount = roundMoney(effectiveH * w.o30 * PACKAGE_OT_TIER_MULT.OT_3_0);

  let baseAmount: number;
  let overflowOtAmount = 0;
  let overflowNormalHours = 0;
  let overflowBeyond12Hours = 0;
  let overflowBeyond12Amount = 0;

  if (input.statedHours === OFFSHORE_PACKAGE_HOURS) {
    /** แพ็ก 12 ชม.: ค่าแรงรายวัน = ราคาแพ็กเต็ม (ชม. 1–12) · แยก OT เฉพาะ normalHours เกิน 12 */
    const hoursBeyond12 = Math.max(0, w.nh - OFFSHORE_PACKAGE_HOURS);
    overflowBeyond12Hours = hoursBeyond12;
    overflowBeyond12Amount = roundMoney(
      hoursBeyond12 * effectiveH * (overflowMultiplyOtContract ? otContract : 1),
    );
    baseAmount = roundMoney(normalPart + overflowPart - overflowBeyond12Amount);
  } else {
    baseAmount = roundMoney(normalPart);
    overflowOtAmount = roundMoney(overflowPart);
    overflowNormalHours = w.overflowNormal;
  }

  const otAmount = roundMoney(
    overflowOtAmount + overflowBeyond12Amount + ot15Amount + ot20Amount + ot30Amount,
  );
  const gross = roundMoney(baseAmount + otAmount);

  return {
    gross,
    baseAmount,
    otAmount,
    ot15Hours: w.o15,
    ot20Hours: w.o20,
    ot30Hours: w.o30,
    overflowNormalHours,
    ot15Amount,
    ot20Amount,
    ot30Amount,
    overflowOtAmount,
    overflowBeyond12Hours,
    overflowBeyond12Amount,
    restDay: rest,
  };
}

export function computeWorkDayCostFromPackage(
  input: WorkDayPackageCostInput,
): WorkDayPackageCostResult {
  const { baseH, w, rest, mode } = resolveWorkDayHourlyAndParts(input);
  const parts = computeWorkDayPayslipAmountParts(input);
  const T = Math.min(24, w.nh + w.o15 + w.o20 + w.o30);
  const otPaidHours = w.overflowNormal + w.tierOtHours;

  return {
    amount: parts.gross,
    hourlyNormal: baseH,
    totalWorkedHours: T,
    normalPaidHours: w.legalNormal,
    otPaidHours,
    restDay: rest,
    mode,
  };
}
