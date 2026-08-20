'use client';

import { use, useMemo, useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, CheckCircle, Loader2, XCircle, PackageSearch, Send, Ban, Pencil, Printer } from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useUser, useCollection } from '@/firebase';
import { collection, doc, getDocs, updateDoc, deleteField, type UpdateData } from 'firebase/firestore';
import { useAppUser } from '@/hooks/use-app-user';
import { canView, canDecidePurchaseRequest, canApprovePurchaseAsManager } from '@/lib/permissions';
import type {
  PurchaseRequest,
  User,
  Vendor,
  Purchase,
  PurchaseRequestStatus,
  PurchaseLineEntryMode,
  PurchaseRequestVatTreatment,
  PurchaseType,
  PrPaymentMilestoneDraft,
} from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { VendorSearchSelect } from '@/components/store/vendor-search-select';
import {
  PurchaseRequestLinesEditor,
  newLine,
  parsePrDecimal,
  type PrLineDraft,
} from '@/components/store/purchase-request-lines-editor';
import { Switch } from '@/components/ui/switch';
import {
  PurchaseRequestWhtCard,
  parsePrWhtRatePercent,
  prWhtPersistFields,
} from '@/components/store/purchase-request-wht-card';
import { computePurchaseTotalsFromLines, sumLineAmounts } from '@/lib/purchase/pr-totals';
import { replacePurchaseRequestLines } from '@/lib/purchase/pr-lines-repo';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue } from '@/lib/date-thai';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { roundMoney2 } from '@/lib/ops/purchase-payment-milestones';
import { cn } from '@/lib/utils';
import {
  buildPurchaseRequestPrintHtml,
  openStandardPrintWindow,
} from '@/lib/documents/standard-document-print';
import { useDocumentPrintLocale } from '@/hooks/use-document-print-locale';
import { DocumentPrintLocaleToggle } from '@/components/documents/document-print-locale-toggle';

function statusLabel(s: PurchaseRequestStatus) {
  const m: Record<PurchaseRequestStatus, string> = {
    DRAFT: 'ฉบับร่าง',
    PENDING_APPROVAL: 'รออนุมัติ',
    APPROVED: 'อนุมัติแล้ว',
    PO_ISSUED: 'ออก PO แล้ว',
    REJECTED: 'ไม่อนุมัติ',
    CANCELLED: 'ยกเลิก',
  };
  return m[s] || s;
}

