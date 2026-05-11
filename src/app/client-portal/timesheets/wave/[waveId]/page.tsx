'use client';

import { useEffect, useMemo, useState, Suspense } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { collection, doc, getDoc, orderBy, query, where } from 'firebase/firestore';
import {
  dailyTimesheetsQueryForPortalPoMonth,
  yearMonthFromCommercialInvoice,
} from '@/lib/client-portal/timesheet-portal-utils';
import { Button } from '@/components/ui/button';
import { PortalWaveMonthReadonlyCard } from '@/components/client-portal/portal-wave-month-readonly-card';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { useDoc } from '@/firebase/firestore/use-doc';
import { useClientPortalIdentity } from '@/contexts/client-portal-user-context';
import { CustomerQueryService } from '@/lib/services/customer-query-service';
import { usePortalLocale } from '@/contexts/portal-locale-context';
import type {
  Assignment,
  CommercialInvoice,
  DailyTimesheet,
  PurchaseOrder,
  Wave,
  WaveMonthTimesheetPhotoBundle,
  WaveMonthTimesheetReview,
} from '@/lib/types';

function ymNow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function ClientPortalWaveMonthDetailContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const waveId = typeof params?.waveId === 'string' ? params.waveId : '';
  const monthYmRaw = searchParams.get('month');
  const monthYm =
    monthYmRaw && /^\d{4}-\d{2}$/.test(monthYmRaw) ? monthYmRaw : ymNow();

  const {
    effectiveUser: currentUser,
    appUserLoading: userLoading,
    canAccessPortal,
  } = useClientPortalIdentity();
  const firestore = useFirestore();
  const { t } = usePortalLocale();

  const waveRef = useMemo(
    () => (firestore && waveId ? doc(firestore, 'waves', waveId) : null),
    [firestore, waveId],
  );
  const { data: wave, isLoading: waveLoading, error: waveErr } = useDoc<Wave>(waveRef as any);

  const queryService = useMemo(() => (firestore ? new CustomerQueryService(firestore) : null), [firestore]);

  const poQuery = useMemoFirebase(() => queryService?.getScopedPOsQuery(currentUser), [queryService, currentUser]);
  const { data: pos } = useCollection<PurchaseOrder>(poQuery as any);

  const asgnQuery = useMemoFirebase(() => queryService?.getScopedAssignmentsQuery(currentUser), [queryService, currentUser]);
  const { data: assignments } = useCollection<Assignment>(asgnQuery as any);

  const poMonthTsQuery = useMemoFirebase(() => {
    if (!firestore || !currentUser?.customerId || !wave || !monthYm) return null;
    if (wave.customerId !== currentUser.customerId) return null;
    return dailyTimesheetsQueryForPortalPoMonth(firestore, wave.poId, monthYm);
  }, [firestore, wave, monthYm, currentUser?.customerId]);
  const { data: poMonthDailySheets, isLoading: tsLoading } = useCollection<DailyTimesheet>(
    poMonthTsQuery as any,
  );

  const commercialQ = useMemoFirebase(() => {
    if (!firestore || !currentUser?.customerId) return null;
    return query(
      collection(firestore, 'commercial_invoices'),
      where('customerId', '==', currentUser.customerId),
      where('status', 'in', ['DRAFT', 'PENDING_CUSTOMER', 'ISSUED', 'VOID']),
      orderBy('issueDate', 'desc'),
    );
  }, [firestore, currentUser?.customerId]);
  const { data: commercialInvoices, isLoading: commercialLoading } = useCollection<CommercialInvoice>(commercialQ as any);

  const [monthReviewDoc, setMonthReviewDoc] = useState<WaveMonthTimesheetReview | null>(null);
  const [bundle, setBundle] = useState<WaveMonthTimesheetPhotoBundle | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);

  const accessOk = useMemo(() => {
    if (!currentUser || !wave || !canAccessPortal) return false;
    if (!currentUser.customerId) return false;
    return wave.customerId === currentUser.customerId;
  }, [currentUser, wave, canAccessPortal]);

  useEffect(() => {
    if (!firestore || !wave || !monthYm) {
      setMonthReviewDoc(null);
      setBundle(null);
      setMetaLoading(false);
      return;
    }
    let cancelled = false;
    setMetaLoading(true);
    const id = `${wave.id}_${monthYm}`;
    void (async () => {
      try {
        const [rSettled, bSettled] = await Promise.allSettled([
          getDoc(doc(firestore, 'wave_month_timesheet_reviews', id)),
          getDoc(doc(firestore, 'wave_month_timesheet_photo_bundles', id)),
        ]);
        if (cancelled) return;
        const rSnap = rSettled.status === 'fulfilled' ? rSettled.value : null;
        const bSnap = bSettled.status === 'fulfilled' ? bSettled.value : null;
        if (rSnap?.exists()) {
          const r = { id: rSnap.id, ...(rSnap.data() as object) } as WaveMonthTimesheetReview;
          setMonthReviewDoc(r);
        } else {
          setMonthReviewDoc(null);
        }
        if (bSnap?.exists()) {
          setBundle({ id: bSnap.id, ...(bSnap.data() as object) } as WaveMonthTimesheetPhotoBundle);
        } else {
          setBundle(null);
        }
      } catch {
        if (!cancelled) {
          setMonthReviewDoc(null);
          setBundle(null);
        }
      } finally {
        if (!cancelled) setMetaLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, wave, monthYm]);

  const poById = useMemo(() => new Map((pos ?? []).map((p) => [p.id, p])), [pos]);
  const po = wave ? poById.get(wave.poId) : undefined;

  const waveAssignments = useMemo(() => {
    if (!assignments?.length || !wave) return [];
    return assignments.filter((m) => m.waveId === wave.id);
  }, [assignments, wave]);

  const commercialThisMonth = useMemo(() => {
    return (commercialInvoices ?? []).find(
      (c) =>
        wave &&
        c.waveId === wave.id &&
        c.status !== 'VOID' &&
        yearMonthFromCommercialInvoice(c) === monthYm,
    );
  }, [commercialInvoices, wave, monthYm]);

  const showReadonlyCard = useMemo(() => {
    if (!wave) return false;
    if (monthReviewDoc?.status === 'approved') return true;
    if (commercialThisMonth && monthReviewDoc) return true;
    if (commercialThisMonth && !monthReviewDoc) return true;
    return false;
  }, [wave, monthReviewDoc, commercialThisMonth]);

  const reviewBadge: 'manager' | 'billing' =
    monthReviewDoc?.status === 'approved' ? 'manager' : 'billing';

  const loading = userLoading || waveLoading || tsLoading || metaLoading || commercialLoading;

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

  if (waveErr || (waveLoading === false && !wave)) {
    return <p className="text-sm text-muted-foreground">{t('tsWaveNotFound')}</p>;
  }

  if (wave && !accessOk) {
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

      {loading || !wave ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          {t('tsMonthlyLoading')}
        </div>
      ) : !showReadonlyCard ? (
        <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          {t('tsWaveMonthNotApproved')}
        </p>
      ) : (
        <PortalWaveMonthReadonlyCard
          wave={wave}
          po={po}
          monthYm={monthYm}
          monthReview={monthReviewDoc}
          reviewBadge={reviewBadge}
          bundle={bundle}
          waveAssignments={waveAssignments}
          poMonthDailySheets={poMonthDailySheets ?? []}
          t={t}
        />
      )}
    </div>
  );
}

export default function ClientPortalWaveMonthDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground text-sm">กำลังโหลด…</div>
      }
    >
      <ClientPortalWaveMonthDetailContent />
    </Suspense>
  );
}
