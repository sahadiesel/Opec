import {
  DEFAULT_MONTHLY_WORK_NORM,
  type MonthlyWorkNormPolicyConfig,
} from '@/lib/hr/monthly-work-norm-policy';

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

type ApprovedOvertimeRequestForPay = {
  subjectId: string;
  workDateYmd: string;
  status: string;
  requestedOtHours?: number | null;
  approvedOtHours?: number | null;
  monthlySalarySnapshot?: number | null;
  otPayAmountSnapshot?: number | null;
};

function resolveMonthlyWorkNormDays(norm: MonthlyWorkNormPolicyConfig): number {
  const days = Math.round(Number(norm.standardWorkingDaysPerMonth));
  if (Number.isFinite(days) && days >= 1 && days <= 31) return days;
  return DEFAULT_MONTHLY_WORK_NORM.standardWorkingDaysPerMonth;
}

function resolveMonthlyWorkNormHoursPerDay(norm: MonthlyWorkNormPolicyConfig): number {
  const hours = Number(norm.normalWorkingHoursPerDay);
  if (Number.isFinite(hours) && hours > 0 && hours <= 24) return hours;
  return DEFAULT_MONTHLY_WORK_NORM.normalWorkingHoursPerDay;
}

function resolveOfficeOvertimeMultiplier(norm: MonthlyWorkNormPolicyConfig): number {
  const multiplier = Number(norm.officeOvertimeHourMultiplier);
  if (Number.isFinite(multiplier) && multiplier > 0) return Math.min(10, multiplier);
  return DEFAULT_MONTHLY_WORK_NORM.officeOvertimeHourMultiplier ?? 1.5;
}

/** ค่า OT พนักงานออฟฟิศ = (เงินเดือน ÷ วันทำงาน/เดือน ÷ ชม./วัน) × ตัวคูณ × ชม.ที่อนุมัติ — ตาม HR Settings */
export function computeOfficeOvertimePayAmount(
  monthlySalary: number,
  norm: MonthlyWorkNormPolicyConfig,
  approvedHours: number,
): OfficeOvertimePayBreakdown {
  const salary = Math.max(0, Number(monthlySalary) || 0);
  const hours = Math.max(0, Number(approvedHours) || 0);
  const days = resolveMonthlyWorkNormDays(norm);
  const hoursPerDay = resolveMonthlyWorkNormHoursPerDay(norm);
  const multiplier = resolveOfficeOvertimeMultiplier(norm);
  const dailyRate = round2(salary / days);
  const hourlyRate = round2(dailyRate / hoursPerDay);
  const amount = round2(hourlyRate * multiplier * hours);
  return { monthlySalary: salary, dailyRate, hourlyRate, multiplier, approvedHours: hours, amount };
}

/** รวมยอด OT ที่อนุมัติแล้วในช่วงงวดจ่าย — คำนวณใหม่จากชม.ที่อนุมัติ + นโยบาย HR ปัจจุบัน (ไม่ใช้ snapshot เก่า) */
export function sumApprovedOfficeOvertimePayInPeriod(
  staffId: string,
  periodStart: string,
  periodEnd: string,
  requests: ApprovedOvertimeRequestForPay[],
  computeOpts: {
    monthlySalary: number;
    monthlyWorkNorm: MonthlyWorkNormPolicyConfig;
  },
): number {
  const ps = periodStart.slice(0, 10);
  const pe = periodEnd.slice(0, 10);
  let total = 0;
  for (const r of requests) {
    if (r.subjectId !== staffId || r.status !== 'APPROVED') continue;
    const ymd = r.workDateYmd.slice(0, 10);
    if (ymd < ps || ymd > pe) continue;

    const approvedHours = Number(r.approvedOtHours ?? r.requestedOtHours);
    if (!Number.isFinite(approvedHours) || approvedHours <= 0) continue;

    const payrollSalary = Math.max(0, Number(computeOpts.monthlySalary) || 0);
    const salarySnapshot = Number(r.monthlySalarySnapshot);
    const salary =
      payrollSalary > 0
        ? payrollSalary
        : Number.isFinite(salarySnapshot) && salarySnapshot > 0
          ? salarySnapshot
          : 0;

    const breakdown = computeOfficeOvertimePayAmount(
      salary,
      computeOpts.monthlyWorkNorm,
      approvedHours,
    );
    total += breakdown.amount;
  }
  return round2(total);
}
