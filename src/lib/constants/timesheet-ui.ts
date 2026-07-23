import type { Assignment, DailyTimesheet, DeploymentStatus, POLine, PositionRate, Wave } from '@/lib/types';
import { WAVE_TIMESHEET_DEPLOYMENT_STATUSES } from '@/lib/constants/timesheet-wave';
import { timestampToHtmlDateValue } from '@/lib/date-thai';
import { addDaysToYmd } from '@/lib/ops/mobilization-final-clearance';
import { assignmentHasUnassignedAtSet, assignmentReleasedFromPoLineQuota, resolveAssignmentUnassignYmd } from '@/lib/ops/po-fulfillment-read-model';

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
  if (assignmentHasUnassignedAtSet(a)) return false;
  if (a.deploymentStatus !== 'DRAFT') return false;
  const cycle =
    typeof a.mobCycleNumber === 'number' && Number.isFinite(a.mobCycleNumber) ? a.mobCycleNumber : 1;
  const ended = !!(a.mobLocationEndDate && String(a.mobLocationEndDate).trim());
  return cycle <= 1 && !ended;
}

/** DRAFT หลังจบงานรอ Mob รอบใหม่ — ยังต้องเห็น/แก้ประวัติลงเวลาก่อนวันจบไซต์ (ยังไม่ทำบิล) */
export function assignmentAwaitingRemobAfterSiteFinish(
  a: Pick<Assignment, 'deploymentStatus' | 'mobLocationEndDate' | 'mobCycleNumber' | 'unassignedAt'>,
): boolean {
  if (assignmentHasUnassignedAtSet(a)) return false;
  if (a.deploymentStatus !== 'DRAFT') return false;
  if (!(a.mobLocationEndDate || '').trim()) return false;
  return !isAssignmentDraftAwaitingFirstMobOnly(a);
}

/** ใช้ใน fallback ของ assignmentOverlapsYearMonthForPoDailyBoard — DRAFT หลังจบงานยังทับเดือนเก่าได้ */
export function assignmentPassesPoMonthOverlapFallbackGate(
  a: Pick<
    Assignment,
    | 'deploymentStatus'
    | 'readinessStatus'
    | 'mobCycleNumber'
    | 'mobLocationEndDate'
    | 'unassignedAt'
    | 'mobStandbyDate'
    | 'mobWorkingStartDate'
    | 'mobReadyToTravelAt'
  >,
): boolean {
  if (assignmentReadyForWaveTimesheet(a)) return true;
  if (assignmentAwaitingRemobAfterSiteFinish(a)) return true;
  return false;
}

/**
 * ยังไม่เคยผ่านขั้น mobilization บนไซต์ (Standby / เริ่มงาน / จบไซต์ / พร้อมเดินทาง)
 * — ใช้กรองคนที่ Unassign ก่อน mob ออกจากตารางสรุปรายเดือน
 */
export function assignmentNeverHadMobilizationSiteWork(
  a: Pick<
    Assignment,
    | 'mobStandbyDate'
    | 'mobWorkingStartDate'
    | 'mobLocationEndDate'
    | 'mobReadyToTravelAt'
    | 'mobStandbyRecordedAt'
    | 'mobWorkingStartedAt'
    | 'deploymentStatus'
  >,
): boolean {
  const sb = (a.mobStandbyDate || '').trim().slice(0, 10);
  const ws = (a.mobWorkingStartDate || '').trim().slice(0, 10);
  const end = (a.mobLocationEndDate || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(sb)) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(ws)) return false;
  if (end.length > 0) return false;
  if (typeof a.mobReadyToTravelAt === 'number' && a.mobReadyToTravelAt > 0) return false;
  if (typeof a.mobStandbyRecordedAt === 'number' && a.mobStandbyRecordedAt > 0) return false;
  if (typeof a.mobWorkingStartedAt === 'number' && a.mobWorkingStartedAt > 0) return false;
  const ds = a.deploymentStatus;
  if (ds === 'MOBILIZING' || ds === 'ACTIVE' || ds === 'READY_TO_MOB') return false;
  return true;
}

/**
 * ถอนมอบหมายแล้วแต่ยังไม่เคยขึ้นไซต์ — ไม่มีประวัติลงเวลาให้แสดง (คนละเรื่องกับถอนหลังทำงานแล้ว)
 * Unassign จาก Mobilization ตั้ง deploymentStatus = CLOSED + unassignedAt
 */
