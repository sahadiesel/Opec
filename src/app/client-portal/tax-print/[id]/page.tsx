'use client';

/**
 * พิมพ์ใบกำกับภาษี / ใบเสร็จรับเงิน (ฉบับเดียว) สำหรับลูกค้าใน Portal
 * — ใช้เมื่อสถานะ ISSUED หรือต้องการพิมพ์ซ้ำ (ลิงก์จาก Accounting hub)
 */
import { use, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Printer, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { BillingNote, BillingNoteLine, Customer, TaxInvoice } from '@/lib/types';
import { useFirestore, useDoc, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { doc, collection } from 'firebase/firestore';
import { isClient } from '@/lib/permissions';
import { useAppUser } from '@/hooks/use-app-user';
import { formatStoredDateThaiBE } from '@/lib/date-thai';
import { useToast } from '@/hooks/use-toast';
import { buildTaxInvoicePrintHtml, openStandardPrintWindow } from '@/lib/documents/standard-document-print';
import { useDocumentPrintLocale } from '@/hooks/use-document-print-locale';
import { DocumentPrintLocaleToggle } from '@/components/documents/document-print-locale-toggle';
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

  const handlePrint = useCallback(() => {
    if (!invoice) return;
    const body = buildTaxInvoicePrintHtml({
      company: companyProfile ?? undefined,
      invoice,
      billingNote: billingNote ?? undefined,
      billingLines: lines ?? [],
      customer: customer ?? undefined,
      printedAtMs: Date.now(),
      locale: printLocale,
    });
    if (
      !openStandardPrintWindow({
        windowTitle: invoice.taxInvoiceNo,
        bodyInnerHtml: body,
        htmlLang: printLocale,
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
        <Link href="/client-portal/accounting?tab=invoices">
          <ArrowLeft className="mr-2 h-4 w-4" />
          {en ? 'Accounting' : 'บัญชี / เอกสาร'}
        </Link>
      </Button>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>{en ? 'Print copy' : 'สำเนาสำหรับพิมพ์'}</AlertTitle>
        <AlertDescription className="text-sm">
          {en
            ? 'This is a single printable document (tax invoice / receipt combined). Not e-Tax — print like other OPEC documents.'
            : 'เอกสารฉบับเดียว (ใบกำกับภาษี / ใบเสร็จรับเงิน) — ไม่ใช่ e-Tax พิมพ์ตามปกติเหมือนเอกสารอื่นของ OPEC'}
        </AlertDescription>
      </Alert>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primary">
            {en ? 'Tax invoice / receipt' : 'ใบกำกับภาษี / ใบเสร็จรับเงิน'}
          </h1>
          <p className="font-mono text-lg font-semibold">{invoice.taxInvoiceNo}</p>
          <p className="text-sm text-muted-foreground">{formatStoredDateThaiBE(invoice.issueDate)}</p>
          {invoice.status === 'CANCELLED' && (
            <p className="mt-2 text-sm text-destructive">
              {en ? 'This document is cancelled — print only if needed for records.' : 'เอกสารนี้ยกเลิกแล้ว — พิมพ์เฉพาะกรณีเก็บประวัติ'}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DocumentPrintLocaleToggle printLocale={printLocale} setPrintLocale={setPrintLocale} showLabel />
          <Button type="button" className="gap-2" onClick={() => handlePrint()}>
            <Printer className="h-4 w-4" />
            {en ? 'Print' : 'พิมพ์'}
          </Button>
        </div>
      </div>

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
