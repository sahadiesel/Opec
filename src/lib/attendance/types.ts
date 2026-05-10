export type AttendanceSubjectType = 'worker' | 'office_staff';

export type AttendancePunchDirection = 'IN' | 'OUT';

export type AttendanceCorrectionRequestStatus =
  | 'PENDING_MANAGER_APPROVAL'
  | 'APPROVED'
  | 'REJECTED';

/** Stored at `attendance_correction_requests/{id}` */
export type AttendanceCorrectionRequestDoc = {
  id: string;
  subjectType: AttendanceSubjectType;
  subjectId: string;
  subjectNameSnapshot: string;
  /** `${subjectType}:${subjectId}` */
  subjectKey: string;
  /** YYYY-MM (Bangkok month of {@link workDateYmd}) */
  payrollMonth: string;
  /** YYYY-MM-DD Bangkok */
  workDateYmd: string;
  /** Snapshot before request (null = no punch that day) */
  previousInAtMs: number | null;
  previousOutAtMs: number | null;
  proposedInAtMs: number | null;
  proposedOutAtMs: number | null;
  previousInPunchId?: string | null;
  previousOutPunchId?: string | null;
  reason: string;
  status: AttendanceCorrectionRequestStatus;
  requestedByUid: string;
  requestedByName?: string;
  requestedAt: number;
  reviewedByUid?: string;
  reviewedByName?: string;
  reviewedAt?: number;
  rejectReason?: string;
};

/** Stored at `attendance_day_overrides/{id}` — doc id from {@link attendanceDayOverrideDocId} */
export type AttendanceDayOverrideDoc = {
  id: string;
  subjectType: AttendanceSubjectType;
  subjectId: string;
  subjectKey: string;
  payrollMonth: string;
  workDateYmd: string;
  effectiveInAtMs: number | null;
  effectiveOutAtMs: number | null;
  correctionRequestId: string;
  appliedAt: number;
  appliedByUid: string;
  appliedByName?: string;
};

/** Stored at `attendance_punches/{autoId}` */
export type AttendancePunchDoc = {
  subjectType: AttendanceSubjectType;
  subjectId: string;
  subjectNameSnapshot: string;
  direction: AttendancePunchDirection;
  /** Epoch ms */
  punchedAt: number;
  linkedUserId: string;
  kioskToken: string;
  source: 'kiosk_mobile';
  /** Epoch ms */
  createdAt: number;
};

/** Stored at `attendance_kiosk_sessions/{token}` — doc id is the opaque token */
export type AttendanceKioskSessionDoc = {
  /** Epoch ms — must be > server time when punch is written */
  expiresAt: number;
  active: boolean;
  createdByUid: string;
  /** Epoch ms */
  createdAt: number;
  /** Epoch ms — ตั้งทันทีหลังสแกนสำเร็จ (single-use): กันใช้โค้ดเดิมสแกนซ้ำ */
  consumedAt?: number;
  consumedByUid?: string;
  consumedSubjectType?: AttendanceSubjectType;
  consumedSubjectId?: string;
  consumedDirection?: AttendancePunchDirection;
};

/** `hr_configuration/office_leave_entitlements` */
export type OfficeLeaveEntitlementsDoc = {
  /** วันลากิจต่อปี (พนักงานออฟฟิศ) */
  personalDaysPerYear: number;
  /** วันลาป่วยต่อปี */
  sickDaysPerYear: number;
  /** วันลาพักร้อนต่อปี */
  annualVacationDaysPerYear: number;
  updatedAt: number;
  updatedByUid?: string;
};