export function assignmentUnassignedNeverHadSiteWork(
  a: Pick<
    Assignment,
    | 'unassignedAt'
    | 'deploymentStatus'
    | 'mobCycleNumber'
    | 'mobLocationEndDate'
    | 'mobStandbyDate'
    | 'mobWorkingStartDate'
    | 'mobReadyToTravelAt'
    | 'mobStandbyRecordedAt'
    | 'mobWorkingStartedAt'
  >,
): boolean {
  if (!assignmentHasUnassignedAtSet(a)) return false;
  const ds = a.deploymentStatus;
  if (ds !== 'DRAFT' && ds !== 'CLOSED') return false;
  if (!assignmentNeverHadMobilizationSiteWork(a)) return false;
  const cycle =
    typeof a.mobCycleNumber === 'number' && Number.isFinite(a.mobCycleNumber) ? a.mobCycleNumber : 1;
  return cycle <= 1;
}

/**
 * ปิดรายการ / Unassign / Demob แล้วแต่ไม่เคย mobilize จริง — ไม่ควรขึ้นกระดานลงเวลา
 * ครอบคลุม Unassign จากหน้า Assignments ที่ตั้งแค่ DEMOBILIZED (ไม่มี unassignedAt)
 */
export function assignmentEndedWithoutEverMobilizingOnSite(
  a: Pick<
    Assignment,
    | 'unassignedAt'
    | 'deploymentStatus'
    | 'mobStandbyDate'
    | 'mobWorkingStartDate'
    | 'mobLocationEndDate'
    | 'mobReadyToTravelAt'
    | 'mobStandbyRecordedAt'
    | 'mobWorkingStartedAt'
  >,
): boolean {
  return assignmentReleasedFromPoLineQuota(a) && assignmentNeverHadMobilizationSiteWork(a);
}

/**
 * กระดาน PO รายวัน — ซ่อนแถวตั้งแต่วันที่ถอนมอบหมายเป็นต้นไป (สรุปรายเดือนยังเห็นประวัติเดือนก่อน)
 */
export function assignmentExcludedFromPoDailyBoardOnDate(
  a: Pick<Assignment, 'unassignedAt'>,
  htmlDate: string,
): boolean {
  const unassignYmd = resolveAssignmentUnassignYmd(a);
  if (!unassignYmd) return false;
  const d = htmlDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return d >= unassignYmd;
}

/**
 * แสดงบน Wave Board / สรุปเดือน — รวมคนที่กดจบงานแล้ว (กลับ DRAFT) เพื่อเห็นประวัติลงเวลาสิ้นเดือน
 * ถอนมอบหมายแล้วยังแสดงได้ถ้าเคยมีช่วงลงเวลา (ไม่ซ่อนประวัติเดือนเก่า)
 */
export function assignmentIncludedInWaveTimesheetRoster(
  a: Pick<
    Assignment,
    | 'deploymentStatus'
    | 'readinessStatus'
    | 'mobCycleNumber'
    | 'mobLocationEndDate'
    | 'unassignedAt'
    | 'mobStandbyDate'
    | 'mobWorkingStartDate'
    | 'mobReadyToTravelAt'
    | 'mobStandbyRecordedAt'
    | 'mobWorkingStartedAt'
  >,
): boolean {
  if (assignmentEndedWithoutEverMobilizingOnSite(a)) return false;
  if (assignmentUnassignedNeverHadSiteWork(a)) return false;
  if (isAssignmentDraftAwaitingFirstMobOnly(a)) return false;
  if (a.deploymentStatus === 'DRAFT') return true;
  /** ถอนกำลังแล้วแต่ยังต้องเห็นประวัติลงเวลาในเดือนที่ทับช่วงมอบหมาย */
  if (a.deploymentStatus === 'DEMOBILIZED') return true;
  /** Unassign / ปิดรายการ — ระบบเขียน CLOSED + unassignedAt; ต้องยังเห็นเดือนเก่าบนสรุปรายเดือน */
  if (a.deploymentStatus === 'CLOSED') return true;
  return assignmentReadyForWaveTimesheet(a);
}

