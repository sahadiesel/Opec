'use client';

import { Loader2 } from 'lucide-react';
import { PortalLocaleProvider } from '@/contexts/portal-locale-context';
import { ClientPortalShell } from '@/components/layout/client-portal-shell';
import { useAppUser } from '@/hooks/use-app-user';

export default function ClientPortalLayout({ children }: { children: React.ReactNode }) {
  const { currentUser, isLoading } = useAppUser();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <PortalLocaleProvider>
      <ClientPortalShell user={currentUser}>{children}</ClientPortalShell>
    </PortalLocaleProvider>
  );
}
