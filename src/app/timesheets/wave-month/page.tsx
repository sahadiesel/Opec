'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { CalendarRange, ChevronLeft, FileText, Loader2, Waves } from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import type {
  Assignment,
  DailyTimesheet,
  DailyTimesheetStatus,
  PoMonthTimesheetReview,
  PurchaseOrder,
  RateConditionEventType,
  User,
  Wave,
  WaveMonthTimesheetReview,
  Worker,
} from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccess, canEdit, canView, isMatrixControlledRole } from '@/lib/permissions';
import { PageGuidance } from '@/components/layout/page-guidance';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import { waveRoundMonthLabel } from '@/lib/constants/timesheet-ui';
import {
  lastDayOfCalendarMonth,
  listDaysInMonth,
  timesheetCellSummary,
  timesheetEventCellBadgeClasses,
} from '@/lib/timesheet/wave-month-utils';
import { OPEN_WAVE_STATUSES_FOR_TIMESHEET } from '@/lib/constants/timesheet-wave';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { TimesheetService } from '@/lib/services/timesheet-service';
import { cn } from '@/lib/utils';
import {
  ensureOpenPayrollPeriodForWaveMonthReview,
  markTimesheetsReadyForPayrollAfterMonthApproval,
} from '@/lib/timesheet/wave-month-payroll-bridge';
import { ensureMonthlyTimesheetDocument } from '@/lib/timesheet/ensure-monthly-timesheet-document';

function ymNow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function chunkIds<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const EVENT_TYPE_OPTIONS: { label: string; value: RateConditionEventType }[] = [
  { label: 'วันทำงาน (Work)', value: 'work_day' },
  { label: 'วันเดินทาง (Travel)', value: 'travel_day' },
  { label: 'สแตนด์บาย (Standby)', value: 'standby_day' },
  { label: 'เตรียมส่งตัว (Mob)', value: 'mobilization_day' },
  { label: 'วันเดินทางกลับ (Demob)', value: 'demobilization_day' },
  { label: 'ลาป่วย (ได้รับค่าจ้าง)', value: 'sick_leave_paid' },
  { label: 'ส่งกลับ/กลับก่อนกำหนด (Early return)', value: 'early_return' },
  { label: 'ไม่จ่ายค่าแรง (Unpaid)', value: 'unpaid_leave' },
];

function isWaveMonthReviewLocked(r: WaveMonthTimesheetReview | undefined): boolean {
  return (
    r?.status === 'entry_locked' ||
    r?.status === 'pending_manager_review' ||
    r?.status === 'approved'
  );
}

function isPoMonthDocumentLockedForGrid(r: PoMonthTimesheetReview | undefined): boolean {
  if (!r) return false;
  return (
    r.status === 'entry_locked' || r.status === 'pending_manager_review' || r.status === 'approved'
  );
}

function isMonthTimesheetRowLocked(
  poReview: PoMonthTimesheetReview | undefined,
  waveReview: WaveMonthTimesheetReview | undefined,
): boolean {
  if (isPoMonthDocumentLockedForGrid(poReview)) return true;
  return isWaveMonthReviewLocked(waveReview);
}

type CellEditContext = {
  wave: Wave;
  po: PurchaseOrder | undefined;
  monthReview: WaveMonthTimesheetReview | undefined;
  workerId: string;
  workerName: string;
  assignment: Assignment;
  cellDate: string;
  timesheet: DailyTimesheet | undefined;
};

