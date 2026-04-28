'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Link from 'next/link';
import { 
  ArrowLeft, 
  Coins, 
  Users, 
  Calendar, 
  Lock, 
  CheckCircle2, 
  History,
  Calculator,
  Loader2,
  ChevronRight,
  Info,
  Building2,
  FileText,
  CreditCard,
  Printer,
  FileSpreadsheet,
} from 'lucide-react';
import { PayslipDialog } from '@/components/payroll/payslip-dialog';
import { buildPayslipFromWorkerLine } from '@/lib/payroll/payslip-model';
import { useCompanyDocumentProfile } from '@/hooks/use-company-document-profile';
import { useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection, getDoc } from 'firebase/firestore';
import { PayrollBatch, PayrollBatchLine, User, PayrollPeriod, Worker } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import { formatDateTimeThaiBE, formatStoredDateRangeThaiBE } from '@/lib/date-thai';
import {
  canAccess,
  canConfirmWorkerPayrollPaid,
  canGeneratePayslips,
  canHandoffWorkerPayrollToAccounting,
  canView,
  isMatrixControlledRole,
} from '@/lib/permissions';
import { isPayrollOfficer, isSystemAdmin } from '@/lib/permission-core';
import { isSimpleAdmin, isSimpleAccounting } from '@/lib/simple-tier-model';
import { canViewHrApprovalSubsection } from '@/lib/navigation/nav-access';
import { useAppUser } from '@/hooks/use-app-user';
import { usePermissions } from '@/hooks/use-permissions';
import { PayrollService } from '@/lib/services/payroll-service';
import { buildWorkerPayrollBankVerificationCsv } from '@/lib/payroll/worker-payroll-bank-csv';
import { useToast } from '@/hooks/use-toast';
import type { PayslipViewModel } from '@/lib/payroll/payslip-model';

function lineDeductionsTotal(line: PayrollBatchLine): number {
  return Object.values(line.deductionsBreakdown || {}).reduce((a, b) => a + (Number(b) || 0), 0);
}

