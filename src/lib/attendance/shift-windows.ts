import type { AttendancePunchDirection } from './types';

/** Timezone อ้างอิงสำหรับช่วงเวลาสแกน — ไม่มี DST จึงคำนวณตาม Bangkok ได้ตรง ๆ */
export const ATTENDANCE_TZ = 'Asia/Bangkok';

export type AttendanceShiftKey = 'morning' | 'midday' | 'evening';

export interface AttendanceShiftDescriptor {
  key: AttendanceShiftKey;
  /** นาทีของวัน (รวมขอบ) */
  startMinutes: number;
  /** นาทีของวัน (รวมขอบ) */
  endMinutes: number;
  labelTh: string;
  rangeLabelTh: string;
  /**
   * direction หลักของช่วง — 'IN' = เข้างาน, 'OUT' = ออกงาน, 'OUT_OR_LATE_IN' = OUT ถ้ามี IN เช้าแล้ว, ไม่งั้นรับเป็น IN สาย
   */
  primaryAction: 'IN' | 'OUT' | 'OUT_OR_LATE_IN';
}

/**
 * 3 ช่วงสแกน — ตาม policy ของ HR:
 * - morning: 05:00–10:00 → IN เท่านั้น
 * - midday : 10:01–15:00 → OUT (ถ้าเข้าเช้าแล้ว) หรือ IN สาย (ถ้ายังไม่ได้เข้า) พร้อมข้อความเตือนครึ่งเช้าหายไป
 * - evening: 15:01–23:59 → OUT เท่านั้น (ถ้าไม่เคยสแกนเข้าวันนี้ → แจ้งติดต่อ HR)
 * 00:00–04:59 = ปิดระบบสแกน
 */
export const ATTENDANCE_SHIFT_WINDOWS: AttendanceShiftDescriptor[] = [
  {
    key: 'morning',
    startMinutes: 5 * 60,
    endMinutes: 10 * 60,
    labelTh: 'ช่วงเช้า — สแกนเข้างาน',
    rangeLabelTh: '05:00–10:00',
    primaryAction: 'IN',
  },
  {
    key: 'midday',
    startMinutes: 10 * 60 + 1,
    endMinutes: 15 * 60,
    labelTh: 'ช่วงเที่ยง — สแกนออก/เข้าครึ่งบ่าย',
    rangeLabelTh: '10:01–15:00',
    primaryAction: 'OUT_OR_LATE_IN',
  },
  {
    key: 'evening',
    startMinutes: 15 * 60 + 1,
    endMinutes: 23 * 60 + 59,
    labelTh: 'ช่วงเย็น — สแกนออกงาน',
    rangeLabelTh: '15:01–24:00',
    primaryAction: 'OUT',
  },
];

interface BangkokDateParts {
  y: number;
  m: number;
  d: number;
  hour: number;
  minute: number;
}

function getBangkokParts(at: Date): BangkokDateParts {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: ATTENDANCE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || '0');
  return { y: get('year'), m: get('month'), d: get('day'), hour: get('hour'), minute: get('minute') };
}

/** นาทีของวันใน Asia/Bangkok ของเวลาที่กำหนด (เผื่อเครื่องผู้ใช้อยู่นอก TH) */
export function getBangkokMinutesOfDay(at: Date): number {
  const p = getBangkokParts(at);
  return p.hour * 60 + p.minute;
}

/** ขอบเขต epoch ms ของ "วันนี้" ตาม Bangkok (00:00–23:59:59.999 → ใช้ < endMs) */
export function getBangkokDayBoundsMs(at: Date): { startMs: number; endMs: number } {
  const p = getBangkokParts(at);
  const ymd = `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  const startMs = Date.parse(`${ymd}T00:00:00+07:00`);
  return { startMs, endMs: startMs + 24 * 60 * 60 * 1000 };
}

/** ค้น descriptor ตามเวลาปัจจุบัน — null = นอกช่วงสแกน (00:00–04:59) */
export function getCurrentAttendanceShift(at: Date): AttendanceShiftDescriptor | null {
  const m = getBangkokMinutesOfDay(at);
  return ATTENDANCE_SHIFT_WINDOWS.find((s) => m >= s.startMinutes && m <= s.endMinutes) ?? null;
}

/** สรุปสถานะการสแกนของ subject สำหรับวันหนึ่งจากรายการ punch ทั้งวัน */
export interface DailyPunchSummary {
  hasIn: boolean;
  hasOut: boolean;
  firstInAt: number | null;
  lastOutAt: number | null;
}

export function summarizeDailyPunches(
  punches: Array<{ direction: AttendancePunchDirection; punchedAt: number }>,
): DailyPunchSummary {
  let firstInAt: number | null = null;
  let lastOutAt: number | null = null;
  for (const p of punches) {
    if (p.direction === 'IN') {
      if (firstInAt === null || p.punchedAt < firstInAt) firstInAt = p.punchedAt;
    } else if (p.direction === 'OUT') {
      if (lastOutAt === null || p.punchedAt > lastOutAt) lastOutAt = p.punchedAt;
    }
  }
  return {
    hasIn: firstInAt !== null,
    hasOut: lastOutAt !== null,
    firstInAt,
    lastOutAt,
  };
}

export type MobileAttendanceUiState =
  | { kind: 'closed'; messageTh: string }
  | { kind: 'in_only'; disabledReasonTh: string | null; warningTh: string | null }
  | { kind: 'out_only'; disabledReasonTh: string | null }
  | { kind: 'evening_no_in'; messageTh: string };

/**
 * แมป shift + summary → state ของหน้าจอมือถือ
 * - morning: IN ได้ครั้งเดียว
 * - midday: ถ้ายังไม่มี IN → IN สายพร้อมเตือน, ถ้ามี IN แล้ว → OUT
 * - evening: ถ้ามี IN → OUT, ถ้าไม่มี IN → ปิดปุ่มและเตือนติดต่อ HR
 */
export function deriveMobileAttendanceUi(
  shift: AttendanceShiftDescriptor | null,
  summary: DailyPunchSummary,
): MobileAttendanceUiState {
  if (!shift) {
    return { kind: 'closed', messageTh: 'อยู่นอกช่วงเวลาสแกน (เปิดบริการ 05:00–24:00)' };
  }
  if (shift.key === 'morning') {
    return {
      kind: 'in_only',
      warningTh: null,
      disabledReasonTh: summary.hasIn ? 'คุณสแกนเข้างานในวันนี้แล้ว' : null,
    };
  }
  if (shift.key === 'midday') {
    if (!summary.hasIn) {
      return {
        kind: 'in_only',
        warningTh: 'การสแกนของคุณเป็นการสแกนเข้างานในช่วงบ่าย ซึ่งครึ่งวันเช้าไม่ได้เข้างาน',
        disabledReasonTh: null,
      };
    }
    return {
      kind: 'out_only',
      disabledReasonTh: summary.hasOut ? 'คุณสแกนออกงานในวันนี้แล้ว' : null,
    };
  }
  if (!summary.hasIn) {
    return {
      kind: 'evening_no_in',
      messageTh: 'วันนี้คุณไม่ได้มีการสแกนเข้า กรุณาติดต่อฝ่ายบุคคล',
    };
  }
  return {
    kind: 'out_only',
    disabledReasonTh: summary.hasOut ? 'คุณสแกนออกงานในวันนี้แล้ว' : null,
  };
}
