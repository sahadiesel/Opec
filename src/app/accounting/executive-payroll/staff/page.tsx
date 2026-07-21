'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, ChevronRight, UserSearch, ShieldAlert, Trash2, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ExecutivePayrollStaff, User } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useAppUser } from '@/hooks/use-app-user';
import { canView, canCreate, canEdit, canDelete } from '@/lib/permissions';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export default function ExecutivePayrollStaffListPage() {
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const isAuthorized = useMemo(() => canView(currentUser, 'executive_payroll'), [currentUser]);
  const canAdd = useMemo(() => canCreate(currentUser, 'executive_payroll'), [currentUser]);
  const canRemove = useMemo(() => canDelete(currentUser, 'executive_payroll'), [currentUser]);
  const canChange = useMemo(() => canEdit(currentUser, 'executive_payroll'), [currentUser]);

  const staffQuery = useMemoFirebase(() => {
    if (!firestore || userLoading || !currentUser || !isAuthorized) return null;
    return collection(firestore, 'executive_payroll_staff');
  }, [firestore, userLoading, currentUser, isAuthorized]);

  const { data: roster, isLoading, error: rosterError } = useCollection<ExecutivePayrollStaff>(
    staffQuery as any,
  );

  const [searchTerm, setSearchTerm] = useState('');

  const filtered = useMemo(() => {
    if (!roster) return [];
    const q = searchTerm.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter(
      (s) =>
        s.fullName.toLowerCase().includes(q) ||
        s.staffCode.toLowerCase().includes(q) ||
        s.department.toLowerCase().includes(q),
    );
  }, [roster, searchTerm]);

  const handleDelete = (row: ExecutivePayrollStaff, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!firestore || !canRemove) return;
    if (!window.confirm(`ลบรายชื่อ ${row.fullName} (${row.staffCode}) จากทะเบียนผู้บริหาร?`)) return;
    deleteDocumentNonBlocking(doc(firestore, 'executive_payroll_staff', row.id));
    toast({ title: 'ลบรายการแล้ว' });
  };

  if (userLoading || !currentUser) return null;

  if (!isAuthorized) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <ShieldAlert className="h-12 w-12 text-destructive opacity-50" />
          <h2 className="text-xl font-bold">ไม่มีสิทธิ์เข้าถึง</h2>
          <p className="text-muted-foreground max-w-md">
            เฉพาะผู้มีสิทธิ์โมดูลเงินเดือนผู้บริหาร (บัญชี) เท่านั้น
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser as User} onLogout={() => {}}>
      <div className="mx-auto max-w-[1600px] space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 space-y-1">
            <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-primary">
              <UserSearch className="h-8 w-8 shrink-0" />
              รายชื่อผู้บริหาร
            </h1>
            <p className="text-lg text-muted-foreground">
              เก็บฐานเงินเดือนสำหรับงวดจ่ายในเมนู{' '}
              <strong>การคำนวณการจ่ายเงิน</strong> — สูตรหักภาษี/ประกันสังคมใช้ชุดเดียวกับพนักงานออฟฟิศตามการตั้งค่า HR
            </p>
          </div>
          {canAdd && (
            <Button className="h-11 gap-2 px-6 font-bold shadow-md" asChild>
              <Link href="/accounting/executive-payroll/staff/new">
                <Plus className="h-5 w-5" />
                เพิ่มผู้บริหาร
              </Link>
            </Button>
          )}
        </div>

        <Alert className="border-blue-200 bg-blue-50/80 text-blue-900 shadow-sm">
          <ShieldAlert className="h-5 w-5 text-blue-600" />
          <AlertTitle className="font-bold">แยกจากทะเบียนพนักงานออฟฟิศ (HR)</AlertTitle>
          <AlertDescription className="text-sm">
            ข้อมูลในหน้านี้อยู่ภายใต้เมนูบัญชีเท่านั้น — ไม่แสดงในเมนู HR ปรับนโยบายหักภาษี/ประกันสังคมได้ที่การตั้งค่า HR (Payroll / Office)
          </AlertDescription>
        </Alert>

        {rosterError ? (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>โหลดรายชื่อผู้บริหารไม่สำเร็จ</AlertTitle>
            <AlertDescription className="text-sm">
              มักเกิดจากสิทธิ์ Firestore ยังไม่ตรงกับบทบาทในระบบ — ให้ deploy กฎ `firestore.rules` ล่าสุด หรือตรวจว่าโปรเจกต์ Firebase ตรงกับสภาพแวดล้อมที่ทดสอบ
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="ค้นหาชื่อ รหัส หรือแผนก..."
              className="h-11 pl-9"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <Card className="overflow-hidden border-none shadow-lg">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
              </div>
            ) : (
              <TooltipProvider delayDuration={300}>
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="pl-6 font-bold">รหัส</TableHead>
                      <TableHead className="font-bold">ชื่อ</TableHead>
                      <TableHead className="font-bold">แผนก / ตำแหน่ง</TableHead>
                      <TableHead className="font-bold text-right">เงินเดือน</TableHead>
                      <TableHead className="font-bold">สถานะ</TableHead>
                      <TableHead className="pr-6 text-right font-bold">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((s) => (
                      <TableRow
                        key={s.id}
                        className="cursor-pointer hover:bg-muted/40"
                        onClick={() =>
                          canChange ? router.push(`/accounting/executive-payroll/staff/${s.id}`) : undefined
                        }
                      >
                        <TableCell className="pl-6 font-mono text-sm font-bold text-primary">{s.staffCode}</TableCell>
                        <TableCell className="font-semibold">{s.fullName}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {s.department} · {s.positionTitle}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          ฿{(s.monthlySalary ?? 0).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          {s.status === 'ACTIVE' ? (
                            <Badge className="bg-green-600">ACTIVE</Badge>
                          ) : (
                            <Badge variant="secondary">INACTIVE</Badge>
                          )}
                          {s.excludeFromPayrollRuns ? (
                            <Badge variant="outline" className="ml-1 text-[10px]">
                              รายได้นอกเงินเดือน
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="pr-6 text-right">
                          <div className="flex justify-end gap-1">
                            {canChange && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                                    <Link href={`/accounting/executive-payroll/staff/${s.id}`}>
                                      <ChevronRight className="h-4 w-4" />
                                    </Link>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>แก้ไข</TooltipContent>
                              </Tooltip>
                            )}
                            {canRemove && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-destructive hover:text-destructive"
                                    onClick={(e) => handleDelete(s, e)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>ลบ</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {filtered.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="py-16 text-center text-sm text-muted-foreground">
                          {rosterError
                            ? 'ไม่สามารถแสดงรายการได้ — ดูข้อความด้านบน'
                            : roster?.length === 0
                              ? canAdd
                                ? 'ยังไม่มีรายชื่อ — กด «เพิ่มผู้บริหาร» เพื่อเริ่มทะเบียน'
                                : 'ยังไม่มีรายชื่อในระบบ'
                              : 'ไม่พบรายการที่ตรงกับการค้นหา'}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TooltipProvider>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
