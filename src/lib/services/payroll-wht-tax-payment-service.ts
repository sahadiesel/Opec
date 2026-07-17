'use client';

import { Firestore, doc, getDoc, updateDoc } from 'firebase/firestore';
import { recordCashbookMovementWithBalance } from '@/lib/services/cashbook-bank-movement';
import { writeAuditLog } from '@/lib/services/audit-service';
import { isSystemAdmin } from '@/lib/permission-core';
import { isSimpleAdmin } from '@/lib/simple-tier-model';
import {
  isOfficePayrollWagePaid,
  isOfficePayrollWhtTaxPaid,
  isWorkerPayrollWagePaid,
  isWorkerPayrollWhtTaxPaid,
} from '@/lib/payroll/payroll-wht-tax-payment-model';
import type {
  OfficePayrollLine,
  OfficePayrollRun,
  PayrollBatch,
  PayrollBatchLine,
  User,
  WhtTaxPaymentProofAttachment,
} from '@/lib/types';

/** บันทึกสถานะจ่ายภาษีโดยไม่ตัดบัญชี — เฉพาะ Admin */
function assertCanMarkWhtTaxPaidWithoutCashbook(user: User): void {
  if (!isSystemAdmin(user) && !isSimpleAdmin(user)) {
    throw new Error('บันทึกสถานะจ่ายภาษีโดยไม่ตัดบัญชีได้เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น');
  }
}

function mergeWhtTaxProofAttachments(
  existing: WhtTaxPaymentProofAttachment[] | undefined,
  incoming: WhtTaxPaymentProofAttachment[] | undefined,
): WhtTaxPaymentProofAttachment[] {
  const merged = [...(existing ?? [])];
  for (const a of incoming ?? []) {
    if (!merged.some((x) => x.id === a.id)) merged.push(a);
  }
  return merged;
}

export async function recordWorkerPayrollWhtTaxPayment(
  db: Firestore,
  user: User,
  params: {
    batch: PayrollBatch;
    line: PayrollBatchLine;
    taxAmount: number;
    bankAccountId: string;
    entryDate: string;
    earnerName: string;
    proofAttachments?: WhtTaxPaymentProofAttachment[];
  },
): Promise<{ cashbookEntryId: string; entryNo: string }> {
  const { batch, line } = params;
  if (!isWorkerPayrollWagePaid(batch, line)) {
    throw new Error('ยังไม่ได้จ่ายค่าแรง/เงินเดือน — ไม่สามารถจ่ายภาษีหัก ณ ที่จ่ายได้');
  }
  if (isWorkerPayrollWhtTaxPaid(line)) {
    throw new Error('รายการนี้จ่ายภาษีหัก ณ ที่จ่ายแล้ว');
  }

  const amount = Number(params.taxAmount);
  if (!amount || amount <= 0) {
    throw new Error('ยอดภาษีหัก ณ ที่จ่ายไม่ถูกต้อง');
  }

  const bankAccountId = params.bankAccountId?.trim();
  if (!bankAccountId) throw new Error('กรุณาเลือกบัญชีธนาคารสำหรับตัดจ่ายภาษี');

  const bankSnap = await getDoc(doc(db, 'bank_accounts', bankAccountId));
  const bankCode = bankSnap.exists()
    ? String(bankSnap.data()?.accountCode ?? '').trim() || bankAccountId
    : bankAccountId;

  const earner = (params.earnerName || line.workerNameSnapshot || line.workerId || '').trim() || 'ลูกจ้าง';
  const description = `จ่ายภาษีหัก ณ ที่จ่าย (ภงด.1) ลูกจ้าง ${earner} · ชุด ${batch.id} · ตัดจากบัญชี ${bankCode}`;

  const { cashbookEntryId, entryNo } = await recordCashbookMovementWithBalance(db, user, {
    bankAccountId,
    direction: 'OUT',
    amount,
    entryDate: params.entryDate,
    description,
    paymentMethod: 'TRANSFER',
    entryType: 'TAX',
    referenceType: 'OTHER',
    referenceId: `${batch.id}/${line.id}`,
  });

  const now = Date.now();
  await updateDoc(doc(db, 'payroll_batches', batch.id, 'lines', line.id), {
    whtTaxCashbookEntryId: cashbookEntryId,
    whtTaxCashbookEntryNo: entryNo,
    whtTaxPaidAt: now,
    whtTaxPaidByUid: user.id,
    whtTaxPaidByName: user.displayName || user.email || user.id,
    whtTaxPaymentBankAccountId: bankAccountId,
    whtTaxPaymentProofAttachments: mergeWhtTaxProofAttachments(
      line.whtTaxPaymentProofAttachments,
      params.proofAttachments,
    ),
    updatedAt: now,
  });

  return { cashbookEntryId, entryNo };
}

