'use client';

import { useState, useEffect, useMemo, useCallback, Suspense } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { CalendarDays } from 'lucide-react';
import { timestampToHtmlDateValue } from '@/lib/date-thai';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { useSearchParams } from 'next/navigation';
import { collection, query, where, getDocs, type Firestore } from 'firebase/firestore';
import { PurchaseOrder, Wave, Worker, User, Position, WaveMonthTimesheetReview } from '@/lib/types';
import { PoDailyBoardCard } from '@/app/timesheets/wave-board/po-daily-board';
import { useToast } from '@/hooks/use-toast';
import { PageGuidance } from '@/components/layout/page-guidance';
import Link from 'next/link';
import { OPEN_WAVE_STATUSES_FOR_TIMESHEET } from '@/lib/constants/timesheet-wave';
import { poTimesheetScopeId } from '@/lib/constants/timesheet-po-scope';
import { normalizePoActiveBundleId, resolvePoActiveBundleKeyForPo } from '@/lib/ops/po-active-bundle';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccess, canEdit, canView, isMatrixControlledRole } from '@/lib/permissions';
import { positionListPrimaryName, type PositionDoc } from '@/lib/position-display';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

async function hasDailyTimesheetsForPoDate(db: Firestore, date: string, poIds: string[]): Promise<boolean> {
  for (const poId of poIds) {
    const q = query(
      collection(db, 'daily_timesheets'),
      where('purchaseOrderId', '==', poId),
      where('date', '==', date),
    );
    const snap = await getDocs(q);
    if (!snap.empty) return true;
  }
  return false;
}