/** กันข้อมูล Firestore ไม่ครบ → .toLocaleString บน undefined ทำให้ React ล่มทั้งหน้า */
function safeNum(n: unknown): number {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

export default function PayrollBatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { payroll: payrollPerm } = usePermissions(currentUser);
  const firestore = useFirestore();
  const useMatrixGuards = isMatrixControlledRole(currentUser);
  const [workersById, setWorkersById] = useState<Map<string, Pick<Worker, 'contactPhone' | 'thaiNationalId'>>>(
    () => new Map()
  );
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [payoutActionBusy, setPayoutActionBusy] = useState(false);
  const canEditBatch = payrollPerm('payroll_worker', 'edit_batch');
  const canApproveWorker = payrollPerm('payroll_worker', 'approve');
  const canOpenPayrollApprovalCenter = canViewHrApprovalSubsection(
    currentUser as User,
    isSystemAdmin(currentUser) || isSimpleAdmin(currentUser)
  );
  const canViewBatch = useMemo(() => {
    if (isSystemAdmin(currentUser) || isSimpleAdmin(currentUser) || isSimpleAccounting(currentUser)) {
      return true;
    }
    if (useMatrixGuards) {
      return (
        canAccess(currentUser, 'worker_payroll', 'view') ||
        canAccess(currentUser, 'payroll_runs', 'view') ||
        canAccess(currentUser, 'payslips', 'view')
      );
    }
    return canView(currentUser, 'worker_payroll');
  }, [currentUser, useMatrixGuards]);

  const batchRef = useMemoFirebase(() => (firestore && canViewBatch ? doc(firestore, 'payroll_batches', id) : null), [firestore, id, canViewBatch]);
  const { data: batch, isLoading: isBatchLoading } = useDoc<PayrollBatch>(batchRef as any);

  const linesQuery = useMemoFirebase(() => (firestore && canViewBatch ? collection(firestore, 'payroll_batches', id, 'lines') : null), [firestore, id, canViewBatch]);
  const { data: lines, isLoading: isLinesLoading } = useCollection<PayrollBatchLine>(linesQuery as any);

  const periodRef = useMemoFirebase(() => (firestore && batch ? doc(firestore, 'payroll_periods', batch.payrollPeriodId) : null), [firestore, batch?.payrollPeriodId]);
  const { data: period } = useDoc<PayrollPeriod>(periodRef as any);
  const { profile: companyProfile } = useCompanyDocumentProfile();

  useEffect(() => {
    if (!firestore || !lines?.length) {
      setWorkersById(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      const ids = [...new Set(lines.map((l) => l.workerId))];
      const m = new Map<string, Pick<Worker, 'contactPhone' | 'thaiNationalId'>>();
      await Promise.all(
        ids.map(async (wid) => {
          try {
            const s = await getDoc(doc(firestore, 'workers', wid));
            if (!s.exists()) return;
            const d = s.data() as Worker;
            m.set(wid, { contactPhone: d.contactPhone, thaiNationalId: d.thaiNationalId });
          } catch {
            /* ignore row */
          }
        })
      );
      if (!cancelled) setWorkersById(m);
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, lines]);

  const handleDownloadBankCsv = useCallback(() => {
    if (!batch || !lines?.length) return;
    const csv = buildWorkerPayrollBankVerificationCsv(batch, lines, workersById);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll-bank-check_${batch.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'ดาวน์โหลด CSV', description: 'ไฟล์ตรวจโอน (ชื่อ เบอร์ ปชช. เลขบัญชี ยอด)' });
  }, [batch, lines, workersById, toast]);

  const handleOfficerSubmitForPayout = useCallback(async () => {
    if (!firestore || !batch || !currentUser) return;
    setPayoutActionBusy(true);
    try {
      const svc = new PayrollService(firestore);
      await svc.submitOfficerBatchForPayoutApproval(batch.id, currentUser as User);
      toast({
        title: 'ส่งขออนุมัติทำจ่ายแล้ว',
        description: 'Batch will be queued for manager approval (HR_REVIEWED) in the Payroll approval center',
      });
    } catch (e) {
      toast({ variant: 'destructive', title: 'ส่งคำขอไม่สำเร็จ', description: e instanceof Error ? e.message : String(e) });
    } finally {
      setPayoutActionBusy(false);
    }
  }, [firestore, batch, currentUser, toast]);

  const handleManagerApprovePayout = useCallback(async () => {
    if (!firestore || !batch || !currentUser) return;
    setPayoutActionBusy(true);
    try {
      const svc = new PayrollService(firestore);
      const willHandoff = canHandoffWorkerPayrollToAccounting(currentUser);
      await svc.managerApprovePayoutAndNotifyAccounting(batch.id, currentUser as User);
      toast({
        title: willHandoff ? 'อนุมัติและส่งบัญชีแล้ว' : 'อนุมัติแล้ว',
        description: willHandoff
          ? 'สถานะ → FINANCE_PREPARED (ฝ่ายบัญชีทำจ่ายต่อไป)'
          : 'สถานะ → HR_APPROVED ให้คนที่มีสิทธิ์ส่งต่อบัญชี',
      });
    } catch (e) {
      toast({ variant: 'destructive', title: 'อนุมัติไม่สำเร็จ', description: e instanceof Error ? e.message : String(e) });
    } finally {
      setPayoutActionBusy(false);
    }
  }, [firestore, batch, currentUser, toast]);

  const handleConfirmPaid = useCallback(async () => {
    if (!firestore || !batch || !currentUser) return;
    setConfirmBusy(true);
    try {
      const svc = new PayrollService(firestore);
      await svc.financeConfirmWorkerBatchPaid(batch.id, currentUser as User);
      toast({ title: 'ยืนยันจ่ายแล้ว', description: 'บันทึกสถานะ PAID และรายการ cashbook แล้ว' });
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'ยืนยันไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setConfirmBusy(false);
    }
  }, [firestore, batch, currentUser, toast]);

  if (userLoading || isBatchLoading || !currentUser) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-12 w-12 text-primary animate-spin" /></div>;
  }
  if (!canViewBatch) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-5xl mx-auto py-10 text-center text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงเมนูนี้</div>
      </AppShell>
    );
  }
  if (!batch) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-5xl mx-auto py-10 text-center text-muted-foreground">ไม่พบข้อมูลงวดจ่าย</div>
      </AppShell>
    );
  }

  const isLocked = batch.status === 'LOCKED' || batch.status === 'PAID';
  const canGenerateWorkerPayslips = canGeneratePayslips(currentUser, batch.status);
  const canBankCheckCsv = ['FINANCE_PREPARED', 'PAYMENT_EXPORTED', 'PAID', 'LOCKED'].includes(batch.status);
  const showAccountingConfirm =
    canConfirmWorkerPayrollPaid(currentUser) &&
    (batch.status === 'FINANCE_PREPARED' || batch.status === 'PAYMENT_EXPORTED');

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-[1600px] mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.push('/payroll/batches')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="space-y-2">
              <PayrollScopeTag scope="worker" showHint={false} />
              <h1 className="text-2xl font-bold tracking-tight">รายละเอียดงวดจ่ายลูกจ้าง (Batch)</h1>
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <span className="font-mono font-bold text-primary">{batch.id}</span>
                <Separator orientation="vertical" className="h-3" />
                <span>Period: {period?.label || '...'}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild className="gap-1">
              <Link href={`/payroll/batches/${id}/print`}>
                <Printer className="h-4 w-4" />
                สลิปทั้ง batch
              </Link>
            </Button>
            <Badge variant={isLocked ? 'default' : 'outline'} className={isLocked ? 'bg-primary py-1.5 px-4' : 'py-1.5 px-4'}>
              {isLocked && <Lock className="h-3 w-3 mr-2" />}
              STATUS: {batch.status}
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="border-l-8 border-l-blue-600 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-[10px] font-black uppercase text-muted-foreground">Total Workers</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-primary">{safeNum(batch.totalWorkers)} Persons</div>
            </CardContent>
          </Card>
          <Card className="border-l-8 border-l-amber-500 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-[10px] font-black uppercase text-muted-foreground">Gross Amount</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-primary">฿{safeNum(batch.grossAmount).toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card className="border-l-8 border-l-red-500 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-[10px] font-black uppercase text-muted-foreground">Total Deductions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-primary">฿{safeNum(batch.totalDeductions).toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card className="border-l-8 border-l-green-600 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-[10px] font-black uppercase text-muted-foreground">Net Payable</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-primary">฿{safeNum(batch.netAmount).toLocaleString()}</div>
            </CardContent>
          </Card>
        </div>

        {batch.status === 'GENERATED' && canEditBatch && (isSystemAdmin(currentUser) || isPayrollOfficer(currentUser)) && (
          <Card className="border-l-4 border-l-amber-500/80">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">ฝ่ายเงินเดือน</CardTitle>
              <CardDescription>
                ตรวจรายละเอียด/correction ครบแล้ว ให้กดส่งงวดนี้เข้าคิวอนุมัติ — งวดจะไปแสดงที่ศูนย์อนุมัติ (D6) รอ
                ผู้จัดการปฏิบัติการ/HR (ฝ่ายเงินเดือนไม่ต้องเข้าศูนย์อนุมัติ)
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                className="gap-2"
                disabled={payoutActionBusy}
                onClick={() => void handleOfficerSubmitForPayout()}
              >
                {payoutActionBusy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : null}
                ส่งขออนุมัติทำจ่าย
              </Button>
              {canOpenPayrollApprovalCenter && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/hr/payroll-approval?batch=${id}`}>ไปศูนย์อนุมัติ (D6)</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {batch.status === 'HR_REVIEWED' && canApproveWorker && (
          <Card className="border-l-4 border-l-emerald-600/80">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">ผู้จัดการ/ศูนย์อนุมัติ</CardTitle>
              <CardDescription>
                งวด: {period?.label || batch.payrollPeriodId} — ตรวจยอดรวมแล้ว อนุมัติเพื่อแจ้งฝ่ายบัญชีจัดเตรียมจ่าย
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                className="gap-2"
                disabled={payoutActionBusy}
                onClick={() => void handleManagerApprovePayout()}
              >
                {payoutActionBusy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : null}
                อนุมัติยอดเงิน
                {canHandoffWorkerPayrollToAccounting(currentUser) ? ' (ส่งบัญชีทำจ่าย)' : ''}
              </Button>
              {canOpenPayrollApprovalCenter && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/hr/payroll-approval?batch=${id}`}>รายละเอียด/แผง D6</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {(canBankCheckCsv || showAccountingConfirm || batch.financeCashbookEntryId) && (
          <Card className="border-l-4 border-l-primary/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">บัญชี · ตรวจโอน payroll</CardTitle>
              <CardDescription>
                หลังส่งต่อบัญชี (FINANCE_PREPARED) ดาวน์โหลด CSV รายชุดเพื่อตรวจกับธนาคาร — เมื่อโอนจริงแล้วให้บัญชีกดยืนยันจ่ายเพื่อบันทึก cashbook
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2">
              {canBankCheckCsv && lines && lines.length > 0 && (
                <Button type="button" variant="outline" size="sm" className="gap-2" onClick={handleDownloadBankCsv}>
                  <FileSpreadsheet className="h-4 w-4" />
                  ดาวน์โหลด CSV ตรวจโอน (ชื่อ เบอร์ ปชช. เลขบัญชี ยอด)
                </Button>
              )}
              {showAccountingConfirm && (
                <Button type="button" size="sm" disabled={confirmBusy} onClick={() => void handleConfirmPaid()}>
                  {confirmBusy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" /> กำลังบันทึก…
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      บัญชียืนยันจ่ายแล้ว (PAID + cashbook)
                    </>
                  )}
                </Button>
              )}
              {batch.financeCashbookEntryId ? (
                <span className="text-xs text-muted-foreground font-mono">
                  Cashbook ref: {batch.financeCashbookEntryId}
                </span>
              ) : null}
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="lines" className="w-full">
          <TabsList className="grid grid-cols-3 w-full md:w-fit h-auto p-1 bg-muted/50">
            <TabsTrigger value="lines" className="gap-2 py-2 px-8">Settlement Lines</TabsTrigger>
            <TabsTrigger value="info" className="gap-2 py-2 px-8">Batch Metadata</TabsTrigger>
            <TabsTrigger value="history" className="gap-2 py-2 px-8">Audit Trail</TabsTrigger>
          </TabsList>

          <TabsContent value="lines" className="mt-6">
            <Card className="shadow-lg border-none overflow-hidden">
              <CardContent className="p-0 overflow-x-auto">
                <Table className="table-fixed min-w-[860px] w-full">
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead className="pl-6 py-3 w-[26%] min-w-[160px] max-w-[300px] align-middle">
                        Worker (Snapshot)
                      </TableHead>
                      <TableHead className="w-[118px] whitespace-nowrap align-middle">Payment Method</TableHead>
                      <TableHead className="w-[96px] align-middle">Status</TableHead>
                      <TableHead className="w-[92px] text-right tabular-nums align-middle">Gross</TableHead>
                      <TableHead className="w-[96px] text-right tabular-nums align-middle">Deductions</TableHead>
                      <TableHead className="w-[100px] text-right font-bold tabular-nums align-middle">Net Amount</TableHead>
                      <TableHead className="w-[76px] text-right align-middle pr-2">สลิป</TableHead>
                      <TableHead className="w-11 pr-5 text-right align-middle">
                        <span className="sr-only">รายละเอียด</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines?.map((line) => {
                      const periodLabel = period?.label || batch.payrollPeriodId;
                      let slipModel: PayslipViewModel | null = null;
                      try {
                        slipModel = buildPayslipFromWorkerLine(
                          line,
                          batch,
                          periodLabel,
                          companyProfile ?? undefined,
                        );
                      } catch {
                        slipModel = null;
                      }
                      return (
                      <TableRow key={line.id} className="hover:bg-muted/10">
                        <TableCell className="pl-6 align-top py-3 min-w-0 max-w-[300px]">
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <span className="font-bold text-sm text-primary leading-snug break-words">
                              {line.workerNameSnapshot}
                            </span>
                            <span className="text-[10px] text-muted-foreground uppercase truncate font-mono">
                              {line.workerId}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="align-middle py-3 whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5 text-xs">
                            <CreditCard className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span>{line.workerPaymentProfileSnapshot?.paymentMethod || 'CASH'}</span>
                          </div>
                        </TableCell>
                        <TableCell className="align-middle py-3">
                          <Badge variant="outline" className="text-[9px] uppercase font-bold whitespace-nowrap">
                            {line.exportStatus}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-xs font-medium tabular-nums align-middle py-3">
                          ฿{safeNum(line.grossAmount).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right text-xs text-red-600 tabular-nums align-middle py-3">
                          ฿{lineDeductionsTotal(line).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-black text-primary tabular-nums align-middle py-3 text-sm">
                          ฿{safeNum(line.netAmount).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right align-middle py-3 pr-2">
                          {canGenerateWorkerPayslips && slipModel ? (
                            <PayslipDialog model={slipModel} />
                          ) : canGenerateWorkerPayslips && !slipModel ? (
                            <Badge variant="destructive" className="text-[9px] whitespace-nowrap" title="สร้างสลิปไม่สำเร็จ">
                              สลิป error
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[9px] whitespace-nowrap">
                              รอเตรียม/อนุมัติ
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right align-middle py-3 pr-3">
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" asChild title="รายละเอียดรายคน · รายวัน · ปรับยอด">
                            <Link href={`/payroll/batches/${id}/workers/${line.workerId}`}>
                              <ChevronRight className="h-5 w-5" />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );})}
                    {(!lines || lines.length === 0) && !isLinesLoading && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-20 text-muted-foreground italic">No settlement lines found in this batch.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="info" className="mt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader><CardTitle>Source Context</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between text-sm border-b pb-2">
                    <span className="text-muted-foreground">Payroll Period:</span>
                    <span className="font-bold">{period?.label}</span>
                  </div>
                  <div className="flex justify-between text-sm border-b pb-2">
                    <span className="text-muted-foreground">Date Range:</span>
                    <span className="font-bold">
                      {formatStoredDateRangeThaiBE(period?.startDate, period?.endDate)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm border-b pb-2">
                    <span className="text-muted-foreground">Work Mode Scope:</span>
                    <span className="font-bold uppercase">{batch.workModeScope}</span>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Attribution</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between text-sm border-b pb-2">
                    <span className="text-muted-foreground">Generated By:</span>
                    <span className="font-bold">{batch.createdBy}</span>
                  </div>
                  <div className="flex justify-between text-sm border-b pb-2">
                    <span className="text-muted-foreground">Generated At:</span>
                    <span className="font-bold">{formatDateTimeThaiBE(batch.createdAt)}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="history" className="mt-6">
            <Card>
              <CardContent className="py-20 text-center text-muted-foreground italic">
                Detailed settlement logs will appear here upon next approval stage.
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
