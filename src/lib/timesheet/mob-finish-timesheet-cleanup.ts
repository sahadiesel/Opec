import { collection, deleteDoc, doc, getDocs, query, where, writeBatch, type Firestore } from 'firebase/firestore';
import type { Assignment, DailyTimesheet } from '@/lib/types';

function isTimesheetFinanciallyImmutable(status: string | undefined): boolean {
  return ['CLIENT_APPROVED', 'VERIFIED_PAPER', 'LOCKED'].includes(status || '');
}

/** นับแถวลงเวลาหลังวันจบงาน (สำหรับแจ้งเตือนก่อนบันทึก) */
export async function countTimesheetsAfterMobFinishDate(
  db: Firestore,
  assignmentId: string,
  finishYmd: string,
): Promise<{ total: number; deletable: number; locked: number }> {
  const finish = finishYmd.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(finish)) return { total: 0, deletable: 0, locked: 0 };

  const snap = await getDocs(
    query(
      collection(db, 'daily_timesheets'),
      where('assignmentId', '==', assignmentId.trim()),
      where('date', '>', finish),
    ),
  );

  let deletable = 0;
  let locked = 0;
  for (const d of snap.docs) {
    const cur = d.data() as DailyTimesheet;
    if (isTimesheetFinanciallyImmutable(cur.status)) locked++;
    else deletable++;
  }
  return { total: snap.size, deletable, locked };
}

/**
 * ลบแถวลงเวลาหลังวันจบงาน — จนกว่าจะ remob (ไม่ลบแถวที่ล็อกบัญชีแล้ว)
 */
export async function deleteTimesheetsAfterMobFinishDate(
  db: Firestore,
  assignment: Pick<Assignment, 'id' | 'workerId'>,
  finishYmd: string,
): Promise<{ deleted: number; skipped: number }> {
  const finish = finishYmd.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(finish)) return { deleted: 0, skipped: 0 };

  const snap = await getDocs(
    query(
      collection(db, 'daily_timesheets'),
      where('assignmentId', '==', assignment.id),
      where('date', '>', finish),
    ),
  );

  if (snap.empty) return { deleted: 0, skipped: 0 };

  let batch = writeBatch(db);
  let batchCount = 0;
  let deleted = 0;
  let skipped = 0;

  const flush = async () => {
    if (batchCount === 0) return;
    await batch.commit();
    batch = writeBatch(db);
    batchCount = 0;
  };

  for (const d of snap.docs) {
    const cur = d.data() as DailyTimesheet;
    if (isTimesheetFinanciallyImmutable(cur.status)) {
      skipped++;
      continue;
    }
    batch.delete(d.ref);
    batchCount++;
    deleted++;
    if (batchCount >= 400) await flush();
  }
  await flush();

  return { deleted, skipped };
}
