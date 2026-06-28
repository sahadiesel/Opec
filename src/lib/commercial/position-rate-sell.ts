import type { JobMode, POLine, PositionRate, PositionRateMatrix, RateConditionEventType } from '@/lib/types';

export const DEFAULT_NORMAL_WORK_HOURS_ONSHORE = 8 as const;
export const DEFAULT_NORMAL_WORK_HOURS_OFFSHORE = 12 as const;

function parsePositive(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function sellMatrixSide(
  matrix: PositionRateMatrix | undefined,
  mode: JobMode,
): { workingDay?: number; standbyDay?: number; m1PerTrip?: number; d1PerTrip?: number; otPerHour?: number } | undefined {
  if (!matrix?.sell) return undefined;
  return mode === 'OFFSHORE' ? matrix.sell.offshore : matrix.sell.onshore;
}

type NormalHoursDual = Pick<
  PositionRate,
  'normalWorkHours' | 'normalWorkHoursOnshore' | 'normalWorkHoursOffshore'
>;

/** ชม.ปกติ/วัน Onshore — default 8 */
export function effectiveNormalWorkHoursOnshore(rate: Partial<NormalHoursDual>): 8 | 12 {
  const on = Number(rate.normalWorkHoursOnshore);
  if (on === 8 || on === 12) return on;
  return DEFAULT_NORMAL_WORK_HOURS_ONSHORE;
}

/** ชม.ปกติ/วัน Offshore — explicit override else legacy single field else 12 */
export function effectiveNormalWorkHoursOffshore(rate: Partial<NormalHoursDual>): 8 | 12 {
  const off = Number(rate.normalWorkHoursOffshore);
  if (off === 8 || off === 12) return off;
  const legacy = rate.normalWorkHours;
  if (legacy === 8 || legacy === 12) return legacy;
  return DEFAULT_NORMAL_WORK_HOURS_OFFSHORE;
}

/** Legacy `normalWorkHours` — mirror offshore effective for older readers */
export function legacyNormalWorkHoursMirror(rate: Partial<NormalHoursDual>): 8 | 12 {
  return effectiveNormalWorkHoursOffshore(rate);
}

export function normalizeNormalWorkHoursFields(rate: Partial<NormalHoursDual>): {
  normalWorkHoursOnshore: 8 | 12;
  normalWorkHoursOffshore: 8 | 12;
  normalWorkHours: 8 | 12;
} {
  const normalWorkHoursOnshore = effectiveNormalWorkHoursOnshore(rate);
  const normalWorkHoursOffshore = effectiveNormalWorkHoursOffshore({
    ...rate,
    normalWorkHoursOnshore,
  });
  return {
    normalWorkHoursOnshore,
    normalWorkHoursOffshore,
    normalWorkHours: legacyNormalWorkHoursMirror({ normalWorkHoursOnshore, normalWorkHoursOffshore }),
  };
}

type SellDual = Pick<PositionRate, 'sellRate' | 'sellRateOnshore' | 'sellRateOffshore' | 'rateMatrix'>;

/** Effective sell for ONshore — matrix working day, then explicit override, then legacy single `sellRate`. */
export function effectiveSellOnshore(rate: Partial<SellDual>): number {
  const fromMatrix = parsePositive(rate.rateMatrix?.sell?.onshore?.workingDay);
  if (fromMatrix != null) return fromMatrix;
  const on = Number(rate.sellRateOnshore);
  if (Number.isFinite(on) && on > 0) return on;
  return Number(rate.sellRate) || 0;
}

/** Effective sell for OFFshore — matrix working day, then explicit override, then legacy single `sellRate`. */
export function effectiveSellOffshore(rate: Partial<SellDual>): number {
  const fromMatrix = parsePositive(rate.rateMatrix?.sell?.offshore?.workingDay);
  if (fromMatrix != null) return fromMatrix;
  const off = Number(rate.sellRateOffshore);
  if (Number.isFinite(off) && off > 0) return off;
  return Number(rate.sellRate) || 0;
}

/**
 * Legacy `sellRate` on PositionRate / snapshot on POLine — prefer onshore effective, then offshore.
 * Keeps older readers (single field) aligned when dual rates exist.
 */
export function legacySellRateMirror(rate: Partial<SellDual>): number {
  const on = effectiveSellOnshore(rate);
  if (on > 0) return on;
  return effectiveSellOffshore(rate);
}

type LineSellSnap = Pick<
  POLine,
  'sellRateSnapshot' | 'sellRateSnapshotOnshore' | 'sellRateSnapshotOffshore' | 'rateMatrixSnapshot'
>;

function sellWorkingDayFromMatrix(
  matrix: PositionRateMatrix | undefined,
  mode: JobMode,
): number | undefined {
  const side = sellMatrixSide(matrix, mode);
  return parsePositive(side?.workingDay);
}

/** PO line sell unit for billing/payroll from timesheet work mode. */
export function sellSnapshotForWorkMode(line: Partial<LineSellSnap>, mode: JobMode): number {
  const fromPoMatrix = sellWorkingDayFromMatrix(line.rateMatrixSnapshot, mode);
  if (fromPoMatrix != null) return fromPoMatrix;

  const legacy = Number(line.sellRateSnapshot) || 0;
  const rawOn = Number(line.sellRateSnapshotOnshore);
  const rawOff = Number(line.sellRateSnapshotOffshore);
  const onEff = Number.isFinite(rawOn) && rawOn > 0 ? rawOn : legacy;
  const offEff = Number.isFinite(rawOff) && rawOff > 0 ? rawOff : legacy;
  if (mode === 'OFFSHORE') return offEff > 0 ? offEff : onEff;
  return onEff > 0 ? onEff : offEff;
}

export type BillingSellRateContext = {
  poLine: Partial<LineSellSnap>;
  workMode: JobMode;
  contractRate?: Partial<SellDual>;
};

/** ราคารายวัน work_day — อ้างอิง rate matrix สัญญาก่อน snapshot บน PO line */
export function resolveBillingSellWorkingDayRate(ctx: BillingSellRateContext): number {
  const fromPoMatrix = sellWorkingDayFromMatrix(ctx.poLine.rateMatrixSnapshot, ctx.workMode);
  if (fromPoMatrix != null) return fromPoMatrix;

  if (ctx.contractRate) {
    const fromContractMatrix = sellWorkingDayFromMatrix(ctx.contractRate.rateMatrix, ctx.workMode);
    if (fromContractMatrix != null) return fromContractMatrix;
    const fromContract =
      ctx.workMode === 'OFFSHORE'
        ? effectiveSellOffshore(ctx.contractRate)
        : effectiveSellOnshore(ctx.contractRate);
    if (fromContract > 0) return fromContract;
  }

  return sellSnapshotForWorkMode(ctx.poLine, ctx.workMode);
}

/** ราคา flat ต่อวัน/ต่อ trip จาก matrix (M1/D1/SB) — null = ใช้ working-day snapshot × multiplier */
export function resolveBillingMatrixEventDayRate(
  ctx: BillingSellRateContext,
  eventType: RateConditionEventType,
): number | null {
  const matrices = [ctx.poLine.rateMatrixSnapshot, ctx.contractRate?.rateMatrix].filter(Boolean) as PositionRateMatrix[];
  for (const matrix of matrices) {
    const side = sellMatrixSide(matrix, ctx.workMode);
    if (!side) continue;
    if (eventType === 'mobilization_day') {
      const v = parsePositive(side.m1PerTrip);
      if (v != null) return v;
    }
    if (eventType === 'demobilization_day') {
      const v = parsePositive(side.d1PerTrip);
      if (v != null) return v;
    }
    if (eventType === 'standby_day') {
      const v = parsePositive(side.standbyDay);
      if (v != null) return v;
    }
  }
  return null;
}

/** อัตรา OT ต่อชม. จาก matrix — null = คำนวณจากราคารายวัน ÷ ชม.แพ็ก */
export function resolveBillingMatrixOtHourlyRate(ctx: BillingSellRateContext): number | null {
  const matrices = [ctx.poLine.rateMatrixSnapshot, ctx.contractRate?.rateMatrix].filter(Boolean) as PositionRateMatrix[];
  for (const matrix of matrices) {
    const side = sellMatrixSide(matrix, ctx.workMode);
    if (!side) continue;
    if (ctx.workMode === 'OFFSHORE') {
      const v = parsePositive(side.otPerHour);
      if (v != null) return v;
    } else {
      const v = parsePositive((side as { otNormalPerHour?: number }).otNormalPerHour);
      if (v != null) return v;
    }
  }
  return null;
}

export function jobModeSellLabel(mode: JobMode): 'Onshore' | 'Offshore' {
  return mode === 'ONSHORE' ? 'Onshore' : 'Offshore';
}

/** Snapshot fields for a new/updated PO line — primary `sellRateSnapshot` follows PO work mode. */
export function buildPoLineSellSnapshots(
  rate: Partial<SellDual>,
  poWorkMode: JobMode,
): {
  sellRateSnapshot: number;
  sellRateSnapshotOnshore?: number;
  sellRateSnapshotOffshore?: number;
} {
  const snapOn = effectiveSellOnshore(rate);
  const snapOff = effectiveSellOffshore(rate);
  const partial: Partial<LineSellSnap> = {
    sellRateSnapshot: legacySellRateMirror(rate),
  };
  if (snapOn > 0) partial.sellRateSnapshotOnshore = snapOn;
  if (snapOff > 0) partial.sellRateSnapshotOffshore = snapOff;
  return {
    sellRateSnapshot: sellSnapshotForWorkMode(partial, poWorkMode),
    ...(snapOn > 0 ? { sellRateSnapshotOnshore: snapOn } : {}),
    ...(snapOff > 0 ? { sellRateSnapshotOffshore: snapOff } : {}),
  };
}
