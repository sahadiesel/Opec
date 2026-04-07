/**
 * Payroll labor cost from PO / position **cost package** (ต้นทุนต่อวัน) + ชม.ในแพ็ก (8|12)
 * + ตัวคูณ OT ฝั่งต้นทุน — สอดคล้องกับกฎหมายไทย (normal สูงสุด 8 ชม./วัน วันทำงานปกติ)
 */

import type { DailyTimesheet, MainContract } from '@/lib/types';

/** ชม.ทำงานปกติตามกฎหมายแรงงาน (วันทำงานทั่วไป) */
export const THAI_LEGAL_NORMAL_HOURS_PER_DAY = 8;

export type StatedPackageHours = 8 | 12;

export interface DeriveHourlyInput {
  /** ต้นทุนรายวันตามแพ็ก (เช่น costBaselineSnapshot) */
  costPackagePerDay: number;
  /** แพ็กระบุว่าเป็นต่อ 8 หรือ 12 ชม. */
  statedHours: StatedPackageHours;
  /** ตัวคูณ OT หลังเลิกกะ (ฝั่งต้นทุน) เช่น 1, 1.5, 2 */
  otAfterShiftMultiplier: number;
}

/**
 * ฐานค่าจ้างต่อชม.ปกติ (ก่อนคูณวันพิเศษ)
 * - แพ็ก 8 ชม.: แพ็ก / 8
 * - แพ็ก 12 ชม.: แพ็ก / (8 + 4×ot) เพราะ 12 = 8 normal + 4 OT ตามกฎหมาย
 */
export function deriveCostNormalHourlyRate(input: DeriveHourlyInput): number {
  const pkg = Math.max(0, input.costPackagePerDay);
  if (pkg <= 0) return 0;

  const ot = Math.max(0, input.otAfterShiftMultiplier);

  if (input.statedHours === 8) {
    return pkg / THAI_LEGAL_NORMAL_HOURS_PER_DAY;
  }

  // แพ็ก 12 ชม. = 8 ชม.ปกติ + (12−8) ชม. OT
  const otHoursInPackage = 12 - THAI_LEGAL_NORMAL_HOURS_PER_DAY;
  const denom =
    THAI_LEGAL_NORMAL_HOURS_PER_DAY + otHoursInPackage * ot;
  if (denom <= 0) return 0;
  return pkg / denom;
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
  normalPaidHours: number;
  otPaidHours: number;
  restDay: RestDayResolution;
  mode: 'weekday_split' | 'public_holiday_wrap' | 'weekly_rest_split';
}

/**
 * ค่าจ้าง work_day จากแพ็กต้นทุน + ชม.ทำงานจริง
 *
 * - วันปกติ: 8 ชม.แรก × ฐานชม. + เกิน × ฐาน × ตัวคูณ OT (สัญญา/PO)
 * - วันหยุดในปฏิทินสัญญา: (ยอดแบบวันปกติ) × publicHoliday
 * - เสาร์–อาทิตย์ / อาทิตย์: 8 ชม.แรก × ฐาน × Sunday + เกิน × ฐาน × OT × Sunday OT
 */
export function computeWorkDayCostFromPackage(
  input: WorkDayPackageCostInput,
): WorkDayPackageCostResult {
  const h = deriveCostNormalHourlyRate({
    costPackagePerDay: input.costPackagePerDay,
    statedHours: input.statedHours,
    otAfterShiftMultiplier: input.otAfterShiftMultiplier,
  });

  const T = totalWorkedHoursFromTimesheet(input.timesheet);
  const rest = resolveCostRestDay(input.timesheet.date, input.mainContract);

  const cap = THAI_LEGAL_NORMAL_HOURS_PER_DAY;
  const normalPaid = Math.min(T, cap);
  const otPaid = Math.max(0, T - cap);
  const otMult = Math.max(0, input.otAfterShiftMultiplier);

  let baseAmount: number;
  let mode: WorkDayPackageCostResult['mode'];

  if (!rest.active) {
    baseAmount = normalPaid * h + otPaid * h * otMult;
    mode = 'weekday_split';
  } else if (rest.kind === 'public_holiday') {
    const wrap = Math.max(0, rest.publicHolidayWrap ?? 1);
    baseAmount =
      (normalPaid * h + otPaid * h * otMult) * wrap;
    mode = 'public_holiday_wrap';
  } else {
    const nM = Math.max(0, rest.weeklyNormalMult ?? 1);
    const oM = Math.max(0, rest.weeklyOtMult ?? 1);
    baseAmount =
      normalPaid * h * nM + otPaid * h * otMult * oM;
    mode = 'weekly_rest_split';
  }

  const amount = roundMoney(baseAmount);

  return {
    amount,
    hourlyNormal: h,
    totalWorkedHours: T,
    normalPaid,
    otPaid,
    restDay: rest,
    mode,
  };
}
