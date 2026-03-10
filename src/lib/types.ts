export type RoleType = 
  | 'system_admin'
  | 'sales_officer'
  | 'hr_manager'
  | 'hr_officer'
  | 'payroll_officer'
  | 'store_officer'
  | 'finance_officer';

export type ReadinessStatus = 'READY' | 'MISSING_CERTIFICATE' | 'MEDICAL_EXPIRED' | 'DOCUMENT_MISSING';

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: RoleType;
  createdAt: number;
}

export interface Position {
  id: string;
  name: string; // e.g., Offshore Welder
  description?: string;
  department?: string;
}

export interface PositionRequirement {
  id: string;
  positionId: string;
  type: 'certificate' | 'ppe' | 'tool' | 'medical';
  name: string;
  description?: string;
}

export interface Worker {
  id: string;
  firstName: string;
  lastName: string;
  nationalId: string;
  positionId: string;
  status: 'available' | 'assigned' | 'inactive';
  readinessStatus: ReadinessStatus;
  lastDrugTestDate?: number;
  lastMedicalCheckDate?: number;
}

export interface WorkerCertificate {
  id: string;
  workerId: string;
  name: string;
  issueDate: number;
  expiryDate: number;
  fileUrl?: string;
}

export interface WorkerMedicalRecord {
  id: string;
  workerId: string;
  checkDate: number;
  expiryDate: number;
  result: 'pass' | 'fail';
  notes?: string;
}

export interface WorkerDrugTest {
  id: string;
  workerId: string;
  testDate: number;
  result: 'positive' | 'negative';
}

export interface AuditLog {
  id: string;
  userId: string;
  userName: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  collection: string;
  documentId: string;
  timestamp: number;
  changes?: any;
}
