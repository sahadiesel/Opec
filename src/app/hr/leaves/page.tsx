'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ArrowLeft, CalendarOff, CheckCircle2, Loader2, MoreHorizontal, Pencil, Plus, Send, XCircle } from 'lucide-react';
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
import { canViewHrPayrollFlowSubsection } from '@/lib/navigation/nav-access';
import type { OfficeStaff } from '@/lib/types';
import type { OfficeLeaveEntitlementsDoc } from '@/lib/attendance/types';
import {
  HR_CONFIGURATION_COLLECTION,
  HR_OFFICE_LEAVE_ENTITLEMENTS_DOC_ID,
} from '@/lib/attendance/constants';
import {
  OFFICE_LEAVE_REQUESTS_COLLECTION,
  OFFICE_LEAVE_TYPE_LABELS,
  OFFICE_LEAVE_STATUS_LABELS,
  entitlementForStaff,
  isEligibleForVacation,
} from '@/lib/leaves/policy';
import type {
  OfficeLeaveRequestDoc,
  OfficeLeaveStatus,
  OfficeLeaveType,
} from '@/lib/leaves/types';
import { formatDateThaiBE } from '@/lib/date-thai';
import { HrProxyLeaveDialog } from '@/components/leaves/hr-proxy-leave-dialog';

const BE_YEAR_OFFSET = 543;

const THAI_MONTH_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: 'มกราคม' },
  { value: 2, label: 'กุมภาพันธ์' },
  { value: 3, label: 'มีนาคม' },
  { value: 4, label: 'เมษายน' },
  { value: 5, label: 'พฤษภาคม' },
  { value: 6, label: 'มิถุนายน' },
  { value: 7, label: 'กรกฎาคม' },
  { value: 8, label: 'สิงหาคม' },
  { value: 9, label: 'กันยายน' },
  { value: 10, label: 'ตุลาคม' },
  { value: 11, label: 'พฤศจิกายน' },
  { value: 12, label: 'ธันวาคม' },
];

function ceYearFromBe(beYear: number): number {
  return beYear - BE_YEAR_OFFSET;
}

function beYearFromCe(ceYear: number): number {
  return ceYear + BE_YEAR_OFFSET;
}

const yearOptionsBe = (() => {
  const cy = new Date().getFullYear();
  return Array.from({ length: 8 }, (_, i) => beYearFromCe(cy - i));
})();

/** คำขอลาทับกับเดือน/ปีที่กรอง (ปีเป็น พ.ศ. หรือ ALL) */
function leaveMatchesMonthYearFilter(
  r: OfficeLeaveRequestDoc,
  yearBe: 'ALL' | number,
  month: 'ALL' | number,
): boolean {
  const start = r.startDate.slice(0, 10);
  const end = r.endDate.slice(0, 10);
  if (yearBe === 'ALL' && month === 'ALL') return true;

  if (yearBe !== 'ALL' && month === 'ALL') {
    const ceYear = ceYearFromBe(yearBe);
    return start <= `${ceYear}-12-31` && end >= `${ceYear}-01-01`;
  }

  if (yearBe === 'ALL' && month !== 'ALL') {
    const startMs = Date.parse(`${start}T00:00:00+07:00`);
    const endMs = Date.parse(`${end}T00:00:00+07:00`);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
    for (let t = startMs; t <= endMs; t += 86_400_000) {
      const ymd = new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
      if (Number(ymd.slice(5, 7)) === month) return true;
    }
    return false;
  }

  const ceYear = ceYearFromBe(yearBe);
  const m = String(month).padStart(2, '0');
  const monthStart = `${ceYear}-${m}-01`;
  const lastDay = new Date(ceYear, month, 0).getDate();
  const monthEnd = `${ceYear}-${m}-${String(lastDay).padStart(2, '0')}`;
  return start <= monthEnd && end >= monthStart;
}

function yearFilterSummaryLabel(yearBe: 'ALL' | number): string {
  if (yearBe === 'ALL') return 'ทุกปี (พ.ศ.)';
  return `พ.ศ. ${yearBe}`;
}

