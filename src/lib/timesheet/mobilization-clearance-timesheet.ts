/**
 * เฟส 1 — เขียน daily_timesheets จาก Final clearance (Standby / เริ่มวันทำงาน)
 */

import { deleteDoc, doc, getDoc, type Firestore } from 'firebase/firestore';
import type {
  Assignment,
  DailyTimesheet,
  MobDayChargeSpec,
  POLine,
  PurchaseOrder,
  RateConditionEventType,
  User,
  WaveMonthTimesheetReviewStatus,
} from '@/lib/types';
import { TimesheetService } from '@/lib/services/timesheet-service';
import { poMonthTimesheetReviewDocId } from '@/lib/timesheet/po-month-timesheet-bridge';
import { resolvePoActiveBundleKeyForPo, resolveWorkModeForPoContext } from '@/lib/ops/po-active-bundle';
import { poTimesheetScopeId } from '@/lib/constants/timesheet-po-scope';
import { eachYmdInRange, normalHoursFromPoLine } from '@/lib/timesheet/po-active-auto-daily-build';
import { addDaysToYmd, shouldAutoFillPrefixWorkDaysBeforeStandby } from '@/lib/ops/mobilization-final-clearance';
import { buildTimesheetFieldsFromMobCharges } from '@/lib/ops/mob-day-charge';

const CLEARANCE_REMARK_SNIPPET = 'Final clearance';

const PO_MONTH_BLOCKS_EDIT: WaveMonthTimesheetReviewStatus[] = [
  'entry_locked',
  'pending_manager_review',
  'approved',
];

export async function isPoMonthTimesheetEditingBlocked(
  db: Firestore,
  poId: string,
  dateYmd: string,
): Promise<{ blocked: boolean; message?: string }> {
  const pid = (poId || '').trim();
  if (!pid || !/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) return { blocked: false };
  const ym = dateYmd.slice(0, 7);
  const ref = doc(db, 'po_month_timesheet_reviews', poMonthTimesheetReviewDocId(pid, ym));
  const snap = await getDoc(ref);
  if (!snap.exists()) return { blocked: false };
  const r = snap.data() as { status?: WaveMonthTimesheetReviewStatus; yearMonth?: string };
  const st = r.status;
  if (!st || !PO_MONTH_BLOCKS_EDIT.includes(st)) return { blocked: false };
  return {
    blocked: true,
    message: `งวด PO+เดือน ${r.yearMonth ?? ym} ถูกล็อกหรือส่งตรวจแล้ว — แก้ไขลงเวลาในงวดนี้ไม่ได้`,
  };
}

export type MobClearanceTimesheetKind = 'standby_day' | 'mobilization_day' | 'work_day';

function buildBasePayload(
  a: Assignment,
  po: PurchaseOrder,
  line: POLine,
  workerNameSnapshot: string,
  dateYmd: string,
  eventType: RateConditionEventType,
  normalHours: number,
  remarkOverride?: string,
): Partial<DailyTimesheet> {
  const contractId = (a.contractId || po.contractId || '').trim();
  const waveScope = (a.waveId || '').trim() || poTimesheetScopeId(po.id);
  const bundleId = (a.poActiveBundleId || '').trim() || resolvePoActiveBundleKeyForPo(po);
  const mobCycleId = (a.mobCycleId || '').trim() || undefined;
  const mobLocationKey = (a.mobLocationKey || '').trim() || undefined;

  return {
    workerId: a.workerId,
    assignmentId: a.id,
    date: dateYmd,
    workerNameSnapshot,
    waveId: waveScope,
    siteId: waveScope,
    contractId,
    purchaseOrderId: po.id,
    poLineId: line.id,
    poActiveBundleId: bundleId,
    customerId: po.customerId,
    positionId: a.positionId,
    workMode: resolveWorkModeForPoContext(po, a.workMode),
    eventType,
    shiftType: 'DAY',
    normalHours,
    ot15Hours: 0,
    ot20Hours: 0,
    ot30Hours: 0,
    status: 'DRAFT',
    readyForPayroll: false,
    readyForBilling: false,
    sourceType: 'DIGITAL',
    poActiveAutoDaily: false,
    remark:
      remarkOverride ??
      (eventType === 'standby_day'
        ? 'Mob — Final clearance · Standby'
        : eventType === 'mobilization_day'
          ? 'Mob — Final clearance · Mobilization'
          : 'Mob — Final clearance · เริ่มวันทำงาน'),
    ...(mobCycleId ? { mobCycleId } : {}),
    ...(mobLocationKey ? { mobLocationKey } : {}),
  };
}

