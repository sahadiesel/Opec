import type { JobMode } from './rbac';
import type { MobDayChargeKind } from './mobilization';
import type { RateConditionEventType } from './contracts';
import type { WaveMonthTimesheetPhotoAttachment } from './misc';

/** Domain types: timesheet (from master types.ts split). */

export interface DailyTimesheet {
  id: string;
  /** Portal / billing scope — denormalized from wave or PO */
  customerId?: string;
  date: string;
  workerId: string;
  workerNameSnapshot: string;
  assignmentId: string;
  waveId: string;
  contractId: string;
  /** Optional link to labor cost contract term for payroll costing */
  laborCostContractTermId?: string;
  purchaseOrderId: string;
  /** กลุ่ม PO Active (ลูกค้า + on/off) — สำหรับรายงาน / invoice / payroll */
  poActiveBundleId?: string;
  poLineId: string;
  siteId: string;
  positionId: string;
  workMode: JobMode;
  eventType: RateConditionEventType;
  shiftType: 'DAY' | 'NIGHT' | 'MIXED' | 'STANDBY';
  normalHours: number;
  ot15Hours?: number;
  ot20Hours?: number;
  ot30Hours?: number;
  holidayHours?: number;
  standbyUnits?: number;
  travelUnits?: number;
  mobUnits?: number;
  demobUnits?: number;
  paidLeaveUnits?: number;
  unpaidLeaveUnits?: number;
  quantityOverride?: number;
  remark?: string;
  /**
   * ค่าคิดเงินแยกฝั่งจากวัน Pre-Mob/Mob (Final clearance) —
   * ถ้ามี ให้ใช้แทน eventType หลักตอนวางบิล / จ่ายเงินเดือน
   */
  mobBillingChargeKind?: MobDayChargeKind;
  mobBillingChargeHours?: number;
  mobBillingM1AmountOverride?: number;
  mobPayrollChargeKind?: MobDayChargeKind;
  mobPayrollChargeHours?: number;
  mobPayrollM1AmountOverride?: number;
  /** เฟส 4 — แถวที่สร้าง/ซิงค์อัตโนมัติจาก PO workflow (ให้ job อัปเดตได้; แถวที่ไม่มี flag นี้ถือว่าแก้มือ) */
  poActiveAutoDaily?: boolean;
  /** Denormalized จาก mobilization — แยกช่วงรอบ/ไซต์ (เฟส 0+) */
  mobCycleId?: string;
  /** คีย์ไซต์เดียวกับ mobilization.mobLocationKey เมื่อมี */
  mobLocationKey?: string;
  status: DailyTimesheetStatus;
  // Readiness flags
  readyForPayroll: boolean;
  readyForBilling: boolean;
  
  // Metadata for Paper-first/Portal flow
  approvalSource?: 'PORTAL' | 'PAPER';
  evidenceConfirmedBy?: string;
  evidenceConfirmedAt?: number;
  clientApprovedBy?: string;
  clientApprovedAt?: number;
  
  // Paper-first Evidence Fields
  sourceType?: 'PAPER' | 'DIGITAL';
  sourceDocumentNo?: string;
  sourceDocumentDate?: string;
  supervisorSignedBy?: string;
  supervisorSignedDate?: string;
  clientSignedBy?: string;
  clientSignedDate?: string;
  officeEnteredBy?: string;
  officeEnteredAt?: number;
  managerApprovedBy?: string;
  managerApprovedAt?: number;
  lockedForPayrollAt?: number;
  lockedForBillingAt?: number;
  evidenceFileUrl?: string;
  /** ล็อกเพราะลูกค้าอนุมัติ billing (draft invoice) — ห้ามแก้ไขหลังนี้ */
  billingLockedByTaxInvoiceId?: string;

  createdAt: number;
  updatedAt: number;
  lockedAt?: number;
  lockedBy?: string;
  /** ยอดที่ล็อกตอนเข้า payroll — คำนวณใหม่ต้องคงยอดนี้ถ้าวันนั้นจ่ายไปแล้ว */
  payrollLockedGrossBaht?: number;
}

export type TimesheetRetroAdjustmentStatus = 'approved' | 'applied' | 'void';

