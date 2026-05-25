'use client';

import { AppShell } from '@/components/layout/app-shell';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';
import { PoQuotaQueueCardShell, usePoQuotaQueueRows } from '@/components/ops/po-quota-queue';
import { useMemo } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Info, AlertCircle } from 'lucide-react';

export default function PoActiveQuotaQueuePage() {
  const { currentUser, isLoading: userLoading } = useAppUser();

  const canSee = useMemo(
    () => !!currentUser && (canView(currentUser, 'waves') || canView(currentUser, 'assignments')),
    [currentUser],
  );

  const { queueRows, customers, allPositions, loading, loadError } = usePoQuotaQueueRows(canSee);

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
          <AlertTitle>คิวมอบหมายจาก PO Active</AlertTitle>
          <AlertDescription className="text-sm">
            แต่ละแถวคือ <strong className="font-semibold text-foreground">หนึ่งชุด PO Active</strong> (ลูกค้า + Onshore/Offshore)
            — โควต้ารวมจากทุก Customer PO ในชุดเดียวกัน มีปุ่มมอบหมายหนึ่งปุ่มต่อชุด ตารางย่อยแยกตาม PO แต่ละใบ
            (สายสัญญาที่สัญญาหลักยัง active — แสดงครบทุกชุดที่มีบรรทัดโควต้า แม้เต็มแล้ว เพื่อเข้าไปจัดการมอบหมายต่อ)
          </AlertDescription>
        </Alert>

        {loadError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>โหลดข้อมูล PO Active ไม่สำเร็จ</AlertTitle>
            <AlertDescription className="text-sm">{loadError}</AlertDescription>
          </Alert>
        )}

        <PoQuotaQueueCardShell
          queueRows={queueRows}
          customers={customers}
          allPositions={allPositions}
          loading={loading}
        />
      </div>
    </AppShell>
  );
}
