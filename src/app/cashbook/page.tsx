
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  BookOpen, 
  Plus, 
  Search, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Building2, 
  Calendar,
  Wallet,
  Coins,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Info,
  Loader2,
  Printer,
} from 'lucide-react';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { Input } from '@/components/ui/input';
import { formatPayrollYearMonthThaiBE, formatStoredDateThaiBE, htmlDateValueToTimestampMs, timestampToHtmlDateValue } from '@/lib/date-thai';
import { CashbookEntry, User, BankAccount } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, orderBy, limit } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription,
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { getPreviewPattern } from '@/lib/services/numbering-service';
import { recordCashbookMovementWithBalance, updateCashbookEntryAdminCorrection } from '@/lib/services/cashbook-bank-movement';
import { useAppUser } from '@/hooks/use-app-user';
import { canView, canCreate, isSystemAdmin } from '@/lib/permissions';
import { isSimpleAdmin } from '@/lib/simple-tier-model';
import { Textarea } from '@/components/ui/textarea';
import { cashbookPnlFromEntries } from '@/lib/cashbook-pnl-stats';
import {
  buildCashbookListPrintHtml,
  buildCashbookListPrintRow,
  capCashbookListPrintRows,
  describeCashbookListPrintFilters,
  fmtCashbookPrintBaht,
} from '@/lib/documents/cashbook-list-print';
import { openStandardPrintWindow } from '@/lib/documents/standard-document-print';

