'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { LayoutGrid, ChevronRight, Info, Waves, FileText, MapPin, Users } from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import type { Assignment, PurchaseOrder, User, Wave } from '@/lib/types';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccess, canView, isMatrixControlledRole } from '@/lib/permissions';
import { assignmentReadyForWaveTimesheet, waveRoundMonthLabel } from '@/lib/constants/timesheet-ui';
import { PageGuidance } from '@/components/layout/page-guidance';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import { totalPlannedWorkersOnWave } from '@/lib/ops/wave-allocation';

export default function TimesheetHubPage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const useMatrixGuards = isMatrixControlledRole(currentUser);
  const canViewTimesheets = useMemo(
    () => (useMatrixGuards ? canAccess(currentUser, 'timesheets', 'view') : canView(currentUser, 'timesheets')),
    [currentUser, useMatrixGuards]
  );

  const poQuery = useMemoFirebase(
    () => (firestore && canViewTimesheets ? query(collection(firestore, 'purchase_orders'), where('status', '==', 'active')) : null),
    [firestore, canViewTimesheets]
  );
  const { data: pos, isLoading: poLoading } = useCollection<PurchaseOrder>(poQuery as any);

  const wavesQuery = useMemoFirebase(
    () => (firestore && canViewTimesheets ? collection(firestore, 'waves') : null),
    [firestore, canViewTimesheets]
  );
  const { data: allWaves, isLoading: wavesLoading } = useCollection<Wave>(wavesQuery as any);

  const mobQuery = useMemoFirebase(
    () => (firestore && canViewTimesheets ? collection(firestore, 'mobilizations') : null),
    [firestore, canViewTimesheets]
  );
  const { data: allMobs, isLoading: mobLoading } = useCollection<Assignment>(mobQuery as any);

  const wavesByPo = useMemo(() => {
    const m = new Map<string, Wave[]>();
    for (const w of allWaves ?? []) {
      if (w.status === 'CLOSED') continue;
      const list = m.get(w.poId) ?? [];
      list.push(w);
      m.set(w.poId, list);
    }
    return m;
  }, [allWaves]);

  const mobsByWave = useMemo(() => {
    const m = new Map<string, Assignment[]>();
    for (const a of allMobs ?? []) {
      const list = m.get(a.waveId) ?? [];
      list.push(a);
      m.set(a.waveId, list);
    }
    return m;
  }, [allMobs]);

  const loading = userLoading || poLoading || wavesLoading || mobLoading;

  if (userLoading || !currentUser) return null;
  if (!canViewTimesheets) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-5xl mx-auto py-10 text-center text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงเมนูนี้</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="mx-auto max-w-[1400px] space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <PayrollScopeTag scope="worker" showHint={false} />
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-primary flex items-center gap-2">
              <LayoutGrid className="h-8 w-8" />
              ศูนย์ลงเวลา (ภาพรวม PO / Wave)
            </h1>
            <p className="text-muted-foreground mt-1 max-w-3xl">
              เลือก PO / Wave แล้วกด <strong>เปิด Wave Board</strong> เพื่อคีย์รายวัน — คอลัมน์ <strong>รอบเดือน</strong> ช่วยดูว่าเป็นรอบเดือนไหน (ยังไม่ปิดรอบ / ยังลงข้อมูลไม่ครบ)
              จนกว่า Wave จะปิดหลังอนุมัติ — รายการจะไม่แสดงเมื่อสถานะ Wave เป็น CLOSED
            </p>
          </div>
          <Button variant="outline" asChild className="shrink-0">
            <Link href="/timesheets/wave-month">สรุปลงเวลารายเดือน (Wave) →</Link>
          </Button>
        </div>

        <PageGuidance
          title="เทียบกับใบลงเวลาหน้างาน"
          tips={[
            'แต่ละวันให้ระบุประเภทวัน (ทำงาน / สแตนด์บาย / เดินทาง ฯลฯ) และชั่วโมงปกติ — ตรงแถว “ชั่วโมง” ในกระดาษ',
            'คอลัมน์ OT ไม่ต้องกรอกที่ Wave Board — การคิด OT ฝั่งวางบิลลูกค้า vs ฝั่งจ่ายเงินเดือนแยกกัน ใช้ timesheet เป็นแหล่งชั่วโมงก่อน',
            'คอลัมน์ “พร้อมลงเวลา” = คนที่ READINESS = ready และ deployment อยู่ในชุดที่เปิด Wave Board ได้ (สอดคล้องหน้า Mobilization) — “ยังไม่ขึ้นบอร์ด” = ที่เหลือใน Wave',
          ]}
        />

        <Alert className="border-primary/30 bg-primary/5">
          <Info className="h-4 w-4" />
          <AlertTitle>โฟลว์สั้นๆ</AlertTitle>
          <AlertDescription className="text-sm space-y-1">
            <p>
              <strong>1.</strong> มอบหมายคนเข้า Wave → <strong>2.</strong> Mobilization (ความพร้อม / ปุ่มเข้างาน) →{' '}
              <strong>3.</strong> กลับมาที่นี่แล้วกด <strong>เปิด Wave Board</strong> เพื่อลงชั่วโมงรายวันตามแถวคนงาน
            </p>
          </AlertDescription>
        </Alert>

        {loading ? (
          <p className="text-sm text-muted-foreground py-12 text-center">กำลังโหลด PO / Wave / การมอบหมาย…</p>
        ) : (
          <div className="space-y-8">
            {(pos ?? []).map((po) => {
              const waves = wavesByPo.get(po.id) ?? [];
              if (waves.length === 0) return null;
              return (
                <Card key={po.id} className="overflow-hidden shadow-sm">
                  <CardHeader className="border-b bg-muted/30">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <FileText className="h-5 w-5 text-primary" />
                          {po.poCode}
                        </CardTitle>
                        <CardDescription className="font-medium text-foreground/80">{po.projectName}</CardDescription>
                      </div>
                      <Badge variant="secondary">{waves.length} Wave</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Wave</TableHead>
                          <TableHead
                            className="whitespace-nowrap"
                            title="รอบเดือนจากช่วงวันที่ Wave (start–end)"
                          >
                            รอบเดือน
                          </TableHead>
                          <TableHead>สถานที่</TableHead>
                          <TableHead className="text-center">สถานะเวฟ</TableHead>
                          <TableHead className="text-center">มอบหมาย / แผน</TableHead>
                          <TableHead
                            className="text-center max-w-[120px]"
                            title="READINESS=ready + deployment ตาม Wave Board (เทียบหน้า Mobilization)"
                          >
                            พร้อมลงเวลา
                          </TableHead>
                          <TableHead
                            className="text-center max-w-[120px]"
                            title="คนใน Wave ที่ยังไม่เข้าเงื่อนไขพร้อมลงเวลา"
                          >
                            ยังไม่ขึ้นบอร์ด
                          </TableHead>
                          <TableHead className="text-right pr-4">ลงเวลา / สรุป</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {waves.map((w) => {
                          const mobs = mobsByWave.get(w.id) ?? [];
                          const ready = mobs.filter((m) => assignmentReadyForWaveTimesheet(m)).length;
                          const notOnBoard = mobs.filter((m) => !assignmentReadyForWaveTimesheet(m)).length;
                          const planned = totalPlannedWorkersOnWave(w) || w.plannedWorkers || 0;
                          return (
                            <TableRow key={w.id}>
                              <TableCell className="font-mono font-semibold">
                                <span className="flex items-center gap-1">
                                  <Waves className="h-3.5 w-3.5 text-primary" />
                                  {w.waveCode}
                                </span>
                              </TableCell>
                              <TableCell className="text-sm font-semibold text-primary whitespace-nowrap">
                                {waveRoundMonthLabel(w)}
                              </TableCell>
                              <TableCell>
                                <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                                  <MapPin className="h-3 w-3 shrink-0" />
                                  {w.siteLocation || '—'}
                                </span>
                              </TableCell>
                              <TableCell className="text-center">
                                <Badge variant="outline">{w.status}</Badge>
                              </TableCell>
                              <TableCell className="text-center">
                                <span className="inline-flex items-center justify-center gap-1">
                                  <Users className="h-3.5 w-3.5" />
                                  {w.assignedWorkers ?? mobs.length}
                                  <span className="text-muted-foreground">/</span>
                                  {planned}
                                </span>
                              </TableCell>
                              <TableCell className="text-center font-semibold text-green-700">{ready}</TableCell>
                              <TableCell className="text-center text-amber-800">{notOnBoard}</TableCell>
                              <TableCell className="text-right">
                                <div className="flex flex-col items-end gap-1 sm:flex-row sm:justify-end">
                                  <Button size="sm" className="gap-1" asChild>
                                    <Link href={`/timesheets/wave-board?poId=${encodeURIComponent(po.id)}&waveId=${encodeURIComponent(w.id)}`}>
                                      เปิด Wave Board
                                      <ChevronRight className="h-4 w-4" />
                                    </Link>
                                  </Button>
                                  <Button size="sm" variant="outline" className="gap-1" asChild>
                                    <Link
                                      href={`/timesheets/wave-month?poId=${encodeURIComponent(po.id)}&waveId=${encodeURIComponent(w.id)}&month=${encodeURIComponent((w.startDate || '').slice(0, 7) || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`)}`}
                                    >
                                      สรุปเดือน
                                    </Link>
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              );
            })}
            {(pos ?? []).every((p) => (wavesByPo.get(p.id) ?? []).length === 0) && (
              <p className="text-center text-muted-foreground py-12 border border-dashed rounded-lg">
                ยังไม่มี Wave ที่เปิดอยู่ผูกกับ PO ที่ active — สร้าง Wave และมอบหมายคนงานก่อน
              </p>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
