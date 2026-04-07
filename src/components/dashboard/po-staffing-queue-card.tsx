'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { collection, collectionGroup, query, where } from 'firebase/firestore';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, ShoppingCart, ChevronRight, ClipboardList } from 'lucide-react';
import type { Assignment, Customer, PurchaseOrder, POLine, Wave, Position } from '@/lib/types';
import { aggregateActiveLineTotals, buildPoFulfillmentByLine } from '@/lib/ops/po-fulfillment-read-model';
import { positionListPrimaryName, type PositionDoc } from '@/lib/position-display';

export interface PoStaffingQueueCardProps {
  /** แสดงเฉพาะเมื่อผู้ใช้เป็นฝ่ายที่เกี่ยวกับการจัดกำลัง / PO */
  enabled: boolean;
}

/**
 * แดชบอร์ดลำดับที่ 1 — อ่านอย่างเดียว: PO สถานะ active (สายสัญญา) ที่ยังมีโควต้าว่าง
 * ใช้ logic เดียวกับการ์ดบนหน้า PO (po-fulfillment-read-model)
 */
export function PoStaffingQueueCard({ enabled }: PoStaffingQueueCardProps) {
  const firestore = useFirestore();
  const { user: firebaseUser, isUserLoading } = useUser();

  const activePoQuery = useMemoFirebase(() => {
    if (!enabled || !firestore || isUserLoading || !firebaseUser) return null;
    return query(collection(firestore, 'purchase_orders'), where('status', '==', 'active'));
  }, [enabled, firestore, firebaseUser, isUserLoading]);

  const { data: activePOs, isLoading: loadingPOs } = useCollection<PurchaseOrder>(activePoQuery as any);

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

  const queueRows = useMemo(() => {
    if (!activePOs?.length || !allPOLines) return [];
    const contractPOs = activePOs.filter((po) => (po.poType || 'contract') === 'contract');

    const rows: Array<{
      po: PurchaseOrder;
      totals: ReturnType<typeof aggregateActiveLineTotals>;
      topLines: { label: string; req: number; asg: number; rem: number }[];
      moreLineCount: number;
    }> = [];

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
  }, [activePOs, allPOLines, allMobs, allWaves, allPositions]);

  if (!enabled) return null;

  const loading = loadingPOs || loadingLines || loadingWaves || loadingMobs;

  return (
    <Card className="border-primary/20 shadow-md overflow-hidden">
      <CardHeader className="border-b bg-muted/30 pb-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-primary shrink-0" />
              คิวเติมโควต้า (PO Active)
            </CardTitle>
            <CardDescription className="text-xs max-w-3xl leading-relaxed">
              แสดงเฉพาะ Customer PO สายสัญญาที่ <b>active</b> และยังมีช่องว่างตาม PO line — ข้อมูลอ่านอย่างเดียว (ลำดับที่ 1)
              ตัวเลขสอดคล้องกับการ์ดสรุปบนหน้า PO
            </CardDescription>
          </div>
          <Badge variant="secondary" className="shrink-0 w-fit">
            {queueRows.length} PO
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground text-sm">
            <Loader2 className="h-5 w-5 animate-spin" />
            กำลังโหลดคิว PO…
          </div>
        ) : queueRows.length === 0 ? (
          <div className="py-14 px-6 text-center text-muted-foreground text-sm">
            <ShoppingCart className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p>ไม่มี PO Active ที่ต้องเติมโควต้าในขณะนี้</p>
            <p className="text-xs mt-2">เมื่อ PO เป็น active และมีบรรทัดโควต้ายังไม่เต็ม จะแสดงที่นี่</p>
          </div>
        ) : (
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
                      <Badge className="bg-amber-100 text-amber-900 border-amber-200 font-bold">
                        {totals.openSlots}
                      </Badge>
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
        )}
      </CardContent>
    </Card>
  );
}
