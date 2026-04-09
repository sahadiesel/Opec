'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Receipt, FileBadge, Printer } from 'lucide-react';
import type { TaxInvoice, Receipt as ReceiptDoc, User } from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where, orderBy } from 'firebase/firestore';
import { isClient } from '@/lib/permissions';
import { usePortalLocale } from '@/contexts/portal-locale-context';
import { formatStoredDateThaiBE } from '@/lib/date-thai';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export default function ClientInvoicesReceiptsPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  useUser();
  const firestore = useFirestore();
  const { locale, t } = usePortalLocale();

  useEffect(() => {
    const raw = localStorage.getItem('opsflow_user');
    if (raw) setCurrentUser(JSON.parse(raw));
  }, []);

  const invQ = useMemoFirebase(() => {
    if (!firestore || !currentUser?.customerId) return null;
    return query(
      collection(firestore, 'tax_invoices'),
      where('customerId', '==', currentUser.customerId),
      orderBy('issueDate', 'desc')
    );
  }, [firestore, currentUser?.customerId]);
  const { data: invoices, isLoading: invLoad } = useCollection<TaxInvoice>(invQ as any);

  const recQ = useMemoFirebase(() => {
    if (!firestore || !currentUser?.customerId) return null;
    return query(
      collection(firestore, 'receipts'),
      where('customerId', '==', currentUser.customerId),
      orderBy('receiptDate', 'desc')
    );
  }, [firestore, currentUser?.customerId]);
  const { data: receipts, isLoading: recLoad } = useCollection<ReceiptDoc>(recQ as any);

  const issued = useMemo(
    () => (invoices ?? []).filter((i) => i.status === 'ISSUED' || i.status === 'CANCELLED'),
    [invoices]
  );

  if (!currentUser || !isClient(currentUser)) {
    return <p className="text-sm text-muted-foreground">Portal only.</p>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-primary flex items-center gap-2">
          <FileBadge className="h-6 w-6" />
          {locale === 'en' ? 'Tax invoices & receipts' : 'ใบกำกับภาษี / ใบเสร็จ'}
        </h2>
        <p className="text-sm text-muted-foreground">{t('printHint')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileBadge className="h-4 w-4" /> {locale === 'en' ? 'Tax invoices' : 'ใบกำกับภาษี'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {invLoad ? (
            <p className="p-6 text-sm">…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No.</TableHead>
                  <TableHead>{locale === 'en' ? 'Date' : 'วันที่'}</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right w-28">Print</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {issued.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono text-sm">{inv.taxInvoiceNo}</TableCell>
                    <TableCell className="text-sm">{formatStoredDateThaiBE(inv.issueDate)}</TableCell>
                    <TableCell className="text-right text-sm">
                      {inv.currency} {inv.totalAmount.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{inv.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/client-portal/tax-print/${inv.id}`}>
                          <Printer className="h-3.5 w-3.5 mr-1" />
                          PDF / Print
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {issued.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      —
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
          <CardTitle className="text-base flex items-center gap-2">
            <Receipt className="h-4 w-4" /> {locale === 'en' ? 'Receipts' : 'ใบเสร็จรับเงิน'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {recLoad ? (
            <p className="p-6 text-sm">…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No.</TableHead>
                  <TableHead>{locale === 'en' ? 'Date' : 'วันที่'}</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right w-28">Print</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(receipts ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-sm">{r.receiptNo}</TableCell>
                    <TableCell className="text-sm">{formatStoredDateThaiBE(r.receiptDate)}</TableCell>
                    <TableCell className="text-right text-sm">
                      THB {r.receivedAmount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/client-portal/receipt-print/${r.id}`}>
                          <Printer className="h-3.5 w-3.5 mr-1" />
                          PDF / Print
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {(!receipts || receipts.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      —
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
