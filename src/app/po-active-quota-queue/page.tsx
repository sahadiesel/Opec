'use client';

import { AppShell } from '@/components/layout/app-shell';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';
import { PoQuotaQueueCardShell, usePoQuotaQueueRows } from '@/components/ops/po-quota-queue';
import { useMemo } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Info } from 'lucide-react';

export default function PoActiveQuotaQueuePage() {
  const { currentUser, isLoading: userLoading } = useAppUser();

  const canSee = useMemo(
    () => !!currentUser && (canView(currentUser, 'waves') || canView(currentUser, 'assignments')),
    [currentUser],
  );

  const { queueRows, customers, loading } = usePoQuotaQueueRows(canSee);

  if (userLoading || !currentUser) {
    return null;
  }

  if (!canSee) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="p-6 text-muted-foreground">ไม่มีสิทธิ์เข้าหน้านี้</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 p-4 md:p-6 max-w-[100rem] mx-auto">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>ข้อมูลอ่านอย่างเดียว</AlertTitle>
          <AlertDescription className="text-sm">
            สำหรับฝ่ายปฏิบัติการและ HR — ตัวเลขคำนวณจาก PO line, Mobilization และ Wave เหมือนการ์ดสรุปบนหน้า PO
            (เฉพาะ PO สายสัญญา + สัญญาหลัก active) — เปิด PO / Waves / Assign ต่อได้จากคอลัมน์ดำเนินการ
          </AlertDescription>
        </Alert>

        <PoQuotaQueueCardShell queueRows={queueRows} customers={customers} loading={loading} />
      </div>
    </AppShell>
  );
}
