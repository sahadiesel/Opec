'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Link from 'next/link';
import {
  ArrowLeft,
  Lock,
  CheckCircle2,
  Loader2,
  ChevronRight,
  CreditCard,
  Printer,
  FileSpreadsheet,
  XCircle,
} from 'lucide-react';
import { PayslipDialog } from '@/components/payroll/payslip-dialog';
import { WorkerPayrollWhtSingleDialog } from '@/components/payroll/worker-payroll-wht-single-dialog';
import { WorkerPayrollWhtBatchDialog } from '@/components/payroll/worker-payroll-wht-batch-dialog';
import { useNormalBatchesAndLines } from '@/hooks/use-normal-batches-and-lines';
import { usePoPartyLabels } from '@/hooks/use-po-party-labels';
import { buildPayslipFromWorkerLine, normalizeIncomeSegments, isWorkerPayrollBatchSnapshotFrozen } from '@/lib/payroll/payslip-model';
import type { PayslipViewModel } from '@/lib/payroll/payslip-model';
import { useCompanyDocumentProfile } from '@/hooks/use-company-document-profile';
import type { CompanyDocumentProfileForPayrollWht } from '@/lib/payroll/payroll-worker-wht-types';
import { canPreviewWorkerPayrollWht } from '@/lib/payroll/payroll-worker-wht-permissions';
import { useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection, query, where } from 'firebase/firestore';
import {
  BankAccount,
  PayrollBatch,
  PayrollBatchLine,
  Position,
  User,
  PayrollPeriod,
  Worker,
} from '@/lib/types';
import { useRouter } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import { formatDateTimeThaiBE, formatStoredDateRangeThaiBE } from '@/lib/date-thai';
import { positionListPrimaryName } from '@/lib/position-display';
import {
  canAccess,
  canConfirmWorkerPayrollPaid,
  canCreate,
  canExecuteBankCashbookPayments,
  canGeneratePayslips,
  canView,
  isMatrixControlledRole,
} from '@/lib/permissions';
import {
  canApproveWorkerPayrollBatchAsManager,
  isHrManager,
  isOperationManager,
  isPayrollOfficer,
  isSystemAdmin,
} from '@/lib/permission-core';
import { workerPayrollBatchStatusLabelTh, payrollLineExportStatusLabelTh } from '@/lib/payroll/worker-batch-status-display';
import { isSimpleAdmin, isSimpleAccounting } from '@/lib/simple-tier-model';
import { canViewHrApprovalSubsection } from '@/lib/navigation/nav-access';
import { useAppUser } from '@/hooks/use-app-user';
import { usePermissions } from '@/hooks/use-permissions';
import { PayrollService } from '@/lib/services/payroll-service';
import { syncBankCurrentBalanceIfDrift } from '@/lib/services/bank-balance-reconcile';
import {
  buildWorkerPayrollBankVerificationCsv,
  loadWorkerPayrollBankCsvSources,
} from '@/lib/payroll/worker-payroll-bank-csv';
import { useToast } from '@/hooks/use-toast';
import {
  buildWorkerPayrollBatchLinesListPrintHtml,
  capWorkerPayrollBatchLinePrintRows,
  type WorkerPayrollBatchLinePrintRow,
} from '@/lib/documents/worker-payroll-batch-lines-list-print';
import { openStandardPrintWindow } from '@/lib/documents/standard-document-print';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';

function lineDeductionsTotal(line: PayrollBatchLine): number {
  return Object.values(line.deductionsBreakdown || {}).reduce((a, b) => a + (Number(b) || 0), 0);
}

