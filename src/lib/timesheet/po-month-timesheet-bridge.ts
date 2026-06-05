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
import type { Assignment, PayrollPeriod, PayrollPeriodStatus, PoMonthTimesheetReview, PurchaseOrder } from '@/lib/types';
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
 * รวบรวมใบงานรายวันในเดือนปฏิทินของ PO ที่ยังไม่ LOCKED (ใช้ทั้งตั้งและล้าง ready flags)
 *
 * ใช้ขอบเขต **ทั้งเดือนปฏิทิน** (`yearMonth`) ไม่ใช่แค่ periodStart–periodEnd บนเอกสาร —
 * สอดคล้องกับ markTimesheetsReadyForPayrollAfterPoMonthApproval เดิม
 */
async function gatherNonLockedDailyTimesheetRefsForPoCalendarMonth(
  db: Firestore,
  poId: string,
  yearMonth: string,
): Promise<DocumentReference[]> {
  const ym = (yearMonth || '').trim();
  if (!/^\d{4}-\d{2}$/.test(ym)) return [];
  const pid = (poId || '').trim();
  if (!pid) return [];

  const monthFirst = `${ym}-01`;
  const monthLast = lastDayOfCalendarMonth(ym);
  const refsById = new Map<string, DocumentReference>();

  const snapByPo = await getDocs(
    query(
      collection(db, 'daily_timesheets'),
      where('purchaseOrderId', '==', pid),
      where('date', '>=', monthFirst),
      where('date', '<=', monthLast),
    ),
  );
  for (const d of snapByPo.docs) {
    const data = d.data();
    if (data.status === 'LOCKED') continue;
    refsById.set(d.id, d.ref);
  }

  const snapScope = await getDocs(
    query(
      collection(db, 'daily_timesheets'),
      where('waveId', '==', poTimesheetScopeId(pid)),
      where('date', '>=', monthFirst),
      where('date', '<=', monthLast),
    ),
  );
  for (const d of snapScope.docs) {
    const data = d.data();
    if (data.status === 'LOCKED') continue;
    const tsPo = String(data.purchaseOrderId || '').trim();
    if (tsPo && tsPo !== pid) continue;
    refsById.set(d.id, d.ref);
  }

  const wavesSnap = await getDocs(query(collection(db, 'waves'), where('poId', '==', pid)));
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
      if (tsPo && tsPo !== pid) continue;
      refsById.set(d.id, d.ref);
    }
  }

  /** mobilization ใต้ PO — จับใบงานที่อ้าง assignment / wave จาก mob แม้ purchaseOrderId ยังว่าง */
  const mobSnap = await getDocs(query(collection(db, 'mobilizations'), where('poId', '==', pid)));
  const mobAssignmentIds: string[] = [];
  const mobWaveIds = new Set<string>();
  const mobWorkerIds = new Set<string>();
  for (const d of mobSnap.docs) {
    const a = d.data() as Assignment;
    mobAssignmentIds.push(d.id);
    const wid = String(a.waveId || '').trim();
    if (wid) mobWaveIds.add(wid);
    const workerId = String(a.workerId || '').trim();
    if (workerId) mobWorkerIds.add(workerId);
  }

  const belongsToPoMob = (data: Record<string, unknown>): boolean => {
    const tsPo = String(data.purchaseOrderId || '').trim();
    if (tsPo && tsPo === pid) return true;
    const aid = String(data.assignmentId || '').trim();
    if (aid && mobAssignmentIds.includes(aid)) return true;
    const wid = String(data.waveId || '').trim();
    if (wid && (mobWaveIds.has(wid) || waveIdsUnderPo.includes(wid))) return true;
    return false;
  };

  for (const wid of mobWaveIds) {
    if (waveIdsUnderPo.includes(wid)) continue;
    const snapByMobWave = await getDocs(
      query(
        collection(db, 'daily_timesheets'),
        where('waveId', '==', wid),
        where('date', '>=', monthFirst),
        where('date', '<=', monthLast),
      ),
    );
    for (const d of snapByMobWave.docs) {
      const data = d.data();
      if (data.status === 'LOCKED') continue;
      const tsPo = String(data.purchaseOrderId || '').trim();
      if (tsPo && tsPo !== pid) continue;
      refsById.set(d.id, d.ref);
    }
  }

  for (const assignChunk of chunkIds(mobAssignmentIds, FIRESTORE_IN_MAX)) {
    if (assignChunk.length === 0) continue;
    const snapByAssign = await getDocs(
      query(collection(db, 'daily_timesheets'), where('assignmentId', 'in', assignChunk)),
    );
    for (const d of snapByAssign.docs) {
      const data = d.data();
      const dateYmd = String(data.date || '').slice(0, 10);
      if (dateYmd < monthFirst || dateYmd > monthLast) continue;
      if (data.status === 'LOCKED') continue;
      refsById.set(d.id, d.ref);
    }
  }

  /** คนงานใต้ mobilization PO นี้ — จับใบงานที่มี workerId แต่ purchaseOrderId/wave ยังไม่ครบ */
  for (const workerChunk of chunkIds([...mobWorkerIds], FIRESTORE_IN_MAX)) {
    if (workerChunk.length === 0) continue;
    const snapByWorker = await getDocs(
      query(collection(db, 'daily_timesheets'), where('workerId', 'in', workerChunk)),
    );
    for (const d of snapByWorker.docs) {
      const data = d.data();
      const dateYmd = String(data.date || '').slice(0, 10);
      if (dateYmd < monthFirst || dateYmd > monthLast) continue;
      if (data.status === 'LOCKED') continue;
      if (!belongsToPoMob(data as Record<string, unknown>)) continue;
      refsById.set(d.id, d.ref);
    }
  }

  return [...refsById.values()];
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
  const poId = (review.poId || '').trim();
  const refs = await gatherNonLockedDailyTimesheetRefsForPoCalendarMonth(db, poId, ym);
  if (refs.length === 0) return { updated: 0 };

  let batch = writeBatch(db);
  let n = 0;
  let updated = 0;
  const ts = Date.now();

  for (const ref of refs) {
    batch.update(ref, {
      readyForPayroll: true,
      readyForBilling: true,
      updatedAt: ts,
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

/**
 * Admin ปลดล็อก PO+เดือน — ล้าง ready บนใบงานในเดือนปฏิทินนี้ของ PO (ไม่แตะ daily ที่สถานะ LOCKED)
 */
export async function clearReadyPayrollFlagsForPoCalendarMonth(
  db: Firestore,
  poId: string,
  yearMonth: string,
): Promise<{ updated: number }> {
  const refs = await gatherNonLockedDailyTimesheetRefsForPoCalendarMonth(db, poId, yearMonth);
  if (refs.length === 0) return { updated: 0 };

  let batch = writeBatch(db);
  let n = 0;
  let updated = 0;
  const ts = Date.now();

  for (const ref of refs) {
    batch.update(ref, {
      readyForPayroll: false,
      readyForBilling: false,
      updatedAt: ts,
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
 * ตั้ง readyForPayroll ให้ใบงานของ PO+เดือนเดียว (หลังปิดงวด / ซิงก์ใหม่)
 */
export async function syncReadyPayrollFlagsForPoMonth(
  db: Firestore,
  poId: string,
  yearMonth: string,
): Promise<{ updated: number }> {
  const ym = yearMonth.trim();
  const pid = poId.trim();
  if (!/^\d{4}-\d{2}$/.test(ym) || !pid) return { updated: 0 };
  return markTimesheetsReadyForPayrollAfterPoMonthApproval(db, {
    id: poMonthTimesheetReviewDocId(pid, ym),
    poId: pid,
    yearMonth: ym,
  } as PoMonthTimesheetReview);
}

/**
 * หลังมีอย่างน้อยหนึ่ง PO+เดือนที่ปิดงวดแล้วในเดือนปฏิทินนั้น — ตั้ง ready ให้ใบงานของ PO ที่ปิดงวดแล้วก่อน
 * จากนั้นซิงก์ PO active/pending อื่นที่ทับเดือน (นโยบายเดิม)
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

  const gatedPoIds = new Set<string>();
  for (const d of reviewSnap.docs) {
    const r = { id: d.id, ...(d.data() as object) } as PoMonthTimesheetReview;
    if (!PO_MONTH_GATE_STATUSES.includes(r.status)) continue;
    const pid = (r.poId || '').trim();
    if (pid) gatedPoIds.add(pid);
  }

  const gatedPoCount = gatedPoIds.size;
  if (gatedPoCount === 0) {
    return { updated: 0, gatedPoCount: 0, syncedPoCount: 0 };
  }

  let updated = 0;
  let syncedPoCount = 0;
  const syncedPoIds = new Set<string>();

  for (const poId of gatedPoIds) {
    const res = await syncReadyPayrollFlagsForPoMonth(db, poId, ym);
    updated += res.updated;
    syncedPoCount++;
    syncedPoIds.add(poId);
  }

  const posSnap = await getDocs(
    query(collection(db, 'purchase_orders'), where('status', 'in', ['pending', 'active']), limit(200)),
  );

  for (const d of posSnap.docs) {
    const po = { id: d.id, ...(d.data() as object) } as PurchaseOrder;
    if (syncedPoIds.has(po.id)) continue;
    if ((po.poType || 'contract') === 'quotation') continue;
    if (!purchaseOrderOverlapsYearMonth(po, ym)) continue;

    const res = await markTimesheetsReadyForPayrollAfterPoMonthApproval(db, {
      poId: po.id,
      yearMonth: ym,
    } as PoMonthTimesheetReview);
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
