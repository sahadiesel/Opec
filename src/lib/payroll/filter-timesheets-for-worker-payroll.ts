import { doc, getDoc, getDocs, query, collection, where, type Firestore } from 'firebase/firestore';
import type { Assignment, DailyTimesheet } from '@/lib/types';
import {
  assignmentHasSplitPriorAndNewCycleOnDoc,
  isYmdWithinAssignmentMobTimesheetWindow,
  resolveMobSegmentStartYmd,
} from '@/lib/constants/timesheet-ui';
import { shouldDeleteStalePoActiveAutoDailyRow } from '@/lib/timesheet/po-active-auto-daily-build';
import { pickRosterLinePerWorker, rosterDeploymentTier } from '@/lib/ops/assignment-roster';

/** โหลด mobilization ที่ timesheet อ้างอิง */
export async function loadAssignmentsForTimesheets(
  db: Firestore,
  tsList: readonly Pick<DailyTimesheet, 'assignmentId'>[],
): Promise<Map<string, Assignment>> {
  const ids = [
    ...new Set(
      tsList
        .map((t) => String(t.assignmentId || '').trim())
        .filter((id) => id.length > 0),
    ),
  ];
  const map = new Map<string, Assignment>();
  await Promise.all(
    ids.map(async (id) => {
      const snap = await getDoc(doc(db, 'mobilizations', id));
      if (snap.exists()) {
        map.set(id, { id: snap.id, ...(snap.data() as object) } as Assignment);
      }
    }),
  );
  return map;
}

/**
 * วันนี้อยู่ในหน้าต่าง mobilization ของ assignment หรือไม่ — ใช้กรอง payroll ก่อนปิดงวด (readyForPayroll)
 */
export function isDailyTimesheetInPayrollMobWindow(
  ts: Pick<DailyTimesheet, 'date' | 'assignmentId'>,
  assignmentById: Map<string, Assignment>,
): boolean {
  const aid = String(ts.assignmentId || '').trim();
  if (!aid) return true;
  const asgn = assignmentById.get(aid);
  if (!asgn) return true;
  return isYmdWithinAssignmentMobTimesheetWindow(asgn, ts.date);
}

/**
 * ใบงานที่ถูกแทนด้วยรอบ mob ใหม่ของคน+PO เดียวกันในเดือนเดียวกัน
 * (เอกสาร mobilization เก่าคนละใบ / หรือรอบเก่าบนเอกสารเดียวกันหลัง remob)
 * — ไม่ใช้ตัดจ่ายแล้ว; คงไว้ให้ callers อื่น / อ้างอิง
 */
export function isDailyTimesheetSupersededByCurrentMobCycle(
  ts: Pick<DailyTimesheet, 'date' | 'assignmentId' | 'workerId' | 'purchaseOrderId'>,
  assignmentById: Map<string, Assignment>,
): boolean {
  const ymd = String(ts.date || '').slice(0, 10);
  const ym = ymd.slice(0, 7);
  const wid = String(ts.workerId || '').trim();
  const poId = String(ts.purchaseOrderId || '').trim();
  const sheetAid = String(ts.assignmentId || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || !wid) return false;

  const sheetAsgn = sheetAid ? assignmentById.get(sheetAid) : undefined;
  const effectivePoId = poId || String(sheetAsgn?.poId || '').trim();
  if (!effectivePoId) return false;

  const samePo = [...assignmentById.values()].filter(
    (a) =>
      String(a.workerId || '').trim() === wid &&
      String(a.poId || '').trim() === effectivePoId,
  );
  if (samePo.length === 0) return false;

  const preferred = pickRosterLinePerWorker(samePo)[0];
  if (!preferred) return false;
  if (rosterDeploymentTier(preferred.deploymentStatus) < 40) return false;

  const segStart = resolveMobSegmentStartYmd(preferred);
  if (!segStart || segStart.slice(0, 7) !== ym) return false;
  if (ymd >= segStart) return false;

  /** วันก่อนเริ่มรอบปัจจุบันในเดือนเดียวกัน — ไม่จ่าย (ตรงกริดที่ว่างถึงก่อน M1) */
  if (sheetAid && sheetAid === preferred.id) {
    if (assignmentHasSplitPriorAndNewCycleOnDoc(preferred)) return true;
    return shouldDeleteStalePoActiveAutoDailyRow(preferred, ymd);
  }
  return true;
}

