'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, orderBy, query, where } from 'firebase/firestore';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  fmtBaht,
  mergeUniqueProofAttachments,
  ProofAttachmentZone,
  renderTaxStatusBadge,
  renderWageStatusBadge,
  VENDOR_WHT_LIST_TABLE_COLGROUP,
  VENDOR_WHT_EQUAL_COL_HEAD,
  VENDOR_WHT_EQUAL_COL_CELL,
} from '@/components/accounting/withholding-wht-pay-tax-ui';
import { cn } from '@/lib/utils';
import { formatYmdLocalThaiBE } from '@/lib/date-thai';
import {
  buildYearCeOptions,
  currentMonthMm,
  currentYearCe,
  describeYearMonthScopeFilter,
  ymMatchesYearMonthScope,
} from '@/lib/date/year-month-scope-filter';
import { YearMonthScopeSelects } from '@/components/accounting/year-month-scope-selects';
import { useFirestore, useCollection, useMemoFirebase, useFirebaseApp } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canSeeAccountingPillarUi, canExecuteBankCashbookPayments } from '@/lib/permissions';
import { usePermissions } from '@/hooks/use-permissions';
import type { User, WithholdingCertificateDocument, BankAccount, WhtTaxPaymentProofAttachment } from '@/lib/types';
import { Building2, ExternalLink, Loader2, Search, Printer, Banknote, Paperclip } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  isVendorWhtRowPayable,
  isVendorWhtSourcePaid,
  isVendorWhtTaxRemitted,
  vendorPaymentStatusLabel,
} from '@/lib/wht/vendor-wht-tax-payment-model';
import { recordVendorWhtTaxPayment } from '@/lib/services/vendor-wht-tax-payment-service';
import { uploadPayrollWhtTaxPaymentProof } from '@/lib/storage/payroll-wht-tax-payment-proofs';
import {
  buildWithholdingVendorListPrintHtml,
  capWithholdingVendorListPrintRows,
  type WithholdingVendorListPrintRow,
} from '@/lib/documents/withholding-vendor-list-print';
import { openStandardPrintWindow } from '@/lib/documents/standard-document-print';

function isVendorPartnerWhtDoc(d: WithholdingCertificateDocument): boolean {
  return typeof d.sourceVendorBillId === 'string' && d.sourceVendorBillId.trim().length > 0;
}

function vendorWhtPaidAmount(d: WithholdingCertificateDocument): number {
  const gross = Number(d.grossAmount) || 0;
  if (gross > 0.005) return gross;
  const net = Number(d.netPaidAmount) || 0;
  const wht = Number(d.withholdingTaxAmount) || 0;
  return net + wht;
}

function vendorDocKey(id: string): string {
  return id;
}

function vendorWhtDocYm(d: WithholdingCertificateDocument): string | null {
  const pd = (d.paymentDate || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(pd)) return pd.slice(0, 7);
  if (Number.isFinite(d.createdAt) && d.createdAt > 0) {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
    });
    const parts = fmt.formatToParts(new Date(d.createdAt));
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    if (y && m) return `${y}-${m}`;
  }
  return null;
}

function describeWithholdingVendorPrintFilters(
  searchTerm: string,
  yearCe: number,
  monthScope: string,
): string[] {
  const lines: string[] = [];
  lines.push(`ช่วง: ${describeYearMonthScopeFilter(yearCe, monthScope)}`);
  if (searchTerm.trim()) {
    lines.push(`ค้นหา: "${searchTerm.trim()}"`);
  }
  return lines;
}

function buildWithholdingVendorPrintRows(list: WithholdingCertificateDocument[]): WithholdingVendorListPrintRow[] {
  return list.map((d) => {
    const sourcePaid = isVendorWhtSourcePaid(d);
    return {
      paymentStatus: vendorPaymentStatusLabel(d),
      taxStatus: sourcePaid
        ? isVendorWhtTaxRemitted(d)
          ? 'จ่ายแล้ว'
          : 'รอจ่าย'
        : '—',
      certificateNo: d.certificateNo?.trim() || '—',
      vendorName: d.payee?.displayName?.trim() || '—',
      vendorTaxId: d.payee?.taxId?.trim() || '',
      paymentDate: formatYmdLocalThaiBE(d.paymentDate),
      paidLabel: fmtBaht(vendorWhtPaidAmount(d)),
      withholdingLabel: fmtBaht(Number(d.withholdingTaxAmount) || 0),
      billRef: d.referenceVendorBillNo || '—',
      poRef: d.referencePurchaseNo?.trim() || '',
    };
  });
}

