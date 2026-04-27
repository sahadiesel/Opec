'use client';

import { doc, getDoc, setDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { User } from '@/lib/types';
import { generateNextDocumentCode } from '@/lib/services/numbering-service';

/**
 * สร้าง/อ่าน `monthly_timesheet_documents/{yyyy-MM}` ให้มี timesheetNo สำหรับแสดงหน้าเอกสารรวม
 */
export async function ensureMonthlyTimesheetDocument(
  firestore: Firestore,
  yearMonth: string,
  currentUser: User,
): Promise<string | null> {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return null;
  const ref = doc(firestore, 'monthly_timesheet_documents', yearMonth);
  const snap = await getDoc(ref);
  const existing = snap.exists() ? (snap.data() as { timesheetNo?: string }).timesheetNo : undefined;
  if (existing && String(existing).trim()) return String(existing).trim();

  const d = new Date(`${yearMonth}-15T12:00:00`);
  const { code } = await generateNextDocumentCode(firestore, 'monthly_timesheet', {
    actor: currentUser.displayName || currentUser.email || 'system',
    userId: currentUser.id,
    date: d,
  });
  const now = Date.now();
  await setDoc(
    ref,
    {
      id: yearMonth,
      yearMonth,
      timesheetNo: code,
      createdAt: now,
      updatedAt: now,
      createdByUserId: currentUser.id,
    },
    { merge: true },
  );
  return code;
}
