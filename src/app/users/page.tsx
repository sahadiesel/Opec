'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, Shield, ShieldCheck, Mail, Clock, Trash2, UserCog } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { User, RoleType } from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Badge } from '@/components/ui/badge';

export default function UsersPage() {
  const [currentUser, setCurrentUser] = useState<{ displayName: string; role: RoleType } | null>(null);
  const firestore = useFirestore();

  const usersQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return collection(firestore, 'users');
  }, [firestore]);

  const { data: users, isLoading } = useCollection<User>(usersQuery as any);

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const handleDelete = (id: string) => {
    if (!firestore) return;
    if (confirm('ยืนยันการลบผู้ใช้งานระบบรายนี้?')) {
      deleteDocumentNonBlocking(doc(firestore, 'users', id));
    }
  };

  if (!currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary flex items-center gap-2">
              <ShieldCheck className="h-6 w-6" /> จัดการผู้ใช้งานระบบ (Staff Users)
            </h1>
            <p className="text-muted-foreground">บริหารจัดการสิทธิ์การเข้าถึงสำหรับเจ้าหน้าที่ OPEC</p>
          </div>
          <Button className="gap-2">
            <Plus className="h-4 w-4" /> เพิ่มผู้ใช้งานใหม่
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>แอดมินระบบ</CardDescription>
              <CardTitle className="text-2xl font-bold">{users?.filter(u => u.roleId === 'system_admin').length || 0}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>ฝ่ายบุคคล (HR)</CardDescription>
              <CardTitle className="text-2xl font-bold">{users?.filter(u => u.roleId.includes('hr')).length || 0}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>ฝ่ายขาย (Sales)</CardDescription>
              <CardTitle className="text-2xl font-bold">{users?.filter(u => u.roleId === 'sales_officer').length || 0}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle>รายชื่อเจ้าหน้าที่</CardTitle>
              <div className="relative w-72">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input type="search" placeholder="ค้นหาชื่อหรืออีเมล..." className="pl-8" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-10 text-center text-muted-foreground italic">กำลังโหลดข้อมูลผู้ใช้งาน...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>เจ้าหน้าที่ (Staff)</TableHead>
                    <TableHead>สิทธิ์การใช้งาน (Role)</TableHead>
                    <TableHead>สถานะ (Status)</TableHead>
                    <TableHead>เข้าใช้งานล่าสุด</TableHead>
                    <TableHead className="text-right">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users?.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-semibold">{u.displayName}</span>
                          <span className="text-xs text-muted-foreground flex items-center gap-1"><Mail className="h-3 w-3" /> {u.email}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 capitalize">
                          {u.roleId.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {u.isActive ? (
                          <span className="flex items-center gap-1 text-green-600 text-xs font-medium">
                            <Clock className="h-3 w-3" /> ออนไลน์
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs font-medium">ปิดการใช้งาน</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('th-TH') : 'ไม่เคยเข้าใช้งาน'}
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button variant="ghost" size="icon"><UserCog className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(u.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!isLoading && (!users || users.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-10 text-muted-foreground italic">ไม่พบข้อมูลผู้ใช้งานระบบ</TableCell>
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
