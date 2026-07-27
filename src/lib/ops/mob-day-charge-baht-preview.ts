/**
 * ประมาณการบาทตอนแก้ชม. M1/D1/SB — ใช้โชว์ใน UI (Mob / จบงาน D1 / แก้รายเดือน)
 *
 * STANDBY ตามชม.:
 * - ชม.ครบแพ็ก → ใช้เรท SB ทั้งวัน (เช่น 700)
 * - ชม.น้อยกว่าแพ็ก → ใช้ hourly จากวันทำงาน × standby 0.5 × ชม. (เช่น 8 → 400 จากฐาน 1400/14)
 *
 * M1/D1 trip: เรทต่อทริปจากสัญญา (หรือจำนวนเงินที่พิมพ์ทับ) — ชม.ไม่กระทบยอดทริป
 */
import type { MobDayChargeKind, MobDayChargeSpec, PositionRate } from '@/lib/types';
import { derivePackageNormalHourlyRate } from '@/lib/commercial/package-hourly-rate';
import { resolveMatrixCostRate, resolveMatrixSellRate } from '@/lib/commercial/position-rate-matrix';
import { normalizeMobDayChargeSpec } from '@/lib/ops/mob-day-charge';

export type MobDayChargeBahtPreviewRates = {
  /** เรทวันทำงานฝั่งขาย (เช่น 1,400) */
  sellWorkingDayRate: number;
  /** เรทวันทำงานฝั่งต้นทุน */
  costWorkingDayRate: number;
  /** เรท SB ทั้งวันฝั่งขาย (matrix หรือ working×0.5) */
  sellStandbyDayRate: number;
  /** เรท SB ทั้งวันฝั่งต้นทุน */
  costStandbyDayRate: number;
  /** เรท M1 ต่อทริปฝั่งขาย — 0 = ไม่มี */
  sellM1TripRate: number;
  /** เรท M1 ต่อทริปฝั่งต้นทุน — 0 = ไม่จ่าย */
  costM1TripRate: number;
  /** เรท D1 ต่อทริปฝั่งขาย */
  sellD1TripRate: number;
  /** เรท D1 ต่อทริปฝั่งต้นทุน */
  costD1TripRate: number;
  packageHours: 8 | 12;
  otAfterShiftMultiplier?: number;
  standbyMultiplier?: number;
};

function roundMoney(n: number): number {
  return Math.round(Math.max(0, n) * 100) / 100;
}

function previewStandbyBaht(
  fullDaySbRate: number,
  workingDayRate: number,
  hours: number,
  packageHours: 8 | 12,
  otMult: number,
  standbyMult: number,
): number {
  const h = Math.max(0, Math.min(24, hours));
  const full =
    fullDaySbRate > 0
      ? fullDaySbRate
      : workingDayRate > 0
        ? workingDayRate * standbyMult
        : 0;
  if (full <= 0) return 0;
  if (h >= packageHours - 1e-9) return roundMoney(full);

  const baseWorking = workingDayRate > 0 ? workingDayRate : full / Math.max(1e-9, standbyMult);
  const hourly = derivePackageNormalHourlyRate(baseWorking, packageHours, otMult);
  return roundMoney(hourly * standbyMult * h);
}

