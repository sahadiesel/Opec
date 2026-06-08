'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronRight, Coins, Info, Loader2, Search, ShieldAlert } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { formatPayrollYearMonthEnAbbrev } from '@/lib/date-thai';
import { OfficePayrollRun } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, orderBy, query } from 'firebase/firestore';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { canView, canExecuteBankCashbookPayments } from '@/lib/permissions';
import { useAppUser } from '@/hooks/use-app-user';
import { OFFICE_RUN_STATUSES_FOR_ACCOUNTING_PAYOUT } from '@/lib/payroll/accounting-payout-queue';

function getStatusBadge(status: string) {
  switch (status) {
    case 'HR_APPROVED':
      return <Badge className="bg-amber-600 hover:bg-amber-600">รอทำจ่าย (บัญชี)</Badge>;
    case 'FINANCE_APPROVED':
      return <Badge className="bg-blue-600 hover:bg-blue-600">อนุมัติการเงินแล้ว</Badge>;
    case 'LOCKED':
      return <Badge className="bg-primary hover:bg-primary">ล็อกแล้ว</Badge>;
    case 'PAID':
      return <Badge variant="secondary">PAID</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export default function AccountingOfficePayrollQueuePage() {
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const [runSearch, setRunSearch] = useState('');

  const isAuthorized = useMemo(() => canView(currentUser, 'office_payroll'), [currentUser]);
  const canOpenPayoutDetail = useMemo(
    () => canExecuteBankCashbookPayments(currentUser),
    [currentUser],
  );

  const runsQuery = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return query(collection(firestore, 'office_payroll_runs'), orderBy('payrollMonth', 'desc'));
  }, [firestore, isAuthorized]);

  const { data: runs, isLoading } = useCollection<OfficePayrollRun>(runsQuery as any);

  const queueRuns = useMemo(() => {
    if (!runs?.length) return [];
    return runs.filter((r) => OFFICE_RUN_STATUSES_FOR_ACCOUNTING_PAYOUT.includes(r.status));
  }, [runs]);

  const displayRuns = useMemo(() => {
    const q = runSearch.trim().toLowerCase();
    if (!q) return queueRuns;
    return queueRuns.filter(
      (r) =>
        (r.payrollRunNo || '').toLowerCase().includes(q) ||
        (r.payrollMonth || '').toLowerCase().includes(q) ||
        formatPayrollYearMonthEnAbbrev(r.payrollMonth, '').toLowerCase().includes(q),
    );
  }, [queueRuns, runSearch]);

  if (userLoading || !currentUser) return null;

  if (!isAuthorized) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="max-w-xl mx-auto py-20 text-center text-muted-foreground">
          คุณไม่มีสิทธิ์เข้าถึงคิวทำจ่ายเงินเดือนพนักงานออฟฟิศ
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1400px] mx-auto">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-primary flex items-center gap-3">
            <Coins className="h-8 w-8 shrink-0" /> พนักงานออฟฟิศ · ทำจ่าย (บัญชี)
          </h1>
          <p className="text-muted-foreground">
            คิวหลังผู้จัดการอนุมัติแล้ว — เลือกบัญชีตัดจ่าย บันทึก cashbook และล็อกงวดได้ที่หน้ารายละเอียด (ไม่ใช่หน้าคำนวณของ HR)
            {!canOpenPayoutDetail ? ' · เจ้าหน้าที่บัญชีดูรายการได้อย่างเดียว — เปิดรายละเอียดตัดจ่ายได้เฉพาะผู้จัดการบัญชี' : ''}
          </p>
        </div>

        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>แยกจากโฟลว์ HR</AlertTitle>
          <AlertDescription className="text-sm">
            การคำนวณ / ส่งอนุมัติ / ผู้จัดการอนุมัติยังทำที่เมนู HR → งวดจ่ายพนักงานออฟฟิศ — เมนูนี้สำหรับฝ่ายบัญชีทำจ่ายและสมุดรายรับรายจ่ายเท่านั้น
          </AlertDescription>
        </Alert>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="ค้นหาเลขที่งวด / เดือน…"
              className="pl-9"
              value={runSearch}
              onChange={(e) => setRunSearch(e.target.value)}
            />
          </div>
        </div>

        <Card className="shadow-md border-none overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-20 text-center text-muted-foreground flex items-center justify-center gap-2">
                <Loader2 className="h-6 w-6 animate-spin" /> กำลังโหลด…
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold">เลขที่งวด</TableHead>
                    <TableHead className="font-bold">เดือน</TableHead>
                    <TableHead className="font-bold">ช่วงเวลา</TableHead>
                    <TableHead className="font-bold text-center">จำนวนคน</TableHead>
                    <TableHead className="font-bold text-right">ยอดสุทธิ</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                    <TableHead className="text-right pr-6">เปิดทำจ่าย</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayRuns.map((run) => (
                    <TableRow
                      key={run.id}
                      className={canOpenPayoutDetail ? 'cursor-pointer hover:bg-muted/30' : undefined}
                      onClick={
                        canOpenPayoutDetail
                          ? () => router.push(`/accounting/office-payroll/${run.id}`)
                          : undefined
                      }
                    >
                      <TableCell className="font-mono font-bold text-primary">{run.payrollRunNo}</TableCell>
                      <TableCell>
                        {formatPayrollYearMonthEnAbbrev(run.payrollMonth)}
                        <span className="ml-1 text-xs text-muted-foreground">({run.payrollMonth})</span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {run.payrollPeriodStart} – {run.payrollPeriodEnd}
                      </TableCell>
                      <TableCell className="text-center font-semibold">{run.staffCount}</TableCell>
                      <TableCell className="text-right font-black text-primary">฿{run.netAmount.toLocaleString()}</TableCell>
                      <TableCell>{getStatusBadge(run.status)}</TableCell>
                      <TableCell className="text-right pr-6" onClick={(e) => e.stopPropagation()}>
                        {canOpenPayoutDetail ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="เปิดหน้าทำจ่าย"
                            onClick={() => router.push(`/accounting/office-payroll/${run.id}`)}
                          >
                            <ChevronRight className="h-5 w-5" />
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {displayRuns.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-16 text-muted-foreground">
                        {queueRuns.length === 0 ? (
                          <span className="inline-flex items-center gap-2">
                            <ShieldAlert className="h-5 w-5 opacity-50" />
                            ยังไม่มีงวดที่พร้อมให้บัญชีทำจ่าย (ต้องเป็น HR_APPROVED ขึ้นไป)
                          </span>
                        ) : (
                          'ไม่พบรายการตามคำค้น'
                        )}
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
