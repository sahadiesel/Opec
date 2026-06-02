import type { JobMode, POLine, PositionRate } from '@/lib/types';

export const DEFAULT_NORMAL_WORK_HOURS_ONSHORE = 8 as const;
export const DEFAULT_NORMAL_WORK_HOURS_OFFSHORE = 12 as const;

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

type SellDual = Pick<PositionRate, 'sellRate' | 'sellRateOnshore' | 'sellRateOffshore'>;

/** Effective sell for ONshore — explicit override else legacy single `sellRate`. */
export function effectiveSellOnshore(rate: Partial<SellDual>): number {
  const on = Number(rate.sellRateOnshore);
  if (Number.isFinite(on) && on > 0) return on;
  return Number(rate.sellRate) || 0;
}

/** Effective sell for OFFshore — explicit override else legacy single `sellRate`. */
export function effectiveSellOffshore(rate: Partial<SellDual>): number {
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

type LineSellSnap = Pick<POLine, 'sellRateSnapshot' | 'sellRateSnapshotOnshore' | 'sellRateSnapshotOffshore'>;

/** PO line sell unit for billing/payroll from timesheet work mode. */
export function sellSnapshotForWorkMode(line: Partial<LineSellSnap>, mode: JobMode): number {
  const legacy = Number(line.sellRateSnapshot) || 0;
  const rawOn = Number(line.sellRateSnapshotOnshore);
  const rawOff = Number(line.sellRateSnapshotOffshore);
  const onEff = Number.isFinite(rawOn) && rawOn > 0 ? rawOn : legacy;
  const offEff = Number.isFinite(rawOff) && rawOff > 0 ? rawOff : legacy;
  if (mode === 'OFFSHORE') return offEff > 0 ? offEff : onEff;
  return onEff > 0 ? onEff : offEff;
}
