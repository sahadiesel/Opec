'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import {
  ArrowLeft,
  PackagePlus,
  Users,
  History,
  CheckCircle2,
  Trash2,
  Info,
  AlertTriangle,
  Loader2,
  PackageCheck,
  CheckCircle,
} from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccessDomain } from '@/lib/permission-core';
import { collection, doc, query, where, writeBatch, increment } from 'firebase/firestore';
import { StoreItem, Worker, Assignment, StoreTransaction, OfficeStaff } from '@/lib/types';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { generateNextDocumentCode } from '@/lib/services/numbering-service';
import { netCustodyQuantityDelta } from '@/lib/store/store-custody-net';

export default function StoreReturnPage() {
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const canAccess = canAccessDomain(currentUser, 'store');

  const [returnMode, setReturnMode] = useState<'field' | 'office'>('field');
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [selectedAsgnId, setSelectedAsgnId] = useState('');
  const [selectedOfficeStaffId, setSelectedOfficeStaffId] = useState('');
  const [returnDate, setReturnDate] = useState(() => timestampToHtmlDateValue(Date.now()));
  const [notes, setNotes] = useState('');
  const [returnList, setReturnList] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const m = new URLSearchParams(window.location.search).get('mode');
    if (m === 'office') setReturnMode('office');
  }, []);

  const onReturnModeChange = (v: string) => {
    const next = v as 'field' | 'office';
    setReturnMode(next);
    setSelectedWorkerId('');
    setSelectedAsgnId('');
    setSelectedOfficeStaffId('');
    setReturnList([]);
  };

  // Data Queries — gate by store access
  const workersQuery = useMemoFirebase(() => {
    if (!firestore || userLoading || isUserLoading || !firebaseUser || !canAccess) return null;
    return collection(firestore, 'workers');
  }, [firestore, userLoading, isUserLoading, firebaseUser, canAccess]);
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  const asgnQuery = useMemoFirebase(() => {
    if (!firestore || !canAccess || !selectedWorkerId) return null;
    return query(collection(firestore, 'mobilizations'), where('workerId', '==', selectedWorkerId));
  }, [firestore, canAccess, selectedWorkerId]);
  const { data: assignments } = useCollection<Assignment>(asgnQuery as any);

  const activeAsgn = assignments?.find((a) => a.id === selectedAsgnId);

  const officeStaffQuery = useMemoFirebase(() => {
    if (!firestore || userLoading || isUserLoading || !firebaseUser || !canAccess) return null;
    return collection(firestore, 'office_staff');
  }, [firestore, userLoading, isUserLoading, firebaseUser, canAccess]);
  const { data: officeStaffList } = useCollection<OfficeStaff>(officeStaffQuery as any);

  const fieldTxQuery = useMemoFirebase(() => {
    if (!firestore || !canAccess || returnMode !== 'field' || !selectedAsgnId) return null;
    return query(collection(firestore, 'store_transactions'), where('assignmentId', '==', selectedAsgnId));
  }, [firestore, canAccess, returnMode, selectedAsgnId]);

  const officeTxQuery = useMemoFirebase(() => {
    if (!firestore || !canAccess || returnMode !== 'office' || !selectedOfficeStaffId) return null;
    return query(collection(firestore, 'store_transactions'), where('officeStaffId', '==', selectedOfficeStaffId));
  }, [firestore, canAccess, returnMode, selectedOfficeStaffId]);

  const { data: fieldTransactions } = useCollection<StoreTransaction>(fieldTxQuery as any);
  const { data: officeTransactions } = useCollection<StoreTransaction>(officeTxQuery as any);

  const transactions = returnMode === 'field' ? fieldTransactions : officeTransactions;

  const itemsQuery = useMemoFirebase(() => (firestore && canAccess ? collection(firestore, 'store_items') : null), [firestore, canAccess]);
  const { data: allStoreItems } = useCollection<StoreItem>(itemsQuery as any);

  // Calculate Net Outstanding per Item
  const outstandingItems = useMemo(() => {
    if (!transactions || !allStoreItems) return [];

    const balance: Record<string, number> = {};
    transactions.forEach((tx) => {
      const d = netCustodyQuantityDelta(tx);
      if (!d) return;
      balance[tx.itemId] = (balance[tx.itemId] || 0) + d;
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
    if (!firestore || !currentUser || returnList.length === 0) {
      toast({ variant: 'destructive', title: 'ข้อมูลไม่ครบ', description: 'กรุณาระบุรายการที่ต้องการคืน' });
      return;
    }
    if (returnMode === 'field' && !activeAsgn) {
      toast({
        variant: 'destructive',
        title: 'ข้อมูลไม่ครบ',
        description: 'กรุณาเลือกคนงานและงาน (mobilization) สำหรับรับคืน',
      });
      return;
    }
    if (returnMode === 'office' && !selectedOfficeStaffId) {
      toast({
        variant: 'destructive',
        title: 'ข้อมูลไม่ครบ',
        description: 'กรุณาเลือกพนักงานออฟฟิศผู้คืนของ',
      });
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
      // Atomic Sequence Generation
      const { code: finalNo } = await generateNextDocumentCode(firestore, 'store_return', { actor: currentUser.displayName });

      const batch = writeBatch(firestore);
      const returnSlipsRef = collection(firestore, 'store_return_slips');
      const newReturnRef = doc(returnSlipsRef);

      const officeStaff =
        returnMode === 'office'
          ? officeStaffList?.find((s) => s.id === selectedOfficeStaffId)
          : undefined;

      // 1. Create Return Slip Header
      batch.set(newReturnRef, {
        id: newReturnRef.id,
        returnNo: finalNo,
        returnType: returnMode,
        returnDate,
        notes,
        createdAt: Date.now(),
        createdBy: currentUser.displayName,
        ...(returnMode === 'field' && activeAsgn
          ? {
              workerId: selectedWorkerId,
              assignmentId: activeAsgn.id,
              waveId: activeAsgn.waveId ?? '',
              officeStaffId: '',
              officeStaffName: '',
            }
          : {
              workerId: '',
              assignmentId: '',
              waveId: '',
              officeStaffId: selectedOfficeStaffId,
              officeStaffName: officeStaff?.fullName || '',
            }),
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
          transactionDate: returnDate,
          notes: `Ref Return: ${finalNo}. Condition: ${item.condition}. ${item.remarks}`,
          createdAt: Date.now(),
          createdBy: currentUser.displayName,
          issueType: returnMode,
          ...(returnMode === 'field' && activeAsgn
            ? {
                workerId: selectedWorkerId,
                assignmentId: activeAsgn.id,
                waveId: activeAsgn.waveId ?? '',
                officeStaffId: '',
              }
            : {
                workerId: '',
                assignmentId: '',
                waveId: '',
                officeStaffId: selectedOfficeStaffId,
              }),
        });
      }

      await batch.commit();

      toast({ title: "บันทึกการคืนสำเร็จ", description: `เลขที่ใบรับคืน: ${finalNo}` });
      router.push('/store');
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถบันทึกรายการได้" });
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
              <PackageCheck className="h-8 w-8 text-green-600" /> รับคืนอุปกรณ์ / เครื่องมือ (Return to Store)
            </h1>
            <p className="text-muted-foreground text-lg">
              โหมดลูกจ้างหน้างาน: คืนตาม mobilization และประวัติเบิกของงานนั้น — โหมดพนักงานออฟฟิศ: คืนตามประวัติเบิกของผู้รับออฟฟิศ (ไม่ผูกงาน)
            </p>
          </div>
        </div>

        <Tabs value={returnMode} onValueChange={onReturnModeChange} className="w-full">
          <TabsList className="grid w-full max-w-lg grid-cols-2 h-auto p-1">
            <TabsTrigger value="field" className="py-3">
              ลูกจ้างหน้างาน (Field)
            </TabsTrigger>
            <TabsTrigger value="office" className="py-3">
              พนักงานออฟฟิศ (Office)
            </TabsTrigger>
          </TabsList>
        </Tabs>

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
                  <Users className="h-5 w-5 text-primary" />{' '}
                  {returnMode === 'field' ? 'เลือกพนักงานและงาน (Recipient & Job)' : 'เลือกพนักงานออฟฟิศ (Office Staff)'}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                {returnMode === 'field' ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="font-bold">เลือกคนงาน (Select Worker)</Label>
                      <Select
                        onValueChange={(v) => {
                          setSelectedWorkerId(v);
                          setSelectedAsgnId('');
                          setReturnList([]);
                        }}
                        value={selectedWorkerId}
                      >
                        <SelectTrigger className="h-11">
                          <SelectValue placeholder="ค้นหาคนงาน..." />
                        </SelectTrigger>
                        <SelectContent>
                          {allWorkers?.map((w) => (
                            <SelectItem key={w.id} value={w.id}>
                              {w.firstName} {w.lastName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label className="font-bold">เลือกงาน (Select Assignment)</Label>
                      <Select
                        onValueChange={(v) => {
                          setSelectedAsgnId(v);
                          setReturnList([]);
                        }}
                        value={selectedAsgnId}
                        disabled={!selectedWorkerId}
                      >
                        <SelectTrigger className="h-11">
                          <SelectValue placeholder="เลือกงานเพื่อดูอุปกรณ์ค้างคืน..." />
                        </SelectTrigger>
                        <SelectContent>
                          {assignments?.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.projectName} ({a.deploymentStatus})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 max-w-md">
                    <Label className="font-bold">เลือกพนักงานออฟฟิศ (Office Staff)</Label>
                    <Select
                      onValueChange={(v) => {
                        setSelectedOfficeStaffId(v);
                        setReturnList([]);
                      }}
                      value={selectedOfficeStaffId}
                    >
                      <SelectTrigger className="h-11">
                        <SelectValue placeholder="เลือกพนักงานออฟฟิศ..." />
                      </SelectTrigger>
                      <SelectContent>
                        {(officeStaffList ?? [])
                          .slice()
                          .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || '', 'th'))
                          .map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.fullName || s.id}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      แสดงยอดค้างคืนจากประวัติ ISSUE ของพนักงานออฟฟิศเทียบ RETURN / DAMAGED / LOST — สอดคล้องการเบิกโหมด Office
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {((returnMode === 'field' && selectedAsgnId) || (returnMode === 'office' && selectedOfficeStaffId)) && (
              <Card className="shadow-md overflow-hidden">
                <CardHeader className="border-b bg-muted/20">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <History className="h-5 w-5 text-primary" /> รายการอุปกรณ์ที่ยังไม่คืน (Outstanding Items)
                  </CardTitle>
                  <CardDescription>
                    {returnMode === 'field'
                      ? 'แสดงเฉพาะอุปกรณ์ที่พนักงานรายนี้ยังถือครองอยู่ภายใต้งานที่เลือก'
                      : 'แสดงอุปกรณ์ที่พนักงานออฟฟิศรายนี้ยังถือครองจากการเบิกยืม (โหมด Office)'}
                  </CardDescription>
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
                    <DatePickerThaiBE
                      className="h-11"
                      value={htmlDateValueToTimestampMs(returnDate)}
                      onChange={(ms) => setReturnDate(timestampToHtmlDateValue(ms))}
                    />
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
