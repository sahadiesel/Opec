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
  TripBillingBatch,
  User,
  WaveMonthTimesheetReview,
  WorkerMonthTimesheetClosure,
} from '@/lib/types';
import {
  commercialInvoiceCoversAnyWorker,
  commercialInvoiceCoversWorkerSet,
  isPartialPoMonthCommercialInvoice,
  normalizeWorkerIdSet,
  partialPoMonthInvoiceLabel,
} from '@/lib/commercial/partial-po-month-billing';
import { resolveBillingMode } from '@/lib/commercial/resolve-billing-mode';
import { sellSnapshotForWorkMode } from '@/lib/commercial/position-rate-sell';
import { resolveWaveMonthPeriodBounds } from '@/lib/timesheet/wave-month-payroll-bridge';
import {
  poMonthTimesheetReviewDocId,
  resolvePoMonthPeriodBounds,
} from '@/lib/timesheet/po-month-timesheet-bridge';
import { fetchWorkerClosuresForPoMonth } from '@/lib/timesheet/worker-month-closure';
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue } from '@/lib/date-thai';
import { generateBillingLines, generateBillingLinesForMobCycles } from '@/lib/services/billing-line-generator';
import {
  markTripBatchInvoiced,
  releaseTripBillingBatchAfterInvoiceRemoved,
} from '@/lib/services/trip-billing-service';
import { resolveTripMobDemobLocationChoice } from '@/lib/services/trip-mob-demob-billing';
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

/** วางบิลรอบเดินทาง (trip batch — หลายคนต่อ invoice) */
export const TRIP_BILLING_WAVE_PLACEHOLDER = '__trip_batch__';

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

