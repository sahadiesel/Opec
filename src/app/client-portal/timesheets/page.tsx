'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { LayoutGrid, ChevronRight, FileText, MapPin, Users, Waves } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { useClientPortalIdentity } from '@/contexts/client-portal-user-context';
import { CustomerQueryService } from '@/lib/services/customer-query-service';
import { assignmentReadyForWaveTimesheet } from '@/lib/constants/timesheet-ui';
import { isAssignmentActiveOnWaveRoster } from '@/lib/ops/assignment-roster';
import { totalPlannedWorkersOnWave } from '@/lib/ops/wave-allocation';
import { PortalCustomerApprovalStatusBadge } from '@/components/client-portal/portal-month-customer-actions';
import {
  formatCustomerPoNumberForPortal,
  formatYearMonthLabel,
  getLastNCalendarMonths,
  mergeWavesWithCommercialReferences,
  portalTryGetPoMonthReviewSnap,
  portalTryGetWaveMonthReviewSnap,
  shouldHidePortalPoMonthAfterBillingSettlement,
  shouldHidePortalWaveMonthAfterBillingSettlement,
  yearMonthFromCommercialInvoice,
} from '@/lib/client-portal/timesheet-portal-utils';
import { resolvePoActiveBundleKeyForPo } from '@/lib/ops/po-active-bundle';
import { isPartialPoMonthCommercialInvoice } from '@/lib/commercial/partial-po-month-billing';
import { poActiveBundleWorkModeShortLabel } from '@/lib/ops/po-active-bundle-grouping';
import { usePortalLocale } from '@/contexts/portal-locale-context';
import type {
  AccountsReceivable,
  Assignment,
  CommercialInvoice,
  PurchaseOrder,
  TaxInvoice,
  PoMonthTimesheetReview,
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

type ApprovedPoMonthRow = {
  po: PurchaseOrder;
  poId: string;
  yearMonth: string;
  review: PoMonthTimesheetReview;
};

export default function ClientPortalTimesheetHubPage() {
  const { effectiveUser: currentUser, appUserLoading: userLoading } = useClientPortalIdentity();
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
  const [approvedPoMonthRows, setApprovedPoMonthRows] = useState<ApprovedPoMonthRow[]>([]);
  const [scanLoading, setScanLoading] = useState(true);

  useEffect(() => {
    if (!firestore || !currentUser?.customerId) {
      setApprovedRows([]);
      setApprovedPoMonthRows([]);
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
        const posList = pos ?? [];
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
              const currentYm = getLastNCalendarMonths(1)[0];
              if (r.status === 'approved') {
                return { wave: w, yearMonth: ym, review: r, reviewDisplay: 'manager' as const };
              }
              if (hasCommercialForWaveMonth(w.id, ym)) {
                return { wave: w, yearMonth: ym, review: r, reviewDisplay: 'billing' as const };
              }
              /** เดือนปัจจุบัน — ให้ลูกค้าดูได้แม้ยังไม่ปล่อยอนุมัติ */
              if (ym === currentYm && r.status !== 'rejected') {
                return { wave: w, yearMonth: ym, review: r, reviewDisplay: 'billing' as const };
              }
              return null;
            }),
          ),
        );
        const poMonthTasks = posList.flatMap((p) =>
          monthsForScan.map((ym) =>
            portalTryGetPoMonthReviewSnap(firestore, p.id, ym).then((snap) => {
              if (!snap || !snap.exists()) return null;
              const r = { id: snap.id, ...(snap.data() as object) } as PoMonthTimesheetReview;
              const currentYm = getLastNCalendarMonths(1)[0];
              if (r.status === 'approved') {
                return { po: p, poId: p.id, yearMonth: ym, review: r };
              }
              if (ym === currentYm && r.status !== 'rejected') {
                return { po: p, poId: p.id, yearMonth: ym, review: r };
              }
              return null;
            }),
          ),
        );
        const [settled, poMonthSettled] = await Promise.all([Promise.all(tasks), Promise.all(poMonthTasks)]);
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
        setApprovedPoMonthRows(poMonthSettled.filter(Boolean) as ApprovedPoMonthRow[]);
      } catch (e) {
        console.warn('[portal ts hub]', e);
        setApprovedRows([]);
        setApprovedPoMonthRows([]);
      } finally {
        if (!cancelled) setScanLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, waves, pos, monthsForScan, commercialInvoices, currentUser?.customerId]);

  const visibleApprovedRows = useMemo(() => {
    const comm = commercialInvoices ?? [];
    const tax = taxInvoices ?? [];
    const ar = arItems ?? [];
    return approvedRows.filter(
      (row) =>
        !shouldHidePortalWaveMonthAfterBillingSettlement(row.wave, row.yearMonth, comm, tax, ar),
    );
  }, [approvedRows, commercialInvoices, taxInvoices, arItems]);

  const visiblePoMonthRows = useMemo(() => {
    const comm = commercialInvoices ?? [];
    const tax = taxInvoices ?? [];
    const ar = arItems ?? [];
    return approvedPoMonthRows.filter(
      (row) => !shouldHidePortalPoMonthAfterBillingSettlement(row.poId, row.yearMonth, comm, tax, ar),
    );
  }, [approvedPoMonthRows, commercialInvoices, taxInvoices, arItems]);

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

  const commercialByPoMonthReviewId = useMemo(() => {
    const m = new Map<string, CommercialInvoice[]>();
    for (const c of commercialInvoices ?? []) {
      if (c.status === 'VOID' || !c.sourcePoMonthReviewId?.trim()) continue;
      const key = c.sourcePoMonthReviewId.trim();
      const list = m.get(key) ?? [];
      list.push(c);
      m.set(key, list);
    }
    for (const list of m.values()) {
      list.sort((a, b) => (a.invoiceNo || a.id).localeCompare(b.invoiceNo || b.id, 'th'));
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

  const poMonthRowsByPo = useMemo(() => {
    const m = new Map<string, ApprovedPoMonthRow[]>();
    for (const r of visiblePoMonthRows) {
      const list = m.get(r.poId) ?? [];
      list.push(r);
      m.set(r.poId, list);
    }
    for (const list of m.values()) {
      list.sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
    }
    return m;
  }, [visiblePoMonthRows]);

  const poKeysOrdered = useMemo(() => {
    const ids = new Set([...rowsByPoId.keys(), ...poMonthRowsByPo.keys()]);
    return [...ids].sort((a, b) => {
      const la = formatCustomerPoNumberForPortal(poById.get(a), a);
      const lb = formatCustomerPoNumberForPortal(poById.get(b), b);
      return la.localeCompare(lb, 'th');
    });
  }, [rowsByPoId, poMonthRowsByPo, poById]);

  const bundleOrdered = useMemo(() => {
    const bundleToPoIds = new Map<string, string[]>();
    for (const poId of poKeysOrdered) {
      const po = poById.get(poId);
      const bk = po ? resolvePoActiveBundleKeyForPo(po) : `orphan:${poId}`;
      const list = bundleToPoIds.get(bk) ?? [];
      list.push(poId);
      bundleToPoIds.set(bk, list);
    }
    const entries = [...bundleToPoIds.entries()].map(([bundleKey, ids]) => {
      const sortedPoIds = [...ids].sort((a, b) =>
        formatCustomerPoNumberForPortal(poById.get(a), a).localeCompare(
          formatCustomerPoNumberForPortal(poById.get(b), b),
          'th',
        ),
      );
      const headPo = poById.get(sortedPoIds[0]!);
      const modeFromKey =
        bundleKey.endsWith('__ONSHORE') ? 'ONSHORE' : bundleKey.endsWith('__OFFSHORE') ? 'OFFSHORE' : undefined;
      return {
        bundleKey,
        poIds: sortedPoIds,
        workMode: modeFromKey ?? headPo?.poWorkMode,
      };
    });
    entries.sort((a, b) => {
      const ao = a.bundleKey.startsWith('orphan:') ? 1 : 0;
      const bo = b.bundleKey.startsWith('orphan:') ? 1 : 0;
      if (ao !== bo) return ao - bo;
      return a.bundleKey.localeCompare(b.bundleKey);
    });
    return entries;
  }, [poKeysOrdered, poById]);

  const hubEmpty = useMemo(() => bundleOrdered.length === 0, [bundleOrdered]);

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
      ) : hubEmpty ? (
        <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">{t('tsHubEmpty')}</p>
      ) : (
        <div className="space-y-10">
          {bundleOrdered.map(({ bundleKey, poIds, workMode }) => (
            <div key={bundleKey} className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/15 bg-primary/5 px-4 py-2.5 text-sm">
                <Badge variant="outline" className="shrink-0 font-semibold">
                  {poActiveBundleWorkModeShortLabel(workMode)}
                </Badge>
                <span className="font-semibold text-foreground">{t('tsHubBundleStrip')}</span>
                <span
                  className="font-mono text-xs text-muted-foreground truncate max-w-[min(100%,22rem)]"
                  title={bundleKey}
                >
                  {bundleKey}
                </span>
              </div>
              <div className="space-y-8">
                {poIds.map((poId) => {
                  const po = poById.get(poId);
                  const poLabel = formatCustomerPoNumberForPortal(po, poId);
                  const monthRows = poMonthRowsByPo.get(poId) ?? [];
                  const rows = rowsByPoId.get(poId) ?? [];
                  const n = monthRows.length + rows.length;
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
                      {n} {t('tsHubPeriodCount')}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-0 space-y-0">
                  {monthRows.length > 0 ? (
                    <div className="space-y-0">
                      <div className="px-4 sm:px-6 pt-4 text-sm font-semibold text-foreground/90">
                        {t('tsHubSectionPoMonth')}
                      </div>
                      <Table className="table-fixed w-full">
                        <colgroup>
                          <col className="w-[28%]" />
                          <col className="w-[14%]" />
                          <col className="w-[28%]" />
                          <col className="w-[20%]" />
                          <col className="w-[10%]" />
                        </colgroup>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="px-4 whitespace-nowrap">{t('tsHubColCustomerPoNo')}</TableHead>
                            <TableHead className="px-4 whitespace-nowrap">{t('tsHubColMonth')}</TableHead>
                            <TableHead className="px-4 text-center">{t('tsHubColReview')}</TableHead>
                            <TableHead className="px-4 text-left">{t('tsHubColBillingRef')}</TableHead>
                            <TableHead className="px-4 text-right">{t('tsHubColDetail')}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {monthRows.map((r) => {
                            const commRows = commercialByPoMonthReviewId.get(r.review.id) ?? [];
                            const detailHref = `/client-portal/timesheets/po-month?poId=${encodeURIComponent(poId)}&month=${encodeURIComponent(r.yearMonth)}`;
                            return (
                              <TableRow key={r.review.id}>
                                <TableCell className="px-4 font-mono text-sm align-middle break-words">{poLabel}</TableCell>
                                <TableCell className="px-4 text-sm font-semibold text-primary whitespace-nowrap align-middle">
                                  {formatYearMonthLabel(r.yearMonth, locale)}
                                </TableCell>
                                <TableCell className="px-4 text-center align-middle">
                                  <PortalCustomerApprovalStatusBadge
                                    customerApprovalStatus={r.review.customerApprovalStatus}
                                    managerApproved={r.review.status === 'approved'}
                                  />
                                </TableCell>
                                <TableCell className="px-4 text-sm align-middle">
                                  {commRows.length > 0 ? (
                                    <div className="flex flex-col gap-1">
                                      {commRows.map((commRow) => (
                                        <div key={commRow.id} className="flex flex-wrap items-center gap-1.5">
                                          <Link
                                            href={`/client-portal/commercial-invoices/${encodeURIComponent(commRow.id)}`}
                                            className="font-mono text-primary underline-offset-4 hover:underline"
                                          >
                                            {commRow.invoiceNo}
                                          </Link>
                                          {isPartialPoMonthCommercialInvoice(commRow) ? (
                                            <Badge variant="secondary" className="text-[10px]">
                                              Partial
                                            </Badge>
                                          ) : null}
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                                <TableCell className="px-4 text-right align-middle">
                                  <Link
                                    href={detailHref}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-md text-primary hover:bg-muted"
                                    aria-label={t('tsHubViewPoMonth')}
                                  >
                                    <ChevronRight className="h-5 w-5" aria-hidden />
                                  </Link>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  ) : null}
                  {rows.length > 0 ? (
                    <div className={monthRows.length > 0 ? 'space-y-0 border-t' : 'space-y-0'}>
                      <div className="px-4 sm:px-6 pt-4 text-sm font-semibold text-foreground/90">
                        {t('tsHubSectionWaves')}
                      </div>
                      <Table className="table-fixed w-full">
                        <colgroup>
                          <col className="w-[12%]" />
                          <col className="w-[16%]" />
                          <col className="w-[10%]" />
                          <col className="w-[12%]" />
                          <col className="w-[16%]" />
                          <col className="w-[10%]" />
                          <col className="w-[8%]" />
                          <col className="w-[10%]" />
                          <col className="w-[6%]" />
                        </colgroup>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="px-3">{t('tsHubColWave')}</TableHead>
                            <TableHead className="px-3 whitespace-nowrap">{t('tsHubColCustomerPoNo')}</TableHead>
                            <TableHead className="px-3 whitespace-nowrap">{t('tsHubColMonth')}</TableHead>
                            <TableHead className="px-3">{t('tsHubColLocation')}</TableHead>
                            <TableHead className="px-3 text-center">{t('tsHubColWaveStatus')}</TableHead>
                            <TableHead className="px-3 text-center">{t('tsHubColAssigned')}</TableHead>
                            <TableHead className="px-3 text-center">{t('tsHubColReady')}</TableHead>
                            <TableHead className="px-3 text-left">{t('tsHubColBillingRef')}</TableHead>
                            <TableHead className="px-3 text-right">{t('tsHubColDetail')}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rows.map(({ wave: w, yearMonth, review: waveReview }) => {
                            const mobs = mobsByWave.get(w.id) ?? [];
                            const activeMobs = mobs.filter((m) => isAssignmentActiveOnWaveRoster(m));
                            const assignedActive = activeMobs.length;
                            const ready = activeMobs.filter((m) => assignmentReadyForWaveTimesheet(m)).length;
                            const planned = totalPlannedWorkersOnWave(w) || w.plannedWorkers || 0;
                            const detailHref = `/client-portal/timesheets/wave/${encodeURIComponent(w.id)}?month=${encodeURIComponent(yearMonth)}`;
                            const commRow = commercialByWaveMonth.get(`${w.id}_${yearMonth}`);
                            const billingHref = commRow
                              ? `/client-portal/commercial-invoices/${encodeURIComponent(commRow.id)}`
                              : null;
                            return (
                              <TableRow key={`${w.id}-${yearMonth}`}>
                                <TableCell className="px-3 font-mono font-semibold align-middle break-words">
                                  <span className="flex items-center gap-1">
                                    <Waves className="h-3.5 w-3.5 shrink-0 text-primary" />
                                    {w.waveCode}
                                  </span>
                                </TableCell>
                                <TableCell className="px-3 font-mono text-sm align-middle break-words">{poLabel}</TableCell>
                                <TableCell className="px-3 text-sm font-semibold text-primary whitespace-nowrap align-middle">
                                  {formatYearMonthLabel(yearMonth, locale)}
                                </TableCell>
                                <TableCell className="px-3 align-middle">
                                  <span className="inline-flex items-start gap-1 text-sm text-muted-foreground break-words">
                                    <MapPin className="h-3 w-3 shrink-0 mt-0.5" />
                                    {w.siteLocation || '—'}
                                  </span>
                                </TableCell>
                                <TableCell className="px-3 text-center align-middle">
                                  <div className="flex flex-col items-center gap-1">
                                    <Badge variant="outline">{w.status}</Badge>
                                    <PortalCustomerApprovalStatusBadge
                                      customerApprovalStatus={waveReview?.customerApprovalStatus}
                                      managerApproved={waveReview?.status === 'approved'}
                                    />
                                  </div>
                                </TableCell>
                                <TableCell className="px-3 text-center align-middle">
                                  <span className="inline-flex items-center justify-center gap-1">
                                    <Users className="h-3.5 w-3.5" />
                                    {assignedActive}
                                    <span className="text-muted-foreground">/</span>
                                    {planned}
                                  </span>
                                </TableCell>
                                <TableCell className="px-3 text-center font-semibold text-green-700 align-middle">{ready}</TableCell>
                                <TableCell className="px-3 text-sm align-middle break-words">
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
                                <TableCell className="px-3 text-right align-middle">
                                  <Link
                                    href={detailHref}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-md text-primary hover:bg-muted"
                                    aria-label={t('tsHubViewMonthly')}
                                  >
                                    <ChevronRight className="h-5 w-5" aria-hidden />
                                  </Link>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground text-center">
        {t('tsHubFootnote')}
      </p>
    </div>
  );
}
