import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  deleteField,
  where,
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
} from '@/lib/timesheet/po-month-timesheet-bridge';
import { aggregatePoMonthReviewStatusFromWorkerClosures } from '@/lib/timesheet/po-month-review-status';
import { lastDayOfCalendarMonth } from '@/lib/timesheet/wave-month-utils';
import { sanitizeFirestorePayload } from '@/lib/utils';

const FIRESTORE_IN_MAX = 30;

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
  /** ใช้ index ที่มีอยู่แล้ว (purchaseOrderId + date) — กรอง worker/LOCKED ฝั่ง client */
  const snap = await getDocs(
    query(
      collection(db, 'daily_timesheets'),
      where('purchaseOrderId', '==', pid),
      where('date', '>=', `${ym}-01`),
      where('date', '<=', `${ym}-31`),
    ),
  );
  for (const d of snap.docs) {
    const ts = d.data() as { workerId?: string; status?: string; date?: string };
    if ((ts.workerId || '').trim() !== wid) continue;
    if (!(ts.date || '').startsWith(`${ym}-`)) continue;
    if (ts.status === 'LOCKED') return true;
  }
  return false;
}

/**
 * ยกเลิกปิดงวดรายคน — กลับเป็น «เปิด» เพื่อแก้ชม./OT/ประเภทวัน
 * ใช้ได้เมื่อยังไม่ล็อก payroll (ใบงานไม่เป็น LOCKED)
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
  if (await workerHasLockedTimesheetsInPoMonth(db, poId, yearMonth, workerId)) {
    throw new Error(
      'มีใบงานถูกล็อกในชุดจ่าย payroll แล้ว — ยกเลิก/ลบชุดจ่ายก่อนจึงจะเปิดงวดกลับมาแก้ได้',
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
    await clearReadyPayrollFlagsForPoMonthWorkerIds(db, poId, yearMonth, reopenedIds);
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
