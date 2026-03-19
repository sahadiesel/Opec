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
  Loader2
} from 'lucide-react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { deleteDocumentNonBlocking, addDocumentNonBlocking } from '@/firebase/non-blocking-updates';
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

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newWorker, setNewWorker] = useState<Partial<Worker>>({
    workerCode: getPreviewPattern('worker'),
    firstName: '',
    lastName: '',
    workerStatus: 'AVAILABLE',
    readinessStatus: 'INCOMPLETE',
    nationality: 'Thai',
    gender: 'MALE'
  });

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
          <p className="text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงข้อมูลพนักงาน กรุณาติดต่อผู้ดูแลระบบ</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <HardHat className="h-8 w-8" /> ทะเบียนคนงาน (Worker Directory)
          </h1>
          <p className="text-muted-foreground text-lg">
            บริหารจัดการฐานข้อมูลคนงาน ตรวจสอบความพร้อม (Readiness Matrix) และการปฏิบัติตามมาตรฐานความปลอดภัย Offshore
          </p>
        </div>

        <Alert variant="destructive" className="bg-destructive/5 border-destructive/20 shadow-sm">
          <ShieldAlert className="h-5 w-5" />
          <AlertTitle className="font-bold text-lg">การตรวจสอบความพร้อมก่อนส่งตัว (Compliance & Readiness Check)</AlertTitle>
          <AlertDescription className="text-sm">
            คนงานทุกคนที่จะถูกมอบหมายงาน (Assignment) จะต้องมีสถานะเป็น <b className="text-green-700 underline">READY</b> เท่านั้น ซึ่งหมายถึงมีใบรับรองความปลอดภัย (BOSIET/FOET) และผลตรวจร่างกายที่ยังไม่หมดอายุตามเกณฑ์มาตรฐานหน้างาน
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
          </div>
          <div className="flex items-center gap-2">
            {can('workers').create && (
              <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogTrigger asChild>
                  <Button className="gap-2 h-11 px-6 shadow-md bg-primary hover:bg-primary/90">
                    <Plus className="h-5 w-5" /> ลงทะเบียนคนงานใหม่ (New Registration)
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-3xl">
                  <DialogHeader>
                    <DialogTitle>ลงทะเบียนคนงานใหม่ (Worker Registration)</DialogTitle>
                    <DialogDescription>กรอกข้อมูลพื้นฐานตามบัตรประชาชนและพาสปอร์ตเพื่อเริ่มบันทึกประวัติ</DialogDescription>
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
                        <SelectTrigger><SelectValue placeholder="เลือกตำแหน่ง..." /></SelectTrigger>
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
                      บันทึกประวัติ (Save Profile)
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
                    <TableHead className="font-bold py-4 pl-6">รหัส / ชื่อคนงาน (Worker)</TableHead>
                    <TableHead className="font-bold">ตำแหน่งหลัก (Position)</TableHead>
                    <TableHead className="font-bold">ความพร้อม (Readiness)</TableHead>
                    <TableHead className="font-bold">สถานะงาน (Job Status)</TableHead>
                    <TableHead className="text-right font-bold pr-6">การจัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workers?.map((worker) => {
                    const position = positions?.find(p => p.id === worker.currentPositionId);
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
                  {(!workers || workers.length === 0) && !isCollectionLoading && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-20 text-muted-foreground italic">ไม่พบข้อมูลคนงานในระบบ</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="bg-primary/5 border-primary/10 border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2 text-primary font-bold">
              <Info className="h-5 w-5" /> แนวทางปฏิบัติถัดไป (Next-Step Guidance)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="flex items-start gap-3 p-4 bg-white rounded-md border shadow-sm">
                <div className="bg-primary/10 p-2 rounded text-primary font-bold">1</div>
                <div>
                  <p className="font-bold">อัปเดตใบรับรอง (Update Certificates)</p>
                  <p className="text-muted-foreground text-xs">คลิกที่คนงานเพื่อเพิ่มใบเซอร์ BOSIET หรือผลตรวจร่างกายที่ขาดหายไป</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 bg-white rounded-md border shadow-sm">
                <div className="bg-primary/10 p-2 rounded text-primary font-bold">2</div>
                <div>
                  <p className="font-bold">ยืนยันสถานะความพร้อม (Validate Readiness)</p>
                  <p className="text-muted-foreground text-xs">สถานะต้องเปลี่ยนเป็น READY ก่อนที่จะสามารถส่งตัวเข้ากลุ่มการส่งตัว (Waves) ได้</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 bg-white rounded-md border shadow-sm">
                <div className="bg-primary/10 p-2 rounded text-primary font-bold">3</div>
                <div>
                  <p className="font-bold">การส่งตัวคนงาน (Staff Mobilization)</p>
                  <p className="text-muted-foreground text-xs">ไปที่เมนู 'การมอบหมาย' เพื่อเชื่อมโยงคนงานที่พร้อมเข้ากับโครงการของลูกค้า</p>
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter className="pt-0 justify-end">
            <Button variant="link" className="gap-2 text-primary font-bold" asChild>
              <a href="/assignments">ไปยังเมนูการมอบหมายงาน (Assignments) <ArrowRight className="h-4 w-4" /></a>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </AppShell>
  );
}
