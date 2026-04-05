'use client';

import { useState, use, useMemo, useRef } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  ArrowLeft,
  Plus,
  Trash2,
  PackageSearch,
  CheckCircle2,
  Loader2,
  Calculator,
  Printer,
  Send,
  XCircle,
  RotateCcw,
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection, updateDoc } from 'firebase/firestore';
import { updateDocumentNonBlocking, addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import {
  Purchase,
  PurchaseLine,
  PurchaseStatus,
  User,
  Vendor,
  StoreItem,
  formatStoreItemLabel,
} from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAppUser } from '@/hooks/use-app-user';
import { canView, canEdit, canDelete, canApprovePurchaseAsManager } from '@/lib/permissions';

function statusLabelTh(status: PurchaseStatus): string {
  const m: Record<string, string> = {
    DRAFT: 'ฉบับร่าง',
    PENDING_APPROVAL: 'รออนุมัติ',
    RETURNED_FOR_REVISION: 'ส่งกลับแก้ไข',
    APPROVED: 'อนุมัติแล้ว',
    REJECTED: 'ไม่อนุมัติ',
    ISSUED: 'ออกใบสั่งแล้ว',
    COMPLETED: 'เสร็จสิ้น',
    CANCELLED: 'ยกเลิก',
  };
  return m[status] || status;
}

function canEditLinesStatus(status: PurchaseStatus): boolean {
  return status === 'DRAFT' || status === 'RETURNED_FOR_REVISION';
}

