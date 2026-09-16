import type { JobMode } from './rbac';
import type { WaveMonthTimesheetPhotoAttachment } from './misc';

/** Domain types: worker (from master types.ts split). */

/** Readiness Status for Workers (ลูกจ้าง) */
export type ReadinessStatus = 
  | 'READY'               // พร้อมปฏิบัติงาน
  | 'INCOMPLETE'          // ข้อมูลไม่ครบถ้วน
  | 'MISSING_CERTIFICATE' // ใบเซอร์บังคับตามตำแหน่งยังไม่ครบ
  | 'MEDICAL_EXPIRED'     // ใบรับรองแพทย์หมดอายุ
  | 'DRUG_TEST_EXPIRED'   // ผลตรวจสารเสพติดหมดอายุ
  | 'DOCUMENT_EXPIRED'    // เอกสารระบุตัวตนหมดอายุ
  | 'BLOCKED';            // ระงับการส่งตัว (วินัย/อื่นๆ)

/** สถานะเบิก PPE/อุปกรณ์ตามงานมอบหมาย (ไม่ใช่ readinessStatus — ใช้แสดงคำเตือน/แท็บคลัง) */
export type WorkerStoreEquipmentReadiness = 'na' | 'pending' | 'complete';

export type PositionRequirementKind = 'ppe' | 'tool';

/** Employment Status for Workers (ลูกจ้าง) */
export type WorkerStatus = 
  | 'AVAILABLE'           // ว่างงาน/พร้อมรับงาน
  | 'ASSIGNED'            // มอบหมายงานแล้ว
  | 'ON_SITE'             // ปฏิบัติงานหน้างาน
  | 'ON_LEAVE'            // พักร้อน/พักกะ
  | 'INACTIVE'            // พ้นสภาพ
  | 'BLACKLISTED';        // บัญชีดำ

/** รายการสารในแผงตรวจ — ตั้งค่าที่ system/drug_test_panel */
export interface DrugTestPanelSubstance {
  id: string;
  label: string;
}

export interface DrugTestPanelConfig {
  substances: DrugTestPanelSubstance[];
  updatedAt: number;
  updatedBy?: string;
}

export type DrugTestLocationType = 'OPEC' | 'OTHER';

export type DrugTestResult = 'none' | 'negative' | 'positive';

export type DrugTestScreeningConclusion = 'pass' | 'fail';

/** ผลต่อชุดตรวจในรอบบันทึกเดียวกัน */

export interface WorkerDrugTestKitResult {
  substanceKey: string;
  substanceLabelSnapshot: string;
  result: DrugTestResult;
}

/** ทะเบียนชื่อธนาคาร — ในฟอร์มพนักงาน/ลูกจ้างใช้เฉพาะ `nameTh` */

