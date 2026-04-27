
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
  deleteDoc,
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
  MainContract,
  PayrollLineD8Snapshot,
  PayrollBatchStatus,
  LaborCostResolutionSnapshot,
  WorkerPitCalculationMode,
} from '@/lib/types';
import { isPayrollOfficer, isSystemAdmin } from '@/lib/permission-core';
import { PayrollBatchSchema, PayrollBatchLineSchema } from '@/lib/validations/payroll-schemas';
import {
  assertPayrollPermission,
  canApprovePayroll,
  canConfirmWorkerPayrollPaid,
  canHandoffWorkerPayrollToAccounting,
  canPreparePayroll,
} from '@/lib/permissions';
import { recordPayrollFinanceApprovalPayout } from '@/lib/services/payroll-payout-service';
import { writeAuditLog } from './audit-service';
import {
  batchStatusToD8Lifecycle,
  computeWorkerPayrollLineD8,
  loadPayrollPoliciesFromFirestore,
  resolvePayrollPoliciesForDate,
} from '@/lib/payroll/d8';
import { pitFromPolicy, pitFromPolicyWithMarginalCeiling } from '@/lib/payroll/d8/deductions-from-policy';
import {
  buildLaborCostResolutionSnapshot,
  resolveWorkerLaborBaseRate,
} from '@/lib/payroll/labor-cost-model';
import {
  loadWorkersAndPositionsForPayroll,
  timesheetToLaborWorkMode,
} from '@/lib/payroll/timesheet-labor-base-cost';
import { computeRegistryWorkerTimesheetGross } from '@/lib/payroll/registry-worker-timesheet-gross';

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

