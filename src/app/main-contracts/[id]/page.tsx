'use client';

import { useState, use, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Plus, 
  Trash2, 
  Save, 
  FileText, 
  ShoppingCart, 
  ArrowLeft,
  CircleDollarSign,
  Briefcase,
  Paperclip,
  CheckCircle2,
  Building2,
  ExternalLink
} from 'lucide-react';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog';
import { useFirestore, useDoc, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { doc, collection, query, where } from 'firebase/firestore';
import { updateDocumentNonBlocking, addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { MainContract, PositionRate, PurchaseOrder, Customer, Position, User } from '@/lib/types';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';

export default function MainContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const mcRef = useMemoFirebase(() => (firestore ? doc(firestore, 'main_contracts', id) : null), [firestore, id]);
  const { data: contract, isLoading: isMCLoading } = useDoc<MainContract>(mcRef as any);

  const ratesQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'main_contracts', id, 'position_rates') : null), [firestore, id]);
  const { data: rates } = useCollection<PositionRate>(ratesQuery as any);

  const poQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'purchase_orders'), where('contractId', '==', id));
  }, [firestore, id]);
  const { data: pos } = useCollection<PurchaseOrder>(poQuery as any);

  const customersQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'customers') : null), [firestore]);
  const { data: customers } = useCollection<Customer>(customersQuery as any);

  const positionsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'positions') : null), [firestore]);
  const { data: allPositions } = useCollection<Position>(positionsQuery as any);

  const [isEditing, setIsEditing] = useState(false);
  const [editedMC, setEditedMC] = useState<Partial<MainContract>>({});

  const [isAddRateOpen, setIsAddRateOpen] = useState(false);
  const [newRate, setNewRate] = useState<Partial<PositionRate>>({
    billingUnit: 'daily',
    active: true,
    sellRate: 0,
    costBaseline: 0,
    overtimeRule: '1.5x of Hourly Rate'
  });

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const handleSaveMaster = () => {
    if (!mcRef) return;
    updateDocumentNonBlocking(mcRef, { ...editedMC, updatedAt: Date.now() });
    setIsEditing(false);
    toast({ title: "บันทึกสำเร็จ", description: "ข้อมูลสัญญาหลักถูกอัปเดตแล้ว" });
  };

  const handleAddRate = () => {
    if (!ratesQuery) return;
    addDocumentNonBlocking(ratesQuery, {
      ...newRate,
      positionId: newRate.positionId || '',
      sellRate: Number(newRate.sellRate) || 0,
      costBaseline: Number(newRate.costBaseline) || 0,
      billingUnit: newRate.billingUnit || 'daily',
      active: true,
      notes: newRate.notes || ''
    });
    setIsAddRateOpen(false);
    setNewRate({ billingUnit: 'daily', active: true, sellRate: 0, costBaseline: 0, overtimeRule: '1.5x of Hourly Rate' });
  };

  const deleteRate = (rateId: string) => {
    if (!firestore) return;
    if (confirm('ยืนยันการลบอัตราราคานี้?')) {
      deleteDocumentNonBlocking(doc(firestore, 'main_contracts', id, 'position_rates', rateId));
    }
  };

  if (isMCLoading || !contract || !currentUser) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="animate-pulse text-muted-foreground">กำลังโหลดข้อมูลสัญญาหลัก...</div>
        </div>
      </AppShell>
    );
  }

  const customer = customers?.find(c => c.id === contract.customerId);

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/main-contracts"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{contract.title}</h1>
              <Badge variant="outline" className="font-mono">{contract.contractNumber}</Badge>
              <Badge variant={contract.status === 'active' ? 'default' : 'secondary'}>{contract.status.toUpperCase()}</Badge>
            </div>
            <p className="text-muted-foreground flex items-center gap-2 mt-1">
              <Building2 className="h-4 w-4" /> {customer?.name || 'Loading customer...'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setEditedMC(contract); setIsEditing(!isEditing); }}>
              {isEditing ? 'ยกเลิก' : 'แก้ไขข้อมูลสัญญา'}
            </Button>
            {isEditing && (
              <Button className="gap-2" onClick={handleSaveMaster}>
                <Save className="h-4 w-4" /> บันทึก
              </Button>
            )}
          </div>
        </div>

        <Tabs defaultValue="info" className="w-full">
          <TabsList className="grid grid-cols-4 w-full md:w-fit h-auto p-1 bg-muted/50">
            <TabsTrigger value="info" className="gap-2 py-2 px-6"><FileText className="h-4 w-4" /> ข้อมูลสัญญา</TabsTrigger>
            <TabsTrigger value="rates" className="gap-2 py-2 px-6"><CircleDollarSign className="h-4 w-4" /> อัตราราคา (Rates)</TabsTrigger>
            <TabsTrigger value="pos" className="gap-2 py-2 px-6"><ShoppingCart className="h-4 w-4" /> ใบสั่งซื้อลูกค้า (Customer POs)</TabsTrigger>
            <TabsTrigger value="notes" className="gap-2 py-2 px-6"><Paperclip className="h-4 w-4" /> ไฟล์แนบ / หมายเหตุ</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="mt-6">
            <Card>
              <CardHeader><CardTitle>รายละเอียดสัญญาหลัก (Master Agreement Info)</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>หัวข้อสัญญา (Contract Title)</Label>
                    <Input disabled={!isEditing} value={isEditing ? editedMC.title : contract.title} onChange={e => setEditedMC({...editedMC, title: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>เลขที่สัญญา (Contract No.)</Label>
                    <Input disabled={!isEditing} value={isEditing ? editedMC.contractNumber : contract.contractNumber} onChange={e => setEditedMC({...editedMC, contractNumber: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>ลูกค้า (Customer)</Label>
                    <Select disabled={!isEditing} onValueChange={v => setEditedMC({...editedMC, customerId: v})} value={isEditing ? editedMC.customerId : contract.customerId}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {customers?.map(c => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>รหัสโครงการ (Project ID)</Label>
                    <Input disabled={!isEditing} value={isEditing ? editedMC.projectId : contract.projectId} onChange={e => setEditedMC({...editedMC, projectId: e.target.value})} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>วันที่เริ่มสัญญา</Label>
                      <Input type="date" disabled={!isEditing} value={isEditing ? new Date(editedMC.startDate || 0).toISOString().split('T')[0] : new Date(contract.startDate).toISOString().split('T')[0]} onChange={e => setEditedMC({...editedMC, startDate: new Date(e.target.value).getTime()})} />
                    </div>
                    <div className="space-y-2">
                      <Label>วันที่สิ้นสุดสัญญา</Label>
                      <Input type="date" disabled={!isEditing} value={isEditing ? new Date(editedMC.endDate || 0).toISOString().split('T')[0] : new Date(contract.endDate).toISOString().split('T')[0]} onChange={e => setEditedMC({...editedMC, endDate: new Date(e.target.value).getTime()})} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>สกุลเงิน (Currency)</Label>
                      <Select disabled={!isEditing} onValueChange={v => setEditedMC({...editedMC, currency: v})} value={isEditing ? editedMC.currency : contract.currency}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="THB">THB</SelectItem>
                          <SelectItem value="USD">USD</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>สถานะสัญญา</Label>
                      <Select disabled={!isEditing} onValueChange={v => setEditedMC({...editedMC, status: v as any})} value={isEditing ? editedMC.status : contract.status}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pending">Pending</SelectItem>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="expired">Expired</SelectItem>
                          <SelectItem value="closed">Closed</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>เงื่อนไขการวางบิล (Billing Terms)</Label>
                    <Input disabled={!isEditing} value={isEditing ? editedMC.billingTerms : contract.billingTerms} onChange={e => setEditedMC({...editedMC, billingTerms: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>เงื่อนไขการชำระเงิน (Payment Terms)</Label>
                    <Input disabled={!isEditing} value={isEditing ? editedMC.paymentTerms : contract.paymentTerms} onChange={e => setEditedMC({...editedMC, paymentTerms: e.target.value})} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>หมายเหตุสัญญา</Label>
                  <Textarea disabled={!isEditing} value={isEditing ? editedMC.notes : contract.notes} onChange={e => setEditedMC({...editedMC, notes: e.target.value})} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="rates" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>อัตราราคาตามตำแหน่ง (Position Sell Rates)</CardTitle>
                  <CardDescription>กำหนดราคาขายและฐานต้นทุนสำหรับตำแหน่งงานในสัญญานี้</CardDescription>
                </div>
                <Dialog open={isAddRateOpen} onOpenChange={setIsAddRateOpen}>
                  <DialogTrigger asChild>
                    <Button className="gap-2"><Plus className="h-4 w-4" /> เพิ่มอัตราราคา</Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>กำหนดอัตราราคาใหม่</DialogTitle>
                      <DialogDescription>เลือกตำแหน่งและระบุราคาขายตามเงื่อนไขสัญญา</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid gap-2">
                        <Label>ตำแหน่งงาน (Position)</Label>
                        <Select onValueChange={v => setNewRate({...newRate, positionId: v})} value={newRate.positionId}>
                          <SelectTrigger><SelectValue placeholder="เลือกตำแหน่ง..." /></SelectTrigger>
                          <SelectContent>
                            {allPositions?.map(p => (
                              <SelectItem key={p.id} value={p.id}>{p.positionName}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label>ราคาขาย (Sell Rate)</Label>
                          <Input type="number" value={newRate.sellRate} onChange={e => setNewRate({...newRate, sellRate: parseFloat(e.target.value)})} />
                        </div>
                        <div className="grid gap-2">
                          <Label>ต้นทุนอ้างอิง (Cost Baseline)</Label>
                          <Input type="number" value={newRate.costBaseline} onChange={e => setNewRate({...newRate, costBaseline: parseFloat(e.target.value)})} />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label>หน่วยการคิดเงิน</Label>
                          <Select onValueChange={v => setNewRate({...newRate, billingUnit: v as any})} value={newRate.billingUnit}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="daily">Daily (รายวัน)</SelectItem>
                              <SelectItem value="monthly">Monthly (รายเดือน)</SelectItem>
                              <SelectItem value="hourly">Hourly (รายชั่วโมง)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid gap-2">
                          <Label>กฎการคิดโอที (OT Rule)</Label>
                          <Input value={newRate.overtimeRule} onChange={e => setNewRate({...newRate, overtimeRule: e.target.value})} />
                        </div>
                      </div>
                      <div className="grid gap-2">
                        <Label>หมายเหตุ</Label>
                        <Input value={newRate.notes} onChange={e => setNewRate({...newRate, notes: e.target.value})} />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsAddRateOpen(false)}>ยกเลิก</Button>
                      <Button onClick={handleAddRate} disabled={!newRate.positionId || !newRate.sellRate}>บันทึกอัตราราคา</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ตำแหน่ง</TableHead>
                      <TableHead>ราคาขาย (Sell)</TableHead>
                      <TableHead>ต้นทุน (Cost)</TableHead>
                      <TableHead>หน่วย</TableHead>
                      <TableHead>กฎโอที</TableHead>
                      <TableHead className="text-right">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rates?.map(r => {
                      const pos = allPositions?.find(p => p.id === r.positionId);
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium">{pos?.positionName || r.positionId}</TableCell>
                          <TableCell className="text-green-600 font-bold">฿{r.sellRate.toLocaleString()}</TableCell>
                          <TableCell className="text-muted-foreground">฿{r.costBaseline.toLocaleString()}</TableCell>
                          <TableCell className="capitalize">{r.billingUnit}</TableCell>
                          <TableCell className="text-xs">{r.overtimeRule}</TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deleteRate(r.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {!rates?.length && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-10 text-muted-foreground italic">ยังไม่มีการกำหนดอัตราราคาในสัญญานี้</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="pos" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Customer POs ภายใต้สัญญานี้ (Related POs)</CardTitle>
                  <CardDescription>รายการใบสั่งซื้อลูกค้าที่อ้างอิงสัญญาฉบับนี้</CardDescription>
                </div>
                <Button variant="outline" className="gap-2" onClick={() => router.push('/purchase-orders')}>
                  <Plus className="h-4 w-4" /> สร้าง Customer PO ใหม่
                </Button>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>เลขที่ PO</TableHead>
                      <TableHead>รายละเอียด</TableHead>
                      <TableHead>ระยะเวลา</TableHead>
                      <TableHead>สถานะ</TableHead>
                      <TableHead className="text-right">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pos?.map(po => (
                      <TableRow key={po.id}>
                        <TableCell className="font-mono">{po.poNumber || po.poCode}</TableCell>
                        <TableCell className="font-medium">{po.title}</TableCell>
                        <TableCell className="text-xs">
                          {new Date(po.startDate).toLocaleDateString('th-TH')} - {new Date(po.endDate).toLocaleDateString('th-TH')}
                        </TableCell>
                        <TableCell>
                          <Badge variant={po.status === 'active' ? 'default' : 'secondary'}>{po.status.toUpperCase()}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" className="gap-2" onClick={() => router.push(`/purchase-orders/${po.id}`)}>
                            <ExternalLink className="h-4 w-4" /> ดูรายละเอียด
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!pos?.length && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-10 text-muted-foreground italic">ไม่พบใบสั่งซื้อลูกค้าที่เชื่อมโยง</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notes" className="mt-6">
            <Card>
              <CardHeader><CardTitle>ไฟล์แนบและหมายเหตุเพิ่มเติม</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="p-10 border-2 border-dashed rounded-lg text-center text-muted-foreground">
                  <Paperclip className="h-10 w-10 mx-auto mb-2 opacity-20" />
                  <p>ระบบอัปโหลดไฟล์กำลังอยู่ระหว่างการพัฒนา</p>
                  <p className="text-xs">คุณสามารถใช้ช่องหมายเหตุในแท็บข้อมูลสัญญาเพื่อบันทึกข้อมูลสำคัญชั่วคราว</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}