'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Waves, 
  Save, 
  Calendar, 
  Users, 
  Loader2, 
  Zap, 
  HardHat,
  ChevronRight,
  Info,
  Clock,
  ClipboardCheck,
  CheckCircle2,
  Copy
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { PurchaseOrder, Wave, Assignment, Worker, DailyTimesheet, RateConditionEventType, User, JobMode } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { PageGuidance } from '@/components/layout/page-guidance';
import { Badge } from '@/components/ui/badge';
import { TimesheetService } from '@/lib/services/timesheet-service';
import Link from 'next/link';

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
  const [isCloning, setIsCloning] = useState(false);

  // Roster state
  const [rosterData, setRosterData] = useState<Record<string, Partial<DailyTimesheet>>>({});

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

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

  // Load existing data for board
  useEffect(() => {
    async function loadData() {
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
    loadData();
  }, [firestore, selectedWaveId, targetDate, assignments]);

  const applyBulk = (field: keyof DailyTimesheet, value: any) => {
    const updated = { ...rosterData };
    Object.keys(updated).forEach(wid => {
      if (updated[wid].status !== 'CLIENT_APPROVED' && updated[wid].status !== 'LOCKED') {
        updated[wid] = { ...updated[wid], [field]: value };
      }
    });
    setRosterData(updated);
    toast({ title: "Bulk Apply Complete", description: `Set all to ${value}` });
  };

  const handleClonePrevious = async () => {
    if (!firestore || !currentUser || !selectedWaveId) return;
    setIsCloning(true);
    try {
      const service = new TimesheetService(firestore);
      const res = await service.copyFromPreviousDay(selectedWaveId, targetDate, currentUser);
      toast({ title: "Clone Data Complete", description: `Copied ${res.created + res.updated} logs.` });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Clone Failed", description: e.message });
    } finally {
      setIsCloning(false);
    }
  };

  const handleSaveAll = async () => {
    if (!firestore || !currentUser || !selectedWaveId) return;
    setIsSaving(true);
    try {
      const service = new TimesheetService(firestore);
      const wave = waves?.find(w => w.id === selectedWaveId);
      
      const payloads = Object.values(rosterData).map(ts => {
        const worker = workers?.find(w => w.id === ts.workerId);
        const asgn = assignments?.find(a => a.id === ts.assignmentId);
        return {
          ...ts,
          workerNameSnapshot: worker ? `${worker.firstName} ${worker.lastName}` : 'Unknown',
          waveId: selectedWaveId,
          purchaseOrderId: asgn?.poId || selectedPoId,
          contractId: asgn?.contractId || '',
          customerId: wave?.customerId || '',
          projectName: wave?.projectName || '',
          positionId: asgn?.positionId || '',
          workMode: asgn?.workMode, // Derived directly from assignment context
          shiftType: 'DAY' as any,
        };
      });

      const results = await service.bulkUpsertTimesheets(payloads as Partial<DailyTimesheet>[], currentUser);
      toast({ 
        title: "บันทึกสำเร็จ (Save Board Success)", 
        description: `สร้างใหม่: ${results.created}, อัปเดต: ${results.updated}, ข้ามรายการล็อก: ${results.skipped}` 
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
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
              <Waves className="h-8 w-8 text-primary" /> ลงเวลารายวันตามกลุ่มเวฟ (Wave Daily Board)
            </h1>
            <p className="text-muted-foreground text-lg">จัดการลงเวลาสำหรับคนงานจำนวนมาก โดยอ้างอิงรายชื่อตาม Wave และโครงการ</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2 h-11" onClick={handleClonePrevious} disabled={!selectedWaveId || isCloning}>
              <Copy className="h-4 w-4" /> ดึงข้อมูลจากเมื่อวาน (Clone Prev)
            </Button>
            <Button className="gap-2 h-11 px-8 bg-primary font-black shadow-lg" onClick={handleSaveAll} disabled={!selectedWaveId || isSaving}>
              {isSaving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
              บันทึกกระดานนี้ (Save Board)
            </Button>
          </div>
        </div>

        <PageGuidance 
          title="คู่มือการบันทึกแบบกลุ่ม (Bulk Entry Guide)"
          tips={[
            "ระบบจะโหลดรายชื่อจาก 'Mobilizations' อัตโนมัติ เฉพาะคนที่มีกำหนดเริ่มงานแล้วเท่านั้น",
            "ใช้ปุ่ม 'Quick Apply' เพื่อระบุสถานะ 'ทำงาน (Work)' ให้พนักงานทุกคนในครั้งเดียว",
            "แก้ไขเฉพาะรายการที่มีการทำ OT หรือรายการพิเศษ (Travel/Standby) แล้วกดบันทึกทั้งหมด"
          ]}
        />

        <Card className="shadow-sm border-none bg-card">
          <CardContent className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase text-muted-foreground">1. เลือกใบสั่งซื้อ (Customer PO)</Label>
              <Select value={selectedPoId} onValueChange={setSelectedPoId}>
                <SelectTrigger className="h-11"><SelectValue placeholder="เลือก PO..." /></SelectTrigger>
                <SelectContent>
                  {pos?.map(p => <SelectItem key={p.id} value={p.id}>{p.poCode} | {p.projectName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase text-muted-foreground">2. เลือกเวฟงาน (Project Wave)</Label>
              <Select value={selectedWaveId} onValueChange={setSelectedWaveId} disabled={!selectedPoId}>
                <SelectTrigger className="h-11"><SelectValue placeholder="เลือก Wave..." /></SelectTrigger>
                <SelectContent>
                  {waves?.map(w => <SelectItem key={w.id} value={w.id}>{w.waveCode} | {w.siteLocation}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase text-muted-foreground">3. วันที่ปฏิบัติงาน (Target Date)</Label>
              <Input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} className="h-11" />
            </div>
          </CardContent>
        </Card>

        {selectedWaveId && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 p-4 bg-muted/20 rounded-lg border-2 border-dashed">
              <span className="text-xs font-black text-muted-foreground uppercase flex items-center gap-2 mr-2">
                <Zap className="h-4 w-4 text-amber-500" /> Quick Apply All:
              </span>
              <Button size="sm" variant="outline" className="bg-white border-primary/20" onClick={() => applyBulk('eventType', 'work_day')}>Set All: Work Day</Button>
              <Button size="sm" variant="outline" className="bg-white border-primary/20" onClick={() => applyBulk('eventType', 'travel_day')}>Set All: Travel Day</Button>
              <Button size="sm" variant="outline" className="bg-white border-primary/20" onClick={() => applyBulk('normalHours', 8)}>Set All: 8 Hrs</Button>
              <Button size="sm" variant="outline" className="bg-white border-primary/20" onClick={() => applyBulk('normalHours', 12)}>Set All: 12 Hrs</Button>
            </div>

            <Card className="shadow-lg border-none overflow-hidden">
              <CardHeader className="bg-primary text-primary-foreground">
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Users className="h-5 w-5" /> ตารางรายชื่อประจำเวฟ (Wave Roster)
                    </CardTitle>
                    <CardDescription className="text-primary-foreground/60 italic">แก้ไขเฉพาะรายการที่เป็นข้อยกเว้นจากปกติ</CardDescription>
                  </div>
                  <Badge variant="secondary" className="bg-white/10 text-white border-white/20 px-4">
                    {assignments?.length || 0} Workers Active
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {isAsgnLoading ? (
                  <div className="py-20 text-center animate-pulse">Loading Roster...</div>
                ) : (
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="pl-6 py-4 font-bold">พนักงาน (Worker)</TableHead>
                        <TableHead className="font-bold">ตำแหน่ง</TableHead>
                        <TableHead className="font-bold w-[220px]">ประเภทเหตุการณ์ (Event)</TableHead>
                        <TableHead className="font-bold text-center w-[100px]">ชั่วโมงปกติ</TableHead>
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
                          <TableRow key={asgn.id} className={isLocked ? "bg-slate-50 opacity-80" : "hover:bg-muted/20"}>
                            <TableCell className="pl-6 py-4">
                              <div className="flex flex-col">
                                <span className="font-bold text-sm text-primary">{worker?.firstName} {worker?.lastName}</span>
                                <span className="text-[9px] font-mono text-muted-foreground uppercase">{worker?.workerCode || asgn.id.substring(0,8)}</span>
                              </div>
                            </TableCell>
                            <TableCell><Badge variant="outline" className="text-[9px] bg-white">{asgn.positionId}</Badge></TableCell>
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
                                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
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
                              ) : <span className="text-[10px] text-muted-foreground italic">No Log</span>}
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
                <div className="flex items-center gap-2 text-xs text-muted-foreground italic">
                  <Info className="h-4 w-4 text-primary" />
                  รายชื่ออ้างอิงจากระบบการมอบหมายงาน (Assignments) ประจำรอบเวฟที่เลือก
                </div>
                <Button variant="link" className="text-xs" asChild>
                  <Link href="/timesheets/daily">ดูประวัติย้อนหลังรายบุคคล <ChevronRight className="h-3 w-3" /></Link>
                </Button>
              </CardFooter>
            </Card>
          </div>
        )}
      </div>
    </AppShell>
  );
}