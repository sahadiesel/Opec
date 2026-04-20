'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Printer, CheckCircle2, MessageSquareWarning } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { BillingNote, BillingNoteLine, TaxInvoice, User } from '@/lib/types';
import { useFirestore, useDoc, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { doc, collection } from 'firebase/firestore';
import { isClient } from '@/lib/permissions';
import { usePortalLocale } from '@/contexts/portal-locale-context';
import { formatStoredDateThaiBE, formatDateTimeThaiBE } from '@/lib/date-thai';
import { useToast } from '@/hooks/use-toast';
import { recordTaxInvoiceBillingCustomerApproval } from '@/lib/services/tax-invoice-billing-approval-service';
import { DisputeService } from '@/lib/services/dispute-service';
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
import { Separator } from '@/components/ui/separator';
import { buildTaxInvoicePrintHtml, openStandardPrintWindow } from '@/lib/documents/standard-document-print';
import { useDocumentPrintLocale } from '@/hooks/use-document-print-locale';
import { DocumentPrintLocaleToggle } from '@/components/documents/document-print-locale-toggle';

export default function ClientDraftInvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { locale, t } = usePortalLocale();

  const [approving, setApproving] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeText, setDisputeText] = useState('');
  const [disputeBusy, setDisputeBusy] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem('opsflow_user');
    if (raw) setCurrentUser(JSON.parse(raw));
  }, []);

  const ready = Boolean(firestore && currentUser && isClient(currentUser));

  const invRef = useMemoFirebase(() => (ready ? doc(firestore!, 'tax_invoices', id) : null), [firestore, id, ready]);
  const { data: invoice, isLoading } = useDoc<TaxInvoice>(invRef as any);

  const bnRef = useMemoFirebase(
    () => (ready && invoice ? doc(firestore!, 'billing_notes', invoice.billingNoteId) : null),
    [firestore, invoice?.billingNoteId, ready]
  );
  const { data: billingNote } = useDoc<BillingNote>(bnRef as any);

  const linesQ = useMemoFirebase(
    () => (ready && invoice ? collection(firestore!, 'billing_notes', invoice.billingNoteId, 'lines') : null),
    [firestore, invoice?.billingNoteId, ready]
  );
  const { data: lines } = useCollection<BillingNoteLine>(linesQ as any);

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

  const isApprover = currentUser?.portalRole === 'approver';

  const handlePrintTaxDraft = () => {
    if (!invoice) return;
    const body = buildTaxInvoicePrintHtml({
      company: companyProfile ?? undefined,
      invoice,
      billingNote: billingNote ?? undefined,
      billingLines: lines ?? [],
      customer: undefined,
      customerPartyNameOverride: currentUser?.displayName || currentUser?.email || '—',
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
        title: locale === 'en' ? 'Popup blocked' : 'เปิดหน้าต่างพิมพ์ไม่ได้',
        description:
          locale === 'en' ? 'Allow popups for this site.' : 'กรุณาอนุญาตป๊อปอัปสำหรับเว็บไซต์นี้',
      });
    }
  };

  const handleApprove = async () => {
    if (!firestore || !invoice || !billingNote || !currentUser || !isApprover) return;
    if (invoice.status !== 'DRAFT' || invoice.billingCustomerApprovedAt) return;

    setApproving(true);
    try {
      const { approvalToken, timesheetsLocked } = await recordTaxInvoiceBillingCustomerApproval(
        firestore,
        invoice,
        billingNote,
        lines ?? [],
        currentUser,
        { channel: 'client_portal' }
      );
      toast({
        title: locale === 'en' ? 'Approved' : 'อนุมัติแล้ว',
        description: `${approvalToken} · ${timesheetsLocked} ts`,
      });
    } catch (e) {
      console.error(e);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: e instanceof Error ? e.message : 'Failed',
      });
    } finally {
      setApproving(false);
    }
  };

  const handleDispute = async () => {
    if (!disputeText.trim() || !firestore || !invoice || !currentUser) return;
    setDisputeBusy(true);
    try {
      const svc = new DisputeService(firestore);
      await svc.reportIssue(
        {
          category: 'TAX_INVOICE',
          referenceId: invoice.id,
          referenceNo: invoice.taxInvoiceNo,
          description: disputeText.trim(),
        },
        currentUser
      );
      toast({
        title: locale === 'en' ? 'Request sent' : 'ส่งคำขอแล้ว',
        description: locale === 'en' ? 'OPEC will review.' : 'ทีม OPEC จะตรวจสอบ',
      });
      setDisputeOpen(false);
      setDisputeText('');
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e?.message });
    } finally {
      setDisputeBusy(false);
    }
  };

  if (!currentUser || !isClient(currentUser)) return <p className="text-sm">Portal only.</p>;
  if (isLoading || !invoice) return <Loader2 className="h-8 w-8 animate-spin text-primary" />;

  if (invoice.customerId !== currentUser.customerId) {
    return <p className="text-destructive text-sm">Access denied.</p>;
  }

  if (invoice.status !== 'DRAFT') {
    return (
      <p className="text-sm text-muted-foreground">
        {locale === 'en' ? 'This document is not a draft.' : 'เอกสารนี้ไม่ใช่ร่าง'}
      </p>
    );
  }

  const attachments = invoice.timesheetPaperAttachments ?? [];

  return (
    <div className="mx-auto w-full max-w-[min(100%,96rem)] space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/client-portal/accounting?tab=invoices">
          <ArrowLeft className="h-4 w-4 mr-2" />
          {locale === 'en' ? 'Invoice list' : 'รายการใบแจ้งหนี้'}
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold font-mono text-primary">{invoice.taxInvoiceNo}</h2>
          <p className="text-sm text-muted-foreground">{formatStoredDateThaiBE(invoice.issueDate)}</p>
          {invoice.billingApprovalToken && (
            <p className="text-xs font-mono mt-2 bg-muted px-2 py-1 rounded inline-block">
              {invoice.billingApprovalToken}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DocumentPrintLocaleToggle printLocale={printLocale} setPrintLocale={setPrintLocale} />
          <Button variant="outline" size="sm" type="button" onClick={() => handlePrintTaxDraft()}>
            <Printer className="h-4 w-4 mr-2" />
            Print
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{locale === 'en' ? 'Amounts' : 'ยอดเงิน'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Taxable</span>
            <span>
              {invoice.currency} {invoice.taxableAmount.toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">VAT</span>
            <span>
              {invoice.currency} {invoice.vatAmount.toLocaleString()}
            </span>
          </div>
          <Separator />
          <div className="flex justify-between font-bold text-primary">
            <span>Total</span>
            <span>
              {invoice.currency} {invoice.totalAmount.toLocaleString()}
            </span>
          </div>
          {billingNote && (
            <p className="text-xs text-muted-foreground pt-2">
              {locale === 'en' ? 'Billing note' : 'ใบวางบิล'}: {billingNote.billingNoteNo}
            </p>
          )}
        </CardContent>
      </Card>

      {attachments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{locale === 'en' ? 'Attachments' : 'รูปแนบ'}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            {attachments.map((a) => (
              <a
                key={a.id}
                href={a.downloadUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded border overflow-hidden block"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.downloadUrl} alt="" className="h-28 w-full object-cover" />
              </a>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2 print:hidden">
        {!isApprover && !invoice.billingCustomerApprovedAt && (
          <p className="w-full text-xs text-muted-foreground rounded-lg border border-dashed bg-muted/30 px-3 py-2">
            {t('viewerNoApprove')}
          </p>
        )}
        {isApprover && !invoice.billingCustomerApprovedAt && (
          <Button className="gap-2" onClick={() => void handleApprove()} disabled={approving}>
            {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {locale === 'en' ? 'Approve billing' : 'อนุมัติ billing'}
          </Button>
        )}
        <Button variant="outline" className="gap-2" onClick={() => setDisputeOpen(true)}>
          <MessageSquareWarning className="h-4 w-4" />
          {locale === 'en' ? 'Request correction' : 'ขอแก้ไข'}
        </Button>
      </div>

      {invoice.billingCustomerApprovedAt && (
        <p className="text-sm text-green-700 dark:text-green-400">
          {locale === 'en' ? 'Billing approved at ' : 'อนุมัติ billing แล้ว '}
          {formatDateTimeThaiBE(invoice.billingCustomerApprovedAt)}
        </p>
      )}

      <Dialog open={disputeOpen} onOpenChange={setDisputeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{locale === 'en' ? 'Request correction' : 'ขอแก้ไข'}</DialogTitle>
            <DialogDescription>
              {locale === 'en' ? 'Describe the issue. OPEC accounting will follow up.' : 'อธิบายปัญหา — ฝ่ายบัญชีจะติดต่อกลับ'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Message</Label>
            <Textarea value={disputeText} onChange={(e) => setDisputeText(e.target.value)} rows={4} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisputeOpen(false)} disabled={disputeBusy}>
              {locale === 'en' ? 'Cancel' : 'ยกเลิก'}
            </Button>
            <Button onClick={() => void handleDispute()} disabled={disputeBusy || !disputeText.trim()}>
              {disputeBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {locale === 'en' ? 'Submit' : 'ส่ง'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
