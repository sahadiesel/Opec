'use client';

import Link from 'next/link';
import { Building2, Car, FileSignature, HandCoins } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';

export default function ContractsHubPage() {
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
      <div className="mx-auto max-w-4xl space-y-8">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <FileSignature className="h-8 w-8" /> การจัดการสัญญา
          </h1>
          <p className="mt-1 text-muted-foreground">เลือกประเภทสัญญาก่อนดำเนินการ</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Link href="/accounting/contracts/lease" className="group">
            <Card className="h-full transition-colors group-hover:border-primary group-hover:bg-primary/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Building2 className="h-5 w-5 text-primary" />
                  1. สัญญาเช่า
                </CardTitle>
                <CardDescription>
                  สัญญาที่ OPEC เป็นผู้เช่า — บ้าน/อาคาร/โรงงาน หรือรถยนต์ · สร้างรายการรอจ่ายรายเดือนหลังอนุมัติ
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground flex items-center gap-3">
                <span className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> อสังหาริมทรัพย์</span>
                <span className="inline-flex items-center gap-1"><Car className="h-3.5 w-3.5" /> รถยนต์</span>
              </CardContent>
            </Card>
          </Link>

          <Link href="/accounting/contracts/compensation" className="group">
            <Card className="h-full transition-colors group-hover:border-primary group-hover:bg-primary/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <HandCoins className="h-5 w-5 text-primary" />
                  2. สัญญาจ่ายเงินตอบแทน
                </CardTitle>
                <CardDescription>
                  สัญญาจ่ายค่าตอบแทนตามข้อตกลง — เตรียมโครงสร้างฟอร์มและ workflow แยกจากสัญญาเช่า
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
