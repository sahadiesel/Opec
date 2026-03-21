'use client';

import { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';

/**
 * Legacy Worker Payroll Detail Redirect.
 * Automatically redirects to the new canonical settlement route (Payroll Batch Detail).
 */
export default function LegacyPayrollDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;

  useEffect(() => {
    if (id) {
      router.replace(`/payroll/batches/${id}`);
    } else {
      router.replace('/payroll/batches');
    }
  }, [router, id]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen space-y-4">
      <Loader2 className="h-12 w-12 text-primary animate-spin" />
      <p className="text-muted-foreground font-medium">Redirecting to Payroll Batch detail...</p>
    </div>
  );
}