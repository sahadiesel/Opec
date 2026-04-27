'use client';

import {
  Firestore,
  collection,
  doc,
  getDoc,
  writeBatch,
} from 'firebase/firestore';
import type {
  BillingNote,
  BillingNoteLine,
  CommercialInvoice,
  CommercialInvoiceLine,
  TaxInvoice,
  User,
} from '@/lib/types';
import { generateNextDocumentCode } from '@/lib/services/numbering-service';
import { sanitizeFirestorePayload } from '@/lib/utils';
import { writeAuditLog } from '@/lib/services/audit-service';
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue } from '@/lib/date-thai';

function newLineId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function addDaysToHtmlDate(issueYmd: string, days: number): string {
  const ms = htmlDateValueToTimestampMs(issueYmd?.trim() || '');
  if (ms == null) return issueYmd;
  return timestampToHtmlDateValue(ms + days * 86400000);
}

function commercialLineToBillingLine(
  bnId: string,
  line: CommercialInvoiceLine,
  now: number,
): BillingNoteLine {
  const hasTs = !!(line.timesheetIds && line.timesheetIds.length > 0);
  return {
    id: newLineId(),
    billingNoteId: bnId,
    description: line.description || '—',
    referenceType: hasTs ? 'TIMESHEET' : 'SERVICE',
    ...(line.timesheetIds?.[0] ? { referenceId: line.timesheetIds[0] } : {}),
    ...(line.workerId ? { workerId: line.workerId } : {}),
    ...(line.workerName ? { workerName: line.workerName } : {}),
    ...(line.positionId ? { positionId: line.positionId } : {}),
    ...(line.eventType ? { eventType: line.eventType } : {}),
    ...(line.timesheetIds ? { timesheetIds: line.timesheetIds } : {}),
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    amount: line.amount,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * หลังใบเรียกเก็บ (commercial) ถูกยืนยัน (ISSUED) — สร้างใบวางบิล + ใบกำกับภาษี (ร่าง) ในคราวเดียว
 * ใบกำกับภาษี/ใบวางบิล = ชุดเรียกเก็บส่งลูกค้า — **แยก**จากใบเสร็จรับเงิน (ออกหลังบัญชียืนยันรับเงินจริง)
 */
export async function createTaxInvoiceDraftFromIssuedCommercial(
  db: Firestore,
  commercialInvoiceId: string,
  actor: User,
): Promise<{ taxInvoiceId: string; billingNoteId: string; taxInvoiceNo: string }> {
  const comRef = doc(db, 'commercial_invoices', commercialInvoiceId);
  const snap = await getDoc(comRef);
  if (!snap.exists()) throw new Error('ไม่พบใบเรียกเก็บ');
  const com = { ...snap.data(), id: snap.id } as CommercialInvoice;

  if (com.status !== 'ISSUED') {
    throw new Error('สร้างใบกำกับภาษีได้หลังยืนยันเรียกเก็บแล้ว (ISSUED) เท่านั้น');
  }
  if (com.linkedTaxInvoiceId) {
    throw new Error('มีใบกำกับภาษีอ้างอิงแล้ว — เปิดจากลิงก์ด้านบน');
  }

  const [{ code: billingNoteNo }, { code: taxInvoiceNo }] = await Promise.all([
    generateNextDocumentCode(db, 'billing_note', { actor: actor.displayName, userId: actor.id }),
    generateNextDocumentCode(db, 'tax_invoice', { actor: actor.displayName, userId: actor.id }),
  ]);

  const bnRef = doc(collection(db, 'billing_notes'));
  const taxRef = doc(collection(db, 'tax_invoices'));
  const now = Date.now();
  const issueYmd = com.issueDate || timestampToHtmlDateValue(now);
  const dueYmd = addDaysToHtmlDate(issueYmd, 30);

  const billingNotePayload: Omit<BillingNote, 'id'> = {
    billingNoteNo,
    customerId: com.customerId,
    ...(com.contractId ? { contractId: com.contractId } : {}),
    poId: com.poId,
    waveId: com.waveId,
    billingDate: issueYmd,
    dueDate: dueYmd,
    billingPeriodStart: com.periodStart,
    billingPeriodEnd: com.periodEnd,
    amountBeforeTax: com.amountBeforeTax,
    vatPercent: com.vatPercent,
    vatAmount: com.vatAmount,
    withholdingTaxAmount: com.withholdingTaxAmount ?? 0,
    netAmount: com.totalAmount,
    currency: com.currency || 'THB',
    status: 'SUBMITTED',
    notes: `สร้างอัตโนมัติจากใบเรียกเก็บ ${com.invoiceNo}`,
    createdAt: now,
    createdBy: actor.displayName || actor.email || actor.id,
    updatedAt: now,
    updatedBy: actor.displayName || actor.email || actor.id,
  };

  const lines = (com.lines ?? []).map((l) => commercialLineToBillingLine(bnRef.id, l, now));

  const billingSource: TaxInvoice['billingCustomerApprovalSource'] =
    com.customerApprovalSource === 'CLIENT_PORTAL' ? 'client_portal' : 'internal_representative';

  const taxPayload: Omit<TaxInvoice, 'id'> = {
    taxInvoiceNo,
    billingNoteId: bnRef.id,
    sourceCommercialInvoiceId: com.id,
    customerId: com.customerId,
    waveId: com.waveId,
    issueDate: issueYmd,
    taxableAmount: com.amountBeforeTax,
    vatAmount: com.vatAmount,
    withholdingTaxAmount: com.withholdingTaxAmount ?? 0,
    totalAmount: com.totalAmount,
    currency: com.currency || 'THB',
    status: 'DRAFT',
    notes: `จากใบเรียกเก็บ ${com.invoiceNo} — ใบกำกับภาษี+ใบวางบิล (ยังไม่ e-Tax) — ใบเสร็จรับเงินอีกขั้นหลังรับเงินจริง`,
    ...(com.customerApprovedAt
      ? {
          billingCustomerApprovedAt: com.customerApprovedAt,
          billingCustomerApprovedByUid: com.customerApprovedByUid,
          billingCustomerApprovedByName: com.customerApprovedByName,
          billingCustomerApprovalSource: billingSource,
        }
      : {}),
    createdAt: now,
    updatedAt: now,
  };

  const batch = writeBatch(db);
  batch.set(bnRef, sanitizeFirestorePayload(billingNotePayload as Record<string, unknown>));
  for (const line of lines) {
    const lineRef = doc(collection(db, 'billing_notes', bnRef.id, 'lines'), line.id);
    batch.set(lineRef, sanitizeFirestorePayload(line as unknown as Record<string, unknown>));
  }
  batch.set(taxRef, sanitizeFirestorePayload(taxPayload as unknown as Record<string, unknown>));
  batch.update(
    comRef,
    sanitizeFirestorePayload({
      linkedTaxInvoiceId: taxRef.id,
      updatedAt: now,
      updatedByUid: actor.id,
      updatedByName: actor.displayName || actor.email || actor.id,
    }),
  );

  await batch.commit();

  await writeAuditLog(db, actor, {
    actionType: 'CREATE',
    entityType: 'TaxInvoice',
    entityId: taxRef.id,
    entityLabel: `${taxInvoiceNo} ← ${com.invoiceNo}`,
    sourceModule: 'tax_invoices',
    linkedIds: [com.customerId, com.poId, com.waveId, bnRef.id, com.id],
    taxInvoiceId: taxRef.id,
    billingNoteId: bnRef.id,
    afterSummary: `สร้างใบกำกับภาษีร่างจากใบเรียกเก็บ ${com.invoiceNo} (พร้อมใบวางบิล ${billingNoteNo})`,
  });

  return { taxInvoiceId: taxRef.id, billingNoteId: bnRef.id, taxInvoiceNo };
}
