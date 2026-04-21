
'use client';

import { useState, use, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import {
  formatDateRangeThaiBE,
  formatDateThaiBE,
  formatYmdLocalThaiBE,
  formatStoredDateRangeThaiBE,
} from '@/lib/date-thai';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Plus, 
  Trash2, 
  Save, 
  ShoppingCart, 
  ArrowLeft,
  FileText,
  Building2,
  Briefcase,
  Users,
  Calendar,
  CheckCircle2,
  AlertCircle,
  History,
  Info,
  Loader2,
  Zap,
  Percent,
  ChevronRight,
  ClipboardList,
  ListOrdered,
  ArrowRight,
  Pencil,
} from 'lucide-react';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog';
import { useFirestore, useDoc, useCollection, useMemoFirebase } from '@/firebase';
import { doc, collection, query, where, updateDoc, addDoc, getDocs, writeBatch } from 'firebase/firestore';
import { updateDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { 
  PurchaseOrder, 
  POLine, 
  Customer, 
  MainContract, 
  Position, 
  PositionRate, 
  User, 
  Assignment, 
  Worker,
  SalesContractTerm,
  LaborCostContractTerm,
  Quotation,
  Wave
} from '@/lib/types';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { Textarea } from '@/components/ui/textarea';
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';
import { writeAuditLog } from '@/lib/services/audit-service';
import { useAppUser } from '@/hooks/use-app-user';
import { canView, canEdit, canDelete, isSystemAdmin, canApprovePurchaseAsManager } from '@/lib/permissions';
import { sortPositionRatesByDisplayName, sortPositionsByDisplayName } from '@/lib/position-display';
import {
  aggregateActiveLineTotals,
  assignmentCountsTowardQuota,
  buildPoFulfillmentByLine,
} from '@/lib/ops/po-fulfillment-read-model';

export default function CustomerPODetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const canViewPo = useMemo(() => canView(currentUser, 'customer_pos'), [currentUser]);
  const canEditPo = useMemo(() => canEdit(currentUser, 'customer_pos'), [currentUser]);
  const canDeletePo = useMemo(() => canDelete(currentUser, 'customer_pos'), [currentUser]);
  const canApprovePo = useMemo(() => canApprovePurchaseAsManager(currentUser), [currentUser]);
  const isAdminUser = useMemo(() => isSystemAdmin(currentUser), [currentUser]);

  const poRef = useMemoFirebase(() => (firestore && canViewPo ? doc(firestore, 'purchase_orders', id) : null), [firestore, id, canViewPo]);
  const { data: po, isLoading: isPOLoading } = useDoc<PurchaseOrder>(poRef as any);

  const poLinesQuery = useMemoFirebase(() => (firestore && canViewPo ? collection(firestore, 'purchase_orders', id, 'po_lines') : null), [firestore, id, canViewPo]);
  const { data: poLines } = useCollection<POLine>(poLinesQuery as any);

  // Linkage: Sales Terms (Revenue Side)
  const salesTermsQuery = useMemoFirebase(() => (firestore && canViewPo ? query(collection(firestore, 'sales_contract_terms'), where('purchaseOrderId', '==', id)) : null), [firestore, id, canViewPo]);
  const { data: salesTerms } = useCollection<SalesContractTerm>(salesTermsQuery as any);

  // Linkage: Cost Terms (Expense Side)
  const costTermsQuery = useMemoFirebase(() => (firestore && canViewPo ? query(collection(firestore, 'labor_cost_contract_terms'), where('relatedPurchaseOrderId', '==', id)) : null), [firestore, id, canViewPo]);
  const { data: costTerms } = useCollection<LaborCostContractTerm>(costTermsQuery as any);

  const assignmentsQuery = useMemoFirebase(() => {
    if (!firestore || !canViewPo) return null;
    return query(collection(firestore, 'mobilizations'), where('poId', '==', id));
  }, [firestore, id, canViewPo]);
  const { data: allAssignments } = useCollection<Assignment>(assignmentsQuery as any);

  const wavesQuery = useMemoFirebase(() => {
    if (!firestore || !canViewPo) return null;
    return query(collection(firestore, 'waves'), where('poId', '==', id));
  }, [firestore, id, canViewPo]);
  const { data: poWaves } = useCollection<Wave>(wavesQuery as any);

  const customersQuery = useMemoFirebase(() => (firestore && canViewPo ? collection(firestore, 'customers') : null), [firestore, canViewPo]);
  const { data: customers } = useCollection<Customer>(customersQuery as any);

  const contractRef = useMemoFirebase(() => (firestore && canViewPo && po?.contractId ? doc(firestore, 'main_contracts', po.contractId) : null), [firestore, po?.contractId, canViewPo]);
  const { data: contract } = useDoc<MainContract>(contractRef as any);

  const ratesQuery = useMemoFirebase(() => (firestore && canViewPo && po?.contractId ? collection(firestore, 'main_contracts', po.contractId, 'position_rates') : null), [firestore, po?.contractId, canViewPo]);
  const { data: rates } = useCollection<PositionRate>(ratesQuery as any);

  const positionsQuery = useMemoFirebase(() => (firestore && canViewPo ? collection(firestore, 'positions') : null), [firestore, canViewPo]);
  const { data: allPositions } = useCollection<Position>(positionsQuery as any);

  const positionsSortedForPoLine = useMemo(
    () => sortPositionsByDisplayName(allPositions ?? []),
    [allPositions]
  );

  const ratesSortedForPoLine = useMemo(
    () => (rates ? sortPositionRatesByDisplayName(rates, allPositions ?? null) : []),
    [rates, allPositions]
  );

  const quotationRef = useMemoFirebase(
    () => (firestore && po?.quotationId ? doc(firestore, 'quotations', po.quotationId) : null),
    [firestore, po?.quotationId]
  );
  const { data: quotation } = useDoc<Quotation>(quotationRef as any);

  const workersQuery = useMemoFirebase(() => (firestore && canViewPo ? collection(firestore, 'workers') : null), [firestore, canViewPo]);
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  const fulfillmentRows = useMemo(
    () => buildPoFulfillmentByLine(poLines, allAssignments, poWaves, id),
    [poLines, allAssignments, poWaves, id]
  );
  const fulfillmentTotals = useMemo(() => aggregateActiveLineTotals(fulfillmentRows), [fulfillmentRows]);
  const hasActiveSalesTerm = useMemo(
    () => !!(salesTerms || []).some((t) => t.status === 'ACTIVE'),
    [salesTerms]
  );
  const hasActiveLaborCostTerm = useMemo(
    () => !!(costTerms || []).some((t) => t.status === 'ACTIVE'),
    [costTerms]
  );

  const staffingOrchestrationHint = useMemo(() => {
    if (!po || (po.poType || 'contract') !== 'contract') return '';
    if (po.status !== 'active') {
      return 'PO ยังไม่ Active — เมื่อเปิดใช้แล้วค่อยดำเนินการเติมโควต้า';
    }
    if (fulfillmentTotals.required <= 0) {
      return 'ยังไม่มีบรรทัดโควต้า — เพิ่มจากแท็บ PO Lines (โควต้า)';
    }
    if (fulfillmentTotals.openSlots <= 0) {
      return 'โควต้าเต็มตามที่ติดตาม — ตรวจ Wave / Mobilization ตามปกติ';
    }
    if (fulfillmentTotals.waveCount === 0) {
      return 'แนะนำ: เริ่มจากสร้าง Wave (ขั้นตอนที่ 1)';
    }
    if (fulfillmentTotals.assigned < fulfillmentTotals.required) {
      return 'มี Wave แล้ว — มอบหมายคนงาน (ขั้นตอนที่ 2)';
    }
    return 'ตรวจความพร้อมและเตรียมส่งตัว (ขั้นตอนที่ 3)';
  }, [po, fulfillmentTotals]);

  const [isEditing, setIsEditing] = useState(false);
  const [editedPO, setEditedPO] = useState<Partial<PurchaseOrder>>({});

  const [isAddLineOpen, setIsAddLineOpen] = useState(false);
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

  const [isApprovingPo, setIsApprovingPo] = useState(false);
  const [isClosingPo, setIsClosingPo] = useState(false);
  const [isDeletingPoDoc, setIsDeletingPoDoc] = useState(false);
  const [isEditLineOpen, setIsEditLineOpen] = useState(false);
  const [editLineDraft, setEditLineDraft] = useState<POLine | null>(null);
  const [isSavingLine, setIsSavingLine] = useState(false);

  useEffect(() => {
    if (po) setEditedPO(po);
  }, [po]);

  const isContractBasedPO = (po?.poType || 'contract') === 'contract';
  const isLinkedContractActive = isContractBasedPO && contract?.status === 'active';
  const isQuotationAccepted =
    !isContractBasedPO &&
    !!po?.quotationId &&
    !!quotation &&
    (quotation.status === 'sent' || quotation.status === 'accepted');
  /** พร้อมเพิ่ม PO Line / Wave: สายสัญญา = สัญญา active | สายใบเสนอราคา = sent/accepted */
  const isLinkedSourceReady = isContractBasedPO ? isLinkedContractActive : isQuotationAccepted;

  /** ปิด PO ได้เมื่อทุก Wave จบแล้ว (COMPLETED/CLOSED) */
  const allWavesTerminalForClose = useMemo(() => {
    if (!poWaves?.length) return false;
    return poWaves.every((w) => w.status === 'COMPLETED' || w.status === 'CLOSED');
  }, [poWaves]);

  const handleSaveMaster = () => {
    if (!canEditPo) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์แก้ไข Customer PO' });
      return;
    }
    if (!poRef || !currentUser || !po) return;
    updateDocumentNonBlocking(poRef, { ...editedPO, updatedAt: Date.now() });
    setIsEditing(false);

    // Audit Log
    writeAuditLog(firestore, currentUser, {
      actionType: 'UPDATE',
      entityType: 'PurchaseOrder',
      entityId: id,
      entityLabel: po.poCode,
      changedFields: Object.keys(editedPO),
      sourceModule: 'commercial',
      purchaseOrderId: id,
      afterSummary: 'Updated purchase order header details'
    });

    toast({ title: "บันทึกสำเร็จ", description: "ข้อมูล Customer PO ถูกอัปเดตแล้ว" });
  };

  const handleApprovePO = async () => {
    if (!canApprovePo) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'เฉพาะผู้จัดการ/แอดมินที่อนุมัติ PO ได้' });
      return;
    }
    if (!poRef || !firestore || !currentUser || !po || po.status !== 'pending') return;
    setIsApprovingPo(true);
    try {
      await updateDoc(poRef, { status: 'active', updatedAt: Date.now() });
      writeAuditLog(firestore, currentUser, {
        actionType: 'UPDATE',
        entityType: 'PurchaseOrder',
        entityId: id,
        entityLabel: po.poCode,
        changedFields: ['status'],
        sourceModule: 'commercial',
        purchaseOrderId: id,
        afterSummary: 'Approved PO → active',
      });
      toast({
        title: 'อนุมัติ PO แล้ว',
        description:
          po.poType === 'quotation'
            ? 'สถานะ Active — ออกใบวางบิล / ใบกำกับภาษีได้ (ไม่มี Wave / Timesheet)'
            : 'สถานะเป็น Active — เปิดสร้าง Wave ได้',
      });
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'อนุมัติไม่สำเร็จ', description: 'ลองใหม่หรือตรวจสิทธิ์ Firestore' });
    } finally {
      setIsApprovingPo(false);
    }
  };

  const handleDeleteEntirePO = async () => {
    if (!isAdminUser) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'ลบ PO ทั้งฉบับได้เฉพาะ System Admin' });
      return;
    }
    if (!firestore || !currentUser || !po || po.status !== 'pending') return;
    if (
      !confirm(
        `ลบ PO ${po.poCode} ถาวร?\n\nรวมบรรทัดโควต้าทั้งหมด — ใช้ได้เฉพาะ PO ที่ยัง Pending และยังไม่ควรมี Wave/มอบหมาย`,
      )
    ) {
      return;
    }
    if ((poWaves?.length || 0) > 0 || (allAssignments?.length || 0) > 0) {
      if (
        !confirm(
          'ตรวจพบ Wave หรือ Mobilization ผูก PO นี้ — การลบอาจทำให้ข้อมูลอ้างอิงเสีย\n\nยืนยันลบต่อหรือไม่?',
        )
      ) {
        return;
      }
    }
    setIsDeletingPoDoc(true);
    try {
      const linesCol = collection(firestore, 'purchase_orders', id, 'po_lines');
      const snap = await getDocs(linesCol);
      const batch = writeBatch(firestore);
      snap.docs.forEach((d) => batch.delete(d.ref));
      batch.delete(doc(firestore, 'purchase_orders', id));
      await batch.commit();
      writeAuditLog(firestore, currentUser, {
        actionType: 'DELETE',
        entityType: 'PurchaseOrder',
        entityId: id,
        entityLabel: po.poCode,
        sourceModule: 'commercial',
        purchaseOrderId: id,
        afterSummary: 'Deleted pending PO and lines',
      });
      toast({ title: 'ลบ PO แล้ว', description: po.poCode });
      router.push('/purchase-orders');
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'ลบไม่สำเร็จ', description: 'ตรวจสอบข้อมูลหรือสิทธิ์' });
    } finally {
      setIsDeletingPoDoc(false);
    }
  };

  const handleClosePo = async () => {
    if (!canEditPo) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์แก้ไข PO' });
      return;
    }
    if (!poRef || !firestore || !currentUser || !po || po.status !== 'active') return;
    if (isContractBasedPO) {
      if (!allWavesTerminalForClose) {
        toast({
          variant: 'destructive',
          title: 'ยังปิด PO ไม่ได้',
          description: 'ทุก Wave ของ PO ต้องเป็นสถานะ COMPLETED หรือ CLOSED ก่อน',
        });
        return;
      }
      if (!confirm('ปิด PO นี้ถาวร?\n\nจะไม่สร้าง Wave หรือส่งตัวเพิ่มใน PO เดิม — งานใหม่ต้องใช้ PO ฉบับใหม่')) return;
    } else {
      if (
        !confirm(
          'ปิด PO นี้ถาวร?\n\nPO จากใบเสนอราคา (ขายสินค้า/บริการครั้งเดียว) — ไม่มี Wave/Timesheet ใช้เมื่อส่งมอบและวางบิลครบแล้ว',
        )
      ) {
        return;
      }
    }
    setIsClosingPo(true);
    try {
      await updateDoc(poRef, { status: 'closed', updatedAt: Date.now() });
      writeAuditLog(firestore, currentUser, {
        actionType: 'UPDATE',
        entityType: 'PurchaseOrder',
        entityId: id,
        entityLabel: po.poCode,
        changedFields: ['status'],
        sourceModule: 'commercial',
        purchaseOrderId: id,
        afterSummary: isContractBasedPO
          ? 'Closed PO — no new waves on this document'
          : 'Closed quotation-based PO — billing path only',
      });
      toast({
        title: 'ปิด PO แล้ว',
        description: isContractBasedPO
          ? 'ไม่สามารถสร้าง Wave เพิ่มใน PO นี้'
          : 'จบงานขาย — ไม่มี Wave/Timesheet ผูก PO นี้',
      });
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'ปิด PO ไม่สำเร็จ' });
    } finally {
      setIsClosingPo(false);
    }
  };

  const handleSaveEditedLine = async () => {
    if (!canEditPo) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'ไม่มีสิทธิ์แก้ไขบรรทัด PO' });
      return;
    }
    if (!firestore || !editLineDraft || !currentUser) return;
    const qty = Math.max(1, Math.floor(Number(editLineDraft.quantity) || 1));
    const lineRef = doc(firestore, 'purchase_orders', id, 'po_lines', editLineDraft.id);
    setIsSavingLine(true);
    try {
      await updateDoc(lineRef, {
        quantity: qty,
        workLocation: (editLineDraft.workLocation || '').trim(),
        startDate: editLineDraft.startDate,
        endDate: editLineDraft.endDate,
        status: editLineDraft.status,
        updatedAt: Date.now(),
      });
      writeAuditLog(firestore, currentUser, {
        actionType: 'UPDATE',
        entityType: 'POLine',
        entityId: editLineDraft.id,
        sourceModule: 'commercial',
        purchaseOrderId: id,
        afterSummary: `Updated PO line qty/location/status`,
      });
      toast({ title: 'บันทึกบรรทัดแล้ว' });
      setIsEditLineOpen(false);
      setEditLineDraft(null);
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'บันทึกไม่สำเร็จ' });
    } finally {
      setIsSavingLine(false);
    }
  };

  const handleAddLine = async () => {
    if (!canEditPo) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์เพิ่มรายการใน Customer PO' });
      return;
    }
    if (po?.status === 'closed') {
      toast({
        variant: 'destructive',
        title: 'PO ปิดแล้ว',
        description: 'ไม่สามารถเพิ่มบรรทัดหรือสร้าง Wave ใน PO นี้ — สร้าง PO ฉบับใหม่',
      });
      return;
    }
    if (!poLinesQuery || !newLine.positionId || !currentUser || !firestore) return;

    if (!isLinkedSourceReady) {
      toast({
        variant: 'destructive',
        title: 'เอกสารต้นทางยังไม่พร้อม',
        description: isContractBasedPO
          ? 'ต้องเปิดสัญญาหลักเป็น Active ก่อนเพิ่ม PO Line'
          : 'ใบเสนอราคาต้องเป็นสถานะส่งแล้วหรือยอมรับแล้ว (sent/accepted) ก่อนเพิ่ม PO Line',
      });
      return;
    }

    let sellRateSnapshot = Number(newLine.sellRateSnapshot) || 0;
    let costBaselineSnapshot = Number(newLine.costBaselineSnapshot) || 0;
    let billingUnitSnapshot = newLine.billingUnitSnapshot || 'daily';
    let overtimeRuleSnapshot = newLine.overtimeRuleSnapshot || '1.5x of Hourly Rate';
    let sellOtRulesSnapshot: Record<string, number> | undefined;
    let costOtRulesSnapshot: Record<string, number> | undefined;
    let normalWorkHoursSnapshot: number | undefined;

    if (isContractBasedPO) {
      const rate = rates?.find(r => r.positionId === newLine.positionId);
      if (!rate) {
        toast({ variant: "destructive", title: "ไม่พบราคาในสัญญา", description: "ตำแหน่งนี้ยังไม่มีในสัญญาหลัก กรุณาเพิ่มในสัญญาก่อน" });
        return;
      }
      sellRateSnapshot = Number(rate.sellRate) || 0;
      costBaselineSnapshot = Number(rate.costBaseline) || 0;
      billingUnitSnapshot = rate.billingUnit || 'daily';
      overtimeRuleSnapshot = rate.overtimeRule || '1.5x of Hourly Rate';
      if (rate.sellOtRules) sellOtRulesSnapshot = { ...rate.sellOtRules };
      if (rate.costOtRules) costOtRulesSnapshot = { ...rate.costOtRules };
      if (rate.normalWorkHours) normalWorkHoursSnapshot = rate.normalWorkHours;
    }

    setIsAddingLine(true);
    try {
      const linePayload: Record<string, unknown> = {
        poId: id,
        positionId: newLine.positionId,
        quantity: Number(newLine.quantity) || 1,
        startDate: newLine.startDate || po?.startDate || Date.now(),
        endDate: newLine.endDate || po?.endDate || Date.now(),
        sellRateSnapshot,
        costBaselineSnapshot,
        billingUnitSnapshot,
        overtimeRuleSnapshot,
        status: 'active',
      };
      if (sellOtRulesSnapshot) linePayload.sellOtRulesSnapshot = sellOtRulesSnapshot;
      if (costOtRulesSnapshot) linePayload.costOtRulesSnapshot = costOtRulesSnapshot;
      if (normalWorkHoursSnapshot) linePayload.normalWorkHoursSnapshot = normalWorkHoursSnapshot;
      const wl = (newLine.workLocation || '').trim();
      if (wl) linePayload.workLocation = wl;
      const lineRef = await addDoc(poLinesQuery, linePayload);
      const lineId = lineRef.id;

      if (isContractBasedPO && po?.status === 'active') {
        const { code: waveNo } = await generateNextDocumentCode(firestore, 'wave', { actor: currentUser.displayName });
        const tsStart = newLine.startDate || po?.startDate || Date.now();
        const tsEnd = newLine.endDate || po?.endDate || Date.now();
        try {
          await addDoc(collection(firestore, 'waves'), {
            waveCode: waveNo,
            poId: id,
            poLineId: lineId,
            lineAllocations: [
              { poLineId: lineId, plannedWorkers: Number(newLine.quantity) || 1 },
            ],
            customerId: po?.customerId || '',
            projectName: po?.projectName || po?.title || '',
            siteLocation: wl,
            rotationPattern: '',
            startDate: new Date(tsStart).toISOString().split('T')[0],
            endDate: new Date(tsEnd).toISOString().split('T')[0],
            status: 'PLANNING',
            plannedWorkers: Number(newLine.quantity) || 1,
            assignedWorkers: 0,
            notes: 'Auto-created with PO Line',
            createdAt: Date.now(),
            createdBy: currentUser.id,
            updatedAt: Date.now(),
            updatedBy: currentUser.id,
          });
          toast({
            title: 'เพิ่ม PO Line สำเร็จ',
            description: 'สร้าง Wave แรกสำหรับบรรทัดนี้แล้ว (เพิ่มเวฟถัดไปได้จากเมนู Waves)',
          });
        } catch (waveErr) {
          console.error(waveErr);
          toast({
            variant: 'destructive',
            title: 'สร้าง Wave อัตโนมัติไม่สำเร็จ',
            description: 'บันทึก PO Line แล้ว แต่สร้าง Wave แรกไม่สำเร็จ กรุณาสร้าง Wave จากเมนู Waves',
          });
        }
      } else if (isContractBasedPO && po?.status !== 'active') {
        toast({
          title: 'เพิ่ม PO Line สำเร็จ',
          description: 'PO ยัง Pending — อนุมัติเป็น Active ก่อน ระบบจึงจะสร้าง Wave อัตโนมัติได้ (หรือสร้าง Wave จากเมนู Waves หลังอนุมัติ)',
        });
      } else {
        toast({
          title: 'เพิ่ม PO Line สำเร็จ',
          description:
            'สายใบเสนอราคา (ขายสินค้า/บริการครั้งเดียว) ไม่ใช้ Wave หรือมอบหมายคนงาน — หลังส่งของ/ปิดงานให้ไปออกใบวางบิลจาก PO',
        });
      }

      writeAuditLog(firestore, currentUser, {
        actionType: 'CREATE',
        entityType: 'POLine',
        entityId: lineId,
        entityLabel: newLine.positionId,
        sourceModule: 'commercial',
        purchaseOrderId: id,
        afterSummary: `Added PO line for ${newLine.positionId} x ${newLine.quantity}`
      });

      setIsAddLineOpen(false);
      setNewLine({
        quantity: 1,
        status: 'active',
        workLocation: '',
        sellRateSnapshot: 0,
        costBaselineSnapshot: 0,
        billingUnitSnapshot: 'daily',
        overtimeRuleSnapshot: '1.5x of Hourly Rate',
      });
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'เกิดข้อผิดพลาด', description: 'ไม่สามารถบันทึก PO Line ได้' });
    } finally {
      setIsAddingLine(false);
    }
  };

  const deleteLine = (lineId: string) => {
    if (!canEditPo && !canDeletePo) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์ลบรายการ PO' });
      return;
    }
    if (!firestore || !currentUser) return;
    if (confirm('ยืนยันการลบรายการนี้? รายการมอบหมายที่เชื่อมโยงอยู่จะยังคงอยู่แต่จะเสียการอ้างอิง')) {
      deleteDocumentNonBlocking(doc(firestore, 'purchase_orders', id, 'po_lines', lineId));
      
      writeAuditLog(firestore, currentUser, {
        actionType: 'DELETE',
        entityType: 'POLine',
        entityId: lineId,
        sourceModule: 'commercial',
        purchaseOrderId: id,
        afterSummary: 'Deleted PO line item'
      });
    }
  };

  if (userLoading || !currentUser) return null;
  if (!canViewPo) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="max-w-5xl mx-auto py-10 text-center text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงเมนูนี้</div>
      </AppShell>
    );
  }
  if (isPOLoading || !po) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-12 w-12 text-primary animate-spin" />
        </div>
      </AppShell>
    );
  }

  const customer = customers?.find(c => c.id === po.customerId);
  const poAssignments = allAssignments || [];
  const poReadyForOps = po.status === 'active';
  const displayServiceAgreementNo = (
    (po.serviceAgreementNo || contract?.serviceAgreementNo || '').trim() || ''
  );

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/purchase-orders"><ArrowLeft className="h-5 w-5" /></Link>
            </Button>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold tracking-tight">{po.title}</h1>
                <Badge variant="outline" className="font-mono text-primary border-primary/20">{po.poCode}</Badge>
                <Badge variant={po.status === 'active' ? 'default' : 'secondary'}>{po.status.toUpperCase()}</Badge>
              </div>
              <div className="text-muted-foreground flex flex-wrap items-center gap-4 mt-1 text-sm">
                <span className="flex items-center gap-1 font-medium"><Building2 className="h-3.5 w-3.5" /> {customer?.name || '...'}</span>
                {isContractBasedPO ? (
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="flex items-center gap-1">
                      <FileText className="h-3.5 w-3.5" /> สัญญา: {contract?.contractNumber || '—'}
                    </span>
                    {displayServiceAgreementNo ? (
                      <span className="font-mono text-muted-foreground">SA No.: {displayServiceAgreementNo}</span>
                    ) : null}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs">
                    <FileText className="h-3.5 w-3.5" /> ใบเสนอราคา: {quotation?.quotationNo || po.quotationId || '—'}
                    {quotation && (
                      <Badge variant="outline" className="text-[10px] ml-1">{quotation.status}</Badge>
                    )}
                  </span>
                )}
                {po.customerPONumber && (
                  <span className="flex items-center gap-1 text-xs"><FileText className="h-3.5 w-3.5" /> Customer PO: {po.customerPONumber}</span>
                )}
                {po.customerPoIssueDate != null && Number(po.customerPoIssueDate) > 0 && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5" /> วันที่ออก PO ลูกค้า: {formatDateThaiBE(po.customerPoIssueDate)}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            {po.status === 'pending' && canApprovePo && (
              <Button
                className="gap-2 bg-emerald-600 hover:bg-emerald-700 h-10"
                disabled={isApprovingPo}
                onClick={() => void handleApprovePO()}
              >
                {isApprovingPo ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                อนุมัติ PO (Active)
              </Button>
            )}
            {po.status === 'pending' && isAdminUser && (
              <Button
                variant="destructive"
                className="h-10"
                disabled={isDeletingPoDoc}
                onClick={() => void handleDeleteEntirePO()}
              >
                {isDeletingPoDoc ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                ลบ PO (Pending)
              </Button>
            )}
            <Button variant="outline" onClick={() => { setEditedPO(po); setIsEditing(!isEditing); }}>
              {isEditing ? 'ยกเลิก' : 'แก้ไขข้อมูล'}
            </Button>
            {isEditing && (
              <Button className="gap-2 bg-primary font-bold shadow-md h-10 px-6" onClick={handleSaveMaster}>
                <Save className="h-4 w-4" /> บันทึกการเปลี่ยนแปลง
              </Button>
            )}
            {isContractBasedPO && po.status === 'active' && allWavesTerminalForClose && canEditPo && (
              <Button
                variant="outline"
                className="h-10 border-amber-600 text-amber-900"
                disabled={isClosingPo}
                onClick={() => void handleClosePo()}
              >
                {isClosingPo ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                ปิด PO (ไม่สร้าง Wave เพิ่ม)
              </Button>
            )}
            {!isContractBasedPO && po.status === 'active' && canEditPo && (
              <Button
                variant="outline"
                className="h-10 border-amber-600 text-amber-900"
                disabled={isClosingPo}
                onClick={() => void handleClosePo()}
              >
                {isClosingPo ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                ปิด PO (งานจากใบเสนอราคา)
              </Button>
            )}
          </div>
        </div>

        {isContractBasedPO && (
          <Card className="border-primary/25 shadow-sm overflow-hidden">
            <CardHeader className="space-y-3 border-b bg-muted/30 pb-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-1">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <ClipboardList className="h-5 w-5 text-primary shrink-0" />
                    สรุปสถานะเติมโควต้า (Ops / HR)
                  </CardTitle>
                  <CardDescription className="text-xs max-w-3xl leading-relaxed">
                    มุมมองอ่านอย่างเดียว (ขั้นที่ 1) — รวมจาก PO Lines, Waves และ Mobilizations ที่ผูก PO นี้
                    เพื่อดูว่ายังต้องสร้าง Wave / มอบหมายคน / เตรียมส่งตัวหรือไม่ โดยไม่เปลี่ยน flow เดิมของระบบ
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={hasActiveSalesTerm ? 'default' : 'outline'} className="text-[10px]">
                    Sales Term: {hasActiveSalesTerm ? 'ACTIVE มี' : 'ยังไม่มี ACTIVE'}
                  </Badge>
                  <Badge variant={hasActiveLaborCostTerm ? 'default' : 'outline'} className="text-[10px]">
                    Labor cost: {hasActiveLaborCostTerm ? 'ACTIVE มี' : 'ยังไม่มี ACTIVE'}
                  </Badge>
                  {poReadyForOps && po.status !== 'closed' ? (
                    <Button variant="outline" size="sm" className="h-8 text-xs" asChild>
                      <Link href={`/waves?poId=${encodeURIComponent(id)}&newWave=1`}>+ Wave</Link>
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      disabled
                      title={po.status === 'closed' ? 'PO ปิดแล้ว — ใช้ PO ฉบับใหม่' : 'อนุมัติ PO ให้ Active ก่อน'}
                    >
                      + Wave
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="h-8 text-xs px-2" asChild>
                    <Link href={`/waves?poId=${encodeURIComponent(id)}`}>รายการ</Link>
                  </Button>
                  <Button variant="outline" size="sm" className="h-8 text-xs" asChild>
                    <Link href={`/assignments?poId=${encodeURIComponent(id)}`}>Assignments</Link>
                  </Button>
                  <Button variant="outline" size="sm" className="h-8 text-xs" asChild>
                    <Link href={`/mobilization?poId=${encodeURIComponent(id)}`}>Mobilization</Link>
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1">
                <StatCard
                  title="โควต้ารวม (active)"
                  value={fulfillmentTotals.required}
                  sub="จาก PO Lines"
                  icon={Users}
                  colorClass="border-l-blue-500"
                />
                <StatCard
                  title="มอบหมายแล้ว"
                  value={fulfillmentTotals.assigned}
                  sub="Mobilization ยังไม่ปิด"
                  icon={CheckCircle2}
                  colorClass="border-l-emerald-500"
                />
                <StatCard
                  title="ว่าง (slots)"
                  value={fulfillmentTotals.openSlots}
                  sub="ต้องหาคนเพิ่ม"
                  icon={AlertCircle}
                  colorClass="border-l-amber-500"
                />
                <StatCard
                  title="จำนวน Wave"
                  value={fulfillmentTotals.waveCount}
                  sub="เอกสาร waves"
                  icon={Briefcase}
                  colorClass="border-l-violet-500"
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-muted/20">
                  <TableRow>
                    <TableHead className="pl-6">ตำแหน่ง / บรรทัด</TableHead>
                    <TableHead>สถานที่ (บรรทัด)</TableHead>
                    <TableHead className="text-center">สถานะบรรทัด</TableHead>
                    <TableHead className="text-center">โควต้า</TableHead>
                    <TableHead className="text-center">มอบหมาย</TableHead>
                    <TableHead className="text-center">ว่าง</TableHead>
                    <TableHead className="text-center">Waves</TableHead>
                    <TableHead className="text-center pr-6">แผนใน Wave</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fulfillmentRows.length > 0 ? (
                    fulfillmentRows.map((row) => {
                      const pos = allPositions?.find((p) => p.id === row.positionId);
                      const posName = (pos?.positionName || pos?.positionNameTh) || row.positionId;
                      return (
                        <TableRow key={row.lineId}>
                          <TableCell className="pl-6 py-3 font-medium text-primary">{posName}</TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-[200px]">
                            {(row.workLocation || '').trim() || '—'}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className="text-[10px] uppercase">
                              {row.lineStatus}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center font-semibold">{row.requiredQty}</TableCell>
                          <TableCell className="text-center">{row.assignedCount}</TableCell>
                          <TableCell className="text-center">
                            {row.lineStatus === 'active' ? (
                              row.remainingSlots > 0 ? (
                                <Badge className="bg-amber-100 text-amber-800 border-amber-200">{row.remainingSlots}</Badge>
                              ) : (
                                <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">0</Badge>
                              )
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center">{row.waveCount}</TableCell>
                          <TableCell className="text-center pr-6 text-muted-foreground text-sm">
                            {row.plannedWorkersInWaves || 0}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-10 text-muted-foreground text-sm">
                        ยังไม่มี PO Line — เพิ่มจากแท็บ PO Lines (โควต้า)
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {isContractBasedPO && (
          <Card className="border-emerald-500/25 shadow-sm overflow-hidden">
            <CardHeader className="border-b bg-emerald-500/5 pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <ListOrdered className="h-5 w-5 text-emerald-700 shrink-0" />
                ลำดับเติมโควต้า (ขั้นที่ 3 — Orchestration)
              </CardTitle>
              <CardDescription className="text-xs max-w-3xl leading-relaxed">
                ใช้ flow เดิมของระบบ (สร้าง Wave → มอบหมาย → Mobilization) โดยลิงก์จาก PO นี้ — ไม่เปลี่ยนวิธีบันทึกใน Firestore
              </CardDescription>
              {staffingOrchestrationHint ? (
                <p className="text-sm font-medium text-emerald-900/90 pt-2 flex items-start gap-2">
                  <ArrowRight className="h-4 w-4 shrink-0 mt-0.5" />
                  {staffingOrchestrationHint}
                </p>
              ) : null}
            </CardHeader>
            <CardContent className="p-4 md:p-6">
              <ol className="grid grid-cols-1 md:grid-cols-3 gap-4 list-none">
                <li className="rounded-lg border bg-card p-4 space-y-3 shadow-sm">
                  <div className="flex items-center gap-2 text-emerald-800 font-bold text-sm">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-white text-xs">
                      1
                    </span>
                    สร้าง Wave
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    เปิดรอบงานและเลือก PO line ที่ยังมีโควต้า — ระบบจะเปิดฟอร์มสร้างเวฟให้พร้อมเลือก PO นี้
                  </p>
                  {poReadyForOps ? (
                    <Button className="w-full font-bold bg-emerald-700 hover:bg-emerald-800" asChild>
                      <Link href={`/waves?poId=${encodeURIComponent(id)}&newWave=1`}>
                        ไปสร้าง Wave <ChevronRight className="h-4 w-4 ml-1" />
                      </Link>
                    </Button>
                  ) : (
                    <Button className="w-full font-bold" disabled variant="secondary">
                      อนุมัติ PO ก่อนสร้าง Wave
                    </Button>
                  )}
                </li>
                <li className="rounded-lg border bg-card p-4 space-y-3 shadow-sm">
                  <div className="flex items-center gap-2 text-emerald-800 font-bold text-sm">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-white text-xs">
                      2
                    </span>
                    มอบหมายคนงาน
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    เลือก Wave ของ PO นี้แล้วผูกลูกจ้างที่ตำแหน่งและความพร้อมตรงตามเกณฑ์
                  </p>
                  <Button variant="outline" className="w-full font-bold border-emerald-600 text-emerald-800" asChild>
                    <Link href={`/assignments?poId=${encodeURIComponent(id)}`}>
                      ไป Assignments <ChevronRight className="h-4 w-4 ml-1" />
                    </Link>
                  </Button>
                </li>
                <li className="rounded-lg border bg-card p-4 space-y-3 shadow-sm">
                  <div className="flex items-center gap-2 text-emerald-800 font-bold text-sm">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-white text-xs">
                      3
                    </span>
                    เตรียมส่งตัว
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    ตรวจความพร้อมก่อนลงหน้างาน (Mobilization) ตาม mobilization ที่ผูก PO นี้
                  </p>
                  <Button variant="outline" className="w-full font-bold" asChild>
                    <Link href={`/mobilization?poId=${encodeURIComponent(id)}`}>
                      ไป Mobilization <ChevronRight className="h-4 w-4 ml-1" />
                    </Link>
                  </Button>
                </li>
              </ol>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue={isContractBasedPO ? 'lines' : 'info'} className="w-full">
          <TabsList
            className={`grid w-full max-w-[900px] h-auto p-1 bg-muted/50 ${isContractBasedPO ? 'grid-cols-3' : 'grid-cols-2'}`}
          >
            <TabsTrigger value="info" className="gap-2 py-2 px-6">
              ข้อมูลหัว PO
            </TabsTrigger>
            {isContractBasedPO && (
              <TabsTrigger value="lines" className="gap-2 py-2 px-6">
                PO Lines (โควต้า)
              </TabsTrigger>
            )}
            <TabsTrigger value="assignments" className="gap-2 py-2 px-6">
              {isContractBasedPO ? 'Assignments (คนงาน)' : 'วางบิล / เอกสาร'}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="mt-6">
            <Card>
              <CardHeader><CardTitle>รายละเอียด Customer PO (Header Info)</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label className="font-bold">หัวข้อ / ชื่อโครงการ</Label>
                    <Input disabled={!isEditing} value={isEditing ? (editedPO.title || '') : (po.title || '')} onChange={e => setEditedPO({...editedPO, title: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">เลขที่ Customer PO (PO Code)</Label>
                    <Input disabled={!isEditing} value={isEditing ? (editedPO.poCode || '') : (po.poCode || '')} onChange={e => setEditedPO({...editedPO, poCode: e.target.value})} />
                  </div>
                  {isContractBasedPO && (
                    <div className="space-y-2 md:col-span-2">
                      <Label className="font-bold">Service agreement No. (จากสัญญา / snapshot บน PO)</Label>
                      <Input
                        disabled
                        className="bg-muted font-mono"
                        value={displayServiceAgreementNo || '—'}
                      />
                      <p className="text-[11px] text-muted-foreground">
                        ค่าที่บันทึกบน PO ตอนสร้าง; ถ้า PO เก่าไม่มี snapshot จะแสดงจากสัญญาปัจจุบันเมื่อมี
                      </p>
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label className="font-bold">เลขที่เอกสาร PO ของลูกค้า (External Ref)</Label>
                    <Input
                      disabled={!isEditing}
                      value={isEditing ? (editedPO.customerPONumber || '') : (po.customerPONumber || '')}
                      onChange={e => setEditedPO({...editedPO, customerPONumber: e.target.value})}
                      placeholder="เช่น PO-CLIENT-2026-00123"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">วันที่ออก PO ของลูกค้า</Label>
                    {!isEditing && (po.customerPoIssueDate == null || Number(po.customerPoIssueDate) <= 0) ? (
                      <p className="text-sm text-muted-foreground py-2 border rounded-md px-3 bg-muted/30">ยังไม่ระบุ</p>
                    ) : (
                      <DatePickerThaiBE
                        disabled={!isEditing}
                        value={
                          isEditing
                            ? (editedPO.customerPoIssueDate ?? po.customerPoIssueDate ?? Date.now())
                            : (po.customerPoIssueDate as number)
                        }
                        onChange={(ms) => setEditedPO({ ...editedPO, customerPoIssueDate: ms })}
                      />
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">ชื่อโครงการเฉพาะทาง (Project Name)</Label>
                    <Input disabled={!isEditing} value={isEditing ? (editedPO.projectName || '') : (po.projectName || '')} onChange={e => setEditedPO({...editedPO, projectName: e.target.value})} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="font-bold">วันที่เริ่มงานตาม PO</Label>
                      <DatePickerThaiBE
                        disabled={!isEditing}
                        value={isEditing ? (editedPO.startDate ?? po.startDate) : po.startDate}
                        onChange={(ms) => setEditedPO({ ...editedPO, startDate: ms })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="font-bold">วันที่สิ้นสุดงานตาม PO</Label>
                      <DatePickerThaiBE
                        disabled={!isEditing}
                        value={isEditing ? (editedPO.endDate ?? po.endDate) : po.endDate}
                        onChange={(ms) => setEditedPO({ ...editedPO, endDate: ms })}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">สถานะใบสั่งซื้อ</Label>
                    <Select disabled={!isEditing} onValueChange={v => setEditedPO({...editedPO, status: v as PurchaseOrder['status']})} value={isEditing ? (editedPO.status || 'pending') : (po.status || 'pending')}>
                      <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">Pending</SelectItem>
                        {(po.status === 'active' || (isEditing && editedPO.status === 'active')) && (
                          <SelectItem value="active">Active</SelectItem>
                        )}
                        <SelectItem value="closed">Closed</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground">
                      เปลี่ยนเป็น <strong>Active</strong> ได้จากปุ่ม <strong>อนุมัติ PO</strong> (ผู้จัดการ/แอดมิน) — ไม่เลือก Active จากรายการนี้เมื่อยัง Pending
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="font-bold">หมายเหตุ</Label>
                  <Textarea disabled={!isEditing} value={isEditing ? (editedPO.notes || '') : (po.notes || '')} onChange={e => setEditedPO({...editedPO, notes: e.target.value})} />
                </div>
              </CardContent>
            </Card>

            {!isContractBasedPO && (
              <Card className="mt-6 border-primary/20 bg-primary/5">
                <CardHeader>
                  <CardTitle className="text-base">งานขายจากใบเสนอราคา (ไม่ใช้ PO Lines / Wave)</CardTitle>
                  <CardDescription>
                    รายการและราคาอ้างอิงจากใบเสนอราคา — อนุมัติ PO แล้วไปออกใบวางบิล / ใบกำกับภาษีได้เลย
                    ไม่ต้องเพิ่มแถวโควต้าตำแหน่งในระบบ PO Lines
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  {!!po.quotationId?.trim() && (
                    <Button variant="outline" asChild>
                      <Link href={`/quotations/${encodeURIComponent(po.quotationId)}`}>เปิดใบเสนอราคา</Link>
                    </Button>
                  )}
                  <Button variant="outline" asChild>
                    <Link href="/draft-invoices">รายการใบแจ้งหนี้ ( Invoice )</Link>
                  </Button>
                  <Button variant="outline" asChild>
                    <Link href="/tax-invoices">ใบกำกับภาษี</Link>
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {isContractBasedPO && (
          <TabsContent value="lines" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>รายการจองโควต้ากำลังคน (PO Lines)</CardTitle>
                  <CardDescription>กำหนดจำนวนคนงานรายตำแหน่งและบันทึกอัตราราคา Snapshot</CardDescription>
                  {!isLinkedSourceReady && (
                    <Badge variant="destructive" className="mt-2">
                      {isContractBasedPO
                        ? 'สัญญาหลักยังไม่ Active — ยังไม่ควรเพิ่ม PO Line / Wave'
                        : 'ใบเสนอราคายังไม่พร้อม — ต้องเป็นสถานะ sent หรือ accepted ก่อนเพิ่ม PO Line / Wave'}
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 justify-end shrink-0">
                <Dialog open={isAddLineOpen} onOpenChange={setIsAddLineOpen}>
                  <DialogTrigger asChild>
                    <Button className="gap-2 h-10 px-6 font-bold shadow-sm"><Plus className="h-4 w-4" /> เพิ่มรายการจองตำแหน่ง</Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>เพิ่มรายการจองกำลังคน</DialogTitle>
                      <DialogDescription>
                        {isContractBasedPO
                          ? 'เลือกตำแหน่งจากสัญญาหลักและระบุจำนวน (ราคาดึงจากสัญญา)'
                          : 'เลือกตำแหน่งและระบุจำนวน — ราคาขาย/ต้นทุนระบุตามที่ตกลงจากใบเสนอราคา'}
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid gap-2">
                        <Label className="font-bold">
                          {isContractBasedPO ? 'ตำแหน่งงาน (ที่ระบุในสัญญา)' : 'ตำแหน่งงาน'}
                        </Label>
                        <Select onValueChange={v => setNewLine({...newLine, positionId: v})} value={newLine.positionId || ''}>
                          <SelectTrigger className="h-11"><SelectValue placeholder="เลือกตำแหน่งงาน..." /></SelectTrigger>
                          <SelectContent>
                            {isContractBasedPO
                              ? ratesSortedForPoLine.map((r) => {
                                  const p = allPositions?.find((pos) => pos.id === r.positionId);
                                  return (
                                    <SelectItem key={r.id} value={r.positionId}>
                                      {(p?.positionName || p?.positionNameTh) || r.positionId}
                                    </SelectItem>
                                  );
                                })
                              : positionsSortedForPoLine.map((p) => (
                                  <SelectItem key={p.id} value={p.id}>
                                    {p.positionName || p.positionNameTh}
                                  </SelectItem>
                                ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {!isContractBasedPO && (
                        <div className="grid grid-cols-2 gap-4">
                          <div className="grid gap-2">
                            <Label className="font-bold text-xs">ราคาขาย</Label>
                            <Input type="number" value={Number(newLine.sellRateSnapshot ?? 0)} onChange={e => setNewLine({...newLine, sellRateSnapshot: Number(e.target.value)})} />
                          </div>
                          <div className="grid gap-2">
                            <Label className="font-bold text-xs">ต้นทุน</Label>
                            <Input type="number" value={Number(newLine.costBaselineSnapshot ?? 0)} onChange={e => setNewLine({...newLine, costBaselineSnapshot: Number(e.target.value)})} />
                          </div>
                        </div>
                      )}
                      <div className="grid gap-2">
                        <Label className="font-bold">จำนวนคนงานที่ต้องการ (Quantity)</Label>
                        <Input type="number" min="1" value={Number(newLine.quantity ?? 1)} onChange={e => setNewLine({...newLine, quantity: Number(e.target.value) || 1})} className="h-11" />
                      </div>
                      <div className="grid gap-2">
                        <Label className="font-bold">สถานที่ปฏิบัติงาน (Work location)</Label>
                        <Input
                          placeholder="เช่น BD3-F1 / Erawan Platform — แยกต่อบรรทัดถ้าลูกค้าระบุหลาย site"
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
                      <Button variant="outline" onClick={() => setIsAddLineOpen(false)}>ยกเลิก</Button>
                      <Button
                        onClick={handleAddLine}
                        disabled={
                          isAddingLine
                          || !newLine.positionId
                          || !newLine.quantity
                          || !isLinkedSourceReady
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
                  </DialogContent>
                </Dialog>

                <Dialog
                  open={isEditLineOpen}
                  onOpenChange={(o) => {
                    setIsEditLineOpen(o);
                    if (!o) setEditLineDraft(null);
                  }}
                >
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>แก้ไขบรรทัด PO</DialogTitle>
                      <DialogDescription>แก้จำนวน สถานที่ วันที่ และสถานะบรรทัด</DialogDescription>
                    </DialogHeader>
                    {editLineDraft && (
                      <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                          <Label className="font-bold">จำนวน (Quantity)</Label>
                          <Input
                            type="number"
                            min={1}
                            value={editLineDraft.quantity}
                            onChange={(e) =>
                              setEditLineDraft({ ...editLineDraft, quantity: Math.max(1, Number(e.target.value) || 1) })
                            }
                            className="h-11"
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label className="font-bold">สถานที่ปฏิบัติงาน</Label>
                          <Input
                            value={editLineDraft.workLocation || ''}
                            onChange={(e) => setEditLineDraft({ ...editLineDraft, workLocation: e.target.value })}
                            className="h-11"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="grid gap-2">
                            <Label className="text-xs font-bold">วันเริ่ม (บรรทัด)</Label>
                            <DatePickerThaiBE
                              value={editLineDraft.startDate}
                              onChange={(ms) => setEditLineDraft({ ...editLineDraft, startDate: ms })}
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label className="text-xs font-bold">วันสิ้นสุด (บรรทัด)</Label>
                            <DatePickerThaiBE
                              value={editLineDraft.endDate}
                              onChange={(ms) => setEditLineDraft({ ...editLineDraft, endDate: ms })}
                            />
                          </div>
                        </div>
                        <div className="grid gap-2">
                          <Label className="font-bold">สถานะบรรทัด</Label>
                          <Select
                            value={editLineDraft.status}
                            onValueChange={(v) =>
                              setEditLineDraft({ ...editLineDraft, status: v as POLine['status'] })
                            }
                          >
                            <SelectTrigger className="h-11">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="active">Active</SelectItem>
                              <SelectItem value="cancelled">Cancelled</SelectItem>
                              <SelectItem value="completed">Completed</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setIsEditLineOpen(false);
                          setEditLineDraft(null);
                        }}
                      >
                        ยกเลิก
                      </Button>
                      <Button
                        className="bg-primary font-bold"
                        onClick={() => void handleSaveEditedLine()}
                        disabled={isSavingLine || !editLineDraft}
                      >
                        {isSavingLine ? <Loader2 className="h-4 w-4 animate-spin mr-2 inline" /> : null}
                        บันทึก
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                </div>
              </CardHeader>
              <CardContent className="p-0 border-t">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead className="pl-6">ตำแหน่งงาน (Position)</TableHead>
                      <TableHead>สถานที่ (Location)</TableHead>
                      <TableHead className="text-center">โควต้า (Req)</TableHead>
                      <TableHead className="text-center">มอบหมายแล้ว (Asgn)</TableHead>
                      <TableHead className="text-center">คงเหลือ (Slots)</TableHead>
                      <TableHead className="text-right">ราคาขาย (Snapshot)</TableHead>
                      <TableHead className="text-right pr-6">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {poLines?.map(line => {
                      const pos = allPositions?.find(p => p.id === line.positionId);
                      const assignedCount = poAssignments.filter(
                        (a) => a.poLineId === line.id && assignmentCountsTowardQuota(a.deploymentStatus)
                      ).length;
                      const remaining = line.quantity - assignedCount;
                      
                      return (
                        <TableRow key={line.id} className="hover:bg-muted/10 transition-colors">
                          <TableCell className="pl-6 py-4">
                            <div className="flex flex-col">
                              <span className="font-bold text-primary">{(pos?.positionName || pos?.positionNameTh) || line.positionId}</span>
                              <span className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                                <Calendar className="h-2.5 w-2.5" />
                                {formatDateRangeThaiBE(line.startDate, line.endDate)}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-[220px]">
                            {(line.workLocation || '').trim() || '—'}
                          </TableCell>
                          <TableCell className="text-center font-black">{line.quantity}</TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 px-3">
                              {assignedCount} คน
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            {remaining > 0 ? (
                              <Badge className="bg-amber-100 text-amber-700 border-amber-200 px-3">
                                {remaining} ว่าง
                              </Badge>
                            ) : (
                              <Badge className="bg-green-100 text-green-700 border-green-200 px-3">
                                <CheckCircle2 className="h-3 w-3 mr-1" /> เต็ม
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex flex-col items-end">
                              <span className="text-green-700 font-bold">฿{line.sellRateSnapshot.toLocaleString()}</span>
                              <span className="text-[10px] text-muted-foreground uppercase font-black italic">per {line.billingUnitSnapshot}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right pr-6">
                            <div className="flex justify-end gap-1">
                              {canEditPo && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  title="แก้ไขบรรทัด"
                                  onClick={() => {
                                    setEditLineDraft({ ...line });
                                    setIsEditLineOpen(true);
                                  }}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              )}
                              {(canEditPo || canDeletePo) && (
                                <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => deleteLine(line.id)}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {!poLines?.length && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-20 text-muted-foreground italic">ยังไม่มีรายการสั่งจองในใบสั่งซื้อนี้</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
          )}

          <TabsContent value="assignments" className="mt-6">
            {!isContractBasedPO ? (
              <Card className="border-dashed border-2 border-muted">
                <CardHeader>
                  <CardTitle>ไม่ใช้มอบหมายคนงาน / Wave</CardTitle>
                  <CardDescription>
                    PO จากใบเสนอราคาในที่นี้หมายถึงขายสินค้าหรือบริการครั้งเดียวจบ (ไม่ผูก payroll / ไม่เปิด Wave)
                    หลังส่งมอบตาม PO ให้ไปที่ใบวางบิล → ใบกำกับภาษี → รับเงิน
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Button variant="outline" asChild>
                    <Link href="/draft-invoices">รายการใบแจ้งหนี้ ( Invoice )</Link>
                  </Button>
                  <Button variant="outline" asChild>
                    <Link href="/tax-invoices">ใบกำกับภาษี</Link>
                  </Button>
                </CardContent>
              </Card>
            ) : (
            <Card>
              <CardHeader className="border-b bg-muted/5">
                <CardTitle>รายชื่อคนงานที่ได้รับมอบหมาย (Project Assignments)</CardTitle>
                <CardDescription>คนงานทั้งหมดที่ทำงานภายใต้ใบสั่งซื้อโครงการนี้</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead className="pl-6">คนงาน (Worker)</TableHead>
                      <TableHead>ตำแหน่ง (Position)</TableHead>
                      <TableHead>ช่วงเวลาทำงาน (Project Period)</TableHead>
                      <TableHead>สถานะ (Deployment)</TableHead>
                      <TableHead className="text-right pr-6">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {poAssignments.length > 0 ? (
                      poAssignments.map(asgn => {
                        const worker = allWorkers?.find(w => w.id === asgn.workerId);
                        const pos = allPositions?.find(p => p.id === asgn.positionId);
                        return (
                          <TableRow key={asgn.id} className="hover:bg-muted/10 transition-colors">
                            <TableCell className="pl-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-black text-xs">
                                  {worker?.firstName.charAt(0)}
                                </div>
                                <div className="flex flex-col">
                                  <span className="font-bold text-sm text-primary">{worker ? `${worker.firstName} ${worker.lastName}` : 'Unknown'}</span>
                                  <span className="text-[10px] text-muted-foreground font-mono">{worker?.thaiNationalId}</span>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-[10px] font-bold bg-white">{(pos?.positionName || pos?.positionNameTh) || asgn.positionId}</Badge>
                            </TableCell>
                            <TableCell className="text-xs font-medium">
                              {formatStoredDateRangeThaiBE(asgn.startDate, asgn.endDate)}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="capitalize text-[10px] font-black uppercase tracking-tighter">{asgn.deploymentStatus}</Badge>
                            </TableCell>
                            <TableCell className="text-right pr-6">
                              <Button variant="ghost" size="sm" className="font-bold h-8 group" asChild>
                                <Link href={`/mobilization/${asgn.id}`}>Manage Pre-Mob <ChevronRight className="h-3 w-3 ml-1 group-hover:translate-x-1 transition-all" /></Link>
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    ) : (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-16 text-muted-foreground">
                          <div className="max-w-xl mx-auto space-y-3 text-sm not-italic">
                            <p>
                              ยังไม่มีการมอบหมายคนงานใน PO นี้ การมอบหมายในระบบอ้างอิง <span className="font-semibold text-foreground">Wave</span> ที่ผูกกับ PO Line ของ PO นี้
                              ไม่ได้เพิ่มคนเข้า PO Line โดยตรงจากแท็บนี้
                            </p>
                            <p className="text-xs">
                              (1) สร้างหรือเลือก Wave โดยระบุ PO และ PO Line ที่ตรงกัน (2) ไปที่การมอบหมาย เลือก Wave แล้วมอบหมายคนงาน
                            </p>
                            <div className="flex flex-wrap justify-center gap-2 pt-1">
                              <Button variant="outline" size="sm" asChild>
                                <Link href={`/waves?poId=${encodeURIComponent(id)}`}>Waves (เวฟ)</Link>
                              </Button>
                              <Button variant="outline" size="sm" asChild>
                                <Link href={`/assignments?poId=${encodeURIComponent(id)}`}>Assignments (การมอบหมาย)</Link>
                              </Button>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function StatCard({ title, value, sub, icon: Icon, colorClass }: any) {
  return (
    <Card className={`hover:shadow-md transition-all border-l-8 ${colorClass} shadow-sm`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 opacity-50 text-primary" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-black text-primary truncate">{value}</div>
        <p className="text-[10px] font-medium text-muted-foreground mt-1 uppercase tracking-tighter">{sub}</p>
      </CardContent>
    </Card>
  );
}
