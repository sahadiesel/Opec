'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { 
  Users, 
  Waves, 
  ClipboardCheck, 
  Clock, 
  CheckCircle2, 
  ChevronRight, 
  LayoutDashboard,
  Building2,
  HardHat,
  MapPin,
  Calendar,
  Briefcase,
  Activity,
  ShoppingCart,
  FileText,
  AlertCircle,
  TrendingUp
} from 'lucide-react';
import { 
  User, 
  Wave, 
  Assignment, 
  DailyTimesheet, 
  Worker, 
  PurchaseOrder, 
  MainContract,
  WorkerWaveAcceptance
} from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where, limit, orderBy } from 'firebase/firestore';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { PageGuidance } from '@/components/layout/page-guidance';
import { CustomerQueryService } from '@/lib/services/customer-query-service';
import { differenceInDays, parseISO, startOfDay } from 'date-fns';

export default function ClientDashboardPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const isClient = useMemo(() => {
    return currentUser?.userType === 'customer_portal' || currentUser?.department === 'client';
  }, [currentUser]);

  // --- Scoped Queries ---
  
  const queryService = useMemo(() => firestore ? new CustomerQueryService(firestore) : null, [firestore]);

  const wavesQuery = useMemoFirebase(() => queryService?.getScopedWavesQuery(currentUser), [queryService, currentUser]);
  const { data: waves } = useCollection<Wave>(wavesQuery as any);

  const asgnQuery = useMemoFirebase(() => queryService?.getScopedAssignmentsQuery(currentUser), [queryService, currentUser]);
  const { data: assignments } = useCollection<Assignment>(asgnQuery as any);

  const acceptQuery = useMemoFirebase(() => queryService?.getScopedAcceptancesQuery(currentUser), [queryService, currentUser]);
  const { data: pendingAcceptances } = useCollection<WorkerWaveAcceptance>(
    useMemoFirebase(() => acceptQuery ? query(acceptQuery as any, where('status', '==', 'pending')) : null, [acceptQuery]) as any
  );

  const tsQuery = useMemoFirebase(() => {
    const base = queryService?.getScopedTimesheetsQuery(currentUser);
    return base ? query(base as any, where('status', '==', 'OPS_REVIEWED')) : null;
  }, [queryService, currentUser]);
  const { data: pendingTimesheets } = useCollection<DailyTimesheet>(tsQuery as any);

  const poQuery = useMemoFirebase(() => queryService?.getScopedPOsQuery(currentUser), [queryService, currentUser]);
  const { data: pos } = useCollection<PurchaseOrder>(poQuery as any);

  const contractsQuery = useMemoFirebase(() => queryService?.getScopedContractsQuery(currentUser), [queryService, currentUser]);
  const { data: contracts } = useCollection<MainContract>(contractsQuery as any);

  const workersQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'workers') : null), [firestore]);
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  // --- Stats Calculation ---

  const stats = useMemo(() => {
    const activeHeadcount = assignments?.filter(a => a.deploymentStatus === 'ACTIVE').length || 0;
    const mobilising = assignments?.filter(a => ['READY_TO_MOB', 'MOBILIZING'].includes(a.deploymentStatus)).length || 0;
    
    return {
      activeHeadcount,
      mobilising,
      pendingApproval: (pendingAcceptances?.length || 0) + (pendingTimesheets?.length || 0),
      pendingAcceptance: pendingAcceptances?.length || 0,
      pendingTimesheet: pendingTimesheets?.length || 0,
      activeWaves: waves?.filter(w => w.status === 'ACTIVE').length || 0,
    };
  }, [assignments, pendingAcceptances, pendingTimesheets, waves]);

  const activeWorkerStats = useMemo(() => {
    if (!assignments || !allWorkers) return [];
    
    return assignments
      .filter(a => a.deploymentStatus === 'ACTIVE')
      .map(asgn => {
        const worker = allWorkers.find(w => w.id === asgn.workerId);
        const start = parseISO(asgn.startDate);
        const end = parseISO(asgn.endDate);
        const today = startOfDay(new Date());
        
        const totalDays = differenceInDays(end, start) + 1;
        const daysWorked = differenceInDays(today, start);
        const remaining = totalDays - daysWorked;

        return {
          id: asgn.id,
          name: worker ? `${worker.firstName} ${worker.lastName}` : 'Unknown',
          position: asgn.positionId,
          projectName: asgn.projectName,
          daysWorked: Math.max(0, daysWorked),
          remaining: Math.max(0, remaining),
          percent: Math.min(100, Math.max(0, (daysWorked / totalDays) * 100))
        };
      }).slice(0, 5);
  }, [assignments, allWorkers]);

  if (isUserLoading || !currentUser) return null;

  if (!isClient) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <AlertCircle className="h-12 w-12 text-destructive opacity-50" />
          <h2 className="text-xl font-bold">Access Restricted</h2>
          <p className="text-muted-foreground">This dashboard is designed for Customer Portal users.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-8 max-w-[1600px] mx-auto">
        {/* Header */}
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <LayoutDashboard className="h-8 w-8" /> แดชบอร์ดลูกค้า (Customer Dashboard)
          </h1>
          <p className="text-muted-foreground text-lg italic">
            ติดตามสถานะพนักงาน โครงการ และงานรอยืนยันสำหรับ {currentUser.displayName}
          </p>
        </div>

        {/* Action Items Alert */}
        {stats.pendingApproval > 0 && (
          <Alert className="bg-amber-50 border-amber-200 text-amber-800 shadow-sm animate-pulse">
            <Clock className="h-5 w-5 text-amber-600" />
            <AlertTitle className="font-bold">รายการรอยืนยัน (Action Required)</AlertTitle>
            <AlertDescription className="text-sm">
              คุณมี {stats.pendingAcceptance} รายชื่อพนักงาน และ {stats.pendingTimesheet} ใบลงเวลา ที่รอการตรวจสอบและอนุมัติ
            </AlertDescription>
          </Alert>
        )}

        {/* Top Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard 
            title="พนักงานหน้างาน" 
            value={stats.activeHeadcount} 
            sub="Active Personnel" 
            icon={HardHat} 
            colorClass="border-l-blue-600" 
          />
          <StatCard 
            title="กำลังเดินทาง" 
            value={stats.mobilising} 
            sub="In-Mob Pipeline" 
            icon={Truck} 
            colorClass="border-l-indigo-500" 
          />
          <StatCard 
            title="โครงการที่ดำเนินการ" 
            value={stats.activeWaves} 
            sub="Active Deployment Waves" 
            icon={Waves} 
            colorClass="border-l-green-600" 
          />
          <StatCard 
            title="รอการอนุมัติ" 
            value={stats.pendingApproval} 
            sub="Pending Reviews" 
            icon={ClipboardCheck} 
            colorClass="border-l-amber-500" 
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Context Area */}
          <div className="lg:col-span-2 space-y-6">
            <Card className="shadow-md border-none overflow-hidden">
              <CardHeader className="bg-primary/5 border-b flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Activity className="h-5 w-5 text-primary" /> พนักงานที่กำลังปฏิบัติงาน (On-site Workforce)
                  </CardTitle>
                  <CardDescription>สรุปสถานะพนักงาน 5 รายล่าสุดที่ปฏิบัติงานอยู่</CardDescription>
                </div>
                <Button variant="ghost" size="sm" className="text-xs" asChild>
                  <Link href="/client-portal/waves">ดูทั้งหมด <ChevronRight className="h-4 w-4" /></Link>
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="pl-6">พนักงาน</TableHead>
                      <TableHead>โครงการ</TableHead>
                      <TableHead className="text-center">วันทำงาน (สะสม)</TableHead>
                      <TableHead className="text-right pr-6">คงเหลือ (วัน)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeWorkerStats.map(w => (
                      <TableRow key={w.id} className="hover:bg-muted/10 transition-colors">
                        <TableCell className="pl-6">
                          <div className="flex flex-col">
                            <span className="font-bold text-sm text-primary">{w.name}</span>
                            <span className="text-[10px] text-muted-foreground uppercase">{w.position}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs font-medium">{w.projectName}</TableCell>
                        <TableCell className="text-center">
                          <div className="flex flex-col items-center gap-1">
                            <span className="font-black text-blue-700">{w.daysWorked} วัน</span>
                            <div className="w-24 h-1 bg-slate-100 rounded-full overflow-hidden">
                              <div className="h-full bg-blue-500" style={{ width: `${w.percent}%` }} />
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right pr-6 font-bold text-slate-600">{w.remaining} วัน</TableCell>
                      </TableRow>
                    ))}
                    {activeWorkerStats.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="py-10 text-center text-muted-foreground italic">ไม่มีพนักงานปฏิบัติงานอยู่ในขณะนี้</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="shadow-md border-none overflow-hidden">
                <CardHeader className="bg-primary/5 border-b">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <ShoppingCart className="h-4 w-4 text-primary" /> ใบสั่งซื้อโครงการ (Purchase Orders)
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {pos?.slice(0, 5).map(p => (
                      <div key={p.id} className="p-3 flex items-center justify-between text-xs hover:bg-muted/10 transition-colors">
                        <div className="space-y-0.5">
                          <p className="font-bold text-primary">{p.poCode}</p>
                          <p className="text-muted-foreground truncate max-w-[150px]">{p.title}</p>
                        </div>
                        <Badge variant="outline" className="text-[9px] uppercase">{p.status}</Badge>
                      </div>
                    ))}
                    {!pos?.length && <p className="p-10 text-center text-xs text-muted-foreground italic">ไม่มีข้อมูล PO</p>}
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-md border-none overflow-hidden">
                <CardHeader className="bg-primary/5 border-b">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary" /> สัญญาที่เกี่ยวข้อง (Main Contracts)
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {contracts?.slice(0, 5).map(c => (
                      <div key={c.id} className="p-3 flex items-center justify-between text-xs hover:bg-muted/10 transition-colors">
                        <div className="space-y-0.5">
                          <p className="font-bold text-primary">{c.contractNumber}</p>
                          <p className="text-muted-foreground truncate max-w-[150px]">{c.title}</p>
                        </div>
                        <Badge className="bg-green-600 text-[9px] h-4">{c.status.toUpperCase()}</Badge>
                      </div>
                    ))}
                    {!contracts?.length && <p className="p-10 text-center text-xs text-muted-foreground italic">ไม่มีข้อมูลสัญญา</p>}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Sidebar Area */}
          <div className="space-y-6">
            <Card className="bg-primary text-primary-foreground shadow-lg overflow-hidden border-none">
              <CardHeader className="pb-4 border-b border-white/10">
                <CardTitle className="text-sm font-black uppercase tracking-widest flex items-center gap-2">
                  <ClipboardCheck className="h-4 w-4" /> ทางลัดการอนุมัติ (Approval Hub)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-2">
                <ShortcutItem 
                  href="/client-portal/waves" 
                  label="พิจารณาผู้สมัคร" 
                  sub={`${stats.pendingAcceptance} รายการรอพิจารณา`} 
                  icon={Users} 
                  count={stats.pendingAcceptance}
                />
                <ShortcutItem 
                  href="/client-portal/timesheets" 
                  label="อนุมัติเวลาทำงาน" 
                  sub={`${stats.pendingTimesheet} วันที่รอรับรอง`} 
                  icon={Clock} 
                  count={stats.pendingTimesheet}
                />
              </CardContent>
            </Card>

            <Card className="shadow-md border-none overflow-hidden">
              <CardHeader className="bg-muted/30 border-b">
                <CardTitle className="text-xs font-black uppercase text-muted-foreground flex items-center gap-2">
                  <Waves className="h-3 w-3" /> รอบงานที่ดำเนินการ (Active Waves)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                {waves?.filter(w => w.status === 'ACTIVE').slice(0, 3).map(wave => (
                  <div key={wave.id} className="space-y-2">
                    <div className="flex justify-between items-center">
                      <p className="text-xs font-bold text-primary">{wave.waveCode}</p>
                      <Badge variant="outline" className="text-[9px]">{wave.rotationPattern}</Badge>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <MapPin className="h-3 w-3" /> {wave.siteLocation}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <Calendar className="h-3 w-3" /> {wave.startDate} - {wave.endDate}
                    </div>
                    <Separator className="mt-2" />
                  </div>
                ))}
                {!waves?.filter(w => w.status === 'ACTIVE').length && (
                  <p className="text-center text-xs text-muted-foreground italic">ไม่มีรอบงานที่ดำเนินการอยู่</p>
                )}
              </CardContent>
            </Card>

            <PageGuidance 
              tips={[
                "คุณสามารถกดที่ 'พิจารณาผู้สมัคร' เพื่อตรวจสอบประวัติคนงานก่อนเริ่มงาน",
                "ใบลงเวลา (Timesheets) จะแสดงเฉพาะรายการที่ฝ่ายปฏิบัติการตรวจสอบแล้วเท่านั้น",
                "ข้อมูลพนักงานและโครงการถูกจำกัดให้เห็นเฉพาะส่วนที่เกี่ยวข้องกับบริษัทของคุณ"
              ]}
            />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function StatCard({ title, value, sub, icon: Icon, colorClass }: any) {
  return (
    <Card className={`hover:shadow-md transition-all border-l-8 ${colorClass} shadow-sm bg-white`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 opacity-30 text-primary" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-black text-primary truncate">{value}</div>
        <p className="text-[10px] font-medium text-muted-foreground mt-1 uppercase tracking-tighter">{sub}</p>
      </CardContent>
    </Card>
  );
}

function ShortcutItem({ href, label, sub, icon: Icon, count }: any) {
  return (
    <Link href={href} className="flex items-center justify-between p-3 rounded-xl bg-white/10 hover:bg-white/20 transition-all group">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-white/10 group-hover:bg-white/20 transition-colors">
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex flex-col">
          <span className="text-xs font-bold">{label}</span>
          <span className="text-[9px] opacity-60 uppercase">{sub}</span>
        </div>
      </div>
      {count > 0 && <Badge className="bg-amber-500 text-white border-none h-5 min-w-5 justify-center font-bold text-[10px]">{count}</Badge>}
    </Link>
  );
}
