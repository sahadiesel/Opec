'use client';

import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection } from 'firebase/firestore';
import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Layers } from 'lucide-react';
import type { PoActiveBundle, Customer } from '@/lib/types';

export default function PoActiveBundlesPage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();

  const canSee = useMemo(() => !!currentUser && canView(currentUser, 'customer_pos'), [currentUser]);

  const bundlesQuery = useMemoFirebase(
    () => (firestore && canSee ? collection(firestore, 'po_active_bundles') : null),
    [firestore, canSee],
  );
  const { data: bundles, isLoading } = useCollection<PoActiveBundle>(bundlesQuery as any);

  const customersQuery = useMemoFirebase(
    () => (firestore && canSee ? collection(firestore, 'customers') : null),
    [firestore, canSee],
  );
  const { data: customers } = useCollection<Customer>(customersQuery as any);

  const sorted = useMemo(() => {
    const b = bundles || [];
    return [...b].sort((a, b) => {
      const ca = customers?.find((c) => c.id === a.customerId)?.name || a.customerId;
      const cb = customers?.find((c) => c.id === b.customerId)?.name || b.customerId;
      if (ca !== cb) return ca.localeCompare(cb, 'th');
      return a.workMode.localeCompare(b.workMode);
    });
  }, [bundles, customers]);

  if (userLoading || !currentUser) return null;

  if (!canSee) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="p-6 text-muted-foreground">ไม่มีสิทธิ์เข้าหน้านี้</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 p-4 md:p-6 max-w-[100rem] mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Layers className="h-7 w-7 text-primary" />
              เอกสาร PO Active (กลุ่มต่อลูกค้า)
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              อัปเดตเมื่อบันทึก/อนุมัติ/ปิด PO — แยกตาม Onshore และ Offshore
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/po-active-quota-queue">คิวเติมโควต้า</Link>
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>รายการกลุ่ม</CardTitle>
            <CardDescription>แต่ละแถว = ลูกค้า + โหมดงาน — รวมรายการ PO ที่ Active</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                กำลังโหลด…
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ลูกค้า</TableHead>
                    <TableHead>โหมด</TableHead>
                    <TableHead className="text-center">จำนวน PO</TableHead>
                    <TableHead className="text-right">ดำเนินการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((b) => {
                    const name = customers?.find((c) => c.id === b.customerId)?.name || b.customerId;
                    return (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium">{name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{b.workMode}</Badge>
                        </TableCell>
                        <TableCell className="text-center font-semibold">{b.poIds?.length ?? 0}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="secondary" asChild>
                            <Link href={`/po-active/${encodeURIComponent(b.id)}`}>เปิดเอกสาร</Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {sorted.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-12 text-muted-foreground text-sm">
                        ยังไม่มีข้อมูลกลุ่ม — อนุมัติ PO สายสัญญาเป็น Active แล้วระบบจะสร้างอัตโนมัติ
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