export default function WaveMonthTimesheetSummaryPage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const useMatrixGuards = isMatrixControlledRole(currentUser);
  const canViewTs = useMemo(
    () => (useMatrixGuards ? canAccess(currentUser, 'timesheets', 'view') : canView(currentUser, 'timesheets')),
    [currentUser, useMatrixGuards],
  );
  const canEditTs = useMemo(
    () => (useMatrixGuards ? canAccess(currentUser, 'timesheets', 'edit') : canEdit(currentUser, 'timesheets')),
    [currentUser, useMatrixGuards],
  );

  const [monthYm, setMonthYm] = useState(ymNow);
  const [mobAssignments, setMobAssignments] = useState<Assignment[]>([]);
  const [mobLoading, setMobLoading] = useState(false);
  const [cellEdit, setCellEdit] = useState<CellEditContext | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editEvent, setEditEvent] = useState<RateConditionEventType>('work_day');
  const [editHours, setEditHours] = useState(12);
  const [editRemark, setEditRemark] = useState('');
  const [savingCell, setSavingCell] = useState(false);
  const payrollAutoHealRef = useRef<Set<string>>(new Set());
  const [monthlyTimesheetNo, setMonthlyTimesheetNo] = useState<string | null>(null);
  const [monthlyDocLoading, setMonthlyDocLoading] = useState(false);

  useEffect(() => {
    payrollAutoHealRef.current.clear();
  }, [monthYm]);

  useEffect(() => {
    if (!cellEdit) return;
    const ts = cellEdit.timesheet;
    setEditDate(ts?.date ?? cellEdit.cellDate);
    setEditEvent((ts?.eventType as RateConditionEventType) ?? 'work_day');
    setEditHours(typeof ts?.normalHours === 'number' ? ts.normalHours : 12);
    setEditRemark(ts?.remark ?? '');
  }, [cellEdit]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const p = new URLSearchParams(window.location.search);
    const m = p.get('month');
    if (m && /^\d{4}-\d{2}$/.test(m)) setMonthYm(m);
  }, []);

  const poQuery = useMemoFirebase(
    () =>
      firestore && canViewTs
        ? query(collection(firestore, 'purchase_orders'), where('status', 'in', ['pending', 'active']))
        : null,
    [firestore, canViewTs],
  );
  const { data: pos, isLoading: posLoading } = useCollection<PurchaseOrder>(poQuery as any);

  const waveQuery = useMemoFirebase(() => {
    if (!firestore || !canViewTs) return null;
    return query(collection(firestore, 'waves'), where('status', 'in', OPEN_WAVE_STATUSES_FOR_TIMESHEET));
  }, [firestore, canViewTs]);
  const { data: allOpenWaves, isLoading: wavesLoading } = useCollection<Wave>(waveQuery as any);

  const openPoIdSet = useMemo(() => new Set((pos ?? []).map((p) => p.id)), [pos]);

  const sortedWaves = useMemo(() => {
    const list = (allOpenWaves ?? []).filter((w) => openPoIdSet.has(w.poId));
    const poById = new Map((pos ?? []).map((p) => [p.id, p]));
    return [...list].sort((a, b) => {
      const pa = poById.get(a.poId)?.poCode ?? '';
      const pb = poById.get(b.poId)?.poCode ?? '';
      if (pa !== pb) return pa.localeCompare(pb, 'th');
      return (a.waveCode || '').localeCompare(b.waveCode || '', 'th');
    });
  }, [allOpenWaves, openPoIdSet, pos]);

  const openWaveIdSet = useMemo(() => new Set(sortedWaves.map((w) => w.id)), [sortedWaves]);

  const monthStart = `${monthYm}-01`;
  const monthEnd = lastDayOfCalendarMonth(monthYm);
  const days = useMemo(() => listDaysInMonth(monthYm), [monthYm]);

  const tsQuery = useMemoFirebase(() => {
    if (!firestore || !canViewTs) return null;
    return query(
      collection(firestore, 'daily_timesheets'),
      where('date', '>=', monthStart),
      where('date', '<=', monthEnd),
    );
  }, [firestore, canViewTs, monthStart, monthEnd]);

  const [allMonthSheetsRaw, setAllMonthSheetsRaw] = useState<DailyTimesheet[] | null>(null);
  const [tsLoadingSoft, setTsLoadingSoft] = useState(true);

  useEffect(() => {
    if (!tsQuery) {
      setAllMonthSheetsRaw(null);
      setTsLoadingSoft(false);
      return;
    }
    setTsLoadingSoft(true);
    const unsub = onSnapshot(
      tsQuery,
      (snap) => {
        setAllMonthSheetsRaw(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) } as DailyTimesheet)),
        );
        setTsLoadingSoft(false);
      },
      (err) => {
        console.warn('[wave-month] daily_timesheets snapshot:', err.code, err.message);
        setAllMonthSheetsRaw([]);
        setTsLoadingSoft(false);
      },
    );
    return () => unsub();
  }, [tsQuery]);

  const monthSheetsForOpenWaves = useMemo(() => {
    if (!allMonthSheetsRaw?.length || openWaveIdSet.size === 0) return [];
    return allMonthSheetsRaw.filter((t) => openWaveIdSet.has(t.waveId));
  }, [allMonthSheetsRaw, openWaveIdSet]);

  const reviewsQuery = useMemoFirebase(
    () =>
      firestore && canViewTs && monthYm && /^\d{4}-\d{2}$/.test(monthYm)
        ? query(collection(firestore, 'wave_month_timesheet_reviews'), where('yearMonth', '==', monthYm))
        : null,
    [firestore, canViewTs, monthYm],
  );

  const [monthReviewRows, setMonthReviewRows] = useState<WaveMonthTimesheetReview[] | null>(null);

  useEffect(() => {
    if (!reviewsQuery) {
      setMonthReviewRows(null);
      return;
    }
    const unsub = onSnapshot(
      reviewsQuery,
      (snap) => {
        setMonthReviewRows(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) } as WaveMonthTimesheetReview)),
        );
      },
      (err) => {
        console.warn('[wave-month] wave_month_timesheet_reviews snapshot:', err.code, err.message);
        setMonthReviewRows([]);
      },
    );
    return () => unsub();
  }, [reviewsQuery]);

  const reviewByWaveId = useMemo(() => {
    const m = new Map<string, WaveMonthTimesheetReview>();
    for (const r of monthReviewRows ?? []) {
      m.set(r.waveId, r);
    }
    return m;
  }, [monthReviewRows]);

  const poMonthQuery = useMemoFirebase(
    () =>
      firestore && canViewTs && monthYm && /^\d{4}-\d{2}$/.test(monthYm)
        ? query(collection(firestore, 'po_month_timesheet_reviews'), where('yearMonth', '==', monthYm))
        : null,
    [firestore, canViewTs, monthYm],
  );
  const { data: poMonthRows } = useCollection<PoMonthTimesheetReview>(poMonthQuery as any);
  const poMonthByPoId = useMemo(() => {
    const m = new Map<string, PoMonthTimesheetReview>();
    for (const r of poMonthRows ?? []) m.set(r.poId, r);
    return m;
  }, [poMonthRows]);

  useEffect(() => {
    if (!firestore || !currentUser || !monthYm || !canViewTs) return;
    setMonthlyDocLoading(true);
    let c = true;
    void (async () => {
      try {
        const no = await ensureMonthlyTimesheetDocument(firestore, monthYm, currentUser);
        if (c && no) setMonthlyTimesheetNo(no);
      } catch (e) {
        console.error('[wave-month] monthly timesheet doc', e);
        if (c) setMonthlyTimesheetNo(null);
      } finally {
        if (c) setMonthlyDocLoading(false);
      }
    })();
    return () => {
      c = false;
    };
  }, [firestore, currentUser, monthYm, canViewTs]);

  useEffect(() => {
    if (!firestore || !currentUser || !monthReviewRows?.length) return;
    const actorName = currentUser.displayName || currentUser.email || currentUser.id;
    for (const r of monthReviewRows) {
      if (r.status !== 'approved') continue;
      if (payrollAutoHealRef.current.has(r.id)) continue;
      payrollAutoHealRef.current.add(r.id);
      void (async () => {
        try {
          const { updated } = await markTimesheetsReadyForPayrollAfterMonthApproval(firestore, r);
          await ensureOpenPayrollPeriodForWaveMonthReview(firestore, r, actorName);
          if (updated > 0) {
            toast({
              title: 'ตั้งค่าพร้อมจ่าย payroll',
              description: `อัปเดต readyForPayroll ให้ ${updated} รายการ timesheet`,
            });
          }
        } catch (err) {
          payrollAutoHealRef.current.delete(r.id);
          console.error('[wave-month] payroll bridge', err);
        }
      })();
    }
  }, [firestore, currentUser, monthReviewRows, toast]);

  useEffect(() => {
    const ids = sortedWaves.map((w) => w.id);
    if (!firestore || !canViewTs || ids.length === 0) {
      setMobAssignments([]);
      setMobLoading(false);
      return;
    }
    let cancelled = false;
    setMobLoading(true);
    void (async () => {
      try {
        const chunks = chunkIds(ids, 10);
        const snaps = await Promise.all(
          chunks.map((ids) =>
            getDocs(query(collection(firestore, 'mobilizations'), where('waveId', 'in', ids))),
          ),
        );
        if (cancelled) return;
        const merged: Assignment[] = [];
        const seen = new Set<string>();
        for (const snap of snaps) {
          for (const d of snap.docs) {
            if (seen.has(d.id)) continue;
            seen.add(d.id);
            merged.push({ id: d.id, ...(d.data() as object) } as Assignment);
          }
        }
        setMobAssignments(merged);
      } catch (e) {
        console.error(e);
        setMobAssignments([]);
      } finally {
        if (!cancelled) setMobLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, canViewTs, sortedWaves]);

  const workersQuery = useMemoFirebase(
    () => (firestore && canViewTs ? collection(firestore, 'workers') : null),
    [firestore, canViewTs],
  );
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  const poById = useMemo(() => new Map((pos ?? []).map((p) => [p.id, p])), [pos]);

  const sheetsByWaveWorker = useMemo(() => {
    const m = new Map<string, DailyTimesheet[]>();
    for (const t of monthSheetsForOpenWaves) {
      const k = `${t.waveId}|${t.workerId}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(t);
    }
    return m;
  }, [monthSheetsForOpenWaves]);

  const tableRows = useMemo(() => {
    const out: { wave: Wave; po: PurchaseOrder | undefined; rw: { workerId: string; name: string } }[] = [];
    for (const wave of sortedWaves) {
      const po = poById.get(wave.poId);
      const waveMobs = mobAssignments.filter((m) => m.waveId === wave.id);
      const rosterWorkers = [...new Set(waveMobs.map((x) => x.workerId).filter(Boolean))]
        .map((wid) => {
          const w = allWorkers?.find((x) => x.id === wid);
          const name = w ? `${w.firstName || ''} ${w.lastName || ''}`.trim() || w.workerCode : wid;
          return { workerId: wid, name };
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'th'));
      for (const rw of rosterWorkers) {
        out.push({ wave, po, rw });
      }
    }
    return out;
  }, [sortedWaves, mobAssignments, allWorkers, poById]);

  const openCellEdit = useCallback(
    (
      wave: Wave,
      po: PurchaseOrder | undefined,
      monthReview: WaveMonthTimesheetReview | undefined,
      rw: { workerId: string; name: string },
      cellDate: string,
      ts: DailyTimesheet | undefined,
      waveMobs: Assignment[],
    ) => {
      if (!canEditTs) {
        toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์แก้ไขลงเวลา' });
        return;
      }
      if (isMonthTimesheetRowLocked(po?.id ? poMonthByPoId.get(po.id) : undefined, monthReview)) {
        toast({
          variant: 'destructive',
          title: 'งวดนี้แก้ไขไม่ได้',
          description: 'เอกสาร PO+งวดถูกล็อก/ส่งตรวจแล้ว หรืองวดราย wave เดิมล็อกแล้ว',
        });
        return;
      }
      if (ts?.status) {
        const locked = ['CLIENT_APPROVED', 'VERIFIED_PAPER', 'LOCKED'].includes(ts.status as DailyTimesheetStatus);
        if (locked) {
          toast({
            variant: 'destructive',
            title: 'รายการถูกล็อกทางบัญชีแล้ว',
            description: 'ไม่สามารถแก้จากตารางรายเดือนได้',
          });
          return;
        }
      }
      const assignment = ts
        ? waveMobs.find((m) => m.id === ts.assignmentId) ?? waveMobs.find((m) => m.workerId === rw.workerId)
        : waveMobs.find((m) => m.workerId === rw.workerId);
      if (!assignment) {
        toast({
          variant: 'destructive',
          title: 'ไม่พบการมอบหมาย',
          description: 'เพิ่ม Mobilization / Assignment ใน Wave ก่อน',
        });
        return;
      }
      setCellEdit({
        wave,
        po,
        monthReview,
        workerId: rw.workerId,
        workerName: rw.name,
        assignment,
        cellDate,
        timesheet: ts,
      });
    },
    [canEditTs, toast, poMonthByPoId],
  );

  const handleSaveCellEdit = useCallback(async () => {
    if (!firestore || !currentUser || !cellEdit) return;
    const { wave, po, monthReview, workerId, workerName, assignment, timesheet: existingTs } = cellEdit;
    if (!canEditTs || isMonthTimesheetRowLocked(po?.id ? poMonthByPoId.get(po.id) : undefined, monthReview)) {
      toast({
        variant: 'destructive',
        title: 'บันทึกไม่ได้',
        description: 'ไม่มีสิทธิ์หรืองวดถูกปิดแล้ว',
      });
      return;
    }
    const service = new TimesheetService(firestore);
    if (existingTs && service.isFinalized(existingTs.status as DailyTimesheetStatus)) {
      toast({ variant: 'destructive', title: 'รายการถูกล็อก', description: 'แก้ไขไม่ได้' });
      return;
    }

    const contractId = (assignment.contractId || po?.contractId || '').trim();
    const poLineId = (assignment.poLineId || wave.poLineId || '').trim();
    const positionId = (assignment.positionId || '').trim();
    if (!contractId || !poLineId || !positionId) {
      toast({
        variant: 'destructive',
        title: 'ข้อมูลไม่ครบ',
        description: 'ต้องมี contractId, poLineId และ positionId จากการมอบหมาย/PO',
      });
      return;
    }

    const newId = service.getTimesheetId(workerId, assignment.id, editDate);
    if (newId !== existingTs?.id) {
      const destSnap = await getDoc(doc(firestore, 'daily_timesheets', newId));
      if (destSnap.exists()) {
        toast({
          variant: 'destructive',
          title: 'วันนี้มีรายการแล้ว',
          description:
            'มี daily_timesheet สำหรับคน/มอบหมายเดียวกันในวันนี้อยู่แล้ว — เลือกวันอื่น หรือแก้ใน Wave Board',
        });
        return;
      }
    }

    setSavingCell(true);
    try {
      if (existingTs && newId !== existingTs.id) {
        await deleteDoc(doc(firestore, 'daily_timesheets', existingTs.id));
      }

      const worker = allWorkers?.find((w) => w.id === workerId);
      const nameSnap = worker
        ? `${worker.firstName || ''} ${worker.lastName || ''}`.trim() || workerName
        : workerName;
      const isUnpaid = editEvent === 'unpaid_leave';
      const nHours = isUnpaid ? 0 : Math.min(24, Math.max(0, Number(editHours) || 0));

      const payload: Partial<DailyTimesheet> = {
        ...(existingTs ? { ...existingTs, id: undefined } : {}),
        workerId,
        assignmentId: assignment.id,
        date: editDate,
        eventType: editEvent,
        normalHours: nHours,
        remark: editRemark.trim() || undefined,
        waveId: wave.id,
        siteId: wave.id,
        purchaseOrderId: assignment.poId || wave.poId,
        poLineId,
        contractId,
        customerId: wave.customerId || '',
        positionId,
        workMode: assignment.workMode ?? 'OFFSHORE',
        shiftType: 'DAY',
        ot15Hours: 0,
        workerNameSnapshot: nameSnap,
      };

      if (!existingTs) {
        payload.status = 'DRAFT';
      } else if (existingTs.status && service.canEdit(existingTs.status as DailyTimesheetStatus)) {
        payload.status = existingTs.status;
      } else {
        payload.status = 'DRAFT';
      }

      await service.bulkUpsertTimesheets([payload], currentUser);
      toast({ title: 'บันทึกแล้ว', description: 'อัปเดตลงเวลารายวันเรียบร้อย' });
      setCellEdit(null);
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'บันทึกไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSavingCell(false);
    }
  }, [
    firestore,
    currentUser,
    cellEdit,
    canEditTs,
    poMonthByPoId,
    toast,
    editDate,
    editEvent,
    editHours,
    editRemark,
    allWorkers,
  ]);

  const loading = tsLoadingSoft || mobLoading || posLoading || wavesLoading;

  useEffect(() => {
    if (typeof window === 'undefined' || loading) return;
    const p = new URLSearchParams(window.location.search);
    const w = p.get('highlightWave');
    if (!w) return;
    const t = window.setTimeout(() => {
      document.getElementById(`wave-month-wave-${w}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 450);
    return () => clearTimeout(t);
  }, [monthYm, loading, sortedWaves.length]);

  if (userLoading || !currentUser) return null;
  if (!canViewTs) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-5xl mx-auto py-10 text-center text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงเมนูนี้</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="mx-auto max-w-[100vw] space-y-6 px-2 pb-8 lg:max-w-[1800px] lg:px-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <PayrollScopeTag scope="worker" showHint={false} />
            <Button variant="link" className="h-auto p-0 text-sm text-muted-foreground" asChild>
              <Link href="/timesheets">
                <ChevronLeft className="mr-1 inline h-4 w-4" />
                กลับศูนย์ลงเวลา
              </Link>
            </Button>
            <h1 className="text-2xl font-bold tracking-tight text-primary flex items-center gap-2 lg:text-3xl">
              <CalendarRange className="h-7 w-7 lg:h-8 lg:w-8" />
              เอกสาร timesheet รายเดือน
            </h1>
            <p className="text-muted-foreground mt-1 max-w-3xl text-sm lg:text-base">
              เลขที่เอกสาร:{' '}
              {monthlyDocLoading ? (
                <span className="font-mono">…</span>
              ) : (
                <span className="font-mono text-foreground font-semibold">{monthlyTimesheetNo ?? '—'}</span>
              )}{' '}
              · ตารางรวมทุกคนทุก Wave ในเดือนที่เลือก — คอลัมน์ Wave บอกรอบงาน (ไม่อ้าง PO) · กดเซลล์เพื่อแก้รายวัน
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" asChild>
              <Link href={`/timesheets/po-month?month=${encodeURIComponent(monthYm)}`}>เอกสาร PO+งวด (ล็อก / ส่งตรวจ)</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/timesheets/wave-board">ไป Wave Board</Link>
            </Button>
          </div>
        </div>

        <PageGuidance
          title="คีย์การใช้งาน"
          tips={[
            'ปิดงวด / ส่งตรวจ / แนบรูป—PDF / ออกเอกสาร (invoice+payroll): ทำที่เมนู «เอกสาร timesheet ราย PO+เดือน» ไม่อ้างอิง Wave',
            'เลือกเดือน — ระบบออกเลขเอกสาร (TS-…) ต่อเดือนอัตโนมัติ; ตารางด้านล่าง = รวมทุก wave เพื่อแก้รายวันจนกว่า PO+งวดจะถูกล็อก',
            'รหัสประเภทวัน: ดู tooltip; สี/ขอบตามสถานะ (ดูท้ายตาราง)',
          ]}
        />

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">ตัวกรอง</CardTitle>
            <CardDescription>กรองตามเดือนเท่านั้น — แสดงทุก PO / Wave ที่ยังเปิดอยู่</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase text-muted-foreground">เดือน (ปี-เดือน)</Label>
              <Input type="month" value={monthYm} onChange={(e) => setMonthYm(e.target.value)} className="h-10 w-[200px]" />
            </div>
            <p className="text-sm text-muted-foreground pb-1">
              พบ {sortedWaves.length} Wave ที่ยังไม่ปิด
              {pos != null ? ` · ${pos.length} PO (pending/active)` : ''}
            </p>
          </CardContent>
        </Card>

        {loading ? (
          <p className="text-center text-muted-foreground py-12">กำลังโหลด…</p>
        ) : sortedWaves.length === 0 ? (
          <p className="text-center text-muted-foreground py-12 border border-dashed rounded-lg">
            ไม่มี Wave ที่ยังไม่ปิดสำหรับ PO ที่เปิดอยู่ — หรือยังไม่มีข้อมูล Wave
          </p>
        ) : (
          <div className="space-y-6">
            <Alert className="border-amber-200/80 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20">
              <AlertTitle>ปิดงวด &amp; ส่งตรวจ &amp; แนบ — ย้ายไปเอกสาร PO+เดือน</AlertTitle>
              <AlertDescription className="text-sm space-y-2">
                <p>
                  ใช้{' '}
                  <Link
                    className="font-semibold text-primary underline"
                    href={`/timesheets/po-month?month=${encodeURIComponent(monthYm)}`}
                  >
                    เอกสาร timesheet ราย PO+เดือน
                  </Link>{' '}
                  เพื่อล็อกงวด แนบรูป/PDF สูงสุด 4 ไฟล์ (รูป &gt; ~500 KB บีบอัตโนมัติ) แล้วส่งผู้จัดการ — หลังอนุมัติใช้ทำ invoice + payroll
                  (ไม่อ้างอิง Wave ในเอกสารจ่าย/วางบิล)
                </p>
                <p className="text-xs text-muted-foreground">ตารางด้านล่าง = ลงเวลารายวันต่อ wave จนกว่า PO+งวดจะถูกล็อก</p>
              </AlertDescription>
            </Alert>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">สรุปลงเวลา — ทุกคนทุก Wave</CardTitle>
                <CardDescription>
                  เลขที่เอกสาร {monthlyTimesheetNo ? <span className="font-mono text-foreground">{monthlyTimesheetNo}</span> : '—'}{' '}
                  · คอลัมน์แรก = รอบ (Wave) · ตามด้วยชื่อพนักงาน
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                {tableRows.length === 0 ? (
                  <p className="text-center text-muted-foreground py-10 px-4">ยังไม่มีแถวในงวดนี้ (ไม่พบการมอบหมาย)</p>
                ) : (
                  <>
                    <Table className="min-w-max text-xs">
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className="sticky left-0 z-20 min-w-[100px] bg-muted/95 font-bold shadow-[2px_0_4px_rgba(0,0,0,0.06)]">
                            Wave
                          </TableHead>
                          <TableHead className="sticky z-20 min-w-[140px] left-[100px] bg-muted/95 font-bold shadow-[2px_0_4px_rgba(0,0,0,0.06)]">
                            พนักงาน
                          </TableHead>
                          {days.map((d) => (
                            <TableHead key={d} className="px-1 text-center w-10 font-mono" title={d}>
                              {d.slice(8, 10)}
                            </TableHead>
                          ))}
                          <TableHead className="text-center font-bold min-w-[56px]">รวมชม.</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tableRows.map((tr, rowIdx) => {
                          const { wave, po, rw } = tr;
                          const isFirstInWave = rowIdx === 0 || tableRows[rowIdx - 1]!.wave.id !== wave.id;
                          const monthReview = reviewByWaveId.get(wave.id);
                          const waveMobs = mobAssignments.filter((m) => m.waveId === wave.id);
                          const rowSheets = sheetsByWaveWorker.get(`${wave.id}|${rw.workerId}`) ?? [];
                          const byDate = new Map<string, DailyTimesheet>();
                          for (const t of rowSheets) {
                            byDate.set(t.date, t);
                          }
                          const rowTotal = rowSheets.reduce((s, t) => s + (t.normalHours ?? 0), 0);
                          const editableGrid =
                            canEditTs &&
                            !isMonthTimesheetRowLocked(
                              po ? poMonthByPoId.get(po.id) : undefined,
                              monthReview,
                            );
                          return (
                            <TableRow
                              key={`${wave.id}-${rw.workerId}`}
                              id={isFirstInWave ? `wave-month-data-${wave.id}` : undefined}
                            >
                              <TableCell
                                className="sticky left-0 z-10 bg-background font-mono text-[10px] text-muted-foreground shadow-[2px_0_4px_rgba(0,0,0,0.06)]"
                                title={wave.waveCode}
                              >
                                {wave.waveCode}
                              </TableCell>
                              <TableCell className="sticky z-10 left-[100px] bg-background font-medium text-xs shadow-[2px_0_4px_rgba(0,0,0,0.06)]">
                                {rw.name}
                              </TableCell>
                              {days.map((d) => {
                                const ts = byDate.get(d);
                                const cell = timesheetCellSummary(ts);
                                return (
                                  <TableCell key={d} className="px-0.5 text-center font-mono text-[10px]">
                                    {ts ? (
                                      <button
                                        type="button"
                                        title={
                                          editableGrid
                                            ? `คลิกแก้ไข · ${d} · ${ts.eventType} · ${ts.status}`
                                            : `${d} · ${ts.eventType} · ${ts.status}`
                                        }
                                        disabled={!editableGrid}
                                        onClick={() =>
                                          openCellEdit(wave, po, monthReview, rw, d, ts, waveMobs)
                                        }
                                        className={cn(
                                          'inline-flex max-w-full justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                          !editableGrid && 'cursor-not-allowed opacity-60',
                                          editableGrid && 'cursor-pointer hover:opacity-90',
                                        )}
                                      >
                                        <Badge
                                          variant="outline"
                                          className={`h-7 min-w-[2.5rem] px-1 font-mono text-[10px] leading-tight ${timesheetEventCellBadgeClasses(ts.eventType, ts.status)}`}
                                        >
                                          {cell || '—'}
                                        </Badge>
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        title={editableGrid ? `เพิ่มรายการ · ${d}` : undefined}
                                        disabled={!editableGrid}
                                        onClick={() =>
                                          openCellEdit(wave, po, monthReview, rw, d, undefined, waveMobs)
                                        }
                                        className={cn(
                                          'tabular-nums min-h-[28px] min-w-[28px] rounded text-muted-foreground/40',
                                          editableGrid &&
                                            'cursor-pointer text-muted-foreground/70 hover:bg-muted/60',
                                          !editableGrid && 'cursor-default opacity-50',
                                        )}
                                      >
                                        ·
                                      </button>
                                    )}
                                  </TableCell>
                                );
                              })}
                              <TableCell className="text-center font-bold text-sm">{rowTotal}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                    <div className="border-t px-4 py-3 text-xs text-muted-foreground space-y-1">
                      <p>
                        <strong>คีย์:</strong> ตัวเลข = ชม.ปกติ + รหัส (W/SB/T/…) —{' '}
                        <strong className="text-emerald-700">เขียว</strong>=ทำงาน{' '}
                        <strong className="text-sky-700">ฟ้า</strong>=สแตนด์บาย{' '}
                        <strong className="text-violet-700">ม่วง</strong>=เดินทาง{' '}
                        <strong className="text-orange-700">ส้ม</strong>=Mob/Demob ฯลฯ (ดู tooltip)
                      </p>
                      <p>
                        <strong>ขอบสถานะ:</strong> วงแหวน <span className="text-amber-600">เหลืองทองหนา</span> = DRAFT —
                        วงบางเทา = ส่งตรวจแล้ว / อื่นๆ
                      </p>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <Dialog open={!!cellEdit} onOpenChange={(open) => !open && !savingCell && setCellEdit(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>แก้ไขลงเวลารายวัน</DialogTitle>
            <DialogDescription>
              {cellEdit
                ? `${cellEdit.workerName} · Wave ${cellEdit.wave.waveCode ?? ''}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {cellEdit ? (
            <div className="space-y-3 py-1">
              <div className="space-y-1.5">
                <Label htmlFor="wm-edit-date">วันที่ (ในเดือนที่เลือก)</Label>
                <Input
                  id="wm-edit-date"
                  type="date"
                  min={`${monthYm}-01`}
                  max={lastDayOfCalendarMonth(monthYm)}
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  disabled={savingCell}
                />
              </div>
              <div className="space-y-1.5">
                <Label>ประเภทวัน</Label>
                <Select
                  value={editEvent}
                  onValueChange={(v: RateConditionEventType) => setEditEvent(v)}
                  disabled={savingCell}
                >
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="เลือกประเภท" />
                  </SelectTrigger>
                  <SelectContent>
                    {EVENT_TYPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wm-edit-hours">ชั่วโมงปกติ (0–24)</Label>
                <Input
                  id="wm-edit-hours"
                  type="number"
                  min={0}
                  max={24}
                  step={0.5}
                  value={editHours}
                  onChange={(e) => setEditHours(Number(e.target.value))}
                  disabled={savingCell || editEvent === 'unpaid_leave'}
                />
                {editEvent === 'unpaid_leave' ? (
                  <p className="text-xs text-muted-foreground">ลาไม่รับค่าจ้าง — ชั่วโมงจะถูกตั้งเป็น 0</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wm-edit-remark">หมายเหตุ (ถ้ามี)</Label>
                <Textarea
                  id="wm-edit-remark"
                  rows={2}
                  value={editRemark}
                  onChange={(e) => setEditRemark(e.target.value)}
                  disabled={savingCell}
                  placeholder="เช่น แก้วันผิด / สาเหตุลา"
                />
              </div>
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" disabled={savingCell} onClick={() => setCellEdit(null)}>
              ยกเลิก
            </Button>
            <Button type="button" disabled={savingCell || !cellEdit} onClick={() => void handleSaveCellEdit()}>
              {savingCell ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  กำลังบันทึก…
                </>
              ) : (
                'บันทึก'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
