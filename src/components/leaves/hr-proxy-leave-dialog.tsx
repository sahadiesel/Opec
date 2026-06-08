'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  doc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import type { OfficeStaff, User } from '@/lib/types';
import type { OfficeLeaveEntitlementsDoc } from '@/lib/attendance/types';
import {
  OFFICE_LEAVE_REQUESTS_COLLECTION,
  OFFICE_LEAVE_TYPE_LABELS,
  computeRequestedDays,
  isEligibleForVacation,
  leaveTypesForStaff,
  OFFICE_VACATION_ELIGIBILITY_DAYS,
  vacationEligibleFromDate,
} from '@/lib/leaves/policy';
import type { OfficeLeaveHalfDaySession, OfficeLeaveRequestDoc, OfficeLeaveType } from '@/lib/leaves/types';
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
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { formatDateThaiBE } from '@/lib/date-thai';

function todayYmdBkk(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

function bkkYearOfYmd(ymd: string): number {
  const ms = Date.parse(`${ymd.slice(0, 10)}T00:00:00+07:00`);
  if (!Number.isFinite(ms)) return new Date().getFullYear();
  const yStr = new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  return Number(yStr.slice(0, 4));
}

export type HrProxyLeaveDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  firestore: Firestore;
  currentUser: User;
  officeStaff: OfficeStaff[];
  entCfg: OfficeLeaveEntitlementsDoc | null;
  /** เปิดแก้ไขใบลาที่มีอยู่ (DRAFT / SUBMITTED) */
  editLeave?: (OfficeLeaveRequestDoc & { id: string }) | null;
  /** หลังบันทึกสำเร็จ — ให้หน้า HR สลับไปแท็บรายการคำขอ */
  onLeavePersisted?: (result: { id: string; status: OfficeLeaveRequestDoc['status'] }) => void;
};

