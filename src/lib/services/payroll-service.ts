
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
  limit,
  type DocumentData,
} from 'firebase/firestore';
import { 
  PayrollBatch,
  PayrollBatchIncomeSegment,
  PayrollBatchLine,
  HrPayrollLineAdjustments,
  PayrollPeriod,
  DailyTimesheet,
  User,
  WorkerPaymentProfile,
  MainContract,
  PurchaseOrder,
  Customer,
  PayrollLineD8Snapshot,
  PayrollBatchStatus,
  LaborCostResolutionSnapshot,
  WorkerPitCalculationMode,
  OfficePayrollLine,
  OfficePayrollRun,
  OfficePayrollLineHrAdjustments,
  OfficePayrollPitMode,
} from '@/lib/types';
import { canApproveWorkerPayrollBatchAsManager, isPayrollOfficer, isSystemAdmin } from '@/lib/permission-core';
import { PayrollBatchSchema, PayrollBatchLineSchema } from '@/lib/validations/payroll-schemas';
import {
  assertPayrollPermission,
  canApprovePayroll,
  canConfirmWorkerPayrollPaid,
  canEdit,
  canHandoffWorkerPayrollToAccounting,
  canPreparePayroll,
} from '@/lib/permissions';

/** Input สำหรับปรับยอดรายคนงวดออฟฟิศ / ผู้บริหาร */
export type ApplyOfficeLineHrAdjustmentsInput = {
  allowanceItems: Array<{ label: string; amount: number }>;
  deductionItems: Array<{ label: string; amount: number }>;
  notes?: string;
  deductSocialSecurity?: boolean;
  pitMode?: OfficePayrollPitMode;
  pitManualPercent?: number | null;
  pitManualAmountBaht?: number | null;
};
import { recordPayrollFinanceApprovalPayout } from '@/lib/services/payroll-payout-service';
import { writeAuditLog } from './audit-service';
import {
  batchStatusToD8Lifecycle,
  computeWorkerPayrollLineD8,
  computeOfficePayrollLineD8,
  loadPayrollPoliciesFromFirestore,
  resolvePayrollPoliciesForDate,
} from '@/lib/payroll/d8';
import {
  pitFromMonthlyGross,
  pitFromMonthlyGrossWithMarginalCeiling,
} from '@/lib/payroll/d8/deductions-from-policy';
import {
  buildLaborCostResolutionSnapshot,
  resolveWorkerLaborBaseRate,
} from '@/lib/payroll/labor-cost-model';
import {
  loadWorkersAndPositionsForPayroll,
  timesheetToLaborWorkMode,
} from '@/lib/payroll/timesheet-labor-base-cost';
import { computeRegistryWorkerTimesheetGross } from '@/lib/payroll/registry-worker-timesheet-gross';
import { fetchWorkerGlobalLaborContextFromFirestore } from '@/lib/payroll/worker-global-labor-policy';
import {
  calendarYearMonthFromPeriodStart,
  hasApprovedMonthlyTimesheetForYearMonth,
  shouldGatePayrollOnMonthlyApproval,
} from '@/lib/payroll/monthly-timesheet-approval-gate';
import {
  aggregateDailyTimesheetsPayrollChunk,
  mergePayrollTimesheetAggChunks,
} from '@/lib/payroll/aggregate-payroll-timesheet-chunks';
import { computeWorkDayPackagePayslipSplit } from '@/lib/payroll/work-day-payslip-split';
import {
  CASH_ADVANCE_PAYROLL_DEDUCTION_KEY,
  fetchWorkerCashAdvancesPendingSalaryRecovery,
} from '@/lib/payroll/cash-advance-recovery';
import { normalizeTimesheetsForPayrollLine } from '@/lib/payroll/dedupe-timesheets-for-payroll';

function round2Payroll(n: number): number {
  return Math.round(n * 100) / 100;
}

/** หน่วงระหว่าง commit ชุดเขียน Firestore — ลด burst ที่ทำให้ Spark / quota ได้ resource-exhausted */
const PAYROLL_FS_COMMIT_GAP_MS = 280;

function payrollSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** ต่ำกว่า 500 (limit ของ writeBatch) และเหลือที่ว่างสำหรับ doc อื่นในชุดเดียวกัน */
const PAYROLL_FS_WRITE_CHUNK = 380;

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
  /** ฐานค่าแรง/ตำแหน่ง — คนใดคนหนึ่งได้ gross 0 */
  hasWarnings: boolean;
  /** รอบ MONTHLY: ยังไม่มี po_month / wave_month ที่ปิดงวดแล้ว (ล็อก/ส่งตรวจ/อนุมัติ) ใน yyyy-MM ของรอบ */
  missingApprovedMonthlyTimesheet: boolean;
  payrollYearMonth: string | null;
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

  /** รอบจ่ายรายเดือน — ต้องมีเอกสาร PO+เดือน / Wave เดือนที่ปิดงวดแล้ว (ล็อก / ส่งตรวจ / อนุมัติ) ก่อนประมวลผล */
  private async assertMonthlyTimesheetApprovalForPeriod(period: PayrollPeriod): Promise<{
    payrollYearMonth: string | null;
    missingApprovedMonthlyTimesheet: boolean;
  }> {
    if (!shouldGatePayrollOnMonthlyApproval(period)) {
      return {
        payrollYearMonth: calendarYearMonthFromPeriodStart(period.startDate),
        missingApprovedMonthlyTimesheet: false,
      };
    }
    const ym = calendarYearMonthFromPeriodStart(period.startDate);
    if (!ym) {
      return { payrollYearMonth: null, missingApprovedMonthlyTimesheet: true };
    }
    const ok = await hasApprovedMonthlyTimesheetForYearMonth(this.db, ym);
    return { payrollYearMonth: ym, missingApprovedMonthlyTimesheet: !ok };
  }

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
    if (!periodSnap.exists()) throw new Error('ไม่พบรอบบัญชี (payroll period)');
    const period = periodSnap.data() as PayrollPeriod;

    const monthlyGate = await this.assertMonthlyTimesheetApprovalForPeriod(period);

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

    const workerGlobalLabor = await fetchWorkerGlobalLaborContextFromFirestore(this.db);

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
        const linePos = ts.positionId ? preflightPosById.get(ts.positionId) : undefined;
        const r = computeRegistryWorkerTimesheetGross(ts, {
          worker: wk,
          linePosition: linePos,
          poLine,
          contractMap,
          workerGlobalLabor,
        });
        if (r.gross > 0) {
          hasAnyRate = true;
        } else {
          missingReasons.add(
            `${ts.date} ${ts.eventType}: ฐานค่าแรงหรือตัวคูณได้ 0 (ตรวจตำแหน่ง/กำหนดรายคนลูกจ้าง และ HR ตั้งค่าตัวคูณ/ปฏิทิน)`,
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
      missingApprovedMonthlyTimesheet: monthlyGate.missingApprovedMonthlyTimesheet,
      payrollYearMonth: monthlyGate.payrollYearMonth,
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
    if (!periodSnap.exists()) throw new Error('ไม่พบรอบบัญชี (payroll period)');
    const period = periodSnap.data() as PayrollPeriod;

    const monthlyGate = await this.assertMonthlyTimesheetApprovalForPeriod(period);
    if (monthlyGate.missingApprovedMonthlyTimesheet) {
      const ym = monthlyGate.payrollYearMonth;
      throw new Error(
        ym
          ? `ยังไม่มีเอกสารสรุปลงเวลารายเดือน (${ym}) ที่ปิดงวดแล้ว — ให้ล็อกงวดหรือส่งตรวจ/อนุมัติที่เมนูเอกสาร PO+เดือนก่อนสร้าง Payroll Batch`
          : 'รอบบัญชีมีวันที่เริ่มต้นไม่ถูกต้อง — ตรวจสอบ payroll_periods',
      );
    }

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
      throw new Error('ไม่พบใบงานรายวันที่พร้อมจ่าย (readyForPayroll) ในรอบนี้');
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

    const poById = new Map<string, PurchaseOrder>();
    await Promise.all(
      poIds.map(async (poId) => {
        const poSnap = await getDoc(doc(this.db, 'purchase_orders', poId));
        if (poSnap.exists()) {
          poById.set(poId, { ...(poSnap.data() as PurchaseOrder), id: poSnap.id });
        }
      }),
    );

    const customerIdsForPo = [...new Set([...poById.values()].map((p) => p.customerId).filter(Boolean))];
    const customerNameById = new Map<string, string>();
    await Promise.all(
      customerIdsForPo.map(async (cid) => {
        const s = await getDoc(doc(this.db, 'customers', cid));
        if (s.exists()) {
          const c = s.data() as Customer;
          customerNameById.set(cid, (c.name || '').trim() || cid);
        }
      }),
    );

    const { workerById, posById } = await loadWorkersAndPositionsForPayroll(this.db, timesheets);

    const workerGlobalLabor = await fetchWorkerGlobalLaborContextFromFirestore(this.db);

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
    const advanceIdsToLinkToBatch: string[] = [];

    const policyRecords = await loadPayrollPoliciesFromFirestore(this.db);
    const asOf = period.endDate;

    for (const workerId in workerMap) {
      const workerTs = normalizeTimesheetsForPayrollLine(workerMap[workerId]);
      
      // Snapshot Worker Payment Profile
      const ppQuery = query(
        collection(this.db, 'worker_payment_profiles'),
        where('workerId', '==', workerId),
        where('status', '==', 'ACTIVE'),
        limit(1)
      );
      const ppSnap = await getDocs(ppQuery);
      const ppSnapshot = ppSnap.empty ? { paymentMethod: 'CASH' as any } : ppSnap.docs[0].data();

      const aggDeps = {
        poLineById,
        workerById,
        posById,
        contractMap,
        workerGlobalLabor,
      };

      const byPo = new Map<string, DailyTimesheet[]>();
      for (const ts of workerTs) {
        const pid = (ts.purchaseOrderId || '').trim() || '_unknown_po';
        if (!byPo.has(pid)) byPo.set(pid, []);
        byPo.get(pid)!.push(ts);
      }

      const chunksOrdered: Array<{ poId: string; chunk: ReturnType<typeof aggregateDailyTimesheetsPayrollChunk> }> = [];
      for (const [poId, list] of byPo) {
        chunksOrdered.push({ poId, chunk: aggregateDailyTimesheetsPayrollChunk(list, aggDeps) });
      }

      const mergedChunk = mergePayrollTimesheetAggChunks(chunksOrdered.map((c) => c.chunk));
      const workerGross = mergedChunk.gross;
      const eventBreakdown = mergedChunk.eventBreakdown;
      const earningsBreakdown = mergedChunk.earningsBreakdown;
      const usedPackageLaborCost = mergedChunk.usedPackageLaborCost;
      const usedContractFallback = mergedChunk.usedContractFallback;
      const anyOpecPositionLaborBase = mergedChunk.anyOpecPositionLaborBase;

      const laborTermIds: string[] = [];
      const conditionIds: string[] = [];

      const payingPoChunks = chunksOrdered.filter((c) => c.chunk.gross > 0);
      let incomeSegments: PayrollBatchIncomeSegment[] | undefined;
      if (payingPoChunks.length > 1) {
        incomeSegments = payingPoChunks.map(({ poId, chunk }) => {
          const po = poById.get(poId);
          const cid = (po?.customerId || '').trim() || undefined;
          const listForPo = byPo.get(poId) ?? [];
          return {
            purchaseOrderId: poId,
            customerId: cid,
            poCodeSnapshot: po?.poCode,
            customerNameSnapshot: cid ? customerNameById.get(cid) : undefined,
            grossAmount: round2Payroll(chunk.gross),
            eventBreakdown: { ...chunk.eventBreakdown },
            earningsBreakdown: { ...chunk.earningsBreakdown },
            payslipWorkDaySplit: computeWorkDayPackagePayslipSplit(listForPo, aggDeps),
          };
        });
      }

      const rateParts: string[] = [
        'registry: ฐานค่าแรงจากทะเบียน (ตำแหน่ง/กำหนดรายคน) — ไม่อาศัย labor cost term',
      ];
      if (anyOpecPositionLaborBase) {
        rateParts.push('OPEC: worker + ฐานรายสัญญา/ตำแหน่ง/PO snapshot');
      }
      if (usedPackageLaborCost) {
        rateParts.push(
          'work_day: package (8h+OT; ตัวคูณ OT จาก PO snapshot + วันหยุด/ตัวคูณจาก HR)',
        );
      }
      if (usedContractFallback) {
        rateParts.push('event: ตัวคูณจาก HR Settings (standby/travel/ฯลฯ)');
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

      const recovery = await fetchWorkerCashAdvancesPendingSalaryRecovery(this.db, workerId);
      const deductionsBreakdown: Record<string, number> = { ...d8Line.deductionsBreakdown };
      let lineNetAmount = d8Line.netAmount;
      if (recovery.total > 0) {
        deductionsBreakdown[CASH_ADVANCE_PAYROLL_DEDUCTION_KEY] = round2Payroll(recovery.total);
        lineNetAmount = round2Payroll(d8Line.netAmount - recovery.total);
        for (const a of recovery.advances) {
          advanceIdsToLinkToBatch.push(a.id);
        }
      }

      const lineDedTotalFull = Object.values(deductionsBreakdown).reduce((a, b) => a + (Number(b) || 0), 0);
      batchDeductions += lineDedTotalFull;
      batchNet += lineNetAmount;

      const wkLine = workerById.get(workerId);
      const posLine = wkLine?.currentPositionId ? posById.get(wkLine.currentPositionId) : null;
      const firstWm = timesheetToLaborWorkMode(workerTs[0]);
      const snapRes = wkLine
        ? resolveWorkerLaborBaseRate(
            {
              laborCostUsePositionDefault: wkLine.laborCostUsePositionDefault,
              laborCostCustomOnshore: wkLine.laborCostCustomOnshore,
              laborCostCustomOffshore: wkLine.laborCostCustomOffshore,
              positionAllowanceDailyBaht: wkLine.positionAllowanceDailyBaht,
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
        deductionsBreakdown,
        grossAmount: workerGross,
        netAmount: lineNetAmount,
        d8Snapshot: d8Line.snapshot,
        laborCostResolutionSnapshot,
        exportStatus: 'pending',
        ...(incomeSegments
          ? { incomeSegments }
          : { payslipWorkDaySplit: computeWorkDayPackagePayslipSplit(workerTs, aggDeps) }),
      };

      lines.push(line);
      batchGross += workerGross;
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

    /**
     * เขียน batch + lines ก่อน แล้วค่อยล็อก timesheet เป็นช่วงๆ
     * — กันเกิน 500 ops ต่อ batch และลด burst เขียนที่ทำให้ได้ resource-exhausted (quota)
     */
    const parsedBatch = PayrollBatchSchema.parse(newBatch);
    const headerWb = writeBatch(this.db);
    headerWb.set(batchRef, parsedBatch);
    for (const line of lines) {
      const lineRef = doc(this.db, 'payroll_batches', batchId, 'lines', line.id);
      headerWb.set(lineRef, PayrollBatchLineSchema.parse(line));
    }
    await headerWb.commit();
    await payrollSleep(PAYROLL_FS_COMMIT_GAP_MS);

    const lockFields = {
      status: 'LOCKED' as const,
      lockedAt: Date.now(),
      lockedBy: user.displayName,
      updatedAt: Date.now(),
    };
    for (let i = 0; i < timesheets.length; i += PAYROLL_FS_WRITE_CHUNK) {
      const slice = timesheets.slice(i, i + PAYROLL_FS_WRITE_CHUNK);
      const lockWb = writeBatch(this.db);
      for (const ts of slice) {
        lockWb.update(doc(this.db, 'daily_timesheets', ts.id), lockFields);
      }
      await lockWb.commit();
      if (i + PAYROLL_FS_WRITE_CHUNK < timesheets.length) {
        await payrollSleep(PAYROLL_FS_COMMIT_GAP_MS);
      }
    }

    /** ผูกคำขอเบิกแยก batch — กันเกิน limit 500 ops ของ Firestore เมื่อมี timesheet จำนวนมาก */
    if (advanceIdsToLinkToBatch.length > 0) {
      const nowLink = Date.now();
      let wbAdv = writeBatch(this.db);
      let advOps = 0;
      for (const advId of advanceIdsToLinkToBatch) {
        wbAdv.update(doc(this.db, 'cash_advance_requests', advId), {
          payrollRecoveryBatchId: batchId,
          updatedAt: nowLink,
        });
        advOps++;
        if (advOps >= 400) {
          await wbAdv.commit();
          wbAdv = writeBatch(this.db);
          advOps = 0;
          await payrollSleep(PAYROLL_FS_COMMIT_GAP_MS);
        }
      }
      if (advOps > 0) await wbAdv.commit();
    }

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
      if (i + chunkSize < unique.length) await payrollSleep(PAYROLL_FS_COMMIT_GAP_MS);
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
      if (i + chunkSize < refs.length) await payrollSleep(PAYROLL_FS_COMMIT_GAP_MS);
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
    await this.clearCashAdvanceRecoveriesForPayrollBatch(batchId);
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

  /** คืนสถานะคำขอเบิกล่วงหน้าเมื่อลบ batch (ให้หักในงวดถัดไปได้) */
  private async clearCashAdvanceRecoveriesForPayrollBatch(batchId: string): Promise<void> {
    const snap = await getDocs(
      query(collection(this.db, 'cash_advance_requests'), where('payrollRecoveryBatchId', '==', batchId)),
    );
    if (snap.empty) return;
    let wb = writeBatch(this.db);
    let n = 0;
    for (const d of snap.docs) {
      wb.update(d.ref, { payrollRecoveryBatchId: deleteField(), updatedAt: Date.now() });
      n++;
      if (n >= 400) {
        await wb.commit();
        wb = writeBatch(this.db);
        n = 0;
        await payrollSleep(PAYROLL_FS_COMMIT_GAP_MS);
      }
    }
    if (n > 0) await wb.commit();
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
    await this.clearCashAdvanceRecoveriesForPayrollBatch(batchId);
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
   * ผู้จัดการ HR / ผู้จัดการปฏิบัติการ (+แอดมิน): อนุมัติจ่ายครั้งเดียว → คิวบัญชีรอจ่าย (HR_REVIEWED → FINANCE_PREPARED)
   * ไม่มีขั้น HR_APPROVED + ปุ่มส่งบัญชีแยก — payroll officer ไม่เรียกเมธอดนี้ (ใช้ส่งขออนุมัติเท่านั้น)
   */
  async managerApprovePayoutAndNotifyAccounting(id: string, user: User) {
    if (!canApprovePayroll(user)) {
      throw new Error('Permission denied: approve payroll');
    }
    assertPayrollPermission(user, 'payroll_worker', 'approve');
    if (!canApproveWorkerPayrollBatchAsManager(user)) {
      throw new Error(
        'อนุมัติจ่ายได้เฉพาะผู้จัดการ HR / ผู้จัดการปฏิบัติการหรือผู้ดูแลระบบ',
      );
    }
    const docRef = doc(this.getBatchCollection(), id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('Payroll batch not found');
    const st = (snap.data() as PayrollBatch).status;
    if (st !== 'HR_REVIEWED') {
      throw new Error('อนุมัติยอดทำจ่ายได้เฉพาะงวดที่ฝ่ายเงินเดือนส่งขออนุมัติแล้ว (รอ — HR_REVIEWED)');
    }
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
   * บัญชียืนยันจ่าย → สร้าง cashbook ตามชุดแถวที่เลือก (แบ่งหลายบัญชีได้) · สถานะ PAID เมื่อทุกแถวจ่ายครบ
   */
  async financeConfirmWorkerBatchPaid(
    id: string,
    user: User,
    options?: { payoutBankAccountId?: string; lineIds?: string[] },
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

    const linesSnap = await getDocs(collection(this.db, 'payroll_batches', id, 'lines'));
    const lineRows = linesSnap.docs.map((d) => ({ docId: d.id, ...(d.data() as PayrollBatchLine) }));
    if (!lineRows.length) throw new Error('ไม่มีบรรทัดในงวดนี้');

    const periodRef = doc(this.db, 'payroll_periods', batch.payrollPeriodId);
    const periodSnap = await getDoc(periodRef);
    const periodLabel = periodSnap.exists() ? (periodSnap.data() as PayrollPeriod).label : batch.payrollPeriodId;

    const chosenBank = (options?.payoutBankAccountId ?? batch.payoutBankAccountId)?.trim();
    if (!chosenBank) {
      throw new Error('กรุณาเลือกบัญชีธนาคารสำหรับตัดจ่ายก่อนยืนยันจ่าย (หน้ารายละเอียด batch)');
    }

    const requestedIds =
      options?.lineIds && options.lineIds.length > 0 ? options.lineIds : lineRows.map((r) => r.docId);
    const selected = lineRows.filter((r) => requestedIds.includes(r.docId));
    if (selected.length !== requestedIds.length) {
      throw new Error('บางแถวที่เลือกไม่พบในงวด');
    }
    for (const l of selected) {
      const pid = (l as PayrollBatchLine).financePayoutCashbookEntryId;
      if (pid) {
        throw new Error(`แถว "${(l as PayrollBatchLine).workerNameSnapshot || l.docId}" ตัดบัญชีแล้ว`);
      }
    }

    const sumNet = Math.round(
      selected.reduce((s, l) => s + (Number((l as PayrollBatchLine).netAmount) || 0), 0) * 100,
    ) / 100;
    if (!(sumNet > 0)) {
      throw new Error('ยอดสุทธิของชุดที่เลือกไม่ถูกต้อง');
    }

    const unpaidBefore = lineRows.filter((r) => !(r as PayrollBatchLine).financePayoutCashbookEntryId);
    const stillUnpaidAfter = unpaidBefore.filter((r) => !selected.some((s) => s.docId === r.docId));
    const allPaidNow = stillUnpaidAfter.length === 0;

    const chunkRef = `${id}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const { cashbookEntryId, bankAccountId } = await recordPayrollFinanceApprovalPayout(this.db, user, {
      runId: chunkRef,
      netAmount: sumNet,
      payrollRunNo: batch.id,
      payrollMonthLabel: periodLabel,
      existingCashbookEntryId: undefined,
      payoutBankAccountId: chosenBank,
      kind: 'WORKER',
      descriptionSuffix:
        selected.length < lineRows.length ? ` · แบ่งจ่าย ${selected.length}/${lineRows.length} คน` : '',
    });

    const now = Date.now();
    const wb = writeBatch(this.db);
    for (const l of selected) {
      wb.update(doc(this.db, 'payroll_batches', id, 'lines', l.docId), {
        financePayoutCashbookEntryId: cashbookEntryId,
        financePayoutBankAccountId: bankAccountId,
        financePaidAt: now,
        updatedAt: now,
      } as DocumentData);
    }

    if (allPaidNow) {
      wb.update(docRef, {
        status: 'PAID',
        d8LifecycleStatus: batchStatusToD8Lifecycle('PAID'),
        financeCashbookEntryId: cashbookEntryId,
        payoutBankAccountId: bankAccountId,
        financeApprovedBy: user.displayName,
        financeApprovedAt: now,
        updatedAt: now,
      } as DocumentData);
    } else {
      wb.update(docRef, {
        payoutBankAccountId: bankAccountId,
        updatedAt: now,
      } as DocumentData);
    }
    await wb.commit();

    await writeAuditLog(this.db, user, {
      actionType: 'PAID',
      entityType: 'PayrollBatch',
      entityId: id,
      payrollBatchId: id,
      sourceModule: 'accounting',
      afterSummary: allPaidNow
        ? `Accounting confirmed full payout; cashbook ${cashbookEntryId}`
        : `Accounting partial payout ${selected.length} lines; cashbook ${cashbookEntryId}`,
    });

    return { alreadyDone: false as const, cashbookEntryId, allPaidNow };
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
   * คำนวณใหม่เฉพาะคนงานหนึ่งคนจากใบงานที่ผูกไว้ (`sourceTimesheetIds`) — **คง** เบี้ยเลี้ยง/หักพิเศษ/ภงด. และยอดหักเบิกล่วงหน้าที่บันทึกแล้ว
   * ไม่แตะบรรทัดคนอื่น — ใช้แทน Regenerate ทั้ง batch เมื่อแก้สูตร/ซ้ำวันแล้วไม่ต้องเสียการปรับยอดทุกคน
   */
  async recalculateWorkerPayrollLinePreserveHrAdjustments(
    batchId: string,
    workerId: string,
    user: User,
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
        'คำนวณใหม่รายคนได้เฉพาะก่อนส่งต่อบัญชี (สถานะ GENERATED / HR_REVIEWED / HR_APPROVED)',
      );
    }

    const periodSnap = await getDoc(doc(this.db, 'payroll_periods', batch.payrollPeriodId));
    const periodFromLineEnd =
      typeof line.periodEndDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(line.periodEndDate)
        ? line.periodEndDate
        : null;
    if (!periodSnap.exists() && !periodFromLineEnd) {
      throw new Error('ไม่พบรอบบัญชีและไม่มี periodEndDate บนบรรทัด');
    }
    const period = periodSnap.exists()
      ? (periodSnap.data() as PayrollPeriod)
      : ({
          startDate: line.periodStartDate,
          endDate: periodFromLineEnd!,
        } as PayrollPeriod);

    const rawIds = [...new Set((line.sourceTimesheetIds ?? []).filter(Boolean))];
    if (rawIds.length === 0) throw new Error('ไม่มี sourceTimesheetIds — ไม่สามารถคำนวณใหม่ได้');

    const loaded: DailyTimesheet[] = [];
    for (const tid of rawIds) {
      const s = await getDoc(doc(this.db, 'daily_timesheets', tid));
      if (!s.exists()) continue;
      loaded.push({ id: s.id, ...(s.data() as object) } as DailyTimesheet);
    }
    if (loaded.length === 0) throw new Error('โหลดใบงานรายวันไม่ได้ — เอกสารอาจถูกลบ');

    const workerTs = normalizeTimesheetsForPayrollLine(loaded);
    for (const ts of workerTs) {
      if (ts.workerId !== workerId) {
        throw new Error('พบใบงานที่ไม่ใช่ของลูกจ้างรายนี้ใน sourceTimesheetIds');
      }
    }

    const contractMap = new Map<string, MainContract>();
    const contractIds = Array.from(new Set(workerTs.map((ts) => ts.contractId).filter(Boolean)));
    await Promise.all(
      contractIds.map(async (contractId) => {
        const contractSnap = await getDoc(doc(this.db, 'main_contracts', contractId));
        if (contractSnap.exists()) {
          contractMap.set(contractId, { ...(contractSnap.data() as MainContract), id: contractSnap.id });
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
      inheritIds.map(async (contractId) => {
        if (contractMap.has(contractId)) return;
        const contractSnap = await getDoc(doc(this.db, 'main_contracts', contractId));
        if (contractSnap.exists()) {
          contractMap.set(contractId, { ...(contractSnap.data() as MainContract), id: contractSnap.id });
        }
      }),
    );

    const poLineById = new Map<string, unknown>();
    const poIds = Array.from(new Set(workerTs.map((ts) => ts.purchaseOrderId).filter(Boolean)));
    await Promise.all(
      poIds.map(async (poId) => {
        const linesSnap = await getDocs(collection(this.db, 'purchase_orders', poId, 'po_lines'));
        linesSnap.docs.forEach((lineDoc) => poLineById.set(lineDoc.id, lineDoc.data()));
      }),
    );

    const poById = new Map<string, PurchaseOrder>();
    await Promise.all(
      poIds.map(async (poId) => {
        const poSnap = await getDoc(doc(this.db, 'purchase_orders', poId));
        if (poSnap.exists()) {
          poById.set(poId, { ...(poSnap.data() as PurchaseOrder), id: poSnap.id });
        }
      }),
    );

    const customerIdsForPo = [...new Set([...poById.values()].map((p) => p.customerId).filter(Boolean))];
    const customerNameById = new Map<string, string>();
    await Promise.all(
      customerIdsForPo.map(async (cid) => {
        const s = await getDoc(doc(this.db, 'customers', cid));
        if (s.exists()) {
          const c = s.data() as Customer;
          customerNameById.set(cid, (c.name || '').trim() || cid);
        }
      }),
    );

    const { workerById, posById } = await loadWorkersAndPositionsForPayroll(this.db, workerTs);
    const workerGlobalLabor = await fetchWorkerGlobalLaborContextFromFirestore(this.db);

    const ppQuery = query(
      collection(this.db, 'worker_payment_profiles'),
      where('workerId', '==', workerId),
      where('status', '==', 'ACTIVE'),
      limit(1),
    );
    const ppSnap = await getDocs(ppQuery);
    const ppSnapshot = ppSnap.empty ? { paymentMethod: 'CASH' as const } : ppSnap.docs[0].data();

    const aggDeps = {
      poLineById,
      workerById,
      posById,
      contractMap,
      workerGlobalLabor,
    };

    const byPo = new Map<string, DailyTimesheet[]>();
    for (const ts of workerTs) {
      const pid = (ts.purchaseOrderId || '').trim() || '_unknown_po';
      if (!byPo.has(pid)) byPo.set(pid, []);
      byPo.get(pid)!.push(ts);
    }

    const chunksOrdered: Array<{ poId: string; chunk: ReturnType<typeof aggregateDailyTimesheetsPayrollChunk> }> =
      [];
    for (const [poId, list] of byPo) {
      chunksOrdered.push({ poId, chunk: aggregateDailyTimesheetsPayrollChunk(list, aggDeps) });
    }

    const mergedChunk = mergePayrollTimesheetAggChunks(chunksOrdered.map((c) => c.chunk));
    const workerGross = mergedChunk.gross;
    const eventBreakdown = mergedChunk.eventBreakdown;
    const earningsBreakdown = mergedChunk.earningsBreakdown;
    const usedPackageLaborCost = mergedChunk.usedPackageLaborCost;
    const usedContractFallback = mergedChunk.usedContractFallback;
    const anyOpecPositionLaborBase = mergedChunk.anyOpecPositionLaborBase;

    const laborTermIds: string[] = [];
    const conditionIds: string[] = [];

    const payingPoChunks = chunksOrdered.filter((c) => c.chunk.gross > 0);
    let incomeSegments: PayrollBatchIncomeSegment[] | undefined;
    if (payingPoChunks.length > 1) {
      incomeSegments = payingPoChunks.map(({ poId, chunk }) => {
        const po = poById.get(poId);
        const cid = (po?.customerId || '').trim() || undefined;
        return {
          purchaseOrderId: poId,
          customerId: cid,
          poCodeSnapshot: po?.poCode,
          customerNameSnapshot: cid ? customerNameById.get(cid) : undefined,
          grossAmount: round2Payroll(chunk.gross),
          eventBreakdown: { ...chunk.eventBreakdown },
          earningsBreakdown: { ...chunk.earningsBreakdown },
        };
      });
    }

    const rateParts: string[] = [
      'registry: ฐานค่าแรงจากทะเบียน (ตำแหน่ง/กำหนดรายคน) — ไม่อาศัย labor cost term',
    ];
    if (anyOpecPositionLaborBase) {
      rateParts.push('OPEC: worker + ฐานรายสัญญา/ตำแหน่ง/PO snapshot');
    }
    if (usedPackageLaborCost) {
      rateParts.push(
        'work_day: package (8h+OT; ตัวคูณ OT จาก PO snapshot + วันหยุด/ตัวคูณจาก HR)',
      );
    }
    if (usedContractFallback) {
      rateParts.push('event: ตัวคูณจาก HR Settings (standby/travel/ฯลฯ)');
    }
    const rateSummary = rateParts.join(' | ');

    const policyRecords = await loadPayrollPoliciesFromFirestore(this.db);
    const asOf = period.endDate;
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

    const hrStored: HrPayrollLineAdjustments | null | undefined = line.hrLineAdjustments;
    const allowanceItems = (hrStored?.allowanceItems ?? []).map((x) => ({
      label: String(x.label || '').trim(),
      amount: Math.max(0, Number(x.amount) || 0),
    }));
    const deductionItems = (hrStored?.deductionItems ?? []).map((x) => ({
      label: String(x.label || '').trim(),
      amount: Math.max(0, Number(x.amount) || 0),
    }));

    const allowanceTotal = allowanceItems.reduce((s, x) => s + x.amount, 0);
    const effectiveGross = Math.max(0, workerGross + allowanceTotal);

    const rateSnap = d8Line.snapshot.rate;
    const d8WithAllowances = computeWorkerPayrollLineD8({
      asOfDate: asOf,
      policies: resolvedPolicies,
      grossFromTimesheets: effectiveGross,
      rate: rateSnap
        ? {
            summary: rateSnap.summary,
            conditionIds: rateSnap.conditionIds,
            laborTermIds: rateSnap.laborTermIds,
          }
        : { summary: 'hr_line_recalc' },
      earningsBreakdown: {
        ...earningsBreakdown,
        hr_allowances: allowanceTotal,
      },
    });

    const pitOv = hrStored?.pitWithholdingOverride;
    const mr = hrStored?.pitWithholdingOverrideMaxMarginalRatePercent;
    const mode: WorkerPitCalculationMode =
      hrStored?.workerPitMode ??
      (mr != null && Number.isFinite(mr)
        ? 'auto_timesheet'
        : pitOv != null && Number.isFinite(pitOv)
          ? 'manual_baht'
          : 'auto_timesheet');

    const deductions: Record<string, number> = { ...d8WithAllowances.deductionsBreakdown };
    if (mode === 'manual_baht') {
      deductions.pit_withholding = Math.max(0, Number(pitOv) || 0);
    } else if (mode === 'auto_salary_base') {
      const base = Math.max(0, Number(hrStored?.pitAutoSalaryBaseBaht) || 0);
      deductions.pit_withholding = pitFromMonthlyGross(base, resolvedPolicies.tax, resolvedPolicies.sso);
    } else {
      if (mr != null && Number.isFinite(mr)) {
        const clamped = Math.max(0, Math.min(35, Number(mr)));
        deductions.pit_withholding = pitFromMonthlyGrossWithMarginalCeiling(
          effectiveGross,
          resolvedPolicies.tax,
          resolvedPolicies.sso,
          clamped,
        );
      } else {
        deductions.pit_withholding = pitFromMonthlyGross(
          effectiveGross,
          resolvedPolicies.tax,
          resolvedPolicies.sso,
        );
      }
    }
    deductionItems.forEach((d, idx) => {
      deductions[`manual_ded_${idx}`] = Math.max(0, Number(d.amount) || 0);
    });

    const caRecover = Number(line.deductionsBreakdown?.[CASH_ADVANCE_PAYROLL_DEDUCTION_KEY]) || 0;
    if (caRecover > 0) {
      deductions[CASH_ADVANCE_PAYROLL_DEDUCTION_KEY] = Math.round(caRecover * 100) / 100;
    }

    const dedTotal = Object.values(deductions).reduce((a, b) => a + (Number(b) || 0), 0);
    const netAmount = Math.round((effectiveGross - dedTotal) * 100) / 100;

    const d8Snapshot: PayrollLineD8Snapshot = {
      ...d8WithAllowances.snapshot,
      gross: effectiveGross,
      deductions: { ...deductions },
      net: netAmount,
      earningsComponents: {
        ...(d8WithAllowances.snapshot.earningsComponents || {}),
        hr_allowances: allowanceTotal,
      },
    };

    const trimmedNotes = hrStored?.notes?.trim();
    const storeMr =
      mode === 'auto_timesheet' && mr != null && Number.isFinite(mr) && Math.max(0, Math.min(35, Number(mr))) < 35
        ? Math.max(0, Math.min(35, Number(mr)))
        : null;
    const hrLineAdjustments: HrPayrollLineAdjustments = {
      allowanceItems,
      deductionItems,
      workerPitMode: mode,
      pitAutoSalaryBaseBaht:
        mode === 'auto_salary_base' ? Math.max(0, Number(hrStored?.pitAutoSalaryBaseBaht) || 0) : null,
      pitWithholdingOverride:
        mode === 'manual_baht' ? (Number.isFinite(Number(pitOv)) ? Math.max(0, Number(pitOv)) : null) : null,
      pitWithholdingOverrideMaxMarginalRatePercent: storeMr,
      notes: trimmedNotes || undefined,
      updatedAt: Date.now(),
      updatedBy: user.displayName || user.email || user.id,
    };

    const wkLine = workerById.get(workerId);
    const posLine = wkLine?.currentPositionId ? posById.get(wkLine.currentPositionId) : null;
    const firstWm = timesheetToLaborWorkMode(workerTs[0]);
    const snapRes = wkLine
      ? resolveWorkerLaborBaseRate(
          {
            laborCostUsePositionDefault: wkLine.laborCostUsePositionDefault,
            laborCostCustomOnshore: wkLine.laborCostCustomOnshore,
            laborCostCustomOffshore: wkLine.laborCostCustomOffshore,
            positionAllowanceDailyBaht: wkLine.positionAllowanceDailyBaht,
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

    const patch: Record<string, unknown> = {
      workerPaymentProfileSnapshot: ppSnapshot,
      assignmentIds: Array.from(new Set(workerTs.map((ts) => ts.assignmentId))),
      sourceTimesheetIds: workerTs.map((ts) => ts.id),
      periodStartDate: period.startDate,
      periodEndDate: period.endDate,
      eventBreakdown,
      earningsBreakdown,
      grossAmount: workerGross,
      deductionsBreakdown: deductions,
      netAmount,
      d8Snapshot,
      hrLineAdjustments,
      laborCostResolutionSnapshot: laborCostResolutionSnapshot ?? deleteField(),
      updatedAt: Date.now(),
    };
    if (incomeSegments) {
      patch.incomeSegments = incomeSegments;
      patch.payslipWorkDaySplit = deleteField();
    } else {
      patch.incomeSegments = deleteField();
      patch.payslipWorkDaySplit = computeWorkDayPackagePayslipSplit(workerTs, aggDeps);
    }

    await updateDoc(lineRef, patch as DocumentData);

    await this.recalculateBatchTotalsFromLines(batchId, user);

    await writeAuditLog(this.db, user, {
      actionType: 'UPDATE',
      entityType: 'PayrollBatchLine',
      entityId: lineId,
      payrollBatchId: batchId,
      sourceModule: 'hr',
      afterSummary: `Recalculate worker line from timesheets (preserve HR adjustments); gross ${workerGross.toFixed(2)}`,
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
      deductions.pit_withholding = pitFromMonthlyGross(base, resolved.tax, resolved.sso);
    } else {
      if (mr != null && Number.isFinite(mr)) {
        const clamped = Math.max(0, Math.min(35, Number(mr)));
        deductions.pit_withholding = pitFromMonthlyGrossWithMarginalCeiling(
          effectiveGross,
          resolved.tax,
          resolved.sso,
          clamped,
        );
      } else {
        deductions.pit_withholding = pitFromMonthlyGross(effectiveGross, resolved.tax, resolved.sso);
      }
    }
    input.deductionItems.forEach((d, idx) => {
      deductions[`manual_ded_${idx}`] = Math.max(0, Number(d.amount) || 0);
    });

    const caRecover = Number(line.deductionsBreakdown?.[CASH_ADVANCE_PAYROLL_DEDUCTION_KEY]) || 0;
    if (caRecover > 0) {
      deductions[CASH_ADVANCE_PAYROLL_DEDUCTION_KEY] = Math.round(caRecover * 100) / 100;
    }

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

  /**
   * HR ปรับรายรับเพิ่ม / หักเพิ่มรายคนงวดพนักงานออฟฟิศ — คำนวณ gross / SS / PIT / net ใหม่ตาม policy
   */
  async applyOfficeLineHrAdjustments(
    runId: string,
    lineId: string,
    user: User,
    input: ApplyOfficeLineHrAdjustmentsInput,
  ): Promise<void> {
    assertPayrollPermission(user, 'payroll_office', 'edit_batch');
    await this.applyPayrollRunLineHrAdjustmentsInternal(
      'office_payroll_runs',
      runId,
      lineId,
      user,
      input,
      'OfficePayrollLine',
      'office',
    );
  }

  /**
   * บัญชีปรับรายรับเพิ่ม / หักเพิ่มรายคนงวดผู้บริหาร — สูตร D8 เดียวกับพนักงานออฟฟิศ
   */
  async applyExecutiveLineHrAdjustments(
    runId: string,
    lineId: string,
    user: User,
    input: ApplyOfficeLineHrAdjustmentsInput,
  ): Promise<void> {
    if (!canEdit(user, 'executive_payroll')) {
      throw new Error('ไม่มีสิทธิ์แก้ไขงวดเงินเดือนผู้บริหาร');
    }
    await this.applyPayrollRunLineHrAdjustmentsInternal(
      'executive_payroll_runs',
      runId,
      lineId,
      user,
      input,
      'ExecutivePayrollLine',
      'accounting',
    );
  }

  private async applyPayrollRunLineHrAdjustmentsInternal(
    runCollection: 'office_payroll_runs' | 'executive_payroll_runs',
    runId: string,
    lineId: string,
    user: User,
    input: ApplyOfficeLineHrAdjustmentsInput,
    auditEntityType: string,
    auditSourceModule: string,
  ): Promise<void> {
    const runRef = doc(this.db, runCollection, runId);
    const lineRef = doc(this.db, runCollection, runId, 'lines', lineId);

    const [runSnap, lineSnap] = await Promise.all([getDoc(runRef), getDoc(lineRef)]);
    if (!runSnap.exists()) throw new Error('ไม่พบงวดเงินเดือน');
    if (!lineSnap.exists()) throw new Error('ไม่พบบรรทัดจ่ายในงวดนี้');

    const run = runSnap.data() as OfficePayrollRun;
    const line = lineSnap.data() as OfficePayrollLine;

    const blocked = ['LOCKED', 'PAID', 'CANCELLED', 'FINANCE_APPROVED'] as const;
    if ((blocked as readonly string[]).includes(run.status)) {
      throw new Error('แก้ไขรายคนได้เฉพาะก่อนอนุมัติจ่าย/ล็อกงวด (สถานะ DRAFT–HR_APPROVED)');
    }

    const asOf = run.payrollPeriodEnd || `${run.payrollMonth}-28`;
    const policies = await loadPayrollPoliciesFromFirestore(this.db);
    const resolved = resolvePayrollPoliciesForDate(asOf, policies, 'office');

    const pitMode: OfficePayrollPitMode = input.pitMode ?? 'SYSTEM';
    const deductSocialSecurity = input.deductSocialSecurity !== false;

    const d8 = computeOfficePayrollLineD8({
      asOfDate: asOf,
      policies: resolved,
      baseSalary: line.baseSalary,
      allowance: line.allowance ?? 0,
      bonus: line.bonus ?? 0,
      overtimeAmount: line.overtimeAmount ?? 0,
      otherIncome: line.otherIncome ?? 0,
      hrAllowanceItems: input.allowanceItems,
      hrDeductionItems: input.deductionItems,
      deductSocialSecurity,
      pitMode,
      pitManualPercent: pitMode === 'MANUAL_PERCENT' ? Number(input.pitManualPercent) || 0 : undefined,
      pitManualAmountBaht: pitMode === 'MANUAL_AMOUNT' ? Number(input.pitManualAmountBaht) || 0 : undefined,
    });

    const trimmedNotes = input.notes?.trim();
    const hrLineAdjustments: OfficePayrollLineHrAdjustments = {
      allowanceItems: input.allowanceItems,
      deductionItems: input.deductionItems,
      notes: trimmedNotes ? trimmedNotes : null,
      deductSocialSecurity,
      pitMode,
      pitManualPercent:
        pitMode === 'MANUAL_PERCENT' ? Math.max(0, Math.min(100, Number(input.pitManualPercent) || 0)) : null,
      pitManualAmountBaht:
        pitMode === 'MANUAL_AMOUNT' ? Math.max(0, Number(input.pitManualAmountBaht) || 0) : null,
      updatedAt: Date.now(),
      updatedBy: user.displayName || user.email || user.id,
    };

    await updateDoc(lineRef, {
      grossPay: d8.grossPay,
      tax: d8.tax,
      socialSecurity: d8.socialSecurity,
      deductions: d8.deductions,
      netPay: d8.netPay,
      d8Snapshot: d8.snapshot,
      hrLineAdjustments,
      updatedAt: Date.now(),
    });

    await this.recalculatePayrollRunTotalsFromLines(runCollection, runId, user);

    const hrExtra = input.allowanceItems.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    await writeAuditLog(this.db, user, {
      actionType: 'UPDATE',
      entityType: auditEntityType,
      entityId: lineId,
      sourceModule: auditSourceModule,
      afterSummary: `HR adjustments ${runCollection} ${runId} line ${lineId} (extra income +${hrExtra.toFixed(2)})`,
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

  private async recalculatePayrollRunTotalsFromLines(
    runCollection: 'office_payroll_runs' | 'executive_payroll_runs',
    runId: string,
    user: User,
  ): Promise<void> {
    const linesSnap = await getDocs(collection(this.db, runCollection, runId, 'lines'));
    let grossAmount = 0;
    let netAmount = 0;
    let totalDeductions = 0;
    let totalAllowances = 0;
    for (const d of linesSnap.docs) {
      const pl = d.data() as OfficePayrollLine;
      grossAmount += Number(pl.grossPay) || 0;
      netAmount += Number(pl.netPay) || 0;
      totalDeductions += Number(pl.deductions) || 0;
      const hrAllow = (pl.hrLineAdjustments?.allowanceItems ?? []).reduce(
        (s, x) => s + (Number(x.amount) || 0),
        0,
      );
      totalAllowances += (Number(pl.allowance) || 0) + (Number(pl.bonus) || 0) + hrAllow;
    }
    await updateDoc(doc(this.db, runCollection, runId), {
      grossAmount: Math.round(grossAmount * 100) / 100,
      netAmount: Math.round(netAmount * 100) / 100,
      totalDeductions: Math.round(totalDeductions * 100) / 100,
      totalAllowances: Math.round(totalAllowances * 100) / 100,
      updatedAt: Date.now(),
      updatedBy: user.displayName || user.email || user.id,
    });
  }

}
