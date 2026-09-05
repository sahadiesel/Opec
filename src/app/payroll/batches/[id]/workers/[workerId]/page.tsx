'use client';

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Info,
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { doc, getDoc, collection, query, where, getDocs, updateDoc } from 'firebase/firestore';
import type {
  DailyTimesheet,
  PayrollBatch,
  PayrollBatchLine,
  PayrollBatchLineDailyRowSnapshot,
  PayrollPeriod,
  Position,
  User,
  WorkerPitCalculationMode,
} from '@/lib/types';
import { positionListPrimaryName } from '@/lib/position-display';
import { useRouter } from 'next/navigation';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccess, canPayrollPermission, canView, isMatrixControlledRole } from '@/lib/permissions';
import { isSystemAdmin } from '@/lib/permission-core';
import { isSimpleAdmin, isSimpleAccounting } from '@/lib/simple-tier-model';
import {
  loadPendingRetroForWorkerPayrollMonth,
  retroAdjustmentsToPriorPeriodItemsWithPay,
} from '@/lib/services/timesheet-retro-adjustment-service';
import { PayrollService } from '@/lib/services/payroll-service';
import { useToast } from '@/hooks/use-toast';
import { formatDateThaiBE, formatYmdLocalThaiBE } from '@/lib/date-thai';
import { PayslipDialog } from '@/components/payroll/payslip-dialog';
import { buildPayslipFromWorkerLine, normalizeIncomeSegments, isWorkerPayrollBatchSnapshotFrozen, payrollBatchChronologyMs, type PriorPaidPayrollSlipRef } from '@/lib/payroll/payslip-model';
import { formatPriorPeriodAllowancePayslipLabel } from '@/lib/payroll/prior-period-allowance';
import { useNormalBatchesAndLines } from '@/hooks/use-normal-batches-and-lines';
import { useCompanyDocumentProfile } from '@/hooks/use-company-document-profile';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import {
  loadPayrollPoliciesFromFirestore,
  resolvePayrollPoliciesForDate,
  computeWorkerPayrollLineD8,
  forceSupplementalNoSocialSecurity,
  resolveWorkerPitWithholdingBaht,
} from '@/lib/payroll/d8';
import { THAI_PIT_STANDARD_MARGINAL_RATE_PERCENTS } from '@/lib/hr/pit-thailand';
import { CASH_ADVANCE_PAYROLL_DEDUCTION_KEY } from '@/lib/payroll/cash-advance-recovery';
import { normalizeTimesheetsForPayrollLine } from '@/lib/payroll/dedupe-timesheets-for-payroll';
import { loadWorkerTimesheetsForPayrollLine } from '@/lib/payroll/filter-timesheets-for-worker-payroll';
import {
  buildPayrollLineDailyRowSnapshots,
  hasPositiveTimesheetGrossById,
  isUsableDailyRowSnapshots,
  lineNeedsFirstOpenSnapshotBackfill,
  loadDailyTimesheetsByIds,
  SNAPSHOT_BACKFILL_MISMATCH_NOTE,
} from '@/lib/payroll/payroll-line-daily-snapshots';
import { formatTimesheetWorkModePositionLabel } from '@/lib/payroll/work-day-payslip-split';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
  n += Number(eb[`${eventType}_package`]) || 0;
  return n;
}

/**
 * ยอดต่อวัน — ใช้ timesheetGrossById จาก snapshot ก่อน
 * fallback: หารยอดประเภทวันด้วยจำนวนแถวประเภทเดียวกันที่แสดง (ไม่ใช้ eventBreakdown ที่อาจไม่ตรง)
 */
