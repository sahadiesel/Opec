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
import { canExportPayroll } from '@/lib/permissions';

/**
 * Service for managing official bank payment file batches.
 * Handles derived data from PayrollBatchLines and maintains version history.
 */
export class PaymentExportService {
  constructor(private db: Firestore) {}

  private getCollection(): CollectionReference {
    return collection(this.db, 'payment_export_batches');
  }

  /**
   * Initializes a new payment export batch.
   * Business Rule: Safely supersedes any previous draft/generated exports for this payroll batch.
   */
  async prepareExportBatch(
    payrollBatchId: string, 
    templateCode: string, 
    companyBankAccountId: string, 
    user: User
  ): Promise<string> {
    // 1. Resolve source lines to calculate summary
    const linesRef = collection(this.db, 'payroll_batches', payrollBatchId, 'lines');
    const linesSnap = await getDocs(linesRef);
    const lines = linesSnap.docs.map(d => d.data() as PayrollBatchLine);

    if (lines.length === 0) {
      throw new Error('Cannot prepare export: No lines found in payroll batch');
    }

    const totalLines = lines.length;
    const totalAmount = lines.reduce((sum, l) => sum + Number(l.netAmount), 0);

    // 2. Perform atomic creation and supersession
    const exportId = await runTransaction(this.db, async (transaction) => {
      // Check payroll batch status
      const pbRef = doc(this.db, 'payroll_batches', payrollBatchId);
      const pbSnap = await transaction.get(pbRef);
      if (!pbSnap.exists()) throw new Error('Payroll Batch not found');
      
      const payrollBatch = pbSnap.data() as PayrollBatch;
      if (!canExportPayroll(user, payrollBatch.status)) {
        throw new Error(`Cannot export: Payroll Batch is in status ${payrollBatch.status}`);
      }

      // Find existing exports to supersede
      const existingQuery = query(
        this.getCollection(),
        where('payrollBatchId', '==', payrollBatchId),
        where('status', 'in', ['draft', 'generated', 'downloaded'])
      );
      const existingSnap = await getDocs(existingQuery);
      
      existingSnap.docs.forEach(d => {
        transaction.update(d.ref, { 
          status: 'superseded',
          updatedAt: Date.now(),
          updatedBy: user.displayName 
        });
      });

      // Create new export record
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
      exportBatchId: exportId,
      payrollBatchId: payrollBatchId,
      entityLabel: `${templateCode} - ${totalLines} records`,
      linkedIds: [payrollBatchId],
      sourceModule: 'accounting',
      afterSummary: `Prepared payment export batch for ${totalLines} lines totaling ${totalAmount}. Previous drafts superseded.`
    });

    return exportId;
  }

  /**
   * Records that the physical file has been generated and stored.
   */
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
      exportBatchId: id,
      afterSummary: `Generated bank-ready payment file: ${fileName}`,
      sourceModule: 'accounting'
    });
  }

  /**
   * Tracks when a user downloads the file for bank submission.
   */
  async recordDownload(id: string, user: User) {
    const docRef = doc(this.getCollection(), id);
    await updateDoc(docRef, {
      status: 'downloaded',
      updatedAt: Date.now(),
      updatedBy: user.displayName
    });

    await writeAuditLog(this.db, user, {
      actionType: 'DOWNLOAD_EXPORT',
      entityType: 'PaymentExportBatch',
      entityId: id,
      exportBatchId: id,
      sourceModule: 'accounting',
      afterSummary: 'User downloaded payment export file for bank submission'
    });
  }
}
