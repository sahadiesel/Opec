'use client';

import Link from 'next/link';
import { ChevronRight, FileSignature } from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where, orderBy } from 'firebase/firestore';
import type { Quotation } from '@/lib/types';
import { QUOTATION_PORTAL_VISIBLE_STATUSES } from '@/lib/types';
import { useClientPortalIdentity } from '@/contexts/client-portal-user-context';
import { usePortalLocale } from '@/contexts/portal-locale-context';
import { formatStoredDateThaiBE } from '@/lib/date-thai';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { PortalDictKey } from '@/lib/i18n/client-portal-dictionary';

function statusBadge(q: Quotation, en: boolean, t: (key: PortalDictKey) => string) {
  if (q.status === 'sent' && q.customerRevisionRequestedAt) {
    return <Badge className="bg-violet-700">{t('qtnStatusNegotiating')}</Badge>;
  }
  if (q.status === 'sent') {
    return (
      <Badge className="bg-amber-600">{en ? 'Awaiting approval' : 'รออนุมัติ'}</Badge>
    );
  }
  if (q.status === 'accepted') {
    return <Badge className="bg-green-700">{en ? 'Accepted' : 'รับแล้ว'}</Badge>;
  }
  if (q.status === 'rejected') {
    return <Badge variant="destructive">{en ? 'Rejected' : 'ไม่รับ'}</Badge>;
  }
  return <Badge variant="outline">{q.status}</Badge>;
}

export default function ClientPortalQuotationsListPage() {
  const { effectiveUser: currentUser, appUserLoading: isLoading, canAccessPortal } = useClientPortalIdentity();
  const firestore = useFirestore();
  const { locale, t } = usePortalLocale();
  const en = locale === 'en';

  const listQuery = useMemoFirebase(() => {
    if (!firestore || !currentUser?.customerId) return null;
    return query(
      collection(firestore, 'quotations'),
      where('customerId', '==', currentUser.customerId),
      where('status', 'in', QUOTATION_PORTAL_VISIBLE_STATUSES),
      orderBy('createdAt', 'desc'),
    );
  }, [firestore, currentUser?.customerId]);

  const { data: rows, isLoading: loading } = useCollection<Quotation>(listQuery as any);

  if (isLoading || !currentUser || !canAccessPortal) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <FileSignature className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-2xl">
            {t('qtnListTitle')}
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            {t('quotationsLead')}
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/40">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-semibold">{t('qtnColNo')}</TableHead>
              <TableHead className="font-semibold">{t('qtnColDate')}</TableHead>
              <TableHead className="font-semibold">{t('qtnColProject')}</TableHead>
              <TableHead className="text-right font-semibold">{t('qtnColTotal')}</TableHead>
              <TableHead className="font-semibold">{t('qtnColStatus')}</TableHead>
              <TableHead className="w-12 text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  …
                </TableCell>
              </TableRow>
            ) : (rows ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  {t('noData')}
                </TableCell>
              </TableRow>
            ) : (
              (rows ?? []).map((q) => (
                <TableRow key={q.id} className="hover:bg-muted/40">
                  <TableCell className="font-mono text-sm font-medium">{q.quotationNo}</TableCell>
                  <TableCell className="text-sm">{formatStoredDateThaiBE(q.issueDate)}</TableCell>
                  <TableCell className="max-w-[200px] truncate text-sm">{q.projectTitle || '—'}</TableCell>
                  <TableCell className="text-right text-sm font-medium">
                    {q.currency}{' '}
                    {q.grandTotal.toLocaleString(en ? 'en-GB' : 'th-TH', { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell>{statusBadge(q, en, t)}</TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/client-portal/quotations/${q.id}`}
                      className="inline-flex items-center justify-center rounded-lg p-2 text-primary hover:bg-primary/10"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
