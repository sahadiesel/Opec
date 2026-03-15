'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { 
  ArrowLeft, 
  PackagePlus, 
  Users, 
  Briefcase, 
  Waves, 
  History, 
  CheckCircle2, 
  Trash2, 
  Info, 
  AlertTriangle,
  Loader2,
  PackageCheck,
  Search,
  CheckCircle
} from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, doc, query, where, writeBatch, increment } from 'firebase/firestore';
import { StoreItem, Worker, Assignment, Wave, StoreTransaction, User as AppUser, Position } from '@/lib/types';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function StoreReturnPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const firestore = useFirestore();
  const { toast } = useToast();

  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [selectedAsgnId, setSelectedAsgnId] = useState('');
  const [returnDate, setReturnDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [returnList, setReturnList] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  // Data Queries
  const workersQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'workers') : null), [firestore]);
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  const asgnQuery = useMemoFirebase(() => {
    if (!firestore || !selectedWorkerId) return null;
    return query(collection(firestore, 'mobilizations'), where('workerId', '==', selectedWorkerId));
  }, [firestore, selectedWorkerId]);
  const { data: assignments } = useCollection<Assignment>(asgnQuery as any);

  const activeAsgn = assignments?.find(a => a.id === selectedAsgnId);

  // Fetch all transactions for this assignment to calculate net outstanding
  const txQuery = useMemoFirebase(() => {
    if (!firestore || !selectedAsgnId) return null;
    return query(collection(firestore, 'store_transactions'), where('assignmentId', '==', selectedAsgnId));
  }, [firestore, selectedAsgnId]);
  const { data: transactions } = useCollection<StoreTransaction>(txQuery as any);

  const itemsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'store_items') : null), [firestore]);
  const { data: allStoreItems } = useCollection<StoreItem>(itemsQuery as any);

  // Calculate Net Outstanding per Item
  const outstandingItems = useMemo(() => {
    if (!transactions || !allStoreItems) return [];
    
    const balance: Record<string, number> = {};
    transactions.forEach(tx => {
      if (tx.transactionType === 'ISSUE') balance[tx.itemId] = (balance[tx.itemId] || 0) + tx.quantity;
      if (['RETURN', 'DAMAGED', 'LOST'].includes(tx.transactionType)) {
        balance[tx.itemId] = (balance[tx.itemId] || 0) - tx.quantity;
      }
    });

    return Object.entries(balance)
      .filter(([_, qty]) => qty > 0)
      .map(([itemId, qty]) => {
        const item = allStoreItems.find(i => i.id === itemId);
        return {
          itemId,
          itemCode: item?.itemCode || 'N/A',
          itemName: item?.itemName || 'Unknown Item',
          unit: item?.unit || 'EA',
          issuedQty: qty
        };
      });
  }, [transactions, allStoreItems]);

  const handleAddToReturn = (item: any) => {
    if (returnList.some(r => r.itemId === item.itemId)) return;
    setReturnList([...returnList, { 
      ...item, 
      quantity: item.issuedQty, 
      condition: 'GOOD',
      remarks: '' 
    }]);
  };

  const handleConfirmReturn = async () => {
    if (!firestore || !activeAsgn || !currentUser || returnList.length === 0) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาระบุรายการที่ต้องการคืน" });
      return;
    }

    // Validate quantities
    for (const ret of returnList) {
      if (ret.quantity <= 0 || ret.quantity > ret.issuedQty) {
        toast({ variant: "destructive", title: "จำนวนไม่ถูกต้อง", description: `รายการ ${ret.itemName} ระบุจำนวนคืนเกินกว่าที่เคยเบิก` });
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const batch = writeBatch(firestore);
      const returnSlipsRef = collection(firestore, 'store_return_slips');
      const newReturnRef = doc(returnSlipsRef);
      const returnNo = `RET-${Date.now().toString().slice(-6)}`;

      // 1. Create Return Slip Header
      batch.set(newReturnRef, {
        id: newReturnRef.id,
        returnNo,
        workerId: selectedWorkerId,
        assignmentId: activeAsgn.id,
        waveId: activeAsgn.waveId,
        returnDate,
        notes,
        createdAt: Date.now(),
        createdBy: currentUser.displayName
      });

      // 2. Process Items
      const itemsSubRef = collection(newReturnRef, 'items');
      for (const item of returnList) {
        const itemLineRef = doc(itemsSubRef);
        batch.set(itemLineRef, {
          itemId: item.itemId,
          itemName: item.itemName,
          quantity: item.quantity,
          condition: item.condition,
          remarks: item.remarks
        });

        // Update Master Stock (ONLY if condition is GOOD)
        if (item.condition === 'GOOD') {
          const masterItemRef = doc(firestore, 'store_items', item.itemId);
          batch.update(masterItemRef, { currentStock: increment(item.quantity) });
        }

        // Log Transaction
        const txRef = doc(collection(firestore, 'store_transactions'));
        batch.set(txRef, {
          itemId: item.itemId,
          transactionType: item.condition === 'GOOD' ? 'RETURN' : item.condition,
          quantity: item.quantity,
          workerId: selectedWorkerId,
          assignmentId: activeAsgn.id,
          waveId: activeAsgn.waveId,
          transactionDate: returnDate,
          notes: `Ref Return: ${returnNo}. Condition: ${item.condition}. ${item.remarks}`,
          createdAt: Date.now(),
          createdBy: currentUser.displayName
        });
      }

      await batch.commit();

      toast({ title: "บันทึกการคืนสำเร็จ", description: `เลขที่ใบรับคืน: ${returnNo}` });
      router.push('/store');
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถบันทึกรายการได้" });
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
              <PackageCheck className="h-8 w-8 text-green-600" /> คืนของจากลูกจ้าง (Return from Worker)
            </h1>
            <p className="text-muted-foreground text-lg">ใช้สำหรับคืน PPE หรือเครื่องมือจากลูกจ้างกลับเข้าคลัง โดยอ้างอิงจากประวัติการเบิก</p>
          </div>
        </div>

        <Alert className="bg-primary/5 border-primary/20 shadow-sm">
          <Info className="h-5 w-5 text-primary" />
          <AlertTitle className="font-bold">นโยบายการรับคืน (Return Policy)</AlertTitle>
          <AlertDescription className="text-sm">
            อุปกรณ์ที่คืนในสภาพ <b>GOOD</b> จะถูกนำกลับเข้าสต็อกโดยอัตโนมัติ ส่วนที่ชำรุด (DAMAGED) หรือสูญหาย (LOST) จะถูกตัดออกจากระบบถาวร
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* LEFT: Context & Outstanding List */}
          <div className="lg:col-span-2 space-y-6">
            <Card className="shadow-md">
              <CardHeader className="border-b bg-muted/20">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Users className="h-5 w-5 text-primary" /> เลือกพนักงานและงาน (Recipient & Job)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="font-bold">เลือกคนงาน (Select Worker)</Label>
                    <Select onValueChange={setSelectedWorkerId} value={selectedWorkerId}>
                      <SelectTrigger className="h-11"><SelectValue placeholder="ค้นหาคนงาน..." /></SelectTrigger>
                      <SelectContent>
                        {allWorkers?.map(w => (
                          <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="font-bold">เลือกงาน (Select Assignment)</Label>
                    <Select onValueChange={setSelectedAsgnId} value={selectedAsgnId} disabled={!selectedWorkerId}>
                      <SelectTrigger className="h-11"><SelectValue placeholder="เลือกงานเพื่อดูอุปกรณ์ค้างคืน..." /></SelectTrigger>
                      <SelectContent>
                        {assignments?.map(a => (
                          <SelectItem key={a.id} value={a.id}>{a.projectName} ({a.deploymentStatus})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {selectedAsgnId && (
              <Card className="shadow-md overflow-hidden">
                <CardHeader className="border-b bg-muted/20">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <History className="h-5 w-5 text-primary" /> รายการอุปกรณ์ที่ยังไม่คืน (Outstanding Items)
                  </CardTitle>
                  <CardDescription>แสดงเฉพาะอุปกรณ์ที่พนักงานรายนี้ยังถือครองอยู่ภายใต้งานที่เลือก</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  {outstandingItems.length === 0 ? (
                    <div className="py-20 text-center space-y-4">
                      <CheckCircle className="h-12 w-12 mx-auto text-green-500/30" />
                      <p className="text-muted-foreground italic">ไม่มีอุปกรณ์ค้างคืนสำหรับงานนี้</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader className="bg-muted/50">
                        <TableRow>
                          <TableHead className="font-bold">รหัส</TableHead>
                          <TableHead className="font-bold">ชื่ออุปกรณ์</TableHead>
                          <TableHead className="text-center font-bold">ค้างส่งคืน</TableHead>
                          <TableHead className="text-right pr-6">จัดการ</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {outstandingItems.map(item => (
                          <TableRow key={item.itemId} className="hover:bg-muted/30">
                            <TableCell className="font-mono text-xs font-bold text-primary">{item.itemCode}</TableCell>
                            <TableCell className="font-bold text-sm text-primary">{item.itemName}</TableCell>
                            <TableCell className="text-center">
                              <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">
                                {item.issuedQty} {item.unit}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right pr-6">
                              <Button 
                                size="sm" 
                                variant="outline"
                                className="h-8 gap-1 border-primary text-primary hover:bg-primary hover:text-white"
                                onClick={() => handleAddToReturn(item)}
                              >
                                <PackagePlus className="h-3.5 w-3.5" /> เลือกคืน
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* RIGHT: Return Summary */}
          <div className="space-y-6">
            <Card className="border-primary shadow-xl overflow-hidden">
              <CardHeader className="bg-primary text-primary-foreground pb-6">
                <CardTitle className="text-xl flex items-center gap-3">
                  <CheckCircle2 className="h-6 w-6" /> รายการเตรียมคืน (Return List)
                </CardTitle>
                <CardDescription className="text-primary-foreground/70">ตรวจสอบสภาพและจำนวนก่อนยืนยันรับคืน</CardDescription>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                {returnList.length === 0 ? (
                  <div className="py-20 text-center space-y-4 bg-muted/10 rounded-lg border-2 border-dashed border-muted">
                    <PackagePlus className="h-12 w-12 mx-auto text-muted-foreground/30" />
                    <p className="text-sm text-muted-foreground">ยังไม่มีรายการที่เลือกคืน</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {returnList.map((item, idx) => (
                      <div key={item.itemId} className="p-3 border rounded-lg bg-card shadow-sm group">
                        <div className="flex justify-between items-start mb-2">
                          <p className="text-xs font-black text-primary truncate flex-1">{item.itemName}</p>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-6 w-6 text-destructive"
                            onClick={() => setReturnList(returnList.filter((_, i) => i !== idx))}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-[10px] uppercase font-bold text-muted-foreground">จำนวนที่คืน (Return)</Label>
                            <Input 
                              type="number" 
                              className="h-8 text-xs font-bold" 
                              value={item.quantity}
                              onChange={e => {
                                const newList = [...returnList];
                                newList[idx].quantity = Math.min(item.issuedQty, Math.max(1, parseInt(e.target.value) || 1));
                                setReturnList(newList);
                              }}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] uppercase font-bold text-muted-foreground">สภาพ (Condition)</Label>
                            <Select 
                              onValueChange={v => {
                                const newList = [...returnList];
                                newList[idx].condition = v;
                                setReturnList(newList);
                              }} 
                              value={item.condition}
                            >
                              <SelectTrigger className="h-8 text-[10px] font-bold"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="GOOD">ปกติ (GOOD)</SelectItem>
                                <SelectItem value="DAMAGED">ชำรุด (DAMAGED)</SelectItem>
                                <SelectItem value="LOST">สูญหาย (LOST)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        
                        {item.condition !== 'GOOD' && (
                          <div className="mt-2 p-2 bg-destructive/5 rounded border border-destructive/10 text-[9px] text-destructive flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" /> สต็อกจะไม่เพิ่มขึ้นสำหรับรายการนี้
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="pt-4 space-y-4 border-t">
                  <div className="space-y-2">
                    <Label className="font-bold text-xs uppercase text-muted-foreground">วันที่รับคืน (Return Date)</Label>
                    <Input type="date" value={returnDate} onChange={e => setReturnDate(e.target.value)} className="h-11" />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold text-xs uppercase text-muted-foreground">หมายเหตุ (Notes)</Label>
                    <Input 
                      placeholder="เช่น คืนหลังจบโปรเจกต์..." 
                      value={notes} 
                      onChange={e => setNotes(e.target.value)}
                      className="h-11"
                    />
                  </div>
                </div>
              </CardContent>
              <CardFooter className="bg-muted/30 border-t pt-6 flex flex-col gap-3">
                <Button 
                  className="w-full h-14 font-black text-lg bg-primary shadow-lg" 
                  disabled={returnList.length === 0 || isSubmitting}
                  onClick={handleConfirmReturn}
                >
                  {isSubmitting ? <Loader2 className="h-6 w-6 animate-spin mr-2" /> : <PackageCheck className="h-6 w-6 mr-2" />}
                  ยืนยันการรับคืน (Finalize Return)
                </Button>
              </CardFooter>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function StatCard({ title, value, sub, icon: Icon, colorClass }: any) {
  return (
    <Card className={`hover:shadow-md transition-all border-l-8 ${colorClass} shadow-sm`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 opacity-50 text-primary" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-black text-primary">{value}</div>
        <p className="text-[10px] font-medium text-muted-foreground mt-1">{sub}</p>
      </CardContent>
    </Card>
  );
}
