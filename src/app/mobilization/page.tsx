'use client';

import { useState, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Truck,
  Search,
  Filter,
  ChevronRight,
  ClipboardCheck,
  ShieldAlert,
  Info,
  HardHat,
  Calendar,
  Briefcase,
  Loader2,
  Pencil,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Assignment,
  Worker,
  Position,
  Wave,
  PurchaseOrder,
  DeploymentStatus,
  Customer,
  MainContract,
} from '@/lib/types';
import { MOBILIZATION_QUEUE_DEPLOYMENT_STATUSES } from '@/lib/store/mobilization-fulfillment';
import { Badge } from '@/components/ui/badge';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccess, canView, isMatrixControlledRole } from '@/lib/permissions';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { PoFilterContextBanner } from '@/components/ops/po-filter-context-banner';
import { normalizePoActiveBundleId, resolvePoActiveBundleKeyForPo } from '@/lib/ops/po-active-bundle';
import { isPoTimesheetScopeId } from '@/lib/constants/timesheet-po-scope';
import { compareAssignmentWorkerNamesTh } from '@/lib/ops/mobilization-worker-name';
import { assignmentHasUnassignedAtSet } from '@/lib/ops/po-fulfillment-read-model';
import { pickRosterLinePerWorker } from '@/lib/ops/assignment-roster';
import {
  buildEligibleMainContractIdSet,
  filterPurchaseOrdersForPoActiveWorkflow,
  isContractPurchaseOrderEligibleForPoActiveBundle,
  PO_ACTIVE_MAIN_CONTRACT_STATUS_IN,
} from '@/lib/ops/po-active-eligibility';
import { buildPoActiveBundleRows, PoAssignmentBundleLandingPanel } from '@/components/ops/po-quota-queue';
import { usePoLinesFanout } from '@/lib/ops/use-po-lines-fanout';
import { formatYmdLocalThaiBE } from '@/lib/date-thai';

function MobilizationPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const useMatrixGuards = isMatrixControlledRole(currentUser);
  const canViewMobilization = useMatrixGuards
    ? canAccess(currentUser, 'mobilization', 'view')
    : canView(currentUser, 'mobilization');

  const isAuthorized = useMemo(() => canViewMobilization, [canViewMobilization]);

  const filterPoId = (searchParams.get('poId') || '').trim() || null;
  const filterPoActiveBundleIdRaw = (searchParams.get('poActiveBundleId') || '').trim() || null;
  const filterPoActiveBundleId = filterPoActiveBundleIdRaw
    ? normalizePoActiveBundleId(filterPoActiveBundleIdRaw)
    : null;
  /** โหมดเดิม: แสดงคิวทั้งระบบโดยไม่บังคับเลือกชุดก่อน */
  const showAllLegacy = searchParams.get('all') === '1';

  const showBundleLanding =
    isAuthorized && !filterPoId && !filterPoActiveBundleId && !showAllLegacy;

  const mobilizationQuery = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return collection(firestore, 'mobilizations');
  }, [firestore, isAuthorized]);

  const { data: assignments, isLoading: isAssignmentsLoading } = useCollection<Assignment>(
    mobilizationQuery as any,
  );

  const workersQuery = useMemoFirebase(
    () => (firestore && isAuthorized ? collection(firestore, 'workers') : null),
    [firestore, isAuthorized],
  );
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  const positionsQuery = useMemoFirebase(
    () => (firestore && isAuthorized ? collection(firestore, 'positions') : null),
    [firestore, isAuthorized],
  );
  const { data: allPositions } = useCollection<Position>(positionsQuery as any);

  const wavesQuery = useMemoFirebase(
    () => (firestore && isAuthorized ? collection(firestore, 'waves') : null),
    [firestore, isAuthorized],
  );
  const { data: allWaves } = useCollection<Wave>(wavesQuery as any);

  const poQuery = useMemoFirebase(
    () => (firestore && isAuthorized ? collection(firestore, 'purchase_orders') : null),
    [firestore, isAuthorized],
  );
  const { data: allPOs } = useCollection<PurchaseOrder>(poQuery as any);

  const customersQuery = useMemoFirebase(
    () => (firestore && isAuthorized ? collection(firestore, 'customers') : null),
    [firestore, isAuthorized],
  );
  const { data: allCustomers } = useCollection<Customer>(customersQuery as any);

  const activeContractsQuery = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return query(
      collection(firestore, 'main_contracts'),
      where('status', 'in', [...PO_ACTIVE_MAIN_CONTRACT_STATUS_IN]),
    );
  }, [firestore, isAuthorized]);

  const { data: activeContractsForWorkflow, isLoading: activeContractsLoading } =
    useCollection<MainContract>(activeContractsQuery as any);

  const workflowMainContractIdSet = useMemo(
    () => buildEligibleMainContractIdSet(activeContractsForWorkflow),
    [activeContractsForWorkflow],
  );

  const activePOsForLanding = useMemo(
    () => filterPurchaseOrdersForPoActiveWorkflow(allPOs),
    [allPOs],
  );

  const { data: allPOLines, isLoading: isPOLinesLoading } = usePoLinesFanout(
    showBundleLanding ? activePOsForLanding.map((p) => p.id) : null,
  );

  const landingRows = useMemo(
    () =>
      buildPoActiveBundleRows(
        activePOsForLanding,
        allPOLines ?? undefined,
        assignments ?? undefined,
        allWaves ?? undefined,
        workflowMainContractIdSet,
        activeContractsForWorkflow !== undefined && !activeContractsLoading,
        'assignment-landing',
      ),
    [
      activePOsForLanding,
      allPOLines,
      assignments,
      allWaves,
      workflowMainContractIdSet,
      activeContractsForWorkflow,
      activeContractsLoading,
    ],
  );

  const landingLoading =
    showBundleLanding &&
    (activeContractsLoading || isAssignmentsLoading || isPOLinesLoading || !allCustomers);

  const contractActivePOs = useMemo(() => {
    if (activeContractsLoading || !activeContractsForWorkflow) return [];
    return (allPOs ?? []).filter((po) =>
      isContractPurchaseOrderEligibleForPoActiveBundle(po, workflowMainContractIdSet),
    );
  }, [allPOs, activeContractsForWorkflow, activeContractsLoading, workflowMainContractIdSet]);

  const contractActivePOsForScope = useMemo(() => {
    if (!filterPoActiveBundleId) return contractActivePOs;
    return contractActivePOs.filter((p) => resolvePoActiveBundleKeyForPo(p) === filterPoActiveBundleId);
  }, [contractActivePOs, filterPoActiveBundleId]);

  const filterPO = useMemo(
    () => (filterPoId && allPOs?.length ? allPOs.find((p) => p.id === filterPoId) : undefined),
    [filterPoId, allPOs],
  );

  const [mobTableSearch, setMobTableSearch] = useState('');

  /**
   * รายชื่อในชุดที่เลือก — เหมือนหน้า Assign: คนที่ยังมอบหมายอยู่ทั้งหมด (รวม ACTIVE)
   * โหมด all / poId เดี่ยว: คิว Waiting MOB แบบเดิม
   */
  const displayedMobilization = useMemo(() => {
    if (!assignments) return [];
    let list = assignments.filter((a) => !assignmentHasUnassignedAtSet(a));

    if (filterPoActiveBundleId) {
      const idSet = new Set(contractActivePOsForScope.map((p) => p.id));
      list = list.filter((a) => {
        if (idSet.has(a.poId)) return true;
        const poRow = allPOs?.find((p) => p.id === a.poId);
        const key = a.poActiveBundleId
          ? normalizePoActiveBundleId(a.poActiveBundleId)
          : poRow
            ? normalizePoActiveBundleId(resolvePoActiveBundleKeyForPo(poRow))
            : '';
        return key === filterPoActiveBundleId;
      });
      list = pickRosterLinePerWorker(list);
    } else if (filterPoId) {
      list = list.filter(
        (a) =>
          a.poId === filterPoId &&
          MOBILIZATION_QUEUE_DEPLOYMENT_STATUSES.includes(a.deploymentStatus as DeploymentStatus),
      );
    } else if (showAllLegacy) {
      list = list.filter((a) =>
        MOBILIZATION_QUEUE_DEPLOYMENT_STATUSES.includes(a.deploymentStatus as DeploymentStatus),
      );
    } else {
      list = [];
    }

    const q = mobTableSearch.trim().toLowerCase();
    const filtered = !q
      ? list
      : list.filter((a) => {
          const worker = allWorkers?.find((w) => w.id === a.workerId);
          const wave = allWaves?.find((w) => w.id === a.waveId);
          const poRow = allPOs?.find((p) => p.id === a.poId);
          const cust = poRow ? allCustomers?.find((c) => c.id === poRow.customerId) : undefined;
          const bundleKey = a.poActiveBundleId
            ? normalizePoActiveBundleId(a.poActiveBundleId)
            : poRow
              ? normalizePoActiveBundleId(resolvePoActiveBundleKeyForPo(poRow))
              : '';
          const name = `${worker?.firstName || ''} ${worker?.lastName || ''}`.toLowerCase();
          return (
            name.includes(q) ||
            (a.projectName || '').toLowerCase().includes(q) ||
            (wave?.waveCode || '').toLowerCase().includes(q) ||
            (poRow?.poCode || '').toLowerCase().includes(q) ||
            bundleKey.toLowerCase().includes(q) ||
            (cust?.name || '').toLowerCase().includes(q) ||
            (a.assignmentNo || '').toLowerCase().includes(q)
          );
        });
    return [...filtered].sort((a, b) => compareAssignmentWorkerNamesTh(a, b, allWorkers));
  }, [
    assignments,
    filterPoId,
    filterPoActiveBundleId,
    contractActivePOsForScope,
    showAllLegacy,
    mobTableSearch,
    allWorkers,
    allWaves,
    allPOs,
    allCustomers,
  ]);

  if (isUserLoading || userLoading || !currentUser) return null;

  const getReadinessBadge = (asgn: Assignment) => {
    const status = asgn.readinessStatus;
    if (status === 'ready') return <Badge className="bg-green-600">READY</Badge>;
    return (
      <Badge variant="outline" className="text-amber-600 border-amber-200 bg-amber-50">
        PARTIAL
      </Badge>
    );
  };

  const getDeploymentStatusBadge = (status: DeploymentStatus | string | undefined) => {
    switch (status) {
      case 'DRAFT':
        return (
          <Badge variant="outline" className="bg-sky-50 text-sky-900 border-sky-200 font-bold">
            Waiting MOB
          </Badge>
        );
      case 'READINESS_CHECK':
        return (
          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 uppercase font-bold">
            READINESS
          </Badge>
        );
      case 'CLIENT_SUBMITTED':
        return (
          <Badge variant="outline" className="bg-blue-50 text-blue-800 border-blue-200 uppercase font-bold">
            CLIENT SUBMITTED
          </Badge>
        );
      case 'CLIENT_APPROVED':
        return (
          <Badge variant="outline" className="bg-emerald-50 text-emerald-800 border-emerald-200 uppercase font-bold">
            CLIENT APPROVED
          </Badge>
        );
      case 'CONFIRMED':
        return (
          <Badge variant="outline" className="bg-violet-50 text-violet-800 border-violet-200 uppercase font-bold">
            CONFIRMED
          </Badge>
        );
      case 'READY_TO_MOB':
        return <Badge className="bg-blue-600 uppercase font-bold">READY TO MOB</Badge>;
      case 'MOBILIZING':
        return (
          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 uppercase font-bold">
            MOBILIZING
          </Badge>
        );
      case 'ACTIVE':
        return <Badge className="bg-green-600 uppercase font-bold">Active Duty</Badge>;
      case 'DEMOBILIZED':
        return (
          <Badge variant="outline" className="bg-sky-50 text-sky-900 border-sky-200 font-bold">
            DMOB · Waiting MOB
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status || '—'}</Badge>;
    }
  };

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        {!showBundleLanding ? (
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
              <Truck className="h-8 w-8" /> การเตรียมความพร้อม (Mobilization Management)
            </h1>
            <p className="text-muted-foreground text-lg">
              ตรวจสอบความพร้อมขั้นสุดท้ายก่อนส่งคนลงงาน · วัน Pre-Mob / Mob / เริ่มงานตั้งในหน้ารายละเอียดแต่ละคน
              {showAllLegacy ? (
                <span className="block mt-2 text-sm">
                  กำลังใช้ <b>โหมดแสดงทั้งหมด</b> (คิว Waiting MOB) —{' '}
                  <Link href="/mobilization" className="font-semibold text-primary underline">
                    กลับไปเลือกชุด PO Active
                  </Link>
                </span>
              ) : null}
            </p>
          </div>
        ) : null}

        {!isAuthorized ? (
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
            <ShieldAlert className="h-12 w-12 text-muted-foreground opacity-50" />
            <h2 className="text-xl font-bold">Access Pending (รอนุมัติสิทธิ์)</h2>
            <p className="text-muted-foreground max-w-md">
              บัญชีของคุณยังไม่ได้รับการกำหนดบทบาท กรุณาติดต่อผู้ดูแลระบบเพื่อเปิดสิทธิ์เข้าถึงโมดูล Mobilization
            </p>
          </div>
        ) : showBundleLanding ? (
          <>
            <div className="flex flex-col gap-2">
              <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
                <Truck className="h-8 w-8" /> การเตรียมความพร้อม — เลือกชุด PO Active
              </h1>
              <p className="text-muted-foreground text-lg max-w-3xl">
                เลือก <b>หนึ่งชุด</b> (ลูกค้า + Onshore/Offshore) ก่อน — จากนั้นดูรายชื่อคนทั้งหมดในชุดและเปิดหน้า Mobilization ของแต่ละคน
              </p>
              <p className="text-sm text-muted-foreground">
                ต้องการมุมมองคิว Waiting MOB ทั้งระบบแบบเดิม?{' '}
                <Link href="/mobilization?all=1" className="font-semibold text-primary underline">
                  เปิดโหมดแสดงทั้งหมด
                </Link>
              </p>
            </div>
            <PoAssignmentBundleLandingPanel
              rows={landingRows}
              customers={allCustomers ?? undefined}
              assignments={assignments ?? undefined}
              loading={landingLoading}
              listBasePath="/mobilization"
              mode="mobilization"
            />
          </>
        ) : (
          <>
            <Alert variant="destructive" className="bg-destructive/5 border-destructive/20 shadow-sm">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              <AlertTitle className="font-bold text-lg">มาตรการความปลอดภัยหน้างาน (Pre-deployment Safety Policy)</AlertTitle>
              <AlertDescription className="text-sm">
                ห้ามยืนยัน Mobilization หากยังมีรายการ readiness ไม่ครบ หรือใบรับรองแพทย์หมดอายุ เจ้าหน้าที่ Operations
                ต้องตรวจสอบหลักฐานตัวจริงทุกครั้ง
                {filterPoActiveBundleId ? (
                  <span className="block mt-2">
                    ตารางนี้แสดงคนที่ยังมอบหมายอยู่ในชุด PO Active นี้ <b>1 แถวต่อคน</b> รวม Waiting MOB และ Active Duty —
                    กดแถวหรือปุ่มแก้ไขเพื่อเปิด Final clearance
                  </span>
                ) : null}
              </AlertDescription>
            </Alert>

            <PoFilterContextBanner
              poId={filterPoId}
              po={filterPO}
              poActiveBundleId={filterPoActiveBundleId}
              bundlePoCodes={contractActivePOsForScope.map((p) => p.poCode)}
              listBasePath="/mobilization"
              moduleLabel="Mobilization"
            />

            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
              <div className="flex items-center gap-3 flex-1">
                <div className="relative w-full max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="ค้นหาคนงาน, PO, ชุด PO Active, ลูกค้า หรือโครงการ..."
                    className="pl-9 h-11"
                    value={mobTableSearch}
                    onChange={(e) => setMobTableSearch(e.target.value)}
                  />
                </div>
                <Button variant="outline" className="gap-2 h-11">
                  <Filter className="h-4 w-4" /> ตัวกรอง
                </Button>
              </div>
              <div className="flex gap-2">
                <Badge
                  variant="outline"
                  className="px-4 h-11 flex items-center gap-2 border-primary/20 bg-primary/5 text-primary font-bold"
                >
                  <HardHat className="h-4 w-4" /> แสดงในตาราง: {displayedMobilization.length} ราย
                </Badge>
              </div>
            </div>

            <Card className="shadow-lg border-none overflow-hidden">
              <CardContent className="p-0">
                {isAssignmentsLoading ? (
                  <div className="py-20 text-center text-muted-foreground italic animate-pulse">
                    กำลังโหลดข้อมูลการระดมพล...
                  </div>
                ) : (
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="font-bold py-4 pl-6">รหัส / คนงาน & ตำแหน่ง</TableHead>
                        <TableHead className="font-bold">PO · ชุด PO Active · โครงการ</TableHead>
                        <TableHead className="font-bold">วันที่มอบหมาย</TableHead>
                        <TableHead className="font-bold text-center">Compliance (ความพร้อม)</TableHead>
                        <TableHead className="font-bold">สถานะ Mobilization</TableHead>
                        <TableHead className="text-right pr-6">ดำเนินการ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {displayedMobilization.map((asgn) => {
                        const worker = allWorkers?.find((w) => w.id === asgn.workerId);
                        const pos = allPositions?.find((p) => p.id === asgn.positionId);
                        const wave = allWaves?.find((w) => w.id === asgn.waveId);
                        const poRow = allPOs?.find((p) => p.id === asgn.poId);
                        const cust = poRow
                          ? allCustomers?.find((c) => c.id === poRow.customerId)
                          : undefined;
                        const bundleKey = asgn.poActiveBundleId
                          ? normalizePoActiveBundleId(asgn.poActiveBundleId)
                          : poRow
                            ? normalizePoActiveBundleId(resolvePoActiveBundleKeyForPo(poRow))
                            : '—';
                        const assignYmd = (asgn.assignedDate || asgn.startDate || '').trim().slice(0, 10);

                        return (
                          <TableRow
                            key={asgn.id}
                            className="cursor-pointer hover:bg-muted/30 group transition-all"
                            onClick={() => router.push(`/mobilization/${asgn.id}`)}
                          >
                            <TableCell className="py-4 pl-6">
                              <div className="flex flex-col">
                                <span className="text-[10px] font-mono font-bold text-primary mb-1">
                                  {asgn.assignmentNo || asgn.id.substring(0, 8)}
                                </span>
                                <span className="font-bold text-base text-primary">
                                  {worker?.firstName} {worker?.lastName}
                                </span>
                                <span className="text-xs text-muted-foreground flex items-center gap-1 font-medium">
                                  <Briefcase className="h-3 w-3" />{' '}
                                  {pos?.positionName || pos?.positionNameTh}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-0.5 max-w-[280px]">
                                <span className="font-mono text-[11px] font-bold text-primary">
                                  {poRow?.poCode || '—'}
                                </span>
                                <span className="text-[10px] text-muted-foreground line-clamp-2" title={bundleKey}>
                                  ชุด: {bundleKey}
                                </span>
                                {cust?.name ? (
                                  <span className="text-[10px] font-medium text-foreground/80">{cust.name}</span>
                                ) : null}
                                <span className="text-[10px] text-muted-foreground truncate">{asgn.projectName}</span>
                                {asgn.waveId && !isPoTimesheetScopeId(asgn.waveId) && wave?.waveCode ? (
                                  <span className="text-[9px] text-amber-800/90">
                                    Wave (legacy): {wave.waveCode}
                                  </span>
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-bold">
                                <Calendar className="h-3.5 w-3.5" />
                                {/^\d{4}-\d{2}-\d{2}$/.test(assignYmd)
                                  ? formatYmdLocalThaiBE(assignYmd)
                                  : asgn.mobilizationDate || wave?.mobilizationDate || 'TBA'}
                              </div>
                            </TableCell>
                            <TableCell className="text-center">
                              <div className="flex flex-col items-center gap-1">
                                {getReadinessBadge(asgn)}
                                <div className="flex gap-1">
                                  <div
                                    className={`h-1 w-4 rounded-full ${asgn.readinessSummary?.medicalValid === 'pass' ? 'bg-green-500' : 'bg-slate-200'}`}
                                    title="Medical"
                                  />
                                  <div
                                    className={`h-1 w-4 rounded-full ${asgn.readinessSummary?.certificatesComplete === 'pass' ? 'bg-green-500' : 'bg-slate-200'}`}
                                    title="Certs"
                                  />
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>{getDeploymentStatusBadge(asgn.deploymentStatus)}</TableCell>
                            <TableCell className="text-right pr-6">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="outline"
                                  size="icon"
                                  className="h-9 w-9"
                                  title="เปิดหน้า Mobilization"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    router.push(`/mobilization/${asgn.id}`);
                                  }}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="sm" className="gap-2 group-hover:text-primary">
                                  <ClipboardCheck className="h-4 w-4" /> ตรวจสอบ{' '}
                                  <ChevronRight className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {!isAssignmentsLoading && displayedMobilization.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-20 text-muted-foreground text-sm">
                            {filterPoActiveBundleId ? (
                              <span>
                                ยังไม่มีคนในชุด PO Active นี้ — มอบหมายที่เมนู{' '}
                                <Link
                                  href={`/assignments?poActiveBundleId=${encodeURIComponent(filterPoActiveBundleId)}`}
                                  className="font-semibold text-primary underline"
                                >
                                  Assignments
                                </Link>
                              </span>
                            ) : (
                              <span className="italic">
                                ยังไม่มีรายการเตรียมความพร้อมในขณะนี้ — หลังมอบหมายหรือหลังกดจบงานจาก Wave Board
                                รายการจะปรากฏที่นี่
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card className="bg-primary/5 border-primary/10 border-dashed">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2 text-primary font-bold">
                  <Info className="h-5 w-5" /> แนวทางปฏิบัติ (Mobilization Workflow)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div className="flex items-start gap-3 p-4 bg-white rounded-md border shadow-sm">
                    <div className="bg-amber-100 p-2 rounded text-amber-700 font-bold">1</div>
                    <div>
                      <p className="font-bold">ขั้นตอนที่ 1: ตรวจความสมบูรณ์ (Verify Compliance)</p>
                      <p className="text-muted-foreground text-xs">
                        หาก PPE หรือเครื่องมือยังไม่ครบ ให้ไปที่ คลังอุปกรณ์ (Store / Inventory) เพื่อดำเนินการเบิกจ่าย
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-4 bg-white rounded-md border shadow-sm">
                    <div className="bg-green-100 p-2 rounded text-green-700 font-bold">2</div>
                    <div>
                      <p className="font-bold">ขั้นตอนที่ 2: Final clearance</p>
                      <p className="text-muted-foreground text-xs">
                        เปิดรายละเอียดคน → บันทึกสถานที่ · Pre-Mob · Mob · วันเริ่มงาน แล้วลงเวลาที่ Wave Board
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}

export default function MobilizationPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      }
    >
      <MobilizationPageContent />
    </Suspense>
  );
}
