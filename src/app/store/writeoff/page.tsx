'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Trash2, ArrowLeft, Loader2, CheckCircle2, AlertTriangle, ShieldAlert } from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, doc, updateDoc, increment } from 'firebase/firestore';
import { StoreItem, User } from '@/lib/types';
import { addDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function WriteOffPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const firestore = useFirestore();
  const { toast } = useToast();

  const [selectedItemId, setSelectedItemId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [writeOffDate, setWriteOffDate] = useState(new Date().toISOString().split('T')[0]);
  const [reason, setReason] = useState('DAMAGED');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const itemsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'store_items') : null), [firestore]);
  const { data: items } = useCollection<StoreItem>(itemsQuery as any);

  const selectedItem = items?.find(i => i.id === selectedItemId);

  const handleWriteOff = async () => {
    if (!firestore || !selectedItemId || quantity <= 0) return;
    
    if (selectedItem && selectedItem.currentStock < quantity) {
      toast({ variant: "destructive", title: "สต็อกไม่เพียงพอ", description: "ไม่สามารถตัดจ่ายมากกว่าจำนวนที่มีในคลังได้" });
      return;
    }

    setIsSubmitting(true);

    try {
      // 1. Update master stock
      const itemRef = doc(firestore, 'store_items', selectedItemId);
      await updateDoc(itemRef, { 
        currentStock: increment(-quantity),
        updatedAt: Date.now()
      });

      // 2. Log transaction
      await addDocumentNonBlocking(collection(firestore, 'store_transactions'), {
        itemId: selectedItemId,
        transactionType: 'WRITEOFF',
        quantity,
        transactionDate: writeOffDate,
        notes: `Reason: ${reason}. ${notes}`,
        createdAt: Date.now(),
        createdBy: currentUser?.displayName || 'System'
      });

      toast({ title: "ตัดจ่ายอุปกรณ์สำเร็จ", description: `ตัดยอดจำนวน ${quantity} รายการเรียบร้อยแล้ว` });
      router.push('/store');
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถบันทึกข้อมูลได้" });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild><Link href="/store"><ArrowLeft className="h-5 w-5" /></Link></Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Trash2 className="h-6 w-6 text-red-600" /> ตัดจ่ายอุปกรณ์ออก (Write-off Stock)
            </h1>
            <p className="text-muted-foreground text-sm">ตัดอุปกรณ์ออกจากคลังเนื่องจาก ชำรุด, สูญหาย หรือหมดอายุ</p>
          </div>
        </div>

        <Card className="shadow-lg border-none">
          <CardHeader className="bg-destructive/5 border-b">
            <CardTitle>แบบฟอร์มตัดของออก (Write-off Form)</CardTitle>
            <CardDescription>ระบุรายการที่ต้องการลดสต็อกถาวร</CardDescription>
          </CardHeader>
          <CardContent className="pt-6 space-y-4">
            <div className="space-y-2">
              <Label>เลือกอุปกรณ์ (Select Item)</Label>
              <Select onValueChange={setSelectedItemId} value={selectedItemId}>
                <SelectTrigger className="h-11"><SelectValue placeholder="ค้นหาอุปกรณ์ในระบบ..." /></SelectTrigger>
                <SelectContent>
                  {items?.filter(i => i.active && i.currentStock > 0).map(i => (
                    <SelectItem key={i.id} value={i.id}>{i.itemCode} | {i.itemName} (Available: {i.currentStock})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>จำนวนที่ตัดจ่าย (Quantity)</Label>
                <Input type="number" min="1" max={selectedItem?.currentStock || 1} value={quantity} onChange={e => setQuantity(parseInt(e.target.value))} className="h-11" />
              </div>
              <div className="space-y-2">
                <Label>สาเหตุ (Reason)</Label>
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
            </div>

            <div className="space-y-2">
              <Label>วันที่ทำรายการ (Date)</Label>
              <Input type="date" value={writeOffDate} onChange={e => setWriteOffDate(e.target.value)} className="h-11" />
            </div>

            <div className="space-y-2">
              <Label>หมายเหตุเพิ่มเติม (Notes)</Label>
              <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="ระบุรายละเอียดเพิ่มเติม..." className="h-11" />
            </div>

            <Alert className="bg-amber-50 border-amber-200">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <AlertTitle className="text-xs font-bold text-amber-800 uppercase">Stock Adjustment Warning</AlertTitle>
              <AlertDescription className="text-[10px] text-amber-700">
                การตัดจ่ายจะลดจำนวนสต็อกคงเหลือทันทีและไม่สามารถย้อนคืนได้โดยอัตโนมัติ กรุณาตรวจสอบข้อมูลให้ถูกต้อง
              </AlertDescription>
            </Alert>
          </CardContent>
          <CardFooter className="bg-muted/20 pt-6">
            <Button variant="destructive" className="w-full h-12 font-bold text-lg" disabled={!selectedItemId || quantity <= 0 || isSubmitting} onClick={handleWriteOff}>
              {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <CheckCircle2 className="h-5 w-5 mr-2" />}
              ยืนยันการตัดยอดออก (Confirm Write-off)
            </Button>
          </CardFooter>
        </Card>
      </div>
    </AppShell>
  );
}
