'use client';

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import type {
  Assignment,
  DailyTimesheet,
  MobCycleBillingReview,
  MobCycleBillingReviewStatus,
  PurchaseOrder,
  TripBillingBatch,
  TripBillingBatchStatus,
} from '@/lib/types';
import { buildMobCycleDocId } from '@/lib/ops/mob-cycle-ids';

const REVIEW_COLLECTION = 'mob_cycle_billing_reviews';
const BATCH_COLLECTION = 'trip_billing_batches';

function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** คีย์จัดกลุ่ม batch — คนที่ M1 วันเดียวกัน + PO + wave → invoice เดียว */
export function tripBillingBatchDocId(
  poId: string,
  waveId: string | undefined,
  tripAnchorStartDate: string,
): string {
  const w = (waveId || '_all').replace(/[^a-zA-Z0-9_-]/g, '_');
  const d = tripAnchorStartDate.replace(/[^0-9-]/g, '');
  return `${poId}__${w}__${d}`.slice(0, 150);
}

function yearMonthsBetween(startYmd: string, endYmd: string): string[] {
  const out = new Set<string>();
  const s = startYmd.slice(0, 7);
  const e = endYmd.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(s) || !/^\d{4}-\d{2}$/.test(e)) return s ? [s] : [];
  let [y, m] = s.split('-').map(Number);
  const [ey, em] = e.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.add(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return [...out];
}

function resolveMobCycleId(a: Assignment, cycleNumber?: number): string {
  const n = cycleNumber ?? a.mobCycleNumber ?? 1;
  if (cycleNumber == null) {
    const explicit = String(a.mobCycleId || '').trim();
    if (explicit) return explicit;
  }
  return buildMobCycleDocId(a.id, n);
}

function parseCycleNumberFromMobCycleId(mobCycleId: string): number | null {
  const m = String(mobCycleId || '').match(/_c(\d+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

function deriveReviewStatus(
  tripEndDate: string | undefined,
  existing?: MobCycleBillingReviewStatus,
): MobCycleBillingReviewStatus {
  if (existing === 'invoiced' || existing === 'void') return existing;
  if (existing === 'approved') return 'approved';
  if (tripEndDate) return 'pending_billing';
  return 'open';
}

function deriveBatchStatus(
  reviews: MobCycleBillingReview[],
  existing?: TripBillingBatchStatus,
): TripBillingBatchStatus {
  if (existing === 'invoiced' || existing === 'void') return existing;
  if (existing === 'approved') return 'approved';
  if (existing === 'pending_manager') return 'pending_manager';

  const active = reviews.filter((r) => r.status !== 'void' && r.status !== 'invoiced');
  if (active.length === 0) return existing ?? 'draft';
  const allReady = active.every((r) => r.status === 'pending_billing' || r.status === 'approved');
  return allReady ? 'ready' : 'draft';
}

/** โหลด timesheet ทั้งหมดของ assignment — PO Daily Board มักไม่ใส่ mobCycleId */
async function loadTimesheetsForAssignment(
  db: Firestore,
  assignmentId: string,
): Promise<DailyTimesheet[]> {
  const snap = await getDocs(
    query(collection(db, 'daily_timesheets'), where('assignmentId', '==', assignmentId)),
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) } as DailyTimesheet));
}

/** แยก timesheet ตามรอบ mobilization */
function filterTimesheetsForCycle(
  allTimesheets: DailyTimesheet[],
  assignment: Assignment,
  cycleNumber: number,
): DailyTimesheet[] {
  const mobCycleId = buildMobCycleDocId(assignment.id, cycleNumber);
  const currentCycle = Math.max(1, assignment.mobCycleNumber ?? 1);
  const finishYmd = String(assignment.mobLocationEndDate || '').slice(0, 10);

  return allTimesheets.filter((ts) => {
    const tsMob = String(ts.mobCycleId || '').trim();
    if (tsMob) return tsMob === mobCycleId;

    const date = String(ts.date || '').slice(0, 10);
    if (!date) return false;

    if (cycleNumber < currentCycle) {
      return finishYmd ? date <= finishYmd : cycleNumber === 1;
    }
    if (cycleNumber === currentCycle) {
      if (currentCycle === 1 || !finishYmd) return true;
      return date > finishYmd;
    }
    return false;
  });
}

