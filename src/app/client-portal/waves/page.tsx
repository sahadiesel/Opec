'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  ShieldCheck, 
  CheckCircle2, 
  XCircle, 
  UserCheck, 
  Info,
  ChevronRight,
  HardHat,
  Search,
  Filter,
  Briefcase,
  Calendar,
  Waves
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { User as AppUser, Worker, Assignment, Wave, WorkerWaveAcceptance } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where, orderBy, doc, getDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { WorkerWaveAcceptanceService } from '@/lib/services/acceptance-service';
import { PageGuidance } from '@/components/layout/page-guidance';

export default function ClientWaveAcceptancePage() {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const customerId = currentUser?.customerId || '';

  const wavesQuery = useMemoFirebase(() => {
    if (!firestore || !customerId) return null;
    return query(collection(firestore, 'waves'), where('customerId', '==', customerId));
  }, [firestore, customerId]);
  const { data: waves } = useCollection<Wave>(wavesQuery as any);

  const acceptQuery = useMemoFirebase(() => {
    if (!firestore || !customerId) return null;
    return collection(firestore, 'worker_wave_acceptances');
  }, [firestore, customerId]);
  const { data: acceptances, isLoading: isAcceptLoading } = useCollection<WorkerWaveAcceptance>(acceptQuery as any);

  const workersQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'workers') : null), [firestore]);
  const { data: workers } = useCollection<Worker>(workersQuery as any);

  const [selectedAcceptance, setSelectedAcceptance] = useState<WorkerWaveAcceptance | null>(null);
  const [remark, setRemark] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleAction = async (action: 'accept' | 'reject' | 'replace') => {
    if (!firestore || !currentUser || !selectedAcceptance) return;
    
    setIsProcessing(true);
    const service = new WorkerWaveAcceptanceService(firestore);
    try {
      if (action === 'accept') await service.acceptWorkerForWave(selectedAcceptance.id, currentUser, remark);
      if (action === 'reject') await service.rejectWorkerForWave(selectedAcceptance.id, currentUser, remark);
      if (action === 'replace') await service.requestReplacementForWave(selectedAcceptance.id, currentUser, remark);
      
      toast({ title: "บันทึกการพิจารณาสำเร็จ" });
      setSelectedAcceptance(null);
      setRemark('');
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถบันทึกข้อมูลได้" });
    } finally {
      setIsProcessing(false);
    }
  };

  if (isUserLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <UserCheck className="h-8 w-8" /> อนุมัติลูกจ้างตามเวฟ (Worker Acceptance by Wave)
          </h1>
          <p className="text-muted-foreground text-lg italic">พิจารณาและอนุมัติรายชื่อลูกจ้างที่เตรียมส่งตัวเข้าหน้างานของท่าน (Candidate review portal).</p>
        </div>

        <PageGuidance 
          title="คำแนะนำสำหรับลูกค้า (Client Portal Guide)"
          tips={[
            "กรุณาตรวจสอบประวัติและใบเซอร์ของคนงานก่อนกด อนุมัติ (Accept) เพื่อยืนยันความพร้อมลงหน้างาน",
            "หากท่านต้องการขอเปลี่ยนตัวพนักงาน กรุณาระบุเหตุผลและเลือก 'ขอเปลี่ยนตัว' (Request Replacement)",
            "พนักงานที่ได้รับการอนุมัติจะเข้าสู่กระบวนการระดมพล (Mobilization) ทันทีเพื่อเริ่มงานตามกำหนด"
          ]}
        />

        <Card className="shadow-lg border-none overflow-hidden">
          <CardHeader className="bg-muted/30 border-b">
            <CardTitle className="text-lg">รายการรอพิจารณา (Pending Candidates)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isAcceptLoading ? (
              <div className="py-20 text-center animate-pulse">กำลังดึงข้อมูลผู้สมัคร...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="pl-6 py-4 font-bold">ชื่อคนงาน (Worker Name)</TableHead>
                    <TableHead className="font-bold">รหัสเวฟ (Wave)</TableHead>
                    <TableHead className="font-bold">ตำแหน่ง (Position)</TableHead>
                    <TableHead className="font-bold">สถานะการพิจารณา</TableHead>
                    <TableHead className="text-right pr-6">ดำเนินการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {acceptances?.filter(a => a.status === 'pending').map((a) => {
                    const worker = workers?.find(w => w.id === a.workerId);
                    const wave = waves?.find(w => w.id === a.waveId);
                    return (
                      <TableRow key={a.id} className="hover:bg-muted/20 transition-all">
                        <TableCell className="pl-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary">
                              {worker?.firstName.charAt(0)}
                            </div>
                            <div className="flex flex-col">
                              <span className="font-bold text-sm text-primary">{worker?.firstName} {worker?.lastName}</span>
                              <span className="text-[10px] text-muted-foreground">ID: {worker?.thaiNationalId}</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono bg-white flex items-center gap-1 w-fit">
                            <Waves className="h-3 w-3" /> {wave?.waveCode || a.waveId}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs font-medium">{worker?.currentPositionId}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="bg-blue-50 text-blue-700 animate-pulse">PENDING REVIEW</Badge>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button size="sm" onClick={() => setSelectedAcceptance(a)} className="bg-primary font-bold gap-2">
                                พิจารณา <ChevronRight className="h-4 w-4" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-xl">
                              <DialogHeader>
                                <DialogTitle>พิจารณาคุณสมบัติพนักงาน</DialogTitle>
                                <DialogDescription>ตรวจสอบข้อมูลและเลือกการดำเนินการสำหรับ {worker?.firstName}</DialogDescription>
                              </DialogHeader>
                              <div className="space-y-4 py-4">
                                <div className="p-4 bg-muted/30 rounded-lg grid grid-cols-2 gap-4 text-sm">
                                  <div>
                                    <Label className="text-[10px] font-bold text-muted-foreground uppercase">ตำแหน่ง:</Label>
                                    <p className="font-bold">{worker?.currentPositionId}</p>
                                  </div>
                                  <div>
                                    <Label className="text-[10px] font-bold text-muted-foreground uppercase">โครงการ:</Label>
                                    <p className="font-bold">{wave?.projectName}</p>
                                  </div>
                                </div>
                                <div className="space-y-2">
                                  <Label className="font-bold">ความเห็น / หมายเหตุ (Remark)</Label>
                                  <Textarea 
                                    placeholder="ระบุข้อความเพิ่มเติมสำหรับฝ่ายบุคคล..." 
                                    value={remark} 
                                    onChange={e => setRemark(e.target.value)} 
                                  />
                                </div>
                              </div>
                              <DialogFooter className="flex-col sm:flex-row gap-2">
                                <Button variant="outline" className="text-destructive border-destructive" onClick={() => handleAction('replace')}>
                                  <XCircle className="h-4 w-4 mr-2" /> ขอเปลี่ยนตัวคนงาน
                                </Button>
                                <Button className="bg-green-600 hover:bg-green-700 font-bold" onClick={() => handleAction('accept')}>
                                  <CheckCircle2 className="h-4 w-4 mr-2" /> อนุมัติรายชื่อ (Accept)
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {(!acceptances || acceptances.filter(a => a.status === 'pending').length === 0) && !isAcceptLoading && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-20 text-muted-foreground italic">ไม่มีพนักงานรอการพิจารณาในขณะนี้</TableCell>
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