/**
 * บันทึกสถานะจ่ายภาษีหัก ณ ที่จ่ายแล้วเท่านั้น — ไม่ลง cashbook / ไม่ตัดบัญชีธนาคาร
 * ใช้กับรายการที่จ่ายจริงไปแล้วช่วงระบบยังไม่สมบูรณ์
 */
export async function markWorkerPayrollWhtTaxPaidWithoutCashbook(
  db: Firestore,
  user: User,
  params: { batch: PayrollBatch; line: PayrollBatchLine },
): Promise<void> {
  assertCanMarkWhtTaxPaidWithoutCashbook(user);
  const { batch, line } = params;
  if (!isWorkerPayrollWagePaid(batch, line)) {
    throw new Error('ยังไม่ได้จ่ายค่าแรง/เงินเดือน — ไม่สามารถบันทึกสถานะจ่ายภาษีได้');
  }
  if (isWorkerPayrollWhtTaxPaid(line)) {
    throw new Error('รายการนี้จ่ายภาษีหัก ณ ที่จ่ายแล้ว');
  }
  const now = Date.now();
  const earner = (line.workerNameSnapshot || line.workerId || '').trim() || line.id;
  await updateDoc(doc(db, 'payroll_batches', batch.id, 'lines', line.id), {
    whtTaxPaidAt: now,
    whtTaxPaidByUid: user.id,
    whtTaxPaidByName: user.displayName || user.email || user.id,
    whtTaxPaidWithoutCashbook: true,
    updatedAt: now,
  });
  await writeAuditLog(db, user, {
    actionType: 'UPDATE',
    entityType: 'PayrollBatchLine',
    entityId: line.id,
    payrollBatchId: batch.id,
    entityLabel: `WHT status-only · ลูกจ้าง ${earner}`,
    sourceModule: 'accounting',
    sourcePath: '/accounting/withholding-payroll',
    reasonCode: 'WHT_TAX_PAID_STATUS_ONLY',
    reasonText: 'บันทึกสถานะจ่ายภาษีหัก ณ ที่จ่ายโดยไม่ลง cashbook (legacy / ไม่ตัดบัญชี)',
    beforeSummary: 'รอจ่าย',
    afterSummary: `จ่ายแล้ว (ไม่ตัดบัญชี) · batch ${batch.id} · ${earner}`,
    changedFields: ['whtTaxPaidAt', 'whtTaxPaidWithoutCashbook', 'whtTaxPaidByUid', 'whtTaxPaidByName'],
    linkedIds: [batch.id, line.id],
  });
}

export async function recordOfficePayrollWhtTaxPayment(
  db: Firestore,
  user: User,
  params: {
    run: OfficePayrollRun;
    line: OfficePayrollLine;
    taxAmount: number;
    bankAccountId: string;
    entryDate: string;
    earnerName: string;
    proofAttachments?: WhtTaxPaymentProofAttachment[];
  },
): Promise<{ cashbookEntryId: string; entryNo: string }> {
  const { run, line } = params;
  if (!isOfficePayrollWagePaid(run, line)) {
    throw new Error('ยังไม่ได้จ่ายเงินเดือน — ไม่สามารถจ่ายภาษีหัก ณ ที่จ่ายได้');
  }
  if (isOfficePayrollWhtTaxPaid(line)) {
    throw new Error('รายการนี้จ่ายภาษีหัก ณ ที่จ่ายแล้ว');
  }

  const amount = Number(params.taxAmount);
  if (!amount || amount <= 0) {
    throw new Error('ยอดภาษีหัก ณ ที่จ่ายไม่ถูกต้อง');
  }

  const bankAccountId = params.bankAccountId?.trim();
  if (!bankAccountId) throw new Error('กรุณาเลือกบัญชีธนาคารสำหรับตัดจ่ายภาษี');

  const bankSnap = await getDoc(doc(db, 'bank_accounts', bankAccountId));
  const bankCode = bankSnap.exists()
    ? String(bankSnap.data()?.accountCode ?? '').trim() || bankAccountId
    : bankAccountId;

  const earner = (params.earnerName || line.staffName || line.staffId || '').trim() || 'พนักงาน';
  const runLabel = run.payrollRunNo || run.id;
  const description = `จ่ายภาษีหัก ณ ที่จ่าย (ภงด.1) พนักงานออฟฟิศ ${earner} · งวด ${runLabel} · ตัดจากบัญชี ${bankCode}`;

  const { cashbookEntryId, entryNo } = await recordCashbookMovementWithBalance(db, user, {
    bankAccountId,
    direction: 'OUT',
    amount,
    entryDate: params.entryDate,
    description,
    paymentMethod: 'TRANSFER',
    entryType: 'TAX',
    referenceType: 'OTHER',
    referenceId: `${run.id}/${line.id}`,
  });

  const now = Date.now();
  await updateDoc(doc(db, 'office_payroll_runs', run.id, 'lines', line.id), {
    whtTaxCashbookEntryId: cashbookEntryId,
    whtTaxCashbookEntryNo: entryNo,
    whtTaxPaidAt: now,
    whtTaxPaidByUid: user.id,
    whtTaxPaidByName: user.displayName || user.email || user.id,
    whtTaxPaymentBankAccountId: bankAccountId,
    whtTaxPaymentProofAttachments: mergeWhtTaxProofAttachments(
      line.whtTaxPaymentProofAttachments,
      params.proofAttachments,
    ),
    updatedAt: now,
  });

  return { cashbookEntryId, entryNo };
}

