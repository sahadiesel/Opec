'use client';

import { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, getDocs, limit, query, where } from 'firebase/firestore';
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
}) {
  const { toast } = useToast();
  const [otHours, setOtHours] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const subjectKey = useMemo(() => `${subjectType}:${subjectId}`, [subjectType, subjectId]);

  useEffect(() => {
    if (!open) return;
    setOtHours('');
    setReason('');
  }, [open, workDateYmd]);

  const handleSubmit = async () => {
    if (!firestore) return;
    const r = reason.trim();
    if (r.length < 3) {
      toast({ variant: 'destructive', title: 'ระบุเหตุผล', description: 'กรุณากรอกเหตุผลอย่างน้อย 3 ตัวอักษร' });
      return;
    }
    const hours = Number(otHours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      toast({
        variant: 'destructive',
        title: 'ชั่วโมง OT ไม่ถูกต้อง',
        description: 'กรอกจำนวนชั่วโมงมากกว่า 0 และไม่เกิน 24 ชม./วัน',
      });
      return;
    }

    setSubmitting(true);
    try {
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

      const now = Date.now();
      await addDoc(collection(firestore, ATTENDANCE_OVERTIME_REQUESTS_COLLECTION), {
        subjectType,
        subjectId,
        subjectNameSnapshot,
        subjectKey,
        payrollMonth,
        workDateYmd,
        requestedOtHours: Math.round(hours * 100) / 100,
        reason: r,
        status: 'PENDING_MANAGER_APPROVAL',
        requestedByUid: currentUser.id,
        requestedByName: currentUser.displayName || currentUser.email || currentUser.id,
        requestedAt: now,
      });

      toast({ title: 'ส่งคำขอ OT แล้ว', description: 'รอผู้จัดการ HR / ปฏิบัติการอนุมัติที่ศูนย์อนุมัติ' });
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
          <DialogTitle>ขออนุมัติ OT (ล่วงเวลา)</DialogTitle>
          <DialogDescription>
            {subjectNameSnapshot} · {formatDateThaiBE(workDateYmd)}
            <span className="block text-xs mt-1 text-muted-foreground">
              ผู้จัดการจะปรับจำนวนชั่วโมงที่อนุมัติได้ — ค่า OT คำนวณจากเงินเดือนรายวันและตัวคูณใน HR Settings
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="ot-hours">จำนวนชั่วโมง OT ที่ขอ</Label>
            <Input
              id="ot-hours"
              type="number"
              min={0.25}
              max={24}
              step={0.25}
              placeholder="เช่น 2"
              value={otHours}
              onChange={(e) => setOtHours(e.target.value)}
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ot-reason">เหตุผล (ส่งถึงผู้จัดการ)</Label>
            <Textarea
              id="ot-reason"
              rows={3}
              placeholder="เช่น ทำงานล่วงเวลาเพื่อปิดงานด่วน"
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
            {submitting ? 'กำลังส่ง…' : 'ส่งคำขอ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