function amountForTimesheetRow(
  line: PayrollBatchLine,
  ts: DailyTimesheet,
  dayCountByEvent: Record<string, number>,
): { amount: number; fromStoredDay: boolean; fromAverage: boolean } {
  const stored = Number(line.timesheetGrossById?.[ts.id]);
  if (Number.isFinite(stored) && stored > 0) {
    return { amount: Math.round(stored * 100) / 100, fromStoredDay: true, fromAverage: false };
  }
  const total = earningsTotalForEventType(line, ts.eventType);
  const count = Math.max(1, dayCountByEvent[ts.eventType] || 0);
  if (total <= 0) return { amount: 0, fromStoredDay: false, fromAverage: false };
  return {
    amount: Math.round((total / count) * 100) / 100,
    fromStoredDay: false,
    fromAverage: true,
  };
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
  /** false จนกว่าจะจำเป็นต้องโหลดใบงาน — งวดที่มี snapshot / จ่ายแล้วไม่ควรหมุนคำนวณตอนเปิด */
  const [tsLoading, setTsLoading] = useState(false);
  const [snapshotBackfillBusy, setSnapshotBackfillBusy] = useState(false);
  const snapshotBackfillInFlightRef = useRef<string | null>(null);
  const snapshotBackfillFailedRef = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [recalcOpen, setRecalcOpen] = useState(false);
  const [recalcBusy, setRecalcBusy] = useState(false);

  const [allowanceRows, setAllowanceRows] = useState<Array<{ label: string; amount: string }>>([
    { label: '', amount: '' },
  ]);
  const [priorPeriodRows, setPriorPeriodRows] = useState<
    Array<{ sourceYearMonth: string; label: string; amount: string }>
  >([{ sourceYearMonth: '', label: '', amount: '' }]);
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
  const [retroImportBusy, setRetroImportBusy] = useState(false);

  const [normalBatch, setNormalBatch] = useState<PayrollBatch | null>(null);
  const [normalLine, setNormalLine] = useState<PayrollBatchLine | null>(null);

  const { priorPaidRefs } = useNormalBatchesAndLines(batch?.payrollPeriodId, {
    isSupplemental: batch?.batchType === 'SUPPLEMENTAL',
    includePriorPaidForNormal: batch?.batchType !== 'SUPPLEMENTAL',
    currentBatchId: batch?.id,
    currentBatchStatus: batch?.status,
    currentBatchChronologyMs: batch ? payrollBatchChronologyMs(batch) : null,
    workerId,
  });

  useEffect(() => {
    if (!firestore || !batch || batch.batchType !== 'SUPPLEMENTAL') return;
    const fetchNormalData = async () => {
      try {
        const q = query(
          collection(firestore, 'payroll_batches'),
          where('payrollPeriodId', '==', batch.payrollPeriodId)
        );
        const snaps = await getDocs(q);
        if (!snaps.empty) {
          const normalDocs = snaps.docs.filter((d) => {
            const data = d.data();
            return !data.batchType || data.batchType === 'NORMAL';
          });
          
          for (const normalDoc of normalDocs) {
            const nb = { id: normalDoc.id, ...normalDoc.data() } as PayrollBatch;
            const nlSnap = await getDoc(
              doc(firestore, 'payroll_batches', nb.id, 'lines', `${nb.id}_${workerId}`)
            );
            if (nlSnap.exists()) {
              setNormalBatch(nb);
              setNormalLine({ id: nlSnap.id, ...nlSnap.data() } as PayrollBatchLine);
              break; // Found the batch containing this worker
            }
          }
        }
      } catch (err) {
        console.error('Failed to fetch normal batch data', err);
      }
    };
    fetchNormalData();
  }, [firestore, batch?.payrollPeriodId, batch?.batchType, workerId]);

  const payrollApplyYearMonth = useMemo(
    () => (period?.endDate ? period.endDate.slice(0, 7) : ''),
    [period?.endDate],
  );

  const handleImportRetroAdjustments = useCallback(async () => {
    if (!firestore || !payrollApplyYearMonth) return;
    setRetroImportBusy(true);
    try {
      const rows = await loadPendingRetroForWorkerPayrollMonth(
        firestore,
        workerId,
        payrollApplyYearMonth,
      );
      if (rows.length === 0) {
        toast({
          title: 'ไม่มีรายการแก้ไขย้อนหลัง',
          description: `ไม่พบรายการที่ตั้งจ่ายในงวด ${payrollApplyYearMonth}`,
        });
        return;
      }
      const imported = await retroAdjustmentsToPriorPeriodItemsWithPay(firestore, rows);
      const mapped = imported.map((it) => ({
        sourceYearMonth: it.sourceYearMonth,
        label: it.label,
        amount: String(it.amount),
      }));
      const kept = priorPeriodRows.filter(
        (r) => r.label.trim() || r.amount.trim() || r.sourceYearMonth.trim(),
      );
      const existingKeys = new Set(
        kept.map((r) => `${r.sourceYearMonth.trim()}|${r.label.trim()}|${r.amount.trim()}`),
      );
      const fresh = mapped.filter(
        (it) => !existingKeys.has(`${it.sourceYearMonth.trim()}|${it.label.trim()}|${it.amount.trim()}`),
      );
      if (fresh.length === 0) {
        toast({
          title: 'รายการแก้ไขย้อนหลังมีในสลิปแล้ว',
          description: `${imported.length} รายการถูกดึงไว้ก่อนหน้านี้แล้ว`,
        });
        return;
      }
      setPriorPeriodRows([...(kept.length ? kept : []), ...fresh]);
      const totalBaht = fresh.reduce((s, x) => s + (Number(x.amount) || 0), 0);
      toast({
        title: 'ดึงรายการแก้ไขย้อนหลังแล้ว',
        description: `เพิ่ม ${fresh.length} รายการ · รวม ฿${totalBaht.toLocaleString()} (คำนวณจากสูตร PO/ตำแหน่ง)`,
      });
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'ดึงรายการไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setRetroImportBusy(false);
    }
  }, [firestore, payrollApplyYearMonth, workerId, priorPeriodRows, toast]);

  useEffect(() => {
    if (!line) return;
    const a = line.hrLineAdjustments?.allowanceItems?.length
      ? line.hrLineAdjustments.allowanceItems.map((x) => ({
          label: x.label,
          amount: String(x.amount),
        }))
      : [{ label: '', amount: '' }];
    const pp = line.hrLineAdjustments?.priorPeriodAllowanceItems?.length
      ? line.hrLineAdjustments.priorPeriodAllowanceItems.map((x) => ({
          sourceYearMonth: x.sourceYearMonth,
          label: x.label,
          amount: String(x.amount),
        }))
      : [{ sourceYearMonth: '', label: '', amount: '' }];
    const d = line.hrLineAdjustments?.deductionItems?.length
      ? line.hrLineAdjustments.deductionItems.map((x) => ({
          label: x.label,
          amount: String(x.amount),
        }))
      : [{ label: '', amount: '' }];
    setAllowanceRows(a);
    setPriorPeriodRows(pp);
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

  /**
   * งวดจ่ายแล้วที่ยังไม่มี snapshot — ครั้งแรกที่เปิด ลอง reconstruct จากใบงาน
   * เก็บเฉพาะเมื่อ Gross/Net ตรงยอดที่จ่ายแล้ว · timeout กันค้างบน UI
   */
  useEffect(() => {
    if (!firestore || !currentUser || !line || !batch) return;
    if (batch.batchType === 'SUPPLEMENTAL') return;
    const immutable =
      batch.status === 'PAID' ||
      batch.status === 'LOCKED' ||
      batch.status === 'FINANCE_PREPARED' ||
      batch.status === 'PAYMENT_EXPORTED';
    if (!immutable) return;
    if (!lineNeedsFirstOpenSnapshotBackfill(line)) return;
    const key = `${batch.id}_${workerId}`;
    if (snapshotBackfillInFlightRef.current === key) return;
    if (snapshotBackfillFailedRef.current === key) return;
    snapshotBackfillInFlightRef.current = key;
    let cancelled = false;
    setSnapshotBackfillBusy(true);
    const UI_TIMEOUT_MS = 45_000;
    const uiTimer = window.setTimeout(() => {
      if (cancelled) return;
      snapshotBackfillFailedRef.current = key;
      if (snapshotBackfillInFlightRef.current === key) {
        snapshotBackfillInFlightRef.current = null;
      }
      setSnapshotBackfillBusy(false);
      if (lineRef && lineNeedsFirstOpenSnapshotBackfill(line)) {
        void updateDoc(lineRef as any, {
          snapshotBackfillStatus: 'mismatch',
          snapshotBackfillMismatchNote: SNAPSHOT_BACKFILL_MISMATCH_NOTE,
          snapshotBackfillAttemptedAt: Date.now(),
          updatedAt: Date.now(),
        }).catch(() => {});
      }
    }, UI_TIMEOUT_MS);
    void (async () => {
      try {
        const svc = new PayrollService(firestore);
        await svc.tryBackfillMissingPaidLineSnapshotsIfTotalsMatch(
          batch.id,
          workerId,
          currentUser as User,
        );
      } catch {
        snapshotBackfillFailedRef.current = key;
      } finally {
        window.clearTimeout(uiTimer);
        if (snapshotBackfillInFlightRef.current === key) {
          snapshotBackfillInFlightRef.current = null;
        }
        if (!cancelled) setSnapshotBackfillBusy(false);
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(uiTimer);
    };
  }, [firestore, currentUser, line, batch, workerId, lineRef]);

  useEffect(() => {
    if (!firestore || !line) {
      setTimesheets([]);
      setTsLoading(false);
      return;
    }
    /** งวดตกเบิก — ไม่โหลด/เฉลี่ยใบงานเดือนปัจจุบัน (รายได้จริงอยู่ที่ priorPeriodAllowanceItems) */
    if (batch?.batchType === 'SUPPLEMENTAL') {
      setTimesheets([]);
      setTsLoading(false);
      return;
    }
    /** มี snapshot รายวันที่ยอดใช้ได้แล้ว — ไม่โหลด daily_timesheets ตอนเปิดหน้า */
    if (isUsableDailyRowSnapshots(line.dailyRowSnapshots, line.grossAmount)) {
      setTimesheets([]);
      setTsLoading(false);
      return;
    }

    const immutable =
      batch?.status === 'PAID' ||
      batch?.status === 'LOCKED' ||
      batch?.status === 'FINANCE_PREPARED' ||
      batch?.status === 'PAYMENT_EXPORTED';

    const fromSource = (line.sourceTimesheetIds ?? []).map((id) => String(id || '').trim()).filter(Boolean);
    const fromGross = Object.keys(line.timesheetGrossById || {})
      .map((id) => String(id || '').trim())
      .filter(Boolean);
    const snapshotIds = [...new Set([...fromSource, ...fromGross])];

    /**
     * งวดจ่ายแล้ว/ล็อกแล้วที่ยังไม่มี dailyRowSnapshots ที่มียอด
     * — เติมได้เฉพาะเมื่อมี timesheetGrossById · ไม่โชว์แถวยอด 0 ทั้งตาราง
     * ถ้ายังรอ reconstruct ครั้งแรก ให้ค้างโหลดไว้ (effect ด้านบน)
     */
    if (immutable) {
      if (lineNeedsFirstOpenSnapshotBackfill(line) || snapshotBackfillBusy) {
        setTimesheets([]);
        return;
      }
      if (!hasPositiveTimesheetGrossById(line.timesheetGrossById) || snapshotIds.length === 0) {
        setTimesheets([]);
        setTsLoading(false);
        return;
      }
      let cancelled = false;
      setTsLoading(true);
      void (async () => {
        try {
          const rows = await loadDailyTimesheetsByIds(firestore, snapshotIds);
          if (cancelled) return;
          setTimesheets(normalizeTimesheetsForPayrollLine(rows));
        } catch {
          if (!cancelled) setTimesheets([]);
        } finally {
          if (!cancelled) setTsLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
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
        const rows = await loadWorkerTimesheetsForPayrollLine(
          firestore,
          workerId,
          periodStart,
          periodEnd,
          line.sourceTimesheetIds,
        );
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
  }, [firestore, line, workerId, batch?.batchType, batch?.status, snapshotBackfillBusy]);

  /**
   * งวดที่มี timesheetGrossById แต่ยังไม่มี dailyRowSnapshots ที่ใช้ได้
   * — โหลดใบงานครั้งเดียวแล้วเขียน snapshot กลับงวด เพื่อเปิดครั้งถัดไปโชว์ทันทีโดยไม่รอ
   */
  useEffect(() => {
    if (!firestore || !line || !lineRef) return;
    if (batch?.batchType === 'SUPPLEMENTAL') return;
    if (isUsableDailyRowSnapshots(line.dailyRowSnapshots, line.grossAmount)) return;
    if (!hasPositiveTimesheetGrossById(line.timesheetGrossById)) {
      if (snapshotBackfillBusy || lineNeedsFirstOpenSnapshotBackfill(line)) return;
      /** ล้าง snapshot ยอด 0 ที่เคยเขียนผิด */
      if ((line.dailyRowSnapshots?.length ?? 0) > 0) {
        void updateDoc(lineRef as any, { dailyRowSnapshots: [], updatedAt: Date.now() }).catch(() => {});
      }
      return;
    }
    if (timesheets.length === 0 || tsLoading) return;
    let cancelled = false;
    void (async () => {
      try {
        const { loadWorkersAndPositionsForPayroll } = await import(
          '@/lib/payroll/timesheet-labor-base-cost'
        );
        const { fetchWorkerGlobalLaborContextFromFirestore, workerGlobalLaborToPayrollRestSchedule } =
          await import('@/lib/payroll/worker-global-labor-policy');
        const { posById } = await loadWorkersAndPositionsForPayroll(firestore, timesheets);
        if (cancelled) return;
        const workerGlobalLabor = await fetchWorkerGlobalLaborContextFromFirestore(firestore);
        if (cancelled) return;
        const snaps = buildPayrollLineDailyRowSnapshots(timesheets, line.timesheetGrossById, {
          posById,
          payrollRestSchedule: workerGlobalLaborToPayrollRestSchedule(workerGlobalLabor),
        });
        if (cancelled || !isUsableDailyRowSnapshots(snaps, line.grossAmount)) return;
        await updateDoc(lineRef as any, {
          dailyRowSnapshots: snaps,
          updatedAt: Date.now(),
        });
      } catch {
        /* ignore heal errors — ยังโชว์จาก timesheets ได้ */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, line, lineRef, timesheets, tsLoading, batch?.batchType, snapshotBackfillBusy]);

  /** เติมชื่อตำแหน่งบน snapshot เก่า (ไม่แก้ยอด) — โชว์ Offshore - Fitter Foreman ในตารางรายวัน */
  const positionEnrichTriedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!firestore || !line || !lineRef) return;
    if (batch?.batchType === 'SUPPLEMENTAL') return;
    const snaps = line.dailyRowSnapshots;
    if (!isUsableDailyRowSnapshots(snaps, line.grossAmount)) return;
    const needsPosName = (snaps || []).some(
      (s) => String(s.eventType) === 'work_day' && !String(s.positionNameSnapshot || '').trim(),
    );
    if (!needsPosName) return;
    const key = `${line.payrollBatchId}_${line.workerId}`;
    if (positionEnrichTriedRef.current === key) return;
    positionEnrichTriedRef.current = key;

    const fromSource = (line.sourceTimesheetIds ?? []).map((id) => String(id || '').trim()).filter(Boolean);
    const fromGross = Object.keys(line.timesheetGrossById || {})
      .map((id) => String(id || '').trim())
      .filter(Boolean);
    const ids = [...new Set([...fromSource, ...fromGross])];
    if (ids.length === 0) return;

    let cancelled = false;
    void (async () => {
      try {
        const tsList = await loadDailyTimesheetsByIds(firestore, ids);
        if (cancelled || tsList.length === 0) return;
        const { loadWorkersAndPositionsForPayroll } = await import(
          '@/lib/payroll/timesheet-labor-base-cost'
        );
        const { fetchWorkerGlobalLaborContextFromFirestore, workerGlobalLaborToPayrollRestSchedule } =
          await import('@/lib/payroll/worker-global-labor-policy');
        const { posById } = await loadWorkersAndPositionsForPayroll(firestore, tsList);
        if (cancelled) return;
        const workerGlobalLabor = await fetchWorkerGlobalLaborContextFromFirestore(firestore);
        if (cancelled) return;
        const nextSnaps = buildPayrollLineDailyRowSnapshots(tsList, line.timesheetGrossById, {
          posById,
          payrollRestSchedule: workerGlobalLaborToPayrollRestSchedule(workerGlobalLabor),
        });
        if (!isUsableDailyRowSnapshots(nextSnaps, line.grossAmount)) return;
        await updateDoc(lineRef as any, {
          dailyRowSnapshots: nextSnaps,
          updatedAt: Date.now(),
        });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, line, lineRef, batch?.batchType]);

  type DailyRowView = {
    id: string;
    date: string;
    eventType: string;
    workMode?: string;
    positionId?: string;
    positionNameSnapshot?: string;
    normalHours: number;
    ot15Hours: number;
    ot20Hours: number;
    ot30Hours: number;
    holidayHours: number;
    amount: number;
    purchaseOrderId?: string;
    remark?: string;
    fromAverage: boolean;
  };

  /** แถวรายวัน — prefer snapshot ในงวด (เปิดหน้าทันที) */
  const dailyRows: DailyRowView[] = useMemo(() => {
    /** งวดตกเบิก — ไม่แสดงตารางรายวันเดือนปัจจุบัน (กันเฉลี่ยยอด OT ไปทับวัน Aug) */
    if (batch?.batchType === 'SUPPLEMENTAL') return [];
    const snaps = line?.dailyRowSnapshots;
    if (isUsableDailyRowSnapshots(snaps, line?.grossAmount)) {
      return [...(snaps || [])]
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .map((s: PayrollBatchLineDailyRowSnapshot) => ({
          id: s.timesheetId || `${s.date}_${s.eventType}`,
          date: s.date,
          eventType: String(s.eventType || ''),
          workMode: s.workMode ? String(s.workMode) : undefined,
          positionId: s.positionId ? String(s.positionId) : undefined,
          positionNameSnapshot: s.positionNameSnapshot ? String(s.positionNameSnapshot) : undefined,
          normalHours: Number(s.normalHours) || 0,
          ot15Hours: Number(s.ot15Hours) || 0,
          ot20Hours: Number(s.ot20Hours) || 0,
          ot30Hours: Number(s.ot30Hours) || 0,
          holidayHours: Number(s.holidayHours) || 0,
          amount: Number(s.amount) || 0,
          purchaseOrderId: s.purchaseOrderId,
          remark: s.remark,
          fromAverage: false,
        }));
    }
    /** งวดจ่ายแล้วที่ไม่มี timesheetGrossById — อย่าโชว์แถวใบงานที่ยอดว่าง */
    const immutable =
      batch?.status === 'PAID' ||
      batch?.status === 'LOCKED' ||
      batch?.status === 'FINANCE_PREPARED' ||
      batch?.status === 'PAYMENT_EXPORTED';
    if (immutable && !hasPositiveTimesheetGrossById(line?.timesheetGrossById)) {
      return [];
    }
    if (!line || timesheets.length === 0) return [];
    const dayCountByEvent: Record<string, number> = {};
    for (const ts of timesheets) {
      dayCountByEvent[ts.eventType] = (dayCountByEvent[ts.eventType] || 0) + 1;
    }
    return timesheets.map((ts) => {
      const row = amountForTimesheetRow(line, ts, dayCountByEvent);
      return {
        id: ts.id,
        date: ts.date,
        eventType: String(ts.eventType || ''),
        workMode: ts.workMode ? String(ts.workMode) : undefined,
        positionId: ts.positionId ? String(ts.positionId) : undefined,
        positionNameSnapshot: undefined,
        normalHours: Number(ts.normalHours) || 0,
        ot15Hours: Number(ts.ot15Hours) || 0,
        ot20Hours: Number(ts.ot20Hours) || 0,
        ot30Hours: Number(ts.ot30Hours) || 0,
        holidayHours: Number(ts.holidayHours) || 0,
        amount: row.amount,
        purchaseOrderId: (ts.purchaseOrderId || '').trim() || undefined,
        remark: (ts.remark || '').trim() || undefined,
        fromAverage: row.fromAverage,
      };
    });
  }, [line, timesheets, batch?.batchType, batch?.status]);

  const dailyDisplay = useMemo(
    () => ({
      total: Math.round(Number(line?.grossAmount || 0) * 100) / 100,
      rowCount: dailyRows.length,
    }),
    [line?.grossAmount, dailyRows.length],
  );

  const allowancePreviewTotal = useMemo(
    () =>
      allowanceRows
        .filter((r) => r.label.trim() && Number(r.amount) > 0)
        .reduce((s, r) => s + (Number(r.amount) || 0), 0) +
      priorPeriodRows
        .filter(
          (r) => /^\d{4}-\d{2}$/.test(r.sourceYearMonth.trim()) && r.label.trim() && Number(r.amount) > 0,
        )
        .reduce((s, r) => s + (Number(r.amount) || 0), 0),
    [allowanceRows, priorPeriodRows],
  );

  const regularAllowancePreviewTotal = useMemo(
    () =>
      allowanceRows
        .filter((r) => r.label.trim() && Number(r.amount) > 0)
        .reduce((s, r) => s + (Number(r.amount) || 0), 0),
    [allowanceRows],
  );

  const priorPeriodPreviewTotal = useMemo(
    () =>
      priorPeriodRows
        .filter(
          (r) => /^\d{4}-\d{2}$/.test(r.sourceYearMonth.trim()) && r.label.trim() && Number(r.amount) > 0,
        )
        .reduce((s, r) => s + (Number(r.amount) || 0), 0),
    [priorPeriodRows],
  );

  const isSupplementalBatch = batch?.batchType === 'SUPPLEMENTAL';

  /** Gross งวดตกเบิก/จ่ายแล้วต้นเดือนที่แนบบนสลิปชุดนี้ */
  const priorPaidGrossTotal = useMemo(
    () =>
      (priorPaidRefs as PriorPaidPayrollSlipRef[]).reduce(
        (s, r) => s + Math.max(0, Number(r.line.grossAmount) || 0),
        0,
      ),
    [priorPaidRefs],
  );

  /** Gross จากงวด + เบี้ยเลี้ยงในฟอร์ม + รายได้ตกเบิกที่จ่ายแล้ว (preview รวมตรงสลิป) */
  const grossAfterAllowancesPreview = useMemo(() => {
    if (isSupplementalBatch) {
      return Math.max(0, priorPeriodPreviewTotal + regularAllowancePreviewTotal);
    }
    return Math.max(
      0,
      (Number(line?.grossAmount) || 0) + allowancePreviewTotal + priorPaidGrossTotal,
    );
  }, [
    isSupplementalBatch,
    priorPeriodPreviewTotal,
    regularAllowancePreviewTotal,
    line?.grossAmount,
    allowancePreviewTotal,
    priorPaidGrossTotal,
  ]);

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
        const isSupplemental = batch?.batchType === 'SUPPLEMENTAL';
        const eg = isSupplemental
          ? Math.max(0, priorPeriodPreviewTotal + regularAllowancePreviewTotal)
          : Math.max(0, Number(line.grossAmount) || 0) + allowancePreviewTotal;
        const hrAllow = isSupplemental ? regularAllowancePreviewTotal : allowancePreviewTotal;
        const priorPaidTaxableGross = isSupplemental
          ? Math.max(0, Number(normalLine?.grossAmount) || 0)
          : 0;
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
            ...(hrAllow > 0 ? { hr_allowances: hrAllow } : {}),
          },
          batchType: isSupplemental ? 'SUPPLEMENTAL' : 'NORMAL',
          priorPaidTaxableGross,
        });
        const marg =
          workerPitMode === 'auto_timesheet' && !autoTimesheetUseFullTable
            ? Math.max(0, Math.min(35, autoTimesheetMarginalRate))
            : null;
        let p = resolveWorkerPitWithholdingBaht({
          mode: workerPitMode,
          effectiveGross: eg,
          policies: resolved,
          socialSecurityBaht:
            (Number(d8Line.deductionsBreakdown.social_security) || 0) +
            (Number(d8Line.deductionsBreakdown.employee_assistance_fund) || 0),
          isSupplemental: !!isSupplemental,
          priorPaidTaxableGross,
          pitWithholdingOverride: pitManualBaht,
          pitAutoSalaryBaseBaht: pitAutoSalaryBase,
          maxMarginalRatePercent: marg,
        });
        if (!cancelled) {
          setPreviewPitAuto(p);
          setPreviewTaxPolicyName(resolved.tax?.name ?? null);
        }
        let deductions: Record<string, number> = { ...d8Line.deductionsBreakdown };
        deductions.pit_withholding = p;
        if (isSupplemental) {
          deductions = forceSupplementalNoSocialSecurity(deductions);
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
    batch?.batchType,
    normalLine?.grossAmount,
    allowancePreviewTotal,
    regularAllowancePreviewTotal,
    priorPeriodPreviewTotal,
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
      const priorPeriodAllowanceItems = priorPeriodRows
        .filter(
          (r) => /^\d{4}-\d{2}$/.test(r.sourceYearMonth.trim()) && r.label.trim() && Number(r.amount) > 0,
        )
        .map((r) => ({
          sourceYearMonth: r.sourceYearMonth.trim(),
          label: r.label.trim(),
          amount: Number(r.amount),
        }));
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
        priorPeriodAllowanceItems,
        deductionItems,
        workerPitMode,
        pitWithholdingOverride:
          workerPitMode === 'manual_baht' ? Math.max(0, Number(pitManualBaht) || 0) : null,
        pitAutoSalaryBaseBaht:
          workerPitMode === 'auto_salary_base' ? Math.max(0, Number(pitAutoSalaryBase) || 0) : null,
        pitWithholdingOverrideMaxMarginalRatePercent: marg,
        notes: adjNotes.trim() ? adjNotes.trim() : undefined,
      });
      toast({
        title: 'บันทึกการปรับยอดแล้ว',
        description: batch?.batchType === 'SUPPLEMENTAL'
          ? 'งวดตกเบิก: ไม่หักประกันสังคม · ภงด. ตามเกณฑ์ปกติ (ถ้าถึงเกณฑ์)'
          : workerPitMode === 'manual_baht'
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
    priorPeriodRows,
    deductionRows,
    workerPitMode,
    pitManualBaht,
    pitAutoSalaryBase,
    autoTimesheetUseFullTable,
    autoTimesheetMarginalRate,
    adjNotes,
    toast,
    batch?.batchType,
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

  const [poMetaById, setPoMetaById] = useState<Map<string, { poCode: string; customerName?: string }>>(
    () => new Map(),
  );

  useEffect(() => {
    if (!firestore) {
      setPoMetaById(new Map());
      return;
    }
    const fromTs = timesheets.map((t) => String(t.purchaseOrderId || '').trim());
    const fromSnap = (line?.dailyRowSnapshots || []).map((s) => String(s.purchaseOrderId || '').trim());
    const fromSeg = normalizeIncomeSegments(line?.incomeSegments).map((s) =>
      String(s.purchaseOrderId || '').trim(),
    );
    const ids = [...new Set([...fromTs, ...fromSnap, ...fromSeg].filter(Boolean))];
    if (ids.length === 0) {
      setPoMetaById(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      const m = new Map<string, { poCode: string; customerName?: string }>();
      await Promise.all(
        ids.map(async (pid) => {
          try {
            const poSnap = await getDoc(doc(firestore, 'purchase_orders', pid));
            if (!poSnap.exists()) {
              m.set(pid, { poCode: pid });
              return;
            }
            const po = poSnap.data() as { poCode?: string; customerId?: string };
            const poCode = (po.poCode || '').trim() || pid;
            let customerName: string | undefined;
            const cid = (po.customerId || '').trim();
            if (cid) {
              const cSnap = await getDoc(doc(firestore, 'customers', cid));
              if (cSnap.exists()) {
                customerName = String((cSnap.data() as { name?: string }).name || '').trim() || undefined;
              }
            }
            m.set(pid, { poCode, customerName });
          } catch {
            m.set(pid, { poCode: pid });
          }
        }),
      );
      if (!cancelled) setPoMetaById(m);
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, timesheets, line?.incomeSegments, line?.dailyRowSnapshots]);

  /** ชื่อลูกค้า/สัญญาสำหรับสลิป — ไม่ใช้ Firestore id */
  const poPartyLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const seg of normalizeIncomeSegments(line?.incomeSegments)) {
      const id = String(seg.purchaseOrderId || '').trim();
      if (!id) continue;
      const cust = seg.customerNameSnapshot?.trim();
      const po = seg.poCodeSnapshot?.trim();
      if (cust) m.set(id, cust);
      else if (po) m.set(id, po);
    }
    for (const [id, meta] of poMetaById) {
      if (meta.customerName?.trim()) m.set(id, meta.customerName.trim());
      else if (!m.has(id) && meta.poCode?.trim()) m.set(id, meta.poCode.trim());
    }
    return m;
  }, [line?.incomeSegments, poMetaById]);

  /** สลิปจาก snapshot ในงวดเท่านั้น — ไม่ทับด้วยสูตรสดตอนเปิดหน้า */
  const [fallbackPositionName, setFallbackPositionName] = useState<string | undefined>();
  useEffect(() => {
    if (!firestore || !line) {
      setFallbackPositionName(undefined);
      return;
    }
    const fromSnaps = (line.dailyRowSnapshots ?? [])
      .map((s) => String(s.positionNameSnapshot || '').trim())
      .find((n) => n && n !== 'ไม่ระบุตำแหน่ง');
    if (fromSnaps) {
      setFallbackPositionName(fromSnaps);
      return;
    }
    const fromSplits = (line.payslipWorkDayPositionSplits ?? [])
      .map((s) => String(s.positionNameSnapshot || '').trim())
      .find((n) => n && n !== 'ไม่ระบุตำแหน่ง');
    if (fromSplits) {
      setFallbackPositionName(fromSplits);
      return;
    }
    const posId =
      String(line.laborCostResolutionSnapshot?.positionId || '').trim() ||
      String(
        (line.dailyRowSnapshots ?? []).find((s) => String(s.positionId || '').trim())?.positionId ||
          '',
      ).trim();
    if (!posId) {
      setFallbackPositionName(undefined);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const snap = await getDoc(doc(firestore, 'positions', posId));
        if (cancelled || !snap.exists()) return;
        const name = positionListPrimaryName(snap.data() as Position).trim();
        if (name) setFallbackPositionName(name);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, line]);

  const slipModel = useMemo(() => {
    if (!line || !batch) return null;
    const pl = period?.label || batch.payrollPeriodId;
    const hasEarlier = (priorPaidRefs as PriorPaidPayrollSlipRef[]).length > 0;
    const frozen = isWorkerPayrollBatchSnapshotFrozen(batch, {
      hasEarlierPaidInPeriod: hasEarlier,
    });
    const positionNameById = new Map<string, string>();
    for (const s of line.dailyRowSnapshots ?? []) {
      const id = String(s.positionId || '').trim();
      const name = String(s.positionNameSnapshot || '').trim();
      if (id && name && name !== 'ไม่ระบุตำแหน่ง') positionNameById.set(id, name);
    }
    for (const s of line.payslipWorkDayPositionSplits ?? []) {
      const id = String(s.positionId || '').trim();
      const name = String(s.positionNameSnapshot || '').trim();
      if (id && name && name !== 'ไม่ระบุตำแหน่ง') positionNameById.set(id, name);
    }
    const laborPosId = String(line.laborCostResolutionSnapshot?.positionId || '').trim();
    if (laborPosId && fallbackPositionName && !positionNameById.has(laborPosId)) {
      positionNameById.set(laborPosId, fallbackPositionName);
    }
    return buildPayslipFromWorkerLine(
      line,
      batch,
      pl,
      companyProfile ?? undefined,
      normalLine,
      normalBatch,
      priorPaidRefs as PriorPaidPayrollSlipRef[],
      frozen ? undefined : poPartyLabelById,
      {
        positionNameById: positionNameById.size > 0 ? positionNameById : undefined,
        fallbackPositionName,
      },
    );
  }, [
    line,
    batch,
    period?.label,
    batch?.payrollPeriodId,
    companyProfile?.companyNameTh,
    companyProfile?.companyNameEn,
    normalLine,
    normalBatch,
    priorPaidRefs,
    poPartyLabelById,
    fallbackPositionName,
  ]);

  /** ยอดที่แสดงทั้งหน้า = snapshot ในงวด (ตรงหน้า batch / ปุ่มสร้างงวด) */
  const displaySlip = useMemo(() => slipModel, [slipModel]);

  /**
   * รวมรายได้บนการ์ด/กล่องสรุป — ตรงสลิป (รวมตกเบิก)
   * ตอนแก้เบี้ยเลี้ยงในฟอร์มยังไม่บันทึก ใช้ preview ที่บวก delta
   */
  const pageIncomeTotal = useMemo(() => {
    if (isSupplementalBatch) return grossAfterAllowancesPreview;
    const savedAllow = line ? allowanceItemsTotal(line) : 0;
    const allowDelta = allowancePreviewTotal - savedAllow;
    if (displaySlip && Math.abs(allowDelta) < 0.005) {
      return displaySlip.grossTotal;
    }
    if (displaySlip) {
      return Math.max(0, Math.round((displaySlip.grossTotal + allowDelta) * 100) / 100);
    }
    return grossAfterAllowancesPreview;
  }, [
    isSupplementalBatch,
    grossAfterAllowancesPreview,
    displaySlip,
    line,
    allowancePreviewTotal,
  ]);

  const priorPaidNetTotal = useMemo(
    () =>
      (priorPaidRefs as PriorPaidPayrollSlipRef[]).reduce(
        (s, r) => s + Math.max(0, Number(r.line.netAmount) || 0),
        0,
      ),
    [priorPaidRefs],
  );

  const pitFromLine = Number(line?.deductionsBreakdown?.pit_withholding ?? 0);

  const poSourceLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const [id, party] of poPartyLabelById) {
      if (party.trim()) m.set(id, party.trim());
    }
    for (const seg of normalizeIncomeSegments(line?.incomeSegments)) {
      const id = String(seg.purchaseOrderId || '').trim();
      if (!id || m.has(id)) continue;
      const cust = seg.customerNameSnapshot?.trim();
      const po = seg.poCodeSnapshot?.trim();
      if (cust) m.set(id, cust);
      else if (po) m.set(id, po);
    }
    for (const [id, meta] of poMetaById) {
      if (m.has(id)) continue;
      if (meta.customerName?.trim()) m.set(id, meta.customerName.trim());
      else if (meta.poCode?.trim()) m.set(id, meta.poCode.trim());
    }
    return m;
  }, [line?.incomeSegments, poMetaById, poPartyLabelById]);

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
            {canSaveAdjustments && batch?.batchType !== 'SUPPLEMENTAL' ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => setRecalcOpen(true)}>
                <RefreshCw className="h-4 w-4 mr-2" />
                คำนวณใหม่จากใบงาน (คนนี้เท่านั้น)
              </Button>
            ) : null}
            {displaySlip ? <PayslipDialog model={displaySlip} /> : null}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs uppercase text-muted-foreground">
                Gross (ยอดบันทึกในงวด)
              </CardTitle>
              <CardDescription className="text-[11px] leading-snug text-muted-foreground">
                จากตอนสร้างงวด (เริ่มการประมวลผล) — เปิดหน้านี้ไม่คำนวณซ้ำ
              </CardDescription>
            </CardHeader>
            <CardContent className="text-2xl font-black text-primary">
              ฿{line.grossAmount.toLocaleString()}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs uppercase text-muted-foreground">รวมรายได้ (ตรงสลิป)</CardTitle>
              <CardDescription className="text-[11px] text-muted-foreground">
                {priorPaidGrossTotal > 0.005
                  ? 'Gross งวด + เบี้ยเลี้ยง + รายได้ตกเบิกที่จ่ายแล้วต้นเดือน'
                  : 'Gross งวด + รายการเบี้ยเลี้ยงในฟอร์ม (preview ตอนแก้)'}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-2xl font-black text-primary">
              ฿{pageIncomeTotal.toLocaleString()}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs uppercase text-muted-foreground">Net (ยอดตรงสลิป)</CardTitle>
              <CardDescription className="text-[11px] leading-snug">
                {priorPaidNetTotal > 0.005
                  ? `หลังหักยอดที่ชำระไปแล้ว ฿${priorPaidNetTotal.toLocaleString()} · บันทึกในงวด ฿${line.netAmount.toLocaleString()}`
                  : `ตรงกับหน้า batch / สลิป · ฿${line.netAmount.toLocaleString()}`}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-2xl font-black text-emerald-700 flex items-center gap-2 min-h-[2.5rem]">
              <>฿{(displaySlip?.netPay ?? line.netAmount).toLocaleString()}</>
            </CardContent>
          </Card>
        </div>

        {line.d8Snapshot?.rate?.summary && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Info className="h-3.5 w-3.5 text-blue-600" />
                  <Calculator className="h-3.5 w-3.5" />
                  โครงสร้างอัตรา
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[min(28rem,92vw)] max-h-[min(50vh,20rem)] overflow-y-auto p-3">
                <p className="font-semibold text-sm mb-1.5">โครงสร้างอัตรา (สรุปจากงวด)</p>
                <p className="text-[11px] font-mono break-all leading-snug text-muted-foreground">
                  {line.d8Snapshot.rate.summary}
                </p>
              </PopoverContent>
            </Popover>
          </div>
        )}

        {(priorPaidRefs as PriorPaidPayrollSlipRef[]).length > 0 && (
          <Card className="border-sky-200 bg-sky-50/40">
            <CardHeader>
              <CardTitle className="text-base text-sky-950">
                รายได้ตกเบิก / งวดที่จ่ายแล้วต้นเดือน
              </CardTitle>
              <CardDescription className="text-sky-900/80">
                รวมตกเบิกเดือนก่อนที่จ่ายในเดือนนี้ และงวดปกติที่จ่ายไปแล้ว — เป็นรายรับของเดือนเดียวกัน · สลิปรอบนี้หักสุทธิงวดนั้นออก
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {(priorPaidRefs as PriorPaidPayrollSlipRef[]).map((ref) => {
                const retro = (ref.line.hrLineAdjustments?.priorPeriodAllowanceItems ?? []).filter(
                  (it) => Number(it.amount) > 0,
                );
                const days = ref.line.dailyRowSnapshots ?? [];
                const byId = ref.line.timesheetGrossById ?? {};
                const dayEntries =
                  days.length > 0
                    ? days.map((d) => ({
                        date: d.date,
                        eventType: d.eventType,
                        amount: Number(d.amount) || 0,
                      }))
                    : Object.entries(byId).map(([id, amount]) => ({
                        date: id,
                        eventType: 'timesheet',
                        amount: Number(amount) || 0,
                      }));
                return (
                  <div key={ref.batch.id} className="rounded-md border border-sky-200 bg-white p-3 space-y-3">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      <span className="font-mono text-muted-foreground">{ref.batch.id}</span>
                      <span>
                        Gross ฿{Number(ref.line.grossAmount || 0).toLocaleString()} · Net ฿
                        {Number(ref.line.netAmount || 0).toLocaleString()}
                      </span>
                    </div>
                    {retro.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-sky-900 mb-1">OT / รายได้ย้อนหลังในงวดนั้น</p>
                        <ul className="text-sm space-y-1">
                          {retro.map((it, i) => (
                            <li key={i} className="flex justify-between gap-3">
                              <span>{formatPriorPeriodAllowancePayslipLabel(it)}</span>
                              <span className="tabular-nums font-medium">
                                ฿{Number(it.amount).toLocaleString()}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {dayEntries.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-sky-900 mb-1">รายวันที่จ่ายในงวดนั้น</p>
                        <ul className="text-sm space-y-1 max-h-40 overflow-y-auto">
                          {dayEntries.map((d, i) => (
                            <li key={i} className="flex justify-between gap-3">
                              <span>
                                {/^\d{4}-\d{2}-\d{2}$/.test(d.date)
                                  ? formatYmdLocalThaiBE(d.date)
                                  : d.date}{' '}
                                · {d.eventType}
                              </span>
                              <span className="tabular-nums">฿{d.amount.toLocaleString()}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {retro.length === 0 && dayEntries.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        ไม่มีรายละเอียดรายวัน/ตกเบิกใน snapshot งวดนี้ — ยังหักสุทธิ ฿
                        {Number(ref.line.netAmount || 0).toLocaleString()} จากสลิปรอบหลัง
                      </p>
                    )}
                  </div>
                );
              })}
            </CardContent>
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
                คอลัมน์ <strong>ยอด (จากงวด)</strong> = snapshot ที่เก็บตอน「เริ่มการประมวลผล」—
                เปิดหน้าโชว์ทันที ไม่คำนวณ/ไม่โหลดใบงานซ้ำ
              </p>
              <p className="text-xs text-muted-foreground">
                ปุ่ม「คำนวณใหม่จากใบงาน」ใช้เฉพาะเมื่อต้องการอัปเดตยอดหลังแก้ใบงาน/สูตร — ไม่จำเป็นตอนเปิดดู
              </p>
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {snapshotBackfillBusy || (tsLoading && dailyRows.length === 0) ? (
              <div className="p-8 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin" />
                <p className="text-sm">
                  {snapshotBackfillBusy
                    ? 'กำลังเทียบยอดจากใบงานกับตัวเลขที่จ่ายแล้ว เพื่อสร้าง snapshot…'
                    : 'กำลังโหลดรายวันจากใบงานที่บันทึกในงวด…'}
                </p>
              </div>
            ) : dailyRows.length === 0 ? (
              <div className="p-6 space-y-2 text-sm text-muted-foreground">
                {isSupplementalBatch ? (
                  <p className="italic">
                    งวดตกเบิก — ไม่มีค่าแรงรายวันเดือนปัจจุบันในงวดนี้ · ดูรายการที่ส่วน「รายได้ย้อนหลัง」ด้านล่าง
                  </p>
                ) : line?.snapshotBackfillStatus === 'mismatch' ? (
                  <>
                    <p className="not-italic text-amber-900">
                      {line.snapshotBackfillMismatchNote?.trim() || SNAPSHOT_BACKFILL_MISMATCH_NOTE}
                    </p>
                    <p className="italic">
                      ไม่ได้บันทึก snapshot รายวัน · ยอด Gross/Net ด้านบนคือยอดที่จ่ายจริง ไม่ได้ถูกแก้
                      {Number.isFinite(Number(line.snapshotBackfillComputedGross)) ||
                      Number.isFinite(Number(line.snapshotBackfillComputedNet)) ? (
                        <>
                          {' '}
                          (คำนวณใหม่ Gross ฿
                          {Number(line.snapshotBackfillComputedGross || 0).toLocaleString()} · Net ฿
                          {Number(line.snapshotBackfillComputedNet || 0).toLocaleString()})
                        </>
                      ) : null}
                    </p>
                  </>
                ) : batch?.status === 'PAID' || batch?.status === 'LOCKED' ? (
                  <p className="italic">
                    งวดนี้จ่าย/ล็อกแล้ว — ไม่มียอดรายวันเก็บในงวด (ข้อมูลเก่าก่อนมี snapshot) · ยอด Gross/Net
                    ด้านบนคือยอดที่จ่ายจริง ไม่ต้องคำนวณใหม่
                  </p>
                ) : (
                  <p className="italic">ไม่พบรายการ timesheet อ้างอิง (อาจถูกลบหลังล็อก)</p>
                )}
              </div>
            ) : (
              <Table className="[&_th]:h-10 [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2.5 [&_td]:align-middle">
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="text-xs py-2">วันที่</TableHead>
                    <TableHead className="text-xs py-2">วัน</TableHead>
                    <TableHead className="text-xs py-2">ประเภท</TableHead>
                    <TableHead className="text-right text-xs py-2">ชม.ปกติ</TableHead>
                    <TableHead className="text-right text-xs py-2">OT / อื่นๆ</TableHead>
                    <TableHead className="text-right tabular-nums text-xs py-2">ยอด (จากงวด)</TableHead>
                    <TableHead className="text-xs py-2">แหล่ง / หมายเหตุ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dailyRows.map((row) => {
                    const dow = localWeekdayIndex(row.date);
                    const isSun = dow === 0;
                    const dayAmt = row.amount;
                    const usedAverageFallback = row.fromAverage;
                    const otBits = [
                      row.ot15Hours ? `OT1.5 ${row.ot15Hours}` : '',
                      row.ot20Hours ? `OT2.0 ${row.ot20Hours}` : '',
                      row.ot30Hours ? `OT3.0 ${row.ot30Hours}` : '',
                      row.holidayHours ? `Holiday ${row.holidayHours}` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ');
                    const modePosLabel =
                      formatTimesheetWorkModePositionLabel(row.workMode, row.positionNameSnapshot) ||
                      (String(row.workMode || '').toUpperCase().includes('ON')
                        ? 'ONSHORE'
                        : row.workMode
                          ? 'OFFSHORE'
                          : '');
                    return (
                      <TableRow key={row.id} className={`${isSun ? 'bg-amber-50/80' : ''} h-9`}>
                        <TableCell className="font-mono text-xs py-1.5">{formatDateThaiBE(row.date)}</TableCell>
                        <TableCell className="leading-tight text-xs py-1.5">
                          {TH_WEEKDAYS[dow]}
                          {isSun && (
                            <Badge variant="secondary" className="ml-1.5 text-[9px] px-1 py-0">
                              อาทิตย์
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs leading-tight py-1.5">
                          <div>{row.eventType}</div>
                          {modePosLabel ? (
                            <div className="text-[10px] text-muted-foreground leading-tight">
                              {modePosLabel}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right text-xs py-1.5">{row.normalHours ?? 0}</TableCell>
                        <TableCell className="text-right text-[11px] text-muted-foreground py-1.5">
                          {otBits || '—'}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums text-primary leading-tight text-xs py-1.5">
                          {dayAmt > 0 ? (
                            <>
                              ฿{dayAmt.toLocaleString()}
                              {usedAverageFallback && (
                                <span className="block text-[9px] font-normal text-muted-foreground leading-tight">
                                  เฉลี่ยจาก snapshot
                                </span>
                              )}
                            </>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell className="text-[11px] max-w-[280px] leading-tight py-1.5">
                          <div className="text-[10px] font-medium text-foreground/80 break-words leading-tight">
                            {(() => {
                              const pid = String(row.purchaseOrderId || '').trim();
                              return (
                                poSourceLabelById.get(pid) ||
                                poPartyLabelById.get(pid) ||
                                (pid ? `PO ${pid.slice(0, 8)}…` : 'ไม่ระบุ')
                              );
                            })()}
                          </div>
                          <div className="truncate text-muted-foreground leading-tight" title={row.remark || undefined}>
                            {row.remark || '—'}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="bg-muted/50 font-semibold border-t-2">
                    <TableCell colSpan={5} className="text-right py-2.5">
                      รวม (รายวันในตาราง)
                    </TableCell>
                    <TableCell className="text-right py-2.5 tabular-nums text-primary">
                      ฿{dailyDisplay.total.toLocaleString()}
                    </TableCell>
                    <TableCell className="py-2.5" />
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
              {isSupplementalBatch ? (
                <>
                  งวดตกเบิกอย่างเดียว (ไม่มีค่าแรงเดือนปัจจุบันในงวดนี้): <strong>ไม่หักประกันสังคม</strong>
                  {' '}· คิด <strong>ภงด.1 ตามเกณฑ์ปกติ</strong> จากยอดตกเบิก (ถ้าถึงเกณฑ์หลังประมาณการ ×12)
                  — ตั้งค่าที่{' '}
                  <Link href="/hr/settings" className="underline font-medium">
                    HR settings
                  </Link>
                </>
              ) : (
                <>
                  ระบบคำนวณประกันสังคมและภาษีเงินได้รายเดือนตาม{' '}
                  <Link href="/hr/settings" className="underline font-medium">
                    HR settings
                  </Link>{' '}
                  จากยอดรวมหลังเบี้ยเลี้ยง — สามารถกำหนดยอดหัก ภงด. เองได้ถ้าจำเป็น — ยอดหักคืนเบิกล่วงหน้า (ถ้ามี)
                  ลด NET เท่านั้น ไม่ลดฐานคำนวณ ภงด.
                </>
              )}
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

            <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/60 p-4">
              <div>
                <Label className="font-bold text-amber-950">รายได้ย้อนหลัง (งวดที่ล็อคแล้ว) (+)</Label>
                <p className="text-xs text-amber-900/80 mt-1 leading-snug">
                  ใช้เมื่อ timesheet เดือนก่อนปิด payroll แล้ว แต่ต้องจ่าย OT / M1 / standby เพิ่มในงวดนี้ —
                  สลิปจะแสดง «ส่วนเพิ่มจากงวด …» แยกจากรายได้งวดปัจจุบัน · ไม่เกี่ยวกับใบแจ้งหนี้ลูกค้า (Trip/Monthly)
                </p>
              </div>
              {priorPeriodRows.map((row, i) => (
                <div key={i} className="flex flex-wrap gap-2 items-end">
                  <div className="w-36">
                    <Label className="text-[11px] text-muted-foreground">งวดต้นทาง</Label>
                    <Input
                      type="month"
                      value={row.sourceYearMonth}
                      onChange={(e) => {
                        const next = [...priorPeriodRows];
                        next[i] = { ...next[i], sourceYearMonth: e.target.value };
                        setPriorPeriodRows(next);
                      }}
                      disabled={!canSaveAdjustments}
                    />
                  </div>
                  <div className="flex-1 min-w-[140px]">
                    <Label className="text-[11px] text-muted-foreground">รายการ</Label>
                    <Input
                      placeholder="เช่น OT 29–31 พ.ค."
                      value={row.label}
                      onChange={(e) => {
                        const next = [...priorPeriodRows];
                        next[i] = { ...next[i], label: e.target.value };
                        setPriorPeriodRows(next);
                      }}
                      disabled={!canSaveAdjustments}
                    />
                  </div>
                  <div className="w-32">
                    <Label className="text-[11px] text-muted-foreground">บาท</Label>
                    <Input
                      type="number"
                      placeholder="บาท"
                      value={row.amount}
                      onChange={(e) => {
                        const next = [...priorPeriodRows];
                        next[i] = { ...next[i], amount: e.target.value };
                        setPriorPeriodRows(next);
                      }}
                      disabled={!canSaveAdjustments}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={!canSaveAdjustments}
                    onClick={() => setPriorPeriodRows((rows) => rows.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canSaveAdjustments || retroImportBusy || !payrollApplyYearMonth}
                onClick={() => void handleImportRetroAdjustments()}
              >
                {retroImportBusy ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-1" />
                )}
                ดึงจากแก้ไขย้อนหลัง timesheet
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canSaveAdjustments}
                onClick={() =>
                  setPriorPeriodRows((r) => [...r, { sourceYearMonth: '', label: '', amount: '' }])
                }
              >
                <Plus className="h-4 w-4 mr-1" /> เพิ่มรายการย้อนหลัง
              </Button>
            </div>

            <Separator />

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

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              <div className="space-y-4 min-w-0">
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
                <div className="rounded-md border border-dashed bg-muted/20 px-3 py-2 space-y-2">
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
                rows={3}
              />
            </div>
              </div>

              <div className="space-y-4 min-w-0 lg:sticky lg:top-4">
            <div className="rounded-md border border-amber-300 bg-amber-50/50 p-4 text-sm space-y-3">
              <div className="flex justify-between gap-4 font-medium">
                <span>รวมรายได้ (ตรงสลิป)</span>
                <span className="font-mono tabular-nums text-primary">
                  ฿{(displaySlip?.grossTotal ?? pageIncomeTotal).toLocaleString()}
                </span>
              </div>
              {(allowanceItemsTotal(line) > 0.005 || priorPaidGrossTotal > 0.005) && (
                <div className="space-y-1 text-[11px] text-muted-foreground border-t border-amber-200/60 pt-2">
                  {allowanceItemsTotal(line) > 0.005 ? (
                    <div className="flex justify-between gap-4">
                      <span>ในนั้น · เบี้ยเลี้ยง / รายได้พิเศษ</span>
                      <span className="font-mono tabular-nums">
                        ฿{allowanceItemsTotal(line).toLocaleString()}
                      </span>
                    </div>
                  ) : null}
                  {priorPaidGrossTotal > 0.005 ? (
                    <div className="flex justify-between gap-4">
                      <span>ในนั้น · รายได้ตกเบิกที่จ่ายแล้ว</span>
                      <span className="font-mono tabular-nums">
                        ฿{priorPaidGrossTotal.toLocaleString()}
                      </span>
                    </div>
                  ) : null}
                </div>
              )}
              <div className="space-y-1.5 border-t border-amber-200/80 pt-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  รายการหัก (ตรงสลิป)
                </p>
                {(displaySlip?.deductionLines?.length
                  ? displaySlip.deductionLines
                  : deductionDisplayRows(line).map((r) => ({ label: r.label, amount: r.amount }))
                ).map((row, i) => (
                  <div key={`${row.label}-${i}`} className="flex justify-between gap-4 text-sm">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className="font-mono tabular-nums">−฿{row.amount.toLocaleString()}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between gap-4 border-t border-amber-200/80 pt-3 font-medium">
                <span>หักรวม (รวมหักยอดที่ชำระไปแล้ว)</span>
                <span className="font-mono tabular-nums">
                  ฿
                  {(
                    displaySlip?.deductionsTotal ??
                    lineDeductionsTotal(line)
                  ).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between gap-4 border-t border-amber-200/80 pt-3 font-black text-emerald-800">
                <span>รับสุทธิ (ตรงสลิป)</span>
                <span className="font-mono tabular-nums">
                  ฿{(displaySlip?.netPay ?? previewNet ?? line.netAmount).toLocaleString()}
                </span>
              </div>
              {displaySlip ? (
                <p className="text-[11px] text-muted-foreground leading-snug pt-1">
                  ตรวจเลข: รายได้ ฿{displaySlip.grossTotal.toLocaleString()} − หัก ฿
                  {displaySlip.deductionsTotal.toLocaleString()} = สุทธิ ฿
                  {displaySlip.netPay.toLocaleString()}
                  {displaySlip.deductionLines.some((d) => d.label.includes('หักยอดที่ชำระไปแล้ว'))
                    ? ' (หักรวมรวมยอดที่บัญชีจ่ายไปแล้วในงวดก่อนของเดือนเดียวกัน)'
                    : ''}
                </p>
              ) : null}
              <Button
                type="button"
                className="w-full"
                disabled={!canSaveAdjustments || saving}
                onClick={() => void handleSave()}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                บันทึกการปรับยอด
              </Button>
            </div>
              </div>
            </div>
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
                  ระบบจะดึงใบงานรายวันที่จ่ายได้ตาม timesheet ปัจจุบัน (ตัดรอบ mob เก่าที่ค้างหลัง remob)
                  แล้วคำนวณ Gross / ประกันสังคม / ภงด. ชุดใหม่ตามสูตรและ HR settings{' '}
                  <strong className="text-foreground">ปัจจุบัน</strong> — อัปเดตชุดใบอ้างอิงในงวดให้ตรงด้วย
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
