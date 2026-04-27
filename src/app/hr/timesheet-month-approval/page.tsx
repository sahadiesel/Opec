'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
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
import { collection, doc, query, where, updateDoc } from 'firebase/firestore';
import { isHrManager, isOperationManager, isSystemAdmin } from '@/lib/permission-core';
import { isSimpleAdmin } from '@/lib/simple-tier-model';
import { canViewHrApprovalSubsection } from '@/lib/navigation/nav-access';
import type { User, PoMonthTimesheetReview, WaveMonthTimesheetReview, PurchaseOrder, Wave } from '@/lib/types';
import {
  ensureOpenPayrollPeriodForWaveMonthReview,
  markTimesheetsReadyForPayrollAfterMonthApproval,
} from '@/lib/timesheet/wave-month-payroll-bridge';
import {
  ensureOpenPayrollPeriodForPoMonthReview,
  markTimesheetsReadyForPayrollAfterPoMonthApproval,
} from '@/lib/timesheet/po-month-timesheet-bridge';
import {
  ensureCommercialDraftInvoiceAfterMonthApproval,
  ensureCommercialDraftInvoiceAfterPoMonthApproval,
} from '@/lib/services/commercial-invoice-service';
import { CheckCircle2, XCircle, ChevronLeft, ExternalLink, FileText, Images } from 'lucide-react';
import { waveRoundMonthLabel } from '@/lib/constants/timesheet-ui';
import { isWaveMonthAttachmentPdf } from '@/lib/timesheet/wave-month-utils';

function canReviewMonthlyQueue(user: User | null): boolean {
  if (!user) return false;
  if (isSystemAdmin(user)) return true;
  return isOperationManager(user) || isHrManager(user);
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
        const { updated } = await markTimesheetsReadyForPayrollAfterPoMonthApproval(firestore, approvedRow);
        const actorName = currentUser.displayName || currentUser.email || currentUser.id;
        const payrollPeriod = await ensureOpenPayrollPeriodForPoMonthReview(firestore, approvedRow, actorName);
        const billing = await ensureCommercialDraftInvoiceAfterPoMonthApproval(firestore, approvedRow, currentUser);
        const billingLine =
          billing.ok === true
            ? ` — สร้างใบแจ้งหนี้ ${billing.invoiceNo} อัตโนมัติ (PO+งวด — ดูเมนูรายการใบแจ้งหนี้)`
            : ` — ใบแจ้งหนี้: ${billing.reason}`;
        const zeroPayrollHint =
          updated === 0
            ? ' — ไม่พบ timesheet ที่อัปเดตได้ในช่วงงวด (หรือ LOCKED หมด) — ตรวจรายวันว่า readyForPayroll / ช่วงวันที่'
            : '';
        const periodHint = payrollPeriod.created
          ? ' — สร้างรอบบัญชีลูกจ้างอัตโนมัติแล้ว (ไปเมนูงวดจ่ายลูกจ้าง)'
          : '';
        const po = poById.get(row.poId);
        toast({
          title: 'อนุมัติแล้ว (PO+งวด)',
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
            <h1 className="text-2xl font-bold tracking-tight text-primary">คิวอนุมัติ Timesheet รอบเดือน (PO+งวด / Wave)</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              อนุมัติ <strong>งวด timesheet รวมราย PO+เดือน</strong> (รวมทุก wave) เป็นหลักสำหรับใบแจ้งหนี้/พร้อมจ่าย
              — ราย <strong>Wave</strong> ยังใช้สำหรับงวดที่อนุมัติราย wave ตามเดิม
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
            <CardTitle className="text-base">รอตรวจ — PO+เดือน ({sortedPo.length})</CardTitle>
            <CardDescription>ส่งจากหน้า Timesheet ราย PO+งวด — รวม timesheet ทุก wave ใต้ PO ในช่วงงวด</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loadingPo ? (
              <p className="p-6 text-center text-muted-foreground">กำลังโหลด…</p>
            ) : sortedPo.length === 0 ? (
              <p className="p-8 text-center text-muted-foreground">ไม่มีรายการ PO+งวดรอตรวจ</p>
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
                  {sortedPo.map((row) => {
                    const po = poById.get(row.poId);
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono text-sm">{row.yearMonth}</TableCell>
                        <TableCell className="text-sm">{po?.poCode ?? row.poId}</TableCell>
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
                                href={`/timesheets/po-month?month=${encodeURIComponent(row.yearMonth)}&highlightPo=${encodeURIComponent(row.poId)}`}
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                เอกสารรอบ PO
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
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">รอตรวจ — ต่อ Wave ({sorted.length})</CardTitle>
            <CardDescription>ส่งจากสรุปรายเดือน (Wave) — pending_manager_review</CardDescription>
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
                  {sorted.map((row) => {
                    const po = poById.get(row.poId);
                    const wv = waveById.get(row.waveId);
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono text-sm">{row.yearMonth}</TableCell>
                        <TableCell className="text-sm">{po?.poCode ?? row.poId}</TableCell>
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
                              <Link
                                href={`/timesheets/wave-month?month=${encodeURIComponent(row.yearMonth)}&highlightWave=${encodeURIComponent(row.waveId)}`}
                              >
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
              <DialogTitle>เอกสาร / รูป (งวด PO+เดือน)</DialogTitle>
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
              <p className="text-sm text-muted-foreground">ไม่มีไฟล์แนบ — อัปโหลดที่หน้า PO+งวดเมื่อเปิดใช้งานเต็มรูป</p>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
