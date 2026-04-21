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
import { Checkbox } from '@/components/ui/checkbox';
import {
  ArrowLeft,
  Loader2,
  Plus,
  Trash2,
  CalendarDays,
  Settings,
  Calculator,
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { doc, getDoc } from 'firebase/firestore';
import type { DailyTimesheet, PayrollBatch, PayrollBatchLine, PayrollPeriod, User } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccess, canPayrollPermission, canView, isMatrixControlledRole } from '@/lib/permissions';
import { PayrollService } from '@/lib/services/payroll-service';
import { useToast } from '@/hooks/use-toast';
import { formatDateThaiBE } from '@/lib/date-thai';
import { PayslipDialog } from '@/components/payroll/payslip-dialog';
import { buildPayslipFromWorkerLine } from '@/lib/payroll/payslip-model';
import { useCompanyDocumentProfile } from '@/hooks/use-company-document-profile';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import {
  buildSingleTimesheetGrossContext,
  computeSingleTimesheetGrossLikeBatch,
} from '@/lib/payroll/single-timesheet-gross';
import {
  loadPayrollPoliciesFromFirestore,
  resolvePayrollPoliciesForDate,
  computeWorkerPayrollLineD8,
} from '@/lib/payroll/d8';
import { pitFromPolicyWithMarginalCeiling } from '@/lib/payroll/d8/deductions-from-policy';
import { THAI_PIT_STANDARD_MARGINAL_RATE_PERCENTS } from '@/lib/hr/pit-thailand';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
  const manual = line.hrLineAdjustments?.deductionItems ?? [];
  manual.forEach((item, idx) => {
    const key = `manual_ded_${idx}`;
    const amt = Number(d[key]);
    if (amt > 0) rows.push({ label: item.label?.trim() || `หักพิเศษ (${idx + 1})`, amount: amt });
  });
  const known = new Set<string>(['social_security', 'pit_withholding']);
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
  const [grossByTsLoading, setGrossByTsLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [allowanceRows, setAllowanceRows] = useState<Array<{ label: string; amount: string }>>([
    { label: '', amount: '' },
  ]);
  const [deductionRows, setDeductionRows] = useState<Array<{ label: string; amount: string }>>([
    { label: '', amount: '' },
  ]);
  const [pitOverrideEnabled, setPitOverrideEnabled] = useState(false);
  /** อัตรา marginal สูงสุดที่ใช้ในตารางขั้นบันได (0–35) — ไม่ใช่หัก % จากยอดเดือนแบบเหมา */
  const [pitOverrideMarginalRate, setPitOverrideMarginalRate] = useState(35);
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
    const mr = line.hrLineAdjustments?.pitWithholdingOverrideMaxMarginalRatePercent;
    const pitBaht = line.hrLineAdjustments?.pitWithholdingOverride;
    if (mr != null && Number.isFinite(mr)) {
      setPitOverrideEnabled(true);
      setPitOverrideMarginalRate(snapToStandardMarginalRate(mr));
    } else if (pitBaht != null && Number.isFinite(pitBaht)) {
      setPitOverrideEnabled(true);
      setPitOverrideMarginalRate(35);
    } else {
      setPitOverrideEnabled(false);
      setPitOverrideMarginalRate(35);
    }
    setAdjNotes(line.hrLineAdjustments?.notes || '');
  }, [line]);

  useEffect(() => {
    if (!firestore || !line?.sourceTimesheetIds?.length) {
      setTimesheets([]);
      setTsLoading(false);
      return;
    }
    let cancelled = false;
    setTsLoading(true);
    void (async () => {
      try {
        const snaps = await Promise.all(
          line.sourceTimesheetIds.map((tid) => getDoc(doc(firestore, 'daily_timesheets', tid))),
        );
        const rows: DailyTimesheet[] = [];
        for (const s of snaps) {
          if (s.exists()) rows.push({ id: s.id, ...(s.data() as object) } as DailyTimesheet);
        }
        rows.sort((a, b) => a.date.localeCompare(b.date));
        if (!cancelled) setTimesheets(rows);
      } catch {
        if (!cancelled) setTimesheets([]);
      } finally {
        if (!cancelled) setTsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, line?.sourceTimesheetIds, line?.id]);

  useEffect(() => {
    if (!firestore || timesheets.length === 0) {
      setGrossByTsId({});
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
        if (!cancelled) setGrossByTsId(map);
      } catch {
        if (!cancelled) setGrossByTsId({});
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
        if (!cancelled) {
          if (pitOverrideEnabled) {
            const p = pitFromPolicyWithMarginalCeiling(
              eg,
              resolved.tax,
              Math.max(0, Math.min(35, pitOverrideMarginalRate)),
            );
            setPreviewPitAuto(p);
          } else {
            setPreviewPitAuto(Number(d8Line.deductionsBreakdown.pit_withholding) || 0);
          }
          setPreviewTaxPolicyName(resolved.tax?.name ?? null);
        }
        const deductions: Record<string, number> = { ...d8Line.deductionsBreakdown };
        if (pitOverrideEnabled) {
          deductions.pit_withholding = pitFromPolicyWithMarginalCeiling(
            eg,
            resolved.tax,
            Math.max(0, Math.min(35, pitOverrideMarginalRate)),
          );
        }
        deductionRows
          .filter((r) => r.label.trim() && Number(r.amount) > 0)
          .forEach((d, idx) => {
            deductions[`manual_ded_${idx}`] = Math.max(0, Number(d.amount) || 0);
          });
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
    pitOverrideEnabled,
    pitOverrideMarginalRate,
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
      await svc.applyWorkerLineHrAdjustments(batchId, workerId, currentUser as User, {
        allowanceItems,
        deductionItems,
        pitWithholdingOverride: null,
        pitWithholdingOverrideMaxMarginalRatePercent: pitOverrideEnabled
          ? Math.max(0, Math.min(35, pitOverrideMarginalRate))
          : null,
        notes: adjNotes.trim() ? adjNotes.trim() : undefined,
      });
      toast({
        title: 'บันทึกการปรับยอดแล้ว',
        description: pitOverrideEnabled
          ? 'ภงด. คำนวณจากอัตราขั้นสูงสุดที่เลือก × ตารางขั้นบันไดใน HR — ประกันสังคมตามเดิม'
          : 'คำนวณหักภาษีและประกันตาม HR settings',
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
    pitOverrideEnabled,
    pitOverrideMarginalRate,
    adjNotes,
    toast,
  ]);

  /** ต้องอยู่ก่อน early return — ห้ามเรียก hooks หลัง return แบบมีเงื่อนไข */
  const slipModel = useMemo(() => {
    if (!line || !batch) return null;
    const pl = period?.label || batch.payrollPeriodId;
    return buildPayslipFromWorkerLine(line, batch, pl, companyProfile ?? undefined);
  }, [
    line,
    batch,
    period?.label,
    batch?.payrollPeriodId,
    companyProfile?.companyNameTh,
    companyProfile?.companyNameEn,
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
                  ในงวด (snapshot ตอนสร้าง batch): ฿{line.grossAmount.toLocaleString()} — ต่างจากสูตร/PO ปัจจุบัน
                  ให้ใช้ <strong>Regenerate</strong> งวดเมื่อต้องการให้ snapshot ตรงยอดนี้
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
                          <div className="text-[10px] uppercase text-muted-foreground mt-0.5">{ts.workMode}</div>
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
              จากยอดรวมหลังเบี้ยเลี้ยง — สามารถกำหนดยอดหัก ภงด. เองได้ถ้าจำเป็น
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

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="pit-ov"
                  checked={pitOverrideEnabled}
                  onCheckedChange={(v) => setPitOverrideEnabled(v === true)}
                  disabled={!canSaveAdjustments}
                />
                <Label htmlFor="pit-ov" className="cursor-pointer leading-snug">
                  กำหนด ภงด. เอง — เลือกอัตรา marginal สูงสุด (0%–35%) ระบบคำนวณยอดหักเป็นบาทจากตารางขั้นบันไดใน HR
                </Label>
              </div>
              {pitOverrideEnabled && (
                <div className="space-y-2 max-w-xl">
                  <Label className="text-xs text-muted-foreground">
                    อัตรา marginal สูงสุดที่ใช้ในตาราง (ไม่ใช่หัก % จากยอดเดือนแบบเหมา)
                  </Label>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <Select
                      value={String(pitOverrideMarginalRate)}
                      onValueChange={(v) => setPitOverrideMarginalRate(Number(v))}
                      disabled={!canSaveAdjustments}
                    >
                      <SelectTrigger className="w-full sm:w-[220px]">
                        <SelectValue placeholder="เลือก %" />
                      </SelectTrigger>
                      <SelectContent>
                        {THAI_PIT_STANDARD_MARGINAL_RATE_PERCENTS.map((pct) => (
                          <SelectItem key={pct} value={String(pct)}>
                            {pct}%
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="text-sm font-mono tabular-nums text-foreground">
                      {previewNetLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : (
                        <>ยอดหักโดยประมาณ: ฿{(previewPitAuto ?? pitFromLine).toLocaleString()} / เดือน</>
                      )}
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    คำนวณแบบขั้นบันได: รายได้รายเดือน (ตาราง + เบี้ยเลี้ยง) × 12 → หักลดหย่อนรายปี → ภาษีตามช่วงที่อัตรา marginal ไม่เกินที่เลือก → หาร 12
                    เลือก <span className="font-mono">35%</span> = ใช้ทุกขั้นเหมือนโหมดอัตโนมัติ
                  </p>
                </div>
              )}
              {!pitOverrideEnabled && (
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm space-y-1">
                  <div className="flex justify-between gap-4 items-center">
                    <span>ภาษี ณ ที่จ่าย (ภงด.) — คำนวณอัตโนมัติ</span>
                    <span className="font-mono tabular-nums shrink-0">
                      {previewNetLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin inline text-muted-foreground" />
                      ) : (
                        <>฿{(previewPitAuto ?? pitFromLine).toLocaleString()}</>
                      )}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    ฐานคือยอดรายเดือน (รวมจากตาราง + เบี้ยเลี้ยง) → ประมาณการรายได้ ×12 → ลดหย่อนรายปี → ภาษีขั้นบันได → หาร 12 (
                    <span className="font-mono">th_pit_monthly_annualized</span>) ตามนโยบาย{' '}
                    {previewTaxPolicyName ? (
                      <span className="text-foreground/90">«{previewTaxPolicyName}»</span>
                    ) : (
                      'ใน HR settings'
                    )}
                    — ยอดในงวดที่บันทึกแล้ว: ฿{pitFromLine.toLocaleString()}
                  </p>
                </div>
              )}
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
    </AppShell>
  );
}
