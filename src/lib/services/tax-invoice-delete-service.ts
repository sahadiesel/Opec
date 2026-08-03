'use client';

import {
  type Firestore,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  updateDoc,
} from 'firebase/firestore';
import type { FirebaseApp } from 'firebase/app';
import type { BillingNote, TaxInvoice, User } from '@/lib/types';
import { releaseSequenceSlotIfLastIssued } from '@/lib/services/numbering-service';
import { writeAuditLog } from '@/lib/services/audit-service';
import { deleteTaxInvoiceAttachmentFile } from '@/lib/storage/tax-invoice-attachments';
import { deleteTaxInvoiceWhtFile } from '@/lib/storage/tax-invoice-wht-attachments';
import {
  assertTaxInvoiceAllowsRemovingLinkedAr,
  deleteTaxInvoiceLinkedArIfPresent,
} from '@/lib/services/accounts-receivable-delete-service';
import { sanitizeFirestorePayload } from '@/lib/utils';

/**
 * ยกเลิกใบกำกับภาษี (DRAFT / ISSUED → CANCELLED)
 * — ล้างลิงก์บนใบแจ้งหนี้ · ลบลูกหนี้ที่ผูกถ้ายังไม่มีใบเสร็จ/ยืนยันรับเงิน
 * หลังจากนี้ยกเลิกใบแจ้งหนี้ (VOID) ได้ตามปกติ
 */
export async function cancelTaxInvoiceAsAccounting(
  db: Firestore,
  taxInvoiceId: string,
  actor: User,
): Promise<void> {
  const taxRef = doc(db, 'tax_invoices', taxInvoiceId);
  const taxSnap = await getDoc(taxRef);
  if (!taxSnap.exists()) throw new Error('ไม่พบใบกำกับภาษี');
  const invoice = { id: taxSnap.id, ...taxSnap.data() } as TaxInvoice;

  if (invoice.status === 'CANCELLED') {
    if (invoice.sourceCommercialInvoiceId) {
      await clearCommercialLinkedTaxIfMatches(db, invoice.sourceCommercialInvoiceId, invoice.id, actor);
    }
    return;
  }

  assertTaxInvoiceAllowsRemovingLinkedAr(invoice);
  await deleteTaxInvoiceLinkedArIfPresent(db, invoice, actor);

  const now = Date.now();
  await updateDoc(
    taxRef,
    sanitizeFirestorePayload({
      status: 'CANCELLED' as const,
      arEntryId: deleteField(),
      updatedAt: now,
    }),
  );

  if (invoice.billingNoteId) {
    const bnRef = doc(db, 'billing_notes', invoice.billingNoteId);
    const bnSnap = await getDoc(bnRef);
    if (bnSnap.exists()) {
      const bn = bnSnap.data() as BillingNote;
      if (bn.status === 'INVOICED' || bn.status === 'SUBMITTED') {
        await updateDoc(bnRef, {
          status: 'CANCELLED' as const,
          updatedAt: now,
          updatedBy: actor.displayName || actor.email || actor.id,
        });
      }
    }
  }

  if (invoice.sourceCommercialInvoiceId) {
    await clearCommercialLinkedTaxIfMatches(db, invoice.sourceCommercialInvoiceId, invoice.id, actor);
  }

  await writeAuditLog(db, actor, {
    actionType: 'UPDATE',
    entityType: 'TaxInvoice',
    entityId: invoice.id,
    entityLabel: `${invoice.taxInvoiceNo} → CANCELLED`,
    sourceModule: 'tax_invoices',
    linkedIds: [
      invoice.customerId,
      invoice.billingNoteId,
      ...(invoice.sourceCommercialInvoiceId ? [invoice.sourceCommercialInvoiceId] : []),
    ],
    taxInvoiceId: invoice.id,
    billingNoteId: invoice.billingNoteId,
    afterSummary: 'ยกเลิกใบกำกับภาษี — ปลดลิงก์ใบแจ้งหนี้ / ลบลูกหนี้เมื่อปลอดภัย',
  });
}

