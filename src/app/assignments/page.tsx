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
  Send, 
  Clock, 
  CheckCircle2, 
  Search, 
  Filter, 
  ChevronRight, 
  Building2, 
  Calendar,
  AlertTriangle,
  Info,
  ArrowRight
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Assignment, Worker, POLine, User, AssignmentStatus, ClientApprovalStatus, PurchaseOrder, Customer, Position } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collectionGroup, collection, doc, query, where } from 'firebase/firestore';
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
import { Textarea } from '@/components/ui/textarea';

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
  const [selectedPOLineId, setSelectedPOLineId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');

  const handleCreateAssignment = async () => {
    if (!firestore || !selectedWorkerId || !selectedPOLineId || !startDate || !endDate) return;

    const poLine = allPOLines?.find(l => l.id === selectedPOLineId);
    if (!poLine || !poLine._path) return;

    const po = allPOs?.find(p => p.id === poLine.poId);
    if (!po) return;

    const assignmentsCollectionRef = collection(firestore, poLine._path, 'assignments');
    const newAssignmentRef = doc(assignmentsCollectionRef);
    
    const newAssignment: Assignment = {
      id: newAssignmentRef.id,
      workerId: selectedWorkerId,
      poLineId: selectedPOLineId,
      poId: po.id,
      positionId: poLine.positionId,
      customerId: po.customerId,
      projectName: po.projectName || po.title,
      startDate: new Date(startDate).getTime(),
      endDate: new Date(endDate).getTime(),
      status: 'proposed',
      clientApprovalStatus: 'pending',
      notes: notes,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    setDocumentNonBlocking(newAssignmentRef, newAssignment, { merge: true });
    toast({ title: "มอบหมายงานสำเร็จ", description: `ส่งตัวเข้าสู่โครงการเรียบร้อยแล้ว` });
    setIsDialogOpen(false);
  };

  const getStatusBadge = (status: AssignmentStatus) => {
    switch(status) {
      case 'proposed': return <Badge variant="outline">Proposed</Badge>;
      case 'client_review': return <Badge variant="outline" className="bg-blue-50 text-blue-700">Reviewing</Badge>;
      case 'active': return <Badge className="bg-green-600">Active</Badge>;
      case 'mobilizing': return <Badge variant="secondary" className="bg-amber-100 text-amber-700">Mobilizing</Badge>;
      case 'cancelled': return <Badge variant="destructive">Cancelled</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isUserLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        {/* 1. Header & Description */}
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <UserPlus className="h-8 w-8" /> การมอบหมายงาน (Assignments Management)
          </h1>
          <p className="text-muted-foreground text-lg">
            เชื่อมโยงคนงานเข้ากับโครงการของลูกค้า จัดการกระบวนการ Mobilization และติดตามการอนุมัติรายบุคคล
          </p>
        </div>

        {/* 2. Warning / Important Notice */}
        <Alert className="bg-amber-50 border-amber-200 text-amber-800">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertTitle className="font-bold">เงื่อนไขการมอบหมาย (Assignment Policy)</AlertTitle>
          <AlertDescription>
            ห้ามมอบหมายคนงานที่มีงานทับซ้อนในช่วงเวลาเดียวกัน และคนงานต้องผ่านการตรวจร่างกาย (Medical Check) ให้เรียบร้อยก่อนเริ่มงานจริง
          </AlertDescription>
        </Alert>

        {/* 3. Action Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="ค้นหาชื่อคนงานหรือโครงการ..." className="pl-9" />
            </div>
            <Button variant="outline" size="icon"><Filter className="h-4 w-4" /></Button>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 h-11 px-6 bg-primary shadow-md">
                <Plus className="h-5 w-5" /> สร้างการมอบหมายใหม่ (New Assignment)
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>สร้างการมอบหมาย (New Assignment)</DialogTitle>
                <DialogDescription>เลือกคนงานและเชื่อมต่อเข้ากับโควต้าตำแหน่งงานใน Customer PO</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                <div className="space-y-2 md:col-span-2">
                  <Label>เลือกโควต้าตำแหน่ง (Customer PO Line)</Label>
                  <Select onValueChange={setSelectedPOLineId}>
                    <SelectTrigger><SelectValue placeholder="เลือกรายการโควต้า..." /></SelectTrigger>
                    <SelectContent>
                      {allPOLines?.map(line => {
                        const po = allPOs?.find(p => p.id === line.poId);
                        const pos = allPositions?.find(p => p.id === line.positionId);
                        return <SelectItem key={line.id} value={line.id}>{po?.poCode} | {pos?.positionName}</SelectItem>;
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>คนงาน (Worker Name)</Label>
                  <Select onValueChange={setSelectedWorkerId}>
                    <SelectTrigger><SelectValue placeholder="เลือกคนงาน..." /></SelectTrigger>
                    <SelectContent>
                      {allWorkers?.map(w => <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName} ({w.readinessStatus})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>วันที่เริ่มงาน (Start Date)</Label>
                  <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>วันที่สิ้นสุด (End Date)</Label>
                  <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>ยกเลิก</Button>
                <Button onClick={handleCreateAssignment} className="bg-primary">ยืนยันการมอบหมาย (Confirm)</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* 4. Data Content */}
        <Card className="shadow-lg">
          <CardContent className="p-0">
            {isAssignmentsLoading ? (
              <div className="py-20 text-center text-muted-foreground italic">กำลังโหลดข้อมูลการมอบหมาย...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold">คนงาน & ตำแหน่ง (Staff & Position)</TableHead>
                    <TableHead className="font-bold">โครงการ (Project Context)</TableHead>
                    <TableHead className="font-bold">ช่วงเวลา (Schedule)</TableHead>
                    <TableHead className="font-bold">สถานะงาน</TableHead>
                    <TableHead className="font-bold">สถานะอนุมัติ</TableHead>
                    <TableHead className="text-right">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assignments?.map((asgn) => {
                    const worker = allWorkers?.find(w => w.id === asgn.workerId);
                    const pos = allPositions?.find(p => p.id === asgn.positionId);
                    return (
                      <TableRow key={asgn.id} className="cursor-pointer hover:bg-muted/30 group" onClick={() => router.push(`/assignments/${asgn.id}`)}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-bold text-base">{worker?.firstName} {worker?.lastName}</span>
                            <span className="text-xs text-primary flex items-center gap-1 font-medium"><Briefcase className="h-3 w-3" /> {pos?.positionName}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-semibold text-xs">{asgn.projectName}</span>
                            <span className="text-[10px] text-muted-foreground font-mono">PO: {asgn.poId.substring(0,8)}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {new Date(asgn.startDate).toLocaleDateString('th-TH')} - {new Date(asgn.endDate).toLocaleDateString('th-TH')}
                          </div>
                        </TableCell>
                        <TableCell>{getStatusBadge(asgn.status)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={asgn.clientApprovalStatus === 'approved' ? 'text-green-600 border-green-200' : ''}>
                            {asgn.clientApprovalStatus.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon"><ChevronRight className="h-5 w-5" /></Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* 5. Next-Step Guidance */}
        <Card className="bg-primary/5 border-primary/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Info className="h-5 w-5 text-primary" /> ขั้นตอนถัดไป (Next Steps)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="flex items-start gap-3 p-3 bg-white rounded-md border shadow-sm">
                <div className="bg-blue-100 p-2 rounded text-blue-700"><Send className="h-4 w-4" /></div>
                <div>
                  <p className="font-bold">ส่งให้ลูกค้าพิจารณา (Client Review)</p>
                  <p className="text-muted-foreground text-xs">หลังมอบหมาย ต้องเปลี่ยนสถานะเป็น Client Review เพื่อให้ลูกค้าเห็นใน Portal</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-white rounded-md border shadow-sm">
                <div className="bg-amber-100 p-2 rounded text-amber-700"><Clock className="h-4 w-4" /></div>
                <div>
                  <p className="font-bold">เริ่มขั้นตอนระดมพล (Mobilization)</p>
                  <p className="text-muted-foreground text-xs">เมื่อได้รับอนุมัติ ให้ดำเนินการจัดเตรียมชุด PPE และอุปกรณ์ก่อนส่งเข้าหน้างาน</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}