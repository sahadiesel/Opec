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
  PositionRate,
  POLine,
  PurchaseOrder,
  RateConditionEventType,
  User,
  Wave,
  WaveMonthTimesheetReview,
  Worker,
  TimesheetRetroAdjustment,
} from '@/lib/types';
import { positionListPrimaryName, type PositionDoc } from '@/lib/position-display';
import { useToast } from '@/hooks/use-toast';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccess, canEdit, canView, isMatrixControlledRole } from '@/lib/permissions';
import { PageGuidance } from '@/components/layout/page-guidance';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import {
  assignmentHasAnyMobTimesheetDayInCalendarMonth,
  isYmdWithinAssignmentMobTimesheetWindow,
  isYmdEditableForAssignmentTimesheet,
  waveMonthCellTimesheetVisible,
  waveRoundMonthLabel,
} from '@/lib/constants/timesheet-ui';
import { compareAssignmentWorkerNamesTh } from '@/lib/ops/mobilization-worker-name';
import { assignmentOverlapsYearMonthForPoDailyBoard } from '@/lib/ops/timesheet-hub-po-month';
import { syncPoActiveAutoDailyForAssignment, purgeStalePoActiveAutoDailyForCalendarMonth } from '@/lib/timesheet/po-active-auto-daily-sync';
import { isAssignmentEligibleForPoActiveAutoDaily } from '@/lib/timesheet/po-active-auto-daily-build';
import { thailandTodayYmd } from '@/lib/ops/mobilization-final-clearance';
import {
  defaultPackageHoursForWorkMode,
  formatMobDayChargeSummary,
  normalizeMobDayChargeSpec,
  resolveTimesheetBillingCharge,
  resolveTimesheetPayrollCharge,
} from '@/lib/ops/mob-day-charge';
import { buildMobDayChargeBahtPreviewRates } from '@/lib/ops/mob-day-charge-baht-preview';
import { MobDayChargeSideEditors } from '@/components/timesheet/mob-day-charge-side-editors';
import { resolveBillingSellWorkingDayRate } from '@/lib/commercial/position-rate-sell';
import { resolveMatrixCostRate } from '@/lib/commercial/position-rate-matrix';
import { rosterDeploymentTier } from '@/lib/ops/assignment-roster';
import {
  isWaveMonthAttachmentPdf,
  lastDayOfCalendarMonth,
  listDaysInMonth,
  mobilizationsEligibleForWaveMonthGrid,
  resolveTimesheetForWaveMonthCell,
  sumWorkHoursForWaveMonthRow,
  sumStandbyHoursForWaveMonthRow,
  sumOtHoursForWaveMonthRow,
  timesheetWaveMonthCellDisplay,
  timesheetWaveMonthCellDisplayWithRetro,
  timesheetEventCellBadgeClasses,
  timesheetRetroCellRingClasses,
  hasActiveRetroAdjustments,
  retroAddedOtHours,
  retroAddedM1Trips as sumRetroAddedM1Trips,
  retroAddedD1Trips as sumRetroAddedD1Trips,
  retroCellKey,
  isRetroOnlyPayrollMonth,
} from '@/lib/timesheet/wave-month-utils';
import { createTimesheetRetroAdjustment } from '@/lib/services/timesheet-retro-adjustment-service';
import {
  computeRetroAdjustmentPayFromFirestore,
  retroContractRatesUrl,
  RetroRateMatrixMissingError,
  type RetroMissingRateInfo,
} from '@/lib/payroll/retro-adjustment-pay';
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
import { WorkerMonthClosureCell, workerMonthClosureSummaryText } from '@/components/timesheet/worker-month-closure-cell';
import type { WorkerMonthTimesheetClosure, MobDayChargeSpec } from '@/lib/types';
import {
  clearWorkerMonthDeferred,
  fetchWorkerClosuresForPoIdsAndMonth,
  partialCloseWorkersForPoMonth,
  reopenWorkerMonthClosureForEdit,
  sendEntryLockedWorkersForManagerReview,
  setWorkerMonthDeferred,
  workerClosureByPoWorkerKey,
} from '@/lib/timesheet/worker-month-closure';
import {
  DEFERRED_SHIP_TIMESHEET_ALERT_DAYS,
  deferredClosureAgeDays,
  isDeferredClosureOverdue,
} from '@/lib/commercial/partial-po-month-billing';
import { isPoMonthFullGridLock } from '@/lib/timesheet/po-month-review-status';
import { isWorkerMonthClosureGridLocked } from '@/lib/timesheet/worker-month-closure';
import { ensureWorkerMonthlyPayrollPeriodForYearMonth, syncReadyPayrollFlagsForYearMonthFromAllGatedPoMonthReviews } from '@/lib/timesheet/po-month-timesheet-bridge';
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

function defaultApplyPayrollYmAfter(sourceYm: string): string {
  const [y, m] = sourceYm.split('-').map(Number);
  if (!y || !m) return ymNow();
  let nm = m + 1;
  let ny = y;
  if (nm > 12) {
    nm = 1;
    ny += 1;
  }
  return `${ny}-${String(nm).padStart(2, '0')}`;
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

function isMonthTimesheetRowLocked(
  poReview: PoMonthTimesheetReview | undefined,
  waveReview: WaveMonthTimesheetReview | undefined,
  workerClosure: WorkerMonthTimesheetClosure | undefined,
): boolean {
  if (workerClosure) {
    if (
      workerClosure.status === 'deferred' ||
      workerClosure.status === 'open' ||
      workerClosure.status === 'rejected'
    ) {
      return false;
    }
    return isWorkerMonthClosureGridLocked(workerClosure.status);
  }
  if (isPoMonthFullGridLock(poReview)) return true;
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
  poLine?: POLine | null;
  positionRate?: PositionRate | null;
};

async function loadCellEditRateContext(
  firestore: import('firebase/firestore').Firestore,
  assignment: Assignment,
  po: PurchaseOrder | undefined,
): Promise<{ poLine: POLine | null; positionRate: PositionRate | null }> {
  const poId = (assignment.poId || po?.id || '').trim();
  const poLineId = (assignment.poLineId || '').trim();
  const contractId = (assignment.contractId || po?.contractId || '').trim();
  const positionId = (assignment.positionId || '').trim();
  let poLine: POLine | null = null;
  let positionRate: PositionRate | null = null;
  try {
    if (poId && poLineId) {
      const lineSnap = await getDoc(doc(firestore, 'purchase_orders', poId, 'po_lines', poLineId));
      if (lineSnap.exists()) {
        poLine = { id: lineSnap.id, ...(lineSnap.data() as object) } as POLine;
      }
    }
    if (contractId && positionId) {
      const ratesSnap = await getDocs(collection(firestore, 'main_contracts', contractId, 'position_rates'));
      const rates = ratesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) } as PositionRate));
      positionRate = rates.find((r) => r.positionId === positionId && r.active !== false) ?? null;
    }
  } catch {
    /* preview optional */
  }
  return { poLine, positionRate };
}

function isTimesheetPayrollLocked(ts: DailyTimesheet | undefined): boolean {
  return ts?.status === 'LOCKED';
}

function canCorrectTimesheetOtDirect(ts: DailyTimesheet | undefined): boolean {
  return !!ts?.id && ts.status !== 'LOCKED';
}

function buildSyntheticTimesheetForRetro(input: {
  workerId: string;
  workerName: string;
  assignment: Assignment;
  wave: Wave;
  po: PurchaseOrder | undefined;
  cellDate: string;
  existingTs?: DailyTimesheet;
}): DailyTimesheet {
  const { workerId, workerName, assignment, wave, po, cellDate, existingTs } = input;
  const contractId = (assignment.contractId || po?.contractId || '').trim();
  const poLineId = (assignment.poLineId || wave.poLineId || '').trim();
  const positionId = (assignment.positionId || '').trim();
  const id = `${workerId}_${assignment.id}_${cellDate}`;
  const eventType = (existingTs?.eventType as RateConditionEventType) ?? 'mobilization_day';
  return {
    id,
    workerId,
    assignmentId: assignment.id,
    date: cellDate,
    eventType,
    normalHours: existingTs?.normalHours ?? 12,
    ot15Hours: existingTs?.ot15Hours ?? 0,
    ot20Hours: 0,
    ot30Hours: 0,
    waveId: wave.id,
    siteId: wave.id,
    purchaseOrderId: assignment.poId || wave.poId,
    poLineId,
    contractId,
    customerId: wave.customerId || '',
    positionId,
    workMode: assignment.workMode ?? 'OFFSHORE',
    shiftType: 'DAY',
    workerNameSnapshot: existingTs?.workerNameSnapshot || workerName,
    status: existingTs?.status ?? 'LOCKED',
  } as DailyTimesheet;
}

