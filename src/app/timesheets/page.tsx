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
import { collection, collectionGroup, query, where } from 'firebase/firestore';
import type { Assignment, POLine, PurchaseOrder, User, Wave } from '@/lib/types';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccess, canView, isMatrixControlledRole } from '@/lib/permissions';
import { assignmentReadyForWaveTimesheet } from '@/lib/constants/timesheet-ui';
import { PageGuidance } from '@/components/layout/page-guidance';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import { aggregateActiveLineTotals, buildPoFulfillmentByLine } from '@/lib/ops/po-fulfillment-read-model';
import {
  formatPoMonthTimesheetDocLabel,
  formatThaiYearMonthLabel,
  wavesForPoInYearMonth,
  yearMonthsForPoWaves,
} from '@/lib/ops/timesheet-hub-po-month';
import { isAssignmentActiveOnWaveRoster, pickRosterLinePerWorker } from '@/lib/ops/assignment-roster';

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

  const poLinesQuery = useMemoFirebase(
    () => (firestore && canViewTimesheets ? collectionGroup(firestore, 'po_lines') : null),
    [firestore, canViewTimesheets],
  );
  const { data: allPOLines, isLoading: polinesLoading } = useCollection<POLine>(poLinesQuery as any);

  const loading = userLoading || poLoading || wavesLoading || mobLoading || polinesLoading;

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
              ศูนย์ลงเวลา (PO / งวด timesheet รายเดือน)
            </h1>
            <p className="text-muted-foreground mt-1 max-w-3xl">
              แต่ละแถว = <strong>งวด timesheet รายเดือน</strong> ต่อ PO (หลาย wave รวมในงวดเดียวกันได้) — กด{' '}
              <strong>เปิดกระดานลงเวลา</strong> เพื่อลงรายวัน; มอบหมาย/แผนซ้ายใช้ตัวเลขเดียวกับคิว PO (โควต้า vs มอบหมาย) จนกว่า
              wave ทั้ง PO จะปิด
            </p>
            <p className="text-sm text-muted-foreground mt-2 max-w-3xl border-l-2 border-amber-400/80 pl-3">
              <strong>สถานะเวฟ PLANNING กับการลงเวลา:</strong> ระบบอนุญาตลงเวลาได้เมื่อรายมอบหมายไม่อยู่ DRAFT (พร้อมลงเวลา) แม้ badge ยังแสดง
              PLANNING โดยไม่อาจตั้ง ACTIVE โดยอัตโนมัติ ถ้าต้องการ badge สอดคล้อง ให้ไป{' '}
              <Link className="font-medium text-primary underline" href="/waves">หน้า Waves</Link> → เปิด Wave นั้น
              แล้วกด <strong>ตั้งสถานะเวฟเป็น ACTIVE</strong> (หรือ <strong>ยืนยันมอบหมายเพื่อลงเวลา</strong> เมื่อยังมี DRAFT ค้าง)
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <Button asChild>
              <Link href="/timesheets/po-month">เอกสาร timesheet ราย PO+เดือน (หลัก)</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/timesheets/wave-month">สรุปรายเดือน (ราย wave) →</Link>
            </Button>
          </div>
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
                          <TableHead title="รหัสอ้างอิงงวด — PO + ปฏิทิน (หลาย wave ในงวดเดียว)">เลขที่ / งวด</TableHead>
                          <TableHead className="whitespace-nowrap" title="รอบเดือนของ timesheet รายเดือน">
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
                        {(() => {
                          const lines = (allPOLines ?? []).filter((l) => l.poId === po.id);
                          const fulfillment = buildPoFulfillmentByLine(lines, allMobs ?? [], allWaves ?? [], po.id);
                          const { assigned: poAssigned, required: poPlanned } = aggregateActiveLineTotals(fulfillment);
                          const yms = yearMonthsForPoWaves(waves);
                          return yms.map((ym) => {
                            const wInM = wavesForPoInYearMonth(waves, ym);
                            if (wInM.length === 0) return null;
                            const flat: Assignment[] = [];
                            for (const wv of wInM) {
                              const raw = mobsByWave.get(wv.id) ?? [];
                              const active = pickRosterLinePerWorker(raw);
                              for (const a of active) {
                                if (isAssignmentActiveOnWaveRoster(a)) flat.push(a);
                              }
                            }
                            const ready = flat.filter((m) => assignmentReadyForWaveTimesheet(m)).length;
                            const notOnBoard = flat.filter((m) => !assignmentReadyForWaveTimesheet(m)).length;
                            const sites = [...new Set(wInM.map((w) => w.siteLocation).filter(Boolean))];
                            const statusSet = [...new Set(wInM.map((w) => w.status))];
                            return (
                              <TableRow key={`${po.id}-${ym}`}>
                                <TableCell className="font-mono text-sm">
                                  <span className="flex items-center gap-1 font-semibold">
                                    <Waves className="h-3.5 w-3.5 text-primary" />
                                    {formatPoMonthTimesheetDocLabel(po, ym)}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground block">
                                    {wInM.length} wave · {wInM.map((w) => w.waveCode).join(', ')}
                                  </span>
                                </TableCell>
                                <TableCell className="text-sm font-semibold text-primary whitespace-nowrap">
                                  {formatThaiYearMonthLabel(ym, 'th-TH')}
                                </TableCell>
                                <TableCell>
                                  <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                                    <MapPin className="h-3 w-3 shrink-0" />
                                    {sites.length > 0 ? (sites.length > 1 ? sites.join(' · ') : (sites[0] as string)) : '—'}
                                  </span>
                                </TableCell>
                                <TableCell className="text-center text-xs max-w-[140px]">
                                  {statusSet.map((st) => (
                                    <Badge key={st} variant="outline" className="m-0.5">
                                      {st}
                                    </Badge>
                                  ))}
                                </TableCell>
                                <TableCell className="text-center" title="มอบหมาย / แผน — ยึดฝั่ง PO (เท่าคิว PO Active)">
                                  <span className="inline-flex items-center justify-center gap-1">
                                    <Users className="h-3.5 w-3.5" />
                                    {poAssigned}
                                    <span className="text-muted-foreground">/</span>
                                    {poPlanned}
                                  </span>
                                </TableCell>
                                <TableCell className="text-center font-semibold text-green-700">{ready}</TableCell>
                                <TableCell className="text-center text-amber-800">{notOnBoard}</TableCell>
                                <TableCell className="text-right">
                                  <div className="flex flex-col items-end gap-1 sm:flex-row sm:justify-end">
                                    <Button size="sm" className="gap-1" asChild>
                                      <Link
                                        href={`/timesheets/wave-board?poId=${encodeURIComponent(po.id)}&month=${encodeURIComponent(ym)}`}
                                      >
                                        เปิดกระดานลงเวลา
                                        <ChevronRight className="h-4 w-4" />
                                      </Link>
                                    </Button>
                                    <Button size="sm" variant="outline" className="gap-1" asChild>
                                      <Link href={`/timesheets/wave-month?month=${encodeURIComponent(ym)}`}>
                                        สรุปเดือน
                                      </Link>
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          });
                        })()}
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
