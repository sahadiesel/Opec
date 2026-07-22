'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { collection, getDocs, orderBy, query, limit, where } from 'firebase/firestore';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PayrollSsoSectionCard } from '@/components/accounting/payroll-sso-section-card';
import { PayrollSsoCombinedPayButton } from '@/components/accounting/payroll-sso-combined-pay';
import { fmtSsoBaht } from '@/components/accounting/payroll-sso-list-table';
import { fmtBaht } from '@/components/accounting/withholding-wht-pay-tax-ui';
import { YearMonthScopeSelects } from '@/components/accounting/year-month-scope-selects';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { Users, Loader2, Search, Building2, Briefcase, ShieldCheck, Printer } from 'lucide-react';
import { formatYmdLocalThaiBE } from '@/lib/date-thai';
import {
  buildYearCeOptions,
  currentMonthMm,
  currentYearCe,
  describeYearMonthScopeFilter,
  ymMatchesYearMonthScope,
} from '@/lib/date/year-month-scope-filter';
import type { User, PayrollBatch, PayrollBatchLine, OfficePayrollRun, OfficePayrollLine, BankAccount, Worker, OfficeStaff, ExecutivePayrollStaff } from '@/lib/types';
import { canSeeAccountingPillarUi, canExecuteBankCashbookPayments } from '@/lib/permissions';
import { canViewHrPayrollFlowSubsection } from '@/lib/navigation/nav-access';
import { isSystemAdmin } from '@/lib/permission-core';
import { usePermissions } from '@/hooks/use-permissions';
import { resolvePayrollWorkerWhtPaymentDateYmd } from '@/lib/payroll/payroll-worker-wht-model';
import { resolveOfficePayrollWhtPaymentDateYmd } from '@/lib/payroll/payroll-office-wht-model';
import {
  employerContribStatusLabel,
  isOfficeEmployerContribPaid,
  isOfficePayrollWagePaid,
  isOfficeSsoRemitPaid,
  isWorkerEmployerContribPaid,
  isWorkerPayrollWagePaid,
  isWorkerSsoRemitPaid,
  officeWageStatusLabel,
  ssoCombinedRemitAmount,
  ssoRemitStatusLabel,
  workerWageStatusLabel,
} from '@/lib/payroll/payroll-sso-payment-model';
import { useToast } from '@/hooks/use-toast';
import {
  buildSocialSecurityPayrollListPrintHtml,
  capSocialSecurityPayrollListPrintRows,
  type SocialSecurityPayrollListPrintRow,
} from '@/lib/documents/social-security-payroll-list-print';
import { openStandardPrintWindow } from '@/lib/documents/standard-document-print';
import { roundSocialSecurityBahtUp } from '@/lib/payroll/d8/deductions-from-policy';
import {
  type WorkerSsoRow,
  type OfficeSsoRow,
  type ExecutiveSsoRow,
  workerRowsToSsoTable,
  officeRowsToSsoTable,
  executiveRowsToSsoTableFixed,
  workerLineGrossPayAmount,
  officeLineGrossPayAmount,
  resolveWorkerNationalId,
  resolveStaffNationalId,
} from '@/app/accounting/social-security-payroll/sso-section-utils';

export type { WorkerSsoRow, OfficeSsoRow, ExecutiveSsoRow };

function workerLineSsoAmount(line: PayrollBatchLine): number {
  const db = line.deductionsBreakdown || {};
  const snap = line.d8Snapshot?.deductions || {};
  const v = Number(db.social_security ?? snap.social_security ?? 0);
  return roundSocialSecurityBahtUp(Number.isFinite(v) ? v : 0);
}