export default function PurchaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const printRef = useRef<HTMLDivElement>(null);

  const canViewPurchases = useMemo(() => canView(currentUser, 'purchases'), [currentUser]);
  const canEditPurchases = useMemo(() => canEdit(currentUser, 'purchases'), [currentUser]);
  const canDeletePurchases = useMemo(() => canDelete(currentUser, 'purchases'), [currentUser]);
  const canApprove = useMemo(() => canApprovePurchaseAsManager(currentUser), [currentUser]);

  const purchaseRef = useMemoFirebase(
    () => (firestore && canViewPurchases ? doc(firestore, 'purchases', id) : null),
    [firestore, id, canViewPurchases]
  );
  const { data: purchase, isLoading: isPurchaseLoading } = useDoc<Purchase>(purchaseRef as any);

  const linesQuery = useMemoFirebase(
    () => (firestore && canViewPurchases ? collection(firestore, 'purchases', id, 'lines') : null),
    [firestore, id, canViewPurchases]
  );
  const { data: lines } = useCollection<PurchaseLine>(linesQuery as any);

  const vendorsQuery = useMemoFirebase(
    () => (firestore && canViewPurchases ? collection(firestore, 'vendors') : null),
    [firestore, canViewPurchases]
  );
  const { data: vendors } = useCollection<Vendor>(vendorsQuery as any);

  const storeItemsQuery = useMemoFirebase(
    () => (firestore && canViewPurchases ? collection(firestore, 'store_items') : null),
    [firestore, canViewPurchases]
  );
  const { data: storeItems } = useCollection<StoreItem>(storeItemsQuery as any);

  const vendor = vendors?.find((v) => v.id === purchase?.vendorId);

  const lineMode = purchase?.purchaseLineMode || 'SERVICE';
  const linesEditable = purchase && canEditLinesStatus(purchase.status) && canEditPurchases;

  const [isAddingLine, setIsAddingLine] = useState(false);
  const [newLine, setNewLine] = useState<Partial<PurchaseLine>>({
    itemDescription: '',
    quantity: 1,
    unitPrice: 0,
  });
  const [selectedStoreItemId, setSelectedStoreItemId] = useState<string>('');
  const [managerComment, setManagerComment] = useState('');

  const recalculateTotals = (currentLines: PurchaseLine[]) => {
    if (!purchaseRef) return;
    const amountBeforeTax = currentLines.reduce((sum, l) => sum + Number(l.amount), 0);
    const vatAmount = amountBeforeTax * 0.07;
    const totalAmount = amountBeforeTax + vatAmount;

    updateDoc(purchaseRef, {
      amountBeforeTax,
      vatAmount,
      totalAmount,
      updatedAt: Date.now(),
    });
  };

  const handleAddLine = async () => {
    if (!linesEditable) {
      toast({ variant: 'destructive', title: 'แก้ไขไม่ได้', description: 'สถานะเอกสารไม่อนุญาตให้แก้รายการ' });
      return;
    }
    if (!firestore) return;

    if (lineMode === 'INVENTORY') {
      const si = storeItems?.find((s) => s.id === selectedStoreItemId);
      if (!si) {
        toast({ variant: 'destructive', title: 'เลือกรายการคลัง', description: 'ถ้ายังไม่มีรายการ ให้ไปเพิ่มที่ทะเบียนคลังก่อน' });
        return;
      }
      if (!newLine.quantity || newLine.unitPrice == null) return;
      const desc = formatStoreItemLabel(si);
      const amount = Number(newLine.quantity) * Number(newLine.unitPrice);
      await addDocumentNonBlocking(collection(firestore, 'purchases', id, 'lines'), {
        itemDescription: desc,
        storeItemId: si.id,
        quantity: Number(newLine.quantity),
        unitPrice: Number(newLine.unitPrice),
        purchaseId: id,
        amount,
        createdAt: Date.now(),
      });
      recalculateTotals([
        ...(lines || []),
        {
          id: 'tmp',
          purchaseId: id,
          itemDescription: desc,
          storeItemId: si.id,
          quantity: Number(newLine.quantity),
          unitPrice: Number(newLine.unitPrice),
          amount,
          createdAt: Date.now(),
        },
      ]);
    } else {
      if (!newLine.itemDescription || !newLine.quantity || newLine.unitPrice == null) return;
      const amount = Number(newLine.quantity) * Number(newLine.unitPrice);
      await addDocumentNonBlocking(collection(firestore, 'purchases', id, 'lines'), {
        ...newLine,
        purchaseId: id,
        amount,
        createdAt: Date.now(),
      });
      recalculateTotals([...(lines || []), { ...newLine, amount } as PurchaseLine]);
    }

    setIsAddingLine(false);
    setNewLine({ itemDescription: '', quantity: 1, unitPrice: 0 });
    setSelectedStoreItemId('');
    toast({ title: 'เพิ่มรายการสำเร็จ' });
  };

  const handleDeleteLine = async (lineId: string) => {
    if (!linesEditable || !canDeletePurchases) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'ไม่สามารถลบรายการในสถานะนี้' });
      return;
    }
    if (!firestore) return;
    await deleteDocumentNonBlocking(doc(firestore, 'purchases', id, 'lines', lineId));
    recalculateTotals(lines?.filter((l) => l.id !== lineId) || []);
    toast({ title: 'ลบรายการสำเร็จ' });
  };

  const submitForApproval = async () => {
    if (!purchaseRef || !canEditPurchases) return;
    if (!lines?.length) {
      toast({ variant: 'destructive', title: 'ไม่มีรายการ', description: 'เพิ่มรายการก่อนส่งขออนุมัติ' });
      return;
    }
    await updateDocumentNonBlocking(purchaseRef, {
      status: 'PENDING_APPROVAL' as PurchaseStatus,
      approvalRequestedAt: Date.now(),
      updatedAt: Date.now(),
    });
    toast({ title: 'ส่งขออนุมัติแล้ว', description: 'รอผู้จัดการปฏิบัติการพิจารณา' });
  };

  const managerDecision = async (
    decision: 'APPROVED' | 'REJECTED' | 'RETURNED_FOR_REVISION',
    extra?: { rejectionReason?: string }
  ) => {
    if (!purchaseRef || !canApprove) return;
    const name = currentUser?.displayName || currentUser?.email || '';
    await updateDocumentNonBlocking(purchaseRef, {
      status: decision,
      approvalDecidedAt: Date.now(),
      approvalDecisionByUid: currentUser?.id,
      approvalDecisionByName: name,
      approvalComment: managerComment || null,
      rejectionReason: decision === 'REJECTED' ? extra?.rejectionReason || managerComment || null : null,
      updatedAt: Date.now(),
    });
    setManagerComment('');
    toast({
      title: decision === 'APPROVED' ? 'อนุมัติแล้ว' : decision === 'REJECTED' ? 'ไม่อนุมัติ' : 'ส่งกลับแก้ไข',
    });
  };

  const handleLegacyIssue = () => {
    if (!canEditPurchases || !purchaseRef) return;
    updateDocumentNonBlocking(purchaseRef, { status: 'ISSUED' as PurchaseStatus, updatedAt: Date.now() });
    toast({ title: 'อัปเดตสถานะ' });
  };

  const handleLegacyComplete = () => {
    if (!canEditPurchases || !purchaseRef) return;
    updateDocumentNonBlocking(purchaseRef, { status: 'COMPLETED' as PurchaseStatus, updatedAt: Date.now() });
    toast({ title: 'ปิดรายการแล้ว' });
  };

  const handlePrint = () => {
    if (purchase?.status !== 'APPROVED') {
      toast({ variant: 'destructive', title: 'พิมพ์ไม่ได้', description: 'ต้องได้รับการอนุมัติจากผู้จัดการก่อน' });
      return;
    }
    const w = window.open('', '_blank');
    if (!w || !printRef.current) return;
    w.document.write(`<!DOCTYPE html><html><head><title>${purchase.purchaseNo}</title>
      <style>body{font-family:system-ui;padding:24px;} .stamp{color:green;font-weight:bold;font-size:18px;border:2px solid green;padding:8px;display:inline-block;margin-bottom:16px;}</style></head><body>`);
    w.document.write(`<div class="stamp">MANAGER APPROVED — อนุมัติโดยผู้จัดการแล้ว</div>`);
    w.document.write(printRef.current.innerHTML);
    w.document.write('</body></html>');
    w.document.close();
    w.focus();
    w.print();
    w.close();
  };

  if (userLoading || !currentUser) return null;
  if (!canViewPurchases) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-5xl mx-auto py-10 text-center text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงเมนูนี้</div>
      </AppShell>
    );
  }
  if (isPurchaseLoading || !purchase) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-12 w-12 text-primary animate-spin" />
      </div>
    );
  }

  const useNewApprovalFlow =
    purchase.status === 'DRAFT' ||
    purchase.status === 'PENDING_APPROVAL' ||
    purchase.status === 'RETURNED_FOR_REVISION' ||
    purchase.status === 'APPROVED' ||
    purchase.status === 'REJECTED' ||
    purchase.approvalRequestedAt != null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div ref={printRef} className="max-w-[1600px] mx-auto space-y-6 print:block">
        <div className="flex items-center justify-between print:hidden">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.push('/purchases')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">รายละเอียดการสั่งซื้อ</h1>
              <div className="text-sm text-muted-foreground flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold text-primary">{purchase.purchaseNo}</span>
                <Separator orientation="vertical" className="h-3" />
                <span>คู่ค้า: {vendor?.vendorName || '...'}</span>
                <Separator orientation="vertical" className="h-3" />
                <span>
                  แบบรายการ:{' '}
                  {lineMode === 'INVENTORY' ? 'เลือกจากคลัง' : 'สั่งจ้าง / คีย์มือ'}
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <Badge variant="outline" className="py-1.5 px-4 font-bold border-primary/20 bg-primary/5 text-primary">
              {statusLabelTh(purchase.status)}
            </Badge>
            {purchase.status === 'APPROVED' && (
              <Button variant="outline" className="font-bold gap-2" onClick={handlePrint}>
                <Printer className="h-4 w-4" /> พิมพ์เอกสาร
              </Button>
            )}
          </div>
        </div>

        {/* Printable header (included in print window via clone) */}
        <div className="hidden print:block">
          <h1 className="text-xl font-bold">ใบสั่งซื้อ {purchase.purchaseNo}</h1>
          <p>คู่ค้า: {vendor?.vendorName}</p>
          <p>วันที่: {purchase.purchaseDate}</p>
        </div>

        {purchase.status === 'REJECTED' && purchase.rejectionReason && (
          <Card className="border-destructive print:hidden">
            <CardHeader>
              <CardTitle className="text-destructive text-base">เหตุผลไม่อนุมัติ</CardTitle>
              <CardDescription>{purchase.rejectionReason}</CardDescription>
            </CardHeader>
          </Card>
        )}

        {purchase.status === 'PENDING_APPROVAL' && canApprove && (
          <Card className="border-amber-300 bg-amber-50/50 print:hidden">
            <CardHeader>
              <CardTitle className="text-base">อนุมัติการสั่งซื้อ (ผู้จัดการปฏิบัติการ)</CardTitle>
              <CardDescription>อนุมัติ / ไม่อนุมัติ / ส่งกลับให้คลังแก้ไข</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                placeholder="ความเห็น (ถ้ามี)"
                value={managerComment}
                onChange={(e) => setManagerComment(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button className="bg-green-600 hover:bg-green-700" onClick={() => managerDecision('APPROVED')}>
                  <CheckCircle2 className="h-4 w-4 mr-2" /> อนุมัติ
                </Button>
                <Button variant="destructive" onClick={() => managerDecision('REJECTED')}>
                  <XCircle className="h-4 w-4 mr-2" /> ไม่อนุมัติ
                </Button>
                <Button variant="outline" onClick={() => managerDecision('RETURNED_FOR_REVISION')}>
                  <RotateCcw className="h-4 w-4 mr-2" /> ส่งกลับแก้ไข
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-3 space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
                <div>
                  <CardTitle className="text-lg">รายการสินค้า / บริการ</CardTitle>
                  <CardDescription>
                    {lineMode === 'INVENTORY'
                      ? 'เลือกจากทะเบียนคลัง — ถ้ายังไม่มีรายการให้ไปเพิ่มที่คลังก่อน'
                      : 'สั่งจ้างหรือระบุรายการด้วยตนเอง'}
                  </CardDescription>
                </div>
                {linesEditable && (
                  <Dialog open={isAddingLine} onOpenChange={setIsAddingLine}>
                    <DialogTrigger asChild>
                      <Button className="bg-primary font-bold">
                        <Plus className="h-4 w-4 mr-2" /> เพิ่มรายการ
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-lg">
                      <DialogHeader>
                        <DialogTitle>เพิ่มรายการ</DialogTitle>
                      </DialogHeader>
                      {lineMode === 'INVENTORY' ? (
                        <div className="grid gap-4 py-4">
                          <div className="space-y-2">
                            <Label>รายการจากคลัง</Label>
                            <Select value={selectedStoreItemId} onValueChange={setSelectedStoreItemId}>
                              <SelectTrigger>
                                <SelectValue placeholder="เลือกรายการ..." />
                              </SelectTrigger>
                              <SelectContent className="max-h-72">
                                {(storeItems || [])
                                  .filter((i) => i.active !== false)
                                  .map((i) => (
                                    <SelectItem key={i.id} value={i.id}>
                                      {formatStoreItemLabel(i)} ({i.itemCode})
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label>จำนวน</Label>
                              <Input
                                type="number"
                                value={newLine.quantity}
                                onChange={(e) => setNewLine({ ...newLine, quantity: parseFloat(e.target.value) })}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>ราคาต่อหน่วย</Label>
                              <Input
                                type="number"
                                value={newLine.unitPrice}
                                onChange={(e) => setNewLine({ ...newLine, unitPrice: parseFloat(e.target.value) })}
                              />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="grid gap-4 py-4">
                          <div className="space-y-2">
                            <Label>รายละเอียด</Label>
                            <Input
                              value={newLine.itemDescription}
                              onChange={(e) => setNewLine({ ...newLine, itemDescription: e.target.value })}
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label>จำนวน</Label>
                              <Input
                                type="number"
                                value={newLine.quantity}
                                onChange={(e) => setNewLine({ ...newLine, quantity: parseFloat(e.target.value) })}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>ราคาต่อหน่วย</Label>
                              <Input
                                type="number"
                                value={newLine.unitPrice}
                                onChange={(e) => setNewLine({ ...newLine, unitPrice: parseFloat(e.target.value) })}
                              />
                            </div>
                          </div>
                        </div>
                      )}
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setIsAddingLine(false)}>
                          ยกเลิก
                        </Button>
                        <Button onClick={handleAddLine}>ยืนยัน</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead>รายละเอียด</TableHead>
                      <TableHead className="text-right">จำนวน</TableHead>
                      <TableHead className="text-right">ราคา/หน่วย</TableHead>
                      <TableHead className="text-right font-bold">ยอดรวม</TableHead>
                      <TableHead className="text-right print:hidden">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines?.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell className="font-medium">{line.itemDescription}</TableCell>
                        <TableCell className="text-right">{line.quantity.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{line.unitPrice.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-bold text-primary">
                          ฿ {line.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right print:hidden">
                          {linesEditable && canDeletePurchases ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive"
                              onClick={() => handleDeleteLine(line.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                    {(!lines || lines.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-20 text-muted-foreground italic">
                          ยังไม่มีรายการ
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="border-primary/10 shadow-lg">
              <CardHeader className="bg-primary/5 border-b">
                <CardTitle className="text-base flex items-center gap-2">
                  <Calculator className="h-5 w-5" /> สรุปยอดเงิน
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                <div className="flex justify-between items-center text-sm border-b pb-2">
                  <span className="text-muted-foreground">ยอดรวมก่อนภาษี</span>
                  <span className="font-bold">
                    ฿ {purchase.amountBeforeTax.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm border-b pb-2">
                  <span className="text-muted-foreground">ภาษีมูลค่าเพิ่ม (7%)</span>
                  <span className="font-bold">
                    ฿ {purchase.vatAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between items-center text-lg pt-2">
                  <span className="font-black text-primary uppercase">ยอดสุทธิ</span>
                  <span className="font-black text-2xl text-primary">
                    ฿ {purchase.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-primary text-primary-foreground shadow-lg print:hidden">
              <CardHeader className="pb-4 border-b border-white/10">
                <CardTitle className="text-sm font-bold uppercase tracking-wider opacity-80">การดำเนินการ</CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-3">
                {useNewApprovalFlow && (
                  <>
                    {(purchase.status === 'DRAFT' || purchase.status === 'RETURNED_FOR_REVISION') &&
                      canEditPurchases && (
                        <Button
                          className="w-full bg-white text-primary hover:bg-slate-100 font-bold"
                          onClick={submitForApproval}
                        >
                          <Send className="h-4 w-4 mr-2" /> ส่งขออนุมัติการซื้อ
                        </Button>
                      )}
                    {purchase.status === 'APPROVED' && (
                      <p className="text-sm text-white/90">
                        อนุมัติโดย {purchase.approvalDecisionByName || '—'}{' '}
                        {purchase.approvalDecidedAt
                          ? new Date(purchase.approvalDecidedAt).toLocaleString('th-TH')
                          : ''}
                      </p>
                    )}
                  </>
                )}
                {!useNewApprovalFlow && purchase.status === 'DRAFT' && canEditPurchases && (
                  <Button
                    className="w-full bg-white text-primary hover:bg-slate-100 font-bold"
                    onClick={handleLegacyIssue}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" /> ยืนยันรายการซื้อ (แบบเดิม)
                  </Button>
                )}
                {!useNewApprovalFlow && purchase.status === 'ISSUED' && canEditPurchases && (
                  <Button
                    className="w-full bg-green-600 hover:bg-green-700 text-white font-bold"
                    onClick={handleLegacyComplete}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" /> ปิดรายการ (Completed)
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
