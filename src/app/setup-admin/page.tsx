
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { ShieldAlert, Briefcase, Lock, Mail, User, CreditCard, Home, RefreshCw, UserCheck, CheckCircle2 } from 'lucide-react';
import { useFirestore, useAuth } from '@/firebase';
import { doc, getDoc, setDoc, collection, getDocs, limit, query } from 'firebase/firestore';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function SetupAdminPage() {
  const [isChecking, setIsChecking] = useState(true);
  const [isBootstrapped, setIsBootstrapped] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    displayName: '',
    email: '',
    password: '',
    confirmPassword: '',
    nationalId: '',
    address: '',
  });

  const [repairUid, setRepairUid] = useState('LHFGKwAx1cNRQsoz6Ix2ZZsN4oH3');
  const [repairRole, setRepairRole] = useState('hr_manager');

  const router = useRouter();
  const firestore = useFirestore();
  const auth = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    async function checkStatus() {
      if (!firestore) return;
      try {
        const bootstrapDoc = await getDoc(doc(firestore, 'system', 'bootstrap'));
        if (bootstrapDoc.exists()) {
          setIsBootstrapped(true);
        } else {
          const q = query(collection(firestore, 'roles_system_admin'), limit(1));
          const snapshot = await getDocs(q);
          if (!snapshot.empty) {
            setIsBootstrapped(true);
          }
        }
      } catch (error) {
        console.error('Error checking bootstrap status:', error);
      } finally {
        setIsChecking(false);
      }
    }
    checkStatus();
  }, [firestore]);

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firestore || !auth) return;

    if (formData.password.length < 8) {
      toast({ variant: "destructive", title: "รหัสผ่านสั้นเกินไป", description: "กรุณากำหนดรหัสผ่านอย่างน้อย 8 ตัวอักษร" });
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      toast({ variant: "destructive", title: "รหัสผ่านไม่ตรงกัน", description: "กรุณากรอกรหัสผ่านทั้งสองช่องให้ตรงกัน" });
      return;
    }

    setIsSubmitting(true);
    try {
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        formData.email,
        formData.password
      );
      const uid = userCredential.user.uid;

      await setDoc(doc(firestore, 'users', uid), {
        id: uid,
        email: formData.email,
        displayName: formData.displayName,
        nationalId: formData.nationalId,
        address: formData.address,
        roleIds: ['system_admin'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isActive: true,
      });

      await setDoc(doc(firestore, 'roles_system_admin', uid), {
        assignedAt: Date.now(),
      });

      await setDoc(doc(firestore, 'system', 'bootstrap'), {
        initializedAt: Date.now(),
        initializedBy: uid,
      });

      toast({
        title: "ตั้งค่าระบบสำเร็จ",
        description: "บัญชี System Admin ถูกสร้างเรียบร้อยแล้ว",
      });

      localStorage.removeItem('opsflow_user');
      router.push('/');
    } catch (error: any) {
      console.error('Setup error:', error);
      toast({
        variant: "destructive",
        title: "เกิดข้อผิดพลาด",
        description: error.message || "ไม่สามารถตั้งค่าระบบได้",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRepair = async () => {
    if (!firestore) return;
    setIsSubmitting(true);
    try {
      // 1. Ensure User document exists and has the correct roleId
      await setDoc(doc(firestore, 'users', repairUid), {
        id: repairUid,
        roleIds: [repairRole],
        isActive: true,
        updatedAt: Date.now()
      }, { merge: true });

      // 2. Ensure the specific role document exists (DBAC)
      await setDoc(doc(firestore, `roles_${repairRole}`, repairUid), {
        assignedAt: Date.now(),
      }, { merge: true });

      toast({
        title: "ซ่อมแซมบัญชีสำเร็จ",
        description: `UID ${repairUid} ถูกกำหนดเป็น ${repairRole} เรียบร้อยแล้ว`,
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "เกิดข้อผิดพลาด",
        description: error.message || "ไม่สามารถซ่อมแซมบัญชีได้",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isChecking) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-4">
          <Briefcase className="h-12 w-12 text-primary animate-pulse" />
          <p className="text-muted-foreground">กำลังตรวจสอบสถานะระบบ...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-muted/30 p-4">
      <Card className="w-full max-w-lg shadow-2xl border-t-8 border-t-primary">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto bg-primary/10 p-4 rounded-full w-fit mb-2">
            <ShieldAlert className="h-10 w-10 text-primary" />
          </div>
          <CardTitle className="text-3xl font-bold">System Maintenance & Setup</CardTitle>
          <CardDescription>
            จัดการการตั้งค่าระบบและกู้คืนบัญชีผู้ใช้งาน
          </CardDescription>
        </CardHeader>
        
        <Tabs defaultValue={isBootstrapped ? "repair" : "setup"} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="setup" disabled={isBootstrapped}>1. Setup Admin</TabsTrigger>
            <TabsTrigger value="repair">2. Account Recovery</TabsTrigger>
          </TabsList>
          
          <TabsContent value="setup">
            <form onSubmit={handleSetup}>
              <CardContent className="space-y-4 pt-4">
                <div className="grid gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="displayName" className="flex items-center gap-2"><User className="h-4 w-4" /> ชื่อ-นามสกุล</Label>
                    <Input id="displayName" placeholder="ระบุชื่อจริง" value={formData.displayName} onChange={(e) => setFormData({ ...formData, displayName: e.target.value })} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email" className="flex items-center gap-2"><Mail className="h-4 w-4" /> อีเมลใช้งาน</Label>
                    <Input id="email" type="email" placeholder="admin@opec.com" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} required />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="password">กำหนดรหัสผ่าน</Label>
                      <Input id="password" type="password" placeholder="8+ ตัวอักษร" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} required minLength={8} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="confirmPassword">ยืนยันรหัสผ่าน</Label>
                      <Input id="confirmPassword" type="password" value={formData.confirmPassword} onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })} required minLength={8} />
                    </div>
                  </div>
                </div>
              </CardContent>
              <CardFooter>
                <Button type="submit" className="w-full h-12 font-bold" disabled={isSubmitting}>
                  {isSubmitting ? 'กำลังดำเนินการ...' : 'เริ่มต้นระบบ (Setup)'}
                </Button>
              </CardFooter>
            </form>
          </TabsContent>

          <TabsContent value="repair">
            <CardContent className="space-y-4 pt-4">
              <Alert className="bg-amber-50 border-amber-200">
                <ShieldAlert className="h-4 w-4 text-amber-600" />
                <AlertTitle className="text-amber-800 font-bold">Account Recovery Mode</AlertTitle>
                <AlertDescription className="text-amber-700 text-xs">
                  ใช้สำหรับแก้ไขปัญหาพนักงานล็อกอินแล้วเจอ Permission Error เนื่องจากเอกสาร Role หายไป หรือสิทธิ์ไม่ตรงกัน
                </AlertDescription>
              </Alert>
              
              <div className="space-y-2">
                <Label>User UID</Label>
                <Input value={repairUid} onChange={e => setRepairUid(e.target.value)} placeholder="ป้อน UID ของพนักงาน" className="font-mono text-xs" />
              </div>
              
              <div className="space-y-2">
                <Label>บทบาทที่ต้องการมอบหมาย (Role to Assign)</Label>
                <Select value={repairRole} onValueChange={setRepairRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system_admin">System Admin</SelectItem>
                    <SelectItem value="hr_manager">HR Manager</SelectItem>
                    <SelectItem value="hr_officer">HR Officer</SelectItem>
                    <SelectItem value="finance_officer">Finance Officer</SelectItem>
                    <SelectItem value="operations_officer">Operations Officer</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="p-3 border rounded bg-muted/20 text-[10px] space-y-1">
                <p className="font-bold text-muted-foreground uppercase tracking-widest">ดำเนินการดังนี้:</p>
                <ul className="list-disc pl-4 text-muted-foreground">
                  <li>ตรวจสอบและสร้างเอกสาร /users/{repairUid}</li>
                  <li>สร้างเอกสารยืนยันสิทธิ์ /roles_{repairRole}/{repairUid}</li>
                  <li>ตั้งค่าสถานะบัญชีให้เป็น Active ทันที</li>
                </ul>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-2">
              <Button onClick={handleRepair} className="w-full h-12 font-bold bg-primary shadow-lg" disabled={isSubmitting || !repairUid}>
                {isSubmitting ? <RefreshCw className="animate-spin mr-2" /> : <UserCheck className="mr-2" />}
                ซ่อมแซมและยืนยันสิทธิ์ (Repair Account)
              </Button>
              <Button variant="ghost" onClick={() => router.push('/')} className="w-full">กลับไปหน้าล็อกอิน</Button>
            </CardFooter>
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}
