'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, FileText, Building2, Loader2, Info, ChevronRight } from 'lucide-react';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { CommercialInvoice, CommercialInvoiceStatus, Customer, PurchaseOrder, Wave } from '@/lib/types';
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
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { getPreviewPattern } from '@/lib/services/numbering-service';
import { createCommercialDraftInvoice } from '@/lib/services/commercial-invoice-service';
import { timestampToHtmlDateValue } from '@/lib/date-thai';
import Link from 'next/link';

function statusBadge(status: CommercialInvoiceStatus) {
  switch (status) {
    case 'DRAFT':
      return <Badge variant="secondary">DRAFT</Badge>;
    case 'PENDING_CUSTOMER':
      return <Badge className="bg-amber-600">รอลูกค้า</Badge>;
    case 'ISSUED':
      return <Badge className="bg-green-600">Invoice แล้ว</Badge>;
    case 'VOID':
      return <Badge variant="outline">ยกเลิก</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export default function DraftInvoicesPage() {
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const isAuthorized = useMemo(
    () => !!currentUser && canView(currentUser, 'draft_invoices'),
    [currentUser]
  );
  const canCreateDoc = useMemo(
    () => !!currentUser && canCreate(currentUser, 'draft_invoices'),
    [currentUser]
  );

  const listQuery = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return query(collection(firestore, 'commercial_invoices'), orderBy('issueDate', 'desc'));
  }, [firestore, isAuthorized]);

  const { data: invoices, isLoading } = useCollection<CommercialInvoice>(listQuery as any);

  const customersQuery = useMemoFirebase(
    () => (firestore && isAuthorized ? collection(firestore, 'customers') : null),
    [firestore, isAuthorized]
  );
  const { data: customers } = useCollection<Customer>(customersQuery as any);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [customerId, setCustomerId] = useState<string>('');
  const [poId, setPoId] = useState<string>('');
  const [waveId, setWaveId] = useState<string>('');
  const [periodStartMs, setPeriodStartMs] = useState(() => Date.now());
  const [periodEndMs, setPeriodEndMs] = useState(() => Date.now());
  const [issueDateMs, setIssueDateMs] = useState(() => Date.now());

  const poQuery = useMemoFirebase(
    () =>
      firestore && customerId
        ? query(collection(firestore, 'purchase_orders'), where('customerId', '==', customerId))
        : null,
    [firestore, customerId]
  );
  const { data: pos } = useCollection<PurchaseOrder>(poQuery as any);

  const wavesQuery = useMemoFirebase(
    () =>
      firestore && poId ? query(collection(firestore, 'waves'), where('poId', '==', poId)) : null,
    [firestore, poId]
  );
  const { data: waves } = useCollection<Wave>(wavesQuery as any);

  const resetForm = () => {
    setCustomerId('');
    setPoId('');
    setWaveId('');
    const n = Date.now();
    setPeriodStartMs(n);
    setPeriodEndMs(n);
    setIssueDateMs(n);
  };

  const handleCreate = async () => {
    if (!firestore || !currentUser) return;
    if (!poId || !waveId) {
      toast({ variant: 'destructive', title: 'ข้อมูลไม่ครบ', description: 'เลือก PO และ Wave' });
      return;
    }
    setCreating(true);
    try {
      const { id, invoiceNo } = await createCommercialDraftInvoice(firestore, {
        poId,
        waveId,
        periodStart: timestampToHtmlDateValue(periodStartMs),
        periodEnd: timestampToHtmlDateValue(periodEndMs),
        issueDate: timestampToHtmlDateValue(issueDateMs),
        actor: currentUser,
      });
      toast({
        title: 'สร้างใบแจ้งหนี้ร่างแล้ว',
        description: `เลขที่ ${invoiceNo} — เอกสารเรียกเก็บ (ยังไม่ใช่ใบกำกับภาษี)`,
      });
      setDialogOpen(false);
      resetForm();
      router.push(`/draft-invoices/${id}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'สร้างไม่สำเร็จ';
      toast({ variant: 'destructive', title: 'ไม่สามารถสร้างได้', description: msg });
    } finally {
      setCreating(false);
    }
  };

  if (isUserLoading || userLoading || !currentUser) return null;

  if (!isAuthorized) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="p-6 text-muted-foreground">ไม่มีสิทธิ์เข้าถึงเมนูนี้</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 p-4 md:p-6 max-w-6xl mx-auto">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary flex items-center gap-2">
              <FileText className="h-7 w-7" />
              ใบแจ้งหนี้ร่าง (เรียกเก็บลูกค้า)
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              สร้างจาก timesheet / wave — แยกจากใบกำกับภาษี (บัญชีออกภายหลังเมื่อได้รับเงิน)
            </p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2" disabled={!canCreateDoc}>
                <Plus className="h-4 w-4" />
                สร้างจาก Wave / Timesheet
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>สร้างใบแจ้งหนี้ร่าง</DialogTitle>
                <DialogDescription>
                  เลือกลูกค้า → PO → Wave และช่วงวันที่ — ระบบดึง timesheet ที่{' '}
                  <code className="text-xs">readyForBilling</code> ตามช่วงที่เลือก
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="rounded-md bg-muted/50 px-3 py-2 text-xs font-mono text-muted-foreground">
                  เลขที่คาดการณ์: {getPreviewPattern('commercial_invoice')}
                </div>
                <div className="space-y-2">
                  <Label>ลูกค้า</Label>
                  <Select
                    value={customerId || '__none__'}
                    onValueChange={(v) => {
                      setCustomerId(v === '__none__' ? '' : v);
                      setPoId('');
                      setWaveId('');
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="เลือกลูกค้า" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— เลือก —</SelectItem>
                      {(customers ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name || c.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>ใบสั่งซื้อ (PO)</Label>
                  <Select
                    value={poId || '__none__'}
                    onValueChange={(v) => {
                      setPoId(v === '__none__' ? '' : v);
                      setWaveId('');
                    }}
                    disabled={!customerId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="เลือก PO" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— เลือก —</SelectItem>
                      {(pos ?? []).map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.poCode || p.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Wave</Label>
                  <Select
                    value={waveId || '__none__'}
                    onValueChange={(v) => setWaveId(v === '__none__' ? '' : v)}
                    disabled={!poId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="เลือก Wave" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— เลือก —</SelectItem>
                      {(waves ?? []).map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.waveCode} — {w.projectName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>ตั้งแต่วันที่</Label>
                    <DatePickerThaiBE value={periodStartMs} onChange={setPeriodStartMs} />
                  </div>
                  <div>
                    <Label>ถึงวันที่</Label>
                    <DatePickerThaiBE value={periodEndMs} onChange={setPeriodEndMs} />
                  </div>
                </div>
                <div>
                  <Label>วันที่เอกสาร</Label>
                  <DatePickerThaiBE value={issueDateMs} onChange={setIssueDateMs} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={creating}>
                  ยกเลิก
                </Button>
                <Button onClick={() => void handleCreate()} disabled={creating}>
                  {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  สร้างร่าง
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>ไม่ใช่ใบกำกับภาษี</AlertTitle>
          <AlertDescription>
            เอกสารนี้เป็นใบแจ้งหนี้ทางการค้าให้ลูกค้าตรวจสอบยอดจาก timesheet — ใบกำกับภาษีออกจากเมนูบัญชีหลังได้รับเงินตามขั้นตอนที่กำหนด
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>รายการ</CardTitle>
            <CardDescription>เรียงตามวันที่เอกสาร</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">เลขที่</TableHead>
                  <TableHead>ลูกค้า</TableHead>
                  <TableHead>Wave</TableHead>
                  <TableHead className="text-right">ยอดรวม</TableHead>
                  <TableHead>สถานะ</TableHead>
                  <TableHead className="text-right pr-6">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(invoices ?? []).map((inv) => {
                  const cust = customers?.find((c) => c.id === inv.customerId);
                  return (
                    <TableRow key={inv.id}>
                      <TableCell className="pl-6 font-mono font-semibold">{inv.invoiceNo}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          {cust?.name ?? inv.customerId}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs font-mono">{inv.waveCode || `${inv.waveId.slice(0, 8)}…`}</TableCell>
                      <TableCell className="text-right">
                        ฿{(inv.totalAmount ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell>{statusBadge(inv.status)}</TableCell>
                      <TableCell className="text-right pr-6">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/draft-invoices/${inv.id}`}>
                            เปิด <ChevronRight className="h-4 w-4 ml-1" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {(!invoices || invoices.length === 0) && !isLoading && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                      ยังไม่มีรายการ — กดสร้างจาก Wave / Timesheet
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
