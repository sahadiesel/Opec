'use client';

import { useState, useEffect, useMemo } from 'react';
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
  Calculator, 
  Building2, 
  ShoppingCart,
  Calendar,
  Info,
  Loader2,
  Trash2,
  Briefcase
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { LaborCostContractTerm, User, Customer, PurchaseOrder, LaborCostContractStatus, LaborScopeType } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
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

export default function LaborCostTermsPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const { can, isLoading: isPermLoading } = usePermissions(currentUser);

  const termsQuery = useMemoFirebase(() => {
    if (!firestore || !can('labor_cost_contract_terms').view) return null;
    return query(collection(firestore, 'labor_cost_contract_terms'), orderBy('createdAt', 'desc'));
  }, [firestore, can('labor_cost_contract_terms').view]);

  const { data: terms, isLoading } = useCollection<LaborCostContractTerm>(termsQuery as any);

  const canViewTerms = can('labor_cost_contract_terms').view;
  const customersQuery = useMemoFirebase(() => {
    if (!firestore || !canViewTerms) return null;
    return collection(firestore, 'customers');
  }, [firestore, canViewTerms]);
  const { data: customers } = useCollection<Customer>(customersQuery as any);

  const poQuery = useMemoFirebase(() => {
    if (!firestore || !canViewTerms) return null;
    return collection(firestore, 'purchase_orders');
  }, [firestore, canViewTerms]);
  const { data: allPOs } = useCollection<PurchaseOrder>(poQuery as any);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newTerm, setNewTerm] = useState<Partial<LaborCostContractTerm>>({
    id: getPreviewPattern('cost_term'),
    status: 'DRAFT',
    scopeType: 'SPECIFIC_PO',
    effectiveDate: new Date().toISOString().split('T')[0],
    endDate: new Date(Date.now() + 31536000000).toISOString().split('T')[0]
  });

  const handleCreate = async () => {
    if (!firestore || !currentUser) return;
    if (!newTerm.relatedCustomerId || !newTerm.title) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาระบุลูกค้าและชื่อเงื่อนไข" });
      return;
    }

    setIsCreating(true);
    try {
      const service = new ContractTermsService(firestore);
      const { code: finalNo } = await generateNextDocumentCode(firestore, 'cost_term', { actor: currentUser.displayName });

      const promise = await service.createLaborCostTerm({
        ...newTerm,
        id: finalNo,
      }, currentUser);

      const docRef = await promise;
      setIsDialogOpen(false);
      toast({ title: "สร้างเงื่อนไขต้นทุนสำเร็จ", description: `รหัส: ${finalNo}` });
      if (docRef) router.push(`/labor-cost-terms/${docRef.id}`);
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถบันทึกข้อมูลได้" });
    } finally {
      setIsCreating(false);
    }
  };

  const getStatusBadge = (status: LaborCostContractStatus) => {
    switch (status) {
      case 'DRAFT': return <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200">DRAFT</Badge>;
      case 'ACTIVE': return <Badge className="bg-green-600">ACTIVE</Badge>;
      case 'EXPIRED': return <Badge variant="destructive">EXPIRED</Badge>;
      case 'CLOSED': return <Badge variant="secondary">CLOSED</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getScopeBadge = (scope: LaborScopeType) => {
    switch (scope) {
      case 'SPECIFIC_PO': return <Badge variant="outline" className="bg-blue-50 text-blue-700">Specific PO</Badge>;
      case 'GENERAL_CUSTOMER': return <Badge variant="outline" className="bg-purple-50 text-purple-700">General Client</Badge>;
      case 'PROJECT_BASED': return <Badge variant="outline" className="bg-amber-50 text-amber-700">Project Based</Badge>;
      default: return <Badge variant="outline">{scope}</Badge>;
    }
  };

  if (isUserLoading || isPermLoading || !currentUser) return null;

  if (!can('labor_cost_contract_terms').view) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <Calculator className="h-12 w-12 text-destructive opacity-50" />
          <h2 className="text-xl font-bold">Access Denied</h2>
          <p className="text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงส่วนงานจัดการเงื่อนไขต้นทุนแรงงาน</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <Calculator className="h-8 w-8 text-primary" /> เงื่อนไขต้นทุนแรงงาน (Labor Cost Terms)
          </h1>
          <p className="text-muted-foreground text-lg">
            กำหนดโครงสร้างการจ่ายเงินคนงาน (Internal Cost) และเงื่อนไขเบี้ยเลี้ยง/OT สำหรับการคำนวณ Payroll
          </p>
        </div>

        <Alert className="bg-blue-50 border-blue-200 text-blue-800 shadow-sm">
          <Info className="h-5 w-5 text-blue-600" />
          <AlertTitle className="font-bold">Labor Cost Integrity (ความถูกต้องของต้นทุน)</AlertTitle>
          <AlertDescription className="text-sm">
            เงื่อนไขเหล่านี้คือหัวใจของการคำนวณเงินเดือนคนงาน (Internal Payroll) และการวิเคราะห์กำไรเบื้องต้น (GP Analysis)
          </AlertDescription>
        </Alert>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="ค้นหารหัส หรือ ชื่อเงื่อนไขต้นทุน..." className="pl-9 h-11" />
            </div>
            <Button variant="outline" className="h-11 gap-2"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
          </div>
          
          {can('labor_cost_contract_terms').create && (
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2 h-11 px-6 bg-primary shadow-md text-base font-bold">
                  <Plus className="h-5 w-5" /> สร้างเงื่อนไขใหม่ (Add Cost Terms)
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-xl">
                <DialogHeader>
                  <DialogTitle>สร้างเงื่อนไขต้นทุนใหม่</DialogTitle>
                  <DialogDescription>ระบุโครงสร้างต้นทุนและขอบเขตการใช้งาน ระบบจะรันเลขที่อัตโนมัติเมื่อกดบันทึก</DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                  <div className="space-y-2 md:col-span-2">
                    <Label className="font-bold">ชื่อเรียกเงื่อนไข (Term Title)</Label>
                    <Input value={newTerm.title} onChange={e => setNewTerm({...newTerm, title: e.target.value})} placeholder="เช่น Standard Cost Terms - PTT Project" />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label className="font-bold">รหัสอ้างอิง (Internal ID)</Label>
                    <Input value={newTerm.id} disabled className="bg-muted/50 font-mono font-bold" />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label className="font-bold">ขอบเขตการใช้งาน (Scope)</Label>
                    <Select onValueChange={(v: LaborScopeType) => setNewTerm({...newTerm, scopeType: v})} value={newTerm.scopeType}>
                      <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="SPECIFIC_PO">Specific PO (เฉพาะใบสั่งซื้อนี้)</SelectItem>
                        <SelectItem value="GENERAL_CUSTOMER">General Customer (เหมาทั้งลูกค้า)</SelectItem>
                        <SelectItem value="PROJECT_BASED">Project Based (ตามกลุ่มโครงการ)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label className="font-bold">ลูกค้าที่เกี่ยวข้อง (Related Client)</Label>
                    <Select onValueChange={v => setNewTerm({...newTerm, relatedCustomerId: v})}>
                      <SelectTrigger className="h-11"><SelectValue placeholder="เลือกบริษัทลูกค้า..." /></SelectTrigger>
                      <SelectContent>
                        {customers?.map(c => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">วันที่เริ่ม (Effective)</Label>
                    <Input type="date" value={newTerm.effectiveDate} onChange={e => setNewTerm({...newTerm, effectiveDate: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">วันที่สิ้นสุด (Expiry)</Label>
                    <Input type="date" value={newTerm.endDate} onChange={e => setNewTerm({...newTerm, endDate: e.target.value})} />
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
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลเงื่อนไขต้นทุน...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4 pl-6">รหัส (No.)</TableHead>
                    <TableHead className="font-bold">ชื่อเงื่อนไข / โครงการ</TableHead>
                    <TableHead className="font-bold">ขอบเขต (Scope)</TableHead>
                    <TableHead className="font-bold">ลูกค้า (Client)</TableHead>
                    <TableHead className="font-bold">ระยะเวลา (Period)</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {terms?.map((term) => {
                    const customer = customers?.find(c => c.id === term.relatedCustomerId);
                    return (
                      <TableRow 
                        key={term.id} 
                        className="cursor-pointer hover:bg-muted/30 group transition-all" 
                        onClick={() => router.push(`/labor-cost-terms/${term.id}`)}
                      >
                        <TableCell className="py-4 pl-6 font-bold text-primary font-mono">{term.id}</TableCell>
                        <TableCell className="text-sm font-bold text-primary">{term.title}</TableCell>
                        <TableCell>{getScopeBadge(term.scopeType)}</TableCell>
                        <TableCell>
                          <span className="text-xs flex items-center gap-1 font-medium">
                            <Building2 className="h-3 w-3 text-muted-foreground" /> {customer?.name || 'N/A'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-medium">
                            <Calendar className="h-3 w-3" />
                            {term.effectiveDate} - {term.endDate}
                          </div>
                        </TableCell>
                        <TableCell>{getStatusBadge(term.status)}</TableCell>
                        <TableCell className="text-right pr-6">
                          <Button variant="ghost" size="icon" className="group-hover:text-primary"><ChevronRight className="h-5 w-5" /></Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {(!terms || terms.length === 0) && !isLoading && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-20 text-muted-foreground italic">ไม่มีรายการเงื่อนไขต้นทุน</TableCell>
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