function listCycleNumbersToSync(
  assignment: Assignment,
  allTimesheets: DailyTimesheet[],
  existingReviews: MobCycleBillingReview[],
): number[] {
  const cycles = new Set<number>();
  const current = Math.max(1, assignment.mobCycleNumber ?? 1);
  for (let n = 1; n <= current; n += 1) cycles.add(n);

  for (const ts of allTimesheets) {
    const fromId = parseCycleNumberFromMobCycleId(String(ts.mobCycleId || ''));
    if (fromId) cycles.add(fromId);
  }

  for (const r of existingReviews) {
    if (r.assignmentId !== assignment.id) continue;
    const fromReview = parseCycleNumberFromMobCycleId(r.mobCycleId);
    if (fromReview) cycles.add(fromReview);
  }

  return [...cycles].sort((a, b) => a - b);
}

function buildReviewFromTimesheets(
  assignment: Assignment,
  po: PurchaseOrder,
  mobCycleId: string,
  timesheets: DailyTimesheet[],
  existing: MobCycleBillingReview | undefined,
  now: number,
): MobCycleBillingReview | null {
  const mobDays = timesheets
    .filter((t) => t.eventType === 'mobilization_day')
    .map((t) => String(t.date || '').slice(0, 10))
    .filter(Boolean)
    .sort();
  const demobDays = timesheets
    .filter((t) => t.eventType === 'demobilization_day')
    .map((t) => String(t.date || '').slice(0, 10))
    .filter(Boolean)
    .sort();

  let tripAnchorStartDate =
    mobDays[0] ||
    String(assignment.mobStandbyDate || '').slice(0, 10) ||
    String(assignment.mobWorkingStartDate || '').slice(0, 10) ||
    String(assignment.startDate || '').slice(0, 10);

  if (!tripAnchorStartDate && timesheets.length > 0) {
    tripAnchorStartDate = [...timesheets.map((t) => t.date)].sort()[0];
  }
  if (!tripAnchorStartDate) return null;

  const tripStartDate = tripAnchorStartDate;
  const tripEndDate = demobDays.length ? demobDays[demobDays.length - 1] : undefined;
  const spansYearMonths =
    tripEndDate != null
      ? yearMonthsBetween(tripStartDate, tripEndDate)
      : yearMonthsBetween(tripStartDate, tripStartDate);

  const status = deriveReviewStatus(tripEndDate, existing?.status);
  const batchId = tripBillingBatchDocId(po.id, assignment.waveId, tripAnchorStartDate);

  const demobTs = timesheets.find((t) => t.eventType === 'demobilization_day');

  return {
    id: mobCycleId,
    mobCycleId,
    assignmentId: assignment.id,
    workerId: assignment.workerId,
    workerNameSnapshot: String(assignment.workerName || assignment.workerId),
    poId: po.id,
    contractId: po.contractId,
    customerId: po.customerId,
    waveId: assignment.waveId,
    positionId: undefined,
    tripAnchorStartDate,
    tripStartDate,
    tripEndDate,
    spansYearMonths,
    status,
    tripBillingBatchId: batchId,
    demobilizationTimesheetId: demobTs?.id,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

/** ซิงก์ review ต่อ mobilization ใต้ PO — อ่านจาก timesheets + assignment */
export async function syncMobCycleBillingReviewsForPo(
  db: Firestore,
  po: PurchaseOrder,
): Promise<{ reviews: MobCycleBillingReview[]; batches: TripBillingBatch[] }> {
  const now = Date.now();
  const mobSnap = await getDocs(query(collection(db, 'mobilizations'), where('poId', '==', po.id)));

  const existingReviewSnaps = await getDocs(
    query(collection(db, REVIEW_COLLECTION), where('poId', '==', po.id)),
  );
  const existingByMob = new Map<string, MobCycleBillingReview>();
  const existingForPo: MobCycleBillingReview[] = [];
  for (const d of existingReviewSnaps.docs) {
    const review = { id: d.id, ...(d.data() as object) } as MobCycleBillingReview;
    existingByMob.set(d.id, review);
    existingForPo.push(review);
  }

  const reviews: MobCycleBillingReview[] = [];

  for (const d of mobSnap.docs) {
    const assignment = { id: d.id, ...(d.data() as object) } as Assignment;
    const allTimesheets = await loadTimesheetsForAssignment(db, assignment.id);
    const assignmentReviews = existingForPo.filter((r) => r.assignmentId === assignment.id);
    const cycleNumbers = listCycleNumbersToSync(assignment, allTimesheets, assignmentReviews);

    for (const cycleNumber of cycleNumbers) {
      const mobCycleId = resolveMobCycleId(assignment, cycleNumber);
      const timesheets = filterTimesheetsForCycle(allTimesheets, assignment, cycleNumber);
      const existing = existingByMob.get(mobCycleId);
      const review = buildReviewFromTimesheets(
        assignment,
        po,
        mobCycleId,
        timesheets,
        existing,
        now,
      );
      if (!review) continue;
      await setDoc(doc(db, REVIEW_COLLECTION, review.id), review, { merge: true });
      reviews.push(review);
    }
  }

  const batches = await syncTripBillingBatchesForPo(db, po, reviews, now);
  return { reviews, batches };
}

async function syncTripBillingBatchesForPo(
  db: Firestore,
  po: PurchaseOrder,
  reviews: MobCycleBillingReview[],
  now: number,
): Promise<TripBillingBatch[]> {
  const byBatch = new Map<string, MobCycleBillingReview[]>();
  for (const r of reviews) {
    if (r.status === 'void') continue;
    const key = r.tripBillingBatchId || tripBillingBatchDocId(po.id, r.waveId, r.tripAnchorStartDate);
    const list = byBatch.get(key) ?? [];
    list.push(r);
    byBatch.set(key, list);
  }

  const existingBatchSnaps = await getDocs(
    query(collection(db, BATCH_COLLECTION), where('poId', '==', po.id)),
  );
  const existingById = new Map<string, TripBillingBatch>();
  for (const d of existingBatchSnaps.docs) {
    existingById.set(d.id, { id: d.id, ...(d.data() as object) } as TripBillingBatch);
  }

  const batches: TripBillingBatch[] = [];

  for (const [batchId, members] of byBatch) {
    const anchor = members[0]?.tripAnchorStartDate ?? '';
    const waveId = members[0]?.waveId;
    const periodStart = members.reduce(
      (min, m) => (m.tripStartDate < min ? m.tripStartDate : min),
      members[0]?.tripStartDate ?? anchor,
    );
    const ended = members.filter((m) => m.tripEndDate);
    const periodEnd =
      ended.length > 0
        ? ended.reduce(
            (max, m) => ((m.tripEndDate ?? '') > max ? (m.tripEndDate as string) : max),
            ended[0]!.tripEndDate!,
          )
        : undefined;

    const existing = existingById.get(batchId);
    const status = deriveBatchStatus(members, existing?.status);

    const batch: TripBillingBatch = {
      id: batchId,
      poId: po.id,
      contractId: po.contractId,
      customerId: po.customerId,
      waveId,
      tripAnchorStartDate: anchor,
      memberMobCycleIds: members.map((m) => m.mobCycleId),
      memberWorkerIds: members.map((m) => m.workerId),
      memberWorkerNames: members.map((m) => m.workerNameSnapshot),
      periodStart,
      periodEnd,
      status,
      sourceCommercialInvoiceId: existing?.sourceCommercialInvoiceId,
      submittedAt: existing?.submittedAt,
      reviewedAt: existing?.reviewedAt,
      reviewedByUserId: existing?.reviewedByUserId,
      reviewedByName: existing?.reviewedByName,
      notes: existing?.notes,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await setDoc(doc(db, BATCH_COLLECTION, batch.id), batch, { merge: true });
    batches.push(batch);
  }

  return batches;
}

/** โหลด batch ทั้งหมดของ PO (หลังซิงก์หรือ refresh) */
export async function loadTripBillingBatchesForPo(
  db: Firestore,
  poId: string,
): Promise<TripBillingBatch[]> {
  const snap = await getDocs(query(collection(db, BATCH_COLLECTION), where('poId', '==', poId)));
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as object) } as TripBillingBatch))
    .sort((a, b) => b.tripAnchorStartDate.localeCompare(a.tripAnchorStartDate));
}

