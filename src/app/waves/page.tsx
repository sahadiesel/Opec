'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
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
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue } from '@/lib/date-thai';
import { Wave, Customer, PurchaseOrder, POLine, WaveStatus, Position } from '@/lib/types';
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

/** รวม plannedWorkers ของเวฟที่ผูก PO line เดียวกัน — ไม่นับเวฟ CLOSED; `excludeWaveId` สำหรับโหมดแก้ไข */
function sumPlannedWorkersForPoLine(
  waveList: Wave[] | null | undefined,
  poId: string,
  poLineId: string,
  excludeWaveId?: string | null
): number {
  if (!waveList?.length) return 0;
  return waveList.reduce((acc, w) => {
    if (excludeWaveId && w.id === excludeWaveId) return acc;
    if (w.poId !== poId || w.poLineId !== poLineId) return acc;
    if (w.status === 'CLOSED') return acc;
    return acc + (Number(w.plannedWorkers) || 0);
  }, 0);
}

/** จำนวนคนที่ยังวางแผนในเวฟได้เพิ่มสำหรับ PO line นี้ (หรือแก้ไขเวฟเดิมเมื่อส่ง excludeWaveId) */
function remainingQuotaForPoLine(
  line: POLine,
  waveList: Wave[] | null | undefined,
  excludeWaveId?: string | null
): number {
  if (line.status !== 'active') return 0;
  const cap = Math.max(0, Number(line.quantity) || 0);
  const used = sumPlannedWorkersForPoLine(waveList, line.poId, line.id, excludeWaveId);
  return Math.max(0, cap - used);
}

