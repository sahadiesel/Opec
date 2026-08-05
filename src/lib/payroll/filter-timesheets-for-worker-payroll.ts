import { doc, getDoc, getDocs, query, collection, where, type Firestore } from 'firebase/firestore';
import type { Assignment, DailyTimesheet } from '@/lib/types';
import {
  assignmentHasSplitPriorAndNewCycleOnDoc,
  isYmdWithinAssignmentMobTimesheetWindow,
  resolveMobSegmentStartYmd,
  waveMonthCellTimesheetPayable,
} from '@/lib/constants/timesheet-ui';
import { shouldDeleteStalePoActiveAutoDailyRow } from '@/lib/timesheet/po-active-auto-daily-build';
import { pickRosterLinePerWorker, rosterDeploymentTier } from '@/lib/ops/assignment-roster';
import { addDaysToYmd } from '@/lib/ops/mobilization-final-clearance';

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
 * ใบงานที่ควรเข้า worker payroll — สอดคล้องกริดสรุปรายเดือน (wave-month):
 * - ไม่รวม unpaid_leave
 * - ไม่รวม SB/W หลังวันจบไซต์รอ remob แม้มี readyForPayroll ค้างจาก sync เก่า
 *
 * หมายเหตุ: ไม่ใช้ `readyForPayroll` เป็นเงื่อนไขที่นี่ — ใช้ตอนซิงก์เพื่อตัดสินว่าควรตั้ง flag หรือไม่
 * (ถ้าบังคับ ready อยู่แล้ว จะซิงก์หลังลบ batch ไม่สำเร็จ เพราะ unlock เคลียร์ flag ไปแล้ว)
 */
/**
 * ใบงานที่ถูกแทนด้วยรอบ mob ใหม่ของคน+PO เดียวกันในเดือนเดียวกัน
 * (เอกสาร mobilization เก่าคนละใบ / หรือรอบเก่าบนเอกสารเดียวกันหลัง remob)
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

export function isDailyTimesheetPayableForWorkerPayroll(
  ts: Pick<DailyTimesheet, 'date' | 'assignmentId' | 'eventType' | 'readyForPayroll' | 'workerId' | 'purchaseOrderId'>,
  assignmentById: Map<string, Assignment>,
): boolean {
  if (ts.eventType === 'unpaid_leave') return false;
  const aid = String(ts.assignmentId || '').trim();
  if (!aid) return true;
  const asgn = assignmentById.get(aid);
  if (!asgn) return true;
  const ymd = String(ts.date || '').slice(0, 10);
  if (!waveMonthCellTimesheetPayable(asgn, ymd, ts as DailyTimesheet)) return false;
  /**
   * ใบ LOCKED/ค้างก่อนวัน remob ที่ purge ลบไม่ได้ (เช่น W 1–4 ก่อน M1 รอบใหม่)
   * — สอดคล้อง shouldDeleteStalePoActiveAutoDailyRow / กริดสรุปรายเดือนหลัง remob
   */
  if (shouldDeleteStalePoActiveAutoDailyRow(asgn, ymd)) return false;
  if (isDailyTimesheetSupersededByCurrentMobCycle(ts, assignmentById)) return false;
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
 * ตัดใบค้างก่อนรอบ M1/Final clearance ล่าสุด เมื่อมีช่องว่างปฏิทินคั่น
 * — ทำแยกต่อ PO (คนละลูกค้า/PO เช่น AVP 1–4 กับ Thai Nippon M1 14 ไม่ตัดทิ้งข้าม PO)
 */
export function excludeDisconnectedPrefixBeforeLatestMobCycle(
  tsList: readonly DailyTimesheet[],
): DailyTimesheet[] {
  if (tsList.length === 0) return [];

  const byPo = new Map<string, DailyTimesheet[]>();
  for (const ts of tsList) {
    const po = String(ts.purchaseOrderId || '').trim() || '_unknown_po';
    const list = byPo.get(po) ?? [];
    list.push(ts);
    byPo.set(po, list);
  }

  const out: DailyTimesheet[] = [];
  for (const group of byPo.values()) {
    const sorted = [...group].sort((a, b) =>
      String(a.date || '').localeCompare(String(b.date || '')),
    );

    const cycleStarts = sorted
      .filter((t) => {
        const et = String(t.eventType || '');
        if (et === 'mobilization_day') return true;
        const rmk = String(t.remark ?? '');
        return rmk.includes('Final clearance') && (et === 'standby_day' || et === 'mobilization_day');
      })
      .map((t) => String(t.date || '').slice(0, 10))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));

    if (cycleStarts.length === 0) {
      out.push(...sorted);
      continue;
    }

    const cycleStart = cycleStarts.reduce((a, b) => (a >= b ? a : b));
    const dayBefore = addDaysToYmd(cycleStart, -1);
    const contiguous = sorted.some((t) => String(t.date || '').slice(0, 10) === dayBefore);
    if (contiguous) {
      out.push(...sorted);
      continue;
    }

    out.push(...sorted.filter((t) => String(t.date || '').slice(0, 10) >= cycleStart));
  }

  return out.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}

/**
 * ใบงานสำหรับแสดง/คำนวณใหม่รายคนใน batch — ให้ตรง timesheet ปัจจุบัน
 * (ไม่ยึด sourceTimesheetIds อย่างเดียว เพราะอาจค้างรอบ mob เก่าที่ purge ลบไม่ได้หลัง LOCKED)
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

  const merged = excludeDisconnectedPrefixBeforeLatestMobCycle([...byId.values()]);
  return merged.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}
