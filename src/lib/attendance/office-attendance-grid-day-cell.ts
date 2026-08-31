import {
  formatBangkokHmFromUtcMs,
  isBangkokWeeklyRestDayYmd,
  type WeeklyRestPatternForCalendar,
} from '@/lib/attendance/bangkok-calendar';
import {
  punchesGroupedByBangkokYmd,
  type AttendanceDayEffectiveRow,
} from '@/lib/attendance/correction-merge';
import { fourSlotTimesFromOverride } from '@/lib/attendance/attendance-four-slot-times';
import {
  ATTENDANCE_SHIFT_WINDOWS,
  getBangkokMinutesOfDay,
} from '@/lib/attendance/shift-windows';
import type { AttendancePunchDoc } from '@/lib/attendance/types';
import {
  officeShiftMinuteBounds,
  type MonthlyWorkNormPolicyConfig,
  type OfficePayrollWorkingHalf,
  type OfficeShiftMinuteBounds,
} from '@/lib/hr/monthly-work-norm-policy';
import type {
  OfficeLeaveHalfDaySession,
  OfficeLeaveRequestDoc,
  OfficeLeaveType,
} from '@/lib/leaves/types';
import { officeStaffAppliesScanTimeDeductions } from '@/lib/payroll/office-staff-payroll-attendance-basis';
import { isHrSettingsCalendarHolidayYmd } from '@/lib/payroll/worker-global-labor-policy';
import type { CalendarHolidayEntry } from '@/lib/contract-position-rate-extras';
import type { OfficeStaff } from '@/lib/types';

export type OfficeAttendanceGridLineTone = 'time' | 'leave' | 'absent' | 'waiting' | 'late' | 'off';

export type OfficeAttendanceGridLine = {
  label: string;
  tone: OfficeAttendanceGridLineTone;
};

export type OfficeAttendanceGridDayCell = {
  morningIn: OfficeAttendanceGridLine;
  morningOut: OfficeAttendanceGridLine;
  afternoonIn: OfficeAttendanceGridLine;
  afternoonOut: OfficeAttendanceGridLine;
};

type DayLeaveInfo = {
  leaveType: OfficeLeaveType;
  isHalfDay: boolean;
  halfDaySession: OfficeLeaveHalfDaySession | null;
};

type FourScanSlots = {
  morningInMs: number | null;
  morningOutMs: number | null;
  afternoonInMs: number | null;
  afternoonOutMs: number | null;
};

const EMPTY_LINE: OfficeAttendanceGridLine = { label: '', tone: 'off' };
const DASH_LINE: OfficeAttendanceGridLine = { label: '—', tone: 'off' };

function inScanWindow(ms: number, startMinutes: number, endMinutes: number): boolean {
  const m = getBangkokMinutesOfDay(new Date(ms));
  return m >= startMinutes && m <= endMinutes;
}

export function buildEffectivePunchLists(
  dayRow: AttendanceDayEffectiveRow,
  dayPunches: AttendancePunchDoc[],
): { ins: number[]; outs: number[] } {
  if (dayRow.override?.correctionRequestId === 'admin_reset') {
    return { ins: [], outs: [] };
  }
  if (dayRow.override && dayRow.override.correctionRequestId !== 'admin_reset') {
    const four = fourSlotTimesFromOverride(dayRow.override);
    if (four) {
      const ins = [four.morningInAtMs, four.afternoonInAtMs].filter(
        (ms): ms is number => ms != null && Number.isFinite(ms),
      );
      const outs = [four.morningOutAtMs, four.afternoonOutAtMs].filter(
        (ms): ms is number => ms != null && Number.isFinite(ms),
      );
      ins.sort((a, b) => a - b);
      outs.sort((a, b) => a - b);
      return { ins, outs };
    }
    return {
      ins: dayRow.effectiveInMs != null ? [dayRow.effectiveInMs] : [],
      outs: dayRow.effectiveOutMs != null ? [dayRow.effectiveOutMs] : [],
    };
  }
  const ins = dayPunches
    .filter((p) => p.direction === 'IN')
    .map((p) => p.punchedAt)
    .sort((a, b) => a - b);
  const outs = dayPunches
    .filter((p) => p.direction === 'OUT')
    .map((p) => p.punchedAt)
    .sort((a, b) => a - b);
  return { ins, outs };
}

