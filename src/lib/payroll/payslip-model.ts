import type {
  OfficePayrollLine,
  OfficePayrollRun,
  PayrollBatch,
  PayrollBatchIncomeSegment,
  PayrollBatchLine,
  PayrollLineD8Snapshot,
  PayrollRunStatus,
  PayslipWorkDayPositionSplit,
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
  computeWorkDayPackagePayslipPositionSplits,
  computeWorkDayPackagePayslipSplit,
  payslipWorkDaySplitTotal,
  pushWorkDayPayslipIncomeLines,
  resolvePositionDisplayName,
} from '@/lib/payroll/work-day-payslip-split';
import type { SingleTimesheetGrossContext } from '@/lib/payroll/single-timesheet-gross';

export const PAYSLIP_DEFAULT_COMPANY_TH = 'โอพีอีซี ออปส์โฟลว์';
export const PAYSLIP_DEFAULT_COMPANY_EN = 'OPEC OpsFlow';

/** คีย์หักยอดที่ชำระไปแล้วในงวดก่อนหน้า — บันทึกลง deductionsBreakdown ตอนยืนยันจ่าย */
export const PRIOR_PAID_RECOVERY_DEDUCTION_KEY = 'prior_paid_recovery';

/**
 * งวดที่จ่าย/ล็อกแล้ว — คง snapshot ตามที่บันทึกใน settlement line
 * (ยอดหลาย PO + หักยอดจ่ายแล้วถูก persist ตอนยืนยันจ่าย / ensure)
 * ไม่ทับด้วยใบงานสดทุกครั้งที่เปิดหน้า
 *
 * `opts.hasEarlierPaidInPeriod` คงไว้เพื่อความเข้ากันได้ของ callers — ไม่มีผลแล้ว
 */
export function isWorkerPayrollBatchSnapshotFrozen(
  batch: Pick<PayrollBatch, 'status'> | null | undefined,
  _opts?: { hasEarlierPaidInPeriod?: boolean },
): boolean {
  const s = batch?.status;
  return s === 'PAID' || s === 'LOCKED';
}

/** ลำดับเวลางวด — ใช้กรอง «ยอดที่ชำระไปแล้ว」ตามลำดับจ่ายจริง (ไม่ใช่แค่วันสร้างงวด) */
export function payrollBatchChronologyMs(batch: PayrollBatch): number {
  const n =
    batch.financeApprovedAt ??
    batch.financePreparedAt ??
    batch.hrApprovedAt ??
    batch.lockedAt ??
    batch.createdAt ??
    0;
  return Number.isFinite(n) ? n : 0;
}

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
  /**
   * ใช้เฉพาะเมื่อสลิปงวดตกเบิกแนบรายละเอียดหักของงวดปกติแยกส่วน
   * (รายได้ตกเบิกที่จ่ายแล้วต้นเดือนถูกบวกเข้า incomeLines ด้านบนแล้ว ไม่ใช้ช่องนี้ซ้ำ)
   */
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
    employee_assistance_fund: 'กองทุนสงเคราะห์ลูกจ้าง',
    pit_withholding: 'ภาษี ณ ที่จ่าย (ภงด. 1)',
    cash_advance_recovery: 'หักคืนเบิกล่วงหน้า',
    [PRIOR_PAID_RECOVERY_DEDUCTION_KEY]: 'หักยอดที่ชำระไปแล้ว (งวดก่อนหน้า)',
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

type StandbyLikeDayRow = {
  eventType: string;
  amount: number;
  purchaseOrderId?: string;
  positionNameSnapshot?: string;
  normalHours?: number;
};

function formatStandbyHoursLabel(hours: number): string {
  const h = Math.round(Math.max(0, hours) * 100) / 100;
  if (!Number.isFinite(h) || h <= 0) return '';
  if (Number.isInteger(h)) return `${h} ชม.`;
  return `${h.toLocaleString('th-TH', { maximumFractionDigits: 2 })} ชม.`;
}

