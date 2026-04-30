'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Plus, 
  Search, 
  Filter, 
  ChevronRight, 
  Coins, 
  AlertTriangle,
  Info,
  Clock,
  CheckCircle2,
  FileText,
  Loader2,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { formatDateThaiBE } from '@/lib/date-thai';
import { ExecutivePayrollStaff, OfficePayrollRun, PayrollRunStatus, User } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription,
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { addDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';
import { canView } from '@/lib/permissions';
import { isSystemAdmin } from '@/lib/permission-core';
import Link from 'next/link';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  applyExecutivePayrollRunLines,
  adminExecutivePayrollDeleteBlocked,
  deleteExecutivePayrollRunCascade,
  isExecutivePayrollStaffEligible,
} from '@/lib/payroll/executive-payroll-run-apply';
import { getPayrollMonthPeriodBounds } from '@/lib/payroll/office-payroll-run-apply';

function initialNewExecutiveRun(): Partial<OfficePayrollRun> {
  const payrollMonth = new Date().toISOString().slice(0, 7);
  const { payrollPeriodStart, payrollPeriodEnd } = getPayrollMonthPeriodBounds(payrollMonth);
  return {
    payrollRunNo: getPreviewPattern('executive_payroll_run'),
    payrollMonth,
    payrollPeriodStart,
    payrollPeriodEnd,
    notes: '',
  };
}

