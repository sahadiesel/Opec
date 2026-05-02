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
  let mobPassed = 0;
  let mobWaiting = 0;
  for (const a of assignments ?? []) {
    if (!poIdSet.has(a.poId)) continue;
    if (!assignmentCountsTowardQuota(a.deploymentStatus)) continue;
    if (assignmentReadyForWaveTimesheet(a)) mobPassed++;
    else mobWaiting++;
  }
  return { mobPassed, mobWaiting };
}
