'use client';

import { useAppUser } from '@/hooks/use-app-user';
import { isSystemAdmin, isExecutiveViewer } from '@/lib/permission-core';

/**
 * All /system-admin/* routes: system administrators and executive viewers (read-only).
 */
export default function SystemAdminLayout({ children }: { children: React.ReactNode }) {
  const { currentUser, isLoading } = useAppUser();

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground text-sm">
        กำลังตรวจสอบสิทธิ์…
      </div>
    );
  }

  if (!currentUser || (!isSystemAdmin(currentUser) && !isExecutiveViewer(currentUser))) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground text-sm">
        คุณไม่มีสิทธิ์เข้าถึงเมนูผู้ดูแลระบบ
      </div>
    );
  }

  return <>{children}</>;
}
