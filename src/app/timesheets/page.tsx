'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CalendarDays, ChevronRight, Info, FileText, MapPin, Users } from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, collectionGroup, query, where } from 'firebase/firestore';
import type { Assignment, POLine, PurchaseOrder, User } from '@/lib/types';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccess, canView, isMatrixControlledRole } from '@/lib/permissions';
import { assignmentReadyForWaveTimesheet } from '@/lib/constants/timesheet-ui';
import { PageGuidance } from '@/components/layout/page-guidance';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import { aggregateActiveLineTotals, buildPoFulfillmentByLine } from '@/lib/ops/po-fulfillment-read-model';
import {
  assignmentOverlapsYearMonth,
  formatPoMonthTimesheetDocLabel,
  formatThaiYearMonthLabel,
  yearMonthsForPoAssignments,
} from '@/lib/ops/timesheet-hub-po-month';
import { isAssignmentActiveOnWaveRoster, pickRosterLinePerWorker } from '@/lib/ops/assignment-roster';

function currentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function yearMonthsForPoHub(assignments: readonly Assignment[], poId: string): string[] {
  const fromMob = yearMonthsForPoAssignments(assignments, poId);
  const cur = currentYearMonth();
  const u = new Set(fromMob);
  u.add(cur);
  return [...u].sort((a, b) => a.localeCompare(b));
}

