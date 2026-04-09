'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ShoppingCart } from 'lucide-react';
import type { PurchaseOrder, User } from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { CustomerQueryService } from '@/lib/services/customer-query-service';
import { isClient } from '@/lib/permissions';
import { usePortalLocale } from '@/contexts/portal-locale-context';
import { formatStoredDateThaiBE } from '@/lib/date-thai';
import { Badge } from '@/components/ui/badge';

export default function ClientPOsPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  useUser();
  const firestore = useFirestore();
  const { locale } = usePortalLocale();

  useEffect(() => {
    const raw = localStorage.getItem('opsflow_user');
    if (raw) setCurrentUser(JSON.parse(raw));
  }, []);

  const queryService = useMemo(() => (firestore ? new CustomerQueryService(firestore) : null), [firestore]);
  const q = useMemoFirebase(() => queryService?.getScopedPOsQuery(currentUser), [queryService, currentUser]);
  const { data: pos, isLoading } = useCollection<PurchaseOrder>(q as any);

  if (!currentUser || !isClient(currentUser)) {
    return (
      <p className="text-sm text-muted-foreground">{locale === 'en' ? 'Customer portal only.' : 'เฉพาะบัญชีลูกค้า'}</p>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-primary flex items-center gap-2">
          <ShoppingCart className="h-6 w-6" />
          {locale === 'en' ? 'Purchase orders' : 'ใบสั่งซื้อ (PO)'}
        </h2>
        <p className="text-sm text-muted-foreground">
          {locale === 'en' ? 'POs issued under your customer account.' : 'PO ภายใต้บัญชีลูกค้าของท่าน'}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{locale === 'en' ? 'PO list' : 'รายการ PO'}</CardTitle>
          <CardDescription>{locale === 'en' ? 'View only' : 'ดูอย่างเดียว'}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO</TableHead>
                  <TableHead>{locale === 'en' ? 'Project' : 'โครงการ'}</TableHead>
                  <TableHead>{locale === 'en' ? 'Period' : 'ช่วงเวลา'}</TableHead>
                  <TableHead>{locale === 'en' ? 'Status' : 'สถานะ'}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(pos ?? []).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.poCode}</TableCell>
                    <TableCell className="text-sm">{p.projectName || p.title}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatStoredDateThaiBE(p.startDate)} – {formatStoredDateThaiBE(p.endDate)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{p.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {(!pos || pos.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-10 text-muted-foreground">
                      {locale === 'en' ? 'No POs found.' : 'ไม่พบ PO'}
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
