'use client';

import { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, doc, getDocs, limit, query, updateDoc, where } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import type { User } from '@/lib/types';
import type { AttendanceSubjectType } from '@/lib/attendance/types';
import { ATTENDANCE_OVERTIME_REQUESTS_COLLECTION } from '@/lib/attendance/constants';
import { formatAttendanceOvertimeHours } from '@/lib/attendance/overtime-display';
import {
  formatAttendanceHmRange,
  isSameAttendanceHmRange,
  normalizeAttendanceHmInput,
} from '@/lib/attendance/overtime-time';
import { otHoursFromWorkNormHmRange, type MonthlyWorkNormPolicyConfig } from '@/lib/hr/monthly-work-norm-policy';
import { validateOfficeOvertimeHmRange } from '@/lib/payroll/office-overtime-interval-pay';
import { formatDateThaiBE } from '@/lib/date-thai';

export function AttendanceOvertimeRequestDialog({
  open,
  onOpenChange,
  firestore,
  currentUser,
  subjectType,
  subjectId,
  subjectNameSnapshot,
  payrollMonth,
  workDateYmd,
  /** ชั่วโมง OT ที่มีอยู่แล้วในวันนี้ — ถ้ามี = โหมดขอแก้ไข */
  previousOtHours = null,
  /** ถ้ามีคำขอรออนุมัติ — อัปเดตคำขอนั้นแทนการสร้างใหม่ */
  pendingRequestId = null,
  pendingStartHm = null,
  pendingEndHm = null,
  previousOtStartHm = null,
  previousOtEndHm = null,
  monthlyWorkNorm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  firestore: Firestore | null;
  currentUser: User;
  subjectType: AttendanceSubjectType;
  subjectId: string;
  subjectNameSnapshot: string;
  payrollMonth: string;
  workDateYmd: string;
  previousOtHours?: number | null;
  pendingRequestId?: string | null;
  pendingStartHm?: string | null;
  pendingEndHm?: string | null;
  /** ช่วงเวลา OT เดิม (จากคำขอที่อนุมัติแล้ว) — ถ้าไม่มี = legacy มีแค่ชั่วโมง */
  previousOtStartHm?: string | null;
  previousOtEndHm?: string | null;
  monthlyWorkNorm: MonthlyWorkNormPolicyConfig;
}) {
  const { toast } = useToast();
  const [otStartHm, setOtStartHm] = useState('');
  const [otEndHm, setOtEndHm] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const subjectKey = useMemo(() => `${subjectType}:${subjectId}`, [subjectType, subjectId]);
  const isAmend =
    previousOtHours != null && Number.isFinite(previousOtHours) && previousOtHours > 0;
  const previousLabel = isAmend ? formatAttendanceOvertimeHours(Number(previousOtHours)) : null;
  const normalizedPreviousStart = normalizeAttendanceHmInput(previousOtStartHm);
  const normalizedPreviousEnd = normalizeAttendanceHmInput(previousOtEndHm);
  const hasPreviousTimeRange = !!(normalizedPreviousStart && normalizedPreviousEnd);
  const isLegacyHoursOnlyAmend = isAmend && !hasPreviousTimeRange;
  const previousRangeLabel = hasPreviousTimeRange
    ? formatAttendanceHmRange(normalizedPreviousStart!, normalizedPreviousEnd!)
    : null;

  const computedHours = useMemo(() => {
    const start = normalizeAttendanceHmInput(otStartHm);
    const end = normalizeAttendanceHmInput(otEndHm);
    if (!start || !end) return null;
    return otHoursFromWorkNormHmRange(start, end, monthlyWorkNorm);
  }, [otStartHm, otEndHm, monthlyWorkNorm]);

  useEffect(() => {
    if (!open) return;
    if (pendingStartHm && pendingEndHm) {
      setOtStartHm(pendingStartHm);
      setOtEndHm(pendingEndHm);
    } else {
      setOtStartHm('');
      setOtEndHm('');
    }
    setReason('');
  }, [open, workDateYmd, isAmend, previousOtHours, pendingStartHm, pendingEndHm]);

  const handleSubmit = async () => {
    if (!firestore) return;
    const r = reason.trim();
    if (r.length < 3) {
      toast({ variant: 'destructive', title: 'ระบุเหตุผล', description: 'กรุณากรอกเหตุผลอย่างน้อย 3 ตัวอักษร' });
      return;
    }

    const startHm = normalizeAttendanceHmInput(otStartHm);
    const endHm = normalizeAttendanceHmInput(otEndHm);
    const rangeErr = validateOfficeOvertimeHmRange(otStartHm, otEndHm, monthlyWorkNorm);
    if (rangeErr || !startHm || !endHm) {
      toast({
        variant: 'destructive',
        title: 'ช่วงเวลา OT ไม่ถูกต้อง',
        description: rangeErr ?? 'กรุณาระบุเวลาเริ่มและเวลาสิ้นสุด',
      });
      return;
    }

    const hours = otHoursFromWorkNormHmRange(startHm, endHm, monthlyWorkNorm);
    if (hours === null || hours <= 0) {
      toast({
        variant: 'destructive',
        title: 'ช่วงเวลา OT ไม่ถูกต้อง',
        description: 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม',
      });
      return;
    }

    if (isAmend && hasPreviousTimeRange) {
      if (isSameAttendanceHmRange(startHm, endHm, normalizedPreviousStart, normalizedPreviousEnd)) {
        toast({
          variant: 'destructive',
          title: 'ยังไม่เปลี่ยนช่วงเวลา',
          description: `กรุณาระบุช่วงเวลาใหม่ที่ต่างจากเดิม (${previousRangeLabel})`,
        });
        return;
      }
    }

    setSubmitting(true);
    try {
      const roundedHours = Math.round(hours * 100) / 100;
      const now = Date.now();
      const payload = {
        requestedOtHours: roundedHours,
        requestedOtStartHm: startHm,
        requestedOtEndHm: endHm,
        reason: r,
        requestedByUid: currentUser.id,
        requestedByName: currentUser.displayName || currentUser.email || currentUser.id,
        requestedAt: now,
        ...(isAmend
          ? {
              previousOtHours: Math.round(Number(previousOtHours) * 100) / 100,
              ...(hasPreviousTimeRange
                ? {
                    previousOtStartHm: normalizedPreviousStart,
                    previousOtEndHm: normalizedPreviousEnd,
                  }
                : {}),
            }
          : {}),
      };

      if (pendingRequestId) {
        await updateDoc(doc(firestore, ATTENDANCE_OVERTIME_REQUESTS_COLLECTION, pendingRequestId), payload);
        toast({
          title: 'อัปเดตคำขอ OT แล้ว',
          description: isAmend
            ? `จาก ${previousLabel} → ${formatAttendanceHmRange(startHm, endHm)} (${formatAttendanceOvertimeHours(roundedHours)} ชม.) · ยังรอผู้จัดการอนุมัติ`
            : 'ยังรอผู้จัดการอนุมัติที่ศูนย์อนุมัติ',
        });
        onOpenChange(false);
        return;
      }

      const dup = await getDocs(
        query(
          collection(firestore, ATTENDANCE_OVERTIME_REQUESTS_COLLECTION),
          where('subjectKey', '==', subjectKey),
          where('workDateYmd', '==', workDateYmd),
          where('status', '==', 'PENDING_MANAGER_APPROVAL'),
          limit(1),
        ),
      );
      if (!dup.empty) {
        toast({
          variant: 'destructive',
          title: 'มีคำขอค้างอยู่แล้ว',
          description: 'วันนี้มีคำขอ OT ที่รอผู้จัดการอนุมัติอยู่แล้ว',
        });
        return;
      }

      await addDoc(collection(firestore, ATTENDANCE_OVERTIME_REQUESTS_COLLECTION), {
        subjectType,
        subjectId,
        subjectNameSnapshot,
        subjectKey,
        payrollMonth,
        workDateYmd,
        ...payload,
        status: 'PENDING_MANAGER_APPROVAL',
      });

      toast({
        title: isAmend ? 'ส่งคำขอแก้ไข OT แล้ว' : 'ส่งคำขอ OT แล้ว',
        description: isAmend
          ? `จาก ${previousLabel} → ${formatAttendanceHmRange(startHm, endHm)} (${formatAttendanceOvertimeHours(roundedHours)} ชม.) · รอผู้จัดการอนุมัติ`
          : 'รอผู้จัดการ HR / ปฏิบัติการอนุมัติที่ศูนย์อนุมัติ',
      });
      onOpenChange(false);
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'ส่งคำขอไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isLegacyHoursOnlyAmend
              ? 'บันทึกช่วงเวลา OT'
              : isAmend
                ? 'ขอแก้ไขช่วงเวลา OT'
                : 'ขออนุมัติ OT (ล่วงเวลา)'}
          </DialogTitle>
          <DialogDescription>
            {subjectNameSnapshot} · {formatDateThaiBE(workDateYmd)}
            {isLegacyHoursOnlyAmend ? (
              <span className="block text-xs mt-1 text-muted-foreground">
                วันนี้มี OT <span className="font-mono font-semibold text-foreground">{previousLabel}</span> ชม.
                (ยังไม่มีช่วงเวลา) — ระบุเวลาเริ่ม–สิ้นสุดเพื่อคำนวณค่าจ้างตาม HR Settings
              </span>
            ) : isAmend ? (
              <span className="block text-xs mt-1 text-muted-foreground">
                ช่วงเดิม{' '}
                {previousRangeLabel ? (
                  <span className="font-mono font-semibold text-foreground">{previousRangeLabel}</span>
                ) : (
                  <span className="font-mono font-semibold text-foreground">{previousLabel} ชม.</span>
                )}{' '}
                — ระบุช่วงเวลาใหม่และเหตุผล แล้วรอผู้จัดการอนุมัติ
              </span>
            ) : (
              <span className="block text-xs mt-1 text-muted-foreground">
                ระบุเวลาเริ่ม–สิ้นสุด ระบบคำนวณชั่วโมง OT และใช้ตัวคูณ A/B/C จาก HR Settings ตอนอนุมัติ/จ่ายเงินเดือน
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {isAmend ? (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              {hasPreviousTimeRange ? (
                <>
                  <span className="text-muted-foreground">ช่วงเดิม: </span>
                  <span className="font-mono font-semibold">{previousRangeLabel}</span>
                  <span className="text-muted-foreground"> ({previousLabel} ชม.)</span>
                </>
              ) : (
                <>
                  <span className="text-muted-foreground">ชั่วโมงเดิม (ไม่มีช่วงเวลา): </span>
                  <span className="font-mono font-semibold">{previousLabel} ชม.</span>
                </>
              )}
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ot-start">เวลาเริ่ม OT</Label>
              <Input
                id="ot-start"
                type="time"
                value={otStartHm}
                onChange={(e) => setOtStartHm(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ot-end">เวลาสิ้นสุด OT</Label>
              <Input
                id="ot-end"
                type="time"
                value={otEndHm}
                onChange={(e) => setOtEndHm(e.target.value)}
                className="font-mono"
              />
            </div>
          </div>
          {computedHours != null ? (
            <p className="text-sm text-muted-foreground">
              รวม{' '}
              <span className="font-mono font-semibold text-foreground">
                {formatAttendanceOvertimeHours(computedHours)}
              </span>{' '}
              ชม.
            </p>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="ot-reason">เหตุผล (ส่งถึงผู้จัดการ)</Label>
            <Textarea
              id="ot-reason"
              rows={3}
              placeholder={
                isAmend
                  ? 'เช่น ปรับช่วง OT จากที่ขอไว้ เพราะงานเสร็จช้ากว่าแผน'
                  : 'เช่น ทำงานล่วงเวลาเพื่อปิดงานด่วน'
              }
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            ยกเลิก
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting ? 'กำลังส่ง…' : isLegacyHoursOnlyAmend ? 'บันทึกช่วงเวลา' : isAmend ? 'ส่งคำขอแก้ไข' : 'ส่งคำขอ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
