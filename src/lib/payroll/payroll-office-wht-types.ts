import type { PayrollWorkerWhtPrintVm, PayrollWorkerWhtValidationResult } from '@/lib/payroll/payroll-worker-wht-types';

/** สรุปแถวก่อนพิมพ์ batch — โครงเดียวกับลูกจ้าง */
export type OfficePayrollWhtLinePrep = {
  lineId: string;
  staffId: string;
  staffNameSnapshot: string;
  vm: PayrollWorkerWhtPrintVm | null;
  validation: PayrollWorkerWhtValidationResult;
};
