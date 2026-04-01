
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
  | 'store_officer'
  | 'store_manager'
  | 'client_user'; 

export type BusinessRoleKey = 
  | 'system_admin'
  | 'admin_admin'
  | 'payroll_officer'
  | 'sales_manager'
  | 'sales_officer'
  | 'hr_manager'
  | 'hr_officer'
  | 'operations_manager'
  | 'operations_officer'
  | 'operation_manager'
  | 'operation_officer'
  | 'accounting_manager'
  | 'accounting_officer'
  | 'store_manager'
  | 'store_officer'
  | 'client_user';

/** Readiness Status for Workers (ลูกจ้าง) */
export type ReadinessStatus = 
  | 'READY'               // พร้อมปฏิบัติงาน
  | 'INCOMPLETE'          // ข้อมูลไม่ครบถ้วน
  | 'MISSING_CERTIFICATE' // ขาดใบรับรองบังคับ
  | 'MEDICAL_EXPIRED'     // ใบรับรองแพทย์หมดอายุ
  | 'DRUG_TEST_EXPIRED'   // ผลตรวจสารเสพติดหมดอายุ
  | 'DOCUMENT_EXPIRED'    // เอกสารระบุตัวตนหมดอายุ
  | 'BLOCKED';            // ระงับการส่งตัว (วินัย/อื่นๆ)

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

export type PayrollPolicyKind = 'sso' | 'tax' | 'allowance_deduction';

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

export type ApprovalStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REJECTED';

export type UserType = 'internal' | 'customer_portal';

export type DataAccessClass = 'staff' | 'client' | 'admin';

export type PortalRole = 'approver' | 'viewer';

/** Primary org partition for permission profiles (aligns with User.accessGroup). */
export type DepartmentGroup = 'admin' | 'operation' | 'accounting' | 'client';

export interface User {
  id: string;
  email: string;
  displayName: string;
  /** เบอร์โทร (เช่น ลงทะเบียนผ่านหน้าแรก) */
  phone?: string;

  // FUTURE PRIMARY ACCESS MODEL (internal: accessGroup + accessLevel + allowedModules; portal separate)
  userType?: 'internal' | 'customer_portal';
  accessGroup?: 'admin' | 'operation' | 'accounting' | 'client';
  /** Same partition as {@link accessGroup} (new naming); keep both in sync when writing. */
  departmentGroup?: DepartmentGroup;
  accessLevel?: 'admin' | 'manager' | 'officer' | 'viewer';
  allowedModules?: string[];
  portalRole?: 'approver' | 'viewer';
  customerId?: string | null;

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
  /** @deprecated Legacy authorization — replace with FUTURE PRIMARY ACCESS MODEL. */
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
  /** Primary partition for new UI & assignment rules (admin / operation / accounting / client). */
  departmentGroup?: DepartmentGroup;
  /**
   * @deprecated Legacy single-department label; keep for reads / migration. Prefer {@link departmentGroup}.
   */
  department?: DeptType;
  /** Access tier within {@link departmentGroup} (viewer → admin). */
  level: AccessLevel;
  /** Optional canonical template id (e.g. admin_admin, operation_manager). */
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
  email?: string;
  address?: string;
  currentPositionId: string;
  jobMode: JobMode;
  workerStatus: WorkerStatus;
  readinessStatus: ReadinessStatus;
  complianceAlertLevel?: 'ok' | 'warning' | 'blocked';
  nearestExpiryInDays?: number | null;
  nearestExpiryAt?: number | null;
  /** สรุปแผงสารเสพติดสำหรับแดชบอร์ด (อัปเดตจากหน้ารายละเอียดคนงาน) */
  drugPanelSummaryKind?: 'pending' | 'partial' | 'pass' | 'positive' | 'none_panel';
  drugPanelSummaryText?: string;
  drugPanelPassedCount?: number;
  drugPanelTotalCount?: number;
  totalWorkedHours?: number;
  firstWorkedAt?: number | null;
  lastWorkedAt?: number | null;
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountName?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  skills: string[];
  notes?: string;
  disciplinaryNotes?: string;
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
}

/** Store catalog categories — keep in sync with `src/app/store/items/page.tsx` */
export const STORE_ITEM_CATEGORIES = ['PPE', 'Safety', 'Mechanical', 'Electrical', 'General'] as const;
export type StoreItemCatalogCategory = (typeof STORE_ITEM_CATEGORIES)[number];

