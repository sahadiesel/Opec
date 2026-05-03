'use client';

import type { Firestore } from 'firebase/firestore';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import type { OfficeStaff, Worker } from '@/lib/types';

export type LinkedPersonnel =
  | { kind: 'office_staff'; record: OfficeStaff }
  | { kind: 'worker'; record: Worker };

/** ค้นหาทะเบียนที่ผูกกับบัญชีล็อกอิน (linkedUserId) */
export async function fetchLinkedPersonnelForUser(
  db: Firestore,
  uid: string,
): Promise<LinkedPersonnel | null> {
  const staffQ = query(collection(db, 'office_staff'), where('linkedUserId', '==', uid), limit(1));
  const staffSnap = await getDocs(staffQ);
  if (!staffSnap.empty) {
    const d = staffSnap.docs[0];
    return { kind: 'office_staff', record: { id: d.id, ...(d.data() as object) } as OfficeStaff };
  }
  const workerQ = query(collection(db, 'workers'), where('linkedUserId', '==', uid), limit(1));
  const workerSnap = await getDocs(workerQ);
  if (!workerSnap.empty) {
    const d = workerSnap.docs[0];
    return { kind: 'worker', record: { id: d.id, ...(d.data() as object) } as Worker };
  }
  return null;
}

export async function resolveSubjectLinkedUserId(
  db: Firestore,
  subjectType: 'worker' | 'office_staff',
  subjectId: string,
): Promise<string | null> {
  const col = subjectType === 'worker' ? 'workers' : 'office_staff';
  const d = await getDoc(doc(db, col, subjectId));
  if (!d.exists()) return null;
  const data = d.data() as { linkedUserId?: string };
  return typeof data.linkedUserId === 'string' && data.linkedUserId.trim() ? data.linkedUserId.trim() : null;
}
