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
import { formatDateThaiBE, formatOfficePayrollRunPeriodLabelThaiBE, formatYmdRangeThaiBE } from '@/lib/date-thai';
import { leaveSummaryLabelTh } from '@/lib/payroll/office-payroll-period-deductions';
import { computeRegistryWorkerTimesheetGross } from '@/lib/payroll/registry-worker-timesheet-gross';
import { resolvePoLineForPayrollTimesheet } from '@/lib/payroll/timesheet-labor-base-cost';
import { isPayrollCostStandbyPackageEvent } from '@/lib/payroll/package-labor-cost';
import type { SingleTimesheetGrossContext } from '@/lib/payroll/single-timesheet-gross';

export const PAYSLIP_DEFAULT_COMPANY_TH = 'โอพีอีซี ออปส์โฟลว์';
export const PAYSLIP_DEFAULT_COMPANY_EN = 'OPEC OpsFlow';

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

function workDaySplitIncomeLine(titleWithOptionalPrefix: string, days: number, amount: number): PayslipLineItem | null {
  if (days <= 0 || amount <= 0.005) return null;
  const rate = round2(amount / days);
  const product = round2(days * rate);
  const consistent = Math.abs(product - amount) <= 0.02;
  /** ยอดรวมแสดงเฉพาะคอลัมน์จำนวนเงิน — ไม่ซ้ำในข้อความรายการ */
  const label = consistent
    ? `${titleWithOptionalPrefix} ${days} วัน × ${formatThaiMoneyAmount(rate)}`
    : `${titleWithOptionalPrefix} ${days} วัน (เฉลี่ยวันละ ${formatThaiMoneyAmount(rate)} บาท)`;
  return { label, amount: round2(amount) };
}

