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
