
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
  Activity,
  RotateCcw
} from 'lucide-react';
import { 
  User, 
  Assignment, 
  Wave, 
  Worker,
  Position,
  ExceptionRequest
} from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where, limit, orderBy } from 'firebase/firestore';
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

  const exceptionQuery = useMemoFirebase(() => {
    if (!firestore || !isOperations) return null;
    return query(
      collection(firestore, 'exception_requests'), 
      where('requestType', '==', 'ASSIGNMENT_CHANGE'),
      where('status', '==', 'PENDING'),
      limit(10)
    );
  }, [firestore, isOperations]);
  const { data: pendingExceptions } = useCollection<ExceptionRequest>(exceptionQuery as any);

  const workersQuery = useMemoFirebase(() => {
    if (!firestore || !isOperations) return null;
    return collection(firestore, 'workers');
  }, [firestore, isOperations]);
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  // --- Computed Operations Stats ---

  const urgentTasks = useMemo(() => {
    const tasks: any[] = [];
    
    // Exception Requests (Assignment Changes)
    pendingExceptions?.forEach(req => {
      tasks.push({
        id: req.id,
        type: 'Personnel Change',
        label: `Request to change: ${req.referenceNo}`,
        status: 'PENDING',
        link: `/assignments/${req.referenceId}`,
        priority: 'high',
        icon: RotateCcw
      });
    });

    // Incomplete Readiness for upcoming mobs
    assignments?.filter(a => a.readinessStatus === 'incomplete' && a.deploymentStatus === 'READINESS_CHECK').slice(0, 5).forEach(a => {
      const worker = allWorkers?.find(w => w.id === a.workerId);
      tasks.push({
        id: a.id,
        type: 'Readiness Issue',
        label: `Missing Reqs: ${worker?.firstName || 'Worker'}`,
        status: 'INCOMPLETE',
        link: `/mobilization/${a.id}`,
        priority: 'medium',
        icon: ClipboardCheck
      });
    });

    return tasks;
  }, [assignments, pendingExceptions, allWorkers]);

  const stats = useMemo(() => {
    if (!assignments || !waves) return { activeAsgn: 0, activeWaves: 0, pendingMob: 0, changeReqs: 0 };
    return {
      activeAsgn: assignments.filter(a => a.deploymentStatus === 'ACTIVE').length,
      activeWaves: waves.filter(w => w.status === 'ACTIVE').length,
      pendingMob: assignments.filter(a => ['READY_TO_MOB', 'MOBILIZING'].includes(a.deploymentStatus)).length,
      changeReqs: pendingExceptions?.length || 0,
    };
  }, [assignments, waves, pendingExceptions]);

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
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <HardHat className="h-8 w-8" /> แดชบอร์ดฝ่ายปฏิบัติการ (Operations Dashboard)
          </h1>
          <p className="text-muted-foreground text-lg italic">
            ติดตามสถานะกำลังพล เวฟงาน และคำขอเปลี่ยนแปลงจากลูกค้า (Manpower & Site operational oversight).
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="กำลังปฏิบัติงาน" value={stats.activeAsgn} sub="Active Assignments" icon={Users} colorClass="border-l-blue-600" />
          <StatCard title="เวฟที่ดำเนินการอยู่" value={stats.activeWaves} sub="Current Active Waves" icon={Waves} colorClass="border-l-green-600" />
          <StatCard title="กำลังส่งตัว" value={stats.pendingMob} sub="In-Transit / Dispatch" icon={Truck} colorClass="border-l-purple-600" />
          <StatCard title="คำขอเปลี่ยนตัว" value={stats.changeReqs} sub="Special Change Requests" icon={RotateCcw} colorClass="border-l-amber-500" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <Card className="shadow-md border-none overflow-hidden">
              <CardHeader className="bg-primary/5 border-b pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Clock className="h-5 w-5 text-primary" /> งานที่ต้องดำเนินการ (Operations Action Queue)
                    </CardTitle>
                    <CardDescription>รายการงานด่วนและคำขอเปลี่ยนแปลงจากลูกค้าที่ต้องจัดการ</CardDescription>
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
                              <task.icon className="h-5 w-5" />
                            </div>
                            <div className="space-y-0.5">
                              <p className="font-bold text-primary group-hover:text-blue-600 transition-colors">{task.label}</p>
                              <div className="flex items-center gap-2 text-[10px] uppercase font-black tracking-widest text-muted-foreground">
                                <span>{task.type}</span>
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
                    <p className="text-muted-foreground italic">ไม่มีงานปฏิบัติการค้างในขณะนี้</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            {/* Sidebar content remains consistent... */}
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
