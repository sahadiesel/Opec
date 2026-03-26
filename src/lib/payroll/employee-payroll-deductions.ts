/**
 * หักภาษีเงินได้บุคคลรายเดือน (พนักงาน/ลูกจ้างที่ไม่ใช้เหมาจ่าย 40(1))
 * ตามที่ตกลง: ประมาณรายได้จากฐานเงินได้รายเดือน × 12 ถึงสิ้นปี → หักลดหย่อนรายปี → ภาษีขั้นบันได → หาร 12
 */

import {
  calculateThaiAnnualPIT,
  DEFAULT_SOCIAL_SECURITY_EMPLOYEE_RATE_PERCENT,
  DEFAULT_SOCIAL_SECURITY_MONTHLY_CEILING_BAHT,
} from '@/lib/hr/pit-thailand';

/** ลดหย่อนรายปีขั้นต่ำ: ส่วนตัว 60,000 (ขยายด้วยบุตร/กยศ. ฯลฯ ในรอบถัดไป) */
export const DEFAULT_ANNUAL_PERSONAL_ALLOWANCE = 60_000;

export interface MonthlyPitInput {
  /** ฐานรายได้รายเดือนที่ใช้ประมาณการ (เงินเดือน + เบี้ยเลี้ยงในเดือนนั้น ฯลฯ) */
  monthlyTaxableGross: number;
  /** รวมลดหย่อนรายปี (ไม่มีเหมาจ่ายตามที่ตกลง) */
  annualDeductions?: number;
}

/** รายได้ประมาณการทั้งปีจากฐานรายเดือนคงที่ */
export function projectedAnnualGrossFromMonthly(monthlyGross: number): number {
  return Math.max(0, monthlyGross) * 12;
}

/** ภาษีที่หักได้ต่อเดือน (บาท) */
export function monthlyEmployeePITWithholding(input: MonthlyPitInput): number {
  const annualGross = projectedAnnualGrossFromMonthly(input.monthlyTaxableGross);
  const deductions = input.annualDeductions ?? DEFAULT_ANNUAL_PERSONAL_ALLOWANCE;
  const net = Math.max(0, annualGross - deductions);
  const annualTax = calculateThaiAnnualPIT(net);
  return Math.round((annualTax / 12) * 100) / 100;
}

/** ประกันสังคมฝั่งลูกจ้างรายเดือน: อัตรา % ของเงินค่าจ้างที่ไม่เกินเพดาน */
export function monthlyEmployeeSocialSecurity(grossMonthlyForSS: number): number {
  const rate = DEFAULT_SOCIAL_SECURITY_EMPLOYEE_RATE_PERCENT / 100;
  const base = Math.min(Math.max(0, grossMonthlyForSS), DEFAULT_SOCIAL_SECURITY_MONTHLY_CEILING_BAHT);
  return Math.round(base * rate * 100) / 100;
}
