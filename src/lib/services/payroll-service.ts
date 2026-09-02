
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
  type QuerySnapshot,
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
  ExecutiveNonPayrollIncomeType,
  Assignment,
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
import {
  normalizePriorPeriodAllowanceItems,
  sumPriorPeriodAllowances,
  sumRegularAllowances,
} from '@/lib/payroll/prior-period-allowance';

/** Input สำหรับปรับยอดรายคนงวดออฟฟิศ / ผู้บริหาร */
export type ApplyOfficeLineHrAdjustmentsInput = {
  allowanceItems: Array<{ label: string; amount: number }>;
  deductionItems: Array<{ label: string; amount: number }>;
  notes?: string;
  deductSocialSecurity?: boolean;
  pitMode?: OfficePayrollPitMode;
  pitManualPercent?: number | null;
  pitManualAmountBaht?: number | null;
  pitManualIncomeLabel?: string | null;
  pitManualIncomeType?: ExecutiveNonPayrollIncomeType | null;
};
import { recordPayrollFinanceApprovalPayout } from '@/lib/services/payroll-payout-service';
import { writeAuditLog } from './audit-service';
import {
  batchStatusToD8Lifecycle,
  computeWorkerPayrollLineD8,
  computeOfficePayrollLineD8,
  loadPayrollPoliciesFromFirestore,
  resolvePayrollPoliciesForDate,
  forceSupplementalNoSocialSecurity,
  resolveWorkerPitWithholdingBaht,
} from '@/lib/payroll/d8';
import {
  buildLaborCostResolutionSnapshot,
  resolveWorkerLaborBaseRate,
} from '@/lib/payroll/labor-cost-model';
import {
  loadWorkersAndPositionsForPayroll,
  ensurePositionsLoadedForTimesheets,
  loadPayrollPoLineMaps,
  loadPayrollPoContractIdMap,
  collectPayrollContractIds,
  buildPoContractIdMapFromPurchaseOrders,
  buildPoWorkModeMapFromPurchaseOrders,
  loadPayrollPoWorkModeMap,
  resolvePoLineForPayrollTimesheet,
  resolveEffectivePayrollContractId,
  resolveEffectivePayrollJobMode,
  timesheetToLaborWorkMode,
} from '@/lib/payroll/timesheet-labor-base-cost';
import { computeRegistryWorkerTimesheetGross } from '@/lib/payroll/registry-worker-timesheet-gross';
import { fetchWorkerGlobalLaborContextFromFirestore } from '@/lib/payroll/worker-global-labor-policy';
import {
  calendarYearMonthFromPeriodStart,
  hasApprovedMonthlyTimesheetForYearMonth,
  shouldGatePayrollOnMonthlyApproval,
} from '@/lib/payroll/monthly-timesheet-approval-gate';
import { reopenWorkerMonthClosuresAfterPayrollCancel } from '@/lib/timesheet/worker-month-closure';
import {
  aggregateDailyTimesheetsPayrollChunk,
  mergePayrollTimesheetAggChunks,
} from '@/lib/payroll/aggregate-payroll-timesheet-chunks';
import { computeWorkDayPackagePayslipSplit } from '@/lib/payroll/work-day-payslip-split';
import {
  buildPayrollLineDailyRowSnapshots,
  hasPositiveTimesheetGrossById,
  isUsableDailyRowSnapshots,
  loadDailyTimesheetsByIds,
} from '@/lib/payroll/payroll-line-daily-snapshots';
import {
  applyCashAdvanceRecoveryToOfficeD8Line,
  CASH_ADVANCE_PAYROLL_DEDUCTION_KEY,
  fetchOfficeStaffCashAdvancesPendingSalaryRecovery,
  fetchWorkerCashAdvancesPendingSalaryRecovery,
} from '@/lib/payroll/cash-advance-recovery';
import { normalizeTimesheetsForPayrollLine } from '@/lib/payroll/dedupe-timesheets-for-payroll';
import {
  filterTimesheetsForWorkerPayrollAsync,
  loadWorkerTimesheetsForPayrollLine,
} from '@/lib/payroll/filter-timesheets-for-worker-payroll';
import {
  ensureLaborCostEpochAfterMobFinish,
  inferOffshorePackageFromOt15PriorItems,
  loadAssignmentsAndApplyRemobPositionForPayroll,
  syncAssignmentPositionFromWorkerOnRemob,
} from '@/lib/payroll/remob-position-for-payroll';
import { loadPriorPaidFrozenPayrollSlice } from '@/lib/payroll/prior-paid-timesheet-gross';
import { stripUndefinedForFirestore } from '@/lib/firestore/strip-undefined-for-firestore';
import {
  payrollBatchChronologyMs,
  PRIOR_PAID_RECOVERY_DEDUCTION_KEY,
  resolveLineNetForPayslip,
} from '@/lib/payroll/payslip-model';
import { 
  markRetroAdjustmentsApplied, 
  retroAdjustmentsToPriorPeriodLabels,
  retroAdjustmentsToPriorPeriodItemsWithPay,
  revertRetroAdjustmentsForPayrollBatch 
} from './timesheet-retro-adjustment-service';

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

/** คนงานที่มีใบงานพร้อมจ่ายในรอบนี้ (ยังไม่ถูกล็อกจาก batch เก่า) */
export interface PayrollPreflightEligibleWorker {
  workerId: string;
  workerName: string;
  timesheetCount: number;
  /** true = ทุกใบงานในรอบนี้คำนวณ gross ได้ 0 */
  hasZeroGross: boolean;
}

export interface PayrollPreflightResult {
  totalWorkers: number;
  totalTimesheets: number;
  /** รายชื่อเลือกจ่ายได้ — สร้าง batch หลายรอบในเดือนเดียวได้ (ที่เหลือรอรอบถัดไป) */
  eligibleWorkers: PayrollPreflightEligibleWorker[];
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

