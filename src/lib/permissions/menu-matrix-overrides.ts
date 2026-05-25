/**
 * Menu-permission matrix overrides
 *
 * เก็บค่า "ที่ admin ปรับ" ทับสิทธิ์ baseline จาก `getPermissions()`
 * - Storage: localStorage (key: OVERRIDES_STORAGE_KEY) — ใช้งานได้ทันทีโดยไม่พึ่ง firestore.rules ที่ยัง deploy ไม่ได้
 * - Shape: { roleKey: { moduleKey: { view?, create?, edit?, delete?, approve? } } }
 * - แต่ละ capability เก็บแยก (Partial) — ทำให้ override ระดับ capability ได้ ไม่ต้อง override ทั้ง cell
 *
 * เมื่อพร้อม deploy rules แล้ว ค่อย sync ไปที่ Firestore (`/menu_permission_overrides/v1` หรือ collection ที่กำหนด)
 * โดยใช้ฟังก์ชัน `serializeOverrides` / `deserializeOverrides` ที่ schema คงที่
 */

import type { BusinessRoleKey } from '@/lib/types';

export type CapabilityKey = 'view' | 'create' | 'edit' | 'delete' | 'approve';

export const CAPABILITY_KEYS: readonly CapabilityKey[] = [
  'view',
  'create',
  'edit',
  'delete',
  'approve',
] as const;

/** สิทธิ์เต็มของหนึ่ง cell (role × module) */
export interface CapabilityCell {
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
  approve: boolean;
}

/** Override ระดับ capability — undefined = ใช้ baseline */
export type CapabilityCellOverride = Partial<CapabilityCell>;

/** moduleKey → override */
export type RoleOverrideMap = Record<string, CapabilityCellOverride>;

/** roleKey → moduleKey → override */
export type MenuMatrixOverrides = Partial<Record<BusinessRoleKey, RoleOverrideMap>>;

export const OVERRIDES_STORAGE_KEY = 'opsflow_menu_permission_overrides_v1';

/** ขนาด schema (version) สำหรับ migrate ในอนาคต */
export const OVERRIDES_SCHEMA_VERSION = 1;

export interface OverridesEnvelope {
  version: number;
  updatedAt: number;
  updatedBy?: string;
  overrides: MenuMatrixOverrides;
}

export function emptyOverrides(): MenuMatrixOverrides {
  return {};
}

export function emptyEnvelope(updatedBy?: string): OverridesEnvelope {
  return {
    version: OVERRIDES_SCHEMA_VERSION,
    updatedAt: Date.now(),
    updatedBy,
    overrides: emptyOverrides(),
  };
}

/**
 * รวม baseline + override เป็นค่าจริง (effective)
 * ใช้ logic: override (ถ้ามี) ทับ baseline ต่อ capability
 */
export function applyOverride(
  baseline: CapabilityCell,
  override: CapabilityCellOverride | undefined,
): CapabilityCell {
  if (!override) return baseline;
  return {
    view: override.view ?? baseline.view,
    create: override.create ?? baseline.create,
    edit: override.edit ?? baseline.edit,
    delete: override.delete ?? baseline.delete,
    approve: override.approve ?? baseline.approve,
  };
}

export function getCellOverride(
  overrides: MenuMatrixOverrides,
  roleKey: BusinessRoleKey,
  moduleKey: string,
): CapabilityCellOverride | undefined {
  return overrides[roleKey]?.[moduleKey];
}

/**
 * Toggle หนึ่ง capability — ถ้าตรง baseline ให้ลบ override ออก (ลด noise)
 * คืน overrides ใหม่ (immutable)
 */
