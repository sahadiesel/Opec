'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { collection, getDocs, orderBy, query, limit } from 'firebase/firestore';
import { AppShell } from '@/components/layout/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { Users, ExternalLink, Loader2, Search, Building2, Briefcase, ShieldCheck, Printer } from 'lucide-react';
import type {
  User,
  PayrollBatch,
  PayrollBatchLine,
  PayrollBatchStatus,
  OfficePayrollRun,
  OfficePayrollLine,
  PayrollRunStatus,
} from '@/lib/types';
import { canSeeAccountingPillarUi } from '@/lib/permissions';
import { canViewHrPayrollFlowSubsection } from '@/lib/navigation/nav-access';
import { isSystemAdmin } from '@/lib/permission-core';
import { usePermissions } from '@/hooks/use-permissions';
import { resolvePayrollWorkerWhtPaymentDateYmd } from '@/lib/payroll/payroll-worker-wht-model';
import { resolveOfficePayrollWhtPaymentDateYmd } from '@/lib/payroll/payroll-office-wht-model';
import { useToast } from '@/hooks/use-toast';
import {
  buildSocialSecurityPayrollListPrintHtml,
  capSocialSecurityPayrollListPrintRows,
  type SocialSecurityPayrollListPrintRow,
} from '@/lib/documents/social-security-payroll-list-print';
import { openStandardPrintWindow } from '@/lib/documents/standard-document-print';

type WorkerSsoRow = { batch: PayrollBatch; line: PayrollBatchLine; sso: number; paymentYmd: string };
type OfficeSsoRow = { run: OfficePayrollRun; line: OfficePayrollLine; sso: number; paymentYmd: string };
type ExecutiveSsoRow = { run: OfficePayrollRun; line: OfficePayrollLine; sso: number; paymentYmd: string };

