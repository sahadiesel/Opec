'use client';

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, doc, getDoc, setDoc, query, where, limit } from 'firebase/firestore';
import type { PoMonthTimesheetReview, PurchaseOrder, User, Wave } from '@/lib/types';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccess, canView, isMatrixControlledRole, canEdit } from '@/lib/permissions';
import { formatThaiYearMonthLabel } from '@/lib/ops/timesheet-hub-po-month';
import { poMonthTimesheetReviewDocId } from '@/lib/timesheet/po-month-timesheet-bridge';
import { lastDayOfCalendarMonth } from '@/lib/timesheet/wave-month-utils';
import { PageGuidance } from '@/components/layout/page-guidance';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import { useToast } from '@/hooks/use-toast';
import { FileText, Info, Loader2, Send } from 'lucide-react';
function ymNow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function statusBadge(s: PoMonthTimesheetReview['status']) {
  switch (s) {
    case 'approved':
      return <Badge className="bg-emerald-700">อนุมัติแล้ว</Badge>;
    case 'pending_manager_review':
      return <Badge className="bg-amber-600">รอผู้จัดการ</Badge>;
    case 'rejected':
      return <Badge variant="destructive">ปฏิเสธ</Badge>;
    case 'entry_locked':
      return <Badge variant="secondary">ล็อกงวด (ยังไม่ส่ง)</Badge>;
    default:
      return <Badge variant="outline">{s}</Badge>;
  }
}

function waveTouchesMonth(w: Wave, yearMonth: string): boolean {
  if (!w.startDate || !w.endDate) return false;
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return false;
  const mStart = `${yearMonth}-01`;
  const mEnd = (() => {
    const [y, m] = yearMonth.split('-').map(Number);
    return new Date(y, m, 0).toISOString().slice(0, 10);
  })();
  return w.startDate <= mEnd && w.endDate >= mStart;
}

