'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Printer,
  ChevronRight,
  FileBarChart,
  FileText,
  Calculator,
  MessageSquareWarning,
  Loader2,
  Lock,
} from 'lucide-react';
import type {
  TaxInvoice,
  Receipt as ReceiptDoc,
  User,
  AccountsReceivable,
  BillingNote,
  IssueCategory,
  ReceiptAllocation,
} from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';
import { isClient } from '@/lib/permissions';
import { usePortalLocale } from '@/contexts/portal-locale-context';
import { formatStoredDateThaiBE } from '@/lib/date-thai';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAppUser } from '@/hooks/use-app-user';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DisputeService } from '@/lib/services/dispute-service';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type MainTab = 'drafts' | 'invoices' | 'paid' | 'billing';

/** One combined “tax invoice / receipt” line — single document number for display (per OPEC form). */
type PaidEvidenceRow = {
  receiptId: string;
  receiptDate: string;
  /** Single number as on the printed combined form (prefer linked tax invoice no., else receipt no.). */
  documentNo: string;
  amount: number;
  paymentMethod: string;
  primaryTaxInvoiceId?: string;
};

export function AccountingContent() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { locale, t } = usePortalLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const rawTab = searchParams.get('tab');
  const mainTab: MainTab =
    rawTab === 'issued'
      ? 'invoices'
      : rawTab === 'drafts' ||
          rawTab === 'invoices' ||
          rawTab === 'paid' ||
          rawTab === 'billing'
        ? rawTab
        : 'drafts';

  const setMainTab = useCallback(
    (next: MainTab) => {
      const p = new URLSearchParams(searchParams.toString());
      p.set('tab', next);
      router.replace(`/client-portal/accounting?${p.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const invQ = useMemoFirebase(() => {
    if (!firestore || !currentUser?.customerId) return null;
    return query(
      collection(firestore, 'tax_invoices'),
      where('customerId', '==', currentUser.customerId),
      orderBy('issueDate', 'desc')
    );
  }, [firestore, currentUser?.customerId]);

  const { data: invoices, isLoading: invLoad } = useCollection<TaxInvoice>(invQ as any);

  const recQ = useMemoFirebase(() => {
    if (!firestore || !currentUser?.customerId) return null;
    return query(
      collection(firestore, 'receipts'),
      where('customerId', '==', currentUser.customerId),
      orderBy('receiptDate', 'desc')
    );
  }, [firestore, currentUser?.customerId]);
  const { data: receipts, isLoading: recLoad } = useCollection<ReceiptDoc>(recQ as any);

  const bnQuery = useMemoFirebase(() => {
    if (!firestore || !currentUser?.customerId) return null;
    return query(
      collection(firestore, 'billing_notes'),
      where('customerId', '==', currentUser.customerId),
      orderBy('billingDate', 'desc')
    );
  }, [firestore, currentUser?.customerId]);
  const { data: billingNotes, isLoading: bnLoad } = useCollection<BillingNote>(bnQuery as any);

  const arQuery = useMemoFirebase(() => {
    if (!firestore || !currentUser?.customerId) return null;
    return query(
      collection(firestore, 'accounts_receivable'),
      where('customerId', '==', currentUser.customerId),
      where('status', 'in', ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'])
    );
  }, [firestore, currentUser?.customerId]);
  const { data: arItems } = useCollection<AccountsReceivable>(arQuery as any);

  const drafts = useMemo(() => (invoices ?? []).filter((i) => i.status === 'DRAFT'), [invoices]);

  /** Step 2 — official invoice for collection (typically still has AR balance). */
  const officialInvoices = useMemo(() => {
    const list = (invoices ?? []).filter((i) => i.status === 'ISSUED');
    return list.filter((inv) => {
      const ar = arItems?.find((a) => a.referenceId === inv.id);
      if (ar) return ar.outstandingAmount > 0.005;
      return true;
    });
  }, [invoices, arItems]);

  const [paidRows, setPaidRows] = useState<PaidEvidenceRow[]>([]);
  const [paidLoading, setPaidLoading] = useState(false);

  useEffect(() => {
    if (!firestore || !invoices?.length) {
      setPaidRows([]);
      setPaidLoading(false);
      return;
    }
    if (!receipts?.length) {
      setPaidRows([]);
      setPaidLoading(false);
      return;
    }

    let cancelled = false;
    setPaidLoading(true);

    (async () => {
      const settled = receipts.filter((r) => r.status === 'ISSUED');
      const rows: PaidEvidenceRow[] = [];
      for (const r of settled) {
        const snap = await getDocs(collection(firestore, 'receipts', r.id, 'allocations'));
        const nos: string[] = [];
        let firstTid: string | undefined;
        snap.docs.forEach((d) => {
          const a = d.data() as ReceiptAllocation;
          const tid = a.taxInvoiceId;
          if (!firstTid && tid) firstTid = tid;
          const inv = invoices.find((i) => i.id === tid);
          if (inv) nos.push(inv.taxInvoiceNo);
        });
        const uniq = [...new Set(nos)];
        const documentNo = uniq.length ? uniq.join(', ') : r.receiptNo;
        rows.push({
          receiptId: r.id,
          receiptDate: r.receiptDate,
          documentNo,
          amount: r.receivedAmount,
          paymentMethod: String(r.paymentMethod),
          primaryTaxInvoiceId: firstTid,
        });
      }
      if (!cancelled) {
        setPaidRows(rows);
        setPaidLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [firestore, receipts, invoices]);

  const stats = useMemo(() => {
    if (!arItems) return { outstanding: 0, count: 0 };
    return {
      outstanding: arItems.reduce((sum, item) => sum + item.outstandingAmount, 0),
      count: arItems.length,
    };
  }, [arItems]);

  const [isDisputeOpen, setIsDisputeOpen] = useState(false);
  const [disputeContext, setDisputeContext] = useState<{ category: IssueCategory; id: string; no: string } | null>(
    null
  );
  const [disputeComment, setDisputeComment] = useState('');
  const [isSubmittingDispute, setIsSubmittingDispute] = useState(false);

  const handleOpenDispute = (category: IssueCategory, id: string, no: string) => {
    setDisputeContext({ category, id, no });
    setIsDisputeOpen(true);
  };

  const handleReportIssue = async () => {
    if (!disputeContext || !disputeComment || !firestore || !currentUser) return;
    setIsSubmittingDispute(true);
    try {
      const service = new DisputeService(firestore);
      await service.reportIssue(
        {
          category: disputeContext.category,
          referenceId: disputeContext.id,
          referenceNo: disputeContext.no,
          description: disputeComment,
        },
        currentUser as User
      );
      toast({
        title: locale === 'en' ? 'Request received' : 'รับเรื่องตรวจสอบแล้ว',
        description:
          locale === 'en'
            ? 'Accounting will review and contact you.'
            : 'เจ้าหน้าที่ฝ่ายบัญชี OPEC จะตรวจสอบและติดต่อกลับ',
      });
      setIsDisputeOpen(false);
      setDisputeComment('');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: 'destructive', title: 'Error', description: msg });
    } finally {
      setIsSubmittingDispute(false);
    }
  };

  if (userLoading) {
    return <p className="text-sm text-muted-foreground">…</p>;
  }

  if (!currentUser || !isClient(currentUser)) {
    return <p className="text-sm text-muted-foreground">{locale === 'en' ? 'Portal only.' : 'เฉพาะพอร์ทัล'}</p>;
  }

  const en = locale === 'en';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold text-primary">
          <FileBarChart className="h-6 w-6" />
          {t('accounting')}
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{t('accountingLead')}</p>
      </div>

      <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as MainTab)} className="w-full">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1 lg:grid-cols-4">
          <TabsTrigger value="drafts" className="text-xs sm:text-sm">
            {t('accTabDrafts')}
          </TabsTrigger>
          <TabsTrigger value="invoices" className="text-xs sm:text-sm">
            {t('accTabInvoices')}
          </TabsTrigger>
          <TabsTrigger value="paid" className="text-xs sm:text-sm">
            {t('accTabPaidDoc')}
          </TabsTrigger>
          <TabsTrigger value="billing" className="text-xs sm:text-sm">
            {t('accTabBilling')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="drafts" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('accDraftLead')}</CardTitle>
              <CardDescription>{t('accDraftHint')}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {invLoad ? (
                <p className="p-6 text-sm">…</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>No.</TableHead>
                      <TableHead>{en ? 'Date' : 'วันที่'}</TableHead>
                      <TableHead className="text-right">{en ? 'Amount' : 'ยอด'}</TableHead>
                      <TableHead>{en ? 'Your approval' : 'การยืนยันของท่าน'}</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {drafts.map((inv) => (
                      <TableRow
                        key={inv.id}
                        className="cursor-pointer"
                        onClick={() => router.push(`/client-portal/draft-invoices/${inv.id}`)}
                      >
                        <TableCell className="font-mono font-semibold">{inv.taxInvoiceNo}</TableCell>
                        <TableCell className="text-sm">{formatStoredDateThaiBE(inv.issueDate)}</TableCell>
                        <TableCell className="text-right text-sm">
                          {inv.currency} {inv.totalAmount.toLocaleString()}
                        </TableCell>
                        <TableCell>
                          {inv.billingCustomerApprovedAt ? (
                            <Badge className="bg-green-600">{en ? 'Confirmed' : 'ยืนยันแล้ว'}</Badge>
                          ) : (
                            <Badge variant="outline">{en ? 'Pending review' : 'รอตรวจ'}</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" asChild>
                            <Link href={`/client-portal/draft-invoices/${inv.id}`}>
                              <ChevronRight className="h-4 w-4" />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {drafts.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                          {t('accNoDrafts')}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invoices" className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">{t('accInvoiceLead')}</p>
          <Card>
            <CardContent className="p-0">
              {invLoad ? (
                <p className="p-6 text-sm">…</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('accInvoiceColNo')}</TableHead>
                      <TableHead>{en ? 'Date' : 'วันที่'}</TableHead>
                      <TableHead className="text-right">{en ? 'Total' : 'ยอด'}</TableHead>
                      <TableHead className="text-right">{en ? 'Outstanding' : 'ยอดค้าง'}</TableHead>
                      <TableHead className="w-28 text-right">{en ? 'Print' : 'พิมพ์'}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {officialInvoices.map((inv) => {
                      const ar = arItems?.find((item) => item.referenceId === inv.id);
                      const outstanding = ar
                        ? ar.outstandingAmount
                        : inv.status === 'ISSUED'
                          ? inv.totalAmount
                          : 0;
                      return (
                        <TableRow key={inv.id}>
                          <TableCell className="font-mono text-sm font-medium">{inv.taxInvoiceNo}</TableCell>
                          <TableCell className="text-sm">{formatStoredDateThaiBE(inv.issueDate)}</TableCell>
                          <TableCell className="text-right text-sm">
                            {inv.currency} {inv.totalAmount.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right font-medium text-primary">
                            ฿ {outstanding.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="outline" size="sm" asChild>
                              <Link href={`/client-portal/tax-print/${inv.id}`}>
                                <Printer className="mr-1 h-3.5 w-3.5" />
                                PDF
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {officialInvoices.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                          {t('accNoInvoicesAwaiting')}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="paid" className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">{t('accPaidDocLead')}</p>
          <p className="text-xs text-muted-foreground">{t('printHint')}</p>
          <Card>
            <CardContent className="p-0">
              {recLoad || paidLoading ? (
                <p className="p-6 text-sm">…</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('accPaidColDocNo')}</TableHead>
                      <TableHead>{t('accPaidColPaidOn')}</TableHead>
                      <TableHead>{en ? 'Method' : 'ช่องทาง'}</TableHead>
                      <TableHead className="text-right">{t('accPaidColAmount')}</TableHead>
                      <TableHead className="text-right">{en ? 'Print' : 'พิมพ์'}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paidRows.map((row) => (
                      <TableRow key={row.receiptId}>
                        <TableCell className="font-mono text-sm font-medium">{row.documentNo}</TableCell>
                        <TableCell className="text-sm">{formatStoredDateThaiBE(row.receiptDate)}</TableCell>
                        <TableCell className="text-xs uppercase text-muted-foreground">{row.paymentMethod}</TableCell>
                        <TableCell className="text-right text-sm font-medium">
                          ฿ {row.amount.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.primaryTaxInvoiceId ? (
                            <Button variant="outline" size="sm" asChild>
                              <Link href={`/client-portal/tax-print/${row.primaryTaxInvoiceId}`}>
                                <Printer className="mr-1 h-3.5 w-3.5" />
                                PDF
                              </Link>
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {paidRows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                          {t('noData')}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="billing" className="mt-4 space-y-6">
          <p className="text-sm text-muted-foreground">{t('accBillLead')}</p>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Card className="border-l-4 border-l-blue-600 bg-blue-50/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('accOutstanding')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-primary">฿ {stats.outstanding.toLocaleString()}</div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {en ? `${stats.count} open item(s)` : `${stats.count} รายการค้าง`}
                </p>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-green-600 bg-green-50/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('accPaidTotal')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-700">
                  ฿ {(receipts?.reduce((sum, r) => sum + Number(r.receivedAmount), 0) || 0).toLocaleString()}
                </div>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-primary bg-primary/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('accCredit')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-lg font-semibold text-primary">Credit 30 Days</div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {en ? 'Standard commercial terms' : 'เงื่อนไขทั่วไป'}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Calculator className="h-4 w-4" />
                {t('accOverviewNotes')}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {bnLoad ? (
                <p className="p-6 text-sm">…</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{en ? 'Note no.' : 'เลขที่'}</TableHead>
                      <TableHead>{en ? 'Billing date' : 'วันที่วางบิล'}</TableHead>
                      <TableHead>{en ? 'Due' : 'ครบกำหนด'}</TableHead>
                      <TableHead className="text-right">{en ? 'Net' : 'ยอดสุทธิ'}</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">{en ? 'Actions' : 'จัดการ'}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {billingNotes?.map((note) => {
                      const isFinalized = note.status === 'PAID' || note.status === 'CANCELLED';
                      return (
                        <TableRow key={note.id}>
                          <TableCell className="font-mono text-sm font-medium">
                            <span className="inline-flex items-center gap-1">
                              {note.billingNoteNo}
                              {isFinalized && <Lock className="h-3 w-3 text-amber-600" />}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm">{note.billingDate}</TableCell>
                          <TableCell className="text-sm text-red-600">{note.dueDate}</TableCell>
                          <TableCell className="text-right font-medium">฿ {note.netAmount.toLocaleString()}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{note.status}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {!isFinalized && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 text-xs"
                                onClick={() => handleOpenDispute('BILLING_NOTE', note.id, note.billingNoteNo)}
                              >
                                <MessageSquareWarning className="mr-1 h-3.5 w-3.5" />
                                {en ? 'Report' : 'แจ้งปัญหา'}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {(billingNotes ?? []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                          {t('noData')}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {arItems && arItems.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="h-4 w-4" />
                  {en ? 'Open balances (AR)' : 'ยอดค้างชำระ (AR)'}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{en ? 'Document' : 'เอกสาร'}</TableHead>
                      <TableHead>{en ? 'Due' : 'ครบกำหนด'}</TableHead>
                      <TableHead className="text-right">{en ? 'Outstanding' : 'ยอดค้าง'}</TableHead>
                      <TableHead className="text-right">{en ? 'Actions' : 'จัดการ'}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {arItems.map((ar) => (
                      <TableRow key={ar.id}>
                        <TableCell className="font-mono text-sm">{ar.referenceNo || ar.documentNo}</TableCell>
                        <TableCell className="text-sm">{ar.dueDate}</TableCell>
                        <TableCell className="text-right font-medium text-primary">
                          ฿ {ar.outstandingAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right">
                          {ar.referenceType === 'TAX_INVOICE' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 text-xs"
                              onClick={() => handleOpenDispute('TAX_INVOICE', ar.referenceId, ar.referenceNo || ar.documentNo)}
                            >
                              <MessageSquareWarning className="mr-1 h-3.5 w-3.5" />
                              {en ? 'Report' : 'แจ้งปัญหา'}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={isDisputeOpen} onOpenChange={setIsDisputeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{en ? 'Report a document issue' : 'แจ้งปัญหาข้อมูลเอกสาร'}</DialogTitle>
            <DialogDescription>
              {en
                ? 'Describe what should be checked by OPEC accounting.'
                : 'ระบุรายละเอียดที่ต้องการให้ฝ่ายบัญชีตรวจสอบ'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {disputeContext && (
              <div className="space-y-1 rounded-lg bg-muted p-3 text-xs">
                <p>
                  <b>{en ? 'Type' : 'ประเภท'}:</b> {disputeContext.category}
                </p>
                <p>
                  <b>{en ? 'Reference' : 'เลขที่'}:</b> {disputeContext.no}
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label>{en ? 'Details' : 'รายละเอียด'}</Label>
              <Textarea
                placeholder={en ? 'Amount mismatch, wrong due date…' : 'เช่น ยอดไม่ตรง วันที่ผิด…'}
                value={disputeComment}
                onChange={(e) => setDisputeComment(e.target.value)}
                className="min-h-[120px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDisputeOpen(false)} disabled={isSubmittingDispute}>
              {en ? 'Cancel' : 'ยกเลิก'}
            </Button>
            <Button onClick={() => void handleReportIssue()} disabled={isSubmittingDispute || !disputeComment}>
              {isSubmittingDispute ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {en ? 'Submit' : 'ส่งเรื่อง'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
