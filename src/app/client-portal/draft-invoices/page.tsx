'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FileEdit, ChevronRight } from 'lucide-react';
import type { TaxInvoice, User } from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where, orderBy } from 'firebase/firestore';
import { isClient } from '@/lib/permissions';
import { usePortalLocale } from '@/contexts/portal-locale-context';
import { formatStoredDateThaiBE } from '@/lib/date-thai';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export default function ClientDraftInvoicesPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  useUser();
  const firestore = useFirestore();
  const { locale } = usePortalLocale();
  const router = useRouter();

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

  const { data: invoices, isLoading } = useCollection<TaxInvoice>(invQ as any);

  const drafts = useMemo(() => (invoices ?? []).filter((i) => i.status === 'DRAFT'), [invoices]);

  if (!currentUser || !isClient(currentUser)) {
    return <p className="text-sm text-muted-foreground">Portal only.</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-primary flex items-center gap-2">
          <FileEdit className="h-6 w-6" />
          {locale === 'en' ? 'Draft invoices' : 'ใบแจ้งหนี้ร่าง'}
        </h2>
        <p className="text-sm text-muted-foreground">
          {locale === 'en'
            ? 'Review, approve billing, or request a correction. Approver role required for approval.'
            : 'ตรวจสอบ อนุมัติ billing หรือแจ้งแก้ไข — ต้องเป็นบทบาท Approver จึงกดอนุมัติได้'}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{locale === 'en' ? 'Open drafts' : 'ร่างที่เปิดอยู่'}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm">…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No.</TableHead>
                  <TableHead>{locale === 'en' ? 'Date' : 'วันที่'}</TableHead>
                  <TableHead className="text-right">{locale === 'en' ? 'Amount' : 'ยอด'}</TableHead>
                  <TableHead>{locale === 'en' ? 'Billing approval' : 'อนุมัติ billing'}</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {drafts.map((inv) => (
                  <TableRow
                    key={inv.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/client-portal/draft-invoices/${inv.id}`)}
                  >
                    <TableCell className="font-mono font-semibold">{inv.taxInvoiceNo}</TableCell>
                    <TableCell className="text-sm">{formatStoredDateThaiBE(inv.issueDate)}</TableCell>
                    <TableCell className="text-right text-sm">
                      {inv.currency} {inv.totalAmount.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {inv.billingCustomerApprovedAt ? (
                        <Badge className="bg-green-600">{locale === 'en' ? 'Approved' : 'อนุมัติแล้ว'}</Badge>
                      ) : (
                        <Badge variant="outline">{locale === 'en' ? 'Pending' : 'รอ'}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" asChild>
                        <Link href={`/client-portal/draft-invoices/${inv.id}`}>
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {drafts.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                      {locale === 'en' ? 'No draft invoices.' : 'ไม่มีใบร่าง'}
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
