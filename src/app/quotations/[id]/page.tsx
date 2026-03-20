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
  FileSignature, 
  Building2, 
  Calendar, 
  History,
  Info,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Briefcase
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useUser, useCollection } from '@/firebase';
import { doc, collection } from 'firebase/firestore';
import { updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Quotation, QuotationStatus, User, Customer } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

export default function QuotationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const quotationRef = useMemoFirebase(() => (firestore ? doc(firestore, 'quotations', id) : null), [firestore, id]);
  const { data: quotation, isLoading: isQuoLoading } = useDoc<Quotation>(quotationRef as any);

  const customerRef = useMemoFirebase(() => (firestore && quotation ? doc(firestore, 'customers', quotation.customerId) : null), [firestore, quotation?.customerId]);
  const { data: customer } = useDoc<Customer>(customerRef as any);

  const handleUpdateStatus = (newStatus: QuotationStatus) => {
    if (!quotationRef) return;
    updateDocumentNonBlocking(quotationRef, { status: newStatus, updatedAt: Date.now() });
    toast({ title: "อัปเดตสถานะสำเร็จ", description: `เปลี่ยนสถานะเป็น ${newStatus}` });
  };

  if (isQuoLoading || !quotation || !currentUser) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-12 w-12 text-primary animate-spin" /></div>;
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.push('/quotations')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Quotation Detail (รายละเอียดใบเสนอราคา)</h1>
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <span className="font-mono font-bold text-primary">{quotation.quotationNo}</span>
                <Separator orientation="vertical" className="h-3" />
                <span>ลูกค้า: {customer?.name || '...'}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" className="py-1.5 px-4 font-bold border-primary/20 bg-primary/5 text-primary">
              STATUS: {quotation.status}
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <FileSignature className="h-5 w-5 text-primary" /> ข้อมูลใบเสนอราคา (Quotation Info)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">หัวข้อโครงการ:</Label>
                  <p className="font-bold text-lg">{quotation.title}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">วันที่ออกเอกสาร:</Label>
                  <p className="font-medium flex items-center gap-2"><Calendar className="h-4 w-4" /> {quotation.issueDate}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">วันหมดอายุข้อเสนอ:</Label>
                  <p className="font-bold text-red-600 flex items-center gap-2"><Clock className="h-4 w-4" /> {quotation.expiryDate}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">ลูกค้า:</Label>
                  <p className="font-semibold">{customer?.name}</p>
                </div>
              </div>
              
              <Separator />

              <div className="space-y-4">
                <div className="flex justify-between items-center text-lg pt-2">
                  <span className="font-black text-primary uppercase">มูลค่ารวมสุทธิ (Total Value)</span>
                  <span className="font-black text-2xl text-primary">{quotation.currency} {quotation.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
              </div>

              <div className="space-y-2 pt-4">
                <Label>หมายเหตุ / เงื่อนไขเพิ่มเติม:</Label>
                <p className="text-sm italic text-muted-foreground">{quotation.notes || 'ไม่มีหมายเหตุ'}</p>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="bg-primary text-primary-foreground shadow-lg">
              <CardHeader className="pb-4 border-b border-white/10">
                <CardTitle className="text-sm font-bold uppercase tracking-wider opacity-80">การดำเนินการ (Workflow)</CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-3">
                {quotation.status === 'DRAFT' && (
                  <Button className="w-full bg-white text-primary hover:bg-slate-100 font-bold" onClick={() => handleUpdateStatus('SENT')}>
                    <CheckCircle2 className="h-4 w-4 mr-2" /> ส่งให้ลูกค้า (Mark as Sent)
                  </Button>
                )}
                {quotation.status === 'SENT' && (
                  <>
                    <Button className="w-full bg-green-600 hover:bg-green-700 text-white font-bold" onClick={() => handleUpdateStatus('ACCEPTED')}>
                      <CheckCircle2 className="h-4 w-4 mr-2" /> ลูกค้าตอบรับ (Accepted)
                    </Button>
                    <Button variant="outline" className="w-full bg-transparent border-white/20 text-white hover:bg-white/10" onClick={() => handleUpdateStatus('REJECTED')}>
                      <XCircle className="h-4 w-4 mr-2" /> ลูกค้าปฏิเสธ (Rejected)
                    </Button>
                  </>
                )}
                <Button variant="ghost" className="w-full text-white/60 hover:text-white hover:bg-white/10" onClick={() => handleUpdateStatus('CANCELLED')}>
                  ยกเลิกใบเสนอราคา
                </Button>
              </CardContent>
            </Card>

            <Card className="bg-muted/30 border-dashed">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold uppercase text-muted-foreground">System Audit</CardTitle>
              </CardHeader>
              <CardContent className="text-[10px] space-y-2">
                <div className="flex justify-between">
                  <span>สร้างโดย:</span>
                  <span>{quotation.createdBy}</span>
                </div>
                <div className="flex justify-between">
                  <span>วันที่สร้าง:</span>
                  <span>{new Date(quotation.createdAt).toLocaleString('th-TH')}</span>
                </div>
              </CardContent>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
