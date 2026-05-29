'use client';

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  collection,
  query,
  where,
  orderBy,
  doc,
  Firestore,
} from 'firebase/firestore';
import { addMonths, format, startOfMonth } from 'date-fns';
import { AppShell } from '@/components/layout/app-shell';
import { useAppUser } from '@/hooks/use-app-user';
import { useFirestore, useCollection, useDoc, useMemoFirebase } from '@/firebase';
import { canAccessHrAttendanceKioskPages } from '@/lib/navigation/nav-access';
import {
  canSubmitAttendanceCorrectionRequest,
} from '@/lib/permissions';
import type { User, OfficeStaff } from '@/lib/types';
import {
  ATTENDANCE_PUNCHES_COLLECTION,
  ATTENDANCE_DAY_OVERRIDES_COLLECTION,
} from '@/lib/attendance/constants';
import type {
  AttendancePunchDoc,
  AttendanceSubjectType,
  AttendanceDayOverrideDoc,
} from '@/lib/attendance/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { formatDateThaiBE } from '@/lib/date-thai';
import { cn } from '@/lib/utils';
import {
  enumerateYmDsForMonth,
  bangkokIsoWeekdayFromYmd,
  formatBangkokHmFromUtcMs,
  isBangkokWeeklyRestDayYmd,
  weeklyRestPatternLabelTh,
  type WeeklyRestPatternForCalendar,
} from '@/lib/attendance/bangkok-calendar';
import { isThaiPublicHolidayYmd } from '@/lib/calendar/thailand-public-holidays';
import {
  buildAttendanceDayRows,
  countDaysWithEffectiveRecord,
} from '@/lib/attendance/correction-merge';
import { AttendanceCorrectionRequestDialog } from '@/components/attendance/attendance-correction-request-dialog';
import { HR_WORKER_GLOBAL_LABOR_POLICY_ID } from '@/lib/payroll/d8/hr-statutory-policy-ids';
import type { PayrollPolicyRecord } from '@/lib/types';

/** พนักงานออฟฟิศที่อยู่ในทะเบียนปัจจุบัน — ไม่รวมผู้บริหาร (แยกทะเบียน/งวด) */
function isOfficeStaffOnActiveRegistry(s: OfficeStaff): boolean {
  return s.status === 'ACTIVE' && s.payrollBand !== 'EXECUTIVE';
}

type SubjectKey = `${AttendanceSubjectType}:${string}`;

function subjectKey(subjectType: AttendanceSubjectType, subjectId: string): SubjectKey {
  return `${subjectType}:${subjectId}`;
}

function groupBySubject(rows: Array<AttendancePunchDoc & { id: string }>): Map<SubjectKey, (AttendancePunchDoc & { id: string })[]> {
  const m = new Map<SubjectKey, (AttendancePunchDoc & { id: string })[]>();
  for (const r of rows) {
    const k = subjectKey(r.subjectType, r.subjectId);
    const arr = m.get(k) ?? [];
    arr.push(r);
    m.set(k, arr);
  }
  for (const [, arr] of m) {
    arr.sort((a, b) => (b.punchedAt ?? 0) - (a.punchedAt ?? 0));
  }
  return m;
}

function dayKindBadges(ymd: string, weeklyRestPattern: WeeklyRestPatternForCalendar) {
  const tags: string[] = [];
  if (isThaiPublicHolidayYmd(ymd)) tags.push('วันหยุดนักขัตฤกษ์');
  const iso = bangkokIsoWeekdayFromYmd(ymd);
  /** ขึ้นป้าย "เสาร์/อาทิตย์" เฉพาะเมื่อตรงกับนโยบายวันหยุดประจำสัปดาห์ที่ตั้งไว้ใน HR Settings */
  if (iso === 7 && (weeklyRestPattern === 'sat_sun' || weeklyRestPattern === 'sunday_only')) {
    tags.push('วันอาทิตย์');
  } else if (iso === 6 && weeklyRestPattern === 'sat_sun') {
    tags.push('วันเสาร์');
  }
  if (tags.length === 0) return <span className="text-muted-foreground text-xs">วันทำงาน</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <Badge key={t} variant="outline" className="text-[10px] font-normal">
          {t}
        </Badge>
      ))}
    </div>
  );
}

