'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Printer, ChevronRight, FileBarChart } from 'lucide-react';
import type { TaxInvoice, CommercialInvoice, AccountsReceivable } from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where, orderBy } from 'firebase/firestore';
import { isClient } from '@/lib/permissions';
import { usePortalLocale } from '@/contexts/portal-locale-context';
import { formatStoredDateThaiBE } from '@/lib/date-thai';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAppUser } from '@/hooks/use-app-user';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type MainTab = 'invoices' | 'paid';

/** แถวชำระแล้ว — จากลูกหนี้การค้า (ไม่ใช้ collection ใบเสร็จรับเงินแยก) */
type PaidEvidenceRow = {
  arId: string;
  referenceDate: string;
  documentNo: string;
  amount: number;
  statusLabel: string;
  primaryTaxInvoiceId?: string;
};

type HubRow = { kind: 'commercial'; inv: CommercialInvoice } | { kind: 'tax'; inv: TaxInvoice };

function TaxInvoiceStatusBadge({ inv, en }: { inv: TaxInvoice; en: boolean }) {
  if (inv.status === 'DRAFT') {
    return inv.billingCustomerApprovedAt ? (
      <Badge className="bg-green-600">{en ? 'Confirmed' : 'ยืนยันแล้ว'}</Badge>
    ) : (
      <Badge variant="outline">{en ? 'Pending review' : 'รอตรวจ'}</Badge>
    );
  }
  if (inv.status === 'ISSUED') {
    return <Badge variant="secondary">{en ? 'Issued' : 'ออกแล้ว'}</Badge>;
  }
  if (inv.status === 'CANCELLED') {
    return <Badge variant="destructive">{en ? 'Cancelled' : 'ยกเลิก'}</Badge>;
  }
  return <Badge variant="outline">{inv.status}</Badge>;
}

