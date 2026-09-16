'use client';

import { Fragment, useState, useMemo, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, FileText, Building2, Loader2, ChevronRight, ExternalLink, RefreshCw, Ban, Trash2, Printer } from 'lucide-react';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { Input } from '@/components/ui/input';
import { formatStoredDateThaiBE } from '@/lib/date-thai';
import {
  buildYearCeOptions,
  currentMonthMm,
  currentYearCe,
  ymMatchesYearMonthScope,
} from '@/lib/date/year-month-scope-filter';
import { YearMonthScopeSelects } from '@/components/accounting/year-month-scope-selects';
import {
  buildCommercialInvoiceListPrintHtml,
  capCommercialInvoiceListPrintRows,
  describeCommercialInvoiceListPrintFilters,
  type CommercialInvoiceListPrintRow,
} from '@/lib/documents/commercial-invoice-list-print';
import { openStandardPrintWindow } from '@/lib/documents/standard-document-print';
import {
  CommercialInvoice,
  Customer,
  MainContract,
  PoMonthTimesheetReview,
  PurchaseOrder,
  Wave,
  WaveMonthTimesheetReview,
} from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canView, canCreate, isSystemAdmin } from '@/lib/permissions';
import {
  documentCreatorDisplayName,
  filterToOwnCreatedDocuments,
} from '@/lib/documents/own-created-list';
import { canManageDocumentShare } from '@/lib/documents/document-share';
import { DocumentShareListMarker } from '@/components/documents/document-share-controls';
import { isSimpleAdmin } from '@/lib/simple-tier-model';
import { collection, query, orderBy, where } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
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
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getPreviewPattern } from '@/lib/services/numbering-service';
import {
  createCommercialDraftInvoice,
  createCommercialDraftFromQuotationPoLines,
  ensureCommercialDraftInvoiceAfterMonthApproval,
  ensureCommercialDraftInvoiceAfterPoMonthApproval,
  filterWaveMonthReviewsMissingCommercialDraft,
  filterPoMonthReviewsMissingCommercialDraft,
  voidCommercialInvoice,
  deleteCommercialInvoice,
  ensureCommercialDraftInvoiceForWorkerSet,
  QUOTATION_PO_WAVE_PLACEHOLDER,
  PO_MONTH_WAVE_PLACEHOLDER,
} from '@/lib/services/commercial-invoice-service';
import { EQUIPMENT_RENTAL_WAVE_PLACEHOLDER } from '@/lib/services/equipment-rental-contract-service';
import {
  isPartialPoMonthCommercialInvoice,
  listPartialBillingCandidates,
  type PartialBillingCandidate,
} from '@/lib/commercial/partial-po-month-billing';
import { fetchWorkerClosuresForPoMonth } from '@/lib/timesheet/worker-month-closure';
import type { WorkerMonthTimesheetClosure } from '@/lib/types';
import { resolvePoMonthPeriodBounds } from '@/lib/timesheet/po-month-timesheet-bridge';
import { timestampToHtmlDateValue } from '@/lib/date-thai';
import Link from 'next/link';
import { resolvePoActiveBundleKeyForPo } from '@/lib/ops/po-active-bundle';
import {
  groupRowsByPoActiveBundle,
  poActiveBundleWorkModeShortLabel,
} from '@/lib/ops/po-active-bundle-grouping';
import { resolveBillingModeFromMaps } from '@/lib/commercial/resolve-billing-mode';
import {
  commercialInvoiceRevisionNoOf,
  isCommercialInvoiceSuperseded,
  parseCommercialInvoiceBaseNo,
} from '@/lib/commercial/commercial-invoice-revision';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

function invoiceShowsRevised(
  inv: CommercialInvoice,
  list: readonly CommercialInvoice[] = [],
): boolean {
  if (inv.status === 'REVISED' || isCommercialInvoiceSuperseded(inv)) return true;
  const base = parseCommercialInvoiceBaseNo(inv.invoiceNo);
  if (!base) return false;
  const rev = commercialInvoiceRevisionNoOf(inv);
  return list.some(
    (other) =>
      other.id !== inv.id &&
      other.status !== 'VOID' &&
      parseCommercialInvoiceBaseNo(other.invoiceNo) === base &&
      commercialInvoiceRevisionNoOf(other) > rev,
  );
}

function statusBadge(inv: CommercialInvoice, revised = false) {
  const status = inv.status;
  if (revised || status === 'REVISED' || isCommercialInvoiceSuperseded(inv)) {
    return <Badge className="h-5 bg-slate-600 px-1.5 text-[11px] leading-none">Revised</Badge>;
  }
  if (status === 'PENDING_CUSTOMER' && inv.customerRevisionRequestedAt) {
    return <Badge className="h-5 bg-orange-700 px-1.5 text-[11px] leading-none">ร้องขอแก้ไข</Badge>;
  }
  switch (status) {
    case 'DRAFT':
      return <Badge variant="secondary" className="h-5 px-1.5 text-[11px] leading-none">ตรวจภายใน</Badge>;
    case 'PENDING_CUSTOMER':
      return <Badge className="h-5 bg-amber-600 px-1.5 text-[11px] leading-none">รอลูกค้า</Badge>;
    case 'ISSUED':
      return <Badge className="h-5 bg-green-600 px-1.5 text-[11px] leading-none">ยืนยันแล้ว</Badge>;
    case 'VOID':
      return <Badge variant="outline" className="h-5 px-1.5 text-[11px] leading-none">ยกเลิก</Badge>;
    default:
      return <Badge variant="outline" className="h-5 px-1.5 text-[11px] leading-none">{status}</Badge>;
  }
}

function commercialStatusPrintLabel(inv: CommercialInvoice, revised = false): string {
  if (revised || inv.status === 'REVISED' || isCommercialInvoiceSuperseded(inv)) return 'Revised';
  if (inv.status === 'PENDING_CUSTOMER' && inv.customerRevisionRequestedAt) return 'ร้องขอแก้ไข';
  switch (inv.status) {
    case 'DRAFT':
      return 'ตรวจภายใน';
    case 'PENDING_CUSTOMER':
      return 'รอลูกค้า';
    case 'ISSUED':
      return 'ยืนยันแล้ว';
    case 'VOID':
      return 'ยกเลิก';
    default:
      return inv.status;
  }
}

type InvoiceListStatusFilter =
  | 'all'
  | 'draft'
  | 'revised'
  | 'pending_customer'
  | 'revision_requested'
  | 'issued'
  | 'void';

