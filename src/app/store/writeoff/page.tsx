'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { 
  ArrowLeft, 
  Plus, 
  Trash2, 
  FileText, 
  AlertTriangle, 
  CheckCircle2, 
  Info, 
  Loader2,
  Search,
  Trash,
  AlertCircle
} from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccessDomain } from '@/lib/permission-core';
import { collection, doc, writeBatch, increment } from 'firebase/firestore';
import { StoreItem, User as AppUser } from '@/lib/types';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { Input } from '@/components/ui/input';
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue } from '@/lib/date-thai';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { 
  AlertDialog, 
  AlertDialogAction, 
  AlertDialogCancel, 
  AlertDialogContent, 
  AlertDialogDescription, 
  AlertDialogFooter, 
  AlertDialogHeader, 
  AlertDialogTitle, 
  AlertDialogTrigger 
} from '@/components/ui/alert-dialog';
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';

interface WriteOffLine {
  id: string;
  itemId: string;
  itemName: string;
  itemCode: string;
  quantity: number;
  unit: string;
  stockBefore: number;
}

export default function StoreWriteOffPage() {
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const canAccess = canAccessDomain(currentUser, 'store');

  // Header State
  const [writeoffNo, setWriteoffNo] = useState(getPreviewPattern('store_writeoff'));
  const [writeoffDate, setWriteoffDate] = useState(() => timestampToHtmlDateValue(Date.now()));
  const [reason, setReason] = useState('DAMAGED');
  const [reasonNote, setReasonNote] = useState('');
  const [performedBy, setPerformedBy] = useState('');

  // Items State
  const [lines, setLines] = useState<WriteOffLine[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (currentUser) setPerformedBy(currentUser.displayName || 'Staff');
  }, [currentUser]);

  const itemsQuery = useMemoFirebase(() => {
    if (!firestore || userLoading || isUserLoading || !firebaseUser || !canAccess) return null;
    return collection(firestore, 'store_items');
  }, [firestore, userLoading, isUserLoading, firebaseUser, canAccess]);
  const { data: allStoreItems } = useCollection<StoreItem>(itemsQuery as any);

  const handleAddItem = (itemId: string) => {
    const item = allStoreItems?.find(i => i.id === itemId);
    if (!item) return;
    if (lines.some(l => l.itemId === itemId)) return;

    if (item.currentStock <= 0) {
      toast({ variant: "destructive", title: "สต็อกเป็นศูนย์", description: "ไม่สามารถเลือกรายการที่ไม่มีของในสต็อกได้" });
      return;
    }

    setLines([...lines, {
      id: Math.random().toString(36).substr(2, 9),
      itemId: item.id,
      itemName: item.itemName,
      itemCode: item.itemCode,
      quantity: 1,
      unit: item.unit,
      stockBefore: item.currentStock
    }]);
  };

  const handleRemoveLine = (id: string) => {
    setLines(lines.filter(l => l.id !== id));
  };

  const updateLineQuantity = (id: string, qty: number) => {
    setLines(lines.map(l => {
      if (l.id === id) {
        const validatedQty = Math.min(l.stockBefore, Math.max(1, qty));
        return { ...l, quantity: validatedQty };
      }
      return l;
    }));
  };

  const handleConfirmWriteOff = async () => {
    if (!firestore || !currentUser || lines.length === 0 || !reason) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาระบุรายการและเหตุผลการตัดจ่าย" });
      return;
    }

    setIsSubmitting(true);

    try {
      // Atomic Sequence Generation
      const { code: finalNo } = await generateNextDocumentCode(firestore, 'store_writeoff', { actor: currentUser.displayName });

      const batch = writeBatch(firestore);
      const headerRef = doc(collection(firestore, 'store_writeoffs'));
      
      // 1. Create Header
      batch.set(headerRef, {
        writeoffNo: finalNo,
        writeoffDate,
        reason,
        reasonNote,
        performedBy,
        createdAt: Date.now(),
        createdBy: currentUser.displayName
      });

      // 2. Process Items
      const linesColRef = collection(headerRef, 'items');
      for (const line of lines) {
        const lineDocRef = doc(linesColRef);
        batch.set(lineDocRef, {
          itemId: line.itemId,
          quantity: line.quantity
        });

        // Update Master Stock (Decrease)
        const itemRef = doc(firestore, 'store_items', line.itemId);
        batch.update(itemRef, { 
          currentStock: increment(-line.quantity),
          updatedAt: Date.now()
        });

        // Log Transaction
        const txRef = doc(collection(firestore, 'store_transactions'));
        batch.set(txRef, {
          itemId: line.itemId,
          transactionType: 'WRITEOFF',
          quantity: line.quantity,
          transactionDate: writeoffDate,
          notes: `Reason: ${reason}. Ref: ${finalNo}. ${reasonNote}`,
          createdAt: Date.now(),
          createdBy: currentUser.displayName
        });
      }

      await batch.commit();

      toast({ title: "ตัดจ่ายอุปกรณ์สำเร็จ", description: `บันทึกรายการเลขที่ ${finalNo} เรียบร้อยแล้ว` });
      router.push('/store');
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถบันทึกข้อมูลได้" });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (userLoading || isUserLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground text-sm">
        กำลังตรวจสอบสิทธิ์…
      </div>
    );
  }
  if (!currentUser || !canAccess) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-[1600px] mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild><Link href="/store"><ArrowLeft className="h-5 w-5" /></Link></Button>
          <div className="flex-1">
            <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
              <Trash2 className="h-8 w-8 text-destructive" /> ตัดของออกจากคลัง (Inventory Write-off)
            </h1>
            <p className="text-muted-foreground text-lg">ใช้สำหรับตัดของเสีย ชำรุด สูญหาย หรือปรับสต็อกออกจากระบบถาวร</p>
          </div>
        </div>

        <Alert className="bg-destructive/5 border-destructive/20 text-destructive shadow-sm">
          <AlertTriangle className="h-5 w-5" />
          <AlertTitle className="font-bold uppercase tracking-wider">คำเตือนการตัดสต็อก (Write-off Warning)</AlertTitle>
          <AlertDescription className="text-sm">
            การตัดของออกต้องระบุเหตุผลและผู้ดำเนินการ ข้อมูลนี้จะถูกบันทึกใน Audit Log และไม่สามารถย้อนคืนได้โดยอัตโนมัติ
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Main Form Area */}
          <div className="lg:col-span-3 space-y-6">
            <Card className="shadow-md">
              <CardHeader className="bg-destructive/5 border-b border-destructive/10">
                <CardTitle className="text-lg flex items-center gap-2 text-destructive">
                  <FileText className="h-5 w-5 text-destructive" /> ข้อมูลการตัดจ่าย (Write-off Context)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label className="font-bold">เลขที่เอกสาร (Write-off No.)</Label>
                  <Input value={writeoffNo} disabled className="h-11 font-mono font-bold text-destructive bg-muted/50" />
                </div>
                <div className="space-y-2">
                  <Label className="font-bold">วันที่ทำรายการ (Date)</Label>
                  <DatePickerThaiBE
                    className="h-11"
                    value={htmlDateValueToTimestampMs(writeoffDate)}
                    onChange={(ms) => setWriteoffDate(timestampToHtmlDateValue(ms))}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="font-bold">เหตุผลการตัดจ่าย (Reason)</Label>
                  <Select onValueChange={setReason} value={reason}>
                    <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DAMAGED">ชำรุด (DAMAGED)</SelectItem>
                      <SelectItem value="EXPIRED">หมดอายุ (EXPIRED)</SelectItem>
                      <SelectItem value="LOST">สูญหาย (LOST)</SelectItem>
                      <SelectItem value="STOCK_ADJUSTMENT">ปรับปรุงยอด (ADJUSTMENT)</SelectItem>
                      <SelectItem value="DISPOSAL">ทำลาย/ทิ้ง (DISPOSAL)</SelectItem>
                      <SelectItem value="OTHER">อื่น ๆ (OTHER)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="font-bold">ผู้ดำเนินการ (Performed By)</Label>
                  <Input value={performedBy} onChange={e => setPerformedBy(e.target.value)} className="h-11" />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label className="font-bold">หมายเหตุ / รายละเอียด (Reason Note)</Label>
                  <Input value={reasonNote} onChange={e => setReasonNote(e.target.value)} placeholder="ระบุสาเหตุอย่างละเอียด..." className="h-11" />
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-md overflow-hidden">
              <CardHeader className="bg-muted/20 border-b flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-lg">รายการอุปกรณ์ (Select Items)</CardTitle>
                  <CardDescription>เลือกอุปกรณ์และระบุจำนวนที่ต้องการตัดออก</CardDescription>
                </div>
                <div className="w-72 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Select onValueChange={handleAddItem}>
                    <SelectTrigger className="h-10 pl-9"><SelectValue placeholder="ค้นหาและเพิ่มอุปกรณ์..." /></SelectTrigger>
                    <SelectContent>
                      {allStoreItems?.filter(i => i.active && i.currentStock > 0).map(i => (
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
                      <TableHead className="font-bold pl-6">อุปกรณ์ (Item)</TableHead>
                      <TableHead className="text-center font-bold">สต็อกปัจจุบัน</TableHead>
                      <TableHead className="text-center font-bold">จำนวนที่ตัดออก</TableHead>
                      <TableHead className="text-center font-bold">ยอดคงเหลือใหม่</TableHead>
                      <TableHead className="text-right pr-6">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((line) => (
                      <TableRow key={line.id} className="hover:bg-destructive/5 transition-colors">
                        <TableCell className="pl-6">
                          <div className="flex flex-col">
                            <span className="font-bold text-sm text-primary">{line.itemName}</span>
                            <span className="text-[10px] font-mono text-muted-foreground">{line.itemCode}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center text-muted-foreground">{line.stockBefore} {line.unit}</TableCell>
                        <TableCell className="text-center">
                          <Input 
                            type="number" 
                            className="w-24 mx-auto text-center h-8 font-black border-destructive/20 focus:border-destructive" 
                            value={line.quantity} 
                            onChange={e => updateLineQuantity(line.id, parseInt(e.target.value) || 0)} 
                          />
                        </TableCell>
                        <TableCell className="text-center font-bold">
                          <span className={line.stockBefore - line.quantity === 0 ? "text-destructive" : "text-primary"}>
                            {line.stockBefore - line.quantity} {line.unit}
                          </span>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleRemoveLine(line.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {lines.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-20 text-center space-y-4">
                          <div className="bg-muted/20 w-16 h-16 rounded-full flex items-center justify-center mx-auto">
                            <Trash className="h-8 w-8 text-muted-foreground/40" />
                          </div>
                          <p className="text-sm text-muted-foreground italic">ยังไม่มีรายการที่เลือก กรุณาค้นหาอุปกรณ์จากช่องด้านบน</p>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar Area */}
          <div className="space-y-6">
            <Card className="border-destructive shadow-lg overflow-hidden">
              <CardHeader className="bg-destructive text-white pb-6">
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5" /> ยืนยันการตัดจ่าย
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">รายการทั้งหมด:</span>
                  <span className="font-bold">{lines.length} รายการ</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">รวมจำนวนชิ้น:</span>
                  <span className="font-bold">{lines.reduce((sum, l) => sum + l.quantity, 0)} ชิ้น</span>
                </div>
                <div className="p-3 bg-destructive/5 rounded border border-destructive/10 text-[10px] text-destructive leading-relaxed font-medium">
                  <AlertCircle className="h-3 w-3 inline mr-1" /> 
                  เมื่อกดยืนยัน จำนวนสินค้าในคลังจะลดลงทันทีเพื่อความถูกต้องของสต็อก ณ ปัจจุบัน
                </div>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button 
                      className="w-full h-14 font-black text-lg bg-destructive hover:bg-destructive/90 shadow-lg" 
                      disabled={lines.length === 0 || isSubmitting}
                    >
                      {isSubmitting ? <Loader2 className="h-6 w-6 animate-spin mr-2" /> : <Trash2 className="h-6 w-6 mr-2" />}
                      ตัดจ่ายสต็อก (Confirm)
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>ยืนยันการตัดของออกจากคลัง?</AlertDialogTitle>
                      <AlertDialogDescription>
                        คุณกำลังจะตัดอุปกรณ์จำนวน {lines.length} รายการ ออกจากระบบเนื่องจากสาเหตุ "{reason}" 
                        รายการนี้จะถูกบันทึกในประวัติถาวรและไม่สามารถย้อนคืนได้โดยอัตโนมัติ
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>ตรวจสอบอีกครั้ง</AlertDialogCancel>
                      <AlertDialogAction onClick={handleConfirmWriteOff} className="bg-destructive text-white">ยืนยันการตัดยอด</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardContent>
            </Card>

            <Card className="bg-muted/30 border-dashed">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold uppercase flex items-center gap-2 text-muted-foreground">
                  <Info className="h-4 w-4" /> แนะนำการใช้งาน
                </CardTitle>
              </CardHeader>
              <CardContent className="text-[10px] text-muted-foreground leading-relaxed space-y-2">
                <p>• <b>DAMAGED:</b> สำหรับของที่พังคาระหว่างการจัดเก็บหรือขนส่ง</p>
                <p>• <b>EXPIRED:</b> สำหรับ PPE ที่หมดอายุ เช่น ไส้กรองหน้ากาก หรือน้ำยาล้างตา</p>
                <p>• <b>STOCK_ADJUSTMENT:</b> สำหรับกรณีที่ยอดในระบบไม่ตรงกับของจริงหลังการตรวจนับ (Stock Count)</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
