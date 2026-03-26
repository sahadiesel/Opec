import { D8_ENGINE_VERSION } from './constants';
import { fixedDeductionsFromPolicy, pitFromPolicy, socialSecurityFromPolicy } from './deductions-from-policy';
import { policiesAppliedList, type ResolvedPayrollPolicies } from './policies';
import type { PayrollLineD8Snapshot } from '@/lib/types';

export type OfficePayrollD8Input = {
  asOfDate: string;
  policies: ResolvedPayrollPolicies;
  baseSalary: number;
  allowance: number;
  bonus: number;
  overtimeAmount?: number;
  otherIncome?: number;
};

/**
 * D8 — คำนวณบรรทัด office แบบ pure (ไม่แตะ Firestore)
 * gross = base + allowance + bonus + OT + other income
 */
export function computeOfficePayrollLineD8(input: OfficePayrollD8Input): {
  grossPay: number;
  tax: number;
  socialSecurity: number;
  deductions: number;
  netPay: number;
  snapshot: PayrollLineD8Snapshot;
} {
  const ot = Number(input.overtimeAmount ?? 0);
  const other = Number(input.otherIncome ?? 0);
  const grossPay = Math.max(0, input.baseSalary + input.allowance + input.bonus + ot + other);

  const ss = socialSecurityFromPolicy(grossPay, input.policies.sso);
  const pit = pitFromPolicy(grossPay, input.policies.tax);
  const fixed = fixedDeductionsFromPolicy(input.policies.allowanceDeduction);

  const deductionsMap: Record<string, number> = {
    social_security: ss,
    pit_withholding: pit,
    ...fixed,
  };

  const deductionsTotal = Object.values(deductionsMap).reduce((a, b) => a + b, 0);
  const netPay = Math.round((grossPay - deductionsTotal) * 100) / 100;

  const frozenAt = Date.now();
  const snapshot: PayrollLineD8Snapshot = {
    engineVersion: D8_ENGINE_VERSION,
    asOfDate: input.asOfDate,
    policiesApplied: policiesAppliedList(input.policies),
    earningsComponents: {
      base: input.baseSalary,
      allowance: input.allowance,
      bonus: input.bonus,
      overtime: ot,
      other_income: other,
    },
    gross: grossPay,
    deductions: deductionsMap,
    net: netPay,
    frozenAt,
  };

  return {
    grossPay,
    tax: pit,
    socialSecurity: ss,
    deductions: deductionsTotal,
    netPay,
    snapshot,
  };
}
