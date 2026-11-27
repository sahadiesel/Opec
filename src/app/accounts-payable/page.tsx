
'use client';

import { useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  ArrowDownLeft,
  Building2,
  Calendar,
  Clock,
  Info,
  Printer,
} from 'lucide-react';
import { AccountsPayable, APStatus, PurchaseVendorBill, Vendor } from '@/lib/types';
import { StatusBadge } from '@/components/ui/status-badge';
import { apStatusBadge } from '@/lib/accounts-payable/ap-status-badge';
import { apAsOfYmd, resolveApEffectiveStatus } from '@/lib/accounts-payable/ap-effective-status';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';
import { collection, orderBy, query, where } from 'firebase/firestore';
import {
  cancelledVendorBillApKeys,
  isApFromCancelledVendorBill,
} from '@/lib/accounts-payable/cancelled-vendor-bill-ap';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { formatYmdLocalThaiBE } from '@/lib/date-thai';
import { useToast } from '@/hooks/use-toast';
import {
  buildYearCeOptions,
  currentMonthMm,
  currentYearCe,
  describeYearMonthScopeFilter,
  ymMatchesYearMonthScope,
} from '@/lib/date/year-month-scope-filter';
import { DocumentListFilterBar } from '@/components/documents/document-list-filter-bar';
import { DocumentStatusFilterSelect } from '@/components/documents/document-status-filter-select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  buildAccountsPayableListPrintHtml,
  capAccountsPayableListPrintRows,
  describeAccountsPayableListPrintFilters,
  type AccountsPayableListPrintRow,
} from '@/lib/documents/accounts-payable-list-print';
import { openStandardPrintWindow } from '@/lib/documents/standard-document-print';

function formatApMoney(amount: number): string {
  return `฿ ${amount.toLocaleString()}`;
}

