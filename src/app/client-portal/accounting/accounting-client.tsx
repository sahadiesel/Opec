'use client';

import { useCallback, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronRight, FileBarChart, Receipt } from 'lucide-react';
import type { TaxInvoice, CommercialInvoice, MoneyReceipt } from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where, orderBy } from 'firebase/firestore';
import { isClient } from '@/lib/permissions';
import { usePortalLocale } from '@/contexts/portal-locale-context';
import type { PortalDictKey } from '@/lib/i18n/client-portal-dictionary';
import { formatStoredDateThaiBE } from '@/lib/date-thai';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAppUser } from '@/hooks/use-app-user';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type MainTab = 'invoices' | 'tax' | 'receipts';

function TaxInvoiceStatusBadge({ inv, t, en }: { inv: TaxInvoice; t: (k: PortalDictKey) => string; en: boolean }) {
  if (inv.status === 'ISSUED') {
    if (inv.linkedReceiptId) {
      return <Badge className="bg-slate-700">{t('accTaxIssuedBadgeReceipt')}</Badge>;
    }
    if (inv.paymentNotifiedAt) {
      return <Badge className="bg-amber-700">{t('ciStatusPayReported')}</Badge>;
    }
    return <Badge className="bg-emerald-800">{t('accTaxIssuedBadgeAwait')}</Badge>;
  }
  if (inv.status === 'CANCELLED') {
    return <Badge variant="destructive">{en ? 'Cancelled' : 'ยกเลิก'}</Badge>;
  }
  return <Badge variant="outline">{inv.status}</Badge>;
}

function TaxInvoiceRowActions({
  inv,
  t,
  isApprover,
}: {
  inv: TaxInvoice;
  t: (k: PortalDictKey) => string;
  isApprover: boolean;
}) {
  const href = `/client-portal/tax-print/${inv.id}`;
  const canReportPayment =
    inv.status === 'ISSUED' && !inv.paymentNotifiedAt && !inv.linkedReceiptId && isApprover;

  return (
    <TableCell className="min-w-[10.5rem] text-right align-middle" onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {canReportPayment && (
          <Button size="sm" variant="default" asChild>
            <Link href={href}>{t('accTaxActPayAttach')}</Link>
          </Button>
        )}
        {!canReportPayment && inv.status === 'ISSUED' && (
          <Button size="sm" variant="outline" asChild>
            <Link href={href} className="inline-flex items-center gap-1">
              {t('open')}
              <ChevronRight className="h-3.5 w-3.5 opacity-80" />
            </Link>
          </Button>
        )}
      </div>
    </TableCell>
  );
}

