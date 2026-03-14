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
  CircleDollarSign,
  Clock,
  TrendingUp,
  Activity,
  HardHat,
  ArrowRight,
  ShieldAlert,
  Info,
  Loader2,
  KeyRound,
  UserCheck,
  Settings2
} from 'lucide-react';
import { useFirestore, useAuth, useUser, useCollection, useMemoFirebase } from '@/firebase';
import { signInWithEmailAndPassword, sendPasswordResetEmail, createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, collectionGroup, updateDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isBootstrapped, setIsBootstrapped] = useState<boolean | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Registration States
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

  useEffect(() => {
    setIsLoaded(true);
    const stored = localStorage.getItem('opsflow_user');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // Normalize role structure if needed
        if (parsed.roleId && !parsed.roleIds) parsed.roleIds = [parsed.roleId];
        setUser(parsed);
        
        // Update presence
        if (firestore && parsed.id) {
          updateDoc(doc(firestore, 'users', parsed.id), {
            lastLoginAt: Date.now()
          }).catch(console.error);
        }
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

  // Authorization Guard for Dashboard Data
  const isInternalStaff = useMemo(() => {
    return user && user.department !== 'client';
  }, [user]);

  const contractsQuery = useMemoFirebase(() => (firestore && isInternalStaff ? collection(firestore, 'main_contracts') : null), [firestore, isInternalStaff]);
  const { data: contracts } = useCollection<MainContract>(contractsQuery as any);

  const workersQuery = useMemoFirebase(() => (firestore && isInternalStaff ? collection(firestore, 'workers') : null), [firestore, isInternalStaff]);
  const { data: workers } = useCollection<Worker>(workersQuery as any);

  const assignmentsQuery = useMemoFirebase(() => (firestore && isInternalStaff ? collectionGroup(firestore, 'assignments') : null), [firestore, isInternalStaff]);
  const { data: assignments } = useCollection<Assignment>(assignmentsQuery as any);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const userDocRef = doc(firestore!, 'users', cred.user.uid);
      const userDoc = await getDoc(userDocRef);
      
      if (userDoc.exists()) {
        const userData = userDoc.data() as User;
        
        if (!userData.isActive) {
          toast({ 
            variant: "destructive", 
            title: "บัญชีรอนุมัติ (Pending Approval)", 
            description: "บัญชีของคุณยังไม่ได้รับการอนุมัติการใช้งาน กรุณาติดต่อผู้ดูแลระบบ" 
          });
          setIsLoggingIn(false);
          return;
        }

        // Migration helper: ensure roleIds exists
        if (!userData.roleIds) {
          userData.roleIds = [(userData as any).roleId || 'hr_officer'];
        }

        await updateDoc(userDocRef, { lastLoginAt: Date.now() });
        setUser(userData);
        localStorage.setItem('opsflow_user', JSON.stringify(userData));
        toast({ title: "เข้าสู่ระบบสำเร็จ" });
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
    if (!regEmail || !regPassword || !regConfirmPassword || !regDisplayName) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณากรอกข้อมูลให้ครบถ้วน" });
      return;
    }
    if (regPassword !== regConfirmPassword) {
      toast({ variant: "destructive", title: "รหัสผ่านไม่ตรงกัน" });
      return;
    }

    setIsRegistering(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, regEmail, regPassword);
      const uid = cred.user.uid;
      
      const now = Date.now();
      const newUser: Partial<User> = {
        id: uid,
        email: regEmail,
        displayName: regDisplayName,
        department: 'hr', // Default
        level: 'viewer',  // Default
        roleIds: [], 
        isActive: false,
        createdAt: now,
        updatedAt: now
      };

      await setDoc(doc(firestore!, 'users', uid), newUser);
      
      toast({ 
        title: "ลงทะเบียนสำเร็จ", 
        description: "บัญชีรอนุมัติสิทธิ์เข้าใช้งานจากผู้ดูแลระบบ" 
      });
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
      <div className="flex items-center justify-center min-h-screen bg-slate-50 p-4">
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
              
              <div className="relative w-full py-2">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                <div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-2 text-muted-foreground">หรือ</span></div>
              </div>

              <Dialog open={isRegDialogOpen} onOpenChange={setIsRegDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="w-full h-11 font-semibold gap-2">
                    <UserPlus className="h-4 w-4" /> ลงทะเบียนเข้าใช้งาน
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>ลงทะเบียนพนักงานใหม่</DialogTitle>
                    <DialogDescription>ข้อมูลของคุณจะถูกตรวจสอบโดย Admin ก่อนเปิดใช้งาน</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>ชื่อ-นามสกุล</Label>
                      <Input value={regDisplayName} onChange={e => setRegDisplayName(e.target.value)} placeholder="เช่น สมชาย สายชล" />
                    </div>
                    <div className="space-y-2">
                      <Label>อีเมลพนักงาน</Label>
                      <Input type="email" value={regEmail} onChange={e => setRegEmail(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>รหัสผ่าน</Label>
                      <Input type="password" value={regPassword} onChange={e => setRegPassword(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>ยืนยันรหัสผ่าน</Label>
                      <Input type="password" value={regConfirmPassword} onChange={e => setRegConfirmPassword(e.target.value)} />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button onClick={handleRegister} disabled={isRegistering} className="w-full font-bold">
                      ยืนยันการลงทะเบียน
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Button variant="ghost" size="sm" className="w-full mt-2 text-xs opacity-50" asChild>
                <Link href="/setup-admin"><Settings2 className="h-3 w-3 mr-2" /> กู้คืนสิทธิ์บัญชี (System Recovery)</Link>
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    );
  }

  // Statistics Calculation
  const stats = {
    revenue: assignments?.filter(a => a.deploymentStatus === 'ACTIVE').length || 0,
    activeWorkers: workers?.filter(w => w.workerStatus === 'assigned').length || 0,
    activeContracts: contracts?.filter(c => c.status === 'active').length || 0,
    pendingApprovals: assignments?.filter(a => a.clientApprovalStatus === 'SUBMITTED').length || 0
  };

  return (
    <AppShell user={user} onLogout={handleLogout}>
      <div className="space-y-8 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold text-primary tracking-tight">แดชบอร์ดภาพรวม (Operations Dashboard)</h1>
          <p className="text-muted-foreground text-lg">
            {user.department === 'client' ? `Customer Portal: ${user.displayName}` : `Department: ${user.department.toUpperCase()} | Access: ${user.level.toUpperCase()}`}
          </p>
        </div>

        {user.department === 'client' ? (
          <Alert className="bg-blue-50 border-blue-200">
            <Info className="h-4 w-4 text-blue-600" />
            <AlertTitle className="font-bold">Welcome to Client Portal</AlertTitle>
            <AlertDescription>
              คุณสามารถตรวจสอบสถานะคนงานที่ได้รับมอบหมายและพิจารณาอนุมัติ Candidate ได้ในเมนู Client Portal
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              <StatCard title="Active Assignments" value={stats.revenue} sub="Workers On-site" icon={HardHat} colorClass="border-l-blue-600" />
              <StatCard title="Total Assigned" value={stats.activeWorkers} sub="Personnel in Waves" icon={Users} colorClass="border-l-orange-500" />
              <StatCard title="Active Contracts" value={stats.activeContracts} sub="Master Agreements" icon={Briefcase} colorClass="border-l-emerald-600" />
              <StatCard title="Pending Client Review" value={stats.pendingApprovals} sub="Wait for Approval" icon={Activity} colorClass="border-l-red-500" />
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5" /> Staffing Activity</CardTitle>
                  <CardDescription>การเคลื่อนไหวของคนงานรายสัปดาห์</CardDescription>
                </CardHeader>
                <CardContent className="h-[300px] flex items-center justify-center text-muted-foreground italic bg-muted/10 rounded-md m-6 border-dashed border-2">
                  [Chart Placeholder]
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5" /> Recent Actions</CardTitle>
                  <CardDescription>รายการล่าสุดที่เกิดขึ้นในระบบ</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-4 border rounded-lg hover:bg-muted/10 transition-colors flex items-center justify-between">
                    <div className="flex gap-3 items-center">
                      <div className="bg-blue-100 p-2 rounded-full text-blue-600"><UserPlus className="h-4 w-4" /></div>
                      <div>
                        <p className="font-bold text-sm">New Candidates submitted</p>
                        <p className="text-xs text-muted-foreground">รอการพิจารณา {stats.pendingApprovals} ราย</p>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" asChild><Link href="/assignments"><ArrowRight className="h-4 w-4" /></Link></Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
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
