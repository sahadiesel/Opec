import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  deleteField,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type {
  PoMonthTimesheetReview,
  User,
  WorkerMonthClosureStatus,
  WorkerMonthTimesheetClosure,
} from '@/lib/types';
import {
  clearReadyPayrollFlagsForPoMonthWorkerIds,
  markTimesheetsReadyForPoMonthWorkerIds,
  poMonthTimesheetReviewDocId,
  workerPayrollPeriodIdForYearMonth,
} from '@/lib/timesheet/po-month-timesheet-bridge';
import { aggregatePoMonthReviewStatusFromWorkerClosures } from '@/lib/timesheet/po-month-review-status';
import { lastDayOfCalendarMonth } from '@/lib/timesheet/wave-month-utils';
import { sanitizeFirestorePayload } from '@/lib/utils';

const FIRESTORE_IN_MAX = 30;
const REOPEN_UNLOCK_CHUNK = 400;

function isFirestorePermissionDenied(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'permission-denied'
  );
}

async function safeWorkerClosureQuery(
  run: () => Promise<WorkerMonthTimesheetClosure[]>,
): Promise<WorkerMonthTimesheetClosure[]> {
  try {
    return await run();
  } catch (error: unknown) {
    if (isFirestorePermissionDenied(error)) {
      console.warn(
        '[worker-month-closure] Missing or insufficient permissions — deploy firestore.rules (worker_month_timesheet_closures) with npm run deploy:rules',
      );
      return [];
    }
    throw error;
  }
}

export function workerMonthClosureDocId(poId: string, yearMonth: string, workerId: string): string {
  const safeWorker = workerId.replace(/\//g, '_');
  return `${poId}_${yearMonth}_${safeWorker}`;
}

export const WORKER_MONTH_CLOSURE_GRID_LOCK_STATUSES: WorkerMonthClosureStatus[] = [
  'entry_locked',
  'pending_manager_review',
  'approved',
];

/** สถานะรายคนที่พร้อมตั้ง readyForPayroll (สอดคล้องปิดงวดเต็ม PO ที่ซิงก์ทันทีหลัง entry_locked) */
export const WORKER_MONTH_CLOSURE_PAYROLL_READY_STATUSES: WorkerMonthClosureStatus[] = [
  'entry_locked',
  'pending_manager_review',
  'approved',
];

export function isWorkerMonthClosureGridLocked(
  status: WorkerMonthClosureStatus | undefined | null,
): boolean {
  if (!status) return false;
  return WORKER_MONTH_CLOSURE_GRID_LOCK_STATUSES.includes(status);
}

export function workerMonthClosureStatusLabelTh(status: WorkerMonthClosureStatus | undefined): string {
  switch (status) {
    case 'open':
      return 'เปิด';
    case 'deferred':
      return 'รอ timesheet';
    case 'entry_locked':
      return 'ปิดงวดแล้ว';
    case 'pending_manager_review':
      return 'รอผู้จัดการ';
    case 'approved':
      return 'อนุมัติแล้ว';
    case 'rejected':
      return 'ปฏิเสธ';
    default:
      return 'เปิด';
  }
}

function chunkIds<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function fetchWorkerClosuresForPoMonth(
  db: Firestore,
  poId: string,
  yearMonth: string,
): Promise<WorkerMonthTimesheetClosure[]> {
  const pid = poId.trim();
  const ym = yearMonth.trim();
  if (!pid || !/^\d{4}-\d{2}$/.test(ym)) return [];
  return safeWorkerClosureQuery(async () => {
    const snap = await getDocs(
      query(
        collection(db, 'worker_month_timesheet_closures'),
        where('poId', '==', pid),
        where('yearMonth', '==', ym),
      ),
    );
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) } as WorkerMonthTimesheetClosure));
  });
}

