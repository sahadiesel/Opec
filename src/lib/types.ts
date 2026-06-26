
/**
 * OPEC OpsFlow - Master TypeScript Data Models
 * Refined for Production Readiness with clear Staff vs Worker separation.
 */

export type DeptType = 'admin' | 'hr' | 'operations' | 'sales' | 'accounting' | 'store' | 'client';

/** Org / profile tier (PermissionProfile and legacy {@link User.level}). */
export type AccessLevel = 'viewer' | 'officer' | 'manager' | 'admin';

/** Job Policy Modes */
export type JobMode = 'ONSHORE' | 'OFFSHORE';

export type RoleType = 
  | 'system_admin'
  | 'payroll_officer'
  | 'accounting_officer'
  | 'accounting_manager'
  | 'sales_officer'
  | 'sales_manager'
  | 'hr_manager'
  | 'hr_officer'
  | 'operations_officer'
  | 'operations_manager'
  | 'timekeeper'
  | 'store_officer'
  | 'client_user'
  | 'employee_self'
  | 'executive'; 

export type BusinessRoleKey = 
  | 'system_admin'
  | 'payroll_officer'
  | 'sales_manager'
  | 'sales_officer'
  | 'hr_manager'
  | 'hr_officer'
  | 'operations_manager'
  | 'operations_officer'
  | 'timekeeper'
  | 'accounting_manager'
  | 'accounting_officer'
  | 'store_officer'
  | 'client_user'
  | 'employee_self'
  | 'executive';

/** Readiness Status for Workers (ลูกจ้าง) */
export type ReadinessStatus = 
  | 'READY'               // พร้อมปฏิบัติงาน
  | 'INCOMPLETE'          // ข้อมูลไม่ครบถ้วน
  | 'MISSING_CERTIFICATE' // ขาดใบรับรองบังคับ
  | 'MEDICAL_EXPIRED'     // ใบรับรองแพทย์หมดอายุ
  | 'DRUG_TEST_EXPIRED'   // ผลตรวจสารเสพติดหมดอายุ
  | 'DOCUMENT_EXPIRED'    // เอกสารระบุตัวตนหมดอายุ
  | 'BLOCKED';            // ระงับการส่งตัว (วินัย/อื่นๆ)

/** สถานะเบิก PPE/อุปกรณ์ตามงานมอบหมาย (ไม่ใช่ readinessStatus — ใช้แสดงคำเตือน/แท็บคลัง) */
export type WorkerStoreEquipmentReadiness = 'na' | 'pending' | 'complete';

export type PositionRequirementKind = 'ppe' | 'tool';

/** บรรทัดความครบเบิกต่อ mobilization + รายการในตำแหน่ง — เก็บใต้ `mobilizations/{id}/fulfillment_lines` */
export type RequirementFulfillmentLineStatus = 'PENDING' | 'PARTIAL' | 'ISSUED' | 'WAIVED' | 'RETURNED';

export interface MobilizationRequirementFulfillmentLine {
  id: string;
  kind: PositionRequirementKind;
  positionRequirementId: string;
  quantityRequired: number;
  quantityIssued: number;
  status: RequirementFulfillmentLineStatus;
  storeItemId?: string;
  lastIssueSlipId?: string;
  lastIssueNo?: string;
  waivedAt?: number;
  waivedBy?: string;
  returnedAt?: number;
  updatedAt: number;
  updatedBy?: string;
}

/** Employment Status for Workers (ลูกจ้าง) */
export type WorkerStatus = 
  | 'AVAILABLE'           // ว่างงาน/พร้อมรับงาน
  | 'ASSIGNED'            // มอบหมายงานแล้ว
  | 'ON_SITE'             // ปฏิบัติงานหน้างาน
  | 'ON_LEAVE'            // พักร้อน/พักกะ
  | 'INACTIVE'            // พ้นสภาพ
  | 'BLACKLISTED';        // บัญชีดำ

/** Deployment/Mobilization Status */
export type DeploymentStatus = 
  | 'DRAFT'               // ร่างรายการ
  | 'READINESS_CHECK'     // อยู่ระหว่างตรวจความพร้อม
  | 'CLIENT_SUBMITTED'    // ส่งรายชื่อให้ลูกค้าพิจารณา
  | 'CLIENT_APPROVED'     // ลูกค้าอนุมัติแล้ว
  | 'CONFIRMED'           // ยืนยันการมอบหมาย (Internal Manager Confirmation)
  | 'READY_TO_MOB'        // พร้อมเดินทาง
  | 'MOBILIZING'          // อยู่ระหว่างเดินทาง
  | 'ACTIVE'              // ปฏิบัติงาน (On-site)
  | 'DEMOBILIZED'         // จบภารกิจ/เดินทางกลับ
  | 'CLOSED';             // ปิดรายการ

export type ClientApprovalStatus = 
  | 'NOT_SUBMITTED'       // ยังไม่ส่งข้อมูล
  | 'PENDING'             // รอพิจารณา
  | 'APPROVED'            // อนุมัติ
  | 'REJECTED';           // ขอเปลี่ยนตัว/ไม่ผ่าน

export type WaveStatus = 
  | 'PLANNING'            // วางแผน
  | 'READY'               // พร้อมระดม (UI / legacy)
  | 'RECRUITING'          // สรรหา/มอบหมาย
  | 'MOBILIZING'          // ดำเนินการส่งตัว
  | 'DEMOBILIZING'        // กำลังถอนกำลัง
  | 'ACTIVE'              // กำลังดำเนินโครงการ
  | 'COMPLETED'           // จบโครงการ
  | 'CLOSED';             // ปิดโครงการและสรุปบัญชี

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

export type BillingStatus = 
  | 'DRAFT'               // ฉบับร่าง
  | 'ISSUED'              // ออกเอกสารแล้ว
  | 'SUBMITTED'           // ส่งลูกค้าแล้ว
  | 'PARTIALLY_PAID'      // ชำระบางส่วน
  | 'PAID'                // ชำระครบถ้วน
  | 'OVERDUE'             // เกินกำหนดชำระ
  | 'CANCELLED';          // ยกเลิก

/** Matches firestore.rules: ACTIVE or legacy APPROVED both treated as approved for access. */
export type ApprovalStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REJECTED' | 'APPROVED';

export type UserType = 'internal' | 'customer_portal';

export type DataAccessClass = 'staff' | 'client' | 'admin';

export type PortalRole = 'approver' | 'viewer';

/** Primary org partition for permission profiles (aligns with User.accessGroup). */
export type DepartmentGroup = 'admin' | 'operations' | 'accounting' | 'client';

export interface User {
  id: string;
  email: string;
  displayName: string;
  /** เบอร์โทร (เช่น ลงทะเบียนผ่านหน้าแรก) */
  phone?: string;

  /** Optional 3-tier model (snake_case; mirrors Firestore rules helpers). */
  status?: 'active' | 'pending' | 'suspended' | string;
  user_type?: 'internal' | 'customer_portal' | string;
  /** Primary role for simplified RBAC: system_admin | accounting_* | operations_officer | ... */
  role?: string;

  // FUTURE PRIMARY ACCESS MODEL (internal: accessGroup + accessLevel + allowedModules; portal separate)
  userType?: 'internal' | 'customer_portal';
  /** Canonical: `operations` (plural). Writers must use `normalizeUserAuthorizationFields` — do not store `operation`. */
  accessGroup?: 'admin' | 'operations' | 'operation' | 'accounting' | 'client';
  /** Same partition as {@link accessGroup}; keep in sync on write (both should be `operations`, not `operation`). */
  departmentGroup?: DepartmentGroup | 'operation';
  accessLevel?: 'admin' | 'manager' | 'officer' | 'viewer';
  allowedModules?: string[];
  portalRole?: 'approver' | 'viewer';
  customerId?: string | null;
  /**
   * Client portal session overlay only (not stored on Firestore): system admin previewing this customer's portal.
   * When set and matches customerId, CustomerQueryService scopes queries like a portal user.
   */
  portalActingCustomerId?: string;

  // LEGACY / TRANSITIONAL ONLY — DO NOT EXPAND (kept for Firestore + UI until accessGroup migration)
  /** @deprecated Legacy authorization — replace with FUTURE PRIMARY ACCESS MODEL. */
  department: DeptType;
  /** @deprecated Legacy authorization — replace with FUTURE PRIMARY ACCESS MODEL. */
  level: AccessLevel;
  /** @deprecated Legacy authorization — replace with FUTURE PRIMARY ACCESS MODEL. */
  roleId?: RoleType;
  /** @deprecated Legacy authorization — replace with FUTURE PRIMARY ACCESS MODEL. */
  roleIds: RoleType[];
  /** @deprecated Legacy authorization — replace with FUTURE PRIMARY ACCESS MODEL. */
  permissionProfileKey?: string | null;
  /** Canonical business role; lowercase snake_case only (e.g. `operations_manager`, `client_user`). */
  assignedRoleKey?: BusinessRoleKey | null;

  /** Transitional storage only — do not add multi-profile aggregation; runtime should use {@link permissionProfileKey} or first entry. */
  permissionProfileKeys?: string[];
  /** Transitional storage only — do not add multi-role aggregation; prefer single {@link assignedRoleKey}. */
  assignedRoleKeys?: BusinessRoleKey[];
  dataAccess?: DataAccessClass;

  isActive: boolean;
  approvalStatus: ApprovalStatus;
  createdAt: number;
  updatedAt: number;
  lastLoginAt?: number;
  lastLogoutAt?: number;
  notes?: string;
  mustResetPassword?: boolean;
  allowedContractIds?: string[];
  allowedPurchaseOrderIds?: string[];
  deactivatedAt?: number | null;
  deactivatedReason?: string | null;

  /** Migration flag: user needs manual review (do not remove until verified). */
  migrationNeedsReview?: boolean;
}

export interface PermissionProfile {
  id: string;
  profileKey: string;
  profileNameTh: string;
  profileNameEn: string;
  /** Primary partition for new UI & assignment rules (admin / operations / accounting / client). */
  departmentGroup?: DepartmentGroup | 'operation';
  /**
   * @deprecated Legacy single-department label; keep for reads / migration. Prefer {@link departmentGroup}.
   */
  department?: DeptType;
  /** Access tier within {@link departmentGroup} (viewer → admin). */
  level: AccessLevel;
  /** Optional canonical template id (e.g. system_admin, operations_manager). Legacy: admin_admin. */
  primaryRoleTemplateKey?: string;
  isActive: boolean;
  permissions: Record<string, ModulePermission>;
  updatedAt: number;
  updatedBy: string;
  createdAt?: number;
  createdBy?: string;
  notes?: string;
}

export interface ModulePermission {
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
  approve: boolean;
}

export interface Position {
  id: string;
  positionCode: string;
  /** ชื่อตำแหน่ง (field หลักใน Firestore) */
  positionName: string;
  /** @deprecated ใช้ positionName แทน — เก็บไว้สำหรับ legacy docs */
  positionNameTh: string;
  /** @deprecated ใช้ positionName แทน — เก็บไว้สำหรับ legacy docs */
  positionNameEn: string;
  category: 'OFFSHORE' | 'ONSHORE' | 'OFFICE';
  jobMode: JobMode;
  payrollBasis: 'DAILY' | 'MONTHLY' | 'HOURLY';
  active: boolean;
  description?: string;
  notes?: string;
  /**
   * ต้นทุนค่าแรงมาตรฐาน (OPEC จ่าย) ตาม workMode — ไม่อ้าง main_contract/position_rates ฝั่งสัญญา
   * (เฟส 1+ backfill จาก `main_contracts/.../position_rates` ชุดเดิม แล้ว UI สัญญาไม่เก็บต้นทุน)
   */
  defaultLaborCostOnshore?: number;
  defaultLaborCostOffshore?: number;
  /**
   * ทะเบียนต้นทุนค่าแรงต่อสัญญา (และลูกค้า) — payroll ใช้คู่กับ timesheet.contractId
   */
  laborCostByContract?: {
    contractId: string;
    customerId?: string;
    contractLabel?: string;
    onshore?: number;
    offshore?: number;
  }[];
  createdAt: number;
  updatedAt: number;
}

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

/** Store catalog categories — PPE แยกหน้าทะเบียน; อุปกรณ์ทั่วไปใช้ Workwear / Tool / Medical Supplies / General */
export const STORE_ITEM_CATEGORIES = ['PPE', 'Workwear', 'Tool', 'Medical Supplies', 'General'] as const;
export type StoreItemCatalogCategory = (typeof STORE_ITEM_CATEGORIES)[number];

/** ชี้ไปบรรทัด payroll ของพนักงานออฟฟิศ — ใช้ My Profile อ่านทีละบรรทัด (get) */
export type OfficeStaffPayrollLineRef = {
  runCollection: 'office_payroll_runs' | 'executive_payroll_runs';
  runId: string;
  lineId: string;
  payrollMonth?: string;
  updatedAt: number;
};

