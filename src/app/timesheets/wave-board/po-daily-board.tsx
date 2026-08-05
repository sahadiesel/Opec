'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CalendarDays, Save, Loader2, Zap, Lock, Pause, Pencil, Undo2, Sparkles, ListFilter } from 'lucide-react';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  htmlDateValueToTimestampMs,
  timestampToHtmlDateValue,
  formatYmdLocalThaiBE,
} from '@/lib/date-thai';
import { parseISO } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFirestore, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { usePoLinesFanout } from '@/lib/ops/use-po-lines-fanout';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  deleteField,
  type Firestore,
} from 'firebase/firestore';
import {
  PurchaseOrder,
  PoActiveBundle,
  Wave,
  Assignment,
  Worker,
  DailyTimesheet,
  RateConditionEventType,
  User,
  DailyTimesheetStatus,
  POLine,
  PositionRate,
  WaveMonthTimesheetReview,
} from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { TimesheetService } from '@/lib/services/timesheet-service';
import Link from 'next/link';
import { WAVE_TIMESHEET_DEPLOYMENT_STATUSES } from '@/lib/constants/timesheet-wave';
import {
  resolveContractDailyHoursForAssignmentLine,
  assignmentIncludedInWaveTimesheetRoster,
  assignmentExcludedFromPoDailyBoardOnDate,
  assignmentAwaitingRemobAfterSiteFinish,
  isHtmlDateAfterMobLocationEnd,
  isYmdEditableForAssignmentTimesheet,
  isPoDailyBoardPriorCycleWorkDateWhileAwaitingRemob,
} from '@/lib/constants/timesheet-ui';
import { poTimesheetScopeId, isPoTimesheetScopeId } from '@/lib/constants/timesheet-po-scope';
import { normalizePoActiveBundleId, resolvePoActiveBundleKeyForPo } from '@/lib/ops/po-active-bundle';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Switch } from '@/components/ui/switch';
import { pickRosterLinePerWorker } from '@/lib/ops/assignment-roster';
import { compareAssignmentWorkerNamesTh } from '@/lib/ops/mobilization-worker-name';
import {
  formatThaiYearMonthLabel,
  assignmentOverlapsYearMonthForPoDailyBoard,
} from '@/lib/ops/timesheet-hub-po-month';
import { assignmentCountsTowardQuota } from '@/lib/ops/po-fulfillment-read-model';
import {
  countTimesheetsAfterMobFinishDate,
  deleteTimesheetsAfterMobFinishDate,
} from '@/lib/timesheet/mob-finish-timesheet-cleanup';
import { deleteOrphanTimesheetsForWorkerPoInRange } from '@/lib/timesheet/enforce-one-timesheet-per-worker-po-day';
import { purgeStalePoActiveAutoDailyForCalendarMonth } from '@/lib/timesheet/po-active-auto-daily-sync';
import { buildMobCycleDocId } from '@/lib/ops/mob-cycle-ids';
import {
  buildMobFinishUndoRestoreFields,
  buildMobFinishUndoSnapshot,
  buildMobRemobClearanceDeleteFields,
  inferMobDatesFromTimesheets,
} from '@/lib/timesheet/mob-finish-undo';
import {
  upsertPoActiveStopTodayEvent,
  togglePoActiveSbWStopMode,
  syncPoActiveAutoDailyForAssignment,
  type PoActiveStopTodayEvent,
} from '@/lib/timesheet/po-active-auto-daily-sync';
import { addDaysToYmd, thailandTodayYmd } from '@/lib/ops/mobilization-final-clearance';
import {
  buildBillingModeProceedCopy,
  billingModeLabel,
  resolveBillingMode,
  type PoBillingModeRow,
} from '@/lib/commercial/resolve-billing-mode';
import {
  computePoActiveAutoDailyRange,
  isAssignmentEligibleForPoActiveAutoDaily,
  isAssignmentInPoActiveSbToggleMode,
  poActiveDailyTimesheetDocId,
} from '@/lib/timesheet/po-active-auto-daily-build';
import {
  defaultDemobDayCharges,
  defaultPackageHoursForWorkMode,
  defaultChargesForEventType,
  buildTimesheetFieldsFromMobCharges,
} from '@/lib/ops/mob-day-charge';
import { buildMobDayChargeBahtPreviewRates } from '@/lib/ops/mob-day-charge-baht-preview';
import { MobDayChargeSideEditors } from '@/components/timesheet/mob-day-charge-side-editors';
import { resolveBillingSellWorkingDayRate } from '@/lib/commercial/position-rate-sell';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { MobDayChargeSpec } from '@/lib/types';
import { resolveMatrixCostRate } from '@/lib/commercial/position-rate-matrix';

const EVENT_TYPE_OPTIONS: { label: string; value: RateConditionEventType }[] = [
  { label: 'วันทำงาน (Work)', value: 'work_day' },
  { label: 'วันเดินทาง (Travel)', value: 'travel_day' },
  { label: 'สแตนด์บาย (Standby)', value: 'standby_day' },
  { label: 'Mob (MO)', value: 'mobilization_day' },
  { label: 'วันเดินทางกลับ (Demob)', value: 'demobilization_day' },
  { label: 'ไม่จ่ายค่าแรง (Unpaid)', value: 'unpaid_leave' },
];

/** ค่าใน dropdown — ล้างช่องวันนั้น (ไม่บันทึก timesheet / ไม่แสดงสถานะ) */
const PO_DAILY_BOARD_EVENT_CLEAR = '__po_daily_empty__';

/** ช่องตัวเลขแคบ — ซ่อน spinner ไม่ให้บังตัวเลข */
const PO_BOARD_HOURS_INPUT_CLASS =
  'mx-auto block h-9 w-14 min-w-14 max-w-14 shrink-0 px-1.5 text-center font-bold tabular-nums [appearance:textfield] [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

const PO_BOARD_HOURS_CELL_CLASS = 'px-2 py-2 text-center';

/** คอลัมน์สถานะ — แสดงรหัสจากประเภทวันที่บันทึกแล้วเท่านั้น (ไม่แสดง DRAFT) */
function waveBoardStatusCode(
  persisted: boolean,
  eventType: RateConditionEventType | undefined,
): string {
  if (!persisted) return ' - ';
  const et = eventType ?? 'work_day';
  if (et === 'work_day') return 'W';
  if (et === 'standby_day') return 'SB';
  const rest: Partial<Record<RateConditionEventType, string>> = {
    travel_day: 'TV',
    mobilization_day: 'MO',
    /** Dmob คิดเงินแนวเดียวกับ working — แสดง DMOB ให้ตรงภาษา Ops */
    demobilization_day: 'DMOB',
    unpaid_leave: 'NP',
  };
  return rest[et] ?? String(et).replace(/_/g, ' ').slice(0, 3).toUpperCase();
}

function isMonthReviewLocked(r: WaveMonthTimesheetReview | undefined | null): boolean {
  if (!r) return false;
  return (
    r.status === 'entry_locked' || r.status === 'pending_manager_review' || r.status === 'approved'
  );
}

/** ตรวจวันสิ้นสุดงานกับช่วงมอบหมาย — ใช้ทั้งจบงานครั้งแรกและแก้ไขวันที่ */
function finishJobDateIssue(
  asgn: Pick<
    Assignment,
    | 'mobWorkingStartDate'
    | 'mobStandbyDate'
    | 'assignedDate'
    | 'startDate'
    | 'endDate'
    | 'mobLocationEndDate'
    | 'deploymentStatus'
    | 'mobCycleNumber'
  >,
  finishYmd: string,
): string | null {
  const y = (finishYmd || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(y)) return 'กรุณาเลือกวันที่ให้ครบถ้วน';
  const mobStandby = ((asgn.mobStandbyDate || '') as string).trim().slice(0, 10);
  const mobStart = ((asgn.mobWorkingStartDate || '') as string).trim().slice(0, 10);
  const assignStart = ((asgn.startDate || asgn.assignedDate || '') as string).trim().slice(0, 10);
  const mobEnd = ((asgn.mobLocationEndDate || '') as string).trim().slice(0, 10);
  /** รอบที่จบแล้ว — อย่าใช้ startDate remob ใหม่เป็นขอบล่าง (มักเลื่อนหลังวันจบจริง) */
  const awaitingRemob =
    asgn.deploymentStatus === 'DRAFT' && /^\d{4}-\d{2}-\d{2}$/.test(mobEnd);
  const floorCandidates = [mobStandby, mobStart, assignStart].filter((v) => /^\d{4}-\d{2}-\d{2}$/.test(v));
  let floor =
    floorCandidates.length > 0 ? floorCandidates.reduce((a, b) => (a < b ? a : b)) : undefined;
  if (awaitingRemob && floor && assignStart && assignStart > mobEnd && assignStart > floor) {
    floor = floorCandidates.filter((v) => v <= mobEnd).reduce((a, b) => (a < b ? a : b), floor);
  }
  const ceil = ((asgn.endDate || '') as string).trim().slice(0, 10);
  if (floor && y < floor) {
    return `วันสิ้นสุดต้องไม่ก่อน ${formatYmdLocalThaiBE(floor)} (เริ่มทำงาน / วันมอบหมาย)`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(ceil) && y > ceil) {
    return `วันสิ้นสุดต้องไม่หลัง ${formatYmdLocalThaiBE(ceil)} (เพดาน PO)`;
  }
  return null;
}

/**
 * โหมดกรองเดือน (?month=): แสดงเฉพาะคนที่ยังถูก assign (สอดคล้องหน้า Assignments)
 * — รวม DRAFT หลังจบงานรอ remob · ซ่อน Unassign / CLOSED / DEMOBILIZED
 */
function poDailyBoardAssignmentInMonthRoster(asgn: Assignment, yearMonth: string): boolean {
  if (!assignmentCountsTowardQuota(asgn)) return false;
  if (!assignmentIncludedInWaveTimesheetRoster(asgn)) return false;
  /** ยังอยู่ใน mobilization รอ remob — แสดงในกระดานแม้เลือกเดือนหลังวันจบ */
  if (assignmentAwaitingRemobAfterSiteFinish(asgn)) return true;
  return assignmentOverlapsYearMonthForPoDailyBoard(asgn, yearMonth);
}

type PoDailyBoardRowFilter = 'all' | 'filled';

/** แถวมี timesheet บันทึกแล้วสำหรับวันที่เลือก (คอลัมน์สถานะไม่ว่าง) */
function poDailyBoardRowHasTimesheetOnDate(
  assignmentId: string,
  clearedRowIds: Set<string>,
  persistedAssignmentIds: Set<string>,
): boolean {
  if (clearedRowIds.has(assignmentId)) return false;
  return persistedAssignmentIds.has(assignmentId);
}

function assignmentYmdEditableOnPoDailyBoard(
  asgn: Assignment,
  dateYmd: string,
  hasPersistedTimesheetOnDate = false,
): boolean {
  return isYmdEditableForAssignmentTimesheet(asgn, dateYmd, { hasPersistedTimesheetOnDate });
}

/** แถวอยู่ในกระดานรายวันสำหรับวันที่เลือก — ไม่รวม unassign / จบงานแล้วนอกช่วง */
function poDailyBoardAssignmentVisibleOnDate(
  asgn: Assignment,
  dateYmd: string,
  hasPersistedTimesheetOnDate = false,
): boolean {
  if (assignmentExcludedFromPoDailyBoardOnDate(asgn, dateYmd)) return false;
  return (
    assignmentYmdEditableOnPoDailyBoard(asgn, dateYmd, hasPersistedTimesheetOnDate) ||
    isPoDailyBoardPriorCycleWorkDateWhileAwaitingRemob(asgn, dateYmd)
  );
}

export type PoDailyBoardScope =
  | { mode: 'single'; po: PurchaseOrder; waves: Wave[] }
  | { mode: 'bundle'; bundleKey: string; pos: PurchaseOrder[]; waves: Wave[] };

export type PoDailyBoardCardProps = {
  scope: PoDailyBoardScope;
  /** มีเมื่อเปิดจาก ?month= และวันที่เลือกยังอยู่ในเดือนนั้น — แสดงทุกคนที่ทับเดือน (ไม่ใช่แค่วันเดียว) */
  rosterFilterYm?: string | null;
  targetDate: string;
  onBoardDateChange: (timestampMs: number) => void;
  currentUser: User;
  workers: Worker[] | undefined;
  positionLabel: (id?: string) => string;
  canEditTimesheets: boolean;
};

