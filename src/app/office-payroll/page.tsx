'use client';

import { useState, useMemo, useEffect } from 'react';
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
  AlertTriangle,
  Info,
  Clock,
  Loader2,
  ShieldAlert,
  Trash2,
  Users,
  Send,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatPayrollYearMonthEnAbbrev } from '@/lib/date-thai';
import { OfficePayrollRun, OfficeStaff, PayrollRunStatus } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
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
import { useToast } from '@/hooks/use-toast';
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';
import { canView, canCreate, canPreparePayroll } from '@/lib/permissions';
import { isPayrollOfficer, isSystemAdmin } from '@/lib/permission-core';
import { usePermissions } from '@/hooks/use-permissions';
import { submitOfficeRunForManagerReview } from '@/lib/payroll/office-submit-hr-review';
import {
  OFFICE_RUN_STATUSES_FOR_ACCOUNTING_PAYOUT,
  shouldFilterToAccountingPayoutQueue,
} from '@/lib/payroll/accounting-payout-queue';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import { useAppUser } from '@/hooks/use-app-user';
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
import {
  applyStandardOfficeRunLines,
  getPayrollMonthPeriodBounds,
  getStaffIdsUsedInOtherRunsForSameMonth,
  isOfficeStaffEligibleForStandardOfficeRun,
} from '@/lib/payroll/office-payroll-run-apply';
import { fetchOfficePayrollMonthConsolidation, type OfficePayrollMonthConsolidation } from '@/lib/payroll/office-month-staff-aggregate';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/** YYYY-MM ตามปฏิทินเครื่องผู้ใช้ — ใช้เป็นค่าเริ่มต้นตัวกรองเดือน */
function currentPayrollMonthYm(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function initNewRunState(): Partial<OfficePayrollRun> {
  const m = currentPayrollMonthYm();
  const b = getPayrollMonthPeriodBounds(m);
  return {
    payrollRunNo: getPreviewPattern('office_payroll_run'),
    payrollMonth: m,
    payrollPeriodStart: b.payrollPeriodStart,
    payrollPeriodEnd: b.payrollPeriodEnd,
    notes: '',
  };
}

/** ลบบรรทัดใน subcollection แล้วลบเอกสารงวด — ใช้เมื่อ admin ลบรายการจากรายการ */
async function deleteOfficePayrollRunCascade(firestore: Firestore, runId: string): Promise<void> {
  const linesCol = collection(firestore, 'office_payroll_runs', runId, 'lines');
  const snap = await getDocs(linesCol);
  const refs = snap.docs.map((d) => d.ref);
  const chunkSize = 400;
  for (let i = 0; i < refs.length; i += chunkSize) {
    const batch = writeBatch(firestore);
    for (const ref of refs.slice(i, i + chunkSize)) {
      batch.delete(ref);
    }
    await batch.commit();
  }
  await deleteDoc(doc(firestore, 'office_payroll_runs', runId));
}

function adminOfficePayrollDeleteBlocked(run: OfficePayrollRun): boolean {
  if (run.status === 'LOCKED' || run.status === 'PAID' || run.status === 'FINANCE_APPROVED') return true;
  if (run.financeCashbookEntryId) return true;
  return false;
}

export default function OfficePayrollPage() {
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { check } = usePermissions(currentUser);
  const canEditOfficePayroll = useMemo(() => check('office_payroll', 'edit'), [check, currentUser]);
  const canOfficerSendForReview = useMemo(
    () =>
      Boolean(
        currentUser &&
          canEditOfficePayroll &&
          (isSystemAdmin(currentUser) || isPayrollOfficer(currentUser))
      ),
    [currentUser, canEditOfficePayroll]
  );

  const isAuthorized = useMemo(() => canView(currentUser, 'office_payroll'), [currentUser]);
  const canCreateOfficePayroll = useMemo(() => canCreate(currentUser, 'office_payroll'), [currentUser]);
  const canCreateWorkerPayroll = useMemo(() => canCreate(currentUser, 'worker_payroll'), [currentUser]);
  const canPrepareWorkerPayroll = useMemo(() => canPreparePayroll(currentUser), [currentUser]);
  const isAdmin = useMemo(() => isSystemAdmin(currentUser), [currentUser]);
  const accountingPayoutQueueOnly = useMemo(
    () =>
      shouldFilterToAccountingPayoutQueue(currentUser, {
        canCreateOfficePayroll,
        canCreateWorkerPayroll,
        canPrepareWorkerPayroll,
      }),
    [currentUser, canCreateOfficePayroll, canCreateWorkerPayroll, canPrepareWorkerPayroll],
  );

  const [deleteTarget, setDeleteTarget] = useState<OfficePayrollRun | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [sendingReviewId, setSendingReviewId] = useState<string | null>(null);
  const [runSearch, setRunSearch] = useState('');
  const [monthFilterYm, setMonthFilterYm] = useState<string>(() => currentPayrollMonthYm());
  /** ค่าเริ่มต้นแสดงทุกเดือน — ให้ตรวจสอบงวดที่จ่ายแล้วย้อนหลังได้เหมือนรายการ Payroll Batches ลูกจ้าง */
  const [monthFilterShowAll, setMonthFilterShowAll] = useState(true);

  const runsQuery = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return query(collection(firestore, 'office_payroll_runs'), orderBy('payrollMonth', 'desc'));
  }, [firestore, isAuthorized]);
  
  const { data: runs, isLoading, error: runsQueryError } = useCollection<OfficePayrollRun>(runsQuery as any);

  const visibleRuns = useMemo(() => {
    if (!runs) return undefined;
    if (accountingPayoutQueueOnly) {
      return runs.filter((r) => OFFICE_RUN_STATUSES_FOR_ACCOUNTING_PAYOUT.includes(r.status));
    }
    return runs;
  }, [runs, accountingPayoutQueueOnly]);

  const runsAfterMonthFilter = useMemo(() => {
    if (!visibleRuns) return undefined;
    if (monthFilterShowAll) return visibleRuns;
    return visibleRuns.filter((r) => r.payrollMonth === monthFilterYm);
  }, [visibleRuns, monthFilterShowAll, monthFilterYm]);

  const displayRuns = useMemo(() => {
    if (!runsAfterMonthFilter) return undefined;
    const q = runSearch.trim().toLowerCase();
    if (!q) return runsAfterMonthFilter;
    return runsAfterMonthFilter.filter(
      (r) =>
        (r.payrollRunNo || '').toLowerCase().includes(q) ||
        (r.payrollMonth || '').toLowerCase().includes(q) ||
        formatPayrollYearMonthEnAbbrev(r.payrollMonth, '').toLowerCase().includes(q) ||
        (r.notes || '').toLowerCase().includes(q)
    );
  }, [runsAfterMonthFilter, runSearch]);

  /** เดือนที่ใช้แสดงการ์ดสรุปด้านล่าง — ตามตัวกรอง */
  const summaryMonths = useMemo(() => {
    if (monthFilterShowAll) {
      if (!visibleRuns?.length) return [] as string[];
      return [...new Set(visibleRuns.map((r) => r.payrollMonth))].sort().reverse();
    }
    return [monthFilterYm];
  }, [visibleRuns, monthFilterShowAll, monthFilterYm]);

  const [monthlyByYm, setMonthlyByYm] = useState<Record<string, OfficePayrollMonthConsolidation>>({});
  const [monthlySummaryLoading, setMonthlySummaryLoading] = useState(false);

  useEffect(() => {
    if (!firestore || summaryMonths.length === 0) {
      setMonthlyByYm({});
      setMonthlySummaryLoading(false);
      return;
    }
    let cancel = false;
    setMonthlySummaryLoading(true);
    void (async () => {
      const out: Record<string, OfficePayrollMonthConsolidation> = {};
      for (const ym of summaryMonths) {
        try {
          out[ym] = await fetchOfficePayrollMonthConsolidation(firestore, ym);
        } catch (e) {
          console.error(e);
        }
        if (cancel) return;
      }
      if (!cancel) {
        setMonthlyByYm(out);
        setMonthlySummaryLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [firestore, summaryMonths]);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newRun, setNewRun] = useState<Partial<OfficePayrollRun>>(() => initNewRunState());
  const [selectedStaffIds, setSelectedStaffIds] = useState<Set<string>>(() => new Set());
  const [createStaffSearch, setCreateStaffSearch] = useState('');
  const [loadingLocked, setLoadingLocked] = useState(false);
  const [lockedInOtherRuns, setLockedInOtherRuns] = useState<Set<string>>(() => new Set());
  const [staffPickVersion, setStaffPickVersion] = useState(0);

  const staffForCreateQuery = useMemoFirebase(
    () => (firestore && isAuthorized && isDialogOpen ? collection(firestore, 'office_staff') : null),
    [firestore, isAuthorized, isDialogOpen],
  );
  const { data: allOfficeStaff } = useCollection<OfficeStaff>(staffForCreateQuery as any);

  useEffect(() => {
    if (!isDialogOpen || !firestore || !newRun.payrollMonth) return;
    let cancel = false;
    setLoadingLocked(true);
    void getStaffIdsUsedInOtherRunsForSameMonth(firestore, newRun.payrollMonth, null)
      .then((s) => {
        if (cancel) return;
        setLockedInOtherRuns(s);
        setStaffPickVersion((v) => v + 1);
      })
      .catch((e) => {
        console.error(e);
        if (!cancel) toast({ variant: 'destructive', title: 'โหลดสถานะงวดเดือนล้มเหลว', description: e instanceof Error ? e.message : String(e) });
      })
      .finally(() => {
        if (!cancel) setLoadingLocked(false);
      });
    return () => {
      cancel = true;
    };
  }, [isDialogOpen, newRun.payrollMonth, firestore, toast]);

  const nStaff = allOfficeStaff?.length ?? 0;
  useEffect(() => {
    if (!isDialogOpen || loadingLocked) return;
    if (!allOfficeStaff?.length) return;
    const eligible = allOfficeStaff
      .filter((s) => isOfficeStaffEligibleForStandardOfficeRun(s) && !lockedInOtherRuns.has(s.id))
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'th'));
    setSelectedStaffIds(new Set(eligible.map((s) => s.id)));
  }, [isDialogOpen, loadingLocked, lockedInOtherRuns, staffPickVersion, nStaff]);

  const eligibleForCreate = useMemo(() => {
    if (!allOfficeStaff) return [];
    return allOfficeStaff
      .filter((s) => isOfficeStaffEligibleForStandardOfficeRun(s) && !lockedInOtherRuns.has(s.id))
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'th'));
  }, [allOfficeStaff, lockedInOtherRuns]);

  const lockedOutForCreate = useMemo(() => {
    if (!allOfficeStaff) return [];
    return allOfficeStaff
      .filter((s) => isOfficeStaffEligibleForStandardOfficeRun(s) && lockedInOtherRuns.has(s.id))
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'th'));
  }, [allOfficeStaff, lockedInOtherRuns]);

  const filteredEligible = useMemo(() => {
    const q = createStaffSearch.trim().toLowerCase();
    if (!q) return eligibleForCreate;
    return eligibleForCreate.filter(
      (s) =>
        s.fullName.toLowerCase().includes(q) ||
        s.staffCode.toLowerCase().includes(q) ||
        (s.nickname && s.nickname.toLowerCase().includes(q)) ||
        s.department.toLowerCase().includes(q),
    );
  }, [eligibleForCreate, createStaffSearch]);

  const handleCreateRun = async () => {
    if (!canCreateOfficePayroll) {
      toast({ variant: "destructive", title: "ไม่มีสิทธิ์", description: "คุณไม่มีสิทธิ์สร้างงวดเงินเดือนออฟฟิศ" });
      return;
    }
    if (!firestore || !currentUser) return;
    if (!newRun.payrollMonth || !newRun.payrollPeriodStart || !newRun.payrollPeriodEnd) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาเลือกเดือนจ่าย" });
      return;
    }
    if (!allOfficeStaff) {
      toast({ variant: "destructive", title: "รอข้อมูล", description: "กำลังโหลดทะเบียนพนักงาน" });
      return;
    }
    if (selectedStaffIds.size === 0) {
      toast({ variant: "destructive", title: "ยังไม่ได้เลือกรายชื่อ", description: "เลือกอย่างน้อย 1 คนที่ต้องจ่ายในงวดนี้" });
      return;
    }

    const byId = new Map(allOfficeStaff.map((s) => [s.id, s]));
    const staffList: OfficeStaff[] = [];
    for (const id of selectedStaffIds) {
      const s = byId.get(id);
      if (!s) continue;
      if (!isOfficeStaffEligibleForStandardOfficeRun(s) || lockedInOtherRuns.has(s.id)) {
        toast({ variant: 'destructive', title: 'รายชื่อไม่ถูกต้อง', description: 'มีรายชื่อที่ถูกงวดอื่นใช้แล้วหรือไม่เข้าเงื่อนไข — ลองปิดแล้วเปิดใหม่' });
        return;
      }
      staffList.push(s);
    }
    if (staffList.length === 0) {
      toast({ variant: "destructive", title: "รายชื่อไม่ถูกต้อง" });
      return;
    }

    setIsCreating(true);
    try {
      const { code: finalNo } = await generateNextDocumentCode(firestore, 'office_payroll_run', { actor: currentUser.displayName });

      const notesTrim = typeof newRun.notes === 'string' ? newRun.notes.trim() : '';
      const docRef = await addDoc(collection(firestore, 'office_payroll_runs'), {
        payrollRunNo: finalNo,
        payrollMonth: newRun.payrollMonth,
        payrollPeriodStart: newRun.payrollPeriodStart,
        payrollPeriodEnd: newRun.payrollPeriodEnd,
        ...(notesTrim ? { notes: notesTrim } : {}),
        status: 'DRAFT',
        staffCount: 0,
        grossAmount: 0,
        netAmount: 0,
        totalAllowances: 0,
        totalDeductions: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await applyStandardOfficeRunLines(
        firestore,
        docRef.id,
        { payrollMonth: newRun.payrollMonth, payrollPeriodEnd: newRun.payrollPeriodEnd },
        staffList,
        { newStatus: 'CALCULATED' },
      );

      setIsDialogOpen(false);
      toast({ title: "สร้างงวดเงินเดือนสำเร็จ", description: `${finalNo} · คำนวณ ${staffList.length} ราย` });
      router.push(`/office-payroll/${docRef.id}`);
    } catch (e) {
      console.error(e);
      toast({
        variant: 'destructive',
        title: 'สร้างงวดไม่สำเร็จ',
        description: e instanceof Error ? e.message : 'ไม่สามารถสร้างงวดการจ่ายเงินได้',
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleConfirmDeleteRun = async () => {
    if (!firestore || !deleteTarget || !currentUser || !isSystemAdmin(currentUser)) return;
    if (adminOfficePayrollDeleteBlocked(deleteTarget)) {
      toast({
        variant: 'destructive',
        title: 'ลบไม่ได้',
        description: 'งวดที่ล็อกหรืออนุมัติการเงิน/จ่ายแล้ว — ใช้เฉพาะแก้รายการร่างหรือก่อนปิดงบ',
      });
      setDeleteTarget(null);
      return;
    }
    setIsDeleting(true);
    try {
      await deleteOfficePayrollRunCascade(firestore, deleteTarget.id);
      toast({
        title: 'ลบงวดแล้ว',
        description: `เลขที่ ${deleteTarget.payrollRunNo}`,
      });
      setDeleteTarget(null);
    } catch (e) {
      console.error(e);
      toast({
        variant: 'destructive',
        title: 'ลบไม่สำเร็จ',
        description: 'ลองใหม่หรือตรวจสอบการเชื่อมต่อ',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSendForManagerReview = async (run: OfficePayrollRun) => {
    if (!firestore || !currentUser) return;
    if (!canOfficerSendForReview) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'เฉพาะฝ่ายเงินเดือนหรือผู้ดูแล' });
      return;
    }
    if (run.status !== 'CALCULATED') {
      toast({ variant: 'destructive', title: 'ส่งไม่ได้', description: 'ส่งได้เฉพาะงวดที่สถานะ CALCULATED' });
      return;
    }
    setSendingReviewId(run.id);
    try {
      await submitOfficeRunForManagerReview(firestore, run.id, currentUser);
      toast({
        title: 'ส่งขออนุมัติแล้ว',
        description: `${run.payrollRunNo} → รอผู้จัดการ (ศูนย์อนุมัติ Payroll)`,
      });
    } catch (e) {
      console.error(e);
      toast({
        variant: 'destructive',
        title: 'ส่งไม่สำเร็จ',
        description: e instanceof Error ? e.message : 'ลองอีกครั้ง',
      });
    } finally {
      setSendingReviewId(null);
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

  if (userLoading || !currentUser) return null;

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

        {accountingPayoutQueueOnly && (
          <Alert className="bg-slate-100 border-slate-300">
            <Info className="h-5 w-5" />
            <AlertTitle className="font-bold">มุมมองบัญชี (Office)</AlertTitle>
            <AlertDescription className="text-xs">
              แสดงเฉพาะงวดที่ <strong>ผู้จัดการ/HR อนุมัติรายงวดแล้ว</strong> (สถานะ <span className="font-mono">HR_APPROVED</span> ขึ้นไป) — ไม่รวม
              งวดที่ฝ่ายเงินเดือนยังคำนวณหรือยัง <span className="font-mono">HR_REVIEW</span> รออนุมัติ (คนละขั้นกับลูกจ้าง:
              ลูกจ้างต้องเป็น <span className="font-mono">FINANCE_PREPARED</span>+ จึงจะอยู่ในคิวเดียวกับบัญชี)
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Alert className="bg-blue-50 border-blue-200 text-blue-800 shadow-sm">
            <Info className="h-5 w-5 text-blue-600" />
            <AlertTitle className="font-bold">นโยบายสายงาน (Workflow Policy)</AlertTitle>
            <AlertDescription className="text-xs">
              Payroll/HR คำนวณและส่งอนุมัติ → ผู้จัดการ/HR อนุมัติรายการ → <strong>บัญชี</strong>อนุมัติเบิกจ่ายและลงบัญชี (ลำดับนี้ ห้ามข้าม)
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
              <Input
                placeholder="ค้นหาเลขที่งวด..."
                className="pl-9 h-11"
                value={runSearch}
                onChange={(e) => setRunSearch(e.target.value)}
              />
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" className="h-11 gap-2 shrink-0">
                  <Filter className="h-4 w-4" />
                  ตัวกรอง
                  {monthFilterShowAll ? (
                    <Badge variant="outline" className="font-normal text-[10px]">
                      ทุกเดือน
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="font-normal text-[10px] tabular-nums">
                      {formatPayrollYearMonthEnAbbrev(monthFilterYm)}
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80" align="start">
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">กรองตามเดือนประจำงวด</Label>
                    <Input
                      type="month"
                      className="h-10"
                      value={monthFilterYm}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!v) return;
                        setMonthFilterYm(v);
                        setMonthFilterShowAll(false);
                      }}
                    />
                    <p className="text-[11px] text-muted-foreground leading-snug">
                      เปิดหน้ามาแสดง <strong>ทุกเดือน</strong> เพื่อเห็นงวดจ่ายแล้วย้อนหลัง — เลือกเดือนในปฏิทินด้านบนถ้าต้องการโฟกัสเดือนเดียว (
                      เดือนปัจจุบัน {formatPayrollYearMonthEnAbbrev(currentPayrollMonthYm())})
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button
                      type="button"
                      variant={monthFilterShowAll ? 'default' : 'outline'}
                      size="sm"
                      className="w-full"
                      onClick={() => setMonthFilterShowAll(true)}
                    >
                      แสดงทุกเดือน
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        setMonthFilterYm(currentPayrollMonthYm());
                        setMonthFilterShowAll(false);
                      }}
                    >
                      ใช้เดือนปัจจุบัน
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
          
          <Dialog
            open={isAuthorized && isDialogOpen}
            onOpenChange={(open) => {
              setIsDialogOpen(open);
              if (open) {
                setNewRun(initNewRunState());
                setCreateStaffSearch('');
                setStaffPickVersion((v) => v + 1);
              }
            }}
          >
            <DialogTrigger asChild>
              <Button className="gap-2 h-11 px-6 bg-primary shadow-md text-base font-bold" disabled={!canCreateOfficePayroll}>
                <Plus className="h-5 w-5" /> สร้างงวดเงินเดือน (New Office Payroll)
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col gap-0">
              <DialogHeader>
                <DialogTitle>สร้างงวดเงินเดือนพนักงานใหม่</DialogTitle>
                <DialogDescription>
                  เลือกเดือนจ่าย (ช่วงวันที่เป็นต้นเดือน–สิ้นเดือนอัตโนมัติ) จากนั้นเลือกพนักงาน ACTIVE ที่ต้องจ่าย — คนที่อยู่งวดอื่นในเดือนเดียวกันแล้วจะเลือกไม่ได้
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 gap-4 py-4 overflow-y-auto flex-1 min-h-0">
                <div className="space-y-2">
                  <Label>เลขที่งวด (Run No.)</Label>
                  <Input value={newRun.payrollRunNo} disabled className="bg-muted/50 font-mono font-bold" />
                </div>
                <div className="space-y-2">
                  <Label>เดือนที่จ่าย (Payroll Month)</Label>
                  <Input
                    type="month"
                    value={newRun.payrollMonth}
                    onChange={(e) => {
                      const ym = e.target.value;
                      try {
                        const b = getPayrollMonthPeriodBounds(ym);
                        setNewRun((prev) => ({
                          ...prev,
                          payrollMonth: ym,
                          payrollPeriodStart: b.payrollPeriodStart,
                          payrollPeriodEnd: b.payrollPeriodEnd,
                        }));
                        setStaffPickVersion((v) => v + 1);
                      } catch {
                        setNewRun((prev) => ({ ...prev, payrollMonth: ym }));
                      }
                    }}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-md border bg-muted/30 p-3 text-sm">
                  <div>
                    <span className="text-muted-foreground text-xs">วันเริ่มงวด</span>
                    <p className="font-mono font-semibold">{newRun.payrollPeriodStart || '—'}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs">วันสิ้นงวด</span>
                    <p className="font-mono font-semibold">{newRun.payrollPeriodEnd || '—'}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>หมายเหตุ</Label>
                  <Input
                    value={newRun.notes ?? ''}
                    onChange={(e) => setNewRun({ ...newRun, notes: e.target.value })}
                    placeholder="ระบุโครงการหรือข้อความเพิ่มเติม..."
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label className="mb-0">เลือกพนักงานที่จ่ายในงวดนี้ ({selectedStaffIds.size} คน)</Label>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8"
                        disabled={loadingLocked || eligibleForCreate.length === 0}
                        onClick={() => setSelectedStaffIds(new Set(eligibleForCreate.map((s) => s.id)))}
                      >
                        เลือกทั้งหมด
                      </Button>
                      <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => setSelectedStaffIds(new Set())}>
                        ไม่เลือก
                      </Button>
                    </div>
                  </div>
                  <Input
                    placeholder="ค้นหาชื่อ / รหัส / แผนก..."
                    value={createStaffSearch}
                    onChange={(e) => setCreateStaffSearch(e.target.value)}
                  />
                  {loadingLocked && (
                    <p className="text-xs text-muted-foreground flex items-center gap-2">
                      <Loader2 className="h-3 w-3 animate-spin" /> กำลังตรวจสอบงวดเดือนอื่น...
                    </p>
                  )}
                  <ScrollArea className="h-[220px] rounded-md border p-2">
                    <div className="space-y-2 pr-3">
                      {filteredEligible.map((s) => (
                        <label
                          key={s.id}
                          className="flex items-start gap-3 rounded-md border border-transparent px-2 py-1.5 hover:bg-muted/50 cursor-pointer"
                        >
                          <Checkbox
                            checked={selectedStaffIds.has(s.id)}
                            onCheckedChange={(checked) => {
                              setSelectedStaffIds((prev) => {
                                const next = new Set(prev);
                                if (checked === true) next.add(s.id);
                                else next.delete(s.id);
                                return next;
                              });
                            }}
                          />
                          <span className="text-sm leading-tight">
                            <span className="font-semibold">{s.fullName}</span>
                            <span className="text-muted-foreground text-xs block font-mono">{s.staffCode} · {s.department}</span>
                          </span>
                        </label>
                      ))}
                      {filteredEligible.length === 0 && !loadingLocked && (
                        <p className="text-sm text-muted-foreground py-6 text-center">ไม่มีรายชื่อที่เลือกได้ในเดือนนี้</p>
                      )}
                    </div>
                  </ScrollArea>
                  {lockedOutForCreate.length > 0 && (
                    <Alert className="bg-amber-50 border-amber-200 py-2">
                      <AlertTitle className="text-xs font-bold">อยู่งวดจ่ายอื่นในเดือนนี้แล้ว ({lockedOutForCreate.length} คน)</AlertTitle>
                      <AlertDescription className="text-[11px] leading-snug">
                        {lockedOutForCreate.slice(0, 8).map((s) => s.fullName).join(', ')}
                        {lockedOutForCreate.length > 8 ? ` และอีก ${lockedOutForCreate.length - 8} คน` : ''}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              </div>
              <DialogFooter className="border-t pt-4 mt-2">
                <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isCreating}>
                  ยกเลิก
                </Button>
                <Button onClick={() => void handleCreateRun()} className="bg-primary font-bold" disabled={isCreating || !canCreateOfficePayroll}>
                  {isCreating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  สร้างงวดและคำนวณ
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {runsQueryError && (
              <Alert variant="destructive" className="m-4">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle className="font-bold">โหลดรายการงวดไม่สำเร็จ</AlertTitle>
                <AlertDescription className="text-xs font-mono whitespace-pre-wrap">
                  {runsQueryError.message}
                </AlertDescription>
              </Alert>
            )}
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
                    <TableHead className="text-right pr-4">ดำเนินการ</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayRuns?.map((run) => (
                    <TableRow 
                      key={run.id} 
                      className="cursor-pointer hover:bg-muted/30 group transition-all" 
                      onClick={() =>
                        router.push(
                          accountingPayoutQueueOnly ? `/accounting/office-payroll/${run.id}` : `/office-payroll/${run.id}`,
                        )
                      }
                    >
                      <TableCell className="py-4 font-bold text-primary font-mono">{run.payrollRunNo}</TableCell>
                      <TableCell className="font-medium">
                        {formatPayrollYearMonthEnAbbrev(run.payrollMonth)}
                        <span className="ml-1 text-xs text-muted-foreground">({run.payrollMonth})</span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{run.payrollPeriodStart} ถึง {run.payrollPeriodEnd}</TableCell>
                      <TableCell className="text-center font-bold">{run.staffCount} คน</TableCell>
                      <TableCell className="text-right font-black text-primary">
                        ฿{run.netAmount.toLocaleString()}
                      </TableCell>
                      <TableCell>{getStatusBadge(run.status)}</TableCell>
                      <TableCell
                        className="text-right pr-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {run.status === 'CALCULATED' && canOfficerSendForReview ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="default"
                            className="h-8 gap-1 text-xs"
                            disabled={sendingReviewId === run.id}
                            onClick={() => void handleSendForManagerReview(run)}
                          >
                            {sendingReviewId === run.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Send className="h-3.5 w-3.5" />
                            )}
                            ส่งอนุมัติ
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell
                        className="text-right pr-6"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center justify-end gap-0.5">
                          {isAdmin && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              disabled={adminOfficePayrollDeleteBlocked(run)}
                              title={
                                adminOfficePayrollDeleteBlocked(run)
                                  ? 'ลบไม่ได้ — งวดล็อกหรืออนุมัติการเงิน/จ่ายแล้ว'
                                  : 'ลบงวดนี้ (เฉพาะผู้ดูแลระบบ)'
                              }
                              onClick={() => setDeleteTarget(run)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="group-hover:text-primary"
                            onClick={() =>
                              router.push(
                                accountingPayoutQueueOnly
                                  ? `/accounting/office-payroll/${run.id}`
                                  : `/office-payroll/${run.id}`,
                              )
                            }
                          >
                            <ChevronRight className="h-5 w-5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!displayRuns || displayRuns.length === 0) && !isLoading && !runsQueryError && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-20 text-muted-foreground italic">
                        {visibleRuns && visibleRuns.length > 0 && runSearch.trim()
                          ? 'ไม่พบรายการตามคำค้น'
                          : visibleRuns &&
                              visibleRuns.length > 0 &&
                              !monthFilterShowAll &&
                              runsAfterMonthFilter?.length === 0
                            ? `ไม่มีงวดในเดือน ${formatPayrollYearMonthEnAbbrev(monthFilterYm)} — ลองเปลี่ยนเดือนในตัวกรองหรือกด «แสดงทุกเดือน»`
                            : accountingPayoutQueueOnly
                              ? 'ยังไม่มีงวดที่อนุมัติแล้ว (รอ HR/Manager) — หรือยังไม่ถึงขั้นตัดจ่าย'
                              : 'ไม่มีงวดการจ่ายเงินในขณะนี้'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {summaryMonths.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground">
              {monthFilterShowAll
                ? 'สรุปรวมรายเดือน (ทุกงวดที่คำนวณแล้ว)'
                : `สรุปรวมรายเดือน — ${formatPayrollYearMonthEnAbbrev(monthFilterYm)}`}
            </h2>
            {monthlySummaryLoading && Object.keys(monthlyByYm).length === 0 && (
              <p className="text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                กำลังคำนวณสรุปรายเดือน…
              </p>
            )}
            <div className="grid gap-2">
              {summaryMonths.map((ym) => {
                const s = monthlyByYm[ym];
                return (
                  <Card key={ym} className="border-dashed border-primary/25 bg-muted/10">
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div className="space-y-1 min-w-0">
                        <p className="text-sm font-semibold">
                          {formatPayrollYearMonthEnAbbrev(ym)}{' '}
                          <span className="text-xs font-normal text-muted-foreground">({ym})</span>
                        </p>
                        {s ? (
                          <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="inline-flex items-center gap-1">
                              <Users className="h-3.5 w-3.5" />
                              {s.uniqueStaffCount} คน (unique)
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Coins className="h-3.5 w-3.5" />
                              ยอดสุทธิรวม ฿{s.sumNetFromRuns.toLocaleString()}
                            </span>
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground flex items-center gap-2">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            กำลังโหลด…
                          </p>
                        )}
                      </div>
                      {s ? (
                        <Button variant="secondary" size="icon" asChild className="shrink-0">
                          <Link
                            href={`/office-payroll/month/${encodeURIComponent(ym)}`}
                            aria-label="ดูรายการรวมรายเดือน"
                          >
                            <ChevronRight className="h-5 w-5" />
                          </Link>
                        </Button>
                      ) : (
                        <Button type="button" variant="secondary" size="icon" className="shrink-0" disabled>
                          <ChevronRight className="h-5 w-5" />
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && !isDeleting && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ลบงวดเงินเดือนออฟฟิศ?</AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <span className="block">
                  จะลบ <span className="font-mono font-semibold">{deleteTarget?.payrollRunNo}</span> และรายพนักงานทั้งหมดในงวดนี้
                  การกระทำนี้ย้อนกลับไม่ได้
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting}>ยกเลิก</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={isDeleting}
                onClick={(e) => {
                  e.preventDefault();
                  void handleConfirmDeleteRun();
                }}
              >
                {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ลบ'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppShell>
  );
}