/**
 * วันลงเวลา (yyyy-MM-dd) อยู่หลังวันจบไซต์ที่ยืนยันแล้ว — ไม่สร้างช่องอัตโนมัติ / ล็อกแก้ไข
 * เมื่อจบไซต์รอบเก่าและเริ่มรอบใหม่ใน mobilization เดียวกัน (วันจบไซต์ที่บันทึกไว้ก่อนวันเริ่มรอบใหม่ตามฟิลด์)
 * ค่า mobLocationEndDate ยังเป็นของรอบเก่า — ห้ามถือว่าหลังจบไซต์ในช่วง gap remob หรือวันรอบใหม่จนกว่าจะบันทึกจบไซต์รอบใหม่
 */
export function isHtmlDateAfterMobLocationEnd(
  a: Pick<
    Assignment,
    | 'mobLocationEndDate'
    | 'mobStandbyDate'
    | 'mobWorkingStartDate'
    | 'deploymentStatus'
    | 'poActiveStandbyAutoStartYmd'
    | 'poActiveStandbyAutoEndYmd'
  >,
  htmlDate: string,
): boolean {
  if (isYmdInPoActiveStandbyAutoWindow(a, htmlDate)) return false;
  if (!mobLocationEndDateCapsAssignmentTimesheetWindow(a)) return false;
  const end = (a.mobLocationEndDate || '').trim().slice(0, 10);
  const d = htmlDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end) || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  if (!(d > end)) return false;

  const mobStandby = (a.mobStandbyDate || '').trim().slice(0, 10);
  const mobStart = (a.mobWorkingStartDate || '').trim().slice(0, 10);
  const hasStandby = /^\d{4}-\d{2}-\d{2}$/.test(mobStandby);
  const hasMobStart = /^\d{4}-\d{2}-\d{2}$/.test(mobStart);
  /** บันทึกจบไซต์รอบก่อนบนเอกสารเดียวกับวันเริ่มรอบใหม่ */
  const splitPriorEndBeforeNewCycleStart = hasMobStart && end < mobStart;

  if (!splitPriorEndBeforeNewCycleStart) return true;

  let mobSegmentStart: string | undefined;
  if (hasStandby && hasMobStart) mobSegmentStart = mobStandby <= mobStart ? mobStandby : mobStart;
  else if (hasStandby) mobSegmentStart = mobStandby;
  else if (hasMobStart) mobSegmentStart = mobStart;

  if (mobSegmentStart) return false;

  return true;
}

/** mobilization รอบใหม่หลังจบไซต์รอบก่อน (หรือ mobCycle > 1) */
export function assignmentIsRemobMobilizationOnDoc(
  a: Pick<Assignment, 'mobCycleNumber' | 'mobLocationEndDate' | 'mobWorkingStartDate'>,
): boolean {
  if (assignmentHasSplitPriorAndNewCycleOnDoc(a)) return true;
  const cycle =
    typeof a.mobCycleNumber === 'number' && Number.isFinite(a.mobCycleNumber) ? a.mobCycleNumber : 1;
  return cycle > 1;
}

/** mobilization เดียว: จบไซต์รอบเก่า (mobEnd) แล้วยังไม่ถึงวัน SB/เริ่มงานรอบใหม่ */
export function assignmentHasSplitPriorAndNewCycleOnDoc(
  a: Pick<Assignment, 'mobLocationEndDate' | 'mobWorkingStartDate' | 'mobStandbyDate'>,
): boolean {
  const mobEnd = (a.mobLocationEndDate || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(mobEnd)) return false;
  const mobStart = (a.mobWorkingStartDate || '').trim().slice(0, 10);
  const mobStandby = (a.mobStandbyDate || '').trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(mobStart) && mobEnd < mobStart) return true;
  /** Final Clearance Step 2 (Mob) ตั้ง mobStandbyDate ก่อนมี mobWorkingStartDate */
  if (/^\d{4}-\d{2}-\d{2}$/.test(mobStandby) && mobEnd < mobStandby) return true;
  return false;
}

