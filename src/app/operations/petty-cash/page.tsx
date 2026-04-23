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
import { Banknote, BookOpen, Loader2, Plus, Wallet } from 'lucide-react';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue } from '@/lib/date-thai';
import { BankAccount, PettyCashEntry, User } from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { canView } from '@/lib/permissions';
import { recordPettyCashMovement } from '@/lib/services/cashbook-bank-movement';
import { useAppUser } from '@/hooks/use-app-user';

export default function OperationsPettyCashPage() {
  const { currentUser, isLoading: appUserLoading } = useAppUser();
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const allowed = useMemo(
    () => (currentUser ? canView(currentUser, 'operations_petty_cash') : false),
    [currentUser]
  );

  const canSeeCashbook = useMemo(
    () => (currentUser ? canView(currentUser, 'cashbook') : false),
    [currentUser]
  );

  const pettyAccountsQuery = useMemoFirebase(() => {
    if (!firestore || !firebaseUser || !allowed) return null;
    return query(collection(firestore, 'bank_accounts'), where('accountType', '==', 'PETTY_CASH'));
  }, [firestore, firebaseUser, allowed]);

  const { data: pettyAccounts, isLoading: loadingPetty } = useCollection<BankAccount>(pettyAccountsQuery as any);

  const [selectedAccountId, setSelectedAccountId] = useState('');

  useEffect(() => {
    if (!pettyAccounts?.length) return;
    setSelectedAccountId((prev) => {
      if (prev && pettyAccounts.some((a) => a.id === prev)) return prev;
      return pettyAccounts[0].id;
    });
  }, [pettyAccounts]);

  const entriesQuery = useMemoFirebase(() => {
    if (!firestore || !selectedAccountId || !allowed) return null;
    return query(
      collection(firestore, 'petty_cash_entries'),
      where('bankAccountId', '==', selectedAccountId),
      orderBy('createdAt', 'desc'),
      limit(80)
    );
  }, [firestore, selectedAccountId, allowed]);

  const { data: entries, isLoading: loadingEntries } = useCollection<PettyCashEntry>(entriesQuery as any);

  const selectedAccount = pettyAccounts?.find((a) => a.id === selectedAccountId);

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
      toast({ title: 'บันทึกรายการแล้ว', description: `เลขที่ ${entryNo} (เงินสดย่อย — ไม่ลง Cashbook)` });
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
      <div className="space-y-6 max-w-[1200px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <Banknote className="h-8 w-8" /> เบิกจ่าย Petty Cash (หน้างาน)
          </h1>
          <p className="text-muted-foreground text-lg max-w-3xl">
            บันทึกรับ/จ่ายเงินสดย่อยหน้างาน — อัปเดตเฉพาะยอด Petty Cash นี้ ไม่สร้างรายการใน Cashbook
            (เงินก้อนจากบริษัทตัดในสมุดบัญชีตอนโอนเข้า Petty แล้ว) เมื่อโอนเงินคืนเข้าบัญชีบริษัทให้ฝ่ายบัญชีบันทึก/โอนผ่าน{' '}
            <span className="whitespace-nowrap">Cashbook</span> ตามปกติ
          </p>
          {canSeeCashbook && (
            <Link
              href="/cashbook"
              className="text-sm text-muted-foreground inline-flex items-center gap-1 w-fit hover:underline"
            >
              <BookOpen className="h-4 w-4" /> ดูสมุดรายรับรายจาย (โอนเข้า-ออกกอง, ฯลฯ)
            </Link>
          )}
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">บันทึกรายการ</CardTitle>
                <CardDescription>รายการนี้ลงฐาน Petty อย่างเดียว — ไม่ซ้ำใน Cashbook</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
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
                  <div className="rounded-lg border bg-muted/40 p-4">
                    <p className="text-xs font-bold uppercase text-muted-foreground">ยอดคงเหลือปัจจุบัน</p>
                    <p className="text-2xl font-black text-primary">
                      {selectedAccount.currency}{' '}
                      {(Number(selectedAccount.currentBalance) || 0).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                      })}
                    </p>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                <div className="space-y-2">
                  <Label>รายละเอียด</Label>
                  <Input
                    className="h-11"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="เช่น ค่าอุปกรณ์หน้างาน, ค่ารถรับส่ง"
                  />
                </div>
                <div className="space-y-2">
                  <Label>จำนวนเงิน</Label>
                  <Input
                    type="number"
                    className="h-11 font-bold text-lg"
                    value={amount || ''}
                    onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                  />
                </div>
                <Button className="w-full h-11 font-bold gap-2" onClick={handleSubmit} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  บันทึกรายการ
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">รายการล่าสุด (บัญชีที่เลือก)</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {loadingEntries ? (
                  <div className="py-12 text-center text-muted-foreground animate-pulse">กำลังโหลด...</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-4">เลขที่ / วันที่</TableHead>
                        <TableHead>รายละเอียด</TableHead>
                        <TableHead className="text-right pr-4">จำนวน</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {entries?.map((e) => (
                        <TableRow key={e.id}>
                          <TableCell className="pl-4 text-xs font-mono">
                            <div className="font-bold text-primary">{e.entryNo}</div>
                            <div className="text-muted-foreground">{e.entryDate}</div>
                          </TableCell>
                          <TableCell className="text-sm">{e.description}</TableCell>
                          <TableCell
                            className={`text-right pr-4 font-bold ${
                              e.direction === 'IN' ? 'text-green-700' : 'text-red-700'
                            }`}
                          >
                            {e.direction === 'IN' ? '+' : '-'}
                            {Number(e.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </TableCell>
                        </TableRow>
                      ))}
                      {(!entries || entries.length === 0) && (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center py-10 text-muted-foreground text-sm">
                            ยังไม่มีรายการในกองนี้
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AppShell>
  );
}
