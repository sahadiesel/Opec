'use client';

import { Fragment, useMemo } from 'react';
import Link from 'next/link';
import { collection, collectionGroup, query, where } from 'firebase/firestore';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, ShoppingCart, ChevronRight, ClipboardList, Layers, UserPlus } from 'lucide-react';
import type { Assignment, Customer, JobMode, MainContract, PurchaseOrder, POLine, Wave, Position } from '@/lib/types';
import {
  aggregateActiveLineTotals,
  buildPoFulfillmentByLine,
  type PoLineFulfillmentRow,
} from '@/lib/ops/po-fulfillment-read-model';
import { resolvePoActiveBundleKeyForPo } from '@/lib/ops/po-active-bundle';
import { countMobTimesheetSlotsForPoScope } from '@/lib/ops/assignment-mob-eligibility';
import { positionListPrimaryName, type PositionDoc } from '@/lib/position-display';

function workModeBadgeLabel(mode: JobMode | undefined): string {
  if (mode === 'ONSHORE') return 'Onshore';
  if (mode === 'OFFSHORE') return 'Offshore';
  return 'Offshore';
}

/** บรรทัดโควต้าในคิว — มี po เจ้าของบรรทัดสำหรับแสดงผลรวมหลาย PO ในชุดเดียว */
export type PoQuotaBundleLineRow = PoLineFulfillmentRow & {
  poId: string;
  poCode: string;
};

/** หนึ่งแถวคิว = ชุด PO Active (`customerId__ONSHORE|OFFSHORE`) — PO ไม่มี customer ใช้คีย์ `orphan:poId` */
export type PoQuotaQueueRow = {
  bundleKey: string;
  customerId: string;
  workMode: JobMode | undefined;
  pos: PurchaseOrder[];
  totals: ReturnType<typeof aggregateActiveLineTotals>;
  lineRows: PoQuotaBundleLineRow[];
};

/**
 * รวม PO สายสัญญา active เป็นชุด PO Active — ใช้ทั้งคิวโควต้าและหน้า Assignments (หลีกเลี่ยงดึงข้อมูลซ้ำ)
 */
export function buildPoActiveBundleRows(
  activePOs: PurchaseOrder[] | undefined,
  allPOLines: POLine[] | undefined,
  allMobs: Assignment[] | undefined,
  allWaves: Wave[] | undefined,
  activeMainContractIdSet: Set<string>,
  contractsLoaded: boolean,
  variant: 'quota-queue' | 'assignment-landing' | 'timesheet-hub',
): PoQuotaQueueRow[] {
  if (!activePOs?.length || !allPOLines || !contractsLoaded || activeMainContractIdSet.size === 0) return [];

  const contractPOs = activePOs.filter(
    (po) =>
      (po.poType || 'contract') === 'contract' &&
      po.contractId &&
      activeMainContractIdSet.has(po.contractId),
  );

  const groups = new Map<string, PurchaseOrder[]>();
  for (const po of contractPOs) {
    const key = resolvePoActiveBundleKeyForPo(po);
    const arr = groups.get(key) ?? [];
    arr.push(po);
    groups.set(key, arr);
  }

  const rows: PoQuotaQueueRow[] = [];
  for (const [bundleKey, pos] of groups) {
    const lineRows: PoQuotaBundleLineRow[] = [];
    for (const po of pos) {
      const lines = allPOLines.filter((l) => l.poId === po.id);
      if (!lines.length) continue;
      const fulfillment = buildPoFulfillmentByLine(lines, allMobs ?? [], allWaves ?? [], po.id);
      for (const r of fulfillment) {
        lineRows.push({ ...r, poId: po.id, poCode: po.poCode });
      }
    }
    const totals = aggregateActiveLineTotals(lineRows);
    if (variant !== 'timesheet-hub' && totals.required <= 0) continue;
    if (variant === 'quota-queue' && totals.openSlots <= 0) continue;

    const head = pos[0];
    const modeFromKey =
      bundleKey.endsWith('__ONSHORE') ? 'ONSHORE' : bundleKey.endsWith('__OFFSHORE') ? 'OFFSHORE' : undefined;
    rows.push({
      bundleKey,
      customerId: head.customerId,
      workMode: modeFromKey ?? head.poWorkMode,
      pos,
      totals,
      lineRows,
    });
  }

  if (variant === 'quota-queue') {
    rows.sort((a, b) => b.totals.openSlots - a.totals.openSlots);
  } else {
    rows.sort((a, b) => {
      const ca = (a.customerId || '').localeCompare(b.customerId || '');
      if (ca !== 0) return ca;
      return a.bundleKey.localeCompare(b.bundleKey);
    });
  }
  return rows;
}

