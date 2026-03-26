import type {
  OfficePayrollLine,
  OfficePayrollRun,
  PayrollBatch,
  PayrollBatchLine,
  PayrollLineD8Snapshot,
} from '@/lib/types';

export type PayslipViewModel = {
  employeeName: string;
  periodLabel: string;
  payrollTypeLabel: string;
  documentRef: string;
  paymentDateLabel: string;
  policyVersionLabel: string;
  income: {
    base: number;
    overtime: number;
    allowance: number;
    bonus: number;
    otherIncome: number;
    gross: number;
  };
  deductions: {
    socialSecurity: number;
    tax: number;
    otherLines: { label: string; amount: number }[];
    otherTotal: number;
    total: number;
  };
  netPay: number;
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
  return new Date(ts).toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** แยก base / OT / allowance จาก earningsBreakdown (คีย์ตาม event ของ timesheet) */
export function splitWorkerLineEarnings(line: PayrollBatchLine): {
  base: number;
  overtime: number;
  allowance: number;
} {
  const b = line.earningsBreakdown || {};
  let base = 0;
  let overtime = 0;
  let allowance = 0;
  const OT_RE = /ot|overtime|off_day_worked|public_holiday_worked|holiday_worked|sunday/i;
  for (const [k, v] of Object.entries(b)) {
    const amt = Number(v) || 0;
    if (/allowance/i.test(k)) allowance += amt;
    else if (OT_RE.test(k)) overtime += amt;
    else base += amt;
  }
  if (base + overtime + allowance === 0 && line.grossAmount > 0) {
    return { base: line.grossAmount, overtime: 0, allowance: 0 };
  }
  return { base, overtime, allowance };
}

function splitDeductionsMap(d: Record<string, number>): PayslipViewModel['deductions'] {
  const socialSecurity = d.social_security ?? 0;
  const tax = d.pit_withholding ?? 0;
  const otherLines: { label: string; amount: number }[] = [];
  let otherTotal = 0;
  for (const [k, v] of Object.entries(d)) {
    if (k === 'social_security' || k === 'pit_withholding') continue;
    const amt = Number(v) || 0;
    if (amt === 0) continue;
    otherLines.push({ label: k, amount: amt });
    otherTotal += amt;
  }
  const total = socialSecurity + tax + otherTotal;
  return { socialSecurity, tax, otherLines, otherTotal, total };
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

export function buildPayslipFromWorkerLine(
  line: PayrollBatchLine,
  batch: PayrollBatch,
  periodLabel: string
): PayslipViewModel {
  const { base, overtime, allowance } = splitWorkerLineEarnings(line);
  const d = line.deductionsBreakdown || line.d8Snapshot?.deductions || {};
  const deductions = splitDeductionsMap(d);
  const gross = line.grossAmount;
  const netPay = line.netAmount;

  return {
    employeeName: line.workerNameSnapshot,
    periodLabel:
      periodLabel ||
      `${line.periodStartDate} → ${line.periodEndDate}`,
    payrollTypeLabel: 'ลูกจ้าง / Worker Payroll (Timesheet batch)',
    documentRef: batch.id,
    paymentDateLabel: formatPaymentDate(workerPaymentTimestamp(batch)),
    policyVersionLabel: formatPolicyVersionFromSnapshot(line.d8Snapshot),
    income: {
      base,
      overtime,
      allowance,
      bonus: 0,
      otherIncome: 0,
      gross,
    },
    deductions,
    netPay,
  };
}

function officePaymentTimestamp(run: OfficePayrollRun): number | undefined {
  return run.lockedAt ?? run.updatedAt ?? run.createdAt;
}

export function buildPayslipFromOfficeLine(line: OfficePayrollLine, run: OfficePayrollRun): PayslipViewModel {
  const ot = Number(line.overtimeAmount ?? 0);
  const otherInc = Number(line.otherIncome ?? 0);
  const bonus = Number(line.bonus ?? 0);
  const allowance = Number(line.allowance ?? 0);
  const base = Number(line.baseSalary ?? 0);
  const gross = line.grossPay;

  const ss = line.socialSecurity;
  const tax = line.tax;
  const otherTotal = Math.max(0, line.deductions - tax - ss);
  const otherLines: { label: string; amount: number }[] = [];
  if (line.d8Snapshot?.deductions) {
    for (const [k, v] of Object.entries(line.d8Snapshot.deductions)) {
      if (k === 'social_security' || k === 'pit_withholding') continue;
      const amt = Number(v) || 0;
      if (amt !== 0) otherLines.push({ label: k, amount: amt });
    }
  } else if (otherTotal > 0) {
    otherLines.push({ label: 'other_deductions', amount: otherTotal });
  }

  return {
    employeeName: line.staffName,
    periodLabel: `${run.payrollPeriodStart} → ${run.payrollPeriodEnd} (${run.payrollMonth})`,
    payrollTypeLabel: 'พนักงานออฟฟิศ / Office Payroll (รายเดือน)',
    documentRef: run.payrollRunNo,
    paymentDateLabel: formatPaymentDate(officePaymentTimestamp(run)),
    policyVersionLabel: formatPolicyVersionFromSnapshot(line.d8Snapshot),
    income: {
      base,
      overtime: ot,
      allowance,
      bonus,
      otherIncome: otherInc,
      gross,
    },
    deductions: {
      socialSecurity: ss,
      tax,
      otherLines,
      otherTotal,
      total: line.deductions,
    },
    netPay: line.netPay,
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