function isTripCommercialInvoice(cur: Pick<
  CommercialInvoice,
  'billingMode' | 'waveId' | 'sourceTripBillingBatchId' | 'memberMobCycleIds'
>): boolean {
  return (
    cur.billingMode === 'TRIP' ||
    cur.waveId === TRIP_BILLING_WAVE_PLACEHOLDER ||
    Boolean(cur.sourceTripBillingBatchId) ||
    (cur.memberMobCycleIds?.length ?? 0) > 0
  );
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

export async function findCommercialInvoiceByTripBatch(
  db: Firestore,
  batchId: string,
): Promise<{ id: string; invoiceNo: string } | null> {
  const q = query(collection(db, 'commercial_invoices'), where('sourceTripBillingBatchId', '==', batchId));
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
  if (isPartialPoMonthCommercialInvoice(inv)) return false;
  if (inv.sourcePoMonthReviewId === review.id) return true;
  const { start, end } = resolvePoMonthPeriodBounds(review);
  return (
    inv.poId === review.poId &&
    inv.waveId === PO_MONTH_WAVE_PLACEHOLDER &&
    inv.periodStart === start &&
    inv.periodEnd === end
  );
}

/** มีใบครอบคลุมทุกคนที่อนุมัติแล้วหรือใบเต็ม PO+งวด */
export function poMonthReviewMissingCommercialInvoice(
  review: PoMonthTimesheetReview,
  invoices: CommercialInvoice[],
  closures: WorkerMonthTimesheetClosure[] = [],
): boolean {
  const related = invoices.filter(
    (inv) =>
      inv.status !== 'VOID' &&
      inv.poId === review.poId &&
      inv.waveId === PO_MONTH_WAVE_PLACEHOLDER &&
      (inv.sourcePoMonthReviewId === review.id ||
        (inv.periodStart === resolvePoMonthPeriodBounds(review).start &&
          inv.periodEnd === resolvePoMonthPeriodBounds(review).end)),
  );
  const approved = closures.filter((c) => c.status === 'approved');
  if (approved.length === 0) {
    return !related.some((inv) => commercialInvoiceCoversPoMonthReview(inv, review));
  }
  return approved.some(
    (w) => !related.some((inv) => commercialInvoiceCoversAnyWorker(inv, w.workerId)),
  );
}

export function filterPoMonthReviewsMissingCommercialDraft(
  reviews: PoMonthTimesheetReview[],
  invoices: CommercialInvoice[],
  closuresByReviewId?: Map<string, WorkerMonthTimesheetClosure[]>,
): PoMonthTimesheetReview[] {
  return reviews.filter((r) => {
    const closures = closuresByReviewId?.get(r.id) ?? [];
    return poMonthReviewMissingCommercialInvoice(r, invoices, closures);
  });
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
      const unit = roundMoney(
        sellSnapshotForWorkMode(line, po.poWorkMode ?? 'OFFSHORE'),
      );
      const amount = roundMoney(qty * unit);
      const loc = (line.workLocation || '').trim();
      const unitLabel = line.billingUnitSnapshot || 'unit';
      const baseLabel = loc || 'PO Line';
      return {
        id: newLineId(),
        displayOrder: idx,
        description: unitLabel ? `${baseLabel} (${unitLabel})` : baseLabel,
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
      const description = remarks ? `${head} — ${remarks}` : head;
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
    if (isPartialPoMonthCommercialInvoice(x)) continue;
    if (x.periodStart === periodStart && x.periodEnd === periodEnd) {
      return { id: d.id, invoiceNo: String(x.invoiceNo || '') };
    }
  }
  return null;
}

async function listPoMonthCommercialInvoicesForPeriod(
  db: Firestore,
  poId: string,
  periodStart: string,
  periodEnd: string,
): Promise<CommercialInvoice[]> {
  const q = query(
    collection(db, 'commercial_invoices'),
    where('poId', '==', poId),
    where('waveId', '==', PO_MONTH_WAVE_PLACEHOLDER),
  );
  const snap = await getDocs(q);
  const out: CommercialInvoice[] = [];
  for (const d of snap.docs) {
    const x = { id: d.id, ...(d.data() as object) } as CommercialInvoice;
    if (x.status === 'VOID') continue;
    if (x.periodStart === periodStart && x.periodEnd === periodEnd) out.push(x);
  }
  return out;
}

function collectInvoicedWorkerIdsFromInvoices(invoices: CommercialInvoice[]): Set<string> {
  const out = new Set<string>();
  for (const inv of invoices) {
    if (isPartialPoMonthCommercialInvoice(inv)) {
      for (const wid of normalizeWorkerIdSet(inv.coveredWorkerIds ?? [])) out.add(wid);
    } else {
      for (const line of inv.lines ?? []) {
        const wid = String(line.workerId || '').trim();
        if (wid) out.add(wid);
      }
    }
  }
  return out;
}

async function findCommercialInvoiceForWorkerSet(
  db: Firestore,
  poId: string,
  periodStart: string,
  periodEnd: string,
  workerIds: readonly string[],
): Promise<{ id: string; invoiceNo: string } | null> {
  const list = await listPoMonthCommercialInvoicesForPeriod(db, poId, periodStart, periodEnd);
  for (const inv of list) {
    if (commercialInvoiceCoversWorkerSet(inv, workerIds)) {
      return { id: inv.id, invoiceNo: String(inv.invoiceNo || '') };
    }
  }
  return null;
}

async function findFullCommercialInvoiceByPoMonthReview(
  db: Firestore,
  reviewId: string,
): Promise<{ id: string; invoiceNo: string } | null> {
  const q = query(collection(db, 'commercial_invoices'), where('sourcePoMonthReviewId', '==', reviewId));
  const snap = await getDocs(q);
  for (const d of snap.docs) {
    const data = d.data() as CommercialInvoice;
    if (data.status === 'VOID') continue;
    if (isPartialPoMonthCommercialInvoice(data)) continue;
    return { id: d.id, invoiceNo: String(data.invoiceNo || '') };
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
  const poSnap = await getDoc(doc(db, 'purchase_orders', review.poId));
  if (poSnap.exists()) {
    const po = { id: poSnap.id, ...(poSnap.data() as object) } as PurchaseOrder;
    const mode = await resolveBillingMode(db, po);
    if (mode === 'TRIP') {
      return {
        ok: false,
        reason:
          'PO ใช้โหมดวางบิล TRIP — ออก invoice จากเมนู «ทำใบแจ้งหนี้แบบ Trip» หลังทุกคนในกลุ่ม demob (D1)',
      };
    }
  }

  const existing = await findFullCommercialInvoiceByPoMonthReview(db, review.id);
  if (existing?.id) {
    return { ok: false, reason: `มีใบแจ้งหนี้เต็ม PO+งวดแล้ว (${existing.invoiceNo || existing.id})` };
  }
  const { start, end } = resolvePoMonthPeriodBounds(review);
  const periodDup = await findCommercialInvoiceByPoMonthPeriodDup(db, review.poId, start, end);
  if (periodDup?.id) {
    return {
      ok: false,
      reason: `มีใบเต็ม PO+งวดในงวดนี้แล้ว (${periodDup.invoiceNo || periodDup.id}) — เปิดจากรายการด้านล่าง`,
    };
  }
  const existingInvoices = await listPoMonthCommercialInvoicesForPeriod(db, review.poId, start, end);
  const excludeWorkerIds = [...collectInvoicedWorkerIdsFromInvoices(existingInvoices)];
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
        excludeWorkerIds: excludeWorkerIds.length > 0 ? excludeWorkerIds : undefined,
      },
    );
    return { ok: true, id, invoiceNo };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: msg };
  }
}

