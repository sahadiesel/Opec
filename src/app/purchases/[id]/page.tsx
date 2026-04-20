'use client';

import { useState, use, useMemo, useEffect } from 'react';
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
  PackageCheck,
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection, updateDoc, query, orderBy, where } from 'firebase/firestore';
import { milestonesCoverTotal } from '@/lib/ops/purchase-payment-milestones';
import {
  buildPurchaseOrderPrintHtml,
  openStandardPrintWindow,
} from '@/lib/documents/standard-document-print';
import { useDocumentPrintLocale } from '@/hooks/use-document-print-locale';
import { DocumentPrintLocaleToggle } from '@/components/documents/document-print-locale-toggle';
import { updateDocumentNonBlocking, addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import {
  Purchase,
  PurchaseLine,
  PurchasePaymentMilestone,
  PurchaseVendorBill,
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
import { PurchasePaymentPlanCard } from '@/components/purchases/purchase-payment-plan-card';
import { Switch } from '@/components/ui/switch';
import { roundMoney2 } from '@/lib/ops/purchase-payment-milestones';
import { formatDateThaiBE } from '@/lib/date-thai';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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

  const canViewPurchases = useMemo(() => canView(currentUser, 'purchases'), [currentUser]);
  const canEditPurchases = useMemo(() => canEdit(currentUser, 'purchases'), [currentUser]);
  const canDeletePurchases = useMemo(() => canDelete(currentUser, 'purchases'), [currentUser]);
  const canApprove = useMemo(() => canApprovePurchaseAsManager(currentUser), [currentUser]);
  const canViewStoreInventory = useMemo(() => canView(currentUser, 'store_inventory'), [currentUser]);

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

  const milestonesQuery = useMemoFirebase(
    () =>
      firestore && canViewPurchases
        ? query(collection(firestore, 'purchases', id, 'payment_milestones'), orderBy('sequence', 'asc'))
        : null,
    [firestore, id, canViewPurchases]
  );
  const { data: paymentMilestones } = useCollection<PurchasePaymentMilestone>(milestonesQuery as any);

  const vendorBillsQuery = useMemoFirebase(
    () =>
      firestore && canViewPurchases
        ? query(collection(firestore, 'purchase_vendor_bills'), where('purchaseId', '==', id))
        : null,
    [firestore, id, canViewPurchases]
  );
  const { data: purchaseVendorBills } = useCollection<PurchaseVendorBill>(vendorBillsQuery as any);

  type CompanyDocumentProfile = {
    companyNameTh?: string;
    companyNameEn?: string;
    taxId?: string;
    phone?: string;
    email?: string;
    addressLine1?: string;
    addressLine2?: string;
  };
  const companyProfileRef = useMemoFirebase(
    () => (firestore && canViewPurchases ? doc(firestore, 'system', 'company_profile') : null),
    [firestore, canViewPurchases]
  );
  const { data: companyProfile } = useDoc<CompanyDocumentProfile>(companyProfileRef as any);

  const { printLocale, setPrintLocale } = useDocumentPrintLocale();

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
  const fiscalTermsEditable =
    purchase &&
    (purchase.status === 'DRAFT' || purchase.status === 'RETURNED_FOR_REVISION') &&
    canEditPurchases;

  const [isAddingLine, setIsAddingLine] = useState(false);
  const [newLine, setNewLine] = useState<Partial<PurchaseLine>>({
    itemDescription: '',
    quantity: 1,
    unitPrice: 0,
  });
  const [selectedStoreItemId, setSelectedStoreItemId] = useState<string>('');
  const [managerComment, setManagerComment] = useState('');
  const [whtEnabled, setWhtEnabled] = useState(false);
  const [whtRateInput, setWhtRateInput] = useState('3');
  const [whtSaving, setWhtSaving] = useState(false);

  useEffect(() => {
    if (!purchase) return;
    setWhtEnabled(!!purchase.supplierWithholdingEnabled);
    setWhtRateInput(String(purchase.supplierWithholdingRatePercent ?? 3));
  }, [purchase?.id, purchase?.supplierWithholdingEnabled, purchase?.supplierWithholdingRatePercent]);

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
    if (!purchaseRef || !canEditPurchases || !purchase) return;
    if (!lines?.length) {
      toast({ variant: 'destructive', title: 'ไม่มีรายการ', description: 'เพิ่มรายการก่อนส่งขออนุมัติ' });
      return;
    }
    const ms = paymentMilestones || [];
    if (!ms.length || !milestonesCoverTotal(ms, purchase.totalAmount)) {
      toast({
        variant: 'destructive',
        title: 'ยังไม่มีแผนงวดชำระ',
        description: 'กำหนดแผนงวดให้ครบยอดสุทธิ PO ก่อนส่งขออนุมัติ',
      });
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

  const confirmSentToVendor = async () => {
    if (!purchaseRef || !canEditPurchases || !currentUser) return;
    if (purchase?.status !== 'APPROVED') return;
    const name = currentUser.displayName || currentUser.email || '';
    await updateDocumentNonBlocking(purchaseRef, {
      status: 'ISSUED' as PurchaseStatus,
      issuedAt: Date.now(),
      issuedByUid: currentUser.id,
      issuedByName: name,
      updatedAt: Date.now(),
    });
    toast({ title: 'บันทึกแล้ว', description: 'ยืนยันว่าส่ง PO ให้คู่ค้าแล้ว — สถานะเป็น ISSUED' });
  };

  const canPrintPurchase =
    !!purchase &&
    ['APPROVED', 'ISSUED', 'COMPLETED'].includes(purchase.status) &&
    (purchase.approvalDecidedAt != null || purchase.issuedAt != null);

  const handlePrint = () => {
    if (!canPrintPurchase) {
      toast({
        variant: 'destructive',
        title: 'พิมพ์ไม่ได้',
        description: 'ต้องได้รับการอนุมัติจากผู้จัดการก่อน (หรือส่ง PO ผ่านขั้นตอนปกติ)',
      });
      return;
    }
    const body = buildPurchaseOrderPrintHtml({
      company: companyProfile ?? undefined,
      purchase,
      vendor,
      lines: lines ?? [],
      milestones: paymentMilestones ?? [],
      printedAtMs: Date.now(),
      locale: printLocale,
    });
    if (
      !openStandardPrintWindow({
        windowTitle: purchase.purchaseNo,
        bodyInnerHtml: body,
        htmlLang: printLocale,
      })
    ) {
      toast({
        variant: 'destructive',
        title: 'เปิดหน้าต่างพิมพ์ไม่ได้',
        description: 'กรุณาอนุญาตป๊อปอัปสำหรับเว็บไซต์นี้',
      });
    }
  };

  const saveSupplierWithholding = async () => {
    if (!purchaseRef || !canEditPurchases || !purchase) return;
    if (purchase.status !== 'DRAFT' && purchase.status !== 'RETURNED_FOR_REVISION') return;
    const r = parseFloat(String(whtRateInput).replace(',', '.'));
    if (!Number.isFinite(r) || r < 0 || r > 100) {
      toast({ variant: 'destructive', title: 'อัตราไม่ถูกต้อง', description: 'ใส่ตัวเลข 0–100 (เช่น 3 สำหรับ 3%)' });
      return;
    }
    setWhtSaving(true);
    try {
      await updateDocumentNonBlocking(purchaseRef, {
        supplierWithholdingEnabled: whtEnabled,
        supplierWithholdingRatePercent: whtEnabled ? r : null,
        updatedAt: Date.now(),
      });
      toast({ title: 'บันทึกการตั้งค่าหัก ณ ที่จ่ายแล้ว' });
    } finally {
      setWhtSaving(false);
    }
  };

  const canPrintWithholdingSummary =
    !!purchase &&
    lineMode === 'SERVICE' &&
    !!purchase.supplierWithholdingEnabled &&
    (Number(purchase.supplierWithholdingRatePercent) || 0) > 0 &&
    (paymentMilestones?.length ?? 0) > 0;

  const handlePrintSupplierWithholding = () => {
    if (!purchase || !paymentMilestones?.length) {
      toast({
        variant: 'destructive',
        title: 'ยังไม่มีแผนงวด',
        description: 'สร้างแผนงวดก่อนพิมพ์สรุปหัก ณ ที่จ่าย',
      });
      return;
    }
    if (!purchase.supplierWithholdingEnabled) {
      toast({ variant: 'destructive', title: 'ยังไม่เปิดใช้หัก ณ ที่จ่าย' });
      return;
    }
    const rate = Number(purchase.supplierWithholdingRatePercent) || 0;
    if (rate <= 0) {
      toast({ variant: 'destructive', title: 'กำหนดอัตราหัก ณ ที่จ่ายก่อน' });
      return;
    }
    const ms = [...paymentMilestones].sort((a, b) => a.sequence - b.sequence);
    const w = window.open('', '_blank');
    if (!w) {
      toast({ variant: 'destructive', title: 'เปิดหน้าต่างพิมพ์ไม่ได้', description: 'อนุญาตป๊อปอัปในเบราว์เซอร์' });
      return;
    }
    const rows = ms
      .map((m) => {
        const wht = roundMoney2((m.amount * rate) / 100);
        const net = roundMoney2(m.amount - wht);
        return `<tr>
      <td style="padding:6px;border:1px solid #ccc">${m.sequence}</td>
      <td style="padding:6px;border:1px solid #ccc">${escapeHtml(m.label)}</td>
      <td style="padding:6px;border:1px solid #ccc;text-align:right">${m.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
      <td style="padding:6px;border:1px solid #ccc;text-align:right">${wht.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
      <td style="padding:6px;border:1px solid #ccc;text-align:right;font-weight:bold">${net.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
    </tr>`;
      })
      .join('');
    const totalBase = roundMoney2(ms.reduce((s, m) => s + m.amount, 0));
    const totalWht = roundMoney2(ms.reduce((s, m) => s + roundMoney2((m.amount * rate) / 100), 0));
    const totalNet = roundMoney2(totalBase - totalWht);
    const vn = vendor?.vendorName || '—';
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>สรุปหัก ณ ที่จ่าย ${escapeHtml(purchase.purchaseNo)}</title>
  <style>body{font-family:system-ui,sans-serif;padding:24px;max-width:900px;margin:0 auto} table{border-collapse:collapse;width:100%;margin-top:16px} th{background:#f3f4f6;text-align:left;padding:8px;border:1px solid #ccc}</style></head><body>
  <h1>สรุปหัก ณ ที่จ่าย — ผู้รับเงิน (คู่ค้า)</h1>
  <p><strong>เลขที่ PO:</strong> ${escapeHtml(purchase.purchaseNo)} &nbsp;|&nbsp; <strong>คู่ค้า:</strong> ${escapeHtml(vn)}</p>
  <p><strong>อัตราหัก ณ ที่จ่าย:</strong> ${rate}% (ฐานคำนวณ = ยอดแต่ละงวดชำระ)</p>
  <p><strong>พิมพ์เมื่อ:</strong> ${escapeHtml(formatDateThaiBE(Date.now()))}</p>
  <table>
    <thead><tr>
      <th>งวด</th><th>รายละเอียด</th><th style="text-align:right">ฐานจ่าย (บาท)</th><th style="text-align:right">หัก ณ ที่จ่าย (บาท)</th><th style="text-align:right">สุทธิจ่าย (บาท)</th>
    </tr></thead>
    <tbody>${rows}
    <tr style="font-weight:bold;background:#fafafa">
      <td colspan="2" style="padding:8px;border:1px solid #ccc">รวม</td>
      <td style="padding:8px;border:1px solid #ccc;text-align:right">${totalBase.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
      <td style="padding:8px;border:1px solid #ccc;text-align:right">${totalWht.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
      <td style="padding:8px;border:1px solid #ccc;text-align:right">${totalNet.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
    </tr>
    </tbody>
  </table>
  <p style="margin-top:24px;font-size:12px;color:#666">เอกสารสำหรับแผนกบัญชีและแผนกจัดซื้อ/สโตร์ — ตรวจสอบประเภทเงินได้รับและอัตราตามประกาศกรมสรรพากร</p>
  </body></html>`);
    w.document.close();
    w.focus();
    w.print();
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

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-[1600px] mx-auto space-y-6">
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
            {canPrintPurchase && (
              <>
                <DocumentPrintLocaleToggle printLocale={printLocale} setPrintLocale={setPrintLocale} showLabel />
                <Button variant="outline" className="font-bold gap-2" onClick={handlePrint}>
                  <Printer className="h-4 w-4" /> พิมพ์เอกสาร
                </Button>
              </>
            )}
            {canPrintWithholdingSummary && (
              <Button variant="secondary" className="font-bold gap-2" onClick={handlePrintSupplierWithholding}>
                <Printer className="h-4 w-4" /> พิมพ์สรุปหัก ณ ที่จ่าย
              </Button>
            )}
          </div>
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

        <div className="max-w-4xl mx-auto w-full space-y-6">
            <Card className="shadow-md">
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

            {lineMode === 'SERVICE' && (
              <Card className="border-slate-200 shadow-md">
                <CardHeader className="border-b bg-slate-50/60">
                  <CardTitle className="text-base">หัก ณ ที่จ่าย (งานจ้างเหมา)</CardTitle>
                  <CardDescription>
                    กำหนดได้เฉพาะตอนสถานะฉบับร่างหรือส่งกลับแก้ไข — ตารางแผนงวดแสดงฐาน / หัก / สุทธิจ่าย
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-4 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 print:hidden">
                    <div className="flex items-center gap-3">
                      <Switch
                        id="wht-enabled"
                        checked={whtEnabled}
                        onCheckedChange={setWhtEnabled}
                        disabled={!fiscalTermsEditable}
                      />
                      <Label htmlFor="wht-enabled" className="cursor-pointer">
                        ใช้การคำนวณหัก ณ ที่จ่ายตามงวด
                      </Label>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="space-y-1">
                        <Label htmlFor="wht-rate">อัตรา (%)</Label>
                        <Input
                          id="wht-rate"
                          className="w-24"
                          inputMode="decimal"
                          disabled={!whtEnabled || !fiscalTermsEditable}
                          value={whtRateInput}
                          onChange={(e) => setWhtRateInput(e.target.value)}
                        />
                      </div>
                      {fiscalTermsEditable && (
                        <Button type="button" onClick={() => void saveSupplierWithholding()} disabled={whtSaving}>
                          {whtSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          บันทึก
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="hidden print:block text-sm">
                    {purchase.supplierWithholdingEnabled && (purchase.supplierWithholdingRatePercent ?? 0) > 0 ? (
                      <p>
                        <strong>หัก ณ ที่จ่าย:</strong> อัตรา {purchase.supplierWithholdingRatePercent}% (คำนวณจากยอดแต่ละงวด)
                      </p>
                    ) : (
                      <p>ไม่มีการหัก ณ ที่จ่ายตามการตั้งค่าเอกสารนี้</p>
                    )}
                  </div>
                  {purchase.supplierWithholdingEnabled && (purchase.supplierWithholdingRatePercent ?? 0) > 0 ? (
                    <p className="text-xs text-muted-foreground print:hidden">
                      บันทึกแล้ว: หัก {purchase.supplierWithholdingRatePercent}% ต่อยอดแต่ละงวด (ฐาน = ยอดงวดในแผนชำระ)
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground print:hidden">ยังไม่เปิดใช้ — แผนงวดจะแสดงเฉพาะยอดงวด</p>
                  )}
                </CardContent>
              </Card>
            )}

            {firestore && purchaseRef ? (
              <PurchasePaymentPlanCard
                firestore={firestore}
                purchaseId={id}
                purchase={purchase}
                purchaseRef={purchaseRef}
                vendor={vendor}
                milestones={paymentMilestones}
                vendorBills={purchaseVendorBills}
                canEdit={canEditPurchases}
                canCreateVendorBill={canViewStoreInventory || canEditPurchases}
                currentUser={currentUser}
              />
            ) : null}

            <Card className="bg-primary text-primary-foreground shadow-lg print:hidden">
              <CardHeader className="pb-4 border-b border-white/10">
                <CardTitle className="text-sm font-bold uppercase tracking-wider opacity-80">การดำเนินการ</CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-3">
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
                  <>
                    <p className="text-sm text-white/90">
                      อนุมัติโดย {purchase.approvalDecisionByName || '—'}{' '}
                      {purchase.approvalDecidedAt
                        ? new Date(purchase.approvalDecidedAt).toLocaleString('th-TH')
                        : ''}
                    </p>
                    {canEditPurchases && (
                      <Button
                        className="w-full bg-white text-primary hover:bg-slate-100 font-bold"
                        onClick={() => void confirmSentToVendor()}
                      >
                        <PackageCheck className="h-4 w-4 mr-2" /> ยืนยันส่ง PO ให้คู่ค้าแล้ว
                      </Button>
                    )}
                    <p className="text-xs text-white/80 leading-relaxed">
                      หลังส่งคู่ค้าแล้วระบบจะตั้งสถานะ ISSUED — การปิด PO (COMPLETED) เมื่อแผนงวดชำระครบทุกงวด
                    </p>
                  </>
                )}
                {purchase.status === 'ISSUED' && (
                  <div className="text-sm text-white/90 space-y-1">
                    <p className="font-semibold">ส่งให้คู่ค้าแล้ว (ISSUED)</p>
                    {purchase.issuedAt ? (
                      <p>
                        บันทึกเมื่อ {new Date(purchase.issuedAt).toLocaleString('th-TH')}
                        {purchase.issuedByName ? ` — ${purchase.issuedByName}` : ''}
                      </p>
                    ) : (
                      <p className="text-white/70">รายการเก่า: ยังไม่มีวันที่บันทึกการส่ง</p>
                    )}
                    <p className="text-xs text-white/80 pt-2 leading-relaxed">
                      ปิด PO เมื่อจ่ายเงินครบ — ยืนยันงวดผ่านใบรับวางบิลและเมนูตรวจสอบรายจ่าย
                    </p>
                  </div>
                )}
                {purchase.status === 'COMPLETED' && (
                  <p className="text-sm text-white/90">
                    PO ปิดแล้ว (COMPLETED) — งวดชำระครบตามแผน หรือรายการเก่าก่อนมีแผนงวด
                  </p>
                )}
              </CardContent>
            </Card>

        </div>
      </div>
    </AppShell>
  );
}
