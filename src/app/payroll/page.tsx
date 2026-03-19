'use client';

import { useState, useEffect } from 'react';
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
  CircleDollarSign, 
  Calendar,
  AlertTriangle,
  Info,
  Clock,
  CheckCircle2,
  FileText,
  Loader2
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { PayrollRun, PayrollRunStatus, PayrollType, User } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, query, orderBy } from 'firebase/firestore';
import { addDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription,
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';

export default function PayrollPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const runsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'payroll_runs'), orderBy('createdAt', 'desc')) : null), [firestore]);
  const { data: runs, isLoading } = useCollection<PayrollRun>(runsQuery as any);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newRun, setNewRun] = useState<Partial<PayrollRun>>({
    payrollRunNo: getPreviewPattern('payroll_run'),
    payrollPeriodStart: '',
    payrollPeriodEnd: '',
    payrollType: 'MONTHLY',
    currency: 'THB',
    notes: ''
  });

  const handleCreateRun = async () => {
    if (!firestore || !currentUser) return;
    if (!newRun.payrollPeriodStart || !newRun.payrollPeriodEnd) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาระบุช่วงเวลาการจ่ายเงิน" });
      return;
    }

    setIsCreating(true);
    try {
      // Atomic Number Generation
      const { code: finalNo } = await generateNextDocumentCode(firestore, 'payroll_run', { actor: currentUser.displayName });

      const docRef = await addDocumentNonBlocking(collection(firestore, 'payroll_runs'), {
        ...newRun,
        payrollRunNo: finalNo,
        status: 'DRAFT',
        workerCount: 0,
        grossAmount: 0,
        totalAllowance: 0,
        totalDeduction: 0,
        netAmount: 0,
        sourceTimesheetBatchIds: [],
        createdAt: Date.now(),
        createdBy: currentUser.displayName,
        updatedAt: Date.now(),
        updatedBy: currentUser.id
      });

      setIsDialogOpen(false);
      toast({ title: "สร้างงวดการจ่ายเงินสำเร็จ", description: `เลขที่: ${finalNo}` });
      if (docRef) router.push(`/payroll/${docRef.id}`);
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถสร้างงวดการจ่ายเงินได้" });
    } finally {
      setIsCreating(false);
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

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <CircleDollarSign className="h-8 w-8" /> จ่ายเงินคนงาน (Worker Payroll)
          </h1>
          <p className="text-muted-foreground text-lg">
            ฝ่ายบุคคลจัดทำงวดการจ่ายเงินจาก Timesheet และส่งให้ฝ่ายการเงินดำเนินการเบิกจ่าย (HR Prepares → Finance Pays)
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Alert className="bg-amber-50 border-amber-200 text-amber-800 shadow-sm">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <AlertTitle className="font-bold">นโยบายการจ่ายเงิน (Payroll Policy)</AlertTitle>
            <AlertDescription className="text-xs">
              Payroll ที่ล็อกแล้วไม่สามารถแก้ไขได้ ข้อมูลถูกเก็บเป็น Snapshot เพื่อความถูกต้องในการตรวจสอบบัญชี (Audit)
            </AlertDescription>
          </Alert>
          <Alert className="bg-blue-50 border-blue-200 text-blue-800 shadow-sm">
            <Info className="h-5 w-5 text-blue-600" />
            <AlertTitle className="font-bold">สายงานรับผิดชอบ (Responsibility)</AlertTitle>
            <AlertDescription className="text-xs">
              เตรียมข้อมูลโดย HR Officer → ตรวจสอบโดย HR Manager → เบิกจ่ายโดย Finance Officer
            </AlertDescription>
          </Alert>
        </div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="ค้นหาเลขที่งวดการจ่าย..." className="pl-9 h-11" />
            </div>
            <Button variant="outline" className="h-11 gap-2"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
          </div>
          
          <Dialog open={isAuthorized && isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 h-11 px-6 bg-primary shadow-md text-base font-bold">
                <Plus className="h-5 w-5" /> สร้างงวดการจ่ายเงิน (New Payroll)
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>สร้างงวดการจ่ายเงินใหม่ (Worker Payroll Entry)</DialogTitle>
                <DialogDescription>ระบุช่วงเวลาและประเภทการจ่ายเงิน ระบบจะรันเลขที่อัตโนมัติเมื่อกดยืนยัน</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                <div className="space-y-2 md:col-span-2">
                  <Label>เลขที่งวดการจ่าย (Run No.)</Label>
                  <Input value={newRun.payrollRunNo} disabled className="bg-muted/50 font-mono font-bold" />
                </div>
                <div className="space-y-2">
                  <Label>วันที่เริ่มงวด (Period Start)</Label>
                  <Input type="date" value={newRun.payrollPeriodStart} onChange={e => setNewRun({...newRun, payrollPeriodStart: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>วันที่สิ้นสุดงวด (Period End)</Label>
                  <Input type="date" value={newRun.payrollPeriodEnd} onChange={e => setNewRun({...newRun, payrollPeriodEnd: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>ประเภทการจ่าย (Type)</Label>
                  <Select onValueChange={(v: any) => setNewRun({...newRun, payrollType: v})} defaultValue={newRun.payrollType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MONTHLY">รายเดือน (Monthly)</SelectItem>
                      <SelectItem value="WAVE_BASED">ตามเวฟงาน (Wave-based)</SelectItem>
                      <SelectItem value="SPECIAL_RUN">งวดพิเศษ (Special)</SelectItem>
                      <SelectItem value="ADJUSTMENT">ปรับปรุงยอด (Adjustment)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>สกุลเงิน (Currency)</Label>
                  <Select onValueChange={(v: any) => setNewRun({...newRun, currency: v})} defaultValue={newRun.currency}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="THB">THB - บาท</SelectItem>
                      <SelectItem value="USD">USD - ดอลลาร์สหรัฐ</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isCreating}>ยกเลิก</Button>
                <Button onClick={handleCreateRun} className="bg-primary font-bold" disabled={isCreating}>
                  {isCreating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  สร้างงวดงาน (Confirm)
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลการจ่ายเงิน...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4">เลขที่งวด (Run No.)</TableHead>
                    <TableHead className="font-bold">ช่วงเวลา (Period)</TableHead>
                    <TableHead className="font-bold">ประเภท</TableHead>
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
                      onClick={() => router.push(`/payroll/${run.id}`)}
                    >
                      <TableCell className="py-4 font-bold text-primary font-mono">{run.payrollRunNo}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-xs font-medium">
                          <Calendar className="h-3 w-3 text-muted-foreground" />
                          {run.payrollPeriodStart} ถึง {run.payrollPeriodEnd}
                        </div>
                      </TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{run.payrollType}</Badge></TableCell>
                      <TableCell className="text-center font-bold">{run.workerCount} คน</TableCell>
                      <TableCell className="text-right font-black text-primary">
                        {run.currency} {run.netAmount.toLocaleString()}
                      </TableCell>
                      <TableCell>{getStatusBadge(run.status)}</TableCell>
                      <TableCell className="text-right pr-6">
                        <Button variant="ghost" size="icon" className="group-hover:text-primary"><ChevronRight className="h-5 w-5" /></Button>
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
      </div>
    </AppShell>
  );
}
