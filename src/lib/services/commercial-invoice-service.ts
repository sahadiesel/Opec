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
  limit,
  updateDoc,
  deleteDoc,
  deleteField,
} from 'firebase/firestore';
import type {
  CommercialInvoice,
  CommercialInvoiceLine,
  MainContract,
  POLine,
  PoMonthTimesheetReview,
  PurchaseOrder,
  Quotation,
  QuotationLine,
  User,
  WaveMonthTimesheetReview,
} from '@/lib/types';
import { resolveWaveMonthPeriodBounds } from '@/lib/timesheet/wave-month-payroll-bridge';
import { resolvePoMonthPeriodBounds } from '@/lib/timesheet/po-month-timesheet-bridge';
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue } from '@/lib/date-thai';
import { generateBillingLines } from '@/lib/services/billing-line-generator';
import { generateNextDocumentCode } from '@/lib/services/numbering-service';
import { sanitizeFirestorePayload } from '@/lib/utils';
import { writeAuditLog } from '@/lib/services/audit-service';

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** PO จากใบเสนอราคา — ไม่มี Wave; ใช้เป็นค่า waveId เพื่อแยกจากงาน timesheet */
export const QUOTATION_PO_WAVE_PLACEHOLDER = '__quotation_po__';

/** งวดอนุมัติ timesheet รวมราย PO+เดือน (ไม่แยก wave) — ใบแจ้งหนี้รวม timesheet ทุก wave ใต้ PO ในช่วงงวด */
export const PO_MONTH_WAVE_PLACEHOLDER = '__po_month__';

/**
 * นโยบายอ้างอิงงวดวางบิล (Commercial / ลูกค้า)
 *
 * - **ลงเวลาจริง** มาจาก `daily_timesheets` รายวันต่อ assignment+wave; PO เป็น “โควต้า/สั่งงาน” คนมาไม่พร้อมกัน
 * - เมื่อ**ในเดือนเดียวกันภายใต้ PO มีมากกว่า 1 wave** (คน mobilize คนล่ะชุด) จะ**อ้าง “wave ฉบับเดียว” บนใบแจ้งหนี้เดียวไม่ครอบยอดเดือน** — ใบที่ถูกต้องสำหรับเรียกเก็บรวมเดือน =
 *   เอกสาร **PO+เดือน** หลัง manager approve + `sourcePoMonthReviewId` (บรรทัดใบยึด `timesheetIds` จากทุก wave ในช่วง)
 * - Path **wave+เดือน** / `sourceWaveMonthReviewId` ยังใช้ได้เมื่องวดนั้น “มี effective wave ตัวเดียว” หรือเป็น history — **ห้ามแก้**ใบ
 *   `ISSUED` / ที่ลูกค้า approve แล้ว; ราย DRAFT อาจ void แล้วสร้างใหม่จาก PO+เดือนตาม runbook
 */
