import type { AttendanceOvertimeRequestDoc, AttendanceOvertimeRequestStatus } from '@/lib/attendance/types';
import { otHoursFromHmRange } from '@/lib/attendance/overtime-time';

export type AttendanceOvertimeDayDisplay = {
  hours: number | null;
  status: AttendanceOvertimeRequestStatus | null;
};

const STATUS_RANK: Record<AttendanceOvertimeRequestStatus, number> = {
  APPROVED: 3,
  PENDING_MANAGER_APPROVAL: 2,
  REJECTED: 1,
  SUPERSEDED: 0,
};

function overtimeRequestDayKey(subjectKey: string, workDateYmd: string): string {
  return `${subjectKey}:${normalizeWorkDateYmd(workDateYmd)}`;
}

function normalizeWorkDateYmd(workDateYmd: string): string {
  return String(workDateYmd || '').trim().slice(0, 10);
}

/** Firestore number | Timestamp → epoch ms */
function requestEventMs(r: {
  requestedAt?: unknown;
  reviewedAt?: unknown;
}): number {
  const toMs = (v: unknown): number => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (v && typeof v === 'object') {
      const anyV = v as { toMillis?: () => number; seconds?: number };
      if (typeof anyV.toMillis === 'function') {
        const ms = anyV.toMillis();
        if (Number.isFinite(ms)) return ms;
      }
      if (typeof anyV.seconds === 'number' && Number.isFinite(anyV.seconds)) {
        return anyV.seconds * 1000;
      }
    }
    return 0;
  };
  return Math.max(toMs(r.reviewedAt), toMs(r.requestedAt));
}

function overtimeHoursFromRequest(request: AttendanceOvertimeRequestDoc): number | null {
  const startHm =
    request.status === 'APPROVED'
      ? (request.approvedOtStartHm ?? request.requestedOtStartHm)
      : request.requestedOtStartHm;
  const endHm =
    request.status === 'APPROVED'
      ? (request.approvedOtEndHm ?? request.requestedOtEndHm)
      : request.requestedOtEndHm;
  if (startHm && endHm) {
    const fromRange = otHoursFromHmRange(String(startHm), String(endHm));
    if (fromRange != null && fromRange > 0) return fromRange;
  }
  const hours = Number(
    request.status === 'APPROVED'
      ? (request.approvedOtHours ?? request.requestedOtHours)
      : request.requestedOtHours,
  );
  return Number.isFinite(hours) && hours > 0 ? hours : null;
}

/** Latest OT request per subject + calendar day — prefers approved over pending over rejected. */
export function latestOvertimeRequestBySubjectDay(
  requests: AttendanceOvertimeRequestDoc[],
): Map<string, AttendanceOvertimeRequestDoc> {
  const m = new Map<string, AttendanceOvertimeRequestDoc>();
  for (const r of requests) {
    if (r.status === 'SUPERSEDED') continue;
    const key = overtimeRequestDayKey(r.subjectKey, r.workDateYmd);
    const cur = m.get(key);
    if (!cur) {
      m.set(key, r);
      continue;
    }
    const rankDiff = (STATUS_RANK[r.status] ?? 0) - (STATUS_RANK[cur.status] ?? 0);
    if (rankDiff > 0 || (rankDiff === 0 && requestEventMs(r) > requestEventMs(cur))) {
      m.set(key, r);
    }
  }
  return m;
}

export function attendanceOvertimeHoursForRequest(
  request: AttendanceOvertimeRequestDoc | null | undefined,
): AttendanceOvertimeDayDisplay {
  if (!request) return { hours: null, status: null };
  if (request.status === 'REJECTED' || request.status === 'SUPERSEDED') {
    return { hours: null, status: request.status };
  }
  const hours = overtimeHoursFromRequest(request);
  if (request.status === 'APPROVED') {
    return { hours, status: 'APPROVED' };
  }
  return { hours, status: 'PENDING_MANAGER_APPROVAL' };
}

/**
 * รวมชั่วโมง OT ที่แสดงในตารางรายวันของเดือนนั้น — ใช้แหล่งเดียวกับคอลัมน์ ชม. OT
 * (กันยอดหัวตารางไม่ตรงกับผลรวมแถว)
 */
export function sumShownOvertimeHoursForSubjectDays(
  subjectKey: string,
  dayYmds: readonly string[],
  bySubjectDay: Map<string, AttendanceOvertimeRequestDoc>,
): number {
  let total = 0;
  for (const ymd of dayYmds) {
    const disp = attendanceOvertimeHoursForRequest(
      bySubjectDay.get(overtimeRequestDayKey(subjectKey, ymd)),
    );
    if (disp.hours != null) total += disp.hours;
  }
  return Math.round(total * 100) / 100;
}

/**
 * รวมชั่วโมง OT ที่อนุมัติแล้วต่อคน — ใช้เฉพาะคำขอล่าสุดต่อวัน
 * และนับเฉพาะวันในเดือนที่ระบุ (workDateYmd) ถ้ามี payrollMonth
 */
export function sumApprovedOvertimeHoursForSubject(
  subjectKey: string,
  requests: AttendanceOvertimeRequestDoc[],
  payrollMonth?: string,
): number {
  const monthPrefix = payrollMonth?.slice(0, 7);
  const latestByDay = new Map<string, AttendanceOvertimeRequestDoc>();
  for (const r of requests) {
    if (r.subjectKey !== subjectKey || r.status !== 'APPROVED') continue;
    const ymd = normalizeWorkDateYmd(r.workDateYmd);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
    if (monthPrefix && ymd.slice(0, 7) !== monthPrefix) continue;
    const cur = latestByDay.get(ymd);
    if (!cur || requestEventMs(r) >= requestEventMs(cur)) latestByDay.set(ymd, r);
  }
  let total = 0;
  for (const r of latestByDay.values()) {
    const hours = overtimeHoursFromRequest(r);
    if (hours != null) total += hours;
  }
  return Math.round(total * 100) / 100;
}

export function formatAttendanceOvertimeHours(hours: number): string {
  const rounded = Math.round(hours * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, '');
}