const STATUS_FILTER: Array<{ value: 'ALL' | OfficeLeaveStatus; label: string }> = [
  { value: 'ALL', label: 'ทุกสถานะ' },
  { value: 'DRAFT', label: 'ฉบับร่าง' },
  { value: 'SUBMITTED', label: 'รออนุมัติ' },
  { value: 'APPROVED', label: 'อนุมัติแล้ว' },
  { value: 'REJECTED', label: 'ไม่อนุมัติ' },
  { value: 'CANCELLED', label: 'ยกเลิก' },
];

const TYPE_FILTER: Array<{ value: 'ALL' | OfficeLeaveType; label: string }> = [
  { value: 'ALL', label: 'ทุกประเภท' },
  { value: 'SICK', label: OFFICE_LEAVE_TYPE_LABELS.SICK },
  { value: 'PERSONAL', label: OFFICE_LEAVE_TYPE_LABELS.PERSONAL },
  { value: 'VACATION', label: OFFICE_LEAVE_TYPE_LABELS.VACATION },
];

export default function HrLeavesManagementPage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const canManage = !!currentUser && canViewHrPayrollFlowSubsection(currentUser, null, false);

  const [yearFilter, setYearFilter] = useState<'ALL' | number>('ALL');
  const [monthFilter, setMonthFilter] = useState<'ALL' | number>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | OfficeLeaveStatus>('ALL');
  const [typeFilter, setTypeFilter] = useState<'ALL' | OfficeLeaveType>('ALL');
  const [staffFilter, setStaffFilter] = useState<string>('ALL');

  /** office_staff (รายชื่อ + อายุงาน + แผนก) */
  const [officeStaff, setOfficeStaff] = useState<OfficeStaff[]>([]);
  const [staffLoading, setStaffLoading] = useState(true);
  /** entitlement config */
  const [entCfg, setEntCfg] = useState<OfficeLeaveEntitlementsDoc | null>(null);

  useEffect(() => {
    if (!firestore || !canManage) return;
    let cancel = false;
    setStaffLoading(true);
    void (async () => {
      try {
        const [staffSnap, cfgSnap] = await Promise.all([
          getDocs(query(collection(firestore, 'office_staff'), limit(500))),
          getDoc(doc(firestore, HR_CONFIGURATION_COLLECTION, HR_OFFICE_LEAVE_ENTITLEMENTS_DOC_ID)),
        ]);
        if (cancel) return;
        const rows = staffSnap.docs.map(
          (d) => ({ id: d.id, ...(d.data() as object) }) as OfficeStaff,
        );
        rows.sort((a, b) => (a.fullName || '').localeCompare(b.fullName || '', 'th'));
        setOfficeStaff(rows);
        setEntCfg(cfgSnap.exists() ? (cfgSnap.data() as OfficeLeaveEntitlementsDoc) : null);
      } catch (e) {
        toast({
          variant: 'destructive',
          title: 'โหลดทะเบียนไม่สำเร็จ',
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        if (!cancel) setStaffLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [firestore, canManage, toast]);

  /** leave requests — กรองปีที่ Firestore เมื่อเลือกปี พ.ศ. เฉพาะเจาะจง */
  const requestsQuery = useMemoFirebase(() => {
    if (!firestore || !canManage) return null;
    const col = collection(firestore, OFFICE_LEAVE_REQUESTS_COLLECTION);
    if (yearFilter === 'ALL') {
      return query(col, orderBy('createdAt', 'desc'), limit(3000));
    }
    const ceYear = ceYearFromBe(yearFilter);
    return query(col, where('year', '==', ceYear), orderBy('createdAt', 'desc'), limit(2000));
  }, [firestore, canManage, yearFilter]);

  const { data: leaves, isLoading: leavesLoading } = useCollection<OfficeLeaveRequestDoc>(
    requestsQuery as any,
  );

  const filteredLeaves = useMemo(() => {
    const rows = leaves ?? [];
    return rows.filter((r) => {
      if (!leaveMatchesMonthYearFilter(r, yearFilter, monthFilter)) return false;
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
      if (typeFilter !== 'ALL' && r.leaveType !== typeFilter) return false;
      if (staffFilter !== 'ALL' && r.staffId !== staffFilter) return false;
      return true;
    });
  }, [leaves, yearFilter, monthFilter, statusFilter, typeFilter, staffFilter]);

  const summaryRows = useMemo(() => {
    const byStaff = new Map<
      string,
      { approved: Record<OfficeLeaveType, number>; pending: Record<OfficeLeaveType, number> }
    >();
    for (const r of filteredLeaves) {
      const cur = byStaff.get(r.staffId) ?? {
        approved: { SICK: 0, PERSONAL: 0, VACATION: 0 },
        pending: { SICK: 0, PERSONAL: 0, VACATION: 0 },
      };
      const days = Number(r.days) || 0;
      if (r.status === 'APPROVED') cur.approved[r.leaveType] += days;
      else if (r.status === 'SUBMITTED') cur.pending[r.leaveType] += days;
      byStaff.set(r.staffId, cur);
    }
    const list = officeStaff.map((s) => {
      const v = byStaff.get(s.id) ?? {
        approved: { SICK: 0, PERSONAL: 0, VACATION: 0 } as Record<OfficeLeaveType, number>,
        pending: { SICK: 0, PERSONAL: 0, VACATION: 0 } as Record<OfficeLeaveType, number>,
      };
      const ent = entitlementForStaff(s, entCfg);
      return {
        staff: s,
        entitlement: ent,
        approved: v.approved,
        pending: v.pending,
        eligibleVac: isEligibleForVacation(s),
      };
    });
    return staffFilter === 'ALL' ? list : list.filter((r) => r.staff.id === staffFilter);
  }, [filteredLeaves, officeStaff, entCfg, staffFilter]);

  const pendingCount = useMemo(
    () => filteredLeaves.filter((r) => r.status === 'SUBMITTED').length,
    [filteredLeaves],
  );

  const [approving, setApproving] = useState<OfficeLeaveRequestDoc & { id: string } | null>(null);
  const [rejecting, setRejecting] = useState<OfficeLeaveRequestDoc & { id: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [submitBusy, setSubmitBusy] = useState(false);
  const [proxyDialogOpen, setProxyDialogOpen] = useState(false);
  const [editingLeave, setEditingLeave] = useState<(OfficeLeaveRequestDoc & { id: string }) | null>(null);

  function openCreateLeaveDialog() {
    setEditingLeave(null);
    setProxyDialogOpen(true);
  }

  function openEditLeaveDialog(row: OfficeLeaveRequestDoc & { id: string }) {
    setEditingLeave(row);
    setProxyDialogOpen(true);
  }

  function handleProxyDialogOpenChange(open: boolean) {
    setProxyDialogOpen(open);
    if (!open) setEditingLeave(null);
  }

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

  async function handleSubmitDraft(row: OfficeLeaveRequestDoc & { id: string }) {
    if (!firestore) return;
    if (!row.reason?.trim()) {
      toast({
        variant: 'destructive',
        title: 'ส่งไม่ได้',
        description: 'กรุณาระบุเหตุผลในใบลาก่อนส่งให้อนุมัติ',
      });
      return;
    }
    setSubmitBusy(true);
    try {
      await updateDoc(doc(firestore, OFFICE_LEAVE_REQUESTS_COLLECTION, row.id), {
        status: 'SUBMITTED',
        updatedAt: serverTimestamp(),
      });
      toast({
        title: 'ส่งเข้าคิวอนุมัติแล้ว',
        description: 'ผู้จัดการจะเห็นในหน้าคิวอนุมัติวันลา',
      });
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'ส่งไม่สำเร็จ',
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
      <div className="flex min-h-screen items-center justify-center text-muted-foreground text-sm">
        กำลังโหลด…
      </div>
    );
  }

  if (!canManage) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="max-w-3xl mx-auto py-16 text-center text-muted-foreground">
          คุณไม่มีสิทธิ์เข้าถึงเมนูจัดการการลา
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-6xl mx-auto space-y-6 pb-12">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/hr/dashboard">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary flex items-center gap-2">
              <CalendarOff className="h-6 w-6" /> การจัดการการลา (พนักงานออฟฟิศ)
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              สรุปวันลาและตรวจสอบคำขอลาของพนักงาน — ค่าสิทธิ์มาจาก{' '}
              <Link href="/hr/settings" className="text-primary underline">ตั้งค่า HR</Link>
              {' '}(ลาพักร้อนเปิดเมื่อทำงานครบ 365 วัน)
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-end gap-3">
              <Button type="button" className="gap-2" onClick={openCreateLeaveDialog}>
                <Plus className="h-4 w-4" />
                สร้างใบลาแทนพนักงาน
              </Button>
              <div className="space-y-1.5 w-36">
                <Label className="text-xs">เดือน</Label>
                <Select
                  value={monthFilter === 'ALL' ? 'ALL' : String(monthFilter)}
                  onValueChange={(v) => setMonthFilter(v === 'ALL' ? 'ALL' : Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">ทุกเดือน</SelectItem>
                    {THAI_MONTH_OPTIONS.map((m) => (
                      <SelectItem key={m.value} value={String(m.value)}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 w-36">
                <Label className="text-xs">ปี (พ.ศ.)</Label>
                <Select
                  value={yearFilter === 'ALL' ? 'ALL' : String(yearFilter)}
                  onValueChange={(v) => setYearFilter(v === 'ALL' ? 'ALL' : Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">ทุกปี</SelectItem>
                    {yearOptionsBe.map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        พ.ศ. {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 min-w-[160px] flex-1">
                <Label className="text-xs">สถานะ</Label>
                <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_FILTER.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 min-w-[160px] flex-1">
                <Label className="text-xs">ประเภท</Label>
                <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as any)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPE_FILTER.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 min-w-[200px] flex-1">
                <Label className="text-xs">พนักงาน</Label>
                <Select value={staffFilter} onValueChange={setStaffFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">พนักงานทั้งหมด</SelectItem>
                    {officeStaff.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="summary">
          <TabsList>
            <TabsTrigger value="summary">สรุปวันลา</TabsTrigger>
            <TabsTrigger value="requests" className="gap-2">
              <span>คำขอทั้งหมด</span>
              {pendingCount > 0 && (
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse"
                  title={`มี ${pendingCount} คำขอรออนุมัติ`}
                />
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="summary" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  สรุปวันลา ({yearFilterSummaryLabel(yearFilter)}
                  {monthFilter !== 'ALL'
                    ? ` · ${THAI_MONTH_OPTIONS.find((m) => m.value === monthFilter)?.label ?? ''}`
                    : ''}
                  )
                </CardTitle>
                <CardDescription>
                  คอลัมน์ = สิทธิ์/ใช้/รออนุมัติ/คงเหลือ ตามช่วงที่กรอง — สิทธิ์อ้างอิงตั้งค่า HR ปีปัจจุบัน
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {staffLoading || leavesLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                ) : summaryRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">ไม่พบพนักงานออฟฟิศ</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>พนักงาน</TableHead>
                          {(['SICK', 'PERSONAL', 'VACATION'] as OfficeLeaveType[]).map((t) => (
                            <TableHead key={t} className="text-center" colSpan={4}>
                              {OFFICE_LEAVE_TYPE_LABELS[t]}
                            </TableHead>
                          ))}
                        </TableRow>
                        <TableRow>
                          <TableHead />
                          {(['SICK', 'PERSONAL', 'VACATION'] as OfficeLeaveType[]).flatMap((t) => [
                            <TableHead key={`${t}-ent`} className="text-center text-[10px]">
                              สิทธิ์
                            </TableHead>,
                            <TableHead key={`${t}-app`} className="text-center text-[10px]">
                              ลาแล้ว
                            </TableHead>,
                            <TableHead key={`${t}-pen`} className="text-center text-[10px]">
                              รอ
                            </TableHead>,
                            <TableHead key={`${t}-rem`} className="text-center text-[10px]">
                              คงเหลือ
                            </TableHead>,
                          ])}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {summaryRows.map((row) => (
                          <TableRow key={row.staff.id}>
                            <TableCell className="font-medium min-w-[160px]">
                              {row.staff.fullName}
                              <div className="text-[10px] text-muted-foreground flex flex-wrap items-center gap-1">
                                <span>{row.staff.department}</span>
                                {!row.eligibleVac && (
                                  <Badge variant="outline" className="text-[9px] h-4 shrink-0">
                                    &lt; 365 วัน
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            {(['SICK', 'PERSONAL', 'VACATION'] as OfficeLeaveType[]).flatMap((t) => {
                              const ent = row.entitlement[t];
                              const used = row.approved[t];
                              const pen = row.pending[t];
                              const rem = Math.max(0, ent - used - pen);
                              return [
                                <TableCell key={`${t}-ent`} className="text-center font-mono text-xs">
                                  {ent}
                                </TableCell>,
                                <TableCell key={`${t}-app`} className="text-center font-mono text-xs">
                                  {used}
                                </TableCell>,
                                <TableCell
                                  key={`${t}-pen`}
                                  className="text-center font-mono text-xs text-amber-700"
                                >
                                  {pen}
                                </TableCell>,
                                <TableCell
                                  key={`${t}-rem`}
                                  className="text-center font-mono text-xs font-semibold"
                                >
                                  {rem}
                                </TableCell>,
                              ];
                            })}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="requests" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">คำขอลา ({filteredLeaves.length})</CardTitle>
                <CardDescription>
                  อนุมัติ / ปฏิเสธคำขอที่รออยู่ — ลาที่ยกเลิกแล้วจะคงประวัติไว้
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {leavesLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                ) : filteredLeaves.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">ไม่พบคำขอ</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>พนักงาน</TableHead>
                          <TableHead>ประเภท</TableHead>
                          <TableHead>วันที่ลา</TableHead>
                          <TableHead className="text-center">วัน</TableHead>
                          <TableHead>สถานะ</TableHead>
                          <TableHead>เหตุผล</TableHead>
                          <TableHead className="text-right">จัดการ</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredLeaves.map((r) => (
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
                            <TableCell
                              className="text-xs text-muted-foreground max-w-[220px] truncate"
                              title={`${r.reason}${r.rejectReason ? ` · ${r.rejectReason}` : ''}`}
                            >
                              {r.reason}
                              {r.rejectReason && (
                                <span className="text-destructive"> · {r.rejectReason}</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    disabled={r.status !== 'DRAFT' && r.status !== 'SUBMITTED'}
                                    onSelect={() =>
                                      openEditLeaveDialog({ ...(r as OfficeLeaveRequestDoc), id: r.id })
                                    }
                                  >
                                    <Pencil className="h-4 w-4 mr-2" /> แก้ไขใบลา
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    disabled={r.status !== 'DRAFT' || submitBusy}
                                    onSelect={() =>
                                      void handleSubmitDraft({ ...(r as OfficeLeaveRequestDoc), id: r.id })
                                    }
                                  >
                                    <Send className="h-4 w-4 mr-2 text-primary" /> ส่งให้อนุมัติ
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    disabled={r.status !== 'SUBMITTED'}
                                    onSelect={() =>
                                      setApproving({ ...(r as OfficeLeaveRequestDoc), id: r.id })
                                    }
                                  >
                                    <CheckCircle2 className="h-4 w-4 mr-2 text-green-600" /> อนุมัติ
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    disabled={r.status !== 'SUBMITTED'}
                                    className="text-destructive"
                                    onSelect={() => {
                                      setRejecting({ ...(r as OfficeLeaveRequestDoc), id: r.id });
                                      setRejectReason('');
                                    }}
                                  >
                                    <XCircle className="h-4 w-4 mr-2" /> ไม่อนุมัติ
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                                    สร้างโดย {r.createdByName || r.createdByUid}
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
          </TabsContent>
        </Tabs>

        <Dialog open={!!approving} onOpenChange={(open) => !open && setApproving(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>ยืนยันการอนุมัติ</DialogTitle>
              <DialogDescription>
                อนุมัติใบลาของ <strong>{approving?.staffNameSnapshot}</strong> —{' '}
                {approving && OFFICE_LEAVE_TYPE_LABELS[approving.leaveType]} {approving?.days} วัน
                {approving ? ` (${formatDateThaiBE(approving.startDate)}${approving.endDate !== approving.startDate ? ` – ${formatDateThaiBE(approving.endDate)}` : ''})` : ''}
              </DialogDescription>
            </DialogHeader>
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
                {rejecting?.staffNameSnapshot} — กรอกเหตุผลเพื่อแจ้งให้พนักงานทราบ
              </DialogDescription>
            </DialogHeader>
            <Textarea
              rows={4}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="ระบุเหตุผล..."
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

        {firestore && currentUser && (
          <HrProxyLeaveDialog
            open={proxyDialogOpen}
            onOpenChange={handleProxyDialogOpenChange}
            firestore={firestore}
            currentUser={currentUser}
            officeStaff={officeStaff}
            entCfg={entCfg}
            editLeave={editingLeave}
          />
        )}
      </div>
    </AppShell>
  );
}
