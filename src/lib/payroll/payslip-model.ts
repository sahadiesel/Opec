import type {
  OfficePayrollLine,
  OfficePayrollRun,
  PayrollBatch,
  PayrollBatchIncomeSegment,
  PayrollBatchLine,
  PayrollLineD8Snapshot,
  PayrollRunStatus,
  PayslipWorkDaySplit,
  DailyTimesheet,
} from '@/lib/types';
import { formatPriorPeriodAllowancePayslipLabel } from '@/lib/payroll/prior-period-allowance';
import { formatDateThaiBE, formatOfficePayrollRunPeriodLabelThaiBE, formatYmdRangeThaiBE } from '@/lib/date-thai';
import { leaveSummaryLabelTh } from '@/lib/payroll/office-payroll-period-deductions';
import { computeRegistryWorkerTimesheetGross } from '@/lib/payroll/registry-worker-timesheet-gross';
import { resolvePoLineForPayrollTimesheet } from '@/lib/payroll/timesheet-labor-base-cost';
import { isPayrollCostStandbyPackageEvent, payrollStandbyPackageEventUnits } from '@/lib/payroll/package-labor-cost';
import {
  computeWorkDayPackagePayslipSplit,
  payslipWorkDaySplitTotal,
  pushWorkDayPayslipIncomeLines,
} from '@/lib/payroll/work-day-payslip-split';
import type { SingleTimesheetGrossContext } from '@/lib/payroll/single-timesheet-gross';

export const PAYSLIP_DEFAULT_COMPANY_TH = 'โอพีอีซี ออปส์โฟลว์';
export const PAYSLIP_DEFAULT_COMPANY_EN = 'OPEC OpsFlow';

/**
 * Firestore บางครั้งเก็บ array เป็น map — ทำให้ for…of พัง และสลิป/ตารางเสีย multi-PO
 */
export function normalizeIncomeSegments(
  raw: PayrollBatchLine['incomeSegments'] | unknown,
): PayrollBatchIncomeSegment[] {
  if (Array.isArray(raw)) {
    return raw.filter((s): s is PayrollBatchIncomeSegment => !!s && typeof s === 'object');
  }
  if (raw && typeof raw === 'object') {
    return Object.values(raw as Record<string, PayrollBatchIncomeSegment>).filter(
      (s): s is PayrollBatchIncomeSegment =>
        !!s && typeof s === 'object' && typeof (s as PayrollBatchIncomeSegment).purchaseOrderId === 'string',
    );
  }
  return [];
}

/** ข้อมูลบริษัทจาก `system/company_profile` (หรือ undefined แล้วใช้ค่าเริ่มต้น) */
export type PayslipCompanyProfileSource = {
  companyNameTh?: string;
  companyNameEn?: string;
  documentHeaderLogoUrl?: string | null;
} | null | undefined;

function resolvePayslipCompanyNames(source: PayslipCompanyProfileSource): { companyNameTh: string; companyNameEn: string } {
  return {
    companyNameTh: source?.companyNameTh?.trim() || PAYSLIP_DEFAULT_COMPANY_TH,
    companyNameEn: source?.companyNameEn?.trim() || PAYSLIP_DEFAULT_COMPANY_EN,
  };
}

export type PayslipLineItem = { label: string; amount: number };

export type PayslipLeaveSummaryLine = {
  label: string;
  detail: string;
};

export type PayslipViewModel = {
  companyNameTh: string;
  companyNameEn: string;
  /** โลโก้จาก company profile ถ้ามี */
  companyLogoUrl?: string;
  employeeName: string;
  periodLabel: string;
  payrollTypeLabel: string;
  documentRef: string;
  /** แสดงเมื่องวดอนุมัติแล้วเท่านั้น (office) — ไม่ตั้งค่าก่อน HR อนุมัติ */
  paymentDateLabel?: string;
  isSupplemental?: boolean;
  normalPaymentDateLabel?: string;
  policyVersionLabel: string;
  /** รายการรายได้แต่ละบรรทัด (ครบทั้ง timesheet + HR) */
  incomeLines: PayslipLineItem[];
  grossTotal: number;
  /** รายการหักแต่ละบรรทัด */
  deductionLines: PayslipLineItem[];
  deductionsTotal: number;
  netPay: number;
  /** สรุปวันลาในงวด (office payroll) */
  leaveSummaryLines?: PayslipLeaveSummaryLine[];
  /** true ถ้ายอดรวมรายการกับ snapshot คลาดกันเล็กน้อย (ปัดเศษ) */
  roundingNote?: boolean;
  /** ข้อมูลสำหรับงวดตกเบิก (Supplemental Run) */
  normalIncomeLines?: PayslipLineItem[];
  normalGrossTotal?: number;
  normalDeductionLines?: PayslipLineItem[];
  normalDeductionsTotal?: number;
  normalNetPay?: number;
};

export function formatPolicyVersionFromSnapshot(s?: PayrollLineD8Snapshot | null): string {
  if (!s) return '— (ยังไม่มี D8 snapshot)';
  const pol = s.policiesApplied?.length
    ? s.policiesApplied.map((p) => `${p.kind}: ${p.policyName}`).join(' · ')
    : '';
  return [s.engineVersion, pol].filter(Boolean).join(' — ');
}

function formatPaymentDate(ts?: number | null): string {
  if (ts == null || !Number.isFinite(ts)) return '— (ยังไม่ระบุวันจ่าย)';
  return formatDateThaiBE(ts);
}

