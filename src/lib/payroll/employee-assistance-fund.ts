/**
 * กองทุนสงเคราะห์ลูกจ้าง (Employee Assistance Fund) — พ.ร.บ.คุ้มครองแรงงาน
 * กฎหมายใหม่กำหนดอัตรา 0.25% ของค่าจ้าง (สูงสุดไม่เกิน ~43.75 บาท/เดือน จากฐาน 17,500)
 * แต่ช่วงแรกยังไม่บังคับ — ค่าเริ่มต้นของระบบตั้งอัตราไว้ที่ 0%
 */

import type { PayrollPolicyRecord } from '@/lib/types';

export const DEFAULT_EMPLOYEE_ASSISTANCE_FUND_RATE_PERCENT = 0;
export const DEFAULT_EMPLOYEE_ASSISTANCE_FUND_MONTHLY_CEILING_BAHT = 17_500;

function round2(n: number): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

/**
 * base = min(wage, ceiling), amount = round2(base * rate/100)
 * เพดานตามธรรมชาติ = ceiling × rate เช่น 17,500 × 0.25% = 43.75 บาท/เดือน
 */
export function employeeAssistanceFundFromWage(
  wage: number,
  ratePercent: number,
  ceilingBaht: number,
): number {
  const rate = Number(ratePercent);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  const ceiling =
    Number.isFinite(Number(ceilingBaht)) && Number(ceilingBaht) > 0
      ? Number(ceilingBaht)
      : DEFAULT_EMPLOYEE_ASSISTANCE_FUND_MONTHLY_CEILING_BAHT;
  const base = Math.min(Math.max(0, Number(wage) || 0), ceiling);
  return round2(base * (rate / 100));
}

/** อ่าน rate/ceiling จาก config เดียวกับนโยบาย SSO (payroll_policies/policy_sso_th_employee) */
export function employeeAssistanceFundFromSsoPolicy(
  wage: number,
  ssoPolicy: PayrollPolicyRecord | null,
): number {
  if (!ssoPolicy) return 0;
  const rate = Number(
    ssoPolicy.config?.employeeAssistanceFundRatePercent ?? DEFAULT_EMPLOYEE_ASSISTANCE_FUND_RATE_PERCENT,
  );
  const ceiling = Number(
    ssoPolicy.config?.employeeAssistanceFundMonthlyCeilingBaht ??
      DEFAULT_EMPLOYEE_ASSISTANCE_FUND_MONTHLY_CEILING_BAHT,
  );
  return employeeAssistanceFundFromWage(wage, rate, ceiling);
}
