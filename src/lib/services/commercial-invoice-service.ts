'use client';

import {
  Firestore,
  collection,
  addDoc,
  doc,
  getDoc,
  query,
  where,
  getDocs,
  updateDoc,
  deleteDoc,
  deleteField,
} from 'firebase/firestore';
import type {
  CommercialInvoice,
  CommercialInvoiceLine,
  MainContract,
  PurchaseOrder,
  Quotation,
  User,
  WaveMonthTimesheetReview,
} from '@/lib/types';
import { resolveWaveMonthPeriodBounds } from '@/lib/timesheet/wave-month-payroll-bridge';
import { timestampToHtmlDateValue } from '@/lib/date-thai';
import { generateBillingLines } from '@/lib/services/billing-line-generator';
import { generateNextDocumentCode } from '@/lib/services/numbering-service';
import { sanitizeFirestorePayload } from '@/lib/utils';
import { writeAuditLog } from '@/lib/services/audit-service';

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function newLineId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/** VAT สำหรับใบแจ้งหนี้เรียกเก็บ — อ้างอิงสัญญาหลักก่อน แล้วจึง quotation */
async function resolveVatPercent(db: Firestore, customerId: string, contractId?: string): Promise<number> {
  if (contractId) {
    const mcSnap = await getDoc(doc(db, 'main_contracts', contractId));
    if (mcSnap.exists()) {
      const mc = mcSnap.data() as MainContract;
      if (mc.vatPercent != null && !Number.isNaN(Number(mc.vatPercent))) return Number(mc.vatPercent);
    }
  }
  const quotationsSnap = await getDocs(
    query(collection(db, 'quotations'), where('customerId', '==', customerId)),
  );
  const q0 = quotationsSnap.docs[0]?.data() as Quotation | undefined;
  if (q0?.taxPercent != null) return Number(q0.taxPercent);
  return 7;
}

/**
 * สร้างใบแจ้งหนี้ร่าง (เรียกเก็บ) จาก timesheet ที่พร้อมวางบิล — แยกจากใบกำกับภาษี
 */
export async function findCommercialInvoiceByWaveMonthReview(
  db: Firestore,
  reviewId: string,
): Promise<{ id: string; invoiceNo: string } | null> {
  const q = query(collection(db, 'commercial_invoices'), where('sourceWaveMonthReviewId', '==', reviewId));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  for (const d of snap.docs) {
    const data = d.data() as CommercialInvoice;
    if (data.status !== 'VOID') {
      return { id: d.id, invoiceNo: String(data.invoiceNo || '') };
    }
  }
  return null;
}

/**
 * หลังผู้จัดการอนุมัติรอบเดือน — สร้างใบแจ้งหนี้ร่างอัตโนมัติ (ช่วงวันที่จาก review)
 */
/** กันสร้างซ้ำเมื่อมีใบเก่าที่ยังไม่มี sourceWaveMonthReviewId */
/** ใช้บนหน้า list — รู้ว่า review งวดนี้มีใบแจ้งหนี้ร่างแล้วหรือยัง (รวมใบเก่าที่ไม่มี sourceWaveMonthReviewId) */
export function commercialInvoiceCoversMonthReview(
  inv: CommercialInvoice,
  review: WaveMonthTimesheetReview,
): boolean {
  if (inv.status === 'VOID') return false;
  if (inv.sourceWaveMonthReviewId === review.id) return true;
  const { start, end } = resolveWaveMonthPeriodBounds(review);
  return (
    inv.poId === review.poId &&
    inv.waveId === review.waveId &&
    inv.periodStart === start &&
    inv.periodEnd === end
  );
}

export function filterWaveMonthReviewsMissingCommercialDraft(
  reviews: WaveMonthTimesheetReview[],
  invoices: CommercialInvoice[],
): WaveMonthTimesheetReview[] {
  return reviews.filter((r) => !invoices.some((inv) => commercialInvoiceCoversMonthReview(inv, r)));
}

