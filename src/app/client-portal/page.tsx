
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

/**
 * Client Portal Entry Point.
 * Redirects to the Dashboard landing page for a view-centric experience.
 */
export default function ClientPortalEntryPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/client-portal/dashboard');
  }, [router]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen space-y-4">
      <Loader2 className="h-12 w-12 text-primary animate-spin" />
      <p className="text-muted-foreground font-medium">Loading Project Portal...</p>
    </div>
  );
}
