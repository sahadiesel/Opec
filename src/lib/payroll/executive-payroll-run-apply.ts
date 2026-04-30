/**
 * งวดเงินเดือนผู้บริหาร — สูตร D8 เดียวกับ Office Payroll (นโยบาย HR `office`)
 * แหล่งรายชื่อ: `executive_payroll_staff` (เมนูบัญชี)
 */

import { collection, doc, getDocs, writeBatch, type Firestore } from 'firebase/firestore';
import type {
  ExecutivePayrollStaff,
  OfficePayrollLine,
  OfficePayrollRun,
  PayrollRunStatus,
} from '@/lib/types';
import {
  computeOfficePayrollLineD8,
  loadPayrollPoliciesFromFirestore,
  resolvePayrollPoliciesForDate,
  runStatusToD8Lifecycle,
} from '@/lib/payroll/d8';

export function isExecutivePayrollStaffEligible(s: ExecutivePayrollStaff): boolean {
  if (s.status !== 'ACTIVE') return false;
  if (s.excludeFromPayrollRuns) return false;
  return true;
}

async function deleteAllLinesForExecutiveRun(firestore: Firestore, runId: string): Promise<void> {
  const linesCol = collection(firestore, 'executive_payroll_runs', runId, 'lines');
  const snap = await getDocs(linesCol);
  const refs = snap.docs.map((x) => x.ref);
  const chunkSize = 400;
  for (let i = 0; i < refs.length; i += chunkSize) {
    const batch = writeBatch(firestore);
    for (const ref of refs.slice(i, i + chunkSize)) {
      batch.delete(ref);
    }
    await batch.commit();
  }
}

export interface ApplyExecutiveRunLinesResult {
  staffCount: number;
  grossAmount: number;
  netAmount: number;
  totalAllowances: number;
  totalDeductions: number;
}

/**
 * ลบบรรทัดเดิมทั้งหมด แล้วเขียนบรรทัดใหม่จากรายชื่อผู้บริหาร + อัปเดตยอดบนงวด
 */
export async function applyExecutivePayrollRunLines(
  firestore: Firestore,
  runId: string,
  run: Pick<OfficePayrollRun, 'payrollMonth' | 'payrollPeriodEnd'>,
  staffList: ExecutivePayrollStaff[],
  options: { newStatus?: PayrollRunStatus },
): Promise<ApplyExecutiveRunLinesResult> {
  await deleteAllLinesForExecutiveRun(firestore, runId);

  const asOf = run.payrollPeriodEnd || `${run.payrollMonth}-28`;
  const policyRecords = await loadPayrollPoliciesFromFirestore(firestore);
  const officePolicies = resolvePayrollPoliciesForDate(asOf, policyRecords, 'office');

  const linesCol = collection(firestore, 'executive_payroll_runs', runId, 'lines');
  const batch = writeBatch(firestore);

  let totalGross = 0;
  let totalNet = 0;
  let totalAllowances = 0;
  let totalDeductions = 0;

  for (const staff of staffList) {
    const lineId = `EPL-${staff.staffCode}-${runId.substring(0, 5)}`;
    const lineDoc = doc(linesCol, lineId);

    const baseSalary = staff.monthlySalary || 0;
    const allowance = 0;
    const bonus = 0;
    const d8 = computeOfficePayrollLineD8({
      asOfDate: asOf,
      policies: officePolicies,
      baseSalary,
      allowance,
      bonus,
      overtimeAmount: 0,
      otherIncome: 0,
    });

    const newLine: OfficePayrollLine = {
      id: lineId,
      officePayrollRunId: runId,
      staffId: staff.id,
      staffName: staff.fullName,
      department: staff.department,
      positionTitle: staff.positionTitle,
      baseSalary,
      allowance,
      bonus,
      overtimeAmount: 0,
      otherIncome: 0,
      deductions: d8.deductions,
      tax: d8.tax,
      socialSecurity: d8.socialSecurity,
      grossPay: d8.grossPay,
      netPay: d8.netPay,
      d8Snapshot: d8.snapshot,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    batch.set(lineDoc, newLine);
    totalGross += d8.grossPay;
    totalNet += d8.netPay;
    totalAllowances += allowance + bonus;
    totalDeductions += d8.deductions;
  }

  const runRef = doc(firestore, 'executive_payroll_runs', runId);
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
