'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  writeBatch,
  limit,
} from 'firebase/firestore';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useAppUser } from '@/hooks/use-app-user';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { canViewHrApprovalSubsection } from '@/lib/navigation/nav-access';
import {
  canApproveAttendanceCorrectionRequest,
  isPayrollOfficer,
  isSystemAdmin,
} from '@/lib/permissions';
import { isSimpleAdmin } from '@/lib/simple-tier-model';
import type { OfficeStaff, User } from '@/lib/types';
import type { AttendanceOvertimeRequestDoc } from '@/lib/attendance/types';
import { ATTENDANCE_OVERTIME_REQUESTS_COLLECTION } from '@/lib/attendance/constants';
import { formatAttendanceOvertimeHours } from '@/lib/attendance/overtime-display';
import { formatDateThaiBE } from '@/lib/date-thai';
import { loadPayrollPoliciesFromFirestore, resolvePayrollPoliciesForDate } from '@/lib/payroll/d8';
import { monthlyWorkNormFromPolicyRecord } from '@/lib/payroll/office-payroll-period-deductions';
import { computeOfficeOvertimePayAmount } from '@/lib/payroll/office-overtime-pay';

export default function AttendanceOvertimeApprovalPage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [approveHoursById, setApproveHoursById] = useState<Record<string, string>>({});
  const [normByAsOf, setNormByAsOf] = useState<Record<string, ReturnType<typeof monthlyWorkNormFromPolicyRecord>>>({});

  const approvalGate = useMemo(
    () =>
      !!currentUser &&
      canViewHrApprovalSubsection(currentUser as User, isSystemAdmin(currentUser) || isSimpleAdmin(currentUser)),
    [currentUser],
  );

  const canApprove = useMemo(() => canApproveAttendanceCorrectionRequest(currentUser), [currentUser]);

  const pendingQ = useMemoFirebase(
    () =>
      firestore && approvalGate
        ? query(
            collection(firestore, ATTENDANCE_OVERTIME_REQUESTS_COLLECTION),
            where('status', '==', 'PENDING_MANAGER_APPROVAL'),
            orderBy('requestedAt', 'desc'),
            limit(100),
          )
        : null,
    [firestore, approvalGate],
  );

  const { data: pendingRows, isLoading } = useCollection<AttendanceOvertimeRequestDoc>(pendingQ as any);

  useEffect(() => {
    if (!pendingRows?.length) return;
    const next: Record<string, string> = {};
    for (const row of pendingRows) {
      next[row.id] = String(row.requestedOtHours ?? '');
    }
    setApproveHoursById(next);
  }, [pendingRows]);

  async function loadNormForDate(asOfYmd: string) {
    if (!firestore || normByAsOf[asOfYmd]) return normByAsOf[asOfYmd];
    const policies = await loadPayrollPoliciesFromFirestore(firestore);
    const resolved = resolvePayrollPoliciesForDate(asOfYmd, policies, 'office');
    const norm = monthlyWorkNormFromPolicyRecord(resolved.monthlyWorkNorm);
    setNormByAsOf((prev) => ({ ...prev, [asOfYmd]: norm }));
    return norm;
  }

  const handleApprove = async (row: AttendanceOvertimeRequestDoc) => {
    if (!firestore || !currentUser || !canApprove) return;
    const hoursRaw = approveHoursById[row.id] ?? String(row.requestedOtHours);
    const approvedHours = Number(hoursRaw);
    if (!Number.isFinite(approvedHours) || approvedHours <= 0 || approvedHours > 24) {
      toast({ variant: 'destructive', title: 'ชั่วโมง OT ไม่ถูกต้อง', description: 'กรอก 0.25–24 ชม.' });
      return;
    }

    setBusyId(row.id);
    try {
      let monthlySalary = 0;
      if (row.subjectType === 'office_staff') {
        const staffSnap = await getDoc(doc(firestore, 'office_staff', row.subjectId));
        if (staffSnap.exists()) {
          monthlySalary = Number((staffSnap.data() as OfficeStaff).monthlySalary) || 0;
        }
      }

      const norm = (await loadNormForDate(row.workDateYmd)) ?? monthlyWorkNormFromPolicyRecord(null);
      const breakdown = computeOfficeOvertimePayAmount(monthlySalary, norm, approvedHours);
      const now = Date.now();
      const batch = writeBatch(firestore);
      const reqRef = doc(firestore, ATTENDANCE_OVERTIME_REQUESTS_COLLECTION, row.id);
      batch.update(reqRef, {
        status: 'APPROVED',
        approvedOtHours: breakdown.approvedHours,
        monthlySalarySnapshot: breakdown.monthlySalary,
        hourlyRateSnapshot: breakdown.hourlyRate,
        otMultiplierSnapshot: breakdown.multiplier,
        otPayAmountSnapshot: breakdown.amount,
        reviewedByUid: currentUser.id,
        reviewedByName: currentUser.displayName || currentUser.email || currentUser.id,
        reviewedAt: now,
      });

      // แทนที่ OT ที่อนุมัติไว้แล้วในวันเดียวกัน (กรณีขอแก้ไขชั่วโมง)
      const priorApproved = await getDocs(
        query(
          collection(firestore, ATTENDANCE_OVERTIME_REQUESTS_COLLECTION),
          where('subjectKey', '==', row.subjectKey),
          where('workDateYmd', '==', row.workDateYmd),
          where('status', '==', 'APPROVED'),
          limit(20),
        ),
      );
      for (const snap of priorApproved.docs) {
        if (snap.id === row.id) continue;
        batch.update(snap.ref, {
          status: 'SUPERSEDED',
          reviewedByUid: currentUser.id,
          reviewedByName: currentUser.displayName || currentUser.email || currentUser.id,
          reviewedAt: now,
          rejectReason: `ถูกแทนที่ด้วยคำขอแก้ไข OT (${breakdown.approvedHours} ชม.)`,
        });
      }

      await batch.commit();
      toast({
        title: 'อนุมัติ OT แล้ว',
        description: `${breakdown.approvedHours} ชม. · ตัวคูณ OT ${breakdown.multiplier} · ประมาณ ${breakdown.amount.toLocaleString('th-TH')} บาท (รวมในงวดเงินเดือนเมื่อคำนวณใหม่)`,
      });
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'อนุมัติไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusyId(null);
    }
  };

  const openReject = (id: string) => {
    setRejectTargetId(id);
    setRejectReason('');
    setRejectOpen(true);
  };

  const confirmReject = async () => {
    if (!firestore || !currentUser || !rejectTargetId || !canApprove) return;
    const rr = rejectReason.trim();
    if (rr.length < 2) {
      toast({ variant: 'destructive', title: 'ระบุเหตุผล', description: 'กรุณากรอกเหตุผลปฏิเสธ' });
      return;
    }
    setBusyId(rejectTargetId);
    try {
      const reqRef = doc(firestore, ATTENDANCE_OVERTIME_REQUESTS_COLLECTION, rejectTargetId);
      const batch = writeBatch(firestore);
      batch.update(reqRef, {
        status: 'REJECTED',
        reviewedByUid: currentUser.id,
        reviewedByName: currentUser.displayName || currentUser.email || currentUser.id,
        reviewedAt: Date.now(),
        rejectReason: rr,
      });
      await batch.commit();
      toast({ title: 'ปฏิเสธคำขอแล้ว' });
      setRejectOpen(false);
      setRejectTargetId(null);
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'บันทึกไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusyId(null);
    }
  };

  if (userLoading || !currentUser) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground text-sm">กำลังโหลด…</div>
    );
  }

  if (!approvalGate) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="mx-auto max-w-lg py-20 text-center text-muted-foreground">ไม่มีสิทธิ์เข้าหน้านี้</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="sm" asChild className="gap-1">
            <Link href="/hr/approval-center">
              <ArrowLeft className="h-4 w-4" />
              กลับศูนย์อนุมัติ
            </Link>
          </Button>
        </div>

        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">อนุมัติ OT (ล่วงเวลา)</h1>
          <p className="mt-2 text-sm text-muted-foreground max-w-2xl">
            คำขอจากฝ่ายเงินเดือน — ปรับชั่วโมงที่อนุมัติได้ · ค่า OT = ค่าจ้าง/ชม. × ตัวคูณ (HR Settings) × ชม.ที่อนุมัติ
          </p>
          {isPayrollOfficer(currentUser) && !canApprove ? (
            <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
              บทบาทของคุณส่งคำขอได้ที่หน้าสรุปลงเวลา — การอนุมัติเป็นหน้าที่ผู้จัดการ HR / ปฏิบัติการ
            </p>
          ) : null}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">คิวรออนุมัติ OT</CardTitle>
            <CardDescription>แสดงล่าสุด 100 รายการ</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <div className="flex justify-center py-10 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : !pendingRows?.length ? (
              <p className="text-sm text-muted-foreground py-6 text-center">ไม่มีคำขอ OT ที่รออนุมัติ</p>
            ) : (
              pendingRows.map((row) => (
                <div key={row.id} className="rounded-lg border bg-card p-4 space-y-3 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold">{row.subjectNameSnapshot}</div>
                      <div className="text-xs text-muted-foreground font-mono">{row.subjectKey}</div>
                      <div className="text-sm mt-1">
                        วันที่ {formatDateThaiBE(row.workDateYmd)} · งวด {row.payrollMonth}
                      </div>
                    </div>
                    <Badge variant="secondary">รออนุมัติ</Badge>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-md bg-muted/50 p-3 text-sm">
                      <div className="text-xs font-semibold text-muted-foreground">
                        {row.previousOtHours != null && Number(row.previousOtHours) > 0
                          ? 'ขอแก้ไข OT'
                          : 'ขอ OT'}
                      </div>
                      {row.previousOtHours != null && Number(row.previousOtHours) > 0 ? (
                        <div className="font-mono text-lg font-bold">
                          {formatAttendanceOvertimeHours(Number(row.previousOtHours))} →{' '}
                          {formatAttendanceOvertimeHours(Number(row.requestedOtHours))} ชม.
                        </div>
                      ) : (
                        <div className="font-mono text-lg font-bold">{row.requestedOtHours} ชม.</div>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`ot-approve-${row.id}`} className="text-xs">
                        ชั่วโมงที่อนุมัติ (แก้ไขได้)
                      </Label>
                      <Input
                        id={`ot-approve-${row.id}`}
                        type="number"
                        min={0.25}
                        max={24}
                        step={0.25}
                        className="font-mono"
                        disabled={!canApprove || busyId === row.id}
                        value={approveHoursById[row.id] ?? ''}
                        onChange={(e) =>
                          setApproveHoursById((prev) => ({ ...prev, [row.id]: e.target.value }))
                        }
                      />
                    </div>
                  </div>

                  <div className="text-sm">
                    <span className="text-muted-foreground">เหตุผล: </span>
                    {row.reason}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    ผู้ขอ: {row.requestedByName || row.requestedByUid} ·{' '}
                    {new Date(row.requestedAt).toLocaleString('th-TH')}
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      size="sm"
                      disabled={!canApprove || busyId === row.id}
                      onClick={() => void handleApprove(row)}
                    >
                      {busyId === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'อนุมัติ'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canApprove || busyId === row.id}
                      onClick={() => openReject(row.id)}
                    >
                      ปฏิเสธ
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ปฏิเสธคำขอ OT</DialogTitle>
            <DialogDescription>ระบุเหตุผลให้ฝ่ายเงินเดือนทราบ</DialogDescription>
          </DialogHeader>
          <Textarea rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              ยกเลิก
            </Button>
            <Button variant="destructive" onClick={() => void confirmReject()} disabled={!!busyId}>
              ยืนยันปฏิเสธ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
