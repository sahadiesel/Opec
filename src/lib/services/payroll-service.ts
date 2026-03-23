
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
  limit
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
  MainContract,
} from '@/lib/types';
import { PayrollBatchSchema, PayrollBatchLineSchema } from '@/lib/validations/payroll-schemas';
import { calculateDailyLaborCost, resolveApplicableCostRateCondition } from './labor-cost-calculator';
import { writeAuditLog } from './audit-service';

type GlobalCostMultiplierPolicy = {
  otAfterShift?: number;
  holiday?: number;
  publicHoliday?: number;
  sunday?: number;
  sundayOt?: number;
  standby?: number;
  mobilization?: number;
  demobilization?: number;
  travel?: number;
};

function resolvePolicyFallbackCost(
  ts: DailyTimesheet,
  baseCost: number,
  policy?: GlobalCostMultiplierPolicy
): number {
  if (!baseCost || !policy) return 0;

  switch (ts.eventType) {
    case 'standby_day':
      return baseCost * Number(policy.standby ?? 0.5) * Number(ts.standbyUnits ?? 1);
    case 'mobilization_day':
      return baseCost * Number(policy.mobilization ?? 1) * Number(ts.mobUnits ?? 1);
    case 'demobilization_day':
      return baseCost * Number(policy.demobilization ?? 1) * Number(ts.demobUnits ?? 1);
    case 'travel_day':
      return baseCost * Number(policy.travel ?? 1) * Number(ts.travelUnits ?? 1);
    case 'public_holiday_worked':
      return baseCost * Number(policy.publicHoliday ?? 1);
    case 'off_day_worked':
      return baseCost * Number(policy.holiday ?? 1);
    default:
      return 0;
  }
}

function resolveContractCostPolicy(
  contractId: string,
  contractMap: Map<string, MainContract>
): GlobalCostMultiplierPolicy | undefined {
  const contract = contractMap.get(contractId);
  if (!contract) return undefined;
  if ((contract.contractType || 'master') === 'supplemental') {
    const sourceId = contract.inheritTermsFromContractId || contract.parentContractId;
    if (sourceId && contractMap.has(sourceId)) {
      return contractMap.get(sourceId)?.rateMultiplierPolicy?.cost;
    }
  }
  return contract.rateMultiplierPolicy?.cost;
}

/**
 * Service for managing official Payroll Batches and their workflow transitions.
 * Enforces financial integrity through immutable snapshots and gated state changes.
 */
export class PayrollService {
  constructor(private db: Firestore) {}

  private getBatchCollection(): CollectionReference {
    return collection(this.db, 'payroll_batches');
  }

