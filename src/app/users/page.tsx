'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, ShieldCheck, Mail, Clock, Trash2, UserCog, Info, Filter, ArrowRight, ShieldAlert } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { User } from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function UsersPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed.roleId && !parsed.roleIds) parsed.roleIds = [parsed.roleId];
        setCurrentUser(parsed);
      } catch (e) {
        console.error('Failed to parse user session', e);
      }
    }
  }, []);

  const usersQuery = useMemoFirebase(() => {
    if (isUserLoading || !firebaseUser || !firestore || !currentUser) return null;
    if (firebaseUser.uid !== currentUser.id || !currentUser.roleIds?.includes('system_admin')) return null;
    return collection(firestore, 'users');
  }, [firestore, isUserLoading, firebaseUser, currentUser]);

  const { data: users, isLoading: isCollectionLoading } = useCollection<User>(usersQuery as any);

  const handleDelete = (id: string) => {
    if (!firestore) return;
    if (confirm('ยืนยันการลบผู้ใช้งานระบบรายนี้?')) {
      deleteDocumentNonBlocking(doc(firestore, 'users', id));
    }
  };

  if (isUserLoading || !currentUser || (firebaseUser && firebaseUser.uid !== currentUser.id)) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-4">
          <ShieldCheck className="h-12 w-12 text-primary animate-pulse mx-auto" />
          <p className="text-muted-foreground">กำลังตรวจสอบสิทธิ์การเข้าถึง...</p>
        </div>
      </div>
    );
  }

  if (!currentUser.roleIds?.includes('system_admin')) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-4">
          <ShieldCheck className="h-12 w-12 text-destructive opacity-50" />
          <h2 className="text-xl font-bold">Access Denied (จำกัดสิทธิ์เข้าถึง)</h2>
          <p className="text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงหน้าจัดการผู้ใช้งานระบบ กรุณาติดต่อ System Administrator</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        {/* 1. Page Header & Description */}
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <ShieldCheck className="h-8 w-8" /> จัดการระบบและสิทธิ์การใช้งาน (System Admin)
          </h1>
          <p className="text-muted-foreground text-lg">
            บริหารจัดการสิทธิ์การเข้าถึง (Access Control) ของเจ้าหน้าที่แต่ละฝ่าย และการกำหนดบทบาทหน้าที่ (Multi-role Management)
          </p>
        </div>

        {/* 2. Security Warning Box */}
        <Alert variant="destructive" className="bg-destructive/5 border-destructive/20 shadow-sm">
          <ShieldAlert className="h-5 w-5 text-destructive" />
          <AlertTitle className="font-bold text-lg">การจัดการสิทธิ์ความปลอดภัย (Access Control Policy)</AlertTitle>
          <AlertDescription className="text-sm">
            การแก้ไขสิทธิ์การใช้งาน (Roles) จะมีผลทันทีในการล็อกอินครั้งถัดไป กรุณาระมัดระวังการลบบัญชีผู้ใช้งานที่ยังมีความเกี่ยวข้องกับการลงเวลาทำงาน (Timesheets) หรือการอนุมัติในระบบ
          </AlertDescription>
        </Alert>

        {/* 3. Action Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="ค้นหาตามชื่อ หรือ อีเมลเจ้าหน้าที่..." className="pl-9 h-11" />
            </div>
            <Button variant="outline" className="h-11 gap-2"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
          </div>
          <Button className="gap-2 h-11 px-6 shadow-md bg-primary hover:bg-primary/90 text-base font-bold">
            <Plus className="h-4 w-4" /> เพิ่มผู้ใช้งานใหม่ (Add Staff Account)
          </Button>
        </div>

        {/* Statistics Summary Cards */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="shadow-sm border-l-8 border-l-blue-600 bg-blue-50/20">
            <CardHeader className="pb-2">
              <CardDescription className="text-blue-700 font-bold uppercase tracking-wider">เจ้าหน้าที่ทั้งหมด (Total Staff)</CardDescription>
              <CardTitle className="text-3xl font-black text-primary">{users?.length || 0}</CardTitle>
            </CardHeader>
          </Card>
          <Card className="shadow-sm border-l-8 border-l-primary bg-primary/5">
            <CardHeader className="pb-2">
              <CardDescription className="text-primary font-bold uppercase tracking-wider">แอดมินระบบ (System Admins)</CardDescription>
              <CardTitle className="text-3xl font-black text-primary">{users?.filter(u => u.roleIds?.includes('system_admin')).length || 0}</CardTitle>
            </CardHeader>
          </Card>
          <Card className="shadow-sm border-l-8 border-l-green-600 bg-green-50/20">
            <CardHeader className="pb-2">
              <CardDescription className="text-green-700 font-bold uppercase tracking-wider">พนักงานออนไลน์ (Active Status)</CardDescription>
              <CardTitle className="text-3xl font-black text-primary">{users?.filter(u => u.isActive).length || 0}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* 4. Data Content */}
        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isCollectionLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลผู้ใช้งาน...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4 pl-6">เจ้าหน้าที่ (Staff Name)</TableHead>
                    <TableHead className="font-bold">สิทธิ์การใช้งาน (Current Roles)</TableHead>
                    <TableHead className="font-bold">สถานะ (Status)</TableHead>
                    <TableHead className="font-bold">เข้าใช้งานล่าสุด (Last Login)</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users?.map((u) => {
                    const roles = u.roleIds || [];
                    return (
                      <TableRow key={u.id} className="hover:bg-muted/30 transition-all">
                        <TableCell className="py-4 pl-6">
                          <div className="flex flex-col">
                            <span className="font-bold text-base text-primary">{u.displayName}</span>
                            <span className="text-xs text-muted-foreground flex items-center gap-1 font-medium"><Mail className="h-3 w-3" /> {u.email}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {roles.map(role => (
                              <Badge key={role} variant="outline" className="bg-primary/5 text-primary border-primary/20 capitalize text-[10px] font-bold">
                                {(role || '').replace('_', ' ')}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          {u.isActive ? (
                            <span className="flex items-center gap-1.5 text-green-600 text-xs font-bold">
                              <div className="h-2 w-2 rounded-full bg-green-600 animate-pulse" /> ออนไลน์
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs font-bold uppercase tracking-tight">ปิดการใช้งาน</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground font-medium">
                          {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('th-TH') : 'ไม่เคยเข้าใช้งาน'}
                        </TableCell>
                        <TableCell className="text-right pr-6 space-x-2">
                          <Button variant="ghost" size="icon" className="hover:text-primary h-8 w-8"><UserCog className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => handleDelete(u.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!isCollectionLoading && (!users || users.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-20 text-muted-foreground italic">ไม่พบข้อมูลผู้ใช้งานระบบในฐานข้อมูล</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* 5. Next-Step Guidance */}
        <Card className="bg-primary/5 border-primary/10 border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2 text-primary font-bold">
              <Info className="h-5 w-5" /> แนวทางปฏิบัติถัดไป (Workflow Guidance)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="flex items-start gap-3 p-4 bg-white rounded-md border shadow-sm">
                <div className="bg-primary/10 p-2 rounded text-primary font-bold">1</div>
                <div>
                  <p className="font-bold">ตรวจสอบบทบาทผู้ใช้งาน (Review Multi-roles)</p>
                  <p className="text-muted-foreground text-xs">กำหนดบทบาทหน้าที่ให้ตรงกับแผนกของพนักงาน เช่น HR Officer ร่วมกับ Operations Officer เพื่อให้เห็นเมนูที่จำเป็น</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 bg-white rounded-md border shadow-sm">
                <div className="bg-primary/10 p-2 rounded text-primary font-bold">2</div>
                <div>
                  <p className="font-bold">ความปลอดภัยของระบบ (Security Best Practices)</p>
                  <p className="text-muted-foreground text-xs">พนักงานที่ลาออกหรือย้ายแผนกควรถูกระงับสิทธิ์ (Set Inactive) ทันทีเพื่อรักษาความลับของข้อมูลโครงการ</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
