'use client';

import { useState, useEffect } from 'react';
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
import { useFirestore, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { collection, doc, query, where, getDocs, updateDoc, increment, writeBatch } from 'firebase/firestore';
import { StoreItem, Worker, Assignment, Wave, Position, User as AppUser, PositionPPERequirement, PositionToolRequirement } from '@/lib/types';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';

export default function IssueItemsPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const firestore = useFirestore();
  const { toast } = useToast();

  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [selectedAsgnId, setSelectedAsgnId] = useState('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [issueList, setIssueList] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  // STRICT ENFORCEMENT: Only workers from 'workers' collection (Field Labor)
  const workersQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'workers') : null), [firestore]);
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  const asgnQuery = useMemoFirebase(() => {
    if (!firestore || !selectedWorkerId) return null;
    return query(collection(firestore, 'mobilizations'), where('workerId', '==', selectedWorkerId), where('deploymentStatus', '!=', 'CLOSED'));
  }, [firestore, selectedWorkerId]);
  const { data: assignments } = useCollection<Assignment>(asgnQuery as any);

  const activeAsgn = assignments?.find(a => a.id === selectedAsgnId);
  
  const waveRef = useMemoFirebase(() => (firestore && activeAsgn ? doc(firestore, 'waves', activeAsgn.waveId) : null), [firestore, activeAsgn?.waveId]);
  const { data: wave } = useDoc<Wave>(waveRef as any);

  const posRef = useMemoFirebase(() => (firestore && activeAsgn ? doc(firestore, 'positions', activeAsgn.positionId) : null), [firestore, activeAsgn?.positionId]);
  const { data: position } = useDoc<Position>(posRef as any);

  const itemsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'store_items') : null), [firestore]);
  const { data: storeItems } = useCollection<StoreItem>(itemsQuery as any);

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

  const handleAddToList = (item: StoreItem) => {
    // RULE: Check Position Requirement
    const isAllowedPPE = posPPE.some(p => p.itemCode === item.itemCode || p.itemName === item.itemName);
    const isAllowedTool = posTools.some(t => t.itemCode === item.itemCode || t.itemName === item.itemName);

    if (!isAllowedPPE && !isAllowedTool) {
      toast({ 
        variant: "destructive", 
        title: "ไม่อนุญาตให้เบิก (Unauthorized Item)", 
        description: `อุปกรณ์รายการนี้ไม่ได้กำหนดไว้ในมาตรฐานของตำแหน่ง ${position?.positionName || 'N/A'}` 
      });
      return;
    }

    if (item.currentStock <= 0) {
      toast({ variant: "destructive", title: "สินค้าหมด (Out of Stock)", description: "ไม่สามารถเบิกได้เนื่องจากสต็อกคงเหลือเป็นศูนย์" });
      return;
    }

    if (issueList.some(i => i.itemId === item.id)) return;

    setIssueList([...issueList, {
      itemId: item.id,
      itemCode: item.itemCode,
      itemName: item.itemName,
      quantity: 1,
      unit: item.unit,
      remarks: ''
    }]);
  };

  const handleConfirmIssue = async () => {
    if (!firestore || !activeAsgn || !currentUser || issueList.length === 0) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาระบุคนงาน งาน และรายการที่ต้องการเบิกให้ครบถ้วน" });
      return;
    }

    setIsSubmitting(true);

    try {
      // Atomic Sequence Generation
      const { code: finalNo } = await generateNextDocumentCode(firestore, 'store_issue', { actor: currentUser.displayName });

      const batch = writeBatch(firestore);
      const issueSlipsRef = collection(firestore, 'store_issue_slips');
      const newIssueRef = doc(issueSlipsRef);

      // 1. Create Header
      const headerData = {
        id: newIssueRef.id,
        issueNo: finalNo,
        workerId: selectedWorkerId,
        assignmentId: activeAsgn.id,
        waveId: activeAsgn.waveId,
        positionId: activeAsgn.positionId,
        issueDate,
        status: 'completed',
        notes,
        createdAt: Date.now(),
        createdBy: currentUser.displayName
      };
      batch.set(newIssueRef, headerData);

      // 2. Process Items
      const itemsSubRef = collection(newIssueRef, 'items');
      for (const item of issueList) {
        const itemDocRef = doc(itemsSubRef);
        batch.set(itemDocRef, {
          itemId: item.itemId,
          itemName: item.itemName,
          quantity: item.quantity,
          unit: item.unit,
          remarks: item.remarks
        });

        // Update Master Stock
        const masterItemRef = doc(firestore, 'store_items', item.itemId);
        batch.update(masterItemRef, { currentStock: increment(-item.quantity) });

        // Log Transaction
        const txRef = doc(collection(firestore, 'store_transactions'));
        batch.set(txRef, {
          itemId: item.itemId,
          transactionType: 'ISSUE',
          quantity: item.quantity,
          workerId: selectedWorkerId,
          assignmentId: activeAsgn.id,
          waveId: activeAsgn.waveId,
          transactionDate: issueDate,
          notes: `Ref Slip: ${finalNo}. ${item.remarks}`,
          createdAt: Date.now(),
          createdBy: currentUser.displayName
        });
      }

      await batch.commit();

      toast({ title: "บันทึกการเบิกสำเร็จ", description: `เลขที่ใบเบิก: ${finalNo}` });
      router.push('/store');
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถบันทึกรายการได้" });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-[1600px] mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild><Link href="/store"><ArrowLeft className="h-5 w-5" /></Link></Button>
          <div className="flex-1">
            <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
              <PackageMinus className="h-8 w-8 text-orange-600" /> เบิกอุปกรณ์ให้ลูกจ้างหน้างาน (Issue to Field Worker)
            </h1>
            <p className="text-muted-foreground text-lg">ใช้สำหรับเบิก PPE หรือเครื่องมือให้ <b>ลูกจ้างหน้างาน (Field Workforce)</b> โดยต้องผูกกับ Assignment และ Wave</p>
          </div>
        </div>

        <Alert className="bg-amber-50 border-amber-200 text-amber-800 shadow-sm">
          <ShieldAlert className="h-5 w-5 text-amber-600" />
          <AlertTitle className="font-bold uppercase tracking-wider">นโยบายการเบิกจ่ายพัสดุ (Field Issue Policy)</AlertTitle>
          <AlertDescription className="text-sm">
            ระบบอนุญาตให้เบิกพัสดุให้เฉพาะผู้ที่มีรายชื่อในฐานข้อมูล <b>ลูกจ้างหน้างาน (Field Workers)</b> เท่านั้น พนักงานบริษัท (Office Staff) ไม่ได้รับอนุญาตให้ใช้ใบเบิกในหมวดนี้
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* LEFT: Context & Catalog */}
          <div className="lg:col-span-2 space-y-6">
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
                      <p className="text-sm font-bold text-primary flex items-center gap-2"><Briefcase className="h-3.5 w-3.5" /> {position?.positionName}</p>
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
                    <CardDescription>กรองเฉพาะรายการที่ตรงตามเกณฑ์ของตำแหน่ง <b>{position?.positionName}</b></CardDescription>
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
                    <Input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} className="h-11" />
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
                  disabled={issueList.length === 0 || !activeAsgn || isSubmitting}
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
    </AppShell>
  );
}