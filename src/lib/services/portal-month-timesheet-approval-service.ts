'use client';

import { deleteField, doc, type Firestore, updateDoc } from 'firebase/firestore';
import { DisputeService } from '@/lib/services/dispute-service';
import type {
  PoMonthTimesheetReview,
  User,
  WaveMonthTimesheetReview,
} from '@/lib/types';
import { sanitizeFirestorePayload } from '@/lib/utils';

function actorName(user: User): string {
  return user.displayName || user.email || user.id;
}

export async function customerApprovePoMonthReview(
  db: Firestore,
  review: PoMonthTimesheetReview,
  actor: User,
): Promise<void> {
  if (review.status !== 'approved') {
    throw new Error('Timesheet is not ready for customer approval yet');
  }
  const now = Date.now();
  await updateDoc(
    doc(db, 'po_month_timesheet_reviews', review.id),
    sanitizeFirestorePayload({
      customerApprovalStatus: 'approved',
      customerApprovedAt: now,
      customerApprovedByUid: actor.id,
      customerApprovedByName: actorName(actor),
      customerApprovalSource: 'CLIENT_PORTAL',
      customerRevisionRequestedAt: deleteField(),
      customerRevisionRequestNote: deleteField(),
      customerRevisionIssueId: deleteField(),
      updatedAt: now,
    }),
  );
}

export async function customerRequestCorrectionPoMonthReview(
  db: Firestore,
  review: PoMonthTimesheetReview,
  actor: User,
  note: string,
): Promise<string> {
  if (review.status !== 'approved') {
    throw new Error('Timesheet is not ready for customer review yet');
  }
  const trimmed = note.trim();
  if (!trimmed) throw new Error('Please describe the correction needed');

  const issueId = await new DisputeService(db).reportIssue(
    {
      category: 'TIMESHEET',
      referenceId: review.id,
      referenceNo: `${review.poId}_${review.yearMonth}`,
      description: trimmed,
    },
    actor,
  );
  const now = Date.now();
  await updateDoc(
    doc(db, 'po_month_timesheet_reviews', review.id),
    sanitizeFirestorePayload({
      customerApprovalStatus: 'correction_requested',
      customerRevisionRequestedAt: now,
      customerRevisionRequestNote: trimmed,
      customerRevisionIssueId: issueId,
      updatedAt: now,
    }),
  );
  return issueId;
}

export async function customerApproveWaveMonthReview(
  db: Firestore,
  review: WaveMonthTimesheetReview,
  actor: User,
): Promise<void> {
  if (review.status !== 'approved') {
    throw new Error('Timesheet is not ready for customer approval yet');
  }
  const now = Date.now();
  await updateDoc(
    doc(db, 'wave_month_timesheet_reviews', review.id),
    sanitizeFirestorePayload({
      customerApprovalStatus: 'approved',
      customerApprovedAt: now,
      customerApprovedByUid: actor.id,
      customerApprovedByName: actorName(actor),
      customerApprovalSource: 'CLIENT_PORTAL',
      customerRevisionRequestedAt: deleteField(),
      customerRevisionRequestNote: deleteField(),
      customerRevisionIssueId: deleteField(),
      updatedAt: now,
    }),
  );
}

export async function customerRequestCorrectionWaveMonthReview(
  db: Firestore,
  review: WaveMonthTimesheetReview,
  actor: User,
  note: string,
): Promise<string> {
  if (review.status !== 'approved') {
    throw new Error('Timesheet is not ready for customer review yet');
  }
  const trimmed = note.trim();
  if (!trimmed) throw new Error('Please describe the correction needed');

  const issueId = await new DisputeService(db).reportIssue(
    {
      category: 'TIMESHEET',
      referenceId: review.id,
      referenceNo: `${review.waveId}_${review.yearMonth}`,
      description: trimmed,
    },
    actor,
  );
  const now = Date.now();
  await updateDoc(
    doc(db, 'wave_month_timesheet_reviews', review.id),
    sanitizeFirestorePayload({
      customerApprovalStatus: 'correction_requested',
      customerRevisionRequestedAt: now,
      customerRevisionRequestNote: trimmed,
      customerRevisionIssueId: issueId,
      updatedAt: now,
    }),
  );
  return issueId;
}
