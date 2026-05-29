'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ArrowLeft,
  CalendarDays,
  Clock,
  Info,
  Landmark,
  Percent,
  Scale,
  ShieldCheck,
  ClipboardList,
  Save,
  Loader2,
  Plus,
  Printer,
  Trash2,
} from 'lucide-react';
import {
  cloneDefaultPitBands,
  calculateAnnualPITFromProgressiveBands,
  calculateThaiAnnualPIT,
  normalizePitBands,
  pitBandsToReferenceRows,
  rechainPitBandsFromTops,
  type PitProgressiveBand,
} from '@/lib/hr/pit-thailand';
import { isHRStaff } from '@/lib/permissions';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import { useRouter } from 'next/navigation';
import { useFirestore } from '@/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { HR_CONFIGURATION_COLLECTION, HR_OFFICE_LEAVE_ENTITLEMENTS_DOC_ID } from '@/lib/attendance/constants';
import type { OfficeLeaveEntitlementsDoc } from '@/lib/attendance/types';
import { loadPayrollPoliciesFromFirestore } from '@/lib/payroll/d8/policy-loader';
import { socialSecurityFromPolicy } from '@/lib/payroll/d8/deductions-from-policy';
import { resolvePayrollPoliciesForDate } from '@/lib/payroll/d8/policies';
import {
  HR_STATUTORY_POLICY_MONTHLY_WORK_ID,
  HR_STATUTORY_POLICY_SSO_ID,
  HR_STATUTORY_POLICY_TAX_OFFICE_ID,
  HR_WORKER_GLOBAL_LABOR_POLICY_ID,
} from '@/lib/payroll/d8/hr-statutory-policy-ids';
import {
  DEFAULT_WORKER_GLOBAL_LABOR_CONTEXT,
  type WorkerGlobalLaborContext,
  workerGlobalLaborContextFromPolicy,
} from '@/lib/payroll/worker-global-labor-policy';
import { WEEKLY_REST_OPTIONS } from '@/lib/contract-position-rate-extras';
import { CalendarHolidayEditor } from '@/app/main-contracts/[id]/_components/calendar-holiday-editor';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DEFAULT_MONTHLY_WORK_NORM,
  monthlyWorkNormFromUnknownConfig,
  validateMonthlyWorkNormForSave,
  type MonthlyWorkNormPolicyConfig,
} from '@/lib/hr/monthly-work-norm-policy';
import { MonthlyWorkNormPolicyFields } from '@/components/hr/monthly-work-norm-policy-fields';
import type { PayrollPolicyRecord } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useAppUser } from '@/hooks/use-app-user';
import { canEditHrStatutoryPayrollSettings } from '@/lib/permission-core';
import {
  DEFAULT_ANNUAL_PERSONAL_ALLOWANCE,
  monthlyEmployeePITWithholding,
  projectedAnnualGrossFromMonthly,
} from '@/lib/payroll/employee-payroll-deductions';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { escapeHtmlDoc, openStandardPrintWindow } from '@/lib/documents/standard-document-print';

const NO_PERM = 'คุณไม่มีสิทธ์ในการทำรายการ';

const fmtBahtTh = (n: number, minFrac = 0, maxFrac = 2) =>
  n.toLocaleString('th-TH', { minimumFractionDigits: minFrac, maximumFractionDigits: maxFrac });

type PitRefRow = { rangeLabel: string; rateLabel: string; formulaNote: string };

