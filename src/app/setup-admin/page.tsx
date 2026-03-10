'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { ShieldAlert, Briefcase, Lock, Mail, User, CreditCard, Home } from 'lucide-react';
import { useFirestore, useAuth } from '@/firebase';
import { doc, getDoc, setDoc, collection, getDocs, limit, query } from 'firebase/firestore';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { useToast } from '@/hooks/use-toast';

export default function SetupAdminPage() {
  const [isChecking, setIsChecking] = useState(true);
  const [isBootstrapped, setIsBootstrapped] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    displayName: '',
    email: '',
    password: '',
    nationalId: '',
    address: '',
  });

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
          router.push('/');
        } else {
          const q = query(collection(firestore, 'roles_system_admin'), limit(1));
          const snapshot = await getDocs(q);
          if (!snapshot.empty) {
            setIsBootstrapped(true);
            router.push('/');
          }
        }
      } catch (error) {
        console.error('Error checking bootstrap status:', error);
      } finally {
        setIsChecking(false);
      }
    }
    checkStatus();
  }, [firestore, router]);

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firestore || !auth) return;

    setIsSubmitting(true);
    try {
      // 1. Create Auth User
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        formData.email,
        formData.password
      );
      const uid = userCredential.user.uid;

      // 2. Create User Profile with requested fields
      await setDoc(doc(firestore, 'users', uid), {
        id: uid,
        email: formData.email,
        displayName: formData.displayName,
        nationalId: formData.nationalId,
        address: formData.address,
        roleId: 'system_admin',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isActive: true,
      });

      // 3. Assign Role (DBAC structure)
      await setDoc(doc(firestore, 'roles_system_admin', uid), {
        assignedAt: Date.now(),
      });

      // 4. Mark system as bootstrapped
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

  if (isBootstrapped) return null;

  return (
    <div className="flex items-center justify-center min-h-screen bg-muted/30 p-4">
      <Card className="w-full max-w-lg shadow-2xl border-t-8 border-t-primary">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto bg-primary/10 p-4 rounded-full w-fit mb-2">
            <ShieldAlert className="h-10 w-10 text-primary" />
          </div>
          <CardTitle className="text-3xl font-bold">ลงทะเบียนผู้ดูแลระบบคนแรก</CardTitle>
          <CardDescription className="text-lg">
            กรุณากรอกข้อมูลเพื่อเริ่มต้นใช้งานระบบ OPEC OpsFlow
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSetup}>
          <CardContent className="space-y-4">
            <div className="grid gap-4">
              <div className="space-y-2">
                <Label htmlFor="displayName" className="flex items-center gap-2">
                  <User className="h-4 w-4" /> ชื่อ-นามสกุล
                </Label>
                <Input
                  id="displayName"
                  placeholder="ระบุชื่อ-นามสกุลจริง"
                  value={formData.displayName}
                  onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nationalId" className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4" /> เลขบัตรประชาชน
                </Label>
                <Input
                  id="nationalId"
                  placeholder="เลขบัตรประชาชน 13 หลัก"
                  value={formData.nationalId}
                  onChange={(e) => setFormData({ ...formData, nationalId: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email" className="flex items-center gap-2">
                  <Mail className="h-4 w-4" /> อีเมลใช้งาน
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@opec.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="address" className="flex items-center gap-2">
                  <Home className="h-4 w-4" /> ที่อยู่
                </Label>
                <Textarea
                  id="address"
                  placeholder="ระบุที่อยู่ปัจจุบัน"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="flex items-center gap-2">
                  <Lock className="h-4 w-4" /> กำหนดรหัสผ่าน
                </Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="อย่างน้อย 6 ตัวอักษร"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  required
                  minLength={6}
                />
              </div>
            </div>
            
            <div className="bg-amber-50 p-4 rounded-lg border border-amber-200 flex gap-3 mt-2">
              <ShieldAlert className="h-5 w-5 text-amber-600 shrink-0" />
              <p className="text-xs text-amber-800 leading-relaxed">
                <b>คำเตือน:</b> คุณกำลังสร้างบัญชีผู้ดูแลระบบสูงสุด ข้อมูลเหล่านี้จะถูกบันทึกเป็นฐานข้อมูลพนักงานคนแรกของระบบ
              </p>
            </div>
          </CardContent>
          <CardFooter>
            <Button 
              type="submit" 
              className="w-full h-12 text-lg font-semibold" 
              disabled={isSubmitting}
            >
              {isSubmitting ? 'กำลังสร้างบัญชี...' : 'ลงทะเบียนและเริ่มต้นระบบ'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
