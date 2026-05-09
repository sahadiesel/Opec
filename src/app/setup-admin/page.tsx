/**
 * @fileOverview OPEC OpsFlow - System Bootstrap & Admin Recovery
 * Corrects and backfills system administrator authorization fields.
 * Includes baseline profile synchronization to ensure permissions docs exist.
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ShieldAlert, RefreshCw, UserCheck, CheckCircle2, Shield, Wrench, Loader2, Zap } from 'lucide-react';
import { useFirestore, useAuth, useUser } from '@/firebase';
import { doc, getDoc, setDoc, collection, getDocs, limit, query, writeBatch } from 'firebase/firestore';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { buildAuthorizationForRepairRole } from '@/lib/auth-mapping';
import { getBaselineProfiles } from '@/lib/permissions';
import { getBusinessRoleKeysSortedForSelect, getRoleCatalogEntry } from '@/lib/roles/role-catalog';
import { sanitizeFirestorePayload } from '@/lib/utils';

export default function SetupAdminPage() {
  const [isChecking, setIsChecking] = useState(true);
  const [isBootstrapped, setIsBootstrapped] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  
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

  /**
   * Bulk ensures all standard permission profiles exist in the DB.
   * This prevents "Profile Not Found" errors after user login.
   */
  const ensureEnvironmentProfiles = async () => {
    if (!firestore) return;
    const batch = writeBatch(firestore);
    const baselines = getBaselineProfiles();
    let created = 0;

    for (const p of baselines) {
      const key = p.profileKey!;
      const profileRef = doc(firestore, 'permission_profiles', key);
      batch.set(profileRef, {
        ...p,
        id: key,
        updatedAt: Date.now(),
        updatedBy: 'System Bootstrap Tool',
      }, { merge: true });
      created++;
    }

    await batch.commit();
    return created;
  };

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
      // 1. Create Baseline Environment (Profiles) first
      await ensureEnvironmentProfiles();

      // 2. Create the Auth Identity
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
      const authPayload = buildAuthorizationForRepairRole('system_admin');
      
      const adminData = {
        ...authPayload,
        id: uid,
        email: formData.email,
        displayName: formData.displayName,
        approvalStatus: 'ACTIVE' as const,
        isActive: true,
        userType: 'internal',
        createdAt: now,
        updatedAt: now,
      };

      // 3. Set User Doc and Bootstrap metadata
      await setDoc(doc(firestore, 'users', uid), sanitizeFirestorePayload(adminData));
      await setDoc(doc(firestore, 'roles_system_admin', uid), { assignedAt: now });
      await setDoc(doc(firestore, 'system', 'bootstrap'), { initializedAt: now, initializedBy: uid });

      toast({ title: "ตั้งค่าระบบสำเร็จ", description: "บัญชี System Admin และโปรไฟล์สิทธิ์ถูกสร้างเรียบร้อยแล้ว" });
      localStorage.removeItem('opsflow_user');
      router.push('/');
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRepair = async () => {
    if (!firestore || !repairUid) {
      toast({ variant: "destructive", title: "UID Missing", description: "กรุณาระบุ UID ของผู้ใช้งาน" });
      return;
    }
    setIsSubmitting(true);
    try {
      // 1. Always ensure profiles exist when repairing an admin
      if (repairRole === 'system_admin') {
        await ensureEnvironmentProfiles();
      }

      const now = Date.now();
      const authPayload = buildAuthorizationForRepairRole(repairRole);

      const repairData: Record<string, unknown> = {
        ...authPayload,
        id: repairUid,
        isActive: true,
        approvalStatus: 'ACTIVE',
        userType: 'internal',
        updatedAt: now,
      };

      await setDoc(doc(firestore, 'users', repairUid), sanitizeFirestorePayload(repairData), { merge: true });
      
      if (repairRole === 'system_admin') {
        await setDoc(doc(firestore, 'roles_system_admin', repairUid), { assignedAt: now }, { merge: true });
      }

      toast({ title: "ซ่อมแซมสิทธิ์สำเร็จ", description: `บัญชีได้รับการปรับปรุงเป็น ${repairRole} แล้ว` });
      localStorage.removeItem('opsflow_user');
      setTimeout(() => router.push('/'), 2000);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInitializeEnv = async () => {
    if (!firestore) return;
    setIsInitializing(true);
    try {
      const count = await ensureEnvironmentProfiles();
      toast({ title: "Environment Initialized", description: `Created/Updated ${count} permission profiles.` });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Init Failed", description: e.message });
    } finally {
      setIsInitializing(false);
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

          <TabsContent value="repair" className="space-y-4">
            <CardContent className="space-y-4 pt-4">
              <Alert className="bg-amber-50 border-amber-200">
                <Wrench className="h-4 w-4 text-amber-600" />
                <AlertTitle className="text-amber-800 font-bold">Fix Permission Denied</AlertTitle>
                <AlertDescription className="text-amber-700 text-xs leading-relaxed">
                  หากคุณเป็น Admin แต่พบข้อผิดพลาดขณะดึง Profile สิทธิ์ ให้เลือก UID ของคุณแล้วกดปุ่มด้านล่างเพื่อซ่อมแซมฟิลด์สิทธิ์และสร้าง Profile เอกสารให้ใหม่
                </AlertDescription>
              </Alert>
              
              <div className="space-y-2">
                <Label className="font-bold">UID ผู้ใช้งานที่ต้องการซ่อมแซม</Label>
                <Input value={repairUid} onChange={e => setRepairUid(e.target.value)} placeholder="User UID" className="font-mono text-xs" />
                {firebaseUser?.uid === repairUid ? (
                  <p className="text-[10px] text-green-600 font-bold flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> ตรวจพบ UID ของคุณที่กำลังล็อกอินอยู่
                  </p>
                ) : (
                  <p className="text-[10px] text-muted-foreground italic">กรุณาระบุ UID จาก Error Log หากไม่ใช่ตัวคุณ</p>
                )}
              </div>
              
              <div className="space-y-2">
                <Label className="font-bold">บทบาทที่ต้องการกู้คืน (Target Role)</Label>
                <Select value={repairRole} onValueChange={setRepairRole}>
                  <SelectTrigger className="h-11 font-bold font-mono text-sm normal-case">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-[min(70vh,440px)] overflow-y-auto">
                    {getBusinessRoleKeysSortedForSelect().map((key) => {
                      const meta = getRoleCatalogEntry(key);
                      return (
                        <SelectItem key={key} value={key} className="font-mono text-xs normal-case">
                          <span className="font-mono">{key}</span>
                          {meta ? (
                            <span className="text-muted-foreground ml-2 font-sans text-xs">
                              — {meta.displayNameTh}
                            </span>
                          ) : null}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              <div className="pt-2">
                <Button 
                  variant="outline" 
                  className="w-full h-10 border-blue-200 text-blue-700 hover:bg-blue-50 gap-2"
                  onClick={handleInitializeEnv}
                  disabled={isInitializing}
                >
                  {isInitializing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                  Initialize Permission Profiles (Baseline)
                </Button>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-2">
              <Button onClick={handleRepair} className="w-full h-12 font-black bg-primary text-lg shadow-lg" disabled={isSubmitting || !repairUid}>
                {isSubmitting ? <Loader2 className="animate-spin mr-2 h-5 w-5" /> : <UserCheck className="mr-2" />}
                ซ่อมแซมสิทธิ์บัญชีนี้ (Apply Repair)
              </Button>
              <Button variant="ghost" onClick={() => router.push('/')} className="w-full">กลับไปหน้าหลัก</Button>
            </CardFooter>
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}