function fmtBaht(n: number): string {
  return `฿${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * เงินสมทบประกันสังคมฝั่งลูกจ้างจากบรรทัด payroll batch
 * อ่านจาก deductionsBreakdown ก่อน (ค่าใช้งานจริง) → fallback ไปที่ d8Snapshot.deductions เผื่อบรรทัดเก่า
 */
function workerLineSsoAmount(line: PayrollBatchLine): number {
  const db = line.deductionsBreakdown || {};
  const snap = line.d8Snapshot?.deductions || {};
  const v = Number(db.social_security ?? snap.social_security ?? 0);
  return round2(Number.isFinite(v) ? v : 0);
}

function officeLineSsoAmount(line: OfficePayrollLine): number {
  return round2(Number(line.socialSecurity) || 0);
}

/**
 * YYYY-MM สำหรับกรองเดือน — อิง “งวดเงินเดือน” (period month) ไม่ใช่วันที่จ่าย
 * เช่น ลูกจ้างงวดเม.ย. แต่จ่าย พ.ค. ต้องนับเป็น 2026-04 (สอดคล้องกับการนำส่ง สปส.1-10)
 */
function workerRowYm(r: WorkerSsoRow): string | null {
  const end = r.line.periodEndDate;
  if (end && /^\d{4}-\d{2}/.test(String(end).trim())) return String(end).trim().slice(0, 7);
  const start = r.line.periodStartDate;
  if (start && /^\d{4}-\d{2}/.test(String(start).trim())) return String(start).trim().slice(0, 7);
  if (r.paymentYmd && /^\d{4}-\d{2}-\d{2}$/.test(r.paymentYmd)) return r.paymentYmd.slice(0, 7);
  return null;
}

function officeRowYm(r: OfficeSsoRow): string | null {
  const pm = r.run.payrollMonth;
  if (pm && /^\d{4}-\d{2}/.test(String(pm).trim())) return String(pm).trim().slice(0, 7);
  if (r.paymentYmd && /^\d{4}-\d{2}-\d{2}$/.test(r.paymentYmd)) return r.paymentYmd.slice(0, 7);
  return null;
}

function executiveRowYm(r: ExecutiveSsoRow): string | null {
  const pm = r.run.payrollMonth;
  if (pm && /^\d{4}-\d{2}/.test(String(pm).trim())) return String(pm).trim().slice(0, 7);
  if (r.paymentYmd && /^\d{4}-\d{2}-\d{2}$/.test(r.paymentYmd)) return r.paymentYmd.slice(0, 7);
  return null;
}

const TH_MONTHS = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
] as const;

function ymLabelTh(ym: string): string {
  const [y, m] = ym.split('-');
  const mi = Number(m);
  if (!y || !Number.isFinite(mi) || mi < 1 || mi > 12) return ym;
  return `${TH_MONTHS[mi - 1]} ${Number(y) + 543}`;
}

function workerBatchStatusBadge(status: PayrollBatchStatus): { label: string; variant: 'default' | 'secondary' } {
  if (status === 'PAID' || status === 'LOCKED') return { label: 'จ่ายแล้ว', variant: 'default' };
  if (status === 'FINANCE_PREPARED' || status === 'PAYMENT_EXPORTED') return { label: 'รอจ่าย', variant: 'secondary' };
  return { label: 'ระหว่างทาง', variant: 'secondary' };
}

function officeRunStatusBadge(status: PayrollRunStatus): { label: string; variant: 'default' | 'secondary' | 'outline' } {
  if (status === 'PAID' || status === 'LOCKED') return { label: 'จ่ายแล้ว', variant: 'default' };
  if (status === 'FINANCE_APPROVED' || status === 'HR_APPROVED') return { label: 'รอจ่าย', variant: 'secondary' };
  if (status === 'CANCELLED') return { label: 'ยกเลิก', variant: 'outline' };
  return { label: 'ระหว่างทาง', variant: 'secondary' };
}

function describeSocialSecurityPrintFilters(searchTerm: string, monthFilter: string): string[] {
  const lines: string[] = [];
  if (monthFilter !== 'ALL') {
    lines.push(`งวดเงินเดือน: ${ymLabelTh(monthFilter)} (${monthFilter})`);
  }
  if (searchTerm.trim()) {
    lines.push(`ค้นหา: "${searchTerm.trim()}"`);
  }
  return lines;
}

function buildSocialSecurityPrintRows(
  workers: WorkerSsoRow[],
  offices: OfficeSsoRow[],
  executives: ExecutiveSsoRow[],
): SocialSecurityPayrollListPrintRow[] {
  const rows: SocialSecurityPayrollListPrintRow[] = [];
  for (const { batch, line, sso, paymentYmd } of workers) {
    const st = workerBatchStatusBadge(batch.status);
    rows.push({
      section: 'ลูกจ้าง',
      periodStatus: st.label,
      batchLabel: batch.id,
      earnerName: line.workerNameSnapshot || '—',
      earnerId: line.workerId,
      paymentDate: paymentYmd,
      ssoLabel: fmtBaht(sso),
    });
  }
  for (const { run, line, sso, paymentYmd } of offices) {
    const st = officeRunStatusBadge(run.status);
    rows.push({
      section: 'ออฟฟิศ',
      periodStatus: st.label,
      batchLabel: run.payrollRunNo || run.id,
      earnerName: line.staffName || '—',
      earnerId: line.staffId,
      paymentDate: paymentYmd,
      ssoLabel: fmtBaht(sso),
    });
  }
  for (const { run, line, sso, paymentYmd } of executives) {
    const st = officeRunStatusBadge(run.status);
    rows.push({
      section: 'ผู้บริหาร',
      periodStatus: st.label,
      batchLabel: run.payrollRunNo || run.id,
      earnerName: line.staffName || '—',
      earnerId: line.staffId,
      paymentDate: paymentYmd,
      ssoLabel: fmtBaht(sso),
    });
  }
  return rows;
}

export default function AccountingSocialSecurityPayrollHubPage() {
  const { currentUser, isLoading } = useAppUser();
  const { profile } = usePermissions(currentUser);
  const firestore = useFirestore();
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const [monthFilter, setMonthFilter] = useState<string>('ALL');
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);
  const [workerRows, setWorkerRows] = useState<WorkerSsoRow[]>([]);
  const [officeRows, setOfficeRows] = useState<OfficeSsoRow[]>([]);
  const [executiveRows, setExecutiveRows] = useState<ExecutiveSsoRow[]>([]);
  const [loadingWorkerLines, setLoadingWorkerLines] = useState(false);
  const [loadingOfficeLines, setLoadingOfficeLines] = useState(false);
  const [loadingExecutiveLines, setLoadingExecutiveLines] = useState(false);
  const [workerLinesErr, setWorkerLinesErr] = useState<string | null>(null);
  const [officeLinesErr, setOfficeLinesErr] = useState<string | null>(null);
  const [executiveLinesErr, setExecutiveLinesErr] = useState<string | null>(null);

  const batchesQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'payroll_batches'), orderBy('updatedAt', 'desc'), limit(80));
  }, [firestore]);

  const officeRunsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'office_payroll_runs'), orderBy('updatedAt', 'desc'), limit(80));
  }, [firestore]);

  const executiveRunsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'executive_payroll_runs'), orderBy('updatedAt', 'desc'), limit(80));
  }, [firestore]);

  const { data: batches, isLoading: loadingBatches, error: batchesErr } = useCollection<PayrollBatch>(batchesQuery as any);
  const { data: officeRuns, isLoading: loadingRuns, error: runsErr } = useCollection<OfficePayrollRun>(officeRunsQuery as any);
  const {
    data: executiveRuns,
    isLoading: loadingExecutiveRuns,
    error: executiveRunsErr,
  } = useCollection<OfficePayrollRun>(executiveRunsQuery as any);

  useEffect(() => {
    if (!firestore || batches === undefined) return;
    let cancelled = false;
    setLoadingWorkerLines(true);
    setWorkerLinesErr(null);
    void (async () => {
      try {
        const rows: WorkerSsoRow[] = [];
        const list = batches ?? [];
        for (const batch of list) {
          if (cancelled) return;
          const snap = await getDocs(collection(firestore, 'payroll_batches', batch.id, 'lines'));
          snap.forEach((d) => {
            const line = { id: d.id, ...d.data() } as PayrollBatchLine;
            const sso = workerLineSsoAmount(line);
            if (sso <= 0.005) return;
            const payYmd = resolvePayrollWorkerWhtPaymentDateYmd(batch);
            rows.push({
              batch,
              line,
              sso,
              paymentYmd: payYmd && /^\d{4}-\d{2}-\d{2}$/.test(payYmd) ? payYmd : '—',
            });
          });
        }
        rows.sort((a, b) => (b.batch.updatedAt ?? 0) - (a.batch.updatedAt ?? 0));
        if (!cancelled) setWorkerRows(rows);
      } catch (e) {
        if (!cancelled) setWorkerLinesErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoadingWorkerLines(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, batches]);

  useEffect(() => {
    if (!firestore || officeRuns === undefined) return;
    let cancelled = false;
    setLoadingOfficeLines(true);
    setOfficeLinesErr(null);
    void (async () => {
      try {
        const rows: OfficeSsoRow[] = [];
        const list = officeRuns ?? [];
        for (const run of list) {
          if (cancelled) return;
          const snap = await getDocs(collection(firestore, 'office_payroll_runs', run.id, 'lines'));
          snap.forEach((d) => {
            const line = { id: d.id, ...d.data() } as OfficePayrollLine;
            const sso = officeLineSsoAmount(line);
            if (sso <= 0.005) return;
            const payYmd = resolveOfficePayrollWhtPaymentDateYmd(run);
            rows.push({
              run,
              line,
              sso,
              paymentYmd: payYmd && /^\d{4}-\d{2}-\d{2}$/.test(payYmd) ? payYmd : '—',
            });
          });
        }
        rows.sort((a, b) => (b.run.updatedAt ?? 0) - (a.run.updatedAt ?? 0));
        if (!cancelled) setOfficeRows(rows);
      } catch (e) {
        if (!cancelled) setOfficeLinesErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoadingOfficeLines(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, officeRuns]);

  useEffect(() => {
    if (!firestore || executiveRuns === undefined) return;
    let cancelled = false;
    setLoadingExecutiveLines(true);
    setExecutiveLinesErr(null);
    void (async () => {
      try {
        const rows: ExecutiveSsoRow[] = [];
        const list = executiveRuns ?? [];
        for (const run of list) {
          if (cancelled) return;
          const snap = await getDocs(collection(firestore, 'executive_payroll_runs', run.id, 'lines'));
          snap.forEach((d) => {
            const line = { id: d.id, ...d.data() } as OfficePayrollLine;
            const sso = officeLineSsoAmount(line);
            if (sso <= 0.005) return;
            const payYmd = resolveOfficePayrollWhtPaymentDateYmd(run);
            rows.push({
              run,
              line,
              sso,
              paymentYmd: payYmd && /^\d{4}-\d{2}-\d{2}$/.test(payYmd) ? payYmd : '—',
            });
          });
        }
        rows.sort((a, b) => (b.run.updatedAt ?? 0) - (a.run.updatedAt ?? 0));
        if (!cancelled) setExecutiveRows(rows);
      } catch (e) {
        if (!cancelled) setExecutiveLinesErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoadingExecutiveLines(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, executiveRuns]);

  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of workerRows) {
      const ym = workerRowYm(r);
      if (ym) set.add(ym);
    }
    for (const r of officeRows) {
      const ym = officeRowYm(r);
      if (ym) set.add(ym);
    }
    for (const r of executiveRows) {
      const ym = executiveRowYm(r);
      if (ym) set.add(ym);
    }
    return Array.from(set).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  }, [workerRows, officeRows, executiveRows]);

  const workerRowsBySearch = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return workerRows;
    return workerRows.filter(({ batch, line, paymentYmd }) => {
      const name = (line.workerNameSnapshot || '').toLowerCase();
      const bid = batch.id.toLowerCase();
      const lid = line.id.toLowerCase();
      const wid = line.workerId.toLowerCase();
      return name.includes(t) || bid.includes(t) || lid.includes(t) || wid.includes(t) || paymentYmd.includes(t);
    });
  }, [workerRows, q]);

  const officeRowsBySearch = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return officeRows;
    return officeRows.filter(({ run, line, paymentYmd }) => {
      const name = (line.staffName || '').toLowerCase();
      const rn = (run.payrollRunNo || '').toLowerCase();
      const rid = run.id.toLowerCase();
      const lid = line.id.toLowerCase();
      const sid = line.staffId.toLowerCase();
      const ym = (run.payrollMonth || '').toLowerCase();
      return name.includes(t) || rn.includes(t) || rid.includes(t) || lid.includes(t) || sid.includes(t) || ym.includes(t) || paymentYmd.includes(t);
    });
  }, [officeRows, q]);

  const executiveRowsBySearch = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return executiveRows;
    return executiveRows.filter(({ run, line, paymentYmd }) => {
      const name = (line.staffName || '').toLowerCase();
      const rn = (run.payrollRunNo || '').toLowerCase();
      const rid = run.id.toLowerCase();
      const lid = line.id.toLowerCase();
      const sid = line.staffId.toLowerCase();
      const ym = (run.payrollMonth || '').toLowerCase();
      return name.includes(t) || rn.includes(t) || rid.includes(t) || lid.includes(t) || sid.includes(t) || ym.includes(t) || paymentYmd.includes(t);
    });
  }, [executiveRows, q]);

  const filteredWorker = useMemo(() => {
    if (monthFilter === 'ALL') return workerRowsBySearch;
    return workerRowsBySearch.filter((r) => workerRowYm(r) === monthFilter);
  }, [workerRowsBySearch, monthFilter]);

  const filteredOffice = useMemo(() => {
    if (monthFilter === 'ALL') return officeRowsBySearch;
    return officeRowsBySearch.filter((r) => officeRowYm(r) === monthFilter);
  }, [officeRowsBySearch, monthFilter]);

  const filteredExecutive = useMemo(() => {
    if (monthFilter === 'ALL') return executiveRowsBySearch;
    return executiveRowsBySearch.filter((r) => executiveRowYm(r) === monthFilter);
  }, [executiveRowsBySearch, monthFilter]);

  const workerTotalSso = useMemo(
    () => filteredWorker.reduce((sum, { sso }) => sum + sso, 0),
    [filteredWorker],
  );
  const officeTotalSso = useMemo(
    () => filteredOffice.reduce((sum, { sso }) => sum + sso, 0),
    [filteredOffice],
  );
  const executiveTotalSso = useMemo(
    () => filteredExecutive.reduce((sum, { sso }) => sum + sso, 0),
    [filteredExecutive],
  );

  const grandTotal = workerTotalSso + officeTotalSso + executiveTotalSso;
  const filteredRowCount = filteredWorker.length + filteredOffice.length + filteredExecutive.length;
  const allRowCount = workerRows.length + officeRows.length + executiveRows.length;

  const runSocialSecurityPayrollListPrint = useCallback(
    async (scope: 'filtered' | 'all') => {
      const workers = scope === 'filtered' ? filteredWorker : workerRows;
      const offices = scope === 'filtered' ? filteredOffice : officeRows;
      const executives = scope === 'filtered' ? filteredExecutive : executiveRows;
      const sourceRows = buildSocialSecurityPrintRows(workers, offices, executives);

      if (sourceRows.length === 0) {
        toast({
          variant: 'destructive',
          title: 'ไม่มีรายการให้พิมพ์',
          description:
            scope === 'filtered'
              ? 'ไม่พบข้อมูลตามตัวกรอง — ปรับตัวกรองหรือเลือกพิมพ์ทั้งหมด'
              : 'ยังไม่มีรายการสมทบประกันสังคมในระบบ',
        });
        return;
      }

      setPrintBusy(true);
      try {
        const { rows, truncated } = capSocialSecurityPayrollListPrintRows(sourceRows);
        const workerTotal = workers.reduce((sum, { sso }) => sum + sso, 0);
        const officeTotal = offices.reduce((sum, { sso }) => sum + sso, 0);
        const executiveTotal = executives.reduce((sum, { sso }) => sum + sso, 0);
        const generatedAt = new Date().toLocaleString('th-TH', {
          dateStyle: 'medium',
          timeStyle: 'short',
        });
        const filterLines = scope === 'filtered' ? describeSocialSecurityPrintFilters(q, monthFilter) : [];
        const scopeTitle =
          scope === 'filtered' ? 'พิมพ์ตามตัวกรองปัจจุบัน' : 'พิมพ์ทั้งหมด (ในชุดข้อมูลล่าสุด)';

        const body = buildSocialSecurityPayrollListPrintHtml({
          rows,
          scopeTitle,
          filterLines,
          grandTotalLabel: fmtBaht(workerTotal + officeTotal + executiveTotal),
          workerTotalLabel: fmtBaht(workerTotal),
          officeTotalLabel: fmtBaht(officeTotal),
          executiveTotalLabel: fmtBaht(executiveTotal),
          generatedAt,
          printedBy: currentUser?.displayName,
          truncated,
        });

        const ok = await openStandardPrintWindow({
          windowTitle: 'Social-Security-Payroll-List',
          suggestedFileName: `Social-Security-Payroll-List-${scope === 'filtered' ? 'Filtered' : 'All'}`,
          bodyInnerHtml: body,
          htmlLang: 'th',
        });

        if (!ok) {
          toast({
            variant: 'destructive',
            title: 'เปิดหน้าต่างพิมพ์ไม่ได้',
            description: 'กรุณาอนุญาตป๊อปอัปสำหรับเว็บไซต์นี้',
          });
          return;
        }
        setPrintDialogOpen(false);
      } finally {
        setPrintBusy(false);
      }
    },
    [
      filteredWorker,
      filteredOffice,
      filteredExecutive,
      workerRows,
      officeRows,
      executiveRows,
      q,
      monthFilter,
      currentUser?.displayName,
      toast,
    ],
  );

  if (isLoading || !currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  const user = currentUser as User;
  /** เปิดให้ทั้ง accounting (เดิม) และทีม payroll (hr_manager · operations_manager · payroll_officer) — เห็นเมนูจาก HR ได้ */
  const canSeePage =
    canSeeAccountingPillarUi(user, profile)
    || canViewHrPayrollFlowSubsection(user, profile, isSystemAdmin(user));
  if (!canSeePage) {
    return (
      <AppShell user={user} onLogout={() => {}}>
        <div className="max-w-3xl mx-auto py-16 text-center text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงเมนูนี้</div>
      </AppShell>
    );
  }

  const listLoadErr = batchesErr || runsErr || executiveRunsErr;

  return (
    <AppShell user={user} onLogout={() => {}}>
      <div className="max-w-6xl mx-auto space-y-6 py-6 px-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ShieldCheck className="h-7 w-7 shrink-0 text-primary" />
            3. จ่ายประกันสังคม (รายเงินสมทบลูกจ้าง)
          </h1>
          <p className="text-muted-foreground mt-1">
            สรุปยอดเงินสมทบประกันสังคมฝั่งลูกจ้างที่ระบบหักไว้ในแต่ละงวด — ลูกจ้าง / ออฟฟิศ / ผู้บริหาร — ใช้นำส่ง สปส.
            (สปส.1-10) คนละชุดกับภาษี ภงด.1
          </p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">ค้นหาและกรองเดือน</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-xs text-muted-foreground mb-3">
              กรองเดือนใช้งวดเงินเดือน (period month) ไม่ใช่วันที่จ่าย — สอดคล้องการนำส่ง สปส.1-10
            </p>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <div className="relative min-w-0 flex-1 basis-full sm:basis-auto sm:min-w-[14rem] sm:max-w-md">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-10 pl-9"
                    placeholder="พิมพ์คำค้น..."
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    aria-label="ค้นหารายการประกันสังคม"
                  />
                </div>
                <Select value={monthFilter} onValueChange={setMonthFilter}>
                  <SelectTrigger
                    id="sso-month-filter"
                    className="h-10 w-[min(100%,13rem)] shrink-0 bg-background"
                    aria-label="กรองตามงวดเงินเดือน"
                  >
                    <SelectValue placeholder="เลือกเดือน" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">ทุกเดือน</SelectItem>
                    {monthOptions.map((ym) => (
                      <SelectItem key={ym} value={ym}>
                        {ymLabelTh(ym)} ({ym})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 shrink-0 gap-2 whitespace-nowrap"
                  onClick={() => setPrintDialogOpen(true)}
                >
                  <Printer className="h-4 w-4 shrink-0" />
                  พิมพ์รายการ
                </Button>
                {!loadingBatches && !loadingRuns && !loadingExecutiveRuns && !loadingWorkerLines && !loadingOfficeLines && !loadingExecutiveLines ? (
                  <div className="rounded-md border border-primary/30 bg-primary/5 px-4 py-2 min-w-[11rem]">
                    <p className="text-[10px] font-medium text-muted-foreground whitespace-nowrap">รวมทั้ง 3 หมวด</p>
                    <p className="text-lg font-bold tabular-nums tracking-tight text-primary">{fmtBaht(grandTotal)}</p>
                  </div>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>

        <Dialog open={printDialogOpen} onOpenChange={setPrintDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>พิมพ์รายการประกันสังคม</DialogTitle>
              <DialogDescription>
                รวมลูกจ้าง ออฟฟิศ และผู้บริหาร — สูงสุด 500 รายการต่อครั้ง
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="rounded-md border bg-muted/30 p-3 space-y-1">
                <p className="font-semibold text-xs uppercase text-muted-foreground">ตัวกรองปัจจุบัน</p>
                <ul className="list-disc list-inside text-xs text-muted-foreground">
                  {describeSocialSecurityPrintFilters(q, monthFilter).length > 0 ? (
                    describeSocialSecurityPrintFilters(q, monthFilter).map((line) => (
                      <li key={line}>{line}</li>
                    ))
                  ) : (
                    <li>ทุกเดือน — ไม่มีคำค้น</li>
                  )}
                </ul>
                <p className="text-xs font-medium pt-1">จะพิมพ์ {filteredRowCount} รายการ</p>
              </div>
              <p className="text-xs text-muted-foreground">
                ข้อมูลทั้งหมด: {allRowCount} รายการ · สมทบรวม {fmtBaht(
                  workerRows.reduce((s, r) => s + r.sso, 0) +
                    officeRows.reduce((s, r) => s + r.sso, 0) +
                    executiveRows.reduce((s, r) => s + r.sso, 0),
                )}
              </p>
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                disabled={printBusy || filteredRowCount === 0}
                onClick={() => void runSocialSecurityPayrollListPrint('filtered')}
              >
                <Printer className="h-4 w-4 mr-2" />
                พิมพ์ตามตัวกรอง ({filteredRowCount})
              </Button>
              <Button
                type="button"
                className="w-full sm:w-auto"
                disabled={printBusy || allRowCount === 0}
                onClick={() => void runSocialSecurityPayrollListPrint('all')}
              >
                <Printer className="h-4 w-4 mr-2" />
                พิมพ์ทั้งหมด ({allRowCount})
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {listLoadErr ? (
          <p className="text-sm text-destructive">
            โหลดหัวงวดไม่สำเร็จ — {String((listLoadErr as Error)?.message || listLoadErr)}
          </p>
        ) : null}

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1.5">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Users className="h-5 w-5 shrink-0" />
                  ลูกจ้าง / Worker payroll
                </CardTitle>
                <CardDescription>
                  เฉพาะบรรทัดที่มียอดหักประกันสังคมในงวด — กดเปิดเพื่อดูสลิปเงินเดือนของคนนั้น (ดูรายละเอียดประกอบ)
                </CardDescription>
              </div>
              {!loadingBatches && !loadingWorkerLines && !workerLinesErr ? (
                <div className="rounded-md border border-primary/25 bg-primary/5 px-4 py-3 text-right shadow-sm shrink-0 sm:min-w-[180px]">
                  <p className="text-xs font-medium text-muted-foreground">ยอดสมทบรวม (ในตาราง)</p>
                  <p className="text-xl font-bold tabular-nums tracking-tight text-primary">{fmtBaht(workerTotalSso)}</p>
                </div>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            {workerLinesErr ? (
              <p className="text-sm text-destructive">{workerLinesErr}</p>
            ) : loadingBatches || loadingWorkerLines ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : filteredWorker.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {workerRows.length === 0
                  ? 'ยังไม่มีบรรทัดที่มียอดสมทบประกันสังคมในงวดล่าสุด (หรือยังไม่มีข้อมูลชุดจ่าย)'
                  : 'ไม่พบรายการที่ตรงกับคำค้นหรือเดือนที่เลือก'}
              </p>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>สถานะงวด</TableHead>
                      <TableHead>ชุดจ่าย</TableHead>
                      <TableHead>ผู้มีเงินได้</TableHead>
                      <TableHead>วันที่จ่าย</TableHead>
                      <TableHead className="text-right">ยอดสมทบ</TableHead>
                      <TableHead className="w-[100px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredWorker.map(({ batch, line, sso, paymentYmd }) => {
                      const st = workerBatchStatusBadge(batch.status);
                      return (
                        <TableRow key={`${batch.id}-${line.id}`}>
                          <TableCell>
                            <Badge variant={st.variant === 'default' ? 'default' : 'secondary'}>{st.label}</Badge>
                          </TableCell>
                          <TableCell className="font-mono text-sm">{batch.id}</TableCell>
                          <TableCell className="max-w-[240px]">
                            <div className="truncate font-medium">{line.workerNameSnapshot || '—'}</div>
                            <div className="text-xs text-muted-foreground font-mono">{line.workerId}</div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{paymentYmd}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm">{fmtBaht(sso)}</TableCell>
                          <TableCell>
                            <Link
                              href={`/payroll/batches/${encodeURIComponent(batch.id)}/workers/${encodeURIComponent(line.workerId)}`}
                              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                            >
                              เปิด
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Link>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1.5">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Building2 className="h-5 w-5 shrink-0 text-muted-foreground" />
                  พนักงานออฟฟิศ / Office payroll
                </CardTitle>
                <CardDescription>
                  เฉพาะบรรทัดที่มียอดหักประกันสังคมในงวดเงินเดือนออฟฟิศ — เปิดเพื่อดูสลิปประกอบ
                </CardDescription>
              </div>
              {!loadingRuns && !loadingOfficeLines && !officeLinesErr ? (
                <div className="rounded-md border border-primary/25 bg-primary/5 px-4 py-3 text-right shadow-sm shrink-0 sm:min-w-[180px]">
                  <p className="text-xs font-medium text-muted-foreground">ยอดสมทบรวม (ในตาราง)</p>
                  <p className="text-xl font-bold tabular-nums tracking-tight text-primary">{fmtBaht(officeTotalSso)}</p>
                </div>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            {officeLinesErr ? (
              <p className="text-sm text-destructive">{officeLinesErr}</p>
            ) : loadingRuns || loadingOfficeLines ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : filteredOffice.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {officeRows.length === 0
                  ? 'ยังไม่มีบรรทัดที่มียอดสมทบประกันสังคมในงวดพนักงานออฟฟิศล่าสุด'
                  : 'ไม่พบรายการที่ตรงกับคำค้นหรือเดือนที่เลือก'}
              </p>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>สถานะงวด</TableHead>
                      <TableHead>งวด</TableHead>
                      <TableHead>ผู้มีเงินได้</TableHead>
                      <TableHead>วันที่จ่าย</TableHead>
                      <TableHead className="text-right">ยอดสมทบ</TableHead>
                      <TableHead className="w-[100px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOffice.map(({ run, line, sso, paymentYmd }) => {
                      const st = officeRunStatusBadge(run.status);
                      return (
                        <TableRow key={`${run.id}-${line.id}`}>
                          <TableCell>
                            <Badge variant={st.variant === 'default' ? 'default' : 'secondary'}>{st.label}</Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            <div className="font-mono">{run.payrollRunNo || run.id}</div>
                            <div className="text-xs text-muted-foreground">{run.payrollMonth || '—'}</div>
                          </TableCell>
                          <TableCell className="max-w-[240px]">
                            <div className="truncate font-medium">{line.staffName || '—'}</div>
                            <div className="text-xs text-muted-foreground font-mono">{line.staffId}</div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{paymentYmd}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm">{fmtBaht(sso)}</TableCell>
                          <TableCell>
                            <Link
                              href={`/office-payroll/${encodeURIComponent(run.id)}/staff/${encodeURIComponent(line.staffId)}`}
                              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                            >
                              เปิด
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Link>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1.5">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Briefcase className="h-5 w-5 shrink-0 text-muted-foreground" />
                  ผู้บริหาร / Executive payroll
                </CardTitle>
                <CardDescription>
                  เฉพาะบรรทัดที่มียอดหักประกันสังคมในงวดเงินเดือนผู้บริหาร — เปิดเพื่อดูสลิปประกอบ
                </CardDescription>
              </div>
              {!loadingExecutiveRuns && !loadingExecutiveLines && !executiveLinesErr ? (
                <div className="rounded-md border border-primary/25 bg-primary/5 px-4 py-3 text-right shadow-sm shrink-0 sm:min-w-[180px]">
                  <p className="text-xs font-medium text-muted-foreground">ยอดสมทบรวม (ในตาราง)</p>
                  <p className="text-xl font-bold tabular-nums tracking-tight text-primary">{fmtBaht(executiveTotalSso)}</p>
                </div>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            {executiveLinesErr ? (
              <p className="text-sm text-destructive">{executiveLinesErr}</p>
            ) : loadingExecutiveRuns || loadingExecutiveLines ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : filteredExecutive.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {executiveRows.length === 0
                  ? 'ยังไม่มีบรรทัดที่มียอดสมทบประกันสังคมในงวดผู้บริหารล่าสุด'
                  : 'ไม่พบรายการที่ตรงกับคำค้นหรือเดือนที่เลือก'}
              </p>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>สถานะงวด</TableHead>
                      <TableHead>งวด</TableHead>
                      <TableHead>ผู้มีเงินได้</TableHead>
                      <TableHead>วันที่จ่าย</TableHead>
                      <TableHead className="text-right">ยอดสมทบ</TableHead>
                      <TableHead className="w-[100px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredExecutive.map(({ run, line, sso, paymentYmd }) => {
                      const st = officeRunStatusBadge(run.status);
                      return (
                        <TableRow key={`${run.id}-${line.id}`}>
                          <TableCell>
                            <Badge variant={st.variant === 'default' ? 'default' : 'secondary'}>{st.label}</Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            <div className="font-mono">{run.payrollRunNo || run.id}</div>
                            <div className="text-xs text-muted-foreground">{run.payrollMonth || '—'}</div>
                          </TableCell>
                          <TableCell className="max-w-[240px]">
                            <div className="truncate font-medium">{line.staffName || '—'}</div>
                            <div className="text-xs text-muted-foreground font-mono">{line.staffId}</div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{paymentYmd}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm">{fmtBaht(sso)}</TableCell>
                          <TableCell>
                            <Link
                              href={`/accounting/executive-payroll/${encodeURIComponent(run.id)}/staff/${encodeURIComponent(line.staffId)}`}
                              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                            >
                              เปิด
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Link>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