export interface OfficeStaff {
  id: string;
  staffCode: string;
  fullName: string;
  nickname?: string;
  department: string;
  /** Optional link to {@link Position} when chosen from ตำแหน่งงาน (category OFFICE). */
  positionId?: string;
  positionTitle: string;
  /** แยกงวดเงินเดือน: พนักงานทั่วไป vs ผู้บริหาร (จัดการในบัญชี — ไม่รวมในงวด office ทั่วไป) */
  payrollBand?: 'OFFICE' | 'EXECUTIVE';
  employmentType: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT';
  salaryType: 'MONTHLY' | 'DAILY';
  monthlySalary: number;
  startDate: string;
  bankName?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  taxId?: string;
  socialSecurityNo?: string;
  status: 'ACTIVE' | 'INACTIVE' | 'RESIGNED';
  notes?: string;
  linkedUserId?: string;
  supervisorId?: string;
  createdAt: number;
  createdBy?: string;
  updatedAt: number;
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

export interface MainContract {
  id: string;
  contractNumber: string;
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
  /** Commercial terms started by sales (sell-side); cost baseline is filled by HR Manager / Admin only in UI */
  commercialTermsOwner?: 'sales' | 'operations';
  /** Denormalized: position_rates where sellRate > 0 but costBaseline <= 0 */
  costingStatus?: string;
  costingMissingPositionsCount?: number;
  costingUpdatedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface PositionRate {
  id: string;
  positionId: string;
  sellRate: number;
  costBaseline: number;
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
  normalWorkHours?: 8 | 12;
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
}

export interface PurchaseOrder {
  id: string;
  poCode: string;
  /** Customer-issued PO document number (external reference) */
  customerPONumber?: string;
  /** contract = based on active contract, quotation = based on approved/sent quotation */
  poType?: 'contract' | 'quotation';
  contractId: string;
  quotationId?: string;
  customerId: string;
  title: string;
  projectName: string;
  description: string;
  startDate: number;
  endDate: number;
  status: 'pending' | 'active' | 'closed';
  notes?: string;
  createdAt: number;
  updatedAt: number;
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
  quantity: number;
  startDate: number;
  endDate: number;
  sellRateSnapshot: number;
  costBaselineSnapshot: number;
  billingUnitSnapshot: string;
  overtimeRuleSnapshot: string;
  sellOtRulesSnapshot?: OtRulesSnapshot;
  costOtRulesSnapshot?: OtRulesSnapshot;
  normalWorkHoursSnapshot?: 8 | 12;
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

export interface Assignment {
  id: string;
  assignmentNo: string;
  workerId: string;
  waveId: string;
  /** Required for new mobilizations: links to sales_contract_terms doc; enforced in Firestore rules on create */
  salesContractTermId?: string;
  poId: string;
  poLineId: string;
  /** Optional: copied from PO for downstream screens (e.g. mobilization) */
  contractId?: string;
  positionId: string;
  customerId: string;
  projectName: string;
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
  };
  clientComments?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export type ChecklistItemStatus = 'pass' | 'fail' | 'warning' | 'missing';

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
  date: string;
  workerId: string;
  workerNameSnapshot: string;
  assignmentId: string;
  waveId: string;
  contractId: string;
  /** Optional link to labor cost contract term for payroll costing */
  laborCostContractTermId?: string;
  purchaseOrderId: string;
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

