/**
 * บังคับหนึ่งสถานะต่อคนต่อ PO ต่อวันปฏิทิน
 * — doc id เป็น worker_assignment_date จึงเกิดใบซ้ำได้เมื่อมีหลาย mobilization ของคน+PO เดียวกัน
 */

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
  type Firestore,
  type WriteBatch,
} from 'firebase/firestore';
import type { DailyTimesheet } from '@/lib/types';

const FINANCIAL_IMMUTABLE = new Set(['CLIENT_APPROVED', 'VERIFIED_PAPER', 'LOCKED']);

function isFinanciallyImmutable(status: string | undefined): boolean {
  return FINANCIAL_IMMUTABLE.has(status || '');
}

export type WorkerPoDayConflictCleanupResult = {
  deleted: number;
  /** มีใบที่ปิดบัญชีแล้วคนละ assignment — ไม่ลบ */
  blockedFinalized: number;
};

/**
 * ลบใบลงเวลาคนละ assignmentId ที่ชนวันเดียวกัน (worker + PO + date)
 * @param keepDocId — เก็บเอกสารนี้ไว้ (ปกติ = `${workerId}_${keepAssignmentId}_${date}`)
 */
export async function deleteConflictingWorkerPoDayTimesheets(
  db: Firestore,
  args: {
    workerId: string;
    purchaseOrderId: string;
    dateYmd: string;
    keepAssignmentId: string;
    keepDocId?: string;
    /** ถ้ามี — ใส่ delete ใน batch เดียวกัน (ไม่ commit ที่นี่) */
    batch?: WriteBatch;
  },
): Promise<WorkerPoDayConflictCleanupResult> {
  const workerId = args.workerId.trim();
  const poId = args.purchaseOrderId.trim();
  const date = args.dateYmd.trim().slice(0, 10);
  const keepAid = args.keepAssignmentId.trim();
  if (!workerId || !poId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !keepAid) {
    return { deleted: 0, blockedFinalized: 0 };
  }

  const keepId =
    args.keepDocId?.trim() || `${workerId}_${keepAid}_${date}`;

  /** query worker+date แล้วกรอง PO ฝั่ง client — เลี่ยง index ใหม่ */
  const snap = await getDocs(
    query(
      collection(db, 'daily_timesheets'),
      where('workerId', '==', workerId),
      where('date', '==', date),
    ),
  );

  let deleted = 0;
  let blockedFinalized = 0;

  for (const d of snap.docs) {
    if (d.id === keepId) continue;
    const cur = d.data() as DailyTimesheet;
    if ((cur.purchaseOrderId || '').trim() !== poId) continue;
    if ((cur.assignmentId || '').trim() === keepAid) continue;
    if (isFinanciallyImmutable(cur.status)) {
      blockedFinalized++;
      continue;
    }
    if (args.batch) {
      args.batch.delete(d.ref);
    } else {
      await deleteDoc(d.ref);
    }
    deleted++;
  }

  return { deleted, blockedFinalized };
}

/**
 * ลบใบ orphan ของคน+PO ที่ไม่ใช่ keepAssignmentId ในช่วงวันที่ (รวมขอบ)
 * — ใช้ตอน remob / heal เมื่อมี mobilization เอกสารเก่าค้าง
 */
export async function deleteOrphanTimesheetsForWorkerPoInRange(
  db: Firestore,
  args: {
    workerId: string;
    purchaseOrderId: string;
    keepAssignmentId: string;
    fromYmdInclusive: string;
    toYmdInclusive?: string;
  },
): Promise<{ deleted: number; skipped: number }> {
  const workerId = args.workerId.trim();
  const poId = args.purchaseOrderId.trim();
  const keepAid = args.keepAssignmentId.trim();
  const from = args.fromYmdInclusive.trim().slice(0, 10);
  const to = (args.toYmdInclusive || '').trim().slice(0, 10);
  if (!workerId || !poId || !keepAid || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return { deleted: 0, skipped: 0 };
  }

  const snap = await getDocs(
    query(collection(db, 'daily_timesheets'), where('workerId', '==', workerId), where('date', '>=', from)),
  );

  let deleted = 0;
  let skipped = 0;
  for (const d of snap.docs) {
    const cur = d.data() as DailyTimesheet;
    const date = (cur.date || '').trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (date < from) continue;
    if (to && date > to) continue;
    if ((cur.purchaseOrderId || '').trim() !== poId) continue;
    if ((cur.assignmentId || '').trim() === keepAid) continue;
    if (isFinanciallyImmutable(cur.status)) {
      skipped++;
      continue;
    }
    await deleteDoc(doc(db, 'daily_timesheets', d.id));
    deleted++;
  }
  return { deleted, skipped };
}

