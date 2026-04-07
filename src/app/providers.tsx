'use client';

import '@/firebase/install-dev-firestore-log-filter';
import type { ReactNode } from 'react';
import { Toaster } from '@/components/ui/toaster';
import { FirebaseClientProvider } from '@/firebase/client-provider';
import { FixStuckUI } from '@/components/FixStuckUI';

export default function AppProviders({ children }: { children: ReactNode }) {
  return (
    <FirebaseClientProvider>
      <FixStuckUI />
      {children}
      <Toaster />
    </FirebaseClientProvider>
  );
}