/**
 * สร้างใบแจ้งหนี้จาก timesheet ในช่วงงวด PO+เดือน
 * — ดึงทุก `daily_timesheets` ที่ `readyForBilling` ใต้ PO ในช่วงงวด (ไม่กรอง wave)
 *   สอดคล้อง {@link markTimesheetsReadyForPayrollAfterPoMonthApproval} และตารางสรุปรายเดือน
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
    /** Partial billing — จำกัดเฉพาะคนงาน */
    workerIds?: string[];
    partialPoMonthBatchNo?: number;
    /** ไม่รวมคนที่ออก partial แล้ว (ใบเต็มที่เหลือ) */
    excludeWorkerIds?: string[];
  },
): Promise<{ id: string; invoiceNo: string }> {
  const { poId, periodStart, periodEnd, issueDate, actor, sourcePoMonthReviewId } = params;
  const currency = params.currency || 'THB';
  const workerIds = normalizeWorkerIdSet(params.workerIds ?? []);
  const isPartial = workerIds.length > 0;

  const gen = await generateBillingLines(db, poId, periodStart, periodEnd, undefined, {
    workerIds: isPartial ? workerIds : undefined,
    excludeWorkerIds: !isPartial ? params.excludeWorkerIds : undefined,
  });
  if (gen.lines.length === 0) {
    throw new Error(
      'ไม่มีรายการจาก timesheet — ตรวจช่วงงวด / สถานะ readyForBilling ของ timesheet ใต้ PO นี้ (ทุก wave)',
    );
  }

  const [poSnap] = await Promise.all([getDoc(doc(db, 'purchase_orders', poId))]);
  if (!poSnap.exists()) throw new Error('ไม่พบ PO');
  const po = { ...poSnap.data(), id: poSnap.id } as PurchaseOrder;
  const waveCodeLabel = isPartial
    ? partialPoMonthInvoiceLabel(params.partialPoMonthBatchNo, workerIds.length)
    : 'PO+งวด (รวม wave)';

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
    ...(isPartial
      ? {
          coveredWorkerIds: workerIds,
          partialPoMonthBatchNo: params.partialPoMonthBatchNo,
        }
      : {}),
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
    afterSummary: `สร้างใบแจ้งหนี้ (เรียกเก็บ) ${invoiceNo} จาก timesheet รวมราย PO+งวด${isPartial ? ' (บางส่วน)' : ''}`,
  });

  return { id: ref.id, invoiceNo };
}

/**
 * หลัง manager อนุมัติรายคน — สร้าง draft invoice อัตโนมัติเมื่อครบทุกคนใน batch (closureBatchNo เดียวกัน)
 */
export async function tryEnsurePartialCommercialDraftForCompletedBatch(
  db: Firestore,
  poId: string,
  yearMonth: string,
  actor: User,
): Promise<
  | { kind: 'created'; id: string; invoiceNo: string; workerCount: number }
  | { kind: 'skipped'; reason: string }
  | { kind: 'waiting_batch'; reason: string }
