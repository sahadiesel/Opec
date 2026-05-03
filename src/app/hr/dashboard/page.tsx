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
  RotateCcw,
  Settings,
  Building2,
} from 'lucide-react';
import { 
  User, 
  Worker, 
  PayrollRun, 
  Position,
  ExceptionRequest,
  DailyTimesheet,
} from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where, limit } from 'firebase/firestore';
import { isFieldPositionMissingDefaultLabor } from '@/lib/payroll/timesheet-labor-base-cost';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { canSeeHrPillarUi } from '@/lib/permissions';
import { getEffectiveAccessLevel, isPayrollOfficer, isSystemAdmin } from '@/lib/permission-core';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';

export default function HRDashboardPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.hash === '#hr-action-queue') {
      requestAnimationFrame(() => {
        document.getElementById('hr-action-queue')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, []);

  const isHRAuthorized = useMemo(() => {
    return isSystemAdmin(currentUser) || canSeeHrPillarUi(currentUser, null);
  }, [currentUser]);

  const viewerOnly = useMemo(() => {
    if (!currentUser || isSystemAdmin(currentUser)) return false;
    if (isPayrollOfficer(currentUser)) return false;
    const level = getEffectiveAccessLevel(currentUser);
    return level === 'officer' || level === 'viewer';
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

    // ต้นทุน/ค่าแรง: ฐานจากทะเบียน (ตำแหน่ง + กำหนดรายคน) — ดูสถิติ «ตำแหน่งยังไม่กำหนดฐาน» ด้านบน ไม่อ้าง Labor Cost Term

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
  }, [payrollRuns, pendingExceptions, correctionTs, workers]);

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

  /** ตำแหน่งหน้างาน (ไม่รวม office) ที่ยังไม่มีฐานต้นทุน OPEC ใน /positions */
  const positionsMissingDefaultLabor = useMemo(() => {
    return (positions || []).filter((p) => isFieldPositionMissingDefaultLabor(p));
  }, [positions]);

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
            {viewerOnly && (
              <Badge variant="secondary" className="text-[10px] font-bold uppercase tracking-wide">
                ดูอย่างเดียว
              </Badge>
            )}
          </h1>
          <p className="text-muted-foreground text-lg italic">
            ติดตามความพร้อมของลูกจ้าง งานรออนุมัติ และคำขอแก้ไขข้อมูลหลังปิดงวด (Worker compliance & HR action queues).
          </p>
        </div>

        {viewerOnly && (
          <Alert className="border-amber-200 bg-amber-50/80 text-amber-950">
            <Info className="h-4 w-4 text-amber-700" />
            <AlertTitle>โหมดติดตาม (อ่านอย่างเดียว)</AlertTitle>
            <AlertDescription>
              บทบาทเจ้าหน้าที่ (officer / viewer) ดูภาพรวมและคิวงานได้เท่านั้น — การอนุมัติและแก้ไขทำจากเมนูงานที่ได้รับสิทธิ์
            </AlertDescription>
          </Alert>
        )}

        {!viewerOnly ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="border-l-4 border-l-indigo-600 shadow-md">
              <CardHeader className="pb-2">
                <PayrollScopeTag scope="office" />
                <CardTitle className="text-base flex items-center gap-2 mt-3">
                  <Building2 className="h-5 w-5 text-indigo-600 shrink-0" /> เส้นทาง: พนักงานออฟฟิศ
                </CardTitle>
                <CardDescription>
                  ฐานเงินเดือนรายเดือนอยู่ที่ <strong>ทะเบียนพนักงาน</strong> — <strong>ไม่ใช้</strong> timesheet รายวัน — จ่ายผ่าน{' '}
                  <strong>Office payroll run</strong>
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2 pt-0">
                <Button variant="outline" size="sm" asChild className="font-semibold border-indigo-200">
                  <Link href="/office-staff">ทะเบียนพนักงานออฟฟิศ</Link>
                </Button>
                <Button variant="outline" size="sm" asChild className="font-semibold border-indigo-200">
                  <Link href="/office-payroll">งวดจ่ายเงินเดือนออฟฟิศ</Link>
                </Button>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-amber-600 shadow-md">
              <CardHeader className="pb-2">
                <PayrollScopeTag scope="worker" />
                <CardTitle className="text-base flex items-center gap-2 mt-3">
                  <HardHat className="h-5 w-5 text-amber-600 shrink-0" /> เส้นทาง: ลูกจ้างหน้างาน
                </CardTitle>
                <CardDescription>
                  ค่าแรงคำนวณจาก <strong>ทะเบียนลูกจ้าง + ตำแหน่ง</strong> (หรือกำหนดรายคน) แล้วจึง{' '}
                  <strong>Timesheet</strong> รายวันตาม wave → <strong>period</strong> → <strong>Payroll batch</strong>
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2 pt-0">
                <Button variant="outline" size="sm" asChild className="font-semibold border-amber-200">
                  <Link href="/workers">ทะเบียนลูกจ้าง</Link>
                </Button>
                <Button variant="outline" size="sm" asChild className="font-semibold border-amber-200">
                  <Link href="/timesheets/wave-board">คีย์ลงเวลา (Wave)</Link>
                </Button>
                <Button variant="outline" size="sm" asChild className="font-semibold border-amber-200">
                  <Link href="/timesheets/wave-month">สรุปลงเวลารายเดือน (Wave)</Link>
                </Button>
                <Button variant="outline" size="sm" asChild className="font-semibold border-amber-200">
                  <Link href="/payroll/batches">งวดจ่ายลูกจ้าง (Batches)</Link>
                </Button>
              </CardContent>
            </Card>
            <div className="lg:col-span-2">
              <Card className="border-muted">
                <CardHeader className="py-3 pb-2">
                  <PayrollScopeTag scope="both" showHint={false} />
                  <CardTitle className="text-sm flex items-center gap-2 mt-2">
                    <Settings className="h-4 w-4" /> ตั้งค่าและข้อมูลประกอบ
                  </CardTitle>
                  <CardDescription className="text-xs">ตำแหน่งงานและเอกสารกลาง — ใช้ประกอบงานลูกจ้าง/โครงการ</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2 pt-0 pb-4">
                  <Button size="sm" variant="secondary" asChild className="font-semibold gap-1">
                    <Link href="/hr/settings">
                      <Settings className="h-3.5 w-3.5" /> ตั้งค่า HR
                    </Link>
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <Link href="/positions">ตำแหน่งงาน</Link>
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <Link href="/worker-document-catalog">เอกสารกลาง</Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-primary">สรุปสถานะลูกจ้าง</h2>
            <p className="text-sm text-muted-foreground">
              ตัวเลขและคิวด้านล่างเป็นขอบเขต <strong>ลูกจ้างหน้างาน</strong> เท่านั้น — ไม่รวมพนักงานออฟฟิศ
            </p>
          </div>
          <PayrollScopeTag scope="worker" showHint={false} className="shrink-0" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard title="ลูกจ้างทั้งหมด" value={stats.total} sub="Total Workers" icon={Users} colorClass="border-l-blue-600" />
          <StatCard title="พร้อมใช้งาน" value={stats.ready} sub="Ready Workers" icon={CheckCircle2} colorClass="border-l-green-600" />
          <StatCard title="ขาดใบรับรอง" value={stats.missingCert} sub="Missing Certs" icon={AlertTriangle} colorClass="border-l-orange-500" />
          <StatCard title="ตรวจสุขภาพหมดอายุ" value={stats.medExpired} sub="Expired Medical" icon={Stethoscope} colorClass="border-l-red-600" />
          <StatCard title="เอกสารหมดอายุ" value={stats.docExpired} sub="Expired Documents" icon={FileText} colorClass="border-l-rose-600" />
          <StatCard title="ใกล้หมดอายุ" value={stats.expiringSoon} sub="Expiry Warnings" icon={AlertTriangle} colorClass="border-l-orange-500" />
          <StatCard title="บล็อก Assign" value={stats.blocked} sub="Blocked By Policy" icon={ShieldAlert} colorClass="border-l-red-600" />
          <StatCard title="งานค้าง HR" value={pendingHRTasks.length} sub="Pending Tasks" icon={Clock} colorClass="border-l-purple-600" />
          <StatCard title="คำขอแก้ไข" value={(pendingExceptions?.length || 0) + (correctionTs?.length || 0)} sub="Correction Queue" icon={RotateCcw} colorClass="border-l-amber-500" />
          <StatCard
            title="ตำแหน่งยังไม่กำหนดฐาน"
            value={positionsMissingDefaultLabor.length}
            sub="OPEC ต้นทุน/วัน ที่ /positions"
            icon={AlertTriangle}
            colorClass="border-l-rose-600"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Action Queue Section */}
          <div className="lg:col-span-2 space-y-6">
            <Card id="hr-action-queue" className="scroll-mt-24 shadow-md border-none overflow-hidden">
              <CardHeader className="bg-primary/5 border-b pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Clock className="h-5 w-5 text-primary" />{' '}
                      {viewerOnly ? 'งานที่ต้องติดตาม (ภาพรวม)' : 'งานที่ต้องดำเนินการ (HR Action Queue)'}
                    </CardTitle>
                    <CardDescription>
                      {viewerOnly
                        ? 'รายการสำหรับติดตามสถานะเท่านั้น — ไม่สามารถเปิดไปดำเนินการแทน HR ได้'
                        : 'รายการด่วนที่ต้องการการตรวจสอบหรืออนุมัติจากฝ่ายบุคคล'}
                    </CardDescription>
                  </div>
                  <Badge variant="secondary" className="font-bold">{pendingHRTasks.length} รายการ</Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {pendingHRTasks.length > 0 ? (
                  <div className="divide-y">
                    {pendingHRTasks.map(task =>
                      viewerOnly ? (
                        <div key={task.id} className="block cursor-default opacity-95">
                          <div className="p-4 flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <div className={`p-2 rounded-lg ${task.priority === 'high' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
                                <task.icon className="h-5 w-5" />
                              </div>
                              <div className="space-y-0.5">
                                <p className="font-bold text-primary">{task.label}</p>
                                <div className="flex items-center gap-2 text-[10px] uppercase font-black tracking-widest text-muted-foreground">
                                  <span>{task.type}</span>
                                  {task.sub && <span>• {task.sub}</span>}
                                  <span>•</span>
                                  <span className={task.priority === 'high' ? 'text-red-500' : ''}>{task.status}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
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
                      )
                    )}
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
                  <AlertTriangle className="h-3 w-3" /> ฐานต้นทุนแรง (Positions)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {positionsMissingDefaultLabor.length === 0 ? (
                  <p className="text-[10px] text-rose-700">
                    ทุกตำแหน่งหน้างาน active ระบุฐาน OPEC/วันครบแล้ว หรือยังไม่ต้องใช้ (ดูรายละเอียดที่{' '}
                    <Link href="/positions" className="font-medium underline">
                      ตำแหน่งงาน
                    </Link>
                    )
                  </p>
                ) : (
                  positionsMissingDefaultLabor.slice(0, 6).map((p) =>
                    viewerOnly ? (
                      <p key={p.id} className="text-[10px] text-rose-700">
                        {p.positionCode || p.id}: ยังไม่มีฐานต้นทุน OPEC (onshore/offshore) — กำหนดที่รายละเอียดตำแหน่ง
                      </p>
                    ) : (
                      <Link
                        key={p.id}
                        href={`/positions/${p.id}`}
                        className="block text-[10px] text-rose-700 hover:underline"
                      >
                        {p.positionCode || p.id}: ยังไม่มีฐานต้นทุน OPEC (onshore/offshore) — กำหนดที่รายละเอียดตำแหน่ง
                      </Link>
                    ),
                  )
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
