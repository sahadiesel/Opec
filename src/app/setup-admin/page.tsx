
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ShieldAlert, Lock, Mail, User, RefreshCw, UserCheck, CheckCircle2, Shield } from 'lucide-react';
import { useFirestore, useAuth, useUser } from '@/firebase';
import { doc, getDoc, setDoc, collection, getDocs, limit, query } from 'firebase/firestore';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
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
  });

  const { user: firebaseUser } = useUser();
  const [repairUid, setRepairUid] = useState('');
  const [repairRole, setRepairRole] = useState('system_admin');

  const router = useRouter();
  const firestore = useFirestore();
  const auth = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (firebaseUser) {
      setRepairUid(firebaseUser.uid);
    }
  }, [firebaseUser]);

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

      if (userCredential.user) {
        await updateProfile(userCredential.user, { displayName: formData.displayName });
      }

      const now = Date.now();
      const adminData = {
        id: uid,
        email: formData.email,
        displayName: formData.displayName,
        roleIds: ['system_admin'],
        department: 'admin',
        level: 'admin',
        permissionProfileKey: 'admin_admin',
        approvalStatus: 'ACTIVE',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };

      await setDoc(doc(firestore, 'users', uid), adminData);
      await setDoc(doc(firestore, 'roles_system_admin', uid), { assignedAt: now });
      await setDoc(doc(firestore, 'system', 'bootstrap'), { initializedAt: now, initializedBy: uid });

      toast({ title: "ตั้งค่าระบบสำเร็จ", description: "บัญชี System Admin ถูกสร้างเรียบร้อยแล้ว" });
      localStorage.removeItem('opsflow_user');
      router.push('/');
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRepair = async () => {
    if (!firestore || !repairUid) return;
    setIsSubmitting(true);
    try {
      const now = Date.now();
      const isSystemAdmin = repairRole === 'system_admin';
      
      const repairData: any = {
        id: repairUid,
        roleIds: [repairRole],
        isActive: true,
        approvalStatus: 'ACTIVE',
        updatedAt: now
      };

      if (isSystemAdmin) {
        repairData.department = 'admin';
        repairData.level = 'admin';
        repairData.permissionProfileKey = 'admin_admin';
      } else if (repairRole.startsWith('hr_')) {
        repairData.department = 'hr';
        repairData.level = repairRole.includes('manager') ? 'manager' : 'officer';
        repairData.permissionProfileKey = `${repairData.department}_${repairData.level}`;
      }

      await setDoc(doc(firestore, 'users', repairUid), repairData, { merge: true });
      await setDoc(doc(firestore, `roles_${repairRole}`, repairUid), { assignedAt: now }, { merge: true });

      toast({ title: "ซ่อมแซมสิทธิ์สำเร็จ", description: `บัญชีได้รับการปรับปรุงเป็น ${repairRole} แล้ว` });
      localStorage.removeItem('opsflow_user');
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isChecking) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="h-12 w-12 text-primary animate-spin" />
          <p className="text-muted-foreground">กำลังตรวจสอบสถานะระบบ...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-muted/30 p-4 font-body">
      <Card className="w-full max-w-lg shadow-2xl border-t-8 border-t-primary">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto bg-primary/10 p-4 rounded-full w-fit mb-2">
            <ShieldAlert className="h-10 w-10 text-primary" />
          </div>
          <CardTitle className="text-3xl font-bold">System Recovery</CardTitle>
          <CardDescription>จัดการการตั้งค่าระบบและกู้คืนบัญชีแอดมิน</CardDescription>
        </CardHeader>
        
        <Tabs defaultValue={isBootstrapped ? "repair" : "setup"} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="setup" disabled={isBootstrapped}>1. Setup Admin</TabsTrigger>
            <TabsTrigger value="repair">2. Account Repair</TabsTrigger>
          </TabsList>
          
          <TabsContent value="setup">
            <form onSubmit={handleSetup}>
              <CardContent className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label>ชื่อ-นามสกุล</Label>
                  <Input placeholder="Admin Name" value={formData.displayName} onChange={(e) => setFormData({ ...formData, displayName: e.target.value })} required />
                </div>
                <div className="space-y-2">
                  <Label>อีเมลใช้งาน</Label>
                  <Input type="email" placeholder="admin@opec.com" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} required />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>รหัสผ่าน</Label>
                    <Input type="password" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} required minLength={8} />
                  </div>
                  <div className="space-y-2">
                    <Label>ยืนยันรหัสผ่าน</Label>
                    <Input type="password" value={formData.confirmPassword} onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })} required minLength={8} />
                  </div>
                </div>
              </CardContent>
              <CardFooter>
                <Button type="submit" className="w-full h-12 font-bold" disabled={isSubmitting}>
                  {isSubmitting ? 'กำลังดำเนินการ...' : 'สร้างบัญชีแอดมิน'}
                </Button>
              </CardFooter>
            </form>
          </TabsContent>

          <TabsContent value="repair">
            <CardContent className="space-y-4 pt-4">
              <Alert className="bg-amber-50 border-amber-200">
                <Shield className="h-4 w-4 text-amber-600" />
                <AlertTitle className="text-amber-800 font-bold">Fix Permission Denied</AlertTitle>
                <AlertDescription className="text-amber-700 text-xs">
                  หากคุณล็อกอินแล้วแต่ไม่มีสิทธิ์เข้าใช้งาน ให้ระบุ UID ของคุณและเลือกบทบาท System Admin เพื่อซ่อมแซมสิทธิ์ในระบบฐานข้อมูล
                </AlertDescription>
              </Alert>
              
              <div className="space-y-2">
                <Label>UID ผู้ใช้งานที่ต้องการซ่อมแซม</Label>
                <Input value={repairUid} onChange={e => setRepairUid(e.target.value)} placeholder="User UID" className="font-mono text-xs" />
                {firebaseUser?.uid === repairUid && (
                  <p className="text-[10px] text-green-600 font-bold">✓ ตรวจพบ UID ของคุณที่กำลังล็อกอินอยู่</p>
                )}
              </div>
              
              <div className="space-y-2">
                <Label>บทบาทที่ต้องการกู้คืน</Label>
                <Select value={repairRole} onValueChange={setRepairRole}>
                  <SelectTrigger className="h-11 font-bold">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system_admin">System Admin (สิทธิ์สูงสุด)</SelectItem>
                    <SelectItem value="hr_manager">HR Manager</SelectItem>
                    <SelectItem value="finance_officer">Finance Officer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-2">
              <Button onClick={handleRepair} className="w-full h-12 font-bold bg-primary" disabled={isSubmitting || !repairUid}>
                {isSubmitting ? <RefreshCw className="animate-spin mr-2" /> : <UserCheck className="mr-2" />}
                ซ่อมแซมสิทธิ์บัญชีนี้ (Repair)
              </Button>
              <Button variant="ghost" onClick={() => router.push('/')} className="w-full">กลับไปหน้าหลัก</Button>
            </CardFooter>
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}