function officeLineSsoAmount(line: OfficePayrollLine): number {
  return roundSocialSecurityBahtUp(Number(line.socialSecurity) || 0);
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

function describeSocialSecurityPrintFilters(
  searchTerm: string,
  yearCe: number,
  monthScope: string,
): string[] {
  const lines: string[] = [];
  lines.push(`งวดเงินเดือน: ${describeYearMonthScopeFilter(yearCe, monthScope)}`);
  if (searchTerm.trim()) {
    lines.push(`ค้นหา: "${searchTerm.trim()}"`);
  }
  return lines;
}

function buildSocialSecurityPrintRows(
  workers: WorkerSsoRow[],
  offices: OfficeSsoRow[],
  executives: ExecutiveSsoRow[],
  nationalIdByWorkerId?: ReadonlyMap<string, string>,
  nationalIdByOfficeStaffId?: ReadonlyMap<string, string>,
  nationalIdByExecutiveStaffId?: ReadonlyMap<string, string>,
): SocialSecurityPayrollListPrintRow[] {
  const rows: SocialSecurityPayrollListPrintRow[] = [];
  for (const { batch, line, sso, paymentYmd } of workers) {
    const wagePaid = isWorkerPayrollWagePaid(batch, line);
    rows.push({
      section: 'ลูกจ้าง',
      wageStatus: workerWageStatusLabel(batch.status),
      ssoStatus: ssoRemitStatusLabel(wagePaid, isWorkerSsoRemitPaid(line)),
      employerStatus: employerContribStatusLabel(wagePaid, isWorkerEmployerContribPaid(line)),
      batchLabel: batch.id,
      earnerName: line.workerNameSnapshot || '—',
      earnerId: resolveWorkerNationalId(line, nationalIdByWorkerId),
      paymentDate: formatYmdLocalThaiBE(paymentYmd),
      paidLabel: fmtBaht(workerLineGrossPayAmount(line)),
      ssoLabel: fmtSsoBaht(sso),
      employerLabel: fmtSsoBaht(ssoCombinedRemitAmount(sso)),
    });
  }
  for (const { run, line, sso, paymentYmd } of offices) {
    const wagePaid = isOfficePayrollWagePaid(run, line);
    rows.push({
      section: 'ออฟฟิศ',
      wageStatus: officeWageStatusLabel(run.status),
      ssoStatus: ssoRemitStatusLabel(wagePaid, isOfficeSsoRemitPaid(line)),
      employerStatus: employerContribStatusLabel(wagePaid, isOfficeEmployerContribPaid(line)),
      batchLabel: run.payrollRunNo || run.id,
      earnerName: line.staffName || '—',
      earnerId: resolveStaffNationalId(line.staffId, nationalIdByOfficeStaffId),
      paymentDate: formatYmdLocalThaiBE(paymentYmd),
      paidLabel: fmtBaht(officeLineGrossPayAmount(line)),
      ssoLabel: fmtSsoBaht(sso),
      employerLabel: fmtSsoBaht(ssoCombinedRemitAmount(sso)),
    });
  }
  for (const { run, line, sso, paymentYmd } of executives) {
    const wagePaid = isOfficePayrollWagePaid(run, line);
    rows.push({
      section: 'ผู้บริหาร',
      wageStatus: officeWageStatusLabel(run.status),
      ssoStatus: ssoRemitStatusLabel(wagePaid, isOfficeSsoRemitPaid(line)),
      employerStatus: employerContribStatusLabel(wagePaid, isOfficeEmployerContribPaid(line)),
      batchLabel: run.payrollRunNo || run.id,
      earnerName: line.staffName || '—',
      earnerId: resolveStaffNationalId(line.staffId, nationalIdByExecutiveStaffId),
      paymentDate: formatYmdLocalThaiBE(paymentYmd),
      paidLabel: fmtBaht(officeLineGrossPayAmount(line)),
      ssoLabel: fmtSsoBaht(sso),
      employerLabel: fmtSsoBaht(ssoCombinedRemitAmount(sso)),
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
  const [yearFilterCe, setYearFilterCe] = useState(() => currentYearCe());
  const [monthScope, setMonthScope] = useState(() => currentMonthMm());
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

  const canPaySso = useMemo(() => canExecuteBankCashbookPayments(currentUser), [currentUser]);

  const bankAccountsQuery = useMemoFirebase(
    () =>
      firestore && canPaySso
        ? query(collection(firestore, 'bank_accounts'), where('status', '==', 'ACTIVE'))
        : null,
    [firestore, canPaySso],
  );
  const { data: bankAccounts } = useCollection<BankAccount>(bankAccountsQuery as any);
  const operatingBankOptions = useMemo(() => {
    const list = (bankAccounts ?? []).filter((a) => String(a.accountType) !== 'PETTY_CASH');
    list.sort((a, b) => (a.accountCode || '').localeCompare(b.accountCode || '', 'th', { numeric: true }));
    return list;
  }, [bankAccounts]);

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

  const workersQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return collection(firestore, 'workers');
  }, [firestore]);

  const officeStaffQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return collection(firestore, 'office_staff');
  }, [firestore]);

  const executiveStaffQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return collection(firestore, 'executive_payroll_staff');
  }, [firestore]);

  const { data: workerRegistry } = useCollection<Worker>(workersQuery as any);
  const { data: officeStaffRegistry } = useCollection<OfficeStaff>(officeStaffQuery as any);
  const { data: executiveStaffRegistry } = useCollection<ExecutivePayrollStaff>(executiveStaffQuery as any);

  const nationalIdByWorkerId = useMemo(() => {
    const map = new Map<string, string>();
    for (const worker of workerRegistry ?? []) {
      const id = worker.thaiNationalId?.trim();
      if (id) map.set(worker.id, id);
    }
    return map;
  }, [workerRegistry]);

  const nationalIdByOfficeStaffId = useMemo(() => {
    const map = new Map<string, string>();
    for (const staff of officeStaffRegistry ?? []) {
      const id = staff.nationalId?.trim();
      if (id) map.set(staff.id, id);
    }
    return map;
  }, [officeStaffRegistry]);

  const nationalIdByExecutiveStaffId = useMemo(() => {
    const map = new Map<string, string>();
    for (const staff of executiveStaffRegistry ?? []) {
      let id = staff.nationalId?.trim();
      if (!id && staff.linkedOfficeStaffId) {
        id = nationalIdByOfficeStaffId.get(staff.linkedOfficeStaffId)?.trim();
      }
      if (id) map.set(staff.id, id);
    }
    return map;
  }, [executiveStaffRegistry, nationalIdByOfficeStaffId]);

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

  const yearOptionsCe = useMemo(() => buildYearCeOptions(monthOptions), [monthOptions]);

  const workerRowsBySearch = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return workerRows;
    return workerRows.filter(({ batch, line, paymentYmd }) => {
      const name = (line.workerNameSnapshot || '').toLowerCase();
      const bid = batch.id.toLowerCase();
      const lid = line.id.toLowerCase();
      const wid = line.workerId.toLowerCase();
      const nid = (nationalIdByWorkerId.get(line.workerId) || '').toLowerCase();
      return name.includes(t) || bid.includes(t) || lid.includes(t) || wid.includes(t) || nid.includes(t) || paymentYmd.includes(t);
    });
  }, [workerRows, q, nationalIdByWorkerId]);

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
      const nid = (nationalIdByOfficeStaffId.get(line.staffId) || '').toLowerCase();
      return name.includes(t) || rn.includes(t) || rid.includes(t) || lid.includes(t) || sid.includes(t) || ym.includes(t) || nid.includes(t) || paymentYmd.includes(t);
    });
  }, [officeRows, q, nationalIdByOfficeStaffId]);

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
      const nid = (nationalIdByExecutiveStaffId.get(line.staffId) || '').toLowerCase();
      return name.includes(t) || rn.includes(t) || rid.includes(t) || lid.includes(t) || sid.includes(t) || ym.includes(t) || nid.includes(t) || paymentYmd.includes(t);
    });
  }, [executiveRows, q, nationalIdByExecutiveStaffId]);

  const filteredWorker = useMemo(() => {
    return workerRowsBySearch.filter((r) => ymMatchesYearMonthScope(workerRowYm(r), yearFilterCe, monthScope));
  }, [workerRowsBySearch, yearFilterCe, monthScope]);

  const filteredOffice = useMemo(() => {
    return officeRowsBySearch.filter((r) => ymMatchesYearMonthScope(officeRowYm(r), yearFilterCe, monthScope));
  }, [officeRowsBySearch, yearFilterCe, monthScope]);

  const filteredExecutive = useMemo(() => {
    return executiveRowsBySearch.filter((r) => ymMatchesYearMonthScope(executiveRowYm(r), yearFilterCe, monthScope));
  }, [executiveRowsBySearch, yearFilterCe, monthScope]);

  const workerTotalSso = useMemo(
    () => filteredWorker.reduce((sum, { sso }) => sum + ssoCombinedRemitAmount(sso), 0),
    [filteredWorker],
  );
  const officeTotalSso = useMemo(
    () => filteredOffice.reduce((sum, { sso }) => sum + ssoCombinedRemitAmount(sso), 0),
    [filteredOffice],
  );
  const executiveTotalSso = useMemo(
    () => filteredExecutive.reduce((sum, { sso }) => sum + ssoCombinedRemitAmount(sso), 0),
    [filteredExecutive],
  );

  const grandTotal = workerTotalSso + officeTotalSso + executiveTotalSso;
  const filteredRowCount = filteredWorker.length + filteredOffice.length + filteredExecutive.length;
  const allRowCount = workerRows.length + officeRows.length + executiveRows.length;
  const ssoDataLoading =
    loadingBatches
    || loadingRuns
    || loadingExecutiveRuns
    || loadingWorkerLines
    || loadingOfficeLines
    || loadingExecutiveLines;

  const workerTableRows = useMemo(
    () => workerRowsToSsoTable(filteredWorker, nationalIdByWorkerId),
    [filteredWorker, nationalIdByWorkerId],
  );
  const officeTableRows = useMemo(
    () =>
      officeRowsToSsoTable(
        filteredOffice,
        (runId, staffId) => `/office-payroll/${encodeURIComponent(runId)}/staff/${encodeURIComponent(staffId)}`,
        nationalIdByOfficeStaffId,
      ),
    [filteredOffice, nationalIdByOfficeStaffId],
  );
  const executiveTableRows = useMemo(
    () => executiveRowsToSsoTableFixed(filteredExecutive, nationalIdByExecutiveStaffId),
    [filteredExecutive, nationalIdByExecutiveStaffId],
  );

  const runSocialSecurityPayrollListPrint = useCallback(
    async (scope: 'filtered' | 'all') => {
      const workers = scope === 'filtered' ? filteredWorker : workerRows;
      const offices = scope === 'filtered' ? filteredOffice : officeRows;
      const executives = scope === 'filtered' ? filteredExecutive : executiveRows;
      const sourceRows = buildSocialSecurityPrintRows(
        workers,
        offices,
        executives,
        nationalIdByWorkerId,
        nationalIdByOfficeStaffId,
        nationalIdByExecutiveStaffId,
      );

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
        const workerTotal = workers.reduce((sum, { sso }) => sum + ssoCombinedRemitAmount(sso), 0);
        const officeTotal = offices.reduce((sum, { sso }) => sum + ssoCombinedRemitAmount(sso), 0);
        const executiveTotal = executives.reduce((sum, { sso }) => sum + ssoCombinedRemitAmount(sso), 0);
        const generatedAt = new Date().toLocaleString('th-TH', {
          dateStyle: 'medium',
          timeStyle: 'short',
        });
        const filterLines = scope === 'filtered' ? describeSocialSecurityPrintFilters(q, yearFilterCe, monthScope) : [];
        const scopeTitle =
          scope === 'filtered' ? 'พิมพ์ตามตัวกรองปัจจุบัน' : 'พิมพ์ทั้งหมด (ในชุดข้อมูลล่าสุด)';

        const body = buildSocialSecurityPayrollListPrintHtml({
          rows,
          scopeTitle,
          filterLines,
          grandTotalLabel: fmtSsoBaht(workerTotal + officeTotal + executiveTotal),
          workerTotalLabel: fmtSsoBaht(workerTotal),
          officeTotalLabel: fmtSsoBaht(officeTotal),
          executiveTotalLabel: fmtSsoBaht(executiveTotal),
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
      yearFilterCe,
      monthScope,
      currentUser?.displayName,
      toast,
      nationalIdByWorkerId,
      nationalIdByOfficeStaffId,
      nationalIdByExecutiveStaffId,
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

  const listLoadErr = batchesErr;
  const officeLoadErr = runsErr || officeLinesErr;
  const executiveLoadErr = executiveRunsErr || executiveLinesErr;

  const formatLoadErr = (err: unknown) =>
    err ? String((err as Error)?.message || err) : null;

  return (
    <AppShell user={user} onLogout={() => {}}>
      <div className="w-full max-w-[min(100%,96rem)] mx-auto space-y-6 py-6">
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
                    placeholder="พิมพ์คำค้น (ชื่อ, เลขบัตร, ชุดจ่าย)..."
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    aria-label="ค้นหารายการประกันสังคม"
                  />
                </div>
                <YearMonthScopeSelects
                  idPrefix="sso"
                  yearCe={yearFilterCe}
                  monthScope={monthScope}
                  yearOptionsCe={yearOptionsCe}
                  onYearCeChange={setYearFilterCe}
                  onMonthScopeChange={setMonthScope}
                />
              </div>
              <div className="flex flex-wrap items-end gap-2 shrink-0 ml-auto justify-end">
                <PayrollSsoCombinedPayButton
                  canPay={canPaySso}
                  loading={ssoDataLoading}
                  firestore={firestore}
                  currentUser={user}
                  operatingBankOptions={operatingBankOptions}
                  workerTableRows={workerTableRows}
                  officeTableRows={officeTableRows}
                  executiveTableRows={executiveTableRows}
                  workerRows={workerRows}
                  officeRows={officeRows}
                  executiveRows={executiveRows}
                  onWorkerRowsChange={setWorkerRows}
                  onOfficeRowsChange={setOfficeRows}
                  onExecutiveRowsChange={setExecutiveRows}
                />
                {!ssoDataLoading ? (
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <p className="text-xs font-medium text-muted-foreground whitespace-nowrap">รวม ปกส.+สมทบ (3 หมวด)</p>
                    <div className="flex h-10 min-w-[11rem] items-center justify-end rounded-md border border-primary/30 bg-primary/5 px-4">
                      <p className="text-lg font-bold tabular-nums tracking-tight text-primary">{fmtSsoBaht(grandTotal)}</p>
                    </div>
                  </div>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 shrink-0 gap-2 whitespace-nowrap"
                  onClick={() => setPrintDialogOpen(true)}
                >
                  <Printer className="h-4 w-4 shrink-0" />
                  พิมพ์รายการ
                </Button>
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
                  {describeSocialSecurityPrintFilters(q, yearFilterCe, monthScope).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <p className="text-xs font-medium pt-1">จะพิมพ์ {filteredRowCount} รายการ</p>
              </div>
              <p className="text-xs text-muted-foreground">
                ข้อมูลทั้งหมด: {allRowCount} รายการ · สมทบรวม {fmtSsoBaht(
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


        <PayrollSsoSectionCard
          title="ลูกจ้าง / Worker payroll"
          description="เฉพาะบรรทัดที่มียอดหักประกันสังคมในงวด — กดเปิดเพื่อดูสลิปเงินเดือนของคนนั้น"
          icon={<Users className="h-5 w-5 shrink-0" />}
          loading={loadingBatches || loadingWorkerLines}
          error={workerLinesErr}
          emptyFiltered={
            workerRows.length === 0
              ? 'ยังไม่มีบรรทัดที่มียอดสมทบประกันสังคมในงวดล่าสุด (หรือยังไม่มีข้อมูลชุดจ่าย)'
              : 'ไม่พบรายการที่ตรงกับคำค้นหหรือเดือนที่เลือก'
          }
          emptyAll=""
          tableRows={workerTableRows}
          totalSsoLabel={fmtSsoBaht(workerTotalSso)}
          canPay={canPaySso}
          firestore={firestore}
          currentUser={user}
          operatingBankOptions={operatingBankOptions}
          sectionKind="worker"
          workerRows={workerRows}
          onWorkerRowsChange={setWorkerRows}
        />

        <PayrollSsoSectionCard
          title="พนักงานออฟฟิศ / Office payroll"
          description="เฉพาะบรรทัดที่มียอดหักประกันสังคมในงวดเงินเดือนออฟฟิศ — เปิดเพื่อดูสลิปประกอบ"
          icon={<Building2 className="h-5 w-5 shrink-0 text-muted-foreground" />}
          loading={loadingRuns || loadingOfficeLines}
          error={formatLoadErr(officeLoadErr)}
          emptyFiltered={
            officeRows.length === 0
              ? 'ยังไม่มีบรรทัดที่มียอดสมทบประกันสังคมในงวดพนักงานออฟฟิศล่าสุด'
              : 'ไม่พบรายการที่ตรงกับคำค้นหหรือเดือนที่เลือก'
          }
          emptyAll=""
          tableRows={officeTableRows}
          totalSsoLabel={fmtSsoBaht(officeTotalSso)}
          canPay={canPaySso}
          firestore={firestore}
          currentUser={user}
          operatingBankOptions={operatingBankOptions}
          sectionKind="office"
          officeRows={officeRows}
          onOfficeRowsChange={setOfficeRows}
        />

        <PayrollSsoSectionCard
          title="ผู้บริหาร / Executive payroll"
          description="เฉพาะบรรทัดที่มียอดหักประกันสังคมในงวดเงินเดือนผู้บริหาร — เปิดเพื่อดูสลิปประกอบ"
          icon={<Briefcase className="h-5 w-5 shrink-0 text-muted-foreground" />}
          loading={loadingExecutiveRuns || loadingExecutiveLines}
          error={formatLoadErr(executiveLoadErr)}
          emptyFiltered={
            executiveRows.length === 0
              ? 'ยังไม่มีบรรทัดที่มียอดสมทบประกันสังคมในงวดผู้บริหารล่าสุด'
              : 'ไม่พบรายการที่ตรงกับคำค้นหหรือเดือนที่เลือก'
          }
          emptyAll=""
          tableRows={executiveTableRows}
          totalSsoLabel={fmtSsoBaht(executiveTotalSso)}
          canPay={canPaySso}
          firestore={firestore}
          currentUser={user}
          operatingBankOptions={operatingBankOptions}
          sectionKind="executive"
          executiveRows={executiveRows}
          onExecutiveRowsChange={setExecutiveRows}
        />
      </div>
    </AppShell>
  );
}
