import type { JobMode } from './rbac';
import type { WorkerPaymentProfile } from './worker';
import type { RateConditionEventType } from './contracts';
import type { WhtTaxPaymentProofAttachment } from './tax';

/** Domain types: payroll (from master types.ts split). */

export type PayrollRunStatus = 
  | 'DRAFT'               // ฉบับร่าง
  | 'CALCULATED'          // คำนวณแล้ว (รอ workflow ถัดไป)
  | 'PROCESSING'          // กำลังคำนวณ
  | 'HR_REVIEW'           // รอฝ่ายบุคคลตรวจสอบ
  | 'HR_APPROVED'         // ฝ่ายบุคคลอนุมัติ
  | 'FINANCE_APPROVED'    // ฝ่ายการเงินอนุมัติจ่าย
  | 'PAID'                // จ่ายเงินแล้ว
  | 'LOCKED'              // ปิดงวดถาวร
  | 'CANCELLED';          // ยกเลิก

export type PayrollBatchStatus = 
  | 'DRAFT' 
  | 'GENERATED' 
  | 'HR_REVIEWED' 
  | 'HR_APPROVED' 
  | 'FINANCE_PREPARED' 
  | 'PAYMENT_EXPORTED' 
  | 'PAID' 
  | 'LOCKED';

// --- D8 Payroll Engine (lifecycle + policies; คู่กับ legacy status ด้านบน) ---

export type PayrollPolicyKind =
  | 'sso'
  | 'tax'
  | 'allowance_deduction'
  | 'monthly_work_norm'
  /** ตัวคูณ/ปฏิทินค่าจ้างลูกจ้างแบบกลาง — `payroll_policies/policy_worker_global_labor` */
  | 'worker_global_labor';

export type PayrollPolicyRecordStatus = 'draft' | 'active' | 'superseded' | 'archived';

/** นโยบายจ่ายเงินแบบ versioned — เก็บใน `payroll_policies` */

export interface PayrollPolicyRecord {
  id: string;
  kind: PayrollPolicyKind;
  name: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: PayrollPolicyRecordStatus;
  /** ใช้คู่กับ kind=tax / allowance_deduction เมื่อมีหลายชุด */
  appliesTo?: 'office' | 'worker' | 'all';
  config: Record<string, unknown>;
  createdAt?: number;
  updatedAt?: number;
}

/** สถานะชีวิต payroll แบบ D8 (camelCase) */

export type PayrollLifecycleStatus =
  | 'draft'
  | 'reviewed'
  | 'approved'
  | 'readyForFinance'
  | 'paid'
  | 'locked'
  | 'correction_required'
  | 'adjusted';

/** Snapshot ตอน generate — ห้ามคำนวณใหม่ตอนเปิดหน้า */

export interface PayrollLineD8Snapshot {
  engineVersion: string;
  asOfDate: string;
  policiesApplied: Array<{
    kind: PayrollPolicyKind;
    policyId: string;
    policyName: string;
    effectiveFrom: string;
  }>;
  rate?: { summary: string; conditionIds?: string[]; laborTermIds?: string[] };
  earningsComponents?: Record<string, number>;
  gross: number;
  deductions: Record<string, number>;
  net: number;
  frozenAt: number;
}

/** โหมดงานสำหรับต้นทุนค่าแรง (OPEC) — ไม่อ้าง main_contract/position_rates */

export type LaborCostWorkMode = 'onshore' | 'offshore';

export type LaborCostSourceKind =
  | 'position_default'
  | 'worker_custom'
  /** ฐานต้นทุนต่อตำแหน่งที่กำหนดบน main_contracts (เฟส A — ต่างกันระหว่างสัญญา) */
  | 'contract_position_baseline'
  /** ทะเบียนต้นทุนต่อสัญญา+ลูกค้า บน Position (`laborCostByContract`) */
  | 'position_contract_registry';

/**
 * Snapshot ตอน generate รอบเงิน — ฐานต้นทุน/อัตราแรง (ยึด worker + ตำแหน่ง/แหล่งอ้างอิง; `contract_position_baseline` อ่านค่าเดิมบนสนาม batch line)
 */

export interface LaborCostResolutionSnapshot {
  source: LaborCostSourceKind;
  positionId: string;
  workMode: LaborCostWorkMode;
  effectiveBaseRate: number;
  resolvedAt: number;
}

