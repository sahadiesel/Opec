'use client';

import type {
  OfficePayrollLine,
  OfficePayrollRun,
  PayrollBatch,
  PayrollBatchLine,
} from '@/lib/types';
import {
  employerSsoContribAmount,
  isOfficeEmployerContribPaid,
  isOfficeEmployerContribPayable,
  isOfficePayrollWagePaid,
  isOfficeSsoRemitPaid,
  isOfficeSsoRemitPayable,
  isWorkerEmployerContribPaid,
  isWorkerEmployerContribPayable,
  isWorkerPayrollWagePaid,
  isWorkerSsoRemitPaid,
  isWorkerSsoRemitPayable,
  officeWageStatusLabel,
  workerWageStatusLabel,
} from '@/lib/payroll/payroll-sso-payment-model';
import type { PayrollSsoTableRow } from '@/components/accounting/payroll-sso-list-table';

export type WorkerSsoRow = { batch: PayrollBatch; line: PayrollBatchLine; sso: number; paymentYmd: string };
export type OfficeSsoRow = { run: OfficePayrollRun; line: OfficePayrollLine; sso: number; paymentYmd: string };
export type ExecutiveSsoRow = OfficeSsoRow;

export function workerSsoRowKey(batchId: string, lineId: string): string {
  return `worker::${batchId}::${lineId}`;
}

export function officeSsoRowKey(runId: string, lineId: string): string {
  return `office::${runId}::${lineId}`;
}

export function executiveSsoRowKey(runId: string, lineId: string): string {
  return `executive::${runId}::${lineId}`;
}

export function workerLinePaidAmount(line: PayrollBatchLine): number {
  return Number(line.netAmount) || 0;
}

/** ยอดเงินได้ก่อนหัก ภงด. และ ปกส. — ใช้แสดงในหน้าประกันสังคม */
export function workerLineGrossPayAmount(line: PayrollBatchLine): number {
  return Number(line.grossAmount) || 0;
}

export function officeLinePaidAmount(line: OfficePayrollLine): number {
  return Number(line.netPay) || 0;
}

/** ยอดเงินได้ก่อนหัก ภงด. และ ปกส. — ใช้แสดงในหน้าประกันสังคม */
export function officeLineGrossPayAmount(line: OfficePayrollLine): number {
  return Number(line.grossPay) || 0;
}

export function resolveWorkerNationalId(
  line: PayrollBatchLine,
  nationalIdByWorkerId?: ReadonlyMap<string, string>,
): string {
  const fromMap = nationalIdByWorkerId?.get(line.workerId)?.trim();
  if (fromMap) return fromMap;
  return '—';
}

export function resolveStaffNationalId(
  staffId: string,
  nationalIdByStaffId?: ReadonlyMap<string, string>,
): string {
  const fromMap = nationalIdByStaffId?.get(staffId)?.trim();
  if (fromMap) return fromMap;
  return '—';
}

export function workerRowsToSsoTable(
  rows: WorkerSsoRow[],
  nationalIdByWorkerId?: ReadonlyMap<string, string>,
): PayrollSsoTableRow[] {
  return rows.map(({ batch, line, sso, paymentYmd }) => {
    const wagePaid = isWorkerPayrollWagePaid(batch, line);
    return {
      rowKey: workerSsoRowKey(batch.id, line.id),
      batchLabel: batch.id,
      earnerName: line.workerNameSnapshot || '—',
      earnerId: resolveWorkerNationalId(line, nationalIdByWorkerId),
      paymentYmd,
      paid: workerLineGrossPayAmount(line),
      sso,
      employerContrib: employerSsoContribAmount(sso),
      wagePaid,
      wageLabel: workerWageStatusLabel(batch.status),
      ssoRemitPaid: isWorkerSsoRemitPaid(line),
      employerContribPaid: isWorkerEmployerContribPaid(line),
      openHref: `/payroll/batches/${encodeURIComponent(batch.id)}/workers/${encodeURIComponent(line.workerId)}`,
      ssoPayable: isWorkerSsoRemitPayable(batch, line, sso),
      employerPayable: isWorkerEmployerContribPayable(batch, line, sso),
    };
  });
}

