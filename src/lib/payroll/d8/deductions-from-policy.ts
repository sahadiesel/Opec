import {
  DEFAULT_SOCIAL_SECURITY_EMPLOYEE_RATE_PERCENT,
  DEFAULT_SOCIAL_SECURITY_MONTHLY_CEILING_BAHT,
} from '@/lib/hr/pit-thailand';
import { monthlyEmployeePITWithholding } from '@/lib/payroll/employee-payroll-deductions';
import type { PayrollPolicyRecord } from '@/lib/types';

export function socialSecurityFromPolicy(grossForSS: number, policy: PayrollPolicyRecord | null): number {
  if (!policy) return 0;
  const rate = Number(policy.config.employeeRatePercent ?? DEFAULT_SOCIAL_SECURITY_EMPLOYEE_RATE_PERCENT) / 100;
  const ceiling = Number(policy.config.monthlyCeilingBaht ?? DEFAULT_SOCIAL_SECURITY_MONTHLY_CEILING_BAHT);
  const base = Math.min(Math.max(0, grossForSS), ceiling);
  return Math.round(base * rate * 100) / 100;
}

export function pitFromPolicy(monthlyTaxableGross: number, policy: PayrollPolicyRecord | null): number {
  if (!policy) return 0;
  const mode = String(policy.config.mode ?? 'none');
  if (mode !== 'th_pit_monthly_annualized') return 0;
  const annual = Number(policy.config.annualPersonalAllowance);
  return monthlyEmployeePITWithholding({
    monthlyTaxableGross,
    annualDeductions: Number.isFinite(annual) ? annual : undefined,
  });
}

export function fixedDeductionsFromPolicy(policy: PayrollPolicyRecord | null): Record<string, number> {
  const out: Record<string, number> = {};
  const rows = (policy?.config?.fixedDeductions as Array<{ code: string; amount: number }> | undefined) || [];
  for (const row of rows) {
    if (!row?.code) continue;
    out[row.code] = Number(row.amount) || 0;
  }
  return out;
}
