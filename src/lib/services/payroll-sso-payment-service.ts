'use client';

import { Firestore, doc, getDoc, updateDoc } from 'firebase/firestore';
import { recordCashbookMovementWithBalance } from '@/lib/services/cashbook-bank-movement';
import {
  isOfficeEmployerContribPaid,
  isOfficePayrollWagePaid,
  isOfficeSsoCombinedFullyPaid,
  isOfficeSsoRemitPaid,
  isWorkerEmployerContribPaid,
  isWorkerPayrollWagePaid,
  isWorkerSsoCombinedFullyPaid,
  isWorkerSsoRemitPaid,
  remainingOfficeSsoPaymentAmount,
  remainingWorkerSsoPaymentAmount,
} from '@/lib/payroll/payroll-sso-payment-model';
import type {
  OfficePayrollLine,
  OfficePayrollRun,
  PayrollBatch,
  PayrollBatchLine,
  User,
} from '@/lib/types';

type LineCollection = 'payroll_batches' | 'office_payroll_runs' | 'executive_payroll_runs';

function buildWorkerCombinedSsoPatch(
  line: PayrollBatchLine,
  cashbookEntryId: string,
  entryNo: string,
  bankAccountId: string,
  user: User,
  now: number,
): Partial<PayrollBatchLine> & { updatedAt: number } {
  const patch: Partial<PayrollBatchLine> & { updatedAt: number } = { updatedAt: now };
  if (!isWorkerSsoRemitPaid(line)) {
    patch.ssoRemitCashbookEntryId = cashbookEntryId;
    patch.ssoRemitCashbookEntryNo = entryNo;
    patch.ssoRemitPaidAt = now;
    patch.ssoRemitPaidByUid = user.id;
    patch.ssoRemitPaidByName = user.displayName || user.email || user.id;
    patch.ssoRemitPaymentBankAccountId = bankAccountId;
  }
  if (!isWorkerEmployerContribPaid(line)) {
    patch.ssoEmployerContribCashbookEntryId = cashbookEntryId;
    patch.ssoEmployerContribCashbookEntryNo = entryNo;
    patch.ssoEmployerContribPaidAt = now;
    patch.ssoEmployerContribPaidByUid = user.id;
    patch.ssoEmployerContribPaidByName = user.displayName || user.email || user.id;
    patch.ssoEmployerContribPaymentBankAccountId = bankAccountId;
  }
  return patch;
}

function buildOfficeCombinedSsoPatch(
  line: OfficePayrollLine,
  cashbookEntryId: string,
  entryNo: string,
  bankAccountId: string,
  user: User,
  now: number,
): Partial<OfficePayrollLine> & { updatedAt: number } {
  const patch: Partial<OfficePayrollLine> & { updatedAt: number } = { updatedAt: now };
  if (!isOfficeSsoRemitPaid(line)) {
    patch.ssoRemitCashbookEntryId = cashbookEntryId;
    patch.ssoRemitCashbookEntryNo = entryNo;
    patch.ssoRemitPaidAt = now;
    patch.ssoRemitPaidByUid = user.id;
    patch.ssoRemitPaidByName = user.displayName || user.email || user.id;
    patch.ssoRemitPaymentBankAccountId = bankAccountId;
  }
  if (!isOfficeEmployerContribPaid(line)) {
    patch.ssoEmployerContribCashbookEntryId = cashbookEntryId;
    patch.ssoEmployerContribCashbookEntryNo = entryNo;
    patch.ssoEmployerContribPaidAt = now;
    patch.ssoEmployerContribPaidByUid = user.id;
    patch.ssoEmployerContribPaidByName = user.displayName || user.email || user.id;
    patch.ssoEmployerContribPaymentBankAccountId = bankAccountId;
  }
  return patch;
}

