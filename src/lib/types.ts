/**
 * OPEC OpsFlow - Master TypeScript Data Models
 * Strictly aligned with MASTER BLUEPRINT for OPEC Manpower Supply.
 */

export type RoleType = 
  | 'system_admin'     // P'Joe
  | 'finance_officer'  // P'Joe
  | 'sales_officer'    // Dom
  | 'hr_manager'       // Nuch
  | 'hr_officer'       // Ying
  | 'payroll_officer'  // Koy
  | 'store_officer'    // Nut
  | 'client';          // Shared customer account

export type ReadinessStatus = 
  | 'READY' 
  | 'MISSING_CERTIFICATE' 
  | 'MEDICAL_EXPIRED' 
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

export type ClientApprovalStatus = 
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'replacement_requested';

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

export interface Position {
  id: string;
  name: string;
  code: string;
  description?: string;
  isActive: boolean;
}

export interface PositionRequirement {
  id: string;
  positionId: string;
  type: 'certificate' | 'ppe' | 'tool';
  name: string;
  description?: string;
  isMandatory: boolean;
}

// --- COMMERCIAL MODULE ---

export interface Customer {
  id: string;
  name: string;
  taxId: string;
  address: string;
  isActive: boolean;
  createdAt: number;
}

export interface ContactPerson {
  id: string;
  customerId: string;
  name: string;
  position: string;
  email: string;
  phone: string;
}

export interface MainContract {
  id: string;
  customerId: string;
  contractNumber: string;
  title: string;
  startDate: number;
  endDate: number;
  status: 'active' | 'expired' | 'pending';
  createdAt: number;
}

export interface MainContractPositionRate {
  id: string;
  contractId: string;
  positionId: string;
  sellRate: number;
  billingUnit: 'daily' | 'monthly' | 'hourly';
}

export interface PurchaseOrder {
  id: string;
  contractId: string;
  customerId: string;
  poNumber: string;
  title: string;
  startDate: number;
  endDate: number;
  status: 'active' | 'closed' | 'pending';
  createdAt: number;
}

export interface POLine {
  id: string;
  poId: string;
  positionId: string;
  quantity: number;
  sellRateSnapshot: number;
  costBaselineSnapshot: number;
  billingUnitSnapshot: 'daily' | 'monthly' | 'hourly';
  overtimeRuleSnapshot: string;
}

export interface Assignment {
  id: string;
  workerId: string;
  poId: string;
  poLineId: string;
  positionId: string;
  customerId: string;
  projectId?: string;
  startDate: number;
  endDate: number;
  status: AssignmentStatus;
  clientApprovalStatus: ClientApprovalStatus;
  clientComments?: string;
  createdAt: number;
  updatedAt: number;
}

// --- HR & WORKFORCE ---

export interface Worker {
  id: string;
  firstName: string;
  lastName: string;
  thaiNationalId: string;
  dateOfBirth: number;
  contactPhone: string;
  currentPositionId: string;
  secondaryPositionIds?: string[]; 
  workerStatus: WorkerStatus;
  readinessStatus: ReadinessStatus;
  nationality: string;
  gender: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorkerCertificate {
  id: string;
  workerId: string;
  certificateName: string;
  expiryDate: number;
  isVerified: boolean;
}

export interface WorkerMedicalRecord {
  id: string;
  workerId: string;
  checkDate: number;
  expiryDate: number;
  result: 'pass' | 'fail';
}

export interface WorkerDrugTest {
  id: string;
  workerId: string;
  testDate: number;
  result: 'negative' | 'positive';
}

export interface WorkerDocument {
  id: string;
  workerId: string;
  name: string;
  type: string;
  uploadDate: number;
}

export interface AuditLog {
  id: string;
  userId: string;
  userName: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'APPROVE' | 'REPLACE';
  collection: string;
  documentId: string;
  timestamp: number;
  changes?: any;
}
