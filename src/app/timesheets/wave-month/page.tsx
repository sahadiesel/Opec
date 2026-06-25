'use client';

import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  CalendarRange,
  ChevronLeft,
  FileText,
  ImagePlus,
  Loader2,
  Lock,
  Printer,
  Send,
  Trash2,
  Unlock,
  Waves,
  RefreshCw,
} from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import type {
  Assignment,
  Customer,
  DailyTimesheet,
  DailyTimesheetStatus,
  MainContract,
  PoMonthTimesheetReview,
  Position,
  PurchaseOrder,
  RateConditionEventType,
  User,
  Wave,
  WaveMonthTimesheetReview,
  Worker,
} from '@/lib/types';
import { positionListPrimaryName, type PositionDoc } from '@/lib/position-display';
import { useToast } from '@/hooks/use-toast';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccess, canEdit, canView, isMatrixControlledRole } from '@/lib/permissions';
import { PageGuidance } from '@/components/layout/page-guidance';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import {
  isYmdWithinAssignmentMobTimesheetWindow,
  isYmdEditableForAssignmentTimesheet,
  waveRoundMonthLabel,
} from '@/lib/constants/timesheet-ui';
import { compareAssignmentWorkerNamesTh } from '@/lib/ops/mobilization-worker-name';
import { assignmentOverlapsYearMonthForPoDailyBoard } from '@/lib/ops/timesheet-hub-po-month';
import { syncPoActiveAutoDailyForAssignment } from '@/lib/timesheet/po-active-auto-daily-sync';
import { isAssignmentEligibleForPoActiveAutoDaily } from '@/lib/timesheet/po-active-auto-daily-build';
import { thailandTodayYmd } from '@/lib/ops/mobilization-final-clearance';
import {
  isWaveMonthAttachmentPdf,
  lastDayOfCalendarMonth,
  listDaysInMonth,
  mobilizationsEligibleForWaveMonthGrid,
  resolveTimesheetForWaveMonthCell,
  sumWorkHoursForWaveMonthRow,
  sumStandbyHoursForWaveMonthRow,
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
import { formatPayrollYearMonthThaiBE } from '@/lib/date-thai';
import { buildWaveMonthTimesheetGridPrintHtml } from '@/lib/documents/wave-month-timesheet-grid-print';
import { openStandardPrintWindow } from '@/lib/documents/standard-document-print';
import {
  ensureOpenPayrollPeriodForWaveMonthReview,
  markTimesheetsReadyForPayrollAfterMonthApproval,
} from '@/lib/timesheet/wave-month-payroll-bridge';
import {
  TimesheetPoMonthPanel,
  type TimesheetPoMonthPanelHandle,
  type TimesheetPoMonthToolbarSnapshot,
} from '@/components/timesheet/timesheet-po-month-panel';
import { isSystemAdmin } from '@/lib/permission-core';
import { normalizePoActiveBundleId, resolvePoActiveBundleKeyForPo } from '@/lib/ops/po-active-bundle';
import {
  buildEligibleMainContractIdSet,
  filterPoActiveWorkflowPurchaseOrders,
  PO_ACTIVE_MAIN_CONTRACT_STATUS_IN,
} from '@/lib/ops/po-active-eligibility';

function ymNow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
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
  { label: 'วันเดินทาง', value: 'mobilization_day' },
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
  const router = useRouter();
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
  const [bundleFilterId, setBundleFilterId] = useState<string | null>(null);
  const [urlHighlightPo, setUrlHighlightPo] = useState('');
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
  const [gridPrintBusy, setGridPrintBusy] = useState(false);
  const payrollAutoHealRef = useRef<Set<string>>(new Set());
  const poMonthPanelRef = useRef<TimesheetPoMonthPanelHandle>(null);
  const [poToolbarSnapshots, setPoToolbarSnapshots] = useState<TimesheetPoMonthToolbarSnapshot[]>([]);

  const onEmbeddedToolbarSnapshot = useCallback((snapshots: TimesheetPoMonthToolbarSnapshot[]) => {
    setPoToolbarSnapshots(snapshots);
  }, []);

  const displayToolbarSnapshots = useMemo(() => {
    if (poToolbarSnapshots.length <= 1) return poToolbarSnapshots;
    const bundleSnap = poToolbarSnapshots.find((s) => s.isBundle);
    if (bundleSnap) return [bundleSnap];
    const seen = new Set<string>();
    return poToolbarSnapshots.filter((s) => {
      if (seen.has(s.poId)) return false;
      seen.add(s.poId);
      return true;
    });
  }, [poToolbarSnapshots]);

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
    const b = (p.get('poActiveBundleId') || '').trim();
    setBundleFilterId(b ? normalizePoActiveBundleId(b) : null);
    setUrlHighlightPo((p.get('highlightPo') || '').trim());
  }, []);

  const replaceWaveMonthQuery = useCallback(
    (mutate: (p: URLSearchParams) => void) => {
      const p = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
      mutate(p);
      if (!p.get('month') || !/^\d{4}-\d{2}$/.test(p.get('month')!)) {
        p.set('month', monthYm);
      }
      if (bundleFilterId && !p.get('poActiveBundleId')) {
        p.set('poActiveBundleId', bundleFilterId);
      }
      router.replace(`/timesheets/wave-month?${p.toString()}`);
      const nextMonth = p.get('month')!;
      if (/^\d{4}-\d{2}$/.test(nextMonth)) setMonthYm(nextMonth);
      const b = (p.get('poActiveBundleId') || '').trim();
      setBundleFilterId(b ? normalizePoActiveBundleId(b) : null);
      setUrlHighlightPo((p.get('highlightPo') || '').trim());
    },
    [router, monthYm, bundleFilterId],
  );

  const poQuery = useMemoFirebase(
    () =>
      firestore && canViewTs
        ? query(collection(firestore, 'purchase_orders'), where('status', 'in', ['pending', 'active']))
        : null,
    [firestore, canViewTs],
  );
  const { data: pos, isLoading: posLoading } = useCollection<PurchaseOrder>(poQuery as any);

  const contractsQuery = useMemoFirebase(() => {
    if (!firestore || !canViewTs) return null;
    return query(
      collection(firestore, 'main_contracts'),
      where('status', 'in', [...PO_ACTIVE_MAIN_CONTRACT_STATUS_IN]),
    );
  }, [firestore, canViewTs]);
  const { data: activeContracts, isLoading: contractsLoading } = useCollection<MainContract>(contractsQuery as any);

  const poActiveWorkflowPos = useMemo(() => {
    if (contractsLoading || activeContracts === undefined) return [];
    const eligible = buildEligibleMainContractIdSet(activeContracts);
    return filterPoActiveWorkflowPurchaseOrders(pos, eligible);
  }, [pos, activeContracts, contractsLoading]);

  const customersQuery = useMemoFirebase(
    () => (firestore && canViewTs ? collection(firestore, 'customers') : null),
    [firestore, canViewTs],
  );
  const { data: customers } = useCollection<Customer>(customersQuery as any);

  const openPoIdSet = useMemo(() => new Set(poActiveWorkflowPos.map((p) => p.id)), [poActiveWorkflowPos]);

  const customerNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of customers ?? []) m.set(c.id, c.name);
    return m;
  }, [customers]);

  const poById = useMemo(() => new Map(poActiveWorkflowPos.map((p) => [p.id, p])), [poActiveWorkflowPos]);

  const bundleOptions = useMemo(() => {
    const m = new Map<string, { key: string; customerId: string; poCodes: string[]; workMode?: string }>();
    for (const p of poActiveWorkflowPos) {
      const key = resolvePoActiveBundleKeyForPo(p);
      const ex = m.get(key) ?? {
        key,
        customerId: (p.customerId || '').trim(),
        poCodes: [],
        workMode: p.poWorkMode,
      };
      ex.poCodes.push(p.poCode ?? p.id);
      m.set(key, ex);
    }
    return [...m.values()].sort((a, b) => {
      const ca = customerNameById.get(a.customerId) ?? a.customerId;
      const cb = customerNameById.get(b.customerId) ?? b.customerId;
      return ca.localeCompare(cb, 'th') || a.key.localeCompare(b.key);
    });
  }, [poActiveWorkflowPos, customerNameById]);

  const effectiveBundleId = useMemo(() => {
    if (bundleFilterId) return bundleFilterId;
    if (bundleOptions.length === 1) return bundleOptions[0]!.key;
    if (bundleOptions.length > 1) return null;
    if (urlHighlightPo && poById.has(urlHighlightPo)) {
      return resolvePoActiveBundleKeyForPo(poById.get(urlHighlightPo)!);
    }
    return null;
  }, [bundleFilterId, urlHighlightPo, poById, bundleOptions]);

  const scopedPoIdSet = useMemo(() => {
    if (!effectiveBundleId) {
      if (bundleOptions.length > 1) return new Set<string>();
      return openPoIdSet;
    }
    const s = new Set<string>();
    for (const p of poActiveWorkflowPos) {
      if (resolvePoActiveBundleKeyForPo(p) === effectiveBundleId) s.add(p.id);
    }
    return s;
  }, [effectiveBundleId, bundleOptions.length, poActiveWorkflowPos, openPoIdSet]);

  const scopedPoIdsList = useMemo(() => [...scopedPoIdSet].sort(), [scopedPoIdSet]);

  const activeBundleLabel = useMemo(() => {
    if (!effectiveBundleId) return null;
    const opt = bundleOptions.find((b) => b.key === effectiveBundleId);
    if (!opt) return effectiveBundleId;
    const name = customerNameById.get(opt.customerId) ?? opt.customerId;
    const mode = opt.workMode === 'ONSHORE' ? 'Onshore' : opt.workMode === 'OFFSHORE' ? 'Offshore' : '';
    return `${name}${mode ? ` · ${mode}` : ''} (PO: ${opt.poCodes.join(', ')})`;
  }, [effectiveBundleId, bundleOptions, customerNameById]);

  const needsBundlePick = bundleOptions.length > 1 && !effectiveBundleId;

  const waveQuery = useMemoFirebase(() => {
    if (!firestore || !canViewTs) return null;
    return query(collection(firestore, 'waves'), where('status', 'in', OPEN_WAVE_STATUSES_FOR_TIMESHEET));
  }, [firestore, canViewTs]);
  const { data: allOpenWaves, isLoading: wavesLoading } = useCollection<Wave>(waveQuery as any);

  const sortedWaves = useMemo(() => {
    const list = (allOpenWaves ?? []).filter((w) => scopedPoIdSet.has(w.poId));
    const poById = new Map((pos ?? []).map((p) => [p.id, p]));
    return [...list].sort((a, b) => {
      const pa = poById.get(a.poId)?.poCode ?? '';
      const pb = poById.get(b.poId)?.poCode ?? '';
      if (pa !== pb) return pa.localeCompare(pb, 'th');
      return (a.waveCode || '').localeCompare(b.waveCode || '', 'th');
    });
  }, [allOpenWaves, scopedPoIdSet, pos]);

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
    if (!allMonthSheetsRaw?.length || scopedPoIdSet.size === 0) return [];
    return allMonthSheetsRaw.filter((t) => scopedPoIdSet.has(t.purchaseOrderId));
  }, [allMonthSheetsRaw, scopedPoIdSet]);

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

  /** เติมรายวันอัตโนมัติของวันนี้ (เขตไทย) — เหมือน PO Daily Board เพื่อให้หน้ารายเดือนเห็นข้อมูลโดยไม่ต้องเปิดกระดานรายวัน */
  const silentPoActiveAutoDailyIds = useMemo(() => {
    const today = thailandTodayYmd();
    if (!today.startsWith(monthYm)) return [];
    const ids: string[] = [];
    for (const a of mobAssignments) {
      if (!isAssignmentEligibleForPoActiveAutoDaily(a)) continue;
      if (!assignmentOverlapsYearMonthForPoDailyBoard(a, monthYm)) continue;
      if (isWaveMonthReviewLocked(reviewByWaveId.get(a.waveId))) continue;
      if (isPoMonthDocumentLockedForGrid(poMonthByPoId.get(a.poId))) continue;
      ids.push(a.id);
    }
    return ids;
  }, [mobAssignments, monthYm, reviewByWaveId, poMonthByPoId]);

  const poActiveAutoDailySyncLockRef = useRef(false);
  /** กันยิงซ้ำทั้งเดือน — คีย์ต่อเดือนปฏิทิน + วันนี้เขตไทย (วันใหม่จะรันเติมย้อนหลังในเดือนอีกครั้ง) */
  const waveMonthPoAutoHealSucceededKeyRef = useRef<string>('');

  useEffect(() => {
    waveMonthPoAutoHealSucceededKeyRef.current = '';
  }, [monthYm]);

  const runWaveMonthPoActiveAutoHeal = useCallback(async () => {
    if (!firestore || !currentUser || !canEditTs || silentPoActiveAutoDailyIds.length === 0) return;
    const todayYmd = thailandTodayYmd();
    if (!todayYmd.startsWith(monthYm)) return;
    const idsFingerprint = [...silentPoActiveAutoDailyIds].sort().join(',');
    const runKey = `${monthYm}|${todayYmd}|${idsFingerprint}`;
    if (waveMonthPoAutoHealSucceededKeyRef.current === runKey) return;
    if (poActiveAutoDailySyncLockRef.current) return;
    poActiveAutoDailySyncLockRef.current = true;
    try {
      for (const aid of silentPoActiveAutoDailyIds) {
        try {
          await syncPoActiveAutoDailyForAssignment(firestore, aid, currentUser, {
            backfillCalendarMonthYm: monthYm,
          });
        } catch {
          /* สิทธิ์/เครือข่ายรายแถว — ไม่รบกวนผู้ใช้ */
        }
      }
      waveMonthPoAutoHealSucceededKeyRef.current = runKey;
    } finally {
      poActiveAutoDailySyncLockRef.current = false;
    }
  }, [firestore, currentUser, canEditTs, silentPoActiveAutoDailyIds, monthYm]);

  useEffect(() => {
    void runWaveMonthPoActiveAutoHeal();
  }, [runWaveMonthPoActiveAutoHeal]);

  useEffect(() => {
    if (!canEditTs || !firestore) return;
    const iv = window.setInterval(() => {
      void runWaveMonthPoActiveAutoHeal();
    }, 45_000);
    return () => window.clearInterval(iv);
  }, [canEditTs, firestore, runWaveMonthPoActiveAutoHeal]);

  useEffect(() => {
    if (!canEditTs || !firestore) return;
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      void runWaveMonthPoActiveAutoHeal();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, [canEditTs, firestore, runWaveMonthPoActiveAutoHeal]);

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
    const poIdsList = [...scopedPoIdSet];
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
  }, [firestore, canViewTs, scopedPoIdSet]);

  const workersQuery = useMemoFirebase(
    () => (firestore && canViewTs ? collection(firestore, 'workers') : null),
    [firestore, canViewTs],
  );
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  const positionsQuery = useMemoFirebase(
    () => (firestore && canViewTs ? collection(firestore, 'positions') : null),
    [firestore, canViewTs],
  );
  const { data: positionsCatalog } = useCollection<Position>(positionsQuery as any);
  const positionLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of positionsCatalog ?? []) {
      m.set(p.id, positionListPrimaryName(p as PositionDoc));
    }
    return m;
  }, [positionsCatalog]);

  const waveIdsWithEligibleMobInMonth = useMemo(() => {
    const s = new Set<string>();
    const byWave = new Map<string, Assignment[]>();
    for (const m of mobAssignments) {
      if (!scopedPoIdSet.has(m.poId)) continue;
      const wid = (m.waveId || '').trim();
      if (!wid) continue;
      const list = byWave.get(wid) ?? [];
      list.push(m);
      byWave.set(wid, list);
    }
    for (const [waveId, waveMobs] of byWave) {
      if (mobilizationsEligibleForWaveMonthGrid(waveMobs, monthYm, monthSheetsForOpenPos).length > 0) {
        s.add(waveId);
      }
    }
    return s;
  }, [mobAssignments, monthYm, monthSheetsForOpenPos, scopedPoIdSet]);

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
      map.set(wave.id, mobilizationsEligibleForWaveMonthGrid(waveMobsAll, monthYm, monthSheetsForOpenPos));
    }
    return map;
  }, [displayWaves, mobAssignments, monthYm, monthSheetsForOpenPos]);

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
          { onlyWithinMobWindow: true },
        ),
      );
    }
    return m;
  }, [tableRows, days, sheetsByWaveWorker, monthSheetsForOpenPos, mobAssignments]);

  /** รวมชม. standby ต่อแถว — สอดคล้องช่อง SB ในกริด */
  const rowStandbyHoursMonthTotalByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const tr of tableRows) {
      const { wave, rw, rosterAssignment } = tr;
      const key = `${wave.id}|${rw.workerId}|${rosterAssignment.id}`;
      const alternateMobIds = mobAssignments
        .filter((m) => m.waveId === wave.id && m.workerId === rw.workerId && m.id !== rosterAssignment.id)
        .map((m) => m.id);
      m.set(
        key,
        sumStandbyHoursForWaveMonthRow(
          rosterAssignment,
          wave.id,
          rw.workerId,
          rosterAssignment.id,
          days,
          sheetsByWaveWorker,
          monthSheetsForOpenPos,
          poTimesheetScopeId(rosterAssignment.poId),
          alternateMobIds,
          { onlyWithinMobWindow: true },
        ),
      );
    }
    return m;
  }, [tableRows, days, sheetsByWaveWorker, monthSheetsForOpenPos, mobAssignments]);

  /**
   * คนละหนึ่งแถวในงวดเดือน: ถ้าพนักงานถูกดึงจากหลาย wave / หลาย mobilization ที่ชี้ชุดลงเวลาเดียวกัน
   * (หรือมีหลายเอกสาร daily ซ้ำความหมาย) — เลือกแถวเดียวตามคะแนนจับคู่กับข้อมูลจริง + wave ที่ยังเปิดอยู่
   */
  const dedupedTableRows = useMemo(() => {
    type Row = (typeof tableRows)[number];
    type Scored = {
      tr: Row;
      waveMatchCount: number;
      assignmentMatchCount: number;
      poMatchCount: number;
    };

    const scoreRow = (tr: Row): Scored => {
      const { wave, rw, rosterAssignment } = tr;
      const alternateMobIds = mobAssignments
        .filter((m) => m.waveId === wave.id && m.workerId === rw.workerId && m.id !== rosterAssignment.id)
        .map((m) => m.id);
      const scope = poTimesheetScopeId(rosterAssignment.poId);
      const poId = (rosterAssignment.poId || '').trim();
      let waveMatchCount = 0;
      let assignmentMatchCount = 0;
      let poMatchCount = 0;
      for (const d of days) {
        const ts = resolveTimesheetForWaveMonthCell(
          wave.id,
          rw.workerId,
          d,
          rosterAssignment.id,
          sheetsByWaveWorker,
          monthSheetsForOpenPos,
          scope,
          rosterAssignment,
          alternateMobIds,
        );
        if (ts?.waveId === wave.id) waveMatchCount++;
        if (ts?.assignmentId === rosterAssignment.id) assignmentMatchCount++;
        if (ts && (ts.purchaseOrderId || '').trim() === poId) poMatchCount++;
      }
      return { tr, waveMatchCount, assignmentMatchCount, poMatchCount };
    };

    const better = (a: Scored, b: Scored): boolean => {
      if (a.waveMatchCount !== b.waveMatchCount) return a.waveMatchCount > b.waveMatchCount;
      if (a.assignmentMatchCount !== b.assignmentMatchCount) return a.assignmentMatchCount > b.assignmentMatchCount;
      if (a.poMatchCount !== b.poMatchCount) return a.poMatchCount > b.poMatchCount;
      const aOpen = OPEN_WAVE_STATUSES_FOR_TIMESHEET.includes(a.tr.wave.status) ? 1 : 0;
      const bOpen = OPEN_WAVE_STATUSES_FOR_TIMESHEET.includes(b.tr.wave.status) ? 1 : 0;
      if (aOpen !== bOpen) return aOpen > bOpen;
      if (a.tr.wave.updatedAt !== b.tr.wave.updatedAt) return a.tr.wave.updatedAt > b.tr.wave.updatedAt;
      return (
        `${a.tr.wave.id}\0${a.tr.rosterAssignment.id}`.localeCompare(
          `${b.tr.wave.id}\0${b.tr.rosterAssignment.id}`,
        ) < 0
      );
    };

    const scored = tableRows.map(scoreRow);
    const bestByWorker = new Map<string, Scored>();
    for (const s of scored) {
      const wid = s.tr.rw.workerId;
      const cur = bestByWorker.get(wid);
      if (!cur || better(s, cur)) bestByWorker.set(wid, s);
    }

    const out = scored.filter((s) => bestByWorker.get(s.tr.rw.workerId) === s).map((s) => s.tr);
    out.sort((a, b) => {
      const c = a.rw.name.localeCompare(b.rw.name, 'th', { sensitivity: 'base', numeric: true });
      if (c !== 0) return c;
      return `${a.wave.id}\0${a.rosterAssignment.id}`.localeCompare(`${b.wave.id}\0${b.rosterAssignment.id}`);
    });
    return out;
  }, [tableRows, days, sheetsByWaveWorker, monthSheetsForOpenPos, mobAssignments]);

  const handlePrintGridTable = useCallback(async () => {
    if (dedupedTableRows.length === 0) {
      toast({
        variant: 'destructive',
        title: 'ไม่มีตารางให้พิมพ์',
        description: 'ยังไม่มีแถวในงวดที่เลือก — เลือกชุด PO และเดือนก่อน',
      });
      return;
    }

    setGridPrintBusy(true);
    try {
      const printRows = dedupedTableRows.map((tr) => {
        const { wave, rw, rosterAssignment } = tr;
        const alternateMobIds = mobAssignments
          .filter((m) => m.waveId === wave.id && m.workerId === rw.workerId && m.id !== rosterAssignment.id)
          .map((m) => m.id);
        const dayCells = days.map((d) => {
          const inMobWindow = isYmdWithinAssignmentMobTimesheetWindow(rosterAssignment, d);
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
          if (!inMobWindow && !ts) return '-';
          if (ts) return timesheetWaveMonthCellDisplay(ts);
          return '-';
        });
        const rowKey = `${wave.id}|${rw.workerId}|${rosterAssignment.id}`;
        const positionLabel =
          positionLabelById.get((rosterAssignment.positionId || '').trim()) ||
          rosterAssignment.positionId ||
          '—';
        return {
          workerName: rw.name,
          waveCode: wave.waveCode?.trim() || wave.id,
          positionLabel,
          dayCells,
          workHoursTotal: String(rowWorkHoursMonthTotalByKey.get(rowKey) ?? 0),
          standbyHoursTotal: String(rowStandbyHoursMonthTotalByKey.get(rowKey) ?? 0),
        };
      });

      const generatedAt = new Date().toLocaleString('th-TH', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
      const summaryLine = `Wave ในตาราง ${displayWaves.length} · PO ในชุด ${scopedPoIdSet.size}`;
      const body = buildWaveMonthTimesheetGridPrintHtml({
        monthLabel: formatPayrollYearMonthThaiBE(monthYm),
        monthYm,
        bundleLabel: activeBundleLabel,
        summaryLine,
        dayHeaders: days.map((d) => d.slice(8, 10)),
        rows: printRows,
        generatedAt,
        printedBy: currentUser?.displayName,
      });

      const ok = await openStandardPrintWindow({
        windowTitle: 'Wave-Month-Timesheet-Grid',
        suggestedFileName: `Timesheet-Grid-${monthYm}${effectiveBundleId ? `-${effectiveBundleId.slice(0, 12)}` : ''}`,
        bodyInnerHtml: body,
        htmlLang: 'th',
      });

      if (!ok) {
        toast({
          variant: 'destructive',
          title: 'เปิดหน้าต่างพิมพ์ไม่ได้',
          description: 'กรุณาอนุญาตป๊อปอัปสำหรับเว็บไซต์นี้',
        });
      }
    } finally {
      setGridPrintBusy(false);
    }
  }, [
    dedupedTableRows,
    days,
    mobAssignments,
    sheetsByWaveWorker,
    monthSheetsForOpenPos,
    positionLabelById,
    rowWorkHoursMonthTotalByKey,
    rowStandbyHoursMonthTotalByKey,
    displayWaves.length,
    scopedPoIdSet.size,
    monthYm,
    activeBundleLabel,
    effectiveBundleId,
    currentUser?.displayName,
    toast,
  ]);

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
      const inMobWindow = isYmdEditableForAssignmentTimesheet(assignment, cellDate, {
        hasPersistedTimesheetOnDate: !!ts,
      });
      if (!inMobWindow && !ts) {
        toast({
          variant: 'destructive',
          title: 'วันนี้ลงเวลาไม่ได้',
          description:
            'อยู่นอกช่วง mobilization — ถ้าจบงานแล้วแก้ได้เฉพาะวันก่อนวันจบไซต์ หรือกด «ยกเลิกจบงาน» บน Wave Board',
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

    const inMobWindow = isYmdEditableForAssignmentTimesheet(assignment, editDate, {
      hasPersistedTimesheetOnDate: !!(openedTs || baseTs),
    });
    if (!inMobWindow) {
      toast({
        variant: 'destructive',
        title: 'วันนี้บันทึกไม่ได้',
        description: 'อยู่นอกช่วง mobilization ที่อนุญาต — ลองยกเลิกจบงานบน Wave Board ถ้าต้องการลงเวลาต่อ',
      });
      return;
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

  const loading = tsLoadingSoft || mobLoading || posLoading || contractsLoading || wavesLoading;

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
              ตารางสรุปแยกตาม<strong className="text-foreground">ชุด PO Active (ลูกค้า + สัญญา)</strong> — ปิดงวด Payroll และแนบไฟล์<strong className="text-foreground">รวมทั้งชุด PO</strong> ในสัญญาเดียวกัน (ไม่รวมข้ามสัญญา)
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <PageGuidance
              compact
              title="คีย์การใช้งาน"
              tips={[
                'ปิดงวดสร้าง Payroll / ส่งอนุมัติ Timesheet / แนบรูป—PDF: การ์ดรวมต่อชุด PO Active ด้านบนตาราง — สถานะและไฟล์แนบไม่รวมข้ามสัญญา',
                'เลือกลูกค้า/ชุด PO Active และเดือนที่ตัวกรองด้านขวา — แนบรูป/PDF คู่ชุด PO+เดือนนั้น (สูงสุด 4 ไฟล์ต่อ PO · รวมแสดงในการ์ดเดียว)',
                'รหัสประเภทวัน: ดู tooltip; สี/ขอบตามสถานะ (ดูท้ายตาราง)',
                'ตัวอักษรในเซลล์ = ประเภทวัน (W/SB/…) · « - » = ว่างหรือไม่จ่าย · คอลัมน์รวม = ชม.ทำงานสะสมในเดือน',
                'เซลล์จับคู่กับบันทึกรายวัน — รวมข้อมูลจาก Wave Board ที่เก็บ waveId แบบ PO scope (`po_ts_scope_…`) ให้ตรงกับแถว wave จริง',
                'จบงาน (ปิด mobilization / Demob): ใช้ปุ่ม «หยุด» แล้วเลือก «หยุดแบบจบงาน» บน Wave Board — ข้อมูลลงเวลาก่อนวันจบยังอยู่ในเดือนเดิมจนกว่าจะทำบิล · แก้ไขได้จนกว่าจะปิดงวด',
                'คนที่จบงานแล้วรอ Mob รอบใหม่: ยังเห็นในเดือนที่มีลงเวลาจริง — แก้ไขวันก่อนวันจบไซต์ได้ หรือกด «ยกเลิกจบงาน» เพื่อกลับ ACTIVE',
                'ช่วง Standby / เริ่มงาน: สรุปรายเดือนใช้ทั้งวัน Standby และวันเริ่มทำงานจาก Mobilization — คนสถานะ MOBILIZING ที่ความพร้อม READY ขึ้นตารางเมื่อช่วงมอบหมายทับเดือนนั้น (ยังไม่ ACTIVE จะยังไม่มี work_day อัตโนมัติ — ต้องผ่านขั้น Mobilization)',
                'ลงเวลาอัตโนมัติ ACTIVE (PO Active): Scheduler เติมวันนี้ (~00:10 ไทย) + ซิงก์เมื่อเปิด Wave Board — ช่วงหยุดแบบ standby เป็น SB อัตโนมัติตามช่วงที่ตั้ง · ปุ่มหยุดแบบจบงานจะหยุดซิงก์ตามวันสิ้นสุด',
              ]}
            />
            <Button variant="outline" size="sm" asChild>
              <Link href="/timesheets/wave-board">ไป Wave Board</Link>
            </Button>
          </div>
        </div>

        {!needsBundlePick ? (
          <Suspense fallback={null}>
            <TimesheetPoMonthPanel
              ref={poMonthPanelRef}
              embedded
              linkedMonthYm={monthYm}
              linkedPoActiveBundleId={effectiveBundleId}
              linkedScopedPoIds={scopedPoIdsList}
              onEmbeddedToolbarSnapshot={onEmbeddedToolbarSnapshot}
              onLinkedMonthYmChange={(ym) => {
                replaceWaveMonthQuery((p) => {
                  p.set('month', ym);
                });
              }}
            />
          </Suspense>
        ) : null}

        <div className="print:hidden grid grid-cols-1 gap-4 lg:grid-cols-5 lg:items-stretch">
          <div className="lg:col-span-3 min-w-0 flex flex-col">
            {!needsBundlePick ? (
              <>
                {displayToolbarSnapshots.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4 border border-dashed rounded-lg flex-1">
                    {scopedPoIdsList.length > 0
                      ? 'กำลังโหลด PO สำหรับปิดงวด / แนบไฟล์…'
                      : 'ยังไม่มี PO ในงวดนี้สำหรับปิดงวด / แนบไฟล์'}
                  </p>
                ) : (
                  displayToolbarSnapshots.map((snap) => (
                    <Alert
                      key={snap.poId}
                      className="border-amber-200/80 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20 flex-1"
                    >
                      <div className="space-y-3">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-3">
                          <div className="min-w-0 flex-1 space-y-1">
                            <AlertTitle className="flex flex-wrap items-center gap-2 text-sm">
                              {snap.isBundle ? (
                                <>
                                  <span className="font-semibold">ชุด PO Active</span>
                                  <span className="font-mono">{snap.poCodesLabel ?? snap.poCode}</span>
                                </>
                              ) : (
                                <span className="font-mono">{snap.poCode}</span>
                              )}
                              <span className="text-xs font-normal text-muted-foreground">· งวด {monthYm}</span>
                            </AlertTitle>
                            {snap.projectName ? (
                              <p className="text-sm text-muted-foreground">{snap.projectName}</p>
                            ) : null}
                            <p className="text-xs">
                              สถานะ:{' '}
                              <span className="font-semibold text-foreground">{snap.reviewStatusLabel}</span>
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2 shrink-0 justify-end">
                            <Button
                              size="sm"
                              variant="secondary"
                              className="gap-1"
                              disabled={snap.lockDisabled}
                              onClick={() => poMonthPanelRef.current?.lockPeriod(snap.poId)}
                            >
                              <Lock className="h-3.5 w-3.5" />
                              ปิดงวดสร้าง Payroll
                            </Button>
                            {!snap.sendHidden ? (
                              <Button
                                size="sm"
                                className="gap-1"
                                disabled={snap.sendDisabled}
                                onClick={() => poMonthPanelRef.current?.openSubmitDialog(snap.poId)}
                              >
                                <Send className="h-3.5 w-3.5" />
                                ส่งอนุมัติ Timesheet
                              </Button>
                            ) : null}
                            {currentUser && isSystemAdmin(currentUser) && !snap.unlockHidden ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1 border-destructive/40 text-destructive hover:bg-destructive/10"
                                disabled={snap.unlockDisabled}
                                onClick={() => poMonthPanelRef.current?.openUnlockDialog(snap.poId)}
                              >
                                <Unlock className="h-3.5 w-3.5" />
                                ปลดล็อก (Admin)
                              </Button>
                            ) : null}
                            {!snap.payrollSyncHidden ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1 border-emerald-600/40 text-emerald-800 dark:text-emerald-200"
                                disabled={snap.payrollSyncDisabled}
                                onClick={() => poMonthPanelRef.current?.syncPayrollReadyForPo(snap.poId)}
                              >
                                {snap.payrollSyncBusy ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <RefreshCw className="h-3.5 w-3.5" />
                                )}
                                ซิงก์พร้อมจ่าย
                              </Button>
                            ) : null}
                          </div>
                        </div>
                        <div className="rounded-lg border-2 border-orange-400/80 bg-orange-50/50 dark:bg-orange-950/25 dark:border-orange-700/70 px-3 py-3 space-y-3">
                          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                            <div className="space-y-0.5 min-w-0">
                              <p className="text-xs font-semibold text-orange-950 dark:text-orange-100">
                                แนบไฟล์ timesheet
                                {snap.isBundle ? (
                                  <> — ชุด PO Active ({snap.poCodesLabel ?? snap.poCode})</>
                                ) : (
                                  <> — {snap.poCode}</>
                                )}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                งวด <span className="font-mono text-foreground">{monthYm}</span>
                                {snap.isBundle ? ' · รวมทั้งชุด PO Active' : ' · ต่อ PO'}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="gap-1 bg-background"
                                disabled={snap.attachDisabled}
                                onClick={() => poMonthPanelRef.current?.openAttachPicker(snap.poId)}
                              >
                                {snap.attachUploading ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <ImagePlus className="h-3.5 w-3.5" />
                                )}
                                แนบรูป / PDF
                              </Button>
                              <span className="text-xs text-muted-foreground">
                                สูงสุด 4 ไฟล์
                              </span>
                            </div>
                          </div>
                          {snap.attachments.length > 0 ? (
                            <div className="flex flex-wrap gap-2 pt-1 border-t border-orange-300/50 dark:border-orange-800/50">
                              {snap.attachments.map((att) => (
                                <div key={att.id} className="relative">
                                  {isWaveMonthAttachmentPdf(att) ? (
                                    <a
                                      href={att.downloadUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex h-16 w-16 flex-col items-center justify-center rounded border bg-background text-[9px] hover:bg-muted"
                                    >
                                      <FileText className="h-6 w-6 text-primary" />
                                      <span>PDF</span>
                                    </a>
                                  ) : (
                                    <a href={att.downloadUrl} target="_blank" rel="noopener noreferrer" className="block">
                                      <img
                                        src={att.downloadUrl}
                                        alt={att.fileName}
                                        className="h-16 w-16 rounded border object-cover bg-background"
                                      />
                                    </a>
                                  )}
                                  {!snap.attachDisabled ? (
                                    <button
                                      type="button"
                                      className="absolute -right-1 -top-1 rounded-full bg-destructive p-0.5 text-destructive-foreground shadow"
                                      aria-label="ลบ"
                                      disabled={snap.attachUploading}
                                      onClick={() =>
                                        poMonthPanelRef.current?.removePoAttachment(
                                          snap.isBundle ? (att.sourcePoId ?? snap.anchorPoId ?? snap.poId) : snap.poId,
                                          att.id,
                                          att.storagePath,
                                        )
                                      }
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground border-t border-orange-300/40 pt-2 dark:border-orange-800/40">
                              {snap.isBundle ? 'ยังไม่มีไฟล์แนบสำหรับชุด PO Active นี้' : 'ยังไม่มีไฟล์แนบสำหรับ PO นี้'}
                            </p>
                          )}
                        </div>
                      </div>
                    </Alert>
                  ))
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground py-6 px-4 border border-dashed rounded-lg flex-1">
                เลือก<strong className="text-foreground">ลูกค้า / ชุด PO Active</strong> จากตัวกรองด้านขวาเพื่อดูตารางสรุปและปิดงวด payroll
              </p>
            )}
          </div>
          <div className="lg:col-span-2 min-w-0 flex flex-col">
            <div className="rounded-lg border bg-muted/30 px-4 py-3 space-y-3 flex-1 flex flex-col justify-center">
              {bundleOptions.length > 0 ? (
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase text-muted-foreground">
                    ลูกค้า / ชุด PO Active
                  </Label>
                  <Select
                    value={effectiveBundleId ?? ''}
                    onValueChange={(key) => {
                      replaceWaveMonthQuery((p) => {
                        p.set('poActiveBundleId', key);
                        p.delete('highlightPo');
                      });
                    }}
                  >
                    <SelectTrigger className="h-10 bg-background">
                      <SelectValue placeholder="เลือกลูกค้า / ชุดสัญญา…" />
                    </SelectTrigger>
                    <SelectContent>
                      {bundleOptions.map((b) => {
                        const name = customerNameById.get(b.customerId) ?? b.customerId;
                        const mode =
                          b.workMode === 'ONSHORE' ? 'Onshore' : b.workMode === 'OFFSHORE' ? 'Offshore' : '';
                        return (
                          <SelectItem key={b.key} value={b.key}>
                            {name}
                            {mode ? ` · ${mode}` : ''}
                            {b.poCodes.length ? ` — PO ${b.poCodes.join(', ')}` : ''}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase text-muted-foreground">เดือน (ปี-เดือน)</Label>
                <Input
                  type="month"
                  value={monthYm}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!/^\d{4}-\d{2}$/.test(v)) return;
                    replaceWaveMonthQuery((p) => {
                      p.set('month', v);
                      if (effectiveBundleId) {
                        p.set('poActiveBundleId', effectiveBundleId);
                      }
                    });
                  }}
                  className="h-10 font-mono bg-background"
                />
              </div>
            </div>
          </div>
        </div>

        {loading ? (
          <p className="text-center text-muted-foreground py-12">กำลังโหลด…</p>
        ) : (
          <div className="space-y-6">
            {!needsBundlePick ? (
            <Card id="wave-month-timesheet-grid">
              <CardHeader className="space-y-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1 space-y-1">
                    <CardTitle className="text-base">สรุปลงเวลารายเดือน</CardTitle>
                    <CardDescription className="space-y-2">
                      {activeBundleLabel ? (
                        <p className="font-medium text-foreground">{activeBundleLabel}</p>
                      ) : null}
                      <p>
                        พบ {sortedWaves.length} Wave สถานะเปิด · แสดงในตาราง {displayWaves.length} Wave
                        {pos != null ? ` · ${scopedPoIdSet.size} PO ในชุดนี้` : ''}
                        · ปิดงวด/แนบไฟล์รวมชุด PO Active ด้านบน
                      </p>
                      <p>
                        แถวต่อพนักงาน — เฉพาะคนที่ช่วงมอบหมายทับเดือนนี้ ·{' '}
                        <strong>รวมชม.</strong> = ชม.ทำงาน (W) และชม. Standby (SB/MO) แยกคอลัมน์ — รวมตามเซลล์ที่แสดงในแถว (ไม่นับวันที่เป็น «-»)
                      </p>
                    </CardDescription>
                  </div>
                  {dedupedTableRows.length > 0 ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 shrink-0 gap-2"
                      disabled={gridPrintBusy}
                      onClick={() => void handlePrintGridTable()}
                    >
                      {gridPrintBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Printer className="h-4 w-4" />
                      )}
                      พิมพ์ตาราง
                    </Button>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                {displayWaves.length === 0 ? (
                  <p className="text-center text-muted-foreground py-12 px-4 border-t">
                    ไม่มี Wave ที่เกี่ยวข้องในเดือนนี้ — ไม่มี mobilization ที่พร้อมลงเวลาและทับเดือนที่เลือกสำหรับ PO ที่เปิดอยู่
                  </p>
                ) : dedupedTableRows.length === 0 ? (
                  <p className="text-center text-muted-foreground py-10 px-4">
                    ยังไม่มีแถวในงวดนี้ — ไม่พบ mobilization ที่ผ่านเกณฑ์ลงเวลาและครอบคลุมเดือนนี้ (หรือยังไม่มี Wave ที่เกี่ยวข้อง)
                  </p>
                ) : (
                  <>
                    <Table className="min-w-max text-xs [&_th]:h-auto [&_th]:min-h-0 [&_th]:py-1.5 [&_th]:px-1.5 [&_tbody_td]:py-1.5 [&_tbody_td]:align-middle">
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className="sticky left-0 z-20 w-[11rem] min-w-[9.5rem] max-w-[13rem] bg-muted/95 font-bold shadow-[2px_0_4px_rgba(0,0,0,0.06)] px-2">
                            พนักงาน / ตำแหน่ง
                          </TableHead>
                          {days.map((d) => (
                            <TableHead key={d} className="px-0.5 text-center w-7 min-w-[1.75rem] font-mono text-[10px]" title={d}>
                              {d.slice(8, 10)}
                            </TableHead>
                          ))}
                          <TableHead
                            className="text-center font-bold min-w-[5.75rem] w-[5.75rem] shrink-0 text-[10px] leading-tight px-2"
                            title="ชม.ทำงาน (เฉพาะวันทำงาน) รวมตามเซลล์ W ในแถวนี้ — ไม่รวม standby"
                          >
                            รวมชม.
                            <br />
                            <span className="font-normal text-muted-foreground">(ทำงาน)</span>
                          </TableHead>
                          <TableHead
                            className="text-center font-bold min-w-[5.75rem] w-[5.75rem] shrink-0 text-[10px] leading-tight px-2"
                            title="ชม. standby (SB/MO) รวมตามเซลล์ในแถวนี้"
                          >
                            รวมชม.
                            <br />
                            <span className="font-normal text-muted-foreground">(Standby)</span>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dedupedTableRows.map((tr, rowIdx) => {
                          const { wave, po, rw, rosterAssignment } = tr;
                          const isFirstInWave =
                            rowIdx === 0 || dedupedTableRows[rowIdx - 1]!.wave.id !== wave.id;
                          const monthReview = reviewByWaveId.get(wave.id);
                          const waveMobs = eligibleMobsByWaveId.get(wave.id) ?? [];
                          const alternateMobIds = mobAssignments
                            .filter((m) => m.waveId === wave.id && m.workerId === rw.workerId && m.id !== rosterAssignment.id)
                            .map((m) => m.id);
                          const rowWorkerMonthWorkTotal =
                            rowWorkHoursMonthTotalByKey.get(`${wave.id}|${rw.workerId}|${rosterAssignment.id}`) ?? 0;
                          const rowWorkerMonthStandbyTotal =
                            rowStandbyHoursMonthTotalByKey.get(`${wave.id}|${rw.workerId}|${rosterAssignment.id}`) ?? 0;
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
                                className="sticky left-0 z-10 bg-background shadow-[2px_0_4px_rgba(0,0,0,0.06)] max-w-[13rem] px-2 py-1.5"
                                title={`${rw.name} · ${wave.waveCode?.trim() || wave.id}`}
                              >
                                <div className="flex min-w-0 flex-col gap-0.5">
                                  <span className="truncate text-xs font-medium leading-tight">{rw.name}</span>
                                  <span className="truncate font-mono text-[10px] leading-tight text-muted-foreground">
                                    {wave.waveCode?.trim() || wave.id}
                                  </span>
                                  <span
                                    className="truncate text-[10px] leading-tight text-foreground/90"
                                    title="ชื่อตำแหน่งจากการมอบหมาย (ทะเบียนตำแหน่ง)"
                                  >
                                    <span className="text-muted-foreground">ตำแหน่ง</span>{' '}
                                    {positionLabelById.get((rosterAssignment.positionId || '').trim()) ||
                                      (rosterAssignment.positionId ? rosterAssignment.positionId : '—')}
                                  </span>
                                </div>
                              </TableCell>
                              {days.map((d) => {
                                /** จับคู่แบบเดียวกับ resolve ในเซลล์ — คอลัมน์รวมชม.ใช้ logic เดียวกัน */
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
                                const inMobWindow = isYmdEditableForAssignmentTimesheet(rosterAssignment, d, {
                                  hasPersistedTimesheetOnDate: !!ts,
                                });
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
                              <TableCell
                                className="text-center font-bold tabular-nums text-xs min-w-[5.75rem] w-[5.75rem] shrink-0 px-2 py-1.5 text-sky-800"
                                title="ชม. standby (SB) รวมในแถวนี้"
                              >
                                {rowWorkerMonthStandbyTotal}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                    <div className="border-t px-4 py-3 text-xs text-muted-foreground space-y-1">
                      <p>
                        <strong>คีย์:</strong> ตัวอักษร = ประเภทวัน (W ทำงาน, SB สแตนด์บาย, T เดินทาง, M1 Mob, D1 Demob ฯลฯ) · เซลล์ «-» = ยังไม่มีบันทึกหรือวันไม่จ่าย —{' '}
                        <strong className="text-emerald-700">เขียว</strong>=ทำงาน{' '}
                        <strong className="text-sky-700">ฟ้า</strong>=สแตนด์บาย{' '}
                        <strong className="text-violet-700">ม่วง</strong>=เดินทาง{' '}
                        <strong className="text-orange-700">ส้ม</strong>=Mob/Demob (ดู tooltip)
                      </p>
                      <p>
                        <strong>ขอบสถานะ:</strong> วงแหวน <span className="text-amber-600">เหลืองทองหนา</span> = DRAFT —
                        วงบางเทา = ส่งอนุมัติ Timesheet แล้ว / อื่นๆ
                      </p>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
            ) : null}
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
