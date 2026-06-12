'use client';

import { useState, use, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ArrowLeft,
  Save,
  Loader2,
  Building,
  Coins,
  ArrowDownLeft,
  ArrowUpRight,
  List,
} from 'lucide-react';
import { useFirestore, useDoc, useCollection, useMemoFirebase } from '@/firebase';
import { doc, collection, setDoc, updateDoc, query, where, orderBy } from 'firebase/firestore';
import {
  BankAccount,
  BankAccountType,
  BankAccountStatus,
  User,
  CashbookEntry,
  PettyCashEntry,
} from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { canCreate } from '@/lib/permissions';
import { syncBankCurrentBalanceIfDrift } from '@/lib/services/bank-balance-reconcile';
import { roundMoney2 } from '@/lib/ops/purchase-payment-milestones';
import { computeOdBalanceDelta, formatSignedBahtDelta, isCurrentBankAccount } from '@/lib/bank-account-od';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import Link from 'next/link';
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';
import { formatDateTimeThaiBE, formatStoredDateThaiBE } from '@/lib/date-thai';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

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

function cashbookEntryTypeLabel(t: CashbookEntry['entryType']): string {
  const map: Record<string, string> = {
    CUSTOMER_RECEIPT: 'รับจากลูกหนี้',
    SUPPLIER_PAYMENT: 'จ่ายเจ้าหนี้',
    PAYROLL: 'เงินเดือน',
    TAX: 'ภาษี',
    TRANSFER: 'โอนระหว่างบัญชี',
    PETTY_CASH: 'เงินสดย่อย',
    OTHER: 'อื่นๆ',
  };
  return map[t] ?? t;
}

