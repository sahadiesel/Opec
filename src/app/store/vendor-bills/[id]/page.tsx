'use client';

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
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
  User,
  Vendor,
  VendorBillSupportingDocumentLink,
  VendorBillVatTreatmentOverride,
  WithholdingCertificateCopyVariant,
  WithholdingCertificateDocument,
} from '@/lib/types';
import { executeVendorBillPayment } from '@/lib/ops/vendor-bill-payment';
import {
  effectiveVendorBillWhtRatePercent,
  roundMoney2,
  supplierWithholdingOnMilestone,
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
import {
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
  uploadVendorBillWhtProofPdf,
  validateVendorBillPaymentProofPdf,
} from '@/lib/storage/vendor-bill-payment-proofs';

function statusLabel(s: PurchaseVendorBillStatus) {
  if (s === 'DRAFT') return 'ฉบับร่าง';
  if (s === 'SUBMITTED') return 'รอจ่ายเงิน';
  return 'จ่ายแล้ว';
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

type VatModeUi = 'AUTO' | VendorBillVatTreatmentOverride;

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

  const canWhtAccounting = useMemo(() => canCreateVerifyPrintWhtCertificate(currentUser), [currentUser]);
  const canPreviewVendorBillWht = useMemo(
    () => canPreviewVendorBillWhtCertificate(currentUser),
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
  const [whtPaymentProofFile, setWhtPaymentProofFile] = useState<File | null>(null);
  const [createWhtBusy, setCreateWhtBusy] = useState(false);
  const [submittedWhtBusy, setSubmittedWhtBusy] = useState(false);
  const [whtPrintBusy, setWhtPrintBusy] = useState(false);
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);
  /** บัญชีแก้ % หัก ณ ที่จ่ายเฉพาะใบนี้ (ก่อนจ่าย) */
  const [whtRateEditOpen, setWhtRateEditOpen] = useState(false);
  const [whtRateInput, setWhtRateInput] = useState('');
  const [whtRateSaving, setWhtRateSaving] = useState(false);
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

  useEffect(() => {
    if (!bill) return;
    setBillingDate(bill.billingReceivedDate || '');
    setPayDate(bill.plannedPaymentDate || '');
    setNotes(bill.notes || '');
    setVatMode(bill.billVatTreatment ?? 'AUTO');
    setSupportingDelivery(supportingFromBill(bill.supportingDeliveryNote));
    setSupportingTaxInv(supportingFromBill(bill.supportingTaxInvoice));
    setSupportingReceipt(supportingFromBill(bill.supportingMoneyReceipt));
    if (bill.status === 'SUBMITTED') {
      setPayoutEntryDate((d) => d || timestampToHtmlDateValue(Date.now()));
    }
  }, [bill?.id, bill?.status]);

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

  const effectiveWhtRatePercent = useMemo(
    () => (bill && purchase ? effectiveVendorBillWhtRatePercent(bill, purchase) : 0),
    [bill, purchase],
  );
  const poWhtRatePercent = useMemo(() => Number(purchase?.supplierWithholdingRatePercent) || 0, [purchase]);
  const hasBillWhtRateOverride =
    bill?.supplierWithholdingRatePercentBill != null &&
    Number.isFinite(Number(bill.supplierWithholdingRatePercentBill));

  /** ฐานหัก ณ ที่จ่าย — อัตราใช้ override บนใบวางบิล (บัญชีแก้) ถ้ามี ไม่เช่นนั้นใช้จาก PO */
  const withholdingPreview = useMemo(() => {
    if (!purchase?.supplierWithholdingEnabled) return null;
    if (!bill) return null;
    const rate = effectiveVendorBillWhtRatePercent(bill, purchase);
    if (rate < 0.005) return null;
    const grossInclVat =
      linkedMilestone != null
        ? Number(linkedMilestone.amount) || 0
        : Number(bill.billAmount ?? purchase.totalAmount) || 0;
    if (grossInclVat < 0.01) return null;
    return supplierWithholdingOnMilestone(grossInclVat, rate, purchase);
  }, [purchase, linkedMilestone, bill]);

  const canPrintWithholdingSummary = !!withholdingPreview && withholdingPreview.wht > 0.005;

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
    if (withholdingPreview && withholdingPreview.wht > 0.005) return withholdingPreview.netPaid;
    return grossInclVatForBill || grossForPayment;
  }, [withholdingPreview, grossForPayment, grossInclVatForBill]);

  const billFinancialSlice = useMemo(() => {
    if (!purchase || !bill) return null;
    const gross = grossInclVatForBill;
    const poTotal = Number(purchase.totalAmount) || 0;
    const ratio = poTotal > 0.0001 ? Math.min(1, gross / poTotal) : 1;
    const beforeTax = roundMoney2((Number(purchase.amountBeforeTax) || 0) * ratio);
    const vat = roundMoney2((Number(purchase.vatAmount) || 0) * ratio);
    return { gross, beforeTax, vat, ratio };
  }, [purchase, bill, grossInclVatForBill]);

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
    if (!currentUser || !purchase || !bill || !vendor || !withholdingPreview || !canPrintWithholdingSummary) {
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
      grossPaymentAmount: grossInclVatForBill,
      ...(withholdingPreview.wht > 0.005 ? { supplierWithholdingAmount: withholdingPreview.wht } : {}),
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
      const pvErrs = validateWhtCertificateForPreviewPrint(previewDoc, 'COPY_PAYEE_TAX_RETURN');
      if (pvErrs.length) {
        toast({ variant: 'destructive', title: 'พิมพ์ตัวอย่างไม่ได้', description: pvErrs.join(' ') });
        return;
      }
      const html = buildWithholdingCertificateDocumentHtml(previewDoc, {
        copyVariant: 'COPY_PAYEE_TAX_RETURN',
        official: false,
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
  ) => {
    if (!currentUser) return;
    if (official && !canWhtAccounting) {
      toast({
        variant: 'destructive',
        title: 'พิมพ์ทางการไม่ได้',
        description: 'ใช้สิทธิ์เจ้าหน้าที่บัญชีเพื่อพิมพ์สำเนาทางการหลังออกเลขที่แล้ว',
      });
      return;
    }
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
  ) => {
    if (!currentUser) return;
    if (official && !canWhtAccounting) {
      toast({
        variant: 'destructive',
        title: 'พิมพ์ทางการไม่ได้',
        description: 'ใช้สิทธิ์เจ้าหน้าที่บัญชีเพื่อพิมพ์ชุดทางการหลังออกเลขที่แล้ว',
      });
      return;
    }
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

  const whtHubPreviewHtml = useMemo(() => {
    if (!whtHubOpen || !effectiveWhtPrintDoc || !currentUser) return '';
    const actor = currentUser.displayName?.trim() || currentUser.email || currentUser.id;
    const errs = validateWhtCertificateForPreviewPrint(effectiveWhtPrintDoc, 'COPY_PAYEE_TAX_RETURN');
    if (errs.length) return '';
    return buildWithholdingCertificateDocumentHtml(effectiveWhtPrintDoc, {
      copyVariant: 'COPY_PAYEE_TAX_RETURN',
      official: false,
      printedByName: actor,
      printedAtMs: Date.now(),
      ...mergeWhtCertDisplaySettings(companyProfile),
    });
  }, [whtHubOpen, effectiveWhtPrintDoc, currentUser, companyProfile]);

  const openWhtPreviewHub = () => {
    if (!effectiveWhtPrintDoc) {
      toast({
        variant: 'destructive',
        title: 'ไม่มีข้อมูลหัก ณ ที่จ่าย',
        description: 'ใบนี้ไม่เข้าเงื่อนไขพิมพ์หนังสือรับรอง',
      });
      return;
    }
    const errs = validateWhtCertificateForPreviewPrint(effectiveWhtPrintDoc, 'COPY_PAYEE_TAX_RETURN');
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

  const handleCreateWhtCertificate = async () => {
    if (
      !firestore ||
      !billRef ||
      !currentUser ||
      !purchase ||
      !bill ||
      !vendor ||
      !withholdingPreview ||
      !canPrintWithholdingSummary ||
      !payoutCashbook
    ) {
      toast({
        variant: 'destructive',
        title: 'สร้างไม่ได้',
        description: 'ต้องมีรายการจ่าย (cashbook) และข้อมูลครบหลังบันทึกจ่ายแล้ว',
      });
      return;
    }
    setCreateWhtBusy(true);
    try {
      const actor = currentUser.displayName?.trim() || currentUser.email || currentUser.id;
      const draft = buildWithholdingCertificateDraft({
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
      draft.createdByUid = currentUser.id;
      draft.createdByName = actor;

      const certRef = doc(collection(firestore, 'withholding_certificate_documents'));
      const batch = writeBatch(firestore);
      batch.set(certRef, stripUndefinedForFirestore({ id: certRef.id, ...draft }));
      batch.update(billRef, {
        whtCertificateDocumentId: certRef.id,
        updatedAt: Date.now(),
      });
      const logRef = doc(
        collection(firestore, 'withholding_certificate_documents', certRef.id, 'audit_logs'),
      );
      batch.set(
        logRef,
        stripUndefinedForFirestore({
          id: logRef.id,
          ...buildWhtAuditLogEntry({
            documentId: certRef.id,
            action: 'CREATE_WHT',
            actorId: currentUser.id,
            actorName: actor,
            payloadSummary: { sourceVendorBillId: bill.id },
          }),
        }),
      );
      await batch.commit();
      toast({
        title: 'สร้างหนังสือรับรองแล้ว',
        description: 'เปิดหน้ารายละเอียดเพื่อตรวจสอบและออกเลขที่',
      });
    } catch (e) {
      console.error(e);
      toast({
        variant: 'destructive',
        title: 'สร้างไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setCreateWhtBusy(false);
    }
  };

  const buildVendorBillDetailPayload = (): Record<string, unknown> => {
    if (!bill) return {};
    const prNo = bill.purchaseRequestNo?.trim() || purchaseRequest?.requestNo?.trim();
    return {
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
  };

  const saveDraft = async () => {
    if (!billRef || !bill || bill.status !== 'DRAFT') return;
    await updateDocumentNonBlocking(billRef, buildVendorBillDetailPayload());
    toast({ title: 'บันทึกฉบับร่างแล้ว' });
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
    const now = Date.now();
    await updateDocumentNonBlocking(billRef, {
      ...buildVendorBillDetailPayload(),
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
      description: 'อยู่ในคิว «ตรวจสอบรายจ่าย» และเจ้าหนี้การค้า (เครดิต)',
    });
  };

  const saveBillWhtRateOverride = async () => {
    if (!billRef || !bill || bill.status !== 'SUBMITTED' || !canPay) return;
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
    if (!billRef || !bill || bill.status !== 'SUBMITTED' || !canPay) return;
    setWhtRateSaving(true);
    try {
      await updateDocumentNonBlocking(billRef, {
        supplierWithholdingRatePercentBill: deleteField(),
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

  const markPaid = async () => {
    if (!firestore || !billRef || !bill || !purchase || !purchaseRef || bill.status !== 'SUBMITTED') {
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
      toast({ variant: 'destructive', title: 'แนบหลักฐานการจ่าย (PDF)', description: 'จำเป็นตอนยืนยันจ่าย' });
      return;
    }
    const proofErr = validateVendorBillPaymentProofPdf(paymentProofFile);
    if (proofErr) {
      toast({ variant: 'destructive', title: 'ไฟล์ไม่ถูกต้อง', description: proofErr });
      return;
    }
    if (
      withholdingPreview &&
      withholdingPreview.wht > 0.005 &&
      whtPaymentProofFile
    ) {
      const whtErr = validateVendorBillPaymentProofPdf(whtPaymentProofFile);
      if (whtErr) {
        toast({ variant: 'destructive', title: 'ไฟล์หัก ณ ที่จ่ายไม่ถูกต้อง', description: whtErr });
        return;
      }
    }
    setPaying(true);
    try {
      const proof = await uploadVendorBillPaymentProofPdf(
        firebaseApp,
        bill.id,
        currentUser.id,
        paymentProofFile
      );
      let whtProof: { downloadUrl: string; fileName: string } | undefined;
      if (
        withholdingPreview &&
        withholdingPreview.wht > 0.005 &&
        whtPaymentProofFile
      ) {
        whtProof = await uploadVendorBillWhtProofPdf(
          firebaseApp,
          bill.id,
          currentUser.id,
          whtPaymentProofFile,
        );
      }
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
        ...(whtProof
          ? { whtPaymentProofUrl: whtProof.downloadUrl, whtPaymentProofFileName: whtProof.fileName }
          : {}),
      });
      toast({
        title: 'บันทึกจ่ายแล้ว',
        description:
          createdWhtCertificateId != null
            ? `Cashbook ${cashbookEntryNo} · หักยอดบัญชีธนาคารแล้ว · สร้างหนังสือรับรองหัก ณ ที่จ่าย (ร่าง) อัตโนมัติแล้ว`
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

  const effectivePurchaseType = bill.purchaseType ?? purchase?.purchaseType;
  const isCashPo = effectivePurchaseType === 'CASH';

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/store/vendor-bills">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-primary">{bill.receiptNo}</h1>
            <p className="text-sm text-muted-foreground">
              ใบสั่งซื้อ {bill.purchaseNo || bill.purchaseId} · {vendor?.vendorName || '—'}
            </p>
          </div>
          <Badge className="ml-auto">{statusLabel(bill.status)}</Badge>
        </div>

        {bill.status === 'PAID' && bill.cashbookEntryNo && (
          <Card className="border-green-200 bg-green-50/40">
            <CardHeader className="pb-2">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <CardTitle className="text-base text-green-900">ลงสมุด cashbook แล้ว</CardTitle>
                  <CardDescription className="space-y-1 text-green-800">
                    <p>
                      เลขที่รายการ: <span className="font-mono font-bold">{bill.cashbookEntryNo}</span>
                    </p>
                    {(bill.paymentProofUrl || bill.whtPaymentProofUrl) && (
                      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
                        {bill.paymentProofUrl ? (
                          <p className="m-0">
                            หลักฐานการจ่าย:{' '}
                            <a
                              href={bill.paymentProofUrl}
                              className="font-semibold text-primary underline"
                              target="_blank"
                              rel="noreferrer"
                            >
                              {bill.paymentProofFileName || 'เปิด PDF'}
                            </a>
                          </p>
                        ) : null}
                        {bill.whtPaymentProofUrl ? (
                          <p className="m-0">
                            หลักฐานหัก ณ ที่จ่าย:{' '}
                            <a
                              href={bill.whtPaymentProofUrl}
                              className="font-semibold text-primary underline"
                              target="_blank"
                              rel="noreferrer"
                            >
                              {bill.whtPaymentProofFileName || 'เปิด PDF'}
                            </a>
                          </p>
                        ) : null}
                      </div>
                    )}
                  </CardDescription>
                </div>
                {canPrintWithholdingSummary && canPreviewVendorBillWht && effectiveWhtPrintDoc ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="shrink-0 gap-2 border-green-700/30 bg-white hover:bg-green-100/80 text-green-950 font-semibold"
                    onClick={() => openWhtPreviewHub()}
                  >
                    <Eye className="h-4 w-4" />
                    พรีวิวเอกสารหัก ณ ที่จ่าย
                  </Button>
                ) : null}
              </div>
            </CardHeader>
          </Card>
        )}

        {bill.status === 'PAID' && canPrintWithholdingSummary && purchase && vendor && canWhtAccounting && (
            <Card className="border-violet-200 bg-violet-50/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-5 w-5 text-violet-800" />
                  หนังสือรับรองการหักภาษี ณ ที่จ่าย (มาตรา 50 ทวิ)
                </CardTitle>
                <CardDescription className="text-violet-950/85">
                  สร้างจากข้อมูลจ่ายเงินและใบวางบิลนี้เท่านั้น — ออกเลขที่ (ISSUED) ในหน้าบัญชี · พิมพ์และพรีวิวชุดสำเนาใช้ปุ่มในแถบเขียว
                  «พรีวิวเอกสารหัก ณ ที่จ่าย» ด้านบน
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {!bill.cashbookEntryId ? (
                  <p className="text-sm text-amber-800">
                    ใบวางบิลนี้ยังไม่มี <code className="text-xs bg-muted px-1 rounded">cashbookEntryId</code> — ติดต่อผู้ดูแลระบบ
                  </p>
                ) : payoutCashbookLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    กำลังโหลดรายการ cashbook…
                  </div>
                ) : !payoutCashbook ? (
                  <p className="text-sm text-destructive">
                    โหลดรายการ cashbook ไม่สำเร็จ (เลขที่ {bill.cashbookEntryNo || bill.cashbookEntryId})
                  </p>
                ) : !bill.whtCertificateDocumentId ? (
                  <Button
                    className="font-bold gap-2"
                    disabled={createWhtBusy}
                    onClick={() => void handleCreateWhtCertificate()}
                  >
                    {createWhtBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                    สร้างหนังสือรับรองหัก ณ ที่จ่าย
                  </Button>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2 items-center">
                      <Button variant="outline" asChild className="gap-2">
                        <Link href={`/accounting/wht-certificates/${bill.whtCertificateDocumentId}`}>
                          <ExternalLink className="h-4 w-4" />
                          ดูเอกสาร / ตรวจสอบ / ออกเลขที่
                        </Link>
                      </Button>
                      <Badge variant={whtCertificate?.documentStatus === 'ISSUED' ? 'default' : 'secondary'}>
                        {whtCertificate?.documentStatus ?? '—'}
                      </Badge>
                    </div>
                    {effectiveWhtPrintDoc && whtCertificate && whtCertificate.documentStatus !== 'CANCELLED' ? (
                      <p className="text-sm text-violet-950/90 leading-relaxed">
                        <strong>พิมพ์ / พรีวิว:</strong> ใช้ปุ่ม{' '}
                        <strong>พรีวิวเอกสารหัก ณ ที่จ่าย</strong> ในการ์ดสีเขียว «ลงสมุด cashbook แล้ว» ด้านบน
                        เพื่อดูตัวอย่างและเลือกชุดสำเนาตามรายการ (ผู้ถูกหัก · ผู้หัก · ตัวอย่างหรือทางการหลัง ISSUED)
                      </p>
                    ) : null}
                    {whtCertificate && whtCertificate.documentStatus !== 'CANCELLED' && (
                      <p className="text-[11px] text-muted-foreground">
                        ยกเลิกเอกสารหรือเตรียม XML — ใช้ปุ่มในหน้ารายละเอียด (สิทธิ์ผู้จัดการบัญชี)
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          )}

        {bill.status === 'SUBMITTED' && purchase && purchaseRef && (
          <>
            {!isCashPo && (
              <Card className="border-blue-200 bg-blue-50/40">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <ClipboardCheck className="h-5 w-5 text-blue-800" /> ใบสั่งซื้อแบบเครดิต
                  </CardTitle>
                  <CardDescription className="text-blue-950/90 space-y-2">
                    <p>
                      รายการนี้อยู่ใน{' '}
                      <Link href="/accounting/outgoing-review" className="font-semibold underline">
                        ตรวจสอบรายจ่าย
                      </Link>{' '}
                      และ{' '}
                      <Link href="/accounts-payable" className="font-semibold underline">
                        เจ้าหนี้การค้า
                      </Link>{' '}
                      แล้ว — เมื่อถึงกำหนดชำระให้บันทึกจ่ายด้านล่าง (ลง cashbook และปิดเจ้าหนี้)
                    </p>
                  </CardDescription>
                </CardHeader>
              </Card>
            )}
            {bill.status === 'SUBMITTED' && canPay && (
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
                        {purchase?.supplierWithholdingEnabled
                          ? ' (ส่วนหัก ณ ที่จ่ายสะสมที่เมนูรายการหัก ณ ที่จ่าย ไม่ตัดบัญชีตอนโอน)'
                          : ''}
                        {' — แนะนำทำจากเมนู '}
                        <Link href="/accounting/outgoing-review" className="font-semibold underline">
                          ตรวจสอบรายจ่าย
                        </Link>{' '}
                        หรือดำเนินการที่นี่
                      </>
                    ) : (
                      <>
                        เมื่อถึงวันจ่ายจริง ให้กดจ่ายที่นี่ — ระบบจะลง cashbook ปิดเจ้าหนี้ และอัปเดตงวด PO
                      </>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
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
                  <div className="space-y-2 min-w-0">
                    <Label>แนบหลักฐานการจ่าย (PDF)</Label>
                    <Input
                      type="file"
                      accept="application/pdf"
                      className="h-11 cursor-pointer"
                      onChange={(e) => setPaymentProofFile(e.target.files?.[0] ?? null)}
                    />
                    {paymentProofFile && (
                      <p className="text-xs text-muted-foreground">เลือก: {paymentProofFile.name}</p>
                    )}
                  </div>
                  {withholdingPreview && withholdingPreview.wht > 0.005 ? (
                    <div className="space-y-2 min-w-0 rounded-md border border-violet-200/80 bg-violet-50/40 px-3 py-3 dark:bg-violet-950/20 dark:border-violet-900/50">
                      <Label>แนบหลักฐานหัก ณ ที่จ่าย (PDF) — ถ้ามี</Label>
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        แยกจากสลิปโอน — เก็บคู่เลขที่รายการ cashbook เพื่อตรวจสอบภาษี
                      </p>
                      <Input
                        type="file"
                        accept="application/pdf"
                        className="h-11 cursor-pointer bg-background"
                        onChange={(e) => setWhtPaymentProofFile(e.target.files?.[0] ?? null)}
                      />
                      {whtPaymentProofFile && (
                        <p className="text-xs text-muted-foreground">เลือก: {whtPaymentProofFile.name}</p>
                      )}
                    </div>
                  ) : null}
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
                      {withholdingPreview && withholdingPreview.wht > 0.005 ? (
                        <div className="text-[11px] text-muted-foreground leading-snug space-y-1">
                          <p>
                            ยอดงวด (รวม VAT) ฿
                            {grossInclVatForBill.toLocaleString(undefined, { minimumFractionDigits: 2 })} — หัก ณ ที่จ่าย ฿
                            {withholdingPreview.wht.toLocaleString(undefined, { minimumFractionDigits: 2 })} (
                            {effectiveWhtRatePercent}%) ไม่ตัดจากบัญชีตอนโอน — สะสมที่{' '}
                            <Link href="/accounting/withholding-tax" className="font-semibold text-primary underline">
                              รายการหัก ณ ที่จ่าย
                            </Link>{' '}
                            เพื่อสรุปนำส่งสรรพากร
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
                    {canPrintWithholdingSummary && canPreviewVendorBillWht ? (
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
                  {canPrintWithholdingSummary && canPreviewVendorBillWht ? (
                    <p className="text-[11px] text-muted-foreground leading-snug">
                      ปุ่มขวาพิมพ์ตัวอย่างก่อนจ่าย (มีข้อความฉบับร่าง) • เลขที่และสำเนาทางการหลังบันทึกจ่ายจากการ์ด «หนังสือรับรองหัก ณ ที่จ่าย»
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
                <p className="text-xs font-semibold text-muted-foreground">การแสดงภาษีมูลค่าเพิ่มในใบวางบิล</p>
                <p className="font-medium">
                  {displayedVatTreatment === 'VAT_7'
                    ? 'มีภาษีมูลค่าเพิ่ม (อัตรา 7%) ในยอดอ้างอิงนี้'
                    : 'ไม่มีภาษีมูลค่าเพิ่มในยอดอ้างอิงนี้ / ยอดก่อนภาษี'}
                </p>
                {billFinancialSlice && displayedVatTreatment === 'NONE' && billFinancialSlice.vat > 0.005 ? (
                  <p className="text-xs text-amber-900 dark:text-amber-200 mt-1 leading-snug">
                    หมายเหตุ: เลือกว่าไม่มีภาษี แต่ส่วนที่จัดสรรจาก PO ยังมียอดภาษี — ควรตรวจให้ตรงกับเอกสารคู่ค้า
                  </p>
                ) : null}
                {billFinancialSlice && displayedVatTreatment === 'VAT_7' && billFinancialSlice.vat < 0.005 ? (
                  <p className="text-xs text-amber-900 dark:text-amber-200 mt-1 leading-snug">
                    หมายเหตุ: เลือกว่ามี VAT แต่ส่วนที่จัดสรรจาก PO ไม่มียอดภาษี — ควรตรวจให้ตรงกับเอกสารคู่ค้า
                  </p>
                ) : null}
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
                <div className="rounded-md border border-violet-200/80 bg-violet-50/30 px-3 py-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <p className="text-xs font-semibold text-violet-950">หัก ณ ที่จ่าย (ผู้รับเงิน)</p>
                      <p className="text-sm">
                        อัตรา {effectiveWhtRatePercent}%
                        {hasBillWhtRateOverride ? (
                          <span className="text-muted-foreground">
                            {' '}
                            (PO ลง {poWhtRatePercent}% — แก้เฉพาะใบนี้)
                          </span>
                        ) : null}{' '}
                        · ฐานก่อนภาษี (ประมาณการ) ฿
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
                    {canPay && bill.status === 'SUBMITTED' && purchase?.supplierWithholdingEnabled ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0 gap-1.5 border-violet-300 bg-white/90 font-semibold text-violet-950 hover:bg-violet-100/80"
                        onClick={() => {
                          setWhtRateInput(String(effectiveWhtRatePercent));
                          setWhtRateEditOpen(true);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        แก้ไข %
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground text-xs leading-relaxed">
                  ไม่มีหัก ณ ที่จ่ายตามการตั้งค่า PO/คู่ค้า — ยอดที่ต้องจ่ายให้คู่ค้าเท่ากับยอดรวมในใบวางบิลด้านบน
                </p>
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
                      ระบุว่ามีภาษีมูลค่าเพิ่ม 7%
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
                    {bill.status === 'SUBMITTED' ? 'ยังไม่จ่าย' : '—'}
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
                ด้านซ้ายแสดงตัวอย่างฉบับที่ 1 (ผู้ถูกหัก — ยื่นภาษี) · ด้านขวาเลือกชุดสำเนาแล้วกดพิมพ์ ระบบจะเปิดหน้าต่างและเรียกกล่องพิมพ์ของเบราว์เซอร์
                {effectiveWhtPrintDoc?.documentStatus !== 'ISSUED'
                  ? ' · พิมพ์ทางการ (ต้นฉบับ/สำเนาพร้อมเลขที่) ใช้ได้เมื่อออก ISSUED ในหน้าบัญชีแล้ว'
                  : null}
              </DialogDescription>
            </DialogHeader>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t lg:flex-row">
              <div className="flex min-h-[220px] flex-1 flex-col border-b bg-muted/30 lg:min-h-[min(480px,58vh)] lg:w-[58%] lg:max-w-[58%] lg:border-b-0 lg:border-r">
                {whtHubPreviewHtml ? (
                  <iframe
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
                  <Separator />
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      พิมพ์ตัวอย่าง (ฉบับร่าง)
                    </p>
                    <ul className="space-y-2">
                      <li>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-auto w-full justify-start whitespace-normal py-2.5 text-left font-normal"
                          disabled={whtPrintBusy || !effectiveWhtPrintDoc}
                          onClick={() =>
                            effectiveWhtPrintDoc &&
                            void runWhtCertificatePrint(
                              effectiveWhtPrintDoc,
                              'COPY_PAYEE_TAX_RETURN',
                              false,
                            )
                          }
                        >
                          <Printer className="mr-2 h-4 w-4 shrink-0 opacity-70" />
                          <span>
                            <span className="block font-semibold">ฉบับที่ 1 — ผู้ถูกหัก (ยื่นภาษี)</span>
                            <span className="text-xs text-muted-foreground">สำเนาสำหรับยื่นแบบภาษี</span>
                          </span>
                        </Button>
                      </li>
                      <li>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-auto w-full justify-start whitespace-normal py-2.5 text-left font-normal"
                          disabled={whtPrintBusy || !effectiveWhtPrintDoc}
                          onClick={() =>
                            effectiveWhtPrintDoc &&
                            void runWhtCertificatePrint(effectiveWhtPrintDoc, 'COPY_PAYEE_RECORD', false)
                          }
                        >
                          <Printer className="mr-2 h-4 w-4 shrink-0 opacity-70" />
                          <span>
                            <span className="block font-semibold">ฉบับที่ 2 — ผู้ถูกหัก (เก็บเป็นหลักฐาน)</span>
                            <span className="text-xs text-muted-foreground">สำเนาเก็บรักษา</span>
                          </span>
                        </Button>
                      </li>
                      <li>
                        <Button
                          type="button"
                          variant="secondary"
                          className="h-auto w-full justify-start whitespace-normal py-2.5 text-left font-normal"
                          disabled={whtPrintBusy || !effectiveWhtPrintDoc}
                          onClick={() =>
                            effectiveWhtPrintDoc &&
                            void runWhtCertificatePayeeCopies12Print(effectiveWhtPrintDoc, false)
                          }
                        >
                          <Printer className="mr-2 h-4 w-4 shrink-0 opacity-70" />
                          <span>
                            <span className="block font-semibold">ชุดฉบับที่ 1 + 2 — ผู้ถูกหัก (ไฟล์เดียว)</span>
                            <span className="text-xs text-muted-foreground">สองหน้าในหน้าต่างเดียว</span>
                          </span>
                        </Button>
                      </li>
                      <li>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-auto w-full justify-start whitespace-normal py-2.5 text-left font-normal"
                          disabled={whtPrintBusy || !effectiveWhtPrintDoc}
                          onClick={() =>
                            effectiveWhtPrintDoc &&
                            void runWhtCertificatePrint(effectiveWhtPrintDoc, 'COPY_PAYER_RECORD', false)
                          }
                        >
                          <Printer className="mr-2 h-4 w-4 shrink-0 opacity-70" />
                          <span>
                            <span className="block font-semibold">สำเนาผู้หัก</span>
                            <span className="text-xs text-muted-foreground">เก็บเป็นหลักฐานฝั่งผู้จ่าย</span>
                          </span>
                        </Button>
                      </li>
                    </ul>
                  </div>
                  {effectiveWhtPrintDoc?.documentStatus === 'ISSUED' && canWhtAccounting ? (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          พิมพ์ทางการ (ต้นฉบับ / สำเนา — มีเลขที่)
                        </p>
                        <ul className="space-y-2">
                          <li>
                            <Button
                              type="button"
                              className="h-auto w-full justify-start whitespace-normal py-2.5 text-left font-normal"
                              disabled={whtPrintBusy || !effectiveWhtPrintDoc}
                              onClick={() =>
                                effectiveWhtPrintDoc &&
                                void runWhtCertificatePrint(
                                  effectiveWhtPrintDoc,
                                  'COPY_PAYEE_TAX_RETURN',
                                  true,
                                )
                              }
                            >
                              <Printer className="mr-2 h-4 w-4 shrink-0" />
                              <span>
                                <span className="block font-semibold">ฉบับที่ 1 — ผู้ถูกหัก (ทางการ)</span>
                                <span className="text-xs opacity-90">ยื่นภาษี</span>
                              </span>
                            </Button>
                          </li>
                          <li>
                            <Button
                              type="button"
                              className="h-auto w-full justify-start whitespace-normal py-2.5 text-left font-normal"
                              disabled={whtPrintBusy || !effectiveWhtPrintDoc}
                              onClick={() =>
                                effectiveWhtPrintDoc &&
                                void runWhtCertificatePrint(effectiveWhtPrintDoc, 'COPY_PAYEE_RECORD', true)
                              }
                            >
                              <Printer className="mr-2 h-4 w-4 shrink-0" />
                              <span>
                                <span className="block font-semibold">ฉบับที่ 2 — ผู้ถูกหัก (ทางการ)</span>
                                <span className="text-xs opacity-90">เก็บหลักฐาน</span>
                              </span>
                            </Button>
                          </li>
                          <li>
                            <Button
                              type="button"
                              variant="secondary"
                              className="h-auto w-full justify-start whitespace-normal py-2.5 text-left font-semibold"
                              disabled={whtPrintBusy || !effectiveWhtPrintDoc}
                              onClick={() =>
                                effectiveWhtPrintDoc &&
                                void runWhtCertificatePayeeCopies12Print(effectiveWhtPrintDoc, true)
                              }
                            >
                              <Printer className="mr-2 h-4 w-4 shrink-0" />
                              <span>
                                <span className="block">ชุดฉบับที่ 1 + 2 — ทางการ (ไฟล์เดียว / PDF)</span>
                                <span className="text-xs font-normal opacity-90">ผู้ถูกหัก</span>
                              </span>
                            </Button>
                          </li>
                          <li>
                            <Button
                              type="button"
                              variant="outline"
                              className="h-auto w-full justify-start whitespace-normal py-2.5 text-left font-normal"
                              disabled={whtPrintBusy || !effectiveWhtPrintDoc}
                              onClick={() =>
                                effectiveWhtPrintDoc &&
                                void runWhtCertificatePrint(effectiveWhtPrintDoc, 'COPY_PAYER_RECORD', true)
                              }
                            >
                              <Printer className="mr-2 h-4 w-4 shrink-0" />
                              <span>
                                <span className="block font-semibold">สำเนาผู้หัก (ทางการ)</span>
                                <span className="text-xs text-muted-foreground">ผู้จ่ายเงิน</span>
                              </span>
                            </Button>
                          </li>
                        </ul>
                      </div>
                    </>
                  ) : null}
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
                {hasBillWhtRateOverride ? (
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

        <AlertDialog open={submitConfirmOpen} onOpenChange={setSubmitConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ส่งใบรับวางบิลให้ฝ่ายบัญชี?</AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <span className="block">
                  ยืนยันว่าตรวจรับสินค้า/งานตามงวดนี้ถูกต้องแล้ว — หลังส่ง รายการจะไปอยู่ที่ «ตรวจสอบรายจ่าย» และเจ้าหนี้การค้า
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
