'use client';

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertTriangle, ArrowLeft, Building2, CreditCard, Loader2, UserRound } from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { useAppUser } from '@/hooks/use-app-user';
import {
  canView,
  canExecuteBankCashbookPayments,
  isHrManager,
  isOperationManager,
  isPayrollOfficer,
} from '@/lib/permissions';
import { isSystemAdmin } from '@/lib/permission-core';
import { recordCashbookMovementWithBalance, recordPettyCashMovement } from '@/lib/services/cashbook-bank-movement';
import type {
  BankAccount,
  CashAdvanceRequest,
  CashAdvanceStatus,
  OfficeStaff,
  User,
  Worker,
} from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { collection, query, where } from 'firebase/firestore';

/**
 * ทำจ่ายเบิกล่วงหน้า (Petty / บัญชีธนาคาร + cashbook)
 * ต้องสอดคล้อง Firestore rules ของ bank_accounts / cashbook_entries
 * (= system_admin / accounting_manager) — ไม่โชว์ปุ่มจ่ายให้ accounting_officer ที่ rules ปฏิเสธ
 */
function canAccountingPayCashAdvance(u: User | null): boolean {
  return canExecuteBankCashbookPayments(u);
}

function canPayrollAct(u: User | null): boolean {
  if (!u) return false;
  return isSystemAdmin(u) || isPayrollOfficer(u) || isHrManager(u) || isOperationManager(u);
}

function canManagerAct(u: User | null): boolean {
  if (!u) return false;
  return isSystemAdmin(u) || isHrManager(u) || isOperationManager(u);
}

