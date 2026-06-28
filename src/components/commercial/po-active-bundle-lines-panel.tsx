'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { collection, doc, addDoc, getDocs, updateDoc, deleteDoc } from 'firebase/firestore';
import { useFirestore, useDoc, useCollection, useMemoFirebase } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canEdit, canDelete } from '@/lib/permissions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { formatDateRangeThaiBE } from '@/lib/date-thai';
import { Plus, ChevronRight, Loader2, Calendar, CheckCircle2, Pencil, Trash2, RefreshCw } from 'lucide-react';
import type {
  Assignment,
  MainContract,
  POLine,
  Position,
  PositionRate,
  PurchaseOrder,
} from '@/lib/types';
import { assignmentCountsTowardQuota } from '@/lib/ops/po-fulfillment-read-model';
import { isMainContractEligibleForPoActiveWorkflow } from '@/lib/ops/po-active-eligibility';
import { sortPositionRatesByDisplayName } from '@/lib/position-display';
import { positionListPrimaryName, type PositionDoc } from '@/lib/position-display';
import {
  buildPoLineRateSnapshotFromContract,
  displayPoLineSellRateForWorkMode,
  resyncPoLineRateSnapshotsForPo,
} from '@/lib/commercial/po-line-rate-snapshot';
import {
  jobModeSellLabel,
} from '@/lib/commercial/position-rate-sell';
import { writeAuditLog } from '@/lib/services/audit-service';
import { useToast } from '@/hooks/use-toast';
function LineFormBody({
  po,
  allPositions,
  lineDraft,
  setLineDraft,
  isBusy,
  onSave,
  onCancel,
  isLinkedSourceReady,
  ratesSorted,
  disablePosition,
  showStatus,
  saveLabel,
}: {
  po: PurchaseOrder;
  allPositions: Position[] | undefined;
  lineDraft: Partial<POLine>;
  setLineDraft: React.Dispatch<React.SetStateAction<Partial<POLine>>>;
  isBusy: boolean;
  onSave: () => void;
  onCancel: () => void;
  isLinkedSourceReady: boolean;
  ratesSorted: PositionRate[];
  disablePosition?: boolean;
  showStatus?: boolean;
  saveLabel: string;
}) {
  return (
    <>
      <div className="grid gap-4 py-4">
        <div className="grid gap-2">
          <Label className="font-bold">ตำแหน่งงาน (จากสัญญาหลัก)</Label>
          <Select
            disabled={disablePosition}
            onValueChange={(v) => setLineDraft({ ...lineDraft, positionId: v })}
            value={lineDraft.positionId || ''}
          >
            <SelectTrigger className="h-11">
              <SelectValue placeholder="เลือกตำแหน่งงาน..." />
            </SelectTrigger>
            <SelectContent>
              {ratesSorted.map((r) => {
                const p = allPositions?.find((pos) => pos.id === r.positionId);
                return (
                  <SelectItem key={r.id} value={r.positionId}>
                    {(p?.positionName || p?.positionNameTh) || r.positionId}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {disablePosition ? (
            <p className="text-[11px] text-muted-foreground">มีการมอบหมายแล้ว — เปลี่ยนตำแหน่งไม่ได้</p>
          ) : null}
        </div>
        <div className="grid gap-2">
          <Label className="font-bold">จำนวนคนงานที่ต้องการ (Quantity)</Label>
          <Input
            type="number"
            min={1}
            value={Number(lineDraft.quantity ?? 1)}
            onChange={(e) => setLineDraft({ ...lineDraft, quantity: Number(e.target.value) || 1 })}
            className="h-11"
          />
        </div>
        <div className="grid gap-2">
          <Label className="font-bold">สถานที่ปฏิบัติงาน (Work location)</Label>
          <Input
            placeholder="เช่น BD3-F1 / Erawan Platform"
            value={lineDraft.workLocation || ''}
            onChange={(e) => setLineDraft({ ...lineDraft, workLocation: e.target.value })}
            className="h-11"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label className="font-bold text-xs">วันที่เริ่ม (รายบรรทัด)</Label>
            <DatePickerThaiBE
              value={lineDraft.startDate}
              onChange={(ms) => setLineDraft({ ...lineDraft, startDate: ms })}
            />
          </div>
          <div className="grid gap-2">
            <Label className="font-bold text-xs">วันที่สิ้นสุด (รายบรรทัด)</Label>
            <DatePickerThaiBE
              value={lineDraft.endDate}
              onChange={(ms) => setLineDraft({ ...lineDraft, endDate: ms })}
            />
          </div>
        </div>
        {showStatus ? (
          <div className="grid gap-2">
            <Label className="font-bold">สถานะบรรทัด</Label>
            <Select
              value={lineDraft.status || 'active'}
              onValueChange={(v: POLine['status']) => setLineDraft({ ...lineDraft, status: v })}
            >
              <SelectTrigger className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active — เปิดรับมอบหมาย</SelectItem>
                <SelectItem value="cancelled">Cancelled — ยกเลิกบรรทัด</SelectItem>
                <SelectItem value="completed">Completed — ปิดบรรทัด</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          ยกเลิก
        </Button>
        <Button
          onClick={onSave}
          disabled={isBusy || !lineDraft.positionId || !lineDraft.quantity || !isLinkedSourceReady}
          className="bg-primary font-bold px-8"
        >
          {isBusy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2 inline" />
              กำลังบันทึก...
            </>
          ) : (
            saveLabel
          )}
        </Button>
      </DialogFooter>
    </>
  );
}

/** @deprecated alias — use LineFormBody */
function AddLineBody(props: {
  po: PurchaseOrder;
  allPositions: Position[] | undefined;
  newLine: Partial<POLine>;
  setNewLine: React.Dispatch<React.SetStateAction<Partial<POLine>>>;
  isAddingLine: boolean;
  onAdd: () => void;
  onCancel: () => void;
  isLinkedSourceReady: boolean;
  ratesSorted: PositionRate[];
}) {
  return (
    <LineFormBody
      po={props.po}
      allPositions={props.allPositions}
      lineDraft={props.newLine}
      setLineDraft={props.setNewLine}
      isBusy={props.isAddingLine}
      onSave={props.onAdd}
      onCancel={props.onCancel}
      isLinkedSourceReady={props.isLinkedSourceReady}
      ratesSorted={props.ratesSorted}
      saveLabel="เพิ่มรายการจอง"
    />
  );
}

function AddLineDialogWithRates({
  po,
  open,
  onOpenChange,
  allPositions,
  newLine,
  setNewLine,
  isAddingLine,
  onAdd,
}: {
  po: PurchaseOrder | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  allPositions: Position[] | undefined;
  newLine: Partial<POLine>;
  setNewLine: React.Dispatch<React.SetStateAction<Partial<POLine>>>;
  isAddingLine: boolean;
  onAdd: () => void;
}) {
  const firestore = useFirestore();
  const mcRef = useMemoFirebase(
    () => (firestore && po?.contractId ? doc(firestore, 'main_contracts', po.contractId) : null),
    [firestore, po?.contractId],
  );
  const { data: mc } = useDoc<MainContract>(mcRef as any);
  const ratesQuery = useMemoFirebase(
    () =>
      firestore && po?.contractId
        ? collection(firestore, 'main_contracts', po.contractId, 'position_rates')
        : null,
    [firestore, po?.contractId],
  );
  const { data: rates } = useCollection<PositionRate>(ratesQuery as any);
  const ratesSorted = useMemo(
    () => (rates ? sortPositionRatesByDisplayName(rates, allPositions ?? null) : []),
    [rates, allPositions],
  );
  const isLinkedSourceReady =
    (po?.poType || 'contract') === 'contract' && isMainContractEligibleForPoActiveWorkflow(mc?.status);

  if (!po) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>เพิ่มบรรทัดโควต้า — {po.poCode}</DialogTitle>
          <DialogDescription>
            เลือกตำแหน่งจากอัตราในสัญญาหลักของ PO นี้ ระบบสแนปราคาขาย/OT จากสัญญา
          </DialogDescription>
        </DialogHeader>
        {!isLinkedSourceReady && (
          <Badge variant="destructive" className="w-fit">
            สัญญาหลักยังไม่ Active — ยังไม่ควรเพิ่มบรรทัด
          </Badge>
        )}
        <AddLineBody
          po={po}
          allPositions={allPositions}
          newLine={newLine}
          setNewLine={setNewLine}
          isAddingLine={isAddingLine}
          onAdd={onAdd}
          onCancel={() => onOpenChange(false)}
          isLinkedSourceReady={isLinkedSourceReady}
          ratesSorted={ratesSorted}
        />
      </DialogContent>
    </Dialog>
  );
}

function EditLineDialogWithRates({
  line,
  po,
  open,
  onOpenChange,
  allPositions,
  editDraft,
  setEditDraft,
  isSaving,
  onSave,
  disablePosition,
}: {
  line: POLine | null;
  po: PurchaseOrder | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  allPositions: Position[] | undefined;
  editDraft: Partial<POLine> | null;
  setEditDraft: React.Dispatch<React.SetStateAction<POLine | null>>;
  isSaving: boolean;
  onSave: () => void;
  disablePosition: boolean;
}) {
  const firestore = useFirestore();
  const mcRef = useMemoFirebase(
    () => (firestore && po?.contractId ? doc(firestore, 'main_contracts', po.contractId) : null),
    [firestore, po?.contractId],
  );
  const { data: mc } = useDoc<MainContract>(mcRef as any);
  const ratesQuery = useMemoFirebase(
    () =>
      firestore && po?.contractId
        ? collection(firestore, 'main_contracts', po.contractId, 'position_rates')
        : null,
    [firestore, po?.contractId],
  );
  const { data: rates } = useCollection<PositionRate>(ratesQuery as any);
  const ratesSorted = useMemo(
    () => (rates ? sortPositionRatesByDisplayName(rates, allPositions ?? null) : []),
    [rates, allPositions],
  );
  const isLinkedSourceReady =
    (po?.poType || 'contract') === 'contract' && isMainContractEligibleForPoActiveWorkflow(mc?.status);

  if (!po || !line || !editDraft) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>แก้ไขบรรทัดโควต้า — {po.poCode}</DialogTitle>
          <DialogDescription>
            ปรับจำนวน ช่วงวันที่ สถานที่ หรือสถานะบรรทัด — มอบหมายคนทำที่ PO Active / Assignments
          </DialogDescription>
        </DialogHeader>
        {!isLinkedSourceReady && (
          <Badge variant="destructive" className="w-fit">
            สัญญาหลักยังไม่ Active — ตรวจก่อนบันทึก
          </Badge>
        )}
        <LineFormBody
          po={po}
          allPositions={allPositions}
          lineDraft={editDraft}
          setLineDraft={(updater) => {
            setEditDraft((prev) => {
              if (!prev) return prev;
              const next = typeof updater === 'function' ? updater(prev) : updater;
              return { ...prev, ...next };
            });
          }}
          isBusy={isSaving}
          onSave={onSave}
          onCancel={() => onOpenChange(false)}
          isLinkedSourceReady={isLinkedSourceReady}
          ratesSorted={ratesSorted}
          disablePosition={disablePosition}
          showStatus
          saveLabel="บันทึกการแก้ไข"
        />
      </DialogContent>
    </Dialog>
  );
}

export interface PoActiveBundleLinesPanelProps {
  bundlePos: PurchaseOrder[];
  bundleLines: POLine[];
  allPositions: Position[] | null | undefined;
  allMobs: Assignment[] | null | undefined;
}

export function PoActiveBundleLinesPanel({
  bundlePos,
  bundleLines,
  allPositions,
  allMobs,
}: PoActiveBundleLinesPanelProps) {
  const firestore = useFirestore();
  const { currentUser } = useAppUser();
  const { toast } = useToast();
  const canEditPo = useMemo(() => canEdit(currentUser, 'customer_pos'), [currentUser]);
  const canDeletePo = useMemo(() => canDelete(currentUser, 'customer_pos'), [currentUser]);

  const countAssignedOnLine = useCallback(
    (line: POLine) =>
      (allMobs ?? []).filter(
        (a) => a.poId === line.poId && a.poLineId === line.id && assignmentCountsTowardQuota(a),
      ).length,
    [allMobs],
  );

  const hasAnyMobOnLine = useCallback(
    (line: POLine) => (allMobs ?? []).some((a) => a.poId === line.poId && a.poLineId === line.id),
    [allMobs],
  );

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [selectedPoForAdd, setSelectedPoForAdd] = useState<PurchaseOrder | null>(null);
  const [isAddingLine, setIsAddingLine] = useState(false);
  const [newLine, setNewLine] = useState<Partial<POLine>>({
    quantity: 1,
    status: 'active',
    workLocation: '',
    sellRateSnapshot: 0,
    costBaselineSnapshot: 0,
    billingUnitSnapshot: 'daily',
    overtimeRuleSnapshot: '1.5x of Hourly Rate',
  });

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editDraft, setEditDraft] = useState<POLine | null>(null);
  const [isSavingLine, setIsSavingLine] = useState(false);
  const [lineToDelete, setLineToDelete] = useState<POLine | null>(null);
  const [isDeletingLine, setIsDeletingLine] = useState(false);
  const [isResyncingRates, setIsResyncingRates] = useState(false);

  const primaryContractId = bundlePos[0]?.contractId ?? '';
  const contractRatesQuery = useMemoFirebase(
    () =>
      firestore && primaryContractId
        ? collection(firestore, 'main_contracts', primaryContractId, 'position_rates')
        : null,
    [firestore, primaryContractId],
  );
  const { data: contractRatesRaw } = useCollection<PositionRate>(contractRatesQuery);
  const contractRatesByPosition = useMemo(() => {
    const map = new Map<string, PositionRate>();
    for (const r of contractRatesRaw ?? []) {
      if (r.active === false) continue;
      map.set(r.positionId, r);
    }
    return map;
  }, [contractRatesRaw]);

  const positionsById = useMemo(() => {
    const map = new Map<string, Position>();
    for (const p of allPositions ?? []) map.set(p.id, p);
    return map;
  }, [allPositions]);

  useEffect(() => {
    if (!isAddOpen) return;
    const first = bundlePos[0];
    setSelectedPoForAdd(first ?? null);
    setNewLine({
      quantity: 1,
      status: 'active',
      workLocation: '',
      sellRateSnapshot: 0,
      costBaselineSnapshot: 0,
      billingUnitSnapshot: 'daily',
      overtimeRuleSnapshot: '1.5x of Hourly Rate',
      startDate: first?.startDate,
      endDate: first?.endDate,
    });
  }, [isAddOpen, bundlePos]);

  useEffect(() => {
    if (!selectedPoForAdd || !isAddOpen) return;
    setNewLine((prev) => ({
      ...prev,
      startDate: prev.startDate ?? selectedPoForAdd.startDate,
      endDate: prev.endDate ?? selectedPoForAdd.endDate,
      positionId: undefined,
    }));
  }, [selectedPoForAdd?.id, isAddOpen]);

  const sortedLines = useMemo(() => {
    const list = [...bundleLines];
    list.sort((a, b) => {
      const pa = bundlePos.find((p) => p.id === a.poId)?.poCode || a.poId;
      const pb = bundlePos.find((p) => p.id === b.poId)?.poCode || b.poId;
      const c = pa.localeCompare(pb, 'th');
      if (c !== 0) return c;
      return a.positionId.localeCompare(b.positionId, 'th');
    });
    return list;
  }, [bundleLines, bundlePos]);

  const handleAddLine = async () => {
    if (!canEditPo || !firestore || !currentUser || !selectedPoForAdd || !newLine.positionId) return;
    const po = selectedPoForAdd;
    if (po.status === 'closed') {
      toast({
        variant: 'destructive',
        title: 'PO ปิดแล้ว',
        description: 'ไม่สามารถเพิ่มบรรทัดใน PO นี้',
      });
      return;
    }
    const ratesQuery = collection(firestore, 'main_contracts', po.contractId, 'position_rates');
    const ratesSnap = await getDocs(ratesQuery);
    const rates = ratesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) } as PositionRate));
    const rate = rates.find((r) => r.positionId === newLine.positionId);
    if (!rate) {
      toast({
        variant: 'destructive',
        title: 'ไม่พบราคาในสัญญา',
        description: 'ตำแหน่งนี้ยังไม่มีในสัญญาหลักของ PO',
      });
      return;
    }
    const pos = allPositions?.find((p) => p.id === newLine.positionId);
    const poWorkMode = po.poWorkMode ?? 'OFFSHORE';
    const snapshot = buildPoLineRateSnapshotFromContract(rate, poWorkMode, pos);

    const poLinesCol = collection(firestore, 'purchase_orders', po.id, 'po_lines');
    setIsAddingLine(true);
    try {
      const linePayload: Record<string, unknown> = {
        poId: po.id,
        positionId: newLine.positionId,
        quantity: Number(newLine.quantity) || 1,
        startDate: newLine.startDate || po.startDate || Date.now(),
        endDate: newLine.endDate || po.endDate || Date.now(),
        status: 'active',
        ...snapshot,
      };
      const wl = (newLine.workLocation || '').trim();
      if (wl) linePayload.workLocation = wl;

      const lineRef = await addDoc(poLinesCol, linePayload);
      writeAuditLog(firestore, currentUser, {
        actionType: 'CREATE',
        entityType: 'POLine',
        entityId: lineRef.id,
        entityLabel: newLine.positionId,
        sourceModule: 'commercial',
        purchaseOrderId: po.id,
        afterSummary: `Added PO line (bundle) for ${newLine.positionId}`,
      });
      toast({ title: 'เพิ่ม PO Line สำเร็จ' });
      setIsAddOpen(false);
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'บันทึกไม่สำเร็จ' });
    } finally {
      setIsAddingLine(false);
    }
  };

  const openEditLine = (line: POLine) => {
    if (!canEditPo) return;
    const po = bundlePos.find((p) => p.id === line.poId);
    if (po?.status === 'closed') {
      toast({ variant: 'destructive', title: 'PO ปิดแล้ว', description: 'ไม่สามารถแก้ไขบรรทัดได้' });
      return;
    }
    setEditDraft({ ...line });
    setIsEditOpen(true);
  };

  const buildLineSnapshotFields = async (
    po: PurchaseOrder,
    positionId: string,
  ): Promise<Record<string, unknown> | null> => {
    if (!firestore) return null;
    const ratesQuery = collection(firestore, 'main_contracts', po.contractId, 'position_rates');
    const ratesSnap = await getDocs(ratesQuery);
    const rates = ratesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) } as PositionRate));
    const rate = rates.find((r) => r.positionId === positionId);
    if (!rate) return null;
    const pos = allPositions?.find((p) => p.id === positionId);
    return buildPoLineRateSnapshotFromContract(rate, po.poWorkMode ?? 'OFFSHORE', pos);
  };

  const handleResyncRatesFromContract = async () => {
    if (!canEditPo || !firestore) return;
    setIsResyncingRates(true);
    try {
      let totalUpdated = 0;
      let totalSkipped = 0;
      for (const po of bundlePos) {
        if (po.status === 'closed' || !po.contractId) continue;
        const { updated, skipped } = await resyncPoLineRateSnapshotsForPo(
          firestore,
          po,
          positionsById,
        );
        totalUpdated += updated;
        totalSkipped += skipped;
      }
      if (totalUpdated === 0) {
        toast({
          variant: 'destructive',
          title: 'ไม่มีบรรทัดที่อัปเดต',
          description:
            totalSkipped > 0
              ? 'ตรวจว่าบรรทัด active และมีตำแหน่งในตารางราคาสัญญา'
              : 'ไม่พบบรรทัดใต้ PO',
        });
        return;
      }
      toast({
        title: 'อัปเดตราคาจากสัญญาแล้ว',
        description: `ปรับ snapshot ${totalUpdated} บรรทัดตามโหมด ${jobModeSellLabel(bundlePos[0]?.poWorkMode ?? 'OFFSHORE')}${totalSkipped > 0 ? ` (ข้าม ${totalSkipped})` : ''}`,
      });
    } catch (e) {
      console.error(e);
      toast({
        variant: 'destructive',
        title: 'ซิงก์ราคาไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setIsResyncingRates(false);
    }
  };

  const handleSaveEditLine = async () => {
    if (!canEditPo || !firestore || !currentUser || !editDraft?.id || !editDraft.positionId) return;
    const po = bundlePos.find((p) => p.id === editDraft.poId);
    if (!po) return;
    if (po.status === 'closed') {
      toast({ variant: 'destructive', title: 'PO ปิดแล้ว', description: 'ไม่สามารถแก้ไขบรรทัดได้' });
      return;
    }
    const assigned = countAssignedOnLine(editDraft);
    const qty = Number(editDraft.quantity) || 0;
    if (qty < assigned) {
      toast({
        variant: 'destructive',
        title: 'จำนวนไม่ถูกต้อง',
        description: `โควต้าต้องไม่น้อยกว่าจำนวนที่มอบหมายแล้ว (${assigned})`,
      });
      return;
    }
    const originalLine = sortedLines.find((l) => l.id === editDraft.id && l.poId === editDraft.poId);
    const positionChanged = editDraft.positionId !== (originalLine?.positionId ?? editDraft.positionId);
    if (positionChanged && assigned > 0) {
      toast({
        variant: 'destructive',
        title: 'เปลี่ยนตำแหน่งไม่ได้',
        description: 'มีการมอบหมายแล้ว — ลบ/ย้าย mobilization ก่อน',
      });
      return;
    }

    setIsSavingLine(true);
    try {
      const updatePayload: Record<string, unknown> = {
        positionId: editDraft.positionId,
        quantity: qty,
        startDate: editDraft.startDate || po.startDate || Date.now(),
        endDate: editDraft.endDate || po.endDate || Date.now(),
        status: editDraft.status || 'active',
      };
      const wl = (editDraft.workLocation || '').trim();
      if (wl) updatePayload.workLocation = wl;

      if (positionChanged) {
        const snapFields = await buildLineSnapshotFields(po, editDraft.positionId);
        if (!snapFields) {
          toast({
            variant: 'destructive',
            title: 'ไม่พบราคาในสัญญา',
            description: 'ตำแหน่งนี้ยังไม่มีในสัญญาหลักของ PO',
          });
          return;
        }
        Object.assign(updatePayload, snapFields);
      }

      const lineRef = doc(firestore, 'purchase_orders', editDraft.poId, 'po_lines', editDraft.id);
      await updateDoc(lineRef, updatePayload);
      writeAuditLog(firestore, currentUser, {
        actionType: 'UPDATE',
        entityType: 'POLine',
        entityId: editDraft.id,
        entityLabel: editDraft.positionId,
        sourceModule: 'commercial',
        purchaseOrderId: editDraft.poId,
        afterSummary: `Updated PO line qty=${qty} status=${editDraft.status}`,
      });
      toast({ title: 'บันทึกบรรทัดแล้ว' });
      setIsEditOpen(false);
      setEditDraft(null);
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'บันทึกไม่สำเร็จ' });
    } finally {
      setIsSavingLine(false);
    }
  };

  const handleDeleteLine = async () => {
    if (!lineToDelete || !canDeletePo || !firestore || !currentUser) return;
    const po = bundlePos.find((p) => p.id === lineToDelete.poId);
    if (po?.status === 'closed') {
      toast({ variant: 'destructive', title: 'PO ปิดแล้ว', description: 'ไม่สามารถลบบรรทัดได้' });
      return;
    }
    if (hasAnyMobOnLine(lineToDelete)) {
      toast({
        variant: 'destructive',
        title: 'ลบไม่ได้',
        description: 'มี Mobilization / มอบหมายผูกบรรทัดนี้แล้ว — ยกเลิกหรือย้ายก่อน',
      });
      return;
    }
    setIsDeletingLine(true);
    try {
      const lineRef = doc(firestore, 'purchase_orders', lineToDelete.poId, 'po_lines', lineToDelete.id);
      await deleteDoc(lineRef);
      writeAuditLog(firestore, currentUser, {
        actionType: 'DELETE',
        entityType: 'POLine',
        entityId: lineToDelete.id,
        entityLabel: lineToDelete.positionId,
        sourceModule: 'commercial',
        purchaseOrderId: lineToDelete.poId,
        afterSummary: 'Deleted PO quota line',
      });
      toast({ title: 'ลบบรรทัดแล้ว' });
      setLineToDelete(null);
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'ลบไม่สำเร็จ' });
    } finally {
      setIsDeletingLine(false);
    }
  };

  const editPo = editDraft ? bundlePos.find((p) => p.id === editDraft.poId) ?? null : null;
  const editAssignedCount = editDraft ? countAssignedOnLine(editDraft) : 0;

  return (
    <Card className="border-primary/20 overflow-hidden">
      <CardHeader className="border-b bg-muted/30">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>บรรทัดโควต้า (ตำแหน่ง / จำนวนคน)</CardTitle>
            <CardDescription>
              กำหนดตำแหน่งและจำนวนคนที่ต้องการใน PO — มอบหมายคนจริงทำที่ PO Active / Assignments (ไม่ใช่หน้านี้)
            </CardDescription>
          </div>
          {canEditPo && bundlePos.length > 0 && (
            <div className="flex flex-wrap gap-2 items-center">
              <Select
                value={selectedPoForAdd?.id ?? ''}
                onValueChange={(id) =>
                  setSelectedPoForAdd(bundlePos.find((p) => p.id === id) ?? null)
                }
              >
                <SelectTrigger className="h-9 w-[220px]">
                  <SelectValue placeholder="เลือก PO ที่จะเพิ่มบรรทัด" />
                </SelectTrigger>
                <SelectContent>
                  {bundlePos.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.poCode}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                className="gap-2 h-9 font-semibold"
                onClick={() => setIsAddOpen(true)}
              >
                <Plus className="h-4 w-4" /> เพิ่มบรรทัด
              </Button>
              <Button
                type="button"
                variant="outline"
                className="gap-2 h-9"
                disabled={isResyncingRates}
                title="ดึงราคาขายจากตารางสัญญาใหม่ตามโหมด Onshore/Offshore ของ PO"
                onClick={() => void handleResyncRatesFromContract()}
              >
                {isResyncingRates ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                ซิงก์ราคาจากสัญญา
              </Button>
              <AddLineDialogWithRates
                po={selectedPoForAdd}
                open={isAddOpen}
                onOpenChange={setIsAddOpen}
                allPositions={allPositions ?? undefined}
                newLine={newLine}
                setNewLine={setNewLine}
                isAddingLine={isAddingLine}
                onAdd={() => void handleAddLine()}
              />
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">PO</TableHead>
              <TableHead>ตำแหน่ง</TableHead>
              <TableHead className="hidden lg:table-cell">ช่วงวันที่</TableHead>
              <TableHead className="hidden md:table-cell">สถานที่</TableHead>
              <TableHead className="text-center">สถานะ</TableHead>
              <TableHead className="text-center">โควต้า</TableHead>
              <TableHead className="text-center">มอบหมาย</TableHead>
              <TableHead className="text-center">ว่าง</TableHead>
              <TableHead className="text-right">ราคาขาย</TableHead>
              <TableHead className="text-right pr-6">ดำเนินการ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedLines.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-14 text-muted-foreground text-sm">
                  ยังไม่มีบรรทัด — เลือก PO แล้วกด «เพิ่มบรรทัด»
                </TableCell>
              </TableRow>
            ) : (
              sortedLines.map((line) => {
                const po = bundlePos.find((p) => p.id === line.poId);
                const pos = allPositions?.find((p) => p.id === line.positionId);
                const label = pos ? positionListPrimaryName(pos as PositionDoc) : line.positionId;
                const assignedCount =
                  (allMobs ?? []).filter(
                    (a) =>
                      a.poId === line.poId &&
                      a.poLineId === line.id &&
                      assignmentCountsTowardQuota(a),
                  ).length ?? 0;
                const vacant =
                  line.status === 'active' ? Math.max(0, line.quantity - assignedCount) : 0;
                const q = encodeURIComponent(line.poId);
                const assignHref = `/assignments?poId=${q}&poLineId=${encodeURIComponent(line.id)}&openDialog=1`;
                const rosterHref = `/assignments?poId=${q}&poLineId=${encodeURIComponent(line.id)}`;

                return (
                  <TableRow key={`${line.poId}-${line.id}`}>
                    <TableCell className="pl-6 font-mono text-xs font-semibold text-primary">
                      {po?.poCode ?? line.poId}
                    </TableCell>
                    <TableCell className="font-medium max-w-[160px]">{label}</TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground whitespace-nowrap">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="h-3 w-3 shrink-0" />
                        {formatDateRangeThaiBE(line.startDate, line.endDate)}
                      </span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground max-w-[140px]">
                      {(line.workLocation || '').trim() || '—'}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {line.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center font-semibold">{line.quantity}</TableCell>
                    <TableCell className="text-center">{assignedCount}</TableCell>
                    <TableCell className="text-center">
                      {line.status === 'active' ? (
                        vacant > 0 ? (
                          <Badge className="bg-amber-100 text-amber-800 border-amber-200">{vacant}</Badge>
                        ) : (
                          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">
                            <CheckCircle2 className="h-3 w-3 mr-0.5 inline" />0
                          </Badge>
                        )
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {(() => {
                        const poWorkMode = po?.poWorkMode ?? 'OFFSHORE';
                        const contractRate =
                          po?.contractId === primaryContractId
                            ? contractRatesByPosition.get(line.positionId)
                            : undefined;
                        const sellUnit = displayPoLineSellRateForWorkMode(
                          line,
                          poWorkMode,
                          contractRate,
                        );
                        return (
                          <>
                            <span className="text-green-700 font-bold text-sm">
                              ฿{Number(sellUnit).toLocaleString()}
                            </span>
                            <span className="block text-[10px] text-muted-foreground uppercase">
                              {line.billingUnitSnapshot}
                            </span>
                            <span className="block text-[10px] font-medium text-primary/80">
                              ({jobModeSellLabel(poWorkMode)})
                            </span>
                          </>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-right pr-6">
                      <div className="flex justify-end items-center gap-1 flex-wrap">
                        {canEditPo && po?.status !== 'closed' && (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 shrink-0 text-primary"
                            title="แก้ไขบรรทัดโควต้า"
                            onClick={() => openEditLine(line)}
                          >
                            <Pencil className="h-4 w-4" aria-hidden />
                            <span className="sr-only">แก้ไข</span>
                          </Button>
                        )}
                        {canDeletePo && po?.status !== 'closed' && (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                            title={
                              hasAnyMobOnLine(line)
                                ? 'ลบไม่ได้ — มี mobilization ผูกอยู่'
                                : 'ลบบรรทัดโควต้า'
                            }
                            disabled={hasAnyMobOnLine(line)}
                            onClick={() => setLineToDelete(line)}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                            <span className="sr-only">ลบ</span>
                          </Button>
                        )}
                        {line.status === 'active' && vacant > 0 && (
                          <Button size="sm" variant="secondary" className="h-8 text-xs font-semibold" asChild>
                            <Link href={assignHref}>Assign</Link>
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          title="ดูรายการมอบหมายในบรรทัดนี้"
                          asChild
                        >
                          <Link href={rosterHref}>
                            <ChevronRight className="h-4 w-4" aria-hidden />
                            <span className="sr-only">ดูผู้ถูกมอบหมายในบรรทัดนี้</span>
                          </Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
      <EditLineDialogWithRates
        line={editDraft}
        po={editPo}
        open={isEditOpen}
        onOpenChange={(open) => {
          setIsEditOpen(open);
          if (!open) setEditDraft(null);
        }}
        allPositions={allPositions ?? undefined}
        editDraft={editDraft}
        setEditDraft={setEditDraft}
        isSaving={isSavingLine}
        onSave={() => void handleSaveEditLine()}
        disablePosition={editAssignedCount > 0}
      />
      <AlertDialog
        open={lineToDelete !== null}
        onOpenChange={(open) => {
          if (!open && !isDeletingLine) setLineToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ลบบรรทัดโควต้า?</AlertDialogTitle>
            <AlertDialogDescription>
              {lineToDelete ? (
                <>
                  ตำแหน่ง{' '}
                  <strong>
                    {allPositions?.find((p) => p.id === lineToDelete.positionId)?.positionNameTh ||
                      lineToDelete.positionId}
                  </strong>{' '}
                  · PO {bundlePos.find((p) => p.id === lineToDelete.poId)?.poCode ?? lineToDelete.poId}
                  <span className="mt-2 block">
                    การลบถาวร — ใช้ได้เมื่อยังไม่มี mobilization / มอบหมายผูกบรรทัดนี้
                  </span>
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingLine}>ยกเลิก</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={isDeletingLine}
              onClick={() => void handleDeleteLine()}
            >
              {isDeletingLine ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              ลบบรรทัด
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
