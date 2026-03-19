'use client';

import { useState, use, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  ArrowLeft, 
  Save, 
  Calculator, 
  Building2, 
  Calendar, 
  ShoppingCart,
  History,
  Info,
  Loader2,
  Coins,
  FileText,
  Plus,
  Briefcase,
  CheckCircle2
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useUser, useCollection } from '@/firebase';
import { doc, collection, query, where } from 'firebase/firestore';
import { updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { 
  LaborCostContractTerm, 
  RateCondition, 
  User, 
  Customer, 
  PurchaseOrder,
  LaborCostContractStatus,
  LaborScopeType 
} from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePermissions } from '@/hooks/use-permissions';
import { RateConditionsEditor } from '@/components/commercial/rate-conditions-editor';

export default function LaborCostTermDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const { can, isLoading: isPermLoading } = usePermissions(currentUser);

  const termRef = useMemoFirebase(() => (firestore ? doc(firestore, 'labor_cost_contract_terms', id) : null), [firestore, id]);
  const { data: term, isLoading: isTermLoading } = useDoc<LaborCostContractTerm>(termRef as any);

  const customersQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'customers') : null), [firestore]);
  const { data: allCustomers } = useCollection<Customer>(customersQuery as any);

  const poQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'purchase_orders') : null), [firestore]);
  const { data: allPOs } = useCollection<PurchaseOrder>(poQuery as any);

  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<Partial<LaborCostContractTerm>>({});

  useEffect(() => {
    if (term) setFormData(term);
  }, [term]);

  const customer = allCustomers?.find(c => c.id === term?.relatedCustomerId);
  const po = allPOs?.find(p => p.id === term?.relatedPurchaseOrderId);

  const handleSave = () => {
    if (!termRef || !currentUser || !can('labor_cost_contract_terms').edit) return;
    updateDocumentNonBlocking(termRef, { ...formData, updatedAt: Date.now(), updatedBy: currentUser.displayName });
    setIsEditing(false);
    toast({ title: "บันทึกข้อมูลสำเร็จ" });
  };

  const handleUpdateStatus = (newStatus: LaborCostContractStatus) => {
    if (!termRef) return;
    updateDocumentNonBlocking(termRef, { status: newStatus, updatedAt: Date.now() });
    toast({ title: "อัปเดตสถานะสำเร็จ", description: `เปลี่ยนสถานะเป็น ${newStatus}` });
  };

  if (isTermLoading || isPermLoading || !term || !currentUser) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-12 w-12 text-primary animate-spin" /></div>;
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.push('/labor-cost-terms')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Labor Cost Term Detail (รายละเอียดเงื่อนไขต้นทุน)</h1>
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <span className="font-mono font-bold text-primary">{term.id}</span>
                <Separator orientation="vertical" className="h-3" />
                <span>ลูกค้า: {customer?.name || '...'}</span>
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" className="py-1.5 px-4 font-bold border-primary/20 bg-primary/5 text-primary uppercase">
              STATUS: {term.status}
            </Badge>
          </div>
        </div>

        <Tabs defaultValue="info" className="w-full">
          <TabsList className="grid grid-cols-3 w-full md:w-[600px] h-auto p-1 bg-muted/50">
            <TabsTrigger value="info" className="gap-2 py-2 px-6"><Info className="h-4 w-4" /> ข้อมูลขอบเขต</TabsTrigger>
            <TabsTrigger value="costs" className="gap-2 py-2 px-6"><Coins className="h-4 w-4" /> อัตราต้นทุน (Costs)</TabsTrigger>
            <TabsTrigger value="history" className="gap-2 py-2 px-6"><History className="h-4 w-4" /> ประวัติ</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="mt-6 space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between border-b bg-muted/5 pb-4">
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2"><Calculator className="h-5 w-5 text-primary" /> ขอบเขตต้นทุน (Labor Scope)</CardTitle>
                      <CardDescription>ระบุโครงการและขอบเขตพนักงานที่ใช้เงื่อนไขนี้</CardDescription>
                    </div>
                    {can('labor_cost_contract_terms').edit && (
                      <Button variant="outline" size="sm" onClick={() => setIsEditing(!isEditing)}>
                        {isEditing ? 'ยกเลิก' : 'แก้ไขข้อมูล'}
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent className="pt-6 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2 md:col-span-2">
                        <Label className="font-bold">ชื่อเงื่อนไขต้นทุน (Term Title)</Label>
                        <Input disabled={!isEditing} value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} />
                      </div>
                      <div className="space-y-2">
                        <Label className="font-bold">ประเภทขอบเขต (Scope Type)</Label>
                        <Select disabled={!isEditing} value={formData.scopeType} onValueChange={(v: LaborScopeType) => setFormData({...formData, scopeType: v})}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="SPECIFIC_PO">Specific PO (เฉพาะใบสั่งซื้อนี้)</SelectItem>
                            <SelectItem value="GENERAL_CUSTOMER">General Customer (เหมาทั้งลูกค้า)</SelectItem>
                            <SelectItem value="PROJECT_BASED">Project Based (ตามกลุ่มโครงการ)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label className="font-bold">ใบสั่งซื้อที่อ้างอิง (Linked PO)</Label>
                        <Input disabled value={po?.poCode || 'General Client Terms'} className="bg-muted/50 font-mono" />
                      </div>
                      <div className="space-y-2">
                        <Label className="font-bold">วันที่เริ่มใช้ (Effective)</Label>
                        <Input type="date" disabled={!isEditing} value={formData.effectiveDate} onChange={e => setFormData({...formData, effectiveDate: e.target.value})} />
                      </div>
                      <div className="space-y-2">
                        <Label className="font-bold">วันที่สิ้นสุด (Expiry)</Label>
                        <Input type="date" disabled={!isEditing} value={formData.endDate} onChange={e => setFormData({...formData, endDate: e.target.value})} />
                      </div>
                    </div>
                    {isEditing && (
                      <div className="flex justify-end pt-4 border-t">
                        <Button className="gap-2 bg-primary font-bold shadow-md" onClick={handleSave}>
                          <Save className="h-4 w-4" /> บันทึกการเปลี่ยนแปลง
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2"><Info className="h-5 w-5 text-primary" /> หมายเหตุเพิ่มเติม</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Input disabled={!isEditing} value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} placeholder="ระบุเหตุผลในการใช้เงื่อนไขต้นทุนชุดนี้..." />
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-6">
                <Card className="bg-primary text-primary-foreground shadow-lg overflow-hidden border-none">
                  <CardHeader className="pb-4 border-b border-white/10">
                    <CardTitle className="text-sm font-bold uppercase tracking-wider opacity-80">การดำเนินการ (Workflow)</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6 space-y-3">
                    {term.status === 'DRAFT' && (
                      <Button className="w-full bg-white text-primary hover:bg-slate-100 font-bold" onClick={() => handleUpdateStatus('ACTIVE')}>
                        <CheckCircle2 className="h-4 w-4 mr-2" /> เปิดใช้งาน (Activate)
                      </Button>
                    )}
                    <Button variant="ghost" className="w-full text-white/60 hover:text-white hover:bg-white/10" onClick={() => handleUpdateStatus('CLOSED')}>
                      ปิดการใช้งานชั่วคราว
                    </Button>
                  </CardContent>
                </Card>

                <Card className="bg-muted/30 border-dashed">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Internal Audit</CardTitle>
                  </CardHeader>
                  <CardContent className="text-[10px] space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">สร้างโดย:</span>
                      <span className="font-bold">{term.createdBy}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">วันที่สร้าง:</span>
                      <span>{new Date(term.createdAt).toLocaleDateString()}</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="costs" className="mt-6">
            <RateConditionsEditor 
              parentType="LABOR_COST_CONTRACT" 
              parentId={id} 
              appliesTo="COST" 
              user={currentUser} 
            />
          </TabsContent>

          <TabsContent value="history" className="mt-6">
            <Card>
              <CardHeader><CardTitle>Audit Trail</CardTitle></CardHeader>
              <CardContent className="py-20 text-center text-muted-foreground italic">
                Detailed cost adjustment logs will appear here.
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
