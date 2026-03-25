'use client';

import { Firestore, collection, doc, getDocs, query, where, writeBatch } from 'firebase/firestore';
import type { Assignment, User, Worker } from '@/lib/types';
import { writeAuditLog } from '@/lib/services/audit-service';
import {
  filterBlockingAssignmentsForWorker,
  formatBlockingAssignmentsMessage,
  isWorkerEmploymentStatusSafeForDelete,
} from '@/lib/worker-delete-eligibility';

const WORKER_SUBCOLLECTIONS = ['certificates', 'medical_records', 'drug_tests', 'documents'] as const;

function workerSnapshotForAudit(w: Worker): string {
  return JSON.stringify({
    id: w.id,
    workerCode: w.workerCode,
    firstName: w.firstName,
    lastName: w.lastName,
    thaiNationalId: w.thaiNationalId,
    workerStatus: w.workerStatus,
    currentPositionId: w.currentPositionId,
  });
}

/**
 * ตรวจว่าลบได้หรือไม่ (ไม่ลบข้อมูล)
 */
export async function assertWorkerCanBeDeleted(
  db: Firestore,
  worker: Worker,
  allAssignments: Assignment[] | null
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isWorkerEmploymentStatusSafeForDelete(worker)) {
    return {
      ok: false,
      message:
        'ลบได้เฉพาะเมื่อสถานะงานเป็น AVAILABLE (ว่าง) — คนงานนี้ยังถูกมอบหมายหรืออยู่ระหว่างปฏิบัติงาน',
    };
  }

  let blocking: Assignment[];
  if (allAssignments != null) {
    blocking = filterBlockingAssignmentsForWorker(allAssignments, worker.id);
  } else {
    const q = query(collection(db, 'mobilizations'), where('workerId', '==', worker.id));
    const snap = await getDocs(q);
    blocking = filterBlockingAssignmentsForWorker(
      snap.docs.map((d) => ({ id: d.id, ...d.data() } as Assignment)),
      worker.id
    );
  }

  if (blocking.length > 0) {
    return {
      ok: false,
      message:
        formatBlockingAssignmentsMessage(blocking) ||
        'มีการมอบหมายงานที่ยังไม่ปิด (ไม่ใช่สถานะ CLOSED / DEMOBILIZED)',
    };
  }

  return { ok: true };
}

/**
 * ลบเอกสารคนงาน + subcollections + audit log (เรียกหลัง assertWorkerCanBeDeleted ผ่านแล้วเท่านั้น)
 */
export async function deleteWorkerWithAuditLog(
  db: Firestore,
  actor: User,
  worker: Worker,
  reasonText: string
): Promise<void> {
  const trimmed = reasonText.trim();
  if (!trimmed) {
    throw new Error('กรุณาระบุเหตุผลการลบ');
  }

  const workerRef = doc(db, 'workers', worker.id);
  const label = `${worker.workerCode || worker.id} — ${worker.firstName} ${worker.lastName}`.trim();

  let batch = writeBatch(db);
  let ops = 0;

  const commitIfNeeded = async () => {
    if (ops >= 400) {
      await batch.commit();
      batch = writeBatch(db);
      ops = 0;
    }
  };

  for (const sub of WORKER_SUBCOLLECTIONS) {
    const subCol = collection(db, 'workers', worker.id, sub);
    const snap = await getDocs(subCol);
    for (const d of snap.docs) {
      batch.delete(d.ref);
      ops += 1;
      await commitIfNeeded();
    }
  }

  batch.delete(workerRef);
  ops += 1;
  await batch.commit();

  await writeAuditLog(db, actor, {
    actionType: 'DELETE',
    entityType: 'Worker',
    entityId: worker.id,
    entityLabel: label,
    sourceModule: 'workers',
    sourcePath: '/workers',
    beforeSummary: workerSnapshotForAudit(worker),
    reasonText: trimmed,
    linkedIds: [worker.id],
  });
}
