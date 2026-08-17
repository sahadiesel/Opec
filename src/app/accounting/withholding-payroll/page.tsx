'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { collection, getDocs, orderBy, query, limit, where } from 'firebase/firestore';
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
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { formatPayrollYearMonthMmYyyyThaiBE, formatYmdLocalThaiBE } from '@/lib/date-thai';
import {
  buildYearCeOptions,
  currentMonthMm,
  currentYearCe,
  describeYearMonthScopeFilter,
  isMonthScopeLookback,
  ymMatchesYearMonthScope,
} from '@/lib/date/year-month-scope-filter';
import {
  annotatePersonMonthGroups,
  resolveSharedMonthlyWithholdSum,
} from '@/lib/payroll/payroll-person-month-group';
import { YearMonthScopeSelects } from '@/components/accounting/year-month-scope-selects';
import {
  AccountingFilterToolbar,
  AccountingFilterToolbarAction,
  AccountingFilterToolbarStat,
} from '@/components/accounting/accounting-filter-toolbar';
import { useFirestore, useCollection, useMemoFirebase, useFirebaseApp } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { Users, ExternalLink, Loader2, Search, Building2, Printer, Banknote, Paperclip, Briefcase } from 'lucide-react';
import type {
  User,
  PayrollBatch,
  PayrollBatchLine,
  OfficePayrollRun,
  OfficePayrollLine,
  BankAccount,
  WhtTaxPaymentProofAttachment,
  Worker,
  OfficeStaff,
  ExecutivePayrollStaff,
} from '@/lib/types';
import {
  resolveWorkerNationalId,
  resolveStaffNationalId,
} from '@/app/accounting/social-security-payroll/sso-section-utils';
import { canSeeAccountingPillarUi, canExecuteBankCashbookPayments } from '@/lib/permissions';
import { canViewHrPayrollFlowSubsection } from '@/lib/navigation/nav-access';
import { isSystemAdmin } from '@/lib/permission-core';
import { isSimpleAdmin } from '@/lib/simple-tier-model';
import { usePermissions } from '@/hooks/use-permissions';
import { workerPayrollLinePitAmount, resolvePayrollWorkerWhtPaymentDateYmd } from '@/lib/payroll/payroll-worker-wht-model';
import { officePayrollLineTaxAmount, resolveOfficePayrollWhtPaymentDateYmd } from '@/lib/payroll/payroll-office-wht-model';
import { useToast } from '@/hooks/use-toast';
import {
  buildWithholdingPayrollListPrintHtml,
  capWithholdingPayrollListPrintRows,
  type WithholdingPayrollListPrintRow,
} from '@/lib/documents/withholding-payroll-list-print';
import { openStandardPrintWindow } from '@/lib/documents/standard-document-print';
import {
  isOfficePayrollWagePaid,
  isOfficePayrollWhtTaxPaid,
  isWorkerPayrollWagePaid,
  isWorkerPayrollWhtTaxPaid,
  officeWageStatusLabel,
  whtTaxStatusLabel,
  workerWageStatusLabel,
} from '@/lib/payroll/payroll-wht-tax-payment-model';
import {
  markExecutivePayrollWhtTaxPaidWithoutCashbook,
  markOfficePayrollWhtTaxPaidWithoutCashbook,
  markWorkerPayrollWhtTaxPaidWithoutCashbook,
  recordExecutivePayrollWhtTaxPayment,
  recordOfficePayrollWhtTaxPayment,
  recordWorkerPayrollWhtTaxPayment,
} from '@/lib/services/payroll-wht-tax-payment-service';
import { uploadPayrollWhtTaxPaymentProof } from '@/lib/storage/payroll-wht-tax-payment-proofs';

type WorkerWhtRow = { batch: PayrollBatch; line: PayrollBatchLine; pit: number; paid: number; paymentYmd: string };

type OfficeWhtRow = { run: OfficePayrollRun; line: OfficePayrollLine; tax: number; paid: number; paymentYmd: string };

/** ผู้บริหาร — โครงบรรทัดเดียวกับงวดออฟฟิศ (executive_payroll_runs ใช้สคีมาเดียวกัน) */
type ExecutiveWhtRow = OfficeWhtRow;