/**
 * แก้ไขย้อนหลังบนใบงานที่ล็อคแล้ว — ไม่แก้ daily_timesheets ต้นทาง
 * แสดงบนตารางรายเดือนรวมกับของเดิม + เครื่องหมายว่าเป็นการแก้ไข
 */

export interface TimesheetRetroAdjustment {
  id: string;
  sourceTimesheetId: string;
  workerId: string;
  workerNameSnapshot: string;
  assignmentId: string;
  purchaseOrderId: string;
  waveId?: string;
  workDateYmd: string;
  /** งวดปฏิทินของใบงานต้นทาง YYYY-MM */
  sourceYearMonth: string;
  /** งวด payroll ที่ตั้งใจจ่าย YYYY-MM */
  applyPayrollYearMonth: string;
  /** ชม. OT / standby ที่เพิ่มจากฐานสลิป (delta ในเอกสาร — UI ใส่ยอดรวมแล้วคำนวณส่วนต่าง) */
  addedOt15Hours?: number;
  addedOt20Hours?: number;
  addedOt30Hours?: number;
  addedStandbyHours?: number;
  /** รอบ M1/D1 ที่เพิ่ม (ต่อ trip จากตารางอัตรา) */
  addedM1Trips?: number;
  addedD1Trips?: number;
  /** ประเภทวันที่แก้ (เมื่อไม่มีใบงานต้นทาง — แสดงบนตาราง) */
  retroEventType?: RateConditionEventType;
  reason: string;
  status: TimesheetRetroAdjustmentStatus;
  /** ยอดจ่ายที่คำนวณจากสูตร payroll ณ เวลาบันทึก (บาท) */
  computedPayAmountBaht?: number;
  computedPaySnapshotAt?: number;
  requestedByUserId: string;
  requestedByName: string;
  requestedAt: number;
  appliedAt?: number;
  appliedPayrollBatchId?: string;
  payrollWorkerLineId?: string;
  updatedAt: number;
}

/**
 * ส่งตรวจ timesheet รอบเดือนต่อ Wave — Payroll/Officer ส่งจากหน้าสรุปรายเดือน
 * ให้ Operations/HR Manager อนุมัติก่อนนำไปคำนวณ payroll / ออก Draft Invoice
 */

/**
 * รูปก่อนส่งผู้จัดการ — เก็บแยกจนกว่าจะส่งตรวจ (doc id = waveId_yyyy-MM)
 */

export interface WaveMonthTimesheetPhotoBundle {
  id: string;
  waveId: string;
  poId: string;
  yearMonth: string;
  attachments: WaveMonthTimesheetPhotoAttachment[];
  updatedAt: number;
}

export type WaveMonthTimesheetReviewStatus =
  | 'entry_locked'
  | 'partially_closed'
  | 'pending_manager_review'
  | 'partially_approved'
  | 'approved'
  | 'rejected';

/** สถานะการตรวจของลูกค้าบน portal (หลัง OPEC manager อนุมัติแล้ว) */

export type PortalCustomerTimesheetApprovalStatus =
  | 'pending'
  | 'approved'
  | 'correction_requested';

/** สถานะปิดงวดรายคนต่อ PO+เดือน — collection `worker_month_timesheet_closures` */

export type WorkerMonthClosureStatus =
  | 'open'
  | 'deferred'
  | 'entry_locked'
  | 'pending_manager_review'
  | 'approved'
  | 'rejected';

