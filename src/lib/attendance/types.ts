export type AttendanceSubjectType = 'worker' | 'office_staff';

export type AttendancePunchDirection = 'IN' | 'OUT';

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