async function findCommercialInvoiceByPoWaveAndPeriod(
  db: Firestore,
  poId: string,
  waveId: string,
  periodStart: string,
  periodEnd: string,
): Promise<{ id: string; invoiceNo: string } | null> {
  const q = query(collection(db, 'commercial_invoices'), where('poId', '==', poId), where('waveId', '==', waveId));
  const snap = await getDocs(q);
  for (const d of snap.docs) {
    const x = d.data() as CommercialInvoice;
    if (x.status === 'VOID') continue;
    if (x.periodStart === periodStart && x.periodEnd === periodEnd) {
      return { id: d.id, invoiceNo: String(x.invoiceNo || '') };
    }
  }
  return null;
}

export async function ensureCommercialDraftInvoiceAfterMonthApproval(
  db: Firestore,
  review: WaveMonthTimesheetReview,
  actor: User,
): Promise<{ ok: true; id: string; invoiceNo: string } | { ok: false; reason: string }> {
  const existing = await findCommercialInvoiceByWaveMonthReview(db, review.id);
  if (existing?.id) {
    return { ok: false, reason: `มีใบแจ้งหนี้ร่างแล้ว (${existing.invoiceNo || existing.id})` };
  }
  const { start, end } = resolveWaveMonthPeriodBounds(review);
  const periodDup = await findCommercialInvoiceByPoWaveAndPeriod(db, review.poId, review.waveId, start, end);
  if (periodDup?.id) {
    return {
      ok: false,
      reason: `มีใบในงวดเดียวกันแล้ว (${periodDup.invoiceNo || periodDup.id}) — เปิดจากรายการด้านล่าง`,
    };
  }
  const issueDate = timestampToHtmlDateValue(Date.now());
  try {
    const { id, invoiceNo } = await createCommercialDraftInvoice(db, {
      poId: review.poId,
      waveId: review.waveId,
      periodStart: start,
      periodEnd: end,
      issueDate,
      actor,
      sourceWaveMonthReviewId: review.id,
    });
    return { ok: true, id, invoiceNo };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: msg };
  }
}

