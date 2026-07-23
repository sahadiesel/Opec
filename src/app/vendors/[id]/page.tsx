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
  History,
  ShieldCheck,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { doc, collection, setDoc, updateDoc } from 'firebase/firestore';
import { Vendor, VendorType, VendorLegalForm, VendorBankAccount, User } from '@/lib/types';

function normalizeVendorPaymentTerms(raw: string | undefined | null): 'Cash' | 'Credit' {
  const s = (raw || '').trim().toLowerCase();
  if (s === 'cash' || s === 'เงินสด') return 'Cash';
  return 'Credit';
}
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';
import { formatDateTimeThaiBE } from '@/lib/date-thai';
import { useAppUser } from '@/hooks/use-app-user';
import { canView, canCreate, canEdit } from '@/lib/permissions';
import {
  createEmptyVendorBankAccount,
  resolveVendorBankAccounts,
  syncVendorPrimaryBankFields,
} from '@/lib/vendors/vendor-bank-accounts';

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
    goodsOrServicesDetail: '',
    paymentTerms: 'Credit' as const,
    creditDays: 30,
    defaultCurrency: 'THB',
    bankAccountName: '',
    bankAccountNumber: '',
    bankName: '',
    bankAccounts: [createEmptyVendorBankAccount({ label: 'บัญชีหลัก', isPrimary: true })],
    status: 'ACTIVE',
    notes: ''
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEditing, setIsEditing] = useState(isNew);
  const fieldsLocked = !isNew && !isEditing;

  useEffect(() => {
    if (vendorData) {
      const days = Number(vendorData.creditDays);
      const banks = resolveVendorBankAccounts(vendorData);
      setFormData({
        ...vendorData,
        vendorLegalForm: vendorData.vendorLegalForm ?? 'JURISTIC',
        branchType: vendorData.branchType || ((vendorData.branchNo || '00000') === '00000' ? 'head_office' : 'branch'),
        branchNo: (vendorData.branchNo || '00000') === '00000' ? '' : (vendorData.branchNo || ''),
        paymentTerms: normalizeVendorPaymentTerms(vendorData.paymentTerms),
        creditDays: Number.isFinite(days) ? days : 30,
        bankAccounts: banks.length > 0 ? banks : [createEmptyVendorBankAccount({ label: 'บัญชีหลัก', isPrimary: true })],
      });
      setIsEditing(false);
    }
  }, [vendorData]);

  const bankAccounts = formData.bankAccounts ?? [];

  const updateBankAccount = (id: string, patch: Partial<VendorBankAccount>) => {
    setFormData((prev) => ({
      ...prev,
      bankAccounts: (prev.bankAccounts ?? []).map((b) => (b.id === id ? { ...b, ...patch } : b)),
    }));
  };

  const addBankAccount = () => {
    setFormData((prev) => ({
      ...prev,
      bankAccounts: [...(prev.bankAccounts ?? []), createEmptyVendorBankAccount()],
    }));
  };

  const removeBankAccount = (id: string) => {
    setFormData((prev) => {
      const next = (prev.bankAccounts ?? []).filter((b) => b.id !== id);
      if (next.length === 0) {
        return { ...prev, bankAccounts: [createEmptyVendorBankAccount({ label: 'บัญชีหลัก', isPrimary: true })] };
      }
      if (!next.some((b) => b.isPrimary)) {
        next[0] = { ...next[0]!, isPrimary: true };
      }
      return { ...prev, bankAccounts: next };
    });
  };

  const setPrimaryBankAccount = (id: string) => {
    setFormData((prev) => ({
      ...prev,
      bankAccounts: (prev.bankAccounts ?? []).map((b) => ({ ...b, isPrimary: b.id === id })),
    }));
  };

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

      const creditDaysToSave = Number.isFinite(Number(formData.creditDays))
        ? Number(formData.creditDays)
        : 0;

      const bankSync = syncVendorPrimaryBankFields(formData.bankAccounts ?? []);

      if (isNew) {
        // Atomic Code Generation
        const { code: finalCode } = await generateNextDocumentCode(firestore, 'vendor', { actor: currentUser.displayName });

        const newRef = doc(collection(firestore, 'vendors'));
        await setDoc(newRef, {
          ...formData,
          vendorLegalForm: legalForm,
          branchType: branchTypeToSave,
          branchNo: normalizedBranchNo,
          creditDays: creditDaysToSave,
          bankAccounts: bankSync.bankAccounts,
          bankName: bankSync.bankName,
          bankAccountName: bankSync.bankAccountName,
          bankAccountNumber: bankSync.bankAccountNumber,
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
          creditDays: creditDaysToSave,
          bankAccounts: bankSync.bankAccounts,
          bankName: bankSync.bankName,
          bankAccountName: bankSync.bankAccountName,
          bankAccountNumber: bankSync.bankAccountNumber,
          updatedAt: now,
        });
        toast({ title: "อัปเดตข้อมูลสำเร็จ" });
        setIsEditing(false);
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
          <div className="flex items-center gap-2">
            {!isNew && canEditVendors ? (
              <Button
                type="button"
                variant="outline"
                className="gap-2 px-6 font-bold"
                disabled={isSubmitting || isEditing}
                onClick={() => setIsEditing(true)}
              >
                <Pencil className="h-4 w-4" />
                แก้ไข
              </Button>
            ) : null}
            <Button
              className="gap-2 px-8 font-bold shadow-lg bg-primary"
              onClick={handleSave}
              disabled={
                isSubmitting ||
                (isNew ? !canCreateVendors : !canEditVendors) ||
                (!isNew && !isEditing)
              }
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {isNew ? 'บันทึกคู่ค้าใหม่' : 'บันทึกการเปลี่ยนแปลง'}
            </Button>
          </div>
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
                      disabled={isNew || fieldsLocked} 
                      onChange={e => setFormData({...formData, vendorCode: e.target.value})} 
                      className={isNew ? "bg-muted font-mono font-bold text-primary" : ""}
                      placeholder=" เช่น VEND-001" 
                    />
                    {isNew && <p className="text-[10px] text-muted-foreground italic">* ระบบจะออกรหัสจริงให้อัตโนมัติเมื่อกดบันทึก</p>}
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">ชื่อบริษัท / ร้านค้า (Vendor Name) *</Label>
                    <Input disabled={fieldsLocked} value={formData.vendorName} onChange={e => setFormData({...formData, vendorName: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">รูปแบบคู่ค้า</Label>
                    <Select
                      disabled={fieldsLocked}
                      value={formData.vendorLegalForm ?? 'JURISTIC'}
                      onValueChange={(v: VendorLegalForm) =>
                        setFormData({
                          ...formData,
                          vendorLegalForm: v,
                          ...(v === 'NATURAL' ? { branchType: 'head_office' as const, branchNo: '' } : {}),
                        })
                      }
                    >
                      <SelectTrigger disabled={fieldsLocked}>
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
                    <Select disabled={fieldsLocked} onValueChange={(v: VendorType) => setFormData({...formData, vendorType: v})} value={formData.vendorType}>
                      <SelectTrigger disabled={fieldsLocked}><SelectValue /></SelectTrigger>
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
                    <Input disabled={fieldsLocked} value={formData.taxId} onChange={e => setFormData({...formData, taxId: e.target.value})} />
                  </div>
                  {(formData.vendorLegalForm ?? 'JURISTIC') === 'JURISTIC' ? (
                    <>
                      <div className="space-y-2">
                        <Label>ประเภทสาขา</Label>
                        <Select
                          disabled={fieldsLocked}
                          onValueChange={(v: 'head_office' | 'branch') => setFormData({ ...formData, branchType: v })}
                          value={(formData.branchType as 'head_office' | 'branch') || 'head_office'}
                        >
                          <SelectTrigger disabled={fieldsLocked}>
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
                            disabled={fieldsLocked}
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
                    <Input disabled={fieldsLocked} value={formData.contactName} onChange={e => setFormData({...formData, contactName: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>เบอร์โทรศัพท์ (Phone)</Label>
                    <Input disabled={fieldsLocked} value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>อีเมล (Email)</Label>
                    <Input disabled={fieldsLocked} type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>สถานะ</Label>
                    <Select disabled={fieldsLocked} onValueChange={(v: 'ACTIVE' | 'INACTIVE') => setFormData({...formData, status: v})} value={formData.status}>
                      <SelectTrigger disabled={fieldsLocked}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ACTIVE">ACTIVE</SelectItem>
                        <SelectItem value="INACTIVE">INACTIVE</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>ที่อยู่ (Address)</Label>
                    <Textarea
                      disabled={fieldsLocked}
                      value={formData.address ?? ''}
                      onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                      className="min-h-[100px]"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>รายละเอียดสินค้าหรือการบริการ</Label>
                    <Textarea
                      disabled={fieldsLocked}
                      value={formData.goodsOrServicesDetail ?? ''}
                      onChange={(e) => setFormData({ ...formData, goodsOrServicesDetail: e.target.value })}
                      className="min-h-[100px]"
                      placeholder="บันทึกรายละเอียดสินค้าหรือการบริการที่คู่ค้าจัดหา"
                    />
                  </div>
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
                      disabled={fieldsLocked}
                      value={normalizeVendorPaymentTerms(formData.paymentTerms)}
                      onValueChange={(v: 'Cash' | 'Credit') =>
                        setFormData({ ...formData, paymentTerms: v })
                      }
                    >
                      <SelectTrigger disabled={fieldsLocked}>
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
                    <Input
                      type="number"
                      min={0}
                      disabled={fieldsLocked}
                      value={Number.isFinite(formData.creditDays) ? formData.creditDays : ''}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === '') {
                          setFormData({ ...formData, creditDays: undefined });
                          return;
                        }
                        const n = Number.parseInt(raw, 10);
                        if (Number.isFinite(n)) {
                          setFormData({ ...formData, creditDays: n });
                        }
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>สกุลเงินหลัก (Default Currency)</Label>
                    <Select disabled={fieldsLocked} onValueChange={v => setFormData({...formData, defaultCurrency: v})} value={formData.defaultCurrency}>
                      <SelectTrigger disabled={fieldsLocked}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="THB">THB - Thai Baht</SelectItem>
                        <SelectItem value="USD">USD - US Dollar</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>บัญชีธนาคาร (Bank Details)</CardTitle>
                  <CardDescription>รองรับหลายบัญชี — เลือกบัญชีที่จะโอนเข้าตอนทำจ่ายได้</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {bankAccounts.map((acct, idx) => (
                    <div key={acct.id} className="rounded-lg border bg-muted/20 p-3 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold">บัญชี {idx + 1}{acct.isPrimary ? ' · หลัก' : ''}</p>
                        <div className="flex items-center gap-1">
                          {!acct.isPrimary ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 text-xs"
                              disabled={fieldsLocked}
                              onClick={() => setPrimaryBankAccount(acct.id)}
                            >
                              ตั้งเป็นหลัก
                            </Button>
                          ) : null}
                          {bankAccounts.length > 1 ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              disabled={fieldsLocked}
                              onClick={() => removeBankAccount(acct.id)}
                              aria-label="ลบบัญชี"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>ชื่อเรียก (ไม่บังคับ)</Label>
                        <Input
                          disabled={fieldsLocked}
                          value={acct.label ?? ''}
                          onChange={(e) => updateBankAccount(acct.id, { label: e.target.value })}
                          placeholder="เช่น บัญชีหลัก / บัญชีค่าบริการ"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>ชื่อธนาคาร (Bank Name)</Label>
                        <Input
                          disabled={fieldsLocked}
                          value={acct.bankName}
                          onChange={(e) => updateBankAccount(acct.id, { bankName: e.target.value })}
                          placeholder="เช่น กสิกรไทย, ไทยพาณิชย์"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>ชื่อบัญชี (Account Name)</Label>
                        <Input
                          disabled={fieldsLocked}
                          value={acct.bankAccountName}
                          onChange={(e) => updateBankAccount(acct.id, { bankAccountName: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>เลขที่บัญชี (Account Number)</Label>
                        <Input
                          disabled={fieldsLocked}
                          value={acct.bankAccountNumber}
                          onChange={(e) => updateBankAccount(acct.id, { bankAccountNumber: e.target.value })}
                          placeholder="000-0-00000-0"
                        />
                      </div>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full gap-2"
                    disabled={fieldsLocked}
                    onClick={addBankAccount}
                  >
                    <Plus className="h-4 w-4" />
                    เพิ่มบัญชีธนาคาร
                  </Button>
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
                  <Textarea
                    disabled={fieldsLocked}
                    value={formData.notes}
                    onChange={e => setFormData({...formData, notes: e.target.value})}
                    className="min-h-[150px]"
                    placeholder="ระบุข้อมูลเพิ่มเติมเกี่ยวกับคู่ค้า เช่น บริการที่โดดเด่น หรือเงื่อนไขพิเศษ"
                  />
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
