import type { Assignment, POLine, PositionRate, Wave } from '@/lib/types';
import { WAVE_TIMESHEET_DEPLOYMENT_STATUSES } from '@/lib/constants/timesheet-wave';
import { timestampToHtmlDateValue } from '@/lib/date-thai';

/** ชั่วโมงทำงานต่อวันตามมาตรฐานสัญญาที่ใช้ใน Wave Board (ลงเวลาเท่านั้น — OT คิดแยกใน payroll / billing) */
export const DEFAULT_CONTRACT_DAILY_HOURS = 12;

/**
 * ดึงชั่วโมงปกติต่อวันจากบรรทัด PO (สแนปจากสัญญา) แล้วค่อยจากอัตราตามสัญญา (position_rates)
 * ลำดับ: Wave.poLineId → PO line อื่นที่มี snapshot → position_rates ที่ active
 */
export function resolveContractDailyHoursForWaveBoard(
  wave: Wave | undefined,
  poLines: POLine[] | undefined,
  positionRates: PositionRate[] | undefined,
): number {
  const fallback = DEFAULT_CONTRACT_DAILY_HOURS;

  const fromLineSnapshot = (line: POLine | undefined): number | undefined => {
    const h = line?.normalWorkHoursSnapshot;
    return h === 8 || h === 12 ? h : undefined;
  };

  const fromRate = (r: PositionRate | undefined): number | undefined => {
    const h = r?.normalWorkHours;
    return h === 8 || h === 12 ? h : undefined;
  };

  if (wave?.poLineId) {
    const match = poLines?.find((l) => l.id === wave.poLineId);
    const h = fromLineSnapshot(match);
    if (h != null) return h;
  }

  for (const line of poLines ?? []) {
    const h = fromLineSnapshot(line);
    if (h != null) return h;
  }

  for (const r of positionRates ?? []) {
    if (r.active === false) continue;
    const h = fromRate(r);
    if (h != null) return h;
  }

  return fallback;
}

/** ชั่วโมงปกติต่อวันจากบรรทัด PO ของ assignment (ไม่ผูก Wave) */
export function resolveContractDailyHoursForAssignmentLine(
  poLineId: string | undefined,
  poLines: POLine[] | undefined,
  positionRates: PositionRate[] | undefined,
): number {
  const fallback = DEFAULT_CONTRACT_DAILY_HOURS;

  const fromLineSnapshot = (line: POLine | undefined): number | undefined => {
    const h = line?.normalWorkHoursSnapshot;
    return h === 8 || h === 12 ? h : undefined;
  };

  const fromRate = (r: PositionRate | undefined): number | undefined => {
    const h = r?.normalWorkHours;
    return h === 8 || h === 12 ? h : undefined;
  };

  if (poLineId) {
    const match = poLines?.find((l) => l.id === poLineId);
    const h = fromLineSnapshot(match);
    if (h != null) return h;
  }

  for (const line of poLines ?? []) {
    const h = fromLineSnapshot(line);
    if (h != null) return h;
  }

  for (const r of positionRates ?? []) {
    if (r.active === false) continue;
    const h = fromRate(r);
    if (h != null) return h;
  }

  return fallback;
}

/**
 * รอบเดือนของ Wave จากช่วง startDate–endDate (เช่น Feb หรือ Feb–Mar)
 * ใช้บนศูนย์ลงเวลาและ dropdown Wave Board
 */
export function waveRoundMonthLabel(w: Wave): string {
  const s = (w.startDate || '').slice(0, 10);
  const e = (w.endDate || '').slice(0, 10);
  if (!s) return '—';
  const start = new Date(`${s}T12:00:00`);
  const end = e ? new Date(`${e}T12:00:00`) : start;
  const opt: Intl.DateTimeFormatOptions = { month: 'short' };
  const sm = start.toLocaleDateString('en-US', opt);
  const em = end.toLocaleDateString('en-US', opt);
  if (sm === em) return sm;
  return `${sm}–${em}`;
}

/**
 * ตรงกับ Wave Board / สรุปเดือน: deployment อยู่ในชุดที่ลงเวลาได้ และ
 * - ขั้น operational หลังเริ่มส่งตัว (พร้อมเดินทาง / กำลังเดินทาง / ปฏิบัติงาน) → แสดงได้แม้ readiness ใน DB ยังไม่เป็น ready (กันฟิลด์ไม่ sync แล้วหายจากกระดาน)
 * - CONFIRMED → ยังเช็ค readiness เว้นแต่มี milestone mobilization จริงบนเอกสาร (วัน SB/working / เคยกดพร้อมเดินทาง)
 */
