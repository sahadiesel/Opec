'use client';

import { use, useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  ArrowLeft,
  Building2,
  Calculator,
  CheckCircle2,
  Clock,
  Coins,
  Info,
  Loader2,
  Lock,
  Printer,
  ShieldAlert,
  TrendingUp,
  Users,
} from 'lucide-react';
import { PayslipDialog } from '@/components/payroll/payslip-dialog';
import { buildPayslipFromOfficeLine } from '@/lib/payroll/payslip-model';
import { useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { collection, doc, query, updateDoc, where, type DocumentData } from 'firebase/firestore';
import { OfficePayrollLine, OfficePayrollRun, BankAccount, PayrollRunStatus, User as AppUser } from '@/lib/types';
import { formatDateThaiBE, formatDateTimeThaiBE, formatPayrollYearMonthEnAbbrev } from '@/lib/date-thai';
import { useToast } from '@/hooks/use-toast';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { canView } from '@/lib/permissions';
import { usePermissions } from '@/hooks/use-permissions';
import { Label } from '@/components/ui/label';
import { recordPayrollFinanceApprovalPayout } from '@/lib/services/payroll-payout-service';
import { useCompanyDocumentProfile } from '@/hooks/use-company-document-profile';
import { useAppUser } from '@/hooks/use-app-user';
import { runStatusToD8Lifecycle } from '@/lib/payroll/d8';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export default function AccountingOfficePayrollPayoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { profile: companyProfile } = useCompanyDocumentProfile();

  const isAuthorized = useMemo(() => canView(currentUser, 'office_payroll'), [currentUser]);
  const { check } = usePermissions(currentUser);
  const canMutate = check('office_payroll', 'edit');

  const runRef = useMemoFirebase(
    () => (firestore && isAuthorized ? doc(firestore, 'office_payroll_runs', id) : null),
    [firestore, id, isAuthorized],
  );
  const { data: run, isLoading: isRunLoading } = useDoc<OfficePayrollRun>(runRef as any);

  const linesQuery = useMemoFirebase(
    () => (firestore && isAuthorized ? collection(firestore, 'office_payroll_runs', id, 'lines') : null),
    [firestore, id, isAuthorized],
  );
  const { data: lines, isLoading: isLinesLoading } = useCollection<OfficePayrollLine>(linesQuery as any);

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
    if (run?.payoutBankAccountId) setPayoutBankId(run.payoutBankAccountId);
    else setPayoutBankId('');
  }, [run?.payoutBankAccountId, run?.id]);

  const payoutAccountLabel = useMemo(() => {
    if (!run?.payoutBankAccountId) return null;
    const b = activeBanks.find((x) => x.id === run.payoutBankAccountId);
    return b ? `${b.bankName} · ${b.accountName} [${b.accountCode}]` : run.payoutBankAccountId;
  }, [run?.payoutBankAccountId, activeBanks]);

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
        updateData.financeApprovedBy = currentUser.displayName;
        const bankForPayout = (payoutBankId || run.payoutBankAccountId || '').trim();
        if (!run.financeCashbookEntryId) {
          if (!bankForPayout) {
            toast({
              variant: 'destructive',
              title: 'ยังไม่ได้เลือกบัญชีตัดจ่าย',
              description: 'เลือกบัญชีธนาคารก่อนอนุมัติการเบิกจ่าย — ระบบจะลง cashbook จากบัญชีนี้',
            });
            setStatusBusy(false);
            return;
          }
          const { cashbookEntryId, bankAccountId } = await recordPayrollFinanceApprovalPayout(
            firestore,
            currentUser as AppUser,
            {
              runId: id,
              netAmount: run.netAmount,
              payrollRunNo: run.payrollRunNo,
              payrollMonthLabel: run.payrollMonth,
              payoutBankAccountId: bankForPayout,
              kind: 'OFFICE_STAFF',
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
      toast({ title: 'บันทึกสำเร็จ', description: `สถานะงวด: ${newStatus}` });
    } catch (e) {
      console.error(e);
      toast({
        variant: 'destructive',
        title: 'บันทึกไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setStatusBusy(false);
    }
  };

  if (userLoading || !currentUser) return null;

  if (!isAuthorized) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <ShieldAlert className="h-12 w-12 text-destructive opacity-50" />
          <h2 className="text-xl font-bold">ไม่มีสิทธิ์เข้าถึง</h2>
        </div>
      </AppShell>
    );
  }

  if (isRunLoading) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  if (!run) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <p className="text-center text-muted-foreground py-20">ไม่พบงวดเงินเดือน</p>
      </AppShell>
    );
  }

  const isLocked = run.status === 'LOCKED';
  const readyForPayout = run.status === 'HR_APPROVED';
  const readyForLock = run.status === 'FINANCE_APPROVED';
  const hrIncomplete = ['DRAFT', 'CALCULATED', 'HR_REVIEW'].includes(run.status);

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-[1600px] mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.push('/accounting/office-payroll')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <Badge className="mb-1 border-0 bg-primary text-[10px] font-bold uppercase tracking-wide text-primary-foreground">
                Accounting · Office payroll
              </Badge>
              <h1 className="text-2xl font-bold tracking-tight">ทำจ่ายเงินเดือนพนักงานออฟฟิศ</h1>
              <div className="text-sm text-muted-foreground flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold text-primary">{run.payrollRunNo}</span>
                <Separator orientation="vertical" className="h-3" />
                <span>{formatPayrollYearMonthEnAbbrev(run.payrollMonth)}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/office-payroll/${id}`}>มุมมอง HR (คำนวณ / อนุมัติ)</Link>
            </Button>
            <Button variant="outline" size="sm" asChild className="gap-1">
              <Link href={`/office-payroll/${id}/print`}>
                <Printer className="h-4 w-4" />
                สลิปทั้งงวด
              </Link>
            </Button>
            <Badge variant={isLocked ? 'default' : 'outline'} className="py-1.5 px-3">
              {run.status}
            </Badge>
          </div>
        </div>

        {hrIncomplete && (
          <Alert variant="destructive">
            <AlertTitle>งวดยังไม่พร้อมให้บัญชีทำจ่าย</AlertTitle>
            <AlertDescription>
              สถานะปัจจุบัน <strong>{run.status}</strong> — รอฝ่าย HR/ผู้จัดการดำเนินการให้เป็น HR_APPROVED ก่อน
            </AlertDescription>
          </Alert>
        )}

        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>หน้านี้สำหรับฝ่ายบัญชี</AlertTitle>
          <AlertDescription className="text-sm">
            เลือกบัญชีที่ตัดยอด → อนุมัติการเบิกจ่าย (สร้างรายการ{' '}
            <Link href="/cashbook" className="font-medium text-primary underline">
              cashbook
            </Link>
            ) → ล็อกงวดเมื่อปิดยอด
          </AlertDescription>
        </Alert>

        {!canMutate && (
          <Alert>
            <AlertTitle>โหมดดูอย่างเดียว</AlertTitle>
            <AlertDescription>ไม่มีสิทธิ์แก้ไขโมดูลเงินเดือนพนักงานออฟฟิศ</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="จำนวนพนักงาน" value={`${run.staffCount} คน`} sub={run.payrollRunNo} icon={Users} colorClass="border-l-blue-600" />
          <StatCard title="Gross" value={`฿${run.grossAmount.toLocaleString()}`} sub="ก่อนหัก" icon={Calculator} colorClass="border-l-amber-500" />
          <StatCard title="หัก" value={`฿${run.totalDeductions.toLocaleString()}`} sub="ภาษี/SSO/อื่น" icon={TrendingUp} colorClass="border-l-red-500" />
          <StatCard title="Net จ่าย" value={`฿${run.netAmount.toLocaleString()}`} sub="ตัดบัญชีตามยอดนี้" icon={Coins} colorClass="border-l-green-600" />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className={readyForPayout ? 'border-blue-500 bg-blue-50/20' : ''}>
            <CardHeader>
              <CardTitle className="text-sm font-bold uppercase flex items-center gap-2">
                <Coins className="h-4 w-4" /> ตัดจ่าย · Cashbook
              </CardTitle>
              <CardDescription>สร้างรายการรายจ่าย PAYROLL และลดยอดบัญชีที่เลือก</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2 text-sm">
                {run.financeApprovedBy ? <CheckCircle2 className="text-green-600 h-4 w-4" /> : <Clock className="text-muted-foreground h-4 w-4" />}
                <span>{run.financeApprovedBy ? `อนุมัติโดย ${run.financeApprovedBy}` : 'ยังไม่อนุมัติการเงิน'}</span>
              </div>
              {readyForPayout && !run.financeCashbookEntryId ? (
                <div className="space-y-2">
                  <Label className="text-xs font-semibold">บัญชีตัดจ่าย</Label>
                  {activeBanks.length === 0 ? (
                    <p className="text-xs text-destructive">ไม่พบบัญชี ACTIVE</p>
                  ) : (
                    <Select
                      value={payoutBankId || undefined}
                      onValueChange={(v) => void persistPayoutBankChoice(v)}
                      disabled={!canMutate || statusBusy}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="เลือกบัญชี…" />
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
                    Cashbook: {run.financeCashbookEntryId}{' '}
                    <Link href="/cashbook" className="text-primary underline">
                      เปิดสมุด
                    </Link>
                  </p>
                </div>
              ) : null}
              <Button
                variant="default"
                className="w-full"
                disabled={!canMutate || !readyForPayout || statusBusy || !!run.financeCashbookEntryId}
                onClick={() => void handleUpdateStatus('FINANCE_APPROVED')}
              >
                {statusBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                อนุมัติการเบิกจ่าย (cashbook + ตัดบัญชี)
              </Button>
            </CardContent>
          </Card>

          <Card className={readyForLock ? 'border-primary bg-primary/5' : ''}>
            <CardHeader>
              <CardTitle className="text-sm font-bold uppercase flex items-center gap-2">
                <Lock className="h-4 w-4" /> ล็อกงวด
              </CardTitle>
              <CardDescription>หลังจ่ายและตรวจสอบแล้ว — ปิดงวดถาวร</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2 text-sm">
                {isLocked ? <Lock className="text-primary h-4 w-4" /> : <Clock className="text-muted-foreground h-4 w-4" />}
                <span>{isLocked && run.lockedAt ? `ล็อกเมื่อ ${formatDateThaiBE(run.lockedAt)}` : 'ยังไม่ล็อก'}</span>
              </div>
              <Button
                className="w-full bg-primary"
                disabled={!canMutate || !readyForLock || statusBusy || isLocked}
                onClick={() => void handleUpdateStatus('LOCKED')}
              >
                {statusBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                ล็อกงวดการจ่ายเงิน
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="border-b">
            <CardTitle>รายการจ่าย (อ่านอย่างเดียว)</CardTitle>
            <CardDescription>ปรับยอดรายคนทำที่มุมมอง HR → รายคน</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead>พนักงาน</TableHead>
                  <TableHead>ฐาน</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">หัก</TableHead>
                  <TableHead className="text-right font-bold">สุทธิ</TableHead>
                  <TableHead className="text-right w-[100px]">สลิป</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLinesLoading && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-12 text-center">
                      <Loader2 className="h-6 w-6 animate-spin inline mr-2" />
                      กำลังโหลด…
                    </TableCell>
                  </TableRow>
                )}
                {!isLinesLoading &&
                  (lines ?? []).map((line) => {
                    const slipModel = buildPayslipFromOfficeLine(line, run, companyProfile ?? undefined);
                    return (
                      <TableRow key={line.id}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-semibold text-primary">{line.staffName}</span>
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <Building2 className="h-2.5 w-2.5" />
                              {line.department} | {line.positionTitle}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>฿{line.baseSalary.toLocaleString()}</TableCell>
                        <TableCell className="text-right">฿{line.grossPay.toLocaleString()}</TableCell>
                        <TableCell className="text-right text-red-600">-฿{line.deductions.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-bold text-green-700">฿{line.netPay.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{slipModel ? <PayslipDialog model={slipModel} /> : '—'}</TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">ข้อมูลงวด</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2 text-muted-foreground">
            <p>
              ช่วง: {run.payrollPeriodStart} – {run.payrollPeriodEnd}
            </p>
            <p>อัปเดตล่าสุด: {formatDateTimeThaiBE(run.updatedAt)}</p>
            {run.notes ? <p>หมายเหตุ: {run.notes}</p> : null}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function StatCard({
  title,
  value,
  sub,
  icon: Icon,
  colorClass,
}: {
  title: string;
  value: string;
  sub: string;
  icon: ComponentType<{ className?: string }>;
  colorClass: string;
}) {
  return (
    <Card className={`border-l-4 ${colorClass}`}>
      <CardHeader className="pb-2 pt-4">
        <CardTitle className="text-[10px] font-bold uppercase text-muted-foreground flex items-center justify-between gap-2">
          {title}
          <Icon className="h-4 w-4 opacity-50" />
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-4">
        <div className="text-xl font-black text-primary">{value}</div>
        <p className="text-[10px] text-muted-foreground mt-1">{sub}</p>
      </CardContent>
    </Card>
  );
}
