'use client';

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Printer, CheckCircle2, XCircle, MessageSquareWarning } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
import type { Quotation, QuotationLine, User, Customer } from '@/lib/types';
import { useFirestore, useDoc, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { doc, collection, updateDoc } from 'firebase/firestore';
import { DisputeService } from '@/lib/services/dispute-service';
import { useClientPortalIdentity } from '@/contexts/client-portal-user-context';
import { usePortalLocale } from '@/contexts/portal-locale-context';
import { formatStoredDateThaiBE } from '@/lib/date-thai';
import { useToast } from '@/hooks/use-toast';
import { sanitizeFirestorePayload } from '@/lib/utils';
import { buildQuotationPrintHtml, openStandardPrintWindow } from '@/lib/documents/standard-document-print';
import { useDocumentPrintLocale } from '@/hooks/use-document-print-locale';
import { DocumentPrintLocaleToggle } from '@/components/documents/document-print-locale-toggle';
import type { PrintDocumentLocale } from '@/lib/documents/document-print-i18n';

export default function ClientPortalQuotationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { effectiveUser: currentUser, appUserLoading: userLoading, canAccessPortal } = useClientPortalIdentity();
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { locale, t } = usePortalLocale();
  const en = locale === 'en';
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [negotiateOpen, setNegotiateOpen] = useState(false);
  const [negotiateText, setNegotiateText] = useState('');
  const [negotiateBusy, setNegotiateBusy] = useState(false);

  const { printLocale, setPrintLocale } = useDocumentPrintLocale();

  const ready = Boolean(firestore && currentUser && canAccessPortal);

  const qRef = useMemoFirebase(() => (ready ? doc(firestore!, 'quotations', id) : null), [firestore, id, ready]);
  const { data: quotation, isLoading, error: quotationError } = useDoc<Quotation>(qRef as any);

  const linesQ = useMemoFirebase(
    () => (ready && quotation ? collection(firestore!, 'quotations', id, 'lines') : null),
    [firestore, id, quotation, ready],
  );
  const { data: lines } = useCollection<QuotationLine>(linesQ as any);

  const customerRef = useMemoFirebase(() => {
    if (!ready || !quotation?.customerId || !currentUser?.customerId) return null;
    if (currentUser.customerId !== quotation.customerId) return null;
    return doc(firestore!, 'customers', quotation.customerId);
  }, [ready, quotation?.customerId, currentUser?.customerId, firestore]);
  const { data: customerRow } = useDoc<Customer>(customerRef as any);

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

  const sortedLines = useMemo(
    () => [...(lines ?? [])].sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0)),
    [lines],
  );

  /** Firestore allows any portal customer on this quotation to decide; hide actions only for explicit viewers. */
  const isApprover = currentUser?.portalRole !== 'viewer';

  const handlePrint = async () => {
    if (!quotation) return;
    const body = buildQuotationPrintHtml({
      company: companyProfile ?? undefined,
      quotation,
      customer: customerRow ?? undefined,
      lines: sortedLines,
      printedAtMs: Date.now(),
      locale: printLocale as PrintDocumentLocale,
    });
    if (
      !(await openStandardPrintWindow({
        windowTitle: quotation.quotationNo,
        bodyInnerHtml: body,
        htmlLang: printLocale,
      }))
    ) {
      toast({
        variant: 'destructive',
        title: en ? 'Popup blocked' : 'เปิดหน้าต่างพิมพ์ไม่ได้',
        description: en ? 'Allow popups for this site.' : 'อนุญาตป๊อปอัปสำหรับเว็บไซต์นี้',
      });
    }
  };

  const handleNegotiate = async () => {
    if (!negotiateText.trim() || !firestore || !quotation || !currentUser || !qRef) return;
    if (quotation.customerRevisionRequestedAt) return;
    setNegotiateBusy(true);
    try {
      const svc = new DisputeService(firestore);
      const issueId = await svc.reportIssue(
        {
          category: 'QUOTATION',
          referenceId: quotation.id,
          referenceNo: quotation.quotationNo,
          description: negotiateText.trim(),
        },
        currentUser as User,
      );
      const now = Date.now();
      await updateDoc(
        qRef,
        sanitizeFirestorePayload({
          customerRevisionRequestedAt: now,
          customerRevisionRequestNote: negotiateText.trim(),
          customerRevisionIssueId: issueId,
          updatedAt: now,
          updatedBy: currentUser.id,
        }),
      );
      toast({
        title: en ? 'Request sent' : 'ส่งคำขอแล้ว',
        description: en ? 'OPEC will review and send an updated quotation.' : 'OPEC จะตรวจและส่งฉบับใหม่ให้',
      });
      setNegotiateOpen(false);
      setNegotiateText('');
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: en ? 'Failed' : 'ไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setNegotiateBusy(false);
    }
  };

  const applyDecision = async (next: 'accepted' | 'rejected') => {
    if (!firestore || !currentUser || !quotation || !qRef || quotation.status !== 'sent') return;
    if (!isApprover) return;
    if (quotation.customerRevisionRequestedAt) return;
    setBusy(true);
    try {
      const now = Date.now();
      await updateDoc(
        qRef,
        sanitizeFirestorePayload({
          status: next,
          updatedAt: now,
          updatedBy: currentUser.id,
          portalDecisionAt: now,
          portalDecisionByUid: currentUser.id,
          portalDecisionByName: currentUser.displayName || currentUser.email || currentUser.id,
          portalDecisionSource: 'CLIENT_PORTAL' as const,
        }),
      );
      toast({
        title: next === 'accepted' ? (en ? 'Accepted' : 'อนุมัติแล้ว') : en ? 'Rejected' : 'บันทึกแล้ว',
        description:
          next === 'accepted'
            ? en
              ? 'You can ask OPEC to open a PO from this quotation.'
              : 'แจ้ง OPEC ให้เปิด PO จากใบเสนอราคานี้ได้'
            : en
              ? 'OPEC has been notified by status update.'
              : 'อัปเดตสถานะแล้ว — ติดต่อ OPEC หากต้องการใบเสนอราคาใหม่',
      });
      setRejectOpen(false);
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: en ? 'Failed' : 'ไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  if (isUserLoading || userLoading) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!currentUser || !canAccessPortal) {
    return <p className="text-sm text-muted-foreground">{t('portalOnly')}</p>;
  }

  if (!ready || isLoading) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (quotationError || !quotation) {
    return (
      <div className="mx-auto max-w-lg space-y-4 rounded-xl border border-amber-200 bg-amber-50/90 p-6 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
        <p className="text-amber-950 dark:text-amber-100">{t('qtnUnavailable')}</p>
        <Button variant="outline" size="sm" asChild>
          <Link href="/client-portal/quotations">{t('qtnBack')}</Link>
        </Button>
      </div>
    );
  }

  if (quotation.customerId !== currentUser.customerId) {
    return <p className="text-sm text-destructive">{en ? 'Access denied.' : 'ไม่มีสิทธิ์'}</p>;
  }

  const loc = printLocale === 'en' ? 'en-GB' : 'th-TH';
  const canDecide = quotation.status === 'sent' && isApprover && !quotation.customerRevisionRequestedAt;
  const canNegotiate =
    quotation.status === 'sent' && !quotation.customerRevisionRequestedAt;

  return (
    <div className="mx-auto w-full max-w-[min(100%,96rem)] space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/client-portal/quotations">
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t('qtnBack')}
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {en ? 'Quotation' : 'ใบเสนอราคา'}
          </p>
          <h2 className="text-2xl font-bold font-mono text-primary">{quotation.quotationNo}</h2>
          <p className="text-sm text-muted-foreground">{formatStoredDateThaiBE(quotation.issueDate)}</p>
          <p className="mt-1 font-medium">{quotation.projectTitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DocumentPrintLocaleToggle printLocale={printLocale} setPrintLocale={setPrintLocale} showLabel />
          <Button type="button" variant="outline" size="sm" onClick={() => handlePrint()}>
            <Printer className="mr-2 h-4 w-4" />
            {t('qtnPrint')}
          </Button>
        </div>
      </div>

      {quotation.status === 'sent' && !quotation.customerRevisionRequestedAt && (
        <p className="rounded-lg border border-amber-200 bg-amber-50/90 px-3 py-2 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
          {t('qtnAwaitingYourApproval')}
        </p>
      )}

      {quotation.status === 'sent' && quotation.customerRevisionRequestedAt && (
        <p className="rounded-lg border border-violet-200 bg-violet-50/90 px-3 py-2 text-sm text-violet-950 dark:border-violet-900/50 dark:bg-violet-950/30 dark:text-violet-100">
          {t('qtnAwaitOpec')}
        </p>
      )}

      {quotation.notes?.trim() ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('qtnTermsNotes')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{quotation.notes.trim()}</p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{en ? 'Line items' : 'รายการ'}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{en ? 'Description' : 'รายละเอียด'}</TableHead>
                <TableHead className="text-right w-24">{en ? 'Qty' : 'จำนวน'}</TableHead>
                <TableHead className="text-right w-32">{en ? 'Total' : 'จำนวนเงิน'}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedLines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell className="max-w-md text-sm">{line.description}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{line.quantity}</TableCell>
                  <TableCell className="text-right font-medium">
                    {quotation.currency}{' '}
                    {line.lineTotal.toLocaleString(loc, { minimumFractionDigits: 2 })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 pt-6 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{en ? 'Subtotal' : 'รวมย่อย'}</span>
            <span>
              {quotation.currency}{' '}
              {quotation.subtotal.toLocaleString(loc, { minimumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">VAT ({quotation.taxPercent}%)</span>
            <span>
              {quotation.currency}{' '}
              {quotation.taxAmount.toLocaleString(loc, { minimumFractionDigits: 2 })}
            </span>
          </div>
          <Separator />
          <div className="flex justify-between text-lg font-bold text-primary">
            <span>{en ? 'Grand total' : 'รวมทั้งสิ้น'}</span>
            <span>
              {quotation.currency}{' '}
              {quotation.grandTotal.toLocaleString(loc, { minimumFractionDigits: 2 })}
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2 print:hidden">
        {quotation.status === 'sent' && !isApprover && (
          <p className="w-full rounded-lg border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {t('qtnViewerHint')}
          </p>
        )}
        {canNegotiate && (
          <Button variant="outline" className="gap-2" type="button" onClick={() => setNegotiateOpen(true)}>
            <MessageSquareWarning className="h-4 w-4" />
            {t('qtnNegotiate')}
          </Button>
        )}
        {canDecide && (
          <>
            <Button className="gap-2" onClick={() => void applyDecision('accepted')} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {t('qtnApprove')}
            </Button>
            <Button variant="outline" className="gap-2" onClick={() => setRejectOpen(true)} disabled={busy} type="button">
              <XCircle className="h-4 w-4" />
              {t('qtnReject')}
            </Button>
          </>
        )}
      </div>

      <Dialog open={negotiateOpen} onOpenChange={setNegotiateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('qtnNegotiateDialogTitle')}</DialogTitle>
            <DialogDescription>{t('qtnNegotiateDialogLead')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>{en ? 'Details' : 'รายละเอียด'}</Label>
            <Textarea
              value={negotiateText}
              onChange={(e) => setNegotiateText(e.target.value)}
              rows={4}
              placeholder={t('qtnNegotiatePlaceholder')}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setNegotiateOpen(false)} disabled={negotiateBusy}>
              {t('tsCancel')}
            </Button>
            <Button type="button" onClick={() => void handleNegotiate()} disabled={negotiateBusy || !negotiateText.trim()}>
              {negotiateBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t('qtnNegotiateSubmit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('qtnRejectConfirm')}</AlertDialogTitle>
            <AlertDialogDescription>{t('qtnRejectLead')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">{t('tsCancel')}</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void applyDecision('rejected')}
            >
              {t('qtnReject')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