function assignFourScanSlotsLegacy(ins: number[], outs: number[]): FourScanSlots {
  const [morningWin, middayWin, eveningWin] = ATTENDANCE_SHIFT_WINDOWS;
  const morningIns = ins.filter((ms) => inScanWindow(ms, morningWin.startMinutes, morningWin.endMinutes));
  const middayIns = ins.filter((ms) => inScanWindow(ms, middayWin.startMinutes, middayWin.endMinutes));
  const middayOuts = outs.filter((ms) => inScanWindow(ms, middayWin.startMinutes, middayWin.endMinutes));
  const eveningOuts = outs.filter((ms) => inScanWindow(ms, eveningWin.startMinutes, eveningWin.endMinutes));

  const morningInMs = morningIns[0] ?? null;
  let morningOutMs: number | null = null;
  let afternoonInMs: number | null = null;
  let afternoonOutMs: number | null = null;

  if (morningInMs != null) {
    morningOutMs = middayOuts[0] ?? null;
    const afternoonInCandidate = middayIns.find((ms) => (morningOutMs == null ? true : ms > morningOutMs));
    afternoonInMs = afternoonInCandidate ?? null;
  } else {
    afternoonInMs = middayIns[0] ?? null;
  }

  afternoonOutMs = eveningOuts[eveningOuts.length - 1] ?? null;
  if (afternoonOutMs == null && afternoonInMs != null && middayOuts.length > 0) {
    afternoonOutMs = middayOuts[middayOuts.length - 1] ?? null;
  }

  return { morningInMs, morningOutMs, afternoonInMs, afternoonOutMs };
}

/** แยกสแกน 4 ช่วงตาม HR Settings (เช้า / ออกพัก / เข้าบ่าย / ออกเย็น) */
export function assignFourScanSlots(
  ins: number[],
  outs: number[],
  bounds: OfficeShiftMinuteBounds | null,
): FourScanSlots {
  if (!bounds) return assignFourScanSlotsLegacy(ins, outs);

  const morningPeriodIns = ins.filter((ms) => {
    const m = getBangkokMinutesOfDay(new Date(ms));
    return m >= 5 * 60 && m <= bounds.morningEndMin;
  });
  const breakOuts = outs.filter((ms) => {
    const m = getBangkokMinutesOfDay(new Date(ms));
    return m > bounds.morningEndMin && m <= bounds.afternoonStartMin;
  });
  const afternoonPeriodIns = ins.filter((ms) => {
    const m = getBangkokMinutesOfDay(new Date(ms));
    return m > bounds.morningEndMin && m <= bounds.afternoonEndMin;
  });
  const afternoonPeriodOuts = outs.filter((ms) => {
    const m = getBangkokMinutesOfDay(new Date(ms));
    return m > bounds.afternoonStartMin;
  });

  const morningInMs = morningPeriodIns[0] ?? null;
  let morningOutMs: number | null = null;
  let afternoonInMs: number | null = null;
  let afternoonOutMs: number | null = null;

  if (morningInMs != null) {
    morningOutMs = breakOuts[0] ?? null;
    const afternoonInCandidate = afternoonPeriodIns.find((ms) =>
      morningOutMs == null ? true : ms > morningOutMs,
    );
    afternoonInMs = afternoonInCandidate ?? null;
  } else {
    afternoonInMs = afternoonPeriodIns[0] ?? null;
  }

  afternoonOutMs = afternoonPeriodOuts[afternoonPeriodOuts.length - 1] ?? null;
  if (afternoonOutMs == null && afternoonInMs != null && breakOuts.length > 0) {
    afternoonOutMs = breakOuts[breakOuts.length - 1] ?? null;
  }

  return { morningInMs, morningOutMs, afternoonInMs, afternoonOutMs };
}

function approvedLeaveOnYmd(
  staffId: string,
  ymd: string,
  leaves: OfficeLeaveRequestDoc[],
): DayLeaveInfo | null {
  for (const r of leaves) {
    if (r.staffId !== staffId || r.status !== 'APPROVED') continue;
    const start = r.startDate.slice(0, 10);
    const end = r.endDate.slice(0, 10);
    if (ymd >= start && ymd <= end) {
      return {
        leaveType: r.leaveType,
        isHalfDay: r.isHalfDay,
        halfDaySession: r.halfDaySession ?? null,
      };
    }
  }
  return null;
}

