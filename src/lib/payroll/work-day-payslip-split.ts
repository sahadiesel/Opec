import type {
  DailyTimesheet,
  PayslipWorkDayPositionSplit,
  PayslipWorkDaySplit,
  Position,
  PayrollBatchLineDailyRowSnapshot,
} from '@/lib/types';
import type { PayrollTimesheetAggDeps } from '@/lib/payroll/aggregate-payroll-timesheet-chunks';
import {
  computeWorkDayPayslipAmountParts,
  type WorkDayPayslipAmountParts,
} from '@/lib/payroll/package-labor-cost';
import {
  resolveBaseCostForPayrollTimesheet,
  resolveEffectivePayrollContractId,
  resolvePoLineForPayrollTimesheet,
} from '@/lib/payroll/timesheet-labor-base-cost';
import { workerGlobalLaborToPayrollRestSchedule } from '@/lib/payroll/worker-global-labor-policy';
import { applyLaborCostEpochToWorkerForDate } from '@/lib/payroll/remob-position-for-payroll';
import { resolveFrozenTimesheetGrossAmount } from '@/lib/payroll/prior-paid-timesheet-gross';

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

export function resolvePositionDisplayName(
  pos: Pick<Position, 'positionName' | 'positionNameTh' | 'positionNameEn'> | null | undefined,
): string {
  return String(pos?.positionName || pos?.positionNameTh || pos?.positionNameEn || '').trim();
}

/** เช่น Offshore - Fitter Foreman */
export function formatTimesheetWorkModePositionLabel(
  workMode?: string | null,
  positionName?: string | null,
): string {
  const wm = String(workMode || '')
    .trim()
    .toLowerCase();
  const isOn = wm.includes('on');
  const mode = wm ? (isOn ? 'Onshore' : 'Offshore') : '';
  const name = String(positionName || '').trim();
  if (mode && name) return `${mode} - ${name}`;
  if (name) return name;
  if (mode) return mode.toUpperCase();
  return '';
}

function workDayBaseIncomeLine(title: string, days: number, amount: number): PayslipLineItem | null {
  if (days <= 0 || amount <= 0.005) return null;
  const rate = round2(amount / days);
  return {
    label: `${title} ${days} วัน × ${formatThaiMoneyAmount(rate)}`,
    amount: round2(amount),
  };
}

/** บรรทัดค่าแรงจากอัตราแพ็กจริง — ห้ามเฉลี่ย */
function workDayPackageRateLine(
  title: string,
  days: number,
  packageRate: number,
): PayslipLineItem | null {
  if (days <= 0 || packageRate <= 0.005) return null;
  const rate = round2(packageRate);
  return {
    label: `${title} ${days} วัน × ${formatThaiMoneyAmount(rate)}`,
    amount: round2(days * rate),
  };
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

/** OT แบบสั้น — OT {ตำแหน่ง} {ชม.} × อัตรา (อัตรากับยอดต้องสอดคล้อง) */
function otPositionPayslipLine(
  positionName: string,
  tierLabel: string | null,
  hours: number,
  unitRate: number,
  amount?: number,
): PayslipLineItem | null {
  if (hours <= 0 || unitRate <= 0.005) return null;
  const name = positionName.trim() || 'ไม่ระบุตำแหน่ง';
  const base = tierLabel ? `OT${tierLabel} ${name}` : `OT ${name}`;
  const hLabel = Number.isInteger(hours) ? String(hours) : formatThaiMoneyAmount(hours);
  const rate = round2(unitRate);
  const canonical = round2(hours * rate);
  const amt = amount != null ? round2(amount) : canonical;
  /** ถ้ายอด≠ชม.×อัตราเล็กน้อย ยังโชว์อัตราแพ็ก · ถ่างมากใช้ยอด÷ชม. */
  const showRate =
    Math.abs(amt - canonical) <= 0.05 ? rate : round2(amt / hours);
  return {
    label: `${base} ${hLabel} ชม. × ${formatThaiMoneyAmount(showRate)}`,
    amount: amt,
  };
}

function ymdLocalDow(ymd: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '').slice(0, 10));
  if (!m) return -1;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay();
}

/**
 * วันหยุดที่ต้องขึ้นบรรทัด «ค่าแรงวันหยุด» — ต้องสอดคล้องกับยอดรายวันที่คำนวณจาก resolvePayrollRestDay
 * (อาทิตย์ + นักขัตฤกษ์) ไม่ใช่แค่วันอาทิตย์จากปฏิทิน
 */
