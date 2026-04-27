'use client';

import { use, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Loader2, Printer } from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import type { Customer, MoneyReceipt, TaxInvoice, User } from '@/lib/types';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';
import { formatStoredDateThaiBE } from '@/lib/date-thai';
import { useToast } from '@/hooks/use-toast';
import { buildMoneyReceiptPrintHtml, openStandardPrintWindow } from '@/lib/documents/standard-document-print';
import { useDocumentPrintLocale } from '@/hooks/use-document-print-locale';
import { DocumentPrintLocaleToggle } from '@/components/documents/document-print-locale-toggle';
import Link from 'next/link';

export default function MoneyReceiptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { printLocale, setPrintLocale } = useDocumentPrintLocale();

  const allowed = Boolean(currentUser && canView(currentUser, 'receipts'));

  const rRef = useMemoFirebase(
    () => (firestore && allowed ? doc(firestore, 'receipts', id) : null),
    [firestore, id, allowed],
  );
  const { data: receipt, isLoading } = useDoc<MoneyReceipt>(rRef as any);

  const tRef = useMemoFirebase(
    () => (firestore && receipt ? doc(firestore, 'tax_invoices', receipt.taxInvoiceId) : null),
    [firestore, receipt?.taxInvoiceId],
  );
  const { data: taxInv } = useDoc<TaxInvoice>(tRef as any);

  const cRef = useMemoFirebase(
    () => (firestore && receipt ? doc(firestore, 'customers', receipt.customerId) : null),
    [firestore, receipt?.customerId],
  );
  const { data: customer } = useDoc<Customer>(cRef as any);

  const companyRef = useMemoFirebase(
    () => (firestore ? doc(firestore, 'system', 'company_profile') : null),
    [firestore],
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
        title: 'เปิดหน้าต่างพิมพ์ไม่ได้',
        description: 'กรุณาอนุญาตป๊อปอัป',
      });
    }
  }, [receipt, taxInv, companyProfile, customer, printLocale, toast]);

  if (userLoading || !currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!allowed) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <p className="text-sm text-muted-foreground">ไม่มีสิทธิ์</p>
      </AppShell>
    );
  }

  if (isLoading || !receipt) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser as User} onLogout={() => {}}>
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.push('/receipts')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">ใบเสร็จรับเงิน</h1>
              <p className="font-mono text-sm font-bold text-primary">{receipt.receiptNo}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DocumentPrintLocaleToggle printLocale={printLocale} setPrintLocale={setPrintLocale} showLabel />
            <Button variant="outline" className="gap-2" type="button" onClick={handlePrint}>
              <Printer className="h-4 w-4" /> พิมพ์
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>รายละเอียด</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">ลูกค้า: </span>
              {customer?.name ?? '—'}
            </p>
            <p>
              <span className="text-muted-foreground">อ้างอิงใบกำกับ: </span>
              {receipt.taxInvoiceNo}
            </p>
            <p>
              <span className="text-muted-foreground">วันที่: </span>
              {formatStoredDateThaiBE(receipt.receiptDate)}
            </p>
            <p>
              <span className="text-muted-foreground">ยอด: </span>
              {receipt.currency} {receipt.amount.toLocaleString()}
            </p>
            {taxInv && (
              <p>
                <Button variant="link" className="h-auto p-0" asChild>
                  <Link href={`/tax-invoices/${taxInv.id}`}>เปิดใบกำกับภาษีต้นทาง</Link>
                </Button>
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
