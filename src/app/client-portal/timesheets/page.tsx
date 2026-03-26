
'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  FileText, 
  Search, 
  Filter, 
  Calendar,
  Clock,
  ChevronRight,
  FileCheck,
  Eye,
  MessageSquareWarning,
  Info,
  UserCheck,
  PenTool,
  Paperclip,
  Download,
  ShieldCheck,
  Loader2,
  Lock,
  AlertTriangle,
  RotateCcw
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { User as AppUser, DailyTimesheet, Worker } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { PageGuidance } from '@/components/layout/page-guidance';
import { CustomerQueryService } from '@/lib/services/customer-query-service';
import { DisputeService } from '@/lib/services/dispute-service';
import { ExceptionRequestService } from '@/lib/services/exception-request-service';
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
import { Separator } from '@/components/ui/separator';

const EVENT_TYPE_LABELS: Record<string, string> = {
  work_day: 'วันทำงาน (Work)',
  travel_day: 'วันเดินทาง (Travel)',
  standby_day: 'สแตนด์บาย (Standby)',
  off_day_worked: 'ทำงานวันหยุด',
};

export default function ClientTimesheetViewPage() {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [searchTerm, setSearchTerm] = useState('');
  const [isDisputeOpen, setIsDisputeOpen] = useState(false);
  const [isExceptionOpen, setIsExceptionOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedTs, setSelectedTs] = useState<DailyTimesheet | null>(null);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  // 1. Data Queries using Scoping Service
  const tsQuery = useMemoFirebase(() => {
    if (!firestore || !currentUser) return null;
    const service = new CustomerQueryService(firestore);
    const baseQuery = service.getScopedTimesheetsQuery(currentUser);
    
    if (!baseQuery) return null;

    return query(
      baseQuery,
      where('status', 'in', ['CLIENT_APPROVED', 'VERIFIED_PAPER', 'LOCKED', 'OPS_REVIEWED', 'HR_APPROVED', 'SUBMITTED'])
    );
  }, [firestore, currentUser]);
  
  const { data: timesheets, isLoading: isTsLoading } = useCollection<DailyTimesheet>(tsQuery as any);

  const filteredTimesheets = useMemo(() => {
    if (!timesheets) return [];
    return timesheets.filter(ts => 
      ts.workerNameSnapshot.toLowerCase().includes(searchTerm.toLowerCase()) ||
      ts.date.includes(searchTerm) ||
      ts.sourceDocumentNo?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [timesheets, searchTerm]);

  const handleReportIssue = async () => {
    if (!selectedTs || !comment || !firestore || !currentUser) return;
    
    setIsSubmitting(true);
    try {
      const service = new DisputeService(firestore);
      await service.reportIssue({
        category: 'TIMESHEET',
        referenceId: selectedTs.id,
        referenceNo: selectedTs.sourceDocumentNo || `TS-${selectedTs.date}`,
        description: comment
      }, currentUser);

      toast({ 
        title: "รับเรื่องตรวจสอบแล้ว (Request Received)", 
        description: "เจ้าหน้าที่ OPEC จะตรวจสอบหลักฐานและติดต่อกลับโดยเร็ว" 
      });
      setIsDisputeOpen(false);
      setComment('');
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestException = async () => {
    if (!selectedTs || !comment || !firestore || !currentUser) return;
    
    setIsSubmitting(true);
    try {
      const service = new ExceptionRequestService(firestore);
      await service.createRequest({
        type: 'TIMESHEET_CORRECTION',
        referenceId: selectedTs.id,
        referenceNo: selectedTs.sourceDocumentNo || `TS-${selectedTs.date}`,
        reason: comment,
        user: currentUser
      });

      toast({ 
        title: "ส่งคำขอแก้ไขกรณีพิเศษสำเร็จ", 
        description: "ฝ่ายบุคคล (HR) จะตรวจสอบเหตุผลและติดต่อกลับเพื่อดำเนินการ" 
      });
      setIsExceptionOpen(false);
      setComment('');
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const openDetail = (ts: DailyTimesheet) => {
    setSelectedTs(ts);
    setIsDetailOpen(true);
  };

  if (isUserLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <FileText className="h-8 w-8 text-primary" /> ประวัติและหลักฐานการลงเวลางาน (Activity & Evidence)
          </h1>
          <p className="text-muted-foreground text-lg italic">
            ตรวจสอบรายละเอียดชั่วโมงทำงานรายวัน พร้อมข้อมูลอ้างอิงจากใบลงเวลาฉบับจริง (Operational transparency).
          </p>
        </div>

        <PageGuidance 
          title="นโยบายความโปร่งใส (Transparency Policy)"
          tips={[
            "รายการ 'VERIFIED (PAPER)' คือรายการที่ได้รับการตรวจสอบลายเซ็นจากใบ Slip ฉบับจริงโดยเจ้าหน้าที่ OPEC แล้ว",
            "รายการที่สถานะเป็น 'LOCKED' หรือ 'HR APPROVED' จะถูกส่งเข้ากระบวนการจ่ายเงินแล้ว ไม่สามารถแจ้งปัญหาปกติได้",
            "หากจำเป็นต้องแก้ไขรายการที่ล็อกแล้ว กรุณาใช้ปุ่ม 'ขอแก้ไขกรณีพิเศษ' เพื่อส่งเรื่องให้ฝ่ายบุคคลพิจารณา"
          ]}
        />

        <div className="flex items-center gap-3 bg-card p-4 rounded-lg border shadow-sm">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="ค้นหาตามวันที่ หรือเลขที่ Slip..." 
              className="pl-9 h-11" 
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <Button variant="outline" className="h-11 gap-2"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
        </div>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardHeader className="bg-muted/30 border-b">
            <CardTitle className="text-lg">บันทึกเวลาปฏิบัติงาน (Confirmed Activity Logs)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isTsLoading ? (
              <div className="py-20 text-center animate-pulse italic">กำลังโหลดข้อมูลใบลงเวลา...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="pl-6 py-4 font-bold">วันที่ (Date)</TableHead>
                    <TableHead className="font-bold">พนักงาน (Personnel)</TableHead>
                    <TableHead className="font-bold">หลักฐาน (Slip No.)</TableHead>
                    <TableHead className="font-bold">กิจกรรม (Event)</TableHead>
                    <TableHead className="text-center font-bold">ชั่วโมงทำงาน</TableHead>
                    <TableHead className="font-bold text-right pr-6">สถานะ (Status)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTimesheets.map((ts) => {
                    const isLocked = ts.status === 'LOCKED' || ts.status === 'HR_APPROVED';
                    return (
                      <TableRow key={ts.id} className={`${isLocked ? 'bg-slate-50/50' : 'hover:bg-muted/20'} transition-all group cursor-pointer`} onClick={() => openDetail(ts)}>
                        <TableCell className="pl-6 py-4">
                          <div className="flex items-center gap-2 text-sm font-bold text-primary">
                            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                            {ts.date}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-bold text-sm">{ts.workerNameSnapshot}</span>
                            <span className="text-[10px] text-muted-foreground uppercase font-medium">{ts.positionId}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {ts.sourceDocumentNo ? (
                            <div className="flex flex-col">
                              <span className="text-xs font-mono font-bold text-blue-700 flex items-center gap-1">
                                <PenTool className="h-3 w-3" /> {ts.sourceDocumentNo}
                              </span>
                              <span className="text-[9px] text-muted-foreground uppercase">{ts.sourceType} Source</span>
                            </div>
                          ) : (
                            <span className="text-[10px] text-muted-foreground italic">No Ref</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px] bg-white border-primary/20">
                            {EVENT_TYPE_LABELS[ts.eventType] || ts.eventType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center font-black">
                          {ts.normalHours} Hrs
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <div className="flex justify-end gap-2 items-center">
                            {isLocked && <span title="Locked - Finalized"><Lock className="h-3 w-3 text-amber-600" aria-hidden /></span>}
                            <Badge variant={ts.status === 'VERIFIED_PAPER' ? 'default' : 'outline'} className={ts.status === 'VERIFIED_PAPER' ? 'bg-blue-700 text-[10px]' : 'uppercase text-[9px]'}>
                              {ts.status === 'VERIFIED_PAPER' ? 'VERIFIED' : ts.status}
                            </Badge>
                            <ChevronRight className="h-4 w-4 text-muted-foreground opacity-30 group-hover:opacity-100 transition-all" />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Timesheet Detail & Evidence Dialog */}
        <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
          <DialogContent className="max-w-2xl border-t-8 border-t-primary">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-xl font-bold">
                <FileCheck className="h-6 w-6 text-primary" /> รายละเอียดบันทึกเวลา (Evidence Details)
              </DialogTitle>
              <DialogDescription>ข้อมูลสรุปและหลักฐานอ้างอิงสำหรับการตรวจสอบ (Read-only view)</DialogDescription>
            </DialogHeader>

            {selectedTs && (
              <div className="space-y-6 py-4">
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase font-black text-muted-foreground">พนักงาน (Personnel):</Label>
                    <p className="font-bold text-primary">{selectedTs.workerNameSnapshot}</p>
                    <p className="text-xs text-muted-foreground uppercase font-medium">{selectedTs.positionId}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase font-black text-muted-foreground">วันที่ (Work Date):</Label>
                    <p className="font-bold flex items-center gap-2"><Calendar className="h-4 w-4" /> {selectedTs.date}</p>
                  </div>
                </div>

                <Separator />

                <div className="grid grid-cols-3 gap-4">
                  <div className="p-3 bg-muted/30 rounded-lg border text-center">
                    <p className="text-[10px] uppercase text-muted-foreground font-bold mb-1">กิจกรรม</p>
                    <Badge variant="secondary" className="text-[10px] uppercase">{selectedTs.eventType}</Badge>
                  </div>
                  <div className="p-3 bg-muted/30 rounded-lg border text-center">
                    <p className="text-[10px] uppercase text-muted-foreground font-bold mb-1">ชั่วโมงปกติ</p>
                    <p className="text-lg font-black text-primary">{selectedTs.normalHours} Hrs</p>
                  </div>
                  <div className="p-3 bg-muted/30 rounded-lg border text-center">
                    <p className="text-[10px] uppercase text-muted-foreground font-bold mb-1">สถานะ</p>
                    <Badge className="bg-green-600 text-[10px] uppercase">{selectedTs.status}</Badge>
                  </div>
                </div>

                <div className="space-y-3 bg-primary/5 p-4 rounded-xl border border-primary/10">
                  <h4 className="text-xs font-black uppercase text-primary flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4" /> รายละเอียดการตรวจสอบ (Audit Evidence)
                  </h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="space-y-1">
                      <span className="text-[10px] text-muted-foreground uppercase font-bold">Slip No.:</span>
                      <p className="font-mono font-bold text-blue-700">{selectedTs.sourceDocumentNo || 'N/A'}</p>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] text-muted-foreground uppercase font-bold">Evidence Type:</span>
                      <p className="font-bold">{selectedTs.sourceType || 'PAPER'}</p>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <Button variant="outline" className="flex-1 gap-2 font-bold" disabled>
                    <Download className="h-4 w-4" /> Download PDF Proof
                  </Button>
                  
                  {(selectedTs.status === 'LOCKED' || selectedTs.status === 'HR_APPROVED') ? (
                    <Button 
                      variant="ghost" 
                      className="text-amber-600 hover:bg-amber-50 font-bold"
                      onClick={() => {
                        setIsDetailOpen(false);
                        setIsExceptionOpen(true);
                      }}
                    >
                      <RotateCcw className="h-4 w-4 mr-2" /> ขอแก้ไขกรณีพิเศษ
                    </Button>
                  ) : (
                    <Button 
                      variant="ghost" 
                      className="text-destructive hover:bg-destructive/5 font-bold"
                      onClick={() => {
                        setIsDetailOpen(false);
                        setIsDisputeOpen(true);
                      }}
                    >
                      <MessageSquareWarning className="h-4 w-4 mr-2" /> แจ้งปัญหา (Report Issue)
                    </Button>
                  )}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Standard Dispute Dialog */}
        <Dialog open={isDisputeOpen} onOpenChange={setIsDisputeOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>แจ้งปัญหาข้อมูลไม่ถูกต้อง (Report Discrepancy)</DialogTitle>
              <DialogDescription>ระบุรายละเอียดข้อมูลที่ต้องการให้เจ้าหน้าที่ OPEC ตรวจสอบแก้ไข</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="p-3 bg-muted rounded-lg text-xs space-y-1">
                <p><b>พนักงาน:</b> {selectedTs?.workerNameSnapshot}</p>
                <p><b>วันที่:</b> {selectedTs?.date}</p>
                <p><b>Slip No.:</b> {selectedTs?.sourceDocumentNo || '-'}</p>
              </div>
              <div className="space-y-2">
                <Label className="font-bold text-primary">รายละเอียดปัญหา / ข้อมูลที่ถูกต้อง</Label>
                <Textarea 
                  placeholder="เช่น จำนวนชั่วโมงไม่ตรงกับใบ Slip, ประเภทงานไม่ถูกต้อง..." 
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  className="min-h-[120px]"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDisputeOpen(false)} disabled={isSubmitting}>ยกเลิก</Button>
              <Button onClick={handleReportIssue} className="bg-primary font-bold shadow-lg h-11 px-8" disabled={isSubmitting || !comment}>
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                ส่งเรื่องตรวจสอบ (Submit Query)
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Exception Request Dialog */}
        <Dialog open={isExceptionOpen} onOpenChange={setIsExceptionOpen}>
          <DialogContent className="border-t-8 border-t-amber-500">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <RotateCcw className="h-5 w-5 text-amber-600" /> ขอแก้ไขข้อมูลที่อนุมัติแล้ว (Special Exception)
              </DialogTitle>
              <DialogDescription>เนื่องจากข้อมูลถูกล็อกเพื่อสรุปยอดเงินแล้ว การแก้ไขต้องได้รับการพิจารณาจากฝ่ายบุคคล (HR) เป็นกรณีพิเศษ</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="bg-amber-50 p-3 rounded border border-amber-100 text-[10px] text-amber-800 leading-relaxed">
                <Info className="h-3 w-3 inline mr-1" />
                คำขอนี้จะถูกส่งไปยังคิวงานของ HR Manager โดยตรง กรุณาระบุเหตุผลที่ชัดเจนว่าเหตุใดจึงต้องมีการปรับเปลี่ยนหลังจากมีการยืนยันยอดแล้ว
              </div>
              <div className="space-y-2">
                <Label className="font-bold text-primary">เหตุผลความจำเป็นในการแก้ไข (Reason for Special Correction)</Label>
                <Textarea 
                  placeholder="กรุณาระบุรายละเอียดข้อผิดพลาดที่ตรวจพบ..." 
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  className="min-h-[120px]"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsExceptionOpen(false)} disabled={isSubmitting}>ยกเลิก</Button>
              <Button onClick={handleRequestException} className="bg-amber-600 hover:bg-amber-700 text-white font-bold h-11 px-8" disabled={isSubmitting || !comment}>
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                ส่งคำขอให้ HR (Submit to HR)
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
