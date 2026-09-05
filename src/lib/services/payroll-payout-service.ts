'use client';

import { Firestore, collection, doc, getDoc, increment, writeBatch } from 'firebase/firestore';
import { generateNextDocumentCode } from '@/lib/services/numbering-service';
import { timestampToHtmlDateValue } from '@/lib/date-thai';
import type { User } from '@/lib/types';

export type PayrollPayoutKind = 'OFFICE_STAFF' | 'EXECUTIVE' | 'WORKER';

function todayYmdLocal(): string {
  const local = timestampToHtmlDateValue(Date.now());
  if (local && /^\d{4}-\d{2}-\d{2}$/.test(local)) return local;
  /** fallback — อย่าใช้ toISOString (UTC) เพราะไทย UTC+7 จะเพี้ยนวันตอนเช้ามืด */
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

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
    /**
     * วันที่โอน/ตัดบัญชีจริง (yyyy-mm-dd) — ใช้เป็น entryDate ใน cashbook และวันจ่ายบนสลิป
     * ถ้าว่างใช้วันปัจจุบันตามโซนเวลาเครื่อง (ไม่ใช้ UTC)
     */
    entryDate?: string;
  }
): Promise<{ cashbookEntryId: string; bankAccountId: string; entryDate: string }> {
  const entryDate =
    (params.entryDate?.trim().match(/^\d{4}-\d{2}-\d{2}$/)?.[0] as string | undefined) ?? todayYmdLocal();

  if (params.existingCashbookEntryId) {
    let resolvedDate = entryDate;
    try {
      const existing = await getDoc(doc(db, 'cashbook_entries', params.existingCashbookEntryId));
      const fromBook = String(existing.data()?.entryDate ?? '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(fromBook)) resolvedDate = fromBook;
    } catch {
      /* keep entryDate */
    }
    return {
      cashbookEntryId: params.existingCashbookEntryId,
      bankAccountId: params.payoutBankAccountId || '',
      entryDate: resolvedDate,
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
    entryDate,
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

  return { cashbookEntryId: cashbookRef.id, bankAccountId, entryDate };
}
