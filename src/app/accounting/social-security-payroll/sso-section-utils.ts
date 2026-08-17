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
  isOfficePayrollWagePaid,
  isOfficeSsoRemitPaid,
  isWorkerEmployerContribPaid,
  isWorkerPayrollWagePaid,
  isWorkerSsoRemitPaid,
  officeWageStatusLabel,
  workerWageStatusLabel,
} from '@/lib/payroll/payroll-sso-payment-model';
import {
  annotatePersonMonthGroups,
  resolveSharedMonthlyEmployeeSso,
} from '@/lib/payroll/payroll-person-month-group';
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

function workerPeriodYm(line: PayrollBatchLine, paymentYmd: string): string {
  const end = String(line.periodEndDate || '').trim();
  if (/^\d{4}-\d{2}/.test(end)) return end.slice(0, 7);
  const start = String(line.periodStartDate || '').trim();
  if (/^\d{4}-\d{2}/.test(start)) return start.slice(0, 7);
  if (/^\d{4}-\d{2}-\d{2}$/.test(paymentYmd)) return paymentYmd.slice(0, 7);
  return '';
}

function officePeriodYm(run: OfficePayrollRun, paymentYmd: string): string {
  const pm = String(run.payrollMonth || '').trim();
  if (/^\d{4}-\d{2}/.test(pm)) return pm.slice(0, 7);
  if (/^\d{4}-\d{2}-\d{2}$/.test(paymentYmd)) return paymentYmd.slice(0, 7);
  return '';
}

export function workerRowsToSsoTable(
  rows: WorkerSsoRow[],
  nationalIdByWorkerId?: ReadonlyMap<string, string>,
): PayrollSsoTableRow[] {
  const base = rows.map(({ batch, line, sso, paymentYmd }) => {
    const wagePaid = isWorkerPayrollWagePaid(batch, line);
    return {
      rowKey: workerSsoRowKey(batch.id, line.id),
      personId: line.workerId,
      periodYm: workerPeriodYm(line, paymentYmd),
      paymentYmd,
      recencyMs: Number(batch.updatedAt) || 0,
      lineAmount: sso,
      batchLabel: batch.id,
      earnerName: line.workerNameSnapshot || '—',
      earnerId: resolveWorkerNationalId(line, nationalIdByWorkerId),
      paid: workerLineGrossPayAmount(line),
      lineSso: sso,
      wagePaid,
      wageLabel: workerWageStatusLabel(batch.status),
      ssoRemitPaid: isWorkerSsoRemitPaid(line),
      employerContribPaid: isWorkerEmployerContribPaid(line),
      openHref: `/payroll/batches/${encodeURIComponent(batch.id)}/workers/${encodeURIComponent(line.workerId)}`,
    };
  });

  const annotated = annotatePersonMonthGroups(base, 'worker', (members, ym) =>
    resolveSharedMonthlyEmployeeSso(members, ym),
  );
  const byKey = new Map(annotated.map((a) => [a.rowKey, a]));

  return annotated.map((a) => {
    const groupMembers = (a.memberRowKeys || []).map((k) => byKey.get(k)).filter(Boolean) as typeof annotated;
    const shared = a.sharedAmount;
    const allWagePaid = groupMembers.every((m) => m.wagePaid);
    const allSsoPaid = groupMembers.every((m) => m.ssoRemitPaid && m.employerContribPaid);
    const payable = a.isGroupLeader && allWagePaid && !allSsoPaid && shared > 0.005;
    return {
      rowKey: a.rowKey,
      batchLabel: a.batchLabel,
      earnerName: a.earnerName,
      earnerId: a.earnerId,
      paymentYmd: a.paymentYmd,
      paid: a.paid,
      lineSso: a.lineSso,
      sso: a.isGroupLeader ? shared : 0,
      employerContrib: a.isGroupLeader ? employerSsoContribAmount(shared) : 0,
      wagePaid: a.wagePaid,
      wageLabel: a.wageLabel,
      ssoRemitPaid: a.isGroupLeader ? allSsoPaid : a.ssoRemitPaid,
      employerContribPaid: a.isGroupLeader ? allSsoPaid : a.employerContribPaid,
      openHref: a.openHref,
      ssoPayable: payable,
      employerPayable: payable,
      groupKey: a.groupKey,
      isGroupLeader: a.isGroupLeader,
      groupSize: a.groupSize,
      memberRowKeys: a.memberRowKeys,
    };
  });
}

