import { D8_ENGINE_VERSION } from './constants';
import {
  fixedDeductionsFromPolicy,
  pitFromMonthlyGross,
  socialSecurityFromPolicy,
} from './deductions-from-policy';
import { employeeAssistanceFundFromSsoPolicy } from '@/lib/payroll/employee-assistance-fund';
import { policiesAppliedList, type ResolvedPayrollPolicies } from './policies';
import {
  forceSupplementalNoSocialSecurity,
  isSupplementalPayrollBatchType,
  supplementalIncrementalPitBaht,
} from './worker-statutory';
import type { PayrollLineD8Snapshot } from '@/lib/types';
import {
  DEFAULT_LUMP_SUM_WHT_RATE_PERCENT,
  LUMP_SUM_WHT_DEDUCTION_KEY,
  lumpSumWithholdingBaht,
} from '@/lib/payroll/lump-sum-worker';

export type WorkerPayrollD8Input = {
  asOfDate: string;
  policies: ResolvedPayrollPolicies;
  /** ยอดรวมจาก timesheet × rate (ก่อนหัก) */
  grossFromTimesheets: number;
  rate: { summary: string; conditionIds?: string[]; laborTermIds?: string[] };
  earningsBreakdown: Record<string, number>;
  batchType?: 'NORMAL' | 'SUPPLEMENTAL';
  /**
   * @deprecated ภงด. งวดตกเบิกไม่ใช้ฐานงวดปกติแล้ว — คง field ไว้เพื่อไม่พัง caller
   */
  priorPaidTaxableGross?: number;
  /**
   * ลูกจ้างแบบเหมา — ส่งอัตราหัก ณ ที่จ่าย (%) จะข้าม ปสง./ภงด.1 และหักเหมาแทน
   * ไม่ส่ง = ลูกจ้างบริษัท (สูตรเดิม)
   */
  lumpSumWhtRatePercent?: number | null;
};

/**
 * D8 — คำนวณบรรทัด worker หลังรวม gross จาก timesheet แล้ว
 *
 * SUPPLEMENTAL (ตกเบิกเดือนก่อน / ไม่มีค่าแรงงวดปัจจุบันใน batch นี้):
 * ไม่หักประกันสังคม · คิด ภงด. จากยอดตกเบิกครั้งนี้เท่านั้น (สูตร HR ×12)
 */
export function computeWorkerPayrollLineD8(input: WorkerPayrollD8Input): {
  deductionsBreakdown: Record<string, number>;
  netAmount: number;
  snapshot: PayrollLineD8Snapshot;
} {
  const gross = Math.max(0, input.grossFromTimesheets);
  const allowances = Number(input.earningsBreakdown?.hr_allowances) || 0;
  const isSupplemental = isSupplementalPayrollBatchType(input.batchType);
  const lumpSumRate =
    input.lumpSumWhtRatePercent != null && Number.isFinite(input.lumpSumWhtRatePercent)
      ? Math.max(0, Number(input.lumpSumWhtRatePercent))
      : null;

  let ss = 0;
  let fund = 0;
  let pit = 0;

  if (lumpSumRate != null) {
    ss = 0;
    fund = 0;
    pit = 0;
  } else if (isSupplemental) {
    ss = 0;
    fund = 0;
    pit = supplementalIncrementalPitBaht({
      supplementalGross: gross,
      priorPaidTaxableGross: input.priorPaidTaxableGross || 0,
      policies: input.policies,
    });
  } else {
    const ssoBase = Math.max(0, gross - allowances);
    ss = socialSecurityFromPolicy(ssoBase, input.policies.sso);
    fund = employeeAssistanceFundFromSsoPolicy(ssoBase, input.policies.sso);
    /** PIT annualization base ต้องหักทั้ง ปสง. และกองทุนสงเคราะห์ลูกจ้างออกก่อน */
    pit = pitFromMonthlyGross(gross, input.policies.tax, input.policies.sso, ss + fund);
  }

  const fixed = fixedDeductionsFromPolicy(input.policies.allowanceDeduction);

  let deductionsBreakdown: Record<string, number> =
    lumpSumRate != null
      ? {
          [LUMP_SUM_WHT_DEDUCTION_KEY]: lumpSumWithholdingBaht(
            gross,
            lumpSumRate ?? DEFAULT_LUMP_SUM_WHT_RATE_PERCENT,
          ),
          ...fixed,
        }
      : {
          social_security: ss,
          ...(fund > 0 ? { employee_assistance_fund: fund } : {}),
          pit_withholding: pit,
          ...fixed,
        };
  if (isSupplemental && lumpSumRate == null) {
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
