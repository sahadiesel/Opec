
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
  HardHat,
  Clock,
  ChevronRight,
  AlertCircle,
  FileCheck,
  Eye,
  MessageSquareWarning,
  Info
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { User as AppUser, DailyTimesheet, Worker } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where, doc, updateDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { PageGuidance } from '@/components/layout/page-guidance';
import { CustomerQueryService } from '@/lib/services/customer-query-service';
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
  const [selectedTs, setSelectedTs] = useState<DailyTimesheet | null>(null);
  const [disputeComment, setDisputeComment] = useState('');

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

    // Filter for finalized logs that the client should see
    return query(
      baseQuery,
      where('status', 'in', ['CLIENT_APPROVED', 'VERIFIED_PAPER', 'LOCKED', 'OPS_REVIEWED'])
    );
  }, [firestore, currentUser]);
  
  const { data: timesheets, isLoading: isTsLoading } = useCollection<DailyTimesheet>(tsQuery as any);

  const workersQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'workers') : null), [firestore]);
  const { data: workers } = useCollection<Worker>(workersQuery as any);

  const filteredTimesheets = useMemo(() => {
    if (!timesheets) return [];
    return timesheets.filter(ts => 
      ts.workerNameSnapshot.toLowerCase().includes(searchTerm.toLowerCase()) ||
      ts.date.includes(searchTerm)
    );
  }, [timesheets, searchTerm]);

  const handleReportIssue = () => {
    if (!selectedTs || !disputeComment) return;
    // In a real system, this would create a 'dispute' or 'support_ticket' entity
    toast({ title: "รับเรื่องตรวจสอบแล้ว", description: "OPEC Operations จะติดต่อกลับเพื่อยืนยันข้อมูล" });
    setIsDisputeOpen(false);
    setDisputeComment('');
  };

  if (isUserLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <FileText className="h-8 w-8" /> ประวัติการลงเวลางาน (Daily Activity Summary)
          </h1>
          <p className="text-muted-foreground text-lg italic">
            สรุปข้อมูลชั่วโมงการทำงานรายวันของพนักงานที่สรุปยอดแล้ว (Finalized daily logs and evidence).
          </p>
        </div>

        <PageGuidance 
          title="ข้อมูลบันทึกเวลาทำงาน"
          tips={[
            "รายการที่มีสถานะ 'Verified (Paper)' คือรายการที่ท่านได้ลงนามรับรองในเอกสารฉบับจริงแล้ว",
            "ท่านสามารถดูรายละเอียดชั่วโมงทำงานปกติและโอทีเพื่อใช้ในการตรวจสอบยอดวางบิลรายเดือน",
            "หากพบข้อมูลไม่ถูกต้อง กรุณากดปุ่ม 'แจ้งปัญหา' เพื่อแจ้งให้เจ้าหน้าที่ OPEC ดำเนินการตรวจสอบ"
          ]}
        />

        <div className="flex items-center gap-3 bg-card p-4 rounded-lg border shadow-sm">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="ค้นหาตามชื่อพนักงาน หรือ วันที่..." 
              className="pl-9 h-11" 
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <Button variant="outline" className="h-11 gap-2"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
        </div>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardHeader className="bg-muted/30 border-b">
            <CardTitle className="text-lg">บันทึกเวลาสะสม (Activity Logs)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isTsLoading ? (
              <div className="py-20 text-center animate-pulse">กำลังโหลดข้อมูลใบลงเวลา...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="pl-6 py-4 font-bold">วันที่ (Date)</TableHead>
                    <TableHead className="font-bold">พนักงาน (Personnel)</TableHead>
                    <TableHead className="font-bold">กิจกรรม (Event)</TableHead>
                    <TableHead className="text-center font-bold">ชั่วโมงทำงาน</TableHead>
                    <TableHead className="font-bold">สถานะการรับรอง</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTimesheets.map((ts) => (
                    <TableRow key={ts.id} className="hover:bg-muted/20 transition-all group">
                      <TableCell className="pl-6 py-4">
                        <div className="flex items-center gap-2 text-sm font-bold text-primary">
                          <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                          {ts.date}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-bold text-sm">{ts.workerNameSnapshot}</span>
                          <span className="text-[10px] text-muted-foreground uppercase">{ts.positionId}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] bg-white border-primary/20">
                          {EVENT_TYPE_LABELS[ts.eventType] || ts.eventType}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center font-black">
                        {ts.normalHours} Hrs
                      </TableCell>
                      <TableCell>
                        {ts.status === 'VERIFIED_PAPER' ? (
                          <Badge className="bg-blue-700 text-white font-bold gap-1">
                            <FileCheck className="h-3 w-3" /> VERIFIED (PAPER)
                          </Badge>
                        ) : ts.status === 'CLIENT_APPROVED' || ts.status === 'LOCKED' ? (
                          <Badge className="bg-green-600 font-bold">CERTIFIED</Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-blue-50 text-blue-700">IN REVIEW</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <div className="flex justify-end gap-2">
                          <Dialog open={isDisputeOpen && selectedTs?.id === ts.id} onOpenChange={(open) => {
                            setIsDisputeOpen(open);
                            if (open) setSelectedTs(ts);
                          }}>
                            <DialogTrigger asChild>
                              <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive gap-1">
                                <MessageSquareWarning className="h-3.5 w-3.5" /> แจ้งปัญหา
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>แจ้งปัญหาข้อมูลไม่ถูกต้อง (Report Discrepancy)</DialogTitle>
                                <DialogDescription>ระบุรายละเอียดข้อมูลที่ต้องการให้เจ้าหน้าที่ OPEC ตรวจสอบแก้ไข</DialogDescription>
                              </DialogHeader>
                              <div className="space-y-4 py-4">
                                <div className="p-3 bg-muted rounded-lg text-xs space-y-1">
                                  <p><b>พนักงาน:</b> {ts.workerNameSnapshot}</p>
                                  <p><b>วันที่:</b> {ts.date}</p>
                                </div>
                                <div className="space-y-2">
                                  <Label className="font-bold">รายละเอียดปัญหา / ข้อมูลที่ถูกต้อง</Label>
                                  <Textarea 
                                    placeholder="เช่น จำนวนชั่วโมงไม่ตรงกับใบ Slip, ประเภทงานไม่ถูกต้อง..." 
                                    value={disputeComment}
                                    onChange={e => setDisputeComment(e.target.value)}
                                  />
                                </div>
                              </div>
                              <DialogFooter>
                                <Button variant="outline" onClick={() => setIsDisputeOpen(false)}>ยกเลิก</Button>
                                <Button onClick={handleReportIssue} className="bg-primary font-bold">ส่งเรื่องตรวจสอบ</Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                          
                          <Button size="sm" variant="outline" className="font-bold text-xs h-8">
                            <Eye className="h-3.5 w-3.5 mr-1.5" /> ดู Slip
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredTimesheets.length === 0 && !isTsLoading && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-20 text-muted-foreground italic">ไม่พบบันทึกชั่วโมงทำงานในช่วงเวลานี้</TableCell>
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
