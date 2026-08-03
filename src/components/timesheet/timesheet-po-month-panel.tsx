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
  MainContract,
  PayrollBatch,
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
  buildEligibleMainContractIdSet,
  filterPoActiveWorkflowPurchaseOrders,
  PO_ACTIVE_MAIN_CONTRACT_STATUS_IN,
} from '@/lib/ops/po-active-eligibility';
import {
  clearReadyPayrollFlagsForPoCalendarMonth,
  ensureWorkerMonthlyPayrollPeriodForYearMonth,
  poMonthTimesheetReviewDocId,
  syncReadyPayrollFlagsForPoMonth,
  syncReadyPayrollFlagsForYearMonthFromAllGatedPoMonthReviews,
  workerPayrollPeriodIdForYearMonth,
} from '@/lib/timesheet/po-month-timesheet-bridge';
import { poMonthReviewStatusLabelTh } from '@/lib/timesheet/po-month-review-status';
import { isSystemAdmin } from '@/lib/permission-core';
import { lastDayOfCalendarMonth } from '@/lib/timesheet/wave-month-utils';
import { runPortalParityBackfillForPoMonth } from '@/lib/timesheet/portal-parity-backfill';
import { isWaveMonthAttachmentPdf } from '@/lib/timesheet/wave-month-utils';
import { sanitizePrintFileBaseName } from '@/lib/documents/standard-document-print';
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
  listMonthlyTimesheetPhotoAttachmentsFromStorage,
  MAX_MONTHLY_TIMESHEET_ATTACHMENTS,
  uploadMonthlyTimesheetPhoto,
} from '@/lib/storage/monthly-timesheet-photos';
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

/** คีย์เดียวสำหรับปิดงวด/แนบไฟล์รวมทั้งชุด PO Active (หลาย PO ใน bundle) */
export const PO_ACTIVE_BUNDLE_TOOLBAR_ID = '__po_active_bundle__';

export type TimesheetPoMonthToolbarAttachment = WaveMonthTimesheetPhotoAttachment & {
  sourcePoId?: string;
  sourcePoCode?: string;
};

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

function poReviewStatusLabel(s: PoMonthTimesheetReview['status'] | null | undefined): string {
  return poMonthReviewStatusLabelTh(s);
}

function buildPoToolbarSnapshot(
  po: PurchaseOrder,
  r: PoMonthTimesheetReview | undefined,
  bundle: PoMonthTimesheetPhotoBundle | undefined,
  args: {
    canEditTs: boolean;
    submittingPoId: string | null;
    uploadingPhotoPoId: string | null;
    payrollSyncPoId: string | null;
    currentUser: User | null;
    /** มี Payroll Batch ของเดือนนี้แล้ว — ซ่อนปุ่มซิงก์พร้อมจ่าย */
    hasPayrollBatchForMonth: boolean;
  },
): TimesheetPoMonthToolbarSnapshot {
  const photoReadOnly = isAttachmentReadonly(r);
  const displayAtts = photoReadOnly ? r?.timesheetPhotoAttachments ?? [] : bundle?.attachments ?? [];
  const lockDisabled =
    !args.canEditTs ||
    args.submittingPoId === po.id ||
    (!!r && (r.status === 'entry_locked' || r.status === 'pending_manager_review' || r.status === 'approved'));
  const canSendToManager = args.canEditTs && !!r && (r.status === 'entry_locked' || r.status === 'rejected');
  const showUnlock =
    !!args.currentUser &&
    isSystemAdmin(args.currentUser) &&
    !!r &&
    (r.status === 'entry_locked' || r.status === 'pending_manager_review' || r.status === 'approved');
  const canPayrollSync =
    !args.hasPayrollBatchForMonth &&
    !!r &&
    (r.status === 'entry_locked' || r.status === 'pending_manager_review' || r.status === 'approved');

  return {
    poId: po.id,
    poCode: po.poCode ?? po.id,
    projectName: po.projectName,
    reviewStatus: r?.status ?? null,
    reviewStatusLabel: poReviewStatusLabel(r?.status),
    lockDisabled,
    sendDisabled: args.submittingPoId === po.id || !canSendToManager,
    sendHidden: !canSendToManager,
    unlockHidden: !showUnlock,
    unlockDisabled: args.submittingPoId === po.id,
    attachDisabled: photoReadOnly || !args.canEditTs || args.uploadingPhotoPoId === po.id,
    attachUploading: args.uploadingPhotoPoId === po.id,
    attachments: displayAtts,
    busyPoId: args.submittingPoId,
    payrollSyncHidden: !canPayrollSync,
    payrollSyncDisabled: !args.canEditTs || args.payrollSyncPoId === po.id,
    payrollSyncBusy: args.payrollSyncPoId === po.id,
  };
}

function mergedBundleAttachments(
  posRows: PurchaseOrder[],
  reviewByPoId: Map<string, PoMonthTimesheetReview>,
  bundleByPoId: Map<string, PoMonthTimesheetPhotoBundle>,
): TimesheetPoMonthToolbarAttachment[] {
  const out: TimesheetPoMonthToolbarAttachment[] = [];
  for (const po of posRows) {
    const r = reviewByPoId.get(po.id);
    const photoReadOnly = isAttachmentReadonly(r);
    const atts = photoReadOnly ? r?.timesheetPhotoAttachments ?? [] : bundleByPoId.get(po.id)?.attachments ?? [];
    for (const a of atts) {
      out.push({ ...a, sourcePoId: po.id, sourcePoCode: po.poCode ?? po.id });
    }
  }
  return out;
}

