
/**
 * OPEC OpsFlow - TypeScript Data Models
 * Aligned with MASTER BLUEPRINT for OPEC Manpower Supply.
 */

export type RoleType = 
  | 'system_admin'
  | 'sales_officer'
  | 'hr_manager'
  | 'hr_officer'
  | 'payroll_officer'
  | 'store_officer'
  | 'finance_officer';

export type ReadinessStatus = 
  | 'READY' 
  | 'MISSING_CERTIFICATE' 
  | 'MEDICAL_EXPIRED' 
  | 'DOCUMENT_MISSING';

export type WorkerStatus = 'available' | 'assigned' | 'on_leave' | 'inactive';

export interface User {
  id: string;
  email: string;
  displayName: string;
  address?: string;      // Added for Staff/Admin
  nationalId?: string;   // Added for Staff/Admin
  roleId: RoleType;
  createdAt: number;
  updatedAt: number;
  lastLoginAt?: number;
  isActive: boolean;
}

export interface Role {
  id: string;
  name: RoleType;
  description: string;
  permissions: string[];
}

export interface Position {
  id: string;
  name: string;
  code: string;
  description?: string;
  isActive: boolean;
}

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
  actionType: 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN';
  entityType: string;
  entityId: string;
  timestamp: number;
  details: string; // JSON string or text
  ipAddress?: string;
}
