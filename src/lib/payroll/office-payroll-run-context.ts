import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';
import {
  ATTENDANCE_DAY_OVERRIDES_COLLECTION,
  ATTENDANCE_PUNCHES_COLLECTION,
} from '@/lib/attendance/constants';
import type { AttendanceDayOverrideDoc, AttendanceOvertimeRequestDoc, AttendancePunchDoc, OfficeLeaveEntitlementsDoc } from '@/lib/attendance/types';
import { buildAttendanceDayRows } from '@/lib/attendance/correction-merge';
import type { AttendanceDayEffectiveRow } from '@/lib/attendance/correction-merge';
import {
  HR_CONFIGURATION_COLLECTION,
  HR_OFFICE_LEAVE_ENTITLEMENTS_DOC_ID,
} from '@/lib/attendance/constants';
import { OFFICE_LEAVE_REQUESTS_COLLECTION } from '@/lib/leaves/policy';
import { ATTENDANCE_OVERTIME_REQUESTS_COLLECTION } from '@/lib/attendance/constants';
import type { OfficeLeaveRequestDoc } from '@/lib/leaves/types';
import { HR_WORKER_GLOBAL_LABOR_POLICY_ID } from '@/lib/payroll/d8/hr-statutory-policy-ids';
import { resolvePayrollPoliciesForDate } from '@/lib/payroll/d8';
import {
  enumerateYmdsInclusive,
  monthlyWorkNormFromPolicyRecord,
} from '@/lib/payroll/office-payroll-period-deductions';
import {
  workerGlobalLaborContextFromPolicy,
} from '@/lib/payroll/worker-global-labor-policy';
import type { CalendarHolidayEntry } from '@/lib/contract-position-rate-extras';
import type { OfficePayrollRun, PayrollPolicyRecord } from '@/lib/types';
import type { WeeklyRestPatternForCalendar } from '@/lib/attendance/bangkok-calendar';

export type OfficePayrollRunComputationContext = {
  leaveEntitlements: OfficeLeaveEntitlementsDoc | null;
  leaveRequests: OfficeLeaveRequestDoc[];
  approvedOvertimeRequests: AttendanceOvertimeRequestDoc[];
  punchesBySubjectKey: Map<string, AttendancePunchDoc[]>;
  overridesBySubjectKey: Map<string, AttendanceDayOverrideDoc[]>;
  attendanceRowsByStaffId: Map<string, AttendanceDayEffectiveRow[]>;
  monthlyWorkNorm: ReturnType<typeof monthlyWorkNormFromPolicyRecord>;
  weeklyRestPattern: WeeklyRestPatternForCalendar;
  calendarHolidays: CalendarHolidayEntry[];
  periodYmds: string[];
  periodEndMs: number;
};

function periodEndMsFromYmd(periodEnd: string): number {
  const ymd = periodEnd.slice(0, 10);
  return Date.parse(`${ymd}T23:59:59.999+07:00`);
}