export async function fetchWorkerClosuresForPoIdsAndMonth(
  db: Firestore,
  poIds: string[],
  yearMonth: string,
): Promise<WorkerMonthTimesheetClosure[]> {
  const ym = yearMonth.trim();
  if (!/^\d{4}-\d{2}$/.test(ym) || poIds.length === 0) return [];
  return safeWorkerClosureQuery(async () => {
    const out: WorkerMonthTimesheetClosure[] = [];
    for (let i = 0; i < poIds.length; i += FIRESTORE_IN_MAX) {
      const chunk = poIds.slice(i, i + FIRESTORE_IN_MAX).map((id) => id.trim()).filter(Boolean);
      if (chunk.length === 0) continue;
      const snap = await getDocs(
        query(
          collection(db, 'worker_month_timesheet_closures'),
          where('yearMonth', '==', ym),
          where('poId', 'in', chunk),
        ),
      );
      for (const d of snap.docs) {
        out.push({ id: d.id, ...(d.data() as object) } as WorkerMonthTimesheetClosure);
      }
    }
    return out;
  });
}

async function upsertWorkerClosure(
  db: Firestore,
  input: {
    poId: string;
    yearMonth: string;
    workerId: string;
    workerName?: string;
    status: WorkerMonthClosureStatus;
    actor: User;
    patch?: Partial<WorkerMonthTimesheetClosure>;
  },
): Promise<WorkerMonthTimesheetClosure> {
  const now = Date.now();
  const id = workerMonthClosureDocId(input.poId, input.yearMonth, input.workerId);
  const ref = doc(db, 'worker_month_timesheet_closures', id);
  const existing = await getDoc(ref);
  const createdAt =
    existing.exists() && typeof existing.data()?.createdAt === 'number'
      ? (existing.data() as WorkerMonthTimesheetClosure).createdAt
      : now;

  const prior = existing.exists() ? (existing.data() as WorkerMonthTimesheetClosure) : null;
  const row: WorkerMonthTimesheetClosure = {
    ...(prior ?? {
      id,
      poId: input.poId,
      yearMonth: input.yearMonth,
      workerId: input.workerId,
      createdAt,
    }),
    ...input.patch,
    id,
    poId: input.poId,
    yearMonth: input.yearMonth,
    workerId: input.workerId,
    workerName: input.workerName ?? prior?.workerName,
    status: input.status,
    createdAt,
    updatedAt: now,
  };
  await setDoc(ref, sanitizeFirestorePayload(row), { merge: true });
  return row;
}

async function syncPoMonthReviewFromClosures(
  db: Firestore,
  poId: string,
  yearMonth: string,
  actor: User,
  periodBounds?: { periodStartDate: string; periodEndDate: string },
): Promise<void> {
  const closures = await fetchWorkerClosuresForPoMonth(db, poId, yearMonth);
  const aggregate = aggregatePoMonthReviewStatusFromWorkerClosures(closures);
  if (!aggregate) return;

  const reviewId = poMonthTimesheetReviewDocId(poId, yearMonth);
  const reviewRef = doc(db, 'po_month_timesheet_reviews', reviewId);
  const existing = await getDoc(reviewRef);
  const now = Date.now();
  const monthFirst = `${yearMonth}-01`;
  const monthLast = lastDayOfCalendarMonth(yearMonth);

  const base = sanitizeFirestorePayload({
    id: reviewId,
    poId,
    yearMonth,
    status: aggregate,
    submittedAt: now,
    submittedByUserId: actor.id,
    submittedByName: actor.displayName || actor.email || actor.id,
    updatedAt: now,
    createdAt:
      existing.exists() && typeof existing.data()?.createdAt === 'number'
        ? (existing.data() as PoMonthTimesheetReview).createdAt
        : now,
    periodStartDate: periodBounds?.periodStartDate ?? monthFirst,
    periodEndDate: periodBounds?.periodEndDate ?? monthLast,
  });
  await setDoc(reviewRef, base, { merge: true });
}

