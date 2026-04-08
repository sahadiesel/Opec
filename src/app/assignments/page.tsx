'use client';

import { useState, useMemo, useEffect } from 'react';
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
  Waves,
  AlertTriangle,
  Info,
  Loader2,
  ShieldAlert,
  UserX,
  Pencil,
  Trash2,
} from 'lucide-react';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { Input } from '@/components/ui/input';
import {
  htmlDateValueToTimestampMs,
  timestampToHtmlDateValue,
  formatStoredDateRangeThaiBE,
} from '@/lib/date-thai';
import { Assignment, Worker, POLine, User, DeploymentStatus, PurchaseOrder, Wave, Position } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccess, canView, canEdit, canDelete, isMatrixControlledRole } from '@/lib/permissions';
import {
  collection,
  doc,
  increment,
  updateDoc,
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
import { normalizeWaveAllocations, plannedOnWaveForPoLine } from '@/lib/ops/wave-allocation';
import { assignmentCountsTowardQuota } from '@/lib/ops/po-fulfillment-read-model';
import { MOBILIZATION_FULFILLMENT_SUBCOLLECTION } from '@/lib/store/mobilization-fulfillment';

function waveRequiredPositionLabel(
  wave: Wave,
  polines: POLine[] | null | undefined,
  positions: Position[] | null | undefined
): string {
  const labels: string[] = [];
  for (const a of normalizeWaveAllocations(wave)) {
    const line = polines?.find((l) => l.id === a.poLineId && l.poId === wave.poId);
    if (!line?.positionId) continue;
    const pos = positions?.find((p) => p.id === line.positionId);
    labels.push(pos ? positionListPrimaryName(pos as PositionDoc) : line.positionId);
  }
  return labels.join(' · ');
}

export default function AssignmentsPage() {
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

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [assignmentPendingDelete, setAssignmentPendingDelete] = useState<Assignment | null>(null);
  const [isDeletingAssignment, setIsDeletingAssignment] = useState(false);
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [selectedWaveId, setSelectedWaveId] = useState('');
  /** เมื่อเวฟมีหลาย PO line — เลือกบรรทัดก่อนมอบหมาย */
  const [selectedPoLineId, setSelectedPoLineId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');
  const [assignmentTableSearch, setAssignmentTableSearch] = useState('');

  const filterPoId = (searchParams.get('poId') || '').trim() || null;
  const filterPO = useMemo(
    () => (filterPoId && allPOs?.length ? allPOs.find((p) => p.id === filterPoId) : undefined),
    [filterPoId, allPOs]
  );

  const wavesForDialog = useMemo(() => {
    const list = (allWaves || []).filter((w) => w.status !== 'CLOSED');
    if (!filterPoId) return list;
    return list.filter((w) => w.poId === filterPoId);
  }, [allWaves, filterPoId]);

  const displayedAssignments = useMemo(() => {
    let list = assignments || [];
    if (filterPoId) list = list.filter((a) => a.poId === filterPoId);
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

  const occupiedWorkerIds = useMemo(
    () => getOccupiedWorkerIds(assignments || []),
    [assignments],
  );

  const selectedWave = useMemo(
    () => (selectedWaveId ? allWaves?.find((w) => w.id === selectedWaveId) : undefined),
    [allWaves, selectedWaveId],
  );

  const selectedWaveAllocations = useMemo(
    () => (selectedWave ? normalizeWaveAllocations(selectedWave) : []),
    [selectedWave],
  );

  const needPickPoLineForAssign = selectedWaveAllocations.length > 1;

  const targetPositionIdForSelectedWave = useMemo(() => {
    if (!selectedWave || !allPOLines?.length || !selectedPoLineId) return '';
    const line = allPOLines.find(
      (l) => l.id === selectedPoLineId && l.poId === selectedWave.poId
    );
    return line?.positionId || '';
  }, [selectedWave, allPOLines, selectedPoLineId]);

  const availableWorkers = useMemo(() => {
    return (allWorkers || []).filter((w) => {
      if (w.readinessStatus !== 'READY') return false;
      if (occupiedWorkerIds.has(w.id)) return false;
      if (!selectedWaveId || !targetPositionIdForSelectedWave) return false;
      return w.currentPositionId === targetPositionIdForSelectedWave;
    });
  }, [allWorkers, occupiedWorkerIds, selectedWaveId, targetPositionIdForSelectedWave]);

  useEffect(() => {
    setSelectedWorkerId('');
    setSelectedPoLineId('');
    if (!selectedWave) return;
    const allocs = normalizeWaveAllocations(selectedWave);
    if (allocs.length === 1) {
      setSelectedPoLineId(allocs[0].poLineId);
    }
  }, [selectedWaveId, selectedWave]);

  const handleCreateAssignment = async () => {
    if (!canCreateAssignments) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์สร้างการมอบหมายงาน' });
      return;
    }
    if (!firestore || !currentUser || !selectedWorkerId || !selectedWaveId || !startDate || !endDate) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาระบุข้อมูลที่จำเป็นให้ครบถ้วน" });
      return;
    }

    const worker = allWorkers?.find(w => w.id === selectedWorkerId);
    const wave = allWaves?.find(w => w.id === selectedWaveId);
    if (!worker || !wave) return;

    const waveAllocsCheck = normalizeWaveAllocations(wave);
    if (waveAllocsCheck.length > 1 && !selectedPoLineId.trim()) {
      toast({
        variant: 'destructive',
        title: 'เลือกบรรทัด PO / ตำแหน่ง',
        description: 'เวฟนี้มีหลายโควต้า — เลือกว่าจะมอบหมายเข้าบรรทัดใด',
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
    const po = allPOs?.find(p => p.id === wave.poId);
    if (po && (po.poType || 'contract') === 'quotation') {
      toast({
        variant: 'destructive',
        title: 'ไม่สามารถมอบหมายจาก PO สายใบเสนอราคา',
        description:
          'PO แบบใบเสนอราคาใช้สำหรับขายสินค้า/บริการครั้งเดียวจบ ไม่ผูก Wave/มอบหมายคนงาน — ใช้สายใบวางบิลหลังส่งมอบแทน',
      });
      return;
    }
    const waveAllocs = normalizeWaveAllocations(wave);
    const effectivePoLineId =
      waveAllocs.length === 1 ? waveAllocs[0].poLineId : selectedPoLineId.trim();
    if (!effectivePoLineId) {
      toast({
        variant: 'destructive',
        title: 'ไม่พบบรรทัด PO',
        description: 'เวฟนี้ยังไม่มีโควต้าที่ใช้มอบหมายได้ — ตรวจการตั้งค่าเวฟ',
      });
      return;
    }
    const slot = waveAllocs.find((a) => a.poLineId === effectivePoLineId);
    if (!slot || slot.plannedWorkers < 1) {
      toast({
        variant: 'destructive',
        title: 'บรรทัดไม่อยู่ในแผนเวฟ',
        description: 'เลือกบรรทัดที่มีโควต้าในเวฟนี้เท่านั้น',
      });
      return;
    }
    const cap = plannedOnWaveForPoLine(wave, effectivePoLineId);
    const assignedOnSlot = (assignments || []).filter(
      (a) =>
        a.waveId === wave.id &&
        a.poLineId === effectivePoLineId &&
        assignmentCountsTowardQuota(a.deploymentStatus)
    ).length;
    if (assignedOnSlot >= cap) {
      toast({
        variant: 'destructive',
        title: 'ครบโควต้าบรรทัดนี้ในเวฟแล้ว',
        description: `วางแผน ${cap} คนสำหรับบรรทัดนี้ — เพิ่มแผนในเวฟหรือเลือกบรรทัดอื่น`,
      });
      return;
    }

    const poLine = resolvePoLineForWave(allPOLines, wave.poId, effectivePoLineId);
    if (!poLine) {
      toast({
        variant: 'destructive',
        title: 'PO Line ไม่ตรงกับเวฟ',
        description:
          'ไม่พบบรรทัด PO ที่ผูกกับเวฟนี้และ PO เดียวกัน หรือบรรทัดไม่ active — ตรวจข้อมูลเวฟและ PO',
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
      // Atomic Number Generation
      const { code: finalNo } = await generateNextDocumentCode(firestore, 'assignment', { 
        actor: currentUser.displayName 
      });

      // Create in top-level 'mobilizations' collection
      const mobCollectionRef = collection(firestore, 'mobilizations');
      const newMobRef = doc(mobCollectionRef);
      
      const newAssignment: Assignment = {
        id: newMobRef.id,
        assignmentNo: finalNo, // Apply unique sequential code
        workerId: selectedWorkerId,
        poLineId: effectivePoLineId,
        poId: wave.poId,
        contractId: po?.contractId || '',
        waveId: selectedWaveId,
        positionId: position?.id || poLine?.positionId || '', 
        customerId: wave.customerId,
        projectName: wave.projectName,
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
      
      // Update wave assigned workers count
      const waveRef = doc(firestore, 'waves', selectedWaveId);
      updateDoc(waveRef, { assignedWorkers: increment(1), updatedAt: Date.now() });

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
      if (waveId) {
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
            กำหนดรายชื่อ <b>ลูกจ้างหน้างาน (Field Workers)</b> เข้าสู่โครงการและรอบการทำงาน (Wave)
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
                ระบบจะตรวจสอบ <b>ตำแหน่งงาน (Position)</b>, <b>สถานะความพร้อม (Readiness)</b> และ <b>การซ้อนงาน (Overlap)</b> โดยอัตโนมัติ — ห้ามมอบหมายคนงานที่ไม่พร้อม ตำแหน่งไม่ตรง หรือกำลังปฏิบัติงานในเวฟอื่นอยู่
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
                    placeholder="ค้นหาตามลูกจ้าง, Wave หรือรหัส PO..."
                    className="pl-9 h-11"
                    value={assignmentTableSearch}
                    onChange={(e) => setAssignmentTableSearch(e.target.value)}
                  />
                </div>
                <Button variant="outline" className="gap-2 h-11"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
              </div>
              {canCreateAssignments && (
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                  <DialogTrigger asChild>
                    <Button className="gap-2 h-11 px-6 bg-primary shadow-md text-base font-bold">
                      <Plus className="h-5 w-5" /> สร้างการมอบหมายใหม่ (Field Assignment)
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>มอบหมายงาน (Field Crew Assignment)</DialogTitle>
                    <DialogDescription>เลือกคนงานหน้างานและเชื่อมต่อเข้ากับรอบการทำงาน (Wave) ของโครงการ</DialogDescription>
                  </DialogHeader>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                    <div className="space-y-2 md:col-span-2">
                      <Label className="font-bold">เลือกรอบการทำงาน (Active Wave)</Label>
                      <Select value={selectedWaveId || undefined} onValueChange={setSelectedWaveId}>
                        <SelectTrigger className="h-11"><SelectValue placeholder="เลือก Wave ที่เปิดให้มอบหมาย..." /></SelectTrigger>
                        <SelectContent>
                          {wavesForDialog.length === 0 ? (
                            <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                              {filterPoId
                                ? 'ยังไม่มี Wave ที่เปิดอยู่สำหรับ PO นี้ — สร้าง Wave จากเมนู Waves ก่อน'
                                : 'ยังไม่มี Wave ที่เปิดอยู่'}
                            </div>
                          ) : (
                            wavesForDialog.map((wave) => {
                              const posLbl = waveRequiredPositionLabel(wave, allPOLines, allPositions);
                              return (
                                <SelectItem key={wave.id} value={wave.id}>
                                  {wave.waveCode} | {posLbl ? `${posLbl} · ` : ''}
                                  {wave.projectName}
                                </SelectItem>
                              );
                            })
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    {selectedWave && needPickPoLineForAssign ? (
                      <div className="space-y-2 md:col-span-2">
                        <Label className="font-bold">เลือกโควต้า / บรรทัด PO (ในเวฟนี้)</Label>
                        <Select value={selectedPoLineId || undefined} onValueChange={setSelectedPoLineId}>
                          <SelectTrigger className="h-11">
                            <SelectValue placeholder="เลือกตำแหน่งที่จะมอบหมาย..." />
                          </SelectTrigger>
                          <SelectContent>
                            {selectedWaveAllocations.map((a) => {
                              const line = allPOLines?.find(
                                (l) => l.id === a.poLineId && l.poId === selectedWave.poId
                              );
                              const pos = line?.positionId
                                ? allPositions?.find((p) => p.id === line.positionId)
                                : undefined;
                              const name = pos
                                ? positionListPrimaryName(pos as PositionDoc)
                                : line?.positionId || a.poLineId;
                              const used = (assignments || []).filter(
                                (x) =>
                                  x.waveId === selectedWave.id &&
                                  x.poLineId === a.poLineId &&
                                  assignmentCountsTowardQuota(x.deploymentStatus)
                              ).length;
                              return (
                                <SelectItem key={a.poLineId} value={a.poLineId}>
                                  {name} · แผน {a.plannedWorkers} · มอบหมายแล้ว {used}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : null}
                    <div className="space-y-2 md:col-span-2">
                      <Label className="font-bold">เลือกคนงานหน้างาน (Select Field Worker)</Label>
                      <Select
                        value={selectedWorkerId || undefined}
                        onValueChange={setSelectedWorkerId}
                        disabled={
                          !selectedWaveId ||
                          !targetPositionIdForSelectedWave ||
                          (needPickPoLineForAssign && !selectedPoLineId)
                        }
                      >
                        <SelectTrigger className="h-11">
                          <SelectValue
                            placeholder={
                              !selectedWaveId
                                ? 'เลือก Wave ก่อน'
                                : needPickPoLineForAssign && !selectedPoLineId
                                  ? 'เลือกบรรทัด PO ในเวฟก่อน'
                                  : !targetPositionIdForSelectedWave
                                    ? 'Wave นี้ไม่มีตำแหน่งจาก PO line'
                                    : 'เลือกคนงานตำแหน่งเดียวกับ Wave และสถานะ READY'
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
                        * หลังเลือก Wave ระบบจะแสดงเฉพาะลูกจ้างที่ตำแหน่งตรงกับโควต้าเวฟนั้น สถานะความพร้อม READY (เอกสาร/แพทย์/แผงสารเสพติดผ่านตามทะเบียน)
                        และยังไม่ถูกมอบหมายซ้อน
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
                        disabled={
                          isCreating ||
                          (needPickPoLineForAssign && !!selectedWaveId && !selectedPoLineId)
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
                        <TableHead className="font-bold">Wave & โครงการ</TableHead>
                        <TableHead className="font-bold">ช่วงเวลา (Schedule)</TableHead>
                        <TableHead className="font-bold">ความพร้อม (Readiness)</TableHead>
                        <TableHead className="font-bold">สถานะ Deployment</TableHead>
                        <TableHead className="text-right pr-6">จัดการ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {displayedAssignments.map((asgn) => {
                        const worker = allWorkers?.find(w => w.id === asgn.workerId);
                        const wave = allWaves?.find(w => w.id === asgn.waveId);
                        
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
                              <div className="flex flex-col">
                                <span className="font-bold text-sm text-primary flex items-center gap-1"><Waves className="h-3.5 w-3.5" /> {wave?.waveCode || 'N/A'}</span>
                                <span className="text-[10px] text-muted-foreground font-mono uppercase truncate max-w-[150px]">{asgn.projectName}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-bold">
                                <Calendar className="h-3.5 w-3.5" />
                                {formatStoredDateRangeThaiBE(asgn.startDate, asgn.endDate)}
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
                          <TableCell colSpan={6} className="text-center py-16 text-muted-foreground text-sm">
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
                      ? `จะลบรายการ ${assignmentPendingDelete.assignmentNo || assignmentPendingDelete.id} และปรับจำนวนคนใน Wave ให้สอดคล้อง — การกระทำนี้ไม่สามารถยกเลิกได้`
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
