'use client';

/**
 * Client portal: พิมพ์ใบกำกับภาษี — ใบเสร็จรับเงินเป็นเอกสารต่างหลัง (แท็บ ใบเสร็จ)
 */
import { use, useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Printer, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { BillingNote, BillingNoteLine, CommercialInvoice, Customer, TaxInvoice, User } from '@/lib/types';
import { recordTaxInvoicePaymentNotification } from '@/lib/services/money-receipt-service';
import { useFirestore, useDoc, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { doc, collection } from 'firebase/firestore';
import { useClientPortalIdentity } from '@/contexts/client-portal-user-context';
import { formatStoredDateGregorian, formatStoredDateThaiBE } from '@/lib/date-thai';
import { printT } from '@/lib/documents/document-print-i18n';
import type { PrintDocumentLocale } from '@/lib/documents/document-print-i18n';
import { roundMoney2 } from '@/lib/ops/purchase-payment-milestones';
import { useToast } from '@/hooks/use-toast';
import {
  buildTaxInvoicePrintHtml,
  companyProfileAddressForPrintLocale,
  openStandardPrintWindow,
} from '@/lib/documents/standard-document-print';
import { useDocumentPrintLocale } from '@/hooks/use-document-print-locale';
import { DocumentPrintLocaleToggle } from '@/components/documents/document-print-locale-toggle';
import { TaxInvoiceLinesTable } from '@/components/documents/tax-invoice-lines-table';
import { usePortalLocale } from '@/contexts/portal-locale-context';

export default function ClientTaxPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { effectiveUser: currentUser, appUserLoading: userLoading, canAccessPortal } = useClientPortalIdentity();
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { locale } = usePortalLocale();
  const en = locale === 'en';

  const ready = Boolean(firestore && currentUser && canAccessPortal);

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

  const sourceCommercialRef = useMemoFirebase(
    () =>
      ready && invoice?.sourceCommercialInvoiceId
        ? doc(firestore!, 'commercial_invoices', invoice.sourceCommercialInvoiceId)
        : null,
    [firestore, invoice?.sourceCommercialInvoiceId, ready],
  );
  const { data: sourceCommercial } = useDoc<CommercialInvoice>(sourceCommercialRef as any);

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

  const issueLabelPreview = useMemo(
    () =>
      printLocale === 'en'
        ? formatStoredDateGregorian(invoice?.issueDate ?? '')
        : formatStoredDateThaiBE(invoice?.issueDate ?? ''),
    [invoice?.issueDate, printLocale],
  );

  const totalsPreview = useMemo(() => {
    if (!invoice) return null;
    const L = printLocale as PrintDocumentLocale;
    const numLoc = L === 'en' ? 'en-GB' : 'th-TH';
    const fmt = (n: number) => n.toLocaleString(numLoc, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const vatPct = billingNote ? Number(billingNote.vatPercent) || 0 : 7;
    const vatRowLabel = vatPct > 0 ? `${printT(L, 'vat')} ${vatPct}%` : printT(L, 'vat');
    const whtAmt = Number(invoice.withholdingTaxAmount) || 0;
    const rateDoc = Number(invoice.withholdingTaxRatePercentOnDocument ?? 3);
    const showWhtOnDoc = invoice.showWithholdingOnDocument === true && whtAmt > 0.005;
    const netPayable = roundMoney2(invoice.totalAmount - whtAmt);
    return { fmt, vatRowLabel, showWhtOnDoc, whtAmt, rateDoc, netPayable };
  }, [invoice, billingNote, printLocale]);

  /** สอดคล้องกับ footer พิมพ์: ผู้ออก (ISSUED) → ผู้สร้างร่าง → ใบวางบิล */
  const preparedByPreview = useMemo(() => {
    const fromIssued = (invoice?.issuedByName || '').trim();
    if (fromIssued) return fromIssued;
    const fromCreated = (invoice?.createdByName || '').trim();
    if (fromCreated) return fromCreated;
    const fromBn = (billingNote?.createdBy || '').trim();
    if (fromBn) return fromBn;
    return '—';
  }, [invoice?.issuedByName, invoice?.createdByName, billingNote?.createdBy]);

  const companyTitlePreview = useMemo(() => {
    const nameTh = companyProfile?.companyNameTh?.trim();
    const nameEn = companyProfile?.companyNameEn?.trim();
    return printLocale === 'en' ? nameEn || nameTh || '—' : nameTh || nameEn || '—';
  }, [companyProfile?.companyNameEn, companyProfile?.companyNameTh, printLocale]);

  const companyAddressPreview = useMemo(() => {
    const raw = companyProfileAddressForPrintLocale(companyProfile, printLocale as PrintDocumentLocale);
    return raw.replace(/\s+/g, ' ').trim();
  }, [companyProfile, printLocale]);

  const handlePrint = useCallback(async () => {
    if (!invoice) return;
    const L = printLocale;
    const body = buildTaxInvoicePrintHtml({
      company: companyProfile ?? undefined,
      invoice,
      billingNote: billingNote ?? undefined,
      billingLines: lines ?? [],
      customer: customer ?? undefined,
      sourceCommercialInvoice: sourceCommercial ?? null,
      printedAtMs: Date.now(),
      locale: L,
    });
    if (
      !(await openStandardPrintWindow({
        windowTitle: invoice.taxInvoiceNo,
        bodyInnerHtml: body,
        htmlLang: L,
        onClipboardFilenameCopied: () => {
          toast({
            title: en ? 'Suggested filename copied' : 'คัดลอกชื่อไฟล์แนะนำแล้ว',
            description: en
              ? 'If the save dialog has no filename, click the field and press Ctrl+V or Shift+Insert. Or use the browser “Save as PDF” printer instead of Microsoft Print to PDF.'
              : 'ถ้าไม่มีชื่อไฟล์ — คลิกในช่องแล้ว Ctrl+V หรือ Shift+Insert หรือคลิกขวาแล้ววาง · หรือใช้ Save as PDF ของเบราว์เซอร์แทน Microsoft Print to PDF',
          });
        },
      }))
    ) {
      toast({
        variant: 'destructive',
        title: en ? 'Popup blocked' : 'เปิดหน้าต่างพิมพ์ไม่ได้',
        description: en ? 'Allow popups for this site.' : 'กรุณาอนุญาตป๊อปอัปสำหรับเว็บไซต์นี้',
      });
    }
  }, [invoice, billingNote, lines, customer, companyProfile, printLocale, sourceCommercial, toast, en]);

  if (isUserLoading || userLoading || !currentUser) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!canAccessPortal) {
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

  const docL = printLocale as PrintDocumentLocale;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 pb-12">
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
            ? 'Printable tax invoice. The receipt is a separate document (Receipts tab) after OPEC confirms payment.'
            : 'เอกสารนี้เป็นใบกำกับภาษี — ใบเสร็จรับเงินออกแยกหลังฝ่ายบัญชียืนยันรับเงิน (ดูแท็บ ใบเสร็จ) — ไม่ใช่ e-Tax'}
        </AlertDescription>
      </Alert>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primary">{en ? 'Tax invoice' : 'ใบกำกับภาษี'}</h1>
          <p className="font-mono text-lg font-semibold">{invoice.taxInvoiceNo}</p>
          <p className="text-sm text-muted-foreground">{issueLabelPreview}</p>
          {invoice.status === 'CANCELLED' && (
            <p className="mt-2 text-sm text-destructive">
              {en ? 'This document is cancelled — print only if needed for records.' : 'เอกสารนี้ยกเลิกแล้ว — พิมพ์เฉพาะกรณีเก็บประวัติ'}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DocumentPrintLocaleToggle
            printLocale={printLocale}
            setPrintLocale={setPrintLocale}
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
          {en
            ? 'Preview below follows the official tax invoice layout (same as Print). Use Thai/English for labels with the toggle.'
            : 'พรีวิวด้านล่างจัดเลย์เอาต์แบบใบกำกับภาษีจริง (เท่ากับปุ่มพิมพ์) — สลับไทย/อังกฤษที่ปุ่มด้านบน'}
        </AlertDescription>
      </Alert>

      <div className="overflow-hidden rounded-lg border border-neutral-300 bg-white shadow-sm dark:border-neutral-700 dark:bg-card">
        <div className="border-b border-neutral-200 px-6 py-5 dark:border-neutral-700">
          <div className="flex flex-col gap-6 lg:flex-row lg:justify-between lg:gap-8">
            <div className="min-w-0 flex-1 space-y-1.5 text-sm leading-snug">
              <p className="text-lg font-bold leading-tight text-neutral-900 dark:text-neutral-50">{companyTitlePreview}</p>
              {companyAddressPreview ? (
                <p className="text-muted-foreground whitespace-pre-wrap">{companyAddressPreview}</p>
              ) : null}
              <p className="text-muted-foreground">
                {companyProfile?.phone ? `${printT(docL, 'tel')} ${companyProfile.phone}` : null}
                {companyProfile?.phone && companyProfile?.email ? ' · ' : null}
                {companyProfile?.email ? `${printT(docL, 'email')}: ${companyProfile.email}` : null}
              </p>
              {companyProfile?.taxId ? (
                <p className="text-muted-foreground">
                  {printT(docL, 'taxId')}: {companyProfile.taxId}
                </p>
              ) : null}
            </div>
            <div className="shrink-0 space-y-1 text-right lg:max-w-[14rem]">
              <p className="text-xl font-bold text-teal-700 dark:text-teal-400">
                {docL === 'en' ? 'Tax Invoice' : 'ใบกำกับภาษี'}
              </p>
              <p className="text-xs font-medium text-muted-foreground">{printT(docL, 'docOriginal')}</p>
              <p className="text-sm">
                {printT(docL, 'dateIssued')} {issueLabelPreview}
              </p>
              <p className="font-mono text-sm font-semibold">
                {printT(docL, 'docNo')}: {invoice.taxInvoiceNo}
              </p>
              <p className="text-[11px] text-muted-foreground">{printT(docL, 'docIssuedAsSet')}</p>
            </div>
          </div>
        </div>

        {customer ? (
          <div className="border-b border-neutral-200 bg-muted/25 px-6 py-4 dark:border-neutral-700">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {printT(docL, 'customerBuyer')}
            </p>
            <p className="mt-1 font-semibold text-foreground">{customer.name}</p>
            <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{customer.registeredAddress}</p>
            {customer.taxId ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {printT(docL, 'taxId')}: {customer.taxId}
              </p>
            ) : null}
            {customer.phone ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {printT(docL, 'tel')} {customer.phone}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="px-4 py-4 sm:px-6">
          <TaxInvoiceLinesTable
            lines={lines}
            commercialLines={sourceCommercial?.lines}
            documentLocale={docL}
            numberLocale={docL === 'en' ? 'en-GB' : 'th-TH'}
            currency={invoice.currency}
            columnHeaders={{
              no: printT(docL, 'colNo'),
              description: printT(docL, 'description'),
              qty: printT(docL, 'qty'),
              unitPrice: printT(docL, 'unitPrice'),
              amount: printT(docL, 'amount'),
            }}
            emptyLabel={en ? 'No line items' : 'ไม่มีรายการ'}
          />
        </div>

        {totalsPreview ? (
          <div className="border-t border-neutral-200 bg-muted/15 px-6 py-4 text-sm dark:border-neutral-700">
            <div className="ml-auto flex max-w-md flex-col gap-2">
              <div className="flex justify-between gap-6">
                <span>{printT(docL, 'taxableBase')}</span>
                <span className="tabular-nums font-medium">{totalsPreview.fmt(invoice.taxableAmount)}</span>
              </div>
              <div className="flex justify-between gap-6">
                <span>{totalsPreview.vatRowLabel}</span>
                <span className="tabular-nums font-medium">{totalsPreview.fmt(invoice.vatAmount)}</span>
              </div>
              {totalsPreview.showWhtOnDoc ? (
                <>
                  <div className="flex justify-between gap-6 border-t border-dashed pt-2">
                    <span>{printT(docL, 'invoiceTotalInclVat')}</span>
                    <span className="tabular-nums font-semibold">{totalsPreview.fmt(invoice.totalAmount)}</span>
                  </div>
                  <div className="flex justify-between gap-6">
                    <span>{`${printT(docL, 'wht')} (${totalsPreview.rateDoc}%)`}</span>
                    <span className="tabular-nums font-medium text-destructive">
                      -{totalsPreview.fmt(totalsPreview.whtAmt)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-6 rounded-md border border-neutral-400 bg-neutral-100 px-3 py-2 dark:border-neutral-600 dark:bg-neutral-800">
                    <span className="font-bold">{printT(docL, 'netPayableAfterWht')}</span>
                    <span className="font-bold tabular-nums">
                      ฿ {totalsPreview.fmt(totalsPreview.netPayable)}
                    </span>
                  </div>
                </>
              ) : (
                <div className="flex justify-between gap-6 border-t border-dashed pt-2">
                  <span className="font-bold">{printT(docL, 'grandTotal')}</span>
                  <span className="font-bold tabular-nums text-primary">
                    ฿ {totalsPreview.fmt(invoice.totalAmount)}
                  </span>
                </div>
              )}
            </div>
            {billingNote?.billingNoteNo ? (
              <p className="mt-4 text-xs text-muted-foreground">
                {printT(docL, 'refBillingNote')}: {billingNote.billingNoteNo}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-8 border-t border-neutral-200 px-6 py-8 text-center text-xs text-muted-foreground dark:border-neutral-700 sm:grid-cols-2">
          <div>
            <div className="mx-auto mb-8 max-w-[85%] border-t border-dotted border-neutral-400 pt-2 dark:border-neutral-600">
              <div>{printT(docL, 'signPreparedAccounting')}</div>
              <div className="mt-1 font-medium text-foreground">{preparedByPreview}</div>
            </div>
          </div>
          <div>
            <div className="mx-auto mb-8 max-w-[85%] border-t border-dotted border-neutral-400 pt-2 dark:border-neutral-600">
              {printT(docL, 'signCustomerAuth')}
            </div>
          </div>
        </div>
      </div>

      {invoice.paymentNotifiedAt && !invoice.linkedReceiptId && (
        <p className="text-sm text-amber-800">
          {en
            ? 'Payment reported — waiting for OPEC to confirm and issue the receipt.'
            : 'แจ้งชำระแล้ว — รอฝ่ายบัญชียืนยันรับเงินเพื่อออกใบเสร็จ (แท็บ ใบเสร็จ)'}
        </p>
      )}

      {invoice.linkedReceiptId && (
        <p className="text-sm text-muted-foreground">
          {en ? 'Receipt: ' : 'ใบเสร็จรับเงิน: '}
          <Button variant="link" className="h-auto p-0" asChild>
            <Link href={`/client-portal/receipt-print/${invoice.linkedReceiptId}`}>
              {en ? 'Open receipt' : 'เปิดใบเสร็จ'}
            </Link>
          </Button>
        </p>
      )}
    </div>
  );
}
