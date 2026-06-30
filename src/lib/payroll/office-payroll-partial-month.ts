import type { OfficeStaff } from '@/lib/types';
import { normalizeStaffDateYmd } from '@/lib/payroll/office-staff-date-ymd';

function enumerateYmdsInclusive(startYmd: string, endYmd: string): string[] {
  const a = Date.parse(`${startYmd.slice(0, 10)}T00:00:00+07:00`);
  const b = Date.parse(`${endYmd.slice(0, 10)}T00:00:00+07:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return [];
  const out: string[] = [];
  for (let t = a; t <= b; t += 86_400_000) {
    out.push(new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }));
  }
  return out;
}

/**
 * นับวันปฏิทินในงวดก่อนวันเริ่มจ้าง / หลังวันสิ้นสุดการจ้าง
 * — ใช้กับเงินเดือน ÷ standardWorkingDaysPerMonth (เช่น 30 วัน) ไม่ข้ามวันหยุดสัปดาห์/นักขัตฤกษ์
 */
export function countPartialMonthUnpaidWorkDays(
  periodStart: string,
  periodEnd: string,
  staff: Pick<OfficeStaff, 'startDate' | 'employmentEndDate'>,
): { preEmploymentDays: number; postEmploymentDays: number } {
  const startYmd = normalizeStaffDateYmd(staff.startDate);
  const endYmd = normalizeStaffDateYmd(staff.employmentEndDate);
  let preEmploymentDays = 0;
  let postEmploymentDays = 0;

  for (const ymd of enumerateYmdsInclusive(periodStart, periodEnd)) {
    if (startYmd && ymd < startYmd) preEmploymentDays += 1;
    else if (endYmd && ymd > endYmd) postEmploymentDays += 1;
  }

  return { preEmploymentDays, postEmploymentDays };
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** หักวันก่อน/หลังจ้างออกจากฐานเงินเดือน — ไม่ส่งซ้ำใน preStatutory ของ D8 */
export function resolveOfficePayrollEffectiveBaseSalary(
  contractMonthlySalary: number,
  preStatutoryDeductions: ReadonlyArray<{ code: string; amount: number }>,
): {
  effectiveBaseSalary: number;
  payrollPreStatutoryDeductions: Array<{ code: string; amount: number }>;
} {
  let preEmp = 0;
  let postEmp = 0;
  const payrollPreStatutoryDeductions: Array<{ code: string; amount: number }> = [];

  for (const row of preStatutoryDeductions) {
    const amt = Math.max(0, Number(row.amount) || 0);
    if (amt <= 0) continue;
    if (row.code === 'pre_employment_deduction') {
      preEmp += amt;
      continue;
    }
    if (row.code === 'post_employment_deduction') {
      postEmp += amt;
      continue;
    }
    payrollPreStatutoryDeductions.push({ code: row.code, amount: amt });
  }

  const partialMonthTotal = round2(preEmp + postEmp);
  const effectiveBaseSalary = round2(Math.max(0, contractMonthlySalary - partialMonthTotal));
  return { effectiveBaseSalary, payrollPreStatutoryDeductions };
}
