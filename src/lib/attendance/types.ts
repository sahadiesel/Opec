export type AttendanceSubjectType = 'worker' | 'office_staff';

export type AttendancePunchDirection = 'IN' | 'OUT';

export type AttendanceCorrectionRequestStatus =
  | 'PENDING_MANAGER_APPROVAL'
  | 'APPROVED'
  | 'REJECTED';

/** OT ใช้สถานะเดียวกับ correction + SUPERSEDED เมื่อถูกแทนที่ด้วยคำขอแก้ไข */
export type AttendanceOvertimeRequestStatus =
  | AttendanceCorrectionRequestStatus
  | 'SUPERSEDED';

/** Stored at `attendance_overtime_requests/{id}` */
export type AttendanceOvertimeRequestDoc = {
  id: string;
  subjectType: AttendanceSubjectType;
  subjectId: string;
  subjectNameSnapshot: string;
  subjectKey: string;
  payrollMonth: string;
  workDateYmd: string;
  /** ชั่วโมง OT ที่ขอ (คำนวณจากช่วงเวลา หรือกรอก legacy) */
  requestedOtHours: number;
  /** เวลาเริ่ม OT ที่ขอ HH:mm */
  requestedOtStartHm?: string | null;
  /** เวลาสิ้นสุด OT ที่ขอ HH:mm */
  requestedOtEndHm?: string | null;
  /**
   * ชั่วโมง OT เดิมที่มีอยู่ก่อนคำขอแก้ไข (ถ้ามี)
   * — null/undefined = คำขอ OT ใหม่ ไม่ใช่การแก้ตัวเลขเดิม
   */
  previousOtHours?: number | null;
  /** ช่วงเวลา OT เดิมก่อนขอแก้ไข (ถ้ามี) */
  previousOtStartHm?: string | null;
  previousOtEndHm?: string | null;
  /** ชั่วโมง OT ที่ผู้จัดการอนุมัติ */
  approvedOtHours?: number | null;
  /** เวลาเริ่ม OT ที่อนุมัติ HH:mm */
  approvedOtStartHm?: string | null;
  /** เวลาสิ้นสุด OT ที่อนุมัติ HH:mm */
  approvedOtEndHm?: string | null;
  /** snapshot ตอนอนุมัติ */
  monthlySalarySnapshot?: number;
  hourlyRateSnapshot?: number;
  otMultiplierSnapshot?: number;
  otPayAmountSnapshot?: number;
  otPaySegmentsSnapshot?: Array<{
    category: string;
    startHm: string;
    endHm: string;
    hours: number;
    multiplier: number;
    amount: number;
    label: string;
  }>;
  reason: string;
  status: AttendanceOvertimeRequestStatus;
  requestedByUid: string;
  requestedByName?: string;
  requestedAt: number;
  reviewedByUid?: string;
  reviewedByName?: string;
  reviewedAt?: number;
  rejectReason?: string;
};

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
  /** Snapshot before request (null = no punch that day) — legacy first in / last out */
  previousInAtMs: number | null;
  previousOutAtMs: number | null;
  proposedInAtMs: number | null;
  proposedOutAtMs: number | null;
  previousMorningInAtMs?: number | null;
  previousMorningOutAtMs?: number | null;
  previousAfternoonInAtMs?: number | null;
  previousAfternoonOutAtMs?: number | null;
  proposedMorningInAtMs?: number | null;
  proposedMorningOutAtMs?: number | null;
  proposedAfternoonInAtMs?: number | null;
  proposedAfternoonOutAtMs?: number | null;
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
  effectiveMorningInAtMs?: number | null;
  effectiveMorningOutAtMs?: number | null;
  effectiveAfternoonInAtMs?: number | null;
  effectiveAfternoonOutAtMs?: number | null;
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