function WaveTimesheetBoardContent() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const useMatrixGuards = isMatrixControlledRole(currentUser);
  const canViewTimesheets = useMemo(
    () => (useMatrixGuards ? canAccess(currentUser, 'timesheets', 'view') : canView(currentUser, 'timesheets')),
    [currentUser, useMatrixGuards],
  );
  const canEditTimesheets = useMemo(
    () => (useMatrixGuards ? canAccess(currentUser, 'timesheets', 'edit') : canEdit(currentUser, 'timesheets')),
    [currentUser, useMatrixGuards],
  );

  const [targetDate, setTargetDate] = useState(() => timestampToHtmlDateValue(Date.now()));
  const [dateConfirmOpen, setDateConfirmOpen] = useState(false);
  const [pendingDateChangeMs, setPendingDateChangeMs] = useState<number | null>(null);

  const filterPoId = (searchParams.get('poId') || '').trim() || null;
  const filterPoActiveBundleIdRaw = (searchParams.get('poActiveBundleId') || '').trim() || null;
  const filterPoActiveBundleId = filterPoActiveBundleIdRaw ? normalizePoActiveBundleId(filterPoActiveBundleIdRaw) : null;
  const monthFromQuery = (searchParams.get('month') || '').trim() || null;

  useEffect(() => {
    if (monthFromQuery && /^\d{4}-\d{2}$/.test(monthFromQuery)) {
      setTargetDate(`${monthFromQuery}-01`);
    }
  }, [monthFromQuery]);

  const firestore = useFirestore();

  const poQuery = useMemoFirebase(
    () =>
      firestore && canViewTimesheets
        ? query(collection(firestore, 'purchase_orders'), where('status', 'in', ['pending', 'active']))
        : null,
    [firestore, canViewTimesheets],
  );
  const { data: pos, isLoading: posLoading } = useCollection<PurchaseOrder>(poQuery as any);

  const waveQuery = useMemoFirebase(() => {
    if (!firestore || !canViewTimesheets) return null;
    return query(collection(firestore, 'waves'), where('status', 'in', OPEN_WAVE_STATUSES_FOR_TIMESHEET));
  }, [firestore, canViewTimesheets]);
  const { data: allOpenWaves, isLoading: wavesLoading } = useCollection<Wave>(waveQuery as any);

  const openPoIdSet = useMemo(() => new Set((pos ?? []).map((p) => p.id)), [pos]);

  const poIdsInBundleFilter = useMemo(() => {
    if (!filterPoActiveBundleId || !(pos ?? []).length) return null;
    const ids = (pos ?? []).filter((p) => resolvePoActiveBundleKeyForPo(p) === filterPoActiveBundleId).map((p) => p.id);
    return ids.length ? new Set(ids) : null;
  }, [filterPoActiveBundleId, pos]);

  const sortedWaves = useMemo(() => {
    const list = (allOpenWaves ?? []).filter((w) => openPoIdSet.has(w.poId));
    const poById = new Map((pos ?? []).map((p) => [p.id, p]));
    return [...list].sort((a, b) => {
      const pa = poById.get(a.poId)?.poCode ?? '';
      const pb = poById.get(b.poId)?.poCode ?? '';
      if (pa !== pb) return pa.localeCompare(pb, 'th');
      return (a.waveCode || '').localeCompare(b.waveCode || '', 'th');
    });
  }, [allOpenWaves, openPoIdSet, pos]);

  const sortedWavesForBoard = useMemo(() => {
    if (filterPoId) return sortedWaves.filter((w) => w.poId === filterPoId);
    if (poIdsInBundleFilter) return sortedWaves.filter((w) => poIdsInBundleFilter.has(w.poId));
    return sortedWaves;
  }, [sortedWaves, filterPoId, poIdsInBundleFilter]);

  const boardPoIds = useMemo(() => {
    const ids = new Set<string>();
    for (const w of sortedWavesForBoard) ids.add(w.poId);
    const list = filterPoId
      ? (pos ?? []).filter((p) => p.id === filterPoId)
      : poIdsInBundleFilter
        ? (pos ?? []).filter((p) => poIdsInBundleFilter.has(p.id))
        : (pos ?? []);
    for (const p of list) ids.add(p.id);
    return [...ids];
  }, [sortedWavesForBoard, pos, filterPoId, poIdsInBundleFilter]);

  const posOrderedForBoard = useMemo(() => {
    const m = new Map<string, { po: PurchaseOrder; waves: Wave[] }>();
    for (const w of sortedWavesForBoard) {
      const p = (pos ?? []).find((x) => x.id === w.poId);
      if (!p) continue;
      const cur = m.get(w.poId) ?? { po: p, waves: [] as Wave[] };
      cur.waves.push(w);
      m.set(w.poId, cur);
    }
    const list = filterPoId
      ? (pos ?? []).filter((p) => p.id === filterPoId)
      : poIdsInBundleFilter
        ? (pos ?? []).filter((p) => poIdsInBundleFilter.has(p.id))
        : (pos ?? []);
    for (const p of list) {
      if (!m.has(p.id)) m.set(p.id, { po: p, waves: [] as Wave[] });
    }
    return [...m.values()].sort((a, b) => a.po.poCode.localeCompare(b.po.poCode, 'th'));
  }, [sortedWavesForBoard, pos, filterPoId, poIdsInBundleFilter]);

  const workersQuery = useMemoFirebase(
    () => (firestore && canViewTimesheets ? collection(firestore, 'workers') : null),
    [firestore, canViewTimesheets],
  );
  const { data: workers } = useCollection<Worker>(workersQuery as any);

  const positionsQuery = useMemoFirebase(
    () => (firestore && canViewTimesheets ? collection(firestore, 'positions') : null),
    [firestore, canViewTimesheets],
  );
  const { data: positions } = useCollection<Position>(positionsQuery as any);
  const positionLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of positions ?? []) {
      m.set(p.id, positionListPrimaryName(p as PositionDoc));
    }
    return (id?: string) => (id && m.get(id)) || id || '—';
  }, [positions]);

  const notifyMonthReviewIfLocked = useCallback(
    async (htmlDate: string) => {
      if (!firestore || boardPoIds.length === 0) return;
      const ym = htmlDate.slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(ym)) return;
      const snap = await getDocs(
        query(collection(firestore, 'wave_month_timesheet_reviews'), where('yearMonth', '==', ym)),
      );
      const waveIdSet = new Set(sortedWavesForBoard.map((w) => w.id));
      const scopeIdSet = new Set(boardPoIds.map((id) => poTimesheetScopeId(id)));
      for (const d of snap.docs) {
        const r = d.data() as WaveMonthTimesheetReview;
        if (!waveIdSet.has(r.waveId) && !scopeIdSet.has(r.waveId)) continue;
        if (r.status === 'pending_manager_review' || r.status === 'approved') {
          toast({
            variant: 'destructive',
            title: 'แก้ไขไม่ได้ในช่วงนี้',
            description: 'เดือนนี้ส่งตรวจ/อนุมัติแล้ว — ไม่สามารถแก้ไขได้',
          });
          return;
        }
      }
    },
    [firestore, sortedWavesForBoard, boardPoIds, toast],
  );

  const applyBoardDate = useCallback(
    async (ms: number) => {
      const next = timestampToHtmlDateValue(ms);
      setTargetDate(next);
      await notifyMonthReviewIfLocked(next);
    },
    [notifyMonthReviewIfLocked],
  );

  const handleBoardDateChange = useCallback(
    (ms: number) => {
      const next = timestampToHtmlDateValue(ms);
      if (next === targetDate) return;
      void (async () => {
        if (!firestore || boardPoIds.length === 0) {
          await applyBoardDate(ms);
          return;
        }
        const hasSaved = await hasDailyTimesheetsForPoDate(firestore, next, boardPoIds);
        if (hasSaved) {
          setPendingDateChangeMs(ms);
          setDateConfirmOpen(true);
          return;
        }
        await applyBoardDate(ms);
      })();
    },
    [applyBoardDate, firestore, boardPoIds, targetDate],
  );

  const loading = posLoading || wavesLoading;

  if (userLoading || !currentUser) return null;
  if (!canViewTimesheets) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-5xl mx-auto py-10 text-center text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงเมนูนี้</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="mx-auto w-full min-w-0 max-w-[1600px] space-y-6">
        <section className="w-full space-y-2">
          <PayrollScopeTag scope="worker" showHint={false} />
          <Button variant="link" className="h-auto p-0 text-sm text-muted-foreground" asChild>
            <Link href="/timesheets">← กลับไปศูนย์ลงเวลา (งวดรายเดือน)</Link>
          </Button>
          <h1 className="text-3xl font-bold tracking-tight text-primary">
            <CalendarDays className="mr-3 inline-block h-8 w-8 align-middle text-primary" aria-hidden />
            คีย์ลงเวลาแบบกลุ่ม (PO + assignment)
          </h1>
          <p className="text-muted-foreground text-lg max-w-4xl">
            {filterPoActiveBundleId ? (
              <>
                กรองตาม <strong>ชุด PO Active</strong> — หนึ่งการ์ดต่อ PO ภายในชุดเดียวกัน · แถวมาจาก mobilization ที่ครอบคลุมวันที่เลือก
              </>
            ) : (
              <>
                แยก <strong>ต่อ PO หนึ่งการ์ด</strong> — แถวมาจาก mobilization ที่ช่วงเริ่ม–สิ้นสุดครอบคลุมวันที่เลือก
              </>
            )}{' '}
            บันทึกร่าง DRAFT ที่นี่ ส่งตรวจ/อนุมัติและเรียกเก็บตาม{' '}
            <Link href="/timesheets/po-month" className="text-primary font-semibold underline">
              เอกสาร timesheet ราย PO+เดือน
            </Link>
            .
          </p>
        </section>

        <PageGuidance
          title="วิธีใช้"
          tips={[
            'PO = คำสั่งจ้าง; แถวลงเวลามาจาก mobilization ที่วันที่เลือกอยู่ในช่วง start–end ของ assignment',
            'วางบิล / payroll รอบเดือนให้ยึดเอกสาร PO+เดือนหลังอนุมัติ',
            'รายคน = 1 assignment — demob แล้วจะไม่ขึ้นในกระดานเมื่อวันที่อยู่นอกช่วง',
            'ตัวกรอง URL: ?month=2026-04&poId=… หรือ ?poActiveBundleId=customerId__OFFSHORE — กำหนดงวดและขอบเขต PO / ชุด PO Active',
            'แถวที่ lock ตามสถานะส่งตรวจ/อนุมัติของงวด PO (หรือ wave ในข้อมูลเก่า)',
          ]}
        />

        <p className="text-sm text-muted-foreground">
          {posOrderedForBoard.length} การ์ด (PO)
          {sortedWavesForBoard.length > 0 ? ` · มี wave เก่าในชุดนี้ ${sortedWavesForBoard.length} รายการ` : ''}
        </p>

        {loading ? (
          <p className="text-center text-muted-foreground py-12">กำลังโหลด…</p>
        ) : posOrderedForBoard.length === 0 ? (
          <p className="text-center text-muted-foreground py-12 border border-dashed rounded-lg">
            ไม่มี PO สำหรับแสดง — ตรวจสถานะ PO (pending/active)
          </p>
        ) : (
          <div className="space-y-8">
            {posOrderedForBoard.map(({ po, waves: poWaves }) => (
              <PoDailyBoardCard
                key={`${po.id}-${targetDate}`}
                po={po}
                waves={poWaves}
                targetDate={targetDate}
                onBoardDateChange={handleBoardDateChange}
                currentUser={currentUser}
                workers={workers ?? undefined}
                positionLabel={positionLabel}
                canEditTimesheets={canEditTimesheets}
              />
            ))}
          </div>
        )}
      </div>

      <AlertDialog
        open={dateConfirmOpen}
        onOpenChange={(open) => {
          setDateConfirmOpen(open);
          if (!open) setPendingDateChangeMs(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>มีการบันทึกเวลาวันนี้แล้ว</AlertDialogTitle>
            <AlertDialogDescription>
              พบข้อมูลลงเวลาในวันที่เลือกอยู่แล้ว — ต้องการแก้ไขวันหรือไม่?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              onClick={() => {
                if (pendingDateChangeMs == null) return;
                const ms = pendingDateChangeMs;
                setPendingDateChangeMs(null);
                void applyBoardDate(ms);
              }}
            >
              ต้องการแก้ไข
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

export default function WaveTimesheetBoardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground text-sm">กำลังโหลด…</div>
      }
    >
      <WaveTimesheetBoardContent />
    </Suspense>
  );
}
