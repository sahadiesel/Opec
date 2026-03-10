/**
 * OPEC OpsFlow - TypeScript Data Models
 * Strictly aligned with MASTER BLUEPRINT for OPEC Manpower Supply.
 */

export type RoleType = 
  | 'system_admin'
  | 'sales_officer'
  | 'hr_manager'
  | 'hr_officer'
  | 'payroll_officer'
  | 'store_officer'
  | 'finance_officer'
  | 'client'; // Added for Client Portal access

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

export interface User {
  id: string;
  email: string;
  displayName: string;
  address?: string;
  nationalId?: string;
  roleId: RoleType;
  customerId?: string; // For client-role users to restrict data to their organization
  createdAt: number;
  updatedAt: number;
  lastLoginAt?: number;
  isActive: boolean;
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
  type: 'certificate' | 'ppe' | 'tool' | 'medical';
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
  customerId: string; // Helpful for queries
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
  poLineId: string;
  poId: string; // Reference for easier access
  customerId: string; // Reference for Client Portal
  positionId: string;
  startDate: number;
  endDate: number;
  status: AssignmentStatus;
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
  contactEmail?: string;
  contactPhone: string;
  currentPositionId: string;
  workerStatus: WorkerStatus;
  readinessStatus: ReadinessStatus;
  nationality: string;
  gender: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorkerDocument {
  id: string;
  workerId: string;
  documentType: string;
  documentNumber: string;
  expiryDate?: number;
  documentUrl: string;
  isVerified: boolean;
}

export interface WorkerCertificate {
  id: string;
  workerId: string;
  certificateName: string;
  issuingAuthority: string;
  certificateNumber: string;
  issueDate: number;
  expiryDate: number;
  documentUrl?: string;
  isVerified: boolean;
}

export interface WorkerMedicalRecord {
  id: string;
  workerId: string;
  medicalCheckType: string;
  clinicName: string;
  examinationDate: number;
  expiryDate: number;
  overallFitnessStatus: string;
  documentUrl?: string;
  isVerified: boolean;
}

export interface WorkerDrugTest {
  id: string;
  workerId: string;
  testDate: number;
  testingFacility: string;
  result: 'negative' | 'positive' | 'pending';
  documentUrl?: string;
  isVerified: boolean;
}

export interface AuditLog {
  id: string;
  userId: string;
  actionType: 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'APPROVAL' | 'REJECTION';
  entityType: string;
  entityId: string;
  timestamp: number;
  details: string;
  ipAddress?: string;
}
