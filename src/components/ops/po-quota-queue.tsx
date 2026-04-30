'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { collection, collectionGroup, query, where } from 'firebase/firestore';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, ShoppingCart, ChevronRight, ClipboardList, Layers } from 'lucide-react';
import type { Assignment, Customer, MainContract, PurchaseOrder, POLine, Wave, Position } from '@/lib/types';
import {
  aggregateActiveLineTotals,
  buildPoFulfillmentByLine,
  buildPositionAggregateAcrossActiveContractPos,
  type PoPositionAggregateRow,
} from '@/lib/ops/po-fulfillment-read-model';
import { positionListPrimaryName, type PositionDoc } from '@/lib/position-display';

export type PoQuotaQueueRow = {
  po: PurchaseOrder;
  totals: ReturnType<typeof aggregateActiveLineTotals>;
  topLines: { label: string; req: number; asg: number; rem: number }[];
  moreLineCount: number;
};

export function usePoQuotaQueueRows(enabled: boolean): {
  queueRows: PoQuotaQueueRow[];
  positionAggregateRows: PoPositionAggregateRow[];
  customers: Customer[] | undefined;
  loading: boolean;
} {
  const firestore = useFirestore();
  const { user: firebaseUser, isUserLoading } = useUser();

  const activePoQuery = useMemoFirebase(() => {
    if (!enabled || !firestore || isUserLoading || !firebaseUser) return null;
    return query(collection(firestore, 'purchase_orders'), where('status', '==', 'active'));
  }, [enabled, firestore, firebaseUser, isUserLoading]);

  const { data: activePOs, isLoading: loadingPOs } = useCollection<PurchaseOrder>(activePoQuery as any);

  const activeContractsQuery = useMemoFirebase(() => {
    if (!enabled || !firestore || isUserLoading || !firebaseUser) return null;
    return query(collection(firestore, 'main_contracts'), where('status', '==', 'active'));
  }, [enabled, firestore, firebaseUser, isUserLoading]);

  const { data: activeContracts, isLoading: loadingContracts } = useCollection<MainContract>(
    activeContractsQuery as any,
  );

  const poLinesQuery = useMemoFirebase(() => {
    if (!enabled || !firestore || isUserLoading || !firebaseUser) return null;
    return collectionGroup(firestore, 'po_lines');
  }, [enabled, firestore, firebaseUser, isUserLoading]);

  const { data: allPOLines, isLoading: loadingLines } = useCollection<POLine>(poLinesQuery as any);

  const wavesQuery = useMemoFirebase(() => {
    if (!enabled || !firestore || isUserLoading || !firebaseUser) return null;
    return collection(firestore, 'waves');
  }, [enabled, firestore, firebaseUser, isUserLoading]);

  const { data: allWaves, isLoading: loadingWaves } = useCollection<Wave>(wavesQuery as any);

  const mobQuery = useMemoFirebase(() => {
    if (!enabled || !firestore || isUserLoading || !firebaseUser) return null;
    return collection(firestore, 'mobilizations');
  }, [enabled, firestore, firebaseUser, isUserLoading]);

  const { data: allMobs, isLoading: loadingMobs } = useCollection<Assignment>(mobQuery as any);

  const positionsQuery = useMemoFirebase(() => {
    if (!enabled || !firestore || isUserLoading || !firebaseUser) return null;
    return collection(firestore, 'positions');
  }, [enabled, firestore, firebaseUser, isUserLoading]);

  const { data: allPositions } = useCollection<Position>(positionsQuery as any);

  const customersQuery = useMemoFirebase(() => {
    if (!enabled || !firestore || isUserLoading || !firebaseUser) return null;
    return collection(firestore, 'customers');
  }, [enabled, firestore, firebaseUser, isUserLoading]);

  const { data: customers } = useCollection<Customer>(customersQuery as any);

  const activeMainContractIdSet = useMemo(() => {
    if (activeContracts === undefined) return new Set<string>();
    return new Set((activeContracts ?? []).map((c) => c.id).filter(Boolean));
  }, [activeContracts]);

  const positionAggregateRows = useMemo((): PoPositionAggregateRow[] => {
    if (!activePOs?.length || !allPOLines || activeContracts === undefined) return [];
    if (activeMainContractIdSet.size === 0) return [];
    return buildPositionAggregateAcrossActiveContractPos(
      activePOs,
      activeMainContractIdSet,
      allPOLines,
      allMobs ?? [],
      allWaves ?? [],
      allPositions ?? null,
    );
  }, [activePOs, allPOLines, activeMainContractIdSet, allMobs, allWaves, allPositions, activeContracts]);

  const queueRows = useMemo((): PoQuotaQueueRow[] => {
    if (!activePOs?.length || !allPOLines || activeContracts === undefined) return [];
    if (activeMainContractIdSet.size === 0) return [];

    const contractPOs = activePOs.filter(
      (po) =>
        (po.poType || 'contract') === 'contract' &&
        po.contractId &&
        activeMainContractIdSet.has(po.contractId),
    );

    const rows: PoQuotaQueueRow[] = [];

    for (const po of contractPOs) {
      const lines = allPOLines.filter((l) => l.poId === po.id);
      if (!lines.length) continue;
      const fulfillment = buildPoFulfillmentByLine(lines, allMobs ?? [], allWaves ?? [], po.id);
      const totals = aggregateActiveLineTotals(fulfillment);
      if (totals.required <= 0 || totals.openSlots <= 0) continue;

      const activeRows = fulfillment.filter((r) => r.lineStatus === 'active');
      const topLines = activeRows.slice(0, 4).map((r) => {
        const pos = allPositions?.find((p) => p.id === r.positionId);
        return {
          label: pos ? positionListPrimaryName(pos as PositionDoc) : r.positionId,
          req: r.requiredQty,
          asg: r.assignedCount,
          rem: r.remainingSlots,
        };
      });

      rows.push({
        po,
        totals,
        topLines,
        moreLineCount: Math.max(0, activeRows.length - topLines.length),
      });
    }

    rows.sort((a, b) => b.totals.openSlots - a.totals.openSlots);
    return rows;
  }, [activePOs, allPOLines, allMobs, allWaves, allPositions, activeContracts, activeMainContractIdSet]);

  const loading =
    loadingPOs || loadingLines || loadingWaves || loadingMobs || loadingContracts;

  return { queueRows, positionAggregateRows, customers: customers ?? undefined, loading };
}