function buildBundlePoToolbarSnapshot(
  posRows: PurchaseOrder[],
  reviewByPoId: Map<string, PoMonthTimesheetReview>,
  bundleByPoId: Map<string, PoMonthTimesheetPhotoBundle>,
  args: {
    canEditTs: boolean;
    submittingPoId: string | null;
    uploadingPhotoPoId: string | null;
    payrollSyncPoId: string | null;
    currentUser: User | null;
    hasPayrollBatchForMonth: boolean;
  },
): TimesheetPoMonthToolbarSnapshot {
  const anchor = posRows[0]!;
  const poCodesLabel = posRows.map((p) => p.poCode ?? p.id).join(', ');
  const statuses = posRows.map((p) => reviewByPoId.get(p.id)?.status ?? null);
  const allSameStatus = statuses.every((s) => s === statuses[0]);
  const anyGated = statuses.some(
    (s) => s === 'entry_locked' || s === 'pending_manager_review' || s === 'approved',
  );
  const allGated = statuses.every(
    (s) => s === 'entry_locked' || s === 'pending_manager_review' || s === 'approved',
  );
  const reviewStatusLabel =
    allSameStatus && statuses[0] != null
      ? poReviewStatusLabel(statuses[0])
      : anyGated
        ? 'บาง PO ปิดงวดแล้ว'
        : 'ยังไม่ปิดงวด';

  const lockDisabled =
    !args.canEditTs ||
    !!args.submittingPoId ||
    allGated ||
    posRows.every((po) => {
      const r = reviewByPoId.get(po.id);
      return (
        !!r &&
        (r.status === 'entry_locked' || r.status === 'pending_manager_review' || r.status === 'approved')
      );
    });

  const canSendToManager = posRows.some((po) => {
    const r = reviewByPoId.get(po.id);
    return args.canEditTs && !!r && (r.status === 'entry_locked' || r.status === 'rejected');
  });

  const showUnlock =
    !!args.currentUser &&
    isSystemAdmin(args.currentUser) &&
    posRows.some((po) => {
      const r = reviewByPoId.get(po.id);
      return (
        !!r &&
        (r.status === 'entry_locked' || r.status === 'pending_manager_review' || r.status === 'approved')
      );
    });

  const canPayrollSync =
    !args.hasPayrollBatchForMonth &&
    posRows.some((po) => {
      const r = reviewByPoId.get(po.id);
      return (
        !!r &&
        (r.status === 'entry_locked' || r.status === 'pending_manager_review' || r.status === 'approved')
      );
    });

  const anchorR = reviewByPoId.get(anchor.id);
  const anchorReadOnly = isAttachmentReadonly(anchorR);

  return {
    poId: PO_ACTIVE_BUNDLE_TOOLBAR_ID,
    anchorPoId: anchor.id,
    poIds: posRows.map((p) => p.id),
    isBundle: true,
    poCode: poCodesLabel,
    poCodesLabel,
    projectName: [...new Set(posRows.map((p) => (p.projectName || '').trim()).filter(Boolean))].join(' · ') || undefined,
    reviewStatus: allSameStatus ? statuses[0] ?? null : null,
    reviewStatusLabel,
    lockDisabled,
    sendDisabled: !!args.submittingPoId || !canSendToManager,
    sendHidden: !canSendToManager,
    unlockHidden: !showUnlock,
    unlockDisabled: !!args.submittingPoId,
    attachDisabled: anchorReadOnly || !args.canEditTs || args.uploadingPhotoPoId === anchor.id,
    attachUploading: args.uploadingPhotoPoId === anchor.id,
    attachments: mergedBundleAttachments(posRows, reviewByPoId, bundleByPoId),
    busyPoId: args.submittingPoId,
    payrollSyncHidden: !canPayrollSync,
    payrollSyncDisabled: !args.canEditTs || !!args.payrollSyncPoId,
    payrollSyncBusy: !!args.payrollSyncPoId,
  };
}

export type TimesheetPoMonthPanelProps = {
  /** ฝังในหน้า wave-month — ไม่หุ้ม AppShell */
  embedded?: boolean;
  /** เดือนที่สอดคล้องกับตารางสรุปรายเดือน (เมื่อ embedded) */
  linkedMonthYm?: string;
  /** ชุด PO Active (ลูกค้า+โหมด) — ฝังใน wave-month ให้สอดคล้องตารางสรุป */
  linkedPoActiveBundleId?: string | null;
  /** PO ในชุดที่ wave-month กำลังแสดง — ปิดงวด/แนบไฟล์ให้ตรงกริด (ไม่บังคับ wave เปิดทับเดือน) */
  linkedScopedPoIds?: readonly string[];
  onLinkedMonthYmChange?: (ym: string) => void;
  /** wave-month: อัปเดตสถานะปิดงวด/แนบ — หนึ่งรายการต่อ PO ในงวด */
  onEmbeddedToolbarSnapshot?: (snapshots: TimesheetPoMonthToolbarSnapshot[]) => void;
};

/** สถานะปิดงวด/แนบไฟล์ต่อ PO+เดือน — wave-month แสดงหนึ่งการ์ดต่อ PO หรือหนึ่งการ์ดต่อชุด PO Active */
export type TimesheetPoMonthToolbarSnapshot = {
  poId: string;
  poCode: string;
  projectName?: string;
  reviewStatus: PoMonthTimesheetReview['status'] | null;
  reviewStatusLabel: string;
  lockDisabled: boolean;
  sendDisabled: boolean;
  sendHidden: boolean;
  unlockHidden: boolean;
  unlockDisabled: boolean;
  attachDisabled: boolean;
  attachUploading: boolean;
  attachments: TimesheetPoMonthToolbarAttachment[];
  busyPoId: string | null;
  /** แสดงปุ่มซิงก์พร้อมจ่าย — ซ่อนเมื่อมี Payroll Batch ของเดือนนี้แล้ว */
  payrollSyncHidden: boolean;
  payrollSyncDisabled: boolean;
  payrollSyncBusy: boolean;
  /** ชุด PO Active — การ์ดรวมหลาย PO */
  isBundle?: boolean;
  poIds?: string[];
  poCodesLabel?: string;
  /** PO หลักสำหรับแนบไฟล์รวม (เก็บที่เอกสาร PO แรกในชุด) */
  anchorPoId?: string;
};

export type TimesheetPoMonthPanelHandle = {
  lockPeriod: (poId: string) => void;
  openSubmitDialog: (poId: string) => void;
  openUnlockDialog: (poId: string) => void;
  openAttachPicker: (poId: string) => void;
  removePoAttachment: (poId: string, attId: string, storagePath: string) => void;
  syncPayrollReadyForPo: (poId: string) => void;
};

