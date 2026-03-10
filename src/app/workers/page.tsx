'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, UserCheck, UserX, MoreHorizontal } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { RoleType, Worker } from '@/lib/types';
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
    { id: '1', firstName: 'สมชาย', lastName: 'สายชล', nationalId: '1-2345-67890-12-3', positionId: '1', status: 'available', readinessStatus: 'ready' },
    { id: '2', firstName: 'วิภา', lastName: 'รักไทย', nationalId: '3-4567-89012-34-5', positionId: '2', status: 'assigned', readinessStatus: 'ready' },
    { id: '3', firstName: 'มานะ', lastName: 'มั่นใจ', nationalId: '1-1111-22222-33-4', positionId: '1', status: 'available', readinessStatus: 'not_ready' },
  ]);

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
            <h1 className="text-2xl font-bold tracking-tight">จัดการข้อมูลคนงาน (Workers)</h1>
            <p className="text-muted-foreground">ทะเบียนคนงานและตรวจสอบความพร้อมก่อนเข้างาน</p>
          </div>
          <Button className="gap-2">
            <Plus className="h-4 w-4" /> เพิ่มคนงานใหม่
          </Button>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle>รายการคนงานทั้งหมด</CardTitle>
              <div className="relative w-72">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input type="search" placeholder="ค้นหาชื่อหรือเลขประจำตัว..." className="pl-8" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ชื่อ-นามสกุล</TableHead>
                  <TableHead>เลขประจำตัวประชาชน</TableHead>
                  <TableHead>สถานะการทำงาน</TableHead>
                  <TableHead>ความพร้อม (Readiness)</TableHead>
                  <TableHead className="text-right">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workers.map((worker) => (
                  <TableRow key={worker.id}>
                    <TableCell className="font-medium">{worker.firstName} {worker.lastName}</TableCell>
                    <TableCell>{worker.nationalId}</TableCell>
                    <TableCell>
                      <Badge variant={worker.status === 'available' ? 'outline' : 'secondary'}>
                        {worker.status === 'available' ? 'ว่าง' : 'ปฏิบัติงานอยู่'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {worker.readinessStatus === 'ready' ? (
                        <div className="flex items-center text-green-600 gap-1 text-sm font-medium">
                          <UserCheck className="h-4 w-4" /> พร้อมทำงาน
                        </div>
                      ) : (
                        <div className="flex items-center text-destructive gap-1 text-sm font-medium">
                          <UserX className="h-4 w-4" /> ยังไม่พร้อม
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>การจัดการ</DropdownMenuLabel>
                          <DropdownMenuItem>ดูโปรไฟล์/ประวัติ</DropdownMenuItem>
                          <DropdownMenuItem>แก้ไขข้อมูลส่วนตัว</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem>อัปโหลดใบรับรอง</DropdownMenuItem>
                          <DropdownMenuItem>บันทึกการตรวจร่างกาย</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive">ระงับสถานะคนงาน</DropdownMenuItem>
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