import type { Assignment, DailyTimesheet, POLine, PurchaseOrder } from '@/lib/types';
import { poTimesheetScopeId } from '@/lib/constants/timesheet-po-scope';
import {
  assignmentHasSplitPriorAndNewCycleOnDoc,
  isYmdInRemobGapBetweenCycles,
  resolveMobSegmentStartYmd,
} from '@/lib/constants/timesheet-ui';
import { resolveWorkModeForPoContext } from '@/lib/ops/po-active-bundle';
import { addDaysToYmd, thailandTodayYmd } from '@/lib/ops/mobilization-final-clearance';

export function minYmd(a: string, b: string): string {
  return a <= b ? a : b;
}

/** Document id เดียวกับ Wave timesheet — worker + mobilization + วันที่ */
export function poActiveDailyTimesheetDocId(workerId: string, assignmentId: string, date: string): string {
  return `${workerId}_${assignmentId}_${date}`;
}

function msToYmdUtc(ms: unknown): string {
  const n = typeof ms === 'number' && Number.isFinite(ms) ? ms : Date.now();
  return new Date(n).toISOString().slice(0, 10);
}

/** ถ้าไม่มี waveId (ข้อมูลเก่า) ใช้คีย์ scope PO เดียวกับตอน assign ใหม่ */
export function effectiveWaveIdForPoActiveAuto(a: Pick<Assignment, 'waveId' | 'poId'>): string | null {
  const w = (a.waveId || '').trim();
  if (w) return w;
  const pid = (a.poId || '').trim();
  if (!pid) return null;
  return poTimesheetScopeId(pid);
}

/** ACTIVE + ยังไม่ Unassign + มีข้อมูลผูก PO (+ waveId จริงหรือ fallback PO scope) */
export function isAssignmentEligibleForPoActiveAutoDaily(a: Assignment): boolean {
  if (a.deploymentStatus !== 'ACTIVE') return false;
  if (typeof a.unassignedAt === 'number' && a.unassignedAt > 0) return false;
  const siteId = effectiveWaveIdForPoActiveAuto(a);
  return !!(a.poId?.trim() && a.poLineId?.trim() && a.workerId?.trim() && siteId);
}

/** จำนวนวันที่ระบบเติม SB อัตโนมัติเมื่อหยุดแบบ standby (รวมวันเริ่ม) */
export const PO_ACTIVE_STANDBY_STOP_AUTO_DAYS = 7;

/**
 * ว่าจะซิงก์ PO Active auto สำหรับวันนี้เป็น work / standby / ไม่ซิงก์
 * — null = ไม่สร้างหรือไม่อัปเดตแถวอัตโนมัติสำหรับวันนั้น (เช่น flag ระงับแต่ไม่มีช่วง SB ครบ)
 * — หลังจบช่วง SB ให้กลับลง work_day อัตโนมัติ (ไม่ปิดการซิงก์ถาวรจนกว่าจะไปแก้ Mobilization)
 */
export function resolvePoActiveAutoDailySyncKind(a: Assignment, dateYmd: string): 'work_day' | 'standby_day' | null {
  if (!isAssignmentEligibleForPoActiveAutoDaily(a)) return null;
  if (isYmdInRemobGapBetweenCycles(a, dateYmd)) return null;
  const suspended = a.poActiveAutoWorkSuspended === true;
  const sbStart = (a.poActiveStandbyAutoStartYmd || '').trim().slice(0, 10);
  const sbEnd = (a.poActiveStandbyAutoEndYmd || '').trim().slice(0, 10);
  const hasSeg = /^\d{4}-\d{2}-\d{2}$/.test(sbStart) && /^\d{4}-\d{2}-\d{2}$/.test(sbEnd);
  if (suspended) {
    if (!hasSeg) return null;
    if (dateYmd >= sbStart && dateYmd <= sbEnd) return 'standby_day';
    /** นอกช่วงระงับ work อัตโนมัติ — ใช้กฎ SB/ทำงานปกติด้านล่าง */
  }

  /** SB ตามฟิลด์ mobilization ก่อนวันเริ่มงาน — ให้ตรงกับช่องที่ตารางรายเดือนเปิดอยู่แล้ว */
  const mobStandby = (a.mobStandbyDate || '').trim().slice(0, 10);
  const mobStart = (a.mobWorkingStartDate || '').trim().slice(0, 10);
  const hasNaturalSb = /^\d{4}-\d{2}-\d{2}$/.test(mobStandby);
  const hasMobStart = /^\d{4}-\d{2}-\d{2}$/.test(mobStart);
  if (hasNaturalSb && hasMobStart && mobStandby < mobStart && dateYmd >= mobStandby && dateYmd < mobStart) {
    return 'standby_day';
  }

  return 'work_day';
}

