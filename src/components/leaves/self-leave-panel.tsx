'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import { useCollection, useMemoFirebase } from '@/firebase';
import type { OfficeStaff, User } from '@/lib/types';
import type { OfficeLeaveEntitlementsDoc } from '@/lib/attendance/types';
import {
  HR_CONFIGURATION_COLLECTION,
  HR_OFFICE_LEAVE_ENTITLEMENTS_DOC_ID,
} from '@/lib/attendance/constants';
import {
  OFFICE_LEAVE_REQUESTS_COLLECTION,
  OFFICE_LEAVE_TYPE_LABELS,
  OFFICE_LEAVE_STATUS_LABELS,
  computeRequestedDays,
  entitlementForStaff,
  isEligibleForVacation,
  leaveTypesForStaff,
  summarizeYear,
  tenureDays,
  vacationEligibleFromDate,
  OFFICE_VACATION_ELIGIBILITY_DAYS,
} from '@/lib/leaves/policy';
import type {
  OfficeLeaveHalfDaySession,
  OfficeLeaveRequestDoc,
  OfficeLeaveType,
} from '@/lib/leaves/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AlertCircle, CalendarOff, Loader2, Pencil, Plus, Send, Sparkles, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { formatDateThaiBE } from '@/lib/date-thai';
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