const INVOICE_STATUS_FILTER_OPTIONS: { value: InvoiceListStatusFilter; label: string }[] = [
  { value: 'all', label: 'ทุกสถานะ' },
  { value: 'draft', label: 'ตรวจภายใน' },
  { value: 'revised', label: 'Revised' },
  { value: 'pending_customer', label: 'รอลูกค้า' },
  { value: 'revision_requested', label: 'ร้องขอแก้ไข' },
  { value: 'issued', label: 'ยืนยันแล้ว' },
  { value: 'void', label: 'ยกเลิก' },
];

function invoiceListStatusKey(
  inv: CommercialInvoice,
  revised = false,
): Exclude<InvoiceListStatusFilter, 'all'> {
  if (revised || inv.status === 'REVISED' || isCommercialInvoiceSuperseded(inv)) return 'revised';
  if (inv.status === 'PENDING_CUSTOMER' && inv.customerRevisionRequestedAt) return 'revision_requested';
  if (inv.status === 'PENDING_CUSTOMER') return 'pending_customer';
  if (inv.status === 'ISSUED') return 'issued';
  if (inv.status === 'VOID') return 'void';
  return 'draft';
}

function commercialWavePeriodLabel(inv: CommercialInvoice): string {
  if (inv.waveId === EQUIPMENT_RENTAL_WAVE_PLACEHOLDER || inv.equipmentRentalContractId) {
    return inv.equipmentRentalPeriodMonth
      ? `สัญญาเช่าอุปกรณ์ · ${inv.equipmentRentalPeriodMonth}`
      : 'สัญญาเช่าอุปกรณ์';
  }
  if (inv.waveId === QUOTATION_PO_WAVE_PLACEHOLDER) return 'ใบเสนอราคา (ไม่มี Wave)';
  if (inv.waveId === PO_MONTH_WAVE_PLACEHOLDER) return inv.waveCode || 'PO+งวด (รวม wave)';
  return inv.waveCode || `${inv.waveId.slice(0, 8)}…`;
}