export function officeRowsToSsoTable(
  rows: OfficeSsoRow[],
  openHref: (runId: string, staffId: string) => string,
  nationalIdByStaffId?: ReadonlyMap<string, string>,
): PayrollSsoTableRow[] {
  const base = rows.map(({ run, line, sso, paymentYmd }) => {
    const wagePaid = isOfficePayrollWagePaid(run, line);
    return {
      rowKey: officeSsoRowKey(run.id, line.id),
      personId: line.staffId,
      periodYm: officePeriodYm(run, paymentYmd),
      paymentYmd,
      recencyMs: Number(run.updatedAt) || 0,
      lineAmount: sso,
      batchLabel: run.payrollRunNo || run.id,
      batchSubLabel: run.payrollMonth || '—',
      earnerName: line.staffName || '—',
      earnerId: resolveStaffNationalId(line.staffId, nationalIdByStaffId),
      paid: officeLineGrossPayAmount(line),
      lineSso: sso,
      wagePaid,
      wageLabel: officeWageStatusLabel(run.status),
      ssoRemitPaid: isOfficeSsoRemitPaid(line),
      employerContribPaid: isOfficeEmployerContribPaid(line),
      openHref: openHref(run.id, line.staffId),
    };
  });

  const annotated = annotatePersonMonthGroups(base, 'office', (members, ym) =>
    resolveSharedMonthlyEmployeeSso(members, ym),
  );
  const byKey = new Map(annotated.map((a) => [a.rowKey, a]));

  return annotated.map((a) => {
    const groupMembers = (a.memberRowKeys || []).map((k) => byKey.get(k)).filter(Boolean) as typeof annotated;
    const shared = a.sharedAmount;
    const allWagePaid = groupMembers.every((m) => m.wagePaid);
    const allSsoPaid = groupMembers.every((m) => m.ssoRemitPaid && m.employerContribPaid);
    const payable = a.isGroupLeader && allWagePaid && !allSsoPaid && shared > 0.005;
    return {
      rowKey: a.rowKey,
      batchLabel: a.batchLabel,
      batchSubLabel: a.batchSubLabel,
      earnerName: a.earnerName,
      earnerId: a.earnerId,
      paymentYmd: a.paymentYmd,
      paid: a.paid,
      lineSso: a.lineSso,
      sso: a.isGroupLeader ? shared : 0,
      employerContrib: a.isGroupLeader ? employerSsoContribAmount(shared) : 0,
      wagePaid: a.wagePaid,
      wageLabel: a.wageLabel,
      ssoRemitPaid: a.isGroupLeader ? allSsoPaid : a.ssoRemitPaid,
      employerContribPaid: a.isGroupLeader ? allSsoPaid : a.employerContribPaid,
      openHref: a.openHref,
      ssoPayable: payable,
      employerPayable: payable,
      groupKey: a.groupKey,
      isGroupLeader: a.isGroupLeader,
      groupSize: a.groupSize,
      memberRowKeys: a.memberRowKeys,
    };
  });
}

export function executiveRowsToSsoTableFixed(
  rows: ExecutiveSsoRow[],
  nationalIdByExecutiveStaffId?: ReadonlyMap<string, string>,
): PayrollSsoTableRow[] {
  const base = rows.map(({ run, line, sso, paymentYmd }) => {
    const wagePaid = isOfficePayrollWagePaid(run, line);
    return {
      rowKey: executiveSsoRowKey(run.id, line.id),
      personId: line.staffId,
      periodYm: officePeriodYm(run, paymentYmd),
      paymentYmd,
      recencyMs: Number(run.updatedAt) || 0,
      lineAmount: sso,
      batchLabel: run.payrollRunNo || run.id,
      batchSubLabel: run.payrollMonth || '—',
      earnerName: line.staffName || '—',
      earnerId: resolveStaffNationalId(line.staffId, nationalIdByExecutiveStaffId),
      paid: officeLineGrossPayAmount(line),
      lineSso: sso,
      wagePaid,
      wageLabel: officeWageStatusLabel(run.status),
      ssoRemitPaid: isOfficeSsoRemitPaid(line),
      employerContribPaid: isOfficeEmployerContribPaid(line),
      openHref: `/accounting/executive-payroll/${encodeURIComponent(run.id)}/staff/${encodeURIComponent(line.staffId)}`,
    };
  });

  const annotated = annotatePersonMonthGroups(base, 'executive', (members, ym) =>
    resolveSharedMonthlyEmployeeSso(members, ym),
  );
  const byKey = new Map(annotated.map((a) => [a.rowKey, a]));

  return annotated.map((a) => {
    const groupMembers = (a.memberRowKeys || []).map((k) => byKey.get(k)).filter(Boolean) as typeof annotated;
    const shared = a.sharedAmount;
    const allWagePaid = groupMembers.every((m) => m.wagePaid);
    const allSsoPaid = groupMembers.every((m) => m.ssoRemitPaid && m.employerContribPaid);
    const payable = a.isGroupLeader && allWagePaid && !allSsoPaid && shared > 0.005;
    return {
      rowKey: a.rowKey,
      batchLabel: a.batchLabel,
      batchSubLabel: a.batchSubLabel,
      earnerName: a.earnerName,
      earnerId: a.earnerId,
      paymentYmd: a.paymentYmd,
      paid: a.paid,
      lineSso: a.lineSso,
      sso: a.isGroupLeader ? shared : 0,
      employerContrib: a.isGroupLeader ? employerSsoContribAmount(shared) : 0,
      wagePaid: a.wagePaid,
      wageLabel: a.wageLabel,
      ssoRemitPaid: a.isGroupLeader ? allSsoPaid : a.ssoRemitPaid,
      employerContribPaid: a.isGroupLeader ? allSsoPaid : a.employerContribPaid,
      openHref: a.openHref,
      ssoPayable: payable,
      employerPayable: payable,
      groupKey: a.groupKey,
      isGroupLeader: a.isGroupLeader,
      groupSize: a.groupSize,
      memberRowKeys: a.memberRowKeys,
    };
  });
}

export function countSelectedPayable(tableRows: PayrollSsoTableRow[], selectedKeys: Set<string>): number {
  return tableRows.filter(
    (r) =>
      selectedKeys.has(r.rowKey) &&
      r.isGroupLeader !== false &&
      (r.ssoPayable || r.employerPayable),
  ).length;
}

export function payAmountForRow(row: PayrollSsoTableRow): number {
  if (row.isGroupLeader === false) return 0;
  let sum = 0;
  if (row.ssoPayable) sum += row.sso;
  if (row.employerPayable) sum += row.employerContrib;
  return sum;
}

/** อัปเดต state ใน UI หลังจ่าย ปกส.+สมทบ รวมยอดเดียว */
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
    .filter((r) => r.isGroupLeader !== false && (r.ssoPayable || r.employerPayable))
    .map((r) => r.rowKey)
    .sort()
    .join('|');
}
