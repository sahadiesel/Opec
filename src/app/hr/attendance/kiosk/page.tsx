'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { doc, setDoc } from 'firebase/firestore';
import { AppShell } from '@/components/layout/app-shell';
import { useAppUser } from '@/hooks/use-app-user';
import { useFirestore, useUser, useDoc, useMemoFirebase } from '@/firebase';
import { canAccessHrAttendanceKioskPages } from '@/lib/navigation/nav-access';
import type { User } from '@/lib/types';
import {
  ATTENDANCE_KIOSK_SESSIONS_COLLECTION,
  KIOSK_SESSION_TTL_MS,
} from '@/lib/attendance/constants';
import type { AttendanceKioskSessionDoc } from '@/lib/attendance/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import QRCode from 'qrcode';

export default function HrAttendanceKioskPage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { user: fbUser } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const canUse = useMemo(
    () => !!currentUser && canAccessHrAttendanceKioskPages(currentUser as User, null),
    [currentUser],
  );

  const [token, setToken] = useState<string | null>(null);
  const [expiresAtMs, setExpiresAtMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  /** data URL from local `qrcode` lib, or fallback to external image API */
  const [qrImgSrc, setQrImgSrc] = useState('');
  /** เก็บข้อมูล punch ล่าสุดเพื่อ flash ขึ้นหน้าจอ Kiosk แล้วค่อยเปลี่ยนเป็น QR ใหม่ */
  const [recentlyConsumed, setRecentlyConsumed] = useState<{ at: number; direction: string } | null>(null);

  const mobileUrl = useMemo(() => {
    if (typeof window === 'undefined' || !token) return '';
    const u = new URL('/hr/attendance/mobile', window.location.origin);
    u.searchParams.set('t', token);
    return u.toString();
  }, [token]);

  useEffect(() => {
    if (!mobileUrl) {
      setQrImgSrc('');
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(mobileUrl, { width: 280, margin: 2, errorCorrectionLevel: 'M' })
      .then((dataUrl) => {
        if (!cancelled) setQrImgSrc(dataUrl);
      })
      .catch(() => {
        if (!cancelled) {
          setQrImgSrc(
            `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(mobileUrl)}`,
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [mobileUrl]);

  const refreshSession = useCallback(async () => {
    if (!firestore || !fbUser?.uid || !canUse) return;
    setBusy(true);
    try {
      const t = crypto.randomUUID();
      const now = Date.now();
      const exp = now + KIOSK_SESSION_TTL_MS;
      const payload: AttendanceKioskSessionDoc = {
        expiresAt: exp,
        active: true,
        createdByUid: fbUser.uid,
        createdAt: now,
      };
      await setDoc(doc(firestore, ATTENDANCE_KIOSK_SESSIONS_COLLECTION, t), payload);
      setToken(t);
      setExpiresAtMs(exp);
      setRecentlyConsumed(null);
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'สร้างโค้ดไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }, [firestore, fbUser?.uid, canUse, toast]);

  useEffect(() => {
    if (userLoading || !canUse || !firestore || !fbUser?.uid || token) return;
    void refreshSession();
    // โค้ดเริ่มต้นเท่านั้น — ที่เหลือ refresh อัตโนมัติเมื่อหมดอายุ/มีคนสแกน
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userLoading, canUse, firestore, fbUser?.uid]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const sessionRef = useMemoFirebase(() => {
    if (!firestore || !token) return null;
    return doc(firestore, ATTENDANCE_KIOSK_SESSIONS_COLLECTION, token);
  }, [firestore, token]);

  const { data: liveSession } = useDoc<AttendanceKioskSessionDoc>(sessionRef as any);

  const consumed = !!liveSession && liveSession.active === false;

  /** เมื่อโทเคนถูกใช้สแกน: flash หน้าจอแสดงผลสั้น ๆ แล้วสร้างโค้ดใหม่ทันที */
  useEffect(() => {
    if (!consumed || !liveSession?.consumedAt) return;
    setRecentlyConsumed({
      at: liveSession.consumedAt,
      direction: liveSession.consumedDirection ?? '',
    });
    const t = window.setTimeout(() => {
      void refreshSession();
    }, 1200);
    return () => window.clearTimeout(t);
  }, [consumed, liveSession?.consumedAt, liveSession?.consumedDirection, refreshSession]);

  /** เมื่อหมดอายุ 60 วินาที: สร้างโค้ดใหม่อัตโนมัติ */
  useEffect(() => {
    if (!expiresAtMs || consumed) return;
    const remain = expiresAtMs - Date.now();
    if (remain <= 0) {
      void refreshSession();
      return;
    }
    const t = window.setTimeout(() => {
      void refreshSession();
    }, remain + 200);
    return () => window.clearTimeout(t);
  }, [expiresAtMs, consumed, refreshSession]);

  const secondsLeft = useMemo(() => {
    void tick;
    if (!expiresAtMs) return 0;
    return Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000));
  }, [expiresAtMs, tick]);

  if (userLoading || !currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground text-sm">
        กำลังโหลด…
      </div>
    );
  }

  if (!canUse) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="max-w-3xl mx-auto py-16 text-center text-muted-foreground">
          คุณไม่มีสิทธิ์เข้าถึงเมนูนี้
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-lg mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/hr/attendance">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary">Kiosk ลงเวลา (QR)</h1>
            <p className="text-sm text-muted-foreground mt-1">
              QR ใช้ครั้งเดียวต่อ 1 คน อายุ 60 วินาที — ระบบจะสร้างโค้ดใหม่ให้อัตโนมัติหลังสแกน
            </p>
          </div>
        </div>

        <Card className="shadow-md">
          <CardHeader className="text-center border-b bg-muted/20">
            <CardTitle className="text-lg">Scan to Clock In / Out</CardTitle>
            <CardDescription>สแกน QR Code เพื่อเปิดหน้าลงเวลาบนมือถือ</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4 pt-8 pb-8">
            {recentlyConsumed && (
              <div className="flex flex-col items-center gap-2 text-emerald-700 py-6">
                <CheckCircle2 className="h-12 w-12" />
                <p className="text-base font-semibold">มีคนสแกนแล้ว</p>
                <p className="text-xs text-muted-foreground">กำลังสร้างโค้ดใหม่ให้คนถัดไป…</p>
              </div>
            )}
            {!recentlyConsumed && !qrImgSrc && (
              <div className="flex items-center gap-2 text-muted-foreground text-sm py-12">
                <Loader2 className="h-5 w-5 animate-spin" /> กำลังสร้างโค้ด…
              </div>
            )}
            {!recentlyConsumed && qrImgSrc && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrImgSrc} alt="Attendance QR" className="rounded-lg border bg-white p-2 w-[280px] h-[280px]" />
                <p className="text-sm text-muted-foreground tabular-nums">
                  Code expires in: <strong className="text-foreground">{secondsLeft}s</strong>
                </p>
              </>
            )}
            <Button className="gap-2" variant="secondary" type="button" disabled={busy} onClick={() => void refreshSession()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              สร้างโค้ดใหม่
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