export async function setWorkerMonthDeferred(
  db: Firestore,
  params: {
    poId: string;
    yearMonth: string;
    workerId: string;
    workerName?: string;
    actor: User;
    note?: string;
  },
): Promise<WorkerMonthTimesheetClosure> {
  const existing = await getDoc(
    doc(db, 'worker_month_timesheet_closures', workerMonthClosureDocId(params.poId, params.yearMonth, params.workerId)),
  );
  if (existing.exists()) {
    const cur = existing.data() as WorkerMonthTimesheetClosure;
    if (isWorkerMonthClosureGridLocked(cur.status)) {
      throw new Error('คนนี้ปิดงวดแล้ว — ไม่สามารถตั้งรอ timesheet ได้');
    }
  }
  return upsertWorkerClosure(db, {
    poId: params.poId,
    yearMonth: params.yearMonth,
    workerId: params.workerId,
    workerName: params.workerName,
    status: 'deferred',
    actor: params.actor,
    patch: {
      deferredReason: 'awaiting_ship_timesheet',
      deferredNote: params.note,
      deferredAt: Date.now(),
    },
  });
}

export async function clearWorkerMonthDeferred(
  db: Firestore,
  params: {
    poId: string;
    yearMonth: string;
    workerId: string;
    workerName?: string;
    actor: User;
  },
): Promise<WorkerMonthTimesheetClosure> {
  const existing = await getDoc(
    doc(db, 'worker_month_timesheet_closures', workerMonthClosureDocId(params.poId, params.yearMonth, params.workerId)),
  );
  if (existing.exists()) {
    const cur = existing.data() as WorkerMonthTimesheetClosure;
    if (cur.status !== 'deferred') {
      throw new Error('สถานะไม่ใช่รอ timesheet');
    }
  }
  return upsertWorkerClosure(db, {
    poId: params.poId,
    yearMonth: params.yearMonth,
    workerId: params.workerId,
    workerName: params.workerName,
    status: 'open',
    actor: params.actor,
    patch: {
      deferredReason: deleteField(),
      deferredNote: deleteField(),
    },
  });
}

export async function partialCloseWorkersForPoMonth(
  db: Firestore,
  params: {
    poId: string;
    yearMonth: string;
    workers: Array<{ workerId: string; workerName?: string }>;
    actor: User;
    periodBounds?: { periodStartDate: string; periodEndDate: string };
  },
): Promise<{ closed: number }> {
  const { poId, yearMonth, workers, actor } = params;
  if (workers.length === 0) throw new Error('ไม่ได้เลือกคนงาน');

  const now = Date.now();
  let closed = 0;
  const closedWorkerIds: string[] = [];
  const existingClosures = await fetchWorkerClosuresForPoMonth(db, poId, yearMonth);
  const maxBatch = existingClosures.reduce((m, c) => Math.max(m, c.closureBatchNo ?? 0), 0);
  const batchNo = maxBatch + 1;

  for (const w of workers) {
    const id = workerMonthClosureDocId(poId, yearMonth, w.workerId);
    const snap = await getDoc(doc(db, 'worker_month_timesheet_closures', id));
    const cur = snap.exists() ? (snap.data() as WorkerMonthTimesheetClosure) : null;
    if (cur?.status === 'deferred') {
      throw new Error(`${w.workerName ?? w.workerId}: อยู่ในสถานะรอ timesheet — ข้ามไม่ได้`);
    }
    if (cur && isWorkerMonthClosureGridLocked(cur.status)) {
      continue;
    }
    await upsertWorkerClosure(db, {
      poId,
      yearMonth,
      workerId: w.workerId,
      workerName: w.workerName,
      status: 'entry_locked',
      actor,
      patch: {
        closureBatchNo: batchNo,
        entryLockedAt: now,
        entryLockedByUserId: actor.id,
        entryLockedByName: actor.displayName || actor.email || actor.id,
      },
    });
    closed++;
    closedWorkerIds.push(w.workerId);
  }

  if (closed === 0) throw new Error('ไม่มีคนงานที่ปิดงวดได้ (อาจปิดแล้วทั้งหมด)');

  await markTimesheetsReadyForPoMonthWorkerIds(db, poId, yearMonth, closedWorkerIds);
  await syncPoMonthReviewFromClosures(db, poId, yearMonth, actor, params.periodBounds);
  return { closed };
}

