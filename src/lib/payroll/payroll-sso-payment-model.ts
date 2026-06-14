import type {
  OfficePayrollLine,
  OfficePayrollRun,
  PayrollBatch,
  PayrollBatchLine,
  PayrollBatchStatus,
  PayrollRunStatus,
} from '@/lib/types';
import {
  isOfficePayrollWagePaid,
  isWorkerPayrollWagePaid,
  officeWageStatusLabel,
  workerWageStatusLabel,
  whtTaxStatusLabel,
} from '@/lib/payroll/payroll-wht-tax-payment-model';

export function isWorkerSsoRemitPaid(line: PayrollBatchLine): boolean {
  return !!(line.ssoRemitCashbookEntryId || line.ssoRemitPaidAt);
}

export function isWorkerEmployerContribPaid(line: PayrollBatchLine): boolean {
  return !!(line.ssoEmployerContribCashbookEntryId || line.ssoEmployerContribPaidAt);
}

export function isOfficeSsoRemitPaid(line: OfficePayrollLine): boolean {
  return !!(line.ssoRemitCashbookEntryId || line.ssoRemitPaidAt);
}

export function isOfficeEmployerContribPaid(line: OfficePayrollLine): boolean {
  return !!(line.ssoEmployerContribCashbookEntryId || line.ssoEmployerContribPaidAt);
}

/** เงินสมทบฝั่งนายจ้าง — ปกติเท่ากับยอดหักประกันสังคมฝั่งลูกจ้าง */
export function employerSsoContribAmount(employeeSsoAmount: number): number {
  return Math.round((Number(employeeSsoAmount) || 0) * 100) / 100;
}

/** ยอดนำส่งรวม ปกส.+สมทบ (ลูกจ้าง + นายจ้าง) — แสดงในตารางและสรุปยอด */
export function ssoCombinedRemitAmount(employeeSsoAmount: number): number {
  return Math.round((Number(employeeSsoAmount) || 0) * 2 * 100) / 100;
}

export function ssoRemitStatusLabel(wagePaid: boolean, remitPaid: boolean): string {
  return whtTaxStatusLabel(wagePaid, remitPaid);
}

export function employerContribStatusLabel(wagePaid: boolean, contribPaid: boolean): string {
  return whtTaxStatusLabel(wagePaid, contribPaid);
}

export function isWorkerSsoRemitPayable(
  batch: PayrollBatch,
  line: PayrollBatchLine,
  ssoAmount: number,
): boolean {
  if (ssoAmount <= 0.005) return false;
  return isWorkerPayrollWagePaid(batch, line) && !isWorkerSsoRemitPaid(line);
}

export function isWorkerEmployerContribPayable(
  batch: PayrollBatch,
  line: PayrollBatchLine,
  ssoAmount: number,
): boolean {
  if (ssoAmount <= 0.005) return false;
  return isWorkerPayrollWagePaid(batch, line) && !isWorkerEmployerContribPaid(line);
}

export function isOfficeSsoRemitPayable(
  run: OfficePayrollRun,
  line: OfficePayrollLine,
  ssoAmount: number,
): boolean {
  if (ssoAmount <= 0.005) return false;
  return isOfficePayrollWagePaid(run, line) && !isOfficeSsoRemitPaid(line);
}

export function isOfficeEmployerContribPayable(
  run: OfficePayrollRun,
  line: OfficePayrollLine,
  ssoAmount: number,
): boolean {
  if (ssoAmount <= 0.005) return false;
  return isOfficePayrollWagePaid(run, line) && !isOfficeEmployerContribPaid(line);
}

export { isWorkerPayrollWagePaid, isOfficePayrollWagePaid, workerWageStatusLabel, officeWageStatusLabel };
export type { PayrollBatchStatus, PayrollRunStatus };
