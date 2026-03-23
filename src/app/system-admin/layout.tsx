'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAppUser } from '@/hooks/use-app-user';
import { isSystemAdmin } from '@/lib/permission-core';

/**
 * All /system-admin/* routes: system administrators only.
 */
export default function SystemAdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { currentUser, isLoading } = useAppUser();

  useEffect(() => {
    if (isLoading) return;
    if (!currentUser || !isSystemAdmin(currentUser)) {
      router.replace('/');
    }
  }, [currentUser, isLoading, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground text-sm">
        กำลังตรวจสอบสิทธิ์…
      </div>
    );
  }

  if (!currentUser || !isSystemAdmin(currentUser)) {
    return null;
  }

  return <>{children}</>;
}
