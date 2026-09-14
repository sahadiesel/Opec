import type { ExecutiveNonPayrollIncomeType } from './staff';
import type { PayrollLifecycleStatus, PayrollLineD8Snapshot, PayrollRunStatus } from './payroll';
import type { WhtTaxPaymentProofAttachment } from './tax';

/** Domain types: office-payroll (from master types.ts split). */

/** โหมดภาษีหัก ณ ที่จ่ายรายบรรทัดงวดออฟฟิศ/ผู้บริหาร */
export type OfficePayrollPitMode = 'SYSTEM' | 'MANUAL_PERCENT' | 'MANUAL_AMOUNT';

/** ปรับยอดรายคนงวดพนักงานออฟฟิศ — รายรับเพิ่ม / หักเพิ่ม (คู่กับ D8 manual_ded_*) */
export interface OfficePayrollLineHrAdjustments {
  allowanceItems: Array<{ label: string; amount: number }>;
  deductionItems: Array<{ label: string; amount: number }>;
  notes?: string | null;
  updatedAt?: number;
  updatedBy?: string;
  /** ถ้า false = ไม่หักประกันสังคมในงวดนี้ (เช่น หักที่บริษัทอื่นแล้ว) — ค่าเริ่มต้นถือว่า true */
  deductSocialSecurity?: boolean;
  /** ค่าเริ่มต้น SYSTEM = คำนวณจากนโยบาย HR */
  pitMode?: OfficePayrollPitMode;
  pitManualPercent?: number | null;
  pitManualAmountBaht?: number | null;
  /** ชื่อประเภทรายได้สำหรับใบหัก ณ ที่จ่าย เมื่อเลือกหักแบบกำหนดเอง */
  pitManualIncomeLabel?: string | null;
  /** ประเภทรายได้ผู้บริหารนอกเงินเดือน — ใช้กำหนด ภ.ง.ด.1/ภ.ง.ด.2 และข้อความในหนังสือรับรอง */
  pitManualIncomeType?: ExecutiveNonPayrollIncomeType | null;
}

export interface OfficePayrollRun {
  id: string;
  payrollRunNo: string;
  payrollMonth: string; // YYYY-MM
  payrollPeriodStart: string;
  payrollPeriodEnd: string;
  status: PayrollRunStatus;
  /** D8 lifecycle — อ่านคู่กับ legacy `status` */
  d8LifecycleStatus?: PayrollLifecycleStatus;
  staffCount: number;
  grossAmount: number;
  totalAllowances: number;
  totalDeductions: number;
  netAmount: number;
  hrApprovedBy?: string;
  financeApprovedBy?: string;
  /** ฝ่ายเงินเดือน: ส่งให้ผู้จัดการอนุมัติ (CALCULATED → HR_REVIEW) */
  submittedForReviewBy?: string;
  submittedForReviewAt?: number;
  /** ผู้จัดการ/HR: อนุมัติหลังฝ่ายเงินเดือนส่ง (HR_REVIEW → HR_APPROVED) — เอกสารเก่าอาจมีแค่ hrApprovedBy */
  managerApprovedBy?: string;
  managerApprovedAt?: number;
  lockedAt?: number;
  /** บัญชีอนุมัติจ่ายแล้ว — รายการ cashbook ที่สร้างอัตโนมัติ */
  financeCashbookEntryId?: string;
  /** วันที่โอน/ตัดบัญชีจริง (yyyy-mm-dd) จาก cashbook — ใช้บนสลิปเป็นวันจ่าย */
  financePayoutEntryDate?: string;
  /** บัญชียืนยันตัดจ่าย (timestamp) */
  financeApprovedAt?: number;
  /** บัญชีธนาคารที่ใช้ตัดจ่าย (ถ้าว่าง ระบบใช้บัญชี ACTIVE แรก) */
  payoutBankAccountId?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface OfficePayrollLine {
  id: string;
  /** อ้างอิงงวด — ใช้ค้นประวัติสลิปจาก collection group */
  officePayrollRunId?: string;
  /** YYYY-MM — snapshot จากหัวงวด (My Profile / สลิป) */
  payrollMonth?: string;
  /** UID บัญชีพนักงาน — ใช้ self-service / Firestore rules */
  subjectLinkedUserId?: string | null;
  staffId: string;
  staffName: string;
  department: string;
  positionTitle: string;
  baseSalary: number;
  allowance: number;
  bonus: number;
  /** OT / income อื่น (ถ้ามี) — รวมใน gross ตอน D8 */
  overtimeAmount?: number;
  otherIncome?: number;
  /** ค่าทำงานวันหยุดจากสแกน (อาทิตย์/ปฏิทิน) — รวมใน otherIncome ตอน D8 */
  restDayWorkedAmount?: number;
  deductions: number;
  tax: number;
  socialSecurity: number;
  grossPay: number;
  netPay: number;
  d8Snapshot?: PayrollLineD8Snapshot;
  /** รายรับเพิ่ม / หักเพิ่ม — คำนวณรวมใน gross / deductions ผ่าน D8 */
  hrLineAdjustments?: OfficePayrollLineHrAdjustments | null;
  /** สรุปวันลาในงวด — snapshot ตอนคำนวณงวด */
  leaveSummary?: OfficePayrollLineLeaveSummaryRow[];
  /** สรุปหักสาย/ขาด/ลาไม่จ่าย — snapshot ตอนคำนวณงวด */
  attendanceSummary?: OfficePayrollLineAttendanceSummary | null;
  /** หักก่อนคำนวณภาษีจากสาย/ขาด/ลา — เก็บเพื่อคงยอดเมื่อ HR ปรับรายคน */
  periodPreStatutoryDeductions?: Array<{ code: string; amount: number }>;
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
  createdAt: number;
  updatedAt: number;
}

/** สรุปวันลาบนสลิปพนักงานออฟฟิศ */

export interface OfficePayrollLineLeaveSummaryRow {
  leaveType: 'SICK' | 'PERSONAL' | 'VACATION';
  entitlementDays: number;
  usedInPeriodDays: number;
  usedYtdDays: number;
  paidInPeriodDays: number;
  unpaidInPeriodDays: number;
  vacationEligible?: boolean;
  vacationEligibleFrom?: string | null;
}

/** สรุปหักจากเวลาเข้างาน/ลาไม่จ่าย */

export interface OfficePayrollLineAttendanceSummary {
  scanDeductionsApplied: boolean;
  lateMinutes: number;
  scanAbsenceDays: number;
  unpaidLeaveDays: number;
  lateDeductionAmount: number;
  scanAbsenceDeductionAmount: number;
  unpaidLeaveDeductionAmount: number;
  /** วันปฏิทินในงวดก่อนวันเริ่มจ้าง (หักเงินเดือนไม่เต็มเดือน — เงินเดือน÷30) */
  preEmploymentDays?: number;
  /** วันปฏิทินในงวดหลังวันสิ้นสุดการจ้าง */
  postEmploymentDays?: number;
  preEmploymentDeductionAmount?: number;
  postEmploymentDeductionAmount?: number;
  /** วันทำงานบนวันหยุด (จากสแกน) — สัดส่วนวัน เช่น 0.5 / 1 */
  restDayWorkedDays?: number;
  /** ยอดค่าทำงานวันหยุด */
  restDayWorkedPayAmount?: number;
}

/** งวดเงินเดือนผู้บริหาร — โครงเดียวกับ office แต่คนละคอลเลกชันและสิทธิ์เฉพาะบัญชี */

export type ExecutivePayrollRun = OfficePayrollRun;

export type ExecutivePayrollLine = OfficePayrollLine;