/** วันแรกของ mobilization รอบใหม่ (Standby หรือเริ่มงาน — อันไหนมาก่อน) */
export function resolveMobSegmentStartYmd(
  a: Pick<Assignment, 'mobStandbyDate' | 'mobWorkingStartDate'>,
): string | undefined {
  const mobStandby = (a.mobStandbyDate || '').trim().slice(0, 10);
  const mobStart = (a.mobWorkingStartDate || '').trim().slice(0, 10);
  const hasStandby = /^\d{4}-\d{2}-\d{2}$/.test(mobStandby);
  const hasMobStart = /^\d{4}-\d{2}-\d{2}$/.test(mobStart);
  if (hasStandby && hasMobStart) return mobStandby <= mobStart ? mobStandby : mobStart;
  if (hasStandby) return mobStandby;
  if (hasMobStart) return mobStart;
  return undefined;
}

/** ช่วง SB อัตโนมัติจากปุ่ม «หยุดแบบ standby» บนกระดาน PO Active */
export function isYmdInPoActiveStandbyAutoWindow(
  a: Pick<Assignment, 'poActiveStandbyAutoStartYmd' | 'poActiveStandbyAutoEndYmd'>,
  ymd: string,
): boolean {
  const sbStart = (a.poActiveStandbyAutoStartYmd || '').trim().slice(0, 10);
  const sbEnd = (a.poActiveStandbyAutoEndYmd || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sbStart) || !/^\d{4}-\d{2}-\d{2}$/.test(sbEnd)) return false;
  const d = ymd.slice(0, 10);
  return d >= sbStart && d <= sbEnd;
}

/**
 * mobLocationEndDate ใช้เป็นฝาตารางลงเวลาเฉพาะเมื่อจบงานจริง (DRAFT รอ remob / ปิดแล้ว)
 * — ถ้ากลับ ACTIVE/MOB แล้วแต่ฟิลด์ค้างจากรอบเก่า ห้ามตัดวันหลังวันนั้น
 */
export function mobLocationEndDateCapsAssignmentTimesheetWindow(
  a: Pick<Assignment, 'deploymentStatus' | 'mobLocationEndDate'>,
): boolean {
  if (!(a.mobLocationEndDate || '').trim()) return false;
  if (a.deploymentStatus === 'DRAFT') return true;
  if (a.deploymentStatus === 'DEMOBILIZED' || a.deploymentStatus === 'CLOSED') return true;
  return false;
}

/**
 * ช่วงหยุดระหว่างจบไซต์รอบเก่ากับ mobilization รอบใหม่ — ลูกจ้างไม่อยู่ไซต์
 * ห้าม auto work_day / แสดง W ย้อนหลังในช่วงนี้
 */
export function isYmdInRemobGapBetweenCycles(
  a: Pick<
    Assignment,
    | 'mobLocationEndDate'
    | 'mobStandbyDate'
    | 'mobWorkingStartDate'
    | 'deploymentStatus'
    | 'poActiveStandbyAutoStartYmd'
    | 'poActiveStandbyAutoEndYmd'
  >,
  ymd: string,
): boolean {
  const d = ymd.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  if (isYmdInPoActiveStandbyAutoWindow(a, d)) return false;
  if (!assignmentHasSplitPriorAndNewCycleOnDoc(a)) return false;
  const mobEnd = (a.mobLocationEndDate || '').trim().slice(0, 10);
  const mobSegmentStart = resolveMobSegmentStartYmd(a);
  if (!mobSegmentStart) return false;
  return d > mobEnd && d < mobSegmentStart;
}

/**
 * หลังวันจบไซต์ที่บันทึกแล้ว และยังไม่ถึงช่วง mobilization รอบใหม่ — ไม่อยู่ไซต์ (รอ remob)
 * กรอง auto W ผิดช่วง / ไม่แสดงเซลล์ในงวดเดือนใหม่
 */
export function isYmdAfterSiteEndAwaitingRemob(
  a: Pick<Assignment, 'mobLocationEndDate' | 'mobWorkingStartDate' | 'mobStandbyDate'>,
  ymd: string,
): boolean {
  const d = ymd.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const mobEnd = (a.mobLocationEndDate || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(mobEnd) || d <= mobEnd) return false;
  if (assignmentHasSplitPriorAndNewCycleOnDoc(a)) {
    const segStart = resolveMobSegmentStartYmd(a);
    if (segStart && d >= segStart) return false;
    return true;
  }
  return true;
}

