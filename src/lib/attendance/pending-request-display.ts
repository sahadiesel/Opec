import type {
  AttendanceCorrectionRequestDoc,
  AttendanceCorrectionRequestStatus,
  AttendanceOvertimeRequestDoc,
} from '@/lib/attendance/types';

type AttendanceRequestStatus = AttendanceCorrectionRequestStatus;

const STATUS_RANK: Record<AttendanceRequestStatus, number> = {
  APPROVED: 3,
  PENDING_MANAGER_APPROVAL: 2,
  REJECTED: 1,
};

function subjectDayKey(subjectKey: string, workDateYmd: string): string {
  return `${subjectKey}:${workDateYmd.slice(0, 10)}`;
}

function latestRequestBySubjectDay<T extends { subjectKey: string; workDateYmd: string; status: AttendanceRequestStatus; requestedAt: number }>(
  requests: T[],
): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of requests) {
    const key = subjectDayKey(r.subjectKey, r.workDateYmd);
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

export function latestCorrectionRequestBySubjectDay(
  requests: AttendanceCorrectionRequestDoc[],
): Map<string, AttendanceCorrectionRequestDoc> {
  return latestRequestBySubjectDay(requests);
}

/** Pending approval notes shown in the attendance day table. */
export function attendanceDayPendingNotes(opts: {
  correction?: AttendanceCorrectionRequestDoc | null;
  overtime?: AttendanceOvertimeRequestDoc | null;
}): string[] {
  const notes: string[] = [];
  if (opts.correction?.status === 'PENDING_MANAGER_APPROVAL') {
    notes.push('รออนุมัติแก้ไขเวลา');
  }
  if (opts.overtime?.status === 'PENDING_MANAGER_APPROVAL') {
    notes.push('รออนุมัติ OT');
  }
  return notes;
}
