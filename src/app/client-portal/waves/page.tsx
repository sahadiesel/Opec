
'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  ShieldCheck, 
  ChevronRight, 
  HardHat, 
  Search, 
  Filter, 
  Briefcase, 
  Calendar, 
  Waves,
  MapPin,
  Clock,
  User,
  ExternalLink,
  Info,
  Lock,
  RotateCcw,
  Loader2
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { User as AppUser, Worker, Assignment, Wave } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where, orderBy, doc } from 'firebase/firestore';
import { PageGuidance } from '@/components/layout/page-guidance';
import { CustomerQueryService } from '@/lib/services/customer-query-service';
import { ExceptionRequestService } from '@/lib/services/exception-request-service';
import { useToast } from '@/hooks/use-toast';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription,
  DialogHeader, 
  DialogTitle, 
  DialogFooter
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import Link from 'next/link';

export default function ClientManpowerPage() {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [searchTerm, setSearchTerm] = useState('');
  const [isExceptionOpen, setIsExceptionOpen] = useState(false);
  const [selectedAsgn, setSelectedAsgn] = useState<Assignment | null>(null);
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  // 1. Data Queries using Scoping Service
  const queryService = useMemo(() => firestore ? new CustomerQueryService(firestore) : null, [firestore]);

  const wavesQuery = useMemoFirebase(() => queryService?.getScopedWavesQuery(currentUser), [queryService, currentUser]);
  const { data: waves, isLoading: isWavesLoading } = useCollection<Wave>(wavesQuery as any);

  const asgnQuery = useMemoFirebase(() => queryService?.getScopedAssignmentsQuery(currentUser), [queryService, currentUser]);
  const { data: assignments, isLoading: isAsgnLoading } = useCollection<Assignment>(asgnQuery as any);

  // Only query workers when user is ready (client scope; rules allow client read)
  const workersQuery = useMemoFirebase(() => (firestore && currentUser ? collection(firestore, 'workers') : null), [firestore, currentUser]);
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  const activePersonnel = useMemo(() => {
    if (!assignments) return [];
    return assignments.filter(a => ['ACTIVE', 'MOBILIZING', 'READY_TO_MOB', 'CONFIRMED'].includes(a.deploymentStatus));
  }, [assignments]);

  const filteredPersonnel = useMemo(() => {
    return activePersonnel.filter(asgn => {
      const worker = allWorkers?.find(w => w.id === asgn.workerId);
      const name = worker ? `${worker.firstName} ${worker.lastName}` : '';
      const combined = `${name} ${asgn.projectName} ${asgn.positionId}`.toLowerCase();
      return combined.includes(searchTerm.toLowerCase());
    });
  }, [activePersonnel, allWorkers, searchTerm]);

  const handleRequestException = async () => {
    if (!selectedAsgn || !reason || !firestore || !currentUser) return;
    
    setIsSubmitting(true);
    try {
      const service = new ExceptionRequestService(firestore);
      await service.createRequest({
        type: 'ASSIGNMENT_CHANGE',
        referenceId: selectedAsgn.id,
        referenceNo: selectedAsgn.assignmentNo || `ASG-${selectedAsgn.id.substring(0,8)}`,
        reason: reason,
        user: currentUser
      });

      toast({ 
        title: "ส่งคำขอเปลี่ยนแปลงสำเร็จ", 
        description: "ฝ่ายปฏิบัติการ (Operations) จะตรวจสอบและติดต่อกลับเพื่อดำเนินการ" 
      });
      setIsExceptionOpen(false);
      setReason('');
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isUserLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <HardHat className="h-8 w-8" /> รายชื่อพนักงานและรอบการทำงาน (Active Workforce)
          </h1>
          <p className="text-muted-foreground text-lg italic">
            ติดตามสถานะพนักงานที่กำลังปฏิบัติงานและรอบการระดมพล (Mobilization tracking).
          </p>
        </div>

        <PageGuidance 
          title="สถานะพนักงานหน้างาน"
          tips={[
            "รายการด้านล่างแสดงเฉพาะพนักงานที่กำลังปฏิบัติงานหรืออยู่ในระหว่างการระดมพล (Mobilizing)",
            "รายการที่ระบุ 'Operational Lock' คือพนักงานที่ยืนยันการลงงานแล้ว",
            "หากต้องการขอเปลี่ยนตัวพนักงานหลังจากยืนยันแล้ว กรุณาใช้ปุ่ม 'ขอเปลี่ยนแปลงกรณีพิเศษ'"
          ]}
        />

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-3 space-y-6">
            <div className="flex items-center gap-3 bg-card p-4 rounded-lg border shadow-sm">
              <div className="relative w-full max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="ค้นหาชื่อพนักงาน หรือ โครงการ..." 
                  className="pl-9 h-11" 
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
              </div>
              <Button variant="outline" className="h-11 gap-2"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
            </div>

            <Card className="shadow-lg border-none overflow-hidden">
              <CardHeader className="bg-muted/30 border-b">
                <CardTitle className="text-lg">รายชื่อกำลังพลปัจจุบัน (Current Roster)</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {isAsgnLoading ? (
                  <div className="py-20 text-center animate-pulse italic">กำลังโหลดข้อมูลพนักงาน...</div>
                ) : (
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="pl-6 py-4 font-bold">พนักงาน (Name)</TableHead>
                        <TableHead>ตำแหน่ง & โครงการ</TableHead>
                        <TableHead>ช่วงเวลา (Period)</TableHead>
                        <TableHead>สถานะปัจจุบัน</TableHead>
                        <TableHead className="text-right pr-6">จัดการ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredPersonnel.map((asgn) => {
                        const worker = allWorkers?.find(w => w.id === asgn.workerId);
                        const isOpLocked = ['CONFIRMED', 'ACTIVE', 'CLOSED'].includes(asgn.deploymentStatus);
                        
                        return (
                          <TableRow key={asgn.id} className={`${isOpLocked ? 'bg-slate-50/30' : ''} hover:bg-muted/20 transition-all group`}>
                            <TableCell className="pl-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary">
                                  {worker?.firstName.charAt(0)}
                                </div>
                                <div className="flex flex-col">
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-sm text-primary">{worker?.firstName} {worker?.lastName}</span>
                                    {isOpLocked && <Lock className="h-3 w-3 text-amber-600" title="Operational Lock - Finalized" />}
                                  </div>
                                  <span className="text-[10px] text-muted-foreground">National ID: {worker?.thaiNationalId.substring(0, 10)}...</span>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col">
                                <Badge variant="outline" className="w-fit text-[9px] font-black bg-white border-primary/20 text-primary mb-1">
                                  {asgn.positionId}
                                </Badge>
                                <span className="text-xs font-medium text-slate-600 truncate max-w-[150px]">{asgn.projectName}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-xs font-medium text-muted-foreground">
                              <div className="flex items-center gap-1.5">
                                <Calendar className="h-3 w-3" />
                                {asgn.startDate} - {asgn.endDate}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                <Badge variant={asgn.deploymentStatus === 'ACTIVE' ? 'default' : 'secondary'} className={asgn.deploymentStatus === 'ACTIVE' ? 'bg-green-600' : 'uppercase text-[9px]'}>
                                  {asgn.deploymentStatus}
                                </Badge>
                                {isOpLocked && <span className="text-[8px] text-amber-700 font-bold uppercase tracking-tighter">Operational Lock</span>}
                              </div>
                            </TableCell>
                            <TableCell className="text-right pr-6">
                              {isOpLocked ? (
                                <Button 
                                  size="sm" 
                                  variant="ghost" 
                                  className="text-amber-600 hover:bg-amber-50 font-bold text-xs group"
                                  onClick={() => {
                                    setSelectedAsgn(asgn);
                                    setIsExceptionOpen(true);
                                  }}
                                >
                                  <RotateCcw className="h-3 w-3 mr-1.5" /> ขอเปลี่ยนแปลง
                                </Button>
                              ) : (
                                <Button size="sm" variant="ghost" className="font-bold text-xs h-8 group">
                                  ดูประวัติ <ChevronRight className="h-4 w-4 ml-1 group-hover:translate-x-1 transition-all" />
                                </Button>
                              )}
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

          <div className="space-y-6">
            {/* Sidebar content simplified */}
            <Card className="bg-primary text-primary-foreground shadow-lg overflow-hidden border-none">
              <CardHeader className="pb-4 border-b border-white/10">
                <CardTitle className="text-sm font-black uppercase tracking-widest flex items-center gap-2">
                  <Clock className="h-4 w-4" /> Operational Policy
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                <p className="text-xs opacity-80 leading-relaxed italic">
                  การจัดการกำลังพลเป็นหัวใจสำคัญของโครงการ รายการที่ได้รับ "Operational Lock" หมายถึงพนักงานได้รับการยืนยันการปฏิบัติงานแล้ว หากจำเป็นต้องมีการเปลี่ยนแปลงกะทันหัน กรุณาใช้ปุ่ม "ขอเปลี่ยนแปลง" เพื่อดำเนินการผ่านฝ่ายปฏิบัติการ
                </p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Exception Request Dialog */}
        <Dialog open={isExceptionOpen} onOpenChange={setIsExceptionOpen}>
          <DialogContent className="border-t-8 border-t-amber-500">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <RotateCcw className="h-5 w-5 text-amber-600" /> ขอเปลี่ยนพนักงานกรณีพิเศษ (Exception Request)
              </DialogTitle>
              <DialogDescription>พนักงานรายนี้ได้รับการยืนยันเข้าปฏิบัติงานแล้ว การขอเปลี่ยนตัวต้องได้รับพิจารณาจากฝ่ายปฏิบัติการ (Operations)</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="p-3 bg-muted rounded-lg text-xs space-y-1">
                <p><b>พนักงาน:</b> {selectedAsgn?.projectName}</p>
                <p><b>เลขที่มอบหมาย:</b> {selectedAsgn?.assignmentNo}</p>
              </div>
              <div className="space-y-2">
                <Label className="font-bold text-primary">เหตุผลในการขอเปลี่ยนตัว / ยกเลิก (Reason for change)</Label>
                <Textarea 
                  placeholder="เช่น พนักงานแสดงพฤติกรรมไม่เหมาะสม, ต้องการพนักงานทักษะอื่นทดแทน..." 
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  className="min-h-[120px]"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsExceptionOpen(false)} disabled={isSubmitting}>ยกเลิก</Button>
              <Button onClick={handleRequestException} className="bg-amber-600 hover:bg-amber-700 text-white font-bold h-11 px-8" disabled={isSubmitting || !reason}>
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                ส่งคำขอให้ Operations (Submit)
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
