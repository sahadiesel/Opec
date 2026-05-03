import type { DailyTimesheet, MainContract, Position, Worker } from '@/lib/types';
import type { WorkerGlobalLaborContext } from '@/lib/payroll/worker-global-labor-policy';
import { computeRegistryWorkerTimesheetGross } from '@/lib/payroll/registry-worker-timesheet-gross';

export type PayrollTimesheetAggChunk = {
  gross: number;
  eventBreakdown: Record<string, number>;
  earningsBreakdown: Record<string, number>;
  usedPackageLaborCost: boolean;
  usedContractFallback: boolean;
  anyOpecPositionLaborBase: boolean;
};

export type PayrollTimesheetAggDeps = {
  poLineById: Map<string, unknown>;
  workerById: Map<string, Worker>;
  posById: Map<string, Position>;
  contractMap: Map<string, MainContract>;
  workerGlobalLabor: WorkerGlobalLaborContext;
};

/** รวมยอดจากชุด daily_timesheets ชุดหนึ่ง (เช่น คนเดียวภายใต้ PO เดียว) */
export function aggregateDailyTimesheetsPayrollChunk(
  tsList: DailyTimesheet[],
  deps: PayrollTimesheetAggDeps,
): PayrollTimesheetAggChunk {
  const eventBreakdown: Record<string, number> = {};
  const earningsBreakdown: Record<string, number> = {};
  let gross = 0;
  let usedPackageLaborCost = false;
  let usedContractFallback = false;
  let anyOpecPositionLaborBase = false;

  for (const ts of tsList) {
    const poLine = (deps.poLineById.get(ts.poLineId) || {}) as Record<string, unknown>;
    const wk = deps.workerById.get(ts.workerId);
    const linePos = ts.positionId ? deps.posById.get(ts.positionId) : undefined;
    const r = computeRegistryWorkerTimesheetGross(ts, {
      worker: wk,
      linePosition: linePos,
      poLine,
      contractMap: deps.contractMap,
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
    eventBreakdown[ts.eventType] = (eventBreakdown[ts.eventType] || 0) + 1;
    if (r.usedPackageLaborCost) {
      earningsBreakdown.work_day_package = (earningsBreakdown.work_day_package || 0) + r.gross;
    } else {
      earningsBreakdown[`${ts.eventType}_policy`] =
        (earningsBreakdown[`${ts.eventType}_policy`] || 0) + r.gross;
    }
  }

  return {
    gross,
    eventBreakdown,
    earningsBreakdown,
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
    merged.usedPackageLaborCost ||= c.usedPackageLaborCost;
    merged.usedContractFallback ||= c.usedContractFallback;
    merged.anyOpecPositionLaborBase ||= c.anyOpecPositionLaborBase;
  }
  return merged;
}
