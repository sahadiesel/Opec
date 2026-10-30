'use client';

import { collection, doc, getDoc, getDocs, query, where, type Firestore } from 'firebase/firestore';
import type { CommercialInvoice, DailyTimesheet, MobCycleBillingReview, TripBillingBatch } from '@/lib/types';
import { commercialInvoiceCoversAnyWorker } from '@/lib/commercial/partial-po-month-billing';
import { isCommercialInvoiceSuperseded } from '@/lib/commercial/commercial-invoice-revision';
import {
  asIsoYmd,
  evaluateTripPeriodSelection,
  suggestedTripWindowFromEventDates,
  tripInvoiceStatusIsCollected,
  ymdRangesOverlap,
  type TripPeriodEvaluation,
  type TripPeriodOverlapHit,
  type TripPeriodYmdRange,
} from '@/lib/commercial/trip-invoice-period';
import { loadTimesheetsForMobCycleBilling } from '@/lib/services/mob-cycle-billing-sync';

type TripReadyWorkerRef = {
  kind: string;
  tripBatchId?: string;
  workerId: string;
  poId: string;
};

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((x) => String(x || '').trim()).filter(Boolean))];
}

function eventDatesFromTimesheets(
  timesheets: readonly DailyTimesheet[],
  eventType: string,
): string[] {
  return timesheets
    .filter((t) => t.eventType === eventType)
    .map((t) => asIsoYmd(t.date))
    .filter(Boolean);
}

export function suggestedTripWindowFromTimesheets(timesheets: readonly DailyTimesheet[]): {
  suggestedStart: string;
  suggestedEnd: string;
  lastD1: string;
  firstM1: string;
} {
  const activityDates = timesheets.map((t) => asIsoYmd(t.date)).filter(Boolean);
  return suggestedTripWindowFromEventDates({
    m1Dates: eventDatesFromTimesheets(timesheets, 'mobilization_day'),
    d1Dates: eventDatesFromTimesheets(timesheets, 'demobilization_day'),
    activityDates,
  });
}

async function loadTimesheetsForCycleIds(
  db: Firestore,
  mobCycleIds: readonly string[],
  workerIds?: readonly string[],
): Promise<DailyTimesheet[]> {
  const allow = new Set(uniqueIds(workerIds ?? []));
  const out: DailyTimesheet[] = [];
  for (const cycleId of uniqueIds(mobCycleIds)) {
    const snap = await getDoc(doc(db, 'mob_cycle_billing_reviews', cycleId));
    if (!snap.exists()) continue;
    const review = { id: snap.id, ...(snap.data() as object) } as MobCycleBillingReview;
    if (allow.size > 0 && !allow.has(String(review.workerId || '').trim())) continue;
    const rows = await loadTimesheetsForMobCycleBilling(db, review);
    out.push(...rows);
  }
  return out;
}

async function mobCycleIdsForReadyWorkers(
  db: Firestore,
  workers: readonly TripReadyWorkerRef[],
): Promise<{ cycleIds: string[]; workerIds: string[]; poIds: string[]; customerHintPoIds: string[] }> {
  const trip = workers.filter((w) => w.kind === 'trip' && w.tripBatchId);
  const workerIds = uniqueIds(trip.map((w) => w.workerId));
  const poIds = uniqueIds(trip.map((w) => w.poId));
  const selected = new Set(workerIds);
  const cycleIds: string[] = [];
  for (const batchId of uniqueIds(trip.map((w) => w.tripBatchId || ''))) {
    const snap = await getDoc(doc(db, 'trip_billing_batches', batchId));
    if (!snap.exists()) continue;
    const batch = snap.data() as TripBillingBatch;
    const members = uniqueIds(batch.memberMobCycleIds ?? []);
    if (members.length === 0) continue;
    for (const id of members) {
      const reviewSnap = await getDoc(doc(db, 'mob_cycle_billing_reviews', id));
      if (!reviewSnap.exists()) continue;
      const wid = String((reviewSnap.data() as MobCycleBillingReview).workerId || '').trim();
      if (selected.size > 0 && !selected.has(wid)) continue;
      cycleIds.push(id);
    }
  }
  return { cycleIds: uniqueIds(cycleIds), workerIds, poIds, customerHintPoIds: poIds };
}

export async function listTripPeriodOverlappingInvoices(
  db: Firestore,
  params: {
    poIds: readonly string[];
    workerIds: readonly string[];
    startYmd: string;
    endYmd: string;
    ignoreInvoiceId?: string;
  },
): Promise<TripPeriodOverlapHit[]> {
  const poIds = uniqueIds(params.poIds);
  const workerIds = uniqueIds(params.workerIds);
  const start = asIsoYmd(params.startYmd);
  const end = asIsoYmd(params.endYmd);
  const ignore = String(params.ignoreInvoiceId || '').trim();
  if (poIds.length === 0 || workerIds.length === 0 || !start || !end) return [];

  const byId = new Map<string, CommercialInvoice>();
  for (const poId of poIds) {
    const snap = await getDocs(query(collection(db, 'commercial_invoices'), where('poId', '==', poId)));
    for (const d of snap.docs) {
      byId.set(d.id, { id: d.id, ...(d.data() as object) } as CommercialInvoice);
    }
    const srcSnap = await getDocs(
      query(collection(db, 'commercial_invoices'), where('sourcePoIds', 'array-contains', poId)),
    );
    for (const d of srcSnap.docs) {
      byId.set(d.id, { id: d.id, ...(d.data() as object) } as CommercialInvoice);
    }
  }

  const hits: TripPeriodOverlapHit[] = [];
  for (const inv of byId.values()) {
    if (inv.id === ignore) continue;
    if (inv.status === 'VOID' || inv.status === 'REVISED') continue;
    if (isCommercialInvoiceSuperseded(inv)) continue;
    if (!ymdRangesOverlap(inv.periodStart, inv.periodEnd, start, end)) continue;
    const hitWorkers = workerIds.filter((w) => commercialInvoiceCoversAnyWorker(inv, w));
    if (hitWorkers.length === 0) continue;
    hits.push({
      invoiceId: inv.id,
      invoiceNo: inv.invoiceNo || inv.id,
      status: inv.status,
      periodStart: asIsoYmd(inv.periodStart),
      periodEnd: asIsoYmd(inv.periodEnd),
      collected: tripInvoiceStatusIsCollected(inv.status),
    });
  }
  return hits;
}

