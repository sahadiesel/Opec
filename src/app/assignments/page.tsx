'use client';

import { useState, useMemo, useEffect, useRef, Suspense } from 'react';
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
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { Input } from '@/components/ui/input';
import {
  htmlDateValueToTimestampMs,
  timestampToHtmlDateValue,
  formatStoredDateRangeThaiBE,
} from '@/lib/date-thai';
import { Assignment, Worker, POLine, DeploymentStatus, PurchaseOrder, Wave, Position } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccess, canView, canEdit, canDelete, isMatrixControlledRole } from '@/lib/permissions';
import {
  collection,
  doc,
  increment,
  collectionGroup,
  getDocs,
  writeBatch,
} from 'firebase/firestore';
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
import { setDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';
import { checkWorkerAssignmentOverlap, getOccupiedWorkerIds } from '@/lib/services/assignment-overlap';
import { positionListPrimaryName, type PositionDoc } from '@/lib/position-display';
import { PoFilterContextBanner } from '@/components/ops/po-filter-context-banner';
import { resolvePoLineForWave } from '@/lib/ops/resolve-po-line';
import { assignmentCountsTowardQuota, buildPoFulfillmentByLine } from '@/lib/ops/po-fulfillment-read-model';
import { dedupeAssignmentsByWorkerAndWave } from '@/lib/ops/assignment-roster';
import { MOBILIZATION_FULFILLMENT_SUBCOLLECTION } from '@/lib/store/mobilization-fulfillment';
import { mobilizationWorkerNameFromWorker } from '@/lib/ops/mobilization-worker-name';
import { isPoRosterWaveId } from '@/lib/ops/po-roster-wave';
import { isPoTimesheetScopeId, poTimesheetScopeId } from '@/lib/constants/timesheet-po-scope';
import { addMonths } from 'date-fns';

/** คีย์รวมใน dialog: poId + lineId — ไม่ต้องเลือก PO แยกเมื่อดึงบรรทัดจากทุก PO */
const DIALOG_LINE_KEY_SEP = '###';

function encodeDialogLinePickKey(poId: string, lineId: string): string {
  return `${poId}${DIALOG_LINE_KEY_SEP}${lineId}`;
}

function parseDialogLinePickKey(key: string): { poId: string; lineId: string } | null {
  const i = key.indexOf(DIALOG_LINE_KEY_SEP);
  if (i <= 0 || i + DIALOG_LINE_KEY_SEP.length >= key.length) return null;
  return { poId: key.slice(0, i), lineId: key.slice(i + DIALOG_LINE_KEY_SEP.length) };
}

/** วันเริ่ม = วันมอบหมาย (วันนี้) · วันจบ = +1 เดือน — เก็บเป็น yyyy-mm-dd */
function defaultAssignmentScheduleRange(): { start: string; end: string } {
  const now = Date.now();
  const start = timestampToHtmlDateValue(now);
  const end = timestampToHtmlDateValue(addMonths(new Date(now), 1).getTime());
  return { start, end };
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
      (useMatrixGuards ? canAccess(currentUser, 'assignments', 'delete') : canDelete(currentUser, 'assignments')),
    [currentUser, useMatrixGuards]
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

  const poLinesQuery = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return collectionGroup(firestore, 'po_lines');
  }, [firestore, isAuthorized]);
  const { data: allPOLines } = useCollection<POLine>(poLinesQuery as any);

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
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');
  const [assignmentTableSearch, setAssignmentTableSearch] = useState('');

  const filterPoId = (searchParams.get('poId') || '').trim() || null;
  const filterPoLineId = (searchParams.get('poLineId') || '').trim() || null;
  const openDialogFromUrl = searchParams.get('openDialog') === '1';
  const openDialogKeyRef = useRef<string>('');
  const filterPO = useMemo(
    () => (filterPoId && allPOs?.length ? allPOs.find((p) => p.id === filterPoId) : undefined),
    [filterPoId, allPOs]
  );

  const contractActivePOs = useMemo(
    () => (allPOs || []).filter((p) => p.status === 'active' && (p.poType || 'contract') === 'contract'),
    [allPOs],
  );

  const dialogPoLineFulfillmentFiltered = useMemo(() => {
    if (!filterPoId) return [];
    return buildPoFulfillmentByLine(allPOLines, assignments, allWaves, filterPoId);
  }, [filterPoId, allPOLines, assignments, allWaves]);

  const poLinesForDialogPickFiltered = useMemo(
    () => dialogPoLineFulfillmentFiltered.filter((r) => r.lineStatus === 'active'),
    [dialogPoLineFulfillmentFiltered],
  );

  /** บรรทัด PO active ทุกตัวจากทุก PO สายสัญญา — ใช้เมื่อไม่ได้กรอง poId */
  const allFlatPoLinesForDialog = useMemo(() => {
    const poById = new Map(contractActivePOs.map((p) => [p.id, p]));
    const out: Array<{
      poId: string;
      poCode: string;
      lineId: string;
      positionLabel: string;
      assignedCount: number;
      requiredQty: number;
      remainingSlots: number;
    }> = [];
    for (const po of contractActivePOs) {
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
  }, [contractActivePOs, allPOLines, assignments, allWaves, allPositions]);

  const parsedDialogLinePick = useMemo(
    () => parseDialogLinePickKey(dialogLinePickKey),
    [dialogLinePickKey],
  );

  const effectiveDialogPoId = filterPoId || parsedDialogLinePick?.poId || '';
  const effectiveDialogLineId = parsedDialogLinePick?.lineId || '';

  const displayedAssignments = useMemo(() => {
    let list = assignments || [];
    if (filterPoId) list = list.filter((a) => a.poId === filterPoId);
    list = dedupeAssignmentsByWorkerAndWave(list);
    const q = assignmentTableSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((a) => {
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
    });
  }, [assignments, filterPoId, assignmentTableSearch, allWorkers, allWaves, allPOs]);

  /** ใช้เฉพาะตอนยังไม่มีช่วงวันที่ — fallback */
  const occupiedWorkerIds = useMemo(
    () => getOccupiedWorkerIds(assignments || []),
    [assignments],
  );

  const targetPositionIdForDialogLine = useMemo(() => {
    if (!effectiveDialogPoId || !effectiveDialogLineId || !allPOLines?.length) return '';
    const line = allPOLines.find((l) => l.id === effectiveDialogLineId && l.poId === effectiveDialogPoId);
    return line?.positionId || '';
  }, [effectiveDialogPoId, effectiveDialogLineId, allPOLines]);

  const availableWorkers = useMemo(() => {
    if (!effectiveDialogPoId || !effectiveDialogLineId || !targetPositionIdForDialogLine) return [];
    const rangeStart = (startDate && startDate.trim()) || '';
    const rangeEnd = (endDate && endDate.trim()) || '';
    return (allWorkers || []).filter((w) => {
      if (w.readinessStatus !== 'READY') return false;
      if (w.currentPositionId !== targetPositionIdForDialogLine) return false;
      if (rangeStart && rangeEnd) {
        const { hasOverlap } = checkWorkerAssignmentOverlap(
          assignments || [],
          w.id,
          rangeStart,
          rangeEnd,
        );
        return !hasOverlap;
      }
      if (occupiedWorkerIds.has(w.id)) return false;
      return true;
    });
  }, [
    allWorkers,
    effectiveDialogPoId,
    effectiveDialogLineId,
    targetPositionIdForDialogLine,
    startDate,
    endDate,
    assignments,
    occupiedWorkerIds,
  ]);

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

  /** เมื่อเปิด dialog: default วันเริ่ม = วันมอบหมาย · วันจบ = +1 เดือน */
  useEffect(() => {
    if (!isDialogOpen) return;
    const { start, end } = defaultAssignmentScheduleRange();
    setStartDate(start);
    setEndDate(end);
  }, [isDialogOpen]);

  const handleCreateAssignment = async () => {
    if (!canCreateAssignments) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์สร้างการมอบหมายงาน' });
      return;
    }
    const parsedPick = parseDialogLinePickKey(dialogLinePickKey);
    const dialogPoIdResolved = (filterPoId || parsedPick?.poId || '').trim();
    const dialogPoLineIdResolved = (parsedPick?.lineId || '').trim();

    if (!firestore || !currentUser || !selectedWorkerId || !dialogPoIdResolved || !dialogPoLineIdResolved || !startDate || !endDate) {
      toast({
        variant: 'destructive',
        title: 'ข้อมูลไม่ครบ',
        description: 'กรุณาเลือกบรรทัด PO / ตำแหน่ง / คนงาน และช่วงวันที่ให้ครบ',
      });
      return;
    }

    const worker = allWorkers?.find(w => w.id === selectedWorkerId);
    const po = allPOs?.find((p) => p.id === dialogPoIdResolved);
    if (!worker || !po) return;

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
    if (worker.readinessStatus !== 'READY') {
      const policyHint =
        worker.readinessStatus === 'BLOCKED'
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
    const overlap = checkWorkerAssignmentOverlap(
      assignments || [],
      selectedWorkerId,
      startDate,
      endDate,
    );
    if (overlap.hasOverlap) {
      const first = overlap.blockingAssignments[0];
      toast({
        variant: 'destructive',
        title: 'คนงานมีงานมอบหมายอยู่แล้ว (Already Assigned)',
        description: `${worker.firstName} ${worker.lastName} ถูกมอบหมายอยู่ในโครงการ "${first.projectName}" (${first.assignmentNo}) ช่วง ${formatStoredDateRangeThaiBE(first.startDate, first.endDate)} ต้องรอจบภารกิจ (Demobilize/Close) ก่อนมอบหมายใหม่`,
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
        assignmentCountsTowardQuota(a.deploymentStatus),
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

    const targetPositionId = poLine.positionId;
    const position = allPositions?.find(p => p.id === targetPositionId);
    const resolvedWorkMode = position?.jobMode || 'OFFSHORE';

    // 4. Position Suitability Check
    if (worker.currentPositionId !== targetPositionId) {
      const targetPosName = position?.positionName || position?.positionNameTh || targetPositionId;
      const workerPos = allPositions?.find((p) => p.id === worker.currentPositionId);
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

      // Atomic Number Generation
      const { code: finalNo } = await generateNextDocumentCode(firestore, 'assignment', { 
        actor: currentUser.displayName 
      });

      // Create in top-level 'mobilizations' collection
      const mobCollectionRef = collection(firestore, 'mobilizations');
      const newMobRef = doc(mobCollectionRef);
      
      const workerDisplayName = mobilizationWorkerNameFromWorker(worker);
      const locFromLine = (poLine.workLocation || '').trim();
      const newAssignment: Assignment = {
        id: newMobRef.id,
        assignmentNo: finalNo, // Apply unique sequential code
        workerId: selectedWorkerId,
        workerName: workerDisplayName,
        poLineId: effectivePoLineId,
        poId: dialogPoIdResolved,
        contractId: po?.contractId || '',
        waveId: tsScopeId,
        positionId: position?.id || poLine?.positionId || '', 
        customerId: po.customerId,
        projectName: po.projectName || po.title,
        workLocation: locFromLine || undefined,
        workLocationUpdatedAt: locFromLine ? Date.now() : undefined,
        workLocationUpdatedByUserId: locFromLine ? currentUser.id : undefined,
        startDate: startDate,
        endDate: endDate,
        deploymentStatus: 'DRAFT',
        clientApprovalStatus: 'NOT_SUBMITTED',
        readinessStatus: 'ready', // Worker was validated as ready before creation
        workMode: resolvedWorkMode,
        readinessSummary: {
          passportValid: 'pass',
          medicalValid: 'pass',
          certificatesComplete: 'pass',
          safetyTrainingComplete: 'pass',
          fitToWork: 'pass',
          ppeIssued: 'missing',
          toolsIssued: 'missing',
          overlapClear: overlap.hasOverlap ? 'fail' : 'pass',
          clientApproved: 'missing'
        },
        notes: notes,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      setDocumentNonBlocking(newMobRef, newAssignment, { merge: true });

      toast({ title: "มอบหมายงานสำเร็จ", description: `รหัสการมอบหมาย: ${finalNo}` });
      setIsDialogOpen(false);
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถบันทึกการมอบหมายได้" });
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
      case 'DRAFT': return <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200 uppercase font-bold">Draft</Badge>;
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
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <UserPlus className="h-8 w-8" /> การมอบหมายลูกจ้าง (Worker Assignments)
          </h1>
          <p className="text-muted-foreground text-lg">
            กำหนดรายชื่อ <b>ลูกจ้างหน้างาน</b> ให้ชัดเจนต่อ <b>บรรทัดคำสั่งจ้าง (PO line)</b> ภายใต้สัญญา — ช่วงเริ่ม–สิ้นสุดอยู่ที่การมอบหมาย; ค่าแรงขาย/ต้นทุนสำหรับ payroll ยึดตามสัญญาและอัตราที่ลงในสัญญา (operations_manager / HR / Admin)
          </p>
        </div>

        {!isAuthorized ? (
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
            <Info className="h-12 w-12 text-muted-foreground opacity-50" />
            <h2 className="text-xl font-bold">Access Pending (รอนุมัติสิทธิ์)</h2>
            <p className="text-muted-foreground max-w-md">บัญชีของคุณยังไม่ได้รับการกำหนดบทบาท กรุณาติดต่อผู้ดูแลระบบ</p>
          </div>
        ) : (
          <>
            <Alert className="bg-amber-50 border-amber-200 text-amber-800 shadow-sm">
              <ShieldAlert className="h-5 w-5 text-amber-600" />
              <AlertTitle className="font-bold">นโยบายความเหมาะสม (Suitability Policy)</AlertTitle>
              <AlertDescription className="text-sm">
                ระบบจะตรวจสอบ <b>ตำแหน่งงาน (Position)</b>, <b>สถานะความพร้อม (Readiness)</b> และ <b>การซ้อนงาน (Overlap)</b> โดยอัตโนมัติ — ห้ามมอบหมายคนงานที่ไม่พร้อม ตำแหน่งไม่ตรง หรือช่วงวันที่ชนกับ assignment อื่น
                <span className="block mt-2 text-amber-900/90">
                  ตารางนี้แสดง <b>1 แถวต่อคน</b> (โควต้าตามบรรทัด PO) — demob/ปิดก่อนมอบหมายช่วงใหม่จะไม่ซ้อน หากยัง active อยู่
                </span>
              </AlertDescription>
            </Alert>

            <PoFilterContextBanner
              poId={filterPoId}
              po={filterPO}
              listBasePath="/assignments"
              moduleLabel="Assignments"
            />

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
                  <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>มอบหมายงาน (Field Crew Assignment)</DialogTitle>
                    <DialogDescription>
                      {filterPoId ? (
                        <>
                          เลือก <strong>บรรทัด PO / ตำแหน่ง</strong> ด้านล่าง — แสดงชัดเจนว่าตำแหน่งไหนว่างหรือเต็มตามโควต้า PO และตั้งช่วงวันที่มอบหมาย (ลงเวลาอิง PO + assignment)
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
                            {contractActivePOs.length === 0 ? (
                              <p className="py-2 text-center text-xs text-muted-foreground">
                                ไม่มี PO สายสัญญาที่ Active — อนุมัติ PO ที่เมนู Customer PO ก่อน
                              </p>
                            ) : (
                              contractActivePOs.map((p) => (
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
                            ไม่ต้องเลือก PO ที่นี่ — ไปเลือกบรรทัด/ตำแหน่งในช่องด้านล่าง (ครอบคลุมทุก PO)
                          </p>
                        </>
                      )}
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label className="font-bold">
                        {filterPoId
                          ? 'เลือกบรรทัด PO / ตำแหน่ง (โควต้าตาม PO ที่กรอง)'
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
                                : contractActivePOs.length === 0
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
                        * แสดงเฉพาะตำแหน่งตรงบรรทัด PO + READY ที่ <strong>ไม่มี assignment ทับช่วงวันที่</strong> — Demobilize หรือปิดรายการเดิมก่อนมอบหมายซ้อน
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label className="font-bold">วันที่เริ่มงาน (Start Date)</Label>
                      <DatePickerThaiBE
                        className="h-11"
                        value={htmlDateValueToTimestampMs(startDate)}
                        onChange={(ms) => setStartDate(timestampToHtmlDateValue(ms))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="font-bold">วันที่สิ้นสุดงาน (End Date)</Label>
                      <DatePickerThaiBE
                        className="h-11"
                        value={htmlDateValueToTimestampMs(endDate)}
                        onChange={(ms) => setEndDate(timestampToHtmlDateValue(ms))}
                      />
                    </div>
                  </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isCreating}>ยกเลิก</Button>
                      <Button
                        onClick={handleCreateAssignment}
                        className="bg-primary font-bold"
                        disabled={isCreating || !dialogLinePickKey.trim()}
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
                        <TableHead className="font-bold">ช่วงเวลา (Schedule)</TableHead>
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
                              <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-bold">
                                <Calendar className="h-3.5 w-3.5" />
                                {formatStoredDateRangeThaiBE(asgn.startDate, asgn.endDate)}
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