export function PoQuotaQueueTable({
  queueRows,
  customers,
  loading,
  emptyMessage,
}: {
  queueRows: PoQuotaQueueRow[];
  customers: Customer[] | undefined;
  loading: boolean;
  emptyMessage?: string;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground text-sm">
        <Loader2 className="h-5 w-5 animate-spin" />
        กำลังโหลดคิว PO…
      </div>
    );
  }

  if (queueRows.length === 0) {
    return (
      <div className="py-14 px-6 text-center text-muted-foreground text-sm">
        <ShoppingCart className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p>{emptyMessage ?? 'ไม่มี PO Active ที่ต้องเติมโควต้าในขณะนี้'}</p>
        <p className="text-xs mt-2">เมื่อ PO เป็น active สัญญาหลัก active และมีบรรทัดโควต้ายังไม่เต็ม จะแสดงที่นี่</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader className="bg-muted/40">
        <TableRow>
          <TableHead className="pl-6 font-bold">PO / โครงการ</TableHead>
          <TableHead className="font-bold hidden md:table-cell">ลูกค้า</TableHead>
          <TableHead className="text-center font-bold">โควต้า</TableHead>
          <TableHead className="text-center font-bold">มอบหมาย</TableHead>
          <TableHead className="text-center font-bold">ว่าง</TableHead>
          <TableHead className="text-center font-bold hidden sm:table-cell">Waves</TableHead>
          <TableHead className="text-right pr-6 font-bold">ดำเนินการ</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {queueRows.map(({ po, totals, topLines, moreLineCount }) => {
          const cust = customers?.find((c) => c.id === po.customerId);
          const q = encodeURIComponent(po.id);
          return (
            <TableRow key={po.id} className="align-top">
              <TableCell className="pl-6 py-4">
                <div className="flex flex-col gap-1 min-w-0">
                  <span className="font-mono text-xs font-bold text-primary">{po.poCode}</span>
                  <span className="font-semibold text-sm leading-snug">{po.title || po.projectName}</span>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {topLines.map((line) => (
                      <Badge
                        key={`${po.id}-${line.label}`}
                        variant="outline"
                        className="text-[10px] font-normal max-w-[200px] truncate"
                        title={`${line.label}: ต้องการ ${line.req} · มอบหมาย ${line.asg} · เหลือ ${line.rem}`}
                      >
                        {line.label}: เหลือ {line.rem}
                      </Badge>
                    ))}
                    {moreLineCount > 0 ? (
                      <Badge variant="secondary" className="text-[10px]">
                        +{moreLineCount} บรรทัด
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </TableCell>
              <TableCell className="hidden md:table-cell text-sm text-muted-foreground max-w-[180px]">
                {cust?.name ?? '—'}
              </TableCell>
              <TableCell className="text-center font-semibold">{totals.required}</TableCell>
              <TableCell className="text-center">{totals.assigned}</TableCell>
              <TableCell className="text-center">
                <Badge className="bg-amber-100 text-amber-900 border-amber-200 font-bold">{totals.openSlots}</Badge>
              </TableCell>
              <TableCell className="text-center hidden sm:table-cell">{totals.waveCount}</TableCell>
              <TableCell className="text-right pr-6 py-4">
                <div className="flex flex-col items-end gap-1">
                  <Button variant="outline" size="sm" className="h-8 text-xs" asChild>
                    <Link href={`/purchase-orders/${po.id}`}>
                      เปิด PO <ChevronRight className="h-3 w-3 ml-0.5" />
                    </Link>
                  </Button>
                  <div className="flex flex-wrap justify-end gap-1">
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px]" asChild>
                      <Link href={`/waves?poId=${q}`}>Waves</Link>
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px]" asChild>
                      <Link href={`/assignments?poId=${q}`}>Assign</Link>
                    </Button>
                  </div>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function PoQuotaQueueCardShell({
  queueRows,
  customers,
  loading,
  className,
}: {
  queueRows: PoQuotaQueueRow[];
  customers: Customer[] | undefined;
  loading: boolean;
  className?: string;
}) {
  return (
    <Card className={`border-primary/20 shadow-md overflow-hidden ${className ?? ''}`}>
      <CardHeader className="border-b bg-muted/30 pb-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-primary shrink-0" />
              คิวเติมโควต้า (PO Active)
            </CardTitle>
            <CardDescription className="text-xs max-w-3xl leading-relaxed">
              แสดงเฉพาะ Customer PO ตาม<strong className="font-semibold text-foreground">สัญญาหลักที่ active</strong>
              และยังมีช่องว่างตาม PO line — ข้อมูลอ่านอย่างเดียว (ลำดับที่ 1) ตัวเลขสอดคล้องกับการ์ดสรุปบนหน้า PO
            </CardDescription>
          </div>
          <Badge variant="secondary" className="shrink-0 w-fit">
            {queueRows.length} PO
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <PoQuotaQueueTable queueRows={queueRows} customers={customers} loading={loading} />
      </CardContent>
    </Card>
  );
}

export function PoPositionAggregateCardShell({
  positionRows,
  loading,
  className,
}: {
  positionRows: PoPositionAggregateRow[];
  loading: boolean;
  className?: string;
}) {
  return (
    <Card className={`border-emerald-700/20 shadow-md overflow-hidden ${className ?? ''}`}>
      <CardHeader className="border-b bg-emerald-50/40 dark:bg-emerald-950/20 pb-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg flex items-center gap-2">
              <Layers className="h-5 w-5 text-emerald-800 dark:text-emerald-400 shrink-0" />
              รวมโควต้าตามตำแหน่ง (PO สัญญา active ทั้งหมด) — เฟส C
            </CardTitle>
            <CardDescription className="text-xs max-w-3xl leading-relaxed">
              รวมบรรทัด <strong>active</strong> ข้าม PO ทุกฉบับที่สัญญาหลักยัง <strong>active</strong> — สอดคล้องกระบวนการคุย PO line
              รวม (เช่น ช่างเชื่อม 3+2 = 5) แยกจากคอลัมน์ Wave ราย PO ด้านบน
            </CardDescription>
          </div>
          <Badge variant="secondary" className="shrink-0 w-fit">
            {positionRows.length} ตำแหน่ง
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground text-sm">
            <Loader2 className="h-5 w-5 animate-spin" />
            กำลังรวมโควต้า…
          </div>
        ) : positionRows.length === 0 ? (
          <div className="py-12 px-6 text-center text-muted-foreground text-sm">
            ยังไม่มีบรรทัด PO ที่ active สำหรับสัญญาหลักที่ active
          </div>
        ) : (
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead className="pl-6 font-bold">ตำแหน่ง</TableHead>
                <TableHead className="text-center font-bold">โควต้ารวม</TableHead>
                <TableHead className="text-center font-bold">มอบหมาย</TableHead>
                <TableHead className="text-center font-bold pr-6">ว่าง</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {positionRows.map((r) => (
                <TableRow key={r.positionId}>
                  <TableCell className="pl-6 font-medium text-sm">{r.positionName}</TableCell>
                  <TableCell className="text-center font-semibold">{r.required}</TableCell>
                  <TableCell className="text-center">{r.assigned}</TableCell>
                  <TableCell className="text-center pr-6">
                    <Badge
                      className={
                        r.vacant > 0
                          ? 'bg-amber-100 text-amber-900 border-amber-200 font-bold'
                          : 'bg-muted text-foreground'
                      }
                    >
                      {r.vacant}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
