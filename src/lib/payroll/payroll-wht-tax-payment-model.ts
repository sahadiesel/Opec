import type {
  OfficePayrollLine,
  OfficePayrollRun,
  PayrollBatch,
  PayrollBatchLine,
  PayrollBatchStatus,
  PayrollRunStatus,
} from '@/lib/types';

export function isWorkerPayrollWagePaid(batch: PayrollBatch, line: PayrollBatchLine): boolean {
  if (batch.status === 'PAID' || batch.status === 'LOCKED') return true;
  if (line.financePayoutCashbookEntryId || line.financePaidAt) return true;
  return false;
}

export function isWorkerPayrollWhtTaxPaid(line: PayrollBatchLine): boolean {
  return !!(line.whtTaxCashbookEntryId || line.whtTaxPaidAt);
}

export function isOfficePayrollWagePaid(run: OfficePayrollRun, _line?: OfficePayrollLine): boolean {
  if (run.status === 'PAID' || run.status === 'LOCKED') return true;
  if (run.financeCashbookEntryId) return true;
  return false;
}

export function isOfficePayrollWhtTaxPaid(line: OfficePayrollLine): boolean {
  return !!(line.whtTaxCashbookEntryId || line.whtTaxPaidAt);
}

export function workerWageStatusLabel(status: PayrollBatchStatus): string {
  if (status === 'PAID' || status === 'LOCKED') return 'จ่ายแล้ว';
  if (status === 'FINANCE_PREPARED' || status === 'PAYMENT_EXPORTED') return 'รอจ่าย';
  return 'ระหว่างทาง';
}

export function officeWageStatusLabel(status: PayrollRunStatus): string {
  if (status === 'PAID' || status === 'LOCKED') return 'จ่ายแล้ว';
  if (status === 'FINANCE_APPROVED' || status === 'HR_APPROVED') return 'รอจ่าย';
  if (status === 'CANCELLED') return 'ยกเลิก';
  return 'ระหว่างทาง';
}

export function whtTaxStatusLabel(wagePaid: boolean, taxPaid: boolean): string {
  if (!wagePaid) return '—';
  if (taxPaid) return 'จ่ายแล้ว';
  return 'รอจ่าย';
}