/** แสดงเซลล์รายวันในสรุปรายเดือน — ไม่รวมแถว auto ค้างหลังจบไซต์ */
export function waveMonthCellTimesheetVisible(
  asgn: Pick<
    Assignment,
    | 'deploymentStatus'
    | 'mobLocationEndDate'
    | 'mobCycleNumber'
    | 'unassignedAt'
    | 'mobStandbyDate'
    | 'mobWorkingStartDate'
    | 'startDate'
    | 'assignedDate'
    | 'endDate'
    | 'poActiveStandbyAutoStartYmd'
    | 'poActiveStandbyAutoEndYmd'
  >,
  ymd: string,
  ts: DailyTimesheet | undefined,
): boolean {
  if (!ts) return false;
  if (isYmdAfterSiteEndAwaitingRemob(asgn, ymd)) return false;
  if (isYmdInRemobGapBetweenCycles(asgn, ymd)) return false;
  if (isYmdWithinAssignmentMobTimesheetWindow(asgn, ymd)) return true;
  if (isPoDailyBoardPriorCycleWorkDateWhileAwaitingRemob(asgn, ymd)) return true;
  return false;
}

/** ทุกวัน yyyy-MM-dd ในช่องว่าง remob (exclusive ขอบ) */
export function* eachYmdInRemobGapBetweenCycles(
  a: Pick<Assignment, 'mobLocationEndDate' | 'mobStandbyDate' | 'mobWorkingStartDate'>,
): Generator<string> {
  if (!assignmentHasSplitPriorAndNewCycleOnDoc(a)) return;
  const mobEnd = (a.mobLocationEndDate || '').trim().slice(0, 10);
  const mobSegmentStart = resolveMobSegmentStartYmd(a);
  if (!mobSegmentStart || mobEnd >= mobSegmentStart) return;
  let cur = addDaysToYmd(mobEnd, 1);
  while (cur < mobSegmentStart) {
    yield cur;
    cur = addDaysToYmd(cur, 1);
  }
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
    | 'deploymentStatus'
    | 'poActiveStandbyAutoStartYmd'
    | 'poActiveStandbyAutoEndYmd'
  >,
  ymd: string,
): boolean {
  const d = ymd.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;

  if (isYmdInPoActiveStandbyAutoWindow(a, d)) return true;

  const unassignYmd = resolveAssignmentUnassignYmd(a);
  if (unassignYmd && d >= unassignYmd) return false;

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
  const mobEndCapsWindow = hasMobEnd && mobLocationEndDateCapsAssignmentTimesheetWindow(a);

  if (isYmdInRemobGapBetweenCycles(a, d)) return false;
  if (isYmdAfterSiteEndAwaitingRemob(a, d)) return false;

  const mobSegmentStart = resolveMobSegmentStartYmd(a);

  /**
   * รอบที่จบไซต์แล้ว (มี mobEnd) — startDate บนมอบหมายอาจเลื่อนสำหรับ remob รอบใหม่ (เช่น 27 มิ.ย.)
   * แต่ยังต้องแก้/สรุปวันก่อนหน้านั้นในรอบเดิม (เช่น 1–13 มิ.ย.)
   */
  if (mobEndCapsWindow && d <= mobEnd) {
    const segmentFloor = mobSegmentStart ?? (hasMobStart ? mobStart : hasStandby ? mobStandby : undefined);
    if (segmentFloor && d >= segmentFloor) {
      /* ใช้ logic เพดานด้านล่างตามปกติ */
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(assignStart) && assignStart > d) {
      let ceilOnly = mobEnd;
      if (hasAssignEnd && assignEnd < ceilOnly) ceilOnly = assignEnd;
      return d <= ceilOnly;
    }
  }

  const segmentForMonthCompare = mobSegmentStart ?? mobStart;

  /**
   * เอกสาร mobilization เดียวที่เก็บทั้งจบไซต์รอบเก่า (mobEnd) กับเริ่มรอบใหม่ (mobStart) — mobEnd < mobStart
   * (ใช้ทั้งขอบล่างและเพดานด้านล่าง)
   */
  const splitPriorAndNewCycleOnDoc = assignmentHasSplitPriorAndNewCycleOnDoc(a);

  /** วันนี้อยู่ในรอบที่ปิดแล้ว (ก่อนเริ่มรอบใหม่ที่สะสมใน mobilization เดียวกัน — รวมกรณีมีแค่ mobStandbyDate) */
  const inClosedPriorCycle =
    splitPriorAndNewCycleOnDoc &&
    !!mobSegmentStart &&
    hasMobEnd &&
    d <= mobEnd;
  /** เดือนปฏิทินต่างจากเดือนของวันแรกช่วง mobilization — ใช้ขอบจากมอบหมาย ไม่ใช่แค่วันเริ่มงานรอบใหม่ */
  const inEarlierCalendarMonthThanMobSegment =
    !!segmentForMonthCompare &&
    d < segmentForMonthCompare &&
    d.slice(0, 7) !== segmentForMonthCompare.slice(0, 7);

  let floor: string | undefined;
  /** จบงานแล้ว (ข้อมูลเก่าที่ล้าง mobStandby/mobWorkingStart) — ยังเห็นช่วงก่อน mobLocationEndDate */
  if (mobEndCapsWindow && !hasMobStart && !hasStandby) {
    const candidates = [assignStart, assignedFallback].filter((y) => /^\d{4}-\d{2}-\d{2}$/.test(y));
    if (candidates.length) floor = candidates.reduce((a, b) => (a < b ? a : b));
    if (floor !== undefined && d < floor && d <= mobEnd) floor = undefined;
  } else if (inClosedPriorCycle) {
    const candidates = [assignStart, assignedFallback].filter(
      (y) => /^\d{4}-\d{2}-\d{2}$/.test(y) && y <= d,
    );
    if (candidates.length) floor = candidates.reduce((a, b) => (a < b ? a : b));
  } else if (inEarlierCalendarMonthThanMobSegment) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(assignStart)) floor = assignStart;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(assignedFallback)) floor = assignedFallback;
    if (floor !== undefined && d < floor && mobEndCapsWindow && d <= mobEnd) floor = undefined;
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
      /**
       * mobilization บนไซต์ก่อนวันบันทึกมอบหมาย (assignStart ช้ากว่า mobSegmentStart) —
       * ใช้วัน mobilization เป็นขอบล่าง ไม่ตัด SB/W ก่อนวันมอบหมายในเอกสาร
       */
      if (assignStart > mobSegmentStart) {
        floor = mobSegmentStart;
      } else {
        floor = assignStart >= mobSegmentStart ? assignStart : mobSegmentStart;
      }
    } else {
      floor = mobSegmentStart;
    }
  }
  if (floor === undefined) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(assignStart)) floor = assignStart;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(assignedFallback)) floor = assignedFallback;
  }

  if (floor !== undefined && d < floor) {
    if (mobEndCapsWindow && d <= mobEnd && floor > d) {
      /* startDate remob ใหม่ — อย่าตัดวันในรอบที่จบแล้ว */
    } else {
      return false;
    }
  }

  /**
   * splitPriorAndNewCycleOnDoc — ดูด้านบน
   * - วัน ≤ mobEnd = ช่วงรอบเก่า → เพดานตาม mobEnd / endDate มอบหมาย
   * - วัน > mobEnd = ช่วงหลังจบรอบเก่า (รวม gap remob ก่อน SB รอบใหม่ และวันทำงานรอบใหม่)
   *   ห้ามใช้ mobLocationEndDate รอบเก่าเป็นเพดาน — ไม่เช่นนั้นทุกวันหลังสิ้นเดือนเก่าถูกตัดจนหาย SB/W
   */

  let ceil: string | undefined;
  if (splitPriorAndNewCycleOnDoc && mobEndCapsWindow && d <= mobEnd) {
    if (hasAssignEnd) ceil = mobEnd <= assignEnd ? mobEnd : assignEnd;
    else ceil = mobEnd;
  } else if (splitPriorAndNewCycleOnDoc && mobEndCapsWindow && d > mobEnd) {
    if (hasAssignEnd) ceil = assignEnd;
  } else if (mobEndCapsWindow && hasAssignEnd) {
    ceil = mobEnd <= assignEnd ? mobEnd : assignEnd;
  } else if (mobEndCapsWindow) {
    ceil = mobEnd;
  } else if (hasAssignEnd) {
    ceil = assignEnd;
  }

  /**
   * เพดาน endDate บนมอบหมายบางครั้งสั้นกว่าวันเริ่มปฏิบัติงานจริง — หลัง mobWorkingStartDate อย่าใช้ endDate เป็นตัวตัด
   * (กันลูกจ้าง ACTIVE หลัง Mobilization «เริ่มวันทำงาน» หายจากกระดาน PO Active)
   */
  if (
    !splitPriorAndNewCycleOnDoc &&
    hasMobStart &&
    hasAssignEnd &&
    mobStart > assignEnd &&
    d >= mobStart
  ) {
    ceil = mobEndCapsWindow ? mobEnd : undefined;
  }

  if (ceil !== undefined && d > ceil) return false;

  return true;
}

