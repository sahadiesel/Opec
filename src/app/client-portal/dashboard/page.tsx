'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import {
  FileText,
  ShoppingCart,
  HardHat,
  Clock,
  FileEdit,
  ChevronRight,
  AlertCircle,
  Wallet,
  Waves,
} from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where, limit, orderBy } from 'firebase/firestore';
import { CustomerQueryService } from '@/lib/services/customer-query-service';
import { isClient } from '@/lib/permissions';
import { useAppUser } from '@/hooks/use-app-user';
import { usePortalLocale } from '@/contexts/portal-locale-context';
import type { PortalDictKey } from '@/lib/i18n/client-portal-dictionary';
import type { LucideIcon } from 'lucide-react';

const TILES: { id: string; href: string; key: PortalDictKey; icon: LucideIcon }[] = [
  { id: 'contracts', href: '/client-portal/contracts', key: 'contracts', icon: FileText },
  { id: 'pos', href: '/client-portal/contracts', key: 'pos', icon: ShoppingCart },
  { id: 'workers', href: '/client-portal/workers', key: 'workers', icon: HardHat },
  { id: 'timesheets', href: '/client-portal/timesheets', key: 'timesheets', icon: Clock },
  { id: 'accounting', href: '/client-portal/accounting', key: 'accounting', icon: FileEdit },
];

export default function ClientDashboardPage() {
  const { currentUser, isLoading: appUserLoading } = useAppUser();
  const firestore = useFirestore();
  const { t } = usePortalLocale();

  const isClientUser = useMemo(() => isClient(currentUser), [currentUser]);

  const queryService = useMemo(() => (firestore ? new CustomerQueryService(firestore) : null), [firestore]);

  const wavesQuery = useMemoFirebase(() => queryService?.getScopedWavesQuery(currentUser), [queryService, currentUser]);
  const { data: waves } = useCollection(wavesQuery as any);

  const posQuery = useMemoFirebase(() => queryService?.getScopedPOsQuery(currentUser), [queryService, currentUser]);
  const { data: pos } = useCollection(posQuery as any);

  const recentInvoicesQuery = useMemoFirebase(() => {
    if (!firestore || !currentUser?.customerId) return null;
    return query(
      collection(firestore, 'tax_invoices'),
      where('customerId', '==', currentUser.customerId),
      orderBy('issueDate', 'desc'),
      limit(40)
    );
  }, [firestore, currentUser?.customerId]);
  const { data: recentInvoices } = useCollection(recentInvoicesQuery as any);

  const pendingDraftApprovals = useMemo(
    () =>
      (recentInvoices ?? []).filter(
        (d: { status?: string; billingCustomerApprovedAt?: number }) =>
          d.status === 'DRAFT' && !d.billingCustomerApprovedAt
      ).length,
    [recentInvoices]
  );

  if (appUserLoading || !currentUser) return null;

  if (!isClientUser) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-white py-16 text-center dark:border-zinc-800 dark:bg-zinc-900/50">
        <AlertCircle className="mb-3 h-10 w-10 text-amber-500" />
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{t('accessRestricted')}</h2>
        <p className="mt-1 max-w-sm text-sm text-zinc-500">{t('portalOnly')}</p>
      </div>
    );
  }

  const activeWaves = waves?.filter((w: { status: string }) => w.status === 'ACTIVE').length ?? 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-2xl">{t('dashboardTitle')}</h1>
        <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{t('dashboardLead')}</p>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="rounded-xl border border-zinc-200 bg-white p-3 text-center dark:border-zinc-800 dark:bg-zinc-900/40">
          <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{pos?.length ?? 0}</p>
          <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 sm:text-xs">PO</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-3 text-center dark:border-zinc-800 dark:bg-zinc-900/40">
          <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{activeWaves}</p>
          <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 sm:text-xs">{t('waves')}</p>
        </div>
        <div className="rounded-xl border border-amber-200/80 bg-amber-50/80 p-3 text-center dark:border-amber-900/40 dark:bg-amber-950/30">
          <p className="text-lg font-semibold text-amber-900 dark:text-amber-100">{pendingDraftApprovals}</p>
          <p className="text-[10px] font-medium uppercase tracking-wide text-amber-800/80 dark:text-amber-200/80">
            {t('draftInvoices')}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {TILES.map(({ id, href, key, icon: Icon }) => (
          <Link
            key={id}
            href={href}
            className="group flex items-center gap-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-primary/30 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900/40"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Icon className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-zinc-900 dark:text-zinc-50">{t(key)}</p>
              <p className="text-xs text-zinc-500">{t('open')}</p>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-zinc-300 transition group-hover:translate-x-0.5 group-hover:text-primary" />
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <Link
          href="/client-portal/waves"
          className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
        >
          <Waves className="h-4 w-4" />
          {t('waves')}
        </Link>
        <Link
          href="/client-portal/accounting?tab=billing"
          className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
        >
          <Wallet className="h-4 w-4" />
          {t('dashboardMoreBilling')}
        </Link>
      </div>
    </div>
  );
}
