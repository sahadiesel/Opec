'use client';

import { Suspense, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CalendarDays, ChevronRight, Info, FileText, MapPin, Users, Layers } from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, collectionGroup, query, where } from 'firebase/firestore';
import type { Assignment, Customer, JobMode, MainContract, POLine, PurchaseOrder, User, Wave } from '@/lib/types';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccess, canView, isMatrixControlledRole } from '@/lib/permissions';
import { assignmentReadyForWaveTimesheet } from '@/lib/constants/timesheet-ui';
import { PageGuidance } from '@/components/layout/page-guidance';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import { aggregateActiveLineTotals, buildPoFulfillmentByLine } from '@/lib/ops/po-fulfillment-read-model';
import {
  assignmentOverlapsYearMonth,
  formatBundleMonthTimesheetDocLabel,
  formatPoMonthTimesheetDocLabel,
  formatThaiYearMonthLabel,
  yearMonthsForBundleAssignments,
  yearMonthsForPoAssignments,
} from '@/lib/ops/timesheet-hub-po-month';
import { isAssignmentActiveOnWaveRoster, pickRosterLinePerWorker } from '@/lib/ops/assignment-roster';
import { buildPoActiveBundleRows } from '@/components/ops/po-quota-queue';

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

function workModeBadgeLabel(mode: JobMode | undefined): string {
  if (mode === 'ONSHORE') return 'Onshore';
  if (mode === 'OFFSHORE') return 'Offshore';
  return 'Offshore';
}

