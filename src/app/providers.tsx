'use client';

import './install-extension-error-guard';
import '@/firebase/install-dev-firestore-log-filter';
import type { ReactNode } from 'react';
import { Toaster } from '@/components/ui/toaster';
import { FirebaseClientProvider } from '@/firebase/client-provider';
import { FixStuckUI } from '@/components/FixStuckUI';
import { MutationAccessProvider } from '@/contexts/mutation-access-context';

export default function AppProviders({ children }: { children: ReactNode }) {
  return (
    <FirebaseClientProvider>
      <MutationAccessProvider>
        <FixStuckUI />
        {children}
        <Toaster />
      </MutationAccessProvider>
    </FirebaseClientProvider>
  );
}
