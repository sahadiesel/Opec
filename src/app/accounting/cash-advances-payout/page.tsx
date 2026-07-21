'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, ChevronRight, Info, Loader2, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';
import type { CashAdvanceRequest, User } from '@/lib/types';

function recipientBankComplete(r: CashAdvanceRequest): boolean {
  return (
    !!(r.recipientBankNameSnapshot || '').trim() &&
    !!(r.recipientBankAccountNameSnapshot || '').trim() &&
    !!(r.recipientBankAccountNumberSnapshot || '').trim()
  );
}

function recipientBankLabel(r: CashAdvanceRequest): string {
  const bank = (r.recipientBankNameSnapshot || '').trim();
  const name = (r.recipientBankAccountNameSnapshot || '').trim();
  const number = (r.recipientBankAccountNumberSnapshot || '').trim();
  if (!bank && !name && !number) return '—';
  return [bank, name, number].filter(Boolean).join(' · ');
}

export default function AccountingCashAdvancesPayoutQueuePage() {
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const [search, setSearch] = useState('');

  const ok = useMemo(() => !!currentUser && canView(currentUser, 'cash_advances'), [currentUser]);

  /** ดึงทุกสถานะรอจ่ายโดยตรง — ไม่ใช้ limit เพื่อไม่ให้รายการเก่าหลุดจากคิว */
  const q = useMemoFirebase(() => {
    if (!firestore || !ok) return null;
    return query(collection(firestore, 'cash_advance_requests'), where('status', '==', 'PENDING_PAYMENT'));
  }, [firestore, ok]);

  const { data: rows, isLoading } = useCollection<CashAdvanceRequest>(q as any);

  const pendingRows = useMemo(
    () =>
      [...(rows ?? [])].sort(
        (a, b) => Number(b.managerApprovedAt || b.createdAt || 0) - Number(a.managerApprovedAt || a.createdAt || 0),
      ),
    [rows],
  );

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return pendingRows;
    return pendingRows.filter(
      (r) =>
        (r.requestNo || '').toLowerCase().includes(s) ||
        (r.subjectNameSnapshot || '').toLowerCase().includes(s) ||
        (r.reason || '').toLowerCase().includes(s) ||
        (r.recipientBankNameSnapshot || '').toLowerCase().includes(s) ||
        (r.recipientBankAccountNumberSnapshot || '').toLowerCase().includes(s),
    );
  }, [pendingRows, search]);

  if (userLoading || !currentUser) return null;

  if (!ok) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-3xl mx-auto py-16 text-center text-muted-foreground">
          คุณไม่มีสิทธิ์เข้าถึงคิวจ่ายเบิกล่วงหน้า
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-[1400px] mx-auto space-y-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold text-primary">รอจ่ายเงินเบิกล่วงหน้า</h1>
          <p className="text-muted-foreground text-sm">
            คำขอที่ผู้จัดการอนุมัติแล้ว — ฝ่ายบัญชีเลือกบัญชีบริษัทที่จะตัด และโอนเข้าบัญชีผู้เบิกที่หน้ารายละเอียด
          </p>
        </div>

        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>โฟลว์เบิกล่วงหน้า</AlertTitle>
          <AlertDescription className="text-sm">
            รายการทั้งหมด (รวมสถานะอื่น) ดูได้ที่{' '}
            <Link href="/hr/cash-advances" className="font-medium text-primary underline">
              รายการเบิกเงินล่วงหน้า (HR)
            </Link>
            {' '}— การตัด Cashbook / ธนาคารทำได้เฉพาะในคิวนี้เท่านั้น
          </AlertDescription>
        </Alert>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="ค้นหาเลขที่คำขอ / ชื่อ / บัญชีรับเงิน…"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <Card className="shadow-md border-none overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-20 flex justify-center text-muted-foreground gap-2">
                <Loader2 className="h-6 w-6 animate-spin" /> กำลังโหลด…
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold">เลขที่</TableHead>
                    <TableHead className="font-bold">ผู้เบิก</TableHead>
                    <TableHead className="font-bold text-right">จำนวนเงิน</TableHead>
                    <TableHead className="font-bold">บัญชีรับเงิน (ผู้เบิก)</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                    <TableHead className="text-right pr-6">เปิดจ่าย</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => {
                    const bankOk = recipientBankComplete(r);
                    return (
                      <TableRow
                        key={r.id}
                        className="cursor-pointer hover:bg-muted/30"
                        onClick={() => router.push(`/accounting/cash-advances-payout/${r.id}`)}
                      >
                        <TableCell className="font-mono font-semibold text-primary">{r.requestNo}</TableCell>
                        <TableCell>{r.subjectNameSnapshot}</TableCell>
                        <TableCell className="text-right font-semibold">
                          ฿{Number(r.amountBaht || 0).toLocaleString('th-TH')}
                        </TableCell>
                        <TableCell className="max-w-[280px]">
                          {bankOk ? (
                            <span className="text-xs leading-snug">{recipientBankLabel(r)}</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-amber-800">
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                              บัญชีผู้รับไม่ครบ
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge>รอจ่าย (บัญชี)</Badge>
                        </TableCell>
                        <TableCell className="text-right pr-6" onClick={(e) => e.stopPropagation()}>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="เปิดจ่าย"
                            onClick={() => router.push(`/accounting/cash-advances-payout/${r.id}`)}
                          >
                            <ChevronRight className="h-5 w-5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-16 text-muted-foreground">
                        {pendingRows.length === 0
                          ? 'ไม่มีคำขอที่รอจ่ายในขณะนี้'
                          : 'ไม่พบรายการตามคำค้น'}
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