> {
  const pid = poId.trim();
  const ym = yearMonth.trim();
  if (!pid || !/^\d{4}-\d{2}$/.test(ym)) {
    return { kind: 'skipped', reason: 'PO หรือเดือนไม่ถูกต้อง' };
  }

  const poSnap = await getDoc(doc(db, 'purchase_orders', pid));
  if (!poSnap.exists()) return { kind: 'skipped', reason: 'ไม่พบ PO' };
  const po = { id: poSnap.id, ...(poSnap.data() as object) } as PurchaseOrder;
  const mode = await resolveBillingMode(db, po);
  if (mode === 'TRIP') {
    return {
      kind: 'skipped',
      reason: 'PO ใช้โหมด TRIP — ออก invoice จากเมนู Trip Billing',
    };
  }

  const closures = await fetchWorkerClosuresForPoMonth(db, pid, ym);
  if (closures.length === 0) {
    return { kind: 'skipped', reason: 'ไม่มี worker closure — ใช้โหมดใบเต็ม PO+งวด' };
  }

  const reviewId = poMonthTimesheetReviewDocId(pid, ym);
  const reviewSnap = await getDoc(doc(db, 'po_month_timesheet_reviews', reviewId));
  const review: PoMonthTimesheetReview = reviewSnap.exists()
    ? ({ id: reviewId, ...(reviewSnap.data() as object) } as PoMonthTimesheetReview)
    : ({ id: reviewId, poId: pid, yearMonth: ym } as PoMonthTimesheetReview);
  const { start, end } = resolvePoMonthPeriodBounds(review);

  const batchNos: number[] = [
    ...new Set(
      closures
        .map((c) => c.closureBatchNo)
        .filter((n): n is number => typeof n === 'number' && n > 0),
    ),
  ].sort((a, b) => a - b);

  let waitingReason: string | null = null;
  for (const batchNo of batchNos) {
    const inBatch = closures.filter((c) => c.closureBatchNo === batchNo);
    if (inBatch.length === 0) continue;
    const allApproved = inBatch.every((c) => c.status === 'approved');
    if (!allApproved) {
      const pending = inBatch.filter((c) => c.status !== 'approved').length;
      waitingReason = `รอบ ${batchNo}: อนุมัติแล้ว ${inBatch.length - pending}/${inBatch.length} คน — ครบทุกคนในรอบจึงสร้าง invoice`;
      continue;
    }
    const workerIds = normalizeWorkerIdSet(inBatch.map((c) => c.workerId));
    const dup = await findCommercialInvoiceForWorkerSet(db, pid, start, end, workerIds);
    if (dup?.id) continue;

    const issueDate = timestampToHtmlDateValue(Date.now());
    const workerNames = inBatch
      .map((c) => c.workerName || c.workerId)
      .filter(Boolean)
      .join(', ');
    try {
      const { id, invoiceNo } = await createCommercialDraftInvoiceForPoMonth(db, {
        poId: pid,
        periodStart: start,
        periodEnd: end,
        issueDate,
        actor,
        sourcePoMonthReviewId: reviewId,
        workerIds,
        partialPoMonthBatchNo: batchNo,
        notes: workerNames ? `Partial billing รอบ ${batchNo}: ${workerNames}` : undefined,
      });
      return { kind: 'created', id, invoiceNo, workerCount: workerIds.length };
    } catch (e: unknown) {
      return { kind: 'skipped', reason: e instanceof Error ? e.message : String(e) };
    }
  }
  if (waitingReason) {
    return { kind: 'waiting_batch', reason: waitingReason };
  }

  const approvedSingles = closures.filter(
    (c) => c.status === 'approved' && (c.closureBatchNo == null || c.closureBatchNo <= 0),
  );
  if (approvedSingles.length > 0) {
    for (const c of approvedSingles) {
      const workerIds = [c.workerId];
      const dup = await findCommercialInvoiceForWorkerSet(db, pid, start, end, workerIds);
      if (dup?.id) continue;
      try {
        const { id, invoiceNo } = await createCommercialDraftInvoiceForPoMonth(db, {
          poId: pid,
          periodStart: start,
          periodEnd: end,
          issueDate: timestampToHtmlDateValue(Date.now()),
          actor,
          sourcePoMonthReviewId: reviewId,
          workerIds,
          notes: c.workerName ? `Partial: ${c.workerName}` : undefined,
        });
        return { kind: 'created', id, invoiceNo, workerCount: 1 };
      } catch (e: unknown) {
        return { kind: 'skipped', reason: e instanceof Error ? e.message : String(e) };
      }
    }
  }

  return { kind: 'skipped', reason: 'ไม่มี batch ที่พร้อมสร้าง invoice (หรือออกใบแล้ว)' };
}