function todayYmdBkk(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

function bkkYearOfYmd(ymd: string): number {
  const ms = Date.parse(`${ymd.slice(0, 10)}T00:00:00+07:00`);
  if (!Number.isFinite(ms)) return new Date().getFullYear();
  const yStr = new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  return Number(yStr.slice(0, 4));
}

interface SelfLeavePanelProps {
  firestore: Firestore;
  currentUser: User;
  staff: OfficeStaff;
}

export function SelfLeavePanel({ firestore, currentUser, staff }: SelfLeavePanelProps) {
  const { toast } = useToast();

  /** โหลด entitlement (อ่านครั้งเดียว — settings ไม่เปลี่ยนบ่อย) */
  const [entCfg, setEntCfg] = useState<OfficeLeaveEntitlementsDoc | null>(null);
  const [entLoading, setEntLoading] = useState(true);
  useEffect(() => {
    let cancel = false;
    setEntLoading(true);
    void (async () => {
      try {
        const ref = doc(firestore, HR_CONFIGURATION_COLLECTION, HR_OFFICE_LEAVE_ENTITLEMENTS_DOC_ID);
        const snap = await getDoc(ref);
        if (!cancel) {
          if (snap.exists()) setEntCfg(snap.data() as OfficeLeaveEntitlementsDoc);
          else setEntCfg(null);
        }
      } catch {
        if (!cancel) setEntCfg(null);
      } finally {
        if (!cancel) setEntLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [firestore]);

  /** โหลดประวัติของฉัน (ทุกปี — orderBy createdAt desc) */
  const myLeavesQuery = useMemoFirebase(() => {
    if (!firestore || !staff?.id) return null;
    return query(
      collection(firestore, OFFICE_LEAVE_REQUESTS_COLLECTION),
      where('staffId', '==', staff.id),
      orderBy('createdAt', 'desc'),
    );
  }, [firestore, staff?.id]);

  const { data: myLeaves, isLoading: leavesLoading } = useCollection<OfficeLeaveRequestDoc & { id: string }>(
    myLeavesQuery as any,
  );

  const tenure = useMemo(() => tenureDays(staff), [staff]);
  const eligibleVac = useMemo(() => isEligibleForVacation(staff), [staff]);
  const eligibleVacFrom = useMemo(() => vacationEligibleFromDate(staff), [staff]);
  const allowedTypes = useMemo(() => leaveTypesForStaff(staff), [staff]);

  const currentYear = useMemo(() => bkkYearOfYmd(todayYmdBkk()), []);
  const summary = useMemo(
    () => summarizeYear(staff, currentYear, (myLeaves ?? []) as OfficeLeaveRequestDoc[], entCfg),
    [staff, currentYear, myLeaves, entCfg],
  );

  /** form state */
  const [leaveType, setLeaveType] = useState<OfficeLeaveType>(allowedTypes[0] ?? 'SICK');
  const [startDate, setStartDate] = useState<string>(todayYmdBkk());
  const [endDate, setEndDate] = useState<string>(todayYmdBkk());
  const [reason, setReason] = useState('');
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [halfDaySession, setHalfDaySession] = useState<OfficeLeaveHalfDaySession>('MORNING');
  const [submitBusy, setSubmitBusy] = useState(false);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);
  const [submitFinalOpen, setSubmitFinalOpen] = useState(false);

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

  const remaining = useMemo(() => {
    const ent = entitlementForStaff(staff, entCfg);
    return {
      SICK: Math.max(0, ent.SICK - summary.approvedDays.SICK - summary.pendingDays.SICK),
      PERSONAL: Math.max(0, ent.PERSONAL - summary.approvedDays.PERSONAL - summary.pendingDays.PERSONAL),
      VACATION: Math.max(0, ent.VACATION - summary.approvedDays.VACATION - summary.pendingDays.VACATION),
    };
  }, [staff, entCfg, summary]);

  const overLimit = entCfg
    ? requestedDays > 0 && requestedDays > remaining[leaveType]
    : false;

  function buildPayload(status: 'DRAFT' | 'SUBMITTED'): OfficeLeaveRequestDoc {
    const tsNow = Date.now();
    return {
      staffId: staff.id,
      staffNameSnapshot: staff.fullName,
      staffDepartmentSnapshot: staff.department || '',
      staffLinkedUserId: currentUser.id,
      leaveType,
      startDate,
      endDate: isHalfDay ? startDate : endDate,
      days: requestedDays,
      reason: reason.trim(),
      isHalfDay,
      halfDaySession: isHalfDay ? halfDaySession : null,
      year: bkkYearOfYmd(startDate),
      status,
      createdByUid: currentUser.id,
      createdByName: currentUser.displayName || currentUser.email || '',
      createdAt: tsNow,
      updatedAt: tsNow,
    };
  }

  function resetFormNew() {
    setEditingDraftId(null);
    setReason('');
    setIsHalfDay(false);
    setStartDate(todayYmdBkk());
    setEndDate(todayYmdBkk());
    setHalfDaySession('MORNING');
  }

  function loadDraftRow(row: OfficeLeaveRequestDoc & { id: string }) {
    setEditingDraftId(row.id);
    setLeaveType(row.leaveType);
    setStartDate(row.startDate);
    setEndDate(row.endDate);
    setReason(row.reason || '');
    setIsHalfDay(row.isHalfDay);
    setHalfDaySession((row.halfDaySession as OfficeLeaveHalfDaySession) || 'MORNING');
  }

  /** บันทึกฉบับร่าง — ไม่บังคับเหตุผล */
  async function handleSaveDraft() {
    if (!firestore || !currentUser?.id || !staff?.id) return;
    if (!startDate || !endDate) {
      toast({ variant: 'destructive', title: 'กรุณาเลือกวันเริ่ม–สิ้นสุด' });
      return;
    }
    if (requestedDays <= 0) {
      toast({ variant: 'destructive', title: 'วันที่สิ้นสุดต้องไม่มาก่อนวันเริ่มต้น' });
      return;
    }
    if (leaveType === 'VACATION' && !eligibleVac) {
      toast({
        variant: 'destructive',
        title: 'ยังไม่มีสิทธิ์ลาพักร้อน',
        description: `ต้องทำงานครบ ${OFFICE_VACATION_ELIGIBILITY_DAYS} วันก่อน${eligibleVacFrom ? ` (มีสิทธิ์ตั้งแต่ ${formatDateThaiBE(eligibleVacFrom)})` : ''}`,
      });
      return;
    }
    setSubmitBusy(true);
    try {
      const tsNow = Date.now();
      const payload = buildPayload('DRAFT');
      if (editingDraftId) {
        const { createdAt: _c, ...upd } = payload;
        await updateDoc(doc(firestore, OFFICE_LEAVE_REQUESTS_COLLECTION, editingDraftId), {
          ...upd,
          updatedAt: tsNow,
        });
        toast({ title: 'บันทึกฉบับร่างแล้ว' });
      } else {
        const ref = await addDoc(collection(firestore, OFFICE_LEAVE_REQUESTS_COLLECTION), {
          ...payload,
          createdAt: tsNow,
          updatedAt: tsNow,
        });
        setEditingDraftId(ref.id);
        toast({ title: 'สร้างฉบับร่างแล้ว', description: 'กดส่งเมื่อตรวจสอบครบแล้ว' });
      }
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'บันทึกร่างไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSubmitBusy(false);
    }
  }

  function handleOpenSubmitConfirm() {
    if (!firestore || !currentUser?.id || !staff?.id) return;
    if (!startDate || !endDate) {
      toast({ variant: 'destructive', title: 'กรุณาเลือกวันเริ่ม–สิ้นสุด' });
      return;
    }
    if (requestedDays <= 0) {
      toast({ variant: 'destructive', title: 'วันที่สิ้นสุดต้องไม่มาก่อนวันเริ่มต้น' });
      return;
    }
    if (!reason.trim()) {
      toast({ variant: 'destructive', title: 'กรุณาระบุเหตุผลการลาก่อนส่ง' });
      return;
    }
    if (leaveType === 'VACATION' && !eligibleVac) {
      toast({
        variant: 'destructive',
        title: 'ยังไม่มีสิทธิ์ลาพักร้อน',
        description: `ต้องทำงานครบ ${OFFICE_VACATION_ELIGIBILITY_DAYS} วันก่อน${eligibleVacFrom ? ` (มีสิทธิ์ตั้งแต่ ${formatDateThaiBE(eligibleVacFrom)})` : ''}`,
      });
      return;
    }
    setSubmitConfirmOpen(true);
  }

  async function handleFinalSubmit() {
    if (!firestore || !currentUser?.id || !staff?.id) return;
    setSubmitFinalOpen(false);
    setSubmitConfirmOpen(false);
    setSubmitBusy(true);
    try {
      const tsNow = Date.now();
      const payload = buildPayload('SUBMITTED');
      if (editingDraftId) {
        const { createdAt: _c, ...upd } = payload;
        await updateDoc(doc(firestore, OFFICE_LEAVE_REQUESTS_COLLECTION, editingDraftId), {
          ...upd,
          updatedAt: tsNow,
        });
      } else {
        await addDoc(collection(firestore, OFFICE_LEAVE_REQUESTS_COLLECTION), {
          ...payload,
          createdAt: tsNow,
          updatedAt: tsNow,
        });
      }
      toast({
        title: 'ส่งใบลาเรียบร้อย',
        description: 'เข้าคิวให้ผู้จัดการพิจารณา — ดูสถานะในตารางด้านล่าง',
      });
      resetFormNew();
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'ส่งใบลาไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSubmitBusy(false);
    }
  }

  async function handleCancelDraft(rowId: string) {
    if (!firestore || !currentUser?.id) return;
    setCancelingId(rowId);
    try {
      await updateDoc(doc(firestore, OFFICE_LEAVE_REQUESTS_COLLECTION, rowId), {
        status: 'CANCELLED',
        cancelledAt: serverTimestamp(),
        cancelledByUid: currentUser.id,
        updatedAt: serverTimestamp(),
      });
      toast({ title: 'ยกเลิกฉบับร่างแล้ว' });
      if (editingDraftId === rowId) resetFormNew();
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'ยกเลิกไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setCancelingId(null);
    }
  }

  async function handleCancel(rowId: string) {
    if (!firestore || !currentUser?.id) return;
    setCancelingId(rowId);
    try {
      await updateDoc(doc(firestore, OFFICE_LEAVE_REQUESTS_COLLECTION, rowId), {
        status: 'CANCELLED',
        cancelledAt: serverTimestamp(),
        cancelledByUid: currentUser.id,
        updatedAt: serverTimestamp(),
      });
      toast({ title: 'ยกเลิกคำขอลาแล้ว' });
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'ยกเลิกไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setCancelingId(null);
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <Card className="md:col-span-1">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarOff className="h-5 w-5 text-primary" /> ยื่นใบลาใหม่
            {editingDraftId && (
              <Badge variant="outline" className="text-[10px] font-normal">
                แก้ไขร่าง
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            บันทึกฉบับร่างได้ก่อนส่ง — เมื่อส่งแล้วคำขอจะเข้าคิวให้ผู้จัดการในศูนย์อนุมัติ
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
            {!eligibleVac && (
              <p className="text-[11px] text-muted-foreground">
                ลาพักร้อนเปิดเมื่อทำงานครบ {OFFICE_VACATION_ELIGIBILITY_DAYS} วัน
                {eligibleVacFrom ? ` (มีสิทธิ์ตั้งแต่ ${formatDateThaiBE(eligibleVacFrom)})` : ''}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 rounded-md border bg-muted/20 p-3">
            <Switch checked={isHalfDay} onCheckedChange={setIsHalfDay} id="halfday-switch" />
            <Label htmlFor="halfday-switch" className="font-bold cursor-pointer">
              ลาครึ่งวัน (0.5 วัน)
            </Label>
          </div>

          {isHalfDay && (
            <div className="space-y-2">
              <Label>ช่วงเวลาที่ลา</Label>
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
              <Label>วันเริ่มลา</Label>
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
            <Label>เหตุผลการลา</Label>
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="ระบุรายละเอียด..."
            />
          </div>

          <div className="text-xs text-muted-foreground">
            จำนวนวันที่ลา: <span className="font-semibold text-foreground">{requestedDays}</span> วัน
            {entCfg && (
              <>
                {' · '}สิทธิ์คงเหลือ {OFFICE_LEAVE_TYPE_LABELS[leaveType]}:{' '}
                <span className={`font-semibold ${overLimit ? 'text-destructive' : 'text-foreground'}`}>
                  {remaining[leaveType]}
                </span>{' '}
                วัน
              </>
            )}
          </div>

          {overLimit && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>ลาครั้งนี้เกินสิทธิ์ที่เหลือ — สามารถส่งได้ แต่ HR อาจไม่อนุมัติส่วนเกิน</span>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => void handleSaveDraft()}
              disabled={submitBusy}
              className="w-full gap-2"
            >
              {submitBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              บันทึกฉบับร่าง
            </Button>
            <Button
              type="button"
              onClick={() => handleOpenSubmitConfirm()}
              disabled={submitBusy}
              className="w-full gap-2"
            >
              <Send className="h-4 w-4" />
              ส่งคำขอ (เข้าคิวอนุมัติ)
            </Button>
            {(editingDraftId || reason.trim() || startDate !== todayYmdBkk()) && (
              <Button type="button" variant="ghost" size="sm" className="w-full gap-1" onClick={() => resetFormNew()}>
                <Plus className="h-4 w-4" /> เริ่มฟอร์มใหม่
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="md:col-span-2 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" /> สิทธิ์การลาของคุณ — ปี {currentYear}
            </CardTitle>
            <CardDescription>
              อายุงาน {tenure.toLocaleString('th-TH')} วัน
              {eligibleVac
                ? ' · ครบสิทธิ์ลาพักร้อน'
                : ` · ลาพักร้อนเปิด ${OFFICE_VACATION_ELIGIBILITY_DAYS} วันขึ้นไป${eligibleVacFrom ? ` (เริ่ม ${formatDateThaiBE(eligibleVacFrom)})` : ''}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {entLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : !entCfg ? (
              <p className="text-sm text-muted-foreground">
                ยังไม่ได้ตั้งค่าสิทธิ์การลาในระบบ — โปรดให้ HR ตั้งค่าจากหน้า{' '}
                <span className="font-mono">/hr/settings</span>
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ประเภท</TableHead>
                    <TableHead className="text-center">สิทธิ์/ปี</TableHead>
                    <TableHead className="text-center">ลาแล้ว (อนุมัติ)</TableHead>
                    <TableHead className="text-center">รออนุมัติ</TableHead>
                    <TableHead className="text-center">คงเหลือ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(['SICK', 'PERSONAL', 'VACATION'] as OfficeLeaveType[]).map((t) => {
                    const ent = summary.entitlement[t];
                    const used = summary.approvedDays[t];
                    const pending = summary.pendingDays[t];
                    const remain = Math.max(0, ent - used - pending);
                    const dimmed = t === 'VACATION' && !eligibleVac;
                    return (
                      <TableRow key={t} className={dimmed ? 'opacity-60' : ''}>
                        <TableCell>
                          {OFFICE_LEAVE_TYPE_LABELS[t]}
                          {dimmed && (
                            <Badge variant="outline" className="ml-2 text-[9px] h-4">
                              ยังไม่เปิดสิทธิ์
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-center font-mono">{ent}</TableCell>
                        <TableCell className="text-center font-mono">{used}</TableCell>
                        <TableCell className="text-center font-mono text-amber-700">{pending}</TableCell>
                        <TableCell className="text-center font-mono font-semibold">{remain}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">ประวัติคำขอลาของคุณ</CardTitle>
            <CardDescription>เรียงจากใหม่ → เก่า</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {leavesLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : (myLeaves ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">ยังไม่มีคำขอลา</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>วันที่ลา</TableHead>
                    <TableHead>ประเภท</TableHead>
                    <TableHead className="text-center">วัน</TableHead>
                    <TableHead>สถานะ</TableHead>
                    <TableHead>หมายเหตุ</TableHead>
                    <TableHead className="text-right">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(myLeaves ?? []).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {formatDateThaiBE(r.startDate)}
                        {!r.isHalfDay && r.endDate !== r.startDate
                          ? ` – ${formatDateThaiBE(r.endDate)}`
                          : r.isHalfDay
                            ? ` (${r.halfDaySession === 'MORNING' ? 'ครึ่งเช้า' : 'ครึ่งบ่าย'})`
                            : ''}
                      </TableCell>
                      <TableCell>{OFFICE_LEAVE_TYPE_LABELS[r.leaveType]}</TableCell>
                      <TableCell className="text-center font-mono">{r.days}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            r.status === 'APPROVED'
                              ? 'default'
                              : r.status === 'REJECTED'
                                ? 'destructive'
                                : r.status === 'CANCELLED'
                                  ? 'outline'
                                  : r.status === 'DRAFT'
                                    ? 'outline'
                                    : 'secondary'
                          }
                        >
                          {OFFICE_LEAVE_STATUS_LABELS[r.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate" title={r.reason}>
                        {r.reason}
                        {r.status === 'REJECTED' && r.rejectReason ? ` · ${r.rejectReason}` : ''}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {r.status === 'DRAFT' && r.createdByUid === currentUser.id && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                title="แก้ไขร่าง"
                                onClick={() => loadDraftRow(r)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive h-8 w-8"
                                disabled={!!cancelingId}
                                onClick={() => void handleCancelDraft(r.id)}
                                title="ยกเลิกร่าง"
                              >
                                {cancelingId === r.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <X className="h-4 w-4" />
                                )}
                              </Button>
                            </>
                          )}
                          {r.status === 'SUBMITTED' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive h-8 w-8"
                              disabled={!!cancelingId}
                              onClick={() => void handleCancel(r.id)}
                              title="ยกเลิกคำขอ"
                            >
                              {cancelingId === r.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <X className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={submitConfirmOpen} onOpenChange={setSubmitConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ตรวจสอบก่อนส่ง</AlertDialogTitle>
            <AlertDialogDescription className="text-left space-y-2">
              <span className="block">
                คุณได้ตรวจสอบความถูกต้องของข้อมูลและสิทธิ์การลาของคุณเรียบร้อยแล้วหรือไม่?
              </span>
              <span className="block font-medium text-foreground">
                ยืนยันส่งให้ฝ่ายบุคคล / ผู้จัดการพิจารณาหรือไม่?
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setSubmitConfirmOpen(false);
                setSubmitFinalOpen(true);
              }}
            >
              ถัดไป
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={submitFinalOpen} onOpenChange={setSubmitFinalOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันการส่งคำขอลา</AlertDialogTitle>
            <AlertDialogDescription>
              กดยืนยันเพื่อส่งคำขอเข้าระบบ — คุณจะไม่สามารถแก้ไขได้หลังส่ง (ยกเลิกได้เมื่อสถานะยังรออนุมัติ)
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setSubmitFinalOpen(false);
              }}
            >
              กลับ
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleFinalSubmit()}>ยืนยัน</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
