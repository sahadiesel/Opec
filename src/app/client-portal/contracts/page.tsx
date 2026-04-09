'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FileText } from 'lucide-react';
import type { MainContract, User } from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { CustomerQueryService } from '@/lib/services/customer-query-service';
import { isClient } from '@/lib/permissions';
import { usePortalLocale } from '@/contexts/portal-locale-context';
import { formatStoredDateThaiBE } from '@/lib/date-thai';
import { Badge } from '@/components/ui/badge';

export default function ClientContractsPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  useUser();
  const firestore = useFirestore();
  const { locale } = usePortalLocale();

  useEffect(() => {
    const raw = localStorage.getItem('opsflow_user');
    if (raw) setCurrentUser(JSON.parse(raw));
  }, []);

  const queryService = useMemo(() => (firestore ? new CustomerQueryService(firestore) : null), [firestore]);
  const q = useMemoFirebase(() => queryService?.getScopedContractsQuery(currentUser), [queryService, currentUser]);
  const { data: contracts, isLoading } = useCollection<MainContract>(q as any);

  if (!currentUser || !isClient(currentUser)) {
    return (
      <p className="text-sm text-muted-foreground">
        {locale === 'en' ? 'Customer portal only.' : 'เฉพาะบัญชีลูกค้า'}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-primary flex items-center gap-2">
          <FileText className="h-6 w-6" />
          {locale === 'en' ? 'Your contracts' : 'สัญญาของท่าน'}
        </h2>
        <p className="text-sm text-muted-foreground">
          {locale === 'en' ? 'Main contracts linked to your company.' : 'สัญญาหลักที่ผูกกับบริษัทของท่าน'}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{locale === 'en' ? 'Contract list' : 'รายการสัญญา'}</CardTitle>
          <CardDescription>{locale === 'en' ? 'Read-only' : 'ดูอย่างเดียว'}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{locale === 'en' ? 'Code' : 'รหัส'}</TableHead>
                  <TableHead>{locale === 'en' ? 'Title' : 'ชื่อสัญญา'}</TableHead>
                  <TableHead>{locale === 'en' ? 'Period' : 'ช่วงเวลา'}</TableHead>
                  <TableHead>{locale === 'en' ? 'Status' : 'สถานะ'}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(contracts ?? []).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">{c.contractNumber || c.id}</TableCell>
                    <TableCell className="font-medium">{c.title || '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatStoredDateThaiBE(c.startDate)} – {formatStoredDateThaiBE(c.endDate)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{c.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {(!contracts || contracts.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-10 text-muted-foreground">
                      {locale === 'en' ? 'No contracts found.' : 'ไม่พบสัญญา'}
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