/**
 * ช่วงสร้างรายวัน: เริ่มต้นสอดคล้อง `isYmdWithinAssignmentMobTimesheetWindow` (หน้าต่างบนตารางรายเดือน)
 * — รวมช่วง SB ก่อนวันเริ่มงาน และช่วงหลัง startDate แต่ก่อน mobWorkingStartDate (กรณีไม่มีฟิลด์ SB)
 *   เพื่อไม่ให้บางคนได้แถวอัตโนมัติแต่คนที่มี mobWorkingStartDate ชัดเจนกลับว่าง
 * ถึง min(วันนี้ Bangkok, endDate assignment, PO end, mobLocationEndDate เมื่อยังใช้ได้)
 *
 * หมายเหตุ: `mobLocationEndDate` อาจเป็นวันจบไซต์ **รอบก่อน** บนเอกสารเดียวกับรอบใหม่
 * (mobStandby / mobWorkingStartDate หลังวันนั้น) — ถ้านำไปเป็นเพดานโดยตรงจะได้ start > end → ไม่สร้าง auto
 * จึงใช้เป็นฝาเฉพาะเมื่อ `mobLocationEndDate >= startRaw` (สอดคล้อง `splitPriorAndNewCycleOnDoc` ใน timesheet-ui)
 */
export function computePoActiveAutoDailyRange(
  a: Assignment,
  po: Pick<PurchaseOrder, 'startDate' | 'endDate'>,
): { start: string; end: string } | null {
  const today = thailandTodayYmd();
  const throughYmd = today;

  const mobStandby = ((a.mobStandbyDate || '') as string).trim().slice(0, 10);
  const mobStart = ((a.mobWorkingStartDate || '') as string).trim().slice(0, 10);
  const assignStart = ((a.startDate || '') as string).trim().slice(0, 10);
  const assignedFallback = ((a.assignedDate || '') as string).trim().slice(0, 10);
  const hasStandby = /^\d{4}-\d{2}-\d{2}$/.test(mobStandby);
  const hasMobStart = /^\d{4}-\d{2}-\d{2}$/.test(mobStart);
  const hasAssignStart = /^\d{4}-\d{2}-\d{2}$/.test(assignStart);
  const splitPriorAndNewCycleOnDoc = assignmentHasSplitPriorAndNewCycleOnDoc(a);

  let startRaw = '';

  if (hasStandby && hasMobStart && mobStandby < mobStart) {
    startRaw = mobStandby;
  } else if (hasMobStart) {
    startRaw = mobStart;
    /** ช่วงก่อนเริ่มงานไม่มี mobStandbyDate — ตารางรายเดือนใช้ startDate เป็นพื้น (ไม่ใช่ remob หลังจบรอบเก่า) */
    if (!hasStandby && hasAssignStart && assignStart < mobStart && !splitPriorAndNewCycleOnDoc) {
      startRaw = assignStart;
    }
  } else if (hasAssignStart) {
    startRaw = assignStart;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(assignedFallback)) {
    startRaw = assignedFallback;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startRaw)) return null;

  /** remob หลังจบไซต์รอบเก่า — เริ่ม auto ตั้งแต่วัน mobilization รอบใหม่เท่านั้น */
  if (splitPriorAndNewCycleOnDoc) {
    const mobSegmentStart = resolveMobSegmentStartYmd(a);
    if (mobSegmentStart && startRaw < mobSegmentStart) {
      startRaw = mobSegmentStart;
    }
  }

  const mobLocEnd = ((a.mobLocationEndDate || '') as string).trim().slice(0, 10);
  const assignEnd = ((a.endDate || '') as string).trim().slice(0, 10);
  const endFromPo = msToYmdUtc(po.endDate);

  let cap = throughYmd;
  if (/^\d{4}-\d{2}-\d{2}$/.test(assignEnd)) {
    cap = minYmd(cap, assignEnd);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(mobLocEnd) && mobLocEnd >= startRaw) {
    cap = minYmd(cap, mobLocEnd);
  }
  /** remob: mobLocationEndDate เป็นของรอบเก่า — อย่าใช้เป็นฝาหลังวันเริ่มรอบใหม่ */
  if (splitPriorAndNewCycleOnDoc && cap < startRaw) {
    cap = minYmd(throughYmd, endFromPo);
    if (/^\d{4}-\d{2}-\d{2}$/.test(assignEnd)) {
      cap = minYmd(cap, assignEnd);
    }
  }
  cap = minYmd(cap, endFromPo);

  if (startRaw > cap) return null;
  return { start: startRaw, end: cap };
}

