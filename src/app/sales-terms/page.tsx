'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Plus, 
  Search, 
  Filter, 
  ChevronRight, 
  Scale, 
  Building2, 
  ShoppingCart,
  Calendar,
  Info,
  Loader2,
  Trash2
} from 'lucide-react';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { Input } from '@/components/ui/input';
import {
  htmlDateValueToTimestampMs,
  timestampToHtmlDateValue,
  formatYmdLocalThaiBE,
} from '@/lib/date-thai';
import { SalesContractTerm, User, Customer, PurchaseOrder, SalesContractStatus } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, orderBy, doc } from 'firebase/firestore';
import { deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription,
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';
import { ContractTermsService } from '@/lib/services/contract-terms-service';
import { usePermissions } from '@/hooks/use-permissions';
import { useAppUser } from '@/hooks/use-app-user';

export default function SalesTermsPage() {
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const { can, isLoading: isPermLoading } = usePermissions(currentUser);

  const termsQuery = useMemoFirebase(() => {
    if (!firestore || !can('sales_contract_terms').view) return null;
    return query(collection(firestore, 'sales_contract_terms'), orderBy('createdAt', 'desc'));
  }, [firestore, can('sales_contract_terms').view]);

  const { data: terms, isLoading } = useCollection<SalesContractTerm>(termsQuery as any);

  const customersQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'customers') : null), [firestore]);
  const { data: customers } = useCollection<Customer>(customersQuery as any);

  const poQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'purchase_orders') : null), [firestore]);
  const { data: allPOs } = useCollection<PurchaseOrder>(poQuery as any);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newTerm, setNewTerm] = useState<Partial<SalesContractTerm>>({
    contractNo: getPreviewPattern('sales_term'),
    status: 'DRAFT',
    currency: 'THB',
    billingCycle: 'Monthly',
    paymentTermsDays: 30,
    vatPercent: 7,
    withholdingTaxPercent: 3,
    effectiveDate: timestampToHtmlDateValue(Date.now()),
    endDate: timestampToHtmlDateValue(Date.now() + 31536000000) // +1 year
  });

  const handleCreate = async () => {
    if (!firestore || !currentUser) return;
    if (!newTerm.customerId || !newTerm.title) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาระบุลูกค้าและชื่อเงื่อนไข" });
      return;
    }

    setIsCreating(true);
    try {
      const service = new ContractTermsService(firestore);
      const { code: finalNo } = await generateNextDocumentCode(firestore, 'sales_term', { actor: currentUser.displayName });

      const promise = await service.createSalesTerm({
        ...newTerm,
        contractNo: finalNo,
      }, currentUser);

      const docRef = await promise;
      setIsDialogOpen(false);
      toast({ title: "สร้างเงื่อนไขการขายสำเร็จ", description: `เลขที่: ${finalNo}` });
      if (docRef) router.push(`/sales-terms/${docRef.id}`);
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถบันทึกข้อมูลได้" });
    } finally {
      setIsCreating(false);
    }
  };

  const getStatusBadge = (status: SalesContractStatus) => {
    switch (status) {
      case 'DRAFT': return <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200">DRAFT</Badge>;
      case 'ACTIVE': return <Badge className="bg-green-600">ACTIVE</Badge>;
      case 'EXPIRED': return <Badge variant="destructive">EXPIRED</Badge>;
      case 'CLOSED': return <Badge variant="secondary">CLOSED</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!firestore) return;
    if (confirm('ยืนยันการลบเงื่อนไขการขายนี้?')) {
      deleteDocumentNonBlocking(doc(firestore, 'sales_contract_terms', id));
      toast({ title: "ลบข้อมูลสำเร็จ" });
    }
  };

  if (userLoading || isPermLoading || !currentUser) return null;

  if (!can('sales_contract_terms').view) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <Scale className="h-12 w-12 text-destructive opacity-50" />
          <h2 className="text-xl font-bold">Access Denied</h2>
          <p className="text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงส่วนงานจัดการเงื่อนไขการขาย</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <Scale className="h-8 w-8 text-primary" /> เงื่อนไขการขายตามโครงการ (Sales Contract Terms)
          </h1>
          <p className="text-muted-foreground text-lg">
            กำหนดนโยบายการวางบิล ภาษี และรอบการคิดเงินสำหรับแต่ละโครงการหรือใบสั่งซื้อ
          </p>
        </div>

        <Alert className="bg-primary/5 border-primary/20 shadow-sm">
          <Info className="h-5 w-5 text-primary" />
          <AlertTitle className="font-bold">Project Commercial Rule (นโยบายรายรับโครงการ)</AlertTitle>
          <AlertDescription className="text-sm">
            เงื่อนไขเหล่านี้จะถูกใช้เป็นฐานในการสร้าง <b>Billing Notes</b> และคำนวณรายได้ (Revenue) ในระบบบัญชีลูกหนี้
          </AlertDescription>
        </Alert>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="ค้นหาเลขที่สัญญา หรือ ชื่อเงื่อนไข..." className="pl-9 h-11" />
            </div>
            <Button variant="outline" className="h-11 gap-2"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
          </div>
          
          {can('sales_contract_terms').create && (
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2 h-11 px-6 bg-primary shadow-md text-base font-bold">
                  <Plus className="h-5 w-5" /> สร้างเงื่อนไขใหม่ (Add Terms)
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-xl">
                <DialogHeader>
                  <DialogTitle>สร้างเงื่อนไขการขายใหม่</DialogTitle>
                  <DialogDescription>ระบุข้อมูลหลักการวางบิลและภาษี ระบบจะรันเลขที่อัตโนมัติเมื่อกดบันทึก</DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                  <div className="space-y-2 md:col-span-2">
                    <Label>ชื่อเรียกเงื่อนไข / ชื่อโครงการ (Title)</Label>
                    <Input value={newTerm.title} onChange={e => setNewTerm({...newTerm, title: e.target.value})} placeholder="เช่น Sales Terms for Project ABC" />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>เลขที่บันทึก (Internal ID)</Label>
                    <Input value={newTerm.contractNo} disabled className="bg-muted/50 font-mono font-bold" />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>ลูกค้า (Customer)</Label>
                    <Select onValueChange={v => setNewTerm({...newTerm, customerId: v})}>
                      <SelectTrigger className="h-11"><SelectValue placeholder="เลือกบริษัทลูกค้า..." /></SelectTrigger>
                      <SelectContent>
                        {customers?.map(c => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>อ้างอิงใบสั่งซื้อ (Optional PO Ref)</Label>
                    <Select onValueChange={v => setNewTerm({...newTerm, purchaseOrderId: v})}>
                      <SelectTrigger className="h-11"><SelectValue placeholder="เชื่อมโยงกับ PO (ถ้ามี)..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">-- ไม่ระบุ --</SelectItem>
                        {allPOs?.map(po => (
                          <SelectItem key={po.id} value={po.id}>{po.poCode} | {po.title}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>วันที่เริ่มมีผล (Effective)</Label>
                    <DatePickerThaiBE
                      className="h-11"
                      value={htmlDateValueToTimestampMs(newTerm.effectiveDate)}
                      onChange={(ms) => setNewTerm({ ...newTerm, effectiveDate: timestampToHtmlDateValue(ms) })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>วันที่สิ้นสุด (Expiry)</Label>
                    <DatePickerThaiBE
                      className="h-11"
                      value={htmlDateValueToTimestampMs(newTerm.endDate)}
                      onChange={(ms) => setNewTerm({ ...newTerm, endDate: timestampToHtmlDateValue(ms) })}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isCreating}>ยกเลิก</Button>
                  <Button onClick={handleCreate} className="bg-primary font-bold" disabled={isCreating}>
                    {isCreating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    บันทึกข้อมูล (Confirm)
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลเงื่อนไขการขาย...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4 pl-6">เลขที่ (No.)</TableHead>
                    <TableHead className="font-bold">ลูกค้า / โครงการ</TableHead>
                    <TableHead className="font-bold">ระยะเวลาที่ใช้ (Validity)</TableHead>
                    <TableHead className="font-bold">นโยบายวางบิล</TableHead>
                    <TableHead className="font-bold text-center">VAT/WHT</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {terms?.map((term) => {
                    const customer = customers?.find(c => c.id === term.customerId);
                    const po = allPOs?.find(p => p.id === term.purchaseOrderId);
                    return (
                      <TableRow 
                        key={term.id} 
                        className="cursor-pointer hover:bg-muted/30 group transition-all" 
                        onClick={() => router.push(`/sales-terms/${term.id}`)}
                      >
                        <TableCell className="py-4 pl-6 font-bold text-primary font-mono">{term.contractNo}</TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-primary flex items-center gap-1">
                              <Building2 className="h-3 w-3 text-muted-foreground" /> {customer?.name || 'N/A'}
                            </span>
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <ShoppingCart className="h-2.5 w-2.5" /> {po?.poCode || term.title}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-medium">
                            <Calendar className="h-3 w-3" />
                            {formatYmdLocalThaiBE(term.effectiveDate)} ถึง {formatYmdLocalThaiBE(term.endDate)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col text-xs">
                            <span className="font-medium">{term.billingCycle}</span>
                            <span className="text-[10px] text-muted-foreground">Credit: {term.paymentTermsDays} Days</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex justify-center gap-1.5">
                            <Badge variant="outline" className="text-[9px] px-1.5 h-5">{term.vatPercent}% VAT</Badge>
                            <Badge variant="outline" className="text-[9px] px-1.5 h-5 border-amber-200 bg-amber-50 text-amber-700">{term.withholdingTaxPercent}% WHT</Badge>
                          </div>
                        </TableCell>
                        <TableCell>{getStatusBadge(term.status)}</TableCell>
                        <TableCell className="text-right pr-6">
                          <div className="flex justify-end gap-2">
                            {can('sales_contract_terms').delete && (
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100" onClick={(e) => handleDelete(term.id, e)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" className="group-hover:text-primary"><ChevronRight className="h-5 w-5" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {(!terms || terms.length === 0) && !isLoading && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-20 text-muted-foreground italic">ไม่มีรายการเงื่อนไขการขาย</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
