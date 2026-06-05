'use client';

import { useState, useMemo, useCallback, useEffect, Suspense } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Coins, 
  Plus, 
  Search, 
  Filter, 
  CheckCircle2, 
  ShieldCheck, 
  FileText, 
  Info,
  ChevronRight,
  TrendingUp,
  Clock,
  ArrowRight,
  Calculator,
  Loader2,
  AlertTriangle,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { formatStoredDateRangeThaiBE } from '@/lib/date-thai';
import { PayrollBatch, PayrollPeriod, PayrollPeriodStatus, PoMonthTimesheetReview, User } from '@/lib/types';
import { isSystemAdmin } from '@/lib/permission-core';
import { workerPayrollBatchStatusLabelTh } from '@/lib/payroll/worker-batch-status-display';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, orderBy, limit } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
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
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PayrollService, type PayrollPreflightResult } from '@/lib/services/payroll-service';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
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
import { PageGuidance } from '@/components/layout/page-guidance';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import { formatDateThaiBE } from '@/lib/date-thai';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccess, canCreate, canPreparePayroll, canView, isMatrixControlledRole } from '@/lib/permissions';
import { isSimpleAccounting } from '@/lib/simple-tier-model';
import {
  shouldFilterToAccountingPayoutQueue,
  WORKER_BATCH_STATUSES_FOR_ACCOUNTING_PAYOUT,
} from '@/lib/payroll/accounting-payout-queue';
import {
  ensureWorkerMonthlyPayrollPeriodForYearMonth,
  parseYearMonthFromWorkerPayrollPeriodId,
  workerPayrollPeriodIdForYearMonth,
} from '@/lib/timesheet/po-month-timesheet-bridge';
import { lastDayOfCalendarMonth } from '@/lib/timesheet/wave-month-utils';

const PO_MONTH_GATE_STATUSES = new Set<PoMonthTimesheetReview['status']>([
  'approved',
  'entry_locked',
  'pending_manager_review',
]);

const PO_MONTH_REVIEWS_LIMIT = 120;

function PayrollBatchesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const useMatrixGuards = isMatrixControlledRole(currentUser);
  const canViewWorkerPayroll = useMemo(() => {
    if (useMatrixGuards) {
      return (
        canAccess(currentUser, 'worker_payroll', 'view') ||
        canAccess(currentUser, 'payroll_runs', 'view') ||
        canAccess(currentUser, 'payslips', 'view')
      );
    }
    return canView(currentUser, 'worker_payroll');
  }, [currentUser, useMatrixGuards]);
  const canCreateWorkerPayroll = useMemo(() => canCreate(currentUser, 'worker_payroll'), [currentUser]);
  const canCreateOfficePayroll = useMemo(() => canCreate(currentUser, 'office_payroll'), [currentUser]);
  const canPrepareWorkerPayroll = useMemo(() => canPreparePayroll(currentUser), [currentUser]);
  const isAdmin = useMemo(() => isSystemAdmin(currentUser), [currentUser]);
  const isSimpleAcc = useMemo(() => isSimpleAccounting(currentUser), [currentUser]);
  const canAccessBatchesPage = useMemo(
    () => isAdmin || canViewWorkerPayroll || isSimpleAcc,
    [isAdmin, canViewWorkerPayroll, isSimpleAcc],
  );
  const accountingPayoutQueueOnly = useMemo(() => {
    const payoutQ = searchParams.get('payout') === '1';
    return (
      shouldFilterToAccountingPayoutQueue(currentUser, {
        canCreateOfficePayroll,
        canCreateWorkerPayroll,
        canPrepareWorkerPayroll,
      }) || (payoutQ && isSimpleAcc)
    );
  }, [
    currentUser,
    canCreateOfficePayroll,
    canCreateWorkerPayroll,
    canPrepareWorkerPayroll,
    searchParams,
    isSimpleAcc,
  ]);

  /** ลิงก์เดิมจากเมนูบัญชี (?payout=1) → หน้าคิวทำจ่ายใต้ /accounting */
  useEffect(() => {
    if (searchParams.get('payout') === '1') {
      router.replace('/accounting/worker-payroll');
    }
  }, [searchParams, router]);
  const showGenerateBatch = canCreateWorkerPayroll && canPrepareWorkerPayroll;

  const batchQuery = useMemoFirebase(() => {
    if (!firestore || !canAccessBatchesPage) return null;
    return query(collection(firestore, 'payroll_batches'), orderBy('createdAt', 'desc'), limit(50));
  }, [firestore, canAccessBatchesPage]);
  const { data: batches, isLoading: isBatchesLoading } = useCollection<PayrollBatch>(batchQuery as any);
  const visibleBatches = useMemo(() => {
    const list = batches ?? [];
    if (!accountingPayoutQueueOnly) return list;
    const allow = new Set<PayrollBatch['status']>(WORKER_BATCH_STATUSES_FOR_ACCOUNTING_PAYOUT);
    return list.filter((b) => allow.has(b.status));
  }, [batches, accountingPayoutQueueOnly]);

  const periodsQuery = useMemoFirebase(() => {
    if (!firestore || !canAccessBatchesPage) return null;
    return query(collection(firestore, 'payroll_periods'), orderBy('startDate', 'desc'));
  }, [firestore, canAccessBatchesPage]);
  const { data: periods } = useCollection<PayrollPeriod>(periodsQuery as any);

  const poMonthReviewsQuery = useMemoFirebase(() => {
    if (!firestore || !canAccessBatchesPage) return null;
    return query(
      collection(firestore, 'po_month_timesheet_reviews'),
      orderBy('yearMonth', 'desc'),
      limit(PO_MONTH_REVIEWS_LIMIT),
    );
  }, [firestore, canAccessBatchesPage]);
  const { data: poMonthReviews } = useCollection<PoMonthTimesheetReview>(poMonthReviewsQuery as any);

  const selectablePeriods = useMemo(() => {
    const allowed: PayrollPeriodStatus[] = ['OPEN', 'PROCESSING', 'DRAFT'];
    const allById = new Map<string, PayrollPeriod>();
    for (const p of periods ?? []) {
      allById.set(p.id, p);
    }
    const fromDb = (periods ?? []).filter((p) => allowed.includes(p.status));
    const byId = new Map<string, PayrollPeriod>();
    for (const p of fromDb) {
      byId.set(p.id, p);
    }
    for (const r of poMonthReviews ?? []) {
      if (!PO_MONTH_GATE_STATUSES.has(r.status)) continue;
      const ym = (r.yearMonth || '').trim();
      if (!/^\d{4}-\d{2}$/.test(ym)) continue;
      const periodId = workerPayrollPeriodIdForYearMonth(ym);
      if (allById.has(periodId)) continue;
      if (byId.has(periodId)) continue;
      const now = Date.now();
      byId.set(periodId, {
        id: periodId,
        label: `${ym} · งวดลูกจ้าง (จาก PO+เดือนที่ปิดงวดแล้ว)`,
        startDate: `${ym}-01`,
        endDate: lastDayOfCalendarMonth(ym),
        cycleType: 'MONTHLY',
        status: 'PROCESSING',
        generatedAt: now,
        generatedBy: 'po_month_timesheet_reviews',
      });
    }
    return [...byId.values()].sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  }, [periods, poMonthReviews]);

  const [isGenerateOpen, setIsGenerateOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [targetPeriodId, setTargetPeriodId] = useState('');
  const [workModeFilter, setWorkModeScope] = useState<'onshore' | 'offshore' | 'mixed'>('mixed');
  const [preflight, setPreflight] = useState<PayrollPreflightResult | null>(null);
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<Set<string>>(() => new Set());
  const [deleteTarget, setDeleteTarget] = useState<PayrollBatch | null>(null);
  const [regenTarget, setRegenTarget] = useState<PayrollBatch | null>(null);
  const [adminBusy, setAdminBusy] = useState(false);

  /** สร้างเอกสาร payroll_periods ถ้ายังไม่มี — ใช้กับรอบ worker_ym_* หลังเลือกจาก dropdown ที่ดึงจาก PO+เดือนที่ล็อกแล้ว */
  const ensureWorkerPeriodDocument = useCallback(async () => {
    if (!firestore || !currentUser || !targetPeriodId) return;
    const ym = parseYearMonthFromWorkerPayrollPeriodId(targetPeriodId);
    if (!ym) return;
    const actor = currentUser.displayName || currentUser.email || currentUser.id;
    await ensureWorkerMonthlyPayrollPeriodForYearMonth(firestore, ym, actor);
  }, [firestore, currentUser, targetPeriodId]);

  const adminBatchActionsBlocked = (status: string) =>
    ['FINANCE_PREPARED', 'PAYMENT_EXPORTED', 'PAID', 'LOCKED'].includes(status);

  const handlePreflight = async () => {
    if (!firestore || !targetPeriodId) return;
    setIsChecking(true);
    setPreflight(null);
    setSelectedWorkerIds(new Set());
    try {
      await ensureWorkerPeriodDocument();
      const service = new PayrollService(firestore);
      const result = await service.preflightPayrollCheck(targetPeriodId, { workModeScope: workModeFilter });
      setPreflight(result);
      setSelectedWorkerIds(new Set(result.eligibleWorkers.map((w) => w.workerId)));
      setIsGenerateOpen(true);
      if (result.missingApprovedMonthlyTimesheet) {
        toast({
          variant: 'destructive',
          title: 'ยังไม่พร้อมสร้าง Batch',
          description: result.payrollYearMonth
            ? `ยังไม่มีสรุปลงเวลารายเดือน (${result.payrollYearMonth}) ที่ปิดงวดแล้ว — ล็อกงวดที่ PO+เดือนก่อน`
            : 'ตรวจสอบวันที่เริ่มรอบบัญชี',
        });
      } else if (!result.hasWarnings) {
        toast({ title: 'ตรวจสอบผ่าน', description: `พร้อมประมวลผล ${result.totalWorkers} คน / ${result.totalTimesheets} ใบงาน` });
      } else {
        toast({
          title: 'พบข้อควรระวัง',
          description: `มีคนงานที่อาจได้ค่าจ้าง 0 บาท ${result.zeroGrossWorkers.length} คน — ตรวจทะเบียนตำแหน่ง/ลูกจ้างหรือยืนยันสร้างต่อ`,
        });
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'ตรวจสอบล้มเหลว', description: e.message });
    } finally {
      setIsChecking(false);
    }
  };

  const handleGenerate = async () => {
    if (!canCreateWorkerPayroll) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์สร้าง payroll batch' });
      return;
    }
    if (!canPrepareWorkerPayroll) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์เตรียมงวดจ่ายเงินเดือน' });
      return;
    }
    if (!firestore || !currentUser || !targetPeriodId) return;
    if (selectedWorkerIds.size === 0) {
      toast({
        variant: 'destructive',
        title: 'ยังไม่ได้เลือกรายชื่อ',
        description: 'เลือกอย่างน้อย 1 คนงานที่ต้องจ่ายในรอบนี้',
      });
      return;
    }
    
    setIsGenerating(true);
    try {
      await ensureWorkerPeriodDocument();
      const service = new PayrollService(firestore);
      const batchId = await service.generatePayrollBatch(targetPeriodId, currentUser, {
        workModeScope: workModeFilter,
        workerIds: [...selectedWorkerIds],
      });
      
      setIsGenerateOpen(false);
      setPreflight(null);
      setSelectedWorkerIds(new Set());
      toast({ title: "สร้าง Payroll Batch สำเร็จ", description: "ข้อมูลกำลังถูกประมวลผล" });
      router.push(`/payroll/batches/${batchId}`);
    } catch (e: any) {
      let desc = e?.message ?? String(e);
      if (/resource-exhausted|maximum bandwidth for writes/i.test(String(desc))) {
        desc =
          'Firestore เขียนข้อมูลเกินโควต้าช่วงสั้น — รอ 1–2 นาทีแล้วลองใหม่ หรือตรวจแผน Firebase';
      }
      toast({ variant: 'destructive', title: 'สร้าง Batch ไม่สำเร็จ', description: desc });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAdminDelete = async () => {
    if (!deleteTarget || !firestore || !currentUser) return;
    setAdminBusy(true);
    try {
      const service = new PayrollService(firestore);
      await service.adminDeletePayrollBatch(deleteTarget.id, currentUser);
      toast({ title: 'ลบชุดจ่ายแล้ว', description: deleteTarget.id });
      setDeleteTarget(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: 'destructive', title: 'ลบไม่สำเร็จ', description: msg });
    } finally {
      setAdminBusy(false);
    }
  };

  const handleAdminRegenerate = async () => {
    if (!regenTarget || !firestore || !currentUser) return;
    setAdminBusy(true);
    try {
      const service = new PayrollService(firestore);
      const newBatchId = await service.adminRegeneratePayrollBatch(regenTarget.id, currentUser);
      toast({ title: 'สร้างชุดจ่ายใหม่แล้ว', description: newBatchId });
      setRegenTarget(null);
      router.push(`/payroll/batches/${newBatchId}`);
    } catch (e: unknown) {
      let msg = e instanceof Error ? e.message : String(e);
      if (/resource-exhausted|maximum bandwidth for writes/i.test(msg)) {
        msg =
          'Firestore เขียนข้อมูลเกินโควต้าช่วงสั้น — รอ 1–2 นาทีแล้วกดสร้างใหม่อีกครั้ง (หรือตรวจแผน Firebase). ถ้ายังไม่ได้ให้ลดจำนวนใบงานต่อรอบหรืออัปเกรดโปรเจ็กต์.';
      }
      toast({ variant: 'destructive', title: 'สร้างใหม่ไม่สำเร็จ', description: msg });
    } finally {
      setAdminBusy(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const label = workerPayrollBatchStatusLabelTh(status);
    switch (status) {
      case 'GENERATED':
        return (
          <Badge variant="outline" className="bg-blue-50 text-blue-700" title={status}>
            {label}
          </Badge>
        );
      case 'HR_REVIEWED':
        return (
          <Badge variant="outline" className="border-amber-500/60 bg-amber-50 text-amber-950" title={status}>
            {label}
          </Badge>
        );
      case 'HR_APPROVED':
        return (
          <Badge variant="outline" className="bg-green-50 text-green-700" title={status}>
            {label}
          </Badge>
        );
      case 'FINANCE_PREPARED':
        return (
          <Badge className="bg-amber-500" title={status}>
            {label}
          </Badge>
        );
      case 'PAID':
        return (
          <Badge className="bg-green-600" title={status}>
            {label}
          </Badge>
        );
      case 'LOCKED':
        return (
          <Badge variant="secondary" title={status}>
            {label}
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" title={status}>
            {label}
          </Badge>
        );
    }
  };

  if (userLoading || !currentUser) return null;
  if (!canAccessBatchesPage) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-5xl mx-auto py-10 text-center text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงเมนูนี้</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div className="flex flex-col gap-2 min-w-0">
            <PayrollScopeTag scope="worker" showHint={false} />
            <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
              <Coins className="h-8 w-8 shrink-0" /> งวดจ่ายลูกจ้าง (Payroll Batches)
            </h1>
            <p className="text-muted-foreground text-lg italic">
              <strong>Worker Payroll</strong> — ดึงจากใบงานรายวันที่ระบบตั้ง <strong>readyForPayroll</strong> แล้ว ภายในรอบที่เลือก โดยปกติเกิดหลัง{' '}
              <strong>ล็อกงวดหรือปิดงวดที่เอกสารสรุปลงเวลารายเดือน (PO + เดือน)</strong> — ไม่ต้องรอผู้จัดการอนุมัติ timesheet รอบจ่ายรายเดือนจะเปิดเมื่อมีงวดสรุปที่ปิดแล้วอย่างน้อยหนึ่งฉบับในเดือนนั้น
            </p>
            {accountingPayoutQueueOnly && (
              <p className="text-sm text-blue-800 bg-blue-50/80 border border-blue-200 rounded-md px-3 py-2 max-w-3xl">
                <strong>มุมมองบัญชี (เฉพาะทำจ่าย):</strong> แสดงเฉพาะงวดที่ <strong>ส่งถึงฝ่ายบัญชีแล้ว (FINANCE_PREPARED ขึ้นไป)</strong> —
                หลังผู้จัดการ HR / ผู้จัดการปฏิบัติการกดอนุมัติจ่ายเงินที่ศูนย์อนุมัติ (หรือหน้ารายละเอียด batch) ระบบจะตั้งสถานะเป็น FINANCE_PREPARED โดยตรง — ไม่มีขั้นส่งบัญชีแยก
              </p>
            )}
          </div>
          
          {showGenerateBatch && (
          <Dialog open={isGenerateOpen} onOpenChange={setIsGenerateOpen}>
            <DialogTrigger asChild>
              <Button
                className="gap-2 h-11 px-6 bg-primary shadow-md font-bold"
                disabled={!canCreateWorkerPayroll || !canPrepareWorkerPayroll}
              >
                <Calculator className="h-5 w-5" /> สร้างรายการจ่ายใหม่ (Generate Batch)
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
              <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-6 pb-4">
              <DialogHeader>
                <DialogTitle>ประมวลผล Payroll Batch ใหม่</DialogTitle>
                <DialogDescription>
                  เลือกรอบบัญชีที่ตรงกับเดือนที่ต้องการจ่าย ระบบจะรวบรวมเฉพาะใบงานรายวันที่ตั้ง <strong>readyForPayroll</strong> แล้ว และใช้ชื่อคนงาน / เวลาทำงาน / ราคาตามสัญญาและตำแหน่งจากข้อมูลในใบงานชุดนั้นประมวลผลเป็นชุดจ่าย
                  {' '}
                  สำหรับรอบแบบรายเดือน ต้องมีอย่างน้อยหนึ่งเอกสาร <strong>สรุปลงเวลารายเดือน (PO + เดือน)</strong> ที่ <strong>ล็อกงวดหรือส่งตรวจแล้ว</strong> ในเดือนนั้น — รายการรอบในเมนูดึงจากเดือนที่ปิดงวดแล้วด้วย (ไม่ต้องรออนุมัติผู้จัดการ)
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label className="font-bold">เลือกรอบบัญชี (Select Period)</Label>
                  <Select
                    onValueChange={(v) => {
                      setTargetPeriodId(v);
                      setPreflight(null);
                      setSelectedWorkerIds(new Set());
                    }}
                    value={targetPeriodId}
                  >
                    <SelectTrigger className="h-11"><SelectValue placeholder="เลือกรอบเดือนที่ต้องการจ่าย..." /></SelectTrigger>
                    <SelectContent>
                      {selectablePeriods.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label} ({formatStoredDateRangeThaiBE(p.startDate, p.endDate)})
                          {p.status === 'DRAFT' ? ' · DRAFT' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectablePeriods.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      ยังไม่มีรอบที่เลือกได้ — ให้ล็อกงวดที่เมนูเอกสาร PO+เดือนก่อน ระบบจะแสดงเดือนที่ปิดงวดแล้วที่นี่ และสร้างเอกสารรอบบัญชีอัตโนมัติเมื่อกดตรวจสอบ/สร้าง Batch
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label className="font-bold">ขอบเขตงาน (Scope)</Label>
                  <Select
                    onValueChange={(v: 'onshore' | 'offshore' | 'mixed') => {
                      setWorkModeScope(v);
                      setPreflight(null);
                      setSelectedWorkerIds(new Set());
                    }}
                    value={workModeFilter}
                  >
                    <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mixed">ทั้งหมด (All modes)</SelectItem>
                      <SelectItem value="offshore">Offshore เท่านั้น</SelectItem>
                      <SelectItem value="onshore">Onshore เท่านั้น</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {preflight && !preflight.missingApprovedMonthlyTimesheet && preflight.eligibleWorkers.length > 0 && (
                <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label className="font-bold mb-0">
                      เลือกคนงานที่จ่ายในรอบนี้ ({selectedWorkerIds.size}/{preflight.eligibleWorkers.length} คน)
                    </Label>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() =>
                          setSelectedWorkerIds(new Set(preflight.eligibleWorkers.map((w) => w.workerId)))
                        }
                      >
                        เลือกทั้งหมด
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => setSelectedWorkerIds(new Set())}
                      >
                        ไม่เลือก
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    คนที่ไม่เลือกยังจ่ายได้ในรอบถัดไป (ใบงานยังไม่ถูกล็อก) — เหมือนงวดออฟฟิศที่แบ่งจ่ายหลายครั้งในเดือนเดียว
                  </p>
                  <ScrollArea className="h-[180px] rounded-md border bg-background p-2">
                    <div className="space-y-2 pr-2">
                      {preflight.eligibleWorkers.map((w) => (
                        <label
                          key={w.workerId}
                          className={`flex items-start gap-3 rounded-md border px-2 py-1.5 cursor-pointer hover:bg-muted/50 ${
                            w.hasZeroGross ? 'border-amber-300 bg-amber-50/40' : 'border-transparent'
                          }`}
                        >
                          <Checkbox
                            checked={selectedWorkerIds.has(w.workerId)}
                            onCheckedChange={(checked) => {
                              setSelectedWorkerIds((prev) => {
                                const next = new Set(prev);
                                if (checked === true) next.add(w.workerId);
                                else next.delete(w.workerId);
                                return next;
                              });
                            }}
                            className="mt-0.5"
                          />
                          <span className="text-sm leading-tight min-w-0 flex-1">
                            <span className="font-semibold">{w.workerName}</span>
                            <span className="text-muted-foreground text-xs block">
                              {w.timesheetCount} ใบงาน
                              {w.hasZeroGross ? ' · ⚠ อาจได้ค่าจ้าง 0' : ''}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}

              {preflight && !preflight.missingApprovedMonthlyTimesheet && preflight.eligibleWorkers.length === 0 && (
                <Alert className="bg-muted/50 border-muted-foreground/20">
                  <Info className="h-5 w-5" />
                  <AlertTitle className="font-bold">ไม่มีคนงานพร้อมจ่ายในรอบนี้</AlertTitle>
                  <AlertDescription className="text-xs">
                    ใบงานอาจถูกล็อกจาก batch ก่อนหน้าแล้ว — ลองเลือกเดือนอื่นหรือตรวจว่ายังมี daily ที่ readyForPayroll และ status ไม่ใช่ LOCKED
                  </AlertDescription>
                </Alert>
              )}

              {preflight?.missingApprovedMonthlyTimesheet && (
                <Alert variant="destructive" className="border-red-300 bg-red-50 text-red-950">
                  <AlertTriangle className="h-5 w-5" />
                  <AlertTitle className="font-bold">ยังไม่มีสรุปลงเวลารายเดือนที่ปิดงวดแล้ว</AlertTitle>
                  <AlertDescription className="text-xs mt-1 space-y-2">
                    <p>
                      {preflight.payrollYearMonth
                        ? `เดือน ${preflight.payrollYearMonth}: ให้ล็อกงวดหรือส่งตรวจที่เอกสาร PO+เดือนก่อน — จากนั้นระบบจึงจะให้สร้าง Payroll Batch ในรอบรายเดือนนี้ (ไม่ต้องรอผู้จัดการอนุมัติ timesheet)`
                        : 'วันที่เริ่มรอบบัญชีไม่ตรงรูปแบบ — ตรวจสอบรอบในระบบ'}
                    </p>
                    <p className="flex flex-wrap gap-x-3 gap-y-1">
                      <Link href="/timesheets" className="font-semibold underline">
                        ศูนย์ Timesheet
                      </Link>
                      <Link href="/hr/timesheet-month-approval" className="font-semibold underline">
                        คิวอนุมัติสรุปรายเดือน
                      </Link>
                    </p>
                  </AlertDescription>
                </Alert>
              )}

              {preflight && preflight.hasWarnings && (
                <Alert className="bg-amber-50 border-amber-300 text-amber-900">
                  <AlertTriangle className="h-5 w-5 text-amber-600" />
                  <AlertTitle className="font-bold">พบคนงาน {preflight.zeroGrossWorkers.length} คนที่จะได้ค่าจ้าง 0 บาท</AlertTitle>
                  <AlertDescription className="text-xs space-y-1 mt-1">
                    {preflight.zeroGrossWorkers.slice(0, 5).map((w) => (
                      <div key={w.workerId} className="flex flex-col">
                        <span className="font-bold">{w.workerName} ({w.timesheetCount} ใบงาน)</span>
                        <span className="text-amber-700">{w.reasons.join(', ')}</span>
                      </div>
                    ))}
                    {preflight.zeroGrossWorkers.length > 5 && (
                      <p className="italic">...และอีก {preflight.zeroGrossWorkers.length - 5} คน</p>
                    )}
                    <p className="font-bold mt-2">
                      ตรวจทะเบียน: ฐานค่าแรงจากตำแหน่ง + กำหนดรายคนลูกจ้างที่ /positions และ /workers หรือกดยืนยันสร้าง Batch
                      (คนที่ฐานยังเป็น 0 จะได้ค่าจ้าง 0) — ไม่อ้าง Labor Cost Term
                    </p>
                  </AlertDescription>
                </Alert>
              )}

              {preflight && !preflight.missingApprovedMonthlyTimesheet && !preflight.hasWarnings && (
                <Alert className="bg-green-50 border-green-300 text-green-900">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  <AlertTitle className="font-bold">ตรวจสอบผ่าน</AlertTitle>
                  <AlertDescription className="text-xs space-y-2">
                    <p>
                      พร้อมประมวลผล {preflight.totalWorkers} คน / {preflight.totalTimesheets} ใบงาน — เลือกจ่าย{' '}
                      {selectedWorkerIds.size} คนในรอบนี้ · กดปุ่ม <strong>เริ่มการประมวลผล</strong> ด้านล่าง
                    </p>
                    <p className="text-green-800/90 border-t border-green-200 pt-2">
                      <span className="font-semibold">หมายเหตุ:</span> จำนวน &quot;คน&quot; คือลูกจ้างไม่ซ้ำที่มีอย่างน้อยหนึ่งใบงานในรอบนี้ที่ตั้งพร้อมจ่ายแล้ว (และยังไม่ถูกล็อกจาก Batch เก่า)
                      ตารางสรุปเดือนแบบ Wave นับแถวต่อ wave — คนเดียวกันหลาย wave จึงอาจเห็นแถวมากกว่าจำนวนคนใน payroll ได้ ถ้าต้องการให้ครบทุกคนในรายชื่อ ให้ตรวจว่าทุกคนมีใบงานในเดือนนั้นที่พร้อมจ่าย และ PO ที่เกี่ยวข้องถูกจัดการที่ PO+เดือนแล้ว
                    </p>
                  </AlertDescription>
                </Alert>
              )}

              </div>

              <DialogFooter className="shrink-0 flex-col gap-2 sm:flex-col border-t bg-background px-6 py-4">
                {!preflight ? (
                  <Button onClick={handlePreflight} variant="outline" className="w-full font-bold h-12" disabled={isChecking || !targetPeriodId}>
                    {isChecking ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
                    ตรวจสอบก่อนประมวลผล (Pre-check)
                  </Button>
                ) : (
                  <>
                    <Button
                      onClick={handleGenerate}
                      className="w-full bg-primary font-bold h-12"
                      disabled={
                        isGenerating ||
                        !targetPeriodId ||
                        preflight.missingApprovedMonthlyTimesheet ||
                        selectedWorkerIds.size === 0 ||
                        preflight.eligibleWorkers.length === 0
                      }
                    >
                      {isGenerating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <TrendingUp className="h-4 w-4 mr-2" />}
                      {preflight.missingApprovedMonthlyTimesheet
                        ? 'รอปิดงวด PO+เดือนก่อน'
                        : preflight.eligibleWorkers.length === 0
                          ? 'ไม่มีคนพร้อมจ่าย'
                          : selectedWorkerIds.size === 0
                            ? 'เลือกคนงานก่อน'
                            : preflight.hasWarnings
                              ? `ยืนยันสร้าง Batch (${selectedWorkerIds.size} คน · มีคนงานได้ 0)`
                              : `เริ่มการประมวลผล (${selectedWorkerIds.size} คน)`}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="w-full h-9 text-muted-foreground"
                      disabled={isGenerating || isChecking}
                      onClick={() => {
                        setPreflight(null);
                        setSelectedWorkerIds(new Set());
                      }}
                    >
                      ตรวจสอบใหม่
                    </Button>
                  </>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
          )}
        </div>

        {preflight &&
          !isGenerateOpen &&
          !preflight.missingApprovedMonthlyTimesheet &&
          preflight.eligibleWorkers.length > 0 && (
            <Alert className="border-green-300 bg-green-50/90 text-green-950 shadow-sm">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <AlertTitle className="font-bold">พร้อมสร้าง Payroll Batch</AlertTitle>
              <AlertDescription className="text-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-1">
                <span>
                  ตรวจสอบผ่าน {preflight.totalWorkers} คน / {preflight.totalTimesheets} ใบงาน — เลือกไว้{' '}
                  {selectedWorkerIds.size} คน
                </span>
                <Button type="button" className="shrink-0 font-bold" onClick={() => setIsGenerateOpen(true)}>
                  เปิดหน้าต่างสร้าง Batch
                </Button>
              </AlertDescription>
            </Alert>
          )}

        <PageGuidance
          title="นโยบายการเบิกจ่าย (Disbursement Policy)"
          tips={[
            'รายการที่เข้า Payroll Batch ต้องเป็นใบงานรายวันที่ระบบตั้ง readyForPayroll แล้ว — เกิดหลังล็อกงวด/ปิดงวดที่เอกสารสรุปลงเวลารายเดือน (PO + เดือน) ซึ่งจะส่งต่อไปยังพอร์ทัลลูกค้า และเป็นฐานทำใบแจ้งหนี้จากสรุปรายเดือน (แทนการอ้าง Wave เดิม)',
            "ลำดับการอนุมัติภายใน: ฝ่ายเงินเดือนส่งขออนุมัติ → ผู้จัดการ HR / ผู้จัดการปฏิบัติการกดอนุมัติจ่ายเงินครั้งเดียว → สถานะ FINANCE_PREPARED (คิวบัญชีรอจ่าย) → บัญชีกด «ยืนยันจ่าย» ในหน้ารายละเอียด batch พร้อมเลือกบัญชีธนาคารตัดจ่าย — จึงจะมีสถานะ PAID + ลง cashbook",
            "ข้อมูลใน Batch จะถูก Snapshot ไว้เพื่อป้องกันการเปลี่ยนแปลงย้อนหลังในประวัติคนงาน",
          ]}
        />

        <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && !adminBusy && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ลบชุดจ่าย (Admin)</AlertDialogTitle>
              <AlertDialogDescription>
                ยืนยันการลบ <span className="font-mono font-semibold">{deleteTarget?.id}</span> — ระบบจะปลดล็อก daily timesheets ที่เกี่ยวข้อง
                และลบ snapshot ของงวดนี้ การกระทำนี้ไม่สามารถย้อนกลับได้
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={adminBusy}>ยกเลิก</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={(e) => {
                  e.preventDefault();
                  void handleAdminDelete();
                }}
                disabled={adminBusy}
              >
                {adminBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ลบ'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={regenTarget !== null} onOpenChange={(open) => !open && !adminBusy && setRegenTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>สร้างชุดจ่ายใหม่ (Regenerate)</AlertDialogTitle>
              <AlertDialogDescription>
                ระบบจะลบ <span className="font-mono font-semibold">{regenTarget?.id}</span> ปลดล็อก timesheets แล้วประมวลผลใหม่
                ตามรอบบัญชีและขอบเขตเดิม — จะได้รหัสชุดจ่ายใหม่
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={adminBusy}>ยกเลิก</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  void handleAdminRegenerate();
                }}
                disabled={adminBusy}
              >
                {adminBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'สร้างใหม่'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isBatchesLoading ? (
              <div className="py-20 text-center animate-pulse">กำลังประมวลผลข้อมูล...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="pl-6 py-4 font-bold">รหัสชุดจ่าย (Batch ID)</TableHead>
                    <TableHead className="font-bold">ขอบเขต (Scope)</TableHead>
                    <TableHead className="font-bold text-center">จำนวนคน</TableHead>
                    <TableHead className="font-bold text-right">ยอดจ่ายสุทธิ (Net)</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                    <TableHead className="font-bold">วันที่สร้าง</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleBatches.map((b) => (
                    <TableRow key={b.id} className="hover:bg-muted/30 group transition-all cursor-pointer" onClick={() => router.push(`/payroll/batches/${b.id}`)}>
                      <TableCell className="pl-6 py-4 font-mono text-xs font-bold text-primary">{b.id}</TableCell>
                      <TableCell className="capitalize text-xs font-medium">{b.workModeScope}</TableCell>
                      <TableCell className="text-center font-bold">{b.totalWorkers} คน</TableCell>
                      <TableCell className="text-right font-black text-primary text-lg">฿ {b.netAmount.toLocaleString()}</TableCell>
                      <TableCell>{getStatusBadge(b.status)}</TableCell>
                      <TableCell className="text-[10px] text-muted-foreground">{formatDateThaiBE(b.createdAt)}</TableCell>
                      <TableCell
                        className="text-right pr-4"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-1 flex-wrap">
                          {isAdmin && (
                            <>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 px-2 text-destructive border-destructive/30 hover:bg-destructive/10"
                                title="ลบชุดจ่าย (Admin)"
                                disabled={adminBatchActionsBlocked(b.status)}
                                onClick={() => setDeleteTarget(b)}
                              >
                                <Trash2 className="h-3.5 w-3.5 shrink-0" />
                                <span className="hidden sm:inline ml-1">ลบ</span>
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 px-2"
                                title="สร้างชุดจ่ายใหม่ (Regenerate)"
                                disabled={adminBatchActionsBlocked(b.status)}
                                onClick={() => setRegenTarget(b)}
                              >
                                <RefreshCw className="h-3.5 w-3.5 shrink-0" />
                                <span className="hidden sm:inline ml-1">สร้างใหม่</span>
                              </Button>
                            </>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="group-hover:text-primary shrink-0"
                            title="ดูรายละเอียด"
                            onClick={() => router.push(`/payroll/batches/${b.id}`)}
                          >
                            <ChevronRight className="h-5 w-5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {visibleBatches.length === 0 && !isBatchesLoading && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-20 text-muted-foreground italic">
                        {accountingPayoutQueueOnly
                          ? 'ยังไม่มีชุดจ่ายที่อนุมัติแล้ว (รอ HR/ผู้จัดการอนุมัติ batch) — หรือรายการยังไม่ถึงขั้น HR_APPROVED'
                          : 'ยังไม่มีประวัติการจ่ายเงิน'}
                      </TableCell>
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

export default function PayrollBatchesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] w-full items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      }
    >
      <PayrollBatchesPageContent />
    </Suspense>
  );
}
