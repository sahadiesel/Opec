import { doc, type Firestore } from 'firebase/firestore';
import type { OfficePayrollLine, PayrollBatchLine } from '@/lib/types';
import { stripUndefinedForFirestore } from '@/lib/firestore/strip-undefined-for-firestore';

export type OfficeStaffSelfPayrollLineIndex = {
  lineId: string;
  officePayrollRunId?: string;
  payrollMonth?: string;
  updatedAt: number;
  line: OfficePayrollLine;
};

export type WorkerSelfPayrollLineIndex = {
  lineId: string;
  payrollBatchId?: string;
  periodEndDate?: string;
  updatedAt: number;
  line: PayrollBatchLine;
};

export function officeStaffSelfPayrollLineIndexRef(firestore: Firestore, staffId: string, lineId: string) {
  return doc(firestore, 'office_staff', staffId, 'self_payroll_lines', lineId);
}

export function workerSelfPayrollLineIndexRef(firestore: Firestore, workerId: string, lineId: string) {
  return doc(firestore, 'workers', workerId, 'self_payroll_lines', lineId);
}

export function buildOfficeStaffSelfPayrollLineIndex(line: OfficePayrollLine): OfficeStaffSelfPayrollLineIndex {
  return stripUndefinedForFirestore({
    lineId: line.id,
    officePayrollRunId: line.officePayrollRunId,
    payrollMonth: line.payrollMonth,
    updatedAt: line.updatedAt || Date.now(),
    line,
  }) as OfficeStaffSelfPayrollLineIndex;
}

export function buildWorkerSelfPayrollLineIndex(line: PayrollBatchLine): WorkerSelfPayrollLineIndex {
  return stripUndefinedForFirestore({
    lineId: line.id,
    payrollBatchId: line.payrollBatchId,
    periodEndDate: line.periodEndDate,
    updatedAt: line.updatedAt ?? line.createdAt ?? Date.now(),
    line,
  }) as WorkerSelfPayrollLineIndex;
}
