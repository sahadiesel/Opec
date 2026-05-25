'use client';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  Send,
  Banknote,
  Building2,
  ClipboardCheck,
  FileText,
  Printer,
  Eye,
  Pencil,
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useCollection, useFirebaseApp } from '@/firebase';
import {
  collection,
  deleteField,
  doc,
  limit,
  query,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useAppUser } from '@/hooks/use-app-user';
import {
  canCreateVerifyPrintWhtCertificate,
  canMarkPurchaseVendorBillPaid,
  canPreviewVendorBillWhtCertificate,
  canView,
} from '@/lib/permissions';
import {
  BankAccount,
  CashbookEntry,
  PaymentMethod,
  Purchase,
  PurchasePaymentMilestone,
  PurchaseRequest,
  PurchaseVendorBill,
  PurchaseVendorBillStatus,
  VendorBillPaymentInstallment,
  User,
  Vendor,
  VendorBillSupportingDocumentLink,
  VendorBillVatTreatmentOverride,
  VendorBillWhtPresetCategory,
  WithholdingCertificateCopyVariant,
  WithholdingCertificateDocument,
} from '@/lib/types';
import { executeVendorBillPayment } from '@/lib/ops/vendor-bill-payment';
import {
  billUsesPaymentInstallmentPlan,
  buildEqualInstallmentDrafts,
  mergePaidInstallmentsWithPendingDraft,
  singleFullInstallment,
  validateInstallmentsAgainstTotal,
  vendorBillRemainingForPendingInstallments,
  vendorBillTotalInclVat,
} from '@/lib/ops/vendor-bill-installment-plan';
import {
  effectiveVendorBillWhtRatePercent,
  effectiveVendorBillWithholdingEnabled,
  resolveVendorBillVatAmounts,
  roundMoney2,
  supplierWithholdingOnVendorBill,
  vendorBillWhtPresetRatePercent,
} from '@/lib/ops/purchase-payment-milestones';
import {
  buildWithholdingCertificateDocumentHtml,
  buildWithholdingCertificatePayeeCopies12Html,
  openWithholdingCertificatePrintWindow,
  openWithholdingCertificatePreviewTab,
} from '@/lib/documents/withholding-certificate-50-tw-print';
import {
  buildWithholdingCertificateDraft,
  stripUndefinedForFirestore,
  type CompanyProfileWhtInput,
} from '@/lib/wht/wht-certificate-build';
import { buildWhtAuditLogEntry } from '@/lib/wht/wht-certificate-audit';
import { assignWhtCertificateNumberIfMissing } from '@/lib/wht/wht-certificate-assign-number';
import {
  effectiveWhtCertificateDocumentNo,
  validateWhtCertificateForOfficialIssue,
  validateWhtCertificateForOfficialPrint,
  validateWhtCertificateForPayeeCopies12Print,
  validateWhtCertificateForPreviewPrint,
} from '@/lib/wht/wht-certificate-validation';
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue } from '@/lib/date-thai';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  uploadVendorBillPaymentProofPdf,
  validateVendorBillPaymentProof,
} from '@/lib/storage/vendor-bill-payment-proofs';

function statusLabel(s: PurchaseVendorBillStatus) {
  if (s === 'DRAFT') return 'ฉบับร่าง';
  if (s === 'SUBMITTED') return 'รอจ่ายเงิน';
  if (s === 'PARTIALLY_PAID') return 'จ่ายบางส่วน';
  return 'จ่ายครบแล้ว';
}

type SupportingFormRow = { attached: boolean; documentNo: string; documentDate: string };

function supportingFromBill(link?: VendorBillSupportingDocumentLink): SupportingFormRow {
  return {
    attached: !!link?.attached,
    documentNo: link?.documentNo ?? '',
    documentDate: link?.documentDate ?? '',
  };
}

function supportingToFirestore(row: SupportingFormRow): VendorBillSupportingDocumentLink {
  if (!row.attached) return { attached: false };
  return {
    attached: true,
    documentNo: row.documentNo.trim(),
    documentDate: row.documentDate.trim(),
  };
}

function validateSupportingRow(label: string, row: SupportingFormRow): string | null {
  if (!row.attached) return null;
  if (!row.documentNo.trim() || !row.documentDate.trim()) {
    return `${label}: ต้องระบุเลขที่และวันที่เมื่อติ๊กแนบเอกสาร`;
  }
  return null;
}

const WHT_PRESET_OPTIONS: { id: VendorBillWhtPresetCategory; title: string; detail: string }[] = [
  { id: 'TRANSPORT_FREIGHT', title: 'ค่าขนส่ง', detail: 'หัก ณ ที่จ่าย 1%' },
  { id: 'SERVICE', title: 'ค่าบริการ', detail: 'หัก ณ ที่จ่าย 3%' },
  { id: 'RENT', title: 'ค่าเช่า', detail: 'หัก ณ ที่จ่าย 5%' },
];

function inferWhtPresetFromEffectiveRate(rate: number): VendorBillWhtPresetCategory {
  if (Math.abs(rate - 1) < 0.02) return 'TRANSPORT_FREIGHT';
  if (Math.abs(rate - 5) < 0.02) return 'RENT';
  return 'SERVICE';
}

type VatModeUi = 'AUTO' | VendorBillVatTreatmentOverride;

type AccountingVatDraft = 'AUTO' | VendorBillVatTreatmentOverride;
type AccountingWhtDraftMode = 'inherit' | 'on' | 'off';

function SupportingDocReadOnly({
  title,
  link,
}: {
  title: string;
  link?: VendorBillSupportingDocumentLink;
}) {
  if (!link?.attached) {
    return (
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{title}:</span> ไม่แนบ — อ้างอิงเฉพาะ PO ภายในระบบ
      </p>
    );
  }
  return (
    <p className="text-sm">
      <span className="font-medium">{title}:</span> เลขที่{' '}
      <span className="font-mono font-semibold">{link.documentNo?.trim() || '—'}</span>
      {' · '}วันที่ {link.documentDate?.trim() || '—'}
    </p>
  );
}