export function officeRowsToSsoTable(
  rows: OfficeSsoRow[],
  openHref: (runId: string, staffId: string) => string,
  nationalIdByStaffId?: ReadonlyMap<string, string>,
): PayrollSsoTableRow[] {
  return rows.map(({ run, line, sso, paymentYmd }) => {
    const wagePaid = isOfficePayrollWagePaid(run, line);
    return {
      rowKey: officeSsoRowKey(run.id, line.id),
      batchLabel: run.payrollRunNo || run.id,
      batchSubLabel: run.payrollMonth || '—',
      earnerName: line.staffName || '—',
      earnerId: resolveStaffNationalId(line.staffId, nationalIdByStaffId),
      paymentYmd,
      paid: officeLineGrossPayAmount(line),
      sso,
      employerContrib: employerSsoContribAmount(sso),
      wagePaid,
      wageLabel: officeWageStatusLabel(run.status),
      ssoRemitPaid: isOfficeSsoRemitPaid(line),
      employerContribPaid: isOfficeEmployerContribPaid(line),
      openHref: openHref(run.id, line.staffId),
      ssoPayable: isOfficeSsoRemitPayable(run, line, sso),
      employerPayable: isOfficeEmployerContribPayable(run, line, sso),
    };
  });
}

export function executiveRowsToSsoTableFixed(
  rows: ExecutiveSsoRow[],
  nationalIdByExecutiveStaffId?: ReadonlyMap<string, string>,
): PayrollSsoTableRow[] {
  return rows.map(({ run, line, sso, paymentYmd }) => {
    const wagePaid = isOfficePayrollWagePaid(run, line);
    return {
      rowKey: executiveSsoRowKey(run.id, line.id),
      batchLabel: run.payrollRunNo || run.id,
      batchSubLabel: run.payrollMonth || '—',
      earnerName: line.staffName || '—',
      earnerId: resolveStaffNationalId(line.staffId, nationalIdByExecutiveStaffId),
      paymentYmd,
      paid: officeLineGrossPayAmount(line),
      sso,
      employerContrib: employerSsoContribAmount(sso),
      wagePaid,
      wageLabel: officeWageStatusLabel(run.status),
      ssoRemitPaid: isOfficeSsoRemitPaid(line),
      employerContribPaid: isOfficeEmployerContribPaid(line),
      openHref: `/accounting/executive-payroll/${encodeURIComponent(run.id)}/staff/${encodeURIComponent(line.staffId)}`,
      ssoPayable: isOfficeSsoRemitPayable(run, line, sso),
      employerPayable: isOfficeEmployerContribPayable(run, line, sso),
    };
  });
}

export function countSelectedPayable(tableRows: PayrollSsoTableRow[], selectedKeys: Set<string>): number {
  return tableRows.filter((r) => selectedKeys.has(r.rowKey) && (r.ssoPayable || r.employerPayable)).length;
}

export function payAmountForRow(row: PayrollSsoTableRow): number {
  let sum = 0;
  if (row.ssoPayable) sum += row.sso;
  if (row.employerPayable) sum += row.employerContrib;
  return sum;
}

/** อัปเดต state ใน UI หลังจ่าย ปกส.+สมทub รวมยอดเดียว */
export function applyLocalCombinedSsoPaymentPatch<T extends PayrollBatchLine | OfficePayrollLine>(
  line: T,
  result: { cashbookEntryId: string; entryNo: string },
  bankId: string,
  now = Date.now(),
): T {
  const patch: Partial<T> = {};
  if (!line.ssoRemitCashbookEntryId && !line.ssoRemitPaidAt) {
    Object.assign(patch, {
      ssoRemitCashbookEntryId: result.cashbookEntryId,
      ssoRemitCashbookEntryNo: result.entryNo,
      ssoRemitPaidAt: now,
      ssoRemitPaymentBankAccountId: bankId,
    });
  }
  if (!line.ssoEmployerContribCashbookEntryId && !line.ssoEmployerContribPaidAt) {
    Object.assign(patch, {
      ssoEmployerContribCashbookEntryId: result.cashbookEntryId,
      ssoEmployerContribCashbookEntryNo: result.entryNo,
      ssoEmployerContribPaidAt: now,
      ssoEmployerContribPaymentBankAccountId: bankId,
    });
  }
  return { ...line, ...patch };
}

export function selectableKeySig(tableRows: PayrollSsoTableRow[]): string {
  return tableRows
    .filter((r) => r.ssoPayable || r.employerPayable)
    .map((r) => r.rowKey)
    .sort()
    .join('|');
}
