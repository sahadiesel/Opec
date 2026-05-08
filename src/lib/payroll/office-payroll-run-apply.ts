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
  run: Pick<OfficePayrollRun, 'payrollMonth' | 'payrollPeriodEnd'>,
  staffList: OfficeStaff[],
  options: { newStatus?: PayrollRunStatus },
): Promise<ApplyOfficeRunLinesResult> {
  assertOfficeStaffListPayrollIdentityComplete(staffList);

  await deleteAllLinesForOfficeRun(firestore, runId);

  const asOf = run.payrollPeriodEnd || `${run.payrollMonth}-28`;
  const policyRecords = await loadPayrollPoliciesFromFirestore(firestore);
  const officePolicies = resolvePayrollPoliciesForDate(asOf, policyRecords, 'office');

  const linesCol = collection(firestore, 'office_payroll_runs', runId, 'lines');
  const batch = writeBatch(firestore);

  let totalGross = 0;
  let totalNet = 0;
  let totalAllowances = 0;
  let totalDeductions = 0;

  for (const staff of staffList) {
    const lineId = `OPL-${staff.staffCode}-${runId.substring(0, 5)}`;
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
