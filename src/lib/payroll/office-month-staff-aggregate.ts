import { collection, getDocs, query, where } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { OfficePayrollLine, OfficePayrollRun, PayrollRunStatus } from '@/lib/types';

/** บรรทัดรวมสำหรับ UI — รวมยอดจากหลายงวด; `sourceRunNos` = เลขที่ run ที่มีบรรทัดนี้ */
export type OfficePayrollLineMonthMerged = OfficePayrollLine & {
  sourceRunNos: string;
  _mergeKey: string;
  /** run แรกที่เจอบรรทัดนี้ — ใช้ลิงก์ไป staff detail */
  staffDetailRunId: string;
};

/**
 * งวด office ที่มีบรรทัดรายคน (หลังคำนวณ) — นับ unique staff รวมทุก run ในเดือนเดียวกัน
 */
export const OFFICE_RUN_STATUSES_WITH_SAVED_LINES: readonly PayrollRunStatus[] = [
  'CALCULATED',
  'HR_REVIEW',
  'HR_APPROVED',
  'FINANCE_APPROVED',
  'PAID',
  'LOCKED',
];

/**
 * รวม unique staffId จากทุก `office_payroll_runs` ที่ `payrollMonth` ตรงกัน
 * และสถานะหลังคำนวณแล้ว (มี snapshot บรรทัด)
 */
export async function fetchUniqueOfficeStaffIdsForPayrollMonth(
  firestore: Firestore,
  payrollMonth: string
): Promise<Set<string>> {
  const out = new Set<string>();
  if (!payrollMonth) return out;

  const runSnap = await getDocs(
    query(collection(firestore, 'office_payroll_runs'), where('payrollMonth', '==', payrollMonth))
  );

  const tasks: Promise<void>[] = [];
  for (const d of runSnap.docs) {
    const run = { id: d.id, ...d.data() } as OfficePayrollRun;
    if (!OFFICE_RUN_STATUSES_WITH_SAVED_LINES.includes(run.status)) continue;

    tasks.push(
      (async () => {
        const lineSnap = await getDocs(collection(firestore, 'office_payroll_runs', d.id, 'lines'));
        lineSnap.forEach((lineDoc) => {
          const line = lineDoc.data() as OfficePayrollLine;
          if (line.staffId) out.add(line.staffId);
        });
      })()
    );
  }
  await Promise.all(tasks);
  return out;
}

export interface OfficePayrollMonthConsolidation {
  payrollMonth: string;
  /** งวดที่นับรวม (สถานะหลังคำนวณ) */
  runs: OfficePayrollRun[];
  /** ยอดรวมจากฟิลด์ run (แต่ละเอกสารงวด) — ใช้เป็นสรุปเดือน */
  sumGrossFromRuns: number;
  sumAllowancesFromRuns: number;
  sumDeductionsFromRuns: number;
  sumNetFromRuns: number;
  uniqueStaffCount: number;
  /** รวมบรรทัดรายคนตาม staffId (รวมยอดหากคนเดียวกันหลายงวด) */
  mergedLines: OfficePayrollLineMonthMerged[];
}

function addNum(a: number | undefined | null, b: number | undefined | null): number {
  return Number(a || 0) + Number(b || 0);
}

/**
 * รวมยอดและรายชื่อพนักงานในทุก `office_payroll_runs` ที่ `payrollMonth` ตรงกัน (หลังคำนวณ)
 */
