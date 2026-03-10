'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, ClipboardList, MoreHorizontal } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { MainContract, RoleType } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collectionGroup } from 'firebase/firestore';

export default function MainContractsPage() {
  const [user, setUser] = useState<{ displayName: string; roleId: RoleType } | null>(null);
  const { user: firebaseUser } = useUser();
  const firestore = useFirestore();

  // Using collectionGroup as MainContracts are nested under Customers
  const contractsQuery = useMemoFirebase(() => {
    if (!firestore || !firebaseUser || !user) return null;
    return collectionGroup(firestore, 'main_contracts');
  }, [firestore, firebaseUser, user]);

  const { data: contracts, isLoading } = useCollection<MainContract>(contractsQuery as any);

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
              <ClipboardList className="h-6 w-6" /> สัญญาหลัก (Main Contracts)
            </h1>
            <p className="text-muted-foreground">จัดการสัญญาซื้อขายหลักและอัตราค่าจ้าง (Master Agreements)</p>
          </div>
          <Button className="gap-2">
            <Plus className="h-4 w-4" /> สร้างสัญญาใหม่
          </Button>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle>รายการสัญญาหลัก</CardTitle>
              <div className="relative w-72">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input type="search" placeholder="ค้นหาเลขที่สัญญา..." className="pl-8" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-10 text-center text-muted-foreground italic">กำลังโหลดข้อมูลสัญญา...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>เลขที่สัญญา (No.)</TableHead>
                    <TableHead>หัวข้อสัญญา (Title)</TableHead>
                    <TableHead>ระยะเวลา (Period)</TableHead>
                    <TableHead>สถานะ (Status)</TableHead>
                    <TableHead className="text-right">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contracts?.map((contract) => (
                    <TableRow key={contract.id}>
                      <TableCell className="font-mono">{contract.contractNumber}</TableCell>
                      <TableCell className="font-semibold">{contract.title}</TableCell>
                      <TableCell className="text-xs">
                        {new Date(contract.startDate).toLocaleDateString('th-TH')} - {new Date(contract.endDate).toLocaleDateString('th-TH')}
                      </TableCell>
                      <TableCell>
                        <Badge variant={contract.status === 'active' ? 'default' : 'secondary'}>
                          {contract.status.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!isLoading && (!contracts || contracts.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-10 text-muted-foreground italic">ไม่พบข้อมูลสัญญาหลัก</TableCell>
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
