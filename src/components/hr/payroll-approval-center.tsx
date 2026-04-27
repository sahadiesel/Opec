'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, doc, getDocs, limit, orderBy, query, updateDoc } from 'firebase/firestore';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { usePermissions } from '@/hooks/use-permissions';
import { PayrollService } from '@/lib/services/payroll-service';
import {
  canAccess,
  canApprovePayroll,
  canGeneratePayslips,
  canHandoffWorkerPayrollToAccounting,
  canView,
  isMatrixControlledRole,
} from '@/lib/permissions';
import { isPayrollOfficer, isSystemAdmin } from '@/lib/permission-core';
import { isSimpleAdmin } from '@/lib/simple-tier-model';
import { canViewHrApprovalSubsection } from '@/lib/navigation/nav-access';
import type {
  OfficePayrollLine,
  OfficePayrollRun,
  OfficeStaff,
  PayrollBatch,
  PayrollBatchLine,
  PayrollPeriod,
  User,
} from '@/lib/types';
import {
  PAYROLL_POLICY_VERSION_LABEL,
  WORKER_FREEZE_BULLETS,
  OFFICE_FREEZE_BULLETS,
  countAnomalies,
  hasBlockingRed,
  validateOfficePayrollRun,
  validateWorkerPayrollBatch,
  type ValidationCheck,
} from '@/lib/hr/payroll-approval-d6';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Coins,
  Loader2,
  Printer,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { PayslipDialog } from '@/components/payroll/payslip-dialog';
import { buildPayslipFromOfficeLine, buildPayslipFromWorkerLine } from '@/lib/payroll/payslip-model';
import { useCompanyDocumentProfile } from '@/hooks/use-company-document-profile';
import { cn } from '@/lib/utils';

/** รายการใน D6 รวมงวดย้อนหลังเพื่อเปิดสลิป */
const WORKER_D6_STATUSES = new Set([
  'GENERATED',
  'HR_REVIEWED',
  'HR_APPROVED',
  'FINANCE_PREPARED',
  'PAYMENT_EXPORTED',
  'PAID',
  'LOCKED',
]);
const OFFICE_D6_STATUSES = new Set(['CALCULATED', 'HR_APPROVED', 'FINANCE_APPROVED', 'PAID', 'LOCKED']);

const WORKER_PAYSLIP_VISIBLE_STATUSES = new Set([
  'GENERATED',
  'HR_REVIEWED',
  'HR_APPROVED',
  'FINANCE_PREPARED',
  'PAYMENT_EXPORTED',
  'PAID',
  'LOCKED',
]);
const OFFICE_PAYSLIP_AFTER_APPROVAL = new Set(['HR_APPROVED', 'FINANCE_APPROVED', 'PAID', 'LOCKED']);

function moneyTH(n: number) {
  return `฿${Number(n || 0).toLocaleString('th-TH')}`;
}

function CheckRow({ c }: { c: ValidationCheck }) {
  const Icon = c.severity === 'red' ? XCircle : c.severity === 'yellow' ? AlertTriangle : CheckCircle2;
  const color =
    c.severity === 'red'
      ? 'text-destructive'
      : c.severity === 'yellow'
        ? 'text-amber-600'
        : 'text-emerald-600';
  return (
    <div className="flex gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-sm">
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', color)} />
      <div className="min-w-0 space-y-0.5">
        <div className="font-medium leading-tight">{c.label}</div>
        {c.detail ? <p className="text-muted-foreground text-xs leading-snug">{c.detail}</p> : null}
      </div>
    </div>
  );
}

