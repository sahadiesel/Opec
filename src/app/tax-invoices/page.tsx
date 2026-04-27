
'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import {
  formatStoredDateThaiBE,
} from '@/lib/date-thai';
import { TaxInvoice, TaxInvoiceStatus, User, Customer, CommercialInvoice } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canView, canCreate } from '@/lib/permissions';
import { collection, query, orderBy, where } from 'firebase/firestore';
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
import { Input } from '@/components/ui/input';
import { getPreviewPattern } from '@/lib/services/numbering-service';
import { createTaxInvoiceDraftFromIssuedCommercial } from '@/lib/services/tax-invoice-from-commercial-service';

export default function TaxInvoicesPage() {
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { isUserLoading } = useUser();
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

  /** ใบแจ้งหนี้เชิงพาณิชย์ที่อนุมัติแล้ว (ISSUED) และยังไม่มีใบกำกับภาษี */
  const commercialIssuedQuery = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return query(collection(firestore, 'commercial_invoices'), where('status', '==', 'ISSUED'));
  }, [firestore, isAuthorized]);
  const { data: issuedCommercial } = useCollection<CommercialInvoice>(commercialIssuedQuery as any);

  const availableCommercialInvoices = useMemo(() => {
    if (!issuedCommercial?.length) return [];
    return issuedCommercial.filter((c) => !c.linkedTaxInvoiceId);
  }, [issuedCommercial]);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedCommercialId, setSelectedCommercialId] = useState<string>('');

  const handleCreate = async () => {
    if (!firestore || !currentUser) return;
    if (!selectedCommercialId) {
      toast({
        variant: 'destructive',
        title: 'ข้อมูลไม่ครบ',
        description: 'เลือกใบแจ้งหนี้ (รายการเรียกเก็บ) ที่อนุมัติแล้ว',
      });
      return;
    }

    setIsCreating(true);
    try {
      const { taxInvoiceId, taxInvoiceNo } = await createTaxInvoiceDraftFromIssuedCommercial(
        firestore,
        selectedCommercialId,
        currentUser as User,
      );

      setIsDialogOpen(false);
      setSelectedCommercialId('');
      toast({
        title: 'สร้างใบกำกับภาษีร่างสำเร็จ',
        description: `เลขที่ ${taxInvoiceNo} — แนบสลิปได้ที่หน้ารายละเอียด ก่อนกดออกเอกสารจริง (ISSUED)`,
      });
      router.push(`/tax-invoices/${taxInvoiceId}`);
    } catch (e: unknown) {
      console.error(e);
      const msg = e instanceof Error ? e.message : 'ไม่สามารถสร้างใบกำกับภาษีได้';
      toast({ variant: 'destructive', title: 'ไม่สามารถสร้างได้', description: msg });
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
            <FileBadge className="h-8 w-8" /> ใบกำกับภาษี
          </h1>
          <p className="text-muted-foreground text-lg">
            ออกจากใบแจ้งหนี้ที่อนุมัติแล้ว หรือสร้างฉบับอิสระ (ไม่ใช่ e-Tax) — เมื่อ ISSUED บันทึกลูกหนี้; หลังแจ้งชำระและยืนยันรับเงิน
            ระบบออก ใบเสร็จรับเงิน แยก (เมนู ใบเสร็จ)
          </p>
        </div>

        <Alert className="bg-blue-50 border-blue-200 text-blue-800 shadow-sm">
          <Info className="h-5 w-5 text-blue-600" />
          <AlertTitle className="font-bold text-lg">นโยบายเอกสารภาษี (Tax Document Policy)</AlertTitle>
          <AlertDescription className="text-sm">
            สถานะ DRAFT ยังไม่กระทบลูกหนี้ — เมื่อเปลี่ยนเป็น ISSUED ระบบจะสร้าง AR ตามยอดใบแจ้งหนี้ที่อ้างอิง (ข้อมูลอ้างอิงมาจากเมนู «รายการใบแจ้งหนี้» ไม่ต้องใช้เมนูใบวางบิล)
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
          
          <Dialog
            open={isAuthorized && canCreateInvoice && isDialogOpen}
            onOpenChange={(open) => {
              setIsDialogOpen(open);
              if (!open) setSelectedCommercialId('');
            }}
          >
            <DialogTrigger asChild>
              <Button
                className="gap-2 h-11 px-6 bg-primary shadow-md text-base font-bold"
                disabled={!canCreateInvoice}
              >
                <Plus className="h-5 w-5" /> สร้างใบกำกับภาษีร่าง
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>สร้างใบกำกับภาษีร่าง</DialogTitle>
                <DialogDescription>
                  เลือกใบแจ้งหนี้จากเมนู «รายการใบแจ้งหนี้» ที่ลูกค้า/ผู้จัดการอนุมัติแล้ว (สถานะ ISSUED) และยังไม่เคยออกใบกำกับภาษี — ระบบจะสร้างสถานะ DRAFT สำหรับบัญชีพิมพ์และยืนยันเมื่อรับเงิน
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 gap-4 py-4">
                <div className="space-y-2">
                  <Label>เลขที่ใบกำกับภาษี (คาดการณ์)</Label>
                  <Input value={getPreviewPattern('tax_invoice')} disabled className="bg-muted/50 font-mono font-bold text-primary" />
                  <p className="text-xs text-muted-foreground">เลขจริงออกตอนบันทึก</p>
                </div>
                <div className="space-y-2">
                  <Label>อ้างอิงใบแจ้งหนี้ (รายการเรียกเก็บ) *</Label>
                  <Select value={selectedCommercialId || undefined} onValueChange={setSelectedCommercialId}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="เลือกใบแจ้งหนี้ที่อนุมัติแล้ว..." /></SelectTrigger>
                    <SelectContent>
                      {availableCommercialInvoices.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.invoiceNo} | {customers?.find((x) => x.id === c.customerId)?.name ?? c.customerId} |{' '}
                          {c.currency ?? 'THB'} {c.totalAmount.toLocaleString()}
                        </SelectItem>
                      ))}
                      {availableCommercialInvoices.length === 0 && (
                        <div className="py-3 px-4 text-sm text-muted-foreground italic">
                          ไม่มีใบแจ้งหนี้ที่พร้อมออกใบกำกับภาษี — ต้องอนุมัติใบในเมนู «รายการใบแจ้งหนี้» และยังไม่เคยสร้างใบกำกับจากใบนั้น
                        </div>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isCreating}>ยกเลิก</Button>
                <Button onClick={() => void handleCreate()} className="bg-primary font-bold" disabled={isCreating || !selectedCommercialId}>
                  {isCreating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  สร้างร่าง
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