/** แปลงคีย์ earningsBreakdown / earningsComponents เป็นชื่อที่อ่านได้ */
export function humanizeWorkerEarningsKey(key: string): string {
  const k = key.replace(/_policy$/i, '').replace(/_package$/i, '');
  const map: Record<string, string> = {
    work_day: 'ค่าจ้างวันทำงาน',
    standby_day: 'Standby / พร้อมปฏิบัติงาน',
    off_day_worked: 'วันหยุดทำงาน (Off day)',
    public_holiday_worked: 'วันหยุดนักขัตฤกษ์ (ทำงาน)',
    mobilization_day: 'Mobilization',
    demobilization_day: 'Demobilization',
    travel_day: 'เดินทาง (Travel)',
    hr_allowances: 'เบี้ยเลี้ยง / รายได้พิเศษ (ปรับ HR)',
    standby: 'Standby',
  };
  if (map[k]) return map[k];
  if (/_policy$/i.test(key)) return `${humanizeWorkerEarningsKey(k)} (ตาม policy)`;
  if (/_package$/i.test(key)) return `${humanizeWorkerEarningsKey(k)} (แพ็กเกจ)`;
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function humanizeDeductionKey(key: string): string {
  if (key.startsWith('manual_ded_')) return key;
  const map: Record<string, string> = {
    social_security: 'ประกันสังคม',
    pit_withholding: 'ภาษี ณ ที่จ่าย (ภงด. 1)',
    cash_advance_recovery: 'หักคืนเบิกล่วงหน้า',
    late_deduction: 'หักมาสาย',
    absence_deduction: 'หักขาดงาน (จากสแกน)',
    unpaid_leave_deduction: 'หักลาเกินสิทธิ์ / ลาไม่อนุมัติ',
    pre_employment_deduction: 'หักก่อนวันเริ่มงาน (เงินเดือนไม่เต็มเดือน)',
    post_employment_deduction: 'หักหลังวันสิ้นสุดการจ้าง',
  };
  return map[key] || key.replace(/_/g, ' ');
}

function workerPaymentTimestamp(batch: PayrollBatch): number | undefined {
  return (
    batch.financePreparedAt ??
    batch.hrApprovedAt ??
    batch.lockedAt ??
    batch.updatedAt ??
    batch.createdAt
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatThaiMoneyAmount(n: number): string {
  return new Intl.NumberFormat('th-TH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
}

function standbyDaysFromEventBreakdown(ev: Record<string, number> | undefined): number {
  // รวม standby_day + mobilization_day + demobilization_day ทั้งหมดที่เป็น standby-package events
  const n =
    (Number(ev?.standby_day) || 0) +
    (Number(ev?.mobilization_day) || 0) +
    (Number(ev?.demobilization_day) || 0) +
    (Number(ev?.travel_day) || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function daysForStandbyLikeEarningsKey(
  earningsKey: string,
  eventBreakdown: Record<string, number> | undefined,
): number {
  const k = earningsKey.replace(/_policy$/i, '').replace(/_package$/i, '');
  if (k === 'mobilization_day') {
    const n = Number(eventBreakdown?.mobilization_day) || 0;
    return n > 0 ? n : 0;
  }
  if (k === 'demobilization_day') {
    const n = Number(eventBreakdown?.demobilization_day) || 0;
    return n > 0 ? n : 0;
  }
  if (k === 'standby_day') {
    const n = Number(eventBreakdown?.standby_day) || 0;
    // legacy batches รวม M1/D1 ไว้ใน standby_day_package — นับทุกชนิดที่เกี่ยวกับแพ็ก standby
    if (n > 0) return n;
    return standbyDaysFromEventBreakdown(eventBreakdown);
  }
  return standbyDaysFromEventBreakdown(eventBreakdown);
}

function isStandbyLikePackageOrPolicyKey(key: string): boolean {
  const k = key.replace(/_policy$/i, '').replace(/_package$/i, '');
  return k === 'standby_day' || k === 'mobilization_day' || k === 'demobilization_day';
}

function standbyPayslipLine(
  labelPrefix: string,
  earningsKey: string,
  amount: number,
  eventBreakdown: Record<string, number> | undefined,
): PayslipLineItem {
  let days = daysForStandbyLikeEarningsKey(earningsKey, eventBreakdown);
  if (days <= 0 && amount > 0.005) days = 1;
  const title = humanizeWorkerEarningsKey(earningsKey);
  const base = labelPrefix.trim() ? `${labelPrefix.trim()} ${title}` : title;
  const rate = round2(amount / days);
  const product = round2(days * rate);
  const consistent = Math.abs(product - amount) <= 0.02;
  const label = consistent
    ? `${base} ${days} วัน × ${formatThaiMoneyAmount(rate)}`
    : `${base} ${days} วัน (เฉลี่ยวันละ ${formatThaiMoneyAmount(rate)} บาท)`;
  return { label, amount: round2(amount) };
}

/** true ถ้าใส่บรรทัดแทน work_day_package แล้ว */
function tryPushWorkDayPackageSplitLines(
  lines: PayslipLineItem[],
  pkgAmount: number,
  split: PayslipWorkDaySplit | null | undefined,
  labelPrefix: string,
): boolean {
  return pushWorkDayPayslipIncomeLines(lines, pkgAmount, split, labelPrefix);
}

/**
 * ป้ายกำกับฝั่งสัญญา/ลูกค้าบนสลิป — ไม่โชว์ Firestore id
 * ลำดับ: label จาก map → ชื่อลูกค้า → รหัส PO → ไม่ระบุ
 */
export function formatPayslipPoPartyLabel(
  poId: string,
  opts?: {
    customerName?: string | null;
    poCode?: string | null;
    labelOverride?: string | null;
  },
): string {
  const override = opts?.labelOverride?.trim();
  if (override) return `[${override}]`;
  const cust = opts?.customerName?.trim();
  if (cust) return `[${cust}]`;
  const po = opts?.poCode?.trim();
  if (po) return `[${po}]`;
  const id = String(poId || '').trim();
  if (!id || id === '_unknown_po') return '[ไม่ระบุ PO]';
  /** Firestore doc id — ผู้ใช้ดูไม่รู้เรื่อง */
  if (/^[A-Za-z0-9]{16,}$/.test(id)) return '[ไม่ระบุลูกค้า]';
  return `[${id}]`;
}

function payslipIncomeSegmentPrefix(
  seg: PayrollBatchIncomeSegment,
  labelByPoId?: ReadonlyMap<string, string>,
): string {
  const id = String(seg.purchaseOrderId || '').trim();
  return formatPayslipPoPartyLabel(id, {
    labelOverride: id ? labelByPoId?.get(id) : undefined,
    customerName: seg.customerNameSnapshot,
    poCode: seg.poCodeSnapshot,
  });
}

/**
 * รายได้รายบรรทัด — อ้างอิง snapshot ก่อน แล้วจึง earningsBreakdown + รายการเบี้ยเลี้ยงจาก HR
 */
export function buildWorkerPayslipIncomeLines(
  line: PayrollBatchLine,
  poPartyLabelById?: ReadonlyMap<string, string>,
): PayslipLineItem[] {
  const allowanceItems = (line.hrLineAdjustments?.allowanceItems ?? []).filter(
    (x) => (Number(x.amount) || 0) > 0,
  );
  const priorPeriodItems = (line.hrLineAdjustments?.priorPeriodAllowanceItems ?? []).filter(
    (x) => (Number(x.amount) || 0) > 0,
  );

  const lines: PayslipLineItem[] = [];

  for (const it of priorPeriodItems) {
    lines.push({
      label: formatPriorPeriodAllowancePayslipLabel(it),
      amount: round2(Number(it.amount) || 0),
    });
  }

  for (const it of allowanceItems) {
    lines.push({
      label: it.label?.trim() || 'รายได้เพิ่ม (HR)',
      amount: round2(Number(it.amount) || 0),
    });
  }

  const incomeSegments = normalizeIncomeSegments(line.incomeSegments);
  const multiSeg = incomeSegments.length > 1;
  if (multiSeg) {
    const sorted = [...incomeSegments].sort((a, b) => {
      const ka = `${a.poCodeSnapshot || ''}\t${a.purchaseOrderId}`;
      const kb = `${b.poCodeSnapshot || ''}\t${b.purchaseOrderId}`;
      return ka.localeCompare(kb, 'th');
    });
    for (const seg of sorted) {
      const prefix = payslipIncomeSegmentPrefix(seg, poPartyLabelById);
      const eb = seg.earningsBreakdown || {};
      const keys = Object.keys(eb).sort((a, b) => a.localeCompare(b));
      for (const k of keys) {
        const amt = round2(Number(eb[k]) || 0);
        if (Math.abs(amt) < 0.005) continue;
        if (k === 'work_day_package' && tryPushWorkDayPackageSplitLines(lines, amt, seg.payslipWorkDaySplit, prefix)) {
          continue;
        }
        if (isStandbyLikePackageOrPolicyKey(k)) {
          lines.push(standbyPayslipLine(prefix, k, amt, seg.eventBreakdown));
          continue;
        }
        lines.push({ label: `${prefix} ${humanizeWorkerEarningsKey(k)}`, amount: amt });
      }
    }
    return lines;
  }

  const fromSnapshot = line.d8Snapshot?.earningsComponents;
  const baseEb = { ...(fromSnapshot && Object.keys(fromSnapshot).length > 0 ? fromSnapshot : line.earningsBreakdown || {}) };

  if (allowanceItems.length > 0 || priorPeriodItems.length > 0) {
    delete baseEb.hr_allowances;
  }

  const keys = Object.keys(baseEb).sort((a, b) => a.localeCompare(b));
  for (const k of keys) {
    const amt = round2(Number(baseEb[k]) || 0);
    if (Math.abs(amt) < 0.005) continue;
    if (k === 'work_day_package' && tryPushWorkDayPackageSplitLines(lines, amt, line.payslipWorkDaySplit, '')) {
      continue;
    }
    if (isStandbyLikePackageOrPolicyKey(k)) {
      lines.push(standbyPayslipLine('', k, amt, line.eventBreakdown));
      continue;
    }
    lines.push({ label: humanizeWorkerEarningsKey(k), amount: amt });
  }

  return lines;
}

/**
 * สร้างบรรทัดรายได้จากใบงานรายวัน — แยกต่อ PO: work_day / M1 / D1 / OT
 * ใช้บนหน้ารายละเอียดค่าจ้างเมื่อโหลด timesheets แล้ว (สลิป preview ตรงกับตารางรายวัน)
 */
export function buildWorkerPayslipIncomeLinesFromTimesheets(
  line: PayrollBatchLine,
  timesheets: readonly DailyTimesheet[],
  ctx: SingleTimesheetGrossContext,
  poPartyLabelById?: ReadonlyMap<string, string>,
): PayslipLineItem[] {
  const allowanceItems = (line.hrLineAdjustments?.allowanceItems ?? []).filter(
    (x) => (Number(x.amount) || 0) > 0,
  );
  const priorPeriodItems = (line.hrLineAdjustments?.priorPeriodAllowanceItems ?? []).filter(
    (x) => (Number(x.amount) || 0) > 0,
  );
  const lines: PayslipLineItem[] = [
    ...priorPeriodItems.map((it) => ({
      label: formatPriorPeriodAllowancePayslipLabel(it),
      amount: round2(Number(it.amount) || 0),
    })),
    ...allowanceItems.map((it) => ({
      label: it.label?.trim() || 'รายได้เพิ่ม (HR)',
      amount: round2(Number(it.amount) || 0),
    })),
  ];

  const byPo = new Map<string, DailyTimesheet[]>();
  for (const ts of timesheets) {
    const pid = String(ts.purchaseOrderId || '').trim() || '_unknown_po';
    const list = byPo.get(pid) ?? [];
    list.push(ts);
    byPo.set(pid, list);
  }

  const segByPo = new Map<string, PayrollBatchIncomeSegment>();
  for (const seg of normalizeIncomeSegments(line.incomeSegments)) {
    segByPo.set(String(seg.purchaseOrderId || '').trim() || '_unknown_po', seg);
  }

  const poIds = [...byPo.keys()].sort((a, b) => {
    const sa = segByPo.get(a);
    const sb = segByPo.get(b);
    const ka = `${sa?.poCodeSnapshot || ''}\t${a}`;
    const kb = `${sb?.poCodeSnapshot || ''}\t${b}`;
    return ka.localeCompare(kb, 'th');
  });

  const multiPo = poIds.length > 1;

  for (const poId of poIds) {
    const group = byPo.get(poId) ?? [];
    const seg = segByPo.get(poId);
    const prefix = multiPo
      ? formatPayslipPoPartyLabel(poId, {
          labelOverride: poPartyLabelById?.get(poId),
          customerName: seg?.customerNameSnapshot,
          poCode: seg?.poCodeSnapshot,
        })
      : '';

    let standbyDays = 0;
    let standbyAmount = 0;
    let mobDays = 0;
    let mobAmount = 0;
    let demobDays = 0;
    let demobAmount = 0;
    const policyAmounts: Record<string, number> = {};

    for (const ts of group) {
      const poLine = resolvePoLineForPayrollTimesheet(ts, ctx.poLineMaps);
      const wk = ctx.workerById.get(ts.workerId);
      const linePos = ts.positionId ? ctx.posById.get(ts.positionId) : undefined;
      const r = computeRegistryWorkerTimesheetGross(ts, {
        worker: wk,
        linePosition: linePos,
        poLine,
        contractMap: ctx.contractMap,
        poContractById: ctx.poContractById,
        poWorkModeByPoId: ctx.poWorkModeByPoId,
        workerGlobalLabor: ctx.workerGlobalLabor,
      });
      if (r.gross <= 0) continue;

      if (isPayrollCostStandbyPackageEvent(ts.eventType) && r.usedPackageLaborCost) {
        const units = payrollStandbyPackageEventUnits(ts);
        if (ts.eventType === 'mobilization_day') {
          mobDays += units;
          mobAmount += r.gross;
        } else if (ts.eventType === 'demobilization_day') {
          demobDays += units;
          demobAmount += r.gross;
        } else {
          standbyDays += units;
          standbyAmount += r.gross;
        }
        continue;
      }
      if (ts.eventType === 'work_day' && r.usedPackageLaborCost) {
        continue;
      }
      const policyKey = `${ts.eventType}_policy`;
      policyAmounts[policyKey] = (policyAmounts[policyKey] || 0) + r.gross;
    }

    const workDayPkg = round2(
      Number(seg?.earningsBreakdown?.work_day_package) ||
        (poIds.length === 1
          ? Number(line.earningsBreakdown?.work_day_package) ||
            Number(line.d8Snapshot?.earningsComponents?.work_day_package) ||
            0
          : 0),
    );
    const split =
      seg?.payslipWorkDaySplit ??
      computeWorkDayPackagePayslipSplit(group, {
        poLineMaps: ctx.poLineMaps,
        poContractById: ctx.poContractById,
        poWorkModeByPoId: ctx.poWorkModeByPoId,
        workerById: ctx.workerById,
        posById: ctx.posById,
        contractMap: ctx.contractMap,
        workerGlobalLabor: ctx.workerGlobalLabor,
      });
    const pkgForPush = workDayPkg > 0.005 ? workDayPkg : payslipWorkDaySplitTotal(split);
    if (!pushWorkDayPayslipIncomeLines(lines, pkgForPush, split, prefix)) {
      const fallbackPkg = round2(split.normalAmount + split.holidayAmount + (split.otAmount ?? 0));
      if (fallbackPkg > 0.005) {
        pushWorkDayPayslipIncomeLines(lines, fallbackPkg, split, prefix);
      }
    }
    if (standbyDays > 0 && standbyAmount > 0.005) {
      lines.push(
        standbyPayslipLine(prefix, 'standby_day', round2(standbyAmount), { standby_day: standbyDays }),
      );
    }
    if (mobDays > 0 && mobAmount > 0.005) {
      lines.push(
        standbyPayslipLine(prefix, 'mobilization_day', round2(mobAmount), {
          mobilization_day: mobDays,
        }),
      );
    }
    if (demobDays > 0 && demobAmount > 0.005) {
      lines.push(
        standbyPayslipLine(prefix, 'demobilization_day', round2(demobAmount), {
          demobilization_day: demobDays,
        }),
      );
    }

    for (const k of Object.keys(policyAmounts).sort((a, b) => a.localeCompare(b))) {
      const amt = round2(policyAmounts[k]);
      if (Math.abs(amt) < 0.005) continue;
      if (isStandbyLikePackageOrPolicyKey(k)) {
        lines.push(standbyPayslipLine(prefix, k, amt, seg?.eventBreakdown ?? line.eventBreakdown));
      } else {
        lines.push({
          label: prefix ? `${prefix} ${humanizeWorkerEarningsKey(k)}` : humanizeWorkerEarningsKey(k),
          amount: amt,
        });
      }
    }
  }

  return lines;
}

export function buildWorkerPayslipDeductionLines(line: PayrollBatchLine): PayslipLineItem[] {
  const d = line.deductionsBreakdown || line.d8Snapshot?.deductions || {};
  const manual = line.hrLineAdjustments?.deductionItems ?? [];
  const out: PayslipLineItem[] = [];

  const ss = round2(Number(d.social_security) || 0);
  if (ss > 0.005) {
    out.push({ label: 'ประกันสังคม', amount: ss });
  }

  const pit = round2(Number(d.pit_withholding) || 0);
  if (Math.abs(pit) > 0.005) {
    const periodYm = (line.periodEndDate || line.periodStartDate || '').slice(0, 7);
    const pitLabel =
      /^\d{4}-\d{2}$/.test(periodYm)
        ? `ภาษี ณ ที่จ่าย (ภงด. 1) — งวด ${periodYm}`
        : 'ภาษี ณ ที่จ่าย (ภงด. 1)';
    out.push({ label: pitLabel, amount: pit });
  }

  manual.forEach((item, idx) => {
    const key = `manual_ded_${idx}`;
    const amt = round2(Number(d[key]) || 0);
    if (amt <= 0) return;
    out.push({
      label: item.label?.trim() || `รายการหักพิเศษ (${idx + 1})`,
      amount: amt,
    });
  });

  const known = new Set<string>(['social_security', 'pit_withholding']);
  manual.forEach((_, i) => known.add(`manual_ded_${i}`));

  for (const [k, v] of Object.entries(d)) {
    if (known.has(k)) continue;
    const amt = round2(Number(v) || 0);
    if (amt === 0) continue;
    /** กันซ้ำประกันสังคมจาก key อื่น */
    const label = humanizeDeductionKey(k);
    if (label === 'ประกันสังคม' || /social.?security|ประกันสังคม/i.test(k)) {
      const existing = out.find((x) => x.label === 'ประกันสังคม');
      if (existing) {
        existing.amount = round2(existing.amount + amt);
        continue;
      }
    }
    out.push({ label, amount: amt });
  }

  return out;
}

function sumLines(lines: PayslipLineItem[]): number {
  return round2(lines.reduce((s, x) => s + x.amount, 0));
}

/** งวด NORMAL อื่นใน period เดียวกันที่จ่ายไปแล้ว — หักจากสลิปรอบหลัง */
export type PriorPaidPayrollSlipRef = {
  line: PayrollBatchLine;
  batch: PayrollBatch;
};

function resolveLineNetForPayslip(line: PayrollBatchLine): number {
  const netFromLine = round2(line.netAmount);
  const netFromSnapshot = line.d8Snapshot?.net != null ? round2(line.d8Snapshot.net) : null;
  const hasCashAdvanceRecovery = Number(line.deductionsBreakdown?.cash_advance_recovery) > 0;
  return hasCashAdvanceRecovery || netFromSnapshot == null ? netFromLine : netFromSnapshot;
}

function pushAlreadyPaidDeduction(
  deductionLines: PayslipLineItem[],
  netPaid: number,
  kindLabel: string,
  paymentDateLabel?: string,
): void {
  if (netPaid <= 0.005) return;
  const pDateLabel =
    paymentDateLabel && paymentDateLabel !== '-' ? ` เมื่อ ${paymentDateLabel}` : '';
  deductionLines.push({
    label: `หักยอดที่ชำระไปแล้ว (${kindLabel}${pDateLabel})`,
    amount: round2(netPaid),
  });
}

export function buildPayslipFromWorkerLine(
  line: PayrollBatchLine,
  batch: PayrollBatch,
  periodLabel: string,
  companyProfile?: PayslipCompanyProfileSource,
  normalLine?: PayrollBatchLine | null,
  normalBatch?: PayrollBatch | null,
  /** NORMAL อื่นในงวดเดียวกันที่จ่ายแล้ว (ไม่รวมบรรทัดปัจจุบัน) */
  priorPaidRefs?: readonly PriorPaidPayrollSlipRef[] | null,
  /** ชื่อลูกค้า/สัญญา ต่อ purchaseOrderId — ใช้แทน Firestore id บนสลิป */
  poPartyLabelById?: ReadonlyMap<string, string>,
): PayslipViewModel {
  const { companyNameTh, companyNameEn } = resolvePayslipCompanyNames(companyProfile);
  const incomeLines = buildWorkerPayslipIncomeLines(line, poPartyLabelById);
  const deductionLines = buildWorkerPayslipDeductionLines(line);

  const snapshotGross = line.d8Snapshot?.gross;
  const sumIncome = sumLines(incomeLines);
  const storedGross = round2(line.grossAmount);
  /** ถ้ามีรายละเอียดรายได้ (หลาย PO / แยก Work·M1) ที่ไม่ตรง snapshot เก่า — ใช้ผลรวมบรรทัด */
  let grossTotal: number;
  if (sumIncome > 0.005) {
    const snap =
      snapshotGross != null && Number.isFinite(snapshotGross) ? round2(snapshotGross) : null;
    if (snap != null && Math.abs(sumIncome - snap) < 0.02) {
      grossTotal = snap;
    } else if (Math.abs(sumIncome - storedGross) < 0.02) {
      grossTotal = storedGross;
    } else {
      grossTotal = sumIncome;
    }
  } else if (snapshotGross != null && Number.isFinite(snapshotGross)) {
    grossTotal = round2(snapshotGross);
  } else {
    grossTotal = storedGross;
  }

  let deductionsTotal = sumLines(deductionLines);
  let netPay = resolveLineNetForPayslip(line);

  const impliedNet = round2(grossTotal - deductionsTotal);
  let roundingNote = Math.abs(impliedNet - netPay) >= 0.02;
  /** gross จากรายละเอียดรายได้ ≠ ที่บันทึกในงวด → แสดง net จากรายได้−หัก (ก่อนหักยอดจ่ายแล้ว) */
  if (Math.abs(grossTotal - storedGross) >= 0.02) {
    netPay = impliedNet;
    roundingNote = false;
  }

  const isSupplemental = batch.batchType === 'SUPPLEMENTAL';
  let normalIncomeLines: PayslipLineItem[] | undefined;
  let normalDeductionLines: PayslipLineItem[] | undefined;
  let normalGrossTotal: number | undefined;
  let normalDeductionsTotal: number | undefined;
  let normalNetPay: number | undefined;
  let normalPaymentDateLabel: string | undefined;

  if (isSupplemental && normalLine && normalBatch) {
    const normInc = buildWorkerPayslipIncomeLines(normalLine, poPartyLabelById);
    const normDed = buildWorkerPayslipDeductionLines(normalLine);
    const snapGross = normalLine.d8Snapshot?.gross;
    const sInc = sumLines(normInc);
    const normGross =
      snapGross != null && Number.isFinite(snapGross)
        ? round2(snapGross)
        : sInc > 0
          ? sInc
          : round2(normalLine.grossAmount);

    const normNet = resolveLineNetForPayslip(normalLine);
    normalPaymentDateLabel = formatPaymentDate(workerPaymentTimestamp(normalBatch));

    const mergedIncMap = new Map<string, number>();
    for (const it of [...normInc, ...incomeLines]) {
      mergedIncMap.set(it.label, (mergedIncMap.get(it.label) || 0) + it.amount);
    }
    incomeLines.length = 0;
    for (const [label, amount] of mergedIncMap.entries()) {
      if (amount !== 0) incomeLines.push({ label, amount: round2(amount) });
    }

    const mergedDedMap = new Map<string, number>();
    for (const it of [...normDed, ...deductionLines]) {
      /** รวมประกันสังคมเป็นรายการเดียว */
      if (it.label === 'ประกันสังคม' || it.label.startsWith('ภาษี ณ ที่จ่าย')) {
        const key = it.label.startsWith('ภาษี ณ ที่จ่าย') ? 'ภาษี ณ ที่จ่าย (ภงด. 1)' : 'ประกันสังคม';
        const label =
          key === 'ประกันสังคม'
            ? 'ประกันสังคม'
            : it.label.startsWith('ภาษี ณ ที่จ่าย')
              ? it.label
              : key;
        mergedDedMap.set(label, (mergedDedMap.get(label) || 0) + it.amount);
        continue;
      }
      mergedDedMap.set(it.label, (mergedDedMap.get(it.label) || 0) + it.amount);
    }
    deductionLines.length = 0;
    for (const [label, amount] of mergedDedMap.entries()) {
      if (amount !== 0) deductionLines.push({ label, amount: round2(amount) });
    }

    pushAlreadyPaidDeduction(deductionLines, normNet, 'งวดปกติ', normalPaymentDateLabel);

    grossTotal = round2(normGross + grossTotal);
    deductionsTotal = sumLines(deductionLines);
    netPay = round2(grossTotal - deductionsTotal);
    roundingNote = false;
  } else if (!isSupplemental && priorPaidRefs && priorPaidRefs.length > 0) {
    /** งวด NORMAL รอบหลัง — แสดงรายได้รวมทั้งเดือน แล้วหักยอดที่บัญชีจ่ายไปแล้วในงวดก่อน */
    let priorNetSum = 0;
    const dateLabels: string[] = [];
    for (const ref of priorPaidRefs) {
      const n = resolveLineNetForPayslip(ref.line);
      if (n <= 0.005) continue;
      priorNetSum = round2(priorNetSum + n);
      const dl = formatPaymentDate(workerPaymentTimestamp(ref.batch));
      if (dl && dl !== '-') dateLabels.push(dl);
    }
    if (priorNetSum > 0.005) {
      const kind =
        dateLabels.length === 1
          ? `งวดก่อนหน้า`
          : `งวดก่อนหน้า ${priorPaidRefs.length} รายการ`;
      pushAlreadyPaidDeduction(
        deductionLines,
        priorNetSum,
        kind,
        dateLabels.length === 1 ? dateLabels[0] : dateLabels.join(', '),
      );
      deductionsTotal = sumLines(deductionLines);
      netPay = round2(grossTotal - deductionsTotal);
      roundingNote = false;
    }
  }

  return {
    companyNameTh,
    companyNameEn,
    companyLogoUrl: companyProfile?.documentHeaderLogoUrl?.trim() || undefined,
    employeeName: line.workerNameSnapshot || line.workerId,
    periodLabel,
    payrollTypeLabel: 'Worker Payroll (Timesheet batch)',
    documentRef: batch.id,
    paymentDateLabel: formatPaymentDate(workerPaymentTimestamp(batch)),
    isSupplemental,
    normalPaymentDateLabel,
    policyVersionLabel: formatPolicyVersionFromSnapshot(line.d8Snapshot),
    incomeLines:
      incomeLines.length > 0
        ? incomeLines
        : grossTotal > 0
          ? [{ label: 'รายได้รวม (จากงวดจ่าย)', amount: grossTotal }]
          : [],
    grossTotal,
    deductionLines,
    deductionsTotal,
    netPay,
    roundingNote,
    normalIncomeLines,
    normalGrossTotal,
    normalDeductionLines,
    normalDeductionsTotal,
    normalNetPay,
  };
}

function officePaymentDateLabel(run: OfficePayrollRun): string | undefined {
  const approvedStatuses: PayrollRunStatus[] = ['HR_APPROVED', 'FINANCE_APPROVED', 'PAID', 'LOCKED'];
  if (!approvedStatuses.includes(run.status)) return undefined;
  const ts = run.managerApprovedAt;
  if (ts == null || !Number.isFinite(ts)) return undefined;
  return formatDateThaiBE(ts);
}

export function buildPayslipFromOfficeLine(
  line: OfficePayrollLine,
  run: OfficePayrollRun,
  companyProfile?: PayslipCompanyProfileSource,
  /** เช่น ผู้บริหาร — ค่าเริ่มต้นข้อความสลิปพนักงานออฟฟิศ */
  payrollTypeLabelOverride?: string,
): PayslipViewModel {
  const { companyNameTh, companyNameEn } = resolvePayslipCompanyNames(companyProfile);
  const ot = Number(line.overtimeAmount ?? 0);
  const restDayWorked = Number(line.restDayWorkedAmount ?? line.attendanceSummary?.restDayWorkedPayAmount ?? 0);
  const otherIncRaw = Number(line.otherIncome ?? 0);
  const otherInc = Math.max(0, round2(otherIncRaw - restDayWorked));
  const bonus = Number(line.bonus ?? 0);
  const allowance = Number(line.allowance ?? 0);
  const base = Number(line.baseSalary ?? 0);
  const gross = line.grossPay;

  const ss = line.socialSecurity;
  const tax = line.tax;

  const incomeLines: PayslipLineItem[] = [];
  if (base > 0) incomeLines.push({ label: 'เงินเดือนฐาน', amount: round2(base) });
  if (ot > 0) incomeLines.push({ label: 'ค่าล่วงเวลา (OT)', amount: round2(ot) });
  if (restDayWorked > 0) {
    incomeLines.push({ label: 'ค่าทำงานวันหยุด (จากสแกน)', amount: round2(restDayWorked) });
  }
  if (allowance > 0) incomeLines.push({ label: 'เบี้ยเลี้ยง / Allowance', amount: round2(allowance) });
  if (bonus > 0) incomeLines.push({ label: 'โบนัส', amount: round2(bonus) });
  if (otherInc > 0) incomeLines.push({ label: 'รายได้อื่น', amount: round2(otherInc) });
  const hrAllow = line.hrLineAdjustments?.allowanceItems ?? [];
  for (const it of hrAllow) {
    const a = Number(it.amount) || 0;
    if (a > 0) {
      incomeLines.push({
        label: it.label?.trim() ? it.label.trim() : 'รายรับเพิ่ม (HR)',
        amount: round2(a),
      });
    }
  }
  if (incomeLines.length === 0 && gross > 0) {
    incomeLines.push({ label: 'รายได้รวม', amount: round2(gross) });
  }

  const hrDedItems = line.hrLineAdjustments?.deductionItems ?? [];

  const deductionLines: PayslipLineItem[] = [];
  deductionLines.push({ label: 'ประกันสังคม', amount: round2(ss) });
  deductionLines.push({ label: 'ภาษี ณ ที่จ่าย (ภงด.)', amount: round2(tax) });

  if (line.d8Snapshot?.deductions) {
    for (const [k, v] of Object.entries(line.d8Snapshot.deductions)) {
      if (k === 'social_security' || k === 'pit_withholding') continue;
      const amt = round2(Number(v) || 0);
      if (amt === 0) continue;
      let label = humanizeDeductionKey(k);
      const m = /^manual_ded_(\d+)$/.exec(k);
      if (m) {
        const idx = Number(m[1]);
        const item = hrDedItems[idx];
        if (item?.label?.trim()) label = item.label.trim();
        else label = `หักเพิ่ม (${idx + 1})`;
      }
      deductionLines.push({ label, amount: amt });
    }
  } else {
    const otherTotal = Math.max(0, line.deductions - tax - ss);
    if (otherTotal > 0) {
      deductionLines.push({ label: 'หักอื่น', amount: round2(otherTotal) });
    }
  }

  const summedDed = sumLines(deductionLines);
  const deductionsTotal = summedDed;
  const netPay = round2(line.netPay);
  const impliedNet = round2(gross - deductionsTotal);

  const leaveSummaryLines =
    line.leaveSummary?.map((row) => ({
      label: leaveSummaryLabelTh(row),
      detail:
        row.unpaidInPeriodDays > 0
          ? `หักเงิน ${row.unpaidInPeriodDays} วัน (เกินสิทธิ์หรือไม่อนุมัติ)`
          : row.usedInPeriodDays > 0
            ? 'ลาในสิทธิ์ — ไม่หักเงินเดือน'
            : 'ไม่มีการลาในงวดนี้',
    })) ?? undefined;

  const att = line.attendanceSummary;
  const attendanceNote =
    att?.scanDeductionsApplied && (att.lateMinutes > 0 || att.scanAbsenceDays > 0)
      ? `หักจากสแกน: สาย ${att.lateMinutes} นาที · ขาด/ไม่สแกน ${att.scanAbsenceDays} วัน`
      : att && !att.scanDeductionsApplied
        ? 'คำนวนจากฐานเงินเดือน — ไม่หักสาย/ขาดจากสแกน'
        : undefined;

  return {
    companyNameTh,
    companyNameEn,
    companyLogoUrl: companyProfile?.documentHeaderLogoUrl?.trim() || undefined,
    employeeName: line.staffName,
    periodLabel: formatOfficePayrollRunPeriodLabelThaiBE(run),
    payrollTypeLabel:
      payrollTypeLabelOverride?.trim() || 'พนักงานออฟฟิศ / Office Payroll (รายเดือน)',
    documentRef: run.payrollRunNo,
    paymentDateLabel: officePaymentDateLabel(run),
    policyVersionLabel: formatPolicyVersionFromSnapshot(line.d8Snapshot),
    incomeLines,
    grossTotal: round2(gross),
    deductionLines,
    deductionsTotal,
    netPay,
    leaveSummaryLines: leaveSummaryLines?.length
      ? [
          ...leaveSummaryLines,
          ...(attendanceNote
            ? [{ label: attendanceNote, detail: att?.unpaidLeaveDays ? `หักลาไม่จ่ายรวม ${att.unpaidLeaveDays} วัน` : '' }]
            : []),
        ]
      : attendanceNote
        ? [{ label: attendanceNote, detail: '' }]
        : undefined,
    roundingNote:
      Math.abs(impliedNet - netPay) >= 0.02 ||
      Math.abs(summedDed - round2(line.deductions)) >= 0.02,
  };
}

/** สร้างหัวงวด office จากบรรทัด — ใช้ My Profile เมื่ออ่าน run ไม่ได้ (employee_self) */
export function officePayrollRunStubFromLine(
  line: OfficePayrollLine,
  run?: OfficePayrollRun | null,
): OfficePayrollRun {
  if (run) return run;
  const month = (line.payrollMonth || '').trim();
  const parts = month.match(/^(\d{4})-(\d{2})$/);
  const start = month ? `${month}-01` : '';
  const end =
    parts != null
      ? `${month}-${String(new Date(Number(parts[1]), Number(parts[2]), 0).getDate()).padStart(2, '0')}`
      : '';
  return {
    id: line.officePayrollRunId || line.id,
    payrollRunNo: month ? `OFF-${month}` : line.id.slice(0, 12),
    payrollMonth: month || '—',
    payrollPeriodStart: start,
    payrollPeriodEnd: end,
    status: 'HR_APPROVED',
    staffCount: 1,
    grossAmount: line.grossPay,
    totalAllowances: 0,
    totalDeductions: line.deductions,
    netAmount: line.netPay,
    managerApprovedAt: line.updatedAt,
    createdAt: line.createdAt,
    updatedAt: line.updatedAt,
  };
}

/** สร้างหัว batch จากบรรทัด — ใช้ My Profile เมื่ออ่าน batch ไม่ได้ */
export function payrollBatchStubFromLine(
  line: PayrollBatchLine,
  batch?: PayrollBatch | null,
): PayrollBatch {
  if (batch) return batch;
  const ts = line.financePaidAt ?? Date.now();
  return {
    id: line.payrollBatchId,
    payrollPeriodId: '',
    workModeScope: 'mixed',
    status: 'GENERATED',
    totalWorkers: 1,
    grossAmount: line.grossAmount,
    totalDeductions: Math.max(0, round2(line.grossAmount - line.netAmount)),
    netAmount: line.netAmount,
    createdBy: '—',
    updatedBy: '—',
    createdAt: ts,
    updatedAt: ts,
  };
}

/** ดึง batch id จาก path เช่น payroll_batches/PAY-xxx/lines/abc */
export function payrollBatchIdFromLineDocPath(path: string): string | null {
  const m = path.match(/^payroll_batches\/([^/]+)\/lines\//);
  return m ? m[1] : null;
}

export function officeRunIdFromLineDocPath(path: string): string | null {
  const m = path.match(/^office_payroll_runs\/([^/]+)\/lines\//);
  return m ? m[1] : null;
}
