
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
  HardHat
} from 'lucide-react';
import { 
  User, 
  Worker, 
  PayrollRun, 
  OfficePayrollRun, 
  Position 
} from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where, limit } from 'firebase/firestore';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';

export default function HRDashboardPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const isHR = useMemo(() => {
    return currentUser?.department === 'hr' || currentUser?.department === 'admin';
  }, [currentUser]);

  // --- HR Data Queries ---
  
  const workersQuery = useMemoFirebase(() => {
    if (!firestore || !isHR) return null;
    return collection(firestore, 'workers');
  }, [firestore, isHR]);
  const { data: workers, isLoading: isWorkersLoading } = useCollection<Worker>(workersQuery as any);

  const payrollQuery = useMemoFirebase(() => {
    if (!firestore || !isHR) return null;
    return query(collection(firestore, 'payroll_runs'), where('status', 'in', ['DRAFT', 'HR_REVIEW', 'CALCULATED']), limit(10));
  }, [firestore, isHR]);
  const { data: payrollRuns } = useCollection<PayrollRun>(payrollQuery as any);

  const officePayrollQuery = useMemoFirebase(() => {
    if (!firestore || !isHR) return null;
    return query(collection(firestore, 'office_payroll_runs'), where('status', 'in', ['DRAFT', 'CALCULATED', 'HR_REVIEW']), limit(10));
  }, [firestore, isHR]);
  const { data: officePayrollRuns } = useCollection<OfficePayrollRun>(officePayrollQuery as any);

  const positionsQuery = useMemoFirebase(() => (firestore && isHR ? collection(firestore, 'positions') : null), [firestore, isHR]);
  const { data: positions } = useCollection<Position>(positionsQuery as any);

  // --- Computed HR Stats ---

  const stats = useMemo(() => {
    if (!workers) return { total: 0, ready: 0, missingCert: 0, medExpired: 0, drugExpired: 0 };
    return {
      total: workers.length,
      ready: workers.filter(w => w.readinessStatus === 'READY').length,
      missingCert: workers.filter(w => w.readinessStatus === 'MISSING_CERTIFICATE').length,
      medExpired: workers.filter(w => w.readinessStatus === 'MEDICAL_EXPIRED').length,
      drugExpired: workers.filter(w => w.readinessStatus === 'DRUG_TEST_EXPIRED').length,
    };
  }, [workers]);

  const readinessPercent = useMemo(() => {
    if (!stats.total) return 0;
    return Math.round((stats.ready / stats.total) * 100);
  }, [stats]);

  const pendingHRTasks = useMemo(() => {
    const tasks = [];
    
    // Payroll Tasks
    payrollRuns?.forEach(run => {
      if (run.status === 'HR_REVIEW' || run.status === 'CALCULATED') {
        tasks.push({
          id: run.id,
          type: 'Worker Payroll',
          label: `Review Payroll: ${run.payrollRunNo}`,
          status: run.status,
          link: `/payroll/${run.id}`,
          priority: 'high'
        });
      }
    });

    officePayrollRuns?.forEach(run => {
      if (run.status === 'HR_REVIEW' || run.status === 'CALCULATED') {
        tasks.push({
          id: run.id,
          type: 'Office Payroll',
          label: `Review Office Salary: ${run.payrollRunNo}`,
          status: run.status,
          link: `/office-payroll/${run.id}`,
          priority: 'medium'
        });
      }
    });

    return tasks;
  }, [payrollRuns, officePayrollRuns]);

  const nonCompliantWorkers = useMemo(() => {
    if (!workers) return [];
    return workers.filter(w => w.readinessStatus !== 'READY').slice(0, 5);
  }, [workers]);

  if (isUserLoading || !currentUser) return null;

  if (!isHR) {
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
        {/* Header */}
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <Users className="h-8 w-8" /> แดชบอร์ดฝ่ายบุคคล (HR Dashboard)
          </h1>
          <p className="text-muted-foreground text-lg italic">
            ติดตามความพร้อมของลูกจ้าง เอกสารสำคัญ งานรอตรวจ และงานที่ต้องอนุมัติของฝ่ายบุคคล (Monitor worker readiness, compliance, and pending HR tasks).
          </p>
        </div>

        {/* Top KPI Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <StatCard title="ลูกจ้างทั้งหมด" value={stats.total} sub="Total Workers" icon={Users} colorClass="border-l-blue-600" />
          <StatCard title="พร้อมใช้งาน" value={stats.ready} sub="Ready Workers" icon={CheckCircle2} colorClass="border-l-green-600" />
          <StatCard title="ขาดใบรับรอง" value={stats.missingCert} sub="Missing Certs" icon={AlertTriangle} colorClass="border-l-orange-500" />
          <StatCard title="ตรวจสุขภาพหมดอายุ" value={stats.medExpired} sub="Expired Medical" icon={Stethoscope} colorClass="border-l-red-600" />
          <StatCard title="รอตรวจ Payroll" value={pendingHRTasks.length} sub="Pending HR Review" icon={Coins} colorClass="border-l-purple-600" />
          <StatCard title="ตำแหน่งงาน" value={positions?.length || 0} sub="Active Positions" icon={Briefcase} colorClass="border-l-slate-400" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Work Queue Section */}
          <div className="lg:col-span-2 space-y-6">
            <Card className="shadow-md border-none overflow-hidden">
              <CardHeader className="bg-primary/5 border-b pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Clock className="h-5 w-5 text-primary" /> งานที่ต้องดำเนินการ (HR Action Queue)
                    </CardTitle>
                    <CardDescription>รายการงานด่วนที่ต้องการการตรวจสอบหรืออนุมัติจากฝ่ายบุคคล</CardDescription>
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
                              <Coins className="h-5 w-5" />
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
                    <p className="text-muted-foreground italic">ไม่มีงานค้างที่ต้องดำเนินการในขณะนี้</p>
                  </div>
                )}
              </CardContent>
              <CardFooter className="bg-muted/30 p-3 flex justify-center border-t">
                <Button variant="link" className="text-xs text-muted-foreground" asChild>
                  <Link href="/payroll/batches">ดูระบบจ่ายเงินทั้งหมด <ArrowRight className="h-3 w-3 ml-1" /></Link>
                </Button>
              </CardFooter>
            </Card>

            <Card className="shadow-md border-none overflow-hidden">
              <CardHeader className="bg-primary/5 border-b pb-4">
                <CardTitle className="text-lg flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5 text-orange-600" /> ลูกจ้างที่ไม่พร้อม (Non-Compliant Workers)
                </CardTitle>
                <CardDescription>รายชื่อพนักงานที่เอกสารหมดอายุหรือยังไม่ครบตามเกณฑ์มาตรฐาน</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {nonCompliantWorkers.map(w => (
                    <div key={w.id} className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center font-bold text-primary">
                          {w.firstName.charAt(0)}
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-sm font-bold text-primary">{w.firstName} {w.lastName}</p>
                          <p className="text-[10px] text-muted-foreground uppercase">{positions?.find(p => p.id === w.currentPositionId)?.positionNameTh || 'No Position'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <Badge variant="outline" className="border-orange-200 bg-orange-50 text-orange-700 text-[9px] font-bold">
                          {w.readinessStatus.replace(/_/g, ' ')}
                        </Badge>
                        <Button variant="ghost" size="icon" asChild>
                          <Link href={`/workers/${w.id}`}><ChevronRight className="h-4 w-4" /></Link>
                        </Button>
                      </div>
                    </div>
                  ))}
                  {nonCompliantWorkers.length === 0 && (
                    <div className="py-10 text-center text-muted-foreground italic text-sm">Every worker is currently READY.</div>
                  )}
                </div>
              </CardContent>
              <CardFooter className="bg-muted/30 p-3 flex justify-center border-t">
                <Button variant="link" className="text-xs text-muted-foreground" asChild>
                  <Link href="/workers">ดูรายชื่อคนงานทั้งหมด <ArrowRight className="h-3 w-3 ml-1" /></Link>
                </Button>
              </CardFooter>
            </Card>
          </div>

          {/* Sidebar Section */}
          <div className="space-y-6">
            <Card className="shadow-md border-primary/10">
              <CardHeader className="bg-primary text-primary-foreground">
                <CardTitle className="text-sm font-black uppercase tracking-widest flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" /> ภาพรวมความพร้อม (Readiness Hub)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-6">
                <div className="space-y-2">
                  <div className="flex justify-between items-end">
                    <p className="text-sm font-bold text-primary">อัตราความพร้อมรวม (Overall Readiness)</p>
                    <p className="text-2xl font-black text-primary">{readinessPercent}%</p>
                  </div>
                  <Progress value={readinessPercent} className="h-2" />
                  <p className="text-[10px] text-muted-foreground italic text-right">
                    {stats.ready} จาก {stats.total} คน มีสถานะ READY
                  </p>
                </div>

                <Separator />

                <div className="space-y-3">
                  <p className="text-[10px] font-black text-muted-foreground uppercase tracking-wider">Breakdown by Status:</p>
                  <StatusItem label="Ready (พร้อมส่งตัว)" count={stats.ready} color="bg-green-500" />
                  <StatusItem label="Missing Certs (ขาดใบเซอร์)" count={stats.missingCert} color="bg-orange-500" />
                  <StatusItem label="Medical Expired (ตรวจร่างกาย)" count={stats.medExpired} color="bg-red-500" />
                  <StatusItem label="Other Issues (อื่นๆ)" count={stats.total - stats.ready - stats.missingCert - stats.medExpired} color="bg-slate-300" />
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-md border-none">
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-sm font-bold flex items-center gap-2 text-primary">
                  <ShieldAlert className="h-4 w-4" /> ทางลัดงานฝ่ายบุคคล (HR Shortcuts)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-2">
                <ShortcutItem href="/workers" label="ทะเบียนคนงาน" sub="Worker Records" icon={HardHat} />
                <ShortcutItem href="/positions" label="ตำแหน่งงานมาตรฐาน" sub="Job Matrix" icon={Briefcase} />
                <ShortcutItem href="/payroll/batches" label="ประมวลผลเงินเดือน" sub="Payroll System" icon={Coins} />
                <ShortcutItem href="/office-staff" label="พนักงานออฟฟิศ" sub="Office Employees" icon={Users} />
                <ShortcutItem href="/timesheets/daily" label="ระบบลงเวลา" sub="Timesheet History" icon={Calendar} />
              </CardContent>
            </Card>

            <Card className="bg-blue-50 border-blue-100 shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold uppercase text-blue-800 flex items-center gap-2">
                  <Info className="h-3 w-3" /> HR Policy reminder
                </CardTitle>
              </Header>
              <CardContent className="text-[10px] text-blue-700 leading-relaxed">
                ห้ามอนุมัติ Payroll หากยังมีใบลงเวลา (Timesheet) ที่ไม่อยู่ในสถานะ Approved การแก้ไขประวัติคนงานจะมีผลต่อการคำนวณ Readiness ทันที
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
        <div className="text-2xl font-black text-primary truncate">{value}</div>
        <p className="text-[10px] font-medium text-muted-foreground mt-1 uppercase tracking-tighter">{sub}</p>
      </CardContent>
    </Card>
  );
}

function StatusItem({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <div className="flex items-center gap-2">
        <div className={`h-2 w-2 rounded-full ${color}`} />
        <span className="text-muted-foreground font-medium">{label}</span>
      </div>
      <span className="font-bold text-primary">{count} คน</span>
    </div>
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
