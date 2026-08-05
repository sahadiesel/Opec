'use client';

import { useState, useEffect, useMemo, useCallback, Suspense } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { CalendarDays } from 'lucide-react';
import { timestampToHtmlDateValue } from '@/lib/date-thai';
import { thailandTodayYmd } from '@/lib/ops/mobilization-final-clearance';
import { useFirestore, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { useSearchParams } from 'next/navigation';
import { collection, query, where, getDocs, doc, type Firestore } from 'firebase/firestore';
import { PurchaseOrder, PoActiveBundle, Wave, Worker, User, Position, WaveMonthTimesheetReview } from '@/lib/types';
import { PoDailyBoardCard } from '@/app/timesheets/wave-board/po-daily-board';
import { useToast } from '@/hooks/use-toast';
import { PageGuidance } from '@/components/layout/page-guidance';
import Link from 'next/link';
import { OPEN_WAVE_STATUSES_FOR_TIMESHEET } from '@/lib/constants/timesheet-wave';
import { poTimesheetScopeId } from '@/lib/constants/timesheet-po-scope';
import { normalizePoActiveBundleId, resolvePoActiveBundleKeyForPo } from '@/lib/ops/po-active-bundle';
import { isContractBasedPurchaseOrder } from '@/lib/ops/po-active-eligibility';
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
    try {
      const q = query(
        collection(db, 'daily_timesheets'),
        where('purchaseOrderId', '==', poId),
        where('date', '==', date),
      );
      const snap = await getDocs(q);
      if (!snap.empty) return true;
    } catch (err) {
      console.warn('[wave-board] daily_timesheets probe failed for PO', poId, err);
    }
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

  /** ใช้วันที่ปฏิทินตามเขต Asia/Bangkok ให้ตรงกับซิงก์ลงเวลาอัตโนมัติ — ไม่พึ่ง timezone เครื่องผู้ใช้อย่างเดียว */
  const [targetDate, setTargetDate] = useState(() => thailandTodayYmd());
  const [dateConfirmOpen, setDateConfirmOpen] = useState(false);
  const [pendingDateChangeMs, setPendingDateChangeMs] = useState<number | null>(null);

  const filterPoId = (searchParams.get('poId') || '').trim() || null;
  const filterPoActiveBundleIdRaw = (searchParams.get('poActiveBundleId') || '').trim() || null;
  const filterPoActiveBundleId = filterPoActiveBundleIdRaw ? normalizePoActiveBundleId(filterPoActiveBundleIdRaw) : null;
  const monthFromQuery = (searchParams.get('month') || '').trim() || null;

  /** เมื่อเปิดจากศูนย์ลงเวลา (?month=) ให้รายชื่อตรงกับงวดเดือน — ไม่ใช่แค่วันแรกของเดือน */
  const rosterFilterYm = useMemo(() => {
    if (!monthFromQuery || !/^\d{4}-\d{2}$/.test(monthFromQuery)) return null;
    if (!targetDate.startsWith(monthFromQuery)) return null;
    return monthFromQuery;
  }, [monthFromQuery, targetDate]);

  useEffect(() => {
    if (!monthFromQuery || !/^\d{4}-\d{2}$/.test(monthFromQuery)) return;
    const today = thailandTodayYmd();
    /** เดือนที่เปิดตรงเดือนปัจจุบัน → โฟกัสวันนี้; เดือนอื่น → วันแรกของเดือนนั้น */
    setTargetDate(today.startsWith(monthFromQuery) ? today : `${monthFromQuery}-01`);
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

  const poActiveBundleDocRef = useMemoFirebase(
    () =>
      firestore && canViewTimesheets && filterPoActiveBundleId
        ? doc(firestore, 'po_active_bundles', filterPoActiveBundleId)
        : null,
    [firestore, canViewTimesheets, filterPoActiveBundleId],
  );
  const { data: poActiveBundleDoc, isLoading: poActiveBundleDocLoading } = useDoc<PoActiveBundle>(
    poActiveBundleDocRef as any,
  );

  const openPoIdSet = useMemo(() => new Set((pos ?? []).map((p) => p.id)), [pos]);

  /**
   * PO ในชุด PO Active — สอดคล้องหน้า `/po-active/[bundleId]` และคิวโควต้า:
   * ถ้า `po_active_bundles.poIds` มีข้อมูล ใช้รายการนั้น (เฉพาะ PO จากสัญญา)
   * ถ้าไม่มี (เอกสารไม่มี / ยังไม่ sync) fallback เป็น PO ที่ `resolvePoActiveBundleKeyForPo` ตรงกับ bundle
   */
  const bundlePosList = useMemo(() => {
    if (!filterPoActiveBundleId || !(pos ?? []).length) return [];
    const rawIds = poActiveBundleDoc?.poIds;
    if (rawIds?.length) {
      const posById = new Map((pos ?? []).map((p) => [p.id, p]));
      const seen = new Set<string>();
      const out: PurchaseOrder[] = [];
      for (const id of rawIds) {
        if (!id || seen.has(id)) continue;
        const p = posById.get(id);
        if (!p || !isContractBasedPurchaseOrder(p)) continue;
        seen.add(id);
        out.push(p);
      }
      return out;
    }
    return (pos ?? [])
      .filter(
        (p) =>
          resolvePoActiveBundleKeyForPo(p) === filterPoActiveBundleId && isContractBasedPurchaseOrder(p),
      )
      .sort((a, b) => a.poCode.localeCompare(b.poCode, 'th'));
  }, [filterPoActiveBundleId, pos, poActiveBundleDoc?.poIds]);

  const poIdsInBundleFilter = useMemo(() => {
    if (!filterPoActiveBundleId) return null;
    if (!bundlePosList.length) return new Set<string>();
    return new Set(bundlePosList.map((p) => p.id));
  }, [filterPoActiveBundleId, bundlePosList]);

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
      try {
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
      } catch (err) {
        console.warn('[wave-board] wave_month_timesheet_reviews read failed', err);
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
        try {
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
        } catch (err) {
          console.warn('[wave-board] date change failed', err);
          await applyBoardDate(ms);
        }
      })();
    },
    [applyBoardDate, firestore, boardPoIds, targetDate],
  );

  const loading = posLoading || wavesLoading || (!!filterPoActiveBundleId && poActiveBundleDocLoading);

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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1 space-y-2">
              <PayrollScopeTag scope="worker" showHint={false} />
              <Button variant="link" className="h-auto p-0 text-sm text-muted-foreground" asChild>
                <Link href="/timesheets">← กลับไปศูนย์ลงเวลา (งวดรายเดือน)</Link>
              </Button>
              <h1 className="text-3xl font-bold tracking-tight text-primary">
                <CalendarDays className="mr-3 inline-block h-8 w-8 align-middle text-primary" aria-hidden />
                ลงเวลารายวัน (Auto/Manual)
              </h1>
              <p className="text-muted-foreground text-lg max-w-4xl">
                {filterPoActiveBundleId ? (
                  <>
                    กรองตาม <strong>ชุด PO Active</strong> — <strong>ตารางเดียว</strong> รวมทุกใบในชุด (สอดคล้องหน้า Assignment) · แถวคือคนที่{' '}
                    <strong>mobilization ผ่านเกณฑ์แล้ว</strong>
                    {rosterFilterYm ? (
                      <>
                        {' '}
                        และช่วงมอบหมาย<strong>ทับเดือน {rosterFilterYm}</strong> (สอดคล้องคอลัมน์ MOB ผ่าน) — เลือกวันที่ใต้ตารางเพื่อลงเวลารายวัน
                      </>
                    ) : (
                      <>
                        {' '}
                        และช่วงมอบหมายครอบคลุม<strong>วันที่เลือก</strong>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    แยก <strong>ต่อ PO หนึ่งการ์ด</strong> — แถว mobilization ผ่านเกณฑ์
                    {rosterFilterYm ? (
                      <> และช่วงทับเดือน {rosterFilterYm}</>
                    ) : (
                      <> และครอบคลุมวันที่เลือก</>
                    )}
                  </>
                )}{' '}
                บันทึกร่าง DRAFT ที่นี่ ส่งตรวจ/อนุมัติและเรียกเก็บตาม{' '}
                <Link href="/timesheets/wave-month" className="text-primary font-semibold underline">
                  Monthly Timesheet
                </Link>
                .
              </p>
            </div>
            <div className="shrink-0 self-end sm:self-start">
              <PageGuidance
                compact
                title="วิธีใช้"
                tips={[
                'ชุด PO Active = ตารางเดียวรายชื่อรวม; คนที่ยังอยู่แค่ assign / ยังไม่ mob จะไม่ขึ้นในกระดานจนกว่าจะผ่าน Mobilization ตามเกณฑ์ readiness + deployment',
                'วางบิล / payroll รอบเดือนให้ยึดเอกสาร Monthly Timesheet หลังอนุมัติ',
                'รายคน = 1 assignment — demob แล้วจะไม่ขึ้นในกระดานเมื่อวันที่อยู่นอกช่วง',
                'พารามิเตอร์ ?month=YYYY-MM = แสดงทุกคนที่ทับเดือนนั้น (ตรงจำนวน MOB ผ่านใน Assignments); วันที่ใน date picker = วันที่ลงเวลา — แถวที่วันนั้นอยู่นอกช่วงมอบหมายจะล็อกไม่ให้บันทึก',
                'แถวที่ lock ตามสถานะส่งตรวจ/อนุมัติของงวด PO (หรือ wave ในข้อมูลเก่า)',
                'คนที่สถานะ ACTIVE (on-site): Cloud Function + Scheduler เติม/รักษาวันนี้ (~00:10 Asia/Bangkok) และ UI ซิงก์เมื่อมีผู้เปิดกระดาน (~45 วินาที) — ยกเว้นเมื่อปิดสวิตช์ «ลงเวลาอัตโนมัติ» บนกระดาน; ช่วงหยุดแบบ standby จะเป็น SB อัตโนมัติตามช่วงที่ตั้งไว้ · ปุ่ม Auto gen เติมช่วงที่ขาด (รวมตอนปิดสวิตช์) · ปุ่มหยุด = จบงานหรือพัก SB',
                'อัปเดตหน้าจอ (สวิตช์ Auto / ข้อความใต้ชื่อ): ต้อง deploy แอป — เช่น npm run deploy:app (Firebase App Hosting; opecbackend) — deploy เฉพาะ functions ไม่เปลี่ยน UI',
                ]}
              />
            </div>
          </div>
        </section>

        <p className="text-sm text-muted-foreground">
          {filterPoActiveBundleId
            ? `ตารางเดียวในชุด PO Active · ${bundlePosList.length} ใบ`
            : `${posOrderedForBoard.length} การ์ด (PO)`}
          {sortedWavesForBoard.length > 0 ? ` · wave ในขอบเขตนี้ ${sortedWavesForBoard.length} รายการ` : ''}
        </p>

        {loading ? (
          <p className="text-center text-muted-foreground py-12">กำลังโหลด…</p>
        ) : filterPoActiveBundleId ? (
          bundlePosList.length === 0 ? (
            <p className="text-center text-muted-foreground py-12 border border-dashed rounded-lg">
              ไม่พบ PO ในชุด PO Active นี้ — ตรวจว่า PO มีสถานะ active/pending, ผูกสัญญา (contract) และ `poActiveBundleId` ตรงกับชุดนี้
            </p>
          ) : (
            <div className="space-y-8">
              <PoDailyBoardCard
                key={`bundle-${filterPoActiveBundleId}-${targetDate}`}
                scope={{
                  mode: 'bundle',
                  bundleKey: filterPoActiveBundleId,
                  pos: bundlePosList,
                  waves: sortedWavesForBoard,
                }}
                rosterFilterYm={rosterFilterYm}
                targetDate={targetDate}
                onBoardDateChange={handleBoardDateChange}
                currentUser={currentUser}
                workers={workers ?? undefined}
                positionLabel={positionLabel}
                canEditTimesheets={canEditTimesheets}
              />
            </div>
          )
        ) : posOrderedForBoard.length === 0 ? (
          <p className="text-center text-muted-foreground py-12 border border-dashed rounded-lg">
            ไม่มี PO สำหรับแสดง — ตรวจสถานะ PO (pending/active)
          </p>
        ) : (
          <div className="space-y-8">
            {posOrderedForBoard.map(({ po, waves: poWaves }) => (
              <PoDailyBoardCard
                key={`${po.id}-${targetDate}`}
                scope={{ mode: 'single', po, waves: poWaves }}
                rosterFilterYm={rosterFilterYm}
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
