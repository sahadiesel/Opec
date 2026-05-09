'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2, UserCircle, KeyRound, Clock } from 'lucide-react';
import { SubjectAttendanceHistory } from '@/components/attendance/subject-attendance-history';
import { useFirestore, useCollection, useMemoFirebase, useAuth } from '@/firebase';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import {
  addDoc,
  collection,
  collectionGroup,
  doc,
  getDoc,
  limit,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getEffectiveSimpleRole } from '@/lib/simple-tier-model';
import { sanitizeFirestorePayload } from '@/lib/utils';
import type { OfficeStaff } from '@/lib/types';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';
import { fetchLinkedPersonnelForUser } from '@/lib/hr/linked-personnel';
import type {
  CashAdvanceRequest,
  OfficePayrollLine,
  PayrollBatchLine,
  PayrollPolicyRecord,
  User,
} from '@/lib/types';
import { HR_WORKER_GLOBAL_LABOR_POLICY_ID } from '@/lib/payroll/d8/hr-statutory-policy-ids';
import {
  type WorkerGlobalLaborContext,
  workerGlobalLaborContextFromPolicy,
} from '@/lib/payroll/worker-global-labor-policy';
import { formatDateThaiBE, formatDateTimeThaiBE, formatYmdLocalThaiBE } from '@/lib/date-thai';
import { WEEKLY_REST_OPTIONS } from '@/lib/contract-position-rate-extras';
import { generateNextDocumentCode } from '@/lib/services/numbering-service';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';

function workerBatchLinePitBaht(line: PayrollBatchLine): number {
  const br = line.deductionsBreakdown || {};
  const direct =
    Number(br['pit_withholding']) ||
    Number(br['PIT_WITHHOLDING']) ||
    Number(br['pit']) ||
    Number(br['PIT']) ||
    0;
  if (Number.isFinite(direct) && direct > 0) return direct;
  const snapDed = line.d8Snapshot?.deductions as Record<string, number> | undefined;
  if (snapDed && typeof snapDed === 'object') {
    const v =
      Number(snapDed.pit_withholding) ||
      Number(snapDed.PIT_WITHHOLDING) ||
      Number(snapDed.pit) ||
      Number(snapDed.PIT) ||
      0;
    if (Number.isFinite(v) && v > 0) return v;
  }
  return 0;
}

function fmtBahtDisplay(n: number | undefined): string {
  if (n === undefined || n === null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 });
}

function payrollBandLabel(b?: OfficeStaff['payrollBand']) {
  if (b === 'EXECUTIVE') return 'ผู้บริหาร (Executive payroll)';
  if (b === 'OFFICE') return 'พนักงานสำนักงาน (Office payroll)';
  return '—';
}

function salaryTypeLabel(t?: OfficeStaff['salaryType']) {
  if (t === 'MONTHLY') return 'รายเดือน (MONTHLY)';
  if (t === 'DAILY') return 'รายวัน (DAILY)';
  return '—';
}

function employmentTypeLabel(t?: OfficeStaff['employmentType']) {
  if (t === 'FULL_TIME') return 'ประจำ (FULL_TIME)';
  if (t === 'PART_TIME') return 'พาร์ทไทม์ (PART_TIME)';
  if (t === 'CONTRACT') return 'สัญญาจ้าง (CONTRACT)';
  return '—';
}

function ssStatusLabel(s?: OfficeStaff['socialSecurityStatus']) {
  if (s === 'ENROLLED') return 'รับประกันสังคม';
  if (s === 'EXEMPT') return 'ไม่รับประกันสังคม / ยกเว้น';
  return '—';
}

