import type { Firestore } from 'firebase/firestore';
import { collection, doc, writeBatch } from 'firebase/firestore';
import type { User } from '@/lib/types';
import type { AttendanceSubjectType } from '@/lib/attendance/types';
import { ATTENDANCE_DAY_OVERRIDES_COLLECTION } from '@/lib/attendance/constants';

/** Admin-only — บันทึก override ว่าง (null/null) เพื่อไม่ให้สแกน/แก้ไขเดิมแสดงในสรุปและ payroll */
export async function adminResetAttendanceDay(input: {
  firestore: Firestore;
  currentUser: User;
  subjectType: AttendanceSubjectType;
  subjectId: string;
  payrollMonth: string;
  workDateYmd: string;
}): Promise<void> {
  const { firestore, currentUser, subjectType, subjectId, payrollMonth, workDateYmd } = input;
  const batch = writeBatch(firestore);
  const overrideRef = doc(collection(firestore, ATTENDANCE_DAY_OVERRIDES_COLLECTION));
  const now = Date.now();

  batch.set(overrideRef, {
    id: overrideRef.id,
    subjectType,
    subjectId,
    subjectKey: `${subjectType}:${subjectId}`,
    payrollMonth,
    workDateYmd,
    effectiveInAtMs: null,
    effectiveOutAtMs: null,
    correctionRequestId: 'admin_reset',
    appliedAt: now,
    appliedByUid: currentUser.id,
    appliedByName: currentUser.displayName || currentUser.email || currentUser.id,
  });

  await batch.commit();
}
