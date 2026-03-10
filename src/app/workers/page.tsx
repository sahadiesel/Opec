'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, CheckCircle2, AlertCircle, FileQuestion, MoreHorizontal, UserCheck, ShieldAlert, FileCheck, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Worker, ReadinessStatus, User } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';

export default function WorkersPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();

  const workersQuery = useMemoFirebase(() => {
    if (!firestore || !firebaseUser || !currentUser) return null;
    return collection(firestore, 'workers');
  }, [firestore, firebaseUser, currentUser]);

  const { data: workers, isLoading } = useCollection<Worker>(workersQuery as any);

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const getReadinessBadge = (status: ReadinessStatus) => {
    switch (status) {
      case 'READY':
        return (
          <div className="flex items-center text-green-600 gap-1.5 px-2 py-1 rounded-full bg-green-50 border border-green-200 text-xs font-bold">
            <CheckCircle2 className="h-3.5 w-3.5" /> พร้อมทำงาน (READY)
          </div>
        );
      case 'MISSING_CERTIFICATE':
        return (
          <div className="flex items-center text-amber-600 gap-1.5 px-2 py-1 rounded-full bg-amber-50 border border-amber-200 text-xs font-bold">
            <ShieldAlert className="h-3.5 w-3.5" /> ขาดใบรับรอง (NO CERT)
          </div>
        );
      case 'MEDICAL_EXPIRED':
        return (
          <div className="flex items-center text-destructive gap-1.5 px-2 py-1 rounded-full bg-red-50 border border-red-200 text-xs font-bold">
            <AlertCircle className="h-3.5 w-3.5" /> ตรวจร่างกายหมดอายุ
          </div>
        );
      case 'DOCUMENT_MISSING':
        return (
          <div className="flex items-center text-slate-600 gap-1.5 px-2 py-1 rounded-full bg-slate-50 border border-slate-200 text-xs font-bold">
            <FileQuestion className="h-3.5 w-3.5" /> ขาดเอกสารสำคัญ
          </div>
        );
    }
  };

  const handleDelete = (id: string) => {
    if (!firestore) return;
    if (confirm('ยืนยันการลบข้อมูลคนงานนี้?')) {
      deleteDocumentNonBlocking(doc(firestore, 'workers', id));
    }
  };

  if (isUserLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary">ทะเบียนคนงาน (Worker Directory)</h1>
            <p className="text-muted-foreground">จัดการข้อมูลและตรวจสอบความพร้อม (Readiness) รายบุคคล</p>
          </div>
          <Button className="gap-2">
            <Plus className="h-4 w-4" /> เพิ่มคนงานใหม่
          </Button>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-4">
              <CardTitle>รายชื่อคนงานทั้งหมด</CardTitle>
              <div className="flex items-center gap-2">
                <div className="relative w-72">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input type="search" placeholder="ค้นหาชื่อหรือเลขประจำตัว..." className="pl-8" />
                </div>
                <Button variant="outline" className="gap-2">
                  <UserCheck className="h-4 w-4" /> สแกนความพร้อม
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-10 text-center text-muted-foreground italic">กำลังโหลดข้อมูลคนงาน...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ชื่อ-นามสกุล (Name)</TableHead>
                    <TableHead>ตำแหน่ง (Position)</TableHead>
                    <TableHead>สถานะงาน (Status)</TableHead>
                    <TableHead>ความพร้อม (Readiness)</TableHead>
                    <TableHead className="text-right">การจัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workers?.map((worker) => (
                    <TableRow key={worker.id} className="group">
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-semibold">{worker.firstName} {worker.lastName}</span>
                          <span className="text-xs text-muted-foreground">{worker.thaiNationalId}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-normal">
                          {worker.currentPositionId}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={worker.workerStatus === 'available' ? 'default' : 'secondary'} className={worker.workerStatus === 'available' ? 'bg-green-100 text-green-800 hover:bg-green-100' : ''}>
                          {worker.workerStatus === 'available' ? 'ว่าง (Available)' : 'ติดงาน (Assigned)'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {getReadinessBadge(worker.readinessStatus)}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuLabel>เมนูจัดการคนงาน</DropdownMenuLabel>
                            <DropdownMenuItem>ดูข้อมูลโปรไฟล์</DropdownMenuItem>
                            <DropdownMenuItem>แก้ไขข้อมูลพื้นฐาน</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="gap-2"><FileCheck className="h-4 w-4" /> จัดการใบรับรอง</DropdownMenuItem>
                            <DropdownMenuItem className="gap-2"><ShieldAlert className="h-4 w-4" /> บันทึกการตรวจสุขภาพ</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive gap-2" onClick={() => handleDelete(worker.id)}>
                              <Trash2 className="h-4 w-4" /> ลบข้อมูล
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!isLoading && (!workers || workers.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-10 text-muted-foreground italic">ไม่พบข้อมูลคนงาน</TableCell>
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
