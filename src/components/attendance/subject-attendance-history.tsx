'use client';

import { useMemo, useState } from 'react';
import {
  collection,
  doc,
  Firestore,
  query,
  where,
  orderBy,
} from 'firebase/firestore';
import { addMonths, format, startOfMonth } from 'date-fns';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useCollection, useDoc, useMemoFirebase } from '@/firebase';
import {
  ATTENDANCE_DAY_OVERRIDES_COLLECTION,
  ATTENDANCE_OVERTIME_REQUESTS_COLLECTION,
  ATTENDANCE_PUNCHES_COLLECTION,
} from '@/lib/attendance/constants';
import {
  enumerateYmDsForMonth,
  isBangkokWeeklyRestDayYmd,
  type WeeklyRestPatternForCalendar,
} from '@/lib/attendance/bangkok-calendar';
import { AttendanceDayKindCell } from '@/components/attendance/attendance-day-kind-cell';
import { AttendanceGridLineCell } from '@/components/attendance/attendance-grid-line-cell';
import { leaveOverlapsPayrollMonth } from '@/lib/attendance/office-attendance-day-kind';
import {
  attendanceInCorrectedByOverride,
  attendanceOutCorrectedByOverride,
  buildAttendanceDayRows,
} from '@/lib/attendance/correction-merge';
import { buildStaffAttendanceGridCellsByYmd } from '@/lib/attendance/office-attendance-grid-day-cell';
import {
  attendanceOvertimeHoursForRequest,
  formatAttendanceOvertimeHours,
  latestOvertimeRequestBySubjectDay,
  overtimeRequestDayKey,
} from '@/lib/attendance/overtime-display';
import type {
  AttendanceDayOverrideDoc,
  AttendanceOvertimeRequestDoc,
  AttendancePunchDoc,
  AttendanceSubjectType,
} from '@/lib/attendance/types';
import { OFFICE_LEAVE_REQUESTS_COLLECTION } from '@/lib/leaves/policy';
import type { OfficeLeaveRequestDoc } from '@/lib/leaves/types';
import {
  HR_STATUTORY_POLICY_MONTHLY_WORK_ID,
  HR_WORKER_GLOBAL_LABOR_POLICY_ID,
} from '@/lib/payroll/d8/hr-statutory-policy-ids';
import { monthlyWorkNormFromPolicyRecord } from '@/lib/payroll/office-payroll-period-deductions';
import {
  hrSettingsCalendarHolidayLabelForYmd,
  isHrSettingsCalendarHolidayYmd,
  workerGlobalLaborContextFromPolicy,
} from '@/lib/payroll/worker-global-labor-policy';
import type { OfficeStaff, PayrollPolicyRecord } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDateThaiBE } from '@/lib/date-thai';
import { cn } from '@/lib/utils';

