'use client';

import { Fragment, useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  collection,
  query,
  where,
  orderBy,
  doc,
  limit,
  Firestore,
} from 'firebase/firestore';
import { addMonths, format, startOfMonth } from 'date-fns';
import { AppShell } from '@/components/layout/app-shell';
import { useAppUser } from '@/hooks/use-app-user';
import { useFirestore, useCollection, useDoc, useMemoFirebase } from '@/firebase';
import { canAccessHrAttendanceKioskPages } from '@/lib/navigation/nav-access';
import {
  canSubmitAttendanceCorrectionRequest,
  canAdminResetAttendanceDay,
} from '@/lib/permissions';
import type { User, OfficeStaff } from '@/lib/types';
import {
  ATTENDANCE_PUNCHES_COLLECTION,
  ATTENDANCE_DAY_OVERRIDES_COLLECTION,
  ATTENDANCE_OVERTIME_REQUESTS_COLLECTION,
  ATTENDANCE_CORRECTION_REQUESTS_COLLECTION,
} from '@/lib/attendance/constants';
import type {
  AttendancePunchDoc,
  AttendanceSubjectType,
  AttendanceDayOverrideDoc,
  AttendanceOvertimeRequestDoc,
  AttendanceCorrectionRequestDoc,
} from '@/lib/attendance/types';
import {
  attendanceOvertimeHoursForRequest,
  formatAttendanceOvertimeHours,
  latestOvertimeRequestBySubjectDay,
  sumShownOvertimeHoursForSubjectDays,
} from '@/lib/attendance/overtime-display';
import {
  attendanceDayPendingNotes,
  latestCorrectionRequestBySubjectDay,
} from '@/lib/attendance/pending-request-display';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  ArrowLeft,
  ChevronDown,
  Loader2,
  Pencil,
  Printer,
  RotateCcw,
  Timer,
} from 'lucide-react';
import { formatDateThaiBE, formatPayrollYearMonthThaiBE } from '@/lib/date-thai';
import {
  buildOfficeAttendanceMonthlySummaryListPrintHtml,
  capOfficeAttendanceMonthlyStaffPrintRows,
  describeOfficeAttendanceMonthlySummaryPrintFilters,
  type OfficeAttendanceMonthlyStaffPrintRow,
} from '@/lib/documents/office-attendance-monthly-summary-list-print';
import { AttendanceGridLineCell } from '@/components/attendance/attendance-grid-line-cell';
import {
  buildAttendanceDayDetailHref,
} from '@/lib/attendance/attendance-hr-navigation';
import { buildStaffAttendanceGridCellsByYmd } from '@/lib/attendance/office-attendance-grid-day-cell';
import { OFFICE_LEAVE_REQUESTS_COLLECTION } from '@/lib/leaves/policy';
import type { OfficeLeaveRequestDoc } from '@/lib/leaves/types';
import { openStandardPrintWindow } from '@/lib/documents/standard-document-print';
import { cn } from '@/lib/utils';
import {
  enumerateYmDsForMonth,
  bangkokIsoWeekdayFromYmd,
  isBangkokWeeklyRestDayYmd,
  weeklyRestPatternLabelTh,
  type WeeklyRestPatternForCalendar,
} from '@/lib/attendance/bangkok-calendar';
import {
  attendanceInCorrectedByOverride,
  attendanceOutCorrectedByOverride,
  buildAttendanceDayRows,
  countDaysWithEffectiveRecord,
  punchesGroupedByBangkokYmd,
} from '@/lib/attendance/correction-merge';
import { adminResetAttendanceDay } from '@/lib/attendance/admin-day-reset';
import { AttendanceCorrectionRequestDialog } from '@/components/attendance/attendance-correction-request-dialog';
import {
  resolveFourScanSlotMs,
  type AttendanceFourSlotTimesMs,
} from '@/lib/attendance/attendance-four-slot-times';
import { AttendanceOvertimeRequestDialog } from '@/components/attendance/attendance-overtime-request-dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import {
  HR_STATUTORY_POLICY_MONTHLY_WORK_ID,
  HR_WORKER_GLOBAL_LABOR_POLICY_ID,
} from '@/lib/payroll/d8/hr-statutory-policy-ids';
import {
  hrSettingsCalendarHolidayLabelForYmd,
  isHrSettingsCalendarHolidayYmd,
  workerGlobalLaborContextFromPolicy,
} from '@/lib/payroll/worker-global-labor-policy';
import { monthlyWorkNormFromPolicyRecord } from '@/lib/payroll/office-payroll-period-deductions';
import type { PayrollPolicyRecord } from '@/lib/types';

