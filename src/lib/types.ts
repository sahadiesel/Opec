/**
 * OPEC OpsFlow - Master TypeScript Data Models
 * Strictly aligned with MASTER BLUEPRINT for OPEC Manpower Supply.
 */

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

export type ReadinessStatus = 
  | 'READY' 
  | 'MISSING_CERTIFICATE' 
  | 'MEDICAL_EXPIRED' 
  | 'DRUG_TEST_EXPIRED'
  | 'DOCUMENT_MISSING'
  | 'NOT_READY'
  | 'PARTIAL'
  | 'BLOCKED';

export type WorkerStatus = 'available' | 'assigned' | 'on_leave' | 'inactive';

export type DeploymentStatus = 
  | 'DRAFT'
  | 'READINESS_CHECK'
  | 'READY'
  | 'CLIENT_SUBMITTED'
  | 'CLIENT_APPROVED'
  | 'MOBILIZING'
  | 'ACTIVE'
  | 'DEMOBILIZED'
  | 'CLOSED';

export type ClientApprovalStatus = 
  | 'NOT_SUBMITTED'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED';

export type WaveStatus = 
  | 'PLANNING'
  | 'READY'
  | 'MOBILIZING'
  | 'ACTIVE'
  | 'DEMOBILIZING'
  | 'CLOSED';

export type MobilizationStatus = 
  | 'PENDING'
  | 'READY_TO_MOBILIZE'
  | 'MOBILIZING'
  | 'ACTIVE'
  | 'FAILED_CHECK';

export type PayrollRunStatus = 
  | 'DRAFT'
  | 'CALCULATED'
  | 'HR_REVIEW'
  | 'HR_APPROVED'
  | 'FINANCE_APPROVED'
  | 'LOCKED'
  | 'CANCELLED';

export type PayrollType = 'MONTHLY' | 'WAVE_BASED' | 'SPECIAL_RUN' | 'ADJUSTMENT';