export function HrProxyLeaveDialog({
  open,
  onOpenChange,
  firestore,
  currentUser,
  officeStaff,
  entCfg,
  editLeave = null,
  onLeavePersisted,
}: HrProxyLeaveDialogProps) {
  const { toast } = useToast();
  const [staffId, setStaffId] = useState<string>('');
  const [leaveType, setLeaveType] = useState<OfficeLeaveType>('SICK');
  const [startDate, setStartDate] = useState(todayYmdBkk());
  const [endDate, setEndDate] = useState(todayYmdBkk());
  const [reason, setReason] = useState('');
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [halfDaySession, setHalfDaySession] = useState<OfficeLeaveHalfDaySession>('MORNING');
  const [draftDocId, setDraftDocId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false);

  const selectedStaff = useMemo(
    () => officeStaff.find((s) => s.id === staffId) ?? null,
    [officeStaff, staffId],
  );

  const allowedTypes = useMemo(
    () => (selectedStaff ? leaveTypesForStaff(selectedStaff) : (['SICK', 'PERSONAL', 'VACATION'] as OfficeLeaveType[])),
    [selectedStaff],
  );

  const eligibleVac = useMemo(() => (selectedStaff ? isEligibleForVacation(selectedStaff) : false), [selectedStaff]);
  const eligibleVacFromRaw = selectedStaff ? vacationEligibleFromDate(selectedStaff) : null;
  const eligibleVacFrom = eligibleVacFromRaw ? formatDateThaiBE(eligibleVacFromRaw) : null;

  const isEditing = !!editLeave?.id;

  useEffect(() => {
    if (!open) return;
    if (editLeave) {
      setDraftDocId(editLeave.id);
      setStaffId(editLeave.staffId);
      setLeaveType(editLeave.leaveType);
      setStartDate(editLeave.startDate.slice(0, 10));
      setEndDate(editLeave.endDate.slice(0, 10));
      setReason(editLeave.reason ?? '');
      setIsHalfDay(!!editLeave.isHalfDay);
      setHalfDaySession(editLeave.halfDaySession ?? 'MORNING');
      return;
    }
    if (!staffId && officeStaff.length) {
      setStaffId(officeStaff[0].id);
    }
  }, [open, editLeave, staffId, officeStaff]);

  useEffect(() => {
    if (!allowedTypes.includes(leaveType)) setLeaveType(allowedTypes[0] ?? 'SICK');
  }, [allowedTypes, leaveType]);

  useEffect(() => {
    if (isHalfDay && startDate) setEndDate(startDate);
  }, [isHalfDay, startDate]);

  const requestedDays = useMemo(
    () => computeRequestedDays(startDate, endDate, isHalfDay),
    [startDate, endDate, isHalfDay],
  );

  function resetForm() {
    setDraftDocId(null);
    setStaffId('');
    setReason('');
    setIsHalfDay(false);
    setStartDate(todayYmdBkk());
    setEndDate(todayYmdBkk());
    setHalfDaySession('MORNING');
    setLeaveType('SICK');
  }

  function closeDialog() {
    onOpenChange(false);
    resetForm();
  }

  function buildPayload(
    status: OfficeLeaveRequestDoc['status'],
  ): Omit<OfficeLeaveRequestDoc, 'status'> & { status: typeof status } {
    if (!selectedStaff) throw new Error('no staff');
    const ts = Date.now();
    return {
      staffId: selectedStaff.id,
      staffNameSnapshot: selectedStaff.fullName,
      staffDepartmentSnapshot: selectedStaff.department || '',
      staffLinkedUserId: selectedStaff.linkedUserId || '',
      leaveType,
      startDate,
      endDate: isHalfDay ? startDate : endDate,
      days: requestedDays,
      reason: reason.trim(),
      isHalfDay,
      halfDaySession: isHalfDay ? halfDaySession : null,
      year: bkkYearOfYmd(startDate),
      status,
      createdByUid: editLeave?.createdByUid ?? currentUser.id,
      createdByName: editLeave?.createdByName ?? (currentUser.displayName || currentUser.email || ''),
      createdAt: editLeave?.createdAt ?? ts,
      updatedAt: ts,
    };
  }

  function draftSaveStatus(): 'DRAFT' | 'SUBMITTED' {
    if (editLeave?.status === 'SUBMITTED') return 'SUBMITTED';
    return 'DRAFT';
  }

  async function handleSaveDraft() {
    if (!selectedStaff || !firestore) return;
    if (!startDate || !endDate || requestedDays <= 0) {
      toast({ variant: 'destructive', title: 'กรุณาเลือกช่วงวันลาให้ถูกต้อง' });
      return;
    }
    if (leaveType === 'VACATION' && !eligibleVac) {
      toast({
        variant: 'destructive',
        title: 'พนักงานคนนี้ยังไม่มีสิทธิ์ลาพักร้อน',
      });
      return;
    }
    setBusy(true);
    try {
      const ts = Date.now();
      if (draftDocId) {
        const p = buildPayload(draftSaveStatus());
        const { createdAt: _c, createdByUid: _u, createdByName: _n, ...upd } = p;
        await updateDoc(doc(firestore, OFFICE_LEAVE_REQUESTS_COLLECTION, draftDocId), {
          ...upd,
          updatedAt: ts,
        });
        toast({
          title: isEditing ? 'บันทึกการแก้ไขแล้ว' : 'บันทึกฉบับร่างแล้ว',
          description: 'ยังไม่เข้าคิวอนุมัติ — กด «ส่งเข้าคิวอนุมัติ» หรือ ⋮ → ส่งให้อนุมัติ',
        });
        onLeavePersisted?.({ id: draftDocId, status: draftSaveStatus() });
      } else {
        const p = buildPayload('DRAFT');
        const ref = await addDoc(collection(firestore, OFFICE_LEAVE_REQUESTS_COLLECTION), {
          ...p,
          createdAt: ts,
          updatedAt: ts,
        });
        setDraftDocId(ref.id);
        toast({
          title: 'สร้างฉบับร่างแล้ว',
          description: 'ยังไม่เข้าคิวอนุมัติ — กด «ส่งเข้าคิวอนุมัติ» เมื่อพร้อม',
        });
        onLeavePersisted?.({ id: ref.id, status: 'DRAFT' });
      }
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'บันทึกร่างไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitConfirmed() {
    if (!selectedStaff || !firestore) return;
    if (!reason.trim()) {
      toast({ variant: 'destructive', title: 'กรุณาระบุเหตุผลก่อนส่งคำขอ' });
      return;
    }
    if (!startDate || !endDate || requestedDays <= 0) {
      toast({ variant: 'destructive', title: 'กรุณาเลือกช่วงวันลาให้ถูกต้อง' });
      return;
    }
    if (leaveType === 'VACATION' && !eligibleVac) {
      toast({ variant: 'destructive', title: 'พนักงานคนนี้ยังไม่มีสิทธิ์ลาพักร้อน' });
      return;
    }
    setConfirmSubmitOpen(false);
    setBusy(true);
    try {
      const ts = Date.now();
      let savedId = draftDocId;
      if (draftDocId) {
        const { createdAt: _c, createdByUid: _u, createdByName: _n, ...upd } = buildPayload('SUBMITTED');
        await updateDoc(doc(firestore, OFFICE_LEAVE_REQUESTS_COLLECTION, draftDocId), {
          ...upd,
          updatedAt: ts,
        });
      } else {
        const raw = buildPayload('SUBMITTED');
        const ref = await addDoc(collection(firestore, OFFICE_LEAVE_REQUESTS_COLLECTION), {
          ...raw,
          createdAt: ts,
          updatedAt: ts,
        });
        savedId = ref.id;
      }
      toast({
        title: 'ส่งคำขอแล้ว',
        description: 'สถานะ «รออนุมัติ» — ดูที่แท็บคำขอทั้งหมด หรือ HR → ศูนย์อนุมัติ → อนุมัติวันลา',
      });
      if (savedId) onLeavePersisted?.({ id: savedId, status: 'SUBMITTED' });
      closeDialog();
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'ส่งไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : closeDialog())}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEditing ? 'แก้ไขใบลา' : 'สร้างใบลาแทนพนักงาน'}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'แก้ไขรายละเอียดใบลา — บันทึกฉบับร่างหรือส่งเข้าคิวอนุมัติได้ตามสถานะเดิม'
                : 'ใช้เมื่อพนักงานไม่สามารถยื่นในระบบได้ — บันทึกร่างหรือส่งเข้าคิวผู้จัดการเหมือนคำขอปกติ'}{' '}
              (ประวัติเก็บใน <span className="font-mono text-xs">leave_requests</span>)
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label>พนักงาน</Label>
              <Select value={staffId} onValueChange={setStaffId} disabled={isEditing}>
                <SelectTrigger>
                  <SelectValue placeholder="เลือกพนักงาน" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {officeStaff.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.fullName} {s.department ? `· ${s.department}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>ประเภทการลา</Label>
              <Select value={leaveType} onValueChange={(v) => setLeaveType(v as OfficeLeaveType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allowedTypes.map((t) => (
                    <SelectItem key={t} value={t}>
                      {OFFICE_LEAVE_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedStaff && !eligibleVac && (
                <p className="text-[11px] text-muted-foreground">
                  ลาพักร้อนเมื่อทำงานครบ {OFFICE_VACATION_ELIGIBILITY_DAYS} วัน
                  {eligibleVacFrom ? ` (มีสิทธิ์ตั้งแต่ ${eligibleVacFrom})` : ''}
                </p>
              )}
            </div>

            <div className="flex items-center gap-3 rounded-md border bg-muted/20 p-3">
              <Switch checked={isHalfDay} onCheckedChange={setIsHalfDay} id="hr-halfday" />
              <Label htmlFor="hr-halfday" className="font-medium cursor-pointer">
                ลาครึ่งวัน
              </Label>
            </div>

            {isHalfDay && (
              <div className="space-y-2">
                <Label>ช่วงเวลา</Label>
                <Select
                  value={halfDaySession}
                  onValueChange={(v) => setHalfDaySession(v as OfficeLeaveHalfDaySession)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MORNING">ครึ่งเช้า</SelectItem>
                    <SelectItem value="AFTERNOON">ครึ่งบ่าย</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>วันเริ่ม</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>วันสิ้นสุด</Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate}
                  disabled={isHalfDay}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>เหตุผล</Label>
              <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="บังคับเมื่อส่งคำขอ — ร่างว่างได้" />
            </div>

            <p className="text-xs text-muted-foreground">
              จำนวนวัน: <span className="font-semibold text-foreground">{requestedDays}</span>
              {draftDocId ? (
                <span className="ml-2 font-mono text-[10px]">draft id: {draftDocId.slice(0, 8)}…</span>
              ) : null}
            </p>
            {!entCfg && (
              <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                ยังไม่ได้ตั้งค่าสิทธิ์ลาใน HR Settings — โควต้าอาจไม่ตรง
              </p>
            )}
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => closeDialog()} disabled={busy}>
              ปิด
            </Button>
            <Button type="button" variant="secondary" onClick={() => void handleSaveDraft()} disabled={busy || !staffId}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isEditing && editLeave?.status === 'SUBMITTED' ? 'บันทึกการแก้ไข' : 'บันทึกฉบับร่าง (ยังไม่เข้าคิว)'}
            </Button>
            <Button type="button" onClick={() => setConfirmSubmitOpen(true)} disabled={busy || !staffId}>
              ส่งเข้าคิวอนุมัติ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmSubmitOpen} onOpenChange={setConfirmSubmitOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันส่งคำขอลาแทนพนักงาน</AlertDialogTitle>
            <AlertDialogDescription>
              คำขอจะปรากฏในคิว &quot;อนุมัติวันลา&quot; ให้ผู้จัดการพิจารณา — ต้องการดำเนินการหรือไม่?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleSubmitConfirmed()}>ยืนยันส่ง</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