/**
 * สร้าง draft invoice partial ด้วยมือ — สำหรับคนงานที่อนุมัติแล้วแต่ auto-create ไม่ทำงาน
 */
export async function ensureCommercialDraftInvoiceForWorkerSet(
  db: Firestore,
  params: {
    poId: string;
    yearMonth: string;
    workerIds: string[];
    actor: User;
    partialPoMonthBatchNo?: number;
  },
): Promise<{ ok: true; id: string; invoiceNo: string } | { ok: false; reason: string }> {
  const pid = params.poId.trim();
  const ym = params.yearMonth.trim();
  const workerIds = normalizeWorkerIdSet(params.workerIds);
  if (!pid || !/^\d{4}-\d{2}$/.test(ym) || workerIds.length === 0) {
    return { ok: false, reason: 'PO / เดือน / รายชื่อคนงานไม่ครบ' };
  }

  const poSnap = await getDoc(doc(db, 'purchase_orders', pid));
  if (!poSnap.exists()) return { ok: false, reason: 'ไม่พบ PO' };
  const po = { id: poSnap.id, ...(poSnap.data() as object) } as PurchaseOrder;
  const mode = await resolveBillingMode(db, po);
  if (mode === 'TRIP') {
    return { ok: false, reason: 'PO ใช้โหมด TRIP — ออก invoice จาก Trip Billing' };
  }

  const reviewId = poMonthTimesheetReviewDocId(pid, ym);
  const reviewSnap = await getDoc(doc(db, 'po_month_timesheet_reviews', reviewId));
  const review: PoMonthTimesheetReview = reviewSnap.exists()
    ? ({ id: reviewId, ...(reviewSnap.data() as object) } as PoMonthTimesheetReview)
    : ({ id: reviewId, poId: pid, yearMonth: ym } as PoMonthTimesheetReview);
  const { start, end } = resolvePoMonthPeriodBounds(review);

  const closures = await fetchWorkerClosuresForPoMonth(db, pid, ym);
  const notApproved = workerIds.filter((wid) => {
    const c = closures.find((x) => x.workerId === wid);
    return !c || c.status !== 'approved';
  });
  if (notApproved.length > 0) {
    return {
      ok: false,
      reason: `มี ${notApproved.length} คนที่ยังไม่ได้รับการอนุมัติจาก manager — ต้องอนุมัติก่อนวางบิล`,
    };
  }

  const dup = await findCommercialInvoiceForWorkerSet(db, pid, start, end, workerIds);
  if (dup?.id) {
    return { ok: false, reason: `มีใบแจ้งหนี้ชุดนี้แล้ว (${dup.invoiceNo || dup.id})` };
  }

  const issueDate = timestampToHtmlDateValue(Date.now());
  const names = workerIds
    .map((wid) => closures.find((c) => c.workerId === wid)?.workerName || wid)
    .join(', ');
  try {
    const { id, invoiceNo } = await createCommercialDraftInvoiceForPoMonth(db, {
      poId: pid,
      periodStart: start,
      periodEnd: end,
      issueDate,
      actor: params.actor,
      sourcePoMonthReviewId: reviewId,
      workerIds,
      partialPoMonthBatchNo: params.partialPoMonthBatchNo,
      notes: names ? `Partial (manual): ${names}` : undefined,
    });
    return { ok: true, id, invoiceNo };
  } catch (e: unknown) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * สร้างใบแจ้งหนี้จาก trip billing batch — หลายคน (mob cycles) ต่อ invoice เดียว
 */
export async function createCommercialDraftInvoiceForTripBatch(
  db: Firestore,
  batch: TripBillingBatch,
  actor: User,
  issueDate?: string,
  options?: { tripMobDemobLocationKey?: string },
): Promise<{ id: string; invoiceNo: string }> {
  const periodStart = batch.periodStart;
  const periodEnd = batch.periodEnd;
  if (!periodEnd) {
    throw new Error('ชุดวางบิลยังไม่ครบ D1 ทุกคน — ไม่สามารถออก invoice');
  }

  const poSnapEarly = await getDoc(doc(db, 'purchase_orders', batch.poId));
  if (!poSnapEarly.exists()) throw new Error('ไม่พบ PO');
  const poEarly = { ...poSnapEarly.data(), id: poSnapEarly.id } as PurchaseOrder;

  let tripMobDemobLocationKey = (options?.tripMobDemobLocationKey || '').trim() || undefined;
  if (poEarly.contractId) {
    const mcSnap = await getDoc(doc(db, 'main_contracts', poEarly.contractId));
    if (mcSnap.exists()) {
      const mc = mcSnap.data() as MainContract;
      if (mc.tripBillMobDemobFee) {
        const choice = await resolveTripMobDemobLocationChoice(
          db,
          poEarly.contractId,
          batch.memberMobCycleIds,
        );
        if (choice.kind === 'error') throw new Error(choice.message);
        if (choice.kind === 'prompt' && !tripMobDemobLocationKey) {
          throw new Error('ต้องเลือกจุด Mob/Demob ก่อนสร้าง invoice');
        }
        if (!tripMobDemobLocationKey && choice.kind === 'auto') {
          tripMobDemobLocationKey = choice.mobLocationKey;
        }
      }
    }
  }

  const gen = await generateBillingLinesForMobCycles(
    db,
    batch.poId,
    batch.memberMobCycleIds,
    periodStart,
    periodEnd,
    tripMobDemobLocationKey ? { tripMobDemobLocationKey } : undefined,
  );
  if (gen.lines.length === 0) {
    throw new Error(
      'ไม่มีรายการจาก timesheet — ตรวจว่าอนุมัติชุดวางบิลแล้วและ timesheet มี readyForBilling',
    );
  }
  if (tripMobDemobLocationKey) {
    const hasMobLine = gen.lines.some((l) => l.eventType === 'trip_mob_demob_round_trip');
    if (!hasMobLine) {
      throw new Error(
        'สัญญากำหนดให้คิดค่า MOB แต่ไม่สร้างบรรทัดได้ — ตรวจอัตรา Mob/Demob ในตารางราคาสัญญา',
      );
    }
  }

  const poSnap = await getDoc(doc(db, 'purchase_orders', batch.poId));
  if (!poSnap.exists()) throw new Error('ไม่พบ PO');
  const po = { ...poSnap.data(), id: poSnap.id } as PurchaseOrder;

  const waveCodeLabel = `รอบเดินทาง · M1 ${batch.tripAnchorStartDate}`;

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
    poId: batch.poId,
    waveId: TRIP_BILLING_WAVE_PLACEHOLDER,
    waveCode: waveCodeLabel,
    periodStart,
    periodEnd,
    issueDate: issueDate || timestampToHtmlDateValue(now),
    currency: 'THB',
    vatPercent,
    amountBeforeTax,
    vatAmount,
    withholdingTaxAmount: 0,
    totalAmount,
    lines,
    generationWarnings: gen.warnings,
    timesheetCount: gen.timesheetCount,
    billingMode: 'TRIP',
    sourceTripBillingBatchId: batch.id,
    memberMobCycleIds: batch.memberMobCycleIds,
    memberWorkerNames: batch.memberWorkerNames,
    ...(tripMobDemobLocationKey ? { tripMobDemobLocationKey } : {}),
    createdAt: now,
    createdByUid: actor.id,
    createdByName: actor.displayName,
    updatedAt: now,
  };

  const ref = await addDoc(
    collection(db, 'commercial_invoices'),
    sanitizeFirestorePayload(payload as Record<string, unknown>),
  );

  await markTripBatchInvoiced(db, batch.id, ref.id);

  await writeAuditLog(db, actor, {
    actionType: 'CREATE_COMMERCIAL_INVOICE',
    entityType: 'CommercialInvoice',
    entityId: ref.id,
    entityLabel: `${invoiceNo} (Trip batch)`,
    sourceModule: 'commercial_invoices',
    linkedIds: [po.customerId, batch.poId, batch.id],
    afterSummary: `สร้างใบแจ้งหนี้ ${invoiceNo} จาก trip batch (${batch.memberMobCycleIds.length} คน)`,
  });

  return { id: ref.id, invoiceNo };
}

