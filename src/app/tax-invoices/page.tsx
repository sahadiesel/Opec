
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
  FileBadge, 
  Building2, 
  Calendar,
  Info,
  Loader2
} from 'lucide-react';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { Input } from '@/components/ui/input';
import {
  htmlDateValueToTimestampMs,
  timestampToHtmlDateValue,
  formatStoredDateThaiBE,
} from '@/lib/date-thai';
import { TaxInvoice, TaxInvoiceStatus, User, Customer, BillingNote } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canView, canCreate } from '@/lib/permissions';
import { collection, query, orderBy, doc, addDoc } from 'firebase/firestore';
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

export default function TaxInvoicesPage() {
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const isAuthorized = useMemo(
    () => !!currentUser && canView(currentUser, 'tax_invoices'),
    [currentUser]
  );

  const canCreateInvoice = useMemo(
    () => !!currentUser && canCreate(currentUser, 'tax_invoices'),
    [currentUser]
  );

  const invoicesQuery = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return query(collection(firestore, 'tax_invoices'), orderBy('issueDate', 'desc'));
  }, [firestore, isAuthorized]);

  const { data: invoices, isLoading } = useCollection<TaxInvoice>(invoicesQuery as any);

  const customersQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'customers') : null), [firestore, isAuthorized]);
  const { data: customers } = useCollection<Customer>(customersQuery as any);

  const billingNotesQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'billing_notes') : null), [firestore, isAuthorized]);
  const { data: billingNotes } = useCollection<BillingNote>(billingNotesQuery as any);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newInvoice, setNewInvoice] = useState<Partial<TaxInvoice>>({
    taxInvoiceNo: getPreviewPattern('tax_invoice'),
    issueDate: timestampToHtmlDateValue(Date.now()),
    currency: 'THB',
    status: 'DRAFT',
    notes: ''
  });

  // Billing notes already linked to a tax invoice should not appear in dropdown
  const usedBillingNoteIds = useMemo(() => {
    if (!invoices) return new Set<string>();
    return new Set(invoices.filter(i => i.status !== 'CANCELLED').map(i => i.billingNoteId));
  }, [invoices]);

  const availableBillingNotes = useMemo(() => {
    if (!billingNotes) return [];
    return billingNotes.filter(n =>
      (n.status === 'ISSUED' || n.status === 'SUBMITTED') && !usedBillingNoteIds.has(n.id)
    );
  }, [billingNotes, usedBillingNoteIds]);

  const handleCreate = async () => {
    if (!firestore || !currentUser) return;
    if (!newInvoice.billingNoteId) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาระบุใบวางบิลอ้างอิง" });
      return;
    }

    const sourceNote = billingNotes?.find(n => n.id === newInvoice.billingNoteId);
    if (!sourceNote) return;

    if (usedBillingNoteIds.has(sourceNote.id)) {
      toast({ variant: "destructive", title: "ใบวางบิลนี้ออกใบกำกับภาษีแล้ว", description: "ไม่สามารถสร้างซ้ำได้" });
      return;
    }

    setIsCreating(true);
    try {
      const { code: finalNo } = await generateNextDocumentCode(firestore, 'tax_invoice', { actor: currentUser.displayName });

      const invoicePayload: Record<string, unknown> = {
        ...newInvoice,
        status: 'DRAFT',
        taxInvoiceNo: finalNo,
        customerId: sourceNote.customerId,
        taxableAmount: sourceNote.amountBeforeTax,
        vatAmount: sourceNote.vatAmount,
        withholdingTaxAmount: sourceNote.withholdingTaxAmount || 0,
        currency: sourceNote.currency || 'THB',
        totalAmount: sourceNote.netAmount,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      if (sourceNote.waveId) invoicePayload.waveId = sourceNote.waveId;
      const docRef = await addDoc(collection(firestore, 'tax_invoices'), invoicePayload);

      setIsDialogOpen(false);
      toast({
        title: 'สร้างใบแจ้งหนี้ร่างสำเร็จ',
        description: `เลขที่ ${finalNo} — แนบสลิปได้ที่หน้ารายละเอียด ก่อนกดออกเอกสารจริง (ISSUED)`,
      });
      router.push(`/tax-invoices/${docRef.id}`);
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถสร้างใบกำกับภาษีได้" });
    } finally {
      setIsCreating(false);
    }
  };

  const getStatusBadge = (status: TaxInvoiceStatus) => {
    switch (status) {
      case 'DRAFT': return <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200">DRAFT</Badge>;
      case 'ISSUED': return <Badge className="bg-green-600">ISSUED</Badge>;
      case 'CANCELLED': return <Badge variant="secondary">CANCELLED</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isUserLoading || userLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <FileBadge className="h-8 w-8" /> ใบกำกับภาษี (Tax Invoices)
          </h1>
          <p className="text-muted-foreground text-lg">
            สร้างใบแจ้งหนี้ร่าง (DRAFT) จากใบวางบิล — แนบรูปสลิปลงเวลาได้ก่อนยืนยันออกเอกสารจริง (ISSUED) จึงจะบันทึกลูกหนี้ (AR)
          </p>
        </div>

        <Alert className="bg-blue-50 border-blue-200 text-blue-800 shadow-sm">
          <Info className="h-5 w-5 text-blue-600" />
          <AlertTitle className="font-bold text-lg">นโยบายเอกสารภาษี (Tax Document Policy)</AlertTitle>
          <AlertDescription className="text-sm">
            สถานะ DRAFT ยังไม่กระทบลูกหนี้ — เมื่อเปลี่ยนเป็น ISSUED ระบบจะสร้าง AR และอัปเดตใบวางบิลเป็น INVOICED
          </AlertDescription>
        </Alert>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="ค้นหาเลขที่ใบกำกับภาษี..." className="pl-9 h-11" />
            </div>
            <Button variant="outline" className="h-11 gap-2"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
          </div>
          
          <Dialog open={isAuthorized && canCreateInvoice && isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button
                className="gap-2 h-11 px-6 bg-primary shadow-md text-base font-bold"
                disabled={!canCreateInvoice}
              >
                <Plus className="h-5 w-5" /> สร้างใบแจ้งหนี้ร่าง (Draft)
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>สร้างใบแจ้งหนี้ร่าง (Draft Tax Invoice)</DialogTitle>
                <DialogDescription>
                  เลือกใบวางบิลต้นทาง ระบบจะสร้างสถานะ DRAFT — ยังไม่บันทึกลูกหนี้จนกว่าจะยืนยัน ISSUED ที่หน้ารายละเอียด
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                <div className="space-y-2 md:col-span-2">
                  <Label>เลขที่ใบกำกับภาษี (Tax Invoice No.)</Label>
                  <Input value={newInvoice.taxInvoiceNo} disabled className="bg-muted/50 font-mono font-bold text-primary" />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>อ้างอิงใบวางบิล (Source Billing Note) *</Label>
                  <Select onValueChange={v => setNewInvoice({...newInvoice, billingNoteId: v})}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="เลือกใบวางบิล..." /></SelectTrigger>
                    <SelectContent>
                      {availableBillingNotes.map(n => (
                        <SelectItem key={n.id} value={n.id}>
                          {n.billingNoteNo} | {customers?.find(c => c.id === n.customerId)?.name} | {n.currency} {n.netAmount.toLocaleString()}
                        </SelectItem>
                      ))}
                      {availableBillingNotes.length === 0 && (
                        <div className="py-3 px-4 text-sm text-muted-foreground italic">ไม่มีใบวางบิลที่พร้อมออกใบกำกับภาษี</div>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>วันที่ออกเอกสาร (Issue Date)</Label>
                  <DatePickerThaiBE
                    className="h-11"
                    value={htmlDateValueToTimestampMs(newInvoice.issueDate)}
                    onChange={(ms) => setNewInvoice({ ...newInvoice, issueDate: timestampToHtmlDateValue(ms) })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isCreating}>ยกเลิก</Button>
                <Button onClick={handleCreate} className="bg-primary font-bold" disabled={isCreating}>
                  {isCreating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  สร้างร่าง (Create draft)
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูล...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4 pl-6">เลขที่ (Invoice No.)</TableHead>
                    <TableHead className="font-bold">ลูกค้า (Customer)</TableHead>
                    <TableHead className="font-bold">วันที่ออก</TableHead>
                    <TableHead className="font-bold text-right">ยอดรวมสุทธิ</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices?.map((inv) => {
                    const customer = customers?.find(c => c.id === inv.customerId);
                    return (
                      <TableRow 
                        key={inv.id} 
                        className="cursor-pointer hover:bg-muted/30 group transition-all" 
                        onClick={() => router.push(`/tax-invoices/${inv.id}`)}
                      >
                        <TableCell className="py-4 pl-6 font-bold text-primary font-mono">{inv.taxInvoiceNo}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-sm font-bold text-primary">
                            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                            {customer?.name || 'N/A'}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {formatStoredDateThaiBE(inv.issueDate)}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-black text-primary">
                          {inv.currency} {inv.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell>{getStatusBadge(inv.status)}</TableCell>
                        <TableCell className="text-right pr-6">
                          <Button variant="ghost" size="icon" className="group-hover:text-primary"><ChevronRight className="h-5 w-5" /></Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {(!invoices || invoices.length === 0) && !isLoading && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-20 text-muted-foreground italic">ไม่มีรายการใบกำกับภาษีในระบบ</TableCell>
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
