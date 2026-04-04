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
  Info,
  Landmark,
  Percent,
  Scale,
  ShieldCheck,
  ClipboardList,
  Save,
  Loader2,
  Plus,
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
import { loadPayrollPoliciesFromFirestore } from '@/lib/payroll/d8/policy-loader';
import { resolvePayrollPoliciesForDate } from '@/lib/payroll/d8/policies';
import {
  HR_STATUTORY_POLICY_SSO_ID,
  HR_STATUTORY_POLICY_TAX_OFFICE_ID,
} from '@/lib/payroll/d8/hr-statutory-policy-ids';
import type { PayrollPolicyRecord } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useAppUser } from '@/hooks/use-app-user';
import { canEditHrStatutoryPayrollSettings } from '@/lib/permission-core';
import { DEFAULT_ANNUAL_PERSONAL_ALLOWANCE } from '@/lib/payroll/employee-payroll-deductions';
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

const NO_PERM = 'คุณไม่มีสิทธ์ในการทำรายการ';

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

  const demoPitAnnual = useMemo(() => {
    const net = 850_000;
    return pitBands.length
      ? calculateAnnualPITFromProgressiveBands(net, pitBands)
      : calculateThaiAnnualPIT(net);
  }, [pitBands]);

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

    setSaving(true);
    const now = Date.now();
    try {
      const ssoRef = doc(firestore, 'payroll_policies', HR_STATUTORY_POLICY_SSO_ID);
      const taxRef = doc(firestore, 'payroll_policies', HR_STATUTORY_POLICY_TAX_OFFICE_ID);
      const [ssoPrev, taxPrev] = await Promise.all([getDoc(ssoRef), getDoc(taxRef)]);
      const ssoCreated =
        ssoPrev.exists() && typeof ssoPrev.data()?.createdAt === 'number'
          ? (ssoPrev.data()!.createdAt as number)
          : now;
      const taxCreated =
        taxPrev.exists() && typeof taxPrev.data()?.createdAt === 'number'
          ? (taxPrev.data()!.createdAt as number)
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
        name: 'Office monthly PIT estimate TH (HR settings)',
        effectiveFrom: '2000-01-01',
        effectiveTo: null,
        status: 'active',
        appliesTo: 'office',
        config: {
          mode: 'th_pit_monthly_annualized',
          annualPersonalAllowance: allowance,
          pitProgressiveBands: bandsOk,
        },
        updatedAt: now,
        createdAt: taxCreated,
      };

      await setDoc(ssoRef, { ...ssoPolicy }, { merge: true });
      await setDoc(taxRef, { ...taxPolicy }, { merge: true });

      toast({
        title: 'บันทึกตั้งค่าแล้ว',
        description: 'งวด Office / Executive payroll ที่กดคำนวณใหม่จะใช้อัตราชุดนี้ — บรรทัดเก็บ snapshot เดิมไม่เปลี่ยน',
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
                ค่าที่บันทึกจะเขียนลง <code className="text-xs bg-muted px-1 rounded">payroll_policies</code> — ระบบคำนวณ Office
                payroll / Executive payroll / Worker payroll (SSO) จะอ่านชุดนี้เมื่อรันงวด (ฐานเงินเดือนระบุต่อคนที่ Office Staff / Worker)
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
                <Landmark className="h-5 w-5 text-primary" /> ประกันสังคม (ฝั่งลูกจ้าง)
              </CardTitle>
              <CardDescription>ใช้กับทุก scope ที่คำนวณ SSO — ปรับตามประกาศ กสร.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Scale className="h-5 w-5 text-primary" /> ทดสอบสูตรภาษี (ตัวอย่าง)
              </CardTitle>
              <CardDescription>เงินได้สุทธิรายปี 850,000 บาท (หลังลดหย่อนแล้ว) — ภาษีรายปีโดยประมาณ</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-3xl font-black text-primary tabular-nums">
                {demoPitAnnual.toLocaleString(undefined, { maximumFractionDigits: 0 })} บาท
              </p>
              <div className="grid gap-2">
                <Label className="text-xs text-muted-foreground">ลดหย่อนรายปี (บาท) — ใช้ในสูตรเดือน × 12 − ลดหย่อน</Label>
                <Input
                  type="number"
                  min={0}
                  step={1000}
                  disabled={!canEdit || loading}
                  value={annualAllowance}
                  onChange={(e) => setAnnualAllowance(Number(e.target.value))}
                  className="font-mono max-w-[240px]"
                />
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