/** บันทึกสถานะจ่ายภาษีแล้วเท่านั้น — ไม่ลง cashbook / ไม่ตัดบัญชี (พนักงานออฟฟิศ) */
export async function markOfficePayrollWhtTaxPaidWithoutCashbook(
  db: Firestore,
  user: User,
  params: { run: OfficePayrollRun; line: OfficePayrollLine },
): Promise<void> {
  assertCanMarkWhtTaxPaidWithoutCashbook(user);
  const { run, line } = params;
  if (!isOfficePayrollWagePaid(run, line)) {
    throw new Error('ยังไม่ได้จ่ายเงินเดือน — ไม่สามารถบันทึกสถานะจ่ายภาษีได้');
  }
  if (isOfficePayrollWhtTaxPaid(line)) {
    throw new Error('รายการนี้จ่ายภาษีหัก ณ ที่จ่ายแล้ว');
  }
  const now = Date.now();
  const earner = (line.staffName || line.staffId || '').trim() || line.id;
  const runLabel = run.payrollRunNo || run.id;
  await updateDoc(doc(db, 'office_payroll_runs', run.id, 'lines', line.id), {
    whtTaxPaidAt: now,
    whtTaxPaidByUid: user.id,
    whtTaxPaidByName: user.displayName || user.email || user.id,
    whtTaxPaidWithoutCashbook: true,
    updatedAt: now,
  });
  await writeAuditLog(db, user, {
    actionType: 'UPDATE',
    entityType: 'OfficePayrollLine',
    entityId: line.id,
    entityLabel: `WHT status-only · ออฟฟิศ ${earner}`,
    sourceModule: 'accounting',
    sourcePath: '/accounting/withholding-payroll',
    reasonCode: 'WHT_TAX_PAID_STATUS_ONLY',
    reasonText: 'บันทึกสถานะจ่ายภาษีหัก ณ ที่จ่ายโดยไม่ลง cashbook (legacy / ไม่ตัดบัญชี)',
    beforeSummary: 'รอจ่าย',
    afterSummary: `จ่ายแล้ว (ไม่ตัดบัญชี) · งวด ${runLabel} · ${earner}`,
    changedFields: ['whtTaxPaidAt', 'whtTaxPaidWithoutCashbook', 'whtTaxPaidByUid', 'whtTaxPaidByName'],
    linkedIds: [run.id, line.id],
  });
}

