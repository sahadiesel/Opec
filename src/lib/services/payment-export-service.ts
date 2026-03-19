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

/**
 * Service for managing official bank payment file batches.
 * Derives data from PayrollBatchLine snapshots to ensure payment integrity.
 */
export class PaymentExportService {
  constructor(private db: Firestore) {}

  private getCollection(): CollectionReference {
    return collection(this.db, 'payment_export_batches');
  }

  /**
   * Prepares a new export record based on an approved payroll batch.
   * Implements history preservation by marking previous exports for the same payroll as superseded.
   */
  async prepareExportBatch(
    payrollBatchId: string, 
    templateCode: string, 
    companyBankAccountId: string, 
    user: User
  ): Promise<string> {
    // 1. Fetch source lines to calculate accurate totals from snapshots
    // We fetch the data first then validate in transaction.
    const linesRef = collection(this.db, 'payroll_batches', payrollBatchId, 'lines');
    const linesSnap = await getDocs(linesRef);
    const lines = linesSnap.docs.map(d => d.data() as PayrollBatchLine);

    if (lines.length === 0) {
      throw new Error('Cannot prepare export: No lines found in payroll batch');
    }

    const totalLines = lines.length;
    const totalAmount = lines.reduce((sum, l) => sum + Number(l.netAmount), 0);

    return await runTransaction(this.db, async (transaction) => {
      // 2. Verify Payroll Batch is in a payable state
      const pbRef = doc(this.db, 'payroll_batches', payrollBatchId);
      const pbSnap = await transaction.get(pbRef);
      if (!pbSnap.exists()) throw new Error('Payroll Batch not found');
      
      const payrollBatch = pbSnap.data() as PayrollBatch;
      const validStatuses = ['HR_APPROVED', 'FINANCE_APPROVED', 'LOCKED', 'PAID'];
      if (!validStatuses.includes(payrollBatch.status)) {
        throw new Error(`Cannot export: Payroll Batch is in status ${payrollBatch.status}`);
      }

      // 3. Preserve History: Mark previous versions as superseded
      const existingQuery = query(
        this.getCollection(),
        where('payrollBatchId', '==', payrollBatchId),
        where('status', 'in', ['draft', 'generated', 'downloaded'])
      );
      const existingSnap = await getDocs(existingQuery);
      
      existingSnap.docs.forEach(d => {
        transaction.update(d.ref, { 
          status: 'superseded' 
        });
      });

      // 4. Create New Export record
      const exportId = `EXP-${Date.now().toString().slice(-6)}`;
      const exportRef = doc(this.getCollection(), exportId);
      
      const newExport: PaymentExportBatch = {
        id: exportId,
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

      return exportId;
    });
  }

  /**
   * Transitions export to 'generated' status when the file is produced.
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
  }

  /**
   * Tracks when the file was actually fetched by an authorized user.
   */
  async markAsDownloaded(id: string) {
    const docRef = doc(this.getCollection(), id);
    await updateDoc(docRef, {
      status: 'downloaded'
    });
  }
}
