'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { collection, query, orderBy, doc, updateDoc } from 'firebase/firestore';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Search,
  Printer,
  Loader2,
  Trash2,
  ExternalLink,
  Paperclip,
  UploadCloud,
  FileText,
  Building2,
  DollarSign,
  Percent,
} from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase, useFirebaseApp } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { useToast } from '@/hooks/use-toast';
import { canView, canSeeAccountingPillarUi } from '@/lib/permissions';
import { formatStoredDateThaiBE } from '@/lib/date-thai';
import type { User, TaxInvoice, Customer, TaxInvoiceTimesheetAttachment } from '@/lib/types';
import {
  validateTaxInvoiceWhtFile,
  uploadTaxInvoiceWhtFile,
  deleteTaxInvoiceWhtFile,
} from '@/lib/storage/tax-invoice-wht-attachments';
import {
  buildWithholdingOpecListPrintHtml,
  capWithholdingOpecListPrintRows,
} from '@/lib/documents/withholding-opec-list-print';
import { openStandardPrintWindow } from '@/lib/documents/standard-document-print';

const TH_MONTHS = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
] as const;

function ymLabelTh(ym: string): string {
  const [y, m] = ym.split('-');
  const mi = Number(m);
  if (!y || !Number.isFinite(mi) || mi < 1 || mi > 12) return ym;
  return `${TH_MONTHS[mi - 1]} ${Number(y) + 543}`;
}

