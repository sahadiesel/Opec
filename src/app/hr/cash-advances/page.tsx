'use client';

import { Suspense, useMemo, useState, useCallback } from 'react';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, ChevronRight, Loader2, Printer } from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, orderBy, query, where } from 'firebase/firestore';
import { useAppUser } from '@/hooks/use-app-user';
import { useToast } from '@/hooks/use-toast';
import { canView } from '@/lib/permissions';
import { getEffectiveSimpleRole } from '@/lib/simple-tier-model';
import { formatDateThaiBE, formatPayrollYearMonthThaiBE } from '@/lib/date-thai';
import type { CashAdvanceRequest, CashAdvanceStatus, User } from '@/lib/types';
import {
  buildCashAdvanceListPrintHtml,
  capCashAdvanceListPrintRows,
  cashAdvanceStatusLabelTh,
  describeCashAdvanceListPrintFilters,
  type CashAdvanceListPrintRow,
} from '@/lib/documents/cash-advance-list-print';
import { openStandardPrintWindow } from '@/lib/documents/standard-document-print';

function cashAdvanceRowMonthYm(r: CashAdvanceRequest): string | null {
  if (!r.createdAt) return null;
  return new Date(r.createdAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 7);
}

function statusBadge(status: CashAdvanceStatus) {
  const label = cashAdvanceStatusLabelTh(status);
  const variantMap: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    PENDING_SUBJECT_CONFIRMATION: 'secondary',
    PENDING_PAYROLL_REVIEW: 'secondary',
    REJECTED_PAYROLL: 'destructive',
    PENDING_MANAGER_APPROVAL: 'outline',
    REJECTED_MANAGER: 'destructive',
    PENDING_PAYMENT: 'default',
    PAID_PETTY_CASH: 'default',
    PAID_OTHER: 'default',
    CANCELLED: 'outline',
  };
  const variant = variantMap[status] ?? 'outline';
  return <Badge variant={variant}>{label}</Badge>;
}

function subjectTypeLabel(type: CashAdvanceRequest['subjectType']): string {
  return type === 'worker' ? 'ลูกจ้าง' : 'พนักงานออฟฟิศ';
}

function originLabel(origin: CashAdvanceRequest['origin']): string {
  return origin === 'office' ? 'Office / HR' : 'ผู้ถือบัญชี';
}

function buildCashAdvancePrintRow(r: CashAdvanceRequest): CashAdvanceListPrintRow {
  return {
    requestNo: r.requestNo,
    dateLabel: formatDateThaiBE(r.createdAt),
    subjectName: r.subjectNameSnapshot,
    subjectTypeLabel: subjectTypeLabel(r.subjectType),
    amountLabel: `฿${Number(r.amountBaht || 0).toLocaleString('th-TH')}`,
    originLabel: originLabel(r.origin),
    statusLabel: cashAdvanceStatusLabelTh(r.status),
  };
}

function HrCashAdvancesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const ok = useMemo(() => !!currentUser && canView(currentUser, 'cash_advances'), [currentUser]);

  const isEmployeeSelfPortal = useMemo(
    () => !!currentUser && getEffectiveSimpleRole(currentUser) === 'employee_self',
    [currentUser],
  );

  const focusManager = useMemo(
    () => searchParams.get('focus') === 'manager' && !isEmployeeSelfPortal,
    [searchParams, isEmployeeSelfPortal],
  );

  const [monthFilter, setMonthFilter] = useState<string>('ALL');
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);

  const q = useMemoFirebase(() => {
    if (!firestore || !ok || !currentUser?.id) return null;
    const base = collection(firestore, 'cash_advance_requests');
    if (isEmployeeSelfPortal) {
      return query(base, where('subjectLinkedUserId', '==', currentUser.id), orderBy('createdAt', 'desc'));
    }
    return query(base, orderBy('createdAt', 'desc'));
  }, [firestore, ok, currentUser?.id, isEmployeeSelfPortal]);

  const { data: rows, isLoading } = useCollection<CashAdvanceRequest>(q as any);

  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows ?? []) {
      const ym = cashAdvanceRowMonthYm(r);
      if (ym) set.add(ym);
    }
    return Array.from(set).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  }, [rows]);

  const rowsAfterFocus = useMemo(() => {
    const r = rows ?? [];
    if (!focusManager) return r;
    const pending = r.filter((x) => x.status === 'PENDING_MANAGER_APPROVAL');
    const rest = r.filter((x) => x.status !== 'PENDING_MANAGER_APPROVAL');
    return [...pending, ...rest];
  }, [rows, focusManager]);

  const displayRows = useMemo(() => {
    if (monthFilter === 'ALL') return rowsAfterFocus;
    return rowsAfterFocus.filter((r) => cashAdvanceRowMonthYm(r) === monthFilter);
  }, [rowsAfterFocus, monthFilter]);

  const allRowCount = rowsAfterFocus.length;
  const filteredRowCount = displayRows.length;

  const runCashAdvanceListPrint = useCallback(
    async (scope: 'filtered' | 'all') => {
      const source = scope === 'filtered' ? displayRows : rowsAfterFocus;
      if (source.length === 0) {
        toast({
          variant: 'destructive',
          title: 'ไม่มีรายการให้พิมพ์',
          description:
            scope === 'filtered'
              ? 'ไม่พบข้อมูลตามเดือนที่เลือก — เลือกทุกเดือนหรือพิมพ์ทั้งหมด'
              : 'ยังไม่มีรายการเบิกเงินล่วงหน้า',
        });
        return;
      }

      setPrintBusy(true);
      try {
        const printRows = source.map(buildCashAdvancePrintRow);
        const { rows: capped, truncated } = capCashAdvanceListPrintRows(printRows);
        const generatedAt = new Date().toLocaleString('th-TH', {
          dateStyle: 'medium',
          timeStyle: 'short',
        });
        const filterLines =
          scope === 'filtered' ? describeCashAdvanceListPrintFilters({ monthYyyyMm: monthFilter }) : [];
        const scopeTitle =
          scope === 'filtered' ? 'พิมพ์ตามตัวกรองปัจจุบัน' : 'พิมพ์ทั้งหมด (ในชุดข้อมูลล่าสุด)';

        const body = buildCashAdvanceListPrintHtml({
          rows: capped,
          scopeTitle,
          filterLines,
          generatedAt,
          printedBy: currentUser?.displayName,
          truncated,
        });

        const okPrint = await openStandardPrintWindow({
          windowTitle: 'Cash-Advance-List',
          suggestedFileName: `Cash-Advance-List-${scope === 'filtered' ? 'Filtered' : 'All'}`,
          bodyInnerHtml: body,
          htmlLang: 'th',
        });

        if (!okPrint) {
          toast({
            variant: 'destructive',
            title: 'เปิดหน้าต่างพิมพ์ไม่ได้',
            description: 'กรุณาอนุญาตป๊อปอัปสำหรับเว็บไซต์นี้',
          });
          return;
        }
        setPrintDialogOpen(false);
      } finally {
        setPrintBusy(false);
      }
    },
    [displayRows, rowsAfterFocus, monthFilter, currentUser?.displayName, toast],
  );

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
          <CardHeader className="pb-3">
            <CardTitle className="text-base">คิวงาน</CardTitle>
            <CardDescription>คลิกแถวเพื่อเปิดรายละเอียดและดำเนินการตามขั้น</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <Select value={monthFilter} onValueChange={setMonthFilter}>
                <SelectTrigger
                  className="h-10 w-[min(100%,13rem)] shrink-0 bg-background"
                  aria-label="กรองตามเดือนสร้างคำขอ"
                >
                  <SelectValue placeholder="เลือกเดือน" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">ทุกเดือน</SelectItem>
                  {monthOptions.map((ym) => (
                    <SelectItem key={ym} value={ym}>
                      {formatPayrollYearMonthThaiBE(ym)} ({ym})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                className="h-10 shrink-0 gap-2"
                disabled={isLoading || allRowCount === 0}
                onClick={() => setPrintDialogOpen(true)}
              >
                <Printer className="h-4 w-4" /> พิมพ์รายการ
              </Button>
            </div>

            {isLoading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>เลขที่</TableHead>
                      <TableHead>วันที่</TableHead>
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
                        <TableCell className="whitespace-nowrap text-sm">{formatDateThaiBE(r.createdAt)}</TableCell>
                        <TableCell>{r.subjectNameSnapshot}</TableCell>
                        <TableCell>{subjectTypeLabel(r.subjectType)}</TableCell>
                        <TableCell className="text-right font-medium">
                          ฿{Number(r.amountBaht || 0).toLocaleString('th-TH')}
                        </TableCell>
                        <TableCell>{originLabel(r.origin)}</TableCell>
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
                        <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                          {rowsAfterFocus.length === 0
                            ? 'ยังไม่มีรายการ'
                            : 'ไม่พบรายการในเดือนที่เลือก'}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={printDialogOpen} onOpenChange={setPrintDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>พิมพ์รายการเบิกเงินล่วงหน้า</DialogTitle>
              <DialogDescription>สูงสุด 500 รายการต่อครั้ง</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="rounded-md border bg-muted/30 p-3 space-y-1">
                <p className="font-semibold text-xs uppercase text-muted-foreground">ตัวกรองปัจจุบัน</p>
                <ul className="list-disc list-inside text-xs text-muted-foreground">
                  {describeCashAdvanceListPrintFilters({ monthYyyyMm: monthFilter }).length > 0 ? (
                    describeCashAdvanceListPrintFilters({ monthYyyyMm: monthFilter }).map((line) => (
                      <li key={line}>{line}</li>
                    ))
                  ) : (
                    <li>ทุกเดือน</li>
                  )}
                </ul>
                <p className="text-xs font-medium pt-1">จะพิมพ์ {filteredRowCount} รายการ</p>
              </div>
              <p className="text-xs text-muted-foreground">ข้อมูลทั้งหมด: {allRowCount} รายการ</p>
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                disabled={printBusy || filteredRowCount === 0}
                onClick={() => void runCashAdvanceListPrint('filtered')}
              >
                <Printer className="h-4 w-4 mr-2" />
                พิมพ์ตามตัวกรอง ({filteredRowCount})
              </Button>
              <Button
                type="button"
                className="w-full sm:w-auto"
                disabled={printBusy || allRowCount === 0}
                onClick={() => void runCashAdvanceListPrint('all')}
              >
                <Printer className="h-4 w-4 mr-2" />
                พิมพ์ทั้งหมด ({allRowCount})
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