export function* eachYmdInRange(start: string, end: string): Generator<string> {
  let cur = start;
  while (cur <= end) {
    yield cur;
    cur = addDaysToYmd(cur, 1);
  }
}

export function normalHoursFromPoLine(line: POLine): number {
  const h = line.normalWorkHoursSnapshot;
  if (h === 12 || h === 8) return h;
  return 8;
}

export type PoActiveAutoDailyRowParams = {
  assignment: Assignment;
  po: PurchaseOrder;
  line: POLine;
  date: string;
  workerNameSnapshot: string;
  poActiveBundleId: string;
  laborCostContractTermId?: string;
};

/** Partial fields สำหรับสร้าง/อัปเดต daily_timesheets — event work_day */
export function buildPoActiveAutoDailyRowPayload(p: PoActiveAutoDailyRowParams): Partial<DailyTimesheet> {
  const { assignment: a, po, line, date, workerNameSnapshot, poActiveBundleId, laborCostContractTermId } = p;
  const contractId = (a.contractId || po.contractId || '').trim();
  const siteId = effectiveWaveIdForPoActiveAuto(a) || '';
  const nh = normalHoursFromPoLine(line);

  return {
    workerId: a.workerId,
    assignmentId: a.id,
    date,
    workerNameSnapshot,
    waveId: siteId,
    contractId,
    purchaseOrderId: po.id,
    poLineId: line.id,
    poActiveBundleId,
    customerId: po.customerId,
    siteId,
    positionId: a.positionId,
    workMode: resolveWorkModeForPoContext(po, a.workMode),
    eventType: 'work_day',
    shiftType: 'DAY',
    normalHours: nh,
    ot15Hours: 0,
    ot20Hours: 0,
    ot30Hours: 0,
    status: 'DRAFT',
    readyForPayroll: false,
    readyForBilling: false,
    sourceType: 'DIGITAL',
    poActiveAutoDaily: true,
    remark: 'Auto — PO Active workflow',
    ...(laborCostContractTermId ? { laborCostContractTermId } : {}),
  };
}

/** แถว SB อัตโนมัติช่วงหยุดแบบ standby — แก้มือได้เหมือนแถว auto อื่น */
export function buildPoActiveAutoStandbyRowPayload(p: PoActiveAutoDailyRowParams): Partial<DailyTimesheet> {
  const row = buildPoActiveAutoDailyRowPayload(p);
  return {
    ...row,
    eventType: 'standby_day',
    shiftType: 'STANDBY',
    remark: 'Auto — PO Active standby stop',
  };
}