const REOPENABLE_AFTER_PAYROLL_CANCEL: WorkerMonthClosureStatus[] = [
  'entry_locked',
  'pending_manager_review',
];

/** สถานะที่ยังยกเลิกปิดงวดเพื่อแก้ชม./OT ได้ (ยังไม่ล็อกจ่าย) */
const REOPENABLE_FOR_MANUAL_EDIT: WorkerMonthClosureStatus[] = [
  'entry_locked',
  'pending_manager_review',
  'approved',
];

export function canReopenWorkerMonthClosureForEdit(
  status: WorkerMonthClosureStatus | undefined | null,
): boolean {
  if (!status) return false;
  return REOPENABLE_FOR_MANUAL_EDIT.includes(status);
}

async function workerHasLockedTimesheetsInPoMonth(
  db: Firestore,
  poId: string,
  yearMonth: string,
  workerId: string,
): Promise<boolean> {
  const ym = yearMonth.trim();
  const wid = workerId.trim();
  const pid = poId.trim();
  if (!wid || !pid || !/^\d{4}-\d{2}$/.test(ym)) return false;
  /** query แค่ workerId — กรองเดือน/PO ฝั่ง client (ไม่ต้อง composite index) */
  const snap = await getDocs(
    query(collection(db, 'daily_timesheets'), where('workerId', '==', wid)),
  );
  for (const d of snap.docs) {
    const ts = d.data() as { purchaseOrderId?: string; status?: string; date?: string };
    const dYmd = String(ts.date || '').slice(0, 10);
    if (!dYmd.startsWith(`${ym}-`)) continue;
    const tsPo = String(ts.purchaseOrderId || '').trim();
    if (tsPo && tsPo !== pid) continue;
    if (ts.status === 'LOCKED') return true;
  }
  return false;
}

/** NORMAL batch ที่ผูกใบงานของคนนี้ + ชุด timesheetId ที่ห้ามปลด */
async function loadNormalPayrollLocksForWorkerInMonth(
  db: Firestore,
  yearMonth: string,
  workerId: string,
): Promise<{ batchIds: string[]; protectedTimesheetIds: Set<string> }> {
  const ym = yearMonth.trim();
  const wid = workerId.trim();
  const protectedTimesheetIds = new Set<string>();
  const batchIds: string[] = [];
  if (!wid || !/^\d{4}-\d{2}$/.test(ym)) return { batchIds, protectedTimesheetIds };

  const periodId = workerPayrollPeriodIdForYearMonth(ym);
  const batchSnap = await getDocs(
    query(collection(db, 'payroll_batches'), where('payrollPeriodId', '==', periodId)),
  );
  for (const b of batchSnap.docs) {
    const data = b.data() as { status?: string; batchType?: string };
    const st = String(data.status || '');
    if (st === 'CANCELLED') continue;
    if (data.batchType === 'SUPPLEMENTAL') continue;
    const lineId = `${b.id}_${wid}`;
    const lineSnap = await getDoc(doc(db, 'payroll_batches', b.id, 'lines', lineId));
    if (!lineSnap.exists()) continue;
    const ids = (lineSnap.data() as { sourceTimesheetIds?: string[] }).sourceTimesheetIds ?? [];
    let any = false;
    for (const raw of ids) {
      const tid = String(raw || '').trim();
      if (!tid) continue;
      protectedTimesheetIds.add(tid);
      any = true;
    }
    if (any) batchIds.push(b.id);
  }
  return { batchIds, protectedTimesheetIds };
}

