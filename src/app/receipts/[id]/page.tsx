
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
  Coins,
  History
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useUser, useCollection } from '@/firebase';
import { collection, doc, query, where, updateDoc, increment, writeBatch, getDocs } from 'firebase/firestore';
import { updateDocumentNonBlocking, addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Receipt as ReceiptType, ReceiptStatus, ReceiptAllocation, TaxInvoice, User, Customer, BankAccount, AccountsReceivable } from '@/lib/types';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { writeAuditLog } from '@/lib/services/audit-service';
import { receiptCashDepositAmount } from '@/lib/receipt-utils';
import { formatDateTimeThaiBE } from '@/lib/date-thai';

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
  const [allocWht, setAllocWht] = useState(0);
  const [whtCertNo, setWhtCertNo] = useState('');

  const totalCashAllocated = useMemo(() => {
    return allocations?.reduce((sum, a) => sum + Number(a.amountAllocated), 0) || 0;
  }, [allocations]);

  const totalWhtAllocated = useMemo(() => {
    return allocations?.reduce((sum, a) => sum + Number(a.withholdingTaxAmount || 0), 0) || 0;
  }, [allocations]);

  const totalSettlementAllocated = totalCashAllocated + totalWhtAllocated;

  const cashDeposit = receipt ? receiptCashDepositAmount(receipt) : 0;

  const handleAddAllocation = async () => {
    if (!firestore || !selectedInvoiceId || !currentUser) return;
    const cash = Number(allocAmount) || 0;
    const wht = Number(allocWht) || 0;
    if (cash <= 0 && wht <= 0) {
      toast({ variant: 'destructive', title: 'ระบุยอด', description: 'ต้องมีอย่างน้อยยอดเงินเข้าบัญชีหรือหัก ณ ที่จ่าย' });
      return;
    }

    if (totalCashAllocated + cash > cashDeposit + 0.0001) {
      toast({
        variant: 'destructive',
        title: 'เกินยอดเงินเข้าบัญชี',
        description: `จัดสรรเงินโอนได้ไม่เกิน ฿${cashDeposit.toLocaleString()} (ยอดใบเสร็จ ฿${receipt!.receivedAmount.toLocaleString()} หัก ณ แล้วเหลือเงินเข้าบัญชี)`,
      });
      return;
    }
    const headerWht = Number(receipt!.withholdingTaxAmount) || 0;
    if (wht > 0 && headerWht <= 0) {
      toast({
        variant: 'destructive',
        title: 'ไม่มีหัก ณ ตามใบเสร็จ',
        description: 'ใบเสร็จนี้ไม่ได้ระบุหัก ณ ที่หัว จึงไม่สามารถจัดสรรหัก ณ ในรายการได้',
      });
      return;
    }
    if (headerWht > 0 && totalWhtAllocated + wht > headerWht + 0.0001) {
      toast({ variant: 'destructive', title: 'เกินยอดหัก ณ', description: 'ผลรวมหัก ณ ในรายการจัดสรรต้องไม่เกินหัก ณ ตามใบเสร็จ' });
      return;
    }

    try {
      await addDocumentNonBlocking(collection(firestore, 'receipts', id, 'allocations'), {
        receiptId: id,
        taxInvoiceId: selectedInvoiceId,
        amountAllocated: cash,
        withholdingTaxAmount: wht > 0 ? wht : undefined,
        whtCertificateNo: whtCertNo.trim() || undefined,
        createdAt: Date.now()
      });

      // Update AR record — ตัดลูกหนี้ทั้งเงินเข้าบัญชีและหัก ณ ที่ลูกค้าหักแทน
      const arQuery = query(collection(firestore, 'accounts_receivable'), where('referenceId', '==', selectedInvoiceId));
      const arSnap = await getDocs(arQuery);
      
      if (!arSnap.empty) {
        const arDoc = arSnap.docs[0];
        const arData = arDoc.data() as AccountsReceivable;
        const applied = cash + wht;
        const newCredit = Number(arData.creditAmount) + applied;
        const newOutstanding = Number(arData.debitAmount) - newCredit;
        
        await updateDoc(arDoc.ref, {
          creditAmount: newCredit,
          outstandingAmount: newOutstanding,
          status: newOutstanding <= 0 ? 'PAID' : 'PARTIALLY_PAID',
          updatedAt: Date.now()
        });

        const refNo = (arData as AccountsReceivable & { referenceNo?: string }).referenceNo;
        await writeAuditLog(firestore, currentUser, {
          actionType: 'ALLOCATE_RECEIPT',
          entityType: 'AccountsReceivable',
          entityId: arDoc.id,
          entityLabel: arData.documentNo,
          sourceModule: 'accounting',
          afterSummary: `จัดสรรจาก ${receipt?.receiptNo}: เงินเข้า ฿${cash.toLocaleString()}${wht > 0 ? ` + หัก ณ ฿${wht.toLocaleString()}${whtCertNo ? ` (${whtCertNo})` : ''}` : ''} → INV ${refNo || selectedInvoiceId}`
        });
      }

      setIsAllocationOpen(false);
      setSelectedInvoiceId('');
      setAllocAmount(0);
      setAllocWht(0);
      setWhtCertNo('');
      toast({ title: "จัดสรรยอดสำเร็จ" });
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถบันทึกข้อมูลได้" });
    }
  };

  const handleFinalize = async () => {
    if (!receiptRef || !bankAccountRef || !firestore || !currentUser) return;

    const receiptGross = receipt!.receivedAmount;
    if (Math.abs(totalSettlementAllocated - receiptGross) > 0.01) {
      toast({
        variant: 'destructive',
        title: 'ยอดจัดสรรไม่ครบ',
        description: `ต้องตัดลูกหนี้รวม (เงินเข้า + หัก ณ) ให้เท่ายอดตามใบเสร็จ ฿${receiptGross.toLocaleString()} (ตอนนี้ ฿${totalSettlementAllocated.toLocaleString()})`,
      });
      return;
    }
    
    const deposit = receiptCashDepositAmount(receipt!);
    const batch = writeBatch(firestore);
    batch.update(receiptRef, { status: 'ISSUED', updatedAt: Date.now() });
    batch.update(bankAccountRef, { currentBalance: increment(deposit) });
    
    await batch.commit();
    
    await writeAuditLog(firestore, currentUser, {
      actionType: 'ISSUED',
      entityType: 'Receipt',
      entityId: id,
      entityLabel: receipt?.receiptNo,
      sourceModule: 'accounting',
      afterSummary: `Finalized receipt. ฿${receiptCashDepositAmount(receipt!).toLocaleString()} cash to bank (receipt doc ฿${receipt?.receivedAmount.toLocaleString()}) ${bankAccount?.accountCode || ''}`
    });

    toast({
      title: 'ยืนยันใบเสร็จสำเร็จ',
      description: `เพิ่มยอดเข้าบัญชี ฿${cashDeposit.toLocaleString()} (ยอดตามใบเสร็จ ฿${receipt!.receivedAmount.toLocaleString()})`,
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
                  <p className="font-semibold text-primary">{bankAccount?.accountCode || '...'} - {bankAccount?.bankName || '...'}</p>
                </div>
                <div className="space-y-1 md:col-span-2">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">ยอดตามใบเสร็จ / ใบกำกับภาษี</Label>
                  <p className="text-2xl font-black text-primary">฿ {receipt.receivedAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                </div>
                {(receipt.withholdingTaxAmount || 0) > 0 && (
                  <>
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase text-muted-foreground font-bold">เงินโอนเข้าบัญชีจริง</Label>
                      <p className="text-xl font-black text-green-700">
                        ฿ {cashDeposit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase text-muted-foreground font-bold">หัก ณ ที่จ่าย (คู่ใบกำกับ)</Label>
                      <p className="text-xl font-bold text-amber-800">
                        ฿ {Number(receipt.withholdingTaxAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </p>
                      {receipt.whtCertificateNo && (
                        <p className="text-xs text-muted-foreground">เลขที่หนังสือ: {receipt.whtCertificateNo}</p>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between border-b">
                <div>
                  <CardTitle className="text-lg">การจัดสรรยอดเงิน (Invoices Allocated)</CardTitle>
                  <CardDescription>
                    ตัดลูกหนี้ใบกำกับด้วยเงินเข้าบัญชี + หัก ณ (รวมต้องครบยอดตามใบเสร็จเมื่อชำระเต็ม)
                  </CardDescription>
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
                          <Label>เงินโอน — ตัดลูกหนี้ (ไม่เกินยอดเงินเข้าบัญชีคงเหลือ)</Label>
                          <Input type="number" value={allocAmount || ''} onChange={e => setAllocAmount(parseFloat(e.target.value) || 0)} />
                        </div>
                        <div className="space-y-2">
                          <Label>หัก ณ คู่ใบกำกับ — ตัดลูกหนี้ (ไม่ผ่านเงินเข้าบัญชี)</Label>
                          <Input type="number" value={allocWht || ''} onChange={e => setAllocWht(parseFloat(e.target.value) || 0)} />
                        </div>
                        <div className="space-y-2">
                          <Label>เลขที่หนังสือหัก ณ ที่จ่าย (ถ้ามี)</Label>
                          <Input value={whtCertNo} onChange={e => setWhtCertNo(e.target.value)} placeholder="อ้างอิงเอกสารหัก ณ" />
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
                      <TableHead className="pl-6">ใบกำกับภาษี (Ref)</TableHead>
                      <TableHead className="text-right">เงินเข้า</TableHead>
                      <TableHead className="text-right">หัก ณ</TableHead>
                      <TableHead className="text-right pr-6">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allocations?.map(a => (
                      <TableRow key={a.id}>
                        <TableCell className="pl-6 font-mono text-sm">
                          {customerInvoices?.find(inv => inv.id === a.taxInvoiceId)?.taxInvoiceNo || 'Unknown Ref'}
                        </TableCell>
                        <TableCell className="text-right font-bold text-primary">฿ {a.amountAllocated.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                        <TableCell className="text-right text-amber-800 text-sm">
                          {a.withholdingTaxAmount ? `฿ ${a.withholdingTaxAmount.toLocaleString()}` : '—'}
                          {a.whtCertificateNo && <span className="block text-[10px] text-muted-foreground">{a.whtCertificateNo}</span>}
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          {receipt.status === 'DRAFT' && (
                            <Button variant="ghost" size="icon" className="text-destructive"><Trash2 className="h-4 w-4" /></Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!allocations?.length && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-10 text-muted-foreground italic text-xs">ยังไม่มีการจัดสรรยอดเงิน</TableCell>
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
                  <span className="text-muted-foreground">ยอดตามใบเสร็จ / ใบกำกับ:</span>
                  <span className="font-bold">฿ {receipt.receivedAmount.toLocaleString()}</span>
                </div>
                {(receipt.withholdingTaxAmount || 0) > 0 && (
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>เงินเข้าบัญชี (จัดสรรได้)</span>
                    <span>฿ {cashDeposit.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm border-t pt-2">
                  <span className="text-muted-foreground">ตัดลูกหนี้แล้ว (เงิน + หัก ณ):</span>
                  <span className="font-bold text-green-700">฿ {totalSettlementAllocated.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">เหลือตัดลูกหนี้ตามใบเสร็จ:</span>
                  <span className="font-black text-primary">
                    ฿ {(receipt.receivedAmount - totalSettlementAllocated).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>เงินเข้าจัดสรรแล้ว / เหลือ</span>
                  <span>
                    ฿ {totalCashAllocated.toLocaleString()} / ฿ {(cashDeposit - totalCashAllocated).toLocaleString()}
                  </span>
                </div>
                
                {receipt.status === 'DRAFT' && totalSettlementAllocated > 0 && (
                  <Button className="w-full mt-4 bg-green-600 hover:bg-green-700 font-bold h-12 shadow-md" onClick={handleFinalize}>
                    <CheckCircle2 className="h-4 w-4 mr-2" /> ยืนยันใบเสร็จ (Finalize)
                  </Button>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2 border-b">
                <CardTitle className="text-xs font-bold uppercase text-muted-foreground flex items-center gap-2">
                  <History className="h-3 w-3" /> Audit Log
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 text-[10px] space-y-2">
                <div className="flex justify-between">
                  <span>สถานะปัจจุบัน:</span>
                  <span className="font-bold">{receipt.status}</span>
                </div>
                <div className="flex justify-between">
                  <span>สร้างเมื่อ:</span>
                  <span>{formatDateTimeThaiBE(receipt.createdAt)}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
