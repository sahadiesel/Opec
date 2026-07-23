'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { collection, doc, getDoc, getDocs, orderBy, query, where } from 'firebase/firestore';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { isPartialPoMonthCommercialInvoice } from '@/lib/commercial/partial-po-month-billing';
import { PortalMonthCustomerActions } from '@/components/client-portal/portal-month-customer-actions';
import { PortalPoMonthDocHeaderCard } from '@/components/client-portal/portal-po-month-readonly-fragments';
import { PortalPoMonthUnifiedReadonlyCard } from '@/components/client-portal/portal-wave-month-readonly-card';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase';
import { useClientPortalIdentity } from '@/contexts/client-portal-user-context';
import { CustomerQueryService } from '@/lib/services/customer-query-service';
import { isInternalUser } from '@/lib/permissions';
import { usePortalLocale } from '@/contexts/portal-locale-context';
import { useToast } from '@/hooks/use-toast';
import { runPortalParityBackfillForPoMonth } from '@/lib/timesheet/portal-parity-backfill';
import {
  dailyTimesheetsQueryForPortalCustomerMonth,
  dailyTimesheetsQueryForPortalPoMonth,
  filterDailyTimesheetsForPortalPoMonthGrid,
  getLastNCalendarMonths,
  mergePortalDailyTimesheetsForPoMonth,
  poMonthTimesheetReviewDocId,
} from '@/lib/client-portal/timesheet-portal-utils';
import type {
  Assignment,
  CommercialInvoice,
  DailyTimesheet,
  PoMonthTimesheetPhotoBundle,
  PoMonthTimesheetReview,
  PurchaseOrder,
} from '@/lib/types';
import { lastDayOfCalendarMonth } from '@/lib/timesheet/wave-month-utils';
import { normalizePoActiveBundleId, resolvePoActiveBundleKeyForPo } from '@/lib/ops/po-active-bundle';

const FIRESTORE_WAVE_IN_MAX = 30;