function formatStandbyLikePayslipLabel(opts: {
  labelPrefix: string;
  earningsKey: string;
  positionName?: string;
  hours?: number;
  days: number;
  rate: number;
}): string {
  const title = humanizeWorkerEarningsKey(opts.earningsKey);
  const parts: string[] = [];
  if (opts.labelPrefix.trim()) parts.push(opts.labelPrefix.trim());
  parts.push(title);
  const pos = String(opts.positionName || '').trim();
  if (pos) parts.push(pos);
  const hoursLabel =
    opts.hours != null && Number.isFinite(opts.hours) && opts.hours > 0
      ? formatStandbyHoursLabel(opts.hours)
      : '';
  if (hoursLabel) parts.push(hoursLabel);
  parts.push(`${opts.days} วัน × ${formatThaiMoneyAmount(opts.rate)}`);
  return parts.join(' ');
}

/**
 * แยกบรรทัด SB / M1 / D1 ตามเรท + ตำแหน่ง + ชม.
 * — ไม่เฉลี่ยเมื่อราคาต่าง · ใส่ตำแหน่ง/ชม. กันสับสนเมื่อคำ Mob/Demob ซ้ำ
 */
function pushStandbyLikePayslipLinesByRate(
  lines: PayslipLineItem[],
  labelPrefix: string,
  earningsKey: string,
  totalAmount: number,
  eventBreakdown: Record<string, number> | undefined,
  dailyRows: readonly StandbyLikeDayRow[] | null | undefined,
  purchaseOrderId?: string,
): void {
  const amtTotal = round2(totalAmount);
  if (amtTotal <= 0.005) return;

  const eventType = earningsKey.replace(/_policy$/i, '').replace(/_package$/i, '');
  const poFilter = String(purchaseOrderId || '').trim();
  const rows = (dailyRows ?? []).filter((r) => {
    if (String(r.eventType || '') !== eventType) return false;
    if (poFilter) {
      const rowPo = String(r.purchaseOrderId || '').trim();
      if (rowPo && rowPo !== poFilter) return false;
    }
    return Math.abs(Number(r.amount) || 0) > 0.005;
  });

  if (rows.length === 0) {
    lines.push(standbyPayslipLine(labelPrefix, earningsKey, amtTotal, eventBreakdown));
    return;
  }

  type Group = {
    days: number;
    amount: number;
    rate: number;
    positionName: string;
    hours: number;
  };
  const byKey = new Map<string, Group>();
  for (const r of rows) {
    const dayAmt = round2(Number(r.amount) || 0);
    if (dayAmt <= 0.005) continue;
    const positionName = String(r.positionNameSnapshot || '').trim();
    const hours = Math.round(Math.max(0, Number(r.normalHours) || 0) * 100) / 100;
    const key = `${dayAmt}\t${positionName}\t${hours}`;
    const g = byKey.get(key) ?? {
      days: 0,
      amount: 0,
      rate: dayAmt,
      positionName,
      hours,
    };
    g.days += 1;
    g.amount = round2(g.amount + dayAmt);
    byKey.set(key, g);
  }

  if (byKey.size === 0) {
    lines.push(standbyPayslipLine(labelPrefix, earningsKey, amtTotal, eventBreakdown));
    return;
  }

  const groups = [...byKey.values()].sort((a, b) => {
    const c = a.rate - b.rate;
    if (c !== 0) return c;
    const p = a.positionName.localeCompare(b.positionName, 'th');
    if (p !== 0) return p;
    return a.hours - b.hours;
  });

  const sumRows = round2(groups.reduce((s, g) => s + g.amount, 0));
  const scale =
    sumRows > 0.005 && Math.abs(sumRows - amtTotal) >= 0.02 ? amtTotal / sumRows : 1;

  let pushed = 0;
  groups.forEach((g, idx) => {
    let lineAmt = round2(g.amount * scale);
    if (idx === groups.length - 1) {
      lineAmt = round2(amtTotal - pushed);
    } else {
      pushed = round2(pushed + lineAmt);
    }
    if (lineAmt <= 0.005) return;
    const displayRate = scale === 1 ? g.rate : round2(lineAmt / g.days);
    lines.push({
      label: formatStandbyLikePayslipLabel({
        labelPrefix,
        earningsKey,
        positionName: g.positionName || undefined,
        hours: g.hours > 0 ? g.hours : undefined,
        days: g.days,
        rate: displayRate,
      }),
      amount: lineAmt,
    });
  });
}

