'use client';

import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import type { CommercialInvoice, DailyTimesheet, MobCycleBillingReview, TripBillingBatch, User } from '@/lib/types';
import {
  isStandbyOnlyActivityTimesheets,
  loadTimesheetsForMobCycleBilling,
  markTimesheetsReadyForBillingByMobCycles,
  syncMobCycleBillingReviewsForPo,
} from '@/lib/services/mob-cycle-billing-sync';
import { resolveBillingMode } from '@/lib/commercial/resolve-billing-mode';
import type { PurchaseOrder } from '@/lib/types';
import { sanitizeFirestorePayload } from '@/lib/utils';

const BATCH_COLLECTION = 'trip_billing_batches';
const REVIEW_COLLECTION = 'mob_cycle_billing_reviews';

export async function syncTripBillingForPo(
  db: Firestore,
  po: PurchaseOrder,
): Promise<{ reviews: number; batches: number; billingMode: string }> {
  const mode = await resolveBillingMode(db, po);
  if (mode !== 'TRIP') {
    throw new Error(`PO นี้ใช้โหมดวางบิล "${mode}" — ต้องตั้ง billingMode = TRIP ที่สัญญาหรือ PO`);
  }
  const { reviews, batches } = await syncMobCycleBillingReviewsForPo(db, po);
  return { reviews: reviews.length, batches: batches.length, billingMode: mode };
}

