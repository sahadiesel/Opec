'use client';

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Loader2, MessageSquareWarning, Printer, Paperclip, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type {
  CommercialInvoice,
  Customer,
  MainContract,
  PurchaseOrder,
  Quotation,
  User,
} from '@/lib/types';
import { useFirebaseApp, useFirestore, useDoc, useMemoFirebase, useUser } from '@/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { usePortalLocale } from '@/contexts/portal-locale-context';
import { formatDateTimeThaiBE, formatStoredDateThaiBE } from '@/lib/date-thai';
import { useToast } from '@/hooks/use-toast';
import { useClientPortalIdentity } from '@/contexts/client-portal-user-context';
import {
  confirmCommercialInvoiceBilling,
  reportCustomerPaymentForIssuedCommercial,
} from '@/lib/services/commercial-invoice-service';
import { uploadCommercialPaymentProof } from '@/lib/storage/commercial-payment-proofs';
import { sanitizeFirestorePayload } from '@/lib/utils';
import { DisputeService } from '@/lib/services/dispute-service';
import { buildCommercialInvoicePrintHtml, openStandardPrintWindow } from '@/lib/documents/standard-document-print';
import { translateCommercialLineDescriptionToEn, translateCommercialWaveCodeToEn } from '@/lib/documents/commercial-line-description-en';
import { Separator } from '@/components/ui/separator';
import { useDocumentPrintLocale } from '@/hooks/use-document-print-locale';
import { DocumentPrintLocaleToggle } from '@/components/documents/document-print-locale-toggle';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import type { PrintDocumentLocale } from '@/lib/documents/document-print-i18n';

