'use client';

import Link from 'next/link';
import { ArrowLeft, Building2, Car } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';

export default function LeaseContractTypePage() {
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
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/accounting/contracts"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">1. สัญญาเช่า</h1>
            <p className="mt-1 text-muted-foreground">เลือกรูปแบบสัญญา — รายละเอียดฟอร์มและเอกสารพิมพ์จะต่างกัน</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Link href="/accounting/contracts/lease/property" className="group">
            <Card className="h-full transition-colors group-hover:border-primary group-hover:bg-primary/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-primary" />
                  1.1 สัญญาเช่าบ้าน/อาคาร/โรงงาน
                </CardTitle>
                <CardDescription>
                  กรอกที่ตั้งทรัพย์สิน ระยะเวลาเช่า ค่าเช่ารายเดือน และเงื่อนไขภาษีหัก ณ ที่จ่าย
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/accounting/contracts/lease/vehicle" className="group">
            <Card className="h-full transition-colors group-hover:border-primary group-hover:bg-primary/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Car className="h-5 w-5 text-primary" />
                  1.2 สัญญาเช่ารถยนต์
                </CardTitle>
                <CardDescription>
                  กรอกยี่ห้อ เลขทะเบียน ระยะเวลาเช่า ค่าเช่าล่วงหน้า เงินประกัน และเงื่อนไขตามแบบสัญญาเช่ารถ
                </CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                ฟิลด์เฉพาะ: ยี่ห้อ · ทะเบียน · ค่าเช่าล่วงหน้า · เงินประกัน
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