/** อนุมัติชุดวางบิล — ตั้ง readyForBilling + อัปเดตสถานะ review/batch */
export async function approveTripBillingBatch(
  db: Firestore,
  batchId: string,
  actor: User,
): Promise<{ updatedTimesheets: number }> {
  const ref = doc(db, BATCH_COLLECTION, batchId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('ไม่พบชุดวางบิล');
  const batch = { id: snap.id, ...(snap.data() as object) } as TripBillingBatch;

  if (batch.status === 'invoiced') throw new Error('ชุดนี้ออก invoice แล้ว');
  if (batch.status === 'void') throw new Error('ชุดนี้ถูกยกเลิกแล้ว');
  if (batch.status === 'draft') {
    throw new Error(
      'ยังมีสมาชิกที่ยังไม่จบรอบ (D1) — รอ demob ครบ หรือถ้าเป็นรอบ standby อย่างเดียวกด «ปิดรอบ SB-only» ก่อน',
    );
  }

  const { updated } = await markTimesheetsReadyForBillingByMobCycles(db, batch.memberMobCycleIds);
  const now = Date.now();
  const actorName = actor.displayName || actor.email || actor.id;

  await updateDoc(ref, {
    status: 'approved',
    reviewedAt: now,
    reviewedByUserId: actor.id,
    reviewedByName: actorName,
    updatedAt: now,
  });

  for (const mobCycleId of batch.memberMobCycleIds) {
    await setDoc(
      doc(db, REVIEW_COLLECTION, mobCycleId),
      { status: 'approved', updatedAt: now },
      { merge: true },
    );
  }

  return { updatedTimesheets: updated };
}

function lastStandbyDateFromTimesheets(timesheets: readonly DailyTimesheet[]): string | undefined {
  const days = timesheets
    .filter((t) => t.eventType === 'standby_day')
    .map((t) => String(t.date || '').slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  return days.length ? days[days.length - 1] : undefined;
}

/**
 * ปิดรอบ standby-only (ไม่มี M1/วันทำงาน/D1) — ตั้ง tripEndDate = วัน SB สุดท้าย
 * เพื่อให้ชุดวางบิลเป็น ready และสร้างใบแจ้งหนี้ได้ (ไม่คิดค่า MOB ไป-กลับ)
 */
export async function finalizeStandbyOnlyTripBatch(
  db: Firestore,
  batchId: string,
  actor: User,
): Promise<{ closedMembers: number; periodEnd: string }> {
  const ref = doc(db, BATCH_COLLECTION, batchId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('ไม่พบชุดวางบิล');
  const batch = { id: snap.id, ...(snap.data() as object) } as TripBillingBatch;

  if (batch.status === 'invoiced') throw new Error('ชุดนี้ออก invoice แล้ว');
  if (batch.status === 'void') throw new Error('ชุดนี้ถูกยกเลิกแล้ว');
  if (batch.status === 'approved' || batch.status === 'ready') {
    throw new Error('ชุดนี้พร้อมวางบิลอยู่แล้ว — กดอนุมัติ/สร้าง invoice ได้เลย');
  }
  if (batch.status !== 'draft') {
    throw new Error(`สถานะชุดวางบิลคือ ${batch.status} — ปิดรอบ SB-only ไม่ได้`);
  }

  const memberIds = [...new Set((batch.memberMobCycleIds ?? []).map((x) => String(x).trim()).filter(Boolean))];
  if (memberIds.length === 0) throw new Error('ชุดวางบิลไม่มีสมาชิก');

  const now = Date.now();
  const actorName = actor.displayName || actor.email || actor.id;
  const closedReviews: MobCycleBillingReview[] = [];

  for (const mobCycleId of memberIds) {
    const reviewSnap = await getDoc(doc(db, REVIEW_COLLECTION, mobCycleId));
    if (!reviewSnap.exists()) {
      throw new Error(`ไม่พบรีวิวรอบ ${mobCycleId}`);
    }
    const existing = { id: reviewSnap.id, ...(reviewSnap.data() as object) } as MobCycleBillingReview;
    if (existing.status === 'invoiced' || existing.status === 'void') {
      throw new Error(`${existing.workerNameSnapshot}: สถานะ ${existing.status} — ปิดรอบ SB-only ไม่ได้`);
    }

    const timesheets = await loadTimesheetsForMobCycleBilling(db, existing);
    if (!isStandbyOnlyActivityTimesheets(timesheets)) {
      throw new Error(
        `${existing.workerNameSnapshot}: ไม่ใช่รอบ standby อย่างเดียว — มี M1 / วันทำงาน / D1 แล้ว ต้องรอ demob ตามปกติ`,
      );
    }

    const lastSb = lastStandbyDateFromTimesheets(timesheets);
    if (!lastSb) {
      throw new Error(`${existing.workerNameSnapshot}: ไม่พบวัน standby ที่จะใช้ปิดรอบ`);
    }

    const tripStart = String(existing.tripStartDate || existing.tripAnchorStartDate || lastSb).slice(0, 10);
    const patch: MobCycleBillingReview = {
      ...existing,
      tripEndDate: lastSb,
      spansYearMonths: undefined,
      status: 'pending_billing',
      standbyOnlyClosed: true,
      standbyOnlyClosedAt: now,
      standbyOnlyClosedByName: actorName,
      updatedAt: now,
    };

    // spansYearMonths — compute simple
    const months: string[] = [];
    {
      let [y, m] = tripStart.slice(0, 7).split('-').map(Number);
      const [ey, em] = lastSb.slice(0, 7).split('-').map(Number);
      while (y < ey || (y === ey && m <= em)) {
        months.push(`${y}-${String(m).padStart(2, '0')}`);
        m += 1;
        if (m > 12) {
          m = 1;
          y += 1;
        }
      }
    }
    patch.spansYearMonths = months;
    patch.tripStartDate = tripStart;

    await setDoc(
      doc(db, REVIEW_COLLECTION, mobCycleId),
      sanitizeFirestorePayload(patch as unknown as Record<string, unknown>),
      { merge: true },
    );
    closedReviews.push(patch);
  }

  const periodStart = closedReviews.reduce(
    (min, r) => (r.tripStartDate < min ? r.tripStartDate : min),
    closedReviews[0]!.tripStartDate,
  );
  const periodEnd = closedReviews.reduce(
    (max, r) => ((r.tripEndDate ?? '') > max ? (r.tripEndDate as string) : max),
    closedReviews[0]!.tripEndDate!,
  );

  await updateDoc(ref, {
    periodStart,
    periodEnd,
    status: 'ready',
    notes: [batch.notes, `ปิดรอบ SB-only โดย ${actorName}`].filter(Boolean).join(' · ').slice(0, 500),
    updatedAt: now,
  });

  return { closedMembers: closedReviews.length, periodEnd };
}

/** ชุดวางบิลเป็นรอบ standby-only ที่ปิดแล้วทุกคน — ไม่ต้องคิดค่า MOB ไป-กลับ */
export async function isStandbyOnlyClosedTripBatch(
  db: Firestore,
  memberMobCycleIds: readonly string[],
): Promise<boolean> {
  const ids = [...new Set(memberMobCycleIds.map((x) => String(x).trim()).filter(Boolean))];
  if (ids.length === 0) return false;
  for (const id of ids) {
    const snap = await getDoc(doc(db, REVIEW_COLLECTION, id));
    if (!snap.exists()) return false;
    const r = snap.data() as MobCycleBillingReview;
    if (!r.standbyOnlyClosed) return false;
  }
  return true;
}

export async function markTripBatchInvoiced(
  db: Firestore,
  batchId: string,
  commercialInvoiceId: string,
): Promise<void> {
  const now = Date.now();
  const ref = doc(db, BATCH_COLLECTION, batchId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const batch = snap.data() as TripBillingBatch;

  await updateDoc(ref, {
    status: 'invoiced',
    sourceCommercialInvoiceId: commercialInvoiceId,
    updatedAt: now,
  });

  for (const mobCycleId of batch.memberMobCycleIds ?? []) {
    await setDoc(
      doc(db, REVIEW_COLLECTION, mobCycleId),
      { status: 'invoiced', updatedAt: now },
      { merge: true },
    );
  }
}

/** ใบแจ้งหนี้ trip batch ยังใช้งานได้ (มีเอกสารและไม่ VOID) */
export async function isTripBatchCommercialInvoiceActive(
  db: Firestore,
  batch: Pick<TripBillingBatch, 'id' | 'sourceCommercialInvoiceId'>,
): Promise<boolean> {
  if (batch.sourceCommercialInvoiceId) {
    const snap = await getDoc(
      doc(db, 'commercial_invoices', batch.sourceCommercialInvoiceId),
    );
    if (snap.exists()) {
      const inv = snap.data() as CommercialInvoice;
      if (inv.status !== 'VOID') return true;
    }
  }
  const q = query(
    collection(db, 'commercial_invoices'),
    where('sourceTripBillingBatchId', '==', batch.id),
  );
  const snap = await getDocs(q);
  for (const d of snap.docs) {
    const inv = d.data() as CommercialInvoice;
    if (inv.status !== 'VOID') return true;
  }
  return false;
}

/**
 * คืนสถานะชุดวางบิลเมื่อใบแจ้งหนี้ถูกยกเลิก/ลบ — ให้สร้าง invoice ใหม่ได้
 */
export async function releaseTripBillingBatchAfterInvoiceRemoved(
  db: Firestore,
  batchId: string,
): Promise<void> {
  const ref = doc(db, BATCH_COLLECTION, batchId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const batch = { id: snap.id, ...(snap.data() as object) } as TripBillingBatch;
  if (batch.status !== 'invoiced') return;

  const now = Date.now();
  await updateDoc(ref, {
    status: 'approved',
    sourceCommercialInvoiceId: deleteField(),
    updatedAt: now,
  });

  for (const mobCycleId of batch.memberMobCycleIds ?? []) {
    await setDoc(
      doc(db, REVIEW_COLLECTION, mobCycleId),
      { status: 'approved', updatedAt: now },
      { merge: true },
    );
  }
}
