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
  nameTh: string;
  nameEn: string;
  taxId: string;
  registeredAddress: string;
  billingAddress: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface MainContract {
  id: string;
  contractNo: string;
  customerId: string;
  title: string;
  startDate: number;
  endDate: number;
  status: 'ACTIVE' | 'EXPIRED' | 'TERMINATED';
  currency: 'THB' | 'USD';
  createdAt: number;
  updatedAt: number;
}

export interface Assignment {
  id: string;
  workerId: string;
  waveId: string;
  poId: string;
  poLineId: string;
  positionId: string;
  startDate: string;
  endDate: string;
  status: DeploymentStatus;
  readinessStatus: 'INCOMPLETE' | 'READY';
  createdAt: number;
  updatedAt: number;
}

export interface Wave {
  id: string;
  waveCode: string;
  customerId: string;
  projectName: string;
  siteLocation: string;
  startDate: string;
  endDate: string;
  status: WaveStatus;
  plannedWorkers: number;
  assignedWorkers: number;
  createdAt: number;
  updatedAt: number;
}

export interface AuditLog {
  id: string;
  userId: string;
  userName: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'APPROVE' | 'LOCK' | 'LOGIN' | 'LOGOUT';
  collection: string;
  documentId: string;
  timestamp: number;
  changes?: any;
}