  /**
   * Generates a new Payroll Batch from approved timesheets.
   * RULE: Only include timesheets where readyForPayroll is TRUE.
   * TRANSITION: Marks source timesheets as LOCKED to prevent double processing.
   */
  async generatePayrollBatch(
    periodId: string, 
    user: User, 
    filters?: { workModeScope?: 'onshore' | 'offshore' | 'mixed' }
  ): Promise<string> {
    const periodRef = doc(this.db, 'payroll_periods', periodId);
    const periodSnap = await getDoc(periodRef);
    if (!periodSnap.exists()) throw new Error('Payroll period not found');
    const period = periodSnap.data() as PayrollPeriod;

    // RULE: Use readyForPayroll flag instead of status string.
    const tsQuery = query(
      collection(this.db, 'daily_timesheets'),
      where('date', '>=', period.startDate),
      where('date', '<=', period.endDate),
      where('readyForPayroll', '==', true)
    );
    const tsSnap = await getDocs(tsQuery);
    
    // Filter out already LOCKED timesheets in JS to avoid complex composite index requirement
    let timesheets = tsSnap.docs
      .map(d => ({ ...d.data(), id: d.id } as DailyTimesheet))
      .filter(ts => ts.status !== 'LOCKED');

    if (filters?.workModeScope && filters.workModeScope !== 'mixed') {
      timesheets = timesheets.filter(ts => ts.workMode.toLowerCase() === filters.workModeScope);
    }

    if (timesheets.length === 0) {
      throw new Error('No timesheets ready for payroll found for this period');
    }

    // Load master rules for calculation
    const [rateConditionsSnap, costTermsSnap] = await Promise.all([
      getDocs(collection(this.db, 'rate_conditions')),
      getDocs(collection(this.db, 'labor_cost_contract_terms')),
    ]);
    const allConditions = rateConditionsSnap.docs.map(d => ({ ...d.data(), id: d.id } as RateCondition));
    const allCostTerms = costTermsSnap.docs.map(d => ({ ...d.data(), id: d.id } as LaborCostContractTerm));
    const contractMap = new Map<string, MainContract>();
    const contractIds = Array.from(new Set(timesheets.map((ts) => ts.contractId).filter(Boolean)));
    await Promise.all(
      contractIds.map(async (contractId) => {
        const contractSnap = await getDoc(doc(this.db, 'main_contracts', contractId));
        if (contractSnap.exists()) {
          contractMap.set(contractId, { ...(contractSnap.data() as MainContract), id: contractSnap.id });
        }
      })
    );
    const inheritIds = Array.from(new Set(
      Array.from(contractMap.values())
        .filter((c) => (c.contractType || 'master') === 'supplemental')
        .map((c) => c.inheritTermsFromContractId || c.parentContractId)
        .filter(Boolean)
    )) as string[];
    await Promise.all(
      inheritIds.map(async (contractId) => {
        if (contractMap.has(contractId)) return;
        const contractSnap = await getDoc(doc(this.db, 'main_contracts', contractId));
        if (contractSnap.exists()) {
          contractMap.set(contractId, { ...(contractSnap.data() as MainContract), id: contractSnap.id });
        }
      })
    );

    const poLineById = new Map<string, any>();
    const poIds = Array.from(new Set(timesheets.map((ts) => ts.purchaseOrderId).filter(Boolean)));
    await Promise.all(
      poIds.map(async (poId) => {
        const linesSnap = await getDocs(collection(this.db, 'purchase_orders', poId, 'po_lines'));
        linesSnap.docs.forEach((lineDoc) => poLineById.set(lineDoc.id, lineDoc.data()));
      })
    );

    // Aggregate by Worker
    const workerMap: Record<string, DailyTimesheet[]> = {};
    timesheets.forEach(ts => {
      if (!workerMap[ts.workerId]) workerMap[ts.workerId] = [];
      workerMap[ts.workerId].push(ts);
    });

    const batchId = `PAY-${Date.now().toString().slice(-8)}`;
    const batchRef = doc(this.getBatchCollection(), batchId);
    const lines: PayrollBatchLine[] = [];

    let batchGross = 0;
    const writeOp = writeBatch(this.db);

    for (const workerId in workerMap) {
      const workerTs = workerMap[workerId];
      
      // Snapshot Worker Payment Profile
      const ppQuery = query(
        collection(this.db, 'worker_payment_profiles'),
        where('workerId', '==', workerId),
        where('status', '==', 'ACTIVE'),
        limit(1)
      );
      const ppSnap = await getDocs(ppQuery);
      const ppSnapshot = ppSnap.empty ? { paymentMethod: 'CASH' as any } : ppSnap.docs[0].data();

      const eventBreakdown: Record<string, number> = {};
      const earningsBreakdown: Record<string, number> = {};
      let workerGross = 0;

      for (const ts of workerTs) {
        const contract = allCostTerms.find(ct => 
          ct.id === ts.laborCostContractTermId || 
          (ct.relatedPurchaseOrderId === ts.purchaseOrderId && ct.status === 'ACTIVE')
        );
        
        if (contract) {
          const condition = resolveApplicableCostRateCondition(allConditions, ts, contract);
          if (condition) {
            const cost = calculateDailyLaborCost(ts, condition, 0);
            workerGross += cost;
            eventBreakdown[ts.eventType] = (eventBreakdown[ts.eventType] || 0) + 1;
            earningsBreakdown[ts.eventType] = (earningsBreakdown[ts.eventType] || 0) + cost;
          } else {
            const poLine = poLineById.get(ts.poLineId) || {};
            const baseCost = Number(poLine?.costBaselineSnapshot || 0);
            const fallbackPolicy = resolveContractCostPolicy(ts.contractId, contractMap);
            const fallbackCost = resolvePolicyFallbackCost(ts, baseCost, fallbackPolicy);
            if (fallbackCost > 0) {
              workerGross += fallbackCost;
              eventBreakdown[ts.eventType] = (eventBreakdown[ts.eventType] || 0) + 1;
              earningsBreakdown[`${ts.eventType}_policy`] =
                (earningsBreakdown[`${ts.eventType}_policy`] || 0) + fallbackCost;
            }
          }
        }
      }

      const line: PayrollBatchLine = {
        id: `${batchId}_${workerId}`,
        payrollBatchId: batchId,
        workerId,
        workerNameSnapshot: workerTs[0].workerNameSnapshot,
        workerPaymentProfileSnapshot: ppSnapshot,
        assignmentIds: Array.from(new Set(workerTs.map(ts => ts.assignmentId))),
        sourceTimesheetIds: workerTs.map(ts => ts.id),
        periodStartDate: period.startDate,
        periodEndDate: period.endDate,
        eventBreakdown,
        earningsBreakdown,
        deductionsBreakdown: {},
        grossAmount: workerGross,
        netAmount: workerGross,
        exportStatus: 'pending'
      };

      lines.push(line);
      batchGross += workerGross;
    }

    // SAFEGUARD: Lock the source timesheets using atomic WriteBatch
    for (const ts of timesheets) {
      const tsRef = doc(this.db, 'daily_timesheets', ts.id);
      writeOp.update(tsRef, { 
        status: 'LOCKED', 
        lockedAt: Date.now(),
        lockedBy: user.displayName,
        updatedAt: Date.now()
      });
    }

    const newBatch: PayrollBatch = {
      id: batchId,
      payrollPeriodId: periodId,
      workModeScope: filters?.workModeScope || 'mixed',
      status: 'GENERATED',
      totalWorkers: lines.length,
      grossAmount: batchGross,
      totalDeductions: 0,
      netAmount: batchGross,
      createdBy: user.displayName,
      updatedBy: user.displayName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    writeOp.set(batchRef, PayrollBatchSchema.parse(newBatch));
    lines.forEach(line => {
      const lineRef = doc(this.db, 'payroll_batches', batchId, 'lines', line.id);
      writeOp.set(lineRef, PayrollBatchLineSchema.parse(line));
    });

    await writeOp.commit();

    await writeAuditLog(this.db, user, {
      actionType: 'GENERATE',
      entityType: 'PayrollBatch',
      entityId: batchId,
      payrollBatchId: batchId,
      entityLabel: `${period.label} Batch`,
      sourceModule: 'hr',
      afterSummary: `Generated batch for ${lines.length} workers. Source timesheets locked.`
    });

    return batchId;
  }

  async approveBatch(id: string, user: User) {
    const docRef = doc(this.getBatchCollection(), id);
    await updateDoc(docRef, {
      status: 'HR_APPROVED',
      hrApprovedBy: user.displayName,
      hrApprovedAt: Date.now(),
      updatedAt: Date.now()
    });

    await writeAuditLog(this.db, user, {
      actionType: 'APPROVE',
      entityType: 'PayrollBatch',
      entityId: id,
      payrollBatchId: id,
      sourceModule: 'hr',
      afterSummary: 'HR Organizational Approval Granted'
    });
  }

  async lockBatch(id: string, user: User) {
    const docRef = doc(this.getBatchCollection(), id);
    await updateDoc(docRef, {
      status: 'LOCKED',
      lockedBy: user.displayName,
      lockedAt: Date.now(),
      updatedAt: Date.now()
    });

    await writeAuditLog(this.db, user, {
      actionType: 'LOCK',
      entityType: 'PayrollBatch',
      entityId: id,
      payrollBatchId: id,
      sourceModule: 'accounting',
      afterSummary: 'Payroll Batch Permanently Locked'
    });
  }
}
