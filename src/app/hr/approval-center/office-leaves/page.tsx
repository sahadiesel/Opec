'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  collection,
  doc,
  query,
  where,
  limit,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { ArrowLeft, CalendarOff, CheckCircle2, Loader2, MoreHorizontal, XCircle } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAppUser } from '@/hooks/use-app-user';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { canViewHrApprovalSubsection } from '@/lib/navigation/nav-access';
import { isSystemAdmin } from '@/lib/permission-core';
import { isSimpleAdmin } from '@/lib/simple-tier-model';
import type { User } from '@/lib/types';
import type { OfficeLeaveRequestDoc } from '@/lib/leaves/types';
import {
  OFFICE_LEAVE_REQUESTS_COLLECTION,
  OFFICE_LEAVE_TYPE_LABELS,
  OFFICE_LEAVE_STATUS_LABELS,
} from '@/lib/leaves/policy';
import { formatDateThaiBE } from '@/lib/date-thai';

export default function OfficeLeavesApprovalQueuePage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const approvalGate = useMemo(
    () =>
      !!currentUser &&
      canViewHrApprovalSubsection(currentUser as User, isSystemAdmin(currentUser) || isSimpleAdmin(currentUser)),
    [currentUser],
  );

  const pendingQ = useMemoFirebase(
    () =>
      firestore && approvalGate
        ? query(
            collection(firestore, OFFICE_LEAVE_REQUESTS_COLLECTION),
            where('status', '==', 'SUBMITTED'),
            limit(200),
          )
        : null,
    [firestore, approvalGate],
  );

  const { data: pendingLeavesRaw, isLoading, error: pendingError } = useCollection<
    OfficeLeaveRequestDoc & { id: string }
  >(pendingQ as any);

  const rows = useMemo(() => {
    const list = pendingLeavesRaw ?? [];
    return [...list].sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
  }, [pendingLeavesRaw]);

  const [approving, setApproving] = useState<(OfficeLeaveRequestDoc & { id: string }) | null>(null);
  const [rejecting, setRejecting] = useState<(OfficeLeaveRequestDoc & { id: string }) | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [submitBusy, setSubmitBusy] = useState(false);

  async function handleApprove() {
    if (!firestore || !currentUser?.id || !approving) return;
    setSubmitBusy(true);
    try {
      await updateDoc(doc(firestore, OFFICE_LEAVE_REQUESTS_COLLECTION, approving.id), {
        status: 'APPROVED',
        approvedByUid: currentUser.id,
        approvedByName: currentUser.displayName || currentUser.email || '',
        approvedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      toast({ title: 'อนุมัติใบลาแล้ว' });
      setApproving(null);
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'อนุมัติไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSubmitBusy(false);
    }
  }

  async function handleReject() {
    if (!firestore || !currentUser?.id || !rejecting || !rejectReason.trim()) return;
    setSubmitBusy(true);
    try {
      await updateDoc(doc(firestore, OFFICE_LEAVE_REQUESTS_COLLECTION, rejecting.id), {
        status: 'REJECTED',
        rejectedByUid: currentUser.id,
        rejectedByName: currentUser.displayName || currentUser.email || '',
        rejectedAt: serverTimestamp(),
        rejectReason: rejectReason.trim(),
        updatedAt: serverTimestamp(),
      });
      toast({ title: 'ปฏิเสธใบลาแล้ว' });
      setRejecting(null);
      setRejectReason('');
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'ปฏิเสธไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSubmitBusy(false);
    }
  }

  if (userLoading || !currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground text-sm">กำลังโหลด…</div>
    );
  }

  if (!approvalGate) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="mx-auto max-w-lg py-20 text-center text-muted-foreground">ไม่มีสิทธิ์เข้าคิวอนุมัติวันลา</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 pb-16">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/hr/approval-center">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight text-primary">
              <CalendarOff className="h-7 w-7" />
              คิวอนุมัติวันลา (พนักงานออฟฟิศ)
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              เฉพาะคำขอสถานะรออนุมัติ — ดูประวัติและฉบับร่างได้ที่เมนูจัดการการลาของ HR
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">รายการรออนุมัติ ({rows.length})</CardTitle>
            <CardDescription>
              เปิดเมนู ⋮ ที่แถวเพื่อดูเหตุผลและอนุมัติหรือไม่อนุมัติ — สร้างใบลาแทนพนักงานได้ที่{' '}
              <Link href="/hr/leaves" className="text-primary underline font-medium">
                การจัดการการลา
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {pendingError ? (
              <p className="py-10 px-4 text-center text-sm text-destructive">
                โหลดคิวอนุมัติไม่สำเร็จ — {pendingError.message}
              </p>
            ) : isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">ไม่มีคำขอรออนุมัติ</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>พนักงาน</TableHead>
                      <TableHead>ประเภท</TableHead>
                      <TableHead>วันที่ลา</TableHead>
                      <TableHead className="text-center">วัน</TableHead>
                      <TableHead>เหตุผล</TableHead>
                      <TableHead>ผู้ยื่น</TableHead>
                      <TableHead className="text-right">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium whitespace-nowrap">
                          {r.staffNameSnapshot}
                          {r.staffDepartmentSnapshot && (
                            <p className="text-[10px] text-muted-foreground">{r.staffDepartmentSnapshot}</p>
                          )}
                        </TableCell>
                        <TableCell>
                          {OFFICE_LEAVE_TYPE_LABELS[r.leaveType]}
                          {r.isHalfDay && (
                            <Badge variant="outline" className="ml-2 text-[9px] h-4">
                              0.5 วัน
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          {formatDateThaiBE(r.startDate)}
                          {!r.isHalfDay && r.endDate !== r.startDate
                            ? ` – ${formatDateThaiBE(r.endDate)}`
                            : r.isHalfDay
                              ? ` (${r.halfDaySession === 'MORNING' ? 'ครึ่งเช้า' : 'ครึ่งบ่าย'})`
                              : ''}
                        </TableCell>
                        <TableCell className="text-center font-mono">{r.days}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[240px]" title={r.reason}>
                          {r.reason}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {r.createdByName || r.createdByUid}
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => setApproving(r)}>
                                <CheckCircle2 className="h-4 w-4 mr-2 text-green-600" /> อนุมัติ
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive"
                                onSelect={() => {
                                  setRejecting(r);
                                  setRejectReason('');
                                }}
                              >
                                <XCircle className="h-4 w-4 mr-2" /> ไม่อนุมัติ
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem disabled className="text-[11px] text-muted-foreground">
                                สถานะ {OFFICE_LEAVE_STATUS_LABELS.SUBMITTED}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={!!approving} onOpenChange={(open) => !open && setApproving(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>ยืนยันการอนุมัติ</DialogTitle>
              <DialogDescription>
                อนุมัติใบลาของ <strong>{approving?.staffNameSnapshot}</strong> —{' '}
                {approving && OFFICE_LEAVE_TYPE_LABELS[approving.leaveType]} {approving?.days} วัน
                {approving
                  ? ` (${formatDateThaiBE(approving.startDate)}${approving.endDate !== approving.startDate ? ` – ${formatDateThaiBE(approving.endDate)}` : ''})`
                  : ''}
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <p className="text-xs text-muted-foreground mb-1">เหตุผลการลา</p>
              <p className="text-sm">{approving?.reason}</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setApproving(null)} disabled={submitBusy}>
                ยกเลิก
              </Button>
              <Button onClick={() => void handleApprove()} disabled={submitBusy}>
                {submitBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                ยืนยันอนุมัติ
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!rejecting} onOpenChange={(open) => !open && setRejecting(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>เหตุผลที่ไม่อนุมัติ</DialogTitle>
              <DialogDescription>
                {rejecting?.staffNameSnapshot} — {rejecting && OFFICE_LEAVE_TYPE_LABELS[rejecting.leaveType]}{' '}
                {rejecting?.days} วัน
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm mb-2">
              <p className="text-xs text-muted-foreground mb-1">เหตุผลการลา (จากผู้ยื่น)</p>
              <p className="text-sm">{rejecting?.reason}</p>
            </div>
            <Textarea
              rows={4}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="ระบุเหตุผลที่ไม่อนุมัติ..."
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setRejecting(null)} disabled={submitBusy}>
                ยกเลิก
              </Button>
              <Button
                variant="destructive"
                onClick={() => void handleReject()}
                disabled={submitBusy || !rejectReason.trim()}
              >
                {submitBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                ยืนยันไม่อนุมัติ
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
