'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { LayoutGrid, ChevronRight, FileText, MapPin, Users, Waves } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { CustomerQueryService } from '@/lib/services/customer-query-service';
import { assignmentReadyForWaveTimesheet } from '@/lib/constants/timesheet-ui';
import { totalPlannedWorkersOnWave } from '@/lib/ops/wave-allocation';
import {
  formatCustomerPoNumberForPortal,
  formatYearMonthLabel,
  getLastNCalendarMonths,
  mergeWavesWithCommercialReferences,
  portalTryGetWaveMonthReviewSnap,
  shouldHidePortalWaveMonthAfterBillingSettlement,
  yearMonthFromCommercialInvoice,
} from '@/lib/client-portal/timesheet-portal-utils';
import { usePortalLocale } from '@/contexts/portal-locale-context';
import type {
  AccountsReceivable,
  Assignment,
  CommercialInvoice,
  PurchaseOrder,
  TaxInvoice,
  Wave,
  WaveMonthTimesheetReview,
} from '@/lib/types';
import { collection, orderBy, query, where } from 'firebase/firestore';
import { Loader2 } from 'lucide-react';

type ApprovedMonthRow = {
  wave: Wave;
  yearMonth: string;
  /** Present when the month review doc exists; may be non-approved when tied to commercial billing */
  review: WaveMonthTimesheetReview | null;
  reviewDisplay: 'manager' | 'billing';
};

