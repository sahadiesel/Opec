'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { User, BusinessRoleKey } from '@/lib/types';
import { 
  ShieldCheck, 
  Users, 
  HardHat, 
  ShieldAlert, 
  Loader2, 
  Wrench, 
  Info, 
  Briefcase, 
  Waves, 
  Truck, 
  Warehouse, 
  Coins, 
  ArrowRight, 
  ChevronRight, 
  CheckCircle2, 
  Clock, 
  LayoutGrid, 
  TrendingUp,
  Receipt,
  FileText
} from 'lucide-react';
import { useFirestore, useAuth, useUser, useDoc, useMemoFirebase } from '@/firebase';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { isAdminUser, BUSINESS_ROLES, inferDeptAndLevel } from '@/lib/auth-mapping';
import { usePermissions } from '@/hooks/use-permissions';
import { UI_LABELS } from '@/lib/constants/labels';
import { HELP_TEXTS } from '@/lib/constants/help-texts';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const firestore = useFirestore();
  const auth = useAuth();
  const { user: firebaseUser, isUserLoading } = useUser();
  const { toast } = useToast();
  
  const userDocRef = useMemoFirebase(() => (firestore && firebaseUser ? doc(firestore, 'users', firebaseUser.uid) : null), [firestore, firebaseUser]);
  const { data: latestUserDoc, isLoading: isDocLoading } = useDoc<User>(userDocRef as any);

  useEffect(() => {
    setIsLoaded(true);
    const stored = localStorage.getItem('opsflow_user');
    if (stored) {
      try {
        setUser(JSON.parse(stored));
      } catch (e) { console.error(e); }
    }
  }, []);

  useEffect(() => {
    if (!isUserLoading && !firebaseUser) {
      setUser(null);
      localStorage.removeItem('opsflow_user');
    }
  }, [firebaseUser, isUserLoading]);

  useEffect(() => {
    if (latestUserDoc) {
      setUser(latestUserDoc);
      localStorage.setItem('opsflow_user', JSON.stringify(latestUserDoc));
    }
  }, [latestUserDoc]);

  const isInternalAuthorized = useMemo(() => {
    if (isDocLoading || !latestUserDoc) return false;
    return latestUserDoc.isActive && latestUserDoc.approvalStatus === 'ACTIVE';
  }, [latestUserDoc, isDocLoading]);

  const { can, check } = usePermissions(latestUserDoc || null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const docRef = doc(firestore!, 'users', cred.user.uid);
      const snap = await getDoc(docRef);
      
      if (snap.exists()) {
        const userData = snap.data() as User;
        if (userData.approvalStatus === 'SUSPENDED' || userData.approvalStatus === 'REJECTED') {
          toast({ variant: "destructive", title: "Access Restricted", description: "บัญชีของคุณถูกระงับการใช้งาน" });
          setIsLoggingIn(false);
          return;
        }
        await updateDoc(docRef, { lastLoginAt: Date.now() });
        setUser(userData);
        localStorage.setItem('opsflow_user', JSON.stringify(userData));
        toast({ title: "เข้าสู่ระบบสำเร็จ" });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Login Failed", description: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
    } finally { setIsLoggingIn(false); }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setUser(null);
    localStorage.removeItem('opsflow_user');
  };

  if (!isLoaded || isUserLoading) return null;

  // Login Screen
  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50 p-4">
        <Card className="w-full max-w-md shadow-2xl border-t-8 border-t-primary">
          <CardHeader className="space-y-1 text-center">
            <div className="mx-auto bg-primary/10 p-4 rounded-full w-fit mb-4">
              <ShieldCheck className="h-10 w-10 text-primary" />
            </div>
            <CardTitle className="text-3xl font-bold tracking-tight text-primary">OPEC OpsFlow</CardTitle>
            <CardDescription className="text-base">Enterprise Manpower Supply Operations</CardDescription>
          </CardHeader>
          <form onSubmit={handleLogin}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">อีเมลใช้งาน (Email)</Label>
                <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@company.com" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">รหัสผ่าน (Password)</Label>
                <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
              </div>
            </CardContent>
            <CardFooter>
              <Button type="submit" className="w-full h-12 text-lg font-bold" disabled={isLoggingIn}>
                {isLoggingIn ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : null}
                เข้าสู่ระบบ
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    );
  }

  const roleKey = latestUserDoc?.assignedRoleKey || 'hr_officer';
  const roleInfo = BUSINESS_ROLES[roleKey as BusinessRoleKey];

  return (
    <AppShell user={user} onLogout={handleLogout}>
      <div className="space-y-8 max-w-[1600px] mx-auto">
        {/* Header */}
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold text-primary tracking-tight">{UI_LABELS.DASHBOARD}</h1>
          <p className="text-muted-foreground text-lg">{HELP_TEXTS.DASHBOARD}</p>
        </div>

        {/* Welcome Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 border-none shadow-md bg-white overflow-hidden">
            <div className="h-2 bg-primary" />
            <CardHeader className="pb-4">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground uppercase tracking-widest">ยินดีต้อนรับ (Welcome)</p>
                  <CardTitle className="text-3xl font-black text-primary">{user.displayName}</CardTitle>
                </div>
                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 px-3 py-1 font-bold">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> Account Verified
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
                <p className="text-[10px] font-black text-slate-400 uppercase mb-1">บทบาทหน้าที่ (Business Role)</p>
                <p className="font-bold text-lg text-primary">{roleInfo?.labelTh || 'ผู้ใช้งานระบบ'}</p>
                <p className="text-xs text-muted-foreground uppercase">{roleInfo?.labelEn || 'System User'}</p>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
                <p className="text-[10px] font-black text-slate-400 uppercase mb-1">แผนกต้นสังกัด (Department)</p>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="capitalize font-bold">{user.department}</Badge>
                  <span className="text-muted-foreground text-xs">/</span>
                  <Badge variant="outline" className="capitalize font-bold">{user.level}</Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-md bg-primary text-primary-foreground">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Info className="h-5 w-5 opacity-80" /> งานที่ต้องติดตาม (My Pending Actions)
              </CardTitle>
              <CardDescription className="text-primary-foreground/60 text-xs">รายการสำคัญที่คุณต้องดำเนินการในวันนี้</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Role-specific pending actions */}
              {user.department === 'hr' && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-white/10 hover:bg-white/20 transition-colors cursor-pointer group" onClick={() => router.push('/hr/dashboard')}>
                  <div className="flex items-center gap-3">
                    <Users className="h-4 w-4" />
                    <span className="text-sm font-medium">ตรวจงาน HR Dashboard</span>
                  </div>
                  <ChevronRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-all" />
                </div>
              )}
              {user.department === 'sales' && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-white/10 hover:bg-white/20 transition-colors cursor-pointer group" onClick={() => router.push('/sales/dashboard')}>
                  <div className="flex items-center gap-3">
                    <TrendingUp className="h-4 w-4" />
                    <span className="text-sm font-medium">ตรวจงาน Sales Dashboard</span>
                  </div>
                  <ChevronRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-all" />
                </div>
              )}
              {user.department === 'accounting' && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-white/10 hover:bg-white/20 transition-colors cursor-pointer group" onClick={() => router.push('/accounting/dashboard')}>
                  <div className="flex items-center gap-3">
                    <Coins className="h-4 w-4" />
                    <span className="text-sm font-medium">ตรวจงาน Accounting Dashboard</span>
                  </div>
                  <ChevronRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-all" />
                </div>
              )}
              {isAdminUser(user) && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-white/10 hover:bg-white/20 transition-colors cursor-pointer group" onClick={() => router.push('/users')}>
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="h-4 w-4" />
                    <span className="text-sm font-medium">อนุมัติสิทธิ์ผู้ใช้ใหม่</span>
                  </div>
                  <ChevronRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-all" />
                </div>
              )}
              <p className="text-[10px] text-center opacity-40 italic pt-2">No critical system alerts</p>
            </CardContent>
          </Card>
        </div>

        {/* Action Grid (Department Shortcuts) */}
        <div className="space-y-6">
          <div className="flex items-center gap-2">
            <LayoutGrid className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold text-primary">ทางลัดตามแผนก (Department Command)</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {/* HR Section */}
            {(check('workers', 'view') || check('positions', 'view')) && (
              <ShortcutGroup title="ฝ่ายบุคคล (HR)" icon={Users} color="border-l-orange-500">
                <ShortcutLink href="/hr/dashboard" label="HR Dashboard" sub="ภาพรวมบุคคล" />
                {check('workers', 'view') && <ShortcutLink href="/workers" label="ทะเบียนคนงาน" sub="Workers" />}
                {check('positions', 'view') && <ShortcutLink href="/positions" label="ตำแหน่งงาน" sub="Positions" />}
                {check('office_staff', 'view') && <ShortcutLink href="/office-staff" label="พนักงานออฟฟิศ" sub="Office Staff" />}
                {check('worker_payroll', 'view') && <ShortcutLink href="/payroll" label="จ่ายเงินคนงาน" sub="Payroll" />}
              </ShortcutGroup>
            )}

            {/* Sales Section */}
            {(check('customers', 'view') || check('main_contracts', 'view')) && (
              <ShortcutGroup title="ฝ่ายขาย (Sales)" icon={Briefcase} color="border-l-blue-600">
                <ShortcutLink href="/sales/dashboard" label="Sales Dashboard" sub="ภาพรวมงานขาย" />
                {check('customers', 'view') && <ShortcutLink href="/customers" label="ทะเบียนลูกค้า" sub="Customers" />}
                {check('main_contracts', 'view') && <ShortcutLink href="/main-contracts" label="สัญญาหลัก" sub="Contracts" />}
                {check('customer_pos', 'view') && <ShortcutLink href="/purchase-orders" label="ใบสั่งซื้อลูกค้า" sub="POs" />}
              </ShortcutGroup>
            )}

            {/* Operations Section */}
            {(check('waves', 'view') || check('assignments', 'view')) && (
              <ShortcutGroup title="ฝ่ายปฏิบัติการ (Ops)" icon={HardHat} color="border-l-emerald-600">
                {check('waves', 'view') && <ShortcutLink href="/waves" label="กลุ่มงาน (Waves)" sub="Waves" />}
                {check('assignments', 'view') && <ShortcutLink href="/assignments" label="มอบหมายงาน" sub="Assignments" />}
                {check('mobilization', 'view') && <ShortcutLink href="/mobilization" label="เตรียมส่งตัว" sub="Mobilization" />}
              </ShortcutGroup>
            )}

            {/* Finance Section */}
            {(check('billing_notes', 'view') || check('cashbook', 'view')) && (
              <ShortcutGroup title="บัญชีและการเงิน (Finance)" icon={Coins} color="border-l-purple-600">
                <ShortcutLink href="/accounting/dashboard" label="Accounting Dashboard" sub="ภาพรวมบัญชี" />
                {check('billing_notes', 'view') && <ShortcutLink href="/billing-notes" label="ใบวางบิล" sub="Billing" />}
                {check('cashbook', 'view') && <ShortcutLink href="/cashbook" label="รายรับรายจ่าย" sub="Cashbook" />}
                {check('ap_bills', 'view') && <ShortcutLink href="/ap-bills" label="รับวางบิลเจ้าหนี้" sub="AP Bills" />}
              </ShortcutGroup>
            )}

            {/* Store Section */}
            {(check('store_inventory', 'view')) && (
              <ShortcutGroup title="คลังและจัดซื้อ (Store)" icon={Warehouse} color="border-l-amber-500">
                {check('store_inventory', 'view') && <ShortcutLink href="/store" label="คลังอุปกรณ์" sub="Inventory" />}
                {check('vendors', 'view') && <ShortcutLink href="/vendors" label="ทะเบียนคู่ค้า" sub="Vendors" />}
                {check('purchases', 'view') && <ShortcutLink href="/purchases" label="การสั่งซื้อ" sub="Purchases" />}
              </ShortcutGroup>
            )}
          </div>
        </div>

        {/* Restricted Access Warning (Fallback) */}
        {!isInternalAuthorized && !isDocLoading && (
          <Alert variant="destructive" className="bg-destructive/5 border-destructive/20">
            <ShieldAlert className="h-6 w-6" />
            <AlertTitle className="font-bold text-lg">Access Pending (รอนุมัติสิทธิ์เข้าใช้งาน)</AlertTitle>
            <AlertDescription className="space-y-4">
              <p>บัญชีของคุณยังไม่ได้รับการอนุมัติให้เข้าใช้งานส่วนงานภายใน กรุณาติดต่อผู้ดูแลระบบเพื่อกำหนดบทบาท (Role Assignment)</p>
              <Button variant="outline" className="gap-2 bg-white" onClick={() => router.push('/setup-admin')}>
                <Wrench className="h-4 w-4" /> กู้คืนสิทธิ์แอดมิน (Repair Admin)
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </div>
    </AppShell>
  );
}

function ShortcutGroup({ title, icon: Icon, color, children }: { title: string; icon: any; color: string; children: React.ReactNode }) {
  return (
    <Card className={`border-none shadow-sm overflow-hidden bg-white border-l-4 ${color}`}>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-xs font-black text-muted-foreground uppercase flex items-center gap-2">
          <Icon className="h-3 w-3" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-2 pt-0 space-y-1">
        {children}
      </CardContent>
    </Card>
  );
}

function ShortcutLink({ href, label, sub }: { href: string; label: string; sub: string }) {
  return (
    <Link href={href} className="block group">
      <div className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 transition-colors">
        <div className="flex flex-col">
          <span className="text-sm font-bold text-primary group-hover:text-blue-600 transition-colors">{label}</span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-tighter">{sub}</span>
        </div>
        <ArrowRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-all translate-x-[-4px] group-hover:translate-x-0" />
      </div>
    </Link>
  );
}
