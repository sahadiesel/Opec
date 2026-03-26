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
  Briefcase,
  Waves,
  CheckCircle2,
  Info,
  Loader2,
  PackageMinus,
  Inbox,
  FileText,
  AlertTriangle,
  PackageOpen,
  ShieldAlert
} from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase, useDoc, useUser } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccessDomain } from '@/lib/permission-core';
import { collection, doc, query, where, getDocs, updateDoc, increment, writeBatch } from 'firebase/firestore';
import {
  StoreItem,
  Worker,
  Assignment,
  Wave,
  Position,
  User as AppUser,
  PositionPPERequirement,
  PositionToolRequirement,
  OfficeStaff,
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';

export default function IssueItemsPage() {
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const canAccess = canAccessDomain(currentUser, 'store');

  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [selectedAsgnId, setSelectedAsgnId] = useState('');
  const [issueDate, setIssueDate] = useState(() => timestampToHtmlDateValue(Date.now()));
  const [notes, setNotes] = useState('');
  const [issueList, setIssueList] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [issueMode, setIssueMode] = useState<'field' | 'office'>('field');
  const [selectedOfficeStaffId, setSelectedOfficeStaffId] = useState('');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [positionEditDialogOpen, setPositionEditDialogOpen] = useState(false);
  const [positionEditReason, setPositionEditReason] = useState<'not_listed' | 'over_qty'>('not_listed');

  // STRICT ENFORCEMENT: Only workers from 'workers' collection (Field Labor)
  const workersQuery = useMemoFirebase(() => {
    if (!firestore || !canAccess) return null;
    return collection(firestore, 'workers');
  }, [firestore, canAccess]);
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  const asgnQuery = useMemoFirebase(() => {
    if (!firestore || !canAccess || !selectedWorkerId) return null;
    return query(collection(firestore, 'mobilizations'), where('workerId', '==', selectedWorkerId), where('deploymentStatus', '!=', 'CLOSED'));
  }, [firestore, canAccess, selectedWorkerId]);
  const { data: assignments } = useCollection<Assignment>(asgnQuery as any);

  const activeAsgn = assignments?.find(a => a.id === selectedAsgnId);
  
  const waveRef = useMemoFirebase(() => (firestore && activeAsgn ? doc(firestore, 'waves', activeAsgn.waveId) : null), [firestore, activeAsgn?.waveId]);
  const { data: wave } = useDoc<Wave>(waveRef as any);

  const posRef = useMemoFirebase(() => (firestore && activeAsgn ? doc(firestore, 'positions', activeAsgn.positionId) : null), [firestore, activeAsgn?.positionId]);
  const { data: position } = useDoc<Position>(posRef as any);

  const itemsQuery = useMemoFirebase(() => (firestore && canAccess ? collection(firestore, 'store_items') : null), [firestore, canAccess]);
  const { data: storeItems } = useCollection<StoreItem>(itemsQuery as any);

  const officeStaffQuery = useMemoFirebase(() => {
    if (!firestore || !canAccess) return null;
    return collection(firestore, 'office_staff');
  }, [firestore, canAccess]);
  const { data: officeStaffList } = useCollection<OfficeStaff>(officeStaffQuery as any);

  // Position Requirements State
  const [posPPE, setPosPPE] = useState<PositionPPERequirement[]>([]);
  const [posTools, setPosTools] = useState<PositionToolRequirement[]>([]);

  useEffect(() => {
    async function fetchPosReqs() {
      if (!firestore || !activeAsgn?.positionId) {
        setPosPPE([]);
        setPosTools([]);
        return;
      }
      const ppeRef = collection(firestore, 'positions', activeAsgn.positionId, 'ppe_requirements');
      const toolRef = collection(firestore, 'positions', activeAsgn.positionId, 'tool_requirements');
      const [ppeSnap, toolSnap] = await Promise.all([getDocs(ppeRef), getDocs(toolRef)]);
      setPosPPE(ppeSnap.docs.map(d => ({ ...d.data(), id: d.id } as PositionPPERequirement)));
      setPosTools(toolSnap.docs.map(d => ({ ...d.data(), id: d.id } as PositionToolRequirement)));
    }
    fetchPosReqs();
  }, [firestore, activeAsgn?.positionId]);

  const onIssueModeChange = (v: string) => {
    const next = v as 'field' | 'office';
    setIssueMode(next);
    setIssueList([]);
    setCatalogSearch('');
    if (next === 'office') {
      setSelectedWorkerId('');
      setSelectedAsgnId('');
    } else {
      setSelectedOfficeStaffId('');
    }
  };

  const filteredCatalogForField = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    if (!storeItems) return [];
    return storeItems.filter((i) => {
      if (!q) return true;
      return (
        (i.itemName || '').toLowerCase().includes(q) ||
        (i.itemCode || '').toLowerCase().includes(q)
      );
    });
  }, [storeItems, catalogSearch]);

  const handleAddToList = (item: StoreItem) => {
    if (issueMode === 'office') {
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
            i.itemId === item.id ? { ...i, quantity: Math.min(i.quantity + 1, item.currentStock) } : i
          )
        );
        return;
      }
      setIssueList([
        ...issueList,
        {
          itemId: item.id,
          itemCode: item.itemCode,
          itemName: item.itemName,
          quantity: 1,
          unit: item.unit,
          remarks: '',
        },
      ]);
      return;
    }

    if (!activeAsgn?.positionId) {
      toast({
        variant: 'destructive',
        title: 'ข้อมูลไม่ครบ',
        description: 'กรุณาเลือกลูกจ้างและงานมอบหมายก่อนเบิกเครื่องมือ',
      });
      return;
    }

    const matchPPE = posPPE.find((p) => p.itemCode === item.itemCode || p.itemName === item.itemName);
    const matchTool = posTools.find((t) => t.itemCode === item.itemCode || t.itemName === item.itemName);
    const allowed = !!(matchPPE || matchTool);

    if (!allowed) {
      setPositionEditReason('not_listed');
      setPositionEditDialogOpen(true);
      return;
    }

    const maxQty = matchPPE?.quantityDefault ?? matchTool?.quantityDefault ?? 1;
    const existing = issueList.find((i) => i.itemId === item.id);
    const nextTotal = (existing?.quantity ?? 0) + 1;
    if (nextTotal > maxQty) {
      setPositionEditReason('over_qty');
      setPositionEditDialogOpen(true);
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

    if (existing) {
      setIssueList(
        issueList.map((i) =>
          i.itemId === item.id ? { ...i, quantity: Math.min(i.quantity + 1, item.currentStock, maxQty) } : i
        )
      );
      return;
    }

    setIssueList([
      ...issueList,
      {
        itemId: item.id,
        itemCode: item.itemCode,
        itemName: item.itemName,
        quantity: 1,
        unit: item.unit,
        remarks: '',
      },
    ]);
  };

  const handleConfirmIssue = async () => {
    if (!firestore || !currentUser || issueList.length === 0) {
      toast({
        variant: 'destructive',
        title: 'ข้อมูลไม่ครบ',
        description: 'กรุณาเลือกผู้รับและรายการที่ต้องการเบิก',
      });
      return;
    }

    if (issueMode === 'office') {
      if (!selectedOfficeStaffId) {
        toast({
          variant: 'destructive',
          title: 'ข้อมูลไม่ครบ',
          description: 'กรุณาเลือกพนักงานออฟฟิศผู้รับเครื่องมือ',
        });
        return;
      }
    } else if (!activeAsgn) {
      toast({
        variant: 'destructive',
        title: 'ข้อมูลไม่ครบ',
        description: 'กรุณาระบุคนงาน งาน และรายการที่ต้องการเบิกให้ครบถ้วน',
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

      const staff =
        issueMode === 'office'
          ? officeStaffList?.find((s) => s.id === selectedOfficeStaffId)
          : undefined;

      const headerData: Record<string, unknown> = {
        id: newIssueRef.id,
        issueNo: finalNo,
        issueDate,
        status: 'completed',
        notes,
        createdAt: Date.now(),
        createdBy: currentUser.displayName,
        issueType: issueMode,
      };

      if (issueMode === 'office') {
        headerData.officeStaffId = selectedOfficeStaffId;
        headerData.officeStaffName = staff?.fullName || '';
        headerData.workerId = '';
        headerData.assignmentId = '';
        headerData.waveId = '';
        headerData.positionId = '';
      } else {
        headerData.workerId = selectedWorkerId;
        headerData.assignmentId = activeAsgn!.id;
        headerData.waveId = activeAsgn!.waveId;
        headerData.positionId = activeAsgn!.positionId;
      }

      batch.set(newIssueRef, headerData);

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
        const txPayload: Record<string, unknown> = {
          itemId: item.itemId,
          transactionType: 'ISSUE',
          quantity: item.quantity,
          transactionDate: issueDate,
          notes: `Ref Slip: ${finalNo}. ${item.remarks || ''}`,
          createdAt: Date.now(),
          createdBy: currentUser.displayName,
          issueType: issueMode,
        };

        if (issueMode === 'office') {
          txPayload.officeStaffId = selectedOfficeStaffId;
          txPayload.workerId = '';
          txPayload.assignmentId = '';
          txPayload.waveId = '';
        } else {
          txPayload.workerId = selectedWorkerId;
          txPayload.assignmentId = activeAsgn!.id;
          txPayload.waveId = activeAsgn!.waveId;
        }

        batch.set(txRef, txPayload);
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
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild><Link href="/store"><ArrowLeft className="h-5 w-5" /></Link></Button>
          <div className="flex-1">
            <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
              <PackageMinus className="h-8 w-8 text-orange-600" /> เบิกอุปกรณ์ / เครื่องมือ (Issue from Store)
            </h1>
            <p className="text-muted-foreground text-lg">
              โหมดลูกจ้างหน้างาน: ผูกกับ Assignment และรายการ PPE/เครื่องมือตามตำแหน่ง — โหมดพนักงานออฟฟิศ: เบิกยืมได้โดยไม่ผูกลิสต์ตำแหน่ง
            </p>
          </div>
        </div>

        <Tabs value={issueMode} onValueChange={onIssueModeChange} className="w-full">
          <TabsList className="grid w-full max-w-lg grid-cols-2 h-auto p-1">
            <TabsTrigger value="field" className="py-3">ลูกจ้างหน้างาน (Field)</TabsTrigger>
            <TabsTrigger value="office" className="py-3">พนักงานออฟฟิศ (Office)</TabsTrigger>
          </TabsList>
        </Tabs>

        <Alert className="bg-amber-50 border-amber-200 text-amber-800 shadow-sm">
          <ShieldAlert className="h-5 w-5 text-amber-600" />
          <AlertTitle className="font-bold uppercase tracking-wider">นโยบายการเบิกจ่ายพัสดุ</AlertTitle>
          <AlertDescription className="text-sm">
            {issueMode === 'field' ? (
              <>
                ลูกจ้างหน้างานต้องเบิกตามรายการที่กำหนดในตำแหน่ง (PPE/เครื่องมือ) และไม่เกินจำนวนที่กำหนด หากต้องการเพิ่มรายการหรือจำนวน ให้ไปแก้ไขที่เมนูตำแหน่งงาน → แท็บอุปกรณ์ (Tools)
              </>
            ) : (
              <>
                พนักงานออฟฟิศสามารถเบิกยืมเครื่องมือ/อุปกรณ์ได้จากแคตตาล็อกทั้งหมด โดยไม่ต้องอ้างอิงลิสต์ตามตำแหน่งงาน
              </>
            )}
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* LEFT: Context & Catalog */}
          <div className="lg:col-span-2 space-y-6">
            {issueMode === 'field' && (
            <>
            <Card className="shadow-md">
              <CardHeader className="border-b bg-muted/20">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Inbox className="h-5 w-5 text-primary" /> เลือกคนงานและงาน (Field Recipient Context)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="font-bold">เลือกคนงานหน้างาน (Select Field Worker)</Label>
                    <Select onValueChange={setSelectedWorkerId} value={selectedWorkerId}>
                      <SelectTrigger className="h-11"><SelectValue placeholder="พิมพ์เพื่อค้นหาลูกจ้างหน้างาน..." /></SelectTrigger>
                      <SelectContent>
                        {allWorkers?.map(w => (
                          <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName} ({w.workerCode})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="font-bold">เลือกงานที่มอบหมาย (Assignment)</Label>
                    <Select onValueChange={setSelectedAsgnId} value={selectedAsgnId} disabled={!selectedWorkerId}>
                      <SelectTrigger className="h-11"><SelectValue placeholder="เลือกงานโครงการที่คนงานกำลังทำ..." /></SelectTrigger>
                      <SelectContent>
                        {assignments?.map(a => (
                          <SelectItem key={a.id} value={a.id}>{a.projectName} ({a.deploymentStatus})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {activeAsgn && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-primary/5 rounded-lg border border-primary/10">
                    <div className="space-y-1">
                      <p className="text-[10px] text-muted-foreground uppercase font-black">ตำแหน่งงาน:</p>
                      <p className="text-sm font-bold text-primary flex items-center gap-2"><Briefcase className="h-3.5 w-3.5" /> {position?.positionNameTh}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] text-muted-foreground uppercase font-black">รอบการทำงาน (Wave):</p>
                      <p className="text-sm font-bold text-primary flex items-center gap-2"><Waves className="h-3.5 w-3.5" /> {wave?.waveCode || 'N/A'}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] text-muted-foreground uppercase font-black">ระยะเวลา:</p>
                      <p className="text-xs font-medium text-primary">{activeAsgn.startDate} ถึง {activeAsgn.endDate}</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {activeAsgn && (
              <Card className="shadow-md overflow-hidden">
                <CardHeader className="border-b bg-muted/20 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">รายการอุปกรณ์ที่อนุญาต (Authorized Items)</CardTitle>
                    <CardDescription>กรองเฉพาะรายการที่ตรงตามเกณฑ์ของตำแหน่ง <b>{position?.positionNameTh}</b></CardDescription>
                  </div>
                  <Badge variant="outline" className="bg-white">Requirement Items</Badge>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="p-4 border-b">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input placeholder="ค้นหาอุปกรณ์ในแคตตาล็อก..." className="pl-9 h-11" />
                    </div>
                  </div>
                  <div className="max-h-[400px] overflow-y-auto">
                    <Table>
                      <TableHeader className="bg-muted/50 sticky top-0 z-10">
                        <TableRow>
                          <TableHead className="font-bold">รหัส</TableHead>
                          <TableHead className="font-bold">ชื่ออุปกรณ์</TableHead>
                          <TableHead className="text-center font-bold">สต็อกคงเหลือ</TableHead>
                          <TableHead className="text-right pr-6">จัดการ</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {storeItems?.filter(i => {
                          const isPPE = posPPE.some(p => p.itemCode === i.itemCode || p.itemName === i.itemName);
                          const isTool = posTools.some(t => t.itemCode === i.itemCode || t.itemName === i.itemName);
                          return isPPE || isTool;
                        }).map(item => (
                          <TableRow key={item.id} className="hover:bg-muted/30 transition-colors">
                            <TableCell className="font-mono text-xs font-bold text-primary">{item.itemCode}</TableCell>
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="font-bold text-sm text-primary">{item.itemName}</span>
                                <span className="text-[10px] text-muted-foreground uppercase">{item.category}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-center">
                              <span className={`font-black ${item.currentStock <= item.minimumStock ? 'text-red-600' : 'text-green-700'}`}>
                                {item.currentStock} {item.unit}
                              </span>
                            </TableCell>
                            <TableCell className="text-right pr-6">
                              <Button 
                                size="sm" 
                                className="gap-1 h-8" 
                                disabled={item.currentStock <= 0}
                                onClick={() => handleAddToList(item)}
                              >
                                <Plus className="h-3 w-3" /> เพิ่มเข้าใบเบิก
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                        {storeItems?.filter(i => {
                          const isPPE = posPPE.some(p => p.itemCode === i.itemCode || p.itemName === i.itemName);
                          const isTool = posTools.some(t => t.itemCode === i.itemCode || t.itemName === i.itemName);
                          return isPPE || isTool;
                        }).length === 0 && (
                          <TableRow>
                            <TableCell colSpan={4} className="py-10 text-center text-muted-foreground italic">ไม่พบรายการที่ตรงกับความต้องการของตำแหน่งงาน</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}

            {issueMode === 'field' && activeAsgn && (
              <Card className="shadow-md overflow-hidden border-dashed border-blue-200">
                <CardHeader className="border-b bg-blue-50/50">
                  <CardTitle className="text-lg">แคตตาล็อกทั้งหมด (กรณีต้องการเพิ่มรายการ)</CardTitle>
                  <CardDescription>
                    หากรายการไม่อยู่ในลิสต์ตำแหน่งหรือต้องการเกินจำนวนที่กำหนด ระบบจะถามให้ไปแก้ไขที่เมนูตำแหน่ง → แท็บ <b>อุปกรณ์ (Tools)</b>
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="p-4 border-b">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="ค้นหารหัสหรือชื่ออุปกรณ์..."
                        className="pl-9 h-11"
                        value={catalogSearch}
                        onChange={(e) => setCatalogSearch(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="max-h-[320px] overflow-y-auto">
                    <Table>
                      <TableHeader className="bg-muted/50 sticky top-0 z-10">
                        <TableRow>
                          <TableHead className="font-bold">รหัส</TableHead>
                          <TableHead className="font-bold">ชื่ออุปกรณ์</TableHead>
                          <TableHead className="text-center font-bold">สต็อก</TableHead>
                          <TableHead className="text-right pr-6">จัดการ</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredCatalogForField.map((item) => (
                          <TableRow key={`cat-${item.id}`}>
                            <TableCell className="font-mono text-xs">{item.itemCode}</TableCell>
                            <TableCell className="text-sm font-medium">{item.itemName}</TableCell>
                            <TableCell className="text-center">{item.currentStock}</TableCell>
                            <TableCell className="text-right pr-6">
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={item.currentStock <= 0}
                                onClick={() => handleAddToList(item)}
                              >
                                <Plus className="h-3 w-3 mr-1" /> เพิ่ม
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}
            </>
            )}

            {issueMode === 'office' && (
              <Card className="shadow-md">
                <CardHeader className="border-b bg-muted/20">
                  <CardTitle className="text-lg">พนักงานออฟฟิศผู้รับ (Office Staff)</CardTitle>
                  <CardDescription>เลือกพนักงานแล้วเพิ่มรายการจากแคตตาล็อกทั้งหมวดด้านล่าง</CardDescription>
                </CardHeader>
                <CardContent className="pt-6 space-y-4">
                  <div className="space-y-2">
                    <Label className="font-bold">เลือกพนักงาน</Label>
                    <Select value={selectedOfficeStaffId} onValueChange={setSelectedOfficeStaffId}>
                      <SelectTrigger className="h-11">
                        <SelectValue placeholder="เลือกพนักงานออฟฟิศ..." />
                      </SelectTrigger>
                      <SelectContent>
                        {officeStaffList
                          ?.filter((s) => s.status === 'ACTIVE')
                          .map((s) => (
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
                        {filteredCatalogForField.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell className="font-mono text-xs">{item.itemCode}</TableCell>
                            <TableCell>{item.itemName}</TableCell>
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
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* RIGHT: Confirmation & Issue List */}
          <div className="space-y-6">
            <Card className="border-primary/20 shadow-xl overflow-hidden">
              <CardHeader className="bg-primary text-primary-foreground pb-6">
                <CardTitle className="text-xl flex items-center gap-3">
                  <FileText className="h-6 w-6" /> รายการเบิกของ (Issue List)
                </CardTitle>
                <CardDescription className="text-primary-foreground/70">ตรวจสอบรายการและยืนยันการตัดสต็อก</CardDescription>
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
                          <p className="text-xs font-black text-primary truncate flex-1">{item.itemName}</p>
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
                              onChange={e => {
                                const newList = [...issueList];
                                newList[idx].quantity = Math.max(1, parseInt(e.target.value) || 1);
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
                            onChange={e => {
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
                      onChange={e => setNotes(e.target.value)}
                      className="h-11"
                    />
                  </div>
                </div>
              </CardContent>
              <CardFooter className="bg-muted/30 border-t pt-6 flex flex-col gap-3">
                <Button 
                  className="w-full h-14 font-black text-lg bg-primary shadow-lg" 
                  disabled={
                    issueList.length === 0 ||
                    isSubmitting ||
                    (issueMode === 'field' && !activeAsgn) ||
                    (issueMode === 'office' && !selectedOfficeStaffId)
                  }
                  onClick={handleConfirmIssue}
                >
                  {isSubmitting ? <Loader2 className="h-6 w-6 animate-spin mr-2" /> : <CheckCircle2 className="h-6 w-6 mr-2" />}
                  ยืนยันการเบิก (Finalize Issue)
                </Button>
                <p className="text-[10px] text-center text-muted-foreground uppercase font-bold tracking-widest">
                  บันทึกโดย: {currentUser.displayName}
                </p>
              </CardFooter>
            </Card>
          </div>
        </div>
      </div>

      <AlertDialog open={positionEditDialogOpen} onOpenChange={setPositionEditDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>จะไปแก้ไขรายการเครื่องมือ/อุปกรณ์ในตำแหน่งนี้หรือไม่?</AlertDialogTitle>
            <AlertDialogDescription>
              {positionEditReason === 'not_listed'
                ? 'รายการนี้ไม่อยู่ในเกณฑ์ PPE/เครื่องมือที่กำหนดไว้ในตำแหน่ง — กรุณาเพิ่มรายการที่เมนูตำแหน่งงาน (แท็บ อุปกรณ์) ก่อนเบิก'
                : 'จำนวนที่ต้องการเบิกเกินกว่าที่กำหนดในรายการตำแหน่ง — กรุณาปรับเกณฑ์ที่เมนูตำแหน่งงาน (แท็บ อุปกรณ์) หรือลดจำนวนในใบเบิก'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (activeAsgn?.positionId) {
                  router.push(`/positions/${activeAsgn.positionId}?tab=tools`);
                }
              }}
            >
              ไปแก้ไขตำแหน่ง (แท็บอุปกรณ์)
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}