/** พนักงานออฟฟิศที่อยู่ในทะเบียนปัจจุบัน — ไม่รวมผู้บริหาร (แยกทะเบียน/งวด) */
function isOfficeStaffOnActiveRegistry(s: OfficeStaff): boolean {
  return s.status === 'ACTIVE' && s.payrollBand !== 'EXECUTIVE';
}

type SubjectKey = `${AttendanceSubjectType}:${string}`;

function subjectKey(subjectType: AttendanceSubjectType, subjectId: string): SubjectKey {
  return `${subjectType}:${subjectId}`;
}

function parsePayrollYmToMonthStart(ym: string): Date {
  const [y, m] = ym.split('-').map(Number);
  return startOfMonth(new Date(y, (m || 1) - 1, 1));
}

function buildMonthSelectOptions(count = 36): string[] {
  const opts: string[] = [];
  let d = startOfMonth(new Date());
  for (let i = 0; i < count; i++) {
    opts.push(format(d, 'yyyy-MM'));
    d = addMonths(d, -1);
  }
  return opts;
}

const MONTH_SELECT_OPTIONS = buildMonthSelectOptions();

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

function dayTypeTags(
  ymd: string,
  weeklyRestPattern: WeeklyRestPatternForCalendar,
  calendarHolidayLabel: string | null,
): string[] {
  const tags: string[] = [];
  if (calendarHolidayLabel) tags.push(calendarHolidayLabel);
  const iso = bangkokIsoWeekdayFromYmd(ymd);
  /** ขึ้นป้าย "เสาร์/อาทิตย์" เฉพาะเมื่อตรงกับนโยบายวันหยุดประจำสัปดาห์ที่ตั้งไว้ใน HR Settings */
  if (iso === 7 && (weeklyRestPattern === 'sat_sun' || weeklyRestPattern === 'sunday_only')) {
    tags.push('วันอาทิตย์');
  } else if (iso === 6 && weeklyRestPattern === 'sat_sun') {
    tags.push('วันเสาร์');
  }
  return tags;
}

function leaveOverlapsPayrollMonth(r: OfficeLeaveRequestDoc, payrollMonth: string): boolean {
  const monthStart = `${payrollMonth}-01`;
  const [y, m] = payrollMonth.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const monthEnd = `${payrollMonth}-${String(lastDay).padStart(2, '0')}`;
  const start = r.startDate.slice(0, 10);
  const end = r.endDate.slice(0, 10);
  return start <= monthEnd && end >= monthStart;
}

function dayKindBadges(
  ymd: string,
  weeklyRestPattern: WeeklyRestPatternForCalendar,
  calendarHolidayLabel: string | null,
) {
  const tags = dayTypeTags(ymd, weeklyRestPattern, calendarHolidayLabel);
  if (tags.length === 0) return <span className="text-muted-foreground text-xs">วันทำงาน</span>;
  return (
    <div className="flex flex-wrap gap-1 justify-center">
      {tags.map((t) => (
        <Badge key={t} variant="outline" className="text-[10px] font-normal">
          {t}
        </Badge>
      ))}
    </div>
  );
}

