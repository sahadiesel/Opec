import type { Assignment, DailyTimesheet, RateConditionEventType, WaveMonthTimesheetPhotoAttachment } from '@/lib/types';
import {
  assignmentIncludedInWaveTimesheetRoster,
  assignmentHasAnyMobTimesheetDayInCalendarMonth,
  isHtmlDateAfterMobLocationEnd,
  isYmdWithinAssignmentMobTimesheetWindow,
} from '@/lib/constants/timesheet-ui';
import { assignmentOverlapsYearMonthForPoDailyBoard } from '@/lib/ops/timesheet-hub-po-month';
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
    mobilization_day: 'M',
    demobilization_day: 'D',
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

/**
 * รวมชม.ทำงานในเดือนตามแถวตาราง — ใช้การจับคู่ timesheet เดียวกับช่องรายวัน (ไม่รวมซ้ำข้าม assignment/PO)
 * @param options.onlyWithinMobWindow — ถ้า true จะนับเฉพาะวันที่อยู่ในช่วง mobilization ตามฟิลด์บน assignment ของแถว
 *   (สอดคล้องการนับจากกริดเมื่อไม่นับวันที่อยู่นอกหน้าต่างแม้เซลล์แสดง W พร้อมวงแหวน)
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
  options?: { onlyWithinMobWindow?: boolean },
): number {
  let sum = 0;
  for (const d of daysYmd) {
    if (
      options?.onlyWithinMobWindow &&
      assignment &&
      !isYmdWithinAssignmentMobTimesheetWindow(assignment, d)
    ) {
      continue;
    }
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
  m: Pick<Assignment, 'id'>,
  monthYm: string,
  sheets: readonly Pick<DailyTimesheet, 'assignmentId' | 'date'>[] | undefined,
): boolean {
  if (!sheets?.length || !/^\d{4}-\d{2}$/.test(monthYm)) return false;
  const prefix = `${monthYm}-`;
  return sheets.some(
    (t) => typeof t.date === 'string' && t.date.startsWith(prefix) && t.assignmentId === m.id,
  );
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
 * กระดานสรุปรายเดือน — แสดงเฉพาะรหัสประเภทวัน (ไม่มีเลขชม.)
 * ไม่มีข้อมูล / วันไม่จ่าย (unpaid_leave) = " - "
 */
export function timesheetWaveMonthCellDisplay(ts: DailyTimesheet | undefined): string {
  if (!ts) return ' - ';
  if (ts.eventType === 'unpaid_leave') return ' - ';
  return timesheetEventAbbrev(ts.eventType);
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
