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

export function officeLinePaidAmount(line: OfficePayrollLine): number {
  return Number(line.netPay) || 0;
}

export function workerRowsToSsoTable(rows: WorkerSsoRow[]): PayrollSsoTableRow[] {
  return rows.map(({ batch, line, sso, paymentYmd }) => {
    const wagePaid = isWorkerPayrollWagePaid(batch, line);
    return {
      rowKey: workerSsoRowKey(batch.id, line.id),
      batchLabel: batch.id,
      earnerName: line.workerNameSnapshot || '—',
      earnerId: line.workerId,
      paymentYmd,
      paid: workerLinePaidAmount(line),
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

export function officeRowsToSsoTable(rows: OfficeSsoRow[], openHref: (runId: string, staffId: string) => string): PayrollSsoTableRow[] {
  return rows.map(({ run, line, sso, paymentYmd }) => {
    const wagePaid = isOfficePayrollWagePaid(run, line);
    return {
      rowKey: officeSsoRowKey(run.id, line.id),
      batchLabel: run.payrollRunNo || run.id,
      batchSubLabel: run.payrollMonth || '—',
      earnerName: line.staffName || '—',
      earnerId: line.staffId,
      paymentYmd,
      paid: officeLinePaidAmount(line),
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

export function executiveRowsToSsoTableFixed(rows: ExecutiveSsoRow[]): PayrollSsoTableRow[] {
  return rows.map(({ run, line, sso, paymentYmd }) => {
    const wagePaid = isOfficePayrollWagePaid(run, line);
    return {
      rowKey: executiveSsoRowKey(run.id, line.id),
      batchLabel: run.payrollRunNo || run.id,
      batchSubLabel: run.payrollMonth || '—',
      earnerName: line.staffName || '—',
      earnerId: line.staffId,
      paymentYmd,
      paid: officeLinePaidAmount(line),
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

export function countSelectedForKind(
  tableRows: PayrollSsoTableRow[],
  selectedKeys: Set<string>,
  kind: 'sso_remit' | 'employer_contrib',
): number {
  return tableRows.filter((r) => {
    if (!selectedKeys.has(r.rowKey)) return false;
    return kind === 'sso_remit' ? r.ssoPayable : r.employerPayable;
  }).length;
}

export function selectableKeySig(tableRows: PayrollSsoTableRow[]): string {
  return tableRows
    .filter((r) => r.ssoPayable || r.employerPayable)
    .map((r) => r.rowKey)
    .sort()
    .join('|');
}