function resolveWorkingHalf(leave: DayLeaveInfo | null): OfficePayrollWorkingHalf | 'NONE' {
  if (!leave) return 'FULL';
  if (!leave.isHalfDay) return 'NONE';
  if (leave.halfDaySession === 'MORNING') return 'AFTERNOON';
  if (leave.halfDaySession === 'AFTERNOON') return 'MORNING';
  return 'FULL';
}

const OFFICE_LEAVE_TYPE_SHORT: Record<OfficeLeaveType, string> = {
  SICK: 'ป่วย',
  PERSONAL: 'กิจ',
  VACATION: 'พักร้อน',
};

function leaveTypeShortTh(type: OfficeLeaveType): string {
  return OFFICE_LEAVE_TYPE_SHORT[type];
}

function leaveLine(leaveType: OfficeLeaveType): OfficeAttendanceGridLine {
  return { label: leaveTypeShortTh(leaveType), tone: 'leave' };
}

function timeLine(ms: number): OfficeAttendanceGridLine {
  return { label: formatBangkokHmFromUtcMs(ms), tone: 'time' };
}

function scanInTimeLine(
  ms: number,
  slot: 'morningIn' | 'afternoonIn',
  bounds: OfficeShiftMinuteBounds,
): OfficeAttendanceGridLine {
  const m = getBangkokMinutesOfDay(new Date(ms));
  const cutoff = slot === 'morningIn' ? bounds.morningLateCutoffMin : bounds.afternoonLateCutoffMin;
  const periodEnd = slot === 'morningIn' ? bounds.morningEndMin : bounds.afternoonEndMin;
  const label = formatBangkokHmFromUtcMs(ms);
  if (m > cutoff && m <= periodEnd) {
    return { label, tone: 'late' };
  }
  return { label, tone: 'time' };
}

function waitingLine(): OfficeAttendanceGridLine {
  return { label: 'รอสแกน', tone: 'waiting' };
}

function absentLine(): OfficeAttendanceGridLine {
  return { label: 'ขาด', tone: 'absent' };
}

function isScheduledWorkDay(
  ymd: string,
  weeklyRestPattern: WeeklyRestPatternForCalendar,
  calendarHolidays: CalendarHolidayEntry[],
): boolean {
  if (isBangkokWeeklyRestDayYmd(ymd, weeklyRestPattern)) return false;
  if (isHrSettingsCalendarHolidayYmd(ymd, calendarHolidays)) return false;
  return true;
}

type SlotKey = 'morningIn' | 'morningOut' | 'afternoonIn' | 'afternoonOut';

type DayScanPattern =
  | 'none'
  | 'two_punch_full'
  | 'morning_only'
  | 'afternoon_only'
  | 'four_punch'
  | 'partial';

function detectScanPattern(slots: FourScanSlots): DayScanPattern {
  const { morningInMs, morningOutMs, afternoonInMs, afternoonOutMs } = slots;
  if (!morningInMs && !morningOutMs && !afternoonInMs && !afternoonOutMs) return 'none';
  if (morningInMs && afternoonOutMs && !morningOutMs && !afternoonInMs) return 'two_punch_full';
  if (!morningInMs && afternoonInMs && afternoonOutMs && !morningOutMs) return 'afternoon_only';
  if (morningInMs && morningOutMs && !afternoonInMs && !afternoonOutMs) return 'morning_only';
  if (morningInMs && morningOutMs && afternoonInMs && afternoonOutMs) return 'four_punch';
  return 'partial';
}

function absenceCutoffMinutes(slot: SlotKey, bounds: OfficeShiftMinuteBounds): number {
  switch (slot) {
    case 'morningIn':
      /** ยังรอสแกนเข้าเช้าได้จนจบช่วงเช้า — ผ่อนผันใช้กับเวลาที่สแกนแล้วเท่านั้น */
      return bounds.morningEndMin;
    case 'morningOut':
      return bounds.afternoonStartMin;
    case 'afternoonIn':
      return bounds.afternoonLateCutoffMin;
    case 'afternoonOut':
      return bounds.afternoonEndMin;
  }
}

