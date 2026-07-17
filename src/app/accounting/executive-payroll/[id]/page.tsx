'use client';

import { useState, use, useEffect, useMemo, useCallback } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
  Printer,
  Trash2,
} from 'lucide-react';
import { PayslipDialog } from '@/components/payroll/payslip-dialog';
import { ExecutivePayrollWhtBatchDialog } from '@/components/payroll/executive-payroll-wht-batch-dialog';
import { ExecutivePayrollWhtSingleDialog } from '@/components/payroll/executive-payroll-wht-single-dialog';
import { buildPayslipFromOfficeLine } from '@/lib/payroll/payslip-model';
import type { CompanyDocumentProfileForPayrollWht } from '@/lib/payroll/payroll-worker-wht-types';
import { canPreviewOfficePayrollWht } from '@/lib/payroll/payroll-office-wht-permissions';
import { useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection, getDoc, updateDoc, query, where, type DocumentData } from 'firebase/firestore';
import {
  BankAccount,
  OfficePayrollRun,
  OfficePayrollLine,
  User as AppUser,
  PayrollRunStatus,
  ExecutivePayrollStaff,
  OfficeStaff,
} from '@/lib/types';
import { formatDateThaiBE, formatDateTimeThaiBE } from '@/lib/date-thai';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { canView, canDelete } from '@/lib/permissions';
import { usePermissions } from '@/hooks/use-permissions';
import { Label } from '@/components/ui/label';
import { loadPayrollPoliciesFromFirestore, resolvePayrollPoliciesForDate, runStatusToD8Lifecycle } from '@/lib/payroll/d8';
import { pitFromPolicy, socialSecurityFromPolicy } from '@/lib/payroll/d8/deductions-from-policy';
import { recordPayrollFinanceApprovalPayout } from '@/lib/services/payroll-payout-service';
import {
  applyExecutivePayrollRunLines,
  adminExecutivePayrollDeleteBlocked,
  deleteExecutivePayrollRunCascade,
  isExecutivePayrollStaffEligible,
} from '@/lib/payroll/executive-payroll-run-apply';
import { useCompanyDocumentProfile } from '@/hooks/use-company-document-profile';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export default function ExecutivePayrollDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const isAuthorized = useMemo(() => canView(currentUser, 'executive_payroll'), [currentUser]);
  const { check } = usePermissions(currentUser);
  const canMutate = check('executive_payroll', 'edit');

  const runRef = useMemoFirebase(() => (firestore && isAuthorized ? doc(firestore, 'executive_payroll_runs', id) : null), [firestore, id, isAuthorized]);
  const { data: run, isLoading: isRunLoading } = useDoc<OfficePayrollRun>(runRef as any);

  const linesQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'executive_payroll_runs', id, 'lines') : null), [firestore, id, isAuthorized]);
  const { data: lines, isLoading: isLinesLoading } = useCollection<OfficePayrollLine>(linesQuery as any);

  const linesSorted = useMemo(() => {
    const list = [...(lines ?? [])];
    list.sort((a, b) =>
      (a.staffName || '').localeCompare(b.staffName || '', 'th', {
        sensitivity: 'base',
        numeric: true,
      }),
    );
    return list;
  }, [lines]);

  const executiveWhtPeriodLabel = useMemo(() => {
    if (!run) return '';
    return `${run.payrollPeriodStart} → ${run.payrollPeriodEnd} (${run.payrollMonth})`;
  }, [run]);

  const canExecutiveWhtPreview =
    !!run && !!currentUser && canPreviewOfficePayrollWht(currentUser as AppUser, run.status) && linesSorted.length > 0;
  const executiveWhtDisabledReason =
    linesSorted.length === 0
      ? 'ยังไม่มีรายการจ่ายในทะเบียนงวดนี้'
      : !run || !currentUser || !canPreviewOfficePayrollWht(currentUser as AppUser, run.status)
        ? 'งวดนี้ยังไม่พร้อมใบหัก ณ ที่จ่าย (ต้องคำนวณแล้ว)'
        : undefined;

  const [isProcessing, setIsProcessing] = useState(false);

  const rosterQuery = useMemoFirebase(
    () => (firestore && isAuthorized ? collection(firestore, 'executive_payroll_staff') : null),
    [firestore, isAuthorized],
  );
  const { data: executiveRoster } = useCollection<ExecutivePayrollStaff>(rosterQuery as any);

  const { profile: companyProfile } = useCompanyDocumentProfile();
  const companyProfileWhtRef = useMemoFirebase(
    () => (firestore && isAuthorized ? doc(firestore, 'system', 'company_profile') : null),
    [firestore, isAuthorized],
  );
  const { data: companyProfileForWht } = useDoc<CompanyDocumentProfileForPayrollWht>(companyProfileWhtRef as any);
  const canDeleteRun = useMemo(() => canDelete(currentUser, 'executive_payroll'), [currentUser]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeletingRun, setIsDeletingRun] = useState(false);
  const [payoutBankId, setPayoutBankId] = useState('');
  const [statusBusy, setStatusBusy] = useState(false);

  const bankAccountsQuery = useMemoFirebase(
    () => (firestore && isAuthorized ? query(collection(firestore, 'bank_accounts'), where('status', '==', 'ACTIVE')) : null),
    [firestore, isAuthorized],
  );
  const { data: bankAccounts } = useCollection<BankAccount>(bankAccountsQuery as any);
  const activeBanks = useMemo(() => {
    const list = (bankAccounts || []).slice();
    list.sort((a, b) => (a.accountCode || '').localeCompare(b.accountCode || '', 'th', { numeric: true }));
    return list;
  }, [bankAccounts]);

  useEffect(() => {
    if (run?.payoutBankAccountId) {
      setPayoutBankId(run.payoutBankAccountId);
    } else {
      setPayoutBankId('');
    }
  }, [run?.payoutBankAccountId, run?.id]);

  const payoutBankAccountId = run?.payoutBankAccountId ?? '';
  const payoutAccountLabel = useMemo(() => {
    if (!payoutBankAccountId) return null;
    const b = activeBanks.find((x) => x.id === payoutBankAccountId);
    return b
      ? `${b.bankName} · ${b.accountName} [${b.accountCode}]`
      : payoutBankAccountId;
  }, [payoutBankAccountId, activeBanks]);

  const validateExecutivePayoutIdentity = useCallback(async () => {
    if (!firestore) return;
    const missing: string[] = [];

    for (const line of linesSorted) {
      let exec =
        (executiveRoster ?? []).find((x) => x.id === line.staffId) ??
        (executiveRoster ?? []).find((x) => x.staffCode && line.id.includes(x.staffCode));

      if (!exec) {
        const exSnap = await getDoc(doc(firestore, 'executive_payroll_staff', line.staffId));
        if (exSnap.exists()) exec = { id: exSnap.id, ...exSnap.data() } as ExecutivePayrollStaff;
      }

      let nationalId = (exec?.nationalId || '').trim();
      const linkedId = (exec?.linkedOfficeStaffId || '').trim();
      if (!nationalId && linkedId) {
        const linkedSnap = await getDoc(doc(firestore, 'office_staff', linkedId));
        if (linkedSnap.exists()) {
          nationalId = ((linkedSnap.data() as OfficeStaff).nationalId || '').trim();
        }
      }

      if (nationalId.replace(/\D/g, '').length !== 13) {
        missing.push(line.staffName || exec?.fullName || line.staffId);
      }
    }

    if (missing.length > 0) {
      const sample = missing.slice(0, 5).join(', ');
      const more = missing.length > 5 ? ` และอีก ${missing.length - 5} คน` : '';
      throw new Error(
        `ทำจ่ายไม่ได้: ต้องกรอกเลขบัตรประชาชน 13 หลักในทะเบียนผู้บริหาร/office_staff ให้ครบก่อน (${sample}${more})`,
      );
    }
  }, [firestore, linesSorted, executiveRoster]);

  const persistPayoutBankChoice = useCallback(
    async (bankId: string) => {
      if (!runRef || !firestore || !canMutate || !run) return;
      if (['FINANCE_APPROVED', 'LOCKED', 'PAID', 'CANCELLED'].includes(run.status)) return;
      setPayoutBankId(bankId);
      try {
        await updateDoc(runRef, { payoutBankAccountId: bankId, updatedAt: Date.now() });
      } catch (e) {
        toast({
          variant: 'destructive',
          title: 'บันทึกบัญชีตัดจ่ายไม่สำเร็จ',
          description: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [runRef, firestore, canMutate, run, toast],
  );

  const handleUpdateStatus = async (newStatus: PayrollRunStatus) => {
    if (!firestore || !run || !runRef || !currentUser) return;
    setStatusBusy(true);
    const updateData: Record<string, unknown> = {
      status: newStatus,
      d8LifecycleStatus: runStatusToD8Lifecycle(newStatus),
      updatedAt: Date.now(),
    };

    try {
      if (newStatus === 'FINANCE_APPROVED') {
        await validateExecutivePayoutIdentity();
        updateData.financeApprovedBy = currentUser.displayName;
        const bankForPayout = (payoutBankId || run.payoutBankAccountId || '').trim();
        if (!run.financeCashbookEntryId) {
          if (!bankForPayout) {
            toast({
              variant: 'destructive',
              title: 'ยังไม่ได้เลือกบัญชีตัดจ่าย',
              description: 'เลือกบัญชีธนาคารที่ต้องการหักยอดก่อนกดอนุมัติการเบิกจ่าย — ระบบจะสร้างรายการ cashbook จากบัญชีนี้',
            });
            setStatusBusy(false);
            return;
          }
          const { cashbookEntryId, bankAccountId } = await recordPayrollFinanceApprovalPayout(
            firestore,
            currentUser,
            {
              runId: id,
              netAmount: run.netAmount,
              payrollRunNo: run.payrollRunNo,
              payrollMonthLabel: run.payrollMonth,
              payoutBankAccountId: bankForPayout,
              kind: 'EXECUTIVE',
            },
          );
          updateData.financeCashbookEntryId = cashbookEntryId;
          updateData.payoutBankAccountId = bankAccountId;
        }
      }
      if (newStatus === 'LOCKED') {
        updateData.lockedAt = Date.now();
      }

      await updateDoc(runRef, updateData as DocumentData);
      toast({ title: 'อัปเดตสถานะสำเร็จ', description: `เปลี่ยนสถานะงวดเป็น ${newStatus}` });
    } catch (e) {
      console.error(e);
      toast({
        variant: 'destructive',
        title: newStatus === 'FINANCE_APPROVED' ? 'บันทึกตัดจ่ายหรืองวดไม่สำเร็จ' : 'บันทึกสถานะงวดไม่สำเร็จ',
        description: e instanceof Error ? e.message : 'ตรวจสอบสิทธิ์และบัญชีธนาคาร',
      });
    } finally {
      setStatusBusy(false);
    }
  };

  const handleCalculate = async () => {
    if (!firestore || !run || !executiveRoster || !runRef) return;
    setIsProcessing(true);

    try {
      const activeStaff = executiveRoster.filter(isExecutivePayrollStaffEligible);
      if (activeStaff.length === 0) {
        toast({
          variant: 'destructive',
          title: 'ไม่มีรายชื่อสำหรับคำนวณ',
          description:
            'เพิ่มผู้บริหารที่เมนู «รายชื่อผู้บริหาร» และตั้งสถานะ ACTIVE (ไม่เลือกข้ามงวด)',
        });
        return;
      }

      await applyExecutivePayrollRunLines(firestore, id, run, activeStaff, { newStatus: 'CALCULATED' });

      toast({
        title: 'คำนวณยอดสำเร็จ',
        description: `ประมวลผล ${activeStaff.length} รายจากทะเบียนผู้บริหาร`,
      });
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'คำนวณไม่สำเร็จ',
        description: e instanceof Error ? e.message : 'เกิดข้อผิดพลาดในการคำนวณ',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmDeleteRun = async () => {
    if (!firestore || !run || !canDeleteRun || adminExecutivePayrollDeleteBlocked(run)) return;
    setIsDeletingRun(true);
    try {
      await deleteExecutivePayrollRunCascade(firestore, id);
      toast({ title: 'ลบงวดแล้ว', description: `เลขที่ ${run.payrollRunNo}` });
      setDeleteDialogOpen(false);
      router.push('/accounting/executive-payroll');
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'ลบไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setIsDeletingRun(false);
    }
  };

  if (isRunLoading || !currentUser) {
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
            <Button variant="ghost" size="icon" onClick={() => router.push('/accounting/executive-payroll')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Executive Payroll (ผู้บริหาร — บัญชีเท่านั้น)</h1>
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <span className="font-mono font-bold text-primary">{run.payrollRunNo}</span>
                <Separator orientation="vertical" className="h-3" />
                <span>งวดเดือน: {formatDateThaiBE(run.payrollMonth + '-01')}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {lines && lines.length > 0 && (
              <>
                {firestore && run ? (
                  <ExecutivePayrollWhtBatchDialog
                    firestore={firestore}
                    run={run}
                    linesSorted={linesSorted}
                    periodLabel={executiveWhtPeriodLabel}
                    companyProfile={companyProfileForWht ?? null}
                    currentUser={currentUser as AppUser}
                    disabled={!canExecutiveWhtPreview}
                    disabledTitle={executiveWhtDisabledReason}
                  />
                ) : null}
                <Button variant="outline" size="sm" className="gap-2" asChild>
                  <Link href={`/accounting/executive-payroll/${id}/print`}>
                    <Printer className="h-4 w-4" /> พิมพ์สลิปทั้งงวด
                  </Link>
                </Button>
              </>
            )}
            {canDeleteRun && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2 text-destructive border-destructive/30 hover:bg-destructive/10"
                disabled={adminExecutivePayrollDeleteBlocked(run)}
                title={
                  adminExecutivePayrollDeleteBlocked(run)
                    ? 'ลบไม่ได้ — งวดล็อกหรืออนุมัติการเงิน/จ่ายแล้ว'
                    : 'ลบงวดนี้ (ผู้มีสิทธิ์ลบ)'
                }
                onClick={() => setDeleteDialogOpen(true)}
              >
                <Trash2 className="h-4 w-4" /> ลบงวด
              </Button>
            )}
            <Badge variant={isLocked ? 'default' : 'outline'} className={isLocked ? 'bg-primary py-1.5 px-4' : 'py-1.5 px-4'}>
              {isLocked && <Lock className="h-3 w-3 mr-2" />}
              STATUS: {run.status}
            </Badge>
          </div>
        </div>

        <Alert className="bg-blue-50 border-blue-200 text-blue-800 shadow-sm">
          <ShieldAlert className="h-5 w-5 text-blue-600" />
          <AlertTitle className="font-bold">งวดเงินเดือนผู้บริหาร (Executive — ไม่แสดงในเมนู HR)</AlertTitle>
          <AlertDescription className="text-sm">
            ดึงรายชื่อจากเมนู <b>รายชื่อผู้บริหาร</b> — สูตรภาษี/ประกันสังคมเทียบเท่าพนักงานออฟฟิศ — หลังคำนวณแล้วไปแท็บ{' '}
            <b>ทำจ่าย · ล็อก</b> เพื่อเลือกบัญชีตัดจ่ายและลง cashbook (ไม่ต้องรอ HR อนุมัติ)
          </AlertDescription>
        </Alert>
        {!canMutate && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>โหมดดูอย่างเดียว</AlertTitle>
            <AlertDescription>คุณมีสิทธิ์ดูข้อมูลนี้เท่านั้น การคำนวณและอนุมัติทำได้เฉพาะผู้มีสิทธิ์แก้ไขโมดูลเงินเดือนผู้บริหาร</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="จำนวนพนักงาน" value={`${run.staffCount} คน`} sub="Executive payroll" icon={Users} colorClass="border-l-blue-600" />
          <StatCard title="ยอดจ่ายรวม (Gross)" value={`฿${run.grossAmount.toLocaleString()}`} sub="Base Salary + Fixed Allowances" icon={Calculator} colorClass="border-l-amber-500" />
          <StatCard title="หักภาษี/SSO" value={`฿${run.totalDeductions.toLocaleString()}`} sub="Statutory Deductions" icon={TrendingUp} colorClass="border-l-red-500" />
          <StatCard title="ยอดจ่ายสุทธิ (Net)" value={`฿${run.netAmount.toLocaleString()}`} sub="Net Staff Payable" icon={Coins} colorClass="border-l-green-600" />
        </div>

        <Tabs defaultValue="lines" className="w-full">
          <TabsList className="grid grid-cols-5 w-full md:w-fit h-auto p-1 bg-muted/50">
            <TabsTrigger value="lines" className="gap-2 py-2 px-6">รายการเงินเดือน</TabsTrigger>
            <TabsTrigger value="summary" className="gap-2 py-2 px-6">สรุปยอด</TabsTrigger>
            <TabsTrigger value="approvals" className="gap-2 py-2 px-6">ทำจ่าย · ล็อก</TabsTrigger>
            <TabsTrigger value="details" className="gap-2 py-2 px-6">ข้อมูลงวด</TabsTrigger>
            <TabsTrigger value="history" className="gap-2 py-2 px-6">ประวัติ</TabsTrigger>
          </TabsList>

          <TabsContent value="lines" className="mt-6 space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
                <div>
                  <CardTitle className="text-lg">รายการจ่ายผู้บริหาร</CardTitle>
                  <CardDescription>สรุปยอดจ่ายจากทะเบียนผู้บริหาร — สลิปและภาษีใช้สูตรเดียวกับพนักงานออฟฟิศตามนโยบาย HR</CardDescription>
                </div>
                {!isLocked && canMutate && (run.status === 'DRAFT' || run.status === 'CALCULATED') && (
                  <Button onClick={handleCalculate} disabled={isProcessing} className="bg-blue-600 hover:bg-blue-700">
                    {isProcessing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Calculator className="h-4 w-4 mr-2" />}
                    {run.status === 'DRAFT' ? 'คำนวณเงินเดือนผู้บริหาร' : 'คำนวณใหม่ (Refresh)'}
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
                      <TableHead className="text-center w-[88px] px-1">ใบหักฯ</TableHead>
                      <TableHead className="text-right w-[100px]">สลิป</TableHead>
                      <TableHead className="text-right">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLinesLoading && (
                      <TableRow>
                        <TableCell colSpan={9} className="py-12 text-center text-muted-foreground">
                          <Loader2 className="h-6 w-6 inline animate-spin mr-2" />
                          กำลังโหลดรายการ…
                        </TableCell>
                      </TableRow>
                    )}
                    {!isLinesLoading &&
                      (lines ?? []).map((line) => {
                        const slipModel = buildPayslipFromOfficeLine(
                          line,
                          run,
                          companyProfile ?? undefined,
                          'ผู้บริหาร / Executive Payroll (รายเดือน)',
                        );
                        return (
                          <TableRow key={line.id} className="hover:bg-muted/20">
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="font-bold text-sm text-primary">{line.staffName}</span>
                                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                  <Building2 className="h-2.5 w-2.5" /> {line.department} | {line.positionTitle}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className="text-sm font-medium">฿{line.baseSalary.toLocaleString()}</span>
                            </TableCell>
                            <TableCell className="text-right font-medium">฿{line.grossPay.toLocaleString()}</TableCell>
                            <TableCell className="text-right text-red-600">-฿{line.deductions.toLocaleString()}</TableCell>
                            <TableCell className="text-right font-black text-green-700">฿{line.netPay.toLocaleString()}</TableCell>
                            <TableCell className="text-center align-middle px-1">
                              {firestore && run ? (
                                <ExecutivePayrollWhtSingleDialog
                                  firestore={firestore}
                                  run={run}
                                  line={line}
                                  periodLabel={executiveWhtPeriodLabel}
                                  companyProfile={companyProfileForWht ?? null}
                                  currentUser={currentUser as AppUser}
                                  disabled={!canExecutiveWhtPreview}
                                  disabledTitle={executiveWhtDisabledReason}
                                />
                              ) : (
                                '—'
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <PayslipDialog model={slipModel} />
                            </TableCell>
                            <TableCell className="text-right">
                              <Button variant="ghost" size="icon" asChild title="รายละเอียดจ่าย (รายคน)">
                                <Link
                                  href={`/accounting/executive-payroll/${encodeURIComponent(id)}/staff/${encodeURIComponent(line.staffId)}`}
                                >
                                  <ChevronRight className="h-4 w-4" />
                                </Link>
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    {!isLinesLoading && (!lines || lines.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-20 text-muted-foreground italic">
                          ยังไม่มีข้อมูลรายการจ่ายเงิน กรุณากดปุ่ม &quot;คำนวณเงินเดือนผู้บริหาร&quot;
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
            <Alert className="border-primary/30 bg-muted/30">
              <Info className="h-4 w-4" />
              <AlertTitle>งวดผู้บริหาร — ฝ่ายบัญชีเป็นผู้ดำเนินการเอง</AlertTitle>
              <AlertDescription className="text-sm">
                ไม่มีขั้นตอน «ส่งให้ HR/ผู้จัดการอนุมัติ» เหมือนงวดพนักงานออฟฟิศ — หลังคำนวณแล้วเลือกบัญชีตัดจ่าย กดอนุมัติการเงิน (ลง cashbook)
                แล้วล็อกงวดได้เลย (โครงเดียวกับหน้า «พนักงานออฟฟิศ · ทำจ่าย»)
              </AlertDescription>
            </Alert>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card
                className={
                  run.status === 'CALCULATED' || run.status === 'HR_APPROVED' ? 'border-blue-500 bg-blue-50/20' : ''
                }
              >
                <CardHeader>
                  <CardTitle className="text-sm font-bold uppercase text-primary flex items-center gap-2">
                    <Coins className="h-4 w-4" /> ตัดจ่าย · Cashbook
                  </CardTitle>
                  <CardDescription>
                    เลือกบัญชีที่หักยอด — กดอนุมัติเมื่อโอนจริงแล้ว ระบบจะลงรายการ{' '}
                    <Link href="/cashbook" className="font-medium text-primary underline">
                      cashbook
                    </Link>{' '}
                    (PAYROLL) และลดยอดบัญชีที่เลือก (คำอธิบายจะมีข้อความ «ตัดจากบัญชี …»)
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-2">
                    {run.financeApprovedBy ? (
                      <CheckCircle2 className="text-green-600 h-4 w-4" />
                    ) : (
                      <Clock className="text-muted-foreground h-4 w-4" />
                    )}
                    <span className="text-sm">
                      {run.financeApprovedBy ? `อนุมัติ/จ่ายโดย ${run.financeApprovedBy}` : 'ยังไม่อนุมัติการเงิน'}
                    </span>
                  </div>
                  {(run.status === 'CALCULATED' || run.status === 'HR_APPROVED') && !run.financeCashbookEntryId ? (
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold">บัญชีตัดจ่าย (บังคับเลือก)</Label>
                      {activeBanks.length === 0 ? (
                        <p className="text-xs text-destructive">ไม่พบบัญชี ACTIVE — ตั้งค่าที่เมนูบัญชีธนาคารก่อน</p>
                      ) : (
                        <Select
                          value={payoutBankId || undefined}
                          onValueChange={(v) => void persistPayoutBankChoice(v)}
                          disabled={!canMutate || statusBusy}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="เลือกบัญชีที่หักยอด…" />
                          </SelectTrigger>
                          <SelectContent>
                            {activeBanks.map((b) => (
                              <SelectItem key={b.id} value={b.id}>
                                [{b.accountCode}] {b.bankName} — {b.accountName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  ) : null}
                  {run.financeCashbookEntryId ? (
                    <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs space-y-1">
                      <p>
                        <span className="text-muted-foreground">บัญชีที่ตัดจ่าย:</span>{' '}
                        <span className="font-medium">{payoutAccountLabel ?? run.payoutBankAccountId ?? '—'}</span>
                      </p>
                      <p className="font-mono text-muted-foreground">
                        Cashbook doc: {run.financeCashbookEntryId}{' '}
                        <Link href="/cashbook" className="text-primary underline">
                          เปิดสมุดรายรับรายจ่าย
                        </Link>
                      </p>
                    </div>
                  ) : null}
                  <Button
                    className="w-full"
                    variant="default"
                    disabled={
                      !canMutate ||
                      statusBusy ||
                      !!run.financeCashbookEntryId ||
                      !['CALCULATED', 'HR_APPROVED'].includes(run.status)
                    }
                    onClick={() => void handleUpdateStatus('FINANCE_APPROVED')}
                  >
                    {statusBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    อนุมัติการเบิกจ่าย (cashbook + ตัดบัญชี)
                  </Button>
                </CardContent>
              </Card>

              <Card className={run.status === 'FINANCE_APPROVED' ? 'border-primary bg-primary/5' : ''}>
                <CardHeader>
                  <CardTitle className="text-sm font-bold uppercase flex items-center gap-2">
                    <Lock className="h-4 w-4" /> ล็อกงวด
                  </CardTitle>
                  <CardDescription>หลังจ่ายและตรวจสอบแล้ว — ปิดงวดถาวร</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-2">
                    {isLocked ? <Lock className="text-primary h-4 w-4" /> : <Clock className="text-muted-foreground h-4 w-4" />}
                    <span className="text-sm">{isLocked ? `ล็อกเมื่อ ${formatDateThaiBE(run.lockedAt!)}` : 'รอล็อกงวดถาวร'}</span>
                  </div>
                  <Button
                    className="w-full bg-primary"
                    disabled={!canMutate || run.status !== 'FINANCE_APPROVED' || statusBusy}
                    onClick={() => void handleUpdateStatus('LOCKED')}
                  >
                    {statusBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
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
                {run.status === 'DRAFT' && 'ขั้นตอนถัดไป: กดคำนวณจากทะเบียนรายชื่อผู้บริหาร — ตรวจสอบเมนู «รายชื่อผู้บริหาร» ว่ามีผู้ ACTIVE'}
                {run.status === 'CALCULATED' &&
                  'ขั้นตอนถัดไป: แท็บ «ทำจ่าย · ล็อก» — เลือกบัญชีตัดจ่ายแล้วกดอนุมัติการเงิน (cashbook)'}
                {run.status === 'HR_APPROVED' &&
                  'ขั้นตอนถัดไป: แท็บ «ทำจ่าย · ล็อก» — เลือกบัญชีและอนุมัติการเงิน (งวดเก่าอาจข้ามขั้นตอน HR ไว้)'}
                {run.status === 'FINANCE_APPROVED' && "ขั้นตอนถัดไป: ล็อกงวดการจ่ายเงินเพื่อปิดบัญชีรายเดือน"}
                {isLocked && "สถานะสิ้นสุด: ข้อมูลถูกล็อกและบันทึก Snapshot ไว้เรียบร้อยแล้ว"}
              </p>
            </div>
          </div>
          {!isLocked && (
            <Button variant="outline" className="gap-2" onClick={() => router.push('/accounting/executive-payroll')}>
              กลับไปหน้ารายการ <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>

        <AlertDialog open={deleteDialogOpen} onOpenChange={(open) => !open && !isDeletingRun && setDeleteDialogOpen(false)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ลบงวดเงินเดือนผู้บริหาร?</AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <span className="block">
                  จะลบ <span className="font-mono font-semibold">{run.payrollRunNo}</span> และรายการจ่ายทั้งหมดในงวดนี้
                  การกระทำนี้ย้อนกลับไม่ได้
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeletingRun}>ยกเลิก</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={isDeletingRun}
                onClick={(e) => {
                  e.preventDefault();
                  void handleConfirmDeleteRun();
                }}
              >
                {isDeletingRun ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ลบ'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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
