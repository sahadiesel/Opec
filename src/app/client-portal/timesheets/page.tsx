
'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  ClipboardCheck, 
  CheckCircle2, 
  XCircle, 
  Search, 
  Filter, 
  Calendar,
  User,
  Clock,
  ChevronRight,
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

const EVENT_TYPE_LABELS: Record<string, string> = {
  work_day: 'วันทำงาน (Work)',
  travel_day: 'วันเดินทาง (Travel)',
  standby_day: 'สแตนด์บาย (Standby)',
  off_day_worked: 'ทำงานวันหยุด',
};

export default function ClientTimesheetApprovalPage() {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

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

    // Filter for relevant approval statuses
    return query(
      baseQuery,
      where('status', 'in', ['OPS_REVIEWED', 'CLIENT_APPROVED', 'LOCKED'])
    );
  }, [firestore, currentUser]);
  
  const { data: timesheets, isLoading: isTsLoading } = useCollection<DailyTimesheet>(tsQuery as any);

  const workersQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'workers') : null), [firestore]);
  const { data: workers } = useCollection<Worker>(workersQuery as any);

  // 2. Actions
  const handleApprove = async (tsId: string) => {
    if (!firestore || !currentUser) return;
    try {
      const docRef = doc(firestore, 'daily_timesheets', tsId);
      await updateDoc(docRef, {
        status: 'CLIENT_APPROVED',
        readyForPayroll: true,
        readyForBilling: true,
        clientApprovedBy: currentUser.displayName,
        clientApprovedAt: Date.now(),
        updatedAt: Date.now()
      });
      toast({ title: "อนุมัติรายการสำเร็จ" });
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถบันทึกข้อมูลได้" });
    }
  };

  if (isUserLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <ClipboardCheck className="h-8 w-8" /> อนุมัติใบลงเวลา (Timesheet Approval)
          </h1>
          <p className="text-muted-foreground text-lg italic">ตรวจสอบและยืนยันชั่วโมงการทำงานของคนงานประจำวัน (Verify daily activity logs).</p>
        </div>

        <PageGuidance 
          title="คำแนะนำในการอนุมัติเวลา (Approval Guidance)"
          tips={[
            "การกดอนุมัติ (Approve) จะเป็นการยืนยันความถูกต้องเพื่อใช้ในการสรุปยอดวางบิล (Billing Readiness)",
            "หากท่านกดอนุมัติ ข้อมูลจะถูกส่งเข้าสู่ระบบการเงินของ OPEC โดยอัตโนมัติ",
            "หากข้อมูลไม่ถูกต้อง ท่านสามารถแจ้งเจ้าหน้าที่ Operations เพื่อทำการแก้ไข (Rejected/Correction)"
          ]}
        />

        <div className="flex items-center gap-3 bg-card p-4 rounded-lg border shadow-sm">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="ค้นหาตามชื่อพนักงาน หรือ วันที่..." className="pl-9 h-11" />
          </div>
          <Button variant="outline" className="h-11 gap-2"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
        </div>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardHeader className="bg-muted/30 border-b">
            <CardTitle className="text-lg">รายการรอยืนยัน (Pending Verification)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isTsLoading ? (
              <div className="py-20 text-center animate-pulse">กำลังโหลดข้อมูลใบลงเวลา...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="pl-6 py-4 font-bold">วันที่ (Date)</TableHead>
                    <TableHead className="font-bold">พนักงาน (Worker)</TableHead>
                    <TableHead className="font-bold">กิจกรรม (Event)</TableHead>
                    <TableHead className="text-center font-bold">ชั่วโมงทำงาน</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {timesheets?.filter(ts => ts.status === 'OPS_REVIEWED').map((ts) => {
                    const worker = workers?.find(w => w.id === ts.workerId);
                    return (
                      <TableRow key={ts.id} className="hover:bg-muted/20 transition-all">
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
                          <Badge variant="secondary" className="bg-blue-50 text-blue-700 animate-pulse">WAITING APPROVAL</Badge>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="outline" className="text-destructive border-destructive">ปฏิเสธ</Button>
                            <Button size="sm" className="bg-green-600 hover:bg-green-700 font-bold" onClick={() => handleApprove(ts.id)}>
                              <CheckCircle2 className="h-4 w-4 mr-2" /> อนุมัติ (Approve)
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {(!timesheets || timesheets.filter(ts => ts.status === 'OPS_REVIEWED').length === 0) && !isTsLoading && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-20 text-muted-foreground italic">ไม่มีรายการที่รอการอนุมัติในขณะนี้</TableCell>
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
