import { Suspense } from 'react';
import { AccountingContent } from './accounting-client';

export default function ClientAccountingPage() {
  return (
    <Suspense
      fallback={<p className="text-sm text-muted-foreground">…</p>}
    >
      <AccountingContent />
    </Suspense>
  );
}
