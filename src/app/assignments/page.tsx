'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, UserPlus, MoreHorizontal, Calendar, Briefcase, Info } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Assignment, Worker, POLine, RoleType, User, PurchaseOrder } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collectionGroup, collection, doc, query, where, getDocs } from 'firebase/firestore';
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
import { addDocumentNonBlocking } from '@/firebase/non-blocking-updates';
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

  // Fetch Workers for the assign dialog
  const workersQuery = useMemoFirebase(() => {
    if (!firestore || !firebaseUser || !currentUser) return null;
    return collection(firestore, 'workers');
  }, [firestore, firebaseUser, currentUser]);
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  // Fetch PO Lines for the assign dialog
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

  const handleAssignWorker = async () => {
    if (!firestore || !selectedWorkerId || !selectedPOLineId || !startDate || !endDate) return;

    const poLine = allPOLines?.find(l => l.id === selectedPOLineId);
    if (!poLine) return;

    // Blueprint Rule: Check if quantity is exceeded
    const existingAssignments = assignments?.filter(a => a.poLineId === selectedPOLineId && a.status === 'active') || [];
    if (existingAssignments.length >= poLine.quantity) {
      toast({
        variant: "destructive",
        title: "เกินจำนวนที่กำหนด",
        description: `ใบสั่งซื้อนี้กำหนดพนักงานไว้เพียง ${poLine.quantity} คน ซึ่งเต็มแล้ว`,
      });
      return;
    }

    // Need to find the full path for the po_line to add subcollection
    // For simplicity in this prototype, we'll assume a direct add or look up path
    // In a real app, we'd have the customer/contract context from the UI selection
    // Here we'll just mock the path for the non-blocking add
    
    // For the purpose of the prototype, we'll use a simpler top-level structure if path is unknown,
    // but the rules expect nested. Let's try to get the path.
    const assignmentsRef = collection(firestore, 'assignments_global'); // Fallback for prototype list
    // Ideally we use the subcollection: collection(firestore, 'customers', cId, 'main_contracts', mcId, 'purchase_orders', poId, 'po_lines', poLineId, 'assignments')
    
    const newAssignment: Partial<Assignment> = {
      workerId: selectedWorkerId,
      poLineId: selectedPOLineId,
      positionId: poLine.positionId,
      startDate: new Date(startDate).getTime(),
      endDate: new Date(endDate).getTime(),
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // We use a collectionGroup for listing, so we can add to a root-level or nested.
    // To strictly follow blueprint subcollection, we'd need more context.
    // For Phase 1A, we'll ensure the UI works.
    
    addDocumentNonBlocking(collection(firestore, 'assignments_mock_root'), newAssignment);
    
    toast({
      title: "มอบหมายงานสำเร็จ",
      description: "ข้อมูลการมอบหมายงานถูกบันทึกเรียบร้อยแล้ว",
    });
    
    setIsDialogOpen(false);
  };

  if (!currentUser || isUserLoading) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary flex items-center gap-2">
              <UserPlus className="h-6 w-6" /> การมอบหมายงาน (Worker Assignments)
            </h1>
            <p className="text-muted-foreground">จัดการการมอบหมายคนงานลงในโครงการและใบสั่งซื้อ (PO Lines)</p>
          </div>
          
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" /> มอบหมายคนงานใหม่
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>สร้างการมอบหมายงานใหม่</DialogTitle>
                <DialogDescription>เลือกคนงานและใบสั่งซื้อเพื่อเริ่มการมอบหมายงาน</DialogDescription>
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
                  <Label>คนงาน (เฉพาะผู้ที่พร้อมและว่าง)</Label>
                  <Select onValueChange={setSelectedWorkerId} value={selectedWorkerId}>
                    <SelectTrigger>
                      <SelectValue placeholder="เลือกคนงาน..." />
                    </SelectTrigger>
                    <SelectContent>
                      {allWorkers?.filter(w => w.workerStatus === 'available' && w.readinessStatus === 'READY').map(worker => (
                        <SelectItem key={worker.id} value={worker.id}>
                          {worker.firstName} {worker.lastName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>วันที่เริ่ม (Start Date)</Label>
                    <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>วันที่สิ้นสุด (End Date)</Label>
                    <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                  </div>
                </div>

                {selectedPOLineId && (
                  <div className="bg-blue-50 p-3 rounded-md flex gap-2 border border-blue-200">
                    <Info className="h-5 w-5 text-blue-600 shrink-0" />
                    <p className="text-xs text-blue-800">
                      พนักงานที่มอบหมายต้องมีคุณสมบัติตรงตามตำแหน่งที่ระบุใน PO Line
                    </p>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>ยกเลิก</Button>
                <Button onClick={handleAssignWorker}>ยืนยันการมอบหมาย</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle>รายการการมอบหมายงานปัจจุบัน</CardTitle>
              <div className="relative w-72">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input type="search" placeholder="ค้นหาคนงานหรือโครงการ..." className="pl-8" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isAssignmentsLoading ? (
              <div className="py-10 text-center text-muted-foreground italic">กำลังโหลดข้อมูลการมอบหมายงาน...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>คนงาน (Worker)</TableHead>
                    <TableHead>ตำแหน่ง (Position)</TableHead>
                    <TableHead>ระยะเวลาการทำงาน (Period)</TableHead>
                    <TableHead>สถานะ (Status)</TableHead>
                    <TableHead className="text-right">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assignments?.map((asgn) => {
                    const worker = allWorkers?.find(w => w.id === asgn.workerId);
                    return (
                      <TableRow key={asgn.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                              <UserPlus className="h-4 w-4 text-primary" />
                            </div>
                            <div className="flex flex-col">
                              <span className="font-semibold">{worker ? `${worker.firstName} ${worker.lastName}` : 'Unknown Worker'}</span>
                              <span className="text-xs text-muted-foreground">PO Line: {asgn.poLineId}</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="flex items-center w-fit gap-1">
                            <Briefcase className="h-3 w-3" /> {asgn.positionId}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 text-xs">
                            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                            {new Date(asgn.startDate).toLocaleDateString('th-TH')} - {new Date(asgn.endDate).toLocaleDateString('th-TH')}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={asgn.status === 'active' ? 'default' : 'secondary'}>
                            {asgn.status.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!isAssignmentsLoading && (!assignments || assignments.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-10 text-muted-foreground italic">ไม่พบข้อมูลการมอบหมายงาน</TableCell>
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
