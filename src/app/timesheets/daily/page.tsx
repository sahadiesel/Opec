
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
  ShieldAlert,
  Send,
  FileCheck,
  FileText,
  UserCheck,
  PenTool,
  Coins,
  Receipt,
  RotateCcw,
  Lock
} from 'lucide-react';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { Input } from '@/components/ui/input';
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue } from '@/lib/date-thai';
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
import { Separator } from '@/components/ui/separator';

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

  const workersQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'workers') : null), [firestore]);
  const { data: workers } = useCollection<Worker>(workersQuery as any);

  const mobQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'mobilizations') : null), [firestore]);
  const { data: assignments } = useCollection<Assignment>(mobQuery as any);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newTs, setNewTs] = useState<Partial<DailyTimesheet>>({
    date: timestampToHtmlDateValue(Date.now()),
    eventType: 'work_day' as RateConditionEventType,
    shiftType: 'DAY',
    normalHours: 8,
    status: 'DRAFT',
    readyForPayroll: false,
    readyForBilling: false,
    sourceType: 'PAPER',
    sourceDocumentNo: '',
    supervisorSignedBy: '',
    clientSignedBy: '',
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

      await service.bulkUpsertTimesheets([{
        ...newTs,
        workerNameSnapshot: worker ? `${worker.firstName} ${worker.lastName}` : 'Unknown',
        waveId: asgn.waveId || '',
        contractId: asgn.contractId || '',
        purchaseOrderId: asgn.poId || '',
        poLineId: asgn.poLineId || '',
        positionId: asgn.positionId || '',
        siteId: asgn.waveId || '',
        workMode: asgn.workMode, 
        shiftType: 'DAY',
        status: 'DRAFT',
        readyForPayroll: false,
        readyForBilling: false,
        officeEnteredBy: currentUser.displayName,
        officeEnteredAt: Date.now()
      }], currentUser);

      setIsCreateOpen(false);
      setNewTs({
        date: timestampToHtmlDateValue(Date.now()),
        eventType: 'work_day',
        shiftType: 'DAY',
        normalHours: 8,
        status: 'DRAFT',
        readyForPayroll: false,
        readyForBilling: false,
        sourceType: 'PAPER',
        sourceDocumentNo: '',
        supervisorSignedBy: '',
        clientSignedBy: '',
      });
      toast({ title: "บันทึกใบลงเวลาสำเร็จ" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
      setIsCreating(false);
    }
  };

  const handleSubmitReview = async (tsId: string) => {
    if (!firestore || !currentUser) return;
    try {
      const service = new TimesheetService(firestore);
      await service.submitTimesheet(tsId, currentUser);
      toast({ title: "ส่งข้อมูลตรวจรับสำเร็จ", description: "รายการถูกส่งไปยังผู้จัดการเพื่อตรวจสอบภายใน" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    }
  };

  const handleVerifyPaper = async (tsId: string) => {
    if (!firestore || !currentUser) return;
    if (!confirm('ยืนยันว่าได้รับเอกสารที่มีลายเซ็นลูกค้าแล้วใช่หรือไม่?')) return;
    
    try {
      const service = new TimesheetService(firestore);
      await service.markAsVerifiedPaper(tsId, currentUser);
      toast({ title: "ยืนยันหลักฐานกระดาษสำเร็จ", description: "รายการนี้พร้อมสำหรับการสรุปยอด Payroll/Billing แล้ว" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    }
  };

  const handleRequestCorrection = async (tsId: string) => {
    if (!firestore || !currentUser) return;
    const reason = prompt('กรุณาระบุเหตุผลที่ต้องแก้ไข (Reason for correction):');
    if (!reason) return;

    try {
      const service = new TimesheetService(firestore);
      await service.requestCorrection(tsId, currentUser, reason);
      toast({ title: "ส่งกลับไปแก้ไขสำเร็จ", description: "รายการนี้ถูกดึงออกจากระบบสรุปยอดแล้ว" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Action Failed", description: e.message });
    }
  };

  const getStatusBadge = (status: DailyTimesheetStatus) => {
    switch (status) {
      case 'DRAFT': return <Badge variant="outline" className="bg-slate-50">DRAFT</Badge>;
      case 'SUBMITTED': return <Badge variant="outline" className="bg-blue-50 text-blue-700">SUBMITTED</Badge>;
      case 'OPS_REVIEWED': return <Badge variant="outline" className="bg-amber-50 text-amber-700">OPS REVIEWED</Badge>;
      case 'CLIENT_APPROVED': return <Badge className="bg-green-600">CLIENT APPROVED</Badge>;
      case 'VERIFIED_PAPER': return <Badge className="bg-blue-700 text-white font-bold"><FileCheck className="h-3 w-3 mr-1" /> VERIFIED PAPER</Badge>;
      case 'LOCKED': return <Badge className="bg-primary font-black uppercase"><Lock className="h-3 w-3 mr-1" /> LOCKED</Badge>;
      case 'REJECTED': return <Badge variant="destructive">REJECTED</Badge>;
      case 'CORRECTION_REQUIRED': return <Badge variant="outline" className="border-red-500 text-red-600 bg-red-50 animate-pulse">CORRECTION</Badge>;
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
                  <Plus className="h-5 w-5" /> บันทึกรายบุคคล (Manual Entry)
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>บันทึกเวลาทำงานจากหลักฐานกระดาษ (Entry from Paper)</DialogTitle>
                  <DialogDescription>กรอกข้อมูลเวลาทำงานที่อ้างอิงจากใบลงเวลาที่เซ็นรับรองแล้ว</DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                  <div className="space-y-2">
                    <Label className="font-bold">วันที่ปฏิบัติงาน (Date) *</Label>
                    <DatePickerThaiBE
                      className="h-10"
                      value={htmlDateValueToTimestampMs(newTs.date)}
                      onChange={(ms) => setNewTs({ ...newTs, date: timestampToHtmlDateValue(ms) })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">ประเภทกะ (Shift)</Label>
                    <Select onValueChange={(v: any) => setNewTs({...newTs, shiftType: v})} value={newTs.shiftType}>
                      <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
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
                      <SelectTrigger className="h-10"><SelectValue placeholder="ค้นหาลูกจ้างหน้างาน (Field only)..." /></SelectTrigger>
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
                      <SelectTrigger className="h-10"><SelectValue placeholder="เลือกโครงการ/เวฟ..." /></SelectTrigger>
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
                      <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">ชั่วโมงงานปกติ (Normal Hrs)</Label>
                    <Input type="number" className="h-10 font-bold" value={newTs.normalHours} onChange={e => setNewTs({...newTs, normalHours: parseInt(e.target.value)})} />
                  </div>

                  <Separator className="md:col-span-2 my-2" />
                  
                  <div className="space-y-2 md:col-span-2">
                    <Label className="font-bold text-blue-700 flex items-center gap-2">
                      <FileCheck className="h-4 w-4" /> ข้อมูลหลักฐานและการยืนยัน (Evidence & Confirmation)
                    </Label>
                  </div>

                  <div className="space-y-2">
                    <Label className="font-bold">เลขที่ใบลงเวลา (Slip No.)</Label>
                    <Input value={newTs.sourceDocumentNo} onChange={e => setNewTs({...newTs, sourceDocumentNo: e.target.value})} placeholder="ระบุเลขที่ใบ slip..." className="h-10" />
                  </div>

                  <div className="space-y-2">
                    <Label className="font-bold">ประเภทแหล่งข้อมูล</Label>
                    <Select onValueChange={(v: any) => setNewTs({...newTs, sourceType: v})} value={newTs.sourceType}>
                      <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PAPER">ใบลงเวลากระดาษ (Paper)</SelectItem>
                        <SelectItem value="DIGITAL">บันทึกดิจิทัล (Digital)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="font-bold">ผู้ควบคุมงานที่ลงนาม (Supervisor)</Label>
                    <Input value={newTs.supervisorSignedBy} onChange={e => setNewTs({...newTs, supervisorSignedBy: e.target.value})} placeholder="ชื่อผู้เซ็นคุมงาน..." className="h-10" />
                  </div>

                  <div className="space-y-2">
                    <Label className="font-bold">ลูกค้าที่ลงนาม (Client Signatory)</Label>
                    <Input value={newTs.clientSignedBy} onChange={e => setNewTs({...newTs, clientSignedBy: e.target.value})} placeholder="ชื่อลูกค้าที่เซ็นรับรอง..." className="h-10" />
                  </div>
                </div>
                <DialogFooter className="bg-muted/30 -mx-6 -mb-6 p-4 mt-2 border-t">
                  <Button variant="outline" onClick={() => setIsCreateOpen(false)}>ยกเลิก</Button>
                  <Button onClick={handleCreate} className="bg-primary font-bold px-8 shadow-md" disabled={isCreating}>
                    {isCreating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                    บันทึกข้อมูล (Confirm Entry)
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <PageGuidance 
          tips={[
            "รายการที่สถานะเป็น 'LOCKED' ถูกนำเข้าสู่กระบวนการจ่ายเงินแล้ว จะไม่สามารถแก้ไขหรือส่งกลับได้",
            "หากต้องการแก้ไขรายการที่ 'APPROVED' แล้วแต่ยังไม่ถูก 'LOCKED' ให้ใช้ปุ่ม 'Flag for Correction'",
            "การ Flag Correction จะรีเซ็ตสถานะการจ่ายเงินและการวางบิลของรายการนั้นทันทีเพื่อความปลอดภัย"
          ]}
        />

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
                    <TableHead className="font-bold">อ้างอิงเอกสาร (Evidence)</TableHead>
                    <TableHead className="font-bold text-center">ชั่วโมง (Hrs)</TableHead>
                    <TableHead className="font-bold">Readiness (P/B)</TableHead>
                    <TableHead className="font-bold">สถานะ (Status)</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {timesheets?.map((ts) => {
                    const worker = workers?.find(w => w.id === ts.workerId);
                    const canSubmit = ts.status === 'DRAFT' || ts.status === 'REJECTED' || ts.status === 'CORRECTION_REQUIRED';
                    const canVerifyPaper = ts.status === 'OPS_REVIEWED';
                    const canRequestCorrection = ts.status === 'CLIENT_APPROVED' || ts.status === 'VERIFIED_PAPER';
                    const isLocked = ts.status === 'LOCKED';
                    
                    return (
                      <TableRow key={ts.id} className={`${isLocked ? "bg-slate-50/50" : "hover:bg-muted/30"} transition-colors`}>
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
                          {ts.sourceDocumentNo ? (
                            <div className="flex flex-col">
                              <span className="text-xs font-mono font-bold text-blue-700 flex items-center gap-1">
                                <FileText className="h-3 w-3" /> {ts.sourceDocumentNo}
                              </span>
                              <span className="text-[9px] text-muted-foreground uppercase flex items-center gap-1">
                                {ts.sourceType === 'PAPER' ? <PenTool className="h-2 w-2" /> : <UserCheck className="h-2 w-2" />}
                                {ts.sourceType || 'N/A'}
                              </span>
                            </div>
                          ) : (
                            <span className="text-[10px] text-muted-foreground italic">No evidence ref</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center font-black">{ts.normalHours}</TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-1.5">
                            <Badge variant={ts.readyForPayroll ? "default" : "outline"} className={`text-[8px] h-5 px-1 ${ts.readyForPayroll ? "bg-green-600" : "text-muted-foreground opacity-40"}`}>
                              <Coins className="h-2 w-2 mr-1" /> PAY
                            </Badge>
                            <Badge variant={ts.readyForBilling ? "default" : "outline"} className={`text-[8px] h-5 px-1 ${ts.readyForBilling ? "bg-blue-600" : "text-muted-foreground opacity-40"}`}>
                              <Receipt className="h-2 w-2 mr-1" /> BILL
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell>{getStatusBadge(ts.status)}</TableCell>
                        <TableCell className="text-right pr-6">
                          <div className="flex justify-end gap-2">
                            {canSubmit && (
                              <Button size="sm" variant="outline" className="h-8 gap-1 text-blue-700 border-blue-200 bg-blue-50 font-bold" onClick={() => handleSubmitReview(ts.id)}>
                                <Send className="h-3 w-3" /> ส่งตรวจ
                              </Button>
                            )}
                            {canVerifyPaper && (
                              <Button size="sm" variant="outline" className="h-8 gap-1 text-green-700 border-blue-200 bg-blue-50 font-bold" onClick={() => handleVerifyPaper(ts.id)}>
                                <FileCheck className="h-3 w-3" /> ยืนยันกระดาษ
                              </Button>
                            )}
                            {canRequestCorrection && (
                              <Button size="sm" variant="ghost" className="h-8 gap-1 text-red-600 hover:text-red-700 hover:bg-red-50 font-bold" onClick={() => handleRequestCorrection(ts.id)}>
                                <RotateCcw className="h-3 w-3" /> Flag Correction
                              </Button>
                            )}
                            {isLocked && <Lock className="h-4 w-4 text-muted-foreground/40 self-center mr-2" />}
                            <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                              <Link href={`/timesheets/daily/${ts.id}`}><ChevronRight className="h-4 w-4" /></Link>
                            </Button>
                          </div>
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
