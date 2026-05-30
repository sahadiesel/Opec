'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { buildPayslipFromOfficeLine } from '@/lib/payroll/payslip-model';
import { useFirestore } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { useCompanyDocumentProfile } from '@/hooks/use-company-document-profile';
import { canView } from '@/lib/permissions';
import { usePermissions } from '@/hooks/use-permissions';
import { canSubmitOfficeRunForManagerReview } from '@/lib/permission-core';
import { useToast } from '@/hooks/use-toast';
import { formatPayrollYearMonthEnAbbrev } from '@/lib/date-thai';
import { submitOfficeRunForManagerReview } from '@/lib/payroll/office-submit-hr-review';
import {
  fetchOfficePayrollMonthConsolidation,
  type OfficePayrollLineMonthMerged,
  type OfficePayrollMonthConsolidation,
} from '@/lib/payroll/office-month-staff-aggregate';
import { PayslipDialog } from '@/components/payroll/payslip-dialog';
import {
  Building2,
  ChevronRight,
  Coins,
  Calculator,
  Info,
  Loader2,
  TrendingUp,
  Users,
  ArrowLeft,
  Search,
  Send,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import type { OfficePayrollRun } from '@/lib/types';

function StatCard({
  title,
  value,
  sub,
  icon: Icon,
  colorClass,
}: {
  title: string;
  value: string;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
  colorClass: string;
}) {
  return (
    <Card className={`hover:shadow-md transition-all border-l-8 ${colorClass} shadow-sm`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 opacity-50 text-primary" />
      </CardHeader>
      <CardContent>
        <div className="text-xl font-black text-primary truncate">{value}</div>
        <p className="text-[10px] font-medium text-muted-foreground mt-1">{sub}</p>
      </CardContent>
    </Card>
  );
}

export default function OfficePayrollMonthPage({ params }: { params: Promise<{ ym: string }> }) {
  const { ym: ymRaw } = use(params);
  const ym = useMemo(() => decodeURIComponent(ymRaw), [ymRaw]);
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { profile: companyProfile } = useCompanyDocumentProfile();
  const { toast } = useToast();
  const { check } = usePermissions(currentUser);
  const canEditOffice = useMemo(() => check('office_payroll', 'edit'), [check, currentUser]);
  const canOfficerSend = useMemo(
    () => Boolean(currentUser && canEditOffice && canSubmitOfficeRunForManagerReview(currentUser)),
    [currentUser, canEditOffice]
  );

  const isAuthorized = useMemo(() => canView(currentUser, 'office_payroll'), [currentUser]);
  const [c, setC] = useState<OfficePayrollMonthConsolidation | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sendingAll, setSendingAll] = useState(false);
  const [lineQuery, setLineQuery] = useState('');

  useEffect(() => {
    if (!firestore || !ym) {
      setC(null);
      setLoading(false);
      return;
    }
    let cancel = false;
    setLoading(true);
    setLoadErr(null);
    void fetchOfficePayrollMonthConsolidation(firestore, ym)
      .then((x) => {
        if (!cancel) setC(x);
      })
      .catch((e) => {
        if (!cancel) {
          setLoadErr(e instanceof Error ? e.message : 'ไม่สามารถโหลดข้อมูลรวมรายเดือน');
          setC(null);
        }
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [firestore, ym]);

  const monthLabel = useMemo(() => formatPayrollYearMonthEnAbbrev(ym, ''), [ym]);
  const merged: OfficePayrollLineMonthMerged[] = c?.mergedLines ?? [];
  const calculableRuns = useMemo(
    () => (c?.runs || []).filter((r) => r.status === 'CALCULATED'),
    [c]
  );
  const mergedFiltered = useMemo(() => {
    const q = lineQuery.trim().toLowerCase();
    if (!q) return merged;
    return merged.filter(
      (l) =>
        l.staffName.toLowerCase().includes(q) ||
        (l.sourceRunNos || '').toLowerCase().includes(q) ||
        l.department.toLowerCase().includes(q) ||
        l.positionTitle.toLowerCase().includes(q)
    );
  }, [merged, lineQuery]);

  const handleSendAllForReview = useCallback(async () => {
    if (!firestore || !currentUser || !c || calculableRuns.length === 0) return;
    if (!canOfficerSend) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'เฉพาะฝ่ายเงินเดือนหรือผู้ดูแล' });
      return;
    }
    setSendingAll(true);
    try {
      for (const r of calculableRuns) {
        await submitOfficeRunForManagerReview(firestore, r.id, currentUser);
      }
      toast({
        title: 'ส่งขออนุมัติแล้ว',
        description: `ส่ง ${calculableRuns.length} งวด → รอผู้จัดการ (ศูนย์อนุมัติ Payroll)`,
      });
      const next = await fetchOfficePayrollMonthConsolidation(firestore, ym);
      setC(next);
    } catch (e) {
      console.error(e);
      toast({
        variant: 'destructive',
        title: 'ส่งไม่สำเร็จ',
        description: e instanceof Error ? e.message : 'ลองอีกครั้ง',
      });
    } finally {
      setSendingAll(false);
    }
  }, [firestore, currentUser, c, calculableRuns, canOfficerSend, toast, ym]);

  if (userLoading || !currentUser) return null;

  if (!isAuthorized) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="p-6 text-destructive">คุณไม่มีสิทธิ์ดูรายงานเงินเดือนออฟฟิศ</div>
      </AppShell>
    );
  }

  if (loadErr) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="p-6 space-y-4 max-w-2xl">
          <p className="text-destructive text-sm font-mono">{loadErr}</p>
          <Button asChild variant="outline">
            <Link href="/office-payroll">กลับ</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  const firstRun: OfficePayrollRun | undefined = c?.runs?.[0];

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="p-4 md:p-6 space-y-4 max-w-[1400px] mx-auto">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight">มุมมองรวมรายเดือน (Office)</h1>
              <PayrollScopeTag scope="office" showHint={false} />
            </div>
            <p className="text-sm text-muted-foreground break-all">
              {monthLabel} <span className="text-xs">({ym})</span> — รวมรายชื่อและยอดสำหรับทุกงวดที่คำนวณแล้ว
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {c && calculableRuns.length > 0 && canOfficerSend && (
              <Button
                type="button"
                size="sm"
                className="gap-1.5"
                disabled={sendingAll || loading}
                onClick={() => void handleSendAllForReview()}
              >
                {sendingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                ส่งอนุมัติ ({calculableRuns.length} งวด)
              </Button>
            )}
            <Button variant="outline" size="sm" className="gap-1" onClick={() => router.push('/office-payroll')}>
              <ArrowLeft className="h-4 w-4" />
              กลับไปรายการงวด
            </Button>
          </div>
        </div>

        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>นี่คือรายเดือน ไม่ใช่งวดเดี่ยว</AlertTitle>
          <AlertDescription className="text-xs sm:text-sm">
            อนุมัติ/ตัดจ่ายยังดำเนินการต่องวด (เลขที่ OPR) แยก — กด <strong>ส่งอนุมัติ</strong> เพื่อส่งแต่ละงวดไปคิวผู้จัดการ; ฝ่ายเงินเดือนยังส่งทีละงวดจาก{' '}
            <Link className="underline font-medium" href="/office-payroll">รายการงวดจ่าย</Link> ก็ได้
          </AlertDescription>
        </Alert>

        {loading && !c && (
          <div className="flex justify-center py-20">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>
        )}

        {!loading && c && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                title="จำนวนพนักงาน"
                value={`${c.uniqueStaffCount} คน`}
                sub="นับ unique รายเดือน (รวมทุกงวดที่คำนวณแล้ว)"
                icon={Users}
                colorClass="border-l-blue-600"
              />
              <StatCard
                title="ยอดจ่ายรวม (Gross)"
                value={`฿${c.sumGrossFromRuns.toLocaleString()}`}
                sub="รวมทุกงวดในเดือน"
                icon={Calculator}
                colorClass="border-l-amber-500"
              />
              <StatCard
                title="หักภาษี/SSO"
                value={`฿${c.sumDeductionsFromRuns.toLocaleString()}`}
                sub="รวมทุกงวดในเดือน"
                icon={TrendingUp}
                colorClass="border-l-red-500"
              />
              <StatCard
                title="ยอดจ่ายสุทธิ (Net)"
                value={`฿${c.sumNetFromRuns.toLocaleString()}`}
                sub="รวมทุกงวดในเดือน"
                icon={Coins}
                colorClass="border-l-green-600"
              />
            </div>

            <Card>
              <CardHeader className="space-y-3">
                <div>
                  <CardTitle className="text-lg">รายการจ่ายเงินพนักงานบริษัท (Internal Settlement)</CardTitle>
                  <CardDescription>
                    รวมรายชื่อและยอดทุกงวดในเดือนเดียวกันที่คำนวณแล้ว (แสดงอ้างอิงงวดต้นทางของแต่ละบรรทัด) — หลายรายบนคนเดียวกันจะรวมยอด
                  </CardDescription>
                </div>
                <div className="relative max-w-md">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-9 h-9"
                    placeholder="ค้นหาชื่อ, เลขที่งวด, แผนก..."
                    value={lineQuery}
                    onChange={(e) => setLineQuery(e.target.value)}
                  />
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead className="w-[150px] text-xs">อ้างอิงงวด</TableHead>
                      <TableHead>พนักงาน & ตำแหน่ง</TableHead>
                      <TableHead>ฐานเงินเดือน</TableHead>
                      <TableHead className="text-right">ยอดรวม (Gross)</TableHead>
                      <TableHead className="text-right">รายการหัก</TableHead>
                      <TableHead className="text-right font-bold">สุทธิ (Net)</TableHead>
                      <TableHead className="text-right w-[100px]">สลิป</TableHead>
                      <TableHead className="text-right w-[72px]">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {merged.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={8}
                          className="text-center py-20 text-muted-foreground italic"
                        >
                          ยังไม่มีรายการหลังคำนวณ (หรืองวดในเดือนนี้ยังเป็น DRAFT)
                        </TableCell>
                      </TableRow>
                    )}
                    {merged.length > 0 && mergedFiltered.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-12 text-muted-foreground text-sm">
                          ไม่พบรายการตามคำค้น
                        </TableCell>
                      </TableRow>
                    )}
                    {mergedFiltered.map((line) => {
                      if (!firstRun) return null;
                      const slipRun: OfficePayrollRun = {
                        ...firstRun,
                        id: line.staffDetailRunId,
                        payrollRunNo: line.sourceRunNos,
                      };
                      const slipModel = buildPayslipFromOfficeLine(line, slipRun, companyProfile ?? undefined);
                      return (
                        <TableRow key={line._mergeKey} className="hover:bg-muted/20">
                          <TableCell className="text-[10px] text-muted-foreground font-mono align-top max-w-[150px] break-words">
                            {line.sourceRunNos}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-bold text-sm text-primary">{line.staffName}</span>
                              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                <Building2 className="h-2.5 w-2.5" /> {line.department} | {line.positionTitle}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm font-medium">฿{line.baseSalary.toLocaleString()}</span>
                          </TableCell>
                          <TableCell className="text-right font-medium">฿{line.grossPay.toLocaleString()}</TableCell>
                          <TableCell className="text-right text-red-600">-฿{line.deductions.toLocaleString()}</TableCell>
                          <TableCell className="text-right font-black text-green-700">฿{line.netPay.toLocaleString()}</TableCell>
                          <TableCell className="text-right">
                            <PayslipDialog model={slipModel} />
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="icon" asChild title="รายละเอียดรายคน">
                              <Link
                                href={`/office-payroll/${line.staffDetailRunId}/staff/${encodeURIComponent(line.staffId)}`}
                              >
                                <ChevronRight className="h-4 w-4" />
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}

        <div className="flex justify-end">
          <Button variant="outline" asChild>
            <Link href="/office-payroll">
              กลับไปหน้ารายการ <ChevronRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