export function assignmentReadyForWaveTimesheet(
  a: Pick<
    Assignment,
    | 'readinessStatus'
    | 'deploymentStatus'
    | 'mobStandbyDate'
    | 'mobWorkingStartDate'
    | 'mobReadyToTravelAt'
  >,
): boolean {
  if (!WAVE_TIMESHEET_DEPLOYMENT_STATUSES.includes(a.deploymentStatus)) return false;
  if (
    a.deploymentStatus === 'READY_TO_MOB' ||
    a.deploymentStatus === 'MOBILIZING' ||
    a.deploymentStatus === 'ACTIVE'
  ) {
    return true;
  }
  const sb = (a.mobStandbyDate || '').trim().slice(0, 10);
  const ws = (a.mobWorkingStartDate || '').trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(sb) || /^\d{4}-\d{2}-\d{2}$/.test(ws)) return true;
  if (typeof a.mobReadyToTravelAt === 'number' && a.mobReadyToTravelAt > 0) return true;
  return (a.readinessStatus ?? 'incomplete') === 'ready';
}

/**
 * รอ Mob ครั้งแรกหลัง assign — ยังไม่ขึ้นกระดานลงเวลา (ยังไม่มีวันจบไซต์รอบก่อน)
 */
export function isAssignmentDraftAwaitingFirstMobOnly(
  a: Pick<Assignment, 'deploymentStatus' | 'mobCycleNumber' | 'mobLocationEndDate' | 'unassignedAt'>,
): boolean {
  if (typeof a.unassignedAt === 'number' && a.unassignedAt > 0) return false;
  if (a.deploymentStatus !== 'DRAFT') return false;
  const cycle =
    typeof a.mobCycleNumber === 'number' && Number.isFinite(a.mobCycleNumber) ? a.mobCycleNumber : 1;
  const ended = !!(a.mobLocationEndDate && String(a.mobLocationEndDate).trim());
  return cycle <= 1 && !ended;
}

/**
 * ถอนมอบหมายแล้วแต่ยังไม่เคยขึ้นไซต์ — ไม่มีประวัติลงเวลาให้แสดง (คนละเรื่องกับถอนหลังทำงานแล้ว)
 */
export function assignmentUnassignedNeverHadSiteWork(
  a: Pick<Assignment, 'unassignedAt' | 'deploymentStatus' | 'mobCycleNumber' | 'mobLocationEndDate'>,
): boolean {
  if (!(typeof a.unassignedAt === 'number' && a.unassignedAt > 0)) return false;
  if (a.deploymentStatus !== 'DRAFT') return false;
  const cycle =
    typeof a.mobCycleNumber === 'number' && Number.isFinite(a.mobCycleNumber) ? a.mobCycleNumber : 1;
  const ended = !!(a.mobLocationEndDate && String(a.mobLocationEndDate).trim());
  return cycle <= 1 && !ended;
}

/**
 * กระดาน PO รายวัน — ซ่อนแถวตั้งแต่วันที่ถอนมอบหมายเป็นต้นไป (สรุปรายเดือนยังเห็นประวัติเดือนก่อน)
 */