function apStatusPrintLabel(status: APStatus | 'CANCELLED'): string {
  if (status === 'CANCELLED') return 'ยกเลิก';
  if (status === 'PARTIALLY_PAID') return 'PARTIAL';
  return status;
}
export default function AccountsPayablePage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const isAuthorized = useMemo(
    () => !!currentUser && canView(currentUser, 'accounts_payable'),
    [currentUser]
  );

  const apQuery = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return query(collection(firestore, 'accounts_payable'), orderBy('billDate', 'desc'));
  }, [firestore, isAuthorized]);

  const { data: apItems, isLoading } = useCollection<AccountsPayable>(apQuery as any);

  const cancelledBillsQuery = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return query(collection(firestore, 'purchase_vendor_bills'), where('status', '==', 'CANCELLED'));
  }, [firestore, isAuthorized]);
  const { data: cancelledBills } = useCollection<PurchaseVendorBill>(cancelledBillsQuery as any);
  const cancelledApKeys = useMemo(
    () => cancelledVendorBillApKeys(cancelledBills ?? []),
    [cancelledBills],
  );

  const vendorsQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'vendors') : null), [firestore, isAuthorized]);
  const { data: vendors } = useCollection<Vendor>(vendorsQuery as any);

  const [searchQuery, setSearchQuery] = useState('');
  /** ทุกรายการ | จ่ายแล้ว | ยังไม่จ่าย — แบบเดียวกับหน้าลูกหนี้ */
  const [statusFilter, setStatusFilter] = useState<'all' | 'paid' | 'unpaid'>('all');
  const [yearFilterCe, setYearFilterCe] = useState(() => currentYearCe());
  const [monthScope, setMonthScope] = useState(() => currentMonthMm());
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);
  const vendorById = useMemo(() => {
    const m = new Map<string, Vendor>();
    for (const v of vendors ?? []) m.set(v.id, v);
    return m;
  }, [vendors]);

  const yearOptionsCe = useMemo(
    () => buildYearCeOptions((apItems ?? []).map((item) => String(item.billDate || '').slice(0, 7))),
    [apItems],
  );

  const asOfYmd = useMemo(() => apAsOfYmd(), []);

  const monthFilteredItems = useMemo(() => {
    const list = apItems ?? [];
    return list.filter((item) =>
      ymMatchesYearMonthScope(String(item.billDate || '').slice(0, 7), yearFilterCe, monthScope),
    );
  }, [apItems, yearFilterCe, monthScope]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return monthFilteredItems.filter((item) => {
      const cancelled = isApFromCancelledVendorBill(item, cancelledApKeys);
      const effective = cancelled ? 'CANCELLED' : resolveApEffectiveStatus(item, asOfYmd);
      if (statusFilter === 'paid' && effective !== 'PAID') return false;
      if (statusFilter === 'unpaid' && (effective === 'PAID' || effective === 'CANCELLED')) return false;
      if (!q) return true;
      const vendor = vendorById.get(item.vendorId);
      const haystack = [
        item.documentNo,
        item.referenceId,
        item.billDate,
        item.dueDate,
        effective,
        vendor?.vendorName,
        vendor?.vendorCode,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [monthFilteredItems, searchQuery, statusFilter, vendorById, asOfYmd, cancelledApKeys]);

  const stats = useMemo(() => {
    const countsAsOpen = (item: AccountsPayable) => !isApFromCancelledVendorBill(item, cancelledApKeys);
    const all = (apItems ?? []).filter(countsAsOpen);
    const monthOpen = monthFilteredItems.filter(countsAsOpen);
    return {
      globalOutstanding: all.reduce((sum, item) => sum + item.outstandingAmount, 0),
      monthOutstanding: monthOpen.reduce((sum, item) => sum + item.outstandingAmount, 0),
      overdue: monthOpen
        .filter((item) => resolveApEffectiveStatus(item, asOfYmd) === 'OVERDUE')
        .reduce((sum, item) => sum + item.outstandingAmount, 0),
      paid: monthFilteredItems.reduce((sum, item) => sum + item.creditAmount, 0),
    };
  }, [apItems, monthFilteredItems, asOfYmd, cancelledApKeys]);

  const periodLabel = useMemo(
    () => describeYearMonthScopeFilter(yearFilterCe, monthScope),
    [yearFilterCe, monthScope],
  );

  const printFilterSummary = useMemo(
    () => ({
      searchTerm: searchQuery,
      monthYyyyMm: periodLabel,
      statusFilter,
    }),
    [searchQuery, periodLabel, statusFilter],
  );

  const buildPrintRows = useCallback(
    (list: AccountsPayable[]): AccountsPayableListPrintRow[] =>
      list.map((item) => {
        const vendor = vendorById.get(item.vendorId);
        return {
          vendorName: vendor?.vendorName || 'N/A',
          documentNo: item.documentNo || '—',
          billDate: formatYmdLocalThaiBE(item.billDate),
          dueDate: formatYmdLocalThaiBE(item.dueDate),
          debitLabel: formatApMoney(item.debitAmount ?? 0),
          creditLabel: formatApMoney(item.creditAmount ?? 0),
          outstandingLabel: formatApMoney(
            isApFromCancelledVendorBill(item, cancelledApKeys) ? 0 : item.outstandingAmount ?? 0,
          ),
          status: apStatusPrintLabel(
            isApFromCancelledVendorBill(item, cancelledApKeys)
              ? 'CANCELLED'
              : resolveApEffectiveStatus(item, asOfYmd),
          ),
        };
      }),
    [vendorById, asOfYmd, cancelledApKeys],
  );

  const runAccountsPayableListPrint = useCallback(
    async (scope: 'filtered' | 'all') => {
      const source = scope === 'filtered' ? filteredItems : apItems ?? [];
      if (source.length === 0) {
        toast({
          variant: 'destructive',
          title: 'ไม่มีรายการให้พิมพ์',
          description:
            scope === 'filtered'
              ? 'ไม่พบข้อมูลตามตัวกรอง — ปรับตัวกรองหรือเลือกพิมพ์ทั้งหมด'
              : 'ยังไม่มีรายการเจ้าหนี้ในระบบ',
        });
        return;
      }

      setPrintBusy(true);
      try {
        const { rows, truncated } = capAccountsPayableListPrintRows(buildPrintRows(source));
        const generatedAt = new Date().toLocaleString('th-TH', {
          dateStyle: 'medium',
          timeStyle: 'short',
        });
        const filterLines =
          scope === 'filtered' ? describeAccountsPayableListPrintFilters(printFilterSummary) : [];
        const scopeTitle =
          scope === 'filtered' ? 'พิมพ์ตามตัวกรองปัจจุบัน' : 'พิมพ์ทั้งหมด (ในชุดข้อมูลล่าสุด)';

        const body = buildAccountsPayableListPrintHtml({
          rows,
          scopeTitle,
          filterLines,
          generatedAt,
          printedBy: currentUser?.displayName,
          truncated,
        });

        const ok = await openStandardPrintWindow({
          windowTitle: 'Accounts-Payable-List',
          suggestedFileName: `Accounts-Payable-List-${scope === 'filtered' ? 'Filtered' : 'All'}`,
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
    [filteredItems, apItems, buildPrintRows, printFilterSummary, currentUser?.displayName, toast],
  );

  const getStatusBadge = (status: APStatus | 'CANCELLED') => <StatusBadge {...apStatusBadge(status)} />;

  if (isUserLoading || userLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <ArrowDownLeft className="h-8 w-8" /> เจ้าหนี้การค้า (Accounts Payable)
          </h1>
          <p className="text-muted-foreground text-lg">
            ติดตามยอดค้างจ่ายคู่ค้า แยกตามรายใบแจ้งหนี้และวันครบกำหนด
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <Card className="border-l-8 border-l-blue-600">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase text-muted-foreground">ยอดเจ้าหนี้ค้างจ่ายทั้งหมด</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-primary">฿ {stats.globalOutstanding.toLocaleString()}</div>
              <p className="text-[10px] text-muted-foreground mt-1">ทุกรายการในระบบ — ไม่กรองตามเดือน</p>
            </CardContent>
          </Card>
          <Card className="border-l-8 border-l-indigo-600">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase text-muted-foreground">ยอดค้างจ่ายตามเดือน</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-indigo-700">฿ {stats.monthOutstanding.toLocaleString()}</div>
              <p className="text-[10px] text-muted-foreground mt-1">
                งวด {periodLabel} · จากใบในช่วงที่เลือก
              </p>
            </CardContent>
          </Card>
          <Card className="border-l-8 border-l-red-600">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase text-muted-foreground">หนี้เกินกำหนด (Overdue)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-red-600">฿ {stats.overdue.toLocaleString()}</div>
              <p className="text-[10px] text-muted-foreground mt-1">
                งวด {periodLabel} · หนี้เกินกำหนดในช่วงที่เลือก
              </p>
            </CardContent>
          </Card>
          <Card className="border-l-8 border-l-green-600">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase text-muted-foreground">ยอดชำระแล้ว (MTD)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-green-700">฿ {stats.paid.toLocaleString()}</div>
              <p className="text-[10px] text-muted-foreground mt-1">
                งวด {periodLabel} · ยอดจ่ายแล้วในช่วงที่เลือก
              </p>
            </CardContent>
          </Card>
        </div>

        <Alert className="bg-primary/5 border-primary/20 shadow-sm">
          <Info className="h-5 w-5 text-primary" />
          <AlertTitle className="font-bold text-lg">Payment Planning Policy</AlertTitle>
          <AlertDescription className="text-sm">
            กรุณาตรวจสอบวันครบกำหนดชำระ (Due Date) เพื่อวางแผนกระแสเงินสด ระบบจะสร้างรายการ Cashbook อัตโนมัติเมื่อมีการบันทึกการจ่ายเงินในโมดูลที่เกี่ยวข้อง
          </AlertDescription>
        </Alert>

        <Alert className="border-amber-200 bg-amber-50/80">
          <Info className="h-5 w-5 text-amber-800" />
          <AlertTitle className="font-bold text-amber-950">แหล่งรายการเจ้าหนี้</AlertTitle>
          <AlertDescription className="text-sm text-amber-900 space-y-1.5">
            <p>
              <strong>ใบรับวางบิลคลัง/PO</strong> — เมื่อส่งจากเมนู{' '}
              <Link href="/ap-bills" className="font-semibold underline">
                รับวางบิลเจ้าหนี้ (AP Bills)
              </Link>{' '}
              จะปรากฏที่นี่และในคิว{' '}
              <Link href="/accounting/vendor-bills-payout" className="font-semibold underline">
                รายการรอจ่ายเจ้าหนี้
              </Link>
            </p>
            <p>
              <strong>สัญญาเช่า</strong> — รอบค่าเช่าถูกสร้างอัตโนมัติเมื่อครบกำหนด (ไม่ผ่าน AP Bills) ดูและทำจ่ายที่หน้ารายละเอียดสัญญา
              หรือที่คิวรอจ่ายเจ้าหนี้ด้านบน
            </p>
          </AlertDescription>
        </Alert>

        <DocumentListFilterBar
          idPrefix="ap"
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="ค้นหาชื่อคู่ค้า หรือ เลขที่เอกสาร..."
          searchAriaLabel="ค้นหาเจ้าหนี้"
          yearCe={yearFilterCe}
          monthScope={monthScope}
          yearOptionsCe={yearOptionsCe}
          onYearCeChange={setYearFilterCe}
          onMonthScopeChange={setMonthScope}
          extraFilters={
            <DocumentStatusFilterSelect
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as 'all' | 'paid' | 'unpaid')}
              allLabel="ทุกรายการ"
              ariaLabel="กรองตามการจ่าย"
              options={[
                { value: 'paid', label: 'เฉพาะที่จ่ายแล้ว' },
                { value: 'unpaid', label: 'เฉพาะที่ยังไม่จ่าย' },
              ]}
            />
          }
          actions={
            <Button
              type="button"
              variant="outline"
              className="h-11 shrink-0 gap-2"
              onClick={() => setPrintDialogOpen(true)}
            >
              <Printer className="h-4 w-4" /> พิมพ์รายการ
            </Button>
          }
        />

        <Dialog open={printDialogOpen} onOpenChange={setPrintDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>พิมพ์รายการเจ้าหนี้การค้า</DialogTitle>
              <DialogDescription>
                เลือกพิมพ์ตามตัวกรองเดือน/ค้นหาปัจจุบัน หรือพิมพ์ทุกรายการในชุดข้อมูลล่าสุด (สูงสุด 500 รายการ)
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="rounded-md border bg-muted/30 p-3 space-y-1">
                <p className="font-semibold text-xs uppercase text-muted-foreground">ตัวกรองปัจจุบัน</p>
                <ul className="list-disc list-inside text-xs text-muted-foreground">
                  {describeAccountsPayableListPrintFilters(printFilterSummary).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <p className="text-xs font-medium pt-1">จะพิมพ์ {filteredItems.length} รายการ</p>
              </div>
              <p className="text-xs text-muted-foreground">ข้อมูลทั้งหมดในระบบ: {apItems?.length ?? 0} รายการ</p>
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                disabled={printBusy || filteredItems.length === 0}
                onClick={() => void runAccountsPayableListPrint('filtered')}
              >
                <Printer className="h-4 w-4 mr-2" />
                พิมพ์ตามตัวกรอง ({filteredItems.length})
              </Button>
              <Button
                type="button"
                className="w-full sm:w-auto"
                disabled={printBusy || !(apItems?.length)}
                onClick={() => void runAccountsPayableListPrint('all')}
              >
                <Printer className="h-4 w-4 mr-2" />
                พิมพ์ทั้งหมด ({apItems?.length ?? 0})
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลเจ้าหนี้...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4 pl-6">คู่ค้า (Vendor)</TableHead>
                    <TableHead className="font-bold">เอกสารอ้างอิง</TableHead>
                    <TableHead className="font-bold">วันที่ / ครบกำหนด</TableHead>
                    <TableHead className="font-bold text-right">ยอดหนี้ (Debit)</TableHead>
                    <TableHead className="font-bold text-right">จ่ายแล้ว (Credit)</TableHead>
                    <TableHead className="font-bold text-right">คงเหลือ</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item) => {
                    const vendor = vendorById.get(item.vendorId);
                    const cancelled = isApFromCancelledVendorBill(item, cancelledApKeys);
                    const outstanding = cancelled ? 0 : item.outstandingAmount;
                    return (
                      <TableRow key={item.id} className="hover:bg-muted/20">
                        <TableCell className="py-4 pl-6">
                          <div className="flex items-center gap-2 text-sm font-bold text-primary">
                            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                            {vendor?.vendorName || 'N/A'}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs font-bold text-primary">
                          {item.origin === 'STORE_VENDOR_BILL' ? (
                            <Link
                              href={`/store/vendor-bills/${item.id}`}
                              className="text-primary underline hover:no-underline"
                            >
                              {item.documentNo}
                            </Link>
                          ) : item.origin === 'RENTAL_CONTRACT' && item.rentalContractId ? (
                            <Link
                              href={`/accounting/rental-contracts/${item.rentalContractId}`}
                              className="text-primary underline hover:no-underline"
                            >
                              {item.documentNo}
                            </Link>
                          ) : (
                            item.documentNo
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col text-[10px]">
                            <span className="flex items-center gap-1 text-muted-foreground"><Calendar className="h-2.5 w-2.5" /> {formatYmdLocalThaiBE(item.billDate)}</span>
                            <span className="flex items-center gap-1 font-bold text-red-600"><Clock className="h-2.5 w-2.5" /> Due: {formatYmdLocalThaiBE(item.dueDate)}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-sm">฿ {item.debitAmount.toLocaleString()}</TableCell>
                        <TableCell className="text-right text-sm text-green-600">฿ {item.creditAmount.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-black text-primary">฿ {outstanding.toLocaleString()}</TableCell>
                        <TableCell>
                          {getStatusBadge(cancelled ? 'CANCELLED' : resolveApEffectiveStatus(item, asOfYmd))}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filteredItems.length === 0 && !isLoading && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-20 text-muted-foreground italic">
                        {searchQuery.trim()
                          ? `ไม่พบรายการที่ตรงกับ "${searchQuery.trim()}" ในช่วง ${periodLabel}`
                          : `ไม่มีรายการเจ้าหนี้ในช่วง ${periodLabel}`}
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
