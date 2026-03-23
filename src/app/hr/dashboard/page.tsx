'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { 
  Users, 
  CheckCircle2, 
  AlertTriangle, 
  Stethoscope, 
  Clock, 
  Coins, 
  FileText, 
  Briefcase, 
  ChevronRight, 
  ArrowRight,
  ShieldAlert,
  Info,
  Calendar,
  Search,
  HardHat,
  RotateCcw
} from 'lucide-react';
import { 
  User, 
  Worker, 
  PayrollRun, 
  Position,
  ExceptionRequest,
  DailyTimesheet,
  MainContract
} from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where, limit, orderBy } from 'firebase/firestore';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { isHRStaff } from '@/lib/permissions';

export default function HRDashboardPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const isHRAuthorized = useMemo(() => {
    return isHRStaff(currentUser);
  }, [currentUser]);

  // --- HR Data Queries ---
  
  const workersQuery = useMemoFirebase(() => {
    if (!firestore || !isHRAuthorized) return null;
    return collection(firestore, 'workers');
  }, [firestore, isHRAuthorized]);
  const { data: workers, isLoading: isWorkersLoading } = useCollection<Worker>(workersQuery as any);

  const payrollQuery = useMemoFirebase(() => {
    if (!firestore || !isHRAuthorized) return null;
    return query(collection(firestore, 'payroll_runs'), where('status', 'in', ['DRAFT', 'HR_REVIEW', 'CALCULATED']), limit(10));
  }, [firestore, isHRAuthorized]);
  const { data: payrollRuns } = useCollection<PayrollRun>(payrollQuery as any);

  const exceptionQuery = useMemoFirebase(() => {
    if (!firestore || !isHRAuthorized) return null;
    return query(
      collection(firestore, 'exception_requests'), 
      where('requestType', '==', 'TIMESHEET_CORRECTION'),
      where('status', '==', 'PENDING'),
      limit(10)
    );
  }, [firestore, isHRAuthorized]);
  const { data: pendingExceptions } = useCollection<ExceptionRequest>(exceptionQuery as any);

  const correctionTsQuery = useMemoFirebase(() => {
    if (!firestore || !isHRAuthorized) return null;
    return query(
      collection(firestore, 'daily_timesheets'),
      where('status', '==', 'CORRECTION_REQUIRED'),
      limit(10)
    );
  }, [firestore, isHRAuthorized]);
  const { data: correctionTs } = useCollection<DailyTimesheet>(correctionTsQuery as any);

  const positionsQuery = useMemoFirebase(() => (firestore && isHRAuthorized ? collection(firestore, 'positions') : null), [firestore, isHRAuthorized]);
  const { data: positions } = useCollection<Position>(positionsQuery as any);

  const mainContractsQuery = useMemoFirebase(() => {
    if (!firestore || !isHRAuthorized) return null;
    return query(collection(firestore, 'main_contracts'), orderBy('updatedAt', 'desc'), limit(30));
  }, [firestore, isHRAuthorized]);
  const { data: mainContracts } = useCollection<MainContract>(mainContractsQuery as any);

  // --- Computed HR Tasks ---

  const pendingHRTasks = useMemo(() => {
    const tasks: any[] = [];
    
    // 1. Exception Requests (Corrections)
    pendingExceptions?.forEach(req => {
      tasks.push({
        id: req.id,
        type: 'Correction Req',
        label: `Client request: ${req.referenceNo}`,
        status: 'PENDING',
        link: `/timesheets/daily/${req.referenceId}`,
        priority: 'high',
        icon: RotateCcw
      });
    });

    // 2. Timesheets requiring correction (Payroll Hold)
    correctionTs?.forEach(ts => {
      tasks.push({
        id: ts.id,
        type: 'Payroll Hold',
        label: `Correction Required: ${ts.workerNameSnapshot}`,
        sub: ts.date,
        status: 'CORRECTION',
        link: `/timesheets/daily/${ts.id}`,
        priority: 'high',
        icon: AlertTriangle
      });
    });

    // 3. Payroll Tasks
    payrollRuns?.forEach(run => {
      tasks.push({
        id: run.id,
        type: 'Worker Payroll',
        label: `Review Payroll: ${run.payrollRunNo}`,
        status: run.status,
        link: `/payroll/batches/${run.id}`,
        priority: 'medium',
        icon: Coins
      });
    });

    // 4. Contracts with incomplete labor cost setup
    (mainContracts || [])
      .filter((c: any) => Number(c.costingMissingPositionsCount || 0) > 0)
      .slice(0, 10)
      .forEach((c: any) => {
        tasks.push({
          id: `contract-${c.id}`,
          type: 'Cost Setup',
          label: `Contract ${c.contractNumber || c.id} missing labor cost`,
          sub: `Missing ${Number(c.costingMissingPositionsCount || 0)} positions`,
          status: 'INCOMPLETE',
          link: `/main-contracts/${c.id}`,
          priority: 'high',
          icon: AlertTriangle,
        });
      });

    // 5. Workers requiring document/certificate completion
    (workers || [])
      .filter((w) => w.readinessStatus !== 'READY')
      .slice(0, 10)
      .forEach((w) => {
        tasks.push({
          id: `worker-${w.id}`,
          type: 'Worker Readiness',
          label: `${w.firstName} ${w.lastName}`,
          sub: w.readinessStatus,
          status: 'PENDING',
          link: `/workers/${w.id}`,
          priority: 'high',
          icon: AlertTriangle,
        });
      });

    // 6. Workers with expiry warning (assignable but close to expiry)
    (workers || [])
      .filter((w) => w.readinessStatus === 'READY' && w.complianceAlertLevel === 'warning')
      .slice(0, 10)
      .forEach((w) => {
        tasks.push({
          id: `worker-warning-${w.id}`,
          type: 'Expiry Warning',
          label: `${w.firstName} ${w.lastName}`,
          sub: `เอกสารใกล้หมดอายุใน ${w.nearestExpiryInDays ?? '-'} วัน`,
          status: 'WARNING',
          link: `/workers/${w.id}`,
          priority: 'medium',
          icon: AlertTriangle,
        });
      });

    return tasks;
  }, [payrollRuns, pendingExceptions, correctionTs, mainContracts, workers]);

  const stats = useMemo(() => {
    if (!workers) return { total: 0, ready: 0, missingCert: 0, medExpired: 0, docExpired: 0, expiringSoon: 0, blocked: 0 };
    return {
      total: workers.length,
      ready: workers.filter(w => w.readinessStatus === 'READY').length,
      missingCert: workers.filter(w => w.readinessStatus === 'MISSING_CERTIFICATE').length,
      medExpired: workers.filter(w => w.readinessStatus === 'MEDICAL_EXPIRED').length,
      docExpired: workers.filter(w => w.readinessStatus === 'DOCUMENT_EXPIRED').length,
      expiringSoon: workers.filter(w => w.readinessStatus === 'READY' && w.complianceAlertLevel === 'warning').length,
      blocked: workers.filter(w => w.readinessStatus === 'BLOCKED').length,
    };
  }, [workers]);

  const contractsMissingCost = useMemo(() => {
    return (mainContracts || []).filter((c: any) => Number(c.costingMissingPositionsCount || 0) > 0);
  }, [mainContracts]);

  if (isUserLoading || !currentUser) return null;

  if (!isHRAuthorized) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <ShieldAlert className="h-12 w-12 text-destructive opacity-50" />
          <h2 className="text-xl font-bold">Access Denied</h2>
          <p className="text-muted-foreground">This dashboard is reserved for HR personnel.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-8 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <Users className="h-8 w-8" /> แดชบอร์ดฝ่ายบุคคล (HR Dashboard)
          </h1>
          <p className="text-muted-foreground text-lg italic">
            ติดตามความพร้อมของลูกจ้าง งานรออนุมัติ และคำขอแก้ไขข้อมูลหลังปิดงวด (Worker compliance & HR action queues).
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-4">
          <StatCard title="ลูกจ้างทั้งหมด" value={stats.total} sub="Total Workers" icon={Users} colorClass="border-l-blue-600" />
          <StatCard title="พร้อมใช้งาน" value={stats.ready} sub="Ready Workers" icon={CheckCircle2} colorClass="border-l-green-600" />
          <StatCard title="ขาดใบรับรอง" value={stats.missingCert} sub="Missing Certs" icon={AlertTriangle} colorClass="border-l-orange-500" />
          <StatCard title="ตรวจสุขภาพหมดอายุ" value={stats.medExpired} sub="Expired Medical" icon={Stethoscope} colorClass="border-l-red-600" />
          <StatCard title="เอกสารหมดอายุ" value={stats.docExpired} sub="Expired Documents" icon={FileText} colorClass="border-l-rose-600" />
          <StatCard title="ใกล้หมดอายุ" value={stats.expiringSoon} sub="Expiry Warnings" icon={AlertTriangle} colorClass="border-l-orange-500" />
          <StatCard title="บล็อก Assign" value={stats.blocked} sub="Blocked By Policy" icon={ShieldAlert} colorClass="border-l-red-600" />
          <StatCard title="งานค้าง HR" value={pendingHRTasks.length} sub="Pending Tasks" icon={Clock} colorClass="border-l-purple-600" />
          <StatCard title="คำขอแก้ไข" value={(pendingExceptions?.length || 0) + (correctionTs?.length || 0)} sub="Correction Queue" icon={RotateCcw} colorClass="border-l-amber-500" />
          <StatCard title="สัญญาต้นทุนไม่ครบ" value={contractsMissingCost.length} sub="Contract Cost Gaps" icon={AlertTriangle} colorClass="border-l-rose-600" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Action Queue Section */}
          <div className="lg:col-span-2 space-y-6">
            <Card className="shadow-md border-none overflow-hidden">
              <CardHeader className="bg-primary/5 border-b pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Clock className="h-5 w-5 text-primary" /> งานที่ต้องดำเนินการ (HR Action Queue)
                    </CardTitle>
                    <CardDescription>รายการด่วนที่ต้องการการตรวจสอบหรืออนุมัติจากฝ่ายบุคคล</CardDescription>
                  </div>
                  <Badge variant="secondary" className="font-bold">{pendingHRTasks.length} รายการ</Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {pendingHRTasks.length > 0 ? (
                  <div className="divide-y">
                    {pendingHRTasks.map(task => (
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
                                {task.sub && <span>• {task.sub}</span>}
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
                    <p className="text-muted-foreground italic">ไม่มีงานค้างที่ต้องดำเนินการในขณะนี้</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="bg-amber-50 border-amber-100 shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold uppercase text-amber-800 flex items-center gap-2">
                  <AlertTriangle className="h-3 w-3" /> Payroll Lock Reminder
                </CardTitle>
              </CardHeader>
              <CardContent className="text-[10px] text-amber-700 leading-relaxed">
                รายการที่สถานะเป็น 'CORRECTION_REQUIRED' จะไม่ถูกนำไปคำนวณในงวด Payroll กรุณาเร่งประสานงานแก้ไขและยืนยันยอดให้ทันรอบการจ่าย
              </CardContent>
            </Card>

            <Card className="bg-rose-50 border-rose-100 shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold uppercase text-rose-800 flex items-center gap-2">
                  <AlertTriangle className="h-3 w-3" /> Contract Cost Readiness
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {contractsMissingCost.length === 0 ? (
                  <p className="text-[10px] text-rose-700">ไม่มีสัญญาที่ค้างกำหนดต้นทุนตำแหน่ง</p>
                ) : (
                  contractsMissingCost.slice(0, 6).map((c: any) => (
                    <Link key={c.id} href={`/main-contracts/${c.id}`} className="block text-[10px] text-rose-700 hover:underline">
                      {c.contractNumber || c.id}: ต้นทุนไม่ครบ {Number(c.costingMissingPositionsCount || 0)} ตำแหน่ง
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>
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
        <div className="text-xl font-black text-primary truncate">{value}</div>
        <p className="text-[10px] font-medium text-muted-foreground mt-1 uppercase tracking-tighter">{sub}</p>
      </CardContent>
    </Card>
  );
}
