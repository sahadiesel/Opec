'use client';

import { useState, use, useRef, useMemo, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  ArrowLeft,
  FileBadge,
  Building2,
  Calendar,
  Info,
  Loader2,
  Printer,
  XCircle,
  CheckCircle2,
  ImagePlus,
  Trash2,
  ExternalLink,
  UserCheck,
  Pencil,
  Paperclip,
  AlertTriangle,
  FileText,
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useUser, useFirebaseApp, useCollection } from '@/firebase';
import { doc, collection, updateDoc, addDoc } from 'firebase/firestore';
import { updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import {
  TaxInvoice,
  TaxInvoiceStatus,
  User,
  Customer,
  BillingNote,
  BillingNoteLine,
  TaxInvoiceTimesheetAttachment,
  CommercialInvoice,
  BankAccount,
} from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  formatDateTimeThaiBE,
  formatStoredDateThaiBE,
  htmlDateValueToTimestampMs,
  timestampToHtmlDateValue,
} from '@/lib/date-thai';
import { useAppUser } from '@/hooks/use-app-user';
import { isSystemAdmin } from '@/lib/permission-core';
import { isSimpleAccounting } from '@/lib/simple-tier-model';
import { canRecordTaxInvoiceBillingCustomerApproval } from '@/lib/permissions';
import { generateNextDocumentCode } from '@/lib/services/numbering-service';
import { closeOpenCommercialArNow } from '@/lib/services/accounts-receivable-reconcile-service';
import {
  reconcileTaxInvoiceArIfPaid,
} from '@/lib/services/reconcile-stale-ar-from-receipts';
import { recordTaxInvoiceBillingCustomerApproval } from '@/lib/services/tax-invoice-billing-approval-service';
import { cancelTaxInvoiceAsAccounting } from '@/lib/services/tax-invoice-delete-service';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  uploadTaxInvoiceTimesheetImage,
  deleteTaxInvoiceAttachmentFile,
  validateTimesheetImageFile,
} from '@/lib/storage/tax-invoice-attachments';
import {
  uploadTaxInvoiceWhtFile,
  deleteTaxInvoiceWhtFile,
  validateTaxInvoiceWhtFile,
} from '@/lib/storage/tax-invoice-wht-attachments';
import {
  buildTaxInvoicePrintHtml,
  openStandardPrintWindow,
  type TaxInvoicePrintSheet,
} from '@/lib/documents/standard-document-print';
import {
  recordTaxInvoicePaymentNotification,
  confirmPaymentAndIssueMoneyReceipt,
  expectedMoneyReceiptAmount,
} from '@/lib/services/money-receipt-service';
import { useDocumentPrintLocale } from '@/hooks/use-document-print-locale';
import { DocumentPrintLocaleToggle } from '@/components/documents/document-print-locale-toggle';
import { TaxInvoiceLinesTable } from '@/components/documents/tax-invoice-lines-table';
import { Checkbox } from '@/components/ui/checkbox';
import { roundMoney2 } from '@/lib/ops/purchase-payment-milestones';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

const ACCOUNTING_TAX_INVOICE_PRINT_PRESETS: Record<
  'p1' | 'p2' | 'p3' | 'p4',
  { sheets: TaxInvoicePrintSheet[]; label: string }
> = {
  p1: { sheets: ['original', 'copy'], label: 'ต้นฉบับ 1 แผ่น + สำเนา 1 แผ่น' },
  p2: { sheets: ['original', 'copy', 'copy'], label: 'ต้นฉบับ 1 แผ่น + สำเนา 2 แผ่น' },
  p3: { sheets: ['copy'], label: 'สำเนา 1 แผ่น' },
  p4: { sheets: ['copy', 'copy'], label: 'สำเนา 2 แผ่น' },
};