/** ประมาณการบาทของสเปกหนึ่งฝั่ง (ขายหรือจ่าย) */
export function previewMobDayChargeBaht(
  draft: MobDayChargeSpec | null | undefined,
  rates: MobDayChargeBahtPreviewRates,
  side: 'billing' | 'payroll',
): { amount: number; note: string } {
  const pkg = rates.packageHours;
  const n = normalizeMobDayChargeSpec(draft, pkg);
  const hours = Math.max(0.5, Number(n.hours ?? pkg) || pkg);
  const otMult = Number(rates.otAfterShiftMultiplier) > 0 ? Number(rates.otAfterShiftMultiplier) : 1.5;
  const sbMult = Number(rates.standbyMultiplier) > 0 ? Number(rates.standbyMultiplier) : 0.5;

  if (n.kind === 'M1' || n.kind === 'D1') {
    if (n.m1AmountOverride != null && n.m1AmountOverride > 0) {
      return {
        amount: roundMoney(n.m1AmountOverride),
        note: 'จำนวนที่ระบุทับ',
      };
    }
    const trip =
      n.kind === 'D1'
        ? side === 'billing'
          ? rates.sellD1TripRate
          : rates.costD1TripRate
        : side === 'billing'
          ? rates.sellM1TripRate
          : rates.costM1TripRate;
    if (trip > 0) {
      return {
        amount: roundMoney(trip),
        note: 'ตามตารางสัญญา (ทริป) — ชม.ไม่กระทบยอด',
      };
    }
    if (side === 'payroll') {
      return { amount: 0, note: 'ต้นทุนไม่มีเรท — ไม่จ่าย' };
    }
    return { amount: 0, note: 'ยังไม่มีเรทในสัญญา' };
  }

  if (n.kind === 'WORKING') {
    const day = side === 'billing' ? rates.sellWorkingDayRate : rates.costWorkingDayRate;
    if (day <= 0) return { amount: 0, note: 'ยังไม่มีเรทวันทำงาน' };
    if (hours >= pkg - 1e-9) {
      return { amount: roundMoney(day), note: `วันทำงานเต็มแพ็ก ${pkg} ชม.` };
    }
    const hourly = derivePackageNormalHourlyRate(day, pkg, otMult);
    return {
      amount: roundMoney(hourly * hours),
      note: `ประมาณจากชม. (${hours}/${pkg})`,
    };
  }

  // STANDBY
  const fullSb = side === 'billing' ? rates.sellStandbyDayRate : rates.costStandbyDayRate;
  const working = side === 'billing' ? rates.sellWorkingDayRate : rates.costWorkingDayRate;
  const amount = previewStandbyBaht(fullSb, working, hours, pkg, otMult, sbMult);
  if (amount <= 0) {
    return {
      amount: 0,
      note: side === 'payroll' ? 'ต้นทุนไม่มีเรท — ไม่จ่าย' : 'ยังไม่มีเรท SB',
    };
  }
  if (hours >= pkg - 1e-9) {
    return { amount, note: `SB เต็มแพ็ก ${pkg} ชม.` };
  }
  return {
    amount,
    note: `SB ตามชม. (${hours} จากฐาน ${pkg})`,
  };
}

export function formatBahtPreview(amount: number): string {
  return amount.toLocaleString('th-TH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/** สร้างเรทสำหรับ preview จาก position rate matrix + วันทำงาน */
export function buildMobDayChargeBahtPreviewRates(input: {
  packageHours: 8 | 12;
  positionRate?: PositionRate | null;
  sellWorkingDayRate?: number;
  costWorkingDayRate?: number;
  otAfterShiftMultiplier?: number;
  standbyMultiplier?: number;
  workMode?: string | null;
}): MobDayChargeBahtPreviewRates {
  const pkg = input.packageHours;
  const mode = String(input.workMode || '').toUpperCase();
  const offshore = mode !== 'ONSHORE' && mode !== 'ON';
  const rate = input.positionRate ?? null;

  const sellWorking = Math.max(0, Number(input.sellWorkingDayRate) || 0);
  const costWorking = Math.max(0, Number(input.costWorkingDayRate) || 0);
  const sbMult = Number(input.standbyMultiplier) > 0 ? Number(input.standbyMultiplier) : 0.5;

  const sellSbMatrix = rate
    ? resolveMatrixSellRate(rate, offshore ? 'offshore_standby_day' : 'onshore_standby_day')
    : null;
  const costSbMatrix = rate
    ? resolveMatrixCostRate(rate, offshore ? 'offshore_standby_day' : 'onshore_standby_day')
    : null;

  const sellM1 = rate && offshore ? resolveMatrixSellRate(rate, 'offshore_m1_per_trip') : null;
  const costM1 = rate && offshore ? resolveMatrixCostRate(rate, 'offshore_m1_per_trip') : null;
  const sellD1 = rate && offshore ? resolveMatrixSellRate(rate, 'offshore_d1_per_trip') : null;
  const costD1 = rate && offshore ? resolveMatrixCostRate(rate, 'offshore_d1_per_trip') : null;

  return {
    sellWorkingDayRate: sellWorking,
    costWorkingDayRate: costWorking,
    sellStandbyDayRate:
      sellSbMatrix != null && sellSbMatrix > 0 ? sellSbMatrix : sellWorking > 0 ? sellWorking * sbMult : 0,
    costStandbyDayRate:
      costSbMatrix != null && costSbMatrix > 0 ? costSbMatrix : costWorking > 0 ? costWorking * sbMult : 0,
    sellM1TripRate: sellM1 != null && sellM1 > 0 ? sellM1 : 0,
    costM1TripRate: costM1 != null && costM1 > 0 ? costM1 : 0,
    sellD1TripRate: sellD1 != null && sellD1 > 0 ? sellD1 : 0,
    costD1TripRate: costD1 != null && costD1 > 0 ? costD1 : 0,
    packageHours: pkg,
    otAfterShiftMultiplier: input.otAfterShiftMultiplier,
    standbyMultiplier: sbMult,
  };
}

export function previewNoteForKind(kind: MobDayChargeKind): string {
  if (kind === 'M1' || kind === 'D1') return 'ทริปตามสัญญา';
  if (kind === 'WORKING') return 'วันทำงาน';
  return 'Standby ตามชม.';
}
