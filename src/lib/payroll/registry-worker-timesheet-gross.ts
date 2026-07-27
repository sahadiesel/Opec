/**
 * คำนวณ gross รายใบ timesheet ฝั่ง worker payroll — ยึดฐานจากตำแหน่ง/ลูกจ้าง (ทะเบียน) เท่านั้น
 * ไม่อาศัย labor_cost_contract_terms หรือ rate_conditions แบบ LABOR_COST_CONTRACT
 *
 * คนเดียวหลายสัญญาในเดือนเดียว: แต่ละใบใช้ contractId / PO ของตัวเอง → อัตราตามสัญญานั้น
 */
import type { DailyTimesheet, JobMode, MainContract, Position, Worker, PositionRate } from '@/lib/types';
import { computeWorkDayCostFromPackage, computeStandbyDayCostFromPackage, isPayrollCostStandbyPackageEvent } from '@/lib/payroll/package-labor-cost';
import {
  resolveBaseCostForPayrollTimesheet,
  resolveEffectivePayrollContractId,
  timesheetToLaborWorkMode,
} from '@/lib/payroll/timesheet-labor-base-cost';
import { resolveMatrixCostRate } from '@/lib/commercial/position-rate-matrix';
import {
  type WorkerGlobalLaborContext,
  workerGlobalLaborToPayrollRestSchedule,
} from '@/lib/payroll/worker-global-labor-policy';
import {
  mobDayChargeKindToEventType,
  resolveTimesheetPayrollCharge,
} from '@/lib/ops/mob-day-charge';

type GlobalCostMultiplierPolicy = {
  otAfterShift?: number;
  holiday?: number;
  publicHoliday?: number;
  sunday?: number;
  sundayOt?: number;
  standby?: number;
  mobilization?: number;
  demobilization?: number;
  travel?: number;
};

/** @deprecated ใช้ WorkerGlobalLaborContext จาก HR Settings — คงชื่อเดิมเพื่อ import ภายนอก */
export const DEFAULT_REGISTRY_EVENT_MULTIPLIER_POLICY: GlobalCostMultiplierPolicy = {
  otAfterShift: 1.5,
  holiday: 1.5,
  publicHoliday: 1,
  sunday: 1.5,
  sundayOt: 2,
  standby: 0.5,
  mobilization: 1,
  demobilization: 1,
  travel: 1,
};

function workerLaborCostPolicy(ctx: WorkerGlobalLaborContext): GlobalCostMultiplierPolicy {
  return ctx.cost;
}

function resolvePolicyFallbackCost(
  ts: DailyTimesheet,
  baseCost: number,
  policy: GlobalCostMultiplierPolicy | undefined,
): number {
  if (!baseCost) return 0;
  const p = policy ?? DEFAULT_REGISTRY_EVENT_MULTIPLIER_POLICY;
  switch (ts.eventType) {
    case 'standby_day':
      return 0;
    case 'mobilization_day':
      return 0;
    case 'demobilization_day':
      return baseCost * Number(p.demobilization ?? 1) * Number(ts.demobUnits ?? 1);
    case 'travel_day':
      return baseCost * Number(p.travel ?? 1) * Number(ts.travelUnits ?? 1);
    case 'public_holiday_worked':
      return baseCost * Number(p.publicHoliday ?? 1);
    case 'off_day_worked':
      return baseCost * Number(p.holiday ?? 1);
    default:
      return 0;
  }
}

export interface RegistryWorkerTimesheetGrossResult {
  gross: number;
  usedPackageLaborCost: boolean;
  usedPolicyFallback: boolean;
  fromPositionModel: boolean;
  /** เฉพาะ work_day แพ็ก — true เมื่อเป็นวันหยุดตามปฏิทิน/weekly rest (ใช้แยกบรรทัดสลิป) */
  workDayRestDay?: boolean;
}

/**
 * ฐานค่าแรง: ลูกจ้าง + ตำแหน่ง (และ override รายคน) → work_day ใช้แพ็กต้นทุน + OT ตาม PO snapshot + ปฏิทิน/ตัวคูณ HR
 * เหตุอื่น: ตัวคูณจาก HR Settings (worker_global_labor)
 */
