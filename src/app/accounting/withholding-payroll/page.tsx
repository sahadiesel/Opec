'use client';

import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAppUser } from '@/hooks/use-app-user';
import { Percent, Users, ArrowRight, Loader2 } from 'lucide-react';
import type { User } from '@/lib/types';
import { canSeeAccountingPillarUi } from '@/lib/permissions';
import { usePermissions } from '@/hooks/use-permissions';
export default function AccountingWithholdingPayrollHubPage() {
  const { currentUser, isLoading } = useAppUser();
  const { profile } = usePermissions(currentUser);

  if (isLoading || !currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  const user = currentUser as User;
  if (!canSeeAccountingPillarUi(user, profile)) {
    return (
      <AppShell user={user} onLogout={() => {}}>
        <div className="max-w-3xl mx-auto py-16 text-center text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงเมนูบัญชี</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={user} onLogout={() => {}}>
      <div className="max-w-3xl mx-auto space-y-6 py-6 px-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">1. เอกสาร หัก ณ ที่จ่าย (พนักงาน)</h1>
          <p className="text-muted-foreground mt-1">
            รวมเส้นทางสำหรับหักภาษี ณ ที่จ่ายจากเงินเดือน — แยกจากระบบคู่ค้า (AP / ใบแจ้งหนี้)
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="h-5 w-5" />
              ลูกจ้าง / Worker Payroll
            </CardTitle>
            <CardDescription>
              หนังสือรับรองการหักภาษี ณ ที่จ่าย (ภงด.1) จากงวดจ่ายลูกจ้าง — ข้อมูลจาก Document Header Profile + ทะเบียนลูกจ้าง + สลิป
              payroll line
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild variant="default">
              <Link href="/payroll/batches">
                ไปงวดจ่ายลูกจ้าง (Payroll Batches)
                <ArrowRight className="h-4 w-4 ml-2" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              พนักงานออฟฟิศ / Office payroll
            </CardTitle>
            <CardDescription>
              หนังสือรับรองการหักภาษี ณ ที่จ่าย (ภงด.1) จากงวดจ่ายพนักงานออฟฟิศ — พิมพ์ได้จากหน้ารายละเอียดงวดหลังคำนวณแล้ว (ปุ่ม «ใบหักฯ» / «พิมพ์ใบหักทั้งงวด»)
              เหมือน workflow ลูกจ้าง
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild variant="default">
              <Link href="/office-payroll">
                ไปงวดจ่ายพนักงานออฟฟิศ
                <ArrowRight className="h-4 w-4 ml-2" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Percent className="h-5 w-5" />
              คู่ค้า / Vendor
            </CardTitle>
            <CardDescription>รายการหนังสือรับรองที่ออกจากการจ่ายคู่ค้า — ดูได้จากเมนูข้อ 2</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild variant="default">
              <Link href="/accounting/withholding-vendor">2. เอกสาร หัก ณ ที่จ่าย (คู่ค้า)</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/ap-bills">รับวางบิลเจ้าหนี้ (AP Bills)</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