export function HrAttendanceManagePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const [viewMonth, setViewMonth] = useState(() => {
    const m = searchParams.get('month');
    if (m && /^\d{4}-\d{2}$/.test(m)) {
      const [y, mo] = m.split('-').map(Number);
      return startOfMonth(new Date(y, (mo || 1) - 1, 1));
    }
    return startOfMonth(new Date());
  });
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);

  const [corrOpen, setCorrOpen] = useState(false);
  const [corrCtx, setCorrCtx] = useState<{
    subjectType: AttendanceSubjectType;
    subjectId: string;
    subjectNameSnapshot: string;
    workDateYmd: string;
    previousSlots: AttendanceFourSlotTimesMs;
    previousInPunchId: string | null;
    previousOutPunchId: string | null;
  } | null>(null);

  const [otOpen, setOtOpen] = useState(false);
  const [otCtx, setOtCtx] = useState<{
    subjectType: AttendanceSubjectType;
    subjectId: string;
    subjectNameSnapshot: string;
    workDateYmd: string;
    previousOtHours: number | null;
    pendingRequestId: string | null;
    pendingStartHm?: string | null;
    pendingEndHm?: string | null;
  } | null>(null);

  const [resetOpen, setResetOpen] = useState(false);
  const [resetCtx, setResetCtx] = useState<{
    staffId: string;
    staffName: string;
    workDateYmd: string;
  } | null>(null);
  const [resetBusyKey, setResetBusyKey] = useState<string | null>(null);

  const range = useMemo(() => {
    const startMs = viewMonth.getTime();
    const endExclusiveMs = addMonths(viewMonth, 1).getTime();
    return { startMs, endExclusiveMs };
  }, [viewMonth]);

  const payrollMonth = format(viewMonth, 'yyyy-MM');
  const ymDs = useMemo(() => enumerateYmDsForMonth(viewMonth), [viewMonth]);
  const todayBangkokYmd = useMemo(
    () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }),
    [],
  );

  /** อ่าน HR Settings — วันหยุดประจำสัปดาห์ + วันหยุดในปฏิทิน (แหล่งความจริงเดียวกับ HR Settings) */
  const workerGlobalLaborRef = useMemoFirebase(
    () => (firestore ? doc(firestore as Firestore, 'payroll_policies', HR_WORKER_GLOBAL_LABOR_POLICY_ID) : null),
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
    () => (firestore ? doc(firestore as Firestore, 'payroll_policies', HR_STATUTORY_POLICY_MONTHLY_WORK_ID) : null),
    [firestore],
  );
  const { data: monthlyWorkNormPolicy } = useDoc<PayrollPolicyRecord>(monthlyWorkNormPolicyRef as any);
  const monthlyWorkNorm = useMemo(
    () => monthlyWorkNormFromPolicyRecord(monthlyWorkNormPolicy ?? null),
    [monthlyWorkNormPolicy],
  );

  /** วันทำงาน = วันที่ไม่ใช่วันหยุดประจำสัปดาห์ (ตามนโยบาย) และไม่ใช่วันหยุดในปฏิทิน HR Settings */
  const workingDaysInCalendarMonth = useMemo(() => {
    let n = 0;
    for (const ymd of ymDs) {
      if (isBangkokWeeklyRestDayYmd(ymd, weeklyRestPattern)) continue;
      if (isHrSettingsCalendarHolidayYmd(ymd, calendarHolidays)) continue;
      n++;
    }
    return n;
  }, [ymDs, weeklyRestPattern, calendarHolidays]);

  const canUse = useMemo(
    () => !!currentUser && canAccessHrAttendanceKioskPages(currentUser as User, null),
    [currentUser],
  );

  const canRequestCorrection = useMemo(
    () => canSubmitAttendanceCorrectionRequest(currentUser),
    [currentUser],
  );

  const canAdminReset = useMemo(() => canAdminResetAttendanceDay(currentUser), [currentUser]);

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

  const overtimeRequestsQuery = useMemoFirebase(() => {
    if (!firestore || !canUse) return null;
    return query(
      collection(firestore as Firestore, ATTENDANCE_OVERTIME_REQUESTS_COLLECTION),
      where('payrollMonth', '==', payrollMonth),
    );
  }, [firestore, canUse, payrollMonth]);

  const { data: overtimeRequestRows } = useCollection<AttendanceOvertimeRequestDoc>(
    overtimeRequestsQuery as any,
  );

  const overtimeBySubjectDay = useMemo(
    () => latestOvertimeRequestBySubjectDay(overtimeRequestRows ?? []),
    [overtimeRequestRows],
  );

  const correctionRequestsQuery = useMemoFirebase(() => {
    if (!firestore || !canUse) return null;
    return query(
      collection(firestore as Firestore, ATTENDANCE_CORRECTION_REQUESTS_COLLECTION),
      where('payrollMonth', '==', payrollMonth),
    );
  }, [firestore, canUse, payrollMonth]);

  const { data: correctionRequestRows } = useCollection<AttendanceCorrectionRequestDoc>(
    correctionRequestsQuery as any,
  );

  const correctionBySubjectDay = useMemo(
    () => latestCorrectionRequestBySubjectDay(correctionRequestRows ?? []),
    [correctionRequestRows],
  );

  const leaveRequestsQuery = useMemoFirebase(() => {
    if (!firestore || !canUse) return null;
    const ceYear = Number(payrollMonth.slice(0, 4));
    if (!Number.isFinite(ceYear)) return null;
    return query(
      collection(firestore as Firestore, OFFICE_LEAVE_REQUESTS_COLLECTION),
      where('year', '==', ceYear),
      limit(2000),
    );
  }, [firestore, canUse, payrollMonth]);

  const { data: leaveRequestRows } = useCollection<OfficeLeaveRequestDoc>(leaveRequestsQuery as any);

  const approvedLeavesInMonth = useMemo(() => {
    return (leaveRequestRows ?? []).filter(
      (r) => r.status === 'APPROVED' && leaveOverlapsPayrollMonth(r, payrollMonth),
    );
  }, [leaveRequestRows, payrollMonth]);

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

  const summaryRowsAll = useMemo(() => {
    const entries = activeOfficeStaff.map((staff) => {
      const key = subjectKey('office_staff', staff.id);
      const punches = (grouped.get(key) ?? []) as (AttendancePunchDoc & { id: string })[];
      const name = staff.fullName?.trim() || punches[0]?.subjectNameSnapshot?.trim() || staff.id;
      const subjectOverrides = overridesBySubject.get(key) ?? [];
      const dayRows = buildAttendanceDayRows(ymDs, punches as AttendancePunchDoc[], subjectOverrides);
      const daysRecorded = countDaysWithEffectiveRecord(dayRows);
      const approvedOtHoursTotal = sumShownOvertimeHoursForSubjectDays(
        key,
        ymDs,
        overtimeBySubjectDay,
      );
      const gridCellsByYmd = buildStaffAttendanceGridCellsByYmd({
        staff,
        punches: punches as AttendancePunchDoc[],
        dayRows,
        approvedLeaves: approvedLeavesInMonth,
        weeklyRestPattern,
        calendarHolidays,
        todayBangkokYmd,
        monthlyWorkNorm,
      });
      return {
        key,
        staff,
        staffId: staff.id,
        staffCode: staff.staffCode,
        name,
        punches,
        dayRows,
        gridCellsByYmd,
        daysRecorded,
        workingDaysInCalendarMonth,
        approvedOtHoursTotal,
      };
    });
    entries.sort((a, b) => a.name.localeCompare(b.name, 'th'));
    return entries;
  }, [
    activeOfficeStaff,
    grouped,
    ymDs,
    overridesBySubject,
    workingDaysInCalendarMonth,
    overtimeBySubjectDay,
    approvedLeavesInMonth,
    weeklyRestPattern,
    calendarHolidays,
    todayBangkokYmd,
    monthlyWorkNorm,
  ]);

  const summaryRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return summaryRowsAll;
    return summaryRowsAll.filter(
      (r) =>
        r.name.toLowerCase().includes(q)
        || r.staffCode.toLowerCase().includes(q)
        || r.staffId.toLowerCase().includes(q),
    );
  }, [summaryRowsAll, search]);

  const openStaffFromUrl = searchParams.get('openStaff')?.trim() ?? '';

  const goToDayDetail = useCallback(
    (staffId: string, ymd: string) => {
      router.push(
        buildAttendanceDayDetailHref({
          staffId,
          ymd,
          month: payrollMonth,
          q: search,
          openStaff: staffId,
        }),
      );
    },
    [router, payrollMonth, search],
  );

  const mapAttendanceStaffToPrintRow = useCallback(
    (row: (typeof summaryRowsAll)[number]): OfficeAttendanceMonthlyStaffPrintRow => ({
      staffName: row.name,
      staffCode: row.staffCode || row.staffId,
      cellsByYmd: row.gridCellsByYmd,
    }),
    [],
  );

  const runAttendanceSummaryPrint = useCallback(
    async (scope: 'filtered' | 'all') => {
      const source = scope === 'filtered' ? summaryRows : summaryRowsAll;
      if (source.length === 0) {
        toast({
          variant: 'destructive',
          title: 'ไม่มีรายการให้พิมพ์',
          description:
            scope === 'filtered'
              ? 'ไม่พบพนักงานตามคำค้น — ล้างช่องค้นหาหรือพิมพ์ทั้งหมด'
              : 'ไม่มีพนักงานออฟฟิศ ACTIVE ในทะเบียน',
        });
        return;
      }

      setPrintBusy(true);
      try {
        const printRows = source.map(mapAttendanceStaffToPrintRow);
        const { rows: capped, truncated } = capOfficeAttendanceMonthlyStaffPrintRows(printRows);
        const generatedAt = new Date().toLocaleString('th-TH', {
          dateStyle: 'medium',
          timeStyle: 'short',
        });
        const filterLines =
          scope === 'filtered'
            ? describeOfficeAttendanceMonthlySummaryPrintFilters({
                payrollMonth,
                searchQuery: search,
              })
            : describeOfficeAttendanceMonthlySummaryPrintFilters({ payrollMonth });
        const scopeTitle =
          scope === 'filtered' ? 'พิมพ์ตามตัวกรองปัจจุบัน' : 'พิมพ์ทั้งหมด (ไม่ใช้คำค้นหา)';

        const body = buildOfficeAttendanceMonthlySummaryListPrintHtml({
          staffRows: capped,
          ymDs,
          scopeTitle,
          filterLines,
          payrollMonth,
          weeklyRestLabel: weeklyRestPatternLabelTh(weeklyRestPattern),
          calendarHolidayCount: calendarHolidays.length,
          generatedAt,
          printedBy: currentUser?.displayName,
          truncated,
        });

        const okPrint = await openStandardPrintWindow({
          windowTitle: 'Office-Attendance-Monthly-Summary',
          suggestedFileName: `Office-Attendance-${payrollMonth}-${scope === 'filtered' ? 'Filtered' : 'All'}`,
          bodyInnerHtml: body,
          htmlLang: 'th',
        });

        if (!okPrint) {
          toast({
            variant: 'destructive',
            title: 'เปิดหน้าต่างพิมพ์ไม่ได้',
            description: 'กรุณาอนุญาตป๊อปอัปสำหรับเว็บไซต์นี้',
          });
          return;
        }
        setPrintDialogOpen(false);
      } finally {
        setPrintBusy(false);
      }
    },
    [
      summaryRows,
      summaryRowsAll,
      payrollMonth,
      search,
      weeklyRestPattern,
      calendarHolidays.length,
      currentUser?.displayName,
      mapAttendanceStaffToPrintRow,
      ymDs,
      toast,
    ],
  );

  const toggleOpen = (key: string) => {
    setOpenRows((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const openCorrection = (ctx: NonNullable<typeof corrCtx>) => {
    setCorrCtx(ctx);
    setCorrOpen(true);
  };

  const openOvertimeRequest = (ctx: NonNullable<typeof otCtx>) => {
    setOtCtx(ctx);
    setOtOpen(true);
  };

  const openResetConfirm = (ctx: NonNullable<typeof resetCtx>) => {
    setResetCtx(ctx);
    setResetOpen(true);
  };

  const handleConfirmReset = async () => {
    if (!firestore || !currentUser || !resetCtx || !canAdminReset) return;
    const busyKey = `${resetCtx.staffId}:${resetCtx.workDateYmd}`;
    setResetBusyKey(busyKey);
    try {
      await adminResetAttendanceDay({
        firestore: firestore as Firestore,
        currentUser: currentUser as User,
        subjectType: 'office_staff',
        subjectId: resetCtx.staffId,
        payrollMonth,
        workDateYmd: resetCtx.workDateYmd,
      });
      toast({
        title: 'ล้างเวลาแล้ว',
        description: `${resetCtx.staffName} · ${formatDateThaiBE(resetCtx.workDateYmd)} — แสดงเป็น — ในสรุปและ payroll`,
      });
      setResetOpen(false);
      setResetCtx(null);
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'ล้างเวลาไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setResetBusyKey(null);
    }
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

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="w-full space-y-6">
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

        <Card>
          <CardHeader className="border-b bg-muted/20">
            <CardTitle className="text-lg">สรุปรายเดือน</CardTitle>
            <CardDescription>
              วันทำงานตามปฏิทิน = ทุกวันยกเว้น{' '}
              <span className="font-semibold text-foreground">วันหยุดประจำสัปดาห์ ({weeklyRestPatternLabelTh(weeklyRestPattern)})</span>
              {' '}และวันหยุดในปฏิทิน HR Settings ({calendarHolidays.length} วัน) — ปรับได้ที่ HR Settings · วันมีบันทึก = มีเวลาเข้าและ/หรือออกที่ใช้จริง (รวมหลังแก้ไขที่อนุมัติแล้ว)
            </CardDescription>
            <div className="grid gap-3 pt-2 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
              <Input
                placeholder="ค้นหาชื่อพนักงาน…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="ค้นหาพนักงาน"
                className="h-10 w-full min-w-0 bg-background"
              />
              <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,12rem)_auto] sm:items-center">
                <Select
                  value={payrollMonth}
                  onValueChange={(v) => setViewMonth(parsePayrollYmToMonthStart(v))}
                >
                  <SelectTrigger
                    className="h-10 w-full min-w-0 bg-background"
                    aria-label="กรองตามเดือน"
                  >
                    <SelectValue placeholder="เลือกเดือน" />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTH_SELECT_OPTIONS.map((ym) => (
                      <SelectItem key={ym} value={ym}>
                        {formatPayrollYearMonthThaiBE(ym)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 w-full gap-2 whitespace-nowrap sm:w-auto"
                  disabled={punchesLoading || staffLoading || printBusy || summaryRowsAll.length === 0}
                  onClick={() => setPrintDialogOpen(true)}
                >
                  <Printer className="h-4 w-4 shrink-0" />
                  <span>พิมพ์รายการ</span>
                </Button>
              </div>
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
              <Table className="w-full">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>พนักงาน</TableHead>
                    <TableHead className="text-right">วันทำงานตามปฏิทิน</TableHead>
                    <TableHead className="text-right">วันที่มีบันทึกเวลา</TableHead>
                    <TableHead className="text-right whitespace-nowrap">ชม. OT</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summaryRows.map((row) => {
                    const isOpen = !!openRows[row.key] || row.staffId === openStaffFromUrl;
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
                          <TableCell className="text-right align-top tabular-nums font-mono">
                            {row.approvedOtHoursTotal > 0
                              ? formatAttendanceOvertimeHours(row.approvedOtHoursTotal)
                              : '—'}
                          </TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow className="bg-muted/10 hover:bg-muted/10 border-b">
                            <TableCell colSpan={5} className="p-2">
                              <TooltipProvider delayDuration={300}>
                              <Table className="table-fixed w-full text-[13px]">
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="h-9 w-[8%] px-2 text-center text-xs">วันที่</TableHead>
                                    <TableHead className="h-9 w-[14%] px-2 text-center text-xs">ประเภทวัน</TableHead>
                                    <TableHead className="h-9 w-[7%] whitespace-nowrap px-1 text-center text-[10px]">เข้าเช้า</TableHead>
                                    <TableHead className="h-9 w-[7%] whitespace-nowrap px-1 text-center text-[10px]">ออกเที่ยง</TableHead>
                                    <TableHead className="h-9 w-[7%] whitespace-nowrap px-1 text-center text-[10px]">เข้าบ่าย</TableHead>
                                    <TableHead className="h-9 w-[7%] whitespace-nowrap px-1 text-center text-[10px]">ออกเย็น</TableHead>
                                    <TableHead className="h-9 w-[8%] whitespace-nowrap px-2 text-center text-xs">ชม. OT</TableHead>
                                    <TableHead className="h-9 w-[10%] px-2 text-center text-xs">จัดการ</TableHead>
                                    <TableHead className="h-9 w-[16%] px-2 text-center text-xs">หมายเหตุ</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {row.dayRows.map((d) => {
                                    const calendarHolidayLabel = hrSettingsCalendarHolidayLabelForYmd(
                                      d.ymd,
                                      calendarHolidays,
                                    );
                                    const weekendOrHol =
                                      isBangkokWeeklyRestDayYmd(d.ymd, weeklyRestPattern)
                                      || isHrSettingsCalendarHolidayYmd(d.ymd, calendarHolidays);
                                    const hasEffectiveTime = d.effectiveInMs != null || d.effectiveOutMs != null;
                                    const inCorrectedBadge = attendanceInCorrectedByOverride(d);
                                    const outCorrectedBadge = attendanceOutCorrectedByOverride(d);
                                    const resetKey = `${row.staffId}:${d.ymd}`;
                                    const resetBusy = resetBusyKey === resetKey;
                                    const dayKey = `${row.key}:${d.ymd}`;
                                    const otDisplay = attendanceOvertimeHoursForRequest(
                                      overtimeBySubjectDay.get(dayKey),
                                    );
                                    const pendingNotes = attendanceDayPendingNotes({
                                      correction: correctionBySubjectDay.get(dayKey),
                                      overtime: overtimeBySubjectDay.get(dayKey),
                                    });
                                    const gridCell = row.gridCellsByYmd[d.ymd];
                                    return (
                                      <TableRow
                                        key={d.ymd}
                                        className={cn(
                                          'cursor-pointer hover:bg-muted/60',
                                          weekendOrHol && 'bg-muted/40',
                                          d.override && 'border-l-2 border-l-primary',
                                        )}
                                        onClick={() => goToDayDetail(row.staffId, d.ymd)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            goToDayDetail(row.staffId, d.ymd);
                                          }
                                        }}
                                        tabIndex={0}
                                        role="button"
                                        aria-label={`ดูรายละเอียด ${formatDateThaiBE(d.ymd)}`}
                                      >
                                        <TableCell className="p-2 font-mono whitespace-nowrap text-center align-middle">
                                          {formatDateThaiBE(d.ymd)}
                                        </TableCell>
                                        <TableCell className="p-2 text-center align-middle">
                                          {dayKindBadges(d.ymd, weeklyRestPattern, calendarHolidayLabel)}
                                        </TableCell>
                                        <TableCell className="p-1 font-mono text-center align-middle text-xs">
                                          {gridCell ? (
                                            <AttendanceGridLineCell
                                              line={gridCell.morningIn}
                                              showCorrectedBadge={
                                                inCorrectedBadge && gridCell.morningIn.tone === 'time'
                                              }
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
                                              showCorrectedBadge={
                                                outCorrectedBadge && gridCell.afternoonOut.tone === 'time'
                                              }
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
                                        <TableCell
                                          className="p-2 text-center align-middle"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          {canRequestCorrection || canAdminReset ? (
                                              <div className="mx-auto inline-flex flex-row items-center justify-center gap-0.5">
                                                {canRequestCorrection ? (
                                                  <>
                                                    <Tooltip>
                                                      <TooltipTrigger asChild>
                                                        <Button
                                                          type="button"
                                                          variant="outline"
                                                          size="icon"
                                                          className="h-7 w-7 shrink-0"
                                                          onClick={(e) => {
                                                            e.stopPropagation();
                                                            openCorrection({
                                                              subjectType: 'office_staff',
                                                              subjectId: row.staffId,
                                                              subjectNameSnapshot: row.name,
                                                              workDateYmd: d.ymd,
                                                              previousSlots: resolveFourScanSlotMs({
                                                                dayRow: d,
                                                                dayPunches:
                                                                  punchesGroupedByBangkokYmd(row.punches).get(d.ymd)
                                                                  ?? [],
                                                                monthlyWorkNorm,
                                                              }),
                                                              previousInPunchId: d.rawFirstIn?.id ?? null,
                                                              previousOutPunchId: d.rawLastOut?.id ?? null,
                                                            });
                                                          }}
                                                        >
                                                          <Pencil className="h-3 w-3" />
                                                          <span className="sr-only">ขอแก้ไขเวลา</span>
                                                        </Button>
                                                      </TooltipTrigger>
                                                      <TooltipContent side="top">
                                                        <p>ขอแก้ไขเวลา</p>
                                                      </TooltipContent>
                                                    </Tooltip>
                                                    <Tooltip>
                                                      <TooltipTrigger asChild>
                                                        <Button
                                                          type="button"
                                                          variant="secondary"
                                                          size="icon"
                                                          className="h-7 w-7 shrink-0"
                                                          onClick={(e) => {
                                                            e.stopPropagation();
                                                            openOvertimeRequest({
                                                              subjectType: 'office_staff',
                                                              subjectId: row.staffId,
                                                              subjectNameSnapshot: row.name,
                                                              workDateYmd: d.ymd,
                                                              previousOtHours: otDisplay.hours,
                                                              pendingRequestId:
                                                                otDisplay.status === 'PENDING_MANAGER_APPROVAL'
                                                                  ? (overtimeBySubjectDay.get(dayKey)?.id ?? null)
                                                                  : null,
                                                              pendingStartHm:
                                                                otDisplay.status === 'PENDING_MANAGER_APPROVAL'
                                                                  ? (overtimeBySubjectDay.get(dayKey)?.requestedOtStartHm ??
                                                                    null)
                                                                  : null,
                                                              pendingEndHm:
                                                                otDisplay.status === 'PENDING_MANAGER_APPROVAL'
                                                                  ? (overtimeBySubjectDay.get(dayKey)?.requestedOtEndHm ??
                                                                    null)
                                                                  : null,
                                                            });
                                                          }}
                                                        >
                                                          <Timer className="h-3 w-3" />
                                                          <span className="sr-only">
                                                            {otDisplay.hours != null ? 'ขอแก้ไข OT' : 'ขอเพิ่ม OT'}
                                                          </span>
                                                        </Button>
                                                      </TooltipTrigger>
                                                      <TooltipContent side="top">
                                                        <p>
                                                          {otDisplay.hours != null ? 'ขอแก้ไข OT' : 'ขอเพิ่ม OT'}
                                                        </p>
                                                      </TooltipContent>
                                                    </Tooltip>
                                                  </>
                                                ) : null}
                                                {canAdminReset && hasEffectiveTime ? (
                                                  <Tooltip>
                                                    <TooltipTrigger asChild>
                                                      <Button
                                                        type="button"
                                                        variant="destructive"
                                                        size="icon"
                                                        className="h-7 w-7 shrink-0"
                                                        disabled={resetBusy}
                                                        onClick={(e) => {
                                                          e.stopPropagation();
                                                          openResetConfirm({
                                                            staffId: row.staffId,
                                                            staffName: row.name,
                                                            workDateYmd: d.ymd,
                                                          });
                                                        }}
                                                      >
                                                        {resetBusy ? (
                                                          <Loader2 className="h-3 w-3 animate-spin" />
                                                        ) : (
                                                          <RotateCcw className="h-3 w-3" />
                                                        )}
                                                        <span className="sr-only">รีเซ็ท ล้างค่าลงเวลา</span>
                                                      </Button>
                                                    </TooltipTrigger>
                                                    <TooltipContent side="top">
                                                      <p>รีเซ็ท ล้างค่าลงเวลา</p>
                                                    </TooltipContent>
                                                  </Tooltip>
                                                ) : null}
                                              </div>
                                          ) : (
                                            <span className="text-[11px] text-muted-foreground">—</span>
                                          )}
                                        </TableCell>
                                        <TableCell className="p-2 text-center align-middle text-xs leading-snug">
                                          {pendingNotes.length > 0 ? (
                                            <div className="flex flex-col items-center gap-1">
                                              {pendingNotes.map((note) => (
                                                <span
                                                  key={note}
                                                  className="text-amber-700 dark:text-amber-400"
                                                >
                                                  {note}
                                                </span>
                                              ))}
                                            </div>
                                          ) : (
                                            <span className="text-muted-foreground">—</span>
                                          )}
                                        </TableCell>
                                      </TableRow>
                                    );
                                  })}
                                </TableBody>
                              </Table>
                              </TooltipProvider>
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

      <Dialog open={printDialogOpen} onOpenChange={setPrintDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>พิมพ์สรุปการลงเวลารายเดือน</DialogTitle>
            <DialogDescription>
              เดือน {formatPayrollYearMonthThaiBE(payrollMonth)} — ตาราง 2 แผ่น (วันที่ 1–15 และ 16–สิ้นเดือน) · บน=เข้า ล่าง=ออก ·
              ไม่มีเวลา: กิจ/ป่วย/พักร้อน หรือ ขาด · ตามคำค้น ({summaryRows.length} คน) หรือทุกพนักงาน (
              {summaryRowsAll.length} คน)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm text-muted-foreground">
            {describeOfficeAttendanceMonthlySummaryPrintFilters({
              payrollMonth,
              searchQuery: search,
            }).map((line) => (
              <p key={line}>· {line}</p>
            ))}
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setPrintDialogOpen(false)} disabled={printBusy}>
              ยกเลิก
            </Button>
            <Button
              variant="outline"
              disabled={printBusy || summaryRowsAll.length === 0}
              onClick={() => void runAttendanceSummaryPrint('all')}
            >
              {printBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              พิมพ์ทั้งหมด
            </Button>
            <Button
              disabled={printBusy || summaryRows.length === 0}
              onClick={() => void runAttendanceSummaryPrint('filtered')}
            >
              {printBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              พิมพ์ตามตัวกรอง
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
          previousSlots={corrCtx.previousSlots}
          previousInPunchId={corrCtx.previousInPunchId}
          previousOutPunchId={corrCtx.previousOutPunchId}
        />
      ) : null}

      {otCtx && currentUser ? (
        <AttendanceOvertimeRequestDialog
          open={otOpen}
          onOpenChange={(v) => {
            setOtOpen(v);
            if (!v) setOtCtx(null);
          }}
          firestore={firestore}
          currentUser={currentUser as User}
          subjectType={otCtx.subjectType}
          subjectId={otCtx.subjectId}
          subjectNameSnapshot={otCtx.subjectNameSnapshot}
          payrollMonth={payrollMonth}
          workDateYmd={otCtx.workDateYmd}
          previousOtHours={otCtx.previousOtHours}
          pendingRequestId={otCtx.pendingRequestId}
          pendingStartHm={otCtx.pendingStartHm}
          pendingEndHm={otCtx.pendingEndHm}
          monthlyWorkNorm={monthlyWorkNorm}
        />
      ) : null}

      <AlertDialog
        open={resetOpen}
        onOpenChange={(v) => {
          setResetOpen(v);
          if (!v) setResetCtx(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ล้างเวลาเข้า-ออก?</AlertDialogTitle>
            <AlertDialogDescription>
              {resetCtx
                ? `${resetCtx.staffName} · ${formatDateThaiBE(resetCtx.workDateYmd)} — เวลาเข้าและออกจะแสดงเป็น — และไม่นับในงวด payroll (บันทึกสแกนเดิมยังอยู่ในระบบ)`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!resetBusyKey}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!!resetBusyKey}
              onClick={(e) => {
                e.preventDefault();
                void handleConfirmReset();
              }}
            >
              {resetBusyKey ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ล้างเวลา'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