function slotExpectsScan(
  slot: SlotKey,
  workingHalf: OfficePayrollWorkingHalf | 'NONE',
  slots: FourScanSlots,
  pattern: DayScanPattern,
): boolean {
  if (workingHalf === 'NONE') return false;
  if (workingHalf === 'MORNING') {
    return slot === 'morningIn' || slot === 'morningOut';
  }
  if (workingHalf === 'AFTERNOON') {
    return slot === 'afternoonIn' || slot === 'afternoonOut';
  }

  switch (pattern) {
    case 'none':
      return slot === 'morningIn' || slot === 'afternoonOut';
    case 'two_punch_full':
      /** เช้าเข้า + เย็นออก — ไม่บังคับสแกนกลางวัน */
      return slot === 'morningIn' || slot === 'afternoonOut';
    case 'afternoon_only':
      /** เข้าบ่ายสายโดยไม่มีลาเช้า — นับขาดช่วงเช้า */
      return slot === 'morningIn' || slot === 'afternoonIn' || slot === 'afternoonOut';
    case 'morning_only':
      return slot === 'morningIn' || slot === 'morningOut';
    case 'four_punch':
      if (slot === 'morningIn' || slot === 'afternoonOut') return true;
      if (slot === 'morningOut') return slots.morningInMs != null;
      if (slot === 'afternoonIn') return slots.morningOutMs != null;
      return false;
    default:
      if (slot === 'morningIn' || slot === 'afternoonOut') return true;
      if (slot === 'morningOut') return slots.morningInMs != null;
      if (slot === 'afternoonIn') return slots.morningOutMs != null;
      return false;
  }
}

function missingScanLine(
  ymd: string,
  todayBangkokYmd: string,
  nowMinutes: number,
  slot: SlotKey,
  bounds: OfficeShiftMinuteBounds,
): OfficeAttendanceGridLine {
  if (ymd > todayBangkokYmd) return EMPTY_LINE;
  if (ymd < todayBangkokYmd) return absentLine();
  if (nowMinutes < absenceCutoffMinutes(slot, bounds)) return waitingLine();
  return absentLine();
}

function resolveSlotLine(params: {
  slot: SlotKey;
  scanMs: number | null;
  leaveOnSlot: boolean;
  leaveType: OfficeLeaveType | null;
  expectsScan: boolean;
  ymd: string;
  todayBangkokYmd: string;
  nowMinutes: number;
  bounds: OfficeShiftMinuteBounds | null;
  workingHalf: OfficePayrollWorkingHalf | 'NONE';
  slots: FourScanSlots;
  pattern: DayScanPattern;
}): OfficeAttendanceGridLine {
  if (params.leaveOnSlot && params.leaveType) return leaveLine(params.leaveType);
  if (params.scanMs != null) {
    if (
      params.bounds
      && (params.slot === 'morningIn' || params.slot === 'afternoonIn')
    ) {
      return scanInTimeLine(params.scanMs, params.slot, params.bounds);
    }
    return timeLine(params.scanMs);
  }
  if (!params.expectsScan) return DASH_LINE;
  if (!params.bounds) return absentLine();

  if (
    params.ymd === params.todayBangkokYmd
    && params.workingHalf === 'FULL'
    && params.slot === 'afternoonOut'
    && params.slots.afternoonOutMs == null
    && params.nowMinutes < params.bounds.afternoonStartMin
    && (params.pattern === 'none' || params.pattern === 'two_punch_full')
  ) {
    return DASH_LINE;
  }

  return missingScanLine(
    params.ymd,
    params.todayBangkokYmd,
    params.nowMinutes,
    params.slot,
    params.bounds,
  );
}

