import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  where,
  writeBatch,
  type DocumentReference,
  type Firestore,
} from 'firebase/firestore';
import type { PayrollPeriod, PayrollPeriodStatus, PoMonthTimesheetReview, PurchaseOrder } from '@/lib/types';
import { poTimesheetScopeId } from '@/lib/constants/timesheet-po-scope';
import { purchaseOrderOverlapsYearMonth } from '@/lib/timesheet/po-location-month-shell';
import { lastDayOfCalendarMonth } from '@/lib/timesheet/wave-month-utils';

const FIRESTORE_BATCH_LIMIT = 400;
/** Firestore `in` จำกัด 30 ค่า — ใช้แบ่ง waveId เวลาดึงใบงานตาม Wave จริงใต้ PO */
const FIRESTORE_IN_MAX = 30;

function chunkIds<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

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
 * หลังล็อกงวดหรืออนุมัติ PO+เดือน — ตั้ง ready ให้ daily_timesheets ทุก wave ใต้ PO
 *
 * ใช้ขอบเขต **ทั้งเดือนปฏิทิน** (`yearMonth`) ไม่ใช่แค่ periodStart–periodEnd บนเอกสาร —
 * กันช่วงงวดในเอกสารถูกตั้งแคบ (เช่นผิดพลาดหนึ่งวัน) แล้ว Payroll / Pre-flight เหลือ 1 ใบงาน ทั้งที่ตารางสรุปเดือนมีหลายคน
 * (รอบจ่าย `worker_ym_*` และการสร้าง Batch ยังอิงเต็มเดือนปฏิทินตาม payroll_period)
 */
