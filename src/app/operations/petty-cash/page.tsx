'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ArrowDownLeft, ArrowUpRight, Banknote, List, Loader2, Plus, Wallet } from 'lucide-react';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue, formatStoredDateThaiBE } from '@/lib/date-thai';
import { BankAccount, CashbookEntry, PettyCashEntry, User } from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { canView } from '@/lib/permissions';
import { recordPettyCashMovement } from '@/lib/services/cashbook-bank-movement';
import { useAppUser } from '@/hooks/use-app-user';

function endOfMonthYmd(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return `${ym}-31`;
  const last = new Date(y, m, 0);
  const d = String(last.getDate()).padStart(2, '0');
  return `${y}-${String(m).padStart(2, '0')}-${d}`;
}

function compareMovement(
  a: { entryDate: string; entryNo: string },
  b: { entryDate: string; entryNo: string },
): number {
  const d = a.entryDate.localeCompare(b.entryDate);
  if (d !== 0) return d;
  return a.entryNo.localeCompare(b.entryNo, undefined, { numeric: true });
}

/** คำอธิบายรายการที่ฝ่ายบัญชีลงในสมุดกลาง — ฝั่ง Petty ไม่ใช่ “รายรับ-รายจ่าย P&L” แต่คือ เงินเข้า-ออกกอง */
function ledgerLineLabelForPettyFund(
  t: CashbookEntry['entryType'],
  direction: 'IN' | 'OUT',
): string {
  if (t === 'TRANSFER') {
    return direction === 'IN'
      ? 'รับเงินเติมเข้ากอง (โอนจากบัญชีบริษัท)'
      : 'นำเงินออกกอง (โอนกลับ/คืน บัญชีบริษัท)';
  }
  if (t === 'PETTY_CASH') {
    return direction === 'IN' ? 'รับเงินเข้ากอง' : 'จ่ายออก (บันทึกโดยบัญชี)';
  }
  const map: Record<string, string> = {
    CUSTOMER_RECEIPT: 'รับเงิน (ลงบัญชี — อ้างกอง Petty)',
    SUPPLIER_PAYMENT: 'จ่าย (ลงบัญชี — อ้างกอง Petty)',
    PAYROLL: 'เงินเดือน (ลงบัญชี)',
    TAX: 'ภาษี (ลงบัญชี)',
    OTHER: 'อื่น ๆ (ลงบัญชี)',
  };
  return map[t] ?? t;
}