async function recordOfficeLineSsoCombinedPayment(
  db: Firestore,
  user: User,
  params: {
    collection: LineCollection;
    run: OfficePayrollRun;
    line: OfficePayrollLine;
    employeeSsoAmount: number;
    bankAccountId: string;
    entryDate: string;
    earnerName: string;
    runLabel: string;
    sectionLabel: string;
    companionLines?: Array<{ run: OfficePayrollRun; line: OfficePayrollLine }>;
  },
): Promise<{ cashbookEntryId: string; entryNo: string }> {
  const { run, line, collection } = params;
  if (!isOfficePayrollWagePaid(run, line)) {
    throw new Error('ยังไม่ได้จ่ายเงินเดือน — ไม่สามารถจ่ายประกันสังคม/เงินสมทบได้');
  }
  if (isOfficeSsoCombinedFullyPaid(line)) {
    throw new Error('รายการนี้จ่าย ปกส.+สมทบ แล้ว');
  }

  const amount = remainingOfficeSsoPaymentAmount(params.employeeSsoAmount, line);
  if (!amount || amount <= 0) throw new Error('ยอดประกันสังคม/เงินสมทบไม่ถูกต้อง');

  const bankAccountId = params.bankAccountId?.trim();
  if (!bankAccountId) throw new Error('กรุณาเลือกบัญชีธนาคารสำหรับตัดจ่าย');

  const bankSnap = await getDoc(doc(db, 'bank_accounts', bankAccountId));
  const bankCode = bankSnap.exists()
    ? String(bankSnap.data()?.accountCode ?? '').trim() || bankAccountId
    : bankAccountId;

  const earner = (params.earnerName || line.staffName || line.staffId || '').trim() || 'พนักงาน';
  const companionCount = params.companionLines?.length ?? 0;
  const description =
    companionCount > 0
      ? `จ่าย ปกส.+สมทบ ${params.sectionLabel} ${earner} · รวม ${companionCount + 1} งวดในเดือน · ตัดจากบัญชี ${bankCode}`
      : `จ่าย ปกส.+สมทบ ${params.sectionLabel} ${earner} · งวด ${params.runLabel} · ตัดจากบัญชี ${bankCode}`;

  const { cashbookEntryId, entryNo } = await recordCashbookMovementWithBalance(db, user, {
    bankAccountId,
    direction: 'OUT',
    amount,
    entryDate: params.entryDate,
    description,
    paymentMethod: 'TRANSFER',
    entryType: 'OTHER',
    referenceType: 'OTHER',
    referenceId: `${run.id}/${line.id}/sso_combined`,
  });

  const now = Date.now();
  const patch = buildOfficeCombinedSsoPatch(line, cashbookEntryId, entryNo, bankAccountId, user, now);
  await updateDoc(doc(db, collection, run.id, 'lines', line.id), patch);

  for (const companion of params.companionLines ?? []) {
    if (!companion?.run?.id || !companion?.line?.id) continue;
    if (companion.run.id === run.id && companion.line.id === line.id) continue;
    if (!isOfficePayrollWagePaid(companion.run, companion.line)) continue;
    if (isOfficeSsoCombinedFullyPaid(companion.line)) continue;
    const cPatch = buildOfficeCombinedSsoPatch(
      companion.line,
      cashbookEntryId,
      entryNo,
      bankAccountId,
      user,
      now,
    );
    await updateDoc(doc(db, collection, companion.run.id, 'lines', companion.line.id), cPatch);
  }

  return { cashbookEntryId, entryNo };
}

