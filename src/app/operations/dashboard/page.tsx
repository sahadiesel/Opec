'use client';

import { useMemo } from 'react';
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
  RotateCcw,
  Coins,
  PackageSearch,
} from 'lucide-react';
import { 
  Assignment, 
  Wave, 
  Worker,
  ExceptionRequest,
  PayrollBatch,
  OfficePayrollRun,
  Purchase,
} from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where, limit } from 'firebase/firestore';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Separator } from '@/components/ui/separator';
import { canApprovePurchaseAsManager, canSeeOperationsPillarUi } from '@/lib/permissions';
import { getEffectiveAccessLevel, isSystemAdmin } from '@/lib/permission-core';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useAppUser } from '@/hooks/use-app-user';

export default function OperationsDashboardPage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();

  const isOperationsAuthorized = useMemo(() => {
    return isSystemAdmin(currentUser) || canSeeOperationsPillarUi(currentUser, null);
  }, [currentUser]);

  const viewerOnly = useMemo(() => {
    if (!currentUser || isSystemAdmin(currentUser)) return false;
    const level = getEffectiveAccessLevel(currentUser);
    return level === 'officer' || level === 'viewer';
  }, [currentUser]);

  /** ผู้จัดการปฏิบัติการ / หัวหน้าเสา operations (อนุมัติใบสั่งซื้อ + payroll ตาม matrix) */
  const showManagerApprovalQueue = useMemo(
    () => Boolean(currentUser && canApprovePurchaseAsManager(currentUser)),
    [currentUser]
  );

  // --- Operations Data Queries ---
  
  const mobQuery = useMemoFirebase(() => {
    if (!firestore || !isOperationsAuthorized) return null;
    return collection(firestore, 'mobilizations');
  }, [firestore, isOperationsAuthorized]);
  const { data: assignments, isLoading: isAsgnLoading } = useCollection<Assignment>(mobQuery as any);

  const wavesQuery = useMemoFirebase(() => {
    if (!firestore || !isOperationsAuthorized) return null;
    return collection(firestore, 'waves');
  }, [firestore, isOperationsAuthorized]);
  const { data: waves } = useCollection<Wave>(wavesQuery as any);

  const exceptionQuery = useMemoFirebase(() => {
    if (!firestore || !isOperationsAuthorized) return null;
    return query(
      collection(firestore, 'exception_requests'), 
      where('requestType', '==', 'ASSIGNMENT_CHANGE'),
      where('status', '==', 'PENDING'),
      limit(10)
    );
  }, [firestore, isOperationsAuthorized]);
  const { data: pendingExceptions } = useCollection<ExceptionRequest>(exceptionQuery as any);

  const workersQuery = useMemoFirebase(() => {
    if (!firestore || !isOperationsAuthorized) return null;
    return collection(firestore, 'workers');
  }, [firestore, isOperationsAuthorized]);
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  const pendingPurchasesQuery = useMemoFirebase(() => {
    if (!firestore || !isOperationsAuthorized || viewerOnly || !showManagerApprovalQueue) return null;
    return query(
      collection(firestore, 'purchases'),
      where('status', 'in', ['PENDING_APPROVAL', 'RETURNED_FOR_REVISION']),
      limit(30)
    );
  }, [firestore, isOperationsAuthorized, viewerOnly, showManagerApprovalQueue]);
  const { data: pendingPurchases } = useCollection<Purchase>(pendingPurchasesQuery as any);

  const pendingPayrollBatchesQuery = useMemoFirebase(() => {
    if (!firestore || !isOperationsAuthorized || viewerOnly || !showManagerApprovalQueue) return null;
    return query(
      collection(firestore, 'payroll_batches'),
      where('status', 'in', ['GENERATED', 'HR_REVIEWED']),
      limit(30)
    );
  }, [firestore, isOperationsAuthorized, viewerOnly, showManagerApprovalQueue]);
  const { data: pendingPayrollBatches } = useCollection<PayrollBatch>(pendingPayrollBatchesQuery as any);

  const pendingOfficePayrollQuery = useMemoFirebase(() => {
    if (!firestore || !isOperationsAuthorized || viewerOnly || !showManagerApprovalQueue) return null;
    return query(collection(firestore, 'office_payroll_runs'), where('status', '==', 'CALCULATED'), limit(30));
  }, [firestore, isOperationsAuthorized, viewerOnly, showManagerApprovalQueue]);
  const { data: pendingOfficePayrollRuns } = useCollection<OfficePayrollRun>(pendingOfficePayrollQuery as any);

  // --- Computed Operations Stats ---

  const urgentTasks = useMemo(() => {
    const tasks: any[] = [];

    // 0. Manager approval: purchases (คลังส่งขออนุมัติ)
    if (showManagerApprovalQueue && !viewerOnly) {
      const purchaseList = [...(pendingPurchases || [])].sort(
        (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
      );
      purchaseList.slice(0, 15).forEach((p) => {
        tasks.push({
          id: `purchase-${p.id}`,
          type: 'อนุมัติใบสั่งซื้อ/จ้าง',
          label: `${p.purchaseNo || p.id} · ฿${Number(p.totalAmount || 0).toLocaleString('th-TH')}`,
          status: p.status === 'RETURNED_FOR_REVISION' ? 'ส่งแก้แล้ว' : 'รออนุมัติ',
          link: `/purchases/${p.id}`,
          priority: 'high',
          icon: PackageSearch,
        });
      });

      const officeRuns = [...(pendingOfficePayrollRuns || [])].sort((a, b) =>
        (b.payrollMonth || '').localeCompare(a.payrollMonth || '')
      );
      officeRuns.slice(0, 10).forEach((r) => {
        tasks.push({
          id: `office-payroll-${r.id}`,
          type: 'อนุมัติเงินเดือนพนักงาน',
          label: `${r.payrollRunNo || r.id} · งวด ${r.payrollMonth || '—'}`,
          status: 'CALCULATED',
          link: `/office-payroll/${r.id}`,
          priority: 'high',
          icon: Coins,
        });
      });

      const batches = [...(pendingPayrollBatches || [])].sort(
        (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
      );
      batches.slice(0, 10).forEach((b) => {
        tasks.push({
          id: `worker-payroll-${b.id}`,
          type: 'อนุมัติจ่ายคนงาน',
          label: `Batch · ${b.totalWorkers ?? 0} คน · สุทธิ ฿${Number(b.netAmount || 0).toLocaleString('th-TH')}`,
          status: b.status,
          link: `/payroll/batches/${b.id}`,
          priority: 'high',
          icon: Coins,
        });
      });
    }

    // 1. Exception Requests (Assignment Changes)
    pendingExceptions?.forEach(req => {
      tasks.push({
        id: req.id,
        type: 'Personnel Change',
        label: `Client request: ${req.referenceNo}`,
        status: 'PENDING',
        link: `/assignments/${req.referenceId}`,
        priority: 'high',
        icon: RotateCcw
      });
    });

    // 2. Incomplete Readiness for upcoming mobs
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

    // 3. Workers near expiry (warning) / blocked for assignment
    (allWorkers || []).filter(w => w.complianceAlertLevel === 'warning' || w.readinessStatus === 'BLOCKED').slice(0, 8).forEach((w) => {
      tasks.push({
        id: `worker-policy-${w.id}`,
        type: w.readinessStatus === 'BLOCKED' ? 'Blocked Assign' : 'Expiry Warning',
        label: `${w.firstName} ${w.lastName}`,
        status: w.readinessStatus === 'BLOCKED' ? 'BLOCKED' : `เหลือ ${w.nearestExpiryInDays ?? '-'} วัน`,
        link: `/workers/${w.id}`,
        priority: w.readinessStatus === 'BLOCKED' ? 'high' : 'medium',
        icon: AlertTriangle,
      });
    });

    return tasks;
  }, [
    assignments,
    pendingExceptions,
    allWorkers,
    showManagerApprovalQueue,
    viewerOnly,
    pendingPurchases,
    pendingOfficePayrollRuns,
    pendingPayrollBatches,
  ]);

  const stats = useMemo(() => {
    if (!assignments || !waves) return { activeAsgn: 0, activeWaves: 0, pendingMob: 0, changeReqs: 0, expiringSoon: 0, blocked: 0 };
    return {
      activeAsgn: assignments.filter(a => a.deploymentStatus === 'ACTIVE').length,
      activeWaves: waves.filter(w => w.status === 'ACTIVE').length,
      pendingMob: assignments.filter(a => ['READY_TO_MOB', 'MOBILIZING'].includes(a.deploymentStatus)).length,
      changeReqs: pendingExceptions?.length || 0,
      expiringSoon: (allWorkers || []).filter(w => w.readinessStatus === 'READY' && w.complianceAlertLevel === 'warning').length,
      blocked: (allWorkers || []).filter(w => w.readinessStatus === 'BLOCKED').length,
    };
  }, [assignments, waves, pendingExceptions, allWorkers]);

  if (userLoading || !currentUser) return null;

  if (!isOperationsAuthorized) {
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
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3 flex-wrap">
            <HardHat className="h-8 w-8" /> แดชบอร์ดฝ่ายปฏิบัติการ (Operations Dashboard)
            {viewerOnly && (
              <Badge variant="secondary" className="text-[10px] font-bold uppercase tracking-wide">
                ดูอย่างเดียว
              </Badge>
            )}
          </h1>
          <p className="text-muted-foreground text-lg italic">
            ติดตามสถานะกำลังพล เวฟงาน และคำขอเปลี่ยนแปลงจากลูกค้า (Manpower & Site operational oversight).
          </p>
        </div>

        {viewerOnly && (
          <Alert className="border-amber-200 bg-amber-50/80 text-amber-950">
            <Info className="h-4 w-4 text-amber-700" />
            <AlertTitle>โหมดติดตาม (อ่านอย่างเดียว)</AlertTitle>
            <AlertDescription>
              บทบาทเจ้าหน้าที่ (officer / viewer) ดูภาพรวมได้เท่านั้น — แก้ไขและอนุมัติจากเมนูที่ได้รับสิทธิ์
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
          <StatCard title="กำลังปฏิบัติงาน" value={stats.activeAsgn} sub="Active Assignments" icon={Users} colorClass="border-l-blue-600" />
          <StatCard title="เวฟที่ดำเนินการอยู่" value={stats.activeWaves} sub="Current Active Waves" icon={Waves} colorClass="border-l-green-600" />
          <StatCard title="กำลังส่งตัว" value={stats.pendingMob} sub="In-Transit / Dispatch" icon={Truck} colorClass="border-l-purple-600" />
          <StatCard title="คำขอเปลี่ยนตัว" value={stats.changeReqs} sub="Change Request Queue" icon={RotateCcw} colorClass="border-l-amber-500" />
          <StatCard title="เอกสารใกล้หมดอายุ" value={stats.expiringSoon} sub="Warning (Orange)" icon={AlertTriangle} colorClass="border-l-orange-500" />
          <StatCard title="ห้าม Assign" value={stats.blocked} sub="Blocked (Red)" icon={ShieldAlert} colorClass="border-l-red-600" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Work Queue Section */}
          <div className="lg:col-span-2 space-y-6">
            <Card className="shadow-md border-none overflow-hidden">
              <CardHeader className="bg-primary/5 border-b pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Clock className="h-5 w-5 text-primary" />{' '}
                      {viewerOnly ? 'งานที่ต้องติดตาม (ภาพรวม)' : 'งานที่ต้องดำเนินการ (Operations Action Queue)'}
                    </CardTitle>
                    <CardDescription>
                      {viewerOnly
                        ? 'รายการสำหรับติดตามสถานะเท่านั้น — ไม่สามารถเปิดไปดำเนินการแทนปฏิบัติการได้'
                        : 'งานอนุมัติ (เงินเดือน/ค่าจ้าง, ใบสั่งซื้อ) รวมถึงงานด่วนปฏิบัติการและคำขอเปลี่ยนแปลงจากลูกค้า'}
                    </CardDescription>
                  </div>
                  <Badge variant="secondary" className="font-bold">{urgentTasks.length} รายการ</Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {urgentTasks.length > 0 ? (
                  <div className="divide-y">
                    {urgentTasks.map(task =>
                      viewerOnly ? (
                        <div key={task.id} className="block cursor-default">
                          <div className="p-4 flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <div className={`p-2 rounded-lg ${task.priority === 'high' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
                                <task.icon className="h-5 w-5" />
                              </div>
                              <div className="space-y-0.5">
                                <p className="font-bold text-primary">{task.label}</p>
                                <div className="flex items-center gap-2 text-[10px] uppercase font-black tracking-widest text-muted-foreground">
                                  <span>{task.type}</span>
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
                    <p className="text-muted-foreground italic">ไม่มีงานปฏิบัติการค้างในขณะนี้</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="bg-blue-50 border-blue-100 shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold uppercase text-blue-800 flex items-center gap-2">
                  <Info className="h-3 w-3" /> Mob Prep Guidance
                </CardTitle>
              </CardHeader>
              <CardContent className="text-[10px] text-blue-700 leading-relaxed">
                ตรวจสอบความพร้อม (Readiness) ให้ครบ 100% ก่อนยืนยันการระดมพล เพื่อป้องกันความเสี่ยงในการถูกปฏิเสธหน้างานโดยลูกค้า
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