export async function previewTripInvoicePeriodForReadyWorkers(
  db: Firestore,
  workers: readonly TripReadyWorkerRef[],
): Promise<{
  range: TripPeriodYmdRange;
  lastD1: string;
  firstM1: string;
  cycleIds: string[];
  workerIds: string[];
  poIds: string[];
} | null> {
  const trip = workers.filter((w) => w.kind === 'trip');
  if (trip.length === 0) return null;
  const ctx = await mobCycleIdsForReadyWorkers(db, trip);
  const timesheets = await loadTimesheetsForCycleIds(db, ctx.cycleIds, ctx.workerIds);
  const window = suggestedTripWindowFromTimesheets(timesheets);
  if (!window.suggestedStart || !window.suggestedEnd) return null;
  return {
    range: { startYmd: window.suggestedStart, endYmd: window.suggestedEnd },
    lastD1: window.lastD1,
    firstM1: window.firstM1,
    cycleIds: ctx.cycleIds,
    workerIds: ctx.workerIds,
    poIds: ctx.poIds,
  };
}

export async function previewTripInvoicePeriodForInvoice(
  db: Firestore,
  params: {
    mobCycleIds: readonly string[];
    workerIds: readonly string[];
    poIds: readonly string[];
  },
): Promise<{
  range: TripPeriodYmdRange;
  lastD1: string;
  firstM1: string;
} | null> {
  const timesheets = await loadTimesheetsForCycleIds(db, params.mobCycleIds, params.workerIds);
  const window = suggestedTripWindowFromTimesheets(timesheets);
  if (!window.suggestedStart || !window.suggestedEnd) return null;
  return { range: { startYmd: window.suggestedStart, endYmd: window.suggestedEnd }, lastD1: window.lastD1, firstM1: window.firstM1 };
}

export async function evaluateTripInvoicePeriod(
  db: Firestore,
  params: {
    startYmd: string;
    endYmd: string;
    poIds: readonly string[];
    workerIds: readonly string[];
    suggestedStart: string;
    suggestedEnd: string;
    lastD1: string;
    ignoreInvoiceId?: string;
  },
): Promise<TripPeriodEvaluation> {
  const overlaps = await listTripPeriodOverlappingInvoices(db, {
    poIds: params.poIds,
    workerIds: params.workerIds,
    startYmd: params.startYmd,
    endYmd: params.endYmd,
    ignoreInvoiceId: params.ignoreInvoiceId,
  });
  return evaluateTripPeriodSelection({
    startYmd: params.startYmd,
    endYmd: params.endYmd,
    suggestedStart: params.suggestedStart,
    suggestedEnd: params.suggestedEnd,
    lastD1: params.lastD1,
    overlaps,
  });
}

export async function assertTripInvoicePeriodAllowed(
  db: Firestore,
  params: {
    startYmd: string;
    endYmd: string;
    poIds: readonly string[];
    workerIds: readonly string[];
    suggestedStart?: string;
    suggestedEnd?: string;
    lastD1?: string;
    mobCycleIds?: readonly string[];
    ignoreInvoiceId?: string;
    acknowledgeWarnings?: boolean;
  },
): Promise<TripPeriodEvaluation> {
  let suggestedStart = asIsoYmd(params.suggestedStart);
  let suggestedEnd = asIsoYmd(params.suggestedEnd);
  let lastD1 = asIsoYmd(params.lastD1);
  if ((!suggestedStart || !lastD1) && (params.mobCycleIds?.length ?? 0) > 0) {
    const window = suggestedTripWindowFromTimesheets(
      await loadTimesheetsForCycleIds(db, params.mobCycleIds ?? [], params.workerIds),
    );
    if (!suggestedStart) suggestedStart = window.suggestedStart;
    if (!suggestedEnd) suggestedEnd = window.suggestedEnd;
    if (!lastD1) lastD1 = window.lastD1;
  }
  const evaluation = await evaluateTripInvoicePeriod(db, {
    startYmd: params.startYmd,
    endYmd: params.endYmd,
    poIds: params.poIds,
    workerIds: params.workerIds,
    suggestedStart,
    suggestedEnd,
    lastD1,
    ignoreInvoiceId: params.ignoreInvoiceId,
  });
  if (evaluation.blockMessage) throw new Error(evaluation.blockMessage);
  if (evaluation.confirmMessages.length > 0 && !params.acknowledgeWarnings) {
    throw new Error(evaluation.confirmMessages.join(' '));
  }
  return evaluation;
}
