'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronRight, Receipt, Building2, Calendar } from 'lucide-react';
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
            ออกโดยอัตโนมัติหลังบัญชี «ยืนยันรับเงิน» บนใบกำกับภาษี (หลังลูกค้าหรือบัญชีแจ้งชำระแล้ว)
          </p>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="flex flex-col gap-2 border-b p-4 md:flex-row md:items-center md:justify-end">
              <Button type="button" variant="outline" onClick={() => router.push('/tax-invoices')}>
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
                  {(rows ?? []).map((r) => (
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
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
