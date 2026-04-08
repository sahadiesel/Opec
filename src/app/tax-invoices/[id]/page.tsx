'use client';

import { useState, use, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  ArrowLeft, 
  Save, 
  FileBadge, 
  Building2, 
  Calendar, 
  History,
  Info,
  Loader2,
  Printer,
  XCircle,
  CheckCircle2
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useUser, useCollection } from '@/firebase';
import { doc, collection } from 'firebase/firestore';
import { updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { TaxInvoice, TaxInvoiceStatus, User, Customer, BillingNote } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { formatDateTimeThaiBE, formatStoredDateThaiBE } from '@/lib/date-thai';

export default function TaxInvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const invRef = useMemoFirebase(() => (firestore ? doc(firestore, 'tax_invoices', id) : null), [firestore, id]);
  const { data: invoice, isLoading: isInvLoading } = useDoc<TaxInvoice>(invRef as any);

  const customerRef = useMemoFirebase(() => (firestore && invoice ? doc(firestore, 'customers', invoice.customerId) : null), [firestore, invoice?.customerId]);
  const { data: customer } = useDoc<Customer>(customerRef as any);

  const billingNoteRef = useMemoFirebase(() => (firestore && invoice ? doc(firestore, 'billing_notes', invoice.billingNoteId) : null), [firestore, invoice?.billingNoteId]);
  const { data: billingNote } = useDoc<BillingNote>(billingNoteRef as any);

  const handleUpdateStatus = (newStatus: TaxInvoiceStatus) => {
    if (!invRef) return;
    updateDocumentNonBlocking(invRef, { status: newStatus, updatedAt: Date.now() });
    toast({ title: "อัปเดตสถานะสำเร็จ", description: `เปลี่ยนสถานะเป็น ${newStatus}` });
  };

  if (isInvLoading || !invoice || !currentUser) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-12 w-12 text-primary animate-spin" /></div>;
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.push('/tax-invoices')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Tax Invoice Detail (รายละเอียดใบกำกับภาษี)</h1>
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <span className="font-mono font-bold text-primary">{invoice.taxInvoiceNo}</span>
                <Separator orientation="vertical" className="h-3" />
                <span>ลูกค้า: {customer?.name || '...'}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> พิมพ์เอกสาร
            </Button>
            <Badge variant="outline" className="py-1.5 px-4 font-bold border-primary/20 bg-primary/5 text-primary">
              STATUS: {invoice.status}
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <FileBadge className="h-5 w-5 text-primary" /> ข้อมูลใบกำกับภาษี (Invoice Info)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">เลขที่เอกสาร:</Label>
                  <p className="font-bold text-lg">{invoice.taxInvoiceNo}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">วันที่ออกเอกสาร:</Label>
                  <p className="font-medium flex items-center gap-2"><Calendar className="h-4 w-4" /> {formatStoredDateThaiBE(invoice.issueDate)}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">อ้างอิงใบวางบิล:</Label>
                  <p className="font-mono font-bold text-primary">{billingNote?.billingNoteNo || '...'}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">ลูกค้า:</Label>
                  <p className="font-semibold">{customer?.name}</p>
                </div>
              </div>
              
              <Separator />

              <div className="space-y-4">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">ยอดเงินฐานภาษี (Taxable Amount)</span>
                  <span className="font-bold">{invoice.currency} {invoice.taxableAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">ภาษีมูลค่าเพิ่ม (VAT 7%)</span>
                  <span className="font-bold">{invoice.currency} {invoice.vatAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between items-center text-lg pt-2 border-t">
                  <span className="font-black text-primary uppercase">ยอดรวมสุทธิ (Net Total)</span>
                  <span className="font-black text-2xl text-primary">{invoice.currency} {invoice.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
              </div>

              <div className="space-y-2 pt-4">
                <Label>หมายเหตุ:</Label>
                <p className="text-sm italic text-muted-foreground">{invoice.notes || 'ไม่มีหมายเหตุ'}</p>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="bg-primary text-primary-foreground shadow-lg">
              <CardHeader className="pb-4 border-b border-white/10">
                <CardTitle className="text-sm font-bold uppercase tracking-wider opacity-80">การดำเนินการ (Workflow)</CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-3">
                {invoice.status === 'DRAFT' && (
                  <Button className="w-full bg-white text-primary hover:bg-slate-100 font-bold" onClick={() => handleUpdateStatus('ISSUED')}>
                    <CheckCircle2 className="h-4 w-4 mr-2" /> ยืนยันการออกเอกสาร
                  </Button>
                )}
                {invoice.status === 'ISSUED' && (
                  <div className="p-4 bg-white/10 rounded-lg text-xs flex gap-2">
                    <Info className="h-4 w-4 shrink-0" />
                    เอกสารถูกยืนยันแล้ว และได้บันทึกเข้าสู่ระบบลูกหนี้ (AR) เรียบร้อยแล้ว
                  </div>
                )}
                <Button variant="ghost" className="w-full text-white/60 hover:text-white hover:bg-white/10" onClick={() => handleUpdateStatus('CANCELLED')}>
                  <XCircle className="h-4 w-4 mr-2" /> ยกเลิกใบกำกับภาษี
                </Button>
              </CardContent>
            </Card>

            <Card className="bg-muted/30 border-dashed">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold uppercase text-muted-foreground">Audit Log</CardTitle>
              </CardHeader>
              <CardContent className="text-[10px] space-y-2">
                <div className="flex justify-between">
                  <span>สร้างเมื่อ:</span>
                  <span>{formatDateTimeThaiBE(invoice.createdAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span>อัปเดตล่าสุด:</span>
                  <span>{formatDateTimeThaiBE(invoice.updatedAt)}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
