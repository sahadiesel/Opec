import type { OfficeStaff } from '@/lib/types';

/** ฐานคิดหักสาย/ขาดจากเวลาเข้างาน — ใช้กับพนักงานรายเดือนที่เข้างวดออฟฟิศ */
export type OfficePayrollTimeDeductionBasis = 'SCAN' | 'BASE_SALARY';

export const OFFICE_PAYROLL_TIME_DEDUCTION_BASIS_OPTIONS: {
  value: OfficePayrollTimeDeductionBasis;
  label: string;
}[] = [
  { value: 'SCAN', label: 'คำนวนจากการสแกน' },
  { value: 'BASE_SALARY', label: 'คำนวนจากฐานเงินเดือน' },
];

export function officePayrollTimeDeductionBasisLabel(
  basis: OfficePayrollTimeDeductionBasis | undefined,
): string {
  return (
    OFFICE_PAYROLL_TIME_DEDUCTION_BASIS_OPTIONS.find((x) => x.value === (basis ?? 'SCAN'))?.label ??
    OFFICE_PAYROLL_TIME_DEDUCTION_BASIS_OPTIONS[0].label
  );
}

export function resolveOfficePayrollTimeDeductionBasis(
  staff: Pick<OfficeStaff, 'officePayrollTimeDeductionBasis'>,
): OfficePayrollTimeDeductionBasis {
  return staff.officePayrollTimeDeductionBasis === 'BASE_SALARY' ? 'BASE_SALARY' : 'SCAN';
}

/**
 * ใช้เมื่อคำนวณหักสาย/ขาดจากการสแกนในงวดเงินเดือน
 * — false = ไม่นำเวลาสแกนมาคิดสาย/ขาด (ยังหักจากวันลา/ขาดที่บันทึกในระบบตามปกติ)
 */
export function officeStaffAppliesScanTimeDeductions(
  staff: Pick<
    OfficeStaff,
    'salaryType' | 'monthlyAttendanceExempt' | 'officePayrollTimeDeductionBasis' | 'excludeFromPayrollRuns'
  >,
): boolean {
  if (staff.excludeFromPayrollRuns) return false;
  if (staff.salaryType !== 'MONTHLY') return false;
  if (staff.monthlyAttendanceExempt) return false;
  if (resolveOfficePayrollTimeDeductionBasis(staff) === 'BASE_SALARY') return false;
  return true;
}

/** แสดงช่องฐานคิดสาย/ขาด — เฉพาะรายเดือนที่ยังอ้างอิงเวลาเข้างาน */
export function officeStaffShowsTimeDeductionBasisField(
  staff: Pick<OfficeStaff, 'salaryType' | 'monthlyAttendanceExempt' | 'excludeFromPayrollRuns'>,
): boolean {
  if (staff.excludeFromPayrollRuns) return false;
  if (staff.salaryType !== 'MONTHLY') return false;
  if (staff.monthlyAttendanceExempt) return false;
  return true;
}