function newLineId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/** VAT สำหรับใบแจ้งหนี้เรียกเก็บ — อ้างอิงสัญญาหลักก่อน แล้วจึงใบเสนอราคาที่ระบุ แล้วจึง quotation ของลูกค้า */
async function resolveVatPercent(
  db: Firestore,
  customerId: string,
  contractId?: string,
  quotationId?: string,
): Promise<number> {
  if (contractId) {
    const mcSnap = await getDoc(doc(db, 'main_contracts', contractId));
    if (mcSnap.exists()) {
      const mc = mcSnap.data() as MainContract;
      if (mc.vatPercent != null && !Number.isNaN(Number(mc.vatPercent))) return Number(mc.vatPercent);
    }
  }
  if (quotationId) {
    const qSnap = await getDoc(doc(db, 'quotations', quotationId));
    if (qSnap.exists()) {
      const q = qSnap.data() as Quotation;
      if (q.taxPercent != null && !Number.isNaN(Number(q.taxPercent))) return Number(q.taxPercent);
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
 * สร้างใบแจ้งหนี้ (เรียกเก็บ) จาก timesheet ที่พร้อมวางบิล — แยกจากใบกำกับภาษี
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

export async function findCommercialInvoiceByPoMonthReview(
  db: Firestore,
  reviewId: string,
): Promise<{ id: string; invoiceNo: string } | null> {
  const q = query(collection(db, 'commercial_invoices'), where('sourcePoMonthReviewId', '==', reviewId));
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
 * หลังผู้จัดการอนุมัติรอบเดือน — สร้างใบแจ้งหนี้อัตโนมัติ (ช่วงวันที่จาก review)
 */
/** กันสร้างซ้ำเมื่อมีใบเก่าที่ยังไม่มี sourceWaveMonthReviewId */
/** ใช้บนหน้า list — รู้ว่า review งวดนี้มีใบแจ้งหนี้แล้วหรือยัง (รวมใบเก่าที่ไม่มี sourceWaveMonthReviewId) */
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

export function commercialInvoiceCoversPoMonthReview(
  inv: CommercialInvoice,
  review: PoMonthTimesheetReview,
): boolean {
  if (inv.status === 'VOID') return false;
  if (inv.sourcePoMonthReviewId === review.id) return true;
  const { start, end } = resolvePoMonthPeriodBounds(review);
  return (
    inv.poId === review.poId &&
    inv.waveId === PO_MONTH_WAVE_PLACEHOLDER &&
    inv.periodStart === start &&
    inv.periodEnd === end
  );
}

export function filterPoMonthReviewsMissingCommercialDraft(
  reviews: PoMonthTimesheetReview[],
  invoices: CommercialInvoice[],
): PoMonthTimesheetReview[] {
  return reviews.filter((r) => !invoices.some((inv) => commercialInvoiceCoversPoMonthReview(inv, r)));
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

async function findCommercialInvoiceByQuotationPoPeriod(
  db: Firestore,
  poId: string,
  periodStart: string,
  periodEnd: string,
): Promise<{ id: string; invoiceNo: string } | null> {
  const q = query(
    collection(db, 'commercial_invoices'),
    where('poId', '==', poId),
    where('waveId', '==', QUOTATION_PO_WAVE_PLACEHOLDER),
  );
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

/**
 * สร้างใบแจ้งหนี้จาก PO สายใบเสนอราคา — ถ้ามี `po_lines` ใช้จาก PO ไม่เช่นนั้นดึงรายการจากใบเสนอราคาที่ PO อ้างอิง (ไม่ใช้ Wave / timesheet)
 */
export async function createCommercialDraftFromQuotationPoLines(
  db: Firestore,
  params: {
    poId: string;
    periodStart: string;
    periodEnd: string;
    issueDate: string;
    currency?: string;
    actor: User;
    notes?: string;
  },
): Promise<{ id: string; invoiceNo: string }> {
  const { poId, periodStart, periodEnd, issueDate, actor } = params;
  const currency = params.currency || 'THB';

  const periodDup = await findCommercialInvoiceByQuotationPoPeriod(db, poId, periodStart, periodEnd);
  if (periodDup?.id) {
    throw new Error(
      `มีใบในงวดเดียวกันแล้ว (${periodDup.invoiceNo || periodDup.id}) — เปิดจากรายการด้านล่าง`,
    );
  }

  const poSnap = await getDoc(doc(db, 'purchase_orders', poId));
  if (!poSnap.exists()) throw new Error('ไม่พบ PO');
  const po = { ...poSnap.data(), id: poSnap.id } as PurchaseOrder;
  if ((po.poType || 'contract') !== 'quotation') {
    throw new Error('ใช้กับ PO จากใบเสนอราคาเท่านั้น — PO จากสัญญาให้ใช้ Wave + timesheet');
  }

  const quotationIdRef = (po.quotationId || '').trim();

  const linesSnap = await getDocs(collection(db, 'purchase_orders', poId, 'po_lines'));
  const poLines: POLine[] = linesSnap.docs.map((d) => {
    const raw = d.data() as Omit<POLine, 'id'>;
    return { ...raw, id: d.id };
  });
  const activePoLines = poLines.filter((l) => l.status !== 'cancelled');

  let lines: CommercialInvoiceLine[];
  let generationWarnings: string[];
  let auditLineSource: string;

  if (activePoLines.length > 0) {
    lines = activePoLines.map((line, idx) => {
      const qty = Math.max(0, Number(line.quantity) || 0);
      const unit = roundMoney(Number(line.sellRateSnapshot) || 0);
      const amount = roundMoney(qty * unit);
      const loc = (line.workLocation || '').trim();
      const unitLabel = line.billingUnitSnapshot || 'unit';
      return {
        id: newLineId(),
        displayOrder: idx,
        description: loc
          ? `${loc} — ${qty} × ${unit.toLocaleString()} (${unitLabel})`
          : `PO Line — ${qty} × ${unit.toLocaleString()} (${unitLabel})`,
        positionId: line.positionId,
        quantity: qty,
        unitPrice: unit,
        amount,
        lineSource: 'po_line' as const,
      };
    });
    generationWarnings = ['สร้างจากรายการ PO Line (สายใบเสนอราคา) — ไม่มี timesheet / Wave'];
    auditLineSource = 'PO Line';
  } else {
    if (!quotationIdRef) {
      throw new Error(
        'ไม่มีรายการใน PO และ PO ไม่ได้อ้างอิงใบเสนอราคา — เพิ่มรายการใน PO หรือเลือกใบเสนอราคาตอนลงทะเบียน PO',
      );
    }
    const qLineSnap = await getDocs(collection(db, 'quotations', quotationIdRef, 'lines'));
    const quoLines: QuotationLine[] = qLineSnap.docs.map((d) => {
      const raw = d.data() as Omit<QuotationLine, 'id'>;
      return { ...raw, id: d.id };
    });
    quoLines.sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
    if (quoLines.length === 0) {
      throw new Error(
        'ไม่มีรายการในใบเสนอราคา — เพิ่มรายการในใบเสนอราคาก่อน หรือเพิ่มรายการใน PO',
      );
    }
    lines = quoLines.map((line, idx) => {
      const qty = Math.max(0, Number(line.quantity) || 0);
      const unit = roundMoney(Number(line.unitPrice) || 0);
      const rawTotal = Number(line.lineTotal);
      const amount = roundMoney(
        Number.isFinite(rawTotal) && rawTotal !== 0 ? rawTotal : qty * unit,
      );
      const desc = (line.description || '').trim() || 'รายการ';
      const unitLabel = (line.unit || '').trim();
      const remarks = (line.remarks || '').trim();
      const head = unitLabel ? `${desc} (${unitLabel})` : desc;
      const tail = remarks ? `${head} — ${remarks}` : head;
      const description = `${tail} — ${qty} × ${unit.toLocaleString()}`;
      return {
        id: newLineId(),
        displayOrder: idx,
        description,
        quantity: qty,
        unitPrice: unit,
        amount,
        lineSource: 'quotation_line' as const,
      };
    });
    generationWarnings = ['สร้างจากรายการใบเสนอราคาที่ PO อ้างอิง — ไม่มี timesheet / Wave'];
    auditLineSource = 'ใบเสนอราคา';
  }

  const amountBeforeTax = roundMoney(lines.reduce((s, l) => s + l.amount, 0));
  if (amountBeforeTax <= 0) {
    throw new Error('ยอดรวมเป็น 0 — ตรวจราคา/จำนวนในใบเสนอราคาหรือ PO Line');
  }

  const vatPercent = await resolveVatPercent(
    db,
    po.customerId,
    po.contractId?.trim() || undefined,
    quotationIdRef || undefined,
  );
  const vatAmount = roundMoney((amountBeforeTax * vatPercent) / 100);
  const totalAmount = roundMoney(amountBeforeTax + vatAmount);

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
    waveId: QUOTATION_PO_WAVE_PLACEHOLDER,
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
    generationWarnings,
    timesheetCount: 0,
    notes: params.notes,
    createdAt: now,
    createdByUid: actor.id,
    createdByName: actor.displayName,
    updatedAt: now,
  };

  const ref = await addDoc(
    collection(db, 'commercial_invoices'),
    sanitizeFirestorePayload(payload as Record<string, unknown>),
  );

  const linkedIds = [po.customerId, poId, quotationIdRef || undefined].filter(Boolean) as string[];

  await writeAuditLog(db, actor, {
    actionType: 'CREATE_COMMERCIAL_INVOICE',
    entityType: 'CommercialInvoice',
    entityId: ref.id,
    entityLabel: `${invoiceNo} (PO ใบเสนอราคา)`,
    sourceModule: 'commercial_invoices',
    linkedIds,
    afterSummary: `สร้างใบแจ้งหนี้ (เรียกเก็บ) ${invoiceNo} จาก ${auditLineSource}`,
  });

  return { id: ref.id, invoiceNo };
}

/**
 * สร้าง DRAFT หลังอนุมัติ **wave+เดือน** (อ้าง `sourceWaveMonthReviewId` + `waveId` หนึ่งตัว)
 *
 * เหมาะเมื่องวดนั้นมี **wave เดียวที่มี activity** ต่อ PO หรือเป็น flow เดิม/ยอดรอง
 * ถ้าในปฏิทินเดียวกันภายใต้ PO มี **หลาย wave** ที่ยังลงเวลา — ใบเรียกเก็บ “เต็มเดือน” ต้องใช้
 * {@link ensureCommercialDraftInvoiceAfterPoMonthApproval} (รวม timesheet ทุก wave, `sourcePoMonthReviewId`)
 */
export async function ensureCommercialDraftInvoiceAfterMonthApproval(
  db: Firestore,
  review: WaveMonthTimesheetReview,
  actor: User,
): Promise<{ ok: true; id: string; invoiceNo: string } | { ok: false; reason: string }> {
  const existing = await findCommercialInvoiceByWaveMonthReview(db, review.id);
  if (existing?.id) {
    return { ok: false, reason: `มีใบแจ้งหนี้แล้ว (${existing.invoiceNo || existing.id})` };
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

async function findCommercialInvoiceByPoMonthPeriodDup(
  db: Firestore,
  poId: string,
  periodStart: string,
  periodEnd: string,
): Promise<{ id: string; invoiceNo: string } | null> {
  const q = query(
    collection(db, 'commercial_invoices'),
    where('poId', '==', poId),
    where('waveId', '==', PO_MONTH_WAVE_PLACEHOLDER),
  );
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

/**
 * งวดอนุมัติ timesheet รวมราย PO+เดือน (รวมทุก wave) — ใบแจ้งหนี้ผูก sourcePoMonthReviewId
 */
export async function ensureCommercialDraftInvoiceAfterPoMonthApproval(
  db: Firestore,
  review: PoMonthTimesheetReview,
  actor: User,
): Promise<{ ok: true; id: string; invoiceNo: string } | { ok: false; reason: string }> {
  const existing = await findCommercialInvoiceByPoMonthReview(db, review.id);
  if (existing?.id) {
    return { ok: false, reason: `มีใบแจ้งหนี้แล้ว (${existing.invoiceNo || existing.id})` };
  }
  const { start, end } = resolvePoMonthPeriodBounds(review);
  const periodDup = await findCommercialInvoiceByPoMonthPeriodDup(db, review.poId, start, end);
  if (periodDup?.id) {
    return {
      ok: false,
      reason: `มีใบในงวด PO+เดียวกันแล้ว (${periodDup.invoiceNo || periodDup.id}) — เปิดจากรายการด้านล่าง`,
    };
  }
  const issueDate = timestampToHtmlDateValue(Date.now());
  try {
    const { id, invoiceNo } = await createCommercialDraftInvoiceForPoMonth(
      db,
      {
        poId: review.poId,
        periodStart: start,
        periodEnd: end,
        issueDate,
        actor,
        sourcePoMonthReviewId: review.id,
      },
    );
    return { ok: true, id, invoiceNo };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: msg };
  }
}

/**
 * สร้างใบแจ้งหนี้จาก timesheet ทุก wave ใต้ PO ในช่วงงวด (กรองด้วย readyForBilling ใน generateBillingLines)
 */
export async function createCommercialDraftInvoiceForPoMonth(
  db: Firestore,
  params: {
    poId: string;
    periodStart: string;
    periodEnd: string;
    issueDate: string;
    currency?: string;
    actor: User;
    notes?: string;
    sourcePoMonthReviewId: string;
  },
): Promise<{ id: string; invoiceNo: string }> {
  const { poId, periodStart, periodEnd, issueDate, actor, sourcePoMonthReviewId } = params;
  const currency = params.currency || 'THB';
  const gen = await generateBillingLines(db, poId, periodStart, periodEnd, undefined);
  if (gen.lines.length === 0) {
    throw new Error(
      'ไม่มีรายการจาก timesheet — ตรวจช่วงงวด / สถานะ readyForBilling ของ timesheet ใต้ PO นี้ (ทุก wave)',
    );
  }

  const [poSnap] = await Promise.all([getDoc(doc(db, 'purchase_orders', poId))]);
  if (!poSnap.exists()) throw new Error('ไม่พบ PO');
  const po = { ...poSnap.data(), id: poSnap.id } as PurchaseOrder;
  const waveCodeLabel = 'PO+งวด (รวม wave)';

  const vatPercent = await resolveVatPercent(db, po.customerId, po.contractId);
  const amountBeforeTax = roundMoney(gen.totalAmount);
  const vatAmount = roundMoney((amountBeforeTax * vatPercent) / 100);
  const totalAmount = roundMoney(amountBeforeTax + vatAmount);

  const lines: CommercialInvoiceLine[] = gen.lines.map((l, idx) => ({
    id: newLineId(),
    displayOrder: idx,
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
    waveId: PO_MONTH_WAVE_PLACEHOLDER,
    waveCode: waveCodeLabel,
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
    sourcePoMonthReviewId,
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
    entityLabel: `${invoiceNo} (PO+งวด)`,
    sourceModule: 'commercial_invoices',
    linkedIds: [po.customerId, poId],
    afterSummary: `สร้างใบแจ้งหนี้ (เรียกเก็บ) ${invoiceNo} จาก timesheet รวมราย PO+งวด`,
  });

  return { id: ref.id, invoiceNo };
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

  const lines: CommercialInvoiceLine[] = gen.lines.map((l, idx) => ({
    id: newLineId(),
    displayOrder: idx,
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
    afterSummary: `สร้างใบแจ้งหนี้ (เรียกเก็บ) ${invoiceNo}`,
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
  if (!snap.exists()) throw new Error('ไม่พบใบแจ้งหนี้');
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
  if (!snap.exists()) throw new Error('ไม่พบใบแจ้งหนี้');
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
    afterSummary: 'ส่งใบแจ้งหนี้ให้ลูกค้าตรวจสอบใน portal',
  });
}

function addDaysToHtmlDate(issueYmd: string, days: number): string {
  const ms = htmlDateValueToTimestampMs(issueYmd?.trim() || '');
  if (ms == null) return issueYmd;
  return timestampToHtmlDateValue(ms + days * 86400000);
}

/** รับตั้งลูกหนี้จากใบแจ้งหนี้เรียกเก็บ หลังลูกค้า/ฝ่าย OPEC ยืนยันยอด (ISSUED) */
export async function ensureAccountsReceivableForIssuedCommercial(
  db: Firestore,
  com: Pick<CommercialInvoice, 'id' | 'customerId' | 'invoiceNo' | 'totalAmount' | 'issueDate' | 'status'>,
  actor: User,
): Promise<void> {
  if (com.status !== 'ISSUED') return;
  const dup = await getDocs(
    query(
      collection(db, 'accounts_receivable'),
      where('referenceId', '==', com.id),
      where('referenceType', '==', 'COMMERCIAL_INVOICE' as const),
      limit(1),
    ),
  );
  if (!dup.empty) return;
  const documentNo = `AR-COM-${com.id}`;
  const dueYmd = addDaysToHtmlDate(com.issueDate, 30);
  await addDoc(
    collection(db, 'accounts_receivable'),
    sanitizeFirestorePayload({
      customerId: com.customerId,
      documentNo,
      referenceType: 'COMMERCIAL_INVOICE' as const,
      referenceId: com.id,
      referenceNo: com.invoiceNo,
      issueDate: com.issueDate,
      dueDate: dueYmd,
      debitAmount: com.totalAmount,
      creditAmount: 0,
      outstandingAmount: com.totalAmount,
      status: 'OPEN' as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

/** ลูกค้า: แจ้งชำระเงิน + URL แนบเอกสาร (หลังยืนยันยอด ISSUED) */
export async function reportCustomerPaymentForIssuedCommercial(
  db: Firestore,
  com: CommercialInvoice,
  actor: User,
  params: { proofUrl: string; fileName: string; contentType: string },
): Promise<void> {
  if (com.status !== 'ISSUED') {
    throw new Error('แจ้งชำระเงินได้หลังยืนยันยอดเรียกเก็บแล้ว (ISSUED) เท่านั้น');
  }
  if (com.opecPaymentVerifiedAt) {
    throw new Error('บัญชี OPEC รับรองรายการนี้แล้ว');
  }
  const now = Date.now();
  const ref = doc(db, 'commercial_invoices', com.id);
  await updateDoc(
    ref,
    sanitizeFirestorePayload({
      customerPaymentReportedAt: now,
      customerPaymentReportedByUid: actor.id,
      customerPaymentReportedByName: actor.displayName || actor.email || actor.id,
      customerPaymentProofUrl: params.proofUrl,
      customerPaymentProofFileName: params.fileName,
      updatedAt: now,
      updatedByUid: actor.id,
      updatedByName: actor.displayName || actor.email || actor.id,
    }),
  );
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

  await ensureAccountsReceivableForIssuedCommercial(
    db,
    {
      id: invoice.id,
      customerId: invoice.customerId,
      invoiceNo: invoice.invoiceNo,
      totalAmount: invoice.totalAmount,
      issueDate: invoice.issueDate,
      status: 'ISSUED',
    },
    actor,
  );
}

function normalizeDraftLines(lines: CommercialInvoiceLine[]): CommercialInvoiceLine[] {
  return lines.map((l, idx) => {
    const id = l.id || newLineId();
    const qty = roundMoney(Number(l.quantity) || 0);
    const unit = roundMoney(Number(l.unitPrice) || 0);
    const amount = roundMoney(qty * unit);
    return {
      ...l,
      id,
      displayOrder: idx,
      quantity: qty,
      unitPrice: unit,
      amount,
    };
  });
}

/** ยกเลิกใบแจ้งหนี้เมื่อคำนวณผิดหรือต้องสร้างใหม่ — ไม่ลบเอกสาร (VOID) */
export async function voidCommercialInvoice(
  db: Firestore,
  invoiceId: string,
  actor: User,
): Promise<void> {
  const ref = doc(db, 'commercial_invoices', invoiceId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('ไม่พบใบแจ้งหนี้');
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
    afterSummary: 'ยกเลิกใบแจ้งหนี้ (รอสร้างใหม่จากงวด / PO)',
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
  if (!snap.exists()) throw new Error('ไม่พบใบแจ้งหนี้');
  const cur = snap.data() as CommercialInvoice;

  await deleteDoc(ref);

  await writeAuditLog(db, actor, {
    actionType: 'DELETE',
    entityType: 'CommercialInvoice',
    entityId: invoiceId,
    entityLabel: cur.invoiceNo,
    sourceModule: 'commercial_invoices',
    linkedIds: [cur.customerId, cur.poId, cur.waveId],
    afterSummary: `ลบใบแจ้งหนี้ถาวร (สถานะเดิม ${cur.status})`,
  });
}

/** บันทึกรายการ + คำนวณยอดก่อน VAT / VAT / รวมใหม่ — เฉพาะ DRAFT */
export async function updateCommercialDraftInvoice(
  db: Firestore,
  invoiceId: string,
  nextLines: CommercialInvoiceLine[],
  actor: User,
  extra?: { notes?: string },
): Promise<void> {
  const ref = doc(db, 'commercial_invoices', invoiceId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('ไม่พบใบแจ้งหนี้');
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

  const payload: Record<string, unknown> = {
    lines: normalized,
    amountBeforeTax,
    vatAmount,
    totalAmount,
    updatedAt: now,
    updatedByUid: actor.id,
    updatedByName: actor.displayName || actor.email || actor.id,
  };
  if (extra && 'notes' in extra) {
    payload.notes = (extra.notes ?? '').trim();
  }

  await updateDoc(ref, sanitizeFirestorePayload(payload as Record<string, unknown>) as any);

  await writeAuditLog(db, actor, {
    actionType: 'UPDATE',
    entityType: 'CommercialInvoice',
    entityId: invoiceId,
    entityLabel: `${cur.invoiceNo} → แก้ไขรายการ`,
    sourceModule: 'commercial_invoices',
    linkedIds: [cur.customerId, cur.poId, cur.waveId],
    afterSummary: 'บันทึกการแก้ไขรายการใบแจ้งหนี้ (รวมส่วนลด/เพิ่ม)',
  });
}