/**
 * ใบงานที่ควรเข้า worker payroll
 *
 * กฎผลิตภัณฑ์ (remob / หลายรอบในเดือน):
 * - วันทำงานที่บันทึกแล้วและยังไม่จ่าย ห้ามตัดทิ้งเพราะ remob / รอบ Mob ใหม่
 * - ตัวอย่าง: ลง 1 ขึ้น 5 · remob 10–15 · remob 25–30 → จ่ายรวม 17 วัน
 * - ถ้ารอบก่อนจ่าย 1–5 ไปแล้ว → งวดหลังรวมทั้งเดือนแล้วหักยอดที่จ่ายแล้ว
 *
 * กรองเฉพาะ: unpaid_leave · แถว auto ค้างหลังจบไซต์รอ remob (ไม่ใช่ใบงานจริง)
 *
 * หมายเหตุ: ไม่ใช้ `readyForPayroll` เป็นเงื่อนไขที่นี่ — generate หลังปิดงวดใช้กฎนี้
 * (ถ้าบังคับ ready อย่างเดียว วันรอบเก่าที่ flag ถูกเคลียร์จะหายจากงวด)
 */
export function isDailyTimesheetPayableForWorkerPayroll(
  ts: Pick<
    DailyTimesheet,
    | 'date'
    | 'assignmentId'
    | 'eventType'
    | 'readyForPayroll'
    | 'workerId'
    | 'purchaseOrderId'
    | 'poActiveAutoDaily'
  >,
  assignmentById: Map<string, Assignment>,
): boolean {
  if (ts.eventType === 'unpaid_leave') return false;
  const aid = String(ts.assignmentId || '').trim();
  if (!aid) return true;
  const asgn = assignmentById.get(aid);
  if (!asgn) return true;
  const ymd = String(ts.date || '').slice(0, 10);
  /** แถว auto ที่ระบบสร้างเกินหน้าต่างไซต์ขณะรอ remob — ไม่ใช่วันที่ HR ลงเวลาจริง */
  if (ts.poActiveAutoDaily === true && shouldDeleteStalePoActiveAutoDailyRow(asgn, ymd)) {
    return false;
  }
  return true;
}

/** แยกใบงานที่ควรจ่าย vs ใบที่มี readyForPayroll ค้างแต่ไม่ควรจ่าย (เคลียร์ตอนซิงก์) */
export async function partitionTimesheetsForPayrollReadiness(
  db: Firestore,
  tsList: readonly DailyTimesheet[],
): Promise<{ payable: DailyTimesheet[]; staleReady: DailyTimesheet[] }> {
  if (tsList.length === 0) return { payable: [], staleReady: [] };
  const assignmentById = await loadAssignmentsForTimesheets(db, tsList);
  const payable: DailyTimesheet[] = [];
  const staleReady: DailyTimesheet[] = [];
  for (const ts of tsList) {
    if (isDailyTimesheetPayableForWorkerPayroll(ts, assignmentById)) {
      payable.push(ts);
    } else if (ts.readyForPayroll === true) {
      staleReady.push(ts);
    }
  }
  return { payable, staleReady };
}

export function filterTimesheetsForWorkerPayroll(
  tsList: readonly DailyTimesheet[],
  assignmentById: Map<string, Assignment>,
): DailyTimesheet[] {
  return tsList.filter((ts) => isDailyTimesheetPayableForWorkerPayroll(ts, assignmentById));
}

/** โหลด assignment แล้วกรองชุด timesheet ให้ตรง wave-month */
export async function filterTimesheetsForWorkerPayrollAsync(
  db: Firestore,
  tsList: readonly DailyTimesheet[],
): Promise<DailyTimesheet[]> {
  if (tsList.length === 0) return [];
  const assignmentById = await loadAssignmentsForTimesheets(db, tsList);

  /** โหลด mobilization อื่นของคนเดียวกัน — ตรวจรอบ mob ปัจจุบันต่อ PO */
  const workerIds = [
    ...new Set(tsList.map((t) => String(t.workerId || '').trim()).filter(Boolean)),
  ];
  await Promise.all(
    workerIds.map(async (wid) => {
      const snap = await getDocs(
        query(collection(db, 'mobilizations'), where('workerId', '==', wid)),
      );
      for (const d of snap.docs) {
        if (assignmentById.has(d.id)) continue;
        assignmentById.set(d.id, { id: d.id, ...(d.data() as object) } as Assignment);
      }
    }),
  );

  return filterTimesheetsForWorkerPayroll(tsList, assignmentById);
}

