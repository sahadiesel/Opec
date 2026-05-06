import type { Assignment } from '@/lib/types';
import { assignmentCountsTowardQuota } from '@/lib/ops/po-fulfillment-read-model';
import { assignmentReadyForWaveTimesheet } from '@/lib/constants/timesheet-ui';

/**
 * นับตามจำนวน mobilization ที่ยังจองโควต้า — สอดคล้องคอลัมน์ "มอบหมายแล้ว" บนหน้า Assignments
 * - mobPassed: พร้อมขึ้นตารางลงเวลา (readiness + deployment ตาม Wave Board)
 * - mobWaiting: มอบหมายแล้วแต่ยังไม่ผ่านเกณฑ์ขึ้น timesheet (รอ mobilization / รอตรวจสอบ ฯลฯ)
 */
export function countMobTimesheetSlotsForPoScope(
  assignments: readonly Assignment[] | undefined,
  poIdSet: ReadonlySet<string>,
): { mobPassed: number; mobWaiting: number } {
  /** คนละหนึ่งช่องต่อขอบเขต PO ในชุด — สอดคล้อง `pickRosterLinePerWorker` / โควต้าที่นับ unique worker ต่อบรรทัด */
  const byWorker = new Map<string, Assignment[]>();
  for (const a of assignments ?? []) {
    if (!poIdSet.has(a.poId)) continue;
    if (!assignmentCountsTowardQuota(a)) continue;
    const wkey = (a.workerId || '').trim() || a.id;
    const arr = byWorker.get(wkey) ?? [];
    arr.push(a);
    byWorker.set(wkey, arr);
  }
  let mobPassed = 0;
  let mobWaiting = 0;
  for (const arr of byWorker.values()) {
    if (arr.some((x) => assignmentReadyForWaveTimesheet(x))) mobPassed++;
    else mobWaiting++;
  }
  return { mobPassed, mobWaiting };
}
