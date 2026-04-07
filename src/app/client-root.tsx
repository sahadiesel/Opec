'use client';

import type { ReactNode } from 'react';
import AppProviders from './providers';

/** Client boundary สำหรับ Firebase + toaster — ห้ามใช้ `dynamic(..., { ssr: false })` ใน `layout.tsx` (Server Component) */
export function ClientRoot({ children }: { children: ReactNode }) {
  return <AppProviders>{children}</AppProviders>;
}
