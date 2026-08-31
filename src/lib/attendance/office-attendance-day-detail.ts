import type {
  AttendanceCorrectionRequestDoc,
  AttendanceCorrectionRequestStatus,
  AttendanceOvertimeRequestDoc,
} from '@/lib/attendance/types';
import type { OfficeLeaveRequestDoc } from '@/lib/leaves/types';

const CORRECTION_STATUS_LABELS: Record<AttendanceCorrectionRequestStatus, string> = {
  PENDING_MANAGER_APPROVAL: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ไม่อนุมัติ',
};

export function attendanceCorrectionStatusLabelTh(
  status: AttendanceCorrectionRequestStatus,
): string {
  return CORRECTION_STATUS_LABELS[status];
}

export function leaveRequestsForStaffYmd(
  leaves: OfficeLeaveRequestDoc[],
  staffId: string,
  ymd: string,
): OfficeLeaveRequestDoc[] {
  const day = ymd.slice(0, 10);
  return leaves.filter((r) => {
    if (r.staffId !== staffId) return false;
    const start = r.startDate.slice(0, 10);
    const end = r.endDate.slice(0, 10);
    return day >= start && day <= end;
  });
}

export function correctionRequestsForSubjectDay(
  requests: AttendanceCorrectionRequestDoc[],
  subjectKey: string,
  ymd: string,
): AttendanceCorrectionRequestDoc[] {
  const day = ymd.slice(0, 10);
  return requests
    .filter((r) => r.subjectKey === subjectKey && r.workDateYmd.slice(0, 10) === day)
    .sort((a, b) => b.requestedAt - a.requestedAt);
}

export function overtimeRequestsForSubjectDay(
  requests: AttendanceOvertimeRequestDoc[],
  subjectKey: string,
  ymd: string,
): AttendanceOvertimeRequestDoc[] {
  const day = ymd.slice(0, 10);
  return requests
    .filter((r) => r.subjectKey === subjectKey && r.workDateYmd.slice(0, 10) === day)
    .sort((a, b) => b.requestedAt - a.requestedAt);
}
