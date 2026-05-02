
'use client';

import { useState, use, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import {
  formatDateThaiBE,
  formatYmdLocalThaiBE,
  formatStoredDateRangeThaiBE,
} from '@/lib/date-thai';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Trash2,
  Save,
  ArrowLeft,
  FileText,
  Building2,
  Calendar,
  CheckCircle2,
  History,
  Info,
  Loader2,
  ChevronRight,
} from 'lucide-react';
import { useFirestore, useDoc, useCollection, useMemoFirebase } from '@/firebase';
import { doc, collection, query, where, updateDoc, getDocs, writeBatch } from 'firebase/firestore';
import { updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { 
  PurchaseOrder, 
  POLine, 
  Customer, 
  MainContract, 
  Position, 
  User,
  Assignment, 
  Worker,
  Quotation,
  Wave,
  JobMode,
} from '@/lib/types';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { Textarea } from '@/components/ui/textarea';
import { writeAuditLog } from '@/lib/services/audit-service';
import { useAppUser } from '@/hooks/use-app-user';
import { canView, canEdit, canDelete, isSystemAdmin, canApprovePurchaseAsManager } from '@/lib/permissions';
import {
  aggregateActiveLineTotals,
  buildPoFulfillmentByLine,
} from '@/lib/ops/po-fulfillment-read-model';
import {
  normalizePoActiveBundleId,
  rebuildAllPoActiveBundlesForCustomer,
} from '@/lib/ops/po-active-bundle';

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

  const positionsQuery = useMemoFirebase(() => (firestore && canViewPo ? collection(firestore, 'positions') : null), [firestore, canViewPo]);
  const { data: allPositions } = useCollection<Position>(positionsQuery as any);

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

  const [isEditing, setIsEditing] = useState(false);
  const [editedPO, setEditedPO] = useState<Partial<PurchaseOrder>>({});

  const [isApprovingPo, setIsApprovingPo] = useState(false);
  const [isClosingPo, setIsClosingPo] = useState(false);
  const [isDeletingPoDoc, setIsDeletingPoDoc] = useState(false);
  useEffect(() => {
    if (po) setEditedPO({ ...po, poWorkMode: po.poWorkMode ?? 'OFFSHORE' });
  }, [po]);

  const isContractBasedPO = (po?.poType || 'contract') === 'contract';

  const handleSaveMaster = async () => {
    if (!canEditPo) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์แก้ไข Customer PO' });
      return;
    }
    if (!poRef || !currentUser || !po || !firestore) return;
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

    try {
      await rebuildAllPoActiveBundlesForCustomer(firestore, po.customerId);
    } catch (e) {
      console.warn(e);
    }

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
      await updateDoc(poRef, {
        status: 'active',
        poWorkMode: po.poWorkMode ?? 'OFFSHORE',
        updatedAt: Date.now(),
      });
      writeAuditLog(firestore, currentUser, {
        actionType: 'UPDATE',
        entityType: 'PurchaseOrder',
        entityId: id,
        entityLabel: po.poCode,
        changedFields: ['status', 'poWorkMode'],
        sourceModule: 'commercial',
        purchaseOrderId: id,
        afterSummary: 'Approved PO → active',
      });
      try {
        await rebuildAllPoActiveBundlesForCustomer(firestore, po.customerId);
      } catch (e) {
        console.warn(e);
      }
      toast({
        title: 'อนุมัติ PO แล้ว',
        description:
          po.poType === 'quotation'
            ? 'สถานะ Active — ออกใบวางบิล / ใบกำกับภาษีได้ (ไม่มี Wave / Timesheet)'
            : 'สถานะ Active — มอบหมายจาก PO / PO Active ได้ (ไม่บังคับ Wave)',
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
      if (fulfillmentTotals.assigned > 0) {
        toast({
          variant: 'destructive',
          title: 'ยังปิด PO ไม่ได้',
          description: `ยังมี ${fulfillmentTotals.assigned} รายมอบหมาย (Mobilization) ที่นับในบรรทัด PO — จบงาน/ปิด assignment หรือ demobilize ก่อน`,
        });
        return;
      }
      if (!confirm('ปิด PO นี้ถาวร?\n\nจะไม่มอบหมายเพิ่มใน PO เดิม — งานใหม่ต้องใช้ PO ฉบับใหม่')) return;
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
          ? 'Closed PO — staffing closed on this document'
          : 'Closed quotation-based PO — billing path only',
      });
      try {
        await rebuildAllPoActiveBundlesForCustomer(firestore, po.customerId);
      } catch (e) {
        console.warn(e);
      }
      toast({
        title: 'ปิด PO แล้ว',
        description: isContractBasedPO
          ? 'ไม่สามารถมอบหมายเพิ่มใน PO นี้'
          : 'จบงานขาย — ไม่มี Wave/Timesheet ผูก PO นี้',
      });
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'ปิด PO ไม่สำเร็จ' });
    } finally {
      setIsClosingPo(false);
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
                {isContractBasedPO && (
                  <Badge variant="outline" className="text-[10px] font-semibold">
                    PO Active: {(po.poWorkMode ?? 'OFFSHORE') === 'ONSHORE' ? 'Onshore' : 'Offshore'}
                  </Badge>
                )}
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
            <Button
              variant="outline"
              onClick={() => {
                setEditedPO(po ? { ...po, poWorkMode: po.poWorkMode ?? 'OFFSHORE' } : {});
                setIsEditing(!isEditing);
              }}
            >
              {isEditing ? 'ยกเลิก' : 'แก้ไขข้อมูล'}
            </Button>
            {isEditing && (
              <Button className="gap-2 bg-primary font-bold shadow-md h-10 px-6" onClick={handleSaveMaster}>
                <Save className="h-4 w-4" /> บันทึกการเปลี่ยนแปลง
              </Button>
            )}
            {isContractBasedPO && po.status === 'active' && canEditPo && (
              <Button
                variant="outline"
                className="h-10 border-amber-600 text-amber-900"
                disabled={isClosingPo || fulfillmentTotals.assigned > 0}
                title={
                  fulfillmentTotals.assigned > 0
                    ? `ยังมี ${fulfillmentTotals.assigned} รายมอบหมายนับในบรรทัด PO — ปิด Mobilization ก่อน`
                    : undefined
                }
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

        {isContractBasedPO && po.status === 'active' && po.poActiveBundleId && (
          <Card className="border-primary/25 bg-primary/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">เอกสาร PO Active</CardTitle>
              <CardDescription className="text-xs max-w-3xl">
                กลุ่ม PO ตามลูกค้าและโหมด Onshore/Offshore — เพิ่ม แก้ไข และลบบรรทัดโควต้า ดูยอดรวมหลายใบ และมอบหมายได้จากเอกสารนี้ (ไม่ต้องสร้าง Wave)
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2 pt-0">
              <Button size="sm" asChild>
                <Link
                  href={`/po-active/${encodeURIComponent(normalizePoActiveBundleId(po.poActiveBundleId))}`}
                >
                  เปิด PO Active
                </Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href={`/assignments?poId=${encodeURIComponent(id)}&openDialog=1`}>มอบหมาย PO นี้</Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href="/po-active-quota-queue">คิวเติมโควต้า</Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href={`/mobilization?poId=${encodeURIComponent(id)}`}>Mobilization</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {isContractBasedPO && po.status === 'active' && !po.poActiveBundleId && (
          <Card className="border-amber-200 bg-amber-50/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">ยังไม่ผูก PO Active bundle</CardTitle>
              <CardDescription className="text-xs">
                ใบนี้ยังไม่ผูกเอกสาร PO Active bundle — ลองบันทึกหัว PO หรือรีเฟรชหน้า / เปิดรายการ PO Active เพื่อให้ระบบซิงก์กลุ่มหลังอนุมัติ
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" asChild>
                <Link href="/po-active">รายการ PO Active</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="space-y-10">
          <section className="space-y-4">
            <h2 className="text-lg font-semibold tracking-tight border-b pb-2">ข้อมูลหัว PO</h2>
            <div>
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
                  {isContractBasedPO && (
                    <div className="space-y-2 md:col-span-2">
                      <Label className="font-bold">โหมดงาน PO (Onshore / Offshore)</Label>
                      <Select
                        disabled={!isEditing}
                        value={(isEditing ? editedPO.poWorkMode : po.poWorkMode) ?? 'OFFSHORE'}
                        onValueChange={(v) => setEditedPO({ ...editedPO, poWorkMode: v as JobMode })}
                      >
                        <SelectTrigger className="h-10">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="OFFSHORE">Offshore (ค่าเริ่มต้น — รวม PO เก่า)</SelectItem>
                          <SelectItem value="ONSHORE">Onshore</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">
                        ใช้จัดกลุ่มเอกสาร PO Active ต่อลูกค้า — แยกจาก Onshore/Offshore
                      </p>
                    </div>
                  )}
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
            </div>
          </section>

          {isContractBasedPO && po.status === 'pending' && (
            <section className="space-y-4">
              <Card className="border-dashed border-muted">
                <CardHeader>
                  <CardTitle className="text-base">บรรทัดโควต้า (จัดการที่ PO Active)</CardTitle>
                  <CardDescription>
                    หลังอนุมัติ PO เป็น Active และสัญญาหลักพร้อม — เพิ่ม แก้ไข และลบบรรทัดตำแหน่งได้จากเอกสาร PO Active ของลูกค้า (รวมหลายใบ PO ตามโหมด Onshore/Offshore) หน้านี้เหลือหัว PO และตารางมอบหมายด้านล่าง
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2 pt-0">
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/po-active">รายการ PO Active</Link>
                  </Button>
                </CardContent>
              </Card>
            </section>
          )}

          <section className="space-y-4">
            <h2 className="text-lg font-semibold tracking-tight border-b pb-2">
              {isContractBasedPO ? 'Assignments (คนงาน)' : 'วางบิล / เอกสาร'}
            </h2>
            <div>
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
                              ยังไม่มีการมอบหมายคนงานใน PO นี้ — ใช้ปุ่ม Assign / เอกสาร{' '}
                              <Link className="text-primary underline font-medium" href="/po-active">PO Active</Link>{' '}
                              หรือ{' '}
                              <Link className="text-primary underline font-medium" href="/po-active-quota-queue">คิวเติมโควต้า</Link>{' '}
                              (ไม่ต้องสร้าง Wave)
                            </p>
                            <div className="flex flex-wrap justify-center gap-2 pt-1">
                              <Button variant="outline" size="sm" asChild>
                                <Link href={`/assignments?poId=${encodeURIComponent(id)}&openDialog=1`}>เปิด Assign</Link>
                              </Button>
                              <Button variant="outline" size="sm" asChild>
                                <Link href="/po-active">เอกสาร PO Active</Link>
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
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
