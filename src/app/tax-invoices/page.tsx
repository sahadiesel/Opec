'use client';

import { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Plus,
  Search,
  ChevronRight,
  FileBadge,
  Info,
  Loader2,
  Trash2,
  Printer,
  AlertTriangle,
} from 'lucide-react';
import {
  formatStoredDateThaiBE,
} from '@/lib/date-thai';
import {
  buildYearCeOptions,
  currentMonthMm,
  currentYearCe,
  ymMatchesYearMonthScope,
} from '@/lib/date/year-month-scope-filter';
import { YearMonthScopeSelects } from '@/components/accounting/year-month-scope-selects';
import { TaxInvoice, TaxInvoiceStatus, User, Customer, CommercialInvoice, MoneyReceipt } from '@/lib/types';
import { roundMoney2 } from '@/lib/ops/purchase-payment-milestones';
import { StatusBadge } from '@/components/ui/status-badge';
import { taxInvoiceStatusBadge } from '@/lib/tax/tax-invoice-status-badge';
import { useFirestore, useCollection, useMemoFirebase, useUser, useFirebaseApp } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canView, canCreate } from '@/lib/permissions';
import {
  documentCreatorDisplayName,
  filterToOwnCreatedDocuments,
} from '@/lib/documents/own-created-list';
import { canManageDocumentShare } from '@/lib/documents/document-share';
import { DocumentShareListMarker } from '@/components/documents/document-share-controls';
import { collection, query, orderBy, where } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription,
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { getPreviewPattern } from '@/lib/services/numbering-service';
import { createTaxInvoiceDraftFromIssuedCommercial } from '@/lib/services/tax-invoice-from-commercial-service';
import { isConfirmedLatestCommercialInvoice } from '@/lib/commercial/commercial-invoice-revision';
import { deleteTaxInvoiceBundleAsAdmin } from '@/lib/services/tax-invoice-delete-service';
import { isSystemAdmin } from '@/lib/permission-core';
import {
  buildTaxInvoiceListPrintHtml,
  capTaxInvoiceListPrintRows,
  describeTaxInvoiceListPrintFilters,
  formatTaxInvoiceSalesReportPeriodLabel,
  type TaxInvoiceListPrintRow,
} from '@/lib/documents/tax-invoice-list-print';
import { openStandardPrintWindow } from '@/lib/documents/standard-document-print';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