export async function loadMobCycleBillingReviewsForPo(
  db: Firestore,
  poId: string,
): Promise<MobCycleBillingReview[]> {
  const snap = await getDocs(query(collection(db, REVIEW_COLLECTION), where('poId', '==', poId)));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) } as MobCycleBillingReview));
}

async function markAssignmentTimesheetsReadyForBilling(
  db: Firestore,
  review: MobCycleBillingReview,
  ts: number,
  seenIds: Set<string>,
): Promise<number> {
  const { writeBatch } = await import('firebase/firestore');
  const start = review.tripStartDate;
  const end = review.tripEndDate || review.tripStartDate;
  if (!review.assignmentId || !start) return 0;

  const snap = await getDocs(
    query(
      collection(db, 'daily_timesheets'),
      where('assignmentId', '==', review.assignmentId),
      where('date', '>=', start),
      where('date', '<=', end),
    ),
  );

  let updated = 0;
  let batch = writeBatch(db);
  let n = 0;
  for (const d of snap.docs) {
    if (seenIds.has(d.id)) continue;
    const data = d.data();
    if (data.status === 'LOCKED') continue;
    batch.update(d.ref, { readyForBilling: true, updatedAt: ts });
    seenIds.add(d.id);
    updated++;
    n++;
    if (n >= 400) {
      await batch.commit();
      batch = writeBatch(db);
      n = 0;
    }
  }
  if (n > 0) await batch.commit();
  return updated;
}

