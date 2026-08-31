'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  collection,
  doc,
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
import type { User } from '@/lib/types';
import type { AttendanceCorrectionRequestDoc } from '@/lib/attendance/types';
import {
  ATTENDANCE_CORRECTION_REQUESTS_COLLECTION,
  ATTENDANCE_DAY_OVERRIDES_COLLECTION,
} from '@/lib/attendance/constants';
import {
  deriveLegacyInOutFromFourSlots,
  formatFourSlotTimesLabelTh,
  previousFourSlotTimesFromCorrectionRequest,
  proposedFourSlotTimesFromCorrectionRequest,
} from '@/lib/attendance/attendance-four-slot-times';
import { formatDateThaiBE } from '@/lib/date-thai';

function FourSlotTimesBlock({
  title,
  slots,
  className,
}: {
  title: string;
  slots: ReturnType<typeof previousFourSlotTimesFromCorrectionRequest>;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-xs font-semibold text-muted-foreground mb-1">{title}</div>
      <p className="text-xs leading-relaxed">{formatFourSlotTimesLabelTh(slots, '')}</p>
    </div>
  );
}

export default function AttendanceCorrectionsApprovalPage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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
            collection(firestore, ATTENDANCE_CORRECTION_REQUESTS_COLLECTION),
            where('status', '==', 'PENDING_MANAGER_APPROVAL'),
            orderBy('requestedAt', 'desc'),
            limit(100),
          )
        : null,
    [firestore, approvalGate],
  );

  const { data: pendingRows, isLoading } = useCollection<AttendanceCorrectionRequestDoc>(pendingQ as any);

  const handleApprove = async (row: AttendanceCorrectionRequestDoc) => {
    if (!firestore || !currentUser || !canApprove) return;
    setBusyId(row.id);
    try {
      const batch = writeBatch(firestore);
      const reqRef = doc(firestore, ATTENDANCE_CORRECTION_REQUESTS_COLLECTION, row.id);
      const overrideRef = doc(collection(firestore, ATTENDANCE_DAY_OVERRIDES_COLLECTION));
      const now = Date.now();

      batch.set(overrideRef, {
        id: overrideRef.id,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        subjectKey: row.subjectKey,
        payrollMonth: row.payrollMonth,
        workDateYmd: row.workDateYmd,
        effectiveInAtMs: row.proposedInAtMs,
        effectiveOutAtMs: row.proposedOutAtMs,
        effectiveMorningInAtMs: row.proposedMorningInAtMs ?? null,
        effectiveMorningOutAtMs: row.proposedMorningOutAtMs ?? null,
        effectiveAfternoonInAtMs: row.proposedAfternoonInAtMs ?? null,
        effectiveAfternoonOutAtMs: row.proposedAfternoonOutAtMs ?? null,
        correctionRequestId: row.id,
        appliedAt: now,
        appliedByUid: currentUser.id,
        appliedByName: currentUser.displayName || currentUser.email || currentUser.id,
      });

      batch.update(reqRef, {
        status: 'APPROVED',
        reviewedByUid: currentUser.id,
        reviewedByName: currentUser.displayName || currentUser.email || currentUser.id,
        reviewedAt: now,
      });

      await batch.commit();
      toast({ title: 'อนุมัติแล้ว', description: 'อัปเดตเวลาที่ใช้ในสรุปลงเวลาเรียบร้อย' });
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
      const reqRef = doc(firestore, ATTENDANCE_CORRECTION_REQUESTS_COLLECTION, rejectTargetId);
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
          <h1 className="text-2xl font-bold tracking-tight text-primary">อนุมัติแก้ไขเวลาลงเวลา</h1>
          <p className="mt-2 text-sm text-muted-foreground max-w-2xl">
            คำขอจากฝ่ายเงินเดือน (payroll officer) เพื่อแก้เวลาสแกนที่ผิดหรือลืมสแกน — เมื่ออนุมัติ ระบบจะใช้เวลาที่ขอแทนในการแสดงสรุปรายเดือน
          </p>
          {isPayrollOfficer(currentUser) && !canApprove ? (
            <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
              บทบาทของคุณส่งคำขอได้ที่หน้าสรุปลงเวลา — การอนุมัติเป็นหน้าที่ผู้จัดการ HR / ปฏิบัติการ
            </p>
          ) : null}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">คิวรออนุมัติ</CardTitle>
            <CardDescription>แสดงล่าสุด 100 รายการ</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <div className="flex justify-center py-10 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : !pendingRows?.length ? (
              <p className="text-sm text-muted-foreground py-6 text-center">ไม่มีคำขอที่รออนุมัติ</p>
            ) : (
              pendingRows.map((row) => (
                <div
                  key={row.id}
                  className="rounded-lg border bg-card p-4 space-y-3 shadow-sm"
                >
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

                  <div className="grid gap-2 text-sm sm:grid-cols-2">
                    <FourSlotTimesBlock
                      title="เดิม (ในระบบก่อนแก้)"
                      slots={previousFourSlotTimesFromCorrectionRequest(row)}
                      className="rounded-md bg-muted/50 p-3"
                    />
                    <FourSlotTimesBlock
                      title="ขอเปลี่ยนเป็น"
                      slots={proposedFourSlotTimesFromCorrectionRequest(row)}
                      className="rounded-md bg-primary/5 p-3 border border-primary/15"
                    />
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
            <DialogTitle>ปฏิเสธคำขอ</DialogTitle>
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
