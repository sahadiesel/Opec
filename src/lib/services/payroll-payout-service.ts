'use client';

import {
  Firestore,
  collection,
  doc,
  getDocs,
  increment,
  limit,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import { generateNextDocumentCode } from '@/lib/services/numbering-service';
import type { User } from '@/lib/types';

export type PayrollPayoutKind = 'OFFICE_STAFF' | 'EXECUTIVE' | 'WORKER';

/**
 * เมื่อบัญชียืนยันจ่าย (office: FINANCE_APPROVED / worker batch: PAID): สร้างรายการ cashbook จ่ายออก + ลดยอดบัญชีธนาคาร
 */
export async function recordPayrollFinanceApprovalPayout(
  db: Firestore,
  user: User,
  params: {
    runId: string;
    netAmount: number;
    payrollRunNo: string;
    payrollMonthLabel: string;
    existingCashbookEntryId?: string;
    payoutBankAccountId?: string;
    kind: PayrollPayoutKind;
  }
): Promise<{ cashbookEntryId: string; bankAccountId: string }> {
  if (params.existingCashbookEntryId) {
    return {
      cashbookEntryId: params.existingCashbookEntryId,
      bankAccountId: params.payoutBankAccountId || '',
    };
  }

  const amount = Number(params.netAmount);
  if (!amount || amount <= 0) {
    throw new Error('ยอดจ่ายสุทธิไม่ถูกต้อง');
  }

  let bankAccountId = params.payoutBankAccountId?.trim();
  if (!bankAccountId) {
    const bankQ = query(collection(db, 'bank_accounts'), where('status', '==', 'ACTIVE'), limit(1));
    const snap = await getDocs(bankQ);
    if (snap.empty) throw new Error('ไม่พบบัญชีธนาคาร ACTIVE — กรุณาตั้งค่าบัญชีหรือระบุบัญชีตัดจ่ายในงวด');
    bankAccountId = snap.docs[0].id;
  }

  const { code: entryNo } = await generateNextDocumentCode(db, 'cashbook_entry', {
    actor: user.displayName,
  });

  const today = new Date().toISOString().slice(0, 10);
  const kindLabel =
    params.kind === 'EXECUTIVE'
      ? 'ผู้บริหาร'
      : params.kind === 'WORKER'
        ? 'ลูกจ้างคนงาน'
        : 'พนักงานสำนักงาน';
  const description = `จ่ายเงินเดือน ${kindLabel} ${params.payrollRunNo} งวด ${params.payrollMonthLabel}`;

  const cashbookRef = doc(collection(db, 'cashbook_entries'));
  const bankRef = doc(db, 'bank_accounts', bankAccountId);

  const batch = writeBatch(db);
  batch.set(cashbookRef, {
    entryNo,
    bankAccountId,
    entryDate: today,
    direction: 'OUT',
    entryType: 'PAYROLL',
    referenceType: 'OTHER',
    referenceId: params.runId,
    amount,
    description,
    paymentMethod: 'TRANSFER',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  batch.update(bankRef, {
    currentBalance: increment(-amount),
    updatedAt: Date.now(),
  });

  await batch.commit();

  return { cashbookEntryId: cashbookRef.id, bankAccountId };
}
