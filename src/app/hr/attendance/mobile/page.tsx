'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  query,
  where,
} from 'firebase/firestore';
import { AppShell } from '@/components/layout/app-shell';
import { useAppUser } from '@/hooks/use-app-user';
import { useFirestore, useDoc, useMemoFirebase, useUser } from '@/firebase';
import { isSimpleInternalEligible } from '@/lib/simple-tier-model';
import type { User } from '@/lib/types';
import { ATTENDANCE_KIOSK_SESSIONS_COLLECTION, ATTENDANCE_PUNCHES_COLLECTION } from '@/lib/attendance/constants';
import type { AttendanceKioskSessionDoc, AttendanceSubjectType } from '@/lib/attendance/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { formatDateTimeThaiBE } from '@/lib/date-thai';

type ResolvedSubject =
  | { subjectType: AttendanceSubjectType; subjectId: string; displayName: string }
  | null;

function MobileAttendanceInner() {
  const searchParams = useSearchParams();
  const token = (searchParams.get('t') || '').trim();

  const { currentUser, isLoading: userLoading } = useAppUser();
  const { user: fbUser, isUserLoading: authLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const eligible = useMemo(() => isSimpleInternalEligible(currentUser as User | null), [currentUser]);

  const sessionRef = useMemoFirebase(() => {
    if (!firestore || !token) return null;
    return doc(firestore, ATTENDANCE_KIOSK_SESSIONS_COLLECTION, token);
  }, [firestore, token]);

  const { data: sessionRow, isLoading: sessionLoading } = useDoc<AttendanceKioskSessionDoc>(sessionRef as any);

  const [resolved, setResolved] = useState<ResolvedSubject | null>(null);
  const [resolveDone, setResolveDone] = useState(false);
  const [resolveBusy, setResolveBusy] = useState(false);
  const [punchBusy, setPunchBusy] = useState(false);

  const sessionOk = useMemo(() => {
    if (!sessionRow || typeof sessionRow.expiresAt !== 'number') return false;
    return !!sessionRow.active && sessionRow.expiresAt > Date.now();
  }, [sessionRow]);

  /** Resolve worker/office_staff row linked to current auth user */
  useEffect(() => {
    let cancelled = false;
    async function run() {
      setResolveDone(false);
      if (!firestore || !fbUser?.uid || !eligible) {
        setResolved(null);
        setResolveBusy(false);
        setResolveDone(true);
        return;
      }
      setResolveBusy(true);
      try {
        const uid = fbUser.uid;
        const wq = query(collection(firestore, 'workers'), where('linkedUserId', '==', uid), limit(12));
        const oq = query(collection(firestore, 'office_staff'), where('linkedUserId', '==', uid), limit(12));
        const [ws, os] = await Promise.all([getDocs(wq), getDocs(oq)]);
        if (cancelled) return;
        const workerHits = ws.docs.map((d) => {
          const x = d.data() as { firstName?: string; lastName?: string };
          const name = [x.firstName, x.lastName].filter(Boolean).join(' ').trim() || d.id;
          return { subjectType: 'worker' as const, subjectId: d.id, displayName: name };
        });
        const officeHits = os.docs.map((d) => {
          const x = d.data() as { fullName?: string };
          const name = String(x.fullName || '').trim() || d.id;
          return { subjectType: 'office_staff' as const, subjectId: d.id, displayName: name };
        });
        const all = [...officeHits, ...workerHits];
        if (all.length === 0) setResolved(null);
        else if (all.length === 1) setResolved(all[0]);
        else {
          setResolved(all[0]);
          toast({
            title: 'พบหลายทะเบียนที่ผูกบัญชีนี้',
            description: 'ระบบใช้รายการแรก — โปรดให้ผู้ดูแลแก้การผูกบัญชีให้เหลือเดียว',
          });
        }
      } catch {
        if (!cancelled) setResolved(null);
      } finally {
        if (!cancelled) {
          setResolveBusy(false);
          setResolveDone(true);
        }
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [firestore, fbUser?.uid, eligible, toast]);

  const punch = async (direction: 'IN' | 'OUT') => {
    if (!firestore || !fbUser?.uid || !token || !sessionOk || !resolved) return;
    setPunchBusy(true);
    try {
      const now = Date.now();
      await addDoc(collection(firestore, ATTENDANCE_PUNCHES_COLLECTION), {
        subjectType: resolved.subjectType,
        subjectId: resolved.subjectId,
        subjectNameSnapshot: resolved.displayName,
        direction,
        punchedAt: now,
        linkedUserId: fbUser.uid,
        kioskToken: token,
        source: 'kiosk_mobile',
        createdAt: now,
      });
      toast({
        title: direction === 'IN' ? 'บันทึกเข้างานแล้ว' : 'บันทึกออกงานแล้ว',
        description: formatDateTimeThaiBE(now),
      });
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'บันทึกไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setPunchBusy(false);
    }
  };

  if (authLoading || userLoading || !currentUser) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-muted-foreground text-sm gap-2">
        <Loader2 className="h-5 w-5 animate-spin" /> กำลังโหลด…
      </div>
    );
  }

  if (!eligible) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="max-w-md mx-auto py-16 px-4 text-center text-muted-foreground">
          บัญชีนี้ไม่สามารถใช้หน้าลงเวลามือถือได้
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-md mx-auto px-4 py-8 space-y-4">
        <div>
          <h1 className="text-xl font-bold text-primary">ลงเวลา (มือถือ)</h1>
          <p className="text-sm text-muted-foreground mt-1">สแกนจากหน้าจอ Kiosk แล้วกดเข้า/ออก</p>
        </div>

        {!token && (
          <Card>
            <CardContent className="pt-6 text-sm text-destructive">
              ไม่พบรหัส QR — สแกน QR จากหน้า Kiosk อีกครั้ง
            </CardContent>
          </Card>
        )}

        {token && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">สถานะโค้ด</CardTitle>
              <CardDescription>โค้ดใช้ได้ชั่วคราวเท่านั้น</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {sessionLoading && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> กำลังตรวจสอบโค้ด…
                </div>
              )}
              {!sessionLoading && !sessionRow && <p className="text-destructive">ไม่พบโค้ดหรือโค้ดไม่ถูกต้อง</p>}
              {!sessionLoading && sessionRow && !sessionOk && (
                <p className="text-destructive">โค้ดหมดอายุแล้ว — ขอให้พนักงาน Timekeeper กดสร้างโค้ดใหม่</p>
              )}
              {!sessionLoading && sessionOk && (
                <Badge variant="outline" className="bg-emerald-50 text-emerald-900 border-emerald-200">
                  โค้ดใช้งานได้
                </Badge>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">บัญชีของคุณ</CardTitle>
            <CardDescription>ต้องผูก UID กับทะเบียนพนักงานหรือลูกจ้างแล้ว</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(resolveBusy || !resolveDone) && (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" /> กำลังค้นหาทะเบียน…
              </div>
            )}
            {resolveDone && !resolveBusy && resolved === null && (
              <p className="text-sm text-destructive">
                ไม่พบทะเบียนที่ผูกกับบัญชีนี้ — ติดต่อ HR เพื่อผูกบัญชีในแท็บการเชื่อมโยง (System)
              </p>
            )}
            {resolveDone && !resolveBusy && resolved && (
              <div className="text-sm space-y-1">
                <p className="font-semibold">{resolved.displayName}</p>
                <p className="text-muted-foreground">
                  {resolved.subjectType === 'office_staff' ? 'พนักงานออฟฟิศ' : 'ลูกจ้าง'} ·{' '}
                  <span className="font-mono">{resolved.subjectId}</span>
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <Button
                type="button"
                className="h-12 text-base font-semibold"
                disabled={!sessionOk || !resolved || punchBusy}
                onClick={() => void punch('IN')}
              >
                {punchBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : 'เข้างาน (IN)'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="h-12 text-base font-semibold"
                disabled={!sessionOk || !resolved || punchBusy}
                onClick={() => void punch('OUT')}
              >
                {punchBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : 'ออกงาน (OUT)'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

export default function HrAttendanceMobilePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground text-sm gap-2">
          <Loader2 className="h-5 w-5 animate-spin" /> กำลังโหลด…
        </div>
      }
    >
      <MobileAttendanceInner />
    </Suspense>
  );
}