/** ตั้ง readyForBilling ให้ timesheet ใน mob cycles (หลังอนุมัติ batch) */
export async function markTimesheetsReadyForBillingByMobCycles(
  db: Firestore,
  mobCycleIds: readonly string[],
): Promise<{ updated: number }> {
  const ids = [...new Set(mobCycleIds.map((x) => String(x).trim()).filter(Boolean))];
  if (ids.length === 0) return { updated: 0 };

  const { writeBatch } = await import('firebase/firestore');
  let updated = 0;
  const ts = Date.now();
  const seenIds = new Set<string>();

  for (const chunkIds of chunk(ids, 10)) {
    const snap = await getDocs(
      query(collection(db, 'daily_timesheets'), where('mobCycleId', 'in', chunkIds)),
    );
    let batch = writeBatch(db);
    let n = 0;
    for (const d of snap.docs) {
      if (seenIds.has(d.id)) continue;
      const data = d.data();
      if (data.status === 'LOCKED') continue;
      batch.update(d.ref, { readyForBilling: true, updatedAt: ts });
      seenIds.add(d.id);
      updated++;
      n++;
      if (n >= 400) {
        await batch.commit();
        batch = writeBatch(db);
        n = 0;
      }
    }
    if (n > 0) await batch.commit();
  }

  for (const mobCycleId of ids) {
    const reviewSnap = await getDoc(doc(db, REVIEW_COLLECTION, mobCycleId));
    if (!reviewSnap.exists()) continue;
    const review = { id: reviewSnap.id, ...(reviewSnap.data() as object) } as MobCycleBillingReview;
    updated += await markAssignmentTimesheetsReadyForBilling(db, review, ts, seenIds);
  }

  return { updated };
}