export default function TaxInvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { currentUser, isLoading: appUserLoading } = useAppUser();
  const { user: authUser } = useUser();
  const firebaseApp = useFirebaseApp();
  const firestore = useFirestore();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const whtFileInputRef = useRef<HTMLInputElement>(null);

  const [issuing, setIssuing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [whtUploading, setWhtUploading] = useState(false);
  const [whtRemovingId, setWhtRemovingId] = useState<string | null>(null);
  const [whtPreviewAtt, setWhtPreviewAtt] = useState<TaxInvoiceTimesheetAttachment | null>(null);
  const [billingApproveOpen, setBillingApproveOpen] = useState(false);
  const [billingApproveNote, setBillingApproveNote] = useState('');
  const [billingApproving, setBillingApproving] = useState(false);
  const [payNotifyLoading, setPayNotifyLoading] = useState(false);
  const [payConfirmLoading, setPayConfirmLoading] = useState(false);
  const [payConfirmOpen, setPayConfirmOpen] = useState(false);
  const [payConfirmAmountStr, setPayConfirmAmountStr] = useState('');
  const [payConfirmEntryDate, setPayConfirmEntryDate] = useState('');
  const [payConfirmBankId, setPayConfirmBankId] = useState('');
  const [editInvoiceOpen, setEditInvoiceOpen] = useState(false);
  const [editShowWht, setEditShowWht] = useState(false);
  const [savingInvoiceEdit, setSavingInvoiceEdit] = useState(false);
  const [editNotesOpen, setEditNotesOpen] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [printPresetOpen, setPrintPresetOpen] = useState(false);
  const [accountingPrintPreset, setAccountingPrintPreset] = useState<'p1' | 'p2' | 'p3' | 'p4'>('p1');
  const arReconcileAttempted = useRef(false);

  const invRef = useMemoFirebase(() => (firestore ? doc(firestore, 'tax_invoices', id) : null), [firestore, id]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: invoice, isLoading: isInvLoading } = useDoc<TaxInvoice>(invRef as any);

  const showWhtBlock = useMemo(() => {
    if (!invoice) return false;
    const w = Number(invoice.withholdingTaxAmount) || 0;
    return invoice.showWithholdingOnDocument === true && w > 0.005;
  }, [invoice]);

  const netAfterWht = useMemo(() => {
    if (!invoice) return 0;
    const w = Number(invoice.withholdingTaxAmount) || 0;
    return roundMoney2(invoice.totalAmount - w);
  }, [invoice]);

  const whtRateDisplay = Number(invoice?.withholdingTaxRatePercentOnDocument ?? 3);

  const customerRef = useMemoFirebase(
    () => (firestore && invoice ? doc(firestore, 'customers', invoice.customerId) : null),
    [firestore, invoice?.customerId]
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: customer } = useDoc<Customer>(customerRef as any);

  const sourceCommercialRef = useMemoFirebase(
    () =>
      firestore && invoice?.sourceCommercialInvoiceId
        ? doc(firestore, 'commercial_invoices', invoice.sourceCommercialInvoiceId)
        : null,
    [firestore, invoice?.sourceCommercialInvoiceId]
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: sourceCommercial } = useDoc<CommercialInvoice>(sourceCommercialRef as any);

  const billingNoteRef = useMemoFirebase(
    () => (firestore && invoice ? doc(firestore, 'billing_notes', invoice.billingNoteId) : null),
    [firestore, invoice?.billingNoteId]
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: billingNote } = useDoc<BillingNote>(billingNoteRef as any);

  const billingLinesQuery = useMemoFirebase(
    () =>
      firestore && invoice
        ? collection(firestore, 'billing_notes', invoice.billingNoteId, 'lines')
        : null,
    [firestore, invoice?.billingNoteId]
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: billingLines } = useCollection<BillingNoteLine>(billingLinesQuery as any);

  const companyProfileRef = useMemoFirebase(
    () => (firestore ? doc(firestore, 'system', 'company_profile') : null),
    [firestore]
  );
  const { data: companyProfile } = useDoc<{
    companyNameTh?: string;
    companyNameEn?: string;
    taxId?: string;
    phone?: string;
    email?: string;
    addressLine1?: string;
    addressLine2?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }>(companyProfileRef as any);

  const { printLocale, setPrintLocale } = useDocumentPrintLocale();

  const isAccountingActor =
    !!currentUser && (isSystemAdmin(currentUser) || isSimpleAccounting(currentUser));

  useEffect(() => {
    if (!firestore || !invoice || !isAccountingActor || arReconcileAttempted.current) return;
    if (invoice.status !== 'ISSUED') return;

    arReconcileAttempted.current = true;
    void (async () => {
      try {
        let fixedCommercial = false;
        if (invoice.sourceCommercialInvoiceId) {
          fixedCommercial = await closeOpenCommercialArNow(firestore, invoice.sourceCommercialInvoiceId);
        }

        if (invoice.linkedReceiptId) {
          const { fixed, fixedTaxAr, fixedCommercialAr } = await reconcileTaxInvoiceArIfPaid(
            firestore,
            invoice,
          );
          if (fixed || fixedCommercial) {
            toast({
              title: 'อัปเดตลูกหนี้แล้ว',
              description:
                fixedTaxAr && (fixedCommercialAr || fixedCommercial)
                  ? 'ปิด AR ใบกำกับและ AR ใบเรียกเก็บที่ค้างซ้ำ'
                  : fixedTaxAr
                    ? 'ปิด AR ใบกำกับตามใบเสร็จแล้ว'
                    : 'ปิด AR ใบเรียกเก็บที่ค้างซ้ำ',
            });
          }
        } else if (fixedCommercial) {
          toast({
            title: 'อัปเดตลูกหนี้แล้ว',
            description: 'ปิด AR ใบเรียกเก็บที่ซ้ำกับใบกำกับแล้ว',
          });
        }
      } catch (e) {
        console.error('AR reconcile failed', e);
      }
    })();
  }, [firestore, invoice, isAccountingActor, toast]);

  const bankAccountsQuery = useMemoFirebase(
    () => (firestore && isAccountingActor ? collection(firestore, 'bank_accounts') : null),
    [firestore, isAccountingActor],
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: bankAccountRows } = useCollection<BankAccount>(bankAccountsQuery as any);
  const receiveBankOptions = useMemo(
    () =>
      (bankAccountRows ?? []).filter((b) => b.status === 'ACTIVE' && b.accountType !== 'PETTY_CASH'),
    [bankAccountRows],
  );

  const canRecordBillingApproval =
    !!currentUser && canRecordTaxInvoiceBillingCustomerApproval(currentUser);

  const handleIssueInvoice = async () => {
    if (!firestore || !invRef || !invoice || !currentUser || !billingNote) return;
    if (invoice.status !== 'DRAFT') return;
    if (!invoice.billingCustomerApprovedAt) {
      toast({
        variant: 'destructive',
        title: 'ยังไม่มีการอนุมัติ billing จากลูกค้า',
        description:
          'ต้องกด "ลูกค้าอนุมัติ billing" (หรือลูกค้าอนุมัติผ่าน portal) ก่อน — แยกจากขั้นตอน payroll',
      });
      return;
    }
    if (!isAccountingActor) {
      toast({
        variant: 'destructive',
        title: 'ไม่มีสิทธิ์',
        description: 'เฉพาะบัญชี/ผู้ดูแลระบบเท่านั้นที่ยืนยันออกเอกสารจริง (ISSUED)',
      });
      return;
    }

    setIssuing(true);
    try {
      const issuedAt = Date.now();
      /** วันที่ออกเอกสาร = วันที่กดยืนยัน ISSUED (ส่งฉบับจริง) — ไม่ใช้ issueDate ของร่าง/ใบ commercial ย้อนหลัง */
      const issueYmd = timestampToHtmlDateValue(issuedAt);
      const issueStartMs = htmlDateValueToTimestampMs(issueYmd) ?? issuedAt;
      const dueYmd = timestampToHtmlDateValue(issueStartMs + 30 * 86400000);

      let arEntryId = invoice.arEntryId;
      if (!arEntryId) {
        const { code: arNo } = await generateNextDocumentCode(firestore, 'ar', {
          actor: currentUser.displayName,
        });
        const arRef = await addDoc(collection(firestore, 'accounts_receivable'), {
          customerId: invoice.customerId,
          referenceType: 'TAX_INVOICE',
          referenceId: invoice.id,
          referenceNo: invoice.taxInvoiceNo,
          documentNo: arNo,
          issueDate: issueYmd,
          dueDate: dueYmd,
          debitAmount: invoice.totalAmount,
          creditAmount: 0,
          outstandingAmount: invoice.totalAmount,
          status: 'OPEN',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        arEntryId = arRef.id;
      } else {
        await updateDoc(doc(firestore, 'accounts_receivable', arEntryId), {
          issueDate: issueYmd,
          dueDate: dueYmd,
          updatedAt: Date.now(),
        });
      }

      await updateDoc(invRef, {
        status: 'ISSUED' as TaxInvoiceStatus,
        arEntryId,
        issueDate: issueYmd,
        printDocumentLocale: printLocale,
        issuedByUid: currentUser.id,
        issuedByName: (currentUser.displayName || currentUser.email || currentUser.id).trim(),
        updatedAt: Date.now(),
      });

      await updateDoc(doc(firestore, 'billing_notes', invoice.billingNoteId), {
        status: 'INVOICED',
        billingDate: issueYmd,
        dueDate: dueYmd,
        updatedAt: Date.now(),
      });

      if (invoice.sourceCommercialInvoiceId) {
        await closeOpenCommercialArNow(firestore, invoice.sourceCommercialInvoiceId);
      }

      toast({
        title: 'ออกเอกสารจริงแล้ว (ISSUED)',
        description: 'บันทึกลูกหนี้ (AR) และอัปเดตใบวางบิลเป็น INVOICED',
      });
    } catch (e) {
      console.error(e);
      toast({
        variant: 'destructive',
        title: 'ไม่สำเร็จ',
        description: 'ไม่สามารถออกเอกสารหรือสร้าง AR ได้',
      });
    } finally {
      setIssuing(false);
    }
  };

  const handleConfirmBillingCustomerApprove = async () => {
    if (!firestore || !invoice || !billingNote || !currentUser) return;
    const lines = billingLines ?? [];
    setBillingApproving(true);
    try {
      const { approvalToken, timesheetsLocked } = await recordTaxInvoiceBillingCustomerApproval(
        firestore,
        invoice,
        billingNote,
        lines,
        currentUser as User,
        { channel: 'internal_ui', note: billingApproveNote.trim() || undefined }
      );
      setBillingApproveOpen(false);
      setBillingApproveNote('');
      toast({
        title: 'บันทึกการอนุมัติ billing แล้ว',
        description: `โทเคน ${approvalToken} — ล็อก timesheet ${timesheetsLocked} รายการ`,
      });
    } catch (e) {
      console.error(e);
      toast({
        variant: 'destructive',
        title: 'ไม่สำเร็จ',
        description: e instanceof Error ? e.message : 'บันทึกอนุมัติไม่ได้',
      });
    } finally {
      setBillingApproving(false);
    }
  };

  const handleUpdateStatus = (newStatus: TaxInvoiceStatus) => {
    if (!invRef) return;
    if (!isAccountingActor) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'เฉพาะบัญชี/ผู้ดูแลระบบ' });
      return;
    }
    if (newStatus === 'CANCELLED') {
      void handleCancelTaxInvoice();
      return;
    }
    updateDocumentNonBlocking(invRef, { status: newStatus, updatedAt: Date.now() });
    toast({ title: 'อัปเดตสถานะสำเร็จ', description: `เปลี่ยนสถานะเป็น ${newStatus}` });
  };

  const handleCancelTaxInvoice = async () => {
    if (!firestore || !invoice || !currentUser) return;
    if (!isAccountingActor) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'เฉพาะบัญชี/ผู้ดูแลระบบ' });
      return;
    }
    try {
      await cancelTaxInvoiceAsAccounting(firestore, invoice.id, currentUser);
      toast({
        title: 'ยกเลิกใบกำกับภาษีแล้ว',
        description: invoice.sourceCommercialInvoiceId
          ? 'ปลดลิงก์จากใบแจ้งหนี้แล้ว — ยกเลิกใบแจ้งหนี้ได้จากหน้ารายละเอียดใบเรียกเก็บ'
          : 'สถานะ CANCELLED',
      });
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'ยกเลิกใบกำกับไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const handlePickFiles = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length || !invRef || !invoice || !authUser || !currentUser) return;
    if (invoice.status !== 'DRAFT') return;
    if (invoice.billingCustomerApprovedAt) return;

    setUploading(true);
    try {
      const existing = invoice.timesheetPaperAttachments ?? [];
      let next = [...existing];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const v = validateTimesheetImageFile(file);
        if (v) {
          toast({ variant: 'destructive', title: file.name, description: v });
          continue;
        }
        const att = await uploadTaxInvoiceTimesheetImage(
          firebaseApp,
          invoice.id,
          file,
          authUser.uid,
          currentUser.displayName || authUser.email || 'User'
        );
        next = [...next, att];
      }

      await updateDoc(invRef, { timesheetPaperAttachments: next, updatedAt: Date.now() });
      toast({ title: 'อัปโหลดรูปแล้ว', description: `จำนวนไฟล์ในรายการ: ${next.length}` });
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'อัปโหลดไม่สำเร็จ', description: String(err) });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleRemoveAttachment = async (att: TaxInvoiceTimesheetAttachment) => {
    if (!invRef || !invoice || invoice.status !== 'DRAFT') return;
    if (invoice.billingCustomerApprovedAt) return;
    setRemovingId(att.id);
    try {
      try {
        await deleteTaxInvoiceAttachmentFile(firebaseApp, att.storagePath);
      } catch {
        /* ไฟล์อาจถูกลบไปแล้ว — ยังตัดรายการออกจากเอกสาร */
      }
      const next = (invoice.timesheetPaperAttachments ?? []).filter((a) => a.id !== att.id);
      // eslint-disable-next-line react-hooks/purity
      await updateDoc(invRef, { timesheetPaperAttachments: next, updatedAt: Date.now() });
      toast({ title: 'ลบรายการแนบแล้ว' });
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'ลบไม่สำเร็จ' });
    } finally {
      setRemovingId(null);
    }
  };

  const handleWhtFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length || !invRef || !invoice || !currentUser || !firebaseApp) return;
    if (!isAccountingActor) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'เฉพาะบัญชี/ผู้ดูแลระบบ' });
      return;
    }
    if (invoice.status === 'CANCELLED') return;

    setWhtUploading(true);
    try {
      let next = [...(invoice.whtAttachments ?? [])];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const v = validateTaxInvoiceWhtFile(file);
        if (v) {
          toast({ variant: 'destructive', title: file.name, description: v });
          continue;
        }
        const att = await uploadTaxInvoiceWhtFile(
          firebaseApp,
          invoice.id,
          file,
          currentUser.id,
          currentUser.displayName || currentUser.email || 'User',
        );
        next = [...next, att];
      }
      await updateDoc(invRef, { whtAttachments: next, updatedAt: Date.now() });
      toast({ title: 'แนบเอกสารหัก ณ ที่จ่ายแล้ว', description: `จำนวนไฟล์: ${next.length}` });
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'อัปโหลดไม่สำเร็จ', description: String(err) });
    } finally {
      setWhtUploading(false);
      e.target.value = '';
    }
  };

  const handleRemoveWhtAttachment = async (att: TaxInvoiceTimesheetAttachment) => {
    if (!invRef || !invoice || !firebaseApp) return;
    if (!isAccountingActor) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'เฉพาะบัญชี/ผู้ดูแลระบบ' });
      return;
    }
    if (!window.confirm(`ยืนยันลบไฟล์แนบ "${att.fileName}"?`)) return;
    setWhtRemovingId(att.id);
    try {
      try {
        await deleteTaxInvoiceWhtFile(firebaseApp, att.storagePath);
      } catch {
        /* best-effort */
      }
      const next = (invoice.whtAttachments ?? []).filter((a) => a.id !== att.id);
      await updateDoc(invRef, { whtAttachments: next, updatedAt: Date.now() });
      toast({ title: 'ลบเอกสารแนบแล้ว' });
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'ลบไม่สำเร็จ' });
    } finally {
      setWhtRemovingId(null);
    }
  };

  const executeTaxInvoicePrint = async (sheets: TaxInvoicePrintSheet[]) => {
    if (!invoice) return;
    const body = buildTaxInvoicePrintHtml({
      company: companyProfile ?? undefined,
      invoice,
      billingNote: billingNote ?? undefined,
      billingLines: billingLines ?? [],
      customer: customer ?? undefined,
      sourceCommercialInvoice: sourceCommercial ?? null,
      printedAtMs: Date.now(),
      locale: printLocale,
      sheets,
    });
    if (
      !(await openStandardPrintWindow({
        windowTitle: invoice.taxInvoiceNo,
        bodyInnerHtml: body,
        htmlLang: printLocale,
        onClipboardFilenameCopied: () => {
          toast({
            title: 'คัดลอกชื่อไฟล์แนะนำแล้ว',
            description:
              'ถ้าหน้าต่างบันทึก PDF ไม่เติมชื่อ — คลิกในช่องชื่อไฟล์แล้วกด Ctrl+V หรือ Shift+Insert หรือคลิกขวาแล้ววาง · หรือเลือกเครื่องพิมพ์ Save as PDF / บันทึกเป็น PDF ของ Edge หรือ Chrome แทน Microsoft Print to PDF',
          });
        },
      }))
    ) {
      toast({
        variant: 'destructive',
        title: 'เปิดหน้าต่างพิมพ์ไม่ได้',
        description: 'กรุณาอนุญาตป๊อปอัปสำหรับเว็บไซต์นี้',
      });
    }
  };

  const handlePrintTaxInvoice = () => {
    if (!invoice) return;
    if (isAccountingActor) {
      setAccountingPrintPreset('p1');
      setPrintPresetOpen(true);
      return;
    }
    void executeTaxInvoicePrint(['original']);
  };

  const handleConfirmAccountingPrint = () => {
    const preset = ACCOUNTING_TAX_INVOICE_PRINT_PRESETS[accountingPrintPreset];
    void executeTaxInvoicePrint(preset.sheets);
    setPrintPresetOpen(false);
  };

  const handleNotifyPaymentAccounting = async () => {
    if (!firestore || !invoice || !currentUser) return;
    if (invoice.status !== 'ISSUED' || invoice.linkedReceiptId) return;
    if (invoice.paymentNotifiedAt) {
      toast({ title: 'แจ้งชำระไปแล้ว' });
      return;
    }
    setPayNotifyLoading(true);
    try {
      await recordTaxInvoicePaymentNotification(firestore, invoice, currentUser as User, { source: 'accounting_ui' });
      toast({
        title: 'บันทึกแจ้งชำระแล้ว (ขั้นตอน 1)',
        description: 'ฝ่ายบัญชีสามารถกด «ยืนยันรับเงิน» เพื่อออกใบเสร็จรับเงิน',
      });
    } catch (e) {
      console.error(e);
      toast({
        variant: 'destructive',
        title: 'ไม่สำเร็จ',
        description: e instanceof Error ? e.message : 'บันทึกไม่ได้',
      });
    } finally {
      setPayNotifyLoading(false);
    }
  };

  const handleConfirmPaymentIssueReceipt = async () => {
    if (!firestore || !invoice || !currentUser) return;
    if (!isAccountingActor) {
      toast({ variant: 'destructive', title: 'เฉพาะบัญชี/ผู้ดูแลระบบ' });
      return;
    }
    setPayConfirmAmountStr(String(expectedMoneyReceiptAmount(invoice)));
    setPayConfirmEntryDate(timestampToHtmlDateValue(Date.now()));
    setPayConfirmBankId('');
    setPayConfirmOpen(true);
  };

  const handleSubmitPayConfirmIssueReceipt = async () => {
    if (!firestore || !invoice || !currentUser) return;
    if (!isAccountingActor) {
      toast({ variant: 'destructive', title: 'เฉพาะบัญชี/ผู้ดูแลระบบ' });
      return;
    }
    if (!payConfirmBankId.trim()) {
      toast({ variant: 'destructive', title: 'ข้อมูลไม่ครบ', description: 'เลือกบัญชีธนาคารที่รับเงิน' });
      return;
    }
    const raw = payConfirmAmountStr.replace(/,/g, '').trim();
    const amount = roundMoney2(Number(raw));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ variant: 'destructive', title: 'ยอดไม่ถูกต้อง', description: 'กรอกตัวเลขยอดรับเงิน' });
      return;
    }
    setPayConfirmLoading(true);
    try {
      const { receiptId, receiptNo, cashbookEntryNo } = await confirmPaymentAndIssueMoneyReceipt(
        firestore,
        invoice,
        currentUser as User,
        {
          bankAccountId: payConfirmBankId.trim(),
          amount,
          entryDate: payConfirmEntryDate.trim(),
        },
      );
      setPayConfirmOpen(false);
      toast({
        title: 'ออกใบเสร็จและลง cashbook แล้ว',
        description: `${receiptNo} · รายการรับ ${cashbookEntryNo}`,
      });
      router.push(`/receipts/${receiptId}`);
    } catch (e) {
      console.error(e);
      toast({
        variant: 'destructive',
        title: 'ไม่สำเร็จ',
        description: e instanceof Error ? e.message : 'ออกเอกสารไม่ได้',
      });
    } finally {
      setPayConfirmLoading(false);
    }
  };

  const handleSaveTaxInvoiceEdit = async () => {
    if (!firestore || !invRef || !invoice || !billingNoteRef || !currentUser) return;
    if (invoice.status !== 'DRAFT') {
      toast({
        variant: 'destructive',
        title: 'แก้ไขไม่ได้',
        description: 'ปรับการแสดงหัก ณ ที่จ่ายได้เฉพาะใบกำกับภาษีในสถานะร่าง (DRAFT)',
      });
      return;
    }
    if (!isAccountingActor) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'เฉพาะบัญชี/ผู้ดูแลระบบ' });
      return;
    }
    setSavingInvoiceEdit(true);
    try {
      const ratePct = Math.max(0, Number(invoice.withholdingTaxRatePercentOnDocument ?? 3));
      const wht = editShowWht ? roundMoney2((invoice.taxableAmount * ratePct) / 100) : 0;
      const now = Date.now();
      const actorName = currentUser.displayName || currentUser.email || currentUser.id;
      await updateDoc(invRef, {
        showWithholdingOnDocument: editShowWht,
        withholdingTaxRatePercentOnDocument: ratePct,
        withholdingTaxAmount: wht,
        updatedAt: now,
      });
      await updateDoc(billingNoteRef, {
        withholdingTaxAmount: wht,
        updatedAt: now,
        updatedBy: actorName,
      });
      setEditInvoiceOpen(false);
      toast({
        title: 'บันทึกแล้ว',
        description: editShowWht
          ? `แสดงหัก ณ ที่จ่ายบนเอกสาร — ยอดหัก ${wht.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`
          : 'ไม่แสดงยอดหัก ณ ที่จ่ายบนใบกำกับ — พิมพ์แบบยอดรวมสุทธิเต็มจำนวน',
      });
    } catch (e) {
      console.error(e);
      toast({
        variant: 'destructive',
        title: 'บันทึกไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSavingInvoiceEdit(false);
    }
  };

  const handleSaveTaxInvoiceNotes = async () => {
    if (!firestore || !invoice || !invRef || !currentUser) return;
    if (invoice.status === 'CANCELLED') {
      toast({ variant: 'destructive', title: 'ไม่สามารถแก้ไข', description: 'เอกสารถูกยกเลิกแล้ว' });
      return;
    }
    if (!isAccountingActor) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'เฉพาะบัญชี/ผู้ดูแลระบบ' });
      return;
    }
    setSavingNotes(true);
    try {
      await updateDoc(invRef, {
        notes: notesDraft.trim(),
        updatedAt: Date.now(),
      });
      setEditNotesOpen(false);
      toast({
        title: 'บันทึก Term & Note แล้ว',
        description: 'รายการและตัวเลขใบกำกับไม่ได้ถูกแก้ไข — อัปเดตเฉพาะเงื่อนไข/หมายเหตุ',
      });
    } catch (e) {
      console.error(e);
      toast({
        variant: 'destructive',
        title: 'บันทึกไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSavingNotes(false);
    }
  };

  if (isInvLoading || appUserLoading || !invoice || !currentUser) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-12 w-12 text-primary animate-spin" />
      </div>
    );
  }

  const attachments = invoice.timesheetPaperAttachments ?? [];

  return (
    <AppShell user={currentUser as User} onLogout={() => {}}>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.push('/tax-invoices')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">ใบกำกับภาษี</h1>
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <span className="font-mono font-bold text-primary">{invoice.taxInvoiceNo}</span>
                <Separator orientation="vertical" className="h-3" />
                <span>ลูกค้า: {customer?.name || '...'}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 justify-end">
            <DocumentPrintLocaleToggle
              printLocale={printLocale}
              setPrintLocale={setPrintLocale}
              showLabel
            />
            <Button variant="outline" className="gap-2" type="button" onClick={() => handlePrintTaxInvoice()}>
              <Printer className="h-4 w-4" /> พิมพ์เอกสาร
            </Button>
            <Badge variant="outline" className="py-1.5 px-4 font-bold border-primary/20 bg-primary/5 text-primary">
              {invoice.status === 'DRAFT' ? 'DRAFT — ร่าง' : `STATUS: ${invoice.status}`}
            </Badge>
          </div>
        </div>

        {invoice.sourceCommercialInvoiceId && (
          <Alert className="border-teal-200 bg-teal-50/80">
            <Info className="h-4 w-4" />
            <AlertTitle>สร้างจากใบเรียกเก็บ (Commercial billing)</AlertTitle>
            <AlertDescription className="text-sm space-y-2">
              <p>
                เอกสารนี้สร้างอัตโนมัติหลังยืนยันใบเรียกเก็บ — พิมพ์เป็น <strong>ใบกำกับภาษี</strong> (แยกจากใบเสร็จรับเงิน
                หลังยืนยันรับเงิน)
              </p>
              <Button variant="outline" size="sm" className="gap-2" asChild>
                <Link href={`/draft-invoices/${invoice.sourceCommercialInvoiceId}`}>
                  <ExternalLink className="h-4 w-4" />
                  เปิดใบเรียกเก็บต้นทาง
                </Link>
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {invoice.status === 'ISSUED' && !invoice.linkedReceiptId && (
          <Card className="border-amber-200 bg-amber-50/50">
            <CardHeader>
              <CardTitle className="text-base">รับเงิน &amp; ใบเสร็จ (2 ขั้น)</CardTitle>
              <CardDescription>
                ขั้น 1 แจ้งชำระ (ลูกค้าใน Client Portal หรือบัญชีกดฝั่งนี้) &rarr; ขั้น 2 ยืนยันรับเงิน — ระบุยอดและบัญชีรับเงิน
                เพื่อออกใบเสร็จและลงรายรับรายจ่าย (Cashbook) พร้อมปรับยอดบัญชีธนาคาร
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {invoice.paymentNotifiedAt && (
                <p className="text-muted-foreground">
                  แจ้งชำระแล้ว{' '}
                  {formatDateTimeThaiBE(invoice.paymentNotifiedAt)}
                  {invoice.paymentNotifiedByName ? ` — ${invoice.paymentNotifiedByName}` : ''}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {isAccountingActor && !invoice.paymentNotifiedAt && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => void handleNotifyPaymentAccounting()}
                    disabled={payNotifyLoading}
                  >
                    {payNotifyLoading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                    1. แจ้งชำระเงิน (ฝ่ายบัญชี)
                  </Button>
                )}
                {isAccountingActor && invoice.paymentNotifiedAt && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => handleConfirmPaymentIssueReceipt()}
                    disabled={payConfirmLoading}
                  >
                    {payConfirmLoading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                    2. ยืนยันรับเงิน &amp; ออกใบเสร็จ
                  </Button>
                )}
                {!isAccountingActor && !invoice.paymentNotifiedAt && (
                  <p className="text-muted-foreground">
                    ลูกค้าแจ้งชำระผ่าน Client Portal หรือให้บัญชีกด &quot;แจ้งชำระเงิน&quot;
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {invoice.status === 'ISSUED' && invoice.linkedReceiptId && (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>ออกใบเสร็จรับเงินแล้ว</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-2 text-sm">
              เปิดเอกสาร
              <Button variant="link" className="h-auto p-0" asChild>
                <Link href={`/receipts/${invoice.linkedReceiptId}`}>ใบเสร็จรับเงิน</Link>
              </Button>
              {invoice.paymentReceivedCashbookEntryId ? (
                <>
                  <span className="text-muted-foreground">·</span>
                  <Button variant="link" className="h-auto p-0" asChild>
                    <Link href="/cashbook">ดูรายรับรายจ่าย (Cashbook)</Link>
                  </Button>
                </>
              ) : null}
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <Card className="md:col-span-3">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <FileBadge className="h-5 w-5 text-primary" /> ข้อมูลใบกำกับภาษี (Invoice Info)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">เลขที่เอกสาร:</Label>
                  <p className="font-bold text-lg">{invoice.taxInvoiceNo}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">วันที่ออกเอกสาร:</Label>
                  <p className="font-medium flex items-center gap-2">
                    <Calendar className="h-4 w-4" /> {formatStoredDateThaiBE(invoice.issueDate)}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">อ้างอิงใบวางบิล:</Label>
                  <p className="font-mono font-bold text-primary">{billingNote?.billingNoteNo || '...'}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">ลูกค้า:</Label>
                  <p className="font-semibold flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    {customer?.name}
                  </p>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <Label className="text-[10px] uppercase text-muted-foreground font-bold">รายการ (ใบวางบิล)</Label>
                <TaxInvoiceLinesTable
                  lines={billingLines}
                  commercialLines={sourceCommercial?.lines}
                  numberLocale="th-TH"
                  currency={invoice.currency}
                  columnHeaders={{
                    no: 'ลำดับ',
                    description: 'รายการ',
                    qty: 'จำนวน',
                    unitPrice: 'ราคา/หน่วย',
                    amount: 'จำนวนเงิน',
                  }}
                  emptyLabel="ไม่มีรายการในบรรทัด"
                />
              </div>

              <Separator />

              {invoice.status === 'ISSUED' && (
                <p className="text-xs text-muted-foreground">
                  เอกสารออกฉบับจริงแล้ว — รายการ ราคา ที่อยู่ ล็อกแล้ว — เลือกพิมพ์เป็นภาษาไทยหรืออังกฤษที่มุมขวาบนก่อนพิมพ์
                </p>
              )}

              <div className="space-y-4">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">ยอดเงินฐานภาษี (Taxable Amount)</span>
                  <span className="font-bold">
                    {invoice.currency}{' '}
                    {invoice.taxableAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">ภาษีมูลค่าเพิ่ม (VAT 7%)</span>
                  <span className="font-bold">
                    {invoice.currency}{' '}
                    {invoice.vatAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
                {showWhtBlock ? (
                  <>
                    <div className="flex justify-between items-center text-lg pt-2 border-t">
                      <span className="font-black text-primary uppercase">ยอดรวมใบกำกับ (รวม VAT)</span>
                      <span className="font-black text-2xl text-primary">
                        {invoice.currency}{' '}
                        {invoice.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-sm text-muted-foreground">
                      <span>
                        หัก ณ ที่จ่าย ({whtRateDisplay}% จากฐานก่อน VAT) — อ้างอิงเท่านั้น
                      </span>
                      <span className="font-medium text-destructive">
                        −{invoice.currency}{' '}
                        {(Number(invoice.withholdingTaxAmount) || 0).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-sm text-muted-foreground">
                      <span>ยอดหลังหัก ณ ที่จ่าย (อ้างอิง)</span>
                      <span className="font-medium">
                        {invoice.currency}{' '}
                        {netAfterWht.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between items-center text-lg pt-2 border-t">
                    <span className="font-black text-primary uppercase">ยอดรวมสุทธิ (Net Total)</span>
                    <span className="font-black text-2xl text-primary">
                      {invoice.currency}{' '}
                      {invoice.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
              </div>

              <div className="space-y-2 pt-4">
                <Label className="text-xs font-black uppercase text-muted-foreground tracking-widest flex items-center gap-2">
                  <Info className="h-3 w-3" /> Term &amp; Note (เงื่อนไขและหมายเหตุ)
                </Label>
                <div className="rounded-md border bg-muted/20 px-3 py-2.5">
                  {invoice.notes?.trim() ? (
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{invoice.notes.trim()}</p>
                  ) : (
                    <p className="text-sm italic text-muted-foreground">ยังไม่มีเงื่อนไข/หมายเหตุ</p>
                  )}
                </div>
              </div>

              {invoice.billingApprovalToken && (
                <div className="rounded-lg border bg-muted/40 p-4 space-y-1">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">
                    โทเคนอนุมัติ billing (อ้างอิงชุดเอกสาร)
                  </Label>
                  <p className="font-mono text-sm font-bold break-all">{invoice.billingApprovalToken}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="border-amber-200 bg-amber-50/80 dark:bg-amber-950/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-amber-900 dark:text-amber-100">
                  <UserCheck className="h-4 w-4" />
                  {invoice.sourceCommercialInvoiceId
                    ? 'การยืนยันยอดเรียกเก็บ (จากใบเรียกเก็บ)'
                    : 'ลูกค้าอนุมัติ billing (แยกจาก payroll)'}
                </CardTitle>
                <CardDescription className="text-xs text-amber-900/80 dark:text-amber-100/80">
                  {invoice.sourceCommercialInvoiceId
                    ? 'ยอดถูกยืนยันผ่านใบเรียกเก็บ — ใบกำกับ+ใบวางบิล แยกจากใบเสร็จ (ออกหลังรับเงิน) — ฝ่ายบัญชีออก ISSUED เมื่อยืนยันรับเงิน/พร้อม (ยังไม่ e-Tax ตามตั้งค่า)'
                    : 'หลังอนุมัติ timesheet ที่เกี่ยวกับใบวางบิลนี้จะถูกล็อก — บัญชีจะออก ISSUED ได้เมื่อขั้นตอนนี้เสร็จแล้ว'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {invoice.billingCustomerApprovedAt ? (
                  <div className="space-y-1 text-xs">
                    <p>
                      <span className="font-semibold">อนุมัติเมื่อ:</span>{' '}
                      {formatDateTimeThaiBE(invoice.billingCustomerApprovedAt)}
                    </p>
                    <p>
                      <span className="font-semibold">โดย:</span>{' '}
                      {invoice.billingCustomerApprovedByName || '—'} (
                      {invoice.billingCustomerApprovalSource === 'client_portal'
                        ? 'Client portal'
                        : 'บันทึกภายใน'})
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">ยังไม่มีการอนุมัติ billing จากลูกค้า</p>
                )}
                {invoice.status === 'DRAFT' && !invoice.billingCustomerApprovedAt && canRecordBillingApproval && (
                  <Button
                    variant="default"
                    className="w-full bg-amber-700 hover:bg-amber-800 text-white"
                    onClick={() => setBillingApproveOpen(true)}
                  >
                    <UserCheck className="h-4 w-4 mr-2" />
                    ลูกค้าอนุมัติ billing
                  </Button>
                )}
                {invoice.billingApprovalEvents && invoice.billingApprovalEvents.length > 0 && (
                  <div className="pt-2 border-t border-amber-200/60 space-y-2 max-h-40 overflow-y-auto">
                    <p className="text-[10px] font-bold uppercase text-muted-foreground">ประวัติบนเอกสาร</p>
                    {invoice.billingApprovalEvents.map((ev) => (
                      <div key={ev.id} className="text-[10px] rounded bg-white/60 dark:bg-black/20 p-2 font-mono">
                        <div>{ev.approvalToken}</div>
                        <div className="text-muted-foreground mt-1">
                          {formatDateTimeThaiBE(ev.at)} · {ev.actorName} · {ev.channel}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-primary text-primary-foreground shadow-lg">
              <CardHeader className="pb-4 border-b border-white/10">
                <CardTitle className="text-sm font-bold uppercase tracking-wider opacity-80">
                  การดำเนินการ (Workflow)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-3">
                {invoice.status === 'DRAFT' && isAccountingActor && (
                  <Button
                    variant="outline"
                    className="w-full border-white/40 bg-white/10 text-white hover:bg-white/20 font-semibold"
                    type="button"
                    onClick={() => {
                      setEditShowWht(!!invoice.showWithholdingOnDocument);
                      setEditInvoiceOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4 mr-2" />
                    แก้ไข (การแสดงหัก ณ ที่จ่ายบนเอกสาร)
                  </Button>
                )}
                {invoice.status === 'DRAFT' && isAccountingActor && (
                  <Button
                    className="w-full bg-white text-primary hover:bg-slate-100 font-bold"
                    onClick={() => void handleIssueInvoice()}
                    disabled={issuing || !invoice.billingCustomerApprovedAt}
                  >
                    {issuing ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                    )}
                    ยืนยันออกเอกสารจริง (ISSUED)
                  </Button>
                )}
                {invoice.status === 'DRAFT' && isAccountingActor && !invoice.billingCustomerApprovedAt && (
                  <div className="p-3 bg-white/15 rounded-lg text-[11px] flex gap-2">
                    <Info className="h-4 w-4 shrink-0" />
                    รอลูกค้าอนุมัติ billing ก่อนจึงจะออก ISSUED ได้
                  </div>
                )}
                {invoice.status === 'DRAFT' && !isAccountingActor && (
                  <div className="p-4 bg-white/10 rounded-lg text-xs flex gap-2">
                    <Info className="h-4 w-4 shrink-0" />
                    {invoice.billingCustomerApprovedAt
                      ? 'ลูกค้าอนุมัติ billing แล้ว — รอฝ่ายบัญชีออก ISSUED'
                      : 'รอลูกค้าอนุมัติ billing — แนบรูปสลิปด้านล่างได้ (จนกว่าจะอนุมัติ billing)'}
                  </div>
                )}
                {invoice.status === 'ISSUED' && (
                  <div className="p-4 bg-white/10 rounded-lg text-xs flex gap-2">
                    <Info className="h-4 w-4 shrink-0" />
                    เอกสารออกจริงแล้ว — บันทึกลูกหนี้ (AR) และใบวางบิลเป็น INVOICED
                  </div>
                )}
                {isAccountingActor && invoice.status !== 'CANCELLED' && (
                  <Button
                    variant="outline"
                    className="w-full border-white/40 bg-white/10 text-white hover:bg-white/20 font-semibold"
                    type="button"
                    onClick={() => {
                      setNotesDraft(invoice.notes ?? '');
                      setEditNotesOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4 mr-2" />
                    แก้ไข Term &amp; Note
                  </Button>
                )}
                {isAccountingActor && invoice.status !== 'CANCELLED' && (
                  <div className="space-y-2">
                    <input
                      ref={whtFileInputRef}
                      type="file"
                      multiple
                      accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp"
                      className="hidden"
                      onChange={(e) => void handleWhtFileChange(e)}
                    />
                    <Button
                      variant="outline"
                      className="w-full border-white/40 bg-white/10 text-white hover:bg-white/20 font-semibold"
                      type="button"
                      disabled={whtUploading}
                      onClick={() => whtFileInputRef.current?.click()}
                    >
                      {whtUploading ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Paperclip className="h-4 w-4 mr-2" />
                      )}
                      แนบเอกสารหัก ณ ที่จ่าย
                    </Button>
                    <p className="text-[10px] text-white/70 leading-snug px-0.5">
                      เอกสารที่ได้รับจากลูกค้า (PDF / รูป) — แสดงในกรอบด้านล่าง และกดดูขยายได้
                    </p>
                  </div>
                )}
                {isAccountingActor && (
                  <Button
                    variant="ghost"
                    className="w-full text-white/60 hover:text-white hover:bg-white/10"
                    onClick={() => handleUpdateStatus('CANCELLED')}
                  >
                    <XCircle className="h-4 w-4 mr-2" /> ยกเลิกใบกำกับภาษี
                  </Button>
                )}
              </CardContent>
            </Card>

            <Card className="bg-muted/30 border-dashed">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold uppercase text-muted-foreground">Audit Log</CardTitle>
              </CardHeader>
              <CardContent className="text-[10px] space-y-2">
                <div className="flex justify-between">
                  <span>สร้างเมื่อ:</span>
                  <span>{formatDateTimeThaiBE(invoice.createdAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span>อัปเดตล่าสุด:</span>
                  <span>{formatDateTimeThaiBE(invoice.updatedAt)}</span>
                </div>
              </CardContent>
            </Card>

            <Card className="border-2 border-blue-400 bg-blue-50/40 dark:border-blue-600 dark:bg-blue-950/20 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-blue-800 dark:text-blue-200 flex items-center gap-2">
                  <Paperclip className="h-3.5 w-3.5" />
                  เอกสารแนบหัก ณ ที่จ่าย
                  {(Number(invoice.withholdingTaxAmount) || 0) > 0.005 &&
                  (invoice.whtAttachments?.length ?? 0) === 0 ? (
                    <span title="ยังไม่มีเอกสารแนบ">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500 stroke-[2.5] stroke-red-600 fill-amber-300" />
                    </span>
                  ) : null}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(invoice.whtAttachments?.length ?? 0) === 0 ? (
                  <p className="text-xs text-muted-foreground italic">
                    {(Number(invoice.withholdingTaxAmount) || 0) > 0.005
                      ? 'ยังไม่มีเอกสารแนบ — แนบจากส่วนการดำเนินการด้านบน'
                      : 'ไม่มีเอกสารแนบ'}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {(invoice.whtAttachments ?? []).map((att) => {
                      const isImage = (att.contentType || '').startsWith('image/');
                      return (
                        <li
                          key={att.id}
                          className="flex items-center gap-2 rounded-md border border-blue-200 bg-white/80 dark:border-blue-800 dark:bg-background/60 p-2"
                        >
                          {isImage ? (
                            <button
                              type="button"
                              className="h-12 w-12 shrink-0 overflow-hidden rounded border bg-muted"
                              onClick={() => setWhtPreviewAtt(att)}
                              title="กดเพื่อขยายดู"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={att.downloadUrl}
                                alt={att.fileName}
                                className="h-full w-full object-cover"
                              />
                            </button>
                          ) : (
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded border bg-muted">
                              <FileText className="h-5 w-5 text-muted-foreground" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1 space-y-1">
                            <p className="text-[11px] font-medium truncate" title={att.fileName}>
                              {att.fileName}
                            </p>
                            <div className="flex flex-wrap gap-1">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 text-[10px] px-2"
                                onClick={() => {
                                  if (isImage) setWhtPreviewAtt(att);
                                  else window.open(att.downloadUrl, '_blank', 'noopener,noreferrer');
                                }}
                              >
                                <ExternalLink className="h-3 w-3 mr-1" />
                                ขยายดู
                              </Button>
                              {isAccountingActor ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-[10px] px-2 text-destructive hover:text-destructive"
                                  disabled={whtRemovingId === att.id}
                                  onClick={() => void handleRemoveWhtAttachment(att)}
                                >
                                  {whtRemovingId === att.id ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-3 w-3" />
                                  )}
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {invoice.status === 'DRAFT' && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ImagePlus className="h-5 w-5" />
                แนบรูปสลิปลงเวลา / เอกสารลงนาม (เฉพาะร่าง DRAFT)
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {invoice.billingCustomerApprovedAt
                  ? 'หลังลูกค้าอนุมัติ billing แล้ว — ไม่สามารถเพิ่ม/ลบรูปได้ (timesheet ถูกล็อกแล้ว)'
                  : 'รองรับ JPEG, PNG, WebP ไม่เกิน 15 MB ต่อไฟล์ — ใช้ส่งให้ลูกค้าตรวจก่อนกดอนุมัติ billing'}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="hidden"
                onChange={(e) => void handleFileChange(e)}
              />
              {!invoice.billingCustomerApprovedAt && (
                <Button variant="secondary" onClick={handlePickFiles} disabled={uploading}>
                  {uploading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <ImagePlus className="h-4 w-4 mr-2" />
                  )}
                  เลือกรูป
                </Button>
              )}

              {attachments.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">ยังไม่มีรูปแนบ</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {attachments.map((att) => (
                    <div
                      key={att.id}
                      className="relative rounded-lg border bg-card overflow-hidden group shadow-sm"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={att.downloadUrl}
                        alt={att.fileName}
                        className="h-32 w-full object-cover"
                      />
                      <div className="p-2 flex flex-col gap-1">
                        <p className="text-[10px] truncate font-medium" title={att.fileName}>
                          {att.fileName}
                        </p>
                        <div className="flex gap-1">
                          <Button variant="outline" size="sm" className="h-7 flex-1 text-[10px] px-1" asChild>
                            <a href={att.downloadUrl} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-3 w-3 mr-1" />
                              เปิด
                            </a>
                          </Button>
                          {!invoice.billingCustomerApprovedAt && (
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-7 px-2"
                              onClick={() => void handleRemoveAttachment(att)}
                              disabled={removingId === att.id}
                            >
                              {removingId === att.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Trash2 className="h-3 w-3" />
                              )}
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Dialog
          open={payConfirmOpen}
          onOpenChange={(o) => {
            setPayConfirmOpen(o);
            if (!o) setPayConfirmLoading(false);
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>ยืนยันรับเงิน · ออกใบเสร็จ · ลง Cashbook</DialogTitle>
              <DialogDescription>
                ตรวจยอดที่รับจริงและเลือกบัญชีธนาคารที่เงินเข้า — ระบบจะสร้างใบเสร็จรับเงิน รายการรับในรายรับรายจ่าย
                และเพิ่มยอดคงเหลือในบัญชีที่เลือก (ขั้นตอนเดียวกัน)
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pay-confirm-amt">ยอดรับ ({invoice?.currency ?? 'THB'})</Label>
                <Input
                  id="pay-confirm-amt"
                  inputMode="decimal"
                  value={payConfirmAmountStr}
                  onChange={(e) => setPayConfirmAmountStr(e.target.value)}
                  placeholder="0.00"
                  className="font-mono"
                />
                {invoice ? (
                  <p className="text-xs text-muted-foreground">
                    ใบเสร็จออกตามยอดรวมใบกำกับ (ฐานภาษี + VAT){' '}
                    <span className="font-semibold text-foreground">
                      {invoice.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                    {showWhtBlock ? ' — ไม่หัก ณ ที่จ่ายในใบเสร็จ' : null}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="pay-confirm-date">วันที่รับเงิน (ลงบัญชี)</Label>
                <Input
                  id="pay-confirm-date"
                  type="date"
                  value={payConfirmEntryDate}
                  onChange={(e) => setPayConfirmEntryDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>บัญชีธนาคารที่รับเงิน</Label>
                <Select value={payConfirmBankId || undefined} onValueChange={setPayConfirmBankId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="เลือกบัญชี…" />
                  </SelectTrigger>
                  <SelectContent>
                    {receiveBankOptions.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.accountCode} — {b.bankName} · …{String(b.accountNumber ?? '').slice(-4)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {receiveBankOptions.length === 0 ? (
                  <p className="text-xs text-destructive">ไม่มีบัญชี ACTIVE — ตั้งค่าที่เมนูบัญชีธนาคารก่อน</p>
                ) : null}
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setPayConfirmOpen(false)} disabled={payConfirmLoading}>
                ยกเลิก
              </Button>
              <Button type="button" onClick={() => void handleSubmitPayConfirmIssueReceipt()} disabled={payConfirmLoading}>
                {payConfirmLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                ยืนยันและออกใบเสร็จ
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={billingApproveOpen} onOpenChange={setBillingApproveOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>ลูกค้าอนุมัติ billing</DialogTitle>
              <DialogDescription>
                ยืนยันการอนุมัติยอด/เอกสารชุดนี้เพื่อส่งต่อบัญชี (แยกจาก payroll) ระบบจะออกโทเคนอ้างอิง ล็อก timesheet
                และบันทึก audit
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label className="text-xs">หมายเหตุ (ไม่บังคับ)</Label>
              <Textarea
                value={billingApproveNote}
                onChange={(e) => setBillingApproveNote(e.target.value)}
                placeholder="เช่น อีเมลลูกค้ายืนยัน วันที่ ..."
                rows={3}
              />
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setBillingApproveOpen(false)} disabled={billingApproving}>
                ยกเลิก
              </Button>
              <Button
                className="bg-amber-700 hover:bg-amber-800"
                onClick={() => void handleConfirmBillingCustomerApprove()}
                disabled={billingApproving}
              >
                {billingApproving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ยืนยันอนุมัติ billing'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={printPresetOpen} onOpenChange={setPrintPresetOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>เลือกชุดพิมพ์ (บัญชี OPEC)</DialogTitle>
              <DialogDescription>
                แต่ละแผ่นแสดง &quot;ต้นฉบับ&quot; หรือ &quot;สำเนา&quot; (ไทย) / &quot;Original&quot; หรือ &quot;Copy&quot; (อังกฤษ) ใต้ชื่อเอกสาร — ตามภาษาที่เลือกพิมพ์ด้านบน
              </DialogDescription>
            </DialogHeader>
            <RadioGroup
              value={accountingPrintPreset}
              onValueChange={(v) => setAccountingPrintPreset(v as 'p1' | 'p2' | 'p3' | 'p4')}
              className="gap-3"
            >
              {(Object.keys(ACCOUNTING_TAX_INVOICE_PRINT_PRESETS) as Array<'p1' | 'p2' | 'p3' | 'p4'>).map(
                (key) => (
                  <div key={key} className="flex items-start gap-3 rounded-lg border p-3">
                    <RadioGroupItem value={key} id={`print-${key}`} className="mt-1" />
                    <Label htmlFor={`print-${key}`} className="cursor-pointer font-normal leading-snug flex-1">
                      <span className="font-semibold">{ACCOUNTING_TAX_INVOICE_PRINT_PRESETS[key].label}</span>
                    </Label>
                  </div>
                ),
              )}
            </RadioGroup>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setPrintPresetOpen(false)}>
                ยกเลิก
              </Button>
              <Button type="button" onClick={handleConfirmAccountingPrint}>
                พิมพ์
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={!!whtPreviewAtt}
          onOpenChange={(open) => {
            if (!open) setWhtPreviewAtt(null);
          }}
        >
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle className="truncate pr-8">{whtPreviewAtt?.fileName || 'เอกสารแนบ'}</DialogTitle>
              <DialogDescription>กดเปิดแท็บใหม่หากต้องการดูเต็มหน้าจอหรือดาวน์โหลด</DialogDescription>
            </DialogHeader>
            {whtPreviewAtt ? (
              <div className="space-y-3">
                {(whtPreviewAtt.contentType || '').startsWith('image/') ? (
                  <div className="max-h-[70vh] overflow-auto rounded-md border bg-muted/30 p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={whtPreviewAtt.downloadUrl}
                      alt={whtPreviewAtt.fileName}
                      className="mx-auto max-h-[65vh] w-auto max-w-full object-contain"
                    />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">ไฟล์นี้เปิดในแท็บใหม่เพื่อดูเนื้อหา</p>
                )}
                <DialogFooter>
                  <Button variant="outline" type="button" asChild>
                    <a href={whtPreviewAtt.downloadUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4 mr-2" />
                      เปิดแท็บใหม่
                    </a>
                  </Button>
                  <Button type="button" onClick={() => setWhtPreviewAtt(null)}>
                    ปิด
                  </Button>
                </DialogFooter>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>

        <Dialog open={editInvoiceOpen} onOpenChange={setEditInvoiceOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>แก้ไขการแสดงหัก ณ ที่จ่ายบนใบกำกับภาษี</DialogTitle>
              <DialogDescription>
                ใช้ได้เฉพาะเอกสารร่าง (DRAFT) — ฐานหัก = ยอดก่อน VAT อัตรา {whtRateDisplay}% ตามที่ตั้งไว้ตอนสร้างชุดเอกสาร
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-4">
              <Checkbox
                id="edit-show-wht"
                checked={editShowWht}
                onCheckedChange={(v) => setEditShowWht(v === true)}
              />
              <div className="space-y-1">
                <Label htmlFor="edit-show-wht" className="cursor-pointer font-semibold leading-none">
                  แสดงยอดหัก ณ ที่จ่ายบนใบกำกับภาษี
                </Label>
                <p className="text-xs text-muted-foreground">
                  เมื่อเปิด: พิมพ์และหน้าจอจะแสดงยอดรวมรวม VAT แล้วหักภาษี ณ ที่จ่าย และยอดสุทธิที่ต้องชำระ — เมื่อปิด:
                  แสดงยอดรวมสุทธิแบบเดิม (ไม่มีบรรทัดหัก)
                </p>
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setEditInvoiceOpen(false)} disabled={savingInvoiceEdit}>
                ยกเลิก
              </Button>
              <Button type="button" onClick={() => void handleSaveTaxInvoiceEdit()} disabled={savingInvoiceEdit}>
                {savingInvoiceEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : 'บันทึก'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={editNotesOpen} onOpenChange={setEditNotesOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>แก้ไข Term &amp; Note</DialogTitle>
              <DialogDescription>
                แก้ไขเงื่อนไขและหมายเหตุที่แสดงบนใบกำกับเท่านั้น — ไม่สามารถแก้รายการหรือตัวเลขบนเอกสารที่ล็อกแล้ว
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="tax-invoice-notes" className="text-xs font-black uppercase text-muted-foreground tracking-widest flex items-center gap-2">
                <Info className="h-3 w-3" /> Term &amp; Note (เงื่อนไขและหมายเหตุ)
              </Label>
              <Textarea
                id="tax-invoice-notes"
                className="text-sm min-h-[160px] resize-y"
                placeholder={'เช่น Manpower supply "Offshore" Service Charge\nProject Name : …\nSubcontract No : …'}
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                disabled={savingNotes}
              />
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setEditNotesOpen(false)} disabled={savingNotes}>
                ยกเลิก
              </Button>
              <Button type="button" onClick={() => void handleSaveTaxInvoiceNotes()} disabled={savingNotes}>
                {savingNotes ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                บันทึก
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