/** คำขอแก้ไขหลัง approve/paid — เก็บใน `payroll_correction_requests` */

export interface PayrollCorrectionRequest {
  id: string;
  scope: 'worker_batch' | 'office_run';
  targetBatchOrRunId: string;
  targetLineId?: string | null;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'applied';
  requestedByUserId: string;
  requestedByName: string;
  requestedAt: number;
  reviewedByUserId?: string;
  reviewedByName?: string;
  reviewedAt?: number;
  resolutionNotes?: string;
}

export type PayrollPeriodStatus = 'DRAFT' | 'OPEN' | 'PROCESSING' | 'LOCKED' | 'CLOSED';

export interface PayrollPeriod {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  cycleType: 'MONTHLY' | 'PARTIAL_START' | 'PARTIAL_END' | 'CUSTOM';
  status: PayrollPeriodStatus;
  generatedBy: string;
  generatedAt: number;
}

export interface PayrollRun {
  id: string;
  payrollRunNo: string;
  payrollPeriodStart: string;
  payrollPeriodEnd: string;
  payrollType: PayrollType;
  currency: string;
  status: PayrollRunStatus;
  workerCount: number;
  grossAmount: number;
  totalAllowance: number;
  totalDeduction: number;
  netAmount: number;
  sourceTimesheetBatchIds: string[];
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  updatedBy: string;
  hrApprovedAt?: number;
  hrApprovedBy?: string;
  financeApprovedAt?: number;
  financeApprovedBy?: string;
  lockedAt?: number;
  lockedBy?: string;
  notes?: string;
}

export type PayrollType = 'MONTHLY' | 'WAVE_BASED' | 'SPECIAL_RUN' | 'ADJUSTMENT' | 'SUPPLEMENTAL';

