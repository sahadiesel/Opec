import type { OfficeStaff } from '@/lib/types';

export type OfficeLeaveType = 'SICK' | 'PERSONAL' | 'VACATION';

export type OfficeLeaveStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export type OfficeLeaveHalfDaySession = 'MORNING' | 'AFTERNOON';

/**
 * `leave_requests/{autoId}` — ใบลาของพนักงานออฟฟิศ
 * พนักงาน(employee_self) สร้างผ่านหน้า My Profile, HR/payroll lead/manager อนุมัติจาก /hr/leaves
 */
export interface OfficeLeaveRequestDoc {
  /** linked office_staff.id (subjectId) */
  staffId: string;
  /** snapshot ชื่อตอนสร้าง — กันชื่อเปลี่ยนแล้วประวัติเสีย */
  staffNameSnapshot: string;
  /** snapshot แผนก — ใช้แสดงในตารางสรุป/อนุมัติโดยไม่ต้อง re-fetch */
  staffDepartmentSnapshot?: string;
  /** ผูก users/{uid} ของผู้ลา (มี = ผู้ลายื่นเอง) */
  staffLinkedUserId?: string;
  leaveType: OfficeLeaveType;
  /** ISO date `YYYY-MM-DD` */
  startDate: string;
  /** ISO date `YYYY-MM-DD` (เท่ากับ startDate ถ้าครึ่งวัน) */
  endDate: string;
  /** จำนวนวันคำนวณตอนสร้าง — รายงานสรุป/โควตาใช้ค่านี้โดยตรง */
  days: number;
  reason: string;
  isHalfDay: boolean;
  halfDaySession?: OfficeLeaveHalfDaySession | null;
  /** ปี ค.ศ. ของ startDate — ใช้กรอง/นับโควตาต่อปี */
  year: number;
  status: OfficeLeaveStatus;
  /** ผู้สร้างเอกสาร — uid (ปกติ = staffLinkedUserId; แอดมินเมื่อสร้างให้คนอื่น) */
  createdByUid: string;
  createdByName?: string;
  createdAt: number;
  updatedAt: number;
  approvedByUid?: string;
  approvedByName?: string;
  approvedAt?: number;
  rejectedByUid?: string;
  rejectedByName?: string;
  rejectedAt?: number;
  rejectReason?: string;
  cancelledAt?: number;
  cancelledByUid?: string;
}

/** เผื่อโควตาวันลาแยกตามประเภท — เก็บผลคำนวณสะสมต่อปีของพนักงานหนึ่งคน */
export interface OfficeLeaveYearSummary {
  staff: OfficeStaff;
  year: number;
  approvedDays: Record<OfficeLeaveType, number>;
  pendingDays: Record<OfficeLeaveType, number>;
  /** วันสิทธิ์ (จากตั้งค่า HR; ลาพักร้อน = 0 หากยังทำงาน <365 วัน) */
  entitlement: Record<OfficeLeaveType, number>;
}
