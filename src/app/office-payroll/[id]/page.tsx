'use client';

import { useState, use, useMemo } from 'react';
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
  Briefcase,
  ShieldAlert,
  Printer
} from 'lucide-react';
import { PayslipDialog } from '@/components/payroll/payslip-dialog';
import { buildPayslipFromOfficeLine } from '@/lib/payroll/payslip-model';
import { useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection, updateDoc, writeBatch } from 'firebase/firestore';
import { updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { 
  OfficePayrollRun, 
  OfficePayrollLine, 
  User as AppUser, 
  PayrollRunStatus,
  OfficeStaff
} from '@/lib/types';
import { formatDateThaiBE, formatDateTimeThaiBE } from '@/lib/date-thai';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import { useRouter } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { canView } from '@/lib/permissions';
import { usePermissions } from '@/hooks/use-permissions';
import { Label } from '@/components/ui/label';
import {
  computeOfficePayrollLineD8,
  loadPayrollPoliciesFromFirestore,
  resolvePayrollPoliciesForDate,
  runStatusToD8Lifecycle,
} from '@/lib/payroll/d8';
import { recordPayrollFinanceApprovalPayout } from '@/lib/services/payroll-payout-service';
import { useAppUser } from '@/hooks/use-app-user';
import { useCompanyDocumentProfile } from '@/hooks/use-company-document-profile';

export default function OfficePayrollDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const isAuthorized = useMemo(() => canView(currentUser, 'office_payroll'), [currentUser]);
  const { check } = usePermissions(currentUser);
  const canMutate = check('office_payroll', 'edit');

  const runRef = useMemoFirebase(() => (firestore && isAuthorized ? doc(firestore, 'office_payroll_runs', id) : null), [firestore, id, isAuthorized]);
  const { data: run, isLoading: isRunLoading } = useDoc<OfficePayrollRun>(runRef as any);

  const linesQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'office_payroll_runs', id, 'lines') : null), [firestore, id, isAuthorized]);
  const { data: lines, isLoading: isLinesLoading } = useCollection<OfficePayrollLine>(linesQuery as any);
  const { profile: companyProfile } = useCompanyDocumentProfile();

  const [isProcessing, setIsProcessing] = useState(false);

  // STRICT ENFORCEMENT: Only from 'office_staff' collection
  const staffQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'office_staff') : null), [firestore, isAuthorized]);
  const { data: allStaff } = useCollection<OfficeStaff>(staffQuery as any);

  const handleUpdateStatus = async (newStatus: PayrollRunStatus) => {
    if (!firestore || !run || !runRef || !currentUser) return;
    const updateData: Record<string, unknown> = {
      status: newStatus,
      d8LifecycleStatus: runStatusToD8Lifecycle(newStatus),
      updatedAt: Date.now(),
    };

    if (newStatus === 'HR_APPROVED') {
      updateData.hrApprovedBy = currentUser.displayName;
    }
    if (newStatus === 'FINANCE_APPROVED') {
      updateData.financeApprovedBy = currentUser.displayName;
      if (!run.financeCashbookEntryId) {
        try {
          const { cashbookEntryId, bankAccountId } = await recordPayrollFinanceApprovalPayout(
            firestore,
            currentUser,
            {
              runId: id,
              netAmount: run.netAmount,
              payrollRunNo: run.payrollRunNo,
              payrollMonthLabel: run.payrollMonth,
              payoutBankAccountId: run.payoutBankAccountId,
              kind: 'OFFICE_STAFF',
            }
          );
          updateData.financeCashbookEntryId = cashbookEntryId;
          updateData.payoutBankAccountId = bankAccountId;
        } catch (e) {
          console.error(e);
          toast({
            variant: 'destructive',
            title: 'บันทึกตัดจ่ายไม่สำเร็จ',
            description: e instanceof Error ? e.message : 'ตรวจสอบบัญชีธนาคาร ACTIVE',
          });
          return;
        }
      }
    }
    if (newStatus === 'LOCKED') {
      updateData.lockedAt = Date.now();
    }

    updateDocumentNonBlocking(runRef, updateData);
    toast({ title: 'อัปเดตสถานะสำเร็จ', description: `เปลี่ยนสถานะงวดเป็น ${newStatus}` });
  };

  const handleCalculate = async () => {
    if (!firestore || !run || !allStaff || !runRef) return;
    setIsProcessing(true);

    try {
      const batch = writeBatch(firestore);
      const linesCol = collection(firestore, 'office_payroll_runs', id, 'lines');
      
      // พนักงานสำนักงาน — ไม่รวมผู้บริหาร (งวดแยกในเมนูบัญชี)
      const activeStaff = allStaff.filter(
        (s) => s.status === 'ACTIVE' && s.payrollBand !== 'EXECUTIVE'
      );
      let totalGross = 0;
      let totalNet = 0;
      let totalAllowances = 0;
      let totalDeductions = 0;

      const policyRecords = await loadPayrollPoliciesFromFirestore(firestore);
      const asOf = run.payrollPeriodEnd || `${run.payrollMonth}-28`;
      const officePolicies = resolvePayrollPoliciesForDate(asOf, policyRecords, 'office');

      for (const staff of activeStaff) {
        const lineId = `OPL-${staff.staffCode}-${id.substring(0, 5)}`;
        const lineDoc = doc(linesCol, lineId);
        
        const baseSalary = staff.monthlySalary || 0;
        const allowance = 0;
        const bonus = 0;
        const d8 = computeOfficePayrollLineD8({
          asOfDate: asOf,
          policies: officePolicies,
          baseSalary,
          allowance,
          bonus,
          overtimeAmount: 0,
          otherIncome: 0,
        });

        const newLine: OfficePayrollLine = {
          id: lineId,
          officePayrollRunId: id,
          staffId: staff.id,
          staffName: staff.fullName,
          department: staff.department,
          positionTitle: staff.positionTitle,
          baseSalary,
          allowance,
          bonus,
          overtimeAmount: 0,
          otherIncome: 0,
          deductions: d8.deductions,
          tax: d8.tax,
          socialSecurity: d8.socialSecurity,
          grossPay: d8.grossPay,
          netPay: d8.netPay,
          d8Snapshot: d8.snapshot,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        batch.set(lineDoc, newLine);
        totalGross += d8.grossPay;
        totalNet += d8.netPay;
        totalAllowances += allowance + bonus;
        totalDeductions += d8.deductions;
      }

      await batch.commit();

      await updateDoc(runRef, {
        status: 'CALCULATED',
        d8LifecycleStatus: runStatusToD8Lifecycle('CALCULATED'),
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

  if (userLoading || !currentUser) return null;
  if (isRunLoading) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-12 w-12 text-primary animate-spin" /></div>;
  }

  if (!isAuthorized) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <ShieldAlert className="h-12 w-12 text-destructive opacity-50" />
          <h2 className="text-xl font-bold">ไม่มีสิทธิ์เข้าถึง (Access Restricted)</h2>
          <p className="text-muted-foreground">เฉพาะฝ่ายบริหารบุคคลและผู้จัดการฝ่ายการเงินเท่านั้นที่สามารถเข้าถึงข้อมูลรายละเอียดเงินเดือนได้</p>
        </div>
      </AppShell>
    );
  }

  if (!run) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="text-center py-20">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <h2 className="text-xl font-bold">ไม่พบข้อมูลใบลงเวลา</h2>
        </div>
      </AppShell>
    );
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
            <div className="space-y-2">
              <PayrollScopeTag scope="office" showHint={false} />
              <h1 className="text-2xl font-bold tracking-tight">รายละเอียดงวดจ่ายพนักงานออฟฟิศ</h1>
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <span className="font-mono font-bold text-primary">{run.payrollRunNo}</span>
                <Separator orientation="vertical" className="h-3" />
                <span>งวดเดือน: {formatDateThaiBE(run.payrollMonth + '-01')}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild className="gap-1">
              <Link href={`/office-payroll/${id}/print`}>
                <Printer className="h-4 w-4" />
                สลิปทั้งงวด
              </Link>
            </Button>
            <Badge variant={isLocked ? 'default' : 'outline'} className={isLocked ? 'bg-primary py-1.5 px-4' : 'py-1.5 px-4'}>
              {isLocked && <Lock className="h-3 w-3 mr-2" />}
              STATUS: {run.status}
            </Badge>
          </div>
        </div>

        <Alert className="bg-blue-50 border-blue-200 text-blue-800 shadow-sm">
          <ShieldAlert className="h-5 w-5 text-blue-600" />
          <AlertTitle className="font-bold">ระบบจ่ายเงินพนักงานภายใน (Internal Staff Payroll)</AlertTitle>
          <AlertDescription className="text-sm">
            งวดนี้เฉพาะพนักงานที่ <b>ไม่ใช่ผู้บริหาร</b> (ผู้บริหารอยู่เมนูบัญชี) — หักภาษีประมาณการจากฐานรายได้รายเดือน × 12 หักลดหย่อน 60,000 บ./ปี แล้วใช้ขั้นบันได หาร 12 ต่อเดือน; ประกันสังคมตามเพดานใน HR settings
          </AlertDescription>
        </Alert>
        {!canMutate && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>โหมดดูอย่างเดียว</AlertTitle>
            <AlertDescription>คุณมีสิทธิ์ดูข้อมูลนี้เท่านั้น การคำนวณและอนุมัติทำได้เฉพาะผู้มีสิทธิ์แก้ไขโมดูลเงินเดือนพนักงาน</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="จำนวนพนักงาน" value={`${run.staffCount} คน`} sub="Internal Office Staff" icon={Users} colorClass="border-l-blue-600" />
          <StatCard title="ยอดจ่ายรวม (Gross)" value={`฿${run.grossAmount.toLocaleString()}`} sub="Base Salary + Fixed Allowances" icon={Calculator} colorClass="border-l-amber-500" />
          <StatCard title="หักภาษี/SSO" value={`฿${run.totalDeductions.toLocaleString()}`} sub="Statutory Deductions" icon={TrendingUp} colorClass="border-l-red-500" />
          <StatCard title="ยอดจ่ายสุทธิ (Net)" value={`฿${run.netAmount.toLocaleString()}`} sub="Net Staff Payable" icon={Coins} colorClass="border-l-green-600" />
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
                  <CardTitle className="text-lg">รายการจ่ายเงินพนักงานบริษัท (Internal Settlement)</CardTitle>
                  <CardDescription>สรุปยอดจ่ายตามฐานข้อมูลพนักงานออฟฟิศส่วนกลาง</CardDescription>
                </div>
                {!isLocked && canMutate && (
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
                      <TableHead className="text-right w-[100px]">สลิป</TableHead>
                      <TableHead className="text-right">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines?.map(line => {
                      const slipModel = buildPayslipFromOfficeLine(line, run, companyProfile ?? undefined);
                      return (
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
                          <PayslipDialog model={slipModel} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon"><ChevronRight className="h-4 w-4" /></Button>
                        </TableCell>
                      </TableRow>
                    );})}
                    {(!lines || lines.length === 0) && !isLinesLoading && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-20 text-muted-foreground italic">
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
                    disabled={!canMutate || run.status !== 'CALCULATED'} 
                    onClick={() => void handleUpdateStatus('HR_APPROVED')}
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
                    disabled={!canMutate || run.status !== 'HR_APPROVED'}
                    onClick={() => void handleUpdateStatus('FINANCE_APPROVED')}
                  >
                    อนุมัติการเบิกจ่าย (Finance — สร้างรายการ cashbook + ตัดบัญชีธนาคาร)
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
                    <span className="text-sm">{isLocked ? `ล็อกเมื่อ ${formatDateThaiBE(run.lockedAt!)}` : 'รอล็อกงวดถาวร'}</span>
                  </div>
                  <Button 
                    className="w-full bg-primary" 
                    disabled={!canMutate || run.status !== 'FINANCE_APPROVED'}
                    onClick={() => void handleUpdateStatus('LOCKED')}
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
                    <p className="font-bold">{formatDateThaiBE(run.payrollMonth + '-01')}</p>
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
                      <p className="text-xs text-muted-foreground">{formatDateTimeThaiBE(run.updatedAt)}</p>
                      <p className="text-xs mt-1">Current processing stage</p>
                    </div>
                  </div>
                  <div className="flex gap-4 border-l-2 border-primary/20 pl-4 relative">
                    <div className="absolute -left-[9px] top-0 h-4 w-4 rounded-full bg-slate-300" />
                    <div>
                      <p className="font-bold uppercase text-muted-foreground">RUN CREATED</p>
                      <p className="text-xs text-muted-foreground">{formatDateTimeThaiBE(run.createdAt)}</p>
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
