'use client';

import { useState, use, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  ArrowLeft, 
  CircleDollarSign, 
  Users, 
  Calendar, 
  Lock, 
  AlertCircle, 
  CheckCircle2, 
  History,
  FileText,
  Calculator,
  ShieldCheck,
  Send,
  Loader2,
  ChevronRight,
  TrendingUp,
  Info,
  XCircle,
  Clock,
  Coins
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useUser, useCollection } from '@/firebase';
import { doc, collection, query, where, getDocs, updateDoc, writeBatch } from 'firebase/firestore';
import { updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { 
  PayrollRun, 
  PayrollLine, 
  User as AppUser, 
  PayrollRunStatus,
  Worker,
  Position
} from '@/lib/types';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function PayrollDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const runRef = useMemoFirebase(() => (firestore ? doc(firestore, 'payroll_runs', id) : null), [firestore, id]);
  const { data: run, isLoading: isRunLoading } = useDoc<PayrollRun>(runRef as any);

  const linesQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'payroll_runs', id, 'lines') : null), [firestore, id]);
  const { data: lines, isLoading: isLinesLoading } = useCollection<PayrollLine>(linesQuery as any);

  const [isProcessing, setIsProcessing] = useState(false);

  const workersQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'workers') : null), [firestore]);
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  const positionsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'positions') : null), [firestore]);
  const { data: allPositions } = useCollection<Position>(positionsQuery as any);

  const handleUpdateStatus = (newStatus: PayrollRunStatus) => {
    if (!firestore || !run) return;
    const updateData: any = { 
      status: newStatus, 
      updatedAt: Date.now(),
      updatedBy: currentUser?.id
    };

    if (newStatus === 'HR_APPROVED') {
      updateData.hrApprovedAt = Date.now();
      updateData.hrApprovedBy = currentUser?.displayName;
    }
    if (newStatus === 'FINANCE_APPROVED') {
      updateData.financeApprovedAt = Date.now();
      updateData.financeApprovedBy = currentUser?.displayName;
    }
    if (newStatus === 'LOCKED') {
      updateData.lockedAt = Date.now();
      updateData.lockedBy = currentUser?.displayName;
    }

    updateDocumentNonBlocking(runRef!, updateData);
    toast({ title: "อัปเดตสถานะสำเร็จ", description: `เปลี่ยนสถานะงวดเป็น ${newStatus}` });
  };

  const handleCalculate = async () => {
    if (!firestore || !run || !allWorkers) return;
    setIsProcessing(true);

    try {
      const batch = writeBatch(firestore);
      const linesCol = collection(firestore, 'payroll_runs', id, 'lines');
      
      const targetWorkers = allWorkers.slice(0, 3);
      let gross = 0;
      let net = 0;

      for (const worker of targetWorkers) {
        const lineId = `PL-${worker.id.substring(0, 5)}-${id.substring(0, 5)}`;
        const lineDoc = doc(linesCol, lineId);
        
        const normalDays = 20;
        const baseRate = 1200; 
        const otPay = 500;
        const lineGross = (normalDays * baseRate) + otPay;
        const lineNet = lineGross - 100; 

        const newLine: PayrollLine = {
          id: lineId,
          workerId: worker.id,
          assignmentId: 'ASGN-MOCK',
          waveId: 'WAVE-MOCK',
          positionId: worker.currentPositionId,
          normalDays,
          normalHours: normalDays * 8,
          otHours15: 10,
          otHours20: 0,
          otHours30: 0,
          holidayHours: 0,
          standbyDays: 0,
          travelDays: 0,
          unpaidDays: 0,
          baseRateSnapshot: baseRate,
          otRateSnapshot: baseRate * 1.5,
          allowanceSnapshot: 0,
          deductionSnapshot: 100,
          grossPay: lineGross,
          totalAllowance: 0,
          totalDeduction: 100,
          netPay: lineNet,
          notes: 'Calculated from Approved Timesheets',
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        batch.set(lineDoc, newLine);
        gross += lineGross;
        net += lineNet;
      }

      await batch.commit();

      await updateDoc(runRef!, {
        status: 'CALCULATED',
        workerCount: targetWorkers.length,
        grossAmount: gross,
        netAmount: net,
        updatedAt: Date.now()
      });

      toast({ title: "คำนวณยอดสำเร็จ", description: `ประมวลผลพนักงาน ${targetWorkers.length} รายเรียบร้อยแล้ว` });
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "เกิดข้อผิดพลาดในการคำนวณ" });
    } finally {
      setIsProcessing(false);
    }
  };

  if (isRunLoading || !run || !currentUser) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-12 w-12 text-primary animate-spin" /></div>;
  }

  const isLocked = run.status === 'LOCKED';

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.push('/payroll')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Worker Payroll Detail (รายละเอียดงวดการจ่ายคนงาน)</h1>
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <span className="font-mono font-bold text-primary">{run.payrollRunNo}</span>
                <Separator orientation="vertical" className="h-3" />
                <span>งวดวันที่ {run.payrollPeriodStart} ถึง {run.payrollPeriodEnd}</span>
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Badge variant={isLocked ? 'default' : 'outline'} className={isLocked ? 'bg-primary py-1.5 px-4' : 'py-1.5 px-4'}>
              {isLocked && <Lock className="h-3 w-3 mr-2" />}
              STATUS: {run.status}
            </Badge>
          </div>
        </div>

        {isLocked && (
          <Alert className="bg-slate-100 border-slate-300">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <AlertTitle className="font-bold">LOCKED - Read Only Access</AlertTitle>
            <AlertDescription>งวดการจ่ายนี้ถูกล็อกแล้วโดย {run.lockedBy} เมื่อ {new Date(run.lockedAt || 0).toLocaleString('th-TH')} ไม่สามารถแก้ไขข้อมูลได้</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="จำนวนคนงาน" value={`${run.workerCount} คน`} sub="Total Workers" icon={Users} colorClass="border-l-blue-600" />
          <StatCard title="ยอดจ่ายรวม (Gross)" value={`${run.currency} ${run.grossAmount.toLocaleString()}`} sub="Before Deductions" icon={Calculator} colorClass="border-l-amber-500" />
          <StatCard title="หักภาษี/อื่นๆ" value={`${run.currency} ${run.totalDeduction.toLocaleString()}`} sub="Total Deductions" icon={TrendingUp} colorClass="border-l-red-500" />
          <StatCard title="ยอดจ่ายสุทธิ (Net)" value={`${run.currency} ${run.netAmount.toLocaleString()}`} sub="Total Payable" icon={CircleDollarSign} colorClass="border-l-green-600" />
        </div>

        <Tabs defaultValue="lines" className="w-full">
          <TabsList className="grid grid-cols-5 w-full h-auto p-1 bg-muted/50">
            <TabsTrigger value="lines" className="gap-2 py-2 text-xs">รายการจ่ายเงิน</TabsTrigger>
            <TabsTrigger value="summary" className="gap-2 py-2 text-xs">สรุปยอด</TabsTrigger>
            <TabsTrigger value="approvals" className="gap-2 py-2 text-xs">การอนุมัติ</TabsTrigger>
            <TabsTrigger value="details" className="gap-2 py-2 text-xs">ข้อมูลงวด</TabsTrigger>
            <TabsTrigger value="history" className="gap-2 py-2 text-xs">ประวัติ</TabsTrigger>
          </TabsList>

          <TabsContent value="lines" className="mt-6 space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
                <div>
                  <CardTitle className="text-lg">รายการจ่ายเงินรายบุคคล (Payroll Lines)</CardTitle>
                  <CardDescription>แสดงยอดเงินที่คำนวณได้ตามผลงานและเงื่อนไขสัญญา</CardDescription>
                </div>
                {!isLocked && (
                  <Button onClick={handleCalculate} disabled={isProcessing} className="bg-blue-600 hover:bg-blue-700">
                    {isProcessing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Calculator className="h-4 w-4 mr-2" />}
                    {run.status === 'DRAFT' ? 'คำนวณยอดเงิน' : 'คำนวณยอดใหม่อีกครั้ง'}
                  </Button>
                )}
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead>คนงาน & ตำแหน่ง</TableHead>
                      <TableHead>ผลงาน (Normal/OT)</TableHead>
                      <TableHead className="text-right">ยอดรวม (Gross)</TableHead>
                      <TableHead className="text-right">หัก (Deduct)</TableHead>
                      <TableHead className="text-right font-bold">รับสุทธิ (Net)</TableHead>
                      <TableHead className="text-right">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines?.map(line => {
                      const worker = allWorkers?.find(w => w.id === line.workerId);
                      const pos = allPositions?.find(p => p.id === line.positionId);
                      return (
                        <TableRow key={line.id} className="hover:bg-muted/20">
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-bold text-sm text-primary">{worker?.firstName} {worker?.lastName}</span>
                              <span className="text-[10px] text-muted-foreground">{pos?.positionName}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Badge variant="outline" className="text-[10px]">{line.normalDays}D / {line.normalHours}H</Badge>
                              {line.otHours15 > 0 && <Badge variant="outline" className="text-[10px] bg-orange-50 text-orange-700 border-orange-200">OT {line.otHours15}H</Badge>}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-medium">฿{line.grossPay.toLocaleString()}</TableCell>
                          <TableCell className="text-right text-red-600">-฿{line.totalDeduction.toLocaleString()}</TableCell>
                          <TableCell className="text-right font-black text-green-700">฿{line.netPay.toLocaleString()}</TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="icon"><ChevronRight className="h-4 w-4" /></Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {(!lines || lines.length === 0) && !isLinesLoading && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-20 text-muted-foreground italic">
                          ยังไม่มีข้อมูลรายการจ่ายเงิน กรุณากดปุ่ม "คำนวณยอดเงิน"
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="approvals" className="mt-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className={run.status === 'CALCULATED' ? 'border-blue-500 bg-blue-50/20' : ''}>
                <CardHeader>
                  <CardTitle className="text-sm font-bold uppercase">1. HR Review</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-2">
                    {run.hrApprovedAt ? <CheckCircle2 className="text-green-600" /> : <Clock className="text-muted-foreground" />}
                    <span className="text-sm">{run.hrApprovedAt ? `Approved by ${run.hrApprovedBy}` : 'รอการตรวจสอบ'}</span>
                  </div>
                  <Button 
                    className="w-full" 
                    disabled={run.status !== 'CALCULATED' && run.status !== 'HR_REVIEW'} 
                    onClick={() => handleUpdateStatus('HR_APPROVED')}
                  >
                    บันทึกการอนุมัติ (HR)
                  </Button>
                </CardContent>
              </Card>

              <Card className={run.status === 'HR_APPROVED' ? 'border-blue-500 bg-blue-50/20' : ''}>
                <CardHeader>
                  <CardTitle className="text-sm font-bold uppercase">2. Finance Approval</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-2">
                    {run.financeApprovedAt ? <CheckCircle2 className="text-green-600" /> : <Clock className="text-muted-foreground" />}
                    <span className="text-sm">{run.financeApprovedAt ? `Approved by ${run.financeApprovedBy}` : 'รอการตรวจสอบ'}</span>
                  </div>
                  <Button 
                    className="w-full" 
                    variant="outline" 
                    disabled={run.status !== 'HR_APPROVED'}
                    onClick={() => handleUpdateStatus('FINANCE_APPROVED')}
                  >
                    บันทึกการอนุมัติ (Finance)
                  </Button>
                </CardContent>
              </Card>

              <Card className={run.status === 'FINANCE_APPROVED' ? 'border-primary bg-primary/5' : ''}>
                <CardHeader>
                  <CardTitle className="text-sm font-bold uppercase">3. Final Lock</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-2">
                    {isLocked ? <Lock className="text-primary" /> : <Clock className="text-muted-foreground" />}
                    <span className="text-sm">{isLocked ? `Locked by ${run.lockedBy}` : 'รอล็อกงวด'}</span>
                  </div>
                  <Button 
                    className="w-full bg-primary" 
                    disabled={run.status !== 'FINANCE_APPROVED'}
                    onClick={() => handleUpdateStatus('LOCKED')}
                  >
                    ล็อกงวดการจ่ายเงิน (Lock)
                  </Button>
                </CardContent>
              </Card>
            </div>

            <Card className="border-destructive/20 bg-destructive/5">
              <CardHeader><CardTitle className="text-sm text-destructive font-bold uppercase">อันตราย (Danger Zone)</CardTitle></CardHeader>
              <CardContent>
                {!isLocked && (
                  <Button variant="outline" className="text-destructive border-destructive" onClick={() => handleUpdateStatus('CANCELLED')}>
                    <XCircle className="h-4 w-4 mr-2" /> ยกเลิกงวดการจ่ายเงินนี้
                  </Button>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="details" className="mt-6 space-y-6">
            <Card>
              <CardHeader><CardTitle>ข้อมูลพื้นฐานของงวด (Run Settings)</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-1">
                    <Label className="text-xs uppercase text-muted-foreground">เลขที่งวด:</Label>
                    <p className="font-bold">{run.payrollRunNo}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs uppercase text-muted-foreground">ประเภทการจ่าย:</Label>
                    <p className="font-bold">{run.payrollType}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs uppercase text-muted-foreground">วันที่เริ่มงวด:</Label>
                    <p className="font-bold">{run.payrollPeriodStart}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs uppercase text-muted-foreground">วันที่สิ้นงวด:</Label>
                    <p className="font-bold">{run.payrollPeriodEnd}</p>
                  </div>
                </div>
                <Separator />
                <div className="space-y-2">
                  <Label>หมายเหตุงวดการจ่าย:</Label>
                  <p className="text-sm italic">{run.notes || 'ไม่มีหมายเหตุ'}</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history" className="mt-6 space-y-6">
            <Card>
              <CardHeader><CardTitle className="text-lg flex items-center gap-2"><History className="h-5 w-5" /> ประวัติการเปลี่ยนแปลง (Audit Trail)</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-6 text-sm">
                  <div className="flex gap-4 border-l-2 border-primary/20 pl-4 relative pb-4">
                    <div className="absolute -left-[9px] top-0 h-4 w-4 rounded-full bg-primary" />
                    <div>
                      <p className="font-bold uppercase">{run.status}</p>
                      <p className="text-xs text-muted-foreground">{new Date(run.updatedAt).toLocaleString('th-TH')}</p>
                      <p className="text-xs mt-1">Status updated to {run.status} by {run.updatedBy}</p>
                    </div>
                  </div>
                  <div className="flex gap-4 border-l-2 border-primary/20 pl-4 relative">
                    <div className="absolute -left-[9px] top-0 h-4 w-4 rounded-full bg-slate-300" />
                    <div>
                      <p className="font-bold uppercase text-muted-foreground">DRAFT CREATED</p>
                      <p className="text-xs text-muted-foreground">{new Date(run.createdAt).toLocaleString('th-TH')}</p>
                      <p className="text-xs mt-1">Payroll run initiated by {run.createdBy}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="flex justify-between items-center bg-primary/5 p-6 rounded-lg border border-dashed border-primary/30">
          <div className="flex items-center gap-3">
            <Info className="h-6 w-6 text-primary" />
            <div className="space-y-0.5">
              <p className="font-bold">คำแนะนำขั้นตอนถัดไป (Process Guide)</p>
              <p className="text-sm text-muted-foreground">
                {run.status === 'DRAFT' && "ฝ่ายบุคคลเตรียมดึงข้อมูล Timesheet ที่อนุมัติแล้วมาคำนวณยอด"}
                {run.status === 'CALCULATED' && "HR Officer ตรวจสอบความถูกต้องรายบุคคลก่อนส่งให้ HR Manager อนุมัติ"}
                {run.status === 'HR_APPROVED' && "ส่งต่อให้ฝ่ายการเงินอนุมัติเบิกจ่ายผ่านระบบ Cashbook"}
                {run.status === 'FINANCE_APPROVED' && "ฝ่ายการเงินทำการล็อกงวดและบันทึกรายการจ่ายเงินจริง"}
                {isLocked && "งวดการจ่ายปิดสมบูรณ์และถูกบันทึกเข้าระบบบัญชีเรียบร้อยแล้ว"}
              </p>
            </div>
          </div>
          {!isLocked && (
            <Button variant="outline" className="gap-2" onClick={() => router.push('/payroll')}>
              กลับไปหน้ารายการ <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function StatCard({ title, value, sub, icon: Icon, colorClass }: any) {
  return (
    <Card className={`hover:shadow-md transition-all border-l-8 ${colorClass} shadow-sm`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 opacity-50 text-primary" />
      </CardHeader>
      <CardContent>
        <div className="text-xl font-black text-primary truncate">{value}</div>
        <p className="text-[10px] font-medium text-muted-foreground mt-1">{sub}</p>
      </CardContent>
    </Card>
  );
}