export function AccountingContent() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { locale, t } = usePortalLocale();
  const router = useRouter();
  const searchParams = useSearchParams();

  const rawTab = searchParams.get('tab');
  const mainTab: MainTab =
    rawTab === 'tax' ? 'tax' : rawTab === 'receipts' || rawTab === 'paid' ? 'receipts' : 'invoices';

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'drafts' || tab === 'billing') {
      const p = new URLSearchParams(searchParams.toString());
      p.set('tab', 'invoices');
      router.replace(`/client-portal/accounting?${p.toString()}`, { scroll: false });
    }
    if (tab === 'paid') {
      const p = new URLSearchParams(searchParams.toString());
      p.set('tab', 'receipts');
      router.replace(`/client-portal/accounting?${p.toString()}`, { scroll: false });
    }
  }, [searchParams, router]);

  const setMainTab = useCallback(
    (next: MainTab) => {
      const p = new URLSearchParams(searchParams.toString());
      p.set('tab', next);
      router.replace(`/client-portal/accounting?${p.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const invQ = useMemoFirebase(() => {
    if (!firestore || !currentUser?.customerId) return null;
    return query(
      collection(firestore, 'tax_invoices'),
      where('customerId', '==', currentUser.customerId),
      orderBy('issueDate', 'desc'),
    );
  }, [firestore, currentUser?.customerId]);

  const { data: invoices, isLoading: invLoad } = useCollection<TaxInvoice>(invQ as any);

  const commercialQ = useMemoFirebase(() => {
    if (!firestore || !currentUser?.customerId) return null;
    return query(
      collection(firestore, 'commercial_invoices'),
      where('customerId', '==', currentUser.customerId),
      where('status', 'in', ['PENDING_CUSTOMER', 'ISSUED', 'VOID']),
      orderBy('issueDate', 'desc'),
    );
  }, [firestore, currentUser?.customerId]);
  const { data: commercialInvoices, isLoading: commercialLoad } = useCollection<CommercialInvoice>(commercialQ as any);

  const commercialForPortal = commercialInvoices ?? [];

  const taxList = useMemo(() => {
    return [...(invoices ?? [])]
      .filter((i) => i.status === 'ISSUED')
      .sort((a, b) => b.issueDate.localeCompare(a.issueDate));
  }, [invoices]);

  const receiptQ = useMemoFirebase(() => {
    if (!firestore || !currentUser?.customerId) return null;
    return query(
      collection(firestore, 'receipts'),
      where('customerId', '==', currentUser.customerId),
      orderBy('receiptDate', 'desc'),
    );
  }, [firestore, currentUser?.customerId]);
  const { data: moneyReceipts, isLoading: receiptLoad } = useCollection<MoneyReceipt>(receiptQ as any);

  const openCommercial = useCallback(
    (inv: CommercialInvoice) => {
      router.push(`/client-portal/commercial-invoices/${inv.id}`);
    },
    [router],
  );

  const openTax = useCallback((inv: TaxInvoice) => {
    if (inv.status === 'ISSUED') router.push(`/client-portal/tax-print/${inv.id}`);
  }, [router]);

  if (userLoading) {
    return <p className="text-sm text-muted-foreground">…</p>;
  }

  if (!currentUser || !isClient(currentUser)) {
    return <p className="text-sm text-muted-foreground">{locale === 'en' ? 'Portal only.' : 'เฉพาะพอร์ทัล'}</p>;
  }

  const en = locale === 'en';
  const isApprover = currentUser.portalRole === 'approver';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold text-primary">
          <FileBarChart className="h-6 w-6" />
          {t('accounting')}
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{t('accountingLead')}</p>
        <p className="mt-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm leading-relaxed text-foreground/90">
          {t('accountingWorkflowInfo')}
        </p>
      </div>

      <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as MainTab)} className="w-full">
        <TabsList className="grid h-auto w-full grid-cols-3 gap-1 p-1">
          <TabsTrigger value="invoices" className="text-xs sm:text-sm">
            {t('accTabInvoices')}
          </TabsTrigger>
          <TabsTrigger value="tax" className="text-xs sm:text-sm">
            {t('accTabTaxInvoices')}
          </TabsTrigger>
          <TabsTrigger value="receipts" className="text-xs sm:text-sm">
            {t('accTabMoneyReceipts')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="invoices" className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">{t('accInvoiceHubLead')}</p>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('accTabInvoices')}</CardTitle>
              <CardDescription>{t('accCommercialOnlyLead')}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {commercialLoad ? (
                <p className="p-6 text-sm">…</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{en ? 'No.' : 'เลขที่'}</TableHead>
                      <TableHead>{en ? 'Date' : 'วันที่'}</TableHead>
                      <TableHead className="text-right">{en ? 'Amount' : 'ยอด'}</TableHead>
                      <TableHead>{en ? 'Status' : 'สถานะ'}</TableHead>
                      <TableHead className="w-14 text-right">{t('accColAction')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {commercialForPortal.map((inv) => (
                      <TableRow
                        key={inv.id}
                        className="cursor-pointer"
                        onClick={() => openCommercial(inv)}
                      >
                        <TableCell className="font-mono font-semibold">{inv.invoiceNo}</TableCell>
                        <TableCell className="text-sm">{formatStoredDateThaiBE(inv.issueDate)}</TableCell>
                        <TableCell className="text-right text-sm">
                          {inv.currency} {inv.totalAmount.toLocaleString()}
                        </TableCell>
                        <TableCell>
                          {inv.status === 'PENDING_CUSTOMER' ? (
                            inv.customerRevisionRequestedAt ? (
                              <Badge className="bg-orange-700">{en ? 'Revision requested' : 'ร้องขอแก้ไข'}</Badge>
                            ) : (
                              <Badge variant="outline">{en ? 'Pending review' : 'รอตรวจ'}</Badge>
                            )
                          ) : inv.status === 'VOID' ? (
                            <Badge variant="secondary">{en ? 'Void' : 'ยกเลิก'}</Badge>
                          ) : inv.opecPaymentVerifiedAt ? (
                            <Badge className="bg-slate-700">{t('ciStatusOpecDone')}</Badge>
                          ) : inv.customerPaymentReportedAt ? (
                            <Badge className="bg-amber-700">{t('ciStatusPayReported')}</Badge>
                          ) : (
                            <Badge className="bg-emerald-800">{t('ciStatusAwaitingPayment')}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" asChild>
                            <Link href={`/client-portal/commercial-invoices/${inv.id}`}>
                              <ChevronRight className="h-4 w-4" />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {commercialForPortal.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                          {t('noData')}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tax" className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">{t('accTaxTabLead')}</p>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('accTabTaxInvoices')}</CardTitle>
              <CardDescription>{t('accTaxAfterIssued')}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {invLoad ? (
                <p className="p-6 text-sm">…</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{en ? 'No.' : 'เลขที่'}</TableHead>
                      <TableHead>{en ? 'Date' : 'วันที่'}</TableHead>
                      <TableHead className="text-right">{en ? 'Amount' : 'ยอด'}</TableHead>
                      <TableHead>{en ? 'Status' : 'สถานะ'}</TableHead>
                      <TableHead className="min-w-[11rem] text-right align-middle">{t('accColAction')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {taxList.map((inv) => {
                      return (
                        <TableRow key={inv.id} className="cursor-pointer" onClick={() => openTax(inv)}>
                          <TableCell className="font-mono text-sm font-medium">{inv.taxInvoiceNo}</TableCell>
                          <TableCell className="text-sm">{formatStoredDateThaiBE(inv.issueDate)}</TableCell>
                          <TableCell className="text-right text-sm">
                            {inv.currency} {inv.totalAmount.toLocaleString()}
                          </TableCell>
                          <TableCell>
                            <TaxInvoiceStatusBadge inv={inv} t={t} en={en} />
                          </TableCell>
                          <TaxInvoiceRowActions inv={inv} t={t} isApprover={isApprover} />
                        </TableRow>
                      );
                    })}
                    {taxList.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                          {t('noData')}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="receipts" className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">{t('accMoneyReceiptsLead')}</p>
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Receipt className="h-4 w-4" />
                {t('accTabMoneyReceipts')}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {receiptLoad ? (
                <p className="p-6 text-sm">…</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('receiptNoCol')}</TableHead>
                      <TableHead>{t('receiptRefTax')}</TableHead>
                      <TableHead>{t('receiptDateCol')}</TableHead>
                      <TableHead className="text-right">{en ? 'Amount' : 'ยอด'}</TableHead>
                      <TableHead className="w-14 text-right">{t('accColAction')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(moneyReceipts ?? []).map((r) => (
                      <TableRow
                        key={r.id}
                        className="cursor-pointer"
                        onClick={() => router.push(`/client-portal/receipt-print/${r.id}`)}
                      >
                        <TableCell className="font-mono text-sm font-medium">{r.receiptNo}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{r.taxInvoiceNo}</TableCell>
                        <TableCell className="text-sm">{formatStoredDateThaiBE(r.receiptDate)}</TableCell>
                        <TableCell className="text-right text-sm">
                          {r.currency} {r.amount.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" asChild>
                            <Link href={`/client-portal/receipt-print/${r.id}`}>
                              <ChevronRight className="h-4 w-4" />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {(moneyReceipts?.length ?? 0) === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                          {t('noData')}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
