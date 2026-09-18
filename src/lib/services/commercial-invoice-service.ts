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
  CommercialInvoiceAttachment,
  CommercialInvoiceLine,
  MainContract,
  POLine,
  PoMonthTimesheetReview,
  PurchaseOrder,
  Quotation,
  QuotationLine,
  MobCycleBillingReview,
  TripBillingBatch,
  User,
  WaveMonthTimesheetReview,
  WorkerMonthTimesheetClosure,
} from '@/lib/types';
import { MAX_COMMERCIAL_INVOICE_ATTACHMENTS } from '@/lib/storage/commercial-invoice-attachments';
import {
  commercialInvoiceCoversAnyWorker,
  commercialInvoiceCoversWorkerSet,
  isPartialPoMonthCommercialInvoice,
  normalizeWorkerIdSet,
  partialPoMonthInvoiceLabel,
} from '@/lib/commercial/partial-po-month-billing';
import {
  commercialInvoiceRevisionNoOf,
  formatCommercialInvoiceRevisionNo,
  isCommercialInvoiceLatestEditable,
  isCommercialInvoiceSuperseded,
  parseCommercialInvoiceBaseNo,
} from '@/lib/commercial/commercial-invoice-revision';
import { resolveBillingMode } from '@/lib/commercial/resolve-billing-mode';
import { sellSnapshotForWorkMode } from '@/lib/commercial/position-rate-sell';
import { resolveWaveMonthPeriodBounds } from '@/lib/timesheet/wave-month-payroll-bridge';
import {
  poMonthTimesheetReviewDocId,
  resolvePoMonthPeriodBounds,
} from '@/lib/timesheet/po-month-timesheet-bridge';
import { fetchWorkerClosuresForPoMonth, markClosureRangesBilled, releaseClosureRangesBilledByInvoice, stripBilledInvoiceIds } from '@/lib/timesheet/worker-month-closure';
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue } from '@/lib/date-thai';
import {
  generateBillingLines,
  generateBillingLinesForMobCycles,
  type GeneratedBillingLine,
} from '@/lib/services/billing-line-generator';
import {
  approveTripBillingBatch,
  isStandbyOnlyClosedTripBatch,
  markTripBatchInvoiced,
  releaseTripBillingBatchAfterInvoiceRemoved,
} from '@/lib/services/trip-billing-service';
import {
  loadTripMobDemobMembers,
  resolveTripMobDemobLocationChoice,
  type TripMobDemobLocationOption,
} from '@/lib/services/trip-mob-demob-billing';
import { collapseSameLocationMobDemobLines } from '@/lib/commercial/mob-demob-invoice-lines';
import { generateNextDocumentCode } from '@/lib/services/numbering-service';
import { sanitizeFirestorePayload } from '@/lib/utils';

async function stampCommercialInvoiceRevisionRoot(
  db: Firestore,
  invoiceId: string,
  invoiceNo: string,
): Promise<void> {
  await updateDoc(doc(db, 'commercial_invoices', invoiceId), {
    revisionRootId: invoiceId,
    baseInvoiceNo: parseCommercialInvoiceBaseNo(invoiceNo) || invoiceNo,
    revisionNo: 0,
  } as any);
}
import { writeAuditLog } from '@/lib/services/audit-service';

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function assertPurchaseOrderActiveForInvoice(po: Pick<PurchaseOrder, 'status' | 'poCode'>): void {
  if ((po.status || '') !== 'active') {
    throw new Error(
      `ใบสั่งซื้อ ${po.poCode || ''} สถานะ Pending ยังออกใบแจ้งหนี้ไม่ได้ — อนุมัติเป็น Active ก่อน`,
    );
  }
}

function newLineId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function computeCommercialInvoiceVatTotals(
  amountBeforeTax: number,
  vatPercent: number,
): { amountBeforeTax: number; vatAmount: number; totalAmount: number } {
  const abt = roundMoney(amountBeforeTax);
  const vatAmount = roundMoney((abt * vatPercent) / 100);
  const totalAmount = roundMoney(abt + vatAmount);
  return { amountBeforeTax: abt, vatAmount, totalAmount };
}