export async function createCommercialDraftInvoice(
  db: Firestore,
  params: {
    poId: string;
    waveId: string;
    periodStart: string;
    periodEnd: string;
    issueDate: string;
    currency?: string;
    actor: User;
    notes?: string;
    /** ผูกกับ wave_month_timesheet_reviews — กันซ้ำเมื่ออนุมัติรอบเดือน */
    sourceWaveMonthReviewId?: string;
  }
): Promise<{ id: string; invoiceNo: string }> {
  const { poId, waveId, periodStart, periodEnd, issueDate, actor } = params;
  const currency = params.currency || 'THB';

  const gen = await generateBillingLines(db, poId, periodStart, periodEnd, waveId);
  if (gen.lines.length === 0) {
    throw new Error(
      'ไม่มีรายการจาก timesheet — ตรวจช่วงวันที่ / wave / สถานะ timesheet (ต้อง readyForBilling)',
    );
  }

  const [poSnap, waveSnap] = await Promise.all([
    getDoc(doc(db, 'purchase_orders', poId)),
    getDoc(doc(db, 'waves', waveId)),
  ]);
  if (!poSnap.exists()) throw new Error('ไม่พบ PO');
  const po = { ...poSnap.data(), id: poSnap.id } as PurchaseOrder;
  const waveCode = waveSnap.exists() ? String((waveSnap.data() as { waveCode?: string }).waveCode || '') : '';

  const vatPercent = await resolveVatPercent(db, po.customerId, po.contractId);
  const amountBeforeTax = roundMoney(gen.totalAmount);
  const vatAmount = roundMoney((amountBeforeTax * vatPercent) / 100);
  const totalAmount = roundMoney(amountBeforeTax + vatAmount);

  const lines: CommercialInvoiceLine[] = gen.lines.map((l) => ({
    id: newLineId(),
    description: l.description,
    ...(l.workerId ? { workerId: l.workerId } : {}),
    ...(l.workerName ? { workerName: l.workerName } : {}),
    positionId: l.positionId,
    eventType: l.eventType,
    timesheetIds: l.timesheetIds,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    amount: l.amount,
    lineSource: 'timesheet' as const,
  }));

  const { code: invoiceNo } = await generateNextDocumentCode(db, 'commercial_invoice', {
    actor: actor.displayName,
    userId: actor.id,
  });

  const now = Date.now();
  const payload: Omit<CommercialInvoice, 'id'> = {
    invoiceNo,
    status: 'DRAFT',
    customerId: po.customerId,
    contractId: po.contractId || undefined,
    poId,
    waveId,
    waveCode: waveCode || undefined,
    periodStart,
    periodEnd,
    issueDate,
    currency,
    vatPercent,
    amountBeforeTax,
    vatAmount,
    withholdingTaxAmount: 0,
    totalAmount,
    lines,
    generationWarnings: gen.warnings,
    timesheetCount: gen.timesheetCount,
    notes: params.notes,
    sourceWaveMonthReviewId: params.sourceWaveMonthReviewId,
    createdAt: now,
    createdByUid: actor.id,
    createdByName: actor.displayName,
    updatedAt: now,
  };

  const ref = await addDoc(
    collection(db, 'commercial_invoices'),
    sanitizeFirestorePayload(payload as Record<string, unknown>),
  );

  await writeAuditLog(db, actor, {
    actionType: 'CREATE_COMMERCIAL_INVOICE',
    entityType: 'CommercialInvoice',
    entityId: ref.id,
    entityLabel: `${invoiceNo} (wave ${waveId})`,
    sourceModule: 'commercial_invoices',
    linkedIds: [po.customerId, poId, waveId],
    afterSummary: `สร้างใบแจ้งหนี้ร่าง (เรียกเก็บ) ${invoiceNo}`,
  });

  return { id: ref.id, invoiceNo };
}

