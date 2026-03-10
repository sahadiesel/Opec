
import { Role, Position, Worker, ReadinessStatus } from './types';

export const SEED_ROLES: Role[] = [
  { id: 'system_admin', name: 'system_admin', description: 'Full access', permissions: ['*'] },
  { id: 'hr_manager', name: 'hr_manager', description: 'Worker & Position management', permissions: ['workers.*', 'positions.*'] },
  { id: 'sales_officer', name: 'sales_officer', description: 'Commercial access', permissions: ['customers.*', 'contracts.*'] },
];

export const SEED_POSITIONS: Position[] = [
  { id: 'POS001', name: 'Offshore Welder', code: 'OWEL', description: 'Maintain offshore platforms', isActive: true },
  { id: 'POS002', name: 'Safety Officer', code: 'SAFE', description: 'HSE Oversight', isActive: true },
];

export const SEED_WORKERS: Partial<Worker>[] = [
  {
    id: 'WKR001',
    firstName: 'สมชาย',
    lastName: 'สายชล',
    thaiNationalId: '1234567890123',
    dateOfBirth: new Date('1985-05-20').getTime(),
    contactPhone: '081-234-5678',
    currentPositionId: 'POS001',
    workerStatus: 'available',
    readinessStatus: 'READY' as ReadinessStatus,
    nationality: 'Thai',
    gender: 'Male',
  },
  {
    id: 'WKR002',
    firstName: 'วิภา',
    lastName: 'รักไทย',
    thaiNationalId: '3210987654321',
    dateOfBirth: new Date('1990-11-12').getTime(),
    contactPhone: '089-987-6543',
    currentPositionId: 'POS002',
    workerStatus: 'assigned',
    readinessStatus: 'MISSING_CERTIFICATE' as ReadinessStatus,
    nationality: 'Thai',
    gender: 'Female',
  }
];