export default function MyProfilePage() {
  const router = useRouter();
  const firestore = useFirestore();
  const auth = useAuth();
  const { toast } = useToast();
  const { currentUser, isLoading: userLoading } = useAppUser();

  const ok = useMemo(() => !!currentUser && canView(currentUser, 'employee_self_profile'), [currentUser]);

  const [linkedLoad, setLinkedLoad] = useState(true);
  const [linked, setLinked] = useState<Awaited<ReturnType<typeof fetchLinkedPersonnelForUser>>>(null);

  const loadLinked = useCallback(async () => {
    if (!firestore || !currentUser?.id) {
      setLinked(null);
      setLinkedLoad(false);
      return;
    }
    setLinkedLoad(true);
    try {
      const r = await fetchLinkedPersonnelForUser(firestore, currentUser.id);
      setLinked(r);
    } catch (e: unknown) {
      console.error('[my-profile] linked personnel', e);
      setLinked(null);
      toast({
        variant: 'destructive',
        title: 'โหลดการผูกทะเบียนไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLinkedLoad(false);
    }
  }, [firestore, currentUser?.id, toast]);

  useEffect(() => {
    void loadLinked();
  }, [loadLinked]);

  useEffect(() => {
    if (linked?.kind !== 'office_staff') return;
    const r = linked.record;
    setOfficeForm({
      fullName: r.fullName ?? '',
      nickname: r.nickname ?? '',
      phone: r.phone ?? '',
      nationalId: r.nationalId ?? '',
      address: r.address ?? '',
      emergencyContactName: r.emergencyContactName ?? '',
      emergencyContactRelation: r.emergencyContactRelation ?? '',
      emergencyContactPhone: r.emergencyContactPhone ?? '',
    });
  }, [linked]);

  const canSelfEditOfficeStaffProfile = useMemo(
    () => linked?.kind === 'office_staff' && getEffectiveSimpleRole(currentUser) === 'employee_self',
    [linked, currentUser],
  );

  const saveOfficePersonal = async () => {
    if (!firestore || !currentUser || linked?.kind !== 'office_staff') return;
    if (!canSelfEditOfficeStaffProfile) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์แก้ไขทะเบียนนี้' });
      return;
    }
    setOfficePersonalBusy(true);
    try {
      const now = Date.now();
      await updateDoc(
        doc(firestore, 'office_staff', linked.record.id),
        sanitizeFirestorePayload({
          ...officeForm,
          updatedAt: now,
          updatedBy: currentUser.displayName || currentUser.email || currentUser.id,
        } as Partial<OfficeStaff>),
      );
      toast({ title: 'บันทึกข้อมูลส่วนตัวแล้ว' });
      void loadLinked();
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'บันทึกไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setOfficePersonalBusy(false);
    }
  };

  const myAdvancesQ = useMemoFirebase(() => {
    if (!firestore || !currentUser?.id) return null;
    return query(collection(firestore, 'cash_advance_requests'), where('subjectLinkedUserId', '==', currentUser.id));
  }, [firestore, currentUser?.id]);

  const { data: myAdvances, isLoading: advLoading } = useCollection<CashAdvanceRequest>(myAdvancesQ as any);

  const [advAmount, setAdvAmount] = useState('');
  const [advReason, setAdvReason] = useState('');
  const [advBusy, setAdvBusy] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);

  const [officePersonalBusy, setOfficePersonalBusy] = useState(false);
  const [officeForm, setOfficeForm] = useState({
    fullName: '',
    nickname: '',
    phone: '',
    nationalId: '',
    address: '',
    emergencyContactName: '',
    emergencyContactRelation: '',
    emergencyContactPhone: '',
  });

  const [workerLaborView, setWorkerLaborView] = useState<WorkerGlobalLaborContext | null>(null);
  const [workerLaborLoad, setWorkerLaborLoad] = useState(false);

  useEffect(() => {
    if (!firestore || !linked) {
      setWorkerLaborView(null);
      return;
    }
    setWorkerLaborLoad(true);
    void (async () => {
      try {
        const snap = await getDoc(doc(firestore, 'payroll_policies', HR_WORKER_GLOBAL_LABOR_POLICY_ID));
        const rec = snap.exists()
          ? ({ id: snap.id, ...(snap.data() as Omit<PayrollPolicyRecord, 'id'>) } as PayrollPolicyRecord)
          : null;
        setWorkerLaborView(workerGlobalLaborContextFromPolicy(rec));
      } catch {
        setWorkerLaborView(workerGlobalLaborContextFromPolicy(null));
      } finally {
        setWorkerLaborLoad(false);
      }
    })();
  }, [firestore, linked]);

  /** ไม่ใช้ orderBy — collection group + orderBy ต้องการ composite index ที่ Firebase มักยังสร้างไม่ทัน; เรียงฝั่ง client แทน */
  const myPayrollLinesQuery = useMemoFirebase(() => {
    if (!firestore || !linked) return null;
    if (linked.kind === 'office_staff') {
      return query(
        collectionGroup(firestore, 'lines'),
        where('staffId', '==', linked.record.id),
        limit(120),
      );
    }
    if (linked.kind === 'worker') {
      return query(
        collectionGroup(firestore, 'lines'),
        where('workerId', '==', linked.record.id),
        limit(120),
      );
    }
    return null;
  }, [firestore, linked]);

  const { data: myPayrollLinesRaw, isLoading: myPayrollLinesLoading } = useCollection<
    OfficePayrollLine | PayrollBatchLine
  >(myPayrollLinesQuery as any);

  const myPayrollLines = useMemo(() => {
    const rows = myPayrollLinesRaw ?? [];
    const ts = (r: OfficePayrollLine | PayrollBatchLine) => {
      const x = r as OfficePayrollLine & PayrollBatchLine & { createdAt?: number; updatedAt?: number };
      return Number(x.updatedAt ?? x.createdAt ?? x.financePaidAt ?? 0) || 0;
    };
    return [...rows].sort((a, b) => ts(b) - ts(a)).slice(0, 48);
  }, [myPayrollLinesRaw]);

  const handleChangePassword = async () => {
    const u = auth.currentUser;
    const email = currentUser?.email?.trim();
    if (!u || !email) {
      toast({ variant: 'destructive', title: 'ไม่พบบัญชีอีเมล/รหัสผ่านสำหรับเปลี่ยนรหัส' });
      return;
    }
    if (newPassword.length < 6) {
      toast({
        variant: 'destructive',
        title: 'รหัสใหม่สั้นเกินไป',
        description: 'Firebase กำหนดอย่างน้อย 6 ตัวอักษร',
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ variant: 'destructive', title: 'ยืนยันรหัสผ่านไม่ตรงกัน' });
      return;
    }
    setPasswordBusy(true);
    try {
      const cred = EmailAuthProvider.credential(email, currentPassword);
      await reauthenticateWithCredential(u, cred);
      await updatePassword(u, newPassword);
      toast({ title: 'เปลี่ยนรหัสผ่านแล้ว' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({
        variant: 'destructive',
        title: 'เปลี่ยนรหัสไม่สำเร็จ',
        description: msg.includes('auth/wrong-password')
          ? 'รหัสผ่านปัจจุบันไม่ถูกต้อง'
          : msg,
      });
    } finally {
      setPasswordBusy(false);
    }
  };

  const submitOwnAdvance = async () => {
    if (!firestore || !currentUser || !linked) {
      toast({ variant: 'destructive', title: 'ยังไม่มีทะเบียนผูกบัญชี — ติดต่อ HR' });
      return;
    }
    const amt = Number(advAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast({ variant: 'destructive', title: 'จำนวนเงินไม่ถูกต้อง' });
      return;
    }
    setAdvBusy(true);
    try {
      const { code: requestNo } = await generateNextDocumentCode(firestore, 'cash_advance', {
        actor: currentUser.displayName,
      });
      const now = Date.now();
      const base = {
        requestNo,
        origin: 'employee' as const,
        status: 'PENDING_PAYROLL_REVIEW' as const,
        subjectLinkedUserId: currentUser.id,
        amountBaht: amt,
        reason: advReason.trim() || '-',
        createdAt: now,
        createdByUid: currentUser.id,
        createdByName: currentUser.displayName || currentUser.email,
        updatedAt: now,
      };
      const row =
        linked.kind === 'worker'
          ? {
              ...base,
              subjectType: 'worker' as const,
              workerId: linked.record.id,
              subjectNameSnapshot: `${linked.record.firstName} ${linked.record.lastName} (${linked.record.workerCode})`,
            }
          : {
              ...base,
              subjectType: 'office_staff' as const,
              officeStaffId: linked.record.id,
              subjectNameSnapshot: `${linked.record.fullName} (${linked.record.staffCode})`,
            };
      const ref = await addDoc(collection(firestore, 'cash_advance_requests'), row);
      toast({ title: 'ส่งคำขอแล้ว', description: 'รอฝ่าย Payroll ตรวจสอบ' });
      setAdvAmount('');
      setAdvReason('');
      router.push(`/hr/cash-advances/${ref.id}`);
    } catch (e: unknown) {
      toast({ variant: 'destructive', title: 'ไม่สำเร็จ', description: e instanceof Error ? e.message : String(e) });
    } finally {
      setAdvBusy(false);
    }
  };

  const confirmOfficeAdvance = async (docId: string) => {
    if (!firestore) return;
    setAdvBusy(true);
    try {
      await updateDoc(doc(firestore, 'cash_advance_requests', docId), {
        status: 'PENDING_PAYROLL_REVIEW',
        subjectConfirmedAt: Date.now(),
        updatedAt: Date.now(),
      });
      toast({ title: 'ยืนยันแล้ว' });
      void loadLinked();
    } catch (e: unknown) {
      toast({ variant: 'destructive', title: 'ไม่สำเร็จ', description: e instanceof Error ? e.message : String(e) });
    } finally {
      setAdvBusy(false);
    }
  };

  if (userLoading || !currentUser) return null;

  if (!ok) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-lg mx-auto py-16 text-center text-muted-foreground">ไม่มีสิทธิ์เข้าเมนูนี้</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-6xl mx-auto space-y-6 px-1 sm:px-0">
        <div className="flex items-center gap-3">
          <UserCircle className="h-10 w-10 text-primary shrink-0" />
          <div>
            <h1 className="text-2xl font-bold text-primary">My Profile</h1>
            <p className="text-sm text-muted-foreground">
              ข้อมูลส่วนตัวและแบบฟอร์มที่เกี่ยวข้อง — เชื่อมจากทะเบียนที่ผูก <code className="text-xs">linkedUserId</code> กับบัญชีของคุณ
            </p>
          </div>
        </div>

        {linkedLoad ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : !linked ? (
          <Card className="border-amber-300 bg-amber-50/50">
            <CardHeader>
              <CardTitle className="text-base text-amber-900">ยังไม่พบการผูกทะเบียน</CardTitle>
              <CardDescription className="text-amber-800">
                ให้ HR ตั้งค่า <strong>linkedUserId</strong> ในแฟ้มพนักงานออฟฟิศหรือลูกจ้างให้ตรงกับ UID บัญชีนี้
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <Tabs defaultValue="personal" className="w-full">
            <TabsList className="flex w-full flex-wrap h-auto justify-start gap-1 p-1">
              <TabsTrigger value="attendance" className="gap-1 text-xs sm:text-sm shrink-0">
                <Clock className="h-3.5 w-3.5 opacity-80" /> ประวัติการลงเวลา
              </TabsTrigger>
              <TabsTrigger value="personal" className="text-xs sm:text-sm shrink-0">
                ข้อมูลส่วนตัว
              </TabsTrigger>
              <TabsTrigger value="holidays" className="text-xs sm:text-sm shrink-0">
                วันหยุดบริษัท
              </TabsTrigger>
              <TabsTrigger value="payslips" className="text-xs sm:text-sm shrink-0">
                สลิปเงินเดือน
              </TabsTrigger>
              <TabsTrigger value="wht" className="text-xs sm:text-sm shrink-0">
                ใบหัก ณ ที่จ่าย
              </TabsTrigger>
              <TabsTrigger value="leave" className="text-xs sm:text-sm shrink-0">
                การลา
              </TabsTrigger>
              <TabsTrigger value="advances" className="text-xs sm:text-sm shrink-0">
                เบิกล่วงหน้า
              </TabsTrigger>
              <TabsTrigger value="password" className="gap-1 text-xs sm:text-sm shrink-0">
                <KeyRound className="h-3.5 w-3.5 opacity-80" /> เปลี่ยนรหัสผ่าน
              </TabsTrigger>
            </TabsList>

            <TabsContent value="attendance" className="mt-4">
              {firestore ? (
                <SubjectAttendanceHistory
                  firestore={firestore}
                  subjectType={linked.kind === 'worker' ? 'worker' : 'office_staff'}
                  subjectId={linked.record.id}
                  title="ประวัติการลงเวลา"
                  description="ข้อมูลเดียวกับการสแกนลงเวลาผ่าน Kiosk / มือถือ — ซิงค์จากชุดข้อมูลเดียวกับเมนูจัดการการลงเวลา"
                />
              ) : (
                <Card>
                  <CardContent className="py-8 text-center text-sm text-muted-foreground">
                    ยังไม่เชื่อมต่อ Firestore — โหลดประวัติไม่ได้
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="personal" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {linked.kind === 'worker' ? 'ลูกจ้าง' : 'พนักงานออฟฟิศ'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
                  {linked.kind === 'worker' ? (
                    <>
                      <p>
                        <span className="text-muted-foreground">ชื่อ</span>
                        <br />
                        {linked.record.firstName} {linked.record.lastName}
                      </p>
                      <p>
                        <span className="text-muted-foreground">รหัส</span>
                        <br />
                        {linked.record.workerCode}
                      </p>
                      <p>
                        <span className="text-muted-foreground">โทรศัพท์</span>
                        <br />
                        {linked.record.contactPhone}
                      </p>
                      <p>
                        <span className="text-muted-foreground">อีเมล</span>
                        <br />
                        {linked.record.email || '—'}
                      </p>
                      <p className="sm:col-span-2">
                        <span className="text-muted-foreground">ที่อยู่</span>
                        <br />
                        {linked.record.address || '—'}
                      </p>
                      <p>
                        <span className="text-muted-foreground">เลขบัตรประชาชน</span>
                        <br />
                        {linked.record.thaiNationalId}
                      </p>
                      <p>
                        <span className="text-muted-foreground">โรงพยาบาล สปส.</span>
                        <br />
                        {linked.record.socialSecurityHospital || '—'}
                      </p>
                      <div className="sm:col-span-2 rounded-lg border bg-muted/25 p-4 space-y-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">บัญชีธนาคารสำหรับโอนเงิน</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            แก้ไขไม่ได้ — ติดต่อแผนก HR เพื่อแก้ไขข้อมูลการเงินและบัญชี
                          </p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label>ชื่อธนาคาร</Label>
                            <Input
                              readOnly
                              disabled
                              value={linked.record.bankName ?? ''}
                              className="bg-muted/80 cursor-not-allowed opacity-100"
                              placeholder="—"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>ชื่อบัญชี</Label>
                            <Input
                              readOnly
                              disabled
                              value={linked.record.bankAccountName ?? ''}
                              className="bg-muted/80 cursor-not-allowed opacity-100"
                              placeholder="—"
                            />
                          </div>
                          <div className="space-y-2 sm:col-span-2">
                            <Label>เลขที่บัญชี</Label>
                            <Input
                              readOnly
                              disabled
                              value={linked.record.bankAccountNumber ?? ''}
                              className="bg-muted/80 cursor-not-allowed opacity-100 font-mono"
                              placeholder="—"
                            />
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="sm:col-span-2 space-y-4 w-full">
                      {canSelfEditOfficeStaffProfile ? (
                        <p className="text-xs text-muted-foreground rounded-md border bg-muted/40 px-3 py-2">
                          แก้ไขและบันทึกได้เฉพาะข้อมูลส่วนตัวในช่องด้านล่าง — ข้อมูลการเงิน ภาษี ประกันสังคม และบัญชีธนาคารเป็นการดูอย่างเดียว
                          หากต้องการแก้ไขให้ติดต่อแผนก HR
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          ดูข้อมูลทะเบียนพนักงานออฟฟิศ — แก้ไขส่วนตัวได้เมื่อบัญชีของคุณเป็นประเภทพนักงาน (employee_self) และ HR ผูกบัญชีแล้ว
                        </p>
                      )}
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2 sm:col-span-2">
                          <Label>ชื่อ-นามสกุล</Label>
                          <Input
                            value={officeForm.fullName}
                            disabled={!canSelfEditOfficeStaffProfile}
                            onChange={(e) => setOfficeForm((f) => ({ ...f, fullName: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>ชื่อเล่น</Label>
                          <Input
                            value={officeForm.nickname}
                            disabled={!canSelfEditOfficeStaffProfile}
                            onChange={(e) => setOfficeForm((f) => ({ ...f, nickname: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>โทรศัพท์</Label>
                          <Input
                            value={officeForm.phone}
                            disabled={!canSelfEditOfficeStaffProfile}
                            onChange={(e) => setOfficeForm((f) => ({ ...f, phone: e.target.value }))}
                            inputMode="tel"
                          />
                        </div>
                        <div className="space-y-2 sm:col-span-2">
                          <Label>เลขบัตรประชาชน</Label>
                          <Input
                            value={officeForm.nationalId}
                            disabled={!canSelfEditOfficeStaffProfile}
                            onChange={(e) => setOfficeForm((f) => ({ ...f, nationalId: e.target.value }))}
                            className="font-mono"
                          />
                        </div>
                        <div className="space-y-2 sm:col-span-2">
                          <Label>ที่อยู่</Label>
                          <Textarea
                            value={officeForm.address}
                            disabled={!canSelfEditOfficeStaffProfile}
                            onChange={(e) => setOfficeForm((f) => ({ ...f, address: e.target.value }))}
                            className="min-h-[88px]"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>ผู้ติดต่อฉุกเฉิน — ชื่อ</Label>
                          <Input
                            value={officeForm.emergencyContactName}
                            disabled={!canSelfEditOfficeStaffProfile}
                            onChange={(e) => setOfficeForm((f) => ({ ...f, emergencyContactName: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>ความสัมพันธ์</Label>
                          <Input
                            value={officeForm.emergencyContactRelation}
                            disabled={!canSelfEditOfficeStaffProfile}
                            onChange={(e) => setOfficeForm((f) => ({ ...f, emergencyContactRelation: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-2 sm:col-span-2">
                          <Label>เบอร์ฉุกเฉิน</Label>
                          <Input
                            value={officeForm.emergencyContactPhone}
                            disabled={!canSelfEditOfficeStaffProfile}
                            onChange={(e) => setOfficeForm((f) => ({ ...f, emergencyContactPhone: e.target.value }))}
                            inputMode="tel"
                          />
                        </div>
                      </div>

                      <div className="rounded-lg border bg-muted/25 p-4 space-y-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">ข้อมูลการเงินและการจ่ายเงิน</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            แก้ไขไม่ได้ — ติดต่อแผนก HR เพื่อแก้ไขข้อมูลการเงิน ภาษี และประกันสังคม
                          </p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label>ประเภทการจ้าง</Label>
                            <Input
                              readOnly
                              disabled
                              value={employmentTypeLabel(linked.record.employmentType)}
                              className="bg-muted/80 cursor-not-allowed opacity-100"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>กลุ่มงวดเงินเดือน</Label>
                            <Input
                              readOnly
                              disabled
                              value={payrollBandLabel(linked.record.payrollBand)}
                              className="bg-muted/80 cursor-not-allowed opacity-100"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>รูปแบบเงินเดือนในระบบ</Label>
                            <Input
                              readOnly
                              disabled
                              value={salaryTypeLabel(linked.record.salaryType)}
                              className="bg-muted/80 cursor-not-allowed opacity-100"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>เงินเดือน (บาท/เดือน)</Label>
                            <Input
                              readOnly
                              disabled
                              value={fmtBahtDisplay(linked.record.monthlySalary)}
                              className="bg-muted/80 cursor-not-allowed opacity-100 font-mono text-right"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>ค่าแรงรายวัน (บาท/วัน)</Label>
                            <Input
                              readOnly
                              disabled
                              value={fmtBahtDisplay(linked.record.dailyWage)}
                              className="bg-muted/80 cursor-not-allowed opacity-100 font-mono text-right"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>เลขผู้เสียภาษี</Label>
                            <Input
                              readOnly
                              disabled
                              value={linked.record.taxId ?? ''}
                              className="bg-muted/80 cursor-not-allowed opacity-100 font-mono"
                              placeholder="—"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>เลขประกันสังคม</Label>
                            <Input
                              readOnly
                              disabled
                              value={linked.record.socialSecurityNo ?? ''}
                              className="bg-muted/80 cursor-not-allowed opacity-100 font-mono"
                              placeholder="—"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>สิทธิประกันสังคม</Label>
                            <Input
                              readOnly
                              disabled
                              value={ssStatusLabel(linked.record.socialSecurityStatus)}
                              className="bg-muted/80 cursor-not-allowed opacity-100"
                            />
                          </div>
                          <div className="space-y-2 sm:col-span-2">
                            <Label>โรงพยาบาลประกันสังคม</Label>
                            <Input
                              readOnly
                              disabled
                              value={linked.record.socialSecurityHospital ?? ''}
                              className="bg-muted/80 cursor-not-allowed opacity-100"
                              placeholder="—"
                            />
                          </div>
                          {(linked.record.monthlyAttendanceExempt ||
                            linked.record.excludeFromPayrollRuns) && (
                            <p className="text-xs text-muted-foreground sm:col-span-2">
                              {[
                                linked.record.monthlyAttendanceExempt && 'ยกเว้นการอ้างอิงเวลาเข้างาน (รายเดือน)',
                                linked.record.excludeFromPayrollRuns && 'ไม่นำเข้างวดจ่ายอัตโนมัติ',
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="rounded-lg border bg-muted/25 p-4 space-y-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">บัญชีธนาคาร</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            แก้ไขไม่ได้ — ติดต่อแผนก HR เพื่อแก้ไขข้อมูลบัญชีรับโอน
                          </p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label>ชื่อธนาคาร</Label>
                            <Input
                              readOnly
                              disabled
                              value={linked.record.bankName ?? ''}
                              className="bg-muted/80 cursor-not-allowed opacity-100"
                              placeholder="—"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>ชื่อบัญชี</Label>
                            <Input
                              readOnly
                              disabled
                              value={linked.record.bankAccountName ?? ''}
                              className="bg-muted/80 cursor-not-allowed opacity-100"
                              placeholder="—"
                            />
                          </div>
                          <div className="space-y-2 sm:col-span-2">
                            <Label>เลขที่บัญชี</Label>
                            <Input
                              readOnly
                              disabled
                              value={linked.record.bankAccountNumber ?? ''}
                              className="bg-muted/80 cursor-not-allowed opacity-100 font-mono"
                              placeholder="—"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                        <p>
                          <span className="font-medium text-foreground">รหัส / แผนก / ตำแหน่ง</span> — ดูอย่างเดียว:{' '}
                          {linked.record.staffCode} · {linked.record.department} · {linked.record.positionTitle}
                        </p>
                      </div>
                      {canSelfEditOfficeStaffProfile ? (
                        <Button type="button" onClick={() => void saveOfficePersonal()} disabled={officePersonalBusy}>
                          {officePersonalBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                          บันทึกข้อมูลส่วนตัว
                        </Button>
                      ) : null}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="holidays" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">วันหยุดและกฎค่าจ้างอ้างอิง</CardTitle>
                  <CardDescription>
                    ปฏิทินวันหยุดและรูปแบบวันหยุดประจำสัปดาห์ — ดึงจาก{' '}
                    <strong className="text-foreground">ตั้งค่า HR</strong> (นโยบายค่าจ้างลูกจ้าง / ปฏิทินเดียวกับที่ HR
                    บันทึก)
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  {workerLaborLoad ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="h-7 w-7 animate-spin text-primary" />
                    </div>
                  ) : workerLaborView ? (
                    <>
                      <div className="rounded-lg border bg-muted/30 p-3 space-y-1 text-xs">
                        <p className="font-semibold text-foreground">รูปแบบวันหยุดประจำสัปดาห์</p>
                        <p className="text-muted-foreground">
                          {WEEKLY_REST_OPTIONS.find((o) => o.value === workerLaborView.weeklyRestPattern)?.label ??
                            workerLaborView.weeklyRestPattern}
                        </p>
                        {linked.kind === 'worker' ? (
                          <>
                            <p className="font-semibold text-foreground pt-2">ตัวคูณค่าจ้าง (ลูกจ้าง)</p>
                            <p className="text-muted-foreground font-mono leading-relaxed">
                              OT {workerLaborView.cost.otAfterShift} · Holiday {workerLaborView.cost.holiday} · นักขัตฤกษ์{' '}
                              {workerLaborView.cost.publicHoliday} · อาทิตย์ {workerLaborView.cost.sunday} · อาทิตย์ OT{' '}
                              {workerLaborView.cost.sundayOt}
                              <br />
                              Standby {workerLaborView.cost.standby} · Mob {workerLaborView.cost.mobilization} · Demob{' '}
                              {workerLaborView.cost.demobilization} · Travel {workerLaborView.cost.travel}
                            </p>
                          </>
                        ) : (
                          <p className="text-muted-foreground pt-2">
                            ข้อมูลตัวคูณ OT / Holiday เป็นขั้นตอนคำนวณค่าจ้างลูกจ้าง — พนักงานออฟฟิศใช้ตารางวันหยุดด้านล่างเป็นองค์ความรู้ทั่วไป
                          </p>
                        )}
                      </div>
                      {workerLaborView.calendarHolidays.length === 0 ? (
                        <p className="text-muted-foreground">ยังไม่มีวันที่เพิ่มในปฏิทิน — ติดต่อ HR หากต้องการตรวจสอบ</p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>วันที่</TableHead>
                              <TableHead>รายการ</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {workerLaborView.calendarHolidays.map((h, i) => (
                              <TableRow key={`${h.date}-${i}`}>
                                <TableCell className="font-mono text-xs">
                                  {formatYmdLocalThaiBE(h.date, h.date)}
                                </TableCell>
                                <TableCell>{h.label}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </>
                  ) : (
                    <p className="text-muted-foreground">โหลดข้อมูลไม่สำเร็จ</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="payslips" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">ใบสลิปเงินเดือน</CardTitle>
                  <CardDescription>เฟสถัดไป — ดึงจากงวดจ่ายออฟฟิศ / ลูกจ้างตามสิทธิ์</CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">ยังไม่มีข้อมูลในขณะนี้</CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="wht" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">ใบหัก ณ ที่จ่าย (ภงด.1)</CardTitle>
                  <CardDescription>
                    สรุปยอดภาษีหักจากบรรทัดงวดจ่ายของคุณ — ข้อมูลจากระบบ Payroll (หลัง HR คำนวณงวด)
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {myPayrollLinesLoading ? (
                    <div className="flex justify-center py-10">
                      <Loader2 className="h-7 w-7 animate-spin text-primary" />
                    </div>
                  ) : !myPayrollLines?.length ? (
                    <p className="text-muted-foreground">
                      ยังไม่มีบรรทัดงวดจ่ายในประวัติ — เมื่อมีงวดที่คุณอยู่ในชุดจ่าย จะแสดงที่นี่
                    </p>
                  ) : (
                    <>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>งวด / ช่วง</TableHead>
                            <TableHead className="text-right">เงินได้รวม</TableHead>
                            <TableHead className="text-right">ภาษีหัก ณ ที่จ่าย</TableHead>
                            <TableHead className="text-right whitespace-nowrap">อัปเดตล่าสุด</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {myPayrollLines.map((row) => {
                            if (linked.kind === 'office_staff') {
                              const ol = row as OfficePayrollLine & { id: string };
                              const periodLabel =
                                ol.payrollMonth?.trim() ||
                                (ol.officePayrollRunId ? `งวด ${ol.officePayrollRunId.slice(0, 10)}…` : ol.id);
                              const pit = Number(ol.tax) || 0;
                              const gross = Number(ol.grossPay) || 0;
                              return (
                                <TableRow key={ol.id}>
                                  <TableCell className="font-medium">{periodLabel}</TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {gross.toLocaleString('th-TH', { maximumFractionDigits: 2 })}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {pit.toLocaleString('th-TH', { maximumFractionDigits: 2 })}
                                  </TableCell>
                                  <TableCell className="text-right text-xs text-muted-foreground whitespace-nowrap">
                                    {formatDateTimeThaiBE(ol.updatedAt)}
                                  </TableCell>
                                </TableRow>
                              );
                            }
                            const wl = row as PayrollBatchLine & { id: string; createdAt?: number; updatedAt?: number };
                            const pit = workerBatchLinePitBaht(wl);
                            const gross = Number(wl.grossAmount) || 0;
                            const spanLabel =
                              wl.periodStartDate && wl.periodEndDate
                                ? `${formatDateThaiBE(wl.periodStartDate)} – ${formatDateThaiBE(wl.periodEndDate)}`
                                : wl.id;
                            const ts = wl.updatedAt ?? wl.createdAt ?? wl.financePaidAt ?? null;
                            return (
                              <TableRow key={wl.id}>
                                <TableCell className="font-medium">{spanLabel}</TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {gross.toLocaleString('th-TH', { maximumFractionDigits: 2 })}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {pit.toLocaleString('th-TH', { maximumFractionDigits: 2 })}
                                </TableCell>
                                <TableCell className="text-right text-xs text-muted-foreground whitespace-nowrap">
                                  {ts ? formatDateTimeThaiBE(ts) : '—'}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                      <p className="text-xs text-muted-foreground">
                        ใบหัก ณ ที่จ่ายฉบับพิมพ์อย่างเป็นทางการออกจากเมนูบัญชี / งวดจ่าย — ติดต่อ HR หากต้องการสำเนาเพิ่ม
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="leave" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">รายการลา / แบบฟอร์มลา</CardTitle>
                  <CardDescription>เฟสถัดไป — workflow ลาอนุมัติ</CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">ยังไม่มีข้อมูลในขณะนี้</CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="advances" className="mt-4 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">สร้างคำขอเบิกล่วงหน้า (ด้วยตนเอง)</CardTitle>
                  <CardDescription>
                    ไม่ต้องยืนยันรอบแรก — ส่งเข้าคิว Payroll ทันที
                    {canView(currentUser, 'cash_advances') ? (
                      <>
                        {' '}
                        — ดูคิวทั้งหมดใน{' '}
                        <Link href="/hr/cash-advances" className="text-primary underline font-medium">
                          รายการ HR
                        </Link>
                      </>
                    ) : (
                      <> — เปิดรายละเอียดจากตารางด้านล่างเมื่อส่งแล้ว</>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 max-w-md">
                  <div className="space-y-2">
                    <Label>จำนวนเงิน (บาท)</Label>
                    <Input
                      type="number"
                      min={1}
                      value={advAmount}
                      onChange={(e) => setAdvAmount(e.target.value)}
                      className="font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>เหตุผล</Label>
                    <Textarea rows={3} value={advReason} onChange={(e) => setAdvReason(e.target.value)} />
                  </div>
                  <Button onClick={() => void submitOwnAdvance()} disabled={advBusy}>
                    {advBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    ส่งคำขอ
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">รายการของฉัน</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {advLoading ? (
                    <div className="flex justify-center py-10">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>เลขที่</TableHead>
                          <TableHead>สถานะ</TableHead>
                          <TableHead className="text-right">จำนวน</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(myAdvances ?? []).map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="font-mono text-xs">{r.requestNo}</TableCell>
                            <TableCell>
                              <Badge variant="outline">{r.status}</Badge>
                            </TableCell>
                            <TableCell className="text-right">฿{Number(r.amountBaht).toLocaleString('th-TH')}</TableCell>
                            <TableCell className="text-right">
                              {r.status === 'PENDING_SUBJECT_CONFIRMATION' && r.origin === 'office' ? (
                                <Button size="sm" variant="default" disabled={advBusy} onClick={() => void confirmOfficeAdvance(r.id)}>
                                  ยืนยันรับทราบ
                                </Button>
                              ) : (
                                <Button size="sm" variant="ghost" asChild>
                                  <Link href={`/hr/cash-advances/${r.id}`}>เปิด</Link>
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                        {(myAdvances ?? []).length === 0 && (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                              ยังไม่มีรายการ
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="password" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <KeyRound className="h-5 w-5 text-primary" /> เปลี่ยนรหัสผ่าน
                  </CardTitle>
                  <CardDescription>
                    ใช้ได้เมื่อเข้าระบบด้วยอีเมลและรหัสผ่าน — ถ้าลืมรหัสให้ใช้ลิงก์{' '}
                    <Link href="/" className="text-primary underline font-medium">
                      Forgot password
                    </Link>{' '}
                    ที่หน้าเข้าสู่ระบบ (ส่งลิงก์รีเซ็ตไปที่อีเมล)
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 max-w-md">
                  <div className="space-y-2">
                    <Label>รหัสผ่านปัจจุบัน</Label>
                    <Input
                      type="password"
                      autoComplete="current-password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>รหัสผ่านใหม่</Label>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>ยืนยันรหัสผ่านใหม่</Label>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                  </div>
                  <Button onClick={() => void handleChangePassword()} disabled={passwordBusy}>
                    {passwordBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    บันทึกรหัสผ่านใหม่
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </AppShell>
  );
}
