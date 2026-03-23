'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Plus, 
  Search, 
  CheckCircle2, 
  AlertCircle, 
  FileQuestion, 
  ShieldAlert, 
  Trash2, 
  HardHat, 
  ChevronRight, 
  Filter, 
  ArrowRight,
  Info,
  Loader2,
  Users
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Worker, ReadinessStatus, User, Position, DailyTimesheet } from '@/lib/types';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { deleteDocumentNonBlocking, addDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import { usePermissions } from '@/hooks/use-permissions';
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';

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

  const { can, isLoading: isPermLoading } = usePermissions(currentUser);

  const workersQuery = useMemoFirebase(() => {
    if (isUserLoading || !firebaseUser || !firestore || !currentUser || !can('workers').view) return null;
    return collection(firestore, 'workers');
  }, [firestore, firebaseUser, isUserLoading, currentUser, can('workers').view]);

  const { data: workers, isLoading: isCollectionLoading } = useCollection<Worker>(workersQuery as any);

  const positionsQuery = useMemoFirebase(() => {
    if (!firestore || !firebaseUser || !can('positions').view) return null;
    return collection(firestore, 'positions');
  }, [firestore, firebaseUser, can('positions').view]);
  const { data: positions } = useCollection<Position>(positionsQuery as any);
  const timesheetsQuery = useMemoFirebase(() => {
    if (!firestore || !firebaseUser || !can('workers').view) return null;
    return collection(firestore, 'daily_timesheets');
  }, [firestore, firebaseUser, can('workers').view]);
  const { data: allTimesheets } = useCollection<DailyTimesheet>(timesheetsQuery as any);

  const workerHoursById = useMemo(() => {
    const bucket = new Map<string, { totalHours: number; firstWorkedAt: number | null; lastWorkedAt: number | null }>();
    (allTimesheets || []).forEach((ts) => {
      const workerId = ts.workerId;
      if (!workerId) return;
      const tsTime = ts.date ? new Date(ts.date).getTime() : NaN;
      const normalHours = Number(ts.normalHours || 0);
      const ot15Hours = Number(ts.ot15Hours || 0);
      const ot20Hours = Number(ts.ot20Hours || 0);
      const ot30Hours = Number(ts.ot30Hours || 0);
      const holidayHours = Number(ts.holidayHours || 0);
      const totalHours = normalHours + ot15Hours + ot20Hours + ot30Hours + holidayHours;
      const current = bucket.get(workerId) || { totalHours: 0, firstWorkedAt: null, lastWorkedAt: null };
      current.totalHours += totalHours;
      if (!Number.isNaN(tsTime)) {
        current.firstWorkedAt = current.firstWorkedAt === null ? tsTime : Math.min(current.firstWorkedAt, tsTime);
        current.lastWorkedAt = current.lastWorkedAt === null ? tsTime : Math.max(current.lastWorkedAt, tsTime);
      }
      bucket.set(workerId, current);
    });
    return bucket;
  }, [allTimesheets]);

  const sortedWorkers = useMemo(() => {
    return [...(workers || [])].sort((a, b) => {
      const aHours = Number(workerHoursById.get(a.id)?.totalHours || a.totalWorkedHours || 0);
      const bHours = Number(workerHoursById.get(b.id)?.totalHours || b.totalWorkedHours || 0);
      if (bHours !== aHours) return bHours - aHours;
      return `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
    });
  }, [workers, workerHoursById]);

  useEffect(() => {
    if (!firestore || !workers || workers.length === 0) return;
    workers.forEach((w) => {
      const agg = workerHoursById.get(w.id);
      const totalWorkedHours = Number(agg?.totalHours || 0);
      const firstWorkedAt = agg?.firstWorkedAt ?? null;
      const lastWorkedAt = agg?.lastWorkedAt ?? null;
      const changed =
        Number(w.totalWorkedHours || 0) !== totalWorkedHours ||
        Number(w.firstWorkedAt ?? -1) !== Number(firstWorkedAt ?? -1) ||
        Number(w.lastWorkedAt ?? -1) !== Number(lastWorkedAt ?? -1);
      if (changed) {
        updateDocumentNonBlocking(doc(firestore, 'workers', w.id), {
          totalWorkedHours,
          firstWorkedAt,
          lastWorkedAt,
          updatedAt: Date.now(),
        });
      }
    });
  }, [firestore, workers, workerHoursById]);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [positionFilter, setPositionFilter] = useState('all');
  const [newWorker, setNewWorker] = useState<Partial<Worker>>({
    workerCode: getPreviewPattern('worker'),
    firstName: '',
    lastName: '',
    workerStatus: 'AVAILABLE',
    readinessStatus: 'INCOMPLETE',
    nationality: 'Thai',
    gender: 'MALE'
  });

  const filteredWorkers = useMemo(() => {
    if (positionFilter === 'all') return sortedWorkers;
    return sortedWorkers.filter((w) => w.currentPositionId === positionFilter);
  }, [sortedWorkers, positionFilter]);

  const handleCreate = async () => {
    if (!firestore || !currentUser) return;
    
    if (!newWorker.firstName || !newWorker.lastName || !newWorker.thaiNationalId) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาระบุชื่อ นามสกุล และเลขบัตรประชาชน" });
      return;
    }

    setIsCreating(true);
    try {
      // Atomic Worker Code Generation
      const { code: finalCode } = await generateNextDocumentCode(firestore, 'worker', { 
        actor: currentUser.displayName 
      });

      const workerRef = collection(firestore, 'workers');
      const docRef = await addDocumentNonBlocking(workerRef, {
        ...newWorker,
        workerCode: finalCode,
        dateOfBirth: newWorker.dateOfBirth ? new Date(newWorker.dateOfBirth).getTime() : Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      
      setIsCreateOpen(false);
      toast({ title: "ลงทะเบียนคนงานสำเร็จ", description: `รหัสคนงาน: ${finalCode}` });
      if (docRef) router.push(`/workers/${docRef.id}`);
    } catch (error) {
      console.error(error);
      toast({ variant: "destructive", title: "เกิดข้อผิดพลาด", description: "ไม่สามารถบันทึกข้อมูลได้" });
    } finally {
      setIsCreating(false);
    }
  };

  const getReadinessBadge = (status: ReadinessStatus) => {
    switch (status) {
      case 'READY': return <Badge className="bg-green-600 text-white"><CheckCircle2 className="h-3 w-3 mr-1" /> READY</Badge>;
      case 'MISSING_CERTIFICATE': return <Badge variant="outline" className="border-amber-500 text-amber-700 bg-amber-50"><ShieldAlert className="h-3 w-3 mr-1" /> NO CERT</Badge>;
      case 'MEDICAL_EXPIRED': return <Badge variant="destructive"><AlertCircle className="h-3 w-3 mr-1" /> MED EXPIRED</Badge>;
      case 'DRUG_TEST_EXPIRED': return <Badge variant="outline" className="border-orange-500 text-orange-700 bg-orange-50"><AlertCircle className="h-3 w-3 mr-1" /> DRUG EXPIRED</Badge>;
      case 'DOCUMENT_EXPIRED': return <Badge variant="outline" className="border-rose-500 text-rose-700 bg-rose-50"><FileQuestion className="h-3 w-3 mr-1" /> DOC EXPIRED</Badge>;
      case 'BLOCKED': return <Badge variant="destructive"><ShieldAlert className="h-3 w-3 mr-1" /> BLOCKED</Badge>;
      default: return <Badge variant="secondary"><FileQuestion className="h-3 w-3 mr-1" /> PENDING</Badge>;
    }
  };

  if (isUserLoading || isPermLoading || !currentUser) return null;

  if (!can('workers').view) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-4">
          <ShieldAlert className="h-12 w-12 text-destructive opacity-50" />
          <h2 className="text-xl font-bold">Access Denied (จำกัดสิทธิ์เข้าถึง)</h2>
          <p className="text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงข้อมูลพนักงานหน้างาน กรุณาติดต่อผู้ดูแลระบบ</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <HardHat className="h-8 w-8" /> ทะเบียนคนงานหน้างาน (Field Workers Directory)
          </h1>
          <p className="text-muted-foreground text-lg">
            จัดการฐานข้อมูลลูกจ้างหน้างาน (Workforce) ตรวจสอบความพร้อม และการปฏิบัติตามมาตรฐานความปลอดภัย
          </p>
        </div>

        <Alert className="bg-blue-50 border-blue-200 text-blue-800 shadow-sm">
          <Info className="h-5 w-5 text-blue-600" />
          <AlertTitle className="font-bold text-lg">การแยกประเภทบุคลากร (Personnel Silo Policy)</AlertTitle>
          <AlertDescription className="text-sm">
            หน้าจอนี้สำหรับ <b>ลูกจ้างหน้างาน (Field Labor)</b> เท่านั้น หากต้องการจัดการพนักงานออฟฟิศส่วนกลาง (HR, IT, Finance) กรุณาไปที่เมนู <b>"พนักงานออฟฟิศ"</b>
          </AlertDescription>
        </Alert>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="ค้นหาตามชื่อหรือเลขบัตรประชาชน..." className="pl-9 h-11" />
            </div>
            <Button variant="outline" className="gap-2 h-11">
              <Filter className="h-4 w-4" /> ตัวกรอง (Filter)
            </Button>
            <Select value={positionFilter} onValueChange={setPositionFilter}>
              <SelectTrigger className="h-11 min-w-[220px]">
                <SelectValue placeholder="กรองตามตำแหน่ง" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">ทุกตำแหน่ง</SelectItem>
                {(positions || []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.positionName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            {can('workers').create && (
              <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogTrigger asChild>
                  <Button className="gap-2 h-11 px-6 shadow-md bg-primary hover:bg-primary/90 font-bold">
                    <Plus className="h-5 w-5" /> ลงทะเบียนลูกจ้างหน้างานใหม่
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-3xl">
                  <DialogHeader>
                    <DialogTitle>ลงทะเบียนคนงานหน้างานใหม่ (Worker Registration)</DialogTitle>
                    <DialogDescription>บันทึกประวัติลูกจ้างสำหรับงานโครงการหน้างาน (Onshore/Offshore Labor)</DialogDescription>
                  </DialogHeader>
                  <div className="grid grid-cols-2 gap-4 py-4">
                    <div className="grid gap-2 col-span-2">
                      <Label>รหัสคนงาน (Worker Code)</Label>
                      <Input value={newWorker.workerCode} disabled className="bg-muted font-mono font-bold text-primary" />
                      <p className="text-[10px] text-muted-foreground italic">* ระบบจะออกรหัสจริงให้อัตโนมัติเมื่อกดบันทึก</p>
                    </div>
                    <div className="grid gap-2">
                      <Label>ชื่อ (First Name)</Label>
                      <Input value={newWorker.firstName} onChange={e => setNewWorker({...newWorker, firstName: e.target.value})} />
                    </div>
                    <div className="grid gap-2">
                      <Label>นามสกุล (Last Name)</Label>
                      <Input value={newWorker.lastName} onChange={e => setNewWorker({...newWorker, lastName: e.target.value})} />
                    </div>
                    <div className="grid gap-2">
                      <Label>เลขบัตรประชาชน (National ID)</Label>
                      <Input value={newWorker.thaiNationalId} onChange={e => setNewWorker({...newWorker, thaiNationalId: e.target.value})} />
                    </div>
                    <div className="grid gap-2">
                      <Label>ตำแหน่งหลัก (Primary Position)</Label>
                      <Select onValueChange={v => setNewWorker({...newWorker, currentPositionId: v})}>
                        <SelectTrigger><SelectValue placeholder="เลือกตำแหน่งงาน..." /></SelectTrigger>
                        <SelectContent>
                          {positions?.map(p => <SelectItem key={p.id} value={p.id}>{p.positionName}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsCreateOpen(false)} disabled={isCreating}>ยกเลิก</Button>
                    <Button onClick={handleCreate} className="bg-primary font-bold" disabled={isCreating}>
                      {isCreating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      บันทึกประวัติลูกจ้าง (Save)
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isCollectionLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลคนงาน (Loading Worker Data)...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4 pl-6">รหัส / ชื่อคนงาน (Field Worker)</TableHead>
                    <TableHead className="font-bold">ชั่วโมงสะสม (Total Hours)</TableHead>
                    <TableHead className="font-bold">ตำแหน่งหลัก (Position)</TableHead>
                    <TableHead className="font-bold">ความพร้อม (Readiness)</TableHead>
                    <TableHead className="font-bold">สถานะงาน (Job Status)</TableHead>
                    <TableHead className="text-right font-bold pr-6">การจัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredWorkers?.map((worker) => {
                    const position = positions?.find(p => p.id === worker.currentPositionId);
                    const workedHours = Number(workerHoursById.get(worker.id)?.totalHours || worker.totalWorkedHours || 0);
                    return (
                      <TableRow key={worker.id} className="cursor-pointer hover:bg-muted/30 group transition-colors" onClick={() => router.push(`/workers/${worker.id}`)}>
                        <TableCell className="py-4 pl-6">
                          <div className="flex flex-col">
                            <span className="text-[10px] font-mono font-bold text-primary bg-primary/5 w-fit px-1.5 rounded border border-primary/10 mb-1">{worker.workerCode || 'NO CODE'}</span>
                            <span className="font-bold text-base text-primary">{worker.firstName} {worker.lastName}</span>
                            <span className="text-[10px] text-muted-foreground font-mono">{worker.thaiNationalId}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="font-black text-primary">{workedHours.toLocaleString()} ชม.</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20">
                            {position?.positionName || worker.currentPositionId || 'N/A'}
                          </Badge>
                        </TableCell>
                        <TableCell>{getReadinessBadge(worker.readinessStatus)}</TableCell>
                        <TableCell>
                          <Badge variant={worker.workerStatus === 'AVAILABLE' ? 'outline' : 'secondary'} className={worker.workerStatus === 'AVAILABLE' ? 'text-green-600 border-green-200' : ''}>
                            {worker.workerStatus.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <Button variant="ghost" size="icon" className="group-hover:text-primary transition-colors">
                            <ChevronRight className="h-5 w-5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {(!filteredWorkers || filteredWorkers.length === 0) && !isCollectionLoading && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-20 text-muted-foreground italic">ไม่พบข้อมูลคนงานตามตัวกรองที่เลือก</TableCell>
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