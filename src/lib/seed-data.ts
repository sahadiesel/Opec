
import { Role, Position, Worker, ReadinessStatus } from './types';

export const SEED_ROLES: Role[] = [
  { id: 'system_admin', name: 'system_admin', description: 'Full access', permissions: ['*'] },
  { id: 'hr_manager', name: 'hr_manager', description: 'Worker & Position management', permissions: ['workers.*', 'positions.*'] },
  { id: 'sales_officer', name: 'sales_officer', description: 'Commercial access', permissions: ['customers.*', 'contracts.*'] },
];

const now = Date.now();

export const SEED_POSITIONS: Position[] = [
  {
    id: 'POS001',
    positionCode: 'OWEL',
    positionName: 'Offshore Welder',
    positionNameTh: 'Offshore Welder',
    positionNameEn: 'Offshore Welder',
    category: 'OFFSHORE',
    jobMode: 'OFFSHORE',
    payrollBasis: 'DAILY',
    active: true,
    description: 'Maintain offshore platforms',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'POS002',
    positionCode: 'SAFE',
    positionName: 'Safety Officer',
    positionNameTh: 'Safety Officer',
    positionNameEn: 'Safety Officer',
    category: 'ONSHORE',
    jobMode: 'ONSHORE',
    payrollBasis: 'DAILY',
    active: true,
    description: 'HSE Oversight',
    createdAt: now,
    updatedAt: now,
  },
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
    workerStatus: 'AVAILABLE',
    readinessStatus: 'READY' as ReadinessStatus,
    nationality: 'Thai',
    gender: 'MALE',
    jobMode: 'OFFSHORE',
    skills: [],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'WKR002',
    firstName: 'วิภา',
    lastName: 'รักไทย',
    thaiNationalId: '3210987654321',
    dateOfBirth: new Date('1990-11-12').getTime(),
    contactPhone: '089-987-6543',
    currentPositionId: 'POS002',
    workerStatus: 'ASSIGNED',
    readinessStatus: 'MISSING_CERTIFICATE' as ReadinessStatus,
    nationality: 'Thai',
    gender: 'FEMALE',
    jobMode: 'ONSHORE',
    skills: [],
    createdAt: now,
    updatedAt: now,
  }
];
