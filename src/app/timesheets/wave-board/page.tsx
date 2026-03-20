
'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Waves, 
  Plus, 
  Save, 
  Calendar, 
  ShoppingCart, 
  Users, 
  CheckCircle2, 
  Loader2, 
  Zap, 
  ClipboardCheck,
  AlertTriangle,
  HardHat,
  ChevronRight,
  Info
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { PurchaseOrder, Wave, Assignment, Worker, DailyTimesheet, RateConditionEventType, User } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { PageGuidance } from '@/components/layout/page-guidance';
import { Badge } from '@/components/ui/badge';
import { TimesheetService } from '@/lib/services/timesheet-service';

const EVENT_TYPE_OPTIONS: { label: string; value: RateConditionEventType }[] = [
  { label: 'วันทำงาน (Work)', value: 'work_day' },
  { label: 'วันเดินทาง (Travel)', value: 'travel_day' },
  { label: 'สแตนด์บาย (Standby)', value: 'standby_day' },
  { label: 'เตรียมส่งตัว (Mob)', value: 'mobilization_day' },
  { label: 'วันเดินทางกลับ (Demob)', value: 'demobilization_day' },
  { label: 'ลาหยุดไม่รับค่าจ้าง (Unpaid)', value: 'unpaid_leave' },
];

