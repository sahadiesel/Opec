'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, ShoppingCart, ChevronRight, Building2, FileText, Calendar, Info, ArrowRight, Filter, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { PurchaseOrder, User, Customer, MainContract, Quotation } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { addDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { formatDateRangeThaiBE } from '@/lib/date-thai';
import { useToast } from '@/hooks/use-toast';
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';
import { useAppUser } from '@/hooks/use-app-user';
import { canView, canCreate } from '@/lib/permissions';

function CustomerPOsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const isAuthorized = useMemo(
    () => !!currentUser && canView(currentUser, 'customer_pos'),
    [currentUser]
  );

  const isStaff = isAuthorized;
  const canCreatePO = useMemo(
    () => !!currentUser && canCreate(currentUser, 'customer_pos'),
    [currentUser]
  );

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newPO, setNewPO] = useState<Partial<PurchaseOrder>>({
    poType: 'contract',
    title: '',
    poCode: getPreviewPattern('customer_po'),
    customerId: '',
    contractId: '',
    quotationId: '',
    customerPONumber: '',
    projectName: '',
    description: '',
    startDate: Date.now(),
    endDate: Date.now() + 2592000000, // +30 days
    status: 'pending',
    notes: ''
  });

  useEffect(() => {
    const contractId = searchParams.get('contractId');
    const customerId = searchParams.get('customerId');
    if (!contractId && !customerId) return;
    setNewPO((prev) => ({
      ...prev,
      poType: contractId ? 'contract' : (prev.poType || 'contract'),
      contractId: contractId || prev.contractId || '',
      customerId: customerId || prev.customerId || '',
    }));
    if (contractId) setIsCreateOpen(true);
  }, [searchParams]);

  const poQuery = useMemoFirebase(() => {
    if (!firestore || isUserLoading || !firebaseUser || !currentUser || !isAuthorized) return null;
    return collection(firestore, 'purchase_orders');
  }, [firestore, firebaseUser, isUserLoading, currentUser, isAuthorized]);

  const { data: pos, isLoading: isPOLoading } = useCollection<PurchaseOrder>(poQuery as any);

  const customersQuery = useMemoFirebase(() => {
    if (!firestore || isUserLoading || !firebaseUser || !isAuthorized) return null;
    return collection(firestore, 'customers');
  }, [firestore, firebaseUser, isUserLoading, isAuthorized]);
  const { data: customers } = useCollection<Customer>(customersQuery as any);

  const contractsQuery = useMemoFirebase(() => {
    if (!firestore || isUserLoading || !firebaseUser || !isAuthorized) return null;
    return query(collection(firestore, 'main_contracts'), where('status', '==', 'active'));
  }, [firestore, firebaseUser, isUserLoading, isAuthorized]);
  const { data: activeContracts } = useCollection<MainContract>(contractsQuery as any);
  const quotationsQuery = useMemoFirebase(() => {
    if (!firestore || isUserLoading || !firebaseUser || !isAuthorized) return null;
    return query(collection(firestore, 'quotations'), where('status', 'in', ['sent', 'accepted']));
  }, [firestore, firebaseUser, isUserLoading, isAuthorized]);
  const { data: eligibleQuotations } = useCollection<Quotation>(quotationsQuery as any);

  useEffect(() => {
    if (newPO.poType !== 'contract') return;
    const selectedContract = activeContracts?.find((c) => c.id === newPO.contractId);
    if (!selectedContract) return;
    if (newPO.customerId !== selectedContract.customerId) {
      setNewPO((prev) => ({ ...prev, customerId: selectedContract.customerId }));
    }
  }, [newPO.poType, newPO.contractId, activeContracts, newPO.customerId]);

  useEffect(() => {
    if (newPO.poType !== 'quotation') return;
    const selectedQuotation = eligibleQuotations?.find((q) => q.id === newPO.quotationId);
    if (!selectedQuotation) return;
    const projectedStart = selectedQuotation.issueDate ? new Date(selectedQuotation.issueDate).getTime() : newPO.startDate;
    const projectedEnd = selectedQuotation.validUntilDate ? new Date(selectedQuotation.validUntilDate).getTime() : newPO.endDate;
    setNewPO((prev) => ({
      ...prev,
      customerId: selectedQuotation.customerId,
      title: prev.title || selectedQuotation.projectTitle || '',
      projectName: prev.projectName || selectedQuotation.projectTitle || '',
      startDate: Number.isFinite(projectedStart) ? projectedStart : prev.startDate,
      endDate: Number.isFinite(projectedEnd) ? projectedEnd : prev.endDate,
    }));
  }, [newPO.poType, newPO.quotationId, eligibleQuotations]);

  const handleCreate = async () => {
    if (!firestore || !currentUser) return;
    
    if (!newPO.title || !newPO.customerId) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาระบุชื่อโครงการ และลูกค้า" });
      return;
    }
    if (newPO.poType === 'contract' && !newPO.contractId) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "PO แบบตามสัญญาต้องเลือกสัญญาหลักที่ active" });
      return;
    }
    if (newPO.poType === 'quotation' && !newPO.quotationId) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "PO แบบอ้างอิงใบเสนอราคาต้องเลือกใบเสนอราคาก่อน" });
      return;
    }
    if (newPO.poType === 'quotation' && newPO.customerId) {
      const hasActiveContract = (activeContracts || []).some((c) => c.customerId === newPO.customerId);
      if (hasActiveContract) {
        if (!confirm('ลูกค้านี้มีสัญญาหลัก (Active) อยู่แล้ว\n\nต้องการสร้าง PO จากใบเสนอราคาแยกต่างหาก (งานรับจ้าง/ขายของ) ใช่หรือไม่?')) {
          return;
        }
      }
    }

    setIsCreating(true);
    try {
      // 1. Atomic Number Generation
      const { code: finalNo } = await generateNextDocumentCode(firestore, 'customer_po', { 
        actor: currentUser.displayName 
      });

      // 2. Create the document
      const colRef = collection(firestore, 'purchase_orders');
      const docRef = await addDocumentNonBlocking(colRef, {
        ...newPO,
        contractId: newPO.poType === 'contract' ? (newPO.contractId || '') : '',
        quotationId: newPO.poType === 'quotation' ? (newPO.quotationId || '') : '',
        poCode: finalNo, // Apply final unique code
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      
      setIsCreateOpen(false);
      toast({ title: "สร้างใบสั่งซื้อสำเร็จ", description: `Internal Code: ${finalNo}` });
      
      if (docRef) {
        router.push(`/purchase-orders/${docRef.id}`);
      }
    } catch (error) {
      console.error(error);
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถสร้างใบสั่งซื้อได้" });
    } finally {
      setIsCreating(false);
    }
  };

  if (isUserLoading || userLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        {/* 1. Page Header & Description */}
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <ShoppingCart className="h-8 w-8" /> ใบสั่งซื้อลูกค้า (Customer POs Management)
          </h1>
          <p className="text-muted-foreground text-lg">
            จัดการใบสั่งซื้อบริการกำลังคน (Client Issued POs) โควต้าพนักงานรายตำแหน่ง และราคาสรุปรายโครงการ
          </p>
        </div>

        {/* 2. Operational Notice Box */}
        <Alert className="bg-primary/5 border-primary/20 shadow-sm">
          <Info className="h-5 w-5 text-primary" />
          <AlertTitle className="font-bold text-lg">การสร้าง PO ตามเอกสารต้นทาง (Source-locked Policy)</AlertTitle>
          <AlertDescription className="text-sm">
            PO จะสร้างได้จาก <b>สัญญา</b> หรือ <b>ใบเสนอราคา</b> เท่านั้น เพื่อให้ข้อมูลเชื่อมต่อถึงบัญชี/ใบแจ้งหนี้ได้ต่อเนื่อง และป้องกัน PO ลอยที่ไม่อ้างอิงเอกสารต้นทาง
          </AlertDescription>
        </Alert>

        {/* 3. Action Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="ค้นหาเลขที่ PO หรือ ชื่อโครงการ..." className="pl-9 h-11" />
            </div>
            <Button variant="outline" className="h-11 gap-2"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
          </div>
          
          <Dialog open={canCreatePO && isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 h-11 px-6 bg-primary shadow-md text-base font-bold" disabled={!canCreatePO}>
                <Plus className="h-5 w-5" /> สร้าง Customer PO ใหม่ (New PO)
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto grid-cols-1">
              <div className="flex min-w-0 flex-col gap-4">
              <DialogHeader>
                <DialogTitle>ลงทะเบียนใบสั่งซื้อใหม่ (New Customer PO Registration)</DialogTitle>
                <DialogDescription>เลือกบริษัทคู่ค้าและสัญญาหลักที่เกี่ยวข้องเพื่อทำการจองโควต้าพนักงาน</DialogDescription>
              </DialogHeader>
              <Alert className="w-full">
                <Info className="h-4 w-4" />
                <AlertDescription>
                  PO ออกได้จาก <b>สัญญา</b> หรือ <b>ใบเสนอราคา</b> เท่านั้น ถ้าลูกค้ามีสัญญา Active อยู่แล้ว ให้สร้างจากสัญญาโดยตรง
                  หากยังไม่มีสัญญา ต้องมีใบเสนอราคาก่อนจึงจะเปิด PO ได้
                </AlertDescription>
              </Alert>
              <div className="grid grid-cols-2 gap-4 py-4">
                <div className="grid gap-2 col-span-2">
                  <Label>หัวข้อใบสั่งซื้อ (PO Subject/Title)</Label>
                  <Input value={newPO.title || ''} onChange={e => setNewPO({...newPO, title: e.target.value})} placeholder="เช่น โครงการบำรุงรักษา Shutdown ประจำปี 2024" />
                </div>
                <div className="grid gap-2">
                  <Label>เลขที่อ้างอิงภายใน (Internal PO Code)</Label>
                  <Input 
                    value={newPO.poCode} 
                    disabled 
                    className="bg-muted font-mono font-bold text-primary" 
                  />
                  <p className="text-[10px] text-muted-foreground italic">* ระบบจะรันเลขที่จริงให้อัตโนมัติเมื่อกดบันทึก</p>
                </div>
                <div className="grid gap-2">
                  <Label>ชื่อโครงการเฉพาะทาง (Project Name)</Label>
                  <Input value={newPO.projectName || ''} onChange={e => setNewPO({...newPO, projectName: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label>เลขที่เอกสาร PO ของลูกค้า (External PO No.)</Label>
                  <Input
                    value={newPO.customerPONumber || ''}
                    onChange={e => setNewPO({...newPO, customerPONumber: e.target.value})}
                    placeholder="เช่น PO-CLIENT-2026-00123"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>แหล่งที่มาเอกสาร (PO Source)</Label>
                  <Select
                    onValueChange={(v: 'contract' | 'quotation') => setNewPO({
                      ...newPO,
                      poType: v,
                      contractId: '',
                      quotationId: '',
                      customerId: '',
                    })}
                    value={(newPO.poType as any) || 'contract'}
                  >
                    <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="contract">ตามสัญญาหลัก (Contract-based)</SelectItem>
                      <SelectItem value="quotation">ตามใบเสนอราคา (Quotation-based)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>อ้างอิงสัญญาหลัก</Label>
                  <Select
                    onValueChange={v => setNewPO({...newPO, contractId: v})}
                    value={newPO.contractId || ''}
                    disabled={newPO.poType !== 'contract'}
                  >
                    <SelectTrigger className="h-11"><SelectValue placeholder="เลือกสัญญาหลักที่ Active..." /></SelectTrigger>
                    <SelectContent>
                      {activeContracts?.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.contractNumber} - {c.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>อ้างอิงใบเสนอราคา</Label>
                  <Select
                    onValueChange={v => setNewPO({...newPO, quotationId: v})}
                    value={newPO.quotationId || ''}
                    disabled={newPO.poType !== 'quotation'}
                  >
                    <SelectTrigger className="h-11"><SelectValue placeholder="เลือกใบเสนอราคาที่ sent/accepted..." /></SelectTrigger>
                    <SelectContent>
                      {eligibleQuotations?.map(q => (
                        <SelectItem key={q.id} value={q.id}>{q.quotationNo} - {q.projectTitle}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2 col-span-2">
                  <Label>ลูกค้า (Customer)</Label>
                  <Input
                    disabled
                    value={customers?.find((c) => c.id === newPO.customerId)?.name || 'ระบบจะดึงจากเอกสารต้นทางอัตโนมัติ'}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>วันที่เริ่มโครงการ (Start Date)</Label>
                  <DatePickerThaiBE
                    value={newPO.startDate}
                    onChange={(ms) => setNewPO({ ...newPO, startDate: ms })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>วันที่สิ้นสุดโครงการ (End Date)</Label>
                  <DatePickerThaiBE
                    value={newPO.endDate}
                    onChange={(ms) => setNewPO({ ...newPO, endDate: ms })}
                  />
                </div>
                <div className="grid gap-2 col-span-2">
                  <Label>รายละเอียดเพิ่มเติม</Label>
                  <Textarea value={newPO.description || ''} onChange={e => setNewPO({...newPO, description: e.target.value})} />
                </div>
              </div>
              <DialogFooter className="w-full sm:justify-end">
                <Button variant="outline" onClick={() => setIsCreateOpen(false)} disabled={isCreating}>ยกเลิก</Button>
                <Button
                  onClick={handleCreate}
                  className="bg-primary font-bold"
                  disabled={
                    isCreating
                    || !newPO.title
                    || !newPO.customerId
                    || (newPO.poType === 'contract' && !newPO.contractId)
                    || (newPO.poType === 'quotation' && !newPO.quotationId)
                  }
                >
                  {isCreating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  ยืนยันและไปจัดการรายการโควต้า (Confirm)
                </Button>
              </DialogFooter>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* 4. Data Content */}
        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isPOLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลใบสั่งซื้อ (Loading Customer POs)...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4 pl-6">รหัส PO (Code)</TableHead>
                    <TableHead className="font-bold">ลูกค้า (Client Name)</TableHead>
                    <TableHead className="font-bold">โครงการ (Project Context)</TableHead>
                    <TableHead className="font-bold">ระยะเวลาปฏิบัติงาน (Period)</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pos?.map((po) => {
                    const customer = customers?.find(c => c.id === po.customerId);
                    return (
                      <TableRow 
                        key={po.id} 
                        className="cursor-pointer hover:bg-muted/50 group transition-all"
                        onClick={() => router.push(`/purchase-orders/${po.id}`)}
                      >
                        <TableCell className="py-4 pl-6 font-mono text-xs font-bold text-primary">{po.poCode}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-sm text-primary font-bold">
                            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                            {customer?.name || 'N/A'}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium text-sm text-primary">{po.title}</span>
                            <span className="text-[10px] text-muted-foreground uppercase">{po.projectName || 'General Project'}</span>
                            {po.customerPONumber && (
                              <span className="text-[10px] text-slate-500">Customer PO: {po.customerPONumber}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs font-medium text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {formatDateRangeThaiBE(po.startDate, po.endDate)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={po.status === 'active' ? 'default' : 'secondary'} className={po.status === 'active' ? 'bg-green-600' : ''}>
                            {po.status.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <ChevronRight className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity ml-auto" />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!isPOLoading && (!pos || pos.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-20 text-muted-foreground italic">ไม่พบข้อมูลใบสั่งซื้อลูกค้าในระบบ</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* 5. Next-Step Guidance */}
        <Card className="bg-primary/5 border-primary/10 border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2 text-primary font-bold">
              <Info className="h-5 w-5" /> แนวทางปฏิบัติถัดไป (Workflow Guidance)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="flex items-start gap-3 p-4 bg-white rounded-md border shadow-sm">
                <div className="bg-primary/10 p-2 rounded text-primary font-bold">1</div>
                <div>
                  <p className="font-bold">ระบุรายการสั่งจอง (Manage PO Lines)</p>
                  <p className="text-muted-foreground text-xs">
                    สายสัญญา: เพิ่มโควต้า → Wave → มอบหมาย / สายใบเสนอราคา: ขายสินค้าหรือบริการครั้งเดียวจบ (ไม่ใช้ Wave) ส่งมอบแล้ววางบิล — ทั้งสองสายต้องมี Sales Term และใบวางบิลผูก PO ก่อนออกใบกำกับ
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 bg-white rounded-md border shadow-sm">
                <div className="bg-primary/10 p-2 rounded text-primary font-bold">2</div>
                <div>
                  <p className="font-bold">สร้าง Wave แล้วมอบหมายคนงาน (Wave → Assignments)</p>
                  <p className="text-muted-foreground text-xs">
                    สร้างหรือเลือก Wave ที่ผูกกับ PO/PO Line ของใบสั่งซื้อนี้ จากนั้นไปที่การมอบหมาย เลือก Wave แล้วส่งรายชื่อคนงานที่พร้อม (Ready) — การมอบหมายไม่ได้ผูกกับ PO Line โดยตรง
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter className="pt-0 justify-end gap-2 flex-wrap">
            <Button variant="link" className="gap-2 text-primary font-bold" asChild>
              <a href="/waves">ไปยังระบบ Waves (เวฟ) <ArrowRight className="h-4 w-4" /></a>
            </Button>
            <Button variant="link" className="gap-2 text-primary font-bold" asChild>
              <a href="/assignments">ไปยังระบบการมอบหมายงาน (Assignments) <ArrowRight className="h-4 w-4" /></a>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </AppShell>
  );
}

export default function CustomerPOsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground text-sm">
          กำลังโหลดหน้าใบสั่งซื้อ…
        </div>
      }
    >
      <CustomerPOsPageContent />
    </Suspense>
  );
}
