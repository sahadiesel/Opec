'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  LayoutGrid,
  ArrowRight,
  Building2,
  HardHat,
  CalendarDays,
  Coins,
  Clock,
  Grid3X3,
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
} from 'lucide-react';
import {
  User,
  OfficeStaff,
  OfficePayrollRun,
  OfficePayrollLine,
  PayrollPeriod,
  DailyTimesheet,
  PayrollBatch,
  Assignment,
  Wave,
  Worker,
  ExceptionRequest,
  PayrollRunStatus,
} from '@/lib/types';
import { isHRStaff, canView } from '@/lib/permissions';
import { isSystemAdmin } from '@/lib/permission-core';
import { isSimpleAdmin } from '@/lib/simple-tier-model';
import { canViewHrApprovalSubsection } from '@/lib/navigation/nav-access';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where, orderBy, limit } from 'firebase/firestore';
import { formatPayrollYearMonthEnAbbrev, formatStoredDateRangeThaiBE } from '@/lib/date-thai';
import { fetchUniqueOfficeStaffIdsForPayrollMonth } from '@/lib/payroll/office-month-staff-aggregate';
import {
  assignmentInWaveBoard,
  assignmentOverlapsPeriod,
  buildOfficeLineStaffIdSet,
  isActiveOfficePayrollStaff,
  isTimesheetPayrollReady,
  officeMasterDataComplete,
  officeStaffHasBank,
  officeStaffHasSalary,
  officeStaffHasTax,
  workerWaveHasTimesheet,
  workerWavePayrollComplete,
} from '@/lib/hr/payroll-workbench-stats';
import { waveRoundMonthLabel } from '@/lib/constants/timesheet-ui';

const OFFICE_FINANCE_READY: PayrollRunStatus[] = ['HR_APPROVED', 'FINANCE_APPROVED', 'PAID', 'LOCKED'];
const BATCH_FINANCE_READY = ['HR_APPROVED', 'FINANCE_PREPARED', 'PAYMENT_EXPORTED', 'PAID', 'LOCKED'] as const;
const BATCH_INCOMPLETE = ['DRAFT', 'GENERATED', 'HR_REVIEWED'] as const;

function StatLine({ label, value, variant }: { label: string; value: string | number; variant?: 'default' | 'muted' | 'warn' | 'ok' }) {
  const cls =
    variant === 'warn'
      ? 'text-amber-700 dark:text-amber-400'
      : variant === 'ok'
        ? 'text-emerald-700 dark:text-emerald-400'
        : variant === 'muted'
          ? 'text-muted-foreground'
          : '';
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className={variant === 'muted' ? 'text-muted-foreground' : ''}>{label}</span>
      <span className={`font-medium tabular-nums ${cls}`}>{value}</span>
    </div>
  );
}

/**
 * HR-D2: ศูนย์งานจ่ายเงิน — สรุปจาก OfficePayrollRun/Lines, PayrollBatch, DailyTimesheet, mobilizations, office_staff
 */
export default function HrPayrollWorkbenchPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const firestore = useFirestore();

  useEffect(() => {
    const raw = localStorage.getItem('opsflow_user');
    if (raw) setCurrentUser(JSON.parse(raw));
  }, []);

  const canOffice = useMemo(() => canView(currentUser, 'office_payroll') && canView(currentUser, 'office_staff'), [currentUser]);
  const canWorkerPayroll = useMemo(() => canView(currentUser, 'worker_payroll'), [currentUser]);
  const canTimesheets = useMemo(() => canView(currentUser, 'timesheets'), [currentUser]);
  const canOpenPayrollApprovalCenter = useMemo(
    () =>
      currentUser
        ? canViewHrApprovalSubsection(currentUser, isSystemAdmin(currentUser) || isSimpleAdmin(currentUser))
        : false,
    [currentUser]
  );

  const staffQuery = useMemoFirebase(
    () => (firestore && canOffice ? collection(firestore, 'office_staff') : null),
    [firestore, canOffice]
  );
  const { data: officeStaff, isLoading: loadingStaff } = useCollection<OfficeStaff>(staffQuery as any);

  const runsQuery = useMemoFirebase(() => {
    if (!firestore || !canOffice) return null;
    return query(collection(firestore, 'office_payroll_runs'), orderBy('payrollMonth', 'desc'), limit(24));
  }, [firestore, canOffice]);
  const { data: officeRuns, isLoading: loadingRuns } = useCollection<OfficePayrollRun>(runsQuery as any);

  const periodsQuery = useMemoFirebase(() => {
    if (!firestore || !canWorkerPayroll) return null;
    return query(collection(firestore, 'payroll_periods'), orderBy('startDate', 'desc'), limit(40));
  }, [firestore, canWorkerPayroll]);
  const { data: periods, isLoading: loadingPeriods } = useCollection<PayrollPeriod>(periodsQuery as any);

  const batchesQuery = useMemoFirebase(() => {
    if (!firestore || !canWorkerPayroll) return null;
    return query(collection(firestore, 'payroll_batches'), orderBy('createdAt', 'desc'), limit(80));
  }, [firestore, canWorkerPayroll]);
  const { data: payrollBatches, isLoading: loadingBatches } = useCollection<PayrollBatch>(batchesQuery as any);

  const wavesQuery = useMemoFirebase(
    () => (firestore && canTimesheets ? collection(firestore, 'waves') : null),
    [firestore, canTimesheets]
  );
  const { data: waves } = useCollection<Wave>(wavesQuery as any);

  const mobQuery = useMemoFirebase(
    () => (firestore && canTimesheets ? collection(firestore, 'mobilizations') : null),
    [firestore, canTimesheets]
  );
  const { data: assignments } = useCollection<Assignment>(mobQuery as any);

  const workersQuery = useMemoFirebase(
    () => (firestore && canTimesheets ? collection(firestore, 'workers') : null),
    [firestore, canTimesheets]
  );
  const { data: workers } = useCollection<Worker>(workersQuery as any);

  const correctionTsQuery = useMemoFirebase(() => {
    if (!firestore || !canTimesheets) return null;
    return query(collection(firestore, 'daily_timesheets'), where('status', '==', 'CORRECTION_REQUIRED'), limit(15));
  }, [firestore, canTimesheets]);
  const { data: correctionTs } = useCollection<DailyTimesheet>(correctionTsQuery as any);

  const exceptionQuery = useMemoFirebase(() => {
    if (!firestore || !canTimesheets) return null;
    return query(
      collection(firestore, 'exception_requests'),
      where('requestType', '==', 'TIMESHEET_CORRECTION'),
      where('status', '==', 'PENDING'),
      limit(15)
    );
  }, [firestore, canTimesheets]);
  const { data: pendingExceptions } = useCollection<ExceptionRequest>(exceptionQuery as any);

  const currentMonth = useMemo(() => new Date().toISOString().slice(0, 7), []);

  const focusOfficeRun = useMemo(() => {
    if (!officeRuns?.length) return null;
    const forMonth = officeRuns.find((r) => r.payrollMonth === currentMonth);
    return forMonth ?? officeRuns[0];
  }, [officeRuns, currentMonth]);

  const officeLinesQuery = useMemoFirebase(() => {
    if (!firestore || !canOffice || !focusOfficeRun?.id) return null;
    return collection(firestore, 'office_payroll_runs', focusOfficeRun.id, 'lines');
  }, [firestore, canOffice, focusOfficeRun?.id]);
  const { data: officeLines, isLoading: loadingLines } = useCollection<OfficePayrollLine>(officeLinesQuery as any);

  const [monthOfficeLineStaffIds, setMonthOfficeLineStaffIds] = useState<Set<string> | null>(null);
  const [loadingMonthOfficeAgg, setLoadingMonthOfficeAgg] = useState(false);

  useEffect(() => {
    if (!firestore || !canOffice || !focusOfficeRun?.payrollMonth) {
      setMonthOfficeLineStaffIds(null);
      setLoadingMonthOfficeAgg(false);
      return;
    }
    setLoadingMonthOfficeAgg(true);
    let cancelled = false;
    void fetchUniqueOfficeStaffIdsForPayrollMonth(firestore, focusOfficeRun.payrollMonth)
      .then((set) => {
        if (!cancelled) {
          setMonthOfficeLineStaffIds(set);
          setLoadingMonthOfficeAgg(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMonthOfficeLineStaffIds(null);
          setLoadingMonthOfficeAgg(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [firestore, canOffice, focusOfficeRun?.payrollMonth]);

  const focusPeriod = useMemo(() => {
    if (!periods?.length) return null;
    const open = periods.find((p) => p.status === 'OPEN');
    return open ?? periods[0];
  }, [periods]);

  const periodTimesheetsQuery = useMemoFirebase(() => {
    if (!firestore || !canTimesheets || !focusPeriod?.startDate || !focusPeriod?.endDate) return null;
    return query(
      collection(firestore, 'daily_timesheets'),
      where('date', '>=', focusPeriod.startDate),
      where('date', '<=', focusPeriod.endDate)
    );
  }, [firestore, canTimesheets, focusPeriod?.startDate, focusPeriod?.endDate]);
  const { data: periodTimesheets, isLoading: loadingPeriodTs } = useCollection<DailyTimesheet>(periodTimesheetsQuery as any);

  const officeStats = useMemo(() => {
    const staff = (officeStaff || []).filter(isActiveOfficePayrollStaff);
    const total = staff.length;
    const lineIds =
      monthOfficeLineStaffIds != null
        ? monthOfficeLineStaffIds
        : buildOfficeLineStaffIdSet(officeLines ?? undefined);
    const linesResolved = Boolean(
      focusOfficeRun && !loadingLines && !loadingMonthOfficeAgg && monthOfficeLineStaffIds != null
    );
    const missingBank = staff.filter((s) => !officeStaffHasBank(s)).length;
    const missingTax = staff.filter((s) => !officeStaffHasTax(s)).length;
    const missingSalary = staff.filter((s) => !officeStaffHasSalary(s)).length;
    const notInRun = linesResolved
      ? staff.filter((s) => !lineIds.has(s.id)).length
      : focusOfficeRun
        ? undefined
        : total;
    const masterComplete = staff.filter(officeMasterDataComplete).length;
    const readyInRun = linesResolved
      ? staff.filter((s) => officeMasterDataComplete(s) && lineIds.has(s.id)).length
      : undefined;
    const incompleteMaster = total - masterComplete;
    return {
      total,
      missingBank,
      missingTax,
      missingSalary,
      notInRun,
      masterComplete,
      readyInRun,
      incompleteMaster,
      payrollMonth: focusOfficeRun?.payrollMonth,
      runLabel: focusOfficeRun?.payrollRunNo ?? '—',
      monthLabel: formatPayrollYearMonthEnAbbrev(focusOfficeRun?.payrollMonth ?? '', ''),
    };
  }, [
    officeStaff,
    officeLines,
    focusOfficeRun,
    loadingLines,
    monthOfficeLineStaffIds,
    loadingMonthOfficeAgg,
  ]);

  const waveMap = useMemo(() => {
    const m = new Map<string, Wave>();
    (waves || []).forEach((w) => m.set(w.id, w));
    return m;
  }, [waves]);

  const workerStats = useMemo(() => {
    if (!focusPeriod) {
      return {
        periodLabel: '—',
        totalWorkers: 0,
        withTs: 0,
        complete: 0,
        incomplete: 0,
        waves: [] as {
          waveId: string;
          label: string;
          poId: string;
          total: number;
          withTs: number;
          complete: number;
          pending: number;
        }[],
        poMonthRows: [] as { poId: string; yearMonth: string; label: string; workers: number; href: string }[],
      };
    }
    const pStart = focusPeriod.startDate;
    const pEnd = focusPeriod.endDate;
    const tsList = periodTimesheets || [];

    const workersToWaves = new Map<string, Set<string>>();
    const addPair = (workerId: string, waveId: string) => {
      if (!workersToWaves.has(workerId)) workersToWaves.set(workerId, new Set());
      workersToWaves.get(workerId)!.add(waveId);
    };

    (assignments || []).forEach((a) => {
      if (!assignmentInWaveBoard(a) || !assignmentOverlapsPeriod(a, pStart, pEnd)) return;
      addPair(a.workerId, a.waveId);
    });
    tsList.forEach((t) => addPair(t.workerId, t.waveId));

    const totalWorkerCount = workersToWaves.size;

    const byWave = new Map<
      string,
      { workers: Set<string>; withTs: Set<string>; complete: Set<string> }
    >();

    for (const [workerId, waveSet] of workersToWaves) {
      for (const waveId of waveSet) {
        if (!byWave.has(waveId)) {
          byWave.set(waveId, { workers: new Set(), withTs: new Set(), complete: new Set() });
        }
        const bucket = byWave.get(waveId)!;
        bucket.workers.add(workerId);
        if (workerWaveHasTimesheet(tsList, waveId, workerId)) {
          bucket.withTs.add(workerId);
          if (workerWavePayrollComplete(tsList, waveId, workerId)) {
            bucket.complete.add(workerId);
          }
        }
      }
    }

    let withTsAll = 0;
    let completeAll = 0;
    for (const [workerId, waveSet] of workersToWaves) {
      let anyTs = false;
      let everyWaveReady = true;
      for (const waveId of waveSet) {
        const has = workerWaveHasTimesheet(tsList, waveId, workerId);
        if (has) anyTs = true;
        if (!has) {
          everyWaveReady = false;
        } else if (!workerWavePayrollComplete(tsList, waveId, workerId)) {
          everyWaveReady = false;
        }
      }
      if (anyTs) withTsAll += 1;
      if (everyWaveReady && waveSet.size > 0) completeAll += 1;
    }

    const waveRows = [...byWave.entries()]
      .map(([waveId, b]) => {
        const w = waveMap.get(waveId);
        const label = w
          ? `${w.waveCode} · ${[w.projectName, waveRoundMonthLabel(w)].filter(Boolean).join(' · ')}`.trim()
          : waveId.slice(0, 8);
        const total = b.workers.size;
        const withTs = b.withTs.size;
        const complete = b.complete.size;
        const pending = withTs - complete + (total - withTs);
        return { waveId, label, poId: w?.poId ?? '', total, withTs, complete, pending };
      })
      .sort((a, b) => a.label.localeCompare(b.label, 'th'));

    const poMonthRows: { poId: string; yearMonth: string; label: string; workers: number; href: string }[] = [];
    const monthKey = (d: string) => d.slice(0, 7);
    const poMonthWorkerSets = new Map<string, Set<string>>();
    for (const t of tsList) {
      const poId = t.purchaseOrderId;
      if (!poId) continue;
      const ym = monthKey(t.date);
      const k = `${poId}|${ym}`;
      if (!poMonthWorkerSets.has(k)) poMonthWorkerSets.set(k, new Set());
      poMonthWorkerSets.get(k)!.add(t.workerId);
    }
    for (const [k, wset] of poMonthWorkerSets) {
      const [poId, yearMonth] = k.split('|');
      const wv0 = (waves || []).find((w) => w.poId === poId);
      const name = wv0?.projectName || poId.slice(0, 8);
      poMonthRows.push({
        poId,
        yearMonth,
        label: `${name} · ${formatPayrollYearMonthEnAbbrev(yearMonth, yearMonth)}`,
        workers: wset.size,
        href: `/timesheets/po-month?month=${encodeURIComponent(yearMonth)}&highlightPo=${encodeURIComponent(poId)}`,
      });
    }
    poMonthRows.sort((a, b) => (a.yearMonth < b.yearMonth ? 1 : a.yearMonth > b.yearMonth ? -1 : a.label.localeCompare(b.label, 'th')));

    return {
      periodLabel:
        focusPeriod.label ||
        formatStoredDateRangeThaiBE(focusPeriod.startDate, focusPeriod.endDate),
      totalWorkers: totalWorkerCount,
      withTs: withTsAll,
      complete: completeAll,
      incomplete: totalWorkerCount - completeAll,
      waves: waveRows,
      poMonthRows,
    };
  }, [focusPeriod, periodTimesheets, assignments, waveMap, waves]);

  const pendingItems = useMemo(() => {
    const items: { id: string; label: string; href: string; kind: string }[] = [];
    (correctionTs || []).forEach((ts) => {
      const wv = waveMap.get(ts.waveId);
      items.push({
        id: `corr-${ts.id}`,
        label: `Timesheet ต้องแก้: ${ts.workerNameSnapshot} (${ts.date})`,
        href: `/timesheets/daily/${ts.id}`,
        kind: 'timesheet',
      });
      if (wv?.poId) {
        items.push({
          id: `wave-corr-${ts.id}`,
          label: `แก้ timesheet ${wv.waveCode || ts.waveId}`,
          href: `/timesheets/wave-board?poId=${encodeURIComponent(wv.poId)}&waveId=${encodeURIComponent(ts.waveId)}`,
          kind: 'wave',
        });
      }
    });
    (pendingExceptions || []).forEach((ex) => {
      items.push({
        id: `ex-${ex.id}`,
        label: `คำขอแก้ timesheet: ${ex.referenceNo || ex.id}`,
        href: ex.referenceId ? `/timesheets/daily/${ex.referenceId}` : '/timesheets/daily',
        kind: 'exception',
      });
    });
    (payrollBatches || [])
      .filter((b) => (BATCH_INCOMPLETE as readonly string[]).includes(b.status))
      .slice(0, 8)
      .forEach((b) => {
        items.push({
          id: `batch-${b.id}`,
          label: `Payroll batch ยังไม่ครบ: ${b.id} (${b.status})`,
          href: `/payroll/batches/${b.id}`,
          kind: 'batch',
        });
      });
    (officeStaff || [])
      .filter(isActiveOfficePayrollStaff)
      .filter((s) => !officeMasterDataComplete(s))
      .slice(0, 8)
      .forEach((s) => {
        const miss: string[] = [];
        if (!officeStaffHasBank(s)) miss.push('ไม่มีบัญชี');
        if (!officeStaffHasTax(s)) miss.push('ไม่มีเลขภาษี');
        if (!officeStaffHasSalary(s)) miss.push('เงินเดือน');
        items.push({
          id: `staff-${s.id}`,
          label: `พนักงานออฟฟิศ: ${s.fullName} (${miss.join(', ')})`,
          href: `/office-staff/${s.id}`,
          kind: 'office',
        });
      });
    (workers || [])
      .filter((w) => !(w.bankAccountNumber?.trim() && w.bankName?.trim()))
      .slice(0, 6)
      .forEach((w) => {
        items.push({
          id: `worker-bank-${w.id}`,
          label: `แก้ลูกจ้างไม่มีบัญชี: ${w.firstName} ${w.lastName}`,
          href: `/workers/${w.id}`,
          kind: 'worker',
        });
      });

    const unverified = (periodTimesheets || []).filter(
      (t) => t.status !== 'LOCKED' && !isTimesheetPayrollReady(t)
    );
    const sample = unverified.slice(0, 6);
    sample.forEach((ts) => {
      const wv = waveMap.get(ts.waveId);
      items.push({
        id: `unver-${ts.id}`,
        label: `Timesheet ยังไม่พร้อมจ่าย: ${ts.workerNameSnapshot} · ${ts.date}`,
        href: `/timesheets/daily/${ts.id}`,
        kind: 'unverified',
      });
      if (wv?.poId) {
        items.push({
          id: `unver-wave-${ts.id}`,
          label: `ตรวจเวฟ ${wv.waveCode || ts.waveId}`,
          href: `/timesheets/wave-board?poId=${encodeURIComponent(wv.poId)}&waveId=${encodeURIComponent(ts.waveId)}`,
          kind: 'wave',
        });
      }
    });

    const dedup = new Map<string, (typeof items)[0]>();
    items.forEach((it) => {
      if (!dedup.has(it.id)) dedup.set(it.id, it);
    });
    return [...dedup.values()].slice(0, 24);
  }, [
    correctionTs,
    pendingExceptions,
    payrollBatches,
    officeStaff,
    workers,
    periodTimesheets,
    waveMap,
  ]);

  const financeReady = useMemo(() => {
    const officeApproved = (officeRuns || [])
      .filter((r) => OFFICE_FINANCE_READY.includes(r.status) && r.payrollMonth === currentMonth);

    const workerApprovedBase = (payrollBatches || []).filter((b) =>
      (BATCH_FINANCE_READY as readonly string[]).includes(b.status)
    );
    const workerApproved = focusPeriod?.id
      ? workerApprovedBase.filter((b) => b.payrollPeriodId === focusPeriod.id)
      : workerApprovedBase;

    let slipOffice = 0;
    let grossOffice = 0;
    let netOffice = 0;
    officeApproved.forEach((r) => {
      slipOffice += r.staffCount || 0;
      grossOffice += r.grossAmount || 0;
      netOffice += r.netAmount || 0;
    });

    let slipWorker = 0;
    let grossWorker = 0;
    let netWorker = 0;
    workerApproved.forEach((b) => {
      slipWorker += b.totalWorkers || 0;
      grossWorker += b.grossAmount || 0;
      netWorker += b.netAmount || 0;
    });

    return {
      officeApproved,
      workerApproved,
      slipTotal: slipOffice + slipWorker,
      grossTotal: grossOffice + grossWorker,
      netTotal: netOffice + netWorker,
    };
  }, [officeRuns, payrollBatches, currentMonth, focusPeriod?.id]);

  const loadingCore =
    loadingStaff ||
    loadingRuns ||
    loadingLines ||
    loadingPeriods ||
    loadingBatches ||
    loadingMonthOfficeAgg ||
    (focusPeriod && loadingPeriodTs);

  if (!currentUser) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground text-sm">กำลังโหลด…</div>
    );
  }

  if (!isHRStaff(currentUser)) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="mx-auto max-w-lg py-20 text-center text-muted-foreground">ไม่มีสิทธิ์เข้าหน้านี้</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="mx-auto max-w-[1200px] space-y-6 pb-10">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <LayoutGrid className="h-9 w-9 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight text-primary">ศูนย์งานจ่ายเงิน (Payroll Workbench)</h1>
          </div>
          <p className="text-muted-foreground text-lg">
            สรุปงวดปัจจุบัน — พนักงานออฟฟิศ ลูกจ้างตามเวฟ งานค้าง และรายการพร้อมส่งบัญชี (ดึงจากข้อมูลเดิมในระบบ)
          </p>
          {loadingCore && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              กำลังรวมข้อมูล…
            </div>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Block 1 — Office */}
          <Card className="border-primary/15 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">1) Office Payroll</CardTitle>
              </div>
              <CardDescription>
                งวดอ้างอิง: <strong>{officeStats.monthLabel || officeStats.payrollMonth || '—'}</strong>
                {officeStats.monthLabel && officeStats.payrollMonth ? (
                  <span className="text-muted-foreground"> ({officeStats.payrollMonth})</span>
                ) : null}{' '}
                · {officeStats.runLabel}
                {!canOffice && <span className="text-amber-600"> (ไม่มีสิทธิ์ดู office payroll — ตัวเลขอาจว่าง)</span>}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <PayrollScopeTag scope="office" showHint={false} />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-lg border bg-muted/30 p-3 text-center">
                  <div className="text-2xl font-bold tabular-nums">{officeStats.total}</div>
                  <div className="text-[11px] text-muted-foreground">พนักงานในงวด</div>
                </div>
                <div className="rounded-lg border bg-emerald-500/10 p-3 text-center">
                  <div className="text-2xl font-bold tabular-nums text-emerald-800 dark:text-emerald-200">
                    {officeStats.readyInRun ?? '—'}
                  </div>
                  <div className="text-[11px] text-muted-foreground">พร้อมจ่าย (ครบข้อมูล + มีบรรทัดในงวด)</div>
                </div>
                <div className="rounded-lg border bg-amber-500/10 p-3 text-center">
                  <div className="text-2xl font-bold tabular-nums text-amber-900 dark:text-amber-200">{officeStats.incompleteMaster}</div>
                  <div className="text-[11px] text-muted-foreground">ข้อมูลยังไม่ครบ</div>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <div className="text-2xl font-bold tabular-nums">{officeStats.notInRun ?? '—'}</div>
                  <div className="text-[11px] text-muted-foreground">ยังไม่เข้างวด (ไม่มีบรรทัด)</div>
                </div>
              </div>
              <div className="space-y-1.5 rounded-md border bg-muted/20 p-3">
                <p className="text-xs font-semibold text-muted-foreground">รายละเอียดย่อย</p>
                <StatLine label="ไม่มีบัญชีธนาคาร" value={officeStats.missingBank} variant={officeStats.missingBank ? 'warn' : 'ok'} />
                <StatLine label="ไม่มีเลขภาษี" value={officeStats.missingTax} variant={officeStats.missingTax ? 'warn' : 'ok'} />
                <StatLine label="เงินเดือนยังไม่กำหนด (0)" value={officeStats.missingSalary} variant={officeStats.missingSalary ? 'warn' : 'ok'} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" asChild>
                  <Link href="/office-payroll">
                    <CalendarDays className="mr-1.5 h-3.5 w-3.5" /> งวดจ่ายพนักงานออฟฟิศ
                  </Link>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link href="/office-staff">ทะเบียนพนักงานออฟฟิศ</Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Block 2 — Worker */}
          <Card className="border-primary/15 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <HardHat className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">2) Worker Payroll</CardTitle>
              </div>
              <CardDescription>
                รอบลูกจ้าง: <strong>{workerStats.periodLabel}</strong>
                {!focusPeriod && <span> — ยังไม่มีรอบในระบบ</span>}
                {!canWorkerPayroll && <span className="text-amber-600"> (สิทธิ์ worker payroll จำกัด)</span>}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <PayrollScopeTag scope="worker" showHint={false} />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-lg border bg-muted/30 p-3 text-center">
                  <div className="text-2xl font-bold tabular-nums">{workerStats.totalWorkers}</div>
                  <div className="text-[11px] text-muted-foreground">ลูกจ้างในรอบ (จากมอบหมาย + timesheet)</div>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <div className="text-2xl font-bold tabular-nums">{workerStats.withTs}</div>
                  <div className="text-[11px] text-muted-foreground">มี timesheet ในรอบ</div>
                </div>
                <div className="rounded-lg border bg-emerald-500/10 p-3 text-center">
                  <div className="text-2xl font-bold tabular-nums text-emerald-800 dark:text-emerald-200">{workerStats.complete}</div>
                  <div className="text-[11px] text-muted-foreground">ครบพร้อมจ่าย (ทุกแถวในเวฟพร้อม)</div>
                </div>
                <div className="rounded-lg border bg-amber-500/10 p-3 text-center">
                  <div className="text-2xl font-bold tabular-nums text-amber-900 dark:text-amber-200">{workerStats.incomplete}</div>
                  <div className="text-[11px] text-muted-foreground">ยังไม่ครบ</div>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold text-primary">เอกสาร / อ้างอิง: PO + งวด (timesheet รายเดือน)</p>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  ใบจ่าย payroll / ใบกำกับ แนะนำอ้างอิงงวด <strong>PO+เดือน</strong> ที่ manager อนุมัติแล้ว ไม่ใช่ราย wave เท่านั้น
                </p>
                <div className="max-h-32 space-y-1.5 overflow-y-auto rounded-md border border-primary/15 bg-primary/5 p-2 text-sm">
                  {workerStats.poMonthRows.length === 0 ? (
                    <p className="text-muted-foreground text-xs py-2 text-center">ยังไม่มี timesheet ในรอบ — หรือรอ sync</p>
                  ) : (
                    workerStats.poMonthRows.map((r) => (
                      <div key={r.href} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 py-1 last:border-0">
                        <span className="min-w-0 flex-1 truncate text-xs font-medium" title={r.label}>
                          {r.label}
                        </span>
                        <Badge variant="secondary" className="shrink-0 tabular-nums text-[10px]">
                          {r.workers} คนในงวด
                        </Badge>
                        <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs" asChild>
                          <Link href={r.href}>
                            งวด PO
                          </Link>
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">แยกตาม Wave (ราย field)</p>
                <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-md border bg-muted/10 p-2 text-sm">
                  {workerStats.waves.length === 0 ? (
                    <p className="text-muted-foreground text-xs py-2 text-center">ไม่มีข้อมูลเวฟในรอบนี้</p>
                  ) : (
                    workerStats.waves.map((w) => (
                      <div key={w.waveId} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 py-1.5 last:border-0">
                        <span className="min-w-0 flex-1 truncate font-medium">{w.label}</span>
                        <Badge variant="secondary" className="shrink-0 tabular-nums">
                          {w.total} คน · ครบ {w.complete} / ค้าง {w.pending}
                        </Badge>
                        {w.poId ? (
                          <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs" asChild>
                            <Link href={`/timesheets/wave-board?poId=${encodeURIComponent(w.poId)}&waveId=${encodeURIComponent(w.waveId)}`}>
                              ไปเวฟ
                            </Link>
                          </Button>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="default" asChild>
                  <Link href="/timesheets/po-month">
                    <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" /> งวด timesheet ราย PO+เดือน
                  </Link>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link href="/timesheets">
                    <Grid3X3 className="mr-1.5 h-3.5 w-3.5" /> ศูนย์เวลา (PO)
                  </Link>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link href="/timesheets/daily">
                    <Clock className="mr-1.5 h-3.5 w-3.5" /> ตรวจ Timesheet
                  </Link>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link href="/payroll/batches">
                    <Coins className="mr-1.5 h-3.5 w-3.5" /> งวดจ่ายลูกจ้าง (Batches)
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Block 3 — Pending */}
          <Card className="border-amber-500/20 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                <CardTitle className="text-lg">3) งานค้าง / ต้องแก้</CardTitle>
              </div>
              <CardDescription>Timesheet, batch, ข้อมูลพนักงาน, correction — ลิงก์ไปหน้าแก้โดยตรง</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="max-h-56 space-y-1 overflow-y-auto text-sm">
                {pendingItems.length === 0 ? (
                  <p className="text-muted-foreground text-xs py-4 text-center">ไม่มีรายการค้างจากตัวกรองหลัก — ดีมาก</p>
                ) : (
                  pendingItems.map((it) => (
                    <Link
                      key={it.id}
                      href={it.href}
                      className="flex items-start gap-2 rounded-md border border-transparent px-2 py-1.5 hover:border-border hover:bg-muted/40"
                    >
                      <ChevronMini />
                      <span className="leading-snug">{it.label}</span>
                    </Link>
                  ))
                )}
              </div>
              <Separator />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" asChild>
                  <Link href="/hr/payroll-approval">Payroll Approval Center</Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Block 4 — Finance */}
          <Card className="border-emerald-500/20 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                <CardTitle className="text-lg">4) พร้อมส่งบัญชี</CardTitle>
              </div>
              <CardDescription>
                สรุปตามเดือนปัจจุบัน (office) และรอบลูกจ้างที่เลือกด้านบน (worker batch) — รายการอื่นในระบบอาจมีเพิ่มนอกขอบเขตนี้
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-lg border bg-muted/30 p-3 text-center">
                  <div className="text-2xl font-bold tabular-nums">{financeReady.slipTotal}</div>
                  <div className="text-[11px] text-muted-foreground">สลิป (ประมาณจากจำนวนคนในงวด)</div>
                </div>
                <div className="rounded-lg border p-3 text-center sm:col-span-1">
                  <div className="text-lg font-bold tabular-nums">{financeReady.grossTotal.toLocaleString('th-TH')}</div>
                  <div className="text-[11px] text-muted-foreground">Gross รวม (บาท)</div>
                </div>
                <div className="rounded-lg border p-3 text-center sm:col-span-2">
                  <div className="text-lg font-bold tabular-nums text-emerald-800 dark:text-emerald-200">
                    {financeReady.netTotal.toLocaleString('th-TH')}
                  </div>
                  <div className="text-[11px] text-muted-foreground">Net รวม (บาท)</div>
                </div>
              </div>
              <div className="grid gap-2 text-xs sm:grid-cols-2">
                <div className="rounded-md border p-2">
                  <p className="font-semibold text-muted-foreground mb-1">Office (HR_APPROVED+)</p>
                  <ul className="space-y-0.5 max-h-24 overflow-y-auto">
                    {financeReady.officeApproved.length === 0 ? (
                      <li className="text-muted-foreground">—</li>
                    ) : (
                      financeReady.officeApproved.slice(0, 8).map((r) => (
                        <li key={r.id}>
                          <Link className="text-primary underline-offset-2 hover:underline" href={`/office-payroll/${r.id}`}>
                            {r.payrollRunNo} · {r.payrollMonth}
                          </Link>
                          <span className="text-muted-foreground"> · {r.status}</span>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
                <div className="rounded-md border p-2">
                  <p className="font-semibold text-muted-foreground mb-1">Worker batch (HR_APPROVED+)</p>
                  <ul className="space-y-0.5 max-h-24 overflow-y-auto">
                    {financeReady.workerApproved.length === 0 ? (
                      <li className="text-muted-foreground">—</li>
                    ) : (
                      financeReady.workerApproved.slice(0, 8).map((b) => (
                        <li key={b.id}>
                          <Link className="text-primary underline-offset-2 hover:underline" href={`/payroll/batches/${b.id}`}>
                            {b.id}
                          </Link>
                          <span className="text-muted-foreground"> · {b.status}</span>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" className="font-semibold" asChild>
                  <Link href="/payroll/batches">
                    <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" /> ส่งต่อ / Export (งวดลูกจ้าง)
                  </Link>
                </Button>
                <Button size="sm" variant="secondary" asChild>
                  <Link href="/office-payroll">งวดออฟฟิศ</Link>
                </Button>
                {canOpenPayrollApprovalCenter && (
                  <Button size="sm" variant="outline" asChild>
                    <Link href="/hr/payroll-approval">
                      Payroll Approval Center <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function ChevronMini() {
  return <span className="mt-0.5 text-muted-foreground">›</span>;
}
