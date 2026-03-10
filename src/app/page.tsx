'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { User, RoleType } from '@/lib/types';
import { Briefcase, Info, AlertTriangle, FileWarning, CheckCircle2, ShieldCheck, ClipboardList, UserPlus, Lock } from 'lucide-react';
import { useFirestore, useAuth, useUser } from '@/firebase';
import { signInAnonymously, signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';

const MOCK_USERS: any[] = [
  { id: '1', email: 'admin@opec.com', displayName: 'System Admin', roleId: 'system_admin', createdAt: Date.now(), isActive: true },
  { id: '2', email: 'sales@opec.com', displayName: 'Sales Officer', roleId: 'sales_officer', createdAt: Date.now(), isActive: true },
  { id: '3', email: 'hrmgr@opec.com', displayName: 'HR Manager', roleId: 'hr_manager', createdAt: Date.now(), isActive: true },
];

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
        console.warn('Bootstrap check failed (likely unauthenticated):', e);
        setIsBootstrapped(false);
      }
    }
    checkBootstrap();
  }, [firestore]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    
    try {
      // 1. Always attempt real Firebase Auth if bootstrapped
      if (isBootstrapped) {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        const userDoc = await getDoc(doc(firestore, 'users', cred.user.uid));
        
        if (userDoc.exists()) {
          const userData = userDoc.data() as User;
          
          // Verify role in roles_system_admin if it's an admin
          if (userData.roleId === 'system_admin') {
            const roleDoc = await getDoc(doc(firestore, 'roles_system_admin', cred.user.uid));
            if (!roleDoc.exists()) {
              throw new Error('Access Denied: Admin role record missing.');
            }
          }

          setUser(userData);
          localStorage.setItem('opsflow_user', JSON.stringify(userData));
          setIsLoggingIn(false);
          return;
        }
      }

      // 2. Fallback to Mock Login for local development/demo
      const found = MOCK_USERS.find(u => u.email === email);
      if (found) {
        if (!firebaseUser) await signInAnonymously(auth);
        setUser(found);
        localStorage.setItem('opsflow_user', JSON.stringify(found));
        toast({ title: "เข้าสู่ระบบสำเร็จ (Mock Mode)" });
      } else {
        throw new Error('ไม่พบข้อมูลผู้ใช้งาน หรือรหัสผ่านไม่ถูกต้อง');
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
        <div className="w-full max-w-md space-y-4">
          <Card className="shadow-xl border-t-4 border-t-primary">
            <CardHeader className="space-y-1 text-center">
              <div className="mx-auto bg-primary/10 p-3 rounded-full w-fit mb-4">
                <Briefcase className="h-8 w-8 text-primary" />
              </div>
              <CardTitle className="text-2xl">OPEC OpsFlow</CardTitle>
              <CardDescription>
                ระบบจัดการกำลังคน OPEC Manpower Supply
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleLogin}>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">อีเมลผู้ใช้งาน</Label>
                  <input 
                    id="email" 
                    type="email" 
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="name@opec.com" 
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">รหัสผ่าน</Label>
                  <input 
                    id="password" 
                    type="password" 
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    required 
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                {!isBootstrapped && isBootstrapped !== null && (
                  <div className="bg-amber-50 p-3 rounded-md border border-amber-200 flex gap-2">
                    <Info className="h-5 w-5 text-amber-600 shrink-0" />
                    <div className="space-y-1">
                      <p className="text-xs text-amber-800 font-bold">ยังไม่ได้ตั้งค่าระบบ</p>
                      <p className="text-xs text-amber-700 leading-tight">กรุณาลงทะเบียนผู้ดูแลระบบคนแรกเพื่อเริ่มต้นใช้งาน</p>
                    </div>
                  </div>
                )}
              </CardContent>
              <CardFooter className="flex flex-col gap-3">
                <Button type="submit" className="w-full h-11 text-lg" disabled={isLoggingIn}>
                  {isLoggingIn ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
                </Button>
                
                {!isBootstrapped && isBootstrapped !== null && (
                  <Button variant="outline" className="w-full gap-2 text-secondary border-secondary" asChild>
                    <Link href="/setup-admin">
                      <UserPlus className="h-4 w-4" /> ลงทะเบียน Admin คนแรก
                    </Link>
                  </Button>
                )}
              </CardFooter>
            </form>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <AppShell user={user} onLogout={handleLogout}>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary">แดชบอร์ดภาพรวม (Overall Dashboard)</h1>
          <p className="text-muted-foreground mt-2">ยินดีต้อนับกลับมา, {user.displayName} ระบบพร้อมสำหรับการจัดการกำลังคนวันนี้</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className="hover:shadow-md transition-shadow border-l-4 border-l-green-500">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">คนงานที่พร้อม (Workers Ready)</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">842</div>
              <p className="text-xs text-muted-foreground">สามารถเข้าปฏิบัติงานได้ทันที</p>
            </CardContent>
          </Card>
          <Card className="hover:shadow-md transition-shadow border-l-4 border-l-amber-500">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">ขาดใบรับรอง (Missing Certs)</CardTitle>
              <FileWarning className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">42</div>
              <p className="text-xs text-muted-foreground">คนงานที่ยังมีเอกสารไม่ครบ</p>
            </CardContent>
          </Card>
          <Card className="hover:shadow-md transition-shadow border-l-4 border-l-destructive">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">การตรวจร่างกายหมดอายุ</CardTitle>
              <AlertTriangle className="h-4 w-4 text-destructive" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">18</div>
              <p className="text-xs text-muted-foreground">ต้องรีบดำเนินการตรวจร่างกาย</p>
            </CardContent>
          </Card>
          <Card className="hover:shadow-md transition-shadow border-l-4 border-l-primary">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">งานที่กำลังมอบหมาย</CardTitle>
              <ClipboardList className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">156</div>
              <p className="text-xs text-muted-foreground">จำนวนงานที่มอบหมาย (Active Assignments)</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
          <Card className="col-span-4">
            <CardHeader>
              <CardTitle>ความพร้อมของคนงานรายโครงการ (Readiness Status)</CardTitle>
              <CardDescription>แสดงสัดส่วนคนงานที่พร้อมปฏิบัติงานตามมาตรฐาน OPEC</CardDescription>
            </CardHeader>
            <CardContent className="h-[300px] flex flex-col items-center justify-center border-2 border-dashed rounded-lg bg-muted/20 space-y-4">
              <ShieldCheck className="h-12 w-12 text-primary opacity-20" />
              <p className="text-muted-foreground">กราฟแสดงผลความพร้อมแบบเรียลไทม์ (Chart Visualization in Phase 1B)</p>
            </CardContent>
          </Card>
          <Card className="col-span-3">
            <CardHeader>
              <CardTitle>รายการอัปเดตล่าสุด (Recent Updates)</CardTitle>
              <CardDescription>กิจกรรมที่เกิดขึ้นล่าสุดในระบบ OpsFlow</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {[
                  { user: 'HR Manager', action: 'อัปเดตใบรับรอง', target: 'สมชาย สายชล', time: '10 นาทีที่แล้ว' },
                  { user: 'HR Officer', action: 'เพิ่มคนงานใหม่', target: 'สมนึก รักดี', time: '1 ชั่วโมงที่แล้ว' },
                  { user: 'Admin', action: 'แก้ไขตำแหน่งงาน', target: 'Offshore Welder', time: '2 ชั่วโมงที่แล้ว' },
                  { user: 'System', action: 'ตรวจสอบความพร้อม', target: 'Batch Job #89', time: '3 ชั่วโมงที่แล้ว' }
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="bg-primary/10 p-2 rounded-full">
                      <Info className="h-4 w-4 text-primary" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium leading-none">{item.action}: {item.target}</p>
                      <p className="text-xs text-muted-foreground">{item.time} โดย {item.user}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