function isHolidayWorkDayFromSnapshotRow(
  row: Pick<
    PayrollBatchLineDailyRowSnapshot,
    'date' | 'amount' | 'ot15Hours' | 'ot20Hours' | 'ot30Hours' | 'restDayKind' | 'normalHours'
  >,
  packageRatePerDay: number | null | undefined,
): boolean {
  const kind = row.restDayKind;
  if (kind === 'public_holiday' || kind === 'weekly_rest') return true;
  if (ymdLocalDow(row.date) === 0) return true;

  /** งวดเก่าไม่มี restDayKind: ยอดเต็มวันสูงกว่าแพ็ก และไม่มีชม.OT แยก → นักขัตฤกษ์ */
  const pkg = Number(packageRatePerDay) || 0;
  if (pkg <= 0.005) return false;
  const amount = Number(row.amount) || 0;
  const otHrs =
    Math.max(0, Number(row.ot15Hours) || 0) +
    Math.max(0, Number(row.ot20Hours) || 0) +
    Math.max(0, Number(row.ot30Hours) || 0);
  const beyond12 = Math.max(0, (Number(row.normalHours) || 0) - 12);
  if (otHrs + beyond12 > 0.005) return false;
  return amount > pkg * 1.05;
}

function modePackageRate(candidates: number[]): number | null {
  if (!candidates.length) return null;
  const counts = new Map<number, number>();
  for (const raw of candidates) {
    const r = round2(raw);
    if (r <= 0.005) continue;
    counts.set(r, (counts.get(r) || 0) + 1);
  }
  let best: number | null = null;
  let bestN = 0;
  for (const [r, n] of counts) {
    if (n > bestN || (n === bestN && best != null && r < best)) {
      best = r;
      bestN = n;
    }
  }
  return best;
}

/** แพ็ก D จากยอดวันทำงานออฟชอร์ + ชม.OT นอกแพ็ก (วันธรรมดา) */
function inferOffshorePackageRateFromDayAmount(
  amount: number,
  o15: number,
  o20: number,
  o30: number,
  nh: number,
): number {
  const beyond = Math.max(0, nh - 12);
  const extraWeight = o15 * 1.5 + o20 * 2 + o30 * 3 + beyond * 1.5;
  const denom = 14 + extraWeight;
  if (denom <= 0.005) return round2(amount);
  return round2((amount * 14) / denom);
}

function offshoreOt15RateFromPackage(packageRate: number): number {
  return round2((packageRate / 14) * 1.5);
}

function offshoreOt20RateFromPackage(packageRate: number): number {
  return round2((packageRate / 14) * 2);
}

