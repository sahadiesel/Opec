import { doc, getDoc, getDocs, query, collection, where, type Firestore } from 'firebase/firestore';
import type { Assignment, DailyTimesheet } from '@/lib/types';
import {
  isYmdWithinAssignmentMobTimesheetWindow,
  waveMonthCellTimesheetVisible,
} from '@/lib/constants/timesheet-ui';

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
 */
export function isDailyTimesheetPayableForWorkerPayroll(
  ts: Pick<DailyTimesheet, 'date' | 'assignmentId' | 'eventType' | 'readyForPayroll'>,
  assignmentById: Map<string, Assignment>,
): boolean {
  if (ts.eventType === 'unpaid_leave') return false;
  const aid = String(ts.assignmentId || '').trim();
  if (!aid) return ts.readyForPayroll === true;
  const asgn = assignmentById.get(aid);
  if (!asgn) return ts.readyForPayroll === true;
  return waveMonthCellTimesheetVisible(asgn, ts.date, ts as DailyTimesheet);
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
  return filterTimesheetsForWorkerPayroll(tsList, assignmentById);
}

/**
 * โหลดใบงานรายวันของคนงานในงวดที่พร้อมจ่าย — ไม่ใช้ composite index (workerId + date + readyForPayroll)
 * กรองช่วงวันที่ / readyForPayroll / mob window ฝั่ง client
 *
 * @param options.includePayrollLocked — ใช้ตอนคำนวณใหม่รายคน: ใบงานถูก LOCKED หลังสร้าง batch แล้ว แต่ยังอยู่ในงวดเดิม
 */
export async function loadWorkerPayableTimesheetsForPeriod(
  db: Firestore,
  workerId: string,
  periodStart: string,
  periodEnd: string,
  options?: { includePayrollLocked?: boolean },
): Promise<DailyTimesheet[]> {
  const tsSnap = await getDocs(
    query(collection(db, 'daily_timesheets'), where('workerId', '==', workerId)),
  );
  let loaded = tsSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as object) } as DailyTimesheet))
    .filter((ts) => {
      const d = String(ts.date || '').slice(0, 10);
      if (d < periodStart || d > periodEnd) return false;
      if (ts.readyForPayroll !== true) return false;
      if (ts.status === 'LOCKED') return options?.includePayrollLocked === true;
      return true;
    });

  loaded = await filterTimesheetsForWorkerPayrollAsync(db, loaded);
  return loaded;
}
