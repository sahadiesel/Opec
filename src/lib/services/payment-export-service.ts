'use client';

import { 
  Firestore, 
  collection, 
  doc, 
  getDocs, 
  query, 
  where, 
  updateDoc,
  CollectionReference,
  runTransaction
} from 'firebase/firestore';
import { 
  PaymentExportBatch, 
  PayrollBatch, 
  PayrollBatchLine, 
  User 
} from '@/lib/types';
import { PaymentExportBatchSchema } from '@/lib/validations/payment-export-schemas';
import { writeAuditLog } from './audit-service';

/**
 * Service for managing official bank payment file batches.
 */
export class PaymentExportService {
  constructor(private db: Firestore) {}

  private getCollection(): CollectionReference {
    return collection(this.db, 'payment_export_batches');
  }

  async prepareExportBatch(
    payrollBatchId: string, 
    templateCode: string, 
    companyBankAccountId: string, 
    user: User
  ): Promise<string> {
    const linesRef = collection(this.db, 'payroll_batches', payrollBatchId, 'lines');
    const linesSnap = await getDocs(linesRef);
    const lines = linesSnap.docs.map(d => d.data() as PayrollBatchLine);

    if (lines.length === 0) {
      throw new Error('Cannot prepare export: No lines found in payroll batch');
    }

    const totalLines = lines.length;
    const totalAmount = lines.reduce((sum, l) => sum + Number(l.netAmount), 0);

    const exportId = await runTransaction(this.db, async (transaction) => {
      const pbRef = doc(this.db, 'payroll_batches', payrollBatchId);
      const pbSnap = await transaction.get(pbRef);
      if (!pbSnap.exists()) throw new Error('Payroll Batch not found');
      
      const payrollBatch = pbSnap.data() as PayrollBatch;
      const validStatuses = ['HR_APPROVED', 'FINANCE_APPROVED', 'LOCKED', 'PAID'];
      if (!validStatuses.includes(payrollBatch.status)) {
        throw new Error(`Cannot export: Payroll Batch is in status ${payrollBatch.status}`);
      }

      const existingQuery = query(
        this.getCollection(),
        where('payrollBatchId', '==', payrollBatchId),
        where('status', 'in', ['draft', 'generated', 'downloaded'])
      );
      const existingSnap = await getDocs(existingQuery);
      
      existingSnap.docs.forEach(d => {
        transaction.update(d.ref, { status: 'superseded' });
      });

      const newExportId = `EXP-${Date.now().toString().slice(-6)}`;
      const exportRef = doc(this.getCollection(), newExportId);
      
      const newExport: PaymentExportBatch = {
        id: newExportId,
        payrollBatchId,
        exportTemplateCode: templateCode,
        companyBankAccountId,
        totalLines,
        totalAmount,
        status: 'draft',
        createdBy: user.displayName,
        createdAt: Date.now(),
      };

      const validated = PaymentExportBatchSchema.parse(newExport);
      transaction.set(exportRef, validated);

      return newExportId;
    });

    await writeAuditLog(this.db, user, {
      actionType: 'PREPARE_EXPORT',
      entityType: 'PaymentExportBatch',
      entityId: exportId,
      entityLabel: `${templateCode} - ${totalLines} records`,
      linkedIds: [payrollBatchId],
      sourceModule: 'accounting'
    });

    return exportId;
  }

  async markAsGenerated(id: string, fileName: string, fileUrl: string, user: User) {
    const docRef = doc(this.getCollection(), id);
    await updateDoc(docRef, {
      status: 'generated',
      fileName,
      fileUrl,
      generatedBy: user.displayName,
      generatedAt: Date.now(),
    });

    await writeAuditLog(this.db, user, {
      actionType: 'GENERATE_FILE',
      entityType: 'PaymentExportBatch',
      entityId: id,
      afterSummary: `Generated file: ${fileName}`,
      sourceModule: 'accounting'
    });
  }
}
