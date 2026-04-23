'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { collection } from 'firebase/firestore';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';
import { Building2, ExternalLink, Loader2 } from 'lucide-react';
import type { Customer } from '@/lib/types';
import { BillingClientScopeContent } from '@/components/billing/billing-client-scope-content';

export default function BillingClientPage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();

  const canViewPage = useMemo(() => canView(currentUser, 'customers'), [currentUser]);

  const [customerId, setCustomerId] = useState('');

  const customersQuery = useMemoFirebase(
    () => (firestore && canViewPage ? collection(firestore, 'customers') : null),
    [firestore, canViewPage],
  );
  const { data: customers, isLoading: isCustomersLoading } = useCollection<Customer>(customersQuery as any);

  const customersSorted = useMemo(() => {
    const list = customers ?? [];
    return [...list].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'th', { sensitivity: 'base' }));
  }, [customers]);

  if (!currentUser && !userLoading) {
    return null;
  }

  if (userLoading || isCustomersLoading) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex items-center justify-center min-h-[40vh]">
          <Loader2 className="h-10 w-10 text-primary animate-spin" />
        </div>
      </AppShell>
    );
  }

  if (!canViewPage) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="max-w-3xl mx-auto py-10 text-center text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงรายงานนี้</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser!} onLogout={() => {}}>
      <div className="space-y-4">
        <Card className="max-w-6xl mx-auto">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              เลือกลูกค้า
            </CardTitle>
            <CardDescription>
              สรุปฐานวางบิลตาม <strong>ลูกค้า + งวด</strong> — รวม timesheet ทุก wave ต่อ PO (
              <Link href="/draft-invoices" className="text-primary underline inline-flex items-center gap-0.5">
                ออกเอกสาร
                <ExternalLink className="h-3 w-3" />
              </Link>
              )
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col sm:flex-row gap-4 sm:items-end max-w-xl">
            <div className="space-y-2 flex-1 min-w-[200px]">
              <Label>ลูกค้า (Client)</Label>
              <Select
                value={customerId || '__none__'}
                onValueChange={(v) => setCustomerId(v === '__none__' ? '' : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="— เลือกลูกค้า —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— เลือกลูกค้า —</SelectItem>
                  {customersSorted.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name || c.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {customerId ? (
              <Button variant="outline" asChild>
                <Link href={`/customers/${customerId}`} className="gap-1.5">
                  โปรไฟล์ลูกค้า
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>

        <BillingClientScopeContent customerId={customerId} />
      </div>
    </AppShell>
  );
}
