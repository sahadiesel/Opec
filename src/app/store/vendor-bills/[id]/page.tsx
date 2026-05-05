'use client';

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ExternalLink, Loader2, Send, Banknote, ClipboardCheck, FileText, Printer } from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useCollection, useFirebaseApp } from '@/firebase';
import { collection, doc, limit, query, setDoc, where, writeBatch } from 'firebase/firestore';
import { updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useAppUser } from '@/hooks/use-app-user';
import {
  canCreateVerifyPrintWhtCertificate,
  canMarkPurchaseVendorBillPaid,
  canView,
} from '@/lib/permissions';
import {
  BankAccount,
  CashbookEntry,
  PaymentMethod,
  Purchase,
  PurchasePaymentMilestone,
  PurchaseVendorBill,
  PurchaseVendorBillStatus,
  User,
  Vendor,
  WithholdingCertificateCopyVariant,
  WithholdingCertificateDocument,
} from '@/lib/types';
import { executeVendorBillPayment } from '@/lib/ops/vendor-bill-payment';
import { supplierWithholdingOnMilestone } from '@/lib/ops/purchase-payment-milestones';
import {
  buildWithholdingCertificateDocumentHtml,
  buildWithholdingCertificatePayeeCopies12Html,
  openWithholdingCertificatePrintWindow,
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
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
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

  useEffect(() => {
    if (!bill) return;
    setBillingDate(bill.billingReceivedDate || '');
    setPayDate(bill.plannedPaymentDate || '');
    setNotes(bill.notes || '');
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

  /** ฐานหัก ณ ที่จ่ายตาม PO — ใช้ยอดงวดถ้ามี milestone */
  const withholdingPreview = useMemo(() => {
    if (!purchase?.supplierWithholdingEnabled) return null;
    const rate = Number(purchase.supplierWithholdingRatePercent) || 0;
    if (rate < 0.005) return null;
    if (!bill) return null;
    const grossInclVat =
      linkedMilestone != null
        ? Number(linkedMilestone.amount) || 0
        : Number(bill.billAmount ?? purchase.totalAmount) || 0;
    if (grossInclVat < 0.01) return null;
    return supplierWithholdingOnMilestone(grossInclVat, rate, purchase);
  }, [purchase, linkedMilestone, bill]);

  const canPrintWithholdingSummary = !!withholdingPreview && withholdingPreview.wht > 0.005;

  /** ตรงกับ executeVendorBillPayment: ตัดธนาคารเฉพาะสุทธิจ่ายคู่ค้า — หัก ณ ที่จ่ายไม่ผ่านบัญชี */
  const bankDebitAmount = useMemo(() => {
    if (withholdingPreview && withholdingPreview.wht > 0.005) return withholdingPreview.netPaid;
    return grossInclVatForBill || grossForPayment;
  }, [withholdingPreview, grossForPayment, grossInclVatForBill]);

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
    if (!canWhtAccounting) return;
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

  const printWhtCertificate = async (variant: WithholdingCertificateCopyVariant, official: boolean) => {
    if (!currentUser || !whtCertificate) return;
    setWhtPrintBusy(true);
    try {
      const actor =
        currentUser.displayName?.trim() || currentUser.email || currentUser.id;
      const errs = official
        ? validateWhtCertificateForOfficialPrint(whtCertificate, variant)
        : validateWhtCertificateForPreviewPrint(whtCertificate, variant);
      if (errs.length) {
        toast({ variant: 'destructive', title: 'พิมพ์ไม่ได้', description: errs.join(' ') });
        return;
      }
      const html = buildWithholdingCertificateDocumentHtml(whtCertificate, {
        copyVariant: variant,
        official,
        printedByName: actor,
        printedAtMs: Date.now(),
        ...mergeWhtCertDisplaySettings(companyProfile),
      });
      openWithholdingCertificatePrintWindow(html);
      if (official && firestore && whtCertRef && whtCertificate.id) {
        try {
          await updateDocumentNonBlocking(whtCertRef, {
            lastPrintedCopyVariant: variant,
            updatedAt: Date.now(),
            updatedByUid: currentUser.id,
            updatedByName: actor,
          });
          const logRef = doc(
            collection(firestore, 'withholding_certificate_documents', whtCertificate.id, 'audit_logs'),
          );
          await setDoc(logRef, {
            id: logRef.id,
            ...buildWhtAuditLogEntry({
              documentId: whtCertificate.id,
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
  const printWhtCertificatePayeeCopies12 = async (official: boolean) => {
    if (!currentUser || !whtCertificate) return;
    setWhtPrintBusy(true);
    try {
      const actor = currentUser.displayName?.trim() || currentUser.email || currentUser.id;
      const errs = validateWhtCertificateForPayeeCopies12Print(whtCertificate, official);
      if (errs.length) {
        toast({ variant: 'destructive', title: 'พิมพ์ไม่ได้', description: errs.join(' ') });
        return;
      }
      const html = buildWithholdingCertificatePayeeCopies12Html(whtCertificate, {
        official,
        printedByName: actor,
        printedAtMs: Date.now(),
        ...mergeWhtCertDisplaySettings(companyProfile),
      });
      openWithholdingCertificatePrintWindow(html);
      if (official && firestore && whtCertRef && whtCertificate.id) {
        try {
          await updateDocumentNonBlocking(whtCertRef, {
            lastPrintedCopyVariant: 'COPY_PAYEE_TAX_RETURN',
            updatedAt: Date.now(),
            updatedByUid: currentUser.id,
            updatedByName: actor,
          });
          const logRef = doc(
            collection(firestore, 'withholding_certificate_documents', whtCertificate.id, 'audit_logs'),
          );
          await setDoc(logRef, {
            id: logRef.id,
            ...buildWhtAuditLogEntry({
              documentId: whtCertificate.id,
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

  const saveDraft = async () => {
    if (!billRef || !bill || bill.status !== 'DRAFT') return;
    await updateDocumentNonBlocking(billRef, {
      billingReceivedDate: billingDate,
      plannedPaymentDate: payDate,
      notes,
      updatedAt: Date.now(),
    });
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
    const now = Date.now();
    await updateDocumentNonBlocking(billRef, {
      billingReceivedDate: billingDate,
      plannedPaymentDate: payDate,
      notes,
      purchaseType: purchase.purchaseType,
      status: 'SUBMITTED' as PurchaseVendorBillStatus,
      submittedToAccountingAt: now,
      updatedAt: now,
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
                  สร้างจากข้อมูลจ่ายเงินและใบวางบิลนี้เท่านั้น — ออกเลขที่และพิมพ์สำเนาทางการได้หลังบันทึก ISSUED
                  ในหน้ารายละเอียด
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
                    {whtCertificate && whtCertificate.documentStatus !== 'CANCELLED' && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={whtPrintBusy}
                          onClick={() => void printWhtCertificate('COPY_PAYEE_TAX_RETURN', false)}
                        >
                          Preview ฉบับที่ 1
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={whtPrintBusy}
                          onClick={() => void printWhtCertificate('COPY_PAYEE_RECORD', false)}
                        >
                          Preview ฉบับที่ 2
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={whtPrintBusy}
                          onClick={() => void printWhtCertificatePayeeCopies12(false)}
                        >
                          Preview ฉบับที่ 1+2 (ไฟล์เดียว)
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={whtPrintBusy}
                          onClick={() => void printWhtCertificate('COPY_PAYER_RECORD', false)}
                        >
                          Preview ผู้หัก
                        </Button>
                      </div>
                    )}
                    {whtCertificate?.documentStatus === 'ISSUED' && (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          className="gap-2"
                          disabled={whtPrintBusy}
                          onClick={() => void printWhtCertificate('COPY_PAYEE_TAX_RETURN', true)}
                        >
                          <Printer className="h-4 w-4" />
                          พิมพ์ฉบับที่ 1
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="gap-2"
                          disabled={whtPrintBusy}
                          onClick={() => void printWhtCertificate('COPY_PAYEE_RECORD', true)}
                        >
                          <Printer className="h-4 w-4" />
                          พิมพ์ฉบับที่ 2
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="gap-2 font-semibold"
                          disabled={whtPrintBusy}
                          onClick={() => void printWhtCertificatePayeeCopies12(true)}
                        >
                          <Printer className="h-4 w-4" />
                          พิมพ์ฉบับที่ 1+2 (ไฟล์เดียว / PDF)
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="gap-2"
                          disabled={whtPrintBusy}
                          onClick={() => void printWhtCertificate('COPY_PAYER_RECORD', true)}
                        >
                          <Printer className="h-4 w-4" />
                          พิมพ์สำเนาผู้หัก
                        </Button>
                      </div>
                    )}
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
                            {purchase?.supplierWithholdingRatePercent}%) ไม่ตัดจากบัญชีตอนโอน — สะสมที่{' '}
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
                    {canPrintWithholdingSummary && canWhtAccounting ? (
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
                  {canPrintWithholdingSummary && canWhtAccounting ? (
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
              <CardTitle className="text-base">อ้างอิงใบสั่งซื้อ</CardTitle>
              <CardDescription className="space-y-1">
                <p>
                  ยอดสุทธิใบสั่งซื้อ ฿{' '}
                  {purchase.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
                {bill.billAmount != null && bill.billAmount > 0 && (
                  <p className="font-semibold text-foreground">
                    ยอดในใบรับวางบิลนี้ ฿{' '}
                    {bill.billAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </p>
                )}
                {linkedMilestone && (
                  <p>
                    งวดชำระ #{linkedMilestone.sequence}: {linkedMilestone.label}
                  </p>
                )}
              </CardDescription>
            </CardHeader>
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
