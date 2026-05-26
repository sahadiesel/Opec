'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query, limit } from 'firebase/firestore';
import { AppShell } from '@/components/layout/app-shell';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { ExternalLink, Loader2, Search, Briefcase } from 'lucide-react';
import type {
  User,
  OfficePayrollRun,
  OfficePayrollLine,
  PayrollRunStatus,
} from '@/lib/types';
import { canSeeAccountingPillarUi } from '@/lib/permissions';
import { usePermissions } from '@/hooks/use-permissions';
import { officePayrollLineTaxAmount, resolveOfficePayrollWhtPaymentDateYmd } from '@/lib/payroll/payroll-office-wht-model';

type ExecutiveWhtRow = { run: OfficePayrollRun; line: OfficePayrollLine; tax: number; paymentYmd: string };

function fmtBaht(n: number): string {
  return `฿${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function executiveRowYm(r: ExecutiveWhtRow): string | null {
  if (r.paymentYmd && /^\d{4}-\d{2}-\d{2}$/.test(r.paymentYmd)) return r.paymentYmd.slice(0, 7);
  const pm = r.run.payrollMonth;
  if (pm && /^\d{4}-\d{2}/.test(String(pm).trim())) return String(pm).trim().slice(0, 7);
  return null;
}

const TH_MONTHS = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
] as const;

function ymLabelTh(ym: string): string {
  const [y, m] = ym.split('-');
  const mi = Number(m);
  if (!y || !Number.isFinite(mi) || mi < 1 || mi > 12) return ym;
  return `${TH_MONTHS[mi - 1]} ${Number(y) + 543}`;
}

function runStatusBadge(status: PayrollRunStatus): { label: string; variant: 'default' | 'secondary' | 'outline' } {
  if (status === 'PAID' || status === 'LOCKED') return { label: 'จ่ายแล้ว', variant: 'default' };
  if (status === 'FINANCE_APPROVED' || status === 'HR_APPROVED') return { label: 'รอจ่าย', variant: 'secondary' };
  if (status === 'CANCELLED') return { label: 'ยกเลิก', variant: 'outline' };
  return { label: 'ระหว่างทาง', variant: 'secondary' };
}

export default function AccountingWithholdingPayrollExecutivePage() {
  const { currentUser, isLoading } = useAppUser();
  const { profile } = usePermissions(currentUser);
  const firestore = useFirestore();
  const [q, setQ] = useState('');
  const [monthFilter, setMonthFilter] = useState<string>('ALL');
  const [executiveRows, setExecutiveRows] = useState<ExecutiveWhtRow[]>([]);
  const [loadingExecutiveLines, setLoadingExecutiveLines] = useState(false);
  const [executiveLinesErr, setExecutiveLinesErr] = useState<string | null>(null);

  const executiveRunsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'executive_payroll_runs'), orderBy('updatedAt', 'desc'), limit(80));
  }, [firestore]);

  const {
    data: executiveRuns,
    isLoading: loadingExecutiveRuns,
    error: executiveRunsErr,
  } = useCollection<OfficePayrollRun>(executiveRunsQuery as any);

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
    for (const r of executiveRows) {
      const ym = executiveRowYm(r);
      if (ym) set.add(ym);
    }
    return Array.from(set).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  }, [executiveRows]);

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
      return name.includes(t) || rn.includes(t) || rid.includes(t) || lid.includes(t) || sid.includes(t) || ym.includes(t) || paymentYmd.includes(t);
    });
  }, [executiveRows, q]);

  const filteredExecutive = useMemo(() => {
    if (monthFilter === 'ALL') return executiveRowsBySearch;
    return executiveRowsBySearch.filter((r) => executiveRowYm(r) === monthFilter);
  }, [executiveRowsBySearch, monthFilter]);

  const executiveTotalTax = useMemo(
    () => filteredExecutive.reduce((sum, { tax }) => sum + tax, 0),
    [filteredExecutive],
  );

  if (isLoading || !currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  const user = currentUser as User;
  if (!canSeeAccountingPillarUi(user, profile)) {
    return (
      <AppShell user={user} onLogout={() => {}}>
        <div className="max-w-3xl mx-auto py-16 text-center text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงเมนูบัญชี</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={user} onLogout={() => {}}>
      <div className="max-w-6xl mx-auto space-y-6 py-6 px-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Briefcase className="h-7 w-7 shrink-0 text-primary" />
            2. เอกสาร หัก ณ ที่จ่าย (ผู้บริหาร)
          </h1>
          <p className="text-muted-foreground mt-1">
            รายการหนังสือรับรองหัก ณ ที่จ่าย (ภงด.1) จากงวดเงินเดือนผู้บริหารเท่านั้น — งวดลูกจ้าง/ออฟฟิศอยู่เมนู 1 · คู่ค้า ภงด.53 อยู่เมนู 3
          </p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">ค้นหาและกรองเดือน</CardTitle>
            <CardDescription>
              ชื่อผู้มีเงินได้ เลขที่งวดผู้บริหาร รหัสบรรทัด หรือวันที่จ่าย — กรองเดือนใช้เดือนอ้างอิง (วันที่จ่าย หรืองวดเงินเดือน)
            </CardDescription>
            <div className="flex flex-col gap-4 pt-3 sm:flex-row sm:items-end">
              <div className="relative max-w-md flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="พิมพ์คำค้น..." value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <div className="w-full space-y-1.5 rounded-lg border bg-muted/50 p-3 sm:max-w-[260px] sm:shrink-0">
                <Label htmlFor="wht-exec-month-filter" className="text-xs text-muted-foreground">
                  กรองตามเดือน
                </Label>
                <Select value={monthFilter} onValueChange={setMonthFilter}>
                  <SelectTrigger id="wht-exec-month-filter" className="bg-background">
                    <SelectValue placeholder="เลือกเดือน" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">ทุกเดือน</SelectItem>
                    {monthOptions.map((ym) => (
                      <SelectItem key={ym} value={ym}>
                        {ymLabelTh(ym)} ({ym})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
        </Card>

        {executiveRunsErr ? (
          <p className="text-sm text-destructive">
            โหลดหัวงวดผู้บริหารไม่สำเร็จ — {String((executiveRunsErr as Error)?.message || executiveRunsErr)}
          </p>
        ) : null}

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1.5">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Briefcase className="h-5 w-5 shrink-0 text-muted-foreground" />
                  ผู้บริหาร / Executive payroll
                </CardTitle>
                <CardDescription>
                  แสดงเฉพาะบรรทัดที่มียอดภาษีหักในงวดเงินเดือนผู้บริหาร — เปิดเพื่อพิมพ์ใบหัก
                </CardDescription>
              </div>
              {!loadingExecutiveRuns && !loadingExecutiveLines && !executiveLinesErr ? (
                <div className="rounded-md border border-primary/25 bg-primary/5 px-4 py-3 text-right shadow-sm shrink-0 sm:min-w-[180px]">
                  <p className="text-xs font-medium text-muted-foreground">ยอดหักรวม (ในตาราง)</p>
                  <p className="text-xl font-bold tabular-nums tracking-tight text-primary">{fmtBaht(executiveTotalTax)}</p>
                </div>
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
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>สถานะงวด</TableHead>
                      <TableHead>งวด</TableHead>
                      <TableHead>ผู้มีเงินได้</TableHead>
                      <TableHead>วันที่จ่าย</TableHead>
                      <TableHead className="text-right">ยอดหัก</TableHead>
                      <TableHead className="w-[100px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredExecutive.map(({ run, line, tax, paymentYmd }) => {
                      const st = runStatusBadge(run.status);
                      return (
                        <TableRow key={`${run.id}-${line.id}`}>
                          <TableCell>
                            <Badge variant={st.variant === 'default' ? 'default' : 'secondary'}>{st.label}</Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            <div className="font-mono">{run.payrollRunNo || run.id}</div>
                            <div className="text-xs text-muted-foreground">{run.payrollMonth || '—'}</div>
                          </TableCell>
                          <TableCell className="max-w-[240px]">
                            <div className="truncate font-medium">{line.staffName || '—'}</div>
                            <div className="text-xs text-muted-foreground font-mono">{line.staffId}</div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{paymentYmd}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm">{fmtBaht(tax)}</TableCell>
                          <TableCell>
                            <Link
                              href={`/accounting/withholding-payroll/executive/${encodeURIComponent(run.id)}/${encodeURIComponent(line.id)}`}
                              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                            >
                              เปิด
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Link>
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
      </div>
    </AppShell>
  );
}
