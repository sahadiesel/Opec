import type { DailyTimesheet, PayslipWorkDaySplit } from '@/lib/types';
import type { PayrollTimesheetAggDeps } from '@/lib/payroll/aggregate-payroll-timesheet-chunks';
import { computeWorkDayPayslipAmountParts } from '@/lib/payroll/package-labor-cost';
import {
  resolveBaseCostForPayrollTimesheet,
  resolveEffectivePayrollContractId,
  resolvePoLineForPayrollTimesheet,
} from '@/lib/payroll/timesheet-labor-base-cost';
import { workerGlobalLaborToPayrollRestSchedule } from '@/lib/payroll/worker-global-labor-policy';

export type PayslipLineItem = { label: string; amount: number };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatThaiMoneyAmount(n: number): string {
  return new Intl.NumberFormat('th-TH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
}

function workDayBaseIncomeLine(title: string, days: number, amount: number): PayslipLineItem | null {
  if (days <= 0 || amount <= 0.005) return null;
  const rate = round2(amount / days);
  const product = round2(days * rate);
  const consistent = Math.abs(product - amount) <= 0.02;
  const label = consistent
    ? `${title} ${days} วัน × ${formatThaiMoneyAmount(rate)}`
    : `${title} ${days} วัน (เฉลี่ยวันละ ${formatThaiMoneyAmount(rate)} บาท)`;
  return { label, amount: round2(amount) };
}

function otTierPayslipLine(
  labelPrefix: string,
  tierLabel: string,
  hours: number,
  amount: number,
): PayslipLineItem | null {
  if (hours <= 0 || amount <= 0.005) return null;
  const pfx = labelPrefix.trim();
  const base = pfx ? `${pfx} OT ${tierLabel}` : `OT ${tierLabel}`;
  const rate = round2(amount / hours);
  const product = round2(hours * rate);
  const consistent = Math.abs(product - amount) <= 0.02;
  const label = consistent
    ? `${base} · ${hours} ชม. × ${formatThaiMoneyAmount(rate)}`
    : `${base} · ${hours} ชม.`;
  return { label, amount: round2(amount) };
}

export function payslipWorkDaySplitTotal(split: PayslipWorkDaySplit): number {
  if (split.otAmount == null) {
    return round2(split.normalAmount + split.holidayAmount);
  }
  return round2(split.normalAmount + split.holidayAmount + split.otAmount);
}

function emptyWorkDaySplit(): PayslipWorkDaySplit {
  return {
    normalDays: 0,
    normalAmount: 0,
    holidayDays: 0,
    holidayAmount: 0,
    otAmount: 0,
    ot15Hours: 0,
    ot20Hours: 0,
    ot30Hours: 0,
    overflowNormalHours: 0,
    ot15Amount: 0,
    ot20Amount: 0,
    ot30Amount: 0,
    overflowOtAmount: 0,
    overflowBeyond12Hours: 0,
    overflowBeyond12Amount: 0,
  };
}

function workDayPartsForTimesheet(ts: DailyTimesheet, deps: PayrollTimesheetAggDeps) {
  if (ts.eventType !== 'work_day') return null;
  const poLine = resolvePoLineForPayrollTimesheet(ts, deps.poLineMaps);
  const wk = deps.workerById.get(ts.workerId);
  const linePos = ts.positionId ? deps.posById.get(ts.positionId) : undefined;
  const payrollContractId = resolveEffectivePayrollContractId(ts, deps.poContractById);
  const mainContract = payrollContractId ? deps.contractMap.get(payrollContractId) : undefined;
  const { baseCost } = resolveBaseCostForPayrollTimesheet({
    worker: wk,
    linePosition: linePos,
    poLine,
    timesheet: ts,
    mainContract,
    poContractById: deps.poContractById,
    poWorkModeByPoId: deps.poWorkModeByPoId,
  });
  if (baseCost <= 0) return null;

  const statedHours = poLine.normalWorkHoursSnapshot === 12 ? 12 : 8;
  const costOt = poLine.costOtRulesSnapshot as { afterShift?: number } | undefined;
  const otMult =
    Number(costOt?.afterShift) ||
    Number(deps.workerGlobalLabor.cost.otAfterShift) ||
    1.5;

  return computeWorkDayPayslipAmountParts({
    timesheet: ts,
    costPackagePerDay: baseCost,
    statedHours,
    otAfterShiftMultiplier: otMult,
    payrollRestSchedule: workerGlobalLaborToPayrollRestSchedule(deps.workerGlobalLabor),
  });
}

/**
 * แยกยอด work_day แพ็กเป็นวันปกติ / วันหยุด / OT — **ไม่รวม standby_day**
 * ผลรวม normal + holiday + ot เท่ากับ earningsBreakdown.work_day_package ของชุด timesheet เดียวกัน
 */
export function computeWorkDayPackagePayslipSplit(
  tsList: readonly DailyTimesheet[],
  deps: PayrollTimesheetAggDeps,
): PayslipWorkDaySplit {
  const split = emptyWorkDaySplit();

  for (const ts of tsList) {
    if (ts.eventType === 'standby_day') continue;
    const parts = workDayPartsForTimesheet(ts, deps);
    if (!parts || parts.gross <= 0) continue;

    if (parts.restDay.active) {
      split.holidayDays += 1;
      split.holidayAmount += parts.baseAmount;
    } else {
      split.normalDays += 1;
      split.normalAmount += parts.baseAmount;
    }

    split.otAmount! += parts.otAmount;
    split.ot15Hours! += parts.ot15Hours;
    split.ot20Hours! += parts.ot20Hours;
    split.ot30Hours! += parts.ot30Hours;
    split.overflowNormalHours! += parts.overflowNormalHours;
    split.ot15Amount! += parts.ot15Amount;
    split.ot20Amount! += parts.ot20Amount;
    split.ot30Amount! += parts.ot30Amount;
    split.overflowOtAmount! += parts.overflowOtAmount;
    split.overflowBeyond12Hours! += parts.overflowBeyond12Hours ?? 0;
    split.overflowBeyond12Amount! += parts.overflowBeyond12Amount ?? 0;
  }

  split.normalAmount = round2(split.normalAmount);
  split.holidayAmount = round2(split.holidayAmount);
  split.otAmount = round2(split.otAmount!);
  split.ot15Amount = round2(split.ot15Amount!);
  split.ot20Amount = round2(split.ot20Amount!);
  split.ot30Amount = round2(split.ot30Amount!);
  split.overflowOtAmount = round2(split.overflowOtAmount!);
  split.overflowBeyond12Hours = round2(split.overflowBeyond12Hours!);
  split.overflowBeyond12Amount = round2(split.overflowBeyond12Amount!);

  return split;
}

/** true ถ้าใส่บรรทัดแทน work_day_package แล้ว */
export function pushWorkDayPayslipIncomeLines(
  lines: PayslipLineItem[],
  pkgAmount: number,
  split: PayslipWorkDaySplit | null | undefined,
  labelPrefix: string,
): boolean {
  if (!split) return false;
  const sum = payslipWorkDaySplitTotal(split);
  if (Math.abs(sum - pkgAmount) > 0.05) return false;

  const pfx = labelPrefix.trim();
  const baseNormal = pfx ? `${pfx} ค่าแรงวันปกติ` : 'ค่าแรงวันปกติ';
  const baseHoliday = pfx ? `${pfx} ค่าแรงวันหยุด` : 'ค่าแรงวันหยุด';
  const hasOtSplit = split.otAmount != null;

  if (hasOtSplit) {
    const n = workDayBaseIncomeLine(baseNormal, split.normalDays, split.normalAmount);
    const h = workDayBaseIncomeLine(baseHoliday, split.holidayDays, split.holidayAmount);
    if (n) lines.push(n);
    if (h) lines.push(h);

    const otLines = [
      otTierPayslipLine(pfx, '1.5', split.ot15Hours ?? 0, split.ot15Amount ?? 0),
      otTierPayslipLine(pfx, '2.0', split.ot20Hours ?? 0, split.ot20Amount ?? 0),
      otTierPayslipLine(pfx, '3.0', split.ot30Hours ?? 0, split.ot30Amount ?? 0),
      otTierPayslipLine(
        pfx,
        'หลังกะ (เกิน 12 ชม.)',
        split.overflowBeyond12Hours ?? 0,
        split.overflowBeyond12Amount ?? 0,
      ),
      otTierPayslipLine(
        pfx,
        'หลังกะ (normal เกิน 8)',
        split.overflowNormalHours ?? 0,
        split.overflowOtAmount ?? 0,
      ),
    ].filter((x): x is PayslipLineItem => x != null);
    lines.push(...otLines);
    return !!(n || h || otLines.length > 0);
  }

  const n = workDayBaseIncomeLine(baseNormal, split.normalDays, split.normalAmount);
  const h = workDayBaseIncomeLine(baseHoliday, split.holidayDays, split.holidayAmount);
  if (n) lines.push(n);
  if (h) lines.push(h);
  return !!(n || h);
}