/**
 * กระดานลงเวลารายวัน — แถวจาก mobilization ที่ช่วง start–end ครอบคลุมวันที่เลือก
 * รวมคนที่จบงานแล้ว (กลับ DRAFT) ให้เห็นชื่อในเดือนเดียวกันสำหรับสรุป · ซ่อนเฉพาะ Waiting MOB ครั้งแรกก่อนขึ้นไซต์
 * โหมด bundle = ตารางเดียวรวมทุก PO ในชุด PO Active (ไม่แยกการ์ดต่อ PO)
 */
export function PoDailyBoardCard({
  scope,
  rosterFilterYm = null,
  targetDate,
  onBoardDateChange,
  currentUser,
  workers,
  positionLabel,
  canEditTimesheets,
}: PoDailyBoardCardProps) {
  const posList = useMemo(() => {
    if (scope.mode === 'single') return [scope.po];
    return scope.pos;
  }, [
    scope.mode,
    scope.mode === 'single' ? scope.po.id : scope.pos.map((p) => p.id).sort().join(','),
  ]);
  const isBundle = scope.mode === 'bundle';
  const bundleKey = isBundle ? scope.bundleKey : null;
  const waves = scope.waves;
  const canonicalPo = posList[0];
  const poIds = useMemo(() => posList.map((p) => p.id).filter(Boolean), [posList]);
  const poIdsKey = poIds.join('|');
  const poById = useMemo(() => new Map(posList.map((p) => [p.id, p])), [posList]);
  const firestore = useFirestore();
  const router = useRouter();
  const { toast } = useToast();
  const [rosterData, setRosterData] = useState<Record<string, Partial<DailyTimesheet>>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [finishJobModal, setFinishJobModal] = useState<
    null | {
      mode: 'finish' | 'revise';
      assignment: Assignment;
      /** วันสิ้นสุด + ประเภทวันนี้ตอนหยุดข้อ 1–3 */
      todayEventType?: PoActiveStopTodayEvent;
      finishTiming?: 'today' | 'tomorrow';
    }
  >(null);
  const [stopFlow, setStopFlow] = useState<null | { assignment: Assignment }>(null);
  const [demobChargeOpen, setDemobChargeOpen] = useState(false);
  const [demobChargeAssignment, setDemobChargeAssignment] = useState<Assignment | null>(null);
  const [demobBillingCharge, setDemobBillingCharge] = useState<MobDayChargeSpec>(() =>
    defaultDemobDayCharges().billing,
  );
  const [demobPayrollCharge, setDemobPayrollCharge] = useState<MobDayChargeSpec>(() =>
    defaultDemobDayCharges().payroll,
  );
  const [cancelFinishTarget, setCancelFinishTarget] = useState<Assignment | null>(null);
  const [finishJobDateYmd, setFinishJobDateYmd] = useState('');
  const [finishAfterCounts, setFinishAfterCounts] = useState<{
    total: number;
    deletable: number;
    locked: number;
  } | null>(null);
  const [finishPurgeConfirm, setFinishPurgeConfirm] = useState<{
    assignment: Assignment;
    finishYmd: string;
    mode: 'finish' | 'revise';
    finishTiming?: 'today' | 'tomorrow';
    todayEventType?: PoActiveStopTodayEvent;
    charges?: { billing: MobDayChargeSpec; payroll: MobDayChargeSpec };
    deletable: number;
    locked: number;
  } | null>(null);
  const [demobSubmitting, setDemobSubmitting] = useState(false);
  const [standbySubmitting, setStandbySubmitting] = useState(false);
  const [autoGenBusy, setAutoGenBusy] = useState(false);
  const lastBangkokYmdRef = useRef(thailandTodayYmd());
  const autoTodaySyncLockRef = useRef(false);
  const [reviewByWaveId, setReviewByWaveId] = useState<Map<string, WaveMonthTimesheetReview | null>>(
    () => new Map(),
  );
  /** assignment ที่มีเอกสาร daily_timesheets จริงในวันที่เลือก (ไม่ใช่แค่ placeholder บนจอ) */
  const [persistedAssignmentIds, setPersistedAssignmentIds] = useState<Set<string>>(() => new Set());
  const [clearDayDialogOpen, setClearDayDialogOpen] = useState(false);
  const [clearDayBusy, setClearDayBusy] = useState(false);
  /** แถวที่ผู้ใช้ล้างวันนี้แล้ว — ไม่โหลดค่า default และไม่บันทึกทับ */
  const [clearedRowIds, setClearedRowIds] = useState<Set<string>>(() => new Set());
  /** แถวที่แก้บนจอแล้วยังไม่บันทึก — กัน loadRoster ทับ eventType (เช่น เปลี่ยนเป็น standby) */
  const [dirtyRowIds, setDirtyRowIds] = useState<Set<string>>(() => new Set());

  const markRowDirty = useCallback((assignmentId: string) => {
    setDirtyRowIds((prev) => {
      if (prev.has(assignmentId)) return prev;
      const next = new Set(prev);
      next.add(assignmentId);
      return next;
    });
  }, []);
  const [billingModesByPo, setBillingModesByPo] = useState<PoBillingModeRow[] | null>(null);
  const [billingProceedHref, setBillingProceedHref] = useState<string | null>(null);
  const [rowDisplayFilter, setRowDisplayFilter] = useState<PoDailyBoardRowFilter>('filled');

  const billingProceedCopy = useMemo(
    () => (billingModesByPo?.length ? buildBillingModeProceedCopy(billingModesByPo) : null),
    [billingModesByPo],
  );

  const requestMonthlyTimesheetProceed = useCallback((href: string) => {
    setBillingProceedHref(href);
  }, []);

  const billingModesReady = billingModesByPo !== null;

  const monthYm = targetDate.slice(0, 7);
  const waveById = useMemo(() => new Map(waves.map((w) => [w.id, w])), [waves]);

  const resolvedBundleIdForAuto = useMemo(() => {
    if (scope.mode === 'bundle') return normalizePoActiveBundleId(scope.bundleKey);
    return normalizePoActiveBundleId(resolvePoActiveBundleKeyForPo(scope.po));
  }, [scope]);

  const bundleRefForAutoSwitch = useMemoFirebase(
    () =>
      firestore && resolvedBundleIdForAuto
        ? doc(firestore, 'po_active_bundles', resolvedBundleIdForAuto)
        : null,
    [firestore, resolvedBundleIdForAuto],
  );
  const { data: bundleForAutoSwitch } = useDoc<PoActiveBundle>(bundleRefForAutoSwitch as any);
  const bundleAutoDailyDisabled = bundleForAutoSwitch?.poActiveAutoDailyDisabled === true;

  const showAutoMasterSwitch = useMemo(
    () => !!resolvedBundleIdForAuto && !resolvedBundleIdForAuto.startsWith('orphan:'),
    [resolvedBundleIdForAuto],
  );

  const [autoMasterSaving, setAutoMasterSaving] = useState(false);

  const handleBundleAutoDailyToggle = useCallback(
    async (autoOn: boolean) => {
      if (!firestore || !resolvedBundleIdForAuto || resolvedBundleIdForAuto.startsWith('orphan:')) return;
      setAutoMasterSaving(true);
      try {
        await setDoc(
          doc(firestore, 'po_active_bundles', resolvedBundleIdForAuto),
          {
            poActiveAutoDailyDisabled: !autoOn,
            updatedAt: Date.now(),
          },
          { merge: true },
        );
        toast({
          title: autoOn ? 'เปิดลงเวลาอัตโนมัติแล้ว' : 'ปิดลงเวลาอัตโนมัติแล้ว',
          description: autoOn
            ? 'Scheduler และซิงก์เมื่อเปิดกระดานจะลงวันถัดไปเป็นต้นไป — ไม่ย้อนเติมวันว่างเก่าโดยอัตโนมัติ'
            : 'ต้องลงมือหรือกด Auto gen เพื่อเติมช่วงที่ขาด · ข้อมูลแถวเดิมในระบบไม่ถูกลบ',
        });
      } catch (e: unknown) {
        toast({
          variant: 'destructive',
          title: 'บันทึกไม่สำเร็จ',
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setAutoMasterSaving(false);
      }
    },
    [firestore, resolvedBundleIdForAuto, toast],
  );

  useEffect(() => {
    setClearedRowIds(new Set());
    setPersistedAssignmentIds(new Set());
  }, [targetDate, poIdsKey]);

  useEffect(() => {
    if (!finishJobModal) {
      setFinishJobDateYmd('');
      return;
    }
    if (finishJobModal.mode === 'revise') {
      const cur = (finishJobModal.assignment.mobLocationEndDate || '').trim().slice(0, 10);
      setFinishJobDateYmd(/^\d{4}-\d{2}-\d{2}$/.test(cur) ? cur : thailandTodayYmd());
      return;
    }
    const bangkokToday = thailandTodayYmd();
    if (finishJobModal.todayEventType) {
      setFinishJobDateYmd(bangkokToday);
      return;
    }
    if (finishJobModal.finishTiming === 'today') {
      setFinishJobDateYmd(addDaysToYmd(bangkokToday, -1));
      return;
    }
    if (finishJobModal.finishTiming === 'tomorrow') {
      setFinishJobDateYmd(bangkokToday);
      return;
    }
    const base = (targetDate || '').slice(0, 10);
    setFinishJobDateYmd(/^\d{4}-\d{2}-\d{2}$/.test(base) ? base : bangkokToday);
  }, [finishJobModal, targetDate]);

  useEffect(() => {
    if (!firestore || !finishJobModal || !finishJobDateYmd) {
      setFinishAfterCounts(null);
      return;
    }
    const ymd = finishJobDateYmd.trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      setFinishAfterCounts(null);
      return;
    }
    let cancelled = false;
    void countTimesheetsAfterMobFinishDate(firestore, finishJobModal.assignment.id, ymd)
      .then((c) => {
        if (!cancelled) setFinishAfterCounts(c);
      })
      .catch(() => {
        if (!cancelled) setFinishAfterCounts(null);
      });
    return () => {
      cancelled = true;
    };
  }, [firestore, finishJobModal, finishJobDateYmd]);

  const poMonthHref = useMemo(() => {
    if (isBundle && bundleKey) {
      return `/timesheets/wave-month?month=${encodeURIComponent(monthYm)}&poActiveBundleId=${encodeURIComponent(bundleKey)}`;
    }
    return `/timesheets/wave-month?month=${encodeURIComponent(monthYm)}&highlightPo=${encodeURIComponent(canonicalPo.id)}`;
  }, [isBundle, bundleKey, monthYm, canonicalPo.id]);

  useEffect(() => {
    if (!firestore || posList.length === 0) {
      setBillingModesByPo([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const rows = await Promise.all(
        posList.map(async (po) => ({
          poId: po.id,
          poCode: po.poCode || po.id,
          mode: await resolveBillingMode(firestore, po),
        })),
      );
      if (!cancelled) setBillingModesByPo(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, posList]);

  useEffect(() => {
    if (!firestore || !/^\d{4}-\d{2}$/.test(monthYm)) {
      setReviewByWaveId(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      const m = new Map<string, WaveMonthTimesheetReview | null>();
      const scopeIds = [...new Set(poIds.map((pid) => poTimesheetScopeId(pid)))];
      await Promise.all([
        ...scopeIds.map(async (sid) => {
          const scopeRef = doc(firestore, 'wave_month_timesheet_reviews', `${sid}_${monthYm}`);
          const scopeSnap = await getDoc(scopeRef);
          m.set(
            sid,
            scopeSnap.exists()
              ? ({ id: scopeSnap.id, ...(scopeSnap.data() as object) } as WaveMonthTimesheetReview)
              : null,
          );
        }),
        ...waves.map(async (w) => {
          const ref = doc(firestore, 'wave_month_timesheet_reviews', `${w.id}_${monthYm}`);
          const snap = await getDoc(ref);
          m.set(w.id, snap.exists() ? ({ id: snap.id, ...(snap.data() as object) } as WaveMonthTimesheetReview) : null);
        }),
      ]);
      if (!cancelled) setReviewByWaveId(m);
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, monthYm, waves, poIdsKey]);

  /** Fan-out per-PO subcollection read แทน collectionGroup (rules production ยังไม่เปิด wildcard read) */
  const { data: bundlePoLinesData } = usePoLinesFanout(poIds);
  const bundlePoLines = useMemo(() => bundlePoLinesData ?? [], [bundlePoLinesData]);

  const contractIds = useMemo(
    () => [...new Set(posList.map((p) => (p.contractId || '').trim()).filter(Boolean))],
    [posList],
  );
  const contractIdsKey = contractIds.join('|');

  const [ratesByContractId, setRatesByContractId] = useState<Map<string, PositionRate[]>>(() => new Map());

  useEffect(() => {
    if (!firestore || contractIds.length === 0) {
      setRatesByContractId(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      const m = new Map<string, PositionRate[]>();
      await Promise.all(
        contractIds.map(async (cid) => {
          const snap = await getDocs(collection(firestore, 'main_contracts', cid, 'position_rates'));
          m.set(
            cid,
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) } as PositionRate)),
          );
        }),
      );
      if (!cancelled) setRatesByContractId(m);
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, contractIdsKey]);

  const mobsQuery = useMemoFirebase(() => {
    if (!firestore || !poIds.length) return null;
    if (poIds.length === 1) return query(collection(firestore, 'mobilizations'), where('poId', '==', poIds[0]));
    return query(collection(firestore, 'mobilizations'), where('poId', 'in', poIds.slice(0, 30)));
  }, [firestore, poIdsKey]);

  const { data: mobsForPo, isLoading: isAsgnLoading } = useCollection<Assignment>(mobsQuery as any);

  const assignmentRows = useMemo(() => {
    if (!mobsForPo) return [] as Assignment[];
    if (!rosterFilterYm || !/^\d{4}-\d{2}$/.test(rosterFilterYm)) {
      try {
        const t = parseISO(targetDate);
        if (Number.isNaN(t.getTime())) return [];
      } catch {
        return [];
      }
    }
    const inScope = mobsForPo.filter((a) => {
      if (!assignmentCountsTowardQuota(a)) return false;
      if (!assignmentIncludedInWaveTimesheetRoster(a)) return false;
      if (rosterFilterYm && /^\d{4}-\d{2}$/.test(rosterFilterYm)) {
        return poDailyBoardAssignmentInMonthRoster(a, rosterFilterYm);
      }
      const dateYmd = targetDate.slice(0, 10);
      const hasPersisted =
        persistedAssignmentIds.has(a.id) && !clearedRowIds.has(a.id);
      return poDailyBoardAssignmentVisibleOnDate(a, dateYmd, hasPersisted);
    });
    const roster = pickRosterLinePerWorker(inScope);
    return [...roster].sort((a, b) => compareAssignmentWorkerNamesTh(a, b, workers));
  }, [mobsForPo, targetDate, workers, rosterFilterYm, persistedAssignmentIds, clearedRowIds]);

  const visibleAssignmentRows = useMemo(() => {
    if (rowDisplayFilter === 'all') return assignmentRows;
    return assignmentRows.filter((asgn) =>
      poDailyBoardRowHasTimesheetOnDate(asgn.id, clearedRowIds, persistedAssignmentIds),
    );
  }, [assignmentRows, rowDisplayFilter, clearedRowIds, persistedAssignmentIds]);

  const activeEligibleAssignmentIds = useMemo(
    () => assignmentRows.filter((a) => isAssignmentEligibleForPoActiveAutoDaily(a)).map((a) => a.id),
    [assignmentRows],
  );

  const defaultHoursByAssignmentId = useMemo(() => {
    const m = new Map<string, number>();
    for (const asgn of assignmentRows) {
      const poRow = poById.get(asgn.poId);
      const cid = (asgn.contractId || poRow?.contractId || '').trim();
      const lines = bundlePoLines.filter((l) => l.poId === asgn.poId);
      const rates = ratesByContractId.get(cid);
      m.set(asgn.id, resolveContractDailyHoursForAssignmentLine(asgn.poLineId, lines, rates));
    }
    return m;
  }, [assignmentRows, bundlePoLines, ratesByContractId, poById]);

  const anyMonthLocked = useMemo(() => {
    for (const pid of poIds) {
      if (isMonthReviewLocked(reviewByWaveId.get(poTimesheetScopeId(pid)) ?? null)) return true;
    }
    for (const w of waves) {
      if (isMonthReviewLocked(reviewByWaveId.get(w.id) ?? null)) return true;
    }
    return false;
  }, [reviewByWaveId, waves, poIds]);

  const loadRoster = useCallback(async () => {
    if (!firestore || !targetDate || assignmentRows.length === 0) {
      if (assignmentRows.length === 0) setRosterData({});
      return;
    }
    const existing: Record<string, DailyTimesheet> = {};
    await Promise.all(
      poIds.map(async (pid) => {
        const q = query(
          collection(firestore, 'daily_timesheets'),
          where('purchaseOrderId', '==', pid),
          where('date', '==', targetDate),
        );
        const snap = await getDocs(q);
        snap.docs.forEach((d) => {
          const data = d.data() as DailyTimesheet;
          existing[data.assignmentId] = data;
        });
      }),
    );
    const next: Record<string, Partial<DailyTimesheet>> = {};
    const persisted = new Set<string>();
    for (const asgn of assignmentRows) {
      if (clearedRowIds.has(asgn.id)) continue;
      const dft = defaultHoursByAssignmentId.get(asgn.id) ?? 12;
      if (existing[asgn.id]) {
        persisted.add(asgn.id);
        const ex = existing[asgn.id];
        const et = ex.eventType;
        const nh = Number(ex.normalHours);
        const needsPackageHours =
          (et === 'mobilization_day' || et === 'demobilization_day' || et === 'standby_day') &&
          !(Number.isFinite(nh) && nh > 0);
        next[asgn.id] =
          et === 'unpaid_leave' && (ex.normalHours ?? 0) !== 0
            ? { ...ex, normalHours: 0 }
            : needsPackageHours
              ? { ...ex, normalHours: dft }
              : ex;
      } else {
        next[asgn.id] = {
          workerId: asgn.workerId,
          assignmentId: asgn.id,
          date: targetDate,
          eventType: 'work_day',
          normalHours: dft,
          ot15Hours: 0,
          status: 'DRAFT',
        };
      }
    }
    setPersistedAssignmentIds(persisted);
    setRosterData((prev) => {
      for (const id of dirtyRowIds) {
        if (clearedRowIds.has(id)) continue;
        const local = prev[id];
        if (local) next[id] = local;
      }
      return next;
    });
  }, [firestore, targetDate, assignmentRows, poIds, defaultHoursByAssignmentId, clearedRowIds, dirtyRowIds]);

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  useEffect(() => {
    setDirtyRowIds(new Set());
  }, [targetDate]);

  const runSilentTodayAutoSync = useCallback(async () => {
    if (!firestore || !canEditTimesheets || anyMonthLocked || activeEligibleAssignmentIds.length === 0) return;
    if (bundleAutoDailyDisabled) return;
    if (autoTodaySyncLockRef.current) return;
    autoTodaySyncLockRef.current = true;
    try {
      for (const aid of activeEligibleAssignmentIds) {
        try {
          await syncPoActiveAutoDailyForAssignment(firestore, aid, currentUser, { todayOnly: true });
        } catch {
          /* ไม่รบกวนผู้ใช้ — สิทธิ์/เครือข่ายรายแถว */
        }
      }
      const todayYmd = thailandTodayYmd();
      if (targetDate.slice(0, 10) === todayYmd) {
        await loadRoster();
      }
    } finally {
      autoTodaySyncLockRef.current = false;
    }
  }, [
    firestore,
    canEditTimesheets,
    anyMonthLocked,
    bundleAutoDailyDisabled,
    activeEligibleAssignmentIds,
    currentUser,
    targetDate,
    loadRoster,
  ]);

  const handleAutoGenBackfill = useCallback(async () => {
    if (!firestore || !canEditTimesheets) {
      toast({ variant: 'destructive', title: 'ไม่พร้อม', description: 'ไม่มีสิทธิ์แก้ไข timesheet หรือไม่ได้เชื่อมต่อ' });
      return;
    }
    if (anyMonthLocked) {
      toast({ variant: 'destructive', title: 'งวดล็อกแล้ว', description: 'ปลดล็อกงวดก่อนใช้ Auto gen' });
      return;
    }
    if (activeEligibleAssignmentIds.length === 0) {
      toast({
        title: 'ไม่มีแถว ACTIVE',
        description: 'ซิงก์อัตโนมัติเฉพาะคนที่สถานะปฏิบัติงานหน้างาน (on-site / ACTIVE) เท่านั้น',
      });
      return;
    }
    setAutoGenBusy(true);
    let c = 0;
    let u = 0;
    let s = 0;
    try {
      for (const aid of activeEligibleAssignmentIds) {
        const r = await syncPoActiveAutoDailyForAssignment(firestore, aid, currentUser, {
          ignoreBundleAutoDisabled: true,
        });
        c += r.created;
        u += r.updated;
        s += r.skipped;
      }
      toast({
        title: 'Auto gen เสร็จแล้ว',
        description: [
          `สร้าง ${c} · อัปเดต ${u} · ข้าม ${s} (แถวแก้มือหรือล็อกการเงินจะไม่ถูกทับ)`,
          s > 40
            ? 'ข้ามจำนวนมาก: มักเป็นแถวที่ลงมือแล้ว (ไม่มี poActiveAutoDaily) หรือบางวันอยู่นอกช่วงออโต้ · แถวเป็น "-" ใต้ชื่อมีข้อความแดง = ตรวจ Mobilization'
            : '',
        ]
          .filter(Boolean)
          .join(' '),
      });
      await loadRoster();
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'Auto gen ไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setAutoGenBusy(false);
    }
  }, [
    firestore,
    canEditTimesheets,
    anyMonthLocked,
    activeEligibleAssignmentIds,
    currentUser,
    loadRoster,
    toast,
  ]);

  useEffect(() => {
    lastBangkokYmdRef.current = thailandTodayYmd();
    void runSilentTodayAutoSync();
  }, [runSilentTodayAutoSync]);

  useEffect(() => {
    if (!canEditTimesheets || !firestore) return;
    const iv = window.setInterval(() => {
      const y = thailandTodayYmd();
      if (y !== lastBangkokYmdRef.current) {
        lastBangkokYmdRef.current = y;
        void runSilentTodayAutoSync();
      }
    }, 45_000);
    return () => window.clearInterval(iv);
  }, [canEditTimesheets, firestore, runSilentTodayAutoSync]);

  useEffect(() => {
    if (!canEditTimesheets || !firestore) return;
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      const y = thailandTodayYmd();
      if (y !== lastBangkokYmdRef.current) {
        lastBangkokYmdRef.current = y;
        void runSilentTodayAutoSync();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, [canEditTimesheets, firestore, runSilentTodayAutoSync]);

  const applyBulk = (field: keyof DailyTimesheet, value: unknown) => {
    if (anyMonthLocked) {
      toast({
        variant: 'destructive',
        title: 'งวดนี้ปิดแล้ว',
        description: 'งวด PO หรือ wave (ข้อมูลเก่า) ถูกล็อก / รออนุมัติ',
      });
      return;
    }
    if (!firestore) return;
    const updated = { ...rosterData };
    const service = new TimesheetService(firestore);
    const nextCleared = new Set(clearedRowIds);
    for (const asgn of assignmentRows) {
      if (!assignmentYmdEditableOnPoDailyBoard(asgn, targetDate.slice(0, 10))) continue;
      if (isHtmlDateAfterMobLocationEnd(asgn, targetDate)) continue;
      const currentStatus = (updated[asgn.id]?.status ?? rosterData[asgn.id]?.status) as
        | DailyTimesheetStatus
        | undefined;
      if (currentStatus && service.isFinalized(currentStatus)) continue;
      if (!service.canEdit(currentStatus ?? 'DRAFT')) continue;
      const dft = defaultHoursByAssignmentId.get(asgn.id) ?? 12;
      const cur =
        updated[asgn.id] ??
        ({
          workerId: asgn.workerId,
          assignmentId: asgn.id,
          date: targetDate,
          eventType: 'work_day' as RateConditionEventType,
          normalHours: dft,
          ot15Hours: 0,
          status: 'DRAFT' as DailyTimesheetStatus,
        } satisfies Partial<DailyTimesheet>);
      if (field === 'eventType') {
        const eventType = value as RateConditionEventType;
        let nextHours = Number(cur.normalHours) || 0;
        let nextOt = cur.ot15Hours ?? 0;
        if (eventType === 'unpaid_leave') {
          nextHours = 0;
          nextOt = 0;
        } else if (
          eventType === 'mobilization_day' ||
          eventType === 'demobilization_day' ||
          eventType === 'standby_day'
        ) {
          nextHours = nextHours > 0 ? nextHours : dft;
          nextOt = 0;
        } else if (eventType === 'work_day') {
          nextHours = nextHours > 0 ? nextHours : dft;
        }
        if (eventType !== 'work_day') nextOt = 0;
        const chargePair = defaultChargesForEventType(eventType, asgn.workMode, nextHours);
        const chargeFields = chargePair
          ? (() => {
              const built = buildTimesheetFieldsFromMobCharges(
                chargePair.billing,
                chargePair.payroll,
                defaultPackageHoursForWorkMode(asgn.workMode),
              );
              const { eventType: _e, normalHours: _n, ...rest } = built;
              return rest;
            })()
          : {};
        updated[asgn.id] = {
          ...cur,
          eventType,
          normalHours: nextHours,
          ot15Hours: nextOt,
          ...chargeFields,
        };
      } else {
        updated[asgn.id] = { ...cur, [field]: value };
      }
      nextCleared.delete(asgn.id);
    }
    setClearedRowIds(nextCleared);
    setRosterData(updated);
    for (const asgn of assignmentRows) {
      if (nextCleared.has(asgn.id)) continue;
      if (updated[asgn.id]) markRowDirty(asgn.id);
    }
    toast({
      title: 'Bulk apply',
      description: 'ใช้กับแถวที่วันที่เลือกอยู่ในช่วงมอบหมายและยังแก้ได้',
    });
  };

  const openClearDayDialog = () => {
    if (anyMonthLocked) {
      toast({
        variant: 'destructive',
        title: 'งวดนี้ปิดแล้ว',
        description: 'งวด PO หรือ wave (ข้อมูลเก่า) ถูกล็อก / รออนุมัติ',
      });
      return;
    }
    if (!canEditTimesheets) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์แก้ไข timesheet' });
      return;
    }
    if (!firestore) return;
    setClearDayDialogOpen(true);
  };

  const confirmClearDay = async () => {
    if (!firestore || !currentUser) return;
    setClearDayBusy(true);
    try {
      const service = new TimesheetService(firestore);
      const batch = writeBatch(firestore);
      let deleted = 0;
      let skipped = 0;
      let clearedRows = 0;
      const nextCleared = new Set(clearedRowIds);
      const nextPersisted = new Set(persistedAssignmentIds);
      const nextRoster: Record<string, Partial<DailyTimesheet>> = { ...rosterData };

      for (const asgn of assignmentRows) {
        if (!assignmentYmdEditableOnPoDailyBoard(asgn, targetDate.slice(0, 10))) continue;
        if (isHtmlDateAfterMobLocationEnd(asgn, targetDate)) continue;

        const currentStatus = rosterData[asgn.id]?.status as DailyTimesheetStatus | undefined;
        if (currentStatus && service.isFinalized(currentStatus)) {
          skipped += 1;
          continue;
        }
        if (!service.canEdit(currentStatus ?? 'DRAFT')) {
          skipped += 1;
          continue;
        }

        const docId = service.getTimesheetId(asgn.workerId, asgn.id, targetDate);
        const docRef = doc(firestore, 'daily_timesheets', docId);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          const cur = snap.data() as DailyTimesheet;
          if (service.isFinalized(cur.status)) {
            skipped += 1;
            continue;
          }
          batch.delete(docRef);
          deleted += 1;
        }

        nextCleared.add(asgn.id);
        nextPersisted.delete(asgn.id);
        delete nextRoster[asgn.id];
        clearedRows += 1;
      }

      if (clearedRows === 0 && deleted === 0) {
        toast({ title: 'ไม่มีแถวที่ล้างได้', description: 'แถวถูกล็อกหรืออยู่นอกช่วงวันที่เลือก' });
        setClearDayDialogOpen(false);
        return;
      }

      if (deleted > 0) {
        await batch.commit();
      }

      setClearedRowIds(nextCleared);
      setPersistedAssignmentIds(nextPersisted);
      setRosterData(nextRoster);
      setClearDayDialogOpen(false);
      toast({
        title: 'ล้างข้อมูลวันนี้แล้ว',
        description:
          deleted > 0
            ? `ลบ ${deleted} รายการจากระบบ${skipped > 0 ? ` · ข้าม ${skipped} แถวที่ล็อก` : ''}`
            : `ล้าง ${clearedRows} แถวบนจอ (ยังไม่เคยบันทึกในระบบ)`,
      });
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'ล้างข้อมูลไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setClearDayBusy(false);
    }
  };

  const handleSaveDraft = async () => {
    if (anyMonthLocked) {
      toast({ variant: 'destructive', title: 'งวดนี้ปิดแล้ว', description: 'ไม่สามารถบันทึก — งวดถูกล็อก' });
      return;
    }
    if (!canEditTimesheets) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์แก้ไข timesheet' });
      return;
    }
    if (!firestore || !currentUser) return;
    setIsSaving(true);
    try {
      const service = new TimesheetService(firestore);
      const payloads: Partial<DailyTimesheet>[] = [];
      const batch = writeBatch(firestore);
      let deleted = 0;
      let deleteSkipped = 0;

      for (const asgn of assignmentRows) {
        if (!clearedRowIds.has(asgn.id)) continue;
        if (!assignmentYmdEditableOnPoDailyBoard(asgn, targetDate.slice(0, 10))) continue;
        if (isHtmlDateAfterMobLocationEnd(asgn, targetDate)) continue;

        const docId = service.getTimesheetId(asgn.workerId, asgn.id, targetDate);
        const docRef = doc(firestore, 'daily_timesheets', docId);
        const snap = await getDoc(docRef);
        if (!snap.exists()) continue;
        const cur = snap.data() as DailyTimesheet;
        if (service.isFinalized(cur.status)) {
          deleteSkipped += 1;
          continue;
        }
        batch.delete(docRef);
        deleted += 1;
      }

      for (const asgn of assignmentRows) {
        if (clearedRowIds.has(asgn.id)) continue;
        if (!assignmentYmdEditableOnPoDailyBoard(asgn, targetDate.slice(0, 10))) continue;
        const ts = rosterData[asgn.id];
        if (!ts?.workerId) continue;
        if (ts.status && service.isFinalized(ts.status as DailyTimesheetStatus)) continue;

        const poRow = poById.get(asgn.poId) ?? canonicalPo;
        const rowScopeId = poTimesheetScopeId(poRow.id);
        if (isMonthReviewLocked(reviewByWaveId.get(rowScopeId) ?? null)) continue;
        const wv = waveById.get(asgn.waveId);
        if (wv && isMonthReviewLocked(reviewByWaveId.get(wv.id) ?? null)) continue;

        const worker = workers?.find((w) => w.id === asgn.workerId);
        const contractId = (asgn.contractId || poRow.contractId || '').trim();
        const poLineId = (asgn.poLineId || wv?.poLineId || '').trim();
        const positionId = (asgn.positionId || '').trim();
        if (!contractId || !poLineId || !positionId) {
          toast({
            variant: 'destructive',
            title: 'บันทึกไม่ได้ — ข้อมูลไม่ครบ',
            description: 'contractId, poLineId, positionId — ตรวจ mobilization / PO',
          });
          setIsSaving(false);
          return;
        }

        const isUnpaid = ts.eventType === 'unpaid_leave';
        const isWorkDay = ts.eventType === 'work_day';
        const priorRemark = String(ts.remark || '').trim();
        const nextRemark = priorRemark.startsWith('Auto —') ? '' : priorRemark;
        payloads.push({
          ...ts,
          normalHours: isUnpaid ? 0 : (ts.normalHours ?? 0),
          ot15Hours: isWorkDay ? Math.max(0, Number(ts.ot15Hours) || 0) : 0,
          ot20Hours: isWorkDay ? Math.max(0, Number(ts.ot20Hours) || 0) : 0,
          ot30Hours: isWorkDay ? Math.max(0, Number(ts.ot30Hours) || 0) : 0,
          mobCycleId: asgn.mobCycleId || buildMobCycleDocId(asgn.id, asgn.mobCycleNumber ?? 1),
          workerNameSnapshot: worker ? `${worker.firstName} ${worker.lastName}` : 'Unknown',
          waveId: rowScopeId,
          siteId: rowScopeId,
          purchaseOrderId: asgn.poId || poRow.id,
          poActiveBundleId: bundleKey ?? poRow.poActiveBundleId,
          poLineId,
          contractId,
          customerId: poRow.customerId || '',
          positionId,
          workMode: asgn.workMode ?? 'OFFSHORE',
          shiftType: ts.eventType === 'standby_day' ? 'STANDBY' : 'DAY',
          status: 'DRAFT',
          remark: nextRemark,
          poActiveAutoDaily: false,
        });
      }

      if (payloads.length === 0 && deleted === 0) {
        toast({ title: 'ไม่มีการเปลี่ยน', description: 'รายการถูกล็อกหรือว่าง' });
        return;
      }

      if (deleted > 0) {
        await batch.commit();
      }

      if (payloads.length > 0) {
        const results = await service.bulkUpsertTimesheets(payloads, currentUser);
        toast({
          title: 'บันทึกร่างสำเร็จ',
          description:
            deleted > 0
              ? `ลบ ${deleted} · สร้าง ${results.created} · อัปเดต ${results.updated}${deleteSkipped > 0 ? ` · ข้ามลบ ${deleteSkipped}` : ''}`
              : `สร้าง ${results.created} · อัปเดต ${results.updated}`,
        });
      } else {
        toast({
          title: 'ล้างช่องแล้ว',
          description:
            deleteSkipped > 0
              ? `ลบ ${deleted} รายการ${deleteSkipped > 0 ? ` · ข้าม ${deleteSkipped} แถวที่ล็อก` : ''}`
              : `ลบ ${deleted} รายการจากระบบ`,
        });
      }
      setDirtyRowIds(new Set());
      await loadRoster();
    } catch (e: unknown) {
      toast({ variant: 'destructive', title: 'Error', description: e instanceof Error ? e.message : String(e) });
    } finally {
      setIsSaving(false);
    }
  };

  const confirmFinishJobModal = async () => {
    if (!firestore || !currentUser?.id || !finishJobModal) return;
    if (!canEditTimesheets) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์' });
      return;
    }
    const finishYmd = (finishJobDateYmd || '').trim().slice(0, 10);
    const issue = finishJobDateIssue(finishJobModal.assignment, finishYmd);
    if (issue) {
      toast({ variant: 'destructive', title: 'วันที่ไม่ถูกต้อง', description: issue });
      return;
    }
    const counts =
      finishAfterCounts ??
      (await countTimesheetsAfterMobFinishDate(firestore, finishJobModal.assignment.id, finishYmd));
    if (counts.deletable > 0) {
      setFinishPurgeConfirm({
        assignment: finishJobModal.assignment,
        finishYmd,
        mode: finishJobModal.mode,
        finishTiming: finishJobModal.finishTiming,
        todayEventType: finishJobModal.todayEventType,
        deletable: counts.deletable,
        locked: counts.locked,
      });
      return;
    }
    await executeMobFinishJob({
      asgn: finishJobModal.assignment,
      finishYmd,
      mode: finishJobModal.mode,
      finishTiming: finishJobModal.finishTiming,
      todayEventType: finishJobModal.todayEventType,
    });
  };

  const executeMobFinishJob = async (params: {
    asgn: Assignment;
    finishYmd: string;
    mode: 'finish' | 'revise';
    finishTiming?: 'today' | 'tomorrow';
    todayEventType?: PoActiveStopTodayEvent;
    charges?: { billing: MobDayChargeSpec; payroll: MobDayChargeSpec };
  }) => {
    if (!firestore || !currentUser?.id) return;
    const { asgn, finishYmd, mode, finishTiming, todayEventType, charges } = params;
    const now = Date.now();
    setDemobSubmitting(true);
    try {
      if (mode === 'finish' && todayEventType) {
        await upsertPoActiveStopTodayEvent(
          firestore,
          asgn.id,
          currentUser,
          todayEventType,
          todayEventType === 'demobilization_day' ? charges : undefined,
        );
      }

      const mobRef = doc(firestore, 'mobilizations', asgn.id);
      const batch = writeBatch(firestore);
      if (mode === 'revise') {
        batch.update(mobRef, {
          mobLocationEndDate: finishYmd,
          mobLocationEndedAt: now,
          mobLocationEndedByUserId: currentUser.id,
          updatedAt: now,
          updatedBy: currentUser.id,
        });
        await batch.commit();
      } else {
        const tsService = new TimesheetService(firestore);
        const nextCycle = Math.max(1, (asgn.mobCycleNumber || 1) + 1);
        batch.update(mobRef, {
          mobFinishUndoSnapshot: buildMobFinishUndoSnapshot(asgn),
          deploymentStatus: 'DRAFT',
          mobilizationStatus: 'PENDING',
          mobCycleNumber: nextCycle,
          mobCycleId: buildMobCycleDocId(asgn.id, nextCycle),
          mobLocationEndDate: finishYmd,
          mobLocationEndedAt: now,
          mobLocationEndedByUserId: currentUser.id,
          ...buildMobRemobClearanceDeleteFields(deleteField()),
          poActiveAutoWorkSuspended: deleteField(),
          poActiveStandbyAutoStartYmd: deleteField(),
          poActiveStandbyAutoEndYmd: deleteField(),
          updatedAt: now,
          updatedBy: currentUser.id,
        });

        if (finishTiming === 'today' && !todayEventType) {
          const ty = thailandTodayYmd();
          const tid = poActiveDailyTimesheetDocId(asgn.workerId, asgn.id, ty);
          const tsRef = doc(firestore, 'daily_timesheets', tid);
          const tsSnap = await getDoc(tsRef);
          if (tsSnap.exists()) {
            const cur = tsSnap.data() as DailyTimesheet;
            if (
              !tsService.isFinalized(cur.status as DailyTimesheetStatus) &&
              cur.poActiveAutoDaily === true &&
              cur.eventType === 'work_day'
            ) {
              batch.update(tsRef, {
                eventType: 'unpaid_leave',
                normalHours: 0,
                shiftType: 'DAY',
                remark: '',
                updatedAt: now,
              });
            }
          }
        }

        await batch.commit();
      }

      const purge = await deleteTimesheetsAfterMobFinishDate(firestore, asgn, finishYmd);
      const finishYm = finishYmd.slice(0, 7);
      await purgeStalePoActiveAutoDailyForCalendarMonth(firestore, asgn.id, finishYm);
      const targetYm = targetDate.slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(targetYm) && targetYm !== finishYm) {
        await purgeStalePoActiveAutoDailyForCalendarMonth(firestore, asgn.id, targetYm);
      }

      /** ลบใบของ mobilization อื่นคน+PO เดียวกันหลังวันจบ — กันวันเดียวสองสถานะตอน remob */
      if ((asgn.poId || '').trim() && (asgn.workerId || '').trim()) {
        await deleteOrphanTimesheetsForWorkerPoInRange(firestore, {
          workerId: asgn.workerId,
          purchaseOrderId: asgn.poId,
          keepAssignmentId: asgn.id,
          fromYmdInclusive: addDaysToYmd(finishYmd, 1),
        });
      }

      setFinishJobModal(null);
      setFinishPurgeConfirm(null);
      await loadRoster();

      const purgeNote =
        purge.deleted > 0
          ? ` · ลบลงเวลาหลังวันจบ ${purge.deleted} รายการ`
          : purge.skipped > 0
            ? ` · ข้ามลบ ${purge.skipped} แถวที่ล็อก`
            : '';

      if (mode === 'revise') {
        toast({
          title: 'แก้ไขวันสิ้นสุดงานแล้ว',
          description: `บันทึกวันสิ้นสุด ณ ${formatYmdLocalThaiBE(finishYmd)}${purgeNote}`,
        });
      } else {
        toast({
          title: 'จบงานแล้ว — Waiting MOB',
          description: `บันทึกจบงาน ณ ${formatYmdLocalThaiBE(finishYmd)} · ลงเวลาอัตโนมัติหยุดหลังวันนี้จน remob${purgeNote}`,
        });
      }
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'อัปเดตไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setDemobSubmitting(false);
    }
  };

  const confirmFinishPurgeDialog = async () => {
    if (!finishPurgeConfirm) return;
    await executeMobFinishJob({
      asgn: finishPurgeConfirm.assignment,
      finishYmd: finishPurgeConfirm.finishYmd,
      mode: finishPurgeConfirm.mode,
      finishTiming: finishPurgeConfirm.finishTiming,
      todayEventType: finishPurgeConfirm.todayEventType,
      charges: finishPurgeConfirm.charges,
    });
  };

  const openDemobChargeConfig = (asgn: Assignment) => {
    const defaults = defaultDemobDayCharges(asgn.workMode);
    setDemobBillingCharge(defaults.billing);
    setDemobPayrollCharge(defaults.payroll);
    setDemobChargeAssignment(asgn);
    setStopFlow(null);
    setDemobChargeOpen(true);
  };

  const demobPreviewRates = useMemo(() => {
    const asgn = demobChargeAssignment;
    if (!asgn) return null;
    const line = bundlePoLines.find((l) => l.id === asgn.poLineId && l.poId === asgn.poId);
    const rates = ratesByContractId.get((asgn.contractId || '').trim()) ?? [];
    const positionRate =
      rates.find((r) => r.positionId === asgn.positionId && r.active !== false) ?? null;
    const workMode = (asgn.workMode === 'ONSHORE' ? 'ONSHORE' : 'OFFSHORE') as 'ONSHORE' | 'OFFSHORE';
    const pkg = defaultPackageHoursForWorkMode(asgn.workMode);
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
    const otMult = Number((line?.costOtRulesSnapshot as { afterShift?: number } | undefined)?.afterShift) || 1.5;
    return buildMobDayChargeBahtPreviewRates({
      packageHours: pkg,
      positionRate,
      sellWorkingDayRate: sellWorking,
      costWorkingDayRate: costWorking,
      otAfterShiftMultiplier: otMult,
      workMode: asgn.workMode,
    });
  }, [demobChargeAssignment, bundlePoLines, ratesByContractId]);

  const confirmCancelFinishJob = async () => {
    if (!firestore || !currentUser?.id || !cancelFinishTarget) return;
    if (!canEditTimesheets) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์' });
      return;
    }
    const asgn = cancelFinishTarget;
    const prevCycle = Math.max(1, (asgn.mobCycleNumber || 1) - 1);
    const now = Date.now();
    setDemobSubmitting(true);
    try {
      const mobRef = doc(firestore, 'mobilizations', asgn.id);
      const batch = writeBatch(firestore);
      const restoreFields = buildMobFinishUndoRestoreFields(
        asgn.id,
        asgn.mobFinishUndoSnapshot,
        prevCycle,
        deleteField(),
      );
      if (
        !asgn.mobFinishUndoSnapshot?.mobWorkingStartDate &&
        typeof restoreFields.mobWorkingStartDate === 'object'
      ) {
        const inferred = await inferMobDatesFromTimesheets(firestore, asgn.id);
        if (inferred.mobWorkingStartDate) restoreFields.mobWorkingStartDate = inferred.mobWorkingStartDate;
        if (
          !asgn.mobFinishUndoSnapshot?.mobStandbyDate &&
          typeof restoreFields.mobStandbyDate === 'object' &&
          inferred.mobStandbyDate
        ) {
          restoreFields.mobStandbyDate = inferred.mobStandbyDate;
        }
      }
      if (!asgn.mobFinishUndoSnapshot) {
        restoreFields.deploymentStatus = 'ACTIVE';
        restoreFields.mobilizationStatus = 'ACTIVE';
      }
      batch.update(mobRef, {
        ...restoreFields,
        updatedAt: now,
        updatedBy: currentUser.id,
      });
      await batch.commit();
      setCancelFinishTarget(null);
      await loadRoster();
      toast({
        title: 'ยกเลิกการจบงานแล้ว',
        description: asgn.mobFinishUndoSnapshot
          ? 'สถานะและวัน mobilization กลับตามก่อนจบงาน — แก้ไขลงเวลาได้ตามปกติ'
          : 'สถานะกลับเป็น ACTIVE — ตรวจวันเริ่มงานใน Mobilization ถ้ายังลงเวลาไม่ได้',
      });
    } catch (e: unknown) {
      toast({ variant: 'destructive', title: 'อัปเดตไม่สำเร็จ', description: e instanceof Error ? e.message : String(e) });
    } finally {
      setDemobSubmitting(false);
    }
  };

  const runStopFinishChoice = useCallback(
    async (
      asgn: Assignment,
      todayEventType: PoActiveStopTodayEvent,
      charges?: { billing: MobDayChargeSpec; payroll: MobDayChargeSpec },
    ) => {
      if (!firestore || !canEditTimesheets || !currentUser?.id) {
        toast({ variant: 'destructive', title: 'ไม่พร้อม', description: 'ไม่มีสิทธิ์หรือไม่ได้เชื่อมต่อ' });
        return;
      }
      if (anyMonthLocked) {
        toast({ variant: 'destructive', title: 'งวดล็อกแล้ว', description: 'ปลดล็อกงวดก่อนบันทึก' });
        return;
      }
      const finishYmd = thailandTodayYmd();
      const issue = finishJobDateIssue(asgn, finishYmd);
      if (issue) {
        toast({ variant: 'destructive', title: 'วันที่ไม่ถูกต้อง', description: issue });
        return;
      }
      setStandbySubmitting(true);
      try {
        setStopFlow(null);
        setDemobChargeOpen(false);
        const counts = await countTimesheetsAfterMobFinishDate(firestore, asgn.id, finishYmd);
        if (counts.deletable > 0) {
          setFinishPurgeConfirm({
            assignment: asgn,
            finishYmd,
            mode: 'finish',
            todayEventType,
            charges,
            deletable: counts.deletable,
            locked: counts.locked,
          });
          return;
        }
        await executeMobFinishJob({
          asgn,
          finishYmd,
          mode: 'finish',
          todayEventType,
          charges,
        });
      } catch (e: unknown) {
        toast({
          variant: 'destructive',
          title: 'บันทึกไม่สำเร็จ',
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setStandbySubmitting(false);
      }
    },
    [firestore, canEditTimesheets, anyMonthLocked, currentUser, toast],
  );

  const runStopToggleSbW = useCallback(
    async (asgn: Assignment) => {
      if (!firestore || !canEditTimesheets) {
        toast({ variant: 'destructive', title: 'ไม่พร้อม', description: 'ไม่มีสิทธิ์หรือไม่ได้เชื่อมต่อ' });
        return;
      }
      if (anyMonthLocked) {
        toast({ variant: 'destructive', title: 'งวดล็อกแล้ว', description: 'ปลดล็อกงวดก่อนบันทึก' });
        return;
      }
      setStandbySubmitting(true);
      try {
        const r = await togglePoActiveSbWStopMode(firestore, asgn.id, currentUser);
        setStopFlow(null);
        toast({
          title: r.mode === 'sb' ? 'สลับเป็น SB อัตโนมัติแล้ว' : 'สลับกลับเป็น W อัตโนมัติแล้ว',
          description:
            r.mode === 'sb'
              ? `ยัง ACTIVE — ระบบลง SB อัตโนมัติจนกว่าจะกดหยุดเลือกข้อ 1–3 เพื่อกลับ Waiting MOB${r.endYmd ? ` · ถึง ${formatYmdLocalThaiBE(r.endYmd)}` : ''}`
              : 'ยัง ACTIVE — ระบบลง W อัตโนมัติตามปกติ · กดหยุดข้อ 4 อีกครั้งเพื่อสลับเป็น SB',
        });
        await loadRoster();
      } catch (e: unknown) {
        toast({
          variant: 'destructive',
          title: 'บันทึกไม่สำเร็จ',
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setStandbySubmitting(false);
      }
    },
    [firestore, canEditTimesheets, anyMonthLocked, currentUser, loadRoster, toast],
  );

  const finishModalWorkerName = finishJobModal
    ? (() => {
        const w = workers?.find((x) => x.id === finishJobModal.assignment.workerId);
        return w ? `${w.firstName} ${w.lastName}`.trim() : finishJobModal.assignment.workerId;
      })()
    : '';

  const stopFlowWorkerName = stopFlow
    ? (() => {
        const w = workers?.find((x) => x.id === stopFlow.assignment.workerId);
        return w ? `${w.firstName} ${w.lastName}`.trim() : stopFlow.assignment.workerId;
      })()
    : '';

  const finishModalDateIssue = finishJobModal
    ? finishJobDateIssue(finishJobModal.assignment, finishJobDateYmd)
    : null;

  return (
    <>
      <Card className="shadow-lg border-none overflow-hidden">
        <CardHeader className="bg-primary/95 text-primary-foreground border-b">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-lg flex flex-wrap items-center gap-2">
                <CalendarDays className="h-5 w-5 shrink-0 opacity-90" aria-hidden />
                {isBundle ? <span>ชุด PO Active</span> : <span className="font-mono">{canonicalPo.poCode}</span>}
                <span className="opacity-80">· งวด {formatThaiYearMonthLabel(monthYm, 'th-TH')}</span>
                <span className="text-xs font-normal opacity-90">({monthYm})</span>
              </CardTitle>
            </div>
            <div className="flex flex-col gap-1.5 sm:items-end shrink-0">
              <Button
                variant="secondary"
                size="sm"
                disabled={!billingModesReady}
                onClick={() => requestMonthlyTimesheetProceed(poMonthHref)}
              >
                Monthly Timesheet (วางบิล / payroll) →
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0 space-y-4">
          {anyMonthLocked ? (
            <Alert className="rounded-none border-x-0 border-t-0">
              <AlertTitle>
                งวด {monthYm} ถูกล็อกสำหรับ {isBundle ? 'PO ในชุดนี้' : 'PO นี้'} (หรือ wave ข้อมูลเก่า)
              </AlertTitle>
              <AlertDescription>
                สถานะ entry_locked / รออนุมัติ / อนุมัติ — แก้เวลาในกระดานนี้ไม่ได้จนกว่าจะปลดล็อกตามกระบวนการ
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="p-4 bg-muted/20 rounded-none border-b border-dashed">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex flex-col gap-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-black text-muted-foreground uppercase flex items-center gap-2 mr-1">
                    <Zap className="h-4 w-4 text-amber-500 shrink-0" /> Quick apply (
                    {isBundle ? 'ทุกแถวในตารางชุดนี้' : 'ทุก row ใต้ PO นี้'})
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="bg-white border-primary/20"
                    disabled={anyMonthLocked}
                    onClick={() => applyBulk('eventType', 'work_day')}
                  >
                    1. Work day
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="bg-white border-primary/20"
                    disabled={anyMonthLocked}
                    onClick={() => applyBulk('eventType', 'standby_day')}
                  >
                    2. Standby
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="bg-white border-primary/20"
                    disabled={anyMonthLocked}
                    onClick={() => applyBulk('eventType', 'mobilization_day')}
                  >
                    3. Mob
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="bg-white border-primary/20"
                    disabled={anyMonthLocked}
                    onClick={() => applyBulk('eventType', 'demobilization_day')}
                  >
                    4. Dmob
                  </Button>
                </div>
                <div className="flex flex-nowrap items-center gap-2 overflow-x-auto pb-0.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="bg-white border-muted-foreground/30 text-muted-foreground hover:text-foreground h-9 shrink-0"
                    disabled={anyMonthLocked || !canEditTimesheets}
                    onClick={openClearDayDialog}
                    title="ล้างข้อมูลทุกแถวของวันที่เลือก — บันทึกลงระบบทันที"
                  >
                    Clear
                  </Button>
                  <Select
                    value={rowDisplayFilter}
                    onValueChange={(v) => setRowDisplayFilter(v as PoDailyBoardRowFilter)}
                  >
                    <SelectTrigger className="h-9 w-[11.5rem] shrink-0 text-xs bg-background" aria-label="แถวในตาราง">
                      <ListFilter className="h-3.5 w-3.5 shrink-0 text-muted-foreground mr-1" aria-hidden />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">แสดงทั้งหมด</SelectItem>
                      <SelectItem value="filled">เฉพาะแถวที่ไม่ว่าง</SelectItem>
                    </SelectContent>
                  </Select>
                  {rowDisplayFilter === 'filled' ? (
                    <span className="text-[10px] text-muted-foreground tabular-nums shrink-0 whitespace-nowrap">
                      {visibleAssignmentRows.length}/{assignmentRows.length}
                    </span>
                  ) : null}
                  <DatePickerThaiBE
                    className="h-9 w-[11rem] shrink-0 justify-start"
                    value={htmlDateValueToTimestampMs(targetDate)}
                    onChange={onBoardDateChange}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2 shrink-0 lg:pt-5">
                {showAutoMasterSwitch ? (
                  <div className="flex items-center gap-2 rounded-md border border-muted bg-background/90 px-2.5 py-1.5">
                    <Switch
                      id="po-active-auto-daily-master"
                      checked={!bundleAutoDailyDisabled}
                      disabled={autoMasterSaving || !canEditTimesheets || anyMonthLocked}
                      onCheckedChange={(on) => void handleBundleAutoDailyToggle(on)}
                      aria-label="เปิดหรือปิดการลงเวลารายวันอัตโนมัติ PO Active"
                    />
                    <Label
                      htmlFor="po-active-auto-daily-master"
                      className="text-[10px] font-bold leading-tight cursor-pointer select-none max-w-[9.5rem]"
                    >
                      ลงเวลาอัตโนมัติ
                      <span className="block font-normal text-muted-foreground font-mono text-[9px]">
                        PO Active · Scheduler
                      </span>
                    </Label>
                  </div>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 border-dashed bg-white/90 border-primary/25"
                  onClick={() => void handleAutoGenBackfill()}
                  disabled={
                    autoGenBusy ||
                    !canEditTimesheets ||
                    anyMonthLocked ||
                    activeEligibleAssignmentIds.length === 0
                  }
                  title="เติมช่วงที่ขาดด้วยมือ — นอกจากนี้มี Cloud Function + Scheduler เติมวันนี้ (~00:10 ไทย) และซิงก์เมื่อมีผู้เปิดกระดาน"
                >
                  {autoGenBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  )}
                  Auto gen
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5 bg-primary font-bold shadow-sm"
                  onClick={() => void handleSaveDraft()}
                  disabled={isSaving || !canEditTimesheets || anyMonthLocked}
                >
                  {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  บันทึก
                </Button>
              </div>
            </div>
          </div>

          {isAsgnLoading && (
            <div className="py-20 text-center animate-pulse">Loading Roster…</div>
          )}
          {!isAsgnLoading && assignmentRows.length > 0 ? (
            <>
            {rowDisplayFilter === 'filled' && visibleAssignmentRows.length === 0 ? (
              <Alert className="mx-4 mb-2 border-dashed">
                <AlertTitle>ไม่มีแถวที่มีข้อมูลสำหรับวันนี้</AlertTitle>
                <AlertDescription className="text-sm">
                  ยังไม่มีใครบันทึก timesheet สำหรับ {formatYmdLocalThaiBE(targetDate)} — กด «แสดงทั้งหมด» เพื่อลงเวลา
                </AlertDescription>
              </Alert>
            ) : null}
            <Table className="w-full text-sm">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="pl-6 py-4 font-bold min-w-[9rem]">พนักงาน (Worker)</TableHead>
                  {isBundle ? (
                    <TableHead className="font-bold w-[7rem] min-w-[6rem] whitespace-nowrap">รหัส PO</TableHead>
                  ) : null}
                  <TableHead className="font-bold w-[8.5rem] min-w-[7rem]">วันที่มอบหมาย</TableHead>
                  <TableHead className="font-bold min-w-[5rem] max-w-[8rem]">ตำแหน่ง</TableHead>
                  <TableHead className="font-bold w-[148px] max-w-[160px] shrink-0">ประเภทวัน</TableHead>
                  <TableHead className="font-bold text-center w-[4.5rem] min-w-[4.5rem] shrink-0 px-2">ชั่วโมงปกติ</TableHead>
                  <TableHead className="font-bold text-center w-[4.5rem] min-w-[4.5rem] shrink-0 px-2" title="ชม. OT (ot15 — ใช้คำนวณ payroll/billing)">
                    OT ชม.
                  </TableHead>
                  <TableHead className="font-bold w-[6.5rem] shrink-0 whitespace-nowrap">สถานะปัจจุบัน</TableHead>
                  <TableHead className="min-w-[6.5rem] text-center font-bold shrink-0">หยุด</TableHead>
                  <TableHead className="text-right pr-6 min-w-[6rem] w-[18%]">หมายเหตุ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleAssignmentRows.map((asgn) => {
                  const wv = waveById.get(asgn.waveId);
                  const poForRow = poById.get(asgn.poId) ?? canonicalPo;
                  const rowScopeId = poTimesheetScopeId(poForRow.id);
                  const scopeLocked = isMonthReviewLocked(reviewByWaveId.get(rowScopeId) ?? null);
                  const waveLocked =
                    wv && !isPoTimesheetScopeId(asgn.waveId)
                      ? isMonthReviewLocked(reviewByWaveId.get(wv.id) ?? null)
                      : false;
                  const rowLocked = scopeLocked || waveLocked;
                  const dft = defaultHoursByAssignmentId.get(asgn.id) ?? 12;
                  const raw = rosterData[asgn.id];
                  const isRowCleared = clearedRowIds.has(asgn.id);
                  const persisted = persistedAssignmentIds.has(asgn.id) && !isRowCleared;
                  const afterMobEnd = isHtmlDateAfterMobLocationEnd(asgn, targetDate);
                  const awaitingRemob = assignmentAwaitingRemobAfterSiteFinish(asgn);
                  const priorCycleWorkWhileAwaitingRemob = isPoDailyBoardPriorCycleWorkDateWhileAwaitingRemob(
                    asgn,
                    targetDate.slice(0, 10),
                  );
                  const worker = workers?.find((x) => x.id === asgn.workerId);
                  const et = raw?.eventType ?? 'work_day';
                  const showEventTypeEditor =
                    !afterMobEnd || persisted || priorCycleWorkWhileAwaitingRemob;
                  /** หลัง mob end — ซ่อนยอดจาก Firestore เฉพาะเมื่อไม่เปิดแก้ประเภทวัน */
                  const maskAfterMobEnd =
                    afterMobEnd && !(awaitingRemob && priorCycleWorkWhileAwaitingRemob);
                  const row =
                    isRowCleared
                      ? {
                          eventType: 'work_day' as RateConditionEventType,
                          normalHours: 0,
                          ot15Hours: 0,
                          remark: '',
                          status: undefined as DailyTimesheetStatus | undefined,
                        }
                      : maskAfterMobEnd && !showEventTypeEditor
                        ? {
                            eventType: 'work_day' as RateConditionEventType,
                            normalHours: 0,
                            ot15Hours: 0,
                            remark: '',
                            status: undefined as DailyTimesheetStatus | undefined,
                          }
                        : {
                            ...raw,
                            eventType: et,
                            normalHours:
                              et === 'unpaid_leave'
                                ? 0
                                : (() => {
                                    const nh = Number(raw?.normalHours);
                                    if (Number.isFinite(nh) && nh > 0) return nh;
                                    /** M1/D1/SB ที่เคยบันทึก 0 — โชว์ชม.แพ็กมาตรฐาน (OFF 12 / ON 8) */
                                    if (
                                      et === 'mobilization_day' ||
                                      et === 'demobilization_day' ||
                                      et === 'standby_day'
                                    ) {
                                      return dft;
                                    }
                                    return dft;
                                  })(),
                            ot15Hours: raw?.ot15Hours ?? 0,
                            remark: raw?.remark ?? '',
                          };
                  const tsService = new TimesheetService(firestore!);
                  const isLocked = tsService.isFinalized(row.status as DailyTimesheetStatus);
                  const dateInAssignment = assignmentYmdEditableOnPoDailyBoard(
                    asgn,
                    targetDate.slice(0, 10),
                    persisted,
                  );
                  const editableMobWindow = dateInAssignment;
                  const rowEditLocked =
                    isLocked ||
                    rowLocked ||
                    anyMonthLocked ||
                    !editableMobWindow ||
                    (afterMobEnd && !persisted && !priorCycleWorkWhileAwaitingRemob);
                  const canFinishJob =
                    editableMobWindow &&
                    WAVE_TIMESHEET_DEPLOYMENT_STATUSES.includes(asgn.deploymentStatus as Assignment['deploymentStatus']);
                  const eventSelectValue = isRowCleared
                    ? PO_DAILY_BOARD_EVENT_CLEAR
                    : row.eventType;

                  return (
                    <TableRow
                      key={asgn.id}
                      className={
                        rowEditLocked
                          ? !editableMobWindow
                            ? 'bg-amber-50/40 dark:bg-amber-950/20'
                            : 'bg-slate-50 opacity-80'
                          : 'hover:bg-muted/20'
                      }
                    >
                      <TableCell className="pl-6 py-4">
                        <div className="flex flex-col">
                          <span className="font-bold text-sm text-primary">
                            {worker?.firstName} {worker?.lastName}
                          </span>
                          <span className="text-[9px] font-mono text-muted-foreground uppercase">
                            {worker?.workerCode || asgn.id.slice(0, 8)}
                          </span>
                        </div>
                      </TableCell>
                      {isBundle ? (
                        <TableCell className="align-top py-4 font-mono text-xs text-muted-foreground">
                          {poForRow.poCode}
                        </TableCell>
                      ) : null}
                      <TableCell className="align-top text-xs py-4 text-foreground/90">
                        <span className="leading-tight">
                          {formatYmdLocalThaiBE((asgn.assignedDate || asgn.startDate || '').trim() || '—')}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm align-top py-4 max-w-[8rem]">
                        <span className="line-clamp-2" title={positionLabel(asgn.positionId)}>
                          {positionLabel(asgn.positionId)}
                        </span>
                      </TableCell>
                      <TableCell className="w-[148px] max-w-[160px] align-top py-4 shrink-0">
                        {!showEventTypeEditor ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <Select
                            disabled={rowEditLocked}
                            value={eventSelectValue}
                            onValueChange={(v) => {
                              if (v === PO_DAILY_BOARD_EVENT_CLEAR) {
                                setClearedRowIds((prev) => {
                                  const next = new Set(prev);
                                  next.add(asgn.id);
                                  return next;
                                });
                                setDirtyRowIds((prev) => {
                                  if (!prev.has(asgn.id)) return prev;
                                  const next = new Set(prev);
                                  next.delete(asgn.id);
                                  return next;
                                });
                                setRosterData((prev) => {
                                  const next = { ...prev };
                                  delete next[asgn.id];
                                  return next;
                                });
                                return;
                              }
                              setClearedRowIds((prev) => {
                                if (!prev.has(asgn.id)) return prev;
                                const next = new Set(prev);
                                next.delete(asgn.id);
                                return next;
                              });
                              markRowDirty(asgn.id);
                              setRosterData((prev) => {
                                const cur = prev[asgn.id] ?? {
                                  workerId: asgn.workerId,
                                  assignmentId: asgn.id,
                                  date: targetDate,
                                  eventType: 'work_day' as RateConditionEventType,
                                  normalHours: dft,
                                  ot15Hours: 0,
                                  status: 'DRAFT' as DailyTimesheetStatus,
                                };
                                const eventType = v as RateConditionEventType;
                                let nextHours = Number(cur.normalHours) || 0;
                                let nextOt = cur.ot15Hours ?? 0;
                                if (eventType === 'unpaid_leave') {
                                  nextHours = 0;
                                  nextOt = 0;
                                } else if (
                                  eventType === 'mobilization_day' ||
                                  eventType === 'demobilization_day' ||
                                  eventType === 'standby_day'
                                ) {
                                  nextHours = nextHours > 0 ? nextHours : dft;
                                  nextOt = 0;
                                } else if (cur.eventType === 'unpaid_leave') {
                                  nextHours = dft;
                                } else if (!(nextHours > 0)) {
                                  nextHours = dft;
                                }
                                if (eventType !== 'work_day') nextOt = 0;
                                const chargePair = defaultChargesForEventType(
                                  eventType,
                                  asgn.workMode,
                                  nextHours,
                                );
                                const chargeFields = chargePair
                                  ? (() => {
                                      const built = buildTimesheetFieldsFromMobCharges(
                                        chargePair.billing,
                                        chargePair.payroll,
                                        defaultPackageHoursForWorkMode(asgn.workMode),
                                      );
                                      const { eventType: _e, normalHours: _n, ...rest } = built;
                                      return rest;
                                    })()
                                  : {};
                                return {
                                  ...prev,
                                  [asgn.id]: {
                                    ...cur,
                                    eventType,
                                    normalHours: nextHours,
                                    ot15Hours: nextOt,
                                    ...chargeFields,
                                  },
                                };
                              });
                            }}
                          >
                            <SelectTrigger className="h-9 text-xs w-full max-w-[160px] min-w-0 [&_span]:truncate">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={PO_DAILY_BOARD_EVENT_CLEAR}>ว่าง (ล้างช่อง)</SelectItem>
                              {EVENT_TYPE_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                      <TableCell className={PO_BOARD_HOURS_CELL_CLASS}>
                        {!showEventTypeEditor || isRowCleared ? (
                          <span className="flex h-9 items-center justify-center text-xs text-muted-foreground">—</span>
                        ) : (
                          <Input
                            disabled={rowEditLocked || row.eventType === 'unpaid_leave'}
                            type="number"
                            className={PO_BOARD_HOURS_INPUT_CLASS}
                            value={row.normalHours}
                            onChange={(e) => {
                              const v = parseInt(e.target.value, 10) || 0;
                              setClearedRowIds((prev) => {
                                if (!prev.has(asgn.id)) return prev;
                                const next = new Set(prev);
                                next.delete(asgn.id);
                                return next;
                              });
                              markRowDirty(asgn.id);
                              setRosterData((p) => ({
                                ...p,
                                [asgn.id]: { ...(p[asgn.id] || {}), normalHours: v },
                              }));
                            }}
                          />
                        )}
                      </TableCell>
                      <TableCell className={PO_BOARD_HOURS_CELL_CLASS}>
                        {(!showEventTypeEditor || isRowCleared || row.eventType !== 'work_day') ? (
                          <span className="flex h-9 items-center justify-center text-xs text-muted-foreground">—</span>
                        ) : (
                          <Input
                            disabled={rowEditLocked}
                            type="number"
                            min={0}
                            max={24}
                            step={0.5}
                            className={PO_BOARD_HOURS_INPUT_CLASS}
                            value={row.ot15Hours ?? 0}
                            title="ชม. OT (ot15) — ตรงกับ Total OT ใน timesheet ลูกค้า"
                            onChange={(e) => {
                              const v = Math.max(0, Math.min(24, Number(e.target.value) || 0));
                              setClearedRowIds((prev) => {
                                if (!prev.has(asgn.id)) return prev;
                                const next = new Set(prev);
                                next.delete(asgn.id);
                                return next;
                              });
                              markRowDirty(asgn.id);
                              setRosterData((p) => ({
                                ...p,
                                [asgn.id]: { ...(p[asgn.id] || {}), ot15Hours: v },
                              }));
                            }}
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 tabular-nums">
                          {rowEditLocked && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />}
                          <span
                            className="text-xs font-semibold text-foreground min-w-[2rem]"
                            title={
                              !dateInAssignment
                                ? 'วันนี้อยู่นอกช่วงมอบหมาย — ไม่บันทึกจากแถวนี้'
                                : afterMobEnd
                                  ? 'หลังวันจบงาน — ไม่แสดงลงเวลาหลังวันจบไซต์ที่บันทึกแล้ว'
                                  : persisted
                                    ? `บันทึกแล้ว · ${row.eventType}`
                                    : 'ยังไม่มีการบันทึก timesheet สำหรับวันนี้'
                            }
                          >
                            {!dateInAssignment
                              ? '—'
                              : afterMobEnd || isRowCleared
                                ? '—'
                                : waveBoardStatusCode(persisted, row.eventType)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center align-top py-4">
                        <div className="flex flex-col items-stretch gap-1.5 mx-auto max-w-[7rem]">
                          {canFinishJob ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 text-[10px] gap-1 border-amber-600/40"
                              disabled={
                                !canEditTimesheets ||
                                demobSubmitting ||
                                standbySubmitting ||
                                anyMonthLocked
                              }
                              onClick={() => setStopFlow({ assignment: asgn })}
                            >
                              <Pause className="h-3.5 w-3.5 shrink-0" />
                              หยุด
                            </Button>
                          ) : null}
                          {awaitingRemob ? (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                className="h-7 text-[9px] gap-0.5 px-1.5"
                                disabled={!canEditTimesheets || demobSubmitting || standbySubmitting}
                                onClick={() => setFinishJobModal({ mode: 'revise', assignment: asgn })}
                              >
                                <Pencil className="h-3 w-3 shrink-0" />
                                แก้ไขวันที่
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7 text-[9px] gap-0.5 px-1.5 text-destructive hover:text-destructive"
                                disabled={!canEditTimesheets || demobSubmitting || standbySubmitting}
                                onClick={() => setCancelFinishTarget(asgn)}
                              >
                                <Undo2 className="h-3 w-3 shrink-0" />
                                ยกเลิกจบงาน
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right pr-6 align-top">
                        <div className="flex flex-col items-end gap-1">
                          {bundleAutoDailyDisabled ? (
                            <span className="text-[9px] font-semibold text-amber-900 dark:text-amber-100 whitespace-nowrap">
                              Manual Mode
                            </span>
                          ) : null}
                          <Input
                            disabled={rowEditLocked || isRowCleared}
                            className="h-8 text-[10px] text-right w-full min-w-0"
                            value={isRowCleared ? '' : row.remark}
                            onChange={(e) => {
                              setClearedRowIds((prev) => {
                                if (!prev.has(asgn.id)) return prev;
                                const next = new Set(prev);
                                next.delete(asgn.id);
                                return next;
                              });
                              markRowDirty(asgn.id);
                              setRosterData((p) => ({
                                ...p,
                                [asgn.id]: {
                                  ...(p[asgn.id] ?? {
                                    workerId: asgn.workerId,
                                    assignmentId: asgn.id,
                                    date: targetDate,
                                    eventType: 'work_day' as RateConditionEventType,
                                    normalHours: dft,
                                    ot15Hours: 0,
                                    status: 'DRAFT' as DailyTimesheetStatus,
                                  }),
                                  remark: e.target.value,
                                },
                              }));
                            }}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            </>
          ) : !isAsgnLoading ? (
            <div className="px-4 py-6">
              <Alert>
                <AlertTitle>ยังไม่มีคนในตาราง</AlertTitle>
                <AlertDescription>
                  ยังไม่ mobilization ครบตามเกณฑ์ Wave Board / ยัง Waiting MOB ครั้งแรก (DRAFT ก่อนขึ้นไซต์) / ยังไม่พร้อม (readiness) / วันที่อยู่นอกช่วงมอบหมาย —{' '}
                  ตรวจ Mobilization และการมอบหมายในชุด PO Active นี้ · คนที่จบงานแล้วยังเห็นชื่อในเดือนเดียวกันเพื่อสรุปวางบิล
                </AlertDescription>
              </Alert>
            </div>
          ) : null}
        </CardContent>
        <CardFooter className="bg-muted/20 border-t py-3 flex flex-wrap justify-between items-center gap-2">
          <p className="text-xs text-muted-foreground max-w-2xl">
            บันทึกลง <span className="font-medium">daily timesheets</span> ต่อ assignment — ชั่วโมงปกติจากสัญญา/PO · ช่อง OT = ชม. OT (ot15) สำหรับ payroll และวางบิล
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="link"
              className="text-xs h-auto p-0"
              disabled={!billingModesReady}
              onClick={() => requestMonthlyTimesheetProceed(poMonthHref)}
            >
              Monthly Timesheet (ปิดงวด / วางบิล)
            </Button>
            <Button variant="link" className="text-xs h-auto p-0" asChild>
              <Link href="/timesheets/wave-month">สรุปรอบเดือนราย wave</Link>
            </Button>
          </div>
        </CardFooter>
      </Card>
      <AlertDialog
        open={clearDayDialogOpen}
        onOpenChange={(open) => {
          if (!clearDayBusy) setClearDayDialogOpen(open);
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>ล้างข้อมูลวันนี้</AlertDialogTitle>
            <AlertDialogDescription>
              ต้องการล้างข้อมูลวันนี้ทั้งหมดให้ว่างใช่ไหม?
              <span className="mt-2 block text-foreground/90">
                วันที่ {formatYmdLocalThaiBE(targetDate)} · ทุกแถวที่แก้ได้ในตาราง — ระบบจะลบรายการที่บันทึกแล้วทันที
                (ไม่ต้องกดบันทึก)
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearDayBusy}>ไม่ใช่</AlertDialogCancel>
            <Button disabled={clearDayBusy} onClick={() => void confirmClearDay()}>
              {clearDayBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              ใช่ ล้างทั้งหมด
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={billingProceedHref != null}
        onOpenChange={(open) => {
          if (!open) setBillingProceedHref(null);
        }}
      >
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {billingProceedCopy?.title ?? 'ตรวจโหมดวางบิลก่อนดำเนินการ'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                {billingModesByPo && billingModesByPo.length > 1 ? (
                  <ul className="list-disc pl-5 space-y-0.5 text-foreground/90">
                    {billingModesByPo.map((row) => (
                      <li key={row.poId}>
                        <span className="font-mono">{row.poCode}</span> — {billingModeLabel(row.mode)}
                      </li>
                    ))}
                  </ul>
                ) : billingModesByPo?.[0] ? (
                  <p className="text-foreground/90">
                    โหมดวางบิลลูกค้า: <strong>{billingModeLabel(billingModesByPo[0].mode)}</strong>
                  </p>
                ) : null}
                {billingProceedCopy?.paragraphs.map((line) => (
                  <p key={line}>{line}</p>
                ))}
                <p className="pt-1 font-medium text-foreground">
                  ต้องการไป Monthly Timesheet เพื่อสรุป/ปิดงวดต่อหรือไม่?
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            {billingProceedCopy ? (
              <Button variant="outline" asChild>
                <Link href={billingProceedCopy.invoiceHref}>{billingProceedCopy.invoiceLabel}</Link>
              </Button>
            ) : null}
            <Button
              onClick={() => {
                const href = billingProceedHref;
                setBillingProceedHref(null);
                if (href) router.push(href);
              }}
            >
              ไป Monthly Timesheet
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={stopFlow !== null}
        onOpenChange={(open) => {
          if (!open && !standbySubmitting) setStopFlow(null);
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>เลือกประเภทการหยุด</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-sm text-muted-foreground space-y-3">
                <p>
                  พนักงาน{' '}
                  <span className="font-medium text-foreground">{stopFlowWorkerName}</span>
                </p>
                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-auto justify-start whitespace-normal px-3 py-3 text-left"
                    disabled={standbySubmitting || demobSubmitting}
                    onClick={() =>
                      stopFlow && void runStopFinishChoice(stopFlow.assignment, 'work_day')
                    }
                  >
                    <span className="block font-semibold text-foreground">1. วันนี้เป็น W พรุ่งนี้ไม่บันทึก</span>
                    <span className="mt-1 block text-xs leading-snug">
                      วันนี้ = Work · หยุดซิงก์หลังวันนี้ · กลับ Waiting MOB
                    </span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-auto justify-start whitespace-normal px-3 py-3 text-left"
                    disabled={standbySubmitting || demobSubmitting}
                    onClick={() => stopFlow && openDemobChargeConfig(stopFlow.assignment)}
                  >
                    <span className="block font-semibold text-foreground">2. วันนี้เป็น D1 พรุ่งนี้ไม่บันทึก</span>
                    <span className="mt-1 block text-xs leading-snug">
                      วันนี้ = Demob (D1) · ตั้งค่าบิล/จ่าย · หยุดซิงก์หลังวันนี้ · กลับ Waiting MOB
                    </span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-auto justify-start whitespace-normal px-3 py-3 text-left"
                    disabled={standbySubmitting || demobSubmitting}
                    onClick={() =>
                      stopFlow && void runStopFinishChoice(stopFlow.assignment, 'standby_day')
                    }
                  >
                    <span className="block font-semibold text-foreground">3. วันนี้เป็น SB พรุ่งนี้ไม่บันทึก</span>
                    <span className="mt-1 block text-xs leading-snug">
                      วันนี้ = Standby · หยุดซิงก์หลังวันนี้ · กลับ Waiting MOB
                    </span>
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-auto justify-start whitespace-normal px-3 py-3 text-left"
                    disabled={standbySubmitting || demobSubmitting}
                    onClick={() => stopFlow && void runStopToggleSbW(stopFlow.assignment)}
                  >
                    <span className="block font-semibold text-foreground">
                      4. ยังไม่หยุด — สลับ SB / W แบบออโต้
                      {stopFlow && isAssignmentInPoActiveSbToggleMode(stopFlow.assignment)
                        ? ' (ตอนนี้ SB → กดแล้วกลับ W)'
                        : ' (ตอนนี้ W → กดแล้วเป็น SB)'}
                    </span>
                    <span className="mt-1 block text-xs leading-snug">
                      ไม่กลับ Waiting MOB · สลับ SB↔W อัตโนมัติจนกว่าจะเลือกข้อ 1–3
                    </span>
                  </Button>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={standbySubmitting || demobSubmitting}>ปิด</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={demobChargeOpen}
        onOpenChange={(open) => {
          if (!open && !standbySubmitting && !demobSubmitting) {
            setDemobChargeOpen(false);
            setDemobChargeAssignment(null);
          }
        }}
      >
        <DialogContent className="flex max-h-[min(90vh,40rem)] w-[calc(100vw-1.5rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:w-full">
          <DialogHeader className="shrink-0 space-y-1 border-b px-5 py-4 text-left">
            <DialogTitle>กำหนดค่า D1 — วางบิล / จ่ายลูกจ้าง</DialogTitle>
            <DialogDescription>
              {demobChargeAssignment
                ? `จบงานวันนี้เป็น Demob · ${demobChargeAssignment.workerId}`
                : 'จบงานวันนี้เป็น Demob'}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
            <MobDayChargeSideEditors
              billing={demobBillingCharge}
              payroll={demobPayrollCharge}
              onBillingChange={setDemobBillingCharge}
              onPayrollChange={setDemobPayrollCharge}
              packageHours={defaultPackageHoursForWorkMode(demobChargeAssignment?.workMode)}
              disabled={standbySubmitting || demobSubmitting}
              previewRates={demobPreviewRates}
              includeD1
              layout="grid"
              compact
            />
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t px-5 py-3 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={standbySubmitting || demobSubmitting}
              onClick={() => {
                setDemobChargeOpen(false);
                setDemobChargeAssignment(null);
              }}
            >
              ยกเลิก
            </Button>
            <Button
              type="button"
              disabled={standbySubmitting || demobSubmitting || !demobChargeAssignment}
              onClick={() =>
                demobChargeAssignment &&
                void runStopFinishChoice(demobChargeAssignment, 'demobilization_day', {
                  billing: demobBillingCharge,
                  payroll: demobPayrollCharge,
                })
              }
            >
              {standbySubmitting || demobSubmitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              ยืนยัน D1 และจบงาน
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={finishJobModal !== null}
        onOpenChange={(open) => {
          if (!open) setFinishJobModal(null);
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {finishJobModal?.mode === 'revise'
                ? 'แก้ไขวันสิ้นสุดงาน'
                : 'หยุดแบบจบงาน — ส่งกลับคิว Mobilization'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-sm text-muted-foreground space-y-3">
                <p>
                  พนักงาน <span className="font-medium text-foreground">{finishModalWorkerName}</span>
                  {finishJobModal?.mode === 'revise' ? (
                    <> — ปรับเฉพาะวันที่สิ้นสุดรอบนี้ (สถานะยังเป็น Waiting MOB)</>
                  ) : (
                    <>
                      {' '}
                      — หลังยืนยันจะเป็น <strong className="text-foreground">Waiting MOB</strong> และแสดงในเมนู Mobilization
                      (ยังผูก PO เดิม)
                      {finishJobModal?.finishTiming === 'today' ? (
                        <>
                          {' '}
                          · <strong className="text-foreground">มีผลวันนี้</strong> — วันนี้ (Bangkok) จะไม่เป็น W หากเป็นแถว auto
                        </>
                      ) : finishJobModal?.finishTiming === 'tomorrow' ? (
                        <>
                          {' '}
                          · <strong className="text-foreground">มีผลพรุ่งนี้</strong> — วันสุดท้ายของ W auto ตามวันที่เลือกด้านล่าง
                        </>
                      ) : null}
                    </>
                  )}
                </p>
                <div className="space-y-2 rounded-md border border-primary/20 bg-muted/30 p-3">
                  <Label className="text-xs font-semibold text-foreground">วันสิ้นสุดงานรอบนี้</Label>
                  <DatePickerThaiBE
                    className="h-10 w-full max-w-[280px]"
                    value={htmlDateValueToTimestampMs(finishJobDateYmd)}
                    onChange={(ms) => setFinishJobDateYmd(timestampToHtmlDateValue(ms))}
                  />
                  {finishModalDateIssue ? (
                    <p className="text-xs text-destructive font-medium">{finishModalDateIssue}</p>
                  ) : null}
                  {finishAfterCounts && finishAfterCounts.deletable > 0 ? (
                    <p className="text-xs font-medium text-amber-800 dark:text-amber-200 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5">
                      มีลงเวลา <strong>{finishAfterCounts.deletable}</strong> รายการหลังวันที่เลือก — ระบบจะถามยืนยันก่อนลบ
                      {finishAfterCounts.locked > 0
                        ? ` (ข้าม ${finishAfterCounts.locked} แถวที่ล็อกบัญชีแล้ว)`
                        : ''}
                    </p>
                  ) : null}
                  <p className="text-xs leading-relaxed">
                    {finishJobModal?.mode === 'revise' ? (
                      <>
                        บันทึกวันสิ้นสุดใหม่เป็น{' '}
                        <strong className="text-foreground">{formatYmdLocalThaiBE(finishJobDateYmd || '—')}</strong> — ระบบจะใช้วันนี้ตัดการสร้างลงเวลาอัตโนมัติหลังวันที่เลือก
                      </>
                    ) : (
                      <>
                        ยืนยันจบงาน ณ{' '}
                        <strong className="text-foreground">{formatYmdLocalThaiBE(finishJobDateYmd || '—')}</strong> — ระบบจะไม่สร้างรายวันอัตโนมัติหลังวันนี้
                        และสถานะ deployment กลับเป็นร่างเพื่อเข้าคิว Mob ใหม่
                      </>
                    )}
                  </p>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={demobSubmitting}>ปิด</AlertDialogCancel>
            <Button
              type="button"
              className={finishJobModal?.mode === 'revise' ? 'bg-primary' : 'bg-amber-700 text-white'}
              disabled={demobSubmitting || !!finishModalDateIssue}
              onClick={() => void confirmFinishJobModal()}
            >
              {demobSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'บันทึก'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={finishPurgeConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setFinishPurgeConfirm(null);
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>ลบลงเวลาหลังวันจบงาน?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-sm text-muted-foreground space-y-2">
                <p>
                  มีลงเวลา <strong className="text-foreground">{finishPurgeConfirm?.deletable ?? 0}</strong> รายการ
                  หลังวันที่{' '}
                  <strong className="text-foreground">
                    {formatYmdLocalThaiBE(finishPurgeConfirm?.finishYmd || '—')}
                  </strong>{' '}
                  — จะถูกลบทั้งหมดจนกว่าจะ remob และเริ่มรอบใหม่
                </p>
                {(finishPurgeConfirm?.locked ?? 0) > 0 ? (
                  <p className="text-xs">
                    แถวที่ล็อกบัญชีแล้ว {finishPurgeConfirm?.locked} รายการจะไม่ถูกลบ
                  </p>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={demobSubmitting}>ยกเลิก</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={demobSubmitting}
              onClick={() => void confirmFinishPurgeDialog()}
            >
              {demobSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ยืนยันลบและบันทึกจบงาน'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={cancelFinishTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCancelFinishTarget(null);
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>ยกเลิกการจบงาน?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-sm text-muted-foreground space-y-2">
                <p>
                  จะคืนสถานะเป็น <strong className="text-foreground">ACTIVE</strong> และลบวันสิ้นสุดรอบนี้ — พนักงานกลับไปลงเวลาบนกระดานตามปกติ
                </p>
                <p className="text-xs">
                  ถ้าเคยล้างขั้น Mobilization (Standby / เริ่มงาน) ตอนจบงาน อาจต้องบันทึกในเมนู Mobilization ใหม่
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={demobSubmitting}>ปิด</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={demobSubmitting || anyMonthLocked}
              onClick={() => void confirmCancelFinishJob()}
            >
              {demobSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ยืนยันยกเลิกจบงาน'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
