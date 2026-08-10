import {
  DEFAULT_SOCIAL_SECURITY_EMPLOYEE_RATE_PERCENT,
  DEFAULT_SOCIAL_SECURITY_MONTHLY_CEILING_BAHT,
} from '@/lib/hr/pit-thailand';
import {
  DEFAULT_EMPLOYEE_ASSISTANCE_FUND_MONTHLY_CEILING_BAHT,
  DEFAULT_EMPLOYEE_ASSISTANCE_FUND_RATE_PERCENT,
} from '@/lib/payroll/employee-assistance-fund';
import { DEFAULT_MONTHLY_WORK_NORM } from '@/lib/hr/monthly-work-norm-policy';
import { DEFAULT_ANNUAL_PERSONAL_ALLOWANCE } from '@/lib/payroll/employee-payroll-deductions';
import { HR_STATUTORY_POLICY_MONTHLY_WORK_ID, HR_WORKER_GLOBAL_LABOR_POLICY_ID } from '@/lib/payroll/d8/hr-statutory-policy-ids';
import { DEFAULT_WORKER_GLOBAL_LABOR_CONTEXT } from '@/lib/payroll/worker-global-labor-policy';
import type { PayrollPolicyRecord } from '@/lib/types';

/** ค่าเริ่มต้นเมื่อยังไม่มีเอกสารใน `payroll_policies` */
export function embeddedDefaultPayrollPolicies(): PayrollPolicyRecord[] {
  const t = Date.now();
  return [
    {
      id: HR_WORKER_GLOBAL_LABOR_POLICY_ID,
      kind: 'worker_global_labor' as const,
      name: 'Worker payroll — global OT/holiday multipliers & calendar (HR settings, embedded default)',
      effectiveFrom: '2000-01-01',
      effectiveTo: null,
      status: 'active' as const,
      appliesTo: 'worker' as const,
      config: {
        costMultipliers: { ...DEFAULT_WORKER_GLOBAL_LABOR_CONTEXT.cost },
        weeklyRestPattern: DEFAULT_WORKER_GLOBAL_LABOR_CONTEXT.weeklyRestPattern,
        calendarHolidays: DEFAULT_WORKER_GLOBAL_LABOR_CONTEXT.calendarHolidays,
      },
      createdAt: t,
      updatedAt: t,
    },
    {
      id: HR_STATUTORY_POLICY_MONTHLY_WORK_ID,
      kind: 'monthly_work_norm',
      name: 'Monthly working-day norm TH (embedded default)',
      effectiveFrom: '2000-01-01',
      effectiveTo: null,
      status: 'active',
      appliesTo: 'all',
      config: { ...DEFAULT_MONTHLY_WORK_NORM },
      createdAt: t,
      updatedAt: t,
    },
    {
      id: 'embedded-sso-th-v1',
      kind: 'sso',
      name: 'Thailand SSO employee (embedded default)',
      effectiveFrom: '2000-01-01',
      effectiveTo: null,
      status: 'active',
      appliesTo: 'all',
      config: {
        employeeRatePercent: DEFAULT_SOCIAL_SECURITY_EMPLOYEE_RATE_PERCENT,
        monthlyCeilingBaht: DEFAULT_SOCIAL_SECURITY_MONTHLY_CEILING_BAHT,
        employeeAssistanceFundRatePercent: DEFAULT_EMPLOYEE_ASSISTANCE_FUND_RATE_PERCENT,
        employeeAssistanceFundMonthlyCeilingBaht: DEFAULT_EMPLOYEE_ASSISTANCE_FUND_MONTHLY_CEILING_BAHT,
      },
      createdAt: t,
      updatedAt: t,
    },
    {
      id: 'embedded-tax-office-th-v1',
      kind: 'tax',
      name: 'Office monthly PIT estimate TH (embedded)',
      effectiveFrom: '2000-01-01',
      effectiveTo: null,
      status: 'active',
      appliesTo: 'office',
      config: {
        mode: 'th_pit_monthly_annualized',
        annualPersonalAllowance: DEFAULT_ANNUAL_PERSONAL_ALLOWANCE,
      },
      createdAt: t,
      updatedAt: t,
    },
    {
      id: 'embedded-tax-worker-th-v1',
      kind: 'tax',
      name: 'Worker payroll — PIT estimate TH (embedded default)',
      effectiveFrom: '2000-01-01',
      effectiveTo: null,
      status: 'active',
      appliesTo: 'worker',
      config: {
        mode: 'th_pit_monthly_annualized',
        annualPersonalAllowance: DEFAULT_ANNUAL_PERSONAL_ALLOWANCE,
      },
      createdAt: t,
      updatedAt: t,
    },
    {
      id: 'embedded-allowance-v1',
      kind: 'allowance_deduction',
      name: 'Default allowance/deduction (embedded)',
      effectiveFrom: '2000-01-01',
      effectiveTo: null,
      status: 'active',
      appliesTo: 'all',
      config: { fixedDeductions: [] as Array<{ code: string; amount: number }> },
      createdAt: t,
      updatedAt: t,
    },
  ];
}
