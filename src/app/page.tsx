'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { User, RoleType } from '@/lib/types';
import { 
  Briefcase, 
  Info, 
  AlertTriangle, 
  FileWarning, 
  CheckCircle2, 
  ShieldCheck, 
  ClipboardList, 
  UserPlus, 
  ShieldAlert,
  ShoppingCart,
  Users,
  CircleDollarSign,
  Clock,
  UserSquare2
} from 'lucide-react';
import { useFirestore, useAuth, useUser } from '@/firebase';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';

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

  useEffect(() => {
    setIsLoaded(true);
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setUser(JSON.parse(stored));

    async function checkBootstrap() {
      if (!firestore) return;
      try {
        const snap = await getDoc(doc(firestore, 'system', 'bootstrap'));
        setIsBootstrapped(snap.exists());
      } catch (e) {
        setIsBootstrapped(false);
      }
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
        const userData = userDoc.data() as User;
        setUser(userData);
        localStorage.setItem('opsflow_user', JSON.stringify(userData));
        toast({ title: "เข้าสู่ระบบสำเร็จ" });
      } else {
        throw new Error('ไม่พบข้อมูลโปรไฟล์ผู้ใช้งาน');
      }
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "เข้าสู่ระบบไม่สำเร็จ",
        description: err.message || "กรุณาตรวจสอบอีเมลและรหัสผ่าน",
      });
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('opsflow_user');
  };

  if (!isLoaded || isUserLoading) return null;

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background p-4">
        <Card className="w-full max-w-md shadow-xl border-t-4 border-t-primary">
          <CardHeader className="space-y-1 text-center">
            <div className="mx-auto bg-primary/10 p-3 rounded-full w-fit mb-4">
              <Briefcase className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="text-2xl">OPEC OpsFlow</CardTitle>
            <CardDescription>เข้าสู่ระบบจัดการกำลังคน</CardDescription>
          </CardHeader>
          <form onSubmit={handleLogin}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">อีเมล</Label>
                <input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">รหัสผ่าน</Label>
                <input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" required />
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
              <Button type="submit" className="w-full" disabled={isLoggingIn}>
                {isLoggingIn ? 'กำลังตรวจสอบ...' : 'เข้าสู่ระบบ'}
              </Button>
              {!isBootstrapped && (
                <Button variant="outline" className="w-full gap-2" asChild>
                  <Link href="/setup-admin"><UserPlus className="h-4 w-4" /> เริ่มต้นระบบครั้งแรก</Link>
                </Button>
              )}
            </CardFooter>
          </form>
        </Card>
      </div>
    );
  }

  const renderDashboard = () => {
    switch (user.roleId) {
      case 'system_admin': return <AdminDashboard user={user} />;
      case 'hr_manager': return <HRDashboard user={user} manager />;
      case 'hr_officer': return <HRDashboard user={user} />;
      case 'sales_officer': return <CommercialDashboard user={user} />;
      case 'payroll_officer': return <PayrollDashboard user={user} />;
      case 'client': return <ClientDashboard user={user} />;
      default: return <DefaultDashboard user={user} />;
    }
  };

  return <AppShell user={user} onLogout={handleLogout}>{renderDashboard()}</AppShell>;
}

function StatCard({ title, value, sub, icon: Icon, colorClass }: any) {
  return (
    <Card className={`hover:shadow-md transition-shadow border-l-4 ${colorClass}`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 opacity-70" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}

function HRDashboard({ user, manager }: { user: User, manager?: boolean }) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-primary">HR {manager ? 'Manager' : 'Operations'} Dashboard</h1>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="คนงานทั้งหมด" value="1,240" sub="รายชื่อในระบบ" icon={UserSquare2} colorClass="border-l-primary" />
        <StatCard title="พร้อมปฏิบัติงาน" value="842" sub="READY status" icon={CheckCircle2} colorClass="border-l-green-500" />
        <StatCard title="ใบรับรองหมดอายุ" value="42" sub="ต้องต่ออายุ" icon={FileWarning} colorClass="border-l-amber-500" />
        <StatCard title="รอพิจารณา" value="15" sub="เสนอตัวบุคคล" icon={ShieldAlert} colorClass="border-l-blue-500" />
      </div>
    </div>
  );
}

function CommercialDashboard({ user }: { user: User }) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-primary">Commercial Dashboard</h1>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="ลูกค้าทั้งหมด" value="48" sub="บริษัท" icon={Users} colorClass="border-l-primary" />
        <StatCard title="สัญญาที่เปิดอยู่" value="12" sub="Main Contracts" icon={ClipboardList} colorClass="border-l-blue-500" />
        <StatCard title="ใบสั่งซื้อรอดำเนินการ" value="24" sub="Pending POs" icon={ShoppingCart} colorClass="border-l-amber-500" />
        <StatCard title="รายได้ประมาณการ" value="฿4.2M" sub="เดือนปัจจุบัน" icon={CircleDollarSign} colorClass="border-l-green-500" />
      </div>
    </div>
  );
}

function PayrollDashboard({ user }: { user: User }) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-primary">Payroll Dashboard</h1>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="จำนวนคนงานที่จ่ายเงิน" value="1,120" sub="รอบปัจจุบัน" icon={Users} colorClass="border-l-primary" />
        <StatCard title="ไทม์ชีทที่รออนุมัติ" value="156" sub="รายการ" icon={Clock} colorClass="border-l-amber-500" />
        <StatCard title="งบประมาณจ่าย" value="฿8.4M" sub="รอบนี้" icon={CircleDollarSign} colorClass="border-l-destructive" />
        <StatCard title="จ่ายสำเร็จ" value="98%" sub="ความคืบหน้า" icon={CheckCircle2} colorClass="border-l-green-500" />
      </div>
    </div>
  );
}

function ClientDashboard({ user }: { user: User }) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-primary">Client Portal Dashboard</h1>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <StatCard title="คนงานปฏิบัติงานอยู่" value="156" sub="Active on site" icon={UserPlus} colorClass="border-l-primary" />
        <StatCard title="รอคุณพิจารณา" value="8" sub="Candidates for review" icon={ShieldAlert} colorClass="border-l-amber-500" />
        <StatCard title="ใบสั่งซื้อทั้งหมด" value="5" sub="Active POs" icon={ShoppingCart} colorClass="border-l-blue-500" />
      </div>
    </div>
  );
}

function AdminDashboard({ user }: { user: User }) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-primary">System Executive Dashboard</h1>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="สุขภาพระบบ" value="100%" sub="Healthy" icon={ShieldCheck} colorClass="border-l-green-500" />
        <StatCard title="Staff Active" value="12" sub="เจ้าหน้าที่" icon={Users} colorClass="border-l-primary" />
        <StatCard title="Audit Logs" value="4.2k" sub="รายการล่าสุด" icon={ClipboardList} colorClass="border-l-slate-500" />
        <StatCard title="Alerts" value="0" sub="Critical Issues" icon={AlertTriangle} colorClass="border-l-green-500" />
      </div>
    </div>
  );
}

function DefaultDashboard({ user }: { user: User }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-4">
      <Info className="h-12 w-12 text-muted-foreground opacity-20" />
      <h2 className="text-xl font-semibold">ยินดีต้อนรับสู่ OPEC OpsFlow</h2>
      <p className="text-muted-foreground">กรุณาเลือกเมนูจากแถบด้านซ้ายเพื่อเริ่มต้นใช้งานตามสิทธิ์ของคุณ</p>
    </div>
  );
}
