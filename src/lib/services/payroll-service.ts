
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
  deleteField,
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
import { assertPayrollPermission, canApprovePayroll, canPreparePayroll } from '@/lib/permissions';
import { writeAuditLog } from './audit-service';
import {
  batchStatusToD8Lifecycle,
  computeWorkerPayrollLineD8,
  loadPayrollPoliciesFromFirestore,
  resolvePayrollPoliciesForDate,
} from '@/lib/payroll/d8';

export interface PayrollPreflightZeroWorker {
  workerId: string;
  workerName: string;
  timesheetCount: number;
  reasons: string[];
}

export interface PayrollPreflightResult {
  totalWorkers: number;
  totalTimesheets: number;
  zeroGrossWorkers: PayrollPreflightZeroWorker[];
  hasWarnings: boolean;
}

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
  /**
   * Pre-flight check: identifies workers whose gross will be 0 due to missing rate setup.
   * Call before generatePayrollBatch to let HR decide whether to proceed.
   */
  async preflightPayrollCheck(
    periodId: string,
    filters?: { workModeScope?: 'onshore' | 'offshore' | 'mixed' },
  ): Promise<PayrollPreflightResult> {
    const periodRef = doc(this.db, 'payroll_periods', periodId);
    const periodSnap = await getDoc(periodRef);
    if (!periodSnap.exists()) throw new Error('Payroll period not found');
    const period = periodSnap.data() as PayrollPeriod;

    const tsQuery = query(
      collection(this.db, 'daily_timesheets'),
      where('date', '>=', period.startDate),
      where('date', '<=', period.endDate),
      where('readyForPayroll', '==', true),
    );
    const tsSnap = await getDocs(tsQuery);
    let timesheets = tsSnap.docs
      .map((d) => ({ ...d.data(), id: d.id } as DailyTimesheet))
      .filter((ts) => ts.status !== 'LOCKED');

    if (filters?.workModeScope && filters.workModeScope !== 'mixed') {
      timesheets = timesheets.filter((ts) => ts.workMode.toLowerCase() === filters.workModeScope);
    }

    const [condSnap, termsSnap] = await Promise.all([
      getDocs(collection(this.db, 'rate_conditions')),
      getDocs(collection(this.db, 'labor_cost_contract_terms')),
    ]);
    const allConditions = condSnap.docs.map((d) => ({ ...d.data(), id: d.id } as RateCondition));
    const allCostTerms = termsSnap.docs.map((d) => ({ ...d.data(), id: d.id } as LaborCostContractTerm));

    const workerTsMap: Record<string, DailyTimesheet[]> = {};
    timesheets.forEach((ts) => {
      if (!workerTsMap[ts.workerId]) workerTsMap[ts.workerId] = [];
      workerTsMap[ts.workerId].push(ts);
    });

    const zeroGrossWorkers: PayrollPreflightZeroWorker[] = [];

    for (const workerId in workerTsMap) {
      const workerTs = workerTsMap[workerId];
      let hasAnyRate = false;
      const missingReasons = new Set<string>();

      for (const ts of workerTs) {
        const term = allCostTerms.find(
          (ct) =>
            ct.id === ts.laborCostContractTermId ||
            (ct.relatedPurchaseOrderId === ts.purchaseOrderId && ct.status === 'ACTIVE'),
        );

        if (!term) {
          missingReasons.add('ไม่มี Labor Cost Term สำหรับ PO นี้');
          continue;
        }

        const condition = resolveApplicableCostRateCondition(allConditions, ts, term);
        if (!condition) {
          missingReasons.add(`ไม่มี Rate Condition สำหรับ ${ts.eventType}`);
          continue;
        }

        if (
          condition.calculationMethod !== 'FIXED' &&
          condition.calculationMethod !== 'FLAT' &&
          !condition.baseRate
        ) {
          missingReasons.add(`${ts.eventType}: baseRate = 0 (method: ${condition.calculationMethod})`);
          continue;
        }

        hasAnyRate = true;
      }

      if (!hasAnyRate) {
        zeroGrossWorkers.push({
          workerId,
          workerName: workerTs[0].workerNameSnapshot,
          timesheetCount: workerTs.length,
          reasons: Array.from(missingReasons),
        });
      }
    }

    return {
      totalWorkers: Object.keys(workerTsMap).length,
      totalTimesheets: timesheets.length,
      zeroGrossWorkers,
      hasWarnings: zeroGrossWorkers.length > 0,
    };
  }

  async generatePayrollBatch(
    periodId: string, 
    user: User, 
    filters?: { workModeScope?: 'onshore' | 'offshore' | 'mixed' }
  ): Promise<string> {
    if (!canPreparePayroll(user)) {
      throw new Error('Permission denied: prepare payroll');
    }
    assertPayrollPermission(user, 'payroll_worker', 'create_batch');
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
    let batchDeductions = 0;
    let batchNet = 0;
    const writeOp = writeBatch(this.db);

    const policyRecords = await loadPayrollPoliciesFromFirestore(this.db);
    const asOf = period.endDate;

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
      const laborTermIds = new Set<string>();
      const conditionIds = new Set<string>();
      let usedContractFallback = false;

      for (const ts of workerTs) {
        const contract = allCostTerms.find(ct => 
          ct.id === ts.laborCostContractTermId || 
          (ct.relatedPurchaseOrderId === ts.purchaseOrderId && ct.status === 'ACTIVE')
        );
        
        if (contract) {
          laborTermIds.add(contract.id);
          const condition = resolveApplicableCostRateCondition(allConditions, ts, contract);
          if (condition) {
            conditionIds.add(condition.id);
            const cost = calculateDailyLaborCost(ts, condition, 0);
            workerGross += cost;
            eventBreakdown[ts.eventType] = (eventBreakdown[ts.eventType] || 0) + 1;
            earningsBreakdown[ts.eventType] = (earningsBreakdown[ts.eventType] || 0) + cost;
          } else {
            usedContractFallback = true;
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

      const rateSummary =
        conditionIds.size > 0
          ? `rate_conditions: ${[...conditionIds].join(', ')}`
          : usedContractFallback || laborTermIds.size > 0
            ? `labor_cost_term + contract policy fallback (terms: ${[...laborTermIds].join(', ') || '—'})`
            : 'no_applicable_labor_term';

      const resolvedPolicies = resolvePayrollPoliciesForDate(asOf, policyRecords, 'worker');
      const d8Line = computeWorkerPayrollLineD8({
        asOfDate: asOf,
        policies: resolvedPolicies,
        grossFromTimesheets: workerGross,
        rate: {
          summary: rateSummary,
          conditionIds: [...conditionIds],
          laborTermIds: [...laborTermIds],
        },
        earningsBreakdown,
      });

      const lineDedTotal = Object.values(d8Line.deductionsBreakdown).reduce((a, b) => a + b, 0);
      batchDeductions += lineDedTotal;
      batchNet += d8Line.netAmount;

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
        deductionsBreakdown: d8Line.deductionsBreakdown,
        grossAmount: workerGross,
        netAmount: d8Line.netAmount,
        d8Snapshot: d8Line.snapshot,
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
      d8LifecycleStatus: batchStatusToD8Lifecycle('GENERATED'),
      totalWorkers: lines.length,
      grossAmount: batchGross,
      totalDeductions: Math.round(batchDeductions * 100) / 100,
      netAmount: Math.round(batchNet * 100) / 100,
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
    if (!canApprovePayroll(user)) {
      throw new Error('Permission denied: approve payroll');
    }
    assertPayrollPermission(user, 'payroll_worker', 'approve');
    const docRef = doc(this.getBatchCollection(), id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('Payroll batch not found');
    const st = (snap.data() as PayrollBatch).status;
    if (st !== 'GENERATED' && st !== 'HR_REVIEWED') {
      throw new Error('อนุมัติได้เฉพาะงวดสถานะ GENERATED / HR_REVIEWED');
    }
    await updateDoc(docRef, {
      status: 'HR_APPROVED',
      d8LifecycleStatus: batchStatusToD8Lifecycle('HR_APPROVED'),
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

  /** HR ส่งกลับแก้ไข — คืนสถานะก่อนอนุมัติ (ล้าง hr approval) */
  async sendBackBatch(id: string, user: User) {
    assertPayrollPermission(user, 'payroll_worker', 'edit_batch');
    const docRef = doc(this.getBatchCollection(), id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('Payroll batch not found');
    const st = (snap.data() as PayrollBatch).status;
    if (st !== 'GENERATED' && st !== 'HR_REVIEWED') {
      throw new Error('ส่งกลับได้เฉพาะงวดที่ยังไม่ HR อนุมัติ');
    }
    await updateDoc(docRef, {
      status: 'GENERATED',
      d8LifecycleStatus: batchStatusToD8Lifecycle('GENERATED'),
      hrApprovedBy: deleteField(),
      hrApprovedAt: deleteField(),
      updatedAt: Date.now(),
    });
    await writeAuditLog(this.db, user, {
      actionType: 'REJECT',
      entityType: 'PayrollBatch',
      entityId: id,
      payrollBatchId: id,
      sourceModule: 'hr',
      afterSummary: 'HR sent batch back for correction (status GENERATED)',
    });
  }

  /** หลัง HR_APPROVED — ส่งต่อบัญชีเตรียมจ่าย */
  async financePrepareBatch(id: string, user: User) {
    assertPayrollPermission(user, 'payroll_worker', 'approve');
    const docRef = doc(this.getBatchCollection(), id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('Payroll batch not found');
    const st = (snap.data() as PayrollBatch).status;
    if (st !== 'HR_APPROVED') {
      throw new Error('ส่งต่อบัญชีได้หลัง HR อนุมัติแล้วเท่านั้น');
    }
    await updateDoc(docRef, {
      status: 'FINANCE_PREPARED',
      d8LifecycleStatus: batchStatusToD8Lifecycle('FINANCE_PREPARED'),
      financePreparedBy: user.displayName,
      financePreparedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await writeAuditLog(this.db, user, {
      actionType: 'SUBMIT',
      entityType: 'PayrollBatch',
      entityId: id,
      payrollBatchId: id,
      sourceModule: 'hr',
      afterSummary: 'Handed off to finance (FINANCE_PREPARED)',
    });
  }

  async lockBatch(id: string, user: User) {
    assertPayrollPermission(user, 'payroll_worker', 'lock');
    const docRef = doc(this.getBatchCollection(), id);
    await updateDoc(docRef, {
      status: 'LOCKED',
      d8LifecycleStatus: batchStatusToD8Lifecycle('LOCKED'),
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
