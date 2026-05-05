'use client';

import { Firestore, collection, doc, getDoc, increment, writeBatch } from 'firebase/firestore';
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
    /** ต่อท้ายคำอธิบายรายการ cashbook (เช่น แบ่งจ่ายบางคน) */
    descriptionSuffix?: string;
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

  const bankAccountId = params.payoutBankAccountId?.trim();
  if (!bankAccountId) {
    const msg: Record<PayrollPayoutKind, string> = {
      WORKER:
        'กรุณาเลือกบัญชีธนาคารสำหรับตัดจ่าย (หน้ารายละเอียดงวดลูกจ้าง > บัญชียืนยันจ่าย) — ระบบจะไม่เลือกบัญชีแทนอัตโนมัติ',
      EXECUTIVE: 'กรุณาเลือกบัญชีธนาคารสำหรับตัดจ่ายในงวดผู้บริหารก่อนอนุมัติการเงิน',
      OFFICE_STAFF: 'กรุณาเลือกบัญชีธนาคารสำหรับตัดจ่ายในหน้าบัญชี (พนักงานออฟฟิศ · ทำจ่าย) ก่อนอนุมัติ',
    };
    throw new Error(msg[params.kind]);
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

  const bankSnap = await getDoc(doc(db, 'bank_accounts', bankAccountId));
  const bankCode = bankSnap.exists()
    ? String(bankSnap.data()?.accountCode ?? '').trim() || bankAccountId
    : bankAccountId;

  const description = `จ่ายเงินเดือน ${kindLabel} ${params.payrollRunNo} งวด ${params.payrollMonthLabel} · ตัดจากบัญชี ${bankCode}${params.descriptionSuffix ?? ''}`;

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
