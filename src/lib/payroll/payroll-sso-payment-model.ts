import type {
  OfficePayrollLine,
  OfficePayrollRun,
  PayrollBatch,
  PayrollBatchLine,
  PayrollBatchStatus,
  PayrollRunStatus,
} from '@/lib/types';
import { roundSocialSecurityBahtUp } from '@/lib/payroll/d8/deductions-from-policy';
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
  return roundSocialSecurityBahtUp(Number(employeeSsoAmount) || 0);
}

/** ยอดนำส่งรวม ปกส.+สมทบ (ลูกจ้าง + นายจ้าง) — แสดงในตารางและสรุปยอด */
export function ssoCombinedRemitAmount(employeeSsoAmount: number): number {
  const employee = roundSocialSecurityBahtUp(Number(employeeSsoAmount) || 0);
  return roundSocialSecurityBahtUp(employee * 2);
}

export function isWorkerSsoCombinedFullyPaid(line: PayrollBatchLine): boolean {
  return isWorkerSsoRemitPaid(line) && isWorkerEmployerContribPaid(line);
}

export function isOfficeSsoCombinedFullyPaid(line: OfficePayrollLine): boolean {
  return isOfficeSsoRemitPaid(line) && isOfficeEmployerContribPaid(line);
}

/** ยอดที่ยังต้องตัดจ่าย (รองรับข้อมูลเก่าที่จ่ายแยก 2 รายการไปแล้วบางส่วน) */
export function remainingWorkerSsoPaymentAmount(employeeSsoAmount: number, line: PayrollBatchLine): number {
  let sum = 0;
  const employee = roundSocialSecurityBahtUp(Number(employeeSsoAmount) || 0);
  if (!isWorkerSsoRemitPaid(line)) sum += employee;
  if (!isWorkerEmployerContribPaid(line)) sum += employerSsoContribAmount(employee);
  return roundSocialSecurityBahtUp(sum);
}

export function remainingOfficeSsoPaymentAmount(employeeSsoAmount: number, line: OfficePayrollLine): number {
  let sum = 0;
  const employee = roundSocialSecurityBahtUp(Number(employeeSsoAmount) || 0);
  if (!isOfficeSsoRemitPaid(line)) sum += employee;
  if (!isOfficeEmployerContribPaid(line)) sum += employerSsoContribAmount(employee);
  return roundSocialSecurityBahtUp(sum);
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
