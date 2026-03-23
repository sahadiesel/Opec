
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
  Inbox, 
  Building2, 
  Calendar,
  AlertTriangle,
  Info,
  Loader2
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { APBill, APBillStatus, User, Vendor, Purchase } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';
import { collection, query, orderBy } from 'firebase/firestore';
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';

export default function APBillsPage() {
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const isAuthorized = useMemo(
    () => !!currentUser && canView(currentUser, 'ap_bills'),
    [currentUser]
  );

  const billsQuery = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return query(collection(firestore, 'ap_bills'), orderBy('billReceivedDate', 'desc'));
  }, [firestore, isAuthorized]);

  const { data: bills, isLoading } = useCollection<APBill>(billsQuery as any);

  const vendorsQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'vendors') : null), [firestore, isAuthorized]);
  const { data: vendors } = useCollection<Vendor>(vendorsQuery as any);

  const purchasesQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'purchases') : null), [firestore, isAuthorized]);
  const { data: purchases } = useCollection<Purchase>(purchasesQuery as any);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newBill, setNewBill] = useState<Partial<APBill>>({
    apBillNo: getPreviewPattern('ap_bill'),
    billReceivedDate: new Date().toISOString().split('T')[0],
    invoiceDate: new Date().toISOString().split('T')[0],
    dueDate: new Date(Date.now() + 2592000000).toISOString().split('T')[0], // 30 days
    status: 'RECEIVED',
    paymentTerms: 'Credit 30 Days',
    notes: ''
  });

  const handleCreate = async () => {
    if (!firestore || !currentUser) return;
    if (!newBill.vendorId || !newBill.supplierInvoiceNo) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาระบุคู่ค้าและเลขที่ใบแจ้งหนี้" });
      return;
    }

    setIsCreating(true);
    try {
      // 1. Atomic Number Generation for the Bill
      const { code: finalNo } = await generateNextDocumentCode(firestore, 'ap_bill', { actor: currentUser.displayName });

      // 2. Atomic Number Generation for the AP sub-ledger entry
      const { code: apNo } = await generateNextDocumentCode(firestore, 'ap', { actor: currentUser.displayName });

      const docRef = await addDocumentNonBlocking(collection(firestore, 'ap_bills'), {
        ...newBill,
        apBillNo: finalNo,
        amountBeforeTax: 0,
        vatAmount: 0,
        totalAmount: 0,
        outstandingAmount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      // 3. Automatically create an Accounts Payable record
      await addDocumentNonBlocking(collection(firestore, 'accounts_payable'), {
        vendorId: newBill.vendorId,
        documentNo: apNo, // Sequential AP- number
        referenceId: docRef?.id || '',
        referenceNo: finalNo, // Original Bill No
        billDate: newBill.invoiceDate,
        dueDate: newBill.dueDate,
        debitAmount: 0, 
        creditAmount: 0, // Will be updated when lines are added
        outstandingAmount: 0,
        status: 'OPEN',
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      setIsDialogOpen(false);
      toast({ title: "บันทึกใบวางบิลเจ้าหนี้สำเร็จ", description: `เลขที่: ${finalNo}` });
      if (docRef) router.push(`/ap-bills/${docRef.id}`);
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถบันทึกข้อมูลได้" });
    } finally {
      setIsCreating(false);
    }
  };

  const getStatusBadge = (status: APBillStatus) => {
    switch (status) {
      case 'RECEIVED': return <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200">RECEIVED</Badge>;
      case 'VERIFIED': return <Badge variant="outline" className="bg-blue-50 text-blue-600 border-blue-200">VERIFIED</Badge>;
      case 'APPROVED': return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">APPROVED</Badge>;
      case 'PAID': return <Badge className="bg-green-600">PAID</Badge>;
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
            <Inbox className="h-8 w-8" /> รับวางบิลเจ้าหนี้ (AP Bills)
          </h1>
          <p className="text-muted-foreground text-lg">
            บันทึกใบแจ้งหนี้/ใบวางบิลจากคู่ค้า เพื่อตรวจสอบและเตรียมการจ่ายเงิน
          </p>
        </div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="ค้นหาเลขที่บิล หรือ ชื่อคู่ค้า..." className="pl-9 h-11" />
            </div>
            <Button variant="outline" className="h-11 gap-2"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
          </div>
          
          <Dialog open={isAuthorized && isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 h-11 px-6 bg-primary shadow-md text-base font-bold">
                <Plus className="h-5 w-5" /> บันทึกใบวางบิลใหม่ (Record AP Bill)
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>บันทึกใบวางบิลเจ้าหนี้</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                <div className="space-y-2 md:col-span-2">
                  <Label>เลขที่บันทึกภายใน (Internal Ref)</Label>
                  <Input value={newBill.apBillNo} disabled className="bg-muted/50 font-mono font-bold text-primary" />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>คู่ค้า / ผู้ขาย (Vendor)</Label>
                  <Select onValueChange={v => setNewBill({...newBill, vendorId: v})}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="เลือกบริษัทคู่ค้า..." /></SelectTrigger>
                    <SelectContent>
                      {vendors?.map(v => (
                        <SelectItem key={v.id} value={v.id}>{v.vendorName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>เลขที่ใบแจ้งหนี้คู่ค้า (Supplier Invoice No.)</Label>
                  <Input value={newBill.supplierInvoiceNo} onChange={e => setNewBill({...newBill, supplierInvoiceNo: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>วันที่ได้รับเอกสาร</Label>
                  <Input type="date" value={newBill.billReceivedDate} onChange={e => setNewBill({...newBill, billReceivedDate: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>วันที่ในใบแจ้งหนี้</Label>
                  <Input type="date" value={newBill.invoiceDate} onChange={e => setNewBill({...newBill, invoiceDate: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>วันครบกำหนด (Due Date)</Label>
                  <Input type="date" value={newBill.dueDate} onChange={e => setNewBill({...newBill, dueDate: e.target.value})} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>อ้างอิงรายการซื้อ (Optional Purchase Ref)</Label>
                  <Select onValueChange={v => setNewBill({...newBill, purchaseId: v})}>
                    <SelectTrigger><SelectValue placeholder="เลือกรายการซื้อที่อ้างอิง..." /></SelectTrigger>
                    <SelectContent>
                      {purchases?.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.purchaseNo} | ฿{p.totalAmount.toLocaleString()}</SelectItem>
                      ))}
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

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูล...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4 pl-6">เลขที่บันทึก (Internal No.)</TableHead>
                    <TableHead className="font-bold">คู่ค้า (Vendor)</TableHead>
                    <TableHead className="font-bold">เลขที่ใบแจ้งหนี้</TableHead>
                    <TableHead className="font-bold">ครบกำหนด</TableHead>
                    <TableHead className="font-bold text-right">ยอดเงินรวม</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bills?.map((b) => {
                    const vendor = vendors?.find(v => v.id === b.vendorId);
                    return (
                      <TableRow 
                        key={b.id} 
                        className="cursor-pointer hover:bg-muted/30 group transition-all" 
                        onClick={() => router.push(`/ap-bills/${b.id}`)}
                      >
                        <TableCell className="py-4 pl-6 font-bold text-primary font-mono">{b.apBillNo}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-sm font-bold text-primary">
                            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                            {vendor?.vendorName || 'N/A'}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs font-medium">{b.supplierInvoiceNo}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-xs text-red-600 font-bold">
                            <Calendar className="h-3 w-3" />
                            {b.dueDate}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-black text-primary">
                          ฿ {b.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell>{getStatusBadge(b.status)}</TableCell>
                        <TableCell className="text-right pr-6">
                          <Button variant="ghost" size="icon" className="group-hover:text-primary"><ChevronRight className="h-5 w-5" /></Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {(!bills || bills.length === 0) && !isLoading && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-20 text-muted-foreground italic">ไม่มีรายการใบวางบิลเจ้าหนี้</TableCell>
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