/**
 * โหลดใบงานรายวันของคนงานในงวดที่พร้อมจ่าย — ไม่ใช้ composite index (workerId + date + readyForPayroll)
 * กรองช่วงวันที่ / readyForPayroll / mob window ฝั่ง client
 *
 * @param options.includePayrollLocked — ใช้ตอนคำนวณใหม่รายคน: ใบงานถูก LOCKED หลังสร้าง batch แล้ว
 *   (หลังล็อกมักเคลียร์ readyForPayroll — ต้องรับ LOCKED โดยไม่บังคับ ready)
 * @param options.refreshFromCurrentTimesheets — รวมใบในงวดที่ผ่านกฎ payable แม้ยังไม่ ready/LOCKED
 *   (ให้รายคนตรง timesheet ปัจจุบันหลัง remob / แก้วันที่)
 */
export async function loadWorkerPayableTimesheetsForPeriod(
  db: Firestore,
  workerId: string,
  periodStart: string,
  periodEnd: string,
  options?: { includePayrollLocked?: boolean; refreshFromCurrentTimesheets?: boolean },
): Promise<DailyTimesheet[]> {
  const tsSnap = await getDocs(
    query(collection(db, 'daily_timesheets'), where('workerId', '==', workerId)),
  );
  let loaded = tsSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as object) } as DailyTimesheet))
    .filter((ts) => {
      const d = String(ts.date || '').slice(0, 10);
      if (d < periodStart || d > periodEnd) return false;
      if (ts.status === 'REJECTED') return false;
      if (options?.refreshFromCurrentTimesheets) return true;
      if (ts.status === 'LOCKED') return options?.includePayrollLocked === true;
      return ts.readyForPayroll === true;
    });

  loaded = await filterTimesheetsForWorkerPayrollAsync(db, loaded);
  return loaded;
}

/**
 * @deprecated ไม่ใช้ตัด prefix ตอน payroll อีกแล้ว — วันทำงานที่บันทึกแล้วต้องจ่ายครบทั้งเดือน
 * คงฟังก์ชันไว้เพื่อไม่พัง import เก่า (คืนรายการเดิม)
 */
export function excludeDisconnectedPrefixBeforeLatestMobCycle(
  tsList: readonly DailyTimesheet[],
): DailyTimesheet[] {
  return [...tsList].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}

/**
 * ใบงานสำหรับแสดง/คำนวณใหม่รายคนใน batch — รวมวัน LOCKED + วันใหม่ทั้งเดือน
 * (ห้ามตัดรอบ mob เก่าที่ยังเป็นวันทำงานจริง)
 */
export async function loadWorkerTimesheetsForPayrollLine(
  db: Firestore,
  workerId: string,
  periodStart: string,
  periodEnd: string,
  sourceTimesheetIds?: readonly string[] | null,
): Promise<DailyTimesheet[]> {
  const fromCurrent = await loadWorkerPayableTimesheetsForPeriod(db, workerId, periodStart, periodEnd, {
    includePayrollLocked: true,
    refreshFromCurrentTimesheets: true,
  });

  const rawIds = [...new Set((sourceTimesheetIds ?? []).map((id) => String(id || '').trim()).filter(Boolean))];
  const fromSource: DailyTimesheet[] = [];
  for (const tid of rawIds) {
    const s = await getDoc(doc(db, 'daily_timesheets', tid));
    if (!s.exists()) continue;
    const ts = { id: s.id, ...(s.data() as object) } as DailyTimesheet;
    const d = String(ts.date || '').slice(0, 10);
    if (d < periodStart || d > periodEnd) continue;
    if (ts.workerId !== workerId) continue;
    fromSource.push(ts);
  }
  const fromSourcePayable = await filterTimesheetsForWorkerPayrollAsync(db, fromSource);

  const byId = new Map<string, DailyTimesheet>();
  for (const ts of fromCurrent) byId.set(ts.id, ts);
  for (const ts of fromSourcePayable) {
    if (!byId.has(ts.id)) byId.set(ts.id, ts);
  }

  return [...byId.values()].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}
