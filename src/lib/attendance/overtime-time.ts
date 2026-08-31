import type { OfficeShiftMinuteBounds } from '@/lib/hr/monthly-work-norm-policy';

const TIME_RE = /^(\d{1,2}):(\d{2})$/;

function overlapMinutes(
  rangeStart: number,
  rangeEnd: number,
  blockStart: number,
  blockEnd: number,
): number {
  const start = Math.max(rangeStart, blockStart);
  const end = Math.min(rangeEnd, blockEnd);
  return Math.max(0, end - start);
}

/** แปลง HH:mm → นาทีจากเที่ยงคืน (null ถ้าผิดรูปแบบ) */
export function parseAttendanceHm(hm: string | null | undefined): number | null {
  if (!hm || typeof hm !== 'string') return null;
  const m = TIME_RE.exec(hm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mi) || h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return h * 60 + mi;
}

/** ปรับ input เป็น HH:mm มาตรฐาน */
export function normalizeAttendanceHmInput(hm: string | null | undefined): string | null {
  const min = parseAttendanceHm(hm);
  if (min === null) return null;
  const h = Math.floor(min / 60);
  const mi = min % 60;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

export function formatAttendanceHm(totalMin: number): string {
  const rem = ((totalMin % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(rem / 60);
  const mi = rem % 60;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

/** นาที OT ที่นับจริง — หักช่วงพักที่คล่อม (ถ้าระบุ bounds) */
export function otBillableMinutesFromHmRange(
  startHm: string,
  endHm: string,
  bounds?: OfficeShiftMinuteBounds | null,
): number | null {
  const startMin = parseAttendanceHm(startHm);
  const endMin = parseAttendanceHm(endHm);
  if (startMin === null || endMin === null || endMin <= startMin) return null;
  let billable = endMin - startMin;
  if (bounds && bounds.afternoonStartMin > bounds.morningEndMin) {
    billable -= overlapMinutes(
      startMin,
      endMin,
      bounds.morningEndMin,
      bounds.afternoonStartMin,
    );
  }
  return billable > 0 ? billable : null;
}

/** ชั่วโมง OT จากช่วงเวลา (end ต้องหลัง start ในวันเดียวกัน) — หักพักเมื่อส่ง bounds */
export function otHoursFromHmRange(
  startHm: string,
  endHm: string,
  bounds?: OfficeShiftMinuteBounds | null,
): number | null {
  const billable = otBillableMinutesFromHmRange(startHm, endHm, bounds);
  if (billable === null) return null;
  return Math.round((billable / 60) * 100) / 100;
}

export function formatAttendanceHmRange(startHm: string, endHm: string): string {
  const s = normalizeAttendanceHmInput(startHm) ?? startHm;
  const e = normalizeAttendanceHmInput(endHm) ?? endHm;
  return `${s} – ${e}`;
}

/** เปรียบเทียบช่วงเวลา HH:mm (หลัง normalize) */
export function isSameAttendanceHmRange(
  startA: string | null | undefined,
  endA: string | null | undefined,
  startB: string | null | undefined,
  endB: string | null | undefined,
): boolean {
  const sA = normalizeAttendanceHmInput(startA);
  const eA = normalizeAttendanceHmInput(endA);
  const sB = normalizeAttendanceHmInput(startB);
  const eB = normalizeAttendanceHmInput(endB);
  if (!sA || !eA || !sB || !eB) return false;
  return sA === sB && eA === eB;
}
