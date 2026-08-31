/**
 * หักภาษีเงินได้บุคคลรายเดือน (พนักงาน/ลูกจ้างที่ไม่ใช้เหมาจ่าย 40(1))
 * ตามที่ตกลง: ประมาณรายได้ประจำ × 12 + รายได้ไม่ประจำในเดือน (เช่น OT ครั้งเดียว)
 * → หักลดหย่อนรายปี → ภาษีขั้นบันได → หาร 12
 */

import {
  calculateThaiAnnualPIT,
  calculateAnnualPITFromProgressiveBands,
  calculateAnnualPITCappedAtMarginalRate,
  type PitProgressiveBand,
  DEFAULT_PIT_PROGRESSIVE_BANDS,
  DEFAULT_SOCIAL_SECURITY_EMPLOYEE_RATE_PERCENT,
  DEFAULT_SOCIAL_SECURITY_MONTHLY_CEILING_BAHT,
} from '@/lib/hr/pit-thailand';

/** ลดหย่อนรายปีขั้นต่ำ: ส่วนตัว 60,000 (ขยายด้วยบุตร/กยศ. ฯลฯ ในรอบถัดไป) */
export const DEFAULT_ANNUAL_PERSONAL_ALLOWANCE = 60_000;

export interface MonthlyPitInput {
  /** ฐานรายได้รายเดือนที่ใช้ประมาณการ — นำไป × 12 (ไม่รวม OT ไม่ประจำ) */
  monthlyTaxableGross: number;
  /** รายได้ไม่ประจำในเดือนนี้ (เช่น OT) — บวกเข้ารายได้รายปีครั้งเดียว ไม่ × 12 */
  annualIrregularAddOnBaht?: number;
  /** รวมลดหย่อนรายปี (ไม่มีเหมาจ่ายตามที่ตกลง) */
  annualDeductions?: number;
  /** ถ้ามี — ใช้แทนตารางค่าเริ่มต้น (จากหน้าตั้งค่า HR / payroll_policies) */
  pitProgressiveBands?: PitProgressiveBand[] | null;
}

/** รายได้ประมาณการทั้งปีจากฐานรายเดือนคงที่ */
export function projectedAnnualGrossFromMonthly(monthlyGross: number): number {
  return Math.max(0, monthlyGross) * 12;
}

/** ภาษีที่หักได้ต่อเดือน (บาท) */
export function monthlyEmployeePITWithholding(input: MonthlyPitInput): number {
  const regularMonthly = Math.max(0, input.monthlyTaxableGross);
  const irregularAddOn = Math.max(0, Number(input.annualIrregularAddOnBaht) || 0);
  const annualGross = projectedAnnualGrossFromMonthly(regularMonthly) + irregularAddOn;
  const deductions = input.annualDeductions ?? DEFAULT_ANNUAL_PERSONAL_ALLOWANCE;
  const net = Math.max(0, annualGross - deductions);
  const bands = input.pitProgressiveBands;
  const annualTax =
    bands && bands.length
      ? calculateAnnualPITFromProgressiveBands(net, bands)
      : calculateThaiAnnualPIT(net);
  return Math.round((annualTax / 12) * 100) / 100;
}

export type MonthlyPitWithMarginalCeilingInput = MonthlyPitInput & {
  /** จำกัดไม่ให้คิดภาษีในช่วงที่ marginal สูงกว่าค่านี้ — ใช้ 35 เพื่อเทียบเท่าคำนวณเต็มตามตาราง */
  maxMarginalRatePercent: number;
};

/**
 * หัก ภงด. รายเดือนแบบประมาณการ ×12 แล้วหาร 12 — ใช้ตารางขั้นบันไดจาก HR
 * เมื่อเลือกอัตรา marginal สูงสุด (เช่น 35%) ผลเทียบเท่ากับ monthlyEmployeePITWithholding
 */
export function monthlyEmployeePITWithholdingWithMarginalCeiling(
  input: MonthlyPitWithMarginalCeilingInput,
): number {
  const regularMonthly = Math.max(0, input.monthlyTaxableGross);
  const irregularAddOn = Math.max(0, Number(input.annualIrregularAddOnBaht) || 0);
  const annualGross = projectedAnnualGrossFromMonthly(regularMonthly) + irregularAddOn;
  const deductions = input.annualDeductions ?? DEFAULT_ANNUAL_PERSONAL_ALLOWANCE;
  const net = Math.max(0, annualGross - deductions);
  const bands =
    input.pitProgressiveBands && input.pitProgressiveBands.length
      ? input.pitProgressiveBands
      : DEFAULT_PIT_PROGRESSIVE_BANDS;
  const annualTax = calculateAnnualPITCappedAtMarginalRate(net, bands, input.maxMarginalRatePercent);
  return Math.round((annualTax / 12) * 100) / 100;
}

/** ประกันสังคมฝั่งลูกจ้างรายเดือน: อัตรา % ของเงินค่าจ้างที่ไม่เกินเพดาน */
export function monthlyEmployeeSocialSecurity(grossMonthlyForSS: number): number {
  const rate = DEFAULT_SOCIAL_SECURITY_EMPLOYEE_RATE_PERCENT / 100;
  const base = Math.min(Math.max(0, grossMonthlyForSS), DEFAULT_SOCIAL_SECURITY_MONTHLY_CEILING_BAHT);
  return Math.round(base * rate * 100) / 100;
}
