'use client';

/**
 * React hook สำหรับจัดการ menu permission overrides
 *
 * Workflow:
 * - hook โหลด envelope จาก localStorage ครั้งแรกที่ mount
 * - คอมโพเนนต์ commit การเปลี่ยนแปลงผ่าน `apply`, `resetRole`, `resetCell`, `clearAll`, `replaceAll`
 * - การเปลี่ยนแปลงเก็บใน in-memory `working` state ทันที (dirty = true)
 * - กด `save()` เพื่อ persist ลง localStorage และทำให้ dirty = false
 * - กด `discard()` เพื่อคืนค่ามาจาก localStorage (ทิ้ง working ปัจจุบัน)
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type MenuMatrixOverrides,
  type OverridesEnvelope,
  type CapabilityKey,
  type CapabilityCell,
  applyOverride,
  toggleCapability,
  resetCellOverride,
  resetRoleOverrides,
  countOverriddenCapabilities,
  countOverriddenCells,
  readOverridesFromLocalStorage,
  writeOverridesToLocalStorage,
  emptyEnvelope,
  serializeOverrides,
  deserializeOverrides,
} from '@/lib/permissions/menu-matrix-overrides';
import type { BusinessRoleKey } from '@/lib/types';

interface UseMenuPermissionOverridesOptions {
  /** uid/email ของ admin ที่กำลังแก้ — ใช้ stamp `updatedBy` */
  updatedBy?: string;
}

export interface MenuPermissionOverridesAPI {
  /** ค่าที่กำลังแก้ในหน้า (ยังไม่บันทึก) */
  working: MenuMatrixOverrides;
  /** ค่าที่บันทึกไว้ใน storage แล้ว */
  saved: MenuMatrixOverrides;
  /** หน้าจอกำลังแก้และยังไม่บันทึก */
  isDirty: boolean;
  /** กำลังโหลดครั้งแรก */
  isLoading: boolean;
  /** จำนวน cell ที่ถูก override (รวม role × module) */
  modifiedCellCount: number;
  /** จำนวน capability ทั้งหมดที่ถูก override (ละเอียดกว่า) */
  modifiedCapabilityCount: number;
  /** Toggle หนึ่ง capability ของ (role × module) — auto-prune ถ้าตรง baseline */
  toggle: (roleKey: BusinessRoleKey, moduleKey: string, capability: CapabilityKey, baseline: CapabilityCell) => void;
  /** คำนวณ effective cell ของ (role × module) */
  effective: (roleKey: BusinessRoleKey, moduleKey: string, baseline: CapabilityCell) => CapabilityCell;
  /** มี override ที่ cell นี้ไหม */
  hasOverrideAt: (roleKey: BusinessRoleKey, moduleKey: string) => boolean;
  /** ล้าง override ของ 1 cell */
  resetCell: (roleKey: BusinessRoleKey, moduleKey: string) => void;
  /** ล้าง override ของ 1 role */
  resetRole: (roleKey: BusinessRoleKey) => void;
  /** ล้าง override ทั้งหมด */
  clearAll: () => void;
  /** Save working → storage */
  save: () => void;
  /** Discard working — โหลดจาก storage ใหม่ */
  discard: () => void;
  /** Export JSON (envelope ทั้งก้อน รวม version + updatedAt) */
  exportJson: () => string;
  /** Import JSON — set working จาก JSON; คืน success/false */
  importJson: (raw: string) => boolean;
  /** ค่าทั้งก้อนที่บันทึกไว้ล่าสุด (envelope) */
  savedEnvelope: OverridesEnvelope;
}

export function useMenuPermissionOverrides(
  options: UseMenuPermissionOverridesOptions = {},
): MenuPermissionOverridesAPI {
  const { updatedBy } = options;

  const [savedEnvelope, setSavedEnvelope] = useState<OverridesEnvelope>(() => emptyEnvelope(updatedBy));
  const [working, setWorking] = useState<MenuMatrixOverrides>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const env = readOverridesFromLocalStorage();
    setSavedEnvelope(env);
    setWorking(env.overrides);
    setIsLoading(false);
  }, []);

  const isDirty = useMemo(() => {
    return JSON.stringify(working) !== JSON.stringify(savedEnvelope.overrides);
  }, [working, savedEnvelope]);

  const modifiedCellCount = useMemo(() => countOverriddenCells(working), [working]);
  const modifiedCapabilityCount = useMemo(() => countOverriddenCapabilities(working), [working]);

  const toggle = useCallback(
    (roleKey: BusinessRoleKey, moduleKey: string, capability: CapabilityKey, baseline: CapabilityCell) => {
      setWorking((prev) => toggleCapability(prev, roleKey, moduleKey, capability, baseline));
    },
    [],
  );

  const effective = useCallback(
    (roleKey: BusinessRoleKey, moduleKey: string, baseline: CapabilityCell): CapabilityCell => {
      const override = working[roleKey]?.[moduleKey];
      return applyOverride(baseline, override);
    },
    [working],
  );

  const hasOverrideAt = useCallback(
    (roleKey: BusinessRoleKey, moduleKey: string): boolean => {
      const o = working[roleKey]?.[moduleKey];
      return !!o && Object.keys(o).length > 0;
    },
    [working],
  );

  const resetCell = useCallback((roleKey: BusinessRoleKey, moduleKey: string) => {
    setWorking((prev) => resetCellOverride(prev, roleKey, moduleKey));
  }, []);

  const resetRole = useCallback((roleKey: BusinessRoleKey) => {
    setWorking((prev) => resetRoleOverrides(prev, roleKey));
  }, []);

  const clearAll = useCallback(() => {
    setWorking({});
  }, []);

  const save = useCallback(() => {
    const env: OverridesEnvelope = {
      version: savedEnvelope.version,
      updatedAt: Date.now(),
      updatedBy: updatedBy ?? savedEnvelope.updatedBy,
      overrides: working,
    };
    writeOverridesToLocalStorage(env);
    setSavedEnvelope(env);
  }, [working, savedEnvelope, updatedBy]);

  const discard = useCallback(() => {
    setWorking(savedEnvelope.overrides);
  }, [savedEnvelope]);

  const exportJson = useCallback((): string => {
    const env: OverridesEnvelope = {
      version: savedEnvelope.version,
      updatedAt: Date.now(),
      updatedBy: updatedBy ?? savedEnvelope.updatedBy,
      overrides: working,
    };
    return serializeOverrides(env);
  }, [working, savedEnvelope, updatedBy]);

  const importJson = useCallback((raw: string): boolean => {
    const env = deserializeOverrides(raw);
    if (!env) return false;
    setWorking(env.overrides);
    return true;
  }, []);

  return {
    working,
    saved: savedEnvelope.overrides,
    isDirty,
    isLoading,
    modifiedCellCount,
    modifiedCapabilityCount,
    toggle,
    effective,
    hasOverrideAt,
    resetCell,
    resetRole,
    clearAll,
    save,
    discard,
    exportJson,
    importJson,
    savedEnvelope,
  };
}
