import type { AttendanceOvertimeRequestDoc, AttendanceOvertimeRequestStatus } from '@/lib/attendance/types';

export type AttendanceOvertimeDayDisplay = {
  hours: number | null;
  status: AttendanceOvertimeRequestStatus | null;
};

const STATUS_RANK: Record<AttendanceOvertimeRequestStatus, number> = {
  APPROVED: 3,
  PENDING_MANAGER_APPROVAL: 2,
  REJECTED: 1,
};

function overtimeRequestDayKey(subjectKey: string, workDateYmd: string): string {
  return `${subjectKey}:${workDateYmd.slice(0, 10)}`;
}

/** Latest OT request per subject + calendar day — prefers approved over pending over rejected. */
export function latestOvertimeRequestBySubjectDay(
  requests: AttendanceOvertimeRequestDoc[],
): Map<string, AttendanceOvertimeRequestDoc> {
  const m = new Map<string, AttendanceOvertimeRequestDoc>();
  for (const r of requests) {
    const key = overtimeRequestDayKey(r.subjectKey, r.workDateYmd);
    const cur = m.get(key);
    if (!cur) {
      m.set(key, r);
      continue;
    }
    const rankDiff = STATUS_RANK[r.status] - STATUS_RANK[cur.status];
    if (rankDiff > 0 || (rankDiff === 0 && r.requestedAt > cur.requestedAt)) {
      m.set(key, r);
    }
  }
  return m;
}

export function attendanceOvertimeHoursForRequest(
  request: AttendanceOvertimeRequestDoc | null | undefined,
): AttendanceOvertimeDayDisplay {
  if (!request) return { hours: null, status: null };
  if (request.status === 'REJECTED') return { hours: null, status: 'REJECTED' };
  if (request.status === 'APPROVED') {
    const hours = Number(request.approvedOtHours ?? request.requestedOtHours);
    return {
      hours: Number.isFinite(hours) && hours > 0 ? hours : null,
      status: 'APPROVED',
    };
  }
  const hours = Number(request.requestedOtHours);
  return {
    hours: Number.isFinite(hours) && hours > 0 ? hours : null,
    status: 'PENDING_MANAGER_APPROVAL',
  };
}

export function sumApprovedOvertimeHoursForSubject(
  subjectKey: string,
  requests: AttendanceOvertimeRequestDoc[],
): number {
  let total = 0;
  for (const r of requests) {
    if (r.subjectKey !== subjectKey || r.status !== 'APPROVED') continue;
    const hours = Number(r.approvedOtHours ?? r.requestedOtHours);
    if (Number.isFinite(hours) && hours > 0) total += hours;
  }
  return Math.round(total * 100) / 100;
}

export function formatAttendanceOvertimeHours(hours: number): string {
  const rounded = Math.round(hours * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, '');
}