/** กันข้อมูล Firestore ไม่ครบ → .toLocaleString บน undefined ทำให้ React ล่มทั้งหน้า */
function safeNum(n: unknown): number {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

export type PayrollBatchDetailShell = 'hr' | 'accounting';

export function PayrollBatchDetailView({
  id,
  shell,
}: {
  id: string;
  shell: PayrollBatchDetailShell;
}) {
  const router = useRouter();
  const backHref = shell === 'accounting' ? '/accounting/worker-payroll' : '/payroll/batches';
  const { toast } = useToast();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { payroll: payrollPerm } = usePermissions(currentUser);
  const firestore = useFirestore();
  const useMatrixGuards = isMatrixControlledRole(currentUser);
  const [bankCsvBusy, setBankCsvBusy] = useState(false);
  const [listPrintBusy, setListPrintBusy] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmPaidOpen, setConfirmPaidOpen] = useState(false);
  const [rejectPaidOpen, setRejectPaidOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectBusy, setRejectBusy] = useState(false);
  const [confirmLineIds, setConfirmLineIds] = useState<Set<string>>(() => new Set());
  const [payoutBankId, setPayoutBankId] = useState('');
  const [payoutActionBusy, setPayoutActionBusy] = useState(false);
  const ensuredTimesheetLockBatchIdRef = useRef<string | null>(null);
  const canEditBatch = payrollPerm('payroll_worker', 'edit_batch');
  /** อนุมัติยอดหลัง HR_REVIEWED — เฉพาะผู้จัดการ (ไม่ใช่ payroll_officer) */
  const canManagerApproveWorkerBatch = canApproveWorkerPayrollBatchAsManager(currentUser as User);
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

  /**
   * list bank_accounts — จำกัด subscribe เพื่อลด permission-deny; ผู้จัดการ HR/Ops และ payroll ควรได้เลือกบัญชีตัดจ่าย
   */
  const canListBankAccountsMasterList = useMemo(() => {
    if (!currentUser) return false;
    if (isSystemAdmin(currentUser) || isSimpleAdmin(currentUser) || isSimpleAccounting(currentUser)) return true;
    if (isPayrollOfficer(currentUser) || isHrManager(currentUser) || isOperationManager(currentUser)) return true;
    return canAccess(currentUser, 'bank_accounts', 'view') || canAccess(currentUser, 'cashbook', 'view');
  }, [currentUser]);

  const batchRef = useMemoFirebase(() => (firestore && canViewBatch ? doc(firestore, 'payroll_batches', id) : null), [firestore, id, canViewBatch]);
  const { data: batch, isLoading: isBatchLoading } = useDoc<PayrollBatch>(batchRef as any);

  /** งวด PAID/LOCKED — ซ่อมล็อกใบงาน + บันทึกยอด snapshot ให้ครบ (ไม่คำนวณสดทุกครั้งที่เปิด) */
  useEffect(() => {
    if (!firestore || !currentUser || !batch) return;
    if (batch.status !== 'PAID' && batch.status !== 'LOCKED') return;
    if (ensuredTimesheetLockBatchIdRef.current === batch.id) return;
    ensuredTimesheetLockBatchIdRef.current = batch.id;
    void (async () => {
      try {
        const svc = new PayrollService(firestore);
        await svc.ensurePaidBatchLineSnapshotsPersisted(batch.id, currentUser as User);
        await svc.ensureBatchSourceTimesheetsLocked(batch.id, currentUser as User);
      } catch {
        ensuredTimesheetLockBatchIdRef.current = null;
      }
    })();
  }, [firestore, currentUser, batch?.id, batch?.status]);

  const linesQuery = useMemoFirebase(() => (firestore && canViewBatch ? collection(firestore, 'payroll_batches', id, 'lines') : null), [firestore, id, canViewBatch]);
  const { data: lines, isLoading: isLinesLoading } = useCollection<PayrollBatchLine>(linesQuery as any);

  const linesSorted = useMemo(() => {
    const list = [...(lines ?? [])];
    list.sort((a, b) =>
      (a.workerNameSnapshot || '').localeCompare(b.workerNameSnapshot || '', 'th', {
        sensitivity: 'base',
        numeric: true,
      }),
    );
    return list;
  }, [lines]);

  const workersQuery = useMemoFirebase(
    () => (firestore && canViewBatch ? collection(firestore, 'workers') : null),
    [firestore, canViewBatch],
  );
  const { data: workers } = useCollection<Worker>(workersQuery as any);
  const positionsQuery = useMemoFirebase(
    () => (firestore && canViewBatch ? collection(firestore, 'positions') : null),
    [firestore, canViewBatch],
  );
  const { data: positions } = useCollection<Position>(positionsQuery as any);

  const workerPositionLabelByWorkerId = useMemo(() => {
    const posById = new Map<string, Position>();
    for (const p of positions ?? []) posById.set(p.id, p);
    const workerById = new Map<string, Worker>();
    for (const w of workers ?? []) workerById.set(w.id, w);

    const out = new Map<string, string>();
    for (const line of linesSorted) {
      const snapPosId = String(line.laborCostResolutionSnapshot?.positionId || '').trim();
      const workerPosId = String(workerById.get(line.workerId)?.currentPositionId || '').trim();
      const posId = snapPosId || workerPosId;
      const pos = posId ? posById.get(posId) : undefined;
      const label = pos ? positionListPrimaryName(pos) : '';
      out.set(line.workerId, label || '—');
    }
    return out;
  }, [linesSorted, workers, positions]);

  const accountingPaidLineCount = useMemo(
    () => linesSorted.filter((l) => !!(l as PayrollBatchLine).financePayoutCashbookEntryId).length,
    [linesSorted],
  );

  const confirmSelectionLines = useMemo(
    () => linesSorted.filter((l) => confirmLineIds.has(l.id)),
    [linesSorted, confirmLineIds],
  );

  const periodRef = useMemoFirebase(() => (firestore && batch ? doc(firestore, 'payroll_periods', batch.payrollPeriodId) : null), [firestore, batch?.payrollPeriodId]);
  const { data: period } = useDoc<PayrollPeriod>(periodRef as any);
  const { profile: companyProfile } = useCompanyDocumentProfile();

  const companyProfileRef = useMemoFirebase(
    () => (firestore && canViewBatch ? doc(firestore, 'system', 'company_profile') : null),
    [firestore, canViewBatch],
  );
  const { data: companyProfileForWht } = useDoc<CompanyDocumentProfileForPayrollWht>(companyProfileRef as any);

  const bankAccountsQuery = useMemoFirebase(
    () =>
      firestore && canViewBatch && canListBankAccountsMasterList
        ? query(collection(firestore, 'bank_accounts'), where('status', '==', 'ACTIVE'))
        : null,
    [firestore, canViewBatch, canListBankAccountsMasterList]
  );
  const { data: bankAccounts } = useCollection<BankAccount>(bankAccountsQuery as any);
  const activeBanks = useMemo(() => {
    const list = (bankAccounts || []).slice();
    list.sort((a, b) => (a.accountCode || '').localeCompare(b.accountCode || 'th-TH', 'th', { numeric: true }));
    return list;
  }, [bankAccounts]);

  const bankIdsReconcileKey = useMemo(
    () => activeBanks.map((b) => b.id).sort().join(','),
    [activeBanks],
  );

  useEffect(() => {
    if (shell !== 'accounting' || !firestore || !currentUser || !bankIdsReconcileKey) return;
    const u = currentUser as User;
    if (!canCreate(u, 'bank_accounts') && !canCreate(u, 'cashbook')) return;
    let cancelled = false;
    void (async () => {
      try {
        let anyCorrected = false;
        for (const b of activeBanks) {
          if (cancelled) break;
          const { corrected } = await syncBankCurrentBalanceIfDrift(firestore, b.id);
          if (corrected) anyCorrected = true;
        }
        if (!cancelled && anyCorrected) {
          toast({
            title: 'ซิงค์ยอดบัญชีแล้ว',
            description: 'ยอดในรายการเลือกบัญชีตัดจ่ายถูกปรับให้ตรงกับ cashbook / Petty',
          });
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shell, firestore, currentUser, bankIdsReconcileKey, activeBanks, toast]);

  useEffect(() => {
    if (batch?.payoutBankAccountId) {
      setPayoutBankId(batch.payoutBankAccountId);
    } else {
      setPayoutBankId('');
    }
  }, [batch?.payoutBankAccountId, batch?.id]);

  const { normalBatches, normalLines, priorPaidRefs } = useNormalBatchesAndLines(
    batch?.payrollPeriodId,
    {
      isSupplemental: batch?.batchType === 'SUPPLEMENTAL',
      includePriorPaidForNormal: batch?.batchType !== 'SUPPLEMENTAL',
      currentBatchId: batch?.id,
      currentBatchStatus: batch?.status,
      currentBatchChronologyMs: batch?.createdAt ?? batch?.financePreparedAt ?? null,
    },
  );

  const poPartyLabelById = usePoPartyLabels(linesSorted);

  /** ยอดตาราง/การ์ดสรุป = snapshot ในงวดเท่านั้น — ไม่โหลด timesheet มาคำนวณสดตอนเปิดหน้า */
  const slipByLineId = useMemo(() => {
    const m = new Map<string, PayslipViewModel>();
    if (!batch) return m;
    const periodLabel = period?.label || batch.payrollPeriodId;
    for (const line of linesSorted) {
      try {
        const normalLine = normalLines.find((l) => l.workerId === line.workerId);
        const normalBatch = normalLine
          ? normalBatches.find((b) => b.id === normalLine.payrollBatchId)
          : undefined;
        const priorForWorker = priorPaidRefs.filter((r) => r.line.workerId === line.workerId);
        const lineFrozen = isWorkerPayrollBatchSnapshotFrozen(batch, {
          hasEarlierPaidInPeriod: priorForWorker.length > 0,
        });
        const model = buildPayslipFromWorkerLine(
          line,
          batch,
          periodLabel,
          companyProfile ?? undefined,
          normalLine,
          normalBatch,
          priorForWorker,
          lineFrozen ? undefined : poPartyLabelById,
        );
        m.set(line.id, model);
      } catch {
        /* skip — ใช้ยอดบันทึกในงวด */
      }
    }
    return m;
  }, [
    batch,
    linesSorted,
    period?.label,
    normalLines,
    normalBatches,
    priorPaidRefs,
    companyProfile,
    poPartyLabelById,
  ]);

  const displayBatchTotals = useMemo(() => {
    let gross = 0;
    let deductions = 0;
    let net = 0;
    for (const line of linesSorted) {
      const slip = slipByLineId.get(line.id);
      gross += safeNum(slip?.grossTotal ?? line.grossAmount);
      deductions += safeNum(slip?.deductionsTotal ?? lineDeductionsTotal(line));
      net += safeNum(slip?.netPay ?? line.netAmount);
    }
    return {
      gross: Math.round(gross * 100) / 100,
      deductions: Math.round(deductions * 100) / 100,
      net: Math.round(net * 100) / 100,
    };
  }, [linesSorted, slipByLineId]);

  const confirmSelectionNetTotal = useMemo(
    () =>
      Math.round(
        confirmSelectionLines.reduce((s, l) => {
          const slip = slipByLineId.get(l.id);
          return s + safeNum(slip?.netPay ?? l.netAmount);
        }, 0) * 100,
      ) / 100,
    [confirmSelectionLines, slipByLineId],
  );

  const payoutAccountLabel = useMemo(() => {
    if (!batch?.payoutBankAccountId) return null;
    const b = activeBanks.find((x) => x.id === batch.payoutBankAccountId);
    return b
      ? `${b.accountName} — ${b.bankName} (…${(b.accountNumber || '').slice(-4)}) [${b.accountCode}]`
      : batch.payoutBankAccountId;
  }, [batch, activeBanks]);

  const handleDownloadBankCsv = useCallback(async () => {
    if (!batch || !linesSorted.length || !firestore) return;
    setBankCsvBusy(true);
    try {
      const sources = await loadWorkerPayrollBankCsvSources(
        firestore,
        linesSorted.map((l) => l.workerId),
      );
      const csv = buildWorkerPayrollBankVerificationCsv(batch, linesSorted, sources);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payroll-bank-check_${batch.id}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: 'ดาวน์โหลด CSV', description: 'ไฟล์ตรวจโอน (ชื่อ เบอร์ ปชช. เลขบัญชี ยอด)' });
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'ดาวน์โหลด CSV ไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBankCsvBusy(false);
    }
  }, [batch, linesSorted, firestore, toast]);

  const handlePrintSettlementLines = useCallback(async () => {
    if (!batch || linesSorted.length === 0) {
      toast({
        variant: 'destructive',
        title: 'ไม่มีรายการให้พิมพ์',
        description: 'งวดนี้ยังไม่มีบรรทัด settlement',
      });
      return;
    }

    const fmtBaht = (n: number) =>
      `฿${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const sourceRows: WorkerPayrollBatchLinePrintRow[] = linesSorted.map((line) => {
      const financePaid = !!(line as PayrollBatchLine).financePayoutCashbookEntryId;
      let accountingStatusLabel = '—';
      if (financePaid) accountingStatusLabel = 'จ่ายแล้ว';
      else if (batch.status === 'FINANCE_PREPARED' || batch.status === 'PAYMENT_EXPORTED') {
        accountingStatusLabel = 'รอตัด';
      }
      const slip = slipByLineId.get(line.id);
      return {
        workerName: line.workerNameSnapshot || '—',
        workerSubtitle: workerPositionLabelByWorkerId.get(line.workerId) || '—',
        paymentMethod: line.workerPaymentProfileSnapshot?.paymentMethod || 'CASH',
        exportStatusLabel: payrollLineExportStatusLabelTh(line.exportStatus),
        accountingStatusLabel,
        grossLabel: fmtBaht(safeNum(slip?.grossTotal ?? line.grossAmount)),
        deductionsLabel: fmtBaht(safeNum(slip?.deductionsTotal ?? lineDeductionsTotal(line))),
        netLabel: fmtBaht(safeNum(slip?.netPay ?? line.netAmount)),
      };
    });

    setListPrintBusy(true);
    try {
      const { rows, truncated } = capWorkerPayrollBatchLinePrintRows(sourceRows);
      const generatedAt = new Date().toLocaleString('th-TH', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
      const body = buildWorkerPayrollBatchLinesListPrintHtml({
        batchId: batch.id,
        periodLabel: period?.label || batch.payrollPeriodId,
        batchStatusLabel: workerPayrollBatchStatusLabelTh(batch.status),
        rows,
        workerCountLabel: String(safeNum(batch.totalWorkers)),
        grossTotalLabel: fmtBaht(safeNum(batch.grossAmount)),
        deductionsTotalLabel: fmtBaht(safeNum(batch.totalDeductions)),
        netTotalLabel: fmtBaht(safeNum(batch.netAmount)),
        generatedAt,
        printedBy: currentUser?.displayName,
        truncated,
      });

      const ok = await openStandardPrintWindow({
        windowTitle: 'Worker-Payroll-Batch-Lines',
        suggestedFileName: `Worker-Payroll-Batch-${batch.id}`,
        bodyInnerHtml: body,
        htmlLang: 'th',
      });

      if (!ok) {
        toast({
          variant: 'destructive',
          title: 'เปิดหน้าต่างพิมพ์ไม่ได้',
          description: 'กรุณาอนุญาตป๊อปอัปสำหรับเว็บไซต์นี้',
        });
      }
    } finally {
      setListPrintBusy(false);
    }
  }, [batch, linesSorted, period?.label, currentUser?.displayName, toast, workerPositionLabelByWorkerId, slipByLineId]);

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
    if (!canApproveWorkerPayrollBatchAsManager(currentUser as User)) return;
    setPayoutActionBusy(true);
    try {
      const svc = new PayrollService(firestore);
      await svc.managerApprovePayoutAndNotifyAccounting(batch.id, currentUser as User);
      toast({
        title: 'อนุมัติและส่งบัญชีจ่ายเงินแล้ว',
        description: 'สถานะ → FINANCE_PREPARED (คิวบัญชีรอจ่าย — ไม่มีขั้นส่งบัญชีแยก)',
      });
    } catch (e) {
      toast({ variant: 'destructive', title: 'อนุมัติไม่สำเร็จ', description: e instanceof Error ? e.message : String(e) });
    } finally {
      setPayoutActionBusy(false);
    }
  }, [firestore, batch, currentUser, toast]);

  const handleConfirmPaid = useCallback(async () => {
    if (!firestore || !batch || !currentUser) return;
    const bankId = payoutBankId.trim();
    if (!bankId) {
      toast({ variant: 'destructive', title: 'ยังไม่ได้เลือกบัญชี', description: 'กรุณาเลือกบัญชีธนาคารที่ต้องการตัดจ่าย' });
      return;
    }
    if (confirmLineIds.size === 0) {
      toast({
        variant: 'destructive',
        title: 'ยังไม่ได้เลือกรายการ',
        description: 'ติ๊กเลือกคนที่ต้องการตัดจากบัญชีนี้อย่างน้อย 1 แถว',
      });
      return;
    }
    setConfirmBusy(true);
    try {
      const svc = new PayrollService(firestore);
      const result = await svc.financeConfirmWorkerBatchPaid(batch.id, currentUser as User, {
        payoutBankAccountId: bankId,
        lineIds: [...confirmLineIds],
      });
      setConfirmPaidOpen(false);
      if (result.alreadyDone) {
        toast({ title: 'งวดนี้ปิดการจ่ายแล้ว', description: 'ระบบไม่ได้ตัดบัญชีซ้ำ' });
        return;
      }
      const paidAll = result.allPaidNow === true;
      toast({
        title: paidAll ? 'ยืนยันจ่ายครบทุกคนแล้ว' : 'ตัดบัญชีชุดที่เลือกแล้ว',
        description: paidAll
          ? 'สถานะงวดเป็น PAID และลง cashbook แล้ว'
          : `ลง cashbook แล้ว — ยังมีคนที่ยังไม่ตัดบัญชี · งวดจะเป็น PAID เมื่อตัดครบทุกแถว`,
      });
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'ยืนยันไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setConfirmBusy(false);
    }
  }, [firestore, batch, currentUser, toast, payoutBankId, confirmLineIds]);

  const handleFinanceRejectPayout = useCallback(async () => {
    if (!firestore || !batch || !currentUser) return;
    setRejectBusy(true);
    try {
      const svc = new PayrollService(firestore);
      await svc.financeRejectWorkerBatchPayout(batch.id, currentUser as User, {
        reason: rejectReason.trim() || undefined,
      });
      setRejectPaidOpen(false);
      setRejectReason('');
      toast({
        title: 'ไม่อนุมัติจ่ายแล้ว',
        description: 'สถานะกลับเป็นตรวจแล้ว (GENERATED) — ฝ่ายเงินเดือนแก้ไขแล้วส่งขอผู้จัดการอนุมัติใหม่ได้ · รายการออกจากคิวบัญชี',
      });
      if (shell === 'accounting') {
        router.push('/accounting/worker-payroll');
      }
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'ไม่อนุมัติไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setRejectBusy(false);
    }
  }, [firestore, batch, currentUser, toast, rejectReason, shell, router]);

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
  if (shell === 'accounting' && !canExecuteBankCashbookPayments(currentUser)) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-lg mx-auto py-20 text-center space-y-4">
          <h2 className="text-xl font-bold">ไม่มีสิทธิ์เปิดหน้าตัดจ่าย</h2>
          <p className="text-sm text-muted-foreground">
            เจ้าหน้าที่บัญชีดูคิวงวดได้ที่รายการ แต่การเลือกบัญชีธนาคารและบันทึก cashbook ทำได้เฉพาะผู้จัดการบัญชี
          </p>
          <Button variant="outline" onClick={() => router.push('/accounting/worker-payroll')}>
            กลับรายการงวด
          </Button>
        </div>
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

  const canWhtPreview =
    canPreviewWorkerPayrollWht(currentUser as User, batch.status) && linesSorted.length > 0;
  const whtDisabledReason =
    linesSorted.length === 0
      ? 'ยังไม่สามารถพิมพ์ใบหัก ณ ที่จ่ายได้ เพราะยังไม่มีรายการจ่ายลูกจ้าง'
      : !canPreviewWorkerPayrollWht(currentUser as User, batch.status)
        ? 'งวดนี้ยังไม่พร้อมใบหัก ณ ที่จ่าย'
        : undefined;
  const showAccountingConfirm =
    canConfirmWorkerPayrollPaid(currentUser) &&
    (batch.status === 'FINANCE_PREPARED' || batch.status === 'PAYMENT_EXPORTED');

  const unpaidAccountingLines = linesSorted.filter((l) => !(l as PayrollBatchLine).financePayoutCashbookEntryId);

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-[1600px] mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push(backHref)}
              aria-label={shell === 'accounting' ? 'กลับไปคิวทำจ่ายบัญชี' : 'กลับไปรายการงวดจ่าย'}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="space-y-2">
              {shell === 'accounting' ? (
                <>
                  <Badge variant="outline" className="border-primary/40 bg-primary/5 text-primary">
                    บัญชี · ทำจ่ายลูกจ้าง
                  </Badge>
                  <h1 className="text-2xl font-bold tracking-tight">ยืนยันโอน · เลือกบัญชีตัดจ่าย · ลง cashbook</h1>
                  <p className="text-sm text-muted-foreground max-w-3xl leading-relaxed">
                    ขั้นตอนฝ่ายบัญชี: ดาวน์โหลด CSV เพื่อตรวจกับธนาคาร → ติ๊กเลือกคนที่โอนจากบัญชีเดียวกันในแต่ละรอบ → เลือกบัญชีตัดจ่าย → ยืนยัน
                    (แบ่งจ่ายหลายบัญชีได้ เช่น 10 คนจากบัญชี A และอีก 4 คนจากบัญชี B) · งวดเป็น PAID เมื่อทุกแถวตัดบัญชีครบ
                  </p>
                </>
              ) : (
                <>
                  <PayrollScopeTag scope="worker" showHint={false} />
                  <h1 className="text-2xl font-bold tracking-tight">รายละเอียดงวดจ่ายลูกจ้าง (Batch)</h1>
                </>
              )}
              <div className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
                <span className="font-mono font-bold text-primary">{batch.id}</span>
                <Separator orientation="vertical" className="h-3" />
                <span>งวด: {period?.label || '...'}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {firestore ? (
              <WorkerPayrollWhtBatchDialog
                firestore={firestore}
                batch={batch}
                linesSorted={linesSorted}
                periodLabel={period?.label || batch.payrollPeriodId}
                companyProfile={companyProfileForWht ?? null}
                currentUser={currentUser as User}
                disabled={!canWhtPreview}
                disabledTitle={whtDisabledReason}
              />
            ) : null}
            <Button variant="outline" size="sm" asChild className="gap-1">
              <Link href={`/payroll/batches/${id}/print`}>
                <Printer className="h-4 w-4" />
                สลิปทั้ง batch
              </Link>
            </Button>
            <Badge
              variant={isLocked ? 'default' : 'outline'}
              title={batch.status}
              className={
                isLocked
                  ? 'bg-primary py-1.5 px-4'
                  : batch.status === 'HR_REVIEWED'
                    ? 'border-amber-500/70 bg-amber-50 py-1.5 px-4 text-amber-950 dark:bg-amber-950/35 dark:text-amber-50'
                    : 'py-1.5 px-4'
              }
            >
              {isLocked && <Lock className="h-3 w-3 mr-2" />}
              {workerPayrollBatchStatusLabelTh(batch.status)}
              <span className="ml-1.5 font-mono text-[10px] opacity-70">({batch.status})</span>
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
              <div className="text-2xl font-black text-primary">฿{displayBatchTotals.gross.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card className="border-l-8 border-l-red-500 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-[10px] font-black uppercase text-muted-foreground">Total Deductions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-primary">฿{displayBatchTotals.deductions.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card className="border-l-8 border-l-green-600 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-[10px] font-black uppercase text-muted-foreground">Net Payable</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-primary">฿{displayBatchTotals.net.toLocaleString()}</div>
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

        {batch.status === 'HR_REVIEWED' && !canManagerApproveWorkerBatch && (
          <Card className="border-l-4 border-l-slate-400/90 bg-muted/15">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">รอผู้จัดการอนุมัติ</CardTitle>
              <CardDescription>
                ฝ่ายเงินเดือนส่งขออนุมัติแล้ว — งวดนี้อยู่ในคิวของผู้จัดการปฏิบัติการ/HR ที่ศูนย์อนุมัติ (Payroll D6)
                ไม่แสดงในคิวอนุมัติของ payroll officer
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {batch.status === 'HR_REVIEWED' && canManagerApproveWorkerBatch && (
          <Card className="border-l-4 border-l-emerald-600/80">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">ผู้จัดการ/ศูนย์อนุมัติ</CardTitle>
              <CardDescription>
                งวด: {period?.label || batch.payrollPeriodId} — ตรวจยอดรวมแล้ว กดอนุมัติและส่งบัญชีจ่ายเงินเพื่อเข้าคิวบัญชีรอจ่าย (FINANCE_PREPARED)
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
                อนุมัติและส่งบัญชีจ่ายเงิน
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
                {shell === 'accounting' ? (
                  <>
                    หน้านี้เป็นหน้าทำจ่ายของบัญชี — หลังสถานะ{' '}
                    <span className="font-mono text-xs">FINANCE_PREPARED</span> ให้ดาวน์โหลด CSV ตรวจธนาคาร แล้วกดยืนยันจ่ายเพื่อเลือกบัญชีตัดจ่าย
                    และบันทึก PAID + cashbook เมื่อครบทุกคน
                  </>
                ) : (
                  <>
                    หลังส่งต่อบัญชี (FINANCE_PREPARED) ดาวน์โหลด CSV รายชุดเพื่อตรวจกับธนาคาร — เมื่อโอนจริงแล้วให้บัญชีกด ยืนยันจ่าย (จากเมนูบัญชี
                    หรือหน้านี้) เลือกแถวที่ต้องการและ <strong>เลือกบัญชีธนาคาร</strong> — แบ่งจ่ายหลายบัญชีได้ · งวดเป็น PAID เมื่อทุกแถวตัดครบ
                  </>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {batch.status === 'PAID' && payoutAccountLabel && (
                <p className="text-sm text-muted-foreground">
                  บัญชีที่ตัดจ่าย (งวดปิด): <span className="font-medium text-foreground">{payoutAccountLabel}</span>
                </p>
              )}
              {showAccountingConfirm && accountingPaidLineCount > 0 && (
                <p className="text-sm rounded-md border border-emerald-200/80 bg-emerald-50/80 dark:bg-emerald-950/35 dark:border-emerald-800/60 px-3 py-2 text-emerald-900 dark:text-emerald-100">
                  ตัดบัญชีแล้ว <strong>{accountingPaidLineCount}</strong> / {linesSorted.length} คน — งวดจะเป็น{' '}
                  <span className="font-mono text-xs">PAID</span> เมื่อครบทุกแถว
                </p>
              )}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                {canBankCheckCsv && linesSorted.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2 h-10"
                    disabled={bankCsvBusy}
                    onClick={() => void handleDownloadBankCsv()}
                  >
                    {bankCsvBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                    ดาวน์โหลด CSV ตรวจโอน (ชื่อ เบอร์ ปชช. เลขบัญชี ยอด)
                  </Button>
                )}
                {showAccountingConfirm && unpaidAccountingLines.length > 0 && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      disabled={confirmBusy}
                      onClick={() => setConfirmLineIds(new Set(unpaidAccountingLines.map((l) => l.id)))}
                    >
                      เลือกทั้งหมดที่ยังไม่จ่าย
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-xs"
                      disabled={confirmBusy}
                      onClick={() => setConfirmLineIds(new Set())}
                    >
                      ล้างการเลือก
                    </Button>
                  </>
                )}
                {showAccountingConfirm && (
                  <Button
                    type="button"
                    size="sm"
                    disabled={confirmBusy}
                    onClick={() => {
                      if (!activeBanks.length) {
                        toast({
                          variant: 'destructive',
                          title: 'ยังไม่มีบัญชี',
                          description: 'ตั้งค่าบัญชีธนาคาร (ACTIVE) ในระบบก่อน',
                        });
                        return;
                      }
                      if (!unpaidAccountingLines.length) {
                        toast({
                          variant: 'destructive',
                          title: 'ไม่มีแถวที่ยังไม่ได้ตัดบัญชี',
                          description: 'ทุกคนในงวดนี้ตัดบัญชีครบแล้ว',
                        });
                        return;
                      }
                      setConfirmLineIds((prev) => {
                        const unpaidIds = new Set(unpaidAccountingLines.map((l) => l.id));
                        const kept = [...prev].filter((id) => unpaidIds.has(id));
                        if (kept.length > 0) return new Set(kept);
                        return new Set(unpaidAccountingLines.map((l) => l.id));
                      });
                      setPayoutBankId((prev) => (prev && activeBanks.some((b) => b.id === prev) ? prev : (activeBanks[0]?.id ?? '')));
                      setConfirmPaidOpen(true);
                    }}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    บัญชียืนยันจ่ายแล้ว (เลือกบัญชีตัดจ่าย)…
                  </Button>
                )}
                {showAccountingConfirm && accountingPaidLineCount === 0 && !batch.financeCashbookEntryId ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={rejectBusy || confirmBusy}
                    onClick={() => setRejectPaidOpen(true)}
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    ไม่อนุมัติจ่าย
                  </Button>
                ) : null}
                {batch.financeCashbookEntryId ? (
                  <span className="text-xs text-muted-foreground font-mono">
                    Cashbook ref: {batch.financeCashbookEntryId}
                  </span>
                ) : null}
                </div>
                {linesSorted.length > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 shrink-0 gap-2"
                    disabled={listPrintBusy}
                    onClick={() => void handlePrintSettlementLines()}
                  >
                    {listPrintBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Printer className="h-4 w-4" />
                    )}
                    พิมพ์รายการ
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        )}

        <AlertDialog open={confirmPaidOpen} onOpenChange={setConfirmPaidOpen}>
          <AlertDialogContent className="max-w-3xl w-[min(48rem,calc(100vw-2rem))]">
            <AlertDialogHeader>
              <AlertDialogTitle>ยืนยันจ่าย — เลือกบัญชีตัดจ่าย</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3 text-sm text-left">
                  <p>
                    งวด <span className="font-mono font-semibold">{batch.id}</span> — ชุดที่เลือก{' '}
                    <span className="font-semibold">{confirmLineIds.size}</span> คน · ยอดสุทธิรวม{' '}
                    <span className="font-semibold">฿{confirmSelectionNetTotal.toLocaleString()}</span> จะถูกลงรายจ่ายใน{' '}
                    <strong>cashbook</strong> และลดยอด <strong>current balance</strong> ของบัญชีที่เลือกทันที (ยอดรวมทั้งงวด{' '}
                    ฿{safeNum(batch.netAmount).toLocaleString()})
                  </p>
                  {activeBanks.length === 0 ? (
                    <p className="text-destructive">ไม่พบบัญชีธนาคารสถานะ ACTIVE — ไปตั้งค่าเมนูบัญชี/ธนาคาร</p>
                  ) : (
                    <div className="space-y-2">
                      <Label>บัญชีสำหรับตัดจ่าย (บังคับเลือก)</Label>
                      <Select value={payoutBankId} onValueChange={setPayoutBankId}>
                        <SelectTrigger className="h-auto min-h-10 py-2 whitespace-normal [&>span]:line-clamp-none [&>span]:whitespace-normal">
                          <SelectValue placeholder="เลือกบัญชี" />
                        </SelectTrigger>
                        <SelectContent className="max-w-[min(46rem,calc(100vw-3rem))]">
                          {activeBanks.map((b) => (
                            <SelectItem key={b.id} value={b.id} className="whitespace-normal">
                              {b.accountName} — {b.bankName} (…{String(b.accountNumber || '').slice(-4)}) · ยอดคงเหลือ ฿
                              {Number(b.currentBalance || 0).toLocaleString()} [รหัส {b.accountCode}]
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <p className="text-xs text-amber-800 dark:text-amber-200/90 border border-amber-200/80 rounded-md p-2 bg-amber-50/80 dark:bg-amber-950/30">
                    กรณีตัดผิดบัญชี: รายการ cashbook ที่สร้างแล้ว (ref บนหน้านี้) ต้องแก้ทางบัญชีด้วย{' '}
                    <strong>รายการรับ/จ่ายย้อน</strong> หรือปรับยอดระหว่างบัญชี ระบบยังไม่มี «ยกเลิกอัตโนมัติ» จาก batch —
                    ติดต่อผู้ดูแล/บัญชีเพื่อเดบิต/เครดิตแก้ไขและสมุดสลากให้สอดคล้อง
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={confirmBusy}>ยกเลิก</AlertDialogCancel>
              <AlertDialogAction
                disabled={confirmBusy || !payoutBankId || activeBanks.length === 0 || confirmLineIds.size === 0}
                onClick={(e) => {
                  e.preventDefault();
                  void handleConfirmPaid();
                }}
                className="bg-primary"
              >
                {confirmBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} ยืนยันตัดจากบัญชีนี้
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          open={rejectPaidOpen}
          onOpenChange={(open) => {
            if (rejectBusy) return;
            setRejectPaidOpen(open);
            if (!open) setRejectReason('');
          }}
        >
          <AlertDialogContent className="max-w-lg">
            <AlertDialogHeader>
              <AlertDialogTitle>ไม่อนุมัติจ่าย — ส่งกลับฝ่ายเงินเดือนตรวจ</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3 text-sm text-left">
                  <p>
                    งวด <span className="font-mono font-semibold">{batch.id}</span> จะถูกนำออกจากคิวบัญชี และสถานะกลับเป็น{' '}
                    <strong>ตรวจแล้ว (GENERATED)</strong> เพื่อให้ฝ่ายเงินเดือนแก้ไขรายการ แล้วส่งขอผู้จัดการอนุมัติใหม่อีกครั้ง
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="finance-reject-reason">เหตุผล (ถ้ามี)</Label>
                    <Textarea
                      id="finance-reject-reason"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="เช่น ยอดไม่ตรง / ข้อมูลบัญชีลูกจ้างผิด / ต้องปรับรายการหัก…"
                      rows={3}
                      disabled={rejectBusy}
                    />
                  </div>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={rejectBusy}>ยกเลิก</AlertDialogCancel>
              <AlertDialogAction
                disabled={rejectBusy}
                onClick={(e) => {
                  e.preventDefault();
                  void handleFinanceRejectPayout();
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {rejectBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} ยืนยันไม่อนุมัติจ่าย
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Tabs defaultValue="lines" className="w-full">
          <TabsList className="grid grid-cols-3 w-full md:w-fit h-auto p-1 bg-muted/50">
            <TabsTrigger value="lines" className="gap-2 py-2 px-8">Settlement Lines</TabsTrigger>
            <TabsTrigger value="info" className="gap-2 py-2 px-8">Batch Metadata</TabsTrigger>
            <TabsTrigger value="history" className="gap-2 py-2 px-8">Audit Trail</TabsTrigger>
          </TabsList>

          <TabsContent value="lines" className="mt-6">
            <Card className="shadow-lg border-none overflow-hidden">
              <CardContent className="p-0 overflow-x-auto">
                <Table className="table-fixed min-w-[980px] w-full">
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      {showAccountingConfirm ? (
                        <TableHead className="w-11 pl-4 py-3 align-middle">
                          <Checkbox
                            checked={
                              unpaidAccountingLines.length > 0 &&
                              unpaidAccountingLines.every((l) => confirmLineIds.has(l.id))
                            }
                            onCheckedChange={(v) => {
                              if (v === true) {
                                setConfirmLineIds(new Set(unpaidAccountingLines.map((l) => l.id)));
                              } else {
                                setConfirmLineIds(new Set());
                              }
                            }}
                            aria-label="เลือกทั้งหมดที่ยังไม่ได้ตัดบัญชี"
                          />
                        </TableHead>
                      ) : null}
                      <TableHead className="pl-6 py-3 w-[26%] min-w-[160px] max-w-[300px] align-middle">
                        Worker (Snapshot)
                      </TableHead>
                      <TableHead className="w-[118px] whitespace-nowrap align-middle">Payment Method</TableHead>
                      <TableHead className="w-[108px] whitespace-nowrap align-middle">Export ธนาคาร</TableHead>
                      <TableHead className="w-[108px] whitespace-nowrap align-middle">สถานะบัญชี</TableHead>
                      <TableHead className="w-[92px] text-right tabular-nums align-middle">Gross</TableHead>
                      <TableHead className="w-[96px] text-right tabular-nums align-middle">Deductions</TableHead>
                      <TableHead className="w-[100px] text-right font-bold tabular-nums align-middle">Net Amount</TableHead>
                      <TableHead className="w-[88px] text-center align-middle px-1">ใบหักฯ</TableHead>
                      <TableHead className="w-[76px] text-right align-middle pr-2">สลิป</TableHead>
                      <TableHead className="w-11 pr-5 text-right align-middle">
                        <span className="sr-only">รายละเอียด</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {linesSorted.map((line) => {
                      const periodLabel = period?.label || batch.payrollPeriodId;
                      const slipModel = slipByLineId.get(line.id) ?? null;
                      return (
                      <TableRow key={line.id} className="hover:bg-muted/10">
                        {showAccountingConfirm ? (
                          <TableCell className="w-11 pl-4 align-middle py-3">
                            {(line as PayrollBatchLine).financePayoutCashbookEntryId ? (
                              <span className="text-muted-foreground text-xs tabular-nums" title="ตัดบัญชีแล้ว">
                                ✓
                              </span>
                            ) : (
                              <Checkbox
                                checked={confirmLineIds.has(line.id)}
                                onCheckedChange={(v) => {
                                  const on = v === true;
                                  setConfirmLineIds((prev) => {
                                    const next = new Set(prev);
                                    if (on) next.add(line.id);
                                    else next.delete(line.id);
                                    return next;
                                  });
                                }}
                                aria-label={`เลือก ${line.workerNameSnapshot || line.workerId}`}
                              />
                            )}
                          </TableCell>
                        ) : null}
                        <TableCell className="pl-6 align-top py-3 min-w-0 max-w-[300px]">
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <span className="font-bold text-sm text-primary leading-snug break-words inline-flex flex-wrap items-center gap-1">
                              {line.workerNameSnapshot}
                              {normalizeIncomeSegments(line.incomeSegments).length > 1 ? (
                                <Badge variant="secondary" className="text-[9px] font-semibold shrink-0">
                                  หลาย PO
                                </Badge>
                              ) : null}
                            </span>
                            <span className="text-[10px] text-muted-foreground truncate">
                              {workerPositionLabelByWorkerId.get(line.workerId) || '—'}
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
                          <Badge variant="outline" className="text-[9px] font-semibold whitespace-nowrap">
                            {payrollLineExportStatusLabelTh(line.exportStatus)}
                          </Badge>
                        </TableCell>
                        <TableCell className="align-middle py-3">
                          {(showAccountingConfirm || !!(line as PayrollBatchLine).financePayoutCashbookEntryId) &&
                          (line as PayrollBatchLine).financePayoutCashbookEntryId ? (
                            <Badge
                              variant="default"
                              className="text-[9px] bg-emerald-700 hover:bg-emerald-700 whitespace-nowrap font-semibold"
                            >
                              จ่ายแล้ว
                            </Badge>
                          ) : showAccountingConfirm ? (
                            <Badge
                              variant="outline"
                              className="text-[9px] text-amber-900 border-amber-600 whitespace-nowrap font-semibold dark:text-amber-100"
                            >
                              รอตัด
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-xs font-medium tabular-nums align-middle py-3">
                          ฿{safeNum(slipModel?.grossTotal ?? line.grossAmount).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right text-xs text-red-600 tabular-nums align-middle py-3">
                          ฿{safeNum(slipModel?.deductionsTotal ?? lineDeductionsTotal(line)).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-black text-primary tabular-nums align-middle py-3 text-sm">
                          ฿{safeNum(slipModel?.netPay ?? line.netAmount).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-center align-middle py-3 px-1">
                          <WorkerPayrollWhtSingleDialog
                            firestore={firestore}
                            batch={batch}
                            line={line}
                            periodLabel={periodLabel}
                            companyProfile={companyProfileForWht ?? null}
                            currentUser={currentUser as User}
                            disabled={!canWhtPreview}
                            disabledTitle={whtDisabledReason}
                          />
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
                    {linesSorted.length === 0 && !isLinesLoading && (
                      <TableRow>
                        <TableCell
                          colSpan={showAccountingConfirm ? 10 : 9}
                          className="text-center py-20 text-muted-foreground italic"
                        >
                          No settlement lines found in this batch.
                        </TableCell>
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
