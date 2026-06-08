'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, deleteField, doc, getDocs, limit, orderBy, query, updateDoc } from 'firebase/firestore';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { usePermissions } from '@/hooks/use-permissions';
import { PayrollService } from '@/lib/services/payroll-service';
import {
  canAccess,
  canExecuteBankCashbookPayments,
  canGeneratePayslips,
  canView,
  isMatrixControlledRole,
} from '@/lib/permissions';
import {
  canApproveOfficePayrollAsManager,
  canApproveWorkerPayrollBatchAsManager,
  isPayrollOfficer,
  isSystemAdmin,
} from '@/lib/permission-core';
import { isSimpleAdmin } from '@/lib/simple-tier-model';
import { canViewHrApprovalSubsection } from '@/lib/navigation/nav-access';
import type {
  OfficePayrollLine,
  OfficePayrollRun,
  OfficeStaff,
  PayrollBatch,
  PayrollBatchLine,
  PayrollPeriod,
  PayrollRunStatus,
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
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  Search,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { PayslipDialog } from '@/components/payroll/payslip-dialog';
import { buildPayslipFromOfficeLine, buildPayslipFromWorkerLine } from '@/lib/payroll/payslip-model';
import { useCompanyDocumentProfile } from '@/hooks/use-company-document-profile';
import { cn } from '@/lib/utils';
import { formatPayrollYearMonthEnAbbrev } from '@/lib/date-thai';
import { runStatusToD8Lifecycle } from '@/lib/payroll/d8';
import { workerPayrollBatchStatusLabelTh } from '@/lib/payroll/worker-batch-status-display';
import {
  isOfficeRunPendingManagerApproval,
  officePayrollRunStatusLabelTh,
} from '@/lib/payroll/office-payroll-run-status-display';

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
/** งวด office หลังฝ่ายเงินเดือนกดส่งอนุมัติแล้ว (ไม่รวม CALCULATED — ยังไม่ส่ง) */
const OFFICE_MANAGER_QUEUE_STATUSES = new Set<PayrollRunStatus>([
  'HR_REVIEW',
  'HR_APPROVED',
  'FINANCE_APPROVED',
  'PAID',
  'LOCKED',
]);

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
  initialOfficeRunId,
}: {
  currentUser: User;
  /** จาก /hr/payroll-approval?batch= ให้โฟกัส batch นั้น (เช่น ลิงก์จาก dashboard) */
  initialWorkerBatchId?: string;
  /** จาก /hr/payroll-approval?run= ให้โฟกัสงวด office นั้น */
  initialOfficeRunId?: string;
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
  const canOpenAccountingPayoutDetail = canExecuteBankCashbookPayments(currentUser);

  /** อนุมัติ batch ลูกจ้างหลัง HR_REVIEWED — เฉพาะผู้จัดการ (ไม่ใช่ payroll_officer) */
  const canManagerApproveWorkerBatch = canApproveWorkerPayrollBatchAsManager(currentUser);
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
    let list = (allBatches || []).filter((b) => WORKER_D6_STATUSES.has(b.status));
    const officerOnly =
      isPayrollOfficer(currentUser) && !isSystemAdmin(currentUser) && !isSimpleAdmin(currentUser);
    if (officerOnly) {
      list = list.filter((b) => b.status !== 'HR_REVIEWED');
    }
    const rank = (s: string) => (s === 'HR_REVIEWED' ? 0 : s === 'GENERATED' ? 1 : 2);
    list.sort((a, b) => {
      const d = rank(a.status) - rank(b.status);
      if (d !== 0) return d;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    return list.slice(0, 60);
  }, [allBatches, currentUser]);

  const officeRuns = useMemo(() => {
    const list = (allRuns || []).filter((r) => OFFICE_MANAGER_QUEUE_STATUSES.has(r.status));
    const rank = (s: PayrollRunStatus) => (s === 'HR_REVIEW' ? 0 : 1);
    list.sort((a, b) => {
      const d = rank(a.status) - rank(b.status);
      if (d !== 0) return d;
      return (b.payrollMonth || '').localeCompare(a.payrollMonth || '') || (b.payrollRunNo || '').localeCompare(a.payrollRunNo || '');
    });
    return list;
  }, [allRuns]);

  const officePendingRuns = useMemo(
    () => officeRuns.filter((r) => isOfficeRunPendingManagerApproval(r.status)),
    [officeRuns]
  );

  const officeMonthOptions = useMemo(() => {
    const s = new Set(officeRuns.map((r) => r.payrollMonth).filter(Boolean));
    return [...s].sort().reverse();
  }, [officeRuns]);

  const [officeSearch, setOfficeSearch] = useState('');
  const [officeMonthFilter, setOfficeMonthFilter] = useState<string>('all');

  const officeRunsFiltered = useMemo(() => {
    let list = officeRuns;
    if (officeMonthFilter && officeMonthFilter !== 'all') {
      list = list.filter((r) => r.payrollMonth === officeMonthFilter);
    }
    const q = officeSearch.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          (r.payrollRunNo || '').toLowerCase().includes(q) ||
          (r.payrollMonth || '').toLowerCase().includes(q) ||
          formatPayrollYearMonthEnAbbrev(r.payrollMonth, '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [officeRuns, officeMonthFilter, officeSearch]);

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

  useEffect(() => {
    if (!selectedRunId) return;
    if (!officeRunsFiltered.some((r) => r.id === selectedRunId)) {
      setSelectedRunId(null);
      setOfficeLines(null);
    }
  }, [officeRunsFiltered, selectedRunId]);

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

  useEffect(() => {
    if (!initialOfficeRunId || !officeRuns.length) return;
    if (officeRuns.some((r) => r.id === initialOfficeRunId)) {
      setTab('office');
      setSelectedRunId(initialOfficeRunId);
    }
  }, [initialOfficeRunId, officeRuns]);

  useEffect(() => {
    if (initialWorkerBatchId || initialOfficeRunId) return;
    if (officePendingRuns.length > 0 && tab === 'worker' && !selectedBatchId) {
      setTab('office');
      setSelectedRunId((prev) => prev ?? officePendingRuns[0]?.id ?? null);
    }
  }, [initialWorkerBatchId, initialOfficeRunId, officePendingRuns, tab, selectedBatchId]);

  const workerChecks: ValidationCheck[] = useMemo(() => {
    if (!selectedBatch || !workerLines) return [];
    return validateWorkerPayrollBatch(selectedBatch, workerLines);
  }, [selectedBatch, workerLines]);

  const officeChecks: ValidationCheck[] = useMemo(() => {
    if (!selectedRun || !officeLines) return [];
    return validateOfficePayrollRun(selectedRun, officeLines, staffById);
  }, [selectedRun, officeLines, staffById]);

  /** แสดงในตารางสลิปเท่านั้น — เรียงชื่อ A–Z */
  const workerLinesSortedForSlips = useMemo(() => {
    if (!workerLines?.length) return null;
    return [...workerLines].sort((a, b) =>
      (a.workerNameSnapshot ?? '').localeCompare(b.workerNameSnapshot ?? '', undefined, {
        sensitivity: 'base',
        numeric: true,
      })
    );
  }, [workerLines]);

  const officeLinesSortedForSlips = useMemo(() => {
    if (!officeLines?.length) return null;
    return [...officeLines].sort((a, b) =>
      (a.staffName ?? '').localeCompare(b.staffName ?? '', undefined, {
        sensitivity: 'base',
        numeric: true,
      })
    );
  }, [officeLines]);

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
    if (!firestore || !selectedBatch || workerBlocking || !canManagerApproveWorkerBatch) return;
    setBusy(true);
    try {
      const svc = new PayrollService(firestore);
      await svc.managerApprovePayoutAndNotifyAccounting(selectedBatch.id, currentUser);
      toast({
        title: 'อนุมัติจ่ายเงินแล้ว',
        description: `Batch ${selectedBatch.id} → FINANCE_PREPARED (คิวบัญชีรอจ่าย — ไม่มีขั้นส่งบัญชีแยก)`,
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

  const handleOfficeApprove = async () => {
    if (!firestore || !selectedRun) return;
    if (officeBlocking) return;
    if (!canApproveOfficePayrollAsManager(currentUser) && !canOfficeApprove) return;
    if (selectedRun.status !== 'HR_REVIEW') return;
    setBusy(true);
    try {
      const ref = doc(firestore, 'office_payroll_runs', selectedRun.id);
      const name = currentUser.displayName;
      await updateDoc(ref, {
        status: 'HR_APPROVED',
        d8LifecycleStatus: runStatusToD8Lifecycle('HR_APPROVED'),
        managerApprovedBy: name,
        managerApprovedAt: Date.now(),
        hrApprovedBy: name,
        updatedAt: Date.now(),
      });
      toast({ title: 'อนุมัติงวดออฟฟิศแล้ว', description: `${selectedRun.payrollRunNo} → HR_APPROVED (คิวบัญชีรอจ่าย)` });
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
      if (selectedRun.status === 'HR_REVIEW') {
        await updateDoc(ref, {
          status: 'CALCULATED' as const,
          d8LifecycleStatus: runStatusToD8Lifecycle('CALCULATED'),
          submittedForReviewBy: deleteField(),
          submittedForReviewAt: deleteField(),
          updatedAt: Date.now(),
        });
        toast({ title: 'ส่งกลับ', description: 'สถานะ → CALCULATED (ฝ่ายเงินเดือนแก้/ส่งใหม่)' });
      } else {
        await updateDoc(ref, {
          status: 'DRAFT' as const,
          d8LifecycleStatus: runStatusToD8Lifecycle('DRAFT'),
          updatedAt: Date.now(),
        });
        toast({ title: 'ส่งกลับแก้ไข', description: 'สถานะ → DRAFT (กดคำนวณใหม่ที่หน้างวด)' });
      }
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
          Flow ลูกจ้าง: ฝ่ายเงินเดือนกดส่งขออนุมัติ → สถานะ{' '}
          <strong className="text-foreground">รอผู้จัดการอนุมัติ</strong> (รหัส HR_REVIEWED)
          จากนั้นผู้จัดการอนุมัติ → <span className="font-mono">FINANCE_PREPARED</span> (คิวบัญชีรอจ่าย)
          {' · '}
          Flow ออฟฟิศ: ส่งอนุมัติจากหน้างวด → <span className="font-mono">HR_REVIEW</span> → ผู้จัดการอนุมัติ →{' '}
          <span className="font-mono">HR_APPROVED</span> (คิวบัญชีรอจ่าย)
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'worker' | 'office')} className="w-full">
        <TabsList className="grid h-auto w-full max-w-md grid-cols-2 p-1">
          <TabsTrigger value="worker" className="gap-2 py-2">
            <Coins className="h-4 w-4" /> Worker Payroll
          </TabsTrigger>
          <TabsTrigger value="office" className="gap-2 py-2 relative">
            <Building2 className="h-4 w-4" /> Office Payroll
            {officePendingRuns.length > 0 ? (
              <Badge className="ml-1 h-5 min-w-5 px-1.5 text-[10px] bg-amber-600 hover:bg-amber-600">
                {officePendingRuns.length}
              </Badge>
            ) : null}
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
                      คอลัมน์สถานะแสดงความหมายเป็นภาษาไทย — HR_REVIEWED ={' '}
                      <span className="font-medium text-foreground">รอผู้จัดการอนุมัติ</span>
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
                              <Badge
                                variant="outline"
                                title={b.status}
                                className={
                                  b.status === 'HR_REVIEWED'
                                    ? 'border-amber-500/60 bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100'
                                    : ''
                                }
                              >
                                {workerPayrollBatchStatusLabelTh(b.status)}
                              </Badge>
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
                        <Badge
                          title={selectedBatch.status}
                          variant="outline"
                          className={
                            selectedBatch.status === 'HR_REVIEWED'
                              ? 'border-amber-500/60 bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100'
                              : ''
                          }
                        >
                          {workerPayrollBatchStatusLabelTh(selectedBatch.status)}
                          <span className="ml-1 font-mono text-[10px] opacity-60">({selectedBatch.status})</span>
                        </Badge>
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
                          busy ||
                          !canManagerApproveWorkerBatch ||
                          workerBlocking ||
                          selectedBatch.status !== 'HR_REVIEWED'
                        }
                        onClick={() => void handleManagerApprovePayout()}
                      >
                        อนุมัติจ่ายเงิน
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busy || !canWorkerEditBatch || !['GENERATED', 'HR_REVIEWED'].includes(selectedBatch.status)}
                        onClick={() => void handleWorkerSendBack()}
                      >
                        ส่งกลับแก้ไข
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
                    workerLinesSortedForSlips &&
                    workerLinesSortedForSlips.length > 0 && (
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
                              {workerLinesSortedForSlips.map((line) => {
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
              {officePendingRuns.length > 0 ? (
                <Alert className="border-amber-300 bg-amber-50/80 text-amber-950">
                  <AlertTriangle className="h-4 w-4 text-amber-700" />
                  <AlertTitle className="font-bold">งวดออฟฟิศรอผู้จัดการอนุมัติ ({officePendingRuns.length})</AlertTitle>
                  <AlertDescription className="text-sm">
                    ฝ่ายเงินเดือนส่งอนุมัติแล้ว — เลือกงวดด้านล่างแล้วกด{' '}
                    <strong>อนุมัติ (ผู้จัดการ)</strong> หลังอนุมัติงวดจะไปคิว{' '}
                    <strong>บัญชี · รอจ่าย</strong> (สถานะ HR_APPROVED)
                  </AlertDescription>
                </Alert>
              ) : null}
              <Card>
                <CardHeader className="pb-2 space-y-3">
                  <div>
                    <CardTitle className="text-base">งวดออฟฟิศ — รอ/ผ่านอนุมัติผู้จัดการ</CardTitle>
                    <CardDescription>
                      แสดงเฉพาะงวดที่ <strong>ฝ่ายเงินเดือนกดส่งอนุมัติ</strong> แล้ว — HR_REVIEW = รอผู้จัดการ · HR_APPROVED ขึ้นไป = ส่งต่อฝ่ายบัญชี/รอจ่าย (ส่งอนุมัติจาก
                      /office-payroll)
                    </CardDescription>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="relative w-full sm:max-w-xs">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        className="h-9 pl-9"
                        placeholder="ค้นหาเลขที่งวด (OPR) หรือเดือน..."
                        value={officeSearch}
                        onChange={(e) => setOfficeSearch(e.target.value)}
                      />
                    </div>
                    <Select value={officeMonthFilter} onValueChange={setOfficeMonthFilter}>
                      <SelectTrigger className="h-9 w-full sm:w-[200px]">
                        <SelectValue placeholder="กรองเดือน" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">ทุกเดือน</SelectItem>
                        {officeMonthOptions.map((m) => (
                          <SelectItem key={m} value={m}>
                            {formatPayrollYearMonthEnAbbrev(m)} ({m})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
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
                      {officeRunsFiltered.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                            {officeRuns.length === 0
                              ? 'ยังไม่มีงวดที่ฝ่ายเงินเดือนส่งอนุมัติ — หรือไม่ตรงตัวกรอง/ค้นหา'
                              : 'ไม่ตรงตัวกรองหรือคำค้น — ลองเคลียร์การค้นหา/เดือน'}
                          </TableCell>
                        </TableRow>
                      ) : (
                        officeRunsFiltered.map((r) => (
                          <TableRow
                            key={r.id}
                            className={cn(
                              'cursor-pointer',
                              selectedRunId === r.id && 'bg-muted/50',
                              isOfficeRunPendingManagerApproval(r.status) && 'bg-amber-50/70 hover:bg-amber-50'
                            )}
                            onClick={() => {
                              setSelectedRunId(r.id);
                              setOfficeLines(null);
                            }}
                          >
                            <TableCell className="font-mono text-xs">{r.payrollRunNo}</TableCell>
                            <TableCell>
                              {formatPayrollYearMonthEnAbbrev(r.payrollMonth)} <span className="text-muted-foreground">({r.payrollMonth})</span>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={isOfficeRunPendingManagerApproval(r.status) ? 'default' : 'outline'}
                                className={
                                  isOfficeRunPendingManagerApproval(r.status)
                                    ? 'bg-amber-600 hover:bg-amber-600'
                                    : undefined
                                }
                              >
                                {officePayrollRunStatusLabelTh(r.status)}
                              </Badge>
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
                        <div className="font-medium">
                          {formatPayrollYearMonthEnAbbrev(selectedRun.payrollMonth)}{' '}
                          <span className="text-muted-foreground">({selectedRun.payrollMonth})</span>
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs uppercase">จำนวนคน (งวดนี้)</div>
                        <div className="tabular-nums">{selectedRun.staffCount}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs uppercase">สถานะ</div>
                        <Badge
                          variant={isOfficeRunPendingManagerApproval(selectedRun.status) ? 'default' : 'outline'}
                          className={
                            isOfficeRunPendingManagerApproval(selectedRun.status)
                              ? 'bg-amber-600 hover:bg-amber-600'
                              : undefined
                          }
                        >
                          {officePayrollRunStatusLabelTh(selectedRun.status)}
                        </Badge>
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
                      <CardTitle className="text-base">C. ฝ่ายเงินเดือน &amp; ผู้จัดการ</CardTitle>
                      <CardDescription className="text-xs">
                        ฝ่ายเงินเดือนกด <strong>ส่งอนุมัติ</strong> ที่หน้า{' '}
                        <Link className="underline" href="/office-payroll">รายการงวด</Link> หรือ
                        มุมมองรวมรายเดือน — หน้านี้ใช้สำหรับผู้จัดการอนุมัติ/ส่งกลับเท่านั้น
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      <Button
                        disabled={
                          busy ||
                          (!canApproveOfficePayrollAsManager(currentUser) && !canOfficeApprove) ||
                          officeBlocking ||
                          selectedRun.status !== 'HR_REVIEW'
                        }
                        onClick={() => void handleOfficeApprove()}
                      >
                        อนุมัติ (ผู้จัดการ)
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busy || !canOfficeEdit || !['CALCULATED', 'HR_REVIEW'].includes(selectedRun.status)}
                        onClick={() => void handleOfficeSendBack()}
                      >
                        ส่งกลับแก้ไข
                      </Button>
                      {selectedRun.status === 'HR_APPROVED' && canOpenAccountingPayoutDetail ? (
                        <Button variant="outline" asChild>
                          <Link href={`/accounting/office-payroll/${selectedRun.id}`}>
                            ฝ่ายบัญชี · ทำจ่าย / cashbook
                          </Link>
                        </Button>
                      ) : (
                        <Button variant="outline" disabled>
                          {selectedRun.status === 'HR_APPROVED'
                            ? 'ฝ่ายบัญชี · ทำจ่าย / cashbook (ผู้จัดการบัญชี)'
                            : 'ฝ่ายบัญชี · ทำจ่าย / cashbook'}
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
                    officeLinesSortedForSlips &&
                    officeLinesSortedForSlips.length > 0 && (
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
                              {officeLinesSortedForSlips.map((line) => {
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
