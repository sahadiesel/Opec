'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAppUser } from '@/hooks/use-app-user';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { isSystemAdmin } from '@/lib/permission-core';
import { isSimpleAdmin } from '@/lib/simple-tier-model';
import { canViewHrApprovalSubsection } from '@/lib/navigation/nav-access';
import { CalendarCheck, CalendarOff, Clock, Coins, PackageSearch, ShieldCheck, Wallet } from 'lucide-react';
import type {
  CashAdvanceRequest,
  OfficePayrollRun,
  PayrollBatch,
  PoMonthTimesheetReview,
  Purchase,
  PurchaseRequest,
  User,
  WaveMonthTimesheetReview,
} from '@/lib/types';
import { ATTENDANCE_CORRECTION_REQUESTS_COLLECTION, ATTENDANCE_OVERTIME_REQUESTS_COLLECTION } from '@/lib/attendance/constants';

function ApprovalSectionPendingBadge({
  count,
  loading,
  kindLabel,
}: {
  count: number;
  loading: boolean;
  /** ระบุชนิดสั้น ๆ เช่น Timesheet รอบเดือน */
  kindLabel: string;
}) {
  if (loading || count <= 0) return null;
  return (
    <div
      className="absolute right-4 top-4 z-10 flex max-w-[min(100%-2rem,14rem)] flex-col items-end gap-1 text-right sm:max-w-none sm:flex-row sm:items-center sm:gap-2"
      role="status"
      aria-live="polite"
    >
      <span className="inline-flex items-center rounded-md bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-md animate-approval-new-request dark:bg-red-500">
        New Request
      </span>
      <span className="max-w-[11rem] text-[11px] font-semibold leading-snug text-red-600 dark:text-red-400 sm:max-w-none">
        {kindLabel} · รออนุมัติ {count.toLocaleString('th-TH')} รายการ
      </span>
    </div>
  );
}

/**
 * ศูนย์อนุมัติ — แยกหมวด: Timesheet รอบเดือน (payroll + draft invoice) · Payroll งวดจ่าย · ใบสั่งซื้อจัดซื้อ (สโตร์)
 * เมนูหลักอยู่ที่แผง HR → อนุมัติ (ผู้จัดการ)
 */
