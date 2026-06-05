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
import { ATTENDANCE_CORRECTION_REQUESTS_COLLECTION } from '@/lib/attendance/constants';
import { formatBangkokHmFromUtcMs, utcMsFromBangkokYmdAndHm } from '@/lib/attendance/bangkok-calendar';
import { formatDateThaiBE } from '@/lib/date-thai';

export function AttendanceCorrectionRequestDialog({
  open,
  onOpenChange,
  firestore,
  currentUser,
  subjectType,
  subjectId,
  subjectNameSnapshot,
  payrollMonth,
  workDateYmd,
  previousInAtMs,
  previousOutAtMs,
  previousInPunchId,
  previousOutPunchId,
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
  previousInAtMs: number | null;
  previousOutAtMs: number | null;
  previousInPunchId?: string | null;
  previousOutPunchId?: string | null;
}) {
  const { toast } = useToast();
  const [inHm, setInHm] = useState('');
  const [outHm, setOutHm] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const subjectKey = useMemo(() => `${subjectType}:${subjectId}`, [subjectType, subjectId]);

  const defaultsLabel = useMemo(() => {
    const pi = previousInAtMs != null ? formatBangkokHmFromUtcMs(previousInAtMs) : '';
    const po = previousOutAtMs != null ? formatBangkokHmFromUtcMs(previousOutAtMs) : '';
    return `ปัจจุบันในระบบ: เข้า ${pi || '—'} · ออก ${po || '—'}`;
  }, [previousInAtMs, previousOutAtMs]);

  useEffect(() => {
    if (!open) return;
    setInHm(previousInAtMs != null ? formatBangkokHmFromUtcMs(previousInAtMs) : '');
    setOutHm(previousOutAtMs != null ? formatBangkokHmFromUtcMs(previousOutAtMs) : '');
    setReason('');
  }, [open, previousInAtMs, previousOutAtMs, workDateYmd]);

  const handleSubmit = async () => {
    if (!firestore) return;
    const r = reason.trim();
    if (r.length < 3) {
      toast({ variant: 'destructive', title: 'ระบุเหตุผล', description: 'กรุณากรอกเหตุผลขอแก้ไขอย่างน้อย 3 ตัวอักษร' });
      return;
    }

    const inTrim = inHm.trim();
    const outTrim = outHm.trim();

    if (!inTrim && !outTrim) {
      toast({
        variant: 'destructive',
        title: 'ไม่มีเวลาที่ขอแก้',
        description: 'กรอกเวลาเข้าและ/หรือเวลาออกที่ต้องการให้ระบบใช้',
      });
      return;
    }

    const proposedInAtMs = inTrim ? utcMsFromBangkokYmdAndHm(workDateYmd, inTrim) : null;
    const proposedOutAtMs = outTrim ? utcMsFromBangkokYmdAndHm(workDateYmd, outTrim) : null;

    if ((inTrim && proposedInAtMs == null) || (outTrim && proposedOutAtMs == null)) {
      toast({ variant: 'destructive', title: 'รูปแบบเวลาไม่ถูกต้อง', description: 'ใช้รูปแบบ HH:mm เช่น 08:30 หรือ 08.30' });
      return;
    }

    setSubmitting(true);
    try {
      const dup = await getDocs(
        query(
          collection(firestore, ATTENDANCE_CORRECTION_REQUESTS_COLLECTION),
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
          description: 'วันนี้มีคำขอแก้ไขที่รอผู้จัดการอนุมัติอยู่แล้ว',
        });
        return;
      }

      const now = Date.now();
      await addDoc(collection(firestore, ATTENDANCE_CORRECTION_REQUESTS_COLLECTION), {
        subjectType,
        subjectId,
        subjectNameSnapshot,
        subjectKey,
        payrollMonth,
        workDateYmd,
        previousInAtMs,
        previousOutAtMs,
        proposedInAtMs,
        proposedOutAtMs,
        previousInPunchId: previousInPunchId ?? null,
        previousOutPunchId: previousOutPunchId ?? null,
        reason: r,
        status: 'PENDING_MANAGER_APPROVAL',
        requestedByUid: currentUser.id,
        requestedByName: currentUser.displayName || currentUser.email || currentUser.id,
        requestedAt: now,
      });

      toast({ title: 'ส่งคำขอแล้ว', description: 'รอผู้จัดการ HR / ปฏิบัติการอนุมัติที่ศูนย์อนุมัติ' });
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
          <DialogTitle>ขอแก้ไขเวลาลงเวลา</DialogTitle>
          <DialogDescription>
            {subjectNameSnapshot} · {formatDateThaiBE(workDateYmd)}
            <span className="block text-xs mt-1 text-muted-foreground">{defaultsLabel}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="corr-in">เวลาเข้า (HH:mm)</Label>
              <Input
                id="corr-in"
                placeholder="เช่น 08:30"
                value={inHm}
                onChange={(e) => setInHm(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="corr-out">เวลาออก (HH:mm)</Label>
              <Input
                id="corr-out"
                placeholder="เช่น 17:15"
                value={outHm}
                onChange={(e) => setOutHm(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="corr-reason">เหตุผล (ส่งถึงผู้จัดการ)</Label>
            <Textarea
              id="corr-reason"
              rows={3}
              placeholder="เช่น ลืมสแกนเข้า / เครื่องสแกนคลาดเคลื่อน"
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