function fmtBaht(n: number): string {
  return `฿${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function mergeUniqueProofAttachments(
  fromRows: WhtTaxPaymentProofAttachment[],
  session: WhtTaxPaymentProofAttachment[],
): WhtTaxPaymentProofAttachment[] {
  const map = new Map<string, WhtTaxPaymentProofAttachment>();
  for (const a of fromRows) map.set(a.id, a);
  for (const a of session) map.set(a.id, a);
  return Array.from(map.values()).sort((a, b) => b.uploadedAt - a.uploadedAt);
}

function ProofAttachmentZone({
  attachments,
  onRemove,
  removableIds,
}: {
  attachments: WhtTaxPaymentProofAttachment[];
  onRemove?: (id: string) => void;
  removableIds?: Set<string>;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="rounded-md border border-amber-300/80 bg-amber-50/90 px-3 py-2.5 dark:border-amber-700/60 dark:bg-amber-950/30">
      <p className="text-xs font-semibold text-amber-900 dark:text-amber-100 mb-2">
        เอกสารแนบการโอน (ภงด.) — ตามเดือนที่เลือก
      </p>
      <ul className="space-y-1.5">
        {attachments.map((a) => (
          <li key={a.id} className="flex items-center gap-2 min-w-0 text-sm">
            <Paperclip className="h-3.5 w-3.5 shrink-0 text-amber-800 dark:text-amber-200" />
            <a
              href={a.downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 flex-1 truncate text-primary hover:underline"
              title={a.fileName}
            >
              {a.fileName}
            </a>
            {onRemove && removableIds?.has(a.id) ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 px-2 text-xs"
                onClick={() => onRemove(a.id)}
              >
                ลบ
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** เดือนอ้างอิงสำหรับไฟล์แนบรอบนี้ — ถ้าเลือกเดือนเจาะจงใช้ปี+เดือนนั้น ไม่งั้นใช้เดือนปัจจุบัน */
function resolveSessionProofPeriodYm(yearCe: number, monthScope: string): string {
  if (!isMonthScopeLookback(monthScope) && /^\d{2}$/.test(monthScope)) {
    return `${yearCe}-${monthScope}`;
  }
  return `${currentYearCe()}-${currentMonthMm()}`;
}

/** ติด periodYm ให้ไฟล์แนบที่ยังไม่มี — อิงเดือนของบรรทัดที่จ่าย */
function withPeriodYm(
  attachments: WhtTaxPaymentProofAttachment[],
  periodYm: string | null,
): WhtTaxPaymentProofAttachment[] {
  if (!periodYm) return attachments;
  return attachments.map((a) => (a.periodYm ? a : { ...a, periodYm }));
}

function workerPayrollLinePaidAmount(line: PayrollBatchLine): number {
  return Number(line.netAmount) || 0;
}

function officePayrollLinePaidAmount(line: OfficePayrollLine): number {
  return Number(line.netPay) || 0;
}

const WHT_BATCH_COL_WIDTH = '11%';
const WHT_NAME_COL_WIDTH = '15%';
const WHT_DATE_COL_WIDTH = '8%';
/** 5 equal columns: ยอดจ่าย → เปิด */
const WHT_EQUAL_FIVE_COL_WIDTH = '13%';

const WHT_EQUAL_COL_HEAD =
  'px-2 py-2 text-xs font-medium leading-snug align-middle whitespace-normal break-words';
const WHT_EQUAL_COL_CELL = 'px-2 py-3 align-middle max-w-0';

const WHT_PAYROLL_TABLE_COLGROUP = (showSelect: boolean) => (
  <colgroup>
    {showSelect ? <col style={{ width: 44 }} /> : null}
    <col style={{ width: WHT_BATCH_COL_WIDTH }} />
    <col style={{ width: WHT_NAME_COL_WIDTH }} />
    <col style={{ width: WHT_DATE_COL_WIDTH }} />
    <col style={{ width: WHT_EQUAL_FIVE_COL_WIDTH }} />
    <col style={{ width: WHT_EQUAL_FIVE_COL_WIDTH }} />
    <col style={{ width: WHT_EQUAL_FIVE_COL_WIDTH }} />
    <col style={{ width: WHT_EQUAL_FIVE_COL_WIDTH }} />
    <col style={{ width: WHT_EQUAL_FIVE_COL_WIDTH }} />
  </colgroup>
);

function workerRowKey(batchId: string, lineId: string): string {
  return `${batchId}::${lineId}`;
}

function officeRowKey(runId: string, lineId: string): string {
  return `${runId}::${lineId}`;
}

/** งวดเงินเดือนสำหรับจัดกลุ่ม ภงด. ต่อคน (ไม่ใช้วันจ่าย — ให้สอดคล้อง ปกส.) */
function workerPeriodYmForGroup(r: WorkerWhtRow): string {
  const end = String(r.line.periodEndDate || '').trim();
  if (/^\d{4}-\d{2}/.test(end)) return end.slice(0, 7);
  const start = String(r.line.periodStartDate || '').trim();
  if (/^\d{4}-\d{2}/.test(start)) return start.slice(0, 7);
  if (r.paymentYmd && /^\d{4}-\d{2}-\d{2}$/.test(r.paymentYmd)) return r.paymentYmd.slice(0, 7);
  return '';
}

function officePeriodYmForGroup(r: OfficeWhtRow): string {
  const pm = String(r.run.payrollMonth || '').trim();
  if (/^\d{4}-\d{2}/.test(pm)) return pm.slice(0, 7);
  if (r.paymentYmd && /^\d{4}-\d{2}-\d{2}$/.test(r.paymentYmd)) return r.paymentYmd.slice(0, 7);
  return '';
}

/** YYYY-MM สำหรับกรองเดือน — อิงวันที่จ่าย ถ้าไม่มีใช้ช่วงงวด/งวดออฟฟิศ */
function workerRowYm(r: WorkerWhtRow): string | null {
  if (r.paymentYmd && /^\d{4}-\d{2}-\d{2}$/.test(r.paymentYmd)) return r.paymentYmd.slice(0, 7);
  const end = r.line.periodEndDate;
  if (end && /^\d{4}-\d{2}/.test(String(end).trim())) return String(end).trim().slice(0, 7);
  const start = r.line.periodStartDate;
  if (start && /^\d{4}-\d{2}/.test(String(start).trim())) return String(start).trim().slice(0, 7);
  return null;
}

function officeRowYm(r: OfficeWhtRow): string | null {
  if (r.paymentYmd && /^\d{4}-\d{2}-\d{2}$/.test(r.paymentYmd)) return r.paymentYmd.slice(0, 7);
  const pm = r.run.payrollMonth;
  if (pm && /^\d{4}-\d{2}/.test(String(pm).trim())) return String(pm).trim().slice(0, 7);
  return null;
}

function buildWithholdingPayrollPrintRows(
  workers: WorkerWhtRow[],
  offices: OfficeWhtRow[],
  executives: ExecutiveWhtRow[],
  nationalIdByWorkerId?: ReadonlyMap<string, string>,
  nationalIdByOfficeStaffId?: ReadonlyMap<string, string>,
  nationalIdByExecutiveStaffId?: ReadonlyMap<string, string>,
): WithholdingPayrollListPrintRow[] {
  const rows: WithholdingPayrollListPrintRow[] = [];
  for (const { batch, line, pit, paid, paymentYmd } of workers) {
    const wagePaid = isWorkerPayrollWagePaid(batch, line);
    rows.push({
      section: 'ลูกจ้าง',
      wageStatus: workerWageStatusLabel(batch.status),
      taxStatus: whtTaxStatusLabel(wagePaid, isWorkerPayrollWhtTaxPaid(line)),
      batchLabel: batch.id,
      earnerName: line.workerNameSnapshot || '—',
      earnerId: resolveWorkerNationalId(line, nationalIdByWorkerId),
      paymentDate: formatYmdLocalThaiBE(paymentYmd),
      paidLabel: fmtBaht(paid),
      amountLabel: fmtBaht(pit),
    });
  }
  for (const { run, line, tax, paid, paymentYmd } of offices) {
    const wagePaid = isOfficePayrollWagePaid(run, line);
    rows.push({
      section: 'ออฟฟิศ',
      wageStatus: officeWageStatusLabel(run.status),
      taxStatus: whtTaxStatusLabel(wagePaid, isOfficePayrollWhtTaxPaid(line)),
      batchLabel: run.payrollRunNo || run.id,
      earnerName: line.staffName || '—',
      earnerId: resolveStaffNationalId(line.staffId, nationalIdByOfficeStaffId),
      paymentDate: formatYmdLocalThaiBE(paymentYmd),
      paidLabel: fmtBaht(paid),
      amountLabel: fmtBaht(tax),
    });
  }
  for (const { run, line, tax, paid, paymentYmd } of executives) {
    const wagePaid = isOfficePayrollWagePaid(run, line);
    rows.push({
      section: 'ผู้บริหาร',
      wageStatus: officeWageStatusLabel(run.status),
      taxStatus: whtTaxStatusLabel(wagePaid, isOfficePayrollWhtTaxPaid(line)),
      batchLabel: run.payrollRunNo || run.id,
      earnerName: line.staffName || '—',
      earnerId: resolveStaffNationalId(line.staffId, nationalIdByExecutiveStaffId),
      paymentDate: formatYmdLocalThaiBE(paymentYmd),
      paidLabel: fmtBaht(paid),
      amountLabel: fmtBaht(tax),
    });
  }
  return rows;
}

function describeWithholdingPayrollPrintFilters(
  searchTerm: string,
  yearCe: number,
  monthScope: string,
): string[] {
  const lines: string[] = [];
  lines.push(`ช่วง: ${describeYearMonthScopeFilter(yearCe, monthScope)}`);
  if (searchTerm.trim()) {
    lines.push(`ค้นหา: "${searchTerm.trim()}"`);
  }
  return lines;
}

export default function AccountingWithholdingPayrollHubPage() {
  const { currentUser, isLoading } = useAppUser();
  const { profile } = usePermissions(currentUser);
  const firestore = useFirestore();
  const firebaseApp = useFirebaseApp();
  const { toast } = useToast();
  const payTaxProofInputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  /** ปี ค.ศ. — ค่าเริ่มต้นปีปัจจุบัน */
  const [yearFilterCe, setYearFilterCe] = useState(() => currentYearCe());
  /** เดือน: LAST_2 | LAST_3 | '01'..'12' — ค่าเริ่มต้นเดือนปัจจุบัน */
  const [monthScope, setMonthScope] = useState(() => currentMonthMm());
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);
  const [workerRows, setWorkerRows] = useState<WorkerWhtRow[]>([]);
  const [officeRows, setOfficeRows] = useState<OfficeWhtRow[]>([]);
  const [executiveRows, setExecutiveRows] = useState<ExecutiveWhtRow[]>([]);
  const [loadingWorkerLines, setLoadingWorkerLines] = useState(false);
  const [loadingOfficeLines, setLoadingOfficeLines] = useState(false);
  const [loadingExecutiveLines, setLoadingExecutiveLines] = useState(false);
  const [workerLinesErr, setWorkerLinesErr] = useState<string | null>(null);
  const [officeLinesErr, setOfficeLinesErr] = useState<string | null>(null);
  const [executiveLinesErr, setExecutiveLinesErr] = useState<string | null>(null);
  const [selectedWorkerKeys, setSelectedWorkerKeys] = useState<Set<string>>(() => new Set());
  const [selectedOfficeKeys, setSelectedOfficeKeys] = useState<Set<string>>(() => new Set());
  const [selectedExecutiveKeys, setSelectedExecutiveKeys] = useState<Set<string>>(() => new Set());
  /** จ่ายภาษีรวมทั้ง 3 ส่วน (ลูกจ้าง + ออฟฟิศ + ผู้บริหาร) ในกล่องเดียว */
  const [payTaxOpen, setPayTaxOpen] = useState(false);
  const [payTaxBankId, setPayTaxBankId] = useState('');
  const [payTaxDate, setPayTaxDate] = useState(() => new Date().toISOString().slice(0, 10));
  /** true = บันทึกสถานะจ่ายแล้วเท่านั้น (ไม่ตัดบัญชี / ไม่ลง cashbook) */
  const [payTaxStatusOnly, setPayTaxStatusOnly] = useState(false);
  const [payTaxBusy, setPayTaxBusy] = useState(false);
  const [payTaxAttachments, setPayTaxAttachments] = useState<WhtTaxPaymentProofAttachment[]>([]);
  const [attachProofBusy, setAttachProofBusy] = useState(false);
  const [sessionProofAttachments, setSessionProofAttachments] = useState<WhtTaxPaymentProofAttachment[]>([]);

  const canPayWhtTax = useMemo(() => canExecuteBankCashbookPayments(currentUser), [currentUser]);
  /** บันทึกสถานะจ่ายแล้วโดยไม่ตัดบัญชี — เฉพาะ Admin */
  const canMarkWhtStatusOnly = useMemo(
    () => isSystemAdmin(currentUser) || isSimpleAdmin(currentUser),
    [currentUser],
  );

  const bankAccountsQuery = useMemoFirebase(
    () =>
      firestore && canPayWhtTax
        ? query(collection(firestore, 'bank_accounts'), where('status', '==', 'ACTIVE'))
        : null,
    [firestore, canPayWhtTax],
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
        const rows: WorkerWhtRow[] = [];
        const list = batches ?? [];
        for (const batch of list) {
          if (cancelled) return;
          const snap = await getDocs(collection(firestore, 'payroll_batches', batch.id, 'lines'));
          snap.forEach((d) => {
            const line = { id: d.id, ...d.data() } as PayrollBatchLine;
            const pit = workerPayrollLinePitAmount(line);
            if (pit <= 0.005) return;
            const payYmd = resolvePayrollWorkerWhtPaymentDateYmd(batch);
            rows.push({
              batch,
              line,
              pit,
              paid: workerPayrollLinePaidAmount(line),
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
        const rows: OfficeWhtRow[] = [];
        const list = officeRuns ?? [];
        for (const run of list) {
          if (cancelled) return;
          const snap = await getDocs(collection(firestore, 'office_payroll_runs', run.id, 'lines'));
          snap.forEach((d) => {
            const line = { id: d.id, ...d.data() } as OfficePayrollLine;
            const tax = officePayrollLineTaxAmount(line);
            if (tax <= 0.005) return;
            const payYmd = resolveOfficePayrollWhtPaymentDateYmd(run);
            rows.push({
              run,
              line,
              tax,
              paid: officePayrollLinePaidAmount(line),
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
        const rows: ExecutiveWhtRow[] = [];
        const list = executiveRuns ?? [];
        for (const run of list) {
          if (cancelled) return;
          const snap = await getDocs(collection(firestore, 'executive_payroll_runs', run.id, 'lines'));
          snap.forEach((d) => {
            const line = { id: d.id, ...d.data() } as OfficePayrollLine;
            const tax = officePayrollLineTaxAmount(line);
            if (tax <= 0.005) return;
            const payYmd = resolveOfficePayrollWhtPaymentDateYmd(run);
            rows.push({
              run,
              line,
              tax,
              paid: officePayrollLinePaidAmount(line),
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
      const ym = officeRowYm(r);
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
      return (
        name.includes(t) ||
        bid.includes(t) ||
        lid.includes(t) ||
        wid.includes(t) ||
        nid.includes(t) ||
        paymentYmd.includes(t)
      );
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
      const nid = (nationalIdByOfficeStaffId.get(line.staffId) || '').toLowerCase();
      const ym = (run.payrollMonth || '').toLowerCase();
      return (
        name.includes(t) ||
        rn.includes(t) ||
        rid.includes(t) ||
        lid.includes(t) ||
        sid.includes(t) ||
        nid.includes(t) ||
        ym.includes(t) ||
        paymentYmd.includes(t)
      );
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
      const nid = (nationalIdByExecutiveStaffId.get(line.staffId) || '').toLowerCase();
      const ym = (run.payrollMonth || '').toLowerCase();
      return (
        name.includes(t) ||
        rn.includes(t) ||
        rid.includes(t) ||
        lid.includes(t) ||
        sid.includes(t) ||
        nid.includes(t) ||
        ym.includes(t) ||
        paymentYmd.includes(t)
      );
    });
  }, [executiveRows, q, nationalIdByExecutiveStaffId]);

  const filteredWorker = useMemo(() => {
    return workerRowsBySearch.filter((r) => ymMatchesYearMonthScope(workerRowYm(r), yearFilterCe, monthScope));
  }, [workerRowsBySearch, yearFilterCe, monthScope]);

  const filteredOffice = useMemo(() => {
    return officeRowsBySearch.filter((r) => ymMatchesYearMonthScope(officeRowYm(r), yearFilterCe, monthScope));
  }, [officeRowsBySearch, yearFilterCe, monthScope]);

  const filteredExecutive = useMemo(() => {
    return executiveRowsBySearch.filter((r) => ymMatchesYearMonthScope(officeRowYm(r), yearFilterCe, monthScope));
  }, [executiveRowsBySearch, yearFilterCe, monthScope]);

  type WorkerWhtDisplay = WorkerWhtRow & {
    rowKey: string;
    isGroupLeader: boolean;
    groupSize: number;
    sharedPit: number;
    memberRowKeys: string[];
    _allWagePaid?: boolean;
    _allTaxPaid?: boolean;
  };

  type OfficeWhtDisplay = OfficeWhtRow & {
    rowKey: string;
    isGroupLeader: boolean;
    groupSize: number;
    sharedTax: number;
    memberRowKeys: string[];
    _allWagePaid?: boolean;
    _allTaxPaid?: boolean;
  };

  const workerWhtDisplayRows = useMemo((): WorkerWhtDisplay[] => {
    const base = filteredWorker.map((r) => ({
      ...r,
      rowKey: workerRowKey(r.batch.id, r.line.id),
      personId: r.line.workerId,
      periodYm: workerPeriodYmForGroup(r),
      paymentYmd: r.paymentYmd,
      recencyMs: Number(r.batch.updatedAt) || 0,
      lineAmount: r.pit,
    }));
    const annotated = annotatePersonMonthGroups(base, 'worker_wht', (members) =>
      resolveSharedMonthlyWithholdSum(members),
    );
    const byKey = new Map(annotated.map((a) => [a.rowKey, a]));
    return annotated.map((a) => {
      const members = (a.memberRowKeys || []).map((k) => byKey.get(k)).filter(Boolean) as typeof annotated;
      const allWagePaid = members.every((m) => isWorkerPayrollWagePaid(m.batch, m.line));
      const allTaxPaid = members.every((m) => isWorkerPayrollWhtTaxPaid(m.line));
      return {
        batch: a.batch,
        line: a.line,
        pit: a.pit,
        paid: a.paid,
        paymentYmd: a.paymentYmd,
        rowKey: a.rowKey,
        isGroupLeader: a.isGroupLeader,
        groupSize: a.groupSize,
        sharedPit: a.isGroupLeader ? a.sharedAmount : 0,
        memberRowKeys: a.memberRowKeys,
        _allWagePaid: allWagePaid,
        _allTaxPaid: allTaxPaid,
      };
    });
  }, [filteredWorker]);

  const buildOfficeWhtDisplay = useCallback(
    (rows: OfficeWhtRow[], kind: 'office_wht' | 'executive_wht'): OfficeWhtDisplay[] => {
      const base = rows.map((r) => ({
        ...r,
        rowKey: officeRowKey(r.run.id, r.line.id),
        personId: r.line.staffId,
        periodYm: officePeriodYmForGroup(r),
        paymentYmd: r.paymentYmd,
        recencyMs: Number(r.run.updatedAt) || 0,
        lineAmount: r.tax,
      }));
      const annotated = annotatePersonMonthGroups(base, kind, (members) =>
        resolveSharedMonthlyWithholdSum(members),
      );
      const byKey = new Map(annotated.map((a) => [a.rowKey, a]));
      return annotated.map((a) => {
        const members = (a.memberRowKeys || []).map((k) => byKey.get(k)).filter(Boolean) as typeof annotated;
        const allWagePaid = members.every((m) => isOfficePayrollWagePaid(m.run, m.line));
        const allTaxPaid = members.every((m) => isOfficePayrollWhtTaxPaid(m.line));
        return {
          run: a.run,
          line: a.line,
          tax: a.tax,
          paid: a.paid,
          paymentYmd: a.paymentYmd,
          rowKey: a.rowKey,
          isGroupLeader: a.isGroupLeader,
          groupSize: a.groupSize,
          sharedTax: a.isGroupLeader ? a.sharedAmount : 0,
          memberRowKeys: a.memberRowKeys,
          _allWagePaid: allWagePaid,
          _allTaxPaid: allTaxPaid,
        };
      });
    },
    [],
  );

  const officeWhtDisplayRows = useMemo(
    () => buildOfficeWhtDisplay(filteredOffice, 'office_wht'),
    [buildOfficeWhtDisplay, filteredOffice],
  );
  const executiveWhtDisplayRows = useMemo(
    () => buildOfficeWhtDisplay(filteredExecutive, 'executive_wht'),
    [buildOfficeWhtDisplay, filteredExecutive],
  );

  const payableWorkerRows = useMemo(
    () =>
      workerWhtDisplayRows.filter(
        (r) => r.isGroupLeader && !!r._allWagePaid && !r._allTaxPaid && r.sharedPit > 0.005,
      ),
    [workerWhtDisplayRows],
  );
  const payableOfficeRows = useMemo(
    () =>
      officeWhtDisplayRows.filter(
        (r) => r.isGroupLeader && !!r._allWagePaid && !r._allTaxPaid && r.sharedTax > 0.005,
      ),
    [officeWhtDisplayRows],
  );
  const payableExecutiveRows = useMemo(
    () =>
      executiveWhtDisplayRows.filter(
        (r) => r.isGroupLeader && !!r._allWagePaid && !r._allTaxPaid && r.sharedTax > 0.005,
      ),
    [executiveWhtDisplayRows],
  );

  const payableWorkerKeySig = useMemo(
    () => payableWorkerRows.map((r) => r.rowKey).sort().join('|'),
    [payableWorkerRows],
  );
  const payableOfficeKeySig = useMemo(
    () => payableOfficeRows.map((r) => r.rowKey).sort().join('|'),
    [payableOfficeRows],
  );
  const payableExecutiveKeySig = useMemo(
    () => payableExecutiveRows.map((r) => r.rowKey).sort().join('|'),
    [payableExecutiveRows],
  );

  useEffect(() => {
    const keys = payableWorkerKeySig ? payableWorkerKeySig.split('|') : [];
    setSelectedWorkerKeys(new Set(keys));
  }, [payableWorkerKeySig]);

  useEffect(() => {
    const keys = payableOfficeKeySig ? payableOfficeKeySig.split('|') : [];
    setSelectedOfficeKeys(new Set(keys));
  }, [payableOfficeKeySig]);

  useEffect(() => {
    const keys = payableExecutiveKeySig ? payableExecutiveKeySig.split('|') : [];
    setSelectedExecutiveKeys(new Set(keys));
  }, [payableExecutiveKeySig]);

  const selectedWorkerPayRows = useMemo(
    () => payableWorkerRows.filter((r) => selectedWorkerKeys.has(r.rowKey)),
    [payableWorkerRows, selectedWorkerKeys],
  );
  const selectedOfficePayRows = useMemo(
    () => payableOfficeRows.filter((r) => selectedOfficeKeys.has(r.rowKey)),
    [payableOfficeRows, selectedOfficeKeys],
  );
  const selectedExecutivePayRows = useMemo(
    () => payableExecutiveRows.filter((r) => selectedExecutiveKeys.has(r.rowKey)),
    [payableExecutiveRows, selectedExecutiveKeys],
  );

  const selectedWorkerTaxTotal = useMemo(
    () => selectedWorkerPayRows.reduce((sum, r) => sum + r.sharedPit, 0),
    [selectedWorkerPayRows],
  );
  const selectedOfficeTaxTotal = useMemo(
    () => selectedOfficePayRows.reduce((sum, r) => sum + r.sharedTax, 0),
    [selectedOfficePayRows],
  );
  const selectedExecutiveTaxTotal = useMemo(
    () => selectedExecutivePayRows.reduce((sum, r) => sum + r.sharedTax, 0),
    [selectedExecutivePayRows],
  );

  /** รวมรายการที่เลือกทั้ง 3 ส่วน — ใช้กับปุ่มจ่ายภาษีรวมด้านบน */
  const selectedPayRowCount =
    selectedWorkerPayRows.length + selectedOfficePayRows.length + selectedExecutivePayRows.length;
  const payableRowCount =
    payableWorkerRows.length + payableOfficeRows.length + payableExecutiveRows.length;
  const selectedPayTaxTotal = selectedWorkerTaxTotal + selectedOfficeTaxTotal + selectedExecutiveTaxTotal;

  /** ไฟล์แนบรวมทั้ง 3 ส่วน — แสดงเฉพาะที่อยู่ในเดือน/ช่วงที่กรองอยู่ */
  const monthScopedProofAttachments = useMemo(() => {
    const fromRows = [
      ...filteredWorker.flatMap((r) => r.line.whtTaxPaymentProofAttachments ?? []),
      ...filteredOffice.flatMap((r) => r.line.whtTaxPaymentProofAttachments ?? []),
      ...filteredExecutive.flatMap((r) => r.line.whtTaxPaymentProofAttachments ?? []),
    ];
    const sessionForMonth = sessionProofAttachments.filter((a) => {
      const ym = a.periodYm?.trim();
      if (ym) return ymMatchesYearMonthScope(ym, yearFilterCe, monthScope);
      return ymMatchesYearMonthScope(
        `${currentYearCe()}-${currentMonthMm()}`,
        yearFilterCe,
        monthScope,
      );
    });
    return mergeUniqueProofAttachments(fromRows, sessionForMonth);
  }, [
    filteredWorker,
    filteredOffice,
    filteredExecutive,
    sessionProofAttachments,
    yearFilterCe,
    monthScope,
  ]);

  const removableProofIds = useMemo(
    () => new Set(sessionProofAttachments.map((a) => a.id)),
    [sessionProofAttachments],
  );

  const workerTotalPit = useMemo(
    () => workerWhtDisplayRows.filter((r) => r.isGroupLeader).reduce((sum, r) => sum + r.sharedPit, 0),
    [workerWhtDisplayRows],
  );
  const officeTotalTax = useMemo(
    () => officeWhtDisplayRows.filter((r) => r.isGroupLeader).reduce((sum, r) => sum + r.sharedTax, 0),
    [officeWhtDisplayRows],
  );
  const executiveTotalTax = useMemo(
    () => executiveWhtDisplayRows.filter((r) => r.isGroupLeader).reduce((sum, r) => sum + r.sharedTax, 0),
    [executiveWhtDisplayRows],
  );

  /** รวมตามตัวกรองปัจจุบัน (ลูกจ้าง + ออฟฟิศ + ผู้บริหาร รวมกัน) */
  const grandTotalPit = workerTotalPit + officeTotalTax + executiveTotalTax;
  const grandTotalPaid = useMemo(
    () =>
      filteredWorker.reduce((sum, { paid }) => sum + paid, 0) +
      filteredOffice.reduce((sum, { paid }) => sum + paid, 0) +
      filteredExecutive.reduce((sum, { paid }) => sum + paid, 0),
    [filteredWorker, filteredOffice, filteredExecutive],
  );

  const allWorkerTotalPit = useMemo(
    () => workerRows.reduce((sum, { pit }) => sum + pit, 0),
    [workerRows],
  );
  const allOfficeTotalTax = useMemo(
    () => officeRows.reduce((sum, { tax }) => sum + tax, 0),
    [officeRows],
  );
  const allExecutiveTotalTax = useMemo(
    () => executiveRows.reduce((sum, { tax }) => sum + tax, 0),
    [executiveRows],
  );
  const filteredRowCount = filteredWorker.length + filteredOffice.length + filteredExecutive.length;
  const allRowCount = workerRows.length + officeRows.length + executiveRows.length;
  const selectedPrintRowCount =
    selectedWorkerKeys.size + selectedOfficeKeys.size + selectedExecutiveKeys.size;

  const runWithholdingPayrollListPrint = useCallback(
    async (scope: 'filtered' | 'all' | 'selected') => {
      const workers =
        scope === 'selected'
          ? filteredWorker.filter((r) => selectedWorkerKeys.has(workerRowKey(r.batch.id, r.line.id)))
          : scope === 'filtered'
            ? filteredWorker
            : workerRows;
      const offices =
        scope === 'selected'
          ? filteredOffice.filter((r) => selectedOfficeKeys.has(officeRowKey(r.run.id, r.line.id)))
          : scope === 'filtered'
            ? filteredOffice
            : officeRows;
      const executives =
        scope === 'selected'
          ? filteredExecutive.filter((r) =>
              selectedExecutiveKeys.has(officeRowKey(r.run.id, r.line.id)),
            )
          : scope === 'filtered'
            ? filteredExecutive
            : executiveRows;
      const sourceRows = buildWithholdingPayrollPrintRows(
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
            scope === 'selected'
              ? 'ยังไม่ได้เลือกรายการ — ติ๊กช่องด้านซ้ายของคนที่ต้องการก่อน'
              : scope === 'filtered'
                ? 'ไม่พบข้อมูลตามตัวกรอง — ปรับตัวกรองหรือเลือกพิมพ์ทั้งหมด'
                : 'ยังไม่มีรายการหักภาษีของบุคลากรในระบบ',
        });
        return;
      }

      setPrintBusy(true);
      try {
        const { rows, truncated } = capWithholdingPayrollListPrintRows(sourceRows);
        const paidTotal =
          workers.reduce((sum, { paid }) => sum + paid, 0) +
          offices.reduce((sum, { paid }) => sum + paid, 0) +
          executives.reduce((sum, { paid }) => sum + paid, 0);
        const withholdTotal =
          workers.reduce((sum, { pit }) => sum + pit, 0) +
          offices.reduce((sum, { tax }) => sum + tax, 0) +
          executives.reduce((sum, { tax }) => sum + tax, 0);
        const generatedAt = new Date().toLocaleString('th-TH', {
          dateStyle: 'medium',
          timeStyle: 'short',
        });
        const filterLines =
          scope === 'filtered' ? describeWithholdingPayrollPrintFilters(q, yearFilterCe, monthScope) : [];
        const scopeTitle =
          scope === 'selected'
            ? 'พิมพ์เฉพาะที่เลือก'
            : scope === 'filtered'
              ? 'พิมพ์ตามตัวกรองปัจจุบัน'
              : 'พิมพ์ทั้งหมด (ในชุดข้อมูลล่าสุด)';

        const body = buildWithholdingPayrollListPrintHtml({
          rows,
          scopeTitle,
          filterLines,
          paidTotalLabel: fmtBaht(paidTotal),
          withholdTotalLabel: fmtBaht(withholdTotal),
          generatedAt,
          printedBy: currentUser?.displayName,
          truncated,
        });

        const ok = await openStandardPrintWindow({
          windowTitle: 'Withholding-Payroll-List',
          suggestedFileName: `Withholding-Payroll-List-${
            scope === 'selected' ? 'Selected' : scope === 'filtered' ? 'Filtered' : 'All'
          }`,
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
      selectedWorkerKeys,
      selectedOfficeKeys,
      selectedExecutiveKeys,
      nationalIdByWorkerId,
      nationalIdByOfficeStaffId,
      nationalIdByExecutiveStaffId,
      q,
      yearFilterCe,
      monthScope,
      currentUser?.displayName,
      toast,
    ],
  );

  const openPayTaxDialog = useCallback(() => {
    if (payableWorkerRows.length === 0 && payableOfficeRows.length === 0 && payableExecutiveRows.length === 0) {
      toast({
        variant: 'destructive',
        title: 'ไม่มีรายการที่พร้อมจ่ายภาษี',
        description: 'ต้องจ่ายค่าจ้าง/เงินเดือนแล้วและยังไม่ได้จ่ายภาษีหัก ณ ที่จ่าย',
      });
      return;
    }
    setSelectedWorkerKeys((prev) => {
      const payableIds = new Set(payableWorkerRows.map((r) => r.rowKey));
      const kept = [...prev].filter((id) => payableIds.has(id));
      return kept.length > 0 ? new Set(kept) : new Set(payableIds);
    });
    setSelectedOfficeKeys((prev) => {
      const payableIds = new Set(payableOfficeRows.map((r) => r.rowKey));
      const kept = [...prev].filter((id) => payableIds.has(id));
      return kept.length > 0 ? new Set(kept) : new Set(payableIds);
    });
    setSelectedExecutiveKeys((prev) => {
      const payableIds = new Set(payableExecutiveRows.map((r) => r.rowKey));
      const kept = [...prev].filter((id) => payableIds.has(id));
      return kept.length > 0 ? new Set(kept) : new Set(payableIds);
    });
    setPayTaxOpen(true);
    setPayTaxStatusOnly(false);
    setPayTaxBankId((prev) =>
      prev && operatingBankOptions.some((b) => b.id === prev) ? prev : (operatingBankOptions[0]?.id ?? ''),
    );
    setPayTaxDate(new Date().toISOString().slice(0, 10));
    setPayTaxAttachments([...sessionProofAttachments]);
  }, [payableWorkerRows, payableOfficeRows, payableExecutiveRows, operatingBankOptions, sessionProofAttachments, toast]);

  const handleAttachPayTaxProof = useCallback(
    async (files: FileList | null) => {
      if (!files?.length || !firebaseApp || !currentUser) return;
      setAttachProofBusy(true);
      const periodYm = resolveSessionProofPeriodYm(yearFilterCe, monthScope);
      try {
        const uploaded: WhtTaxPaymentProofAttachment[] = [];
        for (const file of Array.from(files)) {
          const attachment = await uploadPayrollWhtTaxPaymentProof(
            firebaseApp,
            'worker',
            currentUser.id,
            file,
            currentUser.displayName || currentUser.email || currentUser.id,
          );
          uploaded.push({ ...attachment, periodYm });
        }
        setPayTaxAttachments((prev) => {
          const next = [...prev];
          for (const a of uploaded) {
            if (!next.some((x) => x.id === a.id)) next.push(a);
          }
          setSessionProofAttachments(next);
          return next;
        });
        toast({
          title: 'แนบเอกสารแล้ว',
          description: uploaded.length > 1 ? `อัปโหลด ${uploaded.length} ไฟล์` : uploaded[0]?.fileName,
        });
      } catch (e) {
        toast({
          variant: 'destructive',
          title: 'แนบเอกสารไม่สำเร็จ',
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setAttachProofBusy(false);
        if (payTaxProofInputRef.current) payTaxProofInputRef.current.value = '';
      }
    },
    [firebaseApp, currentUser, yearFilterCe, monthScope, toast],
  );

  const handleRemovePayTaxProof = useCallback((attachmentId: string) => {
    setPayTaxAttachments((prev) => {
      const next = prev.filter((a) => a.id !== attachmentId);
      setSessionProofAttachments(next);
      return next;
    });
  }, []);

  const handleRemoveSessionProof = useCallback((attachmentId: string) => {
    setSessionProofAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
    setPayTaxAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
  }, []);

  const handleConfirmPayWhtTax = useCallback(async () => {
    if (!firestore || !currentUser || !payTaxOpen) return;

    const targets: Array<
      | { kind: 'worker'; row: WorkerWhtDisplay }
      | { kind: 'office'; row: OfficeWhtDisplay }
      | { kind: 'executive'; row: OfficeWhtDisplay }
    > = [
      ...selectedWorkerPayRows.map((row) => ({ kind: 'worker' as const, row })),
      ...selectedOfficePayRows.map((row) => ({ kind: 'office' as const, row })),
      ...selectedExecutivePayRows.map((row) => ({ kind: 'executive' as const, row })),
    ];

    if (targets.length === 0) {
      toast({
        variant: 'destructive',
        title: 'ยังไม่ได้เลือกรายการ',
        description: 'ติ๊กเลือกคนที่ต้องการจ่ายภาษีอย่างน้อย 1 รายการ',
      });
      return;
    }

    if (payTaxStatusOnly) {
      if (!canMarkWhtStatusOnly) {
        toast({
          variant: 'destructive',
          title: 'ไม่มีสิทธิ์',
          description: 'บันทึกสถานะจ่ายภาษีโดยไม่ตัดบัญชีได้เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น',
        });
        return;
      }
    } else {
      if (!payTaxBankId.trim()) {
        toast({ variant: 'destructive', title: 'กรุณาเลือกบัญชีธนาคาร' });
        return;
      }
      if (payTaxAttachments.length === 0) {
        toast({
          variant: 'destructive',
          title: 'ยังไม่ได้แนบเอกสาร',
          description: 'กรุณาแนบหลักฐานการโอนก่อนยืนยันจ่ายภาษี',
        });
        return;
      }
    }

    setPayTaxBusy(true);
    let success = 0;
    const errors: string[] = [];
    const paidWorkerKeys = new Set<string>();
    const paidOfficeKeys = new Set<string>();
    const paidExecutiveKeys = new Set<string>();
    const workerLineUpdates = new Map<string, Partial<PayrollBatchLine>>();
    const officeLineUpdates = new Map<string, Partial<OfficePayrollLine>>();
    const executiveLineUpdates = new Map<string, Partial<OfficePayrollLine>>();

    try {
      for (const target of targets) {
        try {
          const now = Date.now();
          if (target.kind === 'worker') {
            const { batch, line } = target.row;
            const key = workerRowKey(batch.id, line.id);
            const memberKeys = target.row.memberRowKeys?.length ? target.row.memberRowKeys : [key];
            const taxAmount = target.row.sharedPit;
            const companions = filteredWorker
              .filter((r) => {
                const k = workerRowKey(r.batch.id, r.line.id);
                return memberKeys.includes(k) && k !== key;
              })
              .map((r) => ({ batch: r.batch, line: r.line }));
            if (payTaxStatusOnly) {
              await markWorkerPayrollWhtTaxPaidWithoutCashbook(firestore, currentUser as User, {
                batch,
                line,
              });
              for (const c of companions) {
                await markWorkerPayrollWhtTaxPaidWithoutCashbook(firestore, currentUser as User, {
                  batch: c.batch,
                  line: c.line,
                });
              }
              for (const k of memberKeys) {
                paidWorkerKeys.add(k);
                workerLineUpdates.set(k, {
                  whtTaxPaidAt: now,
                  whtTaxPaidWithoutCashbook: true,
                  whtTaxPaidByUid: currentUser.id,
                  whtTaxPaidByName: currentUser.displayName || currentUser.email || currentUser.id,
                });
              }
            } else {
              const rowYm = workerRowYm(target.row);
              const proofs = withPeriodYm(payTaxAttachments, rowYm);
              const result = await recordWorkerPayrollWhtTaxPayment(firestore, currentUser as User, {
                batch,
                line,
                taxAmount,
                bankAccountId: payTaxBankId,
                entryDate: payTaxDate,
                earnerName: line.workerNameSnapshot || line.workerId,
                proofAttachments: proofs,
                companionLines: companions,
              });
              for (const k of memberKeys) {
                paidWorkerKeys.add(k);
                const memberLine =
                  k === key
                    ? line
                    : companions.find((c) => workerRowKey(c.batch.id, c.line.id) === k)?.line;
                const mergedProofs = mergeUniqueProofAttachments(
                  memberLine?.whtTaxPaymentProofAttachments ?? [],
                  proofs,
                );
                workerLineUpdates.set(k, {
                  whtTaxCashbookEntryId: result.cashbookEntryId,
                  whtTaxCashbookEntryNo: result.entryNo,
                  whtTaxPaidAt: now,
                  whtTaxPaymentBankAccountId: payTaxBankId,
                  whtTaxPaymentProofAttachments: mergedProofs,
                });
              }
            }
          } else {
            const { run, line } = target.row;
            const key = officeRowKey(run.id, line.id);
            const memberKeys = target.row.memberRowKeys?.length ? target.row.memberRowKeys : [key];
            const taxAmount = target.row.sharedTax;
            const sourceRows = target.kind === 'office' ? filteredOffice : filteredExecutive;
            const companions = sourceRows
              .filter((r) => {
                const k = officeRowKey(r.run.id, r.line.id);
                return memberKeys.includes(k) && k !== key;
              })
              .map((r) => ({ run: r.run, line: r.line }));
            const paidKeys = target.kind === 'office' ? paidOfficeKeys : paidExecutiveKeys;
            const lineUpdates = target.kind === 'office' ? officeLineUpdates : executiveLineUpdates;
            if (payTaxStatusOnly) {
              if (target.kind === 'office') {
                await markOfficePayrollWhtTaxPaidWithoutCashbook(firestore, currentUser as User, { run, line });
                for (const c of companions) {
                  await markOfficePayrollWhtTaxPaidWithoutCashbook(firestore, currentUser as User, {
                    run: c.run,
                    line: c.line,
                  });
                }
              } else {
                await markExecutivePayrollWhtTaxPaidWithoutCashbook(firestore, currentUser as User, {
                  run,
                  line,
                });
                for (const c of companions) {
                  await markExecutivePayrollWhtTaxPaidWithoutCashbook(firestore, currentUser as User, {
                    run: c.run,
                    line: c.line,
                  });
                }
              }
              for (const k of memberKeys) {
                paidKeys.add(k);
                lineUpdates.set(k, {
                  whtTaxPaidAt: now,
                  whtTaxPaidWithoutCashbook: true,
                  whtTaxPaidByUid: currentUser.id,
                  whtTaxPaidByName: currentUser.displayName || currentUser.email || currentUser.id,
                });
              }
            } else {
              const rowYm = officeRowYm(target.row);
              const proofs = withPeriodYm(payTaxAttachments, rowYm);
              const payInput = {
                run,
                line,
                taxAmount,
                bankAccountId: payTaxBankId,
                entryDate: payTaxDate,
                earnerName: line.staffName || line.staffId,
                proofAttachments: proofs,
                companionLines: companions,
              };
              const result =
                target.kind === 'office'
                  ? await recordOfficePayrollWhtTaxPayment(firestore, currentUser as User, payInput)
                  : await recordExecutivePayrollWhtTaxPayment(firestore, currentUser as User, payInput);
              for (const k of memberKeys) {
                paidKeys.add(k);
                const memberLine =
                  k === key
                    ? line
                    : companions.find((c) => officeRowKey(c.run.id, c.line.id) === k)?.line;
                const mergedProofs = mergeUniqueProofAttachments(
                  memberLine?.whtTaxPaymentProofAttachments ?? [],
                  proofs,
                );
                lineUpdates.set(k, {
                  whtTaxCashbookEntryId: result.cashbookEntryId,
                  whtTaxCashbookEntryNo: result.entryNo,
                  whtTaxPaidAt: now,
                  whtTaxPaymentBankAccountId: payTaxBankId,
                  whtTaxPaymentProofAttachments: mergedProofs,
                });
              }
            }
          }
          success += 1;
        } catch (e) {
          const name =
            target.kind === 'worker'
              ? target.row.line.workerNameSnapshot || target.row.line.workerId
              : target.row.line.staffName || target.row.line.staffId;
          errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      if (paidWorkerKeys.size > 0) {
        setWorkerRows((prev) =>
          prev.map((row) => {
            const key = workerRowKey(row.batch.id, row.line.id);
            const patch = workerLineUpdates.get(key);
            if (!patch) return row;
            return { ...row, line: { ...row.line, ...patch } };
          }),
        );
        setSelectedWorkerKeys((prev) => {
          const next = new Set(prev);
          for (const key of paidWorkerKeys) next.delete(key);
          return next;
        });
      }

      if (paidOfficeKeys.size > 0) {
        setOfficeRows((prev) =>
          prev.map((row) => {
            const key = officeRowKey(row.run.id, row.line.id);
            const patch = officeLineUpdates.get(key);
            if (!patch) return row;
            return { ...row, line: { ...row.line, ...patch } };
          }),
        );
        setSelectedOfficeKeys((prev) => {
          const next = new Set(prev);
          for (const key of paidOfficeKeys) next.delete(key);
          return next;
        });
      }

      if (paidExecutiveKeys.size > 0) {
        setExecutiveRows((prev) =>
          prev.map((row) => {
            const key = officeRowKey(row.run.id, row.line.id);
            const patch = executiveLineUpdates.get(key);
            if (!patch) return row;
            return { ...row, line: { ...row.line, ...patch } };
          }),
        );
        setSelectedExecutiveKeys((prev) => {
          const next = new Set(prev);
          for (const key of paidExecutiveKeys) next.delete(key);
          return next;
        });
      }

      if (errors.length === 0) {
        toast({
          title: payTaxStatusOnly
            ? 'บันทึกสถานะจ่ายภาษีแล้ว'
            : 'บันทึกจ่ายภาษีหัก ณ ที่จ่ายแล้ว',
          description: payTaxStatusOnly
            ? `อัปเดตสถานะ ${success} รายการ · ไม่ตัดบัญชีและไม่ลง cashbook`
            : `จ่ายสำเร็จ ${success} รายการ · ตัดบัญชีและบันทึก cashbook เรียบร้อย`,
        });
        if (!payTaxStatusOnly) {
          setSessionProofAttachments([]);
          setPayTaxAttachments([]);
        }
        setPayTaxOpen(false);
        setPayTaxStatusOnly(false);
      } else if (success > 0) {
        toast({
          variant: 'destructive',
          title: `สำเร็จ ${success} รายการ · ล้มเหลว ${errors.length} รายการ`,
          description: errors.slice(0, 3).join(' · '),
        });
      } else {
        toast({
          variant: 'destructive',
          title: payTaxStatusOnly ? 'บันทึกสถานะไม่สำเร็จ' : 'จ่ายภาษีไม่สำเร็จ',
          description: errors.slice(0, 3).join(' · '),
        });
      }
    } finally {
      setPayTaxBusy(false);
    }
  }, [
    firestore,
    currentUser,
    payTaxOpen,
    payTaxBankId,
    payTaxDate,
    payTaxStatusOnly,
    canMarkWhtStatusOnly,
    selectedWorkerPayRows,
    selectedOfficePayRows,
    selectedExecutivePayRows,
    filteredWorker,
    filteredOffice,
    filteredExecutive,
    payTaxAttachments,
    toast,
  ]);

  const renderWageStatusBadge = (label: string, wagePaid: boolean) => (
    <Badge
      variant={wagePaid ? 'default' : 'secondary'}
      className={wagePaid ? 'bg-blue-600 hover:bg-blue-600 text-white border-transparent' : undefined}
    >
      {label}
    </Badge>
  );

  const renderTaxStatusBadge = (wagePaid: boolean, taxPaid: boolean) => {
    const label = whtTaxStatusLabel(wagePaid, taxPaid);
    if (!wagePaid) {
      return <span className="text-xs text-muted-foreground">—</span>;
    }
    if (taxPaid) {
      return (
        <Badge className="bg-red-600 hover:bg-red-600 text-white border-transparent">{label}</Badge>
      );
    }
    return (
      <Badge variant="outline" className="border-red-300 text-red-700 bg-red-50">
        {label}
      </Badge>
    );
  };

  const payTaxDialogRowCount = selectedPayRowCount;
  const payTaxDialogTotal = selectedPayTaxTotal;

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
      <div className="w-full max-w-[min(100%,96rem)] mx-auto space-y-6 py-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">1. เอกสาร หัก ณ ที่จ่าย (บุคลากร)</h1>
          <p className="text-muted-foreground mt-1">
            รายการหนังสือรับรองหัก ณ ที่จ่าย (ภ.ง.ด.1 / ภ.ง.ด.2) รวมลูกจ้าง พนักงานออฟฟิศ และผู้บริหาร — จ่ายภาษีรวมทั้ง 3 ส่วนได้จากปุ่มด้านบน · คู่ค้า ภงด.53 อยู่เมนู 2
          </p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">ค้นหาและกรองเดือน</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <AccountingFilterToolbar
              filters={
                <>
                  <div className="relative min-w-0 flex-1 basis-full sm:basis-auto sm:min-w-[14rem] sm:max-w-md">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="h-10 pl-9"
                      placeholder="พิมพ์คำค้น..."
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      aria-label="ค้นหารายการหัก ณ ที่จ่าย"
                    />
                  </div>
                  <YearMonthScopeSelects
                    idPrefix="wht"
                    yearCe={yearFilterCe}
                    monthScope={monthScope}
                    yearOptionsCe={yearOptionsCe}
                    onYearCeChange={setYearFilterCe}
                    onMonthScopeChange={setMonthScope}
                  />
                </>
              }
              actions={
                <>
                  <AccountingFilterToolbarAction>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 shrink-0 gap-2 whitespace-nowrap"
                      onClick={() => setPrintDialogOpen(true)}
                    >
                      <Printer className="h-4 w-4 shrink-0" />
                      พิมพ์รายการ
                    </Button>
                  </AccountingFilterToolbarAction>
                  {canPayWhtTax && payableRowCount > 0 ? (
                    <AccountingFilterToolbarAction>
                      <Button
                        type="button"
                        className="h-10 shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white gap-2 px-4 whitespace-nowrap"
                        onClick={openPayTaxDialog}
                      >
                        <Banknote className="h-4 w-4 shrink-0" />
                        จ่ายภาษี ({selectedPayRowCount})
                      </Button>
                    </AccountingFilterToolbarAction>
                  ) : null}
                  {!loadingBatches &&
                  !loadingRuns &&
                  !loadingExecutiveRuns &&
                  !loadingWorkerLines &&
                  !loadingOfficeLines &&
                  !loadingExecutiveLines ? (
                    <>
                      <AccountingFilterToolbarStat label="รวมรายจ่าย" value={fmtBaht(grandTotalPaid)} />
                      <AccountingFilterToolbarStat
                        label="รวมการหัก"
                        value={fmtBaht(grandTotalPit)}
                        emphasize
                      />
                    </>
                  ) : null}
                </>
              }
            />
          </CardContent>
        </Card>

        <Dialog open={printDialogOpen} onOpenChange={setPrintDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>พิมพ์รายการหัก ณ ที่จ่าย (บุคลากร)</DialogTitle>
              <DialogDescription>
                พิมพ์ใบรายการสรุป — เลือกเฉพาะบางคนได้ด้วยช่องติ๊กด้านซ้าย หรือกด「พิมพ์」ทีละคนเพื่อเปิดหนังสือรับรองรายบุคคล · สูงสุด 500 รายการต่อครั้ง
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="rounded-md border bg-muted/30 p-3 space-y-1">
                <p className="font-semibold text-xs uppercase text-muted-foreground">ตัวกรองปัจจุบัน</p>
                <ul className="list-disc list-inside text-xs text-muted-foreground">
                  {describeWithholdingPayrollPrintFilters(q, yearFilterCe, monthScope).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <p className="text-xs font-medium pt-1">จะพิมพ์ {filteredRowCount} รายการ</p>
              </div>
              <p className="text-xs text-muted-foreground">
                ข้อมูลทั้งหมดในระบบ: {allRowCount} รายการ · รวม {fmtBaht(allWorkerTotalPit + allOfficeTotalTax + allExecutiveTotalTax)}
              </p>
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2 sm:flex-wrap">
              <Button
                type="button"
                variant="default"
                className="w-full sm:w-auto"
                disabled={printBusy || selectedPrintRowCount === 0}
                onClick={() => void runWithholdingPayrollListPrint('selected')}
              >
                <Printer className="h-4 w-4 mr-2" />
                พิมพ์เฉพาะที่เลือก ({selectedPrintRowCount})
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                disabled={printBusy || filteredRowCount === 0}
                onClick={() => void runWithholdingPayrollListPrint('filtered')}
              >
                <Printer className="h-4 w-4 mr-2" />
                พิมพ์ตามตัวกรอง ({filteredRowCount})
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                disabled={printBusy || allRowCount === 0}
                onClick={() => void runWithholdingPayrollListPrint('all')}
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

        <ProofAttachmentZone
          attachments={monthScopedProofAttachments}
          onRemove={canPayWhtTax ? handleRemoveSessionProof : undefined}
          removableIds={canPayWhtTax ? removableProofIds : undefined}
        />

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1.5">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Users className="h-5 w-5 shrink-0" />
                  ลูกจ้าง / Worker payroll
                </CardTitle>
                <CardDescription>
                  แสดงเฉพาะบรรทัดที่มียอดหัก ภงด.1 ในงวด — ถ้าจ่ายหลายครั้งในเดือนเดียวกันจะเรียงคู่กัน
                  แต่ยอดภาษีรวมช่องเดียว · กดเปิดเพื่อพิมพ์ใบหัก
                </CardDescription>
              </div>
              {!loadingBatches && !loadingWorkerLines && !workerLinesErr ? (
                <AccountingFilterToolbarStat
                  label="ยอดหักรวม"
                  value={fmtBaht(workerTotalPit)}
                  emphasize
                />
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
                  ? 'ยังไม่มีบรรทัดที่มียอดหัก ภงด.1 ในงวดล่าสุด (หรือยังไม่มีข้อมูลชุดจ่าย)'
                  : 'ไม่พบรายการที่ตรงกับคำค้นหรือเดือนที่เลือก'}
              </p>
            ) : (
              <div className="rounded-md border">
                <Table className="table-fixed w-full">
                  {WHT_PAYROLL_TABLE_COLGROUP(canPayWhtTax)}
                  <TableHeader>
                    <TableRow>
                      {canPayWhtTax ? (
                        <TableHead className="w-11 pl-3">
                          <Checkbox
                            checked={
                              payableWorkerRows.length > 0 &&
                              payableWorkerRows.every((r) =>
                                selectedWorkerKeys.has(workerRowKey(r.batch.id, r.line.id)),
                              )
                            }
                            onCheckedChange={(v) => {
                              if (v === true) {
                                setSelectedWorkerKeys(
                                  new Set(payableWorkerRows.map((r) => workerRowKey(r.batch.id, r.line.id))),
                                );
                              } else {
                                setSelectedWorkerKeys(new Set());
                              }
                            }}
                            aria-label="เลือกทั้งหมดที่พร้อมจ่ายภาษี"
                          />
                        </TableHead>
                      ) : null}
                      <TableHead>ชุดจ่าย / งวด</TableHead>
                      <TableHead>ผู้มีเงินได้</TableHead>
                      <TableHead className="whitespace-nowrap">วันที่จ่าย</TableHead>
                      <TableHead className={cn(WHT_EQUAL_COL_HEAD, 'text-right')}>ยอดจ่าย</TableHead>
                      <TableHead className={cn(WHT_EQUAL_COL_HEAD, 'text-center')}>สถานะจ่ายค่าจ้าง</TableHead>
                      <TableHead className={cn(WHT_EQUAL_COL_HEAD, 'text-right')}>ยอดหัก</TableHead>
                      <TableHead className={cn(WHT_EQUAL_COL_HEAD, 'text-center')}>สถานะจ่ายภาษี</TableHead>
                      <TableHead className={cn(WHT_EQUAL_COL_HEAD, 'text-center')}> </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {workerWhtDisplayRows.map((disp) => {
                      const { batch, line, paid, paymentYmd, rowKey, isGroupLeader, groupSize, sharedPit } = disp;
                      const wagePaid = isWorkerPayrollWagePaid(batch, line);
                      const wageLabel = workerWageStatusLabel(batch.status);
                      const payable =
                        isGroupLeader && !!disp._allWagePaid && !disp._allTaxPaid && sharedPit > 0.005;
                      const groupNote =
                        groupSize > 1
                          ? isGroupLeader
                            ? `รวม ${groupSize} ชุดจ่ายในเดือน — ยอด ภงด. รวมช่องเดียว`
                            : 'รวมกับสลิปล่าสุดในเดือนเดียวกัน'
                          : null;
                      return (
                        <TableRow
                          key={rowKey}
                          className={cn(!isGroupLeader && groupSize > 1 && 'bg-muted/20')}
                        >
                          {canPayWhtTax ? (
                            <TableCell className="w-11 pl-3 align-middle">
                              {!isGroupLeader ? (
                                <span className="text-muted-foreground text-xs" title={groupNote ?? undefined}>
                                  ↳
                                </span>
                              ) : disp._allTaxPaid ? (
                                <span className="text-muted-foreground text-xs" title="จ่ายภาษีแล้ว">
                                  ✓
                                </span>
                              ) : payable ? (
                                <Checkbox
                                  checked={selectedWorkerKeys.has(rowKey)}
                                  onCheckedChange={(v) => {
                                    const on = v === true;
                                    setSelectedWorkerKeys((prev) => {
                                      const next = new Set(prev);
                                      if (on) next.add(rowKey);
                                      else next.delete(rowKey);
                                      return next;
                                    });
                                  }}
                                  aria-label={`เลือก ${line.workerNameSnapshot || line.workerId}`}
                                />
                              ) : (
                                <span className="text-muted-foreground text-xs">—</span>
                              )}
                            </TableCell>
                          ) : null}
                          <TableCell className="text-xs">
                            <div className="font-mono truncate" title={batch.id}>
                              {batch.id}
                            </div>
                          </TableCell>
                          <TableCell className="max-w-0">
                            <div className="truncate font-medium" title={line.workerNameSnapshot || '—'}>
                              {line.workerNameSnapshot || '—'}
                            </div>
                            <div
                              className="truncate text-xs text-muted-foreground font-mono"
                              title={resolveWorkerNationalId(line, nationalIdByWorkerId)}
                            >
                              {resolveWorkerNationalId(line, nationalIdByWorkerId)}
                            </div>
                            {groupNote ? (
                              <div className="truncate text-[10px] text-muted-foreground" title={groupNote}>
                                {groupNote}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{formatYmdLocalThaiBE(paymentYmd)}</TableCell>
                          <TableCell className={cn(WHT_EQUAL_COL_CELL, 'text-right tabular-nums text-sm')}>
                            {fmtBaht(paid)}
                          </TableCell>
                          <TableCell className={cn(WHT_EQUAL_COL_CELL, 'text-center')}>
                            {renderWageStatusBadge(wageLabel, wagePaid)}
                          </TableCell>
                          <TableCell
                            className={cn(WHT_EQUAL_COL_CELL, 'text-right tabular-nums text-sm font-semibold text-primary')}
                          >
                            {isGroupLeader ? (
                              fmtBaht(sharedPit)
                            ) : (
                              <span className="text-muted-foreground text-xs" title={`บนสลิป: ${fmtBaht(disp.pit)}`}>
                                —
                              </span>
                            )}
                          </TableCell>
                          <TableCell className={cn(WHT_EQUAL_COL_CELL, 'text-center')}>
                            {isGroupLeader ? (
                              renderTaxStatusBadge(!!disp._allWagePaid, !!disp._allTaxPaid)
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                          <TableCell className={cn(WHT_EQUAL_COL_CELL, 'text-center')}>
                            <div className="inline-flex flex-col items-center gap-1 sm:flex-row sm:justify-center">
                              <Link
                                href={`/accounting/withholding-payroll/worker/${encodeURIComponent(batch.id)}/${encodeURIComponent(line.id)}`}
                                className="inline-flex items-center justify-center gap-1 text-sm text-primary hover:underline"
                              >
                                เปิด
                                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                              </Link>
                              <Link
                                href={`/accounting/withholding-payroll/worker/${encodeURIComponent(batch.id)}/${encodeURIComponent(line.id)}`}
                                className="inline-flex items-center justify-center gap-1 text-sm text-primary hover:underline"
                                title="พิมพ์หนังสือรับรองเฉพาะคนนี้"
                              >
                                <Printer className="h-3.5 w-3.5 shrink-0" />
                                พิมพ์
                              </Link>
                            </div>
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
                  แสดงเฉพาะบรรทัดที่มียอดภาษีหักในงวดเงินเดือนออฟฟิศ — เปิดเพื่อพิมพ์ใบหักเหมือนลูกจ้าง
                </CardDescription>
              </div>
              {!loadingRuns && !loadingOfficeLines && !officeLinesErr ? (
                <AccountingFilterToolbarStat
                  label="ยอดหักรวม"
                  value={fmtBaht(officeTotalTax)}
                  emphasize
                />
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
                  ? 'ยังไม่มีบรรทัดที่มียอดหักภาษีในงวดพนักงานออฟฟิศล่าสุด'
                  : 'ไม่พบรายการที่ตรงกับคำค้นหรือเดือนที่เลือก'}
              </p>
            ) : (
              <div className="rounded-md border">
                <Table className="table-fixed w-full">
                  {WHT_PAYROLL_TABLE_COLGROUP(canPayWhtTax)}
                  <TableHeader>
                    <TableRow>
                      {canPayWhtTax ? (
                        <TableHead className="w-11 pl-3">
                          <Checkbox
                            checked={
                              payableOfficeRows.length > 0 &&
                              payableOfficeRows.every((r) => selectedOfficeKeys.has(r.rowKey))
                            }
                            onCheckedChange={(v) => {
                              if (v === true) {
                                setSelectedOfficeKeys(new Set(payableOfficeRows.map((r) => r.rowKey)));
                              } else {
                                setSelectedOfficeKeys(new Set());
                              }
                            }}
                            aria-label="เลือกทั้งหมดที่พร้อมจ่ายภาษี"
                          />
                        </TableHead>
                      ) : null}
                      <TableHead>งวด</TableHead>
                      <TableHead>ผู้มีเงินได้</TableHead>
                      <TableHead className="whitespace-nowrap">วันที่จ่าย</TableHead>
                      <TableHead className={cn(WHT_EQUAL_COL_HEAD, 'text-right')}>ยอดจ่าย</TableHead>
                      <TableHead className={cn(WHT_EQUAL_COL_HEAD, 'text-center')}>สถานะจ่ายค่าจ้าง</TableHead>
                      <TableHead className={cn(WHT_EQUAL_COL_HEAD, 'text-right')}>ยอดหัก</TableHead>
                      <TableHead className={cn(WHT_EQUAL_COL_HEAD, 'text-center')}>สถานะจ่ายภาษี</TableHead>
                      <TableHead className={cn(WHT_EQUAL_COL_HEAD, 'text-center')}> </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {officeWhtDisplayRows.map((disp) => {
                      const { run, line, paid, paymentYmd, rowKey, isGroupLeader, groupSize, sharedTax } = disp;
                      const wagePaid = isOfficePayrollWagePaid(run, line);
                      const wageLabel = officeWageStatusLabel(run.status);
                      const payable =
                        isGroupLeader && !!disp._allWagePaid && !disp._allTaxPaid && sharedTax > 0.005;
                      const groupNote =
                        groupSize > 1
                          ? isGroupLeader
                            ? `รวม ${groupSize} ชุดจ่ายในเดือน — ยอด ภงด. รวมช่องเดียว`
                            : 'รวมกับสลิปล่าสุดในเดือนเดียวกัน'
                          : null;
                      return (
                        <TableRow
                          key={rowKey}
                          className={cn(!isGroupLeader && groupSize > 1 && 'bg-muted/20')}
                        >
                          {canPayWhtTax ? (
                            <TableCell className="w-11 pl-3 align-middle">
                              {!isGroupLeader ? (
                                <span className="text-muted-foreground text-xs" title={groupNote ?? undefined}>
                                  ↳
                                </span>
                              ) : disp._allTaxPaid ? (
                                <span className="text-muted-foreground text-xs" title="จ่ายภาษีแล้ว">
                                  ✓
                                </span>
                              ) : payable ? (
                                <Checkbox
                                  checked={selectedOfficeKeys.has(rowKey)}
                                  onCheckedChange={(v) => {
                                    const on = v === true;
                                    setSelectedOfficeKeys((prev) => {
                                      const next = new Set(prev);
                                      if (on) next.add(rowKey);
                                      else next.delete(rowKey);
                                      return next;
                                    });
                                  }}
                                  aria-label={`เลือก ${line.staffName || line.staffId}`}
                                />
                              ) : (
                                <span className="text-muted-foreground text-xs">—</span>
                              )}
                            </TableCell>
                          ) : null}
                          <TableCell className="text-xs">
                            <div className="font-mono truncate" title={run.payrollRunNo || run.id}>
                              {run.payrollRunNo || run.id}
                            </div>
                            <div className="truncate text-muted-foreground">{formatPayrollYearMonthMmYyyyThaiBE(run.payrollMonth)}</div>
                          </TableCell>
                          <TableCell className="max-w-0">
                            <div className="truncate font-medium" title={line.staffName || '—'}>
                              {line.staffName || '—'}
                            </div>
                            <div
                              className="truncate text-xs text-muted-foreground font-mono"
                              title={resolveStaffNationalId(line.staffId, nationalIdByOfficeStaffId)}
                            >
                              {resolveStaffNationalId(line.staffId, nationalIdByOfficeStaffId)}
                            </div>
                            {groupNote ? (
                              <div className="truncate text-[10px] text-muted-foreground" title={groupNote}>
                                {groupNote}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{formatYmdLocalThaiBE(paymentYmd)}</TableCell>
                          <TableCell className={cn(WHT_EQUAL_COL_CELL, 'text-right tabular-nums text-sm')}>
                            {fmtBaht(paid)}
                          </TableCell>
                          <TableCell className={cn(WHT_EQUAL_COL_CELL, 'text-center')}>
                            {renderWageStatusBadge(wageLabel, wagePaid)}
                          </TableCell>
                          <TableCell
                            className={cn(WHT_EQUAL_COL_CELL, 'text-right tabular-nums text-sm font-semibold text-primary')}
                          >
                            {isGroupLeader ? (
                              fmtBaht(sharedTax)
                            ) : (
                              <span className="text-muted-foreground text-xs" title={`บนสลิป: ${fmtBaht(disp.tax)}`}>
                                —
                              </span>
                            )}
                          </TableCell>
                          <TableCell className={cn(WHT_EQUAL_COL_CELL, 'text-center')}>
                            {isGroupLeader ? (
                              renderTaxStatusBadge(!!disp._allWagePaid, !!disp._allTaxPaid)
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                          <TableCell className={cn(WHT_EQUAL_COL_CELL, 'text-center')}>
                            <div className="inline-flex flex-col items-center gap-1 sm:flex-row sm:justify-center">
                              <Link
                                href={`/accounting/withholding-payroll/office/${encodeURIComponent(run.id)}/${encodeURIComponent(line.id)}`}
                                className="inline-flex items-center justify-center gap-1 text-sm text-primary hover:underline"
                              >
                                เปิด
                                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                              </Link>
                              <Link
                                href={`/accounting/withholding-payroll/office/${encodeURIComponent(run.id)}/${encodeURIComponent(line.id)}`}
                                className="inline-flex items-center justify-center gap-1 text-sm text-primary hover:underline"
                                title="พิมพ์หนังสือรับรองเฉพาะคนนี้"
                              >
                                <Printer className="h-3.5 w-3.5 shrink-0" />
                                พิมพ์
                              </Link>
                            </div>
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
                  แสดงเฉพาะบรรทัดที่มียอดภาษีหักในงวดผู้บริหาร (ภ.ง.ด.1 / ภ.ง.ด.2) — เปิดเพื่อพิมพ์ใบหักเหมือนลูกจ้าง
                </CardDescription>
              </div>
              {!loadingExecutiveRuns && !loadingExecutiveLines && !executiveLinesErr ? (
                <AccountingFilterToolbarStat
                  label="ยอดหักรวม"
                  value={fmtBaht(executiveTotalTax)}
                  emphasize
                />
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
                  ? 'ยังไม่มีบรรทัดที่มียอดหักภาษีในงวดผู้บริหารล่าสุด'
                  : 'ไม่พบรายการที่ตรงกับคำค้นหรือเดือนที่เลือก'}
              </p>
            ) : (
              <div className="rounded-md border">
                <Table className="table-fixed w-full">
                  {WHT_PAYROLL_TABLE_COLGROUP(canPayWhtTax)}
                  <TableHeader>
                    <TableRow>
                      {canPayWhtTax ? (
                        <TableHead className="w-11 pl-3">
                          <Checkbox
                            checked={
                              payableExecutiveRows.length > 0 &&
                              payableExecutiveRows.every((r) => selectedExecutiveKeys.has(r.rowKey))
                            }
                            onCheckedChange={(v) => {
                              if (v === true) {
                                setSelectedExecutiveKeys(new Set(payableExecutiveRows.map((r) => r.rowKey)));
                              } else {
                                setSelectedExecutiveKeys(new Set());
                              }
                            }}
                            aria-label="เลือกทั้งหมดที่พร้อมจ่ายภาษี"
                          />
                        </TableHead>
                      ) : null}
                      <TableHead>งวด</TableHead>
                      <TableHead>ผู้มีเงินได้</TableHead>
                      <TableHead className="whitespace-nowrap">วันที่จ่าย</TableHead>
                      <TableHead className={cn(WHT_EQUAL_COL_HEAD, 'text-right')}>ยอดจ่าย</TableHead>
                      <TableHead className={cn(WHT_EQUAL_COL_HEAD, 'text-center')}>สถานะจ่ายค่าจ้าง</TableHead>
                      <TableHead className={cn(WHT_EQUAL_COL_HEAD, 'text-right')}>ยอดหัก</TableHead>
                      <TableHead className={cn(WHT_EQUAL_COL_HEAD, 'text-center')}>สถานะจ่ายภาษี</TableHead>
                      <TableHead className={cn(WHT_EQUAL_COL_HEAD, 'text-center')}> </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {executiveWhtDisplayRows.map((disp) => {
                      const { run, line, paid, paymentYmd, rowKey, isGroupLeader, groupSize, sharedTax } = disp;
                      const wagePaid = isOfficePayrollWagePaid(run, line);
                      const wageLabel = officeWageStatusLabel(run.status);
                      const payable =
                        isGroupLeader && !!disp._allWagePaid && !disp._allTaxPaid && sharedTax > 0.005;
                      const groupNote =
                        groupSize > 1
                          ? isGroupLeader
                            ? `รวม ${groupSize} ชุดจ่ายในเดือน — ยอด ภงด. รวมช่องเดียว`
                            : 'รวมกับสลิปล่าสุดในเดือนเดียวกัน'
                          : null;
                      return (
                        <TableRow
                          key={rowKey}
                          className={cn(!isGroupLeader && groupSize > 1 && 'bg-muted/20')}
                        >
                          {canPayWhtTax ? (
                            <TableCell className="w-11 pl-3 align-middle">
                              {!isGroupLeader ? (
                                <span className="text-muted-foreground text-xs" title={groupNote ?? undefined}>
                                  ↳
                                </span>
                              ) : disp._allTaxPaid ? (
                                <span className="text-muted-foreground text-xs" title="จ่ายภาษีแล้ว">
                                  ✓
                                </span>
                              ) : payable ? (
                                <Checkbox
                                  checked={selectedExecutiveKeys.has(rowKey)}
                                  onCheckedChange={(v) => {
                                    const on = v === true;
                                    setSelectedExecutiveKeys((prev) => {
                                      const next = new Set(prev);
                                      if (on) next.add(rowKey);
                                      else next.delete(rowKey);
                                      return next;
                                    });
                                  }}
                                  aria-label={`เลือก ${line.staffName || line.staffId}`}
                                />
                              ) : (
                                <span className="text-muted-foreground text-xs">—</span>
                              )}
                            </TableCell>
                          ) : null}
                          <TableCell className="text-xs">
                            <div className="font-mono truncate" title={run.payrollRunNo || run.id}>
                              {run.payrollRunNo || run.id}
                            </div>
                            <div className="truncate text-muted-foreground">{formatPayrollYearMonthMmYyyyThaiBE(run.payrollMonth)}</div>
                          </TableCell>
                          <TableCell className="max-w-0">
                            <div className="truncate font-medium" title={line.staffName || '—'}>
                              {line.staffName || '—'}
                            </div>
                            <div
                              className="truncate text-xs text-muted-foreground font-mono"
                              title={resolveStaffNationalId(line.staffId, nationalIdByExecutiveStaffId)}
                            >
                              {resolveStaffNationalId(line.staffId, nationalIdByExecutiveStaffId)}
                            </div>
                            {groupNote ? (
                              <div className="truncate text-[10px] text-muted-foreground" title={groupNote}>
                                {groupNote}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{formatYmdLocalThaiBE(paymentYmd)}</TableCell>
                          <TableCell className={cn(WHT_EQUAL_COL_CELL, 'text-right tabular-nums text-sm')}>
                            {fmtBaht(paid)}
                          </TableCell>
                          <TableCell className={cn(WHT_EQUAL_COL_CELL, 'text-center')}>
                            {renderWageStatusBadge(wageLabel, wagePaid)}
                          </TableCell>
                          <TableCell
                            className={cn(WHT_EQUAL_COL_CELL, 'text-right tabular-nums text-sm font-semibold text-primary')}
                          >
                            {isGroupLeader ? (
                              fmtBaht(sharedTax)
                            ) : (
                              <span className="text-muted-foreground text-xs" title={`บนสลิป: ${fmtBaht(disp.tax)}`}>
                                —
                              </span>
                            )}
                          </TableCell>
                          <TableCell className={cn(WHT_EQUAL_COL_CELL, 'text-center')}>
                            {isGroupLeader ? (
                              renderTaxStatusBadge(!!disp._allWagePaid, !!disp._allTaxPaid)
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                          <TableCell className={cn(WHT_EQUAL_COL_CELL, 'text-center')}>
                            <div className="inline-flex flex-col items-center gap-1 sm:flex-row sm:justify-center">
                              <Link
                                href={`/accounting/withholding-payroll/executive/${encodeURIComponent(run.id)}/${encodeURIComponent(line.id)}`}
                                className="inline-flex items-center justify-center gap-1 text-sm text-primary hover:underline"
                              >
                                เปิด
                                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                              </Link>
                              <Link
                                href={`/accounting/withholding-payroll/executive/${encodeURIComponent(run.id)}/${encodeURIComponent(line.id)}`}
                                className="inline-flex items-center justify-center gap-1 text-sm text-primary hover:underline"
                                title="พิมพ์หนังสือรับรองเฉพาะคนนี้"
                              >
                                <Printer className="h-3.5 w-3.5 shrink-0" />
                                พิมพ์
                              </Link>
                            </div>
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

        <Dialog
          open={payTaxOpen}
          onOpenChange={(open) => {
            if (!open && !payTaxBusy) {
              setPayTaxOpen(false);
              setPayTaxStatusOnly(false);
            }
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>จ่ายภาษีหัก ณ ที่จ่าย (บุคลากร) — รวมทั้ง 3 ส่วน</DialogTitle>
              <DialogDescription>
                {payTaxStatusOnly
                  ? 'บันทึกสถานะ «จ่ายแล้ว» เท่านั้น — ไม่ตัดบัญชีธนาคารและไม่ลง cashbook'
                  : 'เลือกบัญชีธนาคารสำหรับตัดจ่ายภาษี — ระบบจะบันทึกรายการ cashbook แยกตามรายการที่เลือก'}
              </DialogDescription>
            </DialogHeader>
            {payTaxOpen ? (
              <div className="space-y-4 text-sm">
                <div className="rounded-md border bg-muted/30 p-3 space-y-1">
                  <p className="font-medium">
                    รายการที่เลือก {payTaxDialogRowCount} รายการ
                  </p>
                  <p className="text-xs text-muted-foreground">
                    ลูกจ้าง {selectedWorkerPayRows.length} · ออฟฟิศ {selectedOfficePayRows.length} · ผู้บริหาร {selectedExecutivePayRows.length}
                  </p>
                  <p className="text-muted-foreground">
                    ยอดภาษีหัก ณ ที่จ่ายรวม{' '}
                    <span className="font-semibold text-primary tabular-nums">
                      {fmtBaht(payTaxDialogTotal)}
                    </span>
                  </p>
                </div>
                {canMarkWhtStatusOnly ? (
                  <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50/80 px-3 py-2.5 dark:border-amber-800 dark:bg-amber-950/30 cursor-pointer">
                    <Checkbox
                      checked={payTaxStatusOnly}
                      onCheckedChange={(v) => setPayTaxStatusOnly(v === true)}
                      disabled={payTaxBusy}
                      className="mt-0.5"
                    />
                    <span className="space-y-0.5">
                      <span className="block font-medium text-amber-950 dark:text-amber-100">
                        บันทึกสถานะอย่างเดียว (ไม่ตัดบัญชี)
                      </span>
                      <span className="block text-[11px] text-amber-900/80 dark:text-amber-200/80 leading-snug">
                        ใช้เมื่อจ่ายภาษีไปแล้วช่วงระบบยังไม่สมบูรณ์ — อัปเดตเป็น «จ่ายแล้ว» โดยไม่ลง cashbook
                        · เฉพาะ Admin · มีบันทึกใน audit log
                      </span>
                    </span>
                  </label>
                ) : null}
                {!payTaxStatusOnly ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="wht-pay-bank">บัญชีธนาคารที่ตัดจ่าย</Label>
                      <Select value={payTaxBankId} onValueChange={setPayTaxBankId}>
                        <SelectTrigger id="wht-pay-bank">
                          <SelectValue placeholder="เลือกบัญชี ACTIVE" />
                        </SelectTrigger>
                        <SelectContent>
                          {operatingBankOptions.map((b) => (
                            <SelectItem key={b.id} value={b.id}>
                              {b.bankName} · {b.accountName} [{b.accountCode}]
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="wht-pay-date">วันที่ตัดบัญชี</Label>
                      <Input
                        id="wht-pay-date"
                        type="date"
                        value={payTaxDate}
                        onChange={(e) => setPayTaxDate(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>เอกสารการโอน (บังคับแนบ)</Label>
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        แนบสลิปหรือหลักฐานการโอนภาษีหัก ณ ที่จ่าย — รองรับ PDF หรือรูปภาพ (สูงสุด 10 MB ต่อไฟล์)
                      </p>
                      <input
                        ref={payTaxProofInputRef}
                        type="file"
                        multiple
                        accept="application/pdf,image/jpeg,image/jpg,image/png,image/webp,image/gif,.pdf,.jpg,.jpeg,.png,.webp,.gif"
                        className="hidden"
                        onChange={(e) => void handleAttachPayTaxProof(e.target.files)}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="gap-2"
                        disabled={attachProofBusy || payTaxBusy}
                        onClick={() => payTaxProofInputRef.current?.click()}
                      >
                        {attachProofBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Paperclip className="h-4 w-4" />
                        )}
                        แนบเอกสาร
                      </Button>
                      {payTaxAttachments.length > 0 ? (
                        <ul className="rounded-md border bg-muted/20 px-3 py-2 space-y-1.5">
                          {payTaxAttachments.map((a) => (
                            <li key={a.id} className="flex items-center gap-2 min-w-0 text-xs">
                              <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <span className="min-w-0 flex-1 truncate" title={a.fileName}>
                                {a.fileName}
                              </span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 shrink-0 px-2"
                                disabled={attachProofBusy || payTaxBusy}
                                onClick={() => handleRemovePayTaxProof(a.id)}
                              >
                                ลบ
                              </Button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-amber-800 dark:text-amber-200/90">
                          ยังไม่มีเอกสารแนบ — ต้องแนบก่อนจึงจะกดยืนยันจ่ายได้
                        </p>
                      )}
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                disabled={payTaxBusy}
                onClick={() => {
                  setPayTaxOpen(false);
                  setPayTaxStatusOnly(false);
                }}
              >
                ยกเลิก
              </Button>
              <Button
                type="button"
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={
                  payTaxBusy ||
                  attachProofBusy ||
                  payTaxDialogRowCount === 0 ||
                  (!payTaxStatusOnly && (!payTaxBankId || payTaxAttachments.length === 0))
                }
                onClick={() => void handleConfirmPayWhtTax()}
              >
                {payTaxBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {payTaxStatusOnly
                  ? `บันทึกสถานะจ่ายแล้ว (${payTaxDialogRowCount})`
                  : `ยืนยันจ่ายภาษี (${payTaxDialogRowCount})`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
