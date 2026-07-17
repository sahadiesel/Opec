'use client';

import Link from 'next/link';
import { ArrowLeft, HandCoins } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';

export default function CompensationContractPage() {
  const { currentUser, isLoading } = useAppUser();
  if (isLoading || !currentUser) return null;
  if (!canView(currentUser, 'accounts_payable')) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="py-16 text-center text-muted-foreground">ไม่มีสิทธิ์เข้าถึง</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/accounting/contracts"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
              <HandCoins className="h-8 w-8" /> 2. สัญญาจ่ายเงินตอบแทน
            </h1>
            <p className="mt-1 text-muted-foreground">ประเภทสัญญานี้แยกจากสัญญาเช่า — อยู่ระหว่างเตรียมฟอร์มและ workflow</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>ยังไม่เปิดใช้งาน</CardTitle>
            <CardDescription>
              เมื่อพร้อมใช้งาน จะสามารถสร้างสัญญาจ่ายเงินตอบแทน กำหนดงวดจ่าย และเชื่อมกับระบบเจ้าหนี้ได้จากหน้านี้
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" asChild>
              <Link href="/accounting/contracts">กลับไปเลือกประเภทสัญญา</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
