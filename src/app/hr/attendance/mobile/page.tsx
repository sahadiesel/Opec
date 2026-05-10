'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import { AppShell } from '@/components/layout/app-shell';
import { useAppUser } from '@/hooks/use-app-user';
import { useFirestore, useDoc, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { isSimpleInternalEligible } from '@/lib/simple-tier-model';
import type { User } from '@/lib/types';
import { ATTENDANCE_KIOSK_SESSIONS_COLLECTION, ATTENDANCE_PUNCHES_COLLECTION } from '@/lib/attendance/constants';
import type {
  AttendanceKioskSessionDoc,
  AttendancePunchDirection,
  AttendancePunchDoc,
  AttendanceSubjectType,
} from '@/lib/attendance/types';
import {
  deriveMobileAttendanceUi,
  getBangkokDayBoundsMs,
  getCurrentAttendanceShift,
  summarizeDailyPunches,
} from '@/lib/attendance/shift-windows';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle2, Loader2, LogIn, LogOut } from 'lucide-react';
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
  const [lastPunch, setLastPunch] = useState<{ at: number; direction: AttendancePunchDirection } | null>(null);

  /** ติ๊ก clock เพื่ออัปเดต shift descriptor + day bounds เมื่อข้ามนาที (เผื่อข้ามช่วง) */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const sessionConsumed = !!sessionRow && sessionRow.active === false;
  const sessionOk = useMemo(() => {
    if (!sessionRow || typeof sessionRow.expiresAt !== 'number') return false;
    return !!sessionRow.active && sessionRow.expiresAt > Date.now();
  }, [sessionRow]);

  const shift = useMemo(() => getCurrentAttendanceShift(new Date(now)), [now]);
  const dayBounds = useMemo(() => getBangkokDayBoundsMs(new Date(now)), [now]);

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

  /** ดึง punch ของ subject "วันนี้" — ใช้เช็คซ้ำในวันเดียว/ตัดสินช่วงเช้า-บ่าย */
  const todayPunchesQuery = useMemoFirebase(() => {
    if (!firestore || !resolved) return null;
    return query(
      collection(firestore, ATTENDANCE_PUNCHES_COLLECTION),
      where('subjectType', '==', resolved.subjectType),
      where('subjectId', '==', resolved.subjectId),
      where('punchedAt', '>=', dayBounds.startMs),
      where('punchedAt', '<', dayBounds.endMs),
      orderBy('punchedAt', 'desc'),
    );
  }, [firestore, resolved, dayBounds.startMs, dayBounds.endMs]);

  const { data: todayPunches, isLoading: punchesLoading } = useCollection<AttendancePunchDoc>(
    todayPunchesQuery as any,
  );

  const dailySummary = useMemo(
    () => summarizeDailyPunches(todayPunches ?? []),
    [todayPunches],
  );

  const uiState = useMemo(() => deriveMobileAttendanceUi(shift, dailySummary), [shift, dailySummary]);

  const punch = async (direction: AttendancePunchDirection) => {
    if (!firestore || !fbUser?.uid || !token || !sessionOk || !resolved) return;
    if (direction === 'IN' && dailySummary.hasIn) {
      toast({ variant: 'destructive', title: 'สแกนเข้างานวันนี้แล้ว' });
      return;
    }
    if (direction === 'OUT' && dailySummary.hasOut) {
      toast({ variant: 'destructive', title: 'สแกนออกงานวันนี้แล้ว' });
      return;
    }
    setPunchBusy(true);
    try {
      const tsNow = Date.now();
      const punchRef = doc(collection(firestore, ATTENDANCE_PUNCHES_COLLECTION));
      const sessRef = doc(firestore, ATTENDANCE_KIOSK_SESSIONS_COLLECTION, token);
      const batch = writeBatch(firestore);
      batch.set(punchRef, {
        subjectType: resolved.subjectType,
        subjectId: resolved.subjectId,
        subjectNameSnapshot: resolved.displayName,
        direction,
        punchedAt: tsNow,
        linkedUserId: fbUser.uid,
        kioskToken: token,
        source: 'kiosk_mobile',
        createdAt: tsNow,
      });
      batch.update(sessRef, {
        active: false,
        consumedAt: tsNow,
        consumedByUid: fbUser.uid,
        consumedSubjectType: resolved.subjectType,
        consumedSubjectId: resolved.subjectId,
        consumedDirection: direction,
      });
      await batch.commit();
      setLastPunch({ at: tsNow, direction });
      toast({
        title: direction === 'IN' ? 'บันทึกเข้างานแล้ว' : 'บันทึกออกงานแล้ว',
        description: formatDateTimeThaiBE(tsNow),
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
      <div className="max-w-md mx-auto px-4 py-6 space-y-4">
        <div>
          <h1 className="text-xl font-bold text-primary">ลงเวลา (มือถือ)</h1>
          <p className="text-sm text-muted-foreground mt-1">
            สแกน QR จากหน้าจอ Kiosk แล้วกดปุ่มตามช่วงเวลาที่แสดง
          </p>
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
              <CardDescription>โค้ดใช้ครั้งเดียวและมีอายุ 60 วินาที</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {sessionLoading && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> กำลังตรวจสอบโค้ด…
                </div>
              )}
              {!sessionLoading && !sessionRow && (
                <p className="text-destructive">ไม่พบโค้ดหรือโค้ดไม่ถูกต้อง</p>
              )}
              {!sessionLoading && sessionRow && sessionConsumed && !lastPunch && (
                <p className="text-destructive">โค้ดนี้ถูกใช้สแกนไปแล้ว — กรุณาให้ Timekeeper สร้างโค้ดใหม่</p>
              )}
              {!sessionLoading && sessionRow && !sessionConsumed && !sessionOk && (
                <p className="text-destructive">โค้ดหมดอายุแล้ว — ขอโค้ดใหม่จากหน้า Kiosk</p>
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
          </CardContent>
        </Card>

        {resolveDone && resolved && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">ช่วงเวลาสแกน</CardTitle>
              <CardDescription>
                {shift ? `${shift.labelTh} (${shift.rangeLabelTh})` : 'อยู่นอกช่วงเวลาสแกน'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {punchesLoading && (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดประวัติวันนี้…
                </div>
              )}

              <div className="text-xs text-muted-foreground space-y-1">
                <p>
                  เข้างานวันนี้:{' '}
                  {dailySummary.firstInAt
                    ? formatDateTimeThaiBE(dailySummary.firstInAt)
                    : 'ยังไม่มี'}
                </p>
                <p>
                  ออกงานวันนี้:{' '}
                  {dailySummary.lastOutAt
                    ? formatDateTimeThaiBE(dailySummary.lastOutAt)
                    : 'ยังไม่มี'}
                </p>
              </div>

              {lastPunch && (
                <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                  <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">
                      บันทึก{lastPunch.direction === 'IN' ? 'เข้างาน' : 'ออกงาน'}เรียบร้อย
                    </p>
                    <p className="text-xs">{formatDateTimeThaiBE(lastPunch.at)}</p>
                  </div>
                </div>
              )}

              {uiState.kind === 'closed' && (
                <p className="text-sm text-muted-foreground">{uiState.messageTh}</p>
              )}

              {uiState.kind === 'evening_no_in' && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                  <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                  <span>{uiState.messageTh}</span>
                </div>
              )}

              {uiState.kind === 'in_only' && (
                <div className="space-y-3">
                  {uiState.warningTh && (
                    <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                      <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                      <span>{uiState.warningTh}</span>
                    </div>
                  )}
                  <Button
                    type="button"
                    className="h-14 w-full text-base font-semibold gap-2"
                    disabled={!sessionOk || !!lastPunch || punchBusy || !!uiState.disabledReasonTh}
                    onClick={() => void punch('IN')}
                  >
                    {punchBusy ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <>
                        <LogIn className="h-5 w-5" /> เข้างาน
                      </>
                    )}
                  </Button>
                  {uiState.disabledReasonTh && (
                    <p className="text-xs text-muted-foreground text-center">{uiState.disabledReasonTh}</p>
                  )}
                </div>
              )}

              {uiState.kind === 'out_only' && (
                <div className="space-y-3">
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-14 w-full text-base font-semibold gap-2"
                    disabled={!sessionOk || !!lastPunch || punchBusy || !!uiState.disabledReasonTh}
                    onClick={() => void punch('OUT')}
                  >
                    {punchBusy ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <>
                        <LogOut className="h-5 w-5" /> ออกงาน
                      </>
                    )}
                  </Button>
                  {uiState.disabledReasonTh && (
                    <p className="text-xs text-muted-foreground text-center">{uiState.disabledReasonTh}</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}
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
