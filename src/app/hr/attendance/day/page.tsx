'use client';

import { Suspense, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { addMonths, format, startOfMonth } from 'date-fns';
import {
  collection,
  doc,
  limit,
  query,
  where,
  orderBy,
  type Firestore,
} from 'firebase/firestore';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { AttendanceGridLineCell } from '@/components/attendance/attendance-grid-line-cell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAppUser } from '@/hooks/use-app-user';
import { useCollection, useDoc, useFirestore, useMemoFirebase } from '@/firebase';
import { canAccessHrAttendanceKioskPages } from '@/lib/navigation/nav-access';
import {
  ATTENDANCE_CORRECTION_REQUESTS_COLLECTION,
  ATTENDANCE_DAY_OVERRIDES_COLLECTION,
  ATTENDANCE_OVERTIME_REQUESTS_COLLECTION,
  ATTENDANCE_PUNCHES_COLLECTION,
} from '@/lib/attendance/constants';
import { buildAttendanceListHref } from '@/lib/attendance/attendance-hr-navigation';
import {
  attendanceCorrectionStatusLabelTh,
  correctionRequestsForSubjectDay,
  leaveRequestsForStaffYmd,
  overtimeRequestsForSubjectDay,
} from '@/lib/attendance/office-attendance-day-detail';
import {
  attendanceInCorrectedByOverride,
  attendanceOutCorrectedByOverride,
  buildAttendanceDayRows,
} from '@/lib/attendance/correction-merge';
import {
  formatBangkokHmFromUtcMs,
  isBangkokWeeklyRestDayYmd,
} from '@/lib/attendance/bangkok-calendar';
import { buildStaffAttendanceGridCellsByYmd } from '@/lib/attendance/office-attendance-grid-day-cell';
import {
  attendanceOvertimeHoursForRequest,
  formatAttendanceOvertimeHours,
} from '@/lib/attendance/overtime-display';
import type {
  AttendanceCorrectionRequestDoc,
  AttendanceDayOverrideDoc,
  AttendanceOvertimeRequestDoc,
  AttendancePunchDoc,
} from '@/lib/attendance/types';
import { formatDateThaiBE, formatPayrollYearMonthThaiBE } from '@/lib/date-thai';
import { OFFICE_LEAVE_REQUESTS_COLLECTION, OFFICE_LEAVE_STATUS_LABELS, OFFICE_LEAVE_TYPE_LABELS } from '@/lib/leaves/policy';
import type { OfficeLeaveRequestDoc } from '@/lib/leaves/types';
import {
  officeLeaveApproverLabelTh,
  officeLeaveCreatedByLabelTh,
  officeLeaveDateRangeLabelTh,
} from '@/lib/documents/office-leave-request-list-print';
import { monthlyWorkNormFromPolicyRecord } from '@/lib/payroll/office-payroll-period-deductions';
import {
  HR_STATUTORY_POLICY_MONTHLY_WORK_ID,
  HR_WORKER_GLOBAL_LABOR_POLICY_ID,
} from '@/lib/payroll/d8/hr-statutory-policy-ids';
import {
  hrSettingsCalendarHolidayLabelForYmd,
  isHrSettingsCalendarHolidayYmd,
  workerGlobalLaborContextFromPolicy,
} from '@/lib/payroll/worker-global-labor-policy';
import type { OfficeStaff, PayrollPolicyRecord, User } from '@/lib/types';

function hmOrDash(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  return formatBangkokHmFromUtcMs(ms);
}

function AttendanceDayDetailPageContent() {
  const searchParams = useSearchParams();
  const staffId = (searchParams.get('staffId') ?? '').trim();
  const ymd = (searchParams.get('ymd') ?? '').trim().slice(0, 10);
  const month = (searchParams.get('month') ?? ymd.slice(0, 7)).trim().slice(0, 7);
  const q = searchParams.get('q') ?? '';
  const openStaff = searchParams.get('openStaff') ?? staffId;

  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();

  const canUse = useMemo(
    () => !!currentUser && canAccessHrAttendanceKioskPages(currentUser as User, null),
    [currentUser],
  );

  const backHref = buildAttendanceListHref({ month, q, openStaff });
  const viewMonth = useMemo(() => {
    if (!/^\d{4}-\d{2}$/.test(month)) return startOfMonth(new Date());
    const [y, m] = month.split('-').map(Number);
    return startOfMonth(new Date(y, (m || 1) - 1, 1));
  }, [month]);
  const range = useMemo(() => {
    const startMs = viewMonth.getTime();
    const endExclusiveMs = addMonths(viewMonth, 1).getTime();
    return { startMs, endExclusiveMs };
  }, [viewMonth]);

  const staffRef = useMemoFirebase(
    () => (firestore && staffId ? doc(firestore as Firestore, 'office_staff', staffId) : null),
    [firestore, staffId],
  );
  const { data: staff, isLoading: staffLoading } = useDoc<OfficeStaff>(staffRef as any);

  const workerGlobalLaborRef = useMemoFirebase(
    () => (firestore ? doc(firestore as Firestore, 'payroll_policies', HR_WORKER_GLOBAL_LABOR_POLICY_ID) : null),
    [firestore],
  );
  const { data: workerGlobalLaborPolicy } = useDoc<PayrollPolicyRecord>(workerGlobalLaborRef as any);
  const workerGlobalLabor = useMemo(
    () => workerGlobalLaborContextFromPolicy(workerGlobalLaborPolicy ?? null),
    [workerGlobalLaborPolicy],
  );

  const monthlyWorkNormPolicyRef = useMemoFirebase(
    () => (firestore ? doc(firestore as Firestore, 'payroll_policies', HR_STATUTORY_POLICY_MONTHLY_WORK_ID) : null),
    [firestore],
  );
  const { data: monthlyWorkNormPolicy } = useDoc<PayrollPolicyRecord>(monthlyWorkNormPolicyRef as any);
  const monthlyWorkNorm = useMemo(
    () => monthlyWorkNormFromPolicyRecord(monthlyWorkNormPolicy ?? null),
    [monthlyWorkNormPolicy],
  );

  const punchesQuery = useMemoFirebase(() => {
    if (!firestore || !canUse) return null;
    return query(
      collection(firestore as Firestore, ATTENDANCE_PUNCHES_COLLECTION),
      where('punchedAt', '>=', range.startMs),
      where('punchedAt', '<', range.endExclusiveMs),
      orderBy('punchedAt', 'asc'),
    );
  }, [firestore, canUse, range.startMs, range.endExclusiveMs]);

  const overridesQuery = useMemoFirebase(() => {
    if (!firestore || !canUse || !month) return null;
    return query(
      collection(firestore as Firestore, ATTENDANCE_DAY_OVERRIDES_COLLECTION),
      where('payrollMonth', '==', month),
    );
  }, [firestore, canUse, month]);

  const correctionsQuery = useMemoFirebase(() => {
    if (!firestore || !canUse || !month) return null;
    return query(
      collection(firestore as Firestore, ATTENDANCE_CORRECTION_REQUESTS_COLLECTION),
      where('payrollMonth', '==', month),
    );
  }, [firestore, canUse, month]);

  const overtimeQuery = useMemoFirebase(() => {
    if (!firestore || !canUse || !month) return null;
    return query(
      collection(firestore as Firestore, ATTENDANCE_OVERTIME_REQUESTS_COLLECTION),
      where('payrollMonth', '==', month),
    );
  }, [firestore, canUse, month]);

  const leavesQuery = useMemoFirebase(() => {
    if (!firestore || !canUse || !ymd) return null;
    const year = Number(ymd.slice(0, 4));
    if (!Number.isFinite(year)) return null;
    return query(
      collection(firestore as Firestore, OFFICE_LEAVE_REQUESTS_COLLECTION),
      where('year', '==', year),
      limit(2000),
    );
  }, [firestore, canUse, ymd]);

  const { data: punchRowsRaw } = useCollection<AttendancePunchDoc>(punchesQuery as any);
  const punchRows = useMemo(
    () =>
      (punchRowsRaw ?? []).filter(
        (p) => p.subjectType === 'office_staff' && p.subjectId === staffId,
      ),
    [punchRowsRaw, staffId],
  );
  const { data: overrideRows } = useCollection<AttendanceDayOverrideDoc>(overridesQuery as any);
  const { data: correctionRows } = useCollection<AttendanceCorrectionRequestDoc>(correctionsQuery as any);
  const { data: overtimeRows } = useCollection<AttendanceOvertimeRequestDoc>(overtimeQuery as any);
  const { data: leaveRows } = useCollection<OfficeLeaveRequestDoc & { id: string }>(leavesQuery as any);

  const subjectKey = `office_staff:${staffId}`;
  const subjectOverrides = useMemo(
    () => (overrideRows ?? []).filter((o) => o.subjectKey === subjectKey),
    [overrideRows, subjectKey],
  );
  const dayPunches = useMemo(
    () =>
      (punchRows ?? []).filter((p) => {
        const pYmd = new Date(p.punchedAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
        return pYmd === ymd;
      }),
    [punchRows, ymd],
  );

  const dayRow = useMemo(() => {
    if (!ymd) return null;
    return buildAttendanceDayRows([ymd], punchRows ?? [], subjectOverrides)[0] ?? null;
  }, [ymd, punchRows, subjectOverrides]);

  const todayBangkokYmd = useMemo(
    () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }),
    [],
  );

  const approvedLeavesInMonth = useMemo(
    () =>
      (leaveRows ?? []).filter((r) => r.status === 'APPROVED' && r.staffId === staffId),
    [leaveRows, staffId],
  );

  const gridCell = useMemo(() => {
    if (!staff || !dayRow) return null;
    const cells = buildStaffAttendanceGridCellsByYmd({
      staff,
      punches: punchRows ?? [],
      dayRows: [dayRow],
      approvedLeaves: approvedLeavesInMonth,
      weeklyRestPattern: workerGlobalLabor.weeklyRestPattern,
      calendarHolidays: workerGlobalLabor.calendarHolidays,
      todayBangkokYmd,
      monthlyWorkNorm,
    });
    return cells[ymd] ?? null;
  }, [
    staff,
    dayRow,
    punchRows,
    approvedLeavesInMonth,
    workerGlobalLabor,
    todayBangkokYmd,
    monthlyWorkNorm,
    ymd,
  ]);

  const leaveItems = useMemo(
    () =>
      leaveRequestsForStaffYmd(leaveRows ?? [], staffId, ymd) as (OfficeLeaveRequestDoc & {
        id: string;
      })[],
    [leaveRows, staffId, ymd],
  );
  const correctionItems = useMemo(
    () => correctionRequestsForSubjectDay(correctionRows ?? [], subjectKey, ymd),
    [correctionRows, subjectKey, ymd],
  );
  const overtimeItems = useMemo(
    () => overtimeRequestsForSubjectDay(overtimeRows ?? [], subjectKey, ymd),
    [overtimeRows, subjectKey, ymd],
  );

  const calendarHolidayLabel = hrSettingsCalendarHolidayLabelForYmd(
    ymd,
    workerGlobalLabor.calendarHolidays,
  );
  const isWeekendOrHol =
    isBangkokWeeklyRestDayYmd(ymd, workerGlobalLabor.weeklyRestPattern)
    || isHrSettingsCalendarHolidayYmd(ymd, workerGlobalLabor.calendarHolidays);

  const invalidParams = !staffId || !/^\d{4}-\d{2}-\d{2}$/.test(ymd);

  if (userLoading || !currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground text-sm">
        กำลังโหลด…
      </div>
    );
  }

  if (!canUse) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="max-w-3xl mx-auto py-16 text-center text-muted-foreground">
          คุณไม่มีสิทธิ์เข้าถึงเมนูนี้
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-3xl mx-auto space-y-6 pb-12">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" asChild className="shrink-0 mt-0.5">
            <Link href={backHref} aria-label="ย้อนกลับ">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary">รายละเอียดการลงเวลารายวัน</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {formatPayrollYearMonthThaiBE(month)} · ดูเหตุผลการลา / คำขอแก้ไขเวลา / OT
            </p>
          </div>
        </div>

        {invalidParams ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-destructive">
              ลิงก์ไม่ถูกต้อง — กลับไป{' '}
              <Link href={backHref} className="underline">
                สรุปรายเดือน
              </Link>
            </CardContent>
          </Card>
        ) : staffLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !staff ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              ไม่พบพนักงาน —{' '}
              <Link href={backHref} className="text-primary underline">
                กลับ
              </Link>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{staff.fullName}</CardTitle>
                <CardDescription>
                  {staff.staffCode || staffId} · {formatDateThaiBE(ymd)}
                  {calendarHolidayLabel ? ` · ${calendarHolidayLabel}` : ''}
                  {isWeekendOrHol ? ' · วันหยุด' : ' · วันทำงาน'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-center text-xs">เข้าเช้า</TableHead>
                      <TableHead className="text-center text-xs">ออกเที่ยง</TableHead>
                      <TableHead className="text-center text-xs">เข้าบ่าย</TableHead>
                      <TableHead className="text-center text-xs">ออกเย็น</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      {gridCell ? (
                        <>
                          <TableCell className="text-center text-sm">
                            <AttendanceGridLineCell
                              line={gridCell.morningIn}
                              showCorrectedBadge={
                                !!dayRow
                                && attendanceInCorrectedByOverride(dayRow)
                                && gridCell.morningIn.tone === 'time'
                              }
                            />
                          </TableCell>
                          <TableCell className="text-center text-sm">
                            <AttendanceGridLineCell line={gridCell.morningOut} />
                          </TableCell>
                          <TableCell className="text-center text-sm">
                            <AttendanceGridLineCell line={gridCell.afternoonIn} />
                          </TableCell>
                          <TableCell className="text-center text-sm">
                            <AttendanceGridLineCell
                              line={gridCell.afternoonOut}
                              showCorrectedBadge={
                                !!dayRow
                                && attendanceOutCorrectedByOverride(dayRow)
                                && gridCell.afternoonOut.tone === 'time'
                              }
                            />
                          </TableCell>
                        </>
                      ) : (
                        <TableCell colSpan={4} className="text-center text-muted-foreground">
                          —
                        </TableCell>
                      )}
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">การลา</CardTitle>
                <CardDescription>ใบลาที่ทับกับวันนี้</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {leaveItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground">ไม่มีใบลาสำหรับวันนี้</p>
                ) : (
                  leaveItems.map((r) => (
                    <div key={r.id} className="rounded-lg border p-4 space-y-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{OFFICE_LEAVE_TYPE_LABELS[r.leaveType]}</Badge>
                        <Badge>{OFFICE_LEAVE_STATUS_LABELS[r.status]}</Badge>
                        {r.isHalfDay ? (
                          <Badge variant="secondary">
                            ครึ่ง{r.halfDaySession === 'MORNING' ? 'เช้า' : 'บ่าย'}
                          </Badge>
                        ) : null}
                      </div>
                      <p>
                        <span className="text-muted-foreground">ช่วงลา:</span>{' '}
                        {officeLeaveDateRangeLabelTh(r)}
                      </p>
                      <p>
                        <span className="text-muted-foreground">เหตุผล:</span> {r.reason || '—'}
                      </p>
                      {r.rejectReason ? (
                        <p className="text-destructive">
                          <span className="text-muted-foreground">เหตุผลไม่อนุมัติ:</span> {r.rejectReason}
                        </p>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        ผู้จัดทำ: {officeLeaveCreatedByLabelTh(r)}
                        {' · '}
                        ผู้อนุมัติ: {officeLeaveApproverLabelTh(r)}
                      </p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">แก้ไขเวลา</CardTitle>
                <CardDescription>ประวัติคำขอแก้ไขเวลาเข้า–ออก</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {correctionItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground">ไม่มีคำขอแก้ไขเวลาสำหรับวันนี้</p>
                ) : (
                  correctionItems.map((r) => (
                    <div key={r.id} className="rounded-lg border p-4 space-y-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={r.status === 'REJECTED' ? 'destructive' : 'secondary'}>
                          {attendanceCorrectionStatusLabelTh(r.status)}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(r.requestedAt).toLocaleString('th-TH', {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                        </span>
                      </div>
                      <p>
                        <span className="text-muted-foreground">เดิม:</span> เข้า {hmOrDash(r.previousInAtMs)} · ออก{' '}
                        {hmOrDash(r.previousOutAtMs)}
                      </p>
                      <p>
                        <span className="text-muted-foreground">ขอแก้เป็น:</span> เข้า {hmOrDash(r.proposedInAtMs)} · ออก{' '}
                        {hmOrDash(r.proposedOutAtMs)}
                      </p>
                      <p>
                        <span className="text-muted-foreground">เหตุผล:</span> {r.reason || '—'}
                      </p>
                      {r.rejectReason ? (
                        <p className="text-destructive">
                          <span className="text-muted-foreground">เหตุผลไม่อนุมัติ:</span> {r.rejectReason}
                        </p>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        ผู้ขอ: {r.requestedByName || r.requestedByUid || '—'}
                        {r.reviewedByName || r.reviewedByUid
                          ? ` · ผู้พิจารณา: ${r.reviewedByName || r.reviewedByUid}`
                          : ''}
                      </p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {overtimeItems.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">โอที (OT)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {overtimeItems.map((r) => {
                    const ot = attendanceOvertimeHoursForRequest(r);
                    return (
                      <div key={r.id} className="rounded-lg border p-4 space-y-2 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">{r.status}</Badge>
                          {ot.hours != null ? (
                            <span className="font-mono font-semibold">
                              {formatAttendanceOvertimeHours(ot.hours)}
                            </span>
                          ) : null}
                        </div>
                        <p>
                          <span className="text-muted-foreground">เหตุผล:</span> {r.reason || '—'}
                        </p>
                        {r.rejectReason ? (
                          <p className="text-destructive">{r.rejectReason}</p>
                        ) : null}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            ) : null}

            {dayPunches.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">บันทึกสแกน Kiosk</CardTitle>
                  <CardDescription>เวลาดิบจากระบบ (Asia/Bangkok)</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1 text-sm font-mono">
                    {dayPunches.map((p) => (
                      <li key={p.id}>
                        {p.direction === 'IN' ? 'เข้า' : 'ออก'} {formatBangkokHmFromUtcMs(p.punchedAt)}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : null}

            <div className="flex justify-start">
              <Button variant="outline" asChild>
                <Link href={backHref}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  กลับสรุปรายเดือน
                </Link>
              </Button>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

export default function AttendanceDayDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-muted-foreground text-sm">
          กำลังโหลด…
        </div>
      }
    >
      <AttendanceDayDetailPageContent />
    </Suspense>
  );
}
