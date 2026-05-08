import type { Firestore } from 'firebase/firestore';
import type { User } from '@/lib/types';
import { writeAuditLog } from '@/lib/services/audit-service';

export async function auditPayrollOfficeWhtSinglePrint(
  db: Firestore,
  user: User,
  params: {
    officePayrollRunId: string;
    lineId: string;
    staffId: string;
    documentNo: string;
    copyVariant: string;
    result: 'success' | 'error';
    errorMessage?: string;
  },
): Promise<void> {
  await writeAuditLog(db, user, {
    actionType: 'PRINT_OFFICE_PAYROLL_WHT_SINGLE',
    entityType: 'OfficePayrollWhtCertificate',
    entityId: params.lineId,
    entityLabel: params.documentNo,
    payrollBatchId: params.officePayrollRunId,
    linkedIds: [params.staffId, params.documentNo],
    sourceModule: 'payroll',
    afterSummary: `[${params.result}] office_staff=${params.staffId} copy=${params.copyVariant}${params.errorMessage ? ` — ${params.errorMessage}` : ''}`,
  });
}

export async function auditPayrollOfficeWhtBatchPrint(
  db: Firestore,
  user: User,
  params: {
    officePayrollRunId: string;
    linesAttempted: number;
    linesPrinted: number;
    linesSkipped: number;
    copyMode: string;
    result: 'success' | 'error';
    errorMessage?: string;
  },
): Promise<void> {
  await writeAuditLog(db, user, {
    actionType: 'PRINT_OFFICE_PAYROLL_WHT_BATCH',
    entityType: 'OfficePayrollWhtCertificateBatch',
    entityId: params.officePayrollRunId,
    payrollBatchId: params.officePayrollRunId,
    sourceModule: 'payroll',
    afterSummary: `[${params.result}] office batch print mode=${params.copyMode} ok=${params.linesPrinted}/${params.linesAttempted} skipped=${params.linesSkipped}${params.errorMessage ? ` — ${params.errorMessage}` : ''}`,
  });
}

export async function auditPayrollOfficeWhtXmlGenerated(
  db: Firestore,
  user: User,
  params: { officePayrollRunId: string; lineId: string; staffId: string; documentNo: string },
): Promise<void> {
  await writeAuditLog(db, user, {
    actionType: 'GENERATE_OFFICE_PAYROLL_WHT_XML',
    entityType: 'OfficePayrollWhtCertificate',
    entityId: params.lineId,
    entityLabel: params.documentNo,
    payrollBatchId: params.officePayrollRunId,
    linkedIds: [params.staffId],
    sourceModule: 'payroll',
    afterSummary: `Payload JSON (internal XML-ready only) documentNo=${params.documentNo}`,
  });
}