export default function CashAdvanceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const pathname = usePathname();
  const fromAccountingQueue = pathname.startsWith('/accounting/cash-advances-payout');
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const okView = useMemo(() => !!currentUser && canView(currentUser, 'cash_advances'), [currentUser]);

  const ref = useMemoFirebase(() => (firestore && okView ? doc(firestore, 'cash_advance_requests', id) : null), [
    firestore,
    id,
    okView,
  ]);
  const { data: row, isLoading } = useDoc<CashAdvanceRequest>(ref as any);

  const workerRef = useMemoFirebase(
    () => (firestore && row?.subjectType === 'worker' && row.workerId ? doc(firestore, 'workers', row.workerId) : null),
    [firestore, row?.subjectType, row?.workerId],
  );
  const { data: recipientWorker } = useDoc<Worker>(workerRef as any);

  const officeStaffRef = useMemoFirebase(
    () =>
      firestore && row?.subjectType === 'office_staff' && row.officeStaffId
        ? doc(firestore, 'office_staff', row.officeStaffId)
        : null,
    [firestore, row?.subjectType, row?.officeStaffId],
  );
  const { data: recipientOfficeStaff } = useDoc<OfficeStaff>(officeStaffRef as any);

  const canPayHere = !!currentUser && fromAccountingQueue && canAccountingPayCashAdvance(currentUser);

  const pettyQ = useMemoFirebase(() => {
    if (!firestore || !canPayHere) return null;
    return query(collection(firestore, 'bank_accounts'), where('accountType', '==', 'PETTY_CASH'));
  }, [firestore, canPayHere]);
  const { data: pettyAccounts } = useCollection<BankAccount>(pettyQ as any);

  const activeBanksQ = useMemoFirebase(() => {
    if (!firestore || !canPayHere) return null;
    return query(collection(firestore, 'bank_accounts'), where('status', '==', 'ACTIVE'));
  }, [firestore, canPayHere]);
  const { data: activeBankAccounts } = useCollection<BankAccount>(activeBanksQ as any);

  const operatingBankOptions = useMemo(() => {
    const list = activeBankAccounts ?? [];
    return list.filter((a) => String(a.accountType) !== 'PETTY_CASH');
  }, [activeBankAccounts]);

  const recipientBank = useMemo(() => {
    const live = row?.subjectType === 'worker' ? recipientWorker : recipientOfficeStaff;
    return {
      bankName: row?.recipientBankNameSnapshot || live?.bankName || '',
      accountName: row?.recipientBankAccountNameSnapshot || live?.bankAccountName || '',
      accountNumber: row?.recipientBankAccountNumberSnapshot || live?.bankAccountNumber || '',
    };
  }, [
    row?.subjectType,
    row?.recipientBankNameSnapshot,
    row?.recipientBankAccountNameSnapshot,
    row?.recipientBankAccountNumberSnapshot,
    recipientWorker,
    recipientOfficeStaff,
  ]);
  const recipientBankComplete =
    !!recipientBank.bankName.trim() && !!recipientBank.accountName.trim() && !!recipientBank.accountNumber.trim();

  const [rejectPayroll, setRejectPayroll] = useState('');
  const [rejectMgr, setRejectMgr] = useState('');
  const [pettyId, setPettyId] = useState('');
  const [operatingBankId, setOperatingBankId] = useState('');
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paidNote, setPaidNote] = useState('');
  const [busy, setBusy] = useState(false);

  const selectedOperatingBank = useMemo(
    () => operatingBankOptions.find((account) => account.id === operatingBankId) ?? null,
    [operatingBankOptions, operatingBankId],
  );

  const isSubject = row?.subjectLinkedUserId === currentUser?.id;

  const patch = async (updates: Record<string, unknown>) => {
    if (!firestore || !ref) return;
    setBusy(true);
    try {
      await updateDoc(ref, { ...updates, updatedAt: Date.now() });
      toast({ title: 'บันทึกแล้ว' });
    } catch (e: unknown) {
      toast({ variant: 'destructive', title: 'ไม่สำเร็จ', description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const confirmSubject = () =>
    patch({
      status: 'PENDING_PAYROLL_REVIEW' satisfies CashAdvanceStatus,
      subjectConfirmedAt: Date.now(),
    });

  const payrollApprove = () =>
    patch({
      status: 'PENDING_MANAGER_APPROVAL' satisfies CashAdvanceStatus,
      payrollReviewedAt: Date.now(),
      payrollReviewedByUid: currentUser?.id,
      payrollReviewedByName: currentUser?.displayName || currentUser?.email,
      payrollRejectReason: null,
    });

  const payrollReject = () =>
    patch({
      status: 'REJECTED_PAYROLL' satisfies CashAdvanceStatus,
      payrollReviewedAt: Date.now(),
      payrollReviewedByUid: currentUser?.id,
      payrollReviewedByName: currentUser?.displayName || currentUser?.email,
      payrollRejectReason: rejectPayroll.trim() || '-',
    });

  const mgrApprove = () => {
    const bankSnapshot = {
      ...(recipientBank.bankName.trim() ? { recipientBankNameSnapshot: recipientBank.bankName.trim() } : {}),
      ...(recipientBank.accountName.trim()
        ? { recipientBankAccountNameSnapshot: recipientBank.accountName.trim() }
        : {}),
      ...(recipientBank.accountNumber.trim()
        ? { recipientBankAccountNumberSnapshot: recipientBank.accountNumber.trim() }
        : {}),
    };
    return patch({
      status: 'PENDING_PAYMENT' satisfies CashAdvanceStatus,
      managerApprovedAt: Date.now(),
      managerApprovedByUid: currentUser?.id,
      managerApprovedByName: currentUser?.displayName || currentUser?.email,
      managerRejectReason: null,
      ...bankSnapshot,
    });
  };

  const mgrReject = () =>
    patch({
      status: 'REJECTED_MANAGER' satisfies CashAdvanceStatus,
      managerApprovedAt: Date.now(),
      managerApprovedByUid: currentUser?.id,
      managerApprovedByName: currentUser?.displayName || currentUser?.email,
      managerRejectReason: rejectMgr.trim() || '-',
    });

  const payFromOperatingBank = async () => {
    if (!fromAccountingQueue) {
      toast({ variant: 'destructive', title: 'กรุณาทำจ่ายจากหน้า “รอจ่ายเงิน” เท่านั้น' });
      return;
    }
    if (!recipientBankComplete) {
      toast({
        variant: 'destructive',
        title: 'ข้อมูลบัญชีผู้รับไม่ครบ',
        description: 'กรุณาให้ HR แก้ทะเบียนบัญชีธนาคารของลูกจ้าง/พนักงานก่อนโอน',
      });
      return;
    }
    if (!firestore || !currentUser || !row || !operatingBankId.trim()) {
      toast({ variant: 'destructive', title: 'เลือกบัญชีธนาคารที่ตัดจ่าย' });
      return;
    }
    setBusy(true);
    try {
      const { cashbookEntryId, entryNo } = await recordCashbookMovementWithBalance(firestore, currentUser, {
        bankAccountId: operatingBankId.trim(),
        direction: 'OUT',
        amount: row.amountBaht,
        entryDate: payDate,
        description: `เบิกล่วงหน้า ${row.requestNo} — ${row.subjectNameSnapshot}`,
        paymentMethod: 'TRANSFER',
        entryType: 'PAYROLL',
        referenceType: 'PAYMENT',
        referenceId: row.id,
      });
      await updateDoc(doc(firestore, 'cash_advance_requests', row.id), {
        status: 'PAID_OTHER' satisfies CashAdvanceStatus,
        paidAt: Date.now(),
        paidByUid: currentUser.id,
        paidByName: currentUser.displayName || currentUser.email,
        paymentNote: paidNote.trim() || 'จ่ายจากบัญชีธนาคาร · บันทึก cashbook',
        paymentBankAccountId: operatingBankId.trim(),
        cashbookEntryId,
        cashbookEntryNo: entryNo,
        updatedAt: Date.now(),
      });
      toast({
        title: 'ตัดจ่ายและลง cashbook แล้ว',
        description: `${entryNo} — สถานะจ่ายแล้ว รอหักจากสลิปเมื่อสร้าง Payroll งวดถัดไป`,
      });
    } catch (e: unknown) {
      toast({ variant: 'destructive', title: 'จ่ายไม่สำเร็จ', description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const payPetty = async () => {
    if (!fromAccountingQueue) {
      toast({ variant: 'destructive', title: 'กรุณาทำจ่ายจากหน้า “รอจ่ายเงิน” เท่านั้น' });
      return;
    }
    if (!firestore || !currentUser || !row || !pettyId) {
      toast({ variant: 'destructive', title: 'เลือกบัญชี Petty Cash' });
      return;
    }
    setBusy(true);
    try {
      const { pettyCashEntryId, entryNo } = await recordPettyCashMovement(firestore, currentUser, {
        bankAccountId: pettyId,
        direction: 'OUT',
        amount: row.amountBaht,
        entryDate: payDate,
        description: `เบิกล่วงหน้า ${row.requestNo} — ${row.subjectNameSnapshot}`,
      });
      await updateDoc(doc(firestore, 'cash_advance_requests', row.id), {
        status: 'PAID_PETTY_CASH' satisfies CashAdvanceStatus,
        paidAt: Date.now(),
        paidByUid: currentUser.id,
        paidByName: currentUser.displayName || currentUser.email,
        paymentNote: paidNote.trim() || null,
        pettyCashBankAccountId: pettyId,
        pettyCashEntryId,
        pettyCashEntryNo: entryNo,
        updatedAt: Date.now(),
      });
      toast({
        title: 'ตัดจ่ายจาก Petty แล้ว',
        description: `${entryNo} — รอหักจากสลิปเมื่อสร้าง Payroll งวดถัดไป`,
      });
    } catch (e: unknown) {
      toast({ variant: 'destructive', title: 'จ่ายไม่สำเร็จ', description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const payOther = () => {
    if (!fromAccountingQueue) {
      toast({ variant: 'destructive', title: 'กรุณาทำจ่ายจากหน้า “รอจ่ายเงิน” เท่านั้น' });
      return;
    }
    return patch({
      status: 'PAID_OTHER' satisfies CashAdvanceStatus,
      paidAt: Date.now(),
      paidByUid: currentUser?.id,
      paidByName: currentUser?.displayName || currentUser?.email,
      paymentNote: paidNote.trim() || 'ทำจ่ายนอก Petty (บันทึกโดยบัญชี)',
    });
  };

  if (userLoading || !currentUser) return null;

  if (!okView) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-3xl mx-auto py-16 text-center text-muted-foreground">ไม่มีสิทธิ์</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-3xl mx-auto space-y-6">
        <Button variant="ghost" size="sm" className="gap-2 -ml-2" asChild>
          <Link href={fromAccountingQueue ? '/accounting/cash-advances-payout' : '/hr/cash-advances'}>
            <ArrowLeft className="h-4 w-4" /> {fromAccountingQueue ? 'กลับไปคิวจ่าย (บัญชี)' : 'กลับ'}
          </Link>
        </Button>

        {isLoading || !row ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>
        ) : (
          <>
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-xl">{row.requestNo}</CardTitle>
                    <CardDescription>{row.subjectNameSnapshot}</CardDescription>
                  </div>
                  <Badge variant="secondary">
                    {(row.status === 'PAID_PETTY_CASH' || row.status === 'PAID_OTHER') &&
                    row.payrollRecoveryBatchId
                      ? 'หักจากสลิปแล้ว'
                      : (row.status === 'PAID_PETTY_CASH' || row.status === 'PAID_OTHER') &&
                          !row.payrollRecoveryBatchId
                        ? 'จ่ายแล้ว · รอหักจากสลิป'
                        : row.status === 'PENDING_PAYMENT'
                          ? 'รอจ่าย (บัญชี)'
                          : row.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>
                  <span className="text-muted-foreground">ประเภท:</span>{' '}
                  {row.subjectType === 'worker' ? 'ลูกจ้าง' : 'พนักงานออฟฟิศ'}
                </p>
                <p>
                  <span className="text-muted-foreground">จำนวน:</span>{' '}
                  <strong>฿{Number(row.amountBaht).toLocaleString('th-TH')}</strong>
                </p>
                <p>
                  <span className="text-muted-foreground">เหตุผล:</span> {row.reason}
                </p>
                <p>
                  <span className="text-muted-foreground">แหล่งสร้าง:</span>{' '}
                  {row.origin === 'office' ? 'Office / HR' : 'ผู้ถือบัญชี'}
                </p>
                {fromAccountingQueue && row.status === 'PENDING_PAYMENT' ? (
                  <div className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2">
                    <div className="rounded-lg border bg-blue-50/60 p-3 dark:bg-blue-950/20">
                      <p className="flex items-center gap-2 font-semibold text-blue-950 dark:text-blue-100">
                        <UserRound className="h-4 w-4" />
                        บัญชีรับเงินของผู้เบิก
                      </p>
                      <dl className="mt-2 space-y-1 text-xs">
                        <div className="flex justify-between gap-3">
                          <dt className="text-muted-foreground">ธนาคาร</dt>
                          <dd className="text-right font-medium">{recipientBank.bankName || '—'}</dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-muted-foreground">ชื่อบัญชี</dt>
                          <dd className="text-right font-medium">{recipientBank.accountName || '—'}</dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-muted-foreground">เลขที่บัญชี</dt>
                          <dd className="text-right font-mono font-semibold">{recipientBank.accountNumber || '—'}</dd>
                        </div>
                      </dl>
                    </div>
                    <div className="rounded-lg border bg-amber-50/60 p-3 dark:bg-amber-950/20">
                      <p className="flex items-center gap-2 font-semibold text-amber-950 dark:text-amber-100">
                        <CreditCard className="h-4 w-4" />
                        ยอดที่ต้องทำจ่าย
                      </p>
                      <p className="mt-2 text-2xl font-bold text-amber-950 dark:text-amber-100">
                        ฿{Number(row.amountBaht).toLocaleString('th-TH')}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        เลือกบัญชีบริษัทที่จะตัดในส่วนทำจ่ายด้านล่าง
                      </p>
                    </div>
                    {!recipientBankComplete ? (
                      <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive sm:col-span-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        ข้อมูลบัญชีผู้รับไม่ครบ — ให้ HR แก้ทะเบียนของลูกจ้าง/พนักงานก่อนโอนจากบัญชีธนาคาร
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {row.subjectConfirmedAt ? (
                  <p className="text-xs text-muted-foreground">
                    ยืนยันผู้ถือเรื่องเมื่อ {new Date(row.subjectConfirmedAt).toLocaleString('th-TH')}
                  </p>
                ) : null}
                {(row.pettyCashEntryNo || row.cashbookEntryNo) ? (
                  <p className="text-xs text-muted-foreground">
                    {row.pettyCashEntryNo ? (
                      <>เลขที่ Petty: <span className="font-mono">{row.pettyCashEntryNo}</span>{' '}</>
                    ) : null}
                    {row.cashbookEntryNo ? (
                      <>Cashbook: <span className="font-mono">{row.cashbookEntryNo}</span></>
                    ) : null}
                  </p>
                ) : null}
              </CardContent>
            </Card>

            {row.status === 'PENDING_PAYMENT' && !fromAccountingQueue ? (
              <Card className="border-blue-200 bg-blue-50/60 dark:bg-blue-950/20">
                <CardHeader>
                  <CardTitle className="text-base">ผู้จัดการอนุมัติแล้ว — ส่งเข้าคิวรอจ่ายเงิน</CardTitle>
                  <CardDescription>
                    หน้านี้ใช้ดูประวัติคำขอเท่านั้น การเลือกบัญชี ตัดยอด และบันทึก Cashbook ทำได้เฉพาะหน้า
                    “รอจ่ายเงิน” ของฝ่ายบัญชี
                  </CardDescription>
                </CardHeader>
                {canAccountingPayCashAdvance(currentUser) ? (
                  <CardContent>
                    <Button asChild>
                      <Link href={`/accounting/cash-advances-payout/${row.id}`}>เปิดรายการในหน้ารอจ่ายเงิน</Link>
                    </Button>
                  </CardContent>
                ) : null}
              </Card>
            ) : null}

            {row.status === 'PENDING_SUBJECT_CONFIRMATION' && isSubject && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">ยืนยันการรับทราบคำขอ (จากฝ่าย Office)</CardTitle>
                  <CardDescription>บันทึกเป็น log ว่าทราบรายการที่เปิดแทนคุณแล้ว</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button onClick={() => void confirmSubject()} disabled={busy}>
                    ยืนยันและส่งให้ Payroll ตรวจ
                  </Button>
                </CardContent>
              </Card>
            )}

            {row.status === 'PENDING_PAYROLL_REVIEW' && canPayrollAct(currentUser) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Payroll — ตรวจสอบ</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void payrollApprove()} disabled={busy}>
                      ผ่าน → ส่งผู้จัดการ
                    </Button>
                  </div>
                  <div className="space-y-2">
                    <Label>เหตุผลปฏิเสธ (ถ้ามี)</Label>
                    <Textarea value={rejectPayroll} onChange={(e) => setRejectPayroll(e.target.value)} rows={2} />
                    <Button variant="destructive" onClick={() => void payrollReject()} disabled={busy}>
                      ปฏิเสธ
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {row.status === 'PENDING_MANAGER_APPROVAL' && canManagerAct(currentUser) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">ผู้จัดการอนุมัติ</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void mgrApprove()} disabled={busy}>
                      อนุมัติ → ส่งบัญชีจ่าย
                    </Button>
                  </div>
                  <div className="space-y-2">
                    <Label>เหตุผลปฏิเสธ</Label>
                    <Textarea value={rejectMgr} onChange={(e) => setRejectMgr(e.target.value)} rows={2} />
                    <Button variant="destructive" onClick={() => void mgrReject()} disabled={busy}>
                      ปฏิเสธ
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {row.status === 'PENDING_PAYMENT' && canPayHere && (
              <Card className="border-primary/30">
                <CardHeader>
                  <CardTitle className="text-base">บัญชี — ทำจ่ายและลงบันทึก</CardTitle>
                  <CardDescription>
                    {fromAccountingQueue ? (
                      <>
                        เลือกบัญชีตัดจ่าย — จากบัญชีธนาคารจะสร้างรายการใน <strong>Cashbook</strong> อัตโนมัติ;
                        จาก Petty จะลงสมุด Petty ตามเดิม หลังจ่ายสถานะเป็น <strong>จ่ายแล้ว · รอหักจากสลิป</strong> เมื่อสร้าง Payroll
                        งวดถัดไป (ลูกจ้าง)
                      </>
                    ) : (
                      <>
                        ตัดจากกอง Petty Cash / บัญชีธนาคาร (มี cashbook) หรือทำเครื่องหมายจ่ายนอกระบบ — หักเงินเดือนตอน gen batch
                      </>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                    <p className="flex items-center gap-2 font-medium text-foreground">
                      <Building2 className="h-4 w-4" />
                      จ่ายจากบัญชีธนาคารบริษัท (ลง Cashbook + ตัดยอดบัญชี)
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <div className="space-y-2 sm:col-span-2">
                        <Label>บัญชีบริษัทที่จะตัดเงิน</Label>
                        <Select value={operatingBankId} onValueChange={setOperatingBankId}>
                          <SelectTrigger>
                            <SelectValue placeholder="เลือกบัญชี (ไม่รวม Petty)" />
                          </SelectTrigger>
                          <SelectContent>
                            {operatingBankOptions.length === 0 ? (
                              <div className="px-3 py-2 text-xs text-muted-foreground">ไม่มีบัญชี ACTIVE</div>
                            ) : (
                              operatingBankOptions.map((a) => (
                                <SelectItem key={a.id} value={a.id}>
                                  {a.accountCode} — {a.bankName || a.accountName || a.id} · {a.accountNumber}
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      {selectedOperatingBank ? (
                        <div className="rounded-md border bg-background p-3 text-xs sm:col-span-2">
                          <div className="grid gap-2 sm:grid-cols-2">
                            <p>
                              <span className="text-muted-foreground">ชื่อบัญชี:</span>{' '}
                              <strong>{selectedOperatingBank.accountName || '—'}</strong>
                            </p>
                            <p>
                              <span className="text-muted-foreground">เลขที่บัญชี:</span>{' '}
                              <strong className="font-mono">{selectedOperatingBank.accountNumber || '—'}</strong>
                            </p>
                            <p>
                              <span className="text-muted-foreground">ยอดคงเหลือปัจจุบัน:</span>{' '}
                              <strong>฿{Number(selectedOperatingBank.currentBalance || 0).toLocaleString('th-TH')}</strong>
                            </p>
                            <p>
                              <span className="text-muted-foreground">ยอดหลังตัดรายการนี้:</span>{' '}
                              <strong>
                                ฿
                                {(
                                  Number(selectedOperatingBank.currentBalance || 0) - Number(row.amountBaht || 0)
                                ).toLocaleString('th-TH')}
                              </strong>
                            </p>
                          </div>
                        </div>
                      ) : null}
                      <div className="space-y-2">
                        <Label>วันที่รายการ</Label>
                        <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        onClick={() => void payFromOperatingBank()}
                        disabled={busy || !operatingBankId || !recipientBankComplete}
                      >
                        ยืนยันตัดจ่าย + บันทึก Cashbook
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-lg border px-3 py-2 text-sm">
                    <p className="font-medium text-foreground">จ่ายจาก Petty Cash</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <div className="space-y-2 sm:col-span-2">
                        <Label>กอง Petty Cash</Label>
                        <Select value={pettyId} onValueChange={setPettyId}>
                          <SelectTrigger>
                            <SelectValue placeholder="เลือกกองเงินสดย่อย" />
                          </SelectTrigger>
                          <SelectContent>
                            {(pettyAccounts ?? []).map((a) => (
                              <SelectItem key={a.id} value={a.id}>
                                {a.accountCode} — {a.bankName || a.id}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button variant="secondary" onClick={() => void payPetty()} disabled={busy || !pettyId}>
                        ตัดจ่ายจาก Petty Cash
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>หมายเหตุการจ่าย (ใช้ร่วมทุกช่องทาง)</Label>
                    <Textarea value={paidNote} onChange={(e) => setPaidNote(e.target.value)} rows={2} />
                  </div>
                  <div className="flex flex-wrap gap-2 border-t pt-4">
                    <Button variant="outline" onClick={() => void payOther()} disabled={busy}>
                      ทำเครื่องหมายจ่ายแล้ว (โอนนอกระบบ · ไม่ลง cashbook ที่นี่)
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
