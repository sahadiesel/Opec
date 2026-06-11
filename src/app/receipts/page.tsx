'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronRight, Receipt, Building2, Calendar, Search, Printer, Loader2 } from 'lucide-react';
import { formatStoredDateThaiBE } from '@/lib/date-thai';
import type { Customer, MoneyReceipt, User } from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';
import { useToast } from '@/hooks/use-toast';
import { collection, orderBy, query } from 'firebase/firestore';
import Link from 'next/link';
import {
  buildMoneyReceiptListPrintHtml,
  capMoneyReceiptListPrintRows,
  describeMoneyReceiptListPrintFilters,
  type MoneyReceiptListPrintRow,
} from '@/lib/documents/money-receipt-list-print';
import { openStandardPrintWindow } from '@/lib/documents/standard-document-print';

function formatReceiptAmount(currency: string, amount: number): string {
  return `${currency || 'THB'} ${Number(amount || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function sumReceiptAmounts(rows: MoneyReceipt[]): number {
  return rows.reduce((s, r) => s + Number(r.amount || 0), 0);
}

export default function MoneyReceiptsListPage() {
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const isAuthorized = useMemo(
    () => !!currentUser && canView(currentUser, 'receipts'),
    [currentUser],
  );

  const listQ = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return query(collection(firestore, 'receipts'), orderBy('createdAt', 'desc'));
  }, [firestore, isAuthorized]);

  const { data: rows, isLoading } = useCollection<MoneyReceipt>(listQ as any);

  const customersQ = useMemoFirebase(
    () => (firestore && isAuthorized ? collection(firestore, 'customers') : null),
    [firestore, isAuthorized],
  );
  const { data: customers } = useCollection<Customer>(customersQ as any);
  const custById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of customers ?? []) m.set(c.id, c.name);
    return m;
  }, [customers]);

  const [searchTerm, setSearchTerm] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);

  const allRows = useMemo(() => rows ?? [], [rows]);

  const filteredRows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return allRows.filter((r) => {
      if (monthFilter) {
        const ym = (r.receiptDate || '').slice(0, 7);
        if (ym !== monthFilter) return false;
      }
      if (!term) return true;
      const receiptNo = (r.receiptNo || '').toLowerCase();
      const taxNo = (r.taxInvoiceNo || '').toLowerCase();
      const custId = (r.customerId || '').toLowerCase();
      const custName = (custById.get(r.customerId) || '').toLowerCase();
      return (
        receiptNo.includes(term) ||
        taxNo.includes(term) ||
        custId.includes(term) ||
        custName.includes(term)
      );
    });
  }, [allRows, searchTerm, monthFilter, custById]);

  const printFilterSummary = useMemo(
    () => ({ searchTerm, monthYyyyMm: monthFilter }),
    [searchTerm, monthFilter],
  );

  const mapReceiptToPrintRow = useCallback(
    (r: MoneyReceipt): MoneyReceiptListPrintRow => ({
      receiptNo: r.receiptNo || '—',
      taxInvoiceNo: r.taxInvoiceNo || '—',
      customerName: custById.get(r.customerId) ?? r.customerId ?? '—',
      receiptDateLabel: formatStoredDateThaiBE(r.receiptDate),
      amountLabel: formatReceiptAmount(r.currency, r.amount),
    }),
    [custById],
  );

  const runReceiptListPrint = useCallback(
    async (scope: 'filtered' | 'all') => {
      const source = scope === 'filtered' ? filteredRows : allRows;
      if (source.length === 0) {
        toast({
          variant: 'destructive',
          title: 'ไม่มีรายการให้พิมพ์',
          description:
            scope === 'filtered'
              ? 'ไม่พบรายการตามตัวกรอง — ล้างคำค้นห/เดือนหรือพิมพ์ทั้งหมด'
              : 'ยังไม่มีใบเสร็จรับเงินในระบบ',
        });
        return;
      }

      setPrintBusy(true);
      try {
        const printRows = source.map(mapReceiptToPrintRow);
        const { rows: capped, truncated } = capMoneyReceiptListPrintRows(printRows);
        const generatedAt = new Date().toLocaleString('th-TH', {
          dateStyle: 'medium',
          timeStyle: 'short',
        });
        const filterLines =
          scope === 'filtered' ? describeMoneyReceiptListPrintFilters(printFilterSummary) : [];
        const scopeTitle =
          scope === 'filtered' ? 'พิมพ์ตามตัวกรองปัจจุบัน' : 'พิมพ์ทั้งหมด (ในชุดข้อมูลล่าสุด)';
        const totalAmountLabel = formatReceiptAmount('THB', sumReceiptAmounts(source));

        const body = buildMoneyReceiptListPrintHtml({
          rows: capped,
          scopeTitle,
          filterLines,
          totalAmountLabel,
          generatedAt,
          printedBy: currentUser?.displayName,
          truncated,
        });

        const ok = await openStandardPrintWindow({
          windowTitle: 'Money-Receipt-List',
          suggestedFileName: `Money-Receipts-${scope === 'filtered' ? 'Filtered' : 'All'}`,
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
      filteredRows,
      allRows,
      mapReceiptToPrintRow,
      printFilterSummary,
      currentUser?.displayName,
      toast,
    ],
  );

  if (userLoading || !currentUser) return null;

  if (!isAuthorized) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <p className="text-sm text-muted-foreground">ไม่มีสิทธิ์ดูใบเสร็จรับเงิน</p>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser as User} onLogout={() => {}}>
      <div className="mx-auto max-w-[1600px] space-y-6">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-primary">
            <Receipt className="h-8 w-8" />
            ใบเสร็จรับเงิน (ลูกค้า)
          </h1>
          <p className="text-lg text-muted-foreground">
            ออกหลังบัญชี «ยืนยันรับเงิน» บนใบกำกับภาษี — ระบุยอดและบัญชีรับเงิน แล้วลง Cashbook พร้อมออกใบเสร็จ (หลังลูกค้าหรือบัญชีแจ้งชำระแล้ว)
          </p>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <div className="relative min-w-0 flex-1 basis-full sm:basis-auto sm:min-w-[14rem] sm:max-w-md">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="search"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="ค้นหาเลขที่ใบเสร็จ, ใบกำกับ, ลูกค้า…"
                    className="h-10 w-full pl-9"
                    aria-label="ค้นหาใบเสร็จรับเงิน"
                  />
                </div>
                <div className="flex min-w-0 shrink-0 items-center gap-2">
                  <Input
                    id="receipt-month-filter"
                    type="month"
                    value={monthFilter}
                    onChange={(e) => setMonthFilter(e.target.value)}
                    className="h-10 w-[min(100%,11rem)] shrink-0 font-mono"
                    aria-label="เลือกงวดเอกสาร"
                    title="เลือกงวดเอกสาร"
                  />
                  {monthFilter ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-10 shrink-0 px-2"
                      onClick={() => setMonthFilter('')}
                    >
                      ล้างเดือน
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 gap-2 whitespace-nowrap"
                  disabled={isLoading || printBusy || allRows.length === 0}
                  onClick={() => setPrintDialogOpen(true)}
                >
                  <Printer className="h-4 w-4 shrink-0" />
                  พิมพ์รายการ
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 shrink-0 whitespace-nowrap"
                  onClick={() => router.push('/tax-invoices')}
                >
                  ไปใบกำกับภาษี
                </Button>
              </div>
            </div>
            {isLoading ? (
              <p className="p-6 text-sm text-muted-foreground">…</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>เลขที่ใบเสร็จ</TableHead>
                    <TableHead>อ้างอิงใบกำกับ</TableHead>
                    <TableHead>
                      <span className="inline-flex items-center gap-1">
                        <Building2 className="h-3.5 w-3.5" /> ลูกค้า
                      </span>
                    </TableHead>
                    <TableHead>
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" /> วันที่
                      </span>
                    </TableHead>
                    <TableHead className="text-right">ยอดรับ</TableHead>
                    <TableHead className="w-14 text-right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map((r) => (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => router.push(`/receipts/${r.id}`)}>
                      <TableCell className="font-mono text-sm font-medium">{r.receiptNo}</TableCell>
                      <TableCell className="font-mono text-sm">{r.taxInvoiceNo}</TableCell>
                      <TableCell className="text-sm">{custById.get(r.customerId) ?? r.customerId}</TableCell>
                      <TableCell className="text-sm">{formatStoredDateThaiBE(r.receiptDate)}</TableCell>
                      <TableCell className="text-right text-sm">
                        {r.currency} {r.amount.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" asChild>
                          <Link href={`/receipts/${r.id}`}>
                            <ChevronRight className="h-4 w-4" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {allRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                        ยังไม่มีใบเสร็จ — ออกหลังยืนยันรับเงินจากใบกำกับภาษี
                      </TableCell>
                    </TableRow>
                  )}
                  {allRows.length > 0 && filteredRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                        ไม่พบรายการที่ตรงกับการค้นหาหรือเดือนที่เลือก
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Dialog open={printDialogOpen} onOpenChange={setPrintDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>พิมพ์รายการใบเสร็จรับเงิน</DialogTitle>
              <DialogDescription>
                เลือกพิมพ์ตามตัวกรองเดือน/ค้นหาปัจจุบัน หรือพิมพ์ทุกรายการในชุดข้อมูลล่าสุด (สูงสุด 500 รายการ)
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="space-y-1 rounded-md border bg-muted/30 p-3">
                <p className="text-xs font-semibold uppercase text-muted-foreground">ตัวกรองปัจจุบัน</p>
                <ul className="list-inside list-disc text-xs text-muted-foreground">
                  {describeMoneyReceiptListPrintFilters(printFilterSummary).length > 0 ? (
                    describeMoneyReceiptListPrintFilters(printFilterSummary).map((line) => (
                      <li key={line}>{line}</li>
                    ))
                  ) : (
                    <li>ไม่มีตัวกรอง — แสดงทุกรายการ</li>
                  )}
                </ul>
                <p className="pt-1 text-xs font-medium">จะพิมพ์ {filteredRows.length} รายการ</p>
              </div>
              <p className="text-xs text-muted-foreground">ข้อมูลทั้งหมดในระบบ: {allRows.length} รายการ</p>
            </div>
            <DialogFooter className="flex-col gap-2 sm:flex-row">
              <Button variant="outline" onClick={() => setPrintDialogOpen(false)} disabled={printBusy}>
                ยกเลิก
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                disabled={printBusy || filteredRows.length === 0}
                onClick={() => void runReceiptListPrint('filtered')}
              >
                {printBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                พิมพ์ตามตัวกรอง ({filteredRows.length})
              </Button>
              <Button
                className="gap-2"
                disabled={printBusy || allRows.length === 0}
                onClick={() => void runReceiptListPrint('all')}
              >
                {printBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                พิมพ์ทั้งหมด ({allRows.length})
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