function TimesheetHubContent() {
  const searchParams = useSearchParams();
  const showAllLegacy = searchParams.get('all') === '1';

  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const useMatrixGuards = isMatrixControlledRole(currentUser);
  const canViewTimesheets = useMemo(
    () => (useMatrixGuards ? canAccess(currentUser, 'timesheets', 'view') : canView(currentUser, 'timesheets')),
    [currentUser, useMatrixGuards],
  );

  const contractsQuery = useMemoFirebase(() => {
    if (!firestore || !canViewTimesheets || showAllLegacy) return null;
    return query(collection(firestore, 'main_contracts'), where('status', '==', 'active'));
  }, [firestore, canViewTimesheets, showAllLegacy]);

  const { data: activeContracts, isLoading: contractsLoading } = useCollection<MainContract>(contractsQuery as any);

  const customersQuery = useMemoFirebase(() => {
    if (!firestore || !canViewTimesheets || showAllLegacy) return null;
    return collection(firestore, 'customers');
  }, [firestore, canViewTimesheets, showAllLegacy]);

  const { data: customers, isLoading: customersLoading } = useCollection<Customer>(customersQuery as any);

  const wavesQuery = useMemoFirebase(() => {
    if (!firestore || !canViewTimesheets || showAllLegacy) return null;
    return collection(firestore, 'waves');
  }, [firestore, canViewTimesheets, showAllLegacy]);

  const { data: allWaves, isLoading: wavesLoading } = useCollection<Wave>(wavesQuery as any);

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

  const landingMainContractIdSet = useMemo(
    () => new Set((activeContracts ?? []).map((c) => c.id).filter(Boolean)),
    [activeContracts],
  );

  const bundleRows = useMemo(
    () =>
      buildPoActiveBundleRows(
        pos ?? undefined,
        allPOLines ?? undefined,
        allMobs ?? undefined,
        allWaves ?? undefined,
        landingMainContractIdSet,
        !contractsLoading,
        'timesheet-hub',
      ),
    [pos, allPOLines, allMobs, allWaves, landingMainContractIdSet, contractsLoading],
  );

  const loadingLegacy = userLoading || poLoading || mobLoading || polinesLoading;
  const loadingBundle = loadingLegacy || contractsLoading || customersLoading || wavesLoading;

  if (userLoading || !currentUser) return null;
  if (!canViewTimesheets) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-5xl mx-auto py-10 text-center text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงเมนูนี้</div>
      </AppShell>
    );
  }

  const loading = showAllLegacy ? loadingLegacy : loadingBundle;

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
              {showAllLegacy ? (
                <>
                  โหมด <strong>ราย PO</strong> — แต่ละการ์ดคือใบคำสั่งจ้าง active · ใช้เมื่อต้องการดูแยกทีละใบ
                </>
              ) : (
                <>
                  จัดกลุ่มตาม <strong>ชุด PO Active</strong> (ลูกค้า + Onshore/Offshore) — งวดลงเวลารวมหลายใบในชุดเดียว ·{' '}
                  <Link href="/po-active-quota-queue" className="text-primary font-semibold underline">
                    คิวโควต้า
                  </Link>{' '}
                  /{' '}
                  <Link href="/assignments" className="text-primary font-semibold underline">
                    มอบหมาย
                  </Link>
                </>
              )}
            </p>
            <p className="text-sm text-muted-foreground mt-2 max-w-3xl border-l-2 border-primary/25 pl-3">
              <strong>การลงเวลา:</strong> ระบบนับเฉพาะรายมอบหมายที่ผ่านความพร้อมและสถานะ deployment ที่เปิดให้ลงเวลาได้ (สอดคล้องหน้า
              Mobilization) — ราย DRAFT หรือยังไม่พร้อมจะไม่ถูกนับใน “พร้อมลงเวลา”
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            {!showAllLegacy ? (
              <Button variant="outline" asChild>
                <Link href="/timesheets?all=1">โหมดแสดงทั้งหมดตาม PO</Link>
              </Button>
            ) : (
              <Button variant="outline" asChild>
                <Link href="/timesheets">กลับโหมดชุด PO Active</Link>
              </Button>
            )}
            <Button asChild>
              <Link href="/timesheets/po-month">เอกสาร Timesheet รายเดือน</Link>
            </Button>
          </div>
        </div>

        <PageGuidance
          title="เทียบกับใบลงเวลาหน้างาน"
          tips={
            showAllLegacy
              ? [
                  'แต่ละวันให้ระบุประเภทวัน (ทำงาน / สแตนด์บาย / เดินทาง ฯลฯ) และชั่วโมงปกติ — ตรงแถว “ชั่วโมง” ในกระดาษ',
                  'คอลัมน์ OT ไม่ต้องกรอกที่กระดานรายวัน — การคิด OT ฝั่งวางบิลลูกค้า vs ฝั่งจ่ายเงินเดือนแยกกัน',
                  'คอลัมน์ “พร้อมลงเวลา” = READINESS พร้อม และ deployment อยู่ในชุดที่ลงเวลาได้',
                ]
              : [
                  'เลือกชุด PO Active แล้วเปิดกระดาน — ระบบโหลดทุก PO ในชุดที่เกี่ยวข้องกับ wave/assignment',
                  'ปิดงวดและแนบเอกสารทำจากลิงก์ “ปิดงวด” ซึ่งจะกรองรายการในชุดเดียวกัน',
                  'โควต้าในตารางเป็นการรวมบรรทัดคำสั่งจ้างของทุก PO ในชุด',
                ]
          }
        />

        <Alert className="border-primary/30 bg-primary/5">
          <Info className="h-4 w-4" />
          <AlertTitle>โฟลว์สั้นๆ</AlertTitle>
          <AlertDescription className="text-sm space-y-1">
            <p>
              <strong>1.</strong> Assignment → <strong>2.</strong> Mobilization → <strong>3.</strong>{' '}
              <strong>เปิดกระดานลงเวลา</strong> ในงวดเดือน → ปิดงวดจากเอกสาร Timesheet รายเดือน
            </p>
          </AlertDescription>
        </Alert>

        {loading ? (
          <p className="text-sm text-muted-foreground py-12 text-center">กำลังโหลดการมอบหมายและบรรทัดคำสั่งจ้าง…</p>
        ) : showAllLegacy ? (
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
        ) : bundleRows.length === 0 ? (
          <p className="text-center text-muted-foreground py-12 border border-dashed rounded-lg">
            ไม่พบชุด PO Active ที่มีบรรทัดโควต้าใต้สัญญาหลัก active — ตรวจ Customer PO /{' '}
            <Link href="/po-active-quota-queue" className="text-primary underline font-medium">
              คิวเติมโควต้า
            </Link>
          </p>
        ) : (
          <div className="space-y-8">
            {bundleRows.map((row) => {
              const poIds = row.pos.map((p) => p.id);
              const poCodes = row.pos.map((p) => p.poCode);
              const mobsOnBundle = (allMobs ?? []).filter((m) => poIds.includes(m.poId));
              const rosterActiveCount = pickRosterLinePerWorker(mobsOnBundle).filter((m) => isAssignmentActiveOnWaveRoster(m)).length;
              const yms = yearMonthsForBundleAssignments(allMobs ?? [], poIds, currentYearMonth());
              const cust = customers?.find((c) => c.id === row.customerId);
              const bundleHrefBoard = (ym: string) =>
                `/timesheets/wave-board?poActiveBundleId=${encodeURIComponent(row.bundleKey)}&month=${encodeURIComponent(ym)}`;
              const bundleHrefPoMonth = (ym: string) =>
                `/timesheets/po-month?month=${encodeURIComponent(ym)}&poActiveBundleId=${encodeURIComponent(row.bundleKey)}`;

              return (
                <Card key={row.bundleKey} className="overflow-hidden shadow-sm border-primary/15">
                  <CardHeader className="border-b bg-muted/30">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-1 min-w-0">
                        <CardTitle className="text-lg flex flex-wrap items-center gap-2">
                          <Layers className="h-5 w-5 text-primary shrink-0" aria-hidden />
                          <span className="truncate">{(cust?.name ?? row.customerId) || '—'}</span>
                          <Badge variant="outline" className="text-[10px] font-semibold shrink-0">
                            {workModeBadgeLabel(row.workMode)}
                          </Badge>
                        </CardTitle>
                        <CardDescription className="text-xs font-mono text-muted-foreground">
                          PO ในชุด: {poCodes.join(', ')}
                        </CardDescription>
                        <Button variant="link" className="h-auto p-0 text-xs text-primary" asChild>
                          <Link href={`/po-active/${encodeURIComponent(row.bundleKey)}`}>เปิดเอกสาร PO Active →</Link>
                        </Button>
                      </div>
                      <Badge variant="secondary" title="จำนวนรายมอบหมายที่ยังไม่จบงานในชุดนี้">
                        {rosterActiveCount} มอบหมาย active
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>เลขที่ / งวด</TableHead>
                          <TableHead className="whitespace-nowrap">รอบเดือน</TableHead>
                          <TableHead>สถานที่</TableHead>
                          <TableHead className="text-center">สถานะ deployment</TableHead>
                          <TableHead className="text-center">มอบหมาย / โควต้า (รวมชุด)</TableHead>
                          <TableHead className="text-center max-w-[120px]">พร้อมลงเวลา</TableHead>
                          <TableHead className="text-center max-w-[120px]">ยังไม่ขึ้นกระดาน</TableHead>
                          <TableHead className="text-right pr-4">ลงเวลา / สรุป</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {yms.map((ym) => {
                          const inMonth = mobsOnBundle.filter((a) => assignmentOverlapsYearMonth(a, ym));
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
                            <TableRow key={`${row.bundleKey}-${ym}`}>
                              <TableCell className="font-mono text-sm">
                                <span className="flex items-center gap-1 font-semibold">
                                  <CalendarDays className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden />
                                  {formatBundleMonthTimesheetDocLabel(poCodes, ym)}
                                </span>
                                <span className="text-[10px] text-muted-foreground block">
                                  {activeInMonth.length} รายในงวด (ทุก PO ในชุด)
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
                              <TableCell className="text-center">
                                <span className="inline-flex items-center justify-center gap-1">
                                  <Users className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                  {row.totals.assigned}
                                  <span className="text-muted-foreground">/</span>
                                  {row.totals.required}
                                </span>
                              </TableCell>
                              <TableCell className="text-center font-semibold text-green-700">{ready}</TableCell>
                              <TableCell className="text-center text-amber-800">{notOnBoard}</TableCell>
                              <TableCell className="text-right">
                                <div className="flex flex-col items-end gap-1 sm:flex-row sm:justify-end">
                                  <Button size="sm" className="gap-1" asChild>
                                    <Link href={bundleHrefBoard(ym)}>
                                      เปิดกระดานลงเวลา
                                      <ChevronRight className="h-4 w-4" aria-hidden />
                                    </Link>
                                  </Button>
                                  <Button size="sm" variant="outline" className="gap-1" asChild>
                                    <Link href={bundleHrefPoMonth(ym)}>ปิดงวด / เอกสาร Timesheet</Link>
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
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default function TimesheetHubPage() {
  return (
    <Suspense
      fallback={<div className="flex min-h-[40vh] items-center justify-center text-muted-foreground text-sm">กำลังโหลด…</div>}
    >
      <TimesheetHubContent />
    </Suspense>
  );
}