export default function StoreVendorBillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const pathname = usePathname();
  const vendorBillsListHref = pathname.startsWith('/ap-bills') ? '/ap-bills' : '/store/vendor-bills';
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const firebaseApp = useFirebaseApp();
  const { toast } = useToast();

  const okStore = useMemo(
    () => !!currentUser && canView(currentUser, 'store_inventory'),
    [currentUser]
  );
  const okAccounting = useMemo(
    () => !!currentUser && canView(currentUser, 'accounts_payable'),
    [currentUser]
  );
  const canPay = useMemo(() => canMarkPurchaseVendorBillPaid(currentUser), [currentUser]);
  const canOpen = okStore || okAccounting || canPay;

  const billRef = useMemoFirebase(
    () => (firestore && canOpen ? doc(firestore, 'purchase_vendor_bills', id) : null),
    [firestore, id, canOpen]
  );
  const { data: bill, isLoading: billLoading } = useDoc<PurchaseVendorBill>(billRef as any);

  const canEditAccountingBillTax = useMemo(
    () =>
      !!bill &&
      canPay &&
      (bill.status === 'SUBMITTED' || bill.status === 'PARTIALLY_PAID'),
    [bill, canPay],
  );

  const purchaseRef = useMemoFirebase(
    () =>
      firestore && bill?.purchaseId ? doc(firestore, 'purchases', bill.purchaseId) : null,
    [firestore, bill?.purchaseId]
  );
  const { data: purchase } = useDoc<Purchase>(purchaseRef as any);

  const purchaseRequestRef = useMemoFirebase(
    () =>
      firestore && purchase?.purchaseRequestId
        ? doc(firestore, 'purchase_requests', purchase.purchaseRequestId)
        : null,
    [firestore, purchase?.purchaseRequestId],
  );
  const { data: purchaseRequest } = useDoc<PurchaseRequest>(purchaseRequestRef as any);

  const vendorRef = useMemoFirebase(
    () => (firestore && bill?.vendorId ? doc(firestore, 'vendors', bill.vendorId) : null),
    [firestore, bill?.vendorId]
  );
  const { data: vendor } = useDoc<Vendor>(vendorRef as any);

  const companyProfileRef = useMemoFirebase(
    () => (firestore && canOpen ? doc(firestore, 'system', 'company_profile') : null),
    [firestore, canOpen],
  );
  const { data: companyProfile } = useDoc<CompanyProfileWhtInput>(companyProfileRef as any);

  const milestoneRef = useMemoFirebase(
    () =>
      firestore && bill?.purchaseId && bill?.milestoneId
        ? doc(firestore, 'purchases', bill.purchaseId, 'payment_milestones', bill.milestoneId)
        : null,
    [firestore, bill?.purchaseId, bill?.milestoneId]
  );
  const { data: linkedMilestone } = useDoc<PurchasePaymentMilestone>(milestoneRef as any);

  const bankAccountsQuery = useMemoFirebase(
    () => (firestore && canPay ? collection(firestore, 'bank_accounts') : null),
    [firestore, canPay]
  );
  const { data: bankAccounts } = useCollection(bankAccountsQuery as any);

  const cashbookRef = useMemoFirebase(
    () => (firestore && bill?.cashbookEntryId ? doc(firestore, 'cashbook_entries', bill.cashbookEntryId) : null),
    [firestore, bill?.cashbookEntryId],
  );
  const { data: payoutCashbook, isLoading: payoutCashbookLoading } = useDoc<CashbookEntry>(cashbookRef as any);

  const payoutBankRef = useMemoFirebase(
    () =>
      firestore && payoutCashbook?.bankAccountId
        ? doc(firestore, 'bank_accounts', payoutCashbook.bankAccountId)
        : null,
    [firestore, payoutCashbook?.bankAccountId],
  );
  const { data: payoutBankAccount } = useDoc<BankAccount>(payoutBankRef as any);

  const whtCertRef = useMemoFirebase(
    () =>
      firestore && bill?.whtCertificateDocumentId
        ? doc(firestore, 'withholding_certificate_documents', bill.whtCertificateDocumentId)
        : null,
    [firestore, bill?.whtCertificateDocumentId],
  );
  const { data: whtCertificate } = useDoc<WithholdingCertificateDocument>(whtCertRef as any);

  const whtAtSourceQuery = useMemoFirebase(
    () =>
      firestore && bill?.status === 'PAID' && bill?.id
        ? query(collection(firestore, 'withholding_at_source_items'), where('vendorBillId', '==', bill.id), limit(1))
        : null,
    [firestore, bill?.id, bill?.status],
  );
  const { data: whtAtSourceRows } = useCollection(whtAtSourceQuery as any);
  const whtAtSourceItem = whtAtSourceRows?.[0] as { id?: string } | undefined;

  const canPreviewVendorBillWht = useMemo(
    () => canPreviewVendorBillWhtCertificate(currentUser),
    [currentUser],
  );
  const canAssignWhtCertificateNo = useMemo(
    () => canCreateVerifyPrintWhtCertificate(currentUser),
    [currentUser],
  );

  const [billingDate, setBillingDate] = useState('');
  const [payDate, setPayDate] = useState('');
  const [notes, setNotes] = useState('');
  const [payoutBankId, setPayoutBankId] = useState('');
  const [payoutMethod, setPayoutMethod] = useState<PaymentMethod>('TRANSFER');
  const [payoutEntryDate, setPayoutEntryDate] = useState('');
  const [paying, setPaying] = useState(false);
  const [paymentProofFile, setPaymentProofFile] = useState<File | null>(null);
  const paymentProofInputRef = useRef<HTMLInputElement>(null);
  const [submittedWhtBusy, setSubmittedWhtBusy] = useState(false);
  const [whtPrintBusy, setWhtPrintBusy] = useState(false);
  const [whtAssignNoBusy, setWhtAssignNoBusy] = useState(false);
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);
  /** บัญชีแก้ % หัก ณ ที่จ่ายเฉพาะใบนี้ (ก่อนจ่าย) */
  const [whtRateEditOpen, setWhtRateEditOpen] = useState(false);
  const [whtRateInput, setWhtRateInput] = useState('');
  const [whtRateSaving, setWhtRateSaving] = useState(false);
  const [whtPresetDialogOpen, setWhtPresetDialogOpen] = useState(false);
  const [whtPresetChoice, setWhtPresetChoice] = useState<VendorBillWhtPresetCategory>('SERVICE');
  const [whtPresetSaving, setWhtPresetSaving] = useState(false);
  /** ฐานหัก ณ ที่จ่าย (ก่อนภาษี) กำหนดมือ — ไม่เท่ากับยอดก่อนภาษีในใบ */
  const [whtTaxBaseDialogOpen, setWhtTaxBaseDialogOpen] = useState(false);
  const [whtTaxBaseInput, setWhtTaxBaseInput] = useState('');
  const [whtTaxBaseSaving, setWhtTaxBaseSaving] = useState(false);
  /** พรีวิว + เลือกชุดพิมพ์หัก ณ ที่จ่าย (หลังจ่ายแล้ว) */
  const [whtHubOpen, setWhtHubOpen] = useState(false);
  const [vatMode, setVatMode] = useState<VatModeUi>('AUTO');
  const [supportingDelivery, setSupportingDelivery] = useState<SupportingFormRow>(() =>
    supportingFromBill(undefined),
  );
  const [supportingTaxInv, setSupportingTaxInv] = useState<SupportingFormRow>(() =>
    supportingFromBill(undefined),
  );
  const [supportingReceipt, setSupportingReceipt] = useState<SupportingFormRow>(() =>
    supportingFromBill(undefined),
  );
  const [installmentsDraft, setInstallmentsDraft] = useState<VendorBillPaymentInstallment[]>([]);
  const [installmentPayTargetId, setInstallmentPayTargetId] = useState('');
  const [docCloseBusy, setDocCloseBusy] = useState(false);
  /** ปิดเรื่องเอกสาร: ติ๊ก + เลขที่ใบกำกับ / ใบเสร็จ */
  const [docCloseTiChecked, setDocCloseTiChecked] = useState(false);
  const [docCloseRcChecked, setDocCloseRcChecked] = useState(false);
  const [docCloseTiNo, setDocCloseTiNo] = useState('');
  const [docCloseRcNo, setDocCloseRcNo] = useState('');
  /** แบ่งงวดเฉพาะส่วนที่ยัง PENDING — แผนกบัญชีแก้ได้แม้สโตร์ส่งมาเป็นงวดเดียว */
  const [accountingInstallmentDraft, setAccountingInstallmentDraft] = useState<VendorBillPaymentInstallment[]>([]);
  const [accountingPlanSaving, setAccountingPlanSaving] = useState(false);
  const [accountingVatDialogOpen, setAccountingVatDialogOpen] = useState(false);
  const [accountingVatDraft, setAccountingVatDraft] = useState<AccountingVatDraft>('AUTO');
  const [accountingVatSaving, setAccountingVatSaving] = useState(false);
  const [accountingWhtDialogOpen, setAccountingWhtDialogOpen] = useState(false);
  const [accountingWhtDraftMode, setAccountingWhtDraftMode] = useState<AccountingWhtDraftMode>('inherit');
  const [accountingWhtDraftPreset, setAccountingWhtDraftPreset] = useState<VendorBillWhtPresetCategory>('SERVICE');
  const [accountingWhtSaving, setAccountingWhtSaving] = useState(false);

  useEffect(() => {
    if (!bill) return;
    setBillingDate(bill.billingReceivedDate || '');
    setPayDate(bill.plannedPaymentDate || '');
    setNotes(bill.notes || '');
    setVatMode(bill.billVatTreatment ?? 'AUTO');
    setSupportingDelivery(supportingFromBill(bill.supportingDeliveryNote));
    setSupportingTaxInv(supportingFromBill(bill.supportingTaxInvoice));
    setSupportingReceipt(supportingFromBill(bill.supportingMoneyReceipt));
    if (bill.status === 'DRAFT' && purchase) {
      if (bill.paymentInstallments?.length) {
        setInstallmentsDraft(bill.paymentInstallments);
      } else {
        setInstallmentsDraft(singleFullInstallment(vendorBillTotalInclVat(bill, purchase)));
      }
    }
    if (bill.status === 'SUBMITTED' || bill.status === 'PARTIALLY_PAID') {
      setPayoutEntryDate((d) => d || timestampToHtmlDateValue(Date.now()));
      const pending = (bill.paymentInstallments ?? []).filter((i) => i.payStatus === 'PENDING');
      setInstallmentPayTargetId((prev) =>
        prev && pending.some((p) => p.id === prev) ? prev : pending[0]?.id ?? '',
      );
      if (purchase) {
        const pendingRows = (bill.paymentInstallments ?? []).filter((i) => i.payStatus === 'PENDING');
        const remaining = vendorBillRemainingForPendingInstallments(bill, purchase);
        if (pendingRows.length > 0) {
          setAccountingInstallmentDraft(pendingRows);
        } else if (remaining > 0.005) {
          setAccountingInstallmentDraft(singleFullInstallment(remaining));
        } else {
          setAccountingInstallmentDraft([]);
        }
      }
    }
  }, [bill?.id, bill?.status, bill?.updatedAt, purchase?.id]);

  useEffect(() => {
    if (!bill || bill.status === 'DRAFT') return;
    setDocCloseTiChecked(!!bill.supportingTaxInvoice?.attached);
    setDocCloseRcChecked(!!bill.supportingMoneyReceipt?.attached);
    setDocCloseTiNo((bill.supportingTaxInvoice?.documentNo || '').trim());
    setDocCloseRcNo((bill.supportingMoneyReceipt?.documentNo || '').trim());
  }, [
    bill?.id,
    bill?.status,
    bill?.supportingTaxInvoice?.attached,
    bill?.supportingMoneyReceipt?.attached,
    bill?.supportingTaxInvoice?.documentNo,
    bill?.supportingMoneyReceipt?.documentNo,
  ]);

  const grossForPayment = useMemo(() => {
    if (!purchase || !bill) return 0;
    return Number(bill.billAmount ?? purchase.totalAmount) || 0;
  }, [bill, purchase]);

  /** ยอดงวดรวม VAT สำหรับคำนวณหัก (ให้ตรงกับ milestone ถ้ามี) */
  const grossInclVatForBill = useMemo(() => {
    if (!purchase || !bill) return 0;
    if (linkedMilestone != null) return Number(linkedMilestone.amount) || 0;
    return Number(bill.billAmount ?? purchase.totalAmount) || 0;
  }, [purchase, bill, linkedMilestone]);

  /** null = ตามสัดส่วน PO (AUTO / ไม่มี billVatTreatment) */
  const effectiveVatTreatmentForSlice = useMemo((): VendorBillVatTreatmentOverride | null => {
    if (!bill || !purchase) return null;
    if (bill.status === 'DRAFT') {
      return vatMode === 'AUTO' ? null : vatMode;
    }
    return bill.billVatTreatment ?? null;
  }, [bill, purchase, vatMode]);

  const whtEnabledEffective = useMemo(
    () => !!(bill && purchase && effectiveVendorBillWithholdingEnabled(bill, purchase)),
    [bill, purchase],
  );

  const effectiveWhtRatePercent = useMemo(
    () => (bill && purchase ? effectiveVendorBillWhtRatePercent(bill, purchase) : 0),
    [bill, purchase],
  );
  const poWhtRatePercent = useMemo(() => Number(purchase?.supplierWithholdingRatePercent) || 0, [purchase]);
  const hasVendorBillWhtPreset = !!bill?.vendorBillWhtPresetCategory;
  const hasManualBillWhtRate =
    bill?.supplierWithholdingRatePercentBill != null &&
    Number.isFinite(Number(bill.supplierWithholdingRatePercentBill));
  /** แก้ % มือบนบิล โดยไม่ได้เลือกเมนูประเภท (preset จะซิงค์ % ลงบิลด้วย — แยกด้วยฟิลด์ preset) */
  const hasManualWhtOnly = hasManualBillWhtRate && !hasVendorBillWhtPreset;
  const hasManualWhtTaxBase = useMemo(
    () =>
      bill?.supplierWithholdingTaxBaseBill != null &&
      Number.isFinite(Number(bill.supplierWithholdingTaxBaseBill)),
    [bill?.supplierWithholdingTaxBaseBill],
  );

  const vendorPayeeBankDisplay = useMemo(() => {
    if (!vendor) return null;
    const bankName = vendor.bankName?.trim();
    const acctName = vendor.bankAccountName?.trim();
    const acctNo = vendor.bankAccountNumber?.trim();
    if (!bankName && !acctName && !acctNo) return null;
    return { bankName, acctName, acctNo };
  }, [vendor]);

  /** ฐานหัก ณ ที่จ่าย — อัตราใช้ override บนใบวางบิล (บัญชีแก้) ถ้ามี ไม่เช่นนั้นใช้จาก PO */
  const withholdingPreview = useMemo(() => {
    if (!purchase || !bill || !whtEnabledEffective) return null;
    const rate = effectiveVendorBillWhtRatePercent(bill, purchase);
    if (rate < 0.005) return null;
    const grossInclVat =
      linkedMilestone != null
        ? Number(linkedMilestone.amount) || 0
        : Number(bill.billAmount ?? purchase.totalAmount) || 0;
    if (grossInclVat < 0.01) return null;
    return supplierWithholdingOnVendorBill(grossInclVat, rate, purchase, effectiveVatTreatmentForSlice, bill);
  }, [purchase, linkedMilestone, bill, whtEnabledEffective, effectiveVatTreatmentForSlice]);

  const canPrintWithholdingSummary = !!withholdingPreview && withholdingPreview.wht > 0.005;

  const billHasInstallmentPlan = useMemo(
    () => !!(bill && billUsesPaymentInstallmentPlan(bill)),
    [bill],
  );

  const payoutGrossInclVat = useMemo(() => {
    if (!bill || !purchase) return grossInclVatForBill;
    if (!billHasInstallmentPlan || !installmentPayTargetId) return grossInclVatForBill;
    const row = bill.paymentInstallments!.find((i) => i.id === installmentPayTargetId);
    if (!row || row.payStatus !== 'PENDING') return grossInclVatForBill;
    return roundMoney2(Number(row.amountInclVat) || 0);
  }, [bill, purchase, billHasInstallmentPlan, installmentPayTargetId, grossInclVatForBill]);

  const withholdingAtPayout = useMemo(() => {
    if (!purchase || !bill || !whtEnabledEffective) return null;
    const rate = effectiveVendorBillWhtRatePercent(bill, purchase);
    if (rate < 0.005) return null;
    if (payoutGrossInclVat < 0.01) return null;
    return supplierWithholdingOnVendorBill(payoutGrossInclVat, rate, purchase, effectiveVatTreatmentForSlice, bill);
  }, [purchase, bill, payoutGrossInclVat, whtEnabledEffective, effectiveVatTreatmentForSlice]);

  const canPrintWithholdingAtPayout = !!withholdingAtPayout && withholdingAtPayout.wht > 0.005;

  /** เอกสารหัก ฯ สำหรับพิมพ์/พรีวิว — ใช้ของจริงจาก Firestore หรือประกอบจาก cashbook ถ้ายังไม่มีเลขเอกสาร */
  const effectiveWhtPrintDoc = useMemo((): WithholdingCertificateDocument | null => {
    if (
      !purchase ||
      !bill ||
      !vendor ||
      !currentUser ||
      !canPrintWithholdingSummary ||
      !withholdingPreview
    ) {
      return null;
    }
    if (whtCertificate) return whtCertificate;
    if (bill.status !== 'PAID' || !payoutCashbook) return null;
    const draftCore = buildWithholdingCertificateDraft({
      bill,
      purchase,
      vendor,
      company: companyProfile ?? undefined,
      milestone: linkedMilestone ?? undefined,
      cashbook: payoutCashbook,
      bank: payoutBankAccount ?? undefined,
      paymentDateYmd: payoutCashbook.entryDate,
      paymentIssueDateYmd: payoutCashbook.entryDate,
      paymentMethod: payoutCashbook.paymentMethod,
      sourceWithholdingAtSourceItemId: whtAtSourceItem?.id,
    });
    return {
      id: '_synthetic_preview',
      ...draftCore,
      createdByUid: currentUser.id,
    };
  }, [
    purchase,
    bill,
    vendor,
    currentUser,
    canPrintWithholdingSummary,
    withholdingPreview,
    whtCertificate,
    payoutCashbook,
    payoutBankAccount,
    linkedMilestone,
    companyProfile,
    whtAtSourceItem?.id,
  ]);

  /** ตรงกับ executeVendorBillPayment: ตัดธนาคารเฉพาะสุทธิจ่ายคู่ค้า — หัก ณ ที่จ่ายไม่ผ่านบัญชี */
  const bankDebitAmount = useMemo(() => {
    const awaiting = bill?.status === 'SUBMITTED' || bill?.status === 'PARTIALLY_PAID';
    const wht = awaiting ? withholdingAtPayout : withholdingPreview;
    const gross = awaiting ? payoutGrossInclVat : grossInclVatForBill;
    if (wht && wht.wht > 0.005) return wht.netPaid;
    return gross || grossForPayment;
  }, [
    bill?.status,
    withholdingPreview,
    withholdingAtPayout,
    payoutGrossInclVat,
    grossInclVatForBill,
    grossForPayment,
  ]);

  const billFinancialSlice = useMemo(() => {
    if (!purchase || !bill) return null;
    const gross = grossInclVatForBill;
    const { beforeTax, vat } = resolveVendorBillVatAmounts(gross, effectiveVatTreatmentForSlice, purchase);
    const poTotal = Number(purchase.totalAmount) || 0;
    const ratio = poTotal > 0.0001 ? Math.min(1, gross / poTotal) : 1;
    return { gross, beforeTax, vat, ratio };
  }, [purchase, bill, grossInclVatForBill, effectiveVatTreatmentForSlice]);

  const displayedVatTreatment = useMemo((): VendorBillVatTreatmentOverride => {
    if (!purchase) return 'NONE';
    const inferred: VendorBillVatTreatmentOverride =
      (Number(purchase.vatAmount) || 0) > 0.005 ? 'VAT_7' : 'NONE';
    if (bill?.status === 'DRAFT') return vatMode === 'AUTO' ? inferred : vatMode;
    return bill?.billVatTreatment ?? inferred;
  }, [purchase, bill?.status, bill?.billVatTreatment, vatMode]);

  const mergeWhtCertDisplaySettings = (c: CompanyProfileWhtInput | null | undefined) => {
    const d = c?.whtCertificateDisplay;
    return {
      showSignatureImage: !!d?.showSignatureImage,
      showCompanyStamp: !!d?.showCompanyStamp,
      showSystemGeneratedNote: d?.showSystemGeneratedNote !== false,
    };
  };

  /** พิมพ์ตัวอย่างหนังสือรับรองก่อนบันทึกจ่าย — ใช้วันที่/ธนาคารจากฟอร์มด้านบน (ไม่เผาเลขที่จริง) */
  const handleSubmittedPreviewWhtCertificate = async () => {
    if (!bill) return;
    const whtPrev =
      bill.status === 'SUBMITTED' || bill.status === 'PARTIALLY_PAID' ? withholdingAtPayout : withholdingPreview;
    const grossPrev =
      bill.status === 'SUBMITTED' || bill.status === 'PARTIALLY_PAID' ? payoutGrossInclVat : grossInclVatForBill;
    if (!currentUser || !purchase || !vendor || !whtPrev || !(whtPrev.wht > 0.005)) {
      return;
    }
    if (!canPreviewVendorBillWht) return;
    const entryYmd = payoutEntryDate.trim();
    if (!entryYmd) {
      toast({ variant: 'destructive', title: 'ระบุวันที่ทำรายการ', description: 'ต้องมีวันที่จ่าย (cashbook) เพื่อแสดงบนหนังสือรับรอง' });
      return;
    }
    const payoutBank = (bankAccounts || []).find((b) => b.id === payoutBankId);
    const pseudoCashbook: CashbookEntry = {
      id: '_preview_before_pay',
      entryNo: payoutBank ? `(รอยืนยันจ่าย — ${payoutBank.bankName})` : '(รอยืนยันจ่าย)',
      bankAccountId: payoutBankId || '_pending',
      entryDate: entryYmd,
      direction: 'OUT',
      entryType: 'SUPPLIER_PAYMENT',
      amount: bankDebitAmount,
      description: 'รอยืนยันจ่ายเงิน — ตัวอย่างก่อนลง cashbook',
      paymentMethod: payoutMethod,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      grossPaymentAmount: grossPrev,
      ...(whtPrev.wht > 0.005 ? { supplierWithholdingAmount: whtPrev.wht } : {}),
    };
    setSubmittedWhtBusy(true);
    try {
      const actor = currentUser.displayName?.trim() || currentUser.email || currentUser.id;
      const draftCore = buildWithholdingCertificateDraft({
        bill,
        purchase,
        vendor,
        company: companyProfile ?? undefined,
        milestone: linkedMilestone ?? undefined,
        cashbook: pseudoCashbook,
        bank: payoutBank,
        paymentDateYmd: entryYmd,
        paymentIssueDateYmd: entryYmd,
        paymentMethod: payoutMethod,
      });
      const previewDoc: WithholdingCertificateDocument = {
        id: '_preview_before_pay',
        ...draftCore,
        createdByUid: currentUser.id,
      };
      const pvErrs = [
        ...validateWhtCertificateForPreviewPrint(previewDoc, 'COPY_PAYEE_TAX_RETURN'),
        ...validateWhtCertificateForOfficialIssue(previewDoc, { requireCashbookReference: false }),
      ];
      if (pvErrs.length) {
        toast({ variant: 'destructive', title: 'พิมพ์ตัวอย่างไม่ได้', description: pvErrs.join(' ') });
        return;
      }
      const html = buildWithholdingCertificateDocumentHtml(previewDoc, {
        copyVariant: 'COPY_PAYEE_TAX_RETURN',
        official: false,
        hideDraftChrome: true,
        printedByName: actor,
        printedAtMs: Date.now(),
        ...mergeWhtCertDisplaySettings(companyProfile),
      });
      openWithholdingCertificatePrintWindow(html);
    } finally {
      setSubmittedWhtBusy(false);
    }
  };

  const isPersistedWhtCertDoc = (doc: WithholdingCertificateDocument | null) =>
    !!doc?.id &&
    !doc.id.startsWith('_') &&
    !!bill?.whtCertificateDocumentId &&
    doc.id === bill.whtCertificateDocumentId;

  const runWhtCertificatePrint = async (
    whtDoc: WithholdingCertificateDocument,
    variant: WithholdingCertificateCopyVariant,
    official: boolean,
    hideDraftChrome = false,
  ) => {
    if (!currentUser) return;
    setWhtPrintBusy(true);
    try {
      const actor =
        currentUser.displayName?.trim() || currentUser.email || currentUser.id;
      const errs = official
        ? validateWhtCertificateForOfficialPrint(whtDoc, variant)
        : validateWhtCertificateForPreviewPrint(whtDoc, variant);
      if (errs.length) {
        toast({ variant: 'destructive', title: 'พิมพ์ไม่ได้', description: errs.join(' ') });
        return;
      }
      const html = buildWithholdingCertificateDocumentHtml(whtDoc, {
        copyVariant: variant,
        official,
        hideDraftChrome,
        printedByName: actor,
        printedAtMs: Date.now(),
        ...mergeWhtCertDisplaySettings(companyProfile),
      });
      openWithholdingCertificatePrintWindow(html);
      if (official && isPersistedWhtCertDoc(whtDoc) && firestore && whtCertRef) {
        try {
          await updateDocumentNonBlocking(whtCertRef, {
            lastPrintedCopyVariant: variant,
            updatedAt: Date.now(),
            updatedByUid: currentUser.id,
            updatedByName: actor,
          });
          const logRef = doc(
            collection(firestore, 'withholding_certificate_documents', whtDoc.id, 'audit_logs'),
          );
          await setDoc(logRef, {
            id: logRef.id,
            ...buildWhtAuditLogEntry({
              documentId: whtDoc.id,
              action: 'PRINT_WHT',
              actorId: currentUser.id,
              actorName: actor,
              payloadSummary: { copyVariant: variant, official: true },
            }),
          });
        } catch (e) {
          console.error(e);
        }
      }
    } finally {
      setWhtPrintBusy(false);
    }
  };

  /** ฉบับที่ 1 + 2 ในไฟล์เดียว (ให้ลูกค้า / PDF) */
  const runWhtCertificatePayeeCopies12Print = async (
    whtDoc: WithholdingCertificateDocument,
    official: boolean,
    hideDraftChrome = false,
  ) => {
    if (!currentUser) return;
    setWhtPrintBusy(true);
    try {
      const actor = currentUser.displayName?.trim() || currentUser.email || currentUser.id;
      const errs = validateWhtCertificateForPayeeCopies12Print(whtDoc, official);
      if (errs.length) {
        toast({ variant: 'destructive', title: 'พิมพ์ไม่ได้', description: errs.join(' ') });
        return;
      }
      const html = buildWithholdingCertificatePayeeCopies12Html(whtDoc, {
        official,
        hideDraftChrome,
        printedByName: actor,
        printedAtMs: Date.now(),
        ...mergeWhtCertDisplaySettings(companyProfile),
      });
      openWithholdingCertificatePrintWindow(html);
      if (official && isPersistedWhtCertDoc(whtDoc) && firestore && whtCertRef) {
        try {
          await updateDocumentNonBlocking(whtCertRef, {
            lastPrintedCopyVariant: 'COPY_PAYEE_TAX_RETURN',
            updatedAt: Date.now(),
            updatedByUid: currentUser.id,
            updatedByName: actor,
          });
          const logRef = doc(
            collection(firestore, 'withholding_certificate_documents', whtDoc.id, 'audit_logs'),
          );
          await setDoc(logRef, {
            id: logRef.id,
            ...buildWhtAuditLogEntry({
              documentId: whtDoc.id,
              action: 'PRINT_WHT',
              actorId: currentUser.id,
              actorName: actor,
              payloadSummary: { payeeCopies12Bundle: true, official: true },
            }),
          });
        } catch (e) {
          console.error(e);
        }
      }
    } finally {
      setWhtPrintBusy(false);
    }
  };

  const whtHubOfficialPrint = useMemo(() => {
    if (!effectiveWhtPrintDoc) return false;
    return (
      effectiveWhtPrintDoc.documentStatus === 'ISSUED' &&
      !!effectiveWhtCertificateDocumentNo(effectiveWhtPrintDoc)
    );
  }, [effectiveWhtPrintDoc]);

  const whtHubPreviewHtml = useMemo(() => {
    if (!whtHubOpen || !effectiveWhtPrintDoc || !currentUser) return '';
    const actor = currentUser.displayName?.trim() || currentUser.email || currentUser.id;
    const errs = whtHubOfficialPrint
      ? validateWhtCertificateForOfficialPrint(effectiveWhtPrintDoc, 'COPY_PAYEE_TAX_RETURN')
      : validateWhtCertificateForPreviewPrint(effectiveWhtPrintDoc, 'COPY_PAYEE_TAX_RETURN');
    if (errs.length) return '';
    return buildWithholdingCertificateDocumentHtml(effectiveWhtPrintDoc, {
      copyVariant: 'COPY_PAYEE_TAX_RETURN',
      official: whtHubOfficialPrint,
      hideDraftChrome: true,
      printedByName: actor,
      printedAtMs: Date.now(),
      ...mergeWhtCertDisplaySettings(companyProfile),
    });
  }, [whtHubOpen, effectiveWhtPrintDoc, currentUser, companyProfile, whtHubOfficialPrint]);

  const whtHubIframeKey = useMemo(() => {
    const d = whtCertificate ?? effectiveWhtPrintDoc;
    if (!d?.id) return 'wht-preview';
    return `${d.id}-${effectiveWhtCertificateDocumentNo(d)}-${d.updatedAt ?? 0}`;
  }, [whtCertificate, effectiveWhtPrintDoc]);

  const showWhtAssignNumberPanel =
    !!bill?.whtCertificateDocumentId &&
    !!whtCertificate &&
    !effectiveWhtCertificateDocumentNo(whtCertificate) &&
    whtCertificate.documentStatus !== 'CANCELLED' &&
    canAssignWhtCertificateNo;

  const openWhtPreviewHub = () => {
    if (!effectiveWhtPrintDoc) {
      toast({
        variant: 'destructive',
        title: 'ไม่มีข้อมูลหัก ณ ที่จ่าย',
        description: 'ใบนี้ไม่เข้าเงื่อนไขพิมพ์หนังสือรับรอง',
      });
      return;
    }
    const officialReady =
      effectiveWhtPrintDoc.documentStatus === 'ISSUED' &&
      !!effectiveWhtCertificateDocumentNo(effectiveWhtPrintDoc);
    const errs = officialReady
      ? validateWhtCertificateForOfficialPrint(effectiveWhtPrintDoc, 'COPY_PAYEE_TAX_RETURN')
      : validateWhtCertificateForPreviewPrint(effectiveWhtPrintDoc, 'COPY_PAYEE_TAX_RETURN');
    if (errs.length) {
      toast({ variant: 'destructive', title: 'เปิดพรีวิวไม่ได้', description: errs.join(' ') });
      return;
    }
    setWhtHubOpen(true);
  };

  const openWhtPreviewInNewTab = () => {
    if (!whtHubPreviewHtml.trim()) {
      toast({ variant: 'destructive', title: 'ยังไม่มีตัวอย่างให้เปิด' });
      return;
    }
    openWithholdingCertificatePreviewTab(whtHubPreviewHtml);
  };

  const handleAssignWhtCertificateNumber = async () => {
    if (!firestore || !whtCertRef || !currentUser || !whtCertificate || !bill?.whtCertificateDocumentId) {
      toast({
        variant: 'destructive',
        title: 'ดำเนินการไม่ได้',
        description: 'ไม่พบเอกสารหัก ณ ที่จ่ายที่บันทึกไว้ในระบบ — ถ้ายังไม่จ่ายหรือจ่ายไม่สำเร็จให้บันทึกจ่ายใหม่',
      });
      return;
    }
    setWhtAssignNoBusy(true);
    try {
      const { certificateNo } = await assignWhtCertificateNumberIfMissing({
        firestore,
        certRef: whtCertRef,
        wht: whtCertificate,
        currentUser,
      });
      toast({ title: 'ออกเลขที่แล้ว', description: `เลขที่ ${certificateNo} — พรีวิวจะอัปเดตอัตโนมัติ` });
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'ออกเลขที่ไม่ได้',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setWhtAssignNoBusy(false);
    }
  };

  const buildVendorBillDetailPayload = (): Record<string, unknown> => {
    if (!bill) return {};
    const prNo = bill.purchaseRequestNo?.trim() || purchaseRequest?.requestNo?.trim();
    const base: Record<string, unknown> = {
      billingReceivedDate: billingDate,
      plannedPaymentDate: payDate,
      notes,
      ...(prNo ? { purchaseRequestNo: prNo } : {}),
      ...(vatMode === 'AUTO'
        ? { billVatTreatment: deleteField() }
        : { billVatTreatment: vatMode }),
      supportingDeliveryNote: supportingToFirestore(supportingDelivery),
      supportingTaxInvoice: supportingToFirestore(supportingTaxInv),
      supportingMoneyReceipt: supportingToFirestore(supportingReceipt),
      updatedAt: Date.now(),
    };
    if (bill.status === 'DRAFT' && purchase) {
      base.paymentInstallments = stripUndefinedForFirestore(installmentsDraft);
    }
    return base;
  };

  const saveDraft = async () => {
    if (!billRef || !bill || bill.status !== 'DRAFT') return;
    await updateDocumentNonBlocking(billRef, buildVendorBillDetailPayload());
    toast({ title: 'บันทึกฉบับร่างแล้ว' });
  };

  const saveAccountingInstallmentPlan = async () => {
    if (!billRef || !bill || !purchase || !canPay) return;
    if (bill.status !== 'SUBMITTED' && bill.status !== 'PARTIALLY_PAID') return;
    const remaining = vendorBillRemainingForPendingInstallments(bill, purchase);
    const pendingErr = validateInstallmentsAgainstTotal(accountingInstallmentDraft, remaining);
    if (pendingErr) {
      toast({
        variant: 'destructive',
        title: 'แผนงวดไม่ตรงยอดคงค้าง',
        description: pendingErr,
      });
      return;
    }
    const merged = mergePaidInstallmentsWithPendingDraft(bill, accountingInstallmentDraft);
    const fullErr = validateInstallmentsAgainstTotal(merged, vendorBillTotalInclVat(bill, purchase));
    if (fullErr) {
      toast({ variant: 'destructive', title: 'ผลรวมทั้งใบไม่ตรง', description: fullErr });
      return;
    }
    setAccountingPlanSaving(true);
    try {
      await updateDocumentNonBlocking(
        billRef,
        stripUndefinedForFirestore({
          paymentInstallments: merged,
          updatedAt: Date.now(),
        }),
      );
      toast({
        title: 'บันทึกแผนงวดแล้ว',
        description:
          'จ่ายและหัก ณ ที่จ่าย (ถ้ามี) จะคำนวณทีละงวด — แต่ละครั้งที่บันทึกจ่ายจะสร้างเอกสารหักฯ แยกตามยอดงวดนั้น',
      });
    } finally {
      setAccountingPlanSaving(false);
    }
  };

  const openAccountingVatDialog = () => {
    if (!bill) return;
    setAccountingVatDraft(bill.billVatTreatment ?? 'AUTO');
    setAccountingVatDialogOpen(true);
  };

  const saveAccountingVatOverride = async () => {
    if (!billRef || !canPay || !bill) return;
    if (bill.status !== 'SUBMITTED' && bill.status !== 'PARTIALLY_PAID') return;
    setAccountingVatSaving(true);
    try {
      await updateDocumentNonBlocking(billRef, {
        ...(accountingVatDraft === 'AUTO'
          ? { billVatTreatment: deleteField() }
          : { billVatTreatment: accountingVatDraft }),
        updatedAt: Date.now(),
      });
      toast({ title: 'บันทึกการตั้งค่าภาษีมูลค่าเพิ่มแล้ว' });
      setAccountingVatDialogOpen(false);
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'บันทึกไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setAccountingVatSaving(false);
    }
  };

  const openAccountingWhtDialog = () => {
    if (!bill || !purchase) return;
    if (bill.supplierWithholdingEnabledBill === true) setAccountingWhtDraftMode('on');
    else if (bill.supplierWithholdingEnabledBill === false) setAccountingWhtDraftMode('off');
    else setAccountingWhtDraftMode('inherit');
    const r = effectiveVendorBillWhtRatePercent(bill, purchase);
    setAccountingWhtDraftPreset(
      bill.vendorBillWhtPresetCategory ?? inferWhtPresetFromEffectiveRate(r),
    );
    setAccountingWhtDialogOpen(true);
  };

  const saveAccountingWhtOverride = async () => {
    if (!billRef || !canPay || !bill) return;
    if (bill.status !== 'SUBMITTED' && bill.status !== 'PARTIALLY_PAID') return;
    setAccountingWhtSaving(true);
    try {
      const patch: Record<string, unknown> = { updatedAt: Date.now() };
      if (accountingWhtDraftMode === 'inherit') {
        patch.supplierWithholdingEnabledBill = deleteField();
        patch.vendorBillWhtPresetCategory = deleteField();
        patch.supplierWithholdingRatePercentBill = deleteField();
        patch.supplierWithholdingTaxBaseBill = deleteField();
      } else if (accountingWhtDraftMode === 'off') {
        patch.supplierWithholdingEnabledBill = false;
        patch.vendorBillWhtPresetCategory = deleteField();
        patch.supplierWithholdingRatePercentBill = deleteField();
        patch.supplierWithholdingTaxBaseBill = deleteField();
      } else {
        patch.supplierWithholdingEnabledBill = true;
        patch.vendorBillWhtPresetCategory = accountingWhtDraftPreset;
        patch.supplierWithholdingRatePercentBill = vendorBillWhtPresetRatePercent(accountingWhtDraftPreset);
      }
      await updateDocumentNonBlocking(billRef, patch);
      toast({ title: 'บันทึกการตั้งค่าหัก ณ ที่จ่ายแล้ว' });
      setAccountingWhtDialogOpen(false);
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'บันทึกไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setAccountingWhtSaving(false);
    }
  };

  const submitToAccounting = async () => {
    if (!firestore || !billRef || !bill || !purchase || bill.status !== 'DRAFT') {
      toast({ variant: 'destructive', title: 'ส่งไม่ได้', description: 'ต้องเป็นฉบับร่างและมีใบสั่งซื้อ' });
      return;
    }
    if (!purchase.purchaseRequestId) {
      toast({
        variant: 'destructive',
        title: 'PO นี้ไม่อ้าง PR',
        description: 'รับวางบิลได้เฉพาะใบสั่งซื้อที่อ้างอิง PR ที่อนุมัติแล้ว',
      });
      return;
    }
    const rowErrs = [
      validateSupportingRow('ใบส่งของ', supportingDelivery),
      validateSupportingRow('ใบกำกับภาษี', supportingTaxInv),
      validateSupportingRow('ใบเสร็จรับเงิน (คู่ค้า)', supportingReceipt),
    ].filter(Boolean) as string[];
    if (rowErrs.length) {
      toast({
        variant: 'destructive',
        title: 'ข้อมูลเอกสารประกอบไม่ครบ',
        description: rowErrs.join(' '),
      });
      setSubmitConfirmOpen(false);
      return;
    }
    const totalIncl = vendorBillTotalInclVat(bill, purchase);
    const plan =
      installmentsDraft.length > 0 ? installmentsDraft : singleFullInstallment(totalIncl);
    const planErr = validateInstallmentsAgainstTotal(plan, totalIncl);
    if (planErr) {
      toast({ variant: 'destructive', title: 'แผนงวดจ่ายไม่ตรงยอด', description: planErr });
      setSubmitConfirmOpen(false);
      return;
    }
    const now = Date.now();
    await updateDocumentNonBlocking(billRef, {
      ...buildVendorBillDetailPayload(),
      paymentInstallments: stripUndefinedForFirestore(
        plan.map((row) => ({ ...row, payStatus: 'PENDING' as const })),
      ),
      purchaseType: purchase.purchaseType,
      status: 'SUBMITTED' as PurchaseVendorBillStatus,
      submittedToAccountingAt: now,
    });
    const apAmount = bill.billAmount ?? purchase.totalAmount;
    await setDoc(
      doc(firestore, 'accounts_payable', bill.id),
      {
        id: bill.id,
        vendorId: bill.vendorId,
        documentNo: bill.receiptNo,
        referenceId: bill.purchaseId,
        billDate: billingDate,
        dueDate: payDate,
        debitAmount: apAmount,
        creditAmount: 0,
        outstandingAmount: apAmount,
        status: 'OPEN',
        origin: 'STORE_VENDOR_BILL',
        createdAt: now,
        updatedAt: now,
      },
      { merge: true }
    );
    setSubmitConfirmOpen(false);
      toast({
        title: 'ส่งแผนกบัญชีแล้ว',
        description: 'รายการอยู่ในเจ้าหนี้การค้า (เครดิต) — บัญชีตรวจและบันทึกจ่ายได้จากใบรับวางบิลนี้',
      });
  };

  const saveBillWhtRateOverride = async () => {
    if (!billRef || !bill || (bill.status !== 'SUBMITTED' && bill.status !== 'PARTIALLY_PAID') || !canPay) return;
    const n = parseFloat(String(whtRateInput).trim().replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      toast({
        variant: 'destructive',
        title: 'อัตราไม่ถูกต้อง',
        description: 'ระบุตัวเลข 0–100 (เช่น 3 สำหรับ 3%)',
      });
      return;
    }
    setWhtRateSaving(true);
    try {
      await updateDocumentNonBlocking(billRef, {
        supplierWithholdingRatePercentBill: n,
        vendorBillWhtPresetCategory: deleteField(),
        updatedAt: Date.now(),
      });
      toast({
        title: 'บันทึกอัตราหัก ณ ที่จ่ายแล้ว',
        description: `ใช้ ${n}% สำหรับใบ ${bill.receiptNo} เมื่อบันทึกจ่ายและหลักฐานหัก`,
      });
      setWhtRateEditOpen(false);
    } finally {
      setWhtRateSaving(false);
    }
  };

  const clearBillWhtRateOverride = async () => {
    if (!billRef || !bill || (bill.status !== 'SUBMITTED' && bill.status !== 'PARTIALLY_PAID') || !canPay) return;
    setWhtRateSaving(true);
    try {
      await updateDocumentNonBlocking(billRef, {
        supplierWithholdingRatePercentBill: deleteField(),
        vendorBillWhtPresetCategory: deleteField(),
        updatedAt: Date.now(),
      });
      toast({
        title: 'คืนค่าตาม PO',
        description: `ใช้อัตรา ${poWhtRatePercent}% จากใบสั่งซื้อ`,
      });
      setWhtRateEditOpen(false);
    } finally {
      setWhtRateSaving(false);
    }
  };

  const saveWhtPresetChoice = async () => {
    if (!billRef || !bill || (bill.status !== 'SUBMITTED' && bill.status !== 'PARTIALLY_PAID') || !canPay) return;
    const rate = vendorBillWhtPresetRatePercent(whtPresetChoice);
    const label = WHT_PRESET_OPTIONS.find((o) => o.id === whtPresetChoice)?.title ?? '';
    setWhtPresetSaving(true);
    try {
      await updateDocumentNonBlocking(
        billRef,
        stripUndefinedForFirestore({
          vendorBillWhtPresetCategory: whtPresetChoice,
          supplierWithholdingRatePercentBill: rate,
          updatedAt: Date.now(),
        }),
      );
      toast({
        title: 'บันทึกประเภทหัก ณ ที่จ่ายแล้ว',
        description: `${label} ${rate}% — ยอดตัดธนาคาร (โอนสุทธิ) คำนวณใหม่ก่อนยืนยันจ่าย`,
      });
      setWhtPresetDialogOpen(false);
    } finally {
      setWhtPresetSaving(false);
    }
  };

  const clearWhtPresetDialogToPo = async () => {
    if (!billRef || !bill || (bill.status !== 'SUBMITTED' && bill.status !== 'PARTIALLY_PAID') || !canPay) return;
    setWhtPresetSaving(true);
    try {
      await updateDocumentNonBlocking(billRef, {
        supplierWithholdingRatePercentBill: deleteField(),
        vendorBillWhtPresetCategory: deleteField(),
        updatedAt: Date.now(),
      });
      toast({
        title: 'คืนค่าตาม PO',
        description: `ใช้อัตรา ${poWhtRatePercent}% จากใบสั่งซื้อ`,
      });
      setWhtPresetDialogOpen(false);
    } finally {
      setWhtPresetSaving(false);
    }
  };

  const openWhtTaxBaseDialog = () => {
    if (!bill) return;
    const o = bill.supplierWithholdingTaxBaseBill;
    setWhtTaxBaseInput(
      o != null && Number.isFinite(Number(o)) ? String(roundMoney2(Number(o))) : '',
    );
    setWhtTaxBaseDialogOpen(true);
  };

  const saveWhtTaxBaseOverride = async () => {
    if (!billRef || !bill || (bill.status !== 'SUBMITTED' && bill.status !== 'PARTIALLY_PAID') || !canPay) return;
    const t = whtTaxBaseInput.trim();
    setWhtTaxBaseSaving(true);
    try {
      if (t === '') {
        await updateDocumentNonBlocking(billRef, {
          supplierWithholdingTaxBaseBill: deleteField(),
          updatedAt: Date.now(),
        });
        toast({
          title: 'ใช้ฐานตามใบวางบิล',
          description: 'คำนวณจากยอดก่อนภาษีตามสัดส่วน / VAT ของใบ',
        });
        setWhtTaxBaseDialogOpen(false);
        return;
      }
      const n = parseFloat(t.replace(',', '.'));
      if (!Number.isFinite(n) || n < 0) {
        toast({
          variant: 'destructive',
          title: 'ยอดไม่ถูกต้อง',
          description: 'ระบุตัวเลข ≥ 0 หรือเว้นว่างเพื่อคืนค่าอัตโนมัติ',
        });
        return;
      }
      const cap = Math.max(0, roundMoney2(grossInclVatForBill));
      const capped = roundMoney2(Math.min(Math.max(0, n), cap));
      await updateDocumentNonBlocking(billRef, {
        supplierWithholdingTaxBaseBill: capped,
        updatedAt: Date.now(),
      });
      toast({
        title: 'บันทึกฐานหัก ณ ที่จ่ายแล้ว',
        description:
          cap > 0.005 && capped + 0.001 < n
            ? `ปรับให้ไม่เกินยอดรวมในใบ (ก่อนหัก ณ ที่จ่าย) ฿${cap.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
            : `ใช้ฐาน ฿${capped.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
      });
      setWhtTaxBaseDialogOpen(false);
    } finally {
      setWhtTaxBaseSaving(false);
    }
  };

  const clearWhtTaxBaseOverride = async () => {
    if (!billRef || !bill || (bill.status !== 'SUBMITTED' && bill.status !== 'PARTIALLY_PAID') || !canPay) return;
    setWhtTaxBaseSaving(true);
    try {
      await updateDocumentNonBlocking(billRef, {
        supplierWithholdingTaxBaseBill: deleteField(),
        updatedAt: Date.now(),
      });
      setWhtTaxBaseInput('');
      toast({
        title: 'ใช้ฐานตามใบวางบิล',
        description: 'คำนวณจากยอดก่อนภาษีตามสัดส่วน / VAT ของใบ',
      });
      setWhtTaxBaseDialogOpen(false);
    } finally {
      setWhtTaxBaseSaving(false);
    }
  };

  const closeVendorBillDocumentation = async () => {
    if (!billRef || !bill || !currentUser || (!okStore && !okAccounting)) return;
    if (bill.vendorBillDocumentationClosed) return;
    if (!docCloseTiChecked || !docCloseRcChecked) {
      toast({
        variant: 'destructive',
        title: 'ยังไม่ครบ',
        description: 'ต้องติ๊กยืนยันการได้รับทั้งใบกำกับภาษีและใบเสร็จรับเงิน',
      });
      return;
    }
    const tiNo = docCloseTiNo.trim();
    const rcNo = docCloseRcNo.trim();
    if (!tiNo || !rcNo) {
      toast({
        variant: 'destructive',
        title: 'ยังไม่ครบ',
        description: 'กรอกเลขที่ใบกำกับภาษีและเลขที่ใบเสร็จรับเงินให้ครบ',
      });
      return;
    }
    const fallbackDocDate =
      billingDate.trim() ||
      (bill.billingReceivedDate || '').trim() ||
      timestampToHtmlDateValue(Date.now());

    setDocCloseBusy(true);
    try {
      const actor = currentUser.displayName?.trim() || currentUser.email || currentUser.id;
      await updateDocumentNonBlocking(billRef, stripUndefinedForFirestore({
        supportingTaxInvoice: {
          attached: true,
          documentNo: tiNo,
          documentDate: (bill.supportingTaxInvoice?.documentDate || '').trim() || fallbackDocDate,
        },
        supportingMoneyReceipt: {
          attached: true,
          documentNo: rcNo,
          documentDate: (bill.supportingMoneyReceipt?.documentDate || '').trim() || fallbackDocDate,
        },
        vendorBillDocumentationClosed: true,
        vendorBillDocumentationClosedAt: Date.now(),
        vendorBillDocumentationClosedByUid: currentUser.id,
        vendorBillDocumentationClosedByName: actor,
        updatedAt: Date.now(),
      }));
      toast({
        title: 'ปิดเรื่องเอกสารสมบูรณ์แล้ว',
        description: 'บันทึกเลขที่ใบกำกับภาษีและใบเสร็จแล้ว — แยกจากสถานะการจ่ายเงิน',
      });
    } finally {
      setDocCloseBusy(false);
    }
  };

  const markPaid = async () => {
    if (
      !firestore ||
      !billRef ||
      !bill ||
      !purchase ||
      !purchaseRef ||
      (bill.status !== 'SUBMITTED' && bill.status !== 'PARTIALLY_PAID')
    ) {
      toast({ variant: 'destructive', title: 'บันทึกไม่ได้' });
      return;
    }
    if (!canPay || !currentUser) return;
    if (!payoutBankId) {
      toast({ variant: 'destructive', title: 'เลือกบัญชีธนาคาร', description: 'ใช้ตัดจ่ายและลง cashbook' });
      return;
    }
    if (!payoutEntryDate.trim()) {
      toast({ variant: 'destructive', title: 'ระบุวันที่จ่าย' });
      return;
    }
    if (!paymentProofFile) {
      toast({
        variant: 'destructive',
        title: 'แนบหลักฐานโอนเงิน',
        description: 'จำเป็นเมื่อยืนยันจ่าย — รองรับ PDF หรือรูปภาพ (JPG, PNG, WEBP, GIF)',
      });
      return;
    }
    const proofErr = validateVendorBillPaymentProof(paymentProofFile);
    if (proofErr) {
      toast({ variant: 'destructive', title: 'ไฟล์ไม่ถูกต้อง', description: proofErr });
      return;
    }
    if (billHasInstallmentPlan && !installmentPayTargetId.trim()) {
      toast({ variant: 'destructive', title: 'เลือกงวดที่จ่าย', description: 'ไม่พบงวดที่รอชำระ' });
      return;
    }
    setPaying(true);
    try {
      const proof = await uploadVendorBillPaymentProofPdf(
        firebaseApp,
        bill.id,
        currentUser.id,
        paymentProofFile,
      );
      const { cashbookEntryNo, createdWhtCertificateId } = await executeVendorBillPayment({
        firestore,
        billRef,
        bill,
        purchaseRef,
        purchase,
        vendorName: vendor?.vendorName || bill.vendorId,
        bankAccountId: payoutBankId,
        paymentMethod: payoutMethod,
        entryDate: payoutEntryDate,
        currentUser,
        paymentProofUrl: proof.downloadUrl,
        paymentProofFileName: proof.fileName,
        ...(billHasInstallmentPlan && installmentPayTargetId.trim()
          ? { installmentId: installmentPayTargetId.trim() }
          : {}),
      });
      toast({
        title: 'บันทึกจ่ายแล้ว',
        description:
          createdWhtCertificateId != null
            ? `Cashbook ${cashbookEntryNo} · หักยอดบัญชีธนาคารแล้ว · ออกหนังสือรับรองหัก ณ ที่จ่ายพร้อมเลขที่แล้ว`
            : `Cashbook ${cashbookEntryNo} · หักยอดบัญชีธนาคารแล้ว`,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      const fbCode =
        e !== null && typeof e === 'object' && 'code' in e ? String((e as { code?: string }).code) : '';
      if (msg === 'ALREADY_RECORDED') {
        toast({ variant: 'destructive', title: 'รายการนี้ลง cashbook แล้ว' });
      } else {
        console.error(e);
        const permissionHint =
          fbCode === 'permission-denied'
            ? 'Firestore ปฏิเสธสิทธิ์ — ผู้ใช้ต้องเป็นผู้ดูแลระบบหรือแผนกบัญชี และฟิลด์ role/accessGroup ในเอกสาร users ต้องสอดคล้องกฎความปลอดภัย (ลองอัปเดตโปรไฟล์เป็น system_admin หรือ deploy rules ล่าสุด)'
            : msg || 'ตรวจสิทธิ์บัญชี/ธนาคารหรือลองใหม่';
        toast({ variant: 'destructive', title: 'บันทึกไม่สำเร็จ', description: permissionHint });
      }
    } finally {
      setPaying(false);
    }
  };

  if (userLoading || !currentUser) return null;
  if (!canOpen) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-3xl mx-auto py-16 text-center text-muted-foreground">ไม่มีสิทธิ์</div>
      </AppShell>
    );
  }

  if (billLoading || !bill) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  const readOnly = bill.status !== 'DRAFT' || !okStore;

  /** งวดที่ตรงกับ cashbook หลักของใบ (หลังจ่ายครบ — ใช้สำหรับหนังสือรับรองหัก ณ ที่จ่าย) */
  const isPrimaryPaidCashbookRow = (row: VendorBillPaymentInstallment) =>
    bill.status === 'PAID' &&
    !!bill.cashbookEntryId &&
    row.payStatus === 'PAID' &&
    row.cashbookEntryId === bill.cashbookEntryId;

  const effectivePurchaseType = bill.purchaseType ?? purchase?.purchaseType;
  const isCashPo = effectivePurchaseType === 'CASH';
  const awaitingVendorPayment = bill.status === 'SUBMITTED' || bill.status === 'PARTIALLY_PAID';
  const docsChecklistOk =
    !!bill.supportingTaxInvoice?.attached &&
    !!bill.supportingMoneyReceipt?.attached &&
    !!(bill.supportingTaxInvoice?.documentNo || '').trim() &&
    !!(bill.supportingMoneyReceipt?.documentNo || '').trim();

  const docCloseFormReady =
    docCloseTiChecked &&
    docCloseRcChecked &&
    !!docCloseTiNo.trim() &&
    !!docCloseRcNo.trim();

  /** คอลัมน์หัก ณ ที่จ่ายร่วมกับงวดจ่าย — เฉพาะพรีวิวและพิมพ์จากใบจ่าย */
  const renderVendorBillWhtLedgerCell = () => (
    <div className="flex flex-col gap-1.5 items-start max-w-[14rem]">
      {payoutCashbookLoading ? (
        <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin shrink-0" />
          โหลดข้อมูลจ่าย…
        </span>
      ) : null}
      {canPrintWithholdingSummary && canPreviewVendorBillWht && effectiveWhtPrintDoc ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-8 gap-1.5 px-2.5 font-semibold"
          onClick={() => openWhtPreviewHub()}
        >
          <Eye className="h-3.5 w-3.5" />
          พรีวิว / พิมพ์
        </Button>
      ) : null}
    </div>
  );

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href={vendorBillsListHref}>
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-primary">{bill.receiptNo}</h1>
            <p className="text-sm text-muted-foreground">
              ใบสั่งซื้อ {bill.purchaseNo || bill.purchaseId} · {vendor?.vendorName || '—'}
            </p>
          </div>
          <div className="ml-auto flex flex-col items-end gap-1">
            <Badge>{statusLabel(bill.status)}</Badge>
            {bill.vendorBillDocumentationClosed ? (
              <Badge variant="outline" className="border-emerald-600 text-emerald-900">
                เอกสารครบ — ปิดเรื่องแล้ว
              </Badge>
            ) : null}
          </div>
        </div>

        {bill.status === 'PAID' && !bill.vendorBillDocumentationClosed && (
          <Card className="border-amber-200 bg-amber-50/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-amber-950">ยังไม่ปิดเรื่องเอกสาร</CardTitle>
              <CardDescription className="text-amber-950/90">
                จ่ายเงินครบแล้ว แต่สถานะสมบูรณ์ทางธุรการตามนโยบายคือได้รับ{' '}
                <strong>ใบกำกับภาษี</strong> และ <strong>ใบเสร็จรับเงิน</strong> ครบและปิดเช็คลิสด้านล่าง
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {bill.status === 'PARTIALLY_PAID' && (
          <Card className="border-orange-200 bg-orange-50/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-orange-950">จ่ายบางส่วนแล้ว</CardTitle>
              <CardDescription className="text-orange-950/90">
                ยังมีงวดที่รอชำระ — ดูรายละเอียดงวดในแผนด้านล่าง เจ้าหนี้คงยอดค้างจนกว่าจะจ่ายครบทุกงวด
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {purchase &&
          bill.status !== 'DRAFT' &&
          (((bill.paymentInstallments?.length ?? 0) > 0 ||
            (bill.status === 'PAID' && !!bill.cashbookEntryId))) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">แผนงวดชำระในใบนี้</CardTitle>
                <CardDescription>
                  แต่ละงวดมีหลักฐานการจ่ายแยก — ยอดค้างในเจ้าหนี้ลดทีละงวดเมื่อบันทึกจ่าย · หลังจ่ายครบ ใช้คอลัมน์ขวาสำหรับพรีวิว/พิมพ์หนังสือรับรองหัก ณ ที่จ่าย และจัดการเอกสารในระบบบัญชี (ถ้ามี)
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">งวด</th>
                      <th className="py-2 pr-3 font-medium">ชื่อ</th>
                      <th className="py-2 pr-3 font-medium text-right">ยอด (รวม VAT)</th>
                      <th className="py-2 pr-3 font-medium">สถานะ</th>
                      <th className="py-2 pr-3 font-medium">Cashbook</th>
                      <th className="py-2 pr-3 font-medium">หลักฐานจ่าย</th>
                      <th className="py-2 font-medium min-w-[10rem]">หัก ณ ที่จ่าย</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(bill.paymentInstallments?.length ?? 0) > 0
                      ? (bill.paymentInstallments ?? []).map((row) => {
                          const primary = isPrimaryPaidCashbookRow(row);
                          return (
                            <tr key={row.id} className="border-b border-muted/60">
                              <td className="py-2 pr-3 font-mono">{row.sequence}</td>
                              <td className="py-2 pr-3">{row.label}</td>
                              <td className="py-2 pr-3 text-right font-mono font-semibold">
                                ฿
                                {Number(row.amountInclVat || 0).toLocaleString(undefined, {
                                  minimumFractionDigits: 2,
                                })}
                              </td>
                              <td className="py-2 pr-3">
                                {row.payStatus === 'PAID' ? (
                                  <Badge className="bg-green-600">จ่ายแล้ว</Badge>
                                ) : (
                                  <Badge variant="outline">รอจ่าย</Badge>
                                )}
                              </td>
                              <td className="py-2 pr-3 font-mono text-xs">
                                {row.cashbookEntryNo || row.cashbookEntryId || '—'}
                              </td>
                              <td className="py-2 pr-3">
                                {row.paymentProofUrl ? (
                                  <a
                                    href={row.paymentProofUrl}
                                    className="text-primary font-semibold underline text-xs"
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {row.paymentProofFileName || 'เปิดไฟล์'}
                                  </a>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td className="py-2 align-top">
                                {primary ? (
                                  renderVendorBillWhtLedgerCell()
                                ) : (
                                  <span className="text-muted-foreground text-xs">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      : bill.status === 'PAID' && bill.cashbookEntryId ? (
                          <tr className="border-b border-muted/60">
                            <td className="py-2 pr-3 font-mono">1</td>
                            <td className="py-2 pr-3 text-muted-foreground">ชำระเต็มจำนวน (ไม่แบ่งงวดในใบนี้)</td>
                            <td className="py-2 pr-3 text-right font-mono font-semibold">
                              ฿
                              {vendorBillTotalInclVat(bill, purchase).toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                              })}
                            </td>
                            <td className="py-2 pr-3">
                              <Badge className="bg-green-600">จ่ายแล้ว</Badge>
                            </td>
                            <td className="py-2 pr-3 font-mono text-xs">
                              {bill.cashbookEntryNo || bill.cashbookEntryId || '—'}
                            </td>
                            <td className="py-2 pr-3">
                              {bill.paymentProofUrl ? (
                                <a
                                  href={bill.paymentProofUrl}
                                  className="text-primary font-semibold underline text-xs"
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {bill.paymentProofFileName || 'เปิดไฟล์'}
                                </a>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="py-2 align-top">{renderVendorBillWhtLedgerCell()}</td>
                          </tr>
                        ) : null}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

        {awaitingVendorPayment && purchase && purchaseRef && (
          <>
            {canPay ? (
              <Card className="border-indigo-200/90 bg-indigo-50/40">
                <CardHeader>
                  <CardTitle className="text-base">แบ่งงวดชำระ (แผนกบัญชี)</CardTitle>
                  <CardDescription className="text-xs leading-relaxed">
                    แม้สโตร์ส่งมาเป็นงวดเดียว บัญชีสามารถแยกเป็นได้ถึง 5 งวดได้ที่นี่ — ผลรวมงวดที่ยังไม่จ่ายต้องเท่ายอดคงค้าง{' '}
                    <span className="font-mono font-semibold">
                      ฿
                      {vendorBillRemainingForPendingInstallments(bill, purchase).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                      })}
                    </span>
                    {bill.paymentInstallments?.some((i) => i.payStatus === 'PAID') ? (
                      <span>
                        {' '}
                        (มีงวดที่จ่ายแล้วถูกล็อก — แก้ได้เฉพาะงวดที่เหลือ)
                      </span>
                    ) : null}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {(bill.paymentInstallments ?? []).some((i) => i.payStatus === 'PAID') ? (
                    <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs space-y-1">
                      <p className="font-semibold text-muted-foreground">งวดที่จ่ายแล้ว (ไม่แก้ผ่านฟอร์มนี้)</p>
                      <ul className="list-disc pl-4 space-y-0.5">
                        {(bill.paymentInstallments ?? [])
                          .filter((i) => i.payStatus === 'PAID')
                          .sort((a, b) => a.sequence - b.sequence)
                          .map((i) => (
                            <li key={i.id}>
                              {i.label} · ฿
                              {Number(i.amountInclVat || 0).toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                              })}{' '}
                              · {i.cashbookEntryNo || i.cashbookEntryId || '—'}
                            </li>
                          ))}
                      </ul>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap items-end gap-4">
                    <div className="space-y-2 min-w-[10rem]">
                      <Label>จำนวนงวด (ส่วนที่ยังไม่จ่าย)</Label>
                      <Select
                        value={String(Math.max(1, accountingInstallmentDraft.length))}
                        onValueChange={(v) => {
                          const n = parseInt(v, 10);
                          const rem = vendorBillRemainingForPendingInstallments(bill, purchase);
                          setAccountingInstallmentDraft(buildEqualInstallmentDrafts(n, rem));
                        }}
                      >
                        <SelectTrigger className="h-11">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <SelectItem key={n} value={String(n)}>
                              {n} งวด
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {validateInstallmentsAgainstTotal(
                    accountingInstallmentDraft,
                    vendorBillRemainingForPendingInstallments(bill, purchase),
                  ) ? (
                    <p className="text-sm text-destructive">
                      {validateInstallmentsAgainstTotal(
                        accountingInstallmentDraft,
                        vendorBillRemainingForPendingInstallments(bill, purchase),
                      )}
                    </p>
                  ) : (
                    <p className="text-xs text-emerald-800">ผลรวมงวดที่แก้ตรงกับยอดคงค้าง</p>
                  )}
                  <div className="rounded-md border overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                          <th className="p-2 font-medium">#</th>
                          <th className="p-2 font-medium">ชื่องวด</th>
                          <th className="p-2 font-medium text-right">ยอด (รวม VAT)</th>
                          <th className="p-2 font-medium">กำหนดชำระ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {accountingInstallmentDraft.map((row, idx) => (
                          <tr key={row.id} className="border-b border-muted/50">
                            <td className="p-2 font-mono">{row.sequence ?? idx + 1}</td>
                            <td className="p-2 min-w-[8rem]">
                              <Input
                                className="h-9"
                                value={row.label}
                                onChange={(e) => {
                                  const next = [...accountingInstallmentDraft];
                                  next[idx] = { ...row, label: e.target.value };
                                  setAccountingInstallmentDraft(next);
                                }}
                              />
                            </td>
                            <td className="p-2 text-right">
                              <Input
                                className="h-9 font-mono text-right"
                                type="number"
                                step="0.01"
                                value={row.amountInclVat}
                                onChange={(e) => {
                                  const next = [...accountingInstallmentDraft];
                                  next[idx] = {
                                    ...row,
                                    amountInclVat: roundMoney2(parseFloat(e.target.value) || 0),
                                  };
                                  setAccountingInstallmentDraft(next);
                                }}
                              />
                            </td>
                            <td className="p-2 min-w-[11rem]">
                              <DatePickerThaiBE
                                className="h-9 w-full"
                                value={htmlDateValueToTimestampMs(row.dueDate || '')}
                                onChange={(ms) => {
                                  const next = [...accountingInstallmentDraft];
                                  next[idx] = { ...row, dueDate: timestampToHtmlDateValue(ms) };
                                  setAccountingInstallmentDraft(next);
                                }}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Button
                    type="button"
                    className="font-semibold"
                    disabled={accountingPlanSaving}
                    onClick={() => void saveAccountingInstallmentPlan()}
                  >
                    {accountingPlanSaving ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : null}
                    บันทึกแผนงวด (ใช้ก่อนจ่ายงวดถัดไป)
                  </Button>
                </CardContent>
              </Card>
            ) : null}
            {!isCashPo && (
              <Card className="border-blue-200 bg-blue-50/40">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <ClipboardCheck className="h-5 w-5 text-blue-800" /> ใบสั่งซื้อแบบเครดิต
                  </CardTitle>
                  <CardDescription className="text-blue-950/90 space-y-2">
                    <p>
                      รายการนี้อยู่ใน{' '}
                      <Link href="/accounts-payable" className="font-semibold underline">
                        เจ้าหนี้การค้า (AP)
                      </Link>{' '}
                      แล้ว — เมื่อถึงกำหนดชำระให้บันทึกจ่ายด้านล่าง (ลง cashbook · ออกหนังสือรับรองหัก ณ ที่จ่ายเมื่อมีการหัก)
                    </p>
                  </CardDescription>
                </CardHeader>
              </Card>
            )}
            {canPay && (
              <Card className={isCashPo ? 'border-emerald-200' : 'border-slate-200'}>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Banknote className="h-5 w-5" />
                    {isCashPo
                      ? 'จ่ายเงิน (เงินสด) + ลงรายรับรายจ่าย'
                      : 'บันทึกจ่ายเมื่อครบกำหนด (เครดิต)'}
                  </CardTitle>
                  <CardDescription>
                    {isCashPo ? (
                      <>
                        ลง cashbook เป็นจ่ายออก — <strong>ตัดบัญชีธนาคารเฉพาะสุทธิโอนให้คู่ค้า</strong>
                        {whtEnabledEffective
                          ? ' (ส่วนหัก ณ ที่จ่ายไม่ตัดบัญชีตอนโอน — ออกหนังสือรับรองเมื่อบันทึกจ่าย)'
                          : ''}
                      </>
                    ) : (
                      <>
                        เมื่อถึงวันจ่ายจริง ให้กดจ่ายที่นี่ — ระบบจะลง cashbook ปิดเจ้าหนี้ตามงวด
                        {billHasInstallmentPlan ? ' (หลายงวดในใบเดียวจะคงยอดค้างจนกว่าจะครบทุกงวด)' : ' และอัปเดตงวด PO'}
                      </>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {billHasInstallmentPlan ? (
                    <div className="space-y-2 min-w-0 rounded-md border bg-muted/20 px-3 py-3">
                      <Label>งวดที่บันทึกจ่ายครั้งนี้</Label>
                      <Select
                        value={installmentPayTargetId || undefined}
                        onValueChange={setInstallmentPayTargetId}
                      >
                        <SelectTrigger className="h-11 w-full">
                          <SelectValue placeholder="เลือกงวด..." />
                        </SelectTrigger>
                        <SelectContent>
                          {(bill.paymentInstallments ?? [])
                            .filter((i) => i.payStatus === 'PENDING')
                            .map((i) => (
                              <SelectItem key={i.id} value={i.id}>
                                {i.label} · ฿
                                {Number(i.amountInclVat || 0).toLocaleString(undefined, {
                                  minimumFractionDigits: 2,
                                })}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        เลือกงวดที่ตรงกับสลิปโอน — หลักฐานจะผูกกับงวดนี้เพื่อส่งให้คู่ค้า
                      </p>
                    </div>
                  ) : null}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2 min-w-0">
                      <Label>บัญชีธนาคารที่ตัดจ่าย</Label>
                      <Select value={payoutBankId || undefined} onValueChange={setPayoutBankId}>
                        <SelectTrigger className="h-11 w-full">
                          <SelectValue placeholder="เลือกบัญชี..." />
                        </SelectTrigger>
                        <SelectContent>
                          {(bankAccounts || [])
                            .filter((b) => b.status === 'ACTIVE')
                            .map((b) => (
                              <SelectItem key={b.id} value={b.id}>
                                {b.bankName} · {b.accountNumber} (฿{b.currentBalance.toLocaleString()})
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2 min-w-0">
                      <Label>วิธีชำระ</Label>
                      <Select value={payoutMethod} onValueChange={(v) => setPayoutMethod(v as PaymentMethod)}>
                        <SelectTrigger className="h-11 w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="TRANSFER">โอนเงิน</SelectItem>
                          <SelectItem value="CASH">เงินสด</SelectItem>
                          <SelectItem value="CHEQUE">เช็ค</SelectItem>
                          <SelectItem value="OTHER">อื่น ๆ</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {vendorPayeeBankDisplay ? (
                    <div className="rounded-md border border-sky-200/90 bg-sky-50/45 px-3 py-3 space-y-2 dark:bg-sky-950/25 dark:border-sky-900/45">
                      <div className="flex items-center gap-2 text-sm font-semibold text-sky-950 dark:text-sky-100">
                        <Building2 className="h-4 w-4 shrink-0 opacity-80" />
                        บัญชีรับเงินของคู่ค้า (โอนเข้า — จากทะเบียนคู่ค้า)
                      </div>
                      <dl className="grid gap-1.5 text-sm">
                        {vendorPayeeBankDisplay.bankName ? (
                          <div className="flex flex-wrap gap-x-2">
                            <dt className="text-muted-foreground shrink-0">ธนาคาร</dt>
                            <dd className="font-mono font-medium">{vendorPayeeBankDisplay.bankName}</dd>
                          </div>
                        ) : null}
                        {vendorPayeeBankDisplay.acctName ? (
                          <div className="flex flex-wrap gap-x-2">
                            <dt className="text-muted-foreground shrink-0">ชื่อบัญชี</dt>
                            <dd className="font-medium">{vendorPayeeBankDisplay.acctName}</dd>
                          </div>
                        ) : null}
                        {vendorPayeeBankDisplay.acctNo ? (
                          <div className="flex flex-wrap gap-x-2">
                            <dt className="text-muted-foreground shrink-0">เลขที่บัญชี</dt>
                            <dd className="font-mono font-semibold tracking-wide">{vendorPayeeBankDisplay.acctNo}</dd>
                          </div>
                        ) : null}
                      </dl>
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        ใช้อ้างอิงตอนโอนและแนบสลิป — ถ้าไม่ตรงกับของจริงให้แก้ที่เมนูทะเบียนคู่ค้า (ข้อมูลการเงิน)
                      </p>
                      {vendor?.id ? (
                        <Button variant="link" className="h-auto p-0 text-xs font-semibold" asChild>
                          <Link href={`/vendors/${vendor.id}`}>
                            เปิดแก้ไขคู่ค้า <ExternalLink className="h-3 w-3 ml-0.5 inline" />
                          </Link>
                        </Button>
                      ) : null}
                    </div>
                  ) : vendor ? (
                    <div className="rounded-md border border-dashed border-muted-foreground/30 bg-muted/15 px-3 py-2 text-xs text-muted-foreground leading-relaxed">
                      ยังไม่มีเลขบัญชีรับเงินของคู่ค้าในระบบ — แนะนำกรอกที่{' '}
                      <Link href={`/vendors/${vendor.id}`} className="font-semibold text-primary underline">
                        คู่ค้านี้ → ข้อมูลการเงิน
                      </Link>{' '}
                      เพื่อแสดงที่นี่ตอนโอน
                    </div>
                  ) : null}
                  <div className="space-y-2 min-w-0">
                    <Label>แนบหลักฐานโอนเงิน (PDF หรือรูปภาพ)</Label>
                    <p className="text-[11px] text-muted-foreground leading-snug">
                      แนบเฉพาะสลิปหรือหลักฐานการโอน — ใบหัก ณ ที่จ่ายพิมพ์จากระบบได้ (ปุ่มด้านล่าง) ไม่ต้องแนบที่นี่
                    </p>
                    <Input
                      ref={paymentProofInputRef}
                      type="file"
                      accept="application/pdf,image/jpeg,image/jpg,image/png,image/webp,image/gif,.pdf,.jpg,.jpeg,.png,.webp,.gif"
                      className="h-11 cursor-pointer"
                      onChange={(e) => setPaymentProofFile(e.target.files?.[0] ?? null)}
                    />
                    {paymentProofFile ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs text-muted-foreground min-w-0 flex-1 truncate">
                          เลือกแล้ว: {paymentProofFile.name}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="shrink-0"
                          onClick={() => {
                            setPaymentProofFile(null);
                            if (paymentProofInputRef.current) paymentProofInputRef.current.value = '';
                          }}
                        >
                          ลบไฟล์
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2 min-w-0">
                      <Label>วันที่ทำรายการ (cashbook)</Label>
                      <DatePickerThaiBE
                        className="h-11 w-full"
                        value={htmlDateValueToTimestampMs(payoutEntryDate)}
                        onChange={(ms) => setPayoutEntryDate(timestampToHtmlDateValue(ms))}
                      />
                    </div>
                    <div className="space-y-2 min-w-0">
                      <Label>ยอดตัดจากบัญชีธนาคาร (โอนสุทธิให้คู่ค้า)</Label>
                      <Input
                        readOnly
                        className="h-11 font-mono font-bold text-right bg-muted/50"
                        value={`฿ ${bankDebitAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                      />
                      {withholdingAtPayout && withholdingAtPayout.wht > 0.005 ? (
                        <div className="text-[11px] text-muted-foreground leading-snug space-y-1">
                          <p>
                            ยอดงวด (รวม VAT) ฿
                            {payoutGrossInclVat.toLocaleString(undefined, { minimumFractionDigits: 2 })} — หัก ณ ที่จ่าย ฿
                            {withholdingAtPayout.wht.toLocaleString(undefined, { minimumFractionDigits: 2 })} (
                            {effectiveWhtRatePercent}%) ไม่ตัดจากบัญชีตอนโอน — ระบบสร้างหนังสือรับรองและเลขที่เมื่อยืนยันจ่าย
                          </p>
                        </div>
                      ) : (
                        <p className="text-[11px] text-muted-foreground">
                          ไม่มีหัก ณ ที่จ่าย — ตัดบัญชีเท่ายอดงวด/ใบวางบิล
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3 pt-1">
                    <Button
                      className="bg-green-600 hover:bg-green-700 font-bold gap-2 sm:flex-1 min-h-11 order-1"
                      disabled={paying || !payoutBankId}
                      onClick={() => void markPaid()}
                    >
                      {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />}
                      ยืนยันจ่ายเงิน + ลง cashbook
                    </Button>
                    {canPrintWithholdingAtPayout && canPreviewVendorBillWht ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="font-bold gap-2 border-primary/40 sm:flex-1 min-h-11 order-2"
                        disabled={submittedWhtBusy}
                        onClick={() => void handleSubmittedPreviewWhtCertificate()}
                        title="เปิดหน้าพิมพ์ตัวอย่างจากข้อมูลในฟอร์ม — เลขที่ทางการหลังบันทึกจ่ายและออกเอกสารในระบบ"
                      >
                        {submittedWhtBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <FileText className="h-4 w-4" />
                        )}
                        สร้างใบหัก ณ ที่จ่าย
                      </Button>
                    ) : null}
                  </div>
                  {canPrintWithholdingAtPayout && canPreviewVendorBillWht ? (
                    <p className="text-[11px] text-muted-foreground leading-snug">
                      ปุ่มขวาพิมพ์ตัวอย่างก่อนจ่ายจากข้อมูลในฟอร์ม · หลังบันทึกจ่ายครบ — พรีวิวและพิมพ์ชุดสำเนาได้จากตาราง «แผนงวดชำระในใบนี้» (คอลัมน์หัก ณ ที่จ่าย)
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            )}
          </>
        )}

        {purchase && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">อ้างอิง PR / PO และยอดในใบวางบิล</CardTitle>
              <CardDescription className="text-xs text-muted-foreground leading-relaxed">
                การจ่ายเงินยังทำทีละใบรับวางบิลตาม PO/งวดเหมือนเดิม — ส่วนนี้เป็นเสมือนใบปะหน้าและเก็บเลขที่เอกสารคู่ค้า (ถ้ามี)
                · ถ้าคู่ค้าเดียวกันหลาย PO ให้สร้างหลายใบ แล้วใช้ตัวกรองคู่ค้า + เดือนในรายการใบวางบิลเพื่อดูยอดรวม
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border bg-muted/20 px-3 py-2">
                  <p className="text-muted-foreground text-xs font-medium mb-1">ใบขอซื้อ (PR)</p>
                  <p className="font-mono font-semibold text-base">
                    {bill.purchaseRequestNo || purchaseRequest?.requestNo || '—'}
                  </p>
                  {purchase.purchaseRequestId ? (
                    <Button variant="link" className="h-auto p-0 text-xs" asChild>
                      <Link href={`/store/purchase-requests/${purchase.purchaseRequestId}`}>
                        เปิด PR <ExternalLink className="h-3 w-3 ml-0.5 inline" />
                      </Link>
                    </Button>
                  ) : null}
                </div>
                <div className="rounded-md border bg-muted/20 px-3 py-2">
                  <p className="text-muted-foreground text-xs font-medium mb-1">ใบสั่งซื้อ (PO)</p>
                  <p className="font-mono font-semibold text-base">{bill.purchaseNo || purchase.purchaseNo}</p>
                  <Button variant="link" className="h-auto p-0 text-xs" asChild>
                    <Link href={`/purchases/${purchase.id}`}>
                      เปิด PO <ExternalLink className="h-3 w-3 ml-0.5 inline" />
                    </Link>
                  </Button>
                </div>
              </div>

              <div className="rounded-md border bg-muted/30 px-3 py-2 space-y-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-1 min-w-0 flex-1">
                    <p className="text-xs font-semibold text-muted-foreground">การแสดงภาษีมูลค่าเพิ่มในใบวางบิล</p>
                    <p className="font-medium">
                      {displayedVatTreatment === 'NONE'
                        ? 'ไม่มีภาษีมูลค่าเพิ่มในยอดอ้างอิงนี้ / ยอดก่อนภาษี'
                        : displayedVatTreatment === 'VAT_7_INCLUSIVE'
                          ? 'มีภาษีมูลค่าเพิ่ม 7% (ภาษีในตัว — ยอดรวมในใบรวม VAT)'
                          : 'มีภาษีมูลค่าเพิ่ม 7% (แยกภาษี — ยอดรวม = ก่อนภาษี + VAT)'}
                    </p>
                    {billFinancialSlice && displayedVatTreatment === 'NONE' && billFinancialSlice.vat > 0.005 ? (
                      <p className="text-xs text-amber-900 dark:text-amber-200 mt-1 leading-snug">
                        หมายเหตุ: เลือกว่าไม่มีภาษี แต่ส่วนที่จัดสรรจาก PO ยังมียอดภาษี — ควรตรวจให้ตรงกับเอกสารคู่ค้า
                      </p>
                    ) : null}
                    {billFinancialSlice &&
                    (displayedVatTreatment === 'VAT_7' || displayedVatTreatment === 'VAT_7_INCLUSIVE') &&
                    billFinancialSlice.vat < 0.005 ? (
                      <p className="text-xs text-amber-900 dark:text-amber-200 mt-1 leading-snug">
                        หมายเหตุ: เลือกว่ามี VAT แต่ส่วนที่จัดสรรจาก PO ไม่มียอดภาษี — ควรตรวจให้ตรงกับเอกสารคู่ค้า
                      </p>
                    ) : null}
                  </div>
                  {canEditAccountingBillTax ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0 gap-1.5 font-semibold"
                      onClick={() => openAccountingVatDialog()}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      แก้ไข
                    </Button>
                  ) : null}
                </div>
              </div>

              {billFinancialSlice ? (
                <div className="rounded-md border px-3 py-2 space-y-1.5 font-mono text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground font-sans text-xs sm:text-sm">
                      ยอดก่อนภาษี (ส่วนที่ใช้ในใบนี้)
                    </span>
                    <span>
                      ฿
                      {billFinancialSlice.beforeTax.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground font-sans text-xs sm:text-sm">
                      ภาษีมูลค่าเพิ่ม (ส่วนที่ใช้ในใบนี้)
                    </span>
                    <span>
                      ฿
                      {billFinancialSlice.vat.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2 font-bold border-t pt-1.5 font-sans">
                    <span>รวมในใบวางบิล (ก่อนหัก ณ ที่จ่าย)</span>
                    <span className="font-mono">
                      ฿
                      {billFinancialSlice.gross.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                </div>
              ) : null}

              {withholdingPreview && withholdingPreview.wht > 0.005 ? (
                <div className="rounded-md border border-violet-200/80 bg-violet-50/30 px-3 py-2 space-y-3">
                  <div className="min-w-0 space-y-1">
                    <p className="text-xs font-semibold text-violet-950">หัก ณ ที่จ่าย (ผู้รับเงิน)</p>
                    <p className="text-sm">
                      อัตรา {effectiveWhtRatePercent}%
                      {hasVendorBillWhtPreset ? (
                        <span className="text-muted-foreground">
                          {' '}
                          (
                          {WHT_PRESET_OPTIONS.find((o) => o.id === bill.vendorBillWhtPresetCategory)?.title ?? 'เมนูบัญชี'}{' '}
                          — เลือกก่อนจ่าย)
                        </span>
                      ) : hasManualWhtOnly ? (
                        <span className="text-muted-foreground">
                          {' '}
                          (PO ลง {poWhtRatePercent}% — แก้ % มือเฉพาะใบนี้)
                        </span>
                      ) : null}{' '}
                      ·{' '}
                      {hasManualWhtTaxBase ? (
                        <span className="text-amber-900 dark:text-amber-200 font-medium">
                          ฐานหัก ณ ที่จ่าย (กำหนดมือ) ฿
                        </span>
                      ) : (
                        <span>ฐานก่อนภาษี (ประมาณการ) ฿</span>
                      )}
                      {withholdingPreview.baseBeforeVat.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                      })}{' '}
                      · หัก ณ ที่จ่าย ฿
                      {withholdingPreview.wht.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>
                    <p className="font-bold text-base">
                      สุทธิที่โอนให้คู่ค้า (หลังหัก ณ ที่จ่าย) ฿
                      {withholdingPreview.netPaid.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                      })}
                    </p>
                  </div>
                  {canPay && awaitingVendorPayment && whtEnabledEffective ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-md border border-violet-300/80 bg-background/80 px-3 py-2.5 dark:bg-background/40">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5 font-semibold border-violet-400/80 bg-background"
                        onClick={() => {
                          if (canEditAccountingBillTax) {
                            openAccountingWhtDialog();
                            return;
                          }
                          const next =
                            bill.vendorBillWhtPresetCategory ??
                            inferWhtPresetFromEffectiveRate(effectiveWhtRatePercent);
                          setWhtPresetChoice(next);
                          setWhtPresetDialogOpen(true);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        แก้ไขรายการหัก ณ ที่จ่าย
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5 font-semibold border-violet-400/80 bg-background"
                        onClick={() => openWhtTaxBaseDialog()}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        กำหนดฐานหัก
                      </Button>
                      <p className="text-[11px] text-muted-foreground leading-snug min-w-0 flex-1">
                        เลือกประเภทเงินได้ (ค่าขนส่ง 1% / ค่าบริการ 3% / ค่าเช่า 5%) — กำหนดฐานหักเมื่อยอดที่ต้องหักไม่เท่ากับยอดก่อนภาษีในใบ — ระบบจะคำนวณยอดหักและยอดโอนสุทธิใหม่
                        {hasVendorBillWhtPreset ? (
                          <span className="block mt-1 text-foreground font-medium">
                            ปัจจุบัน:{' '}
                            {WHT_PRESET_OPTIONS.find((o) => o.id === bill.vendorBillWhtPresetCategory)?.title ?? '—'} ·{' '}
                            {effectiveWhtRatePercent}%
                          </span>
                        ) : null}
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-dashed border-muted-foreground/25 bg-muted/15 px-3 py-2">
                  <p className="text-muted-foreground text-xs leading-relaxed min-w-0 flex-1">
                    ไม่มีหัก ณ ที่จ่ายตามการตั้งค่า PO/คู่ค้า — ยอดที่ต้องจ่ายให้คู่ค้าเท่ากับยอดรวมในใบวางบิลด้านบน
                  </p>
                  {canEditAccountingBillTax ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0 gap-1.5 font-semibold"
                      onClick={() => openAccountingWhtDialog()}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      แก้ไข
                    </Button>
                  ) : null}
                </div>
              )}

              <p className="text-xs text-muted-foreground border-t pt-2">
                ยอดสุทธิทั้งใบสั่งซื้อ PO ฿
                {purchase.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                {linkedMilestone
                  ? ` · งวดชำระ #${linkedMilestone.sequence}: ${linkedMilestone.label}`
                  : ''}
                {bill.billAmount != null && bill.billAmount > 0 ? (
                  <> · บันทึกยอดในใบนี้ ฿{bill.billAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</>
                ) : null}
              </p>

              {bill.status !== 'DRAFT' && (
                <div className="border-t pt-3 space-y-2">
                  <p className="text-xs font-semibold">เอกสารประกอบที่บันทึกไว้</p>
                  <SupportingDocReadOnly title="1. ใบส่งของ" link={bill.supportingDeliveryNote} />
                  <SupportingDocReadOnly title="2. ใบกำกับภาษี" link={bill.supportingTaxInvoice} />
                  <SupportingDocReadOnly title="3. ใบเสร็จรับเงิน (คู่ค้า)" link={bill.supportingMoneyReceipt} />
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {bill.status !== 'DRAFT' && (okStore || okAccounting) && (
          <Card className={docsChecklistOk ? 'border-emerald-200/90 bg-emerald-50/25' : ''}>
            <CardHeader>
              <CardTitle className="text-base">เช็คลิสต์ปิดเรื่องเอกสาร</CardTitle>
              <CardDescription>
                สถานะสมบูรณ์ทางธุรการคือได้รับ <strong>ใบกำกับภาษี</strong> และ{' '}
                <strong>ใบเสร็จรับเงิน</strong> ครบ — แยกจากการจ่ายเงินครบทุกงวด · ติ๊กเมื่อได้รับเอกสารแล้วกรอกเลขที่
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {bill.vendorBillDocumentationClosed ? (
                <div className="space-y-3">
                  <p className="text-emerald-900 leading-relaxed">
                    ปิดเรื่องเอกสารสมบูรณ์แล้ว
                    {bill.vendorBillDocumentationClosedAt
                      ? ` · ${new Date(bill.vendorBillDocumentationClosedAt).toLocaleString('th-TH')}`
                      : ''}
                    {bill.vendorBillDocumentationClosedByName
                      ? ` · โดย ${bill.vendorBillDocumentationClosedByName}`
                      : ''}
                  </p>
                  <dl className="grid gap-2 text-muted-foreground">
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                      <dt className="font-medium text-foreground">ใบกำกับภาษี</dt>
                      <dd className="font-mono">
                        {(bill.supportingTaxInvoice?.documentNo || '').trim() || '—'}
                      </dd>
                    </div>
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                      <dt className="font-medium text-foreground">ใบเสร็จรับเงิน (คู่ค้า)</dt>
                      <dd className="font-mono">
                        {(bill.supportingMoneyReceipt?.documentNo || '').trim() || '—'}
                      </dd>
                    </div>
                  </dl>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="pt-0.5">
                      <Checkbox
                        id="doc-close-tax-inv"
                        checked={docCloseTiChecked}
                        onCheckedChange={(c) => {
                          const on = c === true;
                          setDocCloseTiChecked(on);
                          if (!on) setDocCloseTiNo('');
                        }}
                      />
                    </div>
                    <div className="flex-1 min-w-[min(100%,14rem)] space-y-1.5">
                      <Label htmlFor="doc-close-tax-inv" className="font-semibold cursor-pointer">
                        ใบกำกับภาษี
                      </Label>
                      <Input
                        id="doc-close-tax-inv-no"
                        className="h-9 font-mono"
                        placeholder="เลขที่ใบกำกับภาษี"
                        value={docCloseTiNo}
                        onChange={(e) => setDocCloseTiNo(e.target.value)}
                        disabled={!docCloseTiChecked}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="pt-0.5">
                      <Checkbox
                        id="doc-close-receipt"
                        checked={docCloseRcChecked}
                        onCheckedChange={(c) => {
                          const on = c === true;
                          setDocCloseRcChecked(on);
                          if (!on) setDocCloseRcNo('');
                        }}
                      />
                    </div>
                    <div className="flex-1 min-w-[min(100%,14rem)] space-y-1.5">
                      <Label htmlFor="doc-close-receipt" className="font-semibold cursor-pointer">
                        ใบเสร็จรับเงิน (คู่ค้า)
                      </Label>
                      <Input
                        id="doc-close-receipt-no"
                        className="h-9 font-mono"
                        placeholder="เลขที่ใบเสร็จรับเงิน"
                        value={docCloseRcNo}
                        onChange={(e) => setDocCloseRcNo(e.target.value)}
                        disabled={!docCloseRcChecked}
                      />
                    </div>
                  </div>
                  <Button
                    type="button"
                    disabled={!docCloseFormReady || docCloseBusy}
                    className="font-semibold"
                    onClick={() => void closeVendorBillDocumentation()}
                  >
                    {docCloseBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    ยืนยันปิดเรื่องเอกสารสมบูรณ์
                  </Button>
                  {!docCloseFormReady ? (
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      ติ๊กครบสองรายการและกรอกเลขที่ทั้งคู่ — ระบบจะบันทึกลงใบวางบิลและปิดเรื่องเอกสาร (วันที่อ้างอิงใช้จากวันรับวางบิลหรือวันนี้ถ้ายังไม่มี)
                    </p>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        )}

        {bill.status === 'DRAFT' && okStore && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">ภาษีและเอกสารประกอบจากคู่ค้า</CardTitle>
              <CardDescription className="text-xs leading-relaxed">
                เลือกว่ามองยอดในใบวางบิลว่ามี VAT 7% หรือไม่ (ค่าเริ่มต้นตาม PO) · ติ๊กเฉพาะเอกสารที่ได้รับจากคู่ค้า
                แล้วกรอกเลขที่และวันที่ — ถ้าไม่มีให้ปล่อยไม่ติ๊ก (อ้างอิงเฉพาะ PO ภายใน)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <Label className="text-sm font-semibold">ภาษีมูลค่าเพิ่มในใบวางบิลนี้</Label>
                <RadioGroup
                  value={vatMode}
                  onValueChange={(v) => setVatMode(v as VatModeUi)}
                  className="gap-2"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="AUTO" id="vat-auto" />
                    <Label htmlFor="vat-auto" className="font-normal cursor-pointer">
                      ตามใบสั่งซื้อ (แนะนำ)
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="VAT_7" id="vat-7" />
                    <Label htmlFor="vat-7" className="font-normal cursor-pointer">
                      มี VAT 7% — แยกภาษี (ยอดรวม = ก่อนภาษี + VAT)
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="VAT_7_INCLUSIVE" id="vat-7-inc" />
                    <Label htmlFor="vat-7-inc" className="font-normal cursor-pointer">
                      มี VAT 7% — ภาษีในตัว (ยอดรวมในใบรวม VAT)
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="NONE" id="vat-none" />
                    <Label htmlFor="vat-none" className="font-normal cursor-pointer">
                      ระบุว่าไม่มีภาษีมูลค่าเพิ่ม
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              <div className="space-y-4">
                <Label className="text-sm font-semibold">เอกสารประกอบ (ถ้ามี)</Label>
                {(
                  [
                    {
                      key: 'dn',
                      title: '1. ใบส่งของ',
                      row: supportingDelivery,
                      setRow: setSupportingDelivery,
                    },
                    {
                      key: 'ti',
                      title: '2. ใบกำกับภาษี',
                      row: supportingTaxInv,
                      setRow: setSupportingTaxInv,
                    },
                    {
                      key: 'rc',
                      title: '3. ใบเสร็จรับเงิน (จากคู่ค้า)',
                      row: supportingReceipt,
                      setRow: setSupportingReceipt,
                    },
                  ] as const
                ).map(({ key, title, row, setRow }) => (
                  <div key={key} className="rounded-md border p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={`sup-${key}`}
                        checked={row.attached}
                        onCheckedChange={(c) =>
                          setRow({
                            attached: c === true,
                            documentNo: c === true ? row.documentNo : '',
                            documentDate: c === true ? row.documentDate : '',
                          })
                        }
                      />
                      <Label htmlFor={`sup-${key}`} className="font-medium cursor-pointer">
                        {title}
                      </Label>
                    </div>
                    {row.attached ? (
                      <div className="grid gap-3 sm:grid-cols-2 pl-6">
                        <div className="space-y-1">
                          <Label className="text-xs">เลขที่เอกสาร</Label>
                          <Input
                            className="h-10 font-mono"
                            value={row.documentNo}
                            onChange={(e) => setRow({ ...row, documentNo: e.target.value })}
                            placeholder="เลขที่..."
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">วันที่เอกสาร</Label>
                          <DatePickerThaiBE
                            className="h-10 w-full"
                            value={htmlDateValueToTimestampMs(row.documentDate)}
                            onChange={(ms) =>
                              setRow({ ...row, documentDate: timestampToHtmlDateValue(ms) })
                            }
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {bill.status === 'DRAFT' && okStore && purchase && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">แผนงวดชำระในใบนี้</CardTitle>
              <CardDescription className="text-xs leading-relaxed">
                กำหนด 1–5 งวดที่ฝ่ายคลังตกลงกับคู่ค้า — ผลรวมต้องเท่ายอดในใบวางบิล (รวม VAT) บัญชีจะบันทึกจ่ายทีละงวด
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-2 min-w-[10rem]">
                  <Label>จำนวนงวด</Label>
                  <Select
                    value={String(Math.max(1, installmentsDraft.length))}
                    onValueChange={(v) => {
                      const n = parseInt(v, 10);
                      setInstallmentsDraft(buildEqualInstallmentDrafts(n, vendorBillTotalInclVat(bill, purchase)));
                    }}
                  >
                    <SelectTrigger className="h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n} งวด
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-sm pb-1">
                  ยอดรวมในใบ (รวม VAT){' '}
                  <span className="font-mono font-bold">
                    ฿
                    {vendorBillTotalInclVat(bill, purchase).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                    })}
                  </span>
                </p>
              </div>
              {validateInstallmentsAgainstTotal(installmentsDraft, vendorBillTotalInclVat(bill, purchase)) ? (
                <p className="text-sm text-destructive">
                  {validateInstallmentsAgainstTotal(installmentsDraft, vendorBillTotalInclVat(bill, purchase))}
                </p>
              ) : (
                <p className="text-xs text-emerald-800">ผลรวมงวดตรงกับยอดใบวางบิล</p>
              )}
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                      <th className="p-2 font-medium">#</th>
                      <th className="p-2 font-medium">ชื่องวด</th>
                      <th className="p-2 font-medium text-right">ยอด (รวม VAT)</th>
                      <th className="p-2 font-medium">กำหนดชำระ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {installmentsDraft.map((row, idx) => (
                      <tr key={row.id} className="border-b border-muted/50">
                        <td className="p-2 font-mono">{row.sequence}</td>
                        <td className="p-2 min-w-[8rem]">
                          <Input
                            className="h-9"
                            value={row.label}
                            onChange={(e) => {
                              const next = [...installmentsDraft];
                              next[idx] = { ...row, label: e.target.value };
                              setInstallmentsDraft(next);
                            }}
                          />
                        </td>
                        <td className="p-2 text-right">
                          <Input
                            className="h-9 font-mono text-right"
                            type="number"
                            step="0.01"
                            value={row.amountInclVat}
                            onChange={(e) => {
                              const next = [...installmentsDraft];
                              next[idx] = {
                                ...row,
                                amountInclVat: roundMoney2(parseFloat(e.target.value) || 0),
                              };
                              setInstallmentsDraft(next);
                            }}
                          />
                        </td>
                        <td className="p-2 min-w-[11rem]">
                          <DatePickerThaiBE
                            className="h-9 w-full"
                            value={htmlDateValueToTimestampMs(row.dueDate || '')}
                            onChange={(ms) => {
                              const next = [...installmentsDraft];
                              next[idx] = { ...row, dueDate: timestampToHtmlDateValue(ms) };
                              setInstallmentsDraft(next);
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {bill.status === 'DRAFT' && okStore && (
          <Card className="border-amber-200/80 bg-amber-50/30 print:hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">การยืนยันงวดชำระ</CardTitle>
              <CardDescription>
                เมื่อกดส่งแผนกบัญชี ถือว่าได้ตรวจรับสินค้า/งานตามงวดที่ใบนี้อ้างอิงครบถ้วนแล้ว (ทั้งกรณีเงินสดและเครดิต)
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">ข้อมูลใบรับวางบิล</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-2 min-w-0">
                <Label>วันที่วางบิล</Label>
                <DatePickerThaiBE
                  className="h-11"
                  value={htmlDateValueToTimestampMs(billingDate)}
                  onChange={(ms) => setBillingDate(timestampToHtmlDateValue(ms))}
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-2 min-w-0">
                <Label>วันที่จะจ่าย</Label>
                <DatePickerThaiBE
                  className="h-11"
                  value={htmlDateValueToTimestampMs(payDate)}
                  onChange={(ms) => setPayDate(timestampToHtmlDateValue(ms))}
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-2 min-w-0">
                <Label>วันที่จ่ายเงิน</Label>
                {bill.status === 'PAID' && bill.paidAt ? (
                  <DatePickerThaiBE
                    className="h-11"
                    value={bill.paidAt}
                    onChange={() => {}}
                    disabled
                  />
                ) : (
                  <div className="flex h-11 min-h-[2.75rem] items-center rounded-md border border-dashed border-muted-foreground/25 bg-muted/30 px-3 text-sm text-muted-foreground">
                    {awaitingVendorPayment ? 'ยังไม่จ่ายครบ' : '—'}
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label>หมายเหตุ</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={readOnly}
                rows={3}
              />
            </div>

            {bill.status === 'DRAFT' && okStore && (
              <div className="flex flex-wrap gap-2 pt-2">
                <Button variant="outline" onClick={() => void saveDraft()}>
                  บันทึกฉบับร่าง
                </Button>
                <Button className="font-bold gap-2" type="button" onClick={() => setSubmitConfirmOpen(true)}>
                  <Send className="h-4 w-4" /> ส่งแผนกบัญชี
                </Button>
              </div>
            )}

          </CardContent>
        </Card>

        <Dialog open={whtHubOpen} onOpenChange={setWhtHubOpen}>
          <DialogContent className="max-h-[90vh] w-[min(96vw,72rem)] max-w-[min(96vw,72rem)] translate-y-[-48%] gap-0 overflow-hidden p-0 flex flex-col sm:max-w-[min(96vw,72rem)]">
            <DialogHeader className="shrink-0 space-y-1 px-6 pt-6 pb-3">
              <DialogTitle>พรีวิวและพิมพ์ — หนังสือรับรองหัก ณ ที่จ่าย</DialogTitle>
              <DialogDescription className="text-xs sm:text-sm leading-relaxed">
                ด้านซ้ายเป็นพรีวิวตามข้อมูลจ่ายจริง · ด้านขวาเลือกพิมพ์ · ถ้ายังไม่มีเลขที่ (เอกสารเก่าหรือข้อมูลไม่ครบ) ช่องเลขที่จะเป็น «—» — ผู้มีสิทธิ์บัญชีใช้ปุ่ม «ออกเลขที่» ด้านขวาเพื่อรันเลขถัดไปจากระบบ (ไม่สร้างเอกสารซ้ำ)
              </DialogDescription>
            </DialogHeader>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t lg:flex-row">
              <div className="flex min-h-[220px] flex-1 flex-col border-b bg-muted/30 lg:min-h-[min(480px,58vh)] lg:w-[58%] lg:max-w-[58%] lg:border-b-0 lg:border-r">
                {whtHubPreviewHtml ? (
                  <iframe
                    key={whtHubIframeKey}
                    title="พรีวิวหนังสือรับรองหัก ณ ที่จ่าย"
                    className="min-h-[220px] w-full flex-1 border-0 bg-white lg:min-h-0"
                    srcDoc={whtHubPreviewHtml}
                  />
                ) : (
                  <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
                    ไม่สามารถสร้างตัวอย่าง
                  </div>
                )}
              </div>
              <ScrollArea className="h-[min(42vh,360px)] shrink-0 lg:h-auto lg:max-h-[min(72vh,620px)] lg:min-h-[min(480px,58vh)] lg:flex-1">
                <div className="space-y-5 p-4 text-sm">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled={!whtHubPreviewHtml.trim() || whtPrintBusy}
                    onClick={() => openWhtPreviewInNewTab()}
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    เปิดพรีวิวในแท็บใหม่ (พิมพ์จากเมนูเบราว์เซอร์)
                  </Button>
                  {showWhtAssignNumberPanel ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50/70 p-3 space-y-2">
                      <p className="text-xs text-amber-950 leading-snug">
                        เอกสารนี้ยังไม่มีเลขที่ในระบบ — กดด้านล่างเพื่อรันเลขถัดไป (ชุด WHT50-) แล้วใช้พิมพ์แบบมีเลขที่จริง
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        className="w-full font-semibold"
                        disabled={whtAssignNoBusy || whtPrintBusy}
                        onClick={() => void handleAssignWhtCertificateNumber()}
                      >
                        {whtAssignNoBusy ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <FileText className="mr-2 h-4 w-4" />
                        )}
                        ออกเลขที่หนังสือรับรอง
                      </Button>
                    </div>
                  ) : null}
                  <Separator />
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      พิมพ์
                    </p>
                    <Button
                      type="button"
                      variant="default"
                      className="h-auto w-full justify-start whitespace-normal py-2.5 text-left font-normal"
                      disabled={whtPrintBusy || !effectiveWhtPrintDoc}
                      onClick={() =>
                        effectiveWhtPrintDoc &&
                        void runWhtCertificatePayeeCopies12Print(
                          effectiveWhtPrintDoc,
                          whtHubOfficialPrint,
                          true,
                        )
                      }
                    >
                      <Printer className="mr-2 h-4 w-4 shrink-0" />
                      <span>
                        <span className="block font-semibold">ส่วนผู้ถูกหัก — 2 ฉบับ (ไฟล์เดียว)</span>
                        <span className="text-xs opacity-90">ฉบับที่ 1 และ 2 ในหน้าต่างพิมพ์เดียว</span>
                      </span>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-auto w-full justify-start whitespace-normal py-2.5 text-left font-normal"
                      disabled={whtPrintBusy || !effectiveWhtPrintDoc}
                      onClick={() =>
                        effectiveWhtPrintDoc &&
                        void runWhtCertificatePrint(
                          effectiveWhtPrintDoc,
                          'COPY_PAYER_RECORD',
                          whtHubOfficialPrint,
                          true,
                        )
                      }
                    >
                      <Printer className="mr-2 h-4 w-4 shrink-0 opacity-70" />
                      <span>
                        <span className="block font-semibold">ส่วนผู้หัก</span>
                        <span className="text-xs text-muted-foreground">สำเนาสำหรับผู้จ่ายเงิน</span>
                      </span>
                    </Button>
                  </div>
                </div>
              </ScrollArea>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={whtRateEditOpen} onOpenChange={setWhtRateEditOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>แก้ไขอัตราหัก ณ ที่จ่าย (เฉพาะใบนี้)</DialogTitle>
              <DialogDescription className="text-sm leading-relaxed">
                ใช้เมื่อฝ่ายคลังลง % จาก PO ไม่ตรงกับเอกสารจริง — ยอดจ่าย ยอดหัก และหลักฐานหักจะคำนวณตามค่าที่บันทึกที่นี่ก่อนยืนยันจ่าย
                {poWhtRatePercent > 0.005 ? (
                  <span className="mt-2 block text-foreground">
                    อัตราบน PO ปัจจุบัน: <span className="font-mono font-semibold">{poWhtRatePercent}%</span>
                  </span>
                ) : null}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <Label htmlFor="wht-rate-bill-override">อัตราหัก ณ ที่จ่าย (%)</Label>
              <Input
                id="wht-rate-bill-override"
                type="text"
                inputMode="decimal"
                className="font-mono h-11"
                value={whtRateInput}
                onChange={(e) => setWhtRateInput(e.target.value)}
                placeholder="เช่น 3"
              />
            </div>
            <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                {hasManualWhtOnly || hasVendorBillWhtPreset ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={whtRateSaving}
                    onClick={() => void clearBillWhtRateOverride()}
                  >
                    คืนค่าตาม PO
                  </Button>
                ) : null}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" disabled={whtRateSaving} onClick={() => setWhtRateEditOpen(false)}>
                  ยกเลิก
                </Button>
                <Button
                  type="button"
                  className="font-semibold"
                  disabled={whtRateSaving}
                  onClick={() => void saveBillWhtRateOverride()}
                >
                  {whtRateSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  บันทึก
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={whtTaxBaseDialogOpen} onOpenChange={setWhtTaxBaseDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>กำหนดฐานหัก ณ ที่จ่าย (เฉพาะใบนี้)</DialogTitle>
              <DialogDescription className="text-sm leading-relaxed">
                ปกติระบบใช้ยอดก่อนภาษีตามสัดส่วน / VAT ของใบวางบิล — ถ้าฐานหักตามเอกสารไม่เท่ากับยอดนั้น ให้ระบุจำนวนเงินก่อนภาษีที่ใช้คูณอัตราหัก ณ ที่จ่าย (ไม่เกินยอดรวมในใบก่อนหัก ณ ที่จ่าย ฿
                {grossInclVatForBill.toLocaleString(undefined, { minimumFractionDigits: 2 })})
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <Label htmlFor="wht-tax-base-bill">ฐานเงินก่อนภาษีสำหรับคำนวณหัก (บาท)</Label>
              <Input
                id="wht-tax-base-bill"
                type="text"
                inputMode="decimal"
                className="font-mono h-11"
                value={whtTaxBaseInput}
                onChange={(e) => setWhtTaxBaseInput(e.target.value)}
                placeholder="เว้นว่าง = ใช้ยอดจากใบอัตโนมัติ"
              />
            </div>
            <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                {hasManualWhtTaxBase ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={whtTaxBaseSaving}
                    onClick={() => void clearWhtTaxBaseOverride()}
                  >
                    คืนค่าอัตโนมัติ
                  </Button>
                ) : null}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={whtTaxBaseSaving}
                  onClick={() => setWhtTaxBaseDialogOpen(false)}
                >
                  ยกเลิก
                </Button>
                <Button
                  type="button"
                  className="font-semibold"
                  disabled={whtTaxBaseSaving}
                  onClick={() => void saveWhtTaxBaseOverride()}
                >
                  {whtTaxBaseSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  บันทึก
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={whtPresetDialogOpen} onOpenChange={setWhtPresetDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>แก้ไขรายการหัก ณ ที่จ่าย (เฉพาะใบนี้)</DialogTitle>
              <DialogDescription className="text-sm leading-relaxed">
                เลือกประเภทให้ตรงกับเอกสารจริงก่อนยืนยันจ่าย — อัตรา ยอดหัก และยอดโอนสุทธิจะคำนวณใหม่ และข้อความบนใบหัก ม.50 จะใช้ตามรายการที่เลือก
                {poWhtRatePercent > 0.005 ? (
                  <span className="mt-2 block text-foreground">
                    อัตราบน PO ปัจจุบัน:{' '}
                    <span className="font-mono font-semibold">{poWhtRatePercent}%</span>
                  </span>
                ) : null}
              </DialogDescription>
            </DialogHeader>
            <RadioGroup
              value={whtPresetChoice}
              onValueChange={(v) => setWhtPresetChoice(v as VendorBillWhtPresetCategory)}
              className="gap-3 py-2"
            >
              {WHT_PRESET_OPTIONS.map((opt) => (
                <label
                  key={opt.id}
                  className="flex cursor-pointer items-start gap-3 rounded-md border border-muted bg-muted/20 px-3 py-2.5 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
                >
                  <RadioGroupItem value={opt.id} id={`wht-preset-${opt.id}`} className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold leading-tight">{opt.title}</span>
                    <span className="text-xs text-muted-foreground">{opt.detail}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
            <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                {hasVendorBillWhtPreset || hasManualWhtOnly ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={whtPresetSaving}
                    onClick={() => void clearWhtPresetDialogToPo()}
                  >
                    ใช้ตาม PO
                  </Button>
                ) : null}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={whtPresetSaving}
                  onClick={() => setWhtPresetDialogOpen(false)}
                >
                  ยกเลิก
                </Button>
                <Button
                  type="button"
                  className="font-semibold"
                  disabled={whtPresetSaving}
                  onClick={() => void saveWhtPresetChoice()}
                >
                  {whtPresetSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  บันทึก
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={accountingVatDialogOpen} onOpenChange={setAccountingVatDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>แก้ไขภาษีมูลค่าเพิ่ม (บัญชี)</DialogTitle>
              <DialogDescription className="text-sm leading-relaxed">
                ใช้หลังสโตร์ส่งใบมาแล้ว — เลือกให้ตรงกับใบกำกับภาษี/ใบวางบิลจริง · «ตาม PO» ล้างการทับและคำนวณจากยอดภาษีใน PO
                เหมือนเดิม
              </DialogDescription>
            </DialogHeader>
            <RadioGroup
              value={accountingVatDraft}
              onValueChange={(v) => setAccountingVatDraft(v as AccountingVatDraft)}
              className="gap-3 py-2"
            >
              {(
                [
                  { id: 'AUTO' as const, title: 'ตาม PO (ค่าเริ่มต้น)', detail: 'ไม่ทับ — ใช้สัดส่วนภาษีจากใบสั่งซื้อ' },
                  { id: 'NONE' as const, title: 'ไม่มีภาษีมูลค่าเพิ่ม', detail: 'ทั้งยอดในใบนี้เป็นฐานก่อนภาษี (ไม่แยก VAT)' },
                  {
                    id: 'VAT_7' as const,
                    title: 'มี VAT 7% — แยกภาษี',
                    detail: 'ยอดรวมในใบ = ก่อนภาษี + VAT (ใช้สำหรับแยกฐานหัก ณ ที่จ่าย)',
                  },
                  {
                    id: 'VAT_7_INCLUSIVE' as const,
                    title: 'มี VAT 7% — ภาษีในตัว',
                    detail: 'ยอดรวมในใบรวม VAT แล้ว — แยกฐาน/ภาษีด้วย gross÷1.07',
                  },
                ] as const
              ).map((opt) => (
                <label
                  key={opt.id}
                  className="flex cursor-pointer items-start gap-3 rounded-md border border-muted bg-muted/20 px-3 py-2.5 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
                >
                  <RadioGroupItem value={opt.id} id={`acc-vat-${opt.id}`} className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold leading-tight">{opt.title}</span>
                    <span className="text-xs text-muted-foreground">{opt.detail}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={accountingVatSaving}
                onClick={() => setAccountingVatDialogOpen(false)}
              >
                ยกเลิก
              </Button>
              <Button
                type="button"
                className="font-semibold"
                disabled={accountingVatSaving}
                onClick={() => void saveAccountingVatOverride()}
              >
                {accountingVatSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                บันทึก
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={accountingWhtDialogOpen} onOpenChange={setAccountingWhtDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>แก้ไขหัก ณ ที่จ่าย (บัญชี)</DialogTitle>
              <DialogDescription className="text-sm leading-relaxed">
                เปิดหรือปิดการหักเฉพาะใบนี้ได้โดยไม่ต้องแก้ PO · เมื่อเปิดหักให้เลือกประเภทตามระบบ (1% / 3% / 5%)
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <RadioGroup
                value={accountingWhtDraftMode}
                onValueChange={(v) => setAccountingWhtDraftMode(v as AccountingWhtDraftMode)}
                className="gap-3"
              >
                <label className="flex cursor-pointer items-start gap-3 rounded-md border border-muted bg-muted/20 px-3 py-2.5 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5">
                  <RadioGroupItem value="inherit" id="acc-wht-inherit" className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold leading-tight">ตาม PO และค่าบนใบเดิม</span>
                    <span className="text-xs text-muted-foreground">ล้างการบังคับบนใบนี้ — กลับไปใช้การตั้งค่าจากใบสั่งซื้อ</span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-3 rounded-md border border-muted bg-muted/20 px-3 py-2.5 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5">
                  <RadioGroupItem value="on" id="acc-wht-on" className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold leading-tight">เปิดหัก ณ ที่จ่าย</span>
                    <span className="text-xs text-muted-foreground">บังคับหักในใบนี้ และเลือกอัตราด้านล่าง</span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-3 rounded-md border border-muted bg-muted/20 px-3 py-2.5 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5">
                  <RadioGroupItem value="off" id="acc-wht-off" className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold leading-tight">ไม่หัก ณ ที่จ่าย</span>
                    <span className="text-xs text-muted-foreground">บังคับไม่หักในใบนี้แม้ PO จะเปิดหักอยู่</span>
                  </span>
                </label>
              </RadioGroup>
              {accountingWhtDraftMode === 'on' ? (
                <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                  <p className="text-xs font-semibold text-muted-foreground">ประเภท / อัตรา</p>
                  <RadioGroup
                    value={accountingWhtDraftPreset}
                    onValueChange={(v) => setAccountingWhtDraftPreset(v as VendorBillWhtPresetCategory)}
                    className="gap-2"
                  >
                    {WHT_PRESET_OPTIONS.map((opt) => (
                      <label
                        key={opt.id}
                        className="flex cursor-pointer items-start gap-3 rounded-md border border-muted bg-background px-3 py-2 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
                      >
                        <RadioGroupItem value={opt.id} id={`acc-wht-preset-${opt.id}`} className="mt-0.5" />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold leading-tight">{opt.title}</span>
                          <span className="text-xs text-muted-foreground">{opt.detail}</span>
                        </span>
                      </label>
                    ))}
                  </RadioGroup>
                </div>
              ) : null}
            </div>
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={accountingWhtSaving}
                onClick={() => setAccountingWhtDialogOpen(false)}
              >
                ยกเลิก
              </Button>
              <Button
                type="button"
                className="font-semibold"
                disabled={accountingWhtSaving}
                onClick={() => void saveAccountingWhtOverride()}
              >
                {accountingWhtSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                บันทึก
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={submitConfirmOpen} onOpenChange={setSubmitConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ส่งใบรับวางบิลให้ฝ่ายบัญชี?</AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <span className="block">
                  ยืนยันว่าตรวจรับสินค้า/งานตามงวดนี้ถูกต้องแล้ว — หลังส่ง แผนกบัญชีจะเห็นรายการในเจ้าหนี้การค้าและบันทึกจ่ายจากใบนี้
                  (เครดิต)
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
              <AlertDialogAction onClick={() => void submitToAccounting()}>ยืนยันส่ง</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppShell>
  );
}