export default function PurchaseRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { printLocale, setPrintLocale } = useDocumentPrintLocale();

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [vendorId, setVendorId] = useState<string | undefined>(undefined);
  const [needByDate, setNeedByDate] = useState('');
  const [lineEntryMode, setLineEntryMode] = useState<PurchaseLineEntryMode>('SERVICE');
  const [lines, setLines] = useState<PrLineDraft[]>([newLine()]);
  const [vatTreatment, setVatTreatment] = useState<PurchaseRequestVatTreatment>('EXCLUSIVE');
  const [purchasePaymentType, setPurchasePaymentType] = useState<PurchaseType>('CREDIT');
  const [paymentInstallmentsEnabled, setPaymentInstallmentsEnabled] = useState(false);
  const [milestones, setMilestones] = useState<PrPaymentMilestoneDraft[]>([
    { sequence: 1, label: 'งวดที่ 1', amount: 0 },
    { sequence: 2, label: 'งวดที่ 2', amount: 0 },
  ]);
  const [whtEnabled, setWhtEnabled] = useState(false);
  const [whtRateInput, setWhtRateInput] = useState('3');

  const [saving, setSaving] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [editingRejected, setEditingRejected] = useState(false);

  const okStore = useMemo(
    () => !!currentUser && canView(currentUser, 'store_inventory'),
    [currentUser]
  );
  const canApproveAsManager = useMemo(() => canApprovePurchaseAsManager(currentUser), [currentUser]);
  const ok = okStore || canApproveAsManager;

  const prRef = useMemoFirebase(
    () => (firestore && ok ? doc(firestore, 'purchase_requests', id) : null),
    [firestore, id, ok]
  );
  const { data: pr, isLoading } = useDoc<PurchaseRequest>(prRef as any);

  const canDecidePr = useMemo(
    () => canDecidePurchaseRequest(currentUser, pr ?? undefined),
    [currentUser, pr?.requestedByUid, pr?.status],
  );

  const linesQuery = useMemoFirebase(
    () => (firestore && ok ? collection(firestore, 'purchase_requests', id, 'lines') : null),
    [firestore, id, ok]
  );
  const { data: prLines } = useCollection<{
    id: string;
    itemDescription: string;
    quantity: number;
    unitPrice: number;
    amount: number;
    storeItemId?: string;
    storeItemCode?: string;
  }>(linesQuery as any);

  const storeItemsQuery = useMemoFirebase(() => (firestore && ok ? collection(firestore, 'store_items') : null), [firestore, ok]);
  const { data: storeItems } = useCollection(storeItemsQuery as any);

  const poRef = useMemoFirebase(
    () => (firestore && pr?.linkedPurchaseId ? doc(firestore, 'purchases', pr.linkedPurchaseId) : null),
    [firestore, pr?.linkedPurchaseId]
  );
  const { data: linkedPo } = useDoc<Purchase>(poRef as any);

  const vendorsQuery = useMemoFirebase(() => (firestore && ok ? collection(firestore, 'vendors') : null), [firestore, ok]);
  const { data: vendors } = useCollection<Vendor>(vendorsQuery as any);

  const companyRef = useMemoFirebase(
    () => (firestore && ok ? doc(firestore, 'system', 'company_profile') : null),
    [firestore, ok],
  );
  const { data: companyProfile } = useDoc<{
    companyNameTh?: string;
    companyNameEn?: string;
    taxId?: string;
    phone?: string;
    email?: string;
    addressLine1?: string;
    addressLine2?: string;
  }>(companyRef as any);

  const isDraft = pr?.status === 'DRAFT';
  const isRejected = pr?.status === 'REJECTED';
  const draftEditable = isDraft && okStore;
  const rejectedResubmitAllowed = isRejected && okStore;
  const formEditable = draftEditable || (rejectedResubmitAllowed && editingRejected);

  useEffect(() => {
    if (!pr) return;
    setTitle(pr.title || '');
    setNotes(pr.notes || '');
    setVendorId(pr.vendorId);
    setNeedByDate(pr.needByDate || '');
    setLineEntryMode(pr.lineEntryMode || 'SERVICE');
    setVatTreatment(pr.vatTreatment ?? 'EXCLUSIVE');
    setPurchasePaymentType(pr.purchasePaymentType ?? 'CREDIT');
    setPaymentInstallmentsEnabled(!!pr.paymentInstallmentsEnabled);
    setWhtEnabled(!!pr.supplierWithholdingEnabled);
    setWhtRateInput(String(pr.supplierWithholdingRatePercent ?? 3));
    if (pr.paymentMilestoneDrafts?.length) {
      setMilestones(pr.paymentMilestoneDrafts);
    }
  }, [pr?.id, pr?.updatedAt]);

  useEffect(() => {
    if (pr?.status !== 'REJECTED') setEditingRejected(false);
  }, [pr?.status]);

  useEffect(() => {
    if (!prLines) return;
    if (pr?.status !== 'DRAFT' && !(pr?.status === 'REJECTED' && editingRejected)) return;
    if (prLines.length === 0) {
      setLines([newLine()]);
      return;
    }
    setLines(
      prLines.map((row) => ({
        key: row.id,
        itemDescription: row.itemDescription,
        quantity: String(row.quantity),
        unitPrice: String(row.unitPrice),
        amount: row.amount,
        storeItemId: row.storeItemId,
        storeItemCode: row.storeItemCode,
      }))
    );
  }, [pr?.status, prLines, pr?.id, editingRejected]);

  const lineSum = useMemo(
    () => sumLineAmounts(lines.map((l) => ({ amount: l.amount }))),
    [lines]
  );
  const totals = useMemo(
    () => computePurchaseTotalsFromLines(lineSum, vatTreatment),
    [lineSum, vatTreatment]
  );

  const readonlyLines: PrLineDraft[] = useMemo(() => {
    if (!prLines?.length) return [];
    return prLines.map((row) => ({
      key: row.id,
      itemDescription: row.itemDescription,
      quantity: String(row.quantity),
      unitPrice: String(row.unitPrice),
      amount: row.amount,
      storeItemId: row.storeItemId,
      storeItemCode: row.storeItemCode,
    }));
  }, [prLines]);

  const validateSubmit = (submitForApproval: boolean): boolean => {
    if (!title.trim()) {
      toast({ variant: 'destructive', title: 'ระบุหัวข้อ' });
      return false;
    }
    if (submitForApproval && !vendorId) {
      toast({ variant: 'destructive', title: 'ระบุคู่ค้า' });
      return false;
    }
    const badLine = lines.find(
      (l) =>
        !l.itemDescription.trim() ||
        !(parsePrDecimal(l.quantity) > 0) ||
        parsePrDecimal(l.unitPrice) < 0
    );
    if (submitForApproval && badLine) {
      toast({ variant: 'destructive', title: 'รายการไม่ครบ', description: 'ตรวจทุกบรรทัดก่อนส่งอนุมัติ' });
      return false;
    }
    if (submitForApproval && lineEntryMode === 'INVENTORY') {
      const unlinked = lines.find((l) => l.itemDescription.trim() && !l.storeItemId);
      if (unlinked) {
        toast({
          variant: 'destructive',
          title: 'ยังไม่เลือกสินค้าคลัง',
          description: 'โหมดจากคลัง — กด «ค้นหา» เลือก SKU ให้ครบทุกบรรทัด',
        });
        return false;
      }
    }
    if (
      submitForApproval &&
      purchasePaymentType === 'CREDIT' &&
      paymentInstallmentsEnabled
    ) {
      const ms = milestones.slice().sort((a, b) => a.sequence - b.sequence);
      const sum = roundMoney2(ms.reduce((s, m) => s + Number(m.amount || 0), 0));
      if (ms.some((m) => !m.label.trim())) {
        toast({ variant: 'destructive', title: 'ระบุชื่องวดทุกแถว' });
        return false;
      }
      if (Math.abs(sum - totals.totalAmount) > 0.02) {
        toast({
          variant: 'destructive',
          title: 'ยอดงวดไม่เท่ายอดสุทธิ',
          description: `ผลรวมงวด ฿${sum.toFixed(2)} ต้องเท่า ฿${totals.totalAmount.toFixed(2)}`,
        });
        return false;
      }
    }
    if (submitForApproval && lineEntryMode === 'SERVICE' && whtEnabled) {
      if (parsePrWhtRatePercent(whtRateInput) == null) {
        toast({
          variant: 'destructive',
          title: 'อัตราหัก ณ ที่จ่ายไม่ถูกต้อง',
          description: 'ระบุเปอร์เซ็นต์มากกว่า 0 และไม่เกิน 100 หรือปิดการหัก',
        });
        return false;
      }
    }
    return true;
  };

  const persistDocAndLines = async (patch: UpdateData<PurchaseRequest>) => {
    if (!firestore || !prRef) return;
    await updateDoc(prRef, patch);
    await replacePurchaseRequestLines(
      firestore,
      id,
      lines
        .filter((l) => l.itemDescription.trim())
        .map((l) => ({
          itemDescription: l.itemDescription,
          quantity: parsePrDecimal(l.quantity),
          unitPrice: roundMoney2(parsePrDecimal(l.unitPrice)),
          amount: roundMoney2(Number(l.amount) || 0),
          storeItemId: l.storeItemId,
          storeItemCode: l.storeItemCode,
        }))
    );
  };

  const saveDraft = async () => {
    if (!okStore) return;
    if (!firestore || !pr || !prRef) return;
    if (pr.status !== 'DRAFT' && pr.status !== 'REJECTED') return;
    if (!validateSubmit(false)) return;
    setSaving(true);
    try {
      const milestonePayload =
        purchasePaymentType === 'CREDIT' && paymentInstallmentsEnabled
          ? milestones
              .slice()
              .sort((a, b) => a.sequence - b.sequence)
              .map((m, i) => ({
                sequence: i + 1,
                label: m.label.trim(),
                amount: roundMoney2(Number(m.amount) || 0),
                dueDate: m.dueDate?.trim() || undefined,
              }))
          : null;

      await persistDocAndLines({
        title: title.trim(),
        notes: notes.trim() || undefined,
        vendorId: vendorId || undefined,
        needByDate: needByDate || undefined,
        estimatedAmount: totals.totalAmount,
        amountBeforeTax: totals.amountBeforeTax,
        vatAmount: totals.vatAmount,
        totalAmount: totals.totalAmount,
        lineEntryMode,
        vatTreatment,
        purchasePaymentType,
        paymentInstallmentsEnabled: purchasePaymentType === 'CREDIT' ? paymentInstallmentsEnabled : false,
        paymentMilestoneDrafts: milestonePayload ?? undefined,
        ...prWhtPersistFields(lineEntryMode, whtEnabled, whtRateInput),
        updatedAt: Date.now(),
      });
      toast({ title: pr.status === 'REJECTED' ? 'บันทึกแล้ว' : 'บันทึกแล้ว' });
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'บันทึกไม่สำเร็จ' });
    } finally {
      setSaving(false);
    }
  };

  const submitForApproval = async () => {
    if (!okStore) return;
    if (!firestore || !pr || !prRef) return;
    if (pr.status !== 'DRAFT' && pr.status !== 'REJECTED') return;
    if (!validateSubmit(true)) return;
    setSaving(true);
    try {
      const now = Date.now();
      const milestonePayload =
        purchasePaymentType === 'CREDIT' && paymentInstallmentsEnabled
          ? milestones
              .slice()
              .sort((a, b) => a.sequence - b.sequence)
              .map((m, i) => ({
                sequence: i + 1,
                label: m.label.trim(),
                amount: roundMoney2(Number(m.amount) || 0),
                dueDate: m.dueDate?.trim() || undefined,
              }))
          : null;

      await persistDocAndLines({
        title: title.trim(),
        notes: notes.trim() || undefined,
        vendorId,
        needByDate: needByDate || undefined,
        estimatedAmount: totals.totalAmount,
        amountBeforeTax: totals.amountBeforeTax,
        vatAmount: totals.vatAmount,
        totalAmount: totals.totalAmount,
        lineEntryMode,
        vatTreatment,
        purchasePaymentType,
        paymentInstallmentsEnabled: purchasePaymentType === 'CREDIT' ? paymentInstallmentsEnabled : false,
        paymentMilestoneDrafts: milestonePayload ?? undefined,
        ...prWhtPersistFields(lineEntryMode, whtEnabled, whtRateInput),
        status: 'PENDING_APPROVAL' as PurchaseRequestStatus,
        requestedByUid: pr.requestedByUid || currentUser.id,
        requestedByName: pr.requestedByName || currentUser.displayName || currentUser.email || '',
        submittedAt: now,
        rejectionReason: deleteField(),
        decidedAt: deleteField(),
        decidedByUid: deleteField(),
        decidedByName: deleteField(),
        updatedAt: now,
      });
      setEditingRejected(false);
      toast({ title: 'ส่งขออนุมัติแล้ว' });
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'ส่งไม่สำเร็จ' });
    } finally {
      setSaving(false);
    }
  };

  const approve = async () => {
    if (!firestore || !pr || pr.status !== 'PENDING_APPROVAL' || !prRef || !currentUser) return;
    if (!canDecidePurchaseRequest(currentUser, pr)) {
      toast({
        variant: 'destructive',
        title: 'ไม่มีสิทธิ์อนุมัติ',
        description: pr.requestedByUid === currentUser.id
          ? 'ผู้จัดทำ PR ไม่สามารถอนุมัติเอกสารของตนเองได้'
          : 'อนุมัติ PR ได้เฉพาะผู้จัดการปฏิบัติการ',
      });
      return;
    }
    const lineSnap = await getDocs(collection(firestore, 'purchase_requests', id, 'lines'));
    if (lineSnap.empty) {
      toast({
        variant: 'destructive',
        title: 'อนุมัติไม่ได้',
        description: 'PR ต้องมีอย่างน้อยหนึ่งบรรทัดรายการ',
      });
      return;
    }
    setSaving(true);
    try {
      const now = Date.now();
      const name = currentUser.displayName || currentUser.email || '';
      await updateDoc(prRef, {
        status: 'APPROVED' as PurchaseRequestStatus,
        decidedAt: now,
        decidedByUid: currentUser.id,
        decidedByName: name,
        updatedAt: now,
      });
      toast({ title: 'อนุมัติ PR แล้ว', description: 'ฝ่ายคลังสามารถสร้างใบสั่งซื้ออ้างอิง PR นี้' });
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'อนุมัติไม่สำเร็จ' });
    } finally {
      setSaving(false);
    }
  };

  const reject = async () => {
    if (!firestore || !pr || pr.status !== 'PENDING_APPROVAL' || !prRef || !currentUser) return;
    if (!canDecidePurchaseRequest(currentUser, pr)) {
      toast({
        variant: 'destructive',
        title: 'ไม่มีสิทธิ์',
        description: pr.requestedByUid === currentUser.id
          ? 'ผู้จัดทำ PR ไม่สามารถพิจารณาเอกสารของตนเองได้'
          : 'พิจารณา PR ได้เฉพาะผู้จัดการปฏิบัติการ',
      });
      return;
    }
    const r = rejectReason.trim();
    if (r.length < 3) {
      toast({ variant: 'destructive', title: 'ระบุเหตุผล' });
      return;
    }
    setSaving(true);
    try {
      const now = Date.now();
      const name = currentUser.displayName || currentUser.email || '';
      await updateDoc(prRef, {
        status: 'REJECTED' as PurchaseRequestStatus,
        decidedAt: now,
        decidedByUid: currentUser.id,
        decidedByName: name,
        rejectionReason: r,
        updatedAt: now,
      });
      setRejectOpen(false);
      setRejectReason('');
      toast({ title: 'บันทึกผลไม่อนุมัติ' });
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'บันทึกไม่สำเร็จ' });
    } finally {
      setSaving(false);
    }
  };

  const cancel = async () => {
    if (!okStore) return;
    if (!firestore || !pr || (pr.status !== 'DRAFT' && pr.status !== 'PENDING_APPROVAL') || !prRef) return;
    setSaving(true);
    try {
      await updateDoc(prRef, {
        status: 'CANCELLED' as PurchaseRequestStatus,
        updatedAt: Date.now(),
      });
      toast({ title: 'ยกเลิก PR' });
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = useCallback(async () => {
    if (!pr) return;
    const printLines = (formEditable ? lines : readonlyLines)
      .filter((l) => (l.itemDescription || '').trim() || Number(l.amount) > 0)
      .map((l) => ({
        itemDescription: l.itemDescription,
        quantity: parsePrDecimal(l.quantity),
        unitPrice: parsePrDecimal(l.unitPrice),
        amount: Number(l.amount) || 0,
      }));
    const vendor = vendors?.find((x) => x.id === (formEditable ? vendorId : pr.vendorId));
    try {
      const body = buildPurchaseRequestPrintHtml({
        company: companyProfile ?? undefined,
        request: {
          ...pr,
          title: formEditable ? title : pr.title,
          notes: formEditable ? notes : pr.notes,
          needByDate: formEditable ? needByDate : pr.needByDate,
          purchasePaymentType: formEditable ? purchasePaymentType : pr.purchasePaymentType,
          vatTreatment: formEditable ? vatTreatment : pr.vatTreatment,
          lineEntryMode: formEditable ? lineEntryMode : pr.lineEntryMode,
          amountBeforeTax: formEditable ? totals.amountBeforeTax : pr.amountBeforeTax,
          vatAmount: formEditable ? totals.vatAmount : pr.vatAmount,
          totalAmount: formEditable ? totals.totalAmount : pr.totalAmount,
          ...(formEditable
            ? prWhtPersistFields(lineEntryMode, whtEnabled, whtRateInput)
            : {}),
        },
        vendor: vendor ?? undefined,
        lines: printLines,
        printedAtMs: Date.now(),
        locale: printLocale,
      });
      if (
        !(await openStandardPrintWindow({
          windowTitle: pr.requestNo || 'PR',
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
  }, [
    pr,
    formEditable,
    lines,
    readonlyLines,
    vendors,
    vendorId,
    companyProfile,
    title,
    notes,
    needByDate,
    purchasePaymentType,
    vatTreatment,
    lineEntryMode,
    whtEnabled,
    whtRateInput,
    totals,
    printLocale,
    toast,
  ]);

  if (isUserLoading || userLoading || !currentUser) {
    return (
      <div className="flex min-h-[50vh] w-full items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }
  if (!ok) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <p className="p-8 text-center text-muted-foreground">คุณไม่มีสิทธิ์</p>
      </AppShell>
    );
  }
  if (isLoading || !pr) {
    return (
      <div className="flex min-h-[50vh] w-full items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  const v = vendors?.find((x) => x.id === pr.vendorId);
  const showPoLink = pr.status === 'APPROVED' && !pr.linkedPurchaseId;
  const showPO = pr.linkedPurchaseId && linkedPo;

  const displayLines = formEditable ? lines : readonlyLines;
  const displayMode = formEditable ? lineEntryMode : pr.lineEntryMode || 'SERVICE';
  const displayStatus: PurchaseRequestStatus =
    pr.status === 'APPROVED' && pr.linkedPurchaseId ? 'PO_ISSUED' : pr.status;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="mx-auto max-w-5xl space-y-6 pb-16">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="icon" asChild>
              <Link href="/store/purchase-requests">
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <div>
              <h1 className="font-mono text-2xl font-bold text-primary">{pr.requestNo}</h1>
              <p className="text-sm text-muted-foreground">คำขออนุมัติสั่งซื้อ</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DocumentPrintLocaleToggle printLocale={printLocale} setPrintLocale={setPrintLocale} showLabel />
            <Button type="button" variant="outline" className="gap-2" onClick={() => void handlePrint()}>
              <Printer className="h-4 w-4" /> พิมพ์เอกสาร
            </Button>
            <Badge
              className={
                displayStatus === 'APPROVED'
                  ? 'bg-green-100 text-green-900'
                  : displayStatus === 'PO_ISSUED'
                    ? 'bg-blue-100 text-blue-900'
                    : displayStatus === 'PENDING_APPROVAL'
                      ? 'bg-amber-100 text-amber-900'
                      : displayStatus === 'REJECTED'
                        ? 'bg-red-100 text-red-900'
                        : ''
              }
            >
              {statusLabel(displayStatus)}
            </Badge>
          </div>
        </div>

        <div className={cn('grid gap-4', isRejected && 'sm:grid-cols-2')}>
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="grid gap-4 pt-5 sm:grid-cols-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">ผู้จัดทำ</p>
                <p className="font-medium">{pr.requestedByName?.trim() || '—'}</p>
              </div>
              <div className="sm:text-center sm:border-x sm:px-3">
                <p className="text-xs text-muted-foreground">ใบสั่งซื้อที่อ้างอิง</p>
                {showPO ? (
                  <Button type="button" variant="link" className="h-auto p-0 text-base font-mono" asChild>
                    <Link href={`/purchases/${linkedPo!.id}`}>{linkedPo!.purchaseNo}</Link>
                  </Button>
                ) : (
                  <p className="font-medium">—</p>
                )}
              </div>
              <div className="sm:text-right">
                <p className="text-xs text-muted-foreground">ผู้อนุมัติ</p>
                <p className="font-medium">
                  {displayStatus === 'APPROVED' ||
                  displayStatus === 'PO_ISSUED' ||
                  displayStatus === 'REJECTED'
                    ? pr.decidedByName?.trim() || '—'
                    : '—'}
                </p>
              </div>
            </CardContent>
          </Card>

          {isRejected && (
            <Card className="border-red-200 bg-red-50/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-red-900">เหตุผลไม่อนุมัติ</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <p className="whitespace-pre-wrap text-red-950">
                  {pr.rejectionReason?.trim() || '— ไม่ได้ระบุเหตุผล —'}
                </p>
                {pr.decidedAt ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    โดย {pr.decidedByName?.trim() || 'ผู้จัดการ'} ·{' '}
                    {new Date(pr.decidedAt).toLocaleString('th-TH')}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          )}
        </div>

        {showPoLink && okStore && (
          <Card className="border-emerald-200 bg-emerald-50/40">
            <CardContent className="pt-4">
              <p className="mb-3 text-sm text-emerald-900">
                PR อนุมัติแล้ว — สร้าง PO จากเมนูใบสั่งซื้อ ระบบจะดึงรายการและยอดจาก PR นี้ (แก้บรรทัดใน PO ไม่ได้)
              </p>
              <Button className="font-bold" asChild>
                <Link href="/purchases">
                  <PackageSearch className="mr-2 h-4 w-4" /> สร้างใบสั่งซื้อ
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="space-y-4 pt-6">
            {pr.status === 'PENDING_APPROVAL' && v ? (
              <p className="text-sm text-muted-foreground">รออนุมัติ — คู่ค้าเสนอ: {v.vendorName}</p>
            ) : null}

            <div className="space-y-2">
              <Label>หัวข้อ</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} readOnly={!formEditable} disabled={!formEditable} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(12rem,1.5fr)_repeat(3,minmax(0,1fr))]">
              <div className="min-w-0 space-y-2">
                {formEditable ? (
                  <VendorSearchSelect
                    label="คู่ค้า (เสนอ)"
                    vendors={vendors ?? undefined}
                    value={vendorId}
                    onChange={setVendorId}
                    disabled={saving}
                  />
                ) : (
                  <>
                    <Label>คู่ค้า (เสนอ)</Label>
                    <p className="pt-1 font-medium break-words">{v?.vendorName || '—'}</p>
                  </>
                )}
              </div>
              <div className="space-y-2">
                <Label>วันที่ต้องการของ (อ้างอิง)</Label>
                {formEditable ? (
                  <DatePickerThaiBE
                    className="h-11"
                    value={htmlDateValueToTimestampMs(needByDate)}
                    onChange={(ms) => setNeedByDate(timestampToHtmlDateValue(ms))}
                  />
                ) : (
                  <p className="pt-1">{needByDate || '—'}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>ภาษีมูลค่าเพิ่ม</Label>
                {formEditable ? (
                  <Select value={vatTreatment} onValueChange={(x) => setVatTreatment(x as PurchaseRequestVatTreatment)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">ไม่มี VAT</SelectItem>
                      <SelectItem value="EXCLUSIVE">ยังไม่รวม VAT (+7%)</SelectItem>
                      <SelectItem value="INCLUSIVE">ราคาบรรทัดรวม VAT แล้ว</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="pt-1">{vatTreatment}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>การชำระเงิน</Label>
                {formEditable ? (
                  <Select value={purchasePaymentType} onValueChange={(x) => setPurchasePaymentType(x as PurchaseType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CASH">เงินสด</SelectItem>
                      <SelectItem value="CREDIT">เครดิต</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="pt-1">{purchasePaymentType}</p>
                )}
              </div>
            </div>

            {purchasePaymentType === 'CREDIT' && draftEditable ? (
              <div className="flex items-center justify-between rounded-lg border p-3 sm:max-w-md">
                <div className="text-sm font-medium">แบ่งจ่ายหลายงวด</div>
                <Switch checked={paymentInstallmentsEnabled} onCheckedChange={setPaymentInstallmentsEnabled} />
              </div>
            ) : null}
          </CardContent>
        </Card>

        {(formEditable ? lineEntryMode : pr.lineEntryMode || 'SERVICE') === 'SERVICE' ? (
          <PurchaseRequestWhtCard
            enabled={formEditable ? whtEnabled : !!pr.supplierWithholdingEnabled}
            rateInput={
              formEditable
                ? whtRateInput
                : String(pr.supplierWithholdingRatePercent ?? 3)
            }
            onEnabledChange={setWhtEnabled}
            onRateChange={setWhtRateInput}
            readOnly={!formEditable}
          />
        ) : null}

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle>รายการและยอดเงิน</CardTitle>
              <CardDescription>
                {formEditable
                  ? 'แก้ไขรายการได้ — บันทึกหรือส่งอนุมัติเมื่อพร้อม'
                  : isRejected
                    ? 'กด «แก้ไขรายการ» เพื่อปรับตามเหตุผลที่ไม่อนุมัติ แล้วส่งอนุมัติใหม่'
                    : 'สรุปจาก PR'}
              </CardDescription>
            </div>
            {rejectedResubmitAllowed && !editingRejected && (
              <Button type="button" variant="outline" className="shrink-0" onClick={() => setEditingRejected(true)}>
                <Pencil className="mr-2 h-4 w-4" /> แก้ไขรายการ
              </Button>
            )}
            {rejectedResubmitAllowed && editingRejected && (
              <div className="flex flex-wrap justify-end gap-2 shrink-0">
                <Button type="button" variant="outline" onClick={() => void saveDraft()} disabled={saving}>
                  บันทึก
                </Button>
                <Button type="button" className="font-bold" onClick={() => void submitForApproval()} disabled={saving}>
                  <Send className="mr-2 h-4 w-4" /> ส่งอนุมัติ
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {!formEditable && displayLines.length === 0 ? (
              <p className="text-sm text-muted-foreground">ไม่มีรายการบรรทัดใน PR นี้ (เอกสารเก่าก่อนปรับระบบ)</p>
            ) : (
              <PurchaseRequestLinesEditor
                lineEntryMode={displayMode}
                onLineEntryModeChange={formEditable ? setLineEntryMode : () => {}}
                lines={displayLines.length > 0 ? displayLines : formEditable ? [newLine()] : []}
                onLinesChange={formEditable ? setLines : () => {}}
                storeItems={storeItems as any}
                readOnly={!formEditable}
              />
            )}

            <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
              <div className="space-y-2">
                <Label>หมายเหตุ</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  readOnly={!formEditable}
                  rows={3}
                  disabled={!formEditable}
                />
              </div>
              <div className="flex flex-wrap justify-end gap-6 rounded-lg bg-muted/30 p-4 text-sm">
                <div className="text-right">
                  <div className="text-muted-foreground">ภาษี 7%</div>
                  <div className="font-mono font-semibold">
                    ฿{(formEditable ? totals.vatAmount : pr.vatAmount ?? 0).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                    })}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-muted-foreground">ยอดสุทธิ</div>
                  <div className="font-mono font-bold text-lg text-primary">
                    ฿{(formEditable ? totals.totalAmount : pr.totalAmount ?? pr.estimatedAmount ?? 0).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                    })}
                  </div>
                </div>
              </div>
            </div>

            {purchasePaymentType === 'CREDIT' && paymentInstallmentsEnabled && formEditable && (
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label>แผนงวดชำระ (ร่าง)</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setMilestones((prev) => [
                        ...prev,
                        { sequence: prev.length + 1, label: `งวดที่ ${prev.length + 1}`, amount: 0 },
                      ])
                    }
                  >
                    เพิ่มงวด
                  </Button>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-24">งวด</TableHead>
                      <TableHead>ชื่อเรียก</TableHead>
                      <TableHead className="w-36">ครบกำหนด</TableHead>
                      <TableHead className="w-36 text-right">ยอดงวด</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {milestones
                      .slice()
                      .sort((a, b) => a.sequence - b.sequence)
                      .map((m, idx) => (
                        <TableRow key={m.sequence}>
                          <TableCell>{idx + 1}</TableCell>
                          <TableCell>
                            <Input
                              value={m.label}
                              onChange={(e) =>
                                setMilestones((rows) =>
                                  rows.map((r) => (r.sequence === m.sequence ? { ...r, label: e.target.value } : r))
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="date"
                              value={m.dueDate || ''}
                              onChange={(e) =>
                                setMilestones((rows) =>
                                  rows.map((r) =>
                                    r.sequence === m.sequence ? { ...r, dueDate: e.target.value } : r
                                  )
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              className="text-right tabular-nums"
                              inputMode="decimal"
                              value={m.amount || ''}
                              onChange={(e) =>
                                setMilestones((rows) =>
                                  rows.map((r) =>
                                    r.sequence === m.sequence
                                      ? { ...r, amount: parseFloat(e.target.value) || 0 }
                                      : r
                                  )
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              disabled={milestones.length <= 1}
                              onClick={() => setMilestones((rows) => rows.filter((r) => r.sequence !== m.sequence))}
                            >
                              ×
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {!formEditable && pr.paymentInstallmentsEnabled && pr.paymentMilestoneDrafts?.length ? (
              <div className="rounded-md border p-3 text-sm">
                <div className="font-medium mb-2">แผนงวด (ตาม PR)</div>
                <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                  {pr.paymentMilestoneDrafts
                    .slice()
                    .sort((a, b) => a.sequence - b.sequence)
                    .map((m) => (
                      <li key={m.sequence}>
                        {m.label} — ฿{m.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}{' '}
                        {m.dueDate ? `(กำหนด ${m.dueDate})` : ''}
                      </li>
                    ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {isDraft && !okStore && (
          <p className="text-sm text-muted-foreground">ฉบับร่าง — แก้ไข/ส่งอนุมัติได้เฉพาะฝ่ายคลัง/จัดซื้อ</p>
        )}

        {pr.status === 'DRAFT' && okStore && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void saveDraft()} disabled={saving}>
              บันทึกฉบับร่าง
            </Button>
            <Button type="button" className="font-bold" onClick={() => void submitForApproval()} disabled={saving}>
              <Send className="mr-2 h-4 w-4" /> ส่งขออนุมัติ
            </Button>
            <Button type="button" variant="ghost" onClick={() => void cancel()} disabled={saving}>
              <Ban className="mr-2 h-4 w-4" /> ยกเลิก
            </Button>
          </div>
        )}

        {pr.status === 'PENDING_APPROVAL' && canDecidePr && (
          <div className="flex flex-wrap gap-2">
            <Button className="bg-green-600 font-bold hover:bg-green-700" onClick={() => void approve()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
              อนุมัติ
            </Button>
            <Button variant="destructive" onClick={() => setRejectOpen(true)} disabled={saving}>
              <XCircle className="mr-2 h-4 w-4" /> ไม่อนุมัติ
            </Button>
          </div>
        )}

        {pr.status === 'PENDING_APPROVAL' && canDecidePr && (
          <p className="text-xs text-muted-foreground">คุณกำลังอนุมัติในฐานะผู้จัดการฝ่ายปฏิบัติการ</p>
        )}
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ไม่อนุมัติ PR นี้</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>เหตุผล (ส่งถึงผู้ขอ)</Label>
            <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRejectOpen(false)} disabled={saving}>
              ยกเลิก
            </Button>
            <Button type="button" variant="destructive" onClick={() => void reject()} disabled={saving}>
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
