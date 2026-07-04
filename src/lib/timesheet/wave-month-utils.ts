import type { Assignment, DailyTimesheet, RateConditionEventType, WaveMonthTimesheetPhotoAttachment } from '@/lib/types';
import { resolveStandbyPaidHours } from '@/lib/payroll/package-labor-cost';
import {
  assignmentIncludedInWaveTimesheetRoster,
  assignmentHasAnyMobTimesheetDayInCalendarMonth,
  assignmentEndedWithoutEverMobilizingOnSite,
  isHtmlDateAfterMobLocationEnd,
  isPoDailyBoardPriorCycleWorkDateWhileAwaitingRemob,
  isYmdAfterSiteEndAwaitingRemob,
  isYmdInRemobGapBetweenCycles,
  isYmdWithinAssignmentMobTimesheetWindow,
  waveMonthCellTimesheetVisible,
} from '@/lib/constants/timesheet-ui';
import { assignmentOverlapsYearMonthForPoDailyBoard } from '@/lib/ops/timesheet-hub-po-month';
import { assignmentReleasedFromPoLineQuota } from '@/lib/ops/po-fulfillment-read-model';
import { pickRosterLinePerWorker } from '@/lib/ops/assignment-roster';

/** คืน yyyy-mm-dd สำหรับวันสุดท้ายของเดือน yyyy-mm */
/** แนบเป็น PDF หรือไม่ (รองรับข้อมูลเก่าที่ไม่มี contentType) */
export function isWaveMonthAttachmentPdf(att: Pick<WaveMonthTimesheetPhotoAttachment, 'fileName' | 'contentType'>): boolean {
  if (att.contentType === 'application/pdf') return true;
  return att.fileName.toLowerCase().endsWith('.pdf');
}

export function lastDayOfCalendarMonth(ym: string): string {
  const [ys, ms] = ym.split('-');
  const y = Number(ys);
  const m = Number(ms);
  if (!y || !m || m < 1 || m > 12) return `${ys}-${ms}-28`;
  const last = new Date(y, m, 0);
  const d = String(last.getDate()).padStart(2, '0');
  return `${y}-${String(m).padStart(2, '0')}-${d}`;
}

