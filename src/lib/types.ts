/**
 * OPEC OpsFlow - Master TypeScript Data Models
 * Strictly aligned with MASTER BLUEPRINT for OPEC Manpower Supply.
 */

export type RoleType = 
  | 'system_admin'
  | 'finance_officer'
  | 'sales_officer'
  | 'hr_manager'
  | 'hr_officer'
  | 'payroll_officer'
  | 'store_officer'
  | 'client';

export type ReadinessStatus = 
  | 'READY' 
  | 'MISSING_CERTIFICATE' 
  | 'MEDICAL_EXPIRED' 
  | 'DRUG_TEST_EXPIRED'
  | 'DOCUMENT_MISSING';

export type WorkerStatus = 'available' | 'assigned' | 'on_leave' | 'inactive';

export type AssignmentStatus = 
  | 'proposed'
  | 'client_review'
  | 'approved'
  | 'mobilizing'
  | 'active'
  | 'demobilized'
  | 'cancelled'
  | 'replaced';

export type ClientApprovalStatus = 'pending' | 'approved' | 'rejected' | 'replacement_requested';

export interface User {
  id: string;
  email: string;
  displayName: string;
  roleId: RoleType;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  lastLoginAt?: number;
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
  contractNumber: string; // Used as Contract Code
  title: string;          // Used as Contract Title
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

export interface Assignment {
  id: string;
  workerId: string;
  poLineId: string;
  poId: string; 
  positionId: string;
  customerId: string;
  projectName: string;
  startDate: number;
  endDate: number;
  status: AssignmentStatus;
  clientApprovalStatus: ClientApprovalStatus;
  createdAt: number;
  updatedAt: number;
  notes?: string;
  clientComments?: string;
  _path?: string;
}

// --- HR & WORKFORCE ---

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