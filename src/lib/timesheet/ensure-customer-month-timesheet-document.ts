'use client';

import { doc, getDoc, setDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { CustomerMonthTimesheetDocument, JobMode, User } from '@/lib/types';
import { generateNextDocumentCode } from '@/lib/services/numbering-service';
import { customerMonthTimesheetDocId } from '@/lib/timesheet/customer-month-timesheet-bridge';

/**
 * สร้าง/อ่านหัวเอกสาร `customer_month_timesheet_documents` — หนึ่งฉบับต่อลูกค้า × โหมด × เดือน
 */
export async function ensureCustomerMonthTimesheetDocument(
  firestore: Firestore,
  yearMonth: string,
  customerId: string,
  workMode: JobMode,
  currentUser: User,
  customerNameSnapshot?: string,
): Promise<CustomerMonthTimesheetDocument> {
  if (workMode !== 'ONSHORE' && workMode !== 'OFFSHORE') {
    throw new Error('workMode ต้องเป็น ONSHORE หรือ OFFSHORE');
  }
  const id = customerMonthTimesheetDocId(customerId, yearMonth, workMode);
  if (!id) throw new Error('customerId/yearMonth ไม่ถูกต้อง');

  const ref = doc(firestore, 'customer_month_timesheet_documents', id);
  const snap = await getDoc(ref);
  const existing = snap.exists() ? (snap.data() as CustomerMonthTimesheetDocument) : undefined;
  const existingNo = (existing?.timesheetNo || '').trim();

  let timesheetNo = existingNo;
  if (!timesheetNo) {
    const d = new Date(`${yearMonth}-15T12:00:00`);
    const { code } = await generateNextDocumentCode(firestore, 'customer_month_timesheet', {
      actor: currentUser.displayName || currentUser.email || 'system',
      userId: currentUser.id,
      date: d,
    });
    timesheetNo = code;
  }

  const now = Date.now();
  const payload: Record<string, unknown> = {
    id,
    customerId: customerId.trim(),
    yearMonth,
    workMode,
    timesheetNo,
    updatedAt: now,
    customerNameSnapshot:
      (customerNameSnapshot || '').trim() || existing?.customerNameSnapshot || undefined,
  };

  if (!snap.exists()) {
    payload.createdAt = now;
    payload.createdByUserId = currentUser.id;
  } else if (typeof existing?.createdAt === 'number') {
    payload.createdAt = existing.createdAt;
    if (existing.createdByUserId) payload.createdByUserId = existing.createdByUserId;
  } else {
    payload.createdAt = now;
    payload.createdByUserId = currentUser.id;
  }

  await setDoc(ref, payload, { merge: true });

  const after = await getDoc(ref);
  return { id: after.id, ...(after.data() as object) } as CustomerMonthTimesheetDocument;
}