/** รายการวันที่ในเดือน (yyyy-mm-dd) */
export function listDaysInMonth(ym: string): string[] {
  const end = lastDayOfCalendarMonth(ym);
  const [y, m] = ym.split('-').map(Number);
  const out: string[] = [];
  const lastNum = Number(end.slice(8, 10));
  for (let d = 1; d <= lastNum; d++) {
    out.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return out;
}

export function timesheetEventAbbrev(et: RateConditionEventType | string | undefined): string {
  const map: Record<string, string> = {
    work_day: 'W',
    standby_day: 'SB',
    travel_day: 'T',
    mobilization_day: 'M1',
    demobilization_day: 'D1',
    unpaid_leave: 'UL',
    off_day_worked: 'OW',
    public_holiday_worked: 'PH',
    training_day: 'TR',
    sick_leave_paid: 'SL',
    vacation_paid: 'V',
    night_shift: 'N',
    half_day: 'H',
    early_return: 'ER',
    client_cancellation: 'X',
    replacement_day: 'R',
    other: '?',
  };
  return map[et || ''] || (et ? String(et).slice(0, 2).toUpperCase() : '—');
}

/**
 * ชม.ปกติที่นับเป็น “ชั่วโมงทำงาน” ในสรุปรายเดือน — เฉพาะประเภทวันทำงาน (ไม่รวม standby / travel / mob ฯลฯ)
 */
export function normalHoursCountedAsWork(
  ts: Pick<DailyTimesheet, 'eventType' | 'normalHours'> | undefined,
): number {
  if (!ts || ts.eventType !== 'work_day') return 0;
  return Math.max(0, Number(ts.normalHours) || 0);
}

/** ชม. OT รวม (ot15 + ot20 + ot30) — ใช้แสดงสรุปรายเดือน / payroll / billing */
export function totalOtHoursFromTimesheet(
  ts: Pick<DailyTimesheet, 'ot15Hours' | 'ot20Hours' | 'ot30Hours'> | undefined,
): number {
  if (!ts) return 0;
  return (
    Math.max(0, Number(ts.ot15Hours) || 0) +
    Math.max(0, Number(ts.ot20Hours) || 0) +
    Math.max(0, Number(ts.ot30Hours) || 0)
  );
}

/** ชม. OT ที่นับในสรุปรายเดือน — เฉพาะวันทำงาน */
export function otHoursCountedForWaveMonth(
  ts: Pick<DailyTimesheet, 'eventType' | 'ot15Hours' | 'ot20Hours' | 'ot30Hours'> | undefined,
): number {
  if (!ts || ts.eventType !== 'work_day') return 0;
  return totalOtHoursFromTimesheet(ts);
}

const WAVE_MONTH_STANDBY_EVENT_TYPES = new Set<RateConditionEventType>([
  'standby_day',
  'mobilization_day',
  'demobilization_day',
]);

/**
 * ชม.ที่นับเป็น standby ในสรุปรายเดือน — SB / M1 / D1
 * ยึด `normalHours` ที่ลงในใบงาน (สอดคล้องสูตรจ่ายค่าแรง — 8 ชม. vs 12 ชม. ได้อัตราต่างกัน)
 * ถ้าไม่ได้ลงชม. ใช้ fallback จาก `resolveStandbyPaidHours` (standbyUnits × 8)
 */
export function standbyHoursCountedForWaveMonth(
  ts: Pick<DailyTimesheet, 'eventType' | 'normalHours' | 'standbyUnits'> | undefined,
): number {
  if (!ts || !WAVE_MONTH_STANDBY_EVENT_TYPES.has(ts.eventType as RateConditionEventType)) return 0;
  return resolveStandbyPaidHours(ts, 8);
}

/**
 * รวมชม.ทำงานในเดือนตามแถวตาราง — ใช้การจับคู่ timesheet เดียวกับช่องรายวัน (ไม่รวมซ้ำข้าม assignment/PO)
 * นับจาก `resolveTimesheetForWaveMonthCell` ให้ตรงกับเซลล์ที่แสดง W/SB (ยกเว้นช่วง remob gap ที่ resolve ไม่คืนค่า)
 */
export function sumWorkHoursForWaveMonthRow(
  assignment: Pick<
    Assignment,
    | 'poId'
    | 'mobStandbyDate'
    | 'mobWorkingStartDate'
    | 'startDate'
    | 'assignedDate'
    | 'mobLocationEndDate'
    | 'endDate'
    | 'unassignedAt'
  >,
  waveId: string,
  workerId: string,
  rosterAssignmentId: string,
  daysYmd: readonly string[],
  sheetsByWaveWorker: Map<string, DailyTimesheet[]>,
  flatMonthSheets: readonly DailyTimesheet[],
  poScopeWaveId?: string | null,
  alternateAssignmentIds?: readonly string[] | null,
  _options?: { onlyWithinMobWindow?: boolean },
): number {
  let sum = 0;
  for (const d of daysYmd) {
    const ts = resolveTimesheetForWaveMonthCell(
      waveId,
      workerId,
      d,
      rosterAssignmentId,
      sheetsByWaveWorker,
      flatMonthSheets,
      poScopeWaveId,
      assignment,
      alternateAssignmentIds,
    );
    sum += normalHoursCountedAsWork(ts);
  }
  return sum;
}

/**
 * รวมชม. standby ในเดือนต่อแถว — จับคู่ timesheet เดียวกับช่องรายวัน (mirror sumWorkHoursForWaveMonthRow)
 */
export function sumStandbyHoursForWaveMonthRow(
  assignment: Pick<
    Assignment,
    | 'poId'
    | 'mobStandbyDate'
    | 'mobWorkingStartDate'
    | 'startDate'
    | 'assignedDate'
    | 'mobLocationEndDate'
    | 'endDate'
    | 'unassignedAt'
  >,
  waveId: string,
  workerId: string,
  rosterAssignmentId: string,
  daysYmd: readonly string[],
  sheetsByWaveWorker: Map<string, DailyTimesheet[]>,
  flatMonthSheets: readonly DailyTimesheet[],
  poScopeWaveId?: string | null,
  alternateAssignmentIds?: readonly string[] | null,
  _options?: { onlyWithinMobWindow?: boolean },
): number {
  let sum = 0;
  for (const d of daysYmd) {
    const ts = resolveTimesheetForWaveMonthCell(
      waveId,
      workerId,
      d,
      rosterAssignmentId,
      sheetsByWaveWorker,
      flatMonthSheets,
      poScopeWaveId,
      assignment,
      alternateAssignmentIds,
    );
    sum += standbyHoursCountedForWaveMonth(ts);
  }
  return sum;
}

/** รวมชม. OT ในเดือนต่อแถว — mirror sumWorkHoursForWaveMonthRow */
export function sumOtHoursForWaveMonthRow(
  assignment: Pick<
    Assignment,
    | 'poId'
    | 'mobStandbyDate'
    | 'mobWorkingStartDate'
    | 'startDate'
    | 'assignedDate'
    | 'mobLocationEndDate'
    | 'endDate'
    | 'unassignedAt'
  >,
  waveId: string,
  workerId: string,
  rosterAssignmentId: string,
  daysYmd: readonly string[],
  sheetsByWaveWorker: Map<string, DailyTimesheet[]>,
  flatMonthSheets: readonly DailyTimesheet[],
  poScopeWaveId?: string | null,
  alternateAssignmentIds?: readonly string[] | null,
  _options?: { onlyWithinMobWindow?: boolean },
): number {
  let sum = 0;
  for (const d of daysYmd) {
    const ts = resolveTimesheetForWaveMonthCell(
      waveId,
      workerId,
      d,
      rosterAssignmentId,
      sheetsByWaveWorker,
      flatMonthSheets,
      poScopeWaveId,
      assignment,
      alternateAssignmentIds,
    );
    sum += otHoursCountedForWaveMonth(ts);
  }
  return sum;
}

/** ชม. OT ที่เพิ่มจากแก้ไขย้อนหลัง (delta) */
export function retroAddedOtHours(
  adjustments: readonly { addedOt15Hours?: number; addedOt20Hours?: number; addedOt30Hours?: number; status?: string }[],
): number {
  return adjustments
    .filter((a) => a.status !== 'void')
    .reduce(
      (s, a) =>
        s +
        Math.max(0, Number(a.addedOt15Hours) || 0) +
        Math.max(0, Number(a.addedOt20Hours) || 0) +
        Math.max(0, Number(a.addedOt30Hours) || 0),
      0,
    );
}

export function retroAddedStandbyHours(
  adjustments: readonly { addedStandbyHours?: number; status?: string }[],
): number {
  return adjustments
    .filter((a) => a.status !== 'void')
    .reduce((s, a) => s + Math.max(0, Number(a.addedStandbyHours) || 0), 0);
}

export function retroAddedM1Trips(
  adjustments: readonly { addedM1Trips?: number; status?: string }[],
): number {
  return adjustments
    .filter((a) => a.status !== 'void')
    .reduce((s, a) => s + Math.max(0, Number(a.addedM1Trips) || 0), 0);
}

export function retroAddedD1Trips(
  adjustments: readonly { addedD1Trips?: number; status?: string }[],
): number {
  return adjustments
    .filter((a) => a.status !== 'void')
    .reduce((s, a) => s + Math.max(0, Number(a.addedD1Trips) || 0), 0);
}

export function retroCellKey(assignmentId: string, dateYmd: string): string {
  return `${assignmentId}|${dateYmd}`;
}

/** มีใบงาน LOCKED ในเดือนนี้ = payroll ปิดงวดแล้วอย่างน้อยบางส่วน */
export function monthHasPayrollLockedTimesheets(
  monthYm: string,
  sheets: readonly DailyTimesheet[],
): boolean {
  const ym = monthYm.trim();
  if (!/^\d{4}-\d{2}$/.test(ym)) return false;
  return sheets.some(
    (ts) => String(ts.date || '').startsWith(ym) && ts.status === 'LOCKED',
  );
}

/** แก้ไขในเดือนนี้ต้องผ่าน retro เท่านั้น — เมื่อมีใบงาน LOCKED จาก payroll */
export function isRetroOnlyPayrollMonth(
  monthYm: string,
  monthSheets: readonly DailyTimesheet[],
  _poMonthReviews: readonly { status?: string }[] | undefined,
): boolean {
  return monthHasPayrollLockedTimesheets(monthYm, monthSheets);
}

export function hasActiveRetroAdjustments(
  adjustments: readonly { status?: string }[] | undefined,
): boolean {
  return (adjustments ?? []).some((a) => a.status !== 'void');
}

/**
 * แสดงเซลล์รายเดือนรวมแก้ไขย้อนหลัง — ต่อท้าย † เมื่อมีการแก้ไข
 */
export function timesheetWaveMonthCellDisplayWithRetro(
  ts: DailyTimesheet | undefined,
  retroAdjustments: readonly {
    addedOt15Hours?: number;
    addedOt20Hours?: number;
    addedOt30Hours?: number;
    addedStandbyHours?: number;
    addedM1Trips?: number;
    addedD1Trips?: number;
    status?: string;
  }[] = [],
): string {
  const activeRetro = retroAdjustments.filter((a) => a.status !== 'void');
  if (!ts) {
    const m1 = retroAddedM1Trips(activeRetro);
    const d1 = retroAddedD1Trips(activeRetro);
    const sb = retroAddedStandbyHours(activeRetro);
    if (m1 > 0) return m1 > 1 ? `M1+${m1}†` : 'M1†';
    if (d1 > 0) return d1 > 1 ? `D1+${d1}†` : 'D1†';
    if (sb > 0) return `SB+${sb}†`;
    const ot = retroAddedOtHours(activeRetro);
    if (ot > 0) return `W+${ot}†`;
    return ' - ';
  }
  if (ts.eventType === 'unpaid_leave') return ' - ';
  const abbr = timesheetEventAbbrev(ts.eventType);
  const baseOt = otHoursCountedForWaveMonth(ts);
  const retroOt = ts.eventType === 'work_day' ? retroAddedOtHours(activeRetro) : 0;
  const retroSb =
    ts.eventType === 'mobilization_day' ||
    ts.eventType === 'demobilization_day' ||
    ts.eventType === 'standby_day'
      ? retroAddedStandbyHours(activeRetro)
      : 0;
  const retroM1 =
    ts.eventType === 'mobilization_day' ? retroAddedM1Trips(activeRetro) : retroAddedM1Trips(activeRetro);
  const retroD1 =
    ts.eventType === 'demobilization_day' ? retroAddedD1Trips(activeRetro) : retroAddedD1Trips(activeRetro);
  const ot = baseOt + retroOt;
  const hasRetro = hasActiveRetroAdjustments(activeRetro);
  let label: string;
  if (ot > 0) {
    const otLabel = Number.isInteger(ot) ? String(ot) : ot.toFixed(1);
    label = `${abbr}+${otLabel}`;
  } else if (retroM1 > 0) {
    label = retroM1 > 1 ? `${abbr}+${retroM1}` : abbr;
  } else if (retroD1 > 0) {
    label = retroD1 > 1 ? `${abbr}+${retroD1}` : abbr;
  } else if (retroSb > 0) {
    label = `${abbr}+${retroSb}`;
  } else {
    label = abbr;
  }
  return hasRetro ? `${label}†` : label;
}

export function timesheetRetroCellRingClasses(hasRetro: boolean): string {
  return hasRetro ? 'ring-2 ring-red-500/75 ring-offset-1' : '';
}

/**
 * จับคู่เซลล์รายเดือนกับ daily_timesheet — รองรับกรณี waveId ในเอกสารไม่ตรงกับแถว (เช่น บันทึกจาก wave อื่น/ข้อมูลเก่า)
 * ลำดับ: ตรงกุญแจ wave|คน ก่อน — จากนั้น PO scope (`po_ts_scope_<poId>` จากกระดาน PO) — แล้วจึงค้นตาม worker + วันที่ + assignment
 */
export function resolveTimesheetForWaveMonthCell(
  waveId: string,
  workerId: string,
  date: string,
  rosterAssignmentId: string,
  sheetsByWaveWorker: Map<string, DailyTimesheet[]>,
  flatMonthSheets: readonly DailyTimesheet[],
  /** เท่ากับ `poTimesheetScopeId(poId)` เมื่อบันทึกจาก Po Daily Board (waveId ในเอกสาร = scope ไม่ใช่ wave จริง) */
  poScopeWaveId?: string | null,
  /** ถ้ามี — ไม่ดึงบันทึกรายวันที่อยู่นอกช่วง mobilization จริง (เทียบ `mobWorkingStartDate` / จบไซต์) */
  assignmentWindow?: Pick<
    Assignment,
    | 'poId'
    | 'mobStandbyDate'
    | 'mobWorkingStartDate'
    | 'startDate'
    | 'assignedDate'
    | 'mobLocationEndDate'
    | 'endDate'
    | 'unassignedAt'
  > | null,
  /** mobilization อื่นของคนเดียวกันใน wave เดียวกัน — ลองจับคู่หลังสร้าง mobilization ใหม่แต่ daily_timesheets ยังอ้าง assignment เดิม */
  alternateAssignmentIds?: readonly string[] | null,
): DailyTimesheet | undefined {
  const assignmentIdsToTry = [
    rosterAssignmentId,
    ...(alternateAssignmentIds?.filter((id) => id && id !== rosterAssignmentId) ?? []),
  ];

  const lookupIgnoringMobWindow = (enforceMobWindow: boolean): DailyTimesheet | undefined => {
    if (
      enforceMobWindow &&
      assignmentWindow &&
      !isYmdWithinAssignmentMobTimesheetWindow(assignmentWindow, date)
    ) {
      return undefined;
    }

    /** ต้องจับคู่ assignment — ไม่ใช้แค่วันที่ (กัน wave เดียวกันมีหลาย mobilization / remob ซ้อน) */
    const tryKeyed = (wid: string): DailyTimesheet | undefined => {
      const keyed = sheetsByWaveWorker.get(`${wid}|${workerId}`);
      if (!keyed?.length) return undefined;
      for (const aid of assignmentIdsToTry) {
        const hit = keyed.find((t) => t.date === date && t.assignmentId === aid);
        if (hit) return hit;
      }
      return undefined;
    };
    const fromWave = tryKeyed(waveId);
    if (fromWave) return fromWave;
    if (poScopeWaveId && poScopeWaveId !== waveId) {
      const fromScope = tryKeyed(poScopeWaveId);
      if (fromScope) return fromScope;
    }
    for (const aid of assignmentIdsToTry) {
      const hit = flatMonthSheets.find(
        (t) => t.workerId === workerId && t.date === date && t.assignmentId === aid,
      );
      if (hit) return hit;
    }

    /** Fallback: บันทึกจาก mobilization เก่าหรือคีย์ไม่ตรง — จับคู่ PO + คน + วัน + wave (ถ้ามีหลายรายการ) */
    const poId = (assignmentWindow?.poId || '').trim();
    if (poId) {
      const candidates = flatMonthSheets.filter(
        (t) =>
          t.workerId === workerId &&
          t.date === date &&
          (t.purchaseOrderId || '').trim() === poId,
      );
      if (candidates.length === 1) return candidates[0];
      const byWave = candidates.find(
        (t) => t.waveId === waveId || (!!poScopeWaveId && t.waveId === poScopeWaveId),
      );
      if (byWave) return byWave;
      const byKnownMob = candidates.find((t) => assignmentIdsToTry.includes(t.assignmentId));
      if (byKnownMob) return byKnownMob;
    }
    return undefined;
  };

  /** รอบแรก: เคารพช่วง mobilization */
  const strict = lookupIgnoringMobWindow(true);
  if (strict !== undefined) return strict;

  /**
   * รอบสอง: ผ่อนเมื่อฟิลด์ mobilization ไม่ตรงใบงาน — แต่ห้ามดึงใบงานหลังวันจบไซต์ที่บันทึกแล้ว
   * (กัน auto/sync สร้าง work_day เกินวันจบงานแล้วไปโผล่สรุปรายเดือน)
   */
  const outsideMobWindow =
    !!assignmentWindow &&
    !isYmdWithinAssignmentMobTimesheetWindow(assignmentWindow, date);
  if (outsideMobWindow && assignmentWindow && isYmdInRemobGapBetweenCycles(assignmentWindow, date)) {
    return undefined;
  }
  if (assignmentWindow && isYmdAfterSiteEndAwaitingRemob(assignmentWindow, date)) {
    return undefined;
  }
  const mobEndStr = (assignmentWindow?.mobLocationEndDate || '').trim().slice(0, 10);
  const hasConfirmedMobEnd = /^\d{4}-\d{2}-\d{2}$/.test(mobEndStr);
  const afterRecordedSiteEnd =
    !!assignmentWindow && hasConfirmedMobEnd && isHtmlDateAfterMobLocationEnd(assignmentWindow, date);
  if (outsideMobWindow && afterRecordedSiteEnd) return undefined;

  return lookupIgnoringMobWindow(false);
}

/**
 * มีแถว daily_timesheet อย่างน้อยหนึ่งแถวในเดือนปฏิทินนี้ที่ผูก mobilization นี้
 * — ใช้เมื่อช่วง mobilization ไม่ทับวันในปฏิทินตามฟิลด์ แต่มีข้อมูลลงเวลาจริงในเดือน (ข้อมูลขอบเขตไม่ตรงกัน)
 */
export function assignmentHasTimesheetRowInCalendarMonth(
  m: Pick<
    Assignment,
    | 'id'
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
  monthYm: string,
  sheets: readonly Pick<DailyTimesheet, 'assignmentId' | 'date'>[] | undefined,
): boolean {
  if (!sheets?.length || !/^\d{4}-\d{2}$/.test(monthYm)) return false;
  const prefix = `${monthYm}-`;
  return sheets.some((t) => {
    if (typeof t.date !== 'string' || !t.date.startsWith(prefix) || t.assignmentId !== m.id) {
      return false;
    }
    return (
      isYmdWithinAssignmentMobTimesheetWindow(m, t.date) ||
      isPoDailyBoardPriorCycleWorkDateWhileAwaitingRemob(m, t.date)
    );
  });
}

/** คนละหนึ่งแถวในงวดเดือนต่อ wave — สอดคล้อง `/timesheets/wave-month` (รองรับ PO scope / remob) */
export function mobilizationsEligibleForWaveMonthGrid(
  mobs: Assignment[],
  monthYm: string,
  /** ถ้ามี — รวม mobilization ที่มีแถวลงเวลาในเดือนแม้ช่วง mob ไม่ทับปฏิทินตามฟิลด์ */
  monthTimesheets?: readonly Pick<DailyTimesheet, 'assignmentId' | 'date'>[],
): Assignment[] {
  const eligible = mobs.filter((m) => {
    if (!assignmentIncludedInWaveTimesheetRoster(m)) return false;
    const rowInMonth = assignmentHasTimesheetRowInCalendarMonth(m, monthYm, monthTimesheets);
    /** มีแถวจริงในเดือนแล้ว — แสดงได้แม้ฟิลด์ช่วง mob / DEMOBILIZED ทำให้ overlap เทียบปฏิทินเป็น false (สอดคล้อง wave-month ภายในเมื่อมีข้อมูลลงเวลา) */
    if (rowInMonth) return true;
    /** ปิด/Unassign ก่อน mob — ไม่แสดงแถวว่างแม้ช่วงมอบหมายทับเดือน */
    if (assignmentEndedWithoutEverMobilizingOnSite(m)) return false;
    if (assignmentReleasedFromPoLineQuota(m)) {
      return assignmentHasAnyMobTimesheetDayInCalendarMonth(m, monthYm);
    }
    return (
      assignmentOverlapsYearMonthForPoDailyBoard(m, monthYm) &&
      assignmentHasAnyMobTimesheetDayInCalendarMonth(m, monthYm)
    );
  });
  return pickRosterLinePerWorker(eligible);
}

/**
 * PO ใต้หลาย wave: ใช้กฎเดียวกับ wave-month **แยกตาม waveId** แล้วรวม —
 * ไม่หุบเหลือคนละหนึ่ง mobilization ทั้ง PO (พอร์ทัล PO+เดือนเดียวต้องสอดคล้องจำนวนแถวกับ mobilizations ที่เกี่ยวข้อง)
 */
export function mobilizationsEligibleForPoMonthGrid(
  assignmentsForPo: Assignment[],
  monthYm: string,
  monthTimesheets?: readonly Pick<DailyTimesheet, 'assignmentId' | 'date'>[],
): Assignment[] {
  const byWave = new Map<string, Assignment[]>();
  for (const a of assignmentsForPo) {
    const key = (a.waveId || '').trim() || '_';
    const list = byWave.get(key) ?? [];
    list.push(a);
    byWave.set(key, list);
  }
  const out: Assignment[] = [];
  for (const waveMobs of byWave.values()) {
    out.push(...mobilizationsEligibleForWaveMonthGrid(waveMobs, monthYm, monthTimesheets));
  }
  return out;
}

export function timesheetCellSummary(ts: DailyTimesheet | undefined): string {
  if (!ts) return '';
  const h = normalHoursCountedAsWork(ts);
  const a = timesheetEventAbbrev(ts.eventType);
  return `${h}${a}`;
}

/**
 * กระดานสรุปรายเดือน — แสดงรหัสประเภทวัน + OT (เช่น W+5 = ทำงาน + OT 5 ชม.)
 * ไม่มีข้อมูล / วันไม่จ่าย (unpaid_leave) = " - "
 */
export function timesheetWaveMonthCellDisplay(ts: DailyTimesheet | undefined): string {
  if (!ts) return ' - ';
  if (ts.eventType === 'unpaid_leave') return ' - ';
  const abbr = timesheetEventAbbrev(ts.eventType);
  const ot = otHoursCountedForWaveMonth(ts);
  if (ot > 0) {
    const otLabel = Number.isInteger(ot) ? String(ot) : ot.toFixed(1);
    return `${abbr}+${otLabel}`;
  }
  return abbr;
}

/**
 * สีพื้น/ขอบตามประเภทวัน (อ่านง่ายจากระยะไกล) + วงแหวนแยก DRAFT vs ส่งแล้ว
 */
export function timesheetEventCellBadgeClasses(
  eventType: RateConditionEventType | string | undefined,
  status: string | undefined,
): string {
  const isDraft = status === 'DRAFT';
  let tone: string;
  switch (eventType) {
    case 'work_day':
      tone = 'border-emerald-500/70 bg-emerald-50 text-emerald-950';
      break;
    case 'standby_day':
      tone = 'border-sky-500/70 bg-sky-100 text-sky-950';
      break;
    case 'travel_day':
      tone = 'border-violet-500/70 bg-violet-50 text-violet-950';
      break;
    case 'mobilization_day':
      tone = 'border-orange-500/70 bg-orange-50 text-orange-950';
      break;
    case 'demobilization_day':
      tone = 'border-amber-600/60 bg-amber-50 text-amber-950';
      break;
    case 'unpaid_leave':
      tone = 'border-slate-400 bg-slate-200/80 text-slate-900';
      break;
    case 'off_day_worked':
    case 'public_holiday_worked':
      tone = 'border-fuchsia-500/60 bg-fuchsia-50 text-fuchsia-950';
      break;
    case 'training_day':
      tone = 'border-cyan-600/50 bg-cyan-50 text-cyan-950';
      break;
    case 'sick_leave_paid':
    case 'vacation_paid':
      tone = 'border-pink-400 bg-pink-50 text-pink-950';
      break;
    case 'night_shift':
      tone = 'border-indigo-500/60 bg-indigo-50 text-indigo-950';
      break;
    case 'half_day':
    case 'early_return':
      tone = 'border-teal-500/50 bg-teal-50 text-teal-950';
      break;
    case 'client_cancellation':
    case 'replacement_day':
      tone = 'border-rose-500/50 bg-rose-50 text-rose-950';
      break;
    default:
      tone = 'border-slate-300 bg-slate-100 text-slate-800';
  }
  const statusRing = isDraft
    ? 'ring-1 ring-amber-400 ring-offset-0'
    : 'ring-1 ring-slate-300/70 ring-offset-0';
  return `font-medium ${tone} ${statusRing}`;
}
