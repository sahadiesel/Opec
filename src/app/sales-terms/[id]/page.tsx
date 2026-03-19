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
  Scale, 
  Building2, 
  Calendar, 
  ShoppingCart,
  History,
  Info,
  Loader2,
  TrendingUp,
  FileText,
  Calculator,
  Plus,
  CheckCircle2,
  XCircle
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useUser, useCollection } from '@/firebase';
import { doc, collection, query, where } from 'firebase/firestore';
import { updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { 
  SalesContractTerm, 
  User, 
  Customer, 
  PurchaseOrder,
  SalesContractStatus 
} from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePermissions } from '@/hooks/use-permissions';
import { RateConditionsEditor } from '@/components/commercial/rate-conditions-editor';

export default function SalesTermDetailPage({ params }: { params: Promise<{ id: string }> }) {
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

  const termRef = useMemoFirebase(() => (firestore ? doc(firestore, 'sales_contract_terms', id) : null), [firestore, id]);
  const { data: term, isLoading: isTermLoading } = useDoc<SalesContractTerm>(termRef as any);

  const customersQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'customers') : null), [firestore]);
  const { data: allCustomers } = useCollection<Customer>(customersQuery as any);

  const poQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'purchase_orders') : null), [firestore]);
  const { data: allPOs } = useCollection<PurchaseOrder>(poQuery as any);

  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<Partial<SalesContractTerm>>({});

  useEffect(() => {
    if (term) setFormData(term);
  }, [term]);

  const customer = allCustomers?.find(c => c.id === term?.customerId);
  const po = allPOs?.find(p => p.id === term?.purchaseOrderId);

  const handleSave = () => {
    if (!termRef || !currentUser || !can('sales_contract_terms').edit) return;
    updateDocumentNonBlocking(termRef, { ...formData, updatedAt: Date.now(), updatedBy: currentUser.displayName });
    setIsEditing(false);
    toast({ title: "บันทึกข้อมูลสำเร็จ" });
  };

  const handleUpdateStatus = (newStatus: SalesContractStatus) => {
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
            <Button variant="ghost" size="icon" onClick={() => router.push('/sales-terms')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Sales Term Detail (รายละเอียดเงื่อนไขการขาย)</h1>
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <span className="font-mono font-bold text-primary">{term.contractNo}</span>
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
            <TabsTrigger value="info" className="gap-2 py-2 px-6"><Info className="h-4 w-4" /> ข้อมูลทั่วไป</TabsTrigger>
            <TabsTrigger value="rates" className="gap-2 py-2 px-6"><TrendingUp className="h-4 w-4" /> อัตราและเงื่อนไข (Rates)</TabsTrigger>
            <TabsTrigger value="history" className="gap-2 py-2 px-6"><History className="h-4 w-4" /> ประวัติ</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="mt-6 space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2"><FileText className="h-5 w-5 text-primary" /> รายละเอียดเงื่อนไขหลัก</CardTitle>
                      <CardDescription>ระบุชื่อโครงการและข้อมูลอ้างอิงทางกฎหมาย</CardDescription>
                    </div>
                    {can('sales_contract_terms').edit && (
                      <Button variant="outline" onClick={() => setIsEditing(!isEditing)}>
                        {isEditing ? 'ยกเลิก' : 'แก้ไขข้อมูล'}
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2 md:col-span-2">
                        <Label className="font-bold">หัวข้อโครงการ (Title)</Label>
                        <Input disabled={!isEditing} value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} />
                      </div>
                      <div className="space-y-2">
                        <Label className="font-bold">ลูกค้า (Customer)</Label>
                        <Input disabled value={customer?.name || 'N/A'} className="bg-muted/50" />
                      </div>
                      <div className="space-y-2">
                        <Label className="font-bold">ใบสั่งซื้ออ้างอิง (PO Reference)</Label>
                        <Input disabled value={po?.poCode || 'General Terms'} className="bg-muted/50 font-mono" />
                      </div>
                      <div className="space-y-2">
                        <Label className="font-bold">วันที่เริ่มมีผล (Effective Date)</Label>
                        <Input type="date" disabled={!isEditing} value={formData.effectiveDate} onChange={e => setFormData({...formData, effectiveDate: e.target.value})} />
                      </div>
                      <div className="space-y-2">
                        <Label className="font-bold">วันที่สิ้นสุด (Expiry Date)</Label>
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
                    <CardTitle className="text-lg flex items-center gap-2"><Calculator className="h-5 w-5 text-primary" /> นโยบายการเงิน (Financial Policy)</CardTitle>
                    <CardDescription>รอบการวางบิลและอัตราภาษีที่ใช้ในโครงการนี้</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <Label className="font-bold">รอบการวางบิล (Billing Cycle)</Label>
                        <Select disabled={!isEditing} value={formData.billingCycle} onValueChange={v => setFormData({...formData, billingCycle: v})}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Monthly">Monthly (รายเดือน)</SelectItem>
                            <SelectItem value="Bi-Weekly">Bi-Weekly (ทุก 2 สัปดาห์)</SelectItem>
                            <SelectItem value="Milestone">Milestone (ตามงวดงาน)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label className="font-bold">เครดิตเทอม (Payment Terms Days)</Label>
                        <Input type="number" disabled={!isEditing} value={formData.paymentTermsDays} onChange={e => setFormData({...formData, paymentTermsDays: parseInt(e.target.value)})} />
                      </div>
                      <div className="space-y-2">
                        <Label className="font-bold">ภาษีมูลค่าเพิ่ม (VAT %)</Label>
                        <Input type="number" disabled={!isEditing} value={formData.vatPercent} onChange={e => setFormData({...formData, vatPercent: parseFloat(e.target.value)})} />
                      </div>
                      <div className="space-y-2">
                        <Label className="font-bold">หัก ณ ที่จ่าย (WHT %)</Label>
                        <Input type="number" disabled={!isEditing} value={formData.withholdingTaxPercent} onChange={e => setFormData({...formData, withholdingTaxPercent: parseFloat(e.target.value)})} />
                      </div>
                    </div>
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
                        <CheckCircle2 className="h-4 w-4 mr-2" /> เปิดใช้งานเงื่อนไข (Activate)
                      </Button>
                    )}
                    {term.status === 'ACTIVE' && (
                      <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold" onClick={() => handleUpdateStatus('CLOSED')}>
                        <CheckCircle2 className="h-4 w-4 mr-2" /> ปิดการใช้งาน (Close)
                      </Button>
                    )}
                    <Button variant="ghost" className="w-full text-white/60 hover:text-white hover:bg-white/10" onClick={() => handleUpdateStatus('CANCELLED')}>
                      <XCircle className="h-4 w-4 mr-2" /> ยกเลิกรายการนี้
                    </Button>
                  </CardContent>
                </Card>

                <Card className="bg-muted/30 border-dashed">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Audit Context</CardTitle>
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
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">อัปเดตโดย:</span>
                      <span>{term.updatedBy}</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="rates" className="mt-6">
            <RateConditionsEditor 
              parentType="SALES_CONTRACT" 
              parentId={id} 
              appliesTo="SALES" 
              user={currentUser} 
            />
          </TabsContent>

          <TabsContent value="history" className="mt-6">
            <Card>
              <CardHeader><CardTitle>Audit History</CardTitle></CardHeader>
              <CardContent className="py-20 text-center text-muted-foreground italic">
                Logs will appear here once transactional data is established.
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
