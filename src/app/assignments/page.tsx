'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
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
  ShieldCheck,
  Truck,
  Waves,
  AlertTriangle,
  Info
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Assignment, Worker, POLine, User, DeploymentStatus, ClientApprovalStatus, PurchaseOrder, Wave, Position } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collectionGroup, collection, doc, query, where, increment, updateDoc } from 'firebase/firestore';
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

export default function AssignmentsPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const assignmentsQuery = useMemoFirebase(() => {
    if (!firestore || isUserLoading || !firebaseUser) return null;
    return collectionGroup(firestore, 'assignments');
  }, [firestore, firebaseUser, isUserLoading]);

  const { data: assignments, isLoading: isAssignmentsLoading } = useCollection<Assignment>(assignmentsQuery as any);

  const wavesQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'waves') : null), [firestore]);
  const { data: allWaves } = useCollection<Wave>(wavesQuery as any);

  const workersQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'workers') : null), [firestore]);
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  const poLinesQuery = useMemoFirebase(() => (firestore ? collectionGroup(firestore, 'po_lines') : null), [firestore]);
  const { data: allPOLines } = useCollection<POLine>(poLinesQuery as any);

  const poQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'purchase_orders') : null), [firestore]);
  const { data: allPOs } = useCollection<PurchaseOrder>(poQuery as any);

  const positionsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'positions') : null), [firestore]);
  const { data: allPositions } = useCollection<Position>(positionsQuery as any);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [selectedWaveId, setSelectedWaveId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');

  const handleCreateAssignment = async () => {
    if (!firestore || !selectedWorkerId || !selectedWaveId || !startDate || !endDate) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาระบุข้อมูลที่จำเป็นให้ครบถ้วน" });
      return;
    }

    const wave = allWaves?.find(w => w.id === selectedWaveId);
    if (!wave) return;

    const poLine = allPOLines?.find(l => l.id === wave.poLineId);
    if (!poLine || !poLine._path) return;

    const po = allPOs?.find(p => p.id === poLine.poId);
    if (!po) return;

    const assignmentsCollectionRef = collection(firestore, poLine._path, 'assignments');
    const newAssignmentRef = doc(assignmentsCollectionRef);
    
    const newAssignment: Assignment = {
      id: newAssignmentRef.id,
      workerId: selectedWorkerId,
      poLineId: poLine.id,
      poId: po.id,
      contractId: po.contractId,
      waveId: selectedWaveId,
      positionId: poLine.positionId,
      customerId: po.customerId,
      projectName: po.projectName || po.title,
      startDate: startDate,
      endDate: endDate,
      deploymentStatus: 'DRAFT',
      clientApprovalStatus: 'NOT_SUBMITTED',
      readinessStatus: 'incomplete',
      readinessSummary: {
        passportValid: 'missing',
        medicalValid: 'missing',
        certificatesComplete: 'missing',
        safetyTrainingComplete: 'missing',
        fitToWork: 'missing',
        ppeIssued: 'missing',
        toolsIssued: 'missing',
        overlapClear: 'missing',
        clientApproved: 'missing'
      },
      notes: notes,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    setDocumentNonBlocking(newAssignmentRef, newAssignment, { merge: true });
    
    // Update wave assignedWorkers count
    const waveRef = doc(firestore, 'waves', selectedWaveId);
    updateDoc(waveRef, { assignedWorkers: increment(1), updatedAt: Date.now() });

    toast({ title: "มอบหมายงานสำเร็จ", description: `คนงานถูกเพิ่มเข้าสู่ Wave เรียบร้อยแล้ว` });
    setIsDialogOpen(false);
  };

  const getDeploymentStatusBadge = (status: DeploymentStatus) => {
    switch(status) {
      case 'DRAFT': return <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200 uppercase font-bold">Draft</Badge>;
      case 'READINESS_CHECK': return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 uppercase font-bold">Checking</Badge>;
      case 'READY': return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 uppercase font-bold">Ready</Badge>;
      case 'MOBILIZING': return <Badge className="bg-blue-600 uppercase font-bold">Mobilizing</Badge>;
      case 'ACTIVE': return <Badge className="bg-green-600 uppercase font-bold">Active Duty</Badge>;
      case 'DEMOBILIZED': return <Badge variant="secondary" className="uppercase font-bold">Demob</Badge>;
      case 'CLOSED': return <Badge variant="secondary" className="uppercase font-bold">Closed</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isUserLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        {/* Page Header */}
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <UserPlus className="h-8 w-8" /> การมอบหมายงาน (Assignments)
          </h1>
          <p className="text-muted-foreground text-lg">
            ใช้กำหนดว่า worker คนใดจะไปทำงานในตำแหน่งใด ภายใต้ Customer PO และ Wave ใด ระบบจะตรวจสอบความพร้อมก่อนอนุญาตให้ mobilize
          </p>
        </div>

        {/* Compliance Warning Box */}
        <Alert className="bg-amber-50 border-amber-200 text-amber-800 shadow-sm">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          <AlertTitle className="font-bold text-lg text-amber-900">ระเบียบความพร้อมนอกชายฝั่ง (Offshore Readiness Policy)</AlertTitle>
          <AlertDescription className="text-sm">
            Worker จะไม่สามารถ Mobilize ได้ หาก passport, medical, certificate, PPE หรือเครื่องมือยังไม่พร้อมตามเกณฑ์ที่กำหนดใน Readiness Checklist
          </AlertDescription>
        </Alert>

        {/* Action Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="ค้นหาตามคนงาน, Wave หรือรหัส PO..." className="pl-9 h-11" />
            </div>
            <Button variant="outline" className="gap-2 h-11"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 h-11 px-6 bg-primary shadow-md text-base font-bold">
                <Plus className="h-5 w-5" /> สร้างการมอบหมายใหม่ (New Assignment)
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>สร้างการมอบหมายงาน (New Deployment Entry)</DialogTitle>
                <DialogDescription>เลือกคนงานและเชื่อมต่อเข้ากับรอบการทำงาน (Wave) ของโครงการ</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                <div className="space-y-2 md:col-span-2">
                  <Label>เลือกรอบการทำงาน (Active Wave)</Label>
                  <Select onValueChange={setSelectedWaveId}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="เลือก Wave ที่เปิดให้มอบหมาย..." /></SelectTrigger>
                    <SelectContent>
                      {allWaves?.filter(w => w.status !== 'CLOSED').map(wave => {
                        const po = allPOs?.find(p => p.id === wave.poId);
                        return <SelectItem key={wave.id} value={wave.id}>{wave.waveCode} | {wave.projectName} ({po?.poCode})</SelectItem>;
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>เลือกคนงานที่มีความพร้อม (Worker - Ready/Available)</Label>
                  <Select onValueChange={setSelectedWorkerId}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="ค้นหาคนงาน..." /></SelectTrigger>
                    <SelectContent>
                      {allWorkers?.map(w => (
                        <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName} ({w.readinessStatus})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>วันที่เริ่มงาน (Start Date)</Label>
                  <Input type="date" className="h-11" value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>วันที่สิ้นสุด (End Date)</Label>
                  <Input type="date" className="h-11" value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>ยกเลิก</Button>
                <Button onClick={handleCreateAssignment} className="bg-primary font-bold">ยืนยันการมอบหมาย (Confirm)</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Table Content */}
        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isAssignmentsLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลการมอบหมาย...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4">คนงาน & ตำแหน่ง</TableHead>
                    <TableHead className="font-bold">Wave & โครงการ</TableHead>
                    <TableHead className="font-bold">ช่วงเวลา (Schedule)</TableHead>
                    <TableHead className="font-bold">ความพร้อม (Readiness)</TableHead>
                    <TableHead className="font-bold">การพิจารณา (Client)</TableHead>
                    <TableHead className="font-bold">สถานะ Deployment</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assignments?.map((asgn) => {
                    const worker = allWorkers?.find(w => w.id === asgn.workerId);
                    const pos = allPositions?.find(p => p.id === asgn.positionId);
                    const wave = allWaves?.find(w => w.id === asgn.waveId);
                    
                    return (
                      <TableRow key={asgn.id} className="cursor-pointer hover:bg-muted/30 group transition-all" onClick={() => router.push(`/assignments/${asgn.id}`)}>
                        <TableCell className="py-4">
                          <div className="flex flex-col">
                            <span className="font-bold text-base text-primary">{worker?.firstName} {worker?.lastName}</span>
                            <span className="text-xs text-muted-foreground flex items-center gap-1 font-medium"><Briefcase className="h-3 w-3" /> {pos?.positionName}</span>
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
                        <TableCell>
                          <Badge variant="outline" className={asgn.clientApprovalStatus === 'APPROVED' ? 'text-green-600 border-green-200 bg-green-50/50' : 'font-medium'}>
                            {asgn.clientApprovalStatus.replace('_', ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell>{getDeploymentStatusBadge(asgn.deploymentStatus)}</TableCell>
                        <TableCell className="text-right pr-6">
                          <Button variant="ghost" size="icon" className="group-hover:text-primary"><ChevronRight className="h-5 w-5" /></Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {(!assignments || assignments.length === 0) && !isAssignmentsLoading && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-20 text-muted-foreground italic">ไม่มีรายการการมอบหมายงานในขณะนี้</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Workflow Guidance */}
        <Card className="bg-primary/5 border-primary/10 border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2 text-primary font-bold">
              <Info className="h-5 w-5" /> แนวทางปฏิบัติ (Workflow Guidance)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="flex items-start gap-3 p-4 bg-white rounded-md border shadow-sm">
                <div className="bg-blue-100 p-2 rounded text-blue-700 font-bold">1</div>
                <div>
                  <p className="font-bold">ตรวจสอบความพร้อม (Readiness Check)</p>
                  <p className="text-muted-foreground text-xs">หลังการมอบหมาย ต้องตรวจสอบใบเซอร์และผลตรวจร่างกายรายบุคคลให้ครบถ้วนในหน้ารายละเอียด</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 bg-white rounded-md border shadow-sm">
                <div className="bg-green-100 p-2 rounded text-green-700 font-bold">2</div>
                <div>
                  <p className="font-bold">เตรียมส่งตัว (Mobilization)</p>
                  <p className="text-muted-foreground text-xs">เมื่อคนงานผ่าน Readiness Check และได้รับอนุมัติจากลูกค้า จึงจะเริ่มกระบวนการระดมพลได้</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
