import {
  DEFAULT_SOCIAL_SECURITY_EMPLOYEE_RATE_PERCENT,
  DEFAULT_SOCIAL_SECURITY_MONTHLY_CEILING_BAHT,
} from '@/lib/hr/pit-thailand';
import { DEFAULT_ANNUAL_PERSONAL_ALLOWANCE } from '@/lib/payroll/employee-payroll-deductions';
import type { PayrollPolicyRecord } from '@/lib/types';

/** ค่าเริ่มต้นเมื่อยังไม่มีเอกสารใน `payroll_policies` */
export function embeddedDefaultPayrollPolicies(): PayrollPolicyRecord[] {
  const t = Date.now();
  return [
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
      name: 'Worker timesheet payroll — no PIT withhold (embedded)',
      effectiveFrom: '2000-01-01',
      effectiveTo: null,
      status: 'active',
      appliesTo: 'worker',
      config: { mode: 'none' },
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