export default function ExecutivePayrollPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const isAuthorized = useMemo(() => canView(currentUser, 'executive_payroll'), [currentUser]);
  const isAdmin = useMemo(() => isSystemAdmin(currentUser), [currentUser]);

  const runsQuery = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return query(collection(firestore, 'executive_payroll_runs'), orderBy('payrollMonth', 'desc'));
  }, [firestore, isAuthorized]);
  
  const { data: runs, isLoading } = useCollection<OfficePayrollRun>(runsQuery as any);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<OfficePayrollRun | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [newRun, setNewRun] = useState<Partial<OfficePayrollRun>>(initialNewExecutiveRun);

  const handleCreateRun = async () => {
    if (!firestore || !currentUser) return;
    if (!newRun.payrollMonth) {
      toast({ variant: 'destructive', title: 'ข้อมูลไม่ครบ', description: 'กรุณาเลือกเดือนที่จ่าย' });
      return;
    }
    let payrollPeriodStart = newRun.payrollPeriodStart;
    let payrollPeriodEnd = newRun.payrollPeriodEnd;
    try {
      const b = getPayrollMonthPeriodBounds(newRun.payrollMonth);
      payrollPeriodStart = payrollPeriodStart || b.payrollPeriodStart;
      payrollPeriodEnd = payrollPeriodEnd || b.payrollPeriodEnd;
    } catch {
      toast({ variant: 'destructive', title: 'เดือนไม่ถูกต้อง', description: 'เลือกเดือนที่จ่ายใหม่' });
      return;
    }

    setIsCreating(true);
    try {
      // Atomic Number Generation
      const { code: finalNo } = await generateNextDocumentCode(firestore, 'executive_payroll_run', { actor: currentUser.displayName });

      const docRef = await addDocumentNonBlocking(collection(firestore, 'executive_payroll_runs'), {
        ...newRun,
        payrollPeriodStart,
        payrollPeriodEnd,
        payrollRunNo: finalNo,
        status: 'DRAFT',
        staffCount: 0,
        grossAmount: 0,
        netAmount: 0,
        totalAllowances: 0,
        totalDeductions: 0,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      setIsDialogOpen(false);
      setNewRun(initialNewExecutiveRun());

      if (docRef) {
        try {
          const rosterSnap = await getDocs(collection(firestore, 'executive_payroll_staff'));
          const staffList = rosterSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as ExecutivePayrollStaff[];
          const eligible = staffList.filter(isExecutivePayrollStaffEligible);
          if (eligible.length > 0) {
            await applyExecutivePayrollRunLines(
              firestore,
              docRef.id,
              {
                payrollMonth: newRun.payrollMonth!,
                payrollPeriodEnd: payrollPeriodEnd!,
              },
              eligible,
              { newStatus: 'CALCULATED' },
            );
            toast({
              title: 'สร้างและคำนวณงวดสำเร็จ',
              description: `เลขที่ ${finalNo} — ประมวลผล ${eligible.length} รายจากทะเบียนผู้บริหาร`,
            });
          } else {
            toast({
              title: 'สร้างงวดเงินเดือนสำเร็จ',
              description: `เลขที่: ${finalNo} — ยังไม่มีผู้บริหาร ACTIVE ในเมนูรายชื่อผู้บริหาร เปิดหน้ารายละเอียดแล้วกดคำนวณเมื่อพร้อม`,
            });
          }
        } catch (calcErr) {
          console.error(calcErr);
          toast({
            variant: 'destructive',
            title: 'สร้างงวดแล้ว แต่คำนวณอัตโนมัติไม่สำเร็จ',
            description: calcErr instanceof Error ? calcErr.message : 'เปิดหน้ารายละเอียดแล้วลองกดคำนวณอีกครั้ง',
          });
        }
        router.push(`/accounting/executive-payroll/${docRef.id}`);
      } else {
        toast({ title: 'สร้างงวดเงินเดือนสำเร็จ', description: `เลขที่: ${finalNo}` });
      }
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถสร้างงวดการจ่ายเงินได้" });
    } finally {
      setIsCreating(false);
    }
  };

  const handleConfirmDeleteRun = async () => {
    if (!firestore || !deleteTarget || !currentUser || !isAdmin) return;
    if (adminExecutivePayrollDeleteBlocked(deleteTarget)) {
      toast({
        variant: 'destructive',
        title: 'ลบไม่ได้',
        description: 'งวดล็อกหรืออนุมัติการเงิน/มีรายการตัดจ่ายแล้ว',
      });
      return;
    }
    setIsDeleting(true);
    try {
      await deleteExecutivePayrollRunCascade(firestore, deleteTarget.id);
      toast({ title: 'ลบงวดแล้ว', description: `เลขที่ ${deleteTarget.payrollRunNo}` });
      setDeleteTarget(null);
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'ลบไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const getStatusBadge = (status: PayrollRunStatus) => {
    switch (status) {
      case 'DRAFT': return <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200">DRAFT</Badge>;
      case 'CALCULATED': return <Badge variant="outline" className="bg-blue-50 text-blue-600 border-blue-200">CALCULATED</Badge>;
      case 'HR_REVIEW': return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">HR REVIEW</Badge>;
      case 'HR_APPROVED': return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">HR APPROVED</Badge>;
      case 'FINANCE_APPROVED': return <Badge className="bg-green-600">FINANCE APPROVED</Badge>;
      case 'LOCKED': return <Badge className="bg-primary text-primary-foreground"><Clock className="h-3 w-3 mr-1" /> LOCKED</Badge>;
      case 'CANCELLED': return <Badge variant="secondary">CANCELLED</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (!currentUser) return null;

  if (!isAuthorized) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <ShieldAlert className="h-12 w-12 text-destructive opacity-50" />
          <h2 className="text-xl font-bold">ไม่มีสิทธิ์เข้าถึง (Access Restricted)</h2>
          <p className="text-muted-foreground">เฉพาะฝ่ายบัญชี/การเงินที่ได้รับสิทธิ์โมดูลนี้เท่านั้น (ข้อมูลผู้บริหารไม่อยู่ในเมนู HR)</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <Coins className="h-8 w-8" /> เงินเดือนผู้บริหาร (Executive Payroll)
          </h1>
          <p className="text-muted-foreground text-lg">
            การคำนวณการจ่ายเงิน — ดึงรายชื่อและฐานเงินเดือนจากเมนูย่อย «รายชื่อผู้บริหาร» (แยกจากงวดพนักงานออฟฟิศ)
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Alert className="bg-blue-50 border-blue-200 text-blue-800 shadow-sm">
            <Info className="h-5 w-5 text-blue-600" />
            <AlertTitle className="font-bold">ความลับ (Confidential)</AlertTitle>
            <AlertDescription className="text-xs">
              ข้อมูลนี้ไม่แสดงในเมนู HR — ใช้ workflow เดียวกับเงินเดือนพนักงาน (คำนวณ → อนุมัติ → การเงินลงบัญชี)
            </AlertDescription>
          </Alert>
          <Alert className="bg-amber-50 border-amber-200 text-amber-800 shadow-sm">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <AlertTitle className="font-bold">การล็อกข้อมูล (Data Locking)</AlertTitle>
            <AlertDescription className="text-xs">
              เมื่อสถานะเป็น LOCKED ข้อมูลจะถูก Snapshot ถาวรเพื่อใช้ในการปิดงบการเงิน
            </AlertDescription>
          </Alert>
        </div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex flex-wrap items-center gap-3 flex-1">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="ค้นหาเลขที่งวด..." className="pl-9 h-11" />
            </div>
            <Button variant="outline" className="h-11 gap-2"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
            <Button variant="secondary" className="h-11 gap-2 font-semibold" asChild>
              <Link href="/accounting/executive-payroll/staff">รายชื่อผู้บริหาร</Link>
            </Button>
          </div>
          
          <Dialog
            open={isAuthorized && isDialogOpen}
            onOpenChange={(open) => {
              setIsDialogOpen(open);
              if (open) setNewRun(initialNewExecutiveRun());
            }}
          >
            <DialogTrigger asChild>
              <Button className="gap-2 h-11 px-6 bg-primary shadow-md text-base font-bold">
                <Plus className="h-5 w-5" /> สร้างงวดเงินเดือนผู้บริหาร
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>สร้างงวดเงินเดือนผู้บริหารใหม่</DialogTitle>
                <DialogDescription>
                  เลือกเดือนที่จ่าย — ระบบกำหนดช่วงวันที่เป็นวันแรกถึงวันสุดท้ายของเดือนนั้นโดยอัตโนมัติ และออกเลขที่ EPR- เมื่อบันทึก
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                <div className="space-y-2 md:col-span-2">
                  <Label>เลขที่งวด (Run No.)</Label>
                  <Input value={newRun.payrollRunNo} disabled className="bg-muted/50 font-mono font-bold" />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>เดือนที่จ่าย (Payroll Month)</Label>
                  <Input
                    type="month"
                    value={newRun.payrollMonth}
                    onChange={(e) => {
                      const ym = e.target.value;
                      try {
                        const b = getPayrollMonthPeriodBounds(ym);
                        setNewRun({
                          ...newRun,
                          payrollMonth: ym,
                          payrollPeriodStart: b.payrollPeriodStart,
                          payrollPeriodEnd: b.payrollPeriodEnd,
                        });
                      } catch {
                        setNewRun({ ...newRun, payrollMonth: ym });
                      }
                    }}
                  />
                </div>
                <div className="space-y-2 md:col-span-2 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">ช่วงเวลางวด (คำนวณอัตโนมัติ)</span>
                  <p className="mt-1 font-mono text-xs">
                    {newRun.payrollPeriodStart && newRun.payrollPeriodEnd
                      ? `${newRun.payrollPeriodStart} ถึง ${newRun.payrollPeriodEnd}`
                      : '—'}
                  </p>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>หมายเหตุ</Label>
                  <Input value={newRun.notes} onChange={e => setNewRun({...newRun, notes: e.target.value})} placeholder="ระบุโครงการหรือข้อความเพิ่มเติม..." />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isCreating}>ยกเลิก</Button>
                <Button onClick={handleCreateRun} className="bg-primary font-bold" disabled={isCreating}>
                  {isCreating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  สร้างงวดเงินเดือน (Confirm)
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลข้อมูลงวดเงินเดือน...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4">เลขที่งวด (Run No.)</TableHead>
                    <TableHead className="font-bold">ประจำเดือน (Month)</TableHead>
                    <TableHead className="font-bold">ช่วงเวลา (Period)</TableHead>
                    <TableHead className="font-bold text-center">จำนวนคน</TableHead>
                    <TableHead className="font-bold text-right">ยอดสุทธิ (Net)</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs?.map((run) => (
                    <TableRow 
                      key={run.id} 
                      className="cursor-pointer hover:bg-muted/30 group transition-all" 
                      onClick={() => router.push(`/accounting/executive-payroll/${run.id}`)}
                    >
                      <TableCell className="py-4 font-bold text-primary font-mono">{run.payrollRunNo}</TableCell>
                      <TableCell className="font-medium">{formatDateThaiBE(run.payrollMonth + '-01')}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{run.payrollPeriodStart} ถึง {run.payrollPeriodEnd}</TableCell>
                      <TableCell className="text-center font-bold">{run.staffCount} คน</TableCell>
                      <TableCell className="text-right font-black text-primary">
                        ฿{run.netAmount.toLocaleString()}
                      </TableCell>
                      <TableCell>{getStatusBadge(run.status)}</TableCell>
                      <TableCell
                        className="text-right pr-6"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center justify-end gap-0.5">
                          {isAdmin && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              disabled={adminExecutivePayrollDeleteBlocked(run)}
                              title={
                                adminExecutivePayrollDeleteBlocked(run)
                                  ? 'ลบไม่ได้ — งวดล็อกหรืออนุมัติการเงิน/จ่ายแล้ว'
                                  : 'ลบงวดนี้ (เฉพาะผู้ดูแลระบบ)'
                              }
                              onClick={() => setDeleteTarget(run)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="group-hover:text-primary"
                            onClick={() => router.push(`/accounting/executive-payroll/${run.id}`)}
                          >
                            <ChevronRight className="h-5 w-5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!runs || runs.length === 0) && !isLoading && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-20 text-muted-foreground italic">ไม่มีงวดการจ่ายเงินในขณะนี้</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && !isDeleting && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ลบงวดเงินเดือนผู้บริหาร?</AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <span className="block">
                  จะลบ <span className="font-mono font-semibold">{deleteTarget?.payrollRunNo}</span> และรายการจ่ายทั้งหมดในงวดนี้
                  การกระทำนี้ย้อนกลับไม่ได้
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting}>ยกเลิก</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={isDeleting}
                onClick={(e) => {
                  e.preventDefault();
                  void handleConfirmDeleteRun();
                }}
              >
                {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ลบ'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppShell>
  );
}
