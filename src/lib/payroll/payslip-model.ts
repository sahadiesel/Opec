import type {
  OfficePayrollLine,
  OfficePayrollRun,
  PayrollBatch,
  PayrollBatchLine,
  PayrollLineD8Snapshot,
} from '@/lib/types';
import { formatDateThaiBE } from '@/lib/date-thai';

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

export type PayslipViewModel = {
  companyNameTh: string;
  companyNameEn: string;
  /** โลโก้จาก company profile ถ้ามี */
  companyLogoUrl?: string;
  employeeName: string;
  periodLabel: string;
  payrollTypeLabel: string;
  documentRef: string;
  paymentDateLabel: string;
  policyVersionLabel: string;
  /** รายการรายได้แต่ละบรรทัด (ครบทั้ง timesheet + HR) */
  incomeLines: PayslipLineItem[];
  grossTotal: number;
  /** รายการหักแต่ละบรรทัด */
  deductionLines: PayslipLineItem[];
  deductionsTotal: number;
  netPay: number;
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

/**
 * รายได้รายบรรทัด — อ้างอิง snapshot ก่อน แล้วจึง earningsBreakdown + รายการเบี้ยเลี้ยงจาก HR
 */
export function buildWorkerPayslipIncomeLines(line: PayrollBatchLine): PayslipLineItem[] {
  const fromSnapshot = line.d8Snapshot?.earningsComponents;
  const baseEb = { ...(fromSnapshot && Object.keys(fromSnapshot).length > 0 ? fromSnapshot : line.earningsBreakdown || {}) };
  const allowanceItems = (line.hrLineAdjustments?.allowanceItems ?? []).filter(
    (x) => (Number(x.amount) || 0) > 0,
  );

  if (allowanceItems.length > 0) {
    delete baseEb.hr_allowances;
  }

  const lines: PayslipLineItem[] = [];

  for (const it of allowanceItems) {
    lines.push({
      label: it.label?.trim() || 'รายได้เพิ่ม (HR)',
      amount: round2(Number(it.amount) || 0),
    });
  }

  const keys = Object.keys(baseEb).sort((a, b) => a.localeCompare(b));
  for (const k of keys) {
    const amt = round2(Number(baseEb[k]) || 0);
    if (Math.abs(amt) < 0.005) continue;
    lines.push({ label: humanizeWorkerEarningsKey(k), amount: amt });
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
  const netPay = netFromSnapshot != null ? netFromSnapshot : netFromLine;

  const impliedNet = round2(grossTotal - deductionsTotal);
  const roundingNote = Math.abs(impliedNet - netPay) >= 0.02;

  return {
    companyNameTh,
    companyNameEn,
    companyLogoUrl: companyProfile?.documentHeaderLogoUrl?.trim() || undefined,
    employeeName: line.workerNameSnapshot,
    periodLabel: periodLabel || `${line.periodStartDate} → ${line.periodEndDate}`,
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

function officePaymentTimestamp(run: OfficePayrollRun): number | undefined {
  return run.lockedAt ?? run.updatedAt ?? run.createdAt;
}

export function buildPayslipFromOfficeLine(
  line: OfficePayrollLine,
  run: OfficePayrollRun,
  companyProfile?: PayslipCompanyProfileSource,
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

  return {
    companyNameTh,
    companyNameEn,
    companyLogoUrl: companyProfile?.documentHeaderLogoUrl?.trim() || undefined,
    employeeName: line.staffName,
    periodLabel: `${run.payrollPeriodStart} → ${run.payrollPeriodEnd} (${run.payrollMonth})`,
    payrollTypeLabel: 'พนักงานออฟฟิศ / Office Payroll (รายเดือน)',
    documentRef: run.payrollRunNo,
    paymentDateLabel: formatPaymentDate(officePaymentTimestamp(run)),
    policyVersionLabel: formatPolicyVersionFromSnapshot(line.d8Snapshot),
    incomeLines,
    grossTotal: round2(gross),
    deductionLines,
    deductionsTotal,
    netPay,
    roundingNote:
      Math.abs(impliedNet - netPay) >= 0.02 ||
      Math.abs(summedDed - round2(line.deductions)) >= 0.02,
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
