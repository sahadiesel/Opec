'use client';

/**
 * Client portal: พิมพ์ใบกำกับภาษี — ใบเสร็จรับเงินเป็นเอกสารต่างหลัง (แท็บ ใบเสร็จ)
 */
import { use, useCallback, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Printer, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { BillingNote, BillingNoteLine, Customer, TaxInvoice, User } from '@/lib/types';
import { recordTaxInvoicePaymentNotification } from '@/lib/services/money-receipt-service';
import { useFirestore, useDoc, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { doc, collection } from 'firebase/firestore';
import { isClient } from '@/lib/permissions';
import { useAppUser } from '@/hooks/use-app-user';
import { formatStoredDateThaiBE } from '@/lib/date-thai';
import { useToast } from '@/hooks/use-toast';
import { buildTaxInvoicePrintHtml, openStandardPrintWindow } from '@/lib/documents/standard-document-print';
import { useDocumentPrintLocale } from '@/hooks/use-document-print-locale';
import { DocumentPrintLocaleToggle } from '@/components/documents/document-print-locale-toggle';
import { TaxInvoiceLinesTable } from '@/components/documents/tax-invoice-lines-table';
import { usePortalLocale } from '@/contexts/portal-locale-context';

export default function ClientTaxPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { locale } = usePortalLocale();
  const en = locale === 'en';

  const ready = Boolean(firestore && currentUser && isClient(currentUser));

  const invRef = useMemoFirebase(() => (ready ? doc(firestore!, 'tax_invoices', id) : null), [firestore, id, ready]);
  const { data: invoice, isLoading } = useDoc<TaxInvoice>(invRef as any);

  const bnRef = useMemoFirebase(
    () => (ready && invoice ? doc(firestore!, 'billing_notes', invoice.billingNoteId) : null),
    [firestore, invoice?.billingNoteId, ready],
  );
  const { data: billingNote } = useDoc<BillingNote>(bnRef as any);

  const linesQ = useMemoFirebase(
    () => (ready && invoice ? collection(firestore!, 'billing_notes', invoice.billingNoteId, 'lines') : null),
    [firestore, invoice?.billingNoteId, ready],
  );
  const { data: lines } = useCollection<BillingNoteLine>(linesQ as any);

  const customerRef = useMemoFirebase(
    () => (ready && invoice?.customerId ? doc(firestore!, 'customers', invoice.customerId) : null),
    [firestore, invoice?.customerId, ready],
  );
  const { data: customer } = useDoc<Customer>(customerRef as any);

  const companyProfileRef = useMemoFirebase(
    () => (ready ? doc(firestore!, 'system', 'company_profile') : null),
    [firestore, ready],
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
  const effectivePrintLocale = invoice
    ? invoice.printDocumentLocale ?? printLocale
    : printLocale;
  const printLocaleReadOnly = Boolean(invoice?.printDocumentLocale);
  const [notifyLoading, setNotifyLoading] = useState(false);

  const canReportPayment =
    !!invoice &&
    invoice.status === 'ISSUED' &&
    !invoice.paymentNotifiedAt &&
    !invoice.linkedReceiptId &&
    currentUser?.portalRole === 'approver';

  const handleReportPayment = useCallback(async () => {
    if (!firestore || !invoice || !currentUser) return;
    setNotifyLoading(true);
    try {
      await recordTaxInvoicePaymentNotification(firestore, invoice, currentUser as User, {
        source: 'client_portal',
      });
      toast({
        title: en ? 'Payment reported' : 'แจ้งชำระเงินแล้ว',
        description: en ? 'Accounting will verify and issue the receipt when funds are confirmed.' : 'ฝ่ายบัญชีจะตรวจและออกใบเสร็จเมื่อยืนยันรับเงิน',
      });
    } catch (e) {
      console.error(e);
      toast({
        variant: 'destructive',
        title: en ? 'Could not save' : 'บันทึกไม่ได้',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setNotifyLoading(false);
    }
  }, [firestore, invoice, currentUser, toast, en]);

  const handlePrint = useCallback(() => {
    if (!invoice) return;
    const L = invoice.printDocumentLocale ?? printLocale;
    const body = buildTaxInvoicePrintHtml({
      company: companyProfile ?? undefined,
      invoice,
      billingNote: billingNote ?? undefined,
      billingLines: lines ?? [],
      customer: customer ?? undefined,
      printedAtMs: Date.now(),
      locale: L,
    });
    if (
      !openStandardPrintWindow({
        windowTitle: invoice.taxInvoiceNo,
        bodyInnerHtml: body,
        htmlLang: L,
      })
    ) {
      toast({
        variant: 'destructive',
        title: en ? 'Popup blocked' : 'เปิดหน้าต่างพิมพ์ไม่ได้',
        description: en ? 'Allow popups for this site.' : 'กรุณาอนุญาตป๊อปอัปสำหรับเว็บไซต์นี้',
      });
    }
  }, [invoice, billingNote, lines, customer, companyProfile, printLocale, toast, en]);

  if (isUserLoading || userLoading || !currentUser) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!isClient(currentUser)) {
    return <p className="text-sm text-muted-foreground">{en ? 'Portal only.' : 'เฉพาะพอร์ทัล'}</p>;
  }

  if (!ready || isLoading || !invoice) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (invoice.customerId !== currentUser.customerId) {
    return <p className="text-destructive text-sm">{en ? 'Access denied.' : 'ไม่มีสิทธิ์เข้าถึงเอกสารนี้'}</p>;
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/client-portal/accounting?tab=tax">
          <ArrowLeft className="mr-2 h-4 w-4" />
          {en ? 'Accounting' : 'บัญชี / เอกสาร'}
        </Link>
      </Button>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>{en ? 'Print copy' : 'สำเนาสำหรับพิมพ์'}</AlertTitle>
        <AlertDescription className="text-sm">
          {en
            ? 'Printable tax invoice. The money receipt is a separate document (Receipts tab) after OPEC confirms payment.'
            : 'เอกสารนี้เป็นใบกำกับภาษี — ใบเสร็จรับเงินออกแยกหลังฝ่ายบัญชียืนยันรับเงิน (ดูแท็บ ใบเสร็จ) — ไม่ใช่ e-Tax'}
        </AlertDescription>
      </Alert>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primary">{en ? 'Tax invoice' : 'ใบกำกับภาษี'}</h1>
          <p className="font-mono text-lg font-semibold">{invoice.taxInvoiceNo}</p>
          <p className="text-sm text-muted-foreground">{formatStoredDateThaiBE(invoice.issueDate)}</p>
          {invoice.status === 'CANCELLED' && (
            <p className="mt-2 text-sm text-destructive">
              {en ? 'This document is cancelled — print only if needed for records.' : 'เอกสารนี้ยกเลิกแล้ว — พิมพ์เฉพาะกรณีเก็บประวัติ'}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DocumentPrintLocaleToggle
            printLocale={effectivePrintLocale}
            setPrintLocale={setPrintLocale}
            readOnly={printLocaleReadOnly}
            showLabel
            hint={en ? 'Document print language — use the button' : 'ภาษาเอกสารฉบับพิมพ์ — กดปุ่มเลือก'}
          />
          {canReportPayment && (
            <Button
              type="button"
              variant="secondary"
              className="gap-2"
              disabled={notifyLoading}
              onClick={() => void handleReportPayment()}
            >
              {notifyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {en ? '1. Report payment' : '1. แจ้งชำระเงิน'}
            </Button>
          )}
          <Button type="button" className="gap-2" onClick={() => handlePrint()}>
            <Printer className="h-4 w-4" />
            {en ? 'Print' : 'พิมพ์'}
          </Button>
        </div>
      </div>

      <Alert className="border-sky-200/80 bg-sky-50/50 dark:border-sky-800 dark:bg-sky-950/20">
        <AlertDescription className="text-sm text-sky-950/90 dark:text-sky-100/90">
          {printLocaleReadOnly
            ? en
              ? `This invoice was saved for printing in ${
                  effectivePrintLocale === 'en' ? 'English' : 'Thai'
                } when it was issued — matches internal accounting.`
              : `บันทึกภาษาเอกสารตอนออกฉบับจริง: ภาษา${effectivePrintLocale === 'en' ? 'อังกฤษ' : 'ไทย'} — สอดคล้องกับฝ่ายบัญชี`
            : en
              ? 'Select print language with the button above. Until an older invoice is re-saved, preview follows this device setting.'
              : 'เลือกพิมพ์เอกสารเป็นภาษา ไทย หรือ อังกฤษ ด้วยปุ่ม — ฉบับออกก่อนมีฟีลด์นี้ ใช้การตั้งค่าเครื่องนี้'}
        </AlertDescription>
      </Alert>

      <div className="space-y-2">
        <p className="text-sm font-medium">{en ? 'Line items' : 'รายการ'}</p>
        <TaxInvoiceLinesTable
          lines={lines}
          numberLocale={en ? 'en-GB' : 'th-TH'}
          currency={invoice.currency}
          columnHeaders={
            en
              ? { no: 'No', description: 'Description', qty: 'Qty', unitPrice: 'Unit', amount: 'Amount' }
              : { no: 'ลำดับ', description: 'รายการ', qty: 'จำนวน', unitPrice: 'ราคา/หน่วย', amount: 'จำนวนเงิน' }
          }
          emptyLabel={en ? 'No line items' : 'ไม่มีรายการ'}
        />
      </div>

      {invoice.paymentNotifiedAt && !invoice.linkedReceiptId && (
        <p className="text-sm text-amber-800">
          {en
            ? 'Payment reported — waiting for OPEC to confirm and issue the money receipt.'
            : 'แจ้งชำระแล้ว — รอฝ่ายบัญชียืนยันรับเงินเพื่อออกใบเสร็จ (แท็บ ใบเสร็จ)'}
        </p>
      )}

      {invoice.linkedReceiptId && (
        <p className="text-sm text-muted-foreground">
          {en ? 'Money receipt: ' : 'ใบเสร็จรับเงิน: '}
          <Button variant="link" className="h-auto p-0" asChild>
            <Link href={`/client-portal/receipt-print/${invoice.linkedReceiptId}`}>
              {en ? 'Open receipt' : 'เปิดใบเสร็จ'}
            </Link>
          </Button>
        </p>
      )}

      <div className="rounded-lg border bg-muted/30 p-4 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">{en ? 'Total' : 'รวม'}</span>
          <span className="font-bold text-primary">
            {invoice.currency} {invoice.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </span>
        </div>
        {billingNote?.billingNoteNo && (
          <p className="mt-2 text-xs text-muted-foreground">
            {en ? 'Billing note' : 'ใบวางบิล'}: {billingNote.billingNoteNo}
          </p>
        )}
      </div>
    </div>
  );
}
