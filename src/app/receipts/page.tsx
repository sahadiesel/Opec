'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Plus, 
  Search, 
  Filter, 
  ChevronRight, 
  Receipt, 
  Building2, 
  Calendar,
  Loader2,
  Wallet
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Receipt as ReceiptType, ReceiptStatus, User, Customer, BankAccount, PaymentMethod } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';
import { collection, query, orderBy, doc } from 'firebase/firestore';
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
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';

export default function ReceiptsPage() {
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const isAuthorized = useMemo(
    () => !!currentUser && canView(currentUser, 'receipts'),
    [currentUser]
  );

  const receiptsQuery = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return query(collection(firestore, 'receipts'), orderBy('receiptDate', 'desc'));
  }, [firestore, isAuthorized]);

  const { data: receipts, isLoading } = useCollection<ReceiptType>(receiptsQuery as any);

  const customersQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'customers') : null), [firestore, isAuthorized]);
  const { data: customers } = useCollection<Customer>(customersQuery as any);

  const bankAccountsQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'bank_accounts') : null), [firestore, isAuthorized]);
  const { data: bankAccounts } = useCollection<BankAccount>(bankAccountsQuery as any);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newReceipt, setNewReceipt] = useState<Partial<ReceiptType>>({
    receiptNo: getPreviewPattern('receipt'),
    receiptDate: new Date().toISOString().split('T')[0],
    paymentMethod: 'TRANSFER',
    receivedAmount: 0,
    status: 'DRAFT',
    notes: ''
  });

  const handleCreate = async () => {
    if (!firestore || !currentUser) return;
    if (!newReceipt.customerId || !newReceipt.receivedAmount || !newReceipt.bankAccountId) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาระบุลูกค้า ยอดเงิน และบัญชีธนาคาร" });
      return;
    }

    setIsCreating(true);
    try {
      // Atomic Number Generation
      const { code: finalNo } = await generateNextDocumentCode(firestore, 'receipt', { actor: currentUser.displayName });

      const docRef = await addDocumentNonBlocking(collection(firestore, 'receipts'), {
        ...newReceipt,
        receiptNo: finalNo,
        receivedAmount: Number(newReceipt.receivedAmount),
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      setIsDialogOpen(false);
      toast({ title: "บันทึกใบเสร็จสำเร็จ", description: `เลขที่: ${finalNo}` });
      if (docRef) router.push(`/receipts/${docRef.id}`);
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถบันทึกใบเสร็จได้" });
    } finally {
      setIsCreating(false);
    }
  };

  const getStatusBadge = (status: ReceiptStatus) => {
    switch (status) {
      case 'DRAFT': return <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200">DRAFT</Badge>;
      case 'ISSUED': return <Badge className="bg-green-600">ISSUED</Badge>;
      case 'CANCELLED': return <Badge variant="secondary">CANCELLED</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isUserLoading || userLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <Receipt className="h-8 w-8" /> ใบเสร็จรับเงิน (Receipts)
          </h1>
          <p className="text-muted-foreground text-lg">
            บันทึกการรับชำระเงินจากลูกค้า และจัดสรรยอดเข้ากับใบกำกับภาษีที่ค้างชำระ
          </p>
        </div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="ค้นหาเลขที่ใบเสร็จ..." className="pl-9 h-11" />
            </div>
            <Button variant="outline" className="h-11 gap-2"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
          </div>
          
          <Dialog open={isAuthorized && isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 h-11 px-6 bg-primary shadow-md text-base font-bold">
                <Plus className="h-5 w-5" /> บันทึกรับเงิน (New Receipt)
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>บันทึกการรับเงินใหม่ (Record Receipt)</DialogTitle>
                <DialogDescription>ระบุรายละเอียดการรับชำระเงิน ระบบจะรันเลขที่เอกสารให้อัตโนมัติ</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                <div className="space-y-2 md:col-span-2">
                  <Label>เลขที่ใบเสร็จ (Receipt No.)</Label>
                  <Input value={newReceipt.receiptNo} disabled className="bg-muted/50 font-mono font-bold" />
                  <p className="text-[10px] text-muted-foreground italic">* ระบบจะออกรหัสจริงให้อัตโนมัติเมื่อกดบันทึก</p>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>ลูกค้า (Customer)</Label>
                  <Select onValueChange={v => setNewReceipt({...newReceipt, customerId: v})}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="เลือกบริษัทลูกค้า..." /></SelectTrigger>
                    <SelectContent>
                      {customers?.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>วันที่รับเงิน (Date)</Label>
                  <Input type="date" value={newReceipt.receiptDate} onChange={e => setNewReceipt({...newReceipt, receiptDate: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>ช่องทางชำระเงิน</Label>
                  <Select onValueChange={(v: any) => setNewReceipt({...newReceipt, paymentMethod: v})} defaultValue={newReceipt.paymentMethod}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TRANSFER">โอนเงิน (Transfer)</SelectItem>
                      <SelectItem value="CASH">เงินสด (Cash)</SelectItem>
                      <SelectItem value="CHEQUE">เช็ค (Cheque)</SelectItem>
                      <SelectItem value="OTHER">อื่น ๆ</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>บัญชีธนาคารที่รับเงิน</Label>
                  <Select onValueChange={v => setNewReceipt({...newReceipt, bankAccountId: v})}>
                    <SelectTrigger><SelectValue placeholder="เลือกบัญชี..." /></SelectTrigger>
                    <SelectContent>
                      {bankAccounts?.map(b => (
                        <SelectItem key={b.id} value={b.id}>{b.accountCode} - {b.bankName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>จำนวนเงินที่ได้รับจริง (Received Amount)</Label>
                  <Input type="number" className="text-lg font-bold" value={newReceipt.receivedAmount} onChange={e => setNewReceipt({...newReceipt, receivedAmount: parseFloat(e.target.value)})} />
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

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูล...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4 pl-6">เลขที่ใบเสร็จ</TableHead>
                    <TableHead className="font-bold">ลูกค้า</TableHead>
                    <TableHead className="font-bold">วันที่รับเงิน</TableHead>
                    <TableHead className="font-bold text-right">ยอดรับชำระ</TableHead>
                    <TableHead className="font-bold">วิธีชำระ</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receipts?.map((r) => {
                    const customer = customers?.find(c => c.id === r.customerId);
                    return (
                      <TableRow 
                        key={r.id} 
                        className="cursor-pointer hover:bg-muted/30 group transition-all" 
                        onClick={() => router.push(`/receipts/${r.id}`)}
                      >
                        <TableCell className="py-4 pl-6 font-bold text-primary font-mono">{r.receiptNo}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-sm font-bold text-primary">
                            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                            {customer?.name || 'N/A'}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {r.receiptDate}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-black text-green-700">
                          ฿ {r.receivedAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px] gap-1 font-bold">
                            <Wallet className="h-3 w-3" /> {r.paymentMethod}
                          </Badge>
                        </TableCell>
                        <TableCell>{getStatusBadge(r.status)}</TableCell>
                        <TableCell className="text-right pr-6">
                          <Button variant="ghost" size="icon" className="group-hover:text-primary"><ChevronRight className="h-5 w-5" /></Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {(!receipts || receipts.length === 0) && !isLoading && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-20 text-muted-foreground italic">ไม่มีรายการใบเสร็จในระบบ</TableCell>
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
