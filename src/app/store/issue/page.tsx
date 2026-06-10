'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import {
  ArrowLeft,
  Search,
  Plus,
  Trash2,
  CheckCircle2,
  Info,
  Loader2,
  PackageMinus,
  Inbox,
  FileText,
  PackageOpen,
} from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccessDomain } from '@/lib/permission-core';
import { collection, doc, query, where, getDoc, increment, writeBatch } from 'firebase/firestore';
import {
  StoreItem,
  Worker,
  Assignment,
  Position,
  OfficeStaff,
  formatStoreItemLabel,
} from '@/lib/types';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { Input } from '@/components/ui/input';
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue } from '@/lib/date-thai';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { generateNextDocumentCode } from '@/lib/services/numbering-service';
import {
  MOBILIZATION_FULFILLMENT_SUBCOLLECTION,
  MOBILIZATION_STATUSES_NOT_CLOSED,
  isMobilizationInStoreFulfillmentScope,
  nextStatusAfterIssue,
  syncWorkerStoreEquipmentReadinessToFirestore,
} from '@/lib/store/mobilization-fulfillment';
import type { FieldQuotaPendingLine } from '@/lib/store/field-quota-pending-lines';
import {
  loadFieldQuotaMobContext,
  resolveFieldLineStoreItem,
} from '@/lib/store/field-quota-pending-lines';
import { FieldQuotaIssueCard } from '@/components/store/field-quota-issue-card';
import type { MobilizationRequirementFulfillmentLine } from '@/lib/types';
import { storeCatalogPickableItems } from '@/lib/store/receive-stock-select';
import { filterActiveOfficeStaffForSelection } from '@/lib/hr/office-staff-active';
import { isActiveWorkerForSelection } from '@/lib/hr/worker-active';

type QueuePendingLine = FieldQuotaPendingLine;

type QueueCard = {
  assignment: Assignment;
  worker?: Worker;
  position?: Position;
  pendingLines: QueuePendingLine[];
};

