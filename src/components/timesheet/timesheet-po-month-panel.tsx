'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useFirestore, useCollection, useMemoFirebase, useFirebaseApp } from '@/firebase';
import {
  collection,
  doc,
  getDoc,
  setDoc,
  query,
  where,
  limit,
  deleteField,
} from 'firebase/firestore';
import type {
  Customer,
  MonthlyTimesheetPhotoBundle,
  PoLocationMonthTimesheet,
  PoMonthTimesheetPhotoBundle,
  PoMonthTimesheetReview,
  PurchaseOrder,
  User,
  Wave,
  WaveMonthTimesheetPhotoAttachment,
} from '@/lib/types';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccess, canView, isMatrixControlledRole, canEdit } from '@/lib/permissions';
import { formatThaiYearMonthLabel } from '@/lib/ops/timesheet-hub-po-month';
import { normalizePoActiveBundleId, resolvePoActiveBundleKeyForPo } from '@/lib/ops/po-active-bundle';
import {
  clearReadyPayrollFlagsForPoCalendarMonth,
  ensureWorkerMonthlyPayrollPeriodForYearMonth,
  poMonthTimesheetReviewDocId,
  syncReadyPayrollFlagsForYearMonthFromAllGatedPoMonthReviews,
} from '@/lib/timesheet/po-month-timesheet-bridge';
import { isSystemAdmin } from '@/lib/permission-core';
import { lastDayOfCalendarMonth } from '@/lib/timesheet/wave-month-utils';
import { runPortalParityBackfillForPoMonth } from '@/lib/timesheet/portal-parity-backfill';
import { isWaveMonthAttachmentPdf } from '@/lib/timesheet/wave-month-utils';
import { PageGuidance } from '@/components/layout/page-guidance';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import { useToast } from '@/hooks/use-toast';
import { ensureMonthlyTimesheetDocument } from '@/lib/timesheet/ensure-monthly-timesheet-document';
import {
  dedupePoLocationMonthShells,
  ensurePoLocationMonthShellsForPo,
  formatPoLocationMonthShellListLabel,
  normalizeWorkLocationKey,
  purchaseOrderOverlapsYearMonth,
} from '@/lib/timesheet/po-location-month-shell';
import {
  deletePoMonthTimesheetPhotoFile,
  uploadPoMonthTimesheetPhoto,
} from '@/lib/storage/po-month-timesheet-photos';
import {
  deleteMonthlyTimesheetPhotoFile,
  uploadMonthlyTimesheetPhoto,
} from '@/lib/storage/monthly-timesheet-photos';
import { useDoc } from '@/firebase/firestore/use-doc';
import {
  FileText,
  ImagePlus,
  Info,
  Loader2,
  Lock,
  Printer,
  RefreshCw,
  Send,
  Trash2,
  Unlock,
  FileText as FileIcon,
  MapPin,
} from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

const MAX_PO_MONTH_ATTACHMENTS = 4;

function ymNow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shellStatusBadge(s: PoLocationMonthTimesheet['status']) {
  switch (s) {
    case 'active':
      return <Badge className="bg-emerald-700">ACTIVE</Badge>;
    case 'closed':
      return <Badge variant="secondary">ปิด</Badge>;
    default:
      return <Badge variant="outline">PLANNING</Badge>;
  }
}

function statusBadge(s: PoMonthTimesheetReview['status']) {
  switch (s) {
    case 'approved':
      return <Badge className="bg-emerald-700">อนุมัติแล้ว</Badge>;
    case 'pending_manager_review':
      return <Badge className="bg-amber-600">รอผู้จัดการ</Badge>;
    case 'rejected':
      return <Badge variant="destructive">ปฏิเสธ</Badge>;
    case 'entry_locked':
      return <Badge variant="secondary">ปิดงวด Payroll (ยังไม่ส่งอนุมัติ TS)</Badge>;
    default:
      return <Badge variant="outline">{s}</Badge>;
  }
}

function waveTouchesMonth(w: Wave, yearMonth: string): boolean {
  if (!w.startDate || !w.endDate) return false;
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return false;
  const mStart = `${yearMonth}-01`;
  const mEnd = (() => {
    const [y, m] = yearMonth.split('-').map(Number);
    return new Date(y, m, 0).toISOString().slice(0, 10);
  })();
  return w.startDate <= mEnd && w.endDate >= mStart;
}

function isAttachmentReadonly(r: PoMonthTimesheetReview | undefined): boolean {
  if (!r) return false;
  return r.status === 'pending_manager_review' || r.status === 'approved';
}

export type TimesheetPoMonthPanelProps = {
  /** ฝังในหน้า wave-month — ไม่หุ้ม AppShell */
  embedded?: boolean;
  /** เดือนที่สอดคล้องกับตารางสรุปรายเดือน (เมื่อ embedded) */
  linkedMonthYm?: string;
  onLinkedMonthYmChange?: (ym: string) => void;
  /** wave-month: อัปเดตสถานะปุ่มลัด (ปิดงวด Payroll / ส่งอนุมัติ TS / แนบ) */
  onEmbeddedToolbarSnapshot?: (s: TimesheetPoMonthToolbarSnapshot | null) => void;
};

export type TimesheetPoMonthToolbarSnapshot = {
  selectedPoId: string | null;
  poOptions: { id: string; code: string }[];
  lockDisabled: boolean;
  sendDisabled: boolean;
  sendHidden: boolean;
  unlockHidden: boolean;
  unlockDisabled: boolean;
  attachDisabled: boolean;
  monthlyAttachUploading: boolean;
  monthlyTimesheetNo: string | null;
  monthlyAttachments: WaveMonthTimesheetPhotoAttachment[];
  busyPoId: string | null;
};

export type TimesheetPoMonthPanelHandle = {
  lockPeriod: () => void;
  openSubmitDialog: () => void;
  openUnlockDialog: () => void;
  openAttachPicker: () => void;
  selectToolbarPo: (poId: string) => void;
  removeMonthlyAttachment: (attId: string, storagePath: string) => void;
};

