'use client';

import { useState, use, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  ArrowLeft, 
  Receipt, 
  Building2, 
  Calendar, 
  Wallet,
  CheckCircle2,
  Plus,
  Trash2,
  Info,
  Loader2,
  Coins
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useUser, useCollection } from '@/firebase';
import { collection, doc, query, where, updateDoc, increment, writeBatch } from 'firebase/firestore';
import { updateDocumentNonBlocking, addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Receipt as ReceiptType, ReceiptStatus, ReceiptAllocation, TaxInvoice, User, Customer, BankAccount } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription,
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function ReceiptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const receiptRef = useMemoFirebase(() => (firestore ? doc(firestore, 'receipts', id) : null), [firestore, id]);
  const { data: receipt, isLoading: isReceiptLoading } = useDoc<ReceiptType>(receiptRef as any);

  const allocationsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'receipts', id, 'allocations') : null), [firestore, id]);
  const { data: allocations } = useCollection<ReceiptAllocation>(allocationsQuery as any);

  const invoicesQuery = useMemoFirebase(() => {
    if (!firestore || !receipt) return null;
    return query(collection(firestore, 'tax_invoices'), where('customerId', '==', receipt.customerId));
  }, [firestore, receipt?.customerId]);
  const { data: customerInvoices } = useCollection<TaxInvoice>(invoicesQuery as any);

  const bankAccountRef = useMemoFirebase(() => (firestore && receipt ? doc(firestore, 'bank_accounts', receipt.bankAccountId) : null), [firestore, receipt?.bankAccountId]);
  const { data: bankAccount } = useDoc<BankAccount>(bankAccountRef as any);

  const [isAllocationOpen, setIsAllocationOpen] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
  const [allocAmount, setAllocAmount] = useState(0);

  const totalAllocated = useMemo(() => {
    return allocations?.reduce((sum, a) => sum + Number(a.amountAllocated), 0) || 0;
  }, [allocations]);

  const handleAddAllocation = async () => {
    if (!firestore || !selectedInvoiceId || !allocAmount) return;
    
    if (totalAllocated + allocAmount > receipt!.receivedAmount) {
      toast({ variant: "destructive", title: "ยอดเงินไม่พอ", description: "ยอดจัดสรรรวมเกินยอดรับเงินจริง" });
      return;
    }

    try {
      await addDocumentNonBlocking(collection(firestore, 'receipts', id, 'allocations'), {
        receiptId: id,
        taxInvoiceId: selectedInvoiceId,
        amountAllocated: allocAmount,
        createdAt: Date.now()
      });

      // Update AR record
      const arQuery = query(collection(firestore, 'accounts_receivable'), where('referenceId', '==', selectedInvoiceId));
      const arSnap = await (await import('firebase/firestore')).getDocs(arQuery);
      if (!arSnap.empty) {
        const arDoc = arSnap.docs[0];
        const newCredit = Number(arDoc.data().creditAmount) + allocAmount;
        const newOutstanding = Number(arDoc.data().debitAmount) - newCredit;
        await updateDoc(arDoc.ref, {
          creditAmount: newCredit,
          outstandingAmount: newOutstanding,
          status: newOutstanding <= 0 ? 'PAID' : 'PARTIALLY_PAID',
          updatedAt: Date.now()
        });
      }

      setIsAllocationOpen(false);
      setSelectedInvoiceId('');
      setAllocAmount(0);
      toast({ title: "จัดสรรยอดสำเร็จ" });
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถบันทึกข้อมูลได้" });
    }
  };

  const handleFinalize = () => {
    if (!receiptRef || !bankAccountRef) return;
    
    const batch = writeBatch(firestore!);
    batch.update(receiptRef, { status: 'ISSUED', updatedAt: Date.now() });
    batch.update(bankAccountRef, { currentBalance: increment(receipt!.receivedAmount) });
    
    batch.commit().then(() => {
      toast({ title: "ยืนยันใบเสร็จสำเร็จ", description: "ยอดเงินถูกเพิ่มเข้าบัญชีธนาคารและอัปเดตสถานะลูกหนี้แล้ว" });
    });
  };

  if (isReceiptLoading || !receipt || !currentUser) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-12 w-12 text-primary animate-spin" /></div>;
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.push('/receipts')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Receipt Detail (รายละเอียดการรับเงิน)</h1>
              <p className="text-sm text-muted-foreground font-mono font-bold text-primary">{receipt.receiptNo}</p>
            </div>
          </div>
          <Badge variant={receipt.status === 'ISSUED' ? 'default' : 'outline'} className={receipt.status === 'ISSUED' ? 'bg-green-600 py-1.5 px-4' : 'py-1.5 px-4'}>
            STATUS: {receipt.status}
          </Badge>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader className="bg-primary/5 border-b">
                <CardTitle className="text-lg flex items-center gap-2"><Wallet className="h-5 w-5" /> ข้อมูลการรับชำระ</CardTitle>
              </CardHeader>
              <CardContent className="pt-6 grid grid-cols-2 gap-6">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">วันที่รับเงิน:</Label>
                  <p className="font-medium">{receipt.receiptDate}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">วิธีชำระเงิน:</Label>
                  <p className="font-bold">{receipt.paymentMethod}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">บัญชีปลายทาง:</Label>
                  <p className="font-semibold text-primary">{bankAccount?.accountCode} - {bankAccount?.bankName}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">ยอดเงินรับสุทธิ:</Label>
                  <p className="text-2xl font-black text-green-700">฿ {receipt.receivedAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between border-b">
                <div>
                  <CardTitle className="text-lg">การจัดสรรยอดเงิน (Invoices Allocated)</CardTitle>
                  <CardDescription>จัดสรรยอดรับเงินเข้ากับใบกำกับภาษีที่ค้างชำระ</CardDescription>
                </div>
                {receipt.status === 'DRAFT' && (
                  <Dialog open={isAllocationOpen} onOpenChange={setIsAllocationOpen}>
                    <DialogTrigger asChild>
                      <Button className="gap-2"><Plus className="h-4 w-4" /> จัดสรรยอด</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>จัดสรรยอดเงินชำระ</DialogTitle></DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label>เลือกใบกำกับภาษีที่ค้างชำระ</Label>
                          <Select onValueChange={setSelectedInvoiceId}>
                            <SelectTrigger><SelectValue placeholder="ค้นหาใบกำกับภาษี..." /></SelectTrigger>
                            <SelectContent>
                              {customerInvoices?.filter(inv => inv.status === 'ISSUED').map(inv => (
                                <SelectItem key={inv.id} value={inv.id}>{inv.taxInvoiceNo} | ฿{inv.totalAmount.toLocaleString()}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>จำนวนเงินจัดสรร (Allocated Amount)</Label>
                          <Input type="number" value={allocAmount} onChange={e => setAllocAmount(parseFloat(e.target.value))} />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button onClick={handleAddAllocation}>ยืนยันการจัดสรร</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead>ใบกำกับภาษี (Ref)</TableHead>
                      <TableHead className="text-right">ยอดเงินจัดสรร</TableHead>
                      <TableHead className="text-right">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allocations?.map(a => (
                      <TableRow key={a.id}>
                        <TableCell className="font-mono">{customerInvoices?.find(inv => inv.id === a.taxInvoiceId)?.taxInvoiceNo}</TableCell>
                        <TableCell className="text-right font-bold text-primary">฿ {a.amountAllocated.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" className="text-destructive"><Trash2 className="h-4 w-4" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!allocations?.length && (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center py-10 text-muted-foreground italic text-xs">ยังไม่มีการจัดสรรยอดเงิน</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="border-green-600/20 bg-green-50/20 shadow-lg">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Coins className="h-5 w-5 text-green-600" /> สรุปการจัดสรร</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">ยอดรับเงินทั้งหมด:</span>
                  <span className="font-bold">฿ {receipt.receivedAmount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">จัดสรรแล้ว:</span>
                  <span className="font-bold text-green-700">฿ {totalAllocated.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm border-t pt-2">
                  <span className="text-muted-foreground">คงเหลือรอจัดสรร:</span>
                  <span className="font-black text-lg text-primary">฿ {(receipt.receivedAmount - totalAllocated).toLocaleString()}</span>
                </div>
                
                {receipt.status === 'DRAFT' && totalAllocated > 0 && (
                  <Button className="w-full mt-4 bg-green-600 hover:bg-green-700 font-bold h-12" onClick={handleFinalize}>
                    <CheckCircle2 className="h-4 w-4 mr-2" /> ยืนยันใบเสร็จ (Finalize)
                  </Button>
                )}
              </CardContent>
            </Card>

            <Card className="border-dashed">
              <CardHeader><CardTitle className="text-sm flex items-center gap-2 text-primary font-bold"><Info className="h-4 w-4" /> ขั้นตอนถัดไป</CardTitle></CardHeader>
              <CardContent className="text-[10px] text-muted-foreground leading-relaxed">
                การยืนยันใบเสร็จจะส่งผลดังนี้:
                <ul className="list-disc pl-4 mt-2">
                  <li>ปรับสถานะใบเสร็จเป็น ISSUED</li>
                  <li>เพิ่มยอดเงินในบัญชีธนาคาร (Current Balance)</li>
                  <li>ลดยอดค้างชำระในระบบลูกหนี้ (AR)</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
