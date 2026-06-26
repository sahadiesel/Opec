'use client';

import { doc, getDoc, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import type { TripBillingBatch, User } from '@/lib/types';
import {
  markTimesheetsReadyForBillingByMobCycles,
  syncMobCycleBillingReviewsForPo,
} from '@/lib/services/mob-cycle-billing-sync';
import { resolveBillingMode } from '@/lib/commercial/resolve-billing-mode';
import type { PurchaseOrder } from '@/lib/types';

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
      'ยังมีสมาชิกที่ยังไม่จบรอบ (D1) — รอให้ทุกคนในกลุ่ม demob ก่อนอนุมัติวางบิล',
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
