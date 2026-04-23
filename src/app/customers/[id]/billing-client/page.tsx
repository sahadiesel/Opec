'use client';

import { use, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';
import { useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import { Loader2 } from 'lucide-react';
import type { Customer } from '@/lib/types';
import { BillingClientScopeContent } from '@/components/billing/billing-client-scope-content';

export default function CustomerBillingClientScopePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: customerId } = use(params);
  const { currentUser } = useAppUser();

  const canViewPage = useMemo(() => canView(currentUser, 'customers'), [currentUser]);
  const firestore = useFirestore();

  const custRef = useMemoFirebase(
    () => (firestore && canViewPage ? doc(firestore, 'customers', customerId) : null),
    [firestore, customerId, canViewPage],
  );
  const { data: customer, isLoading: isCustLoading } = useDoc<Customer>(custRef as any);

  if (!currentUser) {
    return null;
  }

  if (!canViewPage) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="max-w-3xl mx-auto py-10 text-center text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงรายงานนี้</div>
      </AppShell>
    );
  }

  if (isCustLoading || !customer) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex items-center justify-center min-h-[40vh]">
          <Loader2 className="h-10 w-10 text-primary animate-spin" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <BillingClientScopeContent
        customerId={customerId}
        customerNameOverride={customer.name}
        backButton={{ href: `/customers/${customerId}`, 'aria-label': 'กลับหน้าลูกค้า' }}
      />
    </AppShell>
  );
}
