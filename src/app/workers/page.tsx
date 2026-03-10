'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, CheckCircle2, XCircle, AlertCircle, FileQuestion, MoreHorizontal, UserCheck, ShieldAlert } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { RoleType, Worker, ReadinessStatus } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';

export default function WorkersPage() {
  const [user, setUser] = useState<{ displayName: string; role: RoleType } | null>(null);
  const [workers, setWorkers] = useState<Worker[]>([
    { id: '1', firstName: 'สมชาย', lastName: 'สายชล', nationalId: '1-2345-67890-12-3', positionId: '1', status: 'available', readinessStatus: 'READY' },
    { id: '2', firstName: 'วิภา', lastName: 'รักไทย', nationalId: '3-4567-89012-34-5', positionId: '2', status: 'assigned', readinessStatus: 'MISSING_CERTIFICATE' },
    { id: '3', firstName: 'มานะ', lastName: 'มั่นใจ', nationalId: '1-1111-22222-33-4', positionId: '1', status: 'available', readinessStatus: 'MEDICAL_EXPIRED' },
    { id: '4', firstName: 'สมนึก', lastName: 'รักดี', nationalId: '2-2222-33333-44-5', positionId: '3', status: 'available', readinessStatus: 'DOCUMENT_MISSING' },
  ]);

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setUser(JSON.parse(stored));
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

  if (!user) return null;

  return (
    <AppShell user={user} onLogout={() => {}}>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">ทะเบียนคนงาน (Worker Directory)</h1>
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
                {workers.map((worker) => (
                  <TableRow key={worker.id} className="group">
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-semibold">{worker.firstName} {worker.lastName}</span>
                        <span className="text-xs text-muted-foreground">{worker.nationalId}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-normal">
                        {worker.positionId === '1' ? 'Offshore Welder' : worker.positionId === '2' ? 'Safety Officer' : 'Crane Operator'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={worker.status === 'available' ? 'default' : 'secondary'} className={worker.status === 'available' ? 'bg-green-100 text-green-800 hover:bg-green-100' : ''}>
                        {worker.status === 'available' ? 'ว่าง (Available)' : 'ติดงาน (Assigned)'}
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
                          <DropdownMenuItem className="text-destructive">ระงับสถานะชั่วคราว</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
