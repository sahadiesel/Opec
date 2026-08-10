/**
 * กติกาหักตามกฎหมายฝั่งลูกจ้าง (ปสง. / ภงด.1)
 *
 * ## งวดตกเบิกอย่างเดียว (SUPPLEMENTAL) — ไม่มีค่าแรงเดือนปัจจุบันในงวดนี้
 * - **ไม่หักประกันสังคม** (ไม่มีค่าจ้างงวดปัจจุบันที่นำส่ง ปสง.)
 * - **คิด ภงด.1 ตามปกติ** จากยอดตกเบิก (+ ฐานงวด NORMAL ในเดือนภาษีเดียวกัน ถ้ามี)
 *   แบบส่วนต่าง: tax(prior + supplemental) − tax(prior) โดยฐานภาษีใช้ SSO = 0
 * - ถ้ายังไม่ถึงเกณฑ์ขั้นบันไดหลังประมาณการ ×12 − ลดหย่อน → ภงด. = 0
 */

import {
  pitFromMonthlyGross,
  pitFromMonthlyGrossWithMarginalCeiling,
} from './deductions-from-policy';
import type { ResolvedPayrollPolicies } from './policies';
import type { WorkerPitCalculationMode } from '@/lib/types';

export function isSupplementalPayrollBatchType(
  batchType: 'NORMAL' | 'SUPPLEMENTAL' | string | null | undefined,
): boolean {
  return batchType === 'SUPPLEMENTAL';
}

/** บังคับไม่หัก ปสง. และกองทุนสงเคราะห์ลูกจ้างในงวดตกเบิก */
export function forceSupplementalNoSocialSecurity(
  deductions: Record<string, number>,
): Record<string, number> {
  return { ...deductions, social_security: 0, employee_assistance_fund: 0 };
}

/**
 * ภงด. ส่วนต่างรอบตกเบิก — ไม่หัก ปสง. ออกจากฐาน (customSso = 0)
 */
export function supplementalIncrementalPitBaht(input: {
  supplementalGross: number;
  priorPaidTaxableGross: number;
  policies: ResolvedPayrollPolicies;
  maxMarginalRatePercent?: number | null;
}): number {
  const gross = Math.max(0, input.supplementalGross);
  const prior = Math.max(0, input.priorPaidTaxableGross);
  const mr = input.maxMarginalRatePercent;
  if (mr != null && Number.isFinite(mr)) {
    const clamped = Math.max(0, Math.min(35, Number(mr)));
    const taxTotal = pitFromMonthlyGrossWithMarginalCeiling(
      prior + gross,
      input.policies.tax,
      input.policies.sso,
      clamped,
      0,
    );
    const taxPrior = pitFromMonthlyGrossWithMarginalCeiling(
      prior,
      input.policies.tax,
      input.policies.sso,
      clamped,
      0,
    );
    return Math.max(0, taxTotal - taxPrior);
  }
  const taxTotal = pitFromMonthlyGross(prior + gross, input.policies.tax, input.policies.sso, 0);
  const taxPrior = pitFromMonthlyGross(prior, input.policies.tax, input.policies.sso, 0);
  return Math.max(0, taxTotal - taxPrior);
}

export type ResolveWorkerPitModeInput = {
  mode: WorkerPitCalculationMode;
  /** รายได้ที่ใช้คิดภาษีในงวดนี้ (SUPPLEMENTAL = ยอดตกเบิก) */
  effectiveGross: number;
  policies: ResolvedPayrollPolicies;
  /** จาก D8 — สำหรับ NORMAL; SUPPLEMENTAL บังคับใช้ 0 */
  socialSecurityBaht: number;
  isSupplemental: boolean;
  priorPaidTaxableGross?: number;
  pitWithholdingOverride?: number | null;
  pitAutoSalaryBaseBaht?: number | null;
  maxMarginalRatePercent?: number | null;
};

/** คืนยอด ภงด. ตามโหมด HR — เคารพกติกางวดตกเบิก */
export function resolveWorkerPitWithholdingBaht(input: ResolveWorkerPitModeInput): number {
  if (input.mode === 'manual_baht') {
    return Math.max(0, Number(input.pitWithholdingOverride) || 0);
  }
  if (input.mode === 'auto_salary_base') {
    const base = Math.max(0, Number(input.pitAutoSalaryBaseBaht) || 0);
    /** ฐานเงินเดือนที่ HR ระบุ — คิด ภงด. ตามปกติ (อาจหัก ปสง. ในสูตร annualize ตาม policy) */
    return pitFromMonthlyGross(base, input.policies.tax, input.policies.sso);
  }

  if (input.isSupplemental) {
    return supplementalIncrementalPitBaht({
      supplementalGross: input.effectiveGross,
      priorPaidTaxableGross: input.priorPaidTaxableGross ?? 0,
      policies: input.policies,
      maxMarginalRatePercent: input.maxMarginalRatePercent,
    });
  }

  const ss = Math.max(0, Number(input.socialSecurityBaht) || 0);
  const mr = input.maxMarginalRatePercent;
  if (mr != null && Number.isFinite(mr)) {
    const clamped = Math.max(0, Math.min(35, Number(mr)));
    return pitFromMonthlyGrossWithMarginalCeiling(
      input.effectiveGross,
      input.policies.tax,
      input.policies.sso,
      clamped,
      ss,
    );
  }
  return pitFromMonthlyGross(input.effectiveGross, input.policies.tax, input.policies.sso, ss);
}
