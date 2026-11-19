import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type { Assignment, Worker } from '@/lib/types';

/** ตำแหน่งที่ใช้กับงานที่ยังไม่ปิด — ทะเบียนลูกจ้างล่าสุดมาก่อนตำแหน่งที่จำตอนมอบหมาย */
export function openMobPositionId(
  assignment: Pick<Assignment, 'positionId'>,
  worker: Pick<Worker, 'currentPositionId'> | null | undefined,
): string {
  const current = (worker?.currentPositionId || '').trim();
  if (current) return current;
  return (assignment.positionId || '').trim();
}

export function mobStillUsesRegistryPosition(
  assignment: Pick<Assignment, 'deploymentStatus' | 'unassignedAt'>,
): boolean {
  if (assignment.unassignedAt) return false;
  const status = (assignment.deploymentStatus || '').toUpperCase();
  return status !== 'DEMOBILIZED' && status !== 'CLOSED';
}

/**
 * ก่อน mob ถ้าเปลี่ยนตำแหน่งในทะเบียน งานที่ยังไม่มีวันถูก payroll lock
 * ต้องใช้ตำแหน่งนั้นทั้งใบมอบหมายและ timesheet — บิลกับค่าแรงอ่าน positionId บนแถวรายวัน
 * วันไหน LOCKED แล้วไม่ทับ
 */
/** งานที่ยังไม่ปิดใช้ตำแหน่งทะเบียนล่าสุดตอนเขียน timesheet — กัน auto daily ทับกลับเป็นตำแหน่งเก่า */
export async function assignmentUsingRegistryPosition<T extends Assignment>(
  db: Firestore,
  assignment: T,
): Promise<T> {
  if (!assignment.id || !assignment.workerId || !mobStillUsesRegistryPosition(assignment)) {
    return assignment;
  }
  const wSnap = await getDoc(doc(db, 'workers', assignment.workerId));
  const worker = wSnap.exists() ? (wSnap.data() as Pick<Worker, 'currentPositionId'>) : null;
  const next = openMobPositionId(assignment, worker);
  const prev = (assignment.positionId || '').trim();
  if (!next || next === prev) return assignment;
  await updateDoc(doc(db, 'mobilizations', assignment.id), { positionId: next, updatedAt: Date.now() });
  return { ...assignment, positionId: next };
}

export async function syncOpenMobPositionFromWorker(
  db: Firestore,
  assignment: Pick<Assignment, 'id' | 'positionId' | 'deploymentStatus' | 'unassignedAt'>,
  worker: Pick<Worker, 'currentPositionId'> | null | undefined,
): Promise<{ positionId: string; updated: boolean }> {
  const prevId = (assignment.positionId || '').trim();
  const nextId = openMobPositionId(assignment, worker);
  if (!assignment.id || !nextId || nextId === prevId || !mobStillUsesRegistryPosition(assignment)) {
    return { positionId: prevId, updated: false };
  }

  const snap = await getDocs(
    query(collection(db, 'daily_timesheets'), where('assignmentId', '==', assignment.id)),
  );
  const now = Date.now();
  const batch = writeBatch(db);
  batch.update(doc(db, 'mobilizations', assignment.id), { positionId: nextId, updatedAt: now });
  let writes = 1;
  for (const row of snap.docs) {
    const data = row.data();
    if (data.status === 'LOCKED' || data.status === 'CLOSED') continue;
    if (String(data.positionId || '').trim() === nextId) continue;
    batch.update(row.ref, { positionId: nextId, updatedAt: now });
    writes += 1;
    if (writes >= 450) break;
  }
  await batch.commit();
  return { positionId: nextId, updated: true };
}