/**
 * ปลด LOCKED ของคน+PO+เดือน ที่ไม่มีใน sourceTimesheetIds ของชุด NORMAL คนนั้น
 * (ล็อกค้าง / ถูก claim ผิดจากคนอื่น / งวดตกเบิก) — ใช้ตอนยกเลิกปิดงวด
 */
async function forceUnlockUnclaimedLockedTimesheetsForWorkerReopen(
  db: Firestore,
  poId: string,
  yearMonth: string,
  workerId: string,
  protectedTimesheetIds: ReadonlySet<string>,
): Promise<number> {
  const ym = yearMonth.trim();
  const wid = workerId.trim();
  const pid = poId.trim();
  if (!wid || !pid || !/^\d{4}-\d{2}$/.test(ym)) return 0;
  const snap = await getDocs(
    query(collection(db, 'daily_timesheets'), where('workerId', '==', wid)),
  );

  const toUnlock: string[] = [];
  for (const d of snap.docs) {
    const ts = d.data() as { purchaseOrderId?: string; status?: string; date?: string };
    const dYmd = String(ts.date || '').slice(0, 10);
    if (!dYmd.startsWith(`${ym}-`)) continue;
    const tsPo = String(ts.purchaseOrderId || '').trim();
    if (tsPo && tsPo !== pid) continue;
    if (ts.status !== 'LOCKED') continue;
    if (protectedTimesheetIds.has(d.id)) continue;
    toUnlock.push(d.id);
  }

  if (toUnlock.length === 0) return 0;
  const now = Date.now();
  let unlocked = 0;
  for (let i = 0; i < toUnlock.length; i += REOPEN_UNLOCK_CHUNK) {
    const slice = toUnlock.slice(i, i + REOPEN_UNLOCK_CHUNK);
    const wb = writeBatch(db);
    for (const tid of slice) {
      wb.update(doc(db, 'daily_timesheets', tid), {
        status: 'VERIFIED_PAPER',
        readyForPayroll: true,
        lockedAt: deleteField(),
        lockedBy: deleteField(),
        updatedAt: now,
      });
      unlocked++;
    }
    await wb.commit();
  }
  return unlocked;
}

/**
 * ยกเลิกปิดงวดรายคน — กลับเป็น «เปิด» เพื่อแก้ชม./OT/ประเภทวัน
 *
 * งวด SUPPLEMENTAL (ตกเบิก OT) ไม่นับ — ปลดล็อกค้างอัตโนมัติ
 * บล็อกเฉพาะเมื่อมีชุด NORMAL ที่ยังผูก sourceTimesheetIds ของคนนี้
 */
