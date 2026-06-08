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
import { PayrollBatch } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, limit, orderBy, query } from 'firebase/firestore';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { canAccess, canView, isMatrixControlledRole, canExecuteBankCashbookPayments } from '@/lib/permissions';
import { useAppUser } from '@/hooks/use-app-user';
import { WORKER_BATCH_STATUSES_FOR_ACCOUNTING_PAYOUT } from '@/lib/payroll/accounting-payout-queue';
import { parseYearMonthFromWorkerPayrollPeriodId } from '@/lib/timesheet/po-month-timesheet-bridge';
import { formatDateThaiBE } from '@/lib/date-thai';
import { isSystemAdmin } from '@/lib/permission-core';
import { isSimpleAccounting } from '@/lib/simple-tier-model';

function getStatusBadge(status: PayrollBatch['status']) {
  switch (status) {
    case 'FINANCE_PREPARED':
      return <Badge className="bg-amber-600 hover:bg-amber-600">รอทำจ่าย (บัญชี)</Badge>;
    case 'PAYMENT_EXPORTED':
      return <Badge className="bg-blue-600 hover:bg-blue-600">ส่งไฟล์จ่ายแล้ว</Badge>;
    case 'PAID':
      return <Badge className="bg-green-700 hover:bg-green-700">PAID</Badge>;
    case 'LOCKED':
      return <Badge variant="secondary">ล็อกแล้ว</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export default function AccountingWorkerPayrollQueuePage() {
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const [batchSearch, setBatchSearch] = useState('');

  const useMatrixGuards = isMatrixControlledRole(currentUser);
  const canViewWorkerPayroll = useMemo(() => {
    if (useMatrixGuards) {
      return (
        canAccess(currentUser, 'worker_payroll', 'view') ||
        canAccess(currentUser, 'payroll_runs', 'view') ||
        canAccess(currentUser, 'payslips', 'view')
      );
    }
    return canView(currentUser, 'worker_payroll');
  }, [currentUser, useMatrixGuards]);

  const isAuthorized = useMemo(() => {
    if (!currentUser) return false;
    if (isSystemAdmin(currentUser)) return true;
    if (isSimpleAccounting(currentUser)) return true;
    return canViewWorkerPayroll;
  }, [currentUser, canViewWorkerPayroll]);
  const canOpenPayoutDetail = useMemo(
    () => canExecuteBankCashbookPayments(currentUser),
    [currentUser],
  );

  const batchQuery = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return query(collection(firestore, 'payroll_batches'), orderBy('createdAt', 'desc'), limit(80));
  }, [firestore, isAuthorized]);

  const { data: batches, isLoading } = useCollection<PayrollBatch>(batchQuery as any);

  const allow = useMemo(() => new Set<PayrollBatch['status']>(WORKER_BATCH_STATUSES_FOR_ACCOUNTING_PAYOUT), []);

  const queueBatches = useMemo(() => {
    if (!batches?.length) return [];
    return batches.filter((b) => allow.has(b.status));
  }, [batches, allow]);

  const displayBatches = useMemo(() => {
    const q = batchSearch.trim().toLowerCase();
    if (!q) return queueBatches;
    return queueBatches.filter((b) => {
      const ym = parseYearMonthFromWorkerPayrollPeriodId(b.payrollPeriodId || '');
      const ymDisp = ym ? formatPayrollYearMonthEnAbbrev(ym).toLowerCase() : '';
      return (
        (b.id || '').toLowerCase().includes(q) ||
        (b.payrollPeriodId || '').toLowerCase().includes(q) ||
        (ym || '').toLowerCase().includes(q) ||
        ymDisp.includes(q)
      );
    });
  }, [queueBatches, batchSearch]);

  if (userLoading || !currentUser) return null;

  if (!isAuthorized) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="max-w-xl mx-auto py-20 text-center text-muted-foreground">
          คุณไม่มีสิทธิ์เข้าถึงคิวทำจ่ายลูกจ้าง (บัญชี)
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1400px] mx-auto">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-primary flex items-center gap-3">
            <Coins className="h-8 w-8 shrink-0" /> ลูกจ้าง · ทำจ่าย (บัญชี)
          </h1>
          <p className="text-muted-foreground">
            คิวหลังส่งถึงฝ่ายบัญชีแล้ว (FINANCE_PREPARED ขึ้นไป) — กดเปิดแถวด้านล่างเพื่อเข้าหน้าทำจ่ายบัญชี (เลือกบัญชีตัดจ่าย + ลง cashbook) ไม่ใช่หน้าสร้างชุดของ HR
          </p>
        </div>

        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>แยกจากโฟลว์ HR</AlertTitle>
          <AlertDescription className="text-sm">
            การสร้างชุดจ่ายและอนุมัติผู้จัดการทำที่เมนู HR → งวดจ่ายลูกจ้าง / ศูนย์อนุมัติ — เมื่ออนุมัติแล้วสถานะเป็น FINANCE_PREPARED โดยตรง — เมนูนี้สำหรับฝ่ายบัญชียืนยันจ่ายและสมุดรายรับรายจ่ายเท่านั้น
          </AlertDescription>
        </Alert>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="ค้นหารหัสชุดจ่าย / งวดเดือน…"
              className="pl-9"
              value={batchSearch}
              onChange={(e) => setBatchSearch(e.target.value)}
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
                    <TableHead className="font-bold">รหัสชุดจ่าย</TableHead>
                    <TableHead className="font-bold">เดือน (งวด)</TableHead>
                    <TableHead className="font-bold">ขอบเขต</TableHead>
                    <TableHead className="font-bold text-center">จำนวนคน</TableHead>
                    <TableHead className="font-bold text-right">ยอดสุทธิ</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                    <TableHead className="font-bold">วันที่สร้าง</TableHead>
                    <TableHead className="text-right pr-6">เปิดทำจ่าย</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayBatches.map((b) => {
                    const ym = parseYearMonthFromWorkerPayrollPeriodId(b.payrollPeriodId || '');
                    return (
                      <TableRow
                        key={b.id}
                        className={canOpenPayoutDetail ? 'cursor-pointer hover:bg-muted/30' : undefined}
                        onClick={
                          canOpenPayoutDetail
                            ? () => router.push(`/accounting/worker-payroll/${b.id}`)
                            : undefined
                        }
                      >
                        <TableCell className="font-mono font-bold text-primary">{b.id}</TableCell>
                        <TableCell>
                          {ym ? (
                            <>
                              {formatPayrollYearMonthEnAbbrev(ym)}
                              <span className="ml-1 text-xs text-muted-foreground">({ym})</span>
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground font-mono">{b.payrollPeriodId}</span>
                          )}
                        </TableCell>
                        <TableCell className="capitalize text-sm">{b.workModeScope}</TableCell>
                        <TableCell className="text-center font-semibold">{b.totalWorkers}</TableCell>
                        <TableCell className="text-right font-black text-primary">฿{b.netAmount.toLocaleString()}</TableCell>
                        <TableCell>{getStatusBadge(b.status)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatDateThaiBE(b.createdAt)}</TableCell>
                        <TableCell className="text-right pr-6" onClick={(e) => e.stopPropagation()}>
                          {canOpenPayoutDetail ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label="เปิดหน้าทำจ่าย"
                              onClick={() => router.push(`/accounting/worker-payroll/${b.id}`)}
                            >
                              <ChevronRight className="h-5 w-5" />
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {displayBatches.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-16 text-muted-foreground">
                        {queueBatches.length === 0 ? (
                          <span className="inline-flex items-center gap-2">
                            <ShieldAlert className="h-5 w-5 opacity-50" />
                            ยังไม่มีชุดจ่ายที่พร้อมให้บัญชีทำจ่าย (ต้องเป็น FINANCE_PREPARED ขึ้นไปหลังส่งถึงบัญชี)
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
