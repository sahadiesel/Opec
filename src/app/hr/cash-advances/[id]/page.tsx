'use client';

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
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
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { useAppUser } from '@/hooks/use-app-user';
import { canView, isHrManager, isOperationManager, isPayrollOfficer } from '@/lib/permissions';
import { isSystemAdmin } from '@/lib/permission-core';
import { isSimpleAccounting } from '@/lib/simple-tier-model';
import { recordPettyCashMovement } from '@/lib/services/cashbook-bank-movement';
import type { BankAccount, CashAdvanceRequest, CashAdvanceStatus, User } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { collection, query, where } from 'firebase/firestore';

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

  const pettyQ = useMemoFirebase(() => {
    if (!firestore || !currentUser || !isSimpleAccounting(currentUser)) return null;
    return query(collection(firestore, 'bank_accounts'), where('accountType', '==', 'PETTY_CASH'));
  }, [firestore, currentUser]);
  const { data: pettyAccounts } = useCollection<BankAccount>(pettyQ as any);

  const [rejectPayroll, setRejectPayroll] = useState('');
  const [rejectMgr, setRejectMgr] = useState('');
  const [pettyId, setPettyId] = useState('');
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paidNote, setPaidNote] = useState('');
  const [busy, setBusy] = useState(false);

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

  const mgrApprove = () =>
    patch({
      status: 'PENDING_PAYMENT' satisfies CashAdvanceStatus,
      managerApprovedAt: Date.now(),
      managerApprovedByUid: currentUser?.id,
      managerApprovedByName: currentUser?.displayName || currentUser?.email,
      managerRejectReason: null,
    });

  const mgrReject = () =>
    patch({
      status: 'REJECTED_MANAGER' satisfies CashAdvanceStatus,
      managerApprovedAt: Date.now(),
      managerApprovedByUid: currentUser?.id,
      managerApprovedByName: currentUser?.displayName || currentUser?.email,
      managerRejectReason: rejectMgr.trim() || '-',
    });

  const payPetty = async () => {
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
      toast({ title: 'ตัดจ่ายจาก Petty แล้ว', description: entryNo });
    } catch (e: unknown) {
      toast({ variant: 'destructive', title: 'จ่ายไม่สำเร็จ', description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const payOther = () =>
    patch({
      status: 'PAID_OTHER' satisfies CashAdvanceStatus,
      paidAt: Date.now(),
      paidByUid: currentUser?.id,
      paidByName: currentUser?.displayName || currentUser?.email,
      paymentNote: paidNote.trim() || 'ทำจ่ายนอก Petty (บันทึกโดยบัญชี)',
    });

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
          <Link href="/hr/cash-advances">
            <ArrowLeft className="h-4 w-4" /> กลับ
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
                  <Badge>{row.status}</Badge>
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
                {row.subjectConfirmedAt ? (
                  <p className="text-xs text-muted-foreground">
                    ยืนยันผู้ถือเรื่องเมื่อ {new Date(row.subjectConfirmedAt).toLocaleString('th-TH')}
                  </p>
                ) : null}
              </CardContent>
            </Card>

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

            {row.status === 'PENDING_PAYMENT' && isSimpleAccounting(currentUser) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">บัญชี — จ่ายเงิน</CardTitle>
                  <CardDescription>ตัดจากกอง Petty Cash หรือทำเครื่องหมายจ่ายแล้ว (โอนนอกระบบ)</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>บัญชี Petty Cash</Label>
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
                    <div className="space-y-2">
                      <Label>วันที่รายการ</Label>
                      <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>หมายเหตุการจ่าย</Label>
                    <Textarea value={paidNote} onChange={(e) => setPaidNote(e.target.value)} rows={2} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void payPetty()} disabled={busy || !pettyId}>
                      ตัดจ่ายจาก Petty Cash
                    </Button>
                    <Button variant="secondary" onClick={() => void payOther()} disabled={busy}>
                      ทำเครื่องหมายจ่ายแล้ว (ไม่ผ่าน Petty)
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
