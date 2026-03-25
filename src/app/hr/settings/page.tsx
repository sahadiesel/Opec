'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft,
  Info,
  Landmark,
  Percent,
  Scale,
  ShieldCheck,
  ClipboardList,
} from 'lucide-react';
import { User } from '@/lib/types';
import {
  THAI_PIT_REFERENCE_ROWS,
  DEFAULT_SOCIAL_SECURITY_EMPLOYEE_RATE_PERCENT,
  DEFAULT_SOCIAL_SECURITY_MONTHLY_CEILING_BAHT,
  calculateThaiAnnualPIT,
} from '@/lib/hr/pit-thailand';
import { isHRStaff } from '@/lib/permissions';
import { useRouter } from 'next/navigation';

export default function HrSettingsPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const ok = currentUser && isHRStaff(currentUser);

  if (!currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground text-sm">กำลังโหลด...</div>
    );
  }

  if (!ok) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="max-w-lg mx-auto py-20 text-center space-y-4">
          <p className="text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงหน้านี้</p>
          <Button variant="outline" onClick={() => router.push('/')}>
            กลับหน้าหลัก
          </Button>
        </div>
      </AppShell>
    );
  }

  const demoPit = calculateThaiAnnualPIT(850_000);

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-5xl mx-auto space-y-8 pb-16">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/hr/dashboard">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">ตั้งค่า HR — ภาษีและประกันสังคม</h1>
            <p className="text-sm text-muted-foreground mt-1">
              กฎอ้างอิงสำหรับออกแบบการคำนวณสลิปเงินเดือน / นำส่งภาษี — ตรวจสอบประกาศกรมสรรพากรและ กสร. ฉบับล่าสุดเมื่อมีการเปลี่ยนแปลง
            </p>
          </div>
        </div>

        <Card className="border-primary/20 bg-primary/5">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardList className="h-5 w-5" /> เส้นทางสลิปและการจ่าย (สรุปการปฏิบัติ)
            </CardTitle>
            <CardDescription>
              ลูกจ้างและพนักงานต้องตรวจสอบสลิปได้ชัดเจน → HR Manager อนุมัติรอบจ่าย → ส่งตัวเลขให้บัญชีโอน/นำส่งต่อ
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed">
            <ol className="list-decimal pl-5 space-y-2">
              <li>
                <strong>ลูกจ้าง (คนงานสนาม):</strong> ลงเวลาตาม Wave / ประวัติรายวัน → รวมใน{' '}
                <strong>งวดการจ่าย (Payroll Batches)</strong> และ <strong>รอบบัญชี (Periods)</strong> เพื่อกำหนดช่วงตัดยอด
              </li>
              <li>
                <strong>พนักงานสำนักงาน:</strong> ใช้ <strong>จ่ายเงินเดือนพนักงาน (Office Payroll)</strong> แยกจากคนงาน
              </li>
              <li>
                <strong>การอนุมัติ:</strong> หัวหน้า HR ตรวจสอบยอดคำนวณและสถานะรอบ (เช่น HR_APPROVED) ก่อนส่งมอบให้ฝ่ายบัญชี
              </li>
            </ol>
            <Button variant="outline" size="sm" asChild>
              <Link href="/hr/dashboard">ไปแดชบอร์ด HR</Link>
            </Button>
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Landmark className="h-5 w-5 text-primary" /> ประกันสังคม (ฝั่งลูกจ้าง)
              </CardTitle>
              <CardDescription>อัตราและเพดานใช้เป็นฐานในระบบ — ปรับตามประกาศ กสร. รายปี</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 p-3">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Percent className="h-4 w-4" /> อัตราหัก (ลูกจ้าง)
                </span>
                <Badge variant="secondary" className="font-mono text-base">
                  {DEFAULT_SOCIAL_SECURITY_EMPLOYEE_RATE_PERCENT}%
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 p-3">
                <span className="text-muted-foreground">เพดานค่าจ้างคำนวณต่อเดือน (เริ่มต้น)</span>
                <span className="font-bold tabular-nums">
                  {DEFAULT_SOCIAL_SECURITY_MONTHLY_CEILING_BAHT.toLocaleString()} บาท
                </span>
              </div>
              <p className="text-xs text-muted-foreground flex gap-2">
                <Info className="h-4 w-4 shrink-0 mt-0.5" />
                การหักจริงต้องใช้ฐานเงินได้และเพดานตามเดือน — โมดูลคำนวณสลิปจะอ่านค่าจากตั้งค่านี้เมื่อเชื่อมข้อมูลแล้ว
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Scale className="h-5 w-5 text-primary" /> ทดสอบสูตรภาษี (ตัวอย่าง)
              </CardTitle>
              <CardDescription>เงินได้สุทธิรายปี 850,000 บาท — ภาษีรายปีโดยประมาณ</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-black text-primary tabular-nums">
                {demoPit.toLocaleString(undefined, { maximumFractionDigits: 0 })} บาท
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                ใช้ฟังก์ชัน <code className="bg-muted px-1 rounded">calculateThaiAnnualPIT</code> จาก{' '}
                <code className="bg-muted px-1 rounded">@/lib/hr/pit-thailand</code>
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" /> อัตราภาษีเงินได้บุคคลธรรมดาแบบขั้นบันได
            </CardTitle>
            <CardDescription>ฐาน: เงินได้สุทธิรายปี (หลังหักลดหย่อนตามกฎหมาย) — ขั้นตอนที่ 1 แบบ Progressive</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ช่วงเงินได้สุทธิ (บาท)</TableHead>
                  <TableHead>อัตรา</TableHead>
                  <TableHead className="min-w-[280px]">หมายเหตุ / สูตร</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {THAI_PIT_REFERENCE_ROWS.map((row) => (
                  <TableRow key={row.rangeLabel}>
                    <TableCell className="font-medium">{row.rangeLabel}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{row.rateLabel}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.formulaNote}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Separator />
            <p className="text-xs text-muted-foreground">
              การหักภาษี ณ ที่จ่ายจากเงินเดือนและการคำนวณรายงวดอาจใช้วิธีหักลดหย่อน/แบบสม่ำเสมอ — ระบบสลิปจะอิงตารางนี้เป็นค่าเริ่มต้นตามนโยบายบริษัทและกฎหมายที่ใช้บังคับ
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