function plannedUsedForPoLine(
  line: POLine,
  waveList: Wave[] | null | undefined,
  excludeWaveId?: string | null
): number {
  return sumPlannedWorkersForPoLine(waveList, line.poId, line.id, excludeWaveId);
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

const defaultNewWaveState = (): Partial<Wave> => ({
  waveCode: getPreviewPattern('wave'),
  status: 'PLANNING',
  plannedWorkers: 1,
  siteLocation: '',
  rotationPattern: '28/28',
  notes: '',
});

export default function WavesPage() {
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

  const [waveFormOpen, setWaveFormOpen] = useState(false);
  const [editingWave, setEditingWave] = useState<Wave | null>(null);
  const [isSavingWave, setIsSavingWave] = useState(false);
  const [wavePendingDelete, setWavePendingDelete] = useState<Wave | null>(null);
  const [isDeletingWave, setIsDeletingWave] = useState(false);
  const [newWave, setNewWave] = useState<Partial<Wave>>(() => defaultNewWaveState());
  const [waveTableSearch, setWaveTableSearch] = useState('');

  const filterPoId = (searchParams.get('poId') || '').trim() || null;
  const filterPO = useMemo(
    () => (filterPoId && allPOs?.length ? allPOs.find((p) => p.id === filterPoId) : undefined),
    [filterPoId, allPOs]
  );

  const wantOpenNewWaveFromPo = searchParams.get('newWave') === '1';
  const newWaveAutoOpenRef = useRef(false);

  useEffect(() => {
    if (!wantOpenNewWaveFromPo) {
      newWaveAutoOpenRef.current = false;
      return;
    }
    if (!isStaff || !filterPoId) return;
    if (newWaveAutoOpenRef.current) return;
    newWaveAutoOpenRef.current = true;
    setEditingWave(null);
    setNewWave({ ...defaultNewWaveState(), poId: filterPoId });
    setWaveFormOpen(true);
    router.replace(`/waves?poId=${encodeURIComponent(filterPoId)}`, { scroll: false });
  }, [wantOpenNewWaveFromPo, isStaff, filterPoId, router]);

  const quotaExcludeWaveId = editingWave?.id ?? null;

  const eligiblePoLinesForCreate = useMemo(() => {
    if (!newWave.poId || !allPOLines?.length) return [];
    const list = allPOLines.filter((l) => l.poId === newWave.poId);
    const withRemaining = list.filter((l) => remainingQuotaForPoLine(l, waves, quotaExcludeWaveId) > 0);
    return [...withRemaining].sort((a, b) => {
      const na = poLinePositionLabel(a, allPositions);
      const nb = poLinePositionLabel(b, allPositions);
      if (na !== nb) return na.localeCompare(nb, 'th');
      return poLinePositionCode(a, allPositions).localeCompare(poLinePositionCode(b, allPositions), 'th');
    });
  }, [newWave.poId, allPOLines, allPositions, waves, quotaExcludeWaveId]);

  const selectedPoLineForCreate = useMemo(() => {
    if (!newWave.poId || !newWave.poLineId || !allPOLines?.length) return undefined;
    return allPOLines.find((l) => l.id === newWave.poLineId && l.poId === newWave.poId);
  }, [newWave.poId, newWave.poLineId, allPOLines]);

  const remainingForSelectedPoLine = useMemo(() => {
    if (!selectedPoLineForCreate) return 0;
    return remainingQuotaForPoLine(selectedPoLineForCreate, waves, quotaExcludeWaveId);
  }, [selectedPoLineForCreate, waves, quotaExcludeWaveId]);

  const quotaCapForSelected = selectedPoLineForCreate
    ? Math.max(0, Number(selectedPoLineForCreate.quantity) || 0)
    : 0;
  const usedForSelected = selectedPoLineForCreate
    ? plannedUsedForPoLine(selectedPoLineForCreate, waves, quotaExcludeWaveId)
    : 0;

  useEffect(() => {
    if (!waveFormOpen || !newWave.poId || !newWave.poLineId || !allPOLines?.length) return;
    const line = allPOLines.find((l) => l.id === newWave.poLineId && l.poId === newWave.poId);
    if (!line) return;
    const rem = remainingQuotaForPoLine(line, waves, quotaExcludeWaveId);
    setNewWave((prev) => {
      if (prev.poLineId !== line.id || prev.poId !== line.poId) return prev;
      if (rem <= 0) return { ...prev, poLineId: '', plannedWorkers: 1 };
      const pw = Number(prev.plannedWorkers) || 0;
      if (pw > rem) return { ...prev, plannedWorkers: rem };
      return prev;
    });
  }, [waveFormOpen, newWave.poId, newWave.poLineId, allPOLines, waves, quotaExcludeWaveId]);

  const handleCreate = async () => {
    if (!firestore || !currentUser || editingWave) return;
    if (!newWave.poId || !newWave.poLineId) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาเลือก PO และ PO Line" });
      return;
    }
    const line = allPOLines?.find((l) => l.id === newWave.poLineId && l.poId === newWave.poId);
    if (!line) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ถูกต้อง", description: "ไม่พบ PO Line ที่เลือก" });
      return;
    }
    const remaining = remainingQuotaForPoLine(line, waves, null);
    const planned = Number(newWave.plannedWorkers) || 0;
    if (remaining <= 0) {
      toast({
        variant: "destructive",
        title: "โควต้าเต็ม",
        description: "รายการ PO Line นี้ไม่เหลือโควต้าสำหรับเปิดเวฟเพิ่ม",
      });
      return;
    }
    if (planned < 1 || planned > remaining) {
      toast({
        variant: "destructive",
        title: "จำนวนคนไม่ถูกต้อง",
        description: `ต้องอยู่ระหว่าง 1 และ ${remaining} คน (โควต้าที่เหลือ)`,
      });
      return;
    }

    setIsSavingWave(true);
    try {
      // Atomic Number Generation
      const { code: finalNo } = await generateNextDocumentCode(firestore, 'wave', { actor: currentUser.displayName });

      const po = allPOs?.find(p => p.id === newWave.poId);
      const waveRef = collection(firestore, 'waves');
      
      const docRef = await addDocumentNonBlocking(waveRef, {
        ...newWave,
        waveCode: finalNo,
        customerId: po?.customerId || '',
        projectName: po?.projectName || po?.title || '',
        assignedWorkers: 0,
        createdAt: Date.now(),
        createdBy: currentUser.id,
        updatedAt: Date.now(),
        updatedBy: currentUser.id
      });

      setWaveFormOpen(false);
      setEditingWave(null);
      setNewWave(defaultNewWaveState());
      toast({ title: "สร้างเวฟงานสำเร็จ", description: `รหัสเวฟ: ${finalNo}` });
      if (docRef) router.push(`/waves/${docRef.id}`);
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถสร้างเวฟงานได้" });
    } finally {
      setIsSavingWave(false);
    }
  };

  const handleUpdateWave = async () => {
    if (!firestore || !currentUser || !editingWave) return;
    if (!newWave.poId || !newWave.poLineId) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาเลือก PO และ PO Line" });
      return;
    }
    const line = allPOLines?.find((l) => l.id === newWave.poLineId && l.poId === newWave.poId);
    if (!line) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ถูกต้อง", description: "ไม่พบ PO Line ที่เลือก" });
      return;
    }
    const remaining = remainingQuotaForPoLine(line, waves, editingWave.id);
    const planned = Number(newWave.plannedWorkers) || 0;
    if (remaining <= 0) {
      toast({
        variant: "destructive",
        title: "โควต้าเต็ม",
        description: "รายการ PO Line นี้ไม่เหลือโควต้าสำหรับจำนวนคนที่ตั้งไว้",
      });
      return;
    }
    if (planned < 1 || planned > remaining) {
      toast({
        variant: "destructive",
        title: "จำนวนคนไม่ถูกต้อง",
        description: `ต้องอยู่ระหว่าง 1 และ ${remaining} คน (โควต้าที่เหลือเมื่อไม่นับเวฟนี้)`,
      });
      return;
    }
    if (planned < Number(editingWave.assignedWorkers || 0)) {
      toast({
        variant: "destructive",
        title: "จำนวนคนต่ำเกินไป",
        description: `มีการมอบหมายแล้ว ${editingWave.assignedWorkers} คน — ต้องตั้งแผนไม่ต่ำกว่านี้`,
      });
      return;
    }

    setIsSavingWave(true);
    try {
      const po = allPOs?.find((p) => p.id === newWave.poId);
      const waveRef = doc(firestore, 'waves', editingWave.id);
      await updateDoc(waveRef, {
        siteLocation: newWave.siteLocation ?? '',
        poId: newWave.poId,
        poLineId: newWave.poLineId,
        startDate: newWave.startDate ?? '',
        endDate: newWave.endDate ?? '',
        plannedWorkers: planned,
        rotationPattern: newWave.rotationPattern ?? '28/28',
        notes: newWave.notes ?? '',
        customerId: po?.customerId ?? editingWave.customerId ?? '',
        projectName: po?.projectName ?? po?.title ?? newWave.projectName ?? '',
        updatedAt: Date.now(),
        updatedBy: currentUser.id,
      });
      setWaveFormOpen(false);
      setEditingWave(null);
      setNewWave(defaultNewWaveState());
      toast({ title: "บันทึกการแก้ไขเวฟแล้ว", description: editingWave.waveCode });
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถบันทึกการแก้ไขได้" });
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
    const line = allPOLines?.find((l) => l.id === wave.poLineId && l.poId === wave.poId);
    if (!line?.positionId) return '';
    const pos = allPositions?.find((p) => p.id === line.positionId);
    return pos ? positionListPrimaryName(pos as PositionDoc) : line.positionId;
  };

  const displayedWaves = useMemo(() => {
    let list = waves || [];
    if (filterPoId) list = list.filter((w) => w.poId === filterPoId);
    const q = waveTableSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((w) => {
      const customer = customers?.find((c) => c.id === w.customerId);
      const line = allPOLines?.find((l) => l.id === w.poLineId && l.poId === w.poId);
      const pos = line?.positionId ? allPositions?.find((p) => p.id === line.positionId) : undefined;
      const posLbl = pos ? positionListPrimaryName(pos as PositionDoc).toLowerCase() : '';
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
            disabled={!isStaff}
            onClick={() => {
              setEditingWave(null);
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
                setNewWave(defaultNewWaveState());
              }
            }}
          >
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>
                  {editingWave ? 'แก้ไขรอบการทำงาน (Edit Deployment Wave)' : 'สร้างรอบการทำงานใหม่ (New Deployment Wave)'}
                </DialogTitle>
                <DialogDescription>
                  {editingWave
                    ? 'อัปเดตสถานที่ วันที่ PO/โควต้า และจำนวนคนตามแผน — รหัสเวฟเดิมคงเดิม'
                    : 'ระบุข้อมูลพื้นฐานและเชื่อมต่อเข้ากับ Customer PO เพื่อเริ่มวางแผนส่งคน'}
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4 py-4">
                <div className="grid gap-2">
                  <Label>รหัสเวฟงาน (Wave Code)</Label>
                  <Input value={newWave.waveCode} disabled className="bg-muted font-mono font-bold text-primary" />
                  <p className="text-[10px] text-muted-foreground italic">
                    {editingWave
                      ? '* รหัสเวฟไม่เปลี่ยนเมื่อแก้ไข'
                      : '* ระบบจะออกรหัสจริงให้อัตโนมัติเมื่อกดบันทึก'}
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label>สถานที่ปฏิบัติงาน (Site / Location)</Label>
                  <Input placeholder="เช่น Erawan Platform" value={newWave.siteLocation} onChange={e => setNewWave({...newWave, siteLocation: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label>เลือก Customer PO</Label>
                  <Select
                    value={newWave.poId || undefined}
                    onValueChange={(v) =>
                      setNewWave({ ...newWave, poId: v, poLineId: '', plannedWorkers: 1 })
                    }
                  >
                    <SelectTrigger><SelectValue placeholder="เลือก PO..." /></SelectTrigger>
                    <SelectContent>
                      {allPOs?.map(po => (
                        <SelectItem key={po.id} value={po.id}>{po.poCode} - {po.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>เลือกโควต้า (PO Line)</Label>
                  <Select
                    value={newWave.poLineId || undefined}
                    onValueChange={(v) => {
                      const line = allPOLines?.find((l) => l.id === v && l.poId === newWave.poId);
                      const rem = line ? remainingQuotaForPoLine(line, waves, quotaExcludeWaveId) : 0;
                      setNewWave({
                        ...newWave,
                        poLineId: v,
                        plannedWorkers: rem > 0 ? rem : 1,
                      });
                    }}
                    disabled={!newWave.poId}
                  >
                    <SelectTrigger><SelectValue placeholder="เลือกรายการสั่งจอง..." /></SelectTrigger>
                    <SelectContent>
                      {eligiblePoLinesForCreate.length === 0 && newWave.poId ? (
                        <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                          ไม่มีรายการที่เหลือโควต้า (ครบตาม PO หรือถูกจองในเวฟอื่นหมดแล้ว)
                        </div>
                      ) : (
                        eligiblePoLinesForCreate.map((line) => {
                          const rem = remainingQuotaForPoLine(line, waves, quotaExcludeWaveId);
                          const code = poLinePositionCode(line, allPositions);
                          const name = poLinePositionLabel(line, allPositions);
                          return (
                            <SelectItem key={line.id} value={line.id}>
                              {code} — {name} · เหลือ {rem} คน
                            </SelectItem>
                          );
                        })
                      )}
                    </SelectContent>
                  </Select>
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
                <div className="grid gap-2">
                  <Label>จำนวนคนงานที่วางแผน (Planned)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={remainingForSelectedPoLine > 0 ? remainingForSelectedPoLine : undefined}
                    disabled={!selectedPoLineForCreate || remainingForSelectedPoLine <= 0}
                    value={newWave.plannedWorkers ?? 1}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      if (Number.isNaN(n)) {
                        setNewWave({ ...newWave, plannedWorkers: 1 });
                        return;
                      }
                      const cap =
                        remainingForSelectedPoLine > 0 ? remainingForSelectedPoLine : 1;
                      setNewWave({
                        ...newWave,
                        plannedWorkers: Math.min(Math.max(1, n), cap),
                      });
                    }}
                  />
                  {selectedPoLineForCreate && remainingForSelectedPoLine > 0 ? (
                    <p className="text-[10px] text-muted-foreground">
                      โควต้า PO line: {quotaCapForSelected} คน · จองในเวฟอื่นแล้ว: {usedForSelected} คน ·
                      เปิดเวฟนี้ได้ไม่เกิน {remainingForSelectedPoLine} คน
                    </p>
                  ) : newWave.poId ? (
                    <p className="text-[10px] text-muted-foreground">
                      เลือกรายการ PO line ที่ยังมีโควต้า เพื่อกำหนดจำนวนคนอัตโนมัติ
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-2">
                  <Label>รูปแบบกะงาน (Rotation)</Label>
                  <Input placeholder="เช่น 28/28" value={newWave.rotationPattern} onChange={e => setNewWave({...newWave, rotationPattern: e.target.value})} />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setWaveFormOpen(false);
                    setEditingWave(null);
                    setNewWave(defaultNewWaveState());
                  }}
                  disabled={isSavingWave}
                >
                  ยกเลิก
                </Button>
                <Button
                  onClick={() => (editingWave ? void handleUpdateWave() : void handleCreate())}
                  className="bg-primary font-bold"
                  disabled={
                    isSavingWave ||
                    !newWave.poId ||
                    !newWave.poLineId ||
                    remainingForSelectedPoLine <= 0 ||
                    (Number(newWave.plannedWorkers) || 0) < 1 ||
                    (Number(newWave.plannedWorkers) || 0) > remainingForSelectedPoLine
                  }
                >
                  {isSavingWave ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {editingWave ? 'บันทึกการแก้ไข (Save)' : 'ยืนยันการสร้าง (Confirm)'}
                </Button>
              </DialogFooter>
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
                            <span className="text-[10px] text-muted-foreground uppercase">Pattern: {wave.rotationPattern}</span>
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
                            {wave.startDate} - {wave.endDate}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-2">
                            <Badge variant="outline" className="font-bold">{wave.assignedWorkers} / {wave.plannedWorkers}</Badge>
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
                                  setNewWave({
                                    waveCode: wave.waveCode,
                                    status: wave.status,
                                    plannedWorkers: wave.plannedWorkers,
                                    assignedWorkers: wave.assignedWorkers,
                                    siteLocation: wave.siteLocation ?? '',
                                    rotationPattern: wave.rotationPattern ?? '28/28',
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
