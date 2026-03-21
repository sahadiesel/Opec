
'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { 
  Users, 
  Waves, 
  Clock, 
  ChevronRight, 
  LayoutDashboard,
  HardHat,
  MapPin,
  Calendar,
  Activity,
  ShoppingCart,
  AlertCircle,
  FileBarChart,
  ShieldCheck,
  Truck,
  Building2,
  FileText,
  Receipt,
  Wallet
} from 'lucide-react';
import { 
  User, 
  Wave, 
  Assignment, 
  DailyTimesheet, 
  Worker, 
  PurchaseOrder, 
  TaxInvoice
} from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where, limit, orderBy } from 'firebase/firestore';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { PageGuidance } from '@/components/layout/page-guidance';
import { CustomerQueryService } from '@/lib/services/customer-query-service';
import { differenceInDays, parseISO, startOfDay } from 'date-fns';
import { Separator } from '@/components/ui/separator';

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

  const tsQuery = useMemoFirebase(() => {
    const base = queryService?.getScopedTimesheetsQuery(currentUser);
    return base ? query(base as any, where('status', 'in', ['CLIENT_APPROVED', 'VERIFIED_PAPER', 'LOCKED']), limit(5)) : null;
  }, [queryService, currentUser]);
  const { data: recentTimesheets } = useCollection<DailyTimesheet>(tsQuery as any);

  const invQuery = useMemoFirebase(() => {
    if (!firestore || !currentUser?.customerId) return null;
    return query(collection(firestore, 'tax_invoices'), where('customerId', '==', currentUser.customerId), orderBy('issueDate', 'desc'), limit(5));
  }, [firestore, currentUser?.customerId]);
  const { data: recentInvoices } = useCollection<TaxInvoice>(invQuery as any);

  const posQuery = useMemoFirebase(() => queryService?.getScopedPOsQuery(currentUser), [queryService, currentUser]);
  const { data: pos } = useCollection<PurchaseOrder>(posQuery as any);

  const workersQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'workers') : null), [firestore]);
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  // --- Stats Calculation ---
  const stats = useMemo(() => {
    const activeHeadcount = assignments?.filter(a => a.deploymentStatus === 'ACTIVE').length || 0;
    const mobilising = assignments?.filter(a => ['READY_TO_MOB', 'MOBILIZING'].includes(a.deploymentStatus)).length || 0;
    
    return {
      activeHeadcount,
      mobilising,
      totalWaves: waves?.length || 0,
      activeWaves: waves?.filter(w => w.status === 'ACTIVE').length || 0,
      totalPOs: pos?.length || 0,
    };
  }, [assignments, waves, pos]);

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
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <LayoutDashboard className="h-8 w-8" /> แดชบอร์ดโครงการ (Project Transparency Dashboard)
          </h1>
          <p className="text-muted-foreground text-lg italic">
            ศูนย์รวมข้อมูลการดำเนินงาน เอกสาร และสถานะกำลังพลสำหรับ {currentUser.displayName}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="พนักงานหน้างาน" value={stats.activeHeadcount} sub="Active Personnel" icon={HardHat} colorClass="border-l-blue-600" />
          <StatCard title="กำลังส่งตัว" value={stats.mobilising} sub="In-Mob Pipeline" icon={Truck} colorClass="border-l-indigo-500" />
          <StatCard title="รอบงานปฏิบัติการ" value={stats.activeWaves} sub="Active Waves" icon={Waves} colorClass="border-l-green-600" />
          <StatCard title="ยอดสั่งซื้อรวม" value={stats.totalPOs} sub="Purchase Orders" icon={ShoppingCart} colorClass="border-l-amber-500" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <Card className="shadow-md border-none overflow-hidden">
              <CardHeader className="bg-primary/5 border-b flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2 text-primary">
                    <Activity className="h-5 w-5" /> ตารางการปฏิบัติงาน (Active Roster)
                  </CardTitle>
                  <CardDescription>ความคืบหน้าของรอบการทำงานพนักงานปัจจุบัน</CardDescription>
                </div>
                <Button variant="ghost" size="sm" className="text-xs" asChild>
                  <Link href="/client-portal/waves">ดูทั้งหมด <ChevronRight className="h-4 w-4" /></Link>
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="pl-6">พนักงาน (Worker)</TableHead>
                      <TableHead>โครงการ (Project)</TableHead>
                      <TableHead className="text-center">Worked</TableHead>
                      <TableHead className="text-right pr-6">Days left</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeWorkerStats.map(w => (
                      <TableRow key={w.id} className="hover:bg-muted/10">
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
                            <div className="w-20 h-1 bg-slate-100 rounded-full overflow-hidden">
                              <div className="h-full bg-blue-500" style={{ width: `${w.percent}%` }} />
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right pr-6 font-bold text-slate-600">{w.remaining} วัน</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="shadow-md border-none overflow-hidden">
                <CardHeader className="bg-primary/5 border-b flex flex-row items-center justify-between">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Wallet className="h-4 w-4 text-primary" /> เอกสารการเงินล่าสุด
                  </CardTitle>
                  <Button variant="ghost" size="sm" className="h-7 text-[10px] uppercase font-bold" asChild>
                    <Link href="/client-portal/billing">ดูทั้งหมด</Link>
                  </Button>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {recentInvoices?.map(inv => (
                      <div key={inv.id} className="p-3 flex items-center justify-between text-xs hover:bg-muted/10 transition-colors">
                        <div className="space-y-0.5">
                          <p className="font-bold text-primary font-mono">{inv.taxInvoiceNo}</p>
                          <p className="text-[10px] text-muted-foreground">{inv.issueDate}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-black text-primary">฿{inv.totalAmount.toLocaleString()}</p>
                          <Badge variant="outline" className="text-[8px] h-4 uppercase">{inv.status}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-md border-none overflow-hidden">
                <CardHeader className="bg-primary/5 border-b flex flex-row items-center justify-between">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Clock className="h-4 w-4 text-primary" /> บันทึกเวลาล่าสุด (Verified Logs)
                  </CardTitle>
                  <Button variant="ghost" size="sm" className="h-7 text-[10px] uppercase font-bold" asChild>
                    <Link href="/client-portal/timesheets">ดูทั้งหมด</Link>
                  </Button>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {recentTimesheets?.map(ts => (
                      <div key={ts.id} className="p-3 flex items-center justify-between text-xs hover:bg-muted/10 transition-colors">
                        <div className="space-y-0.5">
                          <p className="font-bold text-primary">{ts.workerNameSnapshot}</p>
                          <p className="text-[10px] text-muted-foreground">{ts.date} | {ts.sourceDocumentNo || 'N/A'}</p>
                        </div>
                        <Badge variant="secondary" className="text-[8px] font-bold h-4 uppercase">
                          {ts.status === 'VERIFIED_PAPER' ? 'VERIFIED' : ts.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="space-y-6">
            <Card className="bg-primary text-primary-foreground shadow-lg overflow-hidden border-none">
              <CardHeader className="pb-4 border-b border-white/10">
                <CardTitle className="text-sm font-black uppercase tracking-widest flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" /> แหล่งข้อมูล (Portal Access)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                <div className="space-y-2">
                  <ShortcutItem href="/client-portal/waves" label="รายชื่อกำลังพล" sub="Personnel Roster" icon={HardHat} />
                  <ShortcutItem href="/client-portal/timesheets" label="บันทึกเวลาและหลักฐาน" sub="Verified Evidence" icon={FileText} />
                  <ShortcutItem href="/client-portal/billing" label="ประวัติวางบิล/ชำระเงิน" sub="Billing & Invoices" icon={Receipt} />
                </div>
              </CardContent>
            </Card>

            <PageGuidance 
              title="แนะนำการตรวจสอบ"
              tips={[
                "ท่านสามารถตรวจสอบเลขที่ Slip จากตารางบันทึกเวลาเพื่อสอบทานกับสำเนาที่หน้างาน",
                "เอกสารการเงินประกอบด้วย ใบวางบิล (Notes), ใบกำกับภาษี (Invoices) และใบเสร็จ (Receipts)",
                "ใช้ระบบ 'Report' หากพบข้อมูลที่ไม่ตรงตามจริงเพื่อรับการตรวจสอบเร่งด่วน"
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

function ShortcutItem({ href, label, sub, icon: Icon }: any) {
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
      <ChevronRight className="h-4 w-4 opacity-40 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
    </Link>
  );
}
