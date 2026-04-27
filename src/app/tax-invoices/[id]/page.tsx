'use client';

import { useState, use, useRef } from 'react';
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
} from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { formatDateTimeThaiBE, formatStoredDateThaiBE } from '@/lib/date-thai';
import { useAppUser } from '@/hooks/use-app-user';
import { isSystemAdmin } from '@/lib/permission-core';
import { isSimpleAccounting } from '@/lib/simple-tier-model';
import { canRecordTaxInvoiceBillingCustomerApproval } from '@/lib/permissions';
import { generateNextDocumentCode } from '@/lib/services/numbering-service';
import { recordTaxInvoiceBillingCustomerApproval } from '@/lib/services/tax-invoice-billing-approval-service';
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
import { buildTaxInvoicePrintHtml, openStandardPrintWindow } from '@/lib/documents/standard-document-print';
import {
  recordTaxInvoicePaymentNotification,
  confirmPaymentAndIssueMoneyReceipt,
} from '@/lib/services/money-receipt-service';
import { useDocumentPrintLocale } from '@/hooks/use-document-print-locale';
import { DocumentPrintLocaleToggle } from '@/components/documents/document-print-locale-toggle';
import { TaxInvoiceLinesTable } from '@/components/documents/tax-invoice-lines-table';

export default function TaxInvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { currentUser, isLoading: appUserLoading } = useAppUser();
  const { user: authUser } = useUser();
  const firebaseApp = useFirebaseApp();
  const firestore = useFirestore();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [issuing, setIssuing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [billingApproveOpen, setBillingApproveOpen] = useState(false);
  const [billingApproveNote, setBillingApproveNote] = useState('');
  const [billingApproving, setBillingApproving] = useState(false);
  const [payNotifyLoading, setPayNotifyLoading] = useState(false);
  const [payConfirmLoading, setPayConfirmLoading] = useState(false);

  const invRef = useMemoFirebase(() => (firestore ? doc(firestore, 'tax_invoices', id) : null), [firestore, id]);
  const { data: invoice, isLoading: isInvLoading } = useDoc<TaxInvoice>(invRef as any);

  const customerRef = useMemoFirebase(
    () => (firestore && invoice ? doc(firestore, 'customers', invoice.customerId) : null),
    [firestore, invoice?.customerId]
  );
  const { data: customer } = useDoc<Customer>(customerRef as any);

  const billingNoteRef = useMemoFirebase(
    () => (firestore && invoice ? doc(firestore, 'billing_notes', invoice.billingNoteId) : null),
    [firestore, invoice?.billingNoteId]
  );
  const { data: billingNote } = useDoc<BillingNote>(billingNoteRef as any);

  const billingLinesQuery = useMemoFirebase(
    () =>
      firestore && invoice
        ? collection(firestore, 'billing_notes', invoice.billingNoteId, 'lines')
        : null,
    [firestore, invoice?.billingNoteId]
  );
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
  }>(companyProfileRef as any);

  const { printLocale, setPrintLocale } = useDocumentPrintLocale();

  const isAccountingActor =
    !!currentUser && (isSystemAdmin(currentUser) || isSimpleAccounting(currentUser));

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
          issueDate: invoice.issueDate,
          dueDate: billingNote.dueDate,
          debitAmount: invoice.totalAmount,
          creditAmount: 0,
          outstandingAmount: invoice.totalAmount,
          status: 'OPEN',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        arEntryId = arRef.id;
      }

      await updateDoc(invRef, {
        status: 'ISSUED' as TaxInvoiceStatus,
        arEntryId,
        printDocumentLocale: printLocale,
        updatedAt: Date.now(),
      });

      await updateDoc(doc(firestore, 'billing_notes', invoice.billingNoteId), {
        status: 'INVOICED',
        updatedAt: Date.now(),
      });

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
    updateDocumentNonBlocking(invRef, { status: newStatus, updatedAt: Date.now() });
    toast({ title: 'อัปเดตสถานะสำเร็จ', description: `เปลี่ยนสถานะเป็น ${newStatus}` });
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
      await updateDoc(invRef, { timesheetPaperAttachments: next, updatedAt: Date.now() });
      toast({ title: 'ลบรายการแนบแล้ว' });
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'ลบไม่สำเร็จ' });
    } finally {
      setRemovingId(null);
    }
  };

  const effectivePrintLocale =
    invoice && invoice.status === 'ISSUED' && invoice.printDocumentLocale
      ? invoice.printDocumentLocale
      : printLocale;

  const printLocaleReadOnly = Boolean(
    invoice?.status === 'ISSUED' && invoice?.printDocumentLocale,
  );

  const handlePrintTaxInvoice = () => {
    if (!invoice) return;
    const body = buildTaxInvoicePrintHtml({
      company: companyProfile ?? undefined,
      invoice,
      billingNote: billingNote ?? undefined,
      billingLines: billingLines ?? [],
      customer: customer ?? undefined,
      printedAtMs: Date.now(),
      locale: effectivePrintLocale,
    });
    if (
      !openStandardPrintWindow({
        windowTitle: invoice.taxInvoiceNo,
        bodyInnerHtml: body,
        htmlLang: effectivePrintLocale,
      })
    ) {
      toast({
        variant: 'destructive',
        title: 'เปิดหน้าต่างพิมพ์ไม่ได้',
        description: 'กรุณาอนุญาตป๊อปอัปสำหรับเว็บไซต์นี้',
      });
    }
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
    setPayConfirmLoading(true);
    try {
      const { receiptId, receiptNo } = await confirmPaymentAndIssueMoneyReceipt(
        firestore,
        invoice,
        currentUser as User,
      );
      toast({ title: 'ออกใบเสร็จรับเงินแล้ว', description: receiptNo });
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
      <div className="max-w-5xl mx-auto space-y-6">
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
              printLocale={effectivePrintLocale}
              setPrintLocale={setPrintLocale}
              readOnly={printLocaleReadOnly}
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
                ขั้น 1 แจ้งชำระ (ลูกค้าใน Client Portal หรือบัญชีกดฝั่งนี้) &rarr; ขั้น 2 ยืนยันรับเงิน &rarr; ระบบออก
                ใบเสร็จรับเงิน
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
                    onClick={() => void handleConfirmPaymentIssueReceipt()}
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
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="md:col-span-2">
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

              {printLocaleReadOnly && (
                <p className="text-xs text-muted-foreground">
                  ฉบับออกจริง: บันทึกภาษาเอกสารสำหรับพิมพ์เป็น{' '}
                  <span className="font-semibold">{effectivePrintLocale === 'en' ? 'อังกฤษ' : 'ไทย'}</span> แล้ว — ปุ่มด้าน
                  บนล็อกไว้
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
                <div className="flex justify-between items-center text-lg pt-2 border-t">
                  <span className="font-black text-primary uppercase">ยอดรวมสุทธิ (Net Total)</span>
                  <span className="font-black text-2xl text-primary">
                    {invoice.currency}{' '}
                    {invoice.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              <div className="space-y-2 pt-4">
                <Label>หมายเหตุ:</Label>
                <p className="text-sm italic text-muted-foreground">{invoice.notes || 'ไม่มีหมายเหตุ'}</p>
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
      </div>
    </AppShell>
  );
}
