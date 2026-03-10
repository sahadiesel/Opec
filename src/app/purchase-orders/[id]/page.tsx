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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Plus, 
  Trash2, 
  Save, 
  ShoppingCart, 
  ArrowLeft,
  FileText,
  Building2,
  Briefcase,
  Users
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
import { PurchaseOrder, POLine, Customer, MainContract, Position, PositionRate, User } from '@/lib/types';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';

export default function PODetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const poRef = useMemoFirebase(() => (firestore ? doc(firestore, 'purchase_orders', id) : null), [firestore, id]);
  const { data: po, isLoading: isPOLoading } = useDoc<PurchaseOrder>(poRef as any);

  const poLinesQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'purchase_orders', id, 'po_lines') : null), [firestore, id]);
  const { data: poLines } = useCollection<POLine>(poLinesQuery as any);

  const customersQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'customers') : null), [firestore]);
  const { data: customers } = useCollection<Customer>(customersQuery as any);

  const contractRef = useMemoFirebase(() => (firestore && po?.contractId ? doc(firestore, 'main_contracts', po.contractId) : null), [firestore, po?.contractId]);
  const { data: contract } = useDoc<MainContract>(contractRef as any);

  const ratesQuery = useMemoFirebase(() => (firestore && po?.contractId ? collection(firestore, 'main_contracts', po.contractId, 'position_rates') : null), [firestore, po?.contractId]);
  const { data: rates } = useCollection<PositionRate>(ratesQuery as any);

  const positionsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'positions') : null), [firestore]);
  const { data: allPositions } = useCollection<Position>(positionsQuery as any);

  const [isEditing, setIsEditing] = useState(false);
  const [editedPO, setEditedPO] = useState<Partial<PurchaseOrder>>({});

  const [isAddLineOpen, setIsAddLineOpen] = useState(false);
  const [newLine, setNewLine] = useState<Partial<POLine>>({ quantity: 1 });

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const handleSaveMaster = () => {
    if (!poRef) return;
    updateDocumentNonBlocking(poRef, { ...editedPO, updatedAt: Date.now() });
    setIsEditing(false);
    toast({ title: "บันทึกสำเร็จ", description: "ข้อมูลใบสั่งซื้อถูกอัปเดตแล้ว" });
  };

  const handleAddLine = () => {
    if (!poLinesQuery || !newLine.positionId) return;
    
    const rate = rates?.find(r => r.positionId === newLine.positionId);
    if (!rate) {
      toast({ variant: "destructive", title: "Error", description: "ไม่พบอัตราราคาสำหรับตำแหน่งนี้ในสัญญาที่เลือก" });
      return;
    }

    addDocumentNonBlocking(poLinesQuery, {
      poId: id,
      positionId: newLine.positionId,
      quantity: Number(newLine.quantity) || 1,
      sellRateSnapshot: rate.sellRate,
      costBaselineSnapshot: rate.costBaseline,
      billingUnitSnapshot: rate.billingUnit,
      overtimeRuleSnapshot: rate.overtimeRule
    });
    
    setIsAddLineOpen(false);
    setNewLine({ quantity: 1 });
    toast({ title: "เพิ่มรายการ PO Line สำเร็จ" });
  };

  const deleteLine = (lineId: string) => {
    if (!firestore) return;
    if (confirm('ยืนยันการลบรายการนี้?')) {
      deleteDocumentNonBlocking(doc(firestore, 'purchase_orders', id, 'po_lines', lineId));
    }
  };

  if (isPOLoading || !po || !currentUser) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="animate-pulse text-muted-foreground">กำลังโหลดข้อมูลใบสั่งซื้อ...</div>
        </div>
      </AppShell>
    );
  }

  const customer = customers?.find(c => c.id === po.customerId);

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/purchase-orders"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{po.title}</h1>
              <Badge variant="outline" className="font-mono">{po.poNumber}</Badge>
              <Badge variant={po.status === 'active' ? 'default' : 'secondary'}>{po.status.toUpperCase()}</Badge>
            </div>
            <p className="text-muted-foreground flex items-center gap-4 mt-1 text-sm">
              <span className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> {customer?.name || '...'}</span>
              <span className="flex items-center gap-1"><FileText className="h-3.5 w-3.5" /> สัญญา: {contract?.contractNumber || '...'}</span>
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setEditedPO(po); setIsEditing(!isEditing); }}>
              {isEditing ? 'ยกเลิก' : 'แก้ไขข้อมูล'}
            </Button>
            {isEditing && (
              <Button className="gap-2" onClick={handleSaveMaster}>
                <Save className="h-4 w-4" /> บันทึก
              </Button>
            )}
          </div>
        </div>

        <Tabs defaultValue="lines" className="w-full">
          <TabsList className="grid grid-cols-2 w-full md:w-fit h-auto p-1 bg-muted/50">
            <TabsTrigger value="lines" className="gap-2 py-2 px-6"><ShoppingCart className="h-4 w-4" /> รายการสั่งจอง (PO Lines)</TabsTrigger>
            <TabsTrigger value="info" className="gap-2 py-2 px-6"><FileText className="h-4 w-4" /> ข้อมูลใบสั่งซื้อ</TabsTrigger>
          </TabsList>

          <TabsContent value="lines" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>รายการจองโควต้ากำลังคน (PO Lines)</CardTitle>
                  <CardDescription>ระบุจำนวนคนงานและอัตราราคาที่สั่งซื้อตามสัญญา</CardDescription>
                </div>
                <Dialog open={isAddLineOpen} onOpenChange={setIsAddLineOpen}>
                  <DialogTrigger asChild>
                    <Button className="gap-2"><Plus className="h-4 w-4" /> เพิ่มรายการจอง</Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>เพิ่มรายการจองตำแหน่งงาน</DialogTitle>
                      <DialogDescription>เลือกตำแหน่งงานจากสัญญาที่เกี่ยวข้องและระบุจำนวน</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid gap-2">
                        <Label>ตำแหน่งงาน (จากสัญญา)</Label>
                        <Select onValueChange={v => setNewLine({...newLine, positionId: v})} value={newLine.positionId}>
                          <SelectTrigger><SelectValue placeholder="เลือกตำแหน่งงาน..." /></SelectTrigger>
                          <SelectContent>
                            {rates?.map(r => {
                              const p = allPositions?.find(pos => pos.id === r.positionId);
                              return (
                                <SelectItem key={r.id} value={r.positionId}>{p?.positionName || r.positionId}</SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <Label>จำนวนคนงาน (อัตรารวม)</Label>
                        <Input type="number" min="1" value={newLine.quantity} onChange={e => setNewLine({...newLine, quantity: parseInt(e.target.value)})} />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsAddLineOpen(false)}>ยกเลิก</Button>
                      <Button onClick={handleAddLine} disabled={!newLine.positionId || !newLine.quantity}>เพิ่มรายการ</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ตำแหน่งงาน</TableHead>
                      <TableHead>จำนวน</TableHead>
                      <TableHead>ราคาขาย (Sell)</TableHead>
                      <TableHead>ต้นทุน (Cost)</TableHead>
                      <TableHead>หน่วย</TableHead>
                      <TableHead className="text-right">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {poLines?.map(line => {
                      const pos = allPositions?.find(p => p.id === line.positionId);
                      return (
                        <TableRow key={line.id}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <Briefcase className="h-4 w-4 text-muted-foreground" />
                              {pos?.positionName || line.positionId}
                            </div>
                          </TableCell>
                          <TableCell className="font-bold">{line.quantity} อัตรา</TableCell>
                          <TableCell className="text-green-600">฿{line.sellRateSnapshot.toLocaleString()}</TableCell>
                          <TableCell className="text-muted-foreground">฿{line.costBaselineSnapshot.toLocaleString()}</TableCell>
                          <TableCell className="capitalize">{line.billingUnitSnapshot}</TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deleteLine(line.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {!poLines?.length && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-10 text-muted-foreground italic">ยังไม่มีรายการสั่งจองในใบสั่งซื้อนี้</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="info" className="mt-6">
            <Card>
              <CardHeader><CardTitle>ข้อมูลพื้นฐานใบสั่งซื้อ (PO Header Info)</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>หัวข้อใบสั่งซื้อ (Title)</Label>
                    <Input disabled={!isEditing} value={isEditing ? editedPO.title : po.title} onChange={e => setEditedPO({...editedPO, title: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>เลขที่ใบสั่งซื้อ (PO No.)</Label>
                    <Input disabled={!isEditing} value={isEditing ? editedPO.poNumber : po.poNumber} onChange={e => setEditedPO({...editedPO, poNumber: e.target.value})} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>วันที่เริ่มงาน (ตาม PO)</Label>
                      <Input type="date" disabled={!isEditing} value={isEditing ? new Date(editedPO.startDate || 0).toISOString().split('T')[0] : new Date(po.startDate).toISOString().split('T')[0]} onChange={e => setEditedPO({...editedPO, startDate: new Date(e.target.value).getTime()})} />
                    </div>
                    <div className="space-y-2">
                      <Label>วันที่สิ้นสุดงาน</Label>
                      <Input type="date" disabled={!isEditing} value={isEditing ? new Date(editedPO.endDate || 0).toISOString().split('T')[0] : new Date(po.endDate).toISOString().split('T')[0]} onChange={e => setEditedPO({...editedPO, endDate: new Date(e.target.value).getTime()})} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>สถานะใบสั่งซื้อ</Label>
                    <Select disabled={!isEditing} onValueChange={v => setEditedPO({...editedPO, status: v as any})} value={isEditing ? editedPO.status : po.status}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="closed">Closed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
