import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type { PayrollPeriod, PayrollPeriodStatus, PoMonthTimesheetReview } from '@/lib/types';
import { lastDayOfCalendarMonth } from '@/lib/timesheet/wave-month-utils';

const FIRESTORE_BATCH_LIMIT = 400;

export function poMonthTimesheetReviewDocId(poId: string, yearMonth: string): string {
  return `${poId}_${yearMonth}`;
}

export function resolvePoMonthPeriodBounds(
  review: PoMonthTimesheetReview,
): { start: string; end: string } {
  const ym = review.yearMonth;
  const monthFirst = `${ym}-01`;
  const monthLast = lastDayOfCalendarMonth(ym);

  const clampInMonth = (d: string | undefined, fallback: string): string => {
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d) || !d.startsWith(ym)) return fallback;
    if (d < monthFirst) return monthFirst;
    if (d > monthLast) return monthLast;
    return d;
  };

  const start = clampInMonth(review.periodStartDate, monthFirst);
  let end = clampInMonth(review.periodEndDate, monthLast);
  if (end < start) end = monthLast;

  return { start, end };
}

/**
 * หลังอนุมัติ PO+เดือน — ตั้ง ready ให้ daily_timesheets ทุก wave ใต้ PO ในช่วงงวด
 */
export async function markTimesheetsReadyForPayrollAfterPoMonthApproval(
  db: Firestore,
  review: PoMonthTimesheetReview,
): Promise<{ updated: number }> {
  const { start, end } = resolvePoMonthPeriodBounds(review);
  const q = query(
    collection(db, 'daily_timesheets'),
    where('purchaseOrderId', '==', review.poId),
    where('date', '>=', start),
    where('date', '<=', end),
  );
  const snap = await getDocs(q);
  let batch = writeBatch(db);
  let n = 0;
  let updated = 0;

  for (const d of snap.docs) {
    const data = d.data();
    if (data.status === 'LOCKED') continue;

    batch.update(d.ref, {
      readyForPayroll: true,
      readyForBilling: true,
      updatedAt: Date.now(),
    });
    updated++;
    n++;
    if (n >= FIRESTORE_BATCH_LIMIT) {
      await batch.commit();
      batch = writeBatch(db);
      n = 0;
    }
  }
  if (n > 0) await batch.commit();
  return { updated };
}

export async function ensureOpenPayrollPeriodForPoMonthReview(
  db: Firestore,
  review: PoMonthTimesheetReview,
  actorName: string,
): Promise<{ periodId: string; created: boolean }> {
  const ym = review.yearMonth;
  if (!/^\d{4}-\d{2}$/.test(ym)) {
    return { periodId: '', created: false };
  }

  const periodId = `worker_ym_${ym.replace(/-/g, '_')}`;
  const ref = doc(db, 'payroll_periods', periodId);
  const snap = await getDoc(ref);

  const monthFirst = `${ym}-01`;
  const monthLast = lastDayOfCalendarMonth(ym);
  const defaultLabel = `${ym} · งวดลูกจ้าง (อนุมัติ PO+เดือน)`;
  const now = Date.now();

  const base = {
    id: periodId,
    label: defaultLabel,
    startDate: monthFirst,
    endDate: monthLast,
    cycleType: 'MONTHLY' as const,
    generatedBy: actorName,
    generatedAt: now,
  };

  const approvedReadyStatus: PayrollPeriodStatus = 'PROCESSING';

  if (!snap.exists()) {
    await setDoc(ref, { ...base, status: approvedReadyStatus });
    return { periodId, created: true };
  }

  const existing = snap.data() as PayrollPeriod;
  if (existing.status === 'LOCKED' || existing.status === 'CLOSED') {
    return { periodId, created: false };
  }

  await setDoc(
    ref,
    {
      ...base,
      status: approvedReadyStatus,
      label: existing.label?.trim() ? existing.label : defaultLabel,
    },
    { merge: true },
  );
  return { periodId, created: false };
}