export default function TimesheetHubPage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const useMatrixGuards = isMatrixControlledRole(currentUser);
  const canViewTimesheets = useMemo(
    () => (useMatrixGuards ? canAccess(currentUser, 'timesheets', 'view') : canView(currentUser, 'timesheets')),
    [currentUser, useMatrixGuards],
  );

  const poQuery = useMemoFirebase(
    () =>
      firestore && canViewTimesheets ? query(collection(firestore, 'purchase_orders'), where('status', '==', 'active')) : null,
    [firestore, canViewTimesheets],
  );
  const { data: pos, isLoading: poLoading } = useCollection<PurchaseOrder>(poQuery as any);

  const mobQuery = useMemoFirebase(
    () => (firestore && canViewTimesheets ? collection(firestore, 'mobilizations') : null),
    [firestore, canViewTimesheets],
  );
  const { data: allMobs, isLoading: mobLoading } = useCollection<Assignment>(mobQuery as any);

  const poLinesQuery = useMemoFirebase(
    () => (firestore && canViewTimesheets ? collectionGroup(firestore, 'po_lines') : null),
    [firestore, canViewTimesheets],
  );
  const { data: allPOLines, isLoading: polinesLoading } = useCollection<POLine>(poLinesQuery as any);

  const loading = userLoading || poLoading || mobLoading || polinesLoading;

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
              <CalendarDays className="h-8 w-8 shrink-0" aria-hidden />
              ศูนย์ลงเวลา (Timesheet รายเดือน)
            </h1>
            <p className="text-muted-foreground mt-1 max-w-3xl">
              หลัง <strong>มอบหมาย</strong> และ <strong>Mobilization พร้อมแล้ว</strong> รายชื่อจะเข้ามาในงวด timesheet ตามช่วงวันที่มอบหมาย — แต่ละแถวคือ{' '}
              <strong>งวดเดือน</strong> ของเอกสาร Timesheet รายเดือน (ลงชั่วโมงรายวันจนปิดงวดสิ้นเดือน แล้วส่งผู้จัดการตรวจ → invoice ลูกค้า / payroll ตามเดิม)
            </p>
            <p className="text-sm text-muted-foreground mt-2 max-w-3xl border-l-2 border-primary/25 pl-3">
              <strong>การลงเวลา:</strong> ระบบนับเฉพาะรายมอบหมายที่ผ่านความพร้อมและสถานะ deployment ที่เปิดให้ลงเวลาได้ (สอดคล้องหน้า Mobilization) — ราย DRAFT หรือยังไม่พร้อมจะไม่ถูกนับใน “พร้อมลงเวลา”
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <Button asChild>
              <Link href="/timesheets/po-month">เอกสาร Timesheet รายเดือน</Link>
            </Button>
          </div>
        </div>

        <PageGuidance
          title="เทียบกับใบลงเวลาหน้างาน"
          tips={[
            'แต่ละวันให้ระบุประเภทวัน (ทำงาน / สแตนด์บาย / เดินทาง ฯลฯ) และชั่วโมงปกติ — ตรงแถว “ชั่วโมง” ในกระดาษ',
            'คอลัมน์ OT ไม่ต้องกรอกที่กระดานรายวัน — การคิด OT ฝั่งวางบิลลูกค้า vs ฝั่งจ่ายเงินเดือนแยกกัน ใช้ timesheet เป็นแหล่งชั่วโมงก่อน',
            'คอลัมน์ “พร้อมลงเวลา” = READINESS พร้อม และ deployment อยู่ในชุดที่ลงเวลาได้ — “ยังไม่ขึ้นกระดาน” = รายที่อยู่ในงวดแต่ยังไม่เข้าเงื่อนไขดังกล่าว',
          ]}
        />

        <Alert className="border-primary/30 bg-primary/5">
          <Info className="h-4 w-4" />
          <AlertTitle>โฟลว์สั้นๆ</AlertTitle>
          <AlertDescription className="text-sm space-y-1">
            <p>
              <strong>1.</strong> Assignment (มอบหมายตามบรรทัดคำสั่งจ้าง) → <strong>2.</strong> Mobilization (ความพร้อม / เข้างาน) →{' '}
              <strong>3.</strong> กลับมาที่นี่แล้วกด <strong>เปิดกระดานลงเวลา</strong> เพื่อลงชั่วโมงรายวันในงวด Timesheet รายเดือน → ปิดงวดและส่งตรวจจากเอกสาร Timesheet รายเดือน
            </p>
          </AlertDescription>
        </Alert>

        {loading ? (
          <p className="text-sm text-muted-foreground py-12 text-center">กำลังโหลดการมอบหมายและบรรทัดคำสั่งจ้าง…</p>
        ) : (
          <div className="space-y-8">
            {(pos ?? []).length === 0 ? (
              <p className="text-center text-muted-foreground py-12 border border-dashed rounded-lg">ไม่มีคำสั่งจ้างที่ Active</p>
            ) : (
              (pos ?? []).map((po) => {
                const lines = (allPOLines ?? []).filter((l) => l.poId === po.id);
                const fulfillment = buildPoFulfillmentByLine(lines, allMobs ?? [], [], po.id);
                const { assigned: poAssigned, required: poPlanned } = aggregateActiveLineTotals(fulfillment);
                const mobsOnPo = (allMobs ?? []).filter((m) => m.poId === po.id);
                const rosterActiveCount = pickRosterLinePerWorker(mobsOnPo).filter((m) => isAssignmentActiveOnWaveRoster(m)).length;

                const yms = yearMonthsForPoHub(allMobs ?? [], po.id);

                return (
                  <Card key={po.id} className="overflow-hidden shadow-sm">
                    <CardHeader className="border-b bg-muted/30">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <CardTitle className="text-lg flex items-center gap-2">
                            <FileText className="h-5 w-5 text-primary shrink-0" aria-hidden />
                            {po.poCode}
                          </CardTitle>
                          <CardDescription className="font-medium text-foreground/80">{po.projectName}</CardDescription>
                        </div>
                        <Badge variant="secondary" title="จำนวนรายมอบหมายที่ยังไม่จบงาน (demob/ปิด)">
                          {rosterActiveCount} มอบหมาย active
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead title="รหัสอ้างอิงงวด Timesheet รายเดือน">เลขที่ / งวด</TableHead>
                            <TableHead className="whitespace-nowrap" title="รอบปฏิทินของงวด timesheet">
                              รอบเดือน
                            </TableHead>
                            <TableHead>สถานที่</TableHead>
                            <TableHead className="text-center">สถานะ deployment</TableHead>
                            <TableHead className="text-center">มอบหมาย / โควต้า</TableHead>
                            <TableHead
                              className="text-center max-w-[120px]"
                              title="READINESS พร้อม + deployment เปิดให้ลงเวลา (สอดคล้อง Mobilization)"
                            >
                              พร้อมลงเวลา
                            </TableHead>
                            <TableHead className="text-center max-w-[120px]" title="อยู่ในงวดแต่ยังไม่เข้าเงื่อนไขลงเวลา">
                              ยังไม่ขึ้นกระดาน
                            </TableHead>
                            <TableHead className="text-right pr-4">ลงเวลา / สรุป</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {yms.map((ym) => {
                            const inMonth = mobsOnPo.filter((a) => assignmentOverlapsYearMonth(a, ym));
                            const roster = pickRosterLinePerWorker(inMonth);
                            const activeInMonth = roster.filter((m) => isAssignmentActiveOnWaveRoster(m));
                            const ready = activeInMonth.filter((m) => assignmentReadyForWaveTimesheet(m)).length;
                            const notOnBoard = activeInMonth.filter((m) => !assignmentReadyForWaveTimesheet(m)).length;
                            const sites = [
                              ...new Set(
                                activeInMonth
                                  .map((m) => (m.workLocation || '').trim())
                                  .filter(Boolean),
                              ),
                            ];
                            const statusSet = [...new Set(activeInMonth.map((m) => m.deploymentStatus))];

                            return (
                              <TableRow key={`${po.id}-${ym}`}>
                                <TableCell className="font-mono text-sm">
                                  <span className="flex items-center gap-1 font-semibold">
                                    <CalendarDays className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden />
                                    {formatPoMonthTimesheetDocLabel(po, ym)}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground block">
                                    {activeInMonth.length} รายในงวด · จากช่วงวันที่มอบหมาย
                                  </span>
                                </TableCell>
                                <TableCell className="text-sm font-semibold text-primary whitespace-nowrap">
                                  {formatThaiYearMonthLabel(ym, 'th-TH')}
                                </TableCell>
                                <TableCell>
                                  <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                                    <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                                    {sites.length > 0 ? (sites.length > 1 ? sites.join(' · ') : sites[0]) : '—'}
                                  </span>
                                </TableCell>
                                <TableCell className="text-center text-xs max-w-[140px]">
                                  {statusSet.length === 0 ? (
                                    <span className="text-muted-foreground">—</span>
                                  ) : (
                                    statusSet.map((st) => (
                                      <Badge key={st} variant="outline" className="m-0.5">
                                        {st}
                                      </Badge>
                                    ))
                                  )}
                                </TableCell>
                                <TableCell className="text-center" title="จำนวนมอบหมายที่นับโควต้า / โควต้าบรรทัดคำสั่งจ้าง (สายสัญญา)">
                                  <span className="inline-flex items-center justify-center gap-1">
                                    <Users className="h-3.5 w-3.5 shrink-0" aria-hidden />
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
                                        <ChevronRight className="h-4 w-4" aria-hidden />
                                      </Link>
                                    </Button>
                                    <Button size="sm" variant="outline" className="gap-1" asChild>
                                      <Link
                                        href={`/timesheets/po-month?month=${encodeURIComponent(ym)}&highlightPo=${encodeURIComponent(po.id)}`}
                                      >
                                        ปิดงวด / เอกสาร Timesheet
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
              })
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