export interface WorkerMonthTimesheetClosure {
  id: string;
  poId: string;
  /** yyyy-MM */
  yearMonth: string;
  workerId: string;
  workerName?: string;
  status: WorkerMonthClosureStatus;
  deferredReason?: 'awaiting_ship_timesheet' | 'other';
  deferredNote?: string;
  deferredAt?: number;
  closureBatchNo?: number;
  /**
   * ช่วงวันที่ปิดงวดจ่ายแล้วในเดือนนี้ — ปิดได้หลายรอบ
   * วันที่อยู่นอกช่วงยังแก้และปิดงวดรอบถัดไปได้
   * ไม่มีฟิลด์ = ข้อมูลเก่า ล็อกทั้งเดือน
   */
  closedDateRanges?: Array<{
    startYmd: string;
    endYmd: string;
    billingReleased?: boolean;
    /** ออกใบแจ้งหนี้แล้ว — ช่วงที่ยังไม่มีค่านี้ส่งออกบิลรอบถัดไปได้ */
    billedInvoiceId?: string;
  }>;
  entryLockedAt?: number;
  entryLockedByUserId?: string;
  entryLockedByName?: string;
  submittedAt?: number;
  submittedByUserId?: string;
  submittedByName?: string;
  reviewedAt?: number;
  reviewedByUserId?: string;
  reviewedByName?: string;
  reviewNote?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * เอกสาร timesheet รวมรายเดือน (หนึ่งฉบับต่อเดือน) — เลขที่ `timesheetNo` จาก `number_sequences` key `monthly_timesheet` (Prefix TS-)
 * ใช้เป็นเลขอ้างอิงส่งอนุมัติ/ลูกค้า/วางบิล แทนการอ้างรหัส Wave (WV-) ในขบวนการนี้
 * คอลเลกชัน `monthly_timesheet_documents` id = yyyy-MM
 */

export interface MonthlyTimesheetDocument {
  id: string;
  /** yyyy-MM */
  yearMonth: string;
  timesheetNo: string;
  createdAt: number;
  updatedAt: number;
  createdByUserId?: string;
}

/**
 * แนบรูป/PDF คู่เอกสาร timesheet รวมรายเดือน (เลข TS-) — ไม่ผูก PO
 * `monthly_timesheet_photo_bundles/{yyyy-MM}`
 */

export interface MonthlyTimesheetPhotoBundle {
  id: string;
  /** yyyy-MM */
  yearMonth: string;
  attachments: WaveMonthTimesheetPhotoAttachment[];
  updatedAt: number;
}

/**
 * หัวเอกสาร timesheet รายเดือนแยกตามลูกค้า × โหมดงาน (Onshore / Offshore)
 * — เฟส 2 PO workflow · id = `{customerId}__{yyyy-MM}__ONSHORE|OFFSHORE` · collection `customer_month_timesheet_documents`
 */

export interface CustomerMonthTimesheetDocument {
  id: string;
  customerId: string;
  /** yyyy-MM */
  yearMonth: string;
  workMode: JobMode;
  /** เลขอ้างอิงฉบับ (CTX-) — คนละใบต่อคู่ลูกค้า+โหมดในเดือนเดียวกัน */
  timesheetNo?: string;
  customerNameSnapshot?: string;
  createdAt: number;
  updatedAt: number;
  createdByUserId?: string;
}

export interface WaveMonthTimesheetReview {
  id: string;
  waveId: string;
  poId: string;
  /** yyyy-MM */
  yearMonth: string;
  /**
   * entry_locked = Officer ปิดงวดลงเวลาแล้ว (ล็อกแก้ไข) แต่ยังไม่ส่งผู้จัดการ
   * pending_manager_review = ส่งคิวอนุมัติ
   * approved = ผู้จัดการอนุมัติ → ระบบตั้ง readyForPayroll ตามช่วงงวด
   */
  status: WaveMonthTimesheetReviewStatus;
  /** ช่วงวันที่รวมในงวดปิด (ค่าเริ่มต้น: วันที่ 1 – สิ้นเดือนของ yearMonth) */
  periodStartDate?: string;
  periodEndDate?: string;
  submittedAt: number;
  submittedByUserId: string;
  submittedByName?: string;
  entryLockedAt?: number;
  entryLockedByUserId?: string;
  entryLockedByName?: string;
  reviewedAt?: number;
  reviewedByUserId?: string;
  reviewedByName?: string;
  reviewNote?: string;
  /** รูปถ่าย timesheet ที่แนบตอนส่งผู้จัดการ (คัดลอกจาก bundle ตอนกดส่ง) */
  timesheetPhotoAttachments?: WaveMonthTimesheetPhotoAttachment[];
  /** ลูกค้ายืนยัน / ร้องขอแก้ไข บน client portal (ไม่เปลี่ยน status ภายใน OPEC) */
  customerApprovalStatus?: PortalCustomerTimesheetApprovalStatus;
  customerApprovedAt?: number;
  customerApprovedByUid?: string;
  customerApprovedByName?: string;
  customerApprovalSource?: 'CLIENT_PORTAL';
  customerRevisionRequestedAt?: number;
  customerRevisionRequestNote?: string;
  customerRevisionIssueId?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * เอกสาร timesheet รอบเดือนหลัก ต่อ PO (รวมทุก wave ใน PO นั้น / เดือนนั้น) — ใช้อ้างอิง payroll / แนบ PDF / ใบแจ้งหนี้
 * เอกสาร id = `poId_yyyy-MM` (collection `po_month_timesheet_reviews`)
 * รายวันใน `daily_timesheets` ยังมี waveId ตาม field — แต่การ "ปิดงวด" ทางเอกสารอ้าง PO+เดือน
 */
/**
 * แนบรูป/PDF คั่นก่อนส่งผู้จัดการ — คอลเลกชัน `po_month_timesheet_photo_bundles` id = เดียวกับ `po_month_timesheet_reviews` (poId_yyyy-MM)
 */

export interface PoMonthTimesheetPhotoBundle {
  id: string;
  poId: string;
  yearMonth: string;
  attachments: WaveMonthTimesheetPhotoAttachment[];
  updatedAt: number;
}

export interface PoMonthTimesheetReview {
  id: string;
  poId: string;
  /** yyyy-MM */
  yearMonth: string;
  status: WaveMonthTimesheetReviewStatus;
  periodStartDate?: string;
  periodEndDate?: string;
  submittedAt: number;
  submittedByUserId: string;
  submittedByName?: string;
  entryLockedAt?: number;
  entryLockedByUserId?: string;
  entryLockedByName?: string;
  reviewedAt?: number;
  reviewedByUserId?: string;
  reviewedByName?: string;
  reviewNote?: string;
  timesheetPhotoAttachments?: WaveMonthTimesheetPhotoAttachment[];
  /** wave ที่กินเวลาใน PO+เดือนนี้ (สรุปจากฝั่ง client ตอนสร้างคิว) */
  relatedWaveIds?: string[];
  /** ลูกค้ายืนยัน / ร้องขอแก้ไข บน client portal (ไม่เปลี่ยน status ภายใน OPEC) */
  customerApprovalStatus?: PortalCustomerTimesheetApprovalStatus;
  customerApprovedAt?: number;
  customerApprovedByUid?: string;
  customerApprovedByName?: string;
  customerApprovalSource?: 'CLIENT_PORTAL';
  customerRevisionRequestedAt?: number;
  customerRevisionRequestNote?: string;
  customerRevisionIssueId?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * หัวงวด timesheet ราย **PO + รอบเดือน + สถานที่** (workLocation จาก po_lines) — เฟส B: รอรับรายละเอียด/รายวัน
 * สร้างอัตโนมัติแม้ยังไม่มี wave หรือคน assign; `daily_timesheets` รุ่นใหม่อาจอ้าง id นี้ในอนาคต
 * collection: `po_location_month_timesheets`
 */

export type PoLocationMonthShellStatus = 'planning' | 'active' | 'closed';

export interface PoLocationMonthTimesheet {
  id: string;
  poId: string;
  customerId: string;
  contractId: string;
  poCodeSnapshot?: string;
  projectNameSnapshot?: string;
  /** yyyy-MM */
  yearMonth: string;
  /** ค่าหลัง normalize จาก workLocation บน po line */
  locationKey: string;
  locationLabel?: string;
  status: PoLocationMonthShellStatus;
  sourcePoLineIds?: string[];
  createdAt: number;
  updatedAt: number;
  createdByUserId?: string;
  createdByName?: string;
}

export type DailyTimesheetStatus = 
  | 'DRAFT' 
  | 'SUBMITTED' 
  | 'OPS_REVIEWED' 
  | 'HR_APPROVED'
  | 'CLIENT_APPROVED' 
  | 'VERIFIED_PAPER' 
  | 'LOCKED' 
  | 'REJECTED' 
  | 'CORRECTION_REQUIRED';

