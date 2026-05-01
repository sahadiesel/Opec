'use client';

import { Fragment, useMemo } from 'react';
import Link from 'next/link';
import { collection, collectionGroup, query, where } from 'firebase/firestore';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, ShoppingCart, ChevronRight, ClipboardList } from 'lucide-react';
import type { Assignment, Customer, MainContract, PurchaseOrder, POLine, Wave, Position } from '@/lib/types';
import {
  aggregateActiveLineTotals,
  buildPoFulfillmentByLine,
  type PoLineFulfillmentRow,
} from '@/lib/ops/po-fulfillment-read-model';
import { positionListPrimaryName, type PositionDoc } from '@/lib/position-display';

export type PoQuotaQueueRow = {
  po: PurchaseOrder;
  totals: ReturnType<typeof aggregateActiveLineTotals>;
  fulfillmentRows: PoLineFulfillmentRow[];
};

export function usePoQuotaQueueRows(enabled: boolean): {
  queueRows: PoQuotaQueueRow[];
  customers: Customer[] | undefined;
  allPositions: Position[] | undefined;
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

      rows.push({
        po,
        totals,
        fulfillmentRows: fulfillment,
      });
    }

    rows.sort((a, b) => b.totals.openSlots - a.totals.openSlots);
    return rows;
  }, [activePOs, allPOLines, allMobs, allWaves, allPositions, activeContracts, activeMainContractIdSet]);

  const loading =
    loadingPOs || loadingLines || loadingWaves || loadingMobs || loadingContracts;

  return { queueRows, customers: customers ?? undefined, allPositions: allPositions ?? undefined, loading };
}

export function PoQuotaQueueTable({
  queueRows,
  customers,
  allPositions,
  loading,
  emptyMessage,
}: {
  queueRows: PoQuotaQueueRow[];
  customers: Customer[] | undefined;
  allPositions: Position[] | null | undefined;
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
          <TableHead className="text-right pr-6 font-bold">ดำเนินการ</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {queueRows.map(({ po, totals, fulfillmentRows }) => {
          const cust = customers?.find((c) => c.id === po.customerId);
          const q = encodeURIComponent(po.id);
          const lineRows = fulfillmentRows.filter((r) => r.lineStatus === 'active');
          return (
            <Fragment key={po.id}>
              <TableRow className="align-top">
                <TableCell className="pl-6 py-4">
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="font-mono text-xs font-bold text-primary">{po.poCode}</span>
                    <span className="font-semibold text-sm leading-snug">{po.title || po.projectName}</span>
                    <p className="text-[10px] text-muted-foreground pt-0.5">
                      {lineRows.length} บรรทัด PO — รายละเอียดด้านล่าง
                    </p>
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
                <TableCell className="text-right pr-6 py-4">
                  <div className="flex flex-col items-end gap-1">
                    <Button size="sm" className="h-8 text-xs font-semibold" asChild>
                      <Link href={`/assignments?poId=${q}&openDialog=1`}>
                        มอบหมาย (Assign) <ChevronRight className="h-3 w-3 ml-0.5" />
                      </Link>
                    </Button>
                    <Button variant="outline" size="sm" className="h-8 text-xs" asChild>
                      <Link href={`/purchase-orders/${po.id}`}>
                        เปิด PO <ChevronRight className="h-3 w-3 ml-0.5" />
                      </Link>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
              <TableRow key={`${po.id}-lines`} className="border-b-2">
                <TableCell colSpan={6} className="p-0 bg-muted/15">
                  <div className="px-4 py-3 md:pl-10">
                    <Table>
                      <TableHeader className="bg-transparent">
                        <TableRow className="hover:bg-transparent border-0">
                          <TableHead className="text-[11px] h-8">ตำแหน่ง</TableHead>
                          <TableHead className="text-[11px] h-8 hidden sm:table-cell">สถานที่</TableHead>
                          <TableHead className="text-[11px] h-8 text-center">โควต้า</TableHead>
                          <TableHead className="text-[11px] h-8 text-center">มอบหมาย</TableHead>
                          <TableHead className="text-[11px] h-8 text-center">ว่าง</TableHead>
                          <TableHead className="text-[11px] h-8 text-right pr-2">ดำเนินการ</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lineRows.map((row) => {
                          const pos = allPositions?.find((p) => p.id === row.positionId);
                          const label = pos ? positionListPrimaryName(pos as PositionDoc) : row.positionId;
                          const assignHref = `/assignments?poId=${q}&poLineId=${encodeURIComponent(row.lineId)}&openDialog=1`;
                          return (
                            <TableRow key={row.lineId} className="border-muted/40">
                              <TableCell className="py-2 text-sm font-medium">{label}</TableCell>
                              <TableCell className="py-2 text-xs text-muted-foreground max-w-[140px] hidden sm:table-cell">
                                {(row.workLocation || '').trim() || '—'}
                              </TableCell>
                              <TableCell className="py-2 text-center text-sm">{row.requiredQty}</TableCell>
                              <TableCell className="py-2 text-center text-sm">{row.assignedCount}</TableCell>
                              <TableCell className="py-2 text-center">
                                {row.remainingSlots > 0 ? (
                                  <Badge variant="outline" className="text-[10px] bg-amber-50 border-amber-200">
                                    {row.remainingSlots}
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">0</span>
                                )}
                              </TableCell>
                              <TableCell className="py-2 text-right pr-2">
                                <Button variant="secondary" size="sm" className="h-7 text-[10px] px-2" asChild>
                                  <Link href={assignHref}>Assign</Link>
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </TableCell>
              </TableRow>
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function PoQuotaQueueCardShell({
  queueRows,
  customers,
  allPositions,
  loading,
  className,
}: {
  queueRows: PoQuotaQueueRow[];
  customers: Customer[] | undefined;
  allPositions: Position[] | null | undefined;
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
              Customer PO สายสัญญาที่<strong className="font-semibold text-foreground">สัญญาหลัก active</strong>
              และยังมีช่องว่าง — แสดง<strong className="font-semibold text-foreground">บรรทัด PO</strong> ต่อใบด้านล่างแต่ละแถว
              กด <strong className="font-semibold text-foreground">Assign</strong> เพื่อมอบหมายตามบรรทัด (ไม่ผ่าน Wave)
            </CardDescription>
          </div>
          <Badge variant="secondary" className="shrink-0 w-fit">
            {queueRows.length} PO
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <PoQuotaQueueTable
          queueRows={queueRows}
          customers={customers}
          allPositions={allPositions}
          loading={loading}
        />
      </CardContent>
    </Card>
  );
}