export default function IssueItemsPage() {
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const canAccess = canAccessDomain(currentUser, 'store');

  const [issueDate, setIssueDate] = useState(() => timestampToHtmlDateValue(Date.now()));
  const [notes, setNotes] = useState('');
  const [issueList, setIssueList] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [issueMode, setIssueMode] = useState<'field' | 'office'>('field');
  const [selectedOfficeStaffId, setSelectedOfficeStaffId] = useState('');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [fieldQueue, setFieldQueue] = useState<QueueCard[]>([]);
  const [fieldQueueLoading, setFieldQueueLoading] = useState(false);
  const [fieldLineQty, setFieldLineQty] = useState<Record<string, string>>({});
  /** เลือก SKU จริงเมื่อโควต้าเป็นกลุ่ม (หลายไซส์) — key = assignmentId__lineDocId */
  const [fieldLineSkuId, setFieldLineSkuId] = useState<Record<string, string>>({});
  const [fieldActionKey, setFieldActionKey] = useState<string | null>(null);
  const [queueRefreshTick, setQueueRefreshTick] = useState(0);
  const [topUpMobId, setTopUpMobId] = useState('');
  const [topUpCard, setTopUpCard] = useState<QueueCard | null>(null);
  const [topUpLoading, setTopUpLoading] = useState(false);

  // STRICT ENFORCEMENT: Only workers from 'workers' collection (Field Labor)
  const workersQuery = useMemoFirebase(() => {
    if (!firestore || !canAccess) return null;
    return collection(firestore, 'workers');
  }, [firestore, canAccess]);
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  const allMobsQuery = useMemoFirebase(() => {
    if (!firestore || !canAccess) return null;
    return query(
      collection(firestore, 'mobilizations'),
      where('deploymentStatus', 'in', [...MOBILIZATION_STATUSES_NOT_CLOSED]),
    );
  }, [firestore, canAccess]);
  const { data: allMobilizations } = useCollection<Assignment>(allMobsQuery as any);

  const itemsQuery = useMemoFirebase(() => (firestore && canAccess ? collection(firestore, 'store_items') : null), [firestore, canAccess]);
  const { data: storeItems } = useCollection<StoreItem>(itemsQuery as any);

  const officeStaffQuery = useMemoFirebase(() => {
    if (!firestore || !canAccess) return null;
    return collection(firestore, 'office_staff');
  }, [firestore, canAccess]);
  const { data: officeStaffList } = useCollection<OfficeStaff>(officeStaffQuery as any);

  useEffect(() => {
    let cancelled = false;
    async function buildQueue() {
      if (!firestore || !canAccess || issueMode !== 'field') {
        setFieldQueue([]);
        setFieldQueueLoading(false);
        return;
      }
      const list = storeItems || [];
      const workers = allWorkers || [];
      setFieldQueueLoading(true);
      const cards: QueueCard[] = [];
      const scoped = (allMobilizations || []).filter((m) => isMobilizationInStoreFulfillmentScope(m));

      for (const m of scoped) {
        const ctx = await loadFieldQuotaMobContext(firestore, m, list);
        if (ctx.pendingLines.length === 0) continue;
        const w = workers.find((x) => x.id === m.workerId);
        cards.push({
          assignment: m,
          worker: w,
          position: ctx.position,
          pendingLines: ctx.pendingLines,
        });
      }

      if (!cancelled) {
        setFieldQueue(cards);
        setFieldQueueLoading(false);
      }
    }
    buildQueue();
    return () => {
      cancelled = true;
    };
  }, [firestore, canAccess, issueMode, allMobilizations, storeItems, allWorkers, queueRefreshTick]);

  const scopedMobilizations = useMemo(
    () => (allMobilizations || []).filter((m) => isMobilizationInStoreFulfillmentScope(m)),
    [allMobilizations],
  );

  const topUpMobilizationOptions = useMemo(() => {
    const workers = allWorkers || [];
    return scopedMobilizations.filter((m) => {
      const w = workers.find((x) => x.id === m.workerId);
      return w != null && isActiveWorkerForSelection(w);
    });
  }, [scopedMobilizations, allWorkers]);

  useEffect(() => {
    let cancelled = false;
    async function loadTopUp() {
      if (!firestore || !canAccess || issueMode !== 'field' || !topUpMobId) {
        setTopUpCard(null);
        setTopUpLoading(false);
        return;
      }
      const mob = scopedMobilizations.find((m) => m.id === topUpMobId);
      if (!mob) {
        setTopUpCard(null);
        setTopUpLoading(false);
        return;
      }
      setTopUpLoading(true);
      try {
        const ctx = await loadFieldQuotaMobContext(firestore, mob, storeItems || [], { mode: 'topup' });
        const worker = (allWorkers || []).find((w) => w.id === mob.workerId);
        if (!cancelled) {
          setTopUpCard({
            assignment: mob,
            worker,
            position: ctx.position,
            pendingLines: ctx.pendingLines,
          });
        }
      } finally {
        if (!cancelled) setTopUpLoading(false);
      }
    }
    void loadTopUp();
    return () => {
      cancelled = true;
    };
  }, [firestore, canAccess, issueMode, topUpMobId, scopedMobilizations, storeItems, allWorkers, queueRefreshTick]);

  const onIssueModeChange = (v: string) => {
    const next = v as 'field' | 'office';
    setIssueMode(next);
    setIssueList([]);
    setFieldLineSkuId({});
    setCatalogSearch('');
    setTopUpMobId('');
    setTopUpCard(null);
    if (next === 'office') {
      /* field queue reloads via effect */
    } else {
      setSelectedOfficeStaffId('');
    }
  };

  const filteredOfficeCatalog = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    const list = storeCatalogPickableItems(storeItems ?? []);
    if (!q) return list;
    return list.filter((i) => {
      const label = formatStoreItemLabel(i).toLowerCase();
      return (
        label.includes(q) ||
        (i.itemName || '').toLowerCase().includes(q) ||
        (i.itemCode || '').toLowerCase().includes(q) ||
        (i.variantSpecification || '').toLowerCase().includes(q) ||
        (i.variantGroupKey || '').toLowerCase().includes(q)
      );
    });
  }, [storeItems, catalogSearch]);

  const handleAddToList = (item: StoreItem) => {
    if (issueMode !== 'office') {
      toast({
        variant: 'destructive',
        title: 'โหมดลูกจ้างหน้างาน',
        description: 'ใช้รายการรอเบิกด้านบน — ระบบดึงจากงานที่มอบหมายและตำแหน่งโดยอัตโนมัติ',
      });
      return;
    }
    if (item.currentStock <= 0) {
      toast({
        variant: 'destructive',
        title: 'สินค้าหมด (Out of Stock)',
        description: 'ไม่สามารถเบิกได้เนื่องจากสต็อกคงเหลือเป็นศูนย์',
      });
      return;
    }
    const existing = issueList.find((i) => i.itemId === item.id);
    if (existing) {
      setIssueList(
        issueList.map((i) =>
          i.itemId === item.id ? { ...i, quantity: Math.min(i.quantity + 1, item.currentStock) } : i,
        ),
      );
      return;
    }
    setIssueList([
      ...issueList,
      {
        itemId: item.id,
        itemCode: item.itemCode,
        itemName: item.itemName,
        displayLabel: formatStoreItemLabel(item),
        quantity: 1,
        unit: item.unit,
        remarks: '',
      },
    ]);
  };

  const fieldLineInputKey = (asgnId: string, lineDocId: string) => `${asgnId}__${lineDocId}`;

  const handleFieldLineWaive = async (asgn: Assignment, line: QueuePendingLine) => {
    if (!firestore || !currentUser) return;
    const k = fieldLineInputKey(asgn.id, line.lineDocId);
    setFieldActionKey(k);
    try {
      const lineRef = doc(
        firestore,
        'mobilizations',
        asgn.id,
        MOBILIZATION_FULFILLMENT_SUBCOLLECTION,
        line.lineDocId,
      );
      const prevSnap = await getDoc(lineRef);
      const prev = prevSnap.exists() ? (prevSnap.data() as MobilizationRequirementFulfillmentLine) : undefined;
      const keepIssued = Number(prev?.quantityIssued ?? line.quantityIssued ?? 0);
      const batch = writeBatch(firestore);
      batch.set(
        lineRef,
        {
          id: line.lineDocId,
          kind: line.kind,
          positionRequirementId: line.req.id,
          quantityRequired: line.quantityRequired,
          quantityIssued: keepIssued,
          status: 'WAIVED',
          waivedAt: Date.now(),
          waivedBy: currentUser.displayName,
          updatedAt: Date.now(),
          updatedBy: currentUser.displayName,
        } satisfies Partial<MobilizationRequirementFulfillmentLine>,
        { merge: true },
      );
      await batch.commit();
      void syncWorkerStoreEquipmentReadinessToFirestore(firestore, asgn.workerId).catch((err) =>
        console.error('syncWorkerStoreEquipmentReadinessToFirestore', err),
      );
      toast({ title: 'บันทึกแล้ว', description: 'ทำเครื่องหมายว่าไม่ประสงค์เบิก / มีของส่วนตัว' });
      setQueueRefreshTick((t) => t + 1);
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'Error', description: 'บันทึกไม่สำเร็จ' });
    } finally {
      setFieldActionKey(null);
    }
  };

  const handleFieldLineIssue = async (asgn: Assignment, line: QueuePendingLine) => {
    if (!firestore || !currentUser) return;
    const key = fieldLineInputKey(asgn.id, line.lineDocId);
    const item = resolveFieldLineStoreItem(line, key, fieldLineSkuId);
    if (!item) {
      toast({
        variant: 'destructive',
        title: 'ไม่พบรายการในคลัง',
        description: 'เพิ่มการจับคู่ store item ที่ตำแหน่งงาน (PPE/อุปกรณ์) หรือเพิ่ม SKU ที่ตรงกลุ่ม/รหัส',
      });
      return;
    }
    const raw = Number(fieldLineQty[key] ?? line.quantityRequired - line.quantityIssued);
    const qtyWant = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
    const remaining = line.quantityRequired - line.quantityIssued;
    if (qtyWant < 1) {
      toast({ variant: 'destructive', title: 'จำนวนไม่ถูกต้อง', description: 'กรอกจำนวนที่ต้องการเบิก' });
      return;
    }
    const qty = Math.min(qtyWant, remaining, item.currentStock);
    if (qty < 1) {
      toast({
        variant: 'destructive',
        title: 'เบิกไม่ได้',
        description: item.currentStock < 1 ? 'สต็อกไม่พอ' : 'ครบจำนวนที่กำหนดแล้ว',
      });
      return;
    }

    setFieldActionKey(key);
    try {
      const lineRef = doc(
        firestore,
        'mobilizations',
        asgn.id,
        MOBILIZATION_FULFILLMENT_SUBCOLLECTION,
        line.lineDocId,
      );
      const lineSnap = await getDoc(lineRef);
      const prev = lineSnap.exists() ? (lineSnap.data() as MobilizationRequirementFulfillmentLine) : undefined;
      const prevIssued = Number(prev?.quantityIssued || 0);
      const nextIssued = prevIssued + qty;
      const newStatus = nextStatusAfterIssue(line.quantityRequired, prevIssued, qty);

      const { code: finalNo } = await generateNextDocumentCode(firestore, 'store_issue', {
        actor: currentUser.displayName,
      });

      const batch = writeBatch(firestore);
      const issueSlipsRef = collection(firestore, 'store_issue_slips');
      const newIssueRef = doc(issueSlipsRef);

      batch.set(newIssueRef, {
        id: newIssueRef.id,
        issueNo: finalNo,
        issueDate,
        status: 'completed',
        notes,
        createdAt: Date.now(),
        createdBy: currentUser.displayName,
        issueType: 'field',
        workerId: asgn.workerId,
        assignmentId: asgn.id,
        waveId: asgn.waveId,
        positionId: asgn.positionId,
      });

      const itemsSubRef = collection(newIssueRef, 'items');
      const itemDocRef = doc(itemsSubRef);
      batch.set(itemDocRef, {
        itemId: item.id,
        itemName: item.itemName,
        quantity: qty,
        unit: item.unit,
        remarks: notes || '',
      });

      batch.update(doc(firestore, 'store_items', item.id), { currentStock: increment(-qty) });

      const txRef = doc(collection(firestore, 'store_transactions'));
      batch.set(txRef, {
        itemId: item.id,
        transactionType: 'ISSUE',
        quantity: qty,
        transactionDate: issueDate,
        notes: `Ref Slip: ${finalNo}. ${notes || ''}`,
        createdAt: Date.now(),
        createdBy: currentUser.displayName,
        issueType: 'field',
        workerId: asgn.workerId,
        assignmentId: asgn.id,
        waveId: asgn.waveId,
      });

      batch.set(
        lineRef,
        {
          id: line.lineDocId,
          kind: line.kind,
          positionRequirementId: line.req.id,
          quantityRequired: line.quantityRequired,
          quantityIssued: nextIssued,
          status: newStatus,
          storeItemId: item.id,
          lastIssueSlipId: newIssueRef.id,
          lastIssueNo: finalNo,
          waivedAt: null,
          waivedBy: null,
          updatedAt: Date.now(),
          updatedBy: currentUser.displayName,
        } satisfies Partial<MobilizationRequirementFulfillmentLine>,
        { merge: true },
      );

      await batch.commit();
      void syncWorkerStoreEquipmentReadinessToFirestore(firestore, asgn.workerId).catch((err) =>
        console.error('syncWorkerStoreEquipmentReadinessToFirestore', err),
      );
      toast({ title: 'เบิกสำเร็จ', description: `เลขที่ใบเบิก ${finalNo} · ${formatStoreItemLabel(item)} × ${qty}` });
      setFieldLineQty((prev) => ({ ...prev, [key]: String(Math.max(0, remaining - qty)) }));
      setQueueRefreshTick((t) => t + 1);
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'Error', description: 'ไม่สามารถบันทึกการเบิกได้' });
    } finally {
      setFieldActionKey(null);
    }
  };

  const handleConfirmIssue = async () => {
    if (issueMode !== 'office') {
      toast({
        variant: 'destructive',
        title: 'โหมดลูกจ้างหน้างาน',
        description: 'ใช้ปุ่มเบิกในแต่ละแถวของรายการรอเบิก',
      });
      return;
    }
    if (!firestore || !currentUser || issueList.length === 0) {
      toast({
        variant: 'destructive',
        title: 'ข้อมูลไม่ครบ',
        description: 'กรุณาเลือกผู้รับและรายการที่ต้องการเบิก',
      });
      return;
    }
    if (!selectedOfficeStaffId) {
      toast({
        variant: 'destructive',
        title: 'ข้อมูลไม่ครบ',
        description: 'กรุณาเลือกพนักงานออฟฟิศผู้รับเครื่องมือ',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const { code: finalNo } = await generateNextDocumentCode(firestore, 'store_issue', {
        actor: currentUser.displayName,
      });

      const batch = writeBatch(firestore);
      const issueSlipsRef = collection(firestore, 'store_issue_slips');
      const newIssueRef = doc(issueSlipsRef);

      const staff = officeStaffList?.find((s) => s.id === selectedOfficeStaffId);

      batch.set(newIssueRef, {
        id: newIssueRef.id,
        issueNo: finalNo,
        issueDate,
        status: 'completed',
        notes,
        createdAt: Date.now(),
        createdBy: currentUser.displayName,
        issueType: 'office',
        officeStaffId: selectedOfficeStaffId,
        officeStaffName: staff?.fullName || '',
        workerId: '',
        assignmentId: '',
        waveId: '',
        positionId: '',
      });

      const itemsSubRef = collection(newIssueRef, 'items');
      for (const item of issueList) {
        const itemDocRef = doc(itemsSubRef);
        batch.set(itemDocRef, {
          itemId: item.itemId,
          itemName: item.itemName,
          quantity: item.quantity,
          unit: item.unit,
          remarks: item.remarks,
        });

        const masterItemRef = doc(firestore, 'store_items', item.itemId);
        batch.update(masterItemRef, { currentStock: increment(-item.quantity) });

        const txRef = doc(collection(firestore, 'store_transactions'));
        batch.set(txRef, {
          itemId: item.itemId,
          transactionType: 'ISSUE',
          quantity: item.quantity,
          transactionDate: issueDate,
          notes: `Ref Slip: ${finalNo}. ${item.remarks || ''}`,
          createdAt: Date.now(),
          createdBy: currentUser.displayName,
          issueType: 'office',
          officeStaffId: selectedOfficeStaffId,
          workerId: '',
          assignmentId: '',
          waveId: '',
        });
      }

      await batch.commit();

      toast({ title: 'บันทึกการเบิกสำเร็จ', description: `เลขที่ใบเบิก: ${finalNo}` });
      router.push('/store');
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'Error', description: 'ไม่สามารถบันทึกรายการได้' });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (userLoading || isUserLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground text-sm">
        กำลังตรวจสอบสิทธิ์…
      </div>
    );
  }
  if (!currentUser || !canAccess) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-[1600px] mx-auto space-y-6">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" className="shrink-0 mt-1" asChild>
            <Link href="/store"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
              <PackageMinus className="h-8 w-8 text-orange-600 shrink-0" /> เบิกอุปกรณ์ / เครื่องมือ (Issue from Store)
            </h1>
          </div>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="shrink-0 gap-2 mt-1">
                <Info className="h-4 w-4" />
                นโยบายการเบิกจ่าย
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>นโยบายการเบิกจ่ายพัสดุ</DialogTitle>
                <DialogDescription asChild>
                  <div className="space-y-3 pt-2 text-sm text-foreground">
                    {issueMode === 'field' ? (
                      <p className="text-muted-foreground">
                        ลูกจ้างหน้างานต้องเบิกตามรายการที่กำหนดในตำแหน่ง (PPE/เครื่องมือ) และไม่เกินโควต้า ·
                        ใช้「เบิกเพิ่มตามโควต้า」เมื่อเคยเบิกบางส่วนแล้ว · ไม่มีรายการในโควต้า = เบิกไม่ได้ ·
                        แก้จำนวน/รายการที่เมนูตำแหน่งงาน → PPE / อุปกรณ์
                      </p>
                    ) : (
                      <p className="text-muted-foreground">
                        พนักงานออฟฟิศสามารถเบิกยืมเครื่องมือ/อุปกรณ์ได้จากแคตตาล็อกทั้งหมด
                        โดยไม่ต้องอ้างอิงลิสต์ตามตำแหน่งงาน
                      </p>
                    )}
                  </div>
                </DialogDescription>
              </DialogHeader>
            </DialogContent>
          </Dialog>
        </div>

        <Tabs value={issueMode} onValueChange={onIssueModeChange} className="w-full">
          <TabsList className="grid w-full max-w-lg grid-cols-2 h-auto p-1">
            <TabsTrigger value="field" className="py-3">ลูกจ้างหน้างาน (Field)</TabsTrigger>
            <TabsTrigger value="office" className="py-3">พนักงานออฟฟิศ (Office)</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* LEFT: Context & Catalog */}
          <div className="lg:col-span-2 space-y-6">
            {issueMode === 'field' && (
              <div className="space-y-4">
                <Card className="shadow-md">
                  <CardHeader className="border-b bg-muted/20">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Inbox className="h-5 w-5 text-primary" /> รายการรอเบิก (ตามงานที่มอบหมาย)
                    </CardTitle>
                    <CardDescription>
                      แยกตามคนงานและ mobilization — เมื่อเบิกครบหรือกดไม่ประสงค์เบิกครบทุกบรรทัด คนงานจะหลุดจากรายการนี้
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-6 space-y-6">
                    {fieldQueueLoading ? (
                      <div className="flex items-center gap-2 text-muted-foreground text-sm">
                        <Loader2 className="h-4 w-4 animate-spin" /> กำลังประกอบรายการ…
                      </div>
                    ) : fieldQueue.length === 0 ? (
                      <div className="py-12 text-center border border-dashed rounded-lg bg-muted/20">
                        <PackageOpen className="h-10 w-10 mx-auto text-muted-foreground/40 mb-2" />
                        <p className="text-sm text-muted-foreground font-medium">ไม่มีรายการรอเบิก</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          ไม่มี mobilization ที่มอบหมายแล้ว (Waiting MOB ขึ้นไป) หรือครบทุกรายการ PPE/เครื่องมือแล้ว
                        </p>
                      </div>
                    ) : (
                      fieldQueue.map((card) => (
                        <FieldQuotaIssueCard
                          key={card.assignment.id}
                          card={card}
                          lineKey={fieldLineInputKey}
                          fieldLineQty={fieldLineQty}
                          setFieldLineQty={setFieldLineQty}
                          fieldLineSkuId={fieldLineSkuId}
                          setFieldLineSkuId={setFieldLineSkuId}
                          fieldActionKey={fieldActionKey}
                          onIssue={handleFieldLineIssue}
                          onWaive={handleFieldLineWaive}
                        />
                      ))
                    )}
                  </CardContent>
                </Card>

                <Card className="shadow-md border-orange-200/60">
                  <CardHeader className="border-b bg-orange-50/50 dark:bg-orange-950/20">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Plus className="h-5 w-5 text-orange-600" /> เบิกเพิ่มตามโควต้า
                    </CardTitle>
                    <CardDescription>
                      เลือกลูกจ้างและงาน (mobilization) — แสดงรายการในโควต้าที่ยังเบิกไม่ครบ
                      รวมรายการที่เคยกด「ไม่ประสงค์เบิก」 — ไม่มีรายการ = เบิกเพิ่มไม่ได้
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-6 space-y-4">
                    <div className="space-y-2">
                      <Label className="font-bold">ลูกจ้าง / งานที่มอบหมาย</Label>
                      <Select value={topUpMobId || undefined} onValueChange={setTopUpMobId}>
                        <SelectTrigger className="h-11">
                          <SelectValue placeholder="เลือก mobilization…" />
                        </SelectTrigger>
                        <SelectContent>
                          {topUpMobilizationOptions.map((m) => {
                            const w = (allWorkers || []).find((x) => x.id === m.workerId);
                            const workerLabel = w
                              ? `${w.firstName} ${w.lastName} (${w.workerCode})`
                              : m.workerId;
                            return (
                              <SelectItem key={m.id} value={m.id}>
                                {workerLabel} · {m.assignmentNo} · {m.projectName}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                    {topUpLoading ? (
                      <div className="flex items-center gap-2 text-muted-foreground text-sm">
                        <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดโควต้า…
                      </div>
                    ) : topUpMobId && topUpCard && topUpCard.pendingLines.length > 0 ? (
                      <FieldQuotaIssueCard
                        card={topUpCard}
                        lineKey={fieldLineInputKey}
                        fieldLineQty={fieldLineQty}
                        setFieldLineQty={setFieldLineQty}
                        fieldLineSkuId={fieldLineSkuId}
                        setFieldLineSkuId={setFieldLineSkuId}
                        fieldActionKey={fieldActionKey}
                        onIssue={handleFieldLineIssue}
                        onWaive={handleFieldLineWaive}
                        showWaiveButton={false}
                      />
                    ) : topUpMobId ? (
                      <div className="py-10 text-center border border-dashed rounded-lg bg-muted/20">
                        <p className="text-sm font-medium text-muted-foreground">ไม่มีรายการในโควต้าที่เบิกเพิ่มได้</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          ครบโควต้าทุกรายการแล้ว หรือไม่มี PPE/อุปกรณ์ในตำแหน่งงาน — ต้องแก้ที่เมนูตำแหน่งก่อน
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        เลือก mobilization เพื่อดูรายการที่ยังเบิกไม่ครบ (รวมกรณีเคยเบิกบางส่วนแล้ว)
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {issueMode === 'office' && (
              <Card className="shadow-md">
                <CardHeader className="border-b bg-muted/20">
                  <CardTitle className="text-lg">พนักงานออฟฟิศผู้รับ (Office Staff)</CardTitle>
                  <CardDescription>
                    เลือกพนักงานแล้วเพิ่มรายการจากแคตตาล็อก (เฉพาะรุ่นย่อย/รายการเดี่ยว — ไม่แสดงเมนหลักที่มีรุ่นย่อย)
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-6 space-y-4">
                  <div className="space-y-2">
                    <Label className="font-bold">เลือกพนักงาน</Label>
                    <Select value={selectedOfficeStaffId} onValueChange={setSelectedOfficeStaffId}>
                      <SelectTrigger className="h-11">
                        <SelectValue placeholder="เลือกพนักงานออฟฟิศ..." />
                      </SelectTrigger>
                      <SelectContent>
                        {filterActiveOfficeStaffForSelection(officeStaffList).map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.fullName} ({s.staffCode})
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="ค้นหาอุปกรณ์..."
                      className="pl-9 h-11"
                      value={catalogSearch}
                      onChange={(e) => setCatalogSearch(e.target.value)}
                    />
                  </div>
                  <div className="max-h-[400px] overflow-y-auto border rounded-md">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="font-bold">รหัส</TableHead>
                          <TableHead className="font-bold">ชื่อ</TableHead>
                          <TableHead className="text-center">คงเหลือ</TableHead>
                          <TableHead className="text-right pr-4">จัดการ</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredOfficeCatalog.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell className="font-mono text-xs">{item.itemCode}</TableCell>
                            <TableCell>{formatStoreItemLabel(item)}</TableCell>
                            <TableCell className="text-center">{item.currentStock}</TableCell>
                            <TableCell className="text-right pr-4">
                              <Button
                                size="sm"
                                disabled={item.currentStock <= 0}
                                onClick={() => handleAddToList(item)}
                              >
                                <Plus className="h-3 w-3 mr-1" /> เพิ่ม
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                        {filteredOfficeCatalog.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                              ไม่พบรายการ — ลองคำค้นหาหรือเพิ่มที่ทะเบียนคลัง
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* RIGHT: office issue list / field defaults */}
          <div className="space-y-6">
            {issueMode === 'field' ? (
              <Card className="border-primary/20 shadow-lg">
                <CardHeader className="bg-muted/40 border-b">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Info className="h-5 w-5" /> ค่าเริ่มต้นใบเบิก (ลูกจ้างหน้างาน)
                  </CardTitle>
                  <CardDescription>
                    แต่ละครั้งที่กด &quot;เบิก&quot; ระบบสร้างใบเบิกแยก 1 รายการ — ใช้วันที่และหมายเหตุด้านล่างร่วมกัน
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-6 space-y-4">
                  <div className="space-y-2">
                    <Label className="font-bold text-xs uppercase text-muted-foreground">วันที่เบิก (Issue Date)</Label>
                    <DatePickerThaiBE
                      className="h-11"
                      value={htmlDateValueToTimestampMs(issueDate)}
                      onChange={(ms) => setIssueDate(timestampToHtmlDateValue(ms))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold text-xs uppercase text-muted-foreground">หมายเหตุใบเบิก (Notes)</Label>
                    <Input
                      placeholder="เช่น เบิกตามงาน…"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="h-11"
                    />
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="border-primary/20 shadow-xl overflow-hidden">
                <CardHeader className="bg-primary text-primary-foreground pb-6">
                  <CardTitle className="text-xl flex items-center gap-3">
                    <FileText className="h-6 w-6" /> รายการเบิกของ (Issue List)
                  </CardTitle>
                  <CardDescription className="text-primary-foreground/70">
                    ตรวจสอบรายการและยืนยันการตัดสต็อก
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-6 space-y-4">
                  {issueList.length === 0 ? (
                    <div className="py-20 text-center space-y-4 bg-muted/10 rounded-lg border-2 border-dashed border-muted">
                      <PackageOpen className="h-12 w-12 mx-auto text-muted-foreground/30" />
                      <p className="text-sm text-muted-foreground">ยังไม่มีรายการที่เลือก</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {issueList.map((item, idx) => (
                        <div key={item.itemId} className="p-3 border rounded-lg bg-card shadow-sm group">
                          <div className="flex justify-between items-start mb-2">
                            <p className="text-xs font-black text-primary truncate flex-1">
                              {item.displayLabel || item.itemName}
                            </p>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => setIssueList(issueList.filter((_, i) => i !== idx))}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <Label className="text-[10px] uppercase font-bold text-muted-foreground">จำนวน (Qty)</Label>
                              <Input
                                type="number"
                                className="h-8 text-xs font-bold"
                                value={item.quantity}
                                onChange={(e) => {
                                  const newList = [...issueList];
                                  newList[idx].quantity = Math.max(1, parseInt(e.target.value, 10) || 1);
                                  setIssueList(newList);
                                }}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px] uppercase font-bold text-muted-foreground">หน่วย (Unit)</Label>
                              <Input disabled className="h-8 text-[10px] bg-muted/50" value={item.unit} />
                            </div>
                          </div>
                          <div className="mt-2 space-y-1">
                            <Label className="text-[10px] uppercase font-bold text-muted-foreground">หมายเหตุรายการ</Label>
                            <Input
                              placeholder="ระบุเพิ่มเติม..."
                              className="h-7 text-[10px]"
                              value={item.remarks}
                              onChange={(e) => {
                                const newList = [...issueList];
                                newList[idx].remarks = e.target.value;
                                setIssueList(newList);
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="pt-4 space-y-4 border-t">
                    <div className="space-y-2">
                      <Label className="font-bold text-xs uppercase text-muted-foreground">วันที่เบิก (Issue Date)</Label>
                      <DatePickerThaiBE
                        className="h-11"
                        value={htmlDateValueToTimestampMs(issueDate)}
                        onChange={(ms) => setIssueDate(timestampToHtmlDateValue(ms))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="font-bold text-xs uppercase text-muted-foreground">หมายเหตุใบเบิก (Notes)</Label>
                      <Input
                        placeholder="เช่น เบิกไปใช้หน้างาน..."
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        className="h-11"
                      />
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="bg-muted/30 border-t pt-6 flex flex-col gap-3">
                  <Button
                    className="w-full h-14 font-black text-lg bg-primary shadow-lg"
                    disabled={issueList.length === 0 || isSubmitting || !selectedOfficeStaffId}
                    onClick={handleConfirmIssue}
                  >
                    {isSubmitting ? (
                      <Loader2 className="h-6 w-6 animate-spin mr-2" />
                    ) : (
                      <CheckCircle2 className="h-6 w-6 mr-2" />
                    )}
                    ยืนยันการเบิก (Finalize Issue)
                  </Button>
                  <p className="text-[10px] text-center text-muted-foreground uppercase font-bold tracking-widest">
                    บันทึกโดย: {currentUser.displayName}
                  </p>
                </CardFooter>
              </Card>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}