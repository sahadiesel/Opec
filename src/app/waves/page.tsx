'use client';

import { useState, useMemo, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Plus, 
  Search, 
  Filter, 
  Waves, 
  ChevronRight, 
  Calendar, 
  Building2, 
  Info, 
  AlertCircle,
  Users,
  MapPin,
  ArrowRight,
  Loader2,
  Pencil,
  Trash2,
} from 'lucide-react';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { Input } from '@/components/ui/input';
import {
  htmlDateValueToTimestampMs,
  timestampToHtmlDateValue,
  formatYmdRangeThaiBE,
} from '@/lib/date-thai';
import { Assignment, Wave, Customer, PurchaseOrder, POLine, WaveStatus, Position, WaveLineAllocation } from '@/lib/types';
import { positionListPrimaryName, type PositionDoc } from '@/lib/position-display';
import { Badge } from '@/components/ui/badge';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canView, canEdit, canManageWaveRecords } from '@/lib/permissions';
import { collection, collectionGroup, doc, deleteDoc, updateDoc } from 'firebase/firestore';
import { addDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';
import { PoFilterContextBanner } from '@/components/ops/po-filter-context-banner';
import {
  deriveSiteLocationFromAllocations,
  normalizeWaveAllocations,
  sumPlannedForPoLineAcrossWaves,
  totalPlannedWorkersOnWave,
} from '@/lib/ops/wave-allocation';
import { assignmentCountsTowardQuota } from '@/lib/ops/po-fulfillment-read-model';
import { isAssignmentActiveOnWaveRoster, pickRosterLinePerWorker } from '@/lib/ops/assignment-roster';

/** จำนวนคนที่ยังวางแผนในเวฟได้เพิ่มสำหรับ PO line นี้ (หรือแก้ไขเวฟเดิมเมื่อส่ง excludeWaveId) */
function remainingQuotaForPoLine(
  line: POLine,
  waveList: Wave[] | null | undefined,
  excludeWaveId?: string | null
): number {
  if (line.status !== 'active') return 0;
  const cap = Math.max(0, Number(line.quantity) || 0);
  const used = sumPlannedForPoLineAcrossWaves(waveList, line.poId, line.id, excludeWaveId);
  return Math.max(0, cap - used);
}

function countAssignedOnWaveLine(
  mobs: Assignment[] | null | undefined,
  waveId: string,
  poLineId: string
): number {
  if (!mobs?.length) return 0;
  return mobs.filter(
    (a) =>
      a.waveId === waveId &&
      a.poLineId === poLineId &&
      assignmentCountsTowardQuota(a.deploymentStatus)
  ).length;
}

function poLinePositionLabel(line: POLine, positions: Position[] | null | undefined): string {
  const pos = positions?.find((p) => p.id === line.positionId);
  if (pos) return positionListPrimaryName(pos as PositionDoc);
  return line.positionId || '—';
}

function poLinePositionCode(line: POLine, positions: Position[] | null | undefined): string {
  const pos = positions?.find((p) => p.id === line.positionId);
  const code = pos?.positionCode?.trim();
  if (code) return code;
  return line.positionId ? `ID:${line.positionId.slice(0, 8)}…` : '—';
}

/** เวฟเชื่อม quota/timesheet ตามสัญญา — ใช้ได้เฉพาะ PO สายสัญญา ไม่ใช้ PO จากใบเสนอราคา */
function isContractBasedPo(p: PurchaseOrder | undefined | null): boolean {
  if (!p) return false;
  return (p.poType || 'contract') === 'contract';
}

const defaultNewWaveState = (): Partial<Wave> => ({
  waveCode: getPreviewPattern('wave'),
  status: 'PLANNING',
  plannedWorkers: 0,
  poLineId: '',
  siteLocation: '',
  notes: '',
});

function WavesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const canEditWavesRow = useMemo(() => canEdit(currentUser ?? null, 'waves'), [currentUser]);
  const canDeleteWaveRow = useMemo(() => canManageWaveRecords(currentUser ?? null), [currentUser]);

  const isStaff = useMemo(
    () => !!currentUser && canView(currentUser, 'waves'),
    [currentUser]
  );

  const wavesQuery = useMemoFirebase(() => {
    if (!firestore || isUserLoading || userLoading || !firebaseUser || !isStaff) return null;
    return collection(firestore, 'waves');
  }, [firestore, isUserLoading, userLoading, firebaseUser, isStaff]);

  const { data: waves, isLoading: isWavesLoading } = useCollection<Wave>(wavesQuery as any);

  const customersQuery = useMemoFirebase(() => {
    if (!firestore || !isStaff) return null;
    return collection(firestore, 'customers');
  }, [firestore, isStaff]);
  const { data: customers } = useCollection<Customer>(customersQuery as any);

  const poQuery = useMemoFirebase(() => {
    if (!firestore || !isStaff) return null;
    return collection(firestore, 'purchase_orders');
  }, [firestore, isStaff]);
  const { data: allPOs } = useCollection<PurchaseOrder>(poQuery as any);

  const poLinesQuery = useMemoFirebase(() => {
    if (!firestore || !isStaff) return null;
    return collectionGroup(firestore, 'po_lines');
  }, [firestore, isStaff]);
  const { data: allPOLines } = useCollection<POLine>(poLinesQuery as any);

  const positionsQuery = useMemoFirebase(() => {
    if (!firestore || !isStaff) return null;
    return collection(firestore, 'positions');
  }, [firestore, isStaff]);
  const { data: allPositions } = useCollection<Position>(positionsQuery as any);

  const mobilizationsQuery = useMemoFirebase(() => {
    if (!firestore || !isStaff) return null;
    return collection(firestore, 'mobilizations');
  }, [firestore, isStaff]);
  const { data: allMobilizations } = useCollection<Assignment>(mobilizationsQuery as any);

  const [waveFormOpen, setWaveFormOpen] = useState(false);
  const [editingWave, setEditingWave] = useState<Wave | null>(null);
  const [isSavingWave, setIsSavingWave] = useState(false);
  const [wavePendingDelete, setWavePendingDelete] = useState<Wave | null>(null);
  const [isDeletingWave, setIsDeletingWave] = useState(false);
  const [newWave, setNewWave] = useState<Partial<Wave>>(() => defaultNewWaveState());
  /** จำนวนคนต่อ PO line ในฟอร์มเวฟ (หลายบรรทัดใน 1 เวฟ) */
  const [allocationInputs, setAllocationInputs] = useState<Record<string, number>>({});
  const [waveTableSearch, setWaveTableSearch] = useState('');

  const filterPoId = (searchParams.get('poId') || '').trim() || null;
  const filterPO = useMemo(
    () => (filterPoId && allPOs?.length ? allPOs.find((p) => p.id === filterPoId) : undefined),
    [filterPoId, allPOs]
  );

  /** สร้างเวฟใหม่ได้เฉพาะ PO สายสัญญาที่อนุมัติแล้ว (active) */
  const activePOsForNewWave = useMemo(
    () =>
      (allPOs || []).filter((p) => p.status === 'active' && isContractBasedPo(p)),
    [allPOs],
  );

  /** ฟอร์มเวฟ: สร้างใหม่ = เฉพาะสายสัญญา — แก้ไขเวฟ = รวม PO ปัจจุบันถ้าเป็น PO ใบเสนอราคา (เอกสารเก่า) */
  const posForWaveSelect = useMemo(() => {
    if (!editingWave) return activePOsForNewWave;
    const base = (allPOs || []).filter((p) => p.status === 'active' && isContractBasedPo(p));
    const curId = editingWave.poId;
    if (!curId) return base;
    const cur = allPOs?.find((p) => p.id === curId);
    if (cur && !base.some((p) => p.id === curId)) {
      return [...base, cur].sort((a, b) => a.poCode.localeCompare(b.poCode, undefined, { numeric: true }));
    }
    return base;
  }, [allPOs, activePOsForNewWave, editingWave]);

  const filterPoAllowsNewWave =
    !filterPoId || (filterPO?.status === 'active' && isContractBasedPo(filterPO));

  const wantOpenNewWaveFromPo = searchParams.get('newWave') === '1';
  const newWaveAutoOpenRef = useRef(false);

  useEffect(() => {
    if (!wantOpenNewWaveFromPo) {
      newWaveAutoOpenRef.current = false;
      return;
    }
    if (!isStaff || !filterPoId) return;
    if (filterPO && filterPO.status !== 'active') {
      toast({
        variant: 'destructive',
        title: 'ยังสร้างเวฟไม่ได้',
        description: 'Customer PO ต้องได้รับการอนุมัติ (สถานะ Active) ก่อน — ไปที่หน้า PO แล้วกดอนุมัติ',
      });
      router.replace(`/waves?poId=${encodeURIComponent(filterPoId)}`, { scroll: false });
      return;
    }
    if (filterPO && !isContractBasedPo(filterPO)) {
      toast({
        variant: 'destructive',
        title: 'ยังสร้างเวฟไม่ได้',
        description:
          'สร้างเวฟได้เฉพาะ PO ที่มาจากสัญญา — PO จากใบเสนอราคาไม่ใช้ Wave / timesheet',
      });
      router.replace(`/waves?poId=${encodeURIComponent(filterPoId)}`, { scroll: false });
      return;
    }
    if (newWaveAutoOpenRef.current) return;
    newWaveAutoOpenRef.current = true;
    setEditingWave(null);
    setAllocationInputs({});
    setNewWave({ ...defaultNewWaveState(), poId: filterPoId });
    setWaveFormOpen(true);
    router.replace(`/waves?poId=${encodeURIComponent(filterPoId)}`, { scroll: false });
  }, [wantOpenNewWaveFromPo, isStaff, filterPoId, filterPO, router, toast]);

  const quotaExcludeWaveId = editingWave?.id ?? null;

  const eligiblePoLinesForCreate = useMemo(() => {
    if (!newWave.poId || !allPOLines?.length) return [];
    const list = allPOLines.filter((l) => l.poId === newWave.poId);
    const byRemaining = (l: POLine) =>
      remainingQuotaForPoLine(l, waves, quotaExcludeWaveId) > 0;
    let candidates = list.filter((l) => l.status === 'active' && byRemaining(l));
    const editingLineIds =
      editingWave ? normalizeWaveAllocations(editingWave).map((a) => a.poLineId) : [];
    for (const lid of editingLineIds) {
      const cur = list.find((l) => l.id === lid);
      if (cur && !candidates.some((c) => c.id === cur.id)) {
        candidates = [...candidates, cur];
      }
    }
    return [...candidates].sort((a, b) => {
      const na = poLinePositionLabel(a, allPositions);
      const nb = poLinePositionLabel(b, allPositions);
      if (na !== nb) return na.localeCompare(nb, 'th');
      return poLinePositionCode(a, allPositions).localeCompare(poLinePositionCode(b, allPositions), 'th');
    });
  }, [newWave.poId, allPOLines, allPositions, waves, quotaExcludeWaveId, editingWave]);

  const allocationDraftEntries = useMemo((): WaveLineAllocation[] => {
    return eligiblePoLinesForCreate
      .map((line) => ({
        poLineId: line.id,
        plannedWorkers: Math.max(0, Math.floor(allocationInputs[line.id] ?? 0)),
      }))
      .filter((x) => x.plannedWorkers > 0);
  }, [eligiblePoLinesForCreate, allocationInputs]);

  const derivedWaveSiteLocation = useMemo(() => {
    if (!newWave.poId || !allPOLines?.length) return '';
    return deriveSiteLocationFromAllocations(allocationDraftEntries, allPOLines, newWave.poId);
  }, [newWave.poId, allPOLines, allocationDraftEntries]);

  const totalPlannedFromInputs = useMemo(
    () => allocationDraftEntries.reduce((s, a) => s + a.plannedWorkers, 0),
    [allocationDraftEntries]
  );

  const waveFormCanSubmit = useMemo(() => {
    if (!newWave.poId) return false;
    if (totalPlannedFromInputs < 1) return false;
    for (const line of eligiblePoLinesForCreate) {
      const n = Math.max(0, Math.floor(allocationInputs[line.id] ?? 0));
      if (n < 1) continue;
      const rem = remainingQuotaForPoLine(line, waves, quotaExcludeWaveId);
      if (n > rem) return false;
    }
    if (!eligiblePoLinesForCreate.some((line) => Math.floor(allocationInputs[line.id] ?? 0) >= 1)) {
      return false;
    }
    if (editingWave && allMobilizations?.length) {
      for (const line of eligiblePoLinesForCreate) {
        const n = Math.floor(allocationInputs[line.id] ?? 0);
        const asg = countAssignedOnWaveLine(allMobilizations, editingWave.id, line.id);
        if (n < asg) return false;
      }
    }
    return true;
  }, [
    newWave.poId,
    totalPlannedFromInputs,
    eligiblePoLinesForCreate,
    allocationInputs,
    waves,
    quotaExcludeWaveId,
    editingWave,
    allMobilizations,
  ]);

  const handleCreate = async () => {
    if (!firestore || !currentUser || editingWave) return;
    if (!newWave.poId) {
      toast({ variant: 'destructive', title: 'ข้อมูลไม่ครบ', description: 'กรุณาเลือก Customer PO' });
      return;
    }
    const headerPoCreate = allPOs?.find((p) => p.id === newWave.poId);
    if (headerPoCreate?.status === 'closed') {
      toast({
        variant: 'destructive',
        title: 'PO ปิดแล้ว',
        description: 'ไม่สามารถสร้าง Wave ใน PO นี้ — สร้าง Customer PO ฉบับใหม่',
      });
      return;
    }
    if (!headerPoCreate || headerPoCreate.status !== 'active') {
      toast({
        variant: 'destructive',
        title: 'PO ยังไม่ Active',
        description: 'อนุมัติ Customer PO ให้เป็น Active ก่อนสร้างเวฟ',
      });
      return;
    }
    if (!isContractBasedPo(headerPoCreate)) {
      toast({
        variant: 'destructive',
        title: 'ใช้ PO สายสัญญาเท่านั้น',
        description:
          'เวฟงานเชื่อมกับ quota ตามสัญญาและ timesheet — PO จากใบเสนอราคาไม่สร้าง Wave',
      });
      return;
    }

    const allocations: WaveLineAllocation[] = [];
    for (const line of eligiblePoLinesForCreate) {
      const n = Math.max(0, Math.floor(allocationInputs[line.id] ?? 0));
      if (n < 1) continue;
      if (line.status !== 'active') {
        toast({
          variant: 'destructive',
          title: 'PO Line ไม่ active',
          description: 'ไม่สามารถใช้บรรทัดที่ยกเลิก/ปิดแล้วในเวฟ',
        });
        return;
      }
      if (!line.positionId?.trim()) {
        toast({
          variant: 'destructive',
          title: 'ไม่มีตำแหน่งในบรรทัด PO',
          description: `แก้บรรทัด PO (${poLinePositionLabel(line, allPositions)}) ให้มีตำแหน่งงานก่อน`,
        });
        return;
      }
      const remaining = remainingQuotaForPoLine(line, waves, null);
      if (n > remaining) {
        toast({
          variant: 'destructive',
          title: 'เกินโควต้า',
          description: `${poLinePositionLabel(line, allPositions)}: วางได้ไม่เกิน ${remaining} คน`,
        });
        return;
      }
      allocations.push({ poLineId: line.id, plannedWorkers: n });
    }

    if (allocations.length < 1) {
      toast({
        variant: 'destructive',
        title: 'ยังไม่ได้ระบุจำนวนคน',
        description: 'กรอกจำนวนคนตามบรรทัด PO อย่างน้อย 1 บรรทัด',
      });
      return;
    }

    const totalPlanned = allocations.reduce((s, a) => s + a.plannedWorkers, 0);
    const siteLoc = deriveSiteLocationFromAllocations(allocations, allPOLines, newWave.poId);

    setIsSavingWave(true);
    try {
      const { code: finalNo } = await generateNextDocumentCode(firestore, 'wave', { actor: currentUser.displayName });

      const po = allPOs?.find((p) => p.id === newWave.poId);
      const waveRef = collection(firestore, 'waves');

      const docRef = await addDocumentNonBlocking(waveRef, {
        ...newWave,
        waveCode: finalNo,
        lineAllocations: allocations,
        poLineId: allocations[0].poLineId,
        plannedWorkers: totalPlanned,
        siteLocation: siteLoc,
        rotationPattern: '',
        customerId: po?.customerId || '',
        projectName: po?.projectName || po?.title || '',
        assignedWorkers: 0,
        createdAt: Date.now(),
        createdBy: currentUser.id,
        updatedAt: Date.now(),
        updatedBy: currentUser.id,
      });

      setWaveFormOpen(false);
      setEditingWave(null);
      setAllocationInputs({});
      setNewWave(defaultNewWaveState());
      toast({ title: 'สร้างเวฟงานสำเร็จ', description: `รหัสเวฟ: ${finalNo}` });
      if (docRef) router.push(`/waves/${docRef.id}`);
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'Error', description: 'ไม่สามารถสร้างเวฟงานได้' });
    } finally {
      setIsSavingWave(false);
    }
  };

  const handleUpdateWave = async () => {
    if (!firestore || !currentUser || !editingWave) return;
    if (!newWave.poId) {
      toast({ variant: 'destructive', title: 'ข้อมูลไม่ครบ', description: 'กรุณาเลือก Customer PO' });
      return;
    }
    const headerPoUpdate = allPOs?.find((p) => p.id === newWave.poId);
    if (headerPoUpdate?.status === 'closed') {
      toast({
        variant: 'destructive',
        title: 'PO ปิดแล้ว',
        description: 'ไม่สามารถแก้ไข/บันทึกเวฟที่ผูก PO ที่ปิดแล้ว',
      });
      return;
    }
    if (!headerPoUpdate || headerPoUpdate.status !== 'active') {
      toast({
        variant: 'destructive',
        title: 'PO ยังไม่ Active',
        description: 'อนุมัติ Customer PO ให้เป็น Active ก่อนบันทึกเวฟ',
      });
      return;
    }
    if (
      !isContractBasedPo(headerPoUpdate) &&
      headerPoUpdate.id !== editingWave.poId
    ) {
      toast({
        variant: 'destructive',
        title: 'เลือกได้เฉพาะ PO สายสัญญา',
        description: 'เปลี่ยนเวฟไปผูก PO จากใบเสนอราคาไม่ได้ — ใช้ได้เฉพาะ PO ที่มาจากสัญญา',
      });
      return;
    }

    const prevAllocs = normalizeWaveAllocations(editingWave);
    const allocations: WaveLineAllocation[] = [];

    for (const line of eligiblePoLinesForCreate) {
      const n = Math.max(0, Math.floor(allocationInputs[line.id] ?? 0));
      if (n < 1) {
        const had = prevAllocs.some((a) => a.poLineId === line.id);
        if (had) {
          const asg = countAssignedOnWaveLine(allMobilizations, editingWave.id, line.id);
          if (asg > 0) {
            toast({
              variant: 'destructive',
              title: 'ลดโควต้าบรรทัดนี้ไม่ได้',
              description: `มีการมอบหมายแล้ว ${asg} คนใน ${poLinePositionLabel(line, allPositions)} — ต้องถอนมอบหมายก่อน`,
            });
            return;
          }
        }
        continue;
      }

      if (line.status !== 'active') {
        toast({
          variant: 'destructive',
          title: 'PO Line ไม่ active',
          description: 'เปลี่ยนเป็นบรรทัดที่ active หรือเปิดใช้บรรทัดนี้ใหม่ที่หน้า PO',
        });
        return;
      }
      if (!line.positionId?.trim()) {
        toast({
          variant: 'destructive',
          title: 'ไม่มีตำแหน่งในบรรทัด PO',
          description: 'แก้บรรทัด PO ให้มีตำแหน่งงานก่อนบันทึก',
        });
        return;
      }

      const remaining = remainingQuotaForPoLine(line, waves, editingWave.id);
      if (n > remaining) {
        toast({
          variant: 'destructive',
          title: 'เกินโควต้า',
          description: `${poLinePositionLabel(line, allPositions)}: วางได้ไม่เกิน ${remaining} คน`,
        });
        return;
      }

      const asg = countAssignedOnWaveLine(allMobilizations, editingWave.id, line.id);
      if (n < asg) {
        toast({
          variant: 'destructive',
          title: 'จำนวนต่ำกว่าที่มอบหมายแล้ว',
          description: `${poLinePositionLabel(line, allPositions)}: มอบหมายแล้ว ${asg} คน`,
        });
        return;
      }

      allocations.push({ poLineId: line.id, plannedWorkers: n });
    }

    if (allocations.length < 1) {
      toast({
        variant: 'destructive',
        title: 'ยังไม่ได้ระบุจำนวนคน',
        description: 'กรอกจำนวนคนตามบรรทัด PO อย่างน้อย 1 บรรทัด',
      });
      return;
    }

    const totalPlanned = allocations.reduce((s, a) => s + a.plannedWorkers, 0);
    if (totalPlanned < Number(editingWave.assignedWorkers || 0)) {
      toast({
        variant: 'destructive',
        title: 'จำนวนคนต่ำเกินไป',
        description: `มีการมอบหมายแล้ว ${editingWave.assignedWorkers} คน — ต้องตั้งแผนรวมไม่ต่ำกว่านี้`,
      });
      return;
    }

    const siteLoc = deriveSiteLocationFromAllocations(allocations, allPOLines, newWave.poId);

    setIsSavingWave(true);
    try {
      const po = allPOs?.find((p) => p.id === newWave.poId);
      const waveRef = doc(firestore, 'waves', editingWave.id);
      await updateDoc(waveRef, {
        siteLocation: siteLoc,
        poId: newWave.poId,
        poLineId: allocations[0].poLineId,
        lineAllocations: allocations,
        startDate: newWave.startDate ?? '',
        endDate: newWave.endDate ?? '',
        plannedWorkers: totalPlanned,
        rotationPattern: editingWave.rotationPattern?.trim() || '',
        notes: newWave.notes ?? '',
        customerId: po?.customerId ?? editingWave.customerId ?? '',
        projectName: po?.projectName ?? po?.title ?? newWave.projectName ?? '',
        updatedAt: Date.now(),
        updatedBy: currentUser.id,
      });
      setWaveFormOpen(false);
      setEditingWave(null);
      setAllocationInputs({});
      setNewWave(defaultNewWaveState());
      toast({ title: 'บันทึกการแก้ไขเวฟแล้ว', description: editingWave.waveCode });
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'Error', description: 'ไม่สามารถบันทึกการแก้ไขได้' });
    } finally {
      setIsSavingWave(false);
    }
  };

  const handleConfirmDeleteWave = async () => {
    if (!firestore || !wavePendingDelete) return;
    setIsDeletingWave(true);
    try {
      await deleteDoc(doc(firestore, 'waves', wavePendingDelete.id));
      toast({
        title: 'ลบเวฟงานแล้ว',
        description: `รหัส ${wavePendingDelete.waveCode}`,
      });
      setWavePendingDelete(null);
    } catch (e) {
      console.error(e);
      toast({
        variant: 'destructive',
        title: 'ลบไม่สำเร็จ',
        description: e instanceof Error ? e.message : 'ลองใหม่อีกครั้ง',
      });
    } finally {
      setIsDeletingWave(false);
    }
  };

  const positionLabelForWave = (wave: Wave): string => {
    const labels: string[] = [];
    for (const a of normalizeWaveAllocations(wave)) {
      const line = allPOLines?.find((l) => l.id === a.poLineId && l.poId === wave.poId);
      if (!line?.positionId) continue;
      const pos = allPositions?.find((p) => p.id === line.positionId);
      labels.push(pos ? positionListPrimaryName(pos as PositionDoc) : line.positionId);
    }
    return labels.join(' · ');
  };

  /** มอบหมาย = นับจาก mobilization หลังตัดคน demob/ซ้ำ — แผน = รวม lineAllocations (ไม่ใช่ฟิลด์เด่น wave.assignedWorkers/plannedWorkers) */
  const planAsgnByWaveId = useMemo(() => {
    const m = new Map<string, { assigned: number; planned: number }>();
    if (!allMobilizations || !waves?.length) return m;
    const byWave = new Map<string, Assignment[]>();
    for (const a of allMobilizations) {
      const list = byWave.get(a.waveId) ?? [];
      list.push(a);
      byWave.set(a.waveId, list);
    }
    for (const w of waves) {
      const raw = byWave.get(w.id) ?? [];
      const roster = pickRosterLinePerWorker(raw);
      const assigned = roster.filter((a) => isAssignmentActiveOnWaveRoster(a)).length;
      m.set(w.id, { assigned, planned: totalPlannedWorkersOnWave(w) });
    }
    return m;
  }, [allMobilizations, waves]);

  const displayedWaves = useMemo(() => {
    let list = waves || [];
    if (filterPoId) list = list.filter((w) => w.poId === filterPoId);
    const q = waveTableSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((w) => {
      const customer = customers?.find((c) => c.id === w.customerId);
      const posLbl = positionLabelForWave(w).toLowerCase();
      return (
        (w.waveCode || '').toLowerCase().includes(q) ||
        (w.projectName || '').toLowerCase().includes(q) ||
        (customer?.name || '').toLowerCase().includes(q) ||
        posLbl.includes(q)
      );
    });
  }, [waves, filterPoId, waveTableSearch, customers, allPOLines, allPositions]);

  const getStatusBadge = (status: WaveStatus) => {
    switch (status) {
      case 'PLANNING': return <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200">PLANNING</Badge>;
      case 'READY': return <Badge variant="outline" className="bg-blue-50 text-blue-600 border-blue-200">READY</Badge>;
      case 'MOBILIZING': return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">MOBILIZING</Badge>;
      case 'ACTIVE': return <Badge className="bg-green-600">ACTIVE</Badge>;
      case 'DEMOBILIZING': return <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">DEMOBILIZING</Badge>;
      case 'CLOSED': return <Badge variant="secondary">CLOSED</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isUserLoading || userLoading || !currentUser) return null;
  if (!isStaff) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="p-6">
          <Card className="max-w-xl mx-auto mt-8">
            <CardHeader>
              <CardTitle>Access Pending (รอนุมัติสิทธิ์)</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              บัญชีของคุณยังไม่ได้รับสิทธิ์เข้าใช้งานโมดูล Waves กรุณาติดต่อผู้ดูแลระบบ
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        {/* Page Header */}
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <Waves className="h-8 w-8" /> เวฟงาน / รอบการทำงาน (Waves Management)
          </h1>
          <p className="text-muted-foreground text-lg">
            ใช้สำหรับบริหารรอบการส่งคนลงงานในแต่ละช่วงเวลา โดยเชื่อมกับ Customer PO, Assignment และการระดมพล
          </p>
        </div>

        {/* Operational Notice */}
        <Alert className="bg-amber-50 border-amber-200 text-amber-800 shadow-sm">
          <AlertCircle className="h-5 w-5 text-amber-600" />
          <AlertTitle className="font-bold">นโยบายการปิดเวฟ (Wave Closeout Policy)</AlertTitle>
          <AlertDescription className="text-sm">
            ไม่ควรปิด Wave หากยังมี Assignment ที่ยังไม่ปิดสถานะ หรือยังมีอุปกรณ์ PPE/เครื่องมือที่ค้างการรับคืนจากคนงาน
          </AlertDescription>
        </Alert>

        <PoFilterContextBanner
          poId={filterPoId}
          po={filterPO}
          listBasePath="/waves"
          moduleLabel="Waves"
        />

        {filterPoId && filterPO && filterPO.status !== 'active' && (
          <Alert variant="destructive" className="bg-destructive/5 border-destructive/30">
            <AlertCircle className="h-5 w-5" />
            <AlertTitle>PO ยังไม่ได้อนุมัติ</AlertTitle>
            <AlertDescription className="text-sm">
              สถานะปัจจุบัน: <strong>{filterPO.status.toUpperCase()}</strong> — ไปที่หน้า Customer PO แล้วกด{' '}
              <strong>อนุมัติ (Active)</strong> ก่อนจึงจะสร้างเวฟได้
            </AlertDescription>
          </Alert>
        )}

        {filterPoId && filterPO && filterPO.status === 'active' && !isContractBasedPo(filterPO) && (
          <Alert variant="destructive" className="bg-destructive/5 border-destructive/30">
            <AlertCircle className="h-5 w-5" />
            <AlertTitle>PO จากใบเสนอราคา — ไม่สร้างเวฟที่นี่</AlertTitle>
            <AlertDescription className="text-sm">
              เวฟงานใช้กับ <strong>PO สายสัญญา</strong> เท่านั้น (Wave + timesheet) — งานจากใบเสนอราคาเรียกเก็บผ่านใบแจ้งหนี้ตาม PO Line / ใบเสนอราคา ไม่ผ่าน Wave
            </AlertDescription>
          </Alert>
        )}

        {/* Action Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="ค้นหารหัสเวฟ, ชื่อลูกค้า หรือโครงการ..."
                className="pl-9 h-11"
                value={waveTableSearch}
                onChange={(e) => setWaveTableSearch(e.target.value)}
              />
            </div>
            <Button variant="outline" className="gap-2 h-11"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
          </div>
          
          <Button
            className="gap-2 h-11 px-6 bg-primary shadow-md text-base font-bold"
            disabled={!isStaff || !filterPoAllowsNewWave}
            title={
              filterPoId && filterPO && filterPO.status === 'active' && !isContractBasedPo(filterPO)
                ? 'สร้างเวฟได้เฉพาะ PO ที่มาจากสัญญา — PO จากใบเสนอราคาไม่ใช้ Wave'
                : filterPoId && filterPO && filterPO.status !== 'active'
                  ? 'PO นี้ยัง Pending — อนุมัติที่หน้า Customer PO ให้เป็น Active ก่อน'
                  : undefined
            }
            onClick={() => {
              if (filterPoId && filterPO && filterPO.status === 'active' && !isContractBasedPo(filterPO)) {
                toast({
                  variant: 'destructive',
                  title: 'ยังสร้างเวฟไม่ได้',
                  description:
                    'สร้างเวฟได้เฉพาะ PO จากสัญญา — PO จากใบเสนอราคาไม่ใช้ Wave / timesheet',
                });
                return;
              }
              if (!filterPoAllowsNewWave) {
                toast({
                  variant: 'destructive',
                  title: 'ยังสร้างเวฟไม่ได้',
                  description: 'อนุมัติ Customer PO (สถานะ Active) ก่อนสร้างเวฟ',
                });
                return;
              }
              setEditingWave(null);
              setAllocationInputs({});
              setNewWave({
                ...defaultNewWaveState(),
                ...(filterPoId ? { poId: filterPoId } : {}),
              });
              setWaveFormOpen(true);
            }}
          >
            <Plus className="h-5 w-5" /> สร้างเวฟงานใหม่ (Create Wave)
          </Button>

          <Dialog
            open={isStaff && waveFormOpen}
            onOpenChange={(open) => {
              setWaveFormOpen(open);
              if (!open) {
                setEditingWave(null);
                setAllocationInputs({});
                setNewWave(defaultNewWaveState());
              }
            }}
          >
            <DialogContent className="grid max-h-[min(92dvh,56rem)] w-[calc(100vw-1.5rem)] max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:rounded-lg">
              <div className="border-b px-6 py-4 pr-14">
                <DialogHeader>
                  <DialogTitle>
                    {editingWave ? 'แก้ไขรอบการทำงาน (Edit Deployment Wave)' : 'สร้างรอบการทำงานใหม่ (New Deployment Wave)'}
                  </DialogTitle>
                  <DialogDescription>
                    {editingWave
                      ? 'อัปเดตวันที่ โควต้าต่อบรรทัด PO และจำนวนคนตามแผน — รหัสเวฟเดิมคงเดิม'
                      : 'เลือก Customer PO สายสัญญา (Active) แล้วกำหนดจำนวนคนต่อบรรทัด PO ได้หลายตำแหน่งในเวฟเดียว — สถานที่ปฏิบัติงานดึงจาก workLocation ของแต่ละบรรทัด — PO จากใบเสนอราคาไม่แสดงในรายการนี้'}
                  </DialogDescription>
                </DialogHeader>
              </div>
              <div className="min-h-0 overflow-y-auto overscroll-y-contain px-6 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>รหัสเวฟงาน (Wave Code)</Label>
                  <Input value={newWave.waveCode} disabled className="bg-muted font-mono font-bold text-primary" />
                  <p className="text-[10px] text-muted-foreground italic">
                    {editingWave
                      ? '* รหัสเวฟไม่เปลี่ยนเมื่อแก้ไข'
                      : '* ระบบจะออกรหัสจริงให้อัตโนมัติเมื่อกดบันทึก'}
                  </p>
                </div>
                <div className="grid gap-2 md:col-span-2">
                  <Label>สถานที่ปฏิบัติงาน (จาก PO line)</Label>
                  <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm min-h-[40px]">
                    {derivedWaveSiteLocation ? (
                      <span className="font-medium">{derivedWaveSiteLocation}</span>
                    ) : (
                      <span className="text-muted-foreground italic">
                        กำหนดจำนวนคนตามบรรทัด PO ที่มี workLocation — ระบบจะแสดงสถานที่อัตโนมัติ
                      </span>
                    )}
                  </div>
                </div>
                <div className="grid gap-2 md:col-span-2">
                  <Label>เลือก Customer PO</Label>
                  <Select
                    value={newWave.poId || undefined}
                    onValueChange={(v) => {
                      setAllocationInputs({});
                      setNewWave({ ...newWave, poId: v, poLineId: '', plannedWorkers: 0 });
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="เลือก PO..." /></SelectTrigger>
                    <SelectContent>
                      {posForWaveSelect?.length ? (
                        posForWaveSelect.map((po) => (
                          <SelectItem key={po.id} value={po.id}>
                            {po.poCode} - {po.title}
                          </SelectItem>
                        ))
                      ) : (
                        <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                          {editingWave
                            ? 'ไม่มี PO'
                            : 'ไม่มี PO สายสัญญาที่ Active — อนุมัติ PO จากสัญญาก่อน'}
                        </div>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2 md:col-span-2">
                  <Label>โควต้าตามบรรทัด PO (หลายตำแหน่งใน 1 เวฟ)</Label>
                  {!newWave.poId ? (
                    <p className="text-sm text-muted-foreground">เลือก PO ก่อน</p>
                  ) : eligiblePoLinesForCreate.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      ไม่มีบรรทัดที่เหลือโควต้า (ครบตาม PO หรือถูกจองในเวฟอื่นหมดแล้ว)
                    </p>
                  ) : (
                    <div className="rounded-md border divide-y max-h-[240px] overflow-y-auto">
                      {eligiblePoLinesForCreate.map((line) => {
                        const rem = remainingQuotaForPoLine(line, waves, quotaExcludeWaveId);
                        const code = poLinePositionCode(line, allPositions);
                        const name = poLinePositionLabel(line, allPositions);
                        const wl = (line.workLocation || '').trim();
                        const val = Math.max(0, Math.floor(allocationInputs[line.id] ?? 0));
                        return (
                          <div key={line.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                            <div className="flex-1 min-w-[200px]">
                              <div className="font-medium">
                                {code} — {name}
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                เหลือวางแผนได้ {rem} คน
                                {wl ? ` · ${wl}` : ''}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-muted-foreground whitespace-nowrap">จำนวน</span>
                              <Input
                                type="number"
                                min={0}
                                max={rem}
                                className="w-20 h-9"
                                value={val || ''}
                                placeholder="0"
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  if (raw === '') {
                                    setAllocationInputs((prev) => ({ ...prev, [line.id]: 0 }));
                                    return;
                                  }
                                  const n = parseInt(raw, 10);
                                  if (Number.isNaN(n)) return;
                                  setAllocationInputs((prev) => ({
                                    ...prev,
                                    [line.id]: Math.max(0, Math.min(rem, n)),
                                  }));
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {newWave.poId && eligiblePoLinesForCreate.length > 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      รวมที่วางแผนในเวฟนี้: <strong>{totalPlannedFromInputs}</strong> คน
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-2">
                  <Label>วันที่เริ่มงาน (Start Date)</Label>
                  <DatePickerThaiBE
                    className="h-10"
                    value={htmlDateValueToTimestampMs(newWave.startDate)}
                    onChange={(ms) => setNewWave({ ...newWave, startDate: timestampToHtmlDateValue(ms) })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>วันที่สิ้นสุด (End Date)</Label>
                  <DatePickerThaiBE
                    className="h-10"
                    value={htmlDateValueToTimestampMs(newWave.endDate)}
                    onChange={(ms) => setNewWave({ ...newWave, endDate: timestampToHtmlDateValue(ms) })}
                  />
                </div>
              </div>
              </div>
              <div className="border-t bg-background px-6 py-4">
              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  variant="outline"
                  onClick={() => {
                    setWaveFormOpen(false);
                    setEditingWave(null);
                    setAllocationInputs({});
                    setNewWave(defaultNewWaveState());
                  }}
                  disabled={isSavingWave}
                >
                  ยกเลิก
                </Button>
                <Button
                  onClick={() => (editingWave ? void handleUpdateWave() : void handleCreate())}
                  className="bg-primary font-bold"
                  disabled={isSavingWave || !waveFormCanSubmit}
                >
                  {isSavingWave ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {editingWave ? 'บันทึกการแก้ไข (Save)' : 'ยืนยันการสร้าง (Confirm)'}
                </Button>
              </DialogFooter>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Data Table */}
        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isWavesLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลรอบการทำงาน...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4">รหัสเวฟ (Wave Code)</TableHead>
                    <TableHead className="font-bold">ลูกค้า & โครงการ (Context)</TableHead>
                    <TableHead className="font-bold">สถานที่ (Site)</TableHead>
                    <TableHead className="font-bold">ระยะเวลา (Period)</TableHead>
                    <TableHead className="font-bold text-center">คนงาน (Plan/Asgn)</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayedWaves.map((wave) => {
                    const customer = customers?.find(c => c.id === wave.customerId);
                    const positionLabel = positionLabelForWave(wave);
                    return (
                      <TableRow 
                        key={wave.id} 
                        className="cursor-pointer hover:bg-muted/30 group transition-all"
                        onClick={() => router.push(`/waves/${wave.id}`)}
                      >
                        <TableCell className="py-4">
                          <div className="flex flex-col">
                            <span className="font-bold text-base text-primary">{wave.waveCode}</span>
                            {wave.rotationPattern?.trim() ? (
                              <span className="text-[10px] text-muted-foreground uppercase">
                                Pattern: {wave.rotationPattern}
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1 min-w-0 max-w-[320px]">
                            <span className="font-bold text-sm">{customer?.name || '...'}</span>
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                              <span className="text-xs text-muted-foreground truncate min-w-0 flex-1">{wave.projectName}</span>
                              {positionLabel ? (
                                <Badge variant="secondary" className="shrink-0 text-[10px] font-medium px-1.5 py-0 h-5 normal-case">
                                  {positionLabel}
                                </Badge>
                              ) : (
                                <span className="text-[10px] text-muted-foreground/70 shrink-0">ตำแหน่ง: —</span>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 text-sm">
                            <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                            {wave.siteLocation}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                            <Calendar className="h-3.5 w-3.5" />
                            {formatYmdRangeThaiBE(wave.startDate, wave.endDate)}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-2">
                            <Badge
                              variant="outline"
                              className="font-bold"
                              title="มอบหมาย = นับราย active จาก mobilization (ไม่นับ demob/ซ้ำ); แผน = รวม lineAllocations ในเวฟ"
                            >
                              {(() => {
                                const p = planAsgnByWaveId.get(wave.id);
                                const asgn = p?.assigned ?? 0;
                                const plan =
                                  p?.planned ??
                                  (totalPlannedWorkersOnWave(wave) || (wave.plannedWorkers ?? 0));
                                return `${asgn} / ${plan}`;
                              })()}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell>{getStatusBadge(wave.status)}</TableCell>
                        <TableCell className="text-right pr-6">
                          <div
                            className="flex items-center justify-end gap-0.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {canEditWavesRow && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-muted-foreground hover:text-primary"
                                title="แก้ไขข้อมูลเวฟ (PO / สถานที่ / วันที่)"
                                onClick={() => {
                                  setEditingWave(wave);
                                  const rec: Record<string, number> = {};
                                  for (const a of normalizeWaveAllocations(wave)) {
                                    rec[a.poLineId] = a.plannedWorkers;
                                  }
                                  setAllocationInputs(rec);
                                  setNewWave({
                                    waveCode: wave.waveCode,
                                    status: wave.status,
                                    plannedWorkers: wave.plannedWorkers,
                                    assignedWorkers: wave.assignedWorkers,
                                    siteLocation: wave.siteLocation ?? '',
                                    notes: wave.notes ?? '',
                                    poId: wave.poId,
                                    poLineId: wave.poLineId,
                                    startDate: wave.startDate,
                                    endDate: wave.endDate,
                                    customerId: wave.customerId,
                                    projectName: wave.projectName,
                                  });
                                  setWaveFormOpen(true);
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                            {canDeleteWaveRow && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                title="ลบเวฟ (ผู้จัดการ/แอดมิน)"
                                onClick={() => setWavePendingDelete(wave)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="group-hover:text-primary"
                              title="เปิดรายละเอียด"
                              onClick={() => router.push(`/waves/${wave.id}`)}
                            >
                              <ChevronRight className="h-5 w-5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!isWavesLoading && displayedWaves.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-20 text-muted-foreground">
                        {!waves || waves.length === 0 ? (
                          <span className="italic">ยังไม่มีเวฟงานในระบบ เริ่มต้นโดยกด &quot;สร้างเวฟงาน&quot; เพื่อวางแผนการส่งคนลงงาน</span>
                        ) : (
                          <span>
                            ไม่มีแถวที่ตรงกับการกรอง
                            {filterPoId ? ' (PO นี้)' : ''}
                            {waveTableSearch.trim() ? ' หรือคำค้นหา' : ''}
                            — ลองล้างการกรองหรือปรับคำค้นหา
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

        {/* Workflow Guidance */}
        <Card className="bg-primary/5 border-primary/10 border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2 text-primary font-bold">
              <Info className="h-5 w-5" /> แนวทางปฏิบัติ (Next Steps)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="flex items-start gap-3 p-4 bg-white rounded-md border shadow-sm">
                <div className="bg-primary/10 p-2 rounded text-primary font-bold">1</div>
                <div>
                  <p className="font-bold">เพิ่มคนงานในเวฟ (Assign Workers)</p>
                  <p className="text-muted-foreground text-xs">คลิกที่เวฟงานและไปที่แท็บ 'คนในเวฟ' เพื่อเลือกคนงานที่มีสถานะ READY เข้าสู่รอบการทำงานนี้</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 bg-white rounded-md border shadow-sm">
                <div className="bg-primary/10 p-2 rounded text-primary font-bold">2</div>
                <div>
                  <p className="font-bold">เตรียมความพร้อม (Mobilization)</p>
                  <p className="text-muted-foreground text-xs">ตรวจสอบ Checklist ความพร้อมสุดท้ายและเบิกอุปกรณ์ PPE ก่อนที่เวฟงานจะเริ่ม (Start Date)</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <AlertDialog
          open={wavePendingDelete != null}
          onOpenChange={(open) => {
            if (!open && !isDeletingWave) setWavePendingDelete(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ลบเวฟงาน?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-left text-sm">
                  <p>
                    การลบจะนำรายการเวฟออกจากระบบถาวร ควรตรวจสอบว่าไม่มีการมอบหมายงานหรือข้อมูลที่ยังอ้างอิงเวฟนี้อยู่
                    (ตามนโยบายปิดเวฟ — ควรปิดสถานะแทนการลบหากมีงานค้าง)
                  </p>
                  {wavePendingDelete && (
                    <p className="font-mono font-semibold text-foreground">
                      {wavePendingDelete.waveCode}
                    </p>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeletingWave}>ยกเลิก</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={isDeletingWave}
                onClick={(e) => {
                  e.preventDefault();
                  void handleConfirmDeleteWave();
                }}
              >
                {isDeletingWave ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin inline" />
                    กำลังลบ…
                  </>
                ) : (
                  'ลบ'
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppShell>
  );
}

export default function WavesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      }
    >
      <WavesPageContent />
    </Suspense>
  );
}