/** งวดเงินเดือนผู้บริหาร — โครงสร้างบรรทัดเดียวกับ office payroll */
export async function recordExecutivePayrollWhtTaxPayment(
  db: Firestore,
  user: User,
  params: {
    run: OfficePayrollRun;
    line: OfficePayrollLine;
    taxAmount: number;
    bankAccountId: string;
    entryDate: string;
    earnerName: string;
    proofAttachments?: WhtTaxPaymentProofAttachment[];
  },
): Promise<{ cashbookEntryId: string; entryNo: string }> {
  const { run, line } = params;
  if (!isOfficePayrollWagePaid(run, line)) {
    throw new Error('ยังไม่ได้จ่ายเงินเดือน — ไม่สามารถจ่ายภาษีหัก ณ ที่จ่ายได้');
  }
  if (isOfficePayrollWhtTaxPaid(line)) {
    throw new Error('รายการนี้จ่ายภาษีหัก ณ ที่จ่ายแล้ว');
  }

  const amount = Number(params.taxAmount);
  if (!amount || amount <= 0) {
    throw new Error('ยอดภาษีหัก ณ ที่จ่ายไม่ถูกต้อง');
  }

  const bankAccountId = params.bankAccountId?.trim();
  if (!bankAccountId) throw new Error('กรุณาเลือกบัญชีธนาคารสำหรับตัดจ่ายภาษี');

  const bankSnap = await getDoc(doc(db, 'bank_accounts', bankAccountId));
  const bankCode = bankSnap.exists()
    ? String(bankSnap.data()?.accountCode ?? '').trim() || bankAccountId
    : bankAccountId;

  const earner = (params.earnerName || line.staffName || line.staffId || '').trim() || 'ผู้บริหาร';
  const runLabel = run.payrollRunNo || run.id;
  const description = `จ่ายภาษีหัก ณ ที่จ่าย (ภงด.1) ผู้บริหาร ${earner} · งวด ${runLabel} · ตัดจากบัญชี ${bankCode}`;

  const { cashbookEntryId, entryNo } = await recordCashbookMovementWithBalance(db, user, {
    bankAccountId,
    direction: 'OUT',
    amount,
    entryDate: params.entryDate,
    description,
    paymentMethod: 'TRANSFER',
    entryType: 'TAX',
    referenceType: 'OTHER',
    referenceId: `${run.id}/${line.id}`,
  });

  const now = Date.now();
  await updateDoc(doc(db, 'executive_payroll_runs', run.id, 'lines', line.id), {
    whtTaxCashbookEntryId: cashbookEntryId,
    whtTaxCashbookEntryNo: entryNo,
    whtTaxPaidAt: now,
    whtTaxPaidByUid: user.id,
    whtTaxPaidByName: user.displayName || user.email || user.id,
    whtTaxPaymentBankAccountId: bankAccountId,
    whtTaxPaymentProofAttachments: mergeWhtTaxProofAttachments(
      line.whtTaxPaymentProofAttachments,
      params.proofAttachments,
    ),
    updatedAt: now,
  });

  return { cashbookEntryId, entryNo };
}

/** บันทึกสถานะจ่ายภาษีแล้วเท่านั้น — ไม่ลง cashbook / ไม่ตัดบัญชี (ผู้บริหาร) */
export async function markExecutivePayrollWhtTaxPaidWithoutCashbook(
  db: Firestore,
  user: User,
  params: { run: OfficePayrollRun; line: OfficePayrollLine },
): Promise<void> {
  assertCanMarkWhtTaxPaidWithoutCashbook(user);
  const { run, line } = params;
  if (!isOfficePayrollWagePaid(run, line)) {
    throw new Error('ยังไม่ได้จ่ายเงินเดือน — ไม่สามารถบันทึกสถานะจ่ายภาษีได้');
  }
  if (isOfficePayrollWhtTaxPaid(line)) {
    throw new Error('รายการนี้จ่ายภาษีหัก ณ ที่จ่ายแล้ว');
  }
  const now = Date.now();
  const earner = (line.staffName || line.staffId || '').trim() || line.id;
  const runLabel = run.payrollRunNo || run.id;
  await updateDoc(doc(db, 'executive_payroll_runs', run.id, 'lines', line.id), {
    whtTaxPaidAt: now,
    whtTaxPaidByUid: user.id,
    whtTaxPaidByName: user.displayName || user.email || user.id,
    whtTaxPaidWithoutCashbook: true,
    updatedAt: now,
  });
  await writeAuditLog(db, user, {
    actionType: 'UPDATE',
    entityType: 'ExecutivePayrollLine',
    entityId: line.id,
    entityLabel: `WHT status-only · ผู้บริหาร ${earner}`,
    sourceModule: 'accounting',
    sourcePath: '/accounting/withholding-payroll/executive',
    reasonCode: 'WHT_TAX_PAID_STATUS_ONLY',
    reasonText: 'บันทึกสถานะจ่ายภาษีหัก ณ ที่จ่ายโดยไม่ลง cashbook (legacy / ไม่ตัดบัญชี)',
    beforeSummary: 'รอจ่าย',
    afterSummary: `จ่ายแล้ว (ไม่ตัดบัญชี) · งวด ${runLabel} · ${earner}`,
    changedFields: ['whtTaxPaidAt', 'whtTaxPaidWithoutCashbook', 'whtTaxPaidByUid', 'whtTaxPaidByName'],
    linkedIds: [run.id, line.id],
  });
}