export interface BankNameCatalogItem {
  id: string;
  nameTh: string;
  /** @deprecated ไม่ใช้ใน UI — คงได้ในเอกสารเก่า */
  nameEn?: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

/** ทะเบียนโรงพยาบาลประกันสังคม — ในฟอร์มใช้เฉพาะชื่อ (`nameTh`) */

export interface SsoHospitalCatalogItem {
  id: string;
  nameTh: string;
  /** ที่อยู่ (แสดงในทะเบียนเท่านั้น ไม่ดึงไปฟอร์มพนักงาน) */
  address?: string;
  /** เบอร์โทร */
  phone?: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Worker {
  id: string;
  workerCode: string;
  firstName: string;
  lastName: string;
  nickname?: string;
  thaiNationalId: string;
  passportNo?: string;
  dateOfBirth: number;
  nationality: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  contactPhone: string;
  /** อีเมลสำหรับล็อกอิน — ใช้ได้จริงหลัง HR กด Activate และสร้างบัญชีใน Firebase Auth */
  email?: string;
  /** เวลาที่เปิดใช้ล็อกอินด้วยอีเมลครั้งล่าสุด (timestamp ms) */
  loginEmailActivatedAt?: number;
  address?: string;
  currentPositionId: string;
  jobMode: JobMode;
  workerStatus: WorkerStatus;
  readinessStatus: ReadinessStatus;
  /** HR ปิด «พร้อม» ชั่วคราว — เอกสารยังเขียวแต่ไม่ให้มอบหมายจนกว่าจะเปิดสวิตช์ */
  readinessManualHold?: boolean;
  /** เหตุผลเมื่อตั้งไม่พร้อมทำงาน: ลาออก / พักงาน / เจ็บป่วย / อื่นๆ */
  readinessManualHoldReason?: 'RESIGNED' | 'SUSPENDED' | 'SICK' | 'OTHER';
  /** ระบุเพิ่มเมื่อเหตุผลเป็น อื่นๆ */
  readinessManualHoldReasonNote?: string;
  readinessManualHoldReasonAt?: number;
  readinessManualHoldReasonByUserId?: string;
  /** สรุปจากงานมอบหมายที่เปิด: คลังยังต้องเบิก PPE/อุปกรณ์หรือไม่ */
  storeEquipmentReadiness?: WorkerStoreEquipmentReadiness;
  complianceAlertLevel?: 'ok' | 'warning' | 'blocked';
  nearestExpiryInDays?: number | null;
  nearestExpiryAt?: number | null;
  /** สรุปแผงสารเสพติดสำหรับแดชบอร์ด (อัปเดตจากหน้ารายละเอียดคนงาน) */
  drugPanelSummaryKind?: 'pending' | 'partial' | 'pass' | 'positive' | 'none_panel';
  drugPanelSummaryText?: string;
  drugPanelPassedCount?: number;
  /** ผลตรวจสารเสพติด valid สำหรับ mob (อัปเดตจากหน้ารายละเอียดคนงาน) */
  drugPanelMobValid?: boolean;
  totalWorkedHours?: number;
  /** ชม.สแตนบายสะสม (SB / M1 / D1) — แยกจากชั่วโมงทำงาน */
  totalStandbyHours?: number;
  firstWorkedAt?: number | null;
  lastWorkedAt?: number | null;
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountName?: string;
  /** โรงพยาบาลประกันสังคม (ถ้ามีการแจ้งเข้า สปส.) */
  socialSecurityHospital?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  skills: string[];
  notes?: string;
  disciplinaryNotes?: string;
  /** เชื่อมบัญชี Firebase Auth สำหรับพอร์ทัลพนักงาน / เบิกล่วงหน้า */
  linkedUserId?: string;
  /**
   * ต้นทุนค่าแรง: `true` / undefined = ยึด `defaultLaborCost*` ของ Position ตาม `currentPositionId` ทุกงาน/สัญญา
   * `false` = ใช้ `laborCostCustom*` ทุกที่
   */
  laborCostUsePositionDefault?: boolean;
  laborCostCustomOnshore?: number;
  laborCostCustomOffshore?: number;
  /**
   * ค่าตำแหน่งเพิ่มเติม (บาท/วัน) ฝั่งต้นทุนจ่าย — หลังได้ฐานต้นทุนต่อวันตามเส้นทาง payroll เดิมแล้ว จะบวกจำนวนนี้เข้าไป (ไม่เกี่ยวราคาขายลูกค้า)
   * ไม่ระบุหรือ 0 = ไม่บวกเพิ่ม · ไม่บวกเมื่อใช้ override ต้นทุนรายคน (`laborCostCustom*`)
   */
  positionAllowanceDailyBaht?: number;
  /** audit — migration เฟส 1 จาก main contract เดียว */
  laborCostMigratedFromMainContractId?: string;
  laborCostMigratedAt?: number;
  /** ลูกค้าในรายการนี้สามารถเปิดดูโปรไฟล์/เอกสารคนงานในพอร์ทัลได้ (จำกัดสิทธิ์ใน Firestore rules) */
  assignedCustomerIds?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface PositionCertificateRequirement {
  id: string;
  templateId?: string;
  requirementType?: 'certificate' | 'document';
  certificateName: string;
  certificateCode: string;
  required: boolean;
  validityMonths: number;
  hasExpiry?: boolean;
  notes?: string;
  /** รหัสกลุ่มทางเลือก — มีใบใดใบหนึ่งในกลุ่มเดียวกันก็ผ่าน (OR) */
  alternativeGroupKey?: string;
  /** ชื่อแสดงกลุ่ม OR เช่น Offshore Safety */
  alternativeGroupLabel?: string;
}

export interface WorkerDocumentCatalogItem {
  id: string;
  itemName: string;
  itemCode: string;
  requirementType: 'certificate' | 'document';
  hasExpiry: boolean;
  defaultValidityMonths?: number;
  alertBeforeExpiryDays?: number;
  blockBeforeExpiryDays?: number;
  description?: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PositionPPERequirement {
  id: string;
  itemName: string;
  itemCode: string;
  quantityDefault: number;
  required: boolean;
  notes?: string;
  /** อ้างอิงทะเบียน store — เมื่อมีจะใช้จับคู่เบิกแทนแค่ชื่อ/รหัส */
  storeItemId?: string;
  storeCategory?: string;
  /** รหัสกลุ่มเดียวกับ `store_items.variantGroupKey` — โควต้า `quantityDefault` นับรวมทุก SKU ในกลุ่ม */
  variantGroupKey?: string;
  variantSpecification?: string;
}

export interface PositionToolRequirement {
  id: string;
  itemName: string;
  itemCode: string;
  itemType: 'tool' | 'equipment' | 'consumable';
  quantityDefault: number;
  allowed: boolean;
  notes?: string;
  /** Firestore id of `store_items` — primary link when issuing from store catalog */
  storeItemId?: string;
  /** Denormalized from `store_items.category` at save time */
  storeCategory?: string;
  /** ขนาด/รุ่น จากทะเบียน store (ถ้ามี) */
  variantSpecification?: string;
  variantGroupKey?: string;
}

export interface WorkerWaveAcceptance {
  id: string;
  waveId: string;
  assignmentId: string;
  workerId: string;
  customerId: string;
  customerPortalUserId?: string | null;
  status: 'pending' | 'accepted' | 'rejected' | 'replacement_requested';
  remark?: string | null;
  approvedDate?: string | null;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface WorkerPaymentProfile {
  id: string;
  workerId: string;
  paymentMethod: 'BANK_TRANSFER' | 'CASH' | 'PROMPTPAY' | 'OTHER';
  bankCode?: string | null;
  bankName?: string | null;
  accountName?: string | null;
  accountNumber?: string | null;
  branchName?: string | null;
  promptPayId?: string | null;
  isPrimary: boolean;
  effectiveDate: string;
  endDate?: string | null;
  attachmentUrl?: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'PENDING_VERIFICATION';
  createdBy?: string;
  updatedBy?: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorkerCertificate {
  id: string;
  certificateName: string;
  certificateCode: string;
  certificateNo?: string;
  issueDate: number;
  expiryDate: number;
  status: 'valid' | 'expired' | 'revoked';
  attachment?: WaveMonthTimesheetPhotoAttachment;
  _path?: string; // Optional for internal routing
}

export interface WorkerMedicalRecord {
  id: string;
  medicalType: string;
  examDate: number;
  expiryDate: number;
  fitStatus: 'fit' | 'unfit' | 'conditional';
  hospitalOrClinic?: string;
  status?: string;
  recordDate?: string;
  /** รูปหรือ PDF แนบผลตรวจ */
  attachment?: WaveMonthTimesheetPhotoAttachment;
  _path?: string;
}

export interface WorkerDrugTest {
  id: string;
  /** อ้างอิง id จาก DrugTestPanelSubstance — ชุดแรกของรอบ (compat รายการเก่า / mob) */
  substanceKey?: string;
  substanceLabelSnapshot?: string;
  testDate: number | null;
  testLocationType?: DrugTestLocationType;
  /** เมื่อ testLocationType === OTHER */
  testLocationOther?: string;
  result: DrugTestResult;
  /** ชุดที่ติ๊กรอบนี้ พร้อมผลรายชุด */
  kitResults?: WorkerDrugTestKitResult[];
  bodyTemperatureC?: number | null;
  bloodPressureSystolic?: number | null;
  bloodPressureDiastolic?: number | null;
  alcoholMgPercent?: number | null;
  conclusion?: DrugTestScreeningConclusion;
  recordedByName?: string;
  recordedByUserId?: string;
  recordedAt?: number;
  updatedByName?: string;
  updatedByUserId?: string;
  updatedAt?: number;
  /** @deprecated ไม่ใช้แล้ว — ข้อมูลเก่าเท่านั้น */
  expiryDate?: number;
  /** @deprecated ใช้ testLocationType / testLocationOther */
  laboratory?: string;
  /** รูปถ่าย/แนบผลตรวจ (thumbnail ในตาราง) — รายการเก่าไฟล์เดียว */
  attachment?: WaveMonthTimesheetPhotoAttachment;
  /** รูป/ไฟล์แนบรอบนี้ สูงสุด 5 */
  attachments?: WaveMonthTimesheetPhotoAttachment[];
  /** เวลาบันทึกเอกสาร — ใช้เรียงลำดับล่าสุด */
  createdAt?: number;
  _path?: string;
}

export interface WorkerDocument {
  id: string;
  documentType: string;
  documentNo: string;
  issueDate: number;
  expiryDate: number;
  attachment?: WaveMonthTimesheetPhotoAttachment;
  _path?: string;
}

/** ข้ามเกณฑ์ใบเซอร์/เอกสารตามตำแหน่ง — ไม่บล็อก readiness (มีเหตุผลบันทึกไว้) */

export interface WorkerRequirementSkip {
  id: string;
  requirementId: string;
  certificateCode: string;
  certificateName?: string;
  requirementType?: 'certificate' | 'document';
  /** เมื่อข้ามทั้งกลุ่ม OR */
  alternativeGroupKey?: string;
  reason: string;
  skippedAt: number;
  skippedByUserId?: string;
  positionId?: string;
  _path?: string;
}

