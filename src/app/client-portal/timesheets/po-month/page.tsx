'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { collection, doc, getDoc, orderBy, query, where } from 'firebase/firestore';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  PortalPoMonthDocHeaderCard,
  PortalPoMonthWaveBlock,
  resolveWaveIdsForPoMonth,
} from '@/components/client-portal/portal-po-month-readonly-fragments';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { CustomerQueryService } from '@/lib/services/customer-query-service';
import { isClient } from '@/lib/permissions';
import { usePortalLocale } from '@/contexts/portal-locale-context';
import { poMonthTimesheetReviewDocId } from '@/lib/client-portal/timesheet-portal-utils';
import type { CommercialInvoice, PoMonthTimesheetPhotoBundle, PoMonthTimesheetReview, PurchaseOrder, Wave } from '@/lib/types';

function ClientPortalPoMonthContent() {
  const searchParams = useSearchParams();
  const poId = searchParams.get('poId')?.trim() ?? '';
  const monthYm =
    (() => {
      const m = searchParams.get('month')?.trim() ?? '';
      return /^\d{4}-\d{2}$/.test(m) ? m : '';
    })();

  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { t, locale } = usePortalLocale();

  const queryService = useMemo(
    () => (firestore ? new CustomerQueryService(firestore) : null),
    [firestore],
  );
  const poQuery = useMemoFirebase(() => queryService?.getScopedPOsQuery(currentUser), [queryService, currentUser]);
  const { data: pos, isLoading: poLoading } = useCollection<PurchaseOrder>(poQuery as any);
  const wavesQuery = useMemoFirebase(() => queryService?.getScopedWavesQuery(currentUser), [queryService, currentUser]);
  const { data: waves, isLoading: wavesLoading } = useCollection<Wave>(wavesQuery as any);

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

  const [review, setReview] = useState<PoMonthTimesheetReview | null>(null);
  const [bundle, setBundle] = useState<PoMonthTimesheetPhotoBundle | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);

  const po = useMemo(() => (pos ?? []).find((p) => p.id === poId) ?? null, [pos, poId]);

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
          if (r.status === 'approved') {
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

  const commercialForRow = useMemo(
    () =>
      (commercialInvoices ?? []).find(
        (c) => c.status !== 'VOID' && c.sourcePoMonthReviewId === reviewDocId,
      ) ?? null,
    [commercialInvoices, reviewDocId],
  );

  const waveIds = useMemo(
    () => (review && poId ? resolveWaveIdsForPoMonth(review, waves, poId) : []),
    [review, waves, poId],
  );

  const accessOk = useMemo(() => {
    if (!currentUser || !po) return false;
    if (!isClient(currentUser) || !currentUser.customerId) return false;
    return po.customerId === currentUser.customerId;
  }, [currentUser, po]);

  const loading = userLoading || poLoading || wavesLoading || commercialLoading || metaLoading;

  if (userLoading || !currentUser) {
    return (
      <p className="text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('tsHubLoading')}
      </p>
    );
  }

  if (!isClient(currentUser)) {
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
          {commercialForRow ? (
            <p className="text-sm">
              <Link
                href={`/client-portal/commercial-invoices/${encodeURIComponent(commercialForRow.id)}`}
                className="text-primary font-mono underline-offset-4 hover:underline"
              >
                {t('tsHubColBillingRef')}: {commercialForRow.invoiceNo}
              </Link>
            </p>
          ) : null}
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-muted-foreground pt-2">{t('tsPoMonthWavesSection')}</h2>
            {waveIds.length === 0 ? (
              <p className="text-sm text-muted-foreground border rounded-md p-4">{t('tsPoMonthWavesEmpty')}</p>
            ) : (
              waveIds.map((wid) => (
                <PortalPoMonthWaveBlock key={wid} waveId={wid} po={po} yearMonth={monthYm} t={t} />
              ))
            )}
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
