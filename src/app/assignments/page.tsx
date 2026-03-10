'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, UserPlus, MoreHorizontal, Calendar, Briefcase, Info, AlertCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Assignment, Worker, POLine, RoleType, User } from '@/lib/types';
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

  const handleAssignWorker = async () => {
    if (!firestore || !selectedWorkerId || !selectedPOLineId || !startDate || !endDate) return;

    const poLine = allPOLines?.find(l => l.id === selectedPOLineId);
    if (!poLine) return;

    // RULE: Check if quantity is exceeded
    const existingAssignments = assignments?.filter(a => a.poLineId === selectedPOLineId && a.status === 'active') || [];
    if (existingAssignments.length >= poLine.quantity) {
      toast({
        variant: "destructive",
        title: "โควต้าเต็ม (Quota Exceeded)",
        description: `ใบสั่งซื้อนี้มีโควต้าจำกัดที่ ${poLine.quantity} อัตรา ซึ่งมีการมอบหมายเต็มแล้ว`,
      });
      return;
    }

    // In a production environment, we would use the full nested path:
    // /customers/{c}/main_contracts/{mc}/purchase_orders/{po}/po_lines/{pol}/assignments
    // For Phase 1A Prototype, we use a root-level mock collection that is picked up by collectionGroup
    const assignmentsRef = collection(firestore, 'assignments_sync');
    
    const newAssignment: Partial<Assignment> = {
      workerId: selectedWorkerId,
      poLineId: selectedPOLineId,
      positionId: poLine.positionId, // One assignment has exactly one position (from PO Line)
      startDate: new Date(startDate).getTime(),
      endDate: new Date(endDate).getTime(),
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    addDocumentNonBlocking(assignmentsRef, newAssignment);
    
    toast({
      title: "มอบหมายงานสำเร็จ",
      description: "ข้อมูลการมอบหมายงานถูกบันทึกเข้าระบบแล้ว",
    });
    
    setIsDialogOpen(false);
    resetForm();
  };

  const resetForm = () => {
    setSelectedWorkerId('');
    setSelectedPOLineId('');
    setStartDate('');
    setEndDate('');
  };

  if (isUserLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary flex items-center gap-2">
              <UserPlus className="h-6 w-6" /> การมอบหมายงาน (Worker Assignments)
            </h1>
            <p className="text-muted-foreground">บริหารจัดการการส่งคนงานลงพื้นที่ตามใบสั่งซื้อ (PO Lines)</p>
          </div>
          
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" /> สร้างการมอบหมายใหม่
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>มอบหมายคนงานเข้าโครงการ</DialogTitle>
                <DialogDescription>เลือกคนงานที่พร้อมและใบสั่งซื้อที่ยังมีโควต้าว่าง</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>ใบสั่งซื้อ / รายการ PO Line</Label>
                  <Select onValueChange={setSelectedPOLineId} value={selectedPOLineId}>
                    <SelectTrigger>
                      <SelectValue placeholder="เลือกรายการ PO Line..." />
                    </SelectTrigger>
                    <SelectContent>
                      {allPOLines?.map(line => {
                        const count = assignments?.filter(a => a.poLineId === line.id && a.status === 'active').length || 0;
                        return (
                          <SelectItem key={line.id} value={line.id} disabled={count >= line.quantity}>
                            {line.positionId} (ว่าง: {line.quantity - count}/{line.quantity})
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label>คนงาน (เฉพาะผู้ที่ READY)</Label>
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
                <Button onClick={handleAssignWorker} disabled={!selectedWorkerId || !selectedPOLineId || !startDate || !endDate}>
                  ยืนยันการมอบหมาย
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle>รายการการมอบหมายปัจจุบัน</CardTitle>
              <div className="relative w-72">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input type="search" placeholder="ค้นหาคนงาน..." className="pl-8" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isAssignmentsLoading ? (
              <div className="py-10 text-center text-muted-foreground italic">กำลังโหลดข้อมูล...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>คนงาน (Worker)</TableHead>
                    <TableHead>ตำแหน่งงาน (Position)</TableHead>
                    <TableHead>รหัส PO Line</TableHead>
                    <TableHead>ระยะเวลา (Period)</TableHead>
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
                              <span className="font-semibold">{worker ? `${worker.firstName} ${worker.lastName}` : 'ไม่พบข้อมูล'}</span>
                              <span className="text-xs text-muted-foreground">{worker?.thaiNationalId || '-'}</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="flex items-center w-fit gap-1">
                            <Briefcase className="h-3 w-3" /> {asgn.positionId}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {asgn.poLineId.substring(0, 8)}...
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 text-xs">
                            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                            {new Date(asgn.startDate).toLocaleDateString('th-TH')} - {new Date(asgn.endDate).toLocaleDateString('th-TH')}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={asgn.status === 'active' ? 'default' : 'secondary'}>
                            {asgn.status === 'active' ? 'กำลังปฏิบัติงาน' : asgn.status.toUpperCase()}
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
                      <TableCell colSpan={6} className="text-center py-10 text-muted-foreground italic">ยังไม่มีการมอบหมายงานในระบบ</TableCell>
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
