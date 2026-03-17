'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { User, MainContract, Worker, Assignment, DeptType, AccessLevel, BillingNote } from '@/lib/types';
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
  Wrench,
  AlertTriangle,
  FileText
} from 'lucide-react';
import { useFirestore, useAuth, useUser, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
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
import { UI_LABELS } from '@/lib/constants/labels';
import { HELP_TEXTS } from '@/lib/constants/help-texts';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function Home() {
  const router = useRouter();
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

  // Sync state with underlying Firebase Auth status
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
    if (isDocLoading) return false;
    if (!latestUserDoc) return false;
    
    if (isAdminUser(latestUserDoc)) return true;
    if (!latestUserDoc.isActive) return false;
    if (latestUserDoc.approvalStatus !== 'ACTIVE') return false;
    
    const { dept } = inferDeptAndLevel(latestUserDoc);
    if (dept === 'client') return false;
    
    return true;
  }, [latestUserDoc, isDocLoading]);

  const { dept } = useMemo(() => {
    if (!latestUserDoc) return { dept: 'hr' as DeptType, level: 'viewer' as AccessLevel };
    return inferDeptAndLevel(latestUserDoc);
  }, [latestUserDoc]);

  // Permission-aware query guards
  const canReadContracts = isInternalAuthorized; // Based on firestore.rules, signed in users can read
  const canReadWorkers = isInternalAuthorized && (isAdminUser(latestUserDoc) || ['admin', 'hr', 'operations'].includes(dept));
  const canReadMobs = isInternalAuthorized && (isAdminUser(latestUserDoc) || ['admin', 'hr', 'operations', 'sales'].includes(dept));
  const canReadFinance = isInternalAuthorized && (isAdminUser(latestUserDoc) || ['accounting', 'sales'].includes(dept));

  const contractsQuery = useMemoFirebase(() => (firestore && canReadContracts ? collection(firestore, 'main_contracts') : null), [firestore, canReadContracts]);
  const { data: contracts } = useCollection<MainContract>(contractsQuery as any);

  const workersQuery = useMemoFirebase(() => (firestore && canReadWorkers ? collection(firestore, 'workers') : null), [firestore, canReadWorkers]);
  const { data: workers } = useCollection<Worker>(workersQuery as any);

  const mobilizationQuery = useMemoFirebase(() => (firestore && canReadMobs ? collection(firestore, 'mobilizations') : null), [firestore, canReadMobs]);
  const { data: assignments } = useCollection<Assignment>(mobilizationQuery as any);

  const billingNotesQuery = useMemoFirebase(() => (firestore && canReadFinance ? collection(firestore, 'billing_notes') : null), [firestore, canReadFinance]);
  const { data: billingNotes } = useCollection<BillingNote>(billingNotesQuery as any);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const userDocRef = doc(firestore!, 'users', cred.user.uid);
      const userDoc = await getDoc(userDocRef);
      
      if (userDoc.exists()) {
        const userData = userDoc.data() as User;
        if (userData.approvalStatus === 'SUSPENDED' || userData.approvalStatus === 'REJECTED' || (!userData.isActive && !isAdminUser(userData))) {
          toast({ variant: "destructive", title: "Access Restricted", description: "บัญชีของคุณยังไม่อนุญาตให้เข้าใช้งาน" });
          setIsLoggingIn(false);
          return;
        }
        await updateDoc(userDocRef, { lastLoginAt: Date.now() });
        setUser(userData);
        localStorage.setItem('opsflow_user', JSON.stringify(userData));
        toast({ title: "เข้าสู่ระบบสำเร็จ" });
      } else {
        toast({ variant: "destructive", title: "Profile Required", description: "ตรวจพบไอดีแต่ไม่พบข้อมูลสิทธิ์ กรุณาติดต่อแอดมิน" });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Login Failed", description: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
    } finally { setIsLoggingIn(false); }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.error(e);
    }
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
            </CardFooter>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <AppShell user={user} onLogout={handleLogout}>
      <div className="space-y-8 max-w-[1600px] mx-auto font-body">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold text-primary tracking-tight">{UI_LABELS.DASHBOARD}</h1>
          <p className="text-muted-foreground text-lg">
            {HELP_TEXTS.DASHBOARD}
          </p>
        </div>

        {/* Access Restricted Warning */}
        {!isInternalAuthorized && !isDocLoading && (
          <Alert variant="destructive" className="bg-destructive/5 border-destructive/20 border-l-8 border-l-destructive">
            <ShieldAlert className="h-6 w-6" />
            <AlertTitle className="font-bold text-lg mb-2">Access Pending (รอนุมัติสิทธิ์เข้าใช้งาน)</AlertTitle>
            <AlertDescription className="space-y-4">
              <p className="text-base">บัญชีของคุณยังไม่ได้รับการกำหนดบทบาทหรือยังไม่ได้รับการอนุมัติให้เข้าใช้งานส่วนงานภายใน (Internal Modules)</p>
              <div className="flex flex-wrap gap-3">
                <Button variant="outline" className="gap-2 bg-white" onClick={() => router.push('/setup-admin')}>
                  <Wrench className="h-4 w-4" /> กู้คืนสิทธิ์แอดมิน (Repair Admin)
                </Button>
                <Button variant="ghost" className="gap-2" onClick={handleLogout}>
                  ออกจากระบบ
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {isInternalAuthorized ? (
          <>
            {dept === 'client' ? (
              <Alert className="bg-blue-50 border-blue-200">
                <Info className="h-4 w-4 text-blue-600" />
                <AlertTitle className="font-bold">Portal Information</AlertTitle>
                <AlertDescription>คุณสามารถตรวจสอบสถานะคนงานและการอนุมัติได้ที่เมนู <b>Client Portal</b></AlertDescription>
              </Alert>
            ) : (
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                {/* Always show Contracts if authorized */}
                <StatCard title="Active Contracts" value={contracts?.filter(c => c.status === 'active').length || 0} sub="Master Agreements" icon={Briefcase} colorClass="border-l-emerald-600" />
                
                {/* Role-specific cards */}
                {canReadWorkers && (
                  <StatCard title="Total Manpower" value={workers?.length || 0} sub="Registered Workers" icon={Users} colorClass="border-l-orange-500" />
                )}

                {canReadMobs && (
                  <>
                    <StatCard title="Active Assignments" value={assignments?.filter(a => a.deploymentStatus === 'ACTIVE').length || 0} sub="Workers On-site" icon={HardHat} colorClass="border-l-blue-600" />
                    <StatCard title="Pending Review" value={assignments?.filter(a => a.deploymentStatus === 'CLIENT_SUBMITTED').length || 0} sub="Wait for Approval" icon={Activity} colorClass="border-l-red-500" />
                  </>
                )}

                {canReadFinance && !canReadWorkers && (
                  <>
                    <StatCard title="Billing Notes" value={billingNotes?.filter(n => n.status !== 'PAID').length || 0} sub="Open Invoices" icon={FileText} colorClass="border-l-blue-600" />
                    <StatCard title="Pending Approval" value={billingNotes?.filter(n => n.status === 'DRAFT').length || 0} sub="Draft Billings" icon={Activity} colorClass="border-l-amber-500" />
                  </>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="py-20 text-center space-y-4 bg-muted/10 rounded-xl border-2 border-dashed">
            <Loader2 className="h-12 w-12 mx-auto text-primary/20 animate-spin" />
            <p className="text-muted-foreground italic">กำลังตรวจสอบสิทธิ์การเข้าถึงข้อมูลล่าสุด...</p>
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