export default function ClientCommercialInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { effectiveUser: currentUser, appUserLoading: userLoading, canAccessPortal } = useClientPortalIdentity();
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { locale, t } = usePortalLocale();
  const en = locale === 'en';
  const firebaseApp = useFirebaseApp();
  const [busy, setBusy] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [payFile, setPayFile] = useState<File | null>(null);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeText, setDisputeText] = useState('');
  const [disputeBusy, setDisputeBusy] = useState(false);

  const ready = Boolean(firestore && currentUser && canAccessPortal);

  const invRef = useMemoFirebase(
    () => (ready ? doc(firestore!, 'commercial_invoices', id) : null),
    [firestore, id, ready],
  );
  const { data: invoice, isLoading } = useDoc<CommercialInvoice>(invRef as any);

  const customerRef = useMemoFirebase(
    () => (ready && invoice?.customerId ? doc(firestore!, 'customers', invoice.customerId) : null),
    [firestore, invoice?.customerId, ready],
  );
  const { data: customerRecord } = useDoc<Customer>(customerRef as any);

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

  const poRef = useMemoFirebase(
    () => (ready && invoice?.poId ? doc(firestore!, 'purchase_orders', invoice.poId) : null),
    [firestore, invoice?.poId, ready],
  );
  const { data: purchaseOrder } = useDoc<PurchaseOrder>(poRef as any);

  const contractIdForPrint = invoice?.contractId || purchaseOrder?.contractId;
  const mainContractRef = useMemoFirebase(
    () =>
      ready && contractIdForPrint ? doc(firestore!, 'main_contracts', contractIdForPrint) : null,
    [firestore, contractIdForPrint, ready],
  );
  const { data: mainContract } = useDoc<MainContract>(mainContractRef as any);

  const quotationRef = useMemoFirebase(
    () =>
      ready && purchaseOrder?.quotationId
        ? doc(firestore!, 'quotations', purchaseOrder.quotationId)
        : null,
    [firestore, purchaseOrder?.quotationId, ready],
  );
  const { data: quotation } = useDoc<Quotation>(quotationRef as any);

  const { printLocale, setPrintLocale } = useDocumentPrintLocale();

  const isApprover = currentUser?.portalRole === 'approver';

  const lineDescription = useMemo(() => {
    return (raw: string, workerName: string | undefined) => {
      const base = (raw || '—') + (workerName ? ` (${workerName})` : '');
      if (printLocale === 'en') return translateCommercialLineDescriptionToEn(base);
      return base;
    };
  }, [printLocale]);

  const handlePrintCommercial = async () => {
    if (!invoice) return;
    const body = buildCommercialInvoicePrintHtml({
      company: companyProfile ?? undefined,
      invoice,
      customer: customerRecord ?? undefined,
      customerPartyNameOverride:
        !customerRecord?.name?.trim() && currentUser
          ? currentUser.displayName || currentUser.email || '—'
          : undefined,
      purchaseOrder: purchaseOrder ?? undefined,
      mainContract: mainContract ?? undefined,
      quotation: quotation ?? undefined,
      lines: invoice.lines ?? [],
      amountBeforeTax: invoice.amountBeforeTax,
      vatAmount: invoice.vatAmount,
      totalAmount: invoice.totalAmount,
      printedAtMs: Date.now(),
      locale: printLocale,
    });
    if (
      !(await openStandardPrintWindow({
        windowTitle: invoice.invoiceNo,
        bodyInnerHtml: body,
        htmlLang: printLocale,
      }))
    ) {
      toast({
        variant: 'destructive',
        title: en ? 'Popup blocked' : 'เปิดหน้าต่างพิมพ์ไม่ได้',
        description: en ? 'Allow popups for this site.' : 'กรุณาอนุญาตป๊อปอัปสำหรับเว็บไซต์นี้',
      });
    }
  };

  const handleDispute = async () => {
    if (!disputeText.trim() || !firestore || !invoice || !currentUser) return;
    setDisputeBusy(true);
    try {
      const svc = new DisputeService(firestore);
      const issueId = await svc.reportIssue(
        {
          category: 'COMMERCIAL_INVOICE',
          referenceId: invoice.id,
          referenceNo: invoice.invoiceNo,
          description: disputeText.trim(),
        },
        currentUser as User,
      );
      const now = Date.now();
      await updateDoc(
        doc(firestore, 'commercial_invoices', invoice.id),
        sanitizeFirestorePayload({
          customerRevisionRequestedAt: now,
          customerRevisionRequestNote: disputeText.trim(),
          customerRevisionIssueId: issueId,
          updatedAt: now,
          updatedByUid: currentUser.id,
          updatedByName: currentUser.displayName || currentUser.email || currentUser.id,
        }),
      );
      toast({
        title: t('tsToastDispute'),
        description: t('tsToastDisputeDesc'),
      });
      setDisputeOpen(false);
      setDisputeText('');
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setDisputeBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (!firestore || !invoice || !currentUser || !isApprover) return;
    if (invoice.status !== 'PENDING_CUSTOMER') return;
    setBusy(true);
    try {
      await confirmCommercialInvoiceBilling(firestore, invoice, currentUser as User, 'CLIENT_PORTAL');
      toast({
        title: en ? 'Confirmed' : 'ยืนยันแล้ว',
        description: en ? 'Billing totals confirmed.' : 'ยืนยันยอดเรียกเก็บแล้ว',
      });
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSavePaymentReport = async () => {
    if (!firestore || !invoice || !currentUser || !isApprover || !payFile) return;
    setPayBusy(true);
    try {
      const { downloadUrl, fileName, contentType } = await uploadCommercialPaymentProof(
        firebaseApp,
        invoice.id,
        currentUser.id,
        payFile,
      );
      await reportCustomerPaymentForIssuedCommercial(firestore, invoice, currentUser as User, {
        proofUrl: downloadUrl,
        fileName,
        contentType,
      });
      setPayOpen(false);
      setPayFile(null);
      toast({
        title: en ? 'Notified' : 'แจ้งแล้ว',
        description: t('commPayWaitingOpec'),
      });
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setPayBusy(false);
    }
  };

  const col = (L: PrintDocumentLocale) =>
    L === 'en'
      ? { desc: 'Description', qty: 'Qty', amt: 'Amount' }
      : { desc: 'รายละเอียด', qty: 'จำนวน', amt: 'จำนวนเงิน' };
  const lineCols = col(printLocale);

  if (isUserLoading || userLoading) {
    return <Loader2 className="h-8 w-8 animate-spin text-primary" />;
  }

  if (!currentUser || !canAccessPortal) {
    return <p className="text-sm text-muted-foreground">{en ? 'Portal only.' : 'เฉพาะพอร์ทัล'}</p>;
  }

  if (isLoading || !invoice) {
    return <Loader2 className="h-8 w-8 animate-spin text-primary" />;
  }

  if (invoice.customerId !== currentUser.customerId) {
    return <p className="text-sm text-destructive">{en ? 'Access denied.' : 'ไม่มีสิทธิ์'}</p>;
  }

  if (invoice.status === 'DRAFT') {
    return (
      <p className="text-sm text-muted-foreground">
        {en ? 'This document is not yet shared with your organization.' : 'เอกสารนี้ยังไม่ถูกส่งให้ตรวจสอบจากทีม OPEC'}
      </p>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[min(100%,96rem)] space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/client-portal/accounting?tab=invoices">
          <ArrowLeft className="h-4 w-4 mr-2" />
          {en ? 'Back' : 'กลับ'}
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {printLocale === 'en' ? 'Invoice' : 'ใบแจ้งหนี้'}
          </p>
          <h2 className="text-2xl font-bold font-mono text-primary">{invoice.invoiceNo}</h2>
          {customerRecord?.name?.trim() ? (
            <p className="text-sm font-medium text-foreground">{customerRecord.name.trim()}</p>
          ) : null}
          <p className="text-sm text-muted-foreground">
            {en ? 'Not a tax invoice under the Revenue Code' : 'ไม่ใช่ใบกำกับภาษีตามประมวลรัษฎากร'}
          </p>
          <p className="text-sm">{formatStoredDateThaiBE(invoice.issueDate)}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2 sm:items-center">
          <DocumentPrintLocaleToggle
            printLocale={printLocale}
            setPrintLocale={setPrintLocale}
            hint={t('docPrintLocaleHint')}
          />
          <Button variant="outline" size="sm" type="button" onClick={() => handlePrintCommercial()}>
            <Printer className="h-4 w-4 mr-2" />
            {en ? 'Print' : 'พิมพ์'}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{en ? 'Period' : 'ช่วง timesheet'}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          <p>
            {formatStoredDateThaiBE(invoice.periodStart)} — {formatStoredDateThaiBE(invoice.periodEnd)}
          </p>
          {invoice.waveCode && (
            <p className="text-muted-foreground">
              Wave:{' '}
              <span className="font-mono">
                {en ? translateCommercialWaveCodeToEn(invoice.waveCode) : invoice.waveCode}
              </span>
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{lineCols.desc}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{lineCols.desc}</TableHead>
                <TableHead className="text-right">{lineCols.qty}</TableHead>
                <TableHead className="text-right">{lineCols.amt}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(invoice.lines ?? []).map((line) => (
                <TableRow key={line.id}>
                  <TableCell className="max-w-md">
                    <div className="font-medium text-sm">
                      {lineDescription(line.description || '—', line.workerName)}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{line.quantity}</TableCell>
                  <TableCell className="text-right font-medium">
                    ฿{line.amount.toLocaleString(printLocale === 'en' ? 'en-GB' : 'th-TH', { minimumFractionDigits: 2 })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{en ? 'Before VAT' : 'ก่อน VAT'}</span>
            <span>
              {invoice.currency} {invoice.amountBeforeTax.toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">VAT ({invoice.vatPercent}%)</span>
            <span>
              {invoice.currency} {invoice.vatAmount.toLocaleString()}
            </span>
          </div>
          <Separator />
          <div className="flex justify-between font-bold text-primary text-lg">
            <span>{en ? 'Total' : 'รวม'}</span>
            <span>
              {invoice.currency} {invoice.totalAmount.toLocaleString()}
            </span>
          </div>
        </CardContent>
      </Card>

      {(invoice.attachments?.length ?? 0) > 0 && (
        <Card className="border-blue-200 bg-blue-50/30 dark:bg-blue-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Paperclip className="h-4 w-4" />
              {en ? 'Attachments' : 'เอกสารแนบ'}
              <span className="text-xs font-normal text-muted-foreground">
                ({invoice.attachments!.length})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {en
                ? 'Supporting files from OPEC — open to review with this invoice.'
                : 'ไฟล์ประกอบจาก OPEC — เปิดดูประกอบการตรวจใบวางบิลนี้'}
            </p>
            <ul className="space-y-1.5">
              {invoice.attachments!.map((att) => (
                <li key={att.id}>
                  <a
                    href={att.downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    <span className="break-all">{att.fileName}</span>
                  </a>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2 print:hidden">
        {invoice.status === 'PENDING_CUSTOMER' && !isApprover && (
          <p className="w-full text-xs text-muted-foreground rounded-lg border border-dashed bg-muted/30 px-3 py-2">
            {en
              ? 'Viewer — ask your organization’s Approver to confirm, or contact OPEC.'
              : 'บัญชีดูอย่างเดียว — ให้ผู้อนุมัติของลูกค้ากดยืนยัน หรือติดต่อ OPEC'}
          </p>
        )}
        {invoice.status === 'PENDING_CUSTOMER' && isApprover && (
          <Button className="gap-2" onClick={() => void handleConfirm()} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {en ? 'Confirm billing totals' : 'ยืนยันยอดเรียกเก็บ'}
          </Button>
        )}
        {invoice.status === 'PENDING_CUSTOMER' && (
          <Button variant="outline" className="gap-2" onClick={() => setDisputeOpen(true)} type="button">
            <MessageSquareWarning className="h-4 w-4" />
            {t('openDisputeCommercial')}
          </Button>
        )}
        {invoice.status === 'ISSUED' &&
          isApprover &&
          !invoice.opecPaymentVerifiedAt &&
          !invoice.customerPaymentReportedAt && (
            <Button className="gap-2" type="button" onClick={() => setPayOpen(true)}>
              {t('commBtnConfirmPay')}
            </Button>
          )}
        {invoice.status === 'ISSUED' && isApprover && invoice.customerPaymentReportedAt && !invoice.opecPaymentVerifiedAt && (
          <p className="w-full text-sm text-amber-800 dark:text-amber-200 rounded-lg border border-amber-200 bg-amber-50/80 dark:bg-amber-950/30 px-3 py-2">
            {t('commPayWaitingOpec')}
            {invoice.customerPaymentProofUrl ? (
              <a
                className="ml-2 text-primary underline font-medium"
                href={invoice.customerPaymentProofUrl}
                target="_blank"
                rel="noreferrer"
              >
                {t('commPayViewProof')}
              </a>
            ) : null}
          </p>
        )}
      </div>

      <Dialog
        open={payOpen}
        onOpenChange={(o) => {
          setPayOpen(o);
          if (!o) setPayFile(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('commPayDialogTitle')}</DialogTitle>
            <DialogDescription>{t('commPayDialogDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="block">{en ? 'File' : 'ไฟล์'}</Label>
            <Input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(e) => setPayFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPayOpen(false);
                setPayFile(null);
              }}
              disabled={payBusy}
            >
              {en ? 'Cancel' : 'ยกเลิก'}
            </Button>
            <Button type="button" onClick={() => void handleSavePaymentReport()} disabled={payBusy || !payFile}>
              {payBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t('commPaySave')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={disputeOpen} onOpenChange={setDisputeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('openDisputeCommercial')}</DialogTitle>
            <DialogDescription>{t('openDisputeCommercialLead')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>{en ? 'Details' : 'รายละเอียด'}</Label>
            <Textarea
              value={disputeText}
              onChange={(e) => setDisputeText(e.target.value)}
              rows={4}
              placeholder={en ? 'Describe the discrepancy…' : 'ระบุรายการที่ไม่ตรงหรือข้อสงสัย…'}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisputeOpen(false)} disabled={disputeBusy} type="button">
              {en ? 'Cancel' : 'ยกเลิก'}
            </Button>
            <Button onClick={() => void handleDispute()} disabled={disputeBusy || !disputeText.trim()} type="button">
              {disputeBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {en ? 'Submit' : 'ส่ง'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {invoice.status === 'ISSUED' && invoice.customerApprovedAt && (
        <p className="text-sm text-green-700 dark:text-green-400">
          {en ? 'Confirmed at ' : 'ยืนยันเมื่อ '}
          {formatDateTimeThaiBE(invoice.customerApprovedAt)}
          {invoice.customerApprovalSource === 'INTERNAL' ? (en ? ' (OPEC)' : ' (OPEC)') : ''}
        </p>
      )}
    </div>
  );
}
