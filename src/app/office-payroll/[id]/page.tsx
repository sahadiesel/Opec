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
  Coins, 
  Users, 
  Calendar, 
  Lock, 
  AlertCircle, 
  CheckCircle2, 
  History,
  Calculator,
  ShieldCheck,
  Loader2,
  ChevronRight,
  TrendingUp,
  Info,
  XCircle,
  Clock,
  Building2,
  Briefcase
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useUser, useCollection } from '@/firebase';
import { doc, collection, updateDoc, writeBatch } from 'firebase/firestore';
import { updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { 
  OfficePayrollRun, 
  OfficePayrollLine, 
  User as AppUser, 
  PayrollRunStatus,
  OfficeStaff
} from '@/lib/types';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function OfficePayrollDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const runRef = useMemoFirebase(() => (firestore ? doc(firestore, 'office_payroll_runs', id) : null), [firestore, id]);
  const { data: run, isLoading: isRunLoading } = useDoc<OfficePayrollRun>(runRef as any);

  const linesQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'office_payroll_runs', id, 'lines') : null), [firestore, id]);
  const { data: lines, isLoading: isLinesLoading } = useCollection<OfficePayrollLine>(linesQuery as any);

  const [isProcessing, setIsProcessing] = useState(false);

  const staffQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'office_staff') : null), [firestore]);
  const { data: allStaff } = useCollection<OfficeStaff>(staffQuery as any);

  const handleUpdateStatus = (newStatus: PayrollRunStatus) => {
    if (!firestore || !run) return;
    const updateData: any = { 
      status: newStatus, 
      updatedAt: Date.now()
    };

    if (newStatus === 'HR_APPROVED') {
      updateData.hrApprovedBy = currentUser?.displayName;
    }
    if (newStatus === 'FINANCE_APPROVED') {
      updateData.financeApprovedBy = currentUser?.displayName;
    }
    if (newStatus === 'LOCKED') {
      updateData.lockedAt = Date.now();
    }

    updateDocumentNonBlocking(runRef!, updateData);
    toast({ title: "อัปเดตสถานะสำเร็จ", description: `เปลี่ยนสถานะงวดเป็น ${newStatus}` });
  };

  const handleCalculate = async () => {
    if (!firestore || !run || !allStaff) return;
    setIsProcessing(true);

    try {
      const batch = writeBatch(firestore);
      const linesCol = collection(firestore, 'office_payroll_runs', id, 'lines');
      
      const activeStaff = allStaff.filter(s => s.status === 'ACTIVE');
      let totalGross = 0;
      let totalNet = 0;
      let totalAllowances = 0;
      let totalDeductions = 0;

      for (const staff of activeStaff) {
        const lineId = `OPL-${staff.staffCode}-${id.substring(0, 5)}`;
        const lineDoc = doc(linesCol, lineId);
        
        const baseSalary = staff.monthlySalary || 0;
        const allowance = 0; 
        const bonus = 0;
        const tax = baseSalary * 0.03; 
        const socialSecurity = Math.min(baseSalary * 0.05, 750); 
        const deductions = tax + socialSecurity;
        
        const grossPay = baseSalary + allowance + bonus;
        const netPay = grossPay - deductions;

        const newLine: OfficePayrollLine = {
          id: lineId,
          staffId: staff.id,
          staffName: staff.fullName,
          department: staff.department,
          positionTitle: staff.positionTitle,
          baseSalary,
          allowance,
          bonus,
          deductions,
          tax,
          socialSecurity,
          grossPay,
          netPay,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        batch.set(lineDoc, newLine);
        totalGross += grossPay;
        totalNet += netPay;
        totalAllowances += allowance + bonus;
        totalDeductions += deductions;
      }

      await batch.commit();

      await updateDoc(runRef!, {
        status: 'CALCULATED',
        staffCount: activeStaff.length,
        grossAmount: totalGross,
        netAmount: totalNet,
        totalAllowances,
        totalDeductions,
        updatedAt: Date.now()
      });

      toast({ title: "คำนวณยอดสำเร็จ", description: `ประมวลผลพนักงาน ${activeStaff.length} รายเรียบร้อยแล้ว` });
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
      <div className="max-w-[1600px] mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.push('/office-payroll')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Office Payroll Detail (งวดเงินเดือนออฟฟิศ)</h1>
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <span className="font-mono font-bold text-primary">{run.payrollRunNo}</span>
                <Separator orientation="vertical" className="h-3" />
                <span>งวดเดือน: {new Date(run.payrollMonth + '-01').toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })}</span>
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
          <Alert className="bg-slate-100 border-slate-300 shadow-sm">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <AlertTitle className="font-bold">LOCKED - Read Only Access</AlertTitle>
            <AlertDescription>งวดการจ่ายนี้ถูกล็อกและผ่านการเบิกจ่ายโดยฝ่ายการเงินเรียบร้อยแล้ว</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="จำนวนพนักงาน" value={`${run.staffCount} คน`} sub="Active Office Staff" icon={Users} colorClass="border-l-blue-600" />
          <StatCard title="ยอดจ่ายรวม (Gross)" value={`฿${run.grossAmount.toLocaleString()}`} sub="Base + Allowances" icon={Calculator} colorClass="border-l-amber-500" />
          <StatCard title="หักภาษี/SSO" value={`฿${run.totalDeductions.toLocaleString()}`} sub="Total Deductions" icon={TrendingUp} colorClass="border-l-red-500" />
          <StatCard title="ยอดจ่ายสุทธิ (Net)" value={`฿${run.netAmount.toLocaleString()}`} sub="Total Payable" icon={Coins} colorClass="border-l-green-600" />
        </div>

        <Tabs defaultValue="lines" className="w-full">
          <TabsList className="grid grid-cols-5 w-full md:w-fit h-auto p-1 bg-muted/50">
            <TabsTrigger value="lines" className="gap-2 py-2 px-6">รายการเงินเดือน</TabsTrigger>
            <TabsTrigger value="summary" className="gap-2 py-2 px-6">สรุปยอด</TabsTrigger>
            <TabsTrigger value="approvals" className="gap-2 py-2 px-6">การอนุมัติ</TabsTrigger>
            <TabsTrigger value="details" className="gap-2 py-2 px-6">ข้อมูลงวด</TabsTrigger>
            <TabsTrigger value="history" className="gap-2 py-2 px-6">ประวัติ</TabsTrigger>
          </TabsList>

          <TabsContent value="lines" className="mt-6 space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
                <div>
                  <CardTitle className="text-lg">รายการจ่ายเงินพนักงาน (HR Preparation)</CardTitle>
                  <CardDescription>ฝ่ายบุคคลเตรียมรายการจากฐานข้อมูลพนักงานออฟฟิศ</CardDescription>
                </div>
                {!isLocked && (
                  <Button onClick={handleCalculate} disabled={isProcessing} className="bg-blue-600 hover:bg-blue-700">
                    {isProcessing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Calculator className="h-4 w-4 mr-2" />}
                    {run.status === 'DRAFT' ? 'คำนวณเงินเดือนพนักงาน' : 'คำนวณใหม่ (Refresh)'}
                  </Button>
                )}
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead>พนักงาน & ตำแหน่ง</TableHead>
                      <TableHead>ฐานเงินเดือน</TableHead>
                      <TableHead className="text-right">ยอดรวม (Gross)</TableHead>
                      <TableHead className="text-right">รายการหัก</TableHead>
                      <TableHead className="text-right font-bold">สุทธิ (Net)</TableHead>
                      <TableHead className="text-right">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines?.map(line => (
                      <TableRow key={line.id} className="hover:bg-muted/20">
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-bold text-sm text-primary">{line.staffName}</span>
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1"><Building2 className="h-2.5 w-2.5" /> {line.department} | {line.positionTitle}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm font-medium">฿{line.baseSalary.toLocaleString()}</span>
                        </TableCell>
                        <TableCell className="text-right font-medium">฿{line.grossPay.toLocaleString()}</TableCell>
                        <TableCell className="text-right text-red-600">-฿{line.deductions.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-black text-green-700">฿{line.netPay.toLocaleString()}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon"><ChevronRight className="h-4 w-4" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {(!lines || lines.length === 0) && !isLinesLoading && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-20 text-muted-foreground italic">
                          ยังไม่มีข้อมูลรายการจ่ายเงิน กรุณากดปุ่ม "คำนวณเงินเดือนพนักงาน"
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="summary" className="mt-6 space-y-6">
             <Card>
              <CardHeader><CardTitle>สรุปยอดรวมงวด (Payroll Summary)</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <div className="flex justify-between border-b pb-2">
                      <span className="text-muted-foreground">ยอดเงินเดือนพื้นฐาน (Total Base Salary)</span>
                      <span className="font-bold">฿{(run.grossAmount - run.totalAllowances).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between border-b pb-2">
                      <span className="text-muted-foreground">รวมเบี้ยเลี้ยง/โบนัส (Total Allowances)</span>
                      <span className="font-bold">฿{run.totalAllowances.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between border-b pb-2 pt-2 bg-muted/20 px-2 rounded">
                      <span className="font-black text-primary">ยอดรวมก่อนหัก (Total Gross)</span>
                      <span className="font-black text-primary">฿{run.grossAmount.toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between border-b pb-2 text-red-600">
                      <span>รวมรายการหักทั้งหมด (Total Deductions)</span>
                      <span className="font-bold">฿{run.totalDeductions.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between border-b pb-2 pt-2 bg-green-50 px-2 rounded text-green-700">
                      <span className="font-black">ยอดจ่ายสุทธิ (Net Payable)</span>
                      <span className="font-black text-lg">฿{run.netAmount.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="approvals" className="mt-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className={run.status === 'CALCULATED' ? 'border-blue-500 bg-blue-50/20' : ''}>
                <CardHeader>
                  <CardTitle className="text-sm font-bold uppercase text-primary flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> 1. HR Review (Preparation)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-2">
                    {run.hrApprovedBy ? <CheckCircle2 className="text-green-600 h-4 w-4" /> : <Clock className="text-muted-foreground h-4 w-4" />}
                    <span className="text-sm">{run.hrApprovedBy ? `Prepared/Approved by ${run.hrApprovedBy}` : 'รอ HR ตรวจสอบ'}</span>
                  </div>
                  <Button 
                    className="w-full bg-primary" 
                    disabled={run.status !== 'CALCULATED'} 
                    onClick={() => handleUpdateStatus('HR_APPROVED')}
                  >
                    ยืนยันรายการ (HR Approval)
                  </Button>
                </CardContent>
              </Card>

              <Card className={run.status === 'HR_APPROVED' ? 'border-blue-500 bg-blue-50/20' : ''}>
                <CardHeader>
                  <CardTitle className="text-sm font-bold uppercase text-primary flex items-center gap-2"><Coins className="h-4 w-4" /> 2. Finance Approval (Payment)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-2">
                    {run.financeApprovedBy ? <CheckCircle2 className="text-green-600 h-4 w-4" /> : <Clock className="text-muted-foreground h-4 w-4" />}
                    <span className="text-sm">{run.financeApprovedBy ? `Approved/Paid by ${run.financeApprovedBy}` : 'รอการเงินอนุมัติจ่าย'}</span>
                  </div>
                  <Button 
                    className="w-full" 
                    variant="outline" 
                    disabled={run.status !== 'HR_APPROVED'}
                    onClick={() => handleUpdateStatus('FINANCE_APPROVED')}
                  >
                    อนุมัติการเบิกจ่าย (Finance)
                  </Button>
                </CardContent>
              </Card>

              <Card className={run.status === 'FINANCE_APPROVED' ? 'border-primary bg-primary/5' : ''}>
                <CardHeader>
                  <CardTitle className="text-sm font-bold uppercase flex items-center gap-2"><Lock className="h-4 w-4" /> 3. Final Lock</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-2">
                    {isLocked ? <Lock className="text-primary h-4 w-4" /> : <Clock className="text-muted-foreground h-4 w-4" />}
                    <span className="text-sm">{isLocked ? `Locked on ${new Date(run.lockedAt!).toLocaleDateString()}` : 'รอล็อกงวดถาวร'}</span>
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
          </TabsContent>

          <TabsContent value="details" className="mt-6 space-y-6">
            <Card>
              <CardHeader><CardTitle>ข้อมูลพื้นฐานของงวด (Run Info)</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-1">
                    <Label className="text-xs uppercase text-muted-foreground">เลขที่งวด:</Label>
                    <p className="font-bold">{run.payrollRunNo}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs uppercase text-muted-foreground">ประจำเดือน:</Label>
                    <p className="font-bold">{new Date(run.payrollMonth + '-01').toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })}</p>
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
              <CardHeader><CardTitle className="text-lg flex items-center gap-2"><History className="h-5 w-5" /> ประวัติกิจกรรม (Run History)</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-6 text-sm">
                  <div className="flex gap-4 border-l-2 border-primary/20 pl-4 relative pb-4">
                    <div className="absolute -left-[9px] top-0 h-4 w-4 rounded-full bg-primary" />
                    <div>
                      <p className="font-bold uppercase">STATUS: {run.status}</p>
                      <p className="text-xs text-muted-foreground">{new Date(run.updatedAt).toLocaleString('th-TH')}</p>
                      <p className="text-xs mt-1">Current processing stage</p>
                    </div>
                  </div>
                  <div className="flex gap-4 border-l-2 border-primary/20 pl-4 relative">
                    <div className="absolute -left-[9px] top-0 h-4 w-4 rounded-full bg-slate-300" />
                    <div>
                      <p className="font-bold uppercase text-muted-foreground">RUN CREATED</p>
                      <p className="text-xs text-muted-foreground">{new Date(run.createdAt).toLocaleString('th-TH')}</p>
                      <p className="text-xs mt-1">Initial draft established</p>
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
              <p className="font-bold text-primary flex items-center gap-2">คำแนะนำขั้นตอนถัดไป (Workflow Process)</p>
              <p className="text-sm text-muted-foreground">
                {run.status === 'DRAFT' && "ขั้นตอนถัดไป: HR กดคำนวณเงินเดือนจากฐานข้อมูล Office Staff"}
                {run.status === 'CALCULATED' && "ขั้นตอนถัดไป: HR Manager ตรวจสอบความถูกต้องและยืนยันรายการ"}
                {run.status === 'HR_APPROVED' && "ขั้นตอนถัดไป: Finance Officer อนุมัติเบิกจ่ายและโอนเงิน"}
                {run.status === 'FINANCE_APPROVED' && "ขั้นตอนถัดไป: ล็อกงวดการจ่ายเงินเพื่อปิดบัญชีรายเดือน"}
                {isLocked && "สถานะสิ้นสุด: ข้อมูลถูกล็อกและบันทึก Snapshot ไว้เรียบร้อยแล้ว"}
              </p>
            </div>
          </div>
          {!isLocked && (
            <Button variant="outline" className="gap-2" onClick={() => router.push('/office-payroll')}>
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