/** วันนี้ยังแก้ไขลงเวลารอบก่อนจบงานได้ แม้อยู่ Waiting MOB / กำลัง Mob รอบใหม่ */
export function isPoDailyBoardPriorCycleWorkDateWhileAwaitingRemob(
  asgn: Pick<
    Assignment,
    | 'deploymentStatus'
    | 'mobLocationEndDate'
    | 'mobCycleNumber'
    | 'unassignedAt'
    | 'mobStandbyDate'
    | 'mobWorkingStartDate'
  >,
  dateYmd: string,
): boolean {
  if (asgn.deploymentStatus !== 'DRAFT' && asgn.deploymentStatus !== 'MOBILIZING') return false;
  if (!(asgn.mobLocationEndDate || '').trim()) return false;
  if (isAssignmentDraftAwaitingFirstMobOnly(asgn)) return false;
  const mobEnd = (asgn.mobLocationEndDate || '').trim().slice(0, 10);
  const d = dateYmd.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(mobEnd) || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  if (d > mobEnd) return false;
  /** MOBILIZING: อนุญาตวันรอบเก่าเฉพาะเมื่อมีหลักฐานเริ่มรอบใหม่หลัง mobEnd (SB/W) */
  if (asgn.deploymentStatus === 'MOBILIZING') {
    return assignmentHasSplitPriorAndNewCycleOnDoc(asgn);
  }
  return true;
}

