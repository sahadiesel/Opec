/**
 * OPEC OpsFlow - Master TypeScript Data Models
 * Refined for Production Readiness with clear Staff vs Worker separation.
 */

export type DeptType = 'admin' | 'hr' | 'operations' | 'sales' | 'accounting' | 'store' | 'client';
export type AccessLevel = 'viewer' | 'officer' | 'manager' | 'admin';

/** Job Policy Modes */
export type JobMode = 'ONSHORE' | 'OFFSHORE';

export type RoleType = 
  | 'system_admin'
  | 'finance_officer'
  | 'sales_officer'
  | 'safety_officer'
  | 'hr_manager'
  | 'hr_officer'
  | 'operations_officer'
  | 'payroll_officer'
  | 'store_officer'
  | 'client_user'
  | 'client'; 

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
  | 'RECRUITING'          // สรรหา/มอบหมาย
  | 'MOBILIZING'          // ดำเนินการส่งตัว
  | 'ACTIVE'              // กำลังดำเนินโครงการ
  | 'COMPLETED'           // จบโครงการ
  | 'CLOSED';             // ปิดโครงการและสรุปบัญชี

export type PayrollRunStatus = 
  | 'DRAFT'               // ฉบับร่าง
  | 'PROCESSING'          // กำลังคำนวณ
  | 'HR_REVIEW'           // รอฝ่ายบุคคลตรวจสอบ
  | 'HR_APPROVED'         // ฝ่ายบุคคลอนุมัติ
  | 'FINANCE_APPROVED'    // ฝ่ายการเงินอนุมัติจ่าย
  | 'PAID'                // จ่ายเงินแล้ว
  | 'LOCKED'              // ปิดงวดถาวร
  | 'CANCELLED';          // ยกเลิก

export type BillingStatus = 
  | 'DRAFT'               // ฉบับร่าง
  | 'ISSUED'              // ออกเอกสารแล้ว
  | 'SUBMITTED'           // ส่งลูกค้าแล้ว
  | 'PARTIALLY_PAID'      // ชำระบางส่วน
  | 'PAID'                // ชำระครบถ้วน
  | 'OVERDUE'             // เกินกำหนดชำระ
  | 'CANCELLED';          // ยกเลิก

export interface User {
  id: string;
  email: string;
  displayName: string;
  department: DeptType;
  level: AccessLevel;
  roleIds: RoleType[];
  isActive: boolean;
  approvalStatus: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REJECTED';
  permissionProfileKey?: string | null;
  createdAt: number;
  updatedAt: number;
  notes?: string;
}

export interface PermissionProfile {
  id: string;
  profileKey: string;
  profileNameTh: string;
  profileNameEn: string;
  department: DeptType;
  level: AccessLevel;
  isActive: boolean;
  permissions: Record<string, {
    view: boolean;
    create: boolean;
    edit: boolean;
    delete: boolean;
    approve: boolean;
  }>;
  updatedAt: number;
  updatedBy: string;
}

export interface Position {
  id: string;
  positionCode: string;
  positionNameTh: string;
  positionNameEn: string;
  category: 'OFFSHORE' | 'ONSHORE' | 'OFFICE';
  jobMode: JobMode;
  payrollBasis: 'DAILY' | 'MONTHLY' | 'HOURLY';
  active: boolean;
  description?: string;
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
  email?: string;
  address?: string;
  currentPositionId: string;
  jobMode: JobMode;
  workerStatus: WorkerStatus;
  readinessStatus: ReadinessStatus;
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountName?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  skills: string[];
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PositionCertificateRequirement {
  id: string;
  certificateName: string;
  certificateCode: string;
  required: boolean;
  validityMonths: number;
  notes?: string;
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
}

export interface OfficeStaff {
  id: string;
  staffCode: string;
  fullName: string;
  department: DeptType;
  positionTitle: string;
  level: AccessLevel;
  employmentStatus: 'PROBATION' | 'ACTIVE' | 'RESIGNED' | 'SUSPENDED';
  supervisorId?: string;
  monthlySalary: number;
  bankName?: string;
  bankAccountNumber?: string;
  startDate: number;
  createdAt: number;
  updatedAt: number;
}

export interface Customer {
  id: string;
  customerCode: string;
  name: string;
  taxId: string;
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
  notes?: string;
}

export interface MainContract {
  id: string;
  contractNumber: string;
  customerId: string;
  title: string;
  projectId?: string;
  startDate: number;
  endDate: number;
  status: 'pending' | 'active' | 'expired' | 'closed';
  currency: string;
  billingTerms: string;
  paymentTerms: string;
  notes?: string;
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
  notes?: string;
}

export interface PurchaseOrder {
  id: string;
  poCode: string;
  contractId: string;
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
  status: 'active' | 'cancelled' | 'completed';
}

export interface Assignment {
  id: string;
  workerId: string;
  waveId: string;
  poId: string;
  poLineId: string;
  positionId: string;
  customerId: string;
  projectName: string;
  startDate: string;
  endDate: string;
  deploymentStatus: DeploymentStatus;
  clientApprovalStatus: ClientApprovalStatus;
  readinessStatus: 'incomplete' | 'ready';
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

export interface AuditLog {
  id: string;
  userId: string;
  userName: string;
  actionType: 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGOUT';
  entityType: string;
  entityId: string;
  timestamp: number;
  details?: string;
}
