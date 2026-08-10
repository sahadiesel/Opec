import { D8_ENGINE_VERSION } from './constants';
import {
  fixedDeductionsFromPolicy,
  pitFromMonthlyGross,
  socialSecurityFromPolicy,
} from './deductions-from-policy';
import { policiesAppliedList, type ResolvedPayrollPolicies } from './policies';
import {
  forceSupplementalNoSocialSecurity,
  isSupplementalPayrollBatchType,
  supplementalIncrementalPitBaht,
} from './worker-statutory';
import type { PayrollLineD8Snapshot } from '@/lib/types';

export type WorkerPayrollD8Input = {
  asOfDate: string;
  policies: ResolvedPayrollPolicies;
  /** ยอดรวมจาก timesheet × rate (ก่อนหัก) */
  grossFromTimesheets: number;
  rate: { summary: string; conditionIds?: string[]; laborTermIds?: string[] };
  earningsBreakdown: Record<string, number>;
  batchType?: 'NORMAL' | 'SUPPLEMENTAL';
  /**
   * ฐานรายได้ของรอบ NORMAL ในเดือนภาษีเดียวกัน (เพื่อคิด ภงด. ส่วนต่างรอบตกเบิก)
   * — งวดตกเบิกอย่างเดียวไม่มีค่าแรงเดือนปัจจุบัน → prior = 0
   */
  priorPaidTaxableGross?: number;
};

/**
 * D8 — คำนวณบรรทัด worker หลังรวม gross จาก timesheet แล้ว
 *
 * SUPPLEMENTAL (ตกเบิกเดือนก่อน / ไม่มีค่าแรงงวดปัจจุบันใน batch นี้):
 * ไม่หักประกันสังคม · คิด ภงด. ตามเกณฑ์ปกติ (ส่วนต่างจากฐาน prior ถ้ามี)
 */
export function computeWorkerPayrollLineD8(input: WorkerPayrollD8Input): {
  deductionsBreakdown: Record<string, number>;
  netAmount: number;
  snapshot: PayrollLineD8Snapshot;
} {
  const gross = Math.max(0, input.grossFromTimesheets);
  const allowances = Number(input.earningsBreakdown?.hr_allowances) || 0;
  const isSupplemental = isSupplementalPayrollBatchType(input.batchType);

  let ss = 0;
  let pit = 0;

  if (isSupplemental) {
    ss = 0;
    pit = supplementalIncrementalPitBaht({
      supplementalGross: gross,
      priorPaidTaxableGross: input.priorPaidTaxableGross || 0,
      policies: input.policies,
    });
  } else {
    const ssoBase = Math.max(0, gross - allowances);
    ss = socialSecurityFromPolicy(ssoBase, input.policies.sso);
    pit = pitFromMonthlyGross(gross, input.policies.tax, input.policies.sso, ss);
  }

  const fixed = fixedDeductionsFromPolicy(input.policies.allowanceDeduction);

  let deductionsBreakdown: Record<string, number> = {
    social_security: ss,
    pit_withholding: pit,
    ...fixed,
  };
  if (isSupplemental) {
    deductionsBreakdown = forceSupplementalNoSocialSecurity(deductionsBreakdown);
  }

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
