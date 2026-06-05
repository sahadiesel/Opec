'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ArrowLeft,
  Loader2,
  Plus,
  Trash2,
  CalendarDays,
  Settings,
  Calculator,
  RefreshCw,
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { doc, getDoc } from 'firebase/firestore';
import type {
  DailyTimesheet,
  PayrollBatch,
  PayrollBatchLine,
  PayrollPeriod,
  User,
  WorkerPitCalculationMode,
} from '@/lib/types';
import { useRouter } from 'next/navigation';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccess, canPayrollPermission, canView, isMatrixControlledRole } from '@/lib/permissions';
import { isSystemAdmin } from '@/lib/permission-core';
import { isSimpleAdmin, isSimpleAccounting } from '@/lib/simple-tier-model';
import { PayrollService } from '@/lib/services/payroll-service';
import { useToast } from '@/hooks/use-toast';
import { formatDateThaiBE } from '@/lib/date-thai';
import { PayslipDialog } from '@/components/payroll/payslip-dialog';
import { buildPayslipFromWorkerLine, buildWorkerPayslipIncomeLinesFromTimesheets } from '@/lib/payroll/payslip-model';
import { useCompanyDocumentProfile } from '@/hooks/use-company-document-profile';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import {
  buildSingleTimesheetGrossContext,
  computeSingleTimesheetGrossLikeBatch,
  type SingleTimesheetGrossContext,
} from '@/lib/payroll/single-timesheet-gross';
import { resolveEffectivePayrollJobMode } from '@/lib/payroll/timesheet-labor-base-cost';
import {
  loadPayrollPoliciesFromFirestore,
  resolvePayrollPoliciesForDate,
  computeWorkerPayrollLineD8,
} from '@/lib/payroll/d8';
import {
  pitFromMonthlyGross,
  pitFromMonthlyGrossWithMarginalCeiling,
} from '@/lib/payroll/d8/deductions-from-policy';
import { THAI_PIT_STANDARD_MARGINAL_RATE_PERCENTS } from '@/lib/hr/pit-thailand';
import { CASH_ADVANCE_PAYROLL_DEDUCTION_KEY } from '@/lib/payroll/cash-advance-recovery';
import { normalizeTimesheetsForPayrollLine } from '@/lib/payroll/dedupe-timesheets-for-payroll';
import { loadWorkerPayableTimesheetsForPeriod } from '@/lib/payroll/filter-timesheets-for-worker-payroll';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const TH_WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์'];

function snapToStandardMarginalRate(n: number): number {
  const rates = [...THAI_PIT_STANDARD_MARGINAL_RATE_PERCENTS] as number[];
  const v = Math.round(Number(n));
  if (rates.includes(v)) return v;
  return rates.reduce((best, x) => (Math.abs(x - v) < Math.abs(best - v) ? x : best), 35);
}

/** วันในสัปดาห์จาก YYYY-MM-DD แบบ local (สอดคล้อง package-labor-cost / สัญญา) */
function localWeekdayIndex(dateStr: string): number {
  const parts = dateStr.split('-').map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return 0;
  return new Date(y, m - 1, d).getDay();
}

function lineDeductionsTotal(line: PayrollBatchLine): number {
  return Object.values(line.deductionsBreakdown || {}).reduce((a, b) => a + (Number(b) || 0), 0);
}

function allowanceItemsTotal(line: PayrollBatchLine): number {
  return (line.hrLineAdjustments?.allowanceItems ?? []).reduce((s, x) => s + (Number(x.amount) || 0), 0);
}

/** รายการหักสำหรับแสดง (SS / ภงด. / หักพิเศษที่บันทึก) */
function deductionDisplayRows(line: PayrollBatchLine): Array<{ label: string; amount: number }> {
  const d = line.deductionsBreakdown || {};
  const rows: Array<{ label: string; amount: number }> = [];
  const ss = Number(d.social_security) || 0;
  rows.push({ label: 'ประกันสังคม', amount: ss });
  const pit = Number(d.pit_withholding) || 0;
  rows.push({ label: 'ภาษี ณ ที่จ่าย (ภงด.)', amount: pit });
  const caAmt = Number(d[CASH_ADVANCE_PAYROLL_DEDUCTION_KEY]) || 0;
  if (caAmt > 0) {
    rows.push({
      label: 'หักคืนเบิกล่วงหน้า (อัตโนมัติ · จ่ายแล้วรอหักสลิป)',
      amount: caAmt,
    });
  }
  const manual = line.hrLineAdjustments?.deductionItems ?? [];
  manual.forEach((item, idx) => {
    const key = `manual_ded_${idx}`;
    const amt = Number(d[key]);
    if (amt > 0) rows.push({ label: item.label?.trim() || `หักพิเศษ (${idx + 1})`, amount: amt });
  });
  const known = new Set<string>(['social_security', 'pit_withholding', CASH_ADVANCE_PAYROLL_DEDUCTION_KEY]);
  manual.forEach((_, idx) => known.add(`manual_ded_${idx}`));
  for (const [k, v] of Object.entries(d)) {
    if (known.has(k)) continue;
    const n = Number(v) || 0;
    if (n !== 0) rows.push({ label: k, amount: n });
  }
  return rows;
}

/** รวมยอด earningsBreakdown ที่นับเข้า eventType เดียวกัน (สอดคล้อง payroll-service) */
function earningsTotalForEventType(line: PayrollBatchLine, eventType: string): number {
  const eb = line.earningsBreakdown || {};
  let n = Number(eb[eventType]) || 0;
  n += Number(eb[`${eventType}_policy`]) || 0;
  if (eventType === 'work_day') {
    n += Number((eb as { work_day_package?: number }).work_day_package) || 0;
  }
  if (eventType === 'standby_day') {
    n += Number((eb as { standby_day_package?: number }).standby_day_package) || 0;
  }
  return n;
}

/**
 * ยอดต่อวันสำหรับแถว timesheet — แบ่งยอดรวมของประเภทนั้น ÷ จำนวนวันในประเภทเดียวกันในงวด
 * (ถ้าแต่ละวันคิดคนละยอดจริง ค่านี้เป็นเฉลี่ยเพื่อตรวจสอบเทียบสัญญา)
 */
