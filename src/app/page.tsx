'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { User } from '@/lib/types';
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
  Building2,
  KeyRound,
  Lock,
  UserPlus,
  MailQuestion,
} from 'lucide-react';
import { useFirestore, useAuth, useUser, useDoc, useMemoFirebase } from '@/firebase';
import {
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  sendPasswordResetEmail,
  createUserWithEmailAndPassword,
  deleteUser,
} from 'firebase/auth';
import { doc, getDoc, getDocFromServer, updateDoc, setDoc } from 'firebase/firestore';
import { sanitizeFirestorePayload } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { BUSINESS_ROLES, deriveBusinessRoleKey } from '@/lib/auth-mapping';
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
import {
  normalizeCurrentUserPermissions,
  isSystemAdmin,
  isStoreOfficer,
  canSeeHrPillarUi,
  canSeeSalesPillarUi,
  canSeeOperationsPillarUi,
  canSeeStorePillarUi,
  canSeeAccountingPillarUi,
} from '@/lib/permissions';
import type { ReactNode } from 'react';
import { PoStaffingQueueCard } from '@/components/dashboard/po-staffing-queue-card';

/** Same Storage image as login form — keep all pre-dashboard full-screen states visually consistent. */
const LOGIN_BG_URL = PlaceHolderImages.find((img) => img.id === 'login-bg')?.imageUrl ?? '';

