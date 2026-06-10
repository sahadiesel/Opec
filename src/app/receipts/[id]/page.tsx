'use client';

import { use, useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { AlertTriangle, ArrowLeft, Loader2, Printer, Wrench } from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import type { Customer, MoneyReceipt, TaxInvoice, User } from '@/lib/types';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';
import { isSimpleAccounting } from '@/lib/simple-tier-model';
import { isSystemAdmin } from '@/lib/permission-core';
import { formatStoredDateThaiBE } from '@/lib/date-thai';
import { useToast } from '@/hooks/use-toast';
import {
  buildMoneyReceiptPrintHtml,
  openStandardPrintWindow,
  type TaxInvoicePrintSheet,
} from '@/lib/documents/standard-document-print';
import { useDocumentPrintLocale } from '@/hooks/use-document-print-locale';
import { DocumentPrintLocaleToggle } from '@/components/documents/document-print-locale-toggle';
import { detectMoneyReceiptWhtUndercharge } from '@/lib/accounting/money-receipt-wht-amount';
import { fixMoneyReceiptWhtAmount } from '@/lib/services/money-receipt-wht-fix-service';
import Link from 'next/link';

const RECEIPT_PRINT_PRESETS: Record<
  'p1' | 'p2' | 'p3',
  { sheets: TaxInvoicePrintSheet[]; label: string }
> = {
  p1: { sheets: ['original', 'copy'], label: 'ต้นฉบับ 1 แผ่น + สำเนา 1 แผ่น' },
  p2: { sheets: ['original', 'copy', 'copy'], label: 'ต้นฉบับ 1 แผ่น + สำเนา 2 แผ่น' },
  p3: { sheets: ['copy'], label: 'สำเนา 1 แผ่น' },
};

export default function MoneyReceiptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { printLocale, setPrintLocale } = useDocumentPrintLocale();
  const [printPresetOpen, setPrintPresetOpen] = useState(false);
  const [receiptPrintPreset, setReceiptPrintPreset] = useState<'p1' | 'p2' | 'p3'>('p1');
  const [fixOpen, setFixOpen] = useState(false);
  const [fixLoading, setFixLoading] = useState(false);

  const allowed = Boolean(currentUser && canView(currentUser, 'receipts'));
  const canFixReceipt = Boolean(
    currentUser && (isSystemAdmin(currentUser) || isSimpleAccounting(currentUser)),
  );

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

  const whtFixPreview = useMemo(() => {
    if (!taxInv) return null;
    return detectMoneyReceiptWhtUndercharge(taxInv, receipt?.amount ?? 0);
  }, [taxInv, receipt?.amount]);

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
          title: 'เปิดหน้าต่างพิมพ์ไม่ได้',
          description: 'กรุณาอนุญาตป๊อปอัป',
        });
      }
    },
    [receipt, taxInv, companyProfile, customer, printLocale, toast],
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

  const handleApplyWhtFix = useCallback(async () => {
    if (!firestore || !receipt || !taxInv || !currentUser || !whtFixPreview) return;
    setFixLoading(true);
    try {
      const result = await fixMoneyReceiptWhtAmount(firestore, receipt, taxInv, currentUser as User);
      setFixOpen(false);
      toast({
        title: 'แก้ยอดใบเสร็จแล้ว',
        description: `ยอดใหม่ ${result.toAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })} (รวม VAT ตามใบกำกับ)`,
      });
    } catch (e) {
      console.error(e);
      toast({
        variant: 'destructive',
        title: 'แก้ใบเสร็จไม่สำเร็จ',
        description: e instanceof Error ? e.message : 'ลองใหม่',
      });
    } finally {
      setFixLoading(false);
    }
  }, [firestore, receipt, taxInv, currentUser, whtFixPreview, toast]);

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

        {canFixReceipt && whtFixPreview ? (
          <Card className="border-amber-300 bg-amber-50/80 dark:bg-amber-950/20">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base text-amber-900 dark:text-amber-100">
                <AlertTriangle className="h-4 w-4" />
                ยอดใบเสร็จไม่ตรงใบกำกับ (หัก ณ ที่จ่าย)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>
                ยอดปัจจุบัน{' '}
                <span className="font-mono font-semibold">
                  {receipt.currency}{' '}
                  {whtFixPreview.currentAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>{' '}
                ควรเป็น{' '}
                <span className="font-mono font-semibold text-primary">
                  {receipt.currency}{' '}
                  {whtFixPreview.expectedAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>{' '}
                (ฐานภาษี + VAT)
              </p>
              <p className="text-xs text-muted-foreground">
                การแก้ไขจะปรับยอดเอกสารและลูกหนี้ (AR) — ไม่แตะยอด Cashbook/ธนาคาร (เงินโอนจริง)
              </p>
              <Button type="button" variant="default" className="gap-2" onClick={() => setFixOpen(true)}>
                <Wrench className="h-4 w-4" />
                แก้ยอดใบเสร็จ
              </Button>
            </CardContent>
          </Card>
        ) : null}

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
            {receipt.cashbookEntryNo ? (
              <p>
                <span className="text-muted-foreground">รายการ Cashbook: </span>
                <Link href="/cashbook" className="font-mono text-primary underline">
                  {receipt.cashbookEntryNo}
                </Link>
              </p>
            ) : null}
            {taxInv && (
              <p>
                <Button variant="link" className="h-auto p-0" asChild>
                  <Link href={`/tax-invoices/${taxInv.id}`}>เปิดใบกำกับภาษีต้นทาง</Link>
                </Button>
              </p>
            )}
          </CardContent>
        </Card>

        <Dialog open={printPresetOpen} onOpenChange={setPrintPresetOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>เลือกชุดพิมพ์ใบเสร็จรับเงิน</DialogTitle>
              <DialogDescription>
                แต่ละแผ่นแสดง &quot;ต้นฉบับ&quot; หรือ &quot;สำเนา&quot; ใต้ชื่อเอกสาร พร้อมข้อความ &quot;เอกสารออกเป็นชุด&quot;
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
                      <span className="font-semibold">{RECEIPT_PRINT_PRESETS[key].label}</span>
                    </Label>
                  </div>
                ),
              )}
            </RadioGroup>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setPrintPresetOpen(false)}>
                ยกเลิก
              </Button>
              <Button type="button" onClick={handleConfirmPrint}>
                พิมพ์
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={fixOpen} onOpenChange={setFixOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>แก้ยอดใบเสร็จเป็นยอดรวม (รวม VAT)</DialogTitle>
              <DialogDescription>
                {whtFixPreview
                  ? `${receipt.receiptNo}: ${whtFixPreview.currentAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })} → ${whtFixPreview.expectedAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                  : '—'}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setFixOpen(false)} disabled={fixLoading}>
                ยกเลิก
              </Button>
              <Button type="button" onClick={() => void handleApplyWhtFix()} disabled={fixLoading}>
                {fixLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                ยืนยันแก้ไข
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
