import type { Assignment, DailyTimesheet, POLine, PurchaseOrder } from '@/lib/types';
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

/** ACTIVE + ยังไม่ Unassign + มีข้อมูลผูก PO */
export function isAssignmentEligibleForPoActiveAutoDaily(a: Assignment): boolean {
  if (a.deploymentStatus !== 'ACTIVE') return false;
  if (typeof a.unassignedAt === 'number' && a.unassignedAt > 0) return false;
  return !!(a.poId?.trim() && a.poLineId?.trim() && a.workerId?.trim() && a.waveId?.trim());
}

/** จำนวนวันที่ระบบเติม SB อัตโนมัติเมื่อหยุดแบบ standby (รวมวันเริ่ม) */
export const PO_ACTIVE_STANDBY_STOP_AUTO_DAYS = 7;

/**
 * ว่าจะซิงก์ PO Active auto สำหรับวันนี้เป็น work / standby / ไม่ซิงก์
 * — null = ไม่สร้างหรือไม่อัปเดตแถวอัตโนมัติสำหรับวันนั้น (ช่วงหลังจบ SB หรือข้อมูลระงับไม่ครบ)
 */
export function resolvePoActiveAutoDailySyncKind(a: Assignment, dateYmd: string): 'work_day' | 'standby_day' | null {
  if (!isAssignmentEligibleForPoActiveAutoDaily(a)) return null;
  const suspended = a.poActiveAutoWorkSuspended === true;
  const sbStart = (a.poActiveStandbyAutoStartYmd || '').trim().slice(0, 10);
  const sbEnd = (a.poActiveStandbyAutoEndYmd || '').trim().slice(0, 10);
  const hasSeg = /^\d{4}-\d{2}-\d{2}$/.test(sbStart) && /^\d{4}-\d{2}-\d{2}$/.test(sbEnd);
  if (suspended) {
    if (!hasSeg) return null;
    if (dateYmd >= sbStart && dateYmd <= sbEnd) return 'standby_day';
    if (dateYmd > sbEnd) return null;
  }
  return 'work_day';
}

/**
 * ช่วงสร้างรายวัน: เริ่ม mobWorkingStartDate (หรือ startDate) ถึง min(วันนี้ Bangkok, จบงาน, endDate assignment, PO end)
 * — เมื่อเริ่มวันปฏิทินใหม่ที่ไทย (หลัง 00:00) ให้ซิงก์รายวันได้ถึงวันนี้ทันที (working day อัตโนมัติ)
 */
export function computePoActiveAutoDailyRange(
  a: Assignment,
  po: Pick<PurchaseOrder, 'startDate' | 'endDate'>,
): { start: string; end: string } | null {
  const today = thailandTodayYmd();
  const throughYmd = today;
  const startRaw = ((a.mobWorkingStartDate || a.startDate || '') as string).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startRaw)) return null;

  const endFromMob = ((a.mobLocationEndDate || a.endDate || '') as string).trim();
  const endFromPo = msToYmdUtc(po.endDate);
  let cap = throughYmd;
  if (/^\d{4}-\d{2}-\d{2}$/.test(endFromMob)) {
    cap = minYmd(cap, endFromMob);
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
  const siteId = (a.waveId || '').trim();
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
    workMode: a.workMode,
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
