'use client';

import {
  Firestore,
  collection,
  doc,
  getDoc,
  increment,
  writeBatch,
} from 'firebase/firestore';
import { generateNextDocumentCode } from '@/lib/services/numbering-service';
import { roundMoney2 } from '@/lib/ops/purchase-payment-milestones';
import type { CashbookEntryType, PaymentMethod, User } from '@/lib/types';

export interface RecordCashbookMovementParams {
  bankAccountId: string;
  direction: 'IN' | 'OUT';
  amount: number;
  entryDate: string;
  description: string;
  paymentMethod: PaymentMethod;
  entryType: CashbookEntryType;
  referenceType?: 'RECEIPT' | 'PAYMENT' | 'BILL' | 'TRANSFER' | 'OTHER';
  referenceId?: string;
}

/**
 * สร้างรายการ cashbook พร้อมปรับยอด currentBalance ของบัญชีธนาคาร (แบบเดียวกับ payroll payout)
 */
export async function recordCashbookMovementWithBalance(
  db: Firestore,
  user: User,
  params: RecordCashbookMovementParams
): Promise<{ cashbookEntryId: string; entryNo: string }> {
  const amt = roundMoney2(Number(params.amount));
  if (!params.bankAccountId?.trim()) throw new Error('กรุณาเลือกบัญชี');
  if (amt <= 0) throw new Error('ยอดเงินต้องมากกว่า 0');

  const bankRef = doc(db, 'bank_accounts', params.bankAccountId);
  const bankSnap = await getDoc(bankRef);
  if (!bankSnap.exists()) throw new Error('ไม่พบบัญชีธนาคาร');
  const status = bankSnap.data()?.status;
  if (status && status !== 'ACTIVE') throw new Error('บัญชีนี้ไม่ ACTIVE');

  const { code: entryNo } = await generateNextDocumentCode(db, 'cashbook_entry', {
    actor: user.displayName,
  });

  const cashbookRef = doc(collection(db, 'cashbook_entries'));
  const delta = params.direction === 'IN' ? amt : -amt;

  const batch = writeBatch(db);
  batch.set(cashbookRef, {
    entryNo,
    bankAccountId: params.bankAccountId,
    entryDate: params.entryDate,
    direction: params.direction,
    entryType: params.entryType,
    referenceType: params.referenceType ?? 'OTHER',
    referenceId: params.referenceId,
    amount: amt,
    description: params.description,
    paymentMethod: params.paymentMethod,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  batch.update(bankRef, {
    currentBalance: increment(delta),
    updatedAt: Date.now(),
  });

  await batch.commit();

  return { cashbookEntryId: cashbookRef.id, entryNo };
}

export async function recordInterBankTransfer(
  db: Firestore,
  user: User,
  params: {
    fromBankAccountId: string;
    toBankAccountId: string;
    amount: number;
    entryDate: string;
    memo: string;
  }
): Promise<{ outEntryNo: string; inEntryNo: string }> {
  const fromId = params.fromBankAccountId?.trim();
  const toId = params.toBankAccountId?.trim();
  if (!fromId || !toId) throw new Error('เลือกบัญชีต้นทางและปลายทาง');
  if (fromId === toId) throw new Error('ต้องเป็นคนละบัญชี');

  const amt = roundMoney2(Number(params.amount));
  if (amt <= 0) throw new Error('ยอดโอนต้องมากกว่า 0');

  const fromRef = doc(db, 'bank_accounts', fromId);
  const toRef = doc(db, 'bank_accounts', toId);
  const [fromSnap, toSnap] = await Promise.all([getDoc(fromRef), getDoc(toRef)]);
  if (!fromSnap.exists() || !toSnap.exists()) throw new Error('ไม่พบบัญชีที่เลือก');
  if (fromSnap.data()?.status !== 'ACTIVE' || toSnap.data()?.status !== 'ACTIVE') {
    throw new Error('บัญชีต้องเป็น ACTIVE');
  }

  const fromCode = String(fromSnap.data()?.accountCode ?? fromId);
  const toCode = String(toSnap.data()?.accountCode ?? toId);

  const { code: outNo } = await generateNextDocumentCode(db, 'cashbook_entry', {
    actor: user.displayName,
  });
  const { code: inNo } = await generateNextDocumentCode(db, 'cashbook_entry', {
    actor: user.displayName,
  });

  const pairId = `TRF-${Date.now()}`;
  const outRef = doc(collection(db, 'cashbook_entries'));
  const inRef = doc(collection(db, 'cashbook_entries'));

  const baseMemo = params.memo?.trim() || 'โอนระหว่างบัญชี';

  const batch = writeBatch(db);

  batch.set(outRef, {
    entryNo: outNo,
    bankAccountId: fromId,
    entryDate: params.entryDate,
    direction: 'OUT',
    entryType: 'TRANSFER',
    referenceType: 'TRANSFER',
    referenceId: pairId,
    amount: amt,
    description: `${baseMemo} — โอนไป ${toCode}`,
    paymentMethod: 'TRANSFER',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  batch.set(inRef, {
    entryNo: inNo,
    bankAccountId: toId,
    entryDate: params.entryDate,
    direction: 'IN',
    entryType: 'TRANSFER',
    referenceType: 'TRANSFER',
    referenceId: pairId,
    amount: amt,
    description: `${baseMemo} — รับจาก ${fromCode}`,
    paymentMethod: 'TRANSFER',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  batch.update(fromRef, {
    currentBalance: increment(-amt),
    updatedAt: Date.now(),
  });
  batch.update(toRef, {
    currentBalance: increment(amt),
    updatedAt: Date.now(),
  });

  await batch.commit();

  return { outEntryNo: outNo, inEntryNo: inNo };
}