export default function HrApprovalCenterPage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();

  const approvalGate = useMemo(
    () =>
      !!currentUser &&
      canViewHrApprovalSubsection(currentUser as User, isSystemAdmin(currentUser) || isSimpleAdmin(currentUser)),
    [currentUser],
  );

  const wavePendingQ = useMemoFirebase(
    () =>
      firestore && approvalGate
        ? query(collection(firestore, 'wave_month_timesheet_reviews'), where('status', '==', 'pending_manager_review'))
        : null,
    [firestore, approvalGate],
  );
  const { data: wavePendingRows, isLoading: loadingWave } = useCollection<WaveMonthTimesheetReview>(wavePendingQ as any);

  const poMonthPendingQ = useMemoFirebase(
    () =>
      firestore && approvalGate
        ? query(collection(firestore, 'po_month_timesheet_reviews'), where('status', '==', 'pending_manager_review'))
        : null,
    [firestore, approvalGate],
  );
  const { data: poMonthPendingRows, isLoading: loadingPoMonth } = useCollection<PoMonthTimesheetReview>(
    poMonthPendingQ as any,
  );

  const workerBatchPendingQ = useMemoFirebase(
    () =>
      firestore && approvalGate
        ? query(collection(firestore, 'payroll_batches'), where('status', '==', 'HR_REVIEWED'))
        : null,
    [firestore, approvalGate],
  );
  const { data: workerBatchPendingRows, isLoading: loadingWorkerBatch } = useCollection<PayrollBatch>(
    workerBatchPendingQ as any,
  );

  const officePayrollPendingQ = useMemoFirebase(
    () =>
      firestore && approvalGate
        ? query(collection(firestore, 'office_payroll_runs'), where('status', '==', 'HR_REVIEW'))
        : null,
    [firestore, approvalGate],
  );
  const { data: officePayrollPendingRows, isLoading: loadingOfficePayroll } = useCollection<OfficePayrollRun>(
    officePayrollPendingQ as any,
  );

  const cashAdvancePendingQ = useMemoFirebase(
    () =>
      firestore && approvalGate
        ? query(collection(firestore, 'cash_advance_requests'), where('status', '==', 'PENDING_MANAGER_APPROVAL'))
        : null,
    [firestore, approvalGate],
  );
  const { data: cashAdvancePendingRows, isLoading: loadingCashAdvance } = useCollection<CashAdvanceRequest>(
    cashAdvancePendingQ as any,
  );

  const purchasePendingQ = useMemoFirebase(
    () =>
      firestore && approvalGate
        ? query(collection(firestore, 'purchases'), where('status', '==', 'PENDING_APPROVAL'))
        : null,
    [firestore, approvalGate],
  );
  const { data: purchasePendingRows, isLoading: loadingPurchase } = useCollection<Purchase>(purchasePendingQ as any);

  const purchaseRequestPendingQ = useMemoFirebase(
    () =>
      firestore && approvalGate
        ? query(collection(firestore, 'purchase_requests'), where('status', '==', 'PENDING_APPROVAL'))
        : null,
    [firestore, approvalGate],
  );
  const { data: purchaseRequestPendingRows, isLoading: loadingPurchaseRequest } = useCollection<PurchaseRequest>(
    purchaseRequestPendingQ as any,
  );

  const attendanceCorrectionPendingQ = useMemoFirebase(
    () =>
      firestore && approvalGate
        ? query(
            collection(firestore, ATTENDANCE_CORRECTION_REQUESTS_COLLECTION),
            where('status', '==', 'PENDING_MANAGER_APPROVAL'),
          )
        : null,
    [firestore, approvalGate],
  );
  const { data: attendanceCorrectionPendingRows, isLoading: loadingAttendanceCorrection } = useCollection(
    attendanceCorrectionPendingQ as any,
  );

  const overtimePendingQ = useMemoFirebase(
    () =>
      firestore && approvalGate
        ? query(
            collection(firestore, ATTENDANCE_OVERTIME_REQUESTS_COLLECTION),
            where('status', '==', 'PENDING_MANAGER_APPROVAL'),
          )
        : null,
    [firestore, approvalGate],
  );
  const { data: overtimePendingRows, isLoading: loadingOvertime } = useCollection(overtimePendingQ as any);

  const leavePendingQ = useMemoFirebase(
    () =>
      firestore && approvalGate
        ? query(collection(firestore, 'leave_requests'), where('status', '==', 'SUBMITTED'))
        : null,
    [firestore, approvalGate],
  );
  const { data: leavePendingRows, isLoading: loadingLeavePending } = useCollection(leavePendingQ as any);

  const timesheetPendingCount = useMemo(() => {
    return (wavePendingRows?.length ?? 0) + (poMonthPendingRows?.length ?? 0);
  }, [wavePendingRows, poMonthPendingRows]);

  const payrollPendingCount = useMemo(() => {
    return (workerBatchPendingRows?.length ?? 0) + (officePayrollPendingRows?.length ?? 0);
  }, [workerBatchPendingRows, officePayrollPendingRows]);

  const cashAdvancePendingCount = cashAdvancePendingRows?.length ?? 0;

  const purchasePendingCount = useMemo(() => {
    return (purchasePendingRows?.length ?? 0) + (purchaseRequestPendingRows?.length ?? 0);
  }, [purchasePendingRows, purchaseRequestPendingRows]);

  const attendanceCorrectionPendingCount = attendanceCorrectionPendingRows?.length ?? 0;
  const overtimePendingCount = overtimePendingRows?.length ?? 0;
  const attendanceQueuePendingCount = attendanceCorrectionPendingCount + overtimePendingCount;
  const leavePendingCount = leavePendingRows?.length ?? 0;

  const canSee = approvalGate;

  if (userLoading || !currentUser) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground text-sm">กำลังโหลด…</div>
    );
  }

  if (!canSee) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="mx-auto max-w-lg py-20 text-center text-muted-foreground">ไม่มีสิทธิ์เข้าหน้านี้</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-8">
        <div>
          <h1 className="flex flex-wrap items-center gap-x-3 gap-y-2 text-2xl font-bold tracking-tight text-primary">
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="h-8 w-8 shrink-0" />
              ศูนย์อนุมัติ (Approval Center)
            </span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            เลือกหมวดด้านล่าง — ถ้ามีคิวรออนุมัติจะมีป้าย{' '}
            <span className="font-semibold text-foreground">New Request</span> ที่มุมขวาบนของกล่องนั้น
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6">
          <Card className="relative flex h-full flex-col overflow-hidden rounded-xl border border-primary/20 bg-card shadow-sm ring-1 ring-black/[0.03] transition-shadow hover:shadow-md dark:ring-white/[0.06]">
            <CardHeader className="relative pb-3 pr-28 pt-6 sm:pr-36">
              <ApprovalSectionPendingBadge
                count={timesheetPendingCount}
                loading={loadingWave || loadingPoMonth}
                kindLabel="Timesheet รอบเดือน"
              />
              <CardTitle className="flex items-start gap-2.5 pr-0 text-lg leading-snug">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <CalendarCheck className="h-5 w-5" />
                </span>
                <span>3.1 อนุมัติ Timesheet (รอบเดือน / Wave)</span>
              </CardTitle>
              <CardDescription className="text-sm leading-relaxed">
                <span className="font-semibold text-foreground">3.1.1</span> หลังอนุมัติ — นำไปคำนวณ payroll ได้{' '}
                <span className="mx-1 text-muted-foreground">|</span>{' '}
                <span className="font-semibold text-foreground">3.1.2</span> เพื่อออกเอกสาร Draft Invoice ส่งลูกค้า
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href="/hr/timesheet-month-approval">เปิดคิวรอตรวจ (รายเดือน)</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/timesheets/wave-month">ไปสรุปลงเวลารายเดือน (ฝั่งเตรียมข้อมูล)</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="relative flex h-full flex-col overflow-hidden rounded-xl border border-primary/20 bg-card shadow-sm ring-1 ring-black/[0.03] transition-shadow hover:shadow-md dark:ring-white/[0.06]">
            <CardHeader className="relative pb-3 pr-28 pt-6 sm:pr-36">
              <ApprovalSectionPendingBadge
                count={payrollPendingCount}
                loading={loadingWorkerBatch || loadingOfficePayroll}
                kindLabel="Payroll งวดจ่าย (Worker / Office)"
              />
              <CardTitle className="flex items-start gap-2.5 pr-0 text-lg leading-snug">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-800 dark:text-amber-400">
                  <Coins className="h-5 w-5" />
                </span>
                <span>อนุมัติ Payroll งวดจ่าย (Worker / Office)</span>
              </CardTitle>
              <CardDescription className="text-sm leading-relaxed">
                ศูนย์อนุมัติงวดจ่าย — ลูกจ้าง: สถานะ <span className="font-medium text-foreground">HR_REVIEWED</span> ·
                ออฟฟิศ: สถานะ <span className="font-medium text-foreground">HR_REVIEW</span> = รอผู้จัดการอนุมัติ
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild variant="secondary">
                <Link href="/hr/payroll-approval">เปิดศูนย์อนุมัติ Payroll</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="relative flex h-full flex-col overflow-hidden rounded-xl border border-emerald-500/25 bg-card shadow-sm ring-1 ring-black/[0.03] transition-shadow hover:shadow-md dark:ring-white/[0.06]">
            <CardHeader className="relative pb-3 pr-28 pt-6 sm:pr-36">
              <ApprovalSectionPendingBadge
                count={cashAdvancePendingCount}
                loading={loadingCashAdvance}
                kindLabel="เบิกล่วงหน้า"
              />
              <CardTitle className="flex items-start gap-2.5 pr-0 text-lg leading-snug">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-800 dark:text-emerald-300">
                  <Wallet className="h-5 w-5" />
                </span>
                <span>อนุมัติการเบิกเงิน (เบิกล่วงหน้า)</span>
              </CardTitle>
              <CardDescription className="text-sm leading-relaxed">
                คิวผู้จัดการอนุมัติหลัง Payroll ตรวจแล้ว — เมื่ออนุมัติและจ่ายแล้ว ระบบจะ
                <strong className="text-foreground">หักยอดเบิกจากสลิปเงินเดือน</strong>
                อัตโนมัติเมื่อสร้าง Payroll Batch งวดถัดไป (ลูกจ้าง)
              </CardDescription>
            </CardHeader>
            <CardContent className="mt-auto flex flex-wrap gap-2 pb-6 pt-0">
              <Button asChild>
                <Link href="/hr/cash-advances?focus=manager">เปิดคิวรอผู้จัดการ</Link>
              </Button>
              <Button variant="outline" asChild size="sm">
                <Link href="/hr/cash-advances">รายการเบิกล่วงหน้าทั้งหมด</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="relative flex h-full flex-col overflow-hidden rounded-xl border bg-card shadow-sm ring-1 ring-black/[0.03] transition-shadow hover:shadow-md dark:ring-white/[0.06]">
            <CardHeader className="relative pb-3 pr-28 pt-6 sm:pr-36">
              <ApprovalSectionPendingBadge
                count={purchasePendingCount}
                loading={loadingPurchase || loadingPurchaseRequest}
                kindLabel="คำขอซื้อ (PR) / ใบสั่งซื้อคลัง"
              />
              <CardTitle className="flex items-start gap-2.5 text-lg leading-snug">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <PackageSearch className="h-5 w-5" />
                </span>
                <span>3.2 อนุมัติใบสั่งซื้อจัดซื้อ (คลัง / สโตร์)</span>
              </CardTitle>
              <CardDescription>
                ผู้จัดการอนุมัติ<strong className="text-foreground">คำขอซื้อ (PR)</strong> ที่เจ้าหน้าที่คลังส่งเข้ามาก่อน — หลังอนุมัติ PR
                แผนกคลังจะสร้างใบสั่งซื้อคลังต่อได้ · แยกจากใบสั่งซื้อลูกค้า (Commercial PO)
              </CardDescription>
            </CardHeader>
            <CardContent className="mt-auto flex flex-wrap gap-2 pb-6 pt-0">
              <Button asChild>
                <Link href="/store/purchase-requests">คำขออนุมัติสั่งซื้อ (PR) — รออนุมัติ</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/purchases">ใบสั่งซื้อคลัง — รออนุมัติ</Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href="/purchase-orders">ใบสั่งซื้อลูกค้า (Commercial PO)</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="relative flex h-full flex-col overflow-hidden rounded-xl border border-sky-500/20 bg-card shadow-sm ring-1 ring-black/[0.03] transition-shadow hover:shadow-md dark:ring-white/[0.06]">
            <CardHeader className="relative pb-3 pr-28 pt-6 sm:pr-36">
              <ApprovalSectionPendingBadge
                count={attendanceQueuePendingCount}
                loading={loadingAttendanceCorrection || loadingOvertime}
                kindLabel="แก้ไขเวลา / OT"
              />
              <CardTitle className="flex items-start gap-2.5 pr-0 text-lg leading-snug">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sky-800 dark:text-sky-300">
                  <Clock className="h-5 w-5" />
                </span>
                <span>อนุมัติแก้ไขเวลาลงเวลา / OT (Kiosk)</span>
              </CardTitle>
              <CardDescription className="text-sm leading-relaxed">
                ฝ่ายเงินเดือนส่งคำขอเมื่อพนักงานลืมสแกนหรือเวลาผิด — หรือขออนุมัติ OT ตามชั่วโมงที่ทำงานล่วงเวลา ผู้จัดการ HR / ปฏิบัติการอนุมัติแล้วระบบจะใช้ในหน้าสรุปลงเวลาและคำนวณเงิน OT ในงวดจ่าย
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href="/hr/approval-center/attendance-corrections">เปิดคิวอนุมัติแก้ไขเวลา</Link>
              </Button>
              <Button asChild variant="secondary">
                <Link href="/hr/approval-center/overtime">เปิดคิวอนุมัติ OT</Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href="/hr/attendance">ไปสรุปลงเวลารายเดือน</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="relative flex h-full flex-col overflow-hidden rounded-xl border border-violet-500/20 bg-card shadow-sm ring-1 ring-black/[0.03] transition-shadow hover:shadow-md dark:ring-white/[0.06]">
            <CardHeader className="relative pb-3 pr-28 pt-6 sm:pr-36">
              <ApprovalSectionPendingBadge
                count={leavePendingCount}
                loading={loadingLeavePending}
                kindLabel="คำขอลาพนักงานออฟฟิศ"
              />
              <CardTitle className="flex items-start gap-2.5 pr-0 text-lg leading-snug">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-800 dark:text-violet-300">
                  <CalendarOff className="h-5 w-5" />
                </span>
                <span>อนุมัติวันลา (พนักงานออฟฟิศ)</span>
              </CardTitle>
              <CardDescription className="text-sm leading-relaxed">
                คำขอลาป่วย / กิจ / พักร้อนที่รอผู้จัดการ — เปิดเฉพาะคิวรออนุมัติ (ดูรายละเอียดและเหตุผลในแต่ละแถว)
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href="/hr/approval-center/office-leaves">เปิดคิวอนุมัติวันลา</Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href="/hr/leaves">จัดการลาฝั่ง HR (สรุป / ฉบับร่าง)</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
