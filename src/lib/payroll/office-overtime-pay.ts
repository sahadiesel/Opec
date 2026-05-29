import type { MonthlyWorkNormPolicyConfig } from '@/lib/hr/monthly-work-norm-policy';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type OfficeOvertimePayBreakdown = {
  monthlySalary: number;
  dailyRate: number;
  hourlyRate: number;
  multiplier: number;
  approvedHours: number;
  amount: number;
};

/** ค่า OT พนักงานออฟฟิศ = (เงินเดือน ÷ วันทำงาน/เดือน ÷ ชม./วัน) × ตัวคูณ × ชม.ที่อนุมัติ */
export function computeOfficeOvertimePayAmount(
  monthlySalary: number,
  norm: MonthlyWorkNormPolicyConfig,
  approvedHours: number,
): OfficeOvertimePayBreakdown {
  const salary = Math.max(0, Number(monthlySalary) || 0);
  const hours = Math.max(0, Number(approvedHours) || 0);
  const days = Math.max(1, Math.round(Number(norm.standardWorkingDaysPerMonth) || 26));
  const hoursPerDay = Math.max(0.25, Number(norm.normalWorkingHoursPerDay) || 8);
  const multiplier = Math.max(0.5, Number(norm.officeOvertimeHourMultiplier) || 1.5);
  const dailyRate = round2(salary / days);
  const hourlyRate = round2(dailyRate / hoursPerDay);
  const amount = round2(hourlyRate * multiplier * hours);
  return { monthlySalary: salary, dailyRate, hourlyRate, multiplier, approvedHours: hours, amount };
}

/** รวมยอด OT ที่อนุมัติแล้วในช่วงงวดจ่าย */
export function sumApprovedOfficeOvertimePayInPeriod(
  staffId: string,
  periodStart: string,
  periodEnd: string,
  requests: Array<{
    subjectId: string;
    workDateYmd: string;
    status: string;
    otPayAmountSnapshot?: number | null;
  }>,
): number {
  const ps = periodStart.slice(0, 10);
  const pe = periodEnd.slice(0, 10);
  let total = 0;
  for (const r of requests) {
    if (r.subjectId !== staffId || r.status !== 'APPROVED') continue;
    const ymd = r.workDateYmd.slice(0, 10);
    if (ymd < ps || ymd > pe) continue;
    total += Math.max(0, Number(r.otPayAmountSnapshot) || 0);
  }
  return round2(total);
}
