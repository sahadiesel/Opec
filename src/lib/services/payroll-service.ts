'use client';

import { 
  Firestore, 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  writeBatch, 
  updateDoc,
  CollectionReference,
  runTransaction
} from 'firebase/firestore';
import { 
  PayrollBatch, 
  PayrollBatchLine, 
  PayrollPeriod, 
  DailyTimesheet, 
  User, 
  WorkerPaymentProfile,
  RateCondition,
  LaborCostContractTerm,
  PayrollRunStatus
} from '@/lib/types';
import { PayrollBatchSchema, PayrollBatchLineSchema } from '@/lib/validations/payroll-schemas';
import { calculateDailyLaborCost, resolveApplicableCostRateCondition } from './labor-cost-calculator';
import { writeAuditLog } from './audit-service';

/**
 * Service for managing official Payroll Batches and their workflow transitions.
 * Enforces financial integrity through snapshots and blocking state changes.
 */
export class PayrollService {
  constructor(private db: Firestore) {}

  private getBatchCollection(): CollectionReference {
    return collection(this.db, 'payroll_batches');
  }

  /**
   * Generates a new Payroll Batch from client-approved timesheets.
   * Snapshots worker data and rates to ensure historical stability.
   */
  async generatePayrollBatch(
    periodId: string, 
    user: User, 
    filters?: { workModeScope?: 'ONSHORE' | 'OFFSHORE' | 'BOTH' }
  ): Promise<string> {
    // 1. Fetch Source Context
    const periodRef = doc(this.db, 'payroll_periods', periodId);
    const periodSnap = await getDoc(periodRef);
    if (!periodSnap.exists()) throw new Error('Payroll period not found');
    const period = periodSnap.data() as PayrollPeriod;

    // 2. Fetch Eligible Source Data (Only Client Approved)
    const tsQuery = query(
      collection(this.db, 'daily_timesheets'),
      where('date', '>=', period.startDate),
      where('date', '<=', period.endDate),
      where('status', '==', 'CLIENT_APPROVED')
    );
    const tsSnap = await getDocs(tsQuery);
    let timesheets = tsSnap.docs.map(d => ({ ...d.data(), id: d.id } as DailyTimesheet));

    if (filters?.workModeScope && filters.workModeScope !== 'BOTH') {
      timesheets = timesheets.filter(ts => ts.workMode === filters.workModeScope);
    }

    if (timesheets.length === 0) {
      throw new Error('No client-approved timesheets found for this period');
    }

    // 3. Resolve Master Rules for Calculation
    const rateConditionsSnap = await getDocs(collection(this.db, 'rate_conditions'));
    const allConditions = rateConditionsSnap.docs.map(d => ({ ...d.data(), id: d.id } as RateCondition));
    
    const costTermsSnap = await getDocs(collection(this.db, 'labor_cost_contract_terms'));
    const allCostTerms = costTermsSnap.docs.map(d => ({ ...d.data(), id: d.id } as LaborCostContractTerm));

    // 4. Organize by Worker
    const workerMap: Record<string, DailyTimesheet[]> = {};
    timesheets.forEach(ts => {
      if (!workerMap[ts.workerId]) workerMap[ts.workerId] = [];
      workerMap[ts.workerId].push(ts);
    });

    const batchId = `PAY-${Date.now().toString().slice(-8)}`;
    const batchRef = doc(this.getBatchCollection(), batchId);
    const lines: PayrollBatchLine[] = [];

    let batchGross = 0;
    let batchDeductions = 0;

    // 5. Build Lines with Snapshots
    for (const workerId in workerMap) {
      const workerTs = workerMap[workerId];
      const workerName = workerTs[0].workerNameSnapshot;
      
      // Resolve Worker Payment Profile (Snapshotting for history)
      const ppQuery = query(
        collection(this.db, 'worker_payment_profiles'),
        where('workerId', '==', workerId),
        where('isPrimary', '==', true),
        where('status', '==', 'ACTIVE')
      );
      const ppSnap = await getDocs(ppQuery);
      const ppSnapshot = ppSnap.empty ? { paymentMethod: 'CASH' } : ppSnap.docs[0].data();

      const eventBreakdown: Record<string, number> = {};
      const earningsBreakdown: Record<string, number> = {};
      const deductionsBreakdown: Record<string, number> = {};
      let workerGross = 0;
      let workerDeductions = 0;

      for (const ts of workerTs) {
        const contract = allCostTerms.find(ct => ct.id === ts.laborCostContractTermId);
        if (contract) {
          const condition = resolveApplicableCostRateCondition(allConditions, ts, contract);
          if (condition) {
            const cost = calculateDailyLaborCost(ts, condition, 0);
            workerGross += cost;
            eventBreakdown[ts.eventType] = (eventBreakdown[ts.eventType] || 0) + 1;
            earningsBreakdown[ts.eventType] = (earningsBreakdown[ts.eventType] || 0) + cost;
          }
        }
      }

      const line: PayrollBatchLine = {
        id: `${batchId}_${workerId}`,
        payrollBatchId: batchId,
        workerId,
        workerNameSnapshot: workerName,
        workerPaymentProfileSnapshot: ppSnapshot,
        assignmentIds: Array.from(new Set(workerTs.map(ts => ts.assignmentId))),
        sourceTimesheetIds: workerTs.map(ts => ts.id),
        periodStartDate: period.startDate,
        periodEndDate: period.endDate,
        eventBreakdown,
        earningsBreakdown,
        deductionsBreakdown,
        grossAmount: workerGross,
        netAmount: workerGross - workerDeductions,
        exportStatus: 'pending'
      };

      // Internal validation check
      PayrollBatchLineSchema.parse(line);
      lines.push(line);
      
      batchGross += workerGross;
      batchDeductions += workerDeductions;
    }

    // 6. Finalize Batch Header
    const newBatch: PayrollBatch = {
      id: batchId,
      payrollPeriodId: periodId,
      workModeScope: filters?.workModeScope || 'BOTH',
      status: 'GENERATED',
      totalWorkers: lines.length,
      grossAmount: batchGross,
      totalDeductions: batchDeductions,
      netAmount: batchGross - batchDeductions,
      createdBy: user.displayName,
      updatedBy: user.displayName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // 7. Atomic Commit
    const batchOperation = writeBatch(this.db);
    batchOperation.set(batchRef, PayrollBatchSchema.parse(newBatch));
    lines.forEach(line => {
      const lineRef = doc(this.db, 'payroll_batches', batchId, 'lines', line.id);
      batchOperation.set(lineRef, line);
    });

    await batchOperation.commit();

    await writeAuditLog(this.db, user, {
      actionType: 'GENERATE',
      entityType: 'PayrollBatch',
      entityId: batchId,
      payrollBatchId: batchId,
      entityLabel: `${period.label} - ${newBatch.workModeScope}`,
      sourceModule: 'hr',
      afterSummary: `Generated payroll batch with ${lines.length} workers. Total Net: ${newBatch.netAmount}`
    });

    return batchId;
  }

  /**
   * Internal review by HR Officer.
   */
  async reviewPayrollBatch(id: string, user: User) {
    const docRef = doc(this.getBatchCollection(), id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('Batch not found');
    const current = snap.data() as PayrollBatch;

    if (current.status === 'LOCKED') throw new Error('Integrity Error: Cannot review a locked batch');

    await updateDoc(docRef, {
      status: 'HR_REVIEWED',
      updatedBy: user.displayName,
      updatedAt: Date.now(),
    });

    await writeAuditLog(this.db, user, {
      actionType: 'REVIEW',
      entityType: 'PayrollBatch',
      entityId: id,
      payrollBatchId: id,
      sourceModule: 'hr',
      afterSummary: 'Payroll batch under HR internal review'
    });
  }

  /**
   * Final HR Manager approval. Blocking write.
   */
  async approvePayrollBatchByHR(id: string, user: User) {
    const docRef = doc(this.getBatchCollection(), id);
    
    // Using runTransaction to ensure atomic status check
    await runTransaction(this.db, async (transaction) => {
      const snap = await transaction.get(docRef);
      if (!snap.exists()) throw new Error('Batch not found');
      const current = snap.data() as PayrollBatch;

      if (current.status === 'LOCKED') throw new Error('Integrity Error: Cannot approve a locked batch');
      
      transaction.update(docRef, {
        status: 'HR_APPROVED',
        hrApprovedBy: user.displayName,
        hrApprovedAt: Date.now(),
        updatedBy: user.displayName,
        updatedAt: Date.now()
      });
    });

    await writeAuditLog(this.db, user, {
      actionType: 'APPROVE',
      entityType: 'PayrollBatch',
      entityId: id,
      payrollBatchId: id,
      sourceModule: 'hr',
      afterSummary: 'Final HR organizational approval granted'
    });
  }

  /**
   * Finance team preparation for actual payment.
   */
  async preparePayrollBatchForFinance(id: string, user: User) {
    const docRef = doc(this.getBatchCollection(), id);
    
    await runTransaction(this.db, async (transaction) => {
      const snap = await transaction.get(docRef);
      if (!snap.exists()) throw new Error('Batch not found');
      const data = snap.data() as PayrollBatch;
      
      if (data.status !== 'HR_APPROVED') {
        throw new Error('Batch must be approved by HR before Finance can prepare it');
      }

      if (data.status === 'LOCKED') throw new Error('Integrity Error: Cannot modify a locked batch');
      
      transaction.update(docRef, {
        status: 'FINANCE_PREPARED',
        financePreparedBy: user.displayName,
        financePreparedAt: Date.now(),
        updatedBy: user.displayName,
        updatedAt: Date.now()
      });
    });

    await writeAuditLog(this.db, user, {
      actionType: 'FINANCE_PREPARE',
      entityType: 'PayrollBatch',
      entityId: id,
      payrollBatchId: id,
      sourceModule: 'accounting',
      afterSummary: 'Finance department initialized payment preparation'
    });
  }

  /**
   * Marks the batch as Paid (Payment executed).
   * Business Rule: Blocks status change if already locked.
   */
  async markPayrollBatchPaid(id: string, user: User) {
    const docRef = doc(this.getBatchCollection(), id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('Batch not found');
    const current = snap.data() as PayrollBatch;

    if (current.status === 'LOCKED') throw new Error('Integrity Error: Locked batches cannot be marked as paid.');
    
    await updateDoc(docRef, {
      status: 'PAID',
      updatedBy: user.displayName,
      updatedAt: Date.now()
    });

    await writeAuditLog(this.db, user, {
      actionType: 'PAY',
      entityType: 'PayrollBatch',
      entityId: id,
      payrollBatchId: id,
      sourceModule: 'accounting',
      afterSummary: 'Payroll batch marked as paid'
    });
  }

  /**
   * Final lock of the payroll batch. No further changes allowed.
   * Business Rule: This is a terminal state.
   */
  async lockPayrollBatch(id: string, user: User) {
    const docRef = doc(this.getBatchCollection(), id);
    
    await updateDoc(docRef, {
      status: 'LOCKED',
      lockedBy: user.displayName,
      lockedAt: Date.now(),
      updatedBy: user.displayName,
      updatedAt: Date.now()
    });

    await writeAuditLog(this.db, user, {
      actionType: 'LOCK',
      entityType: 'PayrollBatch',
      entityId: id,
      payrollBatchId: id,
      sourceModule: 'accounting',
      reasonCode: 'PAYMENT_FINALIZED',
      afterSummary: 'Payroll batch locked permanently'
    });
  }
}