export default function ClientPortalTimesheetHubPage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { t, locale } = usePortalLocale();

  const queryService = useMemo(() => (firestore ? new CustomerQueryService(firestore) : null), [firestore]);

  const wavesQuery = useMemoFirebase(() => queryService?.getScopedWavesQuery(currentUser), [queryService, currentUser]);
  const { data: waves, isLoading: wavesLoading } = useCollection<Wave>(wavesQuery as any);

  const poQuery = useMemoFirebase(() => queryService?.getScopedPOsQuery(currentUser), [queryService, currentUser]);
  const { data: pos, isLoading: poLoading } = useCollection<PurchaseOrder>(poQuery as any);

  const mobQuery = useMemoFirebase(() => queryService?.getScopedAssignmentsQuery(currentUser), [queryService, currentUser]);
  const { data: allMobs, isLoading: mobLoading } = useCollection<Assignment>(mobQuery as any);

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

  const taxQ = useMemoFirebase(() => {
    if (!firestore || !currentUser?.customerId) return null;
    return query(
      collection(firestore, 'tax_invoices'),
      where('customerId', '==', currentUser.customerId),
      orderBy('issueDate', 'desc'),
    );
  }, [firestore, currentUser?.customerId]);
  const { data: taxInvoices, isLoading: taxLoading } = useCollection<TaxInvoice>(taxQ as any);

  const arQ = useMemoFirebase(() => {
    if (!firestore || !currentUser?.customerId) return null;
    return query(collection(firestore, 'accounts_receivable'), where('customerId', '==', currentUser.customerId));
  }, [firestore, currentUser?.customerId]);
  const { data: arItems, isLoading: arLoading } = useCollection<AccountsReceivable>(arQ as any);

  const monthsForScan = useMemo(() => {
    const base = getLastNCalendarMonths(48);
    const set = new Set(base);
    for (const inv of commercialInvoices ?? []) {
      const ym = yearMonthFromCommercialInvoice(inv);
      if (ym) set.add(ym);
    }
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [commercialInvoices]);

  const [approvedRows, setApprovedRows] = useState<ApprovedMonthRow[]>([]);
  const [scanLoading, setScanLoading] = useState(true);

  useEffect(() => {
    if (!firestore || !currentUser?.customerId) {
      setApprovedRows([]);
      setScanLoading(false);
      return;
    }
    const comm = commercialInvoices ?? [];
    const hasCommercialForWaveMonth = (waveId: string, ym: string) =>
      comm.some(
        (c) =>
          c.status !== 'VOID' &&
          c.waveId === waveId &&
          yearMonthFromCommercialInvoice(c) === ym,
      );

    let cancelled = false;
    setScanLoading(true);
    void (async () => {
      const customerId = currentUser.customerId;
      if (!customerId) return;
      try {
        const waveList = await mergeWavesWithCommercialReferences(
          firestore,
          customerId,
          waves ?? [],
          comm,
        );
        if (cancelled) return;

        const tasks = waveList.flatMap((w) =>
          monthsForScan.map((ym) =>
            portalTryGetWaveMonthReviewSnap(firestore, w.id, ym).then((snap) => {
              /** Permission denied or missing doc — still show row if a commercial draft exists for this wave/month */
              if (!snap || !snap.exists()) {
                if (hasCommercialForWaveMonth(w.id, ym)) {
                  return {
                    wave: w,
                    yearMonth: ym,
                    review: null,
                    reviewDisplay: 'billing' as const,
                  };
                }
                return null;
              }
              const r = { id: snap.id, ...(snap.data() as object) } as WaveMonthTimesheetReview;
              if (r.status === 'approved') {
                return { wave: w, yearMonth: ym, review: r, reviewDisplay: 'manager' as const };
              }
              if (hasCommercialForWaveMonth(w.id, ym)) {
                return { wave: w, yearMonth: ym, review: r, reviewDisplay: 'billing' as const };
              }
              return null;
            }),
          ),
        );
        const settled = await Promise.all(tasks);
        if (cancelled) return;
        const rows = settled.filter(Boolean) as ApprovedMonthRow[];
        const seen = new Set(rows.map((x) => `${x.wave.id}_${x.yearMonth}`));

        for (const c of comm) {
          if (c.status === 'VOID') continue;
          const ym = yearMonthFromCommercialInvoice(c);
          if (!ym) continue;
          const w = waveList.find((x) => x.id === c.waveId);
          if (!w) continue;
          const k = `${w.id}_${ym}`;
          if (seen.has(k)) continue;
          seen.add(k);
          rows.push({ wave: w, yearMonth: ym, review: null, reviewDisplay: 'billing' });
        }

        rows.sort((a, b) => {
          const cmp = b.yearMonth.localeCompare(a.yearMonth);
          if (cmp !== 0) return cmp;
          return (a.wave.waveCode || '').localeCompare(b.wave.waveCode || '', 'th');
        });
        setApprovedRows(rows);
      } catch (e) {
        console.warn('[portal ts hub]', e);
        setApprovedRows([]);
      } finally {
        if (!cancelled) setScanLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, waves, monthsForScan, commercialInvoices, currentUser?.customerId]);

  const visibleApprovedRows = useMemo(() => {
    const comm = commercialInvoices ?? [];
    const tax = taxInvoices ?? [];
    const ar = arItems ?? [];
    return approvedRows.filter(
      (row) =>
        !shouldHidePortalWaveMonthAfterBillingSettlement(row.wave, row.yearMonth, comm, tax, ar),
    );
  }, [approvedRows, commercialInvoices, taxInvoices, arItems]);

  const commercialByWaveMonth = useMemo(() => {
    const m = new Map<string, CommercialInvoice>();
    for (const c of commercialInvoices ?? []) {
      if (c.status === 'VOID') continue;
      const ym = yearMonthFromCommercialInvoice(c);
      if (!ym || !c.waveId) continue;
      m.set(`${c.waveId}_${ym}`, c);
    }
    return m;
  }, [commercialInvoices]);

  const rowsByPoId = useMemo(() => {
    const m = new Map<string, ApprovedMonthRow[]>();
    for (const row of visibleApprovedRows) {
      const pid = row.wave.poId;
      const list = m.get(pid) ?? [];
      list.push(row);
      m.set(pid, list);
    }
    return m;
  }, [visibleApprovedRows]);

  const mobsByWave = useMemo(() => {
    const m = new Map<string, Assignment[]>();
    for (const a of allMobs ?? []) {
      const list = m.get(a.waveId) ?? [];
      list.push(a);
      m.set(a.waveId, list);
    }
    return m;
  }, [allMobs]);

  const poById = useMemo(() => new Map((pos ?? []).map((p) => [p.id, p])), [pos]);

  const poSections = useMemo(() => {
    return [...rowsByPoId.entries()]
      .filter(([, rows]) => rows.length > 0)
      .map(([poId, rows]) => ({ poId, rows, po: poById.get(poId) }))
      .sort((a, b) => {
        const la = formatCustomerPoNumberForPortal(a.po, a.poId);
        const lb = formatCustomerPoNumberForPortal(b.po, b.poId);
        return la.localeCompare(lb, 'th');
      });
  }, [rowsByPoId, poById]);

  const loading =
    userLoading ||
    wavesLoading ||
    poLoading ||
    mobLoading ||
    scanLoading ||
    commercialLoading ||
    taxLoading ||
    arLoading;

  if (userLoading) {
    return (
      <p className="text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('tsHubLoading')}
      </p>
    );
  }

  if (!currentUser) {
    return null;
  }

  return (
    <div className="mx-auto w-full space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-primary sm:text-2xl">
            <LayoutGrid className="h-7 w-7 shrink-0 sm:h-8 sm:w-8" />
            {t('tsHubPageTitle')}
          </h1>
          <p className="text-sm text-muted-foreground max-w-[min(100%,48rem)]">{t('tsHubPageLead')}</p>
        </div>
      </div>

      <Card className="border-primary/20 bg-primary/[0.04]">
        <CardContent className="space-y-2 pt-6 text-sm text-muted-foreground">
          <p>{t('tsHubPolicyP2')}</p>
          <p>{t('tsHubPolicyP3')}</p>
        </CardContent>
      </Card>

      {loading ? (
        <p className="text-sm text-muted-foreground py-12 text-center flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('tsHubLoading')}
        </p>
      ) : poSections.length === 0 ? (
        <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">{t('tsHubEmpty')}</p>
      ) : (
        <div className="space-y-8">
          {poSections.map(({ poId, rows, po }) => {
            const poLabel = formatCustomerPoNumberForPortal(po, poId);
            return (
              <Card key={poId} className="overflow-hidden shadow-sm">
                <CardHeader className="border-b bg-muted/30">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <FileText className="h-5 w-5 text-primary" />
                        <span className="font-mono">{poLabel}</span>
                      </CardTitle>
                    </div>
                    <Badge variant="secondary">
                      {rows.length} {t('tsHubPeriodCount')}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('tsHubColWave')}</TableHead>
                        <TableHead className="whitespace-nowrap min-w-[9rem]">{t('tsHubColCustomerPoNo')}</TableHead>
                        <TableHead className="whitespace-nowrap">{t('tsHubColMonth')}</TableHead>
                        <TableHead>{t('tsHubColLocation')}</TableHead>
                        <TableHead className="text-center">{t('tsHubColWaveStatus')}</TableHead>
                        <TableHead className="text-center">{t('tsHubColAssigned')}</TableHead>
                        <TableHead className="text-center max-w-[120px]">{t('tsHubColReady')}</TableHead>
                        <TableHead className="text-left min-w-[7rem]">{t('tsHubColBillingRef')}</TableHead>
                        <TableHead className="w-14 text-right">{t('tsHubColDetail')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map(({ wave: w, yearMonth }) => {
                        const mobs = mobsByWave.get(w.id) ?? [];
                        const ready = mobs.filter((m) => assignmentReadyForWaveTimesheet(m)).length;
                        const planned = totalPlannedWorkersOnWave(w) || w.plannedWorkers || 0;
                        const detailHref = `/client-portal/timesheets/wave/${encodeURIComponent(w.id)}?month=${encodeURIComponent(yearMonth)}`;
                        const commRow = commercialByWaveMonth.get(`${w.id}_${yearMonth}`);
                        const billingHref = commRow
                          ? `/client-portal/commercial-invoices/${encodeURIComponent(commRow.id)}`
                          : null;
                        return (
                          <TableRow key={`${w.id}-${yearMonth}`}>
                            <TableCell className="font-mono font-semibold">
                              <span className="flex items-center gap-1">
                                <Waves className="h-3.5 w-3.5 text-primary" />
                                {w.waveCode}
                              </span>
                            </TableCell>
                            <TableCell className="font-mono text-sm">{poLabel}</TableCell>
                            <TableCell className="text-sm font-semibold text-primary whitespace-nowrap">
                              {formatYearMonthLabel(yearMonth, locale)}
                            </TableCell>
                            <TableCell>
                              <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                                <MapPin className="h-3 w-3 shrink-0" />
                                {w.siteLocation || '—'}
                              </span>
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge variant="outline">{w.status}</Badge>
                            </TableCell>
                            <TableCell className="text-center">
                              <span className="inline-flex items-center justify-center gap-1">
                                <Users className="h-3.5 w-3.5" />
                                {w.assignedWorkers ?? mobs.length}
                                <span className="text-muted-foreground">/</span>
                                {planned}
                              </span>
                            </TableCell>
                            <TableCell className="text-center font-semibold text-green-700">{ready}</TableCell>
                            <TableCell className="text-sm">
                              {billingHref && commRow ? (
                                <Link
                                  href={billingHref}
                                  className="font-mono text-primary underline-offset-4 hover:underline"
                                >
                                  {commRow.invoiceNo}
                                </Link>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right p-1">
                              <Link
                                href={detailHref}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-primary hover:bg-muted"
                                aria-label={t('tsHubColDetail')}
                              >
                                <ChevronRight className="h-5 w-5" aria-hidden />
                              </Link>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground text-center">
        {t('tsHubFootnote')}
      </p>
    </div>
  );
}
