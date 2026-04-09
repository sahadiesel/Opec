'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { HardHat, ChevronRight, MapPin, Waves } from 'lucide-react';
import type { Assignment, User } from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { CustomerQueryService } from '@/lib/services/customer-query-service';
import { isClient } from '@/lib/permissions';
import { usePortalLocale } from '@/contexts/portal-locale-context';
import { useWorkersByIds } from '@/hooks/use-workers-by-ids';
import { Button } from '@/components/ui/button';
import { collection, getDocs, limit, query } from 'firebase/firestore';
import type { Position } from '@/lib/types';

export default function ClientWorkersPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  useUser();
  const firestore = useFirestore();
  const { locale, t } = usePortalLocale();
  const [positionLabels, setPositionLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    const raw = localStorage.getItem('opsflow_user');
    if (raw) setCurrentUser(JSON.parse(raw));
  }, []);

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
  const { data: assignments, isLoading } = useCollection<Assignment>(aq as any);

  const workerIds = useMemo(
    () => [...new Set((assignments ?? []).map((a) => a.workerId).filter(Boolean))],
    [assignments]
  );
  const workersById = useWorkersByIds(firestore, workerIds);

  if (!currentUser || !isClient(currentUser)) {
    return (
      <p className="text-sm text-muted-foreground">{locale === 'en' ? 'Customer portal only.' : 'เฉพาะบัญชีลูกค้า'}</p>
    );
  }

  const rows = (assignments ?? []).filter((a) =>
    ['ACTIVE', 'MOBILIZING', 'READY_TO_MOB', 'CONFIRMED', 'CLIENT_APPROVED'].includes(a.deploymentStatus)
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-primary flex items-center gap-2">
          <HardHat className="h-6 w-6" />
          {locale === 'en' ? 'Personnel' : 'กำลังพล'}
        </h2>
        <p className="text-sm text-muted-foreground">
          {locale === 'en'
            ? 'Name, role, and site. Open a row to view shared documents (if enabled by OPEC).'
            : 'ชื่อ ตำแหน่ง สถานที่ — เปิดแถวเพื่อดูเอกสารที่เปิดให้ลูกค้า (ต้องตั้งค่า assignedCustomerIds ที่คนงาน)'}
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
                  const name = w ? `${w.firstName} ${w.lastName}` : `Worker ${a.workerId.slice(0, 6)}…`;
                  const pos = positionLabels[a.positionId] || a.positionId;
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{pos}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5 shrink-0" />
                          {a.projectName || '—'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/client-portal/workers/${a.workerId}`}>
                            <ChevronRight className="h-4 w-4" />
                          </Link>
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
