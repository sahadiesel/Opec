'use client';

import { addDoc, collection, doc, updateDoc, type Firestore } from 'firebase/firestore';
import type { PayrollCorrectionRequest, User } from '@/lib/types';
import { canPayrollPermission } from '@/lib/permissions';
import { writeAuditLog } from './audit-service';

function canFileCorrection(user: User): boolean {
  return (
    canPayrollPermission(user, 'payroll_worker', 'edit_batch') ||
    canPayrollPermission(user, 'payroll_office', 'edit') ||
    canPayrollPermission(user, 'payroll_office', 'submit')
  );
}

function canApproveCorrection(user: User): boolean {
  return (
    canPayrollPermission(user, 'payroll_worker', 'approve') ||
    canPayrollPermission(user, 'payroll_office', 'approve') ||
    canPayrollPermission(user, 'policy', 'edit')
  );
}

/**
 * D8 — เปิดคำขอแก้ไขหลัง approve/paid (ยังไม่แก้ line ตรง)
 * ขั้นถัดไป: manager อนุมัติ → สร้าง adjustment batch หรือ rerun (ทำในรอบถัดไป)
 */
export async function createPayrollCorrectionRequest(
  db: Firestore,
  user: User,
  input: Pick<PayrollCorrectionRequest, 'scope' | 'targetBatchOrRunId' | 'targetLineId' | 'reason'>
): Promise<string> {
  if (!canFileCorrection(user)) throw new Error('ไม่มีสิทธิ์เปิดคำขอแก้ไข payroll');
  const ref = await addDoc(collection(db, 'payroll_correction_requests'), {
    scope: input.scope,
    targetBatchOrRunId: input.targetBatchOrRunId,
    targetLineId: input.targetLineId ?? null,
    reason: input.reason,
    status: 'pending',
    requestedByUserId: user.id,
    requestedByName: user.displayName,
    requestedAt: Date.now(),
  });
  await writeAuditLog(db, user, {
    actionType: 'CREATE',
    entityType: 'PayrollCorrectionRequest',
    entityId: ref.id,
    sourceModule: 'hr',
    afterSummary: `Correction requested: ${input.reason.slice(0, 180)}`,
  });
  return ref.id;
}

export async function approvePayrollCorrectionRequest(
  db: Firestore,
  user: User,
  requestId: string,
  resolutionNotes?: string
): Promise<void> {
  if (!canApproveCorrection(user)) throw new Error('ไม่มีสิทธิ์อนุมัติคำขอแก้ไข');
  await updateDoc(doc(db, 'payroll_correction_requests', requestId), {
    status: 'approved',
    reviewedByUserId: user.id,
    reviewedByName: user.displayName,
    reviewedAt: Date.now(),
    resolutionNotes: resolutionNotes ?? null,
  });
  await writeAuditLog(db, user, {
    actionType: 'APPROVE',
    entityType: 'PayrollCorrectionRequest',
    entityId: requestId,
    sourceModule: 'hr',
    afterSummary: resolutionNotes || 'Correction request approved (await adjustment workflow)',
  });
}

export async function rejectPayrollCorrectionRequest(
  db: Firestore,
  user: User,
  requestId: string,
  resolutionNotes?: string
): Promise<void> {
  if (!canApproveCorrection(user)) throw new Error('ไม่มีสิทธิ์ปฏิเสธคำขอแก้ไข');
  await updateDoc(doc(db, 'payroll_correction_requests', requestId), {
    status: 'rejected',
    reviewedByUserId: user.id,
    reviewedByName: user.displayName,
    reviewedAt: Date.now(),
    resolutionNotes: resolutionNotes ?? null,
  });
}
