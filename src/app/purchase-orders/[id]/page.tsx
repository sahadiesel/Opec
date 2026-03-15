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
  Users,
  Calendar,
  CheckCircle2,
  AlertCircle
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
import { PurchaseOrder, POLine, Customer, MainContract, Position, PositionRate, User, Assignment, Worker } from '@/lib/types';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { Textarea } from '@/components/ui/textarea';

export default function CustomerPODetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const poRef = useMemoFirebase(() => (firestore ? doc(firestore, 'purchase_orders', id) : null), [firestore, id]);
  const { data: po, isLoading: isPOLoading } = useDoc<PurchaseOrder>(poRef as any);

  const poLinesQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'purchase_orders', id, 'po_lines') : null), [firestore, id]);
  const { data: poLines } = useCollection<POLine>(poLinesQuery as any);

  const assignmentsQuery = useMemoFirebase(() => {
    if (!firestore || isUserLoading || !firebaseUser) return null;
    return query(collection(firestore, 'mobilizations'), where('poId', '==', id));
  }, [firestore, firebaseUser, isUserLoading, id]);
  const { data: allAssignments } = useCollection<Assignment>(assignmentsQuery as any);

  const workersQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'workers') : null), [firestore]);
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

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
  const [newLine, setNewLine] = useState<Partial<POLine>>({ 
    quantity: 1,
    status: 'active'
  });

  const handleSaveMaster = () => {
    if (!poRef) return;
    updateDocumentNonBlocking(poRef, { ...editedPO, updatedAt: Date.now() });
    setIsEditing(false);
    toast({ title: "บันทึกสำเร็จ", description: "ข้อมูล Customer PO ถูกอัปเดตแล้ว" });
  };

  const handleAddLine = () => {
    if (!poLinesQuery || !newLine.positionId) return;
    
    const rate = rates?.find(r => r.positionId === newLine.positionId);
    if (!rate) {
      toast({ variant: "destructive", title: "Error", description: "ไม่พบอัตราราคาสำหรับตำแหน่งนี้ในสัญญาหลัก" });
      return;
    }

    addDocumentNonBlocking(poLinesQuery, {
      poId: id,
      positionId: newLine.positionId,
      quantity: Number(newLine.quantity) || 1,
      startDate: newLine.startDate || po?.startDate || Date.now(),
      endDate: newLine.endDate || po?.endDate || Date.now(),
      sellRateSnapshot: rate.sellRate,
      costBaselineSnapshot: rate.costBaseline,
      billingUnitSnapshot: rate.billingUnit,
      overtimeRuleSnapshot: rate.overtimeRule,
      status: 'active'
    });
    
    setIsAddLineOpen(false);
    setNewLine({ quantity: 1, status: 'active' });
    toast({ title: "เพิ่ม PO Line สำเร็จ" });
  };

  const deleteLine = (lineId: string) => {
    if (!firestore) return;
    if (confirm('ยืนยันการลบรายการนี้? รายการมอบหมายที่เชื่อมโยงอยู่จะยังคงอยู่แต่จะเสียการอ้างอิง')) {
      deleteDocumentNonBlocking(doc(firestore, 'purchase_orders', id, 'po_lines', lineId));
    }
  };

  if (isPOLoading || !po || !currentUser) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="animate-pulse text-muted-foreground">กำลังโหลดข้อมูล Customer PO...</div>
        </div>
      </AppShell>
    );
  }

  const customer = customers?.find(c => c.id === po.customerId);
  const poAssignments = allAssignments || [];

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
              <Badge variant="outline" className="font-mono text-primary border-primary/20">{po.poCode}</Badge>
              <Badge variant={po.status === 'active' ? 'default' : 'secondary'}>{po.status.toUpperCase()}</Badge>
            </div>
            <p className="text-muted-foreground flex items-center gap-4 mt-1 text-sm">
              <span className="flex items-center gap-1 font-medium"><Building2 className="h-3.5 w-3.5" /> {customer?.name || '...'}</span>
              <span className="flex items-center gap-1 text-xs"><FileText className="h-3.5 w-3.5" /> สัญญา: {contract?.contractNumber || '...'}</span>
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setEditedPO(po); setIsEditing(!isEditing); }}>
              {isEditing ? 'ยกเลิก' : 'แก้ไขข้อมูล'}
            </Button>
            {isEditing && (
              <Button className="gap-2" onClick={handleSaveMaster}>
                <Save className="h-4 w-4" /> บันทึกการเปลี่ยนแปลง
              </Button>
            )}
          </div>
        </div>

        <Tabs defaultValue="lines" className="w-full">
          <TabsList className="grid grid-cols-3 w-full md:w-fit h-auto p-1 bg-muted/50">
            <TabsTrigger value="info" className="gap-2 py-2 px-6"><FileText className="h-4 w-4" /> ข้อมูล PO</TabsTrigger>
            <TabsTrigger value="lines" className="gap-2 py-2 px-6"><ShoppingCart className="h-4 w-4" /> PO Lines (จองโควต้า)</TabsTrigger>
            <TabsTrigger value="assignments" className="gap-2 py-2 px-6"><Users className="h-4 w-4" /> Assignments (คนงาน)</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="mt-6">
            <Card>
              <CardHeader><CardTitle>รายละเอียด Customer PO (Header Info)</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>หัวข้อ / ชื่อโครงการ</Label>
                    <Input disabled={!isEditing} value={isEditing ? editedPO.title : po.title} onChange={e => setEditedPO({...editedPO, title: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>เลขที่ Customer PO (PO Code)</Label>
                    <Input disabled={!isEditing} value={isEditing ? editedPO.poCode : po.poCode} onChange={e => setEditedPO({...editedPO, poCode: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>ชื่อโครงการเฉพาะทาง (Project Name)</Label>
                    <Input disabled={!isEditing} value={isEditing ? editedPO.projectName : po.projectName} onChange={e => setEditedPO({...editedPO, projectName: e.target.value})} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>วันที่เริ่มงานตาม PO</Label>
                      <Input type="date" disabled={!isEditing} value={isEditing ? new Date(editedPO.startDate || 0).toISOString().split('T')[0] : new Date(po.startDate).toISOString().split('T')[0]} onChange={e => setEditedPO({...editedPO, startDate: new Date(e.target.value).getTime()})} />
                    </div>
                    <div className="space-y-2">
                      <Label>วันที่สิ้นสุดงานตาม PO</Label>
                      <Input type="date" disabled={!isEditing} value={isEditing ? new Date(editedPO.endDate || 0).toISOString().split('T')[0] : new Date(po.endDate).toISOString().split('T')[0]} onChange={e => setEditedPO({...editedPO, endDate: new Date(e.target.value).getTime()})} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>รายละเอียดโครงการ</Label>
                    <Textarea disabled={!isEditing} value={isEditing ? editedPO.description : po.description} onChange={e => setEditedPO({...editedPO, description: e.target.value})} />
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
                <div className="space-y-2">
                  <Label>หมายเหตุ</Label>
                  <Textarea disabled={!isEditing} value={isEditing ? editedPO.notes : po.notes} onChange={e => setEditedPO({...editedPO, notes: e.target.value})} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="lines" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>รายการจองโควต้ากำลังคน (PO Lines)</CardTitle>
                  <CardDescription>กำหนดจำนวนคนงานรายตำแหน่งและบันทึกอัตราราคา Snapshot</CardDescription>
                </div>
                <Dialog open={isAddLineOpen} onOpenChange={setIsAddLineOpen}>
                  <DialogTrigger asChild>
                    <Button className="gap-2"><Plus className="h-4 w-4" /> เพิ่มรายการจองตำแหน่ง</Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>เพิ่มรายการจองกำลังคน</DialogTitle>
                      <DialogDescription>เลือกตำแหน่งงานจากสัญญาที่เกี่ยวข้องและระบุจำนวน</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid gap-2">
                        <Label>ตำแหน่งงาน (ที่ระบุในสัญญา)</Label>
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
                        <Label>จำนวนคนงานที่ต้องการ (Quantity)</Label>
                        <Input type="number" min="1" value={newLine.quantity} onChange={e => setNewLine({...newLine, quantity: parseInt(e.target.value)})} />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label>วันที่เริ่ม (รายบรรทัด)</Label>
                          <Input type="date" value={newLine.startDate ? new Date(newLine.startDate).toISOString().split('T')[0] : ''} onChange={e => setNewLine({...newLine, startDate: new Date(e.target.value).getTime()})} />
                        </div>
                        <div className="grid gap-2">
                          <Label>วันที่สิ้นสุด (รายบรรทัด)</Label>
                          <Input type="date" value={newLine.endDate ? new Date(newLine.endDate).toISOString().split('T')[0] : ''} onChange={e => setNewLine({...newLine, endDate: new Date(e.target.value).getTime()})} />
                        </div>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsAddLineOpen(false)}>ยกเลิก</Button>
                      <Button onClick={handleAddLine} disabled={!newLine.positionId || !newLine.quantity}>เพิ่มรายการจอง</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ตำแหน่งงาน (Position)</TableHead>
                      <TableHead>โควต้า (Req)</TableHead>
                      <TableHead>มอบหมายแล้ว (Asgn)</TableHead>
                      <TableHead>คงเหลือ (Slots)</TableHead>
                      <TableHead>ราคาขาย (Snapshot)</TableHead>
                      <TableHead className="text-right">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {poLines?.map(line => {
                      const pos = allPositions?.find(p => p.id === line.positionId);
                      const assignedCount = poAssignments.filter(a => a.poLineId === line.id && ['DRAFT', 'READY', 'MOBILIZING', 'ACTIVE'].includes(a.deploymentStatus)).length;
                      const remaining = line.quantity - assignedCount;
                      
                      return (
                        <TableRow key={line.id}>
                          <TableCell className="font-medium">
                            <div className="flex flex-col">
                              <span>{pos?.positionName || line.positionId}</span>
                              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                <Calendar className="h-2.5 w-2.5" />
                                {new Date(line.startDate).toLocaleDateString('th-TH')} - {new Date(line.endDate).toLocaleDateString('th-TH')}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="font-bold">{line.quantity}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                              {assignedCount} คน
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {remaining > 0 ? (
                              <Badge className="bg-amber-100 text-amber-700 border-amber-200">
                                {remaining} ว่าง
                              </Badge>
                            ) : (
                              <Badge className="bg-green-100 text-green-700 border-green-200">
                                <CheckCircle2 className="h-3 w-3 mr-1" /> เต็ม
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs">
                            <div className="flex flex-col">
                              <span className="text-green-600 font-semibold">฿{line.sellRateSnapshot.toLocaleString()}</span>
                              <span className="text-muted-foreground italic">/{line.billingUnitSnapshot}</span>
                            </div>
                          </TableCell>
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
                        <TableCell colSpan={6} className="text-center py-20 text-muted-foreground italic">ยังไม่มีรายการสั่งจองในใบสั่งซื้อนี้</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="assignments" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>รายชื่อคนงานที่ได้รับมอบหมาย (Project Assignments)</CardTitle>
                <CardDescription>แสดงรายชื่อคนงานทั้งหมดที่ทำงานภายใต้ใบสั่งซื้อโครงการนี้ (รวบรวมจากทุก PO Lines)</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>คนงาน</TableHead>
                      <TableHead>ตำแหน่งงาน</TableHead>
                      <TableHead>ระยะเวลาทำงาน</TableHead>
                      <TableHead>สถานะ</TableHead>
                      <TableHead className="text-right">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {poAssignments.length > 0 ? (
                      poAssignments.map(asgn => {
                        const worker = allWorkers?.find(w => w.id === asgn.workerId);
                        const pos = allPositions?.find(p => p.id === asgn.positionId);
                        return (
                          <TableRow key={asgn.id}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Users className="h-4 w-4 text-muted-foreground" />
                                <div className="flex flex-col">
                                  <span className="font-medium">{worker ? `${worker.firstName} ${worker.lastName}` : 'N/A'}</span>
                                  <span className="text-[10px] text-muted-foreground">{worker?.thaiNationalId}</span>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-xs font-semibold">{pos?.positionName || asgn.positionId}</TableCell>
                            <TableCell className="text-xs">
                              {asgn.startDate} - {asgn.endDate}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="capitalize">{asgn.deploymentStatus}</Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button variant="ghost" size="sm" asChild>
                                <Link href={`/mobilization/${asgn.id}`}>จัดการการเตรียมความพร้อม</Link>
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    ) : (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-10 text-muted-foreground italic">
                          ยังไม่มีการมอบหมายคนงานใน PO นี้ (กรุณาไปที่เมนู 'การมอบหมาย' เพื่อเพิ่มคนงานเข้า PO Lines)
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}