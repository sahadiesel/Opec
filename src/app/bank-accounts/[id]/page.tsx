'use client';

import { useState, use, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  ArrowLeft, 
  Save, 
  Loader2, 
  Building2,
  CreditCard,
  Briefcase,
  History,
  ShieldCheck,
  Building,
  Coins,
  Wallet
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useUser } from '@/firebase';
import { doc, collection, setDoc, updateDoc } from 'firebase/firestore';
import { BankAccount, BankAccountType, BankAccountStatus, User } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import Link from 'next/link';
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';

export default function BankAccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const isNew = id === 'new';
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const firestore = useFirestore();
  const { toast } = useToast();

  const accRef = useMemoFirebase(() => (firestore && !isNew ? doc(firestore, 'bank_accounts', id) : null), [firestore, id, isNew]);
  const { data: accData, isLoading: isAccLoading } = useDoc<BankAccount>(accRef as any);

  const [formData, setFormData] = useState<Partial<BankAccount>>({
    accountCode: isNew ? getPreviewPattern('bank_account') : '',
    bankName: '',
    accountName: '',
    accountNumber: '',
    branchName: '',
    accountType: 'SAVINGS',
    currency: 'THB',
    openingBalance: 0,
    currentBalance: 0,
    status: 'ACTIVE',
    notes: ''
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  useEffect(() => {
    if (accData) {
      setFormData(accData);
    }
  }, [accData]);

  const handleSave = async () => {
    if (!firestore || !currentUser) return;
    if (!formData.accountName || !formData.accountNumber) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาระบุชื่อบัญชี และเลขที่บัญชี" });
      return;
    }

    setIsSubmitting(true);
    const now = Date.now();
    
    try {
      if (isNew) {
        // Atomic Code Generation
        const { code: finalCode } = await generateNextDocumentCode(firestore, 'bank_account', { actor: currentUser.displayName });

        const newRef = doc(collection(firestore, 'bank_accounts'));
        await setDoc(newRef, {
          ...formData,
          accountCode: finalCode,
          id: newRef.id,
          createdAt: now,
          updatedAt: now
        });
        toast({ title: "เพิ่มบัญชีธนาคารสำเร็จ", description: `รหัสบัญชี: ${finalCode}` });
        router.push('/bank-accounts');
      } else {
        await updateDoc(accRef!, {
          ...formData,
          updatedAt: now
        });
        toast({ title: "อัปเดตข้อมูลสำเร็จ" });
        router.back();
      }
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถบันทึกข้อมูลได้" });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isNew && isAccLoading) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="animate-spin h-12 w-12 text-primary" /></div>;
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.back()}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                {isNew ? 'เพิ่มบัญชีธนาคารใหม่ (Add Bank Account)' : `แก้ไขข้อมูลบัญชี: ${formData.accountName}`}
              </h1>
              <p className="text-sm text-muted-foreground">บันทึกข้อมูลทางการเงินเพื่อใช้ในระบบจ่ายเงินและรับชำระ</p>
            </div>
          </div>
          <Button className="gap-2 px-8 font-bold shadow-lg bg-primary" onClick={handleSave} disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isNew ? 'บันทึกบัญชีใหม่' : 'บันทึกการเปลี่ยนแปลง'}
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Building className="h-5 w-5 text-primary" /> ข้อมูลบัญชีธนาคาร (Account Information)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label className="font-bold">รหัสบัญชี (Account Code)</Label>
                  <Input 
                    value={formData.accountCode} 
                    disabled={isNew} 
                    onChange={e => setFormData({...formData, accountCode: e.target.value})} 
                    className={isNew ? "bg-muted font-mono font-bold text-primary" : ""}
                    placeholder="เช่น BBL-MAIN" 
                  />
                  {isNew && <p className="text-[10px] text-muted-foreground italic">* ระบบจะออกรหัสจริงให้อัตโนมัติเมื่อกดบันทึก</p>}
                </div>
                <div className="space-y-2">
                  <Label>ธนาคาร (Bank Name)</Label>
                  <Input value={formData.bankName} onChange={e => setFormData({...formData, bankName: e.target.value})} placeholder="เช่น ธนาคารกรุงเทพ" />
                </div>
                <div className="space-y-2">
                  <Label>ชื่อบัญชี (Account Name) *</Label>
                  <Input value={formData.accountName} onChange={e => setFormData({...formData, accountName: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>เลขที่บัญชี (Account Number) *</Label>
                  <Input value={formData.accountNumber} onChange={e => setFormData({...formData, accountNumber: e.target.value})} placeholder="000-0-00000-0" />
                </div>
                <div className="space-y-2">
                  <Label>สาขา (Branch Name)</Label>
                  <Input value={formData.branchName} onChange={e => setFormData({...formData, branchName: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>ประเภทบัญชี</Label>
                  <Select onValueChange={(v: BankAccountType) => setFormData({...formData, accountType: v})} value={formData.accountType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SAVINGS">ออมทรัพย์ (SAVINGS)</SelectItem>
                      <SelectItem value="CURRENT">กระแสรายวัน (CURRENT)</SelectItem>
                      <SelectItem value="CASH">เงินสด (CASH / PETTY CASH)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>สกุลเงิน (Currency)</Label>
                  <Select onValueChange={v => setFormData({...formData, currency: v})} value={formData.currency}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="THB">THB - Thai Baht</SelectItem>
                      <SelectItem value="USD">USD - US Dollar</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>สถานะ</Label>
                  <Select onValueChange={(v: BankAccountStatus) => setFormData({...formData, status: v})} value={formData.status}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ACTIVE">ACTIVE</SelectItem>
                      <SelectItem value="INACTIVE">INACTIVE</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>หมายเหตุ</Label>
                <Textarea value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} />
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="border-primary/20 bg-primary/5">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Coins className="h-5 w-5 text-primary" /> ยอดเงิน (Balances)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>ยอดเงินยกมา (Opening Balance)</Label>
                  <Input 
                    type="number" 
                    value={formData.openingBalance} 
                    onChange={e => setFormData({...formData, openingBalance: parseFloat(e.target.value)})} 
                    className="text-lg font-bold"
                  />
                </div>
                <div className="space-y-2">
                  <Label>ยอดเงินปัจจุบัน (Current Balance)</Label>
                  <Input 
                    type="number" 
                    value={formData.currentBalance} 
                    onChange={e => setFormData({...formData, currentBalance: parseFloat(e.target.value)})} 
                    className="text-xl font-black text-primary"
                  />
                </div>
                <div className="p-3 bg-white rounded border text-xs text-muted-foreground italic">
                  * ยอดเงินปัจจุบันจะถูกอัปเดตอัตโนมัติเมื่อมีการทำรายการผ่านระบบ Cashbook
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">ประวัติระบบ</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">สร้างเมื่อ:</span>
                  <span>{accData?.createdAt ? new Date(accData.createdAt).toLocaleString('th-TH') : '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">อัปเดตล่าสุด:</span>
                  <span>{accData?.updatedAt ? new Date(accData.updatedAt).toLocaleString('th-TH') : '-'}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
