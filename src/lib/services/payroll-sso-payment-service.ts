'use client';

import { Firestore, doc, getDoc, updateDoc } from 'firebase/firestore';
import { recordCashbookMovementWithBalance } from '@/lib/services/cashbook-bank-movement';
import {
  employerSsoContribAmount,
  isOfficeEmployerContribPaid,
  isOfficePayrollWagePaid,
  isOfficeSsoRemitPaid,
  isWorkerEmployerContribPaid,
  isWorkerPayrollWagePaid,
  isWorkerSsoRemitPaid,
} from '@/lib/payroll/payroll-sso-payment-model';
import type {
  OfficePayrollLine,
  OfficePayrollRun,
  PayrollBatch,
  PayrollBatchLine,
  User,
} from '@/lib/types';

export type PayrollSsoPaymentKind = 'sso_remit' | 'employer_contrib';

type LineCollection = 'payroll_batches' | 'office_payroll_runs' | 'executive_payroll_runs';

async function assertWagePaidForOfficeRun(run: OfficePayrollRun, line: OfficePayrollLine): Promise<void> {
  if (!isOfficePayrollWagePaid(run, line)) {
    throw new Error('ยังไม่ได้จ่ายเงินเดือน — ไม่สามารถจ่ายประกันสังคม/เงินสมทบได้');
  }
}

async function recordOfficeLineSsoPayment(
  db: Firestore,
  user: User,
  params: {
    collection: LineCollection;
    run: OfficePayrollRun;
    line: OfficePayrollLine;
    kind: PayrollSsoPaymentKind;
    employeeSsoAmount: number;
    bankAccountId: string;
    entryDate: string;
    earnerName: string;
    runLabel: string;
    sectionLabel: string;
  },
): Promise<{ cashbookEntryId: string; entryNo: string }> {
  const { run, line, kind, collection } = params;
  await assertWagePaidForOfficeRun(run, line);

  if (kind === 'sso_remit') {
    if (isOfficeSsoRemitPaid(line)) throw new Error('รายการนี้จ่ายประกันสังคมแล้ว');
  } else if (isOfficeEmployerContribPaid(line)) {
    throw new Error('รายการนี้จ่ายเงินสมทบแล้ว');
  }

  const amount =
    kind === 'sso_remit'
      ? Number(params.employeeSsoAmount)
      : employerSsoContribAmount(params.employeeSsoAmount);
  if (!amount || amount <= 0) throw new Error('ยอดประกันสังคม/เงินสมทบไม่ถูกต้อง');

  const bankAccountId = params.bankAccountId?.trim();
  if (!bankAccountId) throw new Error('กรุณาเลือกบัญชีธนาคารสำหรับตัดจ่าย');

  const bankSnap = await getDoc(doc(db, 'bank_accounts', bankAccountId));
  const bankCode = bankSnap.exists()
    ? String(bankSnap.data()?.accountCode ?? '').trim() || bankAccountId
    : bankAccountId;

  const earner = (params.earnerName || line.staffName || line.staffId || '').trim() || 'พนักงาน';
  const kindLabel = kind === 'sso_remit' ? 'ประกันสังคม' : 'เงินสมทบนายจ้าง';
  const description = `จ่าย${kindLabel} ${params.sectionLabel} ${earner} · งวด ${params.runLabel} · ตัดจากบัญชี ${bankCode}`;

  const { cashbookEntryId, entryNo } = await recordCashbookMovementWithBalance(db, user, {
    bankAccountId,
    direction: 'OUT',
    amount,
    entryDate: params.entryDate,
    description,
    paymentMethod: 'TRANSFER',
    entryType: 'OTHER',
    referenceType: 'OTHER',
    referenceId: `${run.id}/${line.id}/${kind}`,
  });

  const now = Date.now();
  const patch =
    kind === 'sso_remit'
      ? {
          ssoRemitCashbookEntryId: cashbookEntryId,
          ssoRemitCashbookEntryNo: entryNo,
          ssoRemitPaidAt: now,
          ssoRemitPaidByUid: user.id,
          ssoRemitPaidByName: user.displayName || user.email || user.id,
          ssoRemitPaymentBankAccountId: bankAccountId,
          updatedAt: now,
        }
      : {
          ssoEmployerContribCashbookEntryId: cashbookEntryId,
          ssoEmployerContribCashbookEntryNo: entryNo,
          ssoEmployerContribPaidAt: now,
          ssoEmployerContribPaidByUid: user.id,
          ssoEmployerContribPaidByName: user.displayName || user.email || user.id,
          ssoEmployerContribPaymentBankAccountId: bankAccountId,
          updatedAt: now,
        };

  await updateDoc(doc(db, collection, run.id, 'lines', line.id), patch);
  return { cashbookEntryId, entryNo };
}