function isAdminPayrollBatchDeleteBlocked(status: PayrollBatchStatus): boolean {
  return (
    status === 'FINANCE_PREPARED' ||
    status === 'PAYMENT_EXPORTED' ||
    status === 'PAID' ||
    status === 'LOCKED'
  );
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

    const poIds = Array.from(new Set(timesheets.map((ts) => ts.purchaseOrderId).filter(Boolean)));

    const contractMap = new Map<string, MainContract>();
    const contractIds = Array.from(new Set(timesheets.map((ts) => ts.contractId).filter(Boolean)));
    await Promise.all(
      contractIds.map(async (cid) => {
        const contractSnap = await getDoc(doc(this.db, 'main_contracts', cid));
        if (contractSnap.exists()) {
          contractMap.set(cid, { ...(contractSnap.data() as MainContract), id: contractSnap.id });
        }
      }),
    );
    const inheritIds = Array.from(
      new Set(
        Array.from(contractMap.values())
          .filter((c) => (c.contractType || 'master') === 'supplemental')
          .map((c) => c.inheritTermsFromContractId || c.parentContractId)
          .filter(Boolean) as string[],
      ),
    );
    await Promise.all(
      inheritIds.map(async (cid) => {
        if (contractMap.has(cid)) return;
        const contractSnap = await getDoc(doc(this.db, 'main_contracts', cid));
        if (contractSnap.exists()) {
          contractMap.set(cid, { ...(contractSnap.data() as MainContract), id: contractSnap.id });
        }
      }),
    );

    const poLineById = new Map<string, Record<string, unknown>>();
    await Promise.all(
      poIds.map(async (poId) => {
        const linesSnap = await getDocs(collection(this.db, 'purchase_orders', poId, 'po_lines'));
        linesSnap.docs.forEach((lineDoc) =>
          poLineById.set(lineDoc.id, lineDoc.data() as Record<string, unknown>),
        );
      }),
    );

    const { workerById: preflightWorkerById, posById: preflightPosById } = await loadWorkersAndPositionsForPayroll(
      this.db,
      timesheets,
    );

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
        const poLine = (poLineById.get(ts.poLineId) || {}) as Record<string, unknown>;
        const wk = preflightWorkerById.get(ts.workerId);
        const pos = wk?.currentPositionId ? preflightPosById.get(wk.currentPositionId) : undefined;
        const r = computeRegistryWorkerTimesheetGross(ts, {
          worker: wk,
          position: pos,
          poLine,
          contractMap,
        });
        if (r.gross > 0) {
          hasAnyRate = true;
        } else {
          missingReasons.add(
            `${ts.date} ${ts.eventType}: ฐานค่าแรงหรือตัวคูณได้ 0 (ตรวจตำแหน่ง/กำหนดรายคนลูกจ้าง และสัญญา)`,
          );
        }
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

    const poLineById = new Map<string, unknown>();
    const poIds = Array.from(new Set(timesheets.map((ts) => ts.purchaseOrderId).filter(Boolean)));
    await Promise.all(
      poIds.map(async (poId) => {
        const linesSnap = await getDocs(collection(this.db, 'purchase_orders', poId, 'po_lines'));
        linesSnap.docs.forEach((lineDoc) => poLineById.set(lineDoc.id, lineDoc.data()));
      }),
    );

    const { workerById, posById } = await loadWorkersAndPositionsForPayroll(this.db, timesheets);

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
      const laborTermIds: string[] = [];
      const conditionIds: string[] = [];
      let usedContractFallback = false;
      let usedPackageLaborCost = false;
      let anyOpecPositionLaborBase = false;

      for (const ts of workerTs) {
        const poLine = (poLineById.get(ts.poLineId) || {}) as Record<string, unknown>;
        const wk = workerById.get(ts.workerId);
        const pos = wk?.currentPositionId ? posById.get(wk.currentPositionId) : undefined;
        const r = computeRegistryWorkerTimesheetGross(ts, {
          worker: wk,
          position: pos,
          poLine,
          contractMap,
        });
        if (r.fromPositionModel) {
          anyOpecPositionLaborBase = true;
        }
        if (r.gross <= 0) continue;
        if (r.usedPackageLaborCost) {
          usedPackageLaborCost = true;
        } else if (r.usedPolicyFallback) {
          usedContractFallback = true;
        }
        workerGross += r.gross;
        eventBreakdown[ts.eventType] = (eventBreakdown[ts.eventType] || 0) + 1;
        if (r.usedPackageLaborCost) {
          earningsBreakdown.work_day_package = (earningsBreakdown.work_day_package || 0) + r.gross;
        } else {
          earningsBreakdown[`${ts.eventType}_policy`] =
            (earningsBreakdown[`${ts.eventType}_policy`] || 0) + r.gross;
        }
      }

      const rateParts: string[] = [
        'registry: ฐานค่าแรงจากทะเบียน (ตำแหน่ง/กำหนดรายคน) — ไม่อาศัย labor cost term',
      ];
      if (anyOpecPositionLaborBase) {
        rateParts.push('OPEC: position+worker หรือ PO line snapshot');
      }
      if (usedPackageLaborCost) {
        rateParts.push(
          'work_day: package (8h+OT; ตัวคูณจากสัญญา/PO)',
        );
      }
      if (usedContractFallback) {
        rateParts.push('event: ตัวคูณตามสัญญา หรือค่าเริ่มต้น (standby/travel/ฯลฯ)');
      }
      const rateSummary = rateParts.join(' | ');

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

      const wkLine = workerById.get(workerId);
      const posLine = wkLine?.currentPositionId ? posById.get(wkLine.currentPositionId) : null;
      const firstWm = timesheetToLaborWorkMode(workerTs[0]);
      const snapRes = wkLine
        ? resolveWorkerLaborBaseRate(
            {
              laborCostUsePositionDefault: wkLine.laborCostUsePositionDefault,
              laborCostCustomOnshore: wkLine.laborCostCustomOnshore,
              laborCostCustomOffshore: wkLine.laborCostCustomOffshore,
            },
            posLine ?? undefined,
            firstWm,
          )
        : { rate: null as number | null, source: 'position_default' as const };
      let laborCostResolutionSnapshot: LaborCostResolutionSnapshot | undefined;
      if (wkLine?.currentPositionId && snapRes.rate != null && snapRes.rate > 0) {
        laborCostResolutionSnapshot = buildLaborCostResolutionSnapshot({
          positionId: wkLine.currentPositionId,
          workMode: firstWm,
          rate: snapRes.rate,
          source: snapRes.source,
        });
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
        deductionsBreakdown: d8Line.deductionsBreakdown,
        grossAmount: workerGross,
        netAmount: d8Line.netAmount,
        d8Snapshot: d8Line.snapshot,
        laborCostResolutionSnapshot,
        exportStatus: 'pending',
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

  private async unlockTimesheetsForPayrollBatchAdmin(timesheetIds: string[]): Promise<void> {
    const unique = [...new Set(timesheetIds)].filter(Boolean);
    const chunkSize = 400;
    const now = Date.now();
    for (let i = 0; i < unique.length; i += chunkSize) {
      const slice = unique.slice(i, i + chunkSize);
      const wb = writeBatch(this.db);
      for (const id of slice) {
        const tsRef = doc(this.db, 'daily_timesheets', id);
        wb.update(tsRef, {
          status: 'VERIFIED_PAPER',
          lockedAt: deleteField(),
          lockedBy: deleteField(),
          updatedAt: now,
        });
      }
      await wb.commit();
    }
  }

  private async deletePayrollBatchSubcollectionAndDoc(batchId: string): Promise<void> {
    const linesSnap = await getDocs(collection(this.db, 'payroll_batches', batchId, 'lines'));
    const chunkSize = 400;
    const refs = linesSnap.docs.map((d) => d.ref);
    for (let i = 0; i < refs.length; i += chunkSize) {
      const wb = writeBatch(this.db);
      for (const r of refs.slice(i, i + chunkSize)) {
        wb.delete(r);
      }
      await wb.commit();
    }
    await deleteDoc(doc(this.getBatchCollection(), batchId));
  }

  /**
   * System admin only: unlock source timesheets, delete all lines and the batch document.
   * Blocked once the batch is handed to finance or paid.
   */
  async adminDeletePayrollBatch(batchId: string, user: User): Promise<void> {
    if (!isSystemAdmin(user)) {
      throw new Error('เฉพาะผู้ดูแลระบบ (System Admin) เท่านั้น');
    }
    const batchRef = doc(this.getBatchCollection(), batchId);
    const snap = await getDoc(batchRef);
    if (!snap.exists()) throw new Error('ไม่พบ payroll batch');
    const batch = snap.data() as PayrollBatch;
    if (isAdminPayrollBatchDeleteBlocked(batch.status)) {
      throw new Error('ลบไม่ได้: งวดนี้ส่งบัญชีหรือจ่ายแล้ว');
    }
    const linesSnap = await getDocs(collection(this.db, 'payroll_batches', batchId, 'lines'));
    const tsIds: string[] = [];
    linesSnap.forEach((d) => {
      const line = d.data() as PayrollBatchLine;
      line.sourceTimesheetIds?.forEach((id) => tsIds.push(id));
    });
    await this.unlockTimesheetsForPayrollBatchAdmin(tsIds);
    await this.deletePayrollBatchSubcollectionAndDoc(batchId);
    await writeAuditLog(this.db, user, {
      actionType: 'DELETE',
      entityType: 'PayrollBatch',
      entityId: batchId,
      payrollBatchId: batchId,
      sourceModule: 'hr',
      afterSummary: 'Admin deleted payroll batch; source daily timesheets unlocked (VERIFIED_PAPER)',
    });
  }

  /**
   * System admin only: same as delete, then runs generate again for the same period + work-mode scope (new batch id).
   */
  async adminRegeneratePayrollBatch(batchId: string, user: User): Promise<string> {
    if (!isSystemAdmin(user)) {
      throw new Error('เฉพาะผู้ดูแลระบบ (System Admin) เท่านั้น');
    }
    const batchRef = doc(this.getBatchCollection(), batchId);
    const snap = await getDoc(batchRef);
    if (!snap.exists()) throw new Error('ไม่พบ payroll batch');
    const batch = snap.data() as PayrollBatch;
    if (isAdminPayrollBatchDeleteBlocked(batch.status)) {
      throw new Error('สร้างใหม่ไม่ได้: งวดนี้ส่งบัญชีหรือจ่ายแล้ว');
    }
    const periodId = batch.payrollPeriodId;
    const scope = batch.workModeScope;
    const linesSnap = await getDocs(collection(this.db, 'payroll_batches', batchId, 'lines'));
    const tsIds: string[] = [];
    linesSnap.forEach((d) => {
      const line = d.data() as PayrollBatchLine;
      line.sourceTimesheetIds?.forEach((id) => tsIds.push(id));
    });
    await this.unlockTimesheetsForPayrollBatchAdmin(tsIds);
    await this.deletePayrollBatchSubcollectionAndDoc(batchId);
    await writeAuditLog(this.db, user, {
      actionType: 'DELETE',
      entityType: 'PayrollBatch',
      entityId: batchId,
      payrollBatchId: batchId,
      sourceModule: 'hr',
      afterSummary: 'Admin removed batch before regenerate (unlock + delete)',
    });
    return this.generatePayrollBatch(periodId, user, { workModeScope: scope });
  }

  /**
   * ฝ่ายเงินเดือน: ตรวจงวดแล้ว — ส่งคิวให้ผู้จัดการปฏิบัติการ/HR อนุมัติยอดทำจ่าย (GENERATED → HR_REVIEWED)
   */
  async submitOfficerBatchForPayoutApproval(id: string, user: User) {
    if (!isSystemAdmin(user) && !isPayrollOfficer(user)) {
      throw new Error('เฉพาะฝ่ายเงินเดือน (Payroll officer) หรือ system admin เท่านั้น');
    }
    assertPayrollPermission(user, 'payroll_worker', 'edit_batch');
    const docRef = doc(this.getBatchCollection(), id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('Payroll batch not found');
    const st = (snap.data() as PayrollBatch).status;
    if (st !== 'GENERATED') {
      throw new Error('ส่งขออนุมัติทำจ่ายได้เฉพาะงวดสถานะ GENERATED (กำลังตรวจ)');
    }
    await updateDoc(docRef, {
      status: 'HR_REVIEWED',
      d8LifecycleStatus: batchStatusToD8Lifecycle('HR_REVIEWED'),
      officerPayoutRequestBy: user.displayName,
      officerPayoutRequestAt: Date.now(),
      updatedAt: Date.now(),
    });
    await writeAuditLog(this.db, user, {
      actionType: 'SUBMIT',
      entityType: 'PayrollBatch',
      entityId: id,
      payrollBatchId: id,
      sourceModule: 'hr',
      afterSummary: 'Payroll officer requested payout approval (status HR_REVIEWED, ops queue)',
    });
  }

  /**
   * ผู้จัดการ/HR: อนุมัติยอด + ส่งงานต่อบัญชีจัดจ่าย (HR_REVIEWED → FINANCE_PREPARED) หรือ
   * กรณีไม่มีสิทธิ์ handoff: HR_REVIEWED → HR_APPROVED เท่านั้น
   */
  async managerApprovePayoutAndNotifyAccounting(id: string, user: User) {
    if (!canApprovePayroll(user)) {
      throw new Error('Permission denied: approve payroll');
    }
    assertPayrollPermission(user, 'payroll_worker', 'approve');
    const docRef = doc(this.getBatchCollection(), id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('Payroll batch not found');
    const st = (snap.data() as PayrollBatch).status;
    if (st !== 'HR_REVIEWED') {
      throw new Error('อนุมัติยอดทำจ่ายได้เฉพาะงวดที่ฝ่ายเงินเดือนส่งขออนุมัติแล้ว (รอ — HR_REVIEWED)');
    }
    if (canHandoffWorkerPayrollToAccounting(user)) {
      await updateDoc(docRef, {
        status: 'FINANCE_PREPARED',
        d8LifecycleStatus: batchStatusToD8Lifecycle('FINANCE_PREPARED'),
        hrApprovedBy: user.displayName,
        hrApprovedAt: Date.now(),
        financePreparedBy: user.displayName,
        financePreparedAt: Date.now(),
        updatedAt: Date.now(),
      });
      await writeAuditLog(this.db, user, {
        actionType: 'APPROVE',
        entityType: 'PayrollBatch',
        entityId: id,
        payrollBatchId: id,
        sourceModule: 'hr',
        afterSummary: 'Manager approved worker payout; handed off to finance (FINANCE_PREPARED)',
      });
      return;
    }
    await this.approveBatch(id, user);
  }

  /**
   * Legacy/split: อนุมัติรายรอบเป็นครั้งเดียว → HR_APPROVED (ไม่รวมส่งบัญชี)
   */
  async approveBatch(id: string, user: User) {
    if (!canApprovePayroll(user)) {
      throw new Error('Permission denied: approve payroll');
    }
    assertPayrollPermission(user, 'payroll_worker', 'approve');
    const docRef = doc(this.getBatchCollection(), id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('Payroll batch not found');
    const st = (snap.data() as PayrollBatch).status;
    if (st !== 'HR_REVIEWED') {
      throw new Error('อนุมัติได้เฉพาะงวดสถานะ HR_REVIEWED (หลังฝ่ายเงินเดือนส่งขออนุมัติ)');
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
      officerPayoutRequestBy: deleteField(),
      officerPayoutRequestAt: deleteField(),
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

  /** หลัง HR_APPROVED — ส่งต่อบัญชีเตรียมจ่าย (payroll officer / ผู้จัดการ) */
  async financePrepareBatch(id: string, user: User) {
    if (!canHandoffWorkerPayrollToAccounting(user)) {
      throw new Error('ไม่มีสิทธิ์ส่งต่อบัญชี — ใช้เฉพาะ payroll officer หรือผู้จัดการ HR/ปฏิบัติการ');
    }
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

  /**
   * บัญชียืนยันจ่ายแล้ว → PAID + สร้างรายการ cashbook (ครั้งเดียวต่องวด)
   */
  async financeConfirmWorkerBatchPaid(
    id: string,
    user: User,
    options?: { payoutBankAccountId?: string }
  ) {
    if (!canConfirmWorkerPayrollPaid(user)) {
      throw new Error('ไม่มีสิทธิ์ยืนยันจ่าย — ใช้เฉพาะฝ่ายบัญชี');
    }
    const docRef = doc(this.getBatchCollection(), id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('Payroll batch not found');
    const batch = snap.data() as PayrollBatch;
    if (batch.status === 'PAID' || batch.status === 'LOCKED') {
      return { alreadyDone: true as const, cashbookEntryId: batch.financeCashbookEntryId };
    }
    if (batch.status !== 'FINANCE_PREPARED' && batch.status !== 'PAYMENT_EXPORTED') {
      throw new Error('ยืนยันจ่ายได้เมื่อสถานะ FINANCE_PREPARED หรือ PAYMENT_EXPORTED เท่านั้น');
    }

    const periodRef = doc(this.db, 'payroll_periods', batch.payrollPeriodId);
    const periodSnap = await getDoc(periodRef);
    const periodLabel = periodSnap.exists() ? (periodSnap.data() as PayrollPeriod).label : batch.payrollPeriodId;

    const { cashbookEntryId, bankAccountId } = await recordPayrollFinanceApprovalPayout(
      this.db,
      user,
      {
        runId: id,
        netAmount: batch.netAmount,
        payrollRunNo: batch.id,
        payrollMonthLabel: periodLabel,
        existingCashbookEntryId: batch.financeCashbookEntryId,
        payoutBankAccountId: options?.payoutBankAccountId ?? batch.payoutBankAccountId,
        kind: 'WORKER',
      }
    );

    await updateDoc(docRef, {
      status: 'PAID',
      d8LifecycleStatus: batchStatusToD8Lifecycle('PAID'),
      financeCashbookEntryId: cashbookEntryId,
      payoutBankAccountId: bankAccountId,
      financeApprovedBy: user.displayName,
      financeApprovedAt: Date.now(),
      updatedAt: Date.now(),
    });

    await writeAuditLog(this.db, user, {
      actionType: 'PAID',
      entityType: 'PayrollBatch',
      entityId: id,
      payrollBatchId: id,
      sourceModule: 'accounting',
      afterSummary: `Accounting confirmed payout; cashbook ${cashbookEntryId}`,
    });

    return { alreadyDone: false as const, cashbookEntryId };
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

  /**
   * HR ปรับเบี้ยเลี้ยง / หักพิเศษ / ภาษี ณ ที่จ่ายรายคน — คำนวณ net + SS + PIT ใหม่ตาม policy ใน HR settings
   * (อนุญาตเฉพาะก่อนส่งบัญชีจัดจ่ายจริง)
   */
  async applyWorkerLineHrAdjustments(
    batchId: string,
    workerId: string,
    user: User,
    input: {
      allowanceItems: Array<{ label: string; amount: number }>;
      deductionItems: Array<{ label: string; amount: number }>;
      /**
       * รูปแบบ ภงด.1 — ถ้าไม่ส่ง จะอนุมาจาก pitWithholdingOverride / maxMarginal (API เก่า)
       */
      workerPitMode?: WorkerPitCalculationMode | null;
      /** คู่กับ auto_salary_base: ฐานรายเดือน (บาท) สำหรับสูตรภาษี */
      pitAutoSalaryBaseBaht?: number | null;
      /** manual_baht: ยอดหักเป็นบาท */
      pitWithholdingOverride: number | null;
      /** auto_timesheet: จำกัด marginal; null/undefined = เต็มตาราง (เท่า 35%) */
      pitWithholdingOverrideMaxMarginalRatePercent?: number | null;
      notes?: string;
    },
  ): Promise<void> {
    assertPayrollPermission(user, 'payroll_worker', 'edit_batch');
    const lineId = `${batchId}_${workerId}`;
    const batchRef = doc(this.getBatchCollection(), batchId);
    const lineRef = doc(this.db, 'payroll_batches', batchId, 'lines', lineId);

    const [batchSnap, lineSnap] = await Promise.all([getDoc(batchRef), getDoc(lineRef)]);
    if (!batchSnap.exists()) throw new Error('ไม่พบ payroll batch');
    if (!lineSnap.exists()) throw new Error('ไม่พบบรรทัดลูกจ้างในงวดนี้');

    const batch = batchSnap.data() as PayrollBatch;
    const line = lineSnap.data() as PayrollBatchLine;

    const blocked = ['PAID', 'LOCKED', 'FINANCE_PREPARED', 'PAYMENT_EXPORTED'] as const;
    if ((blocked as readonly string[]).includes(batch.status)) {
      throw new Error(
        'แก้ไขรายคนได้เฉพาะก่อนส่งต่อบัญชี (สถานะ GENERATED / HR_REVIEWED / HR_APPROVED)',
      );
    }

    const periodSnap = await getDoc(doc(this.db, 'payroll_periods', batch.payrollPeriodId));
    const periodFromLineEnd =
      typeof line.periodEndDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(line.periodEndDate)
        ? line.periodEndDate
        : null;
    if (!periodSnap.exists()) {
      if (!periodFromLineEnd) {
        throw new Error(
          `ไม่พบรอบบัญชี (id: ${String(batch.payrollPeriodId || '')}) และไม่มี periodEndDate บนบรรทัด — กรุณาแก้ batch หรือสร้างรอบบัญชีใน collection payroll_periods`,
        );
      }
    }
    const asOf: string = periodSnap.exists()
      ? String((periodSnap.data() as PayrollPeriod).endDate || periodFromLineEnd)
      : (periodFromLineEnd as string);

    const policies = await loadPayrollPoliciesFromFirestore(this.db);
    const resolved = resolvePayrollPoliciesForDate(asOf, policies, 'worker');

    const allowanceTotal = input.allowanceItems.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const effectiveGross = Math.max(0, line.grossAmount + allowanceTotal);

    const rateSummary = line.d8Snapshot?.rate;
    const d8Line = computeWorkerPayrollLineD8({
      asOfDate: asOf,
      policies: resolved,
      grossFromTimesheets: effectiveGross,
      rate: rateSummary
        ? {
            summary: rateSummary.summary,
            conditionIds: rateSummary.conditionIds,
            laborTermIds: rateSummary.laborTermIds,
          }
        : { summary: 'hr_line_adjustment' },
      earningsBreakdown: {
        ...line.earningsBreakdown,
        hr_allowances: allowanceTotal,
      },
    });

    const pitOv = input.pitWithholdingOverride;
    const mr = input.pitWithholdingOverrideMaxMarginalRatePercent;
    const mode: WorkerPitCalculationMode =
      input.workerPitMode ??
      (mr != null && Number.isFinite(mr) ? 'auto_timesheet' : (pitOv != null && Number.isFinite(pitOv) ? 'manual_baht' : 'auto_timesheet'));

    const deductions: Record<string, number> = { ...d8Line.deductionsBreakdown };
    if (mode === 'manual_baht') {
      const p = Math.max(0, Number(pitOv) || 0);
      deductions.pit_withholding = p;
    } else if (mode === 'auto_salary_base') {
      const base = Math.max(0, Number(input.pitAutoSalaryBaseBaht) || 0);
      deductions.pit_withholding = pitFromPolicy(base, resolved.tax);
    } else {
      if (mr != null && Number.isFinite(mr)) {
        const clamped = Math.max(0, Math.min(35, Number(mr)));
        deductions.pit_withholding = pitFromPolicyWithMarginalCeiling(effectiveGross, resolved.tax, clamped);
      } else {
        deductions.pit_withholding = pitFromPolicy(effectiveGross, resolved.tax);
      }
    }
    input.deductionItems.forEach((d, idx) => {
      deductions[`manual_ded_${idx}`] = Math.max(0, Number(d.amount) || 0);
    });

    const dedTotal = Object.values(deductions).reduce((a, b) => a + (Number(b) || 0), 0);
    const netAmount = Math.round((effectiveGross - dedTotal) * 100) / 100;

    const d8Snapshot: PayrollLineD8Snapshot = {
      ...d8Line.snapshot,
      gross: effectiveGross,
      deductions: { ...deductions },
      net: netAmount,
      earningsComponents: {
        ...(d8Line.snapshot.earningsComponents || {}),
        hr_allowances: allowanceTotal,
      },
    };

    const trimmedNotes = input.notes?.trim();
    const storeMr =
      mode === 'auto_timesheet' && mr != null && Number.isFinite(mr) && Math.max(0, Math.min(35, Number(mr))) < 35
        ? Math.max(0, Math.min(35, Number(mr)))
        : null;
    const hrLineAdjustments = {
      allowanceItems: input.allowanceItems,
      deductionItems: input.deductionItems,
      workerPitMode: mode,
      pitAutoSalaryBaseBaht: mode === 'auto_salary_base' ? Math.max(0, Number(input.pitAutoSalaryBaseBaht) || 0) : null,
      pitWithholdingOverride: mode === 'manual_baht' ? (Number.isFinite(Number(pitOv)) ? Math.max(0, Number(pitOv)) : null) : null,
      pitWithholdingOverrideMaxMarginalRatePercent: storeMr,
      notes: trimmedNotes ? trimmedNotes : null,
      updatedAt: Date.now(),
      updatedBy: user.displayName || user.email || user.id,
    };

    await updateDoc(lineRef, {
      deductionsBreakdown: deductions,
      netAmount,
      d8Snapshot,
      hrLineAdjustments,
      updatedAt: Date.now(),
    });

    await this.recalculateBatchTotalsFromLines(batchId, user);

    await writeAuditLog(this.db, user, {
      actionType: 'UPDATE',
      entityType: 'PayrollBatchLine',
      entityId: lineId,
      payrollBatchId: batchId,
      sourceModule: 'hr',
      afterSummary: `HR adjustments for worker ${workerId} (allowances +${allowanceTotal.toFixed(2)})`,
    });
  }

  private async recalculateBatchTotalsFromLines(batchId: string, user: User): Promise<void> {
    const linesSnap = await getDocs(collection(this.db, 'payroll_batches', batchId, 'lines'));
    let batchGross = 0;
    let batchDed = 0;
    let batchNet = 0;
    for (const d of linesSnap.docs) {
      const line = d.data() as PayrollBatchLine;
      const allowanceExtra = (line.hrLineAdjustments?.allowanceItems ?? []).reduce(
        (s, x) => s + (Number(x.amount) || 0),
        0,
      );
      const effGross = line.grossAmount + allowanceExtra;
      batchGross += effGross;
      batchDed += Object.values(line.deductionsBreakdown || {}).reduce((a, b) => a + (Number(b) || 0), 0);
      batchNet += Number(line.netAmount) || 0;
    }
    await updateDoc(doc(this.getBatchCollection(), batchId), {
      grossAmount: Math.round(batchGross * 100) / 100,
      totalDeductions: Math.round(batchDed * 100) / 100,
      netAmount: Math.round(batchNet * 100) / 100,
      updatedAt: Date.now(),
      updatedBy: user.displayName || user.email || user.id,
    });
  }
}