function TimesheetPoMonthContent() {
  const searchParams = useSearchParams();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const useMatrixGuards = isMatrixControlledRole(currentUser);
  const canViewTs = useMatrixGuards ? canAccess(currentUser!, 'timesheets', 'view') : canView(currentUser, 'timesheets');
  const canEditTs = useMatrixGuards ? canAccess(currentUser!, 'timesheets', 'edit') : canEdit(currentUser, 'timesheets');

  const monthFromUrl = (searchParams.get('month') || '').trim();
  const highlightPo = (searchParams.get('highlightPo') || '').trim();
  const [monthYm, setMonthYm] = useState(monthFromUrl && /^\d{4}-\d{2}$/.test(monthFromUrl) ? monthFromUrl : ymNow());

  useEffect(() => {
    if (monthFromUrl && /^\d{4}-\d{2}$/.test(monthFromUrl)) {
      setMonthYm(monthFromUrl);
    }
  }, [monthFromUrl]);

  const posQuery = useMemoFirebase(
    () =>
      firestore && canViewTs
        ? query(collection(firestore, 'purchase_orders'), where('status', '==', 'active'), limit(200))
        : null,
    [firestore, canViewTs]
  );
  const { data: allPos, isLoading: posLoading } = useCollection<PurchaseOrder>(posQuery as any);

  const wavesQuery = useMemoFirebase(
    () => (firestore && canViewTs ? collection(firestore, 'waves') : null),
    [firestore, canViewTs]
  );
  const { data: allWaves, isLoading: wavesLoading } = useCollection<Wave>(wavesQuery as any);

  const monthReviewsQuery = useMemoFirebase(
    () =>
      firestore && canViewTs && monthYm
        ? query(collection(firestore, 'po_month_timesheet_reviews'), where('yearMonth', '==', monthYm))
        : null,
    [firestore, canViewTs, monthYm]
  );
  const { data: monthRows, isLoading: reviewsLoading } = useCollection<PoMonthTimesheetReview>(monthReviewsQuery as any);

  const reviewByPoId = useMemo(() => {
    const m = new Map<string, PoMonthTimesheetReview>();
    for (const r of monthRows ?? []) m.set(r.poId, r);
    return m;
  }, [monthRows]);

  const posWithWaves = useMemo(() => {
    const list = (allPos ?? []).filter((po) => (allWaves ?? []).some((w) => w.poId === po.id));
    return list;
  }, [allPos, allWaves]);

  const [submittingPoId, setSubmittingPoId] = useState<string | null>(null);

  const relatedWaveIdsFor = useCallback(
    (poId: string) =>
      (allWaves ?? []).filter((w) => w.poId === poId && waveTouchesMonth(w, monthYm)).map((w) => w.id),
    [allWaves, monthYm]
  );

  const submitForReview = async (po: PurchaseOrder) => {
    if (!firestore || !currentUser || !canEditTs) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์' });
      return;
    }
    setSubmittingPoId(po.id);
    try {
      const id = poMonthTimesheetReviewDocId(po.id, monthYm);
      const ref = doc(firestore, 'po_month_timesheet_reviews', id);
      const existing = await getDoc(ref);
      if (existing.exists()) {
        const st = (existing.data() as PoMonthTimesheetReview).status;
        if (st === 'pending_manager_review' || st === 'approved' || st === 'entry_locked') {
          toast({
            variant: 'destructive',
            title: 'มีเอกสารงวดแล้ว',
            description: `สถานะ: ${st} — ใช้หน้าคิวอนุมัติ manager แทน`,
          });
          return;
        }
      }
      const now = Date.now();
      const wids = relatedWaveIdsFor(po.id);
      const start = `${monthYm}-01`;
      const end = lastDayOfCalendarMonth(monthYm);
      await setDoc(
        ref,
        {
          id,
          poId: po.id,
          yearMonth: monthYm,
          status: 'pending_manager_review' as const,
          periodStartDate: start,
          periodEndDate: end,
          relatedWaveIds: wids,
          submittedAt: now,
          submittedByUserId: currentUser.id,
          submittedByName: currentUser.displayName || currentUser.email || currentUser.id,
          createdAt: existing.exists() ? (existing.data() as PoMonthTimesheetReview).createdAt ?? now : now,
          updatedAt: now,
        },
        { merge: true }
      );
      toast({ title: 'ส่งคิวแล้ว', description: 'ผู้จัดการตรวจที่เมนู HR / อนุมัติ timesheet รอบเดือน' });
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'บันทึกไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSubmittingPoId(null);
    }
  };

  if (userLoading || !currentUser) return null;
  if (!canViewTs) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-5xl mx-auto py-10 text-center text-muted-foreground">คุณไม่มีสิทธิ์เมนูนี้</div>
      </AppShell>
    );
  }

  const loading = posLoading || wavesLoading || reviewsLoading;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="mx-auto max-w-[1100px] space-y-6 py-6 px-4">
        <div>
          <PayrollScopeTag scope="worker" showHint={false} />
          <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
            <FileText className="h-7 w-7" />
            Timesheet รายเดือน — ต่อ PO (อ้างอิงงวด)
          </h1>
          <p className="text-muted-foreground text-sm max-w-3xl mt-1">
            เอกสารงวดนี้ = <strong>PO + ปฏิทิน (yyyy-MM)</strong> รวม <strong>ทุก wave</strong> ที่มีช่วงกินเดือน — ใช้เป็นหลักสำหรับ
            อนุมัติ / พร้อมจ่าย payroll / ออกใบแจ้งหนี้ แทนการอ้างทีละ wave (ยังลงรายวันเทียบ wave บน board ตามเดิม)
          </p>
        </div>

        <PageGuidance
          title="กับราย wave"
          tips={[
            'ลงเวลาและแก้ไขรายวันยังใช้กระดาน / Wave ต่อเดิม — งวดนี้เป็นชั้น “รวม PO” สำหรับ sign-off สิ้นงวด',
            'กด “ส่งคิว” เมื่อพร้อมให้ manager อนุมัติ — หมายถึงตรวจ timesheet+แนบไฟล์แล้วตามขั้นตอนฝ่าย',
            'ใบแจ้งหนี้ (Draft) จะออกจาก **งวด PO+เดือน** ที่อนุมัติ โดยดึง timesheet รวมทุก wave ใต้ PO ในช่วงงวด',
          ]}
        />

        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>อ้างอิงราย wave แบบเดิม</AlertTitle>
          <AlertDescription className="text-sm">
            ยังมี flow ราย wave ที่ <Link className="underline text-primary" href="/timesheets/wave-month">สรุปรายเดือน (Wave)</Link> — ใช้
            คู่กับงวด PO ตาม policy บริษัท
          </AlertDescription>
        </Alert>

        <div className="flex flex-col sm:flex-row gap-3 items-end">
          <div className="space-y-1">
            <Label>งวด (yyyy-MM)</Label>
            <Input
              className="font-mono w-40"
              value={monthYm}
              onChange={(e) => setMonthYm((e.target.value || '').trim().slice(0, 7))}
            />
            <p className="text-xs text-muted-foreground">{formatThaiYearMonthLabel(monthYm)}</p>
          </div>
          <Button variant="outline" asChild>
            <Link href={`/hr/timesheet-month-approval`}>ไปคิวอนุมัติ (Manager)</Link>
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">PO ที่เปิด wave + เอกสารงวด</CardTitle>
            <CardDescription>เฉพาะ PO ที่มี wave ที่ทับกับงวดเดือนที่เลือก</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <p className="p-6 text-center text-muted-foreground flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลด…
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>PO</TableHead>
                    <TableHead>โปรเจกต์</TableHead>
                    <TableHead>เอกสาร PO+งวด</TableHead>
                    <TableHead className="text-right pr-4">ดำเนินการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {posWithWaves
                    .filter((po) => (allWaves ?? []).some((w) => w.poId === po.id && waveTouchesMonth(w, monthYm)))
                    .map((po) => {
                      const r = reviewByPoId.get(po.id);
                      const isHi = highlightPo && highlightPo === po.id;
                      return (
                        <TableRow key={po.id} className={isHi ? 'bg-primary/5' : undefined}>
                          <TableCell className="font-mono text-sm pl-4">{po.poCode}</TableCell>
                          <TableCell>{po.projectName}</TableCell>
                          <TableCell>
                            {r ? <div className="flex items-center gap-2">{statusBadge(r.status)}</div> : (
                              <span className="text-muted-foreground text-sm">ยังไม่มี</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right pr-4">
                            <div className="flex flex-wrap justify-end gap-2">
                              <Button variant="outline" size="sm" asChild>
                                <Link href={`/timesheets?poId=${encodeURIComponent(po.id)}`}>
                                  ศูนย์เวลา
                                </Link>
                              </Button>
                              {canEditTs && (!r || r.status === 'rejected') && (
                                <Button
                                  size="sm"
                                  className="gap-1"
                                  disabled={!!submittingPoId}
                                  onClick={() => void submitForReview(po)}
                                >
                                  {submittingPoId === po.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Send className="h-3.5 w-3.5" />
                                  )}
                                  ส่งคิว (รอ manager)
                                </Button>
                              )}
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
      </div>
    </AppShell>
  );
}

export default function TimesheetPoMonthPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-muted-foreground">กำลังโหลด…</div>}>
      <TimesheetPoMonthContent />
    </Suspense>
  );
}
