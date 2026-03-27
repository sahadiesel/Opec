'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { 
  Building2, 
  FileText, 
  ShoppingCart, 
  UserCheck, 
  AlertTriangle, 
  Clock, 
  TrendingUp, 
  ArrowRight, 
  ChevronRight, 
  UserPlus, 
  ShieldAlert, 
  Info,
  Calendar,
  Search,
  BadgeCheck,
  FileSignature
} from 'lucide-react';
import { 
  User, 
  Customer, 
  MainContract, 
  PurchaseOrder, 
  Assignment,
  Worker,
  Quotation
} from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where, limit, orderBy } from 'firebase/firestore';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { canSeeSalesPillarUi } from '@/lib/permissions';
import { getEffectiveAccessLevel, isSystemAdmin } from '@/lib/permission-core';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function SalesDashboardPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const isSalesAuthorized = useMemo(() => {
    return isSystemAdmin(currentUser) || canSeeSalesPillarUi(currentUser, null);
  }, [currentUser]);

  const viewerOnly = useMemo(() => {
    if (!currentUser || isSystemAdmin(currentUser)) return false;
    const level = getEffectiveAccessLevel(currentUser);
    return level === 'officer' || level === 'viewer';
  }, [currentUser]);

  // --- Sales Data Queries ---
  
  const customersQuery = useMemoFirebase(() => {
    if (!firestore || !isSalesAuthorized) return null;
    return collection(firestore, 'customers');
  }, [firestore, isSalesAuthorized]);
  const { data: customers } = useCollection<Customer>(customersQuery as any);

  const quoQuery = useMemoFirebase(() => {
    if (!firestore || !isSalesAuthorized) return null;
    // Query active quotations (draft or sent)
    return query(collection(firestore, 'quotations'), where('status', 'in', ['draft', 'sent']), limit(10));
  }, [firestore, isSalesAuthorized]);
  const { data: activeQuotations } = useCollection<Quotation>(quoQuery as any);

  const contractsQuery = useMemoFirebase(() => {
    if (!firestore || !isSalesAuthorized) return null;
    return query(collection(firestore, 'main_contracts'), where('status', '==', 'active'));
  }, [firestore, isSalesAuthorized]);
  const { data: activeContracts } = useCollection<MainContract>(contractsQuery as any);

  const posQuery = useMemoFirebase(() => {
    if (!firestore || !isSalesAuthorized) return null;
    return query(collection(firestore, 'purchase_orders'), where('status', '==', 'active'));
  }, [firestore, isSalesAuthorized]);
  const { data: activePOs } = useCollection<PurchaseOrder>(posQuery as any);

  const pendingApprovalsQuery = useMemoFirebase(() => {
    if (!firestore || !isSalesAuthorized) return null;
    return query(
      collection(firestore, 'mobilizations'), 
      where('clientApprovalStatus', 'in', ['PENDING', 'REJECTED']),
      limit(20)
    );
  }, [firestore, isSalesAuthorized]);
  const { data: pendingApprovals, isLoading: isApprovalsLoading } = useCollection<Assignment>(pendingApprovalsQuery as any);

  const workersQuery = useMemoFirebase(() => {
    if (!firestore || !isSalesAuthorized) return null;
    return collection(firestore, 'workers');
  }, [firestore, isSalesAuthorized]);
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  // --- Computed Sales Stats ---

  const stats = useMemo(() => {
    const now = Date.now();
    const sixtyDaysFromNow = now + (60 * 24 * 60 * 60 * 1000);

    return {
      totalCustomers: customers?.length || 0,
      activeQuos: activeQuotations?.length || 0,
      activeContracts: activeContracts?.length || 0,
      activePOs: activePOs?.length || 0,
      expiringSoon: activeContracts?.filter(c => c.endDate < sixtyDaysFromNow).length || 0,
      pendingClientReview: pendingApprovals?.filter(a => a.clientApprovalStatus === 'PENDING').length || 0,
      rejectedByClient: pendingApprovals?.filter(a => a.clientApprovalStatus === 'REJECTED').length || 0,
    };
  }, [customers, activeQuotations, activeContracts, activePOs, pendingApprovals]);

  const urgentActions = useMemo(() => {
    const actions: Array<{
      id: string;
      type: string;
      label: string;
      sub: string;
      status: string;
      link: string;
      priority: 'high' | 'medium' | 'low';
    }> = [];
    
    // Rejected candidates need replacement
    pendingApprovals?.forEach(asgn => {
      if (asgn.clientApprovalStatus === 'REJECTED') {
        const worker = allWorkers?.find(w => w.id === asgn.workerId);
        actions.push({
          id: asgn.id,
          type: 'Replacement Needed',
          label: `Client rejected: ${worker?.firstName || 'Candidate'}`,
          sub: asgn.projectName,
          status: 'REJECTED',
          link: `/mobilization/${asgn.id}`,
          priority: 'high'
        });
      }
    });

    // Expiring Contracts
    activeContracts?.forEach(c => {
      const daysLeft = Math.round((c.endDate - Date.now()) / (24 * 60 * 60 * 1000));
      if (daysLeft < 60) {
        actions.push({
          id: c.id,
          type: 'Contract Renewal',
          label: `Expires in ${daysLeft} days: ${c.contractNumber}`,
          sub: c.title,
          status: 'EXPIRING',
          link: `/main-contracts/${c.id}`,
          priority: daysLeft < 15 ? 'high' : 'medium'
        });
      }
    });

    return actions;
  }, [pendingApprovals, activeContracts, allWorkers]);

  if (isUserLoading || !currentUser) return null;

  if (!isSalesAuthorized) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <ShieldAlert className="h-12 w-12 text-destructive opacity-50" />
          <h2 className="text-xl font-bold">Access Denied</h2>
          <p className="text-muted-foreground">This dashboard is reserved for Sales and Commercial personnel.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-8 max-w-[1600px] mx-auto">
        {/* Header */}
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3 flex-wrap">
            <TrendingUp className="h-8 w-8" /> แดชบอร์ดฝ่ายขาย (Sales Dashboard)
            {viewerOnly && (
              <Badge variant="secondary" className="text-[10px] font-bold uppercase tracking-wide">
                ดูอย่างเดียว
              </Badge>
            )}
          </h1>
          <p className="text-muted-foreground text-lg italic">
            ติดตามลูกค้า สัญญา PO งานรออนุมัติจากลูกค้า และงานเชิงพาณิชย์ที่ต้องติดตาม (Monitor customers, contracts, POs, and commercial actions).
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

        {/* Top KPI Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <StatCard title="ลูกค้าทั้งหมด" value={stats.totalCustomers} sub="Total Customers" icon={Building2} colorClass="border-l-blue-600" />
          <StatCard title="เสนอราคาค้าง" value={stats.activeQuos} sub="Active Quotations" icon={FileSignature} colorClass="border-l-amber-500" />
          <StatCard title="สัญญาที่ใช้งาน" value={stats.activeContracts} sub="Active Contracts" icon={FileText} colorClass="border-l-green-600" />
          <StatCard title="PO ที่ใช้งานอยู่" value={stats.activePOs} sub="Active POs" icon={ShoppingCart} colorClass="border-l-purple-600" />
          <StatCard title="สัญญาใกล้หมด" value={stats.expiringSoon} sub="Expiring Soon" icon={Clock} colorClass={stats.expiringSoon > 0 ? "border-l-red-600 text-red-600" : "border-l-slate-200"} />
          <StatCard title="รอลูกค้าอนุมัติ" value={stats.pendingClientReview} sub="Pending Approval" icon={UserCheck} colorClass="border-l-indigo-500" />
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
                      {viewerOnly ? 'งานที่ต้องติดตาม (ภาพรวม)' : 'งานที่ต้องดำเนินการ (Sales Action Queue)'}
                    </CardTitle>
                    <CardDescription>
                      {viewerOnly
                        ? 'รายการสำหรับติดตามสถานะเท่านั้น — ไม่สามารถเปิดไปดำเนินการแทนฝ่ายขายได้'
                        : 'รายการงานด่วนที่ต้องการการติดตามจากฝ่ายขาย'}
                    </CardDescription>
                  </div>
                  <Badge variant="secondary" className="font-bold">{urgentActions.length} รายการ</Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {urgentActions.length > 0 ? (
                  <div className="divide-y">
                    {urgentActions.map(action =>
                      viewerOnly ? (
                        <div key={action.id} className="block cursor-default">
                          <div className="p-4 flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <div className={`p-2 rounded-lg ${action.priority === 'high' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
                                {action.type.includes('Contract') ? <FileText className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />}
                              </div>
                              <div className="space-y-0.5">
                                <p className="font-bold text-primary">{action.label}</p>
                                <div className="flex items-center gap-2 text-[10px] uppercase font-black tracking-widest text-muted-foreground">
                                  <span>{action.type}</span>
                                  <span>•</span>
                                  <span>{action.sub}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <Link key={action.id} href={action.link} className="block hover:bg-slate-50 transition-colors group">
                          <div className="p-4 flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <div className={`p-2 rounded-lg ${action.priority === 'high' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
                                {action.type.includes('Contract') ? <FileText className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />}
                              </div>
                              <div className="space-y-0.5">
                                <p className="font-bold text-primary group-hover:text-blue-600 transition-colors">{action.label}</p>
                                <div className="flex items-center gap-2 text-[10px] uppercase font-black tracking-widest text-muted-foreground">
                                  <span>{action.type}</span>
                                  <span>•</span>
                                  <span>{action.sub}</span>
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
                    <BadgeCheck className="h-12 w-12 mx-auto text-green-500/20" />
                    <p className="text-muted-foreground italic">ไม่มีงานเชิงพาณิชย์ค้างที่ต้องดำเนินการในขณะนี้</p>
                  </div>
                )}
              </CardContent>
              {!viewerOnly && (
                <CardFooter className="bg-muted/30 p-3 flex justify-center border-t">
                  <Button variant="link" className="text-xs text-muted-foreground" asChild>
                    <Link href="/purchase-orders">ดูใบสั่งซื้อทั้งหมด <ArrowRight className="h-3 w-3 ml-1" /></Link>
                  </Button>
                </CardFooter>
              )}
            </Card>

            <Card className="shadow-md border-none overflow-hidden">
              <CardHeader className="bg-primary/5 border-b pb-4">
                <CardTitle className="text-lg flex items-center gap-2">
                  <UserCheck className="h-5 w-5 text-amber-600" /> สถานะการพิจารณาตัวบุคคล (Client Review Pipeline)
                </CardTitle>
                <CardDescription>รายชื่อพนักงานที่ส่งให้ลูกค้าพิจารณาเพื่ออนุมัติเข้าโครงการ</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {pendingApprovals?.map(asgn => {
                    const worker = allWorkers?.find(w => w.id === asgn.workerId);
                    return (
                      <div key={asgn.id} className="p-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center font-bold text-primary">
                            {worker?.firstName.charAt(0) || '?'}
                          </div>
                          <div className="space-y-0.5">
                            <p className="text-sm font-bold text-primary">{worker?.firstName} {worker?.lastName}</p>
                            <p className="text-[10px] text-muted-foreground uppercase">{asgn.projectName} | {asgn.positionId}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <Badge variant={asgn.clientApprovalStatus === 'REJECTED' ? 'destructive' : 'outline'} className="text-[9px] font-bold">
                            {asgn.clientApprovalStatus}
                          </Badge>
                          {!viewerOnly && (
                            <Button variant="ghost" size="icon" asChild>
                              <Link href={`/mobilization/${asgn.id}`}><ChevronRight className="h-4 w-4" /></Link>
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {!pendingApprovals?.length && (
                    <div className="py-10 text-center text-muted-foreground italic text-sm">No pending client reviews.</div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar Section */}
          <div className="space-y-6">
            {!viewerOnly && (
              <Card className="shadow-md border-none">
                <CardHeader className="pb-3 border-b">
                  <CardTitle className="text-sm font-bold flex items-center gap-2 text-primary">
                    <TrendingUp className="h-4 w-4" /> ทางลัดงานฝ่ายขาย (Sales Shortcuts)
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4 space-y-2">
                  <ShortcutItem href="/customers" label="ทะเบียนลูกค้า" sub="Customer Directory" icon={Building2} />
                  <ShortcutItem href="/quotations" label="ใบเสนอราคา" sub="Quotations" icon={FileSignature} />
                  <ShortcutItem href="/main-contracts" label="สัญญาหลัก" sub="MSAs & Rates" icon={FileText} />
                  <ShortcutItem href="/purchase-orders" label="ใบสั่งซื้อลูกค้า" sub="Project POs" icon={ShoppingCart} />
                  <ShortcutItem href="/billing-notes" label="ใบวางบิล" sub="Billing Notes" icon={FileText} />
                  <ShortcutItem href="/client-portal" label="Client Portal Preview" sub="Monitoring View" icon={UserCheck} />
                </CardContent>
              </Card>
            )}

            <Card className="bg-blue-50 border-blue-100 shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold uppercase text-blue-800 flex items-center gap-2">
                  <Info className="h-3 w-3" /> Sales Policy reminder
                </CardTitle>
              </CardHeader>
              <CardContent className="text-[10px] text-blue-700 leading-relaxed">
                การแก้ไขราคาขาย (Sell Rate) ในสัญญาหลักจะมีผลเฉพาะ PO ใหม่เท่านั้น หากต้องการปรับราคาใน PO เดิม ต้องทำการ Snapshot ราคาใหม่ในระดับ PO Line
              </CardContent>
            </Card>

            <Card className="bg-amber-50 border-amber-100 shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold uppercase text-amber-800 flex items-center gap-2">
                  <AlertTriangle className="h-3 w-3" /> Quota Warning
                </CardTitle>
              </CardHeader>
              <CardContent className="text-[10px] text-amber-700 leading-relaxed">
                ตรวจสอบ PO Lines ที่จำนวนพนักงานครบถ้วนแล้ว (Full Quota) เพื่อประสานงานขอเปิดใบสั่งซื้อเพิ่มเติมหากลูกค้าต้องการกำลังคนเพิ่ม
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