export function SubjectAttendanceHistory(props: {
  firestore: Firestore;
  subjectType: AttendanceSubjectType;
  subjectId: string;
  title?: string;
  description?: string;
  staff?: OfficeStaff | null;
}) {
  const { firestore, subjectType, subjectId, title, description, staff: staffProp } = props;
  const subjectKey = `${subjectType}:${subjectId}`;

  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const payrollMonth = format(viewMonth, 'yyyy-MM');
  const monthLabel = format(viewMonth, 'MMMM yyyy');
  const ymDs = useMemo(() => enumerateYmDsForMonth(viewMonth), [viewMonth]);
  const todayBangkokYmd = useMemo(
    () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }),
    [],
  );

  const punchRange = useMemo(() => {
    const startMs = viewMonth.getTime();
    const endExclusiveMs = addMonths(viewMonth, 1).getTime();
    return { startMs, endExclusiveMs };
  }, [viewMonth]);

  const punchesQuery = useMemoFirebase(() => {
    if (!subjectId) return null;
    return query(
      collection(firestore, ATTENDANCE_PUNCHES_COLLECTION),
      where('subjectType', '==', subjectType),
      where('subjectId', '==', subjectId),
      where('punchedAt', '>=', punchRange.startMs),
      where('punchedAt', '<', punchRange.endExclusiveMs),
      orderBy('punchedAt', 'desc'),
    );
  }, [firestore, subjectType, subjectId, punchRange.startMs, punchRange.endExclusiveMs]);

  const overridesQuery = useMemoFirebase(() => {
    if (!subjectId) return null;
    return query(
      collection(firestore, ATTENDANCE_DAY_OVERRIDES_COLLECTION),
      where('subjectKey', '==', subjectKey),
      where('payrollMonth', '==', payrollMonth),
    );
  }, [firestore, subjectId, subjectKey, payrollMonth]);

  const staffDocRef = useMemoFirebase(() => {
    if (staffProp || subjectType !== 'office_staff' || !subjectId) return null;
    return doc(firestore, 'office_staff', subjectId);
  }, [firestore, staffProp, subjectType, subjectId]);

  const { data: staffFromDoc } = useDoc<OfficeStaff>(staffDocRef as any);
  const staff = useMemo((): OfficeStaff | null => {
    if (staffProp) return staffProp;
    if (staffFromDoc) return { ...staffFromDoc, id: staffFromDoc.id || subjectId };
    if (subjectType === 'office_staff') return { id: subjectId } as OfficeStaff;
    return null;
  }, [staffProp, staffFromDoc, subjectType, subjectId]);

  const workerGlobalLaborRef = useMemoFirebase(
    () => doc(firestore, 'payroll_policies', HR_WORKER_GLOBAL_LABOR_POLICY_ID),
    [firestore],
  );
  const { data: workerGlobalLaborPolicy } = useDoc<PayrollPolicyRecord>(workerGlobalLaborRef as any);
  const workerGlobalLabor = useMemo(
    () => workerGlobalLaborContextFromPolicy(workerGlobalLaborPolicy ?? null),
    [workerGlobalLaborPolicy],
  );
  const weeklyRestPattern: WeeklyRestPatternForCalendar = workerGlobalLabor.weeklyRestPattern;
  const calendarHolidays = workerGlobalLabor.calendarHolidays;

  const monthlyWorkNormPolicyRef = useMemoFirebase(
    () => doc(firestore, 'payroll_policies', HR_STATUTORY_POLICY_MONTHLY_WORK_ID),
    [firestore],
  );
  const { data: monthlyWorkNormPolicy } = useDoc<PayrollPolicyRecord>(monthlyWorkNormPolicyRef as any);
  const monthlyWorkNorm = useMemo(
    () => monthlyWorkNormFromPolicyRecord(monthlyWorkNormPolicy ?? null),
    [monthlyWorkNormPolicy],
  );

  const leavesQuery = useMemoFirebase(() => {
    if (subjectType !== 'office_staff' || !subjectId) return null;
    return query(
      collection(firestore, OFFICE_LEAVE_REQUESTS_COLLECTION),
      where('staffId', '==', subjectId),
    );
  }, [firestore, subjectType, subjectId]);

  const overtimeQuery = useMemoFirebase(() => {
    if (!subjectId) return null;
    return query(
      collection(firestore, ATTENDANCE_OVERTIME_REQUESTS_COLLECTION),
      where('subjectKey', '==', subjectKey),
      where('payrollMonth', '==', payrollMonth),
    );
  }, [firestore, subjectId, subjectKey, payrollMonth]);

  const { data: punches, isLoading: punchesLoading, error: punchesError } =
    useCollection<AttendancePunchDoc>(punchesQuery as any);
  const { data: overrides, isLoading: overridesLoading, error: overridesError } =
    useCollection<AttendanceDayOverrideDoc>(overridesQuery as any);
  const { data: leaveRows } = useCollection<OfficeLeaveRequestDoc>(leavesQuery as any);
  const { data: overtimeRows } = useCollection<AttendanceOvertimeRequestDoc>(overtimeQuery as any);

  const approvedLeaves = useMemo(
    () =>
      (leaveRows ?? []).filter(
        (r) => r.status === 'APPROVED' && leaveOverlapsPayrollMonth(r, payrollMonth),
      ),
    [leaveRows, payrollMonth],
  );

  const overtimeBySubjectDay = useMemo(
    () => latestOvertimeRequestBySubjectDay(overtimeRows ?? []),
    [overtimeRows],
  );

  const dayRows = useMemo(
    () => buildAttendanceDayRows(ymDs, punches ?? [], overrides ?? []),
    [ymDs, punches, overrides],
  );

  const gridCellsByYmd = useMemo(() => {
    const staffForGrid = staff ?? ({ id: subjectId } as OfficeStaff);
    return buildStaffAttendanceGridCellsByYmd({
      staff: staffForGrid,
      punches: punches ?? [],
      dayRows,
      approvedLeaves,
      weeklyRestPattern,
      calendarHolidays,
      todayBangkokYmd,
      monthlyWorkNorm,
    });
  }, [
    staff,
    subjectId,
    punches,
    dayRows,
    approvedLeaves,
    weeklyRestPattern,
    calendarHolidays,
    todayBangkokYmd,
    monthlyWorkNorm,
  ]);

  const isLoading = punchesLoading || overridesLoading;
  const error = punchesError ?? overridesError;

  return (
    <Card className="shadow-sm">
      <CardHeader className="bg-muted/30 border-b py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1 min-w-0">
            <CardTitle className="text-lg">{title ?? 'ประวัติการลงเวลา (Kiosk)'}</CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => setViewMonth(startOfMonth(new Date()))}
            >
              เดือนนี้
            </Button>
            <Button
              variant="outline"
              size="icon"
              type="button"
              className="h-9 w-9"
              aria-label="เดือนก่อน"
              onClick={() => setViewMonth((m) => addMonths(m, -1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Label htmlFor="attendance-history-month" className="sr-only">
              เลือกเดือน
            </Label>
            <Input
              id="attendance-history-month"
              type="month"
              className="h-9 w-[9.5rem] tabular-nums"
              value={payrollMonth}
              onChange={(e) => {
                const v = e.target.value;
                if (!/^\d{4}-\d{2}$/.test(v)) return;
                const [y, m] = v.split('-').map(Number);
                setViewMonth(startOfMonth(new Date(y, m - 1, 1)));
              }}
            />
            <Button
              variant="outline"
              size="icon"
              type="button"
              className="h-9 w-9"
              aria-label="เดือนถัดไป"
              onClick={() => setViewMonth((m) => addMonths(m, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="hidden lg:inline text-xs text-muted-foreground tabular-nums">{monthLabel}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-4 overflow-x-auto">
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดประวัติ…
          </div>
        )}
        {error && (
          <p className="text-sm text-destructive py-2">
            โหลดไม่สำเร็จ — {error instanceof Error ? error.message : String(error)}
          </p>
        )}
        {!isLoading && !error && (
          <Table className="table-fixed w-full min-w-[640px] text-[13px]">
            <TableHeader>
              <TableRow>
                <TableHead className="h-9 w-[12%] px-2 text-center text-xs">วันที่</TableHead>
                <TableHead className="h-9 w-[16%] px-2 text-center text-xs">ประเภทวัน</TableHead>
                <TableHead className="h-9 w-[12%] whitespace-nowrap px-1 text-center text-[10px]">เข้าเช้า</TableHead>
                <TableHead className="h-9 w-[12%] whitespace-nowrap px-1 text-center text-[10px]">ออกเที่ยง</TableHead>
                <TableHead className="h-9 w-[12%] whitespace-nowrap px-1 text-center text-[10px]">เข้าบ่าย</TableHead>
                <TableHead className="h-9 w-[12%] whitespace-nowrap px-1 text-center text-[10px]">ออกเย็น</TableHead>
                <TableHead className="h-9 w-[12%] whitespace-nowrap px-2 text-center text-xs">ชม. OT</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dayRows.map((d) => {
                const calendarHolidayLabel = hrSettingsCalendarHolidayLabelForYmd(d.ymd, calendarHolidays);
                const weekendOrHol =
                  isBangkokWeeklyRestDayYmd(d.ymd, weeklyRestPattern)
                  || isHrSettingsCalendarHolidayYmd(d.ymd, calendarHolidays);
                const gridCell = gridCellsByYmd[d.ymd];
                const inCorrectedBadge = attendanceInCorrectedByOverride(d);
                const outCorrectedBadge = attendanceOutCorrectedByOverride(d);
                const otDisplay = attendanceOvertimeHoursForRequest(
                  overtimeBySubjectDay.get(overtimeRequestDayKey(subjectKey, d.ymd)),
                  monthlyWorkNorm,
                );
                return (
                  <TableRow key={d.ymd} className={cn(weekendOrHol && 'bg-muted/40')}>
                    <TableCell className="p-2 font-mono whitespace-nowrap text-center align-middle">
                      {formatDateThaiBE(d.ymd)}
                    </TableCell>
                    <TableCell className="p-2 text-center align-middle">
                      <AttendanceDayKindCell
                        ymd={d.ymd}
                        weeklyRestPattern={weeklyRestPattern}
                        calendarHolidayLabel={calendarHolidayLabel}
                      />
                    </TableCell>
                    <TableCell className="p-1 font-mono text-center align-middle text-xs">
                      {gridCell ? (
                        <AttendanceGridLineCell
                          line={gridCell.morningIn}
                          showCorrectedBadge={inCorrectedBadge && gridCell.morningIn.tone === 'time'}
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="p-1 font-mono text-center align-middle text-xs">
                      {gridCell ? (
                        <AttendanceGridLineCell line={gridCell.morningOut} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="p-1 font-mono text-center align-middle text-xs">
                      {gridCell ? (
                        <AttendanceGridLineCell line={gridCell.afternoonIn} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="p-1 font-mono text-center align-middle text-xs">
                      {gridCell ? (
                        <AttendanceGridLineCell
                          line={gridCell.afternoonOut}
                          showCorrectedBadge={outCorrectedBadge && gridCell.afternoonOut.tone === 'time'}
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="p-2 font-mono text-center align-middle tabular-nums">
                      {otDisplay.hours != null ? (
                        formatAttendanceOvertimeHours(otDisplay.hours)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
