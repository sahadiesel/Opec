'use client';

import {
  Firestore,
  collection,
  doc,
  deleteField,
  getDoc,
  updateDoc,
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
import { roundMoney2 } from '@/lib/ops/purchase-payment-milestones';

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
  displayOrder: number,
): BillingNoteLine {
  const hasTs = !!(line.timesheetIds && line.timesheetIds.length > 0);
  return {
    id: newLineId(),
    billingNoteId: bnId,
    displayOrder,
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
  options?: {
    /** แสดงยอดหัก ณ ที่จ่ายบนใบกำกับ — คำนวณจากฐานก่อน VAT × อัตรา */
    showWithholdingOnDocument?: boolean;
    withholdingTaxRatePercentOnDocument?: number;
  },
): Promise<{ taxInvoiceId: string; billingNoteId: string; taxInvoiceNo: string }> {
  const comRef = doc(db, 'commercial_invoices', commercialInvoiceId);
  const snap = await getDoc(comRef);
  if (!snap.exists()) throw new Error('ไม่พบใบเรียกเก็บ');
  const com = { ...snap.data(), id: snap.id } as CommercialInvoice;

  if (com.status !== 'ISSUED') {
    throw new Error('สร้างใบกำกับภาษีได้หลังยืนยันเรียกเก็บแล้ว (ISSUED) เท่านั้น');
  }
  const linkedTaxId = String(com.linkedTaxInvoiceId || '').trim();
  if (linkedTaxId) {
    const linkedSnap = await getDoc(doc(db, 'tax_invoices', linkedTaxId));
    if (linkedSnap.exists()) {
      const linked = linkedSnap.data() as { status?: string; taxInvoiceNo?: string };
      if (linked.status !== 'CANCELLED') {
        throw new Error(
          `มีใบกำกับภาษีอ้างอิงแล้ว (${linked.taxInvoiceNo || linkedTaxId}) — เปิดจากลิงก์ด้านบน หรือยกเลิกใบกำกับก่อน`,
        );
      }
    }
    // ลิงก์ค้างจากใบที่ CANCELLED/ถูกลบ — เคลียร์ก่อนสร้างใหม่
    await updateDoc(comRef, {
      linkedTaxInvoiceId: deleteField(),
      updatedAt: Date.now(),
    });
  }

  const [{ code: billingNoteNo }, { code: taxInvoiceNo }] = await Promise.all([
    generateNextDocumentCode(db, 'billing_note', { actor: actor.displayName, userId: actor.id }),
    generateNextDocumentCode(db, 'tax_invoice', { actor: actor.displayName, userId: actor.id }),
  ]);

  const bnRef = doc(collection(db, 'billing_notes'));
  const taxRef = doc(collection(db, 'tax_invoices'));
  const now = Date.now();
  /** วันที่ร่าง — ตอนสร้างชุดนี้ (local) ไม่ดึง com.issueDate ที่อาจเป็นวันย้อนหลัง; วันที่ออกเอกสารจริงตามวันที่กด ISSUED */
  const issueYmd = timestampToHtmlDateValue(now);
  const dueYmd = addDaysToHtmlDate(issueYmd, 30);

  const ratePct = Math.max(0, Number(options?.withholdingTaxRatePercentOnDocument ?? 3));
  const showWht = options?.showWithholdingOnDocument === true;
  const withholdingForDocs = showWht ? roundMoney2((com.amountBeforeTax * ratePct) / 100) : 0;

  const termNotes = (com.notes ?? '').trim();

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
    withholdingTaxAmount: withholdingForDocs,
    netAmount: com.totalAmount,
    currency: com.currency || 'THB',
    status: 'SUBMITTED',
    notes: termNotes || `สร้างอัตโนมัติจากใบเรียกเก็บ ${com.invoiceNo}`,
    createdAt: now,
    createdBy: actor.displayName || actor.email || actor.id,
    updatedAt: now,
    updatedBy: actor.displayName || actor.email || actor.id,
  };

  const lines = (com.lines ?? []).map((l, idx) => commercialLineToBillingLine(bnRef.id, l, now, idx));

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
    withholdingTaxAmount: withholdingForDocs,
    showWithholdingOnDocument: showWht,
    withholdingTaxRatePercentOnDocument: ratePct,
    totalAmount: com.totalAmount,
    currency: com.currency || 'THB',
    status: 'DRAFT',
    // คัดลอก Term & Note จากใบเรียกเก็บ เพื่อแสดงบนเอกสารพิมพ์
    notes: termNotes,
    createdByUid: actor.id,
    createdByName: (actor.displayName || actor.email || actor.id).trim(),
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
