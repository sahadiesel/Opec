'use client';

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  ArrowLeft,
  Building2,
  FileText,
  Info,
  Loader2,
  Send,
  CheckCircle2,
  Printer,
  Plus,
  Trash2,
  Ban,
  Pencil,
  FileBadge,
  RefreshCw,
} from 'lucide-react';
import {
  CommercialInvoice,
  CommercialInvoiceLine,
  Customer,
  MainContract,
  PurchaseOrder,
  Quotation,
  BankAccount,
  User,
} from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useCollection, useFirestore, useDoc, useMemoFirebase, useUser } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canCreate, canEdit, canView, isSystemAdmin } from '@/lib/permissions';
import { isSimpleAccounting, isSimpleAdmin } from '@/lib/simple-tier-model';
import { collection, doc, query, where } from 'firebase/firestore';
import { formatDateTimeThaiBE, formatStoredDateThaiBE, timestampToHtmlDateValue } from '@/lib/date-thai';
import { shouldOmitCommercialInvoiceGenerationWarning } from '@/lib/services/billing-line-generator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  confirmCommercialInvoiceBilling,
  reopenCommercialInvoiceForCustomerRevision,
  sendCommercialDraftToCustomer,
  voidCommercialInvoice,
  updateCommercialDraftInvoice,
  regenerateCommercialDraftInvoiceFromTimesheets,
  QUOTATION_PO_WAVE_PLACEHOLDER,
  PO_MONTH_WAVE_PLACEHOLDER,
} from '@/lib/services/commercial-invoice-service';
import {
  buildCommercialInvoicePrintHtml,
  openStandardPrintWindow,
} from '@/lib/documents/standard-document-print';
import { translateCommercialLineDescriptionToEn, translateCommercialWaveCodeToEn } from '@/lib/documents/commercial-line-description-en';
import { printT, type PrintDocumentLocale } from '@/lib/documents/document-print-i18n';
import { useDocumentPrintLocale } from '@/hooks/use-document-print-locale';
import { DocumentPrintLocaleToggle } from '@/components/documents/document-print-locale-toggle';
import { createTaxInvoiceDraftFromIssuedCommercial } from '@/lib/services/tax-invoice-from-commercial-service';
import { verifyOpecCustomerPaymentForCommercial } from '@/lib/services/commercial-payment-flow-service';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function newLineId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function statusBadge(invoice: CommercialInvoice) {
  const status = invoice.status;
  if (status === 'PENDING_CUSTOMER' && invoice.customerRevisionRequestedAt) {
    return (
      <Badge className="bg-orange-700" title="ลูกค้าแจ้งร้องขอแก้ไขผ่าน portal">
        ร้องขอแก้ไข
      </Badge>
    );
  }
  switch (status) {
    case 'DRAFT':
      return (
        <Badge variant="secondary" title="ตรวจยอดภายใน — ยังไม่แสดงใน portal ลูกค้า">
          ตรวจภายใน (DRAFT)
        </Badge>
      );
    case 'PENDING_CUSTOMER':
      return <Badge className="bg-amber-600">รอลูกค้าตรวจ</Badge>;
    case 'ISSUED':
      return <Badge className="bg-green-600">ยืนยันเรียกเก็บแล้ว</Badge>;
    case 'VOID':
      return <Badge variant="outline">ยกเลิก</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export default function DraftInvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const [actionBusy, setActionBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [voidBusy, setVoidBusy] = useState(false);
  const [regenerateBusy, setRegenerateBusy] = useState(false);
  const [taxFromComBusy, setTaxFromComBusy] = useState(false);
  const [offerTaxDialogOpen, setOfferTaxDialogOpen] = useState(false);
  const [draftLines, setDraftLines] = useState<CommercialInvoiceLine[]>([]);
  const [notesDraft, setNotesDraft] = useState('');
  const [verifyPayBusy, setVerifyPayBusy] = useState(false);
  const [verifyBankId, setVerifyBankId] = useState<string>('');
  const [verifyEntryDate, setVerifyEntryDate] = useState('');

  const isAccountingActor = useMemo(
    () => !!currentUser && (isSystemAdmin(currentUser) || isSimpleAccounting(currentUser)),
    [currentUser],
  );

  const canSee = useMemo(
    () => !!currentUser && canView(currentUser, 'draft_invoices'),
    [currentUser]
  );
  const canAct = useMemo(
    () => !!currentUser && canEdit(currentUser, 'draft_invoices'),
    [currentUser]
  );
  const canAdminVoid = useMemo(
    () => !!currentUser && (isSystemAdmin(currentUser) || isSimpleAdmin(currentUser)),
    [currentUser],
  );
  const canCreateTax = useMemo(
    () => !!currentUser && canCreate(currentUser, 'tax_invoices'),
    [currentUser]
  );

  const invRef = useMemoFirebase(
    () => (firestore && canSee ? doc(firestore, 'commercial_invoices', id) : null),
    [firestore, canSee, id]
  );
  const { data: invoice, isLoading } = useDoc<CommercialInvoice>(invRef as any);

  const bankListQ = useMemoFirebase(() => {
    if (!firestore || !isAccountingActor) return null;
    /** ไม่ใส่ orderBy ใน query — หลีกเลี่ยง composite index; เรียงชื่อฝั่ง client */
    return query(collection(firestore, 'bank_accounts'), where('status', '==', 'ACTIVE'));
  }, [firestore, isAccountingActor]);
  const { data: bankListRaw } = useCollection<BankAccount>(bankListQ as any);
  const bankList = useMemo(() => {
    const list = bankListRaw ?? [];
    return [...list].sort((a, b) =>
      (a.accountName || '').localeCompare(b.accountName || '', 'th', { sensitivity: 'base' }),
    );
  }, [bankListRaw]);

  const visibleGenerationWarnings = useMemo(() => {
    const raw = invoice?.generationWarnings;
    if (!raw?.length) return [];
    return raw.filter((w) => !shouldOmitCommercialInvoiceGenerationWarning(w));
  }, [invoice?.generationWarnings]);

  useEffect(() => {
    if (!invoice) return;
    setDraftLines((invoice.lines ?? []).map((l) => ({ ...l })));
    setNotesDraft(invoice.notes ?? '');
  }, [invoice?.id, invoice?.updatedAt]);

  useEffect(() => {
    setVerifyEntryDate((d) => (d ? d : timestampToHtmlDateValue(Date.now())));
  }, []);

  const custRef = useMemoFirebase(
    () =>
      firestore && invoice?.customerId ? doc(firestore, 'customers', invoice.customerId) : null,
    [firestore, invoice?.customerId]
  );
  const { data: customer } = useDoc<Customer>(custRef as any);

  const companyProfileRef = useMemoFirebase(
    () => (firestore && canSee ? doc(firestore, 'system', 'company_profile') : null),
    [firestore, canSee]
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
    () => (firestore && invoice?.poId ? doc(firestore, 'purchase_orders', invoice.poId) : null),
    [firestore, invoice?.poId]
  );
  const { data: purchaseOrder } = useDoc<PurchaseOrder>(poRef as any);

  const contractIdForPrint = invoice?.contractId || purchaseOrder?.contractId;
  const mainContractRef = useMemoFirebase(
    () =>
      firestore && contractIdForPrint
        ? doc(firestore, 'main_contracts', contractIdForPrint)
        : null,
    [firestore, contractIdForPrint]
  );
  const { data: mainContract } = useDoc<MainContract>(mainContractRef as any);

  const quotationRef = useMemoFirebase(
    () =>
      firestore && purchaseOrder?.quotationId
        ? doc(firestore, 'quotations', purchaseOrder.quotationId)
        : null,
    [firestore, purchaseOrder?.quotationId],
  );
  const { data: quotation } = useDoc<Quotation>(quotationRef as any);

  const { printLocale, setPrintLocale } = useDocumentPrintLocale();

  const previewTotals = useMemo(() => {
    if (!invoice) return { before: 0, vat: 0, total: 0 };
    const before = roundMoney(
      draftLines.reduce((s, l) => s + roundMoney(l.quantity * l.unitPrice), 0),
    );
    const vat = roundMoney((before * (Number(invoice.vatPercent) || 0)) / 100);
    return { before, vat, total: roundMoney(before + vat) };
  }, [draftLines, invoice]);

  const canRegenerateFromTimesheets = useMemo(() => {
    if (!invoice || !canAct || invoice.status !== 'DRAFT') return false;
    return invoice.waveId !== QUOTATION_PO_WAVE_PLACEHOLDER;
  }, [invoice, canAct]);

  const docEn = printLocale === 'en';
  const moneyLoc = docEn ? 'en-GB' : 'th-TH';
  const docL = printLocale as PrintDocumentLocale;

  const lineDescription = useMemo(() => {
    return (raw: string, workerName?: string) => {
      const base = (raw || '—') + (workerName ? ` (${workerName})` : '');
      if (printLocale === 'en') return translateCommercialLineDescriptionToEn(base);
      return base;
    };
  }, [printLocale]);

  const waveDisplay = useMemo(() => {
    const raw =
      invoice?.waveId === QUOTATION_PO_WAVE_PLACEHOLDER
        ? docEn
          ? 'Quotation (no Wave / timesheet)'
          : 'ใบเสนอราคา (ไม่มี Wave / timesheet)'
        : invoice?.waveId === PO_MONTH_WAVE_PLACEHOLDER
          ? invoice.waveCode || (docEn ? 'PO+month (all waves)' : 'PO+งวด (รวม wave)')
          : invoice?.waveCode || '—';
    return docEn ? translateCommercialWaveCodeToEn(raw) : raw;
  }, [invoice?.waveCode, invoice?.waveId, docEn]);

  const lineCols = useMemo(() => {
    const L = printLocale as PrintDocumentLocale;
    return L === 'en'
      ? { desc: 'Description', qty: 'Qty', unit: 'Unit price', amt: 'Amount' }
      : { desc: 'รายละเอียด', qty: 'จำนวน', unit: 'ราคา/หน่วย', amt: 'จำนวนเงิน' };
  }, [printLocale]);

  const handlePrintCommercial = async () => {
    if (!invoice) return;
    const invoiceForPrint =
      invoice.status === 'DRAFT' && canAct ? { ...invoice, notes: notesDraft } : invoice;
    const body = buildCommercialInvoicePrintHtml({
      company: companyProfile ?? undefined,
      invoice: invoiceForPrint,
      customer: customer ?? undefined,
      purchaseOrder: purchaseOrder ?? undefined,
      mainContract: mainContract ?? undefined,
      quotation: quotation ?? undefined,
      lines: draftLines,
      amountBeforeTax: previewTotals.before,
      vatAmount: previewTotals.vat,
      totalAmount: previewTotals.total,
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
        title: 'เปิดหน้าต่างพิมพ์ไม่ได้',
        description: 'กรุณาอนุญาตป๊อปอัปสำหรับเว็บไซต์นี้',
      });
    }
  };

  if (isUserLoading || userLoading || !currentUser) return null;

  if (!canSee) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="p-6 text-muted-foreground">ไม่มีสิทธิ์</div>
      </AppShell>
    );
  }

  if (isLoading) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="p-6">กำลังโหลด…</div>
      </AppShell>
    );
  }

  if (!invoice) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="p-6 space-y-4">
          <p className="text-muted-foreground">ไม่พบใบแจ้งหนี้ — อาจถูกลบหรือยกเลิกแล้ว</p>
          <Button variant="outline" asChild>
            <Link href="/draft-invoices">
              <ArrowLeft className="mr-2 h-4 w-4" />
              กลับรายการใบแจ้งหนี้
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/accounting/trip-billing">ไปหน้าทำใบแจ้งหนี้แบบ Trip</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  const handleSendToCustomer = async () => {
    if (!firestore || !currentUser || !canAct) return;
    setActionBusy(true);
    try {
      await sendCommercialDraftToCustomer(firestore, invoice.id, currentUser);
      toast({
        title: 'ส่งให้ลูกค้าแล้ว',
        description: invoice.customerRevisionRequestedAt
          ? 'ส่งเวอร์ชันแก้ไขให้ลูกค้าตรวจอีกครั้ง — สถานะรอลูกค้า'
          : 'เอกสารปรากฏใน Client Portal — สถานะรอลูกค้าตรวจสอบ',
      });
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'ส่งไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setActionBusy(false);
    }
  };

  const handleReopenForRevision = async () => {
    if (!firestore || !currentUser || !canAct) return;
    setActionBusy(true);
    try {
      await reopenCommercialInvoiceForCustomerRevision(firestore, invoice.id, currentUser);
      toast({
        title: 'เปิดโหมดแก้ไขแล้ว',
        description: 'แก้ไขรายการในตารางด้านล่าง บันทึก แล้วส่งกลับให้ลูกค้าตรวจอีกครั้ง',
      });
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'เปิดแก้ไขไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setActionBusy(false);
    }
  };

  const handleManagerConfirm = async () => {
    if (!firestore || !currentUser || !canAct || !invoice) return;
    setActionBusy(true);
    try {
      await confirmCommercialInvoiceBilling(firestore, invoice, currentUser, 'INTERNAL');
      toast({
        title: 'ยืนยันแล้ว',
        description: 'บันทึกการยืนยันยอดเรียกเก็บ (ฝั่ง OPEC)',
      });
      if (canCreateTax && !invoice.linkedTaxInvoiceId) {
        setOfferTaxDialogOpen(true);
      }
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'ยืนยันไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setActionBusy(false);
    }
  };

  const handleSaveDraftLines = async () => {
    if (!firestore || !currentUser || !canAct || !invoice || invoice.status !== 'DRAFT') return;
    setSaveBusy(true);
    try {
      await updateCommercialDraftInvoice(firestore, invoice.id, draftLines, currentUser, {
        notes: notesDraft,
      });
      toast({ title: 'บันทึกแล้ว', description: 'อัปเดตรายการ เงื่อนไข/หมายเหตุ และยอดก่อน VAT / VAT / รวม' });
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'บันทึกไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaveBusy(false);
    }
  };

  const handleRegenerateFromTimesheets = async () => {
    if (!firestore || !currentUser || !canAct || !invoice || !canRegenerateFromTimesheets) return;
    setRegenerateBusy(true);
    try {
      const res = await regenerateCommercialDraftInvoiceFromTimesheets(
        firestore,
        invoice.id,
        currentUser,
      );
      toast({
        title: 'ดึงรายการใหม่แล้ว',
        description: `${res.lineCount} บรรทัด (จาก ${res.timesheetCount} แถว timesheet) — บรรทัดส่วนลด/ค่าเพิ่มที่เพิ่มเองยังอยู่`,
      });
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'ดึงรายการใหม่ไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setRegenerateBusy(false);
    }
  };

  const handleVoid = async () => {
    if (!firestore || !currentUser || !canAdminVoid || !invoice) return;
    setVoidBusy(true);
    try {
      await voidCommercialInvoice(firestore, invoice.id, currentUser);
      toast({
        title: 'ยกเลิกแล้ว',
        description: 'สถานะ VOID — สร้างใบใหม่จากงวด / PO ได้ตามเดิม',
      });
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'ยกเลิกไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setVoidBusy(false);
    }
  };

  const handleCreateTaxFromCommercial = async () => {
    if (!firestore || !currentUser || !invoice) return;
    setTaxFromComBusy(true);
    try {
      const { taxInvoiceId } = await createTaxInvoiceDraftFromIssuedCommercial(firestore, invoice.id, currentUser);
      toast({
        title: 'สร้างใบวางบิล + ใบกำกับภาษี (ร่าง) แล้ว',
        description:
          'ส่งลูกค้า/พิมพ์ได้จากหน้าใบกำกับ — ยังไม่ e-Tax — ใบเสร็จรับเงินอีกขั้นหลังลูกค้าโอนและบัญชียืนยันรับเงิน',
      });
      router.push(`/tax-invoices/${taxInvoiceId}`);
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'ไม่สามารถสร้าง',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setTaxFromComBusy(false);
    }
  };

  const handleVerifyOpecPayment = async () => {
    if (!firestore || !currentUser || !invoice) return;
    if (!verifyBankId.trim() || !verifyEntryDate?.trim()) {
      toast({ variant: 'destructive', title: 'กรุณาเลือกบัญชีและวันที่รับเงิน' });
      return;
    }
    setVerifyPayBusy(true);
    try {
      const r = await verifyOpecCustomerPaymentForCommercial(
        firestore,
        invoice.id,
        currentUser as User,
        { bankAccountId: verifyBankId, entryDate: verifyEntryDate },
      );
      toast({
        title: 'ยืนยันรับเงินแล้ว',
        description: `ออกใบกำกับ ${r.taxInvoiceNo} (ISSUED) · สมุด ${r.entryNo} — ตรวจรายละเอียดที่เมนูใบกำกับ/ใบเสร็จ`,
      });
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'ไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setVerifyPayBusy(false);
    }
  };

  const patchDraftLine = (lineId: string, patch: Partial<CommercialInvoiceLine>) => {
    setDraftLines((rows) =>
      rows.map((r) => {
        if (r.id !== lineId) return r;
        const next = { ...r, ...patch };
        const qty = roundMoney(Number(next.quantity) || 0);
        const unit = roundMoney(Number(next.unitPrice) || 0);
        return { ...next, quantity: qty, unitPrice: unit, amount: roundMoney(qty * unit) };
      }),
    );
  };

  const removeDraftLine = (lineId: string) => {
    setDraftLines((rows) => rows.filter((r) => r.id !== lineId));
  };

  const addManualAdjustmentLine = () => {
    setDraftLines((rows) => [
      ...rows,
      {
        id: newLineId(),
        description: docEn
          ? 'Discount / surcharge (specify details)'
          : 'ส่วนลด / ค่าเพิ่ม (ระบุรายละเอียด)',
        quantity: 1,
        unitPrice: 0,
        amount: 0,
        lineSource: 'manual',
      },
    ]);
  };

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 p-4 md:p-6 max-w-5xl mx-auto">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/draft-invoices">
              <ArrowLeft className="h-4 w-4 mr-1" />
              รายการ
            </Link>
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold flex items-center gap-2 flex-wrap">
              <FileText className="h-6 w-6 shrink-0" />
              <span className="font-mono">{invoice.invoiceNo}</span>
              {statusBadge(invoice)}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {printT(docL, 'commercialNotTaxInvoice')}
            </p>
          </div>
          <div className="print:hidden flex flex-wrap items-center gap-2 shrink-0">
            <DocumentPrintLocaleToggle
              printLocale={printLocale}
              setPrintLocale={setPrintLocale}
              showLabel
            />
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              type="button"
              onClick={() => handlePrintCommercial()}
            >
              <Printer className="h-4 w-4" />
              พิมพ์
            </Button>
          </div>
        </div>

        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>ขั้นตอนการเรียกเก็บ</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              <strong>ตรวจภายใน (DRAFT)</strong> — ตรวจยอดและรายการให้ถูกต้อง จากนั้นกด{' '}
              <strong>ส่งให้ลูกค้าตรวจสอบ</strong> เพื่อแสดงใน Client Portal
            </p>
            <p>
              <strong>รอลูกค้าตรวจ</strong> — ลูกค้า (Approver) หรือผู้จัดการฝั่ง OPEC สามารถกดยืนยันยอดได้
            </p>
            <p className="text-xs text-muted-foreground">
              หลังยืนยันเรียกเก็บแล้ว — ฝ่ายบัญชีสร้าง <strong>ใบกำกับภาษี (กับใบวางบิล)</strong> ส่งลูกค้า — แยกจาก{' '}
              <strong>ใบเสร็จรับเงิน</strong> ที่ออกหลังลูกค้าโอนแล้วบัญชีตรวจสอบและยืนยันรับเงิน (ยังไม่ e-Tax)
            </p>
          </AlertDescription>
        </Alert>

        {invoice.customerRevisionRequestedAt && (
          <Alert className="border-purple-300 bg-purple-50/80 dark:bg-purple-950/30">
            <AlertTitle>ข้อความจากลูกค้า (ร้องขอแก้ไข)</AlertTitle>
            <AlertDescription className="space-y-2">
              <span className="block text-xs text-muted-foreground">
                แจ้งเมื่อ {formatDateTimeThaiBE(invoice.customerRevisionRequestedAt)}
              </span>
              <p className="whitespace-pre-wrap text-sm">
                {invoice.customerRevisionRequestNote?.trim() ? invoice.customerRevisionRequestNote : '—'}
              </p>
              {canAct && invoice.status === 'PENDING_CUSTOMER' && (
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button
                    type="button"
                    className="gap-2 shrink-0"
                    onClick={() => void handleReopenForRevision()}
                    disabled={actionBusy}
                  >
                    {actionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
                    แก้ไขรายการ
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0 border-purple-400"
                    disabled
                    title='กด "แก้ไขรายการ" ก่อน แล้วแก้ในตาราง บันทึก และใช้ปุ่มส่งกลับด้านบน'
                  >
                    ส่งกลับไปให้ลูกค้าตรวจสอบ
                  </Button>
                </div>
              )}
              {canAct && invoice.status === 'DRAFT' && (
                <p className="text-xs text-muted-foreground pt-1">
                  แก้ไขรายการในตารางด้านล่าง แล้วใช้ปุ่ม &quot;ส่งกลับไปให้ลูกค้าตรวจสอบ&quot; ด้านบนเมื่อเสร็จ
                </p>
              )}
            </AlertDescription>
          </Alert>
        )}

        {invoice.status === 'ISSUED' && invoice.customerApprovedAt && (
          <p className="text-sm text-green-700">
            ยืนยันเรียกเก็บแล้ว {formatDateTimeThaiBE(invoice.customerApprovedAt)}
            {invoice.customerApprovedByName ? ` · ${invoice.customerApprovedByName}` : ''}
            {invoice.customerApprovalSource === 'CLIENT_PORTAL' ? ' (ลูกค้า)' : ' (OPEC)'}
          </p>
        )}

        {invoice.status === 'ISSUED' && invoice.customerPaymentReportedAt && !invoice.opecPaymentVerifiedAt && (
          <Alert className="border-amber-200 bg-amber-50/80 dark:bg-amber-950/25">
            <AlertTitle>ลูกค้าแจ้งชำระเงิน</AlertTitle>
            <AlertDescription className="space-y-3 text-sm">
              {invoice.customerPaymentProofUrl ? (
                <p>
                  หลักฐานแนบ:{' '}
                  <a
                    className="text-primary underline font-medium"
                    href={invoice.customerPaymentProofUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    เปิดไฟล์
                  </a>
                  {invoice.customerPaymentProofFileName ? ` (${invoice.customerPaymentProofFileName})` : ''}
                </p>
              ) : (
                <p>ไม่มี URL แนบ (ข้อมูลเก่า)</p>
              )}
              {isAccountingActor ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
                  <div className="space-y-1 min-w-[200px]">
                    <Label className="text-xs">รับเข้าบัญชีธนาคาร</Label>
                    <Select value={verifyBankId} onValueChange={setVerifyBankId}>
                      <SelectTrigger>
                        <SelectValue placeholder="เลือกบัญชี" />
                      </SelectTrigger>
                      <SelectContent>
                        {(bankList ?? []).map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.accountName} — {b.bankName} ({b.accountNumber})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">วันที่รับเงิน (ลงสมุด)</Label>
                    <Input
                      type="date"
                      className="w-[11rem]"
                      value={verifyEntryDate}
                      onChange={(e) => setVerifyEntryDate(e.target.value)}
                    />
                  </div>
                  <Button
                    type="button"
                    className="gap-2"
                    disabled={verifyPayBusy || !verifyBankId}
                    onClick={() => void handleVerifyOpecPayment()}
                  >
                    {verifyPayBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    ยืนยันรับเงิน · ออกใบกำกับ (ISSUED) · ลง cashbook
                  </Button>
                </div>
              ) : (
                <p className="text-muted-foreground text-xs">เฉพาะบัญชี/แอดมิน — ตรวจสอบหลักฐานแล้วกดยืนยันตามขั้นตอน</p>
              )}
            </AlertDescription>
          </Alert>
        )}

        {invoice.status === 'ISSUED' && invoice.opecPaymentVerifiedAt && (
          <p className="text-sm text-slate-700 dark:text-slate-300">
            รับรองรับเงินแล้ว {formatDateTimeThaiBE(invoice.opecPaymentVerifiedAt)}
            {invoice.opecPaymentCashbookEntryId
              ? ` · cashbook: ${invoice.opecPaymentCashbookEntryId.slice(0, 8)}…`
              : ''}
          </p>
        )}

        {invoice.status === 'ISSUED' && (
          <Alert className="border-emerald-200 bg-emerald-50/80 dark:bg-emerald-950/25">
            <FileBadge className="h-4 w-4" />
            <AlertTitle>ขั้นตอนบัญชี — ใบกำกับภาษี แยกจาก ใบเสร็จรับเงิน</AlertTitle>
            <AlertDescription className="space-y-2 text-sm">
              <p>
                สร้าง <strong>ใบวางบิล + ใบกำกับภาษี (ร่าง)</strong> จากใบนี้เพื่อส่งลูกค้า — <strong>ใบเสร็จรับเงิน</strong> ออก
                หลังลูกค้าโอนและบัญชียืนยันรับเงิน (พิมพ์/ e-Tax ตามนโยบายบริษัท)
              </p>
              {invoice.linkedTaxInvoiceId ? (
                <Button variant="default" className="gap-2 w-fit" asChild>
                  <Link href={`/tax-invoices/${invoice.linkedTaxInvoiceId}`}>
                    <FileBadge className="h-4 w-4" />
                    เปิดใบกำกับภาษี
                  </Link>
                </Button>
              ) : canCreateTax ? (
                <Button
                  type="button"
                  className="gap-2 w-fit"
                  disabled={taxFromComBusy}
                  onClick={() => void handleCreateTaxFromCommercial()}
                >
                  {taxFromComBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileBadge className="h-4 w-4" />}
                  สร้างใบกำกับภาษี (ร่าง) + ใบวางบิล
                </Button>
              ) : (
                <p className="text-muted-foreground">
                  ให้ผู้มีสิทธิ์เมนูใบกำกับภาษีสร้างจากใบเรียกเก็บนี้ (หรือขอสิทธิ์บัญชี)
                </p>
              )}
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>{docEn ? 'Document header' : 'หัวเอกสาร'}</CardTitle>
            <CardDescription>
              {docEn
                ? 'PO / Wave reference and billing period'
                : 'อ้างอิง PO / Wave (หรือ PO ใบเสนอราคา) และช่วงวางบิล'}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
            <div className="flex items-start gap-2">
              <Building2 className="h-4 w-4 mt-0.5 text-muted-foreground" />
              <div>
                <div className="text-muted-foreground text-xs">{printT(docL, 'customerInfo')}</div>
                <div className="font-medium">{customer?.name ?? invoice.customerId}</div>
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">{printT(docL, 'docDate')}</div>
              <div>{formatStoredDateThaiBE(invoice.issueDate)}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">
                {invoice.waveId === QUOTATION_PO_WAVE_PLACEHOLDER
                  ? printT(docL, 'billingPeriod')
                  : printT(docL, 'timesheetPeriod')}
              </div>
              <div>
                {formatStoredDateThaiBE(invoice.periodStart)} — {formatStoredDateThaiBE(invoice.periodEnd)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Wave</div>
              <div className="font-mono">
                {invoice.waveId === QUOTATION_PO_WAVE_PLACEHOLDER ||
                invoice.waveId === PO_MONTH_WAVE_PLACEHOLDER ? (
                  <span>{waveDisplay}</span>
                ) : (
                  <>
                    <span className="font-mono">{waveDisplay}</span>
                    <span className="text-muted-foreground text-xs ml-2 font-mono">
                      ({invoice.waveId.slice(0, 10)}…)
                    </span>
                  </>
                )}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">PO</div>
              <Link className="text-primary underline font-mono" href={`/purchase-orders/${invoice.poId}`}>
                เปิด PO
              </Link>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">{docEn ? 'Created by' : 'ผู้สร้าง'}</div>
              <div>{invoice.createdByName}</div>
            </div>
          </CardContent>
        </Card>

        {canAct && invoice.status === 'DRAFT' && (
          <div className="print:hidden flex flex-nowrap items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
            <Button className="gap-2 shrink-0" onClick={() => void handleSendToCustomer()} disabled={actionBusy}>
              {actionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {invoice.customerRevisionRequestedAt
                ? 'ส่งกลับไปให้ลูกค้าตรวจสอบ (Portal)'
                : 'ส่งให้ลูกค้าตรวจสอบ (Portal)'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="gap-2 shrink-0"
              onClick={() => void handleSaveDraftLines()}
              disabled={saveBusy}
            >
              {saveBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              บันทึกการแก้ไขรายการ
            </Button>
            <Button type="button" variant="outline" className="gap-2 shrink-0" onClick={addManualAdjustmentLine}>
              <Plus className="h-4 w-4" />
              เพิ่มส่วนลด / ค่าเพิ่ม
            </Button>
            {canRegenerateFromTimesheets && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2 shrink-0 border-blue-300 text-blue-800 hover:bg-blue-50 dark:text-blue-200 dark:hover:bg-blue-950/40"
                    disabled={regenerateBusy || saveBusy || actionBusy}
                  >
                    {regenerateBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    ดึงจาก timesheet ใหม่
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>ดึงรายการจาก timesheet ใหม่?</AlertDialogTitle>
                    <AlertDialogDescription>
                      ระบบจะคำนวณบรรทัดค่าแรงจาก timesheet ที่พร้อมวางบิลในงวดนี้อีกครั้ง (รวมทุก wave ใต้ PO
                      สำหรับงวด PO+เดือน) และแทนที่บรรทัดเดิมจาก timesheet — บรรทัดส่วนลด/ค่าเพิ่มที่เพิ่มเองจะยังอยู่
                      · เลขที่ใบและสถานะ DRAFT ไม่เปลี่ยน
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void handleRegenerateFromTimesheets()}>
                      ดึงใหม่
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        )}

        {canAdminVoid && (invoice.status === 'DRAFT' || invoice.status === 'PENDING_CUSTOMER') && (
          <div className="print:hidden flex flex-nowrap items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="destructive" className="gap-2 shrink-0" disabled={voidBusy}>
                  {voidBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                  ยกเลิกใบนี้ (VOID)
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>ยกเลิกใบแจ้งหนี้นี้?</AlertDialogTitle>
                  <AlertDialogDescription>
                    เฉพาะผู้ดูแลระบบ — ใช้เมื่อรายการหรือการคำนวณไม่ถูกต้อง สถานะจะเป็น VOID และสามารถสร้างใบใหม่จากงวด / PO
                    ได้อีกครั้ง (ไม่ลบประวัติเอกสาร) · ใบที่ลูกค้า/ฝ่ายยืนยันแล้ว (ISSUED) ยกเลิกไม่ได้
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>ไม่</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => void handleVoid()}
                  >
                    ยืนยันยกเลิก
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}

        {invoice.status === 'PENDING_CUSTOMER' && (
          <Alert className="border-amber-200 bg-amber-50/80">
            <AlertTitle>รอการยืนยันยอด</AlertTitle>
            <AlertDescription>
              {invoice.sentToCustomerAt && (
                <span className="block text-sm">
                  ส่งให้ลูกค้าเมื่อ {formatDateTimeThaiBE(invoice.sentToCustomerAt)}
                  {invoice.sentToCustomerByName ? ` · โดย ${invoice.sentToCustomerByName}` : ''}
                </span>
              )}
              {canAct && (
                <Button className="mt-3 gap-2" variant="default" onClick={() => void handleManagerConfirm()} disabled={actionBusy}>
                  {actionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  ยืนยันยอดเรียกเก็บ (ฝั่ง OPEC)
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}

        {visibleGenerationWarnings.length > 0 && (
          <Alert className="border-amber-200 bg-amber-50/80">
            <AlertTitle>คำเตือนตอนคำนวณ</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4 text-sm space-y-1">
                {visibleGenerationWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>
              {docEn ? 'Line items' : 'รายการ'} (
              {invoice.status === 'DRAFT' && canAct ? draftLines.length : (invoice.lines?.length ?? 0)}{' '}
              {docEn ? 'rows' : 'แถว'})
            </CardTitle>
            <CardDescription>
              {docEn
                ? `From billable timesheets — ${invoice.timesheetCount ?? '—'} timesheet row(s) total`
                : `จาก timesheet ที่พร้อมวางบิล — รวม ${invoice.timesheetCount ?? '—'} แถว timesheet`}
              {invoice.waveId === PO_MONTH_WAVE_PLACEHOLDER && (
                <span className="block mt-2 rounded-md border border-amber-200 bg-amber-50/90 px-3 py-2 text-sm text-amber-950">
                  <strong className="font-semibold">หมายเหตุ PO+งวด (รวมทุก wave):</strong> ยอดต่อตำแหน่งรวมจาก timesheet ทุก wave / mobilization ใต้ PO ในงวดวันที่เดียวกัน
                  — ไม่เท่ากับการนับเฉพาะหนึ่ง wave บนหน้า «สรุปรายเดือน» คอลัมน์ «รวมชม.» เป็นชั่วโมงทำงาน (เช่น 1 วัน W ≈ 12 ชม.) ไม่ใช่จำนวนวันในคอลัมน์จำนวนของใบนี้
                </span>
              )}
              {invoice.status === 'DRAFT' && canAct && (
                <span className="block mt-1 text-xs">
                  รายการรวมตามตำแหน่งจาก PO — แก้จำนวน/ราคาได้ และเพิ่มบรรทัดส่วนลดหรือค่าเพิ่ม (จำนวน × ราคา/หน่วย = ยอด;
                  ส่วนลดใส่ราคาต่อหน่วยติดลบได้)
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">{lineCols.desc}</TableHead>
                  <TableHead className="text-right w-28">{lineCols.qty}</TableHead>
                  <TableHead className="text-right w-36">{lineCols.unit}</TableHead>
                  <TableHead className="text-right pr-6 w-36">{lineCols.amt}</TableHead>
                  {invoice.status === 'DRAFT' && canAct && (
                    <TableHead className="w-12 print:hidden" aria-label="ลบ" />
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(invoice.status === 'DRAFT' && canAct ? draftLines : invoice.lines ?? []).map((line) => {
                  const isManualLine = line.lineSource === 'manual';
                  const displayDesc = lineDescription(line.description || '—', line.workerName);
                  const showDescInput =
                    invoice.status === 'DRAFT' && canAct && (!docEn || isManualLine);
                  return (
                  <TableRow key={line.id}>
                    <TableCell className="pl-6 max-w-md align-top">
                      {showDescInput ? (
                        <Input
                          className="font-medium text-sm h-9"
                          value={line.description}
                          onChange={(e) => patchDraftLine(line.id, { description: e.target.value })}
                        />
                      ) : (
                        <div className="font-medium text-sm leading-snug">{displayDesc}</div>
                      )}
                      {invoice.status === 'DRAFT' && canAct && docEn && !isManualLine ? (
                        <p className="text-xs text-muted-foreground mt-1 leading-snug">
                          Switch to <strong>ไทย</strong> to edit auto-generated line text.
                        </p>
                      ) : null}
                      {isManualLine && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {docEn ? 'Manual adjustment' : 'ปรับยอดด้วยมือ'}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right align-top">
                      {invoice.status === 'DRAFT' && canAct ? (
                        <Input
                          className="text-right h-9 font-mono text-sm"
                          type="number"
                          step="any"
                          value={line.quantity}
                          onChange={(e) =>
                            patchDraftLine(line.id, { quantity: Number(e.target.value) || 0 })
                          }
                        />
                      ) : (
                        line.quantity
                      )}
                    </TableCell>
                    <TableCell className="text-right align-top">
                      {invoice.status === 'DRAFT' && canAct ? (
                        <Input
                          className="text-right h-9 font-mono text-sm"
                          type="number"
                          step="any"
                          value={line.unitPrice}
                          onChange={(e) =>
                            patchDraftLine(line.id, { unitPrice: Number(e.target.value) || 0 })
                          }
                        />
                      ) : (
                        <>฿{line.unitPrice.toLocaleString(moneyLoc, { minimumFractionDigits: 2 })}</>
                      )}
                    </TableCell>
                    <TableCell className="text-right pr-6 font-medium align-top font-mono text-sm">
                      ฿
                      {roundMoney(line.quantity * line.unitPrice).toLocaleString(moneyLoc, {
                        minimumFractionDigits: 2,
                      })}
                    </TableCell>
                    {invoice.status === 'DRAFT' && canAct && (
                      <TableCell className="print:hidden align-top">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => removeDraftLine(line.id)}
                          aria-label="ลบแถว"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm bg-white">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
              <div className="space-y-2 order-2 lg:order-1">
                <Label className="text-xs font-black uppercase text-muted-foreground tracking-widest flex items-center gap-2">
                  <Info className="h-3 w-3" /> Term &amp; Note (เงื่อนไขและหมายเหตุ)
                </Label>
                <Textarea
                  className="text-sm min-h-[120px] resize-y"
                  placeholder="ระบุเงื่อนไขการเรียกเก็บหรือหมายเหตุที่ต้องการแสดงในเอกสารพิมพ์..."
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  disabled={invoice.status !== 'DRAFT' || !canAct}
                />
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-end text-sm order-1 lg:order-2">
                <div className="text-right space-y-1 w-full">
                  <div>
                    <span className="text-muted-foreground">
                      {docEn
                        ? `${printT(docL, 'subtotal')} (${invoice.vatPercent}% VAT)`
                        : `ยอดก่อน VAT (${invoice.vatPercent}%)`}{' '}
                    </span>
                    <span className="font-mono font-medium">
                      ฿
                      {(invoice.status === 'DRAFT' && canAct
                        ? previewTotals.before
                        : invoice.amountBeforeTax
                      ).toLocaleString(moneyLoc, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{printT(docL, 'vat')} </span>
                    <span className="font-mono font-medium">
                      ฿
                      {(invoice.status === 'DRAFT' && canAct ? previewTotals.vat : invoice.vatAmount).toLocaleString(
                        moneyLoc,
                        { minimumFractionDigits: 2 },
                      )}
                    </span>
                  </div>
                  <div className="text-lg font-bold text-primary pt-2">
                    {printT(docL, 'grandTotal')} ฿
                    {(invoice.status === 'DRAFT' && canAct ? previewTotals.total : invoice.totalAmount).toLocaleString(
                      moneyLoc,
                      { minimumFractionDigits: 2 },
                    )}{' '}
                    {invoice.currency}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={offerTaxDialogOpen} onOpenChange={setOfferTaxDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>สร้างใบวางบิล + ใบกำกับภาษี (ร่าง)?</AlertDialogTitle>
            <AlertDialogDescription>
              ระบบจะสร้างใบวางบิลและใบกำกับภาษี (ร่าง) จากใบเรียกเก็บนี้เพื่อส่งลูกค้า (คนละชุดกับใบเสร็จรับเงิน) — หลังลูกค้าโอน
              บัญชียืนยันรับเงินแล้วจะออกใบกำกับ (ISSUED) ปิด AR / ลง cashbook ตามเมนูบัญชี
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">ภายหลัง</AlertDialogCancel>
            <Button
              type="button"
              onClick={() => {
                setOfferTaxDialogOpen(false);
                void handleCreateTaxFromCommercial();
              }}
            >
              สร้างเลย
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