function formatMoney(amount: number, currency = 'THB'): string {
  return `${currency} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

export default function WithholdingOpecPage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const firebaseApp = useFirebaseApp();
  const { toast } = useToast();

  const [searchTerm, setSearchTerm] = useState('');
  const [monthFilter, setMonthFilter] = useState('ALL');
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [printBusy, setPrintBusy] = useState(false);

  const isAuthorized = useMemo(() => {
    if (!currentUser) return false;
    return canSeeAccountingPillarUi(currentUser) || canView(currentUser, 'withholding_tax_items');
  }, [currentUser]);

  // Query tax invoices
  const invoicesQuery = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return query(collection(firestore, 'tax_invoices'), orderBy('issueDate', 'desc'));
  }, [firestore, isAuthorized]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: invoices, isLoading: invoicesLoading } = useCollection<TaxInvoice>(invoicesQuery as any);

  // Query customers
  const customersQuery = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return collection(firestore, 'customers');
  }, [firestore, isAuthorized]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: customers } = useCollection<Customer>(customersQuery as any);

  const customerNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of customers ?? []) {
      if (c.id && c.name) m.set(c.id, c.name);
    }
    return m;
  }, [customers]);

  // Filter tax invoices that have WHT
  const whtInvoices = useMemo(() => {
    if (!invoices) return [];
    return invoices.filter((inv) => {
      const wht = Number(inv.withholdingTaxAmount) || 0;
      return wht > 0;
    });
  }, [invoices]);

  // Extract unique months from all WHT invoices
  const monthOptions = useMemo(() => {
    const months = new Set<string>();
    for (const inv of whtInvoices) {
      const ym = (inv.issueDate || '').slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(ym)) {
        months.add(ym);
      }
    }
    return Array.from(months).sort((a, b) => b.localeCompare(a));
  }, [whtInvoices]);

  // Filter & Search logic
  const filteredInvoices = useMemo(() => {
    const list = whtInvoices;
    const term = searchTerm.trim().toLowerCase();
    return list.filter((inv) => {
      // Month Filter
      if (monthFilter !== 'ALL') {
        const ym = (inv.issueDate || '').slice(0, 7);
        if (ym !== monthFilter) return false;
      }
      // Text Search
      if (!term) return true;
      const no = (inv.taxInvoiceNo || '').toLowerCase();
      const custName = (customerNameMap.get(inv.customerId) || '').toLowerCase();
      return no.includes(term) || custName.includes(term);
    });
  }, [whtInvoices, searchTerm, monthFilter, customerNameMap]);

  // Calculate statistics totals
  const totals = useMemo(() => {
    let count = 0;
    let taxable = 0;
    let vat = 0;
    let wht = 0;

    for (const inv of filteredInvoices) {
      count++;
      taxable += Number(inv.taxableAmount) || 0;
      vat += Number(inv.vatAmount) || 0;
      wht += Number(inv.withholdingTaxAmount) || 0;
    }

    return { count, taxable, vat, wht };
  }, [filteredInvoices]);

  // Upload attachment
  const handleUploadAttachment = async (invoice: TaxInvoice, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !firestore || !currentUser || !firebaseApp) return;

    setUploadingId(invoice.id);
    try {
      const validationError = validateTaxInvoiceWhtFile(file);
      if (validationError) {
        toast({ variant: 'destructive', title: file.name, description: validationError });
        return;
      }

      const att = await uploadTaxInvoiceWhtFile(
        firebaseApp,
        invoice.id,
        file,
        currentUser.id,
        currentUser.displayName || currentUser.email || 'User'
      );

      const next = [...(invoice.whtAttachments ?? []), att];
      const invRef = doc(firestore, 'tax_invoices', invoice.id);
      // eslint-disable-next-line react-hooks/purity
      await updateDoc(invRef, { whtAttachments: next, updatedAt: Date.now() });

      toast({ title: 'อัปโหลดสำเร็จ', description: `แนบเอกสาร ${file.name} เรียบร้อยแล้ว` });
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'อัปโหลดไม่สำเร็จ', description: String(err) });
    } finally {
      setUploadingId(null);
      e.target.value = '';
    }
  };

  // Remove attachment
  const handleRemoveAttachment = async (invoice: TaxInvoice, att: TaxInvoiceTimesheetAttachment) => {
    if (!firestore || !firebaseApp) return;

    if (!window.confirm(`ยืนยันการลบไฟล์แนบ "${att.fileName}"?`)) return;

    setRemovingId(att.id);
    try {
      try {
        await deleteTaxInvoiceWhtFile(firebaseApp, att.storagePath);
      } catch {
        /* best-effort storage delete */
      }

      const next = (invoice.whtAttachments ?? []).filter((a) => a.id !== att.id);
      const invRef = doc(firestore, 'tax_invoices', invoice.id);
      // eslint-disable-next-line react-hooks/purity
      await updateDoc(invRef, { whtAttachments: next, updatedAt: Date.now() });

      toast({ title: 'ลบไฟล์สำเร็จ' });
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'ลบไม่สำเร็จ' });
    } finally {
      setRemovingId(null);
    }
  };

  // Print Report logic
  const handlePrint = async () => {
    if (printBusy) return;
    setPrintBusy(true);
    try {
      const { rows, truncated } = capWithholdingOpecListPrintRows(
        filteredInvoices.map((inv) => ({
          issueDateLabel: formatStoredDateThaiBE(inv.issueDate),
          taxInvoiceNo: inv.taxInvoiceNo || '—',
          customerName: customerNameMap.get(inv.customerId) || '—',
          taxableLabel: formatMoney(inv.taxableAmount ?? 0, inv.currency),
          vatLabel: formatMoney(inv.vatAmount ?? 0, inv.currency),
          withholdingLabel: formatMoney(inv.withholdingTaxAmount ?? 0, inv.currency),
          hasAttachmentLabel: inv.whtAttachments?.length ? 'แนบแล้ว' : 'ยังไม่แนบ',
        }))
      );

      const generatedAt = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      const scopeTitle = monthFilter === 'ALL' ? 'ทุกงวดเดือน' : `งวดเดือน ${ymLabelTh(monthFilter)}`;
      const filterLines: string[] = [];
      if (monthFilter !== 'ALL') {
        filterLines.push(`เดือน: ${ymLabelTh(monthFilter)} (${monthFilter})`);
      }
      if (searchTerm.trim()) {
        filterLines.push(`ค้นหา: "${searchTerm.trim()}"`);
      }

      const body = buildWithholdingOpecListPrintHtml({
        rows,
        scopeTitle,
        filterLines,
        totalTaxableLabel: formatMoney(totals.taxable),
        totalVatLabel: formatMoney(totals.vat),
        totalWithholdingLabel: formatMoney(totals.wht),
        generatedAt,
        printedBy: currentUser?.displayName,
        truncated,
      });

      const ok = await openStandardPrintWindow({
        windowTitle: 'Withholding-OPEC-List',
        suggestedFileName: `Withholding-OPEC-List-${monthFilter}`,
        bodyInnerHtml: body,
        htmlLang: 'th',
      });

      if (!ok) {
        toast({
          variant: 'destructive',
          title: 'เปิดหน้าต่างพิมพ์ไม่ได้',
          description: 'กรุณาอนุญาตป๊อปอัปสำหรับเว็บไซต์นี้',
        });
      }
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'พิมพ์รายงานล้มเหลว', description: String(err) });
    } finally {
      setPrintBusy(false);
    }
  };

  if (userLoading || invoicesLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center p-12">
          <Badge variant="destructive" className="mb-4 py-1 px-3 text-sm">
            Access Denied
          </Badge>
          <h1 className="text-xl font-bold">ไม่มีสิทธิ์เข้าถึงหน้านี้</h1>
          <p className="text-muted-foreground">เฉพาะฝ่ายบัญชีที่มีสิทธิ์จัดการหัก ณ ที่จ่ายเท่านั้น</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser as User} onLogout={() => {}}>
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary flex items-center gap-2">
              <Percent className="h-6 w-6" /> หัก ณ ที่จ่าย ( OPEC )
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              รายการที่ลูกค้ามีหัก ณ ที่จ่าย OPEC (หัก ณ ที่จ่าย 3% อ้างอิงจากใบกำกับภาษีที่ออกให้ลูกค้า)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" className="gap-2" onClick={handlePrint} disabled={printBusy}>
              {printBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Printer className="h-4 w-4" />
              )}
              พิมพ์รายงาน / PDF
            </Button>
          </div>
        </div>

        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border-l-4 border-l-blue-500 shadow-sm">
            <CardHeader className="py-4">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                จำนวนรายการในเดือนที่เลือก <FileText className="h-4 w-4 text-blue-500" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totals.count} รายการ</div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-emerald-500 shadow-sm">
            <CardHeader className="py-4">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                ยอดฐานภาษีรวม (ก่อน VAT) <DollarSign className="h-4 w-4 text-emerald-500" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-600">
                {formatMoney(totals.taxable)}
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-amber-500 shadow-sm">
            <CardHeader className="py-4">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                ยอดหัก ณ ที่จ่ายรวมสะสม <Percent className="h-4 w-4 text-amber-500" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600">
                {formatMoney(totals.wht)}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="shadow-sm">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <div className="space-y-2">
                <Label htmlFor="search" className="text-xs font-semibold">
                  ค้นหาเลขที่เอกสาร / ชื่อลูกค้า
                </Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="search"
                    placeholder="ค้นหา..."
                    className="pl-9"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="month" className="text-xs font-semibold">
                  เลือกงวดเดือนที่หักภาษี
                </Label>
                <Select value={monthFilter} onValueChange={setMonthFilter}>
                  <SelectTrigger id="month">
                    <SelectValue placeholder="ทั้งหมด" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">ทุกงวดเดือน</SelectItem>
                    {monthOptions.map((ym) => (
                      <SelectItem key={ym} value={ym}>
                        {ymLabelTh(ym)} ({ym})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setSearchTerm('');
                    setMonthFilter('ALL');
                  }}
                  className="text-xs"
                >
                  ล้างตัวกรอง
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Document Table */}
        <Card className="shadow-sm overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="w-12 text-center">#</TableHead>
                    <TableHead className="w-32">วันที่ออก</TableHead>
                    <TableHead className="w-48">เลขที่ใบกำกับภาษี</TableHead>
                    <TableHead>ลูกค้า</TableHead>
                    <TableHead className="w-40 text-right">ยอดก่อน VAT</TableHead>
                    <TableHead className="w-40 text-right">หัก ณ ที่จ่าย</TableHead>
                    <TableHead className="w-64">เอกสารแนบจากลูกค้า</TableHead>
                    <TableHead className="w-36 text-center">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredInvoices.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-12 text-muted-foreground italic">
                        ไม่พบรายการหัก ณ ที่จ่ายตามเงื่อนไขที่เลือก
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredInvoices.map((inv, idx) => {
                      const attachments = inv.whtAttachments ?? [];
                      return (
                        <TableRow key={inv.id} className="hover:bg-muted/30">
                          <TableCell className="text-center font-mono text-xs">{idx + 1}</TableCell>
                          <TableCell className="text-sm">
                            {formatStoredDateThaiBE(inv.issueDate)}
                          </TableCell>
                          <TableCell className="font-mono font-bold text-primary text-sm">
                            <Link href={`/tax-invoices/${inv.id}`} className="hover:underline flex items-center gap-1">
                              {inv.taxInvoiceNo || '—'}
                              <ExternalLink className="h-3 w-3" />
                            </Link>
                          </TableCell>
                          <TableCell className="font-medium text-sm">
                            <div className="flex items-center gap-1">
                              <Building2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                              <span className="truncate max-w-[200px]" title={customerNameMap.get(inv.customerId)}>
                                {customerNameMap.get(inv.customerId) || 'N/A'}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {formatMoney(inv.taxableAmount ?? 0, inv.currency)}
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold text-amber-600 text-sm">
                            {formatMoney(inv.withholdingTaxAmount ?? 0, inv.currency)}
                          </TableCell>
                          <TableCell>
                            {attachments.length === 0 ? (
                              <span className="text-xs text-muted-foreground italic">ยังไม่มีเอกสารแนบ</span>
                            ) : (
                              <div className="space-y-1 max-w-[250px]">
                                {attachments.map((att) => (
                                  <div
                                    key={att.id}
                                    className="flex items-center justify-between gap-2 p-1 rounded border bg-card text-xs"
                                  >
                                    <div className="flex items-center gap-1 min-w-0 flex-1">
                                      <Paperclip className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                      <a
                                        href={att.downloadUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="hover:underline text-primary truncate"
                                        title={att.fileName}
                                      >
                                        {att.fileName}
                                      </a>
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-5 w-5 text-destructive rounded hover:bg-destructive/10 flex-shrink-0"
                                      onClick={() => void handleRemoveAttachment(inv, att)}
                                      disabled={removingId === att.id}
                                    >
                                      {removingId === att.id ? (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                      ) : (
                                        <Trash2 className="h-3 w-3" />
                                      )}
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            <label
                              className={`cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border bg-background hover:bg-muted transition-colors ${
                                uploadingId === inv.id ? 'opacity-50 pointer-events-none' : ''
                              }`}
                            >
                              {uploadingId === inv.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <UploadCloud className="h-3.5 w-3.5 text-primary" />
                              )}
                              <span>แนบไฟล์</span>
                              <input
                                type="file"
                                className="hidden"
                                accept="image/jpeg,image/png,image/webp,application/pdf"
                                onChange={(e) => void handleUploadAttachment(inv, e)}
                                disabled={uploadingId === inv.id}
                              />
                            </label>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
