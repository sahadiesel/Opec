'use client';

import { useState, use, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { 
  ArrowLeft, 
  Save, 
  Loader2, 
  Building2,
  CreditCard,
  Phone,
  Mail,
  MapPin,
  Briefcase,
  History,
  ShieldCheck,
  Building
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useUser } from '@/firebase';
import { doc, collection, setDoc, updateDoc } from 'firebase/firestore';
import { Vendor, VendorType, VendorLegalForm, User } from '@/lib/types';

function normalizeVendorPaymentTerms(raw: string | undefined | null): 'Cash' | 'Credit' {
  const s = (raw || '').trim().toLowerCase();
  if (s === 'cash' || s === 'เงินสด') return 'Cash';
  return 'Credit';
}
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Link from 'next/link';
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';
import { formatDateTimeThaiBE } from '@/lib/date-thai';
import { useAppUser } from '@/hooks/use-app-user';
import { canView, canCreate, canEdit } from '@/lib/permissions';

export default function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const isNew = id === 'new';
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const canViewVendors = useMemo(() => canView(currentUser, 'vendors'), [currentUser]);
  const canCreateVendors = useMemo(() => canCreate(currentUser, 'vendors'), [currentUser]);
  const canEditVendors = useMemo(() => canEdit(currentUser, 'vendors'), [currentUser]);

  const vendorRef = useMemoFirebase(() => (firestore && !isNew ? doc(firestore, 'vendors', id) : null), [firestore, id, isNew]);
  const { data: vendorData, isLoading: isVendorLoading } = useDoc<Vendor>(vendorRef as any);

  const [formData, setFormData] = useState<Partial<Vendor>>({
    vendorCode: isNew ? getPreviewPattern('vendor') : '',
    vendorName: '',
    vendorLegalForm: 'JURISTIC',
    vendorType: 'GENERAL_SUPPLIER',
    taxId: '',
    branchType: 'head_office',
    branchNo: '',
    contactName: '',
    phone: '',
    email: '',
    address: '',
    paymentTerms: 'Credit' as const,
    creditDays: 30,
    defaultCurrency: 'THB',
    bankAccountName: '',
    bankAccountNumber: '',
    bankName: '',
    status: 'ACTIVE',
    notes: ''
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (vendorData) {
      setFormData({
        ...vendorData,
        vendorLegalForm: vendorData.vendorLegalForm ?? 'JURISTIC',
        branchType: vendorData.branchType || ((vendorData.branchNo || '00000') === '00000' ? 'head_office' : 'branch'),
        branchNo: (vendorData.branchNo || '00000') === '00000' ? '' : (vendorData.branchNo || ''),
        paymentTerms: normalizeVendorPaymentTerms(vendorData.paymentTerms),
      });
    }
  }, [vendorData]);

  const handleSave = async () => {
    if (!firestore || !currentUser) return;
    if ((isNew && !canCreateVendors) || (!isNew && !canEditVendors)) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์บันทึกข้อมูลคู่ค้า' });
      return;
    }
    if (!formData.vendorName) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาระบุชื่อบริษัท" });
      return;
    }

    setIsSubmitting(true);
    const now = Date.now();
    
    try {
      const legalForm = formData.vendorLegalForm ?? 'JURISTIC';
      const normalizedBranchNo =
        legalForm === 'NATURAL'
          ? '00000'
          : formData.branchType === 'branch'
            ? (formData.branchNo || '').trim()
            : '00000';
      if (legalForm === 'JURISTIC' && formData.branchType === 'branch' && !normalizedBranchNo) {
        toast({ variant: 'destructive', title: 'ข้อมูลไม่ครบ', description: 'กรุณาระบุเลขสาขา' });
        return;
      }
      const branchTypeToSave: 'head_office' | 'branch' =
        legalForm === 'NATURAL' ? 'head_office' : formData.branchType === 'branch' ? 'branch' : 'head_office';

      if (isNew) {
        // Atomic Code Generation
        const { code: finalCode } = await generateNextDocumentCode(firestore, 'vendor', { actor: currentUser.displayName });

        const newRef = doc(collection(firestore, 'vendors'));
        await setDoc(newRef, {
          ...formData,
          vendorLegalForm: legalForm,
          branchType: branchTypeToSave,
          branchNo: normalizedBranchNo,
          vendorCode: finalCode,
          id: newRef.id,
          createdAt: now,
          updatedAt: now,
        });
        toast({ title: "เพิ่มคู่ค้าสำเร็จ", description: `รหัสคู่ค้า: ${finalCode}` });
        router.push('/vendors');
      } else {
        await updateDoc(vendorRef!, {
          ...formData,
          vendorLegalForm: legalForm,
          branchType: branchTypeToSave,
          branchNo: normalizedBranchNo,
          updatedAt: now,
        });
        toast({ title: "อัปเดตข้อมูลสำเร็จ" });
        router.back();
      }
    } catch (e: unknown) {
      console.error(e);
      const code = e && typeof e === 'object' && 'code' in e ? String((e as { code?: string }).code) : '';
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message?: string }).message) : '';
      const hint =
        code === 'permission-denied'
          ? 'สิทธิ์ Firestore ไม่พอ — ให้แอดมิน deploy firestore.rules ล่าสุด หรือตรวจ users/{uid} (แผนกคลัง / store_officer)'
          : msg || 'ไม่สามารถบันทึกข้อมูลได้';
      toast({ variant: "destructive", title: "ไม่สามารถบันทึกข้อมูลได้", description: hint });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (userLoading) return null;
  if (!currentUser) return null;
  if (!canViewVendors) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-5xl mx-auto py-10 text-center text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงเมนูนี้</div>
      </AppShell>
    );
  }

  if (!isNew && isVendorLoading) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="animate-spin h-12 w-12 text-primary" /></div>;
  }

  return (
    <AppShell user={currentUser as User} onLogout={() => {}}>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.back()}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                {isNew ? 'ลงทะเบียนคู่ค้าใหม่ (Add New Vendor)' : `แก้ไขข้อมูลคู่ค้า: ${formData.vendorName}`}
              </h1>
              <p className="text-sm text-muted-foreground">ทะเบียนประวัติคู่ค้าและผู้ขายเพื่อระบบจัดซื้อและคลังสินค้า</p>
            </div>
          </div>
          <Button
            className="gap-2 px-8 font-bold shadow-lg bg-primary"
            onClick={handleSave}
            disabled={isSubmitting || (isNew ? !canCreateVendors : !canEditVendors)}
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isNew ? 'บันทึกคู่ค้าใหม่' : 'บันทึกการเปลี่ยนแปลง'}
          </Button>
        </div>

        <Tabs defaultValue="basic" className="w-full">
          <TabsList className="grid grid-cols-3 w-full md:w-fit h-auto p-1 bg-muted/50">
            <TabsTrigger value="basic" className="gap-2 py-2 px-6"><Building2 className="h-4 w-4" /> ข้อมูลบริษัท</TabsTrigger>
            <TabsTrigger value="financial" className="gap-2 py-2 px-6"><CreditCard className="h-4 w-4" /> ข้อมูลการเงิน</TabsTrigger>
            <TabsTrigger value="notes" className="gap-2 py-2 px-6"><ShieldCheck className="h-4 w-4" /> อื่น ๆ</TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="mt-6">
            <Card>
              <CardHeader><CardTitle>ข้อมูลพื้นฐานและประเภทธุรกิจ (Company Profile)</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <Label className="font-bold">รหัสคู่ค้า (Vendor Code)</Label>
                    <Input 
                      value={formData.vendorCode} 
                      disabled={isNew} 
                      onChange={e => setFormData({...formData, vendorCode: e.target.value})} 
                      className={isNew ? "bg-muted font-mono font-bold text-primary" : ""}
                      placeholder=" เช่น VEND-001" 
                    />
                    {isNew && <p className="text-[10px] text-muted-foreground italic">* ระบบจะออกรหัสจริงให้อัตโนมัติเมื่อกดบันทึก</p>}
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">ชื่อบริษัท / ร้านค้า (Vendor Name) *</Label>
                    <Input value={formData.vendorName} onChange={e => setFormData({...formData, vendorName: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">รูปแบบคู่ค้า</Label>
                    <Select
                      value={formData.vendorLegalForm ?? 'JURISTIC'}
                      onValueChange={(v: VendorLegalForm) =>
                        setFormData({
                          ...formData,
                          vendorLegalForm: v,
                          ...(v === 'NATURAL' ? { branchType: 'head_office' as const, branchNo: '' } : {}),
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="JURISTIC">นิติบุคคล</SelectItem>
                        <SelectItem value="NATURAL">บุคคลธรรมดา</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] text-muted-foreground leading-snug">
                      เลือกบุคคลธรรมดาเมื่อคู่ค้าเป็นบุคคล — ระบบจะไม่แสดงสำนักงานใหญ่/สาขา และพิมพ์หัก ณ ที่จ่ายเป็น «บุคคลธรรมดา»
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>ประเภทคู่ค้า (Vendor Type)</Label>
                    <Select onValueChange={(v: VendorType) => setFormData({...formData, vendorType: v})} value={formData.vendorType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PPE_SUPPLIER">PPE Supplier</SelectItem>
                        <SelectItem value="TOOL_SUPPLIER">Tool Supplier</SelectItem>
                        <SelectItem value="SERVICE_PROVIDER">Service Provider</SelectItem>
                        <SelectItem value="TRANSPORT">Transport / Logistics</SelectItem>
                        <SelectItem value="ACCOMMODATION">Accommodation</SelectItem>
                        <SelectItem value="OFFICE_EXPENSE">Office Expense</SelectItem>
                        <SelectItem value="GENERAL_SUPPLIER">General Supplier</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>เลขประจำตัวผู้เสียภาษี (Tax ID)</Label>
                    <Input value={formData.taxId} onChange={e => setFormData({...formData, taxId: e.target.value})} />
                  </div>
                  {(formData.vendorLegalForm ?? 'JURISTIC') === 'JURISTIC' ? (
                    <>
                      <div className="space-y-2">
                        <Label>ประเภทสาขา</Label>
                        <Select
                          onValueChange={(v: 'head_office' | 'branch') => setFormData({ ...formData, branchType: v })}
                          value={(formData.branchType as 'head_office' | 'branch') || 'head_office'}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="head_office">สำนักงานใหญ่</SelectItem>
                            <SelectItem value="branch">สาขา</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {formData.branchType === 'branch' && (
                        <div className="space-y-2">
                          <Label>เลขสาขา (Branch No.)</Label>
                          <Input
                            value={formData.branchNo || ''}
                            onChange={(e) => setFormData({ ...formData, branchNo: e.target.value })}
                            placeholder="เช่น 00001"
                          />
                        </div>
                      )}
                    </>
                  ) : null}
                  <div className="space-y-2">
                    <Label>ชื่อผู้ติดต่อ (Contact Name)</Label>
                    <Input value={formData.contactName} onChange={e => setFormData({...formData, contactName: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>เบอร์โทรศัพท์ (Phone)</Label>
                    <Input value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>อีเมล (Email)</Label>
                    <Input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>สถานะ</Label>
                    <Select onValueChange={(v: 'ACTIVE' | 'INACTIVE') => setFormData({...formData, status: v})} value={formData.status}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ACTIVE">ACTIVE</SelectItem>
                        <SelectItem value="INACTIVE">INACTIVE</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>ที่อยู่ (Address)</Label>
                  <Textarea value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} className="min-h-[100px]" />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="financial" className="mt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader><CardTitle>เงื่อนไขการชำระเงิน (Payment Terms)</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>รูปแบบการชำระเงิน</Label>
                    <Select
                      value={normalizeVendorPaymentTerms(formData.paymentTerms)}
                      onValueChange={(v: 'Cash' | 'Credit') =>
                        setFormData({ ...formData, paymentTerms: v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="เลือกรูปแบบการชำระเงิน" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Cash">Cash — เงินสด</SelectItem>
                        <SelectItem value="Credit">Credit — เครดิต</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>จำนวนวันเครดิต (Credit Days)</Label>
                    <Input type="number" value={formData.creditDays} onChange={e => setFormData({...formData, creditDays: parseInt(e.target.value)})} />
                  </div>
                  <div className="space-y-2">
                    <Label>สกุลเงินหลัก (Default Currency)</Label>
                    <Select onValueChange={v => setFormData({...formData, defaultCurrency: v})} value={formData.defaultCurrency}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="THB">THB - Thai Baht</SelectItem>
                        <SelectItem value="USD">USD - US Dollar</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>บัญชีธนาคาร (Bank Details)</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>ชื่อธนาคาร (Bank Name)</Label>
                    <Input value={formData.bankName} onChange={e => setFormData({...formData, bankName: e.target.value})} placeholder="เช่น กสิกรไทย, ไทยพาณิชย์" />
                  </div>
                  <div className="space-y-2">
                    <Label>ชื่อบัญชี (Account Name)</Label>
                    <Input value={formData.bankAccountName} onChange={e => setFormData({...formData, bankAccountName: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>เลขที่บัญชี (Account Number)</Label>
                    <Input value={formData.bankAccountNumber} onChange={e => setFormData({...formData, bankAccountNumber: e.target.value})} placeholder="000-0-00000-0" />
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="notes" className="mt-6">
            <Card>
              <CardHeader><CardTitle>บันทึกเพิ่มเติม (Additional Notes)</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label>หมายเหตุภายใน</Label>
                  <Textarea value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} className="min-h-[150px]" placeholder="ระบุข้อมูลเพิ่มเติมเกี่ยวกับคู่ค้า เช่น บริการที่โดดเด่น หรือเงื่อนไขพิเศษ" />
                </div>

                <div className="p-4 border rounded-lg bg-muted/30 space-y-2">
                  <div className="flex items-center gap-2 font-bold text-sm">
                    <History className="h-4 w-4 text-primary" /> ประวัติการทำรายการ
                  </div>
                  <div className="text-xs space-y-1">
                    <p><span className="text-muted-foreground">สร้างเมื่อ:</span> {vendorData?.createdAt ? formatDateTimeThaiBE(vendorData.createdAt) : '-'}</p>
                    <p><span className="text-muted-foreground">อัปเดตล่าสุด:</span> {vendorData?.updatedAt ? formatDateTimeThaiBE(vendorData.updatedAt) : '-'}</p>
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
