import type { PayrollPolicyKind, PayrollPolicyRecord } from '@/lib/types';
import {
  HR_STATUTORY_POLICY_SSO_ID,
  HR_STATUTORY_POLICY_TAX_OFFICE_ID,
} from '@/lib/payroll/d8/hr-statutory-policy-ids';

export type PayrollScope = 'office' | 'worker';

export type ResolvedPayrollPolicies = {
  sso: PayrollPolicyRecord | null;
  tax: PayrollPolicyRecord | null;
  allowanceDeduction: PayrollPolicyRecord | null;
};

function inEffectiveRange(asOf: string, p: PayrollPolicyRecord): boolean {
  if (p.effectiveFrom > asOf) return false;
  if (p.effectiveTo !== null && p.effectiveTo < asOf) return false;
  return true;
}

function policyMatchesScope(p: PayrollPolicyRecord, scope: PayrollScope): boolean {
  const a = p.appliesTo ?? 'all';
  return a === 'all' || a === scope;
}

function pickLatest(
  asOf: string,
  policies: PayrollPolicyRecord[],
  kind: PayrollPolicyKind,
  scope: PayrollScope
): PayrollPolicyRecord | null {
  const candidates = policies.filter(
    (p) =>
      p.kind === kind &&
      p.status === 'active' &&
      inEffectiveRange(asOf, p) &&
      (kind !== 'tax' && kind !== 'allowance_deduction' ? true : policyMatchesScope(p, scope))
  );
  if (!candidates.length) return null;
  if (kind === 'sso') {
    const hr = candidates.find((p) => p.id === HR_STATUTORY_POLICY_SSO_ID);
    if (hr) return hr;
  }
  if (kind === 'tax' && scope === 'office') {
    const hr = candidates.find((p) => p.id === HR_STATUTORY_POLICY_TAX_OFFICE_ID);
    if (hr) return hr;
  }
  return candidates.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null;
}

/** เลือกชุด policy ที่มีผล ณ วันที่ asOf (YYYY-MM-DD) */
export function resolvePayrollPoliciesForDate(
  asOf: string,
  all: PayrollPolicyRecord[],
  scope: PayrollScope
): ResolvedPayrollPolicies {
  return {
    sso: pickLatest(asOf, all, 'sso', scope),
    tax: pickLatest(asOf, all, 'tax', scope),
    allowanceDeduction: pickLatest(asOf, all, 'allowance_deduction', scope),
  };
}

export function policiesAppliedList(
  resolved: ResolvedPayrollPolicies
): Array<{ kind: PayrollPolicyKind; policyId: string; policyName: string; effectiveFrom: string }> {
  const out: Array<{ kind: PayrollPolicyKind; policyId: string; policyName: string; effectiveFrom: string }> =
    [];
  if (resolved.sso)
    out.push({
      kind: 'sso',
      policyId: resolved.sso.id,
      policyName: resolved.sso.name,
      effectiveFrom: resolved.sso.effectiveFrom,
    });
  if (resolved.tax)
    out.push({
      kind: 'tax',
      policyId: resolved.tax.id,
      policyName: resolved.tax.name,
      effectiveFrom: resolved.tax.effectiveFrom,
    });
  if (resolved.allowanceDeduction)
    out.push({
      kind: 'allowance_deduction',
      policyId: resolved.allowanceDeduction.id,
      policyName: resolved.allowanceDeduction.name,
      effectiveFrom: resolved.allowanceDeduction.effectiveFrom,
    });
  return out;
}
