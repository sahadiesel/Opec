import type { Firestore } from 'firebase/firestore';
import type { User } from '@/lib/types';
import { writeAuditLog } from '@/lib/services/audit-service';

export async function auditPayrollWorkerWhtSinglePrint(
  db: Firestore,
  user: User,
  params: {
    batchId: string;
    settlementLineId: string;
    workerId: string;
    documentNo: string;
    copyVariant: string;
    result: 'success' | 'error';
    errorMessage?: string;
  },
): Promise<void> {
  await writeAuditLog(db, user, {
    actionType: 'PRINT_PAYROLL_WHT_SINGLE',
    entityType: 'PayrollWorkerWhtCertificate',
    entityId: params.settlementLineId,
    entityLabel: params.documentNo,
    payrollBatchId: params.batchId,
    linkedIds: [params.workerId, params.documentNo],
    sourceModule: 'payroll',
    afterSummary: `[${params.result}] worker=${params.workerId} copy=${params.copyVariant}${params.errorMessage ? ` — ${params.errorMessage}` : ''}`,
  });
}

export async function auditPayrollWorkerWhtBatchPrint(
  db: Firestore,
  user: User,
  params: {
    batchId: string;
    linesAttempted: number;
    linesPrinted: number;
    linesSkipped: number;
    copyMode: string;
    result: 'success' | 'error';
    errorMessage?: string;
  },
): Promise<void> {
  await writeAuditLog(db, user, {
    actionType: 'PRINT_PAYROLL_WHT_BATCH',
    entityType: 'PayrollWorkerWhtCertificateBatch',
    entityId: params.batchId,
    payrollBatchId: params.batchId,
    sourceModule: 'payroll',
    afterSummary: `[${params.result}] batch print mode=${params.copyMode} ok=${params.linesPrinted}/${params.linesAttempted} skipped=${params.linesSkipped}${params.errorMessage ? ` — ${params.errorMessage}` : ''}`,
  });
}

export async function auditPayrollWorkerWhtXmlGenerated(
  db: Firestore,
  user: User,
  params: { batchId: string; settlementLineId: string; workerId: string; documentNo: string },
): Promise<void> {
  await writeAuditLog(db, user, {
    actionType: 'GENERATE_PAYROLL_WHT_XML',
    entityType: 'PayrollWorkerWhtCertificate',
    entityId: params.settlementLineId,
    entityLabel: params.documentNo,
    payrollBatchId: params.batchId,
    linkedIds: [params.workerId],
    sourceModule: 'payroll',
    afterSummary: `Payload JSON (internal XML-ready only) documentNo=${params.documentNo}`,
  });
}
