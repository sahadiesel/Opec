
'use client';

import { useState, use, useEffect, useMemo } from 'react';
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
  AlertCircle,
  TrendingUp,
  Coins,
  History,
  Info,
  Loader2,
  Zap,
  BarChart3,
  Percent,
  Scale
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
import { doc, collection, query, where, updateDoc } from 'firebase/firestore';
import { updateDocumentNonBlocking, addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { 
  PurchaseOrder, 
  POLine, 
  Customer, 
  MainContract, 
  Position, 
  PositionRate, 
  User, 
  Assignment, 
  Worker,
  SalesContractTerm,
  LaborCostContractTerm,
  RateCondition
} from '@/lib/types';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { Textarea } from '@/components/ui/textarea';
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';
import { Separator } from '@/components/ui/separator';
import { ProfitAnalysisTab } from '@/components/commercial/profit-analysis-tab';
import { writeAuditLog } from '@/lib/services/audit-service';

export default function CustomerPODetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
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

  // Linkage: Sales Terms (Revenue Side)
  const salesTermsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'sales_contract_terms'), where('purchaseOrderId', '==', id)) : null), [firestore, id]);
  const { data: salesTerms } = useCollection<SalesContractTerm>(salesTermsQuery as any);

  // Linkage: Cost Terms (Expense Side)
  const costTermsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'labor_cost_contract_terms'), where('relatedPurchaseOrderId', '==', id)) : null), [firestore, id]);
  const { data: costTerms } = useCollection<LaborCostContractTerm>(costTermsQuery as any);

  const assignmentsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'mobilizations'), where('poId', '==', id));
  }, [firestore, id]);
  const { data: allAssignments } = useCollection<Assignment>(assignmentsQuery as any);

  const customersQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'customers') : null), [firestore]);
  const { data: customers } = useCollection<Customer>(customersQuery as any);

  const contractRef = useMemoFirebase(() => (firestore && po?.contractId ? doc(firestore, 'main_contracts', po.contractId) : null), [firestore, po?.contractId]);
  const { data: contract } = useDoc<MainContract>(contractRef as any);

  const ratesQuery = useMemoFirebase(() => (firestore && po?.contractId ? collection(firestore, 'main_contracts', po.contractId, 'position_rates') : null), [firestore, po?.contractId]);
  const { data: rates } = useCollection<PositionRate>(ratesQuery as any);

  const positionsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'positions') : null), [firestore]);
  const { data: allPositions } = useCollection<Position>(positionsQuery as any);

  const conditionsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'rate_conditions') : null), [firestore]);
  const { data: allConditions } = useCollection<RateCondition>(conditionsQuery as any);

  const [isEditing, setIsEditing] = useState(false);
  const [editedPO, setEditedPO] = useState<Partial<PurchaseOrder>>({});

  const [isAddLineOpen, setIsAddLineOpen] = useState(false);
  const [newLine, setNewLine] = useState<Partial<POLine>>({ 
    quantity: 1,
    status: 'active'
  });

  const [isCreatingSalesTerm, setIsCreatingSalesTerm] = useState(false);
  const [newSalesTerm, setNewSalesTerm] = useState<Partial<SalesContractTerm>>({
    currency: 'THB',
    vatPercent: 7,
    withholdingTaxPercent: 3,
    billingCycle: 'Monthly',
    paymentTermsDays: 30,
    status: 'ACTIVE'
  });

  useEffect(() => {
    if (po) setEditedPO(po);
  }, [po]);

  const handleSaveMaster = () => {
    if (!poRef || !currentUser) return;
    updateDocumentNonBlocking(poRef, { ...editedPO, updatedAt: Date.now() });
    setIsEditing(false);

    // Audit Log
    writeAuditLog(firestore, currentUser, {
      actionType: 'UPDATE',
      entityType: 'PurchaseOrder',
      entityId: id,
      entityLabel: po.poCode,
      changedFields: Object.keys(editedPO),
      sourceModule: 'commercial',
      purchaseOrderId: id,
      afterSummary: 'Updated purchase order header details'
    });

    toast({ title: "บันทึกสำเร็จ", description: "ข้อมูล Customer PO ถูกอัปเดตแล้ว" });
  };

  const handleAddLine = () => {
    if (!poLinesQuery || !newLine.positionId || !currentUser) return;
    
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

    // Audit Log
    writeAuditLog(firestore, currentUser, {
      actionType: 'CREATE',
      entityType: 'POLine',
      entityId: 'new_line',
      entityLabel: newLine.positionId,
      sourceModule: 'commercial',
      purchaseOrderId: id,
      afterSummary: `Added PO line for ${newLine.positionId} x ${newLine.quantity}`
    });
    
    setIsAddLineOpen(false);
    setNewLine({ quantity: 1, status: 'active' });
    toast({ title: "เพิ่ม PO Line สำเร็จ" });
  };

  const handleCreateSalesTerm = async () => {
    if (!firestore || !currentUser || !po) return;
    setIsCreatingSalesTerm(true);
    try {
      const { code: finalNo } = await generateNextDocumentCode(firestore, 'sales_term', { actor: currentUser.displayName });
      
      const termData = {
        ...newSalesTerm,
        contractNo: finalNo,
        title: `Sales Terms for ${po.poCode}`,
        customerId: po.customerId,
        mainContractId: po.contractId,
        purchaseOrderId: po.id,
        effectiveDate: new Date(po.startDate).toISOString().split('T')[0],
        endDate: new Date(po.endDate).toISOString().split('T')[0],
        createdBy: currentUser.displayName,
        updatedBy: currentUser.displayName,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      const docRef = await addDocumentNonBlocking(collection(firestore, 'sales_contract_terms'), termData);

      if (docRef) {
        writeAuditLog(firestore, currentUser, {
          actionType: 'CREATE',
          entityType: 'SalesContractTerm',
          entityId: docRef.id,
          entityLabel: finalNo,
          sourceModule: 'commercial',
          purchaseOrderId: id,
          afterSummary: `Initialized sales terms for PO ${po.poCode}`
        });
      }

      toast({ title: "สร้างเงื่อนไขการขายสำเร็จ", description: `รหัส: ${finalNo}` });
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถบันทึกข้อมูลได้" });
    } finally {
      setIsCreatingSalesTerm(false);
    }
  };

  const deleteLine = (lineId: string) => {
    if (!firestore || !currentUser) return;
    if (confirm('ยืนยันการลบรายการนี้? รายการมอบหมายที่เชื่อมโยงอยู่จะยังคงอยู่แต่จะเสียการอ้างอิง')) {
      deleteDocumentNonBlocking(doc(firestore, 'purchase_orders', id, 'po_lines', lineId));
      
      writeAuditLog(firestore, currentUser, {
        actionType: 'DELETE',
        entityType: 'POLine',
        entityId: lineId,
        sourceModule: 'commercial',
        purchaseOrderId: id,
        afterSummary: 'Deleted PO line item'
      });
    }
  };

  if (isPOLoading || !po || !currentUser) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-12 w-12 text-primary animate-spin" />
        </div>
      </AppShell>
    );
  }

  const customer = customers?.find(c => c.id === po.customerId);
  const poAssignments = allAssignments || [];

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
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
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setEditedPO(po); setIsEditing(!isEditing); }}>
              {isEditing ? 'ยกเลิก' : 'แก้ไขข้อมูล'}
            </Button>
            {isEditing && (
              <Button className="gap-2 bg-primary font-bold shadow-md h-10 px-6" onClick={handleSaveMaster}>
                <Save className="h-4 w-4" /> บันทึกการเปลี่ยนแปลง
              </Button>
            )}
          </div>
        </div>

        <Tabs defaultValue="lines" className="w-full">
          <TabsList className="grid grid-cols-5 w-full md:w-[900px] h-auto p-1 bg-muted/50">
            <TabsTrigger value="info" className="gap-2 py-2 px-6">ข้อมูลหัว PO</TabsTrigger>
            <TabsTrigger value="lines" className="gap-2 py-2 px-6">PO Lines (โควต้า)</TabsTrigger>
            <TabsTrigger value="terms" className="gap-2 py-2 px-6"><Scale className="h-4 w-4" /> Commercial Terms</TabsTrigger>
            <TabsTrigger value="analysis" className="gap-2 py-2 px-6"><BarChart3 className="h-4 w-4" /> Profit Analysis</TabsTrigger>
            <TabsTrigger value="assignments" className="gap-2 py-2 px-6">Assignments (คนงาน)</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="mt-6">
            <Card>
              <CardHeader><CardTitle>รายละเอียด Customer PO (Header Info)</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label className="font-bold">หัวข้อ / ชื่อโครงการ</Label>
                    <Input disabled={!isEditing} value={isEditing ? editedPO.title : po.title} onChange={e => setEditedPO({...editedPO, title: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">เลขที่ Customer PO (PO Code)</Label>
                    <Input disabled={!isEditing} value={isEditing ? editedPO.poCode : po.poCode} onChange={e => setEditedPO({...editedPO, poCode: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">ชื่อโครงการเฉพาะทาง (Project Name)</Label>
                    <Input disabled={!isEditing} value={isEditing ? editedPO.projectName : po.projectName} onChange={e => setEditedPO({...editedPO, projectName: e.target.value})} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="font-bold">วันที่เริ่มงานตาม PO</Label>
                      <Input type="date" disabled={!isEditing} value={isEditing ? new Date(editedPO.startDate || 0).toISOString().split('T')[0] : new Date(po.startDate).toISOString().split('T')[0]} onChange={e => setEditedPO({...editedPO, startDate: new Date(e.target.value).getTime()})} />
                    </div>
                    <div className="space-y-2">
                      <Label className="font-bold">วันที่สิ้นสุดงานตาม PO</Label>
                      <Input type="date" disabled={!isEditing} value={isEditing ? new Date(editedPO.endDate || 0).toISOString().split('T')[0] : new Date(po.endDate).toISOString().split('T')[0]} onChange={e => setEditedPO({...editedPO, endDate: new Date(e.target.value).getTime()})} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">สถานะใบสั่งซื้อ</Label>
                    <Select disabled={!isEditing} onValueChange={v => setEditedPO({...editedPO, status: v as any})} value={isEditing ? editedPO.status : po.status}>
                      <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="closed">Closed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="font-bold">หมายเหตุ</Label>
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
                    <Button className="gap-2 h-10 px-6 font-bold shadow-sm"><Plus className="h-4 w-4" /> เพิ่มรายการจองตำแหน่ง</Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>เพิ่มรายการจองกำลังคน</DialogTitle>
                      <DialogDescription>เลือกตำแหน่งงานจากสัญญาที่เกี่ยวข้องและระบุจำนวน</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid gap-2">
                        <Label className="font-bold">ตำแหน่งงาน (ที่ระบุในสัญญา)</Label>
                        <Select onValueChange={v => setNewLine({...newLine, positionId: v})} value={newLine.positionId}>
                          <SelectTrigger className="h-11"><SelectValue placeholder="เลือกตำแหน่งงาน..." /></SelectTrigger>
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
                        <Label className="font-bold">จำนวนคนงานที่ต้องการ (Quantity)</Label>
                        <Input type="number" min="1" value={newLine.quantity} onChange={e => setNewLine({...newLine, quantity: parseInt(e.target.value)})} className="h-11" />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label className="font-bold text-xs">วันที่เริ่ม (รายบรรทัด)</Label>
                          <Input type="date" value={newLine.startDate ? new Date(newLine.startDate).toISOString().split('T')[0] : ''} onChange={e => setNewLine({...newLine, startDate: new Date(e.target.value).getTime()})} />
                        </div>
                        <div className="grid gap-2">
                          <Label className="font-bold text-xs">วันที่สิ้นสุด (รายบรรทัด)</Label>
                          <Input type="date" value={newLine.endDate ? new Date(newLine.endDate).toISOString().split('T')[0] : ''} onChange={e => setNewLine({...newLine, endDate: new Date(e.target.value).getTime()})} />
                        </div>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsAddLineOpen(false)}>ยกเลิก</Button>
                      <Button onClick={handleAddLine} disabled={!newLine.positionId || !newLine.quantity} className="bg-primary font-bold px-8">เพิ่มรายการจอง</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent className="p-0 border-t">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead className="pl-6">ตำแหน่งงาน (Position)</TableHead>
                      <TableHead className="text-center">โควต้า (Req)</TableHead>
                      <TableHead className="text-center">มอบหมายแล้ว (Asgn)</TableHead>
                      <TableHead className="text-center">คงเหลือ (Slots)</TableHead>
                      <TableHead className="text-right">ราคาขาย (Snapshot)</TableHead>
                      <TableHead className="text-right pr-6">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {poLines?.map(line => {
                      const pos = allPositions?.find(p => p.id === line.positionId);
                      const assignedCount = poAssignments.filter(a => a.poLineId === line.id && ['DRAFT', 'READY', 'MOBILIZING', 'ACTIVE'].includes(a.deploymentStatus)).length;
                      const remaining = line.quantity - assignedCount;
                      
                      return (
                        <TableRow key={line.id} className="hover:bg-muted/10 transition-colors">
                          <TableCell className="pl-6 py-4">
                            <div className="flex flex-col">
                              <span className="font-bold text-primary">{pos?.positionName || line.positionId}</span>
                              <span className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                                <Calendar className="h-2.5 w-2.5" />
                                {new Date(line.startDate).toLocaleDateString('th-TH')} - {new Date(line.endDate).toLocaleDateString('th-TH')}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-center font-black">{line.quantity}</TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 px-3">
                              {assignedCount} คน
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            {remaining > 0 ? (
                              <Badge className="bg-amber-100 text-amber-700 border-amber-200 px-3">
                                {remaining} ว่าง
                              </Badge>
                            ) : (
                              <Badge className="bg-green-100 text-green-700 border-green-200 px-3">
                                <CheckCircle2 className="h-3 w-3 mr-1" /> เต็ม
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex flex-col items-end">
                              <span className="text-green-700 font-bold">฿{line.sellRateSnapshot.toLocaleString()}</span>
                              <span className="text-[10px] text-muted-foreground uppercase font-black italic">per {line.billingUnitSnapshot}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right pr-6">
                            <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => deleteLine(line.id)}>
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

          <TabsContent value="terms" className="mt-6 space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Revenue Side */}
              <Card className="shadow-md">
                <CardHeader className="flex flex-row items-center justify-between border-b pb-4 bg-blue-50/20">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2 text-blue-800"><TrendingUp className="h-5 w-5" /> เงื่อนไขการขาย (Revenue Terms)</CardTitle>
                    <CardDescription>นโยบายการวางบิลและรายรับ สำหรับใบสั่งซื้อนี้</CardDescription>
                  </div>
                  {salesTerms?.length === 0 && (
                    <Button variant="outline" className="gap-2 border-blue-600 text-blue-700 hover:bg-blue-50 font-bold" onClick={handleCreateSalesTerm} disabled={isCreatingSalesTerm}>
                      {isCreatingSalesTerm ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      เปิดใช้ Sales Term
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="pt-6">
                  {salesTerms?.map(term => (
                    <div key={term.id} className="space-y-6">
                      <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase font-black tracking-widest text-muted-foreground">เลขที่สัญญาย่อย:</Label>
                          <p className="font-mono text-sm font-bold text-primary flex items-center gap-2">
                            <Scale className="h-3 w-3 text-blue-600" /> {term.contractNo}
                          </p>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase font-black tracking-widest text-muted-foreground">รอบการวางบิล:</Label>
                          <p className="font-bold text-primary">{term.billingCycle}</p>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase font-black tracking-widest text-muted-foreground">VAT (%):</Label>
                          <Badge variant="outline" className="bg-slate-50">{term.vatPercent}%</Badge>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase font-black tracking-widest text-muted-foreground">WHT (%):</Label>
                          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">{term.withholdingTaxPercent}%</Badge>
                        </div>
                      </div>
                      <Separator className="bg-blue-100/50" />
                      <div className="p-4 bg-blue-50/30 rounded-lg space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-black uppercase text-blue-800 tracking-tighter">Status & Effective Date</span>
                          <Badge className="bg-green-600 h-5 text-[9px]">{term.status}</Badge>
                        </div>
                        <div className="flex justify-between items-center text-xs font-medium text-slate-600">
                          <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> From: {term.effectiveDate}</span>
                          <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> To: {term.endDate}</span>
                        </div>
                      </div>
                      <Button variant="ghost" className="w-full text-blue-700 font-bold text-xs h-8 group" asChild>
                        <Link href={`/sales-terms/${term.id}`}>จัดการกฎราคาขาย (Sell Rates) <ChevronRight className="h-3 w-3 ml-1 group-hover:translate-x-1 transition-all" /></Link>
                      </Button>
                    </div>
                  ))}
                  {salesTerms?.length === 0 && (
                    <div className="py-10 text-center text-muted-foreground italic text-sm">ยังไม่มีการกำหนดเงื่อนไขการขายสำหรับ PO นี้</div>
                  )}
                </CardContent>
              </Card>

              {/* Expense Side */}
              <Card className="shadow-md">
                <CardHeader className="flex flex-row items-center justify-between border-b pb-4 bg-orange-50/20">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2 text-orange-800"><Coins className="h-5 w-5" /> เงื่อนไขต้นทุนแรงงาน (Labor Cost)</CardTitle>
                    <CardDescription>โครงสร้างค่าตอบแทนพนักงาน สำหรับใบสั่งซื้อนี้</CardDescription>
                  </div>
                  {costTerms?.length === 0 && (
                    <Button variant="outline" className="gap-2 border-orange-600 text-orange-700 hover:bg-orange-50 font-bold" asChild>
                      <Link href={`/labor-cost-terms`}>
                        <Plus className="h-4 w-4" /> สร้าง Cost Term
                      </Link>
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="pt-6">
                  {costTerms?.length === 0 ? (
                    <div className="py-10 text-center text-muted-foreground italic text-sm">ยังไม่มีการกำหนดเงื่อนไขต้นทุนแรงงานที่ผูกกับ PO นี้</div>
                  ) : (
                    <div className="space-y-4">
                      {costTerms.map(term => (
                        <div key={term.id} className="p-4 border border-orange-100 bg-orange-50/10 rounded-lg hover:bg-orange-50/30 transition-all group">
                          <div className="flex justify-between items-start mb-4">
                            <div className="space-y-1">
                              <p className="font-black text-primary uppercase text-xs">{term.title}</p>
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-[9px] uppercase font-bold tracking-tighter bg-white">{term.scopeType}</Badge>
                                <span className="text-[10px] text-muted-foreground">ID: {term.id}</span>
                              </div>
                            </div>
                            <Badge className="bg-orange-600 uppercase text-[9px]">{term.status}</Badge>
                          </div>
                          
                          <div className="flex justify-between items-center text-[10px] font-bold text-slate-500 mb-4">
                            <span><Calendar className="h-2.5 w-2.5 inline mr-1" /> Valid: {term.effectiveDate} ถึง {term.endDate}</span>
                          </div>

                          <Button variant="ghost" className="w-full text-orange-700 font-bold text-xs h-8 group border border-orange-200 bg-white hover:bg-orange-50" asChild>
                            <Link href={`/labor-cost-terms/${term.id}`}>จัดการกฎต้นทุน (Pay Rates) <ChevronRight className="h-3 w-3 ml-1 group-hover:translate-x-1 transition-all" /></Link>
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="analysis" className="mt-6">
            {po && salesTerms && costTerms && allConditions && poLines ? (
              <ProfitAnalysisTab 
                po={po} 
                poLines={poLines}
                salesTerms={salesTerms}
                costTerms={costTerms}
                allConditions={allConditions}
                user={currentUser}
              />
            ) : (
              <div className="py-20 text-center text-muted-foreground italic">
                <Info className="h-10 w-10 mx-auto mb-4 opacity-20" />
                กรุณากำหนดเงื่อนไขการขายและต้นทุนให้ครบถ้วนเพื่อวิเคราะห์กำไร
              </div>
            )}
          </TabsContent>

          <TabsContent value="assignments" className="mt-6">
            <Card>
              <CardHeader className="border-b bg-muted/5">
                <CardTitle>รายชื่อคนงานที่ได้รับมอบหมาย (Project Assignments)</CardTitle>
                <CardDescription>คนงานทั้งหมดที่ทำงานภายใต้ใบสั่งซื้อโครงการนี้</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead className="pl-6">คนงาน (Worker)</TableHead>
                      <TableHead>ตำแหน่ง (Position)</TableHead>
                      <TableHead>ช่วงเวลาทำงาน (Project Period)</TableHead>
                      <TableHead>สถานะ (Deployment)</TableHead>
                      <TableHead className="text-right pr-6">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {poAssignments.length > 0 ? (
                      poAssignments.map(asgn => {
                        const worker = allWorkers?.find(w => w.id === asgn.workerId);
                        const pos = allPositions?.find(p => p.id === asgn.positionId);
                        return (
                          <TableRow key={asgn.id} className="hover:bg-muted/10 transition-colors">
                            <TableCell className="pl-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-black text-xs">
                                  {worker?.firstName.charAt(0)}
                                </div>
                                <div className="flex flex-col">
                                  <span className="font-bold text-sm text-primary">{worker ? `${worker.firstName} ${worker.lastName}` : 'Unknown'}</span>
                                  <span className="text-[10px] text-muted-foreground font-mono">{worker?.thaiNationalId}</span>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-[10px] font-bold bg-white">{pos?.positionName || asgn.positionId}</Badge>
                            </TableCell>
                            <TableCell className="text-xs font-medium">
                              {asgn.startDate} - {asgn.endDate}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="capitalize text-[10px] font-black uppercase tracking-tighter">{asgn.deploymentStatus}</Badge>
                            </TableCell>
                            <TableCell className="text-right pr-6">
                              <Button variant="ghost" size="sm" className="font-bold h-8 group" asChild>
                                <Link href={`/mobilization/${asgn.id}`}>Manage Pre-Mob <ChevronRight className="h-3 w-3 ml-1 group-hover:translate-x-1 transition-all" /></Link>
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    ) : (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-20 text-muted-foreground italic">
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

function StatCard({ title, value, sub, icon: Icon, colorClass }: any) {
  return (
    <Card className={`hover:shadow-md transition-all border-l-8 ${colorClass} shadow-sm`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 opacity-50 text-primary" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-black text-primary truncate">{value}</div>
        <p className="text-[10px] font-medium text-muted-foreground mt-1 uppercase tracking-tighter">{sub}</p>
      </CardContent>
    </Card>
  );
}
