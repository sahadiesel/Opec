'use client';

import { useState, useEffect, useMemo, useCallback, Suspense } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Waves } from 'lucide-react';
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

function chunkIds<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function hasDailyTimesheetsForDate(db: Firestore, date: string, waveIds: string[]): Promise<boolean> {
  if (waveIds.length === 0) return false;
  for (const chunk of chunkIds(waveIds, 10)) {
    const q = query(
      collection(db, 'daily_timesheets'),
      where('date', '==', date),
      where('waveId', 'in', chunk),
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
    if (!filterPoId) return sortedWaves;
    return sortedWaves.filter((w) => w.poId === filterPoId);
  }, [sortedWaves, filterPoId]);

  const posOrderedForBoard = useMemo(() => {
    const m = new Map<string, { po: PurchaseOrder; waves: Wave[] }>();
    for (const w of sortedWavesForBoard) {
      const p = (pos ?? []).find((x) => x.id === w.poId);
      if (!p) continue;
      const cur = m.get(w.poId) ?? { po: p, waves: [] as Wave[] };
      cur.waves.push(w);
      m.set(w.poId, cur);
    }
    return [...m.values()].sort((a, b) => a.po.poCode.localeCompare(b.po.poCode, 'th'));
  }, [sortedWavesForBoard, pos]);

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
      if (!firestore || sortedWavesForBoard.length === 0) return;
      const ym = htmlDate.slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(ym)) return;
      const snap = await getDocs(
        query(collection(firestore, 'wave_month_timesheet_reviews'), where('yearMonth', '==', ym)),
      );
      const waveIdSet = new Set(sortedWavesForBoard.map((w) => w.id));
      for (const d of snap.docs) {
        const r = d.data() as WaveMonthTimesheetReview;
        if (!waveIdSet.has(r.waveId)) continue;
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
    [firestore, sortedWavesForBoard, toast],
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
        if (!firestore || sortedWavesForBoard.length === 0) {
          await applyBoardDate(ms);
          return;
        }
        const waveIds = sortedWavesForBoard.map((w) => w.id);
        const hasSaved = await hasDailyTimesheetsForDate(firestore, next, waveIds);
        if (hasSaved) {
          setPendingDateChangeMs(ms);
          setDateConfirmOpen(true);
          return;
        }
        await applyBoardDate(ms);
      })();
    },
    [applyBoardDate, firestore, sortedWavesForBoard, targetDate],
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
            <Waves className="mr-3 inline-block h-8 w-8 align-middle text-primary" aria-hidden />
            คีย์ลงเวลาแบบกลุ่ม (PO / งวด timesheet รายเดือน)
          </h1>
          <p className="text-muted-foreground text-lg max-w-4xl">
            แยก <strong>ต่อ PO หนึ่งการ์ด</strong> — แต่ละแถวแสดง <strong>Wave ที่ assignment นั้นอยู่</strong> (รอบลงงานต่างกันได้) — บันทึกร่าง DRAFT
            ที่นี่; รอบส่งตรวจ/ใบกำกับ: สรุปราย wave ได้ที่{' '}
            <Link href="/timesheets/wave-month" className="text-primary font-semibold underline">
              สรุปลงเวลารายเดือน (wave)
            </Link>
            {', '}
            หรือ**งวดเดียวรวมทุก wave ใต้ PO** สำหรับเชิงการเรียกเก็บที่{' '}
            <Link href="/timesheets/po-month" className="text-primary font-semibold underline">
              เอกสาร timesheet ราย PO+เดือน
            </Link>
            .
          </p>
        </section>

        <PageGuidance
          title="วิธีใช้"
          tips={[
            'PO = คำสั่งจ้าง/โควต้า; **Wave = กลุ่ม mobilize ตามรอบ** — คนลงสนามไม่พร้อมกันทั้ง PO; แถวลงเวลาสะท้อน wave ราย assignment',
            '**วางบิลรอบเดือนใต้ PO ที่มีหลาย wave ในเดือนนั้น** ให้ยึด **เอกสาร PO+เดือน** หลังอนุมัติ (รวม timesheet ทุก wave) ไม่ใช่ “เลือกอ้าง wave ใด wave หนึ่ง” แทนเดือน',
            'รายคน = 1 assignment — ย้าย wave แล้ว demob รายเก่า รายนั้นไม่นับซ้ำในราย active',
            'ตัวกรอง URL: ?month=2026-04&poId=… — กำหนดวันที่ 1 ของงวดและ/หรือ PO',
            'แถวที่ lock ตาม wave_month_timesheet_reviews ของ wave นั้น — แก้เวลาไม่ได้',
          ]}
        />

        <p className="text-sm text-muted-foreground">
          {posOrderedForBoard.length} การ์ด (PO) · รวม {sortedWavesForBoard.length} wave
        </p>

        {loading ? (
          <p className="text-center text-muted-foreground py-12">กำลังโหลด…</p>
        ) : posOrderedForBoard.length === 0 ? (
          <p className="text-center text-muted-foreground py-12 border border-dashed rounded-lg">
            ไม่มี Wave/PO สำหรับแสดง — ตรวจสถานะ PO / Wave
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
