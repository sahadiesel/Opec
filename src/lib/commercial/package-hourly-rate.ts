/**
 * ฐานชม.ปกติจากแพ็กรายวัน (8 หรือ 12 ชม.) + ตัวคูณ OT — ใช้ร่วม billing / payroll
 *
 * ## มาตรฐานแพ็กออฟชอร์ 12 ชม. (ยึดใช้ทั้งระบบ)
 * ราคาวัน D ประกอบด้วย **8 ชม.ปกติ + 4 ชม.OT**:
 *   D = baseH×8 + (baseH×otMult)×4 = baseH × (8 + 4×otMult)
 * เมื่อ otMult = 1.5 → ตัวหาร = 14 → baseH = D/14, OT1.5/ชม. = D×1.5/14
 * ตัวอย่าง: D=1,400 → baseH=100, OT=150/ชม. · D=1,700 → baseH≈121.43, OT≈182.14/ชม.
 *
 * เมื่อทะเบียนลูกจ้างระบุฐานออฟชอร์เอง (ไม่ใช้ตารางสัญญา) ให้คำนวณ OT จากสูตรนี้
 */

export const LEGAL_NORMAL_HOURS_PER_DAY = 8;

export type StatedPackageHours = 8 | 12;

/** ตัวคูณ OT ตาม tier บน timesheet (× ฐานชม.จากแพ็ก) */
export const PACKAGE_OT_TIER_MULT = {
  OT_1_5: 1.5,
  OT_2_0: 2,
  OT_3_0: 3,
} as const;

/** ตัวหารแพ็ก 12 ชม. เมื่อ OT ในแพ็กใช้ตัวคูณ 1.5 → 8 + 4×1.5 = 14 */
export function offshorePackageHourDenominator(otMultiplier: number = PACKAGE_OT_TIER_MULT.OT_1_5): number {
  const ot = Math.max(0, otMultiplier);
  return LEGAL_NORMAL_HOURS_PER_DAY + (12 - LEGAL_NORMAL_HOURS_PER_DAY) * ot;
}

/**
 * - แพ็ก 8 ชม.: แพ็ก / 8
 * - แพ็ก 12 ชม.: แพ็ก / (8 + 4×ot) เพราะ 12 = 8 normal + 4 OT ตามมาตรฐาน OPEC
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

  const denom = offshorePackageHourDenominator(ot);
  if (denom <= 0) return 0;
  return pkg / denom;
}

/** อัตรา OT ต่อชม. จากแพ็กรายวันออฟชอร์ (หรือออนชอร์ 8 ชม.) — ใช้เมื่อยึดฐานจากทะเบียนลูกจ้าง */
export function deriveOtHourlyRatesFromDailyPackage(
  packagePerDay: number,
  statedHours: StatedPackageHours,
  otAfterShiftMultiplier: number = PACKAGE_OT_TIER_MULT.OT_1_5,
): {
  normalHourly: number;
  ot15Hourly: number;
  ot20Hourly: number;
  ot30Hourly: number;
} {
  const normalHourly = derivePackageNormalHourlyRate(packagePerDay, statedHours, otAfterShiftMultiplier);
  return {
    normalHourly,
    ot15Hourly: normalHourly * PACKAGE_OT_TIER_MULT.OT_1_5,
    ot20Hourly: normalHourly * PACKAGE_OT_TIER_MULT.OT_2_0,
    ot30Hourly: normalHourly * PACKAGE_OT_TIER_MULT.OT_3_0,
  };
}
