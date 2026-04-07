/**
 * ฐานชม.ปกติจากแพ็กรายวัน (8 หรือ 12 ชม.) + ตัวคูณ OT — ใช้ร่วม billing / payroll
 */

export const LEGAL_NORMAL_HOURS_PER_DAY = 8;

export type StatedPackageHours = 8 | 12;

/** ตัวคูณ OT ตาม tier บน timesheet (× ฐานชม.จากแพ็ก) */
export const PACKAGE_OT_TIER_MULT = {
  OT_1_5: 1.5,
  OT_2_0: 2,
  OT_3_0: 3,
} as const;

/**
 * - แพ็ก 8 ชม.: แพ็ก / 8
 * - แพ็ก 12 ชม.: แพ็ก / (8 + 4×ot) เพราะ 12 = 8 normal + 4 OT ตามกฎหมาย
 */
export function derivePackageNormalHourlyRate(
  packagePerDay: number,
  statedHours: StatedPackageHours,
  otMultiplier: number,
): number {
  const pkg = Math.max(0, packagePerDay);
  if (pkg <= 0) return 0;

  const ot = Math.max(0, otMultiplier);

  if (statedHours === 8) {
    return pkg / LEGAL_NORMAL_HOURS_PER_DAY;
  }

  const otHoursInPackage = 12 - LEGAL_NORMAL_HOURS_PER_DAY;
  const denom = LEGAL_NORMAL_HOURS_PER_DAY + otHoursInPackage * ot;
  if (denom <= 0) return 0;
  return pkg / denom;
}
