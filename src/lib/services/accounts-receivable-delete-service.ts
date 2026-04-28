'use client';

import {
  type Firestore,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  updateDoc,
} from 'firebase/firestore';
import type { AccountsReceivable, TaxInvoice, User } from '@/lib/types';
import { releaseYearlySequenceSlotIfLastIssued } from '@/lib/services/numbering-service';
import { writeAuditLog } from '@/lib/services/audit-service';

/** Shared guards — ใช้ทั้งลบจากเมนูลูกหนี้ และตอนลบชุดใบกำกับ */
export function assertTaxInvoiceAllowsRemovingLinkedAr(invoice: TaxInvoice): void {
  if (invoice.linkedReceiptId) {
    throw new Error('ไม่สามารถลบลูกหนี้ที่ผูกใบเสร็จรับเงินแล้ว');
  }
  if (invoice.paymentReceivedConfirmedAt) {
    throw new Error('ไม่สามารถลบลูกหนี้หลังมีการยืนยันรับเงินแล้ว');
  }
  /** ไม่บล็อกจาก paymentNotifiedAt — ขั้นแจ้งชำระอย่างเดียวยังไม่ใช่การรับเงินจริง (ยังไม่มีใบเสร็จ / ไม่ยืนยันรับเงิน ตามเงื่อนไขด้านบน) */
}

function assertArHasNoReceiptApplied(ar: AccountsReceivable): void {
  if (ar.creditAmount > 0.005) {
    throw new Error('ไม่สามารถลบรายการที่มีการบันทึกรับชำระแล้ว');
  }
}

async function deleteArDocReleaseSequenceAndAudit(
  db: Firestore,
  ar: AccountsReceivable & { id: string },
  actor: User,
  auditSummary: string,
): Promise<void> {
  await deleteDoc(doc(db, 'accounts_receivable', ar.id));
  await releaseYearlySequenceSlotIfLastIssued(db, 'ar', ar.documentNo);

  await writeAuditLog(db, actor, {
    actionType: 'DELETE',
    entityType: 'AccountsReceivable',
    entityId: ar.id,
    entityLabel: ar.documentNo,
    sourceModule: 'accounts_receivable',
    linkedIds: [ar.customerId, ar.referenceId],
    afterSummary: auditSummary,
  });
}

/**
 * ลบรายการลูกหนี้ที่ผูกกับใบกำกับภาษี (ผู้ดูแลระบบ) — ใช้หลังยกเลิกใบกำกับแล้ว เพื่อให้ลบชุดใบกำกับและออกเลขใหม่ได้
 */
export async function deleteAccountsReceivableEntryAsAdmin(
  db: Firestore,
  arId: string,
  actor: User,
): Promise<void> {
  const arRef = doc(db, 'accounts_receivable', arId);
  const arSnap = await getDoc(arRef);
  if (!arSnap.exists()) throw new Error('ไม่พบรายการลูกหนี้');

  const ar = { id: arSnap.id, ...arSnap.data() } as AccountsReceivable & { id: string };
  assertArHasNoReceiptApplied(ar);

  if (ar.referenceType !== 'TAX_INVOICE') {
    throw new Error(
      'ลบจากเมนูนี้ได้เฉพาะรายการที่อ้างใบกำกับภาษี — รายการจากใบเรียกเก็บอย่างอื่นให้ใช้กระบวนการทางบัญชี',
    );
  }

  const taxRef = doc(db, 'tax_invoices', ar.referenceId);
  const taxSnap = await getDoc(taxRef);

  if (taxSnap.exists()) {
    const tax = { ...taxSnap.data(), id: taxSnap.id } as TaxInvoice;
    assertTaxInvoiceAllowsRemovingLinkedAr(tax);
    if (tax.status !== 'CANCELLED') {
      throw new Error(
        'ต้องยกเลิกใบกำกับภาษีในหน้ารายละเอียด (สถานะ CANCELLED) ก่อนลบรายการลูกหนี้ที่ผูกไว้',
      );
    }
    if (tax.arEntryId && tax.arEntryId !== ar.id) {
      throw new Error('ข้อมูลการอ้างอิงลูกหนี้ไม่สอดคล้องกับใบกำกับภาษี');
    }

    await updateDoc(taxRef, {
      arEntryId: deleteField(),
      updatedAt: Date.now(),
    });
  }

  await deleteArDocReleaseSequenceAndAudit(
    db,
    ar,
    actor,
    `ลบลูกหนี้ ${ar.documentNo} (อ้าง ${ar.referenceNo ?? ar.referenceId}) — admin เคลียร์หลังยกเลิกใบกำกับ`,
  );
}

/**
 * เรียกจากการลบชุดใบกำกับ — ลบแถวลูกหนี้ถ้ามี และผ่านเงื่อนไขความปลอดภัยเดียวกับเมนูลูกหนี้ (ไม่มีใบเสร็จ / ไม่ยืนยันรับเงิน)
 */
export async function deleteTaxInvoiceLinkedArIfPresent(
  db: Firestore,
  invoice: TaxInvoice,
  actor: User,
): Promise<void> {
  if (!invoice.arEntryId) return;

  const arRef = doc(db, 'accounts_receivable', invoice.arEntryId);
  const arSnap = await getDoc(arRef);
  if (!arSnap.exists()) return;

  const ar = { id: arSnap.id, ...arSnap.data() } as AccountsReceivable & { id: string };
  assertArHasNoReceiptApplied(ar);

  if (ar.referenceType !== 'TAX_INVOICE' || ar.referenceId !== invoice.id) {
    throw new Error('ข้อมูลลูกหนี้ไม่สอดคล้องกับใบกำกับภาษี — แก้ไขด้วยมือในระบบไม่ได้');
  }

  assertTaxInvoiceAllowsRemovingLinkedAr(invoice);

  await deleteArDocReleaseSequenceAndAudit(
    db,
    ar,
    actor,
    `ลบลูกหนี้ ${ar.documentNo} ควบคู่การลบชุดใบกำกับ ${invoice.taxInvoiceNo}`,
  );
}
