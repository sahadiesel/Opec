
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Plus, 
  Search, 
  ChevronRight, 
  CreditCard, 
  Info, 
  Trash2,
  Wallet,
  Loader2,
  ArrowLeftRight
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { BankAccount, BankAccountType, User } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { canView, canCreate } from '@/lib/permissions';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue } from '@/lib/date-thai';
import { recordInterBankTransfer } from '@/lib/services/cashbook-bank-movement';
import { syncBankCurrentBalanceIfDrift } from '@/lib/services/bank-balance-reconcile';
import { computeOdBalanceDelta, formatSignedBahtDelta, hasConfiguredOdLimit, isCurrentBankAccount } from '@/lib/bank-account-od';

function accountTypeLabel(t: BankAccountType | string): string {
  switch (t) {
    case 'SAVINGS':
      return 'SAVINGS';
    case 'CURRENT':
      return 'CURRENT';
    case 'CASH':
      return 'CASH';
    case 'PETTY_CASH':
      return 'PETTY CASH';
    default:
      return String(t);
  }
}

export default function BankAccountsPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const isAuthorized = useMemo(() => {
    if (!currentUser) return false;
    return canView(currentUser, 'bank_accounts');
  }, [currentUser]);

  const canWriteBank = useMemo(
    () => (currentUser ? canCreate(currentUser, 'bank_accounts') : false),
    [currentUser]
  );

  const canReconcileBalances = useMemo(
    () =>
      !!currentUser &&
      (canCreate(currentUser, 'bank_accounts') || canCreate(currentUser, 'cashbook')),
    [currentUser],
  );

  const [transferOpen, setTransferOpen] = useState(false);
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [transferAmount, setTransferAmount] = useState(0);
  const [transferDate, setTransferDate] = useState(timestampToHtmlDateValue(Date.now()));
  const [transferMemo, setTransferMemo] = useState('โอนระหว่างบัญชี');
  const [searchQuery, setSearchQuery] = useState('');

  const accountsQuery = useMemoFirebase(() => {
    if (!firestore || isUserLoading || !firebaseUser || !isAuthorized) return null;
    return collection(firestore, 'bank_accounts');
  }, [firestore, isUserLoading, firebaseUser, isAuthorized]);

  const { data: accounts, isLoading } = useCollection<BankAccount>(accountsQuery as any);

  const filteredAccounts = useMemo(() => {
    const list = accounts ?? [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((acc) => {
      const haystack = [
        acc.accountCode,
        acc.bankName,
        acc.accountName,
        acc.accountNumber,
        acc.accountType,
        acc.status,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [accounts, searchQuery]);

  const accountIdsKey = useMemo(() => (accounts ?? []).map((a) => a.id).sort().join(','), [accounts]);

  useEffect(() => {
    if (!firestore || !accountIdsKey || !canReconcileBalances) return;
    const ids = accountIdsKey.split(',').filter(Boolean);
    if (!ids.length) return;
    let cancelled = false;
    void (async () => {
      try {
        let anyCorrected = false;
        for (const id of ids) {
          if (cancelled) break;
          const { corrected } = await syncBankCurrentBalanceIfDrift(firestore, id);
          if (corrected) anyCorrected = true;
        }
        if (!cancelled && anyCorrected) {
          toast({
            title: 'ซิงค์ยอดบัญชีแล้ว',
            description: 'ปรับยอดเงินปัจจุบันในตารางให้ตรงกับรายการ cashbook / Petty',
          });
        }
      } catch {
        /* สิทธิ์หรือเครือข่าย — ไม่บล็อกหน้าจอ */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, accountIdsKey, canReconcileBalances, toast]);

  const handleTransfer = async () => {
    if (!firestore || !currentUser) return;
    if (!fromId || !toId || !transferAmount || transferAmount <= 0) {
      toast({ variant: 'destructive', title: 'ข้อมูลไม่ครบ', description: 'เลือกบัญชีต้นทาง/ปลายทาง และยอดโอน' });
      return;
    }
    setTransferSubmitting(true);
    try {
      const { outEntryNo, inEntryNo } = await recordInterBankTransfer(firestore, currentUser, {
        fromBankAccountId: fromId,
        toBankAccountId: toId,
        amount: transferAmount,
        entryDate: transferDate,
        memo: transferMemo,
      });
      toast({
        title: 'บันทึกการโอนสำเร็จ',
        description: `รายการ ${outEntryNo} / ${inEntryNo}`,
      });
      setTransferOpen(false);
      setFromId('');
      setToId('');
      setTransferAmount(0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'ไม่สามารถบันทึกได้';
      toast({ variant: 'destructive', title: 'โอนไม่สำเร็จ', description: msg });
    } finally {
      setTransferSubmitting(false);
    }
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!firestore) return;
    if (confirm('ยืนยันการลบข้อมูลบัญชีธนาคาร?')) {
      deleteDocumentNonBlocking(doc(firestore, 'bank_accounts', id));
      toast({ title: "ลบข้อมูลสำเร็จ" });
    }
  };

  if (isUserLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
          <div className="min-w-0 lg:max-w-[44%] flex flex-col gap-1">
            <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
              <CreditCard className="h-8 w-8 shrink-0" /> บัญชีธนาคาร (Bank Accounts)
            </h1>
            <p className="text-muted-foreground text-lg">
              จัดการข้อมูลบัญชีธนาคารของบริษัท สำหรับการจ่ายเงินเดือน จ่ายคู่ค้า และรับชำระเงินจากลูกค้า
            </p>
          </div>

          <Alert className="w-full shrink-0 bg-primary/5 border-primary/20 shadow-sm py-2 px-3 lg:flex-1 lg:max-w-[56%] [&>svg]:left-3 [&>svg]:top-2.5 [&>svg+div]:translate-y-0 [&>svg~*]:pl-6">
            <Info className="h-4 w-4 text-primary" />
            <AlertTitle className="mb-0 font-bold text-sm leading-tight">
              นโยบายข้อมูลการเงิน (Financial Data Policy)
            </AlertTitle>
            <AlertDescription className="text-xs leading-tight [&_p]:leading-tight">
              บัญชีธนาคารจะถูกใช้ในระบบรับเงิน จ่ายเงิน และรายงาน Cashbook กรุณาตรวจสอบเลขที่บัญชีให้ถูกต้องเพื่อป้องกันความผิดพลาดในการโอนเงิน
            </AlertDescription>
          </Alert>
        </div>

        <div className="bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative min-w-0 flex-1 sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="ค้นหาตามรหัส หรือ ชื่อบัญชี..."
                className="pl-9 h-11"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0 justify-end">
              <Button
                type="button"
                variant="outline"
                className="h-11 gap-2 font-semibold whitespace-nowrap"
                disabled={!canWriteBank}
                onClick={() => setTransferOpen(true)}
              >
                <ArrowLeftRight className="h-4 w-4" /> โอนระหว่างบัญชี
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11 gap-2 font-semibold whitespace-nowrap"
                disabled={!canWriteBank}
                onClick={() => router.push('/bank-accounts/new?preset=petty')}
              >
                <Wallet className="h-4 w-4" /> สร้างรายการบัญชี Petty Cash
              </Button>
              <Button
                className="gap-2 h-11 px-6 bg-primary font-bold shadow-md whitespace-nowrap"
                disabled={!canWriteBank}
                onClick={() => router.push('/bank-accounts/new')}
              >
                <Plus className="h-5 w-5" /> เพิ่มบัญชีธนาคาร (Add Account)
              </Button>
            </div>
          </div>
        </div>

        <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>โอนระหว่างบัญชี</DialogTitle>
              <DialogDescription>
                สร้างคู่รายการรับ/จ่ายใน Cashbook และปรับยอดบัญชีทั้งสองบัญชี
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="space-y-2">
                <Label>จากบัญชี</Label>
                <Select value={fromId} onValueChange={setFromId}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="เลือกบัญชีต้นทาง" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts?.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.accountCode} — {b.bankName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>ไปบัญชี</Label>
                <Select value={toId} onValueChange={setToId}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="เลือกบัญชีปลายทาง" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts?.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.accountCode} — {b.bankName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>วันที่ทำรายการ</Label>
                <DatePickerThaiBE
                  className="h-11"
                  value={htmlDateValueToTimestampMs(transferDate)}
                  onChange={(ms) => setTransferDate(timestampToHtmlDateValue(ms))}
                />
              </div>
              <div className="space-y-2">
                <Label>จำนวนเงิน</Label>
                <Input
                  type="number"
                  className="h-11 font-bold text-lg"
                  value={transferAmount || ''}
                  onChange={(e) => setTransferAmount(parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-2">
                <Label>หมายเหตุ</Label>
                <Input className="h-11" value={transferMemo} onChange={(e) => setTransferMemo(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setTransferOpen(false)} disabled={transferSubmitting}>
                ยกเลิก
              </Button>
              <Button className="font-bold" onClick={handleTransfer} disabled={transferSubmitting}>
                {transferSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                บันทึกการโอน
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-20 text-center text-muted-foreground animate-pulse">กำลังโหลดข้อมูลบัญชีธนาคาร...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4 pl-6">รหัส (Code)</TableHead>
                    <TableHead className="font-bold">ธนาคาร & ชื่อบัญชี</TableHead>
                    <TableHead className="font-bold">เลขที่บัญชี</TableHead>
                    <TableHead className="font-bold">ประเภท</TableHead>
                    <TableHead className="font-bold text-right">ยอดเทียบ OD</TableHead>
                    <TableHead className="font-bold text-right">ยอดเงินปัจจุบัน</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAccounts.map((acc) => (
                    <TableRow 
                      key={acc.id} 
                      className="cursor-pointer hover:bg-muted/30 group transition-all"
                      onClick={() => router.push(`/bank-accounts/${acc.id}`)}
                    >
                      <TableCell className="py-4 pl-6 font-mono text-xs font-bold text-primary">{acc.accountCode}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-bold text-base text-primary">{acc.bankName}</span>
                          <span className="text-xs text-muted-foreground font-medium">{acc.accountName}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{acc.accountNumber}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] font-bold">
                          {accountTypeLabel(acc.accountType)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {isCurrentBankAccount(acc.accountType) ? (
                          hasConfiguredOdLimit(acc.odLimit) ? (
                            (() => {
                              const delta = computeOdBalanceDelta(acc.currentBalance, acc.odLimit);
                              return (
                                <span
                                  className={`inline-block rounded-md border px-2 py-1 text-sm font-black tabular-nums ${
                                    delta < 0
                                      ? 'border-orange-300/80 bg-orange-50 text-red-600 dark:border-orange-700/60 dark:bg-orange-950/30 dark:text-red-400'
                                      : 'border-orange-300/80 bg-orange-50 text-emerald-900 dark:border-orange-700/60 dark:bg-orange-950/30 dark:text-emerald-300'
                                  }`}
                                >
                                  {formatSignedBahtDelta(delta)}
                                </span>
                              );
                            })()
                          ) : (
                            <span className="text-xs text-muted-foreground">ยังไม่ตั้งวงเงิน OD</span>
                          )
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-black text-primary">
                        {acc.currency} {acc.currentBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell>
                        <Badge variant={acc.status === 'ACTIVE' ? 'default' : 'secondary'} className={acc.status === 'ACTIVE' ? 'bg-green-600' : ''}>
                          {acc.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="icon" className="text-destructive h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => handleDelete(acc.id, e)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          <ChevronRight className="h-5 w-5 text-muted-foreground" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredAccounts.length === 0 && !isLoading && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-20 text-muted-foreground italic">
                        {searchQuery.trim()
                          ? `ไม่พบบัญชีที่ตรงกับ "${searchQuery.trim()}"`
                          : 'ไม่มีข้อมูลบัญชีธนาคารในระบบ'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="bg-primary/5 border-primary/10 border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2 text-primary font-bold">
              <Wallet className="h-5 w-5" /> การใช้งานบัญชีธนาคาร (Account Usage)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
              <div className="p-4 bg-white rounded-md border shadow-sm">
                <p className="font-bold text-primary mb-1">Payroll</p>
                <p className="text-muted-foreground text-xs">ใช้สำรองเงินสำหรับการโอนจ่ายเงินเดือนพนักงานและคนงาน</p>
              </div>
              <div className="p-4 bg-white rounded-md border shadow-sm">
                <p className="font-bold text-primary mb-1">Supplier Payment</p>
                <p className="text-muted-foreground text-xs">ใช้สำหรับชำระค่าสินค้าและบริการให้กับคู่ค้า (Vendors)</p>
              </div>
              <div className="p-4 bg-white rounded-md border shadow-sm">
                <p className="font-bold text-primary mb-1">Tax invoices / AR</p>
                <p className="text-muted-foreground text-xs">ระบุเป็นบัญชีที่ลูกค้าโอนเงินเข้าเมื่อชำระค่าบริการ</p>
              </div>
              <div className="p-4 bg-white rounded-md border shadow-sm">
                <p className="font-bold text-primary mb-1">Cashbook</p>
                <p className="text-muted-foreground text-xs">ยอดเงินคงเหลือจะถูกนำมาสรุปในรายงานกระแสเงินสด</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
