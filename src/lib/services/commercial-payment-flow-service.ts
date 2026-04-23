'use client';

import { addDoc, collection, doc, getDoc, getDocs, limit, query, where, writeBatch } from 'firebase/firestore';
import { recordCashbookMovementWithBalance } from '@/lib/services/cashbook-bank-movement';
import { createTaxInvoiceDraftFromIssuedCommercial } from '@/lib/services/tax-invoice-from-commercial-service';
import { generateNextDocumentCode } from '@/lib/services/numbering-service';
import { writeAuditLog } from '@/lib/services/audit-service';
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue } from '@/lib/date-thai';
import { sanitizeFirestorePayload } from '@/lib/utils';
import type { AccountsReceivable, CommercialInvoice, TaxInvoice, User } from '@/lib/types';
import type { Firestore } from 'firebase/firestore';

function addDaysToHtmlDate(issueYmd: string, days: number): string {
  const ms = htmlDateValueToTimestampMs(issueYmd?.trim() || '');
  if (ms == null) return issueYmd;
  return timestampToHtmlDateValue(ms + days * 86400000);
}

async function findArForCommercial(
  db: Firestore,
  commercialId: string,
): Promise<(AccountsReceivable & { id: string }) | null> {
  const snap = await getDocs(
    query(
      collection(db, 'accounts_receivable'),
      where('referenceId', '==', commercialId),
      where('referenceType', '==', 'COMMERCIAL_INVOICE' as const),
      limit(1),
    ),
  );
  if (snap.empty) return null;
  return { id: snap.docs[0]!.id, ...snap.docs[0]!.data() } as AccountsReceivable & { id: string };
}

/**
 * ฝ่ายบัญชี: หลังลูกค้าแนบสลิป — ออกใบกำกับ/ใบเสร็จ, รับรอง AR, ลง cashbook (บัญชีธนาคาร) อัตโนมัติ
 */
