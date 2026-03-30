'use client';

import { useState, use, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  ArrowLeft, 
  Save, 
  Plus, 
  Trash2, 
  Building2, 
  Calendar, 
  PackageSearch,
  ShoppingCart,
  CheckCircle2,
  History,
  Info,
  Loader2,
  ChevronRight,
  Calculator
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useUser, useCollection } from '@/firebase';
import { doc, collection, updateDoc, writeBatch } from 'firebase/firestore';
import { updateDocumentNonBlocking, addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { 
  Purchase, 
  PurchaseLine, 
  PurchaseStatus, 
  User, 
  Vendor
} from '@/lib/types';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription,
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter
} from '@/components/ui/dialog';
import { useAppUser } from '@/hooks/use-app-user';
import { canView, canEdit, canDelete } from '@/lib/permissions';

export default function PurchaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const canViewPurchases = useMemo(() => canView(currentUser, 'purchases'), [currentUser]);
  const canEditPurchases = useMemo(() => canEdit(currentUser, 'purchases'), [currentUser]);
  const canDeletePurchases = useMemo(() => canDelete(currentUser, 'purchases'), [currentUser]);

  const purchaseRef = useMemoFirebase(() => (firestore && canViewPurchases ? doc(firestore, 'purchases', id) : null), [firestore, id, canViewPurchases]);
  const { data: purchase, isLoading: isPurchaseLoading } = useDoc<Purchase>(purchaseRef as any);

  const linesQuery = useMemoFirebase(() => (firestore && canViewPurchases ? collection(firestore, 'purchases', id, 'lines') : null), [firestore, id, canViewPurchases]);
  const { data: lines, isLoading: isLinesLoading } = useCollection<PurchaseLine>(linesQuery as any);

  const vendorsQuery = useMemoFirebase(() => (firestore && canViewPurchases ? collection(firestore, 'vendors') : null), [firestore, canViewPurchases]);
  const { data: vendors } = useCollection<Vendor>(vendorsQuery as any);

  const vendor = vendors?.find(v => v.id === purchase?.vendorId);

  const [isAddingLine, setIsAddingLine] = useState(false);
  const [newLine, setNewLine] = useState<Partial<PurchaseLine>>({
    itemDescription: '',
    quantity: 1,
    unitPrice: 0
  });

  const handleAddLine = async () => {
    if (!canEditPurchases) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์เพิ่มรายการสั่งซื้อ' });
      return;
    }
    if (!firestore || !newLine.itemDescription || !newLine.quantity || !newLine.unitPrice) return;
    
    const lineRef = collection(firestore, 'purchases', id, 'lines');
    const amount = Number(newLine.quantity) * Number(newLine.unitPrice);
    
    await addDocumentNonBlocking(lineRef, {
      ...newLine,
      purchaseId: id,
      amount,
      createdAt: Date.now()
    });

    recalculateTotals([...(lines || []), { ...newLine, amount } as any]);
    setIsAddingLine(false);
    setNewLine({ itemDescription: '', quantity: 1, unitPrice: 0 });
    toast({ title: "เพิ่มรายการสำเร็จ" });
  };

  const handleDeleteLine = async (lineId: string) => {
    if (!canDeletePurchases) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์ลบรายการสั่งซื้อ' });
      return;
    }
    if (!firestore) return;
    await deleteDocumentNonBlocking(doc(firestore, 'purchases', id, 'lines', lineId));
    recalculateTotals(lines?.filter(l => l.id !== lineId) || []);
    toast({ title: "ลบรายการสำเร็จ" });
  };

  const recalculateTotals = (currentLines: PurchaseLine[]) => {
    if (!purchaseRef) return;
    const amountBeforeTax = currentLines.reduce((sum, l) => sum + Number(l.amount), 0);
    const vatAmount = amountBeforeTax * 0.07;
    const totalAmount = amountBeforeTax + vatAmount;
    
    updateDoc(purchaseRef, {
      amountBeforeTax,
      vatAmount,
      totalAmount,
      updatedAt: Date.now()
    });
  };

  const handleUpdateStatus = (newStatus: PurchaseStatus) => {
    if (!canEditPurchases) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์เปลี่ยนสถานะเอกสาร' });
      return;
    }
    if (!purchaseRef) return;
    updateDocumentNonBlocking(purchaseRef, { status: newStatus, updatedAt: Date.now() });
    toast({ title: "อัปเดตสถานะสำเร็จ", description: `เปลี่ยนสถานะเป็น ${newStatus}` });
  };

  if (userLoading || !currentUser) return null;
  if (!canViewPurchases) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-5xl mx-auto py-10 text-center text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงเมนูนี้</div>
      </AppShell>
    );
  }
  if (isPurchaseLoading || !purchase) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-12 w-12 text-primary animate-spin" /></div>;
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-[1600px] mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.push('/purchases')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Purchase Detail (รายละเอียดการซื้อ)</h1>
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <span className="font-mono font-bold text-primary">{purchase.purchaseNo}</span>
                <Separator orientation="vertical" className="h-3" />
                <span>คู่ค้า: {vendor?.vendorName || '...'}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" className="py-1.5 px-4 font-bold border-primary/20 bg-primary/5 text-primary">
              STATUS: {purchase.status}
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-3 space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
                <div>
                  <CardTitle className="text-lg">รายการสินค้า/บริการ (Purchase Items)</CardTitle>
                  <CardDescription>ระบุรายการพัสดุ PPE หรือเครื่องมือที่สั่งซื้อ</CardDescription>
                </div>
                {purchase.status === 'DRAFT' && canEditPurchases && (
                  <Dialog open={isAddingLine} onOpenChange={setIsAddingLine}>
                    <DialogTrigger asChild>
                      <Button className="bg-primary font-bold"><Plus className="h-4 w-4 mr-2" /> เพิ่มรายการ</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>เพิ่มรายการซื้อ</DialogTitle></DialogHeader>
                      <div className="grid gap-4 py-4">
                        <div className="space-y-2">
                          <Label>รายละเอียดสินค้า (Description)</Label>
                          <Input value={newLine.itemDescription} onChange={e => setNewLine({...newLine, itemDescription: e.target.value})} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>จำนวน (Quantity)</Label>
                            <Input type="number" value={newLine.quantity} onChange={e => setNewLine({...newLine, quantity: parseFloat(e.target.value)})} />
                          </div>
                          <div className="space-y-2">
                            <Label>ราคาต่อหน่วย (Unit Price)</Label>
                            <Input type="number" value={newLine.unitPrice} onChange={e => setNewLine({...newLine, unitPrice: parseFloat(e.target.value)})} />
                          </div>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setIsAddingLine(false)}>ยกเลิก</Button>
                        <Button onClick={handleAddLine} disabled={!newLine.itemDescription || !newLine.quantity}>ยืนยัน</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead>รายละเอียด (Description)</TableHead>
                      <TableHead className="text-right">จำนวน</TableHead>
                      <TableHead className="text-right">ราคา/หน่วย</TableHead>
                      <TableHead className="text-right font-bold">ยอดรวม</TableHead>
                      <TableHead className="text-right">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines?.map(line => (
                      <TableRow key={line.id}>
                        <TableCell className="font-medium">{line.itemDescription}</TableCell>
                        <TableCell className="text-right">{line.quantity.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{line.unitPrice.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-bold text-primary">
                          ฿ {line.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right">
                          {canDeletePurchases ? <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDeleteLine(line.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button> : null}
                        </TableCell>
                      </TableRow>
                    ))}
                    {(!lines || lines.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-20 text-muted-foreground italic">ยังไม่มีรายการสินค้า</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="border-primary/10 shadow-lg">
              <CardHeader className="bg-primary/5 border-b">
                <CardTitle className="text-base flex items-center gap-2"><Calculator className="h-5 w-5" /> สรุปยอดเงิน</CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                <div className="flex justify-between items-center text-sm border-b pb-2">
                  <span className="text-muted-foreground">ยอดรวมก่อนภาษี</span>
                  <span className="font-bold">฿ {purchase.amountBeforeTax.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between items-center text-sm border-b pb-2">
                  <span className="text-muted-foreground">ภาษีมูลค่าเพิ่ม (7%)</span>
                  <span className="font-bold">฿ {purchase.vatAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between items-center text-lg pt-2">
                  <span className="font-black text-primary uppercase">ยอดสุทธิ</span>
                  <span className="font-black text-2xl text-primary">฿ {purchase.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-primary text-primary-foreground shadow-lg">
              <CardHeader className="pb-4 border-b border-white/10">
                <CardTitle className="text-sm font-bold uppercase tracking-wider opacity-80">การดำเนินการ (Actions)</CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-3">
                {purchase.status === 'DRAFT' && canEditPurchases && (
                  <Button className="w-full bg-white text-primary hover:bg-slate-100 font-bold" onClick={() => handleUpdateStatus('ISSUED')}>
                    <CheckCircle2 className="h-4 w-4 mr-2" /> ยืนยันรายการซื้อ
                  </Button>
                )}
                {purchase.status === 'ISSUED' && (
                  <Button className="w-full bg-green-600 hover:bg-green-700 text-white font-bold" onClick={() => handleUpdateStatus('COMPLETED')}>
                    <CheckCircle2 className="h-4 w-4 mr-2" /> ปิดรายการ (Completed)
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
