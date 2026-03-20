'use client';

import { useState, use, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  ArrowLeft, 
  Save, 
  Building2, 
  Calendar, 
  Inbox,
  CheckCircle2,
  History,
  Info,
  Loader2,
  FileText,
  Calculator,
  Wallet
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useUser, useCollection } from '@/firebase';
import { doc, collection, updateDoc } from 'firebase/firestore';
import { updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { APBill, APBillStatus, User, Vendor, Purchase } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

export default function APBillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const billRef = useMemoFirebase(() => (firestore ? doc(firestore, 'ap_bills', id) : null), [firestore, id]);
  const { data: bill, isLoading: isBillLoading } = useDoc<APBill>(billRef as any);

  const [formData, setFormData] = useState<Partial<APBill>>({});
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (bill) setFormData(bill);
  }, [bill]);

  const vendorsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'vendors') : null), [firestore]);
  const { data: vendors } = useCollection<Vendor>(vendorsQuery as any);
  const vendor = vendors?.find(v => v.id === bill?.vendorId);

  const purchaseRef = useMemoFirebase(() => (firestore && bill?.purchaseId ? doc(firestore, 'purchases', bill.purchaseId) : null), [firestore, bill?.purchaseId]);
  const { data: purchase } = useDoc<Purchase>(purchaseRef as any);

  const handleSave = () => {
    if (!billRef) return;
    updateDocumentNonBlocking(billRef, { ...formData, updatedAt: Date.now() });
    setIsEditing(false);
    toast({ title: "บันทึกข้อมูลสำเร็จ" });
  };

  const handleUpdateStatus = (newStatus: APBillStatus) => {
    if (!billRef) return;
    updateDocumentNonBlocking(billRef, { status: newStatus, updatedAt: Date.now() });
    toast({ title: "อัปเดตสถานะสำเร็จ", description: `เปลี่ยนสถานะเป็น ${newStatus}` });
  };

  if (isBillLoading || !bill || !currentUser) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-12 w-12 text-primary animate-spin" /></div>;
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.push('/ap-bills')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">AP Bill Detail (รายละเอียดใบวางบิลเจ้าหนี้)</h1>
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <span className="font-mono font-bold text-primary">{bill.apBillNo}</span>
                <Separator orientation="vertical" className="h-3" />
                <span>คู่ค้า: {vendor?.vendorName || '...'}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" className="py-1.5 px-4 font-bold border-primary/20 bg-primary/5 text-primary">
              STATUS: {bill.status}
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Inbox className="h-5 w-5 text-primary" /> ข้อมูลใบวางบิล (Bill Info)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">เลขที่ใบแจ้งหนี้คู่ค้า:</Label>
                  <p className="font-bold">{bill.supplierInvoiceNo}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">อ้างอิงรายการซื้อ:</Label>
                  <p className="font-mono text-primary">{purchase?.purchaseNo || 'N/A'}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">วันที่ในใบแจ้งหนี้:</Label>
                  <p className="font-medium">{bill.invoiceDate}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">วันครบกำหนด:</Label>
                  <p className="font-bold text-red-600">{bill.dueDate}</p>
                </div>
              </div>
              
              <Separator />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label>ยอดเงินฐานภาษี (Taxable)</Label>
                  <Input type="number" disabled={!isEditing} value={formData.amountBeforeTax} onChange={e => setFormData({...formData, amountBeforeTax: parseFloat(e.target.value)})} />
                </div>
                <div className="space-y-2">
                  <Label>ภาษีมูลค่าเพิ่ม (VAT 7%)</Label>
                  <Input type="number" disabled={!isEditing} value={formData.vatAmount} onChange={e => setFormData({...formData, vatAmount: parseFloat(e.target.value)})} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>ยอดรวมสุทธิ (Total Amount)</Label>
                  <Input type="number" className="text-lg font-bold text-primary" disabled={!isEditing} value={formData.totalAmount} onChange={e => setFormData({...formData, totalAmount: parseFloat(e.target.value)})} />
                </div>
              </div>

              {isEditing ? (
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsEditing(false)}>ยกเลิก</Button>
                  <Button onClick={handleSave} className="gap-2"><Save className="h-4 w-4" /> บันทึก</Button>
                </div>
              ) : (
                <Button variant="outline" onClick={() => setIsEditing(true)}>แก้ไขยอดเงิน</Button>
              )}
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="bg-primary text-primary-foreground shadow-lg">
              <CardHeader className="pb-4 border-b border-white/10">
                <CardTitle className="text-sm font-bold uppercase tracking-wider opacity-80">การดำเนินการ (Workflow)</CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-3">
                {bill.status === 'RECEIVED' && (
                  <Button className="w-full bg-white text-primary hover:bg-slate-100 font-bold" onClick={() => handleUpdateStatus('VERIFIED')}>
                    <CheckCircle2 className="h-4 w-4 mr-2" /> ยืนยันความถูกต้อง
                  </Button>
                )}
                {bill.status === 'VERIFIED' && (
                  <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold" onClick={() => handleUpdateStatus('APPROVED')}>
                    <CheckCircle2 className="h-4 w-4 mr-2" /> อนุมัติการจ่ายเงิน
                  </Button>
                )}
                <Button variant="ghost" className="w-full text-white/60 hover:text-white hover:bg-white/10" onClick={() => handleUpdateStatus('CANCELLED')}>
                  ยกเลิกใบแจ้งหนี้นี้
                </Button>
              </CardContent>
            </Card>

            <Card className="bg-muted/30 border-dashed">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold uppercase text-muted-foreground">สรุปเจ้าหนี้</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ยอดค้างจ่าย:</span>
                  <span className="font-black text-primary">฿ {bill.totalAmount.toLocaleString()}</span>
                </div>
              </CardContent>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