function offshoreOt30RateFromPackage(packageRate: number): number {
  return round2((packageRate / 14) * 3);
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

function resolveStoredWorkDayGross(
  ts: DailyTimesheet,
  deps: PayrollTimesheetAggDeps,
  timesheetGrossById?: Record<string, number>,
): number | null {
  const tsId = String(ts.id || '').trim();
  if (tsId && timesheetGrossById) {
    const n = Number(timesheetGrossById[tsId]);
    if (Number.isFinite(n) && n > 0.005) return n;
  }
  const fromPrior = resolveFrozenTimesheetGrossAmount(ts, deps.priorPaidFrozen ?? null);
  if (fromPrior != null && fromPrior > 0.005) return fromPrior;
  if (tsId && deps.frozenTimesheetGrossById) {
    const n = Number(deps.frozenTimesheetGrossById[tsId]);
    if (Number.isFinite(n) && n > 0.005) return n;
  }
  const locked = Number(
    (ts as DailyTimesheet & { payrollLockedGrossBaht?: number }).payrollLockedGrossBaht,
  );
  if (Number.isFinite(locked) && locked > 0.005) return locked;
  return null;
}

function scaleWorkDayPartsToGross(
  parts: WorkDayPayslipAmountParts,
  targetGross: number,
): WorkDayPayslipAmountParts {
  const target = round2(targetGross);
  if (parts.gross <= 0.005 || Math.abs(parts.gross - target) <= 0.02) {
    return { ...parts, gross: target > 0.005 ? target : parts.gross };
  }
  const f = target / parts.gross;
  return {
    ...parts,
    gross: target,
    baseAmount: round2(parts.baseAmount * f),
    otAmount: round2(parts.otAmount * f),
    ot15Amount: round2(parts.ot15Amount * f),
    ot20Amount: round2(parts.ot20Amount * f),
    ot30Amount: round2(parts.ot30Amount * f),
    overflowOtAmount: round2(parts.overflowOtAmount * f),
    overflowBeyond12Amount: round2((parts.overflowBeyond12Amount ?? 0) * f),
  };
}

function workDayPartsForTimesheet(
  ts: DailyTimesheet,
  deps: PayrollTimesheetAggDeps,
  timesheetGrossById?: Record<string, number>,
): (WorkDayPayslipAmountParts & { packageRate: number }) | null {
  if (ts.eventType !== 'work_day') return null;
  const poLine = resolvePoLineForPayrollTimesheet(ts, deps.poLineMaps);
  const asgn = deps.assignmentById?.get(String(ts.assignmentId || '').trim());
  const wkLive = deps.workerById.get(ts.workerId);
  const wk = applyLaborCostEpochToWorkerForDate(wkLive, asgn, ts.date);
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

  let parts = computeWorkDayPayslipAmountParts({
    timesheet: ts,
    costPackagePerDay: baseCost,
    statedHours,
    otAfterShiftMultiplier: otMult,
    payrollRestSchedule: workerGlobalLaborToPayrollRestSchedule(deps.workerGlobalLabor),
  });
  if (!parts || parts.gross <= 0) return null;

  const stored = resolveStoredWorkDayGross(ts, deps, timesheetGrossById);
  if (stored != null) {
    parts = scaleWorkDayPartsToGross(parts, stored);
  }
  return { ...parts, packageRate: round2(baseCost) };
}

function accumulateWorkDayPartsIntoSplit(
  split: PayslipWorkDaySplit,
  parts: WorkDayPayslipAmountParts,
): void {
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

function finalizeWorkDaySplit(split: PayslipWorkDaySplit): PayslipWorkDaySplit {
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

function scaleSplitMoneyFields(split: PayslipWorkDaySplit, factor: number): PayslipWorkDaySplit {
  const out: PayslipWorkDaySplit = {
    ...split,
    normalAmount: round2(split.normalAmount * factor),
    holidayAmount: round2(split.holidayAmount * factor),
  };
  if (split.otAmount != null) out.otAmount = round2(split.otAmount * factor);
  if (split.ot15Amount != null) out.ot15Amount = round2(split.ot15Amount * factor);
  if (split.ot20Amount != null) out.ot20Amount = round2(split.ot20Amount * factor);
  if (split.ot30Amount != null) out.ot30Amount = round2(split.ot30Amount * factor);
  if (split.overflowOtAmount != null) out.overflowOtAmount = round2(split.overflowOtAmount * factor);
  if (split.overflowBeyond12Amount != null) {
    out.overflowBeyond12Amount = round2(split.overflowBeyond12Amount * factor);
  }
  return out;
}

/** ปรับยอดแยกให้ผลรวมเท่า pkgAmount — กัน remob/frozen ทำให้สูตรสดไม่ตรงยอดในงวด */
function alignSplitTotalToPkg(
  split: PayslipWorkDaySplit,
  pkgAmount: number,
): PayslipWorkDaySplit | null {
  const sum = payslipWorkDaySplitTotal(split);
  if (sum <= 0.005) return null;
  if (Math.abs(sum - pkgAmount) <= 0.05) return split;
  const scaled = scaleSplitMoneyFields(split, pkgAmount / sum);
  const after = payslipWorkDaySplitTotal(scaled);
  const drift = round2(pkgAmount - after);
  if (Math.abs(drift) >= 0.01) {
    if ((scaled.otAmount ?? 0) > 0.005) {
      scaled.otAmount = round2((scaled.otAmount ?? 0) + drift);
      if ((scaled.ot15Amount ?? 0) > 0.005) {
        scaled.ot15Amount = round2((scaled.ot15Amount ?? 0) + drift);
      }
    } else if (scaled.normalAmount > 0.005) {
      scaled.normalAmount = round2(scaled.normalAmount + drift);
    } else {
      scaled.holidayAmount = round2(scaled.holidayAmount + drift);
    }
  }
  return scaled;
}

function alignPositionSplitsToPkg(
  positionSplits: readonly PayslipWorkDayPositionSplit[],
  pkgAmount: number,
): PayslipWorkDayPositionSplit[] | null {
  if (!positionSplits.length) return null;
  const scaled = positionSplits.map((p) => ({ ...p }));
  const sum = round2(scaled.reduce((s, p) => s + payslipWorkDaySplitTotal(p), 0));
  if (sum <= 0.005) return null;
  const drift = round2(pkgAmount - sum);
  if (Math.abs(drift) < 0.01) return scaled;
  /** ปรับเฉพาะ OT แถวท้าย — ไม่แตะอัตราแพ็กต่อวัน (1800/2600) */
  const last = scaled[scaled.length - 1]!;
  last.otAmount = round2((last.otAmount ?? 0) + drift);
  if ((last.ot15Hours ?? 0) > 0 || (last.ot15Amount ?? 0) > 0.005 || drift > 0) {
    last.ot15Amount = round2((last.ot15Amount ?? 0) + drift);
  } else if (last.normalDays > 0 && last.normalAmount > 0.005) {
    /** ไม่มี OT — อย่าเปลี่ยน packageRate · ใส่ส่วนต่างใน normalAmount แต่ป้ายยังเป็น วัน×แพ็ก */
    last.normalAmount = round2(last.normalAmount + drift);
  } else {
    last.holidayAmount = round2(last.holidayAmount + drift);
  }
  return scaled;
}

/**
 * แยกยอด work_day แพ็กเป็นวันปกติ / วันหยุด / OT — **ไม่รวม standby_day**
 * ผลรวม normal + holiday + ot เท่ากับ earningsBreakdown.work_day_package ของชุด timesheet เดียวกัน
 */
export function computeWorkDayPackagePayslipSplit(
  tsList: readonly DailyTimesheet[],
  deps: PayrollTimesheetAggDeps,
  timesheetGrossById?: Record<string, number>,
): PayslipWorkDaySplit {
  const split = emptyWorkDaySplit();

  for (const ts of tsList) {
    if (ts.eventType === 'standby_day') continue;
    const parts = workDayPartsForTimesheet(ts, deps, timesheetGrossById);
    if (!parts || parts.gross <= 0) continue;
    accumulateWorkDayPartsIntoSplit(split, parts);
  }

  return finalizeWorkDaySplit(split);
}

/**
 * แยกค่าแรง work_day ตามตำแหน่ง + อัตราแพ็กต่อวัน (เช่น 1800 vs 2600)
 * วันหยุดแยกกลุ่ม — ไม่เฉลี่ยข้ามอัตรา
 */
export function computeWorkDayPackagePayslipPositionSplits(
  tsList: readonly DailyTimesheet[],
  deps: PayrollTimesheetAggDeps,
  timesheetGrossById?: Record<string, number>,
): PayslipWorkDayPositionSplit[] {
  const byKey = new Map<
    string,
    {
      split: PayslipWorkDaySplit;
      positionId: string;
      positionNameSnapshot: string;
      workMode?: string;
      packageRatePerDay: number;
      isHoliday: boolean;
    }
  >();

  for (const ts of tsList) {
    if (ts.eventType !== 'work_day') continue;
    const parts = workDayPartsForTimesheet(ts, deps, timesheetGrossById);
    if (!parts || parts.gross <= 0) continue;

    const positionId = String(ts.positionId || '').trim() || '_unknown_position';
    const workMode = String(ts.workMode || '').trim() || undefined;
    const isHoliday = !!parts.restDay.active;
    /** วันธรรมดาใช้แพ็ก D · วันหยุดใช้อัตราฐานวันนั้น (ไม่ปนกับ D) */
    const packageRatePerDay = isHoliday
      ? round2(parts.baseAmount)
      : round2(parts.packageRate);
    const key = `${positionId}\t${workMode || ''}\t${packageRatePerDay}\t${isHoliday ? 1 : 0}`;
    let bucket = byKey.get(key);
    if (!bucket) {
      const pos = positionId !== '_unknown_position' ? deps.posById.get(positionId) : undefined;
      bucket = {
        split: emptyWorkDaySplit(),
        positionId,
        positionNameSnapshot: resolvePositionDisplayName(pos) || 'ไม่ระบุตำแหน่ง',
        workMode,
        packageRatePerDay,
        isHoliday,
      };
      byKey.set(key, bucket);
    }
    accumulateWorkDayPartsIntoSplit(bucket.split, parts);
  }

  const out: PayslipWorkDayPositionSplit[] = [];
  for (const bucket of byKey.values()) {
    const split = finalizeWorkDaySplit(bucket.split);
    /** บังคับยอดค่าแรง = วัน × อัตราแพ็ก (วันธรรมดา) */
    if (!bucket.isHoliday && bucket.packageRatePerDay > 0 && split.normalDays > 0) {
      const canonicalLabor = round2(split.normalDays * bucket.packageRatePerDay);
      const laborDrift = round2(canonicalLabor - split.normalAmount);
      split.normalAmount = canonicalLabor;
      if (Math.abs(laborDrift) >= 0.01) {
        split.otAmount = round2((split.otAmount ?? 0) - laborDrift);
        if ((split.ot15Amount ?? 0) > 0.005 || laborDrift < 0) {
          split.ot15Amount = round2((split.ot15Amount ?? 0) - laborDrift);
        }
      }
    }
    out.push({
      positionId: bucket.positionId,
      positionNameSnapshot: bucket.positionNameSnapshot,
      ...(bucket.workMode ? { workMode: bucket.workMode } : {}),
      packageRatePerDay: bucket.packageRatePerDay,
      ...split,
    });
  }

  out.sort((a, b) => {
    const ka = `${a.positionNameSnapshot}\t${a.packageRatePerDay ?? 0}\t${a.workMode || ''}\t${a.positionId}`;
    const kb = `${b.positionNameSnapshot}\t${b.packageRatePerDay ?? 0}\t${b.workMode || ''}\t${b.positionId}`;
    return ka.localeCompare(kb, 'th');
  });
  return out;
}

/**
 * สร้างแยกตำแหน่งจาก dailyRowSnapshots
 * — วันธรรมดา: ค่าแรง = วัน × แพ็กจริง (1800/2600) + OT ชม.×อัตราจากแพ็ก
 * — วันหยุด (อาทิตย์ + นักขัตฤกษ์): ค่าแรงวันหยุด แยกอัตรารายวัน (ไม่เฉลี่ยข้ามอัตรา)
 */
export function buildPositionSplitsFromDailyRowSnapshots(
  snaps: readonly PayrollBatchLineDailyRowSnapshot[] | null | undefined,
  pkgAmount: number,
  opts?: {
    /** ชื่อตำแหน่งจาก master / splits ที่ generate ไว้ — เติมเมื่อ snapshot รายวันไม่มีชื่อ */
    positionNameById?: ReadonlyMap<string, string>;
    fallbackPositionName?: string;
  },
): PayslipWorkDayPositionSplit[] | null {
  if (!snaps?.length || pkgAmount <= 0.005) return null;
  const work = snaps.filter(
    (s) => String(s.eventType || '') === 'work_day' && Number(s.amount) > 0.005,
  );
  if (!work.length) return null;
  const daySum = round2(work.reduce((s, r) => s + (Number(r.amount) || 0), 0));
  if (daySum <= 0.005) return null;

  const resolvePosName = (row: PayrollBatchLineDailyRowSnapshot): string => {
    const fromRow = String(row.positionNameSnapshot || '').trim();
    if (fromRow && fromRow !== 'ไม่ระบุตำแหน่ง') return fromRow;
    const pid = String(row.positionId || '').trim();
    if (pid) {
      const fromMap = String(opts?.positionNameById?.get(pid) || '').trim();
      if (fromMap && fromMap !== 'ไม่ระบุตำแหน่ง') return fromMap;
    }
    const fb = String(opts?.fallbackPositionName || '').trim();
    if (fb && fb !== '—' && fb !== 'ไม่ระบุตำแหน่ง') return fb;
    return fromRow || 'ไม่ระบุตำแหน่ง';
  };

  /** อัตราแพ็กจากวันธรรมดาที่ไม่มี OT (เช่น 2600 ตรงๆ) — ข้ามอาทิตย์/นักขัตฤกษ์ */
  const peerByPos = new Map<string, number[]>();
  for (const row of work) {
    if (row.restDayKind === 'public_holiday' || row.restDayKind === 'weekly_rest') continue;
    if (ymdLocalDow(row.date) === 0) continue;
    const o15 = Math.max(0, Number(row.ot15Hours) || 0);
    const o20 = Math.max(0, Number(row.ot20Hours) || 0);
    const o30 = Math.max(0, Number(row.ot30Hours) || 0);
    const nh = Math.max(0, Number(row.normalHours) || 0);
    if (o15 + o20 + o30 > 0) continue;
    if (nh > 0 && nh < 12 && nh !== 8) continue;
    const posKey =
      String(row.positionId || '').trim() ||
      String(row.positionNameSnapshot || '').trim() ||
      '_unknown';
    const list = peerByPos.get(posKey) ?? [];
    list.push(Number(row.amount) || 0);
    peerByPos.set(posKey, list);
  }
  const packageByPos = new Map<string, number>();
  for (const [k, list] of peerByPos) {
    /** mode ก่อน แล้วตัด outlier ที่สูงกว่าแพ็ก (นักขัตฤกษ์ที่ยังไม่มี restDayKind) */
    let mode = modePackageRate(list);
    if (mode != null && mode > 0.005) {
      const filtered = list.filter((a) => a <= mode! * 1.05);
      const refined = modePackageRate(filtered.length ? filtered : list);
      if (refined != null) mode = refined;
    }
    if (mode != null) packageByPos.set(k, mode);
  }

  type Acc = {
    positionId: string;
    positionNameSnapshot: string;
    workMode?: string;
    packageRatePerDay: number;
    isHoliday: boolean;
    normalDays: number;
    normalAmount: number;
    holidayDays: number;
    holidayAmount: number;
    ot15Hours: number;
    ot15Amount: number;
    ot20Hours: number;
    ot20Amount: number;
    ot30Hours: number;
    ot30Amount: number;
    overflowBeyond12Hours: number;
    overflowBeyond12Amount: number;
  };
  const byKey = new Map<string, Acc>();

  const bump = (key: string, init: Acc, apply: (a: Acc) => void) => {
    let acc = byKey.get(key);
    if (!acc) {
      acc = init;
      byKey.set(key, acc);
    }
    apply(acc);
  };

  for (const row of work) {
    const positionId = String(row.positionId || '').trim() || '_unknown_position';
    const positionNameSnapshot = resolvePosName(row);
    const workMode = String(row.workMode || '').trim() || undefined;
    const posKey = positionId !== '_unknown_position' ? positionId : positionNameSnapshot;
    const amount = Number(row.amount) || 0;
    const nh = Math.max(0, Number(row.normalHours) || 0);
    const o15 = Math.max(0, Number(row.ot15Hours) || 0);
    const o20 = Math.max(0, Number(row.ot20Hours) || 0);
    const o30 = Math.max(0, Number(row.ot30Hours) || 0);
    const beyond12 = Math.max(0, nh - 12);

    let packageRate =
      packageByPos.get(posKey) ??
      packageByPos.get(positionNameSnapshot) ??
      null;
    const provisionalHoliday = isHolidayWorkDayFromSnapshotRow(row, packageRate);
    if (packageRate == null && !provisionalHoliday) {
      packageRate = inferOffshorePackageRateFromDayAmount(amount, o15, o20, o30, nh);
      if (packageRate > 0.005) packageByPos.set(posKey, packageRate);
    }
    if (packageRate == null || packageRate <= 0.005) {
      packageRate = round2(amount);
    }

    const isHolidayDay = isHolidayWorkDayFromSnapshotRow(row, packageRate);

    if (isHolidayDay) {
      /** วันหยุด: ทั้งวันคิดอัตราหยุด — แยกกลุ่มตามอัตรารายวัน ไม่ปน OT แพ็กวันธรรมดา */
      const dayRate = round2(amount);
      const key = `${positionId}\t${workMode || ''}\t${dayRate}\tholiday`;
      bump(
        key,
        {
          positionId,
          positionNameSnapshot,
          workMode,
          packageRatePerDay: dayRate,
          isHoliday: true,
          normalDays: 0,
          normalAmount: 0,
          holidayDays: 0,
          holidayAmount: 0,
          ot15Hours: 0,
          ot15Amount: 0,
          ot20Hours: 0,
          ot20Amount: 0,
          ot30Hours: 0,
          ot30Amount: 0,
          overflowBeyond12Hours: 0,
          overflowBeyond12Amount: 0,
        },
        (acc) => {
          acc.holidayDays += 1;
          acc.holidayAmount = round2(acc.holidayAmount + dayRate);
        },
      );
      continue;
    }

    const D = round2(packageRate);
    const labor = round2(D);
    /** OT = ยอดวันในงวด − แพ็กวัน — ชม.ตามใบงาน · อัตรา = OT÷ชม. (ใกล้ D/14×1.5) */
    const otPool = round2(Math.max(0, amount - labor));
    const otHoursTotal = o15 + o20 + o30 + beyond12;
    const otWeight = o15 * 1.5 + o20 * 2 + o30 * 3 + beyond12 * 1.5;
    let ot15Amt = 0;
    let ot20Amt = 0;
    let ot30Amt = 0;
    let beyondAmt = 0;
    if (otPool > 0.005 && otWeight > 0.005) {
      const alloc = (w: number) => round2(otPool * (w / otWeight));
      ot15Amt = alloc(o15 * 1.5);
      ot20Amt = alloc(o20 * 2);
      ot30Amt = alloc(o30 * 3);
      beyondAmt = alloc(beyond12 * 1.5);
      const otSum = round2(ot15Amt + ot20Amt + ot30Amt + beyondAmt);
      const otDrift = round2(otPool - otSum);
      if (Math.abs(otDrift) >= 0.01) {
        if (o15 > 0) ot15Amt = round2(ot15Amt + otDrift);
        else if (beyond12 > 0) beyondAmt = round2(beyondAmt + otDrift);
        else if (o20 > 0) ot20Amt = round2(ot20Amt + otDrift);
        else ot30Amt = round2(ot30Amt + otDrift);
      }
    } else if (otPool > 0.005 && otHoursTotal <= 0) {
      /** มียอดเกินแพ็กแต่ไม่ลงชม.OT — รวมในค่าแรงไม่ได้ ใส่ OT ทั่วไปไม่ได้ → คงใน labor ไม่ได้; เก็บใน ot15 0 ชม. ไม่โชว์ · ปรับวันท้าย */
      ot15Amt = otPool;
    }

    const key = `${positionId}\t${workMode || ''}\t${D}\tweekday`;
    bump(
      key,
      {
        positionId,
        positionNameSnapshot,
        workMode,
        packageRatePerDay: D,
        isHoliday: false,
        normalDays: 0,
        normalAmount: 0,
        holidayDays: 0,
        holidayAmount: 0,
        ot15Hours: 0,
        ot15Amount: 0,
        ot20Hours: 0,
        ot20Amount: 0,
        ot30Hours: 0,
        ot30Amount: 0,
        overflowBeyond12Hours: 0,
        overflowBeyond12Amount: 0,
      },
      (acc) => {
        acc.normalDays += 1;
        acc.normalAmount = round2(acc.normalAmount + labor);
        acc.ot15Hours += o15;
        acc.ot15Amount = round2(acc.ot15Amount + ot15Amt);
        acc.ot20Hours += o20;
        acc.ot20Amount = round2(acc.ot20Amount + ot20Amt);
        acc.ot30Hours += o30;
        acc.ot30Amount = round2(acc.ot30Amount + ot30Amt);
        acc.overflowBeyond12Hours += beyond12;
        acc.overflowBeyond12Amount = round2(acc.overflowBeyond12Amount + beyondAmt);
      },
    );
  }

  const raw: PayslipWorkDayPositionSplit[] = [...byKey.values()].map((acc) => {
    const otAmount = round2(
      acc.ot15Amount + acc.ot20Amount + acc.ot30Amount + acc.overflowBeyond12Amount,
    );
    return {
      positionId: acc.positionId,
      positionNameSnapshot: acc.positionNameSnapshot,
      ...(acc.workMode ? { workMode: acc.workMode } : {}),
      packageRatePerDay: acc.packageRatePerDay,
      normalDays: acc.normalDays,
      normalAmount: round2(acc.normalAmount),
      holidayDays: acc.holidayDays,
      holidayAmount: round2(acc.holidayAmount),
      otAmount,
      ot15Hours: acc.ot15Hours,
      ot20Hours: acc.ot20Hours,
      ot30Hours: acc.ot30Hours,
      ot15Amount: round2(acc.ot15Amount),
      ot20Amount: round2(acc.ot20Amount),
      ot30Amount: round2(acc.ot30Amount),
      overflowBeyond12Hours: round2(acc.overflowBeyond12Hours),
      overflowBeyond12Amount: round2(acc.overflowBeyond12Amount),
      overflowNormalHours: 0,
      overflowOtAmount: 0,
    };
  });

  const target = Math.abs(daySum - pkgAmount) <= 0.05 ? daySum : pkgAmount;
  return alignPositionSplitsToPkg(raw, target);
}

function pushOtLinesForPosition(
  lines: PayslipLineItem[],
  posName: string,
  split: PayslipWorkDayPositionSplit,
): number {
  const D = Number(split.packageRatePerDay) || 0;
  const expected15 = D > 0 ? offshoreOt15RateFromPackage(D) : 0;
  const expected20 = D > 0 ? offshoreOt20RateFromPackage(D) : 0;
  const expected30 = D > 0 ? offshoreOt30RateFromPackage(D) : 0;

  const mk = (hours: number, amount: number, expectedRate: number, tier: string | null) => {
    if (hours <= 0 || amount <= 0.005) return null;
    /** ใช้อัตราจากแพ็กเมื่อตรงกับยอด · ไม่เช่นนั้นใช้อัตราจากยอด÷ชม.จริง */
    const fromAmt = round2(amount / hours);
    const unitRate =
      expectedRate > 0 && Math.abs(fromAmt - expectedRate) <= 0.02 ? expectedRate : fromAmt;
    return otPositionPayslipLine(posName, tier, hours, unitRate, amount);
  };

  let pushed = 0;
  const h15 = (split.ot15Hours ?? 0) + (split.overflowBeyond12Hours ?? 0);
  const a15 = round2((split.ot15Amount ?? 0) + (split.overflowBeyond12Amount ?? 0));
  const line15 = mk(h15, a15, expected15, null);
  if (line15) {
    lines.push(line15);
    pushed += 1;
  }
  const line20 = mk(split.ot20Hours ?? 0, split.ot20Amount ?? 0, expected20, '2.0');
  if (line20) {
    lines.push(line20);
    pushed += 1;
  }
  const line30 = mk(split.ot30Hours ?? 0, split.ot30Amount ?? 0, expected30, '3.0');
  if (line30) {
    lines.push(line30);
    pushed += 1;
  }
  const lineOv = mk(
    split.overflowNormalHours ?? 0,
    split.overflowOtAmount ?? 0,
    expected15,
    null,
  );
  if (lineOv) {
    lines.push(lineOv);
    pushed += 1;
  }
  return pushed;
}

function pushAggregateWorkDaySplitLines(
  lines: PayslipLineItem[],
  split: PayslipWorkDaySplit,
  labelPrefix: string,
): boolean {
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

function pushPositionWorkDaySplitLines(
  lines: PayslipLineItem[],
  positionSplits: readonly PayslipWorkDayPositionSplit[],
  labelPrefix: string,
): boolean {
  const pfx = labelPrefix.trim();
  let any = false;
  for (const pos of positionSplits) {
    const posName = pos.positionNameSnapshot.trim() || 'ไม่ระบุตำแหน่ง';
    const laborTitle = pfx ? `${pfx} ค่าแรง ${posName}` : `ค่าแรง ${posName}`;
    const holidayTitle = pfx ? `${pfx} ค่าแรงวันหยุด ${posName}` : `ค่าแรงวันหยุด ${posName}`;
    const pkgRate = Number(pos.packageRatePerDay) || 0;

    if (pos.normalDays > 0 && pkgRate > 0.005) {
      const n = workDayPackageRateLine(laborTitle, pos.normalDays, pkgRate);
      if (n) {
        lines.push(n);
        any = true;
      }
    } else if (pos.normalDays > 0 && pos.normalAmount > 0.005) {
      const n = workDayBaseIncomeLine(laborTitle, pos.normalDays, pos.normalAmount);
      if (n) {
        lines.push(n);
        any = true;
      }
    }

    if (pos.holidayDays > 0 && pkgRate > 0.005 && pos.normalDays <= 0) {
      /** กลุ่มวันหยุดที่แยกอัตราไว้แล้ว */
      const h = workDayPackageRateLine(holidayTitle, pos.holidayDays, pkgRate);
      if (h) {
        lines.push(h);
        any = true;
      }
    } else if (pos.holidayDays > 0 && pos.holidayAmount > 0.005) {
      const h = workDayBaseIncomeLine(holidayTitle, pos.holidayDays, pos.holidayAmount);
      if (h) {
        lines.push(h);
        any = true;
      }
    }

    if (pos.otAmount != null) {
      if (pushOtLinesForPosition(lines, posName, pos) > 0) any = true;
    }
  }
  return any;
}

/** true ถ้าใส่บรรทัดแทน work_day_package แล้ว */
export function pushWorkDayPayslipIncomeLines(
  lines: PayslipLineItem[],
  pkgAmount: number,
  split: PayslipWorkDaySplit | null | undefined,
  labelPrefix: string,
  positionSplits?: readonly PayslipWorkDayPositionSplit[] | null,
  dailyRowSnapshots?: readonly PayrollBatchLineDailyRowSnapshot[] | null,
  positionNameOpts?: {
    positionNameById?: ReadonlyMap<string, string>;
    fallbackPositionName?: string;
  },
): boolean {
  const nameById = new Map<string, string>();
  if (positionNameOpts?.positionNameById) {
    for (const [k, v] of positionNameOpts.positionNameById) {
      const id = String(k || '').trim();
      const name = String(v || '').trim();
      if (id && name && name !== 'ไม่ระบุตำแหน่ง' && name !== '—') nameById.set(id, name);
    }
  }
  for (const pos of positionSplits ?? []) {
    const id = String(pos.positionId || '').trim();
    const name = String(pos.positionNameSnapshot || '').trim();
    if (id && name && name !== 'ไม่ระบุตำแหน่ง' && !nameById.has(id)) nameById.set(id, name);
  }
  const nameOpts = {
    positionNameById: nameById.size > 0 ? nameById : undefined,
    fallbackPositionName: positionNameOpts?.fallbackPositionName,
  };

  /** รายวันในงวดเป็นแหล่งอัตราจริง (1800/2600) — ใช้ก่อน split เก่าที่อาจเฉลี่ย */
  const fromSnaps = buildPositionSplitsFromDailyRowSnapshots(dailyRowSnapshots, pkgAmount, nameOpts);
  if (fromSnaps && pushPositionWorkDaySplitLines(lines, fromSnaps, labelPrefix)) {
    return true;
  }

  if (positionSplits && positionSplits.length > 0) {
    const withNames = positionSplits.map((p) => {
      const name = String(p.positionNameSnapshot || '').trim();
      if (name && name !== 'ไม่ระบุตำแหน่ง') return p;
      const id = String(p.positionId || '').trim();
      const fromMap = id ? nameById.get(id) : undefined;
      const fb = String(positionNameOpts?.fallbackPositionName || '').trim();
      const resolved =
        fromMap && fromMap !== '—'
          ? fromMap
          : fb && fb !== '—' && fb !== 'ไม่ระบุตำแหน่ง'
            ? fb
            : '';
      if (!resolved) return p;
      return { ...p, positionNameSnapshot: resolved };
    });
    const aligned = alignPositionSplitsToPkg(withNames, pkgAmount);
    if (aligned && pushPositionWorkDaySplitLines(lines, aligned, labelPrefix)) {
      return true;
    }
  }

  if (!split) return false;
  const alignedAgg = alignSplitTotalToPkg(split, pkgAmount);
  if (!alignedAgg) return false;
  return pushAggregateWorkDaySplitLines(lines, alignedAgg, labelPrefix);
}
