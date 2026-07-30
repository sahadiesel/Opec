
'use client';

import { useMemo, useState, useCallback } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  ArrowUpRight,
  Search,
  Building2,
  Calendar,
  Clock,
  Info,
  Loader2,
  Trash2,
  Printer,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { AccountsReceivable, ARStatus, User, Customer, TaxInvoice, CommercialInvoice } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';
import { collection, query, orderBy, doc, getDoc, where } from 'firebase/firestore';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { formatStoredDateThaiBE, formatYmdLocalThaiBE } from '@/lib/date-thai';
import {
  buildYearCeOptions,
  currentMonthMm,
  currentYearCe,
  describeYearMonthScopeFilter,
  ymMatchesYearMonthScope,
} from '@/lib/date/year-month-scope-filter';
import { YearMonthScopeSelects } from '@/components/accounting/year-month-scope-selects';
import { isSystemAdmin } from '@/lib/permission-core';
import { deleteAccountsReceivableEntryAsAdmin } from '@/lib/services/accounts-receivable-delete-service';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  buildAccountsReceivableListPrintHtml,
  capAccountsReceivableListPrintRows,
  describeAccountsReceivableListPrintFilters,
  type AccountsReceivableListPrintRow,
} from '@/lib/documents/accounts-receivable-list-print';
import { openStandardPrintWindow } from '@/lib/documents/standard-document-print';
import {
  buildSupersededCommercialInvoiceIds,
  filterSupersededCommercialArEntries,
} from '@/lib/accounts-receivable/ar-list-display';

