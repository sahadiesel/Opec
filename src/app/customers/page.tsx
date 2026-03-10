'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, UserCheck, MoreHorizontal, Building2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Customer, RoleType } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection } from 'firebase/firestore';

export default function CustomersPage() {
  const [user, setUser] = useState<{ displayName: string; roleId: RoleType } | null>(null);
  const { user: firebaseUser } = useUser();
  const firestore = useFirestore();

  const customersQuery = useMemoFirebase(() => {
    if (!firestore || !firebaseUser || !user) return null;
    return collection(firestore, 'customers');
  }, [firestore, firebaseUser, user]);

  const { data: customers, isLoading } = useCollection<Customer>(customersQuery as any);

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
              <Building2 className="h-6 w-6" /> ลูกค้า (Customers)
            </h1>
            <p className="text-muted-foreground">บริหารจัดการข้อมูลลูกค้าและผู้ติดต่อประสานงาน</p>
          </div>
          <Button className="gap-2">
            <Plus className="h-4 w-4" /> เพิ่มลูกค้าใหม่
          </Button>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle>รายชื่อลูกค้า</CardTitle>
              <div className="relative w-72">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input type="search" placeholder="ค้นหาลูกค้า..." className="pl-8" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-10 text-center text-muted-foreground italic">กำลังโหลดข้อมูลลูกค้า...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ชื่อบริษัท (Customer Name)</TableHead>
                    <TableHead>เลขประจำตัวผู้เสียภาษี (Tax ID)</TableHead>
                    <TableHead>สถานะ (Status)</TableHead>
                    <TableHead className="text-right">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers?.map((customer) => (
                    <TableRow key={customer.id}>
                      <TableCell className="font-semibold">{customer.name}</TableCell>
                      <TableCell>{customer.taxId}</TableCell>
                      <TableCell>
                        <Badge variant={customer.isActive ? 'default' : 'secondary'}>
                          {customer.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!isLoading && (!customers || customers.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-10 text-muted-foreground italic">ไม่พบข้อมูลลูกค้า</TableCell>
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
