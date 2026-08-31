import { D8_ENGINE_VERSION } from './constants';
import { fixedDeductionsFromPolicy, pitFromPolicy, socialSecurityFromPolicy } from './deductions-from-policy';
import { policiesAppliedList, type ResolvedPayrollPolicies } from './policies';
import { employeeAssistanceFundFromSsoPolicy } from '@/lib/payroll/employee-assistance-fund';
import type { OfficePayrollPitMode, PayrollLineD8Snapshot } from '@/lib/types';

export type OfficePayrollD8Input = {
  asOfDate: string;
  policies: ResolvedPayrollPolicies;
  baseSalary: number;
  allowance: number;
  bonus: number;
  overtimeAmount?: number;
  otherIncome?: number;
  /** รายรับเพิ่มจาก HR — รวมใน gross (เช่นเดียวกับเบี้ยเลี้ยงงวดลูกจ้าง) */
  hrAllowanceItems?: Array<{ label: string; amount: number }>;
  /** หักเพิ่ม — ลงเป็น manual_ded_i ใน snapshot */
  hrDeductionItems?: Array<{ label: string; amount: number }>;
  /**
   * หักก่อนคำนวณ ภงด.1 (เช่น ขาด/สาย/ลาไม่จ่ายที่ปรับจากเงินเดือน)
   * — ลดฐานภาษีเท่านั้น; ประกันสังคม office ใช้ฐานเงินเดือน (base) อย่างเดียว
   */
  preStatutoryDeductions?: Array<{ code: string; amount: number }>;
  /** false = ไม่หักประกันสังคมในงวดนี้ */
  deductSocialSecurity?: boolean;
  pitMode?: OfficePayrollPitMode;
  pitManualPercent?: number | null;
  pitManualAmountBaht?: number | null;
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
  const hrAllowanceSum = (input.hrAllowanceItems ?? []).reduce(
    (s, x) => s + Math.max(0, Number(x.amount) || 0),
    0,
  );
  const grossPay = Math.max(0, input.baseSalary + input.allowance + input.bonus + ot + other + hrAllowanceSum);

  const preStatutoryMap: Record<string, number> = {};
  for (const row of input.preStatutoryDeductions ?? []) {
    const code = String(row.code || '').trim() || 'pre_statutory';
    const amt = Math.max(0, Number(row.amount) || 0);
    if (amt <= 0) continue;
    preStatutoryMap[code] = (preStatutoryMap[code] ?? 0) + amt;
  }
  const preStatutoryTotal = Object.values(preStatutoryMap).reduce((a, b) => a + b, 0);
  const statutoryEarningsBase = Math.max(0, Math.round((grossPay - preStatutoryTotal) * 100) / 100);

  const deductSs = input.deductSocialSecurity !== false;
  const ssoWageBase = Math.max(0, Math.round(Number(input.baseSalary) * 100) / 100);
  /** ปสง. office — ฐานเงินเดือนอย่างเดียว (ไม่รวม OT / เบี้ยเลี้ยง / หักขาด·สาย·ลา) */
  const ss = deductSs ? socialSecurityFromPolicy(ssoWageBase, input.policies.sso, input.asOfDate) : 0;
  /** กองทุนสงเคราะห์ลูกจ้าง — ฐานเดียวกับ ปสง. office; งวดที่ไม่หัก ปสง. ก็ไม่หักกองทุนนี้ */
  const fund = deductSs ? employeeAssistanceFundFromSsoPolicy(ssoWageBase, input.policies.sso) : 0;

  const pitMode = input.pitMode ?? 'SYSTEM';
  let pit: number;
  if (pitMode === 'MANUAL_PERCENT') {
    const p = Math.max(0, Math.min(100, Number(input.pitManualPercent) || 0));
    pit = Math.round(((statutoryEarningsBase * p) / 100) * 100) / 100;
  } else if (pitMode === 'MANUAL_AMOUNT') {
    pit = Math.max(0, Math.round((Number(input.pitManualAmountBaht) || 0) * 100) / 100);
    if (pit > statutoryEarningsBase) pit = Math.round(statutoryEarningsBase * 100) / 100;
  } else {
    const pitMonthlyTaxableAfterSs = Math.max(0, Math.round((statutoryEarningsBase - ss - fund) * 100) / 100);
    /** OT เป็นรายได้ไม่ประจำ — บวกเข้ารายได้รายปีครั้งเดียว ไม่ annualize × 12 */
    const irregularOt = Math.max(0, Math.round(ot * 100) / 100);
    const regularPitMonthly = Math.max(0, Math.round((pitMonthlyTaxableAfterSs - irregularOt) * 100) / 100);
    pit = pitFromPolicy(regularPitMonthly, input.policies.tax, {
      annualIrregularAddOnBaht: irregularOt > 0 ? irregularOt : undefined,
    });
  }
  const fixed = fixedDeductionsFromPolicy(input.policies.allowanceDeduction);

  const deductionsMap: Record<string, number> = {
    ...preStatutoryMap,
    social_security: ss,
    ...(fund > 0 ? { employee_assistance_fund: fund } : {}),
    pit_withholding: pit,
    ...fixed,
  };
  (input.hrDeductionItems ?? []).forEach((item, idx) => {
    const amt = Math.max(0, Number(item.amount) || 0);
    if (amt > 0) deductionsMap[`manual_ded_${idx}`] = amt;
  });

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
      hr_additional_income: hrAllowanceSum,
      ...(preStatutoryTotal > 0 ? { pre_statutory_deductions_total: preStatutoryTotal } : {}),
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
