'use client';

import { use, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Printer, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { Customer, MoneyReceipt, TaxInvoice, User } from '@/lib/types';
import { useFirestore, useDoc, useMemoFirebase, useUser } from '@/firebase';
import { doc } from 'firebase/firestore';
import { isClient } from '@/lib/permissions';
import { useAppUser } from '@/hooks/use-app-user';
import { formatStoredDateThaiBE } from '@/lib/date-thai';
import { useToast } from '@/hooks/use-toast';
import { buildMoneyReceiptPrintHtml, openStandardPrintWindow } from '@/lib/documents/standard-document-print';
import { useDocumentPrintLocale } from '@/hooks/use-document-print-locale';
import { DocumentPrintLocaleToggle } from '@/components/documents/document-print-locale-toggle';
import { usePortalLocale } from '@/contexts/portal-locale-context';

export default function ClientReceiptPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { locale } = usePortalLocale();
  const en = locale === 'en';
  const { printLocale, setPrintLocale } = useDocumentPrintLocale();

  const ready = Boolean(firestore && currentUser && isClient(currentUser));

  const rRef = useMemoFirebase(() => (ready ? doc(firestore!, 'receipts', id) : null), [firestore, id, ready]);
  const { data: receipt, isLoading } = useDoc<MoneyReceipt>(rRef as any);

  const tRef = useMemoFirebase(
    () => (ready && receipt ? doc(firestore!, 'tax_invoices', receipt.taxInvoiceId) : null),
    [firestore, receipt?.taxInvoiceId, ready],
  );
  const { data: taxInv } = useDoc<TaxInvoice>(tRef as any);

  const customerRef = useMemoFirebase(
    () => (ready && receipt ? doc(firestore!, 'customers', receipt.customerId) : null),
    [firestore, receipt?.customerId, ready],
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

  const handlePrint = useCallback(() => {
    if (!receipt || !taxInv) return;
    const body = buildMoneyReceiptPrintHtml({
      company: companyProfile ?? undefined,
      receipt,
      taxInvoice: taxInv,
      customer: customer ?? undefined,
      printedAtMs: Date.now(),
      locale: printLocale,
    });
    if (
      !openStandardPrintWindow({
        windowTitle: receipt.receiptNo,
        bodyInnerHtml: body,
        htmlLang: printLocale,
      })
    ) {
      toast({
        variant: 'destructive',
        title: en ? 'Popup blocked' : 'เปิดหน้าต่างพิมพ์ไม่ได้',
        description: en ? 'Allow popups for this site.' : 'กรุณาอนุญาตป๊อปอัป',
      });
    }
  }, [receipt, taxInv, companyProfile, customer, printLocale, toast, en]);

  if (isUserLoading || userLoading || !currentUser) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!isClient(currentUser as User)) {
    return <p className="text-sm text-muted-foreground">{en ? 'Portal only.' : 'เฉพาะพอร์ทัล'}</p>;
  }

  if (!ready || isLoading || !receipt) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (receipt.customerId !== currentUser?.customerId) {
    return <p className="text-destructive text-sm">{en ? 'Access denied.' : 'ไม่มีสิทธิ์'}</p>;
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/client-portal/accounting?tab=receipts">
          <ArrowLeft className="mr-2 h-4 w-4" />
          {en ? 'Back' : 'กลับ'}
        </Link>
      </Button>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>{en ? 'Money receipt' : 'ใบเสร็จรับเงิน'}</AlertTitle>
        <AlertDescription className="text-sm">
          {en
            ? 'This receipt was issued after OPEC confirmed payment. Not e-Tax print.'
            : 'ออกหลังบัญชียืนยันรับเงิน ตามยอดและเลขที่ใบกำกับภาษี — ไม่ใช่ e-Tax'}
        </AlertDescription>
      </Alert>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primary">{en ? 'Money receipt' : 'ใบเสร็จรับเงิน'}</h1>
          <p className="font-mono text-lg font-semibold">{receipt.receiptNo}</p>
          <p className="text-sm text-muted-foreground">
            {en ? 'Tax inv.' : 'อ้างอิง ใบกำกับ'}: {receipt.taxInvoiceNo} · {formatStoredDateThaiBE(receipt.receiptDate)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DocumentPrintLocaleToggle printLocale={printLocale} setPrintLocale={setPrintLocale} showLabel />
          <Button type="button" className="gap-2" onClick={() => handlePrint()}>
            <Printer className="h-4 w-4" />
            {en ? 'Print' : 'พิมพ์'}
          </Button>
        </div>
      </div>
    </div>
  );
}
