'use client';

/**
 * ใบเสร็จรับเงิน (ลูกค้า) — ออกหลัง «ยืนยันรับเงิน» บนใบกำกับภาษี (หลังขั้นแจ้งชำระ)
 */
import { Firestore, addDoc, collection, doc, updateDoc } from 'firebase/firestore';
import type { MoneyReceipt, TaxInvoice, User } from '@/lib/types';
import { generateNextDocumentCode } from '@/lib/services/numbering-service';

function ymdLocal(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function recordTaxInvoicePaymentNotification(
  db: Firestore,
  inv: TaxInvoice,
  actor: User,
  opts: { source: 'client_portal' | 'accounting_ui'; note?: string },
): Promise<void> {
  if (inv.status !== 'ISSUED') {
    throw new Error('ออกใบกำกับ (ISSUED) ก่อน — จึงจะแจ้งชำระได้');
  }
  if (inv.paymentNotifiedAt) {
    throw new Error('แจ้งชำระเงินไปแล้ว');
  }
  if (inv.linkedReceiptId) {
    throw new Error('ออกใบเสร็จรับเงินแล้ว');
  }
  const ref = doc(db, 'tax_invoices', inv.id);
  await updateDoc(ref, {
    paymentNotifiedAt: Date.now(),
    paymentNotifiedByUid: actor.id,
    paymentNotifiedByName: actor.displayName,
    paymentNotifySource: opts.source,
    paymentNotificationNote: opts.note?.trim() || null,
    updatedAt: Date.now(),
  });
}

export async function confirmPaymentAndIssueMoneyReceipt(
  db: Firestore,
  inv: TaxInvoice,
  actor: User,
): Promise<{ receiptId: string; receiptNo: string }> {
  if (inv.status !== 'ISSUED') {
    throw new Error('เอกสารต้องเป็น ISSUED');
  }
  if (!inv.paymentNotifiedAt) {
    throw new Error('ยังไม่มีการแจ้งชำระเงิน (ขั้นตอนที่ 1)');
  }
  if (inv.linkedReceiptId) {
    throw new Error('ออกใบเสร็จรับเงินแล้ว');
  }

  const { code: receiptNo } = await generateNextDocumentCode(db, 'money_receipt', {
    actor: actor.displayName,
    userId: actor.id,
  });

  const now = Date.now();
  const receiptDate = ymdLocal();

  const row: Omit<MoneyReceipt, 'id'> = {
    receiptNo,
    taxInvoiceId: inv.id,
    taxInvoiceNo: inv.taxInvoiceNo,
    customerId: inv.customerId,
    amount: inv.totalAmount,
    currency: inv.currency,
    receiptDate,
    status: 'ISSUED',
    createdAt: now,
    updatedAt: now,
    createdByUid: actor.id,
    createdByName: actor.displayName,
  };

  const receiptRef = await addDoc(collection(db, 'receipts'), row);
  const taxRef = doc(db, 'tax_invoices', inv.id);
  await updateDoc(taxRef, {
    paymentReceivedConfirmedAt: now,
    paymentReceivedConfirmedByUid: actor.id,
    paymentReceivedConfirmedByName: actor.displayName,
    linkedReceiptId: receiptRef.id,
    updatedAt: now,
  });

  return { receiptId: receiptRef.id, receiptNo };
}