export const TimesheetPoMonthPanel = forwardRef<TimesheetPoMonthPanelHandle, TimesheetPoMonthPanelProps>(
  function TimesheetPoMonthPanel(
    {
      embedded = false,
      linkedMonthYm,
      onLinkedMonthYmChange,
      onEmbeddedToolbarSnapshot,
    },
    ref,
  ) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const firebaseApp = useFirebaseApp();
  const { toast } = useToast();
  const useMatrixGuards = isMatrixControlledRole(currentUser);
  const canViewTs = useMatrixGuards ? canAccess(currentUser!, 'timesheets', 'view') : canView(currentUser, 'timesheets');
  const canEditTs = useMatrixGuards ? canAccess(currentUser!, 'timesheets', 'edit') : canEdit(currentUser, 'timesheets');

  const monthFromUrl = (searchParams.get('month') || '').trim();
  const highlightPo = (searchParams.get('highlightPo') || '').trim();
  const poActiveBundleIdRaw = (searchParams.get('poActiveBundleId') || '').trim() || null;
  const filterPoActiveBundleId = poActiveBundleIdRaw ? normalizePoActiveBundleId(poActiveBundleIdRaw) : null;
  const locationKeyRaw = (searchParams.get('locationKey') || '').trim();
  /** คีย์ตรงกับ `PoLocationMonthTimesheet.locationKey` (รวม `__default__`) */
  const filterLocationKey = locationKeyRaw ? normalizeWorkLocationKey(locationKeyRaw) : null;
  const resolvedInitialMonth =
    embedded && linkedMonthYm && /^\d{4}-\d{2}$/.test(linkedMonthYm)
      ? linkedMonthYm
      : monthFromUrl && /^\d{4}-\d{2}$/.test(monthFromUrl)
        ? monthFromUrl
        : ymNow();
  const [monthYm, setMonthYm] = useState(resolvedInitialMonth);

  const replaceWaveMonthQuery = useCallback(
    (mutate: (p: URLSearchParams) => void) => {
      const p = new URLSearchParams(searchParams.toString());
      mutate(p);
      const m = p.get('month');
      if (!m || !/^\d{4}-\d{2}$/.test(m)) {
        p.set('month', monthYm);
      }
      router.replace(`/timesheets/wave-month?${p.toString()}`);
    },
    [router, searchParams, monthYm],
  );

  const [monthlyTimesheetNo, setMonthlyTimesheetNo] = useState<string | null>(null);
  const [monthlyDocLoading, setMonthlyDocLoading] = useState(false);
  const [periodEndByPo, setPeriodEndByPo] = useState<Record<string, string>>({});
  const [uploadingPhotoPoId, setUploadingPhotoPoId] = useState<string | null>(null);
  const [uploadingMonthlyPhoto, setUploadingMonthlyPhoto] = useState(false);
  const [submittingPoId, setSubmittingPoId] = useState<string | null>(null);
  const [payrollSyncBusy, setPayrollSyncBusy] = useState(false);
  const [portalParityBusy, setPortalParityBusy] = useState(false);
  const [submitDialogPo, setSubmitDialogPo] = useState<PurchaseOrder | null>(null);
  const [submitQ1, setSubmitQ1] = useState(false);
  const [submitQ2, setSubmitQ2] = useState(false);
  const [unlockConfirmPo, setUnlockConfirmPo] = useState<PurchaseOrder | null>(null);

  useEffect(() => {
    if (embedded) return;
    if (monthFromUrl && /^\d{4}-\d{2}$/.test(monthFromUrl)) {
      setMonthYm(monthFromUrl);
    }
  }, [embedded, monthFromUrl]);

  useEffect(() => {
    if (!embedded || !linkedMonthYm || !/^\d{4}-\d{2}$/.test(linkedMonthYm)) return;
    setMonthYm(linkedMonthYm);
  }, [embedded, linkedMonthYm]);

  useEffect(() => {
    if (!submitDialogPo) {
      setSubmitQ1(false);
      setSubmitQ2(false);
    }
  }, [submitDialogPo]);

  useEffect(() => {
    if (!firestore || !currentUser || !monthYm || !canViewTs) return;
    setMonthlyDocLoading(true);
    let c = true;
    void (async () => {
      try {
        const no = await ensureMonthlyTimesheetDocument(firestore, monthYm, currentUser);
        if (c && no) setMonthlyTimesheetNo(no);
      } catch (e) {
        console.error('[po-month] monthly timesheet doc', e);
        if (c) setMonthlyTimesheetNo(null);
      } finally {
        if (c) setMonthlyDocLoading(false);
      }
    })();
    return () => {
      c = false;
    };
  }, [firestore, currentUser, monthYm, canViewTs]);

  const posQuery = useMemoFirebase(
    () =>
      firestore && canViewTs
        ? query(collection(firestore, 'purchase_orders'), where('status', '==', 'active'), limit(200))
        : null,
    [firestore, canViewTs]
  );
  const { data: allPos, isLoading: posLoading } = useCollection<PurchaseOrder>(posQuery as any);

  const wavesQuery = useMemoFirebase(
    () => (firestore && canViewTs ? collection(firestore, 'waves') : null),
    [firestore, canViewTs]
  );
  const { data: allWaves, isLoading: wavesLoading } = useCollection<Wave>(wavesQuery as any);

  const monthReviewsQuery = useMemoFirebase(
    () =>
      firestore && canViewTs && monthYm
        ? query(collection(firestore, 'po_month_timesheet_reviews'), where('yearMonth', '==', monthYm))
        : null,
    [firestore, canViewTs, monthYm]
  );
  const { data: monthRows, isLoading: reviewsLoading } = useCollection<PoMonthTimesheetReview>(monthReviewsQuery as any);

  const monthlyAttachReadonly = useMemo(() => {
    return (monthRows ?? []).some(
      (r) =>
        r.yearMonth === monthYm &&
        (r.status === 'pending_manager_review' || r.status === 'approved'),
    );
  }, [monthRows, monthYm]);

  const photoBundlesQuery = useMemoFirebase(
    () =>
      firestore && canViewTs && monthYm
        ? query(collection(firestore, 'po_month_timesheet_photo_bundles'), where('yearMonth', '==', monthYm))
        : null,
    [firestore, canViewTs, monthYm]
  );
  const { data: photoBundleRows } = useCollection<PoMonthTimesheetPhotoBundle>(photoBundlesQuery as any);

  const monthlyPhotoBundleDocRef = useMemoFirebase(
    () =>
      firestore && canViewTs && /^\d{4}-\d{2}$/.test(monthYm)
        ? doc(firestore, 'monthly_timesheet_photo_bundles', monthYm)
        : null,
    [firestore, canViewTs, monthYm],
  );
  const { data: monthlyPhotoBundleDoc } = useDoc<MonthlyTimesheetPhotoBundle>(monthlyPhotoBundleDocRef);

  const locShellsQuery = useMemoFirebase(
    () =>
      firestore && canViewTs && monthYm
        ? query(collection(firestore, 'po_location_month_timesheets'), where('yearMonth', '==', monthYm), limit(500))
        : null,
    [firestore, canViewTs, monthYm],
  );
  const { data: locShellRows, isLoading: locShellsLoading } = useCollection<PoLocationMonthTimesheet>(
    locShellsQuery as any,
  );

  const customersQuery = useMemoFirebase(
    () => (firestore && canViewTs ? query(collection(firestore, 'customers'), limit(500)) : null),
    [firestore, canViewTs],
  );
  const { data: allCustomers } = useCollection<Customer>(customersQuery as any);

  const customerNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of allCustomers ?? []) m.set(c.id, c.name);
    return m;
  }, [allCustomers]);

  const locShellsSorted = useMemo(() => {
    const list = dedupePoLocationMonthShells([...(locShellRows ?? [])]);
    list.sort((a, b) => {
      const c0 = (a.poCodeSnapshot || a.poId).localeCompare(b.poCodeSnapshot || b.poId);
      if (c0 !== 0) return c0;
      return (a.locationLabel || a.locationKey).localeCompare(b.locationLabel || b.locationKey, 'th');
    });
    return list;
  }, [locShellRows]);

  const bundlePoIdSet = useMemo(() => {
    if (!filterPoActiveBundleId) return null;
    const ids = (allPos ?? [])
      .filter((p) => resolvePoActiveBundleKeyForPo(p) === filterPoActiveBundleId)
      .map((p) => p.id);
    return new Set(ids);
  }, [filterPoActiveBundleId, allPos]);

  /** หลังกรองชุด PO Active (เฟส 5) — ยังไม่กรองสถานที่ */
  const locShellsAfterBundle = useMemo(() => {
    if (!filterPoActiveBundleId || !bundlePoIdSet) return locShellsSorted;
    return locShellsSorted.filter((row) => bundlePoIdSet.has(row.poId));
  }, [locShellsSorted, bundlePoIdSet, filterPoActiveBundleId]);

  const locationFilterOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const row of locShellsAfterBundle) {
      m.set(row.locationKey, row.locationLabel || row.locationKey);
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'th'));
  }, [locShellsAfterBundle]);

  const locShellsForDisplay = useMemo(() => {
    if (!filterLocationKey) return locShellsAfterBundle;
    return locShellsAfterBundle.filter((row) => row.locationKey === filterLocationKey);
  }, [locShellsAfterBundle, filterLocationKey]);

  const poIdsMatchingLocationFilter = useMemo(() => {
    if (!filterLocationKey) return null;
    const s = new Set<string>();
    for (const row of locShellsAfterBundle) {
      if (row.locationKey === filterLocationKey) s.add(row.poId);
    }
    return s;
  }, [filterLocationKey, locShellsAfterBundle]);

  const applyLocationFilter = useCallback(
    (nextKey: string) => {
      replaceWaveMonthQuery((p) => {
        if (!nextKey || nextKey === '__all__') {
          p.delete('locationKey');
        } else {
          p.set('locationKey', nextKey);
        }
      });
    },
    [replaceWaveMonthQuery],
  );

  const filterHrefForShellRow = useCallback(
    (row: PoLocationMonthTimesheet) => {
      const p = new URLSearchParams(searchParams.toString());
      p.set('locationKey', row.locationKey);
      p.set('highlightPo', row.poId);
      const m = p.get('month');
      if (!m || !/^\d{4}-\d{2}$/.test(m)) {
        p.set('month', monthYm);
      }
      return `/timesheets/wave-month?${p.toString()}`;
    },
    [searchParams, monthYm],
  );

  const locationSelectValue = useMemo(() => {
    if (!filterLocationKey) return '__all__';
    return locationFilterOptions.some(([k]) => k === filterLocationKey) ? filterLocationKey : '__all__';
  }, [filterLocationKey, locationFilterOptions]);

  useEffect(() => {
    if (!filterLocationKey || locShellsLoading) return;
    if (locationFilterOptions.length === 0) return;
    if (locationFilterOptions.some(([k]) => k === filterLocationKey)) return;
    replaceWaveMonthQuery((p) => {
      p.delete('locationKey');
    });
  }, [filterLocationKey, locationFilterOptions, locShellsLoading, replaceWaveMonthQuery]);

  const contractPosForShellEnsure = useMemo(
    () =>
      (allPos ?? []).filter(
        (p) =>
          p.status === 'active' &&
          (p.poType || 'contract') !== 'quotation' &&
          purchaseOrderOverlapsYearMonth(p, monthYm),
      ),
    [allPos, monthYm],
  );

  useEffect(() => {
    if (!firestore || !currentUser || !canViewTs || !monthYm) return;
    if (contractPosForShellEnsure.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const po of contractPosForShellEnsure) {
        if (cancelled) break;
        try {
          await ensurePoLocationMonthShellsForPo(firestore, po, monthYm, {
            userId: currentUser.id,
            displayName: currentUser.displayName || currentUser.email || currentUser.id,
          });
        } catch (e) {
          console.error('[po-month] location shells', e);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, currentUser, canViewTs, monthYm, contractPosForShellEnsure]);

  const reviewByPoId = useMemo(() => {
    const m = new Map<string, PoMonthTimesheetReview>();
    for (const r of monthRows ?? []) m.set(r.poId, r);
    return m;
  }, [monthRows]);

  const bundleByPoId = useMemo(() => {
    const m = new Map<string, PoMonthTimesheetPhotoBundle>();
    for (const b of photoBundleRows ?? []) m.set(b.poId, b);
    return m;
  }, [photoBundleRows]);

  useEffect(() => {
    setPeriodEndByPo((prev) => {
      const next = { ...prev };
      for (const r of monthRows ?? []) {
        if (r.periodEndDate && /^\d{4}-\d{2}-\d{2}$/.test(r.periodEndDate)) {
          if (!next[r.poId]) next[r.poId] = r.periodEndDate;
        }
      }
      return next;
    });
  }, [monthRows]);

  const posWithWaves = useMemo(() => {
    const list = (allPos ?? []).filter((po) => (allWaves ?? []).some((w) => w.poId === po.id));
    return list;
  }, [allPos, allWaves]);

  const posRows = useMemo(() => {
    const posRowsBase = posWithWaves
      .filter((po) => {
        const waveInMonth = (allWaves ?? []).some((w) => w.poId === po.id && waveTouchesMonth(w, monthYm));
        if (waveInMonth) return true;
        if (filterLocationKey && poIdsMatchingLocationFilter?.has(po.id)) {
          return purchaseOrderOverlapsYearMonth(po, monthYm);
        }
        return false;
      })
      .filter((po) => !filterPoActiveBundleId || (bundlePoIdSet?.has(po.id) ?? false));
    return poIdsMatchingLocationFilter === null
      ? posRowsBase
      : posRowsBase.filter((po) => poIdsMatchingLocationFilter.has(po.id));
  }, [
    posWithWaves,
    allWaves,
    monthYm,
    filterLocationKey,
    poIdsMatchingLocationFilter,
    filterPoActiveBundleId,
    bundlePoIdSet,
  ]);

  const effectiveToolbarPoId = useMemo(() => {
    if (!embedded) return highlightPo || null;
    if (highlightPo && posRows.some((p) => p.id === highlightPo)) return highlightPo;
    return posRows[0]?.id ?? null;
  }, [embedded, highlightPo, posRows]);

  const toolbarTargetPo = useMemo(
    () => (effectiveToolbarPoId ? posRows.find((p) => p.id === effectiveToolbarPoId) ?? null : null),
    [posRows, effectiveToolbarPoId],
  );

  useEffect(() => {
    if (!embedded || posRows.length === 0) return;
    if (highlightPo && posRows.some((p) => p.id === highlightPo)) return;
    replaceWaveMonthQuery((p) => {
      p.set('highlightPo', posRows[0].id);
    });
  }, [embedded, posRows, highlightPo, replaceWaveMonthQuery]);

  const relatedWaveIdsFor = useCallback(
    (poId: string) =>
      (allWaves ?? []).filter((w) => w.poId === poId && waveTouchesMonth(w, monthYm)).map((w) => w.id),
    [allWaves, monthYm]
  );

  const getPeriodBounds = useCallback(
    (poId: string) => {
      const monthFirst = `${monthYm}-01`;
      const monthLast = lastDayOfCalendarMonth(monthYm);
      const end = periodEndByPo[poId] ?? monthLast;
      return { periodStartDate: monthFirst, periodEndDate: end < monthFirst ? monthLast : end };
    },
    [monthYm, periodEndByPo],
  );

  const writePoMonthReview = useCallback(
    async (po: PurchaseOrder, status: PoMonthTimesheetReview['status']) => {
      if (!firestore || !currentUser || !canEditTs) return;
      const { periodStartDate, periodEndDate } = getPeriodBounds(po.id);
      if (periodEndDate < periodStartDate) {
        toast({ variant: 'destructive', title: 'ช่วงวันที่ไม่ถูกต้อง', description: 'วันสุดท้ายต้องไม่ก่อนวันต้นเดือน' });
        return;
      }
      setSubmittingPoId(po.id);
      try {
        const id = poMonthTimesheetReviewDocId(po.id, monthYm);
        const now = Date.now();
        const ref = doc(firestore, 'po_month_timesheet_reviews', id);
        const existing = await getDoc(ref);
        const createdAt =
          existing.exists() && typeof existing.data()?.createdAt === 'number'
            ? (existing.data() as PoMonthTimesheetReview).createdAt
            : now;
        const wids = relatedWaveIdsFor(po.id);

        const base: Record<string, unknown> = {
          id,
          poId: po.id,
          yearMonth: monthYm,
          status,
          periodStartDate,
          periodEndDate,
          relatedWaveIds: wids,
          submittedAt: now,
          submittedByUserId: currentUser.id,
          submittedByName: currentUser.displayName || currentUser.email || currentUser.id,
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
          let atts: NonNullable<PoMonthTimesheetReview['timesheetPhotoAttachments']> = [];
          const monthlyBundleRef = doc(firestore, 'monthly_timesheet_photo_bundles', monthYm);
          const monthlySnap = await getDoc(monthlyBundleRef);
          if (monthlySnap.exists()) {
            const md = monthlySnap.data() as MonthlyTimesheetPhotoBundle;
            atts = Array.isArray(md.attachments) ? [...md.attachments] : [];
          }
          const bundleRef = doc(firestore, 'po_month_timesheet_photo_bundles', id);
          const bundleSnap = await getDoc(bundleRef);
          if (bundleSnap.exists()) {
            const bd = bundleSnap.data() as PoMonthTimesheetPhotoBundle;
            const poAtts = Array.isArray(bd.attachments) ? bd.attachments : [];
            const seen = new Set(atts.map((a) => a.id));
            for (const a of poAtts) {
              if (!seen.has(a.id)) {
                atts.push(a);
                seen.add(a.id);
              }
            }
          }
          base.timesheetPhotoAttachments = atts;
        }
        await setDoc(ref, base, { merge: true });
        if (status === 'entry_locked') {
          let readyCount = 0;
          let gatedDocs = 0;
          let syncedPos = 0;
          try {
            const sync = await syncReadyPayrollFlagsForYearMonthFromAllGatedPoMonthReviews(firestore, monthYm);
            readyCount = sync.updated;
            gatedDocs = sync.gatedPoCount;
            syncedPos = sync.syncedPoCount;
            const actorName = currentUser.displayName || currentUser.email || currentUser.id;
            await ensureWorkerMonthlyPayrollPeriodForYearMonth(firestore, monthYm, actorName);
          } catch (e) {
            console.error('[po-month] payroll bridge after lock', e);
          }
          toast({
            title: 'ปิดงวดสร้าง Payroll แล้ว',
            description:
              readyCount > 0
                ? `แก้รายวันไม่ได้ — ตั้งพร้อมจ่าย ${readyCount} ใบงาน — ครอบคลุม ${syncedPos} PO ที่ทับเดือน (เอกสารปิดงวดในเดือนนี้ ${gatedDocs} ฉบับ) · ไปทำ Payroll ได้ทันทีโดยไม่ต้องรอผู้จัดการอนุมัติ timesheet · กด «ส่งอนุมัติ Timesheet» เมื่อต้องการส่งคิวผู้จัดการเพื่อ Invoice`
                : 'แก้รายวันไม่ได้เมื่อเอกสารถูกปิดงวด — หากยังไม่มีใบงานในช่วงงวดจะไม่มีรายการพร้อมจ่าย · กด «ส่งอนุมัติ Timesheet» เมื่อแนบครบและต้องการส่งผู้จัดการ',
          });
        } else if (status === 'pending_manager_review') {
          let readyCountPm = 0;
          let gatedDocsPm = 0;
          let syncedPosPm = 0;
          try {
            const syncPm = await syncReadyPayrollFlagsForYearMonthFromAllGatedPoMonthReviews(firestore, monthYm);
            readyCountPm = syncPm.updated;
            gatedDocsPm = syncPm.gatedPoCount;
            syncedPosPm = syncPm.syncedPoCount;
            const actorNamePm = currentUser.displayName || currentUser.email || currentUser.id;
            await ensureWorkerMonthlyPayrollPeriodForYearMonth(firestore, monthYm, actorNamePm);
          } catch (e) {
            console.error('[po-month] payroll bridge after submit', e);
          }
          toast({
            title: 'ส่งอนุมัติ Timesheet แล้ว',
            description:
              readyCountPm > 0
                ? `รอผู้จัดการที่เมนูอนุมัติ — คิวนี้ใช้สำหรับตรวจและออก Invoice ตาม SB/W ใน timesheet · ระบบซิงก์ธงพร้อมจ่าย ${readyCountPm} ใบงาน (ครอบคลุม ${syncedPosPm} PO ในเดือนปฏิทิน ตามนโยบายเดิม)`
                : 'รอผู้จัดการที่เมนูอนุมัติ — หากยังไม่มีใบงานในช่วงงวดจะไม่มีรายการพร้อมจ่ายให้ซิงก์',
          });
        }
      } catch (e: unknown) {
        toast({
          variant: 'destructive',
          title: 'บันทึกไม่สำเร็จ',
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setSubmittingPoId(null);
      }
    },
    [firestore, currentUser, canEditTs, monthYm, getPeriodBounds, relatedWaveIdsFor, toast],
  );

  const adminUnlockPoMonthReview = useCallback(
    async (po: PurchaseOrder) => {
      if (!firestore || !currentUser) return;
      if (!isSystemAdmin(currentUser)) {
        toast({
          variant: 'destructive',
          title: 'ไม่มีสิทธิ์',
          description: 'เฉพาะ System Administrator เท่านั้น',
        });
        return;
      }
      const row = reviewByPoId.get(po.id);
      if (
        !row ||
        !['entry_locked', 'pending_manager_review', 'approved'].includes(row.status)
      ) {
        toast({
          variant: 'destructive',
          title: 'ปลดล็อกไม่ได้',
          description: 'สถานะเอกสารไม่ใช่ล็อกงวด / ส่งตรวจ / อนุมัติแล้ว',
        });
        return;
      }
      const id = poMonthTimesheetReviewDocId(po.id, monthYm);
      const now = Date.now();
      setSubmittingPoId(po.id);
      try {
        const ref = doc(firestore, 'po_month_timesheet_reviews', id);
        await setDoc(
          ref,
          {
            id,
            poId: po.id,
            yearMonth: monthYm,
            status: 'rejected',
            updatedAt: now,
            submittedAt: now,
            submittedByUserId: currentUser.id,
            submittedByName: currentUser.displayName || currentUser.email || currentUser.id,
            entryLockedAt: deleteField(),
            entryLockedByUserId: deleteField(),
            entryLockedByName: deleteField(),
            reviewedAt: deleteField(),
            reviewedByUserId: deleteField(),
            reviewedByName: deleteField(),
            reviewNote: deleteField(),
            timesheetPhotoAttachments: deleteField(),
          } as Record<string, unknown>,
          { merge: true },
        );
        const cleared = await clearReadyPayrollFlagsForPoCalendarMonth(firestore, po.id, monthYm);
        toast({
          title: 'ปลดล็อกงวดแล้ว (Admin)',
          description:
            cleared.updated > 0
              ? `สถานะกลับเป็น «ปฏิเสธ» — แก้ไขวันงวดและล็อกใหม่ได้ · ล้างพร้อมจ่าย/วางบิลบนใบงาน ${cleared.updated} รายการใน PO+เดือนนี้ (ไม่แตะใบ LOCKED)`
              : `สถานะกลับเป็น «ปฏิเสธ» — แก้ไขวันงวดและล็อกใหม่ได้ · ไม่มีใบงานในเดือนนี้ให้ล้างธง`,
        });
        setUnlockConfirmPo(null);
      } catch (e: unknown) {
        toast({
          variant: 'destructive',
          title: 'ปลดล็อกไม่สำเร็จ',
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setSubmittingPoId(null);
      }
    },
    [firestore, currentUser, monthYm, reviewByPoId, toast],
  );

  /** ล็อกงวดแล้วไม่ต้องกดซ้ำ — ใช้ปุ่มนี้ตั้ง readyForPayroll / รอบบัญชีใหม่ทั้งเดือน */
  const runPayrollSyncForMonth = useCallback(async () => {
    if (!firestore || !currentUser || !canEditTs || !/^\d{4}-\d{2}$/.test(monthYm)) return;
    setPayrollSyncBusy(true);
    try {
      const { updated, gatedPoCount, syncedPoCount } = await syncReadyPayrollFlagsForYearMonthFromAllGatedPoMonthReviews(
        firestore,
        monthYm,
      );
      const actor = currentUser.displayName || currentUser.email || currentUser.id;
      await ensureWorkerMonthlyPayrollPeriodForYearMonth(firestore, monthYm, actor);
      toast({
        title: 'ซิงก์พร้อมจ่ายแล้ว',
        description:
          updated > 0
            ? `อัปเดต ${updated} ใบงาน — ครอบคลุม ${syncedPoCount} PO active ที่ทับเดือน ${monthYm} (มีเอกสารปิดงวดในเดือนนี้ ${gatedPoCount} ฉบับ) — ไปเมนู งวดจ่ายลูกจ้าง แล้วกดสร้าง Batch`
            : gatedPoCount === 0
              ? `ยังไม่มี PO+เดือนที่ล็อก/ส่งตรวจ/อนุมัติในเดือนนี้ — ล็อกอย่างน้อยหนึ่งฉบับก่อน แล้วค่อยซิงก์`
              : `ไม่มีใบงานให้อัปเดต — ตรวจว่ามี daily_timesheets ในเดือนนี้`,
      });
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'ซิงก์ไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setPayrollSyncBusy(false);
    }
  }, [firestore, currentUser, canEditTs, monthYm, toast]);

  const runPortalParityForToolbarPo = useCallback(async () => {
    if (!firestore || !toolbarTargetPo || !/^\d{4}-\d{2}$/.test(monthYm) || !canEditTs) return;
    const label = toolbarTargetPo.poCode || toolbarTargetPo.id;
    if (
      !window.confirm(
        `ซิงก์ customerId / purchaseOrderId บน mobilizations และ daily_timesheets ของ PO ${label} งวด ${monthYm} เพื่อให้พอร์ทัลลูกค้าแสดงครบ (ชุด legacy จาก flow เดิม)?`,
      )
    )
      return;
    setPortalParityBusy(true);
    try {
      const r = await runPortalParityBackfillForPoMonth(firestore, toolbarTargetPo.id, monthYm);
      toast({
        title: 'ซิงก์ข้อมูลพอร์ทัลแล้ว',
        description: `Mobilizations อัปเดต ${r.mobilizationsUpdated}/${r.mobilizationsScanned} · แถวรายวัน ${r.dailySheetsUpdated}/${r.dailySheetsScanned}`,
      });
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'ซิงก์พอร์ทัลไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setPortalParityBusy(false);
    }
  }, [firestore, toolbarTargetPo, monthYm, canEditTs, toast]);

  const appendPhoto = useCallback(
    async (po: PurchaseOrder, file: File) => {
      if (!firebaseApp || !firestore) return;
      const id = poMonthTimesheetReviewDocId(po.id, monthYm);
      const existing = bundleByPoId.get(po.id);
      if ((existing?.attachments?.length ?? 0) >= MAX_PO_MONTH_ATTACHMENTS) {
        toast({
          variant: 'destructive',
          title: 'เต็มจำนวนแนบ',
          description: `แนบได้สูงสุด ${MAX_PO_MONTH_ATTACHMENTS} ไฟล์ — ลบบางรายก่อนเพิ่ม`,
        });
        return;
      }
      setUploadingPhotoPoId(po.id);
      try {
        const att = await uploadPoMonthTimesheetPhoto(firebaseApp, id, file);
        const bundleRef = doc(firestore, 'po_month_timesheet_photo_bundles', id);
        const snap = await getDoc(bundleRef);
        const prev = snap.exists() ? ((snap.data() as PoMonthTimesheetPhotoBundle).attachments ?? []) : [];
        await setDoc(
          bundleRef,
          {
            id,
            poId: po.id,
            yearMonth: monthYm,
            attachments: [...prev, att],
            updatedAt: Date.now(),
          } as Record<string, unknown>,
          { merge: true }
        );
        toast({ title: 'แนบไฟล์แล้ว', description: 'รูปมากกว่า ~500 KB ระบบจะบีบอัตโนมัติ' });
      } catch (e: unknown) {
        toast({
          variant: 'destructive',
          title: 'อัปโหลดไม่สำเร็จ',
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setUploadingPhotoPoId(null);
      }
    },
    [firebaseApp, firestore, monthYm, bundleByPoId, toast],
  );

  const removePhoto = useCallback(
    async (po: PurchaseOrder, attId: string, storagePath: string) => {
      if (!firebaseApp || !firestore) return;
      const id = poMonthTimesheetReviewDocId(po.id, monthYm);
      setUploadingPhotoPoId(po.id);
      try {
        await deletePoMonthTimesheetPhotoFile(firebaseApp, storagePath);
        const bundleRef = doc(firestore, 'po_month_timesheet_photo_bundles', id);
        const snap = await getDoc(bundleRef);
        if (!snap.exists()) return;
        const bd = snap.data() as PoMonthTimesheetPhotoBundle;
        const next = (bd.attachments ?? []).filter((a) => a.id !== attId);
        await setDoc(bundleRef, { attachments: next, updatedAt: Date.now() }, { merge: true });
        toast({ title: 'ลบไฟล์แล้ว' });
      } catch (e: unknown) {
        toast({
          variant: 'destructive',
          title: 'ลบไม่สำเร็จ',
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setUploadingPhotoPoId(null);
      }
    },
    [firebaseApp, firestore, monthYm, toast],
  );

  const appendMonthlyPhoto = useCallback(
    async (file: File) => {
      if (!firebaseApp || !firestore || !/^\d{4}-\d{2}$/.test(monthYm)) return;
      const prevLen = monthlyPhotoBundleDoc?.attachments?.length ?? 0;
      if (prevLen >= MAX_PO_MONTH_ATTACHMENTS) {
        toast({
          variant: 'destructive',
          title: 'เต็มจำนวนแนบ',
          description: `แนบได้สูงสุด ${MAX_PO_MONTH_ATTACHMENTS} ไฟล์ — ลบบางรายก่อนเพิ่ม`,
        });
        return;
      }
      setUploadingMonthlyPhoto(true);
      try {
        const att = await uploadMonthlyTimesheetPhoto(firebaseApp, monthYm, file);
        const bundleRef = doc(firestore, 'monthly_timesheet_photo_bundles', monthYm);
        const snap = await getDoc(bundleRef);
        const prev = snap.exists() ? ((snap.data() as MonthlyTimesheetPhotoBundle).attachments ?? []) : [];
        await setDoc(
          bundleRef,
          {
            id: monthYm,
            yearMonth: monthYm,
            attachments: [...prev, att],
            updatedAt: Date.now(),
          } as Record<string, unknown>,
          { merge: true },
        );
        toast({
          title: 'แนบไฟล์แล้ว',
          description: 'ผูกกับเอกสาร timesheet รายเดือน (เลข TS-) — ใช้ตรวจกับตารางสรุปรายเดือน',
        });
      } catch (e: unknown) {
        toast({
          variant: 'destructive',
          title: 'อัปโหลดไม่สำเร็จ',
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setUploadingMonthlyPhoto(false);
      }
    },
    [firebaseApp, firestore, monthYm, toast],
  );

  const removeMonthlyPhoto = useCallback(
    async (attId: string, storagePath: string) => {
      if (!firebaseApp || !firestore || !/^\d{4}-\d{2}$/.test(monthYm)) return;
      setUploadingMonthlyPhoto(true);
      try {
        await deleteMonthlyTimesheetPhotoFile(firebaseApp, storagePath);
        const bundleRef = doc(firestore, 'monthly_timesheet_photo_bundles', monthYm);
        const snap = await getDoc(bundleRef);
        if (!snap.exists()) return;
        const bd = snap.data() as MonthlyTimesheetPhotoBundle;
        const next = (bd.attachments ?? []).filter((a) => a.id !== attId);
        await setDoc(bundleRef, { attachments: next, updatedAt: Date.now() }, { merge: true });
        toast({ title: 'ลบไฟล์แล้ว' });
      } catch (e: unknown) {
        toast({
          variant: 'destructive',
          title: 'ลบไม่สำเร็จ',
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setUploadingMonthlyPhoto(false);
      }
    },
    [firebaseApp, firestore, monthYm, toast],
  );

  useImperativeHandle(
    ref,
    () => ({
      lockPeriod: () => {
        const po = toolbarTargetPo;
        if (!po) {
          toast({ variant: 'destructive', title: 'ไม่มี PO', description: 'ยังไม่มี PO ในงวดนี้' });
          return;
        }
        const r = reviewByPoId.get(po.id);
        const lockDisabled =
          !canEditTs ||
          submittingPoId === po.id ||
          (r && (r.status === 'entry_locked' || r.status === 'pending_manager_review' || r.status === 'approved'));
        if (lockDisabled) {
          toast({
            variant: 'destructive',
            title: 'ปิดงวดไม่ได้',
            description: !canEditTs ? 'ไม่มีสิทธิ์แก้ไข' : 'สถานะงวดไม่รองรับการปิดซ้ำ',
          });
          return;
        }
        void writePoMonthReview(po, 'entry_locked');
      },
      openSubmitDialog: () => {
        const po = toolbarTargetPo;
        if (!po) {
          toast({ variant: 'destructive', title: 'ไม่มี PO', description: 'ยังไม่มี PO ในงวดนี้' });
          return;
        }
        const r = reviewByPoId.get(po.id);
        const canSendToManager = canEditTs && !!r && (r.status === 'entry_locked' || r.status === 'rejected');
        if (!canSendToManager) {
          toast({
            variant: 'destructive',
            title: 'ส่งอนุมัติ Timesheet ไม่ได้',
            description: 'ต้องกดปิดงวดสร้าง Payroll ก่อน (หรืองวดอยู่ระหว่างส่งอนุมัติ/อนุมัติแล้ว)',
          });
          return;
        }
        setSubmitDialogPo(po);
      },
      openUnlockDialog: () => {
        if (!currentUser) return;
        if (!isSystemAdmin(currentUser)) {
          toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'เฉพาะ System Administrator เท่านั้น' });
          return;
        }
        const po = toolbarTargetPo;
        if (!po) {
          toast({ variant: 'destructive', title: 'ไม่มี PO', description: 'ยังไม่มี PO ในงวดนี้' });
          return;
        }
        const r = reviewByPoId.get(po.id);
        if (!r || !['entry_locked', 'pending_manager_review', 'approved'].includes(r.status)) {
          toast({
            variant: 'destructive',
            title: 'ปลดล็อกไม่ได้',
            description: 'สถานะเอกสารไม่ใช่ล็อกงวด / ส่งตรวจ / อนุมัติแล้ว',
          });
          return;
        }
        setUnlockConfirmPo(po);
      },
      openAttachPicker: () => {
        if (!/^\d{4}-\d{2}$/.test(monthYm)) return;
        document.getElementById(`monthly-ts-file-${monthYm}`)?.click();
      },
      selectToolbarPo: (poId: string) => {
        replaceWaveMonthQuery((p) => {
          p.set('highlightPo', poId);
        });
      },
      removeMonthlyAttachment: (attId: string, storagePath: string) => {
        void removeMonthlyPhoto(attId, storagePath);
      },
    }),
    [
      toolbarTargetPo,
      reviewByPoId,
      canEditTs,
      submittingPoId,
      toast,
      writePoMonthReview,
      currentUser,
      replaceWaveMonthQuery,
      monthYm,
      removeMonthlyPhoto,
    ],
  );

  useEffect(() => {
    if (!embedded) {
      onEmbeddedToolbarSnapshot?.(null);
      return;
    }
    const poOptions = posRows.map((p) => ({ id: p.id, code: p.poCode ?? p.id }));
    const monthlyAttachments = monthlyPhotoBundleDoc?.attachments ?? [];
    const attachDisabled = monthlyAttachReadonly || !canEditTs || uploadingMonthlyPhoto;

    if (!toolbarTargetPo) {
      onEmbeddedToolbarSnapshot?.({
        selectedPoId: null,
        poOptions,
        lockDisabled: true,
        sendDisabled: true,
        sendHidden: true,
        unlockHidden: true,
        unlockDisabled: true,
        attachDisabled,
        monthlyAttachUploading: uploadingMonthlyPhoto,
        monthlyTimesheetNo,
        monthlyAttachments,
        busyPoId: submittingPoId,
      });
      return;
    }
    const po = toolbarTargetPo;
    const r = reviewByPoId.get(po.id);
    const lockDisabled =
      !canEditTs ||
      submittingPoId === po.id ||
      (!!r && (r.status === 'entry_locked' || r.status === 'pending_manager_review' || r.status === 'approved'));
    const canSendToManager = canEditTs && !!r && (r.status === 'entry_locked' || r.status === 'rejected');
    const showUnlock =
      !!currentUser &&
      isSystemAdmin(currentUser) &&
      !!r &&
      (r.status === 'entry_locked' || r.status === 'pending_manager_review' || r.status === 'approved');

    onEmbeddedToolbarSnapshot?.({
      selectedPoId: po.id,
      poOptions,
      lockDisabled,
      sendDisabled: submittingPoId === po.id || !canSendToManager,
      sendHidden: !canSendToManager,
      unlockHidden: !showUnlock,
      unlockDisabled: submittingPoId === po.id,
      attachDisabled,
      monthlyAttachUploading: uploadingMonthlyPhoto,
      monthlyTimesheetNo,
      monthlyAttachments,
      busyPoId: submittingPoId,
    });
  }, [
    embedded,
    toolbarTargetPo,
    posRows,
    reviewByPoId,
    canEditTs,
    submittingPoId,
    uploadingMonthlyPhoto,
    monthlyAttachReadonly,
    monthlyTimesheetNo,
    monthlyPhotoBundleDoc,
    currentUser,
    onEmbeddedToolbarSnapshot,
  ]);

  if (userLoading || !currentUser) return null;
  if (!canViewTs) {
    if (embedded) {
      return (
        <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">
          คุณไม่มีสิทธิ์เมนูนี้
        </div>
      );
    }
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-5xl mx-auto py-10 text-center text-muted-foreground">คุณไม่มีสิทธิ์เมนูนี้</div>
      </AppShell>
    );
  }

  const loading = posLoading || wavesLoading || reviewsLoading;

  const selectedLocationLabel =
    filterLocationKey && locationFilterOptions.find(([k]) => k === filterLocationKey)?.[1];

  const panelInner = (
    <>
      {embedded && /^\d{4}-\d{2}$/.test(monthYm) ? (
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="hidden"
          id={`monthly-ts-file-${monthYm}`}
          disabled={monthlyAttachReadonly || !canEditTs || uploadingMonthlyPhoto}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void appendMonthlyPhoto(f);
          }}
        />
      ) : null}
      <div id="timesheet-po-month-panel" className="mx-auto max-w-[1100px] space-y-6 py-6 px-4">
        <div className="hidden print:block border-b border-foreground/25 pb-4 mb-2 space-y-1 text-sm text-foreground">
          <div className="text-xl font-bold">Timesheet ราย PO+เดือน — สำหรับพิมพ์</div>
          <div>
            งวด: <span className="font-mono font-semibold">{monthYm}</span> ({formatThaiYearMonthLabel(monthYm, 'th-TH')})
          </div>
          {filterPoActiveBundleId ? (
            <div>
              ชุด PO Active: <span className="font-mono text-xs">{filterPoActiveBundleId}</span>
            </div>
          ) : null}
          <div>
            สถานที่:{' '}
            <span className="font-semibold">{filterLocationKey ? (selectedLocationLabel ?? filterLocationKey) : 'ทุกสถานที่'}</span>
          </div>
          {monthlyTimesheetNo ? (
            <div>
              เลขรวมเอกสาร: <span className="font-mono">{monthlyTimesheetNo}</span>
            </div>
          ) : null}
        </div>

        {embedded ? (
          <div className="print:hidden rounded-lg border bg-muted/30 px-4 py-3">
            <h2 className="text-lg font-bold text-primary flex flex-wrap items-center gap-2">
              <FileText className="h-5 w-5 shrink-0" />
              เอกสาร PO+เดือน — ปิดงวด Payroll / ส่งอนุมัติ TS / แนบ
            </h2>
            <p className="text-muted-foreground text-xs mt-1">
              เลขรวมเอกสารเดือน:{' '}
              {monthlyDocLoading ? (
                <span className="font-mono">…</span>
              ) : (
                <span className="font-mono font-semibold text-foreground">{monthlyTimesheetNo ?? '—'}</span>
              )}
            </p>
          </div>
        ) : (
          <div className="print:hidden">
            <PayrollScopeTag scope="worker" showHint={false} />
            <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
              <FileText className="h-7 w-7" />
              เอกสาร timesheet ราย PO+เดือน (ปิดงวด Payroll / ส่งอนุมัติ TS / แนบ)
            </h1>
            <p className="text-muted-foreground text-sm max-w-3xl mt-1 print:hidden">
              <strong>ชุดนี้เป็นหลัก</strong> สำหรับปิดงวด ส่งลูกค้า/ผู้จัดการตรวจ ออก invoice และงาน payroll —{' '}
              <strong>ไม่อ้างอิง Wave ในการออกเอกสาร</strong> (ราย wave ยังใช้ลงเวลารายวันบนกระดาน) · เลขรวม:{' '}
              {monthlyDocLoading ? (
                <span className="font-mono">…</span>
              ) : (
                <span className="font-mono font-semibold text-foreground">{monthlyTimesheetNo ?? '—'}</span>
              )}
            </p>
          </div>
        )}

        {filterPoActiveBundleId ? (
          <Alert className="border-primary/30 bg-primary/5 print:hidden">
            <Info className="h-4 w-4" />
            <AlertTitle className="text-sm">กรองตามชุด PO Active</AlertTitle>
            <AlertDescription className="text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-mono text-xs">{filterPoActiveBundleId}</span>
              <Link href="/timesheets" className="font-semibold text-primary underline">
                ← กลับศูนย์ลงเวลา (ชุด)
              </Link>
              <Link href={`/timesheets/wave-board?poActiveBundleId=${encodeURIComponent(filterPoActiveBundleId)}&month=${encodeURIComponent(monthYm)}`} className="text-primary underline">
                เปิดกระดานลงเวลาในงวดนี้ →
              </Link>
            </AlertDescription>
          </Alert>
        ) : null}

        {filterLocationKey ? (
          <Alert className="border-emerald-200/80 bg-emerald-50/60 print:hidden">
            <MapPin className="h-4 w-4" />
            <AlertTitle className="text-sm">กรองตามสถานที่ (เฟส 6)</AlertTitle>
            <AlertDescription className="text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium">{selectedLocationLabel ?? filterLocationKey}</span>
              <Button type="button" variant="link" className="h-auto p-0 text-primary" onClick={() => applyLocationFilter('__all__')}>
                แสดงทุกสถานที่
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {!embedded ? (
          <div className="print:hidden">
            <PageGuidance
              title="ขั้นตอน"
              tips={[
                'ตั้ง "วันสุดท้ายของงวด" ตามรอบปิดจริง แล้วกด ปิดงวดสร้าง Payroll — จากนั้นแนบรูป/PDF คู่เลข TS- ได้สูงสุด 4 ไฟล์ (รูปใหญ่กว่า ~500KB จะบีบอัตโนมัติ, PDF สูงสุด 10MB)',
                'กด ส่งอนุมัติ Timesheet ให้ผู้จัดการ (เมนู HR) — หลังอนุมัติใช้เป็นฐานออก Invoice ตาม SB/W และราคาต่อตำแหน่ง (การคำนวณเดิม)',
                'ดูสรุปกริดรายเดือน: เลื่อนลงไปที่ตารางสรุปรายเดือน — ปิดงวด/ส่งอนุมัติทำที่การ์ด PO ในส่วนนี้',
                'เลือกสถานที่จาก dropdown หรือพารามิเตอร์ URL locationKey — พิมพ์มุมมองนี้ได้เมื่อกรองแล้ว (หรือทั้งหมด)',
              ]}
            />
          </div>
        ) : null}

        {!embedded ? (
          <Alert className="border-sky-200/80 bg-sky-50/50 dark:border-sky-800 dark:bg-sky-950/20 print:hidden">
            <Info className="h-4 w-4" />
            <AlertTitle>ไม่ใช่ราย Wave แล้ว</AlertTitle>
            <AlertDescription className="text-sm">
              งานปิดเอกสาร/แนบไฟล์ย้ายมาใช้ตารางนี้เท่านั้น — หน้า{' '}
              <Link className="text-primary font-medium underline" href={`/timesheets/wave-month?month=${encodeURIComponent(monthYm)}`}>
                สรุปรายเดือน (ราย wave)
              </Link>{' '}
              ใช้เพื่อดูตารางรวมและลงรายวัน
            </AlertDescription>
          </Alert>
        ) : null}

        <Card className="print:shadow-none print:border print:break-inside-avoid">
          <CardHeader className="print:py-2">
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin className="h-4 w-4 print:hidden" />
              งวด timesheet ตามสถานที่ (เฟส B — PO line · เฟส 6 — กรอง/พิมพ์)
            </CardTitle>
            <CardDescription>
              สร้าง/อัปเดตอัตโนมัติเมื่อโหลดหน้านี้ โดยรวมบรรทัด PO ตาม <strong>workLocation</strong> — แยกหัวงวดต่อ
              ลูกค้า/สัญญา/PO/<strong>สถานที่</strong>/เดือน แม้ยังไม่มี wave หรือรายลงเวลา (สถานะเริ่มที่ PLANNING) —{' '}
              <span className="text-foreground font-medium">
                PO เดียวกันที่มีหลายสถานที่บน PO line จะมีหลายแถว (แต่ละแถวคือไซต์ต่างกัน — ไม่ใช่ซ้ำผิดพลาด)
              </span>
              {' '}— เลือกสถานที่ด้านล่างหรือ <span className="font-mono text-[10px]">?locationKey=…</span> แล้วกดพิมพ์
            </CardDescription>
          </CardHeader>
          <CardContent>
            {locShellsLoading ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดรายการงวด…
              </p>
            ) : locShellsForDisplay.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                ยังไม่มีหัวงวด — ตรวจว่า PO สัญญา (active) ทับช่วงเดือนนี้และมีบรรทัด PO ระบุสถานที่
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>รายการ</TableHead>
                      <TableHead>ลูกค้า</TableHead>
                      <TableHead>สถานที่</TableHead>
                      <TableHead className="w-[7rem]">สถานะ</TableHead>
                      <TableHead className="w-[5.5rem] print:hidden text-right">ลัด</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {locShellsForDisplay.map((row, idx) => {
                      const prev = idx > 0 ? locShellsForDisplay[idx - 1] : null;
                      const samePoAsPrev = prev?.poId === row.poId;
                      const startNewPoGroup = idx === 0 || !samePoAsPrev;
                      return (
                      <TableRow
                        key={row.id}
                        className={cn(startNewPoGroup && idx > 0 && 'border-t-2 border-muted-foreground/20')}
                      >
                        <TableCell className="align-top text-sm">
                          {samePoAsPrev ? (
                            <div className="space-y-1 pl-2 border-l-2 border-primary/35">
                              <div className="text-[11px] font-medium text-muted-foreground leading-tight">
                                สถานที่เพิ่มของ PO เดียวกัน (ไซต์ต่างจากแถวด้านบน)
                              </div>
                              <div className="text-[10px] text-muted-foreground max-w-[18rem] truncate" title={row.id}>
                                {row.projectNameSnapshot || '—'}
                              </div>
                              <div className="text-[10px] text-muted-foreground/80 font-mono mt-0.5" title={row.id}>
                                {formatPoLocationMonthShellListLabel(
                                  row.poCodeSnapshot || row.poId,
                                  row.yearMonth,
                                  row.locationLabel || row.locationKey,
                                )}
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="font-mono font-medium">{row.poCodeSnapshot || row.poId}</div>
                              <div className="text-[10px] text-muted-foreground max-w-[18rem] truncate" title={row.id}>
                                {row.projectNameSnapshot || '—'}
                              </div>
                              <div className="text-[10px] text-muted-foreground/80 font-mono mt-0.5" title={row.id}>
                                {formatPoLocationMonthShellListLabel(
                                  row.poCodeSnapshot || row.poId,
                                  row.yearMonth,
                                  row.locationLabel || row.locationKey,
                                )}
                              </div>
                            </>
                          )}
                        </TableCell>
                        <TableCell className="text-sm align-top">
                          {customerNameById.get(row.customerId) || <span className="font-mono text-xs">{row.customerId}</span>}
                        </TableCell>
                        <TableCell className="text-sm align-top max-w-[14rem]">
                          {row.locationLabel || row.locationKey}
                        </TableCell>
                        <TableCell className="align-top">{shellStatusBadge(row.status)}</TableCell>
                        <TableCell className="align-top text-right print:hidden">
                          <Link href={filterHrefForShellRow(row)} className="text-xs text-primary font-medium underline whitespace-nowrap">
                            กรองที่นี่
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground mt-3 print:hidden">
              เอกสาร PO+งวด (ล็อก/แนบ) ยังทำที่การ์ดด้านล่าง — รายการนี้คือ &quot;หัวงวด&quot; รายสถานที่เพื่อต่อกับกระดานลงเวลา/ใบ invoice ในรอบถัดไป
              — ถ้าต้องการเหลือแถวเดียวต่อ PO ให้ปรับบรรทัด PO ให้ใช้สถานที่ (workLocation) ตรงกันหรือรวมบรรทัด
            </p>
          </CardContent>
        </Card>

        <div className="flex flex-col lg:flex-row gap-3 items-end flex-wrap print:hidden">
          <div className="space-y-1">
            <Label>งวด (yyyy-MM)</Label>
            <Input
              className="font-mono w-40"
              value={monthYm}
              onChange={(e) => {
                const v = (e.target.value || '').trim().slice(0, 7);
                setMonthYm(v);
                onLinkedMonthYmChange?.(v);
              }}
            />
            <p className="text-xs text-muted-foreground">{formatThaiYearMonthLabel(monthYm, 'th-TH')}</p>
          </div>
          <div className="space-y-1 w-full min-w-[220px] max-w-sm">
            <Label>สถานที่ (จาก PO line / หัวงวด)</Label>
            <Select value={locationSelectValue} onValueChange={applyLocationFilter}>
              <SelectTrigger className="font-normal">
                <SelectValue placeholder="ทุกสถานที่" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">ทุกสถานที่</SelectItem>
                {locationFilterOptions.map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="button" variant="secondary" className="gap-1" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            พิมพ์มุมมองนี้
          </Button>
          <Button type="button" variant="outline" asChild>
            {embedded ? (
              <a href="#wave-month-timesheet-grid">สรุปลงเวลา (ตาราง)</a>
            ) : (
              <Link href={`/timesheets/wave-month?month=${encodeURIComponent(monthYm)}`}>สรุปลงเวลา (ตาราง)</Link>
            )}
          </Button>
          <Button variant="outline" asChild>
            <Link href="/hr/timesheet-month-approval">คิวอนุมัติ (Manager)</Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            className="gap-1 border-amber-600/40 text-amber-950 dark:text-amber-100"
            title="เติม customerId / PO ใน mobilizations และ daily_timesheets ให้พอร์ทัลอ่านได้ครบ (ข้อมูลเก่า)"
            disabled={
              !canEditTs ||
              portalParityBusy ||
              !toolbarTargetPo ||
              !/^\d{4}-\d{2}$/.test(monthYm)
            }
            onClick={() => void runPortalParityForToolbarPo()}
          >
            {portalParityBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            ซิงก์ให้พอร์ทัล (legacy)
          </Button>
        </div>

        <Card className="print:shadow-none print:border print:break-inside-auto">
          <CardHeader className="print:py-2 space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <CardTitle className="text-base">PO ที่เปิด wave ในงวดนี้ + เอกสาร</CardTitle>
                <CardDescription>
                  เฉพาะ PO ที่มี wave และ (ช่วง wave ทับเดือนที่เลือก หรือเมื่อกรองสถานที่ — มีหัวงวดสถานที่ในเดือนนี้และ PO ทับเดือนปฏิทิน)
                  {filterLocationKey ? (
                    <span className="block mt-1 text-emerald-900 font-medium">
                      กรองเฉพาะ PO ที่มีหัวงวดสถานที่นี้ในเดือนนี้ — เหลือ {posRows.length} การ์ด
                    </span>
                  ) : null}
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="shrink-0 gap-1.5"
                disabled={!canEditTs || payrollSyncBusy || !/^\d{4}-\d{2}$/.test(monthYm)}
                onClick={() => void runPayrollSyncForMonth()}
              >
                {payrollSyncBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                ซิงก์พร้อมจ่ายทั้งเดือน
              </Button>
            </div>
            <p className="text-xs text-muted-foreground rounded-md border border-dashed border-amber-300/60 bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2">
              <strong className="text-foreground">ปิดงวดสร้าง Payroll แล้ว — ปุ่มปิดงวดถูกปิดใช้ตามปกติ</strong>
              เมื่อมีอย่างน้อยหนึ่ง PO+เดือนที่ปิดงวดในเดือนนี้ การกด{' '}
              <span className="font-semibold">ซิงก์พร้อมจ่ายทั้งเดือน</span> จะตั้งพร้อมจ่ายให้ทุก PO active ที่ทับเดือนปฏิทิน — ไม่ต้องล็อกทุก PO — แล้วไป{' '}
              <span className="font-semibold">การจ่ายค่าจ้าง → งวดจ่ายลูกจ้าง</span> เพื่อ Pre-check / สร้าง Batch
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <p className="p-6 text-center text-muted-foreground flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลด…
              </p>
            ) : posRows.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground text-center">ยังไม่มี PO+wave ในปฏิทินนี้</p>
            ) : (
              <div className="space-y-6 p-4">
                {posRows.map((po) => {
                  const r = reviewByPoId.get(po.id);
                  const isHi =
                    (!!highlightPo && highlightPo === po.id) ||
                    (!!filterPoActiveBundleId && (bundlePoIdSet?.has(po.id) ?? false));
                  const bundle = bundleByPoId.get(po.id);
                  const photoReadOnly = isAttachmentReadonly(r);
                  const displayAtts = photoReadOnly
                    ? r?.timesheetPhotoAttachments ?? []
                    : bundle?.attachments ?? [];
                  const lockDisabled =
                    !canEditTs ||
                    submittingPoId === po.id ||
                    (r && (r.status === 'entry_locked' || r.status === 'pending_manager_review' || r.status === 'approved'));
                  const canSendToManager =
                    canEditTs && !!r && (r.status === 'entry_locked' || r.status === 'rejected');

                  return (
                    <div
                      key={po.id}
                      id={`po-month-po-${po.id}`}
                      className={`rounded-lg border bg-card p-4 space-y-3 print:break-inside-avoid ${isHi ? 'ring-2 ring-primary/30' : ''}`}
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="font-mono font-bold text-sm">{po.poCode}</div>
                          <div className="text-sm text-muted-foreground">{po.projectName}</div>
                        </div>
                        {r ? statusBadge(r.status) : <span className="text-xs text-muted-foreground">ยังไม่บันทึกงวด</span>}
                      </div>
                      <div className="flex flex-wrap items-end gap-3">
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">วันสุดท้ายของงวดปิด</Label>
                          <Input
                            type="date"
                            className="h-9 w-[180px] font-mono"
                            min={`${monthYm}-01`}
                            max={lastDayOfCalendarMonth(monthYm)}
                            value={periodEndByPo[po.id] ?? lastDayOfCalendarMonth(monthYm)}
                            onChange={(e) => setPeriodEndByPo((prev) => ({ ...prev, [po.id]: e.target.value }))}
                            disabled={
                              photoReadOnly || !canEditTs || (r && (r.status === 'pending_manager_review' || r.status === 'approved'))
                            }
                          />
                        </div>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="gap-1"
                          disabled={lockDisabled}
                          onClick={() => void writePoMonthReview(po, 'entry_locked')}
                        >
                          {submittingPoId === po.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
                          ปิดงวดสร้าง Payroll
                        </Button>
                        {canSendToManager ? (
                          <Button
                            type="button"
                            size="sm"
                            className="gap-1"
                            disabled={submittingPoId === po.id}
                            onClick={() => setSubmitDialogPo(po)}
                          >
                            <Send className="h-3.5 w-3.5" />
                            ส่งอนุมัติ Timesheet
                          </Button>
                        ) : null}
                        {isSystemAdmin(currentUser) &&
                        r &&
                        (r.status === 'entry_locked' ||
                          r.status === 'pending_manager_review' ||
                          r.status === 'approved') ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1 border-destructive/40 text-destructive hover:bg-destructive/10"
                            disabled={submittingPoId === po.id}
                            onClick={() => setUnlockConfirmPo(po)}
                          >
                            <Unlock className="h-3.5 w-3.5" />
                            ปลดล็อก (Admin)
                          </Button>
                        ) : null}
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        Wave ที่นับในงวด: {(relatedWaveIdsFor(po.id) || []).length} รายการ
                      </p>
                      <div className="border-t border-dashed pt-3 space-y-2">
                        {!embedded ? (
                          <>
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp,application/pdf"
                              className="hidden"
                              id={`pom-file-${po.id}`}
                              disabled={photoReadOnly || !canEditTs || uploadingPhotoPoId === po.id}
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                e.target.value = '';
                                if (f) void appendPhoto(po, f);
                              }}
                            />
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={photoReadOnly || !canEditTs || uploadingPhotoPoId === po.id}
                                onClick={() => document.getElementById(`pom-file-${po.id}`)?.click()}
                              >
                                {uploadingPhotoPoId === po.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <ImagePlus className="h-3.5 w-3.5" />
                                )}
                                แนบรูป / PDF
                              </Button>
                              <span className="text-xs text-muted-foreground">
                                สูงสุด {MAX_PO_MONTH_ATTACHMENTS} ไฟล์ · รูป: บีบให้ ~500 KB — PDF: 10 MB
                              </span>
                            </div>
                            {displayAtts.length > 0 ? (
                              <div className="flex flex-wrap gap-2">
                                {displayAtts.map((att) => (
                                  <div key={att.id} className="relative">
                                    {isWaveMonthAttachmentPdf(att) ? (
                                      <a
                                        href={att.downloadUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex h-16 w-16 flex-col items-center justify-center rounded border bg-muted/50 text-[9px] hover:bg-muted"
                                      >
                                        <FileIcon className="h-6 w-6 text-primary" />
                                        <span>PDF</span>
                                      </a>
                                    ) : (
                                      <a href={att.downloadUrl} target="_blank" rel="noopener noreferrer" className="block">
                                        <img src={att.downloadUrl} alt={att.fileName} className="h-16 w-16 rounded border object-cover" />
                                      </a>
                                    )}
                                    {!photoReadOnly && canEditTs ? (
                                      <button
                                        type="button"
                                        className="absolute -right-1 -top-1 rounded-full bg-destructive p-0.5 text-destructive-foreground shadow"
                                        onClick={() => void removePhoto(po, att.id, att.storagePath)}
                                        aria-label="ลบ"
                                        disabled={uploadingPhotoPoId === po.id}
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
                          </>
                        ) : (
                          <div className="space-y-1">
                            <p className="text-[10px] text-muted-foreground leading-snug">
                              แนบไฟล์ประกอบ<strong className="text-foreground">เอกสาร timesheet รายเดือน (เลข TS-)</strong> ที่แถบส้มเหนือตารางสรุปรายเดือน — ไม่แนบคู่ PO รายใบบนหน้านี้
                            </p>
                            {photoReadOnly && (r?.timesheetPhotoAttachments?.length ?? 0) > 0 ? (
                              <p className="text-[10px] text-muted-foreground">
                                เอกสาร PO นี้มีสำเนาแนบตอนส่งอนุมัติ Timesheet {r!.timesheetPhotoAttachments!.length} ไฟล์ (รวมจาก TS + PO เดิม)
                              </p>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={!!submitDialogPo}
        onOpenChange={(o) => {
          if (!o) setSubmitDialogPo(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>ยืนยันส่งอนุมัติ Timesheet</DialogTitle>
            <DialogDescription>
              เลขเอกสารรายเดือน:{' '}
              <span className="font-mono font-semibold text-foreground">{monthlyTimesheetNo ?? '—'}</span>
              {' · '}
              งวด {monthYm} — หลังผู้จัดการอนุมัติ ใช้เป็นฐานออก Invoice ตาม SB/W และราคาต่อตำแหน่งใน timesheet (ตามระบบเดิม)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-3">
              <Checkbox id="pom-s1" checked={submitQ1} onCheckedChange={(v) => setSubmitQ1(v === true)} />
              <label htmlFor="pom-s1" className="text-sm leading-snug cursor-pointer">
                1. ตรวจสอบยอด timesheet กับระบบตรงตามรอบชำระแล้ว
              </label>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox id="pom-s2" checked={submitQ2} onCheckedChange={(v) => setSubmitQ2(v === true)} />
              <label htmlFor="pom-s2" className="text-sm leading-snug cursor-pointer">
                2. แนบรูป/PDF คู่เอกสาร timesheet รายเดือน (เลข TS-) ครบตามนโยบาย (สูงสุด 4 ไฟล์)
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSubmitDialogPo(null)}>
              ยกเลิก
            </Button>
            <Button
              type="button"
              disabled={!submitQ1 || !submitQ2 || !submitDialogPo || submittingPoId === submitDialogPo.id}
              onClick={() => {
                if (!submitDialogPo) return;
                const po = submitDialogPo;
                void writePoMonthReview(po, 'pending_manager_review').then(() => setSubmitDialogPo(null));
              }}
            >
              {submitDialogPo && submittingPoId === submitDialogPo.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{' '}
              ยืนยันส่งอนุมัติ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!unlockConfirmPo}
        onOpenChange={(o) => {
          if (!o) setUnlockConfirmPo(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>ปลดล็อกงวด PO+เดือน (System Admin)</DialogTitle>
            <DialogDescription>
              {unlockConfirmPo ? (
                <>
                  <span className="font-mono font-semibold">{unlockConfirmPo.poCode}</span>
                  <span> · งวด {monthYm}</span>
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground leading-snug">
            <p>
              ระบบจะตั้งสถานะเอกสารเป็น <strong className="text-foreground">ปฏิเสธ</strong> เพื่อให้แก้ไขวันสุดท้ายของงวดและล็อกใหม่ได้
              และจะล้างธงพร้อมจ่าย/วางบิลบนใบงานรายวันในเดือนนี้ของ PO นี้ (ไม่แตะใบที่สถานะ LOCKED)
            </p>
            {unlockConfirmPo && reviewByPoId.get(unlockConfirmPo.id)?.status === 'approved' ? (
              <p className="rounded-md border border-amber-300/70 bg-amber-50/80 px-3 py-2 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
                เอกสารนี้อยู่ในสถานะ <strong>อนุมัติแล้ว</strong> — การปลดล็อกอาจกระทบการออก invoice / เอกสารที่อ้างอิงงวดนี้ ควรตรวจสอบกับบัญชีก่อนดำเนินการ
              </p>
            ) : null}
            {unlockConfirmPo && reviewByPoId.get(unlockConfirmPo.id)?.status === 'pending_manager_review' ? (
              <p>
                สถานะปัจจุบัน: <strong className="text-foreground">รอผู้จัดการ</strong> — การปลดล็อกจะถอนรายการออกจากคิวอนุมัติ
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setUnlockConfirmPo(null)}>
              ยกเลิก
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="gap-2"
              disabled={!unlockConfirmPo || submittingPoId === unlockConfirmPo.id}
              onClick={() => {
                if (!unlockConfirmPo) return;
                void adminUnlockPoMonthReview(unlockConfirmPo);
              }}
            >
              {unlockConfirmPo && submittingPoId === unlockConfirmPo.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              ยืนยันปลดล็อก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  if (embedded) return panelInner;
  return <AppShell user={currentUser} onLogout={() => {}}>{panelInner}</AppShell>;
});

TimesheetPoMonthPanel.displayName = 'TimesheetPoMonthPanel';
