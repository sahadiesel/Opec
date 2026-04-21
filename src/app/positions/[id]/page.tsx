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
  Globe,
  Anchor
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
import { doc, collection } from 'firebase/firestore';
import { updateDocumentNonBlocking, addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import {
  Position,
  PositionCertificateRequirement,
  PositionPPERequirement,
  PositionToolRequirement,
  User,
  JobMode,
  WorkerDocumentCatalogItem,
  StoreItem,
  STORE_ITEM_CATEGORIES,
  storeItemIsPpeCatalog,
  formatStoreItemLabel,
} from '@/lib/types';

const TOOL_STORE_CATEGORIES = STORE_ITEM_CATEGORIES.filter((c) => c !== 'PPE');
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { generatePositionRequirements } from '@/ai/flows/generate-position-requirements';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import { positionDetailHeadline, type PositionDoc } from '@/lib/position-display';
import { useAppUser } from '@/hooks/use-app-user';
import { canView, canEdit, canDelete } from '@/lib/permissions';

export default function PositionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const canViewPositions = useMemo(() => canView(currentUser, 'positions'), [currentUser]);
  const canEditPositions = useMemo(() => canEdit(currentUser, 'positions'), [currentUser]);
  const canDeletePositions = useMemo(() => canDelete(currentUser, 'positions'), [currentUser]);

  const posRef = useMemoFirebase(
    () => (firestore && canViewPositions ? doc(firestore, 'positions', id) : null),
    [firestore, id, canViewPositions]
  );
  const { data: position, isLoading: isPosLoading } = useDoc<Position>(posRef as any);

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

  const [isEditing, setIsEditing] = useState(false);
  const [editedPos, setEditedPos] = useState<Partial<Position>>({});

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
  const [toolStoreCategory, setToolStoreCategory] = useState<string>('General');
  const [ppeStoreCategory, setPpeStoreCategory] = useState<string>('all');

  const ppeCategoryOptions = useMemo(() => {
    const s = new Set<string>();
    (storeItems || []).forEach((i) => {
      if (storeItemIsPpeCatalog(i) && (i.category || '').trim()) s.add(i.category);
    });
    return Array.from(s).sort();
  }, [storeItems]);

  const ppeFromStoreFiltered = useMemo(() => {
    if (!storeItems?.length) return [];
    return storeItems.filter((i) => {
      if (!storeItemIsPpeCatalog(i) || i.active === false) return false;
      if (ppeStoreCategory !== 'all' && (i.category || '') !== ppeStoreCategory) return false;
      return true;
    });
  }, [storeItems, ppeStoreCategory]);

  const toolsInSelectedStoreCategory = useMemo(() => {
    if (!storeItems?.length) return [];
    return storeItems.filter(
      (i) =>
        !storeItemIsPpeCatalog(i) &&
        (i.category || '') === toolStoreCategory &&
        i.active !== false,
    );
  }, [storeItems, toolStoreCategory]);

  const resetAddToolDialog = useCallback(() => {
    setToolStoreCategory('General');
    setNewTool({ allowed: true, quantityDefault: 1, itemType: 'tool' });
  }, []);

  const [isGenerating, setIsGenerating] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('master');

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

  const handleSaveMaster = () => {
    if (!canEditPositions) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์แก้ไขตำแหน่งงาน' });
      return;
    }
    if (!posRef || !position) return;
    updateDocumentNonBlocking(posRef, {
      ...editedPos,
      positionCode: position.positionCode,
      updatedAt: Date.now(),
    });
    setIsEditing(false);
    toast({ title: "บันทึกสำเร็จ", description: "ข้อมูลหลักของตำแหน่งงานถูกอัปเดตแล้ว" });
  };

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
    const gk = (si.variantGroupKey || '').trim();
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
      ...(ppeSpec ? { variantSpecification: ppeSpec } : {}),
    });
    setIsAddPPEOpen(false);
    setPpeStoreCategory('all');
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
        description: 'เลือกหมวดหมู่จากคลังอุปกรณ์ แล้วเลือกรายการจากทะเบียน store',
      });
      return;
    }
    const si = storeItems?.find((s) => s.id === newTool.storeItemId);
    if (!si) {
      toast({ variant: 'destructive', title: 'ไม่พบรายการ', description: 'รีเฟรชหน้าแล้วลองใหม่' });
      return;
    }
    const newGk = (si.variantGroupKey || '').trim();
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
    const toolGk = (si.variantGroupKey || '').trim();
    addDocumentNonBlocking(toolsQuery, {
      storeItemId: si.id,
      storeCategory: si.category ?? '',
      itemName: si.itemName ?? '',
      itemCode: si.itemCode ?? '',
      itemType: storeItemToToolItemType(si),
      quantityDefault: newTool.quantityDefault ?? 1,
      allowed: newTool.allowed ?? true,
      notes: newTool.notes || '',
      ...(toolSpec ? { variantSpecification: toolSpec } : {}),
      ...(toolGk ? { variantGroupKey: toolGk } : {}),
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
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight text-primary">
                {positionDetailHeadline(position as PositionDoc)}
              </h1>
              <Badge variant="outline" className="font-mono text-primary border-primary/20">
                Code: {position.positionCode}
              </Badge>
              <Badge variant="secondary" className="gap-1">
                {position.jobMode === 'OFFSHORE' ? <Anchor className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
                {position.jobMode} Mode
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label className="font-bold">ชื่อตำแหน่ง (Position Name) *</Label>
                    <Input 
                      disabled={!isEditing} 
                      value={isEditing ? (editedPos.positionName ?? editedPos.positionNameTh) : (position.positionName ?? position.positionNameTh)} 
                      onChange={e => setEditedPos({...editedPos, positionName: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">รหัสตำแหน่ง (Position Code) *</Label>
                    <Input
                      readOnly
                      aria-readonly="true"
                      autoComplete="off"
                      value={position.positionCode ?? ''}
                      className="bg-muted font-mono font-bold text-primary cursor-not-allowed"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      รหัสออกโดยระบบตอนสร้างตำแหน่ง — ไม่สามารถแก้ไขเพื่อป้องกันการชนกับรหัสที่มีอยู่
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">นโยบายการทำงาน (Job Mode) *</Label>
                    <Select 
                      disabled={!isEditing}
                      onValueChange={v => setEditedPos({...editedPos, jobMode: v as JobMode})}
                      value={isEditing ? editedPos.jobMode : position.jobMode}
                    >
                      <SelectTrigger className="h-10 font-bold border-primary/20"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="OFFSHORE">OFFSHORE (นอกชายฝั่ง)</SelectItem>
                        <SelectItem value="ONSHORE">ONSHORE (บนฝั่ง)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] text-muted-foreground italic">
                      * นโยบายจะมีผลต่อเกณฑ์การคำนวณความพร้อม (Readiness) และกฎการเบิกจ่าย
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">ฐานการจ่ายเงินคนงาน (Payroll Basis)</Label>
                    <Select 
                      disabled={!isEditing}
                      onValueChange={v => setEditedPos({...editedPos, payrollBasis: v as any})}
                      value={isEditing ? editedPos.payrollBasis : position.payrollBasis}
                    >
                      <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Daily">Daily (รายวัน)</SelectItem>
                        <SelectItem value="Monthly">Monthly (รายเดือน)</SelectItem>
                        <SelectItem value="Hourly">Hourly (รายชั่วโมง)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
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
                        setPpeStoreCategory('all');
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
                          เลือกจากทะเบียน PPE ในคลัง — โควต้าต่อคนนับรวมทุกขนาดเมื่อใช้รหัสกลุ่มเดียวกันใน store
                        </DialogDescription>
                      </DialogHeader>
                      <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                          <Label className="font-bold">หมวดหมู่ (กรอง)</Label>
                          <Select value={ppeStoreCategory} onValueChange={(v) => {
                            setPpeStoreCategory(v);
                            setNewPPE((prev) => ({ ...prev, storeItemId: undefined }));
                          }}>
                            <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">ทุกหมวด</SelectItem>
                              {ppeCategoryOptions.map((c) => (
                                <SelectItem key={c} value={c}>{c}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid gap-2">
                          <Label className="font-bold">รายการจากคลัง (PPE) *</Label>
                          <Select
                            key={`${ppeStoreCategory}-${ppeFromStoreFiltered.length}`}
                            value={newPPE.storeItemId ?? undefined}
                            onValueChange={(storeItemId) => {
                              const si = ppeFromStoreFiltered.find((x) => x.id === storeItemId);
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
                              <SelectValue placeholder={ppeFromStoreFiltered.length ? 'เลือกรายการ…' : 'ไม่มี PPE ในหมวดนี้ — ไปที่ /store/ppe'} />
                            </SelectTrigger>
                            <SelectContent>
                              {ppeFromStoreFiltered.map((si) => (
                                <SelectItem key={si.id} value={si.id}>
                                  {si.itemCode} — {formatStoreItemLabel(si)}
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
                              {formatStoreItemLabel({ itemName: p.itemName, variantSpecification: p.variantSpecification })}
                            </span>
                            <span className="text-[10px] font-mono text-muted-foreground">{p.itemCode}</span>
                            {(p.variantGroupKey || '').trim() ? (
                              <Badge variant="outline" className="text-[10px] w-fit">กลุ่มโควต้า: {p.variantGroupKey}</Badge>
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
                          เลือกจากทะเบียนอุปกรณ์ (ไม่รวม PPE) — PPE กำหนดที่แท็บ PPE
                        </DialogDescription>
                      </DialogHeader>
                      <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                          <Label className="font-bold">หมวดหมู่ (คลังอุปกรณ์) *</Label>
                          <Select
                            value={toolStoreCategory}
                            onValueChange={(v) => {
                              setToolStoreCategory(v);
                              setNewTool((prev) => ({
                                ...prev,
                                storeItemId: undefined,
                                itemCode: undefined,
                                itemName: undefined,
                                itemType: 'tool',
                              }));
                            }}
                          >
                            <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {TOOL_STORE_CATEGORIES.map((c) => (
                                <SelectItem key={c} value={c}>{c}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid gap-2">
                          <Label className="font-bold">อุปกรณ์จากคลัง *</Label>
                          <Select
                            key={toolStoreCategory}
                            value={newTool.storeItemId ?? undefined}
                            onValueChange={(storeItemId) => {
                              const si = toolsInSelectedStoreCategory.find((x) => x.id === storeItemId);
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
                              <SelectValue placeholder={toolsInSelectedStoreCategory.length ? 'เลือกรายการ…' : 'ไม่มีรายการในหมวดนี้'} />
                            </SelectTrigger>
                            <SelectContent>
                              {toolsInSelectedStoreCategory.map((si) => (
                                <SelectItem key={si.id} value={si.id}>
                                  {si.itemCode} — {formatStoreItemLabel(si)}
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
                            <span>{formatStoreItemLabel({ itemName: t.itemName, variantSpecification: t.variantSpecification })}</span>
                            {t.itemCode ? (
                              <span className="text-[10px] font-mono text-muted-foreground font-normal">{t.itemCode}</span>
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
      </div>
    </AppShell>
  );
}