export function PayrollApprovalCenterD6({
  currentUser,
  initialWorkerBatchId,
}: {
  currentUser: User;
  /** จาก /hr/payroll-approval?batch= ให้โฟกัส batch นั้น (เช่น ลิงก์จาก dashboard) */
  initialWorkerBatchId?: string;
}) {
  const firestore = useFirestore();
  const { profile: companyProfile } = useCompanyDocumentProfile();
  const { toast } = useToast();
  const { payroll } = usePermissions(currentUser);
  const useMatrixGuards = isMatrixControlledRole(currentUser);

  const canWorker = useMatrixGuards
    ? canAccess(currentUser, 'worker_payroll', 'view') || canAccess(currentUser, 'payroll_runs', 'view')
    : canView(currentUser, 'worker_payroll');
  const canOffice = canView(currentUser, 'office_payroll');

  const canWorkerApprove = payroll('payroll_worker', 'approve');
  const canApproveWorkerFlow = useMatrixGuards
    ? canApprovePayroll(currentUser)
    : canApprovePayroll(currentUser) && canWorkerApprove;
  const canWorkerEditBatch = payroll('payroll_worker', 'edit_batch');
  const canOfficeApprove = payroll('payroll_office', 'approve');
  const canOfficeEdit = payroll('payroll_office', 'edit') || payroll('payroll_office', 'submit');

  const batchesQuery = useMemoFirebase(() => {
    if (!firestore || !canWorker) return null;
    return query(collection(firestore, 'payroll_batches'), orderBy('createdAt', 'desc'), limit(120));
  }, [firestore, canWorker]);
  const { data: allBatches, isLoading: loadingBatches } = useCollection<PayrollBatch>(batchesQuery as any);

  const periodsQuery = useMemoFirebase(() => {
    if (!firestore || !canWorker) return null;
    return collection(firestore, 'payroll_periods');
  }, [firestore, canWorker]);
  const { data: periods } = useCollection<PayrollPeriod>(periodsQuery as any);

  const runsQuery = useMemoFirebase(() => {
    if (!firestore || !canOffice) return null;
    return query(collection(firestore, 'office_payroll_runs'), orderBy('payrollMonth', 'desc'), limit(80));
  }, [firestore, canOffice]);
  const { data: allRuns, isLoading: loadingRuns } = useCollection<OfficePayrollRun>(runsQuery as any);

  const staffQuery = useMemoFirebase(() => {
    if (!firestore || !canOffice) return null;
    return collection(firestore, 'office_staff');
  }, [firestore, canOffice]);
  const { data: officeStaff } = useCollection<OfficeStaff>(staffQuery as any);

  const periodById = useMemo(() => {
    const m = new Map<string, PayrollPeriod>();
    (periods || []).forEach((p) => m.set(p.id, p));
    return m;
  }, [periods]);

  const staffById = useMemo(() => {
    const m = new Map<string, OfficeStaff>();
    (officeStaff || []).forEach((s) => m.set(s.id, s));
    return m;
  }, [officeStaff]);

  const workerBatches = useMemo(() => {
    const list = (allBatches || []).filter((b) => WORKER_D6_STATUSES.has(b.status));
    const rank = (s: string) => (s === 'HR_REVIEWED' ? 0 : s === 'GENERATED' ? 1 : 2);
    list.sort((a, b) => {
      const d = rank(a.status) - rank(b.status);
      if (d !== 0) return d;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    return list.slice(0, 60);
  }, [allBatches]);

  const officeRuns = useMemo(() => {
    const list = (allRuns || []).filter((r) => OFFICE_D6_STATUSES.has(r.status));
    list.sort((a, b) => (b.payrollMonth || '').localeCompare(a.payrollMonth || ''));
    return list.slice(0, 40);
  }, [allRuns]);

  const [tab, setTab] = useState<'worker' | 'office'>('worker');
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [workerLines, setWorkerLines] = useState<PayrollBatchLine[] | null>(null);
  const [officeLines, setOfficeLines] = useState<OfficePayrollLine[] | null>(null);
  const [linesLoading, setLinesLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const selectedBatch = useMemo(
    () => workerBatches.find((b) => b.id === selectedBatchId) || null,
    [workerBatches, selectedBatchId]
  );
  const selectedRun = useMemo(
    () => officeRuns.find((r) => r.id === selectedRunId) || null,
    [officeRuns, selectedRunId]
  );

  const loadWorkerLines = useCallback(
    async (batchId: string) => {
      if (!firestore) return;
      setLinesLoading(true);
      try {
        const snap = await getDocs(collection(firestore, 'payroll_batches', batchId, 'lines'));
        const lines = snap.docs.map((d) => ({ ...d.data(), id: d.id } as PayrollBatchLine));
        setWorkerLines(lines);
      } catch (e) {
        console.error(e);
        toast({ variant: 'destructive', title: 'โหลดบรรทัด batch ไม่สำเร็จ', description: String(e) });
        setWorkerLines([]);
      } finally {
        setLinesLoading(false);
      }
    },
    [firestore, toast]
  );

  const loadOfficeLines = useCallback(
    async (runId: string) => {
      if (!firestore) return;
      setLinesLoading(true);
      try {
        const snap = await getDocs(collection(firestore, 'office_payroll_runs', runId, 'lines'));
        const lines = snap.docs.map((d) => ({ ...d.data(), id: d.id } as OfficePayrollLine));
        setOfficeLines(lines);
      } catch (e) {
        console.error(e);
        toast({ variant: 'destructive', title: 'โหลดบรรทัด office ไม่สำเร็จ', description: String(e) });
        setOfficeLines([]);
      } finally {
        setLinesLoading(false);
      }
    },
    [firestore, toast]
  );

  useEffect(() => {
    if (tab === 'worker' && selectedBatchId) void loadWorkerLines(selectedBatchId);
    else if (tab === 'office' && selectedRunId) void loadOfficeLines(selectedRunId);
  }, [tab, selectedBatchId, selectedRunId, loadWorkerLines, loadOfficeLines]);

  useEffect(() => {
    if (!initialWorkerBatchId || !workerBatches.length) return;
    if (workerBatches.some((b) => b.id === initialWorkerBatchId)) {
      setTab('worker');
      setSelectedBatchId(initialWorkerBatchId);
    }
  }, [initialWorkerBatchId, workerBatches]);

  const workerChecks: ValidationCheck[] = useMemo(() => {
    if (!selectedBatch || !workerLines) return [];
    return validateWorkerPayrollBatch(selectedBatch, workerLines);
  }, [selectedBatch, workerLines]);

  const officeChecks: ValidationCheck[] = useMemo(() => {
    if (!selectedRun || !officeLines) return [];
    return validateOfficePayrollRun(selectedRun, officeLines, staffById);
  }, [selectedRun, officeLines, staffById]);

  const workerBlocking = hasBlockingRed(workerChecks);
  const officeBlocking = hasBlockingRed(officeChecks);

  const handleOfficerSubmitForPayout = async () => {
    if (!firestore || !selectedBatch || !canWorkerEditBatch) return;
    if (!isSystemAdmin(currentUser) && !isPayrollOfficer(currentUser)) return;
    setBusy(true);
    try {
      const svc = new PayrollService(firestore);
      await svc.submitOfficerBatchForPayoutApproval(selectedBatch.id, currentUser);
      toast({
        title: 'ส่งขออนุมัติทำจ่ายแล้ว',
        description: 'งวดรอการอนุมัติที่คิวของผู้จัดการ/ศูนย์อนุมัติ (HR_REVIEWED)',
      });
      setWorkerLines(null);
      await loadWorkerLines(selectedBatch.id);
    } catch (e) {
      toast({ variant: 'destructive', title: 'ส่งคำขอไม่สำเร็จ', description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const handleManagerApprovePayout = async () => {
    if (!firestore || !selectedBatch || workerBlocking || !canApproveWorkerFlow) return;
    setBusy(true);
    try {
      const svc = new PayrollService(firestore);
      const beforeHandoff = canHandoffWorkerPayrollToAccounting(currentUser);
      await svc.managerApprovePayoutAndNotifyAccounting(selectedBatch.id, currentUser);
      toast({
        title: beforeHandoff ? 'อนุมัติและส่งบัญชีแล้ว' : 'อนุมัติแล้ว (รอส่งบัญชี)',
        description: beforeHandoff
          ? `Batch ${selectedBatch.id} → FINANCE_PREPARED (ฝ่ายบัญชีทำจ่ายต่อไป)`
          : `Batch ${selectedBatch.id} → HR_APPROVED ให้ฝ่ายที่มีสิทธิ์กด "ส่งต่อบัญชี"`,
      });
      setWorkerLines(null);
      await loadWorkerLines(selectedBatch.id);
    } catch (e) {
      toast({ variant: 'destructive', title: 'อนุมัติไม่สำเร็จ', description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const handleWorkerSendBack = async () => {
    if (!firestore || !selectedBatch || !canWorkerEditBatch) return;
    setBusy(true);
    try {
      const svc = new PayrollService(firestore);
      await svc.sendBackBatch(selectedBatch.id, currentUser);
      toast({ title: 'ส่งกลับแก้ไข', description: 'สถานะคืนเป็น GENERATED' });
      setWorkerLines(null);
      await loadWorkerLines(selectedBatch.id);
    } catch (e) {
      toast({ variant: 'destructive', title: 'ส่งกลับไม่สำเร็จ', description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const handleWorkerHandoff = async () => {
    if (!firestore || !selectedBatch || !canHandoffWorkerPayrollToAccounting(currentUser)) return;
    setBusy(true);
    try {
      const svc = new PayrollService(firestore);
      await svc.financePrepareBatch(selectedBatch.id, currentUser);
      toast({ title: 'ส่งต่อบัญชี', description: 'สถานะ → FINANCE_PREPARED' });
      setWorkerLines(null);
      await loadWorkerLines(selectedBatch.id);
    } catch (e) {
      toast({ variant: 'destructive', title: 'ส่งต่อไม่สำเร็จ', description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const handleOfficeApprove = async () => {
    if (!firestore || !selectedRun || officeBlocking) return;
    if (!canOfficeApprove) return;
    setBusy(true);
    try {
      const ref = doc(firestore, 'office_payroll_runs', selectedRun.id);
      await updateDoc(ref, {
        status: 'HR_APPROVED',
        hrApprovedBy: currentUser.displayName,
        updatedAt: Date.now(),
      });
      toast({ title: 'อนุมัติงวดออฟฟิศแล้ว', description: `${selectedRun.payrollRunNo} → HR_APPROVED` });
      setOfficeLines(null);
      await loadOfficeLines(selectedRun.id);
    } catch (e) {
      toast({ variant: 'destructive', title: 'อนุมัติไม่สำเร็จ', description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const handleOfficeSendBack = async () => {
    if (!firestore || !selectedRun || !canOfficeEdit) return;
    setBusy(true);
    try {
      const ref = doc(firestore, 'office_payroll_runs', selectedRun.id);
      await updateDoc(ref, {
        status: 'DRAFT',
        updatedAt: Date.now(),
      });
      toast({ title: 'ส่งกลับแก้ไข', description: 'สถานะ → DRAFT (กดคำนวณใหม่ที่หน้างวด)' });
      setOfficeLines(null);
      await loadOfficeLines(selectedRun.id);
    } catch (e) {
      toast({ variant: 'destructive', title: 'ส่งกลับไม่สำเร็จ', description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const canOpenCenter = canViewHrApprovalSubsection(
    currentUser,
    isSystemAdmin(currentUser) || isSimpleAdmin(currentUser)
  );
  if (!canOpenCenter) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center text-muted-foreground">ไม่มีสิทธิ์เข้าหน้านี้</div>
    );
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <ShieldCheck className="h-9 w-9 text-primary" />
          <h1 className="text-3xl font-bold tracking-tight text-primary">ศูนย์อนุมัติ Payroll (D6)</h1>
        </div>
        <p className="text-muted-foreground text-lg">
          Flow ลูกจ้าง: ฝ่ายเงินเดือนกดส่งขออนุมัติ (GENERATED → รอ) จากนั้นผู้จัดการ/HR
          อนุมัติยอดและส่งบัญชีทำจ่าย (HR_REVIEWED → FINANCE_PREPARED) — งวดที่อนุมัติแล้วแก้ตรงไม่ได้ ต้องใช้ขั้นตอน
          correction
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'worker' | 'office')} className="w-full">
        <TabsList className="grid h-auto w-full max-w-md grid-cols-2 p-1">
          <TabsTrigger value="worker" className="gap-2 py-2">
            <Coins className="h-4 w-4" /> Worker Payroll
          </TabsTrigger>
          <TabsTrigger value="office" className="gap-2 py-2">
            <Building2 className="h-4 w-4" /> Office Payroll
          </TabsTrigger>
        </TabsList>

        <TabsContent value="worker" className="mt-4 space-y-4">
          {!canWorker ? (
            <Alert>
              <AlertTitle>ไม่มีสิทธิ์ดู worker payroll</AlertTitle>
              <AlertDescription>ขอให้ admin เปิดโมดูล worker_payroll</AlertDescription>
            </Alert>
          ) : loadingBatches ? (
            <div className="flex justify-center py-12 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <>
              <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">งวดลูกจ้างที่เกี่ยวข้อง</CardTitle>
                    <CardDescription>
                      งวดเดือน/รอบแสดงในคอลัมน์ &quot;งวด&quot; — HR_REVIEWED = รอคิวผู้จัดการ/ศูนย์อนุมัติ
                    </CardDescription>
                  </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Batch</TableHead>
                        <TableHead>งวด (period)</TableHead>
                        <TableHead>สถานะ</TableHead>
                        <TableHead className="text-right">คน</TableHead>
                        <TableHead className="text-right">สุทธิ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {workerBatches.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                            ไม่มีงวดในรายการ D6 (รวมงวดย้อนหลังสำหรับสลิป)
                          </TableCell>
                        </TableRow>
                      ) : (
                        workerBatches.map((b) => (
                          <TableRow
                            key={b.id}
                            className={cn('cursor-pointer', selectedBatchId === b.id && 'bg-muted/50')}
                            onClick={() => {
                              setSelectedBatchId(b.id);
                              setWorkerLines(null);
                            }}
                          >
                            <TableCell className="font-mono text-xs">{b.id}</TableCell>
                            <TableCell className="max-w-[200px] truncate text-sm font-medium">
                              {periodById.get(b.payrollPeriodId)?.label || b.payrollPeriodId}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{b.status}</Badge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{b.totalWorkers}</TableCell>
                            <TableCell className="text-right tabular-nums">{moneyTH(b.netAmount)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {selectedBatch && (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/payroll/batches/${selectedBatch.id}`}>
                        เปิดรายละเอียด batch <ArrowRight className="ml-1 h-3 w-3" />
                      </Link>
                    </Button>
                  </div>

                  {/* A. Summary */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">A. Summary</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
                      <div>
                        <div className="text-muted-foreground text-xs uppercase">งวด (period)</div>
                        <div className="font-medium">
                          {periodById.get(selectedBatch.payrollPeriodId)?.label || selectedBatch.payrollPeriodId}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs uppercase">จำนวนคน</div>
                        <div className="font-medium tabular-nums">{selectedBatch.totalWorkers}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs uppercase">สถานะ batch</div>
                        <Badge>{selectedBatch.status}</Badge>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs uppercase">Gross</div>
                        <div className="font-medium tabular-nums">{moneyTH(selectedBatch.grossAmount)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs uppercase">Deduction</div>
                        <div className="font-medium tabular-nums">{moneyTH(selectedBatch.totalDeductions)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs uppercase">Net</div>
                        <div className="font-medium tabular-nums">{moneyTH(selectedBatch.netAmount)}</div>
                      </div>
                      <div className="sm:col-span-2 lg:col-span-3">
                        <div className="text-muted-foreground text-xs uppercase">จำนวนรายการผิดปกติ (จากแผงตรวจ)</div>
                        <div className="font-medium tabular-nums">
                          {workerLines ? countAnomalies(workerChecks) : linesLoading ? '…' : '—'}
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* B. Validation */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">B. Validation (ก่อนอนุมัติ)</CardTitle>
                      <CardDescription>ข้อแดง = บล็อกการอนุมัติ</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {linesLoading && (
                        <div className="flex items-center gap-2 text-muted-foreground text-sm">
                          <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดบรรทัด…
                        </div>
                      )}
                      {!linesLoading && workerLines && workerChecks.map((c) => <CheckRow key={c.id} c={c} />)}
                      {workerBlocking && (
                        <Alert variant="destructive" className="mt-2">
                          <AlertTitle>อนุมัติไม่ได้</AlertTitle>
                          <AlertDescription>มีข้อผิดพลาดระดับแดง — แก้ที่ต้นทางหรือใช้ correction request ก่อน</AlertDescription>
                        </Alert>
                      )}
                    </CardContent>
                  </Card>

                  {/* C. Actions */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">C. การกระทำของผู้จัดการ</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      {(isSystemAdmin(currentUser) || isPayrollOfficer(currentUser)) && canWorkerEditBatch && (
                        <Button
                          variant="default"
                          disabled={busy || selectedBatch.status !== 'GENERATED' || workerBlocking}
                          onClick={() => void handleOfficerSubmitForPayout()}
                        >
                          ส่งขออนุมัติทำจ่าย (ฝ่ายเงินเดือน)
                        </Button>
                      )}
                      <Button
                        disabled={
                          busy || !canApproveWorkerFlow || workerBlocking || selectedBatch.status !== 'HR_REVIEWED'
                        }
                        onClick={() => void handleManagerApprovePayout()}
                      >
                        อนุมัติยอดเงิน{canHandoffWorkerPayrollToAccounting(currentUser) ? ' (ส่งบัญชีทำจ่าย)' : ''}
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busy || !canWorkerEditBatch || !['GENERATED', 'HR_REVIEWED'].includes(selectedBatch.status)}
                        onClick={() => void handleWorkerSendBack()}
                      >
                        ส่งกลับแก้ไข
                      </Button>
                      <Button
                        variant="outline"
                        disabled={
                          busy ||
                          !canHandoffWorkerPayrollToAccounting(currentUser) ||
                          selectedBatch.status !== 'HR_APPROVED'
                        }
                        onClick={() => void handleWorkerHandoff()}
                      >
                        ส่งต่อบัญชี (กรณีอนุมัติแยก — FINANCE_PREPARED)
                      </Button>
                    </CardContent>
                  </Card>

                  {/* D. Audit / freeze */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">D. Audit / Freeze preview</CardTitle>
                      <CardDescription>ก่อนกดอนุมัติ — สิ่งที่ระบบจะยึดตามนโยบายปัจจุบัน</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div>
                        <div className="text-muted-foreground text-xs uppercase mb-1">Policy version</div>
                        <p className="leading-snug">{PAYROLL_POLICY_VERSION_LABEL}</p>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs uppercase mb-1">ข้อมูลที่จะถือเป็น snapshot หลังอนุมัติ</div>
                        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                          {WORKER_FREEZE_BULLETS.map((t) => (
                            <li key={t}>{t}</li>
                          ))}
                        </ul>
                      </div>
                      <Separator />
                      <div>
                        <div className="text-muted-foreground text-xs uppercase mb-1">ผู้อนุมัติ (เมื่อกดอนุมัติ)</div>
                        <p className="font-medium">{currentUser.displayName}</p>
                      </div>
                    </CardContent>
                  </Card>

                  {WORKER_PAYSLIP_VISIBLE_STATUSES.has(selectedBatch.status) &&
                    canGeneratePayslips(currentUser, selectedBatch.status) &&
                    workerLines &&
                    workerLines.length > 0 && (
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base">สลิปเงินเดือน (จาก Payroll Line)</CardTitle>
                          <CardDescription>
                            หลัง HR อนุมัติ — ดู/พิมพ์รายคน หรือ export PDF ทั้ง batch
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <Button variant="outline" size="sm" asChild className="gap-2">
                            <Link href={`/payroll/batches/${selectedBatch.id}/print`}>
                              <Printer className="h-4 w-4" />
                              พิมพ์ / PDF ทั้ง batch
                            </Link>
                          </Button>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>ลูกจ้าง</TableHead>
                                <TableHead className="text-right">สุทธิ</TableHead>
                                <TableHead className="text-right w-[120px]">สลิป</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {workerLines.map((line) => {
                                const pl =
                                  periodById.get(selectedBatch.payrollPeriodId)?.label ||
                                  selectedBatch.payrollPeriodId;
                                const model = buildPayslipFromWorkerLine(line, selectedBatch, pl, companyProfile ?? undefined);
                                return (
                                  <TableRow key={line.id}>
                                    <TableCell className="font-medium">{line.workerNameSnapshot}</TableCell>
                                    <TableCell className="text-right tabular-nums">
                                      {moneyTH(line.netAmount)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <PayslipDialog model={model} />
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </CardContent>
                      </Card>
                    )}
                </div>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="office" className="mt-4 space-y-4">
          {!canOffice ? (
            <Alert>
              <AlertTitle>ไม่มีสิทธิ์ดู office payroll</AlertTitle>
              <AlertDescription>ขอให้ admin เปิดโมดูล office_payroll</AlertDescription>
            </Alert>
          ) : loadingRuns ? (
            <div className="flex justify-center py-12 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">งวดออฟฟิศที่เกี่ยวข้อง</CardTitle>
                  <CardDescription>CALCULATED = รออนุมัติ HR · HR_APPROVED = ส่งต่อการเงิน</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>เลขที่</TableHead>
                        <TableHead>เดือน</TableHead>
                        <TableHead>สถานะ</TableHead>
                        <TableHead className="text-right">คน</TableHead>
                        <TableHead className="text-right">สุทธิ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {officeRuns.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                            ไม่มีงวด CALCULATED / HR_APPROVED
                          </TableCell>
                        </TableRow>
                      ) : (
                        officeRuns.map((r) => (
                          <TableRow
                            key={r.id}
                            className={cn('cursor-pointer', selectedRunId === r.id && 'bg-muted/50')}
                            onClick={() => {
                              setSelectedRunId(r.id);
                              setOfficeLines(null);
                            }}
                          >
                            <TableCell className="font-mono text-xs">{r.payrollRunNo}</TableCell>
                            <TableCell>{r.payrollMonth}</TableCell>
                            <TableCell>
                              <Badge variant="outline">{r.status}</Badge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{r.staffCount}</TableCell>
                            <TableCell className="text-right tabular-nums">{moneyTH(r.netAmount)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {selectedRun && (
                <div className="space-y-4">
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/office-payroll/${selectedRun.id}`}>
                      เปิดหน้างวดเต็ม <ArrowRight className="ml-1 h-3 w-3" />
                    </Link>
                  </Button>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">A. Summary</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
                      <div>
                        <div className="text-muted-foreground text-xs uppercase">งวด</div>
                        <div className="font-medium">{selectedRun.payrollMonth}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs uppercase">จำนวนคน</div>
                        <div className="tabular-nums">{selectedRun.staffCount}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs uppercase">สถานะ</div>
                        <Badge>{selectedRun.status}</Badge>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs uppercase">Gross</div>
                        <div className="tabular-nums">{moneyTH(selectedRun.grossAmount)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs uppercase">Deduction</div>
                        <div className="tabular-nums">{moneyTH(selectedRun.totalDeductions)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs uppercase">Net</div>
                        <div className="tabular-nums">{moneyTH(selectedRun.netAmount)}</div>
                      </div>
                      <div className="sm:col-span-2">
                        <div className="text-muted-foreground text-xs uppercase">จำนวนรายการผิดปกติ</div>
                        <div className="tabular-nums">
                          {officeLines ? countAnomalies(officeChecks) : linesLoading ? '…' : '—'}
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">B. Validation</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {linesLoading && (
                        <div className="flex items-center gap-2 text-muted-foreground text-sm">
                          <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดบรรทัด…
                        </div>
                      )}
                      {!linesLoading && officeLines && officeChecks.map((c) => <CheckRow key={c.id} c={c} />)}
                      {officeBlocking && (
                        <Alert variant="destructive" className="mt-2">
                          <AlertTitle>อนุมัติไม่ได้</AlertTitle>
                          <AlertDescription>มีข้อแดงจากทะเบียนพนักงาน / บรรทัดงวด</AlertDescription>
                        </Alert>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">C. การกระทำของผู้จัดการ</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      <Button
                        disabled={busy || !canOfficeApprove || officeBlocking || selectedRun.status !== 'CALCULATED'}
                        onClick={() => void handleOfficeApprove()}
                      >
                        อนุมัติ (HR)
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busy || !canOfficeEdit || selectedRun.status !== 'CALCULATED'}
                        onClick={() => void handleOfficeSendBack()}
                      >
                        ส่งกลับแก้ไข
                      </Button>
                      {selectedRun.status === 'HR_APPROVED' ? (
                        <Button variant="outline" asChild>
                          <Link href={`/office-payroll/${selectedRun.id}#approvals`}>
                            ล็อก / ส่งต่อบัญชี (เปิดขั้นตอนการเงิน)
                          </Link>
                        </Button>
                      ) : (
                        <Button variant="outline" disabled>
                          ล็อก / ส่งต่อบัญชี (เปิดขั้นตอนการเงิน)
                        </Button>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">D. Audit / Freeze preview</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div>
                        <div className="text-muted-foreground text-xs uppercase mb-1">Policy version</div>
                        <p className="leading-snug">{PAYROLL_POLICY_VERSION_LABEL}</p>
                      </div>
                      <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                        {OFFICE_FREEZE_BULLETS.map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                      </ul>
                      <Separator />
                      <div>
                        <div className="text-muted-foreground text-xs uppercase mb-1">ผู้อนุมัติ (เมื่อกดอนุมัติ)</div>
                        <p className="font-medium">{currentUser.displayName}</p>
                      </div>
                    </CardContent>
                  </Card>

                  {OFFICE_PAYSLIP_AFTER_APPROVAL.has(selectedRun.status) &&
                    officeLines &&
                    officeLines.length > 0 && (
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base">สลิปเงินเดือน (จาก Payroll Line)</CardTitle>
                          <CardDescription>
                            หลัง HR อนุมัติ — ดู/พิมพ์รายคน หรือ PDF ทั้งงวด
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <Button variant="outline" size="sm" asChild className="gap-2">
                            <Link href={`/office-payroll/${selectedRun.id}/print`}>
                              <Printer className="h-4 w-4" />
                              พิมพ์ / PDF ทั้งงวด
                            </Link>
                          </Button>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>พนักงาน</TableHead>
                                <TableHead className="text-right">สุทธิ</TableHead>
                                <TableHead className="text-right w-[120px]">สลิป</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {officeLines.map((line) => {
                                const model = buildPayslipFromOfficeLine(line, selectedRun, companyProfile ?? undefined);
                                return (
                                  <TableRow key={line.id}>
                                    <TableCell className="font-medium">{line.staffName}</TableCell>
                                    <TableCell className="text-right tabular-nums">
                                      {moneyTH(line.netPay)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <PayslipDialog model={model} />
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </CardContent>
                      </Card>
                    )}
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-sm">คิว correction / exceptions</CardTitle>
          <CardDescription>Timesheet correction และงาน HR อื่น</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" asChild>
            <Link href="/hr/dashboard#hr-action-queue">ไปคิวงาน HR</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
