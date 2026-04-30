import { doc, type Firestore, updateDoc } from 'firebase/firestore';
import type { User } from '@/lib/types';
import { runStatusToD8Lifecycle } from '@/lib/payroll/d8';

/**
 * ฝ่ายเงินเดือน: ส่งงวด office ไปคิวผู้จัดการ (CALCULATED → HR_REVIEW)
 */
export async function submitOfficeRunForManagerReview(
  firestore: Firestore,
  runId: string,
  currentUser: User
): Promise<void> {
  const ref = doc(firestore, 'office_payroll_runs', runId);
  await updateDoc(ref, {
    status: 'HR_REVIEW' as const,
    d8LifecycleStatus: runStatusToD8Lifecycle('HR_REVIEW'),
    submittedForReviewBy: currentUser.displayName,
    submittedForReviewAt: Date.now(),
    updatedAt: Date.now(),
  });
}