export default function WaveTimesheetBoardPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [selectedPoId, setSelectedPoId] = useState('');
  const [selectedWaveId, setSelectedWaveId] = useState('');
  const [targetDate, setTargetDate] = useState(new Date().toISOString().split('T')[0]);
  const [isSaving, setIsSaving] = useState(false);

  // Row entry state
  const [rosterData, setRosterData] = useState<Record<string, Partial<DailyTimesheet>>>({});

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  // 1. Data Queries
  const poQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'purchase_orders'), where('status', '==', 'active')) : null), [firestore]);
  const { data: pos } = useCollection<PurchaseOrder>(poQuery as any);

  const waveQuery = useMemoFirebase(() => {
    if (!firestore || !selectedPoId) return null;
    return query(collection(firestore, 'waves'), where('poId', '==', selectedPoId));
  }, [firestore, selectedPoId]);
  const { data: waves } = useCollection<Wave>(waveQuery as any);

  const asgnQuery = useMemoFirebase(() => {
    if (!firestore || !selectedWaveId) return null;
    return query(collection(firestore, 'mobilizations'), where('waveId', '==', selectedWaveId), where('deploymentStatus', 'in', ['ACTIVE', 'READY_TO_MOB', 'MOBILIZING', 'READY']));
  }, [firestore, selectedWaveId]);
  const { data: assignments, isLoading: isAsgnLoading } = useCollection<Assignment>(asgnQuery as any);

  const workersQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'workers') : null), [firestore]);
  const { data: workers } = useCollection<Worker>(workersQuery as any);

  // 2. Load existing timesheets for selected date/wave
  useEffect(() => {
    async function loadExisting() {
      if (!firestore || !selectedWaveId || !targetDate || !assignments) return;
      
      const q = query(
        collection(firestore, 'daily_timesheets'),
        where('waveId', '==', selectedWaveId),
        where('date', '==', targetDate)
      );
      const snap = await getDocs(q);
      const existing: Record<string, DailyTimesheet> = {};
      snap.docs.forEach(d => {
        const data = d.data() as DailyTimesheet;
        existing[data.workerId] = data;
      });

      // Initialize roster state from assignments
      const newRoster: Record<string, Partial<DailyTimesheet>> = {};
      assignments.forEach(asgn => {
        if (existing[asgn.workerId]) {
          newRoster[asgn.workerId] = existing[asgn.workerId];
        } else {
          newRoster[asgn.workerId] = {
            workerId: asgn.workerId,
            assignmentId: asgn.id,
            date: targetDate,
            eventType: 'work_day',
            normalHours: 8,
            ot15Hours: 0,
            status: 'DRAFT'
          };
        }
      });
      setRosterData(newRoster);
    }
    loadExisting();
  }, [firestore, selectedWaveId, targetDate, assignments]);

  // 3. Bulk Actions
  const applyBulk = (field: keyof DailyTimesheet, value: any) => {
    const updated = { ...rosterData };
    Object.keys(updated).forEach(wid => {
      // Only update if not finalized
      if (updated[wid].status !== 'CLIENT_APPROVED' && updated[wid].status !== 'LOCKED') {
        updated[wid] = { ...updated[wid], [field]: value };
      }
    });
    setRosterData(updated);
    toast({ title: "Bulk apply complete", description: `Applied ${value} to all editable rows.` });
  };

  const handleSaveAll = async () => {
    if (!firestore || !currentUser) return;
    setIsSaving(true);
    try {
      const service = new TimesheetService(firestore);
      const wave = waves?.find(w => w.id === selectedWaveId);
      
      const payloads = Object.values(rosterData).map(ts => {
        const asgn = assignments?.find(a => a.id === ts.assignmentId);
        const worker = workers?.find(w => w.id === ts.workerId);
        return {
          ...ts,
          workerNameSnapshot: worker ? `${worker.firstName} ${worker.lastName}` : 'Unknown',
          waveId: selectedWaveId,
          purchaseOrderId: selectedPoId,
          customerId: wave?.customerId || '',
          siteId: wave?.siteLocation || '',
          positionId: asgn?.positionId || '',
          workMode: 'OFFSHORE' as any, // Standard default for Opec
          shiftType: 'DAY' as any,
        };
      });

      const results = await service.bulkUpsertTimesheets(payloads, currentUser);
      toast({ 
        title: "บันทึกข้อมูลสำเร็จ (Bulk Save Complete)", 
        description: `สร้างใหม่: ${results.created}, อัปเดต: ${results.updated}, ข้ามรายการที่ล็อก: ${results.skipped}` 
      });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
      setIsSaving(false);
    }
  };

  if (isUserLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <Waves className="h-8 w-8" /> ลงเวลารายวันตามกลุ่มเวฟ (Wave-based Daily Timesheet)
          </h1>
          <p className="text-muted-foreground text-lg">จัดการลงเวลาทำงานแบบกลุ่ม โดยอ้างอิงรายชื่อพนักงานจาก Wave งานหน้างาน</p>
        </div>

        <PageGuidance 
          title="ขั้นตอนการลงเวลาแบบกลุ่ม (Bulk Entry Guide)"
          tips={[
            "1. เลือก PO และ Wave เพื่อโหลดรายชื่อพนักงานที่ได้รับมอบหมายอัตโนมัติ",
            "2. ใช้ปุ่มลัดด้านบนเพื่อกำหนด 'วันทำงานปกติ' ให้พนักงานทั้งกลุ่มในครั้งเดียว",
            "3. แก้ไขเฉพาะคนที่เป็น 'ข้อยกเว้น' เช่น เดินทาง, Standby หรือพนักงานที่มีการทำ OT",
            "4. รายการที่ลูกค้าอนุมัติ (Approved) หรือถูกล็อก (Locked) แล้วจะไม่สามารถแก้ไขผ่านหน้านี้ได้"
          ]}
        />

        <Card className="shadow-sm border-none bg-card">
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase text-muted-foreground">1. เลือกใบสั่งซื้อ (Select PO)</Label>
                <Select value={selectedPoId} onValueChange={setSelectedPoId}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="เลือก PO ลูกค้า..." />
                  </SelectTrigger>
                  <SelectContent>
                    {pos?.map(p => <SelectItem key={p.id} value={p.id}>{p.poCode} | {p.projectName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase text-muted-foreground">2. เลือกเวฟงาน (Select Wave)</Label>
                <Select value={selectedWaveId} onValueChange={setSelectedWaveId} disabled={!selectedPoId}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="เลือก Wave งาน..." />
                  </SelectTrigger>
                  <SelectContent>
                    {waves?.map(w => <SelectItem key={w.id} value={w.id}>{w.waveCode} | {w.siteLocation}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase text-muted-foreground">3. วันที่ปฏิบัติงาน (Target Date)</Label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} className="pl-9 h-11" />
                </div>
              </div>

              <div className="flex items-end">
                <Button 
                  className="w-full h-11 bg-primary font-black shadow-lg gap-2" 
                  disabled={!selectedWaveId || isSaving}
                  onClick={handleSaveAll}
                >
                  {isSaving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
                  บันทึกข้อมูลทั้งหมด (Save Board)
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {selectedWaveId && (
          <div className="space-y-4">
            {/* Quick Batch Controls */}
            <div className="flex flex-wrap items-center gap-3 p-4 bg-muted/30 rounded-lg border border-dashed">
              <span className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2 mr-2">
                <Zap className="h-4 w-4" /> Quick Apply All:
              </span>
              <Button size="sm" variant="outline" className="bg-white" onClick={() => applyBulk('eventType', 'work_day')}>
                Set all: วันทำงานปกติ (Work)
              </Button>
              <Button size="sm" variant="outline" className="bg-white" onClick={() => applyBulk('eventType', 'travel_day')}>
                Set all: วันเดินทาง (Travel)
              </Button>
              <Button size="sm" variant="outline" className="bg-white" onClick={() => applyBulk('normalHours', 8)}>
                Set all: 8 ชั่วโมง
              </Button>
              <Button size="sm" variant="outline" className="bg-white" onClick={() => applyBulk('normalHours', 12)}>
                Set all: 12 ชั่วโมง
              </Button>
            </div>

            <Card className="shadow-xl border-none overflow-hidden">
              <CardHeader className="bg-primary text-primary-foreground">
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Users className="h-5 w-5" /> ตารางรายชื่อพนักงาน (Wave Roster)
                    </CardTitle>
                    <CardDescription className="text-primary-foreground/60">
                      แสดงรายชื่อที่ได้รับมอบหมายใน Wave นี้ | วันที่ {targetDate}
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="bg-white/10 text-white border-white/20">
                    {assignments?.length || 0} Workers Assigned
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {isAsgnLoading ? (
                  <div className="py-20 text-center animate-pulse">กำลังโหลดรายชื่อพนักงาน...</div>
                ) : (
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="pl-6 py-4 font-bold">พนักงาน (Worker)</TableHead>
                        <TableHead className="font-bold">ตำแหน่ง (Position)</TableHead>
                        <TableHead className="font-bold w-[220px]">ประเภทงาน (Event)</TableHead>
                        <TableHead className="font-bold text-center w-[100px]">ชม.ปกติ</TableHead>
                        <TableHead className="font-bold text-center w-[100px]">OT 1.5</TableHead>
                        <TableHead className="font-bold">สถานะ</TableHead>
                        <TableHead className="text-right pr-6">หมายเหตุ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {assignments?.map((asgn) => {
                        const worker = workers?.find(w => w.id === asgn.workerId);
                        const row = rosterData[asgn.workerId] || {};
                        const isLocked = row.status === 'CLIENT_APPROVED' || row.status === 'LOCKED';

                        return (
                          <TableRow key={asgn.id} className={isLocked ? "bg-slate-50/50" : "hover:bg-muted/20"}>
                            <TableCell className="pl-6 py-4">
                              <div className="flex flex-col">
                                <span className="font-bold text-sm text-primary">{worker?.firstName} {worker?.lastName}</span>
                                <span className="text-[9px] font-mono text-muted-foreground uppercase">{worker?.workerCode}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-[9px] font-medium bg-white">{asgn.positionId}</Badge>
                            </TableCell>
                            <TableCell>
                              <Select 
                                disabled={isLocked}
                                value={row.eventType} 
                                onValueChange={(v: RateConditionEventType) => {
                                  const updated = { ...rosterData };
                                  updated[asgn.workerId].eventType = v;
                                  setRosterData(updated);
                                }}
                              >
                                <SelectTrigger className="h-9 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {EVENT_TYPE_OPTIONS.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Input 
                                disabled={isLocked}
                                type="number" 
                                className="h-9 text-center font-bold" 
                                value={row.normalHours}
                                onChange={e => {
                                  const updated = { ...rosterData };
                                  updated[asgn.workerId].normalHours = parseInt(e.target.value) || 0;
                                  setRosterData(updated);
                                }}
                              />
                            </TableCell>
                            <TableCell>
                              <Input 
                                disabled={isLocked}
                                type="number" 
                                className="h-9 text-center" 
                                value={row.ot15Hours || 0}
                                onChange={e => {
                                  const updated = { ...rosterData };
                                  updated[asgn.workerId].ot15Hours = parseInt(e.target.value) || 0;
                                  setRosterData(updated);
                                }}
                              />
                            </TableCell>
                            <TableCell>
                              {row.status ? (
                                <Badge variant="outline" className={`text-[9px] font-black ${
                                  row.status === 'CLIENT_APPROVED' ? 'bg-green-50 text-green-700 border-green-200' : 
                                  row.status === 'SUBMITTED' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-slate-100'
                                }`}>
                                  {row.status}
                                </Badge>
                              ) : (
                                <span className="text-[10px] text-muted-foreground italic">No Entry</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right pr-6">
                              <Input 
                                disabled={isLocked}
                                placeholder="..." 
                                className="h-8 text-[10px] text-right" 
                                value={row.remark || ''}
                                onChange={e => {
                                  const updated = { ...rosterData };
                                  updated[asgn.workerId].remark = e.target.value;
                                  setRosterData(updated);
                                }}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
              <CardFooter className="bg-muted/20 border-t py-4 justify-between">
                <p className="text-xs text-muted-foreground italic">
                  <Info className="h-3 w-3 inline mr-1" /> 
                  หากต้องการเพิ่มคนงานที่ไม่อยู่ในรายชื่อนี้ กรุณาไปที่เมนู 'การมอบหมาย (Assignments)' เพื่อเพิ่มคนเข้า Wave ก่อน
                </p>
                <div className="flex gap-2">
                   <Button variant="outline" size="sm" asChild>
                     <Link href="/timesheets/daily">สลับไปหน้าดูประวัติ (Daily History)</Link>
                   </Button>
                </div>
              </CardFooter>
            </Card>
          </div>
        )}
      </div>
    </AppShell>
  );
}