export default function OperationsPettyCashPage() {
  const { currentUser, isLoading: appUserLoading } = useAppUser();
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const allowed = useMemo(
    () => (currentUser ? canView(currentUser, 'operations_petty_cash') : false),
    [currentUser]
  );

  const pettyAccountsQuery = useMemoFirebase(() => {
    if (!firestore || !firebaseUser || !allowed) return null;
    return query(collection(firestore, 'bank_accounts'), where('accountType', '==', 'PETTY_CASH'));
  }, [firestore, firebaseUser, allowed]);

  const { data: pettyAccounts, isLoading: loadingPetty } = useCollection<BankAccount>(pettyAccountsQuery as any);

  const [selectedAccountId, setSelectedAccountId] = useState('');

  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const monthStart = useMemo(() => `${selectedMonth}-01`, [selectedMonth]);
  const monthEnd = useMemo(() => endOfMonthYmd(selectedMonth), [selectedMonth]);

  useEffect(() => {
    if (!pettyAccounts?.length) return;
    setSelectedAccountId((prev) => {
      if (prev && pettyAccounts.some((a) => a.id === prev)) return prev;
      return pettyAccounts[0].id;
    });
  }, [pettyAccounts]);

  /** ใช้เฉพาะ equality บน bankAccountId (ไม่ต้อง deploy composite index สำหรับ entryDate) — กรองเดือนใน useMemo */
  const cashbookByAccountQ = useMemoFirebase(() => {
    if (!firestore || !selectedAccountId || !allowed) return null;
    return query(
      collection(firestore, 'cashbook_entries'),
      where('bankAccountId', '==', selectedAccountId),
    );
  }, [firestore, selectedAccountId, allowed]);

  const pettyByAccountQ = useMemoFirebase(() => {
    if (!firestore || !selectedAccountId || !allowed) return null;
    return query(
      collection(firestore, 'petty_cash_entries'),
      where('bankAccountId', '==', selectedAccountId),
    );
  }, [firestore, selectedAccountId, allowed]);

  const { data: allCbForAccount, isLoading: cashbookLoad } = useCollection<CashbookEntry>(cashbookByAccountQ as any);
  const { data: allPtForAccount, isLoading: pettyLoad } = useCollection<PettyCashEntry>(pettyByAccountQ as any);

  const preCbRows = useMemo(
    () => (allCbForAccount ?? []).filter((e) => e.entryDate < monthStart),
    [allCbForAccount, monthStart],
  );
  const prePtRows = useMemo(
    () => (allPtForAccount ?? []).filter((e) => e.entryDate < monthStart),
    [allPtForAccount, monthStart],
  );

  const cashbookRows = useMemo(
    () =>
      (allCbForAccount ?? []).filter(
        (e) => e.entryDate >= monthStart && e.entryDate <= monthEnd,
      ),
    [allCbForAccount, monthStart, monthEnd],
  );

  const pettyRows = useMemo(
    () =>
      (allPtForAccount ?? []).filter(
        (e) => e.entryDate >= monthStart && e.entryDate <= monthEnd,
      ),
    [allPtForAccount, monthStart, monthEnd],
  );

  const selectedAccount = pettyAccounts?.find((a) => a.id === selectedAccountId);
  const openingBalanceNum = Number(selectedAccount?.openingBalance ?? 0);

  const preMonthNet = useMemo(() => {
    let n = 0;
    for (const e of preCbRows ?? []) {
      n += (e.direction === 'IN' ? 1 : -1) * e.amount;
    }
    for (const e of prePtRows ?? []) {
      n += (e.direction === 'IN' ? 1 : -1) * e.amount;
    }
    return n;
  }, [preCbRows, prePtRows]);

  const balanceAtStartOfSelectedMonth = useMemo(
    () => openingBalanceNum + preMonthNet,
    [openingBalanceNum, preMonthNet],
  );

  const movementRows = useMemo(() => {
    const list: Array<{
      key: string;
      entryDate: string;
      entryNo: string;
      description: string;
      direction: 'IN' | 'OUT';
      amount: number;
      source: 'cashbook' | 'petty';
      entryType: string;
      paymentMethod?: string;
    }> = [];
    for (const e of cashbookRows ?? []) {
      list.push({
        key: `cb-${e.id}`,
        entryDate: e.entryDate,
        entryNo: e.entryNo,
        description: e.description,
        direction: e.direction,
        amount: e.amount,
        source: 'cashbook',
        entryType: ledgerLineLabelForPettyFund(e.entryType, e.direction),
        paymentMethod: e.paymentMethod,
      });
    }
    for (const e of pettyRows ?? []) {
      list.push({
        key: `pt-${e.id}`,
        entryDate: e.entryDate,
        entryNo: e.entryNo,
        description: e.description,
        direction: e.direction,
        amount: e.amount,
        source: 'petty',
        entryType: 'บันทึกโดยฝ่ายปฏิบัติการ (หน้างาน)',
        paymentMethod: e.paymentMethod,
      });
    }
    return list;
  }, [cashbookRows, pettyRows]);

  const movementRowsChronological = useMemo(
    () => [...movementRows].sort(compareMovement),
    [movementRows],
  );

  const movementRowsWithBalance = useMemo(() => {
    let bal = balanceAtStartOfSelectedMonth;
    return movementRowsChronological.map((row) => {
      const effect = row.direction === 'IN' ? row.amount : -row.amount;
      bal += effect;
      return { ...row, balanceAfter: bal };
    });
  }, [movementRowsChronological, balanceAtStartOfSelectedMonth]);

  const monthTotals = useMemo(() => {
    let totalIn = 0;
    let totalOut = 0;
    for (const r of movementRows) {
      if (r.direction === 'IN') totalIn += r.amount;
      else totalOut += r.amount;
    }
    return { totalIn, totalOut, net: totalIn - totalOut };
  }, [movementRows]);

  const movementBlockLoading = cashbookLoad || pettyLoad;

  const [direction, setDirection] = useState<'IN' | 'OUT'>('OUT');
  const [amount, setAmount] = useState(0);
  const [description, setDescription] = useState('');
  const [entryDate, setEntryDate] = useState(timestampToHtmlDateValue(Date.now()));
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!firestore || !currentUser) return;
    if (!selectedAccountId) {
      toast({ variant: 'destructive', title: 'ยังไม่มีบัญชี Petty Cash', description: 'ให้ฝ่ายบัญชีสร้างบัญชีประเภท Petty Cash ที่เมนูบัญชีธนาคาร' });
      return;
    }
    if (!description.trim() || !amount || amount <= 0) {
      toast({ variant: 'destructive', title: 'ข้อมูลไม่ครบ', description: 'ระบุรายละเอียดและจำนวนเงิน' });
      return;
    }
    setSaving(true);
    try {
      const { entryNo } = await recordPettyCashMovement(firestore, currentUser as User, {
        bankAccountId: selectedAccountId,
        direction,
        amount,
        entryDate,
        description: description.trim(),
      });
      toast({ title: 'บันทึกรายการแล้ว', description: `เลขที่ ${entryNo} — อัปเดตเฉพาะกอง Petty หน้างานนี้` });
      setAmount(0);
      setDescription('');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ';
      toast({ variant: 'destructive', title: 'Error', description: msg });
    } finally {
      setSaving(false);
    }
  };

  if (appUserLoading || isUserLoading || !currentUser) return null;

  if (!allowed) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="max-w-xl mx-auto py-20 text-center text-muted-foreground">
          คุณไม่มีสิทธิ์เข้าใช้งานหน้านี้
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-7xl mx-auto px-1 sm:px-0">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <Banknote className="h-8 w-8" /> เบิกจ่าย Petty Cash (หน้างาน)
          </h1>
          <p className="text-muted-foreground text-lg max-w-3xl">
            กองเงิน Petty แยกจาก “สมุดรายรับ-รายจ่าย” ฝ่ายบัญชี — ใช้เพื่อตามเงินโอนมาใช้หน้างาน รับ-จ่าย
            โดยฝ่ายปฏิบัติการ ยอดโอนเข้า-ออกที่ลงฝ่ายบัญชีจะแสดงในตารางเพื่อให้เห็นยอดเงินสดยังอยู่หน้างานเท่าใด
            (โอนระหว่างบัญชีฝากธนาคารเอง ไม่ใช่ “เงินเข้า-ออก กอง” ของ Petty) — รายการด้านล่างสำหรับ
            มุมมองกอง: รับ-จ่าย/คงเหลือเงินสดหน้างาน
          </p>
        </div>

        {!loadingPetty && (!pettyAccounts || pettyAccounts.length === 0) && (
          <Card className="border-dashed border-primary/30 bg-primary/5">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Wallet className="h-5 w-5" /> ยังไม่มีบัญชี Petty Cash
              </CardTitle>
              <CardDescription>
                ให้ฝ่ายบัญชีเปิดบัญชีประเภท Petty Cash ที่เมนูบัญชีธนาคาร หรือกดปุ่มด้านล่าง (ถ้ามีสิทธิ์)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {canView(currentUser, 'bank_accounts') && (
                <Button asChild className="font-bold">
                  <Link href="/bank-accounts/new?preset=petty">สร้างบัญชี Petty Cash</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {pettyAccounts && pettyAccounts.length > 0 && (
          <>
            <Card className="w-full">
              <CardHeader>
                <CardTitle className="text-lg">บันทึกรายการ</CardTitle>
                <CardDescription>
                  ฝ่ายปฏิบัติการบันทึกรับ/จ่ายเงินสดกอง Petty หน้างาน — รายการโอนเข้า-ออกจากฝ่ายบัญชี
                  ดูได้ในตาราง &quot;รายการเคลื่อนไหว&quot; ด้านล่าง
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4 lg:items-end">
                  <div className="space-y-2 lg:col-span-1">
                    <Label>บัญชี Petty Cash</Label>
                    <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                      <SelectTrigger className="h-11">
                        <SelectValue placeholder="เลือกบัญชี" />
                      </SelectTrigger>
                      <SelectContent>
                        {pettyAccounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.accountCode} — {a.accountName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {selectedAccount && (
                    <div className="rounded-lg border bg-muted/40 p-3 md:min-h-[4.5rem]">
                      <p className="text-xs font-bold uppercase text-muted-foreground">ยอดคงเหลือปัจจุบัน (ระบบ)</p>
                      <p className="text-xl font-black text-primary">
                        {selectedAccount.currency}{' '}
                        {(Number(selectedAccount.currentBalance) || 0).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                        })}
                      </p>
                      {canView(currentUser, 'bank_accounts') && (
                        <Button type="button" variant="outline" size="sm" className="mt-2" asChild>
                          <Link href={`/bank-accounts/${selectedAccount.id}`}>รายละเอียดกอง / รายการเคลื่อนไหว (เต็ม)</Link>
                        </Button>
                      )}
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label>ทิศทาง</Label>
                    <Select value={direction} onValueChange={(v: 'IN' | 'OUT') => setDirection(v)}>
                      <SelectTrigger className="h-11">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="IN">รับเงินเข้า (IN)</SelectItem>
                        <SelectItem value="OUT">จ่ายออก (OUT)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>วันที่</Label>
                    <DatePickerThaiBE
                      className="h-11"
                      value={htmlDateValueToTimestampMs(entryDate)}
                      onChange={(ms) => setEntryDate(timestampToHtmlDateValue(ms))}
                    />
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-end">
                  <div className="space-y-2 lg:col-span-5">
                    <Label>รายละเอียด</Label>
                    <Input
                      className="h-11"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="เช่น ค่าอุปกรณ์หน้างาน, ค่ารถรับส่ง"
                    />
                  </div>
                  <div className="space-y-2 lg:col-span-2">
                    <Label>จำนวนเงิน</Label>
                    <Input
                      type="number"
                      className="h-11 font-bold text-lg"
                      value={amount || ''}
                      onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <div className="lg:col-span-2">
                    <Button className="h-11 w-full font-bold gap-2" onClick={handleSubmit} disabled={saving}>
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      บันทึกรายการ
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="w-full">
              <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <List className="h-5 w-5 text-primary" />
                    รายการเคลื่อนไหว — รายรับ-รายจ่าย-คงเหลือ (กอง {selectedAccount?.accountCode})
                  </CardTitle>
                  <CardDescription>
                    รวม (1) รายการโอนเงินเข้า/ออก ที่ฝ่ายบัญชีลงใน cashbook สำหรับกองนี้
                    (เช่น โอนจากบัญชีธนาคาร) กับ (2) รายรับ-จ่าย ที่ฝ่ายหน้างานลงใน Petty
                    ยอด &quot;ยกมา&quot; = ยอดตั้งต้น (ตั้งบัญชี) + รายการสะสมก่อนเดือนที่เลือก
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">กรองตามเดือน</Label>
                    <Input
                      type="month"
                      className="w-[min(100%,14rem)] font-mono"
                      value={selectedMonth}
                      onChange={(e) => setSelectedMonth(e.target.value)}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {movementBlockLoading ? (
                  <div className="py-12 text-center text-muted-foreground">
                    <Loader2 className="h-8 w-8 animate-spin text-primary inline" />
                  </div>
                ) : (
                  <>
                    <div className="mb-4 flex flex-col gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
                      <div className="grid gap-1 sm:grid-cols-3 sm:gap-4">
                        <div>
                          <span className="text-muted-foreground">ยอดตั้งต้น (ตอนสร้างกอง / งบยกมา):</span>{' '}
                          <span className="font-mono font-bold">
                            ฿ {openingBalanceNum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">รายก่อนเดือนนี้ (สะสม):</span>{' '}
                          <span className={preMonthNet >= 0 ? 'font-mono font-bold text-emerald-800' : 'font-mono font-bold text-red-800'}>
                            {preMonthNet >= 0 ? '+' : '−'}฿ {Math.abs(preMonthNet).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">ยอดยกมา ณ วันต้นเดือน:</span>{' '}
                          <span className="font-mono font-black text-primary">
                            ฿ {balanceAtStartOfSelectedMonth.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 border-t border-primary/10 pt-2 text-xs text-muted-foreground md:flex-row md:flex-wrap md:items-center md:gap-3">
                        <span>
                          รวมรับเดือนนี้:{' '}
                          <span className="font-bold text-emerald-800">
                            ฿ {monthTotals.totalIn.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </span>
                        <span className="hidden md:inline">|</span>
                        <span>
                          รวมจ่ายเดือนนี้:{' '}
                          <span className="font-bold text-red-800">
                            ฿ {monthTotals.totalOut.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </span>
                        <span className="hidden md:inline">|</span>
                        <span>
                          สุทธิเดือน (รับ−จ่าย):{' '}
                          <span className="font-black text-primary">
                            ฿ {monthTotals.net.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </span>
                        {selectedAccount && (
                          <>
                            <span className="hidden md:inline">|</span>
                            <span>
                              ยอดระบบ (กอง):{' '}
                              <span className="font-mono font-bold">
                                ฿ {(Number(selectedAccount.currentBalance) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <p className="mb-2 text-xs text-muted-foreground">
                      แถวแรกในตารางคือ ยอดยกมา ก่อนรายการในเดือน — แถวถัดไปรวมโอนจากธนาคาร (ฝ่ายบัญชี) และรายลงเอง (ฝ่ายหน้างาน)
                    </p>
                    <div className="overflow-x-auto rounded-md border">
                      <Table className="min-w-[920px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[6.5rem]">วันที่</TableHead>
                            <TableHead className="w-[6.5rem]">เลขที่</TableHead>
                            <TableHead className="min-w-[12rem]">รายละเอียด / ประเภท</TableHead>
                            <TableHead className="w-[6.5rem] text-right">รับ (เข้า)</TableHead>
                            <TableHead className="w-[6.5rem] text-right">จ่าย (ออก)</TableHead>
                            <TableHead className="w-[7.5rem] text-right">คงเหลือ</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          <TableRow className="bg-muted/50 font-medium">
                            <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                              {formatStoredDateThaiBE(monthStart)}
                            </TableCell>
                            <TableCell className="text-xs">—</TableCell>
                            <TableCell>
                              <div className="text-sm font-bold">ยอดยกมา (ก่อนรายการในเดือน)</div>
                              <div className="text-[11px] text-muted-foreground">
                                ยอดตั้งต้น ฿ {openingBalanceNum.toLocaleString(undefined, { minimumFractionDigits: 2 })} + รายสะสมก่อนเดือน{' '}
                                {preMonthNet >= 0 ? '+' : '−'}
                                {Math.abs(preMonthNet).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </div>
                            </TableCell>
                            <TableCell className="text-right text-sm text-muted-foreground">—</TableCell>
                            <TableCell className="text-right text-sm text-muted-foreground">—</TableCell>
                            <TableCell className="text-right text-sm font-bold text-primary">
                              ฿ {balanceAtStartOfSelectedMonth.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </TableCell>
                          </TableRow>
                          {movementRowsWithBalance.map((row) => {
                            const inAm = row.direction === 'IN' ? row.amount : 0;
                            const outAm = row.direction === 'OUT' ? row.amount : 0;
                            return (
                              <TableRow key={row.key}>
                                <TableCell className="whitespace-nowrap text-sm">
                                  {formatStoredDateThaiBE(row.entryDate)}
                                </TableCell>
                                <TableCell className="font-mono text-xs font-medium">{row.entryNo}</TableCell>
                                <TableCell>
                                  <div className="text-sm font-medium">{row.description}</div>
                                  <div className="mt-0.5 flex flex-wrap items-center gap-1">
                                    <Badge variant="secondary" className="text-[10px]">
                                      {row.source === 'petty' ? 'ฝ่ายหน้างาน' : 'ฝ่ายบัญชี (รวมโอนจากธ.ก.)'}
                                    </Badge>
                                    <span className="text-[11px] text-muted-foreground">{row.entryType}</span>
                                    {row.paymentMethod && (
                                      <span className="text-[11px] text-muted-foreground">· {row.paymentMethod}</span>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="text-right text-sm font-medium text-emerald-800">
                                  {inAm > 0
                                    ? `฿ ${inAm.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                    : '—'}
                                  {row.direction === 'IN' && <ArrowDownLeft className="ml-1 inline h-3.5 w-3.5 opacity-60" />}
                                </TableCell>
                                <TableCell className="text-right text-sm font-medium text-red-800">
                                  {outAm > 0
                                    ? `฿ ${outAm.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                    : '—'}
                                  {row.direction === 'OUT' && <ArrowUpRight className="ml-1 inline h-3.5 w-3.5 opacity-60" />}
                                </TableCell>
                                <TableCell className="text-right text-sm font-bold text-primary">
                                  ฿ {row.balanceAfter.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                          {movementRowsWithBalance.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                                ยังไม่มีรายการเคลื่อนไหวในเดือน {formatStoredDateThaiBE(monthStart)} – {formatStoredDateThaiBE(monthEnd)} (ยอดยกมาข้างบนใช้คำนวณต่อ)
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
