'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import Link from 'next/link';
import { FileText, ChevronDown, ChevronRight } from 'lucide-react';
import type { MainContract, PurchaseOrder } from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { CustomerQueryService } from '@/lib/services/customer-query-service';
import { usePortalLocale } from '@/contexts/portal-locale-context';
import { formatStoredDateRangeThaiBE } from '@/lib/date-thai';
import { Badge } from '@/components/ui/badge';
import { useClientPortalIdentity } from '@/contexts/client-portal-user-context';
import { Button } from '@/components/ui/button';
import { formatCustomerPoNumberForPortal } from '@/lib/client-portal/timesheet-portal-utils';
export default function ClientContractsPage() {
  const { effectiveUser: currentUser, appUserLoading: isLoading, canAccessPortal } = useClientPortalIdentity();
  const firestore = useFirestore();
  const { locale, t } = usePortalLocale();
  const [openId, setOpenId] = useState<string | null>(null);

  const queryService = useMemo(() => (firestore ? new CustomerQueryService(firestore) : null), [firestore]);
  const cq = useMemoFirebase(() => queryService?.getScopedContractsQuery(currentUser), [queryService, currentUser]);
  const { data: contracts, isLoading: loadingC } = useCollection<MainContract>(cq as any);

  const pq = useMemoFirebase(() => queryService?.getScopedPOsQuery(currentUser), [queryService, currentUser]);
  const { data: purchaseOrders, isLoading: loadingP } = useCollection<PurchaseOrder>(pq as any);

  const contractIds = useMemo(() => new Set((contracts ?? []).map((c) => c.id)), [contracts]);

  const posByContract = useMemo(() => {
    const m = new Map<string, PurchaseOrder[]>();
    for (const po of purchaseOrders ?? []) {
      const cid = (po.contractId || '').trim();
      if (!cid || !contractIds.has(cid)) continue;
      const arr = m.get(cid) ?? [];
      arr.push(po);
      m.set(cid, arr);
    }
    return m;
  }, [purchaseOrders, contractIds]);

  const standalonePos = useMemo(() => {
    return (purchaseOrders ?? []).filter((po) => {
      const cid = (po.contractId || '').trim();
      return !cid || !contractIds.has(cid);
    });
  }, [purchaseOrders, contractIds]);

  /** Deep link from timesheet hub: #client-po-{poId} — expand contract row if PO is nested */
  useEffect(() => {
    if (typeof window === 'undefined' || loadingC || loadingP) return;
    const raw = window.location.hash.replace(/^#/, '');
    const prefix = 'client-po-';
    if (!raw.startsWith(prefix)) return;
    const poId = decodeURIComponent(raw.slice(prefix.length));
    const po = (purchaseOrders ?? []).find((p) => p.id === poId);
    if (!po) return;
    const cid = (po.contractId || '').trim();
    const scrollToPo = () => document.getElementById(raw)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (cid && contractIds.has(cid)) {
      setOpenId(cid);
      window.setTimeout(scrollToPo, 250);
    } else {
      requestAnimationFrame(() => requestAnimationFrame(scrollToPo));
    }
  }, [loadingC, loadingP, purchaseOrders, contractIds]);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">…</p>;
  }

  if (!currentUser || !canAccessPortal) {
    return (
      <p className="text-sm text-muted-foreground">
        {locale === 'en' ? 'Customer portal only.' : 'เฉพาะบัญชีลูกค้า'}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-primary flex items-center gap-2">
          <FileText className="h-6 w-6" />
          {locale === 'en' ? 'Your contracts' : 'สัญญาของท่าน'}
        </h2>
        <p className="text-sm text-muted-foreground">{t('contractsPoHint')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{locale === 'en' ? 'Contract list' : 'รายการสัญญา'}</CardTitle>
          <CardDescription>{locale === 'en' ? 'Read-only — click a row to show POs' : 'ดูอย่างเดียว — กดแถวเพื่อดู PO'}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loadingC || loadingP ? (
            <p className="p-6 text-sm text-muted-foreground">…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>{locale === 'en' ? 'Code' : 'รหัส'}</TableHead>
                  <TableHead>{locale === 'en' ? 'Title' : 'ชื่อสัญญา'}</TableHead>
                  <TableHead>{locale === 'en' ? 'Period' : 'ช่วงเวลา'}</TableHead>
                  <TableHead>{locale === 'en' ? 'Status' : 'สถานะ'}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(contracts ?? []).map((c) => {
                  const expanded = openId === c.id;
                  const nested = posByContract.get(c.id) ?? [];
                  return (
                    <Fragment key={c.id}>
                      <TableRow
                        className="cursor-pointer hover:bg-muted/40"
                        onClick={() => setOpenId(expanded ? null : c.id)}
                      >
                        <TableCell className="w-10">
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-expanded={expanded}>
                            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </Button>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{c.contractNumber || c.id}</TableCell>
                        <TableCell className="font-medium">{c.title || '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatStoredDateRangeThaiBE(c.startDate, c.endDate)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{c.status}</Badge>
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow className="bg-muted/20 hover:bg-muted/20">
                          <TableCell />
                          <TableCell colSpan={4} className="p-0">
                            <div className="border-t border-border px-4 py-3">
                              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                {t('posForContract')}
                              </p>
                              {nested.length === 0 ? (
                                <p className="text-sm text-muted-foreground">—</p>
                              ) : (
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>{t('poCode')}</TableHead>
                                      <TableHead>{t('contractsColCustomerPo')}</TableHead>
                                      <TableHead>{t('poPeriod')}</TableHead>
                                      <TableHead>{locale === 'en' ? 'Status' : 'สถานะ'}</TableHead>
                                      <TableHead className="w-14 text-right">{t('contractsColAction')}</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {nested.map((po) => (
                                      <TableRow key={po.id} id={`client-po-${po.id}`} className="scroll-mt-20">
                                        <TableCell className="font-mono text-xs">{po.poCode || po.id}</TableCell>
                                        <TableCell className="text-sm font-mono">
                                          {formatCustomerPoNumberForPortal(po, po.id)}
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground">
                                          {formatStoredDateRangeThaiBE(po.startDate, po.endDate)}
                                        </TableCell>
                                        <TableCell>
                                          <Badge variant="secondary">{po.status}</Badge>
                                        </TableCell>
                                        <TableCell className="text-right p-1">
                                          <Link
                                            href={`/client-portal/po/${encodeURIComponent(po.id)}`}
                                            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-primary hover:bg-muted"
                                            aria-label={t('contractsColAction')}
                                          >
                                            <ChevronRight className="h-4 w-4" aria-hidden />
                                          </Link>
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
                {(!contracts || contracts.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                      {locale === 'en' ? 'No contracts found.' : 'ไม่พบสัญญา'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('otherPOs')}</CardTitle>
          <CardDescription>{t('otherPOsHint')}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('poCode')}</TableHead>
                <TableHead>{t('contractsColCustomerPo')}</TableHead>
                <TableHead>{t('poPeriod')}</TableHead>
                <TableHead>{locale === 'en' ? 'Status' : 'สถานะ'}</TableHead>
                <TableHead className="w-14 text-right">{t('contractsColAction')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {standalonePos.map((po) => (
                <TableRow key={po.id} id={`client-po-${po.id}`} className="scroll-mt-20">
                  <TableCell className="font-mono text-xs">{po.poCode || po.id}</TableCell>
                  <TableCell className="text-sm font-mono">
                    {formatCustomerPoNumberForPortal(po, po.id)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatStoredDateRangeThaiBE(po.startDate, po.endDate)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{po.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right p-1">
                    <Link
                      href={`/client-portal/po/${encodeURIComponent(po.id)}`}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-primary hover:bg-muted"
                      aria-label={t('contractsColAction')}
                    >
                      <ChevronRight className="h-4 w-4" aria-hidden />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
              {standalonePos.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    {t('noData')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