export function buildOfficeAttendanceGridDayCell(input: {
  dayRow: AttendanceDayEffectiveRow;
  dayPunches: AttendancePunchDoc[];
  staff: OfficeStaff;
  ymd: string;
  approvedLeaves: OfficeLeaveRequestDoc[];
  weeklyRestPattern: WeeklyRestPatternForCalendar;
  calendarHolidays: CalendarHolidayEntry[];
  todayBangkokYmd: string;
  monthlyWorkNorm: MonthlyWorkNormPolicyConfig;
  now?: Date;
}): OfficeAttendanceGridDayCell {
  const {
    dayRow,
    dayPunches,
    staff,
    ymd,
    approvedLeaves,
    weeklyRestPattern,
    calendarHolidays,
    todayBangkokYmd,
    monthlyWorkNorm,
    now = new Date(),
  } = input;

  const staffStartYmd = staff.startDate?.slice(0, 10);
  if (staffStartYmd && ymd < staffStartYmd) {
    return {
      morningIn: EMPTY_LINE,
      morningOut: EMPTY_LINE,
      afternoonIn: EMPTY_LINE,
      afternoonOut: EMPTY_LINE,
    };
  }

  const employmentEndYmd = staff.employmentEndDate?.slice(0, 10);
  if (employmentEndYmd && ymd > employmentEndYmd) {
    return {
      morningIn: EMPTY_LINE,
      morningOut: EMPTY_LINE,
      afternoonIn: EMPTY_LINE,
      afternoonOut: EMPTY_LINE,
    };
  }

  if (ymd > todayBangkokYmd) {
    return {
      morningIn: EMPTY_LINE,
      morningOut: EMPTY_LINE,
      afternoonIn: EMPTY_LINE,
      afternoonOut: EMPTY_LINE,
    };
  }

  const leave = approvedLeaveOnYmd(staff.id, ymd, approvedLeaves);
  const workingHalf = resolveWorkingHalf(leave);
  const bounds = officeShiftMinuteBounds(monthlyWorkNorm);
  const nowMinutes = getBangkokMinutesOfDay(now);
  const { ins, outs } = buildEffectivePunchLists(dayRow, dayPunches);
  const slots = assignFourScanSlots(ins, outs, bounds);
  const scanPattern = detectScanPattern(slots);

  const leaveMorning =
    workingHalf === 'NONE'
    || (leave?.isHalfDay === true && leave.halfDaySession === 'MORNING');
  const leaveAfternoon =
    workingHalf === 'NONE'
    || (leave?.isHalfDay === true && leave.halfDaySession === 'AFTERNOON');

  const isWorkingDay = isScheduledWorkDay(ymd, weeklyRestPattern, calendarHolidays);
  const appliesScan = officeStaffAppliesScanTimeDeductions(staff);

  const build = (
    slot: SlotKey,
    scanMs: number | null,
    leaveOnSlot: boolean,
  ): OfficeAttendanceGridLine => {
    const expectsScan =
      isWorkingDay
      && appliesScan
      && workingHalf !== 'NONE'
      && slotExpectsScan(slot, workingHalf, slots, scanPattern);

    return resolveSlotLine({
      slot,
      scanMs,
      leaveOnSlot,
      leaveType: leave?.leaveType ?? null,
      expectsScan,
      ymd,
      todayBangkokYmd,
      nowMinutes,
      bounds,
      workingHalf,
      slots,
      pattern: scanPattern,
    });
  };

  return {
    morningIn: build('morningIn', slots.morningInMs, leaveMorning),
    morningOut: build('morningOut', slots.morningOutMs, leaveMorning),
    afternoonIn: build('afternoonIn', slots.afternoonInMs, leaveAfternoon),
    afternoonOut: build('afternoonOut', slots.afternoonOutMs, leaveAfternoon),
  };
}

export function buildStaffAttendanceGridCellsByYmd(input: {
  staff: OfficeStaff;
  punches: AttendancePunchDoc[];
  dayRows: AttendanceDayEffectiveRow[];
  approvedLeaves: OfficeLeaveRequestDoc[];
  weeklyRestPattern: WeeklyRestPatternForCalendar;
  calendarHolidays: CalendarHolidayEntry[];
  todayBangkokYmd: string;
  monthlyWorkNorm: MonthlyWorkNormPolicyConfig;
  now?: Date;
}): Record<string, OfficeAttendanceGridDayCell> {
  const punchesByYmd = punchesGroupedByBangkokYmd(input.punches);
  const cells: Record<string, OfficeAttendanceGridDayCell> = {};
  for (const dayRow of input.dayRows) {
    cells[dayRow.ymd] = buildOfficeAttendanceGridDayCell({
      dayRow,
      dayPunches: punchesByYmd.get(dayRow.ymd) ?? [],
      staff: input.staff,
      ymd: dayRow.ymd,
      approvedLeaves: input.approvedLeaves,
      weeklyRestPattern: input.weeklyRestPattern,
      calendarHolidays: input.calendarHolidays,
      todayBangkokYmd: input.todayBangkokYmd,
      monthlyWorkNorm: input.monthlyWorkNorm,
      now: input.now,
    });
  }
  return cells;
}
