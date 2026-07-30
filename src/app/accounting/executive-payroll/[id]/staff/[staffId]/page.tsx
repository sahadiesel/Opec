'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  ArrowLeft,
  User as UserIcon,
  Building2,
  Lock,
  Info,
  ExternalLink,
  ShieldAlert,
  Plus,
  Trash2,
} from 'lucide-react';
import { PayslipDialog } from '@/components/payroll/payslip-dialog';
import { buildPayslipFromOfficeLine } from '@/lib/payroll/payslip-model';
import { useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import {
  ExecutivePayrollLine,
  ExecutivePayrollRun,
  ExecutivePayrollStaff,
  OfficePayrollPitMode,
  User,
} from '@/lib/types';
import { executivePayrollLineDocumentId } from '@/lib/payroll/executive-payroll-line-id';
import { formatDateTimeThaiBE, formatPayrollYearMonthMmYyyyThaiBE, formatYmdLocalThaiBE } from '@/lib/date-thai';
import { useAppUser } from '@/hooks/use-app-user';
import { canEdit, canView } from '@/lib/permissions';
import { useCompanyDocumentProfile } from '@/hooks/use-company-document-profile';
import { useToast } from '@/hooks/use-toast';
import { PayrollService } from '@/lib/services/payroll-service';

function hrAllowanceTotal(line: ExecutivePayrollLine): number {
  return (line.hrLineAdjustments?.allowanceItems ?? []).reduce((s, x) => s + (Number(x.amount) || 0), 0);
}

function snapshotDeductionLabel(key: string, line: ExecutivePayrollLine): string {
  if (key === 'social_security') return 'ประกันสังคม';
  if (key === 'pit_withholding') return 'ภาษี ณ ที่จ่าย (ภงด.)';
  const m = /^manual_ded_(\d+)$/.exec(key);
  if (m) {
    const idx = Number(m[1]);
    const item = line.hrLineAdjustments?.deductionItems?.[idx];
    if (item?.label?.trim()) return item.label.trim();
    return `หักเพิ่ม (${idx + 1})`;
  }
  return key.replace(/_/g, ' ');
}

export default function ExecutivePayrollRunStaffLinePage({
  params,
}: {
  params: Promise<{ id: string; staffId: string }>;
}) {
  const { id: runId, staffId: staffIdParam } = use(params);
  const staffId = decodeURIComponent(staffIdParam);
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { profile: companyProfile } = useCompanyDocumentProfile();

  const isAuthorized = useMemo(() => canView(currentUser, 'executive_payroll'), [currentUser]);

  const runRef = useMemoFirebase(
    () => (firestore && isAuthorized ? doc(firestore, 'executive_payroll_runs', runId) : null),
    [firestore, runId, isAuthorized],
  );
  const { data: run, isLoading: runLoading } = useDoc<ExecutivePayrollRun>(runRef as any);

  const staffDocRef = useMemoFirebase(
    () => (firestore && isAuthorized ? doc(firestore, 'executive_payroll_staff', staffId) : null),
    [firestore, isAuthorized, staffId],
  );
  const { data: staffRow, isLoading: staffLoading } = useDoc<ExecutivePayrollStaff>(staffDocRef as any);

  const lineDocRef = useMemoFirebase(
    () =>
      firestore && isAuthorized && staffRow?.staffCode
        ? doc(
            firestore,
            'executive_payroll_runs',
            runId,
            'lines',
            executivePayrollLineDocumentId(staffRow.staffCode, runId),
          )
        : null,
    [firestore, isAuthorized, runId, staffRow?.staffCode],
  );
  const { data: lineRow, isLoading: lineLoading } = useDoc<ExecutivePayrollLine>(lineDocRef as any);
  const line = lineRow ?? null;

  const [allowanceRows, setAllowanceRows] = useState<Array<{ label: string; amount: string }>>([
    { label: '', amount: '' },
  ]);
  const [deductionRows, setDeductionRows] = useState<Array<{ label: string; amount: string }>>([
    { label: '', amount: '' },
  ]);
  const [adjNotes, setAdjNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [deductSocialSecurity, setDeductSocialSecurity] = useState(true);
  const [pitMode, setPitMode] = useState<OfficePayrollPitMode>('SYSTEM');
  const [pitManualPercent, setPitManualPercent] = useState('');
  const [pitManualAmountBaht, setPitManualAmountBaht] = useState('');
  const [pitManualIncomeLabel, setPitManualIncomeLabel] = useState('');

  useEffect(() => {
    if (!line) {
      setAllowanceRows([{ label: '', amount: '' }]);
      setDeductionRows([{ label: '', amount: '' }]);
      setAdjNotes('');
      setDeductSocialSecurity(true);
      setPitMode('SYSTEM');
      setPitManualPercent('');
      setPitManualAmountBaht('');
      setPitManualIncomeLabel('');
      return;
    }
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
    setAdjNotes(line.hrLineAdjustments?.notes?.trim() ? line.hrLineAdjustments.notes!.trim() : '');
    setDeductSocialSecurity(line.hrLineAdjustments?.deductSocialSecurity !== false);
    const pm = line.hrLineAdjustments?.pitMode ?? 'SYSTEM';
    setPitMode(pm);
    setPitManualPercent(pm === 'MANUAL_PERCENT' ? String(line.hrLineAdjustments?.pitManualPercent ?? '') : '');
    setPitManualAmountBaht(pm === 'MANUAL_AMOUNT' ? String(line.hrLineAdjustments?.pitManualAmountBaht ?? '') : '');
    setPitManualIncomeLabel(line.hrLineAdjustments?.pitManualIncomeLabel?.trim() ?? '');
  }, [line]);

  const runBlockedForHrEditBool =
    run != null && ['LOCKED', 'PAID', 'CANCELLED', 'FINANCE_APPROVED'].includes(run.status);

  const canSaveAdjustments =
    Boolean(firestore && currentUser && line && run && canEdit(currentUser, 'executive_payroll')) &&
    !runBlockedForHrEditBool;

  const handleSave = useCallback(async () => {
    if (!firestore || !currentUser || !line || !run || !canSaveAdjustments) return;
    setSaving(true);
    try {
      const allowanceItems = allowanceRows
        .filter((r) => r.label.trim() && Number(r.amount) > 0)
        .map((r) => ({ label: r.label.trim(), amount: Number(r.amount) }));
      const deductionItems = deductionRows
        .filter((r) => r.label.trim() && Number(r.amount) > 0)
        .map((r) => ({ label: r.label.trim(), amount: Number(r.amount) }));
      const usesManualPit = pitMode === 'MANUAL_PERCENT' || pitMode === 'MANUAL_AMOUNT';
      if (usesManualPit && !pitManualIncomeLabel.trim()) {
        throw new Error('ระบุชื่อรายการภาษีหัก ณ ที่จ่าย เช่น เบี้ยเลี้ยงประชุมประจำเดือน');
      }
      if (pitMode === 'MANUAL_PERCENT' && !(Number(pitManualPercent) > 0)) {
        throw new Error('เลือกหรือกรอกอัตราหัก ณ ที่จ่ายมากกว่า 0%');
      }

      const svc = new PayrollService(firestore);
      await svc.applyExecutiveLineHrAdjustments(runId, line.id, currentUser as User, {
        allowanceItems,
        deductionItems,
        notes: adjNotes.trim() ? adjNotes.trim() : undefined,
        deductSocialSecurity,
        pitMode,
        pitManualPercent: pitMode === 'MANUAL_PERCENT' ? Number(pitManualPercent) || 0 : null,
        pitManualAmountBaht: pitMode === 'MANUAL_AMOUNT' ? Number(pitManualAmountBaht) || 0 : null,
        pitManualIncomeLabel: usesManualPit ? pitManualIncomeLabel.trim() : null,
      });
      toast({
        title: 'บันทึกการปรับยอดแล้ว',
        description:
          'คำนวณ gross / ประกันสังคม / ภงด. / net ใหม่ตามการตั้งค่าและนโยบาย HR',
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
    line,
    run,
    runId,
    canSaveAdjustments,
    allowanceRows,
    deductionRows,
    adjNotes,
    deductSocialSecurity,
    pitMode,
    pitManualPercent,
    pitManualAmountBaht,
    pitManualIncomeLabel,
    toast,
  ]);

  const slipModel = useMemo(
    () => (line && run ? buildPayslipFromOfficeLine(line, run, companyProfile ?? undefined) : null),
    [line, run, companyProfile],
  );

  if (userLoading || !currentUser) return null;

  if (!isAuthorized) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <ShieldAlert className="h-12 w-12 text-destructive opacity-50" />
          <h2 className="text-xl font-bold">ไม่มีสิทธิ์เข้าถึง</h2>
        </div>
      </AppShell>
    );
  }

  if (runLoading || staffLoading || lineLoading) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  if (!run) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <p className="text-center text-muted-foreground py-20">ไม่พบงวดเงินเดือน</p>
        <div className="text-center">
          <Button variant="outline" onClick={() => router.push('/accounting/executive-payroll')}>
            กลับรายการ
          </Button>
        </div>
      </AppShell>
    );
  }

  const isLocked = run.status === 'LOCKED';

  if (!staffRow) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="max-w-lg mx-auto space-y-4 py-12 text-center">
          <p className="text-muted-foreground">ไม่พบผู้บริหารในระบบทะเบียน (รหัส staff ไม่ตรงหรือถูกลบ)</p>
          <Button asChild>
            <Link href={`/accounting/executive-payroll/${runId}`}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              กลับงวดเงินเดือน
            </Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  if (!line) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="max-w-lg mx-auto space-y-4 py-12 text-center">
          <p className="text-muted-foreground">
            ไม่พบบรรทัดจ่ายในงวดนี้ (ลองกดคำนวณรายละเอียดงวดใหม่ หรือตรวจรหัสพนักงาน/งวด)
          </p>
          <Button asChild>
            <Link href={`/accounting/executive-payroll/${runId}`}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              กลับงวดเงินเดือน
            </Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  const snap = line.d8Snapshot;
  const hrExtra = hrAllowanceTotal(line);
  const bundleNoHr =
    (line.allowance ?? 0) + (line.bonus ?? 0) + (line.overtimeAmount ?? 0) + (line.otherIncome ?? 0);

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push(`/accounting/executive-payroll/${runId}`)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <Badge className="mb-1 border-0 bg-primary text-[10px] font-bold uppercase tracking-wide text-primary-foreground">
              Executive Payroll
            </Badge>
            <h1 className="text-xl font-bold">รายละเอียดจ่ายเงินผู้บริหาร (รายคน)</h1>
            <p className="text-sm text-muted-foreground font-mono">
              {run.payrollRunNo} · {formatPayrollYearMonthMmYyyyThaiBE(run.payrollMonth)}
            </p>
          </div>
        </div>

        {isLocked && (
          <Alert>
            <Lock className="h-4 w-4" />
            <AlertTitle>งวดนี้ถูกล็อก</AlertTitle>
            <AlertDescription>
              แก้ไขรายเดิมผ่านคำขอแก้ไขพิเศษ (ถ้าเปิดใช้) — หน้านี้แสดง snapshot ตอนล็อก
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <UserIcon className="h-4 w-4" />
                ข้อมูลผู้บริหาร
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                <span className="font-bold text-primary">{line.staffName}</span>
              </p>
              <p className="text-muted-foreground flex items-start gap-1.5">
                <Building2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                {line.department} | {line.positionTitle}
              </p>
              <p className="text-xs font-mono text-muted-foreground">staffId: {line.staffId}</p>
              <Button variant="outline" size="sm" className="mt-2 gap-1" asChild>
                <Link href={`/accounting/executive-payroll/staff/${line.staffId}`}>
                  <ExternalLink className="h-3.5 w-3.5" />
                  ทะเบียนผู้บริหาร
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">สลิป (งวดนี้)</CardTitle>
              <CardDescription>ดู/พิมพ์รายรับรายหักตาม line นี้</CardDescription>
            </CardHeader>
            <CardContent>
              {slipModel ? (
                <PayslipDialog model={slipModel} />
              ) : (
                <p className="text-sm text-muted-foreground">สร้างรูปแบบสลิปไม่สำเร็จ</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>ยอดรายเดือน (งวด internal)</CardTitle>
            <CardDescription>ฐานและหัก ตามที่คำนวณ/capture บน line</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>รายการ</TableHead>
                  <TableHead className="text-right">จำนวน</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>ฐานเงินเดือน</TableCell>
                  <TableCell className="text-right tabular-nums">฿{line.baseSalary.toLocaleString()}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>เบี้ยเลี้ยง / โบนัส / โอที / รายได้อื่น (ถ้ามี)</TableCell>
                  <TableCell className="text-right tabular-nums">฿{bundleNoHr.toLocaleString()}</TableCell>
                </TableRow>
                {hrExtra > 0 ? (
                  <TableRow>
                    <TableCell>รายรับเพิ่ม (บันทึก HR)</TableCell>
                    <TableCell className="text-right tabular-nums text-primary">
                      ฿{hrExtra.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ) : null}
                <TableRow>
                  <TableCell className="font-bold">Gross</TableCell>
                  <TableCell className="text-right font-bold tabular-nums">฿{line.grossPay.toLocaleString()}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-red-700">รวมหัก (PIT+SS+อื่น รวมใน d8)</TableCell>
                  <TableCell className="text-right text-red-700 tabular-nums">
                    -฿{line.deductions.toLocaleString()}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-bold text-primary">Net</TableCell>
                  <TableCell className="text-right font-black text-primary tabular-nums">
                    ฿{line.netPay.toLocaleString()}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground mt-3 flex items-start gap-1">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              Gross = ฐาน + รายได้เสริมบรรทัด + รายรับเพิ่ม (HR) — หักรวมรวมประกันสังคม ภงด. และหักตามนโยบาย/หักเพิ่มที่บันทึก
            </p>
          </CardContent>
        </Card>

        {snap && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Snapshot การคำนวณ (D8)</CardTitle>
              <CardDescription>
                อ้างอิง {formatYmdLocalThaiBE(snap.asOfDate)} · {formatDateTimeThaiBE(snap.frozenAt)}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm space-y-3">
              {snap.policiesApplied?.length ? (
                <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground">
                  {snap.policiesApplied.map((p) => (
                    <li key={p.policyId + p.effectiveFrom}>
                      {p.policyName} ({p.kind})
                    </li>
                  ))}
                </ul>
              ) : null}
              {snap.deductions && Object.keys(snap.deductions).length > 0 ? (
                <div>
                  <p className="font-medium mb-1">รายการหัก (ใน snapshot):</p>
                  <ul className="space-y-1">
                    {Object.entries(snap.deductions).map(([k, v]) => (
                      <li key={k} className="flex justify-between gap-4">
                        <span className="text-xs">{snapshotDeductionLabel(k, line)}</span>
                        <span className="tabular-nums">฿{Number(v).toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </CardContent>
          </Card>
        )}

        <p className="text-xs text-muted-foreground text-center">
          งวดพนักงานออฟฟิศใช้เมนู{' '}
          <Link className="text-primary underline" href="/office-payroll">
            งวดจ่ายพนักงานออฟฟิศ
          </Link>
        </p>

        <Card>
          <CardHeader>
            <CardTitle>ปรับยอด (รายรับเพิ่ม / หักเพิ่มเติม)</CardTitle>
            <CardDescription>
              รายรับเพิ่มรวมใน gross — ภงด. และประกันสังคมคำนวณจาก gross ใหม่ — หักเพิ่มเป็นรายการแยกจาก SS / ภงด. อัตโนมัติ
              {runBlockedForHrEditBool ? (
                <span className="block mt-1 text-amber-700 dark:text-amber-500">
                  งวดนี้ไม่เปิดให้แก้ไขการปรับยอด (ล็อก / จ่ายแล้ว / ยกเลิก / การเงินอนุมัติแล้ว)
                </span>
              ) : null}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-lg border bg-muted/20 p-4 space-y-4">
              <div>
                <p className="font-semibold text-sm mb-2">ประกันสังคม</p>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={deductSocialSecurity}
                    onCheckedChange={(v) => setDeductSocialSecurity(v === true)}
                    disabled={!canSaveAdjustments}
                  />
                  <span>หักประกันสังคมในงวดนี้</span>
                </label>
                <p className="text-[11px] text-muted-foreground mt-1 pl-6">
                  ไม่ติ๊กเมื่อผู้รับเงินหักประกันสังคมกับบริษัทอื่นแล้ว
                </p>
              </div>
              <Separator />
              <div className="space-y-2">
                <Label className="font-semibold text-sm">ภาษีหัก ณ ที่จ่าย (ภงด.)</Label>
                <Select
                  value={pitMode}
                  onValueChange={(v) => {
                    setPitMode(v as OfficePayrollPitMode);
                    if (v === 'SYSTEM') {
                      setPitManualIncomeLabel('');
                    }
                  }}
                  disabled={!canSaveAdjustments}
                >
                  <SelectTrigger className="max-w-md">
                    <SelectValue placeholder="เลือกวิธีคำนวณภาษี" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SYSTEM">คำนวณจากระบบ (นโยบาย HR / D8)</SelectItem>
                    <SelectItem value="MANUAL_PERCENT">กำหนดเองเป็น % ของ Gross</SelectItem>
                    <SelectItem value="MANUAL_AMOUNT">กำหนดเองเป็นจำนวนเงิน (บาท)</SelectItem>
                  </SelectContent>
                </Select>
                {pitMode !== 'SYSTEM' ? (
                  <div className="grid gap-3 md:grid-cols-[1fr_220px]">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">ระบุว่าเป็นค่าอะไร</Label>
                      <Input
                        placeholder="เช่น เบี้ยเลี้ยงประชุมประจำเดือน"
                        value={pitManualIncomeLabel}
                        onChange={(e) => setPitManualIncomeLabel(e.target.value)}
                        disabled={!canSaveAdjustments}
                      />
                    </div>
                    {pitMode === 'MANUAL_PERCENT' ? (
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">อัตราการหัก</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            step={0.01}
                            placeholder="เช่น 5, 10, 15"
                            value={pitManualPercent}
                            onChange={(e) => setPitManualPercent(e.target.value)}
                            disabled={!canSaveAdjustments}
                          />
                          <span className="text-sm text-muted-foreground">%</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {['5', '10', '15', '20', '25', '30', '35'].map((p) => (
                            <Button
                              key={p}
                              type="button"
                              size="sm"
                              variant={pitManualPercent === p ? 'default' : 'outline'}
                              className="h-7 px-2 text-xs"
                              disabled={!canSaveAdjustments}
                              onClick={() => setPitManualPercent(p)}
                            >
                              {p}%
                            </Button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">ยอดหัก</Label>
                        <Input
                          type="number"
                          min={0}
                          step={0.01}
                          placeholder="บาท"
                          value={pitManualAmountBaht}
                          onChange={(e) => setPitManualAmountBaht(e.target.value)}
                          disabled={!canSaveAdjustments}
                        />
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <Label className="font-semibold">รายรับเพิ่ม (+)</Label>
              {allowanceRows.map((row, i) => (
                <div key={i} className="flex gap-2 items-end flex-wrap">
                  <div className="flex-1 min-w-[140px]">
                    <Input
                      placeholder="เช่น เบี้ยเลี้ยงพิเศษ โบนัสย่อย"
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
              <Label className="font-semibold">รายการหักเพิ่ม (นอกเหนือจาก SS / ภงด. อัตโนมัติ)</Label>
              {deductionRows.map((row, i) => (
                <div key={i} className="flex gap-2 items-end flex-wrap">
                  <div className="flex-1 min-w-[140px]">
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

            <div className="space-y-2">
              <Label>หมายเหตุ</Label>
              <Textarea
                value={adjNotes}
                onChange={(e) => setAdjNotes(e.target.value)}
                disabled={!canSaveAdjustments}
                rows={2}
              />
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
