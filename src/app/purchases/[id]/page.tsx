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
import { doc, collection, updateDoc, deleteField } from 'firebase/firestore';
import { roundMoney2, supplierWithholdingOnMilestone } from '@/lib/ops/purchase-payment-milestones';
import {
  buildPurchaseOrderPrintHtml,
  openStandardPrintWindow,
  sanitizePrintFileBaseName,
} from '@/lib/documents/standard-document-print';
import { useDocumentPrintLocale } from '@/hooks/use-document-print-locale';
import { DocumentPrintLocaleToggle } from '@/components/documents/document-print-locale-toggle';
import { updateDocumentNonBlocking, addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import {
  Purchase,
  PurchaseRequest,
  PurchaseLine,
  PurchasePaymentMilestone,
  PurchaseStatus,
  User,
  Vendor,
  StoreItem,
  formatStoreItemLabel,
} from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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
import { Switch } from '@/components/ui/switch';
import { computePurchaseTotalsFromLines, sumLineAmounts } from '@/lib/purchase/pr-totals';

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

function approvalStatusPillClass(status: PurchaseStatus): string {
  switch (status) {
    case 'APPROVED':
    case 'ISSUED':
    case 'COMPLETED':
      return 'bg-green-600 text-white border-transparent hover:bg-green-600';
    case 'REJECTED':
    case 'CANCELLED':
      return 'bg-red-600 text-white border-transparent hover:bg-red-600';
    case 'PENDING_APPROVAL':
      return 'bg-amber-500 text-white border-transparent hover:bg-amber-500';
    case 'RETURNED_FOR_REVISION':
      return 'bg-orange-500 text-white border-transparent hover:bg-orange-500';
    default:
      return 'bg-slate-600 text-white border-transparent hover:bg-slate-600';
  }
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
  const purchaseRef = useMemoFirebase(
    () => (firestore && canViewPurchases ? doc(firestore, 'purchases', id) : null),
    [firestore, id, canViewPurchases]
  );
  const { data: purchase, isLoading: isPurchaseLoading } = useDoc<Purchase>(purchaseRef as any);

  const prRef = useMemoFirebase(
    () =>
      firestore && canViewPurchases && purchase?.purchaseRequestId
        ? doc(firestore, 'purchase_requests', purchase.purchaseRequestId)
        : null,
    [firestore, canViewPurchases, purchase?.purchaseRequestId]
  );
  const { data: linkedPr, isLoading: isLinkedPrLoading } = useDoc<PurchaseRequest>(prRef as any);

  const hasPurchaseRequisition = Boolean(purchase?.purchaseRequestId);

  /** ผู้อนุมัติทางธุรกิจ: ถ้า PO อ้าง PR ใช้ชื่อจาก PR (`decidedByName`) ไม่ใช่ผู้ที่กดยืนยัน PO */
  const displayOpsApproverName = useMemo(() => {
    if (
      purchase?.purchaseRequestId?.trim() &&
      linkedPr?.status === 'APPROVED' &&
      linkedPr.decidedByName?.trim()
    ) {
      return linkedPr.decidedByName.trim();
    }
    return purchase?.approvalDecisionByName?.trim() || '';
  }, [purchase?.purchaseRequestId, purchase?.approvalDecisionByName, linkedPr?.status, linkedPr?.decidedByName]);

  const linesQuery = useMemoFirebase(
    () => (firestore && canViewPurchases ? collection(firestore, 'purchases', id, 'lines') : null),
    [firestore, id, canViewPurchases]
  );
  const { data: lines } = useCollection<PurchaseLine>(linesQuery as any);

  const milestonesQuery = useMemoFirebase(
    () => (firestore && canViewPurchases ? collection(firestore, 'purchases', id, 'payment_milestones') : null),
    [firestore, id, canViewPurchases]
  );
  const { data: paymentMilestones } = useCollection<PurchasePaymentMilestone>(milestonesQuery as any);

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
  /** PO ที่อ้าง PR — รายการถือเป็นผลจาก PR ที่อนุมัติแล้ว ไม่ให้แก้บรรทัดใน PO */
  const linesEditable =
    purchase &&
    canEditLinesStatus(purchase.status) &&
    canEditPurchases &&
    !hasPurchaseRequisition;
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
  const [discountInput, setDiscountInput] = useState('0');
  const [discountSaving, setDiscountSaving] = useState(false);

  useEffect(() => {
    if (!purchase) return;
    setWhtEnabled(!!purchase.supplierWithholdingEnabled);
    setWhtRateInput(String(purchase.supplierWithholdingRatePercent ?? 3));
    setDiscountInput(String(purchase.discountAmount ?? 0));
  }, [purchase?.id, purchase?.supplierWithholdingEnabled, purchase?.supplierWithholdingRatePercent, purchase?.discountAmount]);

  const lineSumGross = useMemo(
    () => sumLineAmounts((lines ?? []).map((l) => ({ amount: Number(l.amount) || 0 }))),
    [lines],
  );

  /** PO อ้าง PR — ตั้งส่วนลดได้ก่อนส่งคู่ค้า (รายการล็อกแล้ว) */
  const discountEditable =
    !!purchase &&
    hasPurchaseRequisition &&
    canEditPurchases &&
    (purchase.status === 'DRAFT' || purchase.status === 'APPROVED');

  const recalculateTotals = (currentLines: PurchaseLine[], discountAmount = purchase?.discountAmount ?? 0) => {
    if (!purchaseRef || !purchase) return;
    const lineSum = sumLineAmounts(currentLines.map((l) => ({ amount: Number(l.amount) || 0 })));
    const totals = computePurchaseTotalsFromLines(lineSum, purchase.vatTreatment, discountAmount);

    updateDoc(purchaseRef, {
      discountAmount: roundMoney2(Number(discountAmount) || 0),
      amountBeforeTax: totals.amountBeforeTax,
      vatAmount: totals.vatAmount,
      totalAmount: totals.totalAmount,
      updatedAt: Date.now(),
    });
  };

  const savePurchaseDiscount = async () => {
    if (!purchaseRef || !purchase || !discountEditable) return;
    const raw = String(discountInput).trim().replace(/,/g, '');
    const parsed = raw === '' || raw === '.' ? 0 : parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast({ variant: 'destructive', title: 'ส่วนลดไม่ถูกต้อง', description: 'ใส่ตัวเลขไม่ติดลบ' });
      return;
    }
    setDiscountSaving(true);
    try {
      const totals = computePurchaseTotalsFromLines(lineSumGross, purchase.vatTreatment, parsed);
      await updateDocumentNonBlocking(purchaseRef, {
        discountAmount: totals.discountAmount,
        amountBeforeTax: totals.amountBeforeTax,
        vatAmount: totals.vatAmount,
        totalAmount: totals.totalAmount,
        updatedAt: Date.now(),
      });
      setDiscountInput(String(totals.discountAmount));
      toast({ title: 'บันทึกส่วนลดแล้ว', description: 'ยอดก่อนภาษีและ VAT อัปเดตตามส่วนลด' });
    } finally {
      setDiscountSaving(false);
    }
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

  const validateBeforeFinalizePo = (forPrFlow: boolean) => {
    if (!lines?.length) {
      toast({
        variant: 'destructive',
        title: 'ไม่มีรายการ',
        description: forPrFlow ? 'เพิ่มรายการก่อนยืนยัน PO' : 'เพิ่มรายการก่อนส่งขออนุมัติ',
      });
      return false;
    }
    if (!purchase) return false;
    return true;
  };

  /** PO อ้าง PR: อนุมัติทางธุรกิจอยู่ที่ PR แล้ว — ฝ่ายคลัง/จัดซื้อยืนยันรายละเอียด PO เพื่อพิมพ์/ส่งคู่ค้า (ไม่ส่งรออนุมัติซ้ำ) */
  const confirmPoFromApprovedPr = async () => {
    if (!purchaseRef || !canEditPurchases || !purchase) return;
    if (!hasPurchaseRequisition) return;
    if (isLinkedPrLoading) {
      toast({ title: 'กรุณารอ', description: 'กำลังโหลดข้อมูล PR' });
      return;
    }
    if (purchase.purchaseRequestId && !linkedPr) {
      toast({ variant: 'destructive', title: 'ไม่พบ PR', description: 'ไม่สามารถอ่านเอกสาร PR ที่อ้างอิงได้' });
      return;
    }
    if (!validateBeforeFinalizePo(true)) return;
    const confirmerName = currentUser?.displayName || currentUser?.email || '';
    const confirmerUid = currentUser?.id;
    const prApproverName = linkedPr?.decidedByName?.trim();
    const prApproverUid = linkedPr?.decidedByUid;
    const usePrApprover =
      linkedPr?.status === 'APPROVED' && !!prApproverName;
    try {
      await updateDocumentNonBlocking(purchaseRef, {
        status: 'APPROVED' as PurchaseStatus,
        approvalDecidedAt: Date.now(),
        approvalRequestedAt: deleteField(),
        approvalDecisionByUid: usePrApprover && prApproverUid ? prApproverUid : confirmerUid,
        approvalDecisionByName: usePrApprover ? prApproverName : confirmerName,
        approvalComment: 'อนุมัติทางธุรกิจตาม PR ที่อนุมัติแล้ว — ยืนยันรายละเอียด PO',
        updatedAt: Date.now(),
      });
      toast({ title: 'ยืนยัน PO แล้ว', description: 'สามารถพิมพ์และยืนยันส่งคู่ค้าได้' });
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'บันทึกไม่สำเร็จ' });
    }
  };

  /** ใช้เฉพาะ PO เก่าหรือกรณีพิเศษที่ไม่อ้าง PR (ไม่กระทบรายการจาก PR) */
  const submitForApproval = async () => {
    if (!purchaseRef || !canEditPurchases || !purchase) return;
    if (hasPurchaseRequisition) {
      toast({
        variant: 'destructive',
        title: 'อนุมัติที่ PR แล้ว',
        description: 'ใบสั่งซื้อนี้อ้าง PR — ใช้ปุ่ม "ยืนยัน PO (อ้าง PR อนุมัติแล้ว)" แทนการส่งอนุมัติซ้ำ',
      });
      return;
    }
    if (!validateBeforeFinalizePo(false)) return;
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
    (purchase.approvalDecidedAt != null ||
      purchase.issuedAt != null ||
      (hasPurchaseRequisition && purchase.status === 'APPROVED'));

  const handlePrint = async () => {
    if (!purchase) return;
    if (!canPrintPurchase) {
      toast({
        variant: 'destructive',
        title: 'พิมพ์ไม่ได้',
        description: hasPurchaseRequisition
          ? 'ยืนยัน PO (อ้าง PR) ก่อน — หรือรออนุมัติหากเป็น PO แบบไม่อ้าง PR'
          : 'ต้องได้รับการอนุมัติจากผู้จัดการก่อน หรือยืนยันตามขั้นตอน',
      });
      return;
    }
    try {
      const body = buildPurchaseOrderPrintHtml({
        company: companyProfile ?? undefined,
        purchase,
        vendor,
        lines: lines ?? [],
        milestones: paymentMilestones ?? [],
        linkedPurchaseRequest: linkedPr ?? undefined,
        printedAtMs: Date.now(),
        locale: printLocale,
      });
      if (
        !(await openStandardPrintWindow({
          windowTitle: purchase.purchaseNo || 'PO',
          bodyInnerHtml: body,
          htmlLang: printLocale,
        }))
      ) {
        toast({
          variant: 'destructive',
          title: 'เปิดหน้าต่างพิมพ์ไม่ได้',
          description: 'กรุณาอนุญาตป๊อปอัปสำหรับเว็บไซต์นี้',
        });
      }
    } catch (e) {
      console.error(e);
      toast({
        variant: 'destructive',
        title: 'พิมพ์ไม่สำเร็จ',
        description: e instanceof Error ? e.message : 'เกิดข้อผิดพลาดขณะประกอบเอกสาร',
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
    (purchase.totalAmount ?? 0) > 0;

  const handlePrintSupplierWithholding = () => {
    if (!purchase) return;
    if (!purchase.supplierWithholdingEnabled) {
      toast({ variant: 'destructive', title: 'ยังไม่เปิดใช้หัก ณ ที่จ่าย' });
      return;
    }
    const rate = Number(purchase.supplierWithholdingRatePercent) || 0;
    if (rate <= 0) {
      toast({ variant: 'destructive', title: 'กำหนดอัตราหัก ณ ที่จ่ายก่อน' });
      return;
    }
    const grossPo = roundMoney2(Number(purchase.totalAmount) || 0);
    const { wht, netPaid: net, baseBeforeVat } = supplierWithholdingOnMilestone(grossPo, rate, purchase);
    const w = window.open('', '_blank');
    if (!w) {
      toast({ variant: 'destructive', title: 'เปิดหน้าต่างพิมพ์ไม่ได้', description: 'อนุญาตป๊อปอัปในเบราว์เซอร์' });
      return;
    }
    const rows = `<tr>
      <td style="padding:6px;border:1px solid #ccc">1</td>
      <td style="padding:6px;border:1px solid #ccc">${escapeHtml('ยอดตามใบสั่งซื้อ (รวมภาษีมูลค่าเพิ่ม)')}</td>
      <td style="padding:6px;border:1px solid #ccc;text-align:right">${grossPo.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
      <td style="padding:6px;border:1px solid #ccc;text-align:right">${wht.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
      <td style="padding:6px;border:1px solid #ccc;text-align:right;font-weight:bold">${net.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
    </tr>`;
    const totalBase = grossPo;
    const totalWht = wht;
    const totalNet = net;
    const vn = vendor?.vendorName || '—';
    const titleBase = sanitizePrintFileBaseName(`PO-WHT-summary-${purchase.purchaseNo || 'PO'}`);
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(titleBase)}</title>
  <style>body{font-family:system-ui,sans-serif;padding:24px;max-width:900px;margin:0 auto} table{border-collapse:collapse;width:100%;margin-top:16px} th{background:#f3f4f6;text-align:left;padding:8px;border:1px solid #ccc}</style></head><body>
  <h1>สรุปหัก ณ ที่จ่าย — ผู้รับเงิน (คู่ค้า)</h1>
  <p><strong>เลขที่ PO:</strong> ${escapeHtml(purchase.purchaseNo)} &nbsp;|&nbsp; <strong>คู่ค้า:</strong> ${escapeHtml(vn)}</p>
  <p><strong>อัตราหัก ณ ที่จ่าย:</strong> ${rate}% (ฐานคำนวณ = ส่วนยอดก่อนภาษีมูลค่าเพิ่มตามสัดส่วนยอดสุทธิ PO — สุทธิจ่าย = ยอดรวม VAT − หัก ณ ที่จ่าย; การแบ่งงวดจ่ายทำในเอกสารรับวางบิล ไม่ระบุใน PO)</p>
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
    w.document.title = titleBase;
    w.focus();
    w.print();
  };

  if (userLoading) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background">
        <Loader2 className="h-12 w-12 animate-spin text-primary" aria-label="กำลังโหลด" />
      </div>
    );
  }
  if (!currentUser) {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center gap-4 px-4 text-center bg-background">
        <p className="text-muted-foreground max-w-md">
          ยังโหลดโปรไฟล์ผู้ใช้ไม่สำเร็จ — ลองรีเฟรชหรือเข้าสู่ระบบใหม่
        </p>
        <Button type="button" variant="outline" onClick={() => router.push('/purchases')}>
          กลับรายการซื้อ
        </Button>
      </div>
    );
  }
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
            <Badge
              variant="outline"
              className="py-1.5 px-4 font-bold border-primary/20 bg-primary/5 text-primary lg:hidden"
            >
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

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* โซนซ้าย: รายการ + สรุปยอด + หัก ณ ที่จ่าย (การชำระผ่านใบรับวางบิล — ไม่จัดการใน PO) */}
          <div className="order-2 lg:order-1 lg:col-span-7 space-y-6 w-full min-w-0">
            <Card className="shadow-md">
              <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
                <div>
                  <CardTitle className="text-lg">รายการสินค้า / บริการ</CardTitle>
                  <CardDescription>
                    {hasPurchaseRequisition ? (
                      <>
                        รายการถูกล็อกจาก PR ที่อนุมัติแล้ว — แก้ไม่ได้ใน PO (หากต้องแก้ให้ทำ PR ใหม่)
                        {linkedPr?.requestNo ? (
                          <>
                            {' '}
                            ·{' '}
                            <Link className="text-primary underline font-medium" href={`/store/purchase-requests/${purchase.purchaseRequestId}`}>
                              {linkedPr.requestNo}
                            </Link>
                          </>
                        ) : null}
                      </>
                    ) : lineMode === 'INVENTORY' ? (
                      'เลือกจากทะเบียนคลัง — ถ้ายังไม่มีรายการให้ไปเพิ่มที่คลังก่อน'
                    ) : (
                      'สั่งจ้างหรือระบุรายการด้วยตนเอง'
                    )}
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
                {discountEditable && (
                  <div className="rounded-lg border border-dashed border-primary/30 bg-muted/20 p-4 space-y-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                      <div className="space-y-1">
                        <Label htmlFor="po-discount">ส่วนลด (หักจากยอดก่อนภาษี)</Label>
                        <p className="text-xs text-muted-foreground">
                          รายการจาก PR แก้ไม่ได้ — ใส่ส่วนลดรวมก่อนพิมพ์/ส่ง PO ให้คู่ค้า
                        </p>
                      </div>
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="relative w-full sm:w-40">
                          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                            ฿
                          </span>
                          <Input
                            id="po-discount"
                            className="pl-8 text-right tabular-nums"
                            inputMode="decimal"
                            readOnly={false}
                            disabled={discountSaving}
                            value={discountInput}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === '' || /^\d*\.?\d*$/.test(v)) setDiscountInput(v);
                            }}
                          />
                        </div>
                        {discountEditable && (
                          <Button type="button" variant="secondary" disabled={discountSaving} onClick={() => void savePurchaseDiscount()}>
                            {discountSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                            บันทึกส่วนลด
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                {(purchase.discountAmount ?? 0) > 0 && (
                  <div className="flex justify-between items-center text-sm border-b pb-2">
                    <span className="text-muted-foreground">รวมบรรทัด</span>
                    <span className="font-mono font-semibold">
                      ฿ {lineSumGross.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                {(purchase.discountAmount ?? 0) > 0 && (
                  <div className="flex justify-between items-center text-sm border-b pb-2 text-amber-900 dark:text-amber-200">
                    <span>ส่วนลด</span>
                    <span className="font-mono font-semibold">
                      − ฿ {(purchase.discountAmount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
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
                    กำหนดได้เฉพาะตอนสถานะฉบับร่างหรือส่งกลับแก้ไข — ใช้ประกอบการจ่ายผ่านบัญชีและเอกสารรับวางบิลอ้างอิง PO (ไม่จัดงวดชำระใน PO)
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
                        ใช้การคำนวณหัก ณ ที่จ่ายตามยอด PO (ประกอบจ่ายผ่านใบรับวางบิล)
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
                        <strong>หัก ณ ที่จ่าย:</strong> อัตรา {purchase.supplierWithholdingRatePercent}% (ฐาน = ส่วนก่อน VAT ตามสัดส่วนยอดสุทธิ PO — สุทธิ = ยอดรวม VAT − หัก ณ ที่จ่าย)
                      </p>
                    ) : (
                      <p>ไม่มีการหัก ณ ที่จ่ายตามการตั้งค่าเอกสารนี้</p>
                    )}
                  </div>
                  {purchase.supplierWithholdingEnabled && (purchase.supplierWithholdingRatePercent ?? 0) > 0 ? (
                    <p className="text-xs text-muted-foreground print:hidden">
                      บันทึกแล้ว: หัก {purchase.supplierWithholdingRatePercent}% จากฐานก่อน VAT ตามสัดส่วนยอดสุทธิ PO
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground print:hidden">ยังไม่เปิดใช้หัก ณ ที่จ่ายตามเอกสารนี้</p>
                  )}
                </CardContent>
              </Card>
            )}

          </div>

          {/* โซนขวา: สถานะ + ความเห็นผู้จัดการ (บน) · การดำเนินการ (ล่าง) */}
          <div className="order-1 lg:order-2 lg:col-span-5 flex flex-col gap-6 print:hidden lg:sticky lg:top-4 w-full min-w-0 lg:min-h-[min(78vh,880px)] lg:justify-between">
            <Card className="border shadow-md">
              <CardHeader className="pb-3 border-b bg-muted/30">
                <CardTitle className="text-base">
                  {hasPurchaseRequisition ? 'สถานะ PO (อ้าง PR)' : 'สถานะการอนุมัติ PO'}
                </CardTitle>
                <CardDescription>
                  {hasPurchaseRequisition ? (
                    <span>
                      อนุมัติเชิงธุรกิจทำที่ PR แล้ว — ฝ่ายคลัง/จัดซื้อยืนยันรายละเอียด PO ก่อนพิมพ์/ส่งคู่ค้า
                      {linkedPr && purchase.purchaseRequestId && (
                        <span className="block mt-1">
                          <Link
                            href={`/store/purchase-requests/${purchase.purchaseRequestId}`}
                            className="font-semibold text-primary underline"
                          >
                            เปิด PR: {linkedPr.requestNo}
                          </Link>
                        </span>
                      )}
                    </span>
                  ) : (
                    <>ผู้จัดการปฏิบัติการ (กรณี PO ไม่อ้าง PR — รายการเก่า)</>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground">สถานะ:</span>
                  <Badge className={`${approvalStatusPillClass(purchase.status)} border-0`}>
                    {purchase.status === 'APPROVED'
                      ? 'อนุมัติ'
                      : purchase.status === 'REJECTED'
                        ? 'ไม่อนุมัติ'
                        : statusLabelTh(purchase.status)}
                  </Badge>
                </div>

                {purchase.status === 'REJECTED' && purchase.rejectionReason && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                    <p className="font-semibold text-destructive mb-1">เหตุผลไม่อนุมัติ</p>
                    <p className="text-muted-foreground">{purchase.rejectionReason}</p>
                  </div>
                )}

                {hasPurchaseRequisition && purchase.status === 'PENDING_APPROVAL' && (
                  <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-md p-3">
                    PO นี้อ้าง PR — ไม่ควรอยู่สถานะ «รออนุมัติ» กรุณาใช้ «ยืนยัน PO (อ้าง PR)» แทน หรือให้ผู้ดูแลแก้สถานะ
                  </p>
                )}

                {purchase.status === 'PENDING_APPROVAL' && canApprove && !hasPurchaseRequisition ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="mgr-comment">ความเห็น (ผู้จัดการปฏิบัติการ)</Label>
                      <Textarea
                        id="mgr-comment"
                        placeholder="ความเห็นหรือหมายเหตุ (ถ้ามี)"
                        value={managerComment}
                        onChange={(e) => setManagerComment(e.target.value)}
                        rows={4}
                        className="resize-y min-h-[100px]"
                      />
                    </div>
                    <div className="flex flex-col sm:flex-row flex-wrap gap-2">
                      <Button className="bg-green-600 hover:bg-green-700 font-bold" onClick={() => managerDecision('APPROVED')}>
                        <CheckCircle2 className="h-4 w-4 mr-2" /> อนุมัติ
                      </Button>
                      <Button variant="destructive" onClick={() => managerDecision('REJECTED')}>
                        <XCircle className="h-4 w-4 mr-2" /> ไม่อนุมัติ
                      </Button>
                      <Button variant="outline" onClick={() => managerDecision('RETURNED_FOR_REVISION')}>
                        <RotateCcw className="h-4 w-4 mr-2" /> ส่งกลับแก้ไข
                      </Button>
                    </div>
                  </>
                ) : purchase.status === 'PENDING_APPROVAL' && !canApprove && !hasPurchaseRequisition ? (
                  <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-md p-3">
                    รอผู้จัดการปฏิบัติการพิจารณา — คุณดูรายการได้แต่ไม่มีสิทธิ์อนุมัติ
                  </p>
                ) : purchase.status === 'PENDING_APPROVAL' && hasPurchaseRequisition ? null : (
                  <>
                    {purchase.approvalComment ? (
                      <div className="space-y-1">
                        <Label className="text-muted-foreground">ความเห็นผู้จัดการปฏิบัติการ</Label>
                        <p className="text-sm rounded-md border bg-muted/30 p-3 whitespace-pre-wrap">{purchase.approvalComment}</p>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">ยังไม่มีความเห็นในระบบ</p>
                    )}
                    {(purchase.status === 'APPROVED' ||
                      purchase.status === 'REJECTED' ||
                      purchase.status === 'RETURNED_FOR_REVISION') &&
                      (displayOpsApproverName || purchase.approvalDecidedAt) && (
                        <p className="text-xs text-muted-foreground">
                          {displayOpsApproverName ? `โดย ${displayOpsApproverName}` : ''}
                          {purchase.approvalDecidedAt
                            ? ` · ${new Date(purchase.approvalDecidedAt).toLocaleString('th-TH')}`
                            : ''}
                        </p>
                      )}
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="bg-primary text-primary-foreground shadow-lg">
              <CardHeader className="pb-4 border-b border-white/10">
                <CardTitle className="text-sm font-bold uppercase tracking-wider opacity-80">การดำเนินการ</CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-3">
                {(purchase.status === 'DRAFT' || purchase.status === 'RETURNED_FOR_REVISION') &&
                  canEditPurchases &&
                  hasPurchaseRequisition && (
                    <Button
                      className="w-full bg-white text-primary hover:bg-slate-100 font-bold"
                      onClick={() => void confirmPoFromApprovedPr()}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-2" /> ยืนยัน PO (อ้าง PR อนุมัติแล้ว)
                    </Button>
                  )}
                {(purchase.status === 'DRAFT' || purchase.status === 'RETURNED_FOR_REVISION') &&
                  canEditPurchases &&
                  !hasPurchaseRequisition && (
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
                      อนุมัติโดย {displayOpsApproverName || '—'}{' '}
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
                      หลังส่งคู่ค้าแล้วระบบจะตั้งสถานะ ISSUED — การชำระและปิดยอดทำผ่านเอกสารรับวางบิลอ้างอิง PO และขั้นตอนบัญชี (ไม่จัดการใน PO)
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
                      การชำระและบันทึกจ่ายผ่านใบรับวางบิล / บัญชี — ไม่ผูกสถานะชำระกับหน้า PO นี้
                    </p>
                  </div>
                )}
                {purchase.status === 'COMPLETED' && (
                  <p className="text-sm text-white/90">
                    PO ปิดแล้ว (COMPLETED) — บันทึกตามขั้นตอนบัญชีหรือข้อมูลย้อนหลัง
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
