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
  Calendar,
  AlertTriangle,
  Info,
  Clock,
  CheckCircle2,
  FileText,
  Loader2,
  ShieldAlert
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { OfficePayrollRun, PayrollRunStatus, User } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, query, orderBy } from 'firebase/firestore';
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

export default function OfficePayrollPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const runsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'office_payroll_runs'), orderBy('payrollMonth', 'desc')) : null), [firestore]);
  const { data: runs, isLoading } = useCollection<OfficePayrollRun>(runsQuery as any);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newRun, setNewRun] = useState<Partial<OfficePayrollRun>>({
    payrollRunNo: `O-PR-${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
    payrollMonth: new Date().toISOString().slice(0, 7),
    payrollPeriodStart: '',
    payrollPeriodEnd: '',
    notes: ''
  });

  const handleCreateRun = async () => {
    if (!firestore || !currentUser) return;
    if (!newRun.payrollMonth || !newRun.payrollPeriodStart || !newRun.payrollPeriodEnd) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาระบุเดือนและช่วงเวลาการจ่ายเงิน" });
      return;
    }

    try {
      const docRef = await addDocumentNonBlocking(collection(firestore, 'office_payroll_runs'), {
        ...newRun,
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
      toast({ title: "สร้างงวดเงินเดือนสำเร็จ", description: "กำลังนำคุณไปที่หน้าคำนวณและตรวจสอบ..." });
      if (docRef) router.push(`/office-payroll/${docRef.id}`);
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถสร้างงวดการจ่ายเงินได้" });
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
            <Coins className="h-8 w-8" /> เงินเดือนพนักงาน (Office Payroll)
          </h1>
          <p className="text-muted-foreground text-lg">
            คำนวณเงินเดือนพนักงานออฟฟิศรายเดือน (เตรียมข้อมูลโดย HR และจ่ายจริงโดยการเงิน)
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Alert className="bg-blue-50 border-blue-200 text-blue-800 shadow-sm">
            <Info className="h-5 w-5 text-blue-600" />
            <AlertTitle className="font-bold">นโยบายสายงาน (Workflow Policy)</AlertTitle>
            <AlertDescription className="text-xs">
              HR มีหน้าที่คำนวณและยืนยันยอดเงินเดือนตามประวัติ Staff -> การเงินมีหน้าที่อนุมัติเบิกจ่ายและลงบัญชี
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
          <div className="flex items-center gap-3 flex-1">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="ค้นหาเลขที่งวด..." className="pl-9 h-11" />
            </div>
            <Button variant="outline" className="h-11 gap-2"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
          </div>
          
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 h-11 px-6 bg-primary shadow-md text-base font-bold">
                <Plus className="h-5 w-5" /> สร้างงวดเงินเดือน (New Office Payroll)
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>สร้างงวดเงินเดือนพนักงานใหม่</DialogTitle>
                <DialogDescription>ระบุเดือนและช่วงเวลาสำหรับคำนวณเงินเดือน ระบบจะดึงพนักงานที่มีสถานะ ACTIVE มาโดยอัตโนมัติ</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                <div className="space-y-2 md:col-span-2">
                  <Label>เลขที่งวด (Run No.)</Label>
                  <Input value={newRun.payrollRunNo} onChange={e => setNewRun({...newRun, payrollRunNo: e.target.value})} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>เดือนที่จ่าย (Payroll Month)</Label>
                  <Input type="month" value={newRun.payrollMonth} onChange={e => setNewRun({...newRun, payrollMonth: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>วันที่เริ่ม (Period Start)</Label>
                  <Input type="date" value={newRun.payrollPeriodStart} onChange={e => setNewRun({...newRun, payrollPeriodStart: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>วันที่สิ้นสุด (Period End)</Label>
                  <Input type="date" value={newRun.payrollPeriodEnd} onChange={e => setNewRun({...newRun, payrollPeriodEnd: e.target.value})} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>หมายเหตุ</Label>
                  <Input value={newRun.notes} onChange={e => setNewRun({...newRun, notes: e.target.value})} placeholder="ระบุโครงการหรือข้อความเพิ่มเติม..." />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>ยกเลิก</Button>
                <Button onClick={handleCreateRun} className="bg-primary font-bold">สร้างงวดเงินเดือน (Confirm)</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลงวดเงินเดือน...</div>
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
                      onClick={() => router.push(`/office-payroll/${run.id}`)}
                    >
                      <TableCell className="py-4 font-bold text-primary font-mono">{run.payrollRunNo}</TableCell>
                      <TableCell className="font-medium">{new Date(run.payrollMonth + '-01').toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{run.payrollPeriodStart} ถึง {run.payrollPeriodEnd}</TableCell>
                      <TableCell className="text-center font-bold">{run.staffCount} คน</TableCell>
                      <TableCell className="text-right font-black text-primary">
                        ฿{run.netAmount.toLocaleString()}
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