function buildPitSettingsDemoPrintHtml(p: {
  generatedAt: string;
  ssoRate: number;
  ssoCeiling: number;
  annualAllowance: number;
  demoMonthlyGross: number;
  calc: {
    monthlySSO: number;
    monthlyPitBase: number;
    annualGrossFromWage: number;
    annualPitGross: number;
    netAnnual: number;
    annualTax: number;
    monthlyPit: number;
  };
  pitRows: PitRefRow[];
}): string {
  const c = p.calc;
  const bandRows = p.pitRows
    .map(
      (r) =>
        `<tr><td>${escapeHtmlDoc(r.rangeLabel)}</td><td style="text-align:center;white-space:nowrap">${escapeHtmlDoc(r.rateLabel)}</td></tr>`,
    )
    .join('');

  return `<div class="sd-page pit-print-wrap">
<style>
  .pit-print-wrap{ font-size:8.5pt; line-height:1.2; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .pit-print-wrap .p-hd{ display:flex; justify-content:space-between; align-items:flex-start; gap:8px; padding-bottom:4px; border-bottom:2px solid #0d9488; margin-bottom:4px; }
  .pit-print-wrap .p-cname{ font-weight:800; font-size:12pt; margin:0; color:#171717; }
  .pit-print-wrap .p-sub{ font-size:8pt; color:#404040; margin:2px 0 0 0; line-height:1.2; }
  .pit-print-wrap .p-ttl{ margin:0; font-size:12pt; font-weight:800; color:#0d9488; text-align:right; line-height:1.2; }
  .pit-print-wrap .p-when{ font-size:8pt; color:#525252; margin:0 0 4px 0; }
  .pit-print-wrap .p-h2{ font-size:9.5pt; font-weight:700; margin:5px 0 2px 0; color:#0d9488; line-height:1.2; }
  .pit-print-wrap table.p-tbl{ width:100%; border-collapse:collapse; margin:2px 0 4px 0; }
  .pit-print-wrap .p-tbl th,.pit-print-wrap .p-tbl td{ border:1px solid #d4d4d8; padding:1px 4px; vertical-align:top; }
  .pit-print-wrap .p-tbl thead th{ background:#f4f4f5; font-weight:700; font-size:8pt; padding:2px 4px; }
  .pit-print-wrap .p-tbl tbody th{ text-align:left; font-weight:600; font-size:8pt; background:#fafafa; width:52%; }
  .pit-print-wrap .p-tbl .p-td-num{ text-align:right; font-variant-numeric:tabular-nums; font-size:8pt; }
  .pit-print-wrap .p-res{ page-break-inside:avoid; break-inside:avoid; margin:5px 0; padding:5px 8px; border:1px solid #d4d4d8; border-radius:3px; background:#f0fdfa; }
  .pit-print-wrap .p-res-lb{ display:block; font-size:8.5pt; font-weight:700; color:#0f766e; margin-bottom:2px; }
  .pit-print-wrap .p-res-amt{ font-size:15pt; font-weight:800; font-variant-numeric:tabular-nums; color:#0d9488; }
  .pit-print-wrap .p-foot{ font-size:7.5pt; color:#525252; margin:4px 0 0 0; line-height:1.2; }
  @page{ size:A4; margin:6mm; }
  /* บีบขอบหน้า ลดจาก sd default เพื่อให้พอดี 1 หน้า */
  body{ padding:4mm 7mm 8mm 7mm !important; }
</style>
  <div class="p-hd">
    <div>
      <p class="p-cname">OPEC</p>
      <p class="p-sub">ตัวอย่างการคำนวณ — หน้า HR ตั้งค่า (ไม่ใช่เอกสารราชการ)</p>
    </div>
    <div style="min-width:0;max-width:45%;text-align:right">
      <h1 class="p-ttl">ภาษี ภงด.1 รายเดือน (ตัวอย่าง)</h1>
    </div>
  </div>
  <p class="p-when">ออกเมื่อ ${escapeHtmlDoc(p.generatedAt)}</p>
  <h2 class="p-h2">นโยบายที่อ้างอิง (ค่าในหน้านี้)</h2>
  <table class="p-tbl">
    <tbody>
      <tr><th>อัตราประกันสังคม (ลูกจ้าง)</th><td class="p-td-num">${escapeHtmlDoc(String(p.ssoRate))} %</td></tr>
      <tr><th>เพดานค่าจ้าง ปสง. ต่อเดือน</th><td class="p-td-num">${fmtBahtTh(p.ssoCeiling, 0, 0)} บาท</td></tr>
      <tr><th>ลดหย่อนรายปี (ส่วนตัว)</th><td class="p-td-num">${fmtBahtTh(p.annualAllowance)} บาท</td></tr>
    </tbody>
  </table>
  <h2 class="p-h2">ตารางขั้นบันไดภาษี (ช่วง / อัตรา)</h2>
  <table class="p-tbl">
    <thead><tr><th>ช่วงเงินได้สุทธิ (บาท)</th><th>อัตรา</th></tr></thead>
    <tbody>${bandRows}</tbody>
  </table>
  <h2 class="p-h2">กรณีตัวอย่าง</h2>
  <table class="p-tbl">
    <tbody>
      <tr><th>ฐานเงินได้รายเดือน (ก่อน ปสง.)</th><td class="p-td-num">${fmtBahtTh(p.demoMonthlyGross)} บาท</td></tr>
      <tr><th>ประกันสังคม ต่อเดือน</th><td class="p-td-num">${fmtBahtTh(c.monthlySSO)} บาท</td></tr>
      <tr><th>ฐาน ภงด.1 ต่อเดือน (หลังหัก ปสง.)</th><td class="p-td-num">${fmtBahtTh(c.monthlyPitBase)} บาท</td></tr>
      <tr><th>รายได้รวม/ปี (เดือน × 12, ก่อน ปสง.)</th><td class="p-td-num">${fmtBahtTh(c.annualGrossFromWage)} บาท</td></tr>
      <tr><th>ฐานภาษีรวม/ปี (ฐาน ภงด./เดือน × 12)</th><td class="p-td-num">${fmtBahtTh(c.annualPitGross)} บาท</td></tr>
      <tr><th>เงินได้สุทธิรายปี (หลังลดหย่อน)</th><td class="p-td-num">${fmtBahtTh(c.netAnnual)} บาท</td></tr>
      <tr><th>ภาษีรายปี (ขั้นบันได)</th><td class="p-td-num">${fmtBahtTh(c.annualTax)} บาท</td></tr>
    </tbody>
  </table>
  <div class="p-res">
    <span class="p-res-lb">ภาษีหัก ณ ที่จ่าย ภงด.1 ต่อเดือน (นำส่ง)</span>
    <span class="p-res-amt">${fmtBahtTh(c.monthlyPit, 2, 2)} บาท</span>
  </div>
  <p class="p-foot">หมายเหตุ: payroll D8 (office/worker) ใช้ฐานเดียวกับกล่องนี้ — หักประกันสังคมฝั่งลูกจ้างจาก gross รายเดือนก่อนนำไป ×12</p>
</div>`;
}