export function toggleCapability(
  overrides: MenuMatrixOverrides,
  roleKey: BusinessRoleKey,
  moduleKey: string,
  capability: CapabilityKey,
  baseline: CapabilityCell,
): MenuMatrixOverrides {
  const currentOverride = overrides[roleKey]?.[moduleKey] ?? {};
  const currentEffective = applyOverride(baseline, currentOverride);
  const nextValue = !currentEffective[capability];

  const nextOverrideForCell: CapabilityCellOverride = { ...currentOverride };
  if (nextValue === baseline[capability]) {
    delete nextOverrideForCell[capability];
  } else {
    nextOverrideForCell[capability] = nextValue;
  }

  /** rule: ถ้า view=false ให้บังคับ capability อื่น = false ด้วย (ลด confusion) */
  if (capability === 'view' && nextValue === false) {
    for (const k of CAPABILITY_KEYS) {
      if (k === 'view') continue;
      if (baseline[k] !== false) {
        nextOverrideForCell[k] = false;
      } else {
        delete nextOverrideForCell[k];
      }
    }
  }

  const nextRoleMap: RoleOverrideMap = { ...(overrides[roleKey] ?? {}) };
  if (Object.keys(nextOverrideForCell).length === 0) {
    delete nextRoleMap[moduleKey];
  } else {
    nextRoleMap[moduleKey] = nextOverrideForCell;
  }

  const next: MenuMatrixOverrides = { ...overrides };
  if (Object.keys(nextRoleMap).length === 0) {
    delete next[roleKey];
  } else {
    next[roleKey] = nextRoleMap;
  }
  return next;
}

/** ล้าง override ของ 1 role */
export function resetRoleOverrides(
  overrides: MenuMatrixOverrides,
  roleKey: BusinessRoleKey,
): MenuMatrixOverrides {
  if (!overrides[roleKey]) return overrides;
  const next: MenuMatrixOverrides = { ...overrides };
  delete next[roleKey];
  return next;
}

/** ล้าง override ของ 1 cell (role × module) */
export function resetCellOverride(
  overrides: MenuMatrixOverrides,
  roleKey: BusinessRoleKey,
  moduleKey: string,
): MenuMatrixOverrides {
  if (!overrides[roleKey]?.[moduleKey]) return overrides;
  const nextRoleMap = { ...(overrides[roleKey] ?? {}) };
  delete nextRoleMap[moduleKey];
  const next: MenuMatrixOverrides = { ...overrides };
  if (Object.keys(nextRoleMap).length === 0) delete next[roleKey];
  else next[roleKey] = nextRoleMap;
  return next;
}

export function countOverriddenCells(overrides: MenuMatrixOverrides): number {
  let n = 0;
  for (const role of Object.keys(overrides) as BusinessRoleKey[]) {
    const map = overrides[role];
    if (!map) continue;
    n += Object.keys(map).length;
  }
  return n;
}

export function countOverriddenCapabilities(overrides: MenuMatrixOverrides): number {
  let n = 0;
  for (const role of Object.keys(overrides) as BusinessRoleKey[]) {
    const map = overrides[role];
    if (!map) continue;
    for (const moduleKey of Object.keys(map)) {
      n += Object.keys(map[moduleKey]).length;
    }
  }
  return n;
}

/** JSON serialization — เก็บ schema version ไว้เพื่อ migrate */
export function serializeOverrides(envelope: OverridesEnvelope): string {
  return JSON.stringify(envelope, null, 2);
}

export function deserializeOverrides(raw: string): OverridesEnvelope | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.version !== 'number') return null;
    if (typeof parsed.overrides !== 'object' || parsed.overrides == null) return null;
    return {
      version: parsed.version,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
      updatedBy: typeof parsed.updatedBy === 'string' ? parsed.updatedBy : undefined,
      overrides: parsed.overrides as MenuMatrixOverrides,
    };
  } catch {
    return null;
  }
}

/** อ่าน envelope จาก localStorage — คืน empty envelope ถ้าไม่มี / parse ไม่ผ่าน */
export function readOverridesFromLocalStorage(): OverridesEnvelope {
  if (typeof window === 'undefined') return emptyEnvelope();
  try {
    const raw = window.localStorage.getItem(OVERRIDES_STORAGE_KEY);
    if (!raw) return emptyEnvelope();
    const env = deserializeOverrides(raw);
    if (!env) return emptyEnvelope();
    return env;
  } catch {
    return emptyEnvelope();
  }
}

/** เขียน envelope ลง localStorage */
export function writeOverridesToLocalStorage(envelope: OverridesEnvelope): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(OVERRIDES_STORAGE_KEY, serializeOverrides(envelope));
  } catch {
    /** localStorage อาจถูกปิด (private mode) — เงียบไว้ */
  }
}