export default function DraftInvoicesPage() {
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const isAuthorized = useMemo(
    () => !!currentUser && canView(currentUser, 'draft_invoices'),
    [currentUser]
  );
  const canCreateDoc = useMemo(
    () => !!currentUser && canCreate(currentUser, 'draft_invoices'),
    [currentUser]
  );
  /** ยกเลิกเป็น VOID — เฉพาะผู้ดูแลระบบ (ไม่ให้ผู้จัดการปฏิบัติการยกเลิกแทน admin) */
  const canAdminVoidInvoice = useMemo(
    () => !!currentUser && (isSystemAdmin(currentUser) || isSimpleAdmin(currentUser)),
    [currentUser],
  );
  const canHardDeleteInvoice = useMemo(() => !!currentUser && isSystemAdmin(currentUser), [currentUser]);
  const showShareColumn = useMemo(() => canManageDocumentShare(currentUser), [currentUser]);

  const listQuery = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return query(collection(firestore, 'commercial_invoices'), orderBy('issueDate', 'desc'));
  }, [firestore, isAuthorized]);

  const { data: invoices, isLoading } = useCollection<CommercialInvoice>(listQuery as any);

  const visibleInvoices = useMemo(
    () => filterToOwnCreatedDocuments(currentUser, invoices),
    [currentUser, invoices],
  );

  const customersQuery = useMemoFirebase(
    () => (firestore && isAuthorized ? collection(firestore, 'customers') : null),
    [firestore, isAuthorized]
  );
  const { data: customers } = useCollection<Customer>(customersQuery as any);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [customerId, setCustomerId] = useState<string>('');
  const [poId, setPoId] = useState<string>('');
  const [waveId, setWaveId] = useState<string>('');
  const [periodStartMs, setPeriodStartMs] = useState(() => Date.now());
  const [periodEndMs, setPeriodEndMs] = useState(() => Date.now());
  const [issueDateMs, setIssueDateMs] = useState(() => Date.now());
  const [syncRowId, setSyncRowId] = useState<string | null>(null);
  const [partialSyncId, setPartialSyncId] = useState<string | null>(null);
  const [syncingBulk, setSyncingBulk] = useState(false);
  const [voidTarget, setVoidTarget] = useState<CommercialInvoice | null>(null);
  const [voidBusy, setVoidBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CommercialInvoice | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [monthScope, setMonthScope] = useState(() => currentMonthMm());
  const [yearFilterCe, setYearFilterCe] = useState(() => currentYearCe());
  const [statusFilter, setStatusFilter] = useState<InvoiceListStatusFilter>('all');
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);

  const approvedReviewsQuery = useMemoFirebase(
    () =>
      firestore && isAuthorized
        ? query(collection(firestore, 'wave_month_timesheet_reviews'), where('status', '==', 'approved'))
        : null,
    [firestore, isAuthorized]
  );
  const { data: approvedReviews } = useCollection<WaveMonthTimesheetReview>(approvedReviewsQuery as any);

  const approvedPoMonthQuery = useMemoFirebase(
    () =>
      firestore && isAuthorized
        ? query(
            collection(firestore, 'po_month_timesheet_reviews'),
            where('status', 'in', ['approved', 'partially_approved']),
          )
        : null,
    [firestore, isAuthorized],
  );
  const { data: approvedPoMonthReviews } = useCollection<PoMonthTimesheetReview>(approvedPoMonthQuery as any);

  const [workerClosuresByReviewId, setWorkerClosuresByReviewId] = useState<
    Map<string, WorkerMonthTimesheetClosure[]>
  >(() => new Map());

  useEffect(() => {
    if (!firestore || !approvedPoMonthReviews?.length) {
      setWorkerClosuresByReviewId(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      const map = new Map<string, WorkerMonthTimesheetClosure[]>();
      for (const r of approvedPoMonthReviews) {
        const closures = await fetchWorkerClosuresForPoMonth(firestore, r.poId, r.yearMonth);
        if (closures.length > 0) map.set(r.id, closures);
      }
      if (!cancelled) setWorkerClosuresByReviewId(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, approvedPoMonthReviews]);

  const wavesLookupQuery = useMemoFirebase(
    () => (firestore && isAuthorized ? collection(firestore, 'waves') : null),
    [firestore, isAuthorized]
  );
  const { data: allWaves } = useCollection<Wave>(wavesLookupQuery as any);

  const posLookupQuery = useMemoFirebase(
    () => (firestore && isAuthorized ? collection(firestore, 'purchase_orders') : null),
    [firestore, isAuthorized]
  );
  const { data: allPos } = useCollection<PurchaseOrder>(posLookupQuery as any);

  const contractsLookupQuery = useMemoFirebase(
    () => (firestore && isAuthorized ? collection(firestore, 'main_contracts') : null),
    [firestore, isAuthorized],
  );
  const { data: allContracts } = useCollection<MainContract>(contractsLookupQuery as any);

  const contractsById = useMemo(() => {
    const m = new Map<string, MainContract>();
    for (const c of allContracts ?? []) m.set(c.id, c);
    return m;
  }, [allContracts]);

  const poById = useMemo(() => {
    const m = new Map<string, PurchaseOrder>();
    for (const p of allPos ?? []) m.set(p.id, p);
    return m;
  }, [allPos]);

  const isMonthlyBillingPo = useCallback(
    (poId: string) => resolveBillingModeFromMaps(poById.get(poId), contractsById) !== 'TRIP',
    [poById, contractsById],
  );

  const missingReviews = useMemo(
    () =>
      filterWaveMonthReviewsMissingCommercialDraft(approvedReviews ?? [], invoices ?? []).filter((r) =>
        isMonthlyBillingPo(r.poId),
      ),
    [approvedReviews, invoices, isMonthlyBillingPo],
  );

  const missingPoMonthReviews = useMemo(
    () =>
      filterPoMonthReviewsMissingCommercialDraft(
        approvedPoMonthReviews ?? [],
        invoices ?? [],
        workerClosuresByReviewId,
      ).filter((r) => isMonthlyBillingPo(r.poId)),
    [approvedPoMonthReviews, invoices, workerClosuresByReviewId, isMonthlyBillingPo],
  );

  const partialBillingCandidates = useMemo(() => {
    const inv = invoices ?? [];
    const out: PartialBillingCandidate[] = [];
    for (const r of approvedPoMonthReviews ?? []) {
      if (!isMonthlyBillingPo(r.poId)) continue;
      const closures = workerClosuresByReviewId.get(r.id) ?? [];
      if (closures.length === 0) continue;
      const { start, end } = resolvePoMonthPeriodBounds(r);
      out.push(
        ...listPartialBillingCandidates(r.poId, r.yearMonth, r.id, closures, inv, {
          start,
          end,
        }),
      );
    }
    out.sort((a, b) => {
      const ym = b.yearMonth.localeCompare(a.yearMonth);
      if (ym !== 0) return ym;
      return a.id.localeCompare(b.id);
    });
    return out;
  }, [approvedPoMonthReviews, workerClosuresByReviewId, invoices, isMonthlyBillingPo]);

  const customerLabel = useMemo(() => {
    const nameById = new Map<string, string>();
    for (const c of customers ?? []) nameById.set(c.id, c.name);
    return (customerId: string) => nameById.get(customerId) || customerId;
  }, [customers]);

  const yearOptionsCe = useMemo(() => {
    const set = new Set<string>();
    for (const inv of visibleInvoices) {
      const ym = (inv.issueDate || '').slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(ym)) set.add(ym);
    }
    return buildYearCeOptions(set);
  }, [visibleInvoices]);

  const revisedInvoiceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const inv of visibleInvoices) {
      if (invoiceShowsRevised(inv, visibleInvoices)) ids.add(inv.id);
    }
    return ids;
  }, [visibleInvoices]);

  const statusFilterLabel =
    INVOICE_STATUS_FILTER_OPTIONS.find((o) => o.value === statusFilter)?.label ?? 'ทุกสถานะ';

  const printFilterSummary = useMemo(
    () => ({
      yearCe: yearFilterCe,
      monthScope,
      statusLabel: statusFilter === 'all' ? 'ทุกสถานะ' : statusFilterLabel,
    }),
    [yearFilterCe, monthScope, statusFilter, statusFilterLabel],
  );

  const filteredInvoices = useMemo(() => {
    return visibleInvoices.filter((inv) => {
      if (!ymMatchesYearMonthScope((inv.issueDate || '').slice(0, 7), yearFilterCe, monthScope)) {
        return false;
      }
      if (statusFilter === 'all') return true;
      return invoiceListStatusKey(inv, revisedInvoiceIds.has(inv.id)) === statusFilter;
    });
  }, [visibleInvoices, yearFilterCe, monthScope, statusFilter, revisedInvoiceIds]);

  const buildPrintRows = useCallback(
    (list: CommercialInvoice[]): CommercialInvoiceListPrintRow[] =>
      list.map((inv) => ({
        invoiceNo: inv.invoiceNo || '—',
        customerName: customerLabel(inv.customerId),
        issueDateLabel: formatStoredDateThaiBE(inv.issueDate),
        wavePeriodLabel: commercialWavePeriodLabel(inv),
        totalLabel: `฿${(inv.totalAmount ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}`,
        statusLabel: commercialStatusPrintLabel(inv, revisedInvoiceIds.has(inv.id)),
      })),
    [customerLabel, revisedInvoiceIds],
  );

  const runCommercialInvoiceListPrint = useCallback(
    async (scope: 'filtered' | 'all') => {
      const source = scope === 'filtered' ? filteredInvoices : visibleInvoices;
      if (source.length === 0) {
        toast({
          variant: 'destructive',
          title: 'ไม่มีรายการให้พิมพ์',
          description:
            scope === 'filtered'
              ? 'ไม่พบข้อมูลตามเดือนหรือสถานะที่เลือก — ปรับตัวกรองหรือเลือกพิมพ์ทั้งหมด'
              : 'ยังไม่มีใบแจ้งหนี้ในระบบ',
        });
        return;
      }

      setPrintBusy(true);
      try {
        const { rows, truncated } = capCommercialInvoiceListPrintRows(buildPrintRows(source));
        const generatedAt = new Date().toLocaleString('th-TH', {
          dateStyle: 'medium',
          timeStyle: 'short',
        });
        const filterLines =
          scope === 'filtered'
            ? describeCommercialInvoiceListPrintFilters(printFilterSummary)
            : [];
        const scopeTitle =
          scope === 'filtered' ? 'พิมพ์ตามตัวกรองที่เลือก' : 'พิมพ์ทั้งหมด (ในชุดข้อมูลล่าสุด)';

        const body = buildCommercialInvoiceListPrintHtml({
          rows,
          scopeTitle,
          filterLines,
          generatedAt,
          printedBy: currentUser?.displayName,
          truncated,
        });

        const ok = await openStandardPrintWindow({
          windowTitle: 'Commercial-Invoice-List',
          suggestedFileName: `Commercial-Invoice-List-${scope === 'filtered' ? 'Filtered' : 'All'}`,
          bodyInnerHtml: body,
          htmlLang: 'th',
        });

        if (!ok) {
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
    [filteredInvoices, visibleInvoices, buildPrintRows, printFilterSummary, currentUser?.displayName, toast],
  );

  const waveById = useMemo(() => {
    const m = new Map<string, Wave>();
    for (const w of allWaves ?? []) m.set(w.id, w);
    return m;
  }, [allWaves]);

  const poQuery = useMemoFirebase(
    () =>
      firestore && customerId
        ? query(collection(firestore, 'purchase_orders'), where('customerId', '==', customerId))
        : null,
    [firestore, customerId]
  );
  const { data: pos } = useCollection<PurchaseOrder>(poQuery as any);

  const wavesQuery = useMemoFirebase(
    () =>
      firestore && poId ? query(collection(firestore, 'waves'), where('poId', '==', poId)) : null,
    [firestore, poId]
  );
  const { data: waves } = useCollection<Wave>(wavesQuery as any);

  const selectedPo = useMemo(() => {
    if (!poId) return undefined;
    return (pos ?? []).find((p) => p.id === poId) ?? poById.get(poId);
  }, [pos, poById, poId]);

  const monthlyPosForCreate = useMemo(
    () =>
      (pos ?? []).filter(
        (p) => p.status === 'active' && resolveBillingModeFromMaps(p, contractsById) !== 'TRIP',
      ),
    [pos, contractsById],
  );

  const isQuotationPo = (selectedPo?.poType || 'contract') === 'quotation';

  const resetForm = () => {
    setCustomerId('');
    setPoId('');
    setWaveId('');
    const n = Date.now();
    setPeriodStartMs(n);
    setPeriodEndMs(n);
    setIssueDateMs(n);
  };

  const handleCreate = async () => {
    if (!firestore || !currentUser) return;
    if (!poId) {
      toast({ variant: 'destructive', title: 'ข้อมูลไม่ครบ', description: 'เลือก PO' });
      return;
    }
    if (selectedPo && selectedPo.status !== 'active') {
      toast({
        variant: 'destructive',
        title: 'PO ยังไม่ Active',
        description: 'ใบสั่งซื้อสถานะ Pending ยังออกใบแจ้งหนี้ไม่ได้ — อนุมัติเป็น Active ก่อน',
      });
      return;
    }
    if (selectedPo && resolveBillingModeFromMaps(selectedPo, contractsById) === 'TRIP') {
      toast({
        variant: 'destructive',
        title: 'PO โหมด Trip',
        description: 'ออกใบแจ้งหนี้ที่เมนู «ทำใบแจ้งหนี้แบบ Trip» เท่านั้น',
      });
      return;
    }
    if (!isQuotationPo && !waveId) {
      toast({ variant: 'destructive', title: 'ข้อมูลไม่ครบ', description: 'เลือก PO และ Wave' });
      return;
    }
    setCreating(true);
    try {
      const { id, invoiceNo } = isQuotationPo
        ? await createCommercialDraftFromQuotationPoLines(firestore, {
            poId,
            periodStart: timestampToHtmlDateValue(periodStartMs),
            periodEnd: timestampToHtmlDateValue(periodEndMs),
            issueDate: timestampToHtmlDateValue(issueDateMs),
            actor: currentUser,
          })
        : await createCommercialDraftInvoice(firestore, {
            poId,
            waveId: waveId!,
            periodStart: timestampToHtmlDateValue(periodStartMs),
            periodEnd: timestampToHtmlDateValue(periodEndMs),
            issueDate: timestampToHtmlDateValue(issueDateMs),
            actor: currentUser,
          });
      toast({
        title: 'สร้างใบแจ้งหนี้แล้ว',
        description: `เลขที่ ${invoiceNo} — เอกสารเรียกเก็บ (ยังไม่ใช่ใบกำกับภาษี)`,
      });
      setDialogOpen(false);
      resetForm();
      router.push(`/draft-invoices/${id}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'สร้างไม่สำเร็จ';
      toast({ variant: 'destructive', title: 'ไม่สามารถสร้างได้', description: msg });
    } finally {
      setCreating(false);
    }
  };

  const sortedMissingReviews = useMemo(() => {
    const list = [...missingReviews];
    list.sort((a, b) => (a.yearMonth < b.yearMonth ? 1 : a.yearMonth > b.yearMonth ? -1 : 0));
    return list;
  }, [missingReviews]);

  const sortedMissingPoMonth = useMemo(() => {
    const list = [...missingPoMonthReviews];
    list.sort((a, b) => (a.yearMonth < b.yearMonth ? 1 : a.yearMonth > b.yearMonth ? -1 : 0));
    return list;
  }, [missingPoMonthReviews]);

  const ymDesc = (a: { yearMonth: string }, b: { yearMonth: string }) =>
    a.yearMonth < b.yearMonth ? 1 : a.yearMonth > b.yearMonth ? -1 : 0;

  const groupedMissingPoMonth = useMemo(
    () => groupRowsByPoActiveBundle(sortedMissingPoMonth, poById, customerLabel, ymDesc),
    [sortedMissingPoMonth, poById, customerLabel],
  );

  const groupedMissingWave = useMemo(
    () => groupRowsByPoActiveBundle(sortedMissingReviews, poById, customerLabel, ymDesc),
    [sortedMissingReviews, poById, customerLabel],
  );

  const totalMissingInvoiceCount = sortedMissingReviews.length + sortedMissingPoMonth.length;

  const handleEnsureFromReview = async (review: WaveMonthTimesheetReview) => {
    if (!firestore || !currentUser || !canCreateDoc) return;
    setSyncRowId(review.id);
    try {
      const res = await ensureCommercialDraftInvoiceAfterMonthApproval(firestore, review, currentUser);
      if (res.ok === true) {
        toast({
          title: 'สร้างใบแจ้งหนี้แล้ว',
          description: `เลขที่ ${res.invoiceNo} — ตรวจยอด สั่งพิมพ์ และส่งลูกค้าได้จากหน้ารายละเอียด`,
        });
        router.push(`/draft-invoices/${res.id}`);
      } else {
        toast({
          variant: 'destructive',
          title: 'ยังสร้างใบไม่ได้',
          description: res.reason,
        });
      }
    } finally {
      setSyncRowId(null);
    }
  };

  const handleEnsureFromPoMonthReview = async (review: PoMonthTimesheetReview) => {
    if (!firestore || !currentUser || !canCreateDoc) return;
    setSyncRowId(review.id);
    try {
      const res = await ensureCommercialDraftInvoiceAfterPoMonthApproval(firestore, review, currentUser);
      if (res.ok === true) {
        toast({
          title: 'สร้างใบแจ้งหนี้แล้ว',
          description: `เลขที่ ${res.invoiceNo} — ตรวจยอด สั่งพิมพ์ และส่งลูกค้าได้จากหน้ารายละเอียด`,
        });
        router.push(`/draft-invoices/${res.id}`);
      } else {
        toast({
          variant: 'destructive',
          title: 'ยังสร้างใบไม่ได้',
          description: res.reason,
        });
      }
    } finally {
      setSyncRowId(null);
    }
  };

  const handleEnsureAllMissing = async () => {
    if (!firestore || !currentUser || !canCreateDoc || totalMissingInvoiceCount === 0) return;
    setSyncingBulk(true);
    let ok = 0;
    const errors: string[] = [];
    try {
      for (const r of sortedMissingReviews) {
        const res = await ensureCommercialDraftInvoiceAfterMonthApproval(firestore, r, currentUser);
        if (res.ok === true) ok++;
        else errors.push(`wave ${r.yearMonth}: ${res.reason}`);
      }
      for (const r of sortedMissingPoMonth) {
        const res = await ensureCommercialDraftInvoiceAfterPoMonthApproval(firestore, r, currentUser);
        if (res.ok === true) ok++;
        else errors.push(`PO+เดือน ${r.yearMonth}: ${res.reason}`);
      }
      toast({
        title: 'สร้างจากงวดที่อนุมัติแล้ว',
        description:
          errors.length === 0
            ? `สำเร็จ ${ok} รายการ — ดูในรายการด้านล่าง`
            : `สำเร็จ ${ok} — มีข้อผิดพลาด ${errors.length} รายการ: ${errors.slice(0, 3).join(' · ')}`,
        variant: ok === 0 && errors.length > 0 ? 'destructive' : 'default',
      });
    } finally {
      setSyncingBulk(false);
    }
  };

  const handleCreatePartialInvoice = async (candidate: PartialBillingCandidate) => {
    if (!firestore || !currentUser || !canCreateDoc) return;
    setPartialSyncId(candidate.id);
    try {
      const res = await ensureCommercialDraftInvoiceForWorkerSet(firestore, {
        poId: candidate.poId,
        yearMonth: candidate.yearMonth,
        workerIds: candidate.workerIds,
        actor: currentUser,
        partialPoMonthBatchNo: candidate.batchNo,
      });
      if (res.ok) {
        toast({
          title: 'สร้างใบแจ้งหนี้ partial แล้ว',
          description: `เลขที่ ${res.invoiceNo} — ${candidate.workerNames.join(', ')}`,
        });
        router.push(`/draft-invoices/${res.id}`);
      } else {
        toast({
          variant: 'destructive',
          title: 'ยังสร้าง partial ไม่ได้',
          description: res.reason,
        });
      }
    } finally {
      setPartialSyncId(null);
    }
  };

  const handleConfirmVoid = async () => {
    if (!firestore || !currentUser || !voidTarget || !canAdminVoidInvoice) return;
    setVoidBusy(true);
    try {
      await voidCommercialInvoice(firestore, voidTarget.id, currentUser);
      toast({
        title: 'ยกเลิกแล้ว',
        description: `${voidTarget.invoiceNo} — สถานะ VOID`,
      });
      setVoidTarget(null);
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'ยกเลิกไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setVoidBusy(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!firestore || !currentUser || !deleteTarget || !canHardDeleteInvoice) return;
    if (deleteTarget.status === 'ISSUED') {
      toast({
        variant: 'destructive',
        title: 'ลบไม่ได้',
        description: 'ใบที่ยืนยันเรียกเก็บแล้ว (ยืนยันแล้ว) ห้ามลบ — ใช้ขั้นตอนทางบัญชี/ลูกหนี้แทน',
      });
      setDeleteTarget(null);
      return;
    }
    setDeleteBusy(true);
    try {
      await deleteCommercialInvoice(firestore, deleteTarget.id, currentUser);
      toast({
        title: 'ลบแล้ว',
        description: `${deleteTarget.invoiceNo} — ถูกลบถาวรจากระบบ`,
      });
      setDeleteTarget(null);
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'ลบไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setDeleteBusy(false);
    }
  };

  if (isUserLoading || userLoading || !currentUser) return null;

  if (!isAuthorized) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="p-6 text-muted-foreground">ไม่มีสิทธิ์เข้าถึงเมนูนี้</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="mx-auto w-full min-w-0 max-w-[1600px] space-y-6 p-4 md:p-6">
        <div className="flex items-center gap-3 overflow-x-auto">
          <h1 className="flex min-w-0 shrink items-center gap-2 text-xl font-bold tracking-tight text-primary whitespace-nowrap">
            <FileText className="h-6 w-6 shrink-0" />
            ทำใบแจ้งหนี้แบบ Monthly
          </h1>
          <YearMonthScopeSelects
            idPrefix="draft-inv"
            yearCe={yearFilterCe}
            monthScope={monthScope}
            yearOptionsCe={yearOptionsCe}
            onYearCeChange={setYearFilterCe}
            onMonthScopeChange={setMonthScope}
            yearTriggerClassName="w-[7.5rem]"
            monthTriggerClassName="w-[9.5rem]"
          />
          <div className="ml-auto flex flex-nowrap items-center gap-2 whitespace-nowrap shrink-0">
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as InvoiceListStatusFilter)}
            >
              <SelectTrigger
                id="draft-inv-status"
                className="h-10 w-[9.5rem] shrink-0 bg-background"
                aria-label="กรองสถานะ"
              >
                <SelectValue placeholder="สถานะ" />
              </SelectTrigger>
              <SelectContent>
                {INVOICE_STATUS_FILTER_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" className="h-10 shrink-0 gap-2 px-3" onClick={() => setPrintDialogOpen(true)}>
              <Printer className="h-4 w-4" /> พิมพ์รายการ
            </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="h-10 shrink-0 gap-2" disabled={!canCreateDoc}>
                <Plus className="h-4 w-4" />
                สร้างใบแจ้งหนี้
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>สร้างใบแจ้งหนี้</DialogTitle>
                <DialogDescription>
                  {isQuotationPo ? (
                    <>
                      PO จากใบเสนอราคา — ดึงยอดจาก PO Line ถ้ามี ไม่เช่นนั้นจากใบเสนอราคาที่ PO อ้างอิง (ไม่ใช้ Wave / timesheet) ระบุช่วงวันที่และวันที่เอกสาร
                    </>
                  ) : (
                    <>
                      เลือกลูกค้า → PO → Wave และช่วงวันที่ — ระบบดึง timesheet ที่{' '}
                      <code className="text-xs">readyForBilling</code> ตามช่วงที่เลือก
                    </>
                  )}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="rounded-md bg-muted/50 px-3 py-2 text-xs font-mono text-muted-foreground">
                  เลขที่คาดการณ์: {getPreviewPattern('commercial_invoice')}
                </div>
                <div className="space-y-2">
                  <Label>ลูกค้า</Label>
                  <Select
                    value={customerId || '__none__'}
                    onValueChange={(v) => {
                      setCustomerId(v === '__none__' ? '' : v);
                      setPoId('');
                      setWaveId('');
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="เลือกลูกค้า" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— เลือก —</SelectItem>
                      {(customers ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name || c.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                    <Label>ใบสั่งซื้อ (PO ที่ Active)</Label>
                  <Select
                    value={poId || '__none__'}
                    onValueChange={(v) => {
                      setPoId(v === '__none__' ? '' : v);
                      setWaveId('');
                    }}
                    disabled={!customerId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="เลือก PO" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— เลือก —</SelectItem>
                      {(monthlyPosForCreate ?? []).map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.poCode || p.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    แสดงเฉพาะ PO ที่ Active — ใบ Pending ต้องอนุมัติก่อนจึงออกใบแจ้งหนี้ได้
                  </p>
                </div>
                {!isQuotationPo && (
                  <div className="space-y-2">
                    <Label>Wave</Label>
                    <Select
                      value={waveId || '__none__'}
                      onValueChange={(v) => setWaveId(v === '__none__' ? '' : v)}
                      disabled={!poId}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="เลือก Wave" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— เลือก —</SelectItem>
                        {(waves ?? []).map((w) => (
                          <SelectItem key={w.id} value={w.id}>
                            {w.waveCode} — {w.projectName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>ตั้งแต่วันที่</Label>
                    <DatePickerThaiBE value={periodStartMs} onChange={setPeriodStartMs} />
                  </div>
                  <div>
                    <Label>ถึงวันที่</Label>
                    <DatePickerThaiBE value={periodEndMs} onChange={setPeriodEndMs} />
                  </div>
                </div>
                <div>
                  <Label>วันที่เอกสาร</Label>
                  <DatePickerThaiBE value={issueDateMs} onChange={setIssueDateMs} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={creating}>
                  ยกเลิก
                </Button>
                <Button onClick={() => void handleCreate()} disabled={creating}>
                  {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  สร้างใบแจ้งหนี้
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </div>
        </div>

        <Dialog open={printDialogOpen} onOpenChange={setPrintDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>พิมพ์รายการใบแจ้งหนี้</DialogTitle>
              <DialogDescription>
                เลือกพิมพ์ตามเดือนที่ตั้งไว้ หรือพิมพ์ทุกรายการในชุดข้อมูลล่าสุด (สูงสุด 500 รายการ)
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="rounded-md border bg-muted/30 p-3 space-y-1">
                <p className="font-semibold text-xs uppercase text-muted-foreground">ตัวกรองปัจจุบัน</p>
                <ul className="list-disc list-inside text-xs text-muted-foreground">
                  {describeCommercialInvoiceListPrintFilters(printFilterSummary).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <p className="text-xs font-medium pt-1">จะพิมพ์ {filteredInvoices.length} รายการ</p>
              </div>
              <p className="text-xs text-muted-foreground">ข้อมูลทั้งหมดในระบบ: {visibleInvoices.length} รายการ</p>
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                disabled={printBusy || filteredInvoices.length === 0}
                onClick={() => void runCommercialInvoiceListPrint('filtered')}
              >
                <Printer className="h-4 w-4 mr-2" />
                พิมพ์ตามตัวกรอง ({filteredInvoices.length})
              </Button>
              <Button
                type="button"
                className="w-full sm:w-auto"
                disabled={printBusy || visibleInvoices.length === 0}
                onClick={() => void runCommercialInvoiceListPrint('all')}
              >
                <Printer className="h-4 w-4 mr-2" />
                พิมพ์ทั้งหมด ({visibleInvoices.length})
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {totalMissingInvoiceCount > 0 && (
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="text-base text-primary">งวด timesheet อนุมัติแล้ว — ยังไม่มีใบแจ้งหนี้</CardTitle>
                <CardDescription>
                  อ้างอิงงวด <strong>PO+เดือน</strong> (รวมทุก wave) หรืองวด <strong>ต่อ wave</strong> ตามที่อนุมัติ —{' '}
                  <strong>จัดกลุ่มตามชุด PO Active</strong> (ลูกค้า + Onshore/Offshore) — กดสร้างใบเพื่อนำไปตรวจยอด / พิมพ์ / ส่งลูกค้า
                </CardDescription>
              </div>
              {canCreateDoc && (
                <Button
                  className="gap-2 shrink-0"
                  variant="secondary"
                  disabled={syncingBulk}
                  onClick={() => void handleEnsureAllMissing()}
                >
                  {syncingBulk ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  สร้างใบที่ขาดทั้งหมด ({totalMissingInvoiceCount})
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0 space-y-6">
              {sortedMissingPoMonth.length > 0 ? (
                <div>
                  <p className="text-sm font-semibold text-primary px-6 py-2 bg-primary/5 border-b">งวด timesheet ราย PO+เดือน (แนะนำ — รวมทุก wave)</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-6">เดือน (งวด)</TableHead>
                        <TableHead>PO</TableHead>
                        <TableHead>ขอบเขต</TableHead>
                        <TableHead className="text-right pr-6">การทำงาน</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {groupedMissingPoMonth.map((g) => (
                        <Fragment key={g.bundleKey}>
                          <TableRow className="bg-primary/5 hover:bg-primary/5 border-t-2 border-primary/15">
                            <TableCell colSpan={4} className="py-3 pl-6">
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                                <Badge variant="outline" className="font-semibold">
                                  {poActiveBundleWorkModeShortLabel(g.workMode)}
                                </Badge>
                                <span className="font-bold text-foreground">{customerLabel(g.customerId)}</span>
                                <span
                                  className="text-muted-foreground text-xs font-mono truncate max-w-[240px]"
                                  title={g.bundleKey}
                                >
                                  {g.bundleKey.startsWith('orphan:') ? 'ไม่มีชุด PO Active (PO เดี่ยว)' : g.bundleKey}
                                </span>
                                {!g.bundleKey.startsWith('orphan:') ? (
                                  <Link
                                    href={`/po-active/${encodeURIComponent(g.bundleKey)}`}
                                    className="text-xs font-semibold text-primary underline"
                                  >
                                    เปิด PO Active
                                  </Link>
                                ) : null}
                                <Badge variant="secondary" className="text-[10px]">
                                  {g.rows.length} งวดในกลุ่ม
                                </Badge>
                              </div>
                            </TableCell>
                          </TableRow>
                          {g.rows.map((r) => {
                            const po = poById.get(r.poId);
                            const bundleKey = po ? resolvePoActiveBundleKeyForPo(po) : `orphan:${r.poId}`;
                            return (
                              <TableRow key={r.id}>
                                <TableCell className="pl-6 font-mono text-sm">{r.yearMonth}</TableCell>
                                <TableCell className="text-sm">{po?.poCode ?? r.poId}</TableCell>
                                <TableCell className="text-sm text-muted-foreground">PO+เดือน (รวม wave)</TableCell>
                                <TableCell className="text-right pr-6">
                                  <div className="flex flex-wrap justify-end gap-2">
                                    <Button variant="outline" size="sm" className="h-8 gap-1" asChild>
                                      <Link
                                        href={`/timesheets/wave-month?month=${encodeURIComponent(r.yearMonth)}&highlightPo=${encodeURIComponent(r.poId)}&poActiveBundleId=${encodeURIComponent(bundleKey)}`}
                                      >
                                        <ExternalLink className="h-3.5 w-3.5" />
                                        เอกสารรอบ PO
                                      </Link>
                                    </Button>
                                    {canCreateDoc && (
                                      <Button
                                        size="sm"
                                        className="h-8 gap-1"
                                        disabled={syncRowId === r.id || syncingBulk}
                                        onClick={() => void handleEnsureFromPoMonthReview(r)}
                                      >
                                        {syncRowId === r.id ? (
                                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                          <Plus className="h-3.5 w-3.5" />
                                        )}
                                        สร้างใบแจ้งหนี้
                                      </Button>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </Fragment>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : null}
              {sortedMissingReviews.length > 0 ? (
                <div>
                  <p className="text-sm font-semibold text-muted-foreground px-6 py-2 bg-muted/20 border-b">งวด timesheet ต่อ Wave (ราย wave)</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-6">เดือน (งวด)</TableHead>
                        <TableHead>PO</TableHead>
                        <TableHead>Wave</TableHead>
                        <TableHead className="text-right pr-6">การทำงาน</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {groupedMissingWave.map((g) => (
                        <Fragment key={`wv-${g.bundleKey}`}>
                          <TableRow className="bg-muted/40 hover:bg-muted/40 border-t border-muted">
                            <TableCell colSpan={4} className="py-3 pl-6">
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                                <Badge variant="outline" className="font-semibold">
                                  {poActiveBundleWorkModeShortLabel(g.workMode)}
                                </Badge>
                                <span className="font-bold text-foreground">{customerLabel(g.customerId)}</span>
                                <span
                                  className="text-muted-foreground text-xs font-mono truncate max-w-[240px]"
                                  title={g.bundleKey}
                                >
                                  {g.bundleKey.startsWith('orphan:') ? 'ไม่มีชุด PO Active (PO เดี่ยว)' : g.bundleKey}
                                </span>
                                {!g.bundleKey.startsWith('orphan:') ? (
                                  <Link
                                    href={`/po-active/${encodeURIComponent(g.bundleKey)}`}
                                    className="text-xs font-semibold text-primary underline"
                                  >
                                    เปิด PO Active
                                  </Link>
                                ) : null}
                                <Badge variant="secondary" className="text-[10px]">
                                  {g.rows.length} wave ในกลุ่ม
                                </Badge>
                              </div>
                            </TableCell>
                          </TableRow>
                          {g.rows.map((r) => {
                            const po = poById.get(r.poId);
                            const wv = waveById.get(r.waveId);
                            const bundleKey = po ? resolvePoActiveBundleKeyForPo(po) : `orphan:${r.poId}`;
                            const waveMonthHref =
                              `/timesheets/wave-month?month=${encodeURIComponent(r.yearMonth)}&highlightWave=${encodeURIComponent(r.waveId)}` +
                              (bundleKey.startsWith('orphan:')
                                ? ''
                                : `&poActiveBundleId=${encodeURIComponent(bundleKey)}`);
                            return (
                              <TableRow key={r.id}>
                                <TableCell className="pl-6 font-mono text-sm">{r.yearMonth}</TableCell>
                                <TableCell className="text-sm">{po?.poCode ?? r.poId}</TableCell>
                                <TableCell className="text-sm font-mono">{wv?.waveCode ?? r.waveId.slice(0, 10)}</TableCell>
                                <TableCell className="text-right pr-6">
                                  <div className="flex flex-wrap justify-end gap-2">
                                    <Button variant="outline" size="sm" className="h-8 gap-1" asChild>
                                      <Link href={waveMonthHref}>
                                        <ExternalLink className="h-3.5 w-3.5" />
                                        ดูสรุปรายเดือน
                                      </Link>
                                    </Button>
                                    {canCreateDoc && (
                                      <Button
                                        size="sm"
                                        className="h-8 gap-1"
                                        disabled={syncRowId === r.id || syncingBulk}
                                        onClick={() => void handleEnsureFromReview(r)}
                                      >
                                        {syncRowId === r.id ? (
                                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                          <Plus className="h-3.5 w-3.5" />
                                        )}
                                        สร้างใบแจ้งหนี้
                                      </Button>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </Fragment>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : null}
            </CardContent>
          </Card>
        )}

        {partialBillingCandidates.length > 0 && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardHeader>
              <CardTitle className="text-base text-amber-950 dark:text-amber-100">
                วางบิล partial — คนงานอนุมัติแล้วยังไม่มีใบ
              </CardTitle>
              <CardDescription>
                สร้างใบแจ้งหนี้เฉพาะชุดคนงานที่ manager อนุมัติแล้ว (แยกจากใบเต็ม PO+เดือน) — ใช้เมื่อระบบไม่สร้างอัตโนมัติ
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">เดือน</TableHead>
                    <TableHead>PO</TableHead>
                    <TableHead>คนงาน</TableHead>
                    <TableHead>รอบ</TableHead>
                    <TableHead className="text-right pr-6">การทำงาน</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {partialBillingCandidates.map((c) => {
                    const po = poById.get(c.poId);
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="pl-6 font-mono text-sm">{c.yearMonth}</TableCell>
                        <TableCell className="text-sm">{po?.poCode ?? c.poId}</TableCell>
                        <TableCell className="text-sm max-w-[280px]">
                          <span className="line-clamp-2" title={c.workerNames.join(', ')}>
                            {c.workerNames.join(', ')}
                          </span>
                          <Badge variant="outline" className="mt-1 text-[10px]">
                            {c.workerIds.length} คน
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {c.batchNo != null && c.batchNo > 0 ? `รอบ ${c.batchNo}` : '—'}
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          {canCreateDoc ? (
                            <Button
                              size="sm"
                              className="h-8 gap-1"
                              variant="secondary"
                              disabled={partialSyncId === c.id || syncingBulk}
                              onClick={() => void handleCreatePartialInvoice(c)}
                            >
                              {partialSyncId === c.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Plus className="h-3.5 w-3.5" />
                              )}
                              สร้าง invoice partial
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>รายการใบแจ้งหนี้</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <TooltipProvider delayDuration={300}>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-9 whitespace-nowrap px-2 py-1.5 pl-3">เลขที่</TableHead>
                  <TableHead className="h-9 whitespace-nowrap px-2 py-1.5">ลูกค้า</TableHead>
                  <TableHead className="h-9 whitespace-nowrap px-2 py-1.5">Wave / งวด</TableHead>
                  <TableHead className="h-9 whitespace-nowrap px-2 py-1.5 text-right">ยอดรวม</TableHead>
                  <TableHead className="h-9 whitespace-nowrap px-2 py-1.5">ผู้สร้าง</TableHead>
                  {showShareColumn && <TableHead className="h-9 w-12 whitespace-nowrap px-2 py-1.5 text-center">แชร์</TableHead>}
                  <TableHead className="h-9 whitespace-nowrap px-2 py-1.5">สถานะ</TableHead>
                  <TableHead className="h-9 whitespace-nowrap px-2 py-1.5 pr-3 text-right">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(filteredInvoices ?? []).map((inv) => {
                  const cust = customers?.find((c) => c.id === inv.customerId);
                  return (
                    <TableRow key={inv.id} className="h-10">
                      <TableCell className="whitespace-nowrap px-2 py-1.5 pl-3 font-mono text-sm font-semibold">{inv.invoiceNo}</TableCell>
                      <TableCell className="whitespace-nowrap px-2 py-1.5">
                        <div className="flex items-center gap-2 text-sm">
                          <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="max-w-[22rem] truncate">{cust?.name ?? inv.customerId}</span>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-2 py-1.5 text-xs font-mono">
                        <div className="flex flex-nowrap items-center gap-1.5">
                          {commercialWavePeriodLabel(inv)}
                          {isPartialPoMonthCommercialInvoice(inv) ? (
                            <Badge variant="outline" className="text-[10px] font-normal">
                              Partial
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-2 py-1.5 text-right text-sm tabular-nums">
                        ฿{(inv.totalAmount ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-2 py-1.5 text-sm">
                        {documentCreatorDisplayName(inv)}
                      </TableCell>
                      {showShareColumn && (
                        <TableCell className="px-2 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                          <DocumentShareListMarker
                            collectionName="commercial_invoices"
                            documentId={inv.id}
                            currentUser={currentUser}
                            sharedWith={inv.sharedWith}
                            sharedWithUids={inv.sharedWithUids}
                          />
                        </TableCell>
                      )}
                      <TableCell className="whitespace-nowrap px-2 py-1.5">{statusBadge(inv, revisedInvoiceIds.has(inv.id))}</TableCell>
                      <TableCell className="whitespace-nowrap px-2 py-1.5 pr-3 text-right">
                        <div className="flex flex-nowrap items-center justify-end gap-0.5">
                          {canAdminVoidInvoice &&
                            (inv.status === 'DRAFT' ||
                              inv.status === 'PENDING_CUSTOMER' ||
                              inv.status === 'ISSUED') &&
                            !revisedInvoiceIds.has(inv.id) && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="h-8 w-8 shrink-0 text-destructive border-destructive/30 hover:bg-destructive/10"
                                    onClick={() => setVoidTarget(inv)}
                                  >
                                    <Ban className="h-3.5 w-3.5" />
                                    <span className="sr-only">ยกเลิก</span>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  <p>
                                    {inv.status === 'ISSUED'
                                      ? 'ยกเลิก (VOID) — ถ้ายืนยันแล้วต้องยังไม่มีใบกำกับภาษีที่ใช้งาน หรือยกเลิกใบกำกับก่อน'
                                      : 'ยกเลิกเอกสาร (VOID) — เฉพาะผู้ดูแลระบบ'}
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            )}
                          {canHardDeleteInvoice && inv.status !== 'ISSUED' && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="icon"
                                  className="h-8 w-8 shrink-0 text-destructive border-destructive/40 hover:bg-destructive/15"
                                  onClick={() => setDeleteTarget(inv)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  <span className="sr-only">ลบ</span>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="top">
                                <p>ลบถาวร — เฉพาะผู้ดูแลระบบ (ห้ามลบใบที่ยืนยันแล้ว)</p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground" asChild>
                                <Link href={`/draft-invoices/${inv.id}`} aria-label="เปิดรายละเอียด">
                                  <ChevronRight className="h-4 w-4" />
                                </Link>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              <p>เปิดรายละเอียด</p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {visibleInvoices.length === 0 && !isLoading && (
                  <TableRow>
                    <TableCell colSpan={showShareColumn ? 8 : 7} className="text-center py-12 text-muted-foreground">
                      ยังไม่มีรายการ — ใช้ปุ่มสร้างด้านบน หรือสร้างจากงวดที่อนุมัติแล้ว
                    </TableCell>
                  </TableRow>
                )}
                {visibleInvoices.length > 0 && filteredInvoices.length === 0 && !isLoading && (
                  <TableRow>
                    <TableCell colSpan={showShareColumn ? 8 : 7} className="text-center py-12 text-muted-foreground">
                      ไม่พบรายการตามเดือนหรือสถานะที่เลือก
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            </TooltipProvider>
          </CardContent>
        </Card>

        <AlertDialog open={voidTarget !== null} onOpenChange={(open) => !open && !voidBusy && setVoidTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ยกเลิกใบ {voidTarget?.invoiceNo ?? ''}?</AlertDialogTitle>
              <AlertDialogDescription>
                สถานะจะเป็น VOID — สร้างใบใหม่จากงวดหรือ Wave / Timesheet ได้อีกครั้ง (ไม่ลบประวัติเอกสาร)
                {voidTarget?.status === 'ISSUED' ? (
                  <span className="mt-2 block">
                    ใบนี้ยืนยันแล้ว — ยกเลิกได้เมื่อยังไม่ได้ผูกใบกำกับภาษีที่ใช้งาน
                    หรือยกเลิกใบกำกับภาษีก่อนแล้วค่อยยกเลิกใบแจ้งหนี้
                  </span>
                ) : null}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={voidBusy}>ไม่</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={voidBusy}
                onClick={(e) => {
                  e.preventDefault();
                  void handleConfirmVoid();
                }}
              >
                {voidBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ยืนยันยกเลิก'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && !deleteBusy && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ลบถาวร {deleteTarget?.invoiceNo ?? ''}?</AlertDialogTitle>
              <AlertDialogDescription>
                ลบเอกสารออกจากฐานข้อมูล — ไม่สามารถกู้คืนได้ ใช้เมื่อต้องการเคลียร์รายการทดสอบหรือเอกสารผิดพลาดร้ายแรง
                {deleteTarget?.status === 'ISSUED' || deleteTarget?.status === 'PENDING_CUSTOMER' ? (
                  <span className="block mt-2 font-medium text-destructive">
                    ใบนี้เคยส่งลูกค้าหรือยืนยันแล้ว — ตรวจสอบให้แน่ใจก่อนลบ
                  </span>
                ) : null}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteBusy}>ไม่</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={deleteBusy}
                onClick={(e) => {
                  e.preventDefault();
                  void handleConfirmDelete();
                }}
              >
                {deleteBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ยืนยันลบถาวร'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppShell>
  );
}
