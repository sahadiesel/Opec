'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { User, MainContract, Worker, Assignment } from '@/lib/types';
import { 
  Briefcase, 
  ShieldCheck, 
  UserPlus, 
  ShoppingCart,
  Users,
  Activity,
  HardHat,
  ShieldAlert,
  Loader2,
  Settings2,
  Info,
  Wrench
} from 'lucide-react';
import { useFirestore, useAuth, useUser, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, updateDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { inferDeptAndLevel, isAdminUser } from '@/lib/auth-mapping';
import { usePermissions } from '@/hooks/use-permissions';

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [regDisplayName, setRegDisplayName] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [isRegDialogOpen, setIsRegDialogOpen] = useState(false);

  const firestore = useFirestore();
  const auth = useAuth();
  const { user: firebaseUser, isUserLoading } = useUser();
  const { toast } = useToast();
  
  // Sync state with latest Firestore document
  const userDocRef = useMemoFirebase(() => (firestore && firebaseUser ? doc(firestore, 'users', firebaseUser.uid) : null), [firestore, firebaseUser]);
  const { data: latestUserDoc, isLoading: isDocLoading } = useDoc<User>(userDocRef as any);

  const { can, isLoading: isPermLoading } = usePermissions(user);

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
    if (latestUserDoc) {
      setUser(latestUserDoc);
      localStorage.setItem('opsflow_user', JSON.stringify(latestUserDoc));
    }
  }, [latestUserDoc]);

  const { dept } = useMemo(() => inferDeptAndLevel(user), [user]);
  
  // Defensive queries - Wait for ground truth from Firestore
  const isInternalAuthorized = useMemo(() => {
    // If we are still loading the document, don't authorize yet to avoid permission errors
    if (isDocLoading) return false;
    
    // ground truth must come from the latest document if available
    const activeUser = latestUserDoc || user;
    if (!activeUser || !activeUser.isActive) return false;
    
    // Absolute bypass for admins even during migration
    if (isAdminUser(activeUser)) return true;
    
    // Others must be approved
    if (activeUser.approvalStatus !== 'ACTIVE') return false;
    if (dept === 'client') return false;
    
    return true;
  }, [user, latestUserDoc, isDocLoading, dept]);

  // Queries only run when we are confirmed authorized by the ground truth
  const contractsQuery = useMemoFirebase(() => (firestore && isInternalAuthorized ? collection(firestore, 'main_contracts') : null), [firestore, isInternalAuthorized]);
  const { data: contracts } = useCollection<MainContract>(contractsQuery as any);

  const workersQuery = useMemoFirebase(() => (firestore && isInternalAuthorized ? collection(firestore, 'workers') : null), [firestore, isInternalAuthorized]);
  const { data: workers } = useCollection<Worker>(workersQuery as any);

  const mobilizationQuery = useMemoFirebase(() => (firestore && isInternalAuthorized ? collection(firestore, 'mobilizations') : null), [firestore, isInternalAuthorized]);
  const { data: assignments } = useCollection<Assignment>(mobilizationQuery as any);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const userDocRef = doc(firestore!, 'users', cred.user.uid);
      const userDoc = await getDoc(userDocRef);
      
      if (userDoc.exists()) {
        const userData = userDoc.data() as User;
        if (userData.approvalStatus === 'SUSPENDED' || userData.approvalStatus === 'REJECTED' || !userData.isActive) {
          toast({ variant: "destructive", title: "Access Restricted", description: "บัญชีของคุณยังไม่อนุญาตให้เข้าใช้งาน" });
          setIsLoggingIn(false);
          return;
        }
        await updateDoc(userDocRef, { lastLoginAt: Date.now() });
        setUser(userData);
        localStorage.setItem('opsflow_user', JSON.stringify(userData));
        toast({ title: "เข้าสู่ระบบสำเร็จ" });
      } else {
        toast({ variant: "destructive", title: "Configuration Required", description: "ตรวจพบไอดีแต่ไม่พบข้อมูลสิทธิ์ กรุณาติดต่อแอดมินหรือใช้เครื่องมือ Repair" });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Login Failed", description: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
    } finally { setIsLoggingIn(false); }
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('opsflow_user');
  };

  const handleRegister = async () => {
    if (regPassword !== regConfirmPassword) {
      toast({ variant: "destructive", title: "รหัสผ่านไม่ตรงกัน" });
      return;
    }
    setIsRegistering(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, regEmail, regPassword);
      const uid = cred.user.uid;
      const newUser: Partial<User> = {
        id: uid,
        email: regEmail,
        displayName: regDisplayName,
        department: 'hr', 
        level: 'viewer',  
        roleIds: [], 
        isActive: false,
        approvalStatus: 'PENDING',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await setDoc(doc(firestore!, 'users', uid), newUser);
      toast({ title: "ลงทะเบียนสำเร็จ", description: "บัญชีรอนุมัติสิทธิ์จากผู้ดูแลระบบ" });
      setIsRegDialogOpen(false);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Registration Failed", description: err.message });
    } finally {
      setIsRegistering(false);
    }
  };

  if (!isLoaded || isUserLoading) return null;

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50 p-4 font-body">
        <Card className="w-full max-w-md shadow-2xl border-t-8 border-t-primary">
          <CardHeader className="space-y-1 text-center">
            <div className="mx-auto bg-primary/10 p-4 rounded-full w-fit mb-4">
              <ShieldCheck className="h-10 w-10 text-primary" />
            </div>
            <CardTitle className="text-3xl font-bold tracking-tight">OPEC OpsFlow</CardTitle>
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
            <CardFooter className="flex flex-col gap-3">
              <Button type="submit" className="w-full h-12 text-lg font-bold" disabled={isLoggingIn}>
                {isLoggingIn ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : null}
                เข้าสู่ระบบ
              </Button>
              <Dialog open={isRegDialogOpen} onOpenChange={setIsRegDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="w-full h-11 font-semibold gap-2"><UserPlus className="h-4 w-4" /> ลงทะเบียนเข้าใช้งาน</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>ลงทะเบียนพนักงานใหม่</DialogTitle></DialogHeader>
                  <div className="space-y-4 py-4">
                    <Label>ชื่อ-นามสกุล</Label>
                    <Input value={regDisplayName} onChange={e => setRegDisplayName(e.target.value)} />
                    <Label>อีเมล</Label>
                    <Input type="email" value={regEmail} onChange={e => setRegEmail(e.target.value)} />
                    <Label>รหัสผ่าน</Label>
                    <Input type="password" value={regPassword} onChange={e => setRegPassword(e.target.value)} />
                    <Label>ยืนยันรหัสผ่าน</Label>
                    <Input type="password" value={regConfirmPassword} onChange={e => setRegConfirmPassword(e.target.value)} />
                  </div>
                  <DialogFooter><Button onClick={handleRegister} disabled={isRegistering} className="w-full">ยืนยันการลงทะเบียน</Button></DialogFooter>
                </DialogContent>
              </Dialog>
              <Button variant="ghost" size="sm" className="w-full mt-2 text-xs opacity-50" asChild>
                <Link href="/setup-admin"><Settings2 className="h-3 w-3 mr-2" /> กู้คืนสิทธิ์บัญชี (Repair)</Link>
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    );
  }

  const dashboardPerms = can('overview_dashboard');

  if ((!dashboardPerms.view && !isPermLoading && !isAdminUser(user)) || isDocLoading) {
    return (
      <AppShell user={user} onLogout={handleLogout}>
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-6">
          {isDocLoading ? (
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-12 w-12 text-primary animate-spin" />
              <p className="text-muted-foreground font-medium">กำลังตรวจสอบสิทธิ์ล่าสุดจากระบบ...</p>
            </div>
          ) : (
            <>
              <ShieldAlert className="h-16 w-16 text-destructive opacity-50" />
              <div className="space-y-2">
                <h2 className="text-2xl font-black text-primary uppercase">Access Pending</h2>
                <p className="text-muted-foreground max-w-md mx-auto">บัญชีของคุณยังไม่ได้รับการกำหนดโปรไฟล์การเข้าถึง หรือสิทธิ์ในระบบความปลอดภัย (Security Rules) ยังไม่สมบูรณ์</p>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-lg">
                <Card className="border-amber-200 bg-amber-50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-bold flex items-center gap-2"><Wrench className="h-4 w-4" /> สำหรับผู้ดูแลระบบ</CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs text-left text-amber-800">
                    หากคุณคือ Admin แต่เห็นหน้านี้ แสดงว่า UID ของคุณยังไม่ได้ผูกกับบทบาท System Admin ใน Firestore
                  </CardContent>
                  <CardFooter>
                    <Button variant="outline" className="w-full bg-white border-amber-300 text-amber-700 font-bold" asChild>
                      <Link href="/setup-admin">Repair My Access</Link>
                    </Button>
                  </CardFooter>
                </Card>
                
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-bold flex items-center gap-2"><Info className="h-4 w-4" /> สำหรับพนักงาน</CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs text-left text-muted-foreground">
                    กรุณาแจ้งฝ่าย IT หรือ HR Manager เพื่อเปิดสิทธิ์การใช้งานตามแผนกและระดับของคุณ
                  </CardContent>
                  <CardFooter>
                    <Button variant="ghost" className="w-full text-[10px]" onClick={handleLogout}>Logout and retry</Button>
                  </CardFooter>
                </Card>
              </div>
            </>
          )}
        </div>
      </AppShell>
    );
  }

  const stats = {
    revenue: assignments?.filter(a => a.deploymentStatus === 'ACTIVE').length || 0,
    activeWorkers: workers?.filter(w => w.workerStatus === 'assigned').length || 0,
    activeContracts: contracts?.filter(c => c.status === 'active').length || 0,
    pendingApprovals: assignments?.filter(a => a.clientApprovalStatus === 'SUBMITTED').length || 0
  };

  return (
    <AppShell user={user} onLogout={handleLogout}>
      <div className="space-y-8 max-w-[1600px] mx-auto font-body">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold text-primary tracking-tight">แดชบอร์ดภาพรวม (Dashboard)</h1>
          <p className="text-muted-foreground text-lg">
            ยินดีต้อนรับกลับมา, {user.displayName}
          </p>
        </div>

        {dept === 'client' ? (
          <Alert className="bg-blue-50 border-blue-200">
            <Info className="h-4 w-4 text-blue-600" />
            <AlertTitle className="font-bold">Portal Information</AlertTitle>
            <AlertDescription>คุณสามารถตรวจสอบสถานะคนงานและการอนุมัติได้ที่เมนู <b>Client Portal</b></AlertDescription>
          </Alert>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <StatCard title="Active Assignments" value={stats.revenue} sub="Workers On-site" icon={HardHat} colorClass="border-l-blue-600" />
            <StatCard title="Total Assigned" value={stats.activeWorkers} sub="Personnel in Waves" icon={Users} colorClass="border-l-orange-500" />
            <StatCard title="Active Contracts" value={stats.activeContracts} sub="Master Agreements" icon={Briefcase} colorClass="border-l-emerald-600" />
            <StatCard title="Pending Client Review" value={stats.pendingApprovals} sub="Wait for Approval" icon={Activity} colorClass="border-l-red-500" />
          </div>
        )}
      </div>
    </AppShell>
  );
}

function StatCard({ title, value, sub, icon: Icon, colorClass }: any) {
  return (
    <Card className={`hover:shadow-lg transition-all border-l-8 ${colorClass} shadow-sm`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</CardTitle>
        <Icon className="h-5 w-5 opacity-50" />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-black text-primary">{value}</div>
        <p className="text-xs font-medium text-muted-foreground mt-1">{sub}</p>
      </CardContent>
    </Card>
  );
}
