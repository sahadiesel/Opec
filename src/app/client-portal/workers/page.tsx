'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { HardHat, ChevronRight, MapPin } from 'lucide-react';
import type { Assignment, POLine, Position, Wave, Worker } from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { CustomerQueryService } from '@/lib/services/customer-query-service';
import { isClient } from '@/lib/permissions';
import { usePortalLocale } from '@/contexts/portal-locale-context';
import { useWorkersByIds } from '@/hooks/use-workers-by-ids';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
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
  const { locale } = usePortalLocale();
  const [positionLabels, setPositionLabels] = useState<Record<string, string>>({});
  const [filterPositionId, setFilterPositionId] = useState<string>('');
  const [filterSite, setFilterSite] = useState<string>('');

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

  const rowMeta = useMemo(() => {
    return rows.map((a) => {
      const w = workersById.get(a.workerId);
      const name = workerDisplayName(a, w);
      const pos = positionLabels[a.positionId] || a.positionId;
      const site = siteDisplayLabel(a, waveById, poLineByKey);
      return { a, name, pos, site };
    });
  }, [rows, workersById, positionLabels, waveById, poLineByKey]);

  const positionOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rowMeta) {
      if (r.a.positionId) m.set(r.a.positionId, r.pos);
    }
    return [...m.entries()].sort((x, y) =>
      (x[1] || '').localeCompare(y[1] || '', locale === 'th' ? 'th' : 'en', { sensitivity: 'base' })
    );
  }, [rowMeta, locale]);

  const siteOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rowMeta) s.add(r.site);
    return [...s].sort((a, b) => a.localeCompare(b, locale === 'th' ? 'th' : 'en', { sensitivity: 'base' }));
  }, [rowMeta, locale]);

  const filteredRows = useMemo(() => {
    return rowMeta.filter(({ a, pos, site }) => {
      if (filterPositionId && a.positionId !== filterPositionId) return false;
      if (filterSite && site !== filterSite) return false;
      return true;
    });
  }, [rowMeta, filterPositionId, filterSite]);

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
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <CardTitle className="text-base">{locale === 'en' ? 'Roster' : 'รายชื่อ'}</CardTitle>
              <CardDescription>
                {locale === 'en' ? 'From active mobilizations' : 'จากการมอบหมายที่เกี่ยวข้อง'}
              </CardDescription>
            </div>
            {rows.length > 0 && (
              <div className="flex flex-col sm:flex-row gap-3 sm:items-end shrink-0 w-full sm:w-auto">
                <div className="space-y-1.5 min-w-0 sm:min-w-[200px]">
                  <Label className="text-xs font-medium text-muted-foreground">
                    {locale === 'en' ? 'Position' : 'ตำแหน่ง'}
                  </Label>
                  <Select
                    value={filterPositionId || '__all__'}
                    onValueChange={(v) => setFilterPositionId(v === '__all__' ? '' : v)}
                  >
                    <SelectTrigger className="h-9 w-full sm:w-[220px]">
                      <SelectValue
                        placeholder={locale === 'en' ? 'All positions' : 'ทุกตำแหน่ง'}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">
                        {locale === 'en' ? 'All positions' : 'ทุกตำแหน่ง'}
                      </SelectItem>
                      {positionOptions.map(([id, label]) => (
                        <SelectItem key={id} value={id}>
                          {label || id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 min-w-0 sm:min-w-[200px]">
                  <Label className="text-xs font-medium text-muted-foreground">
                    {locale === 'en' ? 'Location' : 'สถานที่'}
                  </Label>
                  <Select
                    value={filterSite || '__all__'}
                    onValueChange={(v) => setFilterSite(v === '__all__' ? '' : v)}
                  >
                    <SelectTrigger className="h-9 w-full sm:w-[220px]">
                      <SelectValue
                        placeholder={locale === 'en' ? 'All sites' : 'ทุกสถานที่'}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">
                        {locale === 'en' ? 'All sites' : 'ทุกสถานที่'}
                      </SelectItem>
                      {siteOptions.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>
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
                {filteredRows.map(({ a, name, pos, site }) => (
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
                  ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-10 text-muted-foreground">
                      {locale === 'en' ? 'No personnel rows.' : 'ไม่มีรายการ'}
                    </TableCell>
                  </TableRow>
                )}
                {rows.length > 0 && filteredRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-10 text-muted-foreground">
                      {locale === 'en' ? 'No matches for the selected filters.' : 'ไม่พบรายการตามตัวกรอง'}
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