type RetroEditContext = {
  timesheet: DailyTimesheet;
  workerName: string;
  po: PurchaseOrder | undefined;
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
  const [retroEdit, setRetroEdit] = useState<RetroEditContext | null>(null);
  const [retroAddedOt, setRetroAddedOt] = useState(0);
  const [retroTargetOt, setRetroTargetOt] = useState(0);
  const [retroAddedStandby, setRetroAddedStandby] = useState(0);
  const [retroAddedM1Trips, setRetroAddedM1Trips] = useState(0);
  const [retroAddedD1Trips, setRetroAddedD1Trips] = useState(0);
  const [retroApplyYm, setRetroApplyYm] = useState('');
  const [retroReason, setRetroReason] = useState('');
  const [retroSaving, setRetroSaving] = useState(false);
  const [retroPayPreview, setRetroPayPreview] = useState<number | null>(null);
  const [retroPayPreviewLoading, setRetroPayPreviewLoading] = useState(false);
  const [retroPayMissing, setRetroPayMissing] = useState<RetroMissingRateInfo[]>([]);
  const [retroPayContractId, setRetroPayContractId] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editEvent, setEditEvent] = useState<RateConditionEventType>('work_day');
  const [editHours, setEditHours] = useState(12);
  const [editOtHours, setEditOtHours] = useState(0);
  const [editRemark, setEditRemark] = useState('');
  const [editBillingCharge, setEditBillingCharge] = useState<MobDayChargeSpec>({ kind: 'M1', hours: 12 });
  const [editPayrollCharge, setEditPayrollCharge] = useState<MobDayChargeSpec>({ kind: 'M1', hours: 12 });
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
    const pkg = defaultPackageHoursForWorkMode(cellEdit.assignment?.workMode);
    setEditDate(ts?.date ?? cellEdit.cellDate);
    setEditEvent((ts?.eventType as RateConditionEventType) ?? 'work_day');
    const nh = typeof ts?.normalHours === 'number' ? ts.normalHours : pkg;
    const et = (ts?.eventType as RateConditionEventType) ?? 'work_day';
    const needsPkg =
      et === 'mobilization_day' || et === 'demobilization_day' || et === 'standby_day';
    setEditHours(needsPkg ? (nh > 0 ? nh : pkg) : nh > 0 ? nh : pkg);
    setEditOtHours(typeof ts?.ot15Hours === 'number' ? ts.ot15Hours : 0);
    setEditRemark(ts?.remark ?? '');
    if (ts && needsPkg) {
      setEditBillingCharge(resolveTimesheetBillingCharge(ts));
      setEditPayrollCharge(resolveTimesheetPayrollCharge(ts));
    } else if (et === 'mobilization_day') {
      setEditBillingCharge({ kind: 'M1', hours: pkg });
      setEditPayrollCharge({ kind: 'M1', hours: pkg });
    } else if (et === 'demobilization_day') {
      setEditBillingCharge({ kind: 'D1', hours: pkg });
      setEditPayrollCharge({ kind: 'D1', hours: pkg });
    } else {
      setEditBillingCharge({ kind: 'STANDBY', hours: pkg });
      setEditPayrollCharge({ kind: 'STANDBY', hours: pkg });
    }
  }, [cellEdit]);

  const monthCellPreviewRates = useMemo(() => {
    if (!cellEdit) return null;
    const workMode = (cellEdit.assignment.workMode === 'ONSHORE' ? 'ONSHORE' : 'OFFSHORE') as
      | 'ONSHORE'
      | 'OFFSHORE';
    const pkg = defaultPackageHoursForWorkMode(cellEdit.assignment.workMode);
    const line = cellEdit.poLine;
    const positionRate = cellEdit.positionRate ?? null;
    const sellWorking = line
      ? resolveBillingSellWorkingDayRate({
          poLine: line,
          workMode,
          contractRate: positionRate ?? undefined,
        })
      : 0;
    const costWorking = Math.max(
      0,
      Number(line?.costBaselineSnapshot) ||
        (positionRate
          ? resolveMatrixCostRate(
              positionRate,
              workMode === 'ONSHORE' ? 'onshore_working_day' : 'offshore_working_day',
            ) ?? 0
          : 0),
    );
    const otMult =
      Number((line?.costOtRulesSnapshot as { afterShift?: number } | undefined)?.afterShift) || 1.5;
    return buildMobDayChargeBahtPreviewRates({
      packageHours: pkg,
      positionRate,
      sellWorkingDayRate: sellWorking,
      costWorkingDayRate: costWorking,
      otAfterShiftMultiplier: otMult,
      workMode: cellEdit.assignment.workMode,
    });
  }, [cellEdit]);

  useEffect(() => {
    if (!retroEdit) return;
    const ts = retroEdit.timesheet;
    if (ts.eventType === 'work_day' && canCorrectTimesheetOtDirect(ts)) {
      setRetroTargetOt(typeof ts.ot15Hours === 'number' ? ts.ot15Hours : 0);
      setRetroAddedOt(0);
    } else {
      setRetroTargetOt(0);
      setRetroAddedOt(0);
    }
    setRetroAddedStandby(0);
    setRetroAddedM1Trips(retroEdit.timesheet.eventType === 'mobilization_day' ? 1 : 0);
    setRetroAddedD1Trips(retroEdit.timesheet.eventType === 'demobilization_day' ? 1 : 0);
    setRetroApplyYm(defaultApplyPayrollYmAfter(monthYm));
    setRetroReason('');
    setRetroPayPreview(null);
    setRetroPayMissing([]);
    setRetroPayContractId('');
  }, [retroEdit, monthYm]);

  useEffect(() => {
    if (!firestore || !retroEdit) {
      setRetroPayPreview(null);
      setRetroPayPreviewLoading(false);
      setRetroPayMissing([]);
      setRetroPayContractId('');
      return;
    }
    const ot = Math.max(0, Number(retroAddedOt) || 0);
    const sb = Math.max(0, Number(retroAddedStandby) || 0);
    const m1 = Math.max(0, Number(retroAddedM1Trips) || 0);
    const d1 = Math.max(0, Number(retroAddedD1Trips) || 0);
    if (ot + sb + m1 + d1 <= 0) {
      setRetroPayPreview(null);
      setRetroPayPreviewLoading(false);
      setRetroPayMissing([]);
      setRetroPayContractId('');
      return;
    }
    let cancelled = false;
    setRetroPayPreviewLoading(true);
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await computeRetroAdjustmentPayFromFirestore(firestore, retroEdit.timesheet, {
            addedOt15Hours: retroEdit.timesheet.eventType === 'work_day' ? ot : undefined,
            addedStandbyHours:
              retroEdit.timesheet.eventType === 'mobilization_day' ||
              retroEdit.timesheet.eventType === 'demobilization_day' ||
              retroEdit.timesheet.eventType === 'standby_day'
                ? sb
                : undefined,
            addedM1Trips: retroEdit.timesheet.eventType === 'mobilization_day' ? m1 : undefined,
            addedD1Trips: retroEdit.timesheet.eventType === 'demobilization_day' ? d1 : undefined,
          });
          if (cancelled) return;
          setRetroPayPreview(result.ok ? result.amountBaht : null);
          setRetroPayMissing(result.missingRates);
          setRetroPayContractId(result.contractId);
        } catch {
          if (!cancelled) {
            setRetroPayPreview(null);
            setRetroPayMissing([]);
          }
        } finally {
          if (!cancelled) setRetroPayPreviewLoading(false);
        }
      })();
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [firestore, retroEdit, retroAddedOt, retroAddedStandby, retroAddedM1Trips, retroAddedD1Trips]);

  useEffect(() => {
    if (editEvent !== 'work_day') setEditOtHours(0);
  }, [editEvent]);

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

  const [workerClosureRows, setWorkerClosureRows] = useState<WorkerMonthTimesheetClosure[]>([]);
  const [workerClosureLoading, setWorkerClosureLoading] = useState(false);
  const [selectedPartialKeys, setSelectedPartialKeys] = useState<Set<string>>(() => new Set());
  const [partialWorkflowBusy, setPartialWorkflowBusy] = useState(false);

  const refreshWorkerClosures = useCallback(async () => {
    if (!firestore || !monthYm || scopedPoIdsList.length === 0) {
      setWorkerClosureRows([]);
      return;
    }
    const rows = await fetchWorkerClosuresForPoIdsAndMonth(firestore, scopedPoIdsList, monthYm);
    setWorkerClosureRows(rows);
  }, [firestore, monthYm, scopedPoIdsList]);

  useEffect(() => {
    let cancelled = false;
    if (!firestore || !monthYm || scopedPoIdsList.length === 0) {
      setWorkerClosureRows([]);
      return;
    }
    setWorkerClosureLoading(true);
    void fetchWorkerClosuresForPoIdsAndMonth(firestore, scopedPoIdsList, monthYm)
      .then((rows) => {
        if (!cancelled) setWorkerClosureRows(rows);
      })
      .catch((err: unknown) => {
        console.warn('[wave-month] worker_month_timesheet_closures:', err);
        if (!cancelled) setWorkerClosureRows([]);
      })
      .finally(() => {
        if (!cancelled) setWorkerClosureLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [firestore, monthYm, scopedPoIdsList]);

  const workerClosureByKey = useMemo(
    () => workerClosureByPoWorkerKey(workerClosureRows),
    [workerClosureRows],
  );

  const retroAdjustmentsQuery = useMemoFirebase(
    () =>
      firestore && canViewTs && monthYm && /^\d{4}-\d{2}$/.test(monthYm)
        ? query(collection(firestore, 'timesheet_retro_adjustments'), where('sourceYearMonth', '==', monthYm))
        : null,
    [firestore, canViewTs, monthYm],
  );
  const { data: retroAdjustmentRows } = useCollection<TimesheetRetroAdjustment>(retroAdjustmentsQuery as any);
  const retroByTimesheetId = useMemo(() => {
    const m = new Map<string, TimesheetRetroAdjustment[]>();
    for (const r of retroAdjustmentRows ?? []) {
      if (r.status === 'void') continue;
      const list = m.get(r.sourceTimesheetId) ?? [];
      list.push(r);
      m.set(r.sourceTimesheetId, list);
    }
    return m;
  }, [retroAdjustmentRows]);

  const retroByCellKey = useMemo(() => {
    const m = new Map<string, TimesheetRetroAdjustment[]>();
    for (const r of retroAdjustmentRows ?? []) {
      if (r.status === 'void') continue;
      if (!r.assignmentId || !r.workDateYmd) continue;
      const k = retroCellKey(r.assignmentId, r.workDateYmd);
      const list = m.get(k) ?? [];
      list.push(r);
      m.set(k, list);
    }
    return m;
  }, [retroAdjustmentRows]);

  const retroOnlyPayrollMonth = useMemo(
    () => isRetroOnlyPayrollMonth(monthYm, monthSheetsForOpenPos, poMonthRows ?? undefined),
    [monthYm, monthSheetsForOpenPos, poMonthRows],
  );

  /** เติมรายวันอัตโนมัติของวันนี้ (เขตไทย) — เหมือน PO Daily Board เพื่อให้หน้ารายเดือนเห็นข้อมูลโดยไม่ต้องเปิดกระดานรายวัน */
  const silentPoActiveAutoDailyIds = useMemo(() => {
    const today = thailandTodayYmd();
    if (!today.startsWith(monthYm)) return [];
    const ids: string[] = [];
    for (const a of mobAssignments) {
      if (!isAssignmentEligibleForPoActiveAutoDaily(a)) continue;
      if (!assignmentOverlapsYearMonthForPoDailyBoard(a, monthYm)) continue;
      if (isWaveMonthReviewLocked(reviewByWaveId.get(a.waveId))) continue;
      if (isPoMonthFullGridLock(poMonthByPoId.get(a.poId))) continue;
      const workerClosure = workerClosureByKey.get(`${a.poId}|${a.workerId}`);
      if (workerClosure && isWorkerMonthClosureGridLocked(workerClosure.status)) continue;
      if (!assignmentHasAnyMobTimesheetDayInCalendarMonth(a, monthYm)) continue;
      ids.push(a.id);
    }
    return ids;
  }, [mobAssignments, monthYm, reviewByWaveId, poMonthByPoId, workerClosureByKey]);

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
      for (const a of mobAssignments) {
        if ((a.mobLocationEndDate || '').trim()) {
          try {
            await purgeStalePoActiveAutoDailyForCalendarMonth(firestore, a.id, monthYm);
          } catch {
            /* best-effort */
          }
        }
      }
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
  }, [firestore, currentUser, canEditTs, silentPoActiveAutoDailyIds, mobAssignments, monthYm]);

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

  /** รวมชม. OT ต่อแถว — รวมแก้ไขย้อนหลัง */
  const rowOtHoursMonthTotalByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const tr of tableRows) {
      const { wave, rw, rosterAssignment } = tr;
      const key = `${wave.id}|${rw.workerId}|${rosterAssignment.id}`;
      const alternateMobIds = mobAssignments
        .filter((mob) => mob.waveId === wave.id && mob.workerId === rw.workerId && mob.id !== rosterAssignment.id)
        .map((mob) => mob.id);
      let sum = sumOtHoursForWaveMonthRow(
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
      );
      for (const d of days) {
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
        if (ts) sum += retroAddedOtHours(retroByTimesheetId.get(ts.id) ?? []);
      }
      m.set(key, sum);
    }
    return m;
  }, [tableRows, days, sheetsByWaveWorker, monthSheetsForOpenPos, mobAssignments, retroByTimesheetId]);

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
      const aTier = rosterDeploymentTier(a.tr.rosterAssignment.deploymentStatus);
      const bTier = rosterDeploymentTier(b.tr.rosterAssignment.deploymentStatus);
      if (aTier !== bTier) return aTier > bTier;
      if (a.assignmentMatchCount !== b.assignmentMatchCount) return a.assignmentMatchCount > b.assignmentMatchCount;
      if (a.waveMatchCount !== b.waveMatchCount) return a.waveMatchCount > b.waveMatchCount;
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

  const isRowLockedForWorker = useCallback(
    (
      po: PurchaseOrder | undefined,
      monthReview: WaveMonthTimesheetReview | undefined,
      workerId: string,
    ) => {
      const closure = po?.id ? workerClosureByKey.get(`${po.id}|${workerId}`) : undefined;
      return isMonthTimesheetRowLocked(
        po?.id ? poMonthByPoId.get(po.id) : undefined,
        monthReview,
        closure,
      );
    },
    [workerClosureByKey, poMonthByPoId],
  );

  const partialCloseStats = useMemo(() => {
    const entryLocked = workerClosureRows.filter((c) => c.status === 'entry_locked').length;
    const selectable = dedupedTableRows.filter((tr) => {
      const po = tr.po;
      if (!po?.id) return false;
      const closure = workerClosureByKey.get(`${po.id}|${tr.rw.workerId}`);
      if (closure?.status === 'deferred') return false;
      if (closure && isWorkerMonthClosureGridLocked(closure.status)) return false;
      return true;
    }).length;
    return { entryLocked, selectable, selected: selectedPartialKeys.size };
  }, [workerClosureRows, dedupedTableRows, workerClosureByKey, selectedPartialKeys.size]);

  const overdueDeferredClosures = useMemo(() => {
    return workerClosureRows
      .filter((c) => c.yearMonth === monthYm && isDeferredClosureOverdue(c))
      .sort((a, b) => deferredClosureAgeDays(b) - deferredClosureAgeDays(a));
  }, [workerClosureRows, monthYm]);

  const handlePartialCloseSelected = useCallback(async () => {
    if (!firestore || !currentUser || !canEditTs) return;
    const byPo = new Map<string, Array<{ workerId: string; workerName?: string }>>();
    for (const tr of dedupedTableRows) {
      const po = tr.po;
      if (!po?.id) continue;
      const key = `${po.id}|${tr.rw.workerId}`;
      if (!selectedPartialKeys.has(key)) continue;
      const list = byPo.get(po.id) ?? [];
      list.push({ workerId: tr.rw.workerId, workerName: tr.rw.name });
      byPo.set(po.id, list);
    }
    if (byPo.size === 0) {
      toast({ variant: 'destructive', title: 'ไม่ได้เลือกคนงาน', description: 'ติ๊กเลือกคนที่พร้อมปิดงวดในตาราง' });
      return;
    }
    setPartialWorkflowBusy(true);
    try {
      let total = 0;
      for (const [poId, workers] of byPo) {
        const res = await partialCloseWorkersForPoMonth(firestore, {
          poId,
          yearMonth: monthYm,
          workers,
          actor: currentUser as User,
        });
        total += res.closed;
      }
      await refreshWorkerClosures();
      setSelectedPartialKeys(new Set());
      const actorName = currentUser.displayName || currentUser.email || currentUser.id;
      await ensureWorkerMonthlyPayrollPeriodForYearMonth(firestore, monthYm, actorName);
      toast({
        title: `ปิดงวดบางส่วน ${total} คน`,
        description:
          'แก้ไขไม่ได้สำหรับคนที่ปิดแล้ว · ระบบตั้ง readyForPayroll แล้ว — ไป Payroll Batch ตรวจสอบได้ · ส่งผู้จัดการอนุมัติเมื่อพร้อม',
      });
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'ปิดงวดบางส่วนไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setPartialWorkflowBusy(false);
    }
  }, [
    firestore,
    currentUser,
    canEditTs,
    dedupedTableRows,
    selectedPartialKeys,
    monthYm,
    refreshWorkerClosures,
    toast,
  ]);

  const handleSyncPayrollReadyFlags = useCallback(async () => {
    if (!firestore || !monthYm) return;
    setPartialWorkflowBusy(true);
    try {
      const sync = await syncReadyPayrollFlagsForYearMonthFromAllGatedPoMonthReviews(firestore, monthYm);
      toast({
        title: 'ซิงก์พร้อมจ่าย Payroll แล้ว',
        description:
          sync.updated > 0
            ? `ตั้ง readyForPayroll ${sync.updated} ใบงาน (${sync.syncedPoCount} PO)`
            : 'ไม่พบใบงานที่อัปเดตได้ — อาจตั้งค่าแล้วหรือถูก LOCKED',
      });
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'ซิงก์ไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setPartialWorkflowBusy(false);
    }
  }, [firestore, monthYm, toast]);

  const handleSendPartialForReview = useCallback(async () => {
    if (!firestore || !currentUser || !canEditTs) return;
    const poIds = [...new Set(workerClosureRows.filter((c) => c.status === 'entry_locked').map((c) => c.poId))];
    if (poIds.length === 0) {
      toast({
        variant: 'destructive',
        title: 'ดำเนินการไม่ได้',
        description: 'ไม่มีคนงานที่ปิดงวดแล้วรอส่งอนุมัติ',
      });
      return;
    }
    setPartialWorkflowBusy(true);
    try {
      let sent = 0;
      for (const poId of poIds) {
        const res = await sendEntryLockedWorkersForManagerReview(firestore, {
          poId,
          yearMonth: monthYm,
          actor: currentUser as User,
        });
        sent += res.sent;
      }
      await refreshWorkerClosures();
      toast({
        title: `ส่งอนุมัติ ${sent} คน`,
        description: 'ผู้จัดการอนุมัติรายคนที่เมนู อนุมัติ → Timesheet รอบเดือน',
      });
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'ส่งอนุมัติไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setPartialWorkflowBusy(false);
    }
  }, [firestore, currentUser, canEditTs, workerClosureRows, monthYm, refreshWorkerClosures, toast]);

  const handleMarkWorkerDeferred = useCallback(
    async (poId: string, workerId: string, workerName: string) => {
      if (!firestore || !currentUser || !canEditTs) return;
      setPartialWorkflowBusy(true);
      try {
        await setWorkerMonthDeferred(firestore, {
          poId,
          yearMonth: monthYm,
          workerId,
          workerName,
          actor: currentUser as User,
        });
        await refreshWorkerClosures();
        toast({ title: 'ตั้งรอ timesheet แล้ว', description: workerName });
      } catch (e: unknown) {
        toast({
          variant: 'destructive',
          title: 'บันทึกไม่สำเร็จ',
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setPartialWorkflowBusy(false);
      }
    },
    [firestore, currentUser, canEditTs, monthYm, refreshWorkerClosures, toast],
  );

  const handleClearWorkerDeferred = useCallback(
    async (poId: string, workerId: string, workerName: string) => {
      if (!firestore || !currentUser || !canEditTs) return;
      setPartialWorkflowBusy(true);
      try {
        await clearWorkerMonthDeferred(firestore, {
          poId,
          yearMonth: monthYm,
          workerId,
          workerName,
          actor: currentUser as User,
        });
        await refreshWorkerClosures();
        toast({ title: 'กลับเป็นพร้อมปิดงวด', description: workerName });
      } catch (e: unknown) {
        toast({
          variant: 'destructive',
          title: 'บันทึกไม่สำเร็จ',
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setPartialWorkflowBusy(false);
      }
    },
    [firestore, currentUser, canEditTs, monthYm, refreshWorkerClosures, toast],
  );

  const handleReopenWorkerClosure = useCallback(
    async (poId: string, workerId: string, workerName: string) => {
      if (!firestore || !currentUser || !canEditTs) return;
      setPartialWorkflowBusy(true);
      try {
        await reopenWorkerMonthClosureForEdit(firestore, {
          poId,
          yearMonth: monthYm,
          workerId,
          workerName,
          actor: currentUser as User,
        });
        await refreshWorkerClosures();
        toast({
          title: 'ยกเลิกปิดงวดแล้ว',
          description: `${workerName} — แก้ชม./OT/ประเภทวันได้จนกว่าจะปิดงวดใหม่`,
        });
      } catch (e: unknown) {
        toast({
          variant: 'destructive',
          title: 'ยกเลิกปิดงวดไม่สำเร็จ',
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setPartialWorkflowBusy(false);
      }
    },
    [firestore, currentUser, canEditTs, monthYm, refreshWorkerClosures, toast],
  );

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
          const tsRaw = resolveTimesheetForWaveMonthCell(
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
          if (!waveMonthCellTimesheetVisible(rosterAssignment, d, tsRaw)) return '-';
          if (tsRaw) return timesheetWaveMonthCellDisplay(tsRaw);
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
    async (
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
      const tsLocked = isTimesheetPayrollLocked(ts);
      if (tsLocked) {
        setRetroEdit({ timesheet: ts!, workerName: rw.name, po });
        return;
      }
      if (ts && canCorrectTimesheetOtDirect(ts)) {
        const assignment =
          waveMobs.find((m) => m.id === ts.assignmentId) ?? waveMobs.find((m) => m.workerId === rw.workerId);
        if (!assignment) {
          toast({
            variant: 'destructive',
            title: 'ไม่พบการมอบหมาย',
            description: 'เพิ่ม Mobilization / Assignment ใน Wave ก่อน',
          });
          return;
        }
        const rateCtx = firestore
          ? await loadCellEditRateContext(firestore, assignment, po)
          : { poLine: null, positionRate: null };
        setCellEdit({
          wave,
          po,
          monthReview,
          workerId: rw.workerId,
          workerName: rw.name,
          assignment,
          cellDate,
          timesheet: ts,
          ...rateCtx,
        });
        return;
      }
      if (retroOnlyPayrollMonth) {
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
            description: 'อยู่นอกช่วง mobilization',
          });
          return;
        }
        const retroTs =
          ts ??
          buildSyntheticTimesheetForRetro({
            workerId: rw.workerId,
            workerName: rw.name,
            assignment,
            wave,
            po,
            cellDate,
          });
        setRetroEdit({ timesheet: retroTs, workerName: rw.name, po });
        return;
      }
      if (isRowLockedForWorker(po, monthReview, rw.workerId)) {
        toast({
          variant: 'destructive',
          title: 'งวดนี้แก้ไขไม่ได้',
          description: 'เอกสาร PO+งวดถูกล็อก/ส่งตรวจแล้ว หรืองวดราย wave เดิมล็อกแล้ว',
        });
        return;
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
        ...(firestore ? await loadCellEditRateContext(firestore, assignment, po) : {}),
      });
    },
    [canEditTs, toast, isRowLockedForWorker, retroOnlyPayrollMonth, firestore],
  );

  const performSaveCellEdit = useCallback(async () => {
    if (!firestore || !currentUser || !cellEdit) return;
    const { wave, po, monthReview, workerId, workerName, assignment, timesheet: openedTs } = cellEdit;
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

    const closedPeriodCorrection =
      !!baseTs && canCorrectTimesheetOtDirect(baseTs) && service.isFinalized(baseTs.status as DailyTimesheetStatus);

    if (retroOnlyPayrollMonth && !closedPeriodCorrection) {
      toast({
        variant: 'destructive',
        title: 'งวด payroll ปิดแล้ว',
        description: 'ใช้ «แก้ไขย้อนหลัง» แทน — จะจ่ายในงวดถัดไปโดยไม่แก้ใบงานต้นทาง',
      });
      return;
    }
    if (!canEditTs || (isRowLockedForWorker(po, monthReview, workerId) && !closedPeriodCorrection)) {
      toast({
        variant: 'destructive',
        title: 'บันทึกไม่ได้',
        description: 'ไม่มีสิทธิ์หรืองวดถูกปิดแล้ว',
      });
      return;
    }

    const inMobWindow = isYmdEditableForAssignmentTimesheet(assignment, editDate, {
      hasPersistedTimesheetOnDate: !!(openedTs || baseTs),
    });
    if (!inMobWindow && !closedPeriodCorrection) {
      toast({
        variant: 'destructive',
        title: 'วันนี้บันทึกไม่ได้',
        description: 'อยู่นอกช่วง mobilization ที่อนุญาต — ลองยกเลิกจบงานบน Wave Board ถ้าต้องการลงเวลาต่อ',
      });
      return;
    }

    const isWorkDay = editEvent === 'work_day';
    const otHours = isWorkDay ? Math.min(24, Math.max(0, Number(editOtHours) || 0)) : 0;

    if (closedPeriodCorrection && baseTs) {
      setSavingCell(true);
      try {
        await service.correctClosedPeriodTimesheetHours(baseTs.id, currentUser, {
          ot15Hours: otHours,
          normalHours:
            editEvent === 'unpaid_leave' ? 0 : Math.min(24, Math.max(0, Number(editHours) || 0)),
          reason: editRemark.trim() || 'แก้ OT จาก wave-month',
        });
        toast({ title: 'บันทึกแล้ว', description: `อัปเดต OT เป็น ${otHours} ชม.` });
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
      const isWorkDay = editEvent === 'work_day';
      const isMobLike =
        editEvent === 'mobilization_day' ||
        editEvent === 'demobilization_day' ||
        editEvent === 'standby_day';
      const pkg = defaultPackageHoursForWorkMode(assignment.workMode);
      const billing = normalizeMobDayChargeSpec(editBillingCharge, pkg);
      const payroll = normalizeMobDayChargeSpec(editPayrollCharge, pkg);
      /** ชม.บนตาราง — ถ้าจ่ายเป็น SB/W ใช้ชม.ฝั่งจ่าย (เช่น จ่าย 8 แต่บิล M1 ตามสัญญา) */
      const nHours = isUnpaid
        ? 0
        : isWorkDay
          ? Math.min(24, Math.max(0, Number(editHours) || 0))
          : isMobLike
            ? Math.min(
                24,
                Math.max(
                  0,
                  Number(
                    payroll.kind === 'STANDBY' || payroll.kind === 'WORKING'
                      ? payroll.hours
                      : billing.kind === 'STANDBY' || billing.kind === 'WORKING'
                        ? billing.hours
                        : payroll.hours ?? billing.hours ?? pkg,
                  ) || pkg,
                ),
              )
            : Math.min(24, Math.max(0, Number(editHours) || 0));
      const otHours = isWorkDay ? Math.min(24, Math.max(0, Number(editOtHours) || 0)) : 0;

      const priorRemark = String(baseTs?.remark || '').trim();
      const manualRemark = editRemark.trim();
      const chargeRemark =
        isMobLike
          ? `Mob — แก้รายเดือน · วางบิล ${formatMobDayChargeSummary(billing)} · จ่าย ${formatMobDayChargeSummary(payroll)}`
          : '';
      const nextRemark = manualRemark
        ? manualRemark
        : chargeRemark || (priorRemark.startsWith('Auto —') ? '' : priorRemark);

      const payload: Partial<DailyTimesheet> = {
        ...(baseTs ? { ...baseTs, id: undefined } : {}),
        workerId,
        assignmentId: assignment.id,
        date: editDate,
        eventType: editEvent,
        normalHours: nHours,
        ot15Hours: otHours,
        ot20Hours: 0,
        ot30Hours: 0,
        remark: nextRemark,
        waveId: wave.id,
        siteId: wave.id,
        purchaseOrderId: assignment.poId || wave.poId,
        poLineId,
        contractId,
        customerId: wave.customerId || '',
        positionId,
        workMode: assignment.workMode ?? 'OFFSHORE',
        shiftType: editEvent === 'standby_day' || payroll.kind === 'STANDBY' ? 'STANDBY' : 'DAY',
        workerNameSnapshot: nameSnap,
        poActiveAutoDaily: false,
      };

      if (isMobLike) {
        payload.mobBillingChargeKind = billing.kind;
        payload.mobPayrollChargeKind = payroll.kind;
        payload.mobBillingChargeHours = billing.hours ?? pkg;
        payload.mobPayrollChargeHours = payroll.hours ?? pkg;
        if (
          (billing.kind === 'M1' || billing.kind === 'D1') &&
          billing.m1AmountOverride != null &&
          billing.m1AmountOverride > 0
        ) {
          payload.mobBillingM1AmountOverride = billing.m1AmountOverride;
        }
        if (
          (payroll.kind === 'M1' || payroll.kind === 'D1') &&
          payroll.m1AmountOverride != null &&
          payroll.m1AmountOverride > 0
        ) {
          payload.mobPayrollM1AmountOverride = payroll.m1AmountOverride;
        }
        payload.mobUnits = billing.kind === 'M1' || payroll.kind === 'M1' ? 1 : 0;
        payload.standbyUnits =
          billing.kind === 'STANDBY' || payroll.kind === 'STANDBY' ? 1 : 0;
        if (
          editEvent === 'demobilization_day' ||
          billing.kind === 'D1' ||
          payroll.kind === 'D1'
        ) {
          payload.demobUnits = Math.max(1, Number(baseTs?.demobUnits) || 1);
        }
      }

      if (!baseTs) {
        payload.status = 'DRAFT';
      } else if (baseTs.status && service.canEdit(baseTs.status as DailyTimesheetStatus)) {
        payload.status = baseTs.status;
      } else {
        payload.status = 'DRAFT';
      }

      await service.bulkUpsertTimesheets([payload], currentUser);
      toast({
        title: 'บันทึกแล้ว',
        description: isMobLike
          ? `วางบิล ${formatMobDayChargeSummary(billing)} · จ่าย ${formatMobDayChargeSummary(payroll)}`
          : 'อัปเดตลงเวลารายวันเรียบร้อย',
      });
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
    editOtHours,
    editRemark,
    editBillingCharge,
    editPayrollCharge,
    allWorkers,
    retroOnlyPayrollMonth,
    isRowLockedForWorker,
  ]);

  const performSaveRetroEdit = useCallback(async () => {
    if (!firestore || !currentUser || !retroEdit || !canEditTs) return;
    setRetroSaving(true);
    try {
      const ev = retroEdit.timesheet.eventType;
      const reason = retroReason.trim();
      if (!reason) throw new Error('กรุณาระบุเหตุผลการแก้ไข');

      if (ev === 'work_day' && canCorrectTimesheetOtDirect(retroEdit.timesheet)) {
        const target = Math.min(24, Math.max(0, Number(retroTargetOt) || 0));
        const source = retroEdit.timesheet.ot15Hours ?? 0;
        if (Math.abs(target - source) < 0.001) {
          throw new Error('ไม่มีการเปลี่ยนแปลง OT');
        }
        const service = new TimesheetService(firestore);
        await service.correctClosedPeriodTimesheetHours(retroEdit.timesheet.id, currentUser as User, {
          ot15Hours: target,
          reason,
        });
        toast({
          title: 'บันทึกแล้ว',
          description: `อัปเดต OT จาก ${source} ชม. เป็น ${target} ชม. — ปิดงวดรายคนอีกครั้งก่อนสร้าง payroll`,
        });
        setRetroEdit(null);
        return;
      }

      await createTimesheetRetroAdjustment(firestore, currentUser as User, {
        sourceTimesheet: retroEdit.timesheet,
        sourceYearMonth: monthYm,
        applyPayrollYearMonth: retroApplyYm.trim(),
        addedOt15Hours: ev === 'work_day' ? retroAddedOt : undefined,
        addedStandbyHours:
          ev === 'mobilization_day' || ev === 'demobilization_day' || ev === 'standby_day'
            ? retroAddedStandby
            : undefined,
        addedM1Trips: ev === 'mobilization_day' ? retroAddedM1Trips : undefined,
        addedD1Trips: ev === 'demobilization_day' ? retroAddedD1Trips : undefined,
        reason,
      });
      toast({
        title: 'บันทึกแก้ไขย้อนหลังแล้ว',
        description:
          retroPayPreview != null && retroPayPreview > 0
            ? `ยอดจ่ายประมาณ ฿${retroPayPreview.toLocaleString()} · จ่ายในงวด ${formatPayrollYearMonthThaiBE(retroApplyYm)}`
            : `แสดงบนตารางพร้อมเครื่องหมาย † — จ่ายในงวด ${formatPayrollYearMonthThaiBE(retroApplyYm)}`,
      });
      setRetroEdit(null);
    } catch (e: unknown) {
      if (e instanceof RetroRateMatrixMissingError) {
        setRetroPayMissing(e.missingRates);
        setRetroPayContractId(e.contractId);
      }
      toast({
        variant: 'destructive',
        title: 'บันทึกแก้ไขย้อนหลังไม่สำเร็จ',
        description:
          e instanceof RetroRateMatrixMissingError
            ? `${e.message} — ไปที่สัญญา → แท็บต้นทุน (Cost) → ใส่อัตราให้ครบ`
            : e instanceof Error && /permission/i.test(e.message)
              ? `${e.message} — ถ้าเพิ่งอัปเดตระบบ ลอง refresh หน้าแล้วบันทึกใหม่`
              : e instanceof Error
                ? e.message
                : String(e),
      });
    } finally {
      setRetroSaving(false);
    }
  }, [
    firestore,
    currentUser,
    retroEdit,
    canEditTs,
    monthYm,
    retroApplyYm,
    retroAddedOt,
    retroTargetOt,
    retroAddedStandby,
    retroAddedM1Trips,
    retroAddedD1Trips,
    retroReason,
    retroPayPreview,
    toast,
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
                        <strong>รวมชม.</strong> = ชม.ทำงาน (W) · Standby (SB/M1/D1 ตามชม.ฝั่งจ่ายในใบงาน) · OT แยกคอลัมน์ — เซลล์ M1/D1 ไม่โชว์ชม. (คลิกดู) · สัมพันธ์สัญญา · หน้า Mob · รายวัน · วางบิล/payroll
                      </p>
                      {canEditTs && dedupedTableRows.length > 0 ? (
                        <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 space-y-2">
                          <p className="text-xs font-medium text-foreground">
                            ปิดงวดบางส่วน (Phase 1):{' '}
                            {workerClosureLoading
                              ? 'กำลังโหลดสถานะรายคน…'
                              : workerMonthClosureSummaryText(workerClosureRows, dedupedTableRows.length)}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="h-8 gap-1"
                              disabled={partialWorkflowBusy || selectedPartialKeys.size === 0}
                              onClick={() => void handlePartialCloseSelected()}
                            >
                              <Lock className="h-3.5 w-3.5" />
                              ปิดงวดคนที่เลือก ({selectedPartialKeys.size})
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              className="h-8 gap-1"
                              disabled={partialWorkflowBusy || partialCloseStats.entryLocked === 0}
                              onClick={() => void handleSendPartialForReview()}
                            >
                              <Send className="h-3.5 w-3.5" />
                              ส่งอนุมัติคนที่ปิดแล้ว ({partialCloseStats.entryLocked})
                            </Button>
                            {partialCloseStats.entryLocked > 0 ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 gap-1"
                                disabled={partialWorkflowBusy}
                                onClick={() => void handleSyncPayrollReadyFlags()}
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                                ซิงก์พร้อมจ่าย Payroll
                              </Button>
                            ) : null}
                          </div>
                          <p className="text-[10px] text-muted-foreground">
                            ติ๊กเลือกคนที่ timesheet ครบ → ปิดงวด → ไป Payroll Batch ได้ทันที · กดซิงก์พร้อมจ่ายถ้า Batch ยังเห็น 0 คน · ส่งผู้จัดการอนุมัติเมื่อต้องการ · คนที่ปิดแล้ว: เมนูสถานะ → «ยกเลิกปิดงวด — กลับมาแก้ไข» (ได้จนกว่าใบงานจะถูกล็อกในชุดจ่าย)
                          </p>
                          {overdueDeferredClosures.length > 0 ? (
                            <Alert variant="destructive" className="py-2">
                              <AlertTitle className="text-sm">
                                รอ timesheet เกิน {DEFERRED_SHIP_TIMESHEET_ALERT_DAYS} วัน ({overdueDeferredClosures.length} คน)
                              </AlertTitle>
                              <AlertDescription className="text-xs space-y-1">
                                {overdueDeferredClosures.slice(0, 8).map((c) => {
                                  const po = pos?.find((p) => p.id === c.poId);
                                  const days = deferredClosureAgeDays(c);
                                  return (
                                    <p key={c.id}>
                                      {c.workerName || c.workerId}
                                      {po?.poCode ? ` · ${po.poCode}` : ''} — รอ {days} วัน
                                    </p>
                                  );
                                })}
                                {overdueDeferredClosures.length > 8 ? (
                                  <p className="text-muted-foreground">… และอีก {overdueDeferredClosures.length - 8} คน</p>
                                ) : null}
                              </AlertDescription>
                            </Alert>
                          ) : null}
                        </div>
                      ) : null}
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
                            title="ชม. standby (SB/M1/D1) ตาม normalHours ที่ลง — รวมตามเซลล์ในแถวนี้"
                          >
                            รวมชม.
                            <br />
                            <span className="font-normal text-muted-foreground">(Standby)</span>
                          </TableHead>
                          <TableHead
                            className="text-center font-bold min-w-[5.75rem] w-[5.75rem] shrink-0 text-[10px] leading-tight px-2"
                            title="ชม. OT รวมตามเซลล์ในแถวนี้"
                          >
                            รวมชม.
                            <br />
                            <span className="font-normal text-muted-foreground">(OT)</span>
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
                          const rowWorkerMonthOtTotal =
                            rowOtHoursMonthTotalByKey.get(`${wave.id}|${rw.workerId}|${rosterAssignment.id}`) ?? 0;
                          const rowClosure =
                            po?.id != null ? workerClosureByKey.get(`${po.id}|${rw.workerId}`) : undefined;
                          const rowPartialKey = po?.id != null ? `${po.id}|${rw.workerId}` : '';
                          const rowSelectable =
                            !!po?.id &&
                            rowClosure?.status !== 'deferred' &&
                            !(rowClosure && isWorkerMonthClosureGridLocked(rowClosure.status));
                          const editableGrid =
                            canEditTs && !isRowLockedForWorker(po, monthReview, rw.workerId);
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
                                  {po?.id ? (
                                    <WorkerMonthClosureCell
                                      closure={rowClosure}
                                      canEdit={canEditTs}
                                      selected={selectedPartialKeys.has(rowPartialKey)}
                                      selectable={rowSelectable}
                                      busy={partialWorkflowBusy}
                                      onSelectedChange={(checked) => {
                                        setSelectedPartialKeys((prev) => {
                                          const next = new Set(prev);
                                          if (checked) next.add(rowPartialKey);
                                          else next.delete(rowPartialKey);
                                          return next;
                                        });
                                      }}
                                      onMarkDeferred={() =>
                                        void handleMarkWorkerDeferred(po.id, rw.workerId, rw.name)
                                      }
                                      onClearDeferred={() =>
                                        void handleClearWorkerDeferred(po.id, rw.workerId, rw.name)
                                      }
                                      onReopenClosure={() =>
                                        void handleReopenWorkerClosure(po.id, rw.workerId, rw.name)
                                      }
                                    />
                                  ) : null}
                                </div>
                              </TableCell>
                              {days.map((d) => {
                                /** จับคู่แบบเดียวกับ resolve ในเซลล์ — คอลัมน์รวมชม.ใช้ logic เดียวกัน */
                                const tsRaw = resolveTimesheetForWaveMonthCell(
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
                                const ts = waveMonthCellTimesheetVisible(rosterAssignment, d, tsRaw)
                                  ? tsRaw
                                  : undefined;
                                const inMobWindow = isYmdEditableForAssignmentTimesheet(rosterAssignment, d, {
                                  hasPersistedTimesheetOnDate: !!ts,
                                });
                                const retroForCell = (() => {
                                  const seen = new Set<string>();
                                  const out: TimesheetRetroAdjustment[] = [];
                                  for (const r of ts ? retroByTimesheetId.get(ts.id) ?? [] : []) {
                                    if (seen.has(r.id)) continue;
                                    seen.add(r.id);
                                    out.push(r);
                                  }
                                  for (const r of retroByCellKey.get(retroCellKey(rosterAssignment.id, d)) ?? []) {
                                    if (seen.has(r.id)) continue;
                                    seen.add(r.id);
                                    out.push(r);
                                  }
                                  return out;
                                })();
                                const cellLabel = timesheetWaveMonthCellDisplayWithRetro(ts, retroForCell);
                                const hasRetro = hasActiveRetroAdjustments(retroForCell);
                                const tsLocked = isTimesheetPayrollLocked(ts);
                                const cellClickable =
                                  canEditTs && (tsLocked || retroOnlyPayrollMonth || editableGrid);
                                return (
                                  <TableCell key={d} className="px-0.5 text-center text-[11px] leading-none">
                                    {!ts ? (
                                      <span
                                        className="inline-flex min-h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-sm py-0.5 text-[11px] font-medium text-muted-foreground/40"
                                        title="นอกช่วง mobilization ตามฟิลด์บนเอกสาร — ยังไม่มีบันทึกรายวันที่จับคู่ได้"
                                      >
                                        {' - '}
                                      </span>
                                    ) : ts ? (
                                      <button
                                        type="button"
                                        disabled={!cellClickable}
                                        onClick={() =>
                                          openCellEdit(wave, po, monthReview, rw, d, ts, waveMobs)
                                        }
                                        className={cn(
                                          'inline-flex max-w-full justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                          !cellClickable && 'cursor-not-allowed opacity-60',
                                          cellClickable && 'cursor-pointer hover:opacity-90',
                                        )}
                                        title={
                                          (retroOnlyPayrollMonth
                                            ? `คลิกแก้ไขย้อนหลัง · ${d}`
                                            : editableGrid
                                              ? `คลิกแก้ไข · ${d} · ${ts.eventType} · ${ts.status}`
                                              : `${d} · ${ts.eventType} · ${ts.status}`) +
                                          (ts.eventType === 'work_day' && (ts.ot15Hours ?? 0) > 0
                                            ? ` · OT ${ts.ot15Hours} ชม.`
                                            : '') +
                                          (hasRetro
                                            ? ` · แก้ไขย้อนหลัง (+OT ${retroAddedOtHours(retroForCell)} ชม.` +
                                              (sumRetroAddedM1Trips(retroForCell) > 0
                                                ? ` · M1 +${sumRetroAddedM1Trips(retroForCell)} trip`
                                                : '') +
                                              ')'
                                            : '') +
                                          (!inMobWindow
                                            ? ' · วันนี้อยู่นอกหน้าต่าง mobilization บนเอกสาร — แสดงตามใบงานที่มีจริง'
                                            : '')
                                        }
                                      >
                                        <span
                                          className={cn(
                                            'inline-flex items-center justify-center rounded-sm border px-1 py-0.5 text-[11px] font-medium leading-none min-w-[1.125rem]',
                                            timesheetEventCellBadgeClasses(ts.eventType, ts.status),
                                            timesheetRetroCellRingClasses(hasRetro),
                                            !inMobWindow && 'ring-1 ring-amber-500/45',
                                          )}
                                        >
                                          {cellLabel}
                                        </span>
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        title={
                                          retroOnlyPayrollMonth
                                            ? `เพิ่มแก้ไขย้อนหลัง · ${d}`
                                            : editableGrid
                                              ? `เพิ่มรายการ · ${d}`
                                              : undefined
                                        }
                                        disabled={!(retroOnlyPayrollMonth || editableGrid) || !canEditTs}
                                        onClick={() =>
                                          openCellEdit(wave, po, monthReview, rw, d, undefined, waveMobs)
                                        }
                                        className={cn(
                                          'inline-flex min-h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-sm py-0.5 font-medium text-[11px] leading-none',
                                          (retroOnlyPayrollMonth || editableGrid) &&
                                            canEditTs &&
                                            'cursor-pointer hover:bg-muted/60 text-muted-foreground/80',
                                          !(retroOnlyPayrollMonth || editableGrid) && 'cursor-default opacity-45 text-muted-foreground/40',
                                        )}
                                      >
                                        {hasRetro ? cellLabel : ' - '}
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
                                title="ชม. standby (SB/M1/D1) ตาม normalHours ที่ลง — รวมในแถวนี้"
                              >
                                {rowWorkerMonthStandbyTotal}
                              </TableCell>
                              <TableCell
                                className="text-center font-bold tabular-nums text-xs min-w-[5.75rem] w-[5.75rem] shrink-0 px-2 py-1.5 text-amber-800"
                                title="ชม. OT รวมในแถวนี้"
                              >
                                {rowWorkerMonthOtTotal > 0 ? rowWorkerMonthOtTotal : '—'}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                    <div className="border-t px-4 py-3 text-xs text-muted-foreground space-y-1">
                      <p>
                        <strong>คีย์:</strong> ตัวอักษร = ประเภทวัน (W ทำงาน, SB สแตนด์บาย …) · <strong>W+5</strong> = ทำงาน + OT 5 ชม. ·{' '}
                        <strong>M1 / D1 / SB</strong> = ไม่ติดชม.บนเซลล์ (คลิกดูรายละเอียด — บิล/จ่ายอาจคนละชม.) ·{' '}
                        ฐานแพ็กสัญญา OFF 12 / ON 8 ·{' '}
                        <strong>†</strong> = มีแก้ไขย้อนหลัง (วงแหวนแดง) · เซลล์ «-» = ยังไม่มีบันทึก —{' '}
                        <strong className="text-emerald-700">เขียว</strong>=ทำงาน{' '}
                        <strong className="text-sky-700">ฟ้า</strong>=สแตนด์บาย{' '}
                        <strong className="text-violet-700">ม่วง</strong>=เดินทาง{' '}
                        <strong className="text-orange-700">ส้ม</strong>=Mob/Demob (ดู tooltip)
                        {retroOnlyPayrollMonth ? (
                          <>
                            {' '}
                            · <strong className="text-red-700">งวด payroll ปิดแล้ว</strong> — คลิกเซลล์เพื่อ «แก้ไขย้อนหลัง» (จ่ายงวดถัดไป)
                          </>
                        ) : null}
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
        <DialogContent className="flex max-h-[min(90vh,40rem)] w-[calc(100vw-1.5rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:w-full">
          <DialogHeader className="shrink-0 space-y-1 border-b px-5 py-4 text-left">
            <DialogTitle>แก้ไขลงเวลารายวัน</DialogTitle>
            <DialogDescription>
              {cellEdit
                ? `${cellEdit.workerName} · Wave ${cellEdit.wave.waveCode ?? ''}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {cellEdit ? (
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {cellSaveAwaitingConfirm ? (
                <Alert className="border-amber-200/80 bg-amber-50/80 dark:border-amber-900/50 dark:bg-amber-950/30">
                  <AlertTitle className="text-sm">ยืนยันการบันทึก</AlertTitle>
                  <AlertDescription className="text-xs sm:text-sm">
                    ต้องการบันทึกการแก้ไขลงเวลารายวันนี้ใช่หรือไม่? ถ้ามี daily timesheet เดิมสำหรับคน วัน
                    และการมอบหมายนี้แล้ว ระบบจะอัปเดตทับตามค่าที่คุณเลือก
                  </AlertDescription>
                </Alert>
              ) : null}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              </div>
              {editEvent === 'mobilization_day' ||
              editEvent === 'demobilization_day' ||
              editEvent === 'standby_day' ? (
                <div className="space-y-2 rounded-md border p-3">
                  <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between">
                    <p className="text-xs font-medium text-foreground">
                      แยกค่าเงิน — วางบิลลูกค้า / จ่ายลูกจ้าง
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      ตัวอย่าง: บิล <strong>M1 ตามสัญญา</strong> · จ่าย <strong>SB 8 ชม.</strong>
                    </p>
                  </div>
                  <MobDayChargeSideEditors
                    billing={editBillingCharge}
                    payroll={editPayrollCharge}
                    onBillingChange={setEditBillingCharge}
                    onPayrollChange={setEditPayrollCharge}
                    packageHours={defaultPackageHoursForWorkMode(cellEdit.assignment?.workMode)}
                    disabled={savingCell || cellSaveAwaitingConfirm}
                    previewRates={monthCellPreviewRates}
                    includeD1
                    layout="grid"
                    compact
                  />
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                    <Label htmlFor="wm-edit-ot-hours">OT ชม. (0–24)</Label>
                    <Input
                      id="wm-edit-ot-hours"
                      type="number"
                      min={0}
                      max={24}
                      step={0.5}
                      value={editOtHours}
                      onChange={(e) => setEditOtHours(Number(e.target.value))}
                      disabled={
                        savingCell ||
                        cellSaveAwaitingConfirm ||
                        editEvent === 'unpaid_leave' ||
                        editEvent !== 'work_day'
                      }
                    />
                    {editEvent !== 'work_day' ? (
                      <p className="text-xs text-muted-foreground">OT ใช้ได้เฉพาะวันทำงาน</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">บันทึกเป็น ot15 สำหรับ payroll/billing</p>
                    )}
                  </div>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="wm-edit-remark">หมายเหตุ (ถ้ามี)</Label>
                <Textarea
                  id="wm-edit-remark"
                  rows={2}
                  value={editRemark}
                  onChange={(e) => setEditRemark(e.target.value)}
                  disabled={savingCell || cellSaveAwaitingConfirm}
                  placeholder="เช่น แก้วันผิด / สาเหตุลา"
                  className="min-h-[2.75rem] resize-y"
                />
              </div>
            </div>
          ) : null}
          <DialogFooter className="shrink-0 gap-2 border-t px-5 py-3 sm:gap-2 flex-wrap">
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

      <Dialog open={!!retroEdit} onOpenChange={(open) => !open && setRetroEdit(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>แก้ไขย้อนหลัง (ใบงานล็อคแล้ว)</DialogTitle>
            <DialogDescription>
              ไม่แก้ข้อมูลต้นทาง — บันทึก OT / M1 / D1 / standby ที่เพิ่มแยกต่างหาก แสดงบนตารางพร้อมเครื่องหมาย † และจ่ายในงวดที่เลือก
            </DialogDescription>
          </DialogHeader>
          {retroEdit ? (
            <div className="space-y-4 text-sm">
              <div className="rounded-md border bg-muted/40 px-3 py-2 space-y-1">
                <p>
                  <span className="text-muted-foreground">พนักงาน:</span>{' '}
                  <strong>{retroEdit.workerName}</strong>
                </p>
                <p>
                  <span className="text-muted-foreground">วันที่:</span>{' '}
                  <strong>{retroEdit.timesheet.date}</strong> · {retroEdit.timesheet.eventType}
                  {isTimesheetPayrollLocked(retroEdit.timesheet) ? (
                    <> · <span className="text-amber-800">LOCKED</span></>
                  ) : retroOnlyPayrollMonth ? (
                    <> · <span className="text-red-800">payroll ปิดแล้ว</span></>
                  ) : null}
                </p>
              </div>
              {retroEdit.timesheet.eventType === 'work_day' ? (
                canCorrectTimesheetOtDirect(retroEdit.timesheet) ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="retro-ot-target">OT ชม. (ยอดที่ต้องการ)</Label>
                    <Input
                      id="retro-ot-target"
                      type="number"
                      min={0}
                      max={24}
                      step={0.5}
                      value={retroTargetOt}
                      onChange={(e) => setRetroTargetOt(Number(e.target.value))}
                      disabled={retroSaving}
                    />
                    <p className="text-xs text-muted-foreground">
                      ของเดิมในสลิป: OT {retroEdit.timesheet.ot15Hours ?? 0} ชม. — ใส่ <strong>0</strong> ได้เพื่อลบ OT · แก้ข้อมูลต้นทางโดยตรง
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="retro-ot">OT ชม. ที่เพิ่ม (0–24)</Label>
                    <Input
                      id="retro-ot"
                      type="number"
                      min={0}
                      max={24}
                      step={0.5}
                      value={retroAddedOt}
                      onChange={(e) => setRetroAddedOt(Number(e.target.value))}
                      disabled={retroSaving}
                    />
                    <p className="text-xs text-muted-foreground">
                      ของเดิมในสลิป: OT {retroEdit.timesheet.ot15Hours ?? 0} ชม. — ค่านี้เป็น <strong>ชม.เพิ่ม</strong> ไม่ใช่ยอดรวม
                    </p>
                  </div>
                )
              ) : retroEdit.timesheet.eventType === 'mobilization_day' ? (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="retro-m1">M1 trip ที่เพิ่ม</Label>
                    <Input
                      id="retro-m1"
                      type="number"
                      min={0}
                      max={5}
                      step={1}
                      value={retroAddedM1Trips}
                      onChange={(e) => setRetroAddedM1Trips(Number(e.target.value))}
                      disabled={retroSaving}
                    />
                    <p className="text-xs text-muted-foreground">
                      คิดตามอัตรา <strong>OFF M1 (ต้นทุน/trip)</strong> ในตารางสัญญา — ใช้เมื่อเพิ่ม/แก้ M1 หลังปิด payroll
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="retro-sb-m1">ชม. M1 เพิ่ม (ถ้ามี — 0–24)</Label>
                    <Input
                      id="retro-sb-m1"
                      type="number"
                      min={0}
                      max={24}
                      step={0.5}
                      value={retroAddedStandby}
                      onChange={(e) => setRetroAddedStandby(Number(e.target.value))}
                      disabled={retroSaving}
                    />
                  </div>
                </div>
              ) : retroEdit.timesheet.eventType === 'demobilization_day' ? (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="retro-d1">D1 trip ที่เพิ่ม</Label>
                    <Input
                      id="retro-d1"
                      type="number"
                      min={0}
                      max={5}
                      step={1}
                      value={retroAddedD1Trips}
                      onChange={(e) => setRetroAddedD1Trips(Number(e.target.value))}
                      disabled={retroSaving}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="retro-sb-d1">ชม. D1 เพิ่ม (ถ้ามี — 0–24)</Label>
                    <Input
                      id="retro-sb-d1"
                      type="number"
                      min={0}
                      max={24}
                      step={0.5}
                      value={retroAddedStandby}
                      onChange={(e) => setRetroAddedStandby(Number(e.target.value))}
                      disabled={retroSaving}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="retro-sb">Standby/M1/D1 ชม. ที่เพิ่ม (0–24)</Label>
                  <Input
                    id="retro-sb"
                    type="number"
                    min={0}
                    max={24}
                    step={0.5}
                    value={retroAddedStandby}
                    onChange={(e) => setRetroAddedStandby(Number(e.target.value))}
                    disabled={retroSaving}
                  />
                </div>
              )}
              {!(
                retroEdit.timesheet.eventType === 'work_day' &&
                canCorrectTimesheetOtDirect(retroEdit.timesheet)
              ) ? (
                <div className="space-y-1.5">
                  <Label htmlFor="retro-apply-ym">จ่ายในงวด payroll</Label>
                  <Input
                    id="retro-apply-ym"
                    type="month"
                    value={retroApplyYm}
                    onChange={(e) => setRetroApplyYm(e.target.value)}
                    disabled={retroSaving}
                  />
                </div>
              ) : null}
              <div className="space-y-1.5">
                <Label htmlFor="retro-reason">เหตุผล (บังคับ)</Label>
                <Textarea
                  id="retro-reason"
                  rows={2}
                  value={retroReason}
                  onChange={(e) => setRetroReason(e.target.value)}
                  disabled={retroSaving}
                  placeholder="เช่น OT 29–31 พ.ค. ลืมลงก่อนปิด payroll"
                />
              </div>
              {!(
                retroEdit.timesheet.eventType === 'work_day' &&
                canCorrectTimesheetOtDirect(retroEdit.timesheet)
              ) ? (
                <>
                  <div className="rounded-md border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">ยอดจ่ายเพิ่ม (จากตารางอัตรา): </span>
                    {retroPayPreviewLoading ? (
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> กำลังคำนวณ…
                      </span>
                    ) : retroPayMissing.length > 0 ? (
                      <span className="text-amber-900 font-medium">— ยังใส่อัตราไม่ครบ</span>
                    ) : retroPayPreview != null && retroPayPreview > 0 ? (
                      <strong className="text-emerald-900 font-mono tabular-nums">
                        ฿{retroPayPreview.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </strong>
                    ) : (
                      <span className="text-muted-foreground">— กรอกชม. OT/standby เพื่อคำนวณ</span>
                    )}
                    <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                      ดึงจากตารางอัตราสัญญา ฝั่ง <strong>ต้นทุน (Cost)</strong> — เช่น OFF OT/hr, OFF M1/trip
                    </p>
                  </div>
                  {retroPayMissing.length > 0 ? (
                    <Alert variant="destructive" className="border-amber-300 bg-amber-50 text-amber-950">
                      <AlertTitle className="text-sm">ยังไม่ได้ใส่อัตราในตารางสัญญา</AlertTitle>
                      <AlertDescription className="text-xs space-y-2">
                        <ul className="list-disc pl-4">
                          {retroPayMissing.map((m, i) => (
                            <li key={i}>{m.fieldLabel}</li>
                          ))}
                        </ul>
                        <p>
                          เปิดสัญญา → สลับเป็น <strong>ต้นทุน (Cost)</strong> → กรอกช่องที่ขาด (ไม่ใช่แท็บราคาขาย)
                          {retroPayContractId ? (
                            <>
                              {' '}
                              <Link
                                href={retroContractRatesUrl(retroPayContractId)}
                                className="font-medium underline"
                                target="_blank"
                              >
                                ไปตารางอัตราสัญญา
                              </Link>
                            </>
                          ) : null}
                        </p>
                      </AlertDescription>
                    </Alert>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" disabled={retroSaving} onClick={() => setRetroEdit(null)}>
              ยกเลิก
            </Button>
            <Button
              type="button"
              disabled={
                retroSaving ||
                !retroEdit ||
                retroPayMissing.length > 0 ||
                !retroReason.trim() ||
                (() => {
                  if (
                    retroEdit?.timesheet.eventType === 'work_day' &&
                    canCorrectTimesheetOtDirect(retroEdit.timesheet)
                  ) {
                    const target = Math.min(24, Math.max(0, Number(retroTargetOt) || 0));
                    const source = retroEdit.timesheet.ot15Hours ?? 0;
                    return Math.abs(target - source) < 0.001;
                  }
                  const hasDelta =
                    retroAddedOt > 0 ||
                    retroAddedStandby > 0 ||
                    retroAddedM1Trips > 0 ||
                    retroAddedD1Trips > 0;
                  return (
                    !hasDelta ||
                    (hasDelta &&
                      (retroPayPreviewLoading || retroPayPreview == null || retroPayPreview <= 0))
                  );
                })()
              }
              onClick={() => void performSaveRetroEdit()}
            >
              {retroSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {retroEdit &&
              retroEdit.timesheet.eventType === 'work_day' &&
              canCorrectTimesheetOtDirect(retroEdit.timesheet)
                ? 'บันทึก'
                : 'บันทึกแก้ไขย้อนหลัง'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
