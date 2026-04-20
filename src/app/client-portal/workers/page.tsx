'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { HardHat, ChevronRight, MapPin, Waves } from 'lucide-react';
import type { Assignment, POLine, Position, Wave, Worker } from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { CustomerQueryService } from '@/lib/services/customer-query-service';
import { isClient } from '@/lib/permissions';
import { usePortalLocale } from '@/contexts/portal-locale-context';
import { useWorkersByIds } from '@/hooks/use-workers-by-ids';
import { Button } from '@/components/ui/button';
import { collection, doc, getDoc, getDocs, limit, query } from 'firebase/firestore';
import { useAppUser } from '@/hooks/use-app-user';
import { mobilizationWorkerNameFromWorker } from '@/lib/ops/mobilization-worker-name';

function workerDisplayName(a: Assignment, w: Worker | undefined): string {
  const fromMob = (a.workerName || '').trim();
  if (fromMob) return fromMob;
  const fromWorker = mobilizationWorkerNameFromWorker(w);
  if (fromWorker) return fromWorker;
  return (a.assignmentNo || '').trim() || `—`;
}

function siteDisplayLabel(a: Assignment, waveById: Map<string, Wave>, poLineByKey: Map<string, POLine>): string {
  const wv = a.waveId ? waveById.get(a.waveId) : undefined;
  const site = wv?.siteLocation?.trim();
  if (site) return site;
  if (a.poId && a.poLineId) {
    const pl = poLineByKey.get(`${a.poId}|${a.poLineId}`);
    const wl = pl?.workLocation?.trim();
    if (wl) return wl;
  }
  const proj = wv?.projectName?.trim() || a.projectName?.trim();
  return proj || '—';
}

export default function ClientWorkersPage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { locale, t } = usePortalLocale();
  const [positionLabels, setPositionLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!firestore) return;
    (async () => {
      try {
        const snap = await getDocs(query(collection(firestore, 'positions'), limit(400)));
        const m: Record<string, string> = {};
        snap.docs.forEach((d) => {
          const x = d.data() as Position;
          m[d.id] = x.positionName || x.positionCode || d.id;
        });
        setPositionLabels(m);
      } catch {
        /* ignore */
      }
    })();
  }, [firestore]);

  const queryService = useMemo(() => (firestore ? new CustomerQueryService(firestore) : null), [firestore]);
  const aq = useMemoFirebase(() => queryService?.getScopedAssignmentsQuery(currentUser), [queryService, currentUser]);
  const { data: assignments, isLoading, error: assignmentsError } = useCollection<Assignment>(aq as any);

  const workerIds = useMemo(
    () => [...new Set((assignments ?? []).map((a) => a.workerId).filter(Boolean))],
    [assignments]
  );
  const workersById = useWorkersByIds(firestore, workerIds);

  const rows = useMemo(
    () =>
      (assignments ?? []).filter((a) =>
        ['ACTIVE', 'MOBILIZING', 'READY_TO_MOB', 'CONFIRMED', 'CLIENT_APPROVED'].includes(a.deploymentStatus)
      ),
    [assignments]
  );

  const [waveById, setWaveById] = useState<Map<string, Wave>>(() => new Map());
  const [poLineByKey, setPoLineByKey] = useState<Map<string, POLine>>(() => new Map());

  useEffect(() => {
    if (!firestore || rows.length === 0) {
      setWaveById(new Map());
      setPoLineByKey(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      const wMap = new Map<string, Wave>();
      const pMap = new Map<string, POLine>();
      const wids = [...new Set(rows.map((r) => r.waveId).filter(Boolean))];
      await Promise.all(
        wids.map(async (wid) => {
          try {
            const s = await getDoc(doc(firestore, 'waves', wid));
            if (s.exists()) wMap.set(wid, { id: s.id, ...s.data() } as Wave);
          } catch {
            /* permission */
          }
        })
      );
      const lineKeys = new Map<string, { poId: string; lineId: string }>();
      rows.forEach((r) => {
        if (r.poId && r.poLineId) lineKeys.set(`${r.poId}|${r.poLineId}`, { poId: r.poId, lineId: r.poLineId });
      });
      await Promise.all(
        [...lineKeys.values()].map(async ({ poId, lineId }) => {
          const k = `${poId}|${lineId}`;
          try {
            const s = await getDoc(doc(firestore, 'purchase_orders', poId, 'po_lines', lineId));
            if (s.exists()) pMap.set(k, { id: s.id, ...s.data() } as POLine);
          } catch {
            /* permission */
          }
        })
      );
      if (!cancelled) {
        setWaveById(wMap);
        setPoLineByKey(pMap);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, rows]);

  if (userLoading) {
    return <p className="text-sm text-muted-foreground">…</p>;
  }

  if (!currentUser || !isClient(currentUser)) {
    return (
      <p className="text-sm text-muted-foreground">{locale === 'en' ? 'Customer portal only.' : 'เฉพาะบัญชีลูกค้า'}</p>
    );
  }

  if (assignmentsError) {
    return (
      <p className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
        {assignmentsError.message || String(assignmentsError)}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-primary flex items-center gap-2">
          <HardHat className="h-6 w-6" />
          {locale === 'en' ? 'Personnel' : 'กำลังพล'}
        </h2>
        <p className="text-sm text-muted-foreground">
          {locale === 'en'
            ? 'Name, role, and site. Per-person document links will be enabled here when OPEC turns them on.'
            : 'ชื่อ ตำแหน่ง และสถานที่ — ลิงก์เอกสารรายคนจะเปิดใช้เมื่อ OPEC เปิดให้'}
        </p>
        <Button variant="outline" size="sm" className="mt-3 gap-2" asChild>
          <Link href="/client-portal/waves">
            <Waves className="h-4 w-4" />
            {t('rosterFromTeam')}
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{locale === 'en' ? 'Roster' : 'รายชื่อ'}</CardTitle>
          <CardDescription>{locale === 'en' ? 'From active mobilizations' : 'จากการมอบหมายที่เกี่ยวข้อง'}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm">…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{locale === 'en' ? 'Name' : 'ชื่อ'}</TableHead>
                  <TableHead>{locale === 'en' ? 'Position' : 'ตำแหน่ง'}</TableHead>
                  <TableHead>{locale === 'en' ? 'Site / project' : 'สถานที่ / โครงการ'}</TableHead>
                  <TableHead className="text-right w-[100px]">{locale === 'en' ? 'Docs' : 'เอกสาร'}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a) => {
                  const w = workersById.get(a.workerId);
                  const name = workerDisplayName(a, w);
                  const pos = positionLabels[a.positionId] || a.positionId;
                  const site = siteDisplayLabel(a, waveById, poLineByKey);
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{pos}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5 shrink-0" />
                          {site}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled
                          className="pointer-events-none opacity-40"
                          aria-label={locale === 'en' ? 'Details (coming soon)' : 'รายละเอียด (ยังไม่เปิดใช้)'}
                          title={locale === 'en' ? 'Coming soon' : 'ยังไม่เปิดใช้'}
                        >
                          <ChevronRight className="h-4 w-4" aria-hidden />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-10 text-muted-foreground">
                      {locale === 'en' ? 'No personnel rows.' : 'ไม่มีรายการ'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
