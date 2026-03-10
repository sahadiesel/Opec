'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, UserPlus, MoreHorizontal, Briefcase, Send, Clock, CheckCircle2, Search, Filter, ChevronRight, Building2, Calendar } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Assignment, Worker, POLine, User, AssignmentStatus, ClientApprovalStatus, PurchaseOrder, Customer, Position } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collectionGroup, collection, doc, query, where } from 'firebase/firestore';
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
import { setDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
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
    if (stored) {
      try {
        setCurrentUser(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to parse user session', e);
      }
    }
  }, []);

  // Queries
  const assignmentsQuery = useMemoFirebase(() => {
    if (!firestore || isUserLoading || !firebaseUser) return null;
    return collectionGroup(firestore, 'assignments');
  }, [firestore, firebaseUser, isUserLoading]);

  const { data: assignments, isLoading: isAssignmentsLoading } = useCollection<Assignment>(assignmentsQuery as any);

  const workersQuery = useMemoFirebase(() => {
    if (!firestore || !firebaseUser) return null;
    return collection(firestore, 'workers');
  }, [firestore, firebaseUser]);
  
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  const poLinesQuery = useMemoFirebase(() => {
    if (!firestore || !firebaseUser) return null;
    return collectionGroup(firestore, 'po_lines');
  }, [firestore, firebaseUser]);
  
  const { data: allPOLines } = useCollection<POLine>(poLinesQuery as any);

  const customerPOsQuery = useMemoFirebase(() => {
    if (!firestore || !firebaseUser) return null;
    return collection(firestore, 'purchase_orders');
  }, [firestore, firebaseUser]);
  const { data: allPOs } = useCollection<PurchaseOrder>(customerPOsQuery as any);

  const customersQuery = useMemoFirebase(() => {
    if (!firestore || !firebaseUser) return null;
    return collection(firestore, 'customers');
  }, [firestore, firebaseUser]);
  const { data: allCustomers } = useCollection<Customer>(customersQuery as any);

  const positionsQuery = useMemoFirebase(() => {
    if (!firestore || !firebaseUser) return null;
    return collection(firestore, 'positions');
  }, [firestore, firebaseUser]);
  const { data: allPositions } = useCollection<Position>(positionsQuery as any);

  // Form State
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [selectedPOLineId, setSelectedPOLineId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');

  const handleCreateAssignment = async () => {
    if (!firestore || !selectedWorkerId || !selectedPOLineId || !startDate || !endDate) return;

    const poLine = allPOLines?.find(l => l.id === selectedPOLineId);
    if (!poLine || !poLine._path) {
      toast({ variant: "destructive", title: "Error", description: "ไม่พบข้อมูลรายการสั่งจอง" });
      return;
    }

    const po = allPOs?.find(p => p.id === poLine.poId);
    const worker = allWorkers?.find(w => w.id === selectedWorkerId);

    if (!po || !worker) return;

    // Validation: Quota check
    const existingCount = assignments?.filter(a => 
      a.poLineId === selectedPOLineId && 
      ['approved', 'active', 'mobilizing', 'proposed', 'client_review'].includes(a.status)
    ).length || 0;

    if (existingCount >= poLine.quantity) {
      toast({
        variant: "destructive",
        title: "โควต้าเต็ม (Quota Full)",
        description: `โควต้าของตำแหน่งนี้คือ ${poLine.quantity} ซึ่งมีการจองเต็มแล้ว`,
      });
      return;
    }

    // Validation: Overlap check (Warn only for now)
    const hasOverlap = assignments?.some(a => 
      a.workerId === selectedWorkerId && 
      ['active', 'mobilizing'].includes(a.status) &&
      !(new Date(startDate).getTime() > a.endDate || new Date(endDate).getTime() < a.startDate)
    );

    if (hasOverlap) {
      if (!confirm('คนงานรายนี้มีการมอบหมายงานที่ซ้อนทับช่วงเวลากันอยู่ ยืนยันการมอบหมายเพิ่มหรือไม่?')) return;
    }

    // Hierarchical path: purchase_orders/{poId}/po_lines/{lineId}/assignments/{asgnId}
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
    
    toast({
      title: "มอบหมายงานสำเร็จ",
      description: `เสนอตัว ${worker.firstName} เข้าสู่โครงการ ${po.projectName || po.title}`,
    });
    
    setIsDialogOpen(false);
    resetForm();
  };

  const resetForm = () => {
    setSelectedWorkerId('');
    setSelectedPOLineId('');
    setStartDate('');
    setEndDate('');
    setNotes('');
  };

  const getStatusBadge = (status: AssignmentStatus) => {
    switch(status) {
      case 'proposed': return <Badge variant="outline" className="bg-slate-100 text-slate-700">Proposed</Badge>;
      case 'client_review': return <Badge variant="outline" className="bg-blue-100 text-blue-700 border-blue-200">Reviewing</Badge>;
      case 'approved': return <Badge variant="outline" className="bg-green-100 text-green-700 border-green-200">Approved</Badge>;
      case 'active': return <Badge className="bg-primary">Active</Badge>;
      case 'mobilizing': return <Badge variant="secondary" className="bg-amber-100 text-amber-700">Mobilizing</Badge>;
      case 'cancelled': return <Badge variant="destructive">Cancelled</Badge>;
      case 'replaced': return <Badge variant="outline" className="bg-orange-50 text-orange-600">Replaced</Badge>;
      case 'demobilized': return <Badge variant="outline">Demobilized</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isUserLoading || !currentUser || (firebaseUser && firebaseUser.uid !== currentUser.id)) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Clock className="h-12 w-12 text-primary animate-pulse" />
      </div>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary flex items-center gap-2">
              <UserPlus className="h-6 w-6" /> การมอบหมายและส่งพิจารณา (Assignments)
            </h1>
            <p className="text-muted-foreground">บริหารจัดการขั้นตอนการส่งตัวคนงานเข้าโครงการของลูกค้า</p>
          </div>
          
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" /> สร้างการมอบหมายใหม่
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl overflow-y-auto max-h-[90vh]">
              <DialogHeader>
                <DialogTitle>สร้างการมอบหมาย (New Assignment)</DialogTitle>
                <DialogDescription>เชื่อมต่อคนงานเข้ากับโควต้าตำแหน่งงานใน Customer PO</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                <div className="space-y-2 md:col-span-2">
                  <Label>เลือกรายการโควต้า (Customer PO Line)</Label>
                  <Select onValueChange={setSelectedPOLineId} value={selectedPOLineId}>
                    <SelectTrigger>
                      <SelectValue placeholder="เลือกโควต้าตำแหน่งงาน..." />
                    </SelectTrigger>
                    <SelectContent>
                      {allPOLines?.map(line => {
                        const po = allPOs?.find(p => p.id === line.poId);
                        const pos = allPositions?.find(p => p.id === line.positionId);
                        const assigned = assignments?.filter(a => a.poLineId === line.id && ['active', 'mobilizing', 'proposed', 'client_review', 'approved'].includes(a.status)).length || 0;
                        return (
                          <SelectItem key={line.id} value={line.id} disabled={assigned >= line.quantity}>
                            {po?.poCode} | {pos?.positionName} ({assigned}/{line.quantity})
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2 md:col-span-2">
                  <Label>คนงาน (Workers - แนะนำสถานะ READY)</Label>
                  <Select onValueChange={setSelectedWorkerId} value={selectedWorkerId}>
                    <SelectTrigger>
                      <SelectValue placeholder="เลือกคนงาน..." />
                    </SelectTrigger>
                    <SelectContent>
                      {allWorkers?.map(worker => (
                        <SelectItem key={worker.id} value={worker.id}>
                          {worker.firstName} {worker.lastName} ({worker.readinessStatus})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>วันที่เริ่ม (Start Date)</Label>
                  <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>วันที่สิ้นสุด (End Date)</Label>
                  <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label>หมายเหตุ (Internal Notes)</Label>
                  <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="รายละเอียดเพิ่มเติม..." />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>ยกเลิก</Button>
                <Button onClick={handleCreateAssignment} disabled={!selectedWorkerId || !selectedPOLineId || !startDate || !endDate}>
                  สร้างรายการเสนอ
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader className="pb-3 border-b">
            <div className="flex items-center justify-between">
              <CardTitle>รายการการมอบหมายทั้งหมด</CardTitle>
              <div className="flex gap-2">
                <div className="relative w-64">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="ค้นหาคนงานหรือโครงการ..." className="pl-8" />
                </div>
                <Button variant="outline" size="icon"><Filter className="h-4 w-4" /></Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isAssignmentsLoading ? (
              <div className="py-20 text-center text-muted-foreground italic">กำลังโหลดข้อมูล...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow>
                    <TableHead>คนงาน & ตำแหน่ง</TableHead>
                    <TableHead>โครงการ & ลูกค้า</TableHead>
                    <TableHead>ช่วงเวลา</TableHead>
                    <TableHead>สถานะงาน</TableHead>
                    <TableHead>สถานะอนุมัติ</TableHead>
                    <TableHead className="text-right">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assignments?.map((asgn) => {
                    const worker = allWorkers?.find(w => w.id === asgn.workerId);
                    const pos = allPositions?.find(p => p.id === asgn.positionId);
                    const customer = allCustomers?.find(c => c.id === asgn.customerId);
                    const po = allPOs?.find(p => p.id === asgn.poId);
                    
                    return (
                      <TableRow key={asgn.id} className="group cursor-pointer hover:bg-muted/50" onClick={() => router.push(`/assignments/${asgn.id}`)}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-semibold">{worker ? `${worker.firstName} ${worker.lastName}` : 'N/A'}</span>
                            <span className="text-xs text-primary flex items-center gap-1"><Briefcase className="h-3 w-3" /> {pos?.positionName || asgn.positionId}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium text-xs">{asgn.projectName}</span>
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <Building2 className="h-2.5 w-2.5" /> {customer?.name || 'N/A'} 
                              <span className="ml-1 text-primary">[{po?.poCode}]</span>
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col text-[10px] text-muted-foreground">
                            <span className="flex items-center gap-1"><Calendar className="h-2.5 w-2.5" /> เริ่ม: {new Date(asgn.startDate).toLocaleDateString('th-TH')}</span>
                            <span>จบ: {new Date(asgn.endDate).toLocaleDateString('th-TH')}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {getStatusBadge(asgn.status)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={asgn.clientApprovalStatus === 'approved' ? 'text-green-600 border-green-200' : ''}>
                            {asgn.clientApprovalStatus.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <ChevronRight className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {(!assignments || assignments.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-20 text-muted-foreground italic">ไม่พบรายการการมอบหมาย</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}