'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { useAppUser } from '@/hooks/use-app-user';
import type { User } from '@/lib/types';
import { CalendarRange } from 'lucide-react';

/**
 * เดิมเป็นหน้ารายการตรวจ timesheet รายวันรายคน — ยกเลิกโฟลว์นี้ (ไม่เหมาะกับจำนวนคนมาก)
 * เปลี่ยนมาใช้มุมมอง Wave + เดือน + ส่งตรวจรอบเดือนแทน
 */
export default function DailyTimesheetListRedirectPage() {
  const router = useRouter();
  const { currentUser, isLoading } = useAppUser();

  useEffect(() => {
    const t = setTimeout(() => router.replace('/timesheets/wave-month'), 400);
    return () => clearTimeout(t);
  }, [router]);

  if (isLoading || !currentUser) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center text-muted-foreground text-sm">กำลังโหลด…</div>
    );
  }

  return (
    <AppShell user={currentUser as User} onLogout={() => {}}>
      <div className="mx-auto max-w-lg space-y-4 px-4 py-16 text-center">
        <CalendarRange className="mx-auto h-12 w-12 text-primary opacity-80" />
        <h1 className="text-xl font-bold text-primary">ย้ายไปใช้สรุปรายเดือน (Wave)</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          ไม่มีรายการตรวจ timesheet รายวันแบบรายคนแล้ว — ใช้ภาพรวมต่อ Wave ต่อเดือน แล้วส่งตรวจรอบเดือนไปยังศูนย์อนุมัติ
        </p>
        <p className="text-xs text-muted-foreground">กำลังพาไปหน้าสรุปรายเดือนอัตโนมัติ…</p>
        <Link href="/timesheets/wave-month" className="text-primary font-semibold underline text-sm">
          ไปทันที
        </Link>
      </div>
    </AppShell>
  );
}
