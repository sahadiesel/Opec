'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query, limit } from 'firebase/firestore';
import { AppShell } from '@/components/layout/app-shell';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { Users, ExternalLink, Loader2, Search, Building2 } from 'lucide-react';
import type {
  User,
  PayrollBatch,
  PayrollBatchLine,
  PayrollBatchStatus,
  OfficePayrollRun,
  OfficePayrollLine,
  PayrollRunStatus,
} from '@/lib/types';
import { canSeeAccountingPillarUi } from '@/lib/permissions';
import { usePermissions } from '@/hooks/use-permissions';
import { workerPayrollLinePitAmount, resolvePayrollWorkerWhtPaymentDateYmd } from '@/lib/payroll/payroll-worker-wht-model';
import { officePayrollLineTaxAmount, resolveOfficePayrollWhtPaymentDateYmd } from '@/lib/payroll/payroll-office-wht-model';

function fmtBaht(n: number): string {
  return `฿${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function workerBatchStatusBadge(status: PayrollBatchStatus): { label: string; variant: 'default' | 'secondary' } {
  if (status === 'PAID' || status === 'LOCKED') return { label: 'จ่ายแล้ว', variant: 'default' };
  if (status === 'FINANCE_PREPARED' || status === 'PAYMENT_EXPORTED') return { label: 'รอจ่าย', variant: 'secondary' };
  return { label: 'ระหว่างทาง', variant: 'secondary' };
}

function officeRunStatusBadge(status: PayrollRunStatus): { label: string; variant: 'default' | 'secondary' | 'outline' } {
  if (status === 'PAID' || status === 'LOCKED') return { label: 'จ่ายแล้ว', variant: 'default' };
  if (status === 'FINANCE_APPROVED' || status === 'HR_APPROVED') return { label: 'รอจ่าย', variant: 'secondary' };
  if (status === 'CANCELLED') return { label: 'ยกเลิก', variant: 'outline' };
  return { label: 'ระหว่างทาง', variant: 'secondary' };
}

type WorkerWhtRow = { batch: PayrollBatch; line: PayrollBatchLine; pit: number; paymentYmd: string };

type OfficeWhtRow = { run: OfficePayrollRun; line: OfficePayrollLine; tax: number; paymentYmd: string };

export default function AccountingWithholdingPayrollHubPage() {
  const { currentUser, isLoading } = useAppUser();
  const { profile } = usePermissions(currentUser);
  const firestore = useFirestore();
  const [q, setQ] = useState('');
  const [workerRows, setWorkerRows] = useState<WorkerWhtRow[]>([]);
  const [officeRows, setOfficeRows] = useState<OfficeWhtRow[]>([]);
  const [loadingWorkerLines, setLoadingWorkerLines] = useState(false);
  const [loadingOfficeLines, setLoadingOfficeLines] = useState(false);
  const [workerLinesErr, setWorkerLinesErr] = useState<string | null>(null);
  const [officeLinesErr, setOfficeLinesErr] = useState<string | null>(null);

  const batchesQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'payroll_batches'), orderBy('updatedAt', 'desc'), limit(80));
  }, [firestore]);

  const officeRunsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'office_payroll_runs'), orderBy('updatedAt', 'desc'), limit(80));
  }, [firestore]);

  const { data: batches, isLoading: loadingBatches, error: batchesErr } = useCollection<PayrollBatch>(batchesQuery as any);
  const { data: officeRuns, isLoading: loadingRuns, error: runsErr } = useCollection<OfficePayrollRun>(officeRunsQuery as any);

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

  const filteredWorker = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return workerRows;
    return workerRows.filter(({ batch, line, paymentYmd }) => {
      const name = (line.workerNameSnapshot || '').toLowerCase();
      const bid = batch.id.toLowerCase();
      const lid = line.id.toLowerCase();
      const wid = line.workerId.toLowerCase();
      return name.includes(t) || bid.includes(t) || lid.includes(t) || wid.includes(t) || paymentYmd.includes(t);
    });
  }, [workerRows, q]);

  const filteredOffice = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return officeRows;
    return officeRows.filter(({ run, line, paymentYmd }) => {
      const name = (line.staffName || '').toLowerCase();
      const rn = (run.payrollRunNo || '').toLowerCase();
      const rid = run.id.toLowerCase();
      const lid = line.id.toLowerCase();
      const sid = line.staffId.toLowerCase();
      const ym = (run.payrollMonth || '').toLowerCase();
      return name.includes(t) || rn.includes(t) || rid.includes(t) || lid.includes(t) || sid.includes(t) || ym.includes(t) || paymentYmd.includes(t);
    });
  }, [officeRows, q]);

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

  const listLoadErr = batchesErr || runsErr;

  return (
    <AppShell user={user} onLogout={() => {}}>
      <div className="max-w-6xl mx-auto space-y-6 py-6 px-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">1. เอกสาร หัก ณ ที่จ่าย (พนักงาน)</h1>
          <p className="text-muted-foreground mt-1">
            รายการหนังสือรับรองหัก ณ ที่จ่าย (ภงด.1) จากงวดจ่ายลูกจ้างและงวดพนักงานออฟฟิศ — เปิดรายการเพื่อพิมพ์หรือส่งออก JSON (คนละชุดกับคู่ค้า ภงด.53 — เมนูข้อ 2)
          </p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">ค้นหา</CardTitle>
            <CardDescription>ชื่อผู้มีเงินได้ เลขที่ชุดจ่าย / งวดออฟฟิศ รหัสบรรทัด หรือวันที่จ่าย</CardDescription>
            <div className="relative max-w-md pt-2">
              <Search className="absolute left-2.5 top-4 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="พิมพ์คำค้น..." value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </CardHeader>
        </Card>

        {listLoadErr ? (
          <p className="text-sm text-destructive">
            โหลดหัวงวดไม่สำเร็จ — {String((listLoadErr as Error)?.message || listLoadErr)}
          </p>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="h-5 w-5" />
              ลูกจ้าง / Worker payroll
            </CardTitle>
            <CardDescription>
              แสดงเฉพาะบรรทัดที่มียอดหัก ภงด.1 ในงวด — กดเปิดเพื่อดูตัวอย่างและพิมพ์ใบหัก (ไม่ต้องเข้าหน้ารายการชุดจ่าย)
            </CardDescription>
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
                  : 'ไม่พบรายการที่ตรงกับคำค้น'}
              </p>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>สถานะงวด</TableHead>
                      <TableHead>ชุดจ่าย</TableHead>
                      <TableHead>ผู้มีเงินได้</TableHead>
                      <TableHead>วันที่จ่าย</TableHead>
                      <TableHead className="text-right">ยอดหัก</TableHead>
                      <TableHead className="w-[100px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredWorker.map(({ batch, line, pit, paymentYmd }) => {
                      const st = workerBatchStatusBadge(batch.status);
                      return (
                        <TableRow key={`${batch.id}-${line.id}`}>
                          <TableCell>
                            <Badge variant={st.variant === 'default' ? 'default' : 'secondary'}>{st.label}</Badge>
                          </TableCell>
                          <TableCell className="font-mono text-sm">{batch.id}</TableCell>
                          <TableCell className="max-w-[240px]">
                            <div className="truncate font-medium">{line.workerNameSnapshot || '—'}</div>
                            <div className="text-xs text-muted-foreground font-mono">{line.workerId}</div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{paymentYmd}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm">{fmtBaht(pit)}</TableCell>
                          <TableCell>
                            <Link
                              href={`/accounting/withholding-payroll/worker/${encodeURIComponent(batch.id)}/${encodeURIComponent(line.id)}`}
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

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Building2 className="h-5 w-5 text-muted-foreground" />
              พนักงานออฟฟิศ / Office payroll
            </CardTitle>
            <CardDescription>
              แสดงเฉพาะบรรทัดที่มียอดภาษีหักในงวดเงินเดือนออฟฟิศ — เปิดเพื่อพิมพ์ใบหักเหมือนลูกจ้าง
            </CardDescription>
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
                  : 'ไม่พบรายการที่ตรงกับคำค้น'}
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
                    {filteredOffice.map(({ run, line, tax, paymentYmd }) => {
                      const st = officeRunStatusBadge(run.status);
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
                              href={`/accounting/withholding-payroll/office/${encodeURIComponent(run.id)}/${encodeURIComponent(line.id)}`}
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