export async function recordWorkerPayrollSsoPayment(
  db: Firestore,
  user: User,
  params: {
    batch: PayrollBatch;
    line: PayrollBatchLine;
    kind: PayrollSsoPaymentKind;
    employeeSsoAmount: number;
    bankAccountId: string;
    entryDate: string;
    earnerName: string;
  },
): Promise<{ cashbookEntryId: string; entryNo: string }> {
  const { batch, line, kind } = params;
  if (!isWorkerPayrollWagePaid(batch, line)) {
    throw new Error('ยังไม่ได้จ่ายค่าแรง — ไม่สามารถจ่ายประกันสังคม/เงินสมทบได้');
  }
  if (kind === 'sso_remit' && isWorkerSsoRemitPaid(line)) {
    throw new Error('รายการนี้จ่ายประกันสังคมแล้ว');
  }
  if (kind === 'employer_contrib' && isWorkerEmployerContribPaid(line)) {
    throw new Error('รายการนี้จ่ายเงินสมทบแล้ว');
  }

  const amount =
    kind === 'sso_remit'
      ? Number(params.employeeSsoAmount)
      : employerSsoContribAmount(params.employeeSsoAmount);
  if (!amount || amount <= 0) throw new Error('ยอดประกันสังคม/เงินสมทบไม่ถูกต้อง');

  const bankAccountId = params.bankAccountId?.trim();
  if (!bankAccountId) throw new Error('กรุณาเลือกบัญชีธนาคารสำหรับตัดจ่าย');

  const bankSnap = await getDoc(doc(db, 'bank_accounts', bankAccountId));
  const bankCode = bankSnap.exists()
    ? String(bankSnap.data()?.accountCode ?? '').trim() || bankAccountId
    : bankAccountId;

  const earner = (params.earnerName || line.workerNameSnapshot || line.workerId || '').trim() || 'ลูกจ้าง';
  const kindLabel = kind === 'sso_remit' ? 'ประกันสังคม' : 'เงินสมทบนายจ้าง';
  const description = `จ่าย${kindLabel} ลูกจ้าง ${earner} · ชุด ${batch.id} · ตัดจากบัญชี ${bankCode}`;

  const { cashbookEntryId, entryNo } = await recordCashbookMovementWithBalance(db, user, {
    bankAccountId,
    direction: 'OUT',
    amount,
    entryDate: params.entryDate,
    description,
    paymentMethod: 'TRANSFER',
    entryType: 'OTHER',
    referenceType: 'OTHER',
    referenceId: `${batch.id}/${line.id}/${kind}`,
  });

  const now = Date.now();
  const patch =
    kind === 'sso_remit'
      ? {
          ssoRemitCashbookEntryId: cashbookEntryId,
          ssoRemitCashbookEntryNo: entryNo,
          ssoRemitPaidAt: now,
          ssoRemitPaidByUid: user.id,
          ssoRemitPaidByName: user.displayName || user.email || user.id,
          ssoRemitPaymentBankAccountId: bankAccountId,
          updatedAt: now,
        }
      : {
          ssoEmployerContribCashbookEntryId: cashbookEntryId,
          ssoEmployerContribCashbookEntryNo: entryNo,
          ssoEmployerContribPaidAt: now,
          ssoEmployerContribPaidByUid: user.id,
          ssoEmployerContribPaidByName: user.displayName || user.email || user.id,
          ssoEmployerContribPaymentBankAccountId: bankAccountId,
          updatedAt: now,
        };

  await updateDoc(doc(db, 'payroll_batches', batch.id, 'lines', line.id), patch);
  return { cashbookEntryId, entryNo };
}

export async function recordOfficePayrollSsoPayment(
  db: Firestore,
  user: User,
  params: {
    run: OfficePayrollRun;
    line: OfficePayrollLine;
    kind: PayrollSsoPaymentKind;
    employeeSsoAmount: number;
    bankAccountId: string;
    entryDate: string;
    earnerName: string;
  },
): Promise<{ cashbookEntryId: string; entryNo: string }> {
  const runLabel = params.run.payrollRunNo || params.run.id;
  return recordOfficeLineSsoPayment(db, user, {
    collection: 'office_payroll_runs',
    run: params.run,
    line: params.line,
    kind: params.kind,
    employeeSsoAmount: params.employeeSsoAmount,
    bankAccountId: params.bankAccountId,
    entryDate: params.entryDate,
    earnerName: params.earnerName,
    runLabel,
    sectionLabel: 'พนักงานออฟฟิศ',
  });
}

export async function recordExecutivePayrollSsoPayment(
  db: Firestore,
  user: User,
  params: {
    run: OfficePayrollRun;
    line: OfficePayrollLine;
    kind: PayrollSsoPaymentKind;
    employeeSsoAmount: number;
    bankAccountId: string;
    entryDate: string;
    earnerName: string;
  },
): Promise<{ cashbookEntryId: string; entryNo: string }> {
  const runLabel = params.run.payrollRunNo || params.run.id;
  return recordOfficeLineSsoPayment(db, user, {
    collection: 'executive_payroll_runs',
    run: params.run,
    line: params.line,
    kind: params.kind,
    employeeSsoAmount: params.employeeSsoAmount,
    bankAccountId: params.bankAccountId,
    entryDate: params.entryDate,
    earnerName: params.earnerName,
    runLabel,
    sectionLabel: 'ผู้บริหาร',
  });
}