export async function recordWorkerPayrollSsoPayment(
  db: Firestore,
  user: User,
  params: {
    batch: PayrollBatch;
    line: PayrollBatchLine;
    employeeSsoAmount: number;
    bankAccountId: string;
    entryDate: string;
    earnerName: string;
    /** ใบอื่นในคน+เดือนเดียวกัน — มาร์กจ่ายด้วย cashbook เดียวกัน (ไม่ตัดเงินซ้ำ) */
    companionLines?: Array<{ batch: PayrollBatch; line: PayrollBatchLine }>;
  },
): Promise<{ cashbookEntryId: string; entryNo: string }> {
  const { batch, line } = params;
  if (!isWorkerPayrollWagePaid(batch, line)) {
    throw new Error('ยังไม่ได้จ่ายค่าแรง — ไม่สามารถจ่ายประกันสังคม/เงินสมทบได้');
  }
  if (isWorkerSsoCombinedFullyPaid(line)) {
    throw new Error('รายการนี้จ่าย ปกส.+สมทบ แล้ว');
  }

  const amount = remainingWorkerSsoPaymentAmount(params.employeeSsoAmount, line);
  if (!amount || amount <= 0) throw new Error('ยอดประกันสังคม/เงินสมทบไม่ถูกต้อง');

  const bankAccountId = params.bankAccountId?.trim();
  if (!bankAccountId) throw new Error('กรุณาเลือกบัญชีธนาคารสำหรับตัดจ่าย');

  const bankSnap = await getDoc(doc(db, 'bank_accounts', bankAccountId));
  const bankCode = bankSnap.exists()
    ? String(bankSnap.data()?.accountCode ?? '').trim() || bankAccountId
    : bankAccountId;

  const earner = (params.earnerName || line.workerNameSnapshot || line.workerId || '').trim() || 'ลูกจ้าง';
  const companionCount = params.companionLines?.length ?? 0;
  const description =
    companionCount > 0
      ? `จ่าย ปกส.+สมทบ ลูกจ้าง ${earner} · รวม ${companionCount + 1} ชุดจ่ายในเดือน · ตัดจากบัญชี ${bankCode}`
      : `จ่าย ปกส.+สมทบ ลูกจ้าง ${earner} · ชุด ${batch.id} · ตัดจากบัญชี ${bankCode}`;

  const { cashbookEntryId, entryNo } = await recordCashbookMovementWithBalance(db, user, {
    bankAccountId,
    direction: 'OUT',
    amount,
    entryDate: params.entryDate,
    description,
    paymentMethod: 'TRANSFER',
    entryType: 'OTHER',
    referenceType: 'OTHER',
    referenceId: `${batch.id}/${line.id}/sso_combined`,
  });

  const now = Date.now();
  const patch = buildWorkerCombinedSsoPatch(line, cashbookEntryId, entryNo, bankAccountId, user, now);
  await updateDoc(doc(db, 'payroll_batches', batch.id, 'lines', line.id), patch);

  for (const companion of params.companionLines ?? []) {
    if (!companion?.batch?.id || !companion?.line?.id) continue;
    if (companion.batch.id === batch.id && companion.line.id === line.id) continue;
    if (!isWorkerPayrollWagePaid(companion.batch, companion.line)) continue;
    if (isWorkerSsoCombinedFullyPaid(companion.line)) continue;
    const cPatch = buildWorkerCombinedSsoPatch(
      companion.line,
      cashbookEntryId,
      entryNo,
      bankAccountId,
      user,
      now,
    );
    await updateDoc(doc(db, 'payroll_batches', companion.batch.id, 'lines', companion.line.id), cPatch);
  }

  return { cashbookEntryId, entryNo };
}

export async function recordOfficePayrollSsoPayment(
  db: Firestore,
  user: User,
  params: {
    run: OfficePayrollRun;
    line: OfficePayrollLine;
    employeeSsoAmount: number;
    bankAccountId: string;
    entryDate: string;
    earnerName: string;
    companionLines?: Array<{ run: OfficePayrollRun; line: OfficePayrollLine }>;
  },
): Promise<{ cashbookEntryId: string; entryNo: string }> {
  const runLabel = params.run.payrollRunNo || params.run.id;
  return recordOfficeLineSsoCombinedPayment(db, user, {
    collection: 'office_payroll_runs',
    run: params.run,
    line: params.line,
    employeeSsoAmount: params.employeeSsoAmount,
    bankAccountId: params.bankAccountId,
    entryDate: params.entryDate,
    earnerName: params.earnerName,
    runLabel,
    sectionLabel: 'พนักงานออฟฟิศ',
    companionLines: params.companionLines,
  });
}

export async function recordExecutivePayrollSsoPayment(
  db: Firestore,
  user: User,
  params: {
    run: OfficePayrollRun;
    line: OfficePayrollLine;
    employeeSsoAmount: number;
    bankAccountId: string;
    entryDate: string;
    earnerName: string;
    companionLines?: Array<{ run: OfficePayrollRun; line: OfficePayrollLine }>;
  },
): Promise<{ cashbookEntryId: string; entryNo: string }> {
  const runLabel = params.run.payrollRunNo || params.run.id;
  return recordOfficeLineSsoCombinedPayment(db, user, {
    collection: 'executive_payroll_runs',
    run: params.run,
    line: params.line,
    employeeSsoAmount: params.employeeSsoAmount,
    bankAccountId: params.bankAccountId,
    entryDate: params.entryDate,
    earnerName: params.earnerName,
    runLabel,
    sectionLabel: 'ผู้บริหาร',
    companionLines: params.companionLines,
  });
}

/** @deprecated ใช้ recordWorkerPayrollSsoPayment แบบรวมยอดเดียวแล้ว */
export type PayrollSsoPaymentKind = 'sso_remit' | 'employer_contrib';
