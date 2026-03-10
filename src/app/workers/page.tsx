'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, CheckCircle2, AlertCircle, FileQuestion, ShieldAlert, Trash2, Edit, UserSquare2, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Worker, ReadinessStatus, User, Position } from '@/lib/types';
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
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { deleteDocumentNonBlocking, addDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';

export default function WorkersPage() {
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
        console.error('Failed to parse stored user', e);
      }
    }
  }, []);

  const workersQuery = useMemoFirebase(() => {
    if (isUserLoading || !firebaseUser || !firestore || !currentUser) return null;
    return collection(firestore, 'workers');
  }, [firestore, firebaseUser, isUserLoading, currentUser]);

  const { data: workers, isLoading: isCollectionLoading } = useCollection<Worker>(workersQuery as any);

  const positionsQuery = useMemoFirebase(() => {
    if (!firestore || !firebaseUser) return null;
    return collection(firestore, 'positions');
  }, [firestore, firebaseUser]);
  const { data: positions } = useCollection<Position>(positionsQuery as any);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newWorker, setNewWorker] = useState<Partial<Worker>>({
    firstName: '',
    lastName: '',
    nickname: '',
    thaiNationalId: '',
    passportNo: '',
    contactPhone: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    address: '',
    currentPositionId: '',
    secondaryPositionIds: [],
    workerStatus: 'available',
    readinessStatus: 'DOCUMENT_MISSING',
    nationality: 'Thai',
    gender: 'Male',
    notes: ''
  });

  const handleCreate = async () => {
    if (!firestore) return;
    const workerRef = collection(firestore, 'workers');
    
    try {
      const docRef = await addDocumentNonBlocking(workerRef, {
        ...newWorker,
        dateOfBirth: newWorker.dateOfBirth ? new Date(newWorker.dateOfBirth).getTime() : Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      
      setIsCreateOpen(false);
      toast({
        title: "ลงทะเบียนคนงานสำเร็จ",
        description: "กำลังนำคุณไปที่หน้าจัดการรายละเอียดและเอกสาร...",
      });
      
      if (docRef) {
        router.push(`/workers/${docRef.id}`);
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "เกิดข้อผิดพลาด",
        description: "ไม่สามารถบันทึกข้อมูลได้",
      });
    }
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!firestore) return;
    if (confirm('ยืนยันการลบข้อมูลคนงานนี้? ข้อมูลย่อยทั้งหมดจะถูกลบด้วย')) {
      deleteDocumentNonBlocking(doc(firestore, 'workers', id));
      toast({ title: "ลบข้อมูลสำเร็จ" });
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
      case 'DRUG_TEST_EXPIRED':
        return <Badge variant="destructive" className="bg-orange-100 text-orange-700 border-orange-200"><AlertCircle className="h-3 w-3 mr-1" /> DRUG EXPIRED</Badge>;
      default:
        return <Badge variant="secondary"><FileQuestion className="h-3 w-3 mr-1" /> PENDING</Badge>;
    }
  };

  if (isUserLoading || !currentUser || (firebaseUser && firebaseUser.uid !== currentUser.id)) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="text-muted-foreground">กำลังตรวจสอบสิทธิ์การเข้าถึง...</p>
        </div>
      </div>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary flex items-center gap-2">
              <UserSquare2 className="h-6 w-6" /> ทะเบียนคนงาน (Worker Directory)
            </h1>
            <p className="text-muted-foreground">จัดการข้อมูลและตรวจสอบความพร้อม (Readiness) รายบุคคล</p>
          </div>
          
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" /> ลงทะเบียนคนงานใหม่
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>ลงทะเบียนคนงานใหม่</DialogTitle>
                <DialogDescription>กรอกข้อมูลพื้นฐานเพื่อสร้างโปรไฟล์คนงานในระบบ</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4 py-4">
                <div className="grid gap-2">
                  <Label>ชื่อ (First Name)</Label>
                  <Input value={newWorker.firstName} onChange={e => setNewWorker({...newWorker, firstName: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label>นามสกุล (Last Name)</Label>
                  <Input value={newWorker.lastName} onChange={e => setNewWorker({...newWorker, lastName: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label>ชื่อเล่น (Nickname)</Label>
                  <Input value={newWorker.nickname} onChange={e => setNewWorker({...newWorker, nickname: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label>วันเกิด</Label>
                  <Input type="date" onChange={e => setNewWorker({...newWorker, dateOfBirth: new Date(e.target.value).getTime()})} />
                </div>
                <div className="grid gap-2">
                  <Label>เลขบัตรประชาชน</Label>
                  <Input value={newWorker.thaiNationalId} onChange={e => setNewWorker({...newWorker, thaiNationalId: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label>เลขพาสปอร์ต (ถ้ามี)</Label>
                  <Input value={newWorker.passportNo} onChange={e => setNewWorker({...newWorker, passportNo: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label>สัญชาติ</Label>
                  <Select onValueChange={v => setNewWorker({...newWorker, nationality: v})} value={newWorker.nationality}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Thai">Thai</SelectItem>
                      <SelectItem value="Burmese">Burmese</SelectItem>
                      <SelectItem value="Cambodian">Cambodian</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>เบอร์โทรศัพท์</Label>
                  <Input value={newWorker.contactPhone} onChange={e => setNewWorker({...newWorker, contactPhone: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label>ตำแหน่งหลัก (Primary Position)</Label>
                  <Select onValueChange={v => setNewWorker({...newWorker, currentPositionId: v})} value={newWorker.currentPositionId}>
                    <SelectTrigger><SelectValue placeholder="เลือกตำแหน่ง..." /></SelectTrigger>
                    <SelectContent>
                      {positions?.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.positionName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>สถานะคนงาน</Label>
                  <Select onValueChange={v => setNewWorker({...newWorker, workerStatus: v as any})} value={newWorker.workerStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="available">Available (พร้อมงาน)</SelectItem>
                      <SelectItem value="assigned">Assigned (มีงานแล้ว)</SelectItem>
                      <SelectItem value="on_leave">On Leave (ลา)</SelectItem>
                      <SelectItem value="inactive">Inactive (พ้นสภาพ)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2 col-span-2">
                  <Label>ที่อยู่</Label>
                  <Textarea value={newWorker.address} onChange={e => setNewWorker({...newWorker, address: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label>ผู้ติดต่อฉุกเฉิน</Label>
                  <Input value={newWorker.emergencyContactName} onChange={e => setNewWorker({...newWorker, emergencyContactName: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label>เบอร์โทรศัพท์ฉุกเฉิน</Label>
                  <Input value={newWorker.emergencyContactPhone} onChange={e => setNewWorker({...newWorker, emergencyContactPhone: e.target.value})} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>ยกเลิก</Button>
                <Button onClick={handleCreate}>บันทึกและจัดการรายละเอียด</Button>
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
            {isCollectionLoading ? (
              <div className="py-10 text-center text-muted-foreground italic">กำลังโหลดข้อมูลคนงาน...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>คนงาน (Staff)</TableHead>
                    <TableHead>ตำแหน่งงาน (Position)</TableHead>
                    <TableHead>สถานะงาน</TableHead>
                    <TableHead>ความพร้อม (Readiness)</TableHead>
                    <TableHead className="text-right">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workers?.map((worker) => {
                    const position = positions?.find(p => p.id === worker.currentPositionId);
                    return (
                      <TableRow 
                        key={worker.id} 
                        className="cursor-pointer hover:bg-muted/50 group"
                        onClick={() => router.push(`/workers/${worker.id}`)}
                      >
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-semibold">{worker.firstName} {worker.lastName} ({worker.nickname || '-'})</span>
                            <span className="text-xs text-muted-foreground">{worker.thaiNationalId}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">{position?.positionName || worker.currentPositionId}</span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={worker.workerStatus === 'available' ? 'outline' : 'secondary'} className={worker.workerStatus === 'available' ? 'text-green-600 border-green-200' : ''}>
                            {worker.workerStatus.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {getReadinessBadge(worker.readinessStatus)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button variant="ghost" size="icon" className="text-destructive" onClick={(e) => handleDelete(worker.id, e)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                            <ChevronRight className="h-5 w-5 text-muted-foreground" />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {(!workers || workers.length === 0) && !isCollectionLoading && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-10 text-muted-foreground italic">ไม่พบข้อมูลคนงานในระบบ</TableCell>
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
