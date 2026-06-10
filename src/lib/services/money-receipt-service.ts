'use client';

/**
 * ใบเสร็จรับเงิน (ลูกค้า) — ออกหลัง «ยืนยันรับเงิน» บนใบกำกับภาษี (หลังขั้นแจ้งชำระ)
 * พร้อมลง cashbook + เพิ่มยอดบัญชีธนาคาร (writeBatch เดียวกับใบเสร็จ + อัปเดตใบกำกับ)
 */
import {
  Firestore,
  collection,
  doc,
  getDoc,
  increment,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import type { MoneyReceipt, TaxInvoice, User } from '@/lib/types';
import { generateNextDocumentCode } from '@/lib/services/numbering-service';
import { expectedMoneyReceiptAmountFromInvoice } from '@/lib/accounting/money-receipt-wht-amount';
import {
  closeOpenCommercialArInBatch,
  prepareTaxInvoiceArReceiptUpdate,
} from '@/lib/services/accounts-receivable-reconcile-service';
import { roundMoney2 } from '@/lib/ops/purchase-payment-milestones';

/** ยอดใบเสร็จ = ยอดรวมใบกำกับ (ฐานภาษี + VAT) — ไม่หัก ณ ที่จ่าย */
export function expectedMoneyReceiptAmount(inv: TaxInvoice): number {
  return expectedMoneyReceiptAmountFromInvoice(inv);
}

export type ConfirmTaxInvoicePaymentParams = {
  bankAccountId: string;
  /** ยอดเงินที่รับจริง (บาท) — ต้องสอดคล้องกับใบกำกับ */
  amount: number;
  /** วันที่รับเงิน / วันที่ลง cashbook (YYYY-MM-DD) */
  entryDate: string;
};

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
  params: ConfirmTaxInvoicePaymentParams,
): Promise<{ receiptId: string; receiptNo: string; cashbookEntryId: string; cashbookEntryNo: string }> {
  if (inv.status !== 'ISSUED') {
    throw new Error('เอกสารต้องเป็น ISSUED');
  }
  if (!inv.paymentNotifiedAt) {
    throw new Error('ยังไม่มีการแจ้งชำระเงิน (ขั้นตอนที่ 1)');
  }
  if (inv.linkedReceiptId) {
    throw new Error('ออกใบเสร็จรับเงินแล้ว');
  }

  const bankId = params.bankAccountId?.trim();
  if (!bankId) throw new Error('กรุณาเลือกบัญชีธนาคารที่รับเงิน');

  const entryDate = params.entryDate?.trim();
  if (!entryDate) throw new Error('กรุณาระบุวันที่รับเงิน');

  const amt = roundMoney2(Number(params.amount));
  if (amt <= 0) throw new Error('ยอดรับต้องมากกว่า 0');

  const ceiling = roundMoney2(inv.totalAmount);
  if (amt > ceiling + 0.005) {
    throw new Error(`ยอดรับต้องไม่เกินยอดตามใบกำกับ (${ceiling.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ${inv.currency})`);
  }

  const bankRef = doc(db, 'bank_accounts', bankId);
  const bankSnap = await getDoc(bankRef);
  if (!bankSnap.exists()) throw new Error('ไม่พบบัญชีธนาคาร');
  const bankData = bankSnap.data() as { status?: string; accountType?: string };
  if (bankData.status && bankData.status !== 'ACTIVE') {
    throw new Error('บัญชีนี้ไม่ ACTIVE');
  }
  if (String(bankData.accountType) === 'PETTY_CASH') {
    throw new Error('รับเงินลูกค้าให้เลือกบัญชีธนาคารหลัก — ไม่ใช่กอง Petty Cash');
  }

  const { code: receiptNo } = await generateNextDocumentCode(db, 'money_receipt', {
    actor: actor.displayName,
    userId: actor.id,
  });
  const { code: cashbookEntryNo } = await generateNextDocumentCode(db, 'cashbook_entry', {
    actor: actor.displayName,
  });

  const now = Date.now();
  const receiptRef = doc(collection(db, 'receipts'));
  const cashbookRef = doc(collection(db, 'cashbook_entries'));
  const taxRef = doc(db, 'tax_invoices', inv.id);

  let arUpdate: { ref: ReturnType<typeof doc>; patch: Record<string, unknown> } | undefined;
  let resolvedArEntryId: string | undefined;
  try {
    const prepared = await prepareTaxInvoiceArReceiptUpdate(db, inv, amt, now);
    arUpdate = prepared.arUpdate;
    resolvedArEntryId = prepared.resolvedArEntryId;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'ไม่สามารถอัปเดตลูกหนี้ได้';
    throw new Error(msg);
  }

  const desc = `รับเงินลูกค้า ใบเสร็จ ${receiptNo} (ใบกำกับ ${inv.taxInvoiceNo})`.slice(0, 500);

  const receiptRow: Omit<MoneyReceipt, 'id'> = {
    receiptNo,
    taxInvoiceId: inv.id,
    taxInvoiceNo: inv.taxInvoiceNo,
    customerId: inv.customerId,
    amount: amt,
    currency: inv.currency,
    receiptDate: entryDate,
    status: 'ISSUED',
    bankAccountId: bankId,
    cashbookEntryId: cashbookRef.id,
    cashbookEntryNo: cashbookEntryNo,
    createdAt: now,
    updatedAt: now,
    createdByUid: actor.id,
    createdByName: actor.displayName,
  };

  const cashbookRow = {
    entryNo: cashbookEntryNo,
    bankAccountId: bankId,
    entryDate,
    direction: 'IN' as const,
    entryType: 'CUSTOMER_RECEIPT' as const,
    referenceType: 'RECEIPT' as const,
    referenceId: receiptRef.id,
    amount: amt,
    description: desc,
    paymentMethod: 'TRANSFER' as const,
    createdAt: now,
    updatedAt: now,
  };

  const batch = writeBatch(db);
  batch.set(receiptRef, receiptRow);
  batch.set(cashbookRef, cashbookRow);
  batch.update(bankRef, {
    currentBalance: increment(amt),
    updatedAt: now,
  });
  batch.update(taxRef, {
    paymentReceivedConfirmedAt: now,
    paymentReceivedConfirmedByUid: actor.id,
    paymentReceivedConfirmedByName: actor.displayName,
    linkedReceiptId: receiptRef.id,
    paymentReceivedCashbookEntryId: cashbookRef.id,
    paymentReceivedBankAccountId: bankId,
    ...(resolvedArEntryId && resolvedArEntryId !== inv.arEntryId?.trim()
      ? { arEntryId: resolvedArEntryId }
      : {}),
    updatedAt: now,
  });
  if (arUpdate) {
    batch.update(arUpdate.ref, arUpdate.patch);
  }
  await closeOpenCommercialArInBatch(db, batch, inv.sourceCommercialInvoiceId, now);

  await batch.commit();

  return {
    receiptId: receiptRef.id,
    receiptNo,
    cashbookEntryId: cashbookRef.id,
    cashbookEntryNo: cashbookEntryNo,
  };
}
