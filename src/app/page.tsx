'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { User, MainContract, Worker, Assignment } from '@/lib/types';
import { 
  Briefcase, 
  ShieldCheck, 
  UserPlus, 
  ShoppingCart,
  Users,
  CircleDollarSign,
  Clock,
  TrendingUp,
  Activity,
  HardHat,
  ArrowRight,
  ShieldAlert,
  Info,
  Loader2
} from 'lucide-react';
import { useFirestore, useAuth, useUser, useCollection, useMemoFirebase } from '@/firebase';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, collection, collectionGroup } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isBootstrapped, setIsBootstrapped] = useState<boolean | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('password123');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const firestore = useFirestore();
  const auth = useAuth();
  const { user: firebaseUser, isUserLoading } = useUser();
  const { toast } = useToast();

  // Real Data Subscriptions
  const contractsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'main_contracts') : null), [firestore]);
  const { data: contracts } = useCollection<MainContract>(contractsQuery as any);

  const workersQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'workers') : null), [firestore]);
  const { data: workers } = useCollection<Worker>(workersQuery as any);

  const assignmentsQuery = useMemoFirebase(() => (firestore ? collectionGroup(firestore, 'assignments') : null), [firestore]);
  const { data: assignments } = useCollection<Assignment>(assignmentsQuery as any);

  useEffect(() => {
    setIsLoaded(true);
    const stored = localStorage.getItem('opsflow_user');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed.roleId && !parsed.roleIds) parsed.roleIds = [parsed.roleId];
        setUser(parsed);
      } catch (e) { console.error(e); }
    }

    async function checkBootstrap() {
      if (!firestore) return;
      try {
        const snap = await getDoc(doc(firestore, 'system', 'bootstrap'));
        setIsBootstrapped(snap.exists());
      } catch (e) { setIsBootstrapped(false); }
    }
    checkBootstrap();
  }, [firestore]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const userDoc = await getDoc(doc(firestore, 'users', cred.user.uid));
      if (userDoc.exists()) {
        const userData = userDoc.data() as any;
        if (!userData.roleIds) userData.roleIds = [userData.roleId];
        setUser(userData as User);
        localStorage.setItem('opsflow_user', JSON.stringify(userData));
        toast({ title: "เข้าสู่ระบบสำเร็จ (Access Granted)" });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Login Failed", description: "Invalid credentials" });
    } finally { setIsLoggingIn(false); }
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('opsflow_user');
  };

  // Stats Calculations
  const stats = useMemo(() => {
    const activeContracts = contracts?.filter(c => c.status === 'active').length || 0;
    const activeWorkers = workers?.filter(w => w.workerStatus === 'assigned').length || 0;
    const pendingItems = assignments?.filter(a => a.clientApprovalStatus === 'SUBMITTED').length || 0;
    
    // Revenue logic: sum of sellRateSnapshot for ACTIVE deployments
    const revenue = assignments?.reduce((sum, a) => {
      if (a.deploymentStatus === 'ACTIVE') {
        // Find sellRateSnapshot from PO Lines would be better, but for MVP we use the snapshot stored in assignment if any, 
        // or just count active billing units. Let's assume sellRateSnapshot exists in assignment document based on current code.
        return sum + (Number((a as any).sellRateSnapshot) || 0);
      }
      return sum;
    }, 0) || 0;

    const expiringCerts = workers?.filter(w => w.readinessStatus === 'MISSING_CERTIFICATE' || w.readinessStatus === 'MEDICAL_EXPIRED').length || 0;

    return {
      revenue: revenue.toLocaleString(),
      activeWorkers,
      activeContracts,
      pendingItems,
      expiringCerts
    };
  }, [contracts, workers, assignments]);

  if (!isLoaded || isUserLoading) return null;

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-primary/5 p-4 offshore-bg">
        <Card className="w-full max-w-md shadow-2xl border-t-8 border-t-primary">
          <CardHeader className="space-y-1 text-center">
            <div className="mx-auto bg-primary/10 p-4 rounded-full w-fit mb-4">
              <Activity className="h-10 w-10 text-primary" />
            </div>
            <CardTitle className="text-3xl font-bold">OPEC OpsFlow</CardTitle>
            <CardDescription className="text-base font-medium">Enterprise Offshore Operations System</CardDescription>
          </CardHeader>
          <form onSubmit={handleLogin}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">อีเมลใช้งาน (Email Address)</Label>
                <input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">รหัสผ่าน (Password)</Label>
                <input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" required />
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
              <Button type="submit" className="w-full h-12 text-lg font-bold shadow-lg" disabled={isLoggingIn}>
                {isLoggingIn ? 'กำลังตรวจสอบสิทธิ์...' : 'เข้าสู่ระบบ (SIGN IN)'}
              </Button>
              {!isBootstrapped && (
                <Button variant="outline" className="w-full gap-2 h-11" asChild>
                  <Link href="/setup-admin"><ShieldCheck className="h-4 w-4" /> เริ่มต้นระบบครั้งแรก (Setup System)</Link>
                </Button>
              )}
            </CardFooter>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <AppShell user={user} onLogout={handleLogout}>
      <div className="space-y-8 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold text-primary tracking-tight">แดชบอร์ดภาพรวม (Operations Dashboard)</h1>
          <p className="text-muted-foreground text-lg">ยินดีต้อนรับสู่ระบบจัดการกำลังคนและปฏิบัติการโครงสร้างพื้นฐานนอกชายฝั่ง</p>
        </div>

        <Alert className="bg-primary/5 border-primary/20">
          <Info className="h-4 w-4 text-primary" />
          <AlertTitle className="font-bold">ประกาศสำคัญ (System Announcement)</AlertTitle>
          <AlertDescription>
            กรุณาอัปเดตใบรับรองแพทย์ของคนงานในโครงการปิโตรเคมี X ก่อนวันศุกร์นี้เพื่อความต่อเนื่องของงาน
          </AlertDescription>
        </Alert>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <StatCard title="รายได้โดยประมาณ (Estimated Revenue)" value={`฿${stats.revenue}`} sub="เดือนปัจจุบัน (Current Month)" icon={CircleDollarSign} colorClass="border-l-blue-600" />
          <StatCard title="คนงานที่ทำงานอยู่ (Active Workers)" value={stats.activeWorkers} sub="On-site Offshore" icon={HardHat} colorClass="border-l-orange-500" />
          <StatCard title="สัญญาหลัก (Active Contracts)" value={stats.activeContracts} sub="Master Agreements" icon={Briefcase} colorClass="border-l-emerald-600" />
          <StatCard title="รายการที่ต้องพิจารณา (Pending Items)" value={stats.pendingItems} sub="Needs Attention" icon={Activity} colorClass="border-l-red-500" />
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card className="shadow-md">
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" /> แนวโน้มการส่งตัวคนงาน (Staffing Trends)
              </CardTitle>
              <CardDescription>สถิติการมอบหมายงานรายสัปดาห์</CardDescription>
            </CardHeader>
            <CardContent className="h-[300px] flex items-center justify-center text-muted-foreground italic bg-muted/20 rounded-md m-6 border-dashed border-2">
              ส่วนแสดงผลกราฟสถิติ (Chart Section)
            </CardContent>
          </Card>

          <Card className="shadow-md">
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2">
                <Clock className="h-5 w-5 text-primary" /> รายการที่ต้องดำเนินการ (Action Items)
              </CardTitle>
              <CardDescription>รายการด่วนที่ฝ่ายปฏิบัติการต้องจัดการ</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 border rounded-lg bg-card hover:bg-muted/10 transition-colors flex items-center justify-between">
                <div className="flex gap-3 items-center">
                  <div className="bg-red-100 p-2 rounded-full text-red-600"><ShieldAlert className="h-4 w-4" /></div>
                  <div>
                    <p className="font-bold text-sm">ใบเซอร์หมดอายุ {stats.expiringCerts} รายการ</p>
                    <p className="text-xs text-muted-foreground">ต้องรีบต่ออายุเพื่อความปลอดภัย</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" asChild><Link href="/workers"><ArrowRight className="h-4 w-4" /></Link></Button>
              </div>
              <div className="p-4 border rounded-lg bg-card hover:bg-muted/10 transition-colors flex items-center justify-between">
                <div className="flex gap-3 items-center">
                  <div className="bg-blue-100 p-2 rounded-full text-blue-600"><UserPlus className="h-4 w-4" /></div>
                  <div>
                    <p className="font-bold text-sm">คำขออนุมัติคนงานใหม่ {stats.pendingItems} รายการ</p>
                    <p className="text-xs text-muted-foreground">รอการพิจารณาจากลูกค้าใน Portal</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" asChild><Link href="/assignments"><ArrowRight className="h-4 w-4" /></Link></Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function StatCard({ title, value, sub, icon: Icon, colorClass }: any) {
  return (
    <Card className={`hover:shadow-lg transition-all border-l-8 ${colorClass} shadow-sm`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">{title}</CardTitle>
        <Icon className="h-5 w-5 opacity-50" />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-black text-primary">{value}</div>
        <p className="text-xs font-medium text-muted-foreground mt-1">{sub}</p>
      </CardContent>
    </Card>
  );
}