export default function HrSettingsPage() {
  const router = useRouter();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { currentUser, isLoading: userLoading } = useAppUser();

  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [noPermOpen, setNoPermOpen] = useState(false);

  const [ssoRate, setSsoRate] = useState(5);
  const [ssoCeiling, setSsoCeiling] = useState(15_000);
  const [annualAllowance, setAnnualAllowance] = useState(DEFAULT_ANNUAL_PERSONAL_ALLOWANCE);
  const [pitBands, setPitBands] = useState<PitProgressiveBand[]>(() => cloneDefaultPitBands());
  /** ฐานรายได้รายเดือนสำหรับกล่องทดสอบ ภงด.1 (ไม่บันทึกแยก — สะท้อนสูตร payroll) */
  const [demoMonthlyGross, setDemoMonthlyGross] = useState(50_000);

  const [workDaysPerMonth, setWorkDaysPerMonth] = useState(DEFAULT_MONTHLY_WORK_NORM.standardWorkingDaysPerMonth);
  const [normalWorkHoursPerDay, setNormalWorkHoursPerDay] = useState(
    DEFAULT_MONTHLY_WORK_NORM.normalWorkingHoursPerDay
  );
  const [breakHoursPerDay, setBreakHoursPerDay] = useState(DEFAULT_MONTHLY_WORK_NORM.breakHoursPerDay);
  const [workStartTime, setWorkStartTime] = useState(DEFAULT_MONTHLY_WORK_NORM.workStartTime);
  const [breakStartTime, setBreakStartTime] = useState(
    DEFAULT_MONTHLY_WORK_NORM.breakStartTime ?? '12:00',
  );
  const [lateGraceMinutes, setLateGraceMinutes] = useState(
    DEFAULT_MONTHLY_WORK_NORM.lateGraceMinutes ?? 5,
  );
  const [officeOvertimeHourMultiplier, setOfficeOvertimeHourMultiplier] = useState(
    DEFAULT_MONTHLY_WORK_NORM.officeOvertimeHourMultiplier ?? 1.5,
  );
  /** เงินเดือนสมมุติเพื่อแสดงตัวอย่างหักรายวัน/รายนาที (ไม่บันทึก) */
  const [absenceDemoSalary, setAbsenceDemoSalary] = useState(26000);

  const [workerLaborDraft, setWorkerLaborDraft] = useState<WorkerGlobalLaborContext>(() => ({
    ...DEFAULT_WORKER_GLOBAL_LABOR_CONTEXT,
  }));

  /** โควตาวันลาพนักงานออฟฟิศ (ใช้เมื่อมีเมนูจัดการวันลา) — เก็บที่ hr_configuration */
  const [officeLeavePersonal, setOfficeLeavePersonal] = useState(0);
  const [officeLeaveSick, setOfficeLeaveSick] = useState(0);
  const [officeLeaveAnnual, setOfficeLeaveAnnual] = useState(0);

  const canViewPage = currentUser && isHRStaff(currentUser);
  const canEdit = canEditHrStatutoryPayrollSettings(currentUser);

  const asOf = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const load = useCallback(async () => {
    if (!firestore) {
      setLoading(false);
      return;
    }
    setLoadError(null);
    setLoading(true);
    try {
      const policies = await loadPayrollPoliciesFromFirestore(firestore);
      const resolved = resolvePayrollPoliciesForDate(asOf, policies, 'office');
      const sso = resolved.sso;
      const tax = resolved.tax;
      if (sso?.config) {
        const r = Number(sso.config.employeeRatePercent);
        const c = Number(sso.config.monthlyCeilingBaht);
        if (Number.isFinite(r) && r >= 0 && r <= 100) setSsoRate(r);
        if (Number.isFinite(c) && c > 0) setSsoCeiling(c);
      }
      if (tax?.config && String(tax.config.mode) === 'th_pit_monthly_annualized') {
        const a = Number(tax.config.annualPersonalAllowance);
        if (Number.isFinite(a) && a >= 0) setAnnualAllowance(a);
        const nb = normalizePitBands(tax.config.pitProgressiveBands);
        if (nb && nb.length) setPitBands(rechainPitBandsFromTops(nb));
        else setPitBands(cloneDefaultPitBands());
      }
      const mw = resolved.monthlyWorkNorm;
      if (mw?.config) {
        const cfg = monthlyWorkNormFromUnknownConfig(mw.config as Record<string, unknown>);
        setWorkDaysPerMonth(cfg.standardWorkingDaysPerMonth);
        setNormalWorkHoursPerDay(cfg.normalWorkingHoursPerDay);
        setBreakHoursPerDay(cfg.breakHoursPerDay);
        setWorkStartTime(cfg.workStartTime);
        setBreakStartTime(cfg.breakStartTime ?? '12:00');
        setLateGraceMinutes(cfg.lateGraceMinutes ?? 5);
        setOfficeOvertimeHourMultiplier(cfg.officeOvertimeHourMultiplier ?? 1.5);
      }
      const wlRec = policies.find((p) => p.id === HR_WORKER_GLOBAL_LABOR_POLICY_ID);
      setWorkerLaborDraft(workerGlobalLaborContextFromPolicy(wlRec ?? null));

      const leaveRef = doc(firestore, HR_CONFIGURATION_COLLECTION, HR_OFFICE_LEAVE_ENTITLEMENTS_DOC_ID);
      const leaveSnap = await getDoc(leaveRef);
      if (leaveSnap.exists()) {
        const ld = leaveSnap.data() as Partial<OfficeLeaveEntitlementsDoc>;
        const p = Number(ld.personalDaysPerYear);
        const s = Number(ld.sickDaysPerYear);
        const a = Number(ld.annualVacationDaysPerYear);
        if (Number.isFinite(p) && p >= 0) setOfficeLeavePersonal(Math.round(p));
        if (Number.isFinite(s) && s >= 0) setOfficeLeaveSick(Math.round(s));
        if (Number.isFinite(a) && a >= 0) setOfficeLeaveAnnual(Math.round(a));
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'โหลดไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [firestore, asOf]);

  useEffect(() => {
    load();
  }, [load]);

  const pitRows = useMemo(() => pitBandsToReferenceRows(pitBands), [pitBands]);

  const pitDemoCalc = useMemo(() => {
    const m = Math.max(0, Number(demoMonthlyGross) || 0);
    const allow = Math.max(0, Number(annualAllowance) || 0);
    const ssoPolicy: PayrollPolicyRecord = {
      id: HR_STATUTORY_POLICY_SSO_ID,
      kind: 'sso',
      name: 'hr-settings-preview',
      effectiveFrom: '2000-01-01',
      effectiveTo: null,
      status: 'active',
      appliesTo: 'all',
      config: { employeeRatePercent: ssoRate, monthlyCeilingBaht: ssoCeiling },
    };
    const monthlySSO = socialSecurityFromPolicy(m, ssoPolicy);
    /** ฐานรายเดือนก่อน × 12 สำหรับ ภงด.1 (หลังลบ ปสง. ฝ่ายลูกจ้าง) */
    const monthlyPitBase = Math.max(0, m - monthlySSO);
    const annualGrossFromWage = projectedAnnualGrossFromMonthly(m);
    const annualPitGross = projectedAnnualGrossFromMonthly(monthlyPitBase);
    const netAnnual = Math.max(0, annualPitGross - allow);
    const annualTax = pitBands.length
      ? calculateAnnualPITFromProgressiveBands(netAnnual, pitBands)
      : calculateThaiAnnualPIT(netAnnual);
    const monthlyPit = monthlyEmployeePITWithholding({
      monthlyTaxableGross: monthlyPitBase,
      annualDeductions: allow,
      pitProgressiveBands: pitBands,
    });
    return {
      monthlySSO,
      monthlyPitBase,
      annualGrossFromWage,
      annualPitGross,
      netAnnual,
      annualTax,
      monthlyPit,
    };
  }, [demoMonthlyGross, annualAllowance, pitBands, ssoRate, ssoCeiling]);

  const handlePrintPitDemo = useCallback(async () => {
    const body = buildPitSettingsDemoPrintHtml({
      generatedAt: new Date().toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }),
      ssoRate,
      ssoCeiling,
      annualAllowance,
      demoMonthlyGross: Math.max(0, Number(demoMonthlyGross) || 0),
      calc: pitDemoCalc,
      pitRows: pitRows as PitRefRow[],
    });
    if (!(await openStandardPrintWindow({ windowTitle: 'ตัวอย่าง ภงด.1 รายเดือน', bodyInnerHtml: body, htmlLang: 'th' }))) {
      toast({
        variant: 'destructive',
        title: 'เปิดหน้าต่างพิมพ์ไม่ได้',
        description: 'กรุณาอนุญาตป๊อปอัปสำหรับเว็บไซต์นี้',
      });
    }
  }, [ssoRate, ssoCeiling, annualAllowance, demoMonthlyGross, pitDemoCalc, pitRows, toast]);

  const handleSave = async () => {
    if (!canEdit) {
      setNoPermOpen(true);
      return;
    }
    if (!firestore || !currentUser) {
      toast({ variant: 'destructive', title: 'ยังไม่พร้อมบันทึก' });
      return;
    }
    const bandsOk = normalizePitBands(pitBands);
    if (!bandsOk) {
      toast({
        variant: 'destructive',
        title: 'ข้อมูลขั้นภาษีไม่ถูกต้อง',
        description: 'ตรวจสอบช่วงเงิน (from < to) และอัตรา 0–100',
      });
      return;
    }
    const rate = Number(ssoRate);
    const ceiling = Number(ssoCeiling);
    const allowance = Number(annualAllowance);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      toast({ variant: 'destructive', title: 'อัตราประกันสังคมไม่ถูกต้อง' });
      return;
    }
    if (!Number.isFinite(ceiling) || ceiling <= 0) {
      toast({ variant: 'destructive', title: 'เพดานประกันสังคมไม่ถูกต้อง' });
      return;
    }
    if (!Number.isFinite(allowance) || allowance < 0) {
      toast({ variant: 'destructive', title: 'ลดหย่อนรายปีไม่ถูกต้อง' });
      return;
    }

    const monthlyWorkCfg: MonthlyWorkNormPolicyConfig = {
      standardWorkingDaysPerMonth: Math.round(Number(workDaysPerMonth)),
      normalWorkingHoursPerDay: Number(normalWorkHoursPerDay),
      breakHoursPerDay: Number(breakHoursPerDay),
      workStartTime: workStartTime.trim(),
      breakStartTime: breakStartTime?.trim() || undefined,
      lateGraceMinutes: Math.max(0, Math.round(Number(lateGraceMinutes) || 0)),
      officeOvertimeHourMultiplier: Math.max(0.5, Math.min(10, Number(officeOvertimeHourMultiplier) || 1.5)),
    };
    const mwErr = validateMonthlyWorkNormForSave(monthlyWorkCfg);
    if (mwErr) {
      toast({ variant: 'destructive', title: mwErr });
      return;
    }

    setSaving(true);
    const now = Date.now();
    try {
      const ssoRef = doc(firestore, 'payroll_policies', HR_STATUTORY_POLICY_SSO_ID);
      const taxRef = doc(firestore, 'payroll_policies', HR_STATUTORY_POLICY_TAX_OFFICE_ID);
      const mwRef = doc(firestore, 'payroll_policies', HR_STATUTORY_POLICY_MONTHLY_WORK_ID);
      const wlRef = doc(firestore, 'payroll_policies', HR_WORKER_GLOBAL_LABOR_POLICY_ID);
      const [ssoPrev, taxPrev, mwPrev, wlPrev] = await Promise.all([
        getDoc(ssoRef),
        getDoc(taxRef),
        getDoc(mwRef),
        getDoc(wlRef),
      ]);
      const ssoCreated =
        ssoPrev.exists() && typeof ssoPrev.data()?.createdAt === 'number'
          ? (ssoPrev.data()!.createdAt as number)
          : now;
      const taxCreated =
        taxPrev.exists() && typeof taxPrev.data()?.createdAt === 'number'
          ? (taxPrev.data()!.createdAt as number)
          : now;
      const mwCreated =
        mwPrev.exists() && typeof mwPrev.data()?.createdAt === 'number'
          ? (mwPrev.data()!.createdAt as number)
          : now;
      const wlCreated =
        wlPrev.exists() && typeof wlPrev.data()?.createdAt === 'number'
          ? (wlPrev.data()!.createdAt as number)
          : now;

      const ssoPolicy: PayrollPolicyRecord = {
        id: HR_STATUTORY_POLICY_SSO_ID,
        kind: 'sso',
        name: 'Thailand SSO employee (HR settings)',
        effectiveFrom: '2000-01-01',
        effectiveTo: null,
        status: 'active',
        appliesTo: 'all',
        config: {
          employeeRatePercent: rate,
          monthlyCeilingBaht: ceiling,
        },
        updatedAt: now,
        createdAt: ssoCreated,
      };
      const taxPolicy: PayrollPolicyRecord = {
        id: HR_STATUTORY_POLICY_TAX_OFFICE_ID,
        kind: 'tax',
        name: 'Monthly PIT estimate TH — HR settings (Office & Worker)',
        effectiveFrom: '2000-01-01',
        effectiveTo: null,
        status: 'active',
        appliesTo: 'all',
        config: {
          mode: 'th_pit_monthly_annualized',
          annualPersonalAllowance: allowance,
          pitProgressiveBands: bandsOk,
        },
        updatedAt: now,
        createdAt: taxCreated,
      };

      const monthlyWorkPolicy: PayrollPolicyRecord = {
        id: HR_STATUTORY_POLICY_MONTHLY_WORK_ID,
        kind: 'monthly_work_norm',
        name: 'Monthly working-day norm — HR settings',
        effectiveFrom: '2000-01-01',
        effectiveTo: null,
        status: 'active',
        appliesTo: 'all',
        config: {
          standardWorkingDaysPerMonth: monthlyWorkCfg.standardWorkingDaysPerMonth,
          normalWorkingHoursPerDay: monthlyWorkCfg.normalWorkingHoursPerDay,
          breakHoursPerDay: monthlyWorkCfg.breakHoursPerDay,
          workStartTime: monthlyWorkCfg.workStartTime,
          breakStartTime: monthlyWorkCfg.breakStartTime ?? '12:00',
          lateGraceMinutes: monthlyWorkCfg.lateGraceMinutes ?? 0,
          officeOvertimeHourMultiplier: monthlyWorkCfg.officeOvertimeHourMultiplier ?? 1.5,
        },
        updatedAt: now,
        createdAt: mwCreated,
      };

      const workerLaborPolicy: PayrollPolicyRecord = {
        id: HR_WORKER_GLOBAL_LABOR_POLICY_ID,
        kind: 'worker_global_labor',
        name: 'Worker payroll — global OT/holiday multipliers & calendar (HR settings)',
        effectiveFrom: '2000-01-01',
        effectiveTo: null,
        status: 'active',
        appliesTo: 'worker',
        config: {
          costMultipliers: { ...workerLaborDraft.cost },
          weeklyRestPattern: workerLaborDraft.weeklyRestPattern,
          calendarHolidays: workerLaborDraft.calendarHolidays,
        },
        updatedAt: now,
        createdAt: wlCreated,
      };

      await setDoc(ssoRef, { ...ssoPolicy }, { merge: true });
      await setDoc(taxRef, { ...taxPolicy }, { merge: true });
      await setDoc(mwRef, { ...monthlyWorkPolicy }, { merge: true });
      await setDoc(wlRef, { ...workerLaborPolicy }, { merge: true });

      const leavePayload: OfficeLeaveEntitlementsDoc = {
        personalDaysPerYear: Math.max(0, Math.round(Number(officeLeavePersonal) || 0)),
        sickDaysPerYear: Math.max(0, Math.round(Number(officeLeaveSick) || 0)),
        annualVacationDaysPerYear: Math.max(0, Math.round(Number(officeLeaveAnnual) || 0)),
        updatedAt: now,
        updatedByUid: currentUser.id,
      };
      const leaveRef = doc(firestore, HR_CONFIGURATION_COLLECTION, HR_OFFICE_LEAVE_ENTITLEMENTS_DOC_ID);
      await setDoc(leaveRef, leavePayload, { merge: true });

      toast({
        title: 'บันทึกตั้งค่าแล้ว',
        description:
          'ภาษี ปสง. วันทำงานมาตรฐาน ตัวคูณ/ปฏิทินค่าจ้างลูกจ้าง และโควตาวันลาออฟฟิศ — งวดที่คำนวณใหม่จะใช้ชุดนี้ (บรรทัด snapshot เดิมไม่เปลี่ยน)',
      });
      await load();
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'code' in e && String((e as { code?: string }).code).includes('permission');
      if (msg) setNoPermOpen(true);
      else
        toast({
          variant: 'destructive',
          title: 'บันทึกไม่สำเร็จ',
          description: e instanceof Error ? e.message : 'ลองใหม่หรือติดต่อผู้ดูแลระบบ',
        });
    } finally {
      setSaving(false);
    }
  };

  const updateToBaht = (index: number, toBaht: number | null) => {
    setPitBands((prev) => {
      const next = prev.map((b) => ({ ...b }));
      if (!next[index]) return prev;
      next[index] = {
        ...next[index],
        toBaht: toBaht == null ? null : Math.round(toBaht),
      };
      return rechainPitBandsFromTops(next);
    });
  };

  const updateRatePercent = (index: number, ratePercent: number) => {
    setPitBands((prev) => {
      const next = prev.map((b) => ({ ...b }));
      if (!next[index]) return prev;
      next[index] = { ...next[index], ratePercent };
      return rechainPitBandsFromTops(next);
    });
  };

  const canAddPitBand = pitBands.length === 0 || pitBands[pitBands.length - 1]?.toBaht != null;

  const addBand = () => {
    if (!canAddPitBand) return;
    setPitBands((prev) => {
      const last = prev[prev.length - 1];
      const from = last ? (last.toBaht ?? last.fromBaht + 100_000) : 0;
      const extended = [...prev, { fromBaht: from, toBaht: null as number | null, ratePercent: 0 }];
      return rechainPitBandsFromTops(extended);
    });
  };

  const removeBand = (index: number) => {
    if (pitBands.length <= 1) return;
    setPitBands((prev) => rechainPitBandsFromTops(prev.filter((_, i) => i !== index)));
  };

  if (userLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground text-sm">กำลังโหลด...</div>
    );
  }

  if (!currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground text-sm">กรุณาเข้าสู่ระบบ</div>
    );
  }

  if (!canViewPage) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="max-w-lg mx-auto py-20 text-center space-y-4">
          <p className="text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงหน้านี้</p>
          <Button variant="outline" onClick={() => router.push('/')}>
            กลับหน้าหลัก
          </Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-5xl mx-auto space-y-8 pb-16">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/hr/dashboard">
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <div className="space-y-2 min-w-0">
              <PayrollScopeTag scope="both" />
              <h1 className="text-2xl font-bold tracking-tight">ตั้งค่า HR — ภาษีและประกันสังคม</h1>
              <p className="text-sm text-muted-foreground mt-1">
                ค่าที่บันทึกจะเขียนลง <code className="text-xs bg-muted px-1 rounded">payroll_policies</code> — ภาษีเงินได้หัก ณ ที่จ่าย (ภงด.)
                แบบรายเดือนและประกันสังคม (SSO) ใช้ชุดนี้ทั้ง Office และ Worker เมื่อรันงวด
              </p>
            </div>
          </div>
          {canEdit ? (
            <Button className="gap-2 shrink-0" onClick={handleSave} disabled={saving || loading}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              บันทึกลงระบบ
            </Button>
          ) : (
            <Badge variant="secondary">ดูอย่างเดียว</Badge>
          )}
        </div>

        {loadError && (
          <p className="text-sm text-destructive">{loadError}</p>
        )}
        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดตั้งค่า…
          </div>
        )}

        <Card className="border-primary/20 bg-primary/5">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardList className="h-5 w-5" /> เส้นทางสลิปและการจ่าย (สรุปการปฏิบัติ)
            </CardTitle>
            <CardDescription>
              ลูกจ้างและพนักงานต้องตรวจสอบสลิปได้ชัดเจน → HR Manager อนุมัติรอบจ่าย → ส่งตัวเลขให้บัญชีโอน/นำส่งต่อ
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed">
            <ol className="list-decimal pl-5 space-y-2">
              <li>
                <strong>ลูกจ้าง:</strong> ฐานจ่ายจาก timesheet × อัตรา — หัก SSO ตามเพดาน/เปอร์เซ็นต์ด้านล่าง (ภาษีมักไม่หักใน worker
                batch ตามนโยบายเดิม)
              </li>
              <li>
                <strong>พนักงานออฟฟิศ / ผู้บริหาร:</strong> ใช้เงินเดือนต่อคนจาก Office Staff — หักภาษีประมาณการ (ฐานเดือน × 12 −
                ลดหย่อนรายปี แล้วใช้ขั้นบันไดด้านล่าง ÷ 12) และหัก SSO ตามตั้งค่านี้
              </li>
            </ol>
            <Button variant="outline" size="sm" asChild>
              <Link href="/hr/dashboard">ไปแดชบอร์ด HR</Link>
            </Button>
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Landmark className="h-5 w-5 text-primary" /> ประกันสังคม และตั้งค่าเวลางานออฟฟิศ
              </CardTitle>
              <CardDescription>
                ด้านบน: SSO ฝั่งลูกจ้าง — ด้านล่าง: จำนวนวันทำงานต่อเดือนและเวลาทำงานปกติ (เก็บใน{' '}
                <code className="text-xs bg-muted px-1 rounded">payroll_policies</code>)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 text-sm">
              <div className="rounded-lg border bg-muted/10 p-4 space-y-4">
                <p className="text-xs font-semibold text-muted-foreground tracking-wide">ประกันสังคม (ฝั่งลูกจ้าง)</p>
                <p className="text-xs text-muted-foreground -mt-2">ใช้กับทุก scope ที่คำนวณ SSO — ปรับตามประกาศ กสร.</p>
                <div className="grid gap-2">
                  <Label className="text-muted-foreground flex items-center gap-2">
                    <Percent className="h-4 w-4" /> อัตราหัก (ลูกจ้าง) %
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    disabled={!canEdit || loading}
                    value={ssoRate}
                    onChange={(e) => setSsoRate(Number(e.target.value))}
                    className="font-mono max-w-[200px]"
                  />
                </div>
                <div className="grid gap-2">
                  <Label className="text-muted-foreground">เพดานค่าจ้างคำนวณต่อเดือน (บาท)</Label>
                  <Input
                    type="number"
                    min={1}
                    step={100}
                    disabled={!canEdit || loading}
                    value={ssoCeiling}
                    onChange={(e) => setSsoCeiling(Number(e.target.value))}
                    className="font-mono max-w-[240px]"
                  />
                </div>
                <p className="text-xs text-muted-foreground flex gap-2">
                  <Info className="h-4 w-4 shrink-0 mt-0.5" />
                  ไม่ต้องตั้งซ้ำรายคน — รัน payroll จะดึงจากนโยบาย SSO ที่บันทึกที่นี่
                </p>
              </div>

              <MonthlyWorkNormPolicyFields
                disabled={!canEdit || loading}
                workDaysPerMonth={workDaysPerMonth}
                onWorkDaysPerMonth={setWorkDaysPerMonth}
                normalWorkHoursPerDay={normalWorkHoursPerDay}
                onNormalWorkHoursPerDay={setNormalWorkHoursPerDay}
                breakHoursPerDay={breakHoursPerDay}
                onBreakHoursPerDay={setBreakHoursPerDay}
                workStartTime={workStartTime}
                onWorkStartTime={setWorkStartTime}
                breakStartTime={breakStartTime}
                onBreakStartTime={setBreakStartTime}
                lateGraceMinutes={lateGraceMinutes}
                onLateGraceMinutes={setLateGraceMinutes}
                officeOvertimeHourMultiplier={officeOvertimeHourMultiplier}
                onOfficeOvertimeHourMultiplier={setOfficeOvertimeHourMultiplier}
                absenceDemoSalary={absenceDemoSalary}
                onAbsenceDemoSalary={setAbsenceDemoSalary}
                footerNote={
                  <>
                    บันทึกใน <code className="text-[11px] bg-muted px-1 rounded">payroll_policies</code> (kind=
                    <code>monthly_work_norm</code>) — ใช้คำนวณสลิปพนักงานออฟฟิศและอัตราหักสาย/ขาด
                  </>
                }
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                <div className="min-w-0">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Scale className="h-5 w-5 text-primary shrink-0" /> ทดสอบสูตรภาษี (ตัวอย่าง)
                  </CardTitle>
                  <CardDescription className="mt-1.5">
                    หักประกันสังคม (อัตรา/เพดานตามกล่อง ปสง. ฝั่งนี้) จากฐานรายเดือนก่อน แล้ว (ฐาน ภงด. ต่อเดือน × 12) −
                    ลดหย่อนรายปี → ขั้นบันได → หาร 12 เป็น ภงด.1 ต่อเดือน
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2 shrink-0 self-end sm:self-start"
                  onClick={handlePrintPitDemo}
                  disabled={loading}
                >
                  <Printer className="h-4 w-4" />
                  พิมพ์เอกสาร
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-2 sm:gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">ฐานเงินได้รายเดือน (บาท) — สำหรับประมาณการ ภงด.1</Label>
                  <Input
                    type="number"
                    min={0}
                    step={100}
                    disabled={loading}
                    value={demoMonthlyGross}
                    onChange={(e) => setDemoMonthlyGross(Number(e.target.value))}
                    className="font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    ลดหย่อนรายปี (บาท) — ค่าเดียวกับช่องบันทึกนโยบาย (เดือน × 12 − ลดหย่อน)
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    step={1000}
                    disabled={!canEdit || loading}
                    value={annualAllowance}
                    onChange={(e) => setAnnualAllowance(Number(e.target.value))}
                    className="font-mono"
                  />
                </div>
              </div>
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground space-y-1">
                <p>
                  รายได้รวม/ปี (เดือน × 12, ก่อน ปสง.):{' '}
                  <span className="font-mono text-foreground">
                    {pitDemoCalc.annualGrossFromWage.toLocaleString('th-TH', { maximumFractionDigits: 2 })} บาท
                  </span>
                </p>
                <p>
                  ประกันสังคม ต่อเดือน:{' '}
                  <span className="font-mono text-foreground">
                    {pitDemoCalc.monthlySSO.toLocaleString('th-TH', { maximumFractionDigits: 2 })} บาท
                  </span>
                </p>
                <p>
                  ฐาน ภงด.1 ต่อเดือน (รายได้ − ปสง.):{' '}
                  <span className="font-mono text-foreground">
                    {pitDemoCalc.monthlyPitBase.toLocaleString('th-TH', { maximumFractionDigits: 2 })} บาท
                  </span>
                </p>
                <p>
                  ฐานภาษีรวม/ปี (ฐาน ภงด./เดือน × 12):{' '}
                  <span className="font-mono text-foreground">
                    {pitDemoCalc.annualPitGross.toLocaleString('th-TH', { maximumFractionDigits: 2 })} บาท
                  </span>
                </p>
                <p>
                  เงินได้สุทธิรายปี (หลังลดหย่อน):{' '}
                  <span className="font-mono text-foreground">
                    {pitDemoCalc.netAnnual.toLocaleString('th-TH', { maximumFractionDigits: 2 })} บาท
                  </span>
                </p>
                <p>
                  ภาษีรายปี (รวมจากขั้นบันได):{' '}
                  <span className="font-mono text-foreground">
                    {pitDemoCalc.annualTax.toLocaleString('th-TH', { maximumFractionDigits: 2 })} บาท
                  </span>
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground">
                หมายเหตุ: กล่องนี้เทียบ “ฐานหลังหัก ปสง. รายเดือน” ก่อน × 12 — เมื่อมีหักขาด/สาย/ลาก่อนภาษีในงวดจริง D8 จะใช้ฐานหลังหักยอดเหล่านั้นก่อนคิด ภงด.1 และ ปสง. (ตั้งค่าได้ในการ์ดเวลางานด้านล่าง)
              </p>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">ภาษีหัก ณ ที่จ่าย ภงด.1 ต่อเดือน (นำส่ง)</p>
                <p className="text-3xl font-black text-primary tabular-nums">
                  {pitDemoCalc.monthlyPit.toLocaleString('th-TH', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{' '}
                  บาท
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5" /> อัตราภาษีเงินได้บุคคลธรรมดาแบบขั้นบันได
                </CardTitle>
                <CardDescription>
                  ฐานเงินได้สุทธิรายปี (หลังหักลดหย่อน) — ใช้กับพนักงานออฟฟิศและผู้บริหารเมื่อรัน payroll
                </CardDescription>
              </div>
              {canEdit && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={addBand}
                  disabled={loading || !canAddPitBand}
                  title={!canAddPitBand ? 'กำหนดค่า "ถึง" ของขั้นสุดท้ายก่อน แล้วค่อยเพิ่มขั้นใหม่' : undefined}
                >
                  <Plus className="h-4 w-4" /> เพิ่มขั้น
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ช่วงเงินได้สุทธิ (บาท)</TableHead>
                  <TableHead>อัตรา (% ส่วนเกิน)</TableHead>
                  <TableHead className="min-w-[220px]">แก้ไข (เพดานขั้น / อัตรา)</TableHead>
                  {canEdit && <TableHead className="w-[60px]" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pitRows.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{row.rangeLabel}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{row.rateLabel}</Badge>
                    </TableCell>
                    <TableCell>
                      {canEdit ? (
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="text-muted-foreground shrink-0">เพดาน (บาท)</span>
                          <Input
                            className="h-8 w-28 font-mono"
                            type="number"
                            min={(pitBands[i]?.fromBaht ?? 0) + 1}
                            step={1000}
                            placeholder={i === pitBands.length - 1 ? '∞' : undefined}
                            disabled={loading}
                            value={pitBands[i]?.toBaht ?? ''}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === '') {
                                if (i === pitBands.length - 1) updateToBaht(i, null);
                                return;
                              }
                              const n = Number(v);
                              if (!Number.isFinite(n)) return;
                              updateToBaht(i, n);
                            }}
                          />
                          <span className="text-muted-foreground shrink-0">อัตรา</span>
                          <Input
                            className="h-8 w-20 font-mono"
                            type="number"
                            min={0}
                            max={100}
                            step={0.5}
                            disabled={loading}
                            value={pitBands[i]?.ratePercent ?? 0}
                            onChange={(e) => updateRatePercent(i, Number(e.target.value))}
                          />
                          <span className="text-muted-foreground">%</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">{row.formulaNote}</span>
                      )}
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-destructive h-8 w-8"
                          disabled={pitBands.length <= 1 || loading}
                          onClick={() => removeBand(i)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Separator />
            <p className="text-xs text-muted-foreground">
              แก้เฉพาะค่า <strong>ถึง (บาท)</strong> ของแต่ละขั้น — ขั้นถัดไปจะเริ่มที่เลขถัดจากเพดานนั้นอัตโนมัติ (เช่น เปลี่ยนเพดานเป็น 160,000
              แล้วช่วงถัดไปแสดง 160,001 – …) สูตรคำนวณ payroll ใช้แบบขั้นบันไดตามตารางนี้ ขั้นสุดท้ายเว้น &quot;ถึง&quot; ว่าง = ไม่มีเพดานบน
            </p>
          </CardContent>
        </Card>

        <Card className="border-muted">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary shrink-0" /> ตั้งค่าวันหยุดและตัวคูณค่าจ้างลูกจ้าง (กลาง)
            </CardTitle>
            <CardDescription>
              ใช้คำนวณ payroll ลูกจ้างทุกสัญญา (รวม OT / วันหยุดในปฏิทิน / เสาร์–อาทิตย์) — พนักงานออฟฟิศไม่ผ่านไดร์ฟ timesheet จึงไม่ใช้ชุดนี้ในการคิดเวลา
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 text-sm">
            <p className="flex gap-2 items-start leading-relaxed text-muted-foreground">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                หน้าสัญญาหลักเหลือเฉพาะตัวคูณฝั่งลูกค้า (Billing) — ฝั่งต้นทุนย้ายมาที่นี่แล้ว แท็บ &quot;วันหยุดบริษัท&quot; ใน My Profile จะแสดงปฏิทินชุดเดียวกัน
              </span>
            </p>

            <div className="space-y-2">
              <Label className="text-xs font-semibold text-foreground">ตัวคูณฝั่งต้นทุน (ลูกจ้าง): OT / Holiday / Public Holiday / Sunday / Sunday OT</Label>
              <div className="grid grid-cols-5 gap-2 max-w-3xl">
                {(
                  [
                    ['otAfterShift', 'OT หลังกะ'],
                    ['holiday', 'Holiday'],
                    ['publicHoliday', 'นักขัตฤกษ์'],
                    ['sunday', 'อาทิตย์'],
                    ['sundayOt', 'อาทิตย์ OT'],
                  ] as const
                ).map(([key, hint]) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">{hint}</Label>
                    <Input
                      type="number"
                      step="0.1"
                      min={0}
                      disabled={loading || !canEdit}
                      className="font-mono h-9"
                      value={workerLaborDraft.cost[key]}
                      onChange={(e) => {
                        const v = Number(e.target.value) || 0;
                        setWorkerLaborDraft((d) => ({ ...d, cost: { ...d.cost, [key]: v } }));
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold text-foreground">Standby / Mob / Demob / Travel</Label>
              <div className="grid grid-cols-4 gap-2 max-w-3xl">
                {(
                  [
                    ['standby', 'Standby'],
                    ['mobilization', 'Mob'],
                    ['demobilization', 'Demob'],
                    ['travel', 'Travel'],
                  ] as const
                ).map(([key, hint]) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">{hint}</Label>
                    <Input
                      type="number"
                      step="0.1"
                      min={0}
                      disabled={loading || !canEdit}
                      className="font-mono h-9"
                      value={workerLaborDraft.cost[key]}
                      onChange={(e) => {
                        const v = Number(e.target.value) || 0;
                        setWorkerLaborDraft((d) => ({ ...d, cost: { ...d.cost, [key]: v } }));
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2 max-w-md">
              <Label>รูปแบบวันหยุดประจำสัปดาห์ (ค่าจ้าง)</Label>
              <Select
                disabled={loading || !canEdit}
                value={workerLaborDraft.weeklyRestPattern}
                onValueChange={(v) =>
                  setWorkerLaborDraft((d) => ({
                    ...d,
                    weeklyRestPattern: v as WorkerGlobalLaborContext['weeklyRestPattern'],
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEKLY_REST_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <CalendarHolidayEditor
              title="วันหยุดในปฏิทิน (วันที่ + ชื่อ)"
              disabled={loading || !canEdit}
              holidays={workerLaborDraft.calendarHolidays}
              setHolidays={(fn) =>
                setWorkerLaborDraft((d) => ({
                  ...d,
                  calendarHolidays: typeof fn === 'function' ? fn(d.calendarHolidays) : d.calendarHolidays,
                }))
              }
            />
          </CardContent>
        </Card>

        <Card className="border-primary/25 shadow-sm">
          <CardHeader className="border-b bg-muted/20">
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              เวลาทำงาน · การคิดสาย · ฐานวันทำงาน (พนักงานออฟฟิศ)
            </CardTitle>
            <CardDescription>
              ชุดเดียวกับการ์ด &quot;ประกันสังคม และตั้งค่าเวลางานออฟฟิศ&quot; ด้านบน — แก้ที่นี่หรือด้านบนก็ได้ กดบันทึกครั้งเดียวจะเขียนไฟล์{' '}
              <code className="text-xs bg-muted px-1 rounded">payroll_policies</code> ชุดเดียวกัน
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <MonthlyWorkNormPolicyFields
              disabled={!canEdit || loading}
              workDaysPerMonth={workDaysPerMonth}
              onWorkDaysPerMonth={setWorkDaysPerMonth}
              normalWorkHoursPerDay={normalWorkHoursPerDay}
              onNormalWorkHoursPerDay={setNormalWorkHoursPerDay}
              breakHoursPerDay={breakHoursPerDay}
              onBreakHoursPerDay={setBreakHoursPerDay}
              workStartTime={workStartTime}
              onWorkStartTime={setWorkStartTime}
              breakStartTime={breakStartTime}
              onBreakStartTime={setBreakStartTime}
              lateGraceMinutes={lateGraceMinutes}
              onLateGraceMinutes={setLateGraceMinutes}
              officeOvertimeHourMultiplier={officeOvertimeHourMultiplier}
              onOfficeOvertimeHourMultiplier={setOfficeOvertimeHourMultiplier}
              absenceDemoSalary={absenceDemoSalary}
              onAbsenceDemoSalary={setAbsenceDemoSalary}
              showThreePeriodRules
              footerNote={
                <>
                  เมื่อรัน payroll หักจากเวลาสแกน/ลา (และยอดอื่นที่กำหนด) จะถูกหัก<strong className="text-foreground">ก่อน</strong>คำนวณ ภงด.1 — ประกันสังคมยังใช้ฐานเงินได้เต็มงวดตามเดิม — สะท้อนใน snapshot บรรทัดงวด
                </>
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b bg-muted/20">
            <CardTitle className="text-lg flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-primary" />
              การตั้งค่าสิทธิ์วันลา (พนักงานออฟฟิศ)
            </CardTitle>
            <CardDescription>
              จำนวนวันต่อปีสำหรับลากิจ ลาป่วย และลาพักร้อน — ใช้เป็นฐานเมื่อเปิดเมนูจัดการวันลา (รอบถัดไป)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl">
              <div className="space-y-2">
                <Label>วันลากิจ / ปี</Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  disabled={loading || !canEdit}
                  value={officeLeavePersonal}
                  onChange={(e) => setOfficeLeavePersonal(Math.max(0, Math.round(Number(e.target.value) || 0)))}
                />
              </div>
              <div className="space-y-2">
                <Label>วันลาป่วย / ปี</Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  disabled={loading || !canEdit}
                  value={officeLeaveSick}
                  onChange={(e) => setOfficeLeaveSick(Math.max(0, Math.round(Number(e.target.value) || 0)))}
                />
              </div>
              <div className="space-y-2">
                <Label>วันลาพักร้อน / ปี</Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  disabled={loading || !canEdit}
                  value={officeLeaveAnnual}
                  onChange={(e) => setOfficeLeaveAnnual(Math.max(0, Math.round(Number(e.target.value) || 0)))}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground max-w-2xl">
              เก็บใน Firestore ที่ <span className="font-mono">{HR_CONFIGURATION_COLLECTION}/{HR_OFFICE_LEAVE_ENTITLEMENTS_DOC_ID}</span>{' '}
              — เฉพาะผู้มีสิทธิ์แก้หน้านี้จึงจะบันทึกได้ (สอดคล้องกฎ Firestore)
            </p>
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={noPermOpen} onOpenChange={setNoPermOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{NO_PERM}</AlertDialogTitle>
            <AlertDialogDescription className="sr-only">{NO_PERM}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>ตกลง</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
