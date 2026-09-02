import type { Assignment, DailyTimesheet, JobMode, MainContract, Position, Worker } from '@/lib/types';
import type { WorkerGlobalLaborContext } from '@/lib/payroll/worker-global-labor-policy';
import { computeRegistryWorkerTimesheetGross } from '@/lib/payroll/registry-worker-timesheet-gross';
import {
  type PayrollPoLineMaps,
  resolvePoLineForPayrollTimesheet,
} from '@/lib/payroll/timesheet-labor-base-cost';
import { isPayrollCostStandbyPackageEvent, payrollStandbyPackageEventUnits } from '@/lib/payroll/package-labor-cost';
import type { PriorPaidFrozenPayrollSlice } from '@/lib/payroll/prior-paid-timesheet-gross';
import { resolveFrozenTimesheetGrossAmount } from '@/lib/payroll/prior-paid-timesheet-gross';
import { applyLaborCostEpochToWorkerForDate } from '@/lib/payroll/remob-position-for-payroll';

export type PayrollTimesheetAggChunk = {
  gross: number;
  eventBreakdown: Record<string, number>;
  earningsBreakdown: Record<string, number>;
  /** ยอดต่อใบ timesheet ตอน generate — ใช้โชว์รายวันบนหน้า batch โดยไม่คำนวณสด */
  timesheetGrossById: Record<string, number>;
  usedPackageLaborCost: boolean;
  usedContractFallback: boolean;
  anyOpecPositionLaborBase: boolean;
};

export type PayrollTimesheetAggDeps = {
  poLineMaps: PayrollPoLineMaps;
  poContractById?: Map<string, string>;
  poWorkModeByPoId?: Map<string, JobMode>;
  workerById: Map<string, Worker>;
  posById: Map<string, Position>;
  contractMap: Map<string, MainContract>;
  workerGlobalLabor: WorkerGlobalLaborContext;
  /** assignment ของใบงาน — ใช้ laborCostEpochs (อัตราก่อน remob) */
  assignmentById?: Map<string, Assignment>;
  /**
   * ยอดรายวันที่จ่ายไปแล้วในงวดก่อน (PAID/LOCKED) — ใช้แทนการคำนวณสด
   * เพื่อไม่ให้แก้ทะเบียน/สัญญาทับวันที่ยืนยันจ่ายแล้ว
   */
  frozenTimesheetGrossById?: Record<string, number>;
  /** สไลซ์เต็มจากงวดที่จ่ายแล้ว (byDate + ฐานแพ็กเดิม + รายการตกเบิก) */
  priorPaidFrozen?: PriorPaidFrozenPayrollSlice | null;
  /**
   * ใบงานที่งวดปัจจุบันเป็นเจ้าของ (ยังไม่จ่ายในงวดก่อน) — คำนวณด้วยอัตราปัจจุบันเสมอ
   * วัน LOCKED จากงวดก่อนอยู่นอกชุดนี้ → ใช้ยอดแช่แข็ง
   */
  liveSourceTimesheetIds?: ReadonlySet<string>;
};

function pushEarningsForEvent(
  earningsBreakdown: Record<string, number>,
  eventType: string,
  amt: number,
  usedPackage: boolean,
): void {
  if (usedPackage) {
    if (eventType === 'mobilization_day') {
      earningsBreakdown.mobilization_day_package =
        (earningsBreakdown.mobilization_day_package || 0) + amt;
    } else if (eventType === 'demobilization_day') {
      earningsBreakdown.demobilization_day_package =
        (earningsBreakdown.demobilization_day_package || 0) + amt;
    } else if (eventType === 'standby_day') {
      earningsBreakdown.standby_day_package = (earningsBreakdown.standby_day_package || 0) + amt;
    } else {
      earningsBreakdown.work_day_package = (earningsBreakdown.work_day_package || 0) + amt;
    }
  } else {
    earningsBreakdown[`${eventType}_policy`] = (earningsBreakdown[`${eventType}_policy`] || 0) + amt;
  }
}

