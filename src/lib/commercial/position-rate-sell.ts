import type { JobMode, POLine, PositionRate } from '@/lib/types';

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
