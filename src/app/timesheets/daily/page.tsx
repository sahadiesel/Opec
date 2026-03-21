'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Clock, 
  Plus, 
  Search, 
  Filter, 
  CheckCircle2, 
  AlertCircle, 
  Calendar, 
  User, 
  Briefcase, 
  Waves,
  Info,
  ChevronRight,
  HardHat,
  Save,
  Loader2,
  Trash2,
  Grid3X3,
  ArrowRight,
  ShieldAlert
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { DailyTimesheet, DailyTimesheetStatus, User as AppUser, Worker, Assignment, Wave, RateConditionEventType } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, orderBy, limit, doc } from 'firebase/firestore';
import { addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TimesheetService } from '@/lib/services/timesheet-service';
import { useRouter } from 'next/navigation';
import { PageGuidance } from '@/components/layout/page-guidance';
import Link from 'next/link';

const EVENT_TYPE_LABELS: Record<string, string> = {
  work_day: 'วันทำงาน (Work Day)',
  travel_day: 'วันเดินทาง (Travel)',
  standby_day: 'วันแสตนบาย (Standby)',
  off_day_worked: 'ทำงานวันหยุด (Off Day)',
  sick_leave_paid: 'ลาป่วย (Sick Leave)',
  vacation_paid: 'ลาพักร้อน (Vacation)',
  unpaid_leave: 'ลาไม่รับค่าจ้าง (Unpaid)',
};

