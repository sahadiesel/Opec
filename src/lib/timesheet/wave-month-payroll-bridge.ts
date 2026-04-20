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
import type { PayrollPeriod, PayrollPeriodStatus, WaveMonthTimesheetReview } from '@/lib/types';
import { lastDayOfCalendarMonth } from '@/lib/timesheet/wave-month-utils';

const FIRESTORE_BATCH_LIMIT = 400;

/**
 * คำนวณช่วงวันที่งวดปิดจากเอกสาร review (ค่าเริ่มต้น = เต็มเดือนปฏิทิน)
 */
export function resolveWaveMonthPeriodBounds(review: WaveMonthTimesheetReview): { start: string; end: string } {
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
 * หลังผู้จัดการอนุมัติรอบเดือน — ตั้ง readyForPayroll / readyForBilling ให้ daily_timesheets ในช่วงงวด
 * (ข้ามรายการที่ LOCKED แล้วจาก payroll batch)
 */
export async function markTimesheetsReadyForPayrollAfterMonthApproval(
  db: Firestore,
  review: WaveMonthTimesheetReview,
): Promise<{ updated: number }> {
  const { start, end } = resolveWaveMonthPeriodBounds(review);
  const q = query(
    collection(db, 'daily_timesheets'),
    where('waveId', '==', review.waveId),
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

/** Document id สำหรับรอบลูกจ้างตามเดือนปฏิทิน (หนึ่งรอบต่อ yearMonth) */
export function workerPayrollPeriodDocId(yearMonth: string): string {
  return `worker_ym_${yearMonth.replace(/-/g, '_')}`;
}

/**
 * เปิดรอบบัญชีลูกจ้าง (payroll_periods) ให้พร้อมเลือกในงวดจ่าย — ใช้เต็มเดือนปฏิทินตาม yearMonth
 * เรียกหลังอนุมัติ Wave เดือน เพื่อไม่ให้ dropdown «เลือกรอบบัญชี» ว่าง
 */
export async function ensureOpenPayrollPeriodForWaveMonthReview(
  db: Firestore,
  review: WaveMonthTimesheetReview,
  actorName: string,
): Promise<{ periodId: string; created: boolean }> {
  const ym = review.yearMonth;
  if (!/^\d{4}-\d{2}$/.test(ym)) {
    return { periodId: '', created: false };
  }

  const periodId = workerPayrollPeriodDocId(ym);
  const ref = doc(db, 'payroll_periods', periodId);
  const snap = await getDoc(ref);

  const monthFirst = `${ym}-01`;
  const monthLast = lastDayOfCalendarMonth(ym);
  const defaultLabel = `${ym} · งวดลูกจ้าง (อนุมัติ Wave)`;
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

  if (!snap.exists()) {
    await setDoc(ref, { ...base, status: 'OPEN' as PayrollPeriodStatus });
    return { periodId, created: true };
  }

  const existing = snap.data() as PayrollPeriod;
  if (existing.status === 'LOCKED' || existing.status === 'CLOSED') {
    return { periodId, created: false };
  }

  const nextStatus: PayrollPeriodStatus =
    existing.status === 'PROCESSING' ? 'PROCESSING' : 'OPEN';

  await setDoc(
    ref,
    {
      ...base,
      status: nextStatus,
      label: existing.label?.trim() ? existing.label : defaultLabel,
    },
    { merge: true },
  );
  return { periodId, created: false };
}
