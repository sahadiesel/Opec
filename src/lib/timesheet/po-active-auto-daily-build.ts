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

/**
 * ช่วงสร้างรายวัน: เริ่ม mobWorkingStartDate (หรือ startDate) ถึง min(เมื่อวาน Bangkok, จบงาน, endDate assignment, PO end)
 * — เที่ยงคืนของวันใหม่แล้วให้ลงเวลาวันก่อนหน้าได้ครบ (ไม่ปิดวันปัจจุบันแบบอัตโนมัติ)
 */
export function computePoActiveAutoDailyRange(
  a: Assignment,
  po: Pick<PurchaseOrder, 'startDate' | 'endDate'>,
): { start: string; end: string } | null {
  const today = thailandTodayYmd();
  const throughYmd = addDaysToYmd(today, -1);
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