/**
 * @throws Error เมื่องวดล็อก / ซ้ำประเภทวัน / แถวถูกปิดบัญชี
 */
export async function upsertMobClearanceDailyTimesheet(
  db: Firestore,
  user: User,
  args: {
    assignment: Assignment;
    po: PurchaseOrder;
    line: POLine;
    workerDisplayName: string;
    kind: MobClearanceTimesheetKind;
    dateYmd: string;
    /** หน้า Mobilization Final clearance — งวด PO+เดือนล็อกแล้วยังต้องบันทึกได้ */
    bypassPoMonthLock?: boolean;
    remarkOverride?: string;
    /** ค่าวางบิล / จ่ายลูกจ้าง สำหรับวัน Pre-Mob หรือ Mob */
    billingCharge?: MobDayChargeSpec;
    payrollCharge?: MobDayChargeSpec;
  },
): Promise<{ created: number; updated: number; skipped: number }> {
  const {
    assignment: a,
    po,
    line,
    workerDisplayName,
    kind,
    dateYmd,
    bypassPoMonthLock,
    remarkOverride,
    billingCharge,
    payrollCharge,
  } = args;

  if (!bypassPoMonthLock) {
    const gate = await isPoMonthTimesheetEditingBlocked(db, po.id, dateYmd);
    if (gate.blocked) {
      throw new Error(gate.message || 'งวด timesheet ราย PO+เดือนถูกปิดการแก้ไข');
    }
  }

  const service = new TimesheetService(db);
  const docId = service.getTimesheetId(a.workerId, a.id, dateYmd);
  const existingSnap = await getDoc(doc(db, 'daily_timesheets', docId));

  let eventType: RateConditionEventType =
    kind === 'standby_day'
      ? 'standby_day'
      : kind === 'mobilization_day'
        ? 'mobilization_day'
        : 'work_day';
  let normalHours = kind === 'work_day' ? normalHoursFromPoLine(line) : 0;
  let chargeFields: Partial<DailyTimesheet> = {};

  if (billingCharge && payrollCharge && kind !== 'work_day') {
    const built = buildTimesheetFieldsFromMobCharges(billingCharge, payrollCharge);
    eventType = built.eventType;
    normalHours = built.normalHours;
    const { eventType: _e, normalHours: _n, ...rest } = built;
    chargeFields = rest;
  }

  if (existingSnap.exists()) {
    const cur = { id: existingSnap.id, ...(existingSnap.data() as object) } as DailyTimesheet;
    if (service.isFinalized(cur.status)) {
      throw new Error('รายการวันนี้ถูกล็อกทางบัญชีแล้ว — แก้ไขไม่ได้จากหน้า Mob');
    }
    if (cur.assignmentId && cur.assignmentId !== a.id) {
      throw new Error('วันนี้มีรายการลงเวลากับการมอบหมายอื่นแล้ว — ตรวจใน timesheet');
    }
    if (cur.eventType && cur.eventType !== eventType) {
      throw new Error(
        `วันนี้มีรายการประเภท «${cur.eventType}» อยู่แล้ว — ไปแก้ใน timesheet แทนการบันทึกซ้ำจาก Mob`,
      );
    }
  }

  const payload = {
    ...buildBasePayload(
      a,
      po,
      line,
      workerDisplayName.trim() || 'Unknown',
      dateYmd,
      eventType,
      normalHours,
      remarkOverride,
    ),
    ...chargeFields,
  };

  return service.bulkUpsertTimesheets([payload], user);
}