export async function loadOfficePayrollRunComputationContext(
  firestore: Firestore,
  run: Pick<OfficePayrollRun, 'payrollMonth' | 'payrollPeriodStart' | 'payrollPeriodEnd'>,
  policyRecords: PayrollPolicyRecord[],
): Promise<OfficePayrollRunComputationContext> {
  const periodStart = run.payrollPeriodStart;
  const periodEnd = run.payrollPeriodEnd;
  const periodYmds = enumerateYmdsInclusive(periodStart, periodEnd);
  const periodStartMs = Date.parse(`${periodStart.slice(0, 10)}T00:00:00+07:00`);
  const periodEndExclusiveMs = Date.parse(`${periodEnd.slice(0, 10)}T00:00:00+07:00`) + 86_400_000;
  const year = Number(run.payrollMonth.slice(0, 4)) || new Date().getFullYear();

  const asOf = periodEnd || `${run.payrollMonth}-28`;
  const officePolicies = resolvePayrollPoliciesForDate(asOf, policyRecords, 'office');
  const monthlyWorkNorm = monthlyWorkNormFromPolicyRecord(officePolicies.monthlyWorkNorm);

  const laborRec =
    policyRecords.find((p) => p.id === HR_WORKER_GLOBAL_LABOR_POLICY_ID) ??
    policyRecords.find((p) => p.kind === 'worker_global_labor' && p.status === 'active') ??
    null;
  const laborCtx = workerGlobalLaborContextFromPolicy(laborRec);

  const [entSnap, leaveSnap, otSnap, punchSnap, overrideSnap] = await Promise.all([
    getDoc(doc(firestore, HR_CONFIGURATION_COLLECTION, HR_OFFICE_LEAVE_ENTITLEMENTS_DOC_ID)),
    getDocs(
      query(collection(firestore, OFFICE_LEAVE_REQUESTS_COLLECTION), where('year', '==', year)),
    ),
    getDocs(
      query(
        collection(firestore, ATTENDANCE_OVERTIME_REQUESTS_COLLECTION),
        where('payrollMonth', '==', run.payrollMonth),
        where('status', '==', 'APPROVED'),
      ),
    ),
    getDocs(
      query(
        collection(firestore, ATTENDANCE_PUNCHES_COLLECTION),
        where('punchedAt', '>=', periodStartMs),
        where('punchedAt', '<', periodEndExclusiveMs),
      ),
    ),
    getDocs(
      query(
        collection(firestore, ATTENDANCE_DAY_OVERRIDES_COLLECTION),
        where('payrollMonth', '==', run.payrollMonth),
      ),
    ),
  ]);

  const leaveEntitlements = entSnap.exists() ? (entSnap.data() as OfficeLeaveEntitlementsDoc) : null;
  const leaveRequests = leaveSnap.docs.map(
    (d) => ({ id: d.id, ...(d.data() as object) }) as OfficeLeaveRequestDoc & { id: string },
  );
  const approvedOvertimeRequests = otSnap.docs.map(
    (d) => ({ id: d.id, ...(d.data() as object) }) as AttendanceOvertimeRequestDoc,
  );

  const punchesBySubjectKey = new Map<string, AttendancePunchDoc[]>();
  for (const d of punchSnap.docs) {
    const p = d.data() as AttendancePunchDoc;
    if (p.subjectType !== 'office_staff') continue;
    const key = `office_staff:${p.subjectId}`;
    const arr = punchesBySubjectKey.get(key) ?? [];
    arr.push(p);
    punchesBySubjectKey.set(key, arr);
  }

  const overridesBySubjectKey = new Map<string, AttendanceDayOverrideDoc[]>();
  for (const d of overrideSnap.docs) {
    const o = d.data() as AttendanceDayOverrideDoc;
    if (o.subjectType !== 'office_staff') continue;
    const key = o.subjectKey || `office_staff:${o.subjectId}`;
    const arr = overridesBySubjectKey.get(key) ?? [];
    arr.push(o);
    overridesBySubjectKey.set(key, arr);
  }

  const attendanceRowsByStaffId = new Map<string, AttendanceDayEffectiveRow[]>();
  for (const [key, punches] of punchesBySubjectKey) {
    const staffId = key.split(':')[1];
    if (!staffId) continue;
    const overrides = overridesBySubjectKey.get(key) ?? [];
    attendanceRowsByStaffId.set(staffId, buildAttendanceDayRows(periodYmds, punches, overrides));
  }
  for (const [key, overrides] of overridesBySubjectKey) {
    const staffId = key.split(':')[1];
    if (!staffId || attendanceRowsByStaffId.has(staffId)) continue;
    attendanceRowsByStaffId.set(staffId, buildAttendanceDayRows(periodYmds, [], overrides));
  }

  return {
    leaveEntitlements,
    leaveRequests,
    approvedOvertimeRequests,
    punchesBySubjectKey,
    overridesBySubjectKey,
    attendanceRowsByStaffId,
    monthlyWorkNorm,
    weeklyRestPattern: laborCtx.weeklyRestPattern,
    calendarHolidays: laborCtx.calendarHolidays,
    periodYmds,
    periodEndMs: periodEndMsFromYmd(periodEnd),
  };
}
