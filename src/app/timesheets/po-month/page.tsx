'use client';

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useFirestore, useCollection, useMemoFirebase, useFirebaseApp } from '@/firebase';
import {
  collection,
  doc,
  getDoc,
  setDoc,
  query,
  where,
  limit,
  deleteField,
} from 'firebase/firestore';
import type {
  Customer,
  PoLocationMonthTimesheet,
  PoMonthTimesheetPhotoBundle,
  PoMonthTimesheetReview,
  PurchaseOrder,
  User,
  Wave,
} from '@/lib/types';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccess, canView, isMatrixControlledRole, canEdit } from '@/lib/permissions';
import { formatThaiYearMonthLabel } from '@/lib/ops/timesheet-hub-po-month';
import { poMonthTimesheetReviewDocId } from '@/lib/timesheet/po-month-timesheet-bridge';
import { lastDayOfCalendarMonth } from '@/lib/timesheet/wave-month-utils';
import { isWaveMonthAttachmentPdf } from '@/lib/timesheet/wave-month-utils';
import { PageGuidance } from '@/components/layout/page-guidance';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import { useToast } from '@/hooks/use-toast';
import { ensureMonthlyTimesheetDocument } from '@/lib/timesheet/ensure-monthly-timesheet-document';
import {
  ensurePoLocationMonthShellsForPo,
  formatPoLocationMonthShellListLabel,
  purchaseOrderOverlapsYearMonth,
} from '@/lib/timesheet/po-location-month-shell';
import {
  deletePoMonthTimesheetPhotoFile,
  uploadPoMonthTimesheetPhoto,
} from '@/lib/storage/po-month-timesheet-photos';
import { FileText, ImagePlus, Info, Loader2, Lock, Send, Trash2, FileText as FileIcon, MapPin } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const MAX_PO_MONTH_ATTACHMENTS = 4;

