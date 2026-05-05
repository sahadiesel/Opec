import type { DailyTimesheet, PayslipWorkDaySplit } from '@/lib/types';
import { computeRegistryWorkerTimesheetGross } from '@/lib/payroll/registry-worker-timesheet-gross';
import type { PayrollTimesheetAggDeps } from '@/lib/payroll/aggregate-payroll-timesheet-chunks';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * แยกยอด work_day แพ็กเป็นวันปกติ / วันหยุดตามสูตรเดียวกับ aggregate payroll — ผลรวมเท่ากับ work_day_package ของชุด timesheet เดียวกัน
 */
export function computeWorkDayPackagePayslipSplit(
  tsList: DailyTimesheet[],
  deps: PayrollTimesheetAggDeps,
): PayslipWorkDaySplit {
  let normalDays = 0;
  let normalAmount = 0;
  let holidayDays = 0;
  let holidayAmount = 0;

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
    if (!r.usedPackageLaborCost || r.gross <= 0) continue;
    if (r.workDayRestDay) {
      holidayDays += 1;
      holidayAmount += r.gross;
    } else {
      normalDays += 1;
      normalAmount += r.gross;
    }
  }

  return {
    normalDays,
    normalAmount: round2(normalAmount),
    holidayDays,
    holidayAmount: round2(holidayAmount),
  };
}