export default function DailyTimesheetsPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const tsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'daily_timesheets'), orderBy('date', 'desc'), limit(100));
  }, [firestore]);
  const { data: timesheets, isLoading: isTsLoading } = useCollection<DailyTimesheet>(tsQuery as any);

  // STRICT ENFORCEMENT: Only workers from 'workers' collection (Field Labor)
  const workersQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'workers') : null), [firestore]);
  const { data: workers } = useCollection<Worker>(workersQuery as any);

  const mobQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'mobilizations') : null), [firestore]);
  const { data: assignments } = useCollection<Assignment>(mobQuery as any);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newTs, setNewTs] = useState<Partial<DailyTimesheet>>({
    date: new Date().toISOString().split('T')[0],
    eventType: 'work_day' as RateConditionEventType,
    shiftType: 'DAY',
    normalHours: 8,
    status: 'DRAFT'
  });

  const handleCreate = async () => {
    if (!firestore || !currentUser || !newTs.workerId || !newTs.assignmentId) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาระบุคนงาน งาน และวันที่" });
      return;
    }

    setIsCreating(true);
    try {
      const service = new TimesheetService(firestore);
      const worker = workers?.find(w => w.id === newTs.workerId);
      const asgn = assignments?.find(a => a.id === newTs.assignmentId);

      if (!asgn) throw new Error("Could not resolve assignment context");

      // CRITICAL: deriving workMode from assignment context ONLY
      await service.bulkUpsertTimesheets([{
        ...newTs,
        workerNameSnapshot: worker ? `${worker.firstName} ${worker.lastName}` : 'Unknown',
        waveId: asgn.waveId || '',
        contractId: asgn.contractId || '',
        purchaseOrderId: asgn.poId || '',
        positionId: asgn.positionId || '',
        siteId: asgn.waveId || '',
        workMode: asgn.workMode, 
        shiftType: 'DAY',
        status: 'DRAFT'
      }], currentUser);

      setIsCreateOpen(false);
      toast({ title: "บันทึกใบลงเวลาสำเร็จ" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
      setIsCreating(false);
    }
  };

  const getStatusBadge = (status: DailyTimesheetStatus) => {
    switch (status) {
      case 'DRAFT': return <Badge variant="outline" className="bg-slate-50">DRAFT</Badge>;
      case 'SUBMITTED': return <Badge variant="outline" className="bg-blue-50 text-blue-700">SUBMITTED</Badge>;
      case 'OPS_REVIEWED': return <Badge variant="outline" className="bg-amber-50 text-amber-700">OPS REVIEWED</Badge>;
      case 'CLIENT_APPROVED': return <Badge className="bg-green-600">CLIENT APPROVED</Badge>;
      case 'LOCKED': return <Badge className="bg-primary">LOCKED</Badge>;
      case 'REJECTED': return <Badge variant="destructive">REJECTED</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isUserLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
              <Clock className="h-8 w-8" /> ประวัติการลงเวลา (Timesheet History)
            </h1>
            <p className="text-muted-foreground text-lg italic">
              ตรวจสอบและติดตามสถานะใบลงเวลาทำงานรายวันของ <b>ลูกจ้างหน้างาน (Field Workers)</b>
            </p>
          </div>
          
          <div className="flex gap-2">
            <Button className="gap-2 h-11 px-6 bg-blue-600 shadow-md font-bold" asChild>
              <Link href="/timesheets/wave-board">
                <Grid3X3 className="h-5 w-5" /> ลงเวลาแบบกลุ่มเวฟ (Wave Bulk Entry)
              </Link>
            </Button>
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="gap-2 h-11 px-6 border-primary text-primary font-bold">
                  <Plus className="h-5 w-5" /> เพิ่มรายบุคคล (Manual Entry)
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-xl">
                <DialogHeader>
                  <DialogTitle>บันทึกเวลาทำงานรายวัน (Worker Timesheet)</DialogTitle>
                  <DialogDescription>บันทึกเวลาทำงานรายวันสำหรับลูกจ้างหน้างาน</DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                  <div className="space-y-2">
                    <Label className="font-bold">วันที่ปฏิบัติงาน (Date) *</Label>
                    <Input type="date" value={newTs.date} onChange={e => setNewTs({...newTs, date: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">ประเภทกะ (Shift)</Label>
                    <Select onValueChange={(v: any) => setNewTs({...newTs, shiftType: v})} value={newTs.shiftType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="DAY">กลางวัน (Day)</SelectItem>
                        <SelectItem value="NIGHT">กลางคืน (Night)</SelectItem>
                        <SelectItem value="STANDBY">สแตนด์บาย (Standby)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label className="font-bold">เลือกคนงานหน้างาน (Field Worker) *</Label>
                    <Select onValueChange={v => setNewTs({...newTs, workerId: v, assignmentId: ''})}>
                      <SelectTrigger><SelectValue placeholder="ค้นหาลูกจ้างหน้างาน (Field only)..." /></SelectTrigger>
                      <SelectContent>
                        {workers?.map(w => (
                          <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName} ({w.workerCode})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label className="font-bold">เลือกงานที่มอบหมาย (Assignment) *</Label>
                    <Select onValueChange={v => setNewTs({...newTs, assignmentId: v})} disabled={!newTs.workerId}>
                      <SelectTrigger><SelectValue placeholder="เลืองโครงการ/เวฟ..." /></SelectTrigger>
                      <SelectContent>
                        {assignments?.filter(a => a.workerId === newTs.workerId && a.deploymentStatus !== 'CLOSED').map(a => (
                          <SelectItem key={a.id} value={a.id}>{a.projectName} ({a.assignmentNo})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">ประเภทเหตุการณ์ (Event) *</Label>
                    <Select onValueChange={(v: any) => setNewTs({...newTs, eventType: v})} value={newTs.eventType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">ชั่วโมงงานปกติ (Normal Hrs)</Label>
                    <Input type="number" value={newTs.normalHours} onChange={e => setNewTs({...newTs, normalHours: parseInt(e.target.value)})} />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsCreateOpen(false)}>ยกเลิก</Button>
                  <Button onClick={handleCreate} className="bg-primary font-bold" disabled={isCreating}>
                    {isCreating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                    บันทึกข้อมูล (Save)
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <Alert className="bg-amber-50 border-amber-200 text-amber-800 shadow-sm">
          <ShieldAlert className="h-5 w-5 text-amber-600" />
          <AlertTitle className="font-bold">ข้อควรระวัง (Data Integrity Rule)</AlertTitle>
          <AlertDescription className="text-sm">
            ระบบลงเวลานี้ใช้สำหรับ <b>ลูกจ้างหน้างาน (Field Workers)</b> เพื่อคำนวณรายรับโครงการและจ่ายเงินเดือนคนงาน ห้ามนำพนักงานออฟฟิศมาบันทึกเวลาในส่วนนี้
          </AlertDescription>
        </Alert>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isTsLoading ? (
              <div className="py-20 text-center animate-pulse italic">กำลังโหลดข้อมูลใบลงเวลา...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="pl-6 py-4 font-bold">วันที่ (Date)</TableHead>
                    <TableHead className="font-bold">คนงาน (Worker)</TableHead>
                    <TableHead className="font-bold">ประเภทงาน (Event)</TableHead>
                    <TableHead className="font-bold">โครงการ (Project)</TableHead>
                    <TableHead className="font-bold text-center">ชั่วโมง (Hrs)</TableHead>
                    <TableHead className="font-bold">สถานะ (Status)</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {timesheets?.map((ts) => {
                    const worker = workers?.find(w => w.id === ts.workerId);
                    return (
                      <TableRow key={ts.id} className="hover:bg-muted/30 transition-colors">
                        <TableCell className="pl-6 py-4">
                          <div className="flex items-center gap-2 text-sm font-bold text-primary">
                            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                            {ts.date}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-bold text-sm">{ts.workerNameSnapshot}</span>
                            <span className="text-[10px] text-muted-foreground uppercase">{worker?.workerCode || '-'}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px] bg-white border-primary/20">
                            {EVENT_TYPE_LABELS[ts.eventType] || ts.eventType}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 text-xs">
                            <Briefcase className="h-3 w-3 text-muted-foreground" />
                            <span className="truncate max-w-[150px]">{ts.projectName}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center font-black">{ts.normalHours}</TableCell>
                        <TableCell>{getStatusBadge(ts.status)}</TableCell>
                        <TableCell className="text-right pr-6">
                          <Button variant="ghost" size="icon"><ChevronRight className="h-4 w-4" /></Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {(!timesheets || timesheets.length === 0) && !isTsLoading && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-20 text-muted-foreground italic">ไม่พบข้อมูลการลงเวลาในระบบ</TableCell>
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