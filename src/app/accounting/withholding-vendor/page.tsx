'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, orderBy, query } from 'firebase/firestore';
import { AppShell } from '@/components/layout/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canSeeAccountingPillarUi } from '@/lib/permissions';
import { usePermissions } from '@/hooks/use-permissions';
import type { User, WithholdingCertificateDocument } from '@/lib/types';
import { Building2, ExternalLink, Loader2, Search, Printer } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  buildWithholdingVendorListPrintHtml,
  capWithholdingVendorListPrintRows,
  type WithholdingVendorListPrintRow,
} from '@/lib/documents/withholding-vendor-list-print';
import { openStandardPrintWindow } from '@/lib/documents/standard-document-print';

function isVendorPartnerWhtDoc(d: WithholdingCertificateDocument): boolean {
  return typeof d.sourceVendorBillId === 'string' && d.sourceVendorBillId.trim().length > 0;
}

function statusLabel(s: WithholdingCertificateDocument['documentStatus']): string {
  if (s === 'ISSUED') return 'ออกแล้ว';
  if (s === 'VERIFIED') return 'ตรวจแล้ว';
  if (s === 'CANCELLED') return 'ยกเลิก';
  if (s === 'REPLACED') return 'แทนที่';
  return 'ร่าง';
}

function fmtBaht(n: number): string {
  return `฿${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** ยอดจ่ายก่อนหัก — ใช้ gross หรือ net + ภาษีหัก */
function vendorWhtPaidAmount(d: WithholdingCertificateDocument): number {
  const gross = Number(d.grossAmount) || 0;
  if (gross > 0.005) return gross;
  const net = Number(d.netPaidAmount) || 0;
  const wht = Number(d.withholdingTaxAmount) || 0;
  return net + wht;
}

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

/** YYYY-MM จากวันที่จ่าย หรือจากวันที่สร้างเอกสาร (Bangkok) */
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

function describeWithholdingVendorPrintFilters(searchTerm: string, monthFilter: string): string[] {
  const lines: string[] = [];
  if (monthFilter !== 'ALL') {
    lines.push(`เดือน: ${ymLabelTh(monthFilter)} (${monthFilter})`);
  }
  if (searchTerm.trim()) {
    lines.push(`ค้นหา: "${searchTerm.trim()}"`);
  }
  return lines;
}

function buildWithholdingVendorPrintRows(list: WithholdingCertificateDocument[]): WithholdingVendorListPrintRow[] {
  return list.map((d) => ({
    status: statusLabel(d.documentStatus),
    certificateNo: d.certificateNo?.trim() || '—',
    vendorName: d.payee?.displayName?.trim() || '—',
    vendorTaxId: d.payee?.taxId?.trim() || '',
    paymentDate: d.paymentDate || '—',
    paidLabel: fmtBaht(vendorWhtPaidAmount(d)),
    withholdingLabel: fmtBaht(Number(d.withholdingTaxAmount) || 0),
    billRef: d.referenceVendorBillNo || '—',
    poRef: d.referencePurchaseNo?.trim() || '',
  }));
}

const VENDOR_WHT_TABLE_COLGROUP = (
  <colgroup>
    <col className="w-[8%]" />
    <col className="w-[14%]" />
    <col className="w-[22%]" />
    <col className="w-[10%]" />
    <col className="w-[11%]" />
    <col className="w-[11%]" />
    <col className="w-[16%]" />
    <col className="w-[72px]" />
  </colgroup>
);

export default function AccountingWithholdingVendorDocumentsPage() {
  const { currentUser, isLoading } = useAppUser();
  const { profile } = usePermissions(currentUser);
  const firestore = useFirestore();
  const { toast } = useToast();
  const [q, setQ] = useState('');
  /** 'ALL' | YYYY-MM */
  const [monthFilter, setMonthFilter] = useState<string>('ALL');
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);

  const whtQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'withholding_certificate_documents'), orderBy('createdAt', 'desc'));
  }, [firestore]);

  const { data: rows, isLoading: loadingDocs, error } = useCollection<WithholdingCertificateDocument>(whtQuery as any);

  const vendorDocs = useMemo(() => (rows || []).filter(isVendorPartnerWhtDoc), [rows]);

  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of vendorDocs) {
      const ym = vendorWhtDocYm(d);
      if (ym) set.add(ym);
    }
    return Array.from(set).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  }, [vendorDocs]);

  useEffect(() => {
    if (monthFilter !== 'ALL' && !monthOptions.includes(monthFilter)) {
      setMonthFilter('ALL');
    }
  }, [monthFilter, monthOptions]);

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
    if (monthFilter === 'ALL') return vendorDocsBySearch;
    return vendorDocsBySearch.filter((d) => vendorWhtDocYm(d) === monthFilter);
  }, [vendorDocsBySearch, monthFilter]);

  const totalWithholding = useMemo(
    () => filtered.reduce((sum, d) => sum + (Number(d.withholdingTaxAmount) || 0), 0),
    [filtered],
  );

  const totalPaid = useMemo(
    () => filtered.reduce((sum, d) => sum + vendorWhtPaidAmount(d), 0),
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
        const filterLines = scope === 'filtered' ? describeWithholdingVendorPrintFilters(q, monthFilter) : [];
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
    [filtered, vendorDocs, q, monthFilter, currentUser?.displayName, toast],
  );

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
      <div className="max-w-6xl mx-auto space-y-6 py-6 px-4">
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
                <Select value={monthFilter} onValueChange={setMonthFilter}>
                  <SelectTrigger
                    id="vendor-wht-month-filter"
                    className="h-10 w-[min(100%,13rem)] shrink-0 bg-background"
                    aria-label="กรองตามเดือน"
                  >
                    <SelectValue placeholder="เลือกเดือน" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">ทุกเดือน</SelectItem>
                    {monthOptions.map((ym) => (
                      <SelectItem key={ym} value={ym}>
                        {ymLabelTh(ym)} ({ym})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {!loadingDocs && !error ? (
                  <div className="rounded-md border border-primary/30 bg-primary/5 px-4 py-2 min-w-[11rem]">
                    <p className="text-[10px] font-medium text-muted-foreground whitespace-nowrap">ยอดหักรวม (ในตาราง)</p>
                    <p className="text-lg font-bold tabular-nums tracking-tight text-primary">{fmtBaht(totalWithholding)}</p>
                  </div>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 shrink-0 gap-2"
                  onClick={() => setPrintDialogOpen(true)}
                >
                  <Printer className="h-4 w-4" /> พิมพ์
                </Button>
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
                  {describeWithholdingVendorPrintFilters(q, monthFilter).length > 0 ? (
                    describeWithholdingVendorPrintFilters(q, monthFilter).map((line) => (
                      <li key={line}>{line}</li>
                    ))
                  ) : (
                    <li>ทุกเดือน — ไม่มีคำค้น</li>
                  )}
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
          <CardContent className="pt-6">
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
              <div className="rounded-md border overflow-x-auto">
                <Table className="table-fixed w-full min-w-[880px]">
                  {VENDOR_WHT_TABLE_COLGROUP}
                  <TableHeader>
                    <TableRow>
                      <TableHead>สถานะ</TableHead>
                      <TableHead>เลขที่หนังสือ</TableHead>
                      <TableHead>คู่ค้า</TableHead>
                      <TableHead>วันที่จ่าย</TableHead>
                      <TableHead className="text-right">ยอดจ่าย</TableHead>
                      <TableHead className="text-right">ยอดหัก</TableHead>
                      <TableHead>ใบวางบิล / PO</TableHead>
                      <TableHead className="text-right pr-3"> </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell>
                          <Badge variant={d.documentStatus === 'ISSUED' ? 'default' : 'secondary'}>
                            {statusLabel(d.documentStatus)}
                          </Badge>
                        </TableCell>
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
                        <TableCell className="whitespace-nowrap text-sm">{d.paymentDate || '—'}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm">{fmtBaht(vendorWhtPaidAmount(d))}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm font-semibold text-primary">
                          {fmtBaht(Number(d.withholdingTaxAmount) || 0)}
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="font-mono truncate" title={d.referenceVendorBillNo || '—'}>
                            {d.referenceVendorBillNo || '—'}
                          </div>
                          {d.referencePurchaseNo ? (
                            <div className="truncate text-muted-foreground">PO {d.referencePurchaseNo}</div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right pr-3">
                          <Link
                            href={`/accounting/wht-certificates/${d.id}`}
                            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                          >
                            เปิด
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