export default function HrAttendanceManagePage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const [search, setSearch] = useState('');
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});

  const [corrOpen, setCorrOpen] = useState(false);
  const [corrCtx, setCorrCtx] = useState<{
    subjectType: AttendanceSubjectType;
    subjectId: string;
    subjectNameSnapshot: string;
    workDateYmd: string;
    previousInAtMs: number | null;
    previousOutAtMs: number | null;
    previousInPunchId: string | null;
    previousOutPunchId: string | null;
  } | null>(null);

  const range = useMemo(() => {
    const startMs = viewMonth.getTime();
    const endExclusiveMs = addMonths(viewMonth, 1).getTime();
    return { startMs, endExclusiveMs };
  }, [viewMonth]);

  const payrollMonth = format(viewMonth, 'yyyy-MM');
  const ymDs = useMemo(() => enumerateYmDsForMonth(viewMonth), [viewMonth]);

  /** อ่าน HR Settings รูปแบบวันหยุดประจำสัปดาห์ — ใช้ทั้ง badge แต่ละวันและสรุปวันทำงานในเดือน */
  const workerGlobalLaborRef = useMemoFirebase(
    () => (firestore ? doc(firestore as Firestore, 'payroll_policies', HR_WORKER_GLOBAL_LABOR_POLICY_ID) : null),
    [firestore],
  );
  const { data: workerGlobalLaborPolicy } = useDoc<PayrollPolicyRecord>(workerGlobalLaborRef as any);
  const weeklyRestPattern: WeeklyRestPatternForCalendar = useMemo(() => {
    const cfg = workerGlobalLaborPolicy?.config as Record<string, unknown> | undefined;
    const v = cfg?.weeklyRestPattern;
    if (v === 'sat_sun' || v === 'sunday_only' || v === 'none') return v;
    return 'sat_sun';
  }, [workerGlobalLaborPolicy]);

  /** วันทำงาน = วันที่ไม่ใช่วันหยุดประจำสัปดาห์ (ตามนโยบาย) และไม่ใช่วันหยุดนักขัตฤกษ์ */
  const workingDaysInCalendarMonth = useMemo(() => {
    let n = 0;
    for (const ymd of ymDs) {
      if (isBangkokWeeklyRestDayYmd(ymd, weeklyRestPattern)) continue;
      if (isThaiPublicHolidayYmd(ymd)) continue;
      n++;
    }
    return n;
  }, [ymDs, weeklyRestPattern]);

  const canUse = useMemo(
    () => !!currentUser && canAccessHrAttendanceKioskPages(currentUser as User, null),
    [currentUser],
  );

  const canRequestCorrection = useMemo(
    () => canSubmitAttendanceCorrectionRequest(currentUser),
    [currentUser],
  );

  const punchesQuery = useMemoFirebase(() => {
    if (!firestore || !canUse) return null;
    return query(
      collection(firestore as Firestore, ATTENDANCE_PUNCHES_COLLECTION),
      where('punchedAt', '>=', range.startMs),
      where('punchedAt', '<', range.endExclusiveMs),
      orderBy('punchedAt', 'desc'),
    );
  }, [firestore, canUse, range.startMs, range.endExclusiveMs]);

  const officeStaffQuery = useMemoFirebase(() => {
    if (!firestore || !canUse) return null;
    return collection(firestore as Firestore, 'office_staff');
  }, [firestore, canUse]);

  const { data: officeStaffRows, isLoading: staffLoading, error: staffError } =
    useCollection<OfficeStaff>(officeStaffQuery as any);

  const { data: punchRows, isLoading: punchesLoading, error: punchesError } =
    useCollection<AttendancePunchDoc>(punchesQuery as any);

  const overridesQuery = useMemoFirebase(() => {
    if (!firestore || !canUse) return null;
    return query(
      collection(firestore as Firestore, ATTENDANCE_DAY_OVERRIDES_COLLECTION),
      where('payrollMonth', '==', payrollMonth),
    );
  }, [firestore, canUse, payrollMonth]);

  const { data: overrideRows } = useCollection<AttendanceDayOverrideDoc>(overridesQuery as any);

  const grouped = useMemo(() => groupBySubject((punchRows ?? []) as any), [punchRows]);

  const overridesBySubject = useMemo(() => {
    const m = new Map<SubjectKey, AttendanceDayOverrideDoc[]>();
    for (const o of overrideRows ?? []) {
      const k = o.subjectKey as SubjectKey;
      const arr = m.get(k) ?? [];
      arr.push(o);
      m.set(k, arr);
    }
    return m;
  }, [overrideRows]);

  const activeOfficeStaff = useMemo(() => {
    return (officeStaffRows ?? []).filter(isOfficeStaffOnActiveRegistry);
  }, [officeStaffRows]);

  const summaryRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const entries = activeOfficeStaff.map((staff) => {
      const key = subjectKey('office_staff', staff.id);
      const punches = (grouped.get(key) ?? []) as (AttendancePunchDoc & { id: string })[];
      const name = staff.fullName?.trim() || punches[0]?.subjectNameSnapshot?.trim() || staff.id;
      const subjectOverrides = overridesBySubject.get(key) ?? [];
      const dayRows = buildAttendanceDayRows(ymDs, punches as AttendancePunchDoc[], subjectOverrides);
      const daysRecorded = countDaysWithEffectiveRecord(dayRows);
      return {
        key,
        staffId: staff.id,
        staffCode: staff.staffCode,
        name,
        punches,
        dayRows,
        daysRecorded,
        workingDaysInCalendarMonth,
      };
    });
    entries.sort((a, b) => a.name.localeCompare(b.name, 'th'));
    if (!q) return entries;
    return entries.filter(
      (r) =>
        r.name.toLowerCase().includes(q)
        || r.staffCode.toLowerCase().includes(q)
        || r.staffId.toLowerCase().includes(q),
    );
  }, [activeOfficeStaff, grouped, ymDs, overridesBySubject, workingDaysInCalendarMonth, search]);

  const toggleOpen = (key: string) => {
    setOpenRows((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const openCorrection = (ctx: NonNullable<typeof corrCtx>) => {
    setCorrCtx(ctx);
    setCorrOpen(true);
  };

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

  const monthLabel = format(viewMonth, 'MMMM yyyy');

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <Button variant="ghost" size="icon" asChild className="shrink-0 mt-0.5">
              <Link href="/timesheets">
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-primary">จัดการการลงเวลา</h1>
              <p className="text-sm text-muted-foreground mt-1">
                สรุปการสแกน Kiosk (QR) รายเดือนของพนักงานออฟฟิศจากทะเบียนปัจจุบัน — แสดงทุกคนที่ ACTIVE ในระบบ
                (ไม่รวมผู้ที่ถูกลบออกจากทะเบียนแล้ว แม้เคยมีบันทึกสแกน) · ใช้ประกอบงวดจ่ายเงินเดือนออฟฟิศ
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
              aria-label="เดือนก่อน"
              onClick={() => setViewMonth((m) => addMonths(m, -1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-semibold tabular-nums min-w-[9rem] text-center">{monthLabel}</span>
            <Button
              variant="outline"
              size="icon"
              type="button"
              aria-label="เดือนถัดไป"
              onClick={() => setViewMonth((m) => addMonths(m, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader className="border-b bg-muted/20">
            <CardTitle className="text-lg">สรุปรายเดือน</CardTitle>
            <CardDescription>
              วันทำงานตามปฏิทิน = ทุกวันยกเว้น{' '}
              <span className="font-semibold text-foreground">วันหยุดประจำสัปดาห์ ({weeklyRestPatternLabelTh(weeklyRestPattern)})</span>
              {' '}และวันหยุดนักขัตฤกษ์ — ปรับนโยบายได้ที่ HR Settings · วันมีบันทึก = มีเวลาเข้าและ/หรือออกที่ใช้จริง (รวมหลังแก้ไขที่อนุมัติแล้ว)
            </CardDescription>
            <div className="pt-2 max-w-md">
              <Input
                placeholder="ค้นหาชื่อพนักงาน…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="ค้นหาพนักงาน"
              />
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            {(punchesLoading || staffLoading) && (
              <div className="flex items-center gap-2 text-muted-foreground text-sm py-8">
                <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดข้อมูล…
              </div>
            )}
            {(punchesError || staffError) && (
              <p className="text-sm text-destructive py-4">
                โหลดไม่สำเร็จ —{' '}
                {String(
                  (punchesError as Error | undefined)?.message
                    || (staffError as Error | undefined)?.message
                    || punchesError
                    || staffError,
                )}
              </p>
            )}
            {!punchesLoading && !staffLoading && !punchesError && !staffError && summaryRows.length === 0 && (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {search.trim()
                  ? 'ไม่พบพนักงานออฟฟิศที่ตรงกับคำค้น'
                  : 'ไม่มีพนักงานออฟฟิศ ACTIVE ในทะเบียน — เพิ่มรายชื่อที่เมนูทะเบียนพนักงานออฟฟิศ'}
              </p>
            )}
            {!punchesLoading && !staffLoading && !punchesError && !staffError && summaryRows.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>พนักงาน</TableHead>
                    <TableHead className="text-right">วันทำงานตามปฏิทิน</TableHead>
                    <TableHead className="text-right">วันที่มีบันทึกเวลา</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summaryRows.map((row) => {
                    const isOpen = !!openRows[row.key];
                    return (
                      <Fragment key={row.key}>
                        <TableRow className="hover:bg-muted/40">
                          <TableCell className="align-top">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0"
                              type="button"
                              onClick={() => toggleOpen(row.key)}
                              aria-expanded={isOpen}
                            >
                              <ChevronDown
                                className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                              />
                            </Button>
                          </TableCell>
                          <TableCell className="font-medium align-top">
                            <div className="flex flex-col gap-0.5">
                              <span>{row.name}</span>
                              <span className="text-[11px] text-muted-foreground font-normal font-mono">
                                {row.staffCode || row.staffId} · พนักงานออฟฟิศ
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right align-top tabular-nums">
                            {row.workingDaysInCalendarMonth}
                          </TableCell>
                          <TableCell className="text-right align-top tabular-nums">{row.daysRecorded}</TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow className="bg-muted/10 hover:bg-muted/10 border-b">
                            <TableCell colSpan={4} className="p-3">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="w-[140px]">วันที่</TableHead>
                                    <TableHead>ประเภทวัน</TableHead>
                                    <TableHead className="whitespace-nowrap">เข้างาน</TableHead>
                                    <TableHead className="whitespace-nowrap">ออกงาน</TableHead>
                                    <TableHead className="w-[120px] text-right">จัดการ</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {row.dayRows.map((d) => {
                                    const weekendOrHol =
                                      isBangkokWeeklyRestDayYmd(d.ymd, weeklyRestPattern) || isThaiPublicHolidayYmd(d.ymd);
                                    return (
                                      <TableRow
                                        key={d.ymd}
                                        className={cn(
                                          weekendOrHol && 'bg-muted/40',
                                          d.override && 'border-l-2 border-l-primary',
                                        )}
                                      >
                                        <TableCell className="font-mono text-sm whitespace-nowrap align-top">
                                          {formatDateThaiBE(d.ymd)}
                                        </TableCell>
                                        <TableCell className="align-top">{dayKindBadges(d.ymd, weeklyRestPattern)}</TableCell>
                                        <TableCell className="font-mono text-sm align-top">
                                          {d.effectiveInMs != null ? (
                                            <span>
                                              {formatBangkokHmFromUtcMs(d.effectiveInMs)}
                                              {d.override ? (
                                                <Badge variant="secondary" className="ml-2 text-[9px]">
                                                  หลังแก้
                                                </Badge>
                                              ) : null}
                                            </span>
                                          ) : (
                                            <span className="text-muted-foreground">—</span>
                                          )}
                                        </TableCell>
                                        <TableCell className="font-mono text-sm align-top">
                                          {d.effectiveOutMs != null ? (
                                            <span>
                                              {formatBangkokHmFromUtcMs(d.effectiveOutMs)}
                                              {d.override ? (
                                                <Badge variant="secondary" className="ml-2 text-[9px]">
                                                  หลังแก้
                                                </Badge>
                                              ) : null}
                                            </span>
                                          ) : (
                                            <span className="text-muted-foreground">—</span>
                                          )}
                                        </TableCell>
                                        <TableCell className="text-right align-top">
                                          {canRequestCorrection ? (
                                            <Button
                                              type="button"
                                              variant="outline"
                                              size="sm"
                                              className="h-8"
                                              onClick={() =>
                                                openCorrection({
                                                  subjectType: 'office_staff',
                                                  subjectId: row.staffId,
                                                  subjectNameSnapshot: row.name,
                                                  workDateYmd: d.ymd,
                                                  previousInAtMs: d.effectiveInMs,
                                                  previousOutAtMs: d.effectiveOutMs,
                                                  previousInPunchId: d.rawFirstIn?.id ?? null,
                                                  previousOutPunchId: d.rawLastOut?.id ?? null,
                                                })
                                              }
                                            >
                                              ขอแก้ไข
                                            </Button>
                                          ) : (
                                            <span className="text-[11px] text-muted-foreground">—</span>
                                          )}
                                        </TableCell>
                                      </TableRow>
                                    );
                                  })}
                                </TableBody>
                              </Table>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button variant="secondary" asChild>
            <Link href="/hr/attendance/kiosk">ไปหน้า Kiosk (QR)</Link>
          </Button>
        </div>
      </div>

      {corrCtx && currentUser ? (
        <AttendanceCorrectionRequestDialog
          open={corrOpen}
          onOpenChange={(v) => {
            setCorrOpen(v);
            if (!v) setCorrCtx(null);
          }}
          firestore={firestore}
          currentUser={currentUser as User}
          subjectType={corrCtx.subjectType}
          subjectId={corrCtx.subjectId}
          subjectNameSnapshot={corrCtx.subjectNameSnapshot}
          payrollMonth={payrollMonth}
          workDateYmd={corrCtx.workDateYmd}
          previousInAtMs={corrCtx.previousInAtMs}
          previousOutAtMs={corrCtx.previousOutAtMs}
          previousInPunchId={corrCtx.previousInPunchId}
          previousOutPunchId={corrCtx.previousOutPunchId}
        />
      ) : null}
    </AppShell>
  );
}
