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
import { Loader2, UserCircle, KeyRound } from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase, useAuth } from '@/firebase';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { addDoc, collection, doc, getDoc, query, updateDoc, where } from 'firebase/firestore';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';
import { fetchLinkedPersonnelForUser } from '@/lib/hr/linked-personnel';
import type { CashAdvanceRequest, PayrollPolicyRecord, User } from '@/lib/types';
import { HR_WORKER_GLOBAL_LABOR_POLICY_ID } from '@/lib/payroll/d8/hr-statutory-policy-ids';
import {
  type WorkerGlobalLaborContext,
  workerGlobalLaborContextFromPolicy,
} from '@/lib/payroll/worker-global-labor-policy';
import { formatYmdLocalThaiBE } from '@/lib/date-thai';
import { WEEKLY_REST_OPTIONS } from '@/lib/contract-position-rate-extras';
import { generateNextDocumentCode } from '@/lib/services/numbering-service';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';

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

  const [workerLaborView, setWorkerLaborView] = useState<WorkerGlobalLaborContext | null>(null);
  const [workerLaborLoad, setWorkerLaborLoad] = useState(false);

  useEffect(() => {
    if (!firestore || linked?.kind !== 'worker') {
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
      <div className="max-w-4xl mx-auto space-y-6">
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
            <TabsList className="flex flex-wrap h-auto gap-1">
              <TabsTrigger value="personal">ข้อมูลส่วนตัว</TabsTrigger>
              <TabsTrigger value="password" className="gap-1">
                <KeyRound className="h-3.5 w-3.5 opacity-80" /> เปลี่ยนรหัสผ่าน
              </TabsTrigger>
              <TabsTrigger value="holidays">วันหยุดบริษัท</TabsTrigger>
              <TabsTrigger value="payslips">สลิปเงินเดือน</TabsTrigger>
              <TabsTrigger value="leave">การลา</TabsTrigger>
              <TabsTrigger value="advances">เบิกล่วงหน้า</TabsTrigger>
            </TabsList>

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
                    </>
                  ) : (
                    <>
                      <p>
                        <span className="text-muted-foreground">ชื่อ</span>
                        <br />
                        {linked.record.fullName}
                      </p>
                      <p>
                        <span className="text-muted-foreground">รหัส</span>
                        <br />
                        {linked.record.staffCode}
                      </p>
                      <p>
                        <span className="text-muted-foreground">แผนก</span>
                        <br />
                        {linked.record.department}
                      </p>
                      <p>
                        <span className="text-muted-foreground">ตำแหน่ง</span>
                        <br />
                        {linked.record.positionTitle}
                      </p>
                      <p>
                        <span className="text-muted-foreground">โทรศัพท์</span>
                        <br />
                        {linked.record.phone || '—'}
                      </p>
                      <p>
                        <span className="text-muted-foreground">เลขบัตรประชาชน</span>
                        <br />
                        {linked.record.nationalId || '—'}
                      </p>
                      <p className="sm:col-span-2">
                        <span className="text-muted-foreground">ที่อยู่</span>
                        <br />
                        {linked.record.address || '—'}
                      </p>
                      <p>
                        <span className="text-muted-foreground">โรงพยาบาล สปส.</span>
                        <br />
                        {linked.record.socialSecurityHospital || '—'}
                      </p>
                      <p>
                        <span className="text-muted-foreground">เลข สปส.</span>
                        <br />
                        {linked.record.socialSecurityNo || '—'}
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="holidays" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">วันหยุดและกฎค่าจ้างอ้างอิง</CardTitle>
                  <CardDescription>
                    {linked.kind === 'worker'
                      ? 'ปฏิทินและตัวคูณเดียวกับที่ HR ตั้งในเมนูตั้งค่า — ใช้ประกอบการคำนวณค่าจ้างเมื่อมีการลงเวลา'
                      : 'พนักงานออฟฟิศยังไม่มีการลงเวลารายวันในระบบ — ไม่แสดงตารางค่าจ้างแบบลูกจ้าง'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  {linked.kind !== 'worker' ? (
                    <p className="text-muted-foreground">ข้อมูลนี้ใช้กับลูกจ้างที่มี timesheet เท่านั้น</p>
                  ) : workerLaborLoad ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="h-7 w-7 animate-spin text-primary" />
                    </div>
                  ) : workerLaborView ? (
                    <>
                      <div className="rounded-lg border bg-muted/30 p-3 space-y-1 text-xs">
                        <p className="font-semibold text-foreground">รูปแบบวันหยุดประจำสัปดาห์ (อ้างอิงค่าจ้าง)</p>
                        <p className="text-muted-foreground">
                          {WEEKLY_REST_OPTIONS.find((o) => o.value === workerLaborView.weeklyRestPattern)?.label ??
                            workerLaborView.weeklyRestPattern}
                        </p>
                        <p className="font-semibold text-foreground pt-2">ตัวคูณ (สรุป)</p>
                        <p className="text-muted-foreground font-mono leading-relaxed">
                          OT {workerLaborView.cost.otAfterShift} · Holiday {workerLaborView.cost.holiday} · นักขัตฤกษ์{' '}
                          {workerLaborView.cost.publicHoliday} · อาทิตย์ {workerLaborView.cost.sunday} · อาทิตย์ OT{' '}
                          {workerLaborView.cost.sundayOt}
                          <br />
                          Standby {workerLaborView.cost.standby} · Mob {workerLaborView.cost.mobilization} · Demob{' '}
                          {workerLaborView.cost.demobilization} · Travel {workerLaborView.cost.travel}
                        </p>
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
          </Tabs>
        )}
      </div>
    </AppShell>
  );
}
