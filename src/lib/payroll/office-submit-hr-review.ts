import { doc, getDoc, type Firestore, updateDoc } from 'firebase/firestore';
import type { OfficePayrollRun, User } from '@/lib/types';
import { runStatusToD8Lifecycle } from '@/lib/payroll/d8';
import { canSubmitOfficeRunForManagerReview } from '@/lib/permission-core';

/**
 * ฝ่ายเงินเดือน: ส่งงวด office ไปคิวผู้จัดการ (CALCULATED → HR_REVIEW)
 */
export async function submitOfficeRunForManagerReview(
  firestore: Firestore,
  runId: string,
  currentUser: User
): Promise<void> {
  if (!canSubmitOfficeRunForManagerReview(currentUser)) {
    throw new Error('เฉพาะฝ่ายเงินเดือน / HR manager หรือผู้ดูแลระบบเท่านั้นที่ส่งขออนุมัติได้');
  }

  const ref = doc(firestore, 'office_payroll_runs', runId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('ไม่พบงวดเงินเดือน');
  const run = { id: snap.id, ...snap.data() } as OfficePayrollRun;

  if (run.status !== 'CALCULATED') {
    throw new Error('ส่งขออนุมัติได้เฉพาะงวดที่คำนวณแล้ว (สถานะ CALCULATED)');
  }
  if (!run.staffCount || run.staffCount <= 0) {
    throw new Error('งวดนี้ยังไม่มีรายการจ่าย — กดคำนวณก่อนส่งอนุมัติ');
  }

  await updateDoc(ref, {
    status: 'HR_REVIEW' as const,
    d8LifecycleStatus: runStatusToD8Lifecycle('HR_REVIEW'),
    submittedForReviewBy: currentUser.displayName,
    submittedForReviewAt: Date.now(),
    updatedAt: Date.now(),
  });
}