async function clearCommercialLinkedTaxIfMatches(
  db: Firestore,
  commercialInvoiceId: string,
  taxInvoiceId: string,
  actor: User,
): Promise<void> {
  const comRef = doc(db, 'commercial_invoices', commercialInvoiceId);
  const comSnap = await getDoc(comRef);
  if (!comSnap.exists()) return;
  const linked = String((comSnap.data() as { linkedTaxInvoiceId?: string }).linkedTaxInvoiceId || '').trim();
  if (linked && linked !== taxInvoiceId) return;
  await updateDoc(comRef, {
    linkedTaxInvoiceId: deleteField(),
    updatedAt: Date.now(),
    updatedByUid: actor.id,
    updatedByName: actor.displayName || actor.email || actor.id,
  });
}

export async function deleteTaxInvoiceBundleAsAdmin(
  db: Firestore,
  firebaseApp: FirebaseApp | null,
  invoice: TaxInvoice,
  actor: User,
): Promise<void> {
  if (invoice.status === 'ISSUED') {
    throw new Error(
      'ต้องยกเลิกใบกำกับภาษีก่อน (สถานะ CANCELLED) — จากนั้นระบบจะลบลูกหนี้ที่เกี่ยวข้องให้อัตโนมัติเมื่อปลอดภัย',
    );
  }
  assertTaxInvoiceAllowsRemovingLinkedAr(invoice);

  await deleteTaxInvoiceLinkedArIfPresent(db, invoice, actor);

  const bnRef = doc(db, 'billing_notes', invoice.billingNoteId);
  const bnSnap = await getDoc(bnRef);
  const billingNote = bnSnap.exists() ? ({ ...bnSnap.data(), id: bnSnap.id } as BillingNote) : null;

  const taxInvoiceNo = invoice.taxInvoiceNo;
  const billingNoteNo = billingNote?.billingNoteNo;

  if (invoice.sourceCommercialInvoiceId) {
    const comRef = doc(db, 'commercial_invoices', invoice.sourceCommercialInvoiceId);
    const comSnap = await getDoc(comRef);
    if (comSnap.exists()) {
      await updateDoc(comRef, {
        linkedTaxInvoiceId: deleteField(),
        updatedAt: Date.now(),
        updatedByUid: actor.id,
        updatedByName: actor.displayName || actor.email || actor.id,
      });
    }
  }

  const linesSnap = await getDocs(collection(db, 'billing_notes', invoice.billingNoteId, 'lines'));
  for (const d of linesSnap.docs) {
    await deleteDoc(d.ref);
  }

  if (billingNote) {
    await deleteDoc(bnRef);
  }

  if (firebaseApp && invoice.timesheetPaperAttachments?.length) {
    for (const att of invoice.timesheetPaperAttachments) {
      try {
        await deleteTaxInvoiceAttachmentFile(firebaseApp, att.storagePath);
      } catch {
        /* best-effort — object may already be gone */
      }
    }
  }

  if (firebaseApp && invoice.whtAttachments?.length) {
    for (const att of invoice.whtAttachments) {
      try {
        await deleteTaxInvoiceWhtFile(firebaseApp, att.storagePath);
      } catch {
        /* best-effort */
      }
    }
  }

  await deleteDoc(doc(db, 'tax_invoices', invoice.id));

  await releaseSequenceSlotIfLastIssued(db, 'tax_invoice', taxInvoiceNo);
  if (billingNoteNo) {
    await releaseSequenceSlotIfLastIssued(db, 'billing_note', billingNoteNo);
  }

  await writeAuditLog(db, actor, {
    actionType: 'DELETE',
    entityType: 'TaxInvoice',
    entityId: invoice.id,
    entityLabel: taxInvoiceNo,
    sourceModule: 'tax_invoices',
    linkedIds: [
      invoice.customerId,
      invoice.billingNoteId,
      ...(invoice.sourceCommercialInvoiceId ? [invoice.sourceCommercialInvoiceId] : []),
    ],
    taxInvoiceId: invoice.id,
    billingNoteId: invoice.billingNoteId,
    afterSummary: `ลบใบกำกับภาษีและใบวางบิลที่คู่กัน — คืนเลขที่ลำดับได้ถ้าเป็นเลขล่าสุดของเดือน (${taxInvoiceNo}${billingNoteNo ? ` / ${billingNoteNo}` : ''})`,
  });
}
