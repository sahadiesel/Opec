'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { 
  ArrowLeft, 
  Plus, 
  Trash2, 
  Save, 
  PackagePlus, 
  Building2, 
  Calendar, 
  ShoppingCart,
  CheckCircle2,
  Info,
  Loader2,
  Calculator,
  Search,
  FileText,
  TrendingUp
} from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, doc, writeBatch, increment, query, orderBy } from 'firebase/firestore';
import { StoreItem, Vendor, Purchase, User as AppUser } from '@/lib/types';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';

interface ReceiveLine {
  id: string;
  itemId: string;
  itemName: string;
  itemCode: string;
  quantity: number;
  unit: string;
  unitCost: number;
  currentStock: number;
}

export default function StoreReceivePage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const firestore = useFirestore();
  const { toast } = useToast();

  // Header State
  const [receiveNo, setReceiveNo] = useState(`REC-${Date.now().toString().slice(-6)}`);
  const [receiveDate, setReceiveDate] = useState(new Date().toISOString().split('T')[0]);
  const [vendorId, setVendorId] = useState('');
  const [refPurchaseId, setRefPurchaseId] = useState('');
  const [notes, setNotes] = useState('');

  // Items State
  const [receiveLines, setReceiveLines] = useState<ReceiveLine[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  // Data Queries
  const itemsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'store_items') : null), [firestore]);
  const { data: allStoreItems } = useCollection<StoreItem>(itemsQuery as any);

  const vendorsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'vendors') : null), [firestore]);
  const { data: allVendors } = useCollection<Vendor>(vendorsQuery as any);

  const purchasesQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'purchases') : null), [firestore]);
  const { data: allPurchases } = useCollection<Purchase>(purchasesQuery as any);

  const handleAddItem = (itemId: string) => {
    const item = allStoreItems?.find(i => i.id === itemId);
    if (!item) return;
    if (receiveLines.some(l => l.itemId === itemId)) return;

    setReceiveLines([...receiveLines, {
      id: Math.random().toString(36).substr(2, 9),
      itemId: item.id,
      itemName: item.itemName,
      itemCode: item.itemCode,
      quantity: 1,
      unit: item.unit,
      unitCost: 0,
      currentStock: item.currentStock
    }]);
  };

  const handleRemoveLine = (id: string) => {
    setReceiveLines(receiveLines.filter(l => l.id !== id));
  };

  const updateLine = (id: string, field: keyof ReceiveLine, value: any) => {
    setReceiveLines(receiveLines.map(l => l.id === id ? { ...l, [field]: value } : l));
  };

  const totals = useMemo(() => {
    return receiveLines.reduce((sum, l) => sum + (l.quantity * l.unitCost), 0);
  }, [receiveLines]);

  const handleConfirmReceive = async () => {
    if (!firestore || !currentUser || receiveLines.length === 0) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาระบุรายการสินค้าที่ต้องการรับเข้า" });
      return;
    }

    setIsSubmitting(true);

    try {
      const batch = writeBatch(firestore);
      const receiptRef = doc(collection(firestore, 'store_receipts'));
      
      // 1. Create Header
      batch.set(receiptRef, {
        receiveNo,
        receiveDate,
        vendorId,
        referencePurchaseId: refPurchaseId,
        notes,
        totalAmount: totals,
        createdAt: Date.now(),
        createdBy: currentUser.displayName
      });

      // 2. Process Items
      const linesColRef = collection(receiptRef, 'items');
      for (const line of receiveLines) {
        const lineDocRef = doc(linesColRef);
        batch.set(lineDocRef, {
          itemId: line.itemId,
          quantity: line.quantity,
          unitCost: line.unitCost,
          amount: line.quantity * line.unitCost
        });

        // Update Master Stock
        const itemRef = doc(firestore, 'store_items', line.itemId);
        batch.update(itemRef, { 
          currentStock: increment(line.quantity),
          updatedAt: Date.now()
        });

        // Log Transaction
        const txRef = doc(collection(firestore, 'store_transactions'));
        batch.set(txRef, {
          itemId: line.itemId,
          transactionType: 'RECEIVE',
          quantity: line.quantity,
          transactionDate: receiveDate,
          referenceType: 'RECEIPT',
          referenceId: receiptRef.id,
          notes: `Receive No: ${receiveNo}. ${notes}`,
          createdAt: Date.now(),
          createdBy: currentUser.displayName
        });
      }

      await batch.commit();

      toast({ title: "รับของเข้าคลังสำเร็จ", description: `บันทึกรายการเลขที่ ${receiveNo} เรียบร้อยแล้ว` });
      router.push('/store');
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถบันทึกข้อมูลได้" });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-[1600px] mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild><Link href="/store"><ArrowLeft className="h-5 w-5" /></Link></Button>
          <div className="flex-1">
            <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
              <PackagePlus className="h-8 w-8 text-primary" /> รับของเข้าคลัง (Receive Inventory)
            </h1>
            <p className="text-muted-foreground text-lg">ใช้สำหรับเพิ่มสินค้าเข้าสต็อก โดยสามารถอ้างอิงจากรายการสั่งซื้อ (Purchase Orders)</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Main Form Area */}
          <div className="lg:col-span-3 space-y-6">
            <Card className="shadow-md">
              <CardHeader className="bg-primary/5 border-b">
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileText className="h-5 w-5 text-primary" /> ข้อมูลหัวเอกสาร (Receipt Header)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label className="font-bold">เลขที่ใบรับ (Receive No.)</Label>
                  <Input value={receiveNo} onChange={e => setReceiveNo(e.target.value)} className="h-11 font-mono font-bold text-primary" />
                </div>
                <div className="space-y-2">
                  <Label className="font-bold">วันที่รับของ (Date)</Label>
                  <Input type="date" value={receiveDate} onChange={e => setReceiveDate(e.target.value)} className="h-11" />
                </div>
                <div className="space-y-2">
                  <Label className="font-bold">คู่ค้า / ผู้ขาย (Vendor)</Label>
                  <Select onValueChange={setVendorId} value={vendorId}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="เลือกบริษัทคู่ค้า..." /></SelectTrigger>
                    <SelectContent>
                      {allVendors?.map(v => (
                        <SelectItem key={v.id} value={v.id}>{v.vendorName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label className="font-bold">อ้างอิงรายการสั่งซื้อ (PO Reference - Optional)</Label>
                  <Select onValueChange={setRefPurchaseId} value={refPurchaseId}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="เลือกรายการสั่งซื้อที่อ้างอิง..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">-- ไม่ระบุ --</SelectItem>
                      {allPurchases?.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.purchaseNo} | ฿{p.totalAmount.toLocaleString()}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="font-bold">หมายเหตุ</Label>
                  <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="เช่น ระบุเลขที่ใบส่งของ..." className="h-11" />
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-md overflow-hidden">
              <CardHeader className="bg-muted/20 border-b flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-lg">รายการสินค้าที่รับเข้า (Inventory Items)</CardTitle>
                  <CardDescription>ระบุจำนวนและต้นทุนต่อหน่วยของแต่ละรายการ</CardDescription>
                </div>
                <div className="w-72 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Select onValueChange={handleAddItem}>
                    <SelectTrigger className="h-10 pl-9"><SelectValue placeholder="ค้นหาและเพิ่มอุปกรณ์..." /></SelectTrigger>
                    <SelectContent>
                      {allStoreItems?.filter(i => i.active).map(i => (
                        <SelectItem key={i.id} value={i.id}>{i.itemCode} | {i.itemName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="font-bold pl-6">สินค้า (Item)</TableHead>
                      <TableHead className="text-center font-bold">สต็อกเดิม</TableHead>
                      <TableHead className="text-center font-bold">จำนวนรับเข้า</TableHead>
                      <TableHead className="text-center font-bold">สต็อกหลังรับ</TableHead>
                      <TableHead className="text-right font-bold">ต้นทุน/หน่วย</TableHead>
                      <TableHead className="text-right font-bold">ยอดรวม</TableHead>
                      <TableHead className="text-right pr-6">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {receiveLines.map((line) => (
                      <TableRow key={line.id} className="hover:bg-muted/10">
                        <TableCell className="pl-6">
                          <div className="flex flex-col">
                            <span className="font-bold text-sm text-primary">{line.itemName}</span>
                            <span className="text-[10px] font-mono text-muted-foreground">{line.itemCode}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center text-muted-foreground">{line.currentStock} {line.unit}</TableCell>
                        <TableCell className="text-center">
                          <Input 
                            type="number" 
                            className="w-20 mx-auto text-center h-8 font-bold" 
                            value={line.quantity} 
                            onChange={e => updateLine(line.id, 'quantity', parseInt(e.target.value) || 0)} 
                          />
                        </TableCell>
                        <TableCell className="text-center font-black text-green-700">
                          <div className="flex items-center justify-center gap-1">
                            <TrendingUp className="h-3 w-3" />
                            {line.currentStock + line.quantity}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Input 
                            type="number" 
                            className="w-24 ml-auto text-right h-8" 
                            value={line.unitCost} 
                            onChange={e => updateLine(line.id, 'unitCost', parseFloat(e.target.value) || 0)} 
                          />
                        </TableCell>
                        <TableCell className="text-right font-bold text-primary">
                          ฿ {(line.quantity * line.unitCost).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleRemoveLine(line.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {receiveLines.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="py-20 text-center space-y-4">
                          <div className="bg-muted/20 w-16 h-16 rounded-full flex items-center justify-center mx-auto">
                            <Plus className="h-8 w-8 text-muted-foreground/40" />
                          </div>
                          <p className="text-sm text-muted-foreground italic">ยังไม่มีรายการสินค้า กรุณาค้นหาและเลือกอุปกรณ์ด้านบน</p>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar: Summary & Action */}
          <div className="space-y-6">
            <Card className="border-primary/20 shadow-lg">
              <CardHeader className="bg-primary text-primary-foreground">
                <CardTitle className="text-base flex items-center gap-2">
                  <Calculator className="h-5 w-5" /> สรุปยอดรับเข้า (Summary)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">จำนวนรายการ:</span>
                  <span className="font-bold">{receiveLines.length} รายการ</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">ยอดรวมก่อนภาษี:</span>
                  <span className="font-bold">฿ {totals.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between text-sm border-b pb-2">
                  <span className="text-muted-foreground">ภาษีมูลค่าเพิ่ม (7% Est.):</span>
                  <span className="font-bold">฿ {(totals * 0.07).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between text-lg pt-2">
                  <span className="font-black text-primary uppercase">ยอดรวมสุทธิ:</span>
                  <span className="font-black text-2xl text-primary">฿ {(totals * 1.07).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>

                <Separator className="my-4" />

                <Button 
                  className="w-full h-14 font-black text-lg bg-primary shadow-lg" 
                  disabled={receiveLines.length === 0 || isSubmitting}
                  onClick={handleConfirmReceive}
                >
                  {isSubmitting ? <Loader2 className="h-6 w-6 animate-spin mr-2" /> : <CheckCircle2 className="h-6 w-6 mr-2" />}
                  ยืนยันรับของ (Confirm Intake)
                </Button>
              </CardContent>
            </Card>

            <Card className="bg-primary/5 border-dashed border-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold uppercase flex items-center gap-2 text-primary">
                  <Info className="h-4 w-4" /> ผลลัพธ์หลังบันทึก
                </CardTitle>
              </CardHeader>
              <CardContent className="text-[10px] text-muted-foreground leading-relaxed space-y-2">
                <p>1. ระบบจะเพิ่มสต็อกสินค้า (Current Stock) ในทะเบียนอุปกรณ์ทันที</p>
                <p>2. สร้างรายการ Transaction ประเภท RECEIVE เพื่อใช้ตรวจสอบยอด</p>
                <p>3. ข้อมูลชุดนี้สามารถนำไปอ้างอิงตอนทำจ่ายเงินคู่ค้า (AP Bill) ได้ในอนาคต</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