function BankAccountDetailContent({ id }: { id: string }) {
  const isNew = id === 'new';
  const router = useRouter();
  const searchParams = useSearchParams();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const firestore = useFirestore();
  const { toast } = useToast();

  const accRef = useMemoFirebase(() => (firestore && !isNew ? doc(firestore, 'bank_accounts', id) : null), [firestore, id, isNew]);
  const { data: accData, isLoading: isAccLoading } = useDoc<BankAccount>(accRef as any);

  const [formData, setFormData] = useState<Partial<BankAccount>>({
    accountCode: isNew ? getPreviewPattern('bank_account') : '',
    bankName: '',
    accountName: '',
    accountNumber: '',
    branchName: '',
    accountType: 'SAVINGS',
    currency: 'THB',
    openingBalance: 0,
    currentBalance: 0,
    status: 'ACTIVE',
    notes: ''
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  const odBalanceDelta = useMemo(
    () => computeOdBalanceDelta(formData.currentBalance, formData.odLimit),
    [formData.currentBalance, formData.odLimit],
  );

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  useEffect(() => {
    if (accData) {
      setFormData(accData);
    }
  }, [accData]);

  useEffect(() => {
    if (!firestore || isNew || !id || !currentUser) return;
    if (!canCreate(currentUser, 'bank_accounts') && !canCreate(currentUser, 'cashbook')) return;
    let cancelled = false;
    void (async () => {
      try {
        const { corrected } = await syncBankCurrentBalanceIfDrift(firestore, id);
        if (!cancelled && corrected) {
          toast({
            title: 'ซิงค์ยอดบัญชีแล้ว',
            description: 'ปรับยอดเงินปัจจุบันให้ตรงกับรายการ cashbook / Petty',
          });
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, id, isNew, currentUser, toast]);

  useEffect(() => {
    if (!isNew) return;
    if (searchParams.get('preset') !== 'petty') return;
    setFormData((prev) => ({
      ...prev,
      accountCode: getPreviewPattern('petty_cash_account'),
      accountType: 'PETTY_CASH',
      bankName: 'Petty Cash',
      accountName: prev.accountName?.trim() ? prev.accountName : 'กองเงินสดย่อย (Petty Cash)',
      accountNumber: prev.accountNumber?.trim() ? prev.accountNumber : '—',
    }));
  }, [isNew, searchParams]);

  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const monthStart = useMemo(() => `${selectedMonth}-01`, [selectedMonth]);
  const monthEnd = useMemo(() => endOfMonthYmd(selectedMonth), [selectedMonth]);

  const resolvedAccountType = accData?.accountType ?? formData.accountType;
  const isPettyAccount = resolvedAccountType === 'PETTY_CASH';
  const isCurrentAccount = isCurrentBankAccount(formData.accountType);

  const cashbookForAccountQ = useMemoFirebase(() => {
    if (!firestore || isNew) return null;
    return query(
      collection(firestore, 'cashbook_entries'),
      where('bankAccountId', '==', id),
      where('entryDate', '>=', monthStart),
      where('entryDate', '<=', monthEnd),
      orderBy('entryDate', 'desc'),
    );
  }, [firestore, isNew, id, monthStart, monthEnd]);

  const { data: cashbookRows, isLoading: cashbookLoad } = useCollection<CashbookEntry>(cashbookForAccountQ as any);

  const pettyForAccountQ = useMemoFirebase(() => {
    if (!firestore || isNew || !isPettyAccount) return null;
    return query(
      collection(firestore, 'petty_cash_entries'),
      where('bankAccountId', '==', id),
      where('entryDate', '>=', monthStart),
      where('entryDate', '<=', monthEnd),
      orderBy('entryDate', 'desc'),
    );
  }, [firestore, isNew, id, isPettyAccount, monthStart, monthEnd]);

  const { data: pettyRows, isLoading: pettyLoad } = useCollection<PettyCashEntry>(pettyForAccountQ as any);

  const preMonthCbQ = useMemoFirebase(() => {
    if (!firestore || isNew) return null;
    return query(
      collection(firestore, 'cashbook_entries'),
      where('bankAccountId', '==', id),
      where('entryDate', '<', monthStart),
      orderBy('entryDate', 'asc'),
    );
  }, [firestore, isNew, id, monthStart]);

  const preMonthPtQ = useMemoFirebase(() => {
    if (!firestore || isNew || !isPettyAccount) return null;
    return query(
      collection(firestore, 'petty_cash_entries'),
      where('bankAccountId', '==', id),
      where('entryDate', '<', monthStart),
      orderBy('entryDate', 'asc'),
    );
  }, [firestore, isNew, id, isPettyAccount, monthStart]);

  const { data: preCbRows, isLoading: preCbLoad } = useCollection<CashbookEntry>(preMonthCbQ as any);
  const { data: prePtRows, isLoading: prePtLoad } = useCollection<PettyCashEntry>(preMonthPtQ as any);

  const preMonthNet = useMemo(() => {
    let n = 0;
    for (const e of preCbRows ?? []) {
      const amt = roundMoney2(Number(e.amount ?? 0));
      n += (e.direction === 'IN' ? 1 : -1) * amt;
    }
    if (isPettyAccount) {
      for (const e of prePtRows ?? []) {
        const amt = roundMoney2(Number(e.amount ?? 0));
        n += (e.direction === 'IN' ? 1 : -1) * amt;
      }
    }
    return roundMoney2(n);
  }, [preCbRows, prePtRows, isPettyAccount]);

  const balanceAtStartOfSelectedMonth = useMemo(
    () =>
      roundMoney2(
        roundMoney2(Number(accData?.openingBalance ?? formData.openingBalance ?? 0)) + preMonthNet,
      ),
    [accData?.openingBalance, formData.openingBalance, preMonthNet],
  );

  const movementRows = useMemo(() => {
    const acctCode = String(accData?.accountCode ?? formData.accountCode ?? '').trim();
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
      const payrollHint =
        e.entryType === 'PAYROLL' &&
        acctCode &&
        !(e.description || '').includes('ตัดจากบัญชี')
          ? ` · ตัดจากบัญชี ${acctCode}`
          : '';
      list.push({
        key: `cb-${e.id}`,
        entryDate: e.entryDate,
        entryNo: e.entryNo,
        description: `${e.description ?? ''}${payrollHint}`,
        direction: e.direction,
        amount: roundMoney2(Number(e.amount ?? 0)),
        source: 'cashbook',
        entryType: cashbookEntryTypeLabel(e.entryType),
        paymentMethod: e.paymentMethod,
      });
    }
    if (isPettyAccount) {
      for (const e of pettyRows ?? []) {
        list.push({
          key: `pt-${e.id}`,
          entryDate: e.entryDate,
          entryNo: e.entryNo,
          description: e.description,
          direction: e.direction,
          amount: roundMoney2(Number(e.amount ?? 0)),
          source: 'petty',
          entryType: 'รายการ Petty หน้างาน',
          paymentMethod: e.paymentMethod,
        });
      }
    }
    return list;
  }, [cashbookRows, pettyRows, isPettyAccount, accData?.accountCode, formData.accountCode]);

  const movementRowsChronological = useMemo(
    () => [...movementRows].sort(compareMovement),
    [movementRows],
  );

  const movementRowsWithBalance = useMemo(() => {
    let bal = balanceAtStartOfSelectedMonth;
    return movementRowsChronological.map((row) => {
      const effect = row.direction === 'IN' ? row.amount : -row.amount;
      bal = roundMoney2(bal + effect);
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
    return {
      totalIn: roundMoney2(totalIn),
      totalOut: roundMoney2(totalOut),
      net: roundMoney2(totalIn - totalOut),
    };
  }, [movementRows]);

  const movementBlockLoading =
    cashbookLoad || (isPettyAccount && pettyLoad) || preCbLoad || (isPettyAccount && prePtLoad);

  const handleSave = async () => {
    if (!firestore || !currentUser) return;
    const isPetty = formData.accountType === 'PETTY_CASH';
    if (!formData.accountName?.trim()) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: isPetty ? "กรุณาระบุชื่อกอง Petty" : "กรุณาระบุชื่อบัญชี" });
      return;
    }
    if (!isPetty && !formData.accountNumber?.trim()) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาระบุเลขที่บัญชี" });
      return;
    }

    setIsSubmitting(true);
    const now = Date.now();
    const openingBalance = roundMoney2(Number(formData.openingBalance ?? 0));
    const currentBalance = roundMoney2(Number(formData.currentBalance ?? 0));
    const odLimit =
      isCurrentBankAccount(formData.accountType) &&
      formData.odLimit != null &&
      Number.isFinite(Number(formData.odLimit))
        ? roundMoney2(Number(formData.odLimit))
        : undefined;
    
    try {
      if (isNew) {
        const seqKey = isPetty ? 'petty_cash_account' : 'bank_account';
        const { code: finalCode } = await generateNextDocumentCode(firestore, seqKey, { actor: currentUser.displayName });

        const newRef = doc(collection(firestore, 'bank_accounts'));
        await setDoc(newRef, {
          ...formData,
          accountCode: finalCode,
          id: newRef.id,
          openingBalance,
          currentBalance,
          ...(odLimit != null ? { odLimit } : {}),
          createdAt: now,
          updatedAt: now
        });
        toast({
          title: isPetty ? "เพิ่มกอง Petty สำเร็จ" : "เพิ่มบัญชีธนาคารสำเร็จ",
          description: `รหัส: ${finalCode}`,
        });
        router.push('/bank-accounts');
      } else {
        await updateDoc(accRef!, {
          ...formData,
          openingBalance,
          currentBalance,
          odLimit: odLimit ?? null,
          updatedAt: now
        });
        toast({ title: "อัปเดตข้อมูลสำเร็จ" });
        router.back();
      }
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถบันทึกข้อมูลได้" });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isNew && isAccLoading) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="animate-spin h-12 w-12 text-primary" /></div>;
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.back()}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                {isNew
                  ? resolvedAccountType === 'PETTY_CASH'
                    ? 'เพิ่มกองเงินสดย่อย (Petty Cash)'
                    : 'เพิ่มบัญชีธนาคาร'
                  : isPettyAccount
                    ? `แก้ไขกอง Petty: ${formData.accountName}`
                    : `แก้ไขข้อมูลบัญชี: ${formData.accountName}`}
              </h1>
              <p className="text-sm text-muted-foreground">
                {isPettyAccount
                  ? 'กองนี้ไม่ใช่บัญชีรับฝากที่ธนาคาร — เงินโอนจากบัญชีกลางไปมือจ่ายหน้างาน; รายการโอนเข้าเห็นได้จาก Cashbook รายการจ่าย Petty จากฝ่ายปฏิบัติการ'
                  : 'บันทึกบัญชีธนาคารเพื่อใช้รับ-จ่าย โอน ในระบบ'}
              </p>
            </div>
          </div>
          <Button className="gap-2 px-8 font-bold shadow-lg bg-primary" onClick={handleSave} disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isNew ? 'บันทึกบัญชีใหม่' : 'บันทึกการเปลี่ยนแปลง'}
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Building className="h-5 w-5 text-primary" />
                {isPettyAccount ? 'รายละเอียดกองเงินสดย่อย (Petty)' : 'ข้อมูลบัญชีธนาคาร'}
              </CardTitle>
              {isPettyAccount && (
                <CardDescription>
                  เงินรับ-จ่ายจริงหน้างานลงที่เมนู «เบิกจ่าย Petty» — โอนเงินเข้ากองนี้จากบัญชีบริษัทผ่าน{' '}
                  <Link className="font-medium text-primary underline" href="/cashbook">
                    Cashbook
                  </Link>
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="font-bold">รหัสบัญชี (Account Code)</Label>
                  <Input 
                    value={formData.accountCode} 
                    disabled={isNew} 
                    onChange={e => setFormData({...formData, accountCode: e.target.value})} 
                    className={isNew ? "bg-muted font-mono font-bold text-primary" : ""}
                    placeholder="เช่น BBL-MAIN" 
                  />
                  {isNew && <p className="text-[10px] text-muted-foreground italic">* ระบบจะออกรหัสจริงให้อัตโนมัติเมื่อกดบันทึก</p>}
                </div>
                <div className="space-y-2">
                  <Label>{isPettyAccount ? 'รูปแบบ' : 'ธนาคาร (Bank Name)'}</Label>
                  <Input
                    value={isPettyAccount ? 'Petty — เงินสดย่อยหน้างาน' : (formData.bankName ?? '')}
                    onChange={!isPettyAccount ? (e) => setFormData({ ...formData, bankName: e.target.value }) : undefined}
                    disabled={isPettyAccount}
                    className={isPettyAccount ? 'bg-muted' : ''}
                    placeholder="เช่น ธนาคารกรุงเทพ"
                  />
                </div>
                <div className="space-y-2">
                  <Label>
                    {isPettyAccount ? 'ชื่อกอง / ผู้รับเงินสด (แสดงในระบบ) *' : 'ชื่อบัญชี (Account Name) *'}
                  </Label>
                  <Input value={formData.accountName} onChange={e => setFormData({...formData, accountName: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>{isPettyAccount ? 'อ้างอิง/หมายเหตุ (ไม่บังคับ)' : 'เลขที่บัญชี *'}</Label>
                  <Input
                    value={formData.accountNumber}
                    onChange={e => setFormData({ ...formData, accountNumber: e.target.value })}
                    placeholder={isPettyAccount ? 'เช่น รหัสอ้างอิง' : '000-0-00000-0'}
                  />
                </div>
                {!isPettyAccount && (
                <div className="space-y-2">
                  <Label>สาขา (Branch Name)</Label>
                  <Input value={formData.branchName} onChange={e => setFormData({...formData, branchName: e.target.value})} />
                </div>
                )}
                <div className="space-y-2">
                  <Label>ประเภทบัญชี</Label>
                  <Select
                    onValueChange={(v: BankAccountType) =>
                      setFormData({
                        ...formData,
                        accountType: v,
                        ...(v !== 'CURRENT' ? { odLimit: undefined } : {}),
                      })
                    }
                    value={formData.accountType}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SAVINGS">ออมทรัพย์ (SAVINGS)</SelectItem>
                      <SelectItem value="CURRENT">กระแสรายวัน (CURRENT)</SelectItem>
                      <SelectItem value="CASH">เงินสด (CASH)</SelectItem>
                      <SelectItem value="PETTY_CASH">เงินสดย่อย Petty Cash (หน้างาน)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>สกุลเงิน (Currency)</Label>
                  <Select onValueChange={v => setFormData({...formData, currency: v})} value={formData.currency}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="THB">THB - Thai Baht</SelectItem>
                      <SelectItem value="USD">USD - US Dollar</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>สถานะ</Label>
                  <Select onValueChange={(v: BankAccountStatus) => setFormData({...formData, status: v})} value={formData.status}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ACTIVE">ACTIVE</SelectItem>
                      <SelectItem value="INACTIVE">INACTIVE</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>หมายเหตุ</Label>
                <Textarea value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} />
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="border-primary/20 bg-primary/5">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Coins className="h-5 w-5 text-primary" /> ยอดเงิน (Balances)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>ยอดเงินยกมา (Opening Balance)</Label>
                  <Input 
                    type="number" 
                    value={formData.openingBalance} 
                    onChange={e => setFormData({...formData, openingBalance: parseFloat(e.target.value)})} 
                    className="text-lg font-bold"
                  />
                </div>
                <div className="space-y-2">
                  <Label>ยอดเงินปัจจุบัน (Current Balance)</Label>
                  <Input 
                    type="number" 
                    value={formData.currentBalance} 
                    onChange={e => setFormData({...formData, currentBalance: parseFloat(e.target.value)})} 
                    className="text-xl font-black text-primary"
                  />
                </div>
                {!isPettyAccount && isCurrentAccount ? (
                  <>
                    <div className="space-y-2">
                      <Label>วงเงิน OD</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={formData.odLimit ?? ''}
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === '') {
                            setFormData({ ...formData, odLimit: undefined });
                            return;
                          }
                          const n = parseFloat(raw);
                          setFormData({ ...formData, odLimit: Number.isFinite(n) ? n : undefined });
                        }}
                        className="text-lg font-bold"
                        placeholder="0.00"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>ยอดเทียบวงเงิน OD</Label>
                      <div className="rounded-md border-2 border-orange-400/80 bg-orange-50/90 px-3 py-2.5 dark:border-orange-600/60 dark:bg-orange-950/30">
                        <p
                          className={`text-xl font-black tabular-nums tracking-tight ${
                            odBalanceDelta < 0
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-emerald-900 dark:text-emerald-300'
                          }`}
                        >
                          {formatSignedBahtDelta(odBalanceDelta)}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground leading-snug">
                          ยอดเงินปัจจุบัน − วงเงิน OD · ติดลบ (แดง) = ต่ำกว่าวงเงิน OD · บวก (เขียว) = สูงกว่าวงเงิน OD
                        </p>
                      </div>
                    </div>
                  </>
                ) : null}
                <div className="p-3 bg-white rounded border text-xs text-muted-foreground italic">
                  {isPettyAccount
                    ? '* ยอดอัปเดตเมื่อโอนเข้า-ออกผ่าน Cashbook และรายการ Petty หน้างาน (ไม่ใช่เลขบัญชีธนาคารโดยตรง)'
                    : '* ยอดเงินปัจจุบันจะถูกอัปเดตอัตโนมัติเมื่อมีการทำรายการผ่านระบบ Cashbook'}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">ประวัติระบบ</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">สร้างเมื่อ:</span>
                  <span>{accData?.createdAt ? formatDateTimeThaiBE(accData.createdAt) : '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">อัปเดตล่าสุด:</span>
                  <span>{accData?.updatedAt ? formatDateTimeThaiBE(accData.updatedAt) : '-'}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {!isNew && (
          <Card>
            <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <List className="h-5 w-5 text-primary" />
                  รายการเคลื่อนไหวของบัญชี
                </CardTitle>
                <CardDescription>
                  {isPettyAccount
                    ? 'รายรับ/รายจ่ายจาก Cashbook (โอนเข้า-ออกกอง) รวม Petty หน้างาน — ยอดคงเหลือสะสมต่อแถวตามวันที่'
                    : 'รายรับ/รายจ่ายผ่าน Cashbook — ใช้เทียบกับ statement ได้'}
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
                <Button type="button" variant="outline" size="sm" asChild>
                  <Link href="/cashbook">Cashbook</Link>
                </Button>
                {isPettyAccount && (
                  <Button type="button" variant="outline" size="sm" asChild>
                    <Link href="/operations/petty-cash">Petty หน้างาน</Link>
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {movementBlockLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : (
                <>
                  <div className="mb-4 flex flex-col gap-2 rounded-lg border border-primary/15 bg-primary/5 px-4 py-3 text-sm md:flex-row md:flex-wrap md:items-center md:gap-4">
                    <span>
                      <span className="text-muted-foreground">ยอดก่อนเดือนนี้ (ยกมา + รายการก่อน):</span>{' '}
                      <span className="font-mono font-bold text-primary">
                        ฿{' '}
                        {balanceAtStartOfSelectedMonth.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                    </span>
                    <span className="text-muted-foreground/60">|</span>
                    <span>
                      <span className="text-muted-foreground">รวมรับ:</span>{' '}
                      <span className="font-bold text-emerald-800">
                        ฿ {monthTotals.totalIn.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </span>
                    <span>
                      <span className="text-muted-foreground">รวมจ่าย:</span>{' '}
                      <span className="font-bold text-red-800">
                        ฿ {monthTotals.totalOut.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </span>
                    <span>
                      <span className="text-muted-foreground">สุทธิรายรับ-รายจ่ายเดือนนี้:</span>{' '}
                      <span className="font-black text-primary">
                        ฿ {monthTotals.net.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </span>
                  </div>
                  <p className="mb-2 text-xs text-muted-foreground">
                    รายการเรียงตามเวลา (เก่า → ใหม่) — ยอดคงเหลือ = ยอดหลังรายการนั้น
                  </p>
                  <div className="overflow-x-auto rounded-md border">
                    <Table className="min-w-[920px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[6.5rem]">วันที่</TableHead>
                          <TableHead className="w-[6.5rem]">เลขที่</TableHead>
                          <TableHead className="min-w-[12rem]">รายละเอียด / ประเภท</TableHead>
                          <TableHead className="w-[5.5rem] text-right">รายรับ (เข้า)</TableHead>
                          <TableHead className="w-[5.5rem] text-right">รายจ่าย (ออก)</TableHead>
                          <TableHead className="w-[6.5rem] text-right">ยอดคงเหลือ</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
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
                                    {row.source === 'petty' ? 'Petty' : 'Cashbook'}
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
                                ฿{' '}
                                {row.balanceAfter.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        {movementRowsWithBalance.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                              ไม่มีรายการในช่วง {formatStoredDateThaiBE(monthStart)} – {formatStoredDateThaiBE(monthEnd)} — ลองเปลี่ยนเดือน
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
        )}
      </div>
    </AppShell>
  );
}

export default function BankAccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground text-sm">กำลังโหลด…</div>
      }
    >
      <BankAccountDetailContent id={id} />
    </Suspense>
  );
}
