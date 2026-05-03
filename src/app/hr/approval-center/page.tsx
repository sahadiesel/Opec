'use client';

import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAppUser } from '@/hooks/use-app-user';
import { isSystemAdmin } from '@/lib/permission-core';
import { isSimpleAdmin } from '@/lib/simple-tier-model';
import { canViewHrApprovalSubsection } from '@/lib/navigation/nav-access';
import { CalendarCheck, Coins, PackageSearch, ShieldCheck, Wallet } from 'lucide-react';
import type { User } from '@/lib/types';

/**
 * ศูนย์อนุมัติ — แยกหมวด: Timesheet รอบเดือน (payroll + draft invoice) · Payroll งวดจ่าย · ใบสั่งซื้อจัดซื้อ (สโตร์)
 * เมนูหลักอยู่ที่แผง HR → อนุมัติ (ผู้จัดการ)
 */
export default function HrApprovalCenterPage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const canSee =
    currentUser &&
    canViewHrApprovalSubsection(currentUser, isSystemAdmin(currentUser) || isSimpleAdmin(currentUser));

  if (userLoading || !currentUser) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground text-sm">กำลังโหลด…</div>
    );
  }

  if (!canSee) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="mx-auto max-w-lg py-20 text-center text-muted-foreground">ไม่มีสิทธิ์เข้าหน้านี้</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="mx-auto max-w-4xl space-y-8 px-4 py-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary flex items-center gap-2">
            <ShieldCheck className="h-8 w-8" />
            ศูนย์อนุมัติ (Approval Center)
          </h1>
          <p className="mt-2 text-muted-foreground max-w-2xl">
            แยกตามประเภทงาน — <strong>Timesheet รอบเดือน</strong> ส่งจาก Payroll/Officer หลังตรวจตัวเลขในแอป แล้วเข้าคิวให้ผู้จัดการอนุมัติ
            (คิว timesheet จัด<strong className="text-foreground">กลุ่มตามชุด PO Active</strong>) ก่อนนำไปคำนวณ payroll และออก Draft Invoice ให้ลูกค้า
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-1">
          <Card className="border-primary/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <CalendarCheck className="h-5 w-5 text-primary" />
                3.1 อนุมัติ Timesheet (รอบเดือน / Wave)
              </CardTitle>
              <CardDescription className="text-sm leading-relaxed">
                <span className="font-semibold text-foreground">3.1.1</span> หลังอนุมัติ — นำไปคำนวณ payroll ได้{' '}
                <span className="mx-1 text-muted-foreground">|</span>{' '}
                <span className="font-semibold text-foreground">3.1.2</span> เพื่อออกเอกสาร Draft Invoice ส่งลูกค้า
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href="/hr/timesheet-month-approval">เปิดคิวรอตรวจ (รายเดือน)</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/timesheets/wave-month">ไปสรุปลงเวลารายเดือน (ฝั่งเตรียมข้อมูล)</Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Coins className="h-5 w-5 text-amber-700" />
                อนุมัติ Payroll งวดจ่าย (Worker / Office)
              </CardTitle>
              <CardDescription>ศูนย์อนุมัติงวดจ่ายตาม batch — แยกจาก timesheet รายวัน</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="secondary">
                <Link href="/hr/payroll-approval">เปิดศูนย์อนุมัติ Payroll</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="border-emerald-500/25">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Wallet className="h-5 w-5 text-emerald-700" />
                อนุมัติการเบิกเงิน (เบิกล่วงหน้า)
              </CardTitle>
              <CardDescription>
                คิวผู้จัดการอนุมัติหลัง Payroll ตรวจแล้ว — เมื่ออนุมัติและจ่ายแล้ว ระบบจะ<strong className="text-foreground">หักยอดเบิกจากสลิปเงินเดือน</strong>อัตโนมัติเมื่อสร้าง Payroll
                Batch งวดถัดไป (ลูกจ้าง)
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href="/hr/cash-advances?focus=manager">เปิดคิวรอผู้จัดการ</Link>
              </Button>
              <Button variant="outline" asChild size="sm">
                <Link href="/hr/cash-advances">รายการเบิกล่วงหน้าทั้งหมด</Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <PackageSearch className="h-5 w-5 text-muted-foreground" />
                3.2 อนุมัติใบสั่งซื้อจัดซื้อ (คลัง / สโตร์)
              </CardTitle>
              <CardDescription>
                คิวขออนุมัติซื้อสินค้า/บริการที่ <strong>เจ้าหน้าที่คลัง (store officer)</strong> ส่งเข้ามา — แยกจากใบสั่งซื้อลูกค้า (Commercial
                Customer PO)
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link href="/purchases">เปิดรายการซื้อ — รออนุมัติ</Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href="/purchase-orders">ใบสั่งซื้อลูกค้า (Commercial PO)</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