export async function reopenWorkerMonthClosureForEdit(
  db: Firestore,
  params: {
    poId: string;
    yearMonth: string;
    workerId: string;
    workerName?: string;
    actor: User;
    periodBounds?: { periodStartDate: string; periodEndDate: string };
  },
): Promise<void> {
  const { poId, yearMonth, workerId, actor, periodBounds } = params;
  const id = workerMonthClosureDocId(poId, yearMonth, workerId);
  const snap = await getDoc(doc(db, 'worker_month_timesheet_closures', id));
  if (!snap.exists()) {
    throw new Error('ไม่พบสถานะปิดงวดของคนนี้');
  }
  const cur = { id: snap.id, ...(snap.data() as object) } as WorkerMonthTimesheetClosure;
  if (!canReopenWorkerMonthClosureForEdit(cur.status)) {
    throw new Error(
      cur.status === 'deferred'
        ? 'คนนี้อยู่สถานะรอ timesheet — ใช้เมนูกลับเป็นพร้อมปิดงวดแทน'
        : 'สถานะนี้ยกเลิกปิดงวดไม่ได้',
    );
  }

  const { batchIds, protectedTimesheetIds } = await loadNormalPayrollLocksForWorkerInMonth(
    db,
    yearMonth,
    workerId,
  );

  await forceUnlockUnclaimedLockedTimesheetsForWorkerReopen(
    db,
    poId,
    yearMonth,
    workerId,
    protectedTimesheetIds,
  );

  if (protectedTimesheetIds.size > 0 && batchIds.length > 0) {
    const stillLocked = await workerHasLockedTimesheetsInPoMonth(db, poId, yearMonth, workerId);
    if (stillLocked) {
      throw new Error(
        `ใบงานยังถูกผูกในชุดจ่ายเงินเดือน ${batchIds.slice(0, 3).join(', ')}${
          batchIds.length > 3 ? ' …' : ''
        } — ลบชุด NORMAL ที่ยังไม่จ่าย/ยังไม่ส่งบัญชีก่อน (งวดตกเบิก OT ไม่นับ) จึงจะเปิดงวดกลับมาแก้ได้`,
      );
    }
  }

  if (await workerHasLockedTimesheetsInPoMonth(db, poId, yearMonth, workerId)) {
    throw new Error(
      'ใบงานยังถูกล็อกอยู่หลังปลดล็อกค้าง — รีเฟรชหน้าแล้วลองใหม่ หรือตรวจใบงานรายวันที่สถานะ LOCKED',
    );
  }

  await upsertWorkerClosure(db, {
    poId,
    yearMonth,
    workerId,
    workerName: params.workerName || cur.workerName,
    status: 'open',
    actor,
    patch: {
      entryLockedAt: deleteField(),
      entryLockedByUserId: deleteField(),
      entryLockedByName: deleteField(),
      submittedAt: deleteField(),
      submittedByUserId: deleteField(),
      submittedByName: deleteField(),
      reviewedAt: deleteField(),
      reviewedByUserId: deleteField(),
      reviewedByName: deleteField(),
      reviewNote: deleteField(),
    },
  });

  await clearReadyPayrollFlagsForPoMonthWorkerIds(db, poId, yearMonth, [workerId]);
  await syncPoMonthReviewFromClosures(db, poId, yearMonth, actor, periodBounds);
}

/** เปิดงวดรายคนกลับหลังยกเลิก payroll batch — ให้แก้ OT ใน wave-month ได้ */
export async function reopenWorkerMonthClosuresAfterPayrollCancel(
  db: Firestore,
  params: {
    poId: string;
    yearMonth: string;
    workerIds: string[];
    actor: User;
    periodBounds?: { periodStartDate: string; periodEndDate: string };
    /**
     * true = ไม่เคลียร์ readyForPayroll (ใช้ตอนลบ/สร้าง payroll batch ใหม่)
     * — ถ้าเคลียร์จะทำให้สร้าง batch ใหม่ได้ 0 คน จนกว่าจะซิงก์ใหม่
     */
    preserveReadyPayroll?: boolean;
  },
): Promise<{ reopened: number }> {
  const { poId, yearMonth, workerIds, actor, periodBounds } = params;
  const allow = new Set(workerIds.map((id) => id.trim()).filter(Boolean));
  if (allow.size === 0) return { reopened: 0 };

  const closures = await fetchWorkerClosuresForPoMonth(db, poId, yearMonth);
  let reopened = 0;
  const reopenedIds: string[] = [];

  for (const c of closures) {
    if (!allow.has(c.workerId)) continue;
    if (!REOPENABLE_AFTER_PAYROLL_CANCEL.includes(c.status)) continue;
    await upsertWorkerClosure(db, {
      poId,
      yearMonth,
      workerId: c.workerId,
      workerName: c.workerName,
      status: 'open',
      actor,
      patch: {
        entryLockedAt: deleteField(),
        entryLockedByUserId: deleteField(),
        entryLockedByName: deleteField(),
        submittedAt: deleteField(),
        submittedByUserId: deleteField(),
        submittedByName: deleteField(),
      },
    });
    reopened++;
    reopenedIds.push(c.workerId);
  }

  if (reopenedIds.length > 0) {
    if (!params.preserveReadyPayroll) {
      await clearReadyPayrollFlagsForPoMonthWorkerIds(db, poId, yearMonth, reopenedIds);
    }
    await syncPoMonthReviewFromClosures(db, poId, yearMonth, actor, periodBounds);
  }

  return { reopened };
}

