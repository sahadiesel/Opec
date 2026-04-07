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

export interface RestDayResolution {
  active: boolean;
  kind: 'none' | 'public_holiday' | 'weekly_rest';
  /**
   * วันหยุดในปฏิทินสัญญา (ฝั่งต้นทุน): คูณทั้งยอดหลังแยก 8 ชม. + OT ตามกฎหมาย
   * (ใช้ rateMultiplierPolicy.cost.publicHoliday)
   */
  publicHolidayWrap?: number;
  /**
   * เสาร์–อาทิตย์ / อาทิตย์อย่างเดียว: ตัวคูณชม.ในกรอบ 8 ชม.แรก (Sunday)
   */
  weeklyNormalMult?: number;
  /**
   * ชม.เกิน 8: ฐาน × ตัวคูณ OT สัญญา × ค่านี้ (Sunday OT — ถ้าว่างใช้เท่า Sunday)
   */
  weeklyOtMult?: number;
}

/**
 * วันหยุดตามปฏิทินสัญญา (contractCostCalendarHolidays) หรือ weekly rest (contractCostWeeklyRestPattern)
 * ตัวคูณอ่านจาก rateMultiplierPolicy.cost ตามที่กำหนดในหน้าสัญญา
 */
export function resolveCostRestDay(
  dateStr: string,
  contract: MainContract | undefined,
): RestDayResolution {
  const cost = contract?.rateMultiplierPolicy?.cost;
  if (!cost) return { active: false, kind: 'none' };

  const holidays = contract.contractCostCalendarHolidays || [];
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

  const pattern = contract.contractCostWeeklyRestPattern || 'none';
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

  return { active: false, kind: 'none' };
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
  mainContract: MainContract | undefined;
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
 * ยอดฐานก่อนคูณวันหยุด: กรอบ 8 ชม.ปกติ + ส่วนเกินใน normal × ตัวคูณ OT สัญญา + OT แยก tier
 */
function computeBaseWorkAmount(
  h: number,
  otContract: number,
  w: ParsedWorkDayHours,
): { normalPart: number; overflowPart: number; tierPart: number } {
  const tierPart =
    h *
    (w.o15 * PACKAGE_OT_TIER_MULT.OT_1_5 +
      w.o20 * PACKAGE_OT_TIER_MULT.OT_2_0 +
      w.o30 * PACKAGE_OT_TIER_MULT.OT_3_0);
  const normalPart = w.legalNormal * h;
  const overflowPart = w.overflowNormal * h * otContract;
  return { normalPart, overflowPart, tierPart };
}

/**
 * ค่าจ้าง work_day จากแพ็กต้นทุน + ชม.ทำงานจริง
 *
 * - กรอบ 8 ชม.แรกจาก normalHours × ฐานชม.
 * - normalHours เกิน 8: ส่วนเกิน × ฐาน × ตัวคูณ OT สัญญา/PO (โครงเดิมเมื่อไม่แยก tier)
 * - ot15 / ot20 / ot30: × 1.5 / × 2 / × 3 ของฐานชม. (ไม่ซ้อนกับตัวคูณ OT สัญญา — tier เป็นตัวกำหนดอัตราแล้ว)
 * - วันหยุดในปฏิทิน: คูณทั้งยอดฐาน × publicHoliday
 * - เสาร์–อาทิตย์: ส่วนปกติ × Sunday; ส่วน overflow + ทุก tier × Sunday OT
 */
export function computeWorkDayCostFromPackage(
  input: WorkDayPackageCostInput,
): WorkDayPackageCostResult {
  const h = deriveCostNormalHourlyRate({
    costPackagePerDay: input.costPackagePerDay,
    statedHours: input.statedHours,
    otAfterShiftMultiplier: input.otAfterShiftMultiplier,
  });

  const w = parseWorkDayHours(input.timesheet);
  const T = Math.min(24, w.nh + w.o15 + w.o20 + w.o30);
  const rest = resolveCostRestDay(input.timesheet.date, input.mainContract);
  const otContract = Math.max(0, input.otAfterShiftMultiplier);

  const { normalPart, overflowPart, tierPart } = computeBaseWorkAmount(
    h,
    otContract,
    w,
  );

  let baseAmount: number;
  let mode: WorkDayPackageCostResult['mode'];

  if (!rest.active) {
    baseAmount = normalPart + overflowPart + tierPart;
    mode = 'weekday_split';
  } else if (rest.kind === 'public_holiday') {
    const wrap = Math.max(0, rest.publicHolidayWrap ?? 1);
    baseAmount = (normalPart + overflowPart + tierPart) * wrap;
    mode = 'public_holiday_wrap';
  } else {
    const nM = Math.max(0, rest.weeklyNormalMult ?? 1);
    const oM = Math.max(0, rest.weeklyOtMult ?? 1);
    baseAmount =
      normalPart * nM +
      overflowPart * oM +
      tierPart * oM;
    mode = 'weekly_rest_split';
  }

  const amount = roundMoney(baseAmount);
  const otPaidHours = w.overflowNormal + w.tierOtHours;

  return {
    amount,
    hourlyNormal: h,
    totalWorkedHours: T,
    normalPaidHours: w.legalNormal,
    otPaidHours,
    restDay: rest,
    mode,
  };
}