export interface User {
  id: string;
  email: string;
  displayName: string;
  roleIds: RoleType[]; 
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  lastLoginAt?: number;
  lastLogoutAt?: number;
  customerId?: string; 
  isSharedAccount?: boolean;
  linkedProjectIds?: string[];
  nationalId?: string;
  address?: string;
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

export interface Position {
  id: string;
  positionName: string;
  positionCode: string;
  category: string;
  active: boolean;
  description: string;
  payrollBasis: 'Daily' | 'Monthly' | 'Hourly';
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export interface PositionCertificateRequirement {
  id: string;
  certificateName: string;
  certificateCode: string;
  required: boolean;
  validityMonths?: number;
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

// --- WORKER SUB-COLLECTIONS ---

export interface WorkerCertificate {
  id: string;
  certificateName: string;
  certificateCode: string;
  certificateNo: string;
  issuedBy: string;
  issueDate: number;
  expiryDate: number;
  status: 'valid' | 'expired' | 'pending_renewal';
  fileUrl?: string;
  notes?: string;
  _path: string;
}

export interface WorkerMedicalRecord {
  id: string;
  medicalType: string;
  examDate: number;
  expiryDate: number;
  fitStatus: 'fit' | 'unfit' | 'fit_with_restrictions';
  hospitalOrClinic: string;
  notes?: string;
  fileUrl?: string;
  _path: string;
}

export interface WorkerDrugTest {
  id: string;
  testDate: number;
  result: 'negative' | 'positive';
  expiryDate: number;
  laboratory: string;
  notes?: string;
  fileUrl?: string;
  _path: string;
}

export interface WorkerDocument {
  id: string;
  documentType: 'passport' | 'id_card' | 'house_reg' | 'other';
  documentNo: string;
  issueDate: number;
  expiryDate: number;
  fileUrl?: string;
  notes?: string;
  _path: string;
}

// --- COMMERCIAL MODULE ---

export interface Customer {
  id: string;
  name: string;
  customerCode: string;
  taxId: string;
  registeredAddress: string;
  billingAddress: string;
  phone: string;
  email: string;
  billingTerms: string;
  creditTerms: string;
  isActive: boolean;
  notes: string;
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
  notes: string;
  _path?: string;
}

export interface MainContract {
  id: string;
  customerId: string;
  contractNumber: string; 
  title: string;          
  projectId?: string;
  startDate: number;
  endDate: number;
  currency: string;
  billingTerms: string;
  paymentTerms: string;
  status: 'active' | 'expired' | 'pending' | 'closed';
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
  overtimeRule: string;
  active: boolean;
  notes?: string;
  _path: string;
}

export interface PurchaseOrder {
  id: string;
  contractId: string;
  customerId: string;
  poCode: string; 
  title: string;
  projectName?: string;
  description?: string;
  startDate: number;
  endDate: number;
  status: 'active' | 'closed' | 'pending';
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
  billingUnitSnapshot: 'daily' | 'monthly' | 'hourly';
  overtimeRuleSnapshot: string;
  status?: string;
  _path?: string;
}

export interface Wave {
  id: string;
  waveCode: string;
  poId: string;
  poLineId: string;
  customerId: string;
  projectName: string;
  siteLocation: string;
  startDate: string; // yyyy-mm-dd
  endDate: string;   // yyyy-mm-dd
  mobilizationDate: string; // yyyy-mm-dd
  demobilizationDate: string; // yyyy-mm-dd
  rotationPattern: string; 
  plannedWorkers: number;
  assignedWorkers: number;
  status: WaveStatus;
  notes: string;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  updatedBy: string;
}

export type ChecklistItemStatus = 'pass' | 'warning' | 'fail' | 'missing';

export interface ReadinessSummary {
  passportValid: ChecklistItemStatus;
  medicalValid: ChecklistItemStatus;
  certificatesComplete: ChecklistItemStatus;
  safetyTrainingComplete: ChecklistItemStatus;
  fitToWork: ChecklistItemStatus;
  ppeIssued: ChecklistItemStatus;
  toolsIssued: ChecklistItemStatus;
  overlapClear: ChecklistItemStatus;
  clientApproved: ChecklistItemStatus;
}

export interface Assignment {
  id: string;
  workerId: string;
  poLineId: string;
  poId: string; 
  contractId?: string;
  waveId: string; 
  positionId: string;
  customerId: string;
  projectName: string;
  startDate: string; // yyyy-mm-dd
  endDate: string;   // yyyy-mm-dd
  deploymentStatus: DeploymentStatus;
  clientApprovalStatus: ClientApprovalStatus;
  readinessStatus: 'incomplete' | 'ready';
  readinessSummary: ReadinessSummary;
  readinessUpdatedAt?: number;
  readinessUpdatedBy?: string;
  mobilizationStatus?: MobilizationStatus;
  mobilizationDate?: string;
  confirmedAt?: number;
  confirmedBy?: string;
  createdAt: number;
  updatedAt: number;
  notes?: string;
  clientComments?: string;
  _path?: string;
}

// --- PAYROLL MODULE ---

export interface PayrollRun {
  id: string;
  payrollRunNo: string;
  payrollPeriodStart: string; // yyyy-mm-dd
  payrollPeriodEnd: string;   // yyyy-mm-dd
  payrollType: PayrollType;
  currency: string;
  status: PayrollRunStatus;
  workerCount: number;
  grossAmount: number;
  totalAllowance: number;
  totalDeduction: number;
  netAmount: number;
  sourceTimesheetBatchIds: string[];
  notes: string;
  hrApprovedAt?: number;
  hrApprovedBy?: string;
  financeApprovedAt?: number;
  financeApprovedBy?: string;
  lockedAt?: number;
  lockedBy?: string;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  updatedBy: string;
}

export interface PayrollLine {
  id: string;
  workerId: string;
  assignmentId: string;
  waveId: string;
  positionId: string;
  timesheetBatchId?: string;
  sourceEntryRefs?: string[];
  normalDays: number;
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
  notes: string;
  createdAt: number;
  updatedAt: number;
  _path?: string;
}

// --- STORE / INVENTORY ---

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
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export type TransactionType = 'RECEIVE' | 'ISSUE' | 'RETURN' | 'ADJUST' | 'TRANSFER' | 'DAMAGED' | 'LOST';

export interface StoreTransaction {
  id: string;
  itemId: string;
  transactionType: TransactionType;
  quantity: number;
  fromLocation?: string;
  toLocation?: string;
  workerId?: string;
  assignmentId?: string;
  waveId?: string;
  referenceType?: string;
  referenceId?: string;
  transactionDate: string; // yyyy-mm-dd
  notes?: string;
  createdAt: number;
  createdBy: string;
}

export interface StoreIssueSlip {
  id: string;
  issueNo: string;
  workerId: string;
  assignmentId: string;
  waveId: string;
  positionId: string;
  issueDate: string;
  status: 'draft' | 'completed' | 'cancelled';
  notes?: string;
  createdAt: number;
  createdBy: string;
}

export interface StoreReturnSlip {
  id: string;
  returnNo: string;
  workerId: string;
  assignmentId: string;
  waveId: string;
  returnDate: string;
  status: 'draft' | 'completed' | 'cancelled';
  notes?: string;
  createdAt: number;
  createdBy: string;
}

// --- WORKFORCE ---

export interface Worker {
  id: string;
  firstName: string;
  lastName: string;
  nickname?: string;
  thaiNationalId: string;
  passportNo?: string;
  dateOfBirth: number;
  contactPhone: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  address?: string;
  currentPositionId: string;
  secondaryPositionIds?: string[];
  workerStatus: WorkerStatus;
  readinessStatus: ReadinessStatus;
  nationality: string;
  gender: string;
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