export async function fetchOfficePayrollMonthConsolidation(
  firestore: Firestore,
  payrollMonth: string
): Promise<OfficePayrollMonthConsolidation> {
  const empty: OfficePayrollMonthConsolidation = {
    payrollMonth,
    runs: [],
    sumGrossFromRuns: 0,
    sumAllowancesFromRuns: 0,
    sumDeductionsFromRuns: 0,
    sumNetFromRuns: 0,
    uniqueStaffCount: 0,
    mergedLines: [],
  };
  if (!payrollMonth) return empty;

  const runSnap = await getDocs(
    query(collection(firestore, 'office_payroll_runs'), where('payrollMonth', '==', payrollMonth))
  );

  const runs: OfficePayrollRun[] = [];
  for (const d of runSnap.docs) {
    const r = { id: d.id, ...d.data() } as OfficePayrollRun;
    if (!OFFICE_RUN_STATUSES_WITH_SAVED_LINES.includes(r.status)) continue;
    runs.push(r);
  }
  runs.sort((a, b) => (a.payrollRunNo || '').localeCompare(b.payrollRunNo || ''));

  let sumGrossFromRuns = 0;
  let sumAllowancesFromRuns = 0;
  let sumDeductionsFromRuns = 0;
  let sumNetFromRuns = 0;
  for (const r of runs) {
    sumGrossFromRuns = addNum(sumGrossFromRuns, r.grossAmount);
    sumAllowancesFromRuns = addNum(sumAllowancesFromRuns, r.totalAllowances);
    sumDeductionsFromRuns = addNum(sumDeductionsFromRuns, r.totalDeductions);
    sumNetFromRuns = addNum(sumNetFromRuns, r.netAmount);
  }

  const byStaff = new Map<
    string,
    {
      line: OfficePayrollLine;
      runNos: Set<string>;
      maxUpdated: number;
      firstRunId: string;
    }
  >();

  for (const r of runs) {
    const lineSnap = await getDocs(collection(firestore, 'office_payroll_runs', r.id, 'lines'));
    lineSnap.forEach((ld) => {
      const line = { ...ld.data(), id: ld.id } as OfficePayrollLine;
      const staffId = line.staffId || line.id;
      if (!staffId) return;
      const runNo = r.payrollRunNo || r.id;
      const lineUpdated = line.updatedAt || 0;
      const cur = byStaff.get(staffId);
      if (!cur) {
        byStaff.set(staffId, {
          line: { ...line, officePayrollRunId: r.id },
          runNos: new Set([runNo]),
          maxUpdated: lineUpdated,
          firstRunId: r.id,
        });
        return;
      }
      const prev = cur.line;
      const useNew = lineUpdated > cur.maxUpdated;
      const merged: OfficePayrollLine = {
        ...prev,
        id: `merged-${staffId}`,
        staffId,
        staffName: useNew ? line.staffName : prev.staffName,
        department: useNew ? line.department : prev.department,
        positionTitle: useNew ? line.positionTitle : prev.positionTitle,
        baseSalary: addNum(prev.baseSalary, line.baseSalary),
        allowance: addNum(prev.allowance, line.allowance),
        bonus: addNum(prev.bonus, line.bonus),
        overtimeAmount: addNum(prev.overtimeAmount, line.overtimeAmount),
        otherIncome: addNum(prev.otherIncome, line.otherIncome),
        deductions: addNum(prev.deductions, line.deductions),
        tax: addNum(prev.tax, line.tax),
        socialSecurity: addNum(prev.socialSecurity, line.socialSecurity),
        grossPay: addNum(prev.grossPay, line.grossPay),
        netPay: addNum(prev.netPay, line.netPay),
        updatedAt: Math.max(cur.maxUpdated, lineUpdated),
        officePayrollRunId: r.id,
      };
      cur.runNos.add(runNo);
      byStaff.set(staffId, {
        line: merged,
        runNos: cur.runNos,
        maxUpdated: merged.updatedAt || 0,
        firstRunId: cur.firstRunId,
      });
    });
  }

  const mergedLines: OfficePayrollLineMonthMerged[] = [...byStaff.entries()]
    .map(([k, v]) => {
      const runNos = [...v.runNos].sort().join(', ');
      return {
        ...v.line,
        _mergeKey: k,
        sourceRunNos: runNos,
        staffDetailRunId: v.firstRunId,
      };
    })
    .sort((a, b) => a.staffName.localeCompare(b.staffName, 'th'));

  return {
    payrollMonth,
    runs,
    sumGrossFromRuns,
    sumAllowancesFromRuns,
    sumDeductionsFromRuns,
    sumNetFromRuns,
    uniqueStaffCount: byStaff.size,
    mergedLines,
  };
}
