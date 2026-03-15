'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { 
  ArrowDownLeft, 
  ArrowLeft, 
  User, 
  Waves, 
  Package, 
  CheckCircle2, 
  AlertCircle, 
  History,
  Loader2,
  Trash2
} from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, doc, query, where, collectionGroup, updateDoc, increment } from 'firebase/firestore';
import { StoreItem, Worker, Assignment, Wave, StoreTransaction, User as AppUser } from '@/lib/types';
import { addDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function ReturnItemsPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const firestore = useFirestore();
  const { toast } = useToast();

  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [selectedAsgnId, setSelectedAsgnId] = useState('');
  const [returnDate, setReturnDate] = useState(new Date().toISOString().split('T')[0]);
  const [returnList, setReturnList] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const workersQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'workers') : null), [firestore]);
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  const asgnQuery = useMemoFirebase(() => {
    if (!firestore || !selectedWorkerId) return null;
    return query(collection(firestore, 'mobilizations'), where('workerId', '==', selectedWorkerId));
  }, [firestore, selectedWorkerId]);
  const { data: assignments } = useCollection<Assignment>(asgnQuery as any);

  const activeAsgn = assignments?.find(a => a.id === selectedAsgnId);

  // Fetch issued items for this assignment
  const transactionsQuery = useMemoFirebase(() => {
    if (!firestore || !selectedAsgnId) return null;
    return query(collection(firestore, 'store_transactions'), where('assignmentId', '==', selectedAsgnId));
  }, [firestore, selectedAsgnId]);
  const { data: transactions } = useCollection<StoreTransaction>(transactionsQuery as any);

  const itemsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'store_items') : null), [firestore]);
  const { data: storeItems } = useCollection<StoreItem>(itemsQuery as any);

  // Calculate net outstanding items
  const outstandingItems = useMemoFirebase(() => {
    if (!transactions || !storeItems) return [];
    const summary: Record<string, number> = {};
    transactions.forEach(tx => {
      if (tx.transactionType === 'ISSUE') summary[tx.itemId] = (summary[tx.itemId] || 0) + tx.quantity;
      if (tx.transactionType === 'RETURN') summary[tx.itemId] = (summary[tx.itemId] || 0) - tx.quantity;
    });
    return Object.entries(summary)
      .filter(([_, qty]) => qty > 0)
      .map(([id, qty]) => ({
        itemId: id,
        itemName: storeItems.find(i => i.id === id)?.itemName || 'Unknown',
        itemCode: storeItems.find(i => i.id === id)?.itemCode || '',
        issuedQty: qty
      }));
  }, [transactions, storeItems]);

  const handleReturn = async () => {
    if (!firestore || !activeAsgn || returnList.length === 0) return;
    setIsSubmitting(true);

    try {
      const returnSlipNo = `RET-${Date.now().toString().slice(-6)}`;
      
      await addDocumentNonBlocking(collection(firestore, 'store_return_slips'), {
        returnNo: returnSlipNo,
        workerId: selectedWorkerId,
        assignmentId: activeAsgn.id,
        waveId: activeAsgn.waveId,
        returnDate,
        status: 'completed',
        createdAt: Date.now(),
        createdBy: currentUser?.displayName || 'System'
      });

      for (const item of returnList) {
        // Update Stock (only if GOOD)
        if (item.condition === 'GOOD') {
          await updateDoc(doc(firestore, 'store_items', item.itemId), { currentStock: increment(item.quantity) });
        }
        
        // Log Transaction
        await addDocumentNonBlocking(collection(firestore, 'store_transactions'), {
          itemId: item.itemId,
          transactionType: item.condition === 'GOOD' ? 'RETURN' : item.condition as any,
          quantity: item.quantity,
          workerId: selectedWorkerId,
          assignmentId: activeAsgn.id,
          waveId: activeAsgn.waveId,
          transactionDate: returnDate,
          notes: `Condition: ${item.condition}`,
          createdAt: Date.now(),
          createdBy: currentUser?.displayName || 'System'
        });
      }

      toast({ title: "บันทึกการรับคืนสำเร็จ", description: `รหัสใบรับคืน: ${returnSlipNo}` });
      router.push('/store');
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถบันทึกข้อมูลได้" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const addToReturnList = (item: any) => {
    if (returnList.some(r => r.itemId === item.itemId)) return;
    setReturnList([...returnList, { ...item, quantity: item.issuedQty, condition: 'GOOD' }]);
  };

  if (!currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild><Link href="/store"><ArrowLeft className="h-5 w-5" /></Link></Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <ArrowDownLeft className="h-6 w-6 text-primary" /> รับคืนอุปกรณ์ (Return Items)
            </h1>
            <p className="text-muted-foreground text-sm">รับคืน PPE และเครื่องมือหลังจบงาน เพื่อตรวจสอบสภาพและคืนสต็อก</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader><CardTitle className="text-lg">ข้อมูลผู้คืน (Recipient Selection)</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>คนงาน (Worker)</Label>
                  <Select onValueChange={setSelectedWorkerId} value={selectedWorkerId}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="เลือกคนงาน..." /></SelectTrigger>
                    <SelectContent>
                      {allWorkers?.map(w => (
                        <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selectedWorkerId && (
                  <div className="space-y-2">
                    <Label>เลือกงาน (Assignment)</Label>
                    <Select onValueChange={setSelectedAsgnId} value={selectedAsgnId}>
                      <SelectTrigger className="h-11"><SelectValue placeholder="เลือกงานที่ต้องส่งคืนของ..." /></SelectTrigger>
                      <SelectContent>
                        {assignments?.map(a => (
                          <SelectItem key={a.id} value={a.id}>{a.projectName} ({a.deploymentStatus})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </CardContent>
            </Card>

            {selectedAsgnId && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Package className="h-5 w-5 text-primary" /> รายการอุปกรณ์ที่ยังไม่คืน (Issued Items)
                  </CardTitle>
                  <CardDescription>รายการที่คุณคนนี้ถือครองอยู่ภายใต้งานนี้</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {outstandingItems.length === 0 ? (
                    <div className="py-10 text-center text-muted-foreground italic border-2 border-dashed rounded-lg">ไม่มีอุปกรณ์ค้างคืน</div>
                  ) : (
                    outstandingItems.map(item => (
                      <div key={item.itemId} className="p-3 border rounded-lg flex items-center justify-between hover:bg-muted/50 cursor-pointer" onClick={() => addToReturnList(item)}>
                        <div>
                          <p className="text-sm font-bold">{item.itemName}</p>
                          <p className="text-[10px] text-muted-foreground">ถือครองอยู่: {item.issuedQty} {item.unit || 'EA'}</p>
                        </div>
                        <Badge className="bg-amber-100 text-amber-700 border-amber-200">ค้างส่งคืน</Badge>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-6">
            <Card className="border-primary shadow-lg">
              <CardHeader className="bg-primary/5 border-b">
                <CardTitle className="text-base flex items-center gap-2"><ArrowDownLeft className="h-5 w-5" /> รายการที่จะคืน</CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                {returnList.length === 0 ? (
                  <div className="py-10 text-center text-muted-foreground italic text-xs">ยังไม่มีรายการที่เลือก</div>
                ) : (
                  <div className="space-y-3">
                    {returnList.map((item, idx) => (
                      <div key={item.itemId} className="space-y-2 p-3 border rounded bg-card">
                        <div className="flex justify-between items-start">
                          <p className="text-xs font-bold">{item.itemName}</p>
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => setReturnList(returnList.filter((_, i) => i !== idx))}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label className="text-[10px]">จำนวนที่คืน</Label>
                            <Input type="number" className="h-7 text-xs" value={item.quantity} onChange={e => {
                              const newList = [...returnList];
                              newList[idx].quantity = parseInt(e.target.value);
                              setReturnList(newList);
                            }} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px]">สภาพของ (Condition)</Label>
                            <Select onValueChange={v => {
                              const newList = [...returnList];
                              newList[idx].condition = v;
                              setReturnList(newList);
                            }} value={item.condition}>
                              <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="GOOD">ปกติ (GOOD)</SelectItem>
                                <SelectItem value="DAMAGED">ชำรุด (DAMAGED)</SelectItem>
                                <SelectItem value="LOST">หาย (LOST)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="space-y-2 pt-4 border-t">
                  <Label>วันที่รับคืน</Label>
                  <Input type="date" value={returnDate} onChange={e => setReturnDate(e.target.value)} />
                </div>
              </CardContent>
              <CardFooter className="bg-muted/30 border-t pt-4">
                <Button className="w-full h-12 font-bold" disabled={returnList.length === 0 || isSubmitting} onClick={handleReturn}>
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                  ยืนยันการรับคืน (Confirm Return)
                </Button>
              </CardFooter>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}