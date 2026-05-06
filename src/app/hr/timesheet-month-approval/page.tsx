'use client';

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useAppUser } from '@/hooks/use-app-user';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, doc, limit, query, where, updateDoc } from 'firebase/firestore';
import { canReviewMonthlyQueue, isSystemAdmin } from '@/lib/permission-core';
import { isSimpleAdmin } from '@/lib/simple-tier-model';
import { canViewHrApprovalSubsection } from '@/lib/navigation/nav-access';
import type {
  User,
  PoMonthTimesheetReview,
  WaveMonthTimesheetReview,
  PurchaseOrder,
  Wave,
  Customer,
} from '@/lib/types';
import { resolvePoActiveBundleKeyForPo } from '@/lib/ops/po-active-bundle';
import {
  groupRowsByPoActiveBundle,
  poActiveBundleWorkModeShortLabel,
} from '@/lib/ops/po-active-bundle-grouping';
import {
  ensureOpenPayrollPeriodForWaveMonthReview,
  markTimesheetsReadyForPayrollAfterMonthApproval,
} from '@/lib/timesheet/wave-month-payroll-bridge';
import {
  ensureWorkerMonthlyPayrollPeriodForYearMonth,
  syncReadyPayrollFlagsForYearMonthFromAllGatedPoMonthReviews,
} from '@/lib/timesheet/po-month-timesheet-bridge';
import {
  ensureCommercialDraftInvoiceAfterMonthApproval,
  ensureCommercialDraftInvoiceAfterPoMonthApproval,
} from '@/lib/services/commercial-invoice-service';
import { CheckCircle2, XCircle, ChevronLeft, ExternalLink, FileText, Images } from 'lucide-react';
import { waveRoundMonthLabel } from '@/lib/constants/timesheet-ui';
import { isWaveMonthAttachmentPdf } from '@/lib/timesheet/wave-month-utils';

function formatThaiCalendarMonthYearFromYm(ym: string): string | null {
  if (!/^\d{4}-\d{2}$/.test(ym)) return null;
  const d = new Date(`${ym}-01T12:00:00`);
  return d.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
}