export function assignmentExcludedFromPoDailyBoardOnDate(
  a: Pick<Assignment, 'unassignedAt'>,
  htmlDate: string,
): boolean {
  if (!(typeof a.unassignedAt === 'number' && a.unassignedAt > 0)) return false;
  const unassignYmd = timestampToHtmlDateValue(a.unassignedAt).slice(0, 10);
  const d = htmlDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(unassignYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return d >= unassignYmd;
}

/**
 * แสดงบน Wave Board / สรุปเดือน — รวมคนที่กดจบงานแล้ว (กลับ DRAFT) เพื่อเห็นประวัติลงเวลาสิ้นเดือน
 * ถอนมอบหมายแล้วยังแสดงได้ถ้าเคยมีช่วงลงเวลา (ไม่ซ่อนประวัติเดือนเก่า)
 */
export function assignmentIncludedInWaveTimesheetRoster(
  a: Pick<
    Assignment,
    'deploymentStatus' | 'readinessStatus' | 'mobCycleNumber' | 'mobLocationEndDate' | 'unassignedAt'
  >,
): boolean {
  if (assignmentUnassignedNeverHadSiteWork(a)) return false;
  if (isAssignmentDraftAwaitingFirstMobOnly(a)) return false;
  if (a.deploymentStatus === 'DRAFT') return true;
  /** ถอนกำลังแล้วแต่ยังต้องเห็นประวัติลงเวลาในเดือนที่ทับช่วงมอบหมาย */
  if (a.deploymentStatus === 'DEMOBILIZED') return true;
  /** Unassign / ปิดรายการ — ระบบเขียน CLOSED + unassignedAt; ต้องยังเห็นเดือนเก่าบนสรุปรายเดือน */
  if (a.deploymentStatus === 'CLOSED') return true;
  return assignmentReadyForWaveTimesheet(a);
}

/** วันลงเวลา (yyyy-MM-dd) อยู่หลังวันจบไซต์ที่ยืนยันแล้ว — ไม่สร้างช่องอัตโนมัติ / ล็อกแก้ไข */
export function isHtmlDateAfterMobLocationEnd(
  a: Pick<Assignment, 'mobLocationEndDate'>,
  htmlDate: string,
): boolean {
  const end = (a.mobLocationEndDate || '').trim().slice(0, 10);
  const d = htmlDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end) || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return d > end;
}

/**
 * วันนี้ควรแสดง/รวมในตารางสรุปรายเดือน (และชม.ทำงาน) หรือไม่ — อิง mobilization จริงบนไซต์
 * - ขอบล่างปกติ = วันแรกของช่วง mobilization บนไซต์ = min(วัน Standby, วันเริ่มทำงาน) เทียบ PO Active — ไม่ใช้แค่วันเริ่มทำงาน
 *   (กันวัน SB ก่อนเริ่มงานถูกตัดจนช่องว่าง)
 * - หลังจบรอบแล้วเริ่มรอบใหม่ (mobWorkingStartDate เป็นเดือนถัดไป) ไม่ใช้วันเริ่มรอบใหม่ไปตัดเดือนเก่า —
 *   ใช้ช่วงมอบหมายเป็นขอบล่างสำหรับวันที่อยู่ก่อนรอบใหม่ (เดือนปฏิทินต่างจากเดือนของ mobWorkingStartDate
 *   หรือวัน ≤ mobLocationEndDate เมื่อจบรอบก่อนก่อนวันเริ่มรอบใหม่)
 * - ถ้าไม่มีวันเริ่มที่ parse ได้ — ไม่บังคับขอบล่าง
 * - เพดาน = min(mobLocationEndDate, endDate) เมื่อมี — ตั้งแต่วันถอนมอบหมาย (unassignedAt)
 */
