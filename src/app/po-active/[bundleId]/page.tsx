'use client';

import { use, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';
import { useFirestore, useDoc, useCollection, useMemoFirebase } from '@/firebase';
import { collection, collectionGroup, doc, query, where } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PoActiveBundleLinesPanel } from '@/components/commercial/po-active-bundle-lines-panel';
import { Loader2, ArrowLeft, Layers, Users } from 'lucide-react';
import type {
  Assignment,
  Customer,
  POLine,
  PoActiveBundle,
  Position,
  PurchaseOrder,
  Wave,
} from '@/lib/types';
import {
  aggregateActiveLineTotals,
  buildPoFulfillmentByLine,
} from '@/lib/ops/po-fulfillment-read-model';
import {
  normalizePoActiveBundleId,
  parseCanonicalPoActiveBundleRouteKey,
  resolvePoActiveBundleKeyForPo,
} from '@/lib/ops/po-active-bundle';
export default function PoActiveBundleDetailPage({
  params,
}: {
  params: Promise<{ bundleId: string }>;
}) {
  const { bundleId: bundleIdParam } = use(params);
  const normalizedBundleId = useMemo(() => normalizePoActiveBundleId(bundleIdParam), [bundleIdParam]);
  const parsedRoute = useMemo(() => parseCanonicalPoActiveBundleRouteKey(normalizedBundleId), [normalizedBundleId]);
  const router = useRouter();

  /** ลิงก์เก่า/พารามิเตอร์แบบ `id_OFFSHORE` → แปลงเป็น `id__OFFSHORE` ในแถบที่อยู่ให้ตรงกับเอกสาร Firestore */
  useEffect(() => {
    const raw = (bundleIdParam || '').trim();
    if (!raw || raw.startsWith('orphan:')) return;
    const canon = normalizePoActiveBundleId(raw);
    if (canon && canon !== raw) {
      router.replace(`/po-active/${encodeURIComponent(canon)}`);
    }
  }, [bundleIdParam, router]);

  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();

  const canSee = useMemo(() => !!currentUser && canView(currentUser, 'customer_pos'), [currentUser]);

  const bundleRef = useMemoFirebase(
    () => (firestore && canSee ? doc(firestore, 'po_active_bundles', normalizedBundleId) : null),
    [firestore, normalizedBundleId, canSee],
  );
  const { data: bundle, isLoading: bundleLoading } = useDoc<PoActiveBundle>(bundleRef as any);

  const customerId = bundle?.customerId ?? parsedRoute?.customerId;

  const customerRef = useMemoFirebase(
    () => (firestore && canSee && customerId ? doc(firestore, 'customers', customerId) : null),
    [firestore, customerId, canSee],
  );
  const { data: customer } = useDoc<Customer>(customerRef as any);

  const activePosQuery = useMemoFirebase(() => {
    if (!firestore || !canSee || !customerId) return null;
    return query(
      collection(firestore, 'purchase_orders'),
      where('customerId', '==', customerId),
      where('status', '==', 'active'),
    );
  }, [firestore, customerId, canSee]);

  const { data: customerActivePos } = useCollection<PurchaseOrder>(activePosQuery as any);

  const poIdsSet = useMemo(() => {
    if (bundle?.poIds?.length) return new Set(bundle.poIds);
    if (!parsedRoute || !normalizedBundleId) return new Set<string>();
    const list = customerActivePos ?? [];
    return new Set(
      list.filter((p) => resolvePoActiveBundleKeyForPo(p) === normalizedBundleId).map((p) => p.id),
    );
  }, [bundle?.poIds, parsedRoute, normalizedBundleId, customerActivePos]);

  const bundlePos = useMemo(() => {
    const list = customerActivePos ?? [];
    return list.filter((p) => poIdsSet.has(p.id));
  }, [customerActivePos, poIdsSet]);

  const linesQuery = useMemoFirebase(() => {
    if (!firestore || !canSee) return null;
    return collectionGroup(firestore, 'po_lines');
  }, [firestore, canSee]);

  const { data: allLines } = useCollection<POLine>(linesQuery as any);

  const bundleLines = useMemo(() => {
    if (!allLines?.length || !poIdsSet.size) return [];
    return allLines.filter((l) => poIdsSet.has(l.poId));
  }, [allLines, poIdsSet]);

  const mobQuery = useMemoFirebase(() => {
    if (!firestore || !canSee) return null;
    return collection(firestore, 'mobilizations');
  }, [firestore, canSee]);

  const { data: allMobs } = useCollection<Assignment>(mobQuery as any);

  const wavesQuery = useMemoFirebase(() => {
    if (!firestore || !canSee) return null;
    return collection(firestore, 'waves');
  }, [firestore, canSee]);

  const { data: allWaves } = useCollection<Wave>(wavesQuery as any);

  const positionsQuery = useMemoFirebase(
    () => (firestore && canSee ? collection(firestore, 'positions') : null),
    [firestore, canSee],
  );
  const { data: allPositions } = useCollection<Position>(positionsQuery as any);

  const totals = useMemo(() => {
    let required = 0;
    let assigned = 0;
    for (const po of bundlePos) {
      const lines = bundleLines.filter((l) => l.poId === po.id);
      const fulfillment = buildPoFulfillmentByLine(lines, allMobs ?? [], allWaves ?? [], po.id);
      const t = aggregateActiveLineTotals(fulfillment);
      required += t.required;
      assigned += t.assigned;
    }
    return { required, assigned, headcountOpen: Math.max(0, required - assigned) };
  }, [bundlePos, bundleLines, allMobs, allWaves]);

  if (userLoading || !currentUser) return null;

  if (!canSee) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="p-6 text-muted-foreground">ไม่มีสิทธิ์เข้าหน้านี้</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 p-4 md:p-6 max-w-[100rem] mx-auto">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/po-active">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold tracking-tight flex flex-wrap items-center gap-2">
              <Layers className="h-7 w-7 text-primary shrink-0" />
              <span className="truncate">PO Active — {customer?.name || customerId || '…'}</span>
              <Badge variant="outline">{bundle?.workMode ?? parsedRoute?.workMode ?? '—'}</Badge>
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              เอกสารรวม PO Active ต่อลูกค้าและโหมดงาน — ใช้มอบหมายและเป็นฐานมุมมอง timesheet / payroll
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/po-active-quota-queue">คิวเติมโควต้า</Link>
          </Button>
        </div>

        {bundleLoading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            กำลังโหลดเอกสาร…
          </div>
        ) : !bundle && !parsedRoute ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground text-sm">
              ไม่พบกลุ่ม PO Active นี้ — อาจถูกลบหรือยังไม่ได้ซิงก์หลังอนุมัติ PO
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">จำนวน PO ในกลุ่ม</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-bold">{poIdsSet.size}</CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                    <Users className="h-4 w-4" /> โควต้ารวม (บรรทัด active)
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-bold">{totals.required}</CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">มอบหมายแล้ว / ว่าง</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-bold">
                  {totals.assigned}{' '}
                  <span className="text-base font-normal text-muted-foreground">
                    / {totals.headcountOpen} ว่าง
                  </span>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>รายการ PO ในกลุ่มนี้</CardTitle>
                <CardDescription>เปิดใบ PO เพื่อแก้ไขหัวเอกสาร — บรรทัดโควต้าจัดการในส่วนด้านล่าง</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {bundlePos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">ไม่มี PO Active ในกลุ่ม — ตรวจสอบสถานะ PO หรือซิงก์จากเมนู PO</p>
                ) : (
                  bundlePos.map((p) => (
                    <Button key={p.id} variant="secondary" size="sm" asChild>
                      <Link href={`/purchase-orders/${p.id}`}>
                        {p.poCode} — {p.title || p.projectName}
                      </Link>
                    </Button>
                  ))
                )}
              </CardContent>
            </Card>

            <PoActiveBundleLinesPanel
              bundlePos={bundlePos}
              bundleLines={bundleLines}
              allPositions={allPositions}
              allMobs={allMobs}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}