export interface OfficeStaff {
  id: string;
  staffCode: string;
  fullName: string;
  nickname?: string;
  /** เบอร์ติดต่อ */
  phone?: string;
  department: string;
  /** Optional link to {@link Position} when chosen from ตำแหน่งงาน (category OFFICE). */
  positionId?: string;
  positionTitle: string;
  /** แยกงวดเงินเดือน: พนักงานทั่วไป vs ผู้บริหาร (จัดการในบัญชี — ไม่รวมในงวด office ทั่วไป) */
  payrollBand?: 'OFFICE' | 'EXECUTIVE';
  employmentType: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT';
  salaryType: 'MONTHLY' | 'DAILY';
  monthlySalary: number;
  /** ค่าจ้างรายวัน (เมื่อจ่ายแบบรายวันหรืออ้างอิงประกอบสลิป) */
  dailyWage?: number;
  /** รายเดือนแต่ไม่อ้างอิงการสแกน/เวลาเข้างาน */
  monthlyAttendanceExempt?: boolean;
  /**
   * ฐานคิดหักสาย/ขาดจากเวลาเข้างาน (admin เท่านั้นที่ตั้ง)
   * — BASE_SALARY = ไม่หักจากสแกน แต่ยังหักจากวันลา/ขาดที่บันทึกในระบบ
   */
  officePayrollTimeDeductionBasis?: 'SCAN' | 'BASE_SALARY';
  /** ไม่นำเข้างวดจ่ายเงินเดือนออฟฟิศอัตโนมัติ (เช่น ฝึกงาน / จ่ายนอกระบบ) */
  excludeFromPayrollRuns?: boolean;
  startDate: string;
  /** วันสิ้นสุดการจ้าง (ถ้ามี) */
  employmentEndDate?: string;
  /** เลขบัตรประชาชน */
  nationalId?: string;
  address?: string;
  emergencyContactName?: string;
  emergencyContactRelation?: string;
  emergencyContactPhone?: string;
  bankName?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  taxId?: string;
  socialSecurityNo?: string;
  /** สถานะการขึ้นทะเบียนประกันสังคม */
  socialSecurityStatus?: 'ENROLLED' | 'EXEMPT';
  /** โรงพยาบาลประกันสังคมที่เลือก */
  socialSecurityHospital?: string;
  status: 'ACTIVE' | 'INACTIVE' | 'RESIGNED';
  notes?: string;
  linkedUserId?: string;
  /** อ้างอิงบรรทัด payroll ของตนเอง — sync จากงวดจ่าย (My Profile อ่านด้วย get รายบรรทัด) */
  payrollLineRefs?: OfficeStaffPayrollLineRef[];
  /** @deprecated ไม่ใช้ใน UI — เก็บไว้เฉพาะข้อมูลเก่าใน Firestore */
  supervisorId?: string;
  /** snapshot ตอนผู้ดูแลระบบผูกบัญชี — ให้ HR ดูชื่อ/อีเมลโดยไม่ต้องอ่าน users/{id} */
  linkedUserDisplayName?: string;
  linkedUserDisplayEmail?: string;
  /** snapshot บรรทัดสรุปสิทธิ์ตอนบันทึกการผูกบัญชี */
  linkedUserAccessSummary?: string[];
  createdAt: number;
  createdBy?: string;
  updatedAt: number;
  updatedBy?: string;
}

/**
 * ทะเบียนผู้บริหารสำหรับงวดจ่ายในเมนูบัญชี — แยกจาก `office_staff`
 * การคำนวณภาษี/ประกันสังคมใช้นโยบายชุดเดียวกับพนักงานออฟฟิศ (HR settings / `office`)
 */
export interface ExecutivePayrollStaff {
  id: string;
  staffCode: string;
  fullName: string;
  department: string;
  positionTitle: string;
  monthlySalary: number;
  employmentType?: OfficeStaff['employmentType'];
  salaryType?: OfficeStaff['salaryType'];
  /** ไม่นำเข้างวดคำนวณอัตโนมัติ */
  excludeFromPayrollRuns?: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  notes?: string;
  /** อ้างอิงทะเบียน office_staff เดิม (ถ้ามี) — ไม่บังคับ */
  linkedOfficeStaffId?: string;
  /** เชื่อมบัญชีล็อกอิน (My Profile / portal) — จัดการได้เฉพาะผู้ดูแลระบบ */
  linkedUserId?: string;
  linkedUserDisplayName?: string;
  linkedUserDisplayEmail?: string;
  linkedUserAccessSummary?: string[];
  /** สำหรับออกใบหัก ณ ที่จ่าย — ถ้าไม่กรอกและมี linkedOfficeStaffId ระบบดึงจาก office_staff */
  nationalId?: string;
  taxId?: string;
  address?: string;
  bankName?: string;
  bankAccountNumber?: string;
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
  updatedBy?: string;
}

/** Aliases for forms / imports (mirror OfficeStaff fields). */
export type StaffStatus = OfficeStaff['status'];
export type EmploymentType = OfficeStaff['employmentType'];
export type StaffSalaryType = OfficeStaff['salaryType'];

/** Mobilization workflow (mobilizations collection) — คู่กับ deploymentStatus */
export type MobilizationStatus =
  | 'PENDING'
  | 'READY_TO_MOBILIZE'
  | 'MOBILIZING'
  | 'ACTIVE'
  | 'DEMOBILIZED';

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

