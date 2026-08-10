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

  const now = Date.now();
  const actorName = String(user.displayName || user.email || user.id).trim() || user.id;
  const cashbookRow: Record<string, unknown> = {
    entryNo,
    bankAccountId: params.bankAccountId,
    entryDate: params.entryDate,
    direction: params.direction,
    entryType: params.entryType,
    referenceType: params.referenceType ?? 'OTHER',
    amount: amt,
    description: params.description,
    paymentMethod: params.paymentMethod,
    createdAt: now,
    createdByUid: user.id,
    createdByName: actorName,
    updatedAt: now,
  };
  const ref = params.referenceId?.trim();
  if (ref) cashbookRow.referenceId = ref;

  const batch = writeBatch(db);
  batch.set(cashbookRef, cashbookRow);

  batch.update(bankRef, {
    currentBalance: increment(delta),
    updatedAt: Date.now(),
  });

  await batch.commit();

  return { cashbookEntryId: cashbookRef.id, entryNo };
}

/**
 * แก้รายละเอียด / ยอด / ทิศทางรายการ cashbook (admin) — ปรับ currentBalance ของบัญชีให้สอดคล้อง
 */
export async function updateCashbookEntryAdminCorrection(
  db: Firestore,
  user: User,
  params: {
    entryId: string;
    description: string;
    amount: number;
    direction: 'IN' | 'OUT';
  },
): Promise<void> {
  const entryId = String(params.entryId || '').trim();
  if (!entryId) throw new Error('ไม่พบรายการ');
  const description = String(params.description || '').trim();
  if (!description) throw new Error('กรุณาระบุรายละเอียด');
  const newAmt = roundMoney2(Number(params.amount));
  if (!(newAmt > 0)) throw new Error('ยอดเงินต้องมากกว่า 0');
  const newDir = params.direction === 'IN' ? 'IN' : 'OUT';

  const entryRef = doc(db, 'cashbook_entries', entryId);
  const entrySnap = await getDoc(entryRef);
  if (!entrySnap.exists()) throw new Error('ไม่พบรายการ cashbook');
  const cur = entrySnap.data() as {
    amount?: number;
    direction?: string;
    bankAccountId?: string;
    description?: string;
  };
  const bankAccountId = String(cur.bankAccountId || '').trim();
  if (!bankAccountId) throw new Error('รายการไม่มีบัญชีธนาคาร');

  const oldAmt = roundMoney2(Number(cur.amount) || 0);
  const oldDir = cur.direction === 'IN' ? 'IN' : 'OUT';
  const oldSigned = oldDir === 'IN' ? oldAmt : -oldAmt;
  const newSigned = newDir === 'IN' ? newAmt : -newAmt;
  const bankDelta = roundMoney2(newSigned - oldSigned);

  const bankRef = doc(db, 'bank_accounts', bankAccountId);
  const now = Date.now();
  const batch = writeBatch(db);
  batch.update(entryRef, {
    description,
    amount: newAmt,
    direction: newDir,
    updatedAt: now,
  });
  if (Math.abs(bankDelta) >= 0.005) {
    batch.update(bankRef, {
      currentBalance: increment(bankDelta),
      updatedAt: now,
    });
  }
  await batch.commit();

  const { writeAuditLog } = await import('@/lib/services/audit-service');
  await writeAuditLog(db, user, {
    actionType: 'UPDATE',
    entityType: 'CashbookEntry',
    entityId: entryId,
    sourceModule: 'accounting',
    afterSummary: `Admin corrected cashbook: desc/amount ${oldAmt} ${oldDir} → ${newAmt} ${newDir}`,
  });
}

/**
 * รับ/จ่าย Petty Cash หน้างาน — ปรับ `bank_accounts.currentBalance` เฉพาะกอง Petty
 * ไม่สร้างเอกสารใน `cashbook_entries` (ฝ่ายบัญชีตัดเงินออกจำนวนก้อนตอนโอนเข้า Petty แล้ว; รายรับรายจ่ายนี้คือการทำบัญชีภายในกองเท่านั้น)
 */
export async function recordPettyCashMovement(
  db: Firestore,
  user: User,
  params: {
    bankAccountId: string;
    direction: 'IN' | 'OUT';
    amount: number;
    entryDate: string;
    description: string;
  },
): Promise<{ pettyCashEntryId: string; entryNo: string }> {
  const amt = roundMoney2(Number(params.amount));
  if (!params.bankAccountId?.trim()) throw new Error('กรุณาเลือกบัญชี');
  if (amt <= 0) throw new Error('ยอดเงินต้องมากกว่า 0');

  const bankRef = doc(db, 'bank_accounts', params.bankAccountId);
  const bankSnap = await getDoc(bankRef);
  if (!bankSnap.exists()) throw new Error('ไม่พบบัญชีธนาคาร');
  const rawType = bankSnap.data()?.accountType;
  const typeKey = String(rawType ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_');
  if (typeKey !== 'PETTY_CASH') {
    throw new Error('รายการนี้รองรับเฉพาะบัญชีประเภท Petty Cash');
  }
  const status = bankSnap.data()?.status;
  if (status && String(status).trim().toUpperCase() !== 'ACTIVE') throw new Error('บัญชีนี้ไม่ ACTIVE');

  const { code: entryNo } = await generateNextDocumentCode(db, 'petty_cash_entry', {
    actor: user.displayName,
    userId: user.id,
  });

  const entryRef = doc(collection(db, 'petty_cash_entries'));
  const delta = params.direction === 'IN' ? amt : -amt;
  const now = Date.now();

  const batch = writeBatch(db);
  batch.set(entryRef, {
    entryNo,
    bankAccountId: params.bankAccountId,
    entryDate: params.entryDate,
    direction: params.direction,
    amount: amt,
    description: params.description,
    paymentMethod: 'CASH',
    createdAt: now,
    createdByUid: user.id,
    createdByName: String(user.displayName || user.email || user.id).trim() || user.id,
    updatedAt: now,
  });
  batch.update(bankRef, {
    currentBalance: increment(delta),
    updatedAt: now,
  });
  await batch.commit();

  return { pettyCashEntryId: entryRef.id, entryNo };
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
  const route = `${fromCode} → ${toCode}`;
  const actorName = String(user.displayName || user.email || user.id).trim() || user.id;
  const now = Date.now();

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
    description: `${baseMemo}: ${route} · จ่ายออกจากบัญชีนี้ (${fromCode})`,
    paymentMethod: 'TRANSFER',
    createdAt: now,
    createdByUid: user.id,
    createdByName: actorName,
    updatedAt: now,
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
    description: `${baseMemo}: ${route} · เงินเข้าบัญชีนี้ (${toCode})`,
    paymentMethod: 'TRANSFER',
    createdAt: now,
    createdByUid: user.id,
    createdByName: actorName,
    updatedAt: now,
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
