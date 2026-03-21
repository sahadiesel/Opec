
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

/**
 * Legacy Worker Payroll Entry Point.
 * Automatically redirects to the new canonical settlement route (Payroll Batches).
 */
export default function LegacyPayrollPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/payroll/batches');
  }, [router]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen space-y-4">
      <Loader2 className="h-12 w-12 text-primary animate-spin" />
      <p className="text-muted-foreground font-medium">Redirecting to Payroll Batches...</p>
    </div>
  );
}