function chunkWaveIds<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function ClientPortalPoMonthContent() {
  const searchParams = useSearchParams();
  const poId = searchParams.get('poId')?.trim() ?? '';
  const monthYm =
    (() => {
      const m = searchParams.get('month')?.trim() ?? '';
      return /^\d{4}-\d{2}$/.test(m) ? m : '';
    })();

  const {
    effectiveUser: currentUser,
    rawUser,
    appUserLoading: userLoading,
    canAccessPortal,
  } = useClientPortalIdentity();
  /** ใช้ใน deps ของ useEffect ให้เป็น string คงที่ — หลีกเลี่ยง React ฟ้องว่า dependency array เปลี่ยนขนาดระหว่าง render/HMR */
  const portalCustomerId = (currentUser?.customerId ?? '').trim();
  const firestore = useFirestore();
  const { t, locale } = usePortalLocale();
  const { toast } = useToast();
  const [portalParityBusy, setPortalParityBusy] = useState(false);
  /** Mobilizations ใต้ PO เดียว — เทียบเท่า wave-month ภายในที่ query ตาม poId (ลูกค้าอ่านได้ทุกใบที่ customerId ตรง) */
  const [poScopedMobs, setPoScopedMobs] = useState<Assignment[]>([]);
  const [poMobByPoLoading, setPoMobByPoLoading] = useState(false);
  /** แถวรายวันตาม waveId ในเดือน — ดึงแถวที่ไม่มี customerId/purchaseOrderId แต่อ่านได้ผ่าน wave (กติกา Firestore) */
  const [waveMonthSheets, setWaveMonthSheets] = useState<DailyTimesheet[]>([]);
  const [waveSheetsLoading, setWaveSheetsLoading] = useState(false);
  /** Mobilizations ใน PO Active bundle เดียวกัน — wave-month ภายในโหลดทุก PO ที่เปิด; พอร์ทัลดู PO เดียวแต่คนผูก poId อื่นใน bundle ต้องอยู่ในลิงก์ timesheet */
  const [bundleScopedMobs, setBundleScopedMobs] = useState<Assignment[]>([]);
  const [bundleMobsLoading, setBundleMobsLoading] = useState(false);

  const queryService = useMemo(
    () => (firestore ? new CustomerQueryService(firestore) : null),
    [firestore],
  );
  const poQuery = useMemoFirebase(() => queryService?.getScopedPOsQuery(currentUser), [queryService, currentUser]);
  const { data: pos, isLoading: poLoading } = useCollection<PurchaseOrder>(poQuery as any);
  const assignmentsQuery = useMemoFirebase(
    () => queryService?.getScopedAssignmentsQuery(currentUser),
    [queryService, currentUser],
  );
  const { data: portalAssignments, isLoading: assignmentsLoading } = useCollection<Assignment>(
    assignmentsQuery as any,
  );

  const poMonthTsCustomerQuery = useMemoFirebase(() => {
    if (!firestore || !poId || !monthYm || !portalCustomerId) return null;
    return dailyTimesheetsQueryForPortalCustomerMonth(firestore, portalCustomerId, monthYm);
  }, [firestore, poId, monthYm, portalCustomerId]);
  const { data: poMonthDailySheetsCustomer, isLoading: poMonthTsCustomerLoading } = useCollection<DailyTimesheet>(
    poMonthTsCustomerQuery as any,
  );

  const poMonthTsPoQuery = useMemoFirebase(() => {
    if (!firestore || !poId || !monthYm) return null;
    return dailyTimesheetsQueryForPortalPoMonth(firestore, poId, monthYm);
  }, [firestore, poId, monthYm]);
  const { data: poMonthDailySheetsPo, isLoading: poMonthTsPoLoading } = useCollection<DailyTimesheet>(
    poMonthTsPoQuery as any,
  );

  const poMonthDailySheetsRaw = useMemo(
    () =>
      mergePortalDailyTimesheetsForPoMonth(
        mergePortalDailyTimesheetsForPoMonth(poMonthDailySheetsCustomer ?? [], poMonthDailySheetsPo ?? []),
        waveMonthSheets,
      ),
    [poMonthDailySheetsCustomer, poMonthDailySheetsPo, waveMonthSheets],
  );

  const poMonthTsLoading = poMonthTsCustomerLoading || poMonthTsPoLoading;

  useEffect(() => {
    if (!firestore || !poId?.trim() || !monthYm || !portalCustomerId) {
      setPoScopedMobs([]);
      setPoMobByPoLoading(false);
      return;
    }
    let cancelled = false;
    setPoMobByPoLoading(true);
    void (async () => {
      try {
        const snap = await getDocs(query(collection(firestore, 'mobilizations'), where('poId', '==', poId.trim())));
        if (cancelled) return;
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) } as Assignment));
        setPoScopedMobs(list);
      } catch {
        if (!cancelled) setPoScopedMobs([]);
      } finally {
        if (!cancelled) setPoMobByPoLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, poId, monthYm, portalCustomerId]);

  const po = useMemo(() => (pos ?? []).find((p) => p.id === poId) ?? null, [pos, poId]);

  const portalPoBundleKeyNorm = useMemo(() => {
    if (!po) return '';
    const k = resolvePoActiveBundleKeyForPo(po).trim();
    if (!k || k.startsWith('orphan:')) return '';
    return normalizePoActiveBundleId(k);
  }, [po]);

  const poActiveBundleIdField = (po?.poActiveBundleId ?? '').trim();

  useEffect(() => {
    if (!firestore || !monthYm || !portalCustomerId || !poId.trim()) {
      setBundleScopedMobs([]);
      setBundleMobsLoading(false);
      return;
    }
    const rawOnPo = normalizePoActiveBundleId(poActiveBundleIdField);
    const fetchKeys = [...new Set([portalPoBundleKeyNorm, rawOnPo].filter((k) => !!k && !k.startsWith('orphan:')))];
    if (fetchKeys.length === 0) {
      setBundleScopedMobs([]);
      setBundleMobsLoading(false);
      return;
    }
    let cancelled = false;
    setBundleMobsLoading(true);
    void (async () => {
      try {
        const byId = new Map<string, Assignment>();
        for (const key of fetchKeys) {
          const snap = await getDocs(
            query(collection(firestore, 'mobilizations'), where('poActiveBundleId', '==', key)),
          );
          for (const d of snap.docs) {
            byId.set(d.id, { id: d.id, ...(d.data() as object) } as Assignment);
          }
        }
        if (!cancelled) setBundleScopedMobs([...byId.values()]);
      } catch {
        if (!cancelled) setBundleScopedMobs([]);
      } finally {
        if (!cancelled) setBundleMobsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, poId, monthYm, portalCustomerId, portalPoBundleKeyNorm, poActiveBundleIdField]);

  const commercialQ = useMemoFirebase(() => {
    if (!firestore || !portalCustomerId) return null;
    return query(
      collection(firestore, 'commercial_invoices'),
      where('customerId', '==', portalCustomerId),
      where('status', 'in', ['DRAFT', 'PENDING_CUSTOMER', 'ISSUED', 'VOID']),
      orderBy('issueDate', 'desc'),
    );
  }, [firestore, portalCustomerId]);
  const { data: commercialInvoices, isLoading: commercialLoading } = useCollection<CommercialInvoice>(commercialQ as any);

  const [review, setReview] = useState<PoMonthTimesheetReview | null>(null);
  const [bundle, setBundle] = useState<PoMonthTimesheetPhotoBundle | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);

  useEffect(() => {
    if (!firestore || !poId || !monthYm) {
      setReview(null);
      setBundle(null);
      setMetaLoading(false);
      return;
    }
    const id = poMonthTimesheetReviewDocId(poId, monthYm);
    let cancelled = false;
    setMetaLoading(true);
    void (async () => {
      try {
        const [rSettled, bSettled] = await Promise.allSettled([
          getDoc(doc(firestore, 'po_month_timesheet_reviews', id)),
          getDoc(doc(firestore, 'po_month_timesheet_photo_bundles', id)),
        ]);
        if (cancelled) return;
        const rSnap = rSettled.status === 'fulfilled' ? rSettled.value : null;
        const bSnap = bSettled.status === 'fulfilled' ? bSettled.value : null;
        if (rSnap?.exists()) {
          const r = { id: rSnap.id, ...(rSnap.data() as object) } as PoMonthTimesheetReview;
          const currentYm = getLastNCalendarMonths(1)[0];
          /** ปล่อยให้ดูได้เมื่อ manager อนุมัติแล้ว หรือเป็นเดือนปัจจุบัน */
          if (r.status === 'approved' || (monthYm === currentYm && r.status !== 'rejected')) {
            setReview(r);
          } else {
            setReview(null);
          }
        } else {
          setReview(null);
        }
        if (bSnap?.exists()) {
          setBundle({ id: bSnap.id, ...(bSnap.data() as object) } as PoMonthTimesheetPhotoBundle);
        } else {
          setBundle(null);
        }
      } catch {
        if (!cancelled) {
          setReview(null);
          setBundle(null);
        }
      } finally {
        if (!cancelled) setMetaLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, poId, monthYm]);

  const reviewDocId = useMemo(
    () => (poId && monthYm ? poMonthTimesheetReviewDocId(poId, monthYm) : ''),
    [poId, monthYm],
  );

  const commercialForRows = useMemo(
    () =>
      (commercialInvoices ?? [])
        .filter((c) => c.status !== 'VOID' && c.sourcePoMonthReviewId === reviewDocId)
        .sort((a, b) => (a.invoiceNo || a.id).localeCompare(b.invoiceNo || b.id, 'th')),
    [commercialInvoices, reviewDocId],
  );

  /** string key — อย่าใช้ Set เป็น deps ของ useEffect (reference ใหม่ทุกครั้งทำให้ยิงเอฟเฟกต์ซ้ำ) */
  const waveIdsFromExplicitPoSheetsKey = useMemo(() => {
    const pid = poId.trim();
    const prefix = `${monthYm}-`;
    const out = new Set<string>();
    for (const ts of poMonthDailySheetsRaw) {
      if (!ts.date?.startsWith(prefix)) continue;
      if ((ts.purchaseOrderId || '').trim() !== pid) continue;
      const w = (ts.waveId || '').trim();
      if (w) out.add(w);
    }
    return [...out].sort().join(',');
  }, [poMonthDailySheetsRaw, poId, monthYm]);

  const assignmentsForPo = useMemo(() => {
    const pid = poId.trim();
    const custPo = (po?.customerId || '').trim();
    const byId = new Map<string, Assignment>();
    const pushIfMatchesScope = (a: Assignment) => {
      const custA = (a.customerId || '').trim();
      if (custPo && custA && custA !== custPo) return;
      const samePo = a.poId === pid;
      const ab = normalizePoActiveBundleId(a.poActiveBundleId || '');
      const sameBundle =
        !!portalPoBundleKeyNorm && !!ab && ab === portalPoBundleKeyNorm;
      if (!samePo && !sameBundle) return;
      byId.set(a.id, a);
    };
    for (const a of portalAssignments ?? []) pushIfMatchesScope(a);
    for (const a of poScopedMobs) pushIfMatchesScope(a);
    for (const a of bundleScopedMobs) pushIfMatchesScope(a);
    return [...byId.values()];
  }, [portalAssignments, poScopedMobs, bundleScopedMobs, poId, po?.customerId, portalPoBundleKeyNorm]);

  useEffect(() => {
    if (!firestore || !monthYm || !poId.trim()) {
      setWaveMonthSheets([]);
      setWaveSheetsLoading(false);
      return;
    }
    const fromExplicitSheets = waveIdsFromExplicitPoSheetsKey
      ? waveIdsFromExplicitPoSheetsKey.split(',').filter(Boolean)
      : [];
    const waveIds = [
      ...new Set([
        ...assignmentsForPo.map((a) => (a.waveId || '').trim()).filter(Boolean),
        ...fromExplicitSheets,
      ]),
    ];
    if (waveIds.length === 0) {
      setWaveMonthSheets([]);
      setWaveSheetsLoading(false);
      return;
    }
    let cancelled = false;
    setWaveSheetsLoading(true);
    const monthStart = `${monthYm}-01`;
    const monthEnd = lastDayOfCalendarMonth(monthYm);
    void (async () => {
      try {
        const map = new Map<string, DailyTimesheet>();
        for (const part of chunkWaveIds(waveIds, FIRESTORE_WAVE_IN_MAX)) {
          const snap = await getDocs(
            query(
              collection(firestore, 'daily_timesheets'),
              where('waveId', 'in', part),
              where('date', '>=', monthStart),
              where('date', '<=', monthEnd),
            ),
          );
          for (const d of snap.docs) {
            map.set(d.id, { id: d.id, ...(d.data() as object) } as DailyTimesheet);
          }
        }
        if (!cancelled) setWaveMonthSheets([...map.values()]);
      } catch {
        if (!cancelled) setWaveMonthSheets([]);
      } finally {
        if (!cancelled) setWaveSheetsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, monthYm, poId, assignmentsForPo, waveIdsFromExplicitPoSheetsKey]);

  const showInternalParityTool = isInternalUser(rawUser);

  const runPortalParitySync = () => {
    if (!firestore || !poId || !monthYm || portalParityBusy) return;
    if (!window.confirm(t('tsPoMonthParitySyncConfirm'))) return;
    setPortalParityBusy(true);
    void (async () => {
      try {
        const r = await runPortalParityBackfillForPoMonth(firestore, poId, monthYm);
        toast({
          title: t('tsPoMonthParitySyncOkTitle'),
          description: t('tsPoMonthParitySyncDone')
            .replace('{mobs}', String(r.mobilizationsUpdated))
            .replace('{sheets}', String(r.dailySheetsUpdated))
            .replace('{mobScan}', String(r.mobilizationsScanned))
            .replace('{sheetScan}', String(r.dailySheetsScanned)),
        });
      } catch (e: unknown) {
        toast({
          variant: 'destructive',
          title: t('tsPoMonthParitySyncFail'),
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setPortalParityBusy(false);
      }
    })();
  };

  const poMonthDailySheetsForGrid = useMemo(
    () =>
      filterDailyTimesheetsForPortalPoMonthGrid(
        poMonthDailySheetsRaw ?? [],
        poId,
        monthYm,
        assignmentsForPo,
      ),
    [poMonthDailySheetsRaw, poId, monthYm, assignmentsForPo],
  );

  const accessOk = useMemo(() => {
    if (!currentUser || !po || !canAccessPortal) return false;
    if (!currentUser.customerId) return false;
    return po.customerId === currentUser.customerId;
  }, [currentUser, po, canAccessPortal]);

  const loading =
    userLoading ||
    poLoading ||
    assignmentsLoading ||
    commercialLoading ||
    metaLoading ||
    poMonthTsLoading ||
    poMobByPoLoading ||
    bundleMobsLoading ||
    waveSheetsLoading;

  if (userLoading || !currentUser) {
    return (
      <p className="text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('tsHubLoading')}
      </p>
    );
  }

  if (!canAccessPortal) {
    return <p className="text-sm text-muted-foreground">{t('portalOnly')}</p>;
  }

  if (!poId || !monthYm) {
    return <p className="text-sm text-muted-foreground">{t('tsPoMonthNotApproved')}</p>;
  }

  if (!poLoading && !po) {
    return <p className="text-sm text-muted-foreground">{t('tsPoMonthNotApproved')}</p>;
  }

  if (po && !accessOk) {
    return <p className="text-sm text-destructive">{t('accessRestricted')}</p>;
  }

  return (
    <div className="mx-auto max-w-[100vw] space-y-4 pb-8 lg:max-w-[1800px]">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" className="gap-1 px-0" asChild>
          <Link href="/client-portal/timesheets">
            <ChevronLeft className="h-4 w-4" />
            {t('tsBackToHub')}
          </Link>
        </Button>
      </div>

      {loading || !po || !review ? (
        <div>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              {t('tsMonthlyLoading')}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
              {t('tsPoMonthNotApproved')}
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-1">
            <h1 className="text-lg font-bold tracking-tight sm:text-xl">{t('tsPoMonthPageTitle')}</h1>
            <p className="text-sm text-muted-foreground max-w-2xl">{t('tsPoMonthPageLead')}</p>
          </div>
          <PortalPoMonthDocHeaderCard
            po={po}
            yearMonth={monthYm}
            monthReview={review}
            bundle={bundle}
            locale={locale}
            t={t}
          />
          <PortalMonthCustomerActions
            kind="po"
            review={review}
            onUpdated={(next) => setReview(next)}
          />
          {commercialForRows.length > 0 ? (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {commercialForRows.map((inv) => (
                <span key={inv.id} className="inline-flex items-center gap-1.5">
                  <Link
                    href={`/client-portal/commercial-invoices/${encodeURIComponent(inv.id)}`}
                    className="text-primary font-mono underline-offset-4 hover:underline"
                  >
                    {t('tsHubColBillingRef')}: {inv.invoiceNo}
                  </Link>
                  {isPartialPoMonthCommercialInvoice(inv) ? (
                    <Badge variant="secondary" className="text-[10px]">
                      Partial
                    </Badge>
                  ) : null}
                </span>
              ))}
            </div>
          ) : null}
          <div className="space-y-4 pt-2">
            <PortalPoMonthUnifiedReadonlyCard
              po={po}
              monthYm={monthYm}
              poMonthDailySheets={poMonthDailySheetsForGrid}
              assignmentsForPo={assignmentsForPo}
              headerActions={
                showInternalParityTool ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5 border-amber-600/40 text-amber-950 dark:text-amber-100"
                    disabled={portalParityBusy || !firestore}
                    onClick={runPortalParitySync}
                  >
                    {portalParityBusy ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                        <span>{t('tsPoMonthParitySyncRunning')}</span>
                      </>
                    ) : (
                      t('tsPoMonthParitySyncBtn')
                    )}
                  </Button>
                ) : null
              }
              t={t}
            />
          </div>
        </>
      )}
    </div>
  );
}

export default function ClientPortalPoMonthPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground text-sm">กำลังโหลด…</div>
      }
    >
      <ClientPortalPoMonthContent />
    </Suspense>
  );
}
