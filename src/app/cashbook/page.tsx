'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  BookOpen, 
  Plus, 
  Search, 
  Filter, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Building2, 
  Calendar,
  Wallet,
  Coins,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Info
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { CashbookEntry, User, BankAccount } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, orderBy, limit } from 'firebase/firestore';
import { addDocumentNonBlocking } from '@/firebase/non-blocking-updates';
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

export default function CashbookPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const isAuthorized = useMemo(() => {
    const authRoles = ['system_admin', 'finance_officer'];
    return currentUser?.roleIds?.some(r => authRoles.includes(r)) || false;
  }, [currentUser]);

  const entriesQuery = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return query(collection(firestore, 'cashbook_entries'), orderBy('entryDate', 'desc'), limit(100));
  }, [firestore, isAuthorized]);

  const { data: entries, isLoading } = useCollection<CashbookEntry>(entriesQuery as any);

  const bankAccountsQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'bank_accounts') : null), [firestore, isAuthorized]);
  const { data: bankAccounts } = useCollection<BankAccount>(bankAccountsQuery as any);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newEntry, setNewEntry] = useState<Partial<CashbookEntry>>({
    entryDate: new Date().toISOString().split('T')[0],
    direction: 'OUT',
    paymentMethod: 'TRANSFER',
    amount: 0,
    description: '',
    entryType: 'OTHER'
  });

  const stats = useMemo(() => {
    if (!entries) return { totalIn: 0, totalOut: 0, balance: 0 };
    const totalIn = entries.filter(e => e.direction === 'IN').reduce((sum, e) => sum + Number(e.amount), 0);
    const totalOut = entries.filter(e => e.direction === 'OUT').reduce((sum, e) => sum + Number(e.amount), 0);
    return { totalIn, totalOut, balance: totalIn - totalOut };
  }, [entries]);

  const handleCreate = async () => {
    if (!firestore || !currentUser) return;
    if (!newEntry.bankAccountId || !newEntry.amount || !newEntry.description) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาระบุบัญชีธนาคาร ยอดเงิน และรายละเอียด" });
      return;
    }

    try {
      await addDocumentNonBlocking(collection(firestore, 'cashbook_entries'), {
        ...newEntry,
        amount: Number(newEntry.amount),
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      setIsDialogOpen(false);
      toast({ title: "บันทึกรายการสำเร็จ" });
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถบันทึกข้อมูลได้" });
    }
  };

  if (isUserLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <BookOpen className="h-8 w-8" /> รายรับรายจ่าย (Cashbook)
          </h1>
          <p className="text-muted-foreground text-lg">
            บันทึกและติดตามความเคลื่อนไหวของเงินสดและเงินฝากธนาคารทั้งหมดในระบบ
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border-l-8 border-l-green-600">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase text-muted-foreground">ยอดเงินรับเข้า (Total Inflow)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-green-700">฿ {stats.totalIn.toLocaleString()}</div>
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-1">
                <TrendingUp className="h-3 w-3 text-green-600" /> จากรายได้และการรับชำระ
              </div>
            </CardContent>
          </Card>
          <Card className="border-l-8 border-l-red-600">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase text-muted-foreground">ยอดเงินจ่ายออก (Total Outflow)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-red-600">฿ {stats.totalOut.toLocaleString()}</div>
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-1">
                <TrendingDown className="h-3 w-3 text-red-600" /> จากค่าจ้างและการจัดซื้อ
              </div>
            </CardContent>
          </Card>
          <Card className="border-l-8 border-l-primary bg-primary/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase text-muted-foreground">กระแสเงินสดสุทธิ (Net Position)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-primary">฿ {stats.balance.toLocaleString()}</div>
              <p className="text-[10px] text-muted-foreground mt-1">Cash Movement Summary</p>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="ค้นหาตามรายละเอียด หรือ บัญชี..." className="pl-9 h-11" />
            </div>
            <Button variant="outline" className="h-11 gap-2"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
          </div>
          
          <Dialog open={isAuthorized && isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 h-11 px-6 bg-primary shadow-md text-base font-bold">
                <Plus className="h-5 w-5" /> บันทึกรายการใหม่ (Manual Entry)
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>บันทึกรายรับ-รายจ่าย</DialogTitle>
                <DialogDescription>บันทึกความเคลื่อนไหวทางการเงินที่ไม่ได้เกิดจากใบแจ้งหนี้โดยตรง</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
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
                  <Input type="date" value={newEntry.entryDate} onChange={e => setNewEntry({...newEntry, entryDate: e.target.value})} className="h-11" />
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
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>ยกเลิก</Button>
                <Button onClick={handleCreate} className="bg-primary font-bold">บันทึกข้อมูล (Confirm)</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-20 text-center text-muted-foreground animate-pulse">กำลังโหลดข้อมูล Cashbook...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4 pl-6">วันที่ (Date)</TableHead>
                    <TableHead className="font-bold">รายละเอียด (Description)</TableHead>
                    <TableHead className="font-bold">บัญชีธนาคาร</TableHead>
                    <TableHead className="font-bold">วิธีชำระ</TableHead>
                    <TableHead className="font-bold text-right">เงินเข้า (In)</TableHead>
                    <TableHead className="font-bold text-right">เงินออก (Out)</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries?.map((entry) => {
                    const bankAccount = bankAccounts?.find(b => b.id === entry.bankAccountId);
                    return (
                      <TableRow key={entry.id} className="hover:bg-muted/20">
                        <TableCell className="py-4 pl-6 font-medium text-xs">
                          <div className="flex items-center gap-2">
                            <Calendar className="h-3 w-3 text-muted-foreground" />
                            {entry.entryDate}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-bold text-sm text-primary">{entry.description}</span>
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
                            <span className="font-black text-green-700">฿ {entry.amount.toLocaleString()}</span>
                          ) : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          {entry.direction === 'OUT' ? (
                            <span className="font-black text-red-600">฿ {entry.amount.toLocaleString()}</span>
                          ) : '-'}
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <Button variant="ghost" size="icon"><ChevronRight className="h-4 w-4" /></Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {(!entries || entries.length === 0) && !isLoading && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-20 text-muted-foreground italic">ไม่มีประวัติรายการทางการเงิน</TableCell>
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
