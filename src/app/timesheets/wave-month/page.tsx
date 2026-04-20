'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  CalendarRange,
  ChevronLeft,
  FileText,
  ImagePlus,
  Loader2,
  Lock,
  Send,
  Trash2,
  Waves,
} from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase, useFirebaseApp } from '@/firebase';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import type {
  Assignment,
  DailyTimesheet,
  DailyTimesheetStatus,
  PurchaseOrder,
  RateConditionEventType,
  User,
  Wave,
  WaveMonthTimesheetPhotoAttachment,
  WaveMonthTimesheetPhotoBundle,
  WaveMonthTimesheetReview,
  WaveMonthTimesheetReviewStatus,
  Worker,
} from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccess, canEdit, canView, isMatrixControlledRole } from '@/lib/permissions';
import { PageGuidance } from '@/components/layout/page-guidance';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import { waveRoundMonthLabel } from '@/lib/constants/timesheet-ui';
import {
  isWaveMonthAttachmentPdf,
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
import { Checkbox } from '@/components/ui/checkbox';
import {
  deleteWaveMonthTimesheetPhotoFile,
  uploadWaveMonthTimesheetPhoto,
} from '@/lib/storage/wave-month-timesheet-photos';
import {
  ensureOpenPayrollPeriodForWaveMonthReview,
  markTimesheetsReadyForPayrollAfterMonthApproval,
} from '@/lib/timesheet/wave-month-payroll-bridge';

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
  { label: 'ลาหยุดไม่รับค่าจ้าง (Unpaid)', value: 'unpaid_leave' },
];

