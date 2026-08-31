/**
 * สร้าง/ทับบรรทัดงวดเงินเดือนออฟฟิศ + อัปเดตยอดรวมบนเอกสารงวด — ใช้ร่วมหน้าสร้างงวดและปุ่มคำนวณรายละเอียด
 */

import {
  collection,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type { OfficePayrollLine, OfficePayrollRun, OfficeStaff, PayrollRunStatus } from '@/lib/types';
import {
  computeOfficePayrollLineD8,
  loadPayrollPoliciesFromFirestore,
  resolvePayrollPoliciesForDate,
  runStatusToD8Lifecycle,
} from '@/lib/payroll/d8';
import { assertOfficeStaffListPayrollIdentityComplete } from '@/lib/payroll/office-staff-payroll-identity';
import { computeOfficePayrollPeriodAdjustments } from '@/lib/payroll/office-payroll-period-deductions';
import { resolveOfficePayrollEffectiveBaseSalary } from '@/lib/payroll/office-payroll-partial-month';
import { sumApprovedOfficeOvertimePayInPeriod, sumOfficeRestDayWorkedPayInPeriod } from '@/lib/payroll/office-overtime-pay';
import { loadOfficePayrollRunComputationContext } from '@/lib/payroll/office-payroll-run-context';
import {
  listScanAttendanceBlockersForOfficePayroll,
  scanAttendanceBlockersErrorMessage,
} from '@/lib/payroll/office-scan-attendance-readiness';
import { stripUndefinedForFirestore } from '@/lib/firestore/strip-undefined-for-firestore';
import { standardOfficePayrollLineDocId } from '@/lib/payroll/office-payroll-line-ids';
import {
  buildOfficeStaffSelfPayrollLineIndex,
  officeStaffSelfPayrollLineIndexRef,
} from '@/lib/payroll/self-payroll-line-index';
import { isActiveOfficeStaffStatus } from '@/lib/hr/office-staff-active';

/** วันที่ 1 และวันสุดท้ายของเดือน (ปฏิทินเกรกอเรียน YYYY-MM-DD) */
export function getPayrollMonthPeriodBounds(yyyyMm: string): { payrollPeriodStart: string; payrollPeriodEnd: string } {
  const parts = yyyyMm.split('-').map(Number);
  const y = parts[0];
  const m = parts[1];
  if (!y || !m || m < 1 || m > 12) {
    throw new Error(`Invalid payroll month: ${yyyyMm}`);
  }
  const payrollPeriodStart = `${y}-${String(m).padStart(2, '0')}-01`;
  const last = new Date(y, m, 0);
  const d = String(last.getDate()).padStart(2, '0');
  const payrollPeriodEnd = `${y}-${String(m).padStart(2, '0')}-${d}`;
  return { payrollPeriodStart, payrollPeriodEnd };
}

/** พนักงานที่เข้างวด office มาตรฐาน (ไม่รวมผู้บริหาร / ไม่จ่ายผ่านงวดนี้) */
export function isOfficeStaffEligibleForStandardOfficeRun(s: OfficeStaff): boolean {
  if (s.status !== 'ACTIVE') return false;
  if (s.payrollBand === 'EXECUTIVE') return false;
  if (s.excludeFromPayrollRuns) return false;
  return true;
}

/**
 * พนักงานที่อยู่ในงวดอื่น (เดือนเดียวกัน) แล้ว — ห้ามเลือกซ้ำในงวดใหม่
 * นับทุกงวดที่ไม่ CANCELLED (รวม DRAFT ที่มีบรรทัดแล้ว)
 */
export async function getStaffIdsUsedInOtherRunsForSameMonth(
  firestore: Firestore,
  payrollMonth: string,
  excludeRunId: string | null,
): Promise<Set<string>> {
  const q = query(collection(firestore, 'office_payroll_runs'), where('payrollMonth', '==', payrollMonth));
  const snap = await getDocs(q);
  const out = new Set<string>();
  for (const d of snap.docs) {
    if (excludeRunId && d.id === excludeRunId) continue;
    const data = d.data() as { status?: string };
    if (data.status === 'CANCELLED') continue;
    const lineSnap = await getDocs(collection(firestore, 'office_payroll_runs', d.id, 'lines'));
    for (const ld of lineSnap.docs) {
      const line = ld.data() as { staffId?: string };
      if (line.staffId) out.add(line.staffId);
    }
  }
  return out;
}

async function deleteAllLinesForOfficeRun(firestore: Firestore, runId: string): Promise<void> {
  const linesCol = collection(firestore, 'office_payroll_runs', runId, 'lines');
  const snap = await getDocs(linesCol);
  let batch = writeBatch(firestore);
  let ops = 0;
  const flush = async () => {
    if (ops <= 0) return;
    await batch.commit();
    batch = writeBatch(firestore);
    ops = 0;
  };
  for (const lineDoc of snap.docs) {
    const line = lineDoc.data() as { staffId?: string };
    batch.delete(lineDoc.ref);
    ops++;
    if (line.staffId) {
      batch.delete(officeStaffSelfPayrollLineIndexRef(firestore, line.staffId, lineDoc.id));
      ops++;
    }
    if (ops >= 400) await flush();
  }
  await flush();
}

export interface ApplyOfficeRunLinesResult {
  staffCount: number;
  grossAmount: number;
  netAmount: number;
  totalAllowances: number;
  totalDeductions: number;
}

/**
 * ลบบรรทัดเดิมทั้งหมด แล้วเขียนบรรทัดใหม่จากรายชื่อพนักงาน + อัปเดตยอดบนงวด
 */
export async function applyStandardOfficeRunLines(
  firestore: Firestore,
  runId: string,
  run: Pick<OfficePayrollRun, 'payrollMonth' | 'payrollPeriodStart' | 'payrollPeriodEnd'>,
  staffList: OfficeStaff[],
  options: { newStatus?: PayrollRunStatus },
): Promise<ApplyOfficeRunLinesResult> {
  assertOfficeStaffListPayrollIdentityComplete(staffList);

  const asOf = run.payrollPeriodEnd || `${run.payrollMonth}-28`;
  const policyRecords = await loadPayrollPoliciesFromFirestore(firestore);
  const officePolicies = resolvePayrollPoliciesForDate(asOf, policyRecords, 'office');
  const payrollCtx = await loadOfficePayrollRunComputationContext(firestore, run, policyRecords);

  const scanAttendanceBlockers = listScanAttendanceBlockersForOfficePayroll(staffList, payrollCtx, run);
  if (scanAttendanceBlockers.length > 0) {
    throw new Error(scanAttendanceBlockersErrorMessage(scanAttendanceBlockers));
  }

  await deleteAllLinesForOfficeRun(firestore, runId);

  const linesCol = collection(firestore, 'office_payroll_runs', runId, 'lines');
  const batch = writeBatch(firestore);

  let totalGross = 0;
  let totalNet = 0;
  let totalAllowances = 0;
  let totalDeductions = 0;

  for (const staff of staffList) {
    const lineId = standardOfficePayrollLineDocId(staff.staffCode, runId);
    const lineDoc = doc(linesCol, lineId);

    const contractBaseSalary = staff.monthlySalary || 0;
    const allowance = 0;
    const bonus = 0;

    const periodAdj = computeOfficePayrollPeriodAdjustments({
      staff,
      periodStart: run.payrollPeriodStart,
      periodEnd: run.payrollPeriodEnd,
      periodEndMs: payrollCtx.periodEndMs,
      leaveRequests: payrollCtx.leaveRequests,
      attendanceDayRows: payrollCtx.attendanceRowsByStaffId.get(staff.id) ?? [],
      attendancePunches: payrollCtx.punchesBySubjectKey.get(`office_staff:${staff.id}`) ?? [],
      leaveEntitlements: payrollCtx.leaveEntitlements,
      monthlyWorkNorm: payrollCtx.monthlyWorkNorm,
      weeklyRestPattern: payrollCtx.weeklyRestPattern,
      calendarHolidays: payrollCtx.calendarHolidays,
    });

    const overtimeAmount = sumApprovedOfficeOvertimePayInPeriod(
      staff.id,
      run.payrollPeriodStart,
      run.payrollPeriodEnd,
      payrollCtx.approvedOvertimeRequests,
      {
        monthlySalary: contractBaseSalary,
        monthlyWorkNorm: payrollCtx.monthlyWorkNorm,
      },
    );

    const restDayWorked = sumOfficeRestDayWorkedPayInPeriod(
      staff,
      run.payrollPeriodStart,
      run.payrollPeriodEnd,
      payrollCtx.attendanceRowsByStaffId.get(staff.id) ?? [],
      {
        monthlySalary: contractBaseSalary,
        monthlyWorkNorm: payrollCtx.monthlyWorkNorm,
        weeklyRestPattern: payrollCtx.weeklyRestPattern,
        calendarHolidays: payrollCtx.calendarHolidays,
      },
    );

    const { effectiveBaseSalary, payrollPreStatutoryDeductions } = resolveOfficePayrollEffectiveBaseSalary(
      contractBaseSalary,
      periodAdj.preStatutoryDeductions,
    );

    const d8 = computeOfficePayrollLineD8({
      asOfDate: asOf,
      policies: officePolicies,
      baseSalary: effectiveBaseSalary,
      allowance,
      bonus,
      overtimeAmount,
      otherIncome: restDayWorked.amount,
      preStatutoryDeductions: payrollPreStatutoryDeductions,
    });

    const attendanceSummary = periodAdj.attendanceSummary
      ? {
          ...periodAdj.attendanceSummary,
          ...(restDayWorked.days > 0 || restDayWorked.amount > 0
            ? {
                restDayWorkedDays: restDayWorked.days,
                restDayWorkedPayAmount: restDayWorked.amount,
              }
            : {}),
        }
      : restDayWorked.days > 0 || restDayWorked.amount > 0
        ? {
            scanDeductionsApplied: false,
            lateMinutes: 0,
            scanAbsenceDays: 0,
            unpaidLeaveDays: 0,
            lateDeductionAmount: 0,
            scanAbsenceDeductionAmount: 0,
            unpaidLeaveDeductionAmount: 0,
            restDayWorkedDays: restDayWorked.days,
            restDayWorkedPayAmount: restDayWorked.amount,
          }
        : null;

    const newLine: OfficePayrollLine = {
      id: lineId,
      officePayrollRunId: runId,
      payrollMonth: run.payrollMonth,
      ...(staff.linkedUserId?.trim() ? { subjectLinkedUserId: staff.linkedUserId.trim() } : {}),
      staffId: staff.id,
      staffName: staff.fullName,
      department: staff.department,
      positionTitle: staff.positionTitle,
      baseSalary: effectiveBaseSalary,
      allowance,
      bonus,
      overtimeAmount,
      otherIncome: restDayWorked.amount,
      restDayWorkedAmount: restDayWorked.amount > 0 ? restDayWorked.amount : undefined,
      deductions: d8.deductions,
      tax: d8.tax,
      socialSecurity: d8.socialSecurity,
      grossPay: d8.grossPay,
      netPay: d8.netPay,
      d8Snapshot: d8.snapshot,
      leaveSummary: periodAdj.leaveSummary.length ? periodAdj.leaveSummary : undefined,
      attendanceSummary,
      periodPreStatutoryDeductions: payrollPreStatutoryDeductions.length
        ? payrollPreStatutoryDeductions
        : undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    batch.set(lineDoc, stripUndefinedForFirestore(newLine));

    const linked = staff.linkedUserId?.trim();
    if (linked && isActiveOfficeStaffStatus(staff.status)) {
      batch.set(
        officeStaffSelfPayrollLineIndexRef(firestore, staff.id, lineId),
        buildOfficeStaffSelfPayrollLineIndex({ ...newLine, subjectLinkedUserId: linked }),
      );
    }

    totalGross += d8.grossPay;
    totalNet += d8.netPay;
    totalAllowances += allowance + bonus;
    totalDeductions += d8.deductions;
  }

  const runRef = doc(firestore, 'office_payroll_runs', runId);
  const newStatus: PayrollRunStatus = options.newStatus ?? 'CALCULATED';
  batch.update(runRef, {
    status: newStatus,
    d8LifecycleStatus: runStatusToD8Lifecycle(newStatus),
    staffCount: staffList.length,
    grossAmount: totalGross,
    netAmount: totalNet,
    totalAllowances,
    totalDeductions,
    updatedAt: Date.now(),
  });

  await batch.commit();

  return {
    staffCount: staffList.length,
    grossAmount: totalGross,
    netAmount: totalNet,
    totalAllowances,
    totalDeductions,
  };
}