export function isYmdWithinAssignmentMobTimesheetWindow(
  a: Pick<
    Assignment,
    | 'mobStandbyDate'
    | 'mobWorkingStartDate'
    | 'startDate'
    | 'assignedDate'
    | 'mobLocationEndDate'
    | 'endDate'
    | 'unassignedAt'
  >,
  ymd: string,
): boolean {
  const d = ymd.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;

  if (typeof a.unassignedAt === 'number' && a.unassignedAt > 0) {
    const uy = timestampToHtmlDateValue(a.unassignedAt).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(uy) && d >= uy) return false;
  }

  const mobStandby = (a.mobStandbyDate || '').trim().slice(0, 10);
  const mobStart = (a.mobWorkingStartDate || '').trim().slice(0, 10);
  const mobEnd = (a.mobLocationEndDate || '').trim().slice(0, 10);
  const assignStart = (a.startDate || '').trim().slice(0, 10);
  const assignEnd = (a.endDate || '').trim().slice(0, 10);
  const assignedFallback = (a.assignedDate || '').trim().slice(0, 10);
  const hasStandby = /^\d{4}-\d{2}-\d{2}$/.test(mobStandby);
  const hasMobStart = /^\d{4}-\d{2}-\d{2}$/.test(mobStart);
  const hasMobEnd = /^\d{4}-\d{2}-\d{2}$/.test(mobEnd);
  const hasAssignEnd = /^\d{4}-\d{2}-\d{2}$/.test(assignEnd);

  /** วันแรกของช่วง mobilization (Standby / เริ่มงาน) — Standby มักก่อนวันเริ่มทำงาน */
  let mobSegmentStart: string | undefined;
  if (hasStandby && hasMobStart) mobSegmentStart = mobStandby <= mobStart ? mobStandby : mobStart;
  else if (hasStandby) mobSegmentStart = mobStandby;
  else if (hasMobStart) mobSegmentStart = mobStart;

  const segmentForMonthCompare = mobSegmentStart ?? mobStart;

  /** วันนี้อยู่ในรอบที่ปิดแล้ว (ก่อนเริ่มรอบใหม่ที่สะสมใน mobilization เดียวกัน) */
  const inClosedPriorCycle =
    hasMobEnd && hasMobStart && mobEnd < mobStart && d <= mobEnd;
  /** เดือนปฏิทินต่างจากเดือนของวันแรกช่วง mobilization — ใช้ขอบจากมอบหมาย ไม่ใช่แค่วันเริ่มงานรอบใหม่ */
  const inEarlierCalendarMonthThanMobSegment =
    !!segmentForMonthCompare &&
    d < segmentForMonthCompare &&
    d.slice(0, 7) !== segmentForMonthCompare.slice(0, 7);

  let floor: string | undefined;
  if (inClosedPriorCycle || inEarlierCalendarMonthThanMobSegment) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(assignStart)) floor = assignStart;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(assignedFallback)) floor = assignedFallback;
  } else if (mobSegmentStart) {
    /**
     * มีวันเริ่มทำงานแต่ยังไม่มี mobStandbyDate ในเอกสาร — ช่วงก่อนวันเริ่มงานมักเป็น SB จาก clearance
     * ถ้าใช้แค่ mobWorkingStartDate เป็นขอบล่าง ทุกวันก่อนหน้านั้นถูกตัดจนตารางว่างทั้งที่มี daily_timesheets
     */
    const inGapBeforeWorkWithoutStandbyField =
      hasMobStart &&
      !hasStandby &&
      /^\d{4}-\d{2}-\d{2}$/.test(assignStart) &&
      d >= assignStart &&
      d < mobStart;
    if (inGapBeforeWorkWithoutStandbyField) {
      floor = assignStart;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(assignStart)) {
      floor = assignStart >= mobSegmentStart ? assignStart : mobSegmentStart;
    } else {
      floor = mobSegmentStart;
    }
  }
  if (floor === undefined) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(assignStart)) floor = assignStart;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(assignedFallback)) floor = assignedFallback;
  }

  if (floor !== undefined && d < floor) return false;

  /**
   * เอกสาร mobilization เดียวที่เก็บทั้งจบไซต์รอบเก่า (mobEnd) กับเริ่มรอบใหม่ (mobStart) — mobEnd < mobStart
   * - วัน ≤ mobEnd = ช่วงรอบเก่า → เพดานตาม mobEnd / endDate มอบหมาย
   * - วัน > mobEnd = ช่วงหลังจบรอบเก่า (รวมวัน Standby ก่อนเริ่มงานรอบใหม่ และวันทำงานรอบใหม่)
   *   ห้ามใช้ mobLocationEndDate รอบเก่าเป็นเพดาน — ไม่เช่นนั้นทุกวันหลังสิ้นเดือนเก่าถูกตัดจนหาย SB/W
   */
  const splitPriorAndNewCycleOnDoc = hasMobEnd && hasMobStart && mobEnd < mobStart;

  let ceil: string | undefined;
  if (splitPriorAndNewCycleOnDoc && d <= mobEnd) {
    if (hasMobEnd && hasAssignEnd) ceil = mobEnd <= assignEnd ? mobEnd : assignEnd;
    else if (hasMobEnd) ceil = mobEnd;
    else if (hasAssignEnd) ceil = assignEnd;
  } else if (splitPriorAndNewCycleOnDoc && d > mobEnd) {
    if (hasAssignEnd) ceil = assignEnd;
  } else if (hasMobEnd && hasAssignEnd) {
    ceil = mobEnd <= assignEnd ? mobEnd : assignEnd;
  } else if (hasMobEnd) {
    ceil = mobEnd;
  } else if (hasAssignEnd) {
    ceil = assignEnd;
  }
  if (ceil !== undefined && d > ceil) return false;

  return true;
}
