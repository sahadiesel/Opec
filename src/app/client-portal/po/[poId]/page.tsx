'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Calendar, ChevronLeft, FileText, Loader2 } from 'lucide-react';
import { collection, doc, getDoc, getDocs, limit, query } from 'firebase/firestore';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { useClientPortalIdentity } from '@/contexts/client-portal-user-context';
import { usePortalLocale } from '@/contexts/portal-locale-context';
import { formatCustomerPoNumberForPortal } from '@/lib/client-portal/timesheet-portal-utils';
import { formatDateRangeThaiBE, formatStoredDateRangeThaiBE } from '@/lib/date-thai';
import type { POLine, Position, PurchaseOrder } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function ClientPortalPoDetailPage() {
  const params = useParams();
  const poId = typeof params?.poId === 'string' ? params.poId : '';
  const firestore = useFirestore();
  const { effectiveUser: currentUser, appUserLoading: userLoading, canAccessPortal } = useClientPortalIdentity();
  const { locale, t } = usePortalLocale();
  const [po, setPo] = useState<PurchaseOrder | null | undefined>(undefined);
  const [positionLabels, setPositionLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!firestore || !poId) return;
    if (!currentUser) return;
    if (!currentUser.customerId) {
      setPo(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const snap = await getDoc(doc(firestore, 'purchase_orders', poId));
        if (cancelled) return;
        if (!snap.exists()) {
          setPo(null);
          return;
        }
        const p = { id: snap.id, ...(snap.data() as object) } as PurchaseOrder;
        if (p.customerId !== currentUser.customerId) {
          setPo(null);
          return;
        }
        setPo(p);
      } catch {
        if (!cancelled) setPo(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, poId, currentUser]);

  useEffect(() => {
    if (!firestore) return;
    void (async () => {
      try {
        const snap = await getDocs(query(collection(firestore, 'positions'), limit(500)));
        const m: Record<string, string> = {};
        snap.docs.forEach((d) => {
          const x = d.data() as Position;
          m[d.id] = (x.positionName || x.positionNameTh || x.positionCode || d.id).trim();
        });
        setPositionLabels(m);
      } catch {
        /* ignore */
      }
    })();
  }, [firestore]);

  const linesQuery = useMemoFirebase(
    () =>
      firestore && po && po.id === poId ? collection(firestore, 'purchase_orders', poId, 'po_lines') : null,
    [firestore, po, poId],
  );
  const { data: poLinesRaw, isLoading: linesLoading } = useCollection<POLine>(linesQuery as any);

  const poLines = useMemo(() => {
    const list = (poLinesRaw ?? []).filter((l) => l.status !== 'cancelled');
    const label = (pid: string) => positionLabels[pid] || pid;
    return [...list].sort((a, b) => label(a.positionId).localeCompare(label(b.positionId), locale === 'th' ? 'th' : 'en'));
  }, [poLinesRaw, positionLabels, locale]);

  if (userLoading || !currentUser) {
    return (
      <p className="text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        …
      </p>
    );
  }

  if (!canAccessPortal) {
    return (
      <p className="text-sm text-muted-foreground">{locale === 'en' ? 'Customer portal only.' : 'เฉพาะบัญชีลูกค้า'}</p>
    );
  }

  if (po === undefined) {
    return (
      <p className="text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        …
      </p>
    );
  }

  if (!po) {
    return (
      <p className="text-sm text-muted-foreground">{locale === 'en' ? 'Purchase order not found.' : 'ไม่พบใบสั่งซื้อ'}</p>
    );
  }

  const customerPo = formatCustomerPoNumberForPortal(po, po.id);
  const nf = locale === 'th' ? 'th-TH' : 'en-US';

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" className="gap-1 px-0" asChild>
        <Link href="/client-portal/contracts">
          <ChevronLeft className="h-4 w-4" />
          {t('contractsPoDetailBack')}
        </Link>
      </Button>

      <Card>
        <CardHeader className="border-b bg-muted/30">
          <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
            <FileText className="h-5 w-5 text-primary" />
            {t('contractsPoDetailTitle')}
            <Badge variant="secondary" className="font-mono text-xs">
              {po.poCode || po.id}
            </Badge>
            <Badge variant="outline">{po.status}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-6 text-sm">
          <div className="grid gap-1 sm:grid-cols-[140px_1fr] sm:gap-x-4">
            <span className="text-muted-foreground">{t('contractsColCustomerPo')}</span>
            <span className="font-mono font-medium">{customerPo}</span>
            <span className="text-muted-foreground">{t('poCode')}</span>
            <span className="font-mono">{po.poCode || '—'}</span>
            <span className="text-muted-foreground">{t('contractsPoDetailProject')}</span>
            <span>{po.projectName?.trim() || po.title?.trim() || '—'}</span>
            <span className="text-muted-foreground">{t('poPeriod')}</span>
            <span>{formatStoredDateRangeThaiBE(po.startDate, po.endDate)}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b bg-muted/20 py-3">
          <CardTitle className="text-base">{t('contractsPoLinesHeading')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {linesLoading ? (
            <p className="p-6 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              …
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="pl-4">{t('contractsPoLineColPosition')}</TableHead>
                  <TableHead>{t('contractsPoLineColLocation')}</TableHead>
                  <TableHead className="text-center w-[88px]">{t('contractsPoLineColQuota')}</TableHead>
                  <TableHead className="text-right pr-4">{t('contractsPoLineColPrice')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {poLines.map((line) => {
                  const posName = positionLabels[line.positionId] || line.positionId;
                  const unit = (line.billingUnitSnapshot || '').trim();
                  return (
                    <TableRow key={line.id}>
                      <TableCell className="pl-4 align-top">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-semibold text-foreground">{posName}</span>
                          <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                            <Calendar className="h-3 w-3 shrink-0" />
                            {formatDateRangeThaiBE(line.startDate, line.endDate)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="align-top text-muted-foreground">
                        {(line.workLocation || '').trim() || '—'}
                      </TableCell>
                      <TableCell className="text-center align-top font-semibold tabular-nums">{line.quantity}</TableCell>
                      <TableCell className="text-right align-top pr-4">
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="font-bold text-emerald-800 dark:text-emerald-400">
                            ฿{Number(line.sellRateSnapshot ?? 0).toLocaleString(nf)}
                          </span>
                          {unit ? (
                            <span className="text-[10px] uppercase text-muted-foreground">
                              {locale === 'en' ? 'per ' : ''}
                              {unit}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {poLines.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                      {locale === 'en' ? 'No line items on this purchase order.' : 'ไม่มีรายการบรรทัดในใบสั่งซื้อนี้'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