/** รวมยอดจากชุด daily_timesheets ชุดหนึ่ง (เช่น คนเดียวภายใต้ PO เดียว) */
export function aggregateDailyTimesheetsPayrollChunk(
  tsList: DailyTimesheet[],
  deps: PayrollTimesheetAggDeps,
): PayrollTimesheetAggChunk {
  const eventBreakdown: Record<string, number> = {};
  const earningsBreakdown: Record<string, number> = {};
  const timesheetGrossById: Record<string, number> = {};
  let gross = 0;
  let usedPackageLaborCost = false;
  let usedContractFallback = false;
  let anyOpecPositionLaborBase = false;
  const prior = deps.priorPaidFrozen;
  const legacyFrozen = deps.frozenTimesheetGrossById;

  for (const ts of tsList) {
    const tsId = String(ts.id || '').trim();
    const forceLive = !!(tsId && deps.liveSourceTimesheetIds?.has(tsId));

    let frozenAmt: number | null = null;
    if (!forceLive) {
      frozenAmt =
        resolveFrozenTimesheetGrossAmount(ts, prior) ??
        (tsId && legacyFrozen && Number.isFinite(Number(legacyFrozen[tsId])) && Number(legacyFrozen[tsId]) > 0
          ? Number(legacyFrozen[tsId])
          : null);

      if (frozenAmt == null) {
        const lockedOnTs = Number((ts as DailyTimesheet).payrollLockedGrossBaht);
        if (Number.isFinite(lockedOnTs) && lockedOnTs > 0) frozenAmt = lockedOnTs;
      }

      const isPriorPaidDay =
        frozenAmt != null ||
        (tsId !== '' && !!prior?.lockedSourceTimesheetIds.has(tsId)) ||
        (ts.status === 'LOCKED' && !forceLive);

      if (frozenAmt == null && isPriorPaidDay && prior?.frozenPackageBaseRate != null) {
        const base = prior.frozenPackageBaseRate;
        const wk = deps.workerById.get(ts.workerId);
        const wkFrozen: Worker | undefined = wk
          ? {
              ...wk,
              laborCostUsePositionDefault: false,
              laborCostCustomOffshore: base,
              laborCostCustomOnshore: base,
            }
          : undefined;
        const poLine = resolvePoLineForPayrollTimesheet(ts, deps.poLineMaps);
        const linePos = ts.positionId ? deps.posById.get(ts.positionId) : undefined;
        const rFrozen = computeRegistryWorkerTimesheetGross(ts, {
          worker: wkFrozen,
          linePosition: linePos,
          poLine,
          contractMap: deps.contractMap,
          poContractById: deps.poContractById,
          poWorkModeByPoId: deps.poWorkModeByPoId,
          workerGlobalLabor: deps.workerGlobalLabor,
        });
        if (rFrozen.gross > 0) frozenAmt = Math.round(rFrozen.gross * 100) / 100;
      }
    }

    if (!forceLive && frozenAmt != null && frozenAmt > 0) {
      const amt = Math.round(frozenAmt * 100) / 100;
      gross += amt;
      if (tsId) timesheetGrossById[tsId] = amt;
      const eventDelta = isPayrollCostStandbyPackageEvent(ts.eventType)
        ? payrollStandbyPackageEventUnits(ts)
        : 1;
      eventBreakdown[ts.eventType] = (eventBreakdown[ts.eventType] || 0) + eventDelta;
      const pkg = isPayrollCostStandbyPackageEvent(ts.eventType) || ts.eventType === 'work_day';
      pushEarningsForEvent(earningsBreakdown, ts.eventType, amt, pkg);
      if (pkg) usedPackageLaborCost = true;
      else usedContractFallback = true;
      continue;
    }

    const poLine = resolvePoLineForPayrollTimesheet(ts, deps.poLineMaps);
    const asgn = deps.assignmentById?.get(String(ts.assignmentId || '').trim());
    const wkLive = deps.workerById.get(ts.workerId);
    const wk = applyLaborCostEpochToWorkerForDate(wkLive, asgn, ts.date);
    const linePos = ts.positionId ? deps.posById.get(ts.positionId) : undefined;
    const r = computeRegistryWorkerTimesheetGross(ts, {
      worker: wk,
      linePosition: linePos,
      poLine,
      contractMap: deps.contractMap,
      poContractById: deps.poContractById,
      poWorkModeByPoId: deps.poWorkModeByPoId,
      workerGlobalLabor: deps.workerGlobalLabor,
    });
    if (r.fromPositionModel) {
      anyOpecPositionLaborBase = true;
    }
    if (r.gross <= 0) continue;
    if (r.usedPackageLaborCost) {
      usedPackageLaborCost = true;
    } else if (r.usedPolicyFallback) {
      usedContractFallback = true;
    }
    gross += r.gross;
    if (tsId) {
      timesheetGrossById[tsId] = Math.round(r.gross * 100) / 100;
    }
    const eventDelta = isPayrollCostStandbyPackageEvent(ts.eventType)
      ? payrollStandbyPackageEventUnits(ts)
      : 1;
    eventBreakdown[ts.eventType] = (eventBreakdown[ts.eventType] || 0) + eventDelta;
    pushEarningsForEvent(earningsBreakdown, ts.eventType, r.gross, r.usedPackageLaborCost);
  }

  return {
    gross,
    eventBreakdown,
    earningsBreakdown,
    timesheetGrossById,
    usedPackageLaborCost,
    usedContractFallback,
    anyOpecPositionLaborBase,
  };
}

/** รวมหลาย chunk (หลาย PO) เป็นยอดเดียวสำหรับบรรทัด batch / D8 */
export function mergePayrollTimesheetAggChunks(chunks: PayrollTimesheetAggChunk[]): PayrollTimesheetAggChunk {
  const merged: PayrollTimesheetAggChunk = {
    gross: 0,
    eventBreakdown: {},
    earningsBreakdown: {},
    timesheetGrossById: {},
    usedPackageLaborCost: false,
    usedContractFallback: false,
    anyOpecPositionLaborBase: false,
  };
  for (const c of chunks) {
    merged.gross += c.gross;
    for (const [k, v] of Object.entries(c.eventBreakdown)) {
      merged.eventBreakdown[k] = (merged.eventBreakdown[k] || 0) + v;
    }
    for (const [k, v] of Object.entries(c.earningsBreakdown)) {
      merged.earningsBreakdown[k] = (merged.earningsBreakdown[k] || 0) + v;
    }
    Object.assign(merged.timesheetGrossById, c.timesheetGrossById);
    merged.usedPackageLaborCost ||= c.usedPackageLaborCost;
    merged.usedContractFallback ||= c.usedContractFallback;
    merged.anyOpecPositionLaborBase ||= c.anyOpecPositionLaborBase;
  }
  return merged;
}
