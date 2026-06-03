'use client';

import { use, useCallback, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Printer, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { Customer, MoneyReceipt, TaxInvoice } from '@/lib/types';
import { useFirestore, useDoc, useMemoFirebase, useUser } from '@/firebase';
import { doc } from 'firebase/firestore';
import { useClientPortalIdentity } from '@/contexts/client-portal-user-context';
import { formatStoredDateThaiBE } from '@/lib/date-thai';
import { useToast } from '@/hooks/use-toast';
import {
  buildMoneyReceiptPrintHtml,
  openStandardPrintWindow,
  type TaxInvoicePrintSheet,
} from '@/lib/documents/standard-document-print';
import { useDocumentPrintLocale } from '@/hooks/use-document-print-locale';
import { DocumentPrintLocaleToggle } from '@/components/documents/document-print-locale-toggle';
import { usePortalLocale } from '@/contexts/portal-locale-context';

const RECEIPT_PRINT_PRESETS: Record<
  'p1' | 'p2' | 'p3',
  { sheets: TaxInvoicePrintSheet[]; label: string; labelEn: string }
> = {
  p1: {
    sheets: ['original', 'copy'],
    label: 'ต้นฉบับ 1 แผ่น + สำเนา 1 แผ่น',
    labelEn: '1 original + 1 copy',
  },
  p2: {
    sheets: ['original', 'copy', 'copy'],
    label: 'ต้นฉบับ 1 แผ่น + สำเนา 2 แผ่น',
    labelEn: '1 original + 2 copies',
  },
  p3: { sheets: ['copy'], label: 'สำเนา 1 แผ่น', labelEn: '1 copy' },
};

export default function ClientReceiptPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { effectiveUser: currentUser, appUserLoading: userLoading, canAccessPortal } = useClientPortalIdentity();
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { locale } = usePortalLocale();
  const en = locale === 'en';
  const { printLocale, setPrintLocale } = useDocumentPrintLocale();
  const [printPresetOpen, setPrintPresetOpen] = useState(false);
  const [receiptPrintPreset, setReceiptPrintPreset] = useState<'p1' | 'p2' | 'p3'>('p1');

  const ready = Boolean(firestore && currentUser && canAccessPortal);

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

  const executeReceiptPrint = useCallback(
    async (sheets: TaxInvoicePrintSheet[]) => {
      if (!receipt || !taxInv) return;
      const body = buildMoneyReceiptPrintHtml({
        company: companyProfile ?? undefined,
        receipt,
        taxInvoice: taxInv,
        customer: customer ?? undefined,
        printedAtMs: Date.now(),
        locale: printLocale,
        sheets,
      });
      if (
        !(await openStandardPrintWindow({
          windowTitle: receipt.receiptNo,
          bodyInnerHtml: body,
          htmlLang: printLocale,
        }))
      ) {
        toast({
          variant: 'destructive',
          title: en ? 'Popup blocked' : 'เปิดหน้าต่างพิมพ์ไม่ได้',
          description: en ? 'Allow popups for this site.' : 'กรุณาอนุญาตป๊อปอัป',
        });
      }
    },
    [receipt, taxInv, companyProfile, customer, printLocale, toast, en],
  );

  const handlePrint = useCallback(() => {
    if (!receipt || !taxInv) return;
    setReceiptPrintPreset('p1');
    setPrintPresetOpen(true);
  }, [receipt, taxInv]);

  const handleConfirmPrint = useCallback(() => {
    const preset = RECEIPT_PRINT_PRESETS[receiptPrintPreset];
    void executeReceiptPrint(preset.sheets);
    setPrintPresetOpen(false);
  }, [receiptPrintPreset, executeReceiptPrint]);

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
        <AlertTitle>{en ? 'Receipt' : 'ใบเสร็จรับเงิน'}</AlertTitle>
        <AlertDescription className="text-sm">
          {en
            ? 'This receipt was issued after OPEC confirmed payment. Not e-Tax print.'
            : 'ออกหลังบัญชียืนยันรับเงิน ตามยอดและเลขที่ใบกำกับภาษี — ไม่ใช่ e-Tax'}
        </AlertDescription>
      </Alert>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primary">{en ? 'Receipt' : 'ใบเสร็จรับเงิน'}</h1>
          <p className="font-mono text-lg font-semibold">{receipt.receiptNo}</p>
          <p className="text-sm text-muted-foreground">
            {en ? 'Tax inv.' : 'อ้างอิง ใบกำกับ'}: {receipt.taxInvoiceNo} · {formatStoredDateThaiBE(receipt.receiptDate)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DocumentPrintLocaleToggle printLocale={printLocale} setPrintLocale={setPrintLocale} showLabel />
          <Button type="button" className="gap-2" onClick={handlePrint}>
            <Printer className="h-4 w-4" />
            {en ? 'Print' : 'พิมพ์'}
          </Button>
        </div>
      </div>

      <Dialog open={printPresetOpen} onOpenChange={setPrintPresetOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{en ? 'Select print type' : 'เลือกชุดพิมพ์ใบเสร็จรับเงิน'}</DialogTitle>
            <DialogDescription>
              {en
                ? 'Each page shows "Original" or "Copy" under the document title, with "Document issued as a set".'
                : 'แต่ละแผ่นแสดง "ต้นฉบับ" หรือ "สำเนา" ใต้ชื่อเอกสาร พร้อมข้อความ "เอกสารออกเป็นชุด"'}
            </DialogDescription>
          </DialogHeader>
          <RadioGroup
            value={receiptPrintPreset}
            onValueChange={(v) => setReceiptPrintPreset(v as 'p1' | 'p2' | 'p3')}
            className="gap-3"
          >
            {(Object.keys(RECEIPT_PRINT_PRESETS) as Array<'p1' | 'p2' | 'p3'>).map(
              (key) => (
                <div key={key} className="flex items-start gap-3 rounded-lg border p-3">
                  <RadioGroupItem value={key} id={`receipt-print-${key}`} className="mt-1" />
                  <Label htmlFor={`receipt-print-${key}`} className="cursor-pointer font-normal leading-snug flex-1">
                    <span className="font-semibold">
                      {en ? RECEIPT_PRINT_PRESETS[key].labelEn : RECEIPT_PRINT_PRESETS[key].label}
                    </span>
                  </Label>
                </div>
              ),
            )}
          </RadioGroup>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setPrintPresetOpen(false)}>
              {en ? 'Cancel' : 'ยกเลิก'}
            </Button>
            <Button type="button" onClick={handleConfirmPrint}>
              {en ? 'Print' : 'พิมพ์'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
