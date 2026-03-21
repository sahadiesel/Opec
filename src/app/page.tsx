
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { User, BusinessRoleKey, DeptType } from '@/lib/types';
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
  FileText,
  Lock,
  KeyRound,
  Building2
} from 'lucide-react';
import { useFirestore, useAuth, useUser, useDoc, useMemoFirebase } from '@/firebase';
import { signInWithEmailAndPassword, signOut, updatePassword } from 'firebase/auth';
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
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from '@/components/ui/dialog';
import { PlaceHolderImages } from '@/lib/placeholder-images';

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Password Reset State
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [isResetting, setIsResetting] = useState(false);

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
      // Security Guard: Check inactivity
      if (!latestUserDoc.isActive || latestUserDoc.approvalStatus === 'SUSPENDED') {
        toast({ variant: "destructive", title: "Access Blocked", description: "Your account is currently inactive." });
        handleLogout();
        return;
      }

      // Customer Portal Redirect
      if (latestUserDoc.userType === 'customer_portal') {
        router.push('/client-portal/dashboard');
      }

      // Security Guard: Forced Password Reset
      if (latestUserDoc.mustResetPassword) {
        setShowResetDialog(true);
      }

      setUser(latestUserDoc);
      localStorage.setItem('opsflow_user', JSON.stringify(latestUserDoc));
    }
  }, [latestUserDoc, router]);

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
        
        // 1. Check Activity Status
        if (!userData.isActive || userData.approvalStatus === 'SUSPENDED' || userData.approvalStatus === 'REJECTED') {
          toast({ variant: "destructive", title: "Access Restricted", description: "บัญชีของคุณถูกระงับการใช้งาน (Account Inactive)" });
          await signOut(auth);
          setIsLoggingIn(false);
          return;
        }

        // 2. Log login time
        await updateDoc(docRef, { lastLoginAt: Date.now() });

        // 3. Handle First-time reset detection
        if (userData.mustResetPassword) {
          setUser(userData);
          setShowResetDialog(true);
          toast({ title: "First Login Detected", description: "Please set a new permanent password." });
        } else {
          setUser(userData);
          localStorage.setItem('opsflow_user', JSON.stringify(userData));
          toast({ title: "เข้าสู่ระบบสำเร็จ" });
          
          if (userData.userType === 'customer_portal') {
            router.push('/client-portal/dashboard');
          }
        }
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Login Failed", description: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
    } finally { setIsLoggingIn(false); }
  };

  const handlePasswordReset = async () => {
    if (!auth.currentUser || !latestUserDoc) return;
    if (newPassword !== confirmNewPassword) {
      toast({ variant: "destructive", title: "Validation Error", description: "Passwords do not match." });
      return;
    }
    if (newPassword.length < 8) {
      toast({ variant: "destructive", title: "Weak Password", description: "Password must be at least 8 characters." });
      return;
    }

    setIsResetting(true);
    try {
      // 1. Update Firebase Auth Password
      await updatePassword(auth.currentUser, newPassword);

      // 2. Clear reset flag in Firestore
      const userRef = doc(firestore!, 'users', latestUserDoc.id);
      await updateDoc(userRef, { 
        mustResetPassword: false,
        updatedAt: Date.now()
      });

      setShowResetDialog(false);
      toast({ title: "Password Updated", description: "You can now use the portal." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Reset Failed", description: err.message });
    } finally {
      setIsResetting(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setUser(null);
    localStorage.removeItem('opsflow_user');
    setShowResetDialog(false);
  };

  if (!isLoaded || isUserLoading) return null;

  // Login Screen
  if (!user || (!latestUserDoc && isLoggingIn)) {
    const loginBg = PlaceHolderImages.find(img => img.id === 'login-bg')?.imageUrl || '';
    return (
      <div 
        className="flex items-center justify-center min-h-screen p-4 bg-cover bg-center bg-no-repeat relative"
        style={{ backgroundImage: loginBg ? `url(${loginBg})` : 'none' }}
        data-ai-hint="offshore oil rig"
      >
        <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-[3px]" />
        <Card className="w-full max-w-md shadow-2xl border-t-8 border-t-primary relative z-10 bg-white/95">
          <CardHeader className="space-y-1 text-center">
            <div className="mx-auto bg-primary/10 p-4 rounded-full w-fit mb-4">
              <ShieldCheck className="h-10 w-10 text-primary" />
            </div>
            <CardTitle className="text-3xl font-bold tracking-tight text-primary">OPEC OpsFlow</CardTitle>
            <CardDescription className="text-base font-medium">Enterprise Manpower Supply Operations</CardDescription>
          </CardHeader>
          <form onSubmit={handleLogin}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="font-bold">อีเมลใช้งาน (Email)</Label>
                <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@company.com" required className="h-11" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" title="password" className="font-bold">รหัสผ่าน (Password)</Label>
                <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required className="h-11" />
              </div>
            </CardContent>
            <CardFooter>
              <Button type="submit" className="w-full h-12 text-lg font-bold shadow-lg bg-primary" disabled={isLoggingIn}>
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
  
  // Aggregate all unique departments for the welcome display
  const activeRoleKeys = latestUserDoc?.assignedRoleKeys || [roleKey as BusinessRoleKey];
  const allDepts = Array.from(new Set(activeRoleKeys.map(rk => BUSINESS_ROLES[rk]?.dept).filter(Boolean)));

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
                <p className="text-[10px] font-black text-slate-400 uppercase mb-1">บทบาทหลัก (Primary Role)</p>
                <p className="font-bold text-lg text-primary">{roleInfo?.labelTh || 'ผู้ใช้งานระบบ'}</p>
                <p className="text-xs text-muted-foreground uppercase">{roleInfo?.labelEn || 'System User'}</p>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
                <p className="text-[10px] font-black text-slate-400 uppercase mb-1">สิทธิ์การเข้าถึง (Access Level)</p>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  {allDepts.map(d => (
                    <Badge key={d} variant="secondary" className="capitalize font-black flex items-center gap-1 bg-blue-50 text-blue-700 border-blue-100">
                      <Building2 className="h-2.5 w-2.5" /> {d}
                    </Badge>
                  ))}
                  <span className="text-muted-foreground text-xs mx-1">/</span>
                  <Badge variant="outline" className="capitalize font-bold border-primary/20">{user.level}</Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-md bg-primary text-primary-foreground">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Info className="h-5 w-5 opacity-80" /> งานที่ต้องติดตาม (My Pending Actions)
              </CardTitle>
              <CardDescription className="text-primary-foreground/60 text-xs">รายการสำคัญที่คุณต้องดำเนินการตามบทบาท</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Role-based action prompts */}
              {(user.roleIds?.includes('hr_manager') || user.roleIds?.includes('hr_officer') || isAdminUser(user)) && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-white/10 hover:bg-white/20 transition-colors cursor-pointer group" onClick={() => router.push('/hr/dashboard')}>
                  <div className="flex items-center gap-3">
                    <Users className="h-4 w-4" />
                    <span className="text-sm font-medium">ตรวจงาน HR Dashboard</span>
                  </div>
                  <ChevronRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-all" />
                </div>
              )}
              {(user.roleIds?.includes('sales_manager') || user.roleIds?.includes('sales_officer') || isAdminUser(user)) && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-white/10 hover:bg-white/20 transition-colors cursor-pointer group" onClick={() => router.push('/sales/dashboard')}>
                  <div className="flex items-center gap-3">
                    <TrendingUp className="h-4 w-4" />
                    <span className="text-sm font-medium">ตรวจงาน Sales Dashboard</span>
                  </div>
                  <ChevronRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-all" />
                </div>
              )}
              {(user.roleIds?.includes('accounting_manager') || user.roleIds?.includes('accounting_officer') || isAdminUser(user)) && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-white/10 hover:bg-white/20 transition-colors cursor-pointer group" onClick={() => router.push('/accounting/dashboard')}>
                  <div className="flex items-center gap-3">
                    <Coins className="h-4 w-4" />
                    <span className="text-sm font-medium">ตรวจงาน Accounting Dashboard</span>
                  </div>
                  <ChevronRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-all" />
                </div>
              )}
              {(user.roleIds?.includes('operations_manager') || user.roleIds?.includes('operations_officer') || isAdminUser(user)) && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-white/10 hover:bg-white/20 transition-colors cursor-pointer group" onClick={() => router.push('/operations/dashboard')}>
                  <div className="flex items-center gap-3">
                    <HardHat className="h-4 w-4" />
                    <span className="text-sm font-medium">ตรวจงาน Operations Dashboard</span>
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
            </CardContent>
          </Card>
        </div>

        {/* Action Grid (Department Shortcuts) */}
        <div className="space-y-6">
          <div className="flex items-center gap-2">
            <LayoutGrid className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold text-primary">ทางลัดตามบทบาท (Role Command)</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {/* HR Section */}
            {check('hr_dashboard' as any, 'view') || check('workers', 'view') || check('positions', 'view') ? (
              <ShortcutGroup title="ฝ่ายบุคคล (HR)" icon={Users} color="border-l-orange-500">
                <ShortcutLink href="/hr/dashboard" label="HR Dashboard" sub="ภาพรวมบุคคล" />
                {check('workers', 'view') && <ShortcutLink href="/workers" label="ทะเบียนคนงาน" sub="Workers" />}
                {check('positions', 'view') && <ShortcutLink href="/positions" label="ตำแหน่งงาน" sub="Positions" />}
                {check('office_staff', 'view') && <ShortcutLink href="/office-staff" label="พนักงานออฟฟิศ" sub="Office Staff" />}
                {check('worker_payroll', 'view') && <ShortcutLink href="/payroll" label="จ่ายเงินคนงาน" sub="Payroll" />}
              </ShortcutGroup>
            ) : null}

            {/* Sales Section */}
            {check('sales_dashboard' as any, 'view') || check('customers', 'view') || check('main_contracts', 'view') ? (
              <ShortcutGroup title="ฝ่ายขาย (Sales)" icon={Briefcase} color="border-l-blue-600">
                <ShortcutLink href="/sales/dashboard" label="Sales Dashboard" sub="ภาพรวมงานขาย" />
                {check('customers', 'view') && <ShortcutLink href="/customers" label="ทะเบียนลูกค้า" sub="Customers" />}
                {check('main_contracts', 'view') && <ShortcutLink href="/main-contracts" label="สัญญาหลัก" sub="Contracts" />}
                {check('customer_pos', 'view') && <ShortcutLink href="/purchase-orders" label="ใบสั่งซื้อลูกค้า" sub="POs" />}
              </ShortcutGroup>
            ) : null}

            {/* Operations Section */}
            {check('operations_dashboard' as any, 'view') || check('waves', 'view') || check('assignments', 'view') ? (
              <ShortcutGroup title="ฝ่ายปฏิบัติการ (Ops)" icon={HardHat} color="border-l-emerald-600">
                <ShortcutLink href="/operations/dashboard" label="Operations Dashboard" sub="ภาพรวมปฏิบัติการ" />
                {check('waves', 'view') && <ShortcutLink href="/waves" label="กลุ่มงาน (Waves)" sub="Waves" />}
                {check('assignments', 'view') && <ShortcutLink href="/assignments" label="มอบหมายงาน" sub="Assignments" />}
                {check('mobilization', 'view') && <ShortcutLink href="/mobilization" label="เตรียมส่งตัว" sub="Mobilization" />}
              </ShortcutGroup>
            ) : null}

            {/* Finance Section */}
            {check('accounting_dashboard' as any, 'view') || check('billing_notes', 'view') || check('cashbook', 'view') ? (
              <ShortcutGroup title="บัญชีและการเงิน (Finance)" icon={Coins} color="border-l-purple-600">
                <ShortcutLink href="/accounting/dashboard" label="Accounting Dashboard" sub="ภาพรวมบัญชี" />
                {check('billing_notes', 'view') && <ShortcutLink href="/billing-notes" label="ใบวางบิล" sub="Billing" />}
                {check('cashbook', 'view') && <ShortcutLink href="/cashbook" label="รายรับรายจ่าย" sub="Cashbook" />}
                {check('ap_bills', 'view') && <ShortcutLink href="/ap-bills" label="รับวางบิลเจ้าหนี้" sub="AP Bills" />}
              </ShortcutGroup>
            ) : null}

            {/* Store Section */}
            {check('store_inventory', 'view') || check('vendors', 'view') ? (
              <ShortcutGroup title="คลังและจัดซื้อ (Store)" icon={Warehouse} color="border-l-amber-500">
                {check('store_inventory', 'view') && <ShortcutLink href="/store" label="คลังอุปกรณ์" sub="Inventory" />}
                {check('vendors', 'view') && <ShortcutLink href="/vendors" label="ทะเบียนคู่ค้า" sub="Vendors" />}
                {check('purchases', 'view') && <ShortcutLink href="/purchases" label="การสั่งซื้อ" sub="Purchases" />}
              </ShortcutGroup>
            ) : null}
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

        {/* Forced Password Reset Dialog */}
        <Dialog open={showResetDialog} onOpenChange={(open) => { if(!open) handleLogout(); }}>
          <DialogContent className="sm:max-max-w-md border-t-8 border-t-primary">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-2xl font-black text-primary">
                <KeyRound className="h-6 w-6" /> ตั้งรหัสผ่านใหม่
              </DialogTitle>
              <DialogDescription className="font-medium text-slate-600">
                เป็นการเข้าใช้งานครั้งแรก กรุณากำหนดรหัสผ่านถาวรเพื่อความปลอดภัยของข้อมูล (First login detected. Please set a permanent password.)
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label className="font-bold">รหัสผ่านใหม่ (New Password)</Label>
                <Input 
                  type="password" 
                  value={newPassword} 
                  onChange={e => setNewPassword(e.target.value)} 
                  placeholder="อย่างน้อย 8 ตัวอักษร"
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label className="font-bold">ยืนยันรหัสผ่านใหม่ (Confirm Password)</Label>
                <Input 
                  type="password" 
                  value={confirmNewPassword} 
                  onChange={e => setConfirmNewPassword(e.target.value)} 
                  placeholder="กรอกรหัสผ่านอีกครั้ง"
                  className="h-11"
                />
              </div>
              <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg flex gap-3">
                <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                <p className="text-[10px] text-blue-700 leading-relaxed font-medium">
                  รหัสผ่านควรประกอบด้วย ตัวอักษรพิมพ์ใหญ่ พิมพ์เล็ก และตัวเลข เพื่อป้องกันการคาดเดา
                </p>
              </div>
            </div>
            <DialogFooter className="sm:justify-between gap-2">
              <Button variant="ghost" onClick={handleLogout} className="text-muted-foreground">ยกเลิกและออก</Button>
              <Button 
                onClick={handlePasswordReset} 
                disabled={isResetting || !newPassword}
                className="bg-primary font-bold h-11 px-8 shadow-lg"
              >
                {isResetting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Lock className="h-4 w-4 mr-2" />}
                ยืนยันการเปลี่ยนรหัส
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
