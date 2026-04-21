'use client';

import { useState, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Coins, 
  Plus, 
  Search, 
  Filter, 
  CheckCircle2, 
  ShieldCheck, 
  FileText, 
  Info,
  ChevronRight,
  TrendingUp,
  Clock,
  ArrowRight,
  Calculator,
  Loader2,
  AlertTriangle,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { formatStoredDateRangeThaiBE } from '@/lib/date-thai';
import { PayrollBatch, PayrollPeriod, PayrollPeriodStatus, User } from '@/lib/types';
import { isSystemAdmin } from '@/lib/permission-core';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, orderBy, limit } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PayrollService, type PayrollPreflightResult } from '@/lib/services/payroll-service';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
import { PageGuidance } from '@/components/layout/page-guidance';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import { formatDateThaiBE } from '@/lib/date-thai';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccess, canCreate, canPreparePayroll, canView, isMatrixControlledRole } from '@/lib/permissions';

export default function PayrollBatchesPage() {
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const useMatrixGuards = isMatrixControlledRole(currentUser);
  const canViewWorkerPayroll = useMemo(() => {
    if (useMatrixGuards) {
      return (
        canAccess(currentUser, 'worker_payroll', 'view') ||
        canAccess(currentUser, 'payroll_runs', 'view') ||
        canAccess(currentUser, 'payslips', 'view')
      );
    }
    return canView(currentUser, 'worker_payroll');
  }, [currentUser, useMatrixGuards]);
  const canCreateWorkerPayroll = useMemo(() => canCreate(currentUser, 'worker_payroll'), [currentUser]);
  const canPrepareWorkerPayroll = useMemo(() => canPreparePayroll(currentUser), [currentUser]);
  const isAdmin = useMemo(() => isSystemAdmin(currentUser), [currentUser]);

  const batchQuery = useMemoFirebase(() => {
    if (!firestore || !canViewWorkerPayroll) return null;
    return query(collection(firestore, 'payroll_batches'), orderBy('createdAt', 'desc'), limit(50));
  }, [firestore, canViewWorkerPayroll]);
  const { data: batches, isLoading: isBatchesLoading } = useCollection<PayrollBatch>(batchQuery as any);

  const periodsQuery = useMemoFirebase(() => {
    if (!firestore || !canViewWorkerPayroll) return null;
    return query(collection(firestore, 'payroll_periods'), orderBy('startDate', 'desc'));
  }, [firestore, canViewWorkerPayroll]);
  const { data: periods } = useCollection<PayrollPeriod>(periodsQuery as any);

  const selectablePeriods = useMemo(() => {
    const allowed: PayrollPeriodStatus[] = ['OPEN', 'PROCESSING', 'DRAFT'];
    return (periods ?? []).filter((p) => allowed.includes(p.status));
  }, [periods]);

  const [isGenerateOpen, setIsGenerateOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [targetPeriodId, setTargetPeriodId] = useState('');
  const [workModeFilter, setWorkModeScope] = useState<'onshore' | 'offshore' | 'mixed'>('mixed');
  const [preflight, setPreflight] = useState<PayrollPreflightResult | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PayrollBatch | null>(null);
  const [regenTarget, setRegenTarget] = useState<PayrollBatch | null>(null);
  const [adminBusy, setAdminBusy] = useState(false);

  const adminBatchActionsBlocked = (status: string) =>
    ['FINANCE_PREPARED', 'PAYMENT_EXPORTED', 'PAID', 'LOCKED'].includes(status);

  const handlePreflight = async () => {
    if (!firestore || !targetPeriodId) return;
    setIsChecking(true);
    setPreflight(null);
    try {
      const service = new PayrollService(firestore);
      const result = await service.preflightPayrollCheck(targetPeriodId, { workModeScope: workModeFilter });
      setPreflight(result);
      if (!result.hasWarnings) {
        toast({ title: 'ตรวจสอบผ่าน', description: `พร้อมประมวลผล ${result.totalWorkers} คน / ${result.totalTimesheets} ใบงาน` });
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'ตรวจสอบล้มเหลว', description: e.message });
    } finally {
      setIsChecking(false);
    }
  };

  const handleGenerate = async () => {
    if (!canCreateWorkerPayroll) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์สร้าง payroll batch' });
      return;
    }
    if (!canPrepareWorkerPayroll) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์เตรียมงวดจ่ายเงินเดือน' });
      return;
    }
    if (!firestore || !currentUser || !targetPeriodId) return;
    
    setIsGenerating(true);
    try {
      const service = new PayrollService(firestore);
      const batchId = await service.generatePayrollBatch(targetPeriodId, currentUser, { workModeScope: workModeFilter });
      
      setIsGenerateOpen(false);
      setPreflight(null);
      toast({ title: "สร้าง Payroll Batch สำเร็จ", description: "ข้อมูลกำลังถูกประมวลผล" });
      router.push(`/payroll/batches/${batchId}`);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Generation Failed", description: e.message });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAdminDelete = async () => {
    if (!deleteTarget || !firestore || !currentUser) return;
    setAdminBusy(true);
    try {
      const service = new PayrollService(firestore);
      await service.adminDeletePayrollBatch(deleteTarget.id, currentUser);
      toast({ title: 'ลบชุดจ่ายแล้ว', description: deleteTarget.id });
      setDeleteTarget(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: 'destructive', title: 'ลบไม่สำเร็จ', description: msg });
    } finally {
      setAdminBusy(false);
    }
  };

  const handleAdminRegenerate = async () => {
    if (!regenTarget || !firestore || !currentUser) return;
    setAdminBusy(true);
    try {
      const service = new PayrollService(firestore);
      const newBatchId = await service.adminRegeneratePayrollBatch(regenTarget.id, currentUser);
      toast({ title: 'สร้างชุดจ่ายใหม่แล้ว', description: newBatchId });
      setRegenTarget(null);
      router.push(`/payroll/batches/${newBatchId}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: 'destructive', title: 'สร้างใหม่ไม่สำเร็จ', description: msg });
    } finally {
      setAdminBusy(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'GENERATED': return <Badge variant="outline" className="bg-blue-50 text-blue-700">GENERATED</Badge>;
      case 'HR_APPROVED': return <Badge variant="outline" className="bg-green-50 text-green-700">HR APPROVED</Badge>;
      case 'FINANCE_PREPARED': return <Badge className="bg-amber-500">FINANCE PREPARED</Badge>;
      case 'PAID': return <Badge className="bg-green-600">PAID (ชำระแล้ว)</Badge>;
      case 'LOCKED': return <Badge variant="secondary">LOCKED (Snapshot)</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (userLoading || !currentUser) return null;
  if (!canViewWorkerPayroll) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-5xl mx-auto py-10 text-center text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงเมนูนี้</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div className="flex flex-col gap-2 min-w-0">
            <PayrollScopeTag scope="worker" showHint={false} />
            <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
              <Coins className="h-8 w-8 shrink-0" /> งวดจ่ายลูกจ้าง (Payroll Batches)
            </h1>
            <p className="text-muted-foreground text-lg italic">
              <strong>Worker Payroll</strong> — รวมเฉพาะรายวันที่ตั้งค่า readyForPayroll แล้ว (หลังผู้จัดการอนุมัติงวดเดือน Wave) ภายในรอบ period ที่เลือก
            </p>
          </div>
          
          <Dialog open={isGenerateOpen} onOpenChange={setIsGenerateOpen}>
            <DialogTrigger asChild>
              <Button
                className="gap-2 h-11 px-6 bg-primary shadow-md font-bold"
                disabled={!canCreateWorkerPayroll || !canPrepareWorkerPayroll}
              >
                <Calculator className="h-5 w-5" /> สร้างรายการจ่ายใหม่ (Generate Batch)
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>ประมวลผล Payroll Batch ใหม่</DialogTitle>
                <DialogDescription>
                  ระบบจะรวบรวมเฉพาะ Daily Timesheets ที่ถูกตั้งค่า <strong>พร้อมจ่าย payroll</strong> (readyForPayroll) แล้ว — โดยปกติเกิดหลัง{' '}
                  <strong>ผู้จัดการ Ops/HR อนุมัติสรุปลงเวลารายเดือน (Wave)</strong> จากเมนูคิวอนุมัติ — ไม่บังคับให้ลูกค้าอนุมัติก่อน
                  {' '}
                  หลังอนุมัติ Wave แล้วระบบจะสร้าง <strong>รอบบัญชีลูกจ้าง</strong> ให้เลือกที่นี่โดยอัตโนมัติ (หรือจัดการเพิ่มที่{' '}
                  <Link href="/payroll/periods" className="underline font-medium text-foreground">
                    รอบจ่ายเงิน
                  </Link>
                  )
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label className="font-bold">เลือกรอบบัญชี (Select Period)</Label>
                  <Select onValueChange={setTargetPeriodId} value={targetPeriodId}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="เลือกรอบเดือนที่ต้องการจ่าย..." /></SelectTrigger>
                    <SelectContent>
                      {selectablePeriods.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label} ({formatStoredDateRangeThaiBE(p.startDate, p.endDate)})
                          {p.status === 'DRAFT' ? ' · DRAFT' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectablePeriods.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      ยังไม่มีรอบที่เลือกได้ — รอสักครู่หลังอนุมัติ Wave หรือไปที่{' '}
                      <Link href="/payroll/periods" className="underline font-medium text-foreground">
                        รอบจ่ายเงิน
                      </Link>{' '}
                      เพื่อสร้างรอบและตั้งสถานะ OPEN
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label className="font-bold">ขอบเขตงาน (Scope)</Label>
                  <Select onValueChange={(v: any) => setWorkModeScope(v)} value={workModeFilter}>
                    <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mixed">ทั้งหมด (All modes)</SelectItem>
                      <SelectItem value="offshore">Offshore เท่านั้น</SelectItem>
                      <SelectItem value="onshore">Onshore เท่านั้น</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {preflight && preflight.hasWarnings && (
                <Alert className="bg-amber-50 border-amber-300 text-amber-900">
                  <AlertTriangle className="h-5 w-5 text-amber-600" />
                  <AlertTitle className="font-bold">พบคนงาน {preflight.zeroGrossWorkers.length} คนที่จะได้ค่าจ้าง 0 บาท</AlertTitle>
                  <AlertDescription className="text-xs space-y-1 mt-1">
                    {preflight.zeroGrossWorkers.slice(0, 5).map((w) => (
                      <div key={w.workerId} className="flex flex-col">
                        <span className="font-bold">{w.workerName} ({w.timesheetCount} ใบงาน)</span>
                        <span className="text-amber-700">{w.reasons.join(', ')}</span>
                      </div>
                    ))}
                    {preflight.zeroGrossWorkers.length > 5 && (
                      <p className="italic">...และอีก {preflight.zeroGrossWorkers.length - 5} คน</p>
                    )}
                    <p className="font-bold mt-2">กรุณาให้ HR Manager ตั้งค่า Labor Cost Term + Rate Conditions ให้ครบก่อน หรือกดยืนยันเพื่อสร้าง Batch (คนงานเหล่านี้จะได้ค่าจ้าง 0)</p>
                  </AlertDescription>
                </Alert>
              )}

              {preflight && !preflight.hasWarnings && (
                <Alert className="bg-green-50 border-green-300 text-green-900">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  <AlertTitle className="font-bold">ตรวจสอบผ่าน</AlertTitle>
                  <AlertDescription className="text-xs">
                    พร้อมประมวลผล {preflight.totalWorkers} คน / {preflight.totalTimesheets} ใบงาน — ทุกคนมี Rate Condition ครบ
                  </AlertDescription>
                </Alert>
              )}

              <DialogFooter className="flex-col gap-2 sm:flex-col">
                {!preflight ? (
                  <Button onClick={handlePreflight} variant="outline" className="w-full font-bold h-12" disabled={isChecking || !targetPeriodId}>
                    {isChecking ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
                    ตรวจสอบก่อนประมวลผล (Pre-check)
                  </Button>
                ) : (
                  <Button onClick={handleGenerate} className="w-full bg-primary font-bold h-12" disabled={isGenerating || !targetPeriodId}>
                    {isGenerating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <TrendingUp className="h-4 w-4 mr-2" />}
                    {preflight.hasWarnings ? 'ยืนยันสร้าง Batch (มีคนงานได้ 0)' : 'เริ่มการประมวลผล (Start Processing)'}
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <PageGuidance 
          title="นโยบายการเบิกจ่าย (Disbursement Policy)"
          tips={[
            "รายการที่เข้า Payroll Batch ต้องเป็น daily timesheet ที่ระบบตั้ง readyForPayroll แล้ว — โดยปกติหลังผู้จัดการ Ops/HR อนุมัติงวดเดือน (wave month review) ซึ่งจะเปิดให้ลูกค้าเห็นสรุปใน portal และสร้าง Draft Invoice ได้ตามลำดับงาน",
            "ลำดับการอนุมัติภายใน: HR เตรียมงวด → HR Manager / ผู้จัดการที่เกี่ยวข้องอนุมัติ batch → บัญชีเตรียมจ่ายเงิน (Finance Prep)",
            "ข้อมูลใน Batch จะถูก Snapshot ไว้เพื่อป้องกันการเปลี่ยนแปลงย้อนหลังในประวัติคนงาน"
          ]}
        />

        <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && !adminBusy && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ลบชุดจ่าย (Admin)</AlertDialogTitle>
              <AlertDialogDescription>
                ยืนยันการลบ <span className="font-mono font-semibold">{deleteTarget?.id}</span> — ระบบจะปลดล็อก daily timesheets ที่เกี่ยวข้อง
                และลบ snapshot ของงวดนี้ การกระทำนี้ไม่สามารถย้อนกลับได้
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={adminBusy}>ยกเลิก</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={(e) => {
                  e.preventDefault();
                  void handleAdminDelete();
                }}
                disabled={adminBusy}
              >
                {adminBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ลบ'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={regenTarget !== null} onOpenChange={(open) => !open && !adminBusy && setRegenTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>สร้างชุดจ่ายใหม่ (Regenerate)</AlertDialogTitle>
              <AlertDialogDescription>
                ระบบจะลบ <span className="font-mono font-semibold">{regenTarget?.id}</span> ปลดล็อก timesheets แล้วประมวลผลใหม่
                ตามรอบบัญชีและขอบเขตเดิม — จะได้รหัสชุดจ่ายใหม่
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={adminBusy}>ยกเลิก</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  void handleAdminRegenerate();
                }}
                disabled={adminBusy}
              >
                {adminBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'สร้างใหม่'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isBatchesLoading ? (
              <div className="py-20 text-center animate-pulse">กำลังประมวลผลข้อมูล...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="pl-6 py-4 font-bold">รหัสชุดจ่าย (Batch ID)</TableHead>
                    <TableHead className="font-bold">ขอบเขต (Scope)</TableHead>
                    <TableHead className="font-bold text-center">จำนวนคน</TableHead>
                    <TableHead className="font-bold text-right">ยอดจ่ายสุทธิ (Net)</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                    <TableHead className="font-bold">วันที่สร้าง</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batches?.map((b) => (
                    <TableRow key={b.id} className="hover:bg-muted/30 group transition-all cursor-pointer" onClick={() => router.push(`/payroll/batches/${b.id}`)}>
                      <TableCell className="pl-6 py-4 font-mono text-xs font-bold text-primary">{b.id}</TableCell>
                      <TableCell className="capitalize text-xs font-medium">{b.workModeScope}</TableCell>
                      <TableCell className="text-center font-bold">{b.totalWorkers} คน</TableCell>
                      <TableCell className="text-right font-black text-primary text-lg">฿ {b.netAmount.toLocaleString()}</TableCell>
                      <TableCell>{getStatusBadge(b.status)}</TableCell>
                      <TableCell className="text-[10px] text-muted-foreground">{formatDateThaiBE(b.createdAt)}</TableCell>
                      <TableCell
                        className="text-right pr-4"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-1 flex-wrap">
                          {isAdmin && (
                            <>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 px-2 text-destructive border-destructive/30 hover:bg-destructive/10"
                                title="ลบชุดจ่าย (Admin)"
                                disabled={adminBatchActionsBlocked(b.status)}
                                onClick={() => setDeleteTarget(b)}
                              >
                                <Trash2 className="h-3.5 w-3.5 shrink-0" />
                                <span className="hidden sm:inline ml-1">ลบ</span>
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 px-2"
                                title="สร้างชุดจ่ายใหม่ (Regenerate)"
                                disabled={adminBatchActionsBlocked(b.status)}
                                onClick={() => setRegenTarget(b)}
                              >
                                <RefreshCw className="h-3.5 w-3.5 shrink-0" />
                                <span className="hidden sm:inline ml-1">สร้างใหม่</span>
                              </Button>
                            </>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="group-hover:text-primary shrink-0"
                            title="ดูรายละเอียด"
                            onClick={() => router.push(`/payroll/batches/${b.id}`)}
                          >
                            <ChevronRight className="h-5 w-5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!batches || batches.length === 0) && !isBatchesLoading && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-20 text-muted-foreground italic">ยังไม่มีประวัติการจ่ายเงิน</TableCell>
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