/** ลบรายวันที่สร้างจาก Mob Final clearance (remark มีคำว่า Final clearance) เฉพาะ DRAFT / ยังแก้ได้ */
export async function deleteDraftMobFinalClearanceTimesheetsInRange(
  db: Firestore,
  workerId: string,
  assignmentId: string,
  startYmd: string,
  endYmd: string,
): Promise<number> {
  const wid = (workerId || '').trim();
  const aid = (assignmentId || '').trim();
  const s = startYmd.slice(0, 10);
  const e = endYmd.slice(0, 10);
  if (!wid || !aid || !/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e) || s > e) return 0;

  const service = new TimesheetService(db);
  let removed = 0;
  for (const d of eachYmdInRange(s, e)) {
    const docId = service.getTimesheetId(wid, aid, d);
    const ref = doc(db, 'daily_timesheets', docId);
    const snap = await getDoc(ref);
    if (!snap.exists()) continue;
    const cur = { id: snap.id, ...(snap.data() as object) } as DailyTimesheet;
    if (service.isFinalized(cur.status)) continue;
    const rmk = String(cur.remark ?? '');
    if (!rmk.includes(CLEARANCE_REMARK_SNIPPET)) continue;
    await deleteDoc(ref);
    removed++;
  }
  return removed;
}

/**
 * หลังบันทึกวัน Standby แล้ว — เติม:
 * - (ถ้าต่อจากเดือนก่อน / รอบ Mob > 1) วันทำงานต้นเดือนถึงก่อนวัน Standby
 * - วันระหว่างวัน Standby กับวันเริ่มงาน → standby_day
 * - วันเริ่มงาน → work_day
 */
export async function applyMobFinalClearanceWorkStartFill(
  db: Firestore,
  user: User,
  args: {
    assignment: Assignment;
    po: PurchaseOrder;
    line: POLine;
    workerDisplayName: string;
    standbyYmd: string;
    workYmd: string;
  },
): Promise<void> {
  const { assignment: a, po, line, workerDisplayName, standbyYmd, workYmd } = args;
  const st = standbyYmd.trim().slice(0, 10);
  const wk = workYmd.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(st) || !/^\d{4}-\d{2}-\d{2}$/.test(wk)) {
    throw new Error('รูปแบบวันที่ไม่ถูกต้อง');
  }
  if (wk <= st) {
    throw new Error('วันเริ่มทำงานต้องอยู่หลังวัน Standby (ไม่สามารถเลือกวันเดียวกันหรือก่อนหน้าได้)');
  }

  const bypass = true;
  const ym = st.slice(0, 7);
  const monthStart = `${ym}-01`;
  const dayBeforeStandby = addDaysToYmd(st, -1);

  if (shouldAutoFillPrefixWorkDaysBeforeStandby(a, st) && monthStart <= dayBeforeStandby) {
    for (const d of eachYmdInRange(monthStart, dayBeforeStandby)) {
      await upsertMobClearanceDailyTimesheet(db, user, {
        assignment: a,
        po,
        line,
        workerDisplayName,
        kind: 'work_day',
        dateYmd: d,
        bypassPoMonthLock: bypass,
        remarkOverride: 'Mob — Final clearance · ต่อเนื่องต้นเดือน (ก่อน Standby)',
      });
    }
  }

  const gapStart = addDaysToYmd(st, 1);
  const gapEnd = addDaysToYmd(wk, -1);
  if (gapStart <= gapEnd) {
    for (const d of eachYmdInRange(gapStart, gapEnd)) {
      await upsertMobClearanceDailyTimesheet(db, user, {
        assignment: a,
        po,
        line,
        workerDisplayName,
        kind: 'standby_day',
        dateYmd: d,
        bypassPoMonthLock: bypass,
      });
    }
  }

  await upsertMobClearanceDailyTimesheet(db, user, {
    assignment: a,
    po,
    line,
    workerDisplayName,
    kind: 'work_day',
    dateYmd: wk,
    bypassPoMonthLock: bypass,
  });
}
