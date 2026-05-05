'use client';

import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAppUser } from '@/hooks/use-app-user';

export function EmployeeDemoPlaceholder({ title }: { title: string }) {
  const { currentUser, isLoading } = useAppUser();
  if (isLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="mx-auto max-w-3xl space-y-6 p-1">
        <h1 className="text-2xl font-bold tracking-tight text-primary">{title}</h1>
        <Card>
          <CardHeader>
            <CardTitle>Demo — การจัดการลูกจ้าง</CardTitle>
            <CardDescription>
              หน้านี้เป็นตัวอย่างเมนูภายใต้ผู้ดูแลระบบ เนื้อหาจริงจะเพิ่มในขั้นถัดไป
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            เส้นทางนี้อยู่ภายใต้{' '}
            <code className="rounded bg-muted px-1 text-xs">/system-admin/employee-demo/*</code> และจำกัดเฉพาะผู้ดูแลระบบ
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