export async function verifyOpecCustomerPaymentForCommercial(
  db: Firestore,
  commercialInvoiceId: string,
  actor: User,
  params: { bankAccountId: string; entryDate: string },
): Promise<{
  taxInvoiceId: string;
  taxInvoiceNo: string;
  arId: string;
  cashbookEntryId: string;
  entryNo: string;
}> {
  const comRef = doc(db, 'commercial_invoices', commercialInvoiceId);
  const comSnap = await getDoc(comRef);
  if (!comSnap.exists()) throw new Error('ไม่พบใบเรียกเก็บ');
  const com = { ...comSnap.data(), id: comSnap.id } as CommercialInvoice;

  if (com.status !== 'ISSUED') {
    throw new Error('อนุมัติการรับเงินได้หลังยืนยันยอดเรียกเก็บ (ISSUED) เท่านั้น');
  }
  if (!com.customerPaymentReportedAt) {
    throw new Error('ลูกค้ายังไม่ได้กดแจ้ง/แนบหลักฐานการจ่ายเงิน');
  }
  if (com.opecPaymentVerifiedAt) {
    throw new Error('อนุมัติการรับเงินครั้งนี้แล้ว');
  }

  let taxId = com.linkedTaxInvoiceId?.trim();
  if (!taxId) {
    const created = await createTaxInvoiceDraftFromIssuedCommercial(db, com.id, actor);
    taxId = created.taxInvoiceId;
  }

  const taxRef = doc(db, 'tax_invoices', taxId);
  const taxSnap = await getDoc(taxRef);
  if (!taxSnap.exists()) throw new Error('ไม่พบใบกำกับภาษีอ้างอิง');
  const tax = { ...taxSnap.data(), id: taxSnap.id } as TaxInvoice;
  if (tax.status === 'CANCELLED') {
    throw new Error('ใบกำกับถูกยกเลิก ไม่อนุมัติการรับเงินต่อได้');
  }
  if (tax.status === 'ISSUED') {
    throw new Error('ใบกำกับนี้ถูกออก (ISSUED) แล้ว ใช้งานเดิมในเมนูบัญชี');
  }

  const billRef = doc(db, 'billing_notes', tax.billingNoteId);
  const billSnap = await getDoc(billRef);
  if (!billSnap.exists()) throw new Error('ไม่พบใบวางบิล');
  const billing = billSnap.data() as { dueDate?: string };

  const arExisting = await findArForCommercial(db, com.id);
  const dueYmd = billing.dueDate || addDaysToHtmlDate(tax.issueDate, 30);

  let arId: string;
  if (arExisting) {
    arId = arExisting.id;
  } else {
    const { code: arNo } = await generateNextDocumentCode(db, 'ar', {
      actor: actor.displayName,
      userId: actor.id,
    });
    const r = await addDoc(
      collection(db, 'accounts_receivable'),
      sanitizeFirestorePayload({
        customerId: com.customerId,
        documentNo: arNo,
        referenceType: 'TAX_INVOICE' as const,
        referenceId: tax.id,
        referenceNo: tax.taxInvoiceNo,
        issueDate: tax.issueDate,
        dueDate: dueYmd,
        debitAmount: tax.totalAmount,
        creditAmount: 0,
        outstandingAmount: tax.totalAmount,
        status: 'OPEN' as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    arId = r.id;
  }

  const cash = await recordCashbookMovementWithBalance(db, actor, {
    bankAccountId: params.bankAccountId,
    direction: 'IN',
    amount: com.totalAmount,
    entryDate: params.entryDate,
    description: `รับเงิน ${com.invoiceNo} (ก่อนออกใบกำกับ)`.slice(0, 500),
    paymentMethod: 'TRANSFER',
    entryType: 'CUSTOMER_RECEIPT',
    referenceType: 'RECEIPT',
    referenceId: com.id,
  });

  const batch = writeBatch(db);
  if (arExisting) {
    batch.update(
      doc(db, 'accounts_receivable', arExisting.id),
      sanitizeFirestorePayload({
        referenceType: 'TAX_INVOICE' as const,
        referenceId: tax.id,
        referenceNo: tax.taxInvoiceNo,
        dueDate: dueYmd,
        creditAmount: arExisting.debitAmount,
        outstandingAmount: 0,
        status: 'PAID' as const,
        updatedAt: Date.now(),
      }),
    );
  } else {
    const arD = doc(db, 'accounts_receivable', arId);
    batch.update(
      arD,
      sanitizeFirestorePayload({
        creditAmount: tax.totalAmount,
        outstandingAmount: 0,
        status: 'PAID' as const,
        updatedAt: Date.now(),
      }),
    );
  }

  batch.update(
    taxRef,
    sanitizeFirestorePayload({
      status: 'ISSUED' as const,
      arEntryId: arId,
      updatedAt: Date.now(),
    }),
  );

  batch.update(
    billRef,
    sanitizeFirestorePayload({
      status: 'INVOICED' as const,
      updatedAt: Date.now(),
    }),
  );

  const now0 = Date.now();
  batch.update(
    comRef,
    sanitizeFirestorePayload({
      opecPaymentVerifiedAt: now0,
      opecPaymentVerifiedByUid: actor.id,
      opecPaymentVerifiedByName: actor.displayName || actor.email || actor.id,
      opecPaymentBankAccountId: params.bankAccountId,
      opecPaymentCashbookEntryId: cash.cashbookEntryId,
      updatedAt: now0,
      updatedByUid: actor.id,
      updatedByName: actor.displayName || actor.email || actor.id,
    }),
  );

  await batch.commit();

  await writeAuditLog(db, actor, {
    actionType: 'UPDATE',
    entityType: 'CommercialInvoice',
    entityId: com.id,
    entityLabel: `${com.invoiceNo} → รับเงิน/ออกใบกำกับ`,
    sourceModule: 'commercial_invoices',
    linkedIds: [com.customerId, tax.id, arId, params.bankAccountId],
    afterSummary: `OPEC ยืนยันรับเงิน, ออก ${tax.taxInvoiceNo}, ลง cashbook ${cash.entryNo}`,
  });

  return {
    taxInvoiceId: tax.id,
    taxInvoiceNo: tax.taxInvoiceNo,
    arId,
    cashbookEntryId: cash.cashbookEntryId,
    entryNo: cash.entryNo,
  };
}