export const TimesheetPoMonthPanel = forwardRef<TimesheetPoMonthPanelHandle, TimesheetPoMonthPanelProps>(
  function TimesheetPoMonthPanel(
    {
      embedded = false,
      linkedMonthYm,
      linkedPoActiveBundleId,
      linkedScopedPoIds,
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
  const poActiveBundleIdRaw =
    linkedPoActiveBundleId ?? ((searchParams.get('poActiveBundleId') || '').trim() || null);
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
      if (embedded && linkedPoActiveBundleId) {
        p.set('poActiveBundleId', linkedPoActiveBundleId);
      }
      router.replace(`/timesheets/wave-month?${p.toString()}`);
    },
    [router, searchParams, monthYm, embedded, linkedPoActiveBundleId],
  );

  const [monthlyTimesheetNo, setMonthlyTimesheetNo] = useState<string | null>(null);
  const [monthlyDocLoading, setMonthlyDocLoading] = useState(false);
  const [periodEndByPo, setPeriodEndByPo] = useState<Record<string, string>>({});
  const [uploadingPhotoPoId, setUploadingPhotoPoId] = useState<string | null>(null);
  const [uploadingMonthlyPhoto, setUploadingMonthlyPhoto] = useState(false);
  const [monthlyStorageAttachments, setMonthlyStorageAttachments] = useState<WaveMonthTimesheetPhotoAttachment[]>([]);
  const [monthlyStorageLoading, setMonthlyStorageLoading] = useState(false);
  const [submittingPoId, setSubmittingPoId] = useState<string | null>(null);
  const [payrollSyncBusy, setPayrollSyncBusy] = useState(false);
  const [payrollSyncPoId, setPayrollSyncPoId] = useState<string | null>(null);
  const [portalParityBusy, setPortalParityBusy] = useState(false);
  const [submitDialogPo, setSubmitDialogPo] = useState<PurchaseOrder | null>(null);
  const [submitDialogBundle, setSubmitDialogBundle] = useState(false);
  const [submitQ1, setSubmitQ1] = useState(false);
  const [submitQ2, setSubmitQ2] = useState(false);
  const [unlockConfirmPo, setUnlockConfirmPo] = useState<PurchaseOrder | null>(null);
  const [unlockConfirmBundle, setUnlockConfirmBundle] = useState(false);

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
      setSubmitDialogBundle(false);
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
        ? query(
            collection(firestore, 'purchase_orders'),
            where('status', 'in', embedded ? ['pending', 'active'] : ['active']),
            limit(200),
          )
        : null,
    [firestore, canViewTs, embedded],
  );
  const { data: allPos, isLoading: posLoading } = useCollection<PurchaseOrder>(posQuery as any);

  const contractsQuery = useMemoFirebase(() => {
    if (!firestore || !canViewTs) return null;
    return query(
      collection(firestore, 'main_contracts'),
      where('status', 'in', [...PO_ACTIVE_MAIN_CONTRACT_STATUS_IN]),
    );
  }, [firestore, canViewTs]);
  const { data: activeContracts, isLoading: contractsLoading } = useCollection<MainContract>(contractsQuery as any);

  const workflowPos = useMemo(() => {
    if (contractsLoading || activeContracts === undefined) return [];
    const eligible = buildEligibleMainContractIdSet(activeContracts);
    return filterPoActiveWorkflowPurchaseOrders(allPos, eligible);
  }, [allPos, activeContracts, contractsLoading]);

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

  const payrollPeriodId = useMemo(
    () => (/^\d{4}-\d{2}$/.test(monthYm) ? workerPayrollPeriodIdForYearMonth(monthYm) : ''),
    [monthYm],
  );
  const payrollBatchesQuery = useMemoFirebase(
    () =>
      firestore && canViewTs && payrollPeriodId
        ? query(collection(firestore, 'payroll_batches'), where('payrollPeriodId', '==', payrollPeriodId))
        : null,
    [firestore, canViewTs, payrollPeriodId],
  );
  const { data: payrollBatchesForMonth } = useCollection<PayrollBatch>(payrollBatchesQuery as any);
  /** มี Batch จ่ายค่าจ้างของเดือนนี้แล้ว — ไม่โชว์ปุ่มซิงก์พร้อมจ่าย (กันงงหลังสร้าง Batch) */
  const hasPayrollBatchForMonth = useMemo(
    () => (payrollBatchesForMonth ?? []).some((b) => (Number(b.totalWorkers) || 0) > 0),
    [payrollBatchesForMonth],
  );
  const existingPayrollBatchId = useMemo(() => {
    const hit = (payrollBatchesForMonth ?? []).find((b) => (Number(b.totalWorkers) || 0) > 0);
    return hit?.id ?? null;
  }, [payrollBatchesForMonth]);

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

  const refreshMonthlyStorageAttachments = useCallback(async () => {
    if (!firebaseApp || !canViewTs || !/^\d{4}-\d{2}$/.test(monthYm)) {
      setMonthlyStorageAttachments([]);
      return;
    }
    setMonthlyStorageLoading(true);
    try {
      const list = await listMonthlyTimesheetPhotoAttachmentsFromStorage(firebaseApp, monthYm);
      setMonthlyStorageAttachments(list.slice(-MAX_MONTHLY_TIMESHEET_ATTACHMENTS));
    } catch (e: unknown) {
      console.error('[monthly-ts-photos] list from storage', e);
      setMonthlyStorageAttachments([]);
    } finally {
      setMonthlyStorageLoading(false);
    }
  }, [firebaseApp, canViewTs, monthYm]);

  useEffect(() => {
    void refreshMonthlyStorageAttachments();
  }, [refreshMonthlyStorageAttachments]);

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
    const ids = workflowPos
      .filter((p) => resolvePoActiveBundleKeyForPo(p) === filterPoActiveBundleId)
      .map((p) => p.id);
    return new Set(ids);
  }, [filterPoActiveBundleId, workflowPos]);

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
    if (embedded) return;
    if (!filterLocationKey || locShellsLoading) return;
    if (locationFilterOptions.length === 0) return;
    if (locationFilterOptions.some(([k]) => k === filterLocationKey)) return;
    replaceWaveMonthQuery((p) => {
      p.delete('locationKey');
    });
  }, [embedded, filterLocationKey, locationFilterOptions, locShellsLoading, replaceWaveMonthQuery]);

  const contractPosForShellEnsure = useMemo(
    () => workflowPos.filter((p) => purchaseOrderOverlapsYearMonth(p, monthYm)),
    [workflowPos, monthYm],
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
    const list = workflowPos.filter((po) => (allWaves ?? []).some((w) => w.poId === po.id));
    return list;
  }, [workflowPos, allWaves]);

  const linkedScopedPoIdSet = useMemo(() => {
    if (!embedded || !linkedScopedPoIds?.length) return null;
    return new Set(linkedScopedPoIds.filter(Boolean));
  }, [embedded, linkedScopedPoIds]);

  const posRows = useMemo(() => {
    /** wave-month ฝัง: ใช้ PO ในชุดเดียวกับตารางสรุป — mob/PO scope อาจมีข้อมูลโดยไม่มี wave เปิดทับเดือน */
    if (embedded && linkedScopedPoIdSet?.size) {
      const fromScope = workflowPos.filter(
        (po) => linkedScopedPoIdSet.has(po.id) && purchaseOrderOverlapsYearMonth(po, monthYm),
      );
      fromScope.sort((a, b) => (a.poCode ?? a.id).localeCompare(b.poCode ?? b.id, 'th'));
      const scoped =
        poIdsMatchingLocationFilter === null
          ? fromScope
          : fromScope.filter((po) => poIdsMatchingLocationFilter.has(po.id));
      if (scoped.length > 0) return scoped;
      /** PO มีข้อมูลในกริดแต่ช่วงสัญญาในเอกสารไม่ทับเดือน — ยังให้ปิดงวดได้ */
      const fallback = workflowPos.filter((po) => linkedScopedPoIdSet.has(po.id));
      if (fallback.length > 0) {
        fallback.sort((a, b) => (a.poCode ?? a.id).localeCompare(b.poCode ?? b.id, 'th'));
        return fallback;
      }
    }

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
    embedded,
    linkedScopedPoIdSet,
    workflowPos,
    posWithWaves,
    allWaves,
    monthYm,
    filterLocationKey,
    poIdsMatchingLocationFilter,
    filterPoActiveBundleId,
    bundlePoIdSet,
  ]);

  /** หลาย PO ในชุด PO Active — ปิดงวด/แนบไฟล์รวมการ์ดเดียว */
  const bundleToolbarMode = useMemo(() => {
    if (embedded && linkedPoActiveBundleId && posRows.length > 0) return true;
    if (posRows.length <= 1) return false;
    if (embedded) return (linkedScopedPoIds?.length ?? 0) > 1;
    return !!filterPoActiveBundleId;
  }, [posRows.length, embedded, linkedPoActiveBundleId, linkedScopedPoIds, filterPoActiveBundleId]);

  const anchorPo = useMemo(() => posRows[0] ?? null, [posRows]);

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
    if (embedded) return;
    if (posRows.length === 0) return;
    if (highlightPo && posRows.some((p) => p.id === highlightPo)) return;
    replaceWaveMonthQuery((p) => {
      p.set('highlightPo', posRows[0].id);
    });
  }, [embedded, posRows, highlightPo, replaceWaveMonthQuery]);

  const relatedWaveIdsFor = useCallback(
    (poId: string) => {
      const inMonth = (allWaves ?? [])
        .filter((w) => w.poId === poId && waveTouchesMonth(w, monthYm))
        .map((w) => w.id);
      if (inMonth.length > 0) return inMonth;
      return (allWaves ?? []).filter((w) => w.poId === poId).map((w) => w.id);
    },
    [allWaves, monthYm],
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
    async (
      po: PurchaseOrder,
      status: PoMonthTimesheetReview['status'],
      opts?: { silentOutcomeToast?: boolean },
    ) => {
      if (!firestore || !currentUser || !canEditTs) return;
      const { periodStartDate, periodEndDate } = getPeriodBounds(po.id);
      if (periodEndDate < periodStartDate) {
        toast({ variant: 'destructive', title: 'ช่วงวันที่ไม่ถูกต้อง', description: 'วันสุดท้ายต้องไม่ก่อนวันต้นเดือน' });
        return;
      }
      if (!opts?.silentOutcomeToast) {
        setSubmittingPoId(po.id);
      }
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
          const bundleRef = doc(firestore, 'po_month_timesheet_photo_bundles', id);
          const bundleSnap = await getDoc(bundleRef);
          base.timesheetPhotoAttachments = bundleSnap.exists()
            ? ((bundleSnap.data() as PoMonthTimesheetPhotoBundle).attachments ?? [])
            : [];
        }
        await setDoc(ref, base, { merge: true });
        if (status === 'entry_locked' && !opts?.silentOutcomeToast) {
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
                ? `แก้รายวันไม่ได้ — ตั้งพร้อมจ่าย ${readyCount} ใบงาน — ครอบคลุม ${syncedPos} PO ที่ทับเดือน (เอกสารปิดงวดในเดือนนี้ ${gatedDocs} ฉบับ) · ไปทำ Payroll ได้ทันทีโดยไม่ต้องรอผู้จัดการอนุมัติ timesheet · กด «ส่งอนุมัติ Timesheet เพื่อออกใบวางบิล» เมื่อต้องการส่งคิวผู้จัดการเพื่อ Invoice`
                : 'แก้รายวันไม่ได้เมื่อเอกสารถูกปิดงวด — หาก payroll ยังไม่เห็นคน ให้กด «ซิงก์พร้อมจ่าย» ที่การ์ด PO · กด «ส่งอนุมัติ Timesheet เพื่อออกใบวางบิล» เมื่อต้องการส่งผู้จัดการ',
          });
        } else if (status === 'pending_manager_review' && !opts?.silentOutcomeToast) {
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
            title: 'ส่งอนุมัติ Timesheet เพื่อออกใบวางบิลแล้ว',
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
        if (!opts?.silentOutcomeToast) {
          setSubmittingPoId(null);
        }
      }
    },
    [firestore, currentUser, canEditTs, monthYm, getPeriodBounds, relatedWaveIdsFor, toast, firebaseApp],
  );

  const lockAllPosInBundle = useCallback(async () => {
    if (!canEditTs || posRows.length === 0) return;
    const toLock = posRows.filter((po) => {
      const r = reviewByPoId.get(po.id);
      return !(
        r &&
        (r.status === 'entry_locked' || r.status === 'pending_manager_review' || r.status === 'approved')
      );
    });
    if (toLock.length === 0) {
      toast({
        variant: 'destructive',
        title: 'ปิดงวดไม่ได้',
        description: 'ทุก PO ในชุดนี้ปิดงวดแล้ว',
      });
      return;
    }
    setSubmittingPoId(PO_ACTIVE_BUNDLE_TOOLBAR_ID);
    try {
      for (const po of toLock) {
        await writePoMonthReview(po, 'entry_locked', { silentOutcomeToast: true });
      }
      let readyCount = 0;
      let gatedDocs = 0;
      let syncedPos = 0;
      if (firestore) {
        try {
          const sync = await syncReadyPayrollFlagsForYearMonthFromAllGatedPoMonthReviews(firestore, monthYm);
          readyCount = sync.updated;
          gatedDocs = sync.gatedPoCount;
          syncedPos = sync.syncedPoCount;
          if (currentUser) {
            const actorName = currentUser.displayName || currentUser.email || currentUser.id;
            await ensureWorkerMonthlyPayrollPeriodForYearMonth(firestore, monthYm, actorName);
          }
        } catch (e) {
          console.error('[po-month] payroll bridge after bundle lock', e);
        }
      }
      toast({
        title: 'ปิดงวดชุด PO Active แล้ว',
        description: `ปิดงวด ${toLock.length} PO (${toLock.map((p) => p.poCode).join(', ')}) · ${
          readyCount > 0
            ? `ตั้งพร้อมจ่าย ${readyCount} ใบงาน (ครอบคลุม ${syncedPos} PO · เอกสารปิดงวด ${gatedDocs} ฉบับ)`
            : 'ตรวจ payroll อีกครั้งถ้ายังไม่เห็นคน'
        }`,
      });
    } finally {
      setSubmittingPoId(null);
    }
  }, [canEditTs, posRows, reviewByPoId, writePoMonthReview, firestore, monthYm, currentUser, toast]);

  const submitAllPosInBundle = useCallback(async () => {
    if (!canEditTs) return;
    const toSubmit = posRows.filter((po) => {
      const r = reviewByPoId.get(po.id);
      return !!r && (r.status === 'entry_locked' || r.status === 'rejected');
    });
    if (toSubmit.length === 0) {
      toast({
        variant: 'destructive',
        title: 'ส่งอนุมัติไม่ได้',
        description: 'ต้องปิดงวดทุก PO ในชุดก่อน',
      });
      return;
    }
    setSubmittingPoId(PO_ACTIVE_BUNDLE_TOOLBAR_ID);
    try {
      for (const po of toSubmit) {
        await writePoMonthReview(po, 'pending_manager_review', { silentOutcomeToast: true });
      }
      toast({
        title: 'ส่งอนุมัติ Timesheet ชุด PO Active เพื่อออกใบวางบิลแล้ว',
        description: `ส่ง ${toSubmit.length} PO (${toSubmit.map((p) => p.poCode).join(', ')}) — รอผู้จัดการที่เมนูอนุมัติ`,
      });
      setSubmitDialogPo(null);
      setSubmitDialogBundle(false);
    } finally {
      setSubmittingPoId(null);
    }
  }, [canEditTs, posRows, reviewByPoId, writePoMonthReview, toast]);

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

  const unlockAllPosInBundle = useCallback(async () => {
    if (!firestore || !currentUser || !isSystemAdmin(currentUser)) return;
    const toUnlock = posRows.filter((po) => {
      const r = reviewByPoId.get(po.id);
      return (
        !!r &&
        (r.status === 'entry_locked' || r.status === 'pending_manager_review' || r.status === 'approved')
      );
    });
    if (toUnlock.length === 0) return;
    setSubmittingPoId(PO_ACTIVE_BUNDLE_TOOLBAR_ID);
    let clearedTotal = 0;
    try {
      for (const po of toUnlock) {
        const row = reviewByPoId.get(po.id);
        if (!row) continue;
        const id = poMonthTimesheetReviewDocId(po.id, monthYm);
        const now = Date.now();
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
        clearedTotal += cleared.updated;
      }
      toast({
        title: 'ปลดล็อกชุด PO Active แล้ว (Admin)',
        description: `ปลดล็อก ${toUnlock.length} PO (${toUnlock.map((p) => p.poCode).join(', ')}) · ล้างธง ${clearedTotal} รายการ`,
      });
      setUnlockConfirmPo(null);
      setUnlockConfirmBundle(false);
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'ปลดล็อกไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSubmittingPoId(null);
    }
  }, [firestore, currentUser, posRows, reviewByPoId, monthYm, toast]);

  const runPayrollSyncForPo = useCallback(
    async (poId: string) => {
      if (!firestore || !currentUser || !canEditTs || !/^\d{4}-\d{2}$/.test(monthYm)) return;
      setPayrollSyncPoId(poId);
      try {
        const { updated } = await syncReadyPayrollFlagsForPoMonth(firestore, poId, monthYm);
        const actor = currentUser.displayName || currentUser.email || currentUser.id;
        await ensureWorkerMonthlyPayrollPeriodForYearMonth(firestore, monthYm, actor);
        toast({
          title: 'ซิงก์พร้อมจ่ายแล้ว',
          description:
            updated > 0
              ? `ตั้ง readyForPayroll ให้ ${updated} ใบงานของ PO นี้ — ไปเมนู งวดจ่ายลูกจ้าง แล้ว Pre-check / สร้าง Batch`
              : 'ไม่พบใบงานรายวันในเดือนนี้ให้ตั้งค่า — ตรวจว่ามีลงเวลาในตารางสรุปแล้ว',
        });
      } catch (e: unknown) {
        toast({
          variant: 'destructive',
          title: 'ซิงก์ไม่สำเร็จ',
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setPayrollSyncPoId(null);
      }
    },
    [firestore, currentUser, canEditTs, monthYm, toast],
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
      if (!firebaseApp || !/^\d{4}-\d{2}$/.test(monthYm)) return;
      if (monthlyStorageAttachments.length >= MAX_MONTHLY_TIMESHEET_ATTACHMENTS) {
        toast({
          variant: 'destructive',
          title: 'เต็มจำนวนแนบ',
          description: `แนบได้สูงสุด ${MAX_MONTHLY_TIMESHEET_ATTACHMENTS} ไฟล์ — ลบบางรายก่อนเพิ่ม`,
        });
        return;
      }
      setUploadingMonthlyPhoto(true);
      try {
        await uploadMonthlyTimesheetPhoto(firebaseApp, monthYm, file);
        await refreshMonthlyStorageAttachments();
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
    [firebaseApp, monthYm, monthlyStorageAttachments.length, refreshMonthlyStorageAttachments, toast],
  );

  const removeMonthlyPhoto = useCallback(
    async (attId: string, storagePath: string) => {
      if (!firebaseApp || !/^\d{4}-\d{2}$/.test(monthYm)) return;
      setUploadingMonthlyPhoto(true);
      try {
        await deleteMonthlyTimesheetPhotoFile(firebaseApp, storagePath);
        await refreshMonthlyStorageAttachments();
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
    [firebaseApp, monthYm, refreshMonthlyStorageAttachments, toast],
  );

  useImperativeHandle(
    ref,
    () => ({
      lockPeriod: (poId: string) => {
        if (poId === PO_ACTIVE_BUNDLE_TOOLBAR_ID || (bundleToolbarMode && poId === anchorPo?.id)) {
          void lockAllPosInBundle();
          return;
        }
        const po = posRows.find((p) => p.id === poId);
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
      openSubmitDialog: (poId: string) => {
        if (poId === PO_ACTIVE_BUNDLE_TOOLBAR_ID || (bundleToolbarMode && poId === anchorPo?.id)) {
          const canSendAny = posRows.some((p) => {
            const r = reviewByPoId.get(p.id);
            return canEditTs && !!r && (r.status === 'entry_locked' || r.status === 'rejected');
          });
          if (!canSendAny) {
            toast({
              variant: 'destructive',
              title: 'ส่งอนุมัติ Timesheet ไม่ได้',
              description: 'ต้องปิดงวดทุก PO ในชุดก่อน',
            });
            return;
          }
          setSubmitDialogBundle(true);
          setSubmitDialogPo(anchorPo);
          return;
        }
        const po = posRows.find((p) => p.id === poId);
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
        setSubmitDialogBundle(false);
        setSubmitDialogPo(po);
      },
      openUnlockDialog: (poId: string) => {
        if (!currentUser) return;
        if (!isSystemAdmin(currentUser)) {
          toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'เฉพาะ System Administrator เท่านั้น' });
          return;
        }
        if (poId === PO_ACTIVE_BUNDLE_TOOLBAR_ID || (bundleToolbarMode && poId === anchorPo?.id)) {
          setUnlockConfirmBundle(true);
          setUnlockConfirmPo(anchorPo);
          return;
        }
        const po = posRows.find((p) => p.id === poId);
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
        setUnlockConfirmBundle(false);
        setUnlockConfirmPo(po);
      },
      openAttachPicker: (poId: string) => {
        if (!/^\d{4}-\d{2}$/.test(monthYm)) return;
        const targetId =
          poId === PO_ACTIVE_BUNDLE_TOOLBAR_ID || bundleToolbarMode ? anchorPo?.id ?? poId : poId;
        document.getElementById(`pom-file-${targetId}`)?.click();
      },
      removePoAttachment: (poId: string, attId: string, storagePath: string) => {
        const po = posRows.find((p) => p.id === poId);
        if (!po) return;
        void removePhoto(po, attId, storagePath);
      },
      syncPayrollReadyForPo: (poId: string) => {
        if (poId === PO_ACTIVE_BUNDLE_TOOLBAR_ID || bundleToolbarMode) {
          void runPayrollSyncForMonth();
          return;
        }
        void runPayrollSyncForPo(poId);
      },
    }),
    [
      posRows,
      bundleToolbarMode,
      anchorPo,
      lockAllPosInBundle,
      reviewByPoId,
      canEditTs,
      submittingPoId,
      toast,
      writePoMonthReview,
      currentUser,
      monthYm,
      removePhoto,
      runPayrollSyncForPo,
      runPayrollSyncForMonth,
    ],
  );

  useEffect(() => {
    if (!embedded) {
      onEmbeddedToolbarSnapshot?.([]);
      return;
    }
    const snapshots =
      bundleToolbarMode && posRows.length > 0
        ? [
            buildBundlePoToolbarSnapshot(posRows, reviewByPoId, bundleByPoId, {
              canEditTs,
              submittingPoId,
              uploadingPhotoPoId,
              payrollSyncPoId,
              currentUser,
              hasPayrollBatchForMonth,
            }),
          ]
        : posRows.map((po) =>
            buildPoToolbarSnapshot(po, reviewByPoId.get(po.id), bundleByPoId.get(po.id), {
              canEditTs,
              submittingPoId,
              uploadingPhotoPoId,
              payrollSyncPoId,
              currentUser,
              hasPayrollBatchForMonth,
            }),
          );
    onEmbeddedToolbarSnapshot?.(snapshots);
  }, [
    embedded,
    bundleToolbarMode,
    posRows,
    reviewByPoId,
    bundleByPoId,
    canEditTs,
    submittingPoId,
    uploadingPhotoPoId,
    payrollSyncPoId,
    currentUser,
    hasPayrollBatchForMonth,
    onEmbeddedToolbarSnapshot,
  ]);

  const bundleToolbarSnap = useMemo(() => {
    if (!bundleToolbarMode || posRows.length === 0) return null;
    return buildBundlePoToolbarSnapshot(posRows, reviewByPoId, bundleByPoId, {
      canEditTs,
      submittingPoId,
      uploadingPhotoPoId,
      payrollSyncPoId,
      currentUser,
      hasPayrollBatchForMonth,
    });
  }, [
    bundleToolbarMode,
    posRows,
    reviewByPoId,
    bundleByPoId,
    canEditTs,
    submittingPoId,
    uploadingPhotoPoId,
    payrollSyncPoId,
    currentUser,
    hasPayrollBatchForMonth,
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
      {embedded && /^\d{4}-\d{2}$/.test(monthYm)
        ? (bundleToolbarMode && anchorPo
            ? (
              <input
                key={anchorPo.id}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="hidden"
                id={`pom-file-${anchorPo.id}`}
                disabled={
                  isAttachmentReadonly(reviewByPoId.get(anchorPo.id)) ||
                  !canEditTs ||
                  uploadingPhotoPoId === anchorPo.id
                }
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void appendPhoto(anchorPo, f);
                }}
              />
            )
            : posRows.map((po) => {
            const r = reviewByPoId.get(po.id);
            const photoReadOnly = isAttachmentReadonly(r);
            return (
              <input
                key={po.id}
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
            );
          }))
        : null}
      {!embedded ? (
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
                'กด ส่งอนุมัติ Timesheet เพื่อออกใบวางบิล ให้ผู้จัดการ (เมนู HR) — หลังอนุมัติใช้เป็นฐานออก Invoice · จ่ายค่าจ้างคนละคิวที่เมนูงวดจ่ายลูกจ้าง',
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
          <Button
            type="button"
            variant="secondary"
            className="gap-1"
            onClick={() => {
              const prev = document.title;
              document.title = sanitizePrintFileBaseName(`timesheet-po-month-${monthYm}`);
              window.print();
              window.setTimeout(() => {
                document.title = prev;
              }, 0);
            }}
          >
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

        {!embedded ? (
        <Card className="print:shadow-none print:border print:break-inside-auto">
          <CardHeader className="print:py-2 space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <CardTitle className="text-base">
                  {bundleToolbarMode ? 'ชุด PO Active + เอกสาร' : 'PO ที่เปิด wave ในงวดนี้ + เอกสาร'}
                </CardTitle>
                <CardDescription>
                  {bundleToolbarMode ? (
                    <>
                      ปิดงวด / แนบไฟล์รวมทั้งชุด — PO:{' '}
                      <span className="font-mono">{posRows.map((p) => p.poCode).join(', ')}</span>
                    </>
                  ) : (
                    <>
                      เฉพาะ PO ที่มี wave และ (ช่วง wave ทับเดือนที่เลือก หรือเมื่อกรองสถานที่ — มีหัวงวดสถานที่ในเดือนนี้และ PO ทับเดือนปฏิทิน)
                      {filterLocationKey ? (
                        <span className="block mt-1 text-emerald-900 font-medium">
                          กรองเฉพาะ PO ที่มีหัวงวดสถานที่นี้ในเดือนนี้ — เหลือ {posRows.length} การ์ด
                        </span>
                      ) : null}
                    </>
                  )}
                </CardDescription>
              </div>
              {hasPayrollBatchForMonth && existingPayrollBatchId ? (
                <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1.5" asChild>
                  <Link href={`/payroll/batches/${existingPayrollBatchId}`}>
                    มี Payroll Batch แล้ว — เปิดงวดจ่าย
                  </Link>
                </Button>
              ) : (
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
              )}
            </div>
            <p className="text-xs text-muted-foreground rounded-md border border-dashed border-amber-300/60 bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2">
              {hasPayrollBatchForMonth ? (
                <>
                  <strong className="text-foreground">มี Payroll Batch ของเดือนนี้แล้ว</strong>
                  {' — '}ปุ่มซิงก์พร้อมจ่ายถูกซ่อนเพื่อไม่ให้ซ้ำ · ตรวจ/ส่งขออนุมัติจ่ายที่เมนู{' '}
                  <span className="font-semibold">การจ่ายค่าจ้าง → งวดจ่ายลูกจ้าง</span>
                  {' · '}ปุ่ม「ส่งอนุมัติ Timesheet เพื่อออกใบวางบิล」ด้านล่างเป็นคนละคิว (ผู้จัดการตรวจ timesheet → Invoice)
                </>
              ) : (
                <>
                  <strong className="text-foreground">ปิดงวดสร้าง Payroll แล้ว — ปุ่มปิดงวดถูกปิดใช้ตามปกติ</strong>
                  เมื่อมีอย่างน้อยหนึ่ง PO+เดือนที่ปิดงวดในเดือนนี้ การกด{' '}
                  <span className="font-semibold">ซิงก์พร้อมจ่ายทั้งเดือน</span> จะตั้งพร้อมจ่ายให้ทุก PO active ที่ทับเดือนปฏิทิน — ไม่ต้องล็อกทุก PO — แล้วไป{' '}
                  <span className="font-semibold">การจ่ายค่าจ้าง → งวดจ่ายลูกจ้าง</span> เพื่อ Pre-check / สร้าง Batch
                </>
              )}
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
                {bundleToolbarMode && bundleToolbarSnap && anchorPo ? (
                  <div className="rounded-lg border bg-card p-4 space-y-3 print:break-inside-avoid ring-2 ring-primary/20">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="font-mono font-bold text-sm">{bundleToolbarSnap.poCodesLabel}</div>
                        <div className="text-sm text-muted-foreground">ชุด PO Active · {posRows.length} ใบ</div>
                      </div>
                      <span className="text-xs font-semibold">{bundleToolbarSnap.reviewStatusLabel}</span>
                    </div>
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">วันสุดท้ายของงวดปิด (ทุก PO ในชุด)</Label>
                        <Input
                          type="date"
                          className="h-9 w-[180px] font-mono"
                          min={`${monthYm}-01`}
                          max={lastDayOfCalendarMonth(monthYm)}
                          value={periodEndByPo[anchorPo.id] ?? lastDayOfCalendarMonth(monthYm)}
                          onChange={(e) => {
                            const v = e.target.value;
                            setPeriodEndByPo((prev) => {
                              const next = { ...prev };
                              for (const p of posRows) next[p.id] = v;
                              return next;
                            });
                          }}
                          disabled={bundleToolbarSnap.attachDisabled && bundleToolbarSnap.lockDisabled}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="gap-1"
                        disabled={bundleToolbarSnap.lockDisabled}
                        onClick={() => void lockAllPosInBundle()}
                      >
                        {submittingPoId === PO_ACTIVE_BUNDLE_TOOLBAR_ID ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Lock className="h-3.5 w-3.5" />
                        )}
                        ปิดงวดสร้าง Payroll
                      </Button>
                      {!bundleToolbarSnap.sendHidden ? (
                        <Button
                          type="button"
                          size="sm"
                          className="gap-1"
                          disabled={bundleToolbarSnap.sendDisabled}
                          onClick={() => {
                            setSubmitDialogBundle(true);
                            setSubmitDialogPo(anchorPo);
                          }}
                        >
                          <Send className="h-3.5 w-3.5" />
                          ส่งอนุมัติ Timesheet เพื่อออกใบวางบิล
                        </Button>
                      ) : null}
                    </div>
                    <div className="border-t border-dashed pt-3 space-y-2">
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        className="hidden"
                        id={`pom-file-${anchorPo.id}`}
                        disabled={bundleToolbarSnap.attachDisabled}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = '';
                          if (f) void appendPhoto(anchorPo, f);
                        }}
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={bundleToolbarSnap.attachDisabled}
                          onClick={() => document.getElementById(`pom-file-${anchorPo.id}`)?.click()}
                        >
                          {bundleToolbarSnap.attachUploading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <ImagePlus className="h-3.5 w-3.5" />
                          )}
                          แนบรูป / PDF
                        </Button>
                        <span className="text-xs text-muted-foreground">
                          แนบรวมชุด PO Active · สูงสุด {MAX_PO_MONTH_ATTACHMENTS} ไฟล์
                        </span>
                      </div>
                      {bundleToolbarSnap.attachments.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {bundleToolbarSnap.attachments.map((att) => (
                            <div key={`${att.sourcePoId ?? ''}-${att.id}`} className="relative">
                              {isWaveMonthAttachmentPdf(att) ? (
                                <a href={att.downloadUrl} target="_blank" rel="noopener noreferrer" className="flex h-16 w-16 flex-col items-center justify-center rounded border bg-muted/50 text-[9px]">
                                  <FileIcon className="h-6 w-6 text-primary" />
                                  <span>PDF</span>
                                </a>
                              ) : (
                                <a href={att.downloadUrl} target="_blank" rel="noopener noreferrer" className="block">
                                  <img src={att.downloadUrl} alt={att.fileName} className="h-16 w-16 rounded border object-cover" />
                                </a>
                              )}
                              {!bundleToolbarSnap.attachDisabled && att.sourcePoId ? (
                                <button
                                  type="button"
                                  className="absolute -right-1 -top-1 rounded-full bg-destructive p-0.5 text-destructive-foreground shadow"
                                  onClick={() => {
                                    const po = posRows.find((p) => p.id === att.sourcePoId);
                                    if (po) void removePhoto(po, att.id, att.storagePath);
                                  }}
                                  aria-label="ลบ"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">ยังไม่มีไฟล์แนบสำหรับชุด PO นี้</p>
                      )}
                    </div>
                  </div>
                ) : (
                posRows.map((po) => {
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
                            ส่งอนุมัติ Timesheet เพื่อออกใบวางบิล
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
                })
                )}
              </div>
            )}
          </CardContent>
        </Card>
        ) : null}
      </div>
      ) : null}

      <Dialog
        open={!!submitDialogPo}
        onOpenChange={(o) => {
          if (!o) {
            setSubmitDialogPo(null);
            setSubmitDialogBundle(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>ยืนยันส่งอนุมัติ Timesheet เพื่อออกใบวางบิล</DialogTitle>
            <DialogDescription>
              เลขเอกสารรายเดือน:{' '}
              <span className="font-mono font-semibold text-foreground">{monthlyTimesheetNo ?? '—'}</span>
              {' · '}
              งวด {monthYm} — คิวนี้ออกใบวางบิล/Invoice ตาม SB/W หลังผู้จัดการอนุมัติ{' '}
              <strong className="text-foreground">ไม่ใช่</strong> คิวอนุมัติจ่ายค่าจ้าง (จ่ายค่าจ้างอยู่ที่เมนูงวดจ่ายลูกจ้าง)
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
              disabled={
                !submitQ1 ||
                !submitQ2 ||
                !submitDialogPo ||
                submittingPoId === submitDialogPo.id ||
                submittingPoId === PO_ACTIVE_BUNDLE_TOOLBAR_ID
              }
              onClick={() => {
                if (!submitDialogPo) return;
                if (submitDialogBundle) {
                  void submitAllPosInBundle();
                  return;
                }
                const po = submitDialogPo;
                void writePoMonthReview(po, 'pending_manager_review').then(() => setSubmitDialogPo(null));
              }}
            >
              {(submitDialogPo &&
                (submittingPoId === submitDialogPo.id || submittingPoId === PO_ACTIVE_BUNDLE_TOOLBAR_ID)) ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}{' '}
              ยืนยันส่งอนุมัติ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!unlockConfirmPo}
        onOpenChange={(o) => {
          if (!o) {
            setUnlockConfirmPo(null);
            setUnlockConfirmBundle(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>ปลดล็อกงวด PO+เดือน (System Admin)</DialogTitle>
            <DialogDescription>
              {unlockConfirmPo ? (
                unlockConfirmBundle ? (
                  <>
                    ชุด PO Active:{' '}
                    <span className="font-mono font-semibold">{posRows.map((p) => p.poCode).join(', ')}</span>
                    <span> · งวด {monthYm}</span>
                  </>
                ) : (
                  <>
                    <span className="font-mono font-semibold">{unlockConfirmPo.poCode}</span>
                    <span> · งวด {monthYm}</span>
                  </>
                )
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
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setUnlockConfirmPo(null);
                setUnlockConfirmBundle(false);
              }}
            >
              ยกเลิก
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="gap-2"
              disabled={
                !unlockConfirmPo ||
                submittingPoId === unlockConfirmPo.id ||
                submittingPoId === PO_ACTIVE_BUNDLE_TOOLBAR_ID
              }
              onClick={() => {
                if (!unlockConfirmPo) return;
                if (unlockConfirmBundle) {
                  void unlockAllPosInBundle();
                  return;
                }
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