function formatTaxInvoiceMoney(amount: number, currency = 'THB'): string {
  return `${currency} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

/** ตารางรายการ — ไม่ใส่รหัสสกุลเงิน เพื่อประหยัดความกว้าง */
function formatTaxInvoiceMoneyPlain(amount: number): string {
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** ยอดหัก ณ ที่จ่ายบนใบกำกับ — 0 ถ้าไม่มี / ไม่ถึงเกณฑ์ */
function taxInvoiceWhtAmount(inv: TaxInvoice): number {
  const w = Number(inv.withholdingTaxAmount) || 0;
  return w > 0.005 ? roundMoney2(w) : 0;
}

/** ตารางรายการ — ตัวอักษรเล็ก + table-fixed ให้พอดีหน้าโดยไม่เลื่อนซ้ายขวา */
const TAX_INV_LIST_TABLE =
  'table-fixed w-full text-[11px] leading-tight [&_th]:!h-8 [&_th]:!px-1.5 [&_th]:!py-0.5 [&_th]:align-middle [&_th]:whitespace-normal [&_th]:leading-tight [&_th]:font-semibold [&_td]:!px-1.5 [&_td]:!py-1 [&_td]:align-middle';

function TaxInvoiceListColgroup({ showShare }: { showShare: boolean }) {
  return (
    <colgroup>
      <col style={{ width: '8.5%' }} />
      <col style={{ width: showShare ? '17.5%' : '18.5%' }} />
      <col style={{ width: '7.5%' }} />
      <col style={{ width: showShare ? '8%' : '8.5%' }} />
      <col style={{ width: '7%' }} />
      <col style={{ width: '6%' }} />
      <col style={{ width: '7%' }} />
      <col style={{ width: '7%' }} />
      <col style={{ width: '7%' }} />
      <col style={{ width: showShare ? '11%' : '12.5%' }} />
      {showShare ? <col style={{ width: '3%' }} /> : null}
      <col style={{ width: '6%' }} />
      <col style={{ width: '4.5%' }} />
    </colgroup>
  );
}

export default function TaxInvoicesPage() {
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const firebaseApp = useFirebaseApp();
  const { toast } = useToast();

  const isAuthorized = useMemo(
    () => !!currentUser && canView(currentUser, 'tax_invoices'),
    [currentUser]
  );

  const canCreateInvoice = useMemo(
    () => !!currentUser && canCreate(currentUser, 'tax_invoices'),
    [currentUser]
  );
  const showShareColumn = useMemo(() => canManageDocumentShare(currentUser), [currentUser]);

  const invoicesQuery = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return query(collection(firestore, 'tax_invoices'), orderBy('issueDate', 'desc'));
  }, [firestore, isAuthorized]);

  const { data: invoices, isLoading } = useCollection<TaxInvoice>(invoicesQuery as any);

  const visibleInvoices = useMemo(
    () => filterToOwnCreatedDocuments(currentUser, invoices),
    [currentUser, invoices],
  );

  const customersQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'customers') : null), [firestore, isAuthorized]);
  const { data: customers } = useCollection<Customer>(customersQuery as any);

  const receiptsQuery = useMemoFirebase(
    () => (firestore && isAuthorized ? query(collection(firestore, 'receipts')) : null),
    [firestore, isAuthorized],
  );
  const { data: receipts } = useCollection<MoneyReceipt>(receiptsQuery as any);

  /** ใบแจ้งหนี้เชิงพาณิชย์ที่อนุมัติแล้ว (ISSUED) และยังไม่มีใบกำกับภาษี */
  const commercialIssuedQuery = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return query(collection(firestore, 'commercial_invoices'), where('status', '==', 'ISSUED'));
  }, [firestore, isAuthorized]);
  const { data: issuedCommercial } = useCollection<CommercialInvoice>(commercialIssuedQuery as any);

  const availableCommercialInvoices = useMemo(() => {
    if (!issuedCommercial?.length) return [];
    return issuedCommercial.filter((c) => isConfirmedLatestCommercialInvoice(c) && !c.linkedTaxInvoiceId);
  }, [issuedCommercial]);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedCommercialId, setSelectedCommercialId] = useState<string>('');
  /** แสดงยอดหัก ณ ที่จ่ายบนใบกำกับ (ฐานก่อน VAT × 3%) */
  const [showWithholdingOnDocument, setShowWithholdingOnDocument] = useState(false);

  const canAdminDelete = useMemo(() => !!currentUser && isSystemAdmin(currentUser), [currentUser]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TaxInvoice | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [yearFilterCe, setYearFilterCe] = useState(() => currentYearCe());
  const [monthScope, setMonthScope] = useState(() => currentMonthMm());

  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);

  const receiptNoById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of receipts ?? []) {
      if (r.id && r.receiptNo) m.set(r.id, r.receiptNo);
    }
    return m;
  }, [receipts]);

  const receiptNoByTaxInvoiceId = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of receipts ?? []) {
      if (r.taxInvoiceId && r.receiptNo) m.set(r.taxInvoiceId, r.receiptNo);
    }
    return m;
  }, [receipts]);

  const resolveReceiptNo = (inv: TaxInvoice): string => {
    if (inv.linkedReceiptId) {
      const fromLink = receiptNoById.get(inv.linkedReceiptId)?.trim();
      if (fromLink) return fromLink;
    }
    return receiptNoByTaxInvoiceId.get(inv.id)?.trim() || '-';
  };

  const yearOptionsCe = useMemo(() => {
    const set = new Set<string>();
    for (const inv of visibleInvoices) {
      const ym = (inv.issueDate || '').slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(ym)) set.add(ym);
    }
    return buildYearCeOptions(set);
  }, [visibleInvoices]);

  const filteredInvoices = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return visibleInvoices.filter((inv) => {
      if (!ymMatchesYearMonthScope((inv.issueDate || '').slice(0, 7), yearFilterCe, monthScope)) {
        return false;
      }
      if (!term) return true;
      const no = (inv.taxInvoiceNo || '').toLowerCase();
      const cust = customers?.find((c) => c.id === inv.customerId);
      const custName = (cust?.name || '').toLowerCase();
      return no.includes(term) || custName.includes(term);
    });
  }, [visibleInvoices, searchTerm, yearFilterCe, monthScope, customers]);

  const printFilterSummary = useMemo(
    () => ({ searchTerm, yearCe: yearFilterCe, monthScope }),
    [searchTerm, yearFilterCe, monthScope],
  );

  const buildPrintRows = useCallback(
    (list: TaxInvoice[]): TaxInvoiceListPrintRow[] =>
      list.map((inv) => {
        const customer = customers?.find((c) => c.id === inv.customerId);
        let receiptNo = '-';
        if (inv.linkedReceiptId) {
          const fromLink = receiptNoById.get(inv.linkedReceiptId)?.trim();
          if (fromLink) receiptNo = fromLink;
        } else {
          receiptNo = receiptNoByTaxInvoiceId.get(inv.id)?.trim() || '-';
        }
        return {
          taxInvoiceNo: inv.taxInvoiceNo || (inv.status === 'DRAFT' ? 'รอออกเลข…' : '—'),
          customerName: customer?.name || 'N/A',
          issueDateLabel: formatStoredDateThaiBE(inv.issueDate),
          receiptNo,
          taxableLabel: formatTaxInvoiceMoney(inv.taxableAmount ?? 0, inv.currency),
          vatLabel: formatTaxInvoiceMoney(inv.vatAmount ?? 0, inv.currency),
          totalLabel: formatTaxInvoiceMoney(inv.totalAmount ?? 0, inv.currency),
          status: inv.status || '—',
        };
      }),
    [customers, receiptNoById, receiptNoByTaxInvoiceId],
  );

  const runTaxInvoiceListPrint = useCallback(
    async (scope: 'filtered' | 'all') => {
      const source = scope === 'filtered' ? filteredInvoices : visibleInvoices;
      if (source.length === 0) {
        toast({
          variant: 'destructive',
          title: 'ไม่มีรายการให้พิมพ์',
          description:
            scope === 'filtered'
              ? 'ไม่พบข้อมูลตามตัวกรอง — ปรับตัวกรองหรือเลือกพิมพ์ทั้งหมด'
              : 'ยังไม่มีใบกำกับภาษีในระบบ',
        });
        return;
      }

      setPrintBusy(true);
      try {
        const { rows, truncated } = capTaxInvoiceListPrintRows(buildPrintRows(source));
        const generatedAt = new Date().toLocaleString('th-TH', {
          dateStyle: 'medium',
          timeStyle: 'short',
        });
        const filterLines =
          scope === 'filtered' ? describeTaxInvoiceListPrintFilters(printFilterSummary) : [];
        const scopeTitle =
          scope === 'filtered' ? 'พิมพ์ตามตัวกรองปัจจุบัน' : 'พิมพ์ทั้งหมด (ในชุดข้อมูลล่าสุด)';
        const periodLabel =
          scope === 'filtered'
            ? formatTaxInvoiceSalesReportPeriodLabel(yearFilterCe, monthScope)
            : 'ทั้งหมด';

        const body = buildTaxInvoiceListPrintHtml({
          rows,
          scopeTitle,
          filterLines,
          generatedAt,
          printedBy: currentUser?.displayName,
          truncated,
          periodLabel,
        });

        const ok = await openStandardPrintWindow({
          windowTitle: 'Tax-Invoice-List',
          suggestedFileName: `Tax-Invoice-List-${scope === 'filtered' ? 'Filtered' : 'All'}`,
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
    [
      filteredInvoices,
      visibleInvoices,
      buildPrintRows,
      printFilterSummary,
      yearFilterCe,
      monthScope,
      currentUser?.displayName,
      toast,
    ],
  );

  const handleCreate = async () => {
    if (!firestore || !currentUser) return;
    if (!selectedCommercialId) {
      toast({
        variant: 'destructive',
        title: 'ข้อมูลไม่ครบ',
        description: 'เลือกใบแจ้งหนี้ (รายการเรียกเก็บ) ที่อนุมัติแล้ว',
      });
      return;
    }

    setIsCreating(true);
    try {
      const { taxInvoiceId } = await createTaxInvoiceDraftFromIssuedCommercial(
        firestore,
        selectedCommercialId,
        currentUser as User,
        {
          showWithholdingOnDocument,
          withholdingTaxRatePercentOnDocument: 3,
        },
      );

      setIsDialogOpen(false);
      setSelectedCommercialId('');
      setShowWithholdingOnDocument(false);
      toast({
        title: 'สร้างใบกำกับภาษีร่างสำเร็จ',
        description:
          'ยังไม่ออกเลข INV — แนบสลิปได้ที่หน้ารายละเอียด ก่อนกดออกเอกสารจริง (ISSUED) จึงจะได้เลขที่และวันที่ออก',
      });
      router.push(`/tax-invoices/${taxInvoiceId}`);
    } catch (e: unknown) {
      console.error(e);
      const msg = e instanceof Error ? e.message : 'ไม่สามารถสร้างใบกำกับภาษีได้';
      toast({ variant: 'destructive', title: 'ไม่สามารถสร้างได้', description: msg });
    } finally {
      setIsCreating(false);
    }
  };

  const handleConfirmDeleteTaxInvoice = async () => {
    if (!firestore || !currentUser || !deleteTarget) return;
    setDeleting(true);
    try {
      await deleteTaxInvoiceBundleAsAdmin(firestore, firebaseApp, deleteTarget, currentUser as User);
      toast({
        title: 'ลบชุดเอกสารแล้ว',
        description: deleteTarget.taxInvoiceNo
          ? `เลขที่ ${deleteTarget.taxInvoiceNo} คืนเข้า pool — ออกเอกสารครั้งถัดไปสามารถใช้เลขเดิมได้`
          : 'ลบร่างที่ยังไม่มีเลข INV แล้ว',
      });
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
    } catch (e: unknown) {
      console.error(e);
      toast({
        variant: 'destructive',
        title: 'ลบไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setDeleting(false);
    }
  };

  const getStatusBadge = (status: TaxInvoiceStatus) => (
    <StatusBadge {...taxInvoiceStatusBadge(status)} />
  );

  if (isUserLoading || userLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="mx-auto w-full min-w-0 max-w-[1600px] space-y-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <FileBadge className="h-8 w-8" /> ใบกำกับภาษีขาย
          </h1>
          <p className="text-muted-foreground text-lg">
            ออกจากใบแจ้งหนี้ที่อนุมัติแล้ว หรือสร้างฉบับอิสระ (ไม่ใช่ e-Tax) — เมื่อ ISSUED บันทึกลูกหนี้; หลังแจ้งชำระและยืนยันรับเงิน
            ระบบออก ใบเสร็จรับเงิน แยก (เมนู ใบเสร็จ)
          </p>
        </div>

        <Alert className="bg-blue-50 border-blue-200 text-blue-800 shadow-sm">
          <Info className="h-5 w-5 text-blue-600" />
          <AlertTitle className="font-bold text-lg">นโยบายเอกสารภาษี (Tax Document Policy)</AlertTitle>
          <AlertDescription className="text-sm">
            สถานะ DRAFT ยังไม่กระทบลูกหนี้ — เมื่อเปลี่ยนเป็น ISSUED ระบบจะสร้าง AR ตามยอดใบแจ้งหนี้ที่อ้างอิง (ข้อมูลอ้างอิงมาจากเมนู «รายการใบแจ้งหนี้» ไม่ต้องใช้เมนูใบวางบิล)
          </AlertDescription>
        </Alert>

        <div className="flex flex-col gap-3 bg-card rounded-lg border p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 basis-full sm:basis-auto sm:min-w-[14rem] sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="ค้นหาเลขที่ใบกำกับภาษี, ลูกค้า…"
                className="h-10 pl-9"
                aria-label="ค้นหาใบกำกับภาษี"
              />
            </div>
            <YearMonthScopeSelects
              idPrefix="tax-inv"
              yearCe={yearFilterCe}
              monthScope={monthScope}
              yearOptionsCe={yearOptionsCe}
              onYearCeChange={setYearFilterCe}
              onMonthScopeChange={setMonthScope}
            />
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-10 gap-2"
              onClick={() => setPrintDialogOpen(true)}
            >
              <Printer className="h-4 w-4" /> พิมพ์รายการภาษีขาย
            </Button>

          <Dialog
            open={isAuthorized && canCreateInvoice && isDialogOpen}
            onOpenChange={(open) => {
              setIsDialogOpen(open);
              if (!open) {
                setSelectedCommercialId('');
                setShowWithholdingOnDocument(false);
              }
            }}
          >
            <DialogTrigger asChild>
              <Button
                className="h-10 shrink-0 gap-2 bg-primary px-6 text-base font-bold shadow-md"
                disabled={!canCreateInvoice}
              >
                <Plus className="h-5 w-5" /> สร้างใบกำกับภาษีร่าง
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>สร้างใบกำกับภาษีร่าง</DialogTitle>
                <DialogDescription>
                  เลือกใบแจ้งหนี้ที่ยืนยันแล้ว (ISSUED) ฉบับล่าสุดเท่านั้น — รุ่นที่ถูกแก้ไข (REVISED) หรือถูกแทนที่แล้วเลือกไม่ได้ และต้องยังไม่เคยออกใบกำกับภาษี
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 gap-4 py-4">
                <div className="space-y-2">
                  <Label>เลขที่ใบกำกับภาษี (คาดการณ์)</Label>
                  <Input value={getPreviewPattern('tax_invoice')} disabled className="bg-muted/50 font-mono font-bold text-primary" />
                  <p className="text-xs text-muted-foreground">เลขจริงออกตอนบันทึก</p>
                </div>
                <div className="space-y-2">
                  <Label>อ้างอิงใบแจ้งหนี้ (รายการเรียกเก็บ) *</Label>
                  <Select value={selectedCommercialId || undefined} onValueChange={setSelectedCommercialId}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="เลือกใบแจ้งหนี้ที่อนุมัติแล้ว..." /></SelectTrigger>
                    <SelectContent>
                      {availableCommercialInvoices.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.invoiceNo} | {customers?.find((x) => x.id === c.customerId)?.name ?? c.customerId} |{' '}
                          {c.currency ?? 'THB'} {c.totalAmount.toLocaleString()}
                        </SelectItem>
                      ))}
                      {availableCommercialInvoices.length === 0 && (
                        <div className="py-3 px-4 text-sm text-muted-foreground italic">
                          ไม่มีใบแจ้งหนี้ที่ยืนยันแล้วพร้อมออกใบกำกับ — ต้องเป็นฉบับล่าสุดที่สถานะยืนยันแล้ว และยังไม่เคยสร้างใบกำกับจากใบนั้น
                        </div>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
                  <Checkbox
                    id="ti-show-wht"
                    checked={showWithholdingOnDocument}
                    onCheckedChange={(c) => setShowWithholdingOnDocument(c === true)}
                  />
                  <div className="space-y-1">
                    <Label htmlFor="ti-show-wht" className="cursor-pointer font-semibold leading-snug">
                      แสดงยอดหัก ณ ที่จ่ายบนใบกำกับภาษี
                    </Label>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      ถ้าเลือก ระบบจะคำนวณจากยอดก่อน VAT × 3% และแสดงยอดสุทธิที่ต้องชำระหลังหัก — ถ้าไม่เลือก ออกยอดแบบปกติ (ฐานภาษี + VAT + ยอดรวมสุทธิ)
                    </p>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isCreating}>ยกเลิก</Button>
                <Button onClick={() => void handleCreate()} className="bg-primary font-bold" disabled={isCreating || !selectedCommercialId}>
                  {isCreating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  สร้างร่าง
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </div>
        </div>

        <Dialog open={printDialogOpen} onOpenChange={setPrintDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>พิมพ์รายการภาษีขาย</DialogTitle>
              <DialogDescription>
                เลือกพิมพ์ตามตัวกรองที่ตั้งไว้ หรือพิมพ์ทุกรายการในชุดข้อมูลล่าสุด (สูงสุด 500 รายการ)
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="rounded-md border bg-muted/30 p-3 space-y-1">
                <p className="font-semibold text-xs uppercase text-muted-foreground">ตัวกรองปัจจุบัน</p>
                <ul className="list-disc list-inside text-xs text-muted-foreground space-y-0.5">
                  {describeTaxInvoiceListPrintFilters(printFilterSummary).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <p className="text-xs font-medium pt-1">จะพิมพ์ {filteredInvoices.length} รายการ</p>
              </div>
              <p className="text-xs text-muted-foreground">
                ข้อมูลทั้งหมดในระบบ: {visibleInvoices.length} รายการ
              </p>
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                disabled={printBusy || filteredInvoices.length === 0}
                onClick={() => void runTaxInvoiceListPrint('filtered')}
              >
                <Printer className="h-4 w-4 mr-2" />
                พิมพ์ตามตัวกรอง ({filteredInvoices.length})
              </Button>
              <Button
                type="button"
                className="w-full sm:w-auto"
                disabled={printBusy || visibleInvoices.length === 0}
                onClick={() => void runTaxInvoiceListPrint('all')}
              >
                <Printer className="h-4 w-4 mr-2" />
                พิมพ์ทั้งหมด ({visibleInvoices.length})
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog
          open={deleteDialogOpen}
          onOpenChange={(open) => {
            setDeleteDialogOpen(open);
            if (!open) setDeleteTarget(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ลบใบกำกับภาษีและใบวางบิลที่คู่กัน?</AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <span>
                  จะลบถาวรเอกสาร{' '}
                  <strong className="font-mono">
                    {deleteTarget?.taxInvoiceNo || 'ร่าง (ยังไม่มีเลข)'}
                  </strong>{' '}
                  พร้อมใบวางบิลและรายการบรรทัด
                  {deleteTarget?.taxInvoiceNo
                    ? ' — เลข INV จะคืนเข้า pool เพื่อออกใหม่ได้โดยไม่หายจากระบบ'
                    : ''}
                  และคืนสิทธิ์สร้างใบกำกับจากใบเรียกเก็บเดิมได้ (ถ้ามี)
                </span>
                <span className="block text-xs">
                  ถ้าเลขนี้เป็นลำดับล่าสุดของเดือนในระบบ — เลขที่จะถูกนำกลับมาใช้เมื่อสร้างชุดใหม่ (ไม่กระโดดข้าม) ยกเว้นมีเลขถัดไปออกไปแล้ว
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>ยกเลิก</AlertDialogCancel>
              <Button
                variant="destructive"
                disabled={deleting}
                onClick={() => void handleConfirmDeleteTaxInvoice()}
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ลบถาวร'}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Card className="min-w-0 overflow-hidden border-none shadow-lg">
          <CardContent className="min-w-0 overflow-hidden p-0">
            {isLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูล...</div>
            ) : (
              <div className="min-w-0 [&>div]:overflow-hidden">
              <Table className={TAX_INV_LIST_TABLE}>
                <TaxInvoiceListColgroup showShare={showShareColumn} />
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead title="เลขที่ใบกำกับภาษี">เลขที่</TableHead>
                    <TableHead>ลูกค้า</TableHead>
                    <TableHead>วันที่ออก</TableHead>
                    <TableHead title="เลขที่ใบเสร็จ">ใบเสร็จ</TableHead>
                    <TableHead className="text-right">ก่อนภาษี</TableHead>
                    <TableHead className="text-right">ภาษี</TableHead>
                    <TableHead className="text-right" title="ยอดรวมสุทธิ">ยอดสุทธิ</TableHead>
                    <TableHead className="text-right">หัก ณ ที่จ่าย</TableHead>
                    <TableHead className="text-right">ยอดรับสุทธิ</TableHead>
                    <TableHead>ผู้สร้าง</TableHead>
                    {showShareColumn && (
                      <TableHead className="text-center">แชร์</TableHead>
                    )}
                    <TableHead className="text-center">สถานะ</TableHead>
                    <TableHead className="text-right pr-2"> </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredInvoices.map((inv) => {
                    const customer = customers?.find(c => c.id === inv.customerId);
                    const receiptNo = resolveReceiptNo(inv);
                    const whtAmt = taxInvoiceWhtAmount(inv);
                    const netReceived = roundMoney2((Number(inv.totalAmount) || 0) - whtAmt);
                    const hasWhtDoc = (inv.whtAttachments?.length ?? 0) > 0;
                    const creatorName = documentCreatorDisplayName(inv);
                    return (
                      <TableRow 
                        key={inv.id} 
                        className="cursor-pointer hover:bg-muted/30 group transition-all" 
                        onClick={() => router.push(`/tax-invoices/${inv.id}`)}
                      >
                        <TableCell className="max-w-0 font-bold text-primary font-mono">
                          <span className="block truncate" title={inv.taxInvoiceNo || 'รอออกเลข'}>
                            {inv.taxInvoiceNo || (
                              <span className="text-muted-foreground font-sans font-semibold">รอออกเลข…</span>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-0">
                          <span className="block truncate font-semibold text-primary" title={customer?.name || 'N/A'}>
                            {customer?.name || 'N/A'}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground whitespace-nowrap">
                          {formatStoredDateThaiBE(inv.issueDate)}
                        </TableCell>
                        <TableCell className="max-w-0 font-mono text-muted-foreground">
                          <span className="block truncate" title={receiptNo}>{receiptNo}</span>
                        </TableCell>
                        <TableCell className="text-right font-mono text-[10px] tabular-nums tracking-tight whitespace-nowrap">
                          {formatTaxInvoiceMoneyPlain(inv.taxableAmount ?? 0)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-[10px] tabular-nums tracking-tight whitespace-nowrap">
                          {formatTaxInvoiceMoneyPlain(inv.vatAmount ?? 0)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-[10px] font-bold text-primary tabular-nums tracking-tight whitespace-nowrap">
                          {formatTaxInvoiceMoneyPlain(inv.totalAmount ?? 0)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-[10px] tabular-nums tracking-tight whitespace-nowrap">
                          {whtAmt > 0 ? (
                            <span className="inline-flex items-center justify-end gap-0.5">
                              {formatTaxInvoiceMoneyPlain(whtAmt)}
                              {!hasWhtDoc ? (
                                <span title="ยังไม่มีเอกสารแนบหัก ณ ที่จ่าย">
                                  <AlertTriangle
                                    className="h-3 w-3 shrink-0 text-amber-500 stroke-[2.5] stroke-red-600 fill-amber-300"
                                    aria-label="ยังไม่มีเอกสารแนบหัก ณ ที่จ่าย"
                                  />
                                </span>
                              ) : null}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-[10px] font-semibold tabular-nums tracking-tight whitespace-nowrap">
                          {formatTaxInvoiceMoneyPlain(netReceived)}
                        </TableCell>
                        <TableCell className="max-w-0">
                          <span className="block truncate" title={creatorName}>{creatorName}</span>
                        </TableCell>
                        {showShareColumn && (
                          <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                            <DocumentShareListMarker
                              collectionName="tax_invoices"
                              documentId={inv.id}
                              currentUser={currentUser}
                              sharedWith={inv.sharedWith}
                              sharedWithUids={inv.sharedWithUids}
                              className="h-7 w-7"
                            />
                          </TableCell>
                        )}
                        <TableCell className="text-center">
                          {getStatusBadge(inv.status)}
                        </TableCell>
                        <TableCell className="text-right pr-2">
                          <div className="inline-flex items-center justify-end">
                            {canAdminDelete && inv.status !== 'ISSUED' && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                                title="ลบชุดเอกสาร (ผู้ดูแลระบบ)"
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteTarget(inv);
                                  setDeleteDialogOpen(true);
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 group-hover:text-primary"
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(`/tax-invoices/${inv.id}`);
                              }}
                            >
                              <ChevronRight className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!isLoading && visibleInvoices.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={showShareColumn ? 13 : 12} className="py-20 text-center italic text-muted-foreground">
                        ไม่มีรายการใบกำกับภาษีในระบบ
                      </TableCell>
                    </TableRow>
                  )}
                  {!isLoading && visibleInvoices.length > 0 && filteredInvoices.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={showShareColumn ? 13 : 12} className="py-20 text-center text-muted-foreground">
                        ไม่พบรายการที่ตรงกับการค้นหาหรือเดือนที่เลือก
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
