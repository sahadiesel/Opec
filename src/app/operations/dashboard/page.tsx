'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { 
  HardHat, 
  Waves, 
  Truck, 
  UserPlus, 
  AlertCircle, 
  AlertTriangle,
  ClipboardCheck, 
  Clock, 
  ArrowRight, 
  ChevronRight, 
  ShieldAlert, 
  Info,
  Calendar,
  MapPin,
  Users,
  CheckCircle2,
  XCircle,
  Activity
} from 'lucide-react';
import { 
  User, 
  Assignment, 
  Wave, 
  Worker,
  Position
} from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where, limit } from 'firebase/firestore';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Separator } from '@/components/ui/separator';

export default function OperationsDashboardPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const isOperations = useMemo(() => {
    return currentUser?.department === 'operations' || currentUser?.department === 'admin';
  }, [currentUser]);

  // --- Operations Data Queries ---
  
  const mobQuery = useMemoFirebase(() => {
    if (!firestore || !isOperations) return null;
    return collection(firestore, 'mobilizations');
  }, [firestore, isOperations]);
  const { data: assignments, isLoading: isAsgnLoading } = useCollection<Assignment>(mobQuery as any);

  const wavesQuery = useMemoFirebase(() => {
    if (!firestore || !isOperations) return null;
    return collection(firestore, 'waves');
  }, [firestore, isOperations]);
  const { data: waves } = useCollection<Wave>(wavesQuery as any);

  const workersQuery = useMemoFirebase(() => {
    if (!firestore || !isOperations) return null;
    return collection(firestore, 'workers');
  }, [firestore, isOperations]);
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  const positionsQuery = useMemoFirebase(() => (firestore && isOperations ? collection(firestore, 'positions') : null), [firestore, isOperations]);
  const { data: allPositions } = useCollection<Position>(positionsQuery as any);

  // --- Computed Operations Stats ---

  const stats = useMemo(() => {
    if (!assignments || !waves) return { activeAsgn: 0, activeWaves: 0, pendingMob: 0, incompleteReadiness: 0, replacements: 0 };
    
    return {
      activeAsgn: assignments.filter(a => a.deploymentStatus === 'ACTIVE').length,
      activeWaves: waves.filter(w => w.status === 'ACTIVE').length,
      pendingMob: assignments.filter(a => ['READY_TO_MOB', 'MOBILIZING'].includes(a.deploymentStatus)).length,
      incompleteReadiness: assignments.filter(a => a.readinessStatus === 'incomplete' && a.deploymentStatus !== 'CLOSED').length,
      replacements: assignments.filter(a => a.clientApprovalStatus === 'REJECTED').length,
      planningWaves: waves.filter(w => ['PLANNING', 'RECRUITING'].includes(w.status)).length,
    };
  }, [assignments, waves]);

  const urgentTasks = useMemo(() => {
    const tasks = [];
    
    // Incomplete Readiness for upcoming mobs
    assignments?.filter(a => a.readinessStatus === 'incomplete' && a.deploymentStatus === 'READINESS_CHECK').slice(0, 5).forEach(a => {
      const worker = allWorkers?.find(w => w.id === a.workerId);
      tasks.push({
        id: a.id,
        type: 'Readiness Issue',
        label: `Missing Reqs: ${worker?.firstName || 'Worker'}`,
        sub: a.projectName,
        status: 'INCOMPLETE',
        link: `/mobilization/${a.id}`,
        priority: 'high'
      });
    });

    // Rejected candidates needing replacement
    assignments?.filter(a => a.clientApprovalStatus === 'REJECTED').slice(0, 5).forEach(a => {
      tasks.push({
        id: a.id,
        type: 'Replacement',
        label: `Client Rejected: ${a.projectName}`,
        sub: `Position: ${a.positionId}`,
        status: 'REJECTED',
        link: `/assignments/${a.id}`,
        priority: 'high'
      });
    });

    // Waves needing staff
    waves?.filter(w => w.status === 'PLANNING').slice(0, 5).forEach(w => {
      tasks.push({
        id: w.id,
        type: 'Planning',
        label: `New Wave: ${w.waveCode}`,
        sub: `Site: ${w.siteLocation}`,
        status: 'PLANNING',
        link: `/waves/${w.id}`,
        priority: 'medium'
      });
    });

    return tasks;
  }, [assignments, waves, allWorkers]);

  if (isUserLoading || !currentUser) return null;

  if (!isOperations) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <ShieldAlert className="h-12 w-12 text-destructive opacity-50" />
          <h2 className="text-xl font-bold">Access Denied</h2>
          <p className="text-muted-foreground">This dashboard is reserved for Operations personnel.</p>
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
            <HardHat className="h-8 w-8" /> แดชบอร์ดฝ่ายปฏิบัติการ (Operations Dashboard)
          </h1>
          <p className="text-muted-foreground text-lg italic">
            ติดตามการมอบหมายงาน เวฟ การ mobilization ความพร้อมก่อนลงงาน และงานปฏิบัติการที่ต้องดำเนินการ (Monitor assignments, waves, mobilization, and field operations).
          </p>
        </div>

        {/* Top KPI Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <StatCard title="งานที่กำลังทำ (Active)" value={stats.activeAsgn} sub="Active Assignments" icon={Users} colorClass="border-l-blue-600" />
          <StatCard title="เวฟที่ดำเนินการอยู่" value={stats.activeWaves} sub="Current Active Waves" icon={Waves} colorClass="border-l-green-600" />
          <StatCard title="กำลังส่งตัว (Mob)" value={stats.pendingMob} sub="In-Transit / Dispatch" icon={Truck} colorClass="border-l-purple-600" />
          <StatCard title="ความพร้อมไม่ครบ" value={stats.incompleteReadiness} sub="Incomplete Readiness" icon={AlertCircle} colorClass={stats.incompleteReadiness > 0 ? "border-l-red-600 text-red-600" : "border-l-slate-200"} />
          <StatCard title="ขอเปลี่ยนตัว" value={stats.replacements} sub="Replacement Requests" icon={ShieldAlert} colorClass="border-l-orange-500" />
          <StatCard title="เวฟรอดำเนินการ" value={stats.planningWaves} sub="Planning / Recruiting" icon={Calendar} colorClass="border-l-slate-400" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Action Queue Section */}
          <div className="lg:col-span-2 space-y-6">
            <Card className="shadow-md border-none overflow-hidden">
              <CardHeader className="bg-primary/5 border-b pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Clock className="h-5 w-5 text-primary" /> งานที่ต้องดำเนินการ (Operations Action Queue)
                    </CardTitle>
                    <CardDescription>รายการงานด่วนและจุดติดขัด (Operational Bottlenecks) ที่ต้องจัดการ</CardDescription>
                  </div>
                  <Badge variant="secondary" className="font-bold">{urgentTasks.length} รายการ</Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {urgentTasks.length > 0 ? (
                  <div className="divide-y">
                    {urgentTasks.map(task => (
                      <Link key={task.id} href={task.link} className="block hover:bg-slate-50 transition-colors group">
                        <div className="p-4 flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div className={`p-2 rounded-lg ${task.priority === 'high' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
                              {task.type.includes('Readiness') ? <ClipboardCheck className="h-5 w-5" /> : task.type.includes('Wave') ? <Waves className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />}
                            </div>
                            <div className="space-y-0.5">
                              <p className="font-bold text-primary group-hover:text-blue-600 transition-colors">{task.label}</p>
                              <div className="flex items-center gap-2 text-[10px] uppercase font-black tracking-widest text-muted-foreground">
                                <span>{task.type}</span>
                                <span>•</span>
                                <span>{task.sub}</span>
                                <span>•</span>
                                <span className={task.priority === 'high' ? 'text-red-500' : ''}>{task.status}</span>
                              </div>
                            </div>
                          </div>
                          <ChevronRight className="h-5 w-5 text-muted-foreground opacity-30 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="py-20 text-center space-y-4">
                    <CheckCircle2 className="h-12 w-12 mx-auto text-green-500/20" />
                    <p className="text-muted-foreground italic">ไม่มีงานปฏิบัติการค้างในขณะนี้ (Operational clear)</p>
                  </div>
                )}
              </CardContent>
              <CardFooter className="bg-muted/30 p-3 flex justify-center border-t">
                <Button variant="link" className="text-xs text-muted-foreground" asChild>
                  <Link href="/mobilization">ดูการส่งตัวทั้งหมด <ArrowRight className="h-3 w-3 ml-1" /></Link>
                </Button>
              </CardFooter>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="shadow-md border-none overflow-hidden">
                <CardHeader className="bg-primary/5 border-b pb-4">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-primary" /> สรุปสถานะตามหน้างาน (Site Status)
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {waves?.filter(w => w.status === 'ACTIVE').slice(0, 5).map(wave => (
                      <div key={wave.id} className="p-3 flex items-center justify-between text-xs">
                        <div className="space-y-0.5">
                          <p className="font-bold">{wave.waveCode}</p>
                          <p className="text-muted-foreground">{wave.siteLocation}</p>
                        </div>
                        <div className="text-right">
                          <Badge variant="outline" className="text-[10px]">{wave.assignedWorkers} / {wave.plannedWorkers} Workers</Badge>
                        </div>
                      </div>
                    ))}
                    {(!waves || waves.filter(w => w.status === 'ACTIVE').length === 0) && <p className="p-10 text-center text-xs text-muted-foreground italic">No active field waves</p>}
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-md border-none overflow-hidden">
                <CardHeader className="bg-primary/5 border-b pb-4">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Activity className="h-4 w-4 text-primary" /> Mobilization Pipeline
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {assignments?.filter(a => ['READY_TO_MOB', 'MOBILIZING'].includes(a.deploymentStatus)).slice(0, 5).map(asgn => {
                      const worker = allWorkers?.find(w => w.id === asgn.workerId);
                      return (
                        <div key={asgn.id} className="p-3 flex items-center justify-between text-xs">
                          <div className="space-y-0.5">
                            <p className="font-bold">{worker?.firstName} {worker?.lastName}</p>
                            <p className="text-muted-foreground uppercase text-[10px]">{asgn.deploymentStatus}</p>
                          </div>
                          <Button variant="ghost" size="icon" className="h-6 w-6" asChild>
                            <Link href={`/mobilization/${asgn.id}`}><ChevronRight className="h-3 w-3" /></Link>
                          </Button>
                        </div>
                      );
                    })}
                    {(!assignments || assignments.filter(a => ['READY_TO_MOB', 'MOBILIZING'].includes(a.deploymentStatus)).length === 0) && <p className="p-10 text-center text-xs text-muted-foreground italic">No personnel in transit</p>}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Sidebar Section */}
          <div className="space-y-6">
            <Card className="shadow-md border-none">
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-sm font-bold flex items-center gap-2 text-primary">
                  <ShieldAlert className="h-4 w-4" /> ทางลัดฝ่ายปฏิบัติการ (Operations Shortcuts)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-2">
                <ShortcutItem href="/waves" label="จัดการรอบงาน (Waves)" sub="Wave Planning" icon={Waves} />
                <ShortcutItem href="/assignments" label="มอบหมายคนงาน" sub="Personnel Assignments" icon={UserPlus} />
                <ShortcutItem href="/mobilization" label="ศูนย์รวมการส่งตัว" sub="Mobilization Hub" icon={Truck} />
                <ShortcutItem href="/timesheets" label="ตรวจสอบใบลงเวลา" sub="Timesheet Review" icon={Calendar} />
                <ShortcutItem href="/workers" label="ทะเบียนคนงาน" sub="Worker Records" icon={Users} />
              </CardContent>
            </Card>

            <Card className="bg-blue-50 border-blue-100 shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold uppercase text-blue-800 flex items-center gap-2">
                  <Info className="h-3 w-3" /> Ops Policy reminder
                </CardTitle>
              </CardHeader>
              <CardContent className="text-[10px] text-blue-700 leading-relaxed">
                ห้ามยืนยัน Mobilization หากคนงานยังมีสถานะ Incomplete Readiness หรือยังไม่ได้เบิกชุด PPE บังคับตามเกณฑ์ตำแหน่ง
              </CardContent>
            </Card>

            <Card className="bg-amber-50 border-amber-100 shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold uppercase text-amber-800 flex items-center gap-2">
                  <AlertTriangle className="h-3 w-3" /> Deployment Alert
                </CardTitle>
              </CardHeader>
              <CardContent className="text-[10px] text-amber-700 leading-relaxed">
                ตรวจสอบคนงานที่ใกล้จบภารกิจ (Nearing Demobilization) เพื่อวางแผนการส่งคนชุดใหม่ทดแทน (Rotation Planning)
              </CardContent>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function StatCard({ title, value, sub, icon: Icon, colorClass }: any) {
  return (
    <Card className={`hover:shadow-md transition-all border-l-8 ${colorClass} shadow-sm bg-white h-full`}>
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

function ShortcutItem({ href, label, sub, icon: Icon }: any) {
  return (
    <Link href={href} className="flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-50 transition-colors group">
      <div className="flex items-center gap-3">
        <Icon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
        <div className="flex flex-col">
          <span className="text-xs font-bold text-primary">{label}</span>
          <span className="text-[9px] text-muted-foreground uppercase">{sub}</span>
        </div>
      </div>
      <ArrowRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-all translate-x-[-4px] group-hover:translate-x-0" />
    </Link>
  );
}