  async generateSupplementalPayrollBatch(
    periodId: string, 
    user: User, 
    filters?: { workerIds?: string[] }
  ): Promise<string> {
    if (!canPreparePayroll(user)) throw new Error('Permission denied: prepare payroll');
    assertPayrollPermission(user, 'payroll_worker', 'create_batch');

    const periodRef = doc(this.db, 'payroll_periods', periodId);
    const periodSnap = await getDoc(periodRef);
    if (!periodSnap.exists()) throw new Error('ไม่พบรอบบัญชี (payroll period)');
    const period = periodSnap.data() as PayrollPeriod;
    const payrollYearMonth = calendarYearMonthFromPeriodStart(period.startDate);
    if (!payrollYearMonth) throw new Error('รอบบัญชีมีวันที่เริ่มต้นไม่ถูกต้อง');
    console.log('[Supplemental] Step 1: ✅ อ่านรอบบัญชีสำเร็จ ym=', payrollYearMonth);

    // 1. รายการแก้ไขย้อนหลังที่ตั้งใจจ่ายในงวดนี้ (applyPayrollYearMonth)
    //    — ไม่ใช้ sourceYearMonth (เดือนที่ทำงาน) เพราะ OT ก.ค. จ่ายใน ส.ค. ต้องมากับงวด ส.ค.
    console.log('[Supplemental] Step 2: ดึง retro adjustments (applyPayrollYearMonth=' + payrollYearMonth + ')...');
    const retroQuery = query(
      collection(this.db, 'timesheet_retro_adjustments'),
      where('applyPayrollYearMonth', '==', payrollYearMonth),
    );
    const retroSnap = await getDocs(retroQuery);
    let retroItems = retroSnap.docs
      .map(d => ({ ...d.data(), id: d.id } as import('@/lib/types').TimesheetRetroAdjustment))
      .filter((r) => r.status === 'approved');
    console.log('[Supplemental] Step 2: ✅ พบ retro adjustments', retroItems.length, 'รายการ');

    if (filters?.workerIds?.length) {
      const allow = new Set(filters.workerIds.map((id) => id.trim()).filter(Boolean));
      retroItems = retroItems.filter((r) => allow.has(r.workerId));
    }

    if (retroItems.length === 0) {
      throw new Error('ไม่พบรายการแก้ไขย้อนหลัง (ตกเบิก) ที่รอจ่ายในรอบนี้');
    }

    // 2. Group by worker
    const itemsByWorker = new Map<string, import('@/lib/types').TimesheetRetroAdjustment[]>();
    retroItems.forEach(r => {
      const list = itemsByWorker.get(r.workerId) || [];
      list.push(r);
      itemsByWorker.set(r.workerId, list);
    });

    // 3. Load worker data
    const workerIds = Array.from(itemsByWorker.keys());
    console.log('[Supplemental] Step 3: ดึงข้อมูลพนักงาน', workerIds.length, 'คน...');
    const workerMap = new Map<string, import('@/lib/types').Worker>();
    const paymentMap = new Map<string, WorkerPaymentProfile>();
    await Promise.all(workerIds.map(async id => {
      const snap = await getDoc(doc(this.db, 'workers', id));
      if (snap.exists()) workerMap.set(id, { ...snap.data(), id: snap.id } as import('@/lib/types').Worker);
      const paySnap = await getDoc(doc(this.db, 'worker_payment_profiles', id));
      if (paySnap.exists()) paymentMap.set(id, { ...paySnap.data(), id: paySnap.id } as WorkerPaymentProfile);
    }));
    console.log('[Supplemental] Step 3: ✅ ดึงข้อมูลพนักงานสำเร็จ');

    // โหลด payroll policies (วิธีเดียวกับ NORMAL batch)
    console.log('[Supplemental] Step 4: ดึง payroll policies...');
    const policyRecords = await loadPayrollPoliciesFromFirestore(this.db);
    const resolvedPolicies = resolvePayrollPoliciesForDate(period.endDate, policyRecords, 'worker');
    console.log('[Supplemental] Step 4: ✅ policies โหลดสำเร็จ');

    // 4. Calculate accumulated gross for the same tax month
    console.log('[Supplemental] Step 5: ดึงยอด gross รอบก่อนหน้า...');
    const priorGrossMap = new Map<string, number>();
    const priorBatchesQuery = query(
      collection(this.db, 'payroll_batches'),
      where('payrollPeriodId', '==', periodId)
    );
    const priorBatchesSnap = await getDocs(priorBatchesQuery);
    // Filter != 'SUPPLEMENTAL' in memory to avoid composite index requirement
    const priorBatchIds = priorBatchesSnap.docs
      .filter(d => d.data().batchType !== 'SUPPLEMENTAL')
      .map(d => d.id);
    console.log('[Supplemental] Step 5a: ✅ พบ prior batches', priorBatchIds.length, 'รอบ');
    
    if (priorBatchIds.length > 0) {
      for (const batchId of priorBatchIds) {
        for (let i = 0; i < workerIds.length; i += 30) {
          const chunk = workerIds.slice(i, i + 30);
          const linesQuery = query(
            collection(this.db, 'payroll_batches', batchId, 'lines'),
            where('workerId', 'in', chunk)
          );
          const linesSnap = await getDocs(linesQuery);
          linesSnap.forEach(docSnap => {
            const line = docSnap.data() as PayrollBatchLine;
            const current = priorGrossMap.get(line.workerId) || 0;
            priorGrossMap.set(line.workerId, current + (line.grossAmount || 0));
          });
        }
      }
    }
    console.log('[Supplemental] Step 5b: ✅ คำนวณ prior gross สำเร็จ');

    // 5. Generate lines
    const batchId = `PAY-${Date.now().toString().slice(-8)}`;
    let batchGross = 0;
    let batchDeductions = 0;
    let batchNet = 0;
    const lines: PayrollBatchLine[] = [];

    const now = Date.now();
    for (const [workerId, adjustments] of itemsByWorker) {
      // คำนวณยอดใหม่จาก rate matrix จริง (ไม่เชื่อ computedPayAmountBaht snapshot)
      console.log(`[Supplemental] คำนวณยอด retro ใหม่จาก rate matrix สำหรับ worker ${workerId} (${adjustments.length} รายการ)`);
      const priorItems = await retroAdjustmentsToPriorPeriodItemsWithPay(this.db, adjustments);
      let workerGross = priorItems.reduce((s, it) => s + (it.amount || 0), 0);
      console.log(`[Supplemental] worker ${workerId}: gross=${workerGross} (จาก ${priorItems.length} รายการ)`);
      
      const priorGross = priorGrossMap.get(workerId) || 0;
      
      const d8Line = computeWorkerPayrollLineD8({
        asOfDate: period.endDate,
        policies: resolvedPolicies,
        grossFromTimesheets: workerGross,
        rate: { summary: 'Supplemental Run', conditionIds: [], laborTermIds: [] },
        earningsBreakdown: {},
        batchType: 'SUPPLEMENTAL',
        priorPaidTaxableGross: priorGross
      });

      const lineNetAmount = Math.round(d8Line.netAmount * 100) / 100;
      const lineDedTotal = Object.values(d8Line.deductionsBreakdown).reduce((a, b) => a + (Number(b) || 0), 0);

      batchGross += workerGross;
      batchDeductions += lineDedTotal;
      batchNet += lineNetAmount;

      const profile = workerMap.get(workerId);
      const payment = paymentMap.get(workerId);

      const lineId = `${batchId}_${workerId}`;
      const line: PayrollBatchLine = {
        id: lineId,
        payrollBatchId: batchId,
        workerId,
        workerNameSnapshot: profile ? `${profile.firstName} ${profile.lastName}` : 'Unknown',
        workerPaymentProfileSnapshot: payment || {},
        assignmentIds: [],
        sourceTimesheetIds: [],
        periodStartDate: period.startDate,
        periodEndDate: period.endDate,
        eventBreakdown: {},
        earningsBreakdown: {},
        deductionsBreakdown: d8Line.deductionsBreakdown,
        grossAmount: workerGross,
        netAmount: lineNetAmount,
        d8Snapshot: d8Line.snapshot,
        exportStatus: 'pending',
        hrLineAdjustments: {
          allowanceItems: [],
          deductionItems: [],
          priorPeriodAllowanceItems: priorItems,
          pitWithholdingOverride: null
        }
      };
      lines.push(line);
    }

    // 6. Write batch and lines
    const batch: PayrollBatch = {
      id: batchId,
      payrollPeriodId: periodId,
      batchType: 'SUPPLEMENTAL',
      workModeScope: 'mixed',
      status: 'GENERATED',
      d8LifecycleStatus: batchStatusToD8Lifecycle('GENERATED'),
      totalWorkers: lines.length,
      grossAmount: batchGross,
      totalDeductions: batchDeductions,
      netAmount: batchNet,
      createdBy: user.displayName,
      updatedBy: user.displayName,
      createdAt: now,
      updatedAt: now,
    };

    console.log('[Supplemental] Step 6a: เขียน batch header...');
    const headerWb = writeBatch(this.db);
    headerWb.set(doc(this.db, 'payroll_batches', batchId), batch);
    await headerWb.commit();
    console.log('[Supplemental] Step 6a: ✅ batch header เขียนสำเร็จ');
    
    // Write lines and update adjustments in batches
    console.log('[Supplemental] Step 6b: เขียน lines...');
    for (let i = 0; i < lines.length; i += 300) {
      const slice = lines.slice(i, i + 300);
      const lineWb = writeBatch(this.db);
      for (const line of slice) {
        const lineData = stripUndefinedForFirestore(PayrollBatchLineSchema.parse(line)) as DocumentData;
        lineWb.set(doc(this.db, 'payroll_batches', batchId, 'lines', line.id), lineData);
      }
      await lineWb.commit();
    }
    console.log('[Supplemental] Step 6b: ✅ lines เขียนสำเร็จ');

    // Mark adjustments as applied
    console.log('[Supplemental] Step 7: อัปเดตสถานะ retro adjustments...');
    for (const [workerId, adjustments] of itemsByWorker) {
      const line = lines.find(l => l.workerId === workerId);
      if (line) {
        await markRetroAdjustmentsApplied(this.db, user, adjustments.map(a => a.id), batchId, line.id);
      }
    }
    console.log('[Supplemental] Step 7: ✅ retro adjustments อัปเดตสำเร็จ');

    console.log('[Supplemental] Step 8: เขียน audit log...');
    await writeAuditLog(this.db, user, {
      actionType: 'GENERATE',
      entityType: 'PayrollBatch',
      entityId: batchId,
      payrollBatchId: batchId,
      entityLabel: `${period.label} Supplemental Batch`,
      sourceModule: 'hr',
      afterSummary: `Generated supplemental batch for ${lines.length} workers.`
    });
    console.log('[Supplemental] Step 8: ✅ audit log เขียนสำเร็จ');

    return batchId;
  }

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
   * Generates a Payroll Batch after monthly timesheet approval.
   * Per worker: gross/tax on **full calendar month** (including already-LOCKED paid days),
   * then deduct prior paid net (`PRIOR_PAID_RECOVERY`); lock only unpaid days this run.
   * Remob / multi-cycle: never drop unpaid recorded work days.
   */
  /**
   * Pre-flight check: identifies workers whose gross will be 0 due to missing rate setup.
   * Call before generatePayrollBatch to let HR decide whether to proceed.
   */
  async preflightPayrollCheck(
    periodId: string,
    filters?: { workModeScope?: 'onshore' | 'offshore' | 'mixed'; batchType?: 'NORMAL' | 'SUPPLEMENTAL' },
  ): Promise<PayrollPreflightResult> {
    const periodRef = doc(this.db, 'payroll_periods', periodId);
    const periodSnap = await getDoc(periodRef);
    if (!periodSnap.exists()) throw new Error('ไม่พบรอบบัญชี (payroll period)');
    const period = periodSnap.data() as PayrollPeriod;

    const monthlyGate = await this.assertMonthlyTimesheetApprovalForPeriod(period);

    if (filters?.batchType === 'SUPPLEMENTAL') {
      const payrollYearMonth = calendarYearMonthFromPeriodStart(period.startDate);
      if (!payrollYearMonth) throw new Error('รอบบัญชีมีวันที่เริ่มต้นไม่ถูกต้อง');
      /** ดึงตามงวดที่จะจ่าย (apply) — OT ต้นทาง ก.ค. ที่ตั้งจ่าย ส.ค. ต้องโผล่ตอนเลือกงวด ส.ค. */
      const retroQuery = query(
        collection(this.db, 'timesheet_retro_adjustments'),
        where('applyPayrollYearMonth', '==', payrollYearMonth),
      );
      const retroSnap = await getDocs(retroQuery);
      const retroItems = retroSnap.docs
        .map(d => ({ ...d.data(), id: d.id } as import('@/lib/types').TimesheetRetroAdjustment))
        .filter((r) => r.status === 'approved');
      
      const workerRetroMap = new Map<string, import('@/lib/types').TimesheetRetroAdjustment[]>();
      for (const r of retroItems) {
        if (!workerRetroMap.has(r.workerId)) workerRetroMap.set(r.workerId, []);
        workerRetroMap.get(r.workerId)!.push(r);
      }
      
      const eligibleWorkers: PayrollPreflightEligibleWorker[] = [];
      for (const [workerId, items] of workerRetroMap.entries()) {
        eligibleWorkers.push({
          workerId,
          workerName: items[0].workerNameSnapshot || 'Unknown',
          timesheetCount: items.length, // representing adjustment count
          hasZeroGross: false,
        });
      }
      
      eligibleWorkers.sort((a, b) => a.workerName.localeCompare(b.workerName, 'th'));
      
      return {
        totalWorkers: eligibleWorkers.length,
        totalTimesheets: retroItems.length,
        eligibleWorkers,
        zeroGrossWorkers: [],
        hasWarnings: false,
        missingApprovedMonthlyTimesheet: monthlyGate.missingApprovedMonthlyTimesheet,
        payrollYearMonth: monthlyGate.payrollYearMonth,
      };
    }

    const tsQuery = query(
      collection(this.db, 'daily_timesheets'),
      where('date', '>=', period.startDate),
      where('date', '<=', period.endDate),
    );
    const tsSnap = await getDocs(tsQuery);
    let timesheets = tsSnap.docs
      .map((d) => ({ ...d.data(), id: d.id } as DailyTimesheet))
      .filter((ts) => ts.status !== 'LOCKED' && ts.status !== 'REJECTED');

    timesheets = await filterTimesheetsForWorkerPayrollAsync(this.db, timesheets);

    const poIdsForScope = Array.from(new Set(timesheets.map((ts) => ts.purchaseOrderId).filter(Boolean)));
    const poWorkModeByPoId = await loadPayrollPoWorkModeMap(this.db, poIdsForScope);

    if (filters?.workModeScope && filters.workModeScope !== 'mixed') {
      timesheets = timesheets.filter(
        (ts) =>
          resolveEffectivePayrollJobMode(ts, poWorkModeByPoId).toLowerCase() === filters.workModeScope,
      );
    }

    const poIds = Array.from(new Set(timesheets.map((ts) => ts.purchaseOrderId).filter(Boolean)));

    const [poLineMaps, poContractById] = await Promise.all([
      loadPayrollPoLineMaps(this.db, poIds),
      loadPayrollPoContractIdMap(this.db, poIds),
    ]);

    const contractMap = new Map<string, MainContract>();
    const contractIds = collectPayrollContractIds(timesheets, poContractById);
    await Promise.all(
      contractIds.map(async (cid) => {
        const contractSnap = await getDoc(doc(this.db, 'main_contracts', cid));
        if (contractSnap.exists()) {
          const contractData = { ...(contractSnap.data() as MainContract), id: contractSnap.id };
          const ratesSnap = await getDocs(collection(this.db, 'main_contracts', cid, 'position_rates'));
          contractData.positionRates = ratesSnap.docs.map(d => ({ id: d.id, ...(d.data() as object) } as PositionRate));
          contractMap.set(cid, contractData);
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
          const contractData = { ...(contractSnap.data() as MainContract), id: contractSnap.id };
          const ratesSnap = await getDocs(collection(this.db, 'main_contracts', cid, 'position_rates'));
          contractData.positionRates = ratesSnap.docs.map(d => ({ id: d.id, ...(d.data() as object) } as PositionRate));
          contractMap.set(cid, contractData);
        }
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
    const eligibleWorkers: PayrollPreflightEligibleWorker[] = [];

    for (const workerId in workerTsMap) {
      const workerTs = workerTsMap[workerId];
      let hasAnyRate = false;
      const missingReasons = new Set<string>();

      for (const ts of workerTs) {
        const poLine = resolvePoLineForPayrollTimesheet(ts, poLineMaps);
        const wk = preflightWorkerById.get(ts.workerId);
        const linePos = ts.positionId ? preflightPosById.get(ts.positionId) : undefined;
        const r = computeRegistryWorkerTimesheetGross(ts, {
          worker: wk,
          linePosition: linePos,
          poLine,
          contractMap,
          poContractById,
          poWorkModeByPoId,
          workerGlobalLabor,
        });
        if (r.gross > 0) {
          hasAnyRate = true;
        } else {
          const payrollContractId = resolveEffectivePayrollContractId(ts, poContractById);
          const contractLabel =
            (payrollContractId && contractMap.get(payrollContractId)?.contractNumber) ||
            payrollContractId ||
            ts.purchaseOrderId ||
            '?';
          missingReasons.add(
            `${ts.date} ${ts.eventType} [${contractLabel}]: ฐานค่าแรงหรือตัวคูณได้ 0 (ตรวจอัตราต้นทุนตามสัญญา/ตำแหน่ง และ HR ตั้งค่าตัวคูณ/ปฏิทิน)`,
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

      eligibleWorkers.push({
        workerId,
        workerName: workerTs[0].workerNameSnapshot,
        timesheetCount: workerTs.length,
        hasZeroGross: !hasAnyRate,
      });
    }

    eligibleWorkers.sort((a, b) => a.workerName.localeCompare(b.workerName, 'th'));

    return {
      totalWorkers: eligibleWorkers.length,
      totalTimesheets: timesheets.length,
      eligibleWorkers,
      zeroGrossWorkers,
      hasWarnings: zeroGrossWorkers.length > 0,
      missingApprovedMonthlyTimesheet: monthlyGate.missingApprovedMonthlyTimesheet,
      payrollYearMonth: monthlyGate.payrollYearMonth,
    };
  }

  async generatePayrollBatch(
    periodId: string, 
    user: User, 
    filters?: { workModeScope?: 'onshore' | 'offshore' | 'mixed'; workerIds?: string[]; batchType?: 'NORMAL' | 'SUPPLEMENTAL' },
  ): Promise<string> {
    if (!canPreparePayroll(user)) {
      throw new Error('Permission denied: prepare payroll');
    }
    assertPayrollPermission(user, 'payroll_worker', 'create_batch');
    if (filters?.batchType === 'SUPPLEMENTAL') {
      return this.generateSupplementalPayrollBatch(periodId, user, { workerIds: filters.workerIds });
    }

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

    /**
     * หลังปิดงวดรายเดือนแล้ว — ดึงใบงานทั้งเดือนที่ยังไม่ LOCKED
     * (ไม่ตัดรอบ remob เก่าเพราะ readyForPayroll ค้าง false; กรอง unpaid_leave / auto ค้างที่ filter)
     */
    const tsQuery = query(
      collection(this.db, 'daily_timesheets'),
      where('date', '>=', period.startDate),
      where('date', '<=', period.endDate),
    );
    const tsSnap = await getDocs(tsQuery);
    
    let timesheets = tsSnap.docs
      .map(d => ({ ...d.data(), id: d.id } as DailyTimesheet))
      .filter((ts) => ts.status !== 'LOCKED' && ts.status !== 'REJECTED');

    timesheets = await filterTimesheetsForWorkerPayrollAsync(this.db, timesheets);

    if (filters?.workerIds?.length) {
      const allow = new Set(filters.workerIds.map((id) => id.trim()).filter(Boolean));
      timesheets = timesheets.filter((ts) => allow.has(ts.workerId));
    }

    const poIds = Array.from(new Set(timesheets.map((ts) => ts.purchaseOrderId).filter(Boolean)));

    const poById = new Map<string, PurchaseOrder>();
    await Promise.all(
      poIds.map(async (poId) => {
        const poSnap = await getDoc(doc(this.db, 'purchase_orders', poId));
        if (poSnap.exists()) {
          poById.set(poId, { ...(poSnap.data() as PurchaseOrder), id: poSnap.id });
        }
      }),
    );

    const poWorkModeByPoId = buildPoWorkModeMapFromPurchaseOrders(poById.values());

    if (filters?.workModeScope && filters.workModeScope !== 'mixed') {
      timesheets = timesheets.filter(
        (ts) =>
          resolveEffectivePayrollJobMode(ts, poWorkModeByPoId).toLowerCase() === filters.workModeScope,
      );
    }

    if (timesheets.length === 0) {
      throw new Error(
        filters?.workerIds?.length
          ? 'ไม่พบใบงานของคนงานที่เลือกในรอบนี้ — อาจถูกล็อกจาก batch ก่อนหน้าแล้ว'
          : 'ไม่พบใบงานรายวันที่ยังไม่จ่ายในรอบนี้ — หรือทุกวันเป็น unpaid_leave / ถูกกรองแล้ว',
      );
    }

    const poContractById = buildPoContractIdMapFromPurchaseOrders(poById.values());
    const [poLineMaps] = await Promise.all([loadPayrollPoLineMaps(this.db, poIds)]);

    const contractMap = new Map<string, MainContract>();
    const contractIds = collectPayrollContractIds(timesheets, poContractById);
    await Promise.all(
      contractIds.map(async (contractId) => {
        const contractSnap = await getDoc(doc(this.db, 'main_contracts', contractId));
        if (contractSnap.exists()) {
          const contractData = { ...(contractSnap.data() as MainContract), id: contractSnap.id };
          const ratesSnap = await getDocs(collection(this.db, 'main_contracts', contractId, 'position_rates'));
          contractData.positionRates = ratesSnap.docs.map(d => ({ id: d.id, ...(d.data() as object) } as PositionRate));
          contractMap.set(contractId, contractData);
        }
      }),
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
          const contractData = { ...(contractSnap.data() as MainContract), id: contractSnap.id };
          const ratesSnap = await getDocs(collection(this.db, 'main_contracts', contractId, 'position_rates'));
          contractData.positionRates = ratesSnap.docs.map(d => ({ id: d.id, ...(d.data() as object) } as PositionRate));
          contractMap.set(contractId, contractData);
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

    /**
     * ตกเบิก (retro) จ่ายผ่าน SUPPLEMENTAL batch เท่านั้น
     * — ห้ามแนบ status=applied เข้า NORMAL (เคยทำให้จ่ายซ้ำหลัง supplemental จ่ายไปแล้ว)
     */

    const { workerById, posById } = await loadWorkersAndPositionsForPayroll(this.db, timesheets);

    const workerGlobalLabor = await fetchWorkerGlobalLaborContextFromFirestore(this.db);

    // Aggregate by Worker — ใบที่ยังไม่ LOCKED (จะล็อกในงวดนี้)
    const workerMap: Record<string, DailyTimesheet[]> = {};
    timesheets.forEach(ts => {
      if (!workerMap[ts.workerId]) workerMap[ts.workerId] = [];
      workerMap[ts.workerId].push(ts);
    });

    const batchId = `PAY-${Date.now().toString().slice(-8)}`;
    const batchRef = doc(this.getBatchCollection(), batchId);
    const lines: PayrollBatchLine[] = [];
    /** stub สำหรับหา prior paid ในงวดเดียวกัน */
    const batchChronologyStub = {
      id: batchId,
      payrollPeriodId: periodId,
      createdAt: Date.now(),
      status: 'GENERATED' as const,
    };

    let batchGross = 0;
    let batchDeductions = 0;
    let batchNet = 0;
    const advanceIdsToLinkToBatch: string[] = [];

    const policyRecords = await loadPayrollPoliciesFromFirestore(this.db);
    const asOf = period.endDate;

    for (const workerId in workerMap) {
      const unpaidWorkerTs = normalizeTimesheetsForPayrollLine(workerMap[workerId]);
      /**
       * รวมวันทั้งเดือน (รวม LOCKED ที่จ่ายไปแล้ว) — คิดภาษี/ค่าแรงทั้งเดือน
       * แล้วหักยอดงวดก่อน; ล็อกเฉพาะใบที่ยังไม่จ่ายในรอบนี้
       */
      const fullMonthLoaded = await loadWorkerTimesheetsForPayrollLine(
        this.db,
        workerId,
        period.startDate,
        period.endDate,
        unpaidWorkerTs.map((t) => t.id),
      );
      let workerTs = normalizeTimesheetsForPayrollLine(
        fullMonthLoaded.length > 0 ? fullMonthLoaded : unpaidWorkerTs,
      );

      /** remob + เปลี่ยนตำแหน่งทะเบียน — ซิงก์ assignment แล้วทับ positionId วันหลังจบรอบเก่า */
      const asgnIds = [...new Set(workerTs.map((t) => String(t.assignmentId || '').trim()).filter(Boolean))];
      await Promise.all(
        asgnIds.map(async (aid) => {
          const snap = await getDoc(doc(this.db, 'mobilizations', aid));
          if (!snap.exists()) return;
          const asgn = { id: snap.id, ...(snap.data() as object) } as Assignment;
          await syncAssignmentPositionFromWorkerOnRemob(this.db, asgn);
        }),
      );

      const priorPaidFrozen = await loadPriorPaidFrozenPayrollSlice(this.db, {
        payrollPeriodId: periodId,
        workerId,
        currentBatchId: batchId,
        currentBatchChronologyMs: batchChronologyStub.createdAt,
      });
      const inferredPreRemobPkg = inferOffshorePackageFromOt15PriorItems(
        priorPaidFrozen.priorPeriodAllowanceItems,
      );

      const remobApplied = await loadAssignmentsAndApplyRemobPositionForPayroll(
        this.db,
        workerTs,
        workerById,
      );
      workerTs = remobApplied.timesheets;
      const assignmentById = remobApplied.assignmentById;
      await Promise.all(
        [...assignmentById.values()].map(async (asgn) => {
          const healed = await ensureLaborCostEpochAfterMobFinish(this.db, asgn, {
            inferredOffshorePackage: inferredPreRemobPkg,
          });
          assignmentById.set(asgn.id, healed);
        }),
      );
      await ensurePositionsLoadedForTimesheets(this.db, workerTs, posById);
      
      // Snapshot Worker Payment Profile
      const ppQuery = query(
        collection(this.db, 'worker_payment_profiles'),
        where('workerId', '==', workerId),
        where('status', '==', 'ACTIVE'),
        limit(1)
      );
      const ppSnap = await getDocs(ppQuery);
      const ppSnapshot = ppSnap.empty ? { paymentMethod: 'CASH' as any } : ppSnap.docs[0].data();

      const liveSourceTimesheetIds = new Set(unpaidWorkerTs.map((t) => t.id).filter(Boolean));

      const aggDeps = {
        poLineMaps,
        poContractById,
        poWorkModeByPoId,
        workerById,
        posById,
        contractMap,
        workerGlobalLabor,
        assignmentById,
        frozenTimesheetGrossById: priorPaidFrozen.byTimesheetId,
        priorPaidFrozen,
        liveSourceTimesheetIds,
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
      const timesheetGrossById = mergedChunk.timesheetGrossById;
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

      const priorNet = await this.sumPriorPaidNetForWorker(
        batchChronologyStub as PayrollBatch & { id: string },
        workerId,
      );
      if (priorNet > 0.005) {
        deductionsBreakdown[PRIOR_PAID_RECOVERY_DEDUCTION_KEY] = priorNet;
        lineNetAmount = round2Payroll(lineNetAmount - priorNet);
      }

      const lineDedTotalFull = Object.values(deductionsBreakdown).reduce((a, b) => a + (Number(b) || 0), 0);
      batchDeductions += lineDedTotalFull;
      batchNet += lineNetAmount;

      const wkLine = workerById.get(workerId);
      const posLine = wkLine?.currentPositionId ? posById.get(wkLine.currentPositionId) : null;
      const firstWm = timesheetToLaborWorkMode(workerTs[0], poWorkModeByPoId);
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
        workerNameSnapshot: workerTs[0].workerNameSnapshot || unpaidWorkerTs[0]?.workerNameSnapshot || workerId,
        workerPaymentProfileSnapshot: ppSnapshot,
        assignmentIds: Array.from(new Set(workerTs.map(ts => ts.assignmentId))),
        /** ล็อกเฉพาะวันที่ยังไม่จ่ายในรอบนี้ */
        sourceTimesheetIds: unpaidWorkerTs.map(ts => ts.id),
        periodStartDate: period.startDate,
        periodEndDate: period.endDate,
        eventBreakdown,
        earningsBreakdown,
        timesheetGrossById,
        dailyRowSnapshots: buildPayrollLineDailyRowSnapshots(workerTs, timesheetGrossById),
        deductionsBreakdown,
        grossAmount: workerGross,
        netAmount: lineNetAmount,
        d8Snapshot: d8Line.snapshot,
        ...(laborCostResolutionSnapshot ? { laborCostResolutionSnapshot } : {}),
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
    headerWb.set(batchRef, stripUndefinedForFirestore(parsedBatch) as DocumentData);
    for (const line of lines) {
      const lineRef = doc(this.db, 'payroll_batches', batchId, 'lines', line.id);
      headerWb.set(
        lineRef,
        stripUndefinedForFirestore(PayrollBatchLineSchema.parse(line)) as DocumentData,
      );
    }
    await headerWb.commit();
    await payrollSleep(PAYROLL_FS_COMMIT_GAP_MS);

    const lockGrossById: Record<string, number> = {};
    for (const line of lines) {
      for (const [tid, amt] of Object.entries(line.timesheetGrossById || {})) {
        const n = Number(amt);
        if (tid && Number.isFinite(n) && n > 0) lockGrossById[tid] = Math.round(n * 100) / 100;
      }
    }
    await this.lockTimesheetsForPayrollBatchAdmin(
      timesheets.map((ts) => ts.id),
      user.displayName || user.email || user.id || 'system',
      lockGrossById,
    );

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

  /**
   * ล็อกใบงานที่อยู่ในงวดจ่าย — กันแก้ต้นทางหลังสร้าง/จ่าย batch
   * (idempotent: เรียกซ้ำได้ถ้ายังมีใบงานใน sourceTimesheetIds ที่ยังไม่ LOCKED)
   */
  private async lockTimesheetsForPayrollBatchAdmin(
    timesheetIds: string[],
    lockedBy: string,
    grossById?: Record<string, number> | null,
  ): Promise<number> {
    const unique = [...new Set(timesheetIds.map((id) => String(id || '').trim()).filter(Boolean))];
    if (unique.length === 0) return 0;
    let locked = 0;
    for (let i = 0; i < unique.length; i += PAYROLL_FS_WRITE_CHUNK) {
      const slice = unique.slice(i, i + PAYROLL_FS_WRITE_CHUNK);
      const snaps = await Promise.all(slice.map((id) => getDoc(doc(this.db, 'daily_timesheets', id))));
      const lockWb = writeBatch(this.db);
      let ops = 0;
      for (const snap of snaps) {
        if (!snap.exists()) continue;
        const cur = snap.data() as DailyTimesheet;
        if (cur.status === 'LOCKED' && cur.readyForPayroll === false) continue;
        const amt = grossById ? Number(grossById[snap.id]) : NaN;
        const lockFields: Record<string, unknown> = {
          status: 'LOCKED' as const,
          readyForPayroll: false,
          lockedAt: Date.now(),
          lockedBy: lockedBy || 'system',
          updatedAt: Date.now(),
        };
        if (Number.isFinite(amt) && amt > 0) {
          lockFields.payrollLockedGrossBaht = Math.round(amt * 100) / 100;
        }
        lockWb.update(snap.ref, lockFields);
        ops++;
        locked++;
      }
      if (ops > 0) await lockWb.commit();
      if (i + PAYROLL_FS_WRITE_CHUNK < unique.length) {
        await payrollSleep(PAYROLL_FS_COMMIT_GAP_MS);
      }
    }
    return locked;
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
        /**
         * ปลดล็อกหลังลบ/สร้าง batch ใหม่ — ต้องตั้ง readyForPayroll กลับเป็น true
         * ไม่งั้นสร้าง batch ใหม่จะได้ 0 คน และปุ่มซิงก์อาจถูกซ่อนถ้ายังมี batch อื่นในเดือนเดียวกัน
         */
        wb.update(tsRef, {
          status: 'VERIFIED_PAPER',
          readyForPayroll: true,
          lockedAt: deleteField(),
          lockedBy: deleteField(),
          updatedAt: now,
        });
      }
      await wb.commit();
      if (i + chunkSize < unique.length) await payrollSleep(PAYROLL_FS_COMMIT_GAP_MS);
    }
  }

  /** ปลดล็อกใบงาน + เปิดงวดรายคนกลับ — ใช้ก่อนลบหรือสร้าง payroll batch ใหม่ */
  private async revertPayrollBatchSourceLocks(
    batch: PayrollBatch,
    linesSnap: QuerySnapshot,
    user: User,
  ): Promise<string[]> {
    const tsIds: string[] = [];
    for (const d of linesSnap.docs) {
      const line = d.data();
      line.sourceTimesheetIds?.forEach((id) => tsIds.push(id));
    }

    const periodSnap = await getDoc(doc(this.db, 'payroll_periods', batch.payrollPeriodId));
    const period = periodSnap.exists() ? (periodSnap.data() as PayrollPeriod) : null;
    const payrollYearMonth = period ? calendarYearMonthFromPeriodStart(period.startDate) : null;

    const poWorkerMap = new Map<string, Set<string>>();
    const uniqueTsIds = [...new Set(tsIds)].filter(Boolean);
    for (let i = 0; i < uniqueTsIds.length; i += 100) {
      const slice = uniqueTsIds.slice(i, i + 100);
      const snaps = await Promise.all(slice.map((id) => getDoc(doc(this.db, 'daily_timesheets', id))));
      for (const snap of snaps) {
        if (!snap.exists()) continue;
        const ts = { id: snap.id, ...(snap.data() as object) } as DailyTimesheet;
        const poId = String(ts.purchaseOrderId || '').trim();
        if (!poId) continue;
        const ym = payrollYearMonth || String(ts.date || '').slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(ym)) continue;
        const key = `${poId}|${ym}`;
        if (!poWorkerMap.has(key)) poWorkerMap.set(key, new Set());
        poWorkerMap.get(key)!.add(ts.workerId);
      }
    }

    await this.unlockTimesheetsForPayrollBatchAdmin(tsIds);

    for (const [key, ids] of poWorkerMap) {
      const sep = key.indexOf('|');
      const poId = key.slice(0, sep);
      const yearMonth = key.slice(sep + 1);
      await reopenWorkerMonthClosuresAfterPayrollCancel(this.db, {
        poId,
        yearMonth,
        workerIds: [...ids],
        actor: user,
        periodBounds: period
          ? { periodStartDate: period.startDate, periodEndDate: period.endDate }
          : undefined,
        /** คง readyForPayroll — ลบ/สร้าง batch ใหม่ต้องเห็นคนทันที ไม่ต้องรอซิงก์ */
        preserveReadyPayroll: true,
      });
    }

    return tsIds;
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
    const tsIds = await this.revertPayrollBatchSourceLocks(batch, linesSnap, user);
    await this.clearCashAdvanceRecoveriesForPayrollBatch(batchId);
    if (batch.batchType === 'SUPPLEMENTAL') {
      await revertRetroAdjustmentsForPayrollBatch(this.db, user, batchId);
    }
    await this.deletePayrollBatchSubcollectionAndDoc(batchId);
    await writeAuditLog(this.db, user, {
      actionType: 'DELETE',
      entityType: 'PayrollBatch',
      entityId: batchId,
      payrollBatchId: batchId,
      sourceModule: 'hr',
      afterSummary: 'Admin deleted payroll batch; timesheets unlocked and worker month closures reopened for edit',
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
    await this.revertPayrollBatchSourceLocks(batch, linesSnap, user);
    await this.clearCashAdvanceRecoveriesForPayrollBatch(batchId);
    if (batch.batchType === 'SUPPLEMENTAL') {
      await revertRetroAdjustmentsForPayrollBatch(this.db, user, batchId);
    }
    await this.deletePayrollBatchSubcollectionAndDoc(batchId);
    await writeAuditLog(this.db, user, {
      actionType: 'DELETE',
      entityType: 'PayrollBatch',
      entityId: batchId,
      payrollBatchId: batchId,
      sourceModule: 'hr',
      afterSummary: 'Admin removed batch before regenerate (unlock + delete)',
    });
    
    if (batch.batchType === 'SUPPLEMENTAL') {
      return this.generateSupplementalPayrollBatch(periodId, user);
    }
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
      financeRejectedBy: deleteField(),
      financeRejectedAt: deleteField(),
      financeRejectReason: deleteField(),
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
   * บัญชีไม่อนุมัติจ่าย — คืนสถานะ GENERATED (ฝ่ายเงินเดือนตรวจ/แก้ไข แล้วส่งขอผู้จัดการอนุมัติใหม่)
   * ใช้ได้เฉพาะงวดที่ยังไม่ตัด cashbook รายคน (FINANCE_PREPARED / PAYMENT_EXPORTED)
   */
  async financeRejectWorkerBatchPayout(id: string, user: User, options?: { reason?: string }) {
    if (!canConfirmWorkerPayrollPaid(user)) {
      throw new Error('ไม่มีสิทธิ์ไม่อนุมัติจ่าย — ใช้เฉพาะฝ่ายบัญชี');
    }
    const docRef = doc(this.getBatchCollection(), id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('Payroll batch not found');
    const batch = snap.data() as PayrollBatch;
    const st = batch.status;
    if (st !== 'FINANCE_PREPARED' && st !== 'PAYMENT_EXPORTED') {
      throw new Error('ไม่อนุมัติจ่ายได้เฉพาะงวดที่อยู่ในคิวบัญชี (FINANCE_PREPARED / PAYMENT_EXPORTED)');
    }
    if (batch.financeCashbookEntryId) {
      throw new Error('งวดนี้มีรายการ cashbook แล้ว — ไม่สามารถส่งกลับตรวจได้');
    }
    const linesSnap = await getDocs(collection(this.db, 'payroll_batches', id, 'lines'));
    let paidLineCount = 0;
    linesSnap.forEach((d) => {
      if ((d.data() as PayrollBatchLine).financePayoutCashbookEntryId) paidLineCount += 1;
    });
    if (paidLineCount > 0) {
      throw new Error(
        `มีรายการที่ตัดจ่ายแล้ว ${paidLineCount} คน — ไม่สามารถไม่อนุมัติทั้งงวดได้ (ต้องจัดการรายที่จ่ายแล้วก่อน)`,
      );
    }
    const reason = (options?.reason || '').trim();
    await updateDoc(docRef, {
      status: 'GENERATED',
      d8LifecycleStatus: batchStatusToD8Lifecycle('GENERATED'),
      officerPayoutRequestBy: deleteField(),
      officerPayoutRequestAt: deleteField(),
      hrApprovedBy: deleteField(),
      hrApprovedAt: deleteField(),
      financePreparedBy: deleteField(),
      financePreparedAt: deleteField(),
      financeRejectedBy: user.displayName,
      financeRejectedAt: Date.now(),
      ...(reason ? { financeRejectReason: reason } : { financeRejectReason: deleteField() }),
      updatedAt: Date.now(),
    });
    await writeAuditLog(this.db, user, {
      actionType: 'REJECT',
      entityType: 'PayrollBatch',
      entityId: id,
      payrollBatchId: id,
      sourceModule: 'accounting',
      afterSummary: reason
        ? `Accounting rejected payout → GENERATED: ${reason}`
        : 'Accounting rejected payout; returned to GENERATED for payroll re-check',
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
      /** ซ่อมใบงานที่ควรล็อกแต่ยังไม่ LOCKED + ซ่อมยอด snapshot ให้ครบหลาย PO + prior paid */
      try {
        await this.ensurePaidBatchLineSnapshotsPersisted(id, user);
      } catch {
        /* best-effort */
      }
      try {
        const linesSnap = await getDocs(collection(this.db, 'payroll_batches', id, 'lines'));
        const tsIds: string[] = [];
        linesSnap.forEach((d) => {
          const line = d.data() as PayrollBatchLine;
          (line.sourceTimesheetIds ?? []).forEach((tid) => tsIds.push(tid));
        });
        await this.lockTimesheetsForPayrollBatchAdmin(
          tsIds,
          user.displayName || user.email || user.id || 'system',
        );
      } catch {
        /* best-effort */
      }
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

    const unpaidBefore = lineRows.filter((r) => !(r as PayrollBatchLine).financePayoutCashbookEntryId);
    const stillUnpaidAfter = unpaidBefore.filter((r) => !selected.some((s) => s.docId === r.docId));
    const allPaidNow = stillUnpaidAfter.length === 0;

    /**
     * บันทึกยอดหลาย PO + หักยอดงวดก่อนหน้าลง line ก่อนตัด cashbook
     * — ยอดที่ผู้จัดการ/บัญชีอนุมัติแล้วต้องตัดได้เสมอ ถ้าคำนวณใหม่ไม่ได้ให้ใช้ snapshot บนแถว
     */
    const refreshedNetByDocId = new Map<string, number>();
    for (const l of selected) {
      try {
        const result = await this.recalculateWorkerPayrollLinePreserveHrAdjustments(
          id,
          (l as PayrollBatchLine).workerId,
          user,
          { bypassFinanceStatusGate: true, includePriorPaidRecovery: true },
        );
        refreshedNetByDocId.set(l.docId, result.netAmount);
      } catch (err) {
        console.warn(
          '[financeConfirmWorkerBatchPaid] skip recalc, use approved snapshot',
          (l as PayrollBatchLine).workerId,
          err,
        );
      }
    }

    const sumNet =
      Math.round(
        selected.reduce((s, l) => {
          const refreshed = refreshedNetByDocId.get(l.docId);
          const fallback = Number((l as PayrollBatchLine).netAmount) || 0;
          return s + (refreshed ?? fallback);
        }, 0) * 100,
      ) / 100;
    if (!(sumNet > 0)) {
      throw new Error('ยอดสุทธิของชุดที่เลือกไม่ถูกต้อง');
    }

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

    /** ล็อกใบงานของแถวที่ตัดบัญชีแล้ว — รวมกรณีที่ generate พลาดหรือรวม PO ทีหลัง */
    const paidTsIds: string[] = [];
    for (const l of selected) {
      ((l as PayrollBatchLine).sourceTimesheetIds ?? []).forEach((tid) => paidTsIds.push(tid));
    }
    await this.lockTimesheetsForPayrollBatchAdmin(
      paidTsIds,
      user.displayName || user.email || user.id || 'system',
    );

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

  /**
   * ซ่อมล็อกใบงานใน sourceTimesheetIds ของงวดที่จ่าย/ล็อกแล้ว
   * — ใช้เมื่อมีใบงานยังไม่ LOCKED ทั้งที่ batch เป็น PAID แล้ว
   */
  async ensureBatchSourceTimesheetsLocked(batchId: string, user: User): Promise<number> {
    const allowed =
      canConfirmWorkerPayrollPaid(user) || isSystemAdmin(user) || isPayrollOfficer(user);
    if (!allowed) {
      assertPayrollPermission(user, 'payroll_worker', 'edit_batch');
    }
    const batchRef = doc(this.getBatchCollection(), batchId);
    const batchSnap = await getDoc(batchRef);
    if (!batchSnap.exists()) throw new Error('ไม่พบ payroll batch');
    const batch = batchSnap.data() as PayrollBatch;
    if (batch.status !== 'PAID' && batch.status !== 'LOCKED' && batch.status !== 'FINANCE_PREPARED' && batch.status !== 'PAYMENT_EXPORTED') {
      throw new Error('ล็อกซ่อมได้เมื่องวดอยู่ในสถานะจ่าย/เตรียมจ่ายแล้วเท่านั้น');
    }
    const linesSnap = await getDocs(collection(this.db, 'payroll_batches', batchId, 'lines'));
    const tsIds: string[] = [];
    linesSnap.forEach((d) => {
      const line = d.data() as PayrollBatchLine;
      (line.sourceTimesheetIds ?? []).forEach((tid) => tsIds.push(tid));
    });
    const n = await this.lockTimesheetsForPayrollBatchAdmin(
      tsIds,
      user.displayName || user.email || user.id || 'system',
    );
    if (n > 0) {
      await writeAuditLog(this.db, user, {
        actionType: 'UPDATE',
        entityType: 'PayrollBatch',
        entityId: batchId,
        payrollBatchId: batchId,
        sourceModule: 'hr',
        afterSummary: `Ensure source timesheets LOCKED (${n} updated)`,
      });
    }
    return n;
  }

  /**
   * งวด PAID/LOCKED — เติม dailyRowSnapshots จากยอดที่เก็บไว้แล้วเท่านั้น
   * ห้าม recalculate gross/tax ตอนเปิดหน้า (ตัวเลขที่จ่ายแล้วต้องนิ่ง)
   */
  async ensurePaidBatchLineSnapshotsPersisted(batchId: string, user: User): Promise<number> {
    const allowed =
      canConfirmWorkerPayrollPaid(user) || isSystemAdmin(user) || isPayrollOfficer(user);
    if (!allowed) {
      assertPayrollPermission(user, 'payroll_worker', 'edit_batch');
    }
    const batchRef = doc(this.getBatchCollection(), batchId);
    const batchSnap = await getDoc(batchRef);
    if (!batchSnap.exists()) throw new Error('ไม่พบ payroll batch');
    const batch = { ...(batchSnap.data() as PayrollBatch), id: batchId };
    if (batch.status !== 'PAID' && batch.status !== 'LOCKED') {
      throw new Error('ซ่อม snapshot ได้เมื่องวด PAID/LOCKED เท่านั้น');
    }
    if (batch.batchType === 'SUPPLEMENTAL') return 0;

    const linesSnap = await getDocs(collection(this.db, 'payroll_batches', batchId, 'lines'));
    let updated = 0;
    for (const d of linesSnap.docs) {
      const line = { ...(d.data() as PayrollBatchLine), id: d.id };
      if (isUsableDailyRowSnapshots(line.dailyRowSnapshots, line.grossAmount)) continue;
      if (!hasPositiveTimesheetGrossById(line.timesheetGrossById)) {
        /** ล้าง snapshot ยอด 0 ที่เคย backfill ผิด — ไม่สร้างใหม่ถ้าไม่มี timesheetGrossById */
        if ((line.dailyRowSnapshots?.length ?? 0) > 0) {
          await updateDoc(d.ref, {
            dailyRowSnapshots: [],
            updatedAt: Date.now(),
          });
          updated++;
        }
        continue;
      }

      const fromSource = (line.sourceTimesheetIds ?? []).map((id) => String(id || '').trim()).filter(Boolean);
      const fromGross = Object.keys(line.timesheetGrossById || {}).map((id) => String(id || '').trim()).filter(Boolean);
      const ids = [...new Set([...fromSource, ...fromGross])];
      if (ids.length === 0) continue;

      try {
        const tsList = await loadDailyTimesheetsByIds(this.db, ids);
        if (tsList.length === 0) continue;
        const snaps = buildPayrollLineDailyRowSnapshots(tsList, line.timesheetGrossById);
        if (!isUsableDailyRowSnapshots(snaps, line.grossAmount)) continue;
        await updateDoc(d.ref, {
          dailyRowSnapshots: snaps,
          updatedAt: Date.now(),
        });
        updated++;
      } catch (err) {
        console.warn('[ensurePaidBatchLineSnapshotsPersisted] line failed', line.workerId, err);
      }
    }
    if (updated > 0) {
      await writeAuditLog(this.db, user, {
        actionType: 'UPDATE',
        entityType: 'PayrollBatch',
        entityId: batchId,
        sourceModule: 'hr',
        payrollBatchId: batchId,
        afterSummary: `Backfill dailyRowSnapshots only (${updated} lines) — no gross recalc`,
      });
    }
    return updated;
  }

  /** ยอดสุทธิงวด NORMAL อื่นใน period เดียวกันที่จ่ายก่อนงวดนี้ (ต่อคน) */
  private async sumPriorPaidNetForWorker(
    batch: PayrollBatch & { id: string },
    workerId: string,
  ): Promise<number> {
    const periodId = String(batch.payrollPeriodId || '').trim();
    if (!periodId || !workerId) return 0;
    const currentMs = payrollBatchChronologyMs(batch);
    const q = query(
      collection(this.db, 'payroll_batches'),
      where('payrollPeriodId', '==', periodId),
    );
    const batchSnaps = await getDocs(q);
    let sum = 0;
    for (const bd of batchSnaps.docs) {
      if (bd.id === batch.id) continue;
      const nb = { ...(bd.data() as PayrollBatch), id: bd.id };
      if (nb.batchType && nb.batchType !== 'NORMAL') continue;
      if (
        nb.status !== 'PAID' &&
        nb.status !== 'LOCKED' &&
        nb.status !== 'FINANCE_PREPARED' &&
        nb.status !== 'PAYMENT_EXPORTED'
      ) {
        continue;
      }
      const priorMs = payrollBatchChronologyMs(nb);
      if (currentMs > 0 && priorMs > 0 && priorMs >= currentMs) continue;
      const lineId = `${nb.id}_${workerId}`;
      const lineSnap = await getDoc(doc(this.db, 'payroll_batches', nb.id, 'lines', lineId));
      if (!lineSnap.exists()) continue;
      const priorLine = { ...(lineSnap.data() as PayrollBatchLine), id: lineSnap.id };
      const n = resolveLineNetForPayslip(priorLine);
      if (n > 0.005) sum = round2Payroll(sum + n);
    }
    return sum;
  }

  /**
   * ฐานรายได้ (gross) จากงวด NORMAL ในเดือนภาษีเดียวกัน — ใช้คิด ภงด. ส่วนต่างรอบตกเบิก
   * รวมทั้งที่ยังไม่ PAID (เพื่อให้ preview/recalc สอดคล้องตอนสร้าง supplemental)
   */
  private async sumPriorNormalTaxableGrossForWorker(
    batch: PayrollBatch & { id: string },
    workerId: string,
  ): Promise<number> {
    const periodId = String(batch.payrollPeriodId || '').trim();
    if (!periodId || !workerId) return 0;
    const q = query(
      collection(this.db, 'payroll_batches'),
      where('payrollPeriodId', '==', periodId),
    );
    const batchSnaps = await getDocs(q);
    let sum = 0;
    for (const bd of batchSnaps.docs) {
      if (bd.id === batch.id) continue;
      const nb = { ...(bd.data() as PayrollBatch), id: bd.id };
      if (nb.batchType && nb.batchType !== 'NORMAL') continue;
      const lineId = `${nb.id}_${workerId}`;
      const lineSnap = await getDoc(doc(this.db, 'payroll_batches', nb.id, 'lines', lineId));
      if (!lineSnap.exists()) continue;
      const priorLine = lineSnap.data() as PayrollBatchLine;
      const g = Math.max(0, Number(priorLine.grossAmount) || 0);
      if (g > 0.005) sum = round2Payroll(sum + g);
    }
    return sum;
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
   * คำนวณใหม่เฉพาะคนงานหนึ่งคนจากใบงานปัจจุบันที่จ่ายได้ (สอดคล้อง timesheet / remob)
   * — **คง** เบี้ยเลี้ยง/หักพิเศษ/ภงด. และยอดหักเบิกล่วงหน้าที่บันทึกแล้ว
   * ไม่แตะบรรทัดคนอื่น — ใช้แทน Regenerate ทั้ง batch เมื่อแก้สูตร/ซ้ำวันแล้วไม่ต้องเสียการปรับยอดทุกคน
   *
   * options.bypassFinanceStatusGate — ใช้ตอนยืนยันจ่าย / ซ่อม snapshot งวด PAID
   * options.includePriorPaidRecovery — บันทึกหักยอดงวดก่อนหน้าลง deductionsBreakdown
   */
  async recalculateWorkerPayrollLinePreserveHrAdjustments(
    batchId: string,
    workerId: string,
    user: User,
    options?: {
      bypassFinanceStatusGate?: boolean;
      includePriorPaidRecovery?: boolean;
    },
  ): Promise<{ netAmount: number; grossAmount: number }> {
    if (options?.bypassFinanceStatusGate) {
      const allowed =
        canConfirmWorkerPayrollPaid(user) || isSystemAdmin(user) || isPayrollOfficer(user);
      if (!allowed) {
        assertPayrollPermission(user, 'payroll_worker', 'edit_batch');
      }
    } else {
      assertPayrollPermission(user, 'payroll_worker', 'edit_batch');
    }
    const lineId = `${batchId}_${workerId}`;
    const batchRef = doc(this.getBatchCollection(), batchId);
    const lineRef = doc(this.db, 'payroll_batches', batchId, 'lines', lineId);

    const [batchSnap, lineSnap] = await Promise.all([getDoc(batchRef), getDoc(lineRef)]);
    if (!batchSnap.exists()) throw new Error('ไม่พบ payroll batch');
    if (!lineSnap.exists()) throw new Error('ไม่พบบรรทัดลูกจ้างในงวดนี้');

    const batch = { ...(batchSnap.data() as PayrollBatch), id: batchId };
    const line = lineSnap.data() as PayrollBatchLine;

    if (!options?.bypassFinanceStatusGate) {
      const blocked = ['PAID', 'LOCKED', 'FINANCE_PREPARED', 'PAYMENT_EXPORTED'] as const;
      if ((blocked as readonly string[]).includes(batch.status)) {
        throw new Error(
          'คำนวณใหม่รายคนได้เฉพาะก่อนส่งต่อบัญชี (สถานะ GENERATED / HR_REVIEWED / HR_APPROVED)',
        );
      }
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

    const periodStart = period.startDate || line.periodStartDate;
    const periodEnd = period.endDate || periodFromLineEnd;
    if (!periodStart || !periodEnd) {
      throw new Error('ไม่พบช่วงวันที่งวด — ไม่สามารถคำนวณใหม่ได้');
    }

    /**
     * โหลดทั้งเดือน (LOCKED + วันใหม่) ตามกฎ remob — รวมวันทำงานที่บันทึกแล้วทั้งหมด
     * แล้วหักยอดงวดก่อนเมื่อ includePriorPaidRecovery
     */
    const loaded = await loadWorkerTimesheetsForPayrollLine(
      this.db,
      workerId,
      periodStart,
      periodEnd,
      rawIds,
    );

    if (loaded.length === 0) {
      const isSupplemental = batch.batchType === 'SUPPLEMENTAL';
      const hasPriorPeriodPay = (line.hrLineAdjustments?.priorPeriodAllowanceItems?.length ?? 0) > 0;
      if (options?.bypassFinanceStatusGate) {
        /** ยอดผ่านผู้จัดการ + บัญชีแล้ว — ไม่บล็อกตัดจ่ายเพราะไม่มีใบงานผูกแถว */
        return {
          netAmount: Number(line.netAmount) || 0,
          grossAmount: Number(line.grossAmount) || 0,
        };
      }
      if (!isSupplemental && !hasPriorPeriodPay) {
        throw new Error(
          rawIds.length === 0
            ? 'ไม่มีใบงานที่จ่ายได้ในงวดนี้ และแถวไม่มี sourceTimesheetIds — คำนวณใหม่ได้เฉพาะแถวที่ผูกใบงานหรือเป็นงวดตกเบิก'
            : 'ไม่พบใบงานที่จ่ายได้ในงวดนี้ (อาจอยู่นอกช่วง mobilization หรือเป็น unpaid_leave — สอดคล้องตารางสรุปรายเดือน)',
        );
      }
    }

    const workerTs = normalizeTimesheetsForPayrollLine(loaded);
    for (const ts of workerTs) {
      if (ts.workerId !== workerId) {
        throw new Error('พบใบงานที่ไม่ใช่ของลูกจ้างรายนี้ใน sourceTimesheetIds');
      }
    }

    const poIds = Array.from(new Set(workerTs.map((ts) => ts.purchaseOrderId).filter(Boolean)));

    const poById = new Map<string, PurchaseOrder>();
    await Promise.all(
      poIds.map(async (poId) => {
        const poSnap = await getDoc(doc(this.db, 'purchase_orders', poId));
        if (poSnap.exists()) {
          poById.set(poId, { ...(poSnap.data() as PurchaseOrder), id: poSnap.id });
        }
      }),
    );

    const poContractById = buildPoContractIdMapFromPurchaseOrders(poById.values());
    const poWorkModeByPoId = buildPoWorkModeMapFromPurchaseOrders(poById.values());
    const poLineMaps = await loadPayrollPoLineMaps(this.db, poIds);

    const contractMap = new Map<string, MainContract>();
    const contractIds = collectPayrollContractIds(workerTs, poContractById);
    await Promise.all(
      contractIds.map(async (contractId) => {
        const contractSnap = await getDoc(doc(this.db, 'main_contracts', contractId));
        if (contractSnap.exists()) {
          const contractData = { ...(contractSnap.data() as MainContract), id: contractSnap.id };
          const ratesSnap = await getDocs(collection(this.db, 'main_contracts', contractId, 'position_rates'));
          contractData.positionRates = ratesSnap.docs.map(d => ({ id: d.id, ...(d.data() as object) } as PositionRate));
          contractMap.set(contractId, contractData);
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
          const contractData = { ...(contractSnap.data() as MainContract), id: contractSnap.id };
          const ratesSnap = await getDocs(collection(this.db, 'main_contracts', contractId, 'position_rates'));
          contractData.positionRates = ratesSnap.docs.map(d => ({ id: d.id, ...(d.data() as object) } as PositionRate));
          contractMap.set(contractId, contractData);
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

    const asgnIds = [...new Set(workerTs.map((t) => String(t.assignmentId || '').trim()).filter(Boolean))];
    await Promise.all(
      asgnIds.map(async (aid) => {
        const snap = await getDoc(doc(this.db, 'mobilizations', aid));
        if (!snap.exists()) return;
        const asgn = { id: snap.id, ...(snap.data() as object) } as Assignment;
        await syncAssignmentPositionFromWorkerOnRemob(this.db, asgn);
      }),
    );

    const priorPaidFrozen = await loadPriorPaidFrozenPayrollSlice(this.db, {
      payrollPeriodId: String(batch.payrollPeriodId || '').trim(),
      workerId,
      currentBatchId: batchId,
      currentBatchChronologyMs: payrollBatchChronologyMs(batch),
    });
    const inferredPreRemobPkg = inferOffshorePackageFromOt15PriorItems(
      priorPaidFrozen.priorPeriodAllowanceItems,
    );

    const remobApplied = await loadAssignmentsAndApplyRemobPositionForPayroll(
      this.db,
      workerTs,
      workerById,
    );
    const workerTsForCalc = remobApplied.timesheets;
    const assignmentById = remobApplied.assignmentById;
    await Promise.all(
      [...assignmentById.values()].map(async (asgn) => {
        const healed = await ensureLaborCostEpochAfterMobFinish(this.db, asgn, {
          inferredOffshorePackage: inferredPreRemobPkg,
        });
        assignmentById.set(asgn.id, healed);
      }),
    );
    await ensurePositionsLoadedForTimesheets(this.db, workerTsForCalc, posById);

    const ppQuery = query(
      collection(this.db, 'worker_payment_profiles'),
      where('workerId', '==', workerId),
      where('status', '==', 'ACTIVE'),
      limit(1),
    );
    const ppSnap = await getDocs(ppQuery);
    const ppSnapshot = ppSnap.empty ? { paymentMethod: 'CASH' as const } : ppSnap.docs[0].data();

    /** ใบที่งวดนี้จ่าย — จาก source เดิม หรือใบที่ยังไม่เคยอยู่ในงวดที่จ่ายแล้ว */
    const liveSourceTimesheetIds = new Set(
      (line.sourceTimesheetIds?.length
        ? line.sourceTimesheetIds
        : workerTsForCalc
            .filter((t) => !priorPaidFrozen.lockedSourceTimesheetIds.has(t.id))
            .map((t) => t.id)
      ).filter(Boolean),
    );

    const aggDeps = {
      poLineMaps,
      poContractById,
      poWorkModeByPoId,
      workerById,
      posById,
      contractMap,
      workerGlobalLabor,
      assignmentById,
      frozenTimesheetGrossById: priorPaidFrozen.byTimesheetId,
      priorPaidFrozen,
      liveSourceTimesheetIds,
    };

    const byPo = new Map<string, DailyTimesheet[]>();
    for (const ts of workerTsForCalc) {
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
    const timesheetGrossById = mergedChunk.timesheetGrossById;
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
    /** NORMAL ไม่ควรมีตกเบิก — รายการค้างจากบั๊กเก่า (ดึง status=applied) ให้ตัดออกตอนคำนวณใหม่ */
    const priorPeriodAllowanceItems =
      batch.batchType === 'SUPPLEMENTAL'
        ? (hrStored?.priorPeriodAllowanceItems ?? []).map((x) => ({
            sourceYearMonth: String(x.sourceYearMonth || '').trim(),
            label: String(x.label || '').trim(),
            amount: Math.max(0, Number(x.amount) || 0),
          }))
        : [];
    const deductionItems = (hrStored?.deductionItems ?? []).map((x) => ({
      label: String(x.label || '').trim(),
      amount: Math.max(0, Number(x.amount) || 0),
    }));

    const allowSum = sumRegularAllowances(allowanceItems);
    const priorSum = sumPriorPeriodAllowances(priorPeriodAllowanceItems);
    /**
     * SUPPLEMENTAL: priorPeriod items คือรายได้หลัก — ใช้เป็น gross ไม่บวกทับ workerGross จาก timesheet
     * (ใบงานตกเบิกมักไม่มี timesheet; ถ้ามีก็ไม่นับซ้ำกับ prior)
     */
    const isSupplemental = batch.batchType === 'SUPPLEMENTAL';
    const allowanceTotal = isSupplemental ? allowSum : allowSum + priorSum;
    const effectiveGross = isSupplemental
      ? Math.max(0, priorSum + allowSum)
      : Math.max(0, workerGross + allowanceTotal);

    const rateSnap = d8Line.snapshot.rate;
    const priorPaidTaxableGross = isSupplemental
      ? await this.sumPriorNormalTaxableGrossForWorker(batch, workerId)
      : 0;
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
        ...(allowanceTotal > 0 ? { hr_allowances: allowanceTotal } : {}),
      },
      batchType: isSupplemental ? 'SUPPLEMENTAL' : 'NORMAL',
      priorPaidTaxableGross,
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

    let deductions: Record<string, number> = { ...d8WithAllowances.deductionsBreakdown };
    deductions.pit_withholding = resolveWorkerPitWithholdingBaht({
      mode,
      effectiveGross,
      policies: resolvedPolicies,
      /** ฐาน ภงด. ต้องหักทั้ง ปสง. และกองทุนสงเคราะห์ลูกจ้างออกก่อน */
      socialSecurityBaht: (Number(deductions.social_security) || 0) + (Number(deductions.employee_assistance_fund) || 0),
      isSupplemental,
      priorPaidTaxableGross,
      pitWithholdingOverride: pitOv,
      pitAutoSalaryBaseBaht: hrStored?.pitAutoSalaryBaseBaht,
      maxMarginalRatePercent: mr != null && Number.isFinite(mr) ? Number(mr) : null,
    });
    if (isSupplemental) {
      deductions = forceSupplementalNoSocialSecurity(deductions);
    }
    deductionItems.forEach((d, idx) => {
      deductions[`manual_ded_${idx}`] = Math.max(0, Number(d.amount) || 0);
    });

    const caRecover = Number(line.deductionsBreakdown?.[CASH_ADVANCE_PAYROLL_DEDUCTION_KEY]) || 0;
    if (caRecover > 0) {
      deductions[CASH_ADVANCE_PAYROLL_DEDUCTION_KEY] = Math.round(caRecover * 100) / 100;
    }

    /** HR recalc ก่อนส่งบัญชี — ไม่เก็บ prior_paid (สลิปชุดหลังหักตอนแสดง); ตอนจ่าย/ซ่อม PAID ค่อย persist */
    if (options?.includePriorPaidRecovery && batch.batchType !== 'SUPPLEMENTAL') {
      const priorNet = await this.sumPriorPaidNetForWorker(batch, workerId);
      if (priorNet > 0.005) {
        deductions[PRIOR_PAID_RECOVERY_DEDUCTION_KEY] = priorNet;
      } else {
        delete deductions[PRIOR_PAID_RECOVERY_DEDUCTION_KEY];
      }
    } else {
      delete deductions[PRIOR_PAID_RECOVERY_DEDUCTION_KEY];
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
      priorPeriodAllowanceItems: priorPeriodAllowanceItems.length ? priorPeriodAllowanceItems : undefined,
      deductionItems,
      workerPitMode: mode,
      pitAutoSalaryBaseBaht:
        mode === 'auto_salary_base' ? Math.max(0, Number(hrStored?.pitAutoSalaryBaseBaht) || 0) : null,
      pitWithholdingOverride:
        mode === 'manual_baht' ? (Number.isFinite(Number(pitOv)) ? Math.max(0, Number(pitOv)) : null) : null,
      pitWithholdingOverrideMaxMarginalRatePercent: storeMr,
      notes: trimmedNotes ? trimmedNotes : null,
      updatedAt: Date.now(),
      updatedBy: user.displayName || user.email || user.id || 'system',
    };

    const wkLine = workerById.get(workerId);
    const posLine = wkLine?.currentPositionId ? posById.get(wkLine.currentPositionId) : null;
    const firstWm = workerTsForCalc[0]
      ? timesheetToLaborWorkMode(workerTsForCalc[0], poWorkModeByPoId)
      : 'onshore';
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
      assignmentIds: Array.from(new Set(workerTsForCalc.map((ts) => ts.assignmentId))),
      sourceTimesheetIds: workerTsForCalc.map((ts) => ts.id),
      periodStartDate: period.startDate,
      periodEndDate: period.endDate,
      eventBreakdown,
      earningsBreakdown,
      timesheetGrossById,
      dailyRowSnapshots: buildPayrollLineDailyRowSnapshots(workerTsForCalc, timesheetGrossById),
      grossAmount: isSupplemental ? effectiveGross : workerGross,
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
      patch.payslipWorkDaySplit = computeWorkDayPackagePayslipSplit(workerTsForCalc, aggDeps);
    }

    await updateDoc(lineRef, stripUndefinedForFirestore(patch) as DocumentData);

    await this.lockTimesheetsForPayrollBatchAdmin(
      [...liveSourceTimesheetIds],
      user.displayName || user.email || user.id || 'system',
      timesheetGrossById,
    );

    await this.recalculateBatchTotalsFromLines(batchId, user);

    await writeAuditLog(this.db, user, {
      actionType: 'UPDATE',
      entityType: 'PayrollBatchLine',
      entityId: lineId,
      payrollBatchId: batchId,
      sourceModule: 'hr',
      afterSummary: options?.includePriorPaidRecovery
        ? `Persist paid line snapshot (multi-PO + prior paid); gross ${workerGross.toFixed(2)} net ${netAmount.toFixed(2)}`
        : `Recalculate worker line from timesheets (preserve HR adjustments); gross ${workerGross.toFixed(2)}`,
    });

    return { netAmount, grossAmount: workerGross };
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
      priorPeriodAllowanceItems?: Array<{ sourceYearMonth: string; label: string; amount: number }>;
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

    const allowanceItems = input.allowanceItems.map((x) => ({
      label: String(x.label || '').trim(),
      amount: Math.max(0, Number(x.amount) || 0),
    }));
    const priorPeriodAllowanceItems = normalizePriorPeriodAllowanceItems(input.priorPeriodAllowanceItems);
    const allowSum = sumRegularAllowances(allowanceItems);
    const priorSum = sumPriorPeriodAllowances(priorPeriodAllowanceItems);
    const isSupplemental = batch.batchType === 'SUPPLEMENTAL';
    /**
     * SUPPLEMENTAL: priorPeriodAllowanceItems คือรายได้หลักของงวด (เก็บใน grossAmount แล้ว)
     * — ห้ามบวกซ้ำเป็น hr_allowances ทับ grossAmount (เคยทำให้ net = 2×gross − หัก)
     */
    const allowanceTotal = isSupplemental ? allowSum : allowSum + priorSum;
    const effectiveGross = isSupplemental
      ? Math.max(0, priorSum + allowSum)
      : Math.max(0, line.grossAmount + allowanceTotal);
    const storedGrossAmount = isSupplemental ? effectiveGross : line.grossAmount;

    const rateSummary = line.d8Snapshot?.rate;
    const priorPaidTaxableGross = isSupplemental
      ? await this.sumPriorNormalTaxableGrossForWorker(
          { ...batch, id: batchId },
          workerId,
        )
      : 0;
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
        ...(allowanceTotal > 0 ? { hr_allowances: allowanceTotal } : {}),
      },
      batchType: isSupplemental ? 'SUPPLEMENTAL' : 'NORMAL',
      priorPaidTaxableGross,
    });

    const pitOv = input.pitWithholdingOverride;
    const mr = input.pitWithholdingOverrideMaxMarginalRatePercent;
    const mode: WorkerPitCalculationMode =
      input.workerPitMode ??
      (mr != null && Number.isFinite(mr) ? 'auto_timesheet' : (pitOv != null && Number.isFinite(pitOv) ? 'manual_baht' : 'auto_timesheet'));

    let deductions: Record<string, number> = { ...d8Line.deductionsBreakdown };
    deductions.pit_withholding = resolveWorkerPitWithholdingBaht({
      mode,
      effectiveGross,
      policies: resolved,
      /** ฐาน ภงด. ต้องหักทั้ง ปสง. และกองทุนสงเคราะห์ลูกจ้างออกก่อน */
      socialSecurityBaht: (Number(deductions.social_security) || 0) + (Number(deductions.employee_assistance_fund) || 0),
      isSupplemental,
      priorPaidTaxableGross,
      pitWithholdingOverride: pitOv,
      pitAutoSalaryBaseBaht: input.pitAutoSalaryBaseBaht,
      maxMarginalRatePercent: mr != null && Number.isFinite(mr) ? Number(mr) : null,
    });
    if (isSupplemental) {
      deductions = forceSupplementalNoSocialSecurity(deductions);
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
      ...(priorPeriodAllowanceItems.length ? { priorPeriodAllowanceItems } : {}),
      deductionItems: input.deductionItems,
      workerPitMode: mode,
      pitAutoSalaryBaseBaht: mode === 'auto_salary_base' ? Math.max(0, Number(input.pitAutoSalaryBaseBaht) || 0) : null,
      pitWithholdingOverride: mode === 'manual_baht' ? (Number.isFinite(Number(pitOv)) ? Math.max(0, Number(pitOv)) : null) : null,
      pitWithholdingOverrideMaxMarginalRatePercent: storeMr,
      notes: trimmedNotes ? trimmedNotes : null,
      updatedAt: Date.now(),
      updatedBy: user.displayName || user.email || user.id || 'system',
    };

    await updateDoc(lineRef, stripUndefinedForFirestore({
      ...(isSupplemental ? { grossAmount: storedGrossAmount } : {}),
      deductionsBreakdown: deductions,
      netAmount,
      d8Snapshot,
      hrLineAdjustments,
      updatedAt: Date.now(),
    }) as DocumentData);

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

    /** งวดผู้บริหาร — คิดจากอัตราเงินเดือน/รายรับที่กำหนดในงวดเท่านั้น ไม่ใช้ OT หรือรายได้จากเวลาสแกน */
    const isExecutivePayrollRun = runCollection === 'executive_payroll_runs';

    const pitMode: OfficePayrollPitMode = input.pitMode ?? 'SYSTEM';
    const deductSocialSecurity = input.deductSocialSecurity !== false;

    const d8 = computeOfficePayrollLineD8({
      asOfDate: asOf,
      policies: resolved,
      baseSalary: line.baseSalary,
      allowance: line.allowance ?? 0,
      bonus: line.bonus ?? 0,
      overtimeAmount: isExecutivePayrollRun ? 0 : (line.overtimeAmount ?? 0),
      otherIncome: isExecutivePayrollRun ? 0 : (line.otherIncome ?? 0),
      hrAllowanceItems: input.allowanceItems,
      hrDeductionItems: input.deductionItems,
      preStatutoryDeductions: line.periodPreStatutoryDeductions ?? [],
      deductSocialSecurity,
      pitMode,
      pitManualPercent: pitMode === 'MANUAL_PERCENT' ? Number(input.pitManualPercent) || 0 : undefined,
      pitManualAmountBaht: pitMode === 'MANUAL_AMOUNT' ? Number(input.pitManualAmountBaht) || 0 : undefined,
    });

    let lineDeductions = d8.deductions;
    let lineNetPay = d8.netPay;
    let lineSnapshot = d8.snapshot;
    if (runCollection === 'office_payroll_runs') {
      const recovery = await fetchOfficeStaffCashAdvancesPendingSalaryRecovery(
        this.db,
        line.staffId,
        runId,
      );
      const withCashAdvance = applyCashAdvanceRecoveryToOfficeD8Line(d8, recovery);
      lineDeductions = withCashAdvance.deductions;
      lineNetPay = withCashAdvance.netPay;
      lineSnapshot = withCashAdvance.snapshot;
    }

    const trimmedNotes = input.notes?.trim();
    const pitManualIncomeLabel =
      pitMode === 'MANUAL_PERCENT' || pitMode === 'MANUAL_AMOUNT'
        ? (input.pitManualIncomeLabel || '').trim()
        : '';
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
      pitManualIncomeLabel: pitManualIncomeLabel || null,
      pitManualIncomeType:
        input.pitManualIncomeType ?? line.hrLineAdjustments?.pitManualIncomeType ?? null,
      updatedAt: Date.now(),
      updatedBy: user.displayName || user.email || user.id,
    };

    await updateDoc(lineRef, {
      grossPay: d8.grossPay,
      tax: d8.tax,
      socialSecurity: d8.socialSecurity,
      deductions: lineDeductions,
      netPay: lineNetPay,
      d8Snapshot: lineSnapshot,
      hrLineAdjustments,
      updatedAt: Date.now(),
      ...(isExecutivePayrollRun ? { overtimeAmount: 0, otherIncome: 0 } : {}),
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
