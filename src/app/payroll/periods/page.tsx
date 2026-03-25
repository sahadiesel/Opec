'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Calendar, 
  Plus, 
  Search, 
  Filter, 
  CheckCircle2, 
  Lock, 
  Info,
  ChevronRight,
  TrendingUp,
  FileText,
  Clock,
  Settings2
} from 'lucide-react';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { Input } from '@/components/ui/input';
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue } from '@/lib/date-thai';
import { PayrollPeriod, PayrollPeriodStatus, User } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, orderBy, limit } from 'firebase/firestore';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { addDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { PageGuidance } from '@/components/layout/page-guidance';

export default function PayrollPeriodsPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const periodsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'payroll_periods'), orderBy('startDate', 'desc'), limit(50));
  }, [firestore]);
  const { data: periods, isLoading } = useCollection<PayrollPeriod>(periodsQuery as any);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newPeriod, setNewPeriod] = useState<Partial<PayrollPeriod>>({
    label: '',
    startDate: timestampToHtmlDateValue(Date.now()),
    endDate: timestampToHtmlDateValue(Date.now()),
    cycleType: 'MONTHLY',
    status: 'DRAFT'
  });

  const handleCreate = async () => {
    if (!firestore || !currentUser) return;
    try {
      await addDocumentNonBlocking(collection(firestore, 'payroll_periods'), {
        ...newPeriod,
        generatedBy: currentUser.displayName,
        generatedAt: Date.now()
      });
      setIsCreateOpen(false);
      toast({ title: "สร้างรอบบัญชีสำเร็จ" });
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถสร้างรอบบัญชีได้" });
    }
  };

  const getStatusBadge = (status: PayrollPeriodStatus) => {
    switch (status) {
      case 'DRAFT': return <Badge variant="outline" className="bg-slate-50">DRAFT</Badge>;
      case 'OPEN': return <Badge className="bg-blue-600">OPEN (รับข้อมูล)</Badge>;
      case 'PROCESSING': return <Badge className="bg-amber-500">PROCESSING</Badge>;
      case 'LOCKED': return <Badge variant="secondary"><Lock className="h-3 w-3 mr-1" /> LOCKED</Badge>;
      case 'CLOSED': return <Badge variant="outline" className="bg-slate-200">CLOSED</Badge>;
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
              <Calendar className="h-8 w-8" /> รอบบัญชีและการจ่ายเงิน (Payroll Periods)
            </h1>
            <p className="text-muted-foreground text-lg italic">จัดการช่วงเวลาการตัดรอบเพื่อสรุปยอดเงินเดือนและวางบิล (Financial Cut-offs).</p>
          </div>
          
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 h-11 px-6 bg-primary shadow-md font-bold">
                <Plus className="h-5 w-5" /> สร้างรอบใหม่ (New Period)
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>สร้างรอบบัญชีใหม่</DialogTitle>
                <DialogDescription>ระบุช่วงเวลาเริ่มต้นและสิ้นสุดสำหรับงวดการจ่ายนี้</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label className="font-bold">ชื่อเรียก (Label)</Label>
                  <Input placeholder="เช่น January 2026 - Main Cycle" value={newPeriod.label} onChange={e => setNewPeriod({...newPeriod, label: e.target.value})} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="font-bold text-xs">วันเริ่มรอบ (Start)</Label>
                    <DatePickerThaiBE
                      className="h-10"
                      value={htmlDateValueToTimestampMs(newPeriod.startDate)}
                      onChange={(ms) => setNewPeriod({ ...newPeriod, startDate: timestampToHtmlDateValue(ms) })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold text-xs">วันสิ้นรอบ (End)</Label>
                    <DatePickerThaiBE
                      className="h-10"
                      value={htmlDateValueToTimestampMs(newPeriod.endDate)}
                      onChange={(ms) => setNewPeriod({ ...newPeriod, endDate: timestampToHtmlDateValue(ms) })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="font-bold">ประเภทวงรอบ (Cycle Type)</Label>
                  <Select onValueChange={(v: any) => setNewPeriod({...newPeriod, cycleType: v})} value={newPeriod.cycleType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MONTHLY">รายเดือนปกติ (Monthly)</SelectItem>
                      <SelectItem value="PARTIAL_START">เริ่มโครงการกลางเดือน</SelectItem>
                      <SelectItem value="PARTIAL_END">จบโครงการกลางเดือน</SelectItem>
                      <SelectItem value="CUSTOM">วงรอบพิเศษ (Custom)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleCreate} className="bg-primary font-bold">ยืนยันสร้างรอบ (Confirm)</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <PageGuidance 
          title="หลักการปิดงวด (Cut-off Principles)"
          tips={[
            "รอบบัญชีใช้สำหรับรวบรวม Daily Timesheets ที่ผ่านการอนุมัติแล้วมาสรุปเป็น Payroll และ Billing",
            "กรุณาตรวจสอบวันที่เริ่มและสิ้นสุดงวดให้ครอบคลุมตามระเบียบของโครงการ (Cut-off date)",
            "งวดที่ถูกล็อก (Locked) จะไม่สามารถแก้ไขข้อมูลเวลาที่เชื่อมโยงได้อีก"
          ]}
        />

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-20 text-center animate-pulse">กำลังโหลดข้อมูลรอบบัญชี...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="pl-6 py-4 font-bold">ชื่อรอบ (Label)</TableHead>
                    <TableHead className="font-bold">เริ่มงวด (Start)</TableHead>
                    <TableHead className="font-bold">สิ้นสุดงวด (End)</TableHead>
                    <TableHead className="font-bold">ประเภท</TableHead>
                    <TableHead className="font-bold">สถานะ (Status)</TableHead>
                    <TableHead className="text-right pr-6">ดำเนินการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {periods?.map((p) => (
                    <TableRow key={p.id} className="hover:bg-muted/30 group transition-all">
                      <TableCell className="pl-6 py-4">
                        <div className="flex flex-col">
                          <span className="font-black text-sm text-primary">{p.label}</span>
                          <span className="text-[10px] text-muted-foreground uppercase">Period ID: {p.id.substring(0,8)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium text-xs">{p.startDate}</TableCell>
                      <TableCell className="font-medium text-xs">{p.endDate}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{p.cycleType}</Badge></TableCell>
                      <TableCell>{getStatusBadge(p.status)}</TableCell>
                      <TableCell className="text-right pr-6">
                        <Button variant="ghost" size="sm" className="gap-2 group-hover:text-primary">
                          ไปที่งวดงาน <ChevronRight className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
