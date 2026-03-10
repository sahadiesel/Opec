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

// --- COMMERCIAL MODULE ---

export interface Customer {
  id: string;
  name: string;
  taxId: string;
  address: string;
  isActive: boolean;
  createdAt: number;
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
  poLineId: string;
  positionId: string;
  customerId: string;
  startDate: number;
  endDate: number;
  status: AssignmentStatus;
  createdAt: number;
  updatedAt: number;
  clientComments?: string;
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
  workerStatus: WorkerStatus;
  readinessStatus: ReadinessStatus;
  nationality: string;
  gender: string;
  createdAt: number;
  updatedAt: number;
}
