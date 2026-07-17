import type { ExecutivePayrollStaff, OfficeStaff } from '@/lib/types';
import type { PayrollWorkerWhtPrintVm } from '@/lib/payroll/payroll-worker-wht-types';
import {
  buildPayrollOfficeWhtPrintVm,
  officePayrollLineTaxAmount,
  resolveOfficePayrollWhtPaymentDateYmd,
} from '@/lib/payroll/payroll-office-wht-model';

export { officePayrollLineTaxAmount as executivePayrollLineTaxAmount };
export { resolveOfficePayrollWhtPaymentDateYmd as resolveExecutivePayrollWhtPaymentDateYmd };

export function buildPayrollExecutiveWhtDocumentNo(runId: string, staffCode: string, issueYear: number): string {
  const safeRun = (runId || 'RUN').replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-');
  const safeCode = (staffCode || 'STF').replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-');
  return `WHT-EPR-${issueYear}-${safeRun}-${safeCode}`;
}

/**
 * รวมข้อมูลทะเบียนผู้บริหารกับ office_staff ที่ผูกไว้ (เลขบัตร/ที่อยู่/บัญชี) ให้โครงสร้างเดียวกับ OfficeStaff สำหรับใบหักฯ
 */
export function mergeExecutivePayrollStaffForWhtCertificate(
  exec: ExecutivePayrollStaff,
  linkedOffice: OfficeStaff | null,
): OfficeStaff {
  const nid = (exec.nationalId || linkedOffice?.nationalId || '').trim();
  const tid = (exec.taxId || linkedOffice?.taxId || '').trim();
  const addr = (exec.address || linkedOffice?.address || '').trim();
  const bankName = (exec.bankName || linkedOffice?.bankName || '').trim();
  const bankAcct = (exec.bankAccountNumber || linkedOffice?.bankAccountNumber || '').trim();
  const bankAcctName = (linkedOffice?.bankAccountName || '').trim();

  return {
    id: exec.id,
    staffCode: exec.staffCode,
    fullName: exec.fullName,
    nickname: linkedOffice?.nickname,
    phone: linkedOffice?.phone,
    department: exec.department,
    positionId: linkedOffice?.positionId,
    positionTitle: exec.positionTitle,
    payrollBand: 'EXECUTIVE',
    employmentType: exec.employmentType ?? 'FULL_TIME',
    salaryType: exec.salaryType ?? 'MONTHLY',
    monthlySalary: exec.monthlySalary ?? 0,
    dailyWage: linkedOffice?.dailyWage,
    monthlyAttendanceExempt: linkedOffice?.monthlyAttendanceExempt,
    excludeFromPayrollRuns: !!exec.excludeFromPayrollRuns,
    startDate: linkedOffice?.startDate || '2000-01-01',
    employmentEndDate: linkedOffice?.employmentEndDate,
    nationalId: nid || undefined,
    address: addr || undefined,
    emergencyContactName: linkedOffice?.emergencyContactName,
    emergencyContactRelation: linkedOffice?.emergencyContactRelation,
    emergencyContactPhone: linkedOffice?.emergencyContactPhone,
    bankName: bankName || undefined,
    bankAccountName: bankAcctName || undefined,
    bankAccountNumber: bankAcct || undefined,
    taxId: tid || undefined,
    socialSecurityNo: linkedOffice?.socialSecurityNo,
    socialSecurityStatus: linkedOffice?.socialSecurityStatus,
    socialSecurityHospital: linkedOffice?.socialSecurityHospital,
    status: exec.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
    notes: exec.notes,
    linkedUserId: linkedOffice?.linkedUserId,
    supervisorId: linkedOffice?.supervisorId,
    linkedUserDisplayName: linkedOffice?.linkedUserDisplayName,
    linkedUserDisplayEmail: linkedOffice?.linkedUserDisplayEmail,
    linkedUserAccessSummary: linkedOffice?.linkedUserAccessSummary,
    createdAt: exec.createdAt,
    createdBy: exec.createdBy,
    updatedAt: exec.updatedAt,
    updatedBy: exec.updatedBy,
  };
}

const EXEC_PAYSLIP_LABEL = 'ผู้บริหาร / Executive Payroll (รายเดือน)';

export function buildPayrollExecutiveWhtPrintVm(
  input: Parameters<typeof buildPayrollOfficeWhtPrintVm>[0],
): PayrollWorkerWhtPrintVm {
  const issueYear = Number(input.issueDateYmd.slice(0, 4)) || new Date().getFullYear();
  const pitMode = input.line.hrLineAdjustments?.pitMode ?? 'SYSTEM';
  const manualIncomeLabel = (input.line.hrLineAdjustments?.pitManualIncomeLabel || '').trim();
  const manualPercent = Number(input.line.hrLineAdjustments?.pitManualPercent);
  const usesManualWht = pitMode === 'MANUAL_PERCENT' || pitMode === 'MANUAL_AMOUNT';
  const vm = buildPayrollOfficeWhtPrintVm({
    ...input,
    payslipPayrollTypeLabelOverride: input.payslipPayrollTypeLabelOverride ?? EXEC_PAYSLIP_LABEL,
  });
  return {
    ...vm,
    documentNo: buildPayrollExecutiveWhtDocumentNo(input.run.id, input.staff.staffCode, issueYear),
    subtitleTh: 'สำหรับเงินได้จากการจ้างงาน / เงินเดือนผู้บริหาร',
    incomeTypeNameTh: usesManualWht && manualIncomeLabel ? manualIncomeLabel : 'เงินเดือน / ค่าจ้างผู้บริหาร',
    withholdingTaxRateDisplayTh:
      pitMode === 'MANUAL_PERCENT' && Number.isFinite(manualPercent)
        ? `${manualPercent}%`
        : usesManualWht
          ? 'กำหนดเอง'
          : 'ตามการคำนวณ Payroll (ผู้บริหาร)',
  };
}
