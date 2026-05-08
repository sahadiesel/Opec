'use client';

import { useState, use, useEffect, useMemo, useCallback } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Plus,
  Trash2,
  Save,
  FileText,
  HardHat,
  Hammer,
  ArrowLeft,
  Sparkles,
  Loader2,
  Briefcase,
  Activity,
  Info,
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
import { doc, collection, getCountFromServer, query, where, deleteField } from 'firebase/firestore';
import { updateDocumentNonBlocking, addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import {
  Position,
  PositionCertificateRequirement,
  PositionPPERequirement,
  PositionToolRequirement,
  User,
  WorkerDocumentCatalogItem,
  StoreItem,
  storeItemIsPpeCatalog,
  formatStoreItemLabel,
  MainContract,
  Customer,
} from '@/lib/types';

import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { generatePositionRequirements } from '@/ai/flows/generate-position-requirements';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import { positionDetailHeadline, type PositionDoc } from '@/lib/position-display';
import { useAppUser } from '@/hooks/use-app-user';
import { canView, canEdit, canDelete } from '@/lib/permissions';
import { canViewWorkerLaborCostFromUser, canEditWorkerLaborCostFromUser } from '@/lib/payroll/labor-cost-model';
import { LaborCostPositionSection } from '@/components/hr/labor-cost-position-section';
import { LaborCostByContractSection } from '@/components/hr/labor-cost-by-contract-section';
import { mergeLaborCostRowsWithMainContracts } from '@/lib/payroll/position-labor-cost-contract-rows';

function isStoreVariantLine(item: StoreItem): boolean {
  return item.catalogGroupRole === 'line';
}

/** ตำแหน่งงานเลือกได้เฉพาะเมนหรือรายการเดี่ยว — ไม่เลือกรุ่นย่อยที่นี่ */
function formatPositionCatalogPickLabel(si: StoreItem): string {
  if (si.catalogGroupRole === 'header') {
    return `${si.itemCode} · ${(si.itemName || '').trim() || '—'}`;
  }
  return `${si.itemCode} — ${formatStoreItemLabel(si)}`;
}

function normalizePositionPayrollBasis(raw: unknown): Position['payrollBasis'] {
  const u = String(raw ?? 'DAILY').toUpperCase();
  if (u === 'MONTHLY') return 'MONTHLY';
  if (u === 'HOURLY') return 'HOURLY';
  if (u === 'DAILY') return 'DAILY';
  return 'DAILY';
}

export default function PositionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const canViewPositions = useMemo(() => canView(currentUser, 'positions'), [currentUser]);
  const canEditPositions = useMemo(() => canEdit(currentUser, 'positions'), [currentUser]);
  const canDeletePositions = useMemo(() => canDelete(currentUser, 'positions'), [currentUser]);
  const canViewLabor = useMemo(() => canViewWorkerLaborCostFromUser(currentUser), [currentUser]);
  const canEditLabor = useMemo(
    () => canEditWorkerLaborCostFromUser(currentUser) && canEditPositions,
    [currentUser, canEditPositions],
  );

  const posRef = useMemoFirebase(
    () => (firestore && canViewPositions ? doc(firestore, 'positions', id) : null),
    [firestore, id, canViewPositions]
  );
  const { data: position, isLoading: isPosLoading } = useDoc<Position>(posRef as any);

  const mainContractsQuery = useMemoFirebase(
    () => (firestore && canViewPositions ? collection(firestore, 'main_contracts') : null),
    [firestore, canViewPositions],
  );
  const { data: allMainContracts } = useCollection<MainContract>(mainContractsQuery as any);

  const customersQuery = useMemoFirebase(
    () => (firestore && canViewPositions ? collection(firestore, 'customers') : null),
    [firestore, canViewPositions],
  );
  const { data: allCustomers } = useCollection<Customer>(customersQuery as any);

  const customerNameById = useMemo(() => {
    const m = new Map<string, string>();
    (allCustomers ?? []).forEach((c) => m.set(c.id, c.name || c.id));
    return m;
  }, [allCustomers]);

  const [isEditing, setIsEditing] = useState(false);
  const [editedPos, setEditedPos] = useState<Partial<Position>>({});

  const laborCostByContractRows = useMemo(
    () =>
      mergeLaborCostRowsWithMainContracts(
        isEditing
          ? (editedPos.laborCostByContract ?? position?.laborCostByContract)
          : position?.laborCostByContract,
        allMainContracts ?? [],
      ),
    [isEditing, editedPos.laborCostByContract, position?.laborCostByContract, allMainContracts],
  );

  const certsQuery = useMemoFirebase(() => (firestore && canViewPositions ? collection(firestore, 'positions', id, 'certificate_requirements') : null), [firestore, id, canViewPositions]);
  const { data: certs } = useCollection<PositionCertificateRequirement>(certsQuery as any);

  const ppeQuery = useMemoFirebase(() => (firestore && canViewPositions ? collection(firestore, 'positions', id, 'ppe_requirements') : null), [firestore, id, canViewPositions]);
  const { data: ppe } = useCollection<PositionPPERequirement>(ppeQuery as any);

  const toolsQuery = useMemoFirebase(() => (firestore && canViewPositions ? collection(firestore, 'positions', id, 'tool_requirements') : null), [firestore, id, canViewPositions]);
  const { data: tools } = useCollection<PositionToolRequirement>(toolsQuery as any);
  const storeItemsQuery = useMemoFirebase(() => (firestore && canViewPositions ? collection(firestore, 'store_items') : null), [firestore, canViewPositions]);
  const { data: storeItems } = useCollection<StoreItem>(storeItemsQuery as any);
  const workerDocCatalogQuery = useMemoFirebase(() => (firestore && canViewPositions ? collection(firestore, 'worker_document_catalog') : null), [firestore, canViewPositions]);
  const { data: workerDocCatalog } = useCollection<WorkerDocumentCatalogItem>(workerDocCatalogQuery as any);

  const [isAddCertOpen, setIsAddCertOpen] = useState(false);
  const [isAddPPEOpen, setIsAddPPEOpen] = useState(false);
  const [isAddToolOpen, setIsAddToolOpen] = useState(false);

  const [newCert, setNewCert] = useState<Partial<PositionCertificateRequirement>>({
    required: true,
    requirementType: 'certificate',
    hasExpiry: true,
  });
  const [newPPE, setNewPPE] = useState<Partial<PositionPPERequirement>>({ required: true, quantityDefault: 1 });
  const [newTool, setNewTool] = useState<Partial<PositionToolRequirement>>({ allowed: true, quantityDefault: 1, itemType: 'tool' });

  /** PPE: เมน + รายการเดี่ยว — ไม่รวมรุ่นย่อย (เบิกไซส์ที่หน้าเบิก) */
  const ppeMainCatalogPickList = useMemo(() => {
    if (!storeItems?.length) return [];
    return storeItems
      .filter((i) => storeItemIsPpeCatalog(i) && i.active !== false && !isStoreVariantLine(i))
      .sort((a, b) => (a.itemName || '').localeCompare(b.itemName || '', 'th'));
  }, [storeItems]);

  const toolMainCatalogPickList = useMemo(() => {
    if (!storeItems?.length) return [];
    return storeItems
      .filter((i) => !storeItemIsPpeCatalog(i) && i.active !== false && !isStoreVariantLine(i))
      .sort((a, b) => (a.itemName || '').localeCompare(b.itemName || '', 'th'));
  }, [storeItems]);

  const resetAddToolDialog = useCallback(() => {
    setNewTool({ allowed: true, quantityDefault: 1, itemType: 'tool' });
  }, []);

  const [isGenerating, setIsGenerating] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('master');
  const [laborSaveDialogOpen, setLaborSaveDialogOpen] = useState(false);
  const [laborWorkerCount, setLaborWorkerCount] = useState<number | null>(null);
  const [laborCountLoading, setLaborCountLoading] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'master' || t === 'certs' || t === 'ppe' || t === 'tools') {
      setActiveTab(t);
    }
  }, []);
  const selectedCatalogItem = useMemo(
    () => (workerDocCatalog || []).find((x) => x.id === (newCert.templateId || '')),
    [workerDocCatalog, newCert.templateId]
  );

  const nMoney = (v: number | undefined) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));

  const nextLaborOn = useMemo(() => {
    if (editedPos.defaultLaborCostOnshore !== undefined) return editedPos.defaultLaborCostOnshore;
    return position?.defaultLaborCostOnshore;
  }, [editedPos.defaultLaborCostOnshore, position?.defaultLaborCostOnshore]);

  const nextLaborOff = useMemo(() => {
    if (editedPos.defaultLaborCostOffshore !== undefined) return editedPos.defaultLaborCostOffshore;
    return position?.defaultLaborCostOffshore;
  }, [editedPos.defaultLaborCostOffshore, position?.defaultLaborCostOffshore]);

  const displayLaborOn = isEditing ? nextLaborOn : position?.defaultLaborCostOnshore;
  const displayLaborOff = isEditing ? nextLaborOff : position?.defaultLaborCostOffshore;

  const displayPayrollBasis = useMemo(() => {
    const raw = isEditing ? editedPos.payrollBasis ?? position?.payrollBasis : position?.payrollBasis;
    return normalizePositionPayrollBasis(raw);
  }, [isEditing, editedPos.payrollBasis, position?.payrollBasis]);

  const isMonthlyPayrollBasis = displayPayrollBasis === 'MONTHLY';

  const showHourlyPayrollBasisOption = useMemo(() => {
    const p = position?.payrollBasis;
    const e = editedPos.payrollBasis;
    return p === 'HOURLY' || e === 'HOURLY';
  }, [position?.payrollBasis, editedPos.payrollBasis]);

  const laborDefaultsChanged = useMemo(() => {
    if (!position) return false;
    if (displayPayrollBasis === 'MONTHLY') return false;
    return (
      nMoney(nextLaborOn) !== nMoney(position.defaultLaborCostOnshore) ||
      nMoney(nextLaborOff) !== nMoney(position.defaultLaborCostOffshore)
    );
  }, [position, nextLaborOn, nextLaborOff, displayPayrollBasis]);

  const commitPositionSave = useCallback(() => {
    if (!posRef || !position) return;
    const payrollBasis = normalizePositionPayrollBasis(editedPos.payrollBasis ?? position.payrollBasis);
    const base: Record<string, unknown> = {
      ...editedPos,
      positionCode: position.positionCode,
      payrollBasis,
      updatedAt: Date.now(),
    };
    if (payrollBasis === 'MONTHLY') {
      base.defaultLaborCostOnshore = deleteField();
      base.defaultLaborCostOffshore = deleteField();
      base.laborCostByContract = [];
    } else if (!canViewLabor) {
      delete base.defaultLaborCostOnshore;
      delete base.defaultLaborCostOffshore;
      delete base.laborCostByContract;
    } else if (canEditLabor) {
      base.laborCostByContract = mergeLaborCostRowsWithMainContracts(
        editedPos.laborCostByContract ?? position.laborCostByContract,
        allMainContracts ?? [],
      );
    }
    updateDocumentNonBlocking(posRef, base);
    setIsEditing(false);
    setLaborSaveDialogOpen(false);
    setLaborWorkerCount(null);
    toast({ title: 'บันทึกสำเร็จ', description: 'ข้อมูลหลักของตำแหน่งงานถูกอัปเดตแล้ว' });
  }, [posRef, position, editedPos, canViewLabor, canEditLabor, toast, allMainContracts]);

  const handleSaveMaster = useCallback(async () => {
    if (!canEditPositions) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์แก้ไขตำแหน่งงาน' });
      return;
    }
    if (!posRef || !position) return;
    if (canViewLabor && canEditLabor && laborDefaultsChanged) {
      setLaborCountLoading(true);
      setLaborSaveDialogOpen(true);
      setLaborWorkerCount(null);
      try {
        if (!firestore) throw new Error('no firestore');
        const cq = await getCountFromServer(
          query(collection(firestore, 'workers'), where('currentPositionId', '==', id)),
        );
        setLaborWorkerCount(cq.data().count);
      } catch {
        setLaborWorkerCount(null);
      } finally {
        setLaborCountLoading(false);
      }
      return;
    }
    commitPositionSave();
  }, [canEditPositions, posRef, position, canViewLabor, canEditLabor, laborDefaultsChanged, firestore, id, commitPositionSave, toast]);

  const confirmLaborSave = useCallback(() => {
    commitPositionSave();
  }, [commitPositionSave]);

  const handleAddCert = () => {
    if (!canEditPositions) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์แก้ไขข้อมูลตำแหน่งงาน' });
      return;
    }
    if (!certsQuery) return;
    if (!selectedCatalogItem) {
      toast({ variant: 'destructive', title: 'ยังไม่ได้เลือกเอกสารกลาง', description: 'กรุณาเลือกรายการจากเมนูรายการเอกสารกลางก่อนบันทึก' });
      return;
    }
    addDocumentNonBlocking(certsQuery, {
      templateId: selectedCatalogItem.id,
      requirementType: selectedCatalogItem.requirementType || 'certificate',
      certificateName: selectedCatalogItem.itemName || '',
      certificateCode: selectedCatalogItem.itemCode || '',
      required: newCert.required ?? true,
      validityMonths: selectedCatalogItem.hasExpiry ? Number(selectedCatalogItem.defaultValidityMonths || 0) : 0,
      hasExpiry: selectedCatalogItem.hasExpiry ?? true,
      notes: newCert.notes || ''
    });
    setIsAddCertOpen(false);
    setNewCert({ required: true, requirementType: 'certificate', hasExpiry: true });
  };

  const handleAddPPE = () => {
    if (!canEditPositions) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์แก้ไขข้อมูลตำแหน่งงาน' });
      return;
    }
    if (!ppeQuery || !newPPE.storeItemId) {
      toast({
        variant: 'destructive',
        title: 'ยังไม่ได้เลือกรายการ',
        description: 'เลือก PPE จากทะเบียนคลัง (หน้า ทะเบียน PPE)',
      });
      return;
    }
    const si = storeItems?.find((s) => s.id === newPPE.storeItemId);
    if (!si) {
      toast({ variant: 'destructive', title: 'ไม่พบรายการ', description: 'รีเฟรชหน้าแล้วลองใหม่' });
      return;
    }
    const gk =
      (si.variantGroupKey || '').trim() ||
      (si.catalogGroupRole === 'header' ? (si.itemCode || '').trim() : '');
    if (gk) {
      if (ppe?.some((p) => (p.variantGroupKey || '').trim() === gk)) {
        toast({ variant: 'destructive', title: 'รายการซ้ำ', description: 'ตำแหน่งนี้มีโควต้ากลุ่มเดียวกันแล้ว (ใช้รหัสกลุ่มเดียวกัน)' });
        return;
      }
    } else if (ppe?.some((p) => p.storeItemId === si.id)) {
      toast({ variant: 'destructive', title: 'รายการซ้ำ', description: 'ตำแหน่งนี้มี SKU นี้ในลิสต์แล้ว' });
      return;
    }
    const ppeSpec = (si.variantSpecification || '').trim();
    addDocumentNonBlocking(ppeQuery, {
      storeItemId: si.id,
      storeCategory: si.category ?? '',
      itemName: si.itemName ?? '',
      itemCode: si.itemCode ?? '',
      quantityDefault: newPPE.quantityDefault ?? 1,
      required: newPPE.required ?? true,
      notes: newPPE.notes || '',
      ...(gk ? { variantGroupKey: gk } : {}),
      // กลุ่มโควต้า: เก็บแค่ชื่อหลัก — ไม่ผูกไซส์ในตำแหน่ง; เบิกเลือกไซส์ที่หน้าคลัง
      ...(!gk && ppeSpec ? { variantSpecification: ppeSpec } : {}),
    });
    setIsAddPPEOpen(false);
    setNewPPE({ required: true, quantityDefault: 1, storeItemId: undefined });
  };

  const storeItemToToolItemType = (si: StoreItem): PositionToolRequirement['itemType'] => {
    if (si.isTool) return 'tool';
    if (si.isPPE) return 'equipment';
    return 'consumable';
  };

  const handleAddTool = () => {
    if (!canEditPositions) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์แก้ไขข้อมูลตำแหน่งงาน' });
      return;
    }
    if (!toolsQuery || !newTool.storeItemId) {
      toast({
        variant: 'destructive',
        title: 'ยังไม่ได้เลือกอุปกรณ์',
        description: 'เลือกรายการจากทะเบียนอุปกรณ์ (ชื่อหลัก / เมน — ไม่ใช่รุ่นย่อย)',
      });
      return;
    }
    const si = storeItems?.find((s) => s.id === newTool.storeItemId);
    if (!si) {
      toast({ variant: 'destructive', title: 'ไม่พบรายการ', description: 'รีเฟรชหน้าแล้วลองใหม่' });
      return;
    }
    const newGk =
      (si.variantGroupKey || '').trim() ||
      (si.catalogGroupRole === 'header' ? (si.itemCode || '').trim() : '');
    if (
      tools?.some((t) => {
        if (t.storeItemId === newTool.storeItemId) return true;
        const tg = (t.variantGroupKey || '').trim();
        return Boolean(newGk && tg && tg === newGk);
      })
    ) {
      toast({ variant: 'destructive', title: 'รายการซ้ำ', description: 'ตำแหน่งนี้มีรายการหรือกลุ่มโควต้าเดียวกันแล้ว' });
      return;
    }
    const toolSpec = (si.variantSpecification || '').trim();
    const toolGk = newGk;
    addDocumentNonBlocking(toolsQuery, {
      storeItemId: si.id,
      storeCategory: si.category ?? '',
      itemName: si.itemName ?? '',
      itemCode: si.itemCode ?? '',
      itemType: storeItemToToolItemType(si),
      quantityDefault: newTool.quantityDefault ?? 1,
      allowed: newTool.allowed ?? true,
      notes: newTool.notes || '',
      ...(toolGk ? { variantGroupKey: toolGk } : {}),
      ...(!toolGk && toolSpec ? { variantSpecification: toolSpec } : {}),
    });
    setIsAddToolOpen(false);
    resetAddToolDialog();
  };

  const deleteReq = (sub: string, reqId: string) => {
    if (!canDeletePositions) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์ลบรายการในตำแหน่งงาน' });
      return;
    }
    if (!firestore) return;
    if (confirm('ยืนยันการลบรายการนี้?')) {
      deleteDocumentNonBlocking(doc(firestore, 'positions', id, sub, reqId));
    }
  };

  const handleGenerateAI = async (type: 'certificate' | 'ppe' | 'tool') => {
    if (!position) return;
    setIsGenerating(type);
    try {
      const result = await generatePositionRequirements({
        positionName: position.positionName || position.positionNameEn,
        requirementsType: type,
        additionalDetails: position.description
      });
      
      toast({
        title: "AI Suggested Requirements",
        description: result.description,
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "AI Generation Failed",
        description: "ไม่สามารถสร้างคำแนะนำได้ในขณะนี้"
      });
    } finally {
      setIsGenerating(null);
    }
  };

  if (userLoading || !currentUser) return null;
  if (!canViewPositions) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-5xl mx-auto py-10 text-center text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงเมนูนี้</div>
      </AppShell>
    );
  }
  if (isPosLoading || !position) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="animate-pulse text-muted-foreground">กำลังโหลดข้อมูล (Loading Positions Matrix)...</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser as User} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1400px] mx-auto">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/positions"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight text-primary">
                {positionDetailHeadline(position as PositionDoc)}
              </h1>
              <Badge variant="outline" className="font-mono text-primary border-primary/20">
                Code: {position.positionCode}
              </Badge>
            </div>
            <p className="text-muted-foreground mt-1 flex items-center gap-2">
              <Info className="h-4 w-4" /> <strong>Worker Payroll</strong> — ตำแหน่งสำหรับมอบหมายงานและคนงานสนาม
            </p>
            <PayrollScopeTag scope="worker" showHint={false} className="mt-2" />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="h-11" onClick={() => { setEditedPos(position); setIsEditing(!isEditing); }}>
              {isEditing ? 'ยกเลิก (Cancel)' : 'แก้ไขข้อมูลหลัก (Edit Info)'}
            </Button>
            {isEditing && (
              <Button className="h-11 gap-2 bg-primary font-bold shadow-md" onClick={handleSaveMaster}>
                <Save className="h-4 w-4" /> บันทึก (Save)
              </Button>
            )}
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid grid-cols-4 w-full md:w-fit h-auto p-1 bg-muted/50">
            <TabsTrigger value="master" className="gap-2 py-2 px-8"><Briefcase className="h-4 w-4" /> ข้อมูลตำแหน่ง (Profile)</TabsTrigger>
            <TabsTrigger value="certs" className="gap-2 py-2 px-8"><FileText className="h-4 w-4" /> ใบเซอร์ (Certs)</TabsTrigger>
            <TabsTrigger value="ppe" className="gap-2 py-2 px-8"><HardHat className="h-4 w-4" /> PPE</TabsTrigger>
            <TabsTrigger value="tools" className="gap-2 py-2 px-8"><Hammer className="h-4 w-4" /> อุปกรณ์ (Tools)</TabsTrigger>
          </TabsList>

          <TabsContent value="master" className="mt-6 space-y-6">
            <Card className="shadow-sm">
              <CardHeader className="bg-primary/5 border-b">
                <CardTitle className="text-lg flex items-center gap-2 text-primary">
                  <Activity className="h-5 w-5" /> รายละเอียดตำแหน่งและนโยบาย (Job Definition & Policy)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6 pt-6">
                {/* มือถือ: เรียงแนวตั้ง */}
                <div className="flex flex-col gap-4 md:hidden">
                  <div className="space-y-2">
                    <Label className="font-bold">รหัสตำแหน่ง (Position Code)</Label>
                    <Input
                      readOnly
                      aria-readonly="true"
                      autoComplete="off"
                      tabIndex={-1}
                      value={position.positionCode ?? ''}
                      className="h-10 bg-muted font-mono font-bold text-primary cursor-not-allowed"
                    />
                    <p className="text-[10px] text-muted-foreground leading-snug">
                      ออกโดยระบบ — แก้ไขไม่ได้
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">ชื่อตำแหน่ง (Position Name) *</Label>
                    <Input
                      className="h-10"
                      disabled={!isEditing}
                      value={
                        isEditing
                          ? (editedPos.positionName ?? editedPos.positionNameTh ?? '')
                          : (position.positionName ?? position.positionNameTh ?? '')
                      }
                      onChange={(e) => setEditedPos({ ...editedPos, positionName: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">ฐานการจ่าย (Payroll Basis)</Label>
                    <Select
                      disabled={!isEditing}
                      onValueChange={(v) => {
                        const basis = v as Position['payrollBasis'];
                        setEditedPos((prev) => {
                          const next: Partial<Position> = { ...prev, payrollBasis: basis };
                          if (basis === 'MONTHLY') {
                            delete next.defaultLaborCostOnshore;
                            delete next.defaultLaborCostOffshore;
                            next.laborCostByContract = [];
                          }
                          return next;
                        });
                      }}
                      value={displayPayrollBasis}
                    >
                      <SelectTrigger className="h-10 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="DAILY">รายวัน (Daily)</SelectItem>
                        <SelectItem value="MONTHLY">รายเดือน (Monthly)</SelectItem>
                        {showHourlyPayrollBasisOption ? (
                          <SelectItem value="HOURLY">รายชั่วโมง (Hourly · legacy)</SelectItem>
                        ) : null}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* เดสก์ท็อป: แถวป้าย / แถวช่อง (ความสูงเท่ากัน) / แถบคำอธิบายใต้รหัส */}
                <div className="hidden md:grid md:grid-cols-12 md:gap-x-4 md:gap-y-2">
                  <div className="col-span-3 flex min-h-[2.75rem] items-end pb-1">
                    <Label className="font-bold leading-snug">รหัสตำแหน่ง (Position Code)</Label>
                  </div>
                  <div className="col-span-5 flex min-h-[2.75rem] items-end pb-1">
                    <Label className="font-bold leading-snug">ชื่อตำแหน่ง (Position Name) *</Label>
                  </div>
                  <div className="col-span-4 flex min-h-[2.75rem] items-end pb-1">
                    <Label className="font-bold leading-snug">ฐานการจ่าย (Payroll Basis)</Label>
                  </div>

                  <div className="col-span-3 flex items-stretch">
                    <Input
                      readOnly
                      aria-readonly="true"
                      autoComplete="off"
                      tabIndex={-1}
                      value={position.positionCode ?? ''}
                      className="h-10 w-full bg-muted font-mono font-bold text-primary cursor-not-allowed"
                    />
                  </div>
                  <div className="col-span-5 flex items-stretch">
                    <Input
                      className="h-10 w-full"
                      disabled={!isEditing}
                      value={
                        isEditing
                          ? (editedPos.positionName ?? editedPos.positionNameTh ?? '')
                          : (position.positionName ?? position.positionNameTh ?? '')
                      }
                      onChange={(e) => setEditedPos({ ...editedPos, positionName: e.target.value })}
                    />
                  </div>
                  <div className="col-span-4 flex items-stretch">
                    <Select
                      disabled={!isEditing}
                      onValueChange={(v) => {
                        const basis = v as Position['payrollBasis'];
                        setEditedPos((prev) => {
                          const next: Partial<Position> = { ...prev, payrollBasis: basis };
                          if (basis === 'MONTHLY') {
                            delete next.defaultLaborCostOnshore;
                            delete next.defaultLaborCostOffshore;
                            next.laborCostByContract = [];
                          }
                          return next;
                        });
                      }}
                      value={displayPayrollBasis}
                    >
                      <SelectTrigger className="h-10 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="DAILY">รายวัน (Daily)</SelectItem>
                        <SelectItem value="MONTHLY">รายเดือน (Monthly)</SelectItem>
                        {showHourlyPayrollBasisOption ? (
                          <SelectItem value="HOURLY">รายชั่วโมง (Hourly · legacy)</SelectItem>
                        ) : null}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="col-span-3 text-[10px] text-muted-foreground leading-snug">
                    ออกโดยระบบ — แก้ไขไม่ได้
                  </div>
                  <div className="col-span-5" aria-hidden />
                  <div className="col-span-4" aria-hidden />
                </div>
                {isMonthlyPayrollBasis ? (
                  <Alert className="border-sky-200 bg-sky-50/80 text-sky-950">
                    <Info className="h-4 w-4 text-sky-700" />
                    <AlertTitle className="text-sky-950">ฐานการจ่ายรายเดือน</AlertTitle>
                    <AlertDescription className="text-sky-900/90 text-sm leading-relaxed">
                      ตำแหน่งนี้ไม่ใช้ค่าแรงรายวัน Onshore/Offshore และไม่ดึงราคาจากสัญญา — กำหนดเงินเดือนพนักงานได้ที่{' '}
                      <Link href="/office-staff" className="font-semibold text-primary underline underline-offset-2">
                        ทะเบียนพนักงานออฟฟิศ
                      </Link>
                    </AlertDescription>
                  </Alert>
                ) : null}
                <div className="space-y-2">
                  <Label className="font-bold">รายละเอียดงาน (Description)</Label>
                  <Textarea 
                    className="min-h-[100px]"
                    disabled={!isEditing} 
                    value={isEditing ? editedPos.description : position.description} 
                    onChange={e => setEditedPos({...editedPos, description: e.target.value})}
                  />
                </div>
              </CardContent>
            </Card>
            {!isMonthlyPayrollBasis ? (
              <>
                <LaborCostPositionSection
                  displayOnshore={displayLaborOn}
                  displayOffshore={displayLaborOff}
                  isEditing={isEditing}
                  onPatch={(p) => setEditedPos((prev) => ({ ...prev, ...p }))}
                  canView={canViewLabor}
                  canEdit={canEditLabor}
                />
                <LaborCostByContractSection
                  rows={laborCostByContractRows}
                  isEditing={isEditing}
                  canView={canViewLabor}
                  canEdit={canEditLabor}
                  contracts={allMainContracts ?? undefined}
                  customerNameById={customerNameById}
                  onChange={(next) => setEditedPos((prev) => ({ ...prev, laborCostByContract: next }))}
                />
              </>
            ) : null}
          </TabsContent>

          <TabsContent value="certs" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between border-b bg-primary/5 pb-4">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2 text-primary">
                    <FileText className="h-5 w-5" /> เกณฑ์ใบรับรองบังคับ (Compliance Reqs)
                  </CardTitle>
                  <CardDescription>ใบเซอร์ที่คนงานต้องมีและยังไม่หมดอายุเพื่อผ่านเกณฑ์ READY</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="h-10 border-blue-200 text-blue-700 bg-blue-50" onClick={() => handleGenerateAI('certificate')} disabled={!!isGenerating}>
                    {isGenerating === 'certificate' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                    แนะนำโดย AI (AI Suggest)
                  </Button>
                  <Dialog open={isAddCertOpen} onOpenChange={setIsAddCertOpen}>
                    <DialogTrigger asChild>
                      <Button className="h-10 bg-primary font-bold shadow-md"><Plus className="h-4 w-4 mr-2" /> เพิ่มเกณฑ์ (Add)</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>เพิ่มเกณฑ์ใบรับรอง</DialogTitle>
                        <DialogDescription>กำหนดมาตรฐานใบรับรองสำหรับตำแหน่งงานนี้</DialogDescription>
                      </DialogHeader>
                      <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                          <Label className="font-bold">เลือกรายการจากเอกสารกลาง *</Label>
                          <Select value={newCert.templateId || ''} onValueChange={v => setNewCert({...newCert, templateId: v})}>
                            <SelectTrigger><SelectValue placeholder="เลือกเอกสารกลาง..." /></SelectTrigger>
                            <SelectContent>
                              {(workerDocCatalog || []).filter((x) => x.active !== false).map((x) => (
                                <SelectItem key={x.id} value={x.id}>
                                  {x.itemName} - {x.requirementType}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {selectedCatalogItem && (
                          <div className="text-xs rounded-lg border p-3 bg-muted/20">
                            ประเภท: <b>{selectedCatalogItem.requirementType}</b> | มีอายุ:{' '}
                            <b>{selectedCatalogItem.hasExpiry ? 'มี' : 'ไม่มี'}</b> | อายุแนะนำ:{' '}
                            <b>{selectedCatalogItem.hasExpiry ? `${selectedCatalogItem.defaultValidityMonths || 0} เดือน` : '-'}</b>
                          </div>
                        )}
                        <div className="flex items-center space-x-2 p-3 border rounded-lg bg-muted/20">
                          <Checkbox id="req" checked={newCert.required} onCheckedChange={v => setNewCert({...newCert, required: !!v})} />
                          <Label htmlFor="req" className="font-bold cursor-pointer">บังคับต้องมี (Mandatory - Blocks Readiness)</Label>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setIsAddCertOpen(false)}>ยกเลิก</Button>
                        <Button onClick={handleAddCert} className="bg-primary font-bold">บันทึกเกณฑ์ (Save)</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="pl-6 font-bold">ใบรับรอง (Certificate)</TableHead>
                      <TableHead className="font-bold">ประเภท</TableHead>
                      <TableHead className="font-bold">ความสำคัญ (Criticality)</TableHead>
                      <TableHead className="font-bold">อายุ</TableHead>
                      <TableHead className="text-right pr-6">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {certs?.map(c => (
                      <TableRow key={c.id}>
                        <TableCell className="pl-6">
                          <div className="flex flex-col">
                            <span className="font-bold text-primary">{c.certificateName}</span>
                            <span className="text-[10px] font-mono text-muted-foreground">{c.certificateCode || 'N/A'}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs uppercase">
                          {c.requirementType || 'certificate'}
                        </TableCell>
                        <TableCell>
                          {c.required ? (
                            <Badge className="bg-red-600">Mandatory (บังคับ)</Badge>
                          ) : (
                            <Badge variant="outline" className="text-slate-500">Optional (เสริม)</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{c.hasExpiry === false ? 'ไม่มีวันหมดอายุ' : (c.validityMonths ? `${c.validityMonths} เดือน` : 'มีอายุ (ไม่ระบุเดือน)')}</TableCell>
                        <TableCell className="text-right pr-6">
                          <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => deleteReq('certificate_requirements', c.id)}><Trash2 className="h-4 w-4" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {certs?.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-20 text-center text-muted-foreground italic">ไม่มีรายการใบเซอร์/เอกสารที่กำหนด</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ppe" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between border-b bg-primary/5 pb-4">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2 text-primary">
                    <HardHat className="h-5 w-5" /> อุปกรณ์ PPE บังคับ (Standard PPE)</CardTitle>
                  <CardDescription>รายการชุดและอุปกรณ์ป้องกันภัยที่บริษัทต้องจัดเตรียมให้ตำแหน่งนี้</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="h-10 border-blue-200 text-blue-700 bg-blue-50" onClick={() => handleGenerateAI('ppe')} disabled={!!isGenerating}>
                    {isGenerating === 'ppe' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                    แนะนำโดย AI
                  </Button>
                  <Dialog
                    open={isAddPPEOpen}
                    onOpenChange={(open) => {
                      setIsAddPPEOpen(open);
                      if (open) {
                        setNewPPE({ required: true, quantityDefault: 1, storeItemId: undefined });
                      }
                    }}
                  >
                    <DialogTrigger asChild>
                      <Button className="h-10 bg-primary font-bold shadow-md"><Plus className="h-4 w-4 mr-2" /> เพิ่มรายการ (Add)</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>เพิ่มรายการ PPE มาตรฐาน</DialogTitle>
                        <DialogDescription>
                          เลือก<strong>ชื่อหลัก</strong> (เมนหรือรายการเดี่ยว) — ไม่เลือกไซส์ที่นี่ · ตอนเบิกค่อยเลือกรุ่นย่อย · โควต้านับรวมทุกไซส์ที่ใช้รหัสกลุ่มเดียวกันใน store
                        </DialogDescription>
                      </DialogHeader>
                      <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                          <Label className="font-bold">รายการจากคลัง (PPE) — ชื่อหลัก *</Label>
                          <Select
                            key={ppeMainCatalogPickList.length}
                            value={newPPE.storeItemId ?? undefined}
                            onValueChange={(storeItemId) => {
                              const si = ppeMainCatalogPickList.find((x) => x.id === storeItemId);
                              if (!si) return;
                              setNewPPE((prev) => ({
                                ...prev,
                                storeItemId: si.id,
                                itemCode: si.itemCode,
                                itemName: si.itemName,
                              }));
                            }}
                          >
                            <SelectTrigger className="h-10">
                              <SelectValue
                                placeholder={
                                  ppeMainCatalogPickList.length
                                    ? 'เลือกชื่อหลัก…'
                                    : 'ยังไม่มีเมน/รายการเดี่ยว — ไปที่ /store/ppe'
                                }
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {ppeMainCatalogPickList.map((si) => (
                                <SelectItem key={si.id} value={si.id}>
                                  {si.catalogGroupRole === 'header'
                                    ? `${formatPositionCatalogPickLabel(si)} · เมน`
                                    : formatPositionCatalogPickLabel(si)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid gap-2">
                          <Label className="font-bold">จำนวนต่อคน (โควต้า)</Label>
                          <Input type="number" min={1} value={newPPE.quantityDefault || 1} onChange={e => setNewPPE({...newPPE, quantityDefault: parseInt(e.target.value, 10) || 1})} />
                          <p className="text-[11px] text-muted-foreground">ถ้าหลายไซส์ใช้ &quot;รหัสกลุ่มโควต้า&quot; เดียวกันใน store จะนับรวมกันเมื่อเบิก (เช่น M 1 + L 1 = 2)</p>
                        </div>
                        <div className="flex items-center space-x-2 p-3 border rounded-lg">
                          <Checkbox id="ppe-req" checked={newPPE.required} onCheckedChange={v => setNewPPE({...newPPE, required: !!v})} />
                          <Label htmlFor="ppe-req" className="font-bold cursor-pointer">รายการบังคับ (Required)</Label>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setIsAddPPEOpen(false)}>ยกเลิก</Button>
                        <Button onClick={handleAddPPE} className="bg-primary font-bold">บันทึก (Save)</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="pl-6 font-bold">อุปกรณ์ (PPE Item)</TableHead>
                      <TableHead className="font-bold">จำนวน (Qty)</TableHead>
                      <TableHead className="font-bold">ความสำคัญ</TableHead>
                      <TableHead className="text-right pr-6">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ppe?.map(p => (
                      <TableRow key={p.id}>
                        <TableCell className="pl-6">
                          <div className="flex flex-col gap-1">
                            <span className="font-bold text-primary">
                              {(p.variantGroupKey || '').trim()
                                ? (p.itemName || '—')
                                : formatStoreItemLabel({
                                    itemName: p.itemName,
                                    variantSpecification: p.variantSpecification,
                                  })}
                            </span>
                            <span className="text-[10px] font-mono text-muted-foreground">{p.itemCode}</span>
                            {(p.variantGroupKey || '').trim() ? (
                              <Badge variant="outline" className="text-[10px] w-fit">
                                กลุ่มโควต้า: {p.variantGroupKey} · เบิกรวมหลายไซส์ได้
                              </Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm font-medium">{p.quantityDefault} ชุด/คน</TableCell>
                        <TableCell>{p.required ? <Badge className="bg-orange-600">Required</Badge> : <Badge variant="outline">Optional</Badge>}</TableCell>
                        <TableCell className="text-right pr-6">
                          <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => deleteReq('ppe_requirements', p.id)}><Trash2 className="h-4 w-4" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {ppe?.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="py-20 text-center text-muted-foreground italic">ไม่มีรายการ PPE ที่กำหนด</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="tools" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between border-b bg-primary/5 pb-4">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2 text-primary">
                    <Hammer className="h-5 w-5" /> เครื่องมือประจำตำแหน่ง (Tool Reqs)
                  </CardTitle>
                  <CardDescription>รายการเครื่องมือช่างพื้นฐานที่อนุญาตให้เบิกได้ตามตำแหน่งงาน</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="h-10 border-blue-200 text-blue-700 bg-blue-50" onClick={() => handleGenerateAI('tool')} disabled={!!isGenerating}>
                    {isGenerating === 'tool' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                    แนะนำโดย AI
                  </Button>
                  <Dialog
                    open={isAddToolOpen}
                    onOpenChange={(open) => {
                      setIsAddToolOpen(open);
                      if (open) resetAddToolDialog();
                    }}
                  >
                    <DialogTrigger asChild>
                      <Button className="h-10 bg-primary font-bold shadow-md"><Plus className="h-4 w-4 mr-2" /> เพิ่มรายการ (Add)</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>เพิ่มรายการเครื่องมือ/อุปกรณ์</DialogTitle>
                        <DialogDescription>
                          เลือก<strong>ชื่อหลัก</strong>จากทะเบียนอุปกรณ์ (ไม่รวม PPE) — PPE กำหนดที่แท็บ PPE · ไม่เลือกรุ่นย่อยที่นี่ · รหัสกลุ่มเดียวกันใน store จะนับรวมกันเมื่อเบิก
                        </DialogDescription>
                      </DialogHeader>
                      <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                          <Label className="font-bold">อุปกรณ์จากคลัง — ชื่อหลัก *</Label>
                          <Select
                            key={toolMainCatalogPickList.length}
                            value={newTool.storeItemId ?? undefined}
                            onValueChange={(storeItemId) => {
                              const si = toolMainCatalogPickList.find((x) => x.id === storeItemId);
                              if (!si) return;
                              setNewTool((prev) => ({
                                ...prev,
                                storeItemId: si.id,
                                itemCode: si.itemCode,
                                itemName: si.itemName,
                                itemType: storeItemToToolItemType(si),
                              }));
                            }}
                          >
                            <SelectTrigger className="h-10">
                              <SelectValue
                                placeholder={
                                  toolMainCatalogPickList.length
                                    ? 'เลือกชื่อหลัก…'
                                    : 'ยังไม่มีเมน/รายการเดี่ยว — ไปที่ /store/items'
                                }
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {toolMainCatalogPickList.map((si) => (
                                <SelectItem key={si.id} value={si.id}>
                                  {si.catalogGroupRole === 'header'
                                    ? `${formatPositionCatalogPickLabel(si)} · เมน`
                                    : formatPositionCatalogPickLabel(si)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {newTool.storeItemId && (
                            <p className="text-xs text-muted-foreground">
                              ประเภทเบิก (อ้างอิงคลัง):{' '}
                              <span className="font-medium capitalize">{newTool.itemType}</span>
                            </p>
                          )}
                        </div>
                        <div className="grid gap-2">
                          <Label className="font-bold">จำนวนเบิกต่อครั้งสูงสุด</Label>
                          <Input
                            type="number"
                            min={1}
                            value={newTool.quantityDefault || 1}
                            onChange={(e) => setNewTool({ ...newTool, quantityDefault: parseInt(e.target.value, 10) || 1 })}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setIsAddToolOpen(false)}>ยกเลิก</Button>
                        <Button onClick={handleAddTool} className="bg-primary font-bold">บันทึก (Save)</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="pl-6 font-bold">เครื่องมือ (Tools & Equipments)</TableHead>
                      <TableHead className="font-bold">หมวดคลัง</TableHead>
                      <TableHead className="font-bold">ประเภท</TableHead>
                      <TableHead className="font-bold">จำนวนเบิก</TableHead>
                      <TableHead className="text-right pr-6">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tools?.map(t => (
                      <TableRow key={t.id}>
                        <TableCell className="pl-6 font-bold text-primary">
                          <div className="flex flex-col gap-0.5">
                            <span>
                              {(t.variantGroupKey || '').trim()
                                ? (t.itemName || '—')
                                : formatStoreItemLabel({
                                    itemName: t.itemName,
                                    variantSpecification: t.variantSpecification,
                                  })}
                            </span>
                            {t.itemCode ? (
                              <span className="text-[10px] font-mono text-muted-foreground font-normal">{t.itemCode}</span>
                            ) : null}
                            {(t.variantGroupKey || '').trim() ? (
                              <Badge variant="outline" className="text-[10px] w-fit font-normal">
                                กลุ่มโควต้า: {t.variantGroupKey}
                              </Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          {t.storeCategory ? (
                            <Badge variant="outline" className="text-xs">{t.storeCategory}</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="capitalize text-xs font-medium text-muted-foreground">{t.itemType}</TableCell>
                        <TableCell className="text-sm font-bold">{t.quantityDefault} EA</TableCell>
                        <TableCell className="text-right pr-6">
                          <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => deleteReq('tool_requirements', t.id)}><Trash2 className="h-4 w-4" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {tools?.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-20 text-center text-muted-foreground italic">ไม่มีรายการเครื่องมือที่กำหนด</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Dialog
          open={laborSaveDialogOpen}
          onOpenChange={(open) => {
            if (!open) {
              setLaborSaveDialogOpen(false);
              setLaborWorkerCount(null);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>ยืนยันการแก้ต้นทุนมาตรฐาน</DialogTitle>
              <DialogDescription asChild>
                <div className="space-y-2 text-sm">
                  <p>
                    การแก้ฐาน onshore / offshore จะส่งผลกับคนงานที่ยึด default ตำแหน่ง (ไม่กระทบรายคนที่กำหนด override
                    เอง)
                  </p>
                  {laborCountLoading ? (
                    <p className="flex items-center gap-2 text-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> กำลังนับคนงาน…
                    </p>
                  ) : laborWorkerCount != null ? (
                    <p className="font-medium text-foreground">ตอนนี้มี {laborWorkerCount} คนที่ตั้งตำแหน่งหลักเป็นตำแหน่งนี้</p>
                  ) : null}
                </div>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setLaborSaveDialogOpen(false)}>
                ยกเลิก
              </Button>
              <Button onClick={confirmLaborSave} disabled={laborCountLoading} className="bg-primary font-bold">
                ยืนยันบันทึก
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