export function computeRegistryWorkerTimesheetGross(
  ts: DailyTimesheet,
  input: {
    worker: Worker | undefined;
    /** ตำแหน่งตามบรรทัด timesheet — ใช้ `positionId` บน timesheet ไม่ใช่ `worker.currentPositionId` */
    linePosition: Position | null | undefined;
    poLine: Record<string, unknown>;
    contractMap: Map<string, MainContract>;
    /** PO id → contractId — fallback เมื่อ daily ไม่มี contractId */
    poContractById?: Map<string, string>;
    /** PO id → poWorkMode — ใช้แทน workMode บน daily เมื่อ PO กำหนด offshore/onshore */
    poWorkModeByPoId?: Map<string, JobMode>;
    workerGlobalLabor: WorkerGlobalLaborContext;
  },
): RegistryWorkerTimesheetGrossResult {
  const payrollCharge = resolveTimesheetPayrollCharge(ts);
  if (
    (payrollCharge.kind === 'M1' || payrollCharge.kind === 'D1') &&
    payrollCharge.m1AmountOverride != null &&
    payrollCharge.m1AmountOverride > 0
  ) {
    return {
      gross: payrollCharge.m1AmountOverride,
      usedPackageLaborCost: false,
      usedPolicyFallback: true,
      fromPositionModel: true,
    };
  }

  const payTs: DailyTimesheet = {
    ...ts,
    eventType: mobDayChargeKindToEventType(payrollCharge.kind),
    normalHours:
      payrollCharge.kind === 'M1' || payrollCharge.kind === 'D1'
        ? Number(ts.normalHours) || 0
        : Math.max(0, Number(payrollCharge.hours ?? ts.normalHours ?? 8)),
    ...(payrollCharge.kind === 'STANDBY'
      ? { standbyUnits: Math.max(1, Number(ts.standbyUnits ?? 1)) }
      : {}),
    ...(payrollCharge.kind === 'M1' ? { mobUnits: Math.max(1, Number(ts.mobUnits ?? 1)) } : {}),
    ...(payrollCharge.kind === 'D1' ? { demobUnits: Math.max(1, Number(ts.demobUnits ?? 1)) } : {}),
  };

  const payrollContractId = resolveEffectivePayrollContractId(payTs, input.poContractById);
  const mainContract = payrollContractId ? input.contractMap.get(payrollContractId) : undefined;

  const positionId = (payTs.positionId || input.linePosition?.id || '').trim();
  const contractPositionRate = mainContract?.positionRates?.find(
    (r) => r.positionId === positionId && r.active !== false
  );
  const mode = timesheetToLaborWorkMode(payTs, input.poWorkModeByPoId);

  /** จ่ายลูกจ้างใช้ Cost เท่านั้น — ห้าม fallback ไป Sell เมื่อ Cost ว่าง */
  let resolvedMatrixRate: number | null = null;
  if (contractPositionRate) {
    if (payTs.eventType === 'mobilization_day' && mode === 'offshore') {
      const costRate = resolveMatrixCostRate(contractPositionRate, 'offshore_m1_per_trip');
      resolvedMatrixRate = costRate !== null && costRate > 0 ? costRate : null;
    } else if (payTs.eventType === 'demobilization_day' && mode === 'offshore') {
      const costRate = resolveMatrixCostRate(contractPositionRate, 'offshore_d1_per_trip');
      resolvedMatrixRate = costRate !== null && costRate > 0 ? costRate : null;
    } else if (payTs.eventType === 'standby_day') {
      const cat = mode === 'offshore' ? 'offshore_standby_day' : 'onshore_standby_day';
      const costRate = resolveMatrixCostRate(contractPositionRate, cat);
      resolvedMatrixRate = costRate !== null && costRate > 0 ? costRate : null;
    }
  }

  if (resolvedMatrixRate !== null && resolvedMatrixRate > 0) {
    let units = 1;
    if (payTs.eventType === 'mobilization_day') {
      units = Math.max(1, Number(payTs.mobUnits ?? 1));
    } else if (payTs.eventType === 'demobilization_day') {
      units = Math.max(1, Number(payTs.demobUnits ?? 1));
    } else if (payTs.eventType === 'standby_day') {
      units = Math.max(1, Number(payTs.standbyUnits ?? 1));
    }
    const gross = Math.round(resolvedMatrixRate * units * 100) / 100;
    return {
      gross,
      usedPackageLaborCost: false,
      usedPolicyFallback: true,
      fromPositionModel: true,
    };
  }

  const { baseCost, fromPositionModel } = resolveBaseCostForPayrollTimesheet({
    worker: input.worker,
    linePosition: input.linePosition,
    poLine: input.poLine,
    timesheet: payTs,
    mainContract,
    poContractById: input.poContractById,
    poWorkModeByPoId: input.poWorkModeByPoId,
  });
  const policy = workerLaborCostPolicy(input.workerGlobalLabor);
  const payrollRestSchedule = workerGlobalLaborToPayrollRestSchedule(input.workerGlobalLabor);

  const poLine = input.poLine;
  const statedHours = poLine.normalWorkHoursSnapshot === 12 ? 12 : 8;
  const costOt = poLine.costOtRulesSnapshot as { afterShift?: number } | undefined;
  const otMult =
    Number(costOt?.afterShift) ||
    Number(policy.otAfterShift) ||
    1.5;

  if (isPayrollCostStandbyPackageEvent(payTs.eventType) && baseCost > 0) {
    const gross = computeStandbyDayCostFromPackage({
      timesheet: payTs,
      costPackagePerDay: baseCost,
      statedHours,
      otAfterShiftMultiplier: otMult,
      standbyCostMultiplier: Number(policy.standby ?? 0.5),
    });
    return {
      gross,
      usedPackageLaborCost: true,
      usedPolicyFallback: false,
      fromPositionModel,
    };
  }

  const useWorkDayPackage = payTs.eventType === 'work_day' && baseCost > 0;
  if (useWorkDayPackage) {
    const pkg = computeWorkDayCostFromPackage({
      timesheet: payTs,
      costPackagePerDay: baseCost,
      statedHours,
      otAfterShiftMultiplier: otMult,
      payrollRestSchedule,
    });
    return {
      gross: pkg.amount,
      usedPackageLaborCost: true,
      usedPolicyFallback: false,
      fromPositionModel,
      workDayRestDay: pkg.restDay.active,
    };
  }

  const fallbackCost = resolvePolicyFallbackCost(payTs, baseCost, policy);
  if (fallbackCost > 0) {
    return {
      gross: fallbackCost,
      usedPackageLaborCost: false,
      usedPolicyFallback: true,
      fromPositionModel,
    };
  }

  return { gross: 0, usedPackageLaborCost: false, usedPolicyFallback: false, fromPositionModel };
}