function LoginStageBackdrop({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-sky-100 p-4"
      data-ai-hint="offshore oil rig"
    >
      {LOGIN_BG_URL ? (
        <div
          className="pointer-events-none absolute inset-0 z-0 bg-cover bg-top bg-no-repeat brightness-[1.08] saturate-[1.12] contrast-[1.02]"
          style={{ backgroundImage: `url(${LOGIN_BG_URL})` }}
          aria-hidden
        />
      ) : null}
      {/* เบาลงมากจากเดิม — คง vignette นิดหน่อยให้การ์ดอ่านง่าย ไม่กลบสีต้นฉบับ */}
      <div
        className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-b from-slate-900/15 via-transparent to-slate-900/20"
        aria-hidden
      />
      {children}
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  /** ถ้า Firebase Auth ไม่ตอบ (เครือข่าย/VPN) ไม่ให้ค้างที่ "กำลังเตรียมระบบ" ตลอดไป */
  const [authBootstrapTimedOut, setAuthBootstrapTimedOut] = useState(false);
  const [authSlowHint, setAuthSlowHint] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Password Reset State
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [isResetting, setIsResetting] = useState(false);

  const [showForgotPasswordDialog, setShowForgotPasswordDialog] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [isSendingResetEmail, setIsSendingResetEmail] = useState(false);

  const [showRegisterDialog, setShowRegisterDialog] = useState(false);
  const [regDisplayName, setRegDisplayName] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regPasswordConfirm, setRegPasswordConfirm] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  /** After self-registration: show confirmation on login shell until user dismisses */
  const [registrationSuccessEmail, setRegistrationSuccessEmail] = useState<string | null>(null);
  /** True while handleSelfRegister runs — avoids useEffect(PENDING) toast/logout racing the submit handler */
  const selfRegisterInProgressRef = useRef(false);
  /** True from synchronous start of handleLogin until its finally — avoids useDoc firing cached PENDING before getDoc finishes */
  const loginInProgressRef = useRef(false);

  const firestore = useFirestore();
  const auth = useAuth();
  const { user: firebaseUser, isUserLoading, userError } = useUser();
  const { toast } = useToast();
  
  const userDocRef = useMemoFirebase(() => (firestore && firebaseUser ? doc(firestore, 'users', firebaseUser.uid) : null), [firestore, firebaseUser]);
  const { data: rawUserDoc, isLoading: isDocLoading, isDataFromCache: isUserDocFromCache } =
    useDoc<User>(userDocRef as any);

  // Normalize user doc as soon as it arrives
  const latestUserDoc = useMemo(() => {
    return rawUserDoc ? normalizeCurrentUserPermissions(rawUserDoc) : null;
  }, [rawUserDoc]);

  useEffect(() => {
    const t = window.setTimeout(() => setAuthSlowHint(true), 12_000);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const escape = window.setTimeout(() => setAuthBootstrapTimedOut(true), 12_000);
    return () => window.clearTimeout(escape);
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) {
      try {
        // Try to normalize cached data too
        const parsed = JSON.parse(stored);
        setUser(normalizeCurrentUserPermissions(parsed));
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
      if (latestUserDoc.userType !== 'customer_portal' && latestUserDoc.approvalStatus === 'PENDING') {
        if (selfRegisterInProgressRef.current || loginInProgressRef.current) {
          return;
        }
        if (isUserDocFromCache) {
          return;
        }
        toast({
          title: 'รอการอนุมัติจากผู้ดูแลระบบ',
          description: 'บัญชีของคุณยังไม่ได้รับการอนุมัติหรือกำหนดสิทธิ์ — โปรดรอแอดมินดำเนินการที่เมนูจัดการผู้ใช้',
        });
        handleLogout();
        return;
      }
      // Security Guard: Check inactivity
      if (!latestUserDoc.isActive || latestUserDoc.approvalStatus === 'SUSPENDED') {
        toast({ variant: "destructive", title: "Access Blocked", description: "บัญชีของคุณถูกระงับการใช้งาน" });
        handleLogout();
        return;
      }

      // Customer Portal Redirect
      if (latestUserDoc.userType === 'customer_portal') {
        router.push('/client-portal/dashboard');
      }

      if (
        latestUserDoc.userType !== 'customer_portal' &&
        isStoreOfficer(latestUserDoc) &&
        !latestUserDoc.mustResetPassword
      ) {
        router.replace('/store');
      }

      // Security Guard: Forced Password Reset
      if (latestUserDoc.mustResetPassword) {
        setShowResetDialog(true);
      }

      // Sync State and Cache with Normalized Data
      setUser(latestUserDoc);
      localStorage.setItem('opsflow_user', JSON.stringify(latestUserDoc));
    }
  }, [latestUserDoc, router, isUserDocFromCache]);

  const isInternalAuthorized = useMemo(() => {
    if (isDocLoading || !latestUserDoc) return false;
    return latestUserDoc.isActive && latestUserDoc.approvalStatus === 'ACTIVE';
  }, [latestUserDoc, isDocLoading]);

  const { check, profile } = usePermissions(latestUserDoc ?? user);

  const u = latestUserDoc ?? user;
  const showHrUi = useMemo(() => canSeeHrPillarUi(u, profile), [u, profile]);
  const showSalesUi = useMemo(() => canSeeSalesPillarUi(u, profile), [u, profile]);
  const showOpsUi = useMemo(() => canSeeOperationsPillarUi(u, profile), [u, profile]);
  const showStoreUi = useMemo(() => canSeeStorePillarUi(u, profile), [u, profile]);
  const showAccountingUi = useMemo(() => canSeeAccountingPillarUi(u, profile), [u, profile]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    loginInProgressRef.current = true;
    setIsLoggingIn(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const docRef = doc(firestore!, 'users', cred.user.uid);
      let snap = await getDocFromServer(docRef).catch(() => getDoc(docRef));
      
      if (snap.exists()) {
        const userData = normalizeCurrentUserPermissions(snap.data());
        if (!userData) throw new Error("Invalid user data");
        
        // 1. Pending approval (internal)
        if (userData.userType !== 'customer_portal' && userData.approvalStatus === 'PENDING') {
          toast({
            title: 'รอการอนุมัติ',
            description: 'บัญชียังไม่ได้รับการอนุมัติหรือกำหนดสิทธิ์จากผู้ดูแลระบบ — ใช้งานได้หลังแอดมินอนุมัติแล้ว',
          });
          await signOut(auth);
          setIsLoggingIn(false);
          return;
        }
        // 2. Check Activity Status
        if (!userData.isActive || userData.approvalStatus === 'SUSPENDED' || userData.approvalStatus === 'REJECTED') {
          toast({ variant: "destructive", title: "Access Restricted", description: "บัญชีของคุณถูกระงับการใช้งาน (Account Inactive)" });
          await signOut(auth);
          setIsLoggingIn(false);
          return;
        }

        // 3. Log login time
        await updateDoc(docRef, { lastLoginAt: Date.now() });

        // 4. Handle First-time reset detection
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
          } else if (isStoreOfficer(userData)) {
            router.push('/store');
          }
        }
      } else {
        await signOut(auth);
        toast({
          variant: 'destructive',
          title: 'ไม่พบข้อมูลผู้ใช้ในระบบ',
          description: 'บัญชีนี้ยังไม่มีโปรไฟล์ใน Firestore — ติดต่อผู้ดูแลระบบหรือลงทะเบียนผู้ใช้ใหม่',
        });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Login Failed", description: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
    } finally {
      loginInProgressRef.current = false;
      setIsLoggingIn(false);
    }
  };

  const handleSendPasswordResetEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const addr = forgotEmail.trim();
    if (!addr) {
      toast({ variant: 'destructive', title: 'กรอกอีเมล', description: 'ระบุอีเมลที่ใช้ลงทะเบียน' });
      return;
    }
    setIsSendingResetEmail(true);
    try {
      await sendPasswordResetEmail(auth, addr);
      toast({
        title: 'ส่งลิงก์รีเซ็ตรหัสผ่านแล้ว',
        description: 'ตรวจสอบกล่องจดหมาย (และโฟลเดอร์สแปม) แล้วคลิกลิงก์จาก Firebase เพื่อตั้งรหัสผ่านใหม่',
      });
      setShowForgotPasswordDialog(false);
      setForgotEmail('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'ส่งไม่สำเร็จ';
      toast({ variant: 'destructive', title: 'ส่งอีเมลไม่สำเร็จ', description: msg });
    } finally {
      setIsSendingResetEmail(false);
    }
  };

  const handleSelfRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firestore || !auth) return;
    const name = regDisplayName.trim();
    const phone = regPhone.trim();
    const em = regEmail.trim();
    if (!name || !phone || !em) {
      toast({ variant: 'destructive', title: 'ข้อมูลไม่ครบ', description: 'กรอกชื่อ เบอร์โทร และอีเมล' });
      return;
    }
    if (regPassword.length < 8) {
      toast({ variant: 'destructive', title: 'รหัสผ่านสั้นเกินไป', description: 'อย่างน้อย 8 ตัวอักษร' });
      return;
    }
    if (regPassword !== regPasswordConfirm) {
      toast({ variant: 'destructive', title: 'รหัสผ่านไม่ตรงกัน', description: 'กรอกยืนยันรหัสผ่านให้ตรงกัน' });
      return;
    }

    const withTimeout = <T,>(promise: Promise<T>, ms: number, timeoutMsg: string): Promise<T> =>
      Promise.race([
        promise,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(timeoutMsg)), ms)),
      ]);

    let newUid: string | null = null;
    selfRegisterInProgressRef.current = true;
    setIsRegistering(true);
    try {
      const cred = await withTimeout(
        createUserWithEmailAndPassword(auth, em, regPassword),
        90_000,
        'การสร้างบัญชีหมดเวลา — ตรวจสอบการเชื่อมต่อแล้วลองใหม่'
      );
      newUid = cred.user.uid;
      const now = Date.now();
      const newUser: User = {
        id: newUid,
        email: em,
        displayName: name,
        phone,
        userType: 'internal',
        department: 'operations',
        level: 'viewer',
        roleIds: [],
        isActive: false,
        approvalStatus: 'PENDING',
        createdAt: now,
        updatedAt: now,
      };
      await withTimeout(
        setDoc(doc(firestore, 'users', newUid), sanitizeFirestorePayload(newUser)),
        45_000,
        'บันทึกข้อมูลในระบบหมดเวลา — ตรวจสอบเน็ตหรือ deploy กฎ Firestore ล่าสุด'
      );
      try {
        await signOut(auth);
      } catch {
        /* non-fatal */
      }
      setUser(null);
      localStorage.removeItem('opsflow_user');
      setShowRegisterDialog(false);
      setRegDisplayName('');
      setRegPhone('');
      setRegEmail('');
      setRegPassword('');
      setRegPasswordConfirm('');
      setRegistrationSuccessEmail(em);
      toast({
        title: 'ส่งคำขอลงทะเบียนแล้ว',
        description: 'รอผู้ดูแลระบบอนุมัติและกำหนดสิทธิ์ที่เมนูจัดการผู้ใช้ — จากนั้นจึงเข้าสู่ระบบด้วยอีเมลนี้ได้',
      });
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      const lower = raw.toLowerCase();
      if (newUid && auth.currentUser?.uid === newUid) {
        try {
          await deleteUser(auth.currentUser);
        } catch {
          /* ลบใน Auth ไม่สำเร็จ — ให้แอดมินจัดการใน Console */
        }
      }
      let description = raw;
      if (lower.includes('permission') || lower.includes('insufficient')) {
        description =
          'ไม่มีสิทธิ์บันทึกโปรไฟล์ใน Firestore (กฎความปลอดภัย) — อีเมลอาจถูกสร้างใน Auth ชั่วคราวแล้วถูกลบอัตโนมัติ กรุณาลองใหม่หลัง deploy กฎ หรือติดต่อผู้ดูแลระบบ';
      } else if (lower.includes('email-already') || lower.includes('already in use')) {
        description = 'อีเมลนี้ลงทะเบียนในระบบแล้ว — ลองเข้าสู่ระบบ หรือใช้อีเมลอื่น';
      }
      toast({ variant: 'destructive', title: 'ลงทะเบียนไม่สำเร็จ', description });
    } finally {
      selfRegisterInProgressRef.current = false;
      setIsRegistering(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!auth.currentUser || !latestUserDoc) return;
    if (newPassword !== confirmNewPassword) {
      toast({ variant: "destructive", title: "Validation Error", description: "รหัสผ่านไม่ตรงกัน" });
      return;
    }
    if (newPassword.length < 8) {
      toast({ variant: "destructive", title: "Weak Password", description: "รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร" });
      return;
    }

    setIsResetting(true);
    try {
      await updatePassword(auth.currentUser, newPassword);
      const userRef = doc(firestore!, 'users', latestUserDoc.id);
      await updateDoc(userRef, { 
        mustResetPassword: false,
        updatedAt: Date.now()
      });
      setShowResetDialog(false);
      toast({ title: "Password Updated", description: "เปลี่ยนรหัสผ่านเรียบร้อยแล้ว" });
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

  if (isUserLoading && !authBootstrapTimedOut) {
    return (
      <LoginStageBackdrop>
        <div className="relative z-10 flex max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-sm text-white/85">กำลังเตรียมระบบ…</p>
          {authSlowHint && (
            <p className="text-xs text-white/60">
              ถ้ารอนานเกินไป: ตรวจว่ารัน <span className="font-mono">npm run dev</span> ตามพอร์ตในเทอร์มินัล (ค่าเริ่มต้น 9003) แล้วลองรีเฟรช
              (Ctrl+Shift+R) หรือตรวจเครือข่าย / VPN
            </p>
          )}
        </div>
      </LoginStageBackdrop>
    );
  }

  // Wait for Firestore user profile after Firebase Auth (avoid flashing wrong UI)
  if (firebaseUser && isDocLoading) {
    return (
      <LoginStageBackdrop>
        <div className="relative z-10 flex items-center justify-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>
      </LoginStageBackdrop>
    );
  }

  const profileMissing = Boolean(firebaseUser && !isDocLoading && !rawUserDoc);
  const internalNotActive = Boolean(
    latestUserDoc &&
    latestUserDoc.userType !== 'customer_portal' &&
    (latestUserDoc.approvalStatus !== 'ACTIVE' || latestUserDoc.isActive === false)
  );
  const portalNotActive = Boolean(
    latestUserDoc &&
    latestUserDoc.userType === 'customer_portal' &&
    (latestUserDoc.approvalStatus !== 'ACTIVE' || latestUserDoc.isActive === false)
  );

  const mustShowLoginShell =
    !firebaseUser || profileMissing || internalNotActive || portalNotActive;

  // Login / register shell (never show main dashboard for inactive or missing profile)
  if (mustShowLoginShell) {
    return (
      <LoginStageBackdrop>
        <Card className="relative z-10 w-full max-w-md border-t-8 border-t-primary bg-white shadow-2xl">
          <CardHeader className="space-y-1 text-center">
            {userError && (
              <Alert variant="destructive" className="mb-4 text-left">
                <AlertTitle>เชื่อมต่อระบบไม่สำเร็จ</AlertTitle>
                <AlertDescription className="text-sm">
                  {userError.message}
                </AlertDescription>
              </Alert>
            )}
            {authBootstrapTimedOut && isUserLoading && !userError && (
              <Alert className="mb-4 text-left border-amber-200 bg-amber-50 text-amber-950">
                <AlertTitle>กำลังเชื่อมต่อ Firebase…</AlertTitle>
                <AlertDescription className="text-sm">
                  ระบบยังไม่ได้สถานะล็อกอินภายในเวลาที่กำหนด — ลองรีเฟรช (Ctrl+Shift+R) หรือตรวจอินเทอร์เน็ต / VPN / ไฟร์วอลล์
                </AlertDescription>
              </Alert>
            )}
            <div className="mx-auto bg-primary/10 p-4 rounded-full w-fit mb-4">
              <ShieldCheck className="h-10 w-10 text-primary" />
            </div>
            <CardTitle className="text-3xl font-bold tracking-tight text-primary">OPEC OpsFlow</CardTitle>
            <CardDescription className="text-base font-medium">Enterprise Manpower Supply Operations</CardDescription>
            {registrationSuccessEmail && (
              <Alert className="mt-4 text-left border-green-200 bg-green-50 text-green-900">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertTitle className="text-green-900 font-bold">ลงทะเบียนแล้ว — รออนุมัติ</AlertTitle>
                <AlertDescription className="text-sm text-green-800 space-y-2">
                  <p>
                    ส่งคำขอสำหรับ <span className="font-mono font-semibold">{registrationSuccessEmail}</span> แล้ว
                    ผู้ดูแลระบบจะอนุมัติและกำหนดสิทธิ์ที่เมนู <b>จัดการผู้ใช้งาน</b> (แท็บรออนุมัติ)
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    className="mt-1 bg-green-700 hover:bg-green-800"
                    onClick={() => setRegistrationSuccessEmail(null)}
                  >
                    เข้าใจแล้ว — ไปหน้าเข้าสู่ระบบ
                  </Button>
                </AlertDescription>
              </Alert>
            )}
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
            <CardFooter className="flex flex-col gap-1">
              <Button type="submit" className="w-full h-12 text-lg font-bold shadow-lg bg-primary" disabled={isLoggingIn}>
                {isLoggingIn ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : null}
                เข้าสู่ระบบ
              </Button>
              <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 justify-center text-sm pt-2 w-full">
                <button
                  type="button"
                  className="text-primary font-semibold hover:underline inline-flex items-center justify-center gap-1"
                  onClick={() => {
                    setForgotEmail(email);
                    setShowForgotPasswordDialog(true);
                  }}
                >
                  <MailQuestion className="h-3.5 w-3.5" />
                  ลืมรหัสผ่าน
                </button>
                <span className="hidden sm:inline text-muted-foreground">|</span>
                <button
                  type="button"
                  className="text-primary font-semibold hover:underline inline-flex items-center justify-center gap-1"
                  onClick={() => {
                    setRegistrationSuccessEmail(null);
                    setShowRegisterDialog(true);
                  }}
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  ลงทะเบียนผู้ใช้ใหม่
                </button>
              </div>
            </CardFooter>
          </form>
        </Card>

        <Dialog open={showForgotPasswordDialog} onOpenChange={setShowForgotPasswordDialog}>
          <DialogContent className="sm:max-w-md border-t-8 border-t-primary">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">ลืมรหัสผ่าน</DialogTitle>
              <DialogDescription>
                ระบุอีเมลที่ใช้ลงทะเบียน — Firebase จะส่งลิงก์รีเซ็ตรหัสผ่านไปที่อีเมลนี้ (ตรวจสอบโฟลเดอร์สแปมด้วย)
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSendPasswordResetEmail} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="forgot-email">อีเมล</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  placeholder="name@company.com"
                  required
                  className="h-11"
                />
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button type="button" variant="outline" onClick={() => setShowForgotPasswordDialog(false)}>
                  ยกเลิก
                </Button>
                <Button type="submit" disabled={isSendingResetEmail}>
                  {isSendingResetEmail ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  ส่งลิงก์รีเซ็ต
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={showRegisterDialog} onOpenChange={setShowRegisterDialog}>
          <DialogContent className="sm:max-w-lg border-t-8 border-t-primary max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">ลงทะเบียนผู้ใช้ใหม่</DialogTitle>
              <DialogDescription>
                กรอกข้อมูลให้ครบ — หลังลงทะเบียน ผู้ดูแลระบบจะอนุมัติและกำหนดบทบาทที่เมนูจัดการผู้ใช้ ก่อนจึงจะเข้าสู่ระบบได้
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSelfRegister} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="reg-name">ชื่อ-นามสกุล</Label>
                <Input
                  id="reg-name"
                  value={regDisplayName}
                  onChange={(e) => setRegDisplayName(e.target.value)}
                  required
                  className="h-11"
                  autoComplete="name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reg-phone">เบอร์โทร</Label>
                <Input
                  id="reg-phone"
                  type="tel"
                  value={regPhone}
                  onChange={(e) => setRegPhone(e.target.value)}
                  required
                  className="h-11"
                  autoComplete="tel"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reg-email">อีเมล (ใช้ login)</Label>
                <Input
                  id="reg-email"
                  type="email"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  required
                  className="h-11"
                  autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reg-pw">รหัสผ่าน (อย่างน้อย 8 ตัว)</Label>
                <Input
                  id="reg-pw"
                  type="password"
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  required
                  minLength={8}
                  className="h-11"
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reg-pw2">ยืนยันรหัสผ่าน</Label>
                <Input
                  id="reg-pw2"
                  type="password"
                  value={regPasswordConfirm}
                  onChange={(e) => setRegPasswordConfirm(e.target.value)}
                  required
                  minLength={8}
                  className="h-11"
                  autoComplete="new-password"
                />
              </div>
              <DialogFooter className="gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setShowRegisterDialog(false)}>
                  ยกเลิก
                </Button>
                <Button type="submit" disabled={isRegistering}>
                  {isRegistering ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  ส่งคำขอลงทะเบียน
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </LoginStageBackdrop>
    );
  }

  if (!latestUserDoc) {
    return (
      <LoginStageBackdrop>
        <div className="relative z-10 flex items-center justify-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>
      </LoginStageBackdrop>
    );
  }

  // Home / Dashboard Content (use central helper for primary role)
  const primaryRoleKey = deriveBusinessRoleKey(latestUserDoc);
  const roleInfo = BUSINESS_ROLES[primaryRoleKey];
  const primaryDept = roleInfo?.dept;
  const allDepts = primaryDept ? [primaryDept] : (latestUserDoc.department ? [latestUserDoc.department] : []);

  return (
    <AppShell user={latestUserDoc} onLogout={handleLogout}>
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
                  <CardTitle className="text-3xl font-black text-primary">{latestUserDoc.displayName}</CardTitle>
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
                <p className="text-[10px] font-black text-slate-400 uppercase mb-1">สิทธิ์การเข้าถึง (Access Scope)</p>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  {allDepts.length > 0 ? allDepts.map(d => (
                    <Badge key={d} variant="secondary" className="capitalize font-black flex items-center gap-1 bg-blue-50 text-blue-700 border-blue-100">
                      <Building2 className="h-2.5 w-2.5" /> {d}
                    </Badge>
                  )) : <Badge variant="outline">{latestUserDoc.department}</Badge>}
                  <span className="text-muted-foreground text-xs mx-1">/</span>
                  <Badge variant="outline" className="capitalize font-bold border-primary/20">{roleInfo?.level ?? latestUserDoc.level}</Badge>
                </div>
                {roleInfo?.descriptionTh && (
                  <p className="text-[11px] text-muted-foreground mt-2 leading-snug">{roleInfo.descriptionTh}</p>
                )}
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
              {showHrUi && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-white/10 hover:bg-white/20 transition-colors cursor-pointer group" onClick={() => router.push('/hr/dashboard')}>
                  <div className="flex items-center gap-3">
                    <Users className="h-4 w-4" />
                    <span className="text-sm font-medium">ตรวจงาน HR Dashboard</span>
                  </div>
                  <ChevronRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-all" />
                </div>
              )}
              {showSalesUi && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-white/10 hover:bg-white/20 transition-colors cursor-pointer group" onClick={() => router.push('/sales/dashboard')}>
                  <div className="flex items-center gap-3">
                    <TrendingUp className="h-4 w-4" />
                    <span className="text-sm font-medium">ตรวจงาน Sales Dashboard</span>
                  </div>
                  <ChevronRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-all" />
                </div>
              )}
              {showAccountingUi && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-white/10 hover:bg-white/20 transition-colors cursor-pointer group" onClick={() => router.push('/accounting/dashboard')}>
                  <div className="flex items-center gap-3">
                    <Coins className="h-4 w-4" />
                    <span className="text-sm font-medium">ตรวจงาน Accounting Dashboard</span>
                  </div>
                  <ChevronRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-all" />
                </div>
              )}
              {showOpsUi && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-white/10 hover:bg-white/20 transition-colors cursor-pointer group" onClick={() => router.push('/operations/dashboard')}>
                  <div className="flex items-center gap-3">
                    <HardHat className="h-4 w-4" />
                    <span className="text-sm font-medium">ตรวจงาน Operations Dashboard</span>
                  </div>
                  <ChevronRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-all" />
                </div>
              )}
              {isSystemAdmin(latestUserDoc) && (
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

        <PoStaffingQueueCard
          enabled={
            showHrUi ||
            showOpsUi ||
            check('customer_pos', 'view') ||
            isSystemAdmin(latestUserDoc)
          }
        />

        {/* Action Grid */}
        <div className="space-y-6">
          <div className="flex items-center gap-2">
            <LayoutGrid className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold text-primary">ทางลัดตามบทบาท (Role Command)</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {showHrUi && (
              <>
                {(check('office_staff', 'view') || check('office_payroll', 'view')) && (
                  <ShortcutGroup title="HR — Office Payroll" icon={Building2} color="border-l-indigo-600">
                    {check('office_staff', 'view') && (
                      <ShortcutLink href="/office-staff" label="ทะเบียนพนักงานออฟฟิศ" sub="รายเดือน · ไม่ใช้ timesheet รายวัน" />
                    )}
                    {check('office_payroll', 'view') && (
                      <ShortcutLink href="/office-payroll" label="งวดจ่ายเงินเดือนออฟฟิศ" sub="Office payroll run" />
                    )}
                  </ShortcutGroup>
                )}
                {(check('workers', 'view') ||
                  check('timesheets', 'view') ||
                  check('worker_payroll', 'view')) && (
                  <ShortcutGroup title="HR — Worker Payroll" icon={HardHat} color="border-l-amber-600">
                    {check('workers', 'view') && (
                      <ShortcutLink href="/workers" label="ทะเบียนลูกจ้าง" sub="Timesheet + batch" />
                    )}
                    {check('timesheets', 'view') && (
                      <>
                        <ShortcutLink href="/timesheets/wave-board" label="คีย์ลงเวลา (Wave)" sub="Worker timesheet" />
                        <ShortcutLink href="/timesheets/daily" label="ตรวจ Timesheet รายวัน" sub="ประวัติรายวัน" />
                      </>
                    )}
                    {check('worker_payroll', 'view') && (
                      <>
                        <ShortcutLink href="/payroll/periods" label="รอบจ่ายและตัดยอด" sub="งวดคนงาน" />
                        <ShortcutLink href="/payroll/batches" label="งวดจ่ายลูกจ้าง" sub="Payroll batches" />
                      </>
                    )}
                  </ShortcutGroup>
                )}
                {(check('hr_hub', 'view') || check('positions', 'view') || check('workers', 'view')) && (
                  <ShortcutGroup title="HR — ภาพรวมและตั้งค่า" icon={Users} color="border-l-orange-500">
                    {check('hr_hub', 'view') && (
                      <ShortcutLink href="/hr/settings" label="ตั้งค่า HR" sub="ภาษี · ประกันสังคม" />
                    )}
                    {check('positions', 'view') && (
                      <ShortcutLink href="/positions" label="ตำแหน่งงาน" sub="Positions" />
                    )}
                    {(check('worker_documents', 'view') || check('workers', 'view')) && (
                      <ShortcutLink href="/worker-document-catalog" label="เอกสารกลาง" sub="Document catalog" />
                    )}
                  </ShortcutGroup>
                )}
              </>
            )}

            {showSalesUi && (
              <ShortcutGroup title="ฝ่ายขาย (Sales)" icon={Briefcase} color="border-l-blue-600">
                {check('customers', 'view') && (
                  <ShortcutLink href="/customers" label="ทะเบียนลูกค้า" sub="Customers" />
                )}
                {check('main_contracts', 'view') && (
                  <ShortcutLink href="/main-contracts" label="สัญญาหลัก" sub="Contracts" />
                )}
                {check('customer_pos', 'view') && (
                  <ShortcutLink href="/purchase-orders" label="ใบสั่งซื้อลูกค้า" sub="POs" />
                )}
              </ShortcutGroup>
            )}

            {showOpsUi && (
              <ShortcutGroup title="ฝ่ายปฏิบัติการ (Ops)" icon={HardHat} color="border-l-emerald-600">
                {check('waves', 'view') && <ShortcutLink href="/waves" label="กลุ่มงาน (Waves)" sub="Waves" />}
                {check('assignments', 'view') && (
                  <ShortcutLink href="/assignments" label="มอบหมายงาน" sub="Assignments" />
                )}
                {check('mobilization', 'view') && (
                  <ShortcutLink href="/mobilization" label="เตรียมส่งตัว" sub="Mobilization" />
                )}
              </ShortcutGroup>
            )}

            {showAccountingUi && (
              <ShortcutGroup title="บัญชีและการเงิน (Finance)" icon={Coins} color="border-l-purple-600">
                {check('billing_notes', 'view') && (
                  <ShortcutLink href="/billing-notes" label="ใบวางบิล" sub="Billing" />
                )}
                {check('cashbook', 'view') && (
                  <ShortcutLink href="/cashbook" label="รายรับรายจ่าย" sub="Cashbook" />
                )}
                {check('ap_bills', 'view') && (
                  <ShortcutLink href="/ap-bills" label="รับวางบิลเจ้าหนี้" sub="AP Bills" />
                )}
              </ShortcutGroup>
            )}

            {showStoreUi && (
              <ShortcutGroup title="คลังและจัดซื้อ (Store)" icon={Warehouse} color="border-l-amber-500">
                {check('store_inventory', 'view') && (
                  <ShortcutLink href="/store" label="คลังอุปกรณ์" sub="Inventory" />
                )}
                {check('vendors', 'view') && <ShortcutLink href="/vendors" label="ทะเบียนคู่ค้า" sub="Vendors" />}
                {check('purchases', 'view') && (
                  <ShortcutLink href="/purchases" label="การสั่งซื้อ" sub="Purchases" />
                )}
              </ShortcutGroup>
            )}
          </div>
        </div>

        {/* Restricted Access Warning */}
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
