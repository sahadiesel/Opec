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
import {
  assignmentIncludedInWaveTimesheetRoster,
  isYmdWithinAssignmentMobTimesheetWindow,
  waveRoundMonthLabel,
} from '@/lib/constants/timesheet-ui';
import { compareAssignmentWorkerNamesTh } from '@/lib/ops/mobilization-worker-name';
import { assignmentOverlapsYearMonth } from '@/lib/ops/timesheet-hub-po-month';
import { pickRosterLinePerWorker } from '@/lib/ops/assignment-roster';
import {
  lastDayOfCalendarMonth,
  listDaysInMonth,
  resolveTimesheetForWaveMonthCell,
  sumWorkHoursForWaveMonthRow,
  timesheetWaveMonthCellDisplay,
  timesheetEventCellBadgeClasses,
} from '@/lib/timesheet/wave-month-utils';
import { OPEN_WAVE_STATUSES_FOR_TIMESHEET } from '@/lib/constants/timesheet-wave';
import { poTimesheetScopeId } from '@/lib/constants/timesheet-po-scope';
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

/** แถวสรุปรายเดือน = เดียวกับ Wave Board (รวมคนจบงานแล้วในเดือนนั้น) */
function mobilizationsEligibleForWaveMonthGrid(mobs: Assignment[], monthYm: string): Assignment[] {
  const eligible = mobs.filter(
    (m) => assignmentIncludedInWaveTimesheetRoster(m) && assignmentOverlapsYearMonth(m, monthYm),
  );
  return pickRosterLinePerWorker(eligible);
}