/** กระดานรายวัน / สรุปรายเดือน — วันนี้แก้ไขหรือบันทึก timesheet ได้หรือไม่ */
export function isYmdEditableForAssignmentTimesheet(
  asgn: Pick<
    Assignment,
    | 'deploymentStatus'
    | 'mobLocationEndDate'
    | 'mobCycleNumber'
    | 'unassignedAt'
    | 'mobStandbyDate'
    | 'mobWorkingStartDate'
    | 'startDate'
    | 'assignedDate'
    | 'endDate'
    | 'poActiveStandbyAutoStartYmd'
    | 'poActiveStandbyAutoEndYmd'
  >,
  ymd: string,
  options?: { hasPersistedTimesheetOnDate?: boolean },
): boolean {
  const d = ymd.slice(0, 10);
  if (options?.hasPersistedTimesheetOnDate && !isHtmlDateAfterMobLocationEnd(asgn, d)) return true;
  if (isYmdWithinAssignmentMobTimesheetWindow(asgn, d)) return true;
  if (isPoDailyBoardPriorCycleWorkDateWhileAwaitingRemob(asgn, d)) return true;
  return false;
}

/**
 * มีอย่างน้อยหนึ่งวันในเดือนปฏิทินที่อยู่ในหน้าต่าง mobilization สำหรับลงเวลา
 * — ไม่แสดงแถวว่างในเดือนใหม่สำหรับคนที่จบงานแล้วรอ Mob รอบใหม่ (ยังไม่มี SB/W ในเดือนนั้น)
 */
export function assignmentHasAnyMobTimesheetDayInCalendarMonth(a: Assignment, yearMonth: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return false;
  const [y, mo] = yearMonth.split('-').map(Number);
  const lastD = new Date(y, mo, 0).getDate();
  const monthEnd = `${yearMonth}-${String(lastD).padStart(2, '0')}`;
  let d = `${yearMonth}-01`;
  while (d <= monthEnd) {
    if (isYmdWithinAssignmentMobTimesheetWindow(a, d)) return true;
    d = addDaysToYmd(d, 1);
  }
  return false;
}
