import {
  DEFAULT_SOCIAL_SECURITY_EMPLOYEE_RATE_PERCENT,
  DEFAULT_SOCIAL_SECURITY_MONTHLY_CEILING_BAHT,
  normalizePitBands,
  statutorySocialSecurityMonthlyCeilingBaht,
} from '@/lib/hr/pit-thailand';
import {
  monthlyEmployeePITWithholding,
  monthlyEmployeePITWithholdingWithMarginalCeiling,
} from '@/lib/payroll/employee-payroll-deductions';
import type { PayrollPolicyRecord } from '@/lib/types';

/** ปกส. ต้องเป็นจำนวนเงินบาทเต็ม — หากมีเศษให้ปัดขึ้นเสมอ เช่น 337.50 → 338 */
export function roundSocialSecurityBahtUp(amount: number): number {
  const v = Number(amount);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.ceil(v);
}

export function resolveSocialSecurityMonthlyCeilingBaht(
  policy: PayrollPolicyRecord | null,
  asOfDate?: string,
): number {
  const fromPolicy = Number(policy?.config?.monthlyCeilingBaht);
  if (Number.isFinite(fromPolicy) && fromPolicy > 0) return fromPolicy;
  if (asOfDate) return statutorySocialSecurityMonthlyCeilingBaht(asOfDate);
  return DEFAULT_SOCIAL_SECURITY_MONTHLY_CEILING_BAHT;
}

export function socialSecurityFromPolicy(
  grossForSS: number,
  policy: PayrollPolicyRecord | null,
  asOfDate?: string,
): number {
  if (!policy) return 0;
  const rate = Number(policy.config.employeeRatePercent ?? DEFAULT_SOCIAL_SECURITY_EMPLOYEE_RATE_PERCENT) / 100;
  const ceiling = resolveSocialSecurityMonthlyCeilingBaht(policy, asOfDate);
  const base = Math.min(Math.max(0, grossForSS), ceiling);
  return roundSocialSecurityBahtUp(base * rate);
}

/**
 * ฐานรายเดือนที่นำไป ×12 ในสูตร `th_pit_monthly_annualized`
 * — ต้องเป็นยอด **หลังหักประกันสังคมฝั่งลูกจ้างแล้ว** ให้ตรงกล่องทดสอบ HR /
 * `pitDemoCalc` (ไม่ใช่ gross ก่อนหัก ปสง.)
 */
export function monthlyPitAnnualizationBaseFromGross(
  grossMonthlyBeforeSs: number,
  ssoPolicy: PayrollPolicyRecord | null,
  customSso?: number,
): number {
  const ss = customSso !== undefined ? customSso : socialSecurityFromPolicy(grossMonthlyBeforeSs, ssoPolicy);
  return Math.max(0, grossMonthlyBeforeSs - ss);
}

/** ภงด. จาก gross รายเดือน + policies — ภายในหัก ปสง. ก่อน annualize (สอดคล้องหน้า HR ทดสอบสูตร) */
export function pitFromMonthlyGross(
  grossMonthly: number,
  taxPolicy: PayrollPolicyRecord | null,
  ssoPolicy: PayrollPolicyRecord | null,
  customSso?: number,
): number {
  return pitFromPolicy(monthlyPitAnnualizationBaseFromGross(grossMonthly, ssoPolicy, customSso), taxPolicy);
}

export function pitFromMonthlyGrossWithMarginalCeiling(
  grossMonthly: number,
  taxPolicy: PayrollPolicyRecord | null,
  ssoPolicy: PayrollPolicyRecord | null,
  maxMarginalRatePercent: number,
  customSso?: number,
): number {
  return pitFromPolicyWithMarginalCeiling(
    monthlyPitAnnualizationBaseFromGross(grossMonthly, ssoPolicy, customSso),
    taxPolicy,
    maxMarginalRatePercent,
  );
}

/** @param monthlyTaxableGross ฐานหลังหัก ปสง. แล้ว — ถ้ามีแค่ gross เต็มให้ใช้ {@link pitFromMonthlyGross} */
export function pitFromPolicy(
  monthlyTaxableGross: number,
  policy: PayrollPolicyRecord | null,
  options?: { annualIrregularAddOnBaht?: number },
): number {
  if (!policy) return 0;
  const mode = String(policy.config.mode ?? 'none');
  if (mode !== 'th_pit_monthly_annualized') return 0;
  const annual = Number(policy.config.annualPersonalAllowance);
  const bands = normalizePitBands(policy.config.pitProgressiveBands) ?? undefined;
  return monthlyEmployeePITWithholding({
    monthlyTaxableGross,
    annualIrregularAddOnBaht: options?.annualIrregularAddOnBaht,
    annualDeductions: Number.isFinite(annual) ? annual : undefined,
    pitProgressiveBands: bands,
  });
}

/** หัก ภงด. รายเดือนตามขั้นบันได โดยจำกัดไม่ให้คิดช่วงที่ marginal สูงกว่า `maxMarginalRatePercent` */
export function pitFromPolicyWithMarginalCeiling(
  monthlyTaxableGross: number,
  policy: PayrollPolicyRecord | null,
  maxMarginalRatePercent: number,
): number {
  if (!policy) return 0;
  const mode = String(policy.config.mode ?? 'none');
  if (mode !== 'th_pit_monthly_annualized') return 0;
  const annual = Number(policy.config.annualPersonalAllowance);
  const bands = normalizePitBands(policy.config.pitProgressiveBands) ?? undefined;
  return monthlyEmployeePITWithholdingWithMarginalCeiling({
    monthlyTaxableGross,
    annualDeductions: Number.isFinite(annual) ? annual : undefined,
    pitProgressiveBands: bands,
    maxMarginalRatePercent,
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
