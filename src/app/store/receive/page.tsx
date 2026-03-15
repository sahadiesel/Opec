'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Plus, ArrowLeft, Loader2, CheckCircle2, Package, PackagePlus } from 'lucide-react';
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

export default function ReceiveStockPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const firestore = useFirestore();
  const { toast } = useToast();

  const [selectedItemId, setSelectedItemId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [receiveDate, setReceiveDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const itemsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'store_items') : null), [firestore]);
  const { data: items } = useCollection<StoreItem>(itemsQuery as any);

  const handleReceive = async () => {
    if (!firestore || !selectedItemId || quantity <= 0) return;
    setIsSubmitting(true);

    try {
      // 1. Update master stock
      const itemRef = doc(firestore, 'store_items', selectedItemId);
      await updateDoc(itemRef, { 
        currentStock: increment(quantity),
        updatedAt: Date.now()
      });

      // 2. Log transaction
      await addDocumentNonBlocking(collection(firestore, 'store_transactions'), {
        itemId: selectedItemId,
        transactionType: 'RECEIVE',
        quantity,
        transactionDate: receiveDate,
        notes,
        createdAt: Date.now(),
        createdBy: currentUser?.displayName || 'System'
      });

      toast({ title: "รับของเข้าคลังสำเร็จ", description: `เพิ่มจำนวน ${quantity} รายการเรียบร้อยแล้ว` });
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
              <PackagePlus className="h-6 w-6 text-primary" /> รับของเข้าคลัง (Receive Stock)
            </h1>
            <p className="text-muted-foreground text-sm">เพิ่มสต็อกอุปกรณ์ใหม่เข้าระบบคลังสินค้า</p>
          </div>
        </div>

        <Card className="shadow-lg border-none">
          <CardHeader className="bg-primary/5 border-b">
            <CardTitle>แบบฟอร์มรับของเข้า (Intake Form)</CardTitle>
            <CardDescription>ระบุรายการและจำนวนที่ได้รับจริงเพื่อเพิ่มสต็อก</CardDescription>
          </CardHeader>
          <CardContent className="pt-6 space-y-4">
            <div className="space-y-2">
              <Label>เลือกอุปกรณ์ (Select Item)</Label>
              <Select onValueChange={setSelectedItemId} value={selectedItemId}>
                <SelectTrigger className="h-11"><SelectValue placeholder="ค้นหาอุปกรณ์ในระบบ..." /></SelectTrigger>
                <SelectContent>
                  {items?.filter(i => i.active).map(i => (
                    <SelectItem key={i.id} value={i.id}>{i.itemCode} | {i.itemName} (Stock: {i.currentStock})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>จำนวนที่รับ (Quantity)</Label>
                <Input type="number" min="1" value={quantity} onChange={e => setQuantity(parseInt(e.target.value))} className="h-11" />
              </div>
              <div className="space-y-2">
                <Label>วันที่รับของ (Date)</Label>
                <Input type="date" value={receiveDate} onChange={e => setReceiveDate(e.target.value)} className="h-11" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>หมายเหตุ (Notes)</Label>
              <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="เช่น รับจาก Supplier X, ใบส่งของเลขที่..." className="h-11" />
            </div>
          </CardContent>
          <CardFooter className="bg-muted/20 pt-6">
            <Button className="w-full h-12 font-bold text-lg bg-primary" disabled={!selectedItemId || quantity <= 0 || isSubmitting} onClick={handleReceive}>
              {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <CheckCircle2 className="h-5 w-5 mr-2" />}
              ยืนยันการรับเข้า (Confirm Intake)
            </Button>
          </CardFooter>
        </Card>
      </div>
    </AppShell>
  );
}