export async function markTimesheetsReadyForPayrollAfterPoMonthApproval(
  db: Firestore,
  review: PoMonthTimesheetReview,
): Promise<{ updated: number }> {
  const ym = (review.yearMonth || '').trim();
  if (!/^\d{4}-\d{2}$/.test(ym)) return { updated: 0 };
  const monthFirst = `${ym}-01`;
  const monthLast = lastDayOfCalendarMonth(ym);
  const poId = (review.poId || '').trim();
  if (!poId) return { updated: 0 };

  const refsById = new Map<string, DocumentReference>();

  const snapByPo = await getDocs(
    query(
      collection(db, 'daily_timesheets'),
      where('purchaseOrderId', '==', poId),
      where('date', '>=', monthFirst),
      where('date', '<=', monthLast),
    ),
  );
  for (const d of snapByPo.docs) {
    const data = d.data();
    if (data.status === 'LOCKED') continue;
    refsById.set(d.id, d.ref);
  }

  /** ใบงานจากกระดาน PO ที่ waveId = scope แต่ยังไม่ได้ใส่ purchaseOrderId — query เดิมไม่ครอบคลุม */
  const snapScope = await getDocs(
    query(
      collection(db, 'daily_timesheets'),
      where('waveId', '==', poTimesheetScopeId(poId)),
      where('date', '>=', monthFirst),
      where('date', '<=', monthLast),
    ),
  );
  for (const d of snapScope.docs) {
    const data = d.data();
    if (data.status === 'LOCKED') continue;
    const tsPo = String(data.purchaseOrderId || '').trim();
    if (tsPo && tsPo !== poId) continue;
    refsById.set(d.id, d.ref);
  }

  /**
   * ใบงานจากกระดาน Wave (waveId = รหัส Wave จริง) ที่ยังไม่มี purchaseOrderId หรือระบบเก่าไม่ได้ใส่ —
   * query ด้านบนไม่ครอบคลุม จึงตามทุก Wave ที่ poId ตรงกันแล้วตั้ง ready ในเดือนนั้น
   */
  const wavesSnap = await getDocs(query(collection(db, 'waves'), where('poId', '==', poId)));
  const waveIdsUnderPo = wavesSnap.docs.map((w) => w.id);
  for (const waveChunk of chunkIds(waveIdsUnderPo, FIRESTORE_IN_MAX)) {
    if (waveChunk.length === 0) continue;
    const snapByRealWave = await getDocs(
      query(
        collection(db, 'daily_timesheets'),
        where('waveId', 'in', waveChunk),
        where('date', '>=', monthFirst),
        where('date', '<=', monthLast),
      ),
    );
    for (const d of snapByRealWave.docs) {
      const data = d.data();
      if (data.status === 'LOCKED') continue;
      const tsPo = String(data.purchaseOrderId || '').trim();
      if (tsPo && tsPo !== poId) continue;
      refsById.set(d.id, d.ref);
    }
  }

  let batch = writeBatch(db);
  let n = 0;
  let updated = 0;

  for (const ref of refsById.values()) {
    batch.update(ref, {
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

const PO_MONTH_GATE_STATUSES: PoMonthTimesheetReview['status'][] = [
  'approved',
  'entry_locked',
  'pending_manager_review',
];

/**
 * หลังมีอย่างน้อยหนึ่ง PO+เดือนที่ปิดงวดแล้วในเดือนปฏิทินนั้น — ตั้ง ready ให้ใบงานของ **ทุก PO active ที่ทับเดือนนั้น**
 * (ไม่บังคับให้ล็อกเอกสาร PO+เดือนทุกฉบับ — แก้เคสหลาย PO / หลายไซต์ที่ล็อกแค่ PO เดียวแล้วซิงก์ไม่ครบ)
 */
export async function syncReadyPayrollFlagsForYearMonthFromAllGatedPoMonthReviews(
  db: Firestore,
  yearMonth: string,
): Promise<{ updated: number; gatedPoCount: number; syncedPoCount: number }> {
  const ym = yearMonth.trim();
  if (!/^\d{4}-\d{2}$/.test(ym)) return { updated: 0, gatedPoCount: 0, syncedPoCount: 0 };

  const reviewSnap = await getDocs(
    query(collection(db, 'po_month_timesheet_reviews'), where('yearMonth', '==', ym), limit(80)),
  );

  let gatedPoCount = 0;
  for (const d of reviewSnap.docs) {
    const r = { id: d.id, ...(d.data() as object) } as PoMonthTimesheetReview;
    if (!PO_MONTH_GATE_STATUSES.includes(r.status)) continue;
    gatedPoCount++;
  }

  if (gatedPoCount === 0) {
    return { updated: 0, gatedPoCount: 0, syncedPoCount: 0 };
  }

  const posSnap = await getDocs(query(collection(db, 'purchase_orders'), where('status', '==', 'active'), limit(200)));

  let updated = 0;
  let syncedPoCount = 0;

  for (const d of posSnap.docs) {
    const po = { id: d.id, ...(d.data() as object) } as PurchaseOrder;
    if ((po.poType || 'contract') === 'quotation') continue;
    if (!purchaseOrderOverlapsYearMonth(po, ym)) continue;

    const syntheticReview = { poId: po.id, yearMonth: ym } as PoMonthTimesheetReview;
    const res = await markTimesheetsReadyForPayrollAfterPoMonthApproval(db, syntheticReview);
    updated += res.updated;
    syncedPoCount++;
  }

  return { updated, gatedPoCount, syncedPoCount };
}

/** id มาตรฐานรอบจ่ายลูกจ้ายรายเดือนปฏิทิน — ตรงกับ payroll_periods */
export function workerPayrollPeriodIdForYearMonth(yearMonth: string): string {
  return `worker_ym_${yearMonth.replace(/-/g, '_')}`;
}

/** แปลง `worker_ym_YYYY_MM` → `yyyy-MM` */
export function parseYearMonthFromWorkerPayrollPeriodId(periodId: string): string | null {
  const m = /^worker_ym_(\d{4})_(\d{2})$/.exec(periodId);
  return m ? `${m[1]}-${m[2]}` : null;
}

/**
 * ให้มีเอกสาร payroll_periods สำหรับงวดรายเดือน — เรียกหลังล็อก PO+เดือนหรือก่อนสร้าง Payroll Batch
 */
export async function ensureWorkerMonthlyPayrollPeriodForYearMonth(
  db: Firestore,
  yearMonth: string,
  actorName: string,
): Promise<{ periodId: string; created: boolean }> {
  const ym = yearMonth.trim();
  if (!/^\d{4}-\d{2}$/.test(ym)) {
    return { periodId: '', created: false };
  }

  const periodId = workerPayrollPeriodIdForYearMonth(ym);
  const ref = doc(db, 'payroll_periods', periodId);
  const snap = await getDoc(ref);

  const monthFirst = `${ym}-01`;
  const monthLast = lastDayOfCalendarMonth(ym);
  const defaultLabel = `${ym} · งวดลูกจ้าง (PO+เดือน)`;
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

export async function ensureOpenPayrollPeriodForPoMonthReview(
  db: Firestore,
  review: PoMonthTimesheetReview,
  actorName: string,
): Promise<{ periodId: string; created: boolean }> {
  return ensureWorkerMonthlyPayrollPeriodForYearMonth(db, review.yearMonth, actorName);
}