/** PENDING_CUSTOMER + ลูกค้าร้องขอแก้ไข → DRAFT เพื่อแก้บรรทัด */
export async function reopenCommercialInvoiceForCustomerRevision(
  db: Firestore,
  invoiceId: string,
  actor: User,
): Promise<void> {
  const ref = doc(db, 'commercial_invoices', invoiceId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('ไม่พบใบแจ้งหนี้ร่าง');
  const cur = snap.data() as CommercialInvoice;
  if (cur.status !== 'PENDING_CUSTOMER') {
    throw new Error('เปิดแก้ไขได้เฉพาะใบที่ส่งลูกค้าแล้วและรอตรวจ');
  }
  if (!cur.customerRevisionRequestedAt) {
    throw new Error('ยังไม่มีคำร้องขอแก้ไขจากลูกค้า');
  }
  const now = Date.now();
  await updateDoc(
    ref,
    sanitizeFirestorePayload({
      status: 'DRAFT' as const,
      updatedAt: now,
      updatedByUid: actor.id,
      updatedByName: actor.displayName || actor.email || actor.id,
    }),
  );

  await writeAuditLog(db, actor, {
    actionType: 'UPDATE',
    entityType: 'CommercialInvoice',
    entityId: invoiceId,
    entityLabel: `${cur.invoiceNo} → เปิดแก้ไขหลังลูกค้าร้องขอ`,
    sourceModule: 'commercial_invoices',
    linkedIds: [cur.customerId, cur.poId, cur.waveId],
    afterSummary: 'เปิดใบกลับเป็น DRAFT เพื่อแก้รายการตามคำร้องของลูกค้า',
  });
}

export async function sendCommercialDraftToCustomer(
  db: Firestore,
  invoiceId: string,
  actor: User,
): Promise<void> {
  const ref = doc(db, 'commercial_invoices', invoiceId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('ไม่พบใบแจ้งหนี้ร่าง');
  const cur = snap.data() as CommercialInvoice;
  if (cur.status !== 'DRAFT') throw new Error('ส่งได้เฉพาะเอกสารสถานะ DRAFT (ตรวจยอดภายในก่อน)');

  const now = Date.now();
  const patch = sanitizeFirestorePayload({
    status: 'PENDING_CUSTOMER' as const,
    sentToCustomerAt: now,
    sentToCustomerByUid: actor.id,
    sentToCustomerByName: actor.displayName || actor.email || actor.id,
    updatedAt: now,
    updatedByUid: actor.id,
    updatedByName: actor.displayName || actor.email || actor.id,
  });
  await updateDoc(ref, {
    ...patch,
    customerRevisionRequestedAt: deleteField(),
    customerRevisionRequestNote: deleteField(),
    customerRevisionIssueId: deleteField(),
  });

  await writeAuditLog(db, actor, {
    actionType: 'UPDATE',
    entityType: 'CommercialInvoice',
    entityId: invoiceId,
    entityLabel: `${cur.invoiceNo} → ส่งลูกค้า`,
    sourceModule: 'commercial_invoices',
    linkedIds: [cur.customerId, cur.poId, cur.waveId],
    afterSummary: 'ส่งใบแจ้งหนี้ร่างให้ลูกค้าตรวจสอบใน portal',
  });
}

export async function confirmCommercialInvoiceBilling(
  db: Firestore,
  invoice: CommercialInvoice,
  actor: User,
  source: 'CLIENT_PORTAL' | 'INTERNAL',
): Promise<void> {
  if (invoice.status !== 'PENDING_CUSTOMER') {
    throw new Error('ยืนยันได้เฉพาะเอกสารที่ส่งลูกค้าแล้ว (รอตรวจ)');
  }
  const now = Date.now();
  const ref = doc(db, 'commercial_invoices', invoice.id);
  const patch = sanitizeFirestorePayload({
    status: 'ISSUED' as const,
    customerApprovedAt: now,
    customerApprovedByUid: actor.id,
    customerApprovedByName: actor.displayName || actor.email || actor.id,
    customerApprovalSource: source,
    updatedAt: now,
    updatedByUid: actor.id,
    updatedByName: actor.displayName || actor.email || actor.id,
  });
  await updateDoc(ref, {
    ...patch,
    customerRevisionRequestedAt: deleteField(),
    customerRevisionRequestNote: deleteField(),
    customerRevisionIssueId: deleteField(),
  });

  await writeAuditLog(db, actor, {
    actionType: 'UPDATE',
    entityType: 'CommercialInvoice',
    entityId: invoice.id,
    entityLabel: `${invoice.invoiceNo} → ยืนยันเรียกเก็บ`,
    sourceModule: 'commercial_invoices',
    linkedIds: [invoice.customerId, invoice.poId, invoice.waveId],
    afterSummary:
      source === 'CLIENT_PORTAL' ? 'ลูกค้ายืนยันยอดเรียกเก็บ (portal)' : 'ผู้จัดการ/ทีม OPEC ยืนยันยอดเรียกเก็บ',
  });
}

function normalizeDraftLines(lines: CommercialInvoiceLine[]): CommercialInvoiceLine[] {
  return lines.map((l) => {
    const id = l.id || newLineId();
    const qty = roundMoney(Number(l.quantity) || 0);
    const unit = roundMoney(Number(l.unitPrice) || 0);
    const amount = roundMoney(qty * unit);
    return {
      ...l,
      id,
      quantity: qty,
      unitPrice: unit,
      amount,
    };
  });
}

/** ยกเลิกใบร่างเมื่อคำนวณผิดหรือต้องสร้างใหม่ — ไม่ลบเอกสาร (VOID) */
export async function voidCommercialInvoice(
  db: Firestore,
  invoiceId: string,
  actor: User,
): Promise<void> {
  const ref = doc(db, 'commercial_invoices', invoiceId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('ไม่พบใบแจ้งหนี้ร่าง');
  const cur = snap.data() as CommercialInvoice;
  if (cur.status === 'VOID') return;
  if (cur.status === 'ISSUED') {
    throw new Error('ไม่สามารถยกเลิกใบที่ยืนยันเรียกเก็บแล้ว');
  }

  const now = Date.now();
  await updateDoc(
    ref,
    sanitizeFirestorePayload({
      status: 'VOID' as const,
      updatedAt: now,
      updatedByUid: actor.id,
      updatedByName: actor.displayName || actor.email || actor.id,
    }),
  );

  await writeAuditLog(db, actor, {
    actionType: 'UPDATE',
    entityType: 'CommercialInvoice',
    entityId: invoiceId,
    entityLabel: `${cur.invoiceNo} → ยกเลิก`,
    sourceModule: 'commercial_invoices',
    linkedIds: [cur.customerId, cur.poId, cur.waveId],
    afterSummary: 'ยกเลิกใบแจ้งหนี้ร่าง (รอสร้างใหม่จากงวด / PO)',
  });
}

/** ลบเอกสารถาวรจาก Firestore — กฎ: admin ได้ทุกสถานะ, ผู้ใช้ภายในอื่นได้เฉพาะ DRAFT (ดู firestore.rules) */
export async function deleteCommercialInvoice(
  db: Firestore,
  invoiceId: string,
  actor: User,
): Promise<void> {
  const ref = doc(db, 'commercial_invoices', invoiceId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('ไม่พบใบแจ้งหนี้ร่าง');
  const cur = snap.data() as CommercialInvoice;

  await deleteDoc(ref);

  await writeAuditLog(db, actor, {
    actionType: 'DELETE',
    entityType: 'CommercialInvoice',
    entityId: invoiceId,
    entityLabel: cur.invoiceNo,
    sourceModule: 'commercial_invoices',
    linkedIds: [cur.customerId, cur.poId, cur.waveId],
    afterSummary: `ลบใบแจ้งหนี้ร่างถาวร (สถานะเดิม ${cur.status})`,
  });
}

/** บันทึกรายการ + คำนวณยอดก่อน VAT / VAT / รวมใหม่ — เฉพาะ DRAFT */
export async function updateCommercialDraftInvoice(
  db: Firestore,
  invoiceId: string,
  nextLines: CommercialInvoiceLine[],
  actor: User,
): Promise<void> {
  const ref = doc(db, 'commercial_invoices', invoiceId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('ไม่พบใบแจ้งหนี้ร่าง');
  const cur = snap.data() as CommercialInvoice;
  if (cur.status !== 'DRAFT') {
    throw new Error('แก้ไขรายการได้เฉพาะใบสถานะ DRAFT (ตรวจภายใน)');
  }

  const normalized = normalizeDraftLines(nextLines);
  const amountBeforeTax = roundMoney(normalized.reduce((s, x) => s + x.amount, 0));
  const vp = Number(cur.vatPercent) || 0;
  const vatAmount = roundMoney((amountBeforeTax * vp) / 100);
  const totalAmount = roundMoney(amountBeforeTax + vatAmount);
  const now = Date.now();

  await updateDoc(
    ref,
    sanitizeFirestorePayload({
      lines: normalized,
      amountBeforeTax,
      vatAmount,
      totalAmount,
      updatedAt: now,
      updatedByUid: actor.id,
      updatedByName: actor.displayName || actor.email || actor.id,
    }),
  );

  await writeAuditLog(db, actor, {
    actionType: 'UPDATE',
    entityType: 'CommercialInvoice',
    entityId: invoiceId,
    entityLabel: `${cur.invoiceNo} → แก้ไขรายการ`,
    sourceModule: 'commercial_invoices',
    linkedIds: [cur.customerId, cur.poId, cur.waveId],
    afterSummary: 'บันทึกการแก้ไขรายการใบแจ้งหนี้ร่าง (รวมส่วนลด/เพิ่ม)',
  });
}
