import type { Firestore } from 'firebase/firestore';
import type { User } from '@/lib/types';
import { writeAuditLog } from '@/lib/services/audit-service';

export async function auditPayrollExecutiveWhtSinglePrint(
  db: Firestore,
  user: User,
  params: {
    executivePayrollRunId: string;
    lineId: string;
    staffId: string;
    documentNo: string;
    copyVariant: string;
    result: 'success' | 'error';
    errorMessage?: string;
  },
): Promise<void> {
  await writeAuditLog(db, user, {
    actionType: 'PRINT_EXECUTIVE_PAYROLL_WHT_SINGLE',
    entityType: 'ExecutivePayrollWhtCertificate',
    entityId: params.lineId,
    entityLabel: params.documentNo,
    payrollBatchId: params.executivePayrollRunId,
    linkedIds: [params.staffId, params.documentNo],
    sourceModule: 'payroll',
    afterSummary: `[${params.result}] executive_payroll_staff=${params.staffId} copy=${params.copyVariant}${params.errorMessage ? ` — ${params.errorMessage}` : ''}`,
  });
}

export async function auditPayrollExecutiveWhtBatchPrint(
  db: Firestore,
  user: User,
  params: {
    executivePayrollRunId: string;
    linesAttempted: number;
    linesPrinted: number;
    linesSkipped: number;
    copyMode: string;
    result: 'success' | 'error';
    errorMessage?: string;
  },
): Promise<void> {
  await writeAuditLog(db, user, {
    actionType: 'PRINT_EXECUTIVE_PAYROLL_WHT_BATCH',
    entityType: 'ExecutivePayrollWhtCertificateBatch',
    entityId: params.executivePayrollRunId,
    payrollBatchId: params.executivePayrollRunId,
    sourceModule: 'payroll',
    afterSummary: `[${params.result}] executive batch print mode=${params.copyMode} ok=${params.linesPrinted}/${params.linesAttempted} skipped=${params.linesSkipped}${params.errorMessage ? ` — ${params.errorMessage}` : ''}`,
  });
}

export async function auditPayrollExecutiveWhtXmlGenerated(
  db: Firestore,
  user: User,
  params: { executivePayrollRunId: string; lineId: string; staffId: string; documentNo: string },
): Promise<void> {
  await writeAuditLog(db, user, {
    actionType: 'GENERATE_EXECUTIVE_PAYROLL_WHT_XML',
    entityType: 'ExecutivePayrollWhtCertificate',
    entityId: params.lineId,
    entityLabel: params.documentNo,
    payrollBatchId: params.executivePayrollRunId,
    linkedIds: [params.staffId],
    sourceModule: 'payroll',
    afterSummary: `Payload JSON (internal XML-ready only) documentNo=${params.documentNo}`,
  });
}