export default function AccountingWithholdingVendorDocumentsPage() {
  const { currentUser, isLoading } = useAppUser();
  const { profile } = usePermissions(currentUser);
  const firestore = useFirestore();
  const firebaseApp = useFirebaseApp();
  const { toast } = useToast();
  const payTaxProofInputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [yearFilterCe, setYearFilterCe] = useState(() => currentYearCe());
  const [monthScope, setMonthScope] = useState(() => currentMonthMm());
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);
  const [vendorDocs, setVendorDocs] = useState<WithholdingCertificateDocument[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [payTaxOpen, setPayTaxOpen] = useState(false);
  const [payTaxBankId, setPayTaxBankId] = useState('');
  const [payTaxDate, setPayTaxDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payTaxBusy, setPayTaxBusy] = useState(false);
  const [payTaxAttachments, setPayTaxAttachments] = useState<WhtTaxPaymentProofAttachment[]>([]);
  const [attachProofBusy, setAttachProofBusy] = useState(false);
  const [sessionProofAttachments, setSessionProofAttachments] = useState<WhtTaxPaymentProofAttachment[]>([]);

  const canPayWhtTax = useMemo(() => canExecuteBankCashbookPayments(currentUser), [currentUser]);

  const bankAccountsQuery = useMemoFirebase(
    () =>
      firestore && canPayWhtTax
        ? query(collection(firestore, 'bank_accounts'), where('status', '==', 'ACTIVE'))
        : null,
    [firestore, canPayWhtTax],
  );
  const { data: bankAccounts } = useCollection<BankAccount>(bankAccountsQuery as any);
  const operatingBankOptions = useMemo(() => {
    const list = (bankAccounts ?? []).filter((a) => String(a.accountType) !== 'PETTY_CASH');
    list.sort((a, b) => (a.accountCode || '').localeCompare(b.accountCode || '', 'th', { numeric: true }));
    return list;
  }, [bankAccounts]);

  const whtQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'withholding_certificate_documents'), orderBy('createdAt', 'desc'));
  }, [firestore]);

  const { data: rows, isLoading: loadingDocs, error } = useCollection<WithholdingCertificateDocument>(whtQuery as any);

  useEffect(() => {
    setVendorDocs((rows || []).filter(isVendorPartnerWhtDoc));
  }, [rows]);

  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of vendorDocs) {
      const ym = vendorWhtDocYm(d);
      if (ym) set.add(ym);
    }
    return Array.from(set).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  }, [vendorDocs]);

  const yearOptionsCe = useMemo(() => buildYearCeOptions(monthOptions), [monthOptions]);

  const vendorDocsBySearch = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return vendorDocs;
    return vendorDocs.filter((d) => {
      const payee = (d.payee?.displayName || '').toLowerCase();
      const cert = (d.certificateNo || '').toLowerCase();
      const bill = (d.referenceVendorBillNo || '').toLowerCase();
      const po = (d.referencePurchaseNo || '').toLowerCase();
      return payee.includes(t) || cert.includes(t) || bill.includes(t) || po.includes(t) || d.id.toLowerCase().includes(t);
    });
  }, [vendorDocs, q]);

  const filtered = useMemo(() => {
    return vendorDocsBySearch.filter((d) => ymMatchesYearMonthScope(vendorWhtDocYm(d), yearFilterCe, monthScope));
  }, [vendorDocsBySearch, yearFilterCe, monthScope]);

  const payableRows = useMemo(() => filtered.filter(isVendorWhtRowPayable), [filtered]);

  const payableKeySig = useMemo(
    () => payableRows.map((d) => vendorDocKey(d.id)).sort().join('|'),
    [payableRows],
  );

  useEffect(() => {
    const keys = payableKeySig ? payableKeySig.split('|') : [];
    setSelectedKeys(new Set(keys));
  }, [payableKeySig]);

  const selectedPayRows = useMemo(
    () => payableRows.filter((d) => selectedKeys.has(vendorDocKey(d.id))),
    [payableRows, selectedKeys],
  );

  const selectedTaxTotal = useMemo(
    () => selectedPayRows.reduce((sum, d) => sum + (Number(d.withholdingTaxAmount) || 0), 0),
    [selectedPayRows],
  );

  const displayedProofAttachments = useMemo(() => {
    const fromRows = vendorDocs.flatMap((d) => d.whtTaxPaymentProofAttachments ?? []);
    return mergeUniqueProofAttachments(fromRows, sessionProofAttachments);
  }, [vendorDocs, sessionProofAttachments]);

  const removableProofIds = useMemo(
    () => new Set(sessionProofAttachments.map((a) => a.id)),
    [sessionProofAttachments],
  );

  const totalWithholding = useMemo(
    () => filtered.reduce((sum, d) => sum + (Number(d.withholdingTaxAmount) || 0), 0),
    [filtered],
  );

  const allTotalWithholding = useMemo(
    () => vendorDocs.reduce((sum, d) => sum + (Number(d.withholdingTaxAmount) || 0), 0),
    [vendorDocs],
  );

  const allTotalPaid = useMemo(
    () => vendorDocs.reduce((sum, d) => sum + vendorWhtPaidAmount(d), 0),
    [vendorDocs],
  );

  const runWithholdingVendorListPrint = useCallback(
    async (scope: 'filtered' | 'all') => {
      const source = scope === 'filtered' ? filtered : vendorDocs;
      if (source.length === 0) {
        toast({
          variant: 'destructive',
          title: 'ไม่มีรายการให้พิมพ์',
          description:
            scope === 'filtered'
              ? 'ไม่พบข้อมูลตามตัวกรอง — ปรับตัวกรองหรือเลือกพิมพ์ทั้งหมด'
              : 'ยังไม่มีเอกสารหัก ณ ที่จ่ายจากคู่ค้า',
        });
        return;
      }

      setPrintBusy(true);
      try {
        const { rows: printRows, truncated } = capWithholdingVendorListPrintRows(
          buildWithholdingVendorPrintRows(source),
        );
        const withholdingTotal = source.reduce((sum, d) => sum + (Number(d.withholdingTaxAmount) || 0), 0);
        const paidTotal = source.reduce((sum, d) => sum + vendorWhtPaidAmount(d), 0);
        const generatedAt = new Date().toLocaleString('th-TH', {
          dateStyle: 'medium',
          timeStyle: 'short',
        });
        const filterLines = scope === 'filtered' ? describeWithholdingVendorPrintFilters(q, yearFilterCe, monthScope) : [];
        const scopeTitle =
          scope === 'filtered' ? 'พิมพ์ตามตัวกรองปัจจุบัน' : 'พิมพ์ทั้งหมด (ในชุดข้อมูลล่าสุด)';

        const body = buildWithholdingVendorListPrintHtml({
          rows: printRows,
          scopeTitle,
          filterLines,
          totalWithholdingLabel: fmtBaht(withholdingTotal),
          totalPaidLabel: fmtBaht(paidTotal),
          generatedAt,
          printedBy: currentUser?.displayName,
          truncated,
        });

        const ok = await openStandardPrintWindow({
          windowTitle: 'Withholding-Vendor-List',
          suggestedFileName: `Withholding-Vendor-List-${scope === 'filtered' ? 'Filtered' : 'All'}`,
          bodyInnerHtml: body,
          htmlLang: 'th',
        });

        if (!ok) {
          toast({
            variant: 'destructive',
            title: 'เปิดหน้าต่างพิมพ์ไม่ได้',
            description: 'กรุณาอนุญาตป๊อปอัปสำหรับเว็บไซต์นี้',
          });
          return;
        }
        setPrintDialogOpen(false);
      } finally {
        setPrintBusy(false);
      }
    },
    [filtered, vendorDocs, q, yearFilterCe, monthScope, currentUser?.displayName, toast],
  );

  const openPayTaxDialog = useCallback(() => {
    if (payableRows.length === 0) {
      toast({
        variant: 'destructive',
        title: 'ไม่มีรายการที่พร้อมจ่ายภาษี',
        description: 'ต้องจ่ายคู่ค้าและออกหนังสือรับรองแล้ว และยังไม่ได้นำส่งภาษีหัก ณ ที่จ่าย',
      });
      return;
    }
    setSelectedKeys((prev) => {
      const payableIds = new Set(payableRows.map((d) => vendorDocKey(d.id)));
      const kept = [...prev].filter((id) => payableIds.has(id));
      return kept.length > 0 ? new Set(kept) : new Set(payableIds);
    });
    setPayTaxOpen(true);
    setPayTaxBankId((prev) =>
      prev && operatingBankOptions.some((b) => b.id === prev) ? prev : (operatingBankOptions[0]?.id ?? ''),
    );
    setPayTaxDate(new Date().toISOString().slice(0, 10));
    setPayTaxAttachments([...sessionProofAttachments]);
  }, [payableRows, operatingBankOptions, sessionProofAttachments, toast]);

  const handleAttachPayTaxProof = useCallback(
    async (files: FileList | null) => {
      if (!files?.length || !firebaseApp || !currentUser) return;
      setAttachProofBusy(true);
      try {
        const uploaded: WhtTaxPaymentProofAttachment[] = [];
        for (const file of Array.from(files)) {
          const attachment = await uploadPayrollWhtTaxPaymentProof(
            firebaseApp,
            'vendor',
            currentUser.id,
            file,
            currentUser.displayName || currentUser.email || currentUser.id,
          );
          uploaded.push(attachment);
        }
        setPayTaxAttachments((prev) => {
          const next = [...prev];
          for (const a of uploaded) {
            if (!next.some((x) => x.id === a.id)) next.push(a);
          }
          setSessionProofAttachments(next);
          return next;
        });
        toast({
          title: 'แนบเอกสารแล้ว',
          description: uploaded.length > 1 ? `อัปโหลด ${uploaded.length} ไฟล์` : uploaded[0]?.fileName,
        });
      } catch (e) {
        toast({
          variant: 'destructive',
          title: 'แนบเอกสารไม่สำเร็จ',
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setAttachProofBusy(false);
        if (payTaxProofInputRef.current) payTaxProofInputRef.current.value = '';
      }
    },
    [firebaseApp, currentUser, toast],
  );

  const handleRemovePayTaxProof = useCallback((attachmentId: string) => {
    setPayTaxAttachments((prev) => {
      const next = prev.filter((a) => a.id !== attachmentId);
      setSessionProofAttachments(next);
      return next;
    });
  }, []);

  const handleRemoveSectionProof = useCallback((attachmentId: string) => {
    setSessionProofAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
    setPayTaxAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
  }, []);

  const handleConfirmPayWhtTax = useCallback(async () => {
    if (!firestore || !currentUser) return;
    if (!payTaxBankId.trim()) {
      toast({ variant: 'destructive', title: 'กรุณาเลือกบัญชีธนาคาร' });
      return;
    }
    if (selectedPayRows.length === 0) {
      toast({
        variant: 'destructive',
        title: 'ยังไม่ได้เลือกรายการ',
        description: 'ติ๊กเลือกรายการที่ต้องการจ่ายภาษีอย่างน้อย 1 รายการ',
      });
      return;
    }
    if (payTaxAttachments.length === 0) {
      toast({
        variant: 'destructive',
        title: 'ยังไม่ได้แนบเอกสาร',
        description: 'กรุณาแนบหลักฐานการโอนก่อนยืนยันจ่ายภาษี',
      });
      return;
    }

    setPayTaxBusy(true);
    let success = 0;
    const errors: string[] = [];
    const paidKeys = new Set<string>();
    const docUpdates = new Map<string, Partial<WithholdingCertificateDocument>>();

    try {
      for (const docRow of selectedPayRows) {
        try {
          const tax = Number(docRow.withholdingTaxAmount) || 0;
          const result = await recordVendorWhtTaxPayment(firestore, currentUser as User, {
            doc: docRow,
            taxAmount: tax,
            bankAccountId: payTaxBankId,
            entryDate: payTaxDate,
            proofAttachments: payTaxAttachments,
          });
          const key = vendorDocKey(docRow.id);
          paidKeys.add(key);
          const now = Date.now();
          docUpdates.set(key, {
            whtTaxCashbookEntryId: result.cashbookEntryId,
            whtTaxCashbookEntryNo: result.entryNo,
            whtTaxPaidAt: now,
            whtTaxPaymentBankAccountId: payTaxBankId,
            whtTaxPaymentProofAttachments: mergeUniqueProofAttachments(
              docRow.whtTaxPaymentProofAttachments ?? [],
              payTaxAttachments,
            ),
          });
          success += 1;
        } catch (e) {
          const name = docRow.payee?.displayName || docRow.certificateNo || docRow.id;
          errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      if (paidKeys.size > 0) {
        setVendorDocs((prev) =>
          prev.map((d) => {
            const patch = docUpdates.get(vendorDocKey(d.id));
            if (!patch) return d;
            return { ...d, ...patch };
          }),
        );
        setSelectedKeys((prev) => {
          const next = new Set(prev);
          for (const key of paidKeys) next.delete(key);
          return next;
        });
      }

      if (errors.length === 0) {
        toast({
          title: 'บันทึกจ่ายภาษีหัก ณ ที่จ่ายแล้ว',
          description: `จ่ายสำเร็จ ${success} รายการ · ตัดบัญชีและบันทึก cashbook เรียบร้อย`,
        });
        setSessionProofAttachments([]);
        setPayTaxAttachments([]);
        setPayTaxOpen(false);
      } else if (success > 0) {
        toast({
          variant: 'destructive',
          title: `จ่ายสำเร็จ ${success} รายการ · ล้มเหลว ${errors.length} รายการ`,
          description: errors.slice(0, 3).join(' · '),
        });
      } else {
        toast({
          variant: 'destructive',
          title: 'จ่ายภาษีไม่สำเร็จ',
          description: errors.slice(0, 3).join(' · '),
        });
      }
    } finally {
      setPayTaxBusy(false);
    }
  }, [firestore, currentUser, payTaxBankId, payTaxDate, selectedPayRows, payTaxAttachments, toast]);

  if (isLoading || !currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  const user = currentUser as User;
  if (!canSeeAccountingPillarUi(user, profile)) {
    return (
      <AppShell user={user} onLogout={() => {}}>
        <div className="max-w-3xl mx-auto py-16 text-center text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงเมนูบัญชี</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={user} onLogout={() => {}}>
      <div className="w-full max-w-[min(100%,96rem)] mx-auto space-y-6 py-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Building2 className="h-7 w-7 text-muted-foreground" />
            2. เอกสาร หัก ณ ที่จ่าย (คู่ค้า)
          </h1>
          <p className="text-muted-foreground mt-1">
            รายการหนังสือรับรองหัก ณ ที่จ่าย (ภงด.53 ฯลฯ) ที่สร้างจากการบันทึกจ่ายใบรับวางบิลคู่ค้า — เปิดรายละเอียดเพื่อพิมพ์ / XML
          </p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">ค้นหาและกรองเดือน</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <div className="relative min-w-0 flex-1 basis-full sm:basis-auto sm:min-w-[14rem] sm:max-w-md">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-10 pl-9"
                    placeholder="พิมพ์คำค้น..."
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    aria-label="ค้นหาเอกสารหัก ณ ที่จ่ายคู่ค้า"
                  />
                </div>
                <YearMonthScopeSelects
                  idPrefix="vendor-wht"
                  yearCe={yearFilterCe}
                  monthScope={monthScope}
                  yearOptionsCe={yearOptionsCe}
                  onYearCeChange={setYearFilterCe}
                  onMonthScopeChange={setMonthScope}
                />
              </div>
              <div className="flex flex-wrap items-end gap-2 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 shrink-0 gap-2 whitespace-nowrap"
                  onClick={() => setPrintDialogOpen(true)}
                >
                  <Printer className="h-4 w-4 shrink-0" />
                  พิมพ์รายการ
                </Button>
                {!loadingDocs && !error ? (
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <p className="text-xs font-medium text-muted-foreground whitespace-nowrap">ยอดหักรวม (ในตาราง)</p>
                    <div className="flex h-10 min-w-[11rem] items-center justify-end rounded-md border border-primary/30 bg-primary/5 px-4">
                      <p className="text-lg font-bold tabular-nums tracking-tight text-primary">{fmtBaht(totalWithholding)}</p>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>

        <Dialog open={printDialogOpen} onOpenChange={setPrintDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>พิมพ์รายการหัก ณ ที่จ่าย (คู่ค้า)</DialogTitle>
              <DialogDescription>สูงสุด 500 รายการต่อครั้ง</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="rounded-md border bg-muted/30 p-3 space-y-1">
                <p className="font-semibold text-xs uppercase text-muted-foreground">ตัวกรองปัจจุบัน</p>
                <ul className="list-disc list-inside text-xs text-muted-foreground">
                  {describeWithholdingVendorPrintFilters(q, yearFilterCe, monthScope).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <p className="text-xs font-medium pt-1">จะพิมพ์ {filtered.length} รายการ</p>
              </div>
              <p className="text-xs text-muted-foreground">
                ข้อมูลทั้งหมด: {vendorDocs.length} รายการ · หักรวม {fmtBaht(allTotalWithholding)} · จ่ายรวม{' '}
                {fmtBaht(allTotalPaid)}
              </p>
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                disabled={printBusy || filtered.length === 0}
                onClick={() => void runWithholdingVendorListPrint('filtered')}
              >
                <Printer className="h-4 w-4 mr-2" />
                พิมพ์ตามตัวกรอง ({filtered.length})
              </Button>
              <Button
                type="button"
                className="w-full sm:w-auto"
                disabled={printBusy || vendorDocs.length === 0}
                onClick={() => void runWithholdingVendorListPrint('all')}
              >
                <Printer className="h-4 w-4 mr-2" />
                พิมพ์ทั้งหมด ({vendorDocs.length})
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <CardTitle className="text-base">รายการหัก ณ ที่จ่ายจากคู่ค้า</CardTitle>
              {!loadingDocs && !error ? (
                <div className="flex flex-wrap items-stretch gap-2 shrink-0">
                  {canPayWhtTax && payableRows.length > 0 ? (
                    <Button
                      type="button"
                      className="h-auto bg-emerald-600 hover:bg-emerald-700 text-white gap-2 px-4"
                      onClick={openPayTaxDialog}
                    >
                      <Banknote className="h-4 w-4 shrink-0" />
                      จ่ายภาษี ({selectedPayRows.length})
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            <ProofAttachmentZone
              attachments={displayedProofAttachments}
              onRemove={canPayWhtTax ? handleRemoveSectionProof : undefined}
              removableIds={canPayWhtTax ? removableProofIds : undefined}
              label="เอกสารแนบการโอน (ภงด.53)"
            />
            {error ? (
              <p className="text-sm text-destructive">โหลดข้อมูลไม่สำเร็จ — {String((error as Error)?.message || error)}</p>
            ) : loadingDocs ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {vendorDocs.length === 0
                  ? 'ยังไม่มีเอกสารหัก ณ ที่จ่ายจากคู่ค้า (จะถูกสร้างเมื่อบันทึกจ่ายใบวางบิลที่มีหัก ณ ที่จ่าย)'
                  : 'ไม่พบรายการที่ตรงกับคำค้นหรือเดือนที่เลือก'}
              </p>
            ) : (
              <div className="rounded-md border">
                <Table className="table-fixed w-full">
                  {VENDOR_WHT_LIST_TABLE_COLGROUP(canPayWhtTax)}
                  <TableHeader>
                    <TableRow>
                      {canPayWhtTax ? (
                        <TableHead className="w-11 pl-3">
                          <Checkbox
                            checked={
                              payableRows.length > 0 &&
                              payableRows.every((d) => selectedKeys.has(vendorDocKey(d.id)))
                            }
                            onCheckedChange={(v) => {
                              if (v === true) {
                                setSelectedKeys(new Set(payableRows.map((d) => vendorDocKey(d.id))));
                              } else {
                                setSelectedKeys(new Set());
                              }
                            }}
                            aria-label="เลือกทั้งหมดที่พร้อมจ่ายภาษี"
                          />
                        </TableHead>
                      ) : null}
                      <TableHead>เลขที่หนังสือ</TableHead>
                      <TableHead>คู่ค้า</TableHead>
                      <TableHead className="whitespace-nowrap">วันที่จ่าย</TableHead>
                      <TableHead className={cn(VENDOR_WHT_EQUAL_COL_HEAD, 'text-right')}>ยอดจ่าย</TableHead>
                      <TableHead className={cn(VENDOR_WHT_EQUAL_COL_HEAD, 'text-center')}>สถานะจ่ายคู่ค้า</TableHead>
                      <TableHead className={cn(VENDOR_WHT_EQUAL_COL_HEAD, 'text-right')}>ยอดหัก</TableHead>
                      <TableHead className={cn(VENDOR_WHT_EQUAL_COL_HEAD, 'text-center')}>สถานะจ่ายภาษี</TableHead>
                      <TableHead className={cn(VENDOR_WHT_EQUAL_COL_HEAD, 'text-center')}>ใบวางบิล / PO</TableHead>
                      <TableHead className={cn(VENDOR_WHT_EQUAL_COL_HEAD, 'text-center')}> </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((d) => {
                      const sourcePaid = isVendorWhtSourcePaid(d);
                      const taxPaid = isVendorWhtTaxRemitted(d);
                      const paymentLabel = vendorPaymentStatusLabel(d);
                      const rowKey = vendorDocKey(d.id);
                      const payable = isVendorWhtRowPayable(d);
                      return (
                        <TableRow key={rowKey}>
                          {canPayWhtTax ? (
                            <TableCell className="w-11 pl-3 align-middle">
                              {taxPaid ? (
                                <span className="text-muted-foreground text-xs" title="จ่ายภาษีแล้ว">
                                  ✓
                                </span>
                              ) : payable ? (
                                <Checkbox
                                  checked={selectedKeys.has(rowKey)}
                                  onCheckedChange={(v) => {
                                    const on = v === true;
                                    setSelectedKeys((prev) => {
                                      const next = new Set(prev);
                                      if (on) next.add(rowKey);
                                      else next.delete(rowKey);
                                      return next;
                                    });
                                  }}
                                  aria-label={`เลือก ${d.payee?.displayName || d.certificateNo || d.id}`}
                                />
                              ) : (
                                <span className="text-muted-foreground text-xs">—</span>
                              )}
                            </TableCell>
                          ) : null}
                          <TableCell className="font-mono text-xs truncate" title={d.certificateNo?.trim() || '—'}>
                            {d.certificateNo?.trim() || '—'}
                          </TableCell>
                          <TableCell className="max-w-0">
                            <div className="truncate font-medium" title={d.payee?.displayName?.trim() || '—'}>
                              {d.payee?.displayName?.trim() || '—'}
                            </div>
                            {d.payee?.taxId ? (
                              <div className="truncate text-xs text-muted-foreground font-mono">{d.payee.taxId}</div>
                            ) : null}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{formatYmdLocalThaiBE(d.paymentDate)}</TableCell>
                          <TableCell className={cn(VENDOR_WHT_EQUAL_COL_CELL, 'text-right tabular-nums text-sm')}>
                            {fmtBaht(vendorWhtPaidAmount(d))}
                          </TableCell>
                          <TableCell className={cn(VENDOR_WHT_EQUAL_COL_CELL, 'text-center')}>
                            {renderWageStatusBadge(paymentLabel, sourcePaid)}
                          </TableCell>
                          <TableCell
                            className={cn(VENDOR_WHT_EQUAL_COL_CELL, 'text-right tabular-nums text-sm font-semibold text-primary')}
                          >
                            {fmtBaht(Number(d.withholdingTaxAmount) || 0)}
                          </TableCell>
                          <TableCell className={cn(VENDOR_WHT_EQUAL_COL_CELL, 'text-center')}>
                            {renderTaxStatusBadge(sourcePaid, taxPaid)}
                          </TableCell>
                          <TableCell className={cn(VENDOR_WHT_EQUAL_COL_CELL, 'text-xs')}>
                            <div className="font-mono truncate" title={d.referenceVendorBillNo || '—'}>
                              {d.referenceVendorBillNo || '—'}
                            </div>
                            {d.referencePurchaseNo ? (
                              <div className="truncate text-muted-foreground">PO {d.referencePurchaseNo}</div>
                            ) : null}
                          </TableCell>
                          <TableCell className={cn(VENDOR_WHT_EQUAL_COL_CELL, 'text-center')}>
                            <Link
                              href={`/accounting/wht-certificates/${d.id}`}
                              className="inline-flex items-center justify-center gap-1 text-sm text-primary hover:underline"
                            >
                              เปิด
                              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                            </Link>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={payTaxOpen} onOpenChange={(open) => !open && !payTaxBusy && setPayTaxOpen(false)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>จ่ายภาษีหัก ณ ที่จ่าย (ภงด.53) — คู่ค้า</DialogTitle>
              <DialogDescription>
                เลือกบัญชีธนาคารสำหรับตัดจ่ายภาษี — ระบบจะบันทึกรายการ cashbook แยกตามรายการที่เลือก
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              <div className="rounded-md border bg-muted/30 p-3 space-y-1">
                <p className="font-medium">รายการที่เลือก {selectedPayRows.length} รายการ</p>
                <p className="text-muted-foreground">
                  ยอดภาษีหัก ณ ที่จ่ายรวม{' '}
                  <span className="font-semibold text-primary tabular-nums">{fmtBaht(selectedTaxTotal)}</span>
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="wht-vendor-pay-bank">บัญชีธนาคารที่ตัดจ่าย</Label>
                <Select value={payTaxBankId} onValueChange={setPayTaxBankId}>
                  <SelectTrigger id="wht-vendor-pay-bank">
                    <SelectValue placeholder="เลือกบัญชี ACTIVE" />
                  </SelectTrigger>
                  <SelectContent>
                    {operatingBankOptions.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.bankName} · {b.accountName} [{b.accountCode}]
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="wht-vendor-pay-date">วันที่ตัดบัญชี</Label>
                <Input
                  id="wht-vendor-pay-date"
                  type="date"
                  value={payTaxDate}
                  onChange={(e) => setPayTaxDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>เอกสารการโอน (บังคับแนบ)</Label>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  แนบสลิปหรือหลักฐานการโอนภาษีหัก ณ ที่จ่าย — รองรับ PDF หรือรูปภาพ (สูงสุด 10 MB ต่อไฟล์)
                </p>
                <input
                  ref={payTaxProofInputRef}
                  type="file"
                  multiple
                  accept="application/pdf,image/jpeg,image/jpg,image/png,image/webp,image/gif,.pdf,.jpg,.jpeg,.png,.webp,.gif"
                  className="hidden"
                  onChange={(e) => void handleAttachPayTaxProof(e.target.files)}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  disabled={attachProofBusy || payTaxBusy}
                  onClick={() => payTaxProofInputRef.current?.click()}
                >
                  {attachProofBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Paperclip className="h-4 w-4" />
                  )}
                  แนบเอกสาร
                </Button>
                {payTaxAttachments.length > 0 ? (
                  <ul className="rounded-md border bg-muted/20 px-3 py-2 space-y-1.5">
                    {payTaxAttachments.map((a) => (
                      <li key={a.id} className="flex items-center gap-2 min-w-0 text-xs">
                        <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate" title={a.fileName}>
                          {a.fileName}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 shrink-0 px-2"
                          disabled={attachProofBusy || payTaxBusy}
                          onClick={() => handleRemovePayTaxProof(a.id)}
                        >
                          ลบ
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-amber-800 dark:text-amber-200/90">
                    ยังไม่มีเอกสารแนบ — ต้องแนบก่อนจึงจะกดยืนยันจ่ายได้
                  </p>
                )}
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" disabled={payTaxBusy} onClick={() => setPayTaxOpen(false)}>
                ยกเลิก
              </Button>
              <Button
                type="button"
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={
                  payTaxBusy ||
                  attachProofBusy ||
                  !payTaxBankId ||
                  selectedPayRows.length === 0 ||
                  payTaxAttachments.length === 0
                }
                onClick={() => void handleConfirmPayWhtTax()}
              >
                {payTaxBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                ยืนยันจ่ายภาษี ({selectedPayRows.length})
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
