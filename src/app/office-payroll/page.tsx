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
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { Input } from '@/components/ui/input';
import { formatDateThaiBE, htmlDateValueToTimestampMs, timestampToHtmlDateValue } from '@/lib/date-thai';
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
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';
import { canView } from '@/lib/permissions';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';

export default function OfficePayrollPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const isAuthorized = useMemo(() => canView(currentUser, 'office_payroll'), [currentUser]);

  const runsQuery = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return query(collection(firestore, 'office_payroll_runs'), orderBy('payrollMonth', 'desc'));
  }, [firestore, isAuthorized]);
  
  const { data: runs, isLoading } = useCollection<OfficePayrollRun>(runsQuery as any);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newRun, setNewRun] = useState<Partial<OfficePayrollRun>>({
    payrollRunNo: getPreviewPattern('office_payroll_run'),
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

    setIsCreating(true);
    try {
      // Atomic Number Generation
      const { code: finalNo } = await generateNextDocumentCode(firestore, 'office_payroll_run', { actor: currentUser.displayName });

      const docRef = await addDocumentNonBlocking(collection(firestore, 'office_payroll_runs'), {
        ...newRun,
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
      toast({ title: "สร้างงวดเงินเดือนสำเร็จ", description: `เลขที่: ${finalNo}` });
      if (docRef) router.push(`/office-payroll/${docRef.id}`);
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

  if (!isAuthorized) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <ShieldAlert className="h-12 w-12 text-destructive opacity-50" />
          <h2 className="text-xl font-bold">ไม่มีสิทธิ์เข้าถึง (Access Restricted)</h2>
          <p className="text-muted-foreground">เฉพาะฝ่ายบริหารบุคคล (HR Manager) และผู้จัดการฝ่ายบัญชีเท่านั้นที่สามารถเข้าถึงระบบนี้ได้</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="flex flex-col gap-2 min-w-0">
            <PayrollScopeTag scope="office" showHint={false} />
            <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
              <Coins className="h-8 w-8 shrink-0" /> งวดจ่ายเงินเดือนพนักงานออฟฟิศ
            </h1>
            <p className="text-muted-foreground text-lg">
              <strong>Office Payroll</strong> — รายเดือน ไม่ใช้ timesheet รายวัน · เตรียมโดย HR จ่ายจริงโดยการเงิน
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Alert className="bg-blue-50 border-blue-200 text-blue-800 shadow-sm">
            <Info className="h-5 w-5 text-blue-600" />
            <AlertTitle className="font-bold">นโยบายสายงาน (Workflow Policy)</AlertTitle>
            <AlertDescription className="text-xs">
              HR มีหน้าที่คำนวณและยืนยันยอดเงินเดือนตามประวัติ Staff → การเงินมีหน้าที่อนุมัติเบิกจ่ายและลงบัญชี
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
          
          <Dialog open={isAuthorized && isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 h-11 px-6 bg-primary shadow-md text-base font-bold">
                <Plus className="h-5 w-5" /> สร้างงวดเงินเดือน (New Office Payroll)
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>สร้างงวดเงินเดือนพนักงานใหม่</DialogTitle>
                <DialogDescription>ระบุเดือนและช่วงเวลาสำหรับคำนวณเงินเดือน ระบบจะรันเลขที่อัตโนมัติเมื่อบันทึก</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                <div className="space-y-2 md:col-span-2">
                  <Label>เลขที่งวด (Run No.)</Label>
                  <Input value={newRun.payrollRunNo} disabled className="bg-muted/50 font-mono font-bold" />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>เดือนที่จ่าย (Payroll Month)</Label>
                  <Input type="month" value={newRun.payrollMonth} onChange={e => setNewRun({...newRun, payrollMonth: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>วันที่เริ่ม (Period Start)</Label>
                  <DatePickerThaiBE
                    className="h-10"
                    value={htmlDateValueToTimestampMs(newRun.payrollPeriodStart)}
                    onChange={(ms) => setNewRun({ ...newRun, payrollPeriodStart: timestampToHtmlDateValue(ms) })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>วันที่สิ้นสุด (Period End)</Label>
                  <DatePickerThaiBE
                    className="h-10"
                    value={htmlDateValueToTimestampMs(newRun.payrollPeriodEnd)}
                    onChange={(ms) => setNewRun({ ...newRun, payrollPeriodEnd: timestampToHtmlDateValue(ms) })}
                  />
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
                      onClick={() => router.push(`/office-payroll/${run.id}`)}
                    >
                      <TableCell className="py-4 font-bold text-primary font-mono">{run.payrollRunNo}</TableCell>
                      <TableCell className="font-medium">{formatDateThaiBE(run.payrollMonth + '-01')}</TableCell>
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