  createdAt: number;
  updatedAt: number;
  lockedAt?: number;
  lockedBy?: string;
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
}

export interface AccountsReceivable {
  id: string;
  customerId: string;
  documentNo: string;
  referenceType: 'TAX_INVOICE' | 'BILLING_NOTE';
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
  status: BankAccountStatus;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export type BankAccountType = 'SAVINGS' | 'CURRENT' | 'CASH';
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
  createdAt: number;
  updatedAt: number;
}

export type BillingNoteReferenceType = 'CONTRACT' | 'PO' | 'TIMESHEET' | 'SERVICE';

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
}

export type CashbookEntryType = 'CUSTOMER_RECEIPT' | 'SUPPLIER_PAYMENT' | 'PAYROLL' | 'TAX' | 'TRANSFER' | 'OTHER';
export type PaymentMethod = 'TRANSFER' | 'CASH' | 'CHEQUE' | 'OTHER';

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
  createdAt: number;
  updatedAt: number;
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
  hrApprovedBy?: string;
  hrApprovedAt?: number;
  financePreparedBy?: string;
  financePreparedAt?: number;
  lockedBy?: string;
  lockedAt?: number;
  createdBy: string;
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface PayrollBatchLine {
  id: string;
  payrollBatchId: string;
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
  exportStatus: 'pending' | 'exported' | 'failed';
  remarks?: string;
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
 * Profit estimation snapshots for commercial analysis
 */
export interface PurchaseOrderProfitSnapshot {
  id: string;
  purchaseOrderId: string;
  waveId?: string | null;
  periodStartDate: string;
  periodEndDate: string;
  estimatedRevenue: number;
  estimatedLaborCost: number;
  estimatedGrossProfit: number;
  estimatedGrossMarginPercent: number;
  calculationBasisSummary: string;
  generatedAt: number;
  generatedBy: string;
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
  _path?: string;
}

export interface WorkerDocument {
  id: string;
  documentType: string;
  documentNo: string;
  issueDate: number;
  expiryDate: number;
  _path?: string;
}

export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: string[];
}

export interface Purchase {
  id: string;
  purchaseNo: string;
  vendorId: string;
  purchaseDate: string;
  purchaseType: PurchaseType;
  totalAmount: number;
  amountBeforeTax: number;
  vatAmount: number;
  status: PurchaseStatus;
  notes?: string;
  paymentStatus?: string;
  storeReceiptStatus?: string;
  createdAt: number;
  updatedAt: number;
}

export type PurchaseType = 'CASH' | 'CREDIT';
export type PurchaseStatus = 'DRAFT' | 'ISSUED' | 'COMPLETED' | 'CANCELLED';

export interface PurchaseLine {
  id: string;
  purchaseId: string;
  itemDescription: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  createdAt: number;
}

export interface Vendor {
  id: string;
  vendorCode: string;
  vendorName: string;
  vendorType: VendorType;
  taxId: string;
  branchType?: 'head_office' | 'branch';
  branchNo: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  paymentTerms?: string;
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
  itemName: string;
  category: string;
  unit: string;
  minimumStock: number;
  currentStock: number;
  isPPE: boolean;
  isTool: boolean;
  active: boolean;
  createdAt: number;
  updatedAt: number;
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

export interface Receipt {
  id: string;
  receiptNo: string;
  customerId: string;
  receiptDate: string;
  /**
   * ยอดตามใบเสร็จ — ต้องตรงกับใบกำกับภาษีเมื่อชำระครบ (เช่น 100+VAT = 107)
   */
  receivedAmount: number;
  /**
   * เงินโอนเข้าบัญชีจริง — น้อยกว่า receivedAmount เมื่อมีหัก ณ (เช่น 104)
   * ถ้าไม่ระบุ = ไม่มีหัก ณ ที่แยก ใช้ receivedAmount ทั้งหมดเป็นยอดเข้าบัญชี
   */
  cashDepositAmount?: number;
  /**
   * ภาษีหัก ณ ที่จ่ายคู่กับใบกำกับ — ปิดลูกหนี้ด้วยเอกสารหัก ณ ไม่ผ่านเงินเข้าบัญชี (เช่น 3)
   * receivedAmount ≈ cashDepositAmount + withholdingTaxAmount
   */
  withholdingTaxAmount?: number;
  /** เลขที่หนังสือหัก ณ ที่จ่าย (ระดับใบเสร็จ ถ้ามี) */
  whtCertificateNo?: string;
  paymentMethod: PaymentMethod;
  bankAccountId: string;
  status: ReceiptStatus;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export type ReceiptStatus = 'DRAFT' | 'ISSUED' | 'CANCELLED';

export interface ReceiptAllocation {
  id: string;
  receiptId: string;
  taxInvoiceId: string;
  /** เงินโอน — ตัดลูกหนี้และนับในยอดเข้าบัญชี (ส่วนของยอดใบเสร็จที่เป็นเงินสด) */
  amountAllocated: number;
  /** หัก ณ คู่ใบกำกับ — ตัดลูกหนี้ด้วยเอกสารหัก ณ ไม่ผ่านเงินเข้าบัญชี */
  withholdingTaxAmount?: number;
  /** เลขที่หนังสือหัก ณ ที่จ่าย */
  whtCertificateNo?: string;
  createdAt: number;
}

export interface TaxInvoice {
  id: string;
  taxInvoiceNo: string;
  billingNoteId: string;
  customerId: string;
  waveId?: string;
  issueDate: string;
  taxableAmount: number;
  vatAmount: number;
  /** ภาษีหัก ณ ที่จ่าย (จากใบวางบิล — ใช้สอดคล้องยอดลูกหนี้กับเงินรับจริง) */
  withholdingTaxAmount?: number;
  totalAmount: number;
  currency: string;
  status: TaxInvoiceStatus;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export type TaxInvoiceStatus = 'DRAFT' | 'ISSUED' | 'CANCELLED';

/** Simple Customer Issue / Dispute Request */
export type IssueCategory = 'TIMESHEET' | 'BILLING_NOTE' | 'TAX_INVOICE' | 'RECEIPT' | 'GENERAL';
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