function standbyDaysFromEventBreakdown(ev: Record<string, number> | undefined): number {
  const n = Number(ev?.standby_day ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function isStandbyDayPolicyKey(key: string): boolean {
  return key.replace(/_policy$/i, '').replace(/_package$/i, '') === 'standby_day';
}

function standbyPayslipLine(
  labelPrefix: string,
  earningsKey: string,
  amount: number,
  eventBreakdown: Record<string, number> | undefined,
): PayslipLineItem {
  let days = standbyDaysFromEventBreakdown(eventBreakdown);
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
  if (!split) return false;
  const sum = round2(split.normalAmount + split.holidayAmount);
  if (Math.abs(sum - pkgAmount) > 0.05) return false;
  const pfx = labelPrefix.trim();
  const baseNormal = pfx ? `${pfx} ค่าแรงวันปกติ` : 'ค่าแรงวันปกติ';
  const baseHoliday = pfx ? `${pfx} ค่าแรงวันหยุด` : 'ค่าแรงวันหยุด';
  const n = workDaySplitIncomeLine(baseNormal, split.normalDays, split.normalAmount);
  const h = workDaySplitIncomeLine(baseHoliday, split.holidayDays, split.holidayAmount);
  if (n) lines.push(n);
  if (h) lines.push(h);
  return !!(n || h);
}

function payslipIncomeSegmentPrefix(seg: PayrollBatchIncomeSegment): string {
  const po =
    seg.poCodeSnapshot?.trim() ||
    (seg.purchaseOrderId === '_unknown_po' ? 'ไม่ระบุ PO' : seg.purchaseOrderId);
  const cust = seg.customerNameSnapshot?.trim();
  return cust ? `[${po} · ${cust}]` : `[${po}]`;
}

/**
 * รายได้รายบรรทัด — อ้างอิง snapshot ก่อน แล้วจึง earningsBreakdown + รายการเบี้ยเลี้ยงจาก HR
 */
export function buildWorkerPayslipIncomeLines(line: PayrollBatchLine): PayslipLineItem[] {
  const allowanceItems = (line.hrLineAdjustments?.allowanceItems ?? []).filter(
    (x) => (Number(x.amount) || 0) > 0,
  );

  const lines: PayslipLineItem[] = [];

  for (const it of allowanceItems) {
    lines.push({
      label: it.label?.trim() || 'รายได้เพิ่ม (HR)',
      amount: round2(Number(it.amount) || 0),
    });
  }

  const multiSeg = line.incomeSegments && line.incomeSegments.length > 1;
  if (multiSeg) {
    const sorted = [...line.incomeSegments!].sort((a, b) => {
      const ka = `${a.poCodeSnapshot || ''}\t${a.purchaseOrderId}`;
      const kb = `${b.poCodeSnapshot || ''}\t${b.purchaseOrderId}`;
      return ka.localeCompare(kb, 'th');
    });
    for (const seg of sorted) {
      const prefix = payslipIncomeSegmentPrefix(seg);
      const eb = seg.earningsBreakdown || {};
      const keys = Object.keys(eb).sort((a, b) => a.localeCompare(b));
      for (const k of keys) {
        const amt = round2(Number(eb[k]) || 0);
        if (Math.abs(amt) < 0.005) continue;
        if (k === 'work_day_package' && tryPushWorkDayPackageSplitLines(lines, amt, seg.payslipWorkDaySplit, prefix)) {
          continue;
        }
        if (isStandbyDayPolicyKey(k)) {
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

  if (allowanceItems.length > 0) {
    delete baseEb.hr_allowances;
  }

  const keys = Object.keys(baseEb).sort((a, b) => a.localeCompare(b));
  for (const k of keys) {
    const amt = round2(Number(baseEb[k]) || 0);
    if (Math.abs(amt) < 0.005) continue;
    if (k === 'work_day_package' && tryPushWorkDayPackageSplitLines(lines, amt, line.payslipWorkDaySplit, '')) {
      continue;
    }
    if (isStandbyDayPolicyKey(k)) {
      lines.push(standbyPayslipLine('', k, amt, line.eventBreakdown));
      continue;
    }
    lines.push({ label: humanizeWorkerEarningsKey(k), amount: amt });
  }

  return lines;
}

/**
 * สร้างบรรทัดรายได้จากใบงานรายวัน — แยก work_day / standby / วันหยุด ตามสูตร batch จริง
 * ใช้บนหน้ารายละเอียดค่าจ้างเมื่อโหลด timesheets แล้ว (สลิป preview ตรงกับตารางรายวัน)
 */
export function buildWorkerPayslipIncomeLinesFromTimesheets(
  line: PayrollBatchLine,
  timesheets: readonly DailyTimesheet[],
  ctx: SingleTimesheetGrossContext,
): PayslipLineItem[] {
  const allowanceItems = (line.hrLineAdjustments?.allowanceItems ?? []).filter(
    (x) => (Number(x.amount) || 0) > 0,
  );
  const lines: PayslipLineItem[] = allowanceItems.map((it) => ({
    label: it.label?.trim() || 'รายได้เพิ่ม (HR)',
    amount: round2(Number(it.amount) || 0),
  }));

  let normalDays = 0;
  let normalAmount = 0;
  let holidayDays = 0;
  let holidayAmount = 0;
  let standbyDays = 0;
  let standbyAmount = 0;
  const policyAmounts: Record<string, number> = {};

  for (const ts of timesheets) {
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
      standbyDays += Math.max(0, Number(ts.standbyUnits ?? 1));
      standbyAmount += r.gross;
      continue;
    }
    if (ts.eventType === 'work_day' && r.usedPackageLaborCost) {
      if (r.workDayRestDay) {
        holidayDays += 1;
        holidayAmount += r.gross;
      } else {
        normalDays += 1;
        normalAmount += r.gross;
      }
      continue;
    }
    const policyKey = `${ts.eventType}_policy`;
    policyAmounts[policyKey] = (policyAmounts[policyKey] || 0) + r.gross;
  }

  const n = workDaySplitIncomeLine('ค่าแรงวันปกติ', normalDays, round2(normalAmount));
  const h = workDaySplitIncomeLine('ค่าแรงวันหยุด', holidayDays, round2(holidayAmount));
  if (n) lines.push(n);
  if (h) lines.push(h);
  if (standbyDays > 0 && standbyAmount > 0.005) {
    lines.push(
      standbyPayslipLine('', 'standby_day', round2(standbyAmount), { standby_day: standbyDays }),
    );
  }

  for (const k of Object.keys(policyAmounts).sort((a, b) => a.localeCompare(b))) {
    const amt = round2(policyAmounts[k]);
    if (Math.abs(amt) < 0.005) continue;
    if (isStandbyDayPolicyKey(k)) {
      lines.push(standbyPayslipLine('', k, amt, line.eventBreakdown));
    } else {
      lines.push({ label: humanizeWorkerEarningsKey(k), amount: amt });
    }
  }

  return lines;
}

export function buildWorkerPayslipDeductionLines(line: PayrollBatchLine): PayslipLineItem[] {
  const d = line.deductionsBreakdown || line.d8Snapshot?.deductions || {};
  const manual = line.hrLineAdjustments?.deductionItems ?? [];
  const out: PayslipLineItem[] = [];

  const ss = round2(Number(d.social_security) || 0);
  out.push({ label: 'ประกันสังคม', amount: ss });

  const pit = round2(Number(d.pit_withholding) || 0);
  out.push({ label: 'ภาษี ณ ที่จ่าย (ภงด. 1)', amount: pit });

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
    out.push({ label: humanizeDeductionKey(k), amount: amt });
  }

  return out;
}

function sumLines(lines: PayslipLineItem[]): number {
  return round2(lines.reduce((s, x) => s + x.amount, 0));
}

export function buildPayslipFromWorkerLine(
  line: PayrollBatchLine,
  batch: PayrollBatch,
  periodLabel: string,
  companyProfile?: PayslipCompanyProfileSource,
): PayslipViewModel {
  const { companyNameTh, companyNameEn } = resolvePayslipCompanyNames(companyProfile);
  const incomeLines = buildWorkerPayslipIncomeLines(line);
  const deductionLines = buildWorkerPayslipDeductionLines(line);

  const snapshotGross = line.d8Snapshot?.gross;
  const sumIncome = sumLines(incomeLines);
  const grossTotal =
    snapshotGross != null && Number.isFinite(snapshotGross)
      ? round2(snapshotGross)
      : sumIncome > 0
        ? sumIncome
        : round2(line.grossAmount);

  const deductionsTotal = sumLines(deductionLines);
  const netFromLine = round2(line.netAmount);
  const netFromSnapshot = line.d8Snapshot?.net != null ? round2(line.d8Snapshot.net) : null;
  /** หักเบิกล่วงหน้าอยู่ที่บรรทัด batch ไม่ได้อยู่ใน D8 snapshot เดิม — ใช้ยอดสุทธิจากบรรทัด */
  const hasCashAdvanceRecovery = Number(line.deductionsBreakdown?.cash_advance_recovery) > 0;
  const netPay =
    hasCashAdvanceRecovery || netFromSnapshot == null ? netFromLine : netFromSnapshot;

  const impliedNet = round2(grossTotal - deductionsTotal);
  const roundingNote = Math.abs(impliedNet - netPay) >= 0.02;

  return {
    companyNameTh,
    companyNameEn,
    companyLogoUrl: companyProfile?.documentHeaderLogoUrl?.trim() || undefined,
    employeeName: line.workerNameSnapshot,
    periodLabel: periodLabel || formatYmdRangeThaiBE(line.periodStartDate, line.periodEndDate),
    payrollTypeLabel: 'ลูกจ้าง / Worker Payroll (Timesheet batch)',
    documentRef: batch.id,
    paymentDateLabel: formatPaymentDate(workerPaymentTimestamp(batch)),
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
  const otherInc = Number(line.otherIncome ?? 0);
  const bonus = Number(line.bonus ?? 0);
  const allowance = Number(line.allowance ?? 0);
  const base = Number(line.baseSalary ?? 0);
  const gross = line.grossPay;

  const ss = line.socialSecurity;
  const tax = line.tax;

  const incomeLines: PayslipLineItem[] = [];
  if (base > 0) incomeLines.push({ label: 'เงินเดือนฐาน', amount: round2(base) });
  if (ot > 0) incomeLines.push({ label: 'ค่าล่วงเวลา (OT)', amount: round2(ot) });
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
