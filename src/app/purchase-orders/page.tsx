'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, ShoppingCart, MoreHorizontal } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { PurchaseOrder, RoleType } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collectionGroup } from 'firebase/firestore';

export default function PurchaseOrdersPage() {
  const [user, setUser] = useState<{ displayName: string; roleId: RoleType } | null>(null);
  const { user: firebaseUser } = useUser();
  const firestore = useFirestore();

  // Using collectionGroup as PurchaseOrders are deeply nested
  const poQuery = useMemoFirebase(() => {
    if (!firestore || !firebaseUser || !user) return null;
    return collectionGroup(firestore, 'purchase_orders');
  }, [firestore, firebaseUser, user]);

  const { data: pos, isLoading } = useCollection<PurchaseOrder>(poQuery as any);

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setUser(JSON.parse(stored));
  }, []);

  if (!user) return null;

  return (
    <AppShell user={user} onLogout={() => {}}>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary flex items-center gap-2">
              <ShoppingCart className="h-6 w-6" /> ใบสั่งซื้อ (Purchase Orders)
            </h1>
            <p className="text-muted-foreground">จัดการใบสั่งซื้อและการจองกำลังคน (Manpower Allocation)</p>
          </div>
          <Button className="gap-2">
            <Plus className="h-4 w-4" /> ออกใบสั่งซื้อใหม่
          </Button>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle>รายการใบสั่งซื้อ</CardTitle>
              <div className="relative w-72">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input type="search" placeholder="ค้นหาเลขที่ PO..." className="pl-8" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-10 text-center text-muted-foreground italic">กำลังโหลดข้อมูลใบสั่งซื้อ...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>เลขที่ PO (No.)</TableHead>
                    <TableHead>รายการ (Title)</TableHead>
                    <TableHead>ระยะเวลา (Period)</TableHead>
                    <TableHead>สถานะ (Status)</TableHead>
                    <TableHead className="text-right">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pos?.map((po) => (
                    <TableRow key={po.id}>
                      <TableCell className="font-mono">{po.poNumber}</TableCell>
                      <TableCell className="font-semibold">{po.title}</TableCell>
                      <TableCell className="text-xs">
                        {new Date(po.startDate).toLocaleDateString('th-TH')} - {new Date(po.endDate).toLocaleDateString('th-TH')}
                      </TableCell>
                      <TableCell>
                        <Badge variant={po.status === 'active' ? 'default' : 'secondary'}>
                          {po.status.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!isLoading && (!pos || pos.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-10 text-muted-foreground italic">ไม่พบข้อมูลใบสั่งซื้อ</TableCell>
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
