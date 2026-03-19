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
  Worker, 
  User, 
  WorkerPaymentProfile,
  RateCondition,
  LaborCostContractTerm
} from '@/lib/types';
import { PayrollBatchSchema, PayrollBatchLineSchema } from '@/lib/validations/payroll-schemas';
import { calculateDailyLaborCost, resolveApplicableCostRateCondition } from './labor-cost-calculator';

/**
 * Service for managing official Payroll Batches and their transitions.
 */
export class PayrollService {
  constructor(private db: Firestore) {}

  private getBatchCollection(): CollectionReference {
    return collection(this.db, 'payroll_batches');
  }

  /**
   * Generates a new payroll batch by aggregating client-approved timesheets.
   */
  async generatePayrollBatch(
    periodId: string, 
    user: User, 
    filters?: { workModeScope?: 'ONSHORE' | 'OFFSHORE' | 'BOTH' }
  ) {
    // 1. Fetch Period Metadata
    const periodRef = doc(this.db, 'payroll_periods', periodId);
    const periodSnap = await getDoc(periodRef);
    if (!periodSnap.exists()) throw new Error('Payroll period not found');
    const period = periodSnap.data() as PayrollPeriod;

    // 2. Fetch approved timesheets in range
    const tsQuery = query(
      collection(this.db, 'daily_timesheets'),
      where('date', '>=', period.startDate),
      where('date', '<=', period.endDate),
      where('status', '==', 'CLIENT_APPROVED')
    );
    const tsSnap = await getDocs(tsQuery);
    let timesheets = tsSnap.docs.map(d => ({ ...d.data(), id: d.id } as DailyTimesheet));

    // Apply workMode filter if specified
    if (filters?.workModeScope && filters.workModeScope !== 'BOTH') {
      timesheets = timesheets.filter(ts => ts.workMode === filters.workModeScope);
    }

    if (timesheets.length === 0) {
      throw new Error('No client-approved timesheets found for this period');
    }

    // 3. Group by worker
    const workerMap: Record<string, DailyTimesheet[]> = {};
    timesheets.forEach(ts => {
      if (!workerMap[ts.workerId]) workerMap[ts.workerId] = [];
      workerMap[ts.workerId].push(ts);
    });

    // 4. Fetch reference data (Workers, Cost Contracts, Rate Conditions)
    // In a real large app, we'd chunk this or fetch selectively.
    const rateConditionsSnap = await getDocs(collection(this.db, 'rate_conditions'));
    const allConditions = rateConditionsSnap.docs.map(d => ({ ...d.data(), id: d.id } as RateCondition));
    
    const costTermsSnap = await getDocs(collection(this.db, 'labor_cost_contract_terms'));
    const allCostTerms = costTermsSnap.docs.map(d => ({ ...d.data(), id: d.id } as LaborCostContractTerm));

    // 5. Build Batch and Lines
    const batchId = `PAY-${Date.now().toString().slice(-6)}`;
    const batchRef = doc(this.getBatchCollection(), batchId);
    const lines: PayrollBatchLine[] = [];

    let batchGross = 0;
    let batchDeductions = 0;

    for (const workerId in workerMap) {
      const workerTs = workerMap[workerId];
      const workerName = workerTs[0].workerNameSnapshot;
      
      // Get active primary payment profile
      const ppQuery = query(
        collection(this.db, 'worker_payment_profiles'),
        where('workerId', '==', workerId),
        where('isPrimary', '==', true),
        where('status', '==', 'ACTIVE')
      );
      const ppSnap = await getDocs(ppQuery);
      const ppSnapshot = ppSnap.empty ? {} : ppSnap.docs[0].data();

      const eventBreakdown: Record<string, number> = {};
      const earningsBreakdown: Record<string, number> = {};
      const deductionsBreakdown: Record<string, number> = {};
      let workerGross = 0;
      let workerDeductions = 0;

      for (const ts of workerTs) {
        // Resolve Earning
        const contract = allCostTerms.find(ct => ct.id === ts.laborCostContractTermId);
        if (contract) {
          const condition = resolveApplicableCostRateCondition(allConditions, ts, contract);
          if (condition) {
            const cost = calculateDailyDailyLaborCost(ts, condition);
            workerGross += cost;
            eventBreakdown[ts.eventType] = (eventBreakdown[ts.eventType] || 0) + 1;
            earningsBreakdown[ts.eventType] = (earningsBreakdown[ts.eventType] || 0) + cost;
          }
        }
        // Deductions (Placeholder logic - typically fixed per month or calc'd separately)
        // workerDeductions += 0; 
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

      lines.push(line);
      batchGross += workerGross;
      batchDeductions += workerDeductions;
    }

    const newBatch: PayrollBatch = {
      id: batchId,
      payrollPeriodId: periodId,
      workModeScope: filters?.workModeScope || 'BOTH',
      status: 'DRAFT',
      totalWorkers: lines.length,
      grossAmount: batchGross,
      totalDeductions: batchDeductions,
      netAmount: batchGross - batchDeductions,
      createdBy: user.displayName,
      updatedBy: user.displayName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // 6. Persist using Batch
    const writeBatchInstance = writeBatch(this.db);
    writeBatchInstance.set(batchRef, newBatch);
    
    lines.forEach(line => {
      const lineRef = doc(this.db, 'payroll_batches', batchId, 'lines', line.id);
      writeBatchInstance.set(lineRef, line);
    });

    await writeBatchInstance.commit();
    return batchId;
  }

  /**
   * Transitions a batch to HR_REVIEW status.
   */
  async reviewPayrollBatch(id: string, user: User) {
    const docRef = doc(this.getBatchCollection(), id);
    await updateDoc(docRef, {
      status: 'HR_REVIEW',
      updatedBy: user.displayName,
      updatedAt: Date.now()
    });
  }

  /**
   * HR Manager official approval of the batch.
   */
  async approvePayrollBatchByHR(id: string, user: User) {
    const docRef = doc(this.getBatchCollection(), id);
    await runTransaction(this.db, async (transaction) => {
      const snap = await transaction.get(docRef);
      if (!snap.exists()) throw new Error('Batch not found');
      
      transaction.update(docRef, {
        status: 'HR_APPROVED',
        hrApprovedBy: user.displayName,
        hrApprovedAt: Date.now(),
        updatedBy: user.displayName,
        updatedAt: Date.now()
      });
    });
  }

  /**
   * Finance officer preparation after HR approval.
   */
  async preparePayrollBatchForFinance(id: string, user: User) {
    const docRef = doc(this.getBatchCollection(), id);
    await runTransaction(this.db, async (transaction) => {
      const snap = await transaction.get(docRef);
      if (snap.data()?.status !== 'HR_APPROVED') throw new Error('Batch must be HR Approved before Finance preparation');
      
      transaction.update(docRef, {
        status: 'FINANCE_APPROVED',
        financePreparedBy: user.displayName,
        financePreparedAt: Date.now(),
        updatedBy: user.displayName,
        updatedAt: Date.now()
      });
    });
  }

  /**
   * Final locking of the batch. Prevents all future edits.
   */
  async lockPayrollBatch(id: string, user: User) {
    const docRef = doc(this.getBatchCollection(), id);
    // Blocking write as requested
    await updateDoc(docRef, {
      status: 'LOCKED',
      lockedBy: user.displayName,
      lockedAt: Date.now(),
      updatedBy: user.displayName,
      updatedAt: Date.now()
    });
  }
}

// Internal helper for labor cost calculation within the service
function calculateDailyDailyLaborCost(ts: DailyTimesheet, condition: RateCondition): number {
  return calculateDailyLaborCost(ts, condition, 0);
}
