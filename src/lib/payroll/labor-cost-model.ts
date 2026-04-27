/**
 * ต้นทุนค่าแรงฝั่ง OPEC: ฐานจาก Position (default) + ทางเลือก/override รายคน
 * ไม่อ่าน main_contract/position_rates — ใช้ร่วมกับ PayRoll generation (เฟส 3+)
 */
import {
  getEffectiveSimpleRole,
  isActiveForApp,
  isInternalTypeUser,
} from '@/lib/simple-tier-model';
import { isSystemAdmin } from '@/lib/permission-core';
import type {
  LaborCostResolutionSnapshot,
  LaborCostSourceKind,
  LaborCostWorkMode,
  Position,
  User,
  Worker,
} from '@/lib/types';

/** บทบาทที่เห็น/แก้ฐานต้นทุนแรง (ฝ่าย operations / HR / payroll) — ไม่รวม sales / ร้าน ฯลฯ */
export const LABOR_COST_STAFF_ROLES = new Set<string>([
  'system_admin',
  'operations_manager',
  'hr_manager',
  'hr_officer',
  'payroll_officer',
  'operations_officer',
]);

function isLaborCostStaffByRole(role: string | null): boolean {
  if (!role) return false;
  return LABOR_COST_STAFF_ROLES.has(role);
}

/**
 * ผู้ใช้ internal ใช้งาน app ได้ และ role อยู่ในรายชื่อฝ่าย HR/operations/payroll
 */
export function canViewWorkerLaborCostFromUser(
  user: Partial<User> | null | undefined,
): boolean {
  if (!user || !isActiveForApp(user) || !isInternalTypeUser(user)) return false;
  if (isSystemAdmin(user as User)) return true;
  return isLaborCostStaffByRole(getEffectiveSimpleRole(user));
}

/** ระยะนี้แก้ได้กับ role เดียวกับ who can view — ต่อไปอาจแยก (เช่น ดูได้แต่ HR แก้) */
export const canEditWorkerLaborCostFromUser = canViewWorkerLaborCostFromUser;

function positionRateForMode(
  pos: Position | null | undefined,
  mode: LaborCostWorkMode,
): number | undefined {
  if (!pos) return undefined;
  if (mode === 'onshore') {
    return pos.defaultLaborCostOnshore;
  }
  return pos.defaultLaborCostOffshore;
}

function customRateForMode(
  w: Pick<Worker, 'laborCostCustomOnshore' | 'laborCostCustomOffshore'>,
  mode: LaborCostWorkMode,
): number | undefined {
  if (mode === 'onshore') {
    return w.laborCostCustomOnshore;
  }
  return w.laborCostCustomOffshore;
}

/**
 * คืนอัตราฐาน (บาท) ก่อนเข้า d8/แพ็ก หรือ null ถ้าไม่กำหนดพอ
 */
export function resolveWorkerLaborBaseRate(
  worker: Pick<
    Worker,
    'laborCostUsePositionDefault' | 'laborCostCustomOnshore' | 'laborCostCustomOffshore'
  >,
  position: Position | null | undefined,
  workMode: LaborCostWorkMode,
): { rate: number | null; source: LaborCostSourceKind } {
  const usePos =
    worker.laborCostUsePositionDefault !== false;
  if (!usePos) {
    const c = customRateForMode(worker, workMode);
    const n = c !== undefined && c !== null ? Number(c) : NaN;
    if (Number.isFinite(n)) {
      return { rate: n, source: 'worker_custom' };
    }
    const fb = positionRateForMode(position, workMode);
    const fbN = fb !== undefined && fb !== null ? Number(fb) : NaN;
    if (Number.isFinite(fbN)) {
      return { rate: fbN, source: 'position_default' };
    }
    return { rate: null, source: 'worker_custom' };
  }
  const p = positionRateForMode(position, workMode);
  const pn = p !== undefined && p !== null ? Number(p) : NaN;
  if (Number.isFinite(pn)) {
    return { rate: pn, source: 'position_default' };
  }
  return { rate: null, source: 'position_default' };
}

export function buildLaborCostResolutionSnapshot(input: {
  positionId: string;
  workMode: LaborCostWorkMode;
  rate: number | null;
  source: LaborCostSourceKind;
}): LaborCostResolutionSnapshot {
  return {
    source: input.source,
    positionId: input.positionId,
    workMode: input.workMode,
    effectiveBaseRate: input.rate ?? 0,
    resolvedAt: Date.now(),
  };
}

/** ตัดฟิลด์ต้นทุนแรงออกก่อนโชว์ให้ role ที่ไม่มีสิทธิ์ (เฟส UI) */
export function redactWorkerLaborFields<T extends Record<string, unknown>>(
  worker: T,
  canView: boolean,
): T {
  if (canView) return worker;
  const {
    laborCostUsePositionDefault: _a,
    laborCostCustomOnshore: _b,
    laborCostCustomOffshore: _c,
    laborCostMigratedFromMainContractId: _d,
    laborCostMigratedAt: _e,
    ...rest
  } = worker as T & {
    laborCostUsePositionDefault?: unknown;
    laborCostCustomOnshore?: unknown;
    laborCostCustomOffshore?: unknown;
    laborCostMigratedFromMainContractId?: unknown;
    laborCostMigratedAt?: unknown;
  };
  return rest as T;
}