export async function sendEntryLockedWorkersForManagerReview(
  db: Firestore,
  params: {
    poId: string;
    yearMonth: string;
    actor: User;
    periodBounds?: { periodStartDate: string; periodEndDate: string };
  },
): Promise<{ sent: number }> {
  const closures = await fetchWorkerClosuresForPoMonth(db, params.poId, params.yearMonth);
  const toSend = closures.filter((c) => c.status === 'entry_locked');
  if (toSend.length === 0) throw new Error('ไม่มีคนงานที่ปิดงวดแล้วรอส่งอนุมัติ');

  const now = Date.now();
  for (const c of toSend) {
    await upsertWorkerClosure(db, {
      poId: params.poId,
      yearMonth: params.yearMonth,
      workerId: c.workerId,
      workerName: c.workerName,
      status: 'pending_manager_review',
      actor: params.actor,
      patch: {
        submittedAt: now,
        submittedByUserId: params.actor.id,
        submittedByName: params.actor.displayName || params.actor.email || params.actor.id,
      },
    });
  }

  await syncPoMonthReviewFromClosures(db, params.poId, params.yearMonth, params.actor, params.periodBounds);
  return { sent: toSend.length };
}

export async function approveWorkerMonthClosure(
  db: Firestore,
  closure: WorkerMonthTimesheetClosure,
  actor: User,
  periodBounds?: { periodStartDate: string; periodEndDate: string },
): Promise<{ payrollUpdated: number }> {
  if (closure.status !== 'pending_manager_review') {
    throw new Error('สถานะไม่ใช่รอผู้จัดการ');
  }

  const now = Date.now();
  await upsertWorkerClosure(db, {
    poId: closure.poId,
    yearMonth: closure.yearMonth,
    workerId: closure.workerId,
    workerName: closure.workerName,
    status: 'approved',
    actor,
    patch: {
      reviewedAt: now,
      reviewedByUserId: actor.id,
      reviewedByName: actor.displayName || actor.email || actor.id,
    },
  });

  const { updated } = await markTimesheetsReadyForPoMonthWorkerIds(
    db,
    closure.poId,
    closure.yearMonth,
    [closure.workerId],
  );

  await syncPoMonthReviewFromClosures(db, closure.poId, closure.yearMonth, actor, periodBounds);
  return { payrollUpdated: updated };
}

export async function rejectWorkerMonthClosure(
  db: Firestore,
  closure: WorkerMonthTimesheetClosure,
  actor: User,
  reviewNote?: string,
  periodBounds?: { periodStartDate: string; periodEndDate: string },
): Promise<void> {
  if (closure.status !== 'pending_manager_review') {
    throw new Error('สถานะไม่ใช่รอผู้จัดการ');
  }

  const now = Date.now();
  await upsertWorkerClosure(db, {
    poId: closure.poId,
    yearMonth: closure.yearMonth,
    workerId: closure.workerId,
    workerName: closure.workerName,
    status: 'rejected',
    actor,
    patch: {
      reviewedAt: now,
      reviewedByUserId: actor.id,
      reviewedByName: actor.displayName || actor.email || actor.id,
      reviewNote,
    },
  });

  await syncPoMonthReviewFromClosures(db, closure.poId, closure.yearMonth, actor, periodBounds);
}

export function workerClosureByPoWorkerKey(
  closures: WorkerMonthTimesheetClosure[],
): Map<string, WorkerMonthTimesheetClosure> {
  const m = new Map<string, WorkerMonthTimesheetClosure>();
  for (const c of closures) {
    m.set(`${c.poId}|${c.workerId}`, c);
  }
  return m;
}