export interface Customer {
  id: string;
  customerCode: string;
  name: string;
  taxId: string;
  branchType?: 'head_office' | 'branch';
  branchNo?: string;
  registeredAddress: string;
  billingAddress: string;
  phone?: string;
  email?: string;
  isActive: boolean;
  creditTerms?: string;
  billingTerms?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ContactPerson {
  id: string;
  name: string;
  department: string;
  role: string;
  phone: string;
  email: string;
  isPrimary: boolean;
  /** Optional contract-scoped contact. Empty means customer-level shared contact. */
  contractId?: string;
  notes?: string;
}

/** Mob/demob embarkation point — column headers on contract rate sheet. */
export interface ContractMobDemobLocation {
  /** Stable key for `mobDemobRoundTrip` lookups (e.g. `songkhla`). */
  key: string;
  label: string;
  displayOrder: number;
}

/** Offshore rate bundle per position (working / standby / OT / trips / mob). */
export interface PositionRateOffshoreSide {
  /** Working day (12 hr) — mirrors legacy `sellRateOffshore` / cost offshore daily. */
  workingDay?: number;
  standbyDay?: number;
  otPerHour?: number;
  m1PerTrip?: number;
  d1PerTrip?: number;
  /** Round-trip mob/demob per `ContractMobDemobLocation.key`. */
  mobDemobRoundTrip?: Record<string, number>;
}

/** Onshore rate bundle per position. */
export interface PositionRateOnshoreSide {
  /** Working day (8 hr) — mirrors legacy `sellRateOnshore` / cost onshore daily. */
  workingDay?: number;
  standbyDay?: number;
  otNormalPerHour?: number;
  ot2PerHour?: number;
  ot3PerHour?: number;
}

/** Onshore + offshore sides for sell or cost. */
export interface PositionRateWorkModeBundle {
  offshore?: PositionRateOffshoreSide;
  onshore?: PositionRateOnshoreSide;
}

/** Extended rate sheet per position (sell + cost). */
export interface PositionRateMatrix {
  sell?: PositionRateWorkModeBundle;
  cost?: PositionRateWorkModeBundle;
}

export type PositionRateMatrixCategory =
  | 'offshore_working_day'
  | 'offshore_standby_day'
  | 'offshore_ot_per_hour'
  | 'offshore_m1_per_trip'
  | 'offshore_d1_per_trip'
  | 'offshore_mob_demob_round_trip'
  | 'onshore_working_day'
  | 'onshore_standby_day'
  | 'onshore_ot_normal_per_hour'
  | 'onshore_ot2_per_hour'
  | 'onshore_ot3_per_hour';

export type ContractBillingMode = 'MONTHLY' | 'TRIP';

export type MobCycleBillingReviewStatus =
  | 'open'
  | 'pending_billing'
  | 'approved'
  | 'invoiced'
  | 'void';

/** งวดวางบิลต่อคน/ต่อรอบ mobilization (mobCycleId) */
export interface MobCycleBillingReview {
  id: string;
  mobCycleId: string;
  assignmentId: string;
  workerId: string;
  workerNameSnapshot: string;
  poId: string;
  contractId?: string;
  customerId: string;
  waveId?: string;
  positionId?: string;
  /** วัน M1 แรก — ใช้จัดกลุ่ม batch ร่วมกับคนอื่น */
  tripAnchorStartDate: string;
  tripStartDate: string;
  tripEndDate?: string;
  spansYearMonths?: string[];
  status: MobCycleBillingReviewStatus;
  tripBillingBatchId?: string;
  demobilizationTimesheetId?: string;
  createdAt: number;
  updatedAt: number;
}

export type TripBillingBatchStatus =
  | 'draft'
  | 'ready'
  | 'pending_manager'
  | 'approved'
  | 'invoiced'
  | 'void';

/** ชุดวางบิลร่วม — หลายคนที่ mobilize พร้อมกัน (เช่น 2 หรือ 4 คน) → invoice เดียว */
export interface TripBillingBatch {
  id: string;
  poId: string;
  contractId?: string;
  customerId: string;
  waveId?: string;
  /** คีย์จัดกลุ่ม: po + wave + วัน M1 แรก */
  tripAnchorStartDate: string;
  memberMobCycleIds: string[];
  memberWorkerIds: string[];
  memberWorkerNames?: string[];
  periodStart: string;
  periodEnd?: string;
  status: TripBillingBatchStatus;
  sourceCommercialInvoiceId?: string;
  submittedAt?: number;
  reviewedAt?: number;
  reviewedByUserId?: string;
  reviewedByName?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MainContract {
  id: string;
  contractNumber: string;
  /** เลขที่สัญญา/เอกสารอ้างอิงฝั่งลูกค้า (Service Agreement No.) */
  serviceAgreementNo?: string;
  contractType?: 'master' | 'supplemental';
  parentContractId?: string;
  inheritTermsFromContractId?: string;
  customerId: string;
  title: string;
  projectId?: string;
  startDate: number;
  endDate: number;
  status: 'pending' | 'active' | 'revised' | 'expired' | 'closed';
  currency: string;
  /** อัตรา VAT (%) สำหรับใบแจ้งหนี้เรียกเก็บ — อ้างอิงจากสัญญาเท่านั้น */
  vatPercent?: number;
  billingTerms: string;
  paymentTerms: string;
  rateMultiplierPolicy?: {
    sell: {
      otAfterShift: number;
      holiday: number;
      publicHoliday: number;
      sunday: number;
      sundayOt: number;
      standby: number;
      mobilization: number;
      demobilization: number;
      travel: number;
    };
    cost: {
      otAfterShift: number;
      holiday: number;
      publicHoliday: number;
      sunday: number;
      sundayOt: number;
      standby: number;
      mobilization: number;
      demobilization: number;
      travel: number;
    };
  };
  /** วันหยุดร่วมทั้งสัญญา (ทุกตำแหน่งใช้ชุดเดียวกัน) — ฝั่งวางบิล */
  contractSellWeeklyRestPattern?: 'none' | 'sat_sun' | 'sunday_only';
  contractSellCalendarHolidays?: { date: string; label: string }[];
  contractSellSpecialDays?: string[];
  /** วันหยุดร่วมทั้งสัญญา — ฝั่ง payroll */
  contractCostWeeklyRestPattern?: 'none' | 'sat_sun' | 'sunday_only';
  contractCostCalendarHolidays?: { date: string; label: string }[];
  contractCostSpecialDays?: string[];
  notes?: string;
  approvedAt?: number;
  approvedBy?: string;
  supersededByContractId?: string;
  lastSubmittedAt?: number;
  lastSubmittedBy?: string;
  /** ฝ่ายที่เริ่มเงื่อนไขเชิงพาณิชย์ (ราคา/ฝั่งขาย) — ต้นทุนแรง OPEC อยู่ที่ /positions */
  commercialTermsOwner?: 'sales' | 'operations';
  /**
   * ฐานต้นทุนค่าแรง (บาท/วัน) ต่อตำแหน่ง **ภายใต้สัญญานี้** — ทับ `Position.defaultLaborCost*`
   * เมื่อคำนวณ payroll สำหรับ daily_timesheets ที่ `contractId` ตรงกับสัญญานี้ (เฟส A)
   */
  laborCostBaselinesByPositionId?: Record<string, { onshore?: number; offshore?: number }>;
  /** Mob/demob location columns for this contract's rate sheet (Thai Nippon-style). */
  mobDemobLocations?: ContractMobDemobLocation[];
  /** MONTHLY = ปิด PO+เดือนแล้วออก invoice รวม | TRIP = วางบิลตามรอบ M1→D1 (หลายคนต่อ invoice ได้) */
  billingMode?: ContractBillingMode;
  /**
   * @deprecated ถูก sync ฝั่งสัญญา (เฟส 4–6) — ไม่ใช้ block อนุมัติแล้ว; ดูฐานต้นทุนได้ที่ /positions
   * รัน `migrate:phase6` เพื่อลบ field เหล่านี้จาก Firestore
   */
  costingStatus?: string;
  /** @deprecated เหมือน costingStatus */
  costingMissingPositionsCount?: number;
  /** @deprecated เหมือน costingStatus */
  costingUpdatedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface PositionRate {
  id: string;
  positionId: string;
  sellRate: number;
  /** ราคาขาย Onshore — ถ้าไม่มีให้ใช้ `sellRate` */
  sellRateOnshore?: number;
  /** ราคาขาย Offshore — ถ้าไม่มีให้ใช้ `sellRate` */
  sellRateOffshore?: number;
  /** @deprecated ฝั่งสัญญาไม่เขียน field นี้แล้ว; อาจยังอ่านได้ถ้าเอกสารยังไม่รัน migrate เฟส 5 */
  costBaseline?: number;
  billingUnit: 'daily' | 'monthly' | 'hourly';
  active: boolean;
  overtimeRule: string;
  /** Canonical OT policy for payroll/billing (UI + snapshots). */
  overtimeRuleKey?: 'NONE' | 'MULT_1_0' | 'MULT_1_5' | 'MULT_2_0';
  /** Weekly rest pattern for sell-side day classification */
  sellWeeklyRestPattern?: 'none' | 'sat_sun' | 'sunday_only';
  /** Weekly rest pattern for cost-side */
  costWeeklyRestPattern?: 'none' | 'sat_sun' | 'sunday_only';
  sellCalendarHolidays?: { date: string; label: string }[];
  costCalendarHolidays?: { date: string; label: string }[];
  /** @deprecated ใช้ normalWorkHoursOnshore / normalWorkHoursOffshore — คงไว้ให้เอกสารเก่าและ PO snapshot */
  normalWorkHours?: 8 | 12;
  /** ชม.งานปกติ/วัน งาน Onshore (มาตรฐาน 8) */
  normalWorkHoursOnshore?: 8 | 12;
  /** ชม.งานปกติ/วัน งาน Offshore (มาตรฐาน 12) */
  normalWorkHoursOffshore?: 8 | 12;
  sellOtRules?: {
    afterShift?: number;
    holiday?: number;
    publicHoliday?: number;
    sunday?: number;
    sundayOt?: number;
  };
  costOtRules?: {
    afterShift?: number;
    holiday?: number;
    publicHoliday?: number;
    sunday?: number;
    sundayOt?: number;
  };
  sellSpecialDays?: string[];
  costSpecialDays?: string[];
  notes?: string;
  /** Extended rate sheet (mob, standby, OT, M1/D1) — billing/payroll source when populated. */
  rateMatrix?: PositionRateMatrix;
}

export interface PurchaseOrder {
  id: string;
  poCode: string;
  /** Customer-issued PO document number (external reference) */
  customerPONumber?: string;
  /** วันที่ลูกค้าออกเอกสาร PO (อ้างอิงฝั่งลูกค้า) */
  customerPoIssueDate?: number;
  /** contract = based on active contract, quotation = based on approved/sent quotation */
  poType?: 'contract' | 'quotation';
  contractId: string;
  /** Snapshot จากสัญญาหลัก ณ เวลาสร้าง PO (Service Agreement No. ฝั่งลูกค้า) */
  serviceAgreementNo?: string;
  quotationId?: string;
  customerId: string;
  title: string;
  projectName: string;
  description: string;
  startDate: number;
  endDate: number;
  status: 'pending' | 'active' | 'closed';
  /** โหมดงานของ PO — รวมกลุ่ม PO Active / timesheet (default Offshore สำหรับเอกสารเก่า) */
  poWorkMode?: JobMode;
  /** MONTHLY | TRIP — override สัญญาหลัก (Guangzhou = MONTHLY, Thai Nippon offshore = TRIP) */
  billingMode?: ContractBillingMode;
  /** อ้างอิง `po_active_bundles` — sync อัตโนมัติเมื่อ PO Active */
  poActiveBundleId?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

/** กลุ่ม PO Active ต่อลูกค้า + Onshore/Offshore */
export interface PoActiveBundle {
  id: string;
  customerId: string;
  workMode: JobMode;
  poIds: string[];
  updatedAt: number;
  /** true = ปิด Scheduler/UI silent sync — ไม่ลบแถวเก่า; ใช้ลงมือหรือปุ่ม Auto gen */
  poActiveAutoDailyDisabled?: boolean;
}

export interface OtRulesSnapshot {
  afterShift?: number;
  holiday?: number;
  publicHoliday?: number;
  sunday?: number;
  sundayOt?: number;
}

export interface POLine {
  id: string;
  poId: string;
  positionId: string;
  /** สถานที่ปฏิบัติงานตามที่ลูกค้าระบุต่อบรรทัด (แยกจาก site ของ Wave) */
  workLocation?: string;
  quantity: number;
  startDate: number;
  endDate: number;
  sellRateSnapshot: number;
  /** Snapshot ราคาขายแยกโหมด — ถ้าไม่มีให้ใช้ `sellRateSnapshot` */
  sellRateSnapshotOnshore?: number;
  sellRateSnapshotOffshore?: number;
  costBaselineSnapshot: number;
  billingUnitSnapshot: string;
  overtimeRuleSnapshot: string;
  sellOtRulesSnapshot?: OtRulesSnapshot;
  costOtRulesSnapshot?: OtRulesSnapshot;
  normalWorkHoursSnapshot?: 8 | 12;
  /** Snapshot of `PositionRate.rateMatrix` at PO line creation (Phase 5+). */
  rateMatrixSnapshot?: PositionRateMatrix;
  status: 'active' | 'cancelled' | 'completed';
}

export type SalesContractStatus = 'DRAFT' | 'ACTIVE' | 'EXPIRED' | 'CLOSED' | 'CANCELLED';

export interface SalesContractTerm {
  id: string;
  customerId: string;
  /** สายสัญญา — ว่างได้ถ้าผูกกับใบเสนอราคาแทน */
  mainContractId?: string;
  /** สายใบเสนอราคา — ต้องมีเมื่อไม่มี main contract */
  quotationId?: string;
  purchaseOrderId: string;
  title: string;
  contractNo: string;
  status: SalesContractStatus;
  effectiveDate: string; // Date-only string (e.g., YYYY-MM-DD)
  endDate: string; // Date-only string (e.g., YYYY-MM-DD)
  currency: string;
  billingCycle: string;
  paymentTermsDays: number;
  vatPercent: number;
  withholdingTaxPercent: number;
  notes?: string;
  createdBy: string;
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
}

export type LaborCostContractStatus = 'DRAFT' | 'ACTIVE' | 'EXPIRED' | 'CLOSED' | 'CANCELLED';
export type LaborScopeType = 'SPECIFIC_PO' | 'GENERAL_CUSTOMER' | 'MASTER_CONTRACT' | 'PROJECT_BASED' | 'OTHER';

export interface LaborCostContractTerm {
  id: string;
  title: string;
  relatedCustomerId: string;
  relatedPurchaseOrderId?: string;
  relatedContractId?: string;
  scopeType: LaborScopeType;
  status: LaborCostContractStatus;
  effectiveDate: string; // Date-only string (e.g., YYYY-MM-DD)
  endDate: string; // Date-only string (e.g., YYYY-MM-DD)
  notes?: string;
  createdBy: string;
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Workflow บนข้อมูล mobilization — ข้อมูลเก่าไม่มีฟิลด์นี้ (= legacy เทียบเท่า wave-centric)
 * เฟส 1+ จะใช้ `po_active_v2` เป็นแกน PO Active / location / finished_location
 */
export type MobWorkflowVersion = 'legacy' | 'po_active_v2';

/**
 * ขั้นชีวิต “อยู่ที่ไซต์” ต่อรอบ mob — แยกจาก deploymentStatus เพื่อรองรับ finished_location แล้วเปิดรอบใหม่
 * ข้อมูลเก่า: ฟิลด์ว่าง → UI/logic เดิมยังใช้ timestamps / deploymentStatus ได้
 */
export type MobLocationPhase =
  | 'unset'
  /** เลือก/ยืนยันไซต์แล้ว แต่ยังไม่ถึงขั้นบันทึก working */
  | 'location_selected'
  /** กำลังปฏิบัติที่ไซต์ (มี working / auto daily ตามเฟสถัดไป) */
  | 'active_at_location'
  /** จบที่ไซต์นี้แล้ว — พร้อมเปิด mobCycleNumber ถัดไปหรือกลับคิว */
  | 'finished_location';

/** ค่า mobilization ก่อนกดจบงานบน Wave Board — ใช้ยกเลิกจบงาน */
export interface MobFinishUndoSnapshot {
  deploymentStatus?: DeploymentStatus;
  mobilizationStatus?: string;
  mobCycleNumber?: number;
  mobCycleId?: string;
  mobStandbyDate?: string;
  mobStandbyDayEventType?: 'standby_day' | 'mobilization_day';
  mobStandbyRecordedAt?: number;
  mobStandbyRecordedByUserId?: string;
  mobWorkingStartDate?: string;
  mobWorkingStartedAt?: number;
  mobWorkingStartedByUserId?: string;
  mobReadyToTravelAt?: number;
  mobReadyToTravelByUserId?: string;
  mobLocationPhase?: MobLocationPhase;
  poActiveAutoWorkSuspended?: boolean;
  poActiveStandbyAutoStartYmd?: string;
  poActiveStandbyAutoEndYmd?: string;
}

export interface Assignment {
  id: string;
  assignmentNo: string;
  workerId: string;
  /** Denormalized for client portal — avoids extra worker doc read when assignedCustomerIds blocks profile */
  workerName?: string;
  waveId: string;
  /** ไม่บังคับ: ลิงก์ sales_contract_terms แบบเก่า — การมอบหมายใหม่ใช้ PO + contractId เป็นหลัก */
  salesContractTermId?: string;
  poId: string;
  poLineId: string;
  /**
   * Denormalized PO Active bundle (`customerId__ONSHORE|OFFSHORE`) — เฟส 1 PO workflow;
   * sync จาก `purchase_orders.poActiveBundleId` หรือคำนวณแบบเดียวกับ `resolvePoActiveBundleKeyForPo`
   */
  poActiveBundleId?: string;
  /**
   * รอบ mobilization ภายใต้ assignment เดิม (จบงานที่หนึ่งแล้วเริ่มรอบใหม่ → เพิ่มเลข).
   * Legacy / ข้อมูลเก่า = 1
   */
  mobCycleNumber?: number;
  /**
   * คีย์คงที่ต่อรอบ — รูปแบบแนะนำ `${assignmentId}_c${mobCycleNumber}` (ดู `buildMobCycleDocId`)
   * ใช้อ้างอิงร่วมกับ daily_timesheets เมื่อต้องแยกช่วงไซต์ลูกค้าเดียวกัน
   */
  mobCycleId?: string;
  /** ระบุว่า mobilization นี้อยู่ workflow รุ่นใด — ไม่มีฟิลด์ = legacy */
  mobWorkflowVersion?: MobWorkflowVersion;
  /**
   * คีย์ไซต์จากทะเบียน (หรือค่าที่ทีมนิยาม) — คนละอย่างกับข้อความ `workLocation`
   * เฟส 1 จะผูก dropdown เลือกไซต์ตอน mob
   */
  mobLocationKey?: string;
  /** สถานะไซต์ปัจจุบันต่อรอบ — optional เพื่อไม่ทับข้อมูลเก่า */
  mobLocationPhase?: MobLocationPhase;
  /** Final clearance ขั้น 1 — ยืนยันพร้อมเดินทาง */
  mobReadyToTravelAt?: number;
  mobReadyToTravelByUserId?: string;
  /** Final clearance ขั้น 2 — วัน standby (YYYY-MM-DD, Asia/Bangkok) */
  mobStandbyDate?: string;
  /** ประเภทวันที่บันทึกขั้น 2 — standby_day (SB) หรือ mobilization_day (MO) */
  mobStandbyDayEventType?: 'standby_day' | 'mobilization_day';
  mobStandbyRecordedAt?: number;
  mobStandbyRecordedByUserId?: string;
  /** Final clearance ขั้น 3 — วันเริ่มนับ working / auto รายวัน */
  mobWorkingStartDate?: string;
  mobWorkingStartedAt?: number;
  mobWorkingStartedByUserId?: string;
  /** จบงานที่สถานที่หนึ่ง — หยุด auto รอบนี้; ยัง assigned PO เดิม → กลับคิว Mob */
  mobLocationEndDate?: string;
  mobLocationEndedAt?: number;
  mobLocationEndedByUserId?: string;
  /** snapshot ก่อนจบงานจาก Wave Board — ใช้ยกเลิกจบงานคืนสถานะ mobilization */
  mobFinishUndoSnapshot?: MobFinishUndoSnapshot;
  /**
   * หยุดแบบ standby จาก Wave Board — หลังช่วง SB อัตโนมัติแล้วไม่สร้าง work_day จนกว่าจะเริ่มงานใหม่ที่ Mobilization
   */
  poActiveAutoWorkSuspended?: boolean;
  /** วันแรกของช่วง SB อัตโนมัติ (yyyy-mm-dd, Bangkok) */
  poActiveStandbyAutoStartYmd?: string;
  /** วันสุดท้ายของช่วง SB อัตโนมัติรวม 7 วัน (yyyy-mm-dd, Bangkok) */
  poActiveStandbyAutoEndYmd?: string;
  /** Unassign — คืนคนให้ไป assign PO Active ชุดอื่นได้ */
  unassignedAt?: number;
  unassignedByUserId?: string;
  /** Optional: copied from PO for downstream screens (e.g. mobilization) */
  contractId?: string;
  positionId: string;
  customerId: string;
  projectName: string;
  /** สถานี/ไซต์ปฏิบัติงาน — คัดลอกจาก PO line ตอน assign, แก้ได้ (เฟส D: ลูกค้าเดิมย้ายสถานที่) */
  workLocation?: string;
  workLocationUpdatedAt?: number;
  workLocationUpdatedByUserId?: string;
  /** วันที่มอบหมาย (yyyy-mm-dd, Asia/Bangkok) — แสดงเป็นหลัก; ช่วง standby/working ตั้งที่หน้า Mobilization */
  assignedDate?: string;
  startDate: string;
  endDate: string;
  /** สถานะขั้น mobilization (เอกสาร mobilizations) */
  mobilizationStatus?: MobilizationStatus | string;
  mobilizationDate?: string;
  deploymentStatus: DeploymentStatus;
  clientApprovalStatus: ClientApprovalStatus;
  readinessStatus: 'incomplete' | 'ready';
  workMode: JobMode;
  readinessSummary: {
    passportValid: ChecklistItemStatus;
    medicalValid: ChecklistItemStatus;
    certificatesComplete: ChecklistItemStatus;
    safetyTrainingComplete: ChecklistItemStatus;
    fitToWork: ChecklistItemStatus;
    ppeIssued: ChecklistItemStatus;
    toolsIssued: ChecklistItemStatus;
    overlapClear: ChecklistItemStatus;
    clientApproved: ChecklistItemStatus;
    /** ผลตรวจสารเสพติด — negative ครบแผง + valid ภายใน 10 วันหลังวันตรวจ (เช็คตอน mob) */
    drugTestValid?: ChecklistItemStatus;
  };
  clientComments?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
  updatedBy?: string;
}

export type ChecklistItemStatus = 'pass' | 'fail' | 'warning' | 'missing';

/** โควต้าต่อบรรทัด PO ภายในเวฟเดียว (หลายตำแหน่งใน 1 เวฟ) */
export interface WaveLineAllocation {
  poLineId: string;
  plannedWorkers: number;
}

export interface Wave {
  id: string;
  waveCode: string;
  poId: string;
  poLineId: string;
  customerId: string;
  projectName: string;
  siteLocation: string;
  startDate: string;
  endDate: string;
  status: WaveStatus;
  plannedWorkers: number;
  assignedWorkers: number;
  rotationPattern: string;
  /** ถ้ามี: แตกโควต้าตาม PO line; ถ้าไม่มีใช้ poLineId + plannedWorkers แบบเดิม */
  lineAllocations?: WaveLineAllocation[];
  mobilizationDate?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

/** Central Audit Log for security and compliance */
export interface AuditLog {
  id: string;
  actionType: string; // e.g., 'CREATE', 'APPROVE', 'REJECT', 'LOCK'
  entityType: string; // e.g., 'DailyTimesheet', 'PayrollBatch'
  entityId: string;
  entityLabel?: string; // Descriptive name for logs (e.g., Worker Name or PO Code)
  actorUserId: string;
  actorName: string;
  actorRole: string;
  permissionProfileKey?: string | null;
  sourceModule?: string;
  sourcePath?: string;
  linkedIds?: string[];
  // Named linked IDs for optimized indexing
  payrollBatchId?: string;
  timesheetId?: string;
  waveId?: string;
  purchaseOrderId?: string;
  contractTermId?: string;
  exportBatchId?: string;
  taxInvoiceId?: string;
  billingNoteId?: string;
  beforeSummary?: string;
  afterSummary?: string;
  changedFields?: string[];
  reasonCode?: string;
  reasonText?: string;
  eventAt: number;
  requestId?: string;
  sessionId?: string;
}

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
}

/**
 * ส่งตรวจ timesheet รอบเดือนต่อ Wave — Payroll/Officer ส่งจากหน้าสรุปรายเดือน
 * ให้ Operations/HR Manager อนุมัติก่อนนำไปคำนวณ payroll / ออก Draft Invoice
 */

/** รูปถ่ายหรือ PDF แนบกับงวด Wave/เดือน (Storage + URL) */
export interface WaveMonthTimesheetPhotoAttachment {
  id: string;
  storagePath: string;
  downloadUrl: string;
  fileName: string;
  /** เช่น image/jpeg, application/pdf — ข้อมูลเก่าอาจไม่มี (ใช้นามสกุลไฟล์แทน) */
  contentType?: string;
  uploadedAt: number;
}

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
  | 'pending_manager_review'
  | 'approved'
  | 'rejected';

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

export type RateConditionEventType = 
  | 'work_day' 
  | 'off_day_worked' 
  | 'public_holiday_worked' 
  | 'travel_day' 
  | 'standby_day' 
  | 'mobilization_day' 
  | 'demobilization_day' 
  | 'training_day' 
  | 'sick_leave_paid' 
  | 'vacation_paid' 
  | 'unpaid_leave' 
  | 'night_shift' 
  | 'half_day' 
  | 'early_return' 
  | 'client_cancellation' 
  | 'replacement_day' 
  | 'other';

export type RateConditionUnitType = 'DAY' | 'HALF_DAY' | 'HOUR' | 'TRIP' | 'FIXED';
export type RateConditionCalculationMethod = 'FLAT' | 'FIXED' | 'MULTIPLIER' | 'PERCENTAGE' | 'FORMULA';
export type RateConditionParentType = 'SALES_CONTRACT' | 'LABOR_COST_CONTRACT' | 'PO_SNAPSHOT' | 'WAVE_SNAPSHOT';
export type RateConditionAppliesTo = 'SALES' | 'COST';

export interface RateCondition {
  id: string;
  parentType: RateConditionParentType;
  parentId: string;
  appliesTo: RateConditionAppliesTo;
  eventType: RateConditionEventType;
  unitType: RateConditionUnitType;
  calculationMethod: RateConditionCalculationMethod;
  isActive: boolean;
  positionId?: string;
  siteId?: string;
  workMode?: JobMode | 'BOTH';
  baseRate?: number;
  multiplier?: number;
  percentageOfBase?: number;
  fixedAmount?: number;
  displayOrder: number;
  effectiveDate: string;
  endDate?: string;
  billableConditionText?: string;
  payableConditionText?: string;
  requiresApproval?: boolean;
}

export interface GlobalRateMultiplierPolicy {
  id: string;
  sell: {
    otAfterShift: number;
    holiday: number;
    publicHoliday: number;
    sunday: number;
    sundayOt: number;
    standby: number;
    mobilization: number;
    demobilization: number;
    travel: number;
  };
  cost: {
    otAfterShift: number;
    holiday: number;
    publicHoliday: number;
    sunday: number;
    sundayOt: number;
    standby: number;
    mobilization: number;
    demobilization: number;
    travel: number;
  };
  updatedAt: number;
  updatedBy: string;
}

export interface ClientUser {
  id: string;
  customerId: string;
  email: string;
  displayName: string;
  isSharedAccount: boolean;
  active: boolean;
  createdAt: number;
}

export type APStatus = 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE';
export type ARStatus = 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE';

export interface AccountsPayable {
  id: string;
  vendorId: string;
  documentNo: string;
  referenceId: string; // PurchaseId or BillId
  billDate: string;
  dueDate: string;
  debitAmount: number;
  creditAmount: number;
  outstandingAmount: number;
  status: APStatus;
  createdAt: number;
  updatedAt: number;
  /** สร้างจากใบรับวางบิลคลัง */
  origin?: 'STORE_VENDOR_BILL';
}

export interface AccountsReceivable {
  id: string;
  customerId: string;
  documentNo: string;
  /** ลูกหนี้ — ตั้งเมื่อออกใบกำกับภาษี (ISSUED) เท่านั้น; COMMERCIAL_INVOICE = legacy ก่อนปรับนโยบาย */
  referenceType: 'TAX_INVOICE' | 'BILLING_NOTE' | 'COMMERCIAL_INVOICE';
  referenceId: string;
  /** เลขที่ใบกำกับ (แสดงผล / audit) */
  referenceNo?: string;
  issueDate: string;
  dueDate: string;
  debitAmount: number;
  creditAmount: number;
  outstandingAmount: number;
  status: ARStatus;
  createdAt: number;
  updatedAt: number;
}

export interface APBill {
  id: string;
  apBillNo: string;
  vendorId: string;
  purchaseId?: string;
  supplierInvoiceNo: string;
  billReceivedDate: string;
  invoiceDate: string;
  dueDate: string;
  amountBeforeTax: number;
  vatAmount: number;
  totalAmount: number;
  outstandingAmount: number;
  status: APBillStatus;
  paymentTerms: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export type APBillStatus = 'RECEIVED' | 'VERIFIED' | 'APPROVED' | 'PAID' | 'CANCELLED';

export interface BankAccount {
  id: string;
  accountCode: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  branchName: string;
  accountType: BankAccountType;
  currency: string;
  openingBalance: number;
  currentBalance: number;
  /** วงเงิน OD — ใช้กับบัญชีกระแสรายวัน (CURRENT) */
  odLimit?: number;
  status: BankAccountStatus;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export type BankAccountType = 'SAVINGS' | 'CURRENT' | 'CASH' | 'PETTY_CASH';
export type BankAccountStatus = 'ACTIVE' | 'INACTIVE';

export interface BillingNote {
  id: string;
  billingNoteNo: string;
  customerId: string;
  contractId?: string;
  poId?: string;
  waveId?: string;
  quotationId?: string;
  billingDate: string;
  dueDate: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  amountBeforeTax: number;
  /** VAT percent inherited from SalesTerm or Quotation at creation (default 7) */
  vatPercent: number;
  vatAmount: number;
  withholdingTaxAmount: number;
  netAmount: number;
  currency: string;
  status: BillingNoteStatus;
  notes?: string;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  updatedBy: string;
}

export type BillingNoteStatus = 'DRAFT' | 'ISSUED' | 'SUBMITTED' | 'INVOICED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';

export interface BillingNoteLine {
  id: string;
  billingNoteId: string;
  description: string;
  referenceType: BillingNoteReferenceType;
  referenceId?: string;
  workerId?: string;
  workerName?: string;
  positionId?: string;
  eventType?: string;
  timesheetIds?: string[];
  quantity: number;
  unitPrice: number;
  amount: number;
  /** ลำดับแสดง — อนุรักษ์จากลำดับรายการใบเรียกเก็บ (เดียวกับ Invoice) เพื่อสอดคล้องฉบับพิมพ์ */
  displayOrder?: number;
  createdAt: number;
  updatedAt: number;
}

export type BillingNoteReferenceType = 'CONTRACT' | 'PO' | 'TIMESHEET' | 'SERVICE';

/**
 * ใบแจ้งหนี้เรียกเก็บ (commercial) — สร้างจาก timesheet/wave ก่อนใบกำกับภาษี
 * แยกจาก {@link TaxInvoice} ซึ่งออกทางบัญชีหลังได้รับเงิน
 */
export type CommercialInvoiceStatus = 'DRAFT' | 'PENDING_CUSTOMER' | 'ISSUED' | 'VOID';

export interface CommercialInvoiceLine {
  id: string;
  description: string;
  workerId?: string;
  workerName?: string;
  positionId?: string;
  eventType?: string;
  timesheetIds?: string[];
  quantity: number;
  unitPrice: number;
  amount: number;
  /** ลำดับแสดงบนใบเรียกเก็บ/ใบกำกับ (0-based) — ตรงกับ BillingNoteLine.displayOrder เมื่อสร้างชุดภาษี */
  displayOrder?: number;
  /** จาก timesheet อัตโนมัติ vs ปรับยอดด้วยมือ (ส่วนลด/เพิ่ม) vs รายการ PO vs รายการใบเสนอราคา */
  lineSource?: 'timesheet' | 'manual' | 'po_line' | 'quotation_line';
}

export interface CommercialInvoice {
  id: string;
  invoiceNo: string;
  status: CommercialInvoiceStatus;
  customerId: string;
  contractId?: string;
  poId: string;
  waveId: string;
  /** อ้าง wave_month_timesheet_reviews — กันสร้างซ้ำเมื่ออนุมัติรอบเดือน (ต่อ wave) */
  sourceWaveMonthReviewId?: string;
  /** อ้าง po_month_timesheet_reviews — งวดอนุมัติราย PO+เดือน (รวมทุก wave) */
  sourcePoMonthReviewId?: string;
  /** อ้าง trip_billing_batches — วางบิลรอบ M1→D1 (หลายคนต่อ invoice) */
  sourceTripBillingBatchId?: string;
  billingMode?: ContractBillingMode;
  memberMobCycleIds?: string[];
  memberWorkerNames?: string[];
  /** ฝั่ง OPEC ส่งให้ลูกค้าเห็นใน portal (DRAFT → PENDING_CUSTOMER) */
  sentToCustomerAt?: number;
  sentToCustomerByUid?: string;
  sentToCustomerByName?: string;
  /** แสดงผล — เก็บตอนสร้างจาก wave */
  waveCode?: string;
  periodStart: string;
  periodEnd: string;
  issueDate: string;
  currency: string;
  vatPercent: number;
  amountBeforeTax: number;
  vatAmount: number;
  withholdingTaxAmount: number;
  totalAmount: number;
  lines: CommercialInvoiceLine[];
  /** ลูกค้าแจ้งขอแก้ไข (portal — Open Dispute) — คู่กับ customerRevisionRequestNote */
  customerRevisionRequestedAt?: number;
  /** ข้อความจากลูกค้าเมื่อแจ้ง dispute */
  customerRevisionRequestNote?: string;
  /** อ้างอิง customer_issues ที่สร้างตอน dispute */
  customerRevisionIssueId?: string;
  /** หลังลูกค้า/ตัวแทนอนุมัติ — ถือเป็น Invoice จริงสำหรับเรียกเก็บ (ยังไม่ใช่ใบกำกับภาษี) */
  customerApprovedAt?: number;
  customerApprovedByUid?: string;
  customerApprovedByName?: string;
  customerApprovalSource?: 'CLIENT_PORTAL' | 'INTERNAL';
  /** ลูกค้าแนบสลิป/หลักฐานการจ่ายเงิน (หลังอนุมัติยอดเรียกเก็บแล้ว) */
  customerPaymentReportedAt?: number;
  customerPaymentReportedByUid?: string;
  customerPaymentReportedByName?: string;
  customerPaymentProofUrl?: string;
  customerPaymentProofFileName?: string;
  /** บัญชี OPEC รับรองรับเงิน + ออกใบกำกับ/ลง cashbook */
  opecPaymentVerifiedAt?: number;
  opecPaymentVerifiedByUid?: string;
  opecPaymentVerifiedByName?: string;
  opecPaymentBankAccountId?: string;
  opecPaymentCashbookEntryId?: string;
  generationWarnings?: string[];
  timesheetCount?: number;
  notes?: string;
  /** ใบกำกับภาษี / ใบเสร็จ (ร่างหรือออกแล้ว) ที่สร้างจากใบเรียกเก็บนี้ */
  linkedTaxInvoiceId?: string;
  createdAt: number;
  createdByUid: string;
  createdByName: string;
  updatedAt: number;
  updatedByUid?: string;
  updatedByName?: string;
}

export interface CashbookEntry {
  id: string;
  entryNo: string;
  bankAccountId: string;
  entryDate: string;
  direction: 'IN' | 'OUT';
  entryType: CashbookEntryType;
  referenceType?: 'RECEIPT' | 'PAYMENT' | 'BILL' | 'TRANSFER' | 'OTHER';
  referenceId?: string;
  amount: number;
  description: string;
  paymentMethod: PaymentMethod;
  createdAt: number;
  updatedAt: number;
  createdByUid?: string;
  createdByName?: string;
  /** ยอดเต็มงวด (ก่อนหัก ณ ที่จ่าย) — ใช้ประกอบรายการจ่ายคู่ค้า */
  grossPaymentAmount?: number;
  /** หัก ณ ที่จ่ายที่ไม่ได้ตัดจากบัญชีธนาคาร (รอนำส่งสรรพากร) */
  supplierWithholdingAmount?: number;
}

/**
 * รายการรับ/จ่ายเงินสดย่อยหน้างาน — อัปเดตยอด Petty Cash โดยตรง ไม่สร้างแถวใน `cashbook_entries`
 * (เงินก้อนจากบริษัทตัดใน cashbook ตอนโอนเข้า Petty แล้ว; คืนเข้าบริษัทค่อยลง cashbook อีกครั้ง)
 */
export interface PettyCashEntry {
  id: string;
  entryNo: string;
  bankAccountId: string;
  entryDate: string;
  direction: 'IN' | 'OUT';
  amount: number;
  description: string;
  paymentMethod: 'CASH';
  createdAt: number;
  createdByUid: string;
  createdByName: string;
  updatedAt: number;
}

/** เบิกเงินล่วงหน้า — workflow HR / ผู้จัดการ / บัญชี / Petty Cash */
export type CashAdvanceSubjectType = 'worker' | 'office_staff';

/** office = สร้างจาก HR/ออฟฟิศ (ผู้ถือใบอาจต้องยืนยัน); employee = สร้างจากผู้ถือบัญชีเอง */
export type CashAdvanceOrigin = 'office' | 'employee';

export type CashAdvanceStatus =
  | 'PENDING_SUBJECT_CONFIRMATION'
  | 'PENDING_PAYROLL_REVIEW'
  | 'REJECTED_PAYROLL'
  | 'PENDING_MANAGER_APPROVAL'
  | 'REJECTED_MANAGER'
  | 'PENDING_PAYMENT'
  | 'PAID_PETTY_CASH'
  | 'PAID_OTHER'
  | 'CANCELLED';

export interface CashAdvanceRequest {
  id: string;
  requestNo: string;
  subjectType: CashAdvanceSubjectType;
  workerId?: string;
  officeStaffId?: string;
  /** ชื่อแสดง snapshot */
  subjectNameSnapshot: string;
  amountBaht: number;
  reason: string;
  origin: CashAdvanceOrigin;
  status: CashAdvanceStatus;
  /** UID ของผู้ถือเรื่อง (ยืนยันเมื่อสร้างจาก office) — จาก linkedUserId ของ worker/office_staff */
  subjectLinkedUserId?: string | null;
  createdAt: number;
  createdByUid: string;
  createdByName: string;
  updatedAt: number;
  subjectConfirmedAt?: number;
  subjectConfirmationIp?: string;
  payrollReviewedAt?: number;
  payrollReviewedByUid?: string;
  payrollReviewedByName?: string;
  payrollRejectReason?: string;
  managerApprovedAt?: number;
  managerApprovedByUid?: string;
  managerApprovedByName?: string;
  managerRejectReason?: string;
  paidAt?: number;
  paidByUid?: string;
  paidByName?: string;
  paymentNote?: string;
  pettyCashBankAccountId?: string;
  pettyCashEntryId?: string;
  pettyCashEntryNo?: string;
  /** จ่ายจากบัญชีธนาคารหลัก — บันทึกใน cashbook_entries (ไม่ใช่ Petty) */
  paymentBankAccountId?: string;
  cashbookEntryId?: string;
  cashbookEntryNo?: string;
  /** เมื่อสร้าง Payroll Batch แล้วหักเบิกล่วงหน้าในสลิป — อ้าง batch ที่ผูกการหัก */
  payrollRecoveryBatchId?: string | null;
}

export type CashbookEntryType =
  | 'CUSTOMER_RECEIPT'
  | 'SUPPLIER_PAYMENT'
  | 'PAYROLL'
  | 'TAX'
  | 'TRANSFER'
  | 'PETTY_CASH'
  | 'OTHER';
export type PaymentMethod = 'TRANSFER' | 'CASH' | 'CHEQUE' | 'OTHER';

/** โหมดภาษีหัก ณ ที่จ่ายรายบรรทัดงวดออฟฟิศ/ผู้บริหาร */
export type OfficePayrollPitMode = 'SYSTEM' | 'MANUAL_PERCENT' | 'MANUAL_AMOUNT';

/** หลักฐานการโอนภาษีหัก ณ ที่จ่าย (ภงด.1) — แนบตอนจ่ายภาษี */
export interface WhtTaxPaymentProofAttachment {
  id: string;
  storagePath: string;
  downloadUrl: string;
  fileName: string;
  contentType?: string;
  uploadedAt: number;
  uploadedByUid?: string;
  uploadedByName?: string;
}

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
  /** หลักฐานการโอนภาษีหัก ณ ที่จ่าย — แนบตอนจ่ายภาษี */
  whtTaxPaymentProofAttachments?: WhtTaxPaymentProofAttachment[];
  /** นำส่งประกันสังคม (ฝั่งลูกจ้าง) แล้ว — ref cashbook */
  ssoRemitCashbookEntryId?: string;
  ssoRemitCashbookEntryNo?: string;
  ssoRemitPaidAt?: number;
  ssoRemitPaidByUid?: string;
  ssoRemitPaidByName?: string;
  ssoRemitPaymentBankAccountId?: string;
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
}

/** งวดเงินเดือนผู้บริหาร — โครงเดียวกับ office แต่คนละคอลเลกชันและสิทธิ์เฉพาะบัญชี */
export type ExecutivePayrollRun = OfficePayrollRun;
export type ExecutivePayrollLine = OfficePayrollLine;

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

export type PayrollType = 'MONTHLY' | 'WAVE_BASED' | 'SPECIAL_RUN' | 'ADJUSTMENT';

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
  /** บัญชียืนยันจ่ายแล้ว — รายการ cashbook ที่สร้างอัตโนมัติ */
  financeCashbookEntryId?: string;
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
  normalAmount: number;
  holidayDays: number;
  holidayAmount: number;
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
}

export interface HrPayrollLineAdjustments {
  allowanceItems: Array<{ label: string; amount: number }>;
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
  /** บัญชีตัดจ่ายแล้ว — ref cashbook ของชุดแถวนี้ (แบ่งจ่ายหลายบัญชีได้) */
  financePayoutCashbookEntryId?: string;
  financePayoutBankAccountId?: string;
  financePaidAt?: number;
  /** จ่ายภาษีหัก ณ ที่จ่าย (ภงด.1) แล้ว — ref cashbook */
  whtTaxCashbookEntryId?: string;
  whtTaxCashbookEntryNo?: string;
  whtTaxPaidAt?: number;
  whtTaxPaidByUid?: string;
  whtTaxPaidByName?: string;
  whtTaxPaymentBankAccountId?: string;
  /** หลักฐานการโอนภาษีหัก ณ ที่จ่าย — แนบตอนจ่ายภาษี */
  whtTaxPaymentProofAttachments?: WhtTaxPaymentProofAttachment[];
  /** นำส่งประกันสังคม (ฝั่งลูกจ้าง) แล้ว — ref cashbook */
  ssoRemitCashbookEntryId?: string;
  ssoRemitCashbookEntryNo?: string;
  ssoRemitPaidAt?: number;
  ssoRemitPaidByUid?: string;
  ssoRemitPaidByName?: string;
  ssoRemitPaymentBankAccountId?: string;
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
export interface NumberSequence {
  id: string;
  sequenceKey: string;
  label: string;
  prefix: string;
  department: DeptType;
  entityType: string;
  resetPolicy: 'none' | 'yearly' | 'monthly';
  year?: number | null;
  month?: number | null;
  paddingLength: number;
  lastNumber: number;
  lastIssuedCode?: string | null;
  isActive: boolean;
  updatedAt: number;
  updatedBy: string;
}

export type QuotationStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'cancelled' | 'revised';

/** ลูกค้า portal เห็นได้หลัง OPEC กดส่งให้ลูกค้าเท่านั้น — ไม่รวม draft/revised */
export const QUOTATION_PORTAL_VISIBLE_STATUSES: QuotationStatus[] = [
  'sent',
  'accepted',
  'rejected',
  'expired',
  'cancelled',
];

export interface Quotation {
  id: string;
  quotationNo: string;
  baseQuotationNo?: string;
  revisionNo?: number;
  revisedFromQuotationId?: string;
  supersededByQuotationId?: string;
  customerId: string;
  customerNameSnapshot?: string;
  issueDate: string;
  validUntilDate: string;
  currency: string;
  status: QuotationStatus;
  projectTitle: string;
  referenceNo?: string;
  contactPerson?: string;
  billingAddressSnapshot?: string;
  notes?: string;
  internalNotes?: string;
  subtotal: number;
  discountAmount: number;
  taxPercent: number;
  taxAmount: number;
  grandTotal: number;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  updatedBy: string;
  /** ลูกค้า (portal) ตอบรับ/ปฏิเสธ — คู่กับ status accepted|rejected */
  portalDecisionAt?: number;
  portalDecisionByUid?: string;
  portalDecisionByName?: string;
  portalDecisionSource?: 'CLIENT_PORTAL';
  /** ลูกค้าแจ้งขอแก้ไข/ต่อรอง (portal) — คู่กับ customerRevisionRequestNote */
  customerRevisionRequestedAt?: number;
  customerRevisionRequestNote?: string;
  customerRevisionIssueId?: string;
}

export interface QuotationLine {
  id: string;
  quotationId: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
  remarks?: string;
  displayOrder: number;
}

/** Worker bank and payment detail snapshots */
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
  /** อ้างอิง id จาก DrugTestPanelSubstance */
  substanceKey?: string;
  substanceLabelSnapshot?: string;
  testDate: number | null;
  testLocationType?: DrugTestLocationType;
  /** เมื่อ testLocationType === OTHER */
  testLocationOther?: string;
  result: DrugTestResult;
  /** @deprecated ไม่ใช้แล้ว — ข้อมูลเก่าเท่านั้น */
  expiryDate?: number;
  /** @deprecated ใช้ testLocationType / testLocationOther */
  laboratory?: string;
  /** รูปถ่าย/แนบผลตรวจ (thumbnail ในตาราง) */
  attachment?: WaveMonthTimesheetPhotoAttachment;
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

export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: string[];
}

export type PurchaseLineEntryMode = 'INVENTORY' | 'SERVICE';

/** การคิด VAT บน PR/PO — EXCLUSIVE=ยังไม่รวม VAT ต่อบรรทัด, INCLUSIVE=ยอดบรรทัดรวม VAT แล้ว */
export type PurchaseRequestVatTreatment = 'NONE' | 'EXCLUSIVE' | 'INCLUSIVE';

/** ร่างงวดชำระตอนทำ PR — คัดลอกเป็น payment_milestones เมื่อสร้าง PO */
export interface PrPaymentMilestoneDraft {
  sequence: number;
  label: string;
  amount: number;
  /** ค่า input type="date" */
  dueDate?: string;
}

export type PurchaseRequestStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'PO_ISSUED'
  | 'REJECTED'
  | 'CANCELLED';

/**
 * คำขออนุมัติสั่งซื้อ (PR) — ต้องอนุมัติก่อนสร้างใบสั่งซื้อ (1 PR สร้าง PO ได้หนึ่งฉบับ)
 */
export interface PurchaseRequest {
  id: string;
  requestNo: string;
  title: string;
  vendorId?: string;
  notes?: string;
  /** วันที่ต้องการของ (HTML date) — อ้างอิงเท่านั้น */
  needByDate?: string;
  estimatedAmount?: number;
  /** สรุปจากบรรทัด PR — sync ตอนบันทึก */
  amountBeforeTax?: number;
  vatAmount?: number;
  totalAmount?: number;
  /** แบบที่ 1 คลัง / แบบที่ 2 คีย์มือ */
  lineEntryMode?: PurchaseLineEntryMode;
  vatTreatment?: PurchaseRequestVatTreatment;
  /** เงื่อนไขจ่ายที่ขออนุมัติ — คัดลอกไป PO */
  purchasePaymentType?: PurchaseType;
  /** เครดิตแบ่งงวด — ถ้า false ใช้งวดเดียวตามเครดิตคู่ค้าเมื่อสร้าง PO */
  paymentInstallmentsEnabled?: boolean;
  paymentMilestoneDrafts?: PrPaymentMilestoneDraft[];
  status: PurchaseRequestStatus;
  requestedByUid?: string;
  requestedByName?: string;
  submittedAt?: number;
  decidedAt?: number;
  decidedByUid?: string;
  decidedByName?: string;
  rejectionReason?: string | null;
  /** PO ที่สร้างจาก PR นี้ (ผูก 1:1) */
  linkedPurchaseId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Purchase {
  id: string;
  purchaseNo: string;
  /** อ้าง PR ที่อนุมัติแล้ว — ใบสั่งซื้อใหม่ต้องระบุ */
  purchaseRequestId?: string;
  vendorId: string;
  purchaseDate: string;
  purchaseType: PurchaseType;
  totalAmount: number;
  amountBeforeTax: number;
  vatAmount: number;
  /** ส่วนลดหักจากฐานก่อนภาษี (บาท) — ตั้งได้บน PO อ้าง PR ก่อนส่งคู่ค้า */
  discountAmount?: number;
  status: PurchaseStatus;
  /** แบบที่ 1 เลือกจากคลัง / แบบที่ 2 สั่งจ้างคีย์มือ */
  purchaseLineMode?: PurchaseLineEntryMode;
  /** คิด VAT ตามที่อนุมัติใน PR — ถ้าไม่มีถือเป็น EXCLUSIVE (พฤติกรรมเดิม) */
  vatTreatment?: PurchaseRequestVatTreatment;
  /** งานจ้างเหมา — แสดง/คำนวณหัก ณ ที่จ่ายตามงวด (ฐาน = ส่วนก่อน VAT ของงวด ตามสัดส่วน amountBeforeTax/totalAmount) */
  supplierWithholdingEnabled?: boolean;
  /** อัตราหัก ณ ที่จ่าย เช่น 3 = 3% */
  supplierWithholdingRatePercent?: number;
  notes?: string;
  /** UNPAID | PARTIAL | PAID — sync จากงวดชำระ */
  paymentStatus?: string;
  storeReceiptStatus?: string;
  /** ผู้สร้าง PO (จัดซื้อ) */
  createdByUid?: string;
  createdByName?: string;
  approvalRequestedAt?: number;
  approvalDecidedAt?: number;
  approvalDecisionByUid?: string;
  approvalDecisionByName?: string;
  approvalComment?: string | null;
  rejectionReason?: string | null;
  /** ยืนยันว่าส่ง PO/เอกสารให้คู่ค้าแล้ว (หลัง APPROVED → ISSUED) */
  issuedAt?: number;
  issuedByUid?: string;
  issuedByName?: string;
  createdAt: number;
  updatedAt: number;
}

export type PurchaseType = 'CASH' | 'CREDIT';
export type PurchaseStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'RETURNED_FOR_REVISION'
  | 'APPROVED'
  | 'REJECTED'
  | 'ISSUED'
  | 'COMPLETED'
  | 'CANCELLED';

export interface PurchaseLine {
  id: string;
  purchaseId: string;
  itemDescription: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  /** เมื่อ purchaseLineMode = INVENTORY */
  storeItemId?: string;
  /** รหัส SKU คลัง (EQM-/PPE-) — คัดลอกจาก PR เพื่อผูกรับเข้าสต็อก */
  storeItemCode?: string;
  createdAt: number;
}

/** งวดชำระเงินตาม PO จัดซื้อ — เก็บใต้ purchases/{id}/payment_milestones */
export type PurchasePaymentMilestoneStatus = 'OPEN' | 'PAID' | 'WAIVED';

export interface PurchasePaymentMilestone {
  id: string;
  purchaseId: string;
  sequence: number;
  label: string;
  amount: number;
  status: PurchasePaymentMilestoneStatus;
  /** ค่า input type="date" */
  dueDate?: string;
  paidAt?: number;
  paidByUid?: string;
  paidByName?: string;
  waivedAt?: number;
  waivedByUid?: string;
  waivedByName?: string;
  notes?: string;
  /** ลิงก์ไป purchase_vendor_bills เมื่อสร้างใบรับวางบิลต่องวด */
  vendorBillId?: string;
  /** แผนกสโตร์ยืนยันรับมอบงาน/สินค้าต่องวด (ลำดับงวด 1→2→3) */
  goodsReceivedAt?: number;
  goodsReceivedByUid?: string;
  goodsReceivedByName?: string;
  createdAt: number;
  updatedAt: number;
}

/** เอกสารประกอบใบวางบิล (ปะหน้า) — ถ้าไม่ติ๊ก = อ้างอิงเฉพาะ PO ภายในระบบ */
export interface VendorBillSupportingDocumentLink {
  attached?: boolean;
  documentNo?: string;
  /** ค่า input type="date" YYYY-MM-DD */
  documentDate?: string;
}

/**
 * ระบุว่ามองยอดในใบวางบิลว่ามี VAT 7% หรือไม่ — ถ้าไม่เก็บฟิลด์นี้ ให้อิงจากยอดภาษีใน PO
 * - VAT_7: แยกภาษี (ยอดรวมในใบ = ก่อนภาษี + VAT 7%)
 * - VAT_7_INCLUSIVE: ภาษีในตัว (ยอดรวมในใบรวม VAT แล้ว — แยกฐาน/ภาษีด้วย gross÷1.07 เหมือนกันในเลข)
 */
export type VendorBillVatTreatmentOverride = 'NONE' | 'VAT_7' | 'VAT_7_INCLUSIVE';

/** รับวางบิลจากใบสั่งซื้อที่อนุมัติแล้ว — คลังสร้าง บัญชีติดตามจ่าย */
export type PurchaseVendorBillStatus = 'DRAFT' | 'SUBMITTED' | 'PARTIALLY_PAID' | 'PAID' | 'CLOSED';

/** บัญชีเลือกประเภทหัก ณ ที่จ่ายบนใบวางบิลก่อนจ่าย — อัตราและข้อความบนใบหัก ม.50 ทวิ */
export type VendorBillWhtPresetCategory = 'TRANSPORT_FREIGHT' | 'SERVICE' | 'RENT';

/** งวดจ่ายภายในใบรับวางบิลเดียว (แผนที่คลังกำหนด — ไม่ใช่แค่หมายเหตุ) */
export type VendorBillInstallmentPayStatus = 'PENDING' | 'PAID';

export interface VendorBillPaymentInstallment {
  id: string;
  sequence: number;
  label: string;
  /** ยอดรวม VAT ของงวดนี้ */
  amountInclVat: number;
  /** ค่า input type="date" */
  dueDate?: string;
  payStatus: VendorBillInstallmentPayStatus;
  paidAt?: number;
  paidByUid?: string;
  paidByName?: string;
  cashbookEntryId?: string;
  cashbookEntryNo?: string;
  paymentProofUrl?: string;
  paymentProofFileName?: string;
}

/** รายการหัก ณ ที่จ่าย (ผู้รับเงิน) — สะสมเพื่อสรุปนำส่งสรรพากร ไม่ตัดบัญชีธนาคารตอนจ่ายคู่ค้า */
export type WithholdingAtSourceStatus = 'OUTSTANDING' | 'REMITTED' | 'VOID';

export interface WithholdingAtSourceItem {
  id: string;
  vendorId: string;
  vendorName?: string;
  purchaseId: string;
  purchaseNo?: string;
  vendorBillId: string;
  receiptNo?: string;
  milestoneId?: string;
  /** แบ่งจ่ายหลายงวดในใบเดียว — อ้าง installment ที่จ่ายครั้งนี้ */
  installmentId?: string;
  /** ยอดงวดรวม VAT (ก่อนหัก) */
  grossPaymentAmount: number;
  baseBeforeVat: number;
  whtAmount: number;
  ratePercent: number;
  status: WithholdingAtSourceStatus;
  cashbookEntryId: string;
  cashbookEntryNo: string;
  entryDate: string;
  remittedAt?: number;
  remittedNote?: string;
  createdAt: number;
  updatedAt: number;
}

/** หนังสือรับรองหัก ณ ที่จ่าย ม.50 ทวิ — สถานะเอกสารหลัก */
export type WithholdingCertificateDocumentStatus = 'DRAFT' | 'VERIFIED' | 'ISSUED' | 'CANCELLED' | 'REPLACED';

/** สถานะเตรียมส่งอิเล็กทรอนิกส์ / XML (ยังไม่ผูกกรมสรรพากรจริง) */
export type WithholdingCertificateXmlExportStatus =
  | 'NOT_EXPORTED'
  | 'READY_FOR_EXPORT'
  | 'EXPORTED_XML'
  | 'SUBMITTED'
  | 'ACCEPTED'
  | 'REJECTED';

/** ประเภทสำเนาเอกสารตามแบบใช้งาน */
export type WithholdingCertificateCopyVariant =
  | 'COPY_PAYEE_TAX_RETURN'
  | 'COPY_PAYEE_RECORD'
  | 'COPY_PAYER_RECORD';

/** เงื่อนไขการหักภาษี (แสดงเป็น checkbox ใน PDF) */
export type WhtTaxCondition =
  | 'WITHHOLDING'
  | 'TAX_PAID_BY_PAYER_ONE_TIME'
  | 'TAX_PAID_BY_PAYER_FOREVER'
  | 'OTHER';

/** รหัสประเภทเงินได้ภายในระบบ (mapping XML / e-Withholding ภายหลัง) */
export type WhtIncomeTypeCode = 'GOODS_MANUFACTURING' | 'SERVICE_CONTRACT' | 'OTHER';

/** แบบภาษีหัก ณ ที่จ่ายที่อ้างอิงในเอกสาร */
export type WhtWithholdingFormType = 'PND3' | 'PND53';

export interface WhtElectronicData {
  documentTypeCode?: string;
  documentNo?: string;
  issueDate?: string;
  paymentDate?: string;
  payerTaxId?: string;
  payerBranchNo?: string;
  payerName?: string;
  payerAddress?: string;
  payeeTaxId?: string;
  payeeBranchNo?: string;
  payeeName?: string;
  payeeAddress?: string;
  incomeTypeCode?: string;
  incomeTypeName?: string;
  formTypeCode?: string;
  withholdingTaxRate?: number;
  withholdingTaxBase?: number;
  withholdingTaxAmount?: number;
  taxConditionCode?: string;
  paymentMethodCode?: string;
  sendingBankName?: string;
  bankReferenceNo?: string;
  sourceInvoiceNo?: string;
  sourceBillNo?: string;
  currencyCode?: string;
  exchangeRate?: number;
  xmlExportStatus?: WithholdingCertificateXmlExportStatus;
  xmlFileName?: string;
  xmlGeneratedAt?: number;
  xmlGeneratedBy?: string;
  xmlSubmissionReference?: string;
  rdResponseCode?: string;
  rdResponseMessage?: string;
}

export interface WhtCertificatePayerSnapshot {
  legalNameTh: string;
  legalNameEn?: string;
  taxId: string;
  branchType: 'HEAD_OFFICE' | 'BRANCH';
  branchNo?: string;
  addressTh: string;
  addressEn?: string;
  phone?: string;
  email?: string;
  taxpayerType?: 'COMPANY' | 'PERSON' | 'OTHER';
}

export interface WhtCertificatePayeeSnapshot {
  displayName: string;
  taxId?: string;
  branchType: 'HEAD_OFFICE' | 'BRANCH';
  branchNo?: string;
  addressTh: string;
  addressEn?: string;
  vendorCategory: 'COMPANY' | 'INDIVIDUAL' | 'FOREIGN' | 'OTHER';
  countryCode?: string;
}

export type WhtCertificateAuditAction =
  | 'CREATE_WHT'
  | 'VERIFY_WHT'
  | 'ISSUE_WHT'
  | 'PRINT_WHT'
  | 'GENERATE_WHT_XML'
  | 'CANCEL_WHT'
  | 'REPLACE_WHT'
  | 'REFRESH_WHT_FROM_MASTER';

/** เอกสารหนังสือรับรองหัก ณ ที่จ่าย — collection `withholding_certificate_documents` */
export interface WithholdingCertificateDocument {
  id: string;
  documentStatus: WithholdingCertificateDocumentStatus;
  xmlExportStatus: WithholdingCertificateXmlExportStatus;

  /** เลขที่หนังสือรับรอง — มีเมื่อ ISSUED */
  certificateNo?: string;

  /** ประเภทสำเนาล่าสุดที่พิมพ์ (audit) */
  lastPrintedCopyVariant?: WithholdingCertificateCopyVariant;

  taxCondition: WhtTaxCondition;
  taxConditionOtherRemark?: string;

  incomeTypeCode: WhtIncomeTypeCode;
  incomeTypeDisplayTh: string;
  /** รหัสรายได้สำหรับอนาคต (เชื่อม RD / e-Withholding) */
  withholdingIncomeCode?: string;
  formTypeCode?: string;
  withholdingFormType: WhtWithholdingFormType;

  payer: WhtCertificatePayerSnapshot;
  payee: WhtCertificatePayeeSnapshot;

  amountBeforeVat: number;
  vatAmount: number;
  grossAmount: number;
  withholdingTaxBase: number;
  withholdingTaxRatePercent: number;
  withholdingTaxAmount: number;
  netPaidAmount: number;

  paymentDate: string;
  paymentMethod: PaymentMethod;
  paymentIssueDate: string;
  bankName?: string;
  bankAccountLast4?: string;
  sendingBankName?: string;
  paymentReferenceNo?: string;

  referenceVendorBillNo: string;
  referencePurchaseNo?: string;
  referenceTaxInvoiceNo?: string;
  referencePaymentNo?: string;
  jobDescription: string;

  sourceVendorBillId: string;
  sourcePurchaseId: string;
  sourceCashbookEntryId?: string;
  sourceWithholdingAtSourceItemId?: string;

  /** อนุญาตออกเอกสารทางการแม้ไม่มีเลขผู้เสียภาษีคู่ค้า — เฉพาะแอดมิน + ระบุเหตุผล */
  payeeTaxIdMissingOverride?: boolean;
  payeeTaxIdMissingReason?: string;

  whtElectronicData: WhtElectronicData;

  authorizedSignerName?: string;
  signerPosition?: string;
  signatureImageUrl?: string;
  companyStampImageUrl?: string;

  cancelReason?: string;
  replacedByDocumentId?: string;

  createdAt: number;
  createdByUid: string;
  createdByName?: string;
  updatedAt: number;
  updatedByUid?: string;
  updatedByName?: string;
  verifiedAt?: number;
  verifiedByUid?: string;
  verifiedByName?: string;
  issuedAt?: number;
  issuedByUid?: string;
  issuedByName?: string;
  cancelledAt?: number;
  cancelledByUid?: string;
  cancelledByName?: string;

  /** บันทึกนำส่งภาษีหัก ณ ที่จ่าย (ภงด.53) — cashbook OUT */
  whtTaxCashbookEntryId?: string;
  whtTaxCashbookEntryNo?: string;
  whtTaxPaidAt?: number;
  whtTaxPaidByUid?: string;
  whtTaxPaidByName?: string;
  whtTaxPaymentBankAccountId?: string;
  whtTaxPaymentProofAttachments?: WhtTaxPaymentProofAttachment[];
}

export interface WhtCertificateAuditLogEntry {
  id: string;
  action: WhtCertificateAuditAction;
  documentId: string;
  actorId: string;
  actorName?: string;
  timestamp: number;
  /** field สำคัญที่เปลี่ยน (ถ้ามี) */
  payloadSummary?: Record<string, unknown>;
  reason?: string;
}

export interface PurchaseVendorBill {
  id: string;
  receiptNo: string;
  purchaseId: string;
  /** snapshot เลขที่ PR — แสดงบนปะหน้าใบวางบิล */
  purchaseRequestNo?: string;
  /** snapshot ณ สร้าง/ส่ง — ใช้แยกเวิร์กโฟลว์เงินสด vs เครดิต */
  purchaseType?: PurchaseType;
  /** ผูกกับงวดชำระ (ถ้ามี) */
  milestoneId?: string;
  /**
   * แผนแบ่งจ่ายภายในใบเดียว (คลังกำหนด 1–N งวด) — ว่าง = จ่ายครั้งเดียวเต็มยอด (พฤติกรรมเดิม)
   * เมื่อมีรายการนี้ ระบบจะติดตามยอดค้างในเจ้าหนี้ตามงวดที่จ่ายแล้ว / ยังไม่จ่าย
   */
  paymentInstallments?: VendorBillPaymentInstallment[];
  /**
   * ปิดเรื่องเอกสารตามเช็คลิส (ใบกำกับภาษี + ใบเสร็จรับเงินครบ) — สถานะปิดสมบูรณ์ทางเอกสาร
   * แยกจากการจ่ายเงินครบทุกงวด
   */
  vendorBillDocumentationClosed?: boolean;
  vendorBillDocumentationClosedAt?: number;
  vendorBillDocumentationClosedByUid?: string;
  vendorBillDocumentationClosedByName?: string;
  /** ยอดในใบนี้ — ถ้าไม่ระบุให้ใช้ยอดสุทธิทั้งใบสั่งซื้อ (ของเก่า) */
  billAmount?: number;
  /** ทับการตีความ VAT จาก PO (ถ้าไม่มี = ใช้ยอดภาษีใน PO) */
  billVatTreatment?: VendorBillVatTreatmentOverride;
  /**
   * บัญชีบังคับเปิด/ปิดหัก ณ ที่จ่ายเฉพาะใบนี้ (หลังสโตร์ส่งบัญชี)
   * ไม่ระบุ = ตาม purchase.supplierWithholdingEnabled
   */
  supplierWithholdingEnabledBill?: boolean;
  /** 1. ใบส่งของ — เลขที่/วันที่เมื่อมีติ๊ก */
  supportingDeliveryNote?: VendorBillSupportingDocumentLink;
  /** 2. ใบกำกับภาษี */
  supportingTaxInvoice?: VendorBillSupportingDocumentLink;
  /** 3. ใบเสร็จรับเงิน (จากคู่ค้า) */
  supportingMoneyReceipt?: VendorBillSupportingDocumentLink;
  /** สำหรับแสดงผล */
  purchaseNo?: string;
  vendorId: string;
  /** วันที่รับวางบิล */
  billingReceivedDate: string;
  /** วันที่ตั้งใจจ่ายเงิน */
  plannedPaymentDate: string;
  status: PurchaseVendorBillStatus;
  submittedToAccountingAt?: number;
  paidAt?: number;
  paidByUid?: string;
  paidByName?: string;
  /** รายการ cashbook ที่สร้างตอนบันทึกจ่าย (Step 5) */
  cashbookEntryId?: string;
  cashbookEntryNo?: string;
  /** หลักฐานการจ่าย (URL จาก Storage — มักเป็น PDF) */
  paymentProofUrl?: string;
  paymentProofFileName?: string;
  /** หลักฐานแนบหัก ณ ที่จ่าย (PDF) — เมื่อมีการหัก ณ ที่จ่ายในบิลนี้ */
  whtPaymentProofUrl?: string;
  whtPaymentProofFileName?: string;
  notes?: string;
  /** ลิงก์หนังสือรับรองหัก ณ ที่จ่าย (withholding_certificate_documents) */
  whtCertificateDocumentId?: string;
  /** เลือกจากเมนูบัญชี (ค่าขนส่ง 1% / ค่าบริการ 3% / ค่าเช่า 5%) — ใช้แทนอัตราจาก PO เมื่อมีค่า */
  vendorBillWhtPresetCategory?: VendorBillWhtPresetCategory;
  /**
   * บัญชีแก้อัตราหัก ณ ที่จ่ายเฉพาะใบนี้ (ก่อนจ่าย) เมื่อสโตร์ลง % จาก PO ผิด — ถ้าไม่มีใช้ purchase.supplierWithholdingRatePercent
   * เมื่อเลือก preset ระบบจะซิงค์ค่านี้ให้ตรงกับอัตรา preset
   */
  supplierWithholdingRatePercentBill?: number;
  /**
   * ฐานเงินที่ใช้คำนวณหัก ณ ที่จ่าย (ก่อนภาษี) เฉพาะใบนี้ — เมื่อไม่ระบุ ระบบใช้ยอดก่อนภาษีตามสัดส่วน/VAT ของใบ
   * ใช้เมื่อฐานหักตามกฎไม่เท่ากับยอดก่อนภาษีที่แสดงในใบวางบิล (ค่าไม่เกินยอดรวมในใบก่อนหัก ณ ที่จ่าย)
   */
  supplierWithholdingTaxBaseBill?: number | null;
  createdAt: number;
  updatedAt: number;
}

/** นิติบุคคล (บริษัท/ห้าง) vs บุคคลธรรมดา — ใช้ซ่อนสาขาในฟอร์มและพิมพ์หัก ณ ที่จ่ายให้ถูกต้อง */
export type VendorLegalForm = 'JURISTIC' | 'NATURAL';

export interface Vendor {
  id: string;
  vendorCode: string;
  vendorName: string;
  vendorType: VendorType;
  /** ไม่ระบุ = ถือเป็นนิติบุคคล (พฤติกรรมเดิม) */
  vendorLegalForm?: VendorLegalForm;
  taxId: string;
  branchType?: 'head_office' | 'branch';
  branchNo: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  /** รูปแบบการชำระเงิน: เงินสด / เครดิต (เก็บเป็นข้อความ Cash | Credit) */
  paymentTerms?: 'Cash' | 'Credit' | string;
  creditDays?: number;
  defaultCurrency?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankName?: string;
  status: 'ACTIVE' | 'INACTIVE';
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export type VendorType = 
  | 'PPE_SUPPLIER' 
  | 'TOOL_SUPPLIER' 
  | 'SERVICE_PROVIDER' 
  | 'TRANSPORT' 
  | 'ACCOMMODATION' 
  | 'OFFICE_EXPENSE' 
  | 'GENERAL_SUPPLIER';

export interface StoreItem {
  id: string;
  itemCode: string;
  /** ชื่อรายการหลัก (ไม่รวมขนาด/รุ่น) */
  itemName: string;
  /**
   * โครงสร้างคลังแบบหลัก–ย่อย: `header` = เมนชื่ออย่างเดียวไม่ถือสต็อกโดยตรง · `line` = รุ่น/ไซส์มีสต็อก · ไม่ระบุ = รายการเดี่ยวแบบเดิม
   */
  catalogGroupRole?: 'header' | 'line';
  /** รายการย่อยอ้างอิงเมนหลัก (`catalogGroupRole === 'line'`) */
  parentStoreItemId?: string;
  /** ขนาด/รุ่น เช่น Size M, 8\" — แยกจากชื่อเพื่อโควต้ารวมหลาย SKU */
  variantSpecification?: string;
  /** รหัสกลุ่มเดียวกันสำหรับโควต้าเบิกรวม (เช่น เสื้อ M กับ L ใช้คีย์เดียวกัน) */
  variantGroupKey?: string;
  category: string;
  unit: string;
  minimumStock: number;
  currentStock: number;
  isPPE: boolean;
  isTool: boolean;
  /** วัสดุสิ้นเปลือง — เบิกแล้วตัดสต็อก ไม่ติดตามรับคืน (ค่าเริ่มต้น = ต้องคืน) */
  isConsumable?: boolean;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

/** รายการที่ถือเป็น PPE ในคลัง — ใช้แยกหน้าทะเบียน PPE กับอุปกรณ์ทั่วไป */
export function storeItemIsPpeCatalog(item: Pick<StoreItem, 'isPPE' | 'category'>): boolean {
  return item.isPPE === true || (item.category || '') === 'PPE';
}

export function storeItemIsConsumable(item: Pick<StoreItem, 'isConsumable'> | null | undefined): boolean {
  return item?.isConsumable === true;
}

/** ประเภทเบิกในตำแหน่งงาน — อิง `isConsumable` / `isTool` จากทะเบียนคลัง (ไม่ใช่หมวด Workwear = consumable) */
export function storeItemToPositionToolItemType(
  item: Pick<StoreItem, 'isTool' | 'isConsumable'>,
): PositionToolRequirement['itemType'] {
  if (storeItemIsConsumable(item)) return 'consumable';
  if (item.isTool) return 'tool';
  return 'equipment';
}

export function resolvePositionToolRequirementItemType(
  req: Pick<PositionToolRequirement, 'itemType' | 'storeItemId' | 'storeCategory'>,
  storeItems: StoreItem[] | undefined,
): PositionToolRequirement['itemType'] {
  const linked = req.storeItemId ? storeItems?.find((s) => s.id === req.storeItemId) : undefined;
  if (linked) return storeItemToPositionToolItemType(linked);
  if (req.storeCategory === 'Tool') return 'tool';
  if (req.storeCategory === 'Workwear') return 'equipment';
  return req.itemType ?? 'equipment';
}

export function positionToolItemTypeLabel(type: PositionToolRequirement['itemType']): string {
  switch (type) {
    case 'consumable':
      return 'วัสดุสิ้นเปลือง';
    case 'tool':
      return 'เครื่องมือ';
    default:
      return 'อุปกรณ์';
  }
}

export function formatStoreItemLabel(item: Pick<StoreItem, 'itemName' | 'variantSpecification'>): string {
  const name = (item.itemName || '').trim();
  const spec = (item.variantSpecification || '').trim();
  if (!name && spec) return spec;
  return spec ? `${name} — ${spec}` : name;
}

export interface StoreTransaction {
  id: string;
  itemId: string;
  transactionType: TransactionType;
  quantity: number;
  workerId?: string;
  /** Office staff borrow (no field assignment) */
  officeStaffId?: string;
  issueType?: 'field' | 'office';
  assignmentId?: string;
  waveId?: string;
  transactionDate: string;
  referenceType?: string;
  referenceId?: string;
  notes?: string;
  createdAt: number;
  createdBy: string;
}

export type TransactionType = 'RECEIVE' | 'ISSUE' | 'RETURN' | 'WRITEOFF' | 'DAMAGED' | 'LOST';

/** เหตุการณ์อนุมัติ/ล็อกที่เก็บบนเอกสาร (คู่กับ audit_logs กลาง) */
export interface DocumentApprovalEvent {
  id: string;
  action: 'BILLING_CUSTOMER_APPROVED';
  at: number;
  actorUid: string;
  actorName: string;
  actorRole?: string;
  /** internal_ui = บันทึกแทนลูกค้าในระบบภายใน; client_portal = ลูกค้ากดเอง */
  channel: 'internal_ui' | 'client_portal';
  /** โทเคนอ้างอิงชุดเอกสาร (แสดงต่อท้ายเลขที่/QR ได้) */
  approvalToken: string;
  note?: string;
}

/** รูปสลิปลงเวลา/เอกสารลงนามแนบกับใบแจ้งหนี้ (ก่อน ISSUED) */
export interface TaxInvoiceTimesheetAttachment {
  id: string;
  storagePath: string;
  downloadUrl: string;
  fileName: string;
  contentType: string;
  uploadedAt: number;
  uploadedByUid?: string;
  uploadedByName?: string;
}

export interface TaxInvoice {
  id: string;
  taxInvoiceNo: string;
  /** อ้างอิงใบวางบิล (มักสร้างอัตโนมัติจากใบแจ้งหนี้เชิงพาณิชย์ — ผู้ใช้เลือกจาก «รายการใบแจ้งหนี้» ไม่ใช่เมนูใบวางบิล) */
  billingNoteId: string;
  /** สร้างจากใบเรียกเก็บ (commercial) หลังลูกค้า/OPEC ยืนยัน — พร้อม snapshot ใบวางบิล */
  sourceCommercialInvoiceId?: string;
  customerId: string;
  waveId?: string;
  issueDate: string;
  taxableAmount: number;
  vatAmount: number;
  /** ภาษีหัก ณ ที่จ่าย (จากใบวางบิล — ใช้สอดคล้องยอดลูกหนี้กับเงินรับจริง) */
  withholdingTaxAmount?: number;
  /**
   * แสดงยอดหัก ณ ที่จ่ายบนใบกำกับภาษี (ฐาน = ก่อน VAT, ภาษี = rate%, สุทธิ = ยอดรวมรวม VAT − หัก ณ ที่จ่าย)
   * ถ้า false แสดงเฉพาะยอดเงินฐานภาษี + VAT + ยอดรวมสุทธิแบบเดิม
   */
  showWithholdingOnDocument?: boolean;
  /** อัตราที่ใช้คำนวณบนเอกสารเมื่อแสดงหัก ณ ที่จ่าย (ค่าเริ่ม 3) */
  withholdingTaxRatePercentOnDocument?: number;
  totalAmount: number;
  currency: string;
  status: TaxInvoiceStatus;
  /** ภาษาเอกสารฉบับพิมพ์ ณ เวลาออกฉบับจริง (ISSUED) — ล็อกเพื่อให้พิมพ์ตรงกับลูกค้า/หน้าจอ (ไม่พึ่ง localStorage ฝ่ายเดียว) */
  printDocumentLocale?: 'th' | 'en';
  notes?: string;
  /** ผู้สร้างร่างใบกำกับ (จากใบเรียกเก็บ / บัญชี) */
  createdByUid?: string;
  createdByName?: string;
  /** ผู้ยืนยันออกเอกสารจริง (ISSUED) */
  issuedByUid?: string;
  issuedByName?: string;
  /** แนบรูปสลิป/เอกสารขณะสถานะ DRAFT */
  timesheetPaperAttachments?: TaxInvoiceTimesheetAttachment[];
  /** อ้างอิงแถวลูกหนี้ (AR) หลังออกเอกสารจริง */
  arEntryId?: string;
  /** ลูกค้ายืนยันยอด billing (แยกจาก payroll) — หลังตั้งค่า timesheet ที่เกี่ยวข้องจะถูกล็อก */
  billingCustomerApprovedAt?: number;
  billingCustomerApprovedByUid?: string;
  billingCustomerApprovedByName?: string;
  billingCustomerApprovalSource?: 'internal_representative' | 'client_portal';
  /** โทเคนอ้างอิงครั้งอนุมัติ billing (แนบท้ายเอกสาร/ตรวจสอบย้อนหลัง) */
  billingApprovalToken?: string;
  /** ประวัติอนุมัติบนเอกสาร (รายละเอียดเต็มอยู่ที่ audit_logs ด้วย) */
  billingApprovalEvents?: DocumentApprovalEvent[];
  createdAt: number;
  updatedAt: number;
  /** ขั้น 1: ลูกค้าหรือบัญชีแจ้งว่าได้ชำระเงินแล้ว (รอบัญชีตรวจและออกใบเสร็จ) */
  paymentNotifiedAt?: number;
  paymentNotifiedByUid?: string;
  paymentNotifiedByName?: string;
  paymentNotifySource?: 'client_portal' | 'accounting_ui';
  paymentNotificationNote?: string;
  /** ขั้น 2: บัญชียืนยันรับเงินแล้ว — ระบบออกเอกสาร ใบเสร็จรับเงิน แยก */
  paymentReceivedConfirmedAt?: number;
  paymentReceivedConfirmedByUid?: string;
  paymentReceivedConfirmedByName?: string;
  /** อ้างอิง `receipts/{id}` หลังออกเอกสาร */
  linkedReceiptId?: string;
  /** รายการ cashbook รับเงินลูกค้า หลังยืนยันรับเงิน + ออกใบเสร็จ */
  paymentReceivedCashbookEntryId?: string;
  /** บัญชีที่รับเงินเข้า (สอดคล้อง cashbook) */
  paymentReceivedBankAccountId?: string;
}

export type TaxInvoiceStatus = 'DRAFT' | 'ISSUED' | 'CANCELLED';

/** ใบเสร็จรับเงิน (ลูกค้า) — ออกหลังยืนยันรับเงินตามใบกำกับภาษี (แยกจากเอกสารกำกับ) */
export interface MoneyReceipt {
  id: string;
  receiptNo: string;
  taxInvoiceId: string;
  taxInvoiceNo: string;
  customerId: string;
  amount: number;
  currency: string;
  /** วันที่ออกเอกสาร (YYYY-MM-DD) */
  receiptDate: string;
  status: 'ISSUED';
  /** บัญชีธนาคารที่รับเงิน (ลง cashbook พร้อมกัน) */
  bankAccountId?: string;
  cashbookEntryId?: string;
  cashbookEntryNo?: string;
  createdAt: number;
  updatedAt: number;
  createdByUid?: string;
  createdByName?: string;
}

/** Simple Customer Issue / Dispute Request */
export type IssueCategory =
  | 'TIMESHEET'
  | 'BILLING_NOTE'
  | 'TAX_INVOICE'
  | 'RECEIPT'
  | 'COMMERCIAL_INVOICE'
  | 'QUOTATION'
  | 'GENERAL';
export type IssueStatus = 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'CLOSED';

export interface CustomerIssue {
  id: string;
  customerId: string;
  category: IssueCategory;
  referenceId: string; // The ID of the document being reported
  referenceNo: string; // The display code (Slip No, Invoice No)
  description: string;
  status: IssueStatus;
  createdBy: string;
  createdById: string;
  createdAt: number;
  updatedAt: number;
}

/** Exception Requests for Post-Approval Changes */
export type ExceptionRequestType = 'TIMESHEET_CORRECTION' | 'ASSIGNMENT_CHANGE';
export type ExceptionRequestStatus = 'PENDING' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED';

export interface ExceptionRequest {
  id: string;
  customerId: string;
  requestType: ExceptionRequestType;
  referenceId: string; // e.g. timesheetId or assignmentId
  referenceNo: string; // e.g. slipNo or assignmentNo
  reason: string;
  status: ExceptionRequestStatus;
  requestedBy: string;
  requestedById: string;
  requestedAt: number;
  reviewedBy?: string | null;
  reviewedAt?: number | null;
  internalNotes?: string | null;
  updatedAt: number;
}
