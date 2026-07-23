'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { HardHat, ChevronRight, MapPin } from 'lucide-react';
import type { Assignment, DeploymentStatus, POLine, Position, Wave, Worker } from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { CustomerQueryService } from '@/lib/services/customer-query-service';
import { usePortalLocale } from '@/contexts/portal-locale-context';
import { useWorkersByIds } from '@/hooks/use-workers-by-ids';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { collection, doc, getDoc, getDocs, limit, query } from 'firebase/firestore';
import { useClientPortalIdentity } from '@/contexts/client-portal-user-context';
import { mobilizationWorkerNameFromWorker } from '@/lib/ops/mobilization-worker-name';
import { ensureWorkersAssignedCustomerId } from '@/lib/client-portal/ensure-worker-assigned-customer';

/** Rosters visible to the customer from assign through on-site (exclude closed/demob). */
const PORTAL_ROSTER_STATUSES: DeploymentStatus[] = [
  'DRAFT',
  'READINESS_CHECK',
  'CLIENT_SUBMITTED',
  'CLIENT_APPROVED',
  'CONFIRMED',
  'READY_TO_MOB',
  'MOBILIZING',
  'ACTIVE',
];

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

function portalDeploymentLabel(
  status: DeploymentStatus | string | undefined,
  locale: 'en' | 'th',
): { label: string; className: string } {
  const en = locale === 'en';
  switch (status) {
    case 'DRAFT':
      return {
        label: en ? 'Assigned · Waiting MOB' : 'มอบหมายแล้ว · Waiting MOB',
        className: 'bg-sky-50 text-sky-900 border-sky-200',
      };
    case 'READINESS_CHECK':
      return {
        label: en ? 'Readiness check' : 'ตรวจความพร้อม',
        className: 'bg-amber-50 text-amber-800 border-amber-200',
      };
    case 'CLIENT_SUBMITTED':
      return {
        label: en ? 'Submitted for review' : 'ส่งให้ลูกค้าพิจารณา',
        className: 'bg-blue-50 text-blue-800 border-blue-200',
      };
    case 'CLIENT_APPROVED':
      return {
        label: en ? 'Client approved' : 'ลูกค้าอนุมัติแล้ว',
        className: 'bg-emerald-50 text-emerald-800 border-emerald-200',
      };
    case 'CONFIRMED':
      return {
        label: en ? 'Confirmed' : 'ยืนยันแล้ว',
        className: 'bg-violet-50 text-violet-800 border-violet-200',
      };
    case 'READY_TO_MOB':
      return {
        label: en ? 'Ready to MOB' : 'พร้อมเดินทาง',
        className: 'bg-blue-50 text-blue-900 border-blue-200',
      };
    case 'MOBILIZING':
      return {
        label: en ? 'Mobilizing' : 'กำลังระดมพล',
        className: 'bg-amber-50 text-amber-800 border-amber-200',
      };
    case 'ACTIVE':
      return {
        label: en ? 'On site' : 'อยู่หน้างาน',
        className: 'bg-green-50 text-green-800 border-green-200',
      };
    default:
      return {
        label: status || '—',
        className: 'bg-muted text-muted-foreground border-border',
      };
  }
}

export default function ClientWorkersPage() {
  const {
    effectiveUser: currentUser,
    appUserLoading: userLoading,
    canAccessPortal,
    isPortalAdminPreview,
  } = useClientPortalIdentity();
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
  const workerIdsKey = workerIds.join('|');
  const workersById = useWorkersByIds(firestore, workerIds);

  /** Admin preview: backfill assignedCustomerIds so real client_user can open Docs afterward. */
  useEffect(() => {
    if (!firestore || !isPortalAdminPreview || !currentUser?.customerId || !workerIdsKey) return;
    const ids = workerIdsKey.split('|').filter(Boolean);
    if (ids.length === 0) return;
    void ensureWorkersAssignedCustomerId(firestore, ids, currentUser.customerId);
  }, [firestore, isPortalAdminPreview, currentUser?.customerId, workerIdsKey]);

  const rows = useMemo(
    () =>
      (assignments ?? []).filter((a) =>
        PORTAL_ROSTER_STATUSES.includes(a.deploymentStatus as DeploymentStatus),
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
    return rowMeta.filter(({ a, site }) => {
      if (filterPositionId && a.positionId !== filterPositionId) return false;
      if (filterSite && site !== filterSite) return false;
      return true;
    });
  }, [rowMeta, filterPositionId, filterSite]);

  if (userLoading) {
    return <p className="text-sm text-muted-foreground">…</p>;
  }

  if (!currentUser || !canAccessPortal) {
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
            ? 'See who is assigned to your PO from Waiting MOB through On site. Open Docs for certificates and compliance files (read-only).'
            : 'ดูรายชื่อที่มอบหมายลง PO ตั้งแต่ Waiting MOB จนถึงอยู่หน้างาน — กดเอกสารเพื่อดูใบรับรองและเอกสารที่เกี่ยวข้อง (อ่านอย่างเดียว)'}
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <CardTitle className="text-base">{locale === 'en' ? 'Roster' : 'รายชื่อ'}</CardTitle>
              <CardDescription>
                {locale === 'en'
                  ? 'From PO assignments (assigned → on site)'
                  : 'จากการมอบหมายตาม PO (มอบหมายแล้ว → อยู่หน้างาน)'}
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
            <Table className="table-fixed w-full">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[22%]">{locale === 'en' ? 'Name' : 'ชื่อ'}</TableHead>
                  <TableHead className="w-[20%]">{locale === 'en' ? 'Status' : 'สถานะ'}</TableHead>
                  <TableHead className="w-[22%]">{locale === 'en' ? 'Position' : 'ตำแหน่ง'}</TableHead>
                  <TableHead className="w-[26%]">{locale === 'en' ? 'Site / project' : 'สถานที่ / โครงการ'}</TableHead>
                  <TableHead className="w-[10%] text-right">{locale === 'en' ? 'Docs' : 'เอกสาร'}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map(({ a, name, pos, site }) => {
                    const statusUi = portalDeploymentLabel(a.deploymentStatus, locale);
                    return (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium align-middle break-words">{name}</TableCell>
                      <TableCell className="align-middle">
                        <Badge variant="outline" className={`font-medium whitespace-normal text-left ${statusUi.className}`}>
                          {statusUi.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground align-middle break-words">{pos}</TableCell>
                      <TableCell className="align-middle">
                        <span className="inline-flex items-start gap-1 text-sm text-muted-foreground break-words">
                          <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                          {site}
                        </span>
                      </TableCell>
                      <TableCell className="text-right align-middle">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          asChild
                          disabled={!a.workerId}
                          aria-label={locale === 'en' ? 'View documents' : 'ดูเอกสาร'}
                          title={locale === 'en' ? 'View documents' : 'ดูเอกสาร'}
                        >
                          <Link href={`/client-portal/workers/${encodeURIComponent(a.workerId)}`}>
                            <ChevronRight className="h-4 w-4" aria-hidden />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                      {locale === 'en' ? 'No personnel rows.' : 'ไม่มีรายการ'}
                    </TableCell>
                  </TableRow>
                )}
                {rows.length > 0 && filteredRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
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
