'use client';

import { useState, useEffect, useMemo } from 'react';
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
  AlertTriangle
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { PayrollBatch, PayrollPeriod, User } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
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
import { useRouter } from 'next/navigation';
import { PageGuidance } from '@/components/layout/page-guidance';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';

export default function PayrollBatchesPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const batchQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'payroll_batches'), orderBy('createdAt', 'desc'), limit(50));
  }, [firestore]);
  const { data: batches, isLoading: isBatchesLoading } = useCollection<PayrollBatch>(batchQuery as any);

  const periodsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'payroll_periods'), orderBy('startDate', 'desc'));
  }, [firestore]);
  const { data: periods } = useCollection<PayrollPeriod>(periodsQuery as any);

  const [isGenerateOpen, setIsGenerateOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [targetPeriodId, setTargetPeriodId] = useState('');
  const [workModeFilter, setWorkModeScope] = useState<'onshore' | 'offshore' | 'mixed'>('mixed');
  const [preflight, setPreflight] = useState<PayrollPreflightResult | null>(null);

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

  if (isUserLoading || !currentUser) return null;

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
              <strong>Worker Payroll</strong> — สรุปจาก timesheet รายวันที่ผ่านการอนุมัติแล้ว ต่อรอบ period / wave
            </p>
          </div>
          
          <Dialog open={isGenerateOpen} onOpenChange={setIsGenerateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 h-11 px-6 bg-primary shadow-md font-bold">
                <Calculator className="h-5 w-5" /> สร้างรายการจ่ายใหม่ (Generate Batch)
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>ประมวลผล Payroll Batch ใหม่</DialogTitle>
                <DialogDescription>ระบบจะรวนรวมเฉพาะ Daily Timesheets ที่มีสถานะ "Client Approved" เท่านั้น</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label className="font-bold">เลือกรอบบัญชี (Select Period)</Label>
                  <Select onValueChange={setTargetPeriodId} value={targetPeriodId}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="เลือกรอบเดือนที่ต้องการจ่าย..." /></SelectTrigger>
                    <SelectContent>
                      {periods?.filter(p => p.status === 'OPEN' || p.status === 'PROCESSING').map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.label} ({p.startDate} ถึง {p.endDate})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
            "เฉพาะ timesheet ที่ลูกค้าอนุมัติแล้วเท่านั้นที่จะเข้าสู่รอบการคำนวณเงินเดือน (Payroll Batch)",
            "ลำดับการอนุมัติ: HR จัดทำ → HR Manager อนุมัติ → บัญชีเตรียมจ่ายเงิน (Finance Prep)",
            "ข้อมูลใน Batch จะถูก Snapshot ไว้เพื่อป้องกันการเปลี่ยนแปลงย้อนหลังในประวัติคนงาน"
          ]}
        />

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
                      <TableCell className="text-[10px] text-muted-foreground">{new Date(b.createdAt).toLocaleDateString('th-TH')}</TableCell>
                      <TableCell className="text-right pr-6">
                        <Button variant="ghost" size="icon" className="group-hover:text-primary"><ChevronRight className="h-5 w-5" /></Button>
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
