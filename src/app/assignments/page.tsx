'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, UserPlus, MoreHorizontal, Briefcase, Send, Clock, CheckCircle2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Assignment, Worker, POLine, User, AssignmentStatus } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collectionGroup, collection, doc } from 'firebase/firestore';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { addDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';

export default function AssignmentsPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const assignmentsQuery = useMemoFirebase(() => {
    if (!firestore || !firebaseUser || !currentUser) return null;
    return collectionGroup(firestore, 'assignments');
  }, [firestore, firebaseUser, currentUser]);

  const { data: assignments, isLoading: isAssignmentsLoading } = useCollection<Assignment>(assignmentsQuery as any);

  const workersQuery = useMemoFirebase(() => {
    if (!firestore || !firebaseUser || !currentUser) return null;
    return collection(firestore, 'workers');
  }, [firestore, firebaseUser, currentUser]);
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  const poLinesQuery = useMemoFirebase(() => {
    if (!firestore || !firebaseUser || !currentUser) return null;
    return collectionGroup(firestore, 'po_lines');
  }, [firestore, firebaseUser, currentUser]);
  const { data: allPOLines } = useCollection<POLine>(poLinesQuery as any);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [selectedPOLineId, setSelectedPOLineId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const handleCreateAssignment = async () => {
    if (!firestore || !selectedWorkerId || !selectedPOLineId || !startDate || !endDate) return;

    const poLine = allPOLines?.find(l => l.id === selectedPOLineId);
    if (!poLine) return;

    const existingCount = assignments?.filter(a => 
      a.poLineId === selectedPOLineId && 
      ['approved', 'active', 'mobilizing'].includes(a.status)
    ).length || 0;

    if (existingCount >= poLine.quantity) {
      toast({
        variant: "destructive",
        title: "โควต้าเต็ม (Quota Full)",
        description: `โควต้าของ PO Line นี้คือ ${poLine.quantity} ซึ่งมีการจองเต็มแล้ว`,
      });
      return;
    }

    // In a collectionGroup query environment, we usually write to a flattened operational path
    // For this prototype, we'll store assignments in a way the collectionGroup can find them
    const assignmentsRef = collection(firestore, 'assignments');
    
    const newAssignment: Partial<Assignment> = {
      workerId: selectedWorkerId,
      poLineId: selectedPOLineId,
      positionId: poLine.positionId,
      startDate: new Date(startDate).getTime(),
      endDate: new Date(endDate).getTime(),
      status: 'proposed',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    addDocumentNonBlocking(assignmentsRef, newAssignment);
    
    toast({
      title: "สร้างรายการเสนอตัวสำเร็จ",
      description: "คนงานถูกเพิ่มเข้ารายการ 'Proposed' เพื่อรอส่งให้ลูกค้าพิจารณา",
    });
    
    setIsDialogOpen(false);
    resetForm();
  };

  const handleUpdateStatus = (asgnId: string, newStatus: AssignmentStatus) => {
    if (!firestore) return;
    updateDocumentNonBlocking(doc(firestore, 'assignments', asgnId), {
      status: newStatus,
      updatedAt: Date.now()
    });
    toast({
      title: "อัปเดตสถานะสำเร็จ",
      description: `เปลี่ยนสถานะเป็น ${newStatus.toUpperCase()} เรียบร้อยแล้ว`,
    });
  };

  const resetForm = () => {
    setSelectedWorkerId('');
    setSelectedPOLineId('');
    setStartDate('');
    setEndDate('');
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
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isUserLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary flex items-center gap-2">
              <UserPlus className="h-6 w-6" /> จัดการการมอบหมายและพิจารณา (Assignments & Approvals)
            </h1>
            <p className="text-muted-foreground">บริหารจัดการขั้นตอนการเสนอตัวคนงานและการส่งพิจารณาจากลูกค้า</p>
          </div>
          
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" /> เสนอตัวคนงานใหม่
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>เสนอชื่อคนงานเข้าโครงการ</DialogTitle>
                <DialogDescription>เลือกคนงานที่พร้อมและ PO Line ที่ต้องการจองพื้นที่</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>ใบสั่งซื้อ / รายการ PO Line</Label>
                  <Select onValueChange={setSelectedPOLineId} value={selectedPOLineId}>
                    <SelectTrigger>
                      <SelectValue placeholder="เลือกรายการ PO Line..." />
                    </SelectTrigger>
                    <SelectContent>
                      {allPOLines?.map(line => (
                        <SelectItem key={line.id} value={line.id}>
                          {line.positionId} (โควต้า: {line.quantity})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label>คนงาน (READY)</Label>
                  <Select onValueChange={setSelectedWorkerId} value={selectedWorkerId}>
                    <SelectTrigger>
                      <SelectValue placeholder="เลือกคนงาน..." />
                    </SelectTrigger>
                    <SelectContent>
                      {allWorkers?.filter(w => w.readinessStatus === 'READY').map(worker => (
                        <SelectItem key={worker.id} value={worker.id}>
                          {worker.firstName} {worker.lastName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>วันที่เริ่ม</Label>
                    <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>วันที่สิ้นสุด</Label>
                    <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                  </div>
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
          <CardHeader>
            <CardTitle>รายการการมอบหมายทั้งหมด</CardTitle>
          </CardHeader>
          <CardContent>
            {isAssignmentsLoading ? (
              <div className="py-10 text-center text-muted-foreground italic">กำลังโหลดข้อมูล...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>คนงาน</TableHead>
                    <TableHead>ตำแหน่ง</TableHead>
                    <TableHead>ระยะเวลา</TableHead>
                    <TableHead>สถานะ</TableHead>
                    <TableHead className="text-right">จัดการขั้นตอน</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assignments?.map((asgn) => {
                    const worker = allWorkers?.find(w => w.id === asgn.workerId);
                    return (
                      <TableRow key={asgn.id}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-semibold">{worker ? `${worker.firstName} ${worker.lastName}` : 'N/A'}</span>
                            <span className="text-xs text-muted-foreground">{worker?.thaiNationalId}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-sm">{asgn.positionId}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {new Date(asgn.startDate).toLocaleDateString('th-TH')} - {new Date(asgn.endDate).toLocaleDateString('th-TH')}
                        </TableCell>
                        <TableCell>
                          {getStatusBadge(asgn.status)}
                        </TableCell>
                        <TableCell className="text-right space-x-2">
                          {asgn.status === 'proposed' && (
                            <Button size="sm" variant="outline" className="text-blue-600 border-blue-200" onClick={() => handleUpdateStatus(asgn.id, 'client_review')}>
                              <Send className="h-3.5 w-3.5 mr-1" /> ส่งพิจารณา
                            </Button>
                          )}
                          {asgn.status === 'approved' && (
                            <Button size="sm" variant="outline" className="text-amber-600 border-amber-200" onClick={() => handleUpdateStatus(asgn.id, 'mobilizing')}>
                              <Clock className="h-3.5 w-3.5 mr-1" /> เริ่มระดมพล
                            </Button>
                          )}
                          {asgn.status === 'mobilizing' && (
                            <Button size="sm" className="bg-primary" onClick={() => handleUpdateStatus(asgn.id, 'active')}>
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> เริ่มงาน (Active)
                            </Button>
                          )}
                          <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