function mapGeneratedBillingLinesToInvoiceLines(
  lines: GeneratedBillingLine[],
): CommercialInvoiceLine[] {
  return collapseSameLocationMobDemobLines(lines).map((l, idx) => ({
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
}

/** Caller-prepared draft body — core fills invoiceNo / DRAFT / created* / updatedAt */
type CommercialDraftInvoiceFields = Omit<
  CommercialInvoice,
  'id' | 'invoiceNo' | 'status' | 'createdAt' | 'createdByUid' | 'createdByName' | 'updatedAt'
>;

/**
 * Shared Firestore write for commercial DRAFT invoices:
 * document number → addDoc → revision stamp → optional afterPersist → audit.
 * Rate / line generation stays in callers.
 */
async function writeCommercialDraftInvoiceCore(
  db: Firestore,
  actor: User,
  params: {
    fields: CommercialDraftInvoiceFields;
    auditEntityLabel: (invoiceNo: string) => string;
    auditLinkedIds: string[];
    auditAfterSummary: (invoiceNo: string) => string;
    afterPersist?: (created: { id: string; invoiceNo: string }) => Promise<void>;
  },
): Promise<{ id: string; invoiceNo: string }> {
  const { code: invoiceNo } = await generateNextDocumentCode(db, 'commercial_invoice', {
    actor: actor.displayName,
    userId: actor.id,
  });

  const now = Date.now();
  const payload: Omit<CommercialInvoice, 'id'> = {
    ...params.fields,
    invoiceNo,
    status: 'DRAFT',
    createdAt: now,
    createdByUid: actor.id,
    createdByName: actor.displayName,
    updatedAt: now,
  };

  const ref = await addDoc(
    collection(db, 'commercial_invoices'),
    sanitizeFirestorePayload(payload as Record<string, unknown>),
  );

  await stampCommercialInvoiceRevisionRoot(db, ref.id, invoiceNo);

  if (params.afterPersist) {
    await params.afterPersist({ id: ref.id, invoiceNo });
  }

  await writeAuditLog(db, actor, {
    actionType: 'CREATE_COMMERCIAL_INVOICE',
    entityType: 'CommercialInvoice',
    entityId: ref.id,
    entityLabel: params.auditEntityLabel(invoiceNo),
    sourceModule: 'commercial_invoices',
    linkedIds: params.auditLinkedIds,
    afterSummary: params.auditAfterSummary(invoiceNo),
  });

  return { id: ref.id, invoiceNo };
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
 * - Path **wave+เดือน** / `sourceWaveMonthReviewId` ยังใช้ได้เมื่องวดนั้น “มี effective wave ตัวเดียว” หรือเป็น history — ใบ
 *   `ISSUED` ยกเลิก (VOID) ได้เมื่อยังไม่มีใบกำกับภาษีที่ใช้งาน หรือยกเลิกใบกำกับแล้ว; ราย DRAFT อาจ void แล้วสร้างใหม่จาก PO+เดือนตาม runbook
 */
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
    if (data.status !== 'VOID' && !isCommercialInvoiceSuperseded(data)) {
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
    if (data.status !== 'VOID' && !isCommercialInvoiceSuperseded(data)) {
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
    if (data.status !== 'VOID' && !isCommercialInvoiceSuperseded(data)) {
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
  if (isCommercialInvoiceSuperseded(inv)) return false;
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
  if (isCommercialInvoiceSuperseded(inv)) return false;
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
  const { start, end } = resolvePoMonthPeriodBounds(review);
  const related = invoices.filter(
    (inv) =>
      inv.status !== 'VOID' &&
      !isCommercialInvoiceSuperseded(inv) &&
      inv.poId === review.poId &&
      (inv.sourcePoMonthReviewId === review.id ||
        (inv.periodStart &&
          inv.periodEnd &&
          inv.periodStart <= end &&
          inv.periodEnd >= start)),
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
    if (isCommercialInvoiceSuperseded(x)) continue;
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
    if (isCommercialInvoiceSuperseded(x)) continue;
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
  assertPurchaseOrderActiveForInvoice(po);
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
  const totals = computeCommercialInvoiceVatTotals(amountBeforeTax, vatPercent);

  const linkedIds = [po.customerId, poId, quotationIdRef || undefined].filter(Boolean) as string[];

  return writeCommercialDraftInvoiceCore(db, actor, {
    fields: {
      customerId: po.customerId,
      contractId: po.contractId || undefined,
      poId,
      waveId: QUOTATION_PO_WAVE_PLACEHOLDER,
      periodStart,
      periodEnd,
      issueDate,
      currency,
      vatPercent,
      ...totals,
      withholdingTaxAmount: 0,
      lines,
      generationWarnings,
      timesheetCount: 0,
      notes: params.notes,
    },
    auditEntityLabel: (invoiceNo) => `${invoiceNo} (PO ใบเสนอราคา)`,
    auditLinkedIds: linkedIds,
    auditAfterSummary: (invoiceNo) =>
      `สร้างใบแจ้งหนี้ (เรียกเก็บ) ${invoiceNo} จาก ${auditLineSource}`,
  });
}

export type InvoiceReadyWorker = {
  key: string;
  kind: 'monthly' | 'trip';
  poId: string;
  poCode: string;
  workerId: string;
  workerName: string;
  yearMonth: string;
  tripBatchId?: string;
  detail: string;
};

async function detachRangesBilledByInactiveInvoices(
  db: Firestore,
  closures: WorkerMonthTimesheetClosure[],
): Promise<WorkerMonthTimesheetClosure[]> {
  const ids = new Set<string>();
  for (const c of closures) {
    for (const r of c.closedDateRanges ?? []) {
      const id = String(r.billedInvoiceId || '').trim();
      if (id) ids.add(id);
    }
  }
  if (ids.size === 0) return closures;
  const dead = new Set<string>();
  await Promise.all(
    [...ids].map(async (id) => {
      const snap = await getDoc(doc(db, 'commercial_invoices', id));
      const status = snap.exists() ? String((snap.data() as CommercialInvoice).status || '') : 'MISSING';
      if (!snap.exists() || status === 'VOID' || status === 'REVISED') dead.add(id);
    }),
  );
  if (dead.size === 0) return closures;
  try {
    await stripBilledInvoiceIds(db, closures, dead);
  } catch {
    /* ถ้าเขียนกลับไม่ได้ ยังแสดงรายชื่อจากหน่วยความจำ */
  }
  return closures.map((c) => ({
    ...c,
    closedDateRanges: (c.closedDateRanges ?? []).map((r) => {
      if (!r.billedInvoiceId || !dead.has(r.billedInvoiceId)) return r;
      const { billedInvoiceId: _drop, ...rest } = r;
      return rest;
    }),
  }));
}

function reviewOverlapsYearMonth(review: MobCycleBillingReview, ym: string): boolean {
  if ((review.spansYearMonths ?? []).includes(ym)) return true;
  const start = String(review.tripStartDate || review.tripAnchorStartDate || '').slice(0, 7);
  const end = String(review.tripEndDate || review.tripStartDate || review.tripAnchorStartDate || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(start)) return false;
  const endYm = /^\d{4}-\d{2}$/.test(end) ? end : start;
  return start <= ym && endYm >= ym;
}

async function loadMobReviewsForPo(db: Firestore, poId: string): Promise<MobCycleBillingReview[]> {
  const snap = await getDocs(query(collection(db, 'mob_cycle_billing_reviews'), where('poId', '==', poId)));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) } as MobCycleBillingReview));
}

/** สัญญา/PO แบบ Trip — จับคนที่ส่งรอออกบิลเข้าชุด M1→D1 ไม่สร้างใบแบบรายเดือน */
async function tripWorkersFromReviews(
  db: Firestore,
  po: PurchaseOrder,
  yearMonth: string,
  people: Array<{ workerId: string; workerName: string }>,
): Promise<InvoiceReadyWorker[]> {
  let reviews = await loadMobReviewsForPo(db, po.id);
  const ids = new Set(people.map((p) => p.workerId));
  const hasBatch = reviews.some(
    (r) => ids.has(r.workerId) && r.status !== 'void' && !!r.tripBillingBatchId && reviewOverlapsYearMonth(r, yearMonth),
  );
  if (!hasBatch) {
    try {
      const { syncMobCycleBillingReviewsForPo } = await import('@/lib/services/mob-cycle-billing-sync');
      await syncMobCycleBillingReviewsForPo(db, po);
      reviews = await loadMobReviewsForPo(db, po.id);
    } catch {
      /* ถ้าซิงก์ไม่ได้ ใช้รีวิวที่มีอยู่ */
    }
  }
  const out: InvoiceReadyWorker[] = [];
  const seen = new Set<string>();
  for (const person of people) {
    const rows = reviews.filter(
      (r) =>
        r.workerId === person.workerId &&
        r.status !== 'void' &&
        r.status !== 'invoiced' &&
        !!r.tripBillingBatchId &&
        reviewOverlapsYearMonth(r, yearMonth),
    );
    for (const r of rows) {
      const batchId = r.tripBillingBatchId!;
      const key = `t|${batchId}|${person.workerId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const start = String(r.tripStartDate || '').slice(0, 10);
      const end = String(r.tripEndDate || '').slice(0, 10);
      const detail = start && end ? `Trip ${start.slice(8)}–${end.slice(8)}` : 'Trip';
      out.push({
        key,
        kind: 'trip',
        poId: po.id,
        poCode: po.poCode || po.id,
        workerId: person.workerId,
        workerName: person.workerName || r.workerNameSnapshot || person.workerId,
        yearMonth,
        tripBatchId: batchId,
        detail,
      });
    }
  }
  return out;
}

/** คนที่ส่งรอออกบิลแล้ว และยังไม่มีใบแจ้งหนี้ครอบช่วงนั้น */
export async function listWorkersReadyForInvoice(
  db: Firestore,
  customerId: string,
  yearMonth: string,
): Promise<InvoiceReadyWorker[]> {
  const cid = customerId.trim();
  const ym = yearMonth.trim();
  if (!cid || !/^\d{4}-\d{2}$/.test(ym)) return [];

  const poSnap = await getDocs(query(collection(db, 'purchase_orders'), where('customerId', '==', cid)));
  const pos = poSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) } as PurchaseOrder));
  const out: InvoiceReadyWorker[] = [];
  const modeByPoId = new Map<string, 'TRIP' | 'MONTHLY'>();

  for (const po of pos) {
    if ((po.poType || 'contract') === 'quotation') continue;
    const billingMode = await resolveBillingMode(db, po);
    modeByPoId.set(po.id, billingMode);
    const closures = await detachRangesBilledByInactiveInvoices(
      db,
      await fetchWorkerClosuresForPoMonth(db, po.id, ym),
    );
    const readyClosures: WorkerMonthTimesheetClosure[] = [];
    for (const c of closures) {
      if (c.status !== 'approved') continue;
      const ranges = c.closedDateRanges ?? [];
      const unbilled = ranges.filter((r) => r.billingReleased && !r.billedInvoiceId);
      if (ranges.length > 0 && unbilled.length === 0) continue;
      if (ranges.length === 0) {
        const existing = await listPoMonthCommercialInvoicesForPeriod(db, po.id, `${ym}-01`, `${ym}-31`);
        if (existing.some((inv) => commercialInvoiceCoversAnyWorker(inv, c.workerId))) continue;
      }
      readyClosures.push(c);
    }
    if (billingMode === 'TRIP') {
      if (readyClosures.length > 0) {
        const tripRows = await tripWorkersFromReviews(
          db,
          po,
          ym,
          readyClosures.map((c) => ({ workerId: c.workerId, workerName: c.workerName || c.workerId })),
        );
        for (const row of tripRows) {
          if (!out.some((w) => w.key === row.key)) out.push(row);
        }
      }
      continue;
    }
    for (const c of readyClosures) {
      const ranges = c.closedDateRanges ?? [];
      const unbilled = ranges.filter((r) => r.billingReleased && !r.billedInvoiceId);
      const detail =
        unbilled.length > 0
          ? unbilled.map((r) => (r.startYmd === r.endYmd ? r.startYmd.slice(8) : `${r.startYmd.slice(8)}–${r.endYmd.slice(8)}`)).join(', ')
          : 'ทั้งเดือน';
      out.push({
        key: `m|${po.id}|${c.workerId}|${ym}`,
        kind: 'monthly',
        poId: po.id,
        poCode: po.poCode || po.id,
        workerId: c.workerId,
        workerName: c.workerName || c.workerId,
        yearMonth: ym,
        detail,
      });
    }
  }

  try {
    const tripSnap = await getDocs(
      query(collection(db, 'trip_billing_batches'), where('customerId', '==', cid), where('status', '==', 'approved')),
    );
    for (const d of tripSnap.docs) {
      const batch = { id: d.id, ...(d.data() as object) } as TripBillingBatch;
      if (batch.sourceCommercialInvoiceId) continue;
      const start = String(batch.periodStart || '').slice(0, 7);
      const end = String(batch.periodEnd || batch.periodStart || '').slice(0, 7);
      if (start !== ym && end !== ym) continue;
      const po = pos.find((p) => p.id === batch.poId);
      if (modeByPoId.get(batch.poId) !== 'TRIP') continue;
      const ids = batch.memberWorkerIds ?? [];
      const names = batch.memberWorkerNames ?? [];
      ids.forEach((workerId, i) => {
        const key = `t|${batch.id}|${workerId}`;
        if (out.some((w) => w.key === key)) return;
        out.push({
          key,
          kind: 'trip',
          poId: batch.poId,
          poCode: po?.poCode || batch.poId,
          workerId,
          workerName: names[i] || workerId,
          yearMonth: ym,
          tripBatchId: batch.id,
          detail: 'Trip',
        });
      });
    }
  } catch {
    /* index อาจยังไม่มี — ราย monthly ยังใช้ได้ */
  }

  const billedTripWorkers = new Set<string>();
  try {
    const invSnap = await getDocs(query(collection(db, 'commercial_invoices'), where('customerId', '==', cid)));
    for (const d of invSnap.docs) {
      const inv = d.data() as CommercialInvoice;
      if (inv.status === 'VOID' || inv.status === 'REVISED') continue;
      const ps = String(inv.periodStart || '').slice(0, 7);
      const pe = String(inv.periodEnd || '').slice(0, 7);
      if (ps > ym || pe < ym) continue;
      for (const wid of inv.coveredWorkerIds ?? []) billedTripWorkers.add(String(wid));
    }
  } catch {
    /* ถ้าอ่านใบเก่าไม่ได้ ยังแสดงรายชื่อ trip */
  }

  const visible = out.filter((w) => w.kind !== 'trip' || !billedTripWorkers.has(w.workerId));
  visible.sort((a, b) => a.workerName.localeCompare(b.workerName, 'th', { sensitivity: 'base' }));
  return visible;
}

export async function nextTripMobLocationPrompt(
  db: Firestore,
  workers: InvoiceReadyWorker[],
  decidedBatchIds: readonly string[],
  keys: Record<string, string>,
): Promise<
  | { done: true; keys: Record<string, string> }
  | {
      done: false;
      batchId: string;
      label: string;
      options: TripMobDemobLocationOption[];
      keys: Record<string, string>;
    }
> {
  const decided = new Set(decidedBatchIds);
  const nextKeys = { ...keys };
  const trip = workers.filter((w) => w.kind === 'trip' && w.tripBatchId);
  const batchIds = [...new Set(trip.map((w) => w.tripBatchId!))];
  for (const batchId of batchIds) {
    if (decided.has(batchId)) continue;
    const snap = await getDoc(doc(db, 'trip_billing_batches', batchId));
    if (!snap.exists()) throw new Error('ไม่พบชุดวางบิล Trip');
    const batch = { id: snap.id, ...(snap.data() as object) } as TripBillingBatch;
    const selected = new Set(trip.filter((w) => w.tripBatchId === batchId).map((w) => w.workerId));
    const members = await loadTripMobDemobMembers(db, batch.memberMobCycleIds);
    const cycleIds = members.filter((m) => selected.has(m.workerId)).map((m) => m.mobCycleId);
    const ids = cycleIds.length > 0 ? cycleIds : batch.memberMobCycleIds;
    if (await isStandbyOnlyClosedTripBatch(db, ids)) {
      decided.add(batchId);
      continue;
    }
    const poSnap = await getDoc(doc(db, 'purchase_orders', batch.poId));
    const contractId = poSnap.exists() ? String((poSnap.data() as PurchaseOrder).contractId || '') : '';
    if (!contractId) {
      decided.add(batchId);
      continue;
    }
    const choice = await resolveTripMobDemobLocationChoice(db, contractId, ids);
    if (choice.kind === 'error') throw new Error(choice.message);
    if (choice.kind === 'auto') nextKeys[batchId] = choice.mobLocationKey;
    if (choice.kind === 'prompt') {
      const poCode = poSnap.exists() ? String((poSnap.data() as PurchaseOrder).poCode || batch.poId) : batch.poId;
      return {
        done: false,
        batchId,
        label: `${poCode} · ${batch.tripAnchorStartDate || batch.periodStart}`,
        options: choice.options,
        keys: nextKeys,
      };
    }
    decided.add(batchId);
  }
  return { done: true, keys: nextKeys };
}

export async function createCommercialInvoiceForReadyWorkers(
  db: Firestore,
  params: {
    customerId: string;
    workers: InvoiceReadyWorker[];
    issueDate: string;
    actor: User;
    /** จุด Mob/Demob ต่อชุด Trip — ใช้เมื่อสัญญาคิดค่า MOB ไป-กลับ */
    tripMobDemobByBatch?: Record<string, string>;
  },
): Promise<{ id: string; invoiceNo: string }> {
  const workersInput = params.workers;
  if (workersInput.length === 0) throw new Error('เลือกคนงานอย่างน้อย 1 คน');
  const poIds = [...new Set(workersInput.map((w) => w.poId))];
  const poById = new Map<string, PurchaseOrder>();
  for (const poId of poIds) {
    const snap = await getDoc(doc(db, 'purchase_orders', poId));
    if (!snap.exists()) throw new Error('ไม่พบ PO');
    const po = { id: snap.id, ...(snap.data() as object) } as PurchaseOrder;
    if (po.customerId !== params.customerId) {
      throw new Error('รวมในใบแจ้งหนี้เดียวกันได้เฉพาะลูกค้ารายเดียวกัน');
    }
    assertPurchaseOrderActiveForInvoice(po);
    poById.set(poId, po);
  }

  const modeByPo = new Map<string, 'TRIP' | 'MONTHLY'>();
  for (const po of poById.values()) {
    modeByPo.set(po.id, await resolveBillingMode(db, po));
  }
  if (new Set(modeByPo.values()).size > 1) {
    throw new Error('รวมในใบเดียวกันไม่ได้ — มีทั้ง PO ที่วางบิลแบบ Trip และแบบรายเดือน');
  }
  const contractMode = modeByPo.values().next().value ?? 'MONTHLY';
  let workers = workersInput;
  if (contractMode === 'TRIP') {
    const normalized: InvoiceReadyWorker[] = [];
    const seen = new Set<string>();
    for (const w of workersInput) {
      if (w.kind === 'trip' && w.tripBatchId) {
        if (!seen.has(w.key)) {
          seen.add(w.key);
          normalized.push(w);
        }
        continue;
      }
      const po = poById.get(w.poId)!;
      const rows = await tripWorkersFromReviews(db, po, w.yearMonth, [
        { workerId: w.workerId, workerName: w.workerName },
      ]);
      if (rows.length === 0) {
        throw new Error(
          `${po.poCode || po.id} วางบิลแบบ Trip — ไม่พบรอบเดินทางของ ${w.workerName} จึงสร้างแบบรายเดือนไม่ได้`,
        );
      }
      for (const row of rows) {
        if (seen.has(row.key)) continue;
        seen.add(row.key);
        normalized.push(row);
      }
    }
    workers = normalized;
  }

  const lines: GeneratedBillingLine[] = [];
  const warnings: string[] = [];
  let timesheetCount = 0;
  let periodStart = '9999-99-99';
  let periodEnd = '0000-00-00';
  const monthlyMarks: Array<{ poId: string; yearMonth: string; workerIds: string[] }> = [];

  const monthly = workers.filter((w) => w.kind === 'monthly');
  const byPoMonth = new Map<string, InvoiceReadyWorker[]>();
  for (const w of monthly) {
    const k = `${w.poId}|${w.yearMonth}`;
    const list = byPoMonth.get(k) ?? [];
    list.push(w);
    byPoMonth.set(k, list);
  }
  for (const [k, group] of byPoMonth) {
    const [poId, ym] = k.split('|');
    const closures = await detachRangesBilledByInactiveInvoices(
      db,
      await fetchWorkerClosuresForPoMonth(db, poId!, ym!),
    );
    const ranges = closures
      .filter((c) => group.some((g) => g.workerId === c.workerId))
      .flatMap((c) => (c.closedDateRanges ?? []).filter((r) => r.billingReleased && !r.billedInvoiceId));
    const start = ranges.length > 0 ? ranges.reduce((m, r) => (r.startYmd < m ? r.startYmd : m), ranges[0]!.startYmd) : `${ym}-01`;
    const end = ranges.length > 0 ? ranges.reduce((m, r) => (r.endYmd > m ? r.endYmd : m), ranges[0]!.endYmd) : `${ym}-31`;
    if (start < periodStart) periodStart = start;
    if (end > periodEnd) periodEnd = end;
    const gen = await generateBillingLines(db, poId!, start, end, undefined, {
      workerIds: group.map((g) => g.workerId),
      dateRanges: ranges.length > 0 ? ranges : undefined,
    });
    for (const line of gen.lines) lines.push(line);
    warnings.push(...gen.warnings);
    timesheetCount += gen.timesheetCount;
    monthlyMarks.push({ poId: poId!, yearMonth: ym!, workerIds: group.map((g) => g.workerId) });
  }

  const trip = workers.filter((w) => w.kind === 'trip' && w.tripBatchId);
  const byBatch = new Map<string, InvoiceReadyWorker[]>();
  for (const w of trip) {
    const list = byBatch.get(w.tripBatchId!) ?? [];
    list.push(w);
    byBatch.set(w.tripBatchId!, list);
  }
  const tripCycleIds: string[] = [];
  let tripLocationKey: string | undefined;
  let singleTripBatchId: string | undefined;
  for (const [batchId, group] of byBatch) {
    const snap = await getDoc(doc(db, 'trip_billing_batches', batchId));
    if (!snap.exists()) throw new Error('ไม่พบชุดวางบิล Trip');
    const batch = { id: snap.id, ...(snap.data() as object) } as TripBillingBatch;
    const start = batch.periodStart;
    const end = batch.periodEnd || batch.periodStart;
    if (start < periodStart) periodStart = start;
    if (end > periodEnd) periodEnd = end;
    const selected = new Set(group.map((g) => g.workerId));
    const members = await loadTripMobDemobMembers(db, batch.memberMobCycleIds);
    const cycleIds = members.filter((m) => selected.has(m.workerId)).map((m) => m.mobCycleId);
    const ids = cycleIds.length > 0 ? cycleIds : batch.memberMobCycleIds;
    let locationKey = (params.tripMobDemobByBatch?.[batchId] || '').trim();
    const standbyOnly = await isStandbyOnlyClosedTripBatch(db, ids);
    if (!standbyOnly) {
      const contractId = poById.get(batch.poId)?.contractId || '';
      if (contractId && !locationKey) {
        const choice = await resolveTripMobDemobLocationChoice(db, contractId, ids);
        if (choice.kind === 'error') throw new Error(choice.message);
        if (choice.kind === 'prompt') throw new Error('ต้องเลือกจุด Mob/Demob ก่อนสร้างใบแจ้งหนี้');
        if (choice.kind === 'auto') locationKey = choice.mobLocationKey;
      }
    }
    const gen = await generateBillingLinesForMobCycles(
      db,
      batch.poId,
      ids,
      start,
      end,
      locationKey ? { tripMobDemobLocationKey: locationKey } : undefined,
    );
    if (gen.lines.length === 0 && gen.warnings.some((w) => w.includes('Mob/Demob') || w.includes('ค่า MOB'))) {
      throw new Error(gen.warnings.find((w) => w.includes('MOB') || w.includes('Mob')) || 'สร้างบรรทัด Trip ไม่ได้');
    }
    for (const line of gen.lines) {
      lines.push(line);
    }
    warnings.push(...gen.warnings);
    timesheetCount += gen.timesheetCount;
    tripCycleIds.push(...ids);
    if (locationKey) tripLocationKey = tripLocationKey && tripLocationKey !== locationKey ? undefined : locationKey;
    singleTripBatchId = singleTripBatchId === undefined ? batchId : '';
  }

  if (lines.length === 0) {
    throw new Error('ไม่มีรายการจาก timesheet ของคนที่เลือก — ตรวจว่าส่งรอออกบิลแล้วและมี readyForBilling');
  }

  const primary = poById.get(poIds[0]!)!;
  const vatPercent = await resolveVatPercent(db, primary.customerId, primary.contractId);
  const amountBeforeTax = roundMoney(lines.reduce((s, l) => s + l.amount, 0));
  const totals = computeCommercialInvoiceVatTotals(amountBeforeTax, vatPercent);
  const names = [...new Set(workers.map((w) => w.workerName))].join(', ');

  return writeCommercialDraftInvoiceCore(db, params.actor, {
    fields: {
      customerId: params.customerId,
      contractId: primary.contractId || undefined,
      poId: primary.id,
      sourcePoIds: poIds,
      waveId: contractMode === 'TRIP' ? TRIP_BILLING_WAVE_PLACEHOLDER : PO_MONTH_WAVE_PLACEHOLDER,
      waveCode: poIds.map((id) => poById.get(id)?.poCode || id).join(', '),
      periodStart,
      periodEnd,
      issueDate: params.issueDate,
      currency: 'THB',
      vatPercent,
      ...totals,
      withholdingTaxAmount: 0,
      lines: mapGeneratedBillingLinesToInvoiceLines(lines),
      generationWarnings: [...new Set(warnings)],
      timesheetCount,
      billingMode: contractMode,
      coveredWorkerIds: normalizeWorkerIdSet(workers.map((w) => w.workerId)),
      ...(tripCycleIds.length > 0 ? { memberMobCycleIds: [...new Set(tripCycleIds)] } : {}),
      ...(trip.length > 0 ? { memberWorkerNames: [...new Set(trip.map((w) => w.workerName))] } : {}),
      ...(trip.length > 0 && monthly.length === 0 && singleTripBatchId
        ? { sourceTripBillingBatchId: singleTripBatchId }
        : {}),
      ...(tripLocationKey ? { tripMobDemobLocationKey: tripLocationKey } : {}),
      notes: names,
    },
    auditEntityLabel: (invoiceNo) => `${invoiceNo} (${workers.length} คน)`,
    auditLinkedIds: [params.customerId, ...poIds],
    auditAfterSummary: (invoiceNo) => `สร้างใบแจ้งหนี้ ${invoiceNo} จาก timesheet ${workers.length} คน`,
    afterPersist: async ({ id }) => {
      for (const mark of monthlyMarks) {
        await markClosureRangesBilled(db, { ...mark, invoiceId: id, actor: params.actor });
      }
      for (const batchId of byBatch.keys()) {
        const group = byBatch.get(batchId) ?? [];
        const snap = await getDoc(doc(db, 'trip_billing_batches', batchId));
        if (!snap.exists()) continue;
        const batch = { id: snap.id, ...(snap.data() as object) } as TripBillingBatch;
        const selected = new Set(group.map((g) => g.workerId));
        const all = (batch.memberWorkerIds ?? []).every((wid) => selected.has(wid));
        if (all) await markTripBatchInvoiced(db, batchId, id);
      }
    },
  });
}

export async function createCommercialInvoiceForQuotationPos(
  db: Firestore,
  params: {
    customerId: string;
    poIds: string[];
    periodStart: string;
    periodEnd: string;
    issueDate: string;
    actor: User;
  },
): Promise<{ id: string; invoiceNo: string }> {
  const poIds = [...new Set(params.poIds.map((id) => id.trim()).filter(Boolean))];
  if (poIds.length === 0) throw new Error('เลือก PO อย่างน้อย 1 ใบ');
  const lines: CommercialInvoiceLine[] = [];
  const warnings: string[] = ['สร้างจาก PO ใบเสนอราคา — ไม่ใช้ timesheet'];
  let customerId = '';
  let contractId: string | undefined;
  const codes: string[] = [];

  for (const poId of poIds) {
    const poSnap = await getDoc(doc(db, 'purchase_orders', poId));
    if (!poSnap.exists()) throw new Error('ไม่พบ PO');
    const po = { id: poSnap.id, ...(poSnap.data() as object) } as PurchaseOrder;
    if ((po.poType || 'contract') !== 'quotation') {
      throw new Error(`${po.poCode || poId} ไม่ใช่ PO จากใบเสนอราคา`);
    }
    if (!customerId) customerId = po.customerId;
    if (po.customerId !== customerId || po.customerId !== params.customerId) {
      throw new Error('รวมในใบแจ้งหนี้เดียวกันได้เฉพาะ PO ของลูกค้ารายเดียวกัน');
    }
    assertPurchaseOrderActiveForInvoice(po);
    contractId = contractId || po.contractId || undefined;
    codes.push(po.poCode || poId);
    const linesSnap = await getDocs(collection(db, 'purchase_orders', poId, 'po_lines'));
    const poLines = linesSnap.docs
      .map((d) => ({ ...(d.data() as Omit<POLine, 'id'>), id: d.id }))
      .filter((l) => l.status !== 'cancelled');
    if (poLines.length === 0) throw new Error(`${po.poCode || poId} ไม่มีรายการ PO Line`);
    for (const line of poLines) {
      const qty = Math.max(0, Number(line.quantity) || 0);
      const unit = roundMoney(sellSnapshotForWorkMode(line, po.poWorkMode ?? 'OFFSHORE'));
      const amount = roundMoney(qty * unit);
      const loc = (line.workLocation || '').trim() || 'PO Line';
      const prefix = poIds.length > 1 ? `${po.poCode || poId} · ` : '';
      lines.push({
        id: newLineId(),
        displayOrder: lines.length,
        description: `${prefix}${loc}`,
        positionId: line.positionId,
        quantity: qty,
        unitPrice: unit,
        amount,
        lineSource: 'po_line',
      });
    }
  }

  const amountBeforeTax = roundMoney(lines.reduce((s, l) => s + l.amount, 0));
  if (amountBeforeTax <= 0) throw new Error('ยอดรวมเป็น 0 — ตรวจราคา/จำนวนใน PO Line');
  const vatPercent = await resolveVatPercent(db, customerId, contractId);
  const totals = computeCommercialInvoiceVatTotals(amountBeforeTax, vatPercent);

  return writeCommercialDraftInvoiceCore(db, params.actor, {
    fields: {
      customerId,
      contractId,
      poId: poIds[0]!,
      sourcePoIds: poIds,
      waveId: QUOTATION_PO_WAVE_PLACEHOLDER,
      waveCode: codes.join(', '),
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      issueDate: params.issueDate,
      currency: 'THB',
      vatPercent,
      ...totals,
      withholdingTaxAmount: 0,
      lines,
      generationWarnings: warnings,
      timesheetCount: 0,
    },
    auditEntityLabel: (invoiceNo) => `${invoiceNo} (PO ใบเสนอราคา ${poIds.length} ใบ)`,
    auditLinkedIds: [customerId, ...poIds],
    auditAfterSummary: (invoiceNo) => `สร้างใบแจ้งหนี้ ${invoiceNo} จาก PO ใบเสนอราคา ${codes.join(', ')}`,
  });
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
    if (isCommercialInvoiceSuperseded(x)) continue;
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
    if (isCommercialInvoiceSuperseded(x)) continue;
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
    if (isCommercialInvoiceSuperseded(data)) continue;
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

function commercialInvoicePeriodsOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  const as = String(aStart || '').slice(0, 10);
  const ae = String(aEnd || '').slice(0, 10);
  const bs = String(bStart || '').slice(0, 10);
  const be = String(bEnd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(as) || !/^\d{4}-\d{2}-\d{2}$/.test(ae)) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bs) || !/^\d{4}-\d{2}-\d{2}$/.test(be)) return false;
  return as <= be && bs <= ae;
}

async function resolveTripCommercialInvoiceWorkerIds(
  db: Firestore,
  inv: CommercialInvoice,
): Promise<Set<string>> {
  const fromCovered = normalizeWorkerIdSet(inv.coveredWorkerIds ?? []);
  if (fromCovered.length > 0) return new Set(fromCovered);
  const batchId = String(inv.sourceTripBillingBatchId || '').trim();
  if (!batchId) return new Set();
  const snap = await getDoc(doc(db, 'trip_billing_batches', batchId));
  if (!snap.exists()) return new Set();
  const batch = snap.data() as TripBillingBatch;
  return new Set(normalizeWorkerIdSet(batch.memberWorkerIds ?? []));
}

/**
 * สัญญา/PO โหมด TRIP ออกใบได้เฉพาะ Trip Billing
 * — และกันคนที่อยู่ในใบ Trip ทับช่วงวันที่แล้ว มาออก Monthly ซ้ำ
 */
async function assertPoAllowsMonthlyCommercialInvoice(
  db: Firestore,
  po: PurchaseOrder,
  opts?: { workerIds?: readonly string[]; periodStart?: string; periodEnd?: string },
): Promise<void> {
  const mode = await resolveBillingMode(db, po);
  if (mode === 'TRIP') {
    throw new Error(
      'สัญญา/PO นี้ตั้งโหมดวางบิลแบบ Trip (M1→D1) — ออกใบแจ้งหนี้ได้เฉพาะเมนู «ทำใบแจ้งหนี้แบบ Trip» ไม่ใช่แบบ Monthly',
    );
  }

  const workerIds = normalizeWorkerIdSet(opts?.workerIds ?? []);
  const periodStart = String(opts?.periodStart || '').slice(0, 10);
  const periodEnd = String(opts?.periodEnd || '').slice(0, 10);
  if (workerIds.length === 0 || !periodStart || !periodEnd) return;

  const q = query(
    collection(db, 'commercial_invoices'),
    where('poId', '==', po.id),
    where('waveId', '==', TRIP_BILLING_WAVE_PLACEHOLDER),
  );
  const snap = await getDocs(q);
  for (const d of snap.docs) {
    const inv = { id: d.id, ...(d.data() as object) } as CommercialInvoice;
    if (inv.status === 'VOID') continue;
    if (isCommercialInvoiceSuperseded(inv)) continue;
    if (!commercialInvoicePeriodsOverlap(inv.periodStart, inv.periodEnd, periodStart, periodEnd)) {
      continue;
    }
    const tripWorkers = await resolveTripCommercialInvoiceWorkerIds(db, inv);
    const hit = workerIds.filter((w) => tripWorkers.has(w));
    if (hit.length > 0) {
      throw new Error(
        `มีใบวางบิลแบบ Trip แล้ว (${inv.invoiceNo || inv.id}) ทับช่วงวันที่ — ไม่สามารถออกใบ Monthly ซ้ำสำหรับคนงานชุดนี้`,
      );
    }
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

  const poSnapGate = await getDoc(doc(db, 'purchase_orders', poId));
  if (!poSnapGate.exists()) throw new Error('ไม่พบ PO');
  const poGate = { ...poSnapGate.data(), id: poSnapGate.id } as PurchaseOrder;
  assertPurchaseOrderActiveForInvoice(poGate);
  await assertPoAllowsMonthlyCommercialInvoice(db, poGate, {
    workerIds: isPartial ? workerIds : undefined,
    periodStart,
    periodEnd,
  });

  const gen = await generateBillingLines(db, poId, periodStart, periodEnd, undefined, {
    workerIds: isPartial ? workerIds : undefined,
    excludeWorkerIds: !isPartial ? params.excludeWorkerIds : undefined,
  });
  if (gen.lines.length === 0) {
    throw new Error(
      'ไม่มีรายการจาก timesheet — ตรวจช่วงงวด / สถานะ readyForBilling ของ timesheet ใต้ PO นี้ (ทุก wave)',
    );
  }

  const po = poGate;
  const waveCodeLabel = isPartial
    ? partialPoMonthInvoiceLabel(params.partialPoMonthBatchNo, workerIds.length)
    : 'PO+งวด (รวม wave)';

  const vatPercent = await resolveVatPercent(db, po.customerId, po.contractId);
  const totals = computeCommercialInvoiceVatTotals(gen.totalAmount, vatPercent);
  const lines = mapGeneratedBillingLinesToInvoiceLines(gen.lines);

  return writeCommercialDraftInvoiceCore(db, actor, {
    fields: {
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
      ...totals,
      withholdingTaxAmount: 0,
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
    },
    auditEntityLabel: (invoiceNo) => `${invoiceNo} (PO+งวด)`,
    auditLinkedIds: [po.customerId, poId],
    auditAfterSummary: (invoiceNo) =>
      `สร้างใบแจ้งหนี้ (เรียกเก็บ) ${invoiceNo} จาก timesheet รวมราย PO+งวด${isPartial ? ' (บางส่วน)' : ''}`,
  });
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
        notes: workerNames ? `Partial billing round ${batchNo}: ${workerNames}` : undefined,
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
  assertPurchaseOrderActiveForInvoice(poEarly);
  const tripMode = await resolveBillingMode(db, poEarly);
  if (tripMode !== 'TRIP') {
    throw new Error(
      `สัญญา/PO นี้ตั้งโหมดวางบิลแบบ ${tripMode === 'MONTHLY' ? 'Monthly' : tripMode} — ออกใบแจ้งหนี้ Trip ไม่ได้ ใช้เมนู «ทำใบแจ้งหนี้แบบ Monthly»`,
    );
  }

  let tripMobDemobLocationKey = (options?.tripMobDemobLocationKey || '').trim() || undefined;
  const { isStandbyOnlyClosedTripBatch } = await import('@/lib/services/trip-billing-service');
  const standbyOnlyClosed = await isStandbyOnlyClosedTripBatch(db, batch.memberMobCycleIds);
  if (standbyOnlyClosed) {
    tripMobDemobLocationKey = undefined;
  } else if (poEarly.contractId) {
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

  const waveCodeLabel = standbyOnlyClosed
    ? `รอบ Standby · เริ่ม ${batch.tripAnchorStartDate}`
    : `รอบเดินทาง · M1 ${batch.tripAnchorStartDate}`;

  const vatPercent = await resolveVatPercent(db, po.customerId, po.contractId);
  const totals = computeCommercialInvoiceVatTotals(gen.totalAmount, vatPercent);
  const lines = mapGeneratedBillingLinesToInvoiceLines(gen.lines);

  return writeCommercialDraftInvoiceCore(db, actor, {
    fields: {
      customerId: po.customerId,
      contractId: po.contractId || undefined,
      poId: batch.poId,
      waveId: TRIP_BILLING_WAVE_PLACEHOLDER,
      waveCode: waveCodeLabel,
      periodStart,
      periodEnd,
      issueDate: issueDate || timestampToHtmlDateValue(Date.now()),
      currency: 'THB',
      vatPercent,
      ...totals,
      withholdingTaxAmount: 0,
      lines,
      generationWarnings: gen.warnings,
      timesheetCount: gen.timesheetCount,
      billingMode: 'TRIP',
      sourceTripBillingBatchId: batch.id,
      memberMobCycleIds: batch.memberMobCycleIds,
      memberWorkerNames: batch.memberWorkerNames,
      coveredWorkerIds: normalizeWorkerIdSet(batch.memberWorkerIds ?? []),
      ...(tripMobDemobLocationKey ? { tripMobDemobLocationKey } : {}),
    },
    auditEntityLabel: (invoiceNo) => `${invoiceNo} (Trip batch)`,
    auditLinkedIds: [po.customerId, batch.poId, batch.id],
    auditAfterSummary: (invoiceNo) =>
      `สร้างใบแจ้งหนี้ ${invoiceNo} จาก trip batch (${batch.memberMobCycleIds.length} คน)`,
    afterPersist: async ({ id }) => {
      await markTripBatchInvoiced(db, batch.id, id);
    },
  });
}

export async function ensureCommercialDraftInvoiceForTripBatch(
  db: Firestore,
  batch: TripBillingBatch,
  actor: User,
  options?: { tripMobDemobLocationKey?: string },
): Promise<{ ok: true; id: string; invoiceNo: string } | { ok: false; reason: string }> {
  // ready → อนุมัติอัตโนมัติ แล้วสร้างใบวางบิลได้เลย (ไม่ต้องกดอนุมัติแยก)
  let workingBatch = batch;
  if (workingBatch.status === 'ready') {
    await approveTripBillingBatch(db, workingBatch.id, actor);
    workingBatch = { ...workingBatch, status: 'approved' };
  }
  if (workingBatch.status !== 'approved') {
    return {
      ok: false,
      reason: `สถานะชุดวางบิลคือ ${workingBatch.status} — ต้องปิดรอบพร้อมวางบิลก่อนสร้าง invoice`,
    };
  }
  const existing = await findCommercialInvoiceByTripBatch(db, workingBatch.id);
  if (existing?.id) {
    return { ok: false, reason: `มีใบแจ้งหนี้แล้ว (${existing.invoiceNo || existing.id})` };
  }
  try {
    const { id, invoiceNo } = await createCommercialDraftInvoiceForTripBatch(
      db,
      workingBatch,
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

  const [poSnapGate, waveSnapGate] = await Promise.all([
    getDoc(doc(db, 'purchase_orders', poId)),
    getDoc(doc(db, 'waves', waveId)),
  ]);
  if (!poSnapGate.exists()) throw new Error('ไม่พบ PO');
  const poGate = { ...poSnapGate.data(), id: poSnapGate.id } as PurchaseOrder;
  assertPurchaseOrderActiveForInvoice(poGate);
  await assertPoAllowsMonthlyCommercialInvoice(db, poGate, { periodStart, periodEnd });

  const gen = await generateBillingLines(db, poId, periodStart, periodEnd, waveId);
  if (gen.lines.length === 0) {
    throw new Error(
      'ไม่มีรายการจาก timesheet — ตรวจช่วงวันที่ / wave / สถานะ timesheet (ต้อง readyForBilling)',
    );
  }

  const po = poGate;
  const waveSnap = waveSnapGate;
  const waveCode = waveSnap.exists() ? String((waveSnap.data() as { waveCode?: string }).waveCode || '') : '';

  const vatPercent = await resolveVatPercent(db, po.customerId, po.contractId);
  const totals = computeCommercialInvoiceVatTotals(gen.totalAmount, vatPercent);
  const lines = mapGeneratedBillingLinesToInvoiceLines(gen.lines);

  return writeCommercialDraftInvoiceCore(db, actor, {
    fields: {
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
      ...totals,
      withholdingTaxAmount: 0,
      lines,
      generationWarnings: gen.warnings,
      timesheetCount: gen.timesheetCount,
      notes: params.notes,
      sourceWaveMonthReviewId: params.sourceWaveMonthReviewId,
    },
    auditEntityLabel: (invoiceNo) => `${invoiceNo} (wave ${waveId})`,
    auditLinkedIds: [po.customerId, poId, waveId],
    auditAfterSummary: (invoiceNo) => `สร้างใบแจ้งหนี้ (เรียกเก็บ) ${invoiceNo}`,
  });
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
  if (!isCommercialInvoiceLatestEditable(cur)) {
    throw new Error('เอกสารรุ่นนี้ถูกแทนที่แล้ว — ส่งได้เฉพาะรุ่นล่าสุดเท่านั้น');
  }

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
  if (!isCommercialInvoiceLatestEditable(invoice)) {
    throw new Error('เอกสารรุ่นนี้ถูกแทนที่แล้ว (REVISED) — ยืนยันได้เฉพาะรุ่นล่าสุดเท่านั้น');
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

function yearMonthsCovering(periodStart?: string | null, periodEnd?: string | null): string[] {
  const start = String(periodStart || '').slice(0, 7);
  const end = String(periodEnd || periodStart || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(start)) return [];
  if (!/^\d{4}-\d{2}$/.test(end) || start === end) return [start];
  const out: string[] = [];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  for (let i = 0; i < 36; i++) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push(key);
    if (key === end) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
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
  const alreadyVoid = cur.status === 'VOID';

  const taxId = alreadyVoid ? '' : String(cur.linkedTaxInvoiceId || '').trim();
  if (taxId) {
    const taxSnap = await getDoc(doc(db, 'tax_invoices', taxId));
    if (taxSnap.exists()) {
      const tax = taxSnap.data() as { status?: string; taxInvoiceNo?: string };
      if (tax.status !== 'CANCELLED') {
        const no = String(tax.taxInvoiceNo || taxId).trim();
        throw new Error(
          `ต้องยกเลิกใบกำกับภาษี ${no} ก่อน แล้วจึงยกเลิกใบแจ้งหนี้ได้`,
        );
      }
    }
  }

  if (!alreadyVoid) {
    const now = Date.now();
    await updateDoc(
      ref,
      sanitizeFirestorePayload({
        status: 'VOID' as const,
        linkedTaxInvoiceId: deleteField(),
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
      afterSummary:
        cur.status === 'ISSUED'
          ? 'ยกเลิกใบแจ้งหนี้ที่ยืนยันแล้ว (ยังไม่มีใบกำกับภาษีที่ใช้งาน / ยกเลิกใบกำกับแล้ว)'
          : 'ยกเลิกใบแจ้งหนี้ (รอสร้างใหม่จากงวด / PO)',
    });
  }

  if (cur.sourceTripBillingBatchId) {
    await releaseTripBillingBatchAfterInvoiceRemoved(db, cur.sourceTripBillingBatchId);
  }

  const poIds = [...new Set([...(cur.sourcePoIds ?? []), cur.poId].map((id) => String(id || '').trim()).filter(Boolean))];
  const yearMonths = yearMonthsCovering(cur.periodStart, cur.periodEnd);
  if (poIds.length > 0 && yearMonths.length > 0) {
    await releaseClosureRangesBilledByInvoice(db, {
      poIds,
      yearMonths,
      workerIds: cur.coveredWorkerIds,
      invoiceId,
      actor,
    });
  }

  const scanMonths =
    yearMonths.length > 0 ? yearMonths : yearMonthsCovering(String(cur.issueDate || ''), String(cur.issueDate || ''));
  for (const ym of scanMonths) {
    const snap = await getDocs(
      query(collection(db, 'worker_month_timesheet_closures'), where('yearMonth', '==', ym)),
    );
    const found = snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as WorkerMonthTimesheetClosure);
    await stripBilledInvoiceIds(db, found, new Set([invoiceId]));
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
  if (!isCommercialInvoiceLatestEditable(cur)) {
    throw new Error('เอกสารรุ่นนี้ถูกแทนที่แล้ว — ดึงรายการใหม่ได้เฉพาะรุ่นล่าสุดเท่านั้น');
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
  const timesheetLines: CommercialInvoiceLine[] = collapseSameLocationMobDemobLines(gen.lines).map((l, idx) => ({
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
  if (!isCommercialInvoiceLatestEditable(cur)) {
    throw new Error('เอกสารรุ่นนี้ถูกแทนที่แล้ว — แก้ไขได้เฉพาะรุ่นล่าสุดเท่านั้น');
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

/**
 * บันทึกการแก้ไขรายการ → สร้างเอกสารรุ่นใหม่ (R1, R2, …) เก็บต้นฉบับไว้เปิดดูอย่างเดียว
 */
export async function saveCommercialDraftInvoiceAsNewRevision(
  db: Firestore,
  invoiceId: string,
  nextLines: CommercialInvoiceLine[],
  actor: User,
  extra?: { notes?: string },
): Promise<{ id: string; invoiceNo: string; revisionNo: number }> {
  const ref = doc(db, 'commercial_invoices', invoiceId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('ไม่พบใบแจ้งหนี้');
  const cur = { id: snap.id, ...(snap.data() as object) } as CommercialInvoice;
  if (cur.status !== 'DRAFT') {
    throw new Error('บันทึกรุ่นใหม่ได้เฉพาะใบสถานะ DRAFT (ตรวจภายใน)');
  }
  if (!isCommercialInvoiceLatestEditable(cur)) {
    throw new Error('เอกสารรุ่นนี้ถูกแทนที่แล้ว (REVISED) — แก้ไขได้เฉพาะรุ่นล่าสุดเท่านั้น');
  }

  const normalized = normalizeDraftLines(nextLines);
  const amountBeforeTax = roundMoney(normalized.reduce((s, x) => s + x.amount, 0));
  const vp = Number(cur.vatPercent) || 0;
  const vatAmount = roundMoney((amountBeforeTax * vp) / 100);
  const totalAmount = roundMoney(amountBeforeTax + vatAmount);
  const now = Date.now();
  const actorName = actor.displayName || actor.email || actor.id;

  const baseNo =
    (cur.baseInvoiceNo || '').trim() || parseCommercialInvoiceBaseNo(cur.invoiceNo) || cur.invoiceNo;
  const prevRev = commercialInvoiceRevisionNoOf(cur);
  const nextRev = prevRev + 1;
  const nextInvoiceNo = formatCommercialInvoiceRevisionNo(baseNo, nextRev);
  const rootId = (cur.revisionRootId || '').trim() || cur.id;

  const {
    id: _omitId,
    supersededByInvoiceId: _omitSup,
    ...rest
  } = cur;

  const payload: Omit<CommercialInvoice, 'id'> = {
    ...rest,
    invoiceNo: nextInvoiceNo,
    baseInvoiceNo: baseNo,
    revisionNo: nextRev,
    revisionRootId: rootId,
    previousRevisionId: cur.id,
    status: 'DRAFT',
    lines: normalized,
    amountBeforeTax,
    vatAmount,
    totalAmount,
    notes: extra && 'notes' in extra ? (extra.notes ?? '').trim() : cur.notes,
    attachments: cur.attachments ? [...cur.attachments] : undefined,
    createdAt: now,
    createdByUid: actor.id,
    createdByName: actorName,
    updatedAt: now,
    updatedByUid: actor.id,
    updatedByName: actorName,
  };
  delete (payload as { supersededByInvoiceId?: string }).supersededByInvoiceId;
  delete (payload as { customerRevisionRequestedAt?: number }).customerRevisionRequestedAt;
  delete (payload as { customerRevisionRequestNote?: string }).customerRevisionRequestNote;
  delete (payload as { customerRevisionIssueId?: string }).customerRevisionIssueId;
  delete (payload as { sentToCustomerAt?: number }).sentToCustomerAt;
  delete (payload as { sentToCustomerByUid?: string }).sentToCustomerByUid;
  delete (payload as { sentToCustomerByName?: string }).sentToCustomerByName;

  const newRef = await addDoc(
    collection(db, 'commercial_invoices'),
    sanitizeFirestorePayload(payload as Record<string, unknown>),
  );

  await updateDoc(ref, {
    status: 'REVISED',
    supersededByInvoiceId: newRef.id,
    updatedAt: now,
    updatedByUid: actor.id,
    updatedByName: actorName,
    ...(cur.baseInvoiceNo ? {} : { baseInvoiceNo: baseNo }),
    ...(cur.revisionRootId ? {} : { revisionRootId: rootId }),
    ...(typeof cur.revisionNo === 'number' ? {} : { revisionNo: prevRev }),
  } as any);

  await writeAuditLog(db, actor, {
    actionType: 'CREATE',
    entityType: 'CommercialInvoice',
    entityId: newRef.id,
    entityLabel: `${nextInvoiceNo} ← revision ของ ${cur.invoiceNo}`,
    sourceModule: 'commercial_invoices',
    linkedIds: [cur.customerId, cur.poId, cur.waveId, cur.id],
    afterSummary: `สร้างรุ่นแก้ไข R${nextRev} จาก ${cur.invoiceNo} (ต้นฉบับเปิดดูอย่างเดียว)`,
  });

  return { id: newRef.id, invoiceNo: nextInvoiceNo, revisionNo: nextRev };
}

const ATTACH_EDITABLE_STATUSES = new Set(['DRAFT', 'PENDING_CUSTOMER']);

/** OPEC: เพิ่มเอกสารแนบให้ลูกค้าเปิดดูตอนตรวจใบวางบิล (สูงสุด 5 ไฟล์) */
export async function addCommercialInvoiceAttachment(
  db: Firestore,
  invoiceId: string,
  attachment: CommercialInvoiceAttachment,
  actor: User,
): Promise<void> {
  const ref = doc(db, 'commercial_invoices', invoiceId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('ไม่พบใบแจ้งหนี้');
  const cur = snap.data() as CommercialInvoice;
  if (!ATTACH_EDITABLE_STATUSES.has(cur.status)) {
    throw new Error('แนบเอกสารได้เฉพาะใบสถานะ DRAFT หรือรอลูกค้าตรวจ');
  }
  if (!isCommercialInvoiceLatestEditable(cur)) {
    throw new Error('เอกสารรุ่นนี้ถูกแทนที่แล้ว — แนบไฟล์ได้เฉพาะรุ่นล่าสุดเท่านั้น');
  }
  const existing = cur.attachments ?? [];
  if (existing.length >= MAX_COMMERCIAL_INVOICE_ATTACHMENTS) {
    throw new Error(`แนบได้สูงสุด ${MAX_COMMERCIAL_INVOICE_ATTACHMENTS} ไฟล์ — ลบบางรายการก่อนเพิ่ม`);
  }
  if (existing.some((a) => a.id === attachment.id)) {
    throw new Error('ไฟล์นี้มีอยู่ในรายการแล้ว');
  }
  const next = [...existing, attachment];
  const now = Date.now();
  await updateDoc(
    ref,
    sanitizeFirestorePayload({
      attachments: next,
      updatedAt: now,
      updatedByUid: actor.id,
      updatedByName: actor.displayName || actor.email || actor.id,
    }) as any,
  );
  await writeAuditLog(db, actor, {
    actionType: 'UPDATE',
    entityType: 'CommercialInvoice',
    entityId: invoiceId,
    entityLabel: `${cur.invoiceNo} → แนบเอกสาร`,
    sourceModule: 'commercial_invoices',
    linkedIds: [cur.customerId, cur.poId],
    afterSummary: `แนบ ${attachment.fileName} (${next.length}/${MAX_COMMERCIAL_INVOICE_ATTACHMENTS})`,
  });
}

/** OPEC: ลบเอกสารแนบออกจากใบแจ้งหนี้ (ลบไฟล์ Storage แยกที่ UI) */
export async function removeCommercialInvoiceAttachment(
  db: Firestore,
  invoiceId: string,
  attachmentId: string,
  actor: User,
): Promise<void> {
  const ref = doc(db, 'commercial_invoices', invoiceId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('ไม่พบใบแจ้งหนี้');
  const cur = snap.data() as CommercialInvoice;
  if (!ATTACH_EDITABLE_STATUSES.has(cur.status)) {
    throw new Error('ลบเอกสารแนบได้เฉพาะใบสถานะ DRAFT หรือรอลูกค้าตรวจ');
  }
  const next = (cur.attachments ?? []).filter((a) => a.id !== attachmentId);
  const now = Date.now();
  await updateDoc(
    ref,
    sanitizeFirestorePayload({
      attachments: next,
      updatedAt: now,
      updatedByUid: actor.id,
      updatedByName: actor.displayName || actor.email || actor.id,
    }) as any,
  );
  await writeAuditLog(db, actor, {
    actionType: 'UPDATE',
    entityType: 'CommercialInvoice',
    entityId: invoiceId,
    entityLabel: `${cur.invoiceNo} → ลบเอกสารแนบ`,
    sourceModule: 'commercial_invoices',
    linkedIds: [cur.customerId, cur.poId],
    afterSummary: `เหลือ ${next.length} ไฟล์`,
  });
}