function chunkIds<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Firestore `in` — ใช้ช่วงที่ปลอดภัยสำหรับ mobilizations.poId */
const FIRESTORE_IN_CHUNK_PO = 30;

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
  const [extraWaves, setExtraWaves] = useState<Wave[]>([]);
  const [cellEdit, setCellEdit] = useState<CellEditContext | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editEvent, setEditEvent] = useState<RateConditionEventType>('work_day');
  const [editHours, setEditHours] = useState(12);
  const [editRemark, setEditRemark] = useState('');
  const [savingCell, setSavingCell] = useState(false);
  /** ยืนยันใน Dialog เดียว — ไม่ใช้ AlertDialog ซ้อน (กันค้าง overlay/focus) */
  const [cellSaveAwaitingConfirm, setCellSaveAwaitingConfirm] = useState(false);
  const payrollAutoHealRef = useRef<Set<string>>(new Set());
  const [monthlyTimesheetNo, setMonthlyTimesheetNo] = useState<string | null>(null);
  const [monthlyDocLoading, setMonthlyDocLoading] = useState(false);

  useEffect(() => {
    payrollAutoHealRef.current.clear();
  }, [monthYm]);

  useEffect(() => {
    if (!cellEdit) return;
    setCellSaveAwaitingConfirm(false);
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

  const sortedWaveIdSet = useMemo(() => new Set(sortedWaves.map((w) => w.id)), [sortedWaves]);

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

  /** สอดคล้อง Wave Board (โหลดตาม PO): รวมรายการที่ wave ปิดแล้วแต่ยังอยู่ใน PO ที่เปิด */
  const monthSheetsForOpenPos = useMemo(() => {
    if (!allMonthSheetsRaw?.length || openPoIdSet.size === 0) return [];
    return allMonthSheetsRaw.filter((t) => openPoIdSet.has(t.purchaseOrderId));
  }, [allMonthSheetsRaw, openPoIdSet]);

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
    const poIdsList = [...openPoIdSet];
    if (!firestore || !canViewTs || poIdsList.length === 0) {
      setMobAssignments([]);
      setMobLoading(false);
      return;
    }
    let cancelled = false;
    setMobLoading(true);
    void (async () => {
      try {
        const chunks = chunkIds(poIdsList, FIRESTORE_IN_CHUNK_PO);
        const snaps = await Promise.all(
          chunks.map((ids) =>
            getDocs(query(collection(firestore, 'mobilizations'), where('poId', 'in', ids))),
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
  }, [firestore, canViewTs, openPoIdSet]);

  const workersQuery = useMemoFirebase(
    () => (firestore && canViewTs ? collection(firestore, 'workers') : null),
    [firestore, canViewTs],
  );
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  const poById = useMemo(() => new Map((pos ?? []).map((p) => [p.id, p])), [pos]);

  const waveIdsWithEligibleMobInMonth = useMemo(() => {
    const s = new Set<string>();
    for (const m of mobAssignments) {
      if (assignmentIncludedInWaveTimesheetRoster(m) && assignmentOverlapsYearMonth(m, monthYm)) {
        s.add(m.waveId);
      }
    }
    return s;
  }, [mobAssignments, monthYm]);

  const missingWaveIdsForMonth = useMemo(
    () => [...waveIdsWithEligibleMobInMonth].filter((id) => !sortedWaveIdSet.has(id)).sort(),
    [waveIdsWithEligibleMobInMonth, sortedWaveIdSet],
  );

  const missingWaveIdsKey = missingWaveIdsForMonth.join(',');

  useEffect(() => {
    if (!firestore || !canViewTs || missingWaveIdsForMonth.length === 0) {
      setExtraWaves([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const waves: Wave[] = [];
        await Promise.all(
          missingWaveIdsForMonth.map(async (wid) => {
            const snap = await getDoc(doc(firestore, 'waves', wid));
            if (snap.exists()) waves.push({ id: snap.id, ...(snap.data() as object) } as Wave);
          }),
        );
        if (!cancelled) setExtraWaves(waves);
      } catch (e) {
        console.error('[wave-month] fetch extra waves', e);
        if (!cancelled) setExtraWaves([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, canViewTs, missingWaveIdsKey]);

  const displayWaves = useMemo(() => {
    const byId = new Map<string, Wave>();
    for (const w of sortedWaves) byId.set(w.id, w);
    for (const w of extraWaves) {
      if (!byId.has(w.id)) byId.set(w.id, w);
    }
    for (const wid of missingWaveIdsForMonth) {
      if (byId.has(wid)) continue;
      const m = mobAssignments.find((x) => x.waveId === wid);
      if (!m) continue;
      byId.set(wid, {
        id: wid,
        waveCode: `…${wid.slice(-8)}`,
        poId: m.poId,
        poLineId: m.poLineId ?? '',
        customerId: m.customerId ?? '',
        projectName: m.projectName ?? '',
        siteLocation: '',
        startDate: '',
        endDate: '',
        status: 'CLOSED',
        plannedWorkers: 0,
        assignedWorkers: 0,
        rotationPattern: '',
        createdAt: 0,
        updatedAt: 0,
      });
    }
    const list = [...byId.values()];
    list.sort((a, b) => {
      const pa = poById.get(a.poId)?.poCode ?? '';
      const pb = poById.get(b.poId)?.poCode ?? '';
      if (pa !== pb) return pa.localeCompare(pb, 'th');
      return (a.waveCode || '').localeCompare(b.waveCode || '', 'th');
    });
    return list;
  }, [sortedWaves, extraWaves, poById, missingWaveIdsForMonth, mobAssignments]);

  const sheetsByWaveWorker = useMemo(() => {
    const m = new Map<string, DailyTimesheet[]>();
    for (const t of monthSheetsForOpenPos) {
      const k = `${t.waveId}|${t.workerId}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(t);
    }
    return m;
  }, [monthSheetsForOpenPos]);

  const eligibleMobsByWaveId = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    for (const wave of displayWaves) {
      const waveMobsAll = mobAssignments.filter((m) => m.waveId === wave.id);
      map.set(wave.id, mobilizationsEligibleForWaveMonthGrid(waveMobsAll, monthYm));
    }
    return map;
  }, [displayWaves, mobAssignments, monthYm]);

  const tableRows = useMemo(() => {
    const out: {
      wave: Wave;
      po: PurchaseOrder | undefined;
      rw: { workerId: string; name: string };
      rosterAssignment: Assignment;
    }[] = [];
    for (const wave of displayWaves) {
      const po = poById.get(wave.poId);
      let roster = [...(eligibleMobsByWaveId.get(wave.id) ?? [])];
      roster.sort((a, b) => compareAssignmentWorkerNamesTh(a, b, allWorkers));
      for (const asgn of roster) {
        const wid = asgn.workerId;
        const w = allWorkers?.find((x) => x.id === wid);
        const name = w ? `${w.firstName || ''} ${w.lastName || ''}`.trim() || w.workerCode : wid;
        out.push({ wave, po, rw: { workerId: wid, name }, rosterAssignment: asgn });
      }
    }
    out.sort((a, b) => {
      const c = a.rw.name.localeCompare(b.rw.name, 'th', { sensitivity: 'base', numeric: true });
      if (c !== 0) return c;
      return `${a.wave.id}\0${a.rosterAssignment.id}`.localeCompare(`${b.wave.id}\0${b.rosterAssignment.id}`);
    });
    return out;
  }, [displayWaves, eligibleMobsByWaveId, allWorkers, poById]);

  /** รวมชม.ทำงานต่อแถว — สอดคล้องช่องรายวัน (ไม่บวกซ้ำจาก mobilization/PO อื่นของคนเดียวกัน) */
  const rowWorkHoursMonthTotalByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const tr of tableRows) {
      const { wave, rw, rosterAssignment } = tr;
      const key = `${wave.id}|${rw.workerId}|${rosterAssignment.id}`;
      /** ทุก mobilization ใน wave นี้ — ไม่ใช่แค่แถวที่ pickRoster เลือก (กันมีหลาย doc ต่อคน) */
      const alternateMobIds = mobAssignments
        .filter((m) => m.waveId === wave.id && m.workerId === rw.workerId && m.id !== rosterAssignment.id)
        .map((m) => m.id);
      m.set(
        key,
        sumWorkHoursForWaveMonthRow(
          rosterAssignment,
          wave.id,
          rw.workerId,
          rosterAssignment.id,
          days,
          sheetsByWaveWorker,
          monthSheetsForOpenPos,
          poTimesheetScopeId(rosterAssignment.poId),
          alternateMobIds,
        ),
      );
    }
    return m;
  }, [tableRows, days, sheetsByWaveWorker, monthSheetsForOpenPos, mobAssignments]);

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

  const performSaveCellEdit = useCallback(async () => {
    if (!firestore || !currentUser || !cellEdit) return;
    const { wave, po, monthReview, workerId, workerName, assignment, timesheet: openedTs } = cellEdit;
    if (!canEditTs || isMonthTimesheetRowLocked(po?.id ? poMonthByPoId.get(po.id) : undefined, monthReview)) {
      toast({
        variant: 'destructive',
        title: 'บันทึกไม่ได้',
        description: 'ไม่มีสิทธิ์หรืองวดถูกปิดแล้ว',
      });
      return;
    }
    const service = new TimesheetService(firestore);

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
    const snapAtNewId = await getDoc(doc(firestore, 'daily_timesheets', newId));
    let baseTs: DailyTimesheet | undefined = openedTs;
    if (snapAtNewId.exists()) {
      const loaded = { id: snapAtNewId.id, ...(snapAtNewId.data() as object) } as DailyTimesheet;
      if (!baseTs || baseTs.id !== loaded.id) {
        baseTs = loaded;
      }
    }

    if (baseTs && service.isFinalized(baseTs.status as DailyTimesheetStatus)) {
      toast({ variant: 'destructive', title: 'รายการถูกล็อก', description: 'แก้ไขไม่ได้' });
      return;
    }

    setSavingCell(true);
    try {
      if (openedTs && newId !== openedTs.id) {
        await deleteDoc(doc(firestore, 'daily_timesheets', openedTs.id));
      }

      const worker = allWorkers?.find((w) => w.id === workerId);
      const nameSnap = worker
        ? `${worker.firstName || ''} ${worker.lastName || ''}`.trim() || workerName
        : workerName;
      const isUnpaid = editEvent === 'unpaid_leave';
      const nHours = isUnpaid ? 0 : Math.min(24, Math.max(0, Number(editHours) || 0));

      const payload: Partial<DailyTimesheet> = {
        ...(baseTs ? { ...baseTs, id: undefined } : {}),
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

      if (!baseTs) {
        payload.status = 'DRAFT';
      } else if (baseTs.status && service.canEdit(baseTs.status as DailyTimesheetStatus)) {
        payload.status = baseTs.status;
      } else {
        payload.status = 'DRAFT';
      }

      await service.bulkUpsertTimesheets([payload], currentUser);
      toast({ title: 'บันทึกแล้ว', description: 'อัปเดตลงเวลารายวันเรียบร้อย' });
      setCellEdit(null);
    } catch (e: unknown) {
      setCellSaveAwaitingConfirm(false);
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
      document.getElementById(`wave-month-data-${w}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 450);
    return () => clearTimeout(t);
  }, [monthYm, loading, displayWaves.length]);

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
              · ตารางรวมทุกคนที่ลงเวลาในเดือนที่เลือก — กดเซลล์เพื่อแก้รายวัน
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
            'ตัวอักษรในเซลล์ = ประเภทวัน (W/SB/…) · « - » = ว่างหรือไม่จ่าย · คอลัมน์รวม = ชม.ทำงานสะสมในเดือน',
            'เซลล์จับคู่กับบันทึกรายวัน — รวมข้อมูลจาก Wave Board ที่เก็บ waveId แบบ PO scope (`po_ts_scope_…`) ให้ตรงกับแถว wave จริง',
            'จบงาน (ปิด mobilization / Demob): ใช้ปุ่ม «จบงาน» ในเมนูลงเวลารายวัน (Wave Board) ที่แถวพนักงาน — หน้านี้เป็นตารางสรุปรายเดือนเท่านั้น',
            'ช่วง Standby / เริ่มงาน: สรุปรายเดือนใช้ทั้งวัน Standby และวันเริ่มทำงานจาก Mobilization — คนสถานะ MOBILIZING ที่ความพร้อม READY ขึ้นตารางเมื่อช่วงมอบหมายทับเดือนนั้น (ยังไม่ ACTIVE จะยังไม่มี work_day อัตโนมัติ — ต้องผ่านขั้น Mobilization)',
            'ลงเวลาอัตโนมัติ ACTIVE (PO Active): ระบบสร้าง work_day ถึงเมื่อวานตามเวลาไทย — วันปัจจุบันให้บันทึกเมื่อปิดวัน',
          ]}
        />

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">ตัวกรอง</CardTitle>
            <CardDescription>
              กรองตามเดือนเท่านั้น — แสดงทุก PO ที่ยัง pending/active และ Wave ที่เกี่ยวข้อง (รวม Wave ปิดแล้วถ้ายังมีคนพร้อมลงเวลาทับเดือนนี้)
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase text-muted-foreground">เดือน (ปี-เดือน)</Label>
              <Input type="month" value={monthYm} onChange={(e) => setMonthYm(e.target.value)} className="h-10 w-[200px]" />
            </div>
            <p className="text-sm text-muted-foreground pb-1">
              พบ {sortedWaves.length} Wave สถานะเปิด · แสดงในตาราง {displayWaves.length} Wave
              {pos != null ? ` · ${pos.length} PO (pending/active)` : ''}
            </p>
          </CardContent>
        </Card>

        {loading ? (
          <p className="text-center text-muted-foreground py-12">กำลังโหลด…</p>
        ) : (
          <div className="space-y-6">
            <Alert className="border-amber-200/80 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="min-w-0 flex-1 space-y-2">
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
                    <p className="text-xs text-muted-foreground">ตารางด้านล่าง = ลงเวลารายวันต่อพนักงาน จนกว่า PO+งวดจะถูกล็อก</p>
                  </AlertDescription>
                </div>
                <Button size="sm" className="shrink-0 self-stretch sm:self-center w-full sm:w-auto" asChild>
                  <Link href={`/timesheets/po-month?month=${encodeURIComponent(monthYm)}`}>
                    เอกสาร PO+งวด (ล็อก / ส่งตรวจ)
                  </Link>
                </Button>
              </div>
            </Alert>
            {displayWaves.length === 0 ? (
              <p className="text-center text-muted-foreground py-12 border border-dashed rounded-lg">
                ไม่มี Wave ที่เกี่ยวข้องในเดือนนี้ — ไม่มี mobilization ที่พร้อมลงเวลาและทับเดือนที่เลือกสำหรับ PO ที่เปิดอยู่
              </p>
            ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">สรุปลงเวลารายเดือน</CardTitle>
                <CardDescription>
                  เลขที่เอกสาร {monthlyTimesheetNo ? <span className="font-mono text-foreground">{monthlyTimesheetNo}</span> : '—'}{' '}
                  · แถวต่อพนักงาน — เฉพาะคนที่ช่วงมอบหมายทับเดือนนี้ (โหลดจาก PO ที่เปิด สอดคล้องกระดานลงเวลา) ·{' '}
                  <strong>รวมชม.</strong> = ชม.ทำงาน (วันทำงานเท่านั้น ไม่รวม standby) ตามแถวนี้เท่านั้น — จับคู่ timesheet แบบเดียวกับช่องวัน
                  (ไม่รวมซ้ำจาก assignment/PO อื่นของคนเดียวกัน) · ช่องวันและชม.รวมนับเฉพาะช่วง mobilization จริง (วันเริ่มทำงานบนไซต์ / วันจบไซต์ จาก Mobilization)
                  ไม่ใช่แค่วันที่มอบหมายเก่า
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                {tableRows.length === 0 ? (
                  <p className="text-center text-muted-foreground py-10 px-4">
                    ยังไม่มีแถวในงวดนี้ — ไม่พบ mobilization ที่ผ่านเกณฑ์ลงเวลาและครอบคลุมเดือนนี้ (หรือยังไม่มี Wave ที่เกี่ยวข้อง)
                  </p>
                ) : (
                  <>
                    <Table className="min-w-max text-xs [&_th]:h-auto [&_th]:min-h-0 [&_th]:py-1.5 [&_th]:px-1.5 [&_tbody_td]:py-1.5 [&_tbody_td]:align-middle">
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className="sticky left-0 z-20 w-[9rem] min-w-[7.5rem] max-w-[10rem] bg-muted/95 font-bold shadow-[2px_0_4px_rgba(0,0,0,0.06)] px-2">
                            พนักงาน
                          </TableHead>
                          {days.map((d) => (
                            <TableHead key={d} className="px-0.5 text-center w-7 min-w-[1.75rem] font-mono text-[10px]" title={d}>
                              {d.slice(8, 10)}
                            </TableHead>
                          ))}
                          <TableHead
                            className="text-center font-bold min-w-[5.75rem] w-[5.75rem] shrink-0 text-[10px] leading-tight px-2"
                            title="ชม.ทำงาน (เฉพาะวันทำงาน) รวมในแถวนี้ตามการจับคู่ timesheet กับช่องวัน — ไม่รวม standby"
                          >
                            รวมชม.
                            <br />
                            <span className="font-normal text-muted-foreground">(ทำงาน)</span>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tableRows.map((tr, rowIdx) => {
                          const { wave, po, rw, rosterAssignment } = tr;
                          const isFirstInWave = rowIdx === 0 || tableRows[rowIdx - 1]!.wave.id !== wave.id;
                          const monthReview = reviewByWaveId.get(wave.id);
                          const waveMobs = eligibleMobsByWaveId.get(wave.id) ?? [];
                          const alternateMobIds = mobAssignments
                            .filter((m) => m.waveId === wave.id && m.workerId === rw.workerId && m.id !== rosterAssignment.id)
                            .map((m) => m.id);
                          const rowWorkerMonthWorkTotal =
                            rowWorkHoursMonthTotalByKey.get(`${wave.id}|${rw.workerId}|${rosterAssignment.id}`) ?? 0;
                          const editableGrid =
                            canEditTs &&
                            !isMonthTimesheetRowLocked(
                              po ? poMonthByPoId.get(po.id) : undefined,
                              monthReview,
                            );
                          return (
                            <TableRow
                              key={`${wave.id}-${rw.workerId}-${rosterAssignment.id}`}
                              id={isFirstInWave ? `wave-month-data-${wave.id}` : undefined}
                            >
                              <TableCell
                                className="sticky left-0 z-10 bg-background shadow-[2px_0_4px_rgba(0,0,0,0.06)] max-w-[11rem] px-2 py-1.5"
                                title={`${rw.name} · ${wave.waveCode?.trim() || wave.id}`}
                              >
                                <div className="flex min-w-0 flex-col gap-0.5">
                                  <span className="truncate text-xs font-medium leading-tight">{rw.name}</span>
                                  <span className="truncate font-mono text-[10px] leading-tight text-muted-foreground">
                                    {wave.waveCode?.trim() || wave.id}
                                  </span>
                                </div>
                              </TableCell>
                              {days.map((d) => {
                                /** ต้องจับคู่แบบเดียวกับ sumWorkHoursForWaveMonthRow — ห้ามบังคับว่างเมื่ออยู่นอกหน้าต่าง mobilization ถ้า resolve พบใบงานจริง (มิฉะนั้นแถวเป็น "-" ทั้งแถวแต่รวมชม.ยังมีเลข) */
                                const inMobWindow = isYmdWithinAssignmentMobTimesheetWindow(
                                  rosterAssignment,
                                  d,
                                );
                                const ts = resolveTimesheetForWaveMonthCell(
                                  wave.id,
                                  rw.workerId,
                                  d,
                                  rosterAssignment.id,
                                  sheetsByWaveWorker,
                                  monthSheetsForOpenPos,
                                  poTimesheetScopeId(rosterAssignment.poId),
                                  rosterAssignment,
                                  alternateMobIds,
                                );
                                const cellLabel = timesheetWaveMonthCellDisplay(ts);
                                return (
                                  <TableCell key={d} className="px-0.5 text-center text-[11px] leading-none">
                                    {!inMobWindow && !ts ? (
                                      <span
                                        className="inline-flex min-h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-sm py-0.5 text-[11px] font-medium text-muted-foreground/40"
                                        title="นอกช่วง mobilization ตามฟิลด์บนเอกสาร — ยังไม่มีบันทึกรายวันที่จับคู่ได้"
                                      >
                                        {' - '}
                                      </span>
                                    ) : ts ? (
                                      <button
                                        type="button"
                                        disabled={!editableGrid}
                                        onClick={() =>
                                          openCellEdit(wave, po, monthReview, rw, d, ts, waveMobs)
                                        }
                                        className={cn(
                                          'inline-flex max-w-full justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                          !editableGrid && 'cursor-not-allowed opacity-60',
                                          editableGrid && 'cursor-pointer hover:opacity-90',
                                        )}
                                        title={
                                          (editableGrid
                                            ? `คลิกแก้ไข · ${d} · ${ts.eventType} · ${ts.status}`
                                            : `${d} · ${ts.eventType} · ${ts.status}`) +
                                          (!inMobWindow
                                            ? ' · วันนี้อยู่นอกหน้าต่าง mobilization บนเอกสาร — แสดงตามใบงานที่มีจริง'
                                            : '')
                                        }
                                      >
                                        <span
                                          className={cn(
                                            'inline-flex items-center justify-center rounded-sm border px-1 py-0.5 text-[11px] font-medium leading-none min-w-[1.125rem]',
                                            timesheetEventCellBadgeClasses(ts.eventType, ts.status),
                                            !inMobWindow && 'ring-1 ring-amber-500/45',
                                          )}
                                        >
                                          {cellLabel}
                                        </span>
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
                                          'inline-flex min-h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-sm py-0.5 font-medium text-muted-foreground/80 text-[11px] leading-none',
                                          editableGrid &&
                                            'cursor-pointer hover:bg-muted/60 text-muted-foreground',
                                          !editableGrid && 'cursor-default opacity-45',
                                        )}
                                      >
                                        {' - '}
                                      </button>
                                    )}
                                  </TableCell>
                                );
                              })}
                              <TableCell
                                className="text-center font-bold tabular-nums text-xs min-w-[5.75rem] w-[5.75rem] shrink-0 px-2 py-1.5"
                                title="ชม.ทำงานรวมในแถวนี้ (ไม่รวม standby)"
                              >
                                {rowWorkerMonthWorkTotal}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                    <div className="border-t px-4 py-3 text-xs text-muted-foreground space-y-1">
                      <p>
                        <strong>คีย์:</strong> ตัวอักษร = ประเภทวัน (W ทำงาน, SB สแตนด์บาย, T เดินทาง, M Mob, D Demob ฯลฯ) · เซลล์ «-» = ยังไม่มีบันทึกหรือวันไม่จ่าย —{' '}
                        <strong className="text-emerald-700">เขียว</strong>=ทำงาน{' '}
                        <strong className="text-sky-700">ฟ้า</strong>=สแตนด์บาย{' '}
                        <strong className="text-violet-700">ม่วง</strong>=เดินทาง{' '}
                        <strong className="text-orange-700">ส้ม</strong>=Mob/Demob (ดู tooltip)
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
            )}
          </div>
        )}
      </div>

      <Dialog
        open={!!cellEdit}
        onOpenChange={(open) => {
          if (!open && !savingCell) {
            setCellSaveAwaitingConfirm(false);
            setCellEdit(null);
          }
        }}
      >
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
              {cellSaveAwaitingConfirm ? (
                <Alert className="border-amber-200/80 bg-amber-50/80 dark:border-amber-900/50 dark:bg-amber-950/30">
                  <AlertTitle className="text-sm">ยืนยันการบันทึก</AlertTitle>
                  <AlertDescription className="text-xs sm:text-sm">
                    ต้องการบันทึกการแก้ไขลงเวลารายวันนี้ใช่หรือไม่? ถ้ามี daily timesheet เดิมสำหรับคน วัน
                    และการมอบหมายนี้แล้ว ระบบจะอัปเดตทับตามค่าที่คุณเลือก
                  </AlertDescription>
                </Alert>
              ) : null}
              <div className="space-y-1.5">
                <Label htmlFor="wm-edit-date">วันที่ (ในเดือนที่เลือก)</Label>
                <Input
                  id="wm-edit-date"
                  type="date"
                  min={`${monthYm}-01`}
                  max={lastDayOfCalendarMonth(monthYm)}
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  disabled={savingCell || cellSaveAwaitingConfirm}
                />
              </div>
              <div className="space-y-1.5">
                <Label>ประเภทวัน</Label>
                <Select
                  value={editEvent}
                  onValueChange={(v: RateConditionEventType) => setEditEvent(v)}
                  disabled={savingCell || cellSaveAwaitingConfirm}
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
                  disabled={savingCell || cellSaveAwaitingConfirm || editEvent === 'unpaid_leave'}
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
                  disabled={savingCell || cellSaveAwaitingConfirm}
                  placeholder="เช่น แก้วันผิด / สาเหตุลา"
                />
              </div>
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0 flex-wrap">
            {savingCell ? (
              <span className="mr-auto flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                กำลังบันทึก…
              </span>
            ) : null}
            {!cellSaveAwaitingConfirm ? (
              <>
                <Button type="button" variant="outline" disabled={savingCell} onClick={() => setCellEdit(null)}>
                  ยกเลิก
                </Button>
                <Button
                  type="button"
                  disabled={savingCell || !cellEdit}
                  onClick={() => setCellSaveAwaitingConfirm(true)}
                >
                  บันทึก
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={savingCell}
                  onClick={() => setCellSaveAwaitingConfirm(false)}
                >
                  กลับไปแก้ไข
                </Button>
                <Button
                  type="button"
                  disabled={savingCell || !cellEdit}
                  onClick={() => void performSaveCellEdit()}
                >
                  ยืนยันบันทึก
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
