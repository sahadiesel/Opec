'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { collection, query, where } from 'firebase/firestore';
import { doc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useFirestore, useCollection, useDoc, useMemoFirebase } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';
import { FileBarChart, Info, Loader2, ExternalLink, ChevronDown, ArrowLeft } from 'lucide-react';
import { formatDateRangeThaiBE, timestampToHtmlDateValue } from '@/lib/date-thai';
import type { Customer, PurchaseOrder } from '@/lib/types';
import {
  generateBillableSummaryForClientAndPeriod,
  sumClientBillableSummary,
  type PerPoBillableSummary,
} from '@/lib/services/client-billing-summary';
import { useToast } from '@/hooks/use-toast';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

export function defaultBillingClientPeriodMs(): { start: number; end: number } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 12, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 12, 0, 0, 0);
  return { start: start.getTime(), end: end.getTime() };
}

function formatMoney(n: number): string {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export type BillingClientScopeContentProps = {
  /** ว่าง = ยังไม่เลือกลูกค้า (หน้า /billing-client) */
  customerId: string;
  /** กำหนดย่อหน้า — ถ้าไม่ส่งใช้ชื่อจาก customers/{id} */
  customerNameOverride?: string;
  /** ปุ่มกลับ (เช่น หน้าใต้ลูกค้า) */
  backButton?: { href: string; 'aria-label'?: string };
};

/**
 * สรุปฐานวางบิลตามลูกค้า + งวด — รวมทุก wave ต่อ PO (ดู client-billing-summary)
 */
export function BillingClientScopeContent({
  customerId,
  customerNameOverride,
  backButton,
}: BillingClientScopeContentProps) {
  const { currentUser } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const canViewPage = useMemo(() => canView(currentUser, 'customers'), [currentUser]);

  const [periodStartMs, setPeriodStartMs] = useState(() => defaultBillingClientPeriodMs().start);
  const [periodEndMs, setPeriodEndMs] = useState(() => defaultBillingClientPeriodMs().end);
  const [rows, setRows] = useState<PerPoBillableSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [openWarnings, setOpenWarnings] = useState<Record<string, boolean>>({});

  const custRef = useMemoFirebase(
    () => (firestore && canViewPage && customerId ? doc(firestore, 'customers', customerId) : null),
    [firestore, customerId, canViewPage],
  );
  const { data: customerFromDb } = useDoc<Customer>(custRef as any);
  const displayName = (customerNameOverride ?? customerFromDb?.name ?? '').trim() || '—';

  const posQuery = useMemoFirebase(
    () =>
      firestore && canViewPage && customerId
        ? query(collection(firestore, 'purchase_orders'), where('customerId', '==', customerId))
        : null,
    [firestore, canViewPage, customerId],
  );
  const { data: customerPos } = useCollection<PurchaseOrder>(posQuery as any);

  const poById = useMemo(() => {
    const m = new Map<string, PurchaseOrder>();
    for (const p of customerPos ?? []) m.set(p.id, p);
    return m;
  }, [customerPos]);

  useEffect(() => {
    setRows(null);
    setOpenWarnings({});
  }, [customerId]);

  const runSummary = useCallback(async () => {
    if (!firestore || !canViewPage || !customerId) return;
    const start = timestampToHtmlDateValue(periodStartMs);
    const end = timestampToHtmlDateValue(periodEndMs);
    if (!start || !end || start > end) {
      toast({ variant: 'destructive', title: 'ช่วงวันที่ไม่ถูกต้อง', description: 'ระบุตั้งแต่วันที่ / ถึงวันที่ ให้ครบและให้งวดสิ้นสุดหลังต้น' });
      return;
    }
    setLoading(true);
    setOpenWarnings({});
    try {
      const r = await generateBillableSummaryForClientAndPeriod(firestore, customerId, start, end);
      setRows(r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'โหลดสรุปไม่สำเร็จ';
      toast({ variant: 'destructive', title: 'สรุปฐานวางบิล', description: msg });
      setRows(null);
    } finally {
      setLoading(false);
    }
  }, [firestore, canViewPage, customerId, periodStartMs, periodEndMs, toast]);

  const totals = useMemo(() => (rows && rows.length > 0 ? sumClientBillableSummary(rows) : null), [rows]);
  const periodLabel = useMemo(
    () => formatDateRangeThaiBE(periodStartMs, periodEndMs, '—'),
    [periodStartMs, periodEndMs],
  );

  if (!currentUser) {
    return null;
  }

  if (!canViewPage) {
    return <div className="max-w-3xl mx-auto py-10 text-center text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงรายงานนี้</div>;
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          {backButton ? (
            <Button variant="ghost" size="icon" asChild>
              <Link href={backButton.href} aria-label={backButton['aria-label'] ?? 'กลับ'}>
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
          ) : null}
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-primary flex items-center gap-2">
              <FileBarChart className="h-7 w-7 shrink-0" />
              สรุปฐานวางบิล (Client scope)
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {customerId ? (
                <>
                  <span className="font-medium text-foreground">{displayName}</span>
                  {' — '}
                </>
              ) : null}
              รวม timesheet ที่ <code className="text-xs">readyForBilling</code> ของทุก Wave ใต้ PO ลูกค้า
              ในช่วงวันที่ที่เลือก
            </p>
          </div>
        </div>
        <Button variant="outline" asChild>
          <Link href="/draft-invoices" className="gap-1">
            รายการใบแจ้งหนี้ <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>หน้าจอสรุปเชิงวิเคราะห์</AlertTitle>
        <AlertDescription>
          นี่คือฐานคำนวณรายรับจาก timesheet ต่อ PO (รวมทุก wave) ตาม logic เดียวกับการสร้างรายงานใบวางบิล — ยังไม่บันทึกเป็น
          ใบแจ้งหนี้ ใช้เพื่อตรวจสอบก่อนออกเอกสารในเมนูบัญชี/ใบแจ้งหนี้
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">ช่วงเวลา</CardTitle>
          <CardDescription>
            {customerId
              ? 'เลือกงวดแล้วกด "สรุปยอด" ระบบจะ query ราย PO ของลูกค้าและรวม timesheet ทุก wave'
              : 'เลือกลูกค้าและงวด แล้วกด "สรุปยอด"'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="space-y-2 min-w-[200px]">
            <Label>ตั้งแต่วันที่</Label>
            <DatePickerThaiBE value={periodStartMs} onChange={setPeriodStartMs} />
          </div>
          <div className="space-y-2 min-w-[200px]">
            <Label>ถึงวันที่</Label>
            <DatePickerThaiBE value={periodEndMs} onChange={setPeriodEndMs} />
          </div>
          <Button
            className="gap-2 sm:mb-0.5"
            onClick={() => void runSummary()}
            disabled={loading || !firestore || !customerId}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileBarChart className="h-4 w-4" />}
            สรุปยอด
          </Button>
        </CardContent>
      </Card>

      {customerId && rows !== null && !loading && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ยอดรวมลูกค้า</CardTitle>
            <CardDescription>งวด {periodLabel}</CardDescription>
          </CardHeader>
          <CardContent>
            {totals ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground">ยอดรวมก่อน VAT (฿)</div>
                  <div className="text-2xl font-bold tabular-nums text-primary">{formatMoney(totals.totalAmount)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">รายวัน (timesheet)</div>
                  <div className="text-2xl font-semibold tabular-nums">{totals.timesheetCount.toLocaleString('th-TH')}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">บรรทัดสรุป</div>
                  <div className="text-2xl font-semibold tabular-nums">{totals.lineCount.toLocaleString('th-TH')}</div>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      {customerId && rows !== null && !loading && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">แยกตาม PO</CardTitle>
            <CardDescription>PO ใดไม่มียอด timesheet ที่รวมในงวด จะไม่แสดงในรายการ</CardDescription>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">ไม่พบยอด — ลองปรับช่วงวันที่หรือตรวจ timesheet ว่า ready สำหรับวางบิล</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>PO</TableHead>
                      <TableHead>โครงการ / ชื่อ PO</TableHead>
                      <TableHead className="text-right">ยอด (฿)</TableHead>
                      <TableHead className="text-right">Timesheet</TableHead>
                      <TableHead className="text-right">บรรทัด</TableHead>
                      <TableHead className="w-[1%] text-center">รายละเอียด</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map(({ poId, result }) => {
                      const po = poById.get(poId);
                      const wCount = (result.warnings || []).length;
                      const wKey = poId;
                      return (
                        <TableRow key={poId}>
                          <TableCell className="font-mono text-sm">
                            <Link href={`/purchase-orders/${poId}`} className="text-primary hover:underline inline-flex items-center gap-1">
                              {po?.poCode || poId.slice(0, 8)}
                              <ExternalLink className="h-3 w-3" />
                            </Link>
                          </TableCell>
                          <TableCell className="text-sm max-w-[280px]">
                            <div className="truncate" title={po?.projectName || po?.title}>
                              {po?.projectName || po?.title || '—'}
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{formatMoney(result.totalAmount)}</TableCell>
                          <TableCell className="text-right tabular-nums">{result.timesheetCount.toLocaleString('th-TH')}</TableCell>
                          <TableCell className="text-right tabular-nums">{result.lines.length.toLocaleString('th-TH')}</TableCell>
                          <TableCell className="text-center">
                            {wCount > 0 ? (
                              <Collapsible
                                open={openWarnings[wKey] ?? false}
                                onOpenChange={(o) => setOpenWarnings((s) => ({ ...s, [wKey]: o }))}
                              >
                                <CollapsibleTrigger asChild>
                                  <Button variant="ghost" size="sm" className="h-7 gap-1 text-amber-700">
                                    คำเตือน {wCount}
                                    <ChevronDown
                                      className={cn('h-3.5 w-3.5 transition', (openWarnings[wKey] ?? false) && 'rotate-180')}
                                    />
                                  </Button>
                                </CollapsibleTrigger>
                                <CollapsibleContent>
                                  <ul className="mt-2 text-left text-xs text-muted-foreground list-disc pl-4 max-w-md space-y-1">
                                    {result.warnings.map((w, i) => (
                                      <li key={i}>{w}</li>
                                    ))}
                                  </ul>
                                </CollapsibleContent>
                              </Collapsible>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
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
      )}

      {customerId && !loading && rows === null && (
        <p className="text-sm text-muted-foreground text-center py-2">กด &quot;สรุปยอด&quot; เพื่อดึงยอดจากฐานข้อมูล</p>
      )}

      {!customerId && (
        <p className="text-sm text-muted-foreground text-center border rounded-md py-8">เลือกลูกค้าจากรายการด้านบน แล้วเลือกงวด</p>
      )}
    </div>
  );
}
