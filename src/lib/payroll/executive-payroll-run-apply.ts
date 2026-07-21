/**
 * งวดเงินเดือนผู้บริหาร — สูตร D8 เดียวกับ Office Payroll (นโยบาย HR `office`)
 * แหล่งรายชื่อ: `executive_payroll_staff` (เมนูบัญชี)
 *
 * ฐานเงินเดือนใช้ `monthlySalary` โดยตรง — ไม่นำเวลาสแกน/OT จากระบบลงเวลามาคำนวณ
 */

import { collection, deleteDoc, doc, getDocs, writeBatch, type Firestore } from 'firebase/firestore';
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
import { executivePayrollLineDocumentId } from '@/lib/payroll/executive-payroll-line-id';

export function isExecutivePayrollStaffEligible(s: ExecutivePayrollStaff): boolean {
  if (s.status !== 'ACTIVE') return false;
  if (s.excludeFromPayrollRuns) {
    const allowedRates = [5, 10, 15, 20, 25, 30, 35];
    return (
      !!s.nonPayrollIncomeType &&
      allowedRates.includes(Number(s.nonPayrollWhtPercent)) &&
      (s.nonPayrollIncomeType !== 'OTHER' || !!s.nonPayrollIncomeOtherLabel?.trim()) &&
      (Number(s.monthlySalary) || 0) > 0
    );
  }
  return true;
}

export function executiveNonPayrollIncomeLabel(s: ExecutivePayrollStaff): string {
  if (s.nonPayrollIncomeType === 'MEETING_ALLOWANCE') return 'เบี้ยประชุมประจำเดือน';
  if (s.nonPayrollIncomeType === 'DIVIDEND') return 'เงินปันผล';
  return s.nonPayrollIncomeOtherLabel?.trim() || 'รายได้อื่น ๆ';
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

/** ลบบรรทัดใน subcollection แล้วลบเอกสารงวด — ใช้เมื่อ admin ลบรายการจากรายการ */
export async function deleteExecutivePayrollRunCascade(firestore: Firestore, runId: string): Promise<void> {
  await deleteAllLinesForExecutiveRun(firestore, runId);
  await deleteDoc(doc(firestore, 'executive_payroll_runs', runId));
}

export function adminExecutivePayrollDeleteBlocked(run: Pick<OfficePayrollRun, 'status' | 'financeCashbookEntryId'>): boolean {
  if (run.status === 'LOCKED' || run.status === 'PAID' || run.status === 'FINANCE_APPROVED') return true;
  if (run.financeCashbookEntryId) return true;
  return false;
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
    const lineId = executivePayrollLineDocumentId(staff.staffCode, runId);
    const lineDoc = doc(linesCol, lineId);

    const isNonPayrollIncome = !!staff.excludeFromPayrollRuns;
    const payoutAmount = Number(staff.monthlySalary) || 0;
    const incomeLabel = isNonPayrollIncome ? executiveNonPayrollIncomeLabel(staff) : '';
    const baseSalary = isNonPayrollIncome ? 0 : payoutAmount;
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
      ...(isNonPayrollIncome
        ? {
            hrAllowanceItems: [{ label: incomeLabel, amount: payoutAmount }],
            deductSocialSecurity: false,
            pitMode: 'MANUAL_PERCENT' as const,
            pitManualPercent: Number(staff.nonPayrollWhtPercent),
          }
        : {}),
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
      ...(isNonPayrollIncome
        ? {
            hrLineAdjustments: {
              allowanceItems: [{ label: incomeLabel, amount: payoutAmount }],
              deductionItems: [],
              deductSocialSecurity: false,
              pitMode: 'MANUAL_PERCENT' as const,
              pitManualPercent: Number(staff.nonPayrollWhtPercent),
              pitManualAmountBaht: null,
              pitManualIncomeLabel: incomeLabel,
              pitManualIncomeType: staff.nonPayrollIncomeType ?? null,
            },
          }
        : {}),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    batch.set(lineDoc, newLine);
    totalGross += d8.grossPay;
    totalNet += d8.netPay;
    totalAllowances += allowance + bonus + (isNonPayrollIncome ? payoutAmount : 0);
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
