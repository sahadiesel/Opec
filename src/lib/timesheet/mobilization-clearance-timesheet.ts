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
import { addDaysToYmd, shouldAutoFillPrefixWorkDaysBeforeStandby, thailandTodayYmd } from '@/lib/ops/mobilization-final-clearance';
import { buildTimesheetFieldsFromMobCharges } from '@/lib/ops/mob-day-charge';
import { resolvePriorCycleWorkStartFloorYmd } from '@/lib/constants/timesheet-ui';

const CLEARANCE_REMARK_SNIPPET = 'Final clearance';
/** แถวที่เติมอัตโนมัติต้นเดือนก่อน Standby — ใช้ระบุเพื่อลบเมื่อสร้างผิดช่วง */
export const PREFIX_CONTINUITY_WORK_DAY_REMARK =
  'Mob — Final clearance · ต่อเนื่องต้นเดือน (ก่อน Standby)';

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
    /**
     * ถ้ามีแถว DRAFT อยู่แล้ว — ข้ามไม่เขียนทับ (ใช้ตอนเติมต้นเดือนที่ไม่ควรทับ SB/W ที่มีอยู่)
     */
    skipIfExists?: boolean;
    /**
     * ถ้ามีแถว DRAFT ประเภทอื่น — เขียนทับเป็นประเภทที่ Mob ต้องการ
     * (เช่น วันเริ่มงานทับ standby อัตโนมัติที่ค้าง / เติมช่องว่างเป็น SB)
     */
    overwriteConflictingEventType?: boolean;
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
    skipIfExists,
    overwriteConflictingEventType,
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
    const packageHours = normalHoursFromPoLine(line) === 12 ? 12 : 8;
    const built = buildTimesheetFieldsFromMobCharges(billingCharge, payrollCharge, packageHours);
    eventType = built.eventType;
    normalHours = built.normalHours;
    const { eventType: _e, normalHours: _n, ...rest } = built;
    chargeFields = rest;
  } else if (kind === 'work_day') {
    /** ทับ charge ค้างจาก standby/auto — กันจ่ายยังคิดเป็น STANDBY ทั้งที่ event เป็น work_day */
    const packageHours = normalHoursFromPoLine(line) === 12 ? 12 : 8;
    const hours = normalHours || packageHours;
    const built = buildTimesheetFieldsFromMobCharges(
      { kind: 'WORKING', hours },
      { kind: 'WORKING', hours },
      packageHours,
    );
    eventType = built.eventType;
    normalHours = built.normalHours;
    const { eventType: _e, normalHours: _n, ...rest } = built;
    chargeFields = rest;
  } else if (kind === 'mobilization_day' && (!billingCharge || !payrollCharge)) {
    /** ไม่มี charge แยก — ใช้ชม.แพ็กจาก PO line (OFF 12 / ON 8) ไม่เขียน 0 */
    normalHours = normalHoursFromPoLine(line);
  }

  if (existingSnap.exists()) {
    const cur = { id: existingSnap.id, ...(existingSnap.data() as object) } as DailyTimesheet;
    if (skipIfExists) {
      return { created: 0, updated: 0, skipped: 1 };
    }
    if (service.isFinalized(cur.status)) {
      throw new Error('รายการวันนี้ถูกล็อกทางบัญชีแล้ว — แก้ไขไม่ได้จากหน้า Mob');
    }
    if (cur.assignmentId && cur.assignmentId !== a.id) {
      throw new Error('วันนี้มีรายการลงเวลากับการมอบหมายอื่นแล้ว — ตรวจใน timesheet');
    }
    if (cur.eventType && cur.eventType !== eventType && !overwriteConflictingEventType) {
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
 * ลบ W ร่างที่เติม «ต่อเนื่องต้นเดือน» ผิดช่วง — เฉพาะรอบแรก (carry-over)
 * remob: ไม่ลบอะไรเลย — เริ่มรอบใหม่จากวัน Mob เท่านั้น ไม่ยุ่งตารางเดิม
 */
export async function purgeStalePrefixContinuityWorkDaysForMonth(
  db: Firestore,
  assignment: Assignment,
  monthYm: string,
): Promise<number> {
  const wid = (assignment.workerId || '').trim();
  const aid = (assignment.id || '').trim();
  const ym = monthYm.trim().slice(0, 7);
  if (!wid || !aid || !/^\d{4}-\d{2}$/.test(ym)) return 0;

  const monthStart = `${ym}-01`;
  const monthEnd = (() => {
    const [y, m] = ym.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${ym}-${String(last).padStart(2, '0')}`;
  })();

  const standbyYmd = (assignment.mobStandbyDate || '').trim().slice(0, 10);
  const shouldFill =
    /^\d{4}-\d{2}-\d{2}$/.test(standbyYmd) &&
    shouldAutoFillPrefixWorkDaysBeforeStandby(assignment, standbyYmd);

  /** remob / ไม่ควร fill prefix — ห้ามลบตารางที่มีอยู่แล้ว */
  if (!shouldFill) return 0;

  const priorFloor = resolvePriorCycleWorkStartFloorYmd(assignment);
  /** รอบแรก carry-over: ลบ W ต่อเนื่องต้นเดือนที่อยู่ก่อนวันเริ่มงานรอบก่อน (ถ้ามี) */
  let deleteBeforeExclusive: string | undefined;
  if (priorFloor && priorFloor.slice(0, 7) === ym) {
    deleteBeforeExclusive = priorFloor;
  }
  if (!deleteBeforeExclusive) return 0;

  const service = new TimesheetService(db);
  let removed = 0;
  const through = deleteBeforeExclusive > monthEnd ? monthEnd : addDaysToYmd(deleteBeforeExclusive, -1);
  if (monthStart > through) return 0;

  for (const d of eachYmdInRange(monthStart, through)) {
    if (d >= deleteBeforeExclusive) continue;
    const docId = service.getTimesheetId(wid, aid, d);
    const ref = doc(db, 'daily_timesheets', docId);
    const snap = await getDoc(ref);
    if (!snap.exists()) continue;
    const cur = { id: snap.id, ...(snap.data() as object) } as DailyTimesheet;
    if (service.isFinalized(cur.status)) continue;
    if (cur.eventType !== 'work_day') continue;
    const rmk = String(cur.remark ?? '');
    const isPrefix =
      rmk.includes('ต่อเนื่องต้นเดือน') || rmk.includes(PREFIX_CONTINUITY_WORK_DAY_REMARK);
    if (!isPrefix) continue;
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

  /**
   * remob ไม่ลบตารางเดิม — ฟังก์ชันนี้ no-op เมื่อไม่ควร fill prefix
   * (เก็บเรียกไว้เผื่อรอบแรก carry-over ที่มี priorFloor)
   */
  await purgeStalePrefixContinuityWorkDaysForMonth(db, a, st.slice(0, 7));

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
        /** อย่าทับ SB/W ที่มีอยู่แล้วในเดือน (เช่น หยุดแบบ standby ก่อน remob) */
        skipIfExists: true,
        remarkOverride: PREFIX_CONTINUITY_WORK_DAY_REMARK,
      });
    }
  }

  const gapStart = addDaysToYmd(st, 1);
  const gapEnd = addDaysToYmd(wk, -1);
  const today = thailandTodayYmd();
  if (gapStart <= gapEnd) {
    for (const d of eachYmdInRange(gapStart, gapEnd)) {
      /** อนาคตให้ auto เติมเมื่อถึงวัน — ไม่สร้าง SB/W ล่วงหน้า */
      if (d > today) continue;
      await upsertMobClearanceDailyTimesheet(db, user, {
        assignment: a,
        po,
        line,
        workerDisplayName,
        kind: 'standby_day',
        dateYmd: d,
        bypassPoMonthLock: bypass,
        /** ช่องว่างก่อนเริ่มงาน — ทับ auto work_day ที่ค้างได้ */
        overwriteConflictingEventType: true,
      });
    }
  }

  /**
   * วันเริ่มงาน = work_day
   * ถ้าเลือกวันในอนาคต (เช่น Mob วันนี้ → เริ่มพรุ่งนี้) ยังไม่ลง W ตอนนี้
   * — รอ PO Active auto เมื่อถึงวันนั้น (หลัง ACTIVE)
   */
  if (wk <= today) {
    await upsertMobClearanceDailyTimesheet(db, user, {
      assignment: a,
      po,
      line,
      workerDisplayName,
      kind: 'work_day',
      dateYmd: wk,
      bypassPoMonthLock: bypass,
      /** วันเริ่มงาน — ทับ standby/auto ที่ค้างบนวันนั้นได้ */
      overwriteConflictingEventType: true,
    });
  }
}