export default function CashbookPage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const canViewPage = useMemo(() => canView(currentUser, 'cashbook'), [currentUser]);
  const canWriteCashbook = useMemo(() => canCreate(currentUser, 'cashbook'), [currentUser]);
  /** แก้รายละเอียด/ยอดรายการที่มีแล้ว — เฉพาะ admin */
  const canAdminEditCashbook = useMemo(
    () => isSystemAdmin(currentUser) || isSimpleAdmin(currentUser),
    [currentUser],
  );

  const entriesQuery = useMemoFirebase(() => {
    if (!firestore || !canViewPage) return null;
    return query(collection(firestore, 'cashbook_entries'), orderBy('entryDate', 'desc'), limit(2000));
  }, [firestore, canViewPage]);

  const { data: entries, isLoading } = useCollection<CashbookEntry>(entriesQuery as any);

  const bankAccountsQuery = useMemoFirebase(() => (firestore && canViewPage ? collection(firestore, 'bank_accounts') : null), [firestore, canViewPage]);
  const { data: bankAccounts } = useCollection<BankAccount>(bankAccountsQuery as any);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [editEntry, setEditEntry] = useState<CashbookEntry | null>(null);
  const [editDescription, setEditDescription] = useState('');
  const [editAmount, setEditAmount] = useState(0);
  const [editDirection, setEditDirection] = useState<'IN' | 'OUT'>('OUT');
  const [editSaving, setEditSaving] = useState(false);
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [monthYm, setMonthYm] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [newEntry, setNewEntry] = useState<Partial<CashbookEntry>>({
    entryNo: getPreviewPattern('cashbook_entry'),
    entryDate: timestampToHtmlDateValue(Date.now()),
    direction: 'OUT',
    paymentMethod: 'TRANSFER',
    amount: 0,
    description: '',
    entryType: 'OTHER'
  });

  /** เรียงซ้ำตามวันเดียวกันให้คงที่ + กัน toLocaleString พังเมื่อ amount ไม่ใช่ตัวเลข */
  const sortedEntries = useMemo(() => {
    if (!entries?.length) return entries;
    return [...entries].sort((a, b) => {
      const c = String(b.entryDate || '').localeCompare(String(a.entryDate || ''));
      if (c !== 0) return c;
      return String(b.entryNo || '').localeCompare(String(a.entryNo || ''), undefined, { numeric: true });
    });
  }, [entries]);

  const monthFilteredEntries = useMemo(() => {
    const list = sortedEntries ?? [];
    return list.filter((entry) => String(entry.entryDate || '').slice(0, 7) === monthYm);
  }, [sortedEntries, monthYm]);

  const stats = useMemo(
    () => cashbookPnlFromEntries(monthFilteredEntries, bankAccounts),
    [monthFilteredEntries, bankAccounts],
  );

  const bankById = useMemo(() => {
    const m = new Map<string, BankAccount>();
    for (const b of bankAccounts ?? []) m.set(b.id, b);
    return m;
  }, [bankAccounts]);

  const filteredEntries = useMemo(() => {
    const list = monthFilteredEntries;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((entry) => {
      const bank = bankById.get(entry.bankAccountId);
      const haystack = [
        entry.description,
        entry.entryNo,
        entry.entryType,
        entry.referenceId,
        entry.entryDate,
        entry.paymentMethod,
        entry.direction,
        bank?.accountCode,
        bank?.bankName,
        bank?.accountName,
        bank?.accountNumber,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [monthFilteredEntries, searchQuery, bankById]);

  const printFilterLines = useMemo(
    () => describeCashbookListPrintFilters(searchQuery, monthYm),
    [searchQuery, monthYm],
  );

  const runCashbookListPrint = useCallback(
    async (scope: 'filtered' | 'all') => {
      const source = scope === 'filtered' ? filteredEntries : monthFilteredEntries;
      if (source.length === 0) {
        toast({
          variant: 'destructive',
          title: 'ไม่มีรายการให้พิมพ์',
          description:
            scope === 'filtered'
              ? 'ไม่พบข้อมูลตามตัวกรอง — ปรับตัวกรองหรือเลือกพิมพ์ทั้งเดือน'
              : `ยังไม่มีรายการในเดือน ${formatPayrollYearMonthThaiBE(monthYm)}`,
        });
        return;
      }

      setPrintBusy(true);
      try {
        const printRows = source.map((entry) => {
          const bank = bankById.get(entry.bankAccountId);
          const bankLabel = bank?.accountCode || bank?.bankName || '—';
          return buildCashbookListPrintRow(entry, bankLabel);
        });
        const { rows, truncated } = capCashbookListPrintRows(printRows);
        const printStats = cashbookPnlFromEntries(source, bankAccounts);
        const generatedAt = new Date().toLocaleString('th-TH', {
          dateStyle: 'medium',
          timeStyle: 'short',
        });
        const filterLines = scope === 'filtered' ? printFilterLines : describeCashbookListPrintFilters('', monthYm);
        const scopeTitle =
          scope === 'filtered' ? 'พิมพ์ตามตัวกรองปัจจุบัน' : 'พิมพ์ทั้งเดือนที่เลือก';

        const body = buildCashbookListPrintHtml({
          rows,
          scopeTitle,
          filterLines,
          pnlInLabel: fmtCashbookPrintBaht(printStats.pnlIn),
          pnlOutLabel: fmtCashbookPrintBaht(printStats.pnlOut),
          netLabel: fmtCashbookPrintBaht(printStats.net),
          generatedAt,
          printedBy: currentUser?.displayName,
          truncated,
        });

        const ok = await openStandardPrintWindow({
          windowTitle: 'Cashbook-List',
          suggestedFileName: `Cashbook-List-${scope === 'filtered' ? 'Filtered' : 'Month'}`,
          bodyInnerHtml: body,
          htmlLang: 'th',
        });

        if (!ok) {
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
    [
      filteredEntries,
      monthFilteredEntries,
      bankById,
      bankAccounts,
      printFilterLines,
      monthYm,
      currentUser?.displayName,
      toast,
    ],
  );

  const openEditEntry = useCallback((entry: CashbookEntry) => {
    if (!canAdminEditCashbook) return;
    setEditEntry(entry);
    setEditDescription(String(entry.description || ''));
    setEditAmount(Number(entry.amount) || 0);
    setEditDirection(entry.direction === 'IN' ? 'IN' : 'OUT');
  }, [canAdminEditCashbook]);

  const handleSaveEdit = async () => {
    if (!firestore || !currentUser || !editEntry) return;
    if (!canAdminEditCashbook) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'แก้ไขรายการได้เฉพาะผู้ดูแลระบบ (Admin)' });
      return;
    }
    setEditSaving(true);
    try {
      await updateCashbookEntryAdminCorrection(firestore, currentUser as User, {
        entryId: editEntry.id,
        description: editDescription,
        amount: editAmount,
        direction: editDirection,
      });
      toast({ title: 'บันทึกการแก้ไขแล้ว', description: editEntry.entryNo || editEntry.id });
      setEditEntry(null);
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'แก้ไขไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setEditSaving(false);
    }
  };

  const handleCreate = async () => {
    if (!firestore || !currentUser) return;
    if (!canWriteCashbook) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'บทบาทนี้ดูข้อมูลได้อย่างเดียว — ไม่สามารถบันทึกรายการใหม่ได้' });
      return;
    }
    if (!newEntry.bankAccountId || !newEntry.amount || !newEntry.description) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาระบุบัญชีธนาคาร ยอดเงิน และรายละเอียด" });
      return;
    }

    setIsCreating(true);
    try {
      const { entryNo: finalNo } = await recordCashbookMovementWithBalance(firestore, currentUser as User, {
        bankAccountId: String(newEntry.bankAccountId),
        direction: newEntry.direction === 'IN' ? 'IN' : 'OUT',
        amount: Number(newEntry.amount),
        entryDate: String(newEntry.entryDate || '').trim(),
        description: String(newEntry.description || '').trim(),
        paymentMethod: (newEntry.paymentMethod || 'TRANSFER') as import('@/lib/types').PaymentMethod,
        entryType: (newEntry.entryType || 'OTHER') as import('@/lib/types').CashbookEntryType,
      });

      setIsDialogOpen(false);
      toast({
        title: 'บันทึกรายการสำเร็จ',
        description: `เลขที่รายการ: ${finalNo} · ยอดบัญชีธนาคารอัปเดตแล้ว`,
      });
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถบันทึกข้อมูลได้" });
    } finally {
      setIsCreating(false);
    }
  };

  if (isUserLoading || userLoading || !currentUser) return null;

  if (!canViewPage) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="max-w-xl mx-auto py-20 text-center text-muted-foreground">
          คุณไม่มีสิทธิ์เข้าใช้งานหน้ารายรับรายจ่าย (ฝ่ายบัญชี)
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <BookOpen className="h-8 w-8" /> รายรับรายจ่าย (Cashbook)
          </h1>
          <p className="text-muted-foreground text-lg">
            รายละเอียดรายรายการด้านล่างคือความเคลื่อนไหวตามบัญชี — การ์ดสรุป 3 ใบด้านบนคือ
            รายรับ–รายจ่าย ตามรายงาน: ไม่นับ โอน ธ-ธ, ไม่นับ รับโอนเข้า Petty เป็นขาย
            (นับ โอน ธ-ฝ → Petty ฝั่ง ธ-ฝ เป็นรายจ่าย, นับ โอน คืน Petty → ธ-ฝ ฝั่ง ธ-ฝ เป็นรายรับ)
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border-l-8 border-l-green-600">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase text-muted-foreground">รายรับ (รับเก็บ / นับ งบ)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-green-700">฿ {stats.pnlIn.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-1">
                <TrendingUp className="h-3 w-3 text-green-600" /> รวม: รับลูกค้า, รับเงินคืนจาก Petty — ยกเว้นโอน ธ-ธ, รับ Petty
              </div>
            </CardContent>
          </Card>
          <Card className="border-l-8 border-l-red-600">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase text-muted-foreground">รายจ่าย (จ่ายจริง / นับ งบ)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-red-600">฿ {stats.pnlOut.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-1">
                <TrendingDown className="h-3 w-3 text-red-600" /> รวม: คู่ค้า, เงินเดือน, ภาษี, อื่น ๆ, โอนไป Petty
              </div>
            </CardContent>
          </Card>
          <Card className="border-l-8 border-l-primary bg-primary/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase text-muted-foreground">รายรับ - รายจ่าย (งบ) สุทธิ</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-primary">฿ {stats.net.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
              <p className="text-[10px] text-muted-foreground mt-1">
                งวด {formatPayrollYearMonthThaiBE(monthYm)} · จากรายการในเดือนที่เลือก (ไม่รวมโอนภายใน ธ-ธ เป็นขาย-ซื้อ)
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="ค้นหาตามรายละเอียด หรือ บัญชี..."
                className="pl-9 h-11"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Calendar className="h-4 w-4 text-muted-foreground hidden sm:block" aria-hidden />
              <Input
                type="month"
                className="h-11 w-[min(100%,11rem)] font-mono"
                value={monthYm}
                onChange={(e) => setMonthYm(e.target.value)}
                aria-label="กรองตามเดือน"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              className="h-11 gap-2 px-4"
              disabled={isLoading || monthFilteredEntries.length === 0}
              onClick={() => setPrintDialogOpen(true)}
            >
              <Printer className="h-4 w-4" />
              พิมพ์รายการ
            </Button>

            <Dialog open={printDialogOpen} onOpenChange={setPrintDialogOpen}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>พิมพ์รายการรายรับรายจ่าย</DialogTitle>
                  <DialogDescription>
                    เลือกพิมพ์ตามคำค้นหาในเดือนที่เลือก หรือพิมพ์ทุกรายการในเดือนนั้น (สูงสุด 500 รายการ)
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 text-sm">
                  <div className="rounded-md border bg-muted/30 p-3 space-y-1">
                    <p className="font-semibold text-xs uppercase text-muted-foreground">ตัวกรองปัจจุบัน</p>
                    <ul className="list-disc list-inside text-xs text-muted-foreground">
                      {printFilterLines.length > 0 ? (
                        printFilterLines.map((line) => <li key={line}>{line}</li>)
                      ) : (
                        <li>เดือน: {formatPayrollYearMonthThaiBE(monthYm)} ({monthYm})</li>
                      )}
                    </ul>
                    <p className="text-xs font-medium pt-1">จะพิมพ์ {filteredEntries.length} รายการ</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    ทั้งเดือน {formatPayrollYearMonthThaiBE(monthYm)}: {monthFilteredEntries.length} รายการ
                  </p>
                </div>
                <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={printBusy || filteredEntries.length === 0}
                    onClick={() => void runCashbookListPrint('filtered')}
                  >
                    {printBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    พิมพ์ตามตัวกรอง ({filteredEntries.length})
                  </Button>
                  <Button
                    type="button"
                    disabled={printBusy || monthFilteredEntries.length === 0}
                    onClick={() => void runCashbookListPrint('all')}
                  >
                    {printBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    พิมพ์ทั้งเดือน ({monthFilteredEntries.length})
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={canWriteCashbook && isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 h-11 px-6 bg-primary shadow-md text-base font-bold" disabled={!canWriteCashbook}>
                <Plus className="h-5 w-5" /> บันทึกรายการใหม่ (Manual Entry)
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>บันทึกรายรับ-รายจ่าย</DialogTitle>
                <DialogDescription>บันทึกความเคลื่อนไหวทางการเงินที่ไม่ได้เกิดจากใบแจ้งหนี้โดยตรง</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                <div className="space-y-2 md:col-span-2">
                  <Label>เลขที่รายการ (Entry No.)</Label>
                  <Input value={newEntry.entryNo} disabled className="bg-muted font-mono font-bold text-primary" />
                </div>
                <div className="space-y-2">
                  <Label>ทิศทางเงิน</Label>
                  <Select onValueChange={(v: any) => setNewEntry({...newEntry, direction: v})} defaultValue={newEntry.direction}>
                    <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="IN">เงินรับเข้า (IN)</SelectItem>
                      <SelectItem value="OUT">เงินจ่ายออก (OUT)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>วันที่ทำรายการ</Label>
                  <DatePickerThaiBE
                    className="h-11"
                    value={htmlDateValueToTimestampMs(newEntry.entryDate)}
                    onChange={(ms) => setNewEntry({ ...newEntry, entryDate: timestampToHtmlDateValue(ms) })}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>บัญชีธนาคาร (Bank Account)</Label>
                  <Select onValueChange={v => setNewEntry({...newEntry, bankAccountId: v})}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="เลือกบัญชี..." /></SelectTrigger>
                    <SelectContent>
                      {bankAccounts?.map(b => (
                        <SelectItem key={b.id} value={b.id}>{b.accountCode} - {b.bankName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>รายละเอียด (Description)</Label>
                  <Input value={newEntry.description} onChange={e => setNewEntry({...newEntry, description: e.target.value})} placeholder="เช่น ค่าที่พักพนักงาน, โอนเงินระหว่างบัญชี" className="h-11" />
                </div>
                <div className="space-y-2">
                  <Label>จำนวนเงิน (Amount)</Label>
                  <Input type="number" className="h-11 font-bold text-lg" value={newEntry.amount} onChange={e => setNewEntry({...newEntry, amount: parseFloat(e.target.value)})} />
                </div>
                <div className="space-y-2">
                  <Label>วิธีชำระเงิน</Label>
                  <Select onValueChange={(v: any) => setNewEntry({...newEntry, paymentMethod: v})} defaultValue={newEntry.paymentMethod}>
                    <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TRANSFER">โอนเงิน (Transfer)</SelectItem>
                      <SelectItem value="CASH">เงินสด (Cash)</SelectItem>
                      <SelectItem value="CHEQUE">เช็ค (Cheque)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isCreating}>ยกเลิก</Button>
                <Button onClick={handleCreate} className="bg-primary font-bold" disabled={isCreating}>
                  {isCreating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  บันทึกข้อมูล (Confirm)
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </div>
        </div>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-20 text-center text-muted-foreground animate-pulse">กำลังโหลดข้อมูล Cashbook...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4 pl-6">เลขที่ / วันที่</TableHead>
                    <TableHead className="font-bold">รายละเอียด (Description)</TableHead>
                    <TableHead className="font-bold">บัญชีธนาคาร</TableHead>
                    <TableHead className="font-bold">วิธีชำระ</TableHead>
                    <TableHead className="font-bold text-right">เงินเข้า (In)</TableHead>
                    <TableHead className="font-bold text-right">เงินออก (Out)</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEntries?.map((entry) => {
                    const bankAccount = bankById.get(entry.bankAccountId);
                    const amt = Number(entry.amount);
                    const safeAmt = Number.isFinite(amt) ? amt : 0;
                    const payrollBankHint =
                      entry.entryType === 'PAYROLL' &&
                      bankAccount?.accountCode &&
                      !(entry.description || '').includes('ตัดจากบัญชี')
                        ? ` · ตัดจากบัญชี ${bankAccount.accountCode}`
                        : '';
                    return (
                      <TableRow key={entry.id} className="hover:bg-muted/20">
                        <TableCell className="py-4 pl-6 font-medium text-xs">
                          <div className="flex flex-col gap-1">
                            <span className="font-mono font-bold text-primary">{entry.entryNo || entry.id.substring(0,8)}</span>
                            <span className="flex items-center gap-1 text-muted-foreground">
                              <Calendar className="h-3 w-3" /> {formatStoredDateThaiBE(entry.entryDate)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-bold text-sm text-primary">
                              {entry.description}
                              {payrollBankHint}
                            </span>
                            <span className="text-[10px] text-muted-foreground uppercase">{entry.entryType} {entry.referenceId ? `| Ref: ${entry.referenceId.substring(0,8)}` : ''}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                            <Wallet className="h-3.5 w-3.5 text-muted-foreground" />
                            {bankAccount?.accountCode || 'N/A'}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[9px] font-bold uppercase">{entry.paymentMethod}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {entry.direction === 'IN' ? (
                            <span className="font-black text-green-700">฿ {safeAmt.toLocaleString()}</span>
                          ) : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          {entry.direction === 'OUT' ? (
                            <span className="font-black text-red-600">฿ {safeAmt.toLocaleString()}</span>
                          ) : '-'}
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          {canAdminEditCashbook ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              title="แก้ไขรายละเอียด / ยอดเงิน"
                              onClick={() => openEditEntry(entry)}
                            >
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          ) : (
                            <span className="inline-flex h-9 w-9 items-center justify-center text-muted-foreground/40">
                              <ChevronRight className="h-4 w-4" />
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {(!filteredEntries || filteredEntries.length === 0) && !isLoading && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-20 text-muted-foreground italic">
                        {searchQuery.trim()
                          ? `ไม่พบรายการที่ตรงกับ "${searchQuery.trim()}" ในเดือน ${formatPayrollYearMonthThaiBE(monthYm)}`
                          : `ไม่มีรายการในเดือน ${formatPayrollYearMonthThaiBE(monthYm)}`}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Dialog
          open={!!editEntry}
          onOpenChange={(open) => {
            if (!open && !editSaving) setEditEntry(null);
          }}
        >
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>แก้ไขรายการ Cashbook</DialogTitle>
              <DialogDescription>
                แก้รายละเอียดหรือยอดที่พิมพ์ผิด — เฉพาะ Admin · ยอดบัญชีธนาคารจะถูกปรับตามส่วนต่างอัตโนมัติ
              </DialogDescription>
            </DialogHeader>
            {editEntry ? (
              <div className="space-y-4 py-2">
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs space-y-1">
                  <p>
                    <span className="text-muted-foreground">เลขที่: </span>
                    <span className="font-mono font-bold text-primary">{editEntry.entryNo || editEntry.id}</span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">วันที่: </span>
                    {formatStoredDateThaiBE(editEntry.entryDate)}
                  </p>
                  <p>
                    <span className="text-muted-foreground">ประเภท: </span>
                    {editEntry.entryType}
                    {editEntry.referenceId ? ` · Ref ${editEntry.referenceId.slice(0, 12)}` : ''}
                  </p>
                </div>
                {editEntry.entryType === 'TRANSFER' ? (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                    รายการโอนระหว่างบัญชี — แก้ยอดฝั่งนี้จะไม่แก้คู่โอนอีกฝั่งอัตโนมัติ ตรวจคู่รายการด้วย
                  </p>
                ) : null}
                <div className="space-y-2">
                  <Label htmlFor="cb-edit-desc">รายละเอียด</Label>
                  <Textarea
                    id="cb-edit-desc"
                    rows={3}
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    disabled={editSaving}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>ทิศทาง</Label>
                    <Select
                      value={editDirection}
                      onValueChange={(v: 'IN' | 'OUT') => setEditDirection(v)}
                      disabled={editSaving}
                    >
                      <SelectTrigger className="h-11">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="IN">เงินเข้า (In)</SelectItem>
                        <SelectItem value="OUT">เงินออก (Out)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cb-edit-amt">จำนวนเงิน</Label>
                    <Input
                      id="cb-edit-amt"
                      type="number"
                      min={0}
                      step={0.01}
                      className="h-11 font-bold text-lg"
                      value={editAmount}
                      onChange={(e) => setEditAmount(parseFloat(e.target.value) || 0)}
                      disabled={editSaving}
                    />
                  </div>
                </div>
              </div>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditEntry(null)} disabled={editSaving}>
                ยกเลิก
              </Button>
              <Button type="button" className="font-bold" onClick={() => void handleSaveEdit()} disabled={editSaving}>
                {editSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                บันทึกการแก้ไข
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
