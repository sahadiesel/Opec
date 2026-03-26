'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Plus, 
  UserPlus, 
  Briefcase, 
  Search, 
  Filter, 
  ChevronRight, 
  Building2, 
  Calendar,
  Waves,
  AlertTriangle,
  Info,
  Loader2,
  ShieldAlert,
  UserX
} from 'lucide-react';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { Input } from '@/components/ui/input';
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue } from '@/lib/date-thai';
import { Assignment, Worker, POLine, User, DeploymentStatus, PurchaseOrder, Wave, Position, SalesContractTerm } from '@/lib/types';
import { resolveActiveSalesContractTerm } from '@/lib/services/contract-resolver';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';
import { collection, doc, increment, updateDoc, collectionGroup } from 'firebase/firestore';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription,
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { setDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';

export default function AssignmentsPage() {
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const isAuthorized = useMemo(
    () => !!currentUser && canView(currentUser, 'assignments'),
    [currentUser]
  );

  // Standardized to 'mobilizations' top-level collection
  const mobilizationQuery = useMemoFirebase(() => {
    if (!firestore || isUserLoading || userLoading || !firebaseUser || !isAuthorized) return null;
    return collection(firestore, 'mobilizations');
  }, [firestore, firebaseUser, isUserLoading, userLoading, isAuthorized]);

  const { data: assignments, isLoading: isAssignmentsLoading } = useCollection<Assignment>(mobilizationQuery as any);

  const wavesQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'waves') : null), [firestore, isAuthorized]);
  const { data: allWaves } = useCollection<Wave>(wavesQuery as any);

  // STRICT ENFORCEMENT: Only workers from 'workers' collection (Field Labor)
  const workersQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'workers') : null), [firestore, isAuthorized]);
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  const positionsQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'positions') : null), [firestore, isAuthorized]);
  const { data: allPositions } = useCollection<Position>(positionsQuery as any);

  const posQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'purchase_orders') : null), [firestore, isAuthorized]);
  const { data: allPOs } = useCollection<PurchaseOrder>(posQuery as any);

  const poLinesQuery = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return collectionGroup(firestore, 'po_lines');
  }, [firestore, isAuthorized]);
  const { data: allPOLines } = useCollection<POLine>(poLinesQuery as any);

  const salesTermsQuery = useMemoFirebase(
    () => (firestore && isAuthorized ? collection(firestore, 'sales_contract_terms') : null),
    [firestore, isAuthorized]
  );
  const { data: allSalesTerms } = useCollection<SalesContractTerm>(salesTermsQuery as any);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [selectedWaveId, setSelectedWaveId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');

  const handleCreateAssignment = async () => {
    if (!firestore || !currentUser || !selectedWorkerId || !selectedWaveId || !startDate || !endDate) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาระบุข้อมูลที่จำเป็นให้ครบถ้วน" });
      return;
    }

    const worker = allWorkers?.find(w => w.id === selectedWorkerId);
    const wave = allWaves?.find(w => w.id === selectedWaveId);
    if (!worker || !wave) return;

    // --- SUITABILITY VALIDATIONS ---
    
    // 1. Worker Status Check
    if (worker.workerStatus === 'BLACKLISTED') {
      toast({ variant: "destructive", title: "ไม่สามารถมอบหมายได้", description: "คนงานรายนี้อยู่ในบัญชีดำ (Blacklisted)" });
      return;
    }
    if (worker.workerStatus === 'INACTIVE') {
      toast({ variant: "destructive", title: "ไม่สามารถมอบหมายได้", description: "คนงานพ้นสภาพการจ้าง (Inactive)" });
      return;
    }

    // 2. Readiness Compliance Check
    if (worker.readinessStatus !== 'READY') {
      const policyHint =
        worker.readinessStatus === 'BLOCKED'
          ? `เอกสารเข้าเงื่อนไขบล็อกการ Assign (ใกล้หมดอายุใน ${worker.nearestExpiryInDays ?? '-'} วัน)`
          : `คนงานมีสถานะ ${worker.readinessStatus}`;
      toast({ 
        variant: "destructive", 
        title: "ความพร้อมไม่ผ่านเกณฑ์ (Not Ready)", 
        description: `${policyHint} กรุณาตรวจสอบเอกสาร/ใบเซอร์ก่อนมอบหมายงาน` 
      });
      return;
    }

    // Resolve Context from PO, PO Line and Position Matrix
    const po = allPOs?.find(p => p.id === wave.poId);
    if (po && (po.poType || 'contract') === 'quotation') {
      toast({
        variant: 'destructive',
        title: 'ไม่สามารถมอบหมายจาก PO สายใบเสนอราคา',
        description:
          'PO แบบใบเสนอราคาใช้สำหรับขายสินค้า/บริการครั้งเดียวจบ ไม่ผูก Wave/มอบหมายคนงาน — ใช้สายใบวางบิลหลังส่งมอบแทน',
      });
      return;
    }
    const poLine = allPOLines?.find(l => l.id === wave.poLineId);
    const targetPositionId = poLine?.positionId || wave.poLineId;
    const position = allPositions?.find(p => p.id === targetPositionId);
    const resolvedWorkMode = position?.jobMode || 'OFFSHORE';

    // 3. Position Suitability Check
    if (worker.currentPositionId !== targetPositionId) {
      const targetPosName = position?.positionNameTh || targetPositionId;
      const workerPosName = allPositions?.find(p => p.id === worker.currentPositionId)?.positionNameTh || worker.currentPositionId;
      toast({ 
        variant: "destructive", 
        title: "ตำแหน่งงานไม่ตรงกัน", 
        description: `คนงานมีตำแหน่ง ${workerPosName} แต่โครงการต้องการตำแหน่ง ${targetPosName}` 
      });
      return;
    }

    const termRes = resolveActiveSalesContractTerm(allSalesTerms || [], {
      poId: wave.poId,
      customerId: wave.customerId,
      date: startDate,
    });
    if (!termRes.isMatch || !termRes.data || termRes.data.purchaseOrderId !== wave.poId) {
      toast({
        variant: 'destructive',
        title: 'ยังไม่มีเงื่อนไขการขายสำหรับ PO นี้',
        description:
          'ต้องมี Sales Contract Term สถานะ ACTIVE ที่ผูกกับ PO นี้และคลุมวันเริ่มงาน ก่อนมอบหมาย (สร้างจากหน้า PO หรือเมนูเงื่อนไขการขาย)',
      });
      return;
    }
    const salesContractTermId = termRes.data.id;

    setIsCreating(true);
    try {
      // Atomic Number Generation
      const { code: finalNo } = await generateNextDocumentCode(firestore, 'assignment', { 
        actor: currentUser.displayName 
      });

      // Create in top-level 'mobilizations' collection
      const mobCollectionRef = collection(firestore, 'mobilizations');
      const newMobRef = doc(mobCollectionRef);
      
      const newAssignment: Assignment = {
        id: newMobRef.id,
        assignmentNo: finalNo, // Apply unique sequential code
        workerId: selectedWorkerId,
        poLineId: wave.poLineId,
        poId: wave.poId,
        salesContractTermId,
        contractId: po?.contractId || '',
        waveId: selectedWaveId,
        positionId: position?.id || poLine?.positionId || '', 
        customerId: wave.customerId,
        projectName: wave.projectName,
        startDate: startDate,
        endDate: endDate,
        deploymentStatus: 'DRAFT',
        clientApprovalStatus: 'NOT_SUBMITTED',
        readinessStatus: 'ready', // Worker was validated as ready before creation
        workMode: resolvedWorkMode,
        readinessSummary: {
          passportValid: 'pass',
          medicalValid: 'pass',
          certificatesComplete: 'pass',
          safetyTrainingComplete: 'pass',
          fitToWork: 'pass',
          ppeIssued: 'missing',
          toolsIssued: 'missing',
          overlapClear: 'pass',
          clientApproved: 'missing'
        },
        notes: notes,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      setDocumentNonBlocking(newMobRef, newAssignment, { merge: true });
      
      // Update wave assigned workers count
      const waveRef = doc(firestore, 'waves', selectedWaveId);
      updateDoc(waveRef, { assignedWorkers: increment(1), updatedAt: Date.now() });

      toast({ title: "มอบหมายงานสำเร็จ", description: `รหัสการมอบหมาย: ${finalNo}` });
      setIsDialogOpen(false);
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถบันทึกการมอบหมายได้" });
    } finally {
      setIsCreating(false);
    }
  };

  const getDeploymentStatusBadge = (status: DeploymentStatus) => {
    switch(status) {
      case 'DRAFT': return <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200 uppercase font-bold">Draft</Badge>;
      case 'READINESS_CHECK': return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 uppercase font-bold">Checking</Badge>;
      case 'READY_TO_MOB': return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 uppercase font-bold">Ready</Badge>;
      case 'MOBILIZING': return <Badge className="bg-blue-600 uppercase font-bold">Mobilizing</Badge>;
      case 'ACTIVE': return <Badge className="bg-green-600 uppercase font-bold">Active Duty</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isUserLoading || userLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <UserPlus className="h-8 w-8" /> การมอบหมายลูกจ้าง (Worker Assignments)
          </h1>
          <p className="text-muted-foreground text-lg">
            กำหนดรายชื่อ <b>ลูกจ้างหน้างาน (Field Workers)</b> เข้าสู่โครงการและรอบการทำงาน (Wave)
          </p>
        </div>

        {!isAuthorized ? (
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
            <Info className="h-12 w-12 text-muted-foreground opacity-50" />
            <h2 className="text-xl font-bold">Access Pending (รอนุมัติสิทธิ์)</h2>
            <p className="text-muted-foreground max-w-md">บัญชีของคุณยังไม่ได้รับการกำหนดบทบาท กรุณาติดต่อผู้ดูแลระบบ</p>
          </div>
        ) : (
          <>
            <Alert className="bg-amber-50 border-amber-200 text-amber-800 shadow-sm">
              <ShieldAlert className="h-5 w-5 text-amber-600" />
              <AlertTitle className="font-bold">นโยบายความเหมาะสม (Suitability Policy)</AlertTitle>
              <AlertDescription className="text-sm">
                ระบบจะตรวจสอบ <b>ตำแหน่งงาน (Position)</b> และ <b>สถานะความพร้อม (Readiness)</b> โดยอัตโนมัติ ห้ามมอบหมายคนงานที่มีสถานะไม่พร้อมหรือตำแหน่งไม่ตรงตามใบสั่งซื้อ
              </AlertDescription>
            </Alert>

            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
              <div className="flex items-center gap-3 flex-1">
                <div className="relative w-full max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="ค้นหาตามลูกจ้าง, Wave หรือรหัส PO..." className="pl-9 h-11" />
                </div>
                <Button variant="outline" className="gap-2 h-11"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
              </div>
              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="gap-2 h-11 px-6 bg-primary shadow-md text-base font-bold">
                    <Plus className="h-5 w-5" /> สร้างการมอบหมายใหม่ (Field Assignment)
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>มอบหมายงาน (Field Crew Assignment)</DialogTitle>
                    <DialogDescription>เลือกคนงานหน้างานและเชื่อมต่อเข้ากับรอบการทำงาน (Wave) ของโครงการ</DialogDescription>
                  </DialogHeader>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                    <div className="space-y-2 md:col-span-2">
                      <Label className="font-bold">เลือกรอบการทำงาน (Active Wave)</Label>
                      <Select onValueChange={setSelectedWaveId}>
                        <SelectTrigger className="h-11"><SelectValue placeholder="เลือก Wave ที่เปิดให้มอบหมาย..." /></SelectTrigger>
                        <SelectContent>
                          {allWaves?.filter(w => w.status !== 'CLOSED').map(wave => (
                            <SelectItem key={wave.id} value={wave.id}>{wave.waveCode} | {wave.projectName}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label className="font-bold">เลือกคนงานหน้างาน (Select Field Worker)</Label>
                      <Select onValueChange={setSelectedWorkerId}>
                        <SelectTrigger className="h-11"><SelectValue placeholder="ค้นหาคนงานที่พร้อม (Ready)..." /></SelectTrigger>
                        <SelectContent>
                          {allWorkers?.filter(w => w.readinessStatus === 'READY').map(w => (
                            <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName} ({w.workerCode})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[10px] text-muted-foreground italic">* แสดงเฉพาะคนงานที่มีสถานะ READY เท่านั้น</p>
                    </div>
                    <div className="space-y-2">
                      <Label className="font-bold">วันที่เริ่มงาน (Start Date)</Label>
                      <DatePickerThaiBE
                        className="h-11"
                        value={htmlDateValueToTimestampMs(startDate)}
                        onChange={(ms) => setStartDate(timestampToHtmlDateValue(ms))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="font-bold">วันที่สิ้นสุดงาน (End Date)</Label>
                      <DatePickerThaiBE
                        className="h-11"
                        value={htmlDateValueToTimestampMs(endDate)}
                        onChange={(ms) => setEndDate(timestampToHtmlDateValue(ms))}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isCreating}>ยกเลิก</Button>
                    <Button onClick={handleCreateAssignment} className="bg-primary font-bold" disabled={isCreating}>
                      {isCreating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      ยืนยันการมอบหมาย (Confirm)
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            <Card className="shadow-lg border-none overflow-hidden">
              <CardContent className="p-0">
                {isAssignmentsLoading ? (
                  <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลการมอบหมาย...</div>
                ) : (
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="font-bold py-4 pl-6">เลขที่ / ลูกจ้างหน้างาน</TableHead>
                        <TableHead className="font-bold">Wave & โครงการ</TableHead>
                        <TableHead className="font-bold">ช่วงเวลา (Schedule)</TableHead>
                        <TableHead className="font-bold">ความพร้อม (Readiness)</TableHead>
                        <TableHead className="font-bold">สถานะ Deployment</TableHead>
                        <TableHead className="text-right pr-6">จัดการ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {assignments?.map((asgn) => {
                        const worker = allWorkers?.find(w => w.id === asgn.workerId);
                        const wave = allWaves?.find(w => w.id === asgn.waveId);
                        
                        return (
                          <TableRow key={asgn.id} className="cursor-pointer hover:bg-muted/30 group transition-all" onClick={() => router.push(`/assignments/${asgn.id}`)}>
                            <TableCell className="py-4 pl-6">
                              <div className="flex flex-col">
                                <span className="text-[10px] font-mono font-bold text-primary mb-1">{asgn.assignmentNo || asgn.id.substring(0,8)}</span>
                                <span className="font-bold text-base text-primary">{worker?.firstName} {worker?.lastName}</span>
                                <span className="text-xs text-muted-foreground flex items-center gap-1 font-medium"><Briefcase className="h-3 w-3" /> {asgn.positionId}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="font-bold text-sm text-primary flex items-center gap-1"><Waves className="h-3.5 w-3.5" /> {wave?.waveCode || 'N/A'}</span>
                                <span className="text-[10px] text-muted-foreground font-mono uppercase truncate max-w-[150px]">{asgn.projectName}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-bold">
                                <Calendar className="h-3.5 w-3.5" />
                                {asgn.startDate} - {asgn.endDate}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant={asgn.readinessStatus === 'ready' ? 'default' : 'outline'} className={asgn.readinessStatus === 'ready' ? 'bg-green-600' : 'text-amber-600 border-amber-200'}>
                                {asgn.readinessStatus.toUpperCase()}
                              </Badge>
                            </TableCell>
                            <TableCell>{getDeploymentStatusBadge(asgn.deploymentStatus)}</TableCell>
                            <TableCell className="text-right pr-6">
                              <Button variant="ghost" size="icon" className="group-hover:text-primary"><ChevronRight className="h-5 w-5" /></Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