function formatArMoney(amount: number): string {
  return `฿ ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function arStatusPrintLabel(status: ARStatus): string {
  if (status === 'PARTIALLY_PAID') return 'PARTIAL';
  return status;
}

export default function AccountsReceivablePage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const canAdminDeleteAr = useMemo(() => !!currentUser && isSystemAdmin(currentUser), [currentUser]);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<(AccountsReceivable & { id: string }) | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [yearFilterCe, setYearFilterCe] = useState(() => currentYearCe());
  const [monthScope, setMonthScope] = useState(() => currentMonthMm());
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);

  const isAuthorized = useMemo(
    () => !!currentUser && canView(currentUser, 'accounts_receivable'),
    [currentUser]
  );

  const arQuery = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return query(collection(firestore, 'accounts_receivable'), orderBy('issueDate', 'desc'));
  }, [firestore, isAuthorized]);

  const { data: arItems, isLoading } = useCollection<AccountsReceivable>(arQuery as any);

  const taxInvoicesQuery = useMemoFirebase(
    () => (firestore && isAuthorized ? query(collection(firestore, 'tax_invoices'), where('status', '==', 'ISSUED')) : null),
    [firestore, isAuthorized],
  );
  const { data: issuedTaxInvoices } = useCollection<TaxInvoice>(taxInvoicesQuery as any);

  const commercialQuery = useMemoFirebase(
    () => (firestore && isAuthorized ? collection(firestore, 'commercial_invoices') : null),
    [firestore, isAuthorized],
  );
  const { data: commercialInvoices } = useCollection<CommercialInvoice>(commercialQuery as any);

  const customersQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'customers') : null), [firestore, isAuthorized]);
  const { data: customers } = useCollection<Customer>(customersQuery as any);

  const customerById = useMemo(() => {
    const m = new Map<string, Customer>();
    for (const c of customers ?? []) m.set(c.id, c);
    return m;
  }, [customers]);

  const supersededCommercialIds = useMemo(
    () =>
      buildSupersededCommercialInvoiceIds({
        taxInvoices: issuedTaxInvoices,
        commercialInvoices,
      }),
    [issuedTaxInvoices, commercialInvoices],
  );

  const visibleArItems = useMemo(
    () => filterSupersededCommercialArEntries(arItems ?? [], supersededCommercialIds),
    [arItems, supersededCommercialIds],
  );

  const yearOptionsCe = useMemo(() => {
    const set = new Set<string>();
    for (const item of visibleArItems) {
      const ym = String(item.issueDate || '').slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(ym)) set.add(ym);
    }
    return buildYearCeOptions(set);
  }, [visibleArItems]);

  const periodLabel = useMemo(
    () => describeYearMonthScopeFilter(yearFilterCe, monthScope),
    [yearFilterCe, monthScope],
  );

  const monthFilteredItems = useMemo(() => {
    return visibleArItems.filter((item) =>
      ymMatchesYearMonthScope(String(item.issueDate || '').slice(0, 7), yearFilterCe, monthScope),
    );
  }, [visibleArItems, yearFilterCe, monthScope]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return monthFilteredItems;
    return monthFilteredItems.filter((item) => {
      const customer = customerById.get(item.customerId);
      const haystack = [
        item.documentNo,
        item.referenceId,
        item.referenceNo,
        item.issueDate,
        item.dueDate,
        item.status,
        customer?.name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [monthFilteredItems, searchQuery, customerById]);

  const stats = useMemo(() => {
    return {
      globalOutstanding: visibleArItems.reduce((sum, item) => sum + item.outstandingAmount, 0),
      monthOutstanding: monthFilteredItems.reduce((sum, item) => sum + item.outstandingAmount, 0),
      overdue: monthFilteredItems
        .filter((item) => item.status === 'OVERDUE')
        .reduce((sum, item) => sum + item.outstandingAmount, 0),
      collected: monthFilteredItems.reduce((sum, item) => sum + item.creditAmount, 0),
    };
  }, [visibleArItems, monthFilteredItems]);

  const printFilterSummary = useMemo(
    () => ({ searchTerm: searchQuery, yearCe: yearFilterCe, monthScope }),
    [searchQuery, yearFilterCe, monthScope],
  );

  const buildPrintRows = useCallback(
    (list: AccountsReceivable[]): AccountsReceivableListPrintRow[] =>
      list.map((item) => {
        const customer = customerById.get(item.customerId);
        return {
          customerName: customer?.name || 'N/A',
          documentNo: item.documentNo || '—',
          issueDateLabel: formatStoredDateThaiBE(item.issueDate),
          dueDate: item.dueDate || '—',
          debitLabel: formatArMoney(item.debitAmount ?? 0),
          creditLabel: formatArMoney(item.creditAmount ?? 0),
          outstandingLabel: formatArMoney(item.outstandingAmount ?? 0),
          status: arStatusPrintLabel(item.status),
        };
      }),
    [customerById],
  );

  const runAccountsReceivableListPrint = useCallback(
    async (scope: 'filtered' | 'all') => {
      const source = scope === 'filtered' ? filteredItems : visibleArItems;
      if (source.length === 0) {
        toast({
          variant: 'destructive',
          title: 'ไม่มีรายการให้พิมพ์',
          description:
            scope === 'filtered'
              ? 'ไม่พบข้อมูลตามตัวกรอง — ปรับตัวกรองหรือเลือกพิมพ์ทั้งหมด'
              : 'ยังไม่มีรายการลูกหนี้ในระบบ',
        });
        return;
      }

      setPrintBusy(true);
      try {
        const { rows, truncated } = capAccountsReceivableListPrintRows(buildPrintRows(source));
        const generatedAt = new Date().toLocaleString('th-TH', {
          dateStyle: 'medium',
          timeStyle: 'short',
        });
        const filterLines =
          scope === 'filtered' ? describeAccountsReceivableListPrintFilters(printFilterSummary) : [];
        const scopeTitle =
          scope === 'filtered' ? 'พิมพ์ตามตัวกรองปัจจุบัน' : 'พิมพ์ทั้งหมด (ในชุดข้อมูลล่าสุด)';

        const body = buildAccountsReceivableListPrintHtml({
          rows,
          scopeTitle,
          filterLines,
          generatedAt,
          printedBy: currentUser?.displayName,
          truncated,
        });

        const ok = await openStandardPrintWindow({
          windowTitle: 'Accounts-Receivable-List',
          suggestedFileName: `Accounts-Receivable-List-${scope === 'filtered' ? 'Filtered' : 'All'}`,
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
    [filteredItems, visibleArItems, buildPrintRows, printFilterSummary, currentUser?.displayName, toast],
  );

  const handleConfirmDeleteAr = async () => {
    if (!firestore || !currentUser || !deleteTarget) return;
    setDeleting(true);
    try {
      await deleteAccountsReceivableEntryAsAdmin(firestore, deleteTarget.id, currentUser as User);
      toast({
        title: 'ลบรายการลูกหนี้แล้ว',
        description: `เลขที่ ${deleteTarget.documentNo} — หากเป็นเลขล่าสุดของปี ระบบจะคืนลำดับเลข AR`,
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

  const openDeleteArDialog = async (item: AccountsReceivable & { id: string }) => {
    if (!firestore || item.referenceType !== 'TAX_INVOICE') {
      toast({
        variant: 'destructive',
        title: 'ลบจากเมนูนี้ไม่ได้',
        description: 'รองรับเฉพาะรายการที่อ้างใบกำกับภาษี',
      });
      return;
    }
    const taxSnap = await getDoc(doc(firestore, 'tax_invoices', item.referenceId));
    if (!taxSnap.exists()) {
      setDeleteTarget(item);
      setDeleteDialogOpen(true);
      return;
    }
    const tax = { ...taxSnap.data(), id: taxSnap.id } as TaxInvoice;
    if (tax.status !== 'CANCELLED') {
      toast({
        variant: 'destructive',
        title: 'ยังลบไม่ได้',
        description: 'ต้องไปยกเลิกใบกำกับภาษีให้เป็นสถานะ CANCELLED ก่อน',
      });
      return;
    }
    setDeleteTarget(item);
    setDeleteDialogOpen(true);
  };

  const getStatusBadge = (status: ARStatus) => {
    switch (status) {
      case 'OPEN': return <Badge variant="outline" className="border-blue-200 text-blue-700 bg-blue-50">OPEN</Badge>;
      case 'PARTIALLY_PAID': return <Badge variant="outline" className="border-amber-200 text-amber-700 bg-amber-50">PARTIAL</Badge>;
      case 'PAID': return <Badge className="bg-green-600">PAID</Badge>;
      case 'OVERDUE': return <Badge variant="destructive">OVERDUE</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isUserLoading || userLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <ArrowUpRight className="h-8 w-8" /> ลูกหนี้การค้า (Accounts Receivable)
          </h1>
          <p className="text-muted-foreground text-lg">
            ติดตามยอดค้างชำระจากลูกค้า แยกตามรายใบกำกับภาษีและวันครบกำหนด
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <Card className="border-l-8 border-l-blue-600">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase text-muted-foreground">ยอดลูกหนี้ค้างชำระทั้งหมด</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-primary">฿ {stats.globalOutstanding.toLocaleString()}</div>
              <p className="text-[10px] text-muted-foreground mt-1">ทุกรายการในระบบ — ไม่กรองตามเดือน</p>
            </CardContent>
          </Card>
          <Card className="border-l-8 border-l-indigo-600">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase text-muted-foreground">ยอดค้างชำระตามเดือน</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-indigo-700">฿ {stats.monthOutstanding.toLocaleString()}</div>
              <p className="text-[10px] text-muted-foreground mt-1">
                งวด {periodLabel} · จากใบในเดือนที่เลือก
              </p>
            </CardContent>
          </Card>
          <Card className="border-l-8 border-l-red-600">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase text-muted-foreground">ลูกหนี้เกินกำหนด (Overdue)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-red-600">฿ {stats.overdue.toLocaleString()}</div>
              <p className="text-[10px] text-muted-foreground mt-1">
                งวด {periodLabel} · หนี้เกินกำหนดในเดือนที่เลือก
              </p>
            </CardContent>
          </Card>
          <Card className="border-l-8 border-l-green-600">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase text-muted-foreground">ยอดเรียกเก็บได้แล้ว (MTD)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-green-700">฿ {stats.collected.toLocaleString()}</div>
              <p className="text-[10px] text-muted-foreground mt-1">
                งวด {periodLabel} · ยอดรับแล้วในเดือนที่เลือก
              </p>
            </CardContent>
          </Card>
        </div>

        <Alert className="bg-primary/5 border-primary/20 shadow-sm">
          <Info className="h-5 w-5 text-primary" />
          <AlertTitle className="font-bold text-lg">Aging Report Policy</AlertTitle>
          <AlertDescription className="text-sm">
            ระบบจะคำนวณสถานะ OVERDUE อัตโนมัติเมื่อพ้นกำหนดชำระ (Due Date) — บันทึกการรับชำระและปิดลูกหนี้ผ่านบัญชี (Cashbook / ปรับสถานะ AR) ตามนโยบายบริษัท
          </AlertDescription>
        </Alert>

        <AlertDialog
          open={deleteDialogOpen}
          onOpenChange={(open) => {
            setDeleteDialogOpen(open);
            if (!open) setDeleteTarget(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ลบรายการลูกหนี้นี้?</AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <span>
                  จะลบถาวร <strong className="font-mono">{deleteTarget?.documentNo}</strong> และถอนการอ้างอิงจากใบกำกับภาษี (ถ้ามี)
                </span>
                <span className="block text-xs text-muted-foreground">
                  ใช้ได้เมื่อยังไม่มีการรับชำระจริงในรายการนี้ และใบกำกับถูกยกเลิกแล้ว (ไม่มีใบเสร็จ / ไม่ยืนยันรับเงิน — การแจ้งชำระอย่างเดียวไม่บล็อกการลบ)
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>ยกเลิก</AlertDialogCancel>
              <Button variant="destructive" disabled={deleting} onClick={() => void handleConfirmDeleteAr()}>
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ลบถาวร'}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div className="flex flex-col gap-3 bg-card p-4 rounded-lg border shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 basis-full sm:basis-auto sm:min-w-[14rem] sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="ค้นหาชื่อลูกค้า หรือ เลขที่เอกสาร..."
                className="pl-9 h-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="ค้นหาลูกหนี้"
              />
            </div>
            <YearMonthScopeSelects
              idPrefix="ar"
              yearCe={yearFilterCe}
              monthScope={monthScope}
              yearOptionsCe={yearOptionsCe}
              onYearCeChange={setYearFilterCe}
              onMonthScopeChange={setMonthScope}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-10 shrink-0 gap-2"
            onClick={() => setPrintDialogOpen(true)}
          >
            <Printer className="h-4 w-4" /> พิมพ์รายการ
          </Button>
        </div>

        <Dialog open={printDialogOpen} onOpenChange={setPrintDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>พิมพ์รายการลูกหนี้การค้า</DialogTitle>
              <DialogDescription>
                เลือกพิมพ์ตามตัวกรองเดือน/ค้นหาปัจจุบัน หรือพิมพ์ทุกรายการในชุดข้อมูลล่าสุด (สูงสุด 500 รายการ)
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="rounded-md border bg-muted/30 p-3 space-y-1">
                <p className="font-semibold text-xs uppercase text-muted-foreground">ตัวกรองปัจจุบัน</p>
                <ul className="list-disc list-inside text-xs text-muted-foreground">
                  {describeAccountsReceivableListPrintFilters(printFilterSummary).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <p className="text-xs font-medium pt-1">จะพิมพ์ {filteredItems.length} รายการ</p>
              </div>
              <p className="text-xs text-muted-foreground">ข้อมูลทั้งหมดในระบบ: {visibleArItems.length} รายการ</p>
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                disabled={printBusy || filteredItems.length === 0}
                onClick={() => void runAccountsReceivableListPrint('filtered')}
              >
                <Printer className="h-4 w-4 mr-2" />
                พิมพ์ตามตัวกรอง ({filteredItems.length})
              </Button>
              <Button
                type="button"
                className="w-full sm:w-auto"
                disabled={printBusy || visibleArItems.length === 0}
                onClick={() => void runAccountsReceivableListPrint('all')}
              >
                <Printer className="h-4 w-4 mr-2" />
                พิมพ์ทั้งหมด ({visibleArItems.length})
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลลูกหนี้...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4 pl-6">ลูกค้า (Customer)</TableHead>
                    <TableHead className="font-bold">เอกสารอ้างอิง</TableHead>
                    <TableHead className="font-bold">วันที่ออก / ครบกำหนด</TableHead>
                    <TableHead className="font-bold text-right">ยอดขาย (Debit)</TableHead>
                    <TableHead className="font-bold text-right">รับแล้ว (Credit)</TableHead>
                    <TableHead className="font-bold text-right">คงเหลือ</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                    <TableHead className="text-right pr-6 font-bold">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item) => {
                    const customer = customerById.get(item.customerId);
                    const row = item as AccountsReceivable & { id: string };
                    const showTrash =
                      canAdminDeleteAr &&
                      row.referenceType === 'TAX_INVOICE' &&
                      row.creditAmount <= 0.005;
                    return (
                      <TableRow key={item.id} className="hover:bg-muted/20">
                        <TableCell className="py-4 pl-6">
                          <div className="flex items-center gap-2 text-sm font-bold text-primary">
                            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                            {customer?.name || 'N/A'}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs font-bold text-primary">{item.documentNo}</TableCell>
                        <TableCell>
                          <div className="flex flex-col text-[10px]">
                            <span className="flex items-center gap-1 text-muted-foreground"><Calendar className="h-2.5 w-2.5" /> {formatStoredDateThaiBE(item.issueDate)}</span>
                            <span className="flex items-center gap-1 font-bold text-red-600"><Clock className="h-2.5 w-2.5" /> Due: {formatYmdLocalThaiBE(item.dueDate)}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">฿ {item.debitAmount.toLocaleString()}</TableCell>
                        <TableCell className="text-right text-sm text-green-600 tabular-nums">฿ {item.creditAmount.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-black text-primary tabular-nums">฿ {item.outstandingAmount.toLocaleString()}</TableCell>
                        <TableCell>{getStatusBadge(item.status)}</TableCell>
                        <TableCell className="text-right pr-6">
                          {showTrash ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              type="button"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              title="ลบรายการลูกหนี้ (ผู้ดูแลระบบ)"
                              onClick={() => void openDeleteArDialog(row)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {(!visibleArItems.length) && !isLoading && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-20 text-muted-foreground italic">
                        ไม่มีรายการลูกหนี้ในระบบ
                      </TableCell>
                    </TableRow>
                  )}
                  {visibleArItems.length > 0 && filteredItems.length === 0 && !isLoading && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-20 text-muted-foreground italic">
                        {searchQuery.trim()
                          ? `ไม่พบรายการที่ตรงกับ "${searchQuery.trim()}" ในงวด ${periodLabel}`
                          : `ไม่มีรายการลูกหนี้ในงวด ${periodLabel}`}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