export interface PayrollLine {
  id: string;
  workerId: string;
  assignmentId: string;
  waveId: string;
  positionId: string;
  normalHours: number;
  otHours15: number;
  otHours20: number;
  otHours30: number;
  holidayHours: number;
  standbyDays: number;
  travelDays: number;
  unpaidDays: number;
  baseRateSnapshot: number;
  otRateSnapshot: number;
  allowanceSnapshot: number;
  deductionSnapshot: number;
  grossPay: number;
  totalAllowance: number;
  totalDeduction: number;
  netPay: number;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PayrollBatch {
  id: string;
  payrollPeriodId: string;
  batchType?: 'NORMAL' | 'SUPPLEMENTAL';
  workModeScope: 'onshore' | 'offshore' | 'mixed';
  status: PayrollBatchStatus;
  d8LifecycleStatus?: PayrollLifecycleStatus;
  totalWorkers: number;
  grossAmount: number;
  totalDeductions: number;
  netAmount: number;
  notes?: string;
  /** ฝ่ายเงินเดือนกดส่งขออนุมัติทำจ่าย → รอ operations / HR อนุมัติ */
  officerPayoutRequestBy?: string;
  officerPayoutRequestAt?: number;
  hrApprovedBy?: string;
  hrApprovedAt?: number;
  financePreparedBy?: string;
  financePreparedAt?: number;
  /** บัญชีไม่อนุมัติจ่าย — ส่งกลับฝ่ายเงินเดือนตรวจ (GENERATED) */
  financeRejectedBy?: string;
  financeRejectedAt?: number;
  financeRejectReason?: string;
  /** บัญชียืนยันจ่ายแล้ว — รายการ cashbook ที่สร้างอัตโนมัติ */
  financeCashbookEntryId?: string;
  /**
   * วันที่โอน/ตัดบัญชีจริง (yyyy-mm-dd) จาก cashbook ชุดล่าสุดเมื่อจ่ายครบ
   * — แหล่งหลักของ「วันที่จ่าย」บนสลิป (ไม่ใช้วันเตรียม/อนุมัติ HR)
   */
  financePayoutEntryDate?: string;
  /** บัญชีธนาคารที่ใช้ตัดจ่าย (ถ้าว่าง ระบบใช้บัญชี ACTIVE แรก) */
  payoutBankAccountId?: string;
  financeApprovedBy?: string;
  financeApprovedAt?: number;
  lockedBy?: string;
  lockedAt?: number;
  createdBy: string;
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
}

/** รูปแบบคำนวณ ภงด.1 หัก ณ ที่จ่าย สำหรับ worker line */

export type WorkerPitCalculationMode = 'manual_baht' | 'auto_timesheet' | 'auto_salary_base';

/** แยกค่าแรง work_day แพ็กสำหรับสลิป — snapshot ตอน generate/recalc (ผลรวมเท่า earningsBreakdown.work_day_package) */

export interface PayslipWorkDaySplit {
  normalDays: number;
  /** ค่าแรงฐานวันปกติ (ชม.ปกติในกรอบ 8 ชม. — ไม่รวม OT) */
  normalAmount: number;
  holidayDays: number;
  /** ค่าแรงฐานวันหยุด (ชม.ปกติในกรอบ 8 ชม. — ไม่รวม OT) */
  holidayAmount: number;
  /** รวม OT จาก work_day แพ็ก — ถ้าไม่มีฟิลด์นี้ (batch เก่า) ถือว่า normal/holiday รวม OT แล้ว */
  otAmount?: number;
  ot15Hours?: number;
  ot20Hours?: number;
  ot30Hours?: number;
  /** ชม.เกิน 8 ใน normalHours ที่คิดเป็น OT (แพ็ก 8 ชม.) */
  overflowNormalHours?: number;
  ot15Amount?: number;
  ot20Amount?: number;
  ot30Amount?: number;
  overflowOtAmount?: number;
  /** ชม.เกิน 12 ใน normalHours (แพ็ก 12 ชม. offshore) */
  overflowBeyond12Hours?: number;
  overflowBeyond12Amount?: number;
}

/** แยกค่าแรง work_day ตามตำแหน่ง — ผลรวมทุกแถวเท่า work_day_package */

export interface PayslipWorkDayPositionSplit extends PayslipWorkDaySplit {
  positionId: string;
  positionNameSnapshot: string;
  workMode?: string;
  /**
   * อัตราแพ็กต่อวันจริง (เช่น 1800 / 2600) — ใช้โชว์บนสลิป
   * แยกกลุ่มต่ออัตรา ห้ามเฉลี่ยข้ามอัตรา
   */
  packageRatePerDay?: number;
}

/** ปรับยอดรายคนใน batch (เงินพิเศษ / หักเพิ่ม / ภาษี ณ ที่จ่าย) — คำนวณ net ใหม่ตาม HR settings */
/**
 * แยกยอดเงินได้ตาม PO (และลูกค้า) ในงวดเดียว — ใช้แสดงสลิปใบเดียวหลายอัตรา/โครงการ (เฟส 3 payroll)
 */

export interface PayrollBatchIncomeSegment {
  purchaseOrderId: string;
  customerId?: string;
  poCodeSnapshot?: string;
  customerNameSnapshot?: string;
  grossAmount: number;
  eventBreakdown: Record<string, number>;
  earningsBreakdown: Record<string, number>;
  payslipWorkDaySplit?: PayslipWorkDaySplit | null;
  /** แยกค่าแรงตามตำแหน่งใน PO นี้ — ผลรวมเท่า work_day_package ของ segment */
  payslipWorkDayPositionSplits?: PayslipWorkDayPositionSplit[];
}

/** รายได้จากงวดที่ล็อคแล้ว — จ่ายเพิ่มในงวดถัดไป (เช่น OT ที่พลาดใน payroll เดือนก่อน) */

export interface PriorPeriodAllowanceItem {
  /** งวดต้นทาง YYYY-MM */
  sourceYearMonth: string;
  label: string;
  amount: number;
}

export interface HrPayrollLineAdjustments {
  allowanceItems: Array<{ label: string; amount: number }>;
  /** รายได้ย้อนหลังจากงวดที่ปิด payroll แล้ว — แสดงบนสลิปแยกพร้อมระบุงวดต้นทาง */
  priorPeriodAllowanceItems?: PriorPeriodAllowanceItem[];
  deductionItems: Array<{ label: string; amount: number }>;
  /**
   * รูปแบบ ภงด. — ถ้าไม่ระบุ (ข้อมูลเก่า) อนุมานจาก pitWithholdingOverride / pitWithholdingOverrideMaxMarginalRatePercent
   */
  workerPitMode?: WorkerPitCalculationMode | null;
  /**
   * ฐานเงินได้รายเดือน (บาท) เมื่อ workerPitMode = auto_salary_base — นำไปคำนวณ ภงด. ตาม th_pit_monthly_annualized ใน HR
   */
  pitAutoSalaryBaseBaht?: number | null;
  /** null = คำนวณ ภงด. รายเดือนตาม policy ใน HR settings จากยอดรวมหลังเบี้ยเลี้ยง หรือ (เมื่อ auto_salary_base) ไม่ใช้ */
  pitWithholdingOverride: number | null;
  /**
   * เมื่อ workerPitMode = auto_timesheet — คำนวณจากอัตรา marginal สูงสุด (0–35) หรือ null = ใช้เต็มตาราง
   * (รายการเก่าบางรายอาจมีค่าโดยไม่มี workerPitMode ให้อนุมานเป็น auto_timesheet + จำกัด marginal)
   */
  pitWithholdingOverrideMaxMarginalRatePercent?: number | null;
  notes?: string;
  updatedAt?: number;
  updatedBy?: string;
}

/** แถวรายวันบนบรรทัดงวด — snapshot ตอน generate/recalc */

export interface PayrollBatchLineDailyRowSnapshot {
  timesheetId: string;
  date: string;
  eventType: RateConditionEventType | string;
  workMode?: JobMode | string;
  /** ตำแหน่ง ณ วันนั้น — โชว์ Offshore - Fitter Foreman */
  positionId?: string;
  positionNameSnapshot?: string;
  normalHours: number;
  ot15Hours?: number;
  ot20Hours?: number;
  ot30Hours?: number;
  holidayHours?: number;
  amount: number;
  /**
   * วันหยุดตาม HR Settings ตอน generate — ใช้แยกค่าแรงวันหยุดบนสลิป
   * (นักขัตฤกษ์ / หยุดประจำสัปดาห์) ไม่ใช่แค่วันอาทิตย์จากปฏิทิน
   */
  restDayKind?: 'none' | 'public_holiday' | 'weekly_rest';
  purchaseOrderId?: string;
  remark?: string;
}

export interface PayrollBatchLine {
  id: string;
  payrollBatchId: string;
  /** UID บัญชีลูกจ้าง — ใช้ self-service / Firestore rules */
  subjectLinkedUserId?: string | null;
  workerId: string;
  workerNameSnapshot: string;
  workerPaymentProfileSnapshot: Partial<WorkerPaymentProfile>;
  assignmentIds: string[];
  sourceTimesheetIds: string[];
  periodStartDate: string;
  periodEndDate: string;
  eventBreakdown: Record<string, number>; // Maps eventType to count/units
  earningsBreakdown: Record<string, number>; // Maps specific earning category to amount
  /**
   * ยอดค่าแรงต่อ daily_timesheet id ณ ตอน generate/recalc
   * — หน้าดูรายวันใช้ค่านี้โดยไม่คำนวณสูตรสด
   */
  timesheetGrossById?: Record<string, number>;
  /**
   * แถวรายวัน snapshot ตอน generate/recalc — เปิดหน้ารายคนโชว์ทันทีโดยไม่โหลด daily_timesheets
   */
  dailyRowSnapshots?: PayrollBatchLineDailyRowSnapshot[];
  /**
   * ลองสร้าง snapshot รายวันให้งวดเก่า (ครั้งแรกที่เปิด) — matched = เก็บแล้ว, mismatch = ไม่เก็บเพราะยอดไม่ตรงของที่จ่าย
   */
  snapshotBackfillStatus?: 'matched' | 'mismatch';
  snapshotBackfillMismatchNote?: string | null;
  snapshotBackfillAttemptedAt?: number;
  snapshotBackfillComputedGross?: number;
  snapshotBackfillComputedNet?: number;
  deductionsBreakdown: Record<string, number>; // Maps specific deduction category to amount
  grossAmount: number;
  netAmount: number;
  d8Snapshot?: PayrollLineD8Snapshot;
  /** ฐานต้นทุนค่าแรง ณ generate — ใช้ต่อในเฟส 3+ (PayrollService) */
  laborCostResolutionSnapshot?: LaborCostResolutionSnapshot;
  exportStatus: 'pending' | 'exported' | 'failed';
  remarks?: string;
  /** ปรับเพิ่มเบี้ยเลี้ยง/หักพิเศษ/ภาษี — grossAmount ยังเป็นยอดจาก timesheet เดิม */
  hrLineAdjustments?: HrPayrollLineAdjustments | null;
  /** มีหลาย PO ที่มียอดในคนเดียว — แสดงรายได้แยกบนสลิป (ยังเป็นบรรทัดเดียวต่อคนต่อ batch) */
  incomeSegments?: PayrollBatchIncomeSegment[];
  /** เมื่อมี PO เดียว — แยกค่าแรงวันปกติ/วันหยุดสำหรับสลิป */
  payslipWorkDaySplit?: PayslipWorkDaySplit | null;
  /** แยกค่าแรงตามตำแหน่ง (หลายตำแหน่งในเดือนเดียวกัน) — ผลรวมเท่า work_day_package */
  payslipWorkDayPositionSplits?: PayslipWorkDayPositionSplit[];
  /** บัญชีตัดจ่ายแล้ว — ref cashbook ของชุดแถวนี้ (แบ่งจ่ายหลายบัญชีได้) */
  financePayoutCashbookEntryId?: string;
  financePayoutBankAccountId?: string;
  /** วันที่โอน/ตัดบัญชีจริง (yyyy-mm-dd) จาก cashbook ของชุดนี้ */
  financePayoutEntryDate?: string;
  financePaidAt?: number;
  /** จ่ายภาษีหัก ณ ที่จ่าย (ภงด.1) แล้ว — ref cashbook */
  whtTaxCashbookEntryId?: string;
  whtTaxCashbookEntryNo?: string;
  whtTaxPaidAt?: number;
  whtTaxPaidByUid?: string;
  whtTaxPaidByName?: string;
  whtTaxPaymentBankAccountId?: string;
  /**
   * true = บันทึกสถานะจ่ายภาษีแล้วโดยไม่ลง cashbook/ตัดบัญชี
   * (ใช้กับรายการที่จ่ายจริงไปแล้วช่วงระบบยังไม่สมบูรณ์)
   */
  whtTaxPaidWithoutCashbook?: boolean;
  /** หลักฐานการโอนภาษีหัก ณ ที่จ่าย — แนบตอนจ่ายภาษี */
  whtTaxPaymentProofAttachments?: WhtTaxPaymentProofAttachment[];
  /** นำส่งประกันสังคม (ฝั่งลูกจ้าง) แล้ว — ref cashbook */
  ssoRemitCashbookEntryId?: string;
  ssoRemitCashbookEntryNo?: string;
  ssoRemitPaidAt?: number;
  ssoRemitPaidByUid?: string;
  ssoRemitPaidByName?: string;
  ssoRemitPaymentBankAccountId?: string;
  /** หลักฐานการโอน ปกส.+สมทบ — แนบตอนจ่าย */
  ssoRemitPaymentProofAttachments?: WhtTaxPaymentProofAttachment[];
  /** จ่ายเงินสมทบฝั่งนายจ้างแล้ว — ref cashbook */
  ssoEmployerContribCashbookEntryId?: string;
  ssoEmployerContribCashbookEntryNo?: string;
  ssoEmployerContribPaidAt?: number;
  ssoEmployerContribPaidByUid?: string;
  ssoEmployerContribPaidByName?: string;
  ssoEmployerContribPaymentBankAccountId?: string;
}

/**
 * Batch for managing payment files for banks
 */

export type PaymentExportStatus = 'draft' | 'generated' | 'downloaded' | 'superseded';

export interface PaymentExportBatch {
  id: string;
  payrollBatchId: string;
  exportTemplateCode: string; // e.g., 'KBANK_PAYROLL_V1', 'SCB_DIRECT_DEBIT'
  companyBankAccountId: string;
  fileName?: string;
  fileUrl?: string;
  totalLines: number;
  totalAmount: number;
  status: PaymentExportStatus;
  generatedBy?: string;
  generatedAt?: number;
  createdBy: string;
  createdAt: number;
}

/**
 * Document Numbering Sequence tracking
 */