export async function ensureCommercialDraftInvoiceForTripBatch(
  db: Firestore,
  batch: TripBillingBatch,
  actor: User,
  options?: { tripMobDemobLocationKey?: string },
): Promise<{ ok: true; id: string; invoiceNo: string } | { ok: false; reason: string }> {
  if (batch.status !== 'approved') {
    return { ok: false, reason: 'ชุดวางบิลยังไม่ได้อนุมัติ — กด «อนุมัติวางบิล» ก่อนสร้าง invoice' };
  }
  const existing = await findCommercialInvoiceByTripBatch(db, batch.id);
  if (existing?.id) {
    return { ok: false, reason: `มีใบแจ้งหนี้แล้ว (${existing.invoiceNo || existing.id})` };
  }
  try {
    const { id, invoiceNo } = await createCommercialDraftInvoiceForTripBatch(
      db,
      batch,
      actor,
      undefined,
      options,
    );
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

/** @deprecated ไม่ใช้แล้ว — ลูกหนี้ตั้งเมื่อออกใบกำกับภาษี (ISSUED) เท่านั้น; คงไว้สำหรับ migration/legacy */
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

  /** ลูกหนี้ตั้งเมื่อออกใบกำกับภาษี (ISSUED) เท่านั้น — ไม่สร้าง AR-COM ตอนยืนยันใบเรียกเก็บ */
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

  if (cur.sourceTripBillingBatchId) {
    await releaseTripBillingBatchAfterInvoiceRemoved(db, cur.sourceTripBillingBatchId);
  }
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

  if (cur.sourceTripBillingBatchId) {
    await releaseTripBillingBatchAfterInvoiceRemoved(db, cur.sourceTripBillingBatchId);
  }

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

/**
 * ดึงบรรทัดจาก timesheet ใหม่ — เฉพาะ DRAFT ที่มาจาก timesheet (ไม่ใช่ PO ใบเสนอราคา)
 * รักษาบรรทัด `lineSource: manual` (ส่วนลด/ค่าเพิ่ม) ไว้ต่อท้าย
 */
export async function regenerateCommercialDraftInvoiceFromTimesheets(
  db: Firestore,
  invoiceId: string,
  actor: User,
): Promise<{ lineCount: number; timesheetCount: number }> {
  const ref = doc(db, 'commercial_invoices', invoiceId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('ไม่พบใบแจ้งหนี้');
  const cur = snap.data() as CommercialInvoice;
  if (cur.status !== 'DRAFT') {
    throw new Error('ดึงรายการใหม่ได้เฉพาะใบสถานะ DRAFT (ตรวจภายใน)');
  }
  if (cur.waveId === QUOTATION_PO_WAVE_PLACEHOLDER) {
    throw new Error('ใบจาก PO ใบเสนอราคาไม่มี timesheet — ไม่สามารถดึงใหม่ได้');
  }
  if (!cur.poId?.trim() || !cur.periodStart || !cur.periodEnd) {
    throw new Error('ใบแจ้งหนี้ไม่มี PO หรือช่วงงวด');
  }

  const isPoMonth = cur.waveId === PO_MONTH_WAVE_PLACEHOLDER;
  const isTrip = isTripCommercialInvoice(cur);

  let gen: Awaited<ReturnType<typeof generateBillingLines>>;
  let tripMobDemobLocationKey = (cur.tripMobDemobLocationKey || '').trim() || undefined;

  if (isTrip) {
    let mobCycleIds = cur.memberMobCycleIds ?? [];
    if (mobCycleIds.length === 0 && cur.sourceTripBillingBatchId) {
      const batchSnap = await getDoc(
        doc(db, 'trip_billing_batches', cur.sourceTripBillingBatchId),
      );
      if (batchSnap.exists()) {
        mobCycleIds = (batchSnap.data() as TripBillingBatch).memberMobCycleIds ?? [];
      }
    }
    if (mobCycleIds.length === 0) {
      throw new Error(
        'ใบ Trip billing ไม่มี memberMobCycleIds — ยกเลิกแล้วสร้าง invoice ใหม่จากหน้า Trip Billing',
      );
    }
    const poSnap = await getDoc(doc(db, 'purchase_orders', cur.poId));
    const contractId = poSnap.exists()
      ? String((poSnap.data() as PurchaseOrder).contractId || '').trim()
      : '';
    if (contractId && !tripMobDemobLocationKey) {
      const choice = await resolveTripMobDemobLocationChoice(db, contractId, mobCycleIds);
      if (choice.kind === 'auto') {
        tripMobDemobLocationKey = choice.mobLocationKey;
      } else if (choice.kind === 'error') {
        throw new Error(choice.message);
      } else if (choice.kind === 'prompt') {
        throw new Error(
          'สัญญามีหลายจุด Mob/Demob — ยกเลิกใบนี้แล้วสร้างใหม่จาก Trip Billing เพื่อเลือกจุดค่า MOB',
        );
      }
    }
    gen = await generateBillingLinesForMobCycles(
      db,
      cur.poId,
      mobCycleIds,
      cur.periodStart,
      cur.periodEnd,
      tripMobDemobLocationKey ? { tripMobDemobLocationKey } : undefined,
    );
  } else {
    const partialWorkers = normalizeWorkerIdSet(cur.coveredWorkerIds ?? []);
    gen = await generateBillingLines(
      db,
      cur.poId,
      cur.periodStart,
      cur.periodEnd,
      isPoMonth ? undefined : cur.waveId,
      partialWorkers.length > 0 ? { workerIds: partialWorkers } : undefined,
    );
  }

  if (gen.lines.length === 0) {
    throw new Error(
      isTrip
        ? 'ไม่มีรายการจาก timesheet — ตรวจ mob cycle / readyForBilling / อนุมัติชุดวางบิล'
        : isPoMonth
          ? 'ไม่มีรายการจาก timesheet — ตรวจช่วงงวด / readyForBilling ของ timesheet ใต้ PO นี้ (ทุก wave)'
          : 'ไม่มีรายการจาก timesheet — ตรวจช่วงวันที่ / wave / สถานะ readyForBilling',
    );
  }

  const manualLines = (cur.lines ?? []).filter((l) => l.lineSource === 'manual');
  const timesheetLines: CommercialInvoiceLine[] = gen.lines.map((l, idx) => ({
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

  const merged = normalizeDraftLines([...timesheetLines, ...manualLines]);
  const amountBeforeTax = roundMoney(merged.reduce((s, x) => s + x.amount, 0));
  const vp = Number(cur.vatPercent) || 0;
  const vatAmount = roundMoney((amountBeforeTax * vp) / 100);
  const totalAmount = roundMoney(amountBeforeTax + vatAmount);
  const now = Date.now();

  const payload: Record<string, unknown> = {
    lines: merged,
    amountBeforeTax,
    vatAmount,
    totalAmount,
    generationWarnings: gen.warnings,
    timesheetCount: gen.timesheetCount,
    updatedAt: now,
    updatedByUid: actor.id,
    updatedByName: actor.displayName || actor.email || actor.id,
  };
  if (isPoMonth) {
    payload.waveCode = 'PO+งวด (รวม wave)';
  }
  if (isTrip) {
    if (tripMobDemobLocationKey) {
      payload.tripMobDemobLocationKey = tripMobDemobLocationKey;
    }
    const mobIds = cur.memberMobCycleIds?.length
      ? cur.memberMobCycleIds
      : undefined;
    if (!mobIds?.length && cur.sourceTripBillingBatchId) {
      const batchSnap = await getDoc(
        doc(db, 'trip_billing_batches', cur.sourceTripBillingBatchId),
      );
      if (batchSnap.exists()) {
        const fromBatch = (batchSnap.data() as TripBillingBatch).memberMobCycleIds ?? [];
        if (fromBatch.length > 0) {
          payload.memberMobCycleIds = fromBatch;
        }
      }
    }
  }

  await updateDoc(ref, sanitizeFirestorePayload(payload) as Record<string, unknown>);

  await writeAuditLog(db, actor, {
    actionType: 'UPDATE',
    entityType: 'CommercialInvoice',
    entityId: invoiceId,
    entityLabel: `${cur.invoiceNo} → ดึงจาก timesheet ใหม่`,
    sourceModule: 'commercial_invoices',
    linkedIds: [cur.customerId, cur.poId, cur.waveId],
    afterSummary: `ดึงรายการจาก timesheet ใหม่ (${gen.timesheetCount} แถว → ${timesheetLines.length} บรรทัดวางบิล)`,
  });

  return { lineCount: merged.length, timesheetCount: gen.timesheetCount };
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