export function usePoQuotaQueueRows(enabled: boolean): {
  queueRows: PoQuotaQueueRow[];
  assignmentLandingRows: PoQuotaQueueRow[];
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

  const contractsLoaded = activeContracts !== undefined;
  const queueRows = useMemo(
    () =>
      buildPoActiveBundleRows(
        activePOs ?? undefined,
        allPOLines ?? undefined,
        allMobs ?? undefined,
        allWaves ?? undefined,
        activeMainContractIdSet,
        contractsLoaded,
        'quota-queue',
      ),
    [activePOs, allPOLines, allMobs, allWaves, activeMainContractIdSet, contractsLoaded],
  );
  const assignmentLandingRows = useMemo(
    () =>
      buildPoActiveBundleRows(
        activePOs ?? undefined,
        allPOLines ?? undefined,
        allMobs ?? undefined,
        allWaves ?? undefined,
        activeMainContractIdSet,
        contractsLoaded,
        'assignment-landing',
      ),
    [activePOs, allPOLines, allMobs, allWaves, activeMainContractIdSet, contractsLoaded],
  );

  const loading =
    loadingPOs || loadingLines || loadingWaves || loadingMobs || loadingContracts;

  return {
    queueRows,
    assignmentLandingRows,
    customers: customers ?? undefined,
    allPositions: allPositions ?? undefined,
    loading,
  };
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
        กำลังโหลดคิว PO Active…
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
          <TableHead className="pl-6 font-bold">PO Active / ลูกค้า</TableHead>
          <TableHead className="font-bold hidden md:table-cell">ลูกค้า</TableHead>
          <TableHead className="text-center font-bold">โควต้า</TableHead>
          <TableHead className="text-center font-bold">มอบหมาย</TableHead>
          <TableHead className="text-center font-bold">ว่าง</TableHead>
          <TableHead className="text-right pr-6 font-bold">ดำเนินการ</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {queueRows.map(({ bundleKey, customerId, workMode, pos, totals, lineRows }) => {
          const cust = customers?.find((c) => c.id === customerId);
          const activeLines = lineRows.filter((r) => r.lineStatus === 'active');
          const isOrphan = bundleKey.startsWith('orphan:');
          const orphanPoId = isOrphan ? bundleKey.slice('orphan:'.length) : '';
          const assignHref = isOrphan
            ? `/assignments?poId=${encodeURIComponent(orphanPoId)}&openDialog=1`
            : `/assignments?poActiveBundleId=${encodeURIComponent(bundleKey)}&openDialog=1`;
          const secondaryHref = isOrphan
            ? `/purchase-orders/${encodeURIComponent(orphanPoId)}`
            : `/po-active/${encodeURIComponent(bundleKey)}`;
          const secondaryLabel = isOrphan ? 'เปิด PO' : 'เปิด PO Active';
          const poCodesLine = pos.map((p) => p.poCode).join(', ');
          return (
            <Fragment key={bundleKey}>
              <TableRow className="align-top">
                <TableCell className="pl-6 py-4">
                  <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Layers className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                      <Badge variant="outline" className="text-[10px] font-semibold shrink-0">
                        {workModeBadgeLabel(workMode)}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground font-mono truncate max-w-[220px]" title={bundleKey}>
                        {!isOrphan ? bundleKey : pos[0]?.poCode}
                      </span>
                    </div>
                    <span className="font-semibold text-sm leading-snug">{cust?.name ?? '—'}</span>
                    <p className="text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground">PO ในชุด:</span> {poCodesLine}
                    </p>
                    <p className="text-[10px] text-muted-foreground pt-0.5">
                      {activeLines.length} บรรทัดโควต้า (รวมทุก PO ในชุด) — รายละเอียดด้านล่าง
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
                      <Link href={assignHref}>
                        มอบหมาย (Assign) <ChevronRight className="h-3 w-3 ml-0.5" />
                      </Link>
                    </Button>
                    <Button variant="outline" size="sm" className="h-8 text-xs" asChild>
                      <Link href={secondaryHref}>
                        {secondaryLabel} <ChevronRight className="h-3 w-3 ml-0.5" />
                      </Link>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
              <TableRow key={`${bundleKey}-lines`} className="border-b-2">
                <TableCell colSpan={6} className="p-0 bg-muted/15">
                  <div className="px-4 py-3 md:pl-10">
                    <Table>
                      <TableHeader className="bg-transparent">
                        <TableRow className="hover:bg-transparent border-0">
                          <TableHead className="text-[11px] h-8">PO</TableHead>
                          <TableHead className="text-[11px] h-8">ตำแหน่ง</TableHead>
                          <TableHead className="text-[11px] h-8 hidden sm:table-cell">สถานที่</TableHead>
                          <TableHead className="text-[11px] h-8 text-center">โควต้า</TableHead>
                          <TableHead className="text-[11px] h-8 text-center">มอบหมาย</TableHead>
                          <TableHead className="text-[11px] h-8 text-center">ว่าง</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {activeLines.map((row) => {
                          const pDoc = allPositions?.find((p) => p.id === row.positionId);
                          const label = pDoc ? positionListPrimaryName(pDoc as PositionDoc) : row.positionId;
                          return (
                            <TableRow key={`${row.poId}-${row.lineId}`} className="border-muted/40">
                              <TableCell className="py-2 text-xs font-mono font-semibold text-primary whitespace-nowrap">
                                {row.poCode}
                              </TableCell>
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
              แต่ละแถวคือ <strong className="font-semibold text-foreground">หนึ่งชุด PO Active</strong> (ลูกค้า + Onshore/Offshore)
              — รวมโควต้าจากทุก Customer PO ในชุดเดียวกัน มีปุ่ม{' '}
              <strong className="font-semibold text-foreground">มอบหมาย (Assign)</strong> เดียวต่อชุด ตารางย่อยแสดงบรรทัดแยกตาม PO
              (สายสัญญาที่สัญญาหลัก active และยังมีช่องว่าง — ไม่บังคับผ่าน Wave)
            </CardDescription>
          </div>
          <Badge variant="secondary" className="shrink-0 w-fit">
            {queueRows.length} ชุด
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

/**
 * เฟส 3 — หน้า Assignments: เลือกชุด PO Active ก่อน แล้วค่อย drill-down มอบหมายตามชุด
 */
export function PoAssignmentBundleLandingPanel({
  rows,
  customers,
  assignments,
  loading,
}: {
  rows: PoQuotaQueueRow[];
  customers: Customer[] | undefined;
  assignments: Assignment[] | undefined;
  loading: boolean;
}) {
  if (loading) {
    return (
      <Card className="border-primary/20 shadow-md">
        <CardContent className="flex items-center justify-center gap-2 py-16 text-muted-foreground text-sm">
          <Loader2 className="h-5 w-5 animate-spin" />
          กำลังโหลดชุด PO Active…
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card className="border-dashed border-muted-foreground/30 bg-muted/10">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            ไม่พบชุด PO Active สำหรับมอบหมาย
          </CardTitle>
          <CardDescription>
            ต้องมี Customer PO สายสัญญาที่ Active และสัญญาหลัก Active พร้อมบรรทัดโควต้า — ตรวจที่เมนู Customer PO หรือ{' '}
            <Link href="/po-active-quota-queue" className="text-primary font-semibold underline">
              คิวเติมโควต้า
            </Link>
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="border-primary/25 shadow-md overflow-hidden">
      <CardHeader className="border-b bg-muted/30 pb-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary shrink-0" />
              เลือกชุด PO Active (ขั้นที่ 1)
            </CardTitle>
            <CardDescription className="text-xs max-w-3xl leading-relaxed">
              แต่ละแถวคือ <strong className="font-semibold text-foreground">หนึ่งชุด</strong> ต่อลูกค้าและ Onshore/Offshore — กด{' '}
              <strong className="font-semibold text-foreground">เข้าชุดนี้</strong> เพื่อดูรายการมอบหมายและสร้างการมอบหมายภายในชุดเดียวกัน
              <span className="block mt-1.5 text-muted-foreground">
                คอลัมน์ <strong>สถานะ MOB</strong> แยกจำนวนที่ <strong>ผ่าน</strong> เกณฑ์ขึ้นตารางลงเวลา กับ{' '}
                <strong>รอตรวจสอบ</strong> (มอบหมายแล้วแต่ยังไม่ mobilization ครบตาม Wave Board)
              </span>
            </CardDescription>
          </div>
          <Badge variant="secondary" className="shrink-0 w-fit">
            {rows.length} ชุด
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="pl-6 font-bold">ลูกค้า · โหมดงาน</TableHead>
              <TableHead className="font-bold hidden md:table-cell">รหัส PO ในชุด</TableHead>
              <TableHead className="text-center font-bold">โควต้า</TableHead>
              <TableHead className="text-center font-bold">มอบหมายแล้ว</TableHead>
              <TableHead className="text-center font-bold min-w-[9rem]" title="ผ่าน = พร้อมลงเวลา · รอ = มอบหมายแล้วแต่ยังไม่ผ่าน mobilization ตามเกณฑ์ Wave Board">
                สถานะ MOB
              </TableHead>
              <TableHead className="text-center font-bold">ว่าง</TableHead>
              <TableHead className="text-right pr-6 font-bold">ดำเนินการ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ bundleKey, customerId, workMode, pos, totals }) => {
              const cust = customers?.find((c) => c.id === customerId);
              const poCodesLine = pos.map((p) => p.poCode).join(', ');
              const poIdSet = new Set(pos.map((p) => p.id));
              const { mobPassed, mobWaiting } = countMobTimesheetSlotsForPoScope(assignments, poIdSet);
              const manageHref = `/assignments?poActiveBundleId=${encodeURIComponent(bundleKey)}`;
              const assignHref = `${manageHref}&openDialog=1`;
              return (
                <TableRow key={bundleKey} className="align-top">
                  <TableCell className="pl-6 py-4">
                    <div className="flex flex-col gap-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="text-[10px] font-semibold shrink-0">
                          {workModeBadgeLabel(workMode)}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground font-mono truncate max-w-[200px]" title={bundleKey}>
                          {bundleKey.startsWith('orphan:') ? pos[0]?.poCode ?? bundleKey : bundleKey}
                        </span>
                      </div>
                      <span className="font-semibold text-sm">{(cust?.name ?? customerId) || '—'}</span>
                      <p className="text-[11px] text-muted-foreground md:hidden">
                        <span className="font-medium text-foreground">PO:</span> {poCodesLine}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-xs font-mono text-muted-foreground max-w-[240px]">
                    {poCodesLine}
                  </TableCell>
                  <TableCell className="text-center font-semibold">{totals.required}</TableCell>
                  <TableCell className="text-center">{totals.assigned}</TableCell>
                  <TableCell className="text-center text-xs align-middle">
                    <div className="flex flex-col items-center gap-1 py-0.5">
                      <Badge className="bg-emerald-700 hover:bg-emerald-700 text-white border-transparent shadow-none font-semibold tabular-nums">
                        ผ่าน {mobPassed}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="border-amber-600/50 text-amber-900 bg-amber-50/80 font-semibold tabular-nums"
                      >
                        รอตรวจ {mobWaiting}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge
                      variant={totals.openSlots > 0 ? 'default' : 'secondary'}
                      className={totals.openSlots > 0 ? 'bg-amber-100 text-amber-900 border-amber-200 font-bold' : ''}
                    >
                      {totals.openSlots}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right pr-6 py-4">
                    <div className="flex flex-col items-end gap-1">
                      <Button size="sm" className="h-8 text-xs font-semibold" asChild>
                        <Link href={manageHref}>
                          เข้าชุดนี้ <ChevronRight className="h-3 w-3 ml-0.5" />
                        </Link>
                      </Button>
                      <Button variant="outline" size="sm" className="h-8 text-xs" asChild>
                        <Link href={assignHref}>
                          มอบหมายใหม่… <ChevronRight className="h-3 w-3 ml-0.5" />
                        </Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div className="border-t bg-muted/20 px-4 py-3 text-[11px] text-muted-foreground flex flex-wrap gap-x-4 gap-y-2 justify-between">
          <span>
            ต้องการดูรายการมอบหมายทั้งระบบโดยไม่แยกชุด?{' '}
            <Link href="/assignments?all=1" className="font-semibold text-primary underline">
              โหมดแสดงทั้งหมด
            </Link>
          </span>
          <Link href="/po-active-quota-queue" className="font-semibold text-primary underline shrink-0">
            ไปคิวเติมโควต้า →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
