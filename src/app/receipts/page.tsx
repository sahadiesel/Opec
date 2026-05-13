'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronRight, Receipt, Building2, Calendar, Search } from 'lucide-react';
import { formatStoredDateThaiBE } from '@/lib/date-thai';
import type { Customer, MoneyReceipt, User } from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';
import { collection, orderBy, query } from 'firebase/firestore';
import Link from 'next/link';

export default function MoneyReceiptsListPage() {
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();

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

  const filteredRows = useMemo(() => {
    const list = rows ?? [];
    const term = searchTerm.trim().toLowerCase();
    return list.filter((r) => {
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
  }, [rows, searchTerm, monthFilter, custById]);

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
            <div className="flex flex-col gap-3 border-b p-4 md:flex-row md:flex-wrap md:items-center md:justify-between">
              <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative min-w-0 flex-1 sm:max-w-md">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="search"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="ค้นหาเลขที่ใบเสร็จ, ใบกำกับ, ลูกค้า…"
                    className="h-10 pl-9"
                    aria-label="ค้นหาใบเสร็จรับเงิน"
                  />
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Label htmlFor="receipt-month-filter" className="text-sm text-muted-foreground whitespace-nowrap">
                    เดือนออกเอกสาร
                  </Label>
                  <Input
                    id="receipt-month-filter"
                    type="month"
                    value={monthFilter}
                    onChange={(e) => setMonthFilter(e.target.value)}
                    className="h-10 w-[min(100%,11rem)]"
                    aria-label="กรองตามเดือนที่ออกใบเสร็จ"
                  />
                  {monthFilter ? (
                    <Button type="button" variant="ghost" size="sm" className="h-9 px-2" onClick={() => setMonthFilter('')}>
                      ล้างเดือน
                    </Button>
                  ) : null}
                </div>
              </div>
              <Button type="button" variant="outline" className="shrink-0" onClick={() => router.push('/tax-invoices')}>
                ไปใบกำกับภาษี
              </Button>
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
                  {(rows?.length ?? 0) === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                        ยังไม่มีใบเสร็จ — ออกหลังยืนยันรับเงินจากใบกำกับภาษี
                      </TableCell>
                    </TableRow>
                  )}
                  {(rows?.length ?? 0) > 0 && filteredRows.length === 0 && (
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
      </div>
    </AppShell>
  );
}