function ymNow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shellStatusBadge(s: PoLocationMonthTimesheet['status']) {
  switch (s) {
    case 'active':
      return <Badge className="bg-emerald-700">ACTIVE</Badge>;
    case 'closed':
      return <Badge variant="secondary">ปิด</Badge>;
    default:
      return <Badge variant="outline">PLANNING</Badge>;
  }
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

function isAttachmentReadonly(r: PoMonthTimesheetReview | undefined): boolean {
  if (!r) return false;
  return r.status === 'pending_manager_review' || r.status === 'approved';
}

function TimesheetPoMonthContent() {
  const searchParams = useSearchParams();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const firebaseApp = useFirebaseApp();
  const { toast } = useToast();
  const useMatrixGuards = isMatrixControlledRole(currentUser);
  const canViewTs = useMatrixGuards ? canAccess(currentUser!, 'timesheets', 'view') : canView(currentUser, 'timesheets');
  const canEditTs = useMatrixGuards ? canAccess(currentUser!, 'timesheets', 'edit') : canEdit(currentUser, 'timesheets');

  const monthFromUrl = (searchParams.get('month') || '').trim();
  const highlightPo = (searchParams.get('highlightPo') || '').trim();
  const [monthYm, setMonthYm] = useState(monthFromUrl && /^\d{4}-\d{2}$/.test(monthFromUrl) ? monthFromUrl : ymNow());

  const [monthlyTimesheetNo, setMonthlyTimesheetNo] = useState<string | null>(null);
  const [monthlyDocLoading, setMonthlyDocLoading] = useState(false);
  const [periodEndByPo, setPeriodEndByPo] = useState<Record<string, string>>({});
  const [uploadingPhotoPoId, setUploadingPhotoPoId] = useState<string | null>(null);
  const [submittingPoId, setSubmittingPoId] = useState<string | null>(null);
  const [submitDialogPo, setSubmitDialogPo] = useState<PurchaseOrder | null>(null);
  const [submitQ1, setSubmitQ1] = useState(false);
  const [submitQ2, setSubmitQ2] = useState(false);

  useEffect(() => {
    if (monthFromUrl && /^\d{4}-\d{2}$/.test(monthFromUrl)) {
      setMonthYm(monthFromUrl);
    }
  }, [monthFromUrl]);

  useEffect(() => {
    if (!submitDialogPo) {
      setSubmitQ1(false);
      setSubmitQ2(false);
    }
  }, [submitDialogPo]);

  useEffect(() => {
    if (!firestore || !currentUser || !monthYm || !canViewTs) return;
    setMonthlyDocLoading(true);
    let c = true;
    void (async () => {
      try {
        const no = await ensureMonthlyTimesheetDocument(firestore, monthYm, currentUser);
        if (c && no) setMonthlyTimesheetNo(no);
      } catch (e) {
        console.error('[po-month] monthly timesheet doc', e);
        if (c) setMonthlyTimesheetNo(null);
      } finally {
        if (c) setMonthlyDocLoading(false);
      }
    })();
    return () => {
      c = false;
    };
  }, [firestore, currentUser, monthYm, canViewTs]);

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

  const photoBundlesQuery = useMemoFirebase(
    () =>
      firestore && canViewTs && monthYm
        ? query(collection(firestore, 'po_month_timesheet_photo_bundles'), where('yearMonth', '==', monthYm))
        : null,
    [firestore, canViewTs, monthYm]
  );
  const { data: photoBundleRows } = useCollection<PoMonthTimesheetPhotoBundle>(photoBundlesQuery as any);

  const locShellsQuery = useMemoFirebase(
    () =>
      firestore && canViewTs && monthYm
        ? query(collection(firestore, 'po_location_month_timesheets'), where('yearMonth', '==', monthYm), limit(500))
        : null,
    [firestore, canViewTs, monthYm],
  );
  const { data: locShellRows, isLoading: locShellsLoading } = useCollection<PoLocationMonthTimesheet>(
    locShellsQuery as any,
  );

  const customersQuery = useMemoFirebase(
    () => (firestore && canViewTs ? query(collection(firestore, 'customers'), limit(500)) : null),
    [firestore, canViewTs],
  );
  const { data: allCustomers } = useCollection<Customer>(customersQuery as any);

  const customerNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of allCustomers ?? []) m.set(c.id, c.name);
    return m;
  }, [allCustomers]);

  const locShellsSorted = useMemo(() => {
    const list = [...(locShellRows ?? [])];
    list.sort((a, b) => {
      const c0 = (a.poCodeSnapshot || a.poId).localeCompare(b.poCodeSnapshot || b.poId);
      if (c0 !== 0) return c0;
      return (a.locationLabel || a.locationKey).localeCompare(b.locationLabel || b.locationKey, 'th');
    });
    return list;
  }, [locShellRows]);

  const contractPosForShellEnsure = useMemo(
    () =>
      (allPos ?? []).filter(
        (p) =>
          p.status === 'active' &&
          (p.poType || 'contract') !== 'quotation' &&
          purchaseOrderOverlapsYearMonth(p, monthYm),
      ),
    [allPos, monthYm],
  );

  useEffect(() => {
    if (!firestore || !currentUser || !canViewTs || !monthYm) return;
    if (contractPosForShellEnsure.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const po of contractPosForShellEnsure) {
        if (cancelled) break;
        try {
          await ensurePoLocationMonthShellsForPo(firestore, po, monthYm, {
            userId: currentUser.id,
            displayName: currentUser.displayName || currentUser.email || currentUser.id,
          });
        } catch (e) {
          console.error('[po-month] location shells', e);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, currentUser, canViewTs, monthYm, contractPosForShellEnsure]);

  const reviewByPoId = useMemo(() => {
    const m = new Map<string, PoMonthTimesheetReview>();
    for (const r of monthRows ?? []) m.set(r.poId, r);
    return m;
  }, [monthRows]);

  const bundleByPoId = useMemo(() => {
    const m = new Map<string, PoMonthTimesheetPhotoBundle>();
    for (const b of photoBundleRows ?? []) m.set(b.poId, b);
    return m;
  }, [photoBundleRows]);

  useEffect(() => {
    setPeriodEndByPo((prev) => {
      const next = { ...prev };
      for (const r of monthRows ?? []) {
        if (r.periodEndDate && /^\d{4}-\d{2}-\d{2}$/.test(r.periodEndDate)) {
          if (!next[r.poId]) next[r.poId] = r.periodEndDate;
        }
      }
      return next;
    });
  }, [monthRows]);

  const posWithWaves = useMemo(() => {
    const list = (allPos ?? []).filter((po) => (allWaves ?? []).some((w) => w.poId === po.id));
    return list;
  }, [allPos, allWaves]);

  const relatedWaveIdsFor = useCallback(
    (poId: string) =>
      (allWaves ?? []).filter((w) => w.poId === poId && waveTouchesMonth(w, monthYm)).map((w) => w.id),
    [allWaves, monthYm]
  );

  const getPeriodBounds = useCallback(
    (poId: string) => {
      const monthFirst = `${monthYm}-01`;
      const monthLast = lastDayOfCalendarMonth(monthYm);
      const end = periodEndByPo[poId] ?? monthLast;
      return { periodStartDate: monthFirst, periodEndDate: end < monthFirst ? monthLast : end };
    },
    [monthYm, periodEndByPo],
  );

  const writePoMonthReview = useCallback(
    async (po: PurchaseOrder, status: PoMonthTimesheetReview['status']) => {
      if (!firestore || !currentUser || !canEditTs) return;
      const { periodStartDate, periodEndDate } = getPeriodBounds(po.id);
      if (periodEndDate < periodStartDate) {
        toast({ variant: 'destructive', title: 'ช่วงวันที่ไม่ถูกต้อง', description: 'วันสุดท้ายต้องไม่ก่อนวันต้นเดือน' });
        return;
      }
      setSubmittingPoId(po.id);
      try {
        const id = poMonthTimesheetReviewDocId(po.id, monthYm);
        const now = Date.now();
        const ref = doc(firestore, 'po_month_timesheet_reviews', id);
        const existing = await getDoc(ref);
        const createdAt =
          existing.exists() && typeof existing.data()?.createdAt === 'number'
            ? (existing.data() as PoMonthTimesheetReview).createdAt
            : now;
        const wids = relatedWaveIdsFor(po.id);

        const base: Record<string, unknown> = {
          id,
          poId: po.id,
          yearMonth: monthYm,
          status,
          periodStartDate,
          periodEndDate,
          relatedWaveIds: wids,
          submittedAt: now,
          submittedByUserId: currentUser.id,
          submittedByName: currentUser.displayName || currentUser.email || currentUser.id,
          createdAt,
          updatedAt: now,
        };
        if (status === 'entry_locked') {
          base.entryLockedAt = now;
          base.entryLockedByUserId = currentUser.id;
          base.entryLockedByName = currentUser.displayName || currentUser.email || '';
        }
        if (status === 'pending_manager_review') {
          base.reviewedAt = deleteField();
          base.reviewedByUserId = deleteField();
          base.reviewedByName = deleteField();
          base.reviewNote = deleteField();
          const bundleRef = doc(firestore, 'po_month_timesheet_photo_bundles', id);
          const bundleSnap = await getDoc(bundleRef);
          let atts: PoMonthTimesheetReview['timesheetPhotoAttachments'] = [];
          if (bundleSnap.exists()) {
            const bd = bundleSnap.data() as PoMonthTimesheetPhotoBundle;
            atts = Array.isArray(bd.attachments) ? bd.attachments : [];
          }
          base.timesheetPhotoAttachments = atts;
        }
        await setDoc(ref, base, { merge: true });
        if (status === 'entry_locked') {
          toast({ title: 'ล็อกงวดแล้ว', description: 'แก้รายวันไม่ได้เมื่อเอกสาร PO+งวดถูกล็อก — กด «ส่งตรวจ» เมื่อแนบครบ' });
        } else if (status === 'pending_manager_review') {
          toast({ title: 'ส่งตรวจสอบแล้ว', description: 'รอผู้จัดการที่คิวอนุมัติ — หลังอนุมัติระบบจะตั้งงาน invoice + payroll' });
        }
      } catch (e: unknown) {
        toast({
          variant: 'destructive',
          title: 'บันทึกไม่สำเร็จ',
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setSubmittingPoId(null);
      }
    },
    [firestore, currentUser, canEditTs, monthYm, getPeriodBounds, relatedWaveIdsFor, toast],
  );

  const appendPhoto = useCallback(
    async (po: PurchaseOrder, file: File) => {
      if (!firebaseApp || !firestore) return;
      const id = poMonthTimesheetReviewDocId(po.id, monthYm);
      const existing = bundleByPoId.get(po.id);
      if ((existing?.attachments?.length ?? 0) >= MAX_PO_MONTH_ATTACHMENTS) {
        toast({
          variant: 'destructive',
          title: 'เต็มจำนวนแนบ',
          description: `แนบได้สูงสุด ${MAX_PO_MONTH_ATTACHMENTS} ไฟล์ — ลบบางรายก่อนเพิ่ม`,
        });
        return;
      }
      setUploadingPhotoPoId(po.id);
      try {
        const att = await uploadPoMonthTimesheetPhoto(firebaseApp, id, file);
        const bundleRef = doc(firestore, 'po_month_timesheet_photo_bundles', id);
        const snap = await getDoc(bundleRef);
        const prev = snap.exists() ? ((snap.data() as PoMonthTimesheetPhotoBundle).attachments ?? []) : [];
        await setDoc(
          bundleRef,
          {
            id,
            poId: po.id,
            yearMonth: monthYm,
            attachments: [...prev, att],
            updatedAt: Date.now(),
          } as Record<string, unknown>,
          { merge: true }
        );
        toast({ title: 'แนบไฟล์แล้ว', description: 'รูปมากกว่า ~500 KB ระบบจะบีบอัตโนมัติ' });
      } catch (e: unknown) {
        toast({
          variant: 'destructive',
          title: 'อัปโหลดไม่สำเร็จ',
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setUploadingPhotoPoId(null);
      }
    },
    [firebaseApp, firestore, monthYm, bundleByPoId, toast],
  );

  const removePhoto = useCallback(
    async (po: PurchaseOrder, attId: string, storagePath: string) => {
      if (!firebaseApp || !firestore) return;
      const id = poMonthTimesheetReviewDocId(po.id, monthYm);
      setUploadingPhotoPoId(po.id);
      try {
        await deletePoMonthTimesheetPhotoFile(firebaseApp, storagePath);
        const bundleRef = doc(firestore, 'po_month_timesheet_photo_bundles', id);
        const snap = await getDoc(bundleRef);
        if (!snap.exists()) return;
        const bd = snap.data() as PoMonthTimesheetPhotoBundle;
        const next = (bd.attachments ?? []).filter((a) => a.id !== attId);
        await setDoc(bundleRef, { attachments: next, updatedAt: Date.now() }, { merge: true });
        toast({ title: 'ลบไฟล์แล้ว' });
      } catch (e: unknown) {
        toast({
          variant: 'destructive',
          title: 'ลบไม่สำเร็จ',
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setUploadingPhotoPoId(null);
      }
    },
    [firebaseApp, firestore, monthYm, toast],
  );

  if (userLoading || !currentUser) return null;
  if (!canViewTs) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-5xl mx-auto py-10 text-center text-muted-foreground">คุณไม่มีสิทธิ์เมนูนี้</div>
      </AppShell>
    );
  }

  const loading = posLoading || wavesLoading || reviewsLoading;

  const posRows = posWithWaves.filter((po) => (allWaves ?? []).some((w) => w.poId === po.id && waveTouchesMonth(w, monthYm)));

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="mx-auto max-w-[1100px] space-y-6 py-6 px-4">
        <div>
          <PayrollScopeTag scope="worker" showHint={false} />
          <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
            <FileText className="h-7 w-7" />
            เอกสาร timesheet ราย PO+เดือน (ล็อก / ส่งตรวจ / แนบ)
          </h1>
          <p className="text-muted-foreground text-sm max-w-3xl mt-1">
            <strong>ชุดนี้เป็นหลัก</strong> สำหรับปิดงวด ส่งลูกค้า/ผู้จัดการตรวจ ออก invoice และงาน payroll —{' '}
            <strong>ไม่อ้างอิง Wave ในการออกเอกสาร</strong> (ราย wave ยังใช้ลงเวลารายวันบนกระดาน) · เลขรวม:{' '}
            {monthlyDocLoading ? (
              <span className="font-mono">…</span>
            ) : (
              <span className="font-mono font-semibold text-foreground">{monthlyTimesheetNo ?? '—'}</span>
            )}
          </p>
        </div>

        <PageGuidance
          title="ขั้นตอน"
          tips={[
            'ตั้ง "วันสุดท้ายของงวด" ตามรอบปิดจริง แล้วกด ล็อกงวด — จากนั้นแนบรูป/PDF ได้สูงสุด 4 ไฟล์ (รูปใหญ่กว่า ~500KB จะบีบอัตโนมัติ, PDF สูงสุด 10MB)',
            'กด ส่งตรวจสอบ ให้ผู้อนุมัติ (เมนู HR) — หลัง approved ระบบจะเตรียมใบแจ้งหนี้ + งวดจ่ายตาม timesheet รอบนี้',
            'ดูสรุปกริดรายเดือน: ลิงก์ไปหน้า "สรุปรายเดือน" สำหรับตรวจตัวเลข แต่ปิดงวดทำที่นี่',
          ]}
        />

        <Alert className="border-sky-200/80 bg-sky-50/50 dark:border-sky-800 dark:bg-sky-950/20">
          <Info className="h-4 w-4" />
          <AlertTitle>ไม่ใช่ราย Wave แล้ว</AlertTitle>
          <AlertDescription className="text-sm">
            งานปิดเอกสาร/แนบไฟล์ย้ายมาใช้ตารางนี้เท่านั้น — หน้า{' '}
            <Link className="text-primary font-medium underline" href={`/timesheets/wave-month?month=${encodeURIComponent(monthYm)}`}>
              สรุปรายเดือน (ราย wave)
            </Link>{' '}
            ใช้เพื่อดูตารางรวมและลงรายวัน
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              งวด timesheet ตามสถานที่ (เฟส B — จาก PO line)
            </CardTitle>
            <CardDescription>
              สร้าง/อัปเดตอัตโนมัติเมื่อโหลดหน้านี้ โดยรวมบรรทัด PO ตาม <strong>workLocation</strong> — แยกหัวงวดต่อ
              ลูกค้า/สัญญา/PO/สถานที่/เดือน แม้ยังไม่มี wave หรือรายลงเวลา (สถานะเริ่มที่ PLANNING)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {locShellsLoading ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดรายการงวด…
              </p>
            ) : locShellsSorted.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                ยังไม่มีหัวงวด — ตรวจว่า PO สัญญา (active) ทับช่วงเดือนนี้และมีบรรทัด PO ระบุสถานที่
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>รายการ</TableHead>
                      <TableHead>ลูกค้า</TableHead>
                      <TableHead>สถานที่</TableHead>
                      <TableHead className="w-[7rem]">สถานะ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {locShellsSorted.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="align-top text-sm">
                          <div className="font-mono font-medium">{row.poCodeSnapshot || row.poId}</div>
                          <div className="text-[10px] text-muted-foreground max-w-[18rem] truncate" title={row.id}>
                            {row.projectNameSnapshot || '—'}
                          </div>
                          <div className="text-[10px] text-muted-foreground/80 font-mono mt-0.5" title={row.id}>
                            {formatPoLocationMonthShellListLabel(
                              row.poCodeSnapshot || row.poId,
                              row.yearMonth,
                              row.locationLabel || row.locationKey,
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm align-top">
                          {customerNameById.get(row.customerId) || <span className="font-mono text-xs">{row.customerId}</span>}
                        </TableCell>
                        <TableCell className="text-sm align-top max-w-[14rem]">
                          {row.locationLabel || row.locationKey}
                        </TableCell>
                        <TableCell className="align-top">{shellStatusBadge(row.status)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground mt-3">
              เอกสาร PO+งวด (ล็อก/แนบ) ยังทำที่การ์ดด้านล่าง — รายการนี้คือ &quot;หัวงวด&quot; รายสถานที่เพื่อต่อกับกระดานลงเวลา/ใบ
              invoice ในรอบถัดไป
            </p>
          </CardContent>
        </Card>

        <div className="flex flex-col sm:flex-row gap-3 items-end flex-wrap">
          <div className="space-y-1">
            <Label>งวด (yyyy-MM)</Label>
            <Input
              className="font-mono w-40"
              value={monthYm}
              onChange={(e) => setMonthYm((e.target.value || '').trim().slice(0, 7))}
            />
            <p className="text-xs text-muted-foreground">{formatThaiYearMonthLabel(monthYm, 'th-TH')}</p>
          </div>
          <Button type="button" variant="outline" asChild>
            <Link href={`/timesheets/wave-month?month=${encodeURIComponent(monthYm)}`}>สรุปลงเวลา (ตาราง)</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/hr/timesheet-month-approval">คิวอนุมัติ (Manager)</Link>
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">PO ที่เปิด wave ในงวดนี้ + เอกสาร</CardTitle>
            <CardDescription>เฉพาะ PO ที่มี wave กินเวลาในเดือนที่เลือก</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <p className="p-6 text-center text-muted-foreground flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลด…
              </p>
            ) : posRows.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground text-center">ยังไม่มี PO+wave ในปฏิทินนี้</p>
            ) : (
              <div className="space-y-6 p-4">
                {posRows.map((po) => {
                  const r = reviewByPoId.get(po.id);
                  const isHi = highlightPo && highlightPo === po.id;
                  const bundle = bundleByPoId.get(po.id);
                  const photoReadOnly = isAttachmentReadonly(r);
                  const displayAtts = photoReadOnly
                    ? r?.timesheetPhotoAttachments ?? []
                    : bundle?.attachments ?? [];
                  const lockDisabled =
                    !canEditTs ||
                    submittingPoId === po.id ||
                    (r && (r.status === 'entry_locked' || r.status === 'pending_manager_review' || r.status === 'approved'));
                  const canSendToManager =
                    canEditTs && !!r && (r.status === 'entry_locked' || r.status === 'rejected');

                  return (
                    <div
                      key={po.id}
                      className={`rounded-lg border bg-card p-4 space-y-3 ${isHi ? 'ring-2 ring-primary/30' : ''}`}
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="font-mono font-bold text-sm">{po.poCode}</div>
                          <div className="text-sm text-muted-foreground">{po.projectName}</div>
                        </div>
                        {r ? statusBadge(r.status) : <span className="text-xs text-muted-foreground">ยังไม่บันทึกงวด</span>}
                      </div>
                      <div className="flex flex-wrap items-end gap-3">
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">วันสุดท้ายของงวดปิด</Label>
                          <Input
                            type="date"
                            className="h-9 w-[180px] font-mono"
                            min={`${monthYm}-01`}
                            max={lastDayOfCalendarMonth(monthYm)}
                            value={periodEndByPo[po.id] ?? lastDayOfCalendarMonth(monthYm)}
                            onChange={(e) => setPeriodEndByPo((prev) => ({ ...prev, [po.id]: e.target.value }))}
                            disabled={
                              photoReadOnly || !canEditTs || (r && (r.status === 'pending_manager_review' || r.status === 'approved'))
                            }
                          />
                        </div>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="gap-1"
                          disabled={lockDisabled}
                          onClick={() => void writePoMonthReview(po, 'entry_locked')}
                        >
                          {submittingPoId === po.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
                          ล็อกงวด
                        </Button>
                        {canSendToManager ? (
                          <Button
                            type="button"
                            size="sm"
                            className="gap-1"
                            disabled={submittingPoId === po.id}
                            onClick={() => setSubmitDialogPo(po)}
                          >
                            <Send className="h-3.5 w-3.5" />
                            ส่งตรวจสอบ
                          </Button>
                        ) : null}
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        Wave ที่นับในงวด: {(relatedWaveIdsFor(po.id) || []).length} รายการ
                      </p>
                      <div className="border-t border-dashed pt-3 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,application/pdf"
                            className="hidden"
                            id={`pom-file-${po.id}`}
                            disabled={photoReadOnly || !canEditTs || uploadingPhotoPoId === po.id}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              e.target.value = '';
                              if (f) void appendPhoto(po, f);
                            }}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={photoReadOnly || !canEditTs || uploadingPhotoPoId === po.id}
                            onClick={() => document.getElementById(`pom-file-${po.id}`)?.click()}
                          >
                            {uploadingPhotoPoId === po.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                            แนบรูป / PDF
                          </Button>
                          <span className="text-xs text-muted-foreground">
                            สูงสุด {MAX_PO_MONTH_ATTACHMENTS} ไฟล์ · รูป: บีบให้ ~500 KB — PDF: 10 MB
                          </span>
                        </div>
                        {displayAtts.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {displayAtts.map((att) => (
                              <div key={att.id} className="relative">
                                {isWaveMonthAttachmentPdf(att) ? (
                                  <a
                                    href={att.downloadUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex h-16 w-16 flex-col items-center justify-center rounded border bg-muted/50 text-[9px] hover:bg-muted"
                                  >
                                    <FileIcon className="h-6 w-6 text-primary" />
                                    <span>PDF</span>
                                  </a>
                                ) : (
                                  <a href={att.downloadUrl} target="_blank" rel="noopener noreferrer" className="block">
                                    <img src={att.downloadUrl} alt={att.fileName} className="h-16 w-16 rounded border object-cover" />
                                  </a>
                                )}
                                {!photoReadOnly && canEditTs ? (
                                  <button
                                    type="button"
                                    className="absolute -right-1 -top-1 rounded-full bg-destructive p-0.5 text-destructive-foreground shadow"
                                    onClick={() => void removePhoto(po, att.id, att.storagePath)}
                                    aria-label="ลบ"
                                    disabled={uploadingPhotoPoId === po.id}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">ยังไม่มีไฟล์แนบ</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={!!submitDialogPo}
        onOpenChange={(o) => {
          if (!o) setSubmitDialogPo(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>ยืนยันส่งตรวจผู้จัดการ (PO+งวด)</DialogTitle>
            <DialogDescription>งวด {monthYm} — หลังอนุมัติ ระบบจะเตรียม invoice + payroll จาก timesheet รอบนี้</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-3">
              <Checkbox id="pom-s1" checked={submitQ1} onCheckedChange={(v) => setSubmitQ1(v === true)} />
              <label htmlFor="pom-s1" className="text-sm leading-snug cursor-pointer">
                1. ตรวจสอบยอด timesheet กับระบบตรงตามรอบชำระแล้ว
              </label>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox id="pom-s2" checked={submitQ2} onCheckedChange={(v) => setSubmitQ2(v === true)} />
              <label htmlFor="pom-s2" className="text-sm leading-snug cursor-pointer">
                2. แนบรูป/PDF ครบตามนโยบาย (สูงสุด 4 ไฟล์)
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSubmitDialogPo(null)}>
              ยกเลิก
            </Button>
            <Button
              type="button"
              disabled={!submitQ1 || !submitQ2 || !submitDialogPo || submittingPoId === submitDialogPo.id}
              onClick={() => {
                if (!submitDialogPo) return;
                const po = submitDialogPo;
                void writePoMonthReview(po, 'pending_manager_review').then(() => setSubmitDialogPo(null));
              }}
            >
              {submitDialogPo && submittingPoId === submitDialogPo.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null} ยืนยันส่ง
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
