'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, FileText, Building2, Loader2, Info, ChevronRight, ExternalLink, RefreshCw, Ban, Trash2 } from 'lucide-react';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import {
  CommercialInvoice,
  Customer,
  PurchaseOrder,
  Wave,
  WaveMonthTimesheetReview,
} from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canView, canCreate, canEdit, isSystemAdmin } from '@/lib/permissions';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { getPreviewPattern } from '@/lib/services/numbering-service';
import {
  createCommercialDraftInvoice,
  ensureCommercialDraftInvoiceAfterMonthApproval,
  filterWaveMonthReviewsMissingCommercialDraft,
  voidCommercialInvoice,
  deleteCommercialInvoice,
} from '@/lib/services/commercial-invoice-service';
import { timestampToHtmlDateValue } from '@/lib/date-thai';
import Link from 'next/link';

function statusBadge(inv: CommercialInvoice) {
  const status = inv.status;
  if (status === 'PENDING_CUSTOMER' && inv.customerRevisionRequestedAt) {
    return <Badge className="bg-orange-700">ร้องขอแก้ไข</Badge>;
  }
  switch (status) {
    case 'DRAFT':
      return <Badge variant="secondary">ตรวจภายใน</Badge>;
    case 'PENDING_CUSTOMER':
      return <Badge className="bg-amber-600">รอลูกค้า</Badge>;
    case 'ISSUED':
      return <Badge className="bg-green-600">ยืนยันแล้ว</Badge>;
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
  const canVoidInvoice = useMemo(
    () => !!currentUser && canEdit(currentUser, 'draft_invoices'),
    [currentUser]
  );
  const canHardDeleteInvoice = useMemo(() => !!currentUser && isSystemAdmin(currentUser), [currentUser]);

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
  const [syncRowId, setSyncRowId] = useState<string | null>(null);
  const [syncingBulk, setSyncingBulk] = useState(false);
  const [voidTarget, setVoidTarget] = useState<CommercialInvoice | null>(null);
  const [voidBusy, setVoidBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CommercialInvoice | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const approvedReviewsQuery = useMemoFirebase(
    () =>
      firestore && isAuthorized
        ? query(collection(firestore, 'wave_month_timesheet_reviews'), where('status', '==', 'approved'))
        : null,
    [firestore, isAuthorized]
  );
  const { data: approvedReviews } = useCollection<WaveMonthTimesheetReview>(approvedReviewsQuery as any);

  const wavesLookupQuery = useMemoFirebase(
    () => (firestore && isAuthorized ? collection(firestore, 'waves') : null),
    [firestore, isAuthorized]
  );
  const { data: allWaves } = useCollection<Wave>(wavesLookupQuery as any);

  const posLookupQuery = useMemoFirebase(
    () => (firestore && isAuthorized ? collection(firestore, 'purchase_orders') : null),
    [firestore, isAuthorized]
  );
  const { data: allPos } = useCollection<PurchaseOrder>(posLookupQuery as any);

  const missingReviews = useMemo(
    () => filterWaveMonthReviewsMissingCommercialDraft(approvedReviews ?? [], invoices ?? []),
    [approvedReviews, invoices]
  );

  const poById = useMemo(() => {
    const m = new Map<string, PurchaseOrder>();
    for (const p of allPos ?? []) m.set(p.id, p);
    return m;
  }, [allPos]);

  const waveById = useMemo(() => {
    const m = new Map<string, Wave>();
    for (const w of allWaves ?? []) m.set(w.id, w);
    return m;
  }, [allWaves]);

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

  const sortedMissingReviews = useMemo(() => {
    const list = [...missingReviews];
    list.sort((a, b) => (a.yearMonth < b.yearMonth ? 1 : a.yearMonth > b.yearMonth ? -1 : 0));
    return list;
  }, [missingReviews]);

  const handleEnsureFromReview = async (review: WaveMonthTimesheetReview) => {
    if (!firestore || !currentUser || !canCreateDoc) return;
    setSyncRowId(review.id);
    try {
      const res = await ensureCommercialDraftInvoiceAfterMonthApproval(firestore, review, currentUser);
      if (res.ok === true) {
        toast({
          title: 'สร้างใบแจ้งหนี้ร่างแล้ว',
          description: `เลขที่ ${res.invoiceNo} — ตรวจยอด สั่งพิมพ์ และส่งลูกค้าได้จากหน้ารายละเอียด`,
        });
        router.push(`/draft-invoices/${res.id}`);
      } else {
        toast({
          variant: 'destructive',
          title: 'ยังสร้างใบไม่ได้',
          description: res.reason,
        });
      }
    } finally {
      setSyncRowId(null);
    }
  };

  const handleEnsureAllMissing = async () => {
    if (!firestore || !currentUser || !canCreateDoc || sortedMissingReviews.length === 0) return;
    setSyncingBulk(true);
    let ok = 0;
    const errors: string[] = [];
    try {
      for (const r of sortedMissingReviews) {
        const res = await ensureCommercialDraftInvoiceAfterMonthApproval(firestore, r, currentUser);
        if (res.ok === true) ok++;
        else errors.push(`${r.yearMonth}: ${res.reason}`);
      }
      toast({
        title: 'สร้างจากงวดที่อนุมัติแล้ว',
        description:
          errors.length === 0
            ? `สำเร็จ ${ok} รายการ — ดูในรายการด้านล่าง`
            : `สำเร็จ ${ok} — มีข้อผิดพลาด ${errors.length} รายการ: ${errors.slice(0, 3).join(' · ')}`,
        variant: ok === 0 && errors.length > 0 ? 'destructive' : 'default',
      });
    } finally {
      setSyncingBulk(false);
    }
  };

  const handleConfirmVoid = async () => {
    if (!firestore || !currentUser || !voidTarget) return;
    setVoidBusy(true);
    try {
      await voidCommercialInvoice(firestore, voidTarget.id, currentUser);
      toast({
        title: 'ยกเลิกแล้ว',
        description: `${voidTarget.invoiceNo} — สถานะ VOID`,
      });
      setVoidTarget(null);
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'ยกเลิกไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setVoidBusy(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!firestore || !currentUser || !deleteTarget || !canHardDeleteInvoice) return;
    setDeleteBusy(true);
    try {
      await deleteCommercialInvoice(firestore, deleteTarget.id, currentUser);
      toast({
        title: 'ลบแล้ว',
        description: `${deleteTarget.invoiceNo} — ถูกลบถาวรจากระบบ`,
      });
      setDeleteTarget(null);
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'ลบไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setDeleteBusy(false);
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

        {sortedMissingReviews.length > 0 && (
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="text-base text-primary">งวด timesheet อนุมัติแล้ว — ยังไม่มีใบแจ้งหนี้ร่าง</CardTitle>
                <CardDescription>
                  หลังผู้จัดการอนุมัติรอบเดือน ระบบควรสร้างใบอัตโนมัติ — ถ้ายังไม่มี ให้กดสร้างจากรายการด้านล่างเพื่อนำไปตรวจสอบ พิมพ์ และส่งลูกค้า
                </CardDescription>
              </div>
              {canCreateDoc && (
                <Button
                  className="gap-2 shrink-0"
                  variant="secondary"
                  disabled={syncingBulk}
                  onClick={() => void handleEnsureAllMissing()}
                >
                  {syncingBulk ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  สร้างใบที่ขาดทั้งหมด ({sortedMissingReviews.length})
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">เดือน (งวด)</TableHead>
                    <TableHead>PO</TableHead>
                    <TableHead>Wave</TableHead>
                    <TableHead className="text-right pr-6">การทำงาน</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedMissingReviews.map((r) => {
                    const po = poById.get(r.poId);
                    const wv = waveById.get(r.waveId);
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="pl-6 font-mono text-sm">{r.yearMonth}</TableCell>
                        <TableCell className="text-sm">{po?.poCode ?? r.poId}</TableCell>
                        <TableCell className="text-sm font-mono">{wv?.waveCode ?? r.waveId.slice(0, 10)}</TableCell>
                        <TableCell className="text-right pr-6">
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button variant="outline" size="sm" className="h-8 gap-1" asChild>
                              <Link
                                href={`/timesheets/wave-month?month=${encodeURIComponent(r.yearMonth)}&highlightWave=${encodeURIComponent(r.waveId)}`}
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                ดูสรุปรายเดือน
                              </Link>
                            </Button>
                            {canCreateDoc && (
                              <Button
                                size="sm"
                                className="h-8 gap-1"
                                disabled={syncRowId === r.id || syncingBulk}
                                onClick={() => void handleEnsureFromReview(r)}
                              >
                                {syncRowId === r.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Plus className="h-3.5 w-3.5" />
                                )}
                                สร้างใบร่าง
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>รายการใบแจ้งหนี้ร่าง</CardTitle>
            <CardDescription>
              เรียงตามวันที่เอกสาร — เปิดเพื่อตรวจยอด / พิมพ์ / ส่งลูกค้า — ยกเลิก (VOID) เมื่อต้องการหยุดใช้งานแต่ยังเก็บประวัติในระบบ —{' '}
              <span className="text-foreground font-medium">ลบถาวร</span> เฉพาะผู้ดูแลระบบ (System Admin)
            </CardDescription>
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
                      <TableCell>{statusBadge(inv)}</TableCell>
                      <TableCell className="text-right pr-6">
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/draft-invoices/${inv.id}`}>
                              เปิด <ChevronRight className="h-4 w-4 ml-1" />
                            </Link>
                          </Button>
                          {canVoidInvoice &&
                            (inv.status === 'DRAFT' || inv.status === 'PENDING_CUSTOMER') && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="text-destructive border-destructive/30 hover:bg-destructive/10"
                                onClick={() => setVoidTarget(inv)}
                              >
                                <Ban className="h-3.5 w-3.5 mr-1 shrink-0" />
                                ยกเลิก
                              </Button>
                            )}
                          {canHardDeleteInvoice && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="text-destructive border-destructive/40 hover:bg-destructive/15"
                              onClick={() => setDeleteTarget(inv)}
                              title="ลบถาวร — เฉพาะผู้ดูแลระบบ"
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-1 shrink-0" />
                              ลบ
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {(!invoices || invoices.length === 0) && !isLoading && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                      ยังไม่มีรายการ — ใช้ปุ่มสร้างด้านบน หรือสร้างจากงวดที่อนุมัติแล้ว (กล่องสีฟ้า)
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <AlertDialog open={voidTarget !== null} onOpenChange={(open) => !open && !voidBusy && setVoidTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ยกเลิกใบ {voidTarget?.invoiceNo ?? ''}?</AlertDialogTitle>
              <AlertDialogDescription>
                สถานะจะเป็น VOID — สร้างใบใหม่จากงวดหรือ Wave / Timesheet ได้อีกครั้ง (ไม่ลบประวัติเอกสาร)
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={voidBusy}>ไม่</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={voidBusy}
                onClick={(e) => {
                  e.preventDefault();
                  void handleConfirmVoid();
                }}
              >
                {voidBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ยืนยันยกเลิก'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && !deleteBusy && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ลบถาวร {deleteTarget?.invoiceNo ?? ''}?</AlertDialogTitle>
              <AlertDialogDescription>
                ลบเอกสารออกจากฐานข้อมูล — ไม่สามารถกู้คืนได้ ใช้เมื่อต้องการเคลียร์รายการทดสอบหรือเอกสารผิดพลาดร้ายแรง
                {deleteTarget?.status === 'ISSUED' || deleteTarget?.status === 'PENDING_CUSTOMER' ? (
                  <span className="block mt-2 font-medium text-destructive">
                    ใบนี้เคยส่งลูกค้าหรือยืนยันแล้ว — ตรวจสอบให้แน่ใจก่อนลบ
                  </span>
                ) : null}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteBusy}>ไม่</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={deleteBusy}
                onClick={(e) => {
                  e.preventDefault();
                  void handleConfirmDelete();
                }}
              >
                {deleteBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ยืนยันลบถาวร'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppShell>
  );
}
