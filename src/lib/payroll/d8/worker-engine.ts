import { D8_ENGINE_VERSION } from './constants';
import { fixedDeductionsFromPolicy, pitFromPolicy, socialSecurityFromPolicy } from './deductions-from-policy';
import { policiesAppliedList, type ResolvedPayrollPolicies } from './policies';
import type { PayrollLineD8Snapshot } from '@/lib/types';

export type WorkerPayrollD8Input = {
  asOfDate: string;
  policies: ResolvedPayrollPolicies;
  /** ยอดรวมจาก timesheet × rate (ก่อนหัก) */
  grossFromTimesheets: number;
  rate: { summary: string; conditionIds?: string[]; laborTermIds?: string[] };
  earningsBreakdown: Record<string, number>;
};

/**
 * D8 — คำนวณบรรทัด worker หลังรวม gross จาก timesheet แล้ว
 */
export function computeWorkerPayrollLineD8(input: WorkerPayrollD8Input): {
  deductionsBreakdown: Record<string, number>;
  netAmount: number;
  snapshot: PayrollLineD8Snapshot;
} {
  const gross = Math.max(0, input.grossFromTimesheets);

  const ss = socialSecurityFromPolicy(gross, input.policies.sso);
  const pit = pitFromPolicy(gross, input.policies.tax);
  const fixed = fixedDeductionsFromPolicy(input.policies.allowanceDeduction);

  const deductionsBreakdown: Record<string, number> = {
    social_security: ss,
    pit_withholding: pit,
    ...fixed,
  };

  const deductionsTotal = Object.values(deductionsBreakdown).reduce((a, b) => a + b, 0);
  const netAmount = Math.round((gross - deductionsTotal) * 100) / 100;
  const frozenAt = Date.now();

  const snapshot: PayrollLineD8Snapshot = {
    engineVersion: D8_ENGINE_VERSION,
    asOfDate: input.asOfDate,
    policiesApplied: policiesAppliedList(input.policies),
    rate: {
      summary: input.rate.summary,
      conditionIds: input.rate.conditionIds,
      laborTermIds: input.rate.laborTermIds,
    },
    earningsComponents: { ...input.earningsBreakdown },
    gross,
    deductions: { ...deductionsBreakdown },
    net: netAmount,
    frozenAt,
  };

  return { deductionsBreakdown, netAmount, snapshot };
}