function isWaveMonthReviewLocked(r: WaveMonthTimesheetReview | undefined): boolean {
  return (
    r?.status === 'entry_locked' ||
    r?.status === 'pending_manager_review' ||
    r?.status === 'approved'
  );
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
  /** วันสุดท้ายของช่วงปิดงวดต่อ wave (yyyy-MM-dd) — ค่าเริ่มต้นสิ้นเดือน */
  const [periodEndByWave, setPeriodEndByWave] = useState<Record<string, string>>({});
  const [mobAssignments, setMobAssignments] = useState<Assignment[]>([]);
  const [mobLoading, setMobLoading] = useState(false);
  const [submittingWaveId, setSubmittingWaveId] = useState<string | null>(null);
  const [cellEdit, setCellEdit] = useState<CellEditContext | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editEvent, setEditEvent] = useState<RateConditionEventType>('work_day');
  const [editHours, setEditHours] = useState(12);
  const [editRemark, setEditRemark] = useState('');
  const [savingCell, setSavingCell] = useState(false);
  const [submitReviewTarget, setSubmitReviewTarget] = useState<{ waveId: string; poId: string } | null>(null);
  const [submitQ1, setSubmitQ1] = useState(false);
  const [submitQ2, setSubmitQ2] = useState(false);
  const [uploadingPhotoWaveId, setUploadingPhotoWaveId] = useState<string | null>(null);
  const [syncingPayrollReviewId, setSyncingPayrollReviewId] = useState<string | null>(null);
  const payrollAutoHealRef = useRef<Set<string>>(new Set());

  const firebaseApp = useFirebaseApp();

  useEffect(() => {
    setPeriodEndByWave({});
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
    if (submitReviewTarget) {
      setSubmitQ1(false);
      setSubmitQ2(false);
    }
  }, [submitReviewTarget]);

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

  /** หลังผู้จัดการอนุมัติ — ซิงค์ readyForPayroll ให้ timesheet ในช่วงงวด (กรณีครั้งแรกล้มเหลวหรือข้อมูลย้อนหลัง) */
  const handleSyncPayrollFlags = useCallback(
    async (waveId: string) => {
      const r = reviewByWaveId.get(waveId);
      if (!firestore || !currentUser || !r || r.status !== 'approved') return;
      setSyncingPayrollReviewId(r.id);
      try {
        const { updated } = await markTimesheetsReadyForPayrollAfterMonthApproval(firestore, r);
        const actorName = currentUser.displayName || currentUser.email || currentUser.id;
        const { created: periodCreated } = await ensureOpenPayrollPeriodForWaveMonthReview(
          firestore,
          r,
          actorName,
        );
        toast({
          title: updated > 0 ? 'ซิงค์พร้อมจ่าย payroll แล้ว' : 'ไม่มีรายการที่เปลี่ยนแปลง',
          description:
            updated > 0
              ? `ตั้งค่า readyForPayroll ให้ ${updated} รายการ — ไปเมนูงวดจ่ายลูกจ้างแล้วเลือกรอบบัญชีเดือนเดียวกับงวดนี้${
                  periodCreated ? ' (สร้างรอบบัญชีลูกจ้างอัตโนมัติแล้ว)' : ''
                }`
              : periodCreated
                ? 'สร้างรอบบัญชีลูกจ้างอัตโนมัติแล้ว — ไปเลือกรอบที่เมนูงวดจ่ายลูกจ้าง (timesheet อาจถูก LOCKED หรือไม่มีในช่วงงวด)'
                : 'รายการอาจถูก LOCKED แล้ว หรือไม่มี daily timesheet ในช่วงวันที่งวด — ตรวจช่วงปิดงวดและตารางลงเวลา',
        });
      } catch (e: unknown) {
        toast({
          variant: 'destructive',
          title: 'ซิงค์ไม่สำเร็จ',
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setSyncingPayrollReviewId(null);
      }
    },
    [firestore, currentUser, reviewByWaveId, toast],
  );

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

  /** โหลดรูปแนบทีละเอกสาร (get) แทน list คอลเลกชัน — สอดคล้องกฎ Firestore และไม่ต้อง query index */
  const [bundleByWaveId, setBundleByWaveId] = useState<Map<string, WaveMonthTimesheetPhotoBundle>>(() => new Map());

  const refreshPhotoBundlesForWaves = useCallback(async () => {
    if (!firestore || !canViewTs || !monthYm || !/^\d{4}-\d{2}$/.test(monthYm)) {
      setBundleByWaveId(new Map());
      return;
    }
    if (sortedWaves.length === 0) {
      setBundleByWaveId(new Map());
      return;
    }
    try {
      const refs = sortedWaves.map((w) =>
        doc(firestore, 'wave_month_timesheet_photo_bundles', `${w.id}_${monthYm}`),
      );
      const snaps = await Promise.all(refs.map((r) => getDoc(r)));
      const m = new Map<string, WaveMonthTimesheetPhotoBundle>();
      sortedWaves.forEach((w, i) => {
        const s = snaps[i];
        if (s.exists()) {
          m.set(w.id, { id: s.id, ...(s.data() as object) } as WaveMonthTimesheetPhotoBundle);
        }
      });
      setBundleByWaveId(m);
    } catch (e) {
      console.error(e);
      setBundleByWaveId(new Map());
    }
  }, [firestore, canViewTs, monthYm, sortedWaves]);

  useEffect(() => {
    void refreshPhotoBundlesForWaves();
  }, [refreshPhotoBundlesForWaves]);

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

  const appendPhotoToBundle = useCallback(
    async (wave: Wave, poId: string, file: File) => {
      if (!firebaseApp || !firestore || !monthYm) return;
      const bundleId = `${wave.id}_${monthYm}`;
      setUploadingPhotoWaveId(wave.id);
      try {
        const att = await uploadWaveMonthTimesheetPhoto(firebaseApp, bundleId, file);
        const bundleRef = doc(firestore, 'wave_month_timesheet_photo_bundles', bundleId);
        const snap = await getDoc(bundleRef);
        const prev = snap.exists() ? ((snap.data() as WaveMonthTimesheetPhotoBundle).attachments ?? []) : [];
        await setDoc(
          bundleRef,
          {
            id: bundleId,
            waveId: wave.id,
            poId,
            yearMonth: monthYm,
            attachments: [...prev, att],
            updatedAt: Date.now(),
          },
          { merge: true },
        );
        const after = await getDoc(bundleRef);
        if (after.exists()) {
          setBundleByWaveId((prev) => {
            const m = new Map(prev);
            m.set(wave.id, { id: after.id, ...(after.data() as object) } as WaveMonthTimesheetPhotoBundle);
            return m;
          });
        }
        toast({ title: 'แนบไฟล์แล้ว', description: file.name });
      } catch (e: unknown) {
        toast({
          variant: 'destructive',
          title: 'อัปโหลดไม่สำเร็จ',
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setUploadingPhotoWaveId(null);
      }
    },
    [firebaseApp, firestore, monthYm, toast],
  );

  const removePhotoFromBundle = useCallback(
    async (wave: Wave, att: WaveMonthTimesheetPhotoAttachment) => {
      if (!firebaseApp || !firestore || !monthYm) return;
      const bundleId = `${wave.id}_${monthYm}`;
      setUploadingPhotoWaveId(wave.id);
      try {
        await deleteWaveMonthTimesheetPhotoFile(firebaseApp, att.storagePath);
        const bundleRef = doc(firestore, 'wave_month_timesheet_photo_bundles', bundleId);
        const snap = await getDoc(bundleRef);
        if (!snap.exists()) return;
        const bd = snap.data() as WaveMonthTimesheetPhotoBundle;
        const next = (bd.attachments ?? []).filter((a) => a.id !== att.id);
        await updateDoc(bundleRef, { attachments: next, updatedAt: Date.now() });
        const after = await getDoc(bundleRef);
        setBundleByWaveId((prev) => {
          const m = new Map(prev);
          if (after.exists() && (after.data() as WaveMonthTimesheetPhotoBundle).attachments?.length) {
            m.set(wave.id, { id: after.id, ...(after.data() as object) } as WaveMonthTimesheetPhotoBundle);
          } else {
            m.delete(wave.id);
          }
          return m;
        });
        toast({ title: 'ลบไฟล์แล้ว' });
      } catch (e: unknown) {
        toast({
          variant: 'destructive',
          title: 'ลบไม่สำเร็จ',
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setUploadingPhotoWaveId(null);
      }
    },
    [firebaseApp, firestore, monthYm, toast],
  );

  const getPeriodBounds = useCallback(
    (waveId: string) => {
      const monthFirst = `${monthYm}-01`;
      const monthLast = lastDayOfCalendarMonth(monthYm);
      const end = periodEndByWave[waveId] ?? monthLast;
      return { periodStartDate: monthFirst, periodEndDate: end < monthFirst ? monthLast : end };
    },
    [monthYm, periodEndByWave],
  );

  const writeMonthReview = useCallback(
    async (waveId: string, poId: string, status: WaveMonthTimesheetReviewStatus) => {
      if (!firestore || !currentUser || !monthYm || !canEditTs) return;
      const { periodStartDate, periodEndDate } = getPeriodBounds(waveId);
      if (periodEndDate < periodStartDate) {
        toast({ variant: 'destructive', title: 'ช่วงวันที่ไม่ถูกต้อง', description: 'วันสุดท้ายต้องไม่ก่อนวันเริ่มต้นเดือน' });
        return;
      }
      setSubmittingWaveId(waveId);
      try {
        const id = `${waveId}_${monthYm}`;
        const now = Date.now();
        const ref = doc(firestore, 'wave_month_timesheet_reviews', id);
        const existing = await getDoc(ref);
        const createdAt =
          existing.exists() && typeof existing.data()?.createdAt === 'number'
            ? (existing.data() as WaveMonthTimesheetReview).createdAt
            : now;
        const base: Record<string, unknown> = {
          id,
          waveId,
          poId,
          yearMonth: monthYm,
          status,
          periodStartDate,
          periodEndDate,
          submittedAt: now,
          submittedByUserId: currentUser.id,
          submittedByName: currentUser.displayName || currentUser.email || '',
          createdAt,
          updatedAt: now,
        };
        if (status === 'entry_locked') {
          base.entryLockedAt = now;
          base.entryLockedByUserId = currentUser.id;
          base.entryLockedByName = currentUser.displayName || currentUser.email || '';
        }
        if (status === 'pending_manager_review') {
          base.reviewedAt = deleteField();
          base.reviewedByUserId = deleteField();
          base.reviewedByName = deleteField();
          base.reviewNote = deleteField();
          const bundleRef = doc(firestore, 'wave_month_timesheet_photo_bundles', id);
          const bundleSnap = await getDoc(bundleRef);
          let atts: WaveMonthTimesheetPhotoAttachment[] = [];
          if (bundleSnap.exists()) {
            const bd = bundleSnap.data() as WaveMonthTimesheetPhotoBundle;
            atts = Array.isArray(bd.attachments) ? bd.attachments : [];
          }
          base.timesheetPhotoAttachments = atts;
        }
        await setDoc(ref, base, { merge: true });
        if (status === 'entry_locked') {
          toast({
            title: 'ปิดงวดเดือนแล้ว',
            description: 'ล็อกการแก้ไขลงเวลาในช่วงนี้บน Wave Board — กดส่งตรวจผู้จัดการเมื่อพร้อม',
          });
        } else {
          toast({
            title: 'ส่งตรวจสอบแล้ว',
            description: 'รายการเข้าคิวที่ศูนย์อนุมัติให้ Operations / HR Manager ตรวจ — หลังอนุมัติระบบจะตั้งพร้อมจ่าย payroll ตามช่วงงวด',
          });
        }
      } catch (e: unknown) {
        toast({
          variant: 'destructive',
          title: 'บันทึกไม่สำเร็จ',
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setSubmittingWaveId(null);
      }
    },
    [firestore, currentUser, monthYm, canEditTs, toast, getPeriodBounds],
  );

  const handleEntryLockMonth = useCallback(
    async (waveId: string, poId: string) => {
      await writeMonthReview(waveId, poId, 'entry_locked');
    },
    [writeMonthReview],
  );

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
      if (isWaveMonthReviewLocked(monthReview)) {
        toast({
          variant: 'destructive',
          title: 'งวดนี้แก้ไขไม่ได้',
          description: 'มีการปิดงวดเดือน / ส่งตรวจ / อนุมัติแล้ว',
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
    [canEditTs, toast],
  );

  const handleSaveCellEdit = useCallback(async () => {
    if (!firestore || !currentUser || !cellEdit) return;
    const { wave, po, monthReview, workerId, workerName, assignment, timesheet: existingTs } = cellEdit;
    if (!canEditTs || isWaveMonthReviewLocked(monthReview)) {
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
              สรุปลงเวลารายเดือน (ทั้งเวฟ)
            </h1>
            <p className="text-muted-foreground mt-1 max-w-3xl text-sm lg:text-base">
              ภาพรวมทุกคนในแต่ละ Wave ต่อเดือน — แสดงทุก PO / Wave ที่ยังไม่ปิด ตามเดือนที่เลือก (แถว = คนใน Wave จากการมอบหมาย)
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/timesheets/wave-board">ไป Wave Board</Link>
            </Button>
          </div>
        </div>

        <PageGuidance
          title="คีย์ด้านล่าง"
          tips={[
            'เลือกเดือน — แต่ละการ์ด = หนึ่ง Wave (PO ที่ยังไม่ปิด + Wave ที่ยังไม่ COMPLETED/CLOSED)',
            'คลิกช่อง (ตัวเลขหรือจุดว่าง) เพื่อแก้ไข/เพิ่มรายการ — แก้วันที่ผิด ประเภทวัน (ป่วย/ส่งกลับ/Mob ฯลฯ) หรือชั่วโมง (เมื่อยังไม่ปิดงวด)',
            'รหัสประเภทวัน: W=ทำงาน, SB=สแตนด์บาย, T=เดินทาง (ดู tooltip ที่หัวตาราง)',
            'ปิดงวด: เลือกวันสุดท้ายของช่วง (ค่าเริ่มต้นสิ้นเดือน — กรณี Wave จบกลางเดือนให้ปรับวันสุดท้าย) → "ปิดงวดเดือน" ล็อกการแก้ไข หรือ "ปิดงวดและส่งตรวจสอบ" เข้าคิวผู้จัดการ — หลังอนุมัติระบบตั้งพร้อมจ่าย payroll ตามช่วง',
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
          <div className="space-y-8">
            {sortedWaves.map((wave) => {
              const po = poById.get(wave.poId);
              const waveMobs = mobAssignments.filter((m) => m.waveId === wave.id);
              const waveSheets = monthSheetsForOpenWaves.filter((t) => t.waveId === wave.id);
              const monthReview = reviewByWaveId.get(wave.id);

              const byWorkerDate = new Map<string, DailyTimesheet>();
              for (const t of waveSheets) {
                byWorkerDate.set(`${t.workerId}|${t.date}`, t);
              }

              const rowTotals = new Map<string, number>();
              for (const t of waveSheets) {
                rowTotals.set(t.workerId, (rowTotals.get(t.workerId) ?? 0) + (t.normalHours ?? 0));
              }

              const rosterWorkers = [...new Set(waveMobs.map((x) => x.workerId).filter(Boolean))]
                .map((wid) => {
                  const w = allWorkers?.find((x) => x.id === wid);
                  const name = w ? `${w.firstName || ''} ${w.lastName || ''}`.trim() || w.workerCode : wid;
                  return { workerId: wid, name };
                })
                .sort((a, b) => a.name.localeCompare(b.name, 'th'));

              const submitting = submittingWaveId === wave.id;
              const editableGrid = canEditTs && !isWaveMonthReviewLocked(monthReview);
              const photoReadOnly =
                monthReview?.status === 'pending_manager_review' || monthReview?.status === 'approved';
              const displayPhotos = photoReadOnly
                ? monthReview?.timesheetPhotoAttachments ?? []
                : bundleByWaveId.get(wave.id)?.attachments ?? [];

              return (
                <Card key={wave.id} id={`wave-month-wave-${wave.id}`} className="overflow-hidden scroll-mt-4">
                  <CardHeader className="border-b bg-muted/30 py-4 space-y-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-1 min-w-0">
                        <CardTitle className="text-base flex flex-wrap items-center gap-x-2 gap-y-1">
                          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="font-mono">{po?.poCode ?? wave.poId}</span>
                          <Waves className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="font-mono">{wave.waveCode}</span>
                          <Badge variant="secondary" className="text-[10px] font-normal">
                            {wave.status}
                          </Badge>
                        </CardTitle>
                        <CardDescription className="text-xs">
                          {waveRoundMonthLabel(wave)} · {wave.siteLocation || '—'}
                        </CardDescription>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <Button variant="outline" size="sm" asChild>
                          <Link href="/timesheets/wave-board">Wave Board</Link>
                        </Button>
                        <div className="flex flex-col gap-1 w-full sm:w-auto">
                          <Label className="text-[10px] uppercase text-muted-foreground">วันสุดท้ายของงวดปิด</Label>
                          <Input
                            type="date"
                            className="h-9 w-[160px]"
                            min={`${monthYm}-01`}
                            max={lastDayOfCalendarMonth(monthYm)}
                            value={periodEndByWave[wave.id] ?? lastDayOfCalendarMonth(monthYm)}
                            onChange={(e) =>
                              setPeriodEndByWave((prev) => ({ ...prev, [wave.id]: e.target.value }))
                            }
                            disabled={
                              monthReview?.status === 'pending_manager_review' ||
                              monthReview?.status === 'approved'
                            }
                          />
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="gap-1.5"
                          disabled={
                            !canEditTs ||
                            submitting ||
                            monthReview?.status === 'entry_locked' ||
                            monthReview?.status === 'pending_manager_review' ||
                            monthReview?.status === 'approved'
                          }
                          onClick={() => void handleEntryLockMonth(wave.id, wave.poId)}
                        >
                          <Lock className="h-4 w-4" />
                          ปิดงวดเดือน
                        </Button>
                        <Button
                          size="sm"
                          className="gap-1.5"
                          disabled={
                            !canEditTs ||
                            submitting ||
                            monthReview?.status === 'pending_manager_review' ||
                            monthReview?.status === 'approved'
                          }
                          onClick={() => setSubmitReviewTarget({ waveId: wave.id, poId: wave.poId })}
                        >
                          <Send className="h-4 w-4" />
                          {monthReview?.status === 'pending_manager_review'
                            ? 'รอผู้จัดการตรวจ'
                            : monthReview?.status === 'approved'
                              ? 'ผู้จัดการอนุมัติแล้ว'
                              : 'ปิดงวดและส่งตรวจสอบ'}
                        </Button>
                        {monthReview?.status === 'entry_locked' ? (
                          <Badge variant="outline" className="text-[10px]">
                            ล็อกลงเวลาแล้ว — กดส่งตรวจผู้จัดการเมื่อพร้อม
                          </Badge>
                        ) : null}
                        {monthReview?.status === 'rejected' && canEditTs ? (
                          <span className="text-xs text-destructive">ถูกปฏิเสธ — แก้แล้วกดส่งใหม่ได้</span>
                        ) : null}
                        {monthReview?.status === 'approved' ? (
                          <div className="flex w-full flex-col gap-1 sm:max-w-md">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              className="gap-1.5 w-fit"
                              disabled={syncingPayrollReviewId === monthReview.id}
                              onClick={() => void handleSyncPayrollFlags(wave.id)}
                            >
                              {syncingPayrollReviewId === monthReview.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : null}
                              ซิงค์พร้อมจ่าย payroll
                            </Button>
                            <span className="text-[10px] text-muted-foreground leading-snug">
                              ถ้าไปสร้างงวดจ่ายลูกจ้างแล้วไม่เจอ timesheet — กดปุ่มนี้เพื่อตั้งค่า readyForPayroll ให้ครบตามช่วงงวดที่อนุมัติ
                            </span>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 pt-3 border-t border-dashed border-muted-foreground/30 w-full">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,application/pdf"
                          className="hidden"
                          id={`wave-photo-${wave.id}`}
                          disabled={
                            photoReadOnly || !canEditTs || uploadingPhotoWaveId === wave.id || submitting
                          }
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = '';
                            if (f) void appendPhotoToBundle(wave, wave.poId, f);
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          disabled={
                            photoReadOnly || !canEditTs || uploadingPhotoWaveId === wave.id || submitting
                          }
                          onClick={() => document.getElementById(`wave-photo-${wave.id}`)?.click()}
                        >
                          {uploadingPhotoWaveId === wave.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <ImagePlus className="h-4 w-4" />
                          )}
                          แนบรูป / PDF
                        </Button>
                        <span className="text-xs text-muted-foreground">
                          รูป: บีบให้ประมาณ 500 KB — PDF: สูงสุด 10 MB
                        </span>
                      </div>
                      {displayPhotos.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {displayPhotos.map((att) => (
                            <div key={att.id} className="relative">
                              {isWaveMonthAttachmentPdf(att) ? (
                                <a
                                  href={att.downloadUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded border bg-muted/50 text-[9px] text-muted-foreground hover:bg-muted"
                                >
                                  <FileText className="h-6 w-6 shrink-0 text-primary" />
                                  <span className="line-clamp-2 px-0.5 text-center leading-tight">PDF</span>
                                </a>
                              ) : (
                                <a
                                  href={att.downloadUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="block"
                                >
                                  <img
                                    src={att.downloadUrl}
                                    alt={att.fileName}
                                    className="h-16 w-16 rounded border object-cover"
                                  />
                                </a>
                              )}
                              {!photoReadOnly && canEditTs ? (
                                <button
                                  type="button"
                                  className="absolute -right-1 -top-1 rounded-full bg-destructive p-0.5 text-destructive-foreground shadow"
                                  aria-label="ลบไฟล์แนบ"
                                  disabled={uploadingPhotoWaveId === wave.id}
                                  onClick={() => void removePhotoFromBundle(wave, att)}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">ยังไม่มีไฟล์แนบ</p>
                      )}
                    </div>

                    <p className="text-sm text-muted-foreground">
                      {monthYm} · {rosterWorkers.length} คน · {waveSheets.length} แถว timesheet ในเดือน
                    </p>
                  </CardHeader>
                  <CardContent className="p-0 overflow-x-auto">
                    {rosterWorkers.length === 0 ? (
                      <p className="text-center text-muted-foreground py-10 px-4">ยังไม่มีการมอบหมายใน Wave นี้</p>
                    ) : (
                      <>
                        <Table className="min-w-max text-xs">
                          <TableHeader>
                            <TableRow className="bg-muted/50">
                              <TableHead className="sticky left-0 z-20 min-w-[140px] bg-muted/95 font-bold shadow-[2px_0_4px_rgba(0,0,0,0.06)]">
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
                            {rosterWorkers.map((rw) => (
                              <TableRow key={rw.workerId}>
                                <TableCell className="sticky left-0 z-10 bg-background font-medium text-xs shadow-[2px_0_4px_rgba(0,0,0,0.06)]">
                                  {rw.name}
                                </TableCell>
                                {days.map((d) => {
                                  const ts = byWorkerDate.get(`${rw.workerId}|${d}`);
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
                                <TableCell className="text-center font-bold text-sm">
                                  {rowTotals.get(rw.workerId) ?? 0}
                                </TableCell>
                              </TableRow>
                            ))}
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
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={!!cellEdit} onOpenChange={(open) => !open && !savingCell && setCellEdit(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>แก้ไขลงเวลารายวัน</DialogTitle>
            <DialogDescription>
              {cellEdit
                ? `${cellEdit.workerName} · ${cellEdit.po?.poCode ?? cellEdit.wave.poId} · ${cellEdit.wave.waveCode ?? ''}`
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

      <Dialog
        open={!!submitReviewTarget}
        onOpenChange={(open) => {
          if (!open) setSubmitReviewTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>ยืนยันการส่งตรวจผู้จัดการ</DialogTitle>
            <DialogDescription>
              กรุณายืนยันข้อมูลก่อนส่งงวด {monthYm} เข้าคิวอนุมัติ
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-3">
              <Checkbox
                id="wm-submit-q1"
                checked={submitQ1}
                onCheckedChange={(v) => setSubmitQ1(v === true)}
              />
              <label htmlFor="wm-submit-q1" className="text-sm leading-snug cursor-pointer">
                1. คุณได้ตรวจสอบระหว่าง timesheet กับ การบันทึกในระบบถูกต้อง แล้วหรือไม่?
              </label>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox
                id="wm-submit-q2"
                checked={submitQ2}
                onCheckedChange={(v) => setSubmitQ2(v === true)}
              />
              <label htmlFor="wm-submit-q2" className="text-sm leading-snug cursor-pointer">
                2. คุณได้แนบเอกสารรูปถ่ายหรือ PDF timesheet เรียบร้อยแล้วหรือไม่?
              </label>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setSubmitReviewTarget(null)}>
              ยกเลิก
            </Button>
            <Button
              type="button"
              disabled={
                !submitQ1 ||
                !submitQ2 ||
                !submitReviewTarget ||
                submittingWaveId === submitReviewTarget.waveId
              }
              onClick={() => {
                if (!submitReviewTarget) return;
                void writeMonthReview(
                  submitReviewTarget.waveId,
                  submitReviewTarget.poId,
                  'pending_manager_review',
                ).then(() => setSubmitReviewTarget(null));
              }}
            >
              {submitReviewTarget && submittingWaveId === submitReviewTarget.waveId ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  กำลังส่ง…
                </>
              ) : (
                'ยืนยันส่งตรวจ'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
