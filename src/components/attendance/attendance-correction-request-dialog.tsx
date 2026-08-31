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
import {
  deriveLegacyInOutFromFourSlots,
  formatFourSlotTimesLabelTh,
  fourSlotHasAnyTime,
  fourSlotHmFromMs,
  parseFourSlotHmToMs,
  type AttendanceFourSlotTimesMs,
} from '@/lib/attendance/attendance-four-slot-times';
import { formatDateThaiBE } from '@/lib/date-thai';

const SLOT_FIELDS = [
  { key: 'morningInHm' as const, id: 'corr-morning-in', label: 'เข้าเช้า (HH:mm)' },
  { key: 'morningOutHm' as const, id: 'corr-morning-out', label: 'ออกเที่ยง (HH:mm)' },
  { key: 'afternoonInHm' as const, id: 'corr-afternoon-in', label: 'เข้าบ่าย (HH:mm)' },
  { key: 'afternoonOutHm' as const, id: 'corr-afternoon-out', label: 'ออกเย็น (HH:mm)' },
];

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
  previousSlots,
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
  previousSlots: AttendanceFourSlotTimesMs;
  previousInPunchId?: string | null;
  previousOutPunchId?: string | null;
}) {
  const { toast } = useToast();
  const [morningInHm, setMorningInHm] = useState('');
  const [morningOutHm, setMorningOutHm] = useState('');
  const [afternoonInHm, setAfternoonInHm] = useState('');
  const [afternoonOutHm, setAfternoonOutHm] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const subjectKey = useMemo(() => `${subjectType}:${subjectId}`, [subjectType, subjectId]);

  const defaultsLabel = useMemo(
    () => formatFourSlotTimesLabelTh(previousSlots),
    [previousSlots],
  );

  const hmSetters = {
    morningInHm: setMorningInHm,
    morningOutHm: setMorningOutHm,
    afternoonInHm: setAfternoonInHm,
    afternoonOutHm: setAfternoonOutHm,
  } as const;

  const hmValues = { morningInHm, morningOutHm, afternoonInHm, afternoonOutHm };

  useEffect(() => {
    if (!open) return;
    const hm = fourSlotHmFromMs(previousSlots);
    setMorningInHm(hm.morningInHm);
    setMorningOutHm(hm.morningOutHm);
    setAfternoonInHm(hm.afternoonInHm);
    setAfternoonOutHm(hm.afternoonOutHm);
    setReason('');
  }, [open, previousSlots, workDateYmd]);

  const handleSubmit = async () => {
    if (!firestore) return;
    const r = reason.trim();
    if (r.length < 3) {
      toast({ variant: 'destructive', title: 'ระบุเหตุผล', description: 'กรุณากรอกเหตุผลขอแก้ไขอย่างน้อย 3 ตัวอักษร' });
      return;
    }

    const parsed = parseFourSlotHmToMs(workDateYmd, hmValues);
    if (parsed.error) {
      toast({ variant: 'destructive', title: 'รูปแบบเวลาไม่ถูกต้อง', description: parsed.error });
      return;
    }

    if (!fourSlotHasAnyTime(parsed.slots)) {
      toast({
        variant: 'destructive',
        title: 'ไม่มีเวลาที่ขอแก้',
        description: 'กรอกอย่างน้อย 1 ช่วงเวลาที่ต้องการให้ระบบใช้',
      });
      return;
    }

    const previousLegacy = deriveLegacyInOutFromFourSlots(previousSlots);
    const proposedLegacy = deriveLegacyInOutFromFourSlots(parsed.slots);

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
        previousInAtMs: previousLegacy.inAtMs,
        previousOutAtMs: previousLegacy.outAtMs,
        proposedInAtMs: proposedLegacy.inAtMs,
        proposedOutAtMs: proposedLegacy.outAtMs,
        previousMorningInAtMs: previousSlots.morningInAtMs,
        previousMorningOutAtMs: previousSlots.morningOutAtMs,
        previousAfternoonInAtMs: previousSlots.afternoonInAtMs,
        previousAfternoonOutAtMs: previousSlots.afternoonOutAtMs,
        proposedMorningInAtMs: parsed.slots.morningInAtMs,
        proposedMorningOutAtMs: parsed.slots.morningOutAtMs,
        proposedAfternoonInAtMs: parsed.slots.afternoonInAtMs,
        proposedAfternoonOutAtMs: parsed.slots.afternoonOutAtMs,
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>ขอแก้ไขเวลาลงเวลา</DialogTitle>
          <DialogDescription>
            {subjectNameSnapshot} · {formatDateThaiBE(workDateYmd)}
            <span className="block text-xs mt-1 text-muted-foreground leading-snug">{defaultsLabel}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            {SLOT_FIELDS.map(({ key, id, label }) => (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={id}>{label}</Label>
                <Input
                  id={id}
                  placeholder="เช่น 08:30"
                  value={hmValues[key]}
                  onChange={(e) => hmSetters[key](e.target.value)}
                  autoComplete="off"
                  className="font-mono"
                />
              </div>
            ))}
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