export default function TimesheetMonthApprovalQueuePage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [photoDialogRow, setPhotoDialogRow] = useState<WaveMonthTimesheetReview | null>(null);
  const [photoDialogPo, setPhotoDialogPo] = useState<PoMonthTimesheetReview | null>(null);

  const canSeePage =
    currentUser &&
    canViewHrApprovalSubsection(currentUser, isSystemAdmin(currentUser) || isSimpleAdmin(currentUser));

  const canAct = canReviewMonthlyQueue(currentUser);

  const pendingQuery = useMemoFirebase(
    () =>
      firestore && canSeePage
        ? query(collection(firestore, 'wave_month_timesheet_reviews'), where('status', '==', 'pending_manager_review'))
        : null,
    [firestore, canSeePage],
  );
  const { data: pendingRows, isLoading } = useCollection<WaveMonthTimesheetReview>(pendingQuery as any);

  const pendingPoMonthQuery = useMemoFirebase(
    () =>
      firestore && canSeePage
        ? query(collection(firestore, 'po_month_timesheet_reviews'), where('status', '==', 'pending_manager_review'))
        : null,
    [firestore, canSeePage],
  );
  const { data: pendingPoRows, isLoading: loadingPo } = useCollection<PoMonthTimesheetReview>(pendingPoMonthQuery as any);

  const posQuery = useMemoFirebase(
    () => (firestore && canSeePage ? collection(firestore, 'purchase_orders') : null),
    [firestore, canSeePage],
  );
  const { data: allPos } = useCollection<PurchaseOrder>(posQuery as any);

  const wavesQuery = useMemoFirebase(
    () => (firestore && canSeePage ? collection(firestore, 'waves') : null),
    [firestore, canSeePage],
  );
  const { data: allWaves } = useCollection<Wave>(wavesQuery as any);

  const customersQuery = useMemoFirebase(
    () => (firestore && canSeePage ? query(collection(firestore, 'customers'), limit(500)) : null),
    [firestore, canSeePage],
  );
  const { data: customers } = useCollection<Customer>(customersQuery as any);

  const poById = useMemo(() => {
    const m = new Map<string, PurchaseOrder>();
    for (const p of allPos ?? []) m.set(p.id, p);
    return m;
  }, [allPos]);

  const waveById = useMemo(() => {
    const m = new Map<string, Wave>();
    for (const w of allWaves ?? []) m.set(w.id, w);
    return m;
  }, [allWaves]);

  const sorted = useMemo(() => {
    const list = [...(pendingRows ?? [])];
    list.sort((a, b) => b.submittedAt - a.submittedAt);
    return list;
  }, [pendingRows]);

  const sortedPo = useMemo(() => {
    const list = [...(pendingPoRows ?? [])];
    list.sort((a, b) => b.submittedAt - a.submittedAt);
    return list;
  }, [pendingPoRows]);

  const customerLabel = useMemo(() => {
    const nameById = new Map<string, string>();
    for (const c of customers ?? []) nameById.set(c.id, c.name);
    return (customerId: string) => nameById.get(customerId) || customerId;
  }, [customers]);

  const groupedPoMonth = useMemo(
    () =>
      groupRowsByPoActiveBundle(sortedPo, poById, customerLabel, (a, b) => b.submittedAt - a.submittedAt),
    [sortedPo, poById, customerLabel],
  );

  const groupedWaveMonth = useMemo(
    () => groupRowsByPoActiveBundle(sorted, poById, customerLabel, (a, b) => b.submittedAt - a.submittedAt),
    [sorted, poById, customerLabel],
  );

  const uniquePoQueueYearMonths = useMemo(() => {
    const s = new Set<string>();
    for (const r of sortedPo) {
      if (r.yearMonth && /^\d{4}-\d{2}$/.test(r.yearMonth)) s.add(r.yearMonth);
    }
    return [...s].sort();
  }, [sortedPo]);

  const poMonthQueueCardTitle = useMemo(() => {
    const n = sortedPo.length;
    if (n === 0) return 'ตรวจ Timesheet รอบเดือน (0)';
    if (uniquePoQueueYearMonths.length === 1) {
      const label = formatThaiCalendarMonthYearFromYm(uniquePoQueueYearMonths[0]);
      if (label) return `ตรวจ Timesheet เดือน ${label} (${n})`;
    }
    return `ตรวจ Timesheet รอบเดือน (${n})`;
  }, [sortedPo.length, uniquePoQueueYearMonths]);

  const poMonthQueueCardDescription = useMemo(() => {
    if (uniquePoQueueYearMonths.length === 0) {
      return 'รายการที่ส่งอนุมัติจะแสดงตามชื่อเดือนปฏิทินของงวดที่ส่ง — จัดกลุ่มตามชุด PO Active';
    }
    if (uniquePoQueueYearMonths.length === 1) {
      return 'ส่งจากหน้า Timesheet รายเดือน (รวมทุก wave) — ชื่อเดือนข้างบนสอดคล้องกับงวดที่ส่งอนุมัติ · แต่ละแถวคือหนึ่ง PO ต่อหนึ่งงวดปฏิทิน';
    }
    const labels = uniquePoQueueYearMonths.map((ym) => formatThaiCalendarMonthYearFromYm(ym) ?? ym).join(' · ');
    return `งวดที่ส่งอนุมัติในรายการนี้: ${labels} (ตามชื่อเดือนที่ส่งอนุมัติ) — จัดกลุ่มตามชุด PO Active`;
  }, [uniquePoQueueYearMonths]);

  const setStatus = async (row: WaveMonthTimesheetReview, next: 'approved' | 'rejected') => {
    if (!firestore || !currentUser || !canAct) return;
    setBusyId(row.id);
    try {
      const ref = doc(firestore, 'wave_month_timesheet_reviews', row.id);
      await updateDoc(ref, {
        status: next,
        reviewedAt: Date.now(),
        reviewedByUserId: currentUser.id,
        reviewedByName: currentUser.displayName || currentUser.email || row.id,
        updatedAt: Date.now(),
      });
      if (next === 'approved') {
        const approvedRow: WaveMonthTimesheetReview = { ...row, status: 'approved' };
        const { updated } = await markTimesheetsReadyForPayrollAfterMonthApproval(firestore, approvedRow);
        const actorName = currentUser.displayName || currentUser.email || currentUser.id;
        const payrollPeriod = await ensureOpenPayrollPeriodForWaveMonthReview(firestore, approvedRow, actorName);
        const billing = await ensureCommercialDraftInvoiceAfterMonthApproval(firestore, approvedRow, currentUser);
        const billingLine =
          billing.ok === true
            ? ` — สร้างใบแจ้งหนี้ ${billing.invoiceNo} อัตโนมัติ (ตรวจยอดที่เมนูรายการใบแจ้งหนี้ก่อนส่งลูกค้า)`
            : ` — ใบแจ้งหนี้: ${billing.reason}`;
        const zeroPayrollHint =
          updated === 0
            ? ' — ไม่พบ timesheet ที่อัปเดตได้ในช่วงงวด (หรือถูก LOCKED หมด) — เปิดสรุปลงเวลารายเดือน (Wave) เดือนเดียวกัน แล้วกด «ซิงค์พร้อมจ่าย payroll»'
            : '';
        const periodHint = payrollPeriod.created
          ? ' — สร้างรอบบัญชีลูกจ้างอัตโนมัติแล้ว (ไปเมนูงวดจ่ายลูกจ้างแล้วเลือกรอบเดือนนี้)'
          : '';
        toast({
          title: 'อนุมัติแล้ว',
          description: `${row.yearMonth} · ${waveById.get(row.waveId)?.waveCode ?? row.waveId} — ตั้งพร้อมจ่าย payroll ${updated} รายการ timesheet ในช่วงงวด${billingLine}${periodHint}${zeroPayrollHint}`,
        });
      } else {
        toast({
          title: 'ปฏิเสธแล้ว',
          description: `${row.yearMonth} · ${waveById.get(row.waveId)?.waveCode ?? row.waveId}`,
        });
      }
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'บันทึกไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusyId(null);
    }
  };

  const setStatusPo = async (row: PoMonthTimesheetReview, next: 'approved' | 'rejected') => {
    if (!firestore || !currentUser || !canAct) return;
    setBusyId(row.id);
    try {
      const ref = doc(firestore, 'po_month_timesheet_reviews', row.id);
      await updateDoc(ref, {
        status: next,
        reviewedAt: Date.now(),
        reviewedByUserId: currentUser.id,
        reviewedByName: currentUser.displayName || currentUser.email || row.id,
        updatedAt: Date.now(),
      });
      if (next === 'approved') {
        const approvedRow: PoMonthTimesheetReview = { ...row, status: 'approved' };
        const actorName = currentUser.displayName || currentUser.email || currentUser.id;
        const { updated, gatedPoCount, syncedPoCount } = await syncReadyPayrollFlagsForYearMonthFromAllGatedPoMonthReviews(
          firestore,
          row.yearMonth,
        );
        const payrollPeriod = await ensureWorkerMonthlyPayrollPeriodForYearMonth(firestore, row.yearMonth, actorName);
        const billing = await ensureCommercialDraftInvoiceAfterPoMonthApproval(firestore, approvedRow, currentUser);
        const billingLine =
          billing.ok === true
            ? ` — สร้างใบแจ้งหนี้ ${billing.invoiceNo} อัตโนมัติ (ดูเมนูรายการใบแจ้งหนี้)`
            : ` — ใบแจ้งหนี้: ${billing.reason}`;
        const zeroPayrollHint =
          updated === 0
            ? ' — ไม่พบ timesheet ที่อัปเดตได้ในช่วงงวด (หรือ LOCKED หมด) — ตรวจรายวันว่า readyForPayroll / ช่วงวันที่'
            : ` — ซิงก์ครอบคลุม ${syncedPoCount} PO ที่ทับเดือน (เอกสารปิดงวดในเดือนนี้ ${gatedPoCount} ฉบับ)`;
        const periodHint = payrollPeriod.created
          ? ' — สร้างรอบบัญชีลูกจ้างอัตโนมัติแล้ว (ไปเมนูงวดจ่ายลูกจ้าง)'
          : '';
        const po = poById.get(row.poId);
        toast({
          title: 'อนุมัติแล้ว',
          description: `${row.yearMonth} · ${po?.poCode ?? row.poId} — ตั้งพร้อมจ่าย payroll ${updated} รายการ timesheet ในช่วงงวด (รวมทุก wave)${billingLine}${periodHint}${zeroPayrollHint}`,
        });
      } else {
        const po = poById.get(row.poId);
        toast({
          title: 'ปฏิเสธแล้ว',
          description: `${row.yearMonth} · ${po?.poCode ?? row.poId}`,
        });
      }
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'บันทึกไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusyId(null);
    }
  };

  if (userLoading || !currentUser) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground text-sm">กำลังโหลด…</div>
    );
  }

  if (!canSeePage) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="mx-auto max-w-lg py-20 text-center text-muted-foreground">ไม่มีสิทธิ์เข้าหน้านี้</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="mx-auto max-w-[1100px] space-y-6 px-4 py-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Button variant="link" className="h-auto p-0 text-muted-foreground" asChild>
              <Link href="/hr/approval-center">
                <ChevronLeft className="mr-1 inline h-4 w-4" />
                กลับศูนย์อนุมัติ
              </Link>
            </Button>
            <h1 className="text-2xl font-bold tracking-tight text-primary">คิวอนุมัติ Timesheet รอบเดือน</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              อนุมัติ <strong>Timesheet รายเดือน</strong> (รวมทุก wave ต่อ PO) เป็นหลักสำหรับใบแจ้งหนี้/พร้อมจ่าย — คิวจัด{' '}
              <strong>กลุ่มตามชุด PO Active</strong> (ลูกค้า + Onshore/Offshore) เพื่อไม่สลับหลาย PO ของลูกค้าเดียวกัน · ราย{' '}
              <strong>Wave</strong> ยังใช้สำหรับงวดที่อนุมัติราย wave ตามเดิม
            </p>
          </div>
        </div>

        {!canAct && (
          <Card className="border-amber-200 bg-amber-50/50">
            <CardHeader className="py-3">
              <CardTitle className="text-sm font-semibold text-amber-900">สิทธิ์ดูอย่างเดียว</CardTitle>
              <CardDescription className="text-amber-900/80">
                การกดอนุมัติ/ปฏิเสธใช้ได้เฉพาะ Operations Manager / HR Manager (หรือ System Admin)
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{poMonthQueueCardTitle}</CardTitle>
            <CardDescription>{poMonthQueueCardDescription}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loadingPo ? (
              <p className="p-6 text-center text-muted-foreground">กำลังโหลด…</p>
            ) : sortedPo.length === 0 ? (
              <p className="p-8 text-center text-muted-foreground">ไม่มีรายการ Timesheet รอบเดือนรอตรวจ</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>เดือน</TableHead>
                    <TableHead>PO</TableHead>
                    <TableHead>ขอบเขต</TableHead>
                    <TableHead>ผู้ส่ง</TableHead>
                    <TableHead className="text-center w-[200px]">ตรวจสอบ / แนบรูป</TableHead>
                    <TableHead className="text-right">การทำงาน</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupedPoMonth.map((g) => (
                    <Fragment key={g.bundleKey}>
                      <TableRow className="bg-primary/5 hover:bg-primary/5 border-t-2 border-primary/15">
                        <TableCell colSpan={6} className="py-3">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                            <Badge variant="outline" className="font-semibold">
                              {poActiveBundleWorkModeShortLabel(g.workMode)}
                            </Badge>
                            <span className="font-bold text-foreground">{customerLabel(g.customerId)}</span>
                            <span className="text-muted-foreground text-xs font-mono truncate max-w-[240px]" title={g.bundleKey}>
                              {g.bundleKey.startsWith('orphan:') ? 'ไม่มีชุด PO Active (PO เดี่ยว)' : g.bundleKey}
                            </span>
                            {!g.bundleKey.startsWith('orphan:') ? (
                              <Link
                                href={`/po-active/${encodeURIComponent(g.bundleKey)}`}
                                className="text-xs font-semibold text-primary underline"
                              >
                                เปิด PO Active
                              </Link>
                            ) : null}
                            <Badge variant="secondary" className="text-[10px]">
                              {g.rows.length} รายการในกลุ่ม
                            </Badge>
                          </div>
                        </TableCell>
                      </TableRow>
                      {g.rows.map((row) => {
                        const po = poById.get(row.poId);
                        const bundleKey = po ? resolvePoActiveBundleKeyForPo(po) : `orphan:${row.poId}`;
                        return (
                          <TableRow key={row.id}>
                            <TableCell className="font-mono text-sm">{row.yearMonth}</TableCell>
                            <TableCell className="text-sm">
                              <span className="font-medium">{po?.poCode ?? row.poId}</span>
                              <Badge variant="outline" className="ml-2 text-[10px] font-normal">
                                Timesheet
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm">รวมทุก wave</TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {row.submittedByName ?? row.submittedByUserId}
                              <br />
                              <span className="font-mono">{new Date(row.submittedAt).toLocaleString('th-TH')}</span>
                            </TableCell>
                            <TableCell className="text-center">
                              <div className="flex flex-wrap items-center justify-center gap-2">
                                <Button variant="outline" size="sm" className="h-8 gap-1" asChild>
                                  <Link
                                    href={`/timesheets/wave-month?month=${encodeURIComponent(row.yearMonth)}&highlightPo=${encodeURIComponent(row.poId)}&poActiveBundleId=${encodeURIComponent(bundleKey)}`}
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    Timesheet
                                  </Link>
                                </Button>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="h-8 gap-1"
                                  type="button"
                                  onClick={() => setPhotoDialogPo(row)}
                                  disabled={!(row.timesheetPhotoAttachments && row.timesheetPhotoAttachments.length > 0)}
                                >
                                  <Images className="h-3.5 w-3.5" />
                                  รูปแนบ
                                </Button>
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button
                                  size="sm"
                                  className="gap-1"
                                  disabled={!canAct || busyId === row.id}
                                  onClick={() => setStatusPo(row, 'approved')}
                                >
                                  <CheckCircle2 className="h-4 w-4" />
                                  อนุมัติ
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-1"
                                  disabled={!canAct || busyId === row.id}
                                  onClick={() => setStatusPo(row, 'rejected')}
                                >
                                  <XCircle className="h-4 w-4" />
                                  ปฏิเสธ
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">รอตรวจ — ต่อ Wave ({sorted.length})</CardTitle>
            <CardDescription>
              ส่งจากสรุปรายเดือน (Wave) — จัดกลุ่มตามชุด PO Active ของ PO เจ้าของ wave (legacy / งวดราย wave)
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <p className="p-6 text-center text-muted-foreground">กำลังโหลด…</p>
            ) : sorted.length === 0 ? (
              <p className="p-8 text-center text-muted-foreground">ไม่มีรายการรอตรวจ (ราย wave)</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>เดือน</TableHead>
                    <TableHead>PO</TableHead>
                    <TableHead>Wave</TableHead>
                    <TableHead>ผู้ส่ง</TableHead>
                    <TableHead className="text-center w-[200px]">ตรวจสอบ / แนบรูป</TableHead>
                    <TableHead className="text-right">การทำงาน</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupedWaveMonth.map((g) => (
                    <Fragment key={`wv-${g.bundleKey}`}>
                      <TableRow className="bg-muted/40 hover:bg-muted/40 border-t border-muted">
                        <TableCell colSpan={6} className="py-3">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                            <Badge variant="outline" className="font-semibold">
                              {poActiveBundleWorkModeShortLabel(g.workMode)}
                            </Badge>
                            <span className="font-bold text-foreground">{customerLabel(g.customerId)}</span>
                            <span className="text-muted-foreground text-xs font-mono truncate max-w-[240px]" title={g.bundleKey}>
                              {g.bundleKey.startsWith('orphan:') ? 'ไม่มีชุด PO Active (PO เดี่ยว)' : g.bundleKey}
                            </span>
                            {!g.bundleKey.startsWith('orphan:') ? (
                              <Link
                                href={`/po-active/${encodeURIComponent(g.bundleKey)}`}
                                className="text-xs font-semibold text-primary underline"
                              >
                                เปิด PO Active
                              </Link>
                            ) : null}
                            <Badge variant="secondary" className="text-[10px]">
                              {g.rows.length} wave ในกลุ่ม
                            </Badge>
                          </div>
                        </TableCell>
                      </TableRow>
                      {g.rows.map((row) => {
                        const po = poById.get(row.poId);
                        const wv = waveById.get(row.waveId);
                        const waveBundleKey = po ? resolvePoActiveBundleKeyForPo(po) : `orphan:${row.poId}`;
                        const waveMonthHref =
                          `/timesheets/wave-month?month=${encodeURIComponent(row.yearMonth)}&highlightWave=${encodeURIComponent(row.waveId)}` +
                          (waveBundleKey.startsWith('orphan:')
                            ? ''
                            : `&poActiveBundleId=${encodeURIComponent(waveBundleKey)}`);
                        return (
                          <TableRow key={row.id}>
                            <TableCell className="font-mono text-sm">{row.yearMonth}</TableCell>
                            <TableCell className="text-sm">
                              <span className="font-medium">{po?.poCode ?? row.poId}</span>
                              <Badge variant="outline" className="ml-2 text-[10px] font-normal">
                                Wave
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm">
                              {wv ? (
                                <span>
                                  {wv.waveCode} · {waveRoundMonthLabel(wv)}
                                </span>
                              ) : (
                                row.waveId
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {row.submittedByName ?? row.submittedByUserId}
                              <br />
                              <span className="font-mono">{new Date(row.submittedAt).toLocaleString('th-TH')}</span>
                            </TableCell>
                            <TableCell className="text-center">
                              <div className="flex flex-wrap items-center justify-center gap-2">
                                <Button variant="outline" size="sm" className="h-8 gap-1" asChild>
                                  <Link href={waveMonthHref}>
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    ดูสรุปรายเดือน
                                  </Link>
                                </Button>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="h-8 gap-1"
                                  type="button"
                                  onClick={() => setPhotoDialogRow(row)}
                                  disabled={!(row.timesheetPhotoAttachments && row.timesheetPhotoAttachments.length > 0)}
                                >
                                  <Images className="h-3.5 w-3.5" />
                                  รูปแนบ
                                </Button>
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button
                                  size="sm"
                                  className="gap-1"
                                  disabled={!canAct || busyId === row.id}
                                  onClick={() => setStatus(row, 'approved')}
                                >
                                  <CheckCircle2 className="h-4 w-4" />
                                  อนุมัติ
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-1"
                                  disabled={!canAct || busyId === row.id}
                                  onClick={() => setStatus(row, 'rejected')}
                                >
                                  <XCircle className="h-4 w-4" />
                                  ปฏิเสธ
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Dialog open={!!photoDialogRow} onOpenChange={(open) => !open && setPhotoDialogRow(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>เอกสาร / รูป timesheet แนบมา</DialogTitle>
              <DialogDescription>
                {photoDialogRow
                  ? `${photoDialogRow.yearMonth} · ${waveById.get(photoDialogRow.waveId)?.waveCode ?? photoDialogRow.waveId}`
                  : ''}
              </DialogDescription>
            </DialogHeader>
            {photoDialogRow?.timesheetPhotoAttachments?.length ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {photoDialogRow.timesheetPhotoAttachments.map((att) =>
                  isWaveMonthAttachmentPdf(att) ? (
                    <a
                      key={att.id}
                      href={att.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex min-h-[144px] flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border bg-muted/30 p-3 transition hover:bg-muted/50"
                    >
                      <FileText className="h-12 w-12 text-primary" />
                      <p className="line-clamp-2 text-center text-xs font-medium">{att.fileName}</p>
                      <span className="text-[10px] text-muted-foreground">PDF — คลิกเปิด</span>
                    </a>
                  ) : (
                    <a
                      key={att.id}
                      href={att.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group block overflow-hidden rounded-lg border bg-muted/30"
                    >
                      <img
                        src={att.downloadUrl}
                        alt={att.fileName}
                        className="h-36 w-full object-cover transition group-hover:opacity-90"
                      />
                      <p className="truncate px-2 py-1 text-[10px] text-muted-foreground">{att.fileName}</p>
                    </a>
                  ),
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">ไม่มีไฟล์แนบในรายการนี้</p>
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={!!photoDialogPo} onOpenChange={(open) => !open && setPhotoDialogPo(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>เอกสาร / รูป Timesheet รายเดือน</DialogTitle>
              <DialogDescription>
                {photoDialogPo
                  ? `${photoDialogPo.yearMonth} · ${poById.get(photoDialogPo.poId)?.poCode ?? photoDialogPo.poId}`
                  : ''}
              </DialogDescription>
            </DialogHeader>
            {photoDialogPo?.timesheetPhotoAttachments?.length ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {photoDialogPo.timesheetPhotoAttachments.map((att) =>
                  isWaveMonthAttachmentPdf(att) ? (
                    <a
                      key={att.id}
                      href={att.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex min-h-[144px] flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border bg-muted/30 p-3 transition hover:bg-muted/50"
                    >
                      <FileText className="h-12 w-12 text-primary" />
                      <p className="line-clamp-2 text-center text-xs font-medium">{att.fileName}</p>
                      <span className="text-[10px] text-muted-foreground">PDF — คลิกเปิด</span>
                    </a>
                  ) : (
                    <a
                      key={att.id}
                      href={att.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group block overflow-hidden rounded-lg border bg-muted/30"
                    >
                      <img
                        src={att.downloadUrl}
                        alt={att.fileName}
                        className="h-36 w-full object-cover transition group-hover:opacity-90"
                      />
                      <p className="truncate px-2 py-1 text-[10px] text-muted-foreground">{att.fileName}</p>
                    </a>
                  ),
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">ไม่มีไฟล์แนบ — อัปโหลดได้จากหน้า Timesheet รายเดือนเมื่อเปิดใช้งานเต็มรูป</p>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
