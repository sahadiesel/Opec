'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, CheckCircle2, AlertCircle, FileQuestion, MoreHorizontal, UserCheck, ShieldAlert, FileCheck, Trash2, Edit } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Worker, ReadinessStatus, User } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { deleteDocumentNonBlocking, addDocumentNonBlocking } from '@/firebase/non-blocking-updates';

export default function WorkersPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();

  const workersQuery = useMemoFirebase(() => {
    if (!firestore || !firebaseUser || !currentUser) return null;
    return collection(firestore, 'workers');
  }, [firestore, firebaseUser, currentUser]);

  const { data: workers, isLoading } = useCollection<Worker>(workersQuery as any);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newWorker, setNewWorker] = useState({
    firstName: '',
    lastName: '',
    thaiNationalId: '',
    contactPhone: '',
    currentPositionId: ''
  });

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const handleCreate = () => {
    if (!firestore) return;
    const workerRef = collection(firestore, 'workers');
    addDocumentNonBlocking(workerRef, {
      ...newWorker,
      workerStatus: 'available',
      readinessStatus: 'DOCUMENT_MISSING',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      nationality: 'Thai',
      gender: 'N/A'
    });
    setIsCreateOpen(false);
    setNewWorker({ firstName: '', lastName: '', thaiNationalId: '', contactPhone: '', currentPositionId: '' });
  };

  const handleDelete = (id: string) => {
    if (!firestore) return;
    if (confirm('ยืนยันการลบข้อมูลคนงานนี้?')) {
      deleteDocumentNonBlocking(doc(firestore, 'workers', id));
    }
  };

  const getReadinessBadge = (status: ReadinessStatus) => {
    switch (status) {
      case 'READY':
        return <Badge className="bg-green-100 text-green-700 border-green-200"><CheckCircle2 className="h-3 w-3 mr-1" /> READY</Badge>;
      case 'MISSING_CERTIFICATE':
        return <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-200"><ShieldAlert className="h-3 w-3 mr-1" /> NO CERT</Badge>;
      case 'MEDICAL_EXPIRED':
        return <Badge variant="destructive" className="bg-red-100 text-red-700 border-red-200"><AlertCircle className="h-3 w-3 mr-1" /> MED EXPIRED</Badge>;
      default:
        return <Badge variant="secondary"><FileQuestion className="h-3 w-3 mr-1" /> PENDING</Badge>;
    }
  };

  if (isUserLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary">ทะเบียนคนงาน (Worker Directory)</h1>
            <p className="text-muted-foreground">จัดการข้อมูลและตรวจสอบความพร้อม (Readiness) รายบุคคล</p>
          </div>
          
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" /> เพิ่มคนงานใหม่
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>ลงทะเบียนคนงานใหม่</DialogTitle>
                <DialogDescription>กรอกข้อมูลพื้นฐานเพื่อสร้างโปรไฟล์คนงานในระบบ</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="firstName">ชื่อ</Label>
                    <Input id="firstName" value={newWorker.firstName} onChange={e => setNewWorker({...newWorker, firstName: e.target.value})} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="lastName">นามสกุล</Label>
                    <Input id="lastName" value={newWorker.lastName} onChange={e => setNewWorker({...newWorker, lastName: e.target.value})} />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="nid">เลขบัตรประชาชน</Label>
                  <Input id="nid" value={newWorker.thaiNationalId} onChange={e => setNewWorker({...newWorker, thaiNationalId: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="pos">ตำแหน่งปัจจุบัน</Label>
                  <Input id="pos" value={newWorker.currentPositionId} onChange={e => setNewWorker({...newWorker, currentPositionId: e.target.value})} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>ยกเลิก</Button>
                <Button onClick={handleCreate}>สร้างโปรไฟล์</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-4">
              <CardTitle>รายชื่อคนงานทั้งหมด</CardTitle>
              <div className="relative w-72">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input type="search" placeholder="ค้นหาชื่อหรือเลขประจำตัว..." className="pl-8" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-10 text-center text-muted-foreground italic">กำลังโหลดข้อมูลคนงาน...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ชื่อ-นามสกุล (Name)</TableHead>
                    <TableHead>ตำแหน่ง (Position)</TableHead>
                    <TableHead>สถานะงาน (Status)</TableHead>
                    <TableHead>ความพร้อม (Readiness)</TableHead>
                    <TableHead className="text-right">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workers?.map((worker) => (
                    <TableRow key={worker.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-semibold">{worker.firstName} {worker.lastName}</span>
                          <span className="text-xs text-muted-foreground">{worker.thaiNationalId}</span>
                        </div>
                      </TableCell>
                      <TableCell>{worker.currentPositionId}</TableCell>
                      <TableCell>
                        <Badge variant={worker.workerStatus === 'available' ? 'default' : 'secondary'}>
                          {worker.workerStatus.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {getReadinessBadge(worker.readinessStatus)}
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button variant="outline" size="sm" className="gap-2">
                          <Edit className="h-4 w-4" /> ประวัติ & เอกสาร
                        </Button>
                        <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(worker.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