/**
 * เคลียร์ใบซ้ำคน+PO ในเดือนปฏิทิน — เก็บใบของ keepAssignmentId ถ้ามี
 * (ใช้ตอน sync / เปิดสรุปรายเดือน เพื่อ heal ข้อมูล remob เก่า)
 */
export async function healOneTimesheetPerWorkerPoDayInMonth(
  db: Firestore,
  args: {
    workerId: string;
    purchaseOrderId: string;
    keepAssignmentId: string;
    monthYm: string;
  },
): Promise<{ deleted: number; skipped: number }> {
  const workerId = args.workerId.trim();
  const poId = args.purchaseOrderId.trim();
  const keepAid = args.keepAssignmentId.trim();
  const ym = args.monthYm.trim().slice(0, 7);
  if (!workerId || !poId || !keepAid || !/^\d{4}-\d{2}$/.test(ym)) {
    return { deleted: 0, skipped: 0 };
  }

  const monthStart = `${ym}-01`;
  const snap = await getDocs(
    query(
      collection(db, 'daily_timesheets'),
      where('workerId', '==', workerId),
      where('date', '>=', monthStart),
      where('date', '<=', `${ym}-31`),
    ),
  );

  const byDate = new Map<string, { id: string; ts: DailyTimesheet }[]>();
  for (const d of snap.docs) {
    const ts = d.data() as DailyTimesheet;
    if ((ts.purchaseOrderId || '').trim() !== poId) continue;
    const date = (ts.date || '').trim().slice(0, 10);
    if (!date.startsWith(`${ym}-`)) continue;
    const list = byDate.get(date) ?? [];
    list.push({ id: d.id, ts });
    byDate.set(date, list);
  }

  let deleted = 0;
  let skipped = 0;
  for (const group of byDate.values()) {
    if (group.length <= 1) continue;
    const keep =
      group.find((g) => (g.ts.assignmentId || '').trim() === keepAid) ??
      [...group].sort(
        (a, b) => (Number(b.ts.updatedAt) || 0) - (Number(a.ts.updatedAt) || 0),
      )[0];
    for (const g of group) {
      if (g.id === keep.id) continue;
      if (isFinanciallyImmutable(g.ts.status)) {
        skipped++;
        continue;
      }
      await deleteDoc(doc(db, 'daily_timesheets', g.id));
      deleted++;
    }
  }
  return { deleted, skipped };
}

/**
 * เติมชม.ให้ใบ SB/M1/D1 ที่เคยบันทึก 0 — ให้รายวัน/รายเดือน/สัดส่วนเงินใช้ฐานเดียวกัน
 * - standby_day → 8 ชม. (มาตรฐานจ่าย SB)
 * - M1/D1 → ชม.แพ็ก (Offshore 12 / Onshore 8)
 */
export async function healZeroStandbyLikeHoursInMonth(
  db: Firestore,
  args: {
    workerId: string;
    purchaseOrderId: string;
    assignmentId: string;
    monthYm: string;
    packageHours: 8 | 12;
  },
): Promise<{ updated: number; skipped: number }> {
  const workerId = args.workerId.trim();
  const poId = args.purchaseOrderId.trim();
  const aid = args.assignmentId.trim();
  const ym = args.monthYm.trim().slice(0, 7);
  const pkg = args.packageHours === 8 ? 8 : 12;
  if (!workerId || !poId || !aid || !/^\d{4}-\d{2}$/.test(ym)) {
    return { updated: 0, skipped: 0 };
  }

  const snap = await getDocs(
    query(
      collection(db, 'daily_timesheets'),
      where('workerId', '==', workerId),
      where('date', '>=', `${ym}-01`),
      where('date', '<=', `${ym}-31`),
    ),
  );

  let updated = 0;
  let skipped = 0;
  for (const d of snap.docs) {
    const ts = d.data() as DailyTimesheet;
    if ((ts.purchaseOrderId || '').trim() !== poId) continue;
    if ((ts.assignmentId || '').trim() !== aid) continue;
    const et = String(ts.eventType || '');
    if (et !== 'standby_day' && et !== 'mobilization_day' && et !== 'demobilization_day') continue;
    if (isFinanciallyImmutable(ts.status)) {
      skipped++;
      continue;
    }
    const nh = Number(ts.normalHours);
    if (Number.isFinite(nh) && nh > 0) continue;
    const hours = et === 'standby_day' ? 8 : pkg;
    await updateDoc(d.ref, {
      normalHours: hours,
      mobBillingChargeHours: hours,
      mobPayrollChargeHours: hours,
      updatedAt: Date.now(),
    });
    updated++;
  }
  return { updated, skipped };
}
