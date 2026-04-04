import type { Position } from '@/lib/types';

export type PositionDoc = Position & Record<string, unknown>;

/**
 * Firestore เก็บ `positionName` เป็น field หลัก
 * แต่ legacy docs อาจมี positionNameTh / positionNameEn แทน
 */
function resolveName(pos: PositionDoc): string {
  const single = String(pos.positionName ?? '').trim();
  if (single) return single;
  const th = String(pos.positionNameTh ?? '').trim();
  if (th) return th;
  const en = String(pos.positionNameEn ?? '').trim();
  if (en) return en;
  return '';
}

export function positionListPrimaryName(pos: PositionDoc): string {
  return resolveName(pos) || pos.positionCode || pos.id;
}

export function positionListSecondaryName(pos: PositionDoc): string | null {
  const primary = String(pos.positionName ?? '').trim();
  const en = String(pos.positionNameEn ?? '').trim();
  const th = String(pos.positionNameTh ?? '').trim();
  if (primary && en && en !== primary) return en;
  if (th && en && en !== th) return en;
  return null;
}

export function positionDetailHeadline(pos: PositionDoc): string {
  return resolveName(pos) || pos.positionCode || pos.id;
}

const DISPLAY_SORT = { sensitivity: 'base' as const, numeric: true };

/** A–Z / ก–ฮ friendly browse: primary display name, then code/id. */
export function sortPositionsByDisplayName<T extends Position>(
  positions: T[] | null | undefined
): T[] {
  if (!positions?.length) return positions ? [...positions] : [];
  return [...positions].sort((a, b) =>
    positionListPrimaryName(a as PositionDoc).localeCompare(
      positionListPrimaryName(b as PositionDoc),
      undefined,
      DISPLAY_SORT
    )
  );
}

/** Sort contract/PO rate rows by resolved position title (same order as dropdowns). */
export function sortPositionRatesByDisplayName<T extends { positionId: string }>(
  rates: T[] | null | undefined,
  positions: readonly Position[] | null | undefined
): T[] {
  if (!rates?.length) return [];
  const label = (r: T) => {
    const p = positions?.find((x) => x.id === r.positionId);
    return p ? positionListPrimaryName(p as PositionDoc) : r.positionId || '';
  };
  return [...rates].sort((a, b) => label(a).localeCompare(label(b), undefined, DISPLAY_SORT));
}
