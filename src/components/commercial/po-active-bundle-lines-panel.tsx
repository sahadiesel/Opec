'use client';

import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { collection, doc, addDoc, getDocs } from 'firebase/firestore';
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
import { Plus, ChevronRight, Loader2, Calendar, CheckCircle2 } from 'lucide-react';
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
import { defaultLaborDailyFromPosition } from '@/lib/payroll/timesheet-labor-base-cost';
import {
  effectiveSellOnshore,
  effectiveSellOffshore,
  legacySellRateMirror,
} from '@/lib/commercial/position-rate-sell';
import { writeAuditLog } from '@/lib/services/audit-service';
import { useToast } from '@/hooks/use-toast';
function AddLineBody({
  po,
  allPositions,
  newLine,
  setNewLine,
  isAddingLine,
  onAdd,
  onCancel,
  isLinkedSourceReady,
  ratesSorted,
}: {
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
    <>
      <div className="grid gap-4 py-4">
        <div className="grid gap-2">
          <Label className="font-bold">ตำแหน่งงาน (จากสัญญาหลัก)</Label>
          <Select
            onValueChange={(v) => setNewLine({ ...newLine, positionId: v })}
            value={newLine.positionId || ''}
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
        </div>
        <div className="grid gap-2">
          <Label className="font-bold">จำนวนคนงานที่ต้องการ (Quantity)</Label>
          <Input
            type="number"
            min={1}
            value={Number(newLine.quantity ?? 1)}
            onChange={(e) => setNewLine({ ...newLine, quantity: Number(e.target.value) || 1 })}
            className="h-11"
          />
        </div>
        <div className="grid gap-2">
          <Label className="font-bold">สถานที่ปฏิบัติงาน (Work location)</Label>
          <Input
            placeholder="เช่น BD3-F1 / Erawan Platform"
            value={newLine.workLocation || ''}
            onChange={(e) => setNewLine({ ...newLine, workLocation: e.target.value })}
            className="h-11"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label className="font-bold text-xs">วันที่เริ่ม (รายบรรทัด)</Label>
            <DatePickerThaiBE
              value={newLine.startDate}
              onChange={(ms) => setNewLine({ ...newLine, startDate: ms })}
            />
          </div>
          <div className="grid gap-2">
            <Label className="font-bold text-xs">วันที่สิ้นสุด (รายบรรทัด)</Label>
            <DatePickerThaiBE
              value={newLine.endDate}
              onChange={(ms) => setNewLine({ ...newLine, endDate: ms })}
            />
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          ยกเลิก
        </Button>
        <Button
          onClick={onAdd}
          disabled={
            isAddingLine || !newLine.positionId || !newLine.quantity || !isLinkedSourceReady
          }
          className="bg-primary font-bold px-8"
        >
          {isAddingLine ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2 inline" />
              กำลังบันทึก...
            </>
          ) : (
            'เพิ่มรายการจอง'
          )}
        </Button>
      </DialogFooter>
    </>
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
    const sellRateSnapshot = legacySellRateMirror(rate);
    const costBaselineSnapshot = defaultLaborDailyFromPosition(pos) || 0;
    const billingUnitSnapshot = rate.billingUnit || 'daily';
    const overtimeRuleSnapshot = rate.overtimeRule || '1.5x of Hourly Rate';
    const sellOtRulesSnapshot = rate.sellOtRules ? { ...rate.sellOtRules } : undefined;
    const costOtRulesSnapshot = rate.costOtRules ? { ...rate.costOtRules } : undefined;
    const normalWorkHoursSnapshot = rate.normalWorkHours;

    const poLinesCol = collection(firestore, 'purchase_orders', po.id, 'po_lines');
    setIsAddingLine(true);
    try {
      const linePayload: Record<string, unknown> = {
        poId: po.id,
        positionId: newLine.positionId,
        quantity: Number(newLine.quantity) || 1,
        startDate: newLine.startDate || po.startDate || Date.now(),
        endDate: newLine.endDate || po.endDate || Date.now(),
        sellRateSnapshot,
        costBaselineSnapshot,
        billingUnitSnapshot,
        overtimeRuleSnapshot,
        status: 'active',
      };
      const snapOn = effectiveSellOnshore(rate);
      const snapOff = effectiveSellOffshore(rate);
      if (snapOn > 0) linePayload.sellRateSnapshotOnshore = snapOn;
      if (snapOff > 0) linePayload.sellRateSnapshotOffshore = snapOff;
      if (sellOtRulesSnapshot) linePayload.sellOtRulesSnapshot = sellOtRulesSnapshot;
      if (costOtRulesSnapshot) linePayload.costOtRulesSnapshot = costOtRulesSnapshot;
      if (normalWorkHoursSnapshot) linePayload.normalWorkHoursSnapshot = normalWorkHoursSnapshot;
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
                      <span className="text-green-700 font-bold text-sm">
                        ฿{Number(line.sellRateSnapshot ?? 0).toLocaleString()}
                      </span>
                      <span className="block text-[10px] text-muted-foreground uppercase">
                        {line.billingUnitSnapshot}
                      </span>
                    </TableCell>
                    <TableCell className="text-right pr-6">
                      <div className="flex justify-end items-center gap-1 flex-wrap">
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
    </Card>
  );
}