function allocatedAmountPerDayForEvent(line: PayrollBatchLine, eventType: string): number | null {
  const total = earningsTotalForEventType(line, eventType);
  const count = line.eventBreakdown?.[eventType] ?? 0;
  if (count <= 0 || total <= 0) return null;
  return Math.round((total / count) * 100) / 100;
}

export default function PayrollBatchWorkerLinePage({
  params,
}: {
  params: Promise<{ id: string; workerId: string }>;
}) {
  const { id: batchId, workerId } = use(params);
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { profile: companyProfile } = useCompanyDocumentProfile();
  const useMatrixGuards = isMatrixControlledRole(currentUser);

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

  const canEditHrAdjustments = useMemo(
    () => currentUser && canPayrollPermission(currentUser, 'payroll_worker', 'edit_batch'),
    [currentUser],
  );

  const lineId = `${batchId}_${workerId}`;
  const batchRef = useMemoFirebase(
    () => (firestore && canViewBatch ? doc(firestore, 'payroll_batches', batchId) : null),
    [firestore, batchId, canViewBatch],
  );
  const lineRef = useMemoFirebase(
    () =>
      firestore && canViewBatch ? doc(firestore, 'payroll_batches', batchId, 'lines', lineId) : null,
    [firestore, batchId, lineId, canViewBatch],
  );

  const { data: batch, isLoading: batchLoading } = useDoc<PayrollBatch>(batchRef as any);
  const { data: line, isLoading: lineLoading } = useDoc<PayrollBatchLine>(lineRef as any);

  const periodRef = useMemoFirebase(
    () => (firestore && batch ? doc(firestore, 'payroll_periods', batch.payrollPeriodId) : null),
    [firestore, batch?.payrollPeriodId],
  );
  const { data: period } = useDoc<PayrollPeriod>(periodRef as any);

  const [timesheets, setTimesheets] = useState<DailyTimesheet[]>([]);
  const [tsLoading, setTsLoading] = useState(true);
  const [grossByTsId, setGrossByTsId] = useState<Record<string, number>>({});
  const [grossCtx, setGrossCtx] = useState<SingleTimesheetGrossContext | null>(null);
  const [grossByTsLoading, setGrossByTsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recalcOpen, setRecalcOpen] = useState(false);
  const [recalcBusy, setRecalcBusy] = useState(false);

  const [allowanceRows, setAllowanceRows] = useState<Array<{ label: string; amount: string }>>([
    { label: '', amount: '' },
  ]);
  const [deductionRows, setDeductionRows] = useState<Array<{ label: string; amount: string }>>([
    { label: '', amount: '' },
  ]);
  const [workerPitMode, setWorkerPitMode] = useState<WorkerPitCalculationMode>('auto_timesheet');
  const [pitManualBaht, setPitManualBaht] = useState('');
  const [pitAutoSalaryBase, setPitAutoSalaryBase] = useState('');
  /** true = คำนวณด้วยเต็มตาราง (35%); false = ใช้เพดาน marginal ที่เลือก (รองรับข้อมูลเก่า) */
  const [autoTimesheetUseFullTable, setAutoTimesheetUseFullTable] = useState(true);
  const [autoTimesheetMarginalRate, setAutoTimesheetMarginalRate] = useState(35);
  const [adjNotes, setAdjNotes] = useState('');

  useEffect(() => {
    if (!line) return;
    const a = line.hrLineAdjustments?.allowanceItems?.length
      ? line.hrLineAdjustments.allowanceItems.map((x) => ({
          label: x.label,
          amount: String(x.amount),
        }))
      : [{ label: '', amount: '' }];
    const d = line.hrLineAdjustments?.deductionItems?.length
      ? line.hrLineAdjustments.deductionItems.map((x) => ({
          label: x.label,
          amount: String(x.amount),
        }))
      : [{ label: '', amount: '' }];
    setAllowanceRows(a);
    setDeductionRows(d);
    const mode = line.hrLineAdjustments?.workerPitMode;
    const base = line.hrLineAdjustments?.pitAutoSalaryBaseBaht;
    const mr = line.hrLineAdjustments?.pitWithholdingOverrideMaxMarginalRatePercent;
    const pitBaht = line.hrLineAdjustments?.pitWithholdingOverride;
    if (mode === 'manual_baht') {
      setWorkerPitMode('manual_baht');
      setPitManualBaht(pitBaht != null && Number.isFinite(pitBaht) ? String(pitBaht) : '');
    } else if (mode === 'auto_salary_base') {
      setWorkerPitMode('auto_salary_base');
      setPitAutoSalaryBase(base != null && Number.isFinite(base) ? String(base) : '');
    } else if (mode === 'auto_timesheet') {
      setWorkerPitMode('auto_timesheet');
      if (mr != null && Number.isFinite(mr) && Math.max(0, Math.min(35, mr)) < 35) {
        setAutoTimesheetUseFullTable(false);
        setAutoTimesheetMarginalRate(snapToStandardMarginalRate(mr));
      } else {
        setAutoTimesheetUseFullTable(true);
        setAutoTimesheetMarginalRate(35);
      }
    } else {
      if (mr != null && Number.isFinite(mr)) {
        setWorkerPitMode('auto_timesheet');
        const clamped = Math.max(0, Math.min(35, mr));
        if (clamped < 35) {
          setAutoTimesheetUseFullTable(false);
          setAutoTimesheetMarginalRate(snapToStandardMarginalRate(mr));
        } else {
          setAutoTimesheetUseFullTable(true);
          setAutoTimesheetMarginalRate(35);
        }
      } else if (pitBaht != null && Number.isFinite(pitBaht)) {
        setWorkerPitMode('manual_baht');
        setPitManualBaht(String(pitBaht));
      } else {
        setWorkerPitMode('auto_timesheet');
        setAutoTimesheetUseFullTable(true);
        setAutoTimesheetMarginalRate(35);
      }
    }
    setAdjNotes(line.hrLineAdjustments?.notes || '');
  }, [line]);

  useEffect(() => {
    if (!firestore || !line) {
      setTimesheets([]);
      setTsLoading(false);
      return;
    }
    const periodStart = line.periodStartDate;
    const periodEnd = line.periodEndDate;
    if (!periodStart || !periodEnd) {
      setTimesheets([]);
      setTsLoading(false);
      return;
    }
    let cancelled = false;
    setTsLoading(true);
    void (async () => {
      try {
        let rows = await loadWorkerPayableTimesheetsForPeriod(
          firestore,
          workerId,
          periodStart,
          periodEnd,
          { includePayrollLocked: true },
        );

        if (rows.length === 0 && line.sourceTimesheetIds?.length) {
          const uniqueTids = [...new Set(line.sourceTimesheetIds.filter(Boolean))];
          const snaps = await Promise.all(
            uniqueTids.map((tid) => getDoc(doc(firestore, 'daily_timesheets', tid))),
          );
          rows = [];
          for (const s of snaps) {
            if (s.exists()) rows.push({ id: s.id, ...(s.data() as object) } as DailyTimesheet);
          }
        }

        rows.sort((a, b) => a.date.localeCompare(b.date));
        if (!cancelled) setTimesheets(normalizeTimesheetsForPayrollLine(rows));
      } catch {
        if (!cancelled) setTimesheets([]);
      } finally {
        if (!cancelled) setTsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, line, workerId]);

  useEffect(() => {
    if (!firestore || timesheets.length === 0) {
      setGrossByTsId({});
      setGrossCtx(null);
      setGrossByTsLoading(false);
      return;
    }
    let cancelled = false;
    setGrossByTsLoading(true);
    void (async () => {
      try {
        const ctx = await buildSingleTimesheetGrossContext(firestore, timesheets);
        if (!ctx || cancelled) return;
        const map: Record<string, number> = {};
        for (const ts of timesheets) {
          const g = computeSingleTimesheetGrossLikeBatch(ts, ctx);
          if (g != null) map[ts.id] = g;
        }
        if (!cancelled) {
          setGrossByTsId(map);
          setGrossCtx(ctx);
        }
      } catch {
        if (!cancelled) {
          setGrossByTsId({});
          setGrossCtx(null);
        }
      } finally {
        if (!cancelled) setGrossByTsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, timesheets]);

  /** ยอดรายวันจากสูตร (ไม่บังคับให้เท่า snapshot ในงวด) */
  const dailyDisplay = useMemo(() => {
    if (!line || timesheets.length === 0) {
      return {
        byId: {} as Record<string, number>,
        total: 0,
        snapshotMismatch: false,
        allRowsFromFormula: false,
      };
    }
    const byId: Record<string, number> = {};
    let allFromFormula = true;
    for (const ts of timesheets) {
      const c = grossByTsId[ts.id];
      if (c == null || !Number.isFinite(c)) allFromFormula = false;
      const v =
        c != null && Number.isFinite(c) ? c : (allocatedAmountPerDayForEvent(line, ts.eventType) ?? 0);
      byId[ts.id] = v;
    }
    const total = Math.round(timesheets.reduce((s, ts) => s + (byId[ts.id] ?? 0), 0) * 100) / 100;
    const snapshotMismatch =
      allFromFormula && Math.abs(total - line.grossAmount) >= 0.02;
    return { byId, total, snapshotMismatch, allRowsFromFormula: allFromFormula };
  }, [line, timesheets, grossByTsId]);

  const allowancePreviewTotal = useMemo(
    () =>
      allowanceRows
        .filter((r) => r.label.trim() && Number(r.amount) > 0)
        .reduce((s, r) => s + (Number(r.amount) || 0), 0),
    [allowanceRows],
  );

  /** Gross จากตาราง + เบี้ยเลี้ยง (สอดคล้องช่องแรก — ไม่อิง snapshot งวด) */
  const grossAfterAllowancesPreview = useMemo(
    () => Math.max(0, dailyDisplay.total + allowancePreviewTotal),
    [dailyDisplay.total, allowancePreviewTotal],
  );

  const cashAdvanceRecoveryAmount = useMemo(
    () => Math.max(0, Number(line?.deductionsBreakdown?.[CASH_ADVANCE_PAYROLL_DEDUCTION_KEY]) || 0),
    [line?.deductionsBreakdown],
  );

  const [previewNet, setPreviewNet] = useState<number | null>(null);
  const [previewNetLoading, setPreviewNetLoading] = useState(false);
  /** ภงด. จากสูตร HR ณ ยอดตาราง+เบี้ยเลี้ยงปัจจุบัน (ไม่ใช่แค่ค่าที่บันทึกในงวด) */
  const [previewPitAuto, setPreviewPitAuto] = useState<number | null>(null);
  const [previewTaxPolicyName, setPreviewTaxPolicyName] = useState<string | null>(null);

  useEffect(() => {
    if (!firestore || !line || !period?.endDate) {
      setPreviewNet(null);
      setPreviewPitAuto(null);
      setPreviewTaxPolicyName(null);
      setPreviewNetLoading(false);
      return;
    }
    let cancelled = false;
    setPreviewNetLoading(true);
    void (async () => {
      try {
        const policies = await loadPayrollPoliciesFromFirestore(firestore);
        const resolved = resolvePayrollPoliciesForDate(period.endDate, policies, 'worker');
        const eg = Math.max(0, dailyDisplay.total + allowancePreviewTotal);
        const rateSummary = line.d8Snapshot?.rate;
        const d8Line = computeWorkerPayrollLineD8({
          asOfDate: period.endDate,
          policies: resolved,
          grossFromTimesheets: eg,
          rate: rateSummary
            ? {
                summary: rateSummary.summary,
                conditionIds: rateSummary.conditionIds,
                laborTermIds: rateSummary.laborTermIds,
              }
            : { summary: 'preview_table_gross' },
          earningsBreakdown: {
            ...line.earningsBreakdown,
            hr_allowances: allowancePreviewTotal,
          },
        });
        {
          let p = Number(d8Line.deductionsBreakdown.pit_withholding) || 0;
          if (workerPitMode === 'manual_baht') {
            p = Math.max(0, Number(pitManualBaht) || 0);
          } else if (workerPitMode === 'auto_salary_base') {
            p = pitFromMonthlyGross(
              Math.max(0, Number(pitAutoSalaryBase) || 0),
              resolved.tax,
              resolved.sso,
            );
          } else if (workerPitMode === 'auto_timesheet' && !autoTimesheetUseFullTable) {
            p = pitFromMonthlyGrossWithMarginalCeiling(
              eg,
              resolved.tax,
              resolved.sso,
              Math.max(0, Math.min(35, autoTimesheetMarginalRate)),
            );
          } else {
            p = pitFromMonthlyGross(eg, resolved.tax, resolved.sso);
          }
          if (!cancelled) {
            setPreviewPitAuto(p);
            setPreviewTaxPolicyName(resolved.tax?.name ?? null);
          }
        }
        const deductions: Record<string, number> = { ...d8Line.deductionsBreakdown };
        if (workerPitMode === 'manual_baht') {
          deductions.pit_withholding = Math.max(0, Number(pitManualBaht) || 0);
        } else if (workerPitMode === 'auto_salary_base') {
          deductions.pit_withholding = pitFromMonthlyGross(
            Math.max(0, Number(pitAutoSalaryBase) || 0),
            resolved.tax,
            resolved.sso,
          );
        } else if (workerPitMode === 'auto_timesheet' && !autoTimesheetUseFullTable) {
          deductions.pit_withholding = pitFromMonthlyGrossWithMarginalCeiling(
            eg,
            resolved.tax,
            resolved.sso,
            Math.max(0, Math.min(35, autoTimesheetMarginalRate)),
          );
        } else {
          deductions.pit_withholding = pitFromMonthlyGross(eg, resolved.tax, resolved.sso);
        }
        deductionRows
          .filter((r) => r.label.trim() && Number(r.amount) > 0)
          .forEach((d, idx) => {
            deductions[`manual_ded_${idx}`] = Math.max(0, Number(d.amount) || 0);
          });
        const caRecovery = Number(line.deductionsBreakdown?.[CASH_ADVANCE_PAYROLL_DEDUCTION_KEY]) || 0;
        if (caRecovery > 0) {
          deductions[CASH_ADVANCE_PAYROLL_DEDUCTION_KEY] = caRecovery;
        }
        const dedTotal = Object.values(deductions).reduce((a, b) => a + (Number(b) || 0), 0);
        const netAmount = Math.round((eg - dedTotal) * 100) / 100;
        if (!cancelled) setPreviewNet(netAmount);
      } catch {
        if (!cancelled) {
          setPreviewNet(null);
          setPreviewPitAuto(null);
          setPreviewTaxPolicyName(null);
        }
      } finally {
        if (!cancelled) setPreviewNetLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    firestore,
    line,
    period?.endDate,
    dailyDisplay.total,
    allowancePreviewTotal,
    deductionRows,
    workerPitMode,
    pitManualBaht,
    pitAutoSalaryBase,
    autoTimesheetUseFullTable,
    autoTimesheetMarginalRate,
  ]);

  const blockedEditStatuses = useMemo(
    () => ['PAID', 'LOCKED', 'FINANCE_PREPARED', 'PAYMENT_EXPORTED'],
    [],
  );
  const canSaveAdjustments =
    canEditHrAdjustments &&
    batch &&
    !blockedEditStatuses.includes(batch.status) &&
    line;

  const handleSave = useCallback(async () => {
    if (!firestore || !currentUser || !canSaveAdjustments) return;
    setSaving(true);
    try {
      const allowanceItems = allowanceRows
        .filter((r) => r.label.trim() && Number(r.amount) > 0)
        .map((r) => ({ label: r.label.trim(), amount: Number(r.amount) }));
      const deductionItems = deductionRows
        .filter((r) => r.label.trim() && Number(r.amount) > 0)
        .map((r) => ({ label: r.label.trim(), amount: Number(r.amount) }));

      const svc = new PayrollService(firestore);
      const marg =
        workerPitMode === 'auto_timesheet' && !autoTimesheetUseFullTable
          ? Math.max(0, Math.min(35, autoTimesheetMarginalRate))
          : null;
      await svc.applyWorkerLineHrAdjustments(batchId, workerId, currentUser as User, {
        allowanceItems,
        deductionItems,
        workerPitMode,
        pitWithholdingOverride:
          workerPitMode === 'manual_baht' ? Math.max(0, Number(pitManualBaht) || 0) : null,
        pitAutoSalaryBaseBaht:
          workerPitMode === 'auto_salary_base' ? Math.max(0, Number(pitAutoSalaryBase) || 0) : null,
        pitWithholdingOverrideMaxMarginalRatePercent: marg,
        notes: adjNotes.trim() ? adjNotes.trim() : null,
      });
      toast({
        title: 'บันทึกการปรับยอดแล้ว',
        description:
          workerPitMode === 'manual_baht'
            ? 'ใช้ยอดหัก ภงด. ตามจำนวนที่กำหนด — ประกันสังคมตามเงินได้จริง'
            : workerPitMode === 'auto_salary_base'
              ? 'หัก ภงด. จากฐานเงินเดือนที่ระบุ ตาม policy ใน HR'
              : 'หัก ภงด. ตามรายได้รวม (ตาราง+เบี้ยเลี้ยง) ของงวดนี้ ตาม HR settings',
      });
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'บันทึกไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  }, [
    firestore,
    currentUser,
    canSaveAdjustments,
    batchId,
    workerId,
    allowanceRows,
    deductionRows,
    workerPitMode,
    pitManualBaht,
    pitAutoSalaryBase,
    autoTimesheetUseFullTable,
    autoTimesheetMarginalRate,
    adjNotes,
    toast,
  ]);

  const handleRecalculateFromTimesheets = useCallback(async () => {
    if (!firestore || !currentUser || !canSaveAdjustments) return;
    setRecalcBusy(true);
    try {
      const svc = new PayrollService(firestore);
      await svc.recalculateWorkerPayrollLinePreserveHrAdjustments(batchId, workerId, currentUser as User);
      setRecalcOpen(false);
      toast({
        title: 'คำนวณใหม่รายคนแล้ว',
        description:
          'ยอดจากใบงานรายวันและสูตรปัจจุบัน — เบี้ยเลี้ยง หักพิเศษ ภงด. และหักเบิกล่วงหน้าที่บันทึกไว้ยังคงอยู่ (คนอื่นในงวดไม่เปลี่ยน)',
      });
      router.refresh();
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'คำนวณใหม่ไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setRecalcBusy(false);
    }
  }, [firestore, currentUser, canSaveAdjustments, batchId, workerId, toast, router]);

  /** ต้องอยู่ก่อน early return — ห้ามเรียก hooks หลัง return แบบมีเงื่อนไข */
  const slipModel = useMemo(() => {
    if (!line || !batch) return null;
    const pl = period?.label || batch.payrollPeriodId;
    const model = buildPayslipFromWorkerLine(line, batch, pl, companyProfile ?? undefined);
    if (timesheets.length > 0 && grossCtx) {
      const incomeLines = buildWorkerPayslipIncomeLinesFromTimesheets(line, timesheets, grossCtx);
      if (incomeLines.length > 0) {
        return { ...model, incomeLines };
      }
    }
    return model;
  }, [
    line,
    batch,
    period?.label,
    batch?.payrollPeriodId,
    companyProfile?.companyNameTh,
    companyProfile?.companyNameEn,
    timesheets,
    grossCtx,
  ]);
  const pitFromLine = Number(line?.deductionsBreakdown?.pit_withholding ?? 0);

  if (userLoading || batchLoading || lineLoading || !currentUser) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-12 w-12 text-primary animate-spin" />
      </div>
    );
  }
  if (!canViewBatch) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-5xl mx-auto py-10 text-center text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงเมนูนี้</div>
      </AppShell>
    );
  }
  if (!batch || !line) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-5xl mx-auto py-10 text-center text-muted-foreground">ไม่พบข้อมูลบรรทัดในงวดนี้</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-[1200px] mx-auto space-y-6 pb-10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Button variant="ghost" size="icon" onClick={() => router.push(`/payroll/batches/${batchId}`)}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <PayrollScopeTag scope="worker" showHint={false} />
              <h1 className="text-2xl font-bold tracking-tight mt-1">รายละเอียดค่าจ้างรายคน</h1>
              <p className="text-sm text-muted-foreground mt-1">
                <span className="font-mono text-primary">{batchId}</span>
                <span className="mx-2">·</span>
                {line.workerNameSnapshot}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/hr/settings">
                <Settings className="h-4 w-4 mr-2" />
                HR settings (ภาษี · ประกันสังคม)
              </Link>
            </Button>
            {canSaveAdjustments ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => setRecalcOpen(true)}>
                <RefreshCw className="h-4 w-4 mr-2" />
                คำนวณใหม่จากใบงาน (คนนี้เท่านั้น)
              </Button>
            ) : null}
            {slipModel ? <PayslipDialog model={slipModel} /> : null}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs uppercase text-muted-foreground">
                Gross (รวมจากตาราง — สูตรปัจจุบัน)
              </CardTitle>
              {dailyDisplay.snapshotMismatch ? (
                <CardDescription className="text-[11px] leading-snug text-amber-900">
                  ในงวด (snapshot ตอนสร้าง batch): ฿{line.grossAmount.toLocaleString()} — ต่างจากสูตร/PO ปัจจุบัน — ใช้ปุ่ม{' '}
                  <strong>คำนวณใหม่จากใบงาน (คนนี้เท่านั้น)</strong> เพื่ออัปเดตเฉพาะคนนี้โดยไม่ล้างการปรับยอดคนอื่น
                  หรือ Regenerate ทั้งงวดเมื่อต้องการให้ทุกคนตรงสูตรพร้อมกัน
                </CardDescription>
              ) : (
                <CardDescription className="text-[11px] text-muted-foreground">
                  ผลรวมจากยอดแต่ละวันในตาราง — สอดคล้อง snapshot งวดเมื่อยังไม่แก้ PO/สัญญาหลังสร้าง batch
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="text-2xl font-black text-primary">
              ฿{dailyDisplay.total.toLocaleString()}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs uppercase text-muted-foreground">รวมหลังเบี้ยเลี้ยง/ปรับ</CardTitle>
              <CardDescription className="text-[11px] text-muted-foreground">
                Gross จากตาราง + รายการเบี้ยเลี้ยงในฟอร์ม (สอดคล้องช่องแรก)
              </CardDescription>
            </CardHeader>
            <CardContent className="text-2xl font-black text-primary">
              ฿{grossAfterAllowancesPreview.toLocaleString()}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs uppercase text-muted-foreground">Net (ประมาณจากสูตรปัจจุบัน)</CardTitle>
              <CardDescription className="text-[11px] leading-snug">
                คำนวณจากยอดช่อง 2 ตาม HR settings + หัก ภงด. / หักพิเศษในฟอร์ม — ยอดบันทึกในงวด: ฿
                {line.netAmount.toLocaleString()}
                {dailyDisplay.snapshotMismatch ? (
                  <span className="block mt-1 text-amber-800">
                    หลัง Regenerate batch ยอดบันทึกจะตรงกับ preview นี้
                  </span>
                ) : null}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-2xl font-black text-emerald-700 flex items-center gap-2 min-h-[2.5rem]">
              {previewNetLoading ? (
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              ) : (
                <>฿{(previewNet ?? line.netAmount).toLocaleString()}</>
              )}
            </CardContent>
          </Card>
        </div>

        {line.d8Snapshot?.rate?.summary && (
          <Card className="border-dashed">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Calculator className="h-4 w-4" /> โครงสร้างอัตรา (สรุปจากงวด)
              </CardTitle>
              <CardDescription className="text-xs font-mono break-all">{line.d8Snapshot.rate.summary}</CardDescription>
            </CardHeader>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5" />
              รายวัน (ตรวจสอบ OT / วันอาทิตย์)
            </CardTitle>
            <CardDescription className="space-y-2">
              <p>
                คอลัมน์ <strong>ยอด (คำนวณ)</strong> ใช้สูตรเดียวกับการสร้าง Payroll Batch (แพ็กต้นทุน PO + ตัวคูณจากสัญญา)
                — ถ้าโหลดบริบทไม่ครบจะใช้ค่าเฉลี่ยจาก snapshot ในงวด
              </p>
              {dailyDisplay.snapshotMismatch && (
                <p className="text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 text-xs">
                  ผลรวมรายวันตามสูตรปัจจุบัน (฿{dailyDisplay.total.toLocaleString()}) ไม่เท่ากับที่บันทึกในงวด (฿
                  {line.grossAmount.toLocaleString()}) — ยอดรายวันด้านล่างสะท้อนสูตร/PO <strong>ปัจจุบัน</strong>
                  การหักภาษีในใบนี้ยังอิง Gross ใน snapshot จนกว่าจะ Regenerate หรือแก้ batch
                </p>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {tsLoading || grossByTsLoading ? (
              <div className="p-8 flex justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : timesheets.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground italic">ไม่พบรายการ timesheet อ้างอิง (อาจถูกลบหลังล็อก)</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead>วันที่</TableHead>
                    <TableHead>วัน</TableHead>
                    <TableHead>ประเภท</TableHead>
                    <TableHead className="text-right">ชม.ปกติ</TableHead>
                    <TableHead className="text-right">OT / อื่นๆ</TableHead>
                    <TableHead className="text-right tabular-nums">ยอด (คำนวณ)</TableHead>
                    <TableHead>หมายเหตุ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {timesheets.map((ts) => {
                    const dow = localWeekdayIndex(ts.date);
                    const isSun = dow === 0;
                    const computedRaw = grossByTsId[ts.id];
                    const dayAmt = dailyDisplay.byId[ts.id] ?? null;
                    const usedAverageFallback =
                      computedRaw == null && line && allocatedAmountPerDayForEvent(line, ts.eventType) != null;
                    const otBits = [
                      ts.ot15Hours ? `OT1.5 ${ts.ot15Hours}` : '',
                      ts.ot20Hours ? `OT2.0 ${ts.ot20Hours}` : '',
                      ts.ot30Hours ? `OT3.0 ${ts.ot30Hours}` : '',
                      ts.holidayHours ? `Holiday ${ts.holidayHours}` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ');
                    return (
                      <TableRow key={ts.id} className={isSun ? 'bg-amber-50/80' : ''}>
                        <TableCell className="font-mono text-sm">{formatDateThaiBE(ts.date)}</TableCell>
                        <TableCell>
                          {TH_WEEKDAYS[dow]}
                          {isSun && (
                            <Badge variant="secondary" className="ml-2 text-[10px]">
                              อาทิตย์
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          <div>{ts.eventType}</div>
                          <div className="text-[10px] uppercase text-muted-foreground mt-0.5">
                            {resolveEffectivePayrollJobMode(ts, grossCtx?.poWorkModeByPoId)}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{ts.normalHours ?? 0}</TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">{otBits || '—'}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums text-primary">
                          {dayAmt != null ? (
                            <>
                              ฿{dayAmt.toLocaleString()}
                              {usedAverageFallback && (
                                <span className="block text-[10px] font-normal text-muted-foreground">
                                  เฉลี่ยจาก snapshot
                                </span>
                              )}
                            </>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell className="text-xs max-w-[200px] truncate">{ts.remark || '—'}</TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="bg-muted/50 font-semibold border-t-2">
                    <TableCell colSpan={5} className="text-right py-3">
                      รวม (รายวันในตาราง)
                    </TableCell>
                    <TableCell className="text-right py-3 tabular-nums text-primary">
                      ฿{dailyDisplay.total.toLocaleString()}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>ปรับยอด (เบี้ยเลี้ยง / หักพิเศษ / ภาษี ณ ที่จ่าย)</CardTitle>
            <CardDescription>
              ระบบคำนวณประกันสังคมและภาษีเงินได้รายเดือนตาม{' '}
              <Link href="/hr/settings" className="underline font-medium">
                HR settings
              </Link>{' '}
              จากยอดรวมหลังเบี้ยเลี้ยง — สามารถกำหนดยอดหัก ภงด. เองได้ถ้าจำเป็น — ยอดหักคืนเบิกล่วงหน้า (ถ้ามี)
              ลด NET เท่านั้น ไม่ลดฐานคำนวณ ภงด.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {!canSaveAdjustments && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                {blockedEditStatuses.includes(batch.status)
                  ? 'งวดนี้ส่งบัญชีหรือจ่ายแล้ว — ไม่สามารถแก้ไขยอดรายคนจากหน้านี้'
                  : !canEditHrAdjustments
                    ? 'คุณไม่มีสิทธิ์แก้ไข batch'
                    : null}
              </p>
            )}

            <div className="space-y-3">
              <Label className="font-bold">เบี้ยเลี้ยง / รายได้พิเศษ (+)</Label>
              {allowanceRows.map((row, i) => (
                <div key={i} className="flex gap-2 items-end">
                  <div className="flex-1">
                    <Input
                      placeholder="รายการ"
                      value={row.label}
                      onChange={(e) => {
                        const next = [...allowanceRows];
                        next[i] = { ...next[i], label: e.target.value };
                        setAllowanceRows(next);
                      }}
                      disabled={!canSaveAdjustments}
                    />
                  </div>
                  <div className="w-32">
                    <Input
                      type="number"
                      placeholder="บาท"
                      value={row.amount}
                      onChange={(e) => {
                        const next = [...allowanceRows];
                        next[i] = { ...next[i], amount: e.target.value };
                        setAllowanceRows(next);
                      }}
                      disabled={!canSaveAdjustments}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={!canSaveAdjustments}
                    onClick={() => setAllowanceRows((rows) => rows.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canSaveAdjustments}
                onClick={() => setAllowanceRows((r) => [...r, { label: '', amount: '' }])}
              >
                <Plus className="h-4 w-4 mr-1" /> เพิ่มรายการ
              </Button>
            </div>

            <Separator />

            <div className="space-y-3">
              <Label className="font-bold">รายการหักเพิ่ม (นอกเหนือจาก SS / ภงด. อัตโนมัติ)</Label>
              {cashAdvanceRecoveryAmount > 0 ? (
                <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 space-y-1">
                  <div className="flex flex-wrap justify-between gap-2 items-center text-sm">
                    <span className="font-medium text-foreground">
                      หักคืนเบิกล่วงหน้า (อัตโนมัติ · จ่ายแล้วรอหักสลิป)
                    </span>
                    <span className="font-mono tabular-nums shrink-0">
                      −฿{cashAdvanceRecoveryAmount.toLocaleString()}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    ดึงจากงานเบิกล่วงหน้าที่ผูกหักในงวดนี้ — แก้ไขยอดได้ที่เมนูเบิกล่วงหน้า / บันทึกงวดใหม่เท่านั้น
                  </p>
                </div>
              ) : null}
              {deductionRows.map((row, i) => (
                <div key={i} className="flex gap-2 items-end">
                  <div className="flex-1">
                    <Input
                      placeholder="เช่น เงินกู้ ค่าปรับ"
                      value={row.label}
                      onChange={(e) => {
                        const next = [...deductionRows];
                        next[i] = { ...next[i], label: e.target.value };
                        setDeductionRows(next);
                      }}
                      disabled={!canSaveAdjustments}
                    />
                  </div>
                  <div className="w-32">
                    <Input
                      type="number"
                      placeholder="บาท"
                      value={row.amount}
                      onChange={(e) => {
                        const next = [...deductionRows];
                        next[i] = { ...next[i], amount: e.target.value };
                        setDeductionRows(next);
                      }}
                      disabled={!canSaveAdjustments}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={!canSaveAdjustments}
                    onClick={() => setDeductionRows((rows) => rows.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canSaveAdjustments}
                onClick={() => setDeductionRows((r) => [...r, { label: '', amount: '' }])}
              >
                <Plus className="h-4 w-4 mr-1" /> เพิ่มรายการหัก
              </Button>
            </div>

            <Separator />

            <div className="space-y-3">
              <div>
                <Label className="text-base font-bold">การหัก ภงด.1 (ภาษี ณ ที่จ่าย)</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  ประกันสังคมยังคำนวณจากรายได้จริง (ตาราง+เบี้ยเลี้ยง) ของรายนี้ — ช่องนี้กำหนดเฉพาะ ภงด. ฯ
                </p>
              </div>
              <RadioGroup
                value={workerPitMode}
                onValueChange={(v) => {
                  if (!canSaveAdjustments) return;
                  setWorkerPitMode(v as WorkerPitCalculationMode);
                }}
                className="space-y-2"
                disabled={!canSaveAdjustments}
              >
                <div
                  className={`rounded-md border p-3 space-y-2 ${!canSaveAdjustments ? 'opacity-70' : ''} ${workerPitMode === 'manual_baht' ? 'ring-1 ring-primary/30 bg-muted/20' : 'bg-card'}`}
                >
                  <div className="flex items-start gap-2">
                    <RadioGroupItem
                      value="manual_baht"
                      id="pit-manual"
                      className="mt-1"
                      disabled={!canSaveAdjustments}
                    />
                    <div className="space-y-2 flex-1">
                      <Label htmlFor="pit-manual" className="font-medium leading-snug cursor-pointer">
                        1) กำหนดเอง (บาท)
                      </Label>
                      <p className="text-[11px] text-muted-foreground">
                        ระบุยอดหักเป็นบาท ไม่ใช้ % — นำยอดนี้ไปลง ภงด. ฯ โดยตรง
                      </p>
                      {workerPitMode === 'manual_baht' && (
                        <div className="flex flex-wrap items-center gap-2 max-w-md">
                          <Input
                            type="number"
                            min={0}
                            className="w-40"
                            value={pitManualBaht}
                            onChange={(e) => setPitManualBaht(e.target.value)}
                            disabled={!canSaveAdjustments}
                            placeholder="เช่น 625"
                          />
                          <span className="text-sm text-muted-foreground">บาท / งวด</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div
                  className={`rounded-md border p-3 space-y-2 ${!canSaveAdjustments ? 'opacity-70' : ''} ${workerPitMode === 'auto_timesheet' ? 'ring-1 ring-primary/30 bg-muted/20' : 'bg-card'}`}
                >
                  <div className="flex items-start gap-2">
                    <RadioGroupItem
                      value="auto_timesheet"
                      id="pit-auto-ts"
                      className="mt-1"
                      disabled={!canSaveAdjustments}
                    />
                    <div className="space-y-2 flex-1">
                      <Label htmlFor="pit-auto-ts" className="font-medium leading-snug cursor-pointer">
                        2) อัตโนมัติ — ตามรายได้/ลงเวลา &quot;งวดนี้&quot;
                      </Label>
                      <p className="text-[11px] text-muted-foreground">
                        ฐานคำนวณ ภงด. = ยอด &quot;Gross หลังเบี้ยเลี้ยง&quot; บนหน้านี้ (ตาราง + เบี้ยเลี้ยง) —{' '}
                        <strong>ไม่หักเบิกล่วงหน้าก่อนคิดภาษี</strong> สอดคล้อง snapshot งวดเมื่อกดบันทึก
                      </p>
                    </div>
                  </div>
                </div>
                <div
                  className={`rounded-md border p-3 space-y-2 ${!canSaveAdjustments ? 'opacity-70' : ''} ${workerPitMode === 'auto_salary_base' ? 'ring-1 ring-primary/30 bg-muted/20' : 'bg-card'}`}
                >
                  <div className="flex items-start gap-2">
                    <RadioGroupItem
                      value="auto_salary_base"
                      id="pit-salary"
                      className="mt-1"
                      disabled={!canSaveAdjustments}
                    />
                    <div className="space-y-2 flex-1">
                      <Label htmlFor="pit-salary" className="font-medium leading-snug cursor-pointer">
                        3) อัตโนมัติ — ตามฐานเงินเดือนที่กำหนด (เช่น 45,000)
                      </Label>
                      <p className="text-[11px] text-muted-foreground">
                        ระบุ <strong>ฐานรายเดือนหนึ่งตัว</strong> นำไป x12, ลดหย่อน, ตารางขั้นบันได, หาร 12
                        ตามนโยบาย ภาษีใน HR (ไม่อ้างยอดจากตาราง/เวลา)
                      </p>
                      {workerPitMode === 'auto_salary_base' && (
                        <div className="flex flex-wrap items-center gap-2 max-w-md">
                          <Input
                            type="number"
                            min={0}
                            className="w-40"
                            value={pitAutoSalaryBase}
                            onChange={(e) => setPitAutoSalaryBase(e.target.value)}
                            disabled={!canSaveAdjustments}
                            placeholder="เช่น 45000"
                          />
                          <span className="text-sm text-muted-foreground">บาท/เดือน (ฐานคำนวณ ภงด. เท่านั้น)</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </RadioGroup>
              {workerPitMode === 'auto_timesheet' && (
                <div className="rounded-md border border-dashed bg-muted/20 px-3 py-2 space-y-2 max-w-xl">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="pit-legacy-marginal"
                      checked={!autoTimesheetUseFullTable}
                      onCheckedChange={(v) => setAutoTimesheetUseFullTable(v !== true)}
                      disabled={!canSaveAdjustments}
                    />
                    <Label htmlFor="pit-legacy-marginal" className="text-xs text-muted-foreground font-normal">
                      จำกัดเพดานอัตรา marginal สูงสุด (โหมดเวอร์ชันเก่า) — ปิด = คำนวณเต็มตาราง
                    </Label>
                  </div>
                  {!autoTimesheetUseFullTable && (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 pl-0 sm:pl-6">
                      <Label className="text-xs text-muted-foreground sm:w-48">
                        อัตรา marginal สูงสุดในตาราง (0–35%)
                      </Label>
                      <Select
                        value={String(autoTimesheetMarginalRate)}
                        onValueChange={(v) => setAutoTimesheetMarginalRate(Number(v))}
                        disabled={!canSaveAdjustments}
                      >
                        <SelectTrigger className="w-full sm:w-[200px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {THAI_PIT_STANDARD_MARGINAL_RATE_PERCENTS.map((pct) => (
                            <SelectItem key={pct} value={String(pct)}>
                              {pct}%
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              )}
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm space-y-1">
                <div className="flex justify-between gap-4 items-center">
                  <span>ยอดหัก ภงด. โดยประมาณ (สำหรับ net ด้านบน)</span>
                  <span className="font-mono tabular-nums shrink-0 text-foreground">
                    {previewNetLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin inline text-muted-foreground" />
                    ) : (
                      <>฿{(previewPitAuto ?? pitFromLine).toLocaleString()}</>
                    )}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  สูตร HR: th_pit_monthly_annualized ตามนโยบาย
                  {previewTaxPolicyName ? (
                    <span className="text-foreground/90"> «{previewTaxPolicyName}»</span>
                  ) : (
                    ' ใน HR settings'
                  )}{' '}
                  — ยอดที่บันทึกในงวดแล้ว: ฿{pitFromLine.toLocaleString()}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label>หมายเหตุ</Label>
              <Textarea
                value={adjNotes}
                onChange={(e) => setAdjNotes(e.target.value)}
                disabled={!canSaveAdjustments}
                rows={2}
              />
            </div>

            <div className="rounded-md border bg-muted/20 p-4 text-sm space-y-3">
              <div className="flex justify-between gap-4 font-medium">
                <span>รวมเพิ่ม (เบี้ยเลี้ยง / รายได้พิเศษ)</span>
                <span className="font-mono tabular-nums text-primary">
                  +฿{allowanceItemsTotal(line).toLocaleString()}
                </span>
              </div>
              <div className="space-y-1.5 border-t border-border/60 pt-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  รายการหัก
                </p>
                {deductionDisplayRows(line).map((row, i) => (
                  <div key={`${row.label}-${i}`} className="flex justify-between gap-4 text-sm">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className="font-mono tabular-nums">−฿{row.amount.toLocaleString()}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between gap-4 border-t border-border pt-3 font-medium">
                <span>หักรวม (SS + ภงด. + หักพิเศษ)</span>
                <span className="font-mono tabular-nums">฿{lineDeductionsTotal(line).toLocaleString()}</span>
              </div>
            </div>

            <Button type="button" disabled={!canSaveAdjustments || saving} onClick={() => void handleSave()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              บันทึกการปรับยอด
            </Button>
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={recalcOpen} onOpenChange={setRecalcOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>คำนวณใหม่จากใบงาน — เฉพาะคนนี้</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-sm text-muted-foreground space-y-2">
                <p>
                  ระบบจะดึงใบงานรายวันตาม <span className="font-mono">sourceTimesheetIds</span> แล้วคำนวณ Gross /
                  ประกันสังคม / ภงด. ชุดใหม่ตามสูตรและ HR settings <strong className="text-foreground">ปัจจุบัน</strong>
                </p>
                <p>
                  <strong className="text-foreground">จะคงไว้:</strong> รายการเบี้ยเลี้ยงและรายได้เพิ่ม รายการหักพิเศษ การตั้งค่า ภงด.
                  และยอดหักคืนเบิกล่วงหน้าที่บันทึกในงวดนี้แล้ว —{' '}
                  <strong className="text-foreground">ไม่กระทบ</strong> บรรทัดลูกจ้างคนอื่นในงวดเดียวกัน
                </p>
                <p className="text-xs opacity-90">
                  ถ้าต้องการล็อก timesheet ใหม่หรือดึงใบงานชุดใหม่ทั้งงวด ยังต้องใช้ Regenerate ทั้ง batch (ผู้ดูแลระบบ)
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={recalcBusy}>ยกเลิก</AlertDialogCancel>
            <Button type="button" disabled={recalcBusy} onClick={() => void handleRecalculateFromTimesheets()}>
              {recalcBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              ยืนยันคำนวณใหม่
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