/** true ถ้าใส่บรรทัดแทน work_day_package แล้ว */
function tryPushWorkDayPackageSplitLines(
  lines: PayslipLineItem[],
  pkgAmount: number,
  split: PayslipWorkDaySplit | null | undefined,
  labelPrefix: string,
  positionSplits?: PayslipWorkDayPositionSplit[] | null,
  dailyRowSnapshots?: PayrollBatchLine['dailyRowSnapshots'],
): boolean {
  return pushWorkDayPayslipIncomeLines(
    lines,
    pkgAmount,
    split,
    labelPrefix,
    positionSplits,
    dailyRowSnapshots,
  );
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
        if (
          k === 'work_day_package' &&
          tryPushWorkDayPackageSplitLines(
            lines,
            amt,
            seg.payslipWorkDaySplit,
            prefix,
            seg.payslipWorkDayPositionSplits,
            line.dailyRowSnapshots,
          )
        ) {
          continue;
        }
        if (isStandbyLikePackageOrPolicyKey(k)) {
          pushStandbyLikePayslipLinesByRate(
            lines,
            prefix,
            k,
            amt,
            seg.eventBreakdown,
            line.dailyRowSnapshots,
            seg.purchaseOrderId,
          );
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
    if (
      k === 'work_day_package' &&
      tryPushWorkDayPackageSplitLines(
        lines,
        amt,
        line.payslipWorkDaySplit,
        '',
        line.payslipWorkDayPositionSplits,
        line.dailyRowSnapshots,
      )
    ) {
      continue;
    }
    if (isStandbyLikePackageOrPolicyKey(k)) {
      pushStandbyLikePayslipLinesByRate(
        lines,
        '',
        k,
        amt,
        line.eventBreakdown,
        line.dailyRowSnapshots,
      );
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

    const standbyDayRows: StandbyLikeDayRow[] = [];
    const mobDayRows: StandbyLikeDayRow[] = [];
    const demobDayRows: StandbyLikeDayRow[] = [];
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
        const perUnit = units > 1 ? round2(r.gross / units) : round2(r.gross);
        const positionName = resolvePositionDisplayName(linePos) || undefined;
        const normalHours = Math.max(0, Number(ts.normalHours) || 0);
        const rowBase: StandbyLikeDayRow = {
          eventType: ts.eventType,
          amount: perUnit,
          purchaseOrderId: poId,
          positionNameSnapshot: positionName,
          normalHours,
        };
        const target =
          ts.eventType === 'mobilization_day'
            ? mobDayRows
            : ts.eventType === 'demobilization_day'
              ? demobDayRows
              : standbyDayRows;
        for (let i = 0; i < units; i++) target.push({ ...rowBase });
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
    const aggDeps = {
      poLineMaps: ctx.poLineMaps,
      poContractById: ctx.poContractById,
      poWorkModeByPoId: ctx.poWorkModeByPoId,
      workerById: ctx.workerById,
      posById: ctx.posById,
      contractMap: ctx.contractMap,
      workerGlobalLabor: ctx.workerGlobalLabor,
    };
    const split = seg?.payslipWorkDaySplit ?? computeWorkDayPackagePayslipSplit(group, aggDeps, undefined);
    const positionSplits =
      seg?.payslipWorkDayPositionSplits ??
      line.payslipWorkDayPositionSplits ??
      computeWorkDayPackagePayslipPositionSplits(group, aggDeps);
    const pkgForPush = workDayPkg > 0.005 ? workDayPkg : payslipWorkDaySplitTotal(split);
    if (
      !pushWorkDayPayslipIncomeLines(
        lines,
        pkgForPush,
        split,
        prefix,
        positionSplits,
        line.dailyRowSnapshots,
      )
    ) {
      const fallbackPkg = round2(split.normalAmount + split.holidayAmount + (split.otAmount ?? 0));
      if (fallbackPkg > 0.005) {
        pushWorkDayPayslipIncomeLines(
          lines,
          fallbackPkg,
          split,
          prefix,
          positionSplits,
          line.dailyRowSnapshots,
        );
      }
    }
    const pushFromDayRows = (eventKey: string, dayRows: StandbyLikeDayRow[]) => {
      if (dayRows.length === 0) return;
      const total = round2(dayRows.reduce((s, r) => s + r.amount, 0));
      pushStandbyLikePayslipLinesByRate(
        lines,
        prefix,
        eventKey,
        total,
        { [eventKey]: dayRows.length },
        dayRows,
        poId,
      );
    };
    pushFromDayRows('standby_day', standbyDayRows);
    pushFromDayRows('mobilization_day', mobDayRows);
    pushFromDayRows('demobilization_day', demobDayRows);

    for (const k of Object.keys(policyAmounts).sort((a, b) => a.localeCompare(b))) {
      const amt = round2(policyAmounts[k]);
      if (Math.abs(amt) < 0.005) continue;
      if (isStandbyLikePackageOrPolicyKey(k)) {
        pushStandbyLikePayslipLinesByRate(
          lines,
          prefix,
          k,
          amt,
          seg?.eventBreakdown ?? line.eventBreakdown,
          line.dailyRowSnapshots,
          poId,
        );
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

/**
 * ทับรายได้บนสลิปด้วยยอดจากใบงานปัจจุบัน (หลาย PO / remob) — ให้หน้า batch ตรงหน้ารายคน
 * คงรายการหักจาก model (รวมหักยอดที่ชำระไปแล้ว)
 */
export function applyLiveTimesheetIncomeToPayslip(
  model: PayslipViewModel,
  line: PayrollBatchLine,
  timesheets: readonly DailyTimesheet[],
  ctx: SingleTimesheetGrossContext,
  poPartyLabelById?: ReadonlyMap<string, string>,
): PayslipViewModel {
  if (!timesheets.length) return model;
  const incomeLines = buildWorkerPayslipIncomeLinesFromTimesheets(
    line,
    timesheets,
    ctx,
    poPartyLabelById,
  );
  if (incomeLines.length === 0) return model;
  const liveGross = round2(incomeLines.reduce((s, x) => s + x.amount, 0));
  const nextGross = liveGross > 0.005 ? liveGross : model.grossTotal;
  const nextDedTotal = round2(model.deductionLines.reduce((s, x) => s + x.amount, 0));
  return {
    ...model,
    incomeLines,
    grossTotal: nextGross,
    deductionsTotal: nextDedTotal,
    netPay: round2(nextGross - nextDedTotal),
    roundingNote: false,
  };
}

export function buildWorkerPayslipDeductionLines(line: PayrollBatchLine): PayslipLineItem[] {
  const d = line.deductionsBreakdown || line.d8Snapshot?.deductions || {};
  const manual = line.hrLineAdjustments?.deductionItems ?? [];
  const out: PayslipLineItem[] = [];

  const ss = round2(Number(d.social_security) || 0);
  if (ss > 0.005) {
    out.push({ label: 'ประกันสังคม', amount: ss });
  }

  const fund = round2(Number(d.employee_assistance_fund) || 0);
  if (fund > 0.005) {
    out.push({ label: 'กองทุนสงเคราะห์ลูกจ้าง', amount: fund });
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

  const known = new Set<string>(['social_security', 'employee_assistance_fund', 'pit_withholding']);
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

export function resolveLineNetForPayslip(line: PayrollBatchLine): number {
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

function priorPaidConsolidatedIncomeLabel(
  ref: PriorPaidPayrollSlipRef,
  paymentDateLabel?: string,
): string {
  const isSupp = ref.batch.batchType === 'SUPPLEMENTAL';
  const items = ref.line.hrLineAdjustments?.priorPeriodAllowanceItems ?? [];
  const months = [
    ...new Set(
      items
        .map((it) => String(it.sourceYearMonth || '').trim())
        .filter((ym) => /^\d{4}-\d{2}$/.test(ym)),
    ),
  ].sort();
  let periodPart = '';
  if (months.length === 1) {
    const [ys, ms] = months[0].split('-').map(Number);
    const monthLabel = new Date(ys, ms - 1, 1).toLocaleDateString('th-TH', {
      month: 'long',
      year: 'numeric',
    });
    periodPart = `งวด ${monthLabel}`;
  } else if (months.length > 1) {
    periodPart = `${months.length} งวดย้อนหลัง`;
  }
  const datePart =
    paymentDateLabel && paymentDateLabel !== '-' && paymentDateLabel !== '— (ยังไม่ระบุวันจ่าย)'
      ? ` · จ่ายแล้ว ${paymentDateLabel}`
      : '';
  if (isSupp) {
    return periodPart ? `รายได้ตกเบิก ${periodPart}${datePart}` : `รายได้ตกเบิก${datePart || ' (งวดก่อนหน้า)'}`;
  }
  return periodPart
    ? `รายได้ที่จ่ายแล้วต้นเดือน ${periodPart}${datePart}`
    : `รายได้ที่จ่ายแล้วต้นเดือน${datePart || ''}`;
}

/**
 * แนบงวดที่จ่ายแล้วต้นเดือน (รวม SUPPLEMENTAL ตกเบิก) เข้าสลิป NORMAL
 * — บวกรายรับตกเบิกด้านบน (รวมเป็นบรรทัดเดียวต่องวด) + รวมใน Gross แล้วค่อยหักสุทธิที่จ่ายไปแล้ว
 */
function applyPriorPaidRefsToNormalPayslip(
  line: PayrollBatchLine,
  priorPaidRefs: readonly PriorPaidPayrollSlipRef[],
  _poPartyLabelById: ReadonlyMap<string, string> | undefined,
  state: {
    incomeLines: PayslipLineItem[];
    deductionLines: PayslipLineItem[];
    deductionsTotal: number;
    grossTotal: number;
    netPay: number;
    roundingNote: boolean;
  },
): {
  incomeLines: PayslipLineItem[];
  grossTotal: number;
  deductionLines: PayslipLineItem[];
  deductionsTotal: number;
  netPay: number;
  roundingNote: boolean;
  normalPaymentDateLabel?: string;
} {
  const priorInc: PayslipLineItem[] = [];
  let priorGrossSum = 0;
  let priorNetSum = 0;
  const dateLabels: string[] = [];
  let hasSupplemental = false;

  for (const ref of priorPaidRefs) {
    if (ref.batch.batchType === 'SUPPLEMENTAL') hasSupplemental = true;
    const g = Math.max(0, Number(ref.line.grossAmount) || 0);
    const n = resolveLineNetForPayslip(ref.line);
    const dl = formatPaymentDate(workerPaymentTimestamp(ref.batch));
    if (n > 0.005) {
      priorNetSum = round2(priorNetSum + n);
      if (dl && dl !== '-') dateLabels.push(dl);
    }
    if (g > 0.005) {
      priorGrossSum = round2(priorGrossSum + g);
      priorInc.push({
        label: priorPaidConsolidatedIncomeLabel(ref, dl),
        amount: round2(g),
      });
    }
  }

  /** รายได้ตกเบิกขึ้นก่อน · แล้วตามด้วยรายได้งวดนี้ */
  const incomeLines = [...priorInc, ...state.incomeLines];
  const grossTotal = round2(state.grossTotal + priorGrossSum);

  const deductionLines = [...state.deductionLines];
  let deductionsTotal = state.deductionsTotal;
  let roundingNote = state.roundingNote;

  const alreadyPersisted =
    Number(line.deductionsBreakdown?.[PRIOR_PAID_RECOVERY_DEDUCTION_KEY]) > 0.005;
  if (!alreadyPersisted && priorNetSum > 0.005) {
    const kind =
      hasSupplemental && priorPaidRefs.length === 1
        ? 'งวดตกเบิกที่จ่ายแล้ว'
        : dateLabels.length === 1
          ? 'งวดก่อนหน้า'
          : `งวดก่อนหน้า ${priorPaidRefs.length} รายการ`;
    pushAlreadyPaidDeduction(
      deductionLines,
      priorNetSum,
      kind,
      dateLabels.length === 1 ? dateLabels[0] : dateLabels.join(', '),
    );
    deductionsTotal = sumLines(deductionLines);
  }

  /** Gross รวมตกเบิก − หักทั้งหมด (รวมหักยอดที่จ่ายแล้ว) = สุทธิที่ถูกต้องของงวดนี้ */
  const netPay = round2(grossTotal - deductionsTotal);
  roundingNote = false;

  return {
    incomeLines,
    grossTotal,
    deductionLines,
    deductionsTotal,
    netPay,
    roundingNote,
    normalPaymentDateLabel: dateLabels.length === 1 ? dateLabels[0] : dateLabels.join(', ') || undefined,
  };
}

function resolveSupplementalFrozenIncomeLines(
  line: PayrollBatchLine,
  grossTotal: number,
  poPartyLabelById?: ReadonlyMap<string, string>,
): PayslipLineItem[] {
  const incomeLines = buildWorkerPayslipIncomeLines(line, poPartyLabelById);
  const sumIncome = sumLines(incomeLines);
  if (incomeLines.length > 0 && Math.abs(sumIncome - grossTotal) < 0.05) {
    return incomeLines;
  }
  const prior = (line.hrLineAdjustments?.priorPeriodAllowanceItems ?? []).filter(
    (x) => (Number(x.amount) || 0) > 0,
  );
  if (prior.length > 0) {
    const lines = prior.map((it) => ({
      label: formatPriorPeriodAllowancePayslipLabel(it),
      amount: round2(Number(it.amount) || 0),
    }));
    const sum = sumLines(lines);
    const drift = round2(grossTotal - sum);
    if (Math.abs(drift) >= 0.05) {
      lines.push({ label: 'รายได้อื่นในงวดตกเบิก', amount: drift });
    }
    return lines;
  }
  if (incomeLines.length > 0) return incomeLines;
  return grossTotal > 0 ? [{ label: 'รายได้รวม (จากงวดจ่าย)', amount: grossTotal }] : [];
}

export function buildPayslipFromWorkerLine(
  line: PayrollBatchLine,
  batch: PayrollBatch,
  periodLabel: string,
  companyProfile?: PayslipCompanyProfileSource,
  normalLine?: PayrollBatchLine | null,
  normalBatch?: PayrollBatch | null,
  /** NORMAL / SUPPLEMENTAL อื่นในงวดเดียวกันที่จ่ายแล้ว (ไม่รวมบรรทัดปัจจุบัน) */
  priorPaidRefs?: readonly PriorPaidPayrollSlipRef[] | null,
  /** ชื่อลูกค้า/สัญญา ต่อ purchaseOrderId — ใช้แทน Firestore id บนสลิป */
  poPartyLabelById?: ReadonlyMap<string, string>,
): PayslipViewModel {
  const { companyNameTh, companyNameEn } = resolvePayslipCompanyNames(companyProfile);
  const hasEarlierPaid = (priorPaidRefs?.length ?? 0) > 0;
  const frozen = isWorkerPayrollBatchSnapshotFrozen(batch, {
    hasEarlierPaidInPeriod: hasEarlierPaid,
  });
  const isSupplemental = batch.batchType === 'SUPPLEMENTAL';

  /** งวดจ่ายแล้ว — คงยอดในงวด + แนบงวดตกเบิก/จ่ายแล้วต้นเดือนถ้ามี */
  if (frozen) {
    let deductionLines = buildWorkerPayslipDeductionLines(line);
    let deductionsTotal = sumLines(deductionLines);
    const storedGross = round2(line.grossAmount);
    let netPay = resolveLineNetForPayslip(line);
    let roundingNote = Math.abs(round2(storedGross - deductionsTotal) - netPay) >= 0.02;

    let incomeLines: PayslipLineItem[];
    let grossTotal = storedGross;
    if (isSupplemental) {
      incomeLines = resolveSupplementalFrozenIncomeLines(line, storedGross, poPartyLabelById);
      const sumInc = sumLines(incomeLines);
      if (sumInc > 0.005 && Math.abs(sumInc - storedGross) >= 0.05) {
        grossTotal = sumInc;
        netPay = round2(grossTotal - deductionsTotal);
        roundingNote = false;
      }
    } else {
      const built = buildWorkerPayslipIncomeLines(line, poPartyLabelById);
      const sumIncome = sumLines(built);
      /**
       * ใช้รายละเอียดรายได้เมื่อตรงยอดบันทึก หรือเมื่อมียอดเบี้ยเลี้ยงในฟอร์มที่ยังไม่พับเข้า grossAmount
       * (มิฉะนั้นสลิป/การ์ดรวมจะต่ำกว่าความเป็นจริงก่อนแนบตกเบิก)
       */
      if (built.length > 0 && (Math.abs(sumIncome - storedGross) < 0.05 || sumIncome > storedGross + 0.05)) {
        incomeLines = built;
        if (Math.abs(sumIncome - storedGross) < 0.05) {
          grossTotal = storedGross;
        } else {
          grossTotal = sumIncome;
          netPay = round2(grossTotal - deductionsTotal);
          roundingNote = false;
        }
      } else {
        incomeLines =
          storedGross > 0
            ? [{ label: 'รายได้รวม (จากงวดจ่าย)', amount: storedGross }]
            : [];
      }
    }

    let normalPaymentDateLabel: string | undefined;

    if (!isSupplemental && priorPaidRefs && priorPaidRefs.length > 0) {
      const attached = applyPriorPaidRefsToNormalPayslip(line, priorPaidRefs, poPartyLabelById, {
        incomeLines,
        deductionLines,
        deductionsTotal,
        grossTotal,
        netPay,
        roundingNote,
      });
      incomeLines = attached.incomeLines;
      grossTotal = attached.grossTotal;
      deductionLines = attached.deductionLines;
      deductionsTotal = attached.deductionsTotal;
      netPay = attached.netPay;
      roundingNote = attached.roundingNote;
      normalPaymentDateLabel = attached.normalPaymentDateLabel;
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
      incomeLines,
      grossTotal,
      deductionLines,
      deductionsTotal,
      netPay,
      roundingNote,
    };
  }

  const incomeLinesBuilt = buildWorkerPayslipIncomeLines(line, poPartyLabelById);
  let incomeLines = incomeLinesBuilt;
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

  /**
   * งวดตกเบิก: priorPeriodAllowanceItems คือรายได้หลักที่บันทึกใน grossAmount แล้ว
   * ถ้าเคยถูกบวกซ้ำตอน HR adjust จะได้ net ≈ 2×gross−หัก — บังคับใช้ gross−หัก
   */
  if (isSupplemental && Math.abs(impliedNet - netPay) >= 0.02) {
    netPay = impliedNet;
    roundingNote = false;
  }

  let normalDeductionLines: PayslipLineItem[] | undefined;
  let normalDeductionsTotal: number | undefined;
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
    incomeLines = [];
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
    const attached = applyPriorPaidRefsToNormalPayslip(line, priorPaidRefs, poPartyLabelById, {
      incomeLines,
      deductionLines,
      deductionsTotal,
      grossTotal,
      netPay,
      roundingNote,
    });
    incomeLines = attached.incomeLines;
    grossTotal = attached.grossTotal;
    deductionLines.length = 0;
    deductionLines.push(...attached.deductionLines);
    deductionsTotal = attached.deductionsTotal;
    netPay = attached.netPay;
    roundingNote = attached.roundingNote;
    normalPaymentDateLabel = attached.normalPaymentDateLabel;
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
    normalDeductionLines,
    normalDeductionsTotal,
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
