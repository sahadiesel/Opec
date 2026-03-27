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
