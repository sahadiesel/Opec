'use client';

import { Suspense, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Plus, ChevronRight, Loader2 } from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, orderBy, query, where } from 'firebase/firestore';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';
import { getEffectiveSimpleRole } from '@/lib/simple-tier-model';
import type { CashAdvanceRequest, CashAdvanceStatus, User } from '@/lib/types';

function statusBadge(status: CashAdvanceStatus) {
  const map: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    PENDING_SUBJECT_CONFIRMATION: { label: 'รอยืนยันผู้ถือเรื่อง', variant: 'secondary' },
    PENDING_PAYROLL_REVIEW: { label: 'รอ Payroll ตรวจ', variant: 'secondary' },
    REJECTED_PAYROLL: { label: 'Payroll ปฏิเสธ', variant: 'destructive' },
    PENDING_MANAGER_APPROVAL: { label: 'รอผู้จัดการ', variant: 'outline' },
    REJECTED_MANAGER: { label: 'ผู้จัดการปฏิเสธ', variant: 'destructive' },
    PENDING_PAYMENT: { label: 'รอจ่าย (บัญชี)', variant: 'default' },
    PAID_PETTY_CASH: { label: 'จ่ายจาก Petty', variant: 'default' },
    PAID_OTHER: { label: 'จ่ายแล้ว (อื่น)', variant: 'default' },
    CANCELLED: { label: 'ยกเลิก', variant: 'outline' },
  };
  const m = map[status] ?? { label: status, variant: 'outline' as const };
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

function HrCashAdvancesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();

  const ok = useMemo(() => !!currentUser && canView(currentUser, 'cash_advances'), [currentUser]);

  /** พอร์ทัลพนักงาน (employee_self) — Firestore อนุญาตแค่แถวที่ subjectLinkedUserId == auth uid ไม่ใช่ list ทั้งชุด */
  const isEmployeeSelfPortal = useMemo(
    () => !!currentUser && getEffectiveSimpleRole(currentUser) === 'employee_self',
    [currentUser],
  );

  const focusManager = useMemo(
    () => searchParams.get('focus') === 'manager' && !isEmployeeSelfPortal,
    [searchParams, isEmployeeSelfPortal],
  );

  const q = useMemoFirebase(() => {
    if (!firestore || !ok || !currentUser?.id) return null;
    const base = collection(firestore, 'cash_advance_requests');
    if (isEmployeeSelfPortal) {
      return query(base, where('subjectLinkedUserId', '==', currentUser.id), orderBy('createdAt', 'desc'));
    }
    return query(base, orderBy('createdAt', 'desc'));
  }, [firestore, ok, currentUser?.id, isEmployeeSelfPortal]);

  const { data: rows, isLoading } = useCollection<CashAdvanceRequest>(q as any);

  const displayRows = useMemo(() => {
    const r = rows ?? [];
    if (!focusManager) return r;
    const pending = r.filter((x) => x.status === 'PENDING_MANAGER_APPROVAL');
    const rest = r.filter((x) => x.status !== 'PENDING_MANAGER_APPROVAL');
    return [...pending, ...rest];
  }, [rows, focusManager]);

  if (userLoading || !currentUser) return null;

  if (!ok) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-3xl mx-auto py-16 text-center text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงเมนูนี้</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-[1400px] mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-primary">รายการเบิกเงินล่วงหน้า</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {isEmployeeSelfPortal ? (
                <>
                  แสดงเฉพาะคำขอที่ผูกกับบัญชีของคุณ — ส่งคำขอใหม่ได้ที่แท็บ &quot;เบิกล่วงหน้า&quot; ใน{' '}
                  <Link href="/my-profile" className="text-primary underline font-medium">
                    My Profile
                  </Link>
                </>
              ) : (
                <>
                  สร้างจาก HR/Payroll (ต้องยืนยันฝั่งผู้ถือเรื่องเมื่อเปิดจาก office) หรือจากพนักงานใน My Profile — ไหลไป
                  Payroll → ผู้จัดการ → บัญชีจ่าย / Petty Cash
                </>
              )}
            </p>
          </div>
          {!isEmployeeSelfPortal ? (
            <Button className="gap-2 shrink-0" onClick={() => router.push('/hr/cash-advances/new')}>
              <Plus className="h-4 w-4" /> สร้างคำขอ (ฝ่าย HR/Payroll)
            </Button>
          ) : null}
        </div>

        {focusManager ? (
          <Alert className="border-emerald-200/80 bg-emerald-50/60">
            <AlertTitle>โหมดผู้จัดการอนุมัติ</AlertTitle>
            <AlertDescription className="text-sm">
              แสดงรายการสถานะ <strong>รอผู้จัดการ</strong> ไว้ด้านบนสุด — หลังอนุมัติและจ่ายแล้ว ยอดจะถูกหักจากสลิปเมื่อสร้าง Payroll
              Batch งวดถัดไป (ลูกจ้าง)
            </AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">คิวงาน</CardTitle>
            <CardDescription>คลิกแถวเพื่อเปิดรายละเอียดและดำเนินการตามขั้น</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>เลขที่</TableHead>
                    <TableHead>ผู้เบิก</TableHead>
                    <TableHead>ประเภท</TableHead>
                    <TableHead className="text-right">จำนวนเงิน</TableHead>
                    <TableHead>แหล่งสร้าง</TableHead>
                    <TableHead>สถานะ</TableHead>
                    <TableHead className="w-[100px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayRows.map((r) => (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => router.push(`/hr/cash-advances/${r.id}`)}
                    >
                      <TableCell className="font-mono text-xs font-semibold">{r.requestNo}</TableCell>
                      <TableCell>{r.subjectNameSnapshot}</TableCell>
                      <TableCell>{r.subjectType === 'worker' ? 'ลูกจ้าง' : 'พนักงานออฟฟิศ'}</TableCell>
                      <TableCell className="text-right font-medium">
                        ฿{Number(r.amountBaht || 0).toLocaleString('th-TH')}
                      </TableCell>
                      <TableCell>{r.origin === 'office' ? 'Office / HR' : 'ผู้ถือบัญชี'}</TableCell>
                      <TableCell>{statusBadge(r.status)}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/hr/cash-advances/${r.id}`}>
                            <ChevronRight className="h-4 w-4" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {displayRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                        ยังไม่มีรายการ
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

export default function HrCashAdvancesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] w-full items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      }
    >
      <HrCashAdvancesPageContent />
    </Suspense>
  );
}