export function AccountingContent() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { locale, t } = usePortalLocale();
  const router = useRouter();
  const searchParams = useSearchParams();

  const rawTab = searchParams.get('tab');
  const mainTab: MainTab = rawTab === 'paid' ? 'paid' : 'invoices';

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'drafts' || tab === 'billing') {
      const p = new URLSearchParams(searchParams.toString());
      p.set('tab', 'invoices');
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

  const arQ = useMemoFirebase(() => {
    if (!firestore || !currentUser?.customerId) return null;
    return query(collection(firestore, 'accounts_receivable'), where('customerId', '==', currentUser.customerId));
  }, [firestore, currentUser?.customerId]);
  const { data: arItems, isLoading: arLoad } = useCollection<AccountsReceivable>(arQ as any);

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

  const invoiceHubRows = useMemo(() => {
    const rows: HubRow[] = [];
    for (const inv of commercialForPortal) {
      rows.push({ kind: 'commercial', inv });
    }
    for (const inv of invoices ?? []) {
      if (inv.status === 'CANCELLED') continue;
      rows.push({ kind: 'tax', inv });
    }
    rows.sort((a, b) => {
      const da = a.kind === 'commercial' ? a.inv.issueDate : a.inv.issueDate;
      const db = b.kind === 'commercial' ? b.inv.issueDate : b.inv.issueDate;
      return db.localeCompare(da);
    });
    return rows;
  }, [commercialForPortal, invoices]);

  const paidRows = useMemo((): PaidEvidenceRow[] => {
    const list = (arItems ?? []).filter(
      (a) => a.status === 'PAID' || (a.outstandingAmount <= 0 && a.creditAmount > 0),
    );
    const rows: PaidEvidenceRow[] = list.map((a) => ({
      arId: a.id,
      referenceDate: a.issueDate,
      documentNo: a.referenceNo || a.documentNo,
      amount: a.debitAmount,
      statusLabel: a.status,
      primaryTaxInvoiceId: a.referenceType === 'TAX_INVOICE' ? a.referenceId : undefined,
    }));
    rows.sort((x, y) => y.referenceDate.localeCompare(x.referenceDate));
    return rows;
  }, [arItems]);

  const openHubRow = useCallback(
    (row: HubRow) => {
      if (row.kind === 'commercial') {
        router.push(`/client-portal/commercial-invoices/${row.inv.id}`);
        return;
      }
      if (row.inv.status === 'DRAFT') {
        router.push(`/client-portal/draft-invoices/${row.inv.id}`);
        return;
      }
      router.push(`/client-portal/tax-print/${row.inv.id}`);
    },
    [router],
  );

  if (userLoading) {
    return <p className="text-sm text-muted-foreground">…</p>;
  }

  if (!currentUser || !isClient(currentUser)) {
    return <p className="text-sm text-muted-foreground">{locale === 'en' ? 'Portal only.' : 'เฉพาะพอร์ทัล'}</p>;
  }

  const en = locale === 'en';

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
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1">
          <TabsTrigger value="invoices" className="text-xs sm:text-sm">
            {t('accTabInvoices')}
          </TabsTrigger>
          <TabsTrigger value="paid" className="text-xs sm:text-sm">
            {t('accTabPaidDoc')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="invoices" className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">{t('accInvoiceHubLead')}</p>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('accTabInvoices')}</CardTitle>
              <CardDescription>{en ? 'Open a row for detail or print.' : 'กดแถวเพื่อดูรายละเอียดหรือพิมพ์'}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {invLoad || commercialLoad ? (
                <p className="p-6 text-sm">…</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{en ? 'No.' : 'เลขที่'}</TableHead>
                      <TableHead>{en ? 'Date' : 'วันที่'}</TableHead>
                      <TableHead className="text-right">{en ? 'Amount' : 'ยอด'}</TableHead>
                      <TableHead>{en ? 'Status' : 'สถานะ'}</TableHead>
                      <TableHead className="text-right w-14">{t('accColAction')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoiceHubRows.map((row) => {
                      if (row.kind === 'commercial') {
                        const inv = row.inv;
                        return (
                          <TableRow
                            key={`c-${inv.id}`}
                            className="cursor-pointer"
                            onClick={() => openHubRow(row)}
                          >
                            <TableCell className="font-mono font-semibold">{inv.invoiceNo}</TableCell>
                            <TableCell className="text-sm">{formatStoredDateThaiBE(inv.issueDate)}</TableCell>
                            <TableCell className="text-right text-sm">
                              {inv.currency} {inv.totalAmount.toLocaleString()}
                            </TableCell>
                            <TableCell>
                              {inv.status === 'PENDING_CUSTOMER' ? (
                                <Badge variant="outline">{en ? 'Pending review' : 'รอตรวจ'}</Badge>
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
                        );
                      }
                      const inv = row.inv;
                      const href =
                        inv.status === 'DRAFT'
                          ? `/client-portal/draft-invoices/${inv.id}`
                          : `/client-portal/tax-print/${inv.id}`;
                      return (
                        <TableRow
                          key={`t-${inv.id}`}
                          className="cursor-pointer"
                          onClick={() => openHubRow(row)}
                        >
                          <TableCell className="font-mono text-sm font-medium">{inv.taxInvoiceNo}</TableCell>
                          <TableCell className="text-sm">{formatStoredDateThaiBE(inv.issueDate)}</TableCell>
                          <TableCell className="text-right text-sm">
                            {inv.currency} {inv.totalAmount.toLocaleString()}
                          </TableCell>
                          <TableCell>
                            <TaxInvoiceStatusBadge inv={inv} en={en} />
                          </TableCell>
                          <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="icon" asChild>
                              <Link href={href}>
                                <ChevronRight className="h-4 w-4" />
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {invoiceHubRows.length === 0 && (
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

        <TabsContent value="paid" className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">{t('accPaidDocLead')}</p>
          <p className="text-xs text-muted-foreground">{t('printHint')}</p>
          <Card>
            <CardContent className="p-0">
              {arLoad ? (
                <p className="p-6 text-sm">…</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('accPaidColDocNo')}</TableHead>
                      <TableHead>{t('accPaidColPaidOn')}</TableHead>
                      <TableHead>{en ? 'Method' : 'ช่องทาง'}</TableHead>
                      <TableHead className="text-right">{t('accPaidColAmount')}</TableHead>
                      <TableHead className="text-right">{t('accPaidColPrint')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paidRows.map((row) => (
                      <TableRow key={row.arId}>
                        <TableCell className="font-mono text-sm font-medium">{row.documentNo}</TableCell>
                        <TableCell className="text-sm">{formatStoredDateThaiBE(row.referenceDate)}</TableCell>
                        <TableCell className="text-xs uppercase text-muted-foreground">{row.statusLabel}</TableCell>
                        <TableCell className="text-right text-sm font-medium">
                          ฿ {row.amount.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.primaryTaxInvoiceId ? (
                            <Button variant="outline" size="sm" asChild>
                              <Link href={`/client-portal/tax-print/${row.primaryTaxInvoiceId}`}>
                                <Printer className="mr-1 h-3.5 w-3.5" />
                                {t('accPaidPrintBtn')}
                              </Link>
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {paidRows.length === 0 && (
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
