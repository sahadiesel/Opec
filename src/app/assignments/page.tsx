'use client';

import { useState, useMemo, useEffect, useRef, Suspense, Fragment } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Plus, 
  UserPlus, 
  Briefcase, 
  Search, 
  Filter, 
  ChevronRight, 
  Building2, 
  Calendar,
  AlertTriangle,
  Info,
  Loader2,
  ShieldAlert,
  UserX,
  Pencil,
  Trash2,
  MapPin,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { formatStoredDateRangeThaiBE, formatYmdLocalThaiBE } from '@/lib/date-thai';
import {
  Assignment,
  Worker,
  POLine,
  DeploymentStatus,
  PurchaseOrder,
  Wave,
  Position,
  JobMode,
  Customer,
  MainContract,
} from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccess, canView, canEdit, canDelete, isMatrixControlledRole } from '@/lib/permissions';
import { isSystemAdmin } from '@/lib/permission-core';
import {
  collection,
  doc,
  increment,
  getDocs,
  writeBatch,
  setDoc,
  updateDoc,
  query,
  where,
} from 'firebase/firestore';
import { usePoLinesFanout } from '@/lib/ops/use-po-lines-fanout';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription,
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';
import {
  assignmentOccupiesWorkerSlot,
  checkWorkerAssignmentOverlap,
  mobilizationScheduleFromPo,
} from '@/lib/services/assignment-overlap';
import { positionListPrimaryName, type PositionDoc } from '@/lib/position-display';
import { PoFilterContextBanner } from '@/components/ops/po-filter-context-banner';
import { resolvePoLineForWave } from '@/lib/ops/resolve-po-line';
import {
  assignmentCountsTowardQuota,
  buildPoFulfillmentByLine,
  findDuplicateQuotaMobilizationGroups,
} from '@/lib/ops/po-fulfillment-read-model';
import {
  normalizePoActiveBundleId,
  resolvePoActiveBundleKeyForPo,
} from '@/lib/ops/po-active-bundle';
import { stripUndefinedForFirestore } from '@/lib/firestore/strip-undefined-for-firestore';
import {
  buildEligibleMainContractIdSet,
  filterPurchaseOrdersForPoActiveWorkflow,
  PO_ACTIVE_MAIN_CONTRACT_STATUS_IN,
} from '@/lib/ops/po-active-eligibility';
import { buildPoActiveBundleRows, PoAssignmentBundleLandingPanel } from '@/components/ops/po-quota-queue';
import { thailandTodayYmd } from '@/lib/ops/mobilization-final-clearance';
import { dedupeAssignmentsByWorkerAndWave, pickRosterLinePerWorker } from '@/lib/ops/assignment-roster';
import { MOBILIZATION_FULFILLMENT_SUBCOLLECTION } from '@/lib/store/mobilization-fulfillment';
import {
  compareAssignmentWorkerNamesTh,
  mobilizationWorkerNameFromWorker,
} from '@/lib/ops/mobilization-worker-name';
import { isPoRosterWaveId } from '@/lib/ops/po-roster-wave';
import { isPoTimesheetScopeId, poTimesheetScopeId } from '@/lib/constants/timesheet-po-scope';
import { buildMobCycleDocId } from '@/lib/ops/mob-cycle-ids';
import { isWorkerDispatchReady } from '@/lib/worker-readiness';

/** คีย์รวมใน dialog: poId + lineId — ใช้ U+001F หลีกเลี่ยงชนกับรหัส PO ที่มี "###" */
const DIALOG_LINE_KEY_SEP = '\u001f';

function encodeDialogLinePickKey(poId: string, lineId: string): string {
  return `${poId}${DIALOG_LINE_KEY_SEP}${lineId}`;
}

function parseDialogLinePickKey(key: string): { poId: string; lineId: string } | null {
  const i = key.indexOf(DIALOG_LINE_KEY_SEP);
  if (i < 0 || i + DIALOG_LINE_KEY_SEP.length >= key.length) return null;
  const poId = key.slice(0, i).trim();
  const lineId = key.slice(i + DIALOG_LINE_KEY_SEP.length).trim();
  if (!poId || !lineId) return null;
  return { poId, lineId };
}

/** เรียงตารางมอบหมายตามชื่อลูกจ้าง — รายการใหม่ไม่ไปโผล่บนสุดของตาราง */
function sortAssignmentsByWorkerName(list: Assignment[], allWorkers: Worker[] | undefined): Assignment[] {
  return [...list].sort((a, b) => compareAssignmentWorkerNamesTh(a, b, allWorkers));
}

function formatFirestoreWriteError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message?: unknown }).message ?? '');
  return typeof e === 'string' ? e : 'ไม่ทราบสาเหตุ';
}

function enrichFirestoreWriteMessage(raw: string, e: unknown): string {
  if (e && typeof e === 'object' && 'code' in e) {
    const code = String((e as { code?: string }).code || '');
    if (code === 'permission-denied') {
      return `${raw || 'Permission denied'} — ไม่มีสิทธิ์เขียน Firestore (mobilizations / number_sequences / audit_logs) หรือยังไม่ล็อกอินผู้ใช้ภายใน`;
    }
  }
  return raw;
}

function AssignmentsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const useMatrixGuards = isMatrixControlledRole(currentUser);
  const canViewAssignments = useMatrixGuards ? canAccess(currentUser, 'assignments', 'view') : canView(currentUser, 'assignments');
  const canCreateAssignments = useMatrixGuards ? canAccess(currentUser, 'assignments', 'create') : canViewAssignments;
  const canEditAssignments = useMemo(
    () =>
      !!currentUser &&
      (useMatrixGuards ? canAccess(currentUser, 'assignments', 'edit') : canEdit(currentUser, 'assignments')),
    [currentUser, useMatrixGuards]
  );
  const canDeleteAssignments = useMemo(
    () =>
      !!currentUser &&
      (isSystemAdmin(currentUser) ||
        (useMatrixGuards ? canAccess(currentUser, 'assignments', 'delete') : canDelete(currentUser, 'assignments'))),
    [currentUser, useMatrixGuards],
  );

  const isAuthorized = useMemo(
    () => !!currentUser && canViewAssignments,
    [currentUser, canViewAssignments]
  );

  // Standardized to 'mobilizations' top-level collection
  const mobilizationQuery = useMemoFirebase(() => {
    if (!firestore || isUserLoading || userLoading || !firebaseUser || !isAuthorized) return null;
    return collection(firestore, 'mobilizations');
  }, [firestore, firebaseUser, isUserLoading, userLoading, isAuthorized]);

  const { data: assignments, isLoading: isAssignmentsLoading } = useCollection<Assignment>(mobilizationQuery as any);

  const wavesQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'waves') : null), [firestore, isAuthorized]);
  const { data: allWaves } = useCollection<Wave>(wavesQuery as any);

  // STRICT ENFORCEMENT: Only workers from 'workers' collection (Field Labor)
  const workersQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'workers') : null), [firestore, isAuthorized]);
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  const positionsQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'positions') : null), [firestore, isAuthorized]);
  const { data: allPositions } = useCollection<Position>(positionsQuery as any);

  const posQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'purchase_orders') : null), [firestore, isAuthorized]);
  const { data: allPOs } = useCollection<PurchaseOrder>(posQuery as any);

  /** Fan-out per-PO subcollection read แทน collectionGroup (rules production ยังไม่เปิด wildcard read) */
  const poIdsForLines = useMemo(
    () => (isAuthorized && allPOs ? allPOs.map((p) => p.id).filter(Boolean) : null),
    [isAuthorized, allPOs],
  );
  const { data: allPOLines, isLoading: isPOLinesLoading } = usePoLinesFanout(poIdsForLines);

  /** Backfill workerName บน mobilizations เก่า — client portal อ่านชื่อจากฟิลด์นี้เมื่ออ่าน workers ไม่ได้ */
  useEffect(() => {
    if (!firestore || !assignments?.length || !allWorkers?.length) return;
    const need = assignments.filter((a) => {
      if ((a.workerName || '').trim() !== '') return false;
      return allWorkers.some((w) => w.id === a.workerId);
    });
    if (need.length === 0) return;

    const run = async () => {
      const now = Date.now();
      const chunkSize = 400;
      for (let i = 0; i < need.length; i += chunkSize) {
        const chunk = need.slice(i, i + chunkSize);
        const batch = writeBatch(firestore);
        for (const a of chunk) {
          const w = allWorkers.find((x) => x.id === a.workerId);
          const name = mobilizationWorkerNameFromWorker(w);
          if (!name) continue;
          batch.update(doc(firestore, 'mobilizations', a.id), { workerName: name, updatedAt: now });
        }
        await batch.commit();
      }
    };
    void run().catch((e) => console.error('mobilization workerName backfill', e));
  }, [firestore, assignments, allWorkers]);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [assignmentPendingDelete, setAssignmentPendingDelete] = useState<Assignment | null>(null);
  const [isDeletingAssignment, setIsDeletingAssignment] = useState(false);
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  /** บรรทัดที่เลือก: `poId###lineId` — PO อนุมาติจากบรรทัด (ไม่ต้องเลือก PO ก่อน) */
  const [dialogLinePickKey, setDialogLinePickKey] = useState('');
  const [notes, setNotes] = useState('');
  const [assignmentTableSearch, setAssignmentTableSearch] = useState('');

  const filterPoId = (searchParams.get('poId') || '').trim() || null;
  const filterPoActiveBundleIdRaw = (searchParams.get('poActiveBundleId') || '').trim() || null;
  const filterPoActiveBundleId = filterPoActiveBundleIdRaw
    ? normalizePoActiveBundleId(filterPoActiveBundleIdRaw)
    : null;
  const filterPoLineId = (searchParams.get('poLineId') || '').trim() || null;
  const openDialogFromUrl = searchParams.get('openDialog') === '1';
  /** โหมดเดิม: แสดงตารางมอบหมายทั้งระบบโดยไม่บังคับเลือกชุด PO Active ก่อน */
  const showAllAssignmentsLegacy = searchParams.get('all') === '1';
  const openDialogKeyRef = useRef<string>('');
  const filterPO = useMemo(
    () => (filterPoId && allPOs?.length ? allPOs.find((p) => p.id === filterPoId) : undefined),
    [filterPoId, allPOs]
  );

  const showAssignmentBundleLanding =
    isAuthorized && !filterPoId && !filterPoActiveBundleId && !showAllAssignmentsLegacy;

  const landingContractsQuery = useMemoFirebase(() => {
    if (!firestore || !showAssignmentBundleLanding) return null;
    return query(
      collection(firestore, 'main_contracts'),
      where('status', 'in', [...PO_ACTIVE_MAIN_CONTRACT_STATUS_IN]),
    );
  }, [firestore, showAssignmentBundleLanding]);

  const { data: landingActiveContracts, isLoading: landingContractsLoading } = useCollection<MainContract>(
    landingContractsQuery as any,
  );

  const landingCustomersQuery = useMemoFirebase(() => {
    if (!firestore || !showAssignmentBundleLanding) return null;
    return collection(firestore, 'customers');
  }, [firestore, showAssignmentBundleLanding]);

  const { data: landingCustomers, isLoading: landingCustomersLoading } = useCollection<Customer>(
    landingCustomersQuery as any,
  );

  const landingMainContractIdSet = useMemo(
    () => buildEligibleMainContractIdSet(landingActiveContracts),
    [landingActiveContracts],
  );

  const activePOsForLanding = useMemo(
    () => filterPurchaseOrdersForPoActiveWorkflow(allPOs),
    [allPOs],
  );

  const assignmentLandingRows = useMemo(
    () =>
      buildPoActiveBundleRows(
        activePOsForLanding,
        allPOLines ?? undefined,
        assignments ?? undefined,
        allWaves ?? undefined,
        landingMainContractIdSet,
        landingActiveContracts !== undefined,
        'assignment-landing',
      ),
    [
      activePOsForLanding,
      allPOLines,
      assignments,
      allWaves,
      landingMainContractIdSet,
      landingActiveContracts,
    ],
  );

  const assignmentLandingLoading =
    showAssignmentBundleLanding &&
    (landingContractsLoading || landingCustomersLoading || isAssignmentsLoading || isPOLinesLoading);

  const contractActivePOs = useMemo(
    () =>
      filterPurchaseOrdersForPoActiveWorkflow(allPOs).filter(
        (p) => (p.poType || 'contract') === 'contract',
      ),
    [allPOs],
  );

  /** ขอบเขต PO สำหรับหน้านี้ — กรองตามชุด PO Active เมื่อ URL มี poActiveBundleId (รวม PO ที่ยังไม่ sync ฟิลด์บนเอกสาร) */
  const contractActivePOsForScope = useMemo(() => {
    if (!filterPoActiveBundleId) return contractActivePOs;
    return contractActivePOs.filter((p) => resolvePoActiveBundleKeyForPo(p) === filterPoActiveBundleId);
  }, [contractActivePOs, filterPoActiveBundleId]);

  const dialogPoLineFulfillmentFiltered = useMemo(() => {
    if (!filterPoId) return [];
    return buildPoFulfillmentByLine(allPOLines, assignments, allWaves, filterPoId);
  }, [filterPoId, allPOLines, assignments, allWaves]);

  const poLinesForDialogPickFiltered = useMemo(
    () =>
      dialogPoLineFulfillmentFiltered.filter((r) => r.lineStatus === 'active' && (r.lineId || '').trim().length > 0),
    [dialogPoLineFulfillmentFiltered],
  );

  /** บรรทัด PO active ทุกตัวจากทุก PO สายสัญญา — ใช้เมื่อไม่ได้กรอง poId */
  const allFlatPoLinesForDialog = useMemo(() => {
    const poById = new Map(contractActivePOsForScope.map((p) => [p.id, p]));
    const out: Array<{
      poId: string;
      poCode: string;
      lineId: string;
      positionLabel: string;
      assignedCount: number;
      requiredQty: number;
      remainingSlots: number;
    }> = [];
    for (const po of contractActivePOsForScope) {
      const rows = buildPoFulfillmentByLine(allPOLines, assignments, allWaves, po.id);
      const p = poById.get(po.id);
      for (const r of rows) {
        if (r.lineStatus !== 'active') continue;
        const pos = r.positionId ? allPositions?.find((x) => x.id === r.positionId) : undefined;
        const positionLabel = pos
          ? positionListPrimaryName(pos as PositionDoc)
          : r.positionId || r.lineId;
        out.push({
          poId: po.id,
          poCode: p?.poCode ?? po.id.slice(0, 8),
          lineId: r.lineId,
          positionLabel,
          assignedCount: r.assignedCount,
          requiredQty: r.requiredQty,
          remainingSlots: r.remainingSlots,
        });
      }
    }
    out.sort((a, b) => {
      const c = a.poCode.localeCompare(b.poCode, 'th', { numeric: true });
      if (c !== 0) return c;
      return a.positionLabel.localeCompare(b.positionLabel, 'th');
    });
    return out;
  }, [contractActivePOsForScope, allPOLines, assignments, allWaves, allPositions]);

  const parsedDialogLinePick = useMemo(
    () => parseDialogLinePickKey(dialogLinePickKey),
    [dialogLinePickKey],
  );

  const effectiveDialogPoId = filterPoId || parsedDialogLinePick?.poId || '';
  const effectiveDialogLineId = parsedDialogLinePick?.lineId || '';

  const dialogPoForSchedule = useMemo(
    () =>
      effectiveDialogPoId && allPOs?.length ? allPOs.find((p) => p.id === effectiveDialogPoId) : undefined,
    [effectiveDialogPoId, allPOs],
  );
  const schedulePreviewFromPo = useMemo(
    () => (dialogPoForSchedule ? mobilizationScheduleFromPo(dialogPoForSchedule) : null),
    [dialogPoForSchedule],
  );

  const displayedAssignments = useMemo(() => {
    let list = assignments || [];
    if (filterPoId) {
      list = list.filter((a) => a.poId === filterPoId);
      if (filterPoLineId) list = list.filter((a) => a.poLineId === filterPoLineId);
    } else if (filterPoActiveBundleId) {
      const idSet = new Set(contractActivePOsForScope.map((p) => p.id));
      list = list.filter((a) => idSet.has(a.poId));
      /** ไม่แสดงแถวที่ปล่อยโควต้าแล้ว (Unassign / CLOSED / DEMOBILIZED) — ให้สอดคล้องคอลัมน์มอบหมาย/ว่าง */
      list = list.filter((a) => assignmentCountsTowardQuota(a));
      /** ชุด PO Active เดียวกัน: คนเดียวกันไม่ซ้อนหลายแถวจากหลาย wave */
      list = pickRosterLinePerWorker(list);
    }
    if (!filterPoActiveBundleId) {
      list = dedupeAssignmentsByWorkerAndWave(list);
    }
    list = sortAssignmentsByWorkerName(list, allWorkers ?? undefined);
    const q = assignmentTableSearch.trim().toLowerCase();
    if (!q) return list;
    return sortAssignmentsByWorkerName(
      list.filter((a) => {
        const worker = allWorkers?.find((w) => w.id === a.workerId);
        const wave = allWaves?.find((w) => w.id === a.waveId);
        const name = `${worker?.firstName || ''} ${worker?.lastName || ''}`.toLowerCase();
        return (
          name.includes(q) ||
          (a.assignmentNo || '').toLowerCase().includes(q) ||
          (a.projectName || '').toLowerCase().includes(q) ||
          (wave?.waveCode || '').toLowerCase().includes(q) ||
          (allPOs?.find((p) => p.id === a.poId)?.poCode || '').toLowerCase().includes(q)
        );
      }),
      allWorkers ?? undefined,
    );
  }, [
    assignments,
    filterPoId,
    filterPoLineId,
    filterPoActiveBundleId,
    contractActivePOsForScope,
    assignmentTableSearch,
    allWorkers,
    allWaves,
    allPOs,
  ]);

  const quotaScopePoIdSet = useMemo(() => {
    if (filterPoActiveBundleId) return new Set(contractActivePOsForScope.map((p) => p.id));
    if (filterPoId) return new Set([filterPoId]);
    return null;
  }, [filterPoActiveBundleId, filterPoId, contractActivePOsForScope]);

  const duplicateQuotaMobGroups = useMemo(() => {
    if (!quotaScopePoIdSet?.size) return [];
    return findDuplicateQuotaMobilizationGroups(assignments ?? undefined, quotaScopePoIdSet);
  }, [assignments, quotaScopePoIdSet]);

  const workerIdsWithQuotaDuplicates = useMemo(() => {
    const s = new Set<string>();
    for (const g of duplicateQuotaMobGroups) {
      if (!g.workerKey.startsWith('_unknown:')) s.add(g.workerKey);
    }
    return s;
  }, [duplicateQuotaMobGroups]);

  const targetPositionIdForDialogLine = useMemo(() => {
    if (!effectiveDialogPoId || !effectiveDialogLineId || !allPOLines?.length) return '';
    const line = allPOLines.find((l) => l.id === effectiveDialogLineId && l.poId === effectiveDialogPoId);
    return (line?.positionId || '').trim();
  }, [effectiveDialogPoId, effectiveDialogLineId, allPOLines]);

  const availableWorkers = useMemo(() => {
    if (!effectiveDialogPoId || !effectiveDialogLineId || !targetPositionIdForDialogLine) return [];
    return (allWorkers || []).filter((w) => {
      if (!isWorkerDispatchReady(w)) return false;
      if ((w.currentPositionId || '').trim() !== targetPositionIdForDialogLine) return false;
      const { hasOverlap } = checkWorkerAssignmentOverlap(assignments || [], w.id);
      return !hasOverlap;
    });
  }, [allWorkers, effectiveDialogPoId, effectiveDialogLineId, targetPositionIdForDialogLine, assignments]);

  useEffect(() => {
    setSelectedWorkerId('');
  }, [dialogLinePickKey]);

  useEffect(() => {
    if (!openDialogFromUrl) {
      openDialogKeyRef.current = '';
    }
  }, [openDialogFromUrl]);

  /** เปิด dialog จาก PO อย่างเดียว */
  useEffect(() => {
    if (!openDialogFromUrl || !filterPoId) return;
    const key = `open|po|${filterPoId}`;
    if (openDialogKeyRef.current === key) return;
    openDialogKeyRef.current = key;
    setIsDialogOpen(true);
  }, [openDialogFromUrl, filterPoId]);

  /** เปิด dialog จากชุด PO Active (หลาย PO — กรองบรรทัดในชุดเดียวกัน) */
  useEffect(() => {
    if (!openDialogFromUrl || !filterPoActiveBundleId || filterPoId) return;
    const key = `open|bundle|${filterPoActiveBundleId}`;
    if (openDialogKeyRef.current === key) return;
    openDialogKeyRef.current = key;
    setIsDialogOpen(true);
  }, [openDialogFromUrl, filterPoActiveBundleId, filterPoId]);

  /** กรอง PO เดียว: ถ้ามี poLineId ใน URL ให้เลือกบรรทัดนั้น — ไม่เช่นนั้นเลือกบรรทัดว่างอัตโนมัติ */
  useEffect(() => {
    if (!filterPoId) return;
    const fulfillment = buildPoFulfillmentByLine(allPOLines || [], assignments, allWaves, filterPoId);
    if (filterPoLineId) {
      const picked = fulfillment.find((r) => r.lineId === filterPoLineId && r.lineStatus === 'active');
      if (picked) {
        setDialogLinePickKey(encodeDialogLinePickKey(filterPoId, filterPoLineId));
        return;
      }
    }
    setDialogLinePickKey((cur) => {
      const parsed = parseDialogLinePickKey(cur);
      if (parsed?.poId === filterPoId && parsed.lineId) {
        const curRow = fulfillment.find((r) => r.lineId === parsed.lineId && r.lineStatus === 'active');
        if (curRow && curRow.remainingSlots > 0) return cur;
      }
      const gap = fulfillment.find((r) => r.lineStatus === 'active' && r.remainingSlots > 0);
      const fallback = fulfillment.find((r) => r.lineStatus === 'active');
      const lineId = gap?.lineId || fallback?.lineId || '';
      return lineId ? encodeDialogLinePickKey(filterPoId, lineId) : '';
    });
  }, [filterPoId, filterPoLineId, assignments, allPOLines, allWaves]);

  /** ไม่กรอง PO: เลือกบรรทัดว่างแรกจากทุก PO */
  useEffect(() => {
    if (filterPoId) return;
    setDialogLinePickKey((cur) => {
      const parsed = parseDialogLinePickKey(cur);
      if (parsed) {
        const still = allFlatPoLinesForDialog.some(
          (o) =>
            o.poId === parsed.poId &&
            o.lineId === parsed.lineId &&
            o.remainingSlots > 0,
        );
        if (still) return cur;
      }
      const gap = allFlatPoLinesForDialog.find((o) => o.remainingSlots > 0);
      const anyLine = allFlatPoLinesForDialog[0];
      const pick = gap || anyLine;
      return pick ? encodeDialogLinePickKey(pick.poId, pick.lineId) : '';
    });
  }, [filterPoId, allFlatPoLinesForDialog]);

  const handleCreateAssignment = async () => {
    if (!canCreateAssignments) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์สร้างการมอบหมายงาน' });
      return;
    }
    const dialogPoIdResolved = effectiveDialogPoId.trim();
    const dialogPoLineIdResolved = effectiveDialogLineId.trim();
    const workerIdTrim = (selectedWorkerId || '').trim();

    if (!firestore || !currentUser) {
      toast({
        variant: 'destructive',
        title: 'ข้อมูลไม่ครบ',
        description: !firestore ? 'การเชื่อมต่อฐานข้อมูลไม่พร้อม' : 'กรุณาล็อกอินใหม่',
      });
      return;
    }
    if (!dialogPoIdResolved || !dialogPoLineIdResolved) {
      toast({
        variant: 'destructive',
        title: 'ข้อมูลไม่ครบ',
        description: !dialogPoLineIdResolved
          ? 'กรุณาเลือกบรรทัด PO / ตำแหน่ง — ถ้าเลือกแล้วยังขึ้นอยู่ ให้เปลี่ยนบรรทัดแล้วเลือกใหม่'
          : 'ไม่พบรหัส PO — รีเฟรชหน้าแล้วลองใหม่',
      });
      return;
    }
    if (!workerIdTrim) {
      toast({
        variant: 'destructive',
        title: 'ข้อมูลไม่ครบ',
        description: 'กรุณาเลือกคนงาน — ช่วงวันที่เริ่ม/จบงานจริงไม่ต้องกรอกที่นี่ (นับจาก Mobilization: ยืนยัน mob · standby · จบงาน)',
      });
      return;
    }

    const worker = allWorkers?.find((w) => w.id === workerIdTrim);
    const po = allPOs?.find((p) => p.id === dialogPoIdResolved);
    if (!worker || !po) {
      toast({
        variant: 'destructive',
        title: 'ไม่พบข้อมูล',
        description: !worker ? 'ไม่พบคนงานในระบบ' : 'ไม่พบ Customer PO — รีเฟรชหน้าแล้วลองใหม่',
      });
      return;
    }

    // --- SUITABILITY VALIDATIONS ---
    
    // 1. Worker Status Check
    if (worker.workerStatus === 'BLACKLISTED') {
      toast({ variant: "destructive", title: "ไม่สามารถมอบหมายได้", description: "คนงานรายนี้อยู่ในบัญชีดำ (Blacklisted)" });
      return;
    }
    if (worker.workerStatus === 'INACTIVE') {
      toast({ variant: "destructive", title: "ไม่สามารถมอบหมายได้", description: "คนงานพ้นสภาพการจ้าง (Inactive)" });
      return;
    }

    // 2. Readiness Compliance Check
    if (!isWorkerDispatchReady(worker)) {
      const policyHint = worker.readinessManualHold
        ? 'HR ปิดสถานะพร้อมชั่วคราว — เปิดสวิตช์ «พร้อม» ที่แท็บข้อมูลประวัติ (ข้อมูลส่วนตัว)'
        : worker.readinessStatus === 'BLOCKED'
          ? `เอกสารเข้าเงื่อนไขบล็อกการ Assign (ใกล้หมดอายุใน ${worker.nearestExpiryInDays ?? '-'} วัน)`
          : `คนงานมีสถานะ ${worker.readinessStatus}`;
      toast({ 
        variant: "destructive", 
        title: "ความพร้อมไม่ผ่านเกณฑ์ (Not Ready)", 
        description: `${policyHint} กรุณาตรวจสอบเอกสาร/ใบเซอร์ก่อนมอบหมายงาน` 
      });
      return;
    }

    // 3. Overlap / Double-assignment Check
    const overlap = checkWorkerAssignmentOverlap(assignments || [], selectedWorkerId);
    if (overlap.hasOverlap) {
      const first = overlap.blockingAssignments[0];
      toast({
        variant: 'destructive',
        title: 'คนงานมีงานมอบหมายอยู่แล้ว (Already Assigned)',
        description: `${worker.firstName} ${worker.lastName} ถูกมอบหมายอยู่ในโครงการ "${first.projectName}" (${first.assignmentNo}) — Unassign / Demobilize หรือปิดรายการเดิมก่อนมอบหมายซ้ำ`,
      });
      return;
    }

    // Resolve Context from PO, PO Line and Position Matrix
    if (po && (po.poType || 'contract') === 'quotation') {
      toast({
        variant: 'destructive',
        title: 'ไม่สามารถมอบหมายจาก PO สายใบเสนอราคา',
        description:
          'PO แบบใบเสนอราคาใช้สำหรับขายสินค้า/บริการครั้งเดียวจบ ไม่มอบหมายคนงานแบบสัญญา — ใช้สายใบวางบิลหลังส่งมอบแทน',
      });
      return;
    }

    const effectivePoLineId = dialogPoLineIdResolved;
    const assignedOnLine = (assignments || []).filter(
      (a) =>
        a.poId === dialogPoIdResolved &&
        a.poLineId === effectivePoLineId &&
        assignmentCountsTowardQuota(a),
    ).length;

    const poLine = resolvePoLineForWave(allPOLines, dialogPoIdResolved, effectivePoLineId);
    if (!poLine) {
      toast({
        variant: 'destructive',
        title: 'ไม่พบบรรทัด PO',
        description: 'บรรทัดไม่ตรงกับ PO ที่เลือก หรือไม่ active — ตรวจ Customer PO',
      });
      return;
    }
    if (!poLine.positionId?.trim()) {
      toast({
        variant: 'destructive',
        title: 'PO Line ไม่มีตำแหน่ง',
        description: 'บรรทัด PO นี้ยังไม่มี positionId — แก้ที่หน้า Customer PO ก่อนมอบหมาย',
      });
      return;
    }
    const qtyCap = Math.max(0, Math.floor(Number(poLine.quantity) || 0));
    if (qtyCap > 0 && assignedOnLine >= qtyCap) {
      toast({
        variant: 'destructive',
        title: 'ครบโควต้าบรรทัด PO แล้ว',
        description: `บรรทัดนี้กำหนด ${qtyCap} คน — เพิ่ม quantity ที่ PO หรือเลือกบรรทัดอื่น`,
      });
      return;
    }

    const targetPositionId = (poLine.positionId || '').trim();
    const position = allPositions?.find((p) => (p.id || '').trim() === targetPositionId);
    const rawJobMode = (position?.jobMode ?? po.poWorkMode ?? 'OFFSHORE').toString().toUpperCase();
    const resolvedWorkMode: JobMode = rawJobMode === 'ONSHORE' ? 'ONSHORE' : 'OFFSHORE';

    // 4. Position Suitability Check
    const workerPosId = (worker.currentPositionId || '').trim();
    if (workerPosId !== targetPositionId) {
      const targetPosName = position?.positionName || position?.positionNameTh || targetPositionId;
      const workerPos = allPositions?.find((p) => (p.id || '').trim() === workerPosId);
      const workerPosName = (workerPos?.positionName || workerPos?.positionNameTh) || worker.currentPositionId;
      toast({ 
        variant: "destructive", 
        title: "ตำแหน่งงานไม่ตรงกัน", 
        description: `คนงานมีตำแหน่ง ${workerPosName} แต่โครงการต้องการตำแหน่ง ${targetPosName}` 
      });
      return;
    }

    // ราคา/โควต้า/ระยะเวลาอยู่ที่สัญญา + PO แล้ว — ไม่บังคับ sales_contract_terms แยกอีกชั้น

    setIsCreating(true);
    try {
      const tsScopeId = poTimesheetScopeId(po.id);

      const { code: finalNo } = await generateNextDocumentCode(firestore, 'assignment', {
        actor: currentUser.displayName || currentUser.email || currentUser.id,
        userId: currentUser.id,
      });

      const mobCollectionRef = collection(firestore, 'mobilizations');
      const newMobRef = doc(mobCollectionRef);

      const workerDisplayName = mobilizationWorkerNameFromWorker(worker);
      const locFromLine = (poLine.workLocation || '').trim();
      const nowTs = Date.now();
      const assignedDate = thailandTodayYmd();
      const scheduleCeiling = mobilizationScheduleFromPo(po);
      const newAssignment: Assignment = {
        id: newMobRef.id,
        assignmentNo: finalNo,
        workerId: workerIdTrim,
        workerName: workerDisplayName,
        poLineId: effectivePoLineId,
        poId: dialogPoIdResolved,
        poActiveBundleId: resolvePoActiveBundleKeyForPo(po),
        mobCycleNumber: 1,
        mobCycleId: buildMobCycleDocId(newMobRef.id, 1),
        mobWorkflowVersion: 'po_active_v2',
        contractId: po.contractId || '',
        waveId: tsScopeId,
        positionId: (position?.id || poLine.positionId || '').trim(),
        customerId: po.customerId,
        projectName: po.projectName || po.title,
        ...(locFromLine
          ? {
              workLocation: locFromLine,
              workLocationUpdatedAt: nowTs,
              workLocationUpdatedByUserId: currentUser.id,
            }
          : {}),
        assignedDate,
        /** วันเปิดเอกสารมอบหมาย — วันเริ่มงานจริงยังไม่นับที่นี่ (ตั้งที่ Mobilization: standby / เริ่มทำงาน) */
        startDate: assignedDate,
        /** เพดานจาก PO — ไม่ใช่วันจบงานจริง (จบงานที่ปุ่ม Mobilization) */
        endDate: scheduleCeiling.endDate,
        mobilizationStatus: 'PENDING',
        deploymentStatus: 'DRAFT',
        clientApprovalStatus: 'NOT_SUBMITTED',
        readinessStatus: 'ready',
        workMode: resolvedWorkMode,
        readinessSummary: {
          passportValid: 'pass',
          medicalValid: 'pass',
          certificatesComplete: 'pass',
          safetyTrainingComplete: 'pass',
          fitToWork: 'pass',
          ppeIssued: 'missing',
          toolsIssued: 'missing',
          overlapClear: 'pass',
          clientApproved: 'missing',
          drugTestValid: 'missing',
        },
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        createdAt: nowTs,
        updatedAt: nowTs,
      };

      await setDoc(newMobRef, stripUndefinedForFirestore(newAssignment), { merge: true });
      await updateDoc(doc(firestore, 'workers', workerIdTrim), {
        workerStatus: 'ASSIGNED',
        updatedAt: nowTs,
      });

      toast({ title: 'มอบหมายงานสำเร็จ', description: `รหัสการมอบหมาย: ${finalNo} — ไปดำเนินการ Mobilization (Waiting MOB)` });
      setIsDialogOpen(false);
    } catch (e) {
      console.error(e);
      const raw = formatFirestoreWriteError(e);
      const msg = enrichFirestoreWriteMessage(raw, e);
      toast({
        variant: 'destructive',
        title: 'บันทึกการมอบหมายไม่สำเร็จ',
        description:
          msg.length > 280
            ? `${msg.slice(0, 280)}…`
            : msg,
      });
    } finally {
      setIsCreating(false);
    }
  };

  const confirmDeleteAssignment = async () => {
    if (!firestore || !assignmentPendingDelete) return;
    setIsDeletingAssignment(true);
    try {
      const id = assignmentPendingDelete.id;
      const waveId = assignmentPendingDelete.waveId?.trim();
      const linesSnap = await getDocs(
        collection(firestore, 'mobilizations', id, MOBILIZATION_FULFILLMENT_SUBCOLLECTION)
      );
      const batch = writeBatch(firestore);
      for (const d of linesSnap.docs) {
        batch.delete(d.ref);
      }
      batch.delete(doc(firestore, 'mobilizations', id));
      if (waveId && !isPoTimesheetScopeId(waveId)) {
        batch.update(doc(firestore, 'waves', waveId), {
          assignedWorkers: increment(-1),
          updatedAt: Date.now(),
        });
      }
      await batch.commit();
      const wid = assignmentPendingDelete.workerId;
      if (wid) {
        const stillBlocking = (assignments ?? []).some(
          (a) => a.id !== id && a.workerId === wid && assignmentOccupiesWorkerSlot(a),
        );
        if (!stillBlocking) {
          await updateDoc(doc(firestore, 'workers', wid), {
            workerStatus: 'AVAILABLE',
            updatedAt: Date.now(),
          });
        }
      }
      toast({
        title: 'ลบการมอบหมายแล้ว',
        description: assignmentPendingDelete.assignmentNo || id,
      });
      setAssignmentPendingDelete(null);
    } catch (e) {
      console.error(e);
      toast({
        variant: 'destructive',
        title: 'ลบไม่สำเร็จ',
        description: 'ไม่สามารถลบรายการมอบหมายได้',
      });
    } finally {
      setIsDeletingAssignment(false);
    }
  };

  const handleAssignmentDialogChange = (open: boolean) => {
    setIsDialogOpen(open);
    if (!open) {
      setSelectedWorkerId('');
      setNotes('');
      openDialogKeyRef.current = '';
      if (!filterPoId) {
        setDialogLinePickKey('');
      }
    }
  };

  const getDeploymentStatusBadge = (status: DeploymentStatus) => {
    switch(status) {
      case 'DRAFT':
        return (
          <Badge variant="outline" className="bg-sky-50 text-sky-900 border-sky-200 font-bold">
            Waiting MOB
          </Badge>
        );
      case 'READINESS_CHECK': return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 uppercase font-bold">Checking</Badge>;
      case 'READY_TO_MOB': return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 uppercase font-bold">Ready</Badge>;
      case 'MOBILIZING': return <Badge className="bg-blue-600 uppercase font-bold">Mobilizing</Badge>;
      case 'ACTIVE': return <Badge className="bg-green-600 uppercase font-bold">Active Duty</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isUserLoading || userLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        {!(isAuthorized && showAssignmentBundleLanding) ? (
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
              <UserPlus className="h-8 w-8" /> การมอบหมายลูกจ้าง (Worker Assignments)
            </h1>
            <p className="text-muted-foreground text-lg">
              กำหนดรายชื่อ <b>ลูกจ้างหน้างาน</b> ต่อ <b>บรรทัดคำสั่งจ้าง (PO line)</b> — ระบบบันทึกแค่<b>วันที่มอบหมาย</b>; วัน Standby / เริ่มทำงานตั้งที่หน้า <b>Mobilization</b> · หลังมอบหมายสถานะเป็น <b>Waiting MOB</b> (operations_manager / HR / Admin)
              {showAllAssignmentsLegacy ? (
                <span className="block mt-2 text-sm">
                  กำลังใช้ <b>โหมดแสดงทั้งหมด</b> —{' '}
                  <Link href="/assignments" className="font-semibold text-primary underline">
                    กลับไปเลือกชุด PO Active
                  </Link>
                </span>
              ) : null}
            </p>
          </div>
        ) : null}

        {!isAuthorized ? (
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
            <Info className="h-12 w-12 text-muted-foreground opacity-50" />
            <h2 className="text-xl font-bold">Access Pending (รอนุมัติสิทธิ์)</h2>
            <p className="text-muted-foreground max-w-md">บัญชีของคุณยังไม่ได้รับการกำหนดบทบาท กรุณาติดต่อผู้ดูแลระบบ</p>
          </div>
        ) : showAssignmentBundleLanding ? (
          <>
            <div className="flex flex-col gap-2">
              <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
                <UserPlus className="h-8 w-8" /> การมอบหมายลูกจ้าง — เลือกชุด PO Active
              </h1>
              <p className="text-muted-foreground text-lg max-w-3xl">
                เลือก <b>หนึ่งชุด</b> (ลูกค้า + Onshore/Offshore) ก่อน — ระบบจะแสดงเฉพาะการมอบหมายและบรรทัด PO ในชุดนั้น
              </p>
              <p className="text-sm text-muted-foreground">
                ต้องการมุมมองรายการทั้งระบบแบบเดิม?{' '}
                <Link href="/assignments?all=1" className="font-semibold text-primary underline">
                  เปิดโหมดแสดงทั้งหมด
                </Link>
              </p>
            </div>
            <PoAssignmentBundleLandingPanel
              rows={assignmentLandingRows}
              customers={landingCustomers ?? undefined}
              assignments={assignments ?? undefined}
              loading={assignmentLandingLoading}
            />
          </>
        ) : (
          <>
            <Alert className="bg-amber-50 border-amber-200 text-amber-800 shadow-sm">
              <ShieldAlert className="h-5 w-5 text-amber-600" />
              <AlertTitle className="font-bold">นโยบายความเหมาะสม (Suitability Policy)</AlertTitle>
              <AlertDescription className="text-sm">
                ระบบจะตรวจสอบ <b>ตำแหน่งงาน (Position)</b>, <b>สถานะความพร้อม (Readiness)</b> และ <b>คนงานยังถือสล็อต mobilization อยู่หรือไม่</b> — ห้ามมอบหมายซ้ำจนกว่าจะ Unassign / ปิดงานเดิม (ไม่บังคับระบุช่วงวันที่ที่หน้านี้)
                <span className="block mt-2 text-amber-900/90">
                  ตารางนี้แสดง <b>1 แถวต่อคน</b> (โควต้าตามบรรทัด PO) — วันเริ่มงานจริง / จบงานนับจากหน้า <b>Mobilization</b> (ยืนยัน mob · standby · จบงาน) ภายใน assignment เดียวกันสามารถเปิดรอบ mob ถัดไปได้หากยังไม่ unassign
                </span>
              </AlertDescription>
            </Alert>

            <PoFilterContextBanner
              poId={filterPoId}
              po={filterPO}
              poActiveBundleId={filterPoActiveBundleId}
              bundlePoCodes={contractActivePOsForScope.map((p) => p.poCode)}
              listBasePath="/assignments"
              moduleLabel="Assignments"
            />

            {duplicateQuotaMobGroups.length > 0 && quotaScopePoIdSet ? (
              <Card className="border-destructive/40 shadow-md overflow-hidden">
                <CardHeader className="bg-destructive/5 border-b border-destructive/15 py-3">
                  <CardTitle className="text-base flex flex-wrap items-center gap-2 text-destructive">
                    <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
                    พบ mobilization ซ้ำที่ยังนับโควต้า ({duplicateQuotaMobGroups.length} คน)
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1 max-w-4xl">
                    คนเดียวกันมีมากกว่า 1 เอกสาร <code className="font-mono text-[10px]">mobilizations</code> ในขอบเขต PO นี้ที่ยังจองสล็อต
                    — ตารางหลักแสดงแค่หนึ่งแถวต่อคน แต่โควต้ายังถูกนับหลายครั้ง · ใช้ปุ่มลบเพื่อคืนโควต้า (เก็บรายการที่ถูกต้องไว้ 1 ฉบับ)
                  </p>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="pl-4 font-bold">เลขที่ / ชื่อ</TableHead>
                        <TableHead className="font-bold">PO · บรรทัด</TableHead>
                        <TableHead className="font-bold">Wave</TableHead>
                        <TableHead className="font-bold">Deployment</TableHead>
                        <TableHead className="font-bold text-right pr-4">จัดการ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {duplicateQuotaMobGroups.map((group) => {
                        const headWorker =
                          !group.workerKey.startsWith('_unknown:')
                            ? allWorkers?.find((w) => w.id === group.workerKey)
                            : undefined;
                        const groupTitle =
                          headWorker != null
                            ? `${headWorker.firstName ?? ''} ${headWorker.lastName ?? ''}`.trim() || group.workerKey
                            : `ไม่ระบุ workerId (${group.workerKey})`;
                        return (
                          <Fragment key={group.workerKey}>
                            <TableRow className="bg-amber-50/90 hover:bg-amber-50">
                              <TableCell colSpan={5} className="py-2 pl-4 text-sm font-semibold text-amber-950">
                                {groupTitle}
                                <Badge variant="outline" className="ml-2 border-amber-700 text-amber-900 text-[10px]">
                                  {group.assignments.length} รายการซ้ำ
                                </Badge>
                              </TableCell>
                            </TableRow>
                            {group.assignments.map((a) => {
                              const poRow = allPOs?.find((p) => p.id === a.poId);
                              const wave = allWaves?.find((w) => w.id === a.waveId);
                              const lineRow = allPOLines?.find((l) => l.id === a.poLineId && l.poId === a.poId);
                              const posRow = lineRow?.positionId
                                ? allPositions?.find((p) => p.id === lineRow.positionId)
                                : undefined;
                              const posLabel = posRow
                                ? positionListPrimaryName(posRow as PositionDoc)
                                : lineRow?.positionId || '—';
                              return (
                                <TableRow key={a.id} className="text-sm">
                                  <TableCell className="pl-4 align-top">
                                    <span className="font-mono text-[11px] font-bold text-primary block">
                                      {a.assignmentNo || a.id.slice(0, 10)}
                                    </span>
                                    <span className="text-muted-foreground text-[10px]">{a.id}</span>
                                  </TableCell>
                                  <TableCell className="align-top">
                                    <span className="font-mono font-semibold">{poRow?.poCode ?? a.poId}</span>
                                    <span className="block text-[11px] text-muted-foreground mt-0.5">{posLabel}</span>
                                    <span className="font-mono text-[10px] text-muted-foreground">line · {a.poLineId}</span>
                                  </TableCell>
                                  <TableCell className="align-top text-xs">
                                    {wave?.waveCode ?? (isPoTimesheetScopeId(a.waveId) ? 'PO scope' : a.waveId || '—')}
                                  </TableCell>
                                  <TableCell className="align-top">{getDeploymentStatusBadge(a.deploymentStatus)}</TableCell>
                                  <TableCell className="text-right pr-4 align-top">
                                    {canDeleteAssignments ? (
                                      <Button
                                        variant="destructive"
                                        size="sm"
                                        className="h-8 gap-1"
                                        onClick={() => setAssignmentPendingDelete(a)}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                        ลบรายการนี้
                                      </Button>
                                    ) : (
                                      <span className="text-[11px] text-muted-foreground">ไม่มีสิทธิ์ลบ</span>
                                    )}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ) : null}

            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
              <div className="flex items-center gap-3 flex-1">
                <div className="relative w-full max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="ค้นหาตามลูกจ้าง หรือรหัส PO..."
                    className="pl-9 h-11"
                    value={assignmentTableSearch}
                    onChange={(e) => setAssignmentTableSearch(e.target.value)}
                  />
                </div>
                <Button variant="outline" className="gap-2 h-11"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
              </div>
              {canCreateAssignments && (
                <Dialog open={isDialogOpen} onOpenChange={handleAssignmentDialogChange}>
                  <DialogTrigger asChild>
                    <Button className="gap-2 h-11 px-6 bg-primary shadow-md text-base font-bold">
                      <Plus className="h-5 w-5" /> สร้างการมอบหมายใหม่ (Field Assignment)
                    </Button>
                  </DialogTrigger>
                  <DialogContent
                    className="max-w-2xl"
                    onCloseAutoFocus={(e) => e.preventDefault()}
                  >
                  <DialogHeader>
                    <DialogTitle>มอบหมายงาน (Field Crew Assignment)</DialogTitle>
                    <DialogDescription>
                      {filterPoId ? (
                        <>
                          เลือก <strong>บรรทัด PO / ตำแหน่ง</strong> และ <strong>คนงาน</strong> — ไม่ต้องระบุวันเริ่ม/สิ้นสุดที่นี่ (ระบบบันทึกแค่วันมอบหมาย = วันนี้; ช่วงทำงานจริงตั้งที่ Mobilization)
                        </>
                      ) : filterPoActiveBundleId ? (
                        <>
                          กรองตาม <strong>ชุด PO Active</strong> — เลือกบรรทัด/ตำแหน่งด้านล่าง (รวมทุก PO ในลูกค้าและ Onshore/Offshore ชุดเดียวกัน · มีรหัส PO ในแต่ละบรรทัด)
                        </>
                      ) : (
                        <>
                          ด้านบนแสดง <strong>Customer PO ที่ Active</strong> ทั้งหมด (ดูอย่างเดียว) — เลือกมอบหมายที่ช่อง{' '}
                          <strong>บรรทัด PO</strong> เดียวด้านล่าง (รวมทุก PO · ระบุรหัส PO ในแต่ละบรรทัด)
                        </>
                      )}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                    <div className="space-y-2 md:col-span-2">
                      {filterPoId ? (
                        <>
                          <Label className="font-bold">Customer PO</Label>
                          {filterPO ? (
                            <div className="flex items-start gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
                              <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                              <div className="min-w-0 space-y-0.5">
                                <p className="font-mono text-base font-bold text-primary">{filterPO.poCode}</p>
                                <p className="font-medium leading-snug text-foreground">
                                  {filterPO.projectName || filterPO.title}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  เลือกตำแหน่ง/โควต้าที่ช่อง &quot;บรรทัด PO&quot; ด้านล่าง — ไม่ต้องเลือก PO ซ้ำ
                                </p>
                              </div>
                            </div>
                          ) : (
                            <div className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
                              กำลังโหลดข้อมูล PO…
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <Label className="font-bold">Customer PO ที่ Active (สายสัญญา)</Label>
                          <div className="max-h-40 overflow-y-auto rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                            {contractActivePOsForScope.length === 0 ? (
                              <p className="py-2 text-center text-xs text-muted-foreground">
                                ไม่มี PO สายสัญญาที่ Active — อนุมัติ PO ที่เมนู Customer PO ก่อน
                              </p>
                            ) : (
                              contractActivePOsForScope.map((p) => (
                                <div
                                  key={p.id}
                                  className="flex flex-wrap gap-x-2 gap-y-0.5 border-b border-border/50 py-2 text-xs last:border-0 last:pb-0"
                                >
                                  <span className="font-mono font-semibold text-primary">{p.poCode}</span>
                                  <span className="text-muted-foreground">·</span>
                                  <span className="text-foreground/90">{p.projectName || p.title}</span>
                                </div>
                              ))
                            )}
                          </div>
                          <p className="text-[10px] text-muted-foreground">
                            {filterPoActiveBundleId
                              ? 'ชุด PO Active นี้ — เลือกบรรทัด/ตำแหน่งในช่องด้านล่าง'
                              : 'ไม่ต้องเลือก PO ที่นี่ — ไปเลือกบรรทัด/ตำแหน่งในช่องด้านล่าง (ครอบคลุมทุก PO)'}
                          </p>
                        </>
                      )}
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label className="font-bold">
                        {filterPoId
                          ? 'เลือกบรรทัด PO / ตำแหน่ง (โควต้าตาม PO ที่กรอง)'
                          : filterPoActiveBundleId
                            ? 'เลือกบรรทัด PO / ตำแหน่ง (ในชุด PO Active ที่กรอง)'
                            : 'เลือกบรรทัด PO / ตำแหน่ง (ทุก PO · ตามโควต้าใน PO)'}
                      </Label>
                      <Select
                        value={dialogLinePickKey || undefined}
                        onValueChange={setDialogLinePickKey}
                        disabled={
                          filterPoId
                            ? poLinesForDialogPickFiltered.length === 0
                            : allFlatPoLinesForDialog.length === 0
                        }
                      >
                        <SelectTrigger className="h-11">
                          <SelectValue
                            placeholder={
                              filterPoId
                                ? 'เลือกบรรทัดที่ยังว่าง...'
                                : contractActivePOsForScope.length === 0
                                  ? 'ไม่มี PO Active'
                                  : 'เลือกบรรทัด / ตำแหน่ง...'
                            }
                          />
                        </SelectTrigger>
                        <SelectContent className="max-h-[min(70vh,380px)]">
                          {filterPoId ? (
                            poLinesForDialogPickFiltered.length === 0 ? (
                              <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                                ไม่มีบรรทัด Active หรือครบโควต้าทุกบรรทัดแล้ว — ตรวจจำนวนใน PO
                              </div>
                            ) : (
                              poLinesForDialogPickFiltered.map((row) => {
                                const pos = row.positionId
                                  ? allPositions?.find((p) => p.id === row.positionId)
                                  : undefined;
                                const name = pos
                                  ? positionListPrimaryName(pos as PositionDoc)
                                  : row.positionId || row.lineId;
                                const pk = encodeDialogLinePickKey(filterPoId, row.lineId);
                                return (
                                  <SelectItem
                                    key={pk}
                                    value={pk}
                                    disabled={row.remainingSlots <= 0}
                                  >
                                    {name} · มอบหมายแล้ว {row.assignedCount}/{row.requiredQty}
                                    {row.remainingSlots > 0 ? ` · ว่าง ${row.remainingSlots}` : ' · เต็ม'}
                                  </SelectItem>
                                );
                              })
                            )
                          ) : allFlatPoLinesForDialog.length === 0 ? (
                            <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                              ไม่มีบรรทัด Active ในทุก PO — ตรวจ Customer PO / บรรทัดโควต้า
                            </div>
                          ) : (
                            allFlatPoLinesForDialog.map((row) => {
                              const pk = encodeDialogLinePickKey(row.poId, row.lineId);
                              return (
                                <SelectItem
                                  key={pk}
                                  value={pk}
                                  disabled={row.remainingSlots <= 0}
                                >
                                  <span className="font-mono font-semibold text-primary">{row.poCode}</span>
                                  {' · '}
                                  {row.positionLabel} · มอบหมายแล้ว {row.assignedCount}/{row.requiredQty}
                                  {row.remainingSlots > 0 ? ` · ว่าง ${row.remainingSlots}` : ' · เต็ม'}
                                </SelectItem>
                              );
                            })
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label className="font-bold">เลือกคนงานหน้างาน (Select Field Worker)</Label>
                      <Select
                        value={selectedWorkerId || undefined}
                        onValueChange={setSelectedWorkerId}
                        disabled={
                          !effectiveDialogPoId ||
                          !effectiveDialogLineId ||
                          !targetPositionIdForDialogLine
                        }
                      >
                        <SelectTrigger className="h-11">
                          <SelectValue
                            placeholder={
                              !effectiveDialogLineId
                                ? 'เลือกบรรทัด PO ก่อน'
                                : !targetPositionIdForDialogLine
                                  ? 'บรรทัดนี้ไม่มีตำแหน่ง'
                                  : 'เลือกคนงานตำแหน่งตรงกับบรรทัด · READY'
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {availableWorkers.map((w) => {
                            const p = allPositions?.find((x) => x.id === w.currentPositionId);
                            const pn = p?.positionName || p?.positionNameTh || w.currentPositionId || '—';
                            return (
                              <SelectItem key={w.id} value={w.id}>
                                {w.firstName} {w.lastName} ({w.workerCode}) — {pn}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                      <p className="text-[10px] text-muted-foreground italic">
                        * เฟส 2 PO workflow: แสดงเฉพาะคนที่ <strong>ยังไม่ถูก assign ค้าง</strong> (หนึ่งคนหนึ่ง mobilization ที่ยังไม่ปิด/Unassign)
                      </p>
                    </div>
                    <div className="space-y-1 md:col-span-2 rounded-md border border-muted bg-muted/30 px-3 py-2">
                      <Label className="text-xs font-bold text-muted-foreground">หลังยืนยันการมอบหมาย</Label>
                      <p className="text-sm font-medium">
                        บันทึก <strong>วันที่มอบหมาย = วันนี้</strong> และส่งคนเข้าคิว <strong>รอ Mobilization</strong>
                      </p>
                      {schedulePreviewFromPo ? (
                        <p className="text-xs text-muted-foreground mt-1">
                          เพดานสัญญา PO (อ้างอิงภายใน):{' '}
                          {formatStoredDateRangeThaiBE(schedulePreviewFromPo.startDate, schedulePreviewFromPo.endDate)} — วันเริ่ม
                          standby / ทำงานจริงตั้งที่หน้า Mobilization
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-1">เลือกบรรทัด PO เพื่อแสดงเพดานวันที่จาก PO</p>
                      )}
                    </div>
                  </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isCreating}>ยกเลิก</Button>
                      <Button
                        onClick={handleCreateAssignment}
                        className="bg-primary font-bold"
                        disabled={
                          isCreating ||
                          !dialogLinePickKey.trim() ||
                          !(selectedWorkerId || '').trim()
                        }
                      >
                        {isCreating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        ยืนยันการมอบหมาย (Confirm)
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </div>

            <Card className="shadow-lg border-none overflow-hidden">
              <CardContent className="p-0">
                {isAssignmentsLoading ? (
                  <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลการมอบหมาย...</div>
                ) : (
                  <TooltipProvider delayDuration={400}>
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="font-bold py-4 pl-6">เลขที่ / ลูกจ้างหน้างาน</TableHead>
                        <TableHead className="font-bold min-w-[11rem]">คำสั่งจ้าง / บรรทัด PO</TableHead>
                        <TableHead className="font-bold">วันที่มอบหมาย</TableHead>
                        <TableHead className="font-bold">สถานที่</TableHead>
                        <TableHead className="font-bold">ความพร้อม (Readiness)</TableHead>
                        <TableHead className="font-bold">สถานะ Deployment</TableHead>
                        <TableHead className="text-right pr-6">จัดการ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {displayedAssignments.map((asgn) => {
                        const worker = allWorkers?.find(w => w.id === asgn.workerId);
                        const wave = allWaves?.find(w => w.id === asgn.waveId);
                        const poRow = allPOs?.find((p) => p.id === asgn.poId);
                        const timesheetScope = isPoTimesheetScopeId(asgn.waveId);
                        const legacyRoster = isPoRosterWaveId(asgn.waveId);
                        const lineForAsgn = allPOLines?.find(
                          (l) => l.id === asgn.poLineId && l.poId === asgn.poId
                        );
                        const linePosId = (lineForAsgn?.positionId || asgn.positionId || '').trim();
                        const posForLine = linePosId
                          ? allPositions?.find((p) => p.id === linePosId)
                          : undefined;
                        const poLinePositionLabel = posForLine
                          ? positionListPrimaryName(posForLine as PositionDoc)
                          : linePosId || '—';
                        const legacyRoutingNote =
                          !timesheetScope && !legacyRoster && wave?.waveCode
                            ? `อ้างอิงสายเก่า (Wave): ${wave.waveCode}`
                            : legacyRoster
                              ? 'บันทึกโควต้าแบบเก่า — ยังผูกบรรทัด PO ตามปกติ'
                              : null;
                        const workLocationLabel =
                          (asgn.workLocation || lineForAsgn?.workLocation || '').toString().trim() || '—';
                        
                        return (
                          <TableRow key={asgn.id} className="cursor-pointer hover:bg-muted/30 group transition-all" onClick={() => router.push(`/assignments/${asgn.id}`)}>
                            <TableCell className="py-4 pl-6">
                              <div className="flex flex-col">
                                <span className="text-[10px] font-mono font-bold text-primary mb-1">{asgn.assignmentNo || asgn.id.substring(0,8)}</span>
                                <span className="font-bold text-base text-primary">{worker?.firstName} {worker?.lastName}</span>
                                {workerIdsWithQuotaDuplicates.has(asgn.workerId) ? (
                                  <Badge
                                    variant="destructive"
                                    className="mt-1.5 w-fit text-[10px] font-bold leading-tight"
                                  >
                                    มี mobilization ซ้ำ (ดูตารางแดงด้านบน)
                                  </Badge>
                                ) : null}
                                <span className="text-xs text-muted-foreground flex items-center gap-1 font-medium"><Briefcase className="h-3 w-3" /> {asgn.positionId}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                <span className="text-[10px] font-mono font-semibold text-muted-foreground">
                                  {poRow?.poCode ?? '—'}
                                </span>
                                <span className="font-bold text-sm text-primary leading-snug flex items-start gap-1.5">
                                  <Briefcase className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden />
                                  <span>
                                    {lineForAsgn ? (
                                      <>
                                        <span className="block">{poLinePositionLabel}</span>
                                        <span className="text-[10px] font-mono font-normal text-muted-foreground">
                                          บรรทัด PO · {asgn.poLineId}
                                        </span>
                                      </>
                                    ) : (
                                      <>
                                        <span className="block text-amber-800">ไม่พบบรรทัด PO ในระบบ</span>
                                        <span className="text-[10px] font-mono font-normal text-muted-foreground">
                                          poLineId · {asgn.poLineId || '—'}
                                        </span>
                                      </>
                                    )}
                                  </span>
                                </span>
                                <span className="text-[10px] text-muted-foreground leading-snug max-w-[22rem]">
                                  {asgn.projectName}
                                  {poRow?.contractId ? (
                                    <span className="block mt-0.5">
                                      <Link
                                        href={`/main-contracts/${poRow.contractId}`}
                                        className="text-[9px] font-mono text-primary hover:underline"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        สัญญาหลัก (ต้นทุน/อัตราขาย) →
                                      </Link>
                                    </span>
                                  ) : null}
                                </span>
                                {legacyRoutingNote ? (
                                  <span className="text-[9px] text-amber-800/90 bg-amber-50 border border-amber-100 rounded px-1.5 py-0.5 w-fit max-w-full">
                                    {legacyRoutingNote}
                                  </span>
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-0.5 text-[10px] text-muted-foreground font-bold">
                                <span className="inline-flex items-center gap-2">
                                  <Calendar className="h-3.5 w-3.5 shrink-0" />
                                  {formatYmdLocalThaiBE((asgn.assignedDate || asgn.startDate || '').trim() || '—')}
                                </span>
                                <span className="text-[9px] font-normal text-muted-foreground/90 pl-5">
                                  เพดาน PO ถึง {formatYmdLocalThaiBE((asgn.endDate || '').trim() || '—')}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div
                                className="flex max-w-[200px] items-start gap-1.5 text-xs text-foreground/90"
                                title={workLocationLabel}
                              >
                                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <span className="line-clamp-2 break-words">{workLocationLabel}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant={asgn.readinessStatus === 'ready' ? 'default' : 'outline'} className={asgn.readinessStatus === 'ready' ? 'bg-green-600' : 'text-amber-600 border-amber-200'}>
                                {asgn.readinessStatus.toUpperCase()}
                              </Badge>
                            </TableCell>
                            <TableCell>{getDeploymentStatusBadge(asgn.deploymentStatus)}</TableCell>
                            <TableCell
                              className="text-right pr-6"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="flex flex-nowrap items-center justify-end gap-0.5">
                                {canEditAssignments && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" asChild>
                                        <Link href={`/assignments/${asgn.id}`}>
                                          <Pencil className="h-4 w-4" />
                                          <span className="sr-only">แก้ไขการมอบหมาย</span>
                                        </Link>
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top">
                                      <p>แก้ไขการมอบหมาย</p>
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                                {canDeleteAssignments && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="destructive"
                                        size="icon"
                                        className="h-8 w-8 shrink-0"
                                        onClick={() => setAssignmentPendingDelete(asgn)}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                        <span className="sr-only">ลบการมอบหมาย</span>
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top">
                                      <p>ลบการมอบหมาย</p>
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 shrink-0 text-muted-foreground group-hover:text-primary"
                                      asChild
                                    >
                                      <Link href={`/assignments/${asgn.id}`}>
                                        <ChevronRight className="h-4 w-4" />
                                        <span className="sr-only">รายละเอียดการมอบหมาย</span>
                                      </Link>
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent side="top">
                                    <p>รายละเอียดการมอบหมาย</p>
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {!isAssignmentsLoading && displayedAssignments.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-16 text-muted-foreground text-sm">
                            {!assignments || assignments.length === 0 ? (
                              <span className="italic">ยังไม่มีรายการมอบหมายในระบบ</span>
                            ) : (
                              <span>
                                ไม่มีรายการที่ตรงกับการกรอง
                                {filterPoId ? ' (PO นี้)' : ''}
                                {assignmentTableSearch.trim() ? ' หรือคำค้นหา' : ''}
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                  </TooltipProvider>
                )}
              </CardContent>
            </Card>

            <AlertDialog
              open={!!assignmentPendingDelete}
              onOpenChange={(open) => {
                if (!open && !isDeletingAssignment) setAssignmentPendingDelete(null);
              }}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>ลบการมอบหมายนี้?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {assignmentPendingDelete
                      ? `จะลบรายการ ${assignmentPendingDelete.assignmentNo || assignmentPendingDelete.id} — หากผูก Wave แบบเก่าระบบจะปรับจำนวนคนใน Wave ให้สอดคล้อง — การกระทำนี้ไม่สามารถยกเลิกได้`
                      : null}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isDeletingAssignment}>ยกเลิก</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    disabled={isDeletingAssignment}
                    onClick={(e) => {
                      e.preventDefault();
                      void confirmDeleteAssignment();
                    }}
                  >
                    {isDeletingAssignment ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2 inline" />
                        กำลังลบ…
                      </>
                    ) : (
                      'ลบ'
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </div>
    </AppShell>
  );
}

export default function AssignmentsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      }
    >
      <AssignmentsPageContent />
    </Suspense>
  );
}
