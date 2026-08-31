'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
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
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
import {
  ArrowLeft,
  CalendarOff,
  CheckCircle2,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Printer,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react';
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
import { canViewHrPayrollFlowSubsection, canViewHrApprovalSubsection } from '@/lib/navigation/nav-access';
import { isSystemAdmin } from '@/lib/permission-core';
import { isSimpleAdmin } from '@/lib/simple-tier-model';
import type { OfficeStaff, OfficePayrollRun } from '@/lib/types';
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
import {
  buildOfficeLeaveSummaryListPrintHtml,
  capOfficeLeaveSummaryListPrintRows,
  describeOfficeLeaveSummaryPrintFilters,
  type OfficeLeaveSummaryPrintRow,
} from '@/lib/documents/office-leave-summary-list-print';
import {
  buildOfficeLeaveRequestListPrintHtml,
  capOfficeLeaveRequestListPrintRows,
  mapOfficeLeaveRequestToPrintRow,
  officeLeaveApproverLabelTh,
  officeLeaveCreatedByLabelTh,
  officeLeaveDateRangeLabelTh,
} from '@/lib/documents/office-leave-request-list-print';
import { openStandardPrintWindow } from '@/lib/documents/standard-document-print';
import { HrProxyLeaveDialog } from '@/components/leaves/hr-proxy-leave-dialog';
import {
  calculatedPayrollRunsNeedingRecalcAfterLeaveChange,
  canEditOfficeLeaveRequest,
} from '@/lib/leaves/office-leave-payroll-edit-policy';
import {
  officeLeaveMatchesCalendarYear,
  sortOfficeLeaveRequestsNewestFirst,
} from '@/lib/leaves/office-leave-request-firestore';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Info } from 'lucide-react';

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

function currentLeaveFilterMonthYear(): { yearBe: number; month: number } {
  const ymd = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  return {
    yearBe: beYearFromCe(Number(ymd.slice(0, 4))),
    month: Number(ymd.slice(5, 7)),
  };
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

  if (typeof yearBe !== 'number' || typeof month !== 'number') return false;

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

function summaryPeriodLabel(yearBe: 'ALL' | number, month: 'ALL' | number): string {
  const yearPart = yearFilterSummaryLabel(yearBe);
  if (month === 'ALL') return yearPart;
  const monthLabel = THAI_MONTH_OPTIONS.find((m) => m.value === month)?.label ?? '';
  return `${yearPart} · ${monthLabel}`;
}

type LeaveSummaryRow = {
  staff: OfficeStaff;
  entitlement: Record<OfficeLeaveType, number>;
  approved: Record<OfficeLeaveType, number>;
  pending: Record<OfficeLeaveType, number>;
  eligibleVac: boolean;
};

function buildLeaveSummaryRows(
  leaveRows: OfficeLeaveRequestDoc[],
  staffList: OfficeStaff[],
  entCfg: OfficeLeaveEntitlementsDoc | null,
  staffFilterId: string,
): LeaveSummaryRow[] {
  const byStaff = new Map<
    string,
    { approved: Record<OfficeLeaveType, number>; pending: Record<OfficeLeaveType, number> }
  >();
  for (const r of leaveRows) {
    const cur = byStaff.get(r.staffId) ?? {
      approved: { SICK: 0, PERSONAL: 0, VACATION: 0 },
      pending: { SICK: 0, PERSONAL: 0, VACATION: 0 },
    };
    const days = Number(r.days) || 0;
    if (r.status === 'APPROVED') cur.approved[r.leaveType] += days;
    else if (r.status === 'SUBMITTED') cur.pending[r.leaveType] += days;
    byStaff.set(r.staffId, cur);
  }
  const list = staffList.map((s) => {
    const v = byStaff.get(s.id) ?? {
      approved: { SICK: 0, PERSONAL: 0, VACATION: 0 } as Record<OfficeLeaveType, number>,
      pending: { SICK: 0, PERSONAL: 0, VACATION: 0 } as Record<OfficeLeaveType, number>,
    };
    return {
      staff: s,
      entitlement: entitlementForStaff(s, entCfg),
      approved: v.approved,
      pending: v.pending,
      eligibleVac: isEligibleForVacation(s),
    };
  });
  return staffFilterId === 'ALL' ? list : list.filter((r) => r.staff.id === staffFilterId);
}

function mapLeaveSummaryToPrintRow(row: LeaveSummaryRow): OfficeLeaveSummaryPrintRow {
  const block = (t: OfficeLeaveType) => {
    const ent = row.entitlement[t];
    const used = row.approved[t];
    const pending = row.pending[t];
    return {
      entitlement: ent,
      used,
      pending,
      remaining: Math.max(0, ent - used - pending),
    };
  };
  return {
    staffName: row.staff.fullName || '—',
    department: row.staff.department || '',
    under365Days: !row.eligibleVac,
    sick: block('SICK'),
    personal: block('PERSONAL'),
    vacation: block('VACATION'),
  };
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
  const canApproveLeaves = useMemo(
    () =>
      !!currentUser &&
      canViewHrApprovalSubsection(
        currentUser,
        isSystemAdmin(currentUser) || isSimpleAdmin(currentUser),
      ),
    [currentUser],
  );
  const canDeleteLeaves = useMemo(
    () => !!currentUser && (isSystemAdmin(currentUser) || isSimpleAdmin(currentUser)),
    [currentUser],
  );

  const [yearFilter, setYearFilter] = useState<'ALL' | number>(
    () => currentLeaveFilterMonthYear().yearBe,
  );
  const [monthFilter, setMonthFilter] = useState<'ALL' | number>(
    () => currentLeaveFilterMonthYear().month,
  );
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

  /** โหลดทั้ง collection แล้วกรอง/เรียงฝั่ง client — หลีกเลี่ยง orderBy ที่ทำให้ doc หายเมื่อไม่มี index/createdAt */
  const requestsQuery = useMemoFirebase(() => {
    if (!firestore || !canManage) return null;
    return query(collection(firestore, OFFICE_LEAVE_REQUESTS_COLLECTION), limit(5000));
  }, [firestore, canManage]);

  const {
    data: leaves,
    isLoading: leavesLoading,
    error: leavesQueryError,
  } = useCollection<OfficeLeaveRequestDoc>(requestsQuery as any);

  const payrollRunsQuery = useMemoFirebase(() => {
    if (!firestore || !canManage) return null;
    return query(collection(firestore, 'office_payroll_runs'), orderBy('createdAt', 'desc'), limit(48));
  }, [firestore, canManage]);

  const { data: payrollRunsRaw } = useCollection<OfficePayrollRun>(payrollRunsQuery as any);
  const payrollRuns = payrollRunsRaw ?? [];

  const filteredLeaves = useMemo(() => {
    const rows = sortOfficeLeaveRequestsNewestFirst(leaves ?? []);
    return rows.filter((r) => {
      if (yearFilter !== 'ALL') {
        const ceYear = ceYearFromBe(yearFilter);
        if (!officeLeaveMatchesCalendarYear(r, ceYear)) return false;
      }
      if (!leaveMatchesMonthYearFilter(r, yearFilter, monthFilter)) return false;
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
      if (typeFilter !== 'ALL' && r.leaveType !== typeFilter) return false;
      if (staffFilter !== 'ALL' && r.staffId !== staffFilter) return false;
      return true;
    });
  }, [leaves, yearFilter, monthFilter, statusFilter, typeFilter, staffFilter]);

  const pendingCountAll = useMemo(
    () => (leaves ?? []).filter((r) => r.status === 'SUBMITTED').length,
    [leaves],
  );

  const summaryRows = useMemo(
    () => buildLeaveSummaryRows(filteredLeaves, officeStaff, entCfg, staffFilter),
    [filteredLeaves, officeStaff, entCfg, staffFilter],
  );

  const summaryRowsAll = useMemo(
    () => buildLeaveSummaryRows(leaves ?? [], officeStaff, entCfg, 'ALL'),
    [leaves, officeStaff, entCfg],
  );

  const pendingCount = useMemo(
    () => filteredLeaves.filter((r) => r.status === 'SUBMITTED').length,
    [filteredLeaves],
  );

  const [approving, setApproving] = useState<OfficeLeaveRequestDoc & { id: string } | null>(null);
  const [rejecting, setRejecting] = useState<OfficeLeaveRequestDoc & { id: string } | null>(null);
  const [deletingLeave, setDeletingLeave] = useState<(OfficeLeaveRequestDoc & { id: string }) | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [submitBusy, setSubmitBusy] = useState(false);
  const [proxyDialogOpen, setProxyDialogOpen] = useState(false);
  const [editingLeave, setEditingLeave] = useState<(OfficeLeaveRequestDoc & { id: string }) | null>(null);
  const [activeTab, setActiveTab] = useState<'summary' | 'requests'>('summary');
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [requestsPrintDialogOpen, setRequestsPrintDialogOpen] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);

  const selectedStaffName = useMemo(() => {
    if (staffFilter === 'ALL') return undefined;
    return officeStaff.find((s) => s.id === staffFilter)?.fullName;
  }, [staffFilter, officeStaff]);

  const printFilterLines = useMemo(
    () =>
      describeOfficeLeaveSummaryPrintFilters({
        monthFilter,
        monthLabel: THAI_MONTH_OPTIONS.find((m) => m.value === monthFilter)?.label,
        yearFilter,
        statusFilter,
        typeFilter,
        staffFilter,
        staffName: selectedStaffName,
      }),
    [monthFilter, yearFilter, statusFilter, typeFilter, staffFilter, selectedStaffName],
  );

  const runLeaveSummaryPrint = useCallback(
    async (scope: 'filtered' | 'all') => {
      const source = scope === 'filtered' ? summaryRows : summaryRowsAll;
      if (source.length === 0) {
        toast({
          variant: 'destructive',
          title: 'ไม่มีรายการให้พิมพ์',
          description:
            scope === 'filtered'
              ? 'ไม่พบพนักงานตามตัวกรอง — ปรับตัวกรองหรือพิมพ์ทั้งหมด'
              : 'ยังไม่มีพนักงานออฟฟิศในระบบ',
        });
        return;
      }

      setPrintBusy(true);
      try {
        const printRows = source.map(mapLeaveSummaryToPrintRow);
        const { rows: capped, truncated } = capOfficeLeaveSummaryListPrintRows(printRows);
        const generatedAt = new Date().toLocaleString('th-TH', {
          dateStyle: 'medium',
          timeStyle: 'short',
        });
        const filterLines = scope === 'filtered' ? printFilterLines : [];
        const scopeTitle =
          scope === 'filtered' ? 'พิมพ์ตามตัวกรองปัจจุบัน' : 'พิมพ์ทั้งหมด (ทุกพนักงาน · ไม่ใช้ตัวกรองย่อย)';
        const periodTitle =
          scope === 'filtered'
            ? summaryPeriodLabel(yearFilter, monthFilter)
            : summaryPeriodLabel(yearFilter, 'ALL');

        const body = buildOfficeLeaveSummaryListPrintHtml({
          rows: capped,
          scopeTitle,
          filterLines,
          periodTitle,
          generatedAt,
          printedBy: currentUser?.displayName,
          truncated,
        });

        const okPrint = await openStandardPrintWindow({
          windowTitle: 'Office-Leave-Summary',
          suggestedFileName: `Office-Leave-Summary-${scope === 'filtered' ? 'Filtered' : 'All'}`,
          bodyInnerHtml: body,
          htmlLang: 'th',
        });

        if (!okPrint) {
          toast({
            variant: 'destructive',
            title: 'เปิดหน้าต่างพิมพ์ไม่ได้',
            description: 'กรุณาอนุญาตป๊อปอัปสำหรับเว็บไซต์นี้',
          });
          return;
        }
        setPrintDialogOpen(false);
      } finally {
        setPrintBusy(false);
      }
    },
    [
      summaryRows,
      summaryRowsAll,
      monthFilter,
      yearFilter,
      printFilterLines,
      currentUser?.displayName,
      toast,
    ],
  );

  const allLeaveRequests = useMemo(
    () => sortOfficeLeaveRequestsNewestFirst(leaves ?? []),
    [leaves],
  );

  const runLeaveRequestsPrint = useCallback(
    async (scope: 'filtered' | 'all') => {
      const source = scope === 'filtered' ? filteredLeaves : allLeaveRequests;
      if (source.length === 0) {
        toast({
          variant: 'destructive',
          title: 'ไม่มีรายการให้พิมพ์',
          description:
            scope === 'filtered'
              ? 'ไม่พบคำขอตามตัวกรอง — ปรับตัวกรองหรือพิมพ์ทั้งหมด'
              : 'ยังไม่มีคำขอลาในระบบ',
        });
        return;
      }

      setPrintBusy(true);
      try {
        const printRows = source.map((r) => mapOfficeLeaveRequestToPrintRow(r));
        const { rows: capped, truncated } = capOfficeLeaveRequestListPrintRows(printRows);
        const generatedAt = new Date().toLocaleString('th-TH', {
          dateStyle: 'medium',
          timeStyle: 'short',
        });
        const filterLines = scope === 'filtered' ? printFilterLines : [];
        const scopeTitle =
          scope === 'filtered'
            ? 'พิมพ์ตามตัวกรองปัจจุบัน'
            : 'พิมพ์ทั้งหมด (ไม่ใช้ตัวกรองย่อย)';

        const body = buildOfficeLeaveRequestListPrintHtml({
          rows: capped,
          scopeTitle,
          filterLines,
          generatedAt,
          printedBy: currentUser?.displayName,
          truncated,
        });

        const okPrint = await openStandardPrintWindow({
          windowTitle: 'Office-Leave-Requests',
          suggestedFileName: `Office-Leave-Requests-${scope === 'filtered' ? 'Filtered' : 'All'}`,
          bodyInnerHtml: body,
          htmlLang: 'th',
        });

        if (!okPrint) {
          toast({
            variant: 'destructive',
            title: 'เปิดหน้าต่างพิมพ์ไม่ได้',
            description: 'กรุณาอนุญาตป๊อปอัปสำหรับเว็บไซต์นี้',
          });
          return;
        }
        setRequestsPrintDialogOpen(false);
      } finally {
        setPrintBusy(false);
      }
    },
    [filteredLeaves, allLeaveRequests, printFilterLines, currentUser?.displayName, toast],
  );

  function openCreateLeaveDialog() {
    setEditingLeave(null);
    setProxyDialogOpen(true);
  }

  const calculatedOpenRuns = useMemo(
    () => payrollRuns.filter((r) => r.status === 'CALCULATED'),
    [payrollRuns],
  );

  function openEditLeaveDialog(row: OfficeLeaveRequestDoc & { id: string }) {
    if (!canEditOfficeLeaveRequest(row, payrollRuns)) {
      toast({
        variant: 'destructive',
        title: 'แก้ไขใบลาไม่ได้',
        description:
          'งวดเงินเดือนเดือนนี้ถูกส่งอนุมัติหรือล็อกแล้ว — แก้ได้เฉพาะงวดที่ยัง «คำนวณแล้ว (ยังไม่ส่งขออนุมัติ)»',
      });
      return;
    }
    setEditingLeave(row);
    setProxyDialogOpen(true);
  }

  function handleProxyDialogOpenChange(open: boolean) {
    setProxyDialogOpen(open);
    if (!open) setEditingLeave(null);
  }

  function handleLeavePersisted(result: {
    id: string;
    status: OfficeLeaveStatus;
    leave?: Pick<OfficeLeaveRequestDoc, 'startDate' | 'endDate'>;
  }) {
    setActiveTab('requests');
    setStatusFilter('ALL');
    if (result.status === 'SUBMITTED') {
      toast({
        title: 'คำขออยู่ในสถานะรออนุมัติ',
        description: 'ตั้งตัวกรองเป็น «ทุกสถานะ» แล้ว — หาแถวสถานะ «รออนุมัติ» หรือไปศูนย์อนุมัติวันลา',
      });
    } else if (result.status === 'DRAFT') {
      setStatusFilter('DRAFT');
    }
    if (result.leave) {
      const runs = calculatedPayrollRunsNeedingRecalcAfterLeaveChange(result.leave, payrollRuns);
      if (runs.length > 0) {
        toast({
          title: 'แก้ไขใบลาแล้ว',
          description: `มีงวดเงินเดือนที่คำนวณแล้ว (${runs.map((r) => r.payrollRunNo).join(', ')}) — กด «คำนวณ/สร้างรายละเอียด» ใหม่ที่เมนูงวดจ่าย`,
        });
      }
    }
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
        description: 'ผู้จัดการจะเห็นในศูนย์อนุมัติ → อนุมัติวันลา',
      });
      setActiveTab('requests');
      setStatusFilter('ALL');
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

  async function handleConfirmDeleteLeave() {
    if (!firestore || !deletingLeave || !canDeleteLeaves) return;
    setDeleteBusy(true);
    try {
      await deleteDoc(doc(firestore, OFFICE_LEAVE_REQUESTS_COLLECTION, deletingLeave.id));
      toast({
        title: 'ลบใบลาแล้ว',
        description: `${deletingLeave.staffNameSnapshot} — ${OFFICE_LEAVE_TYPE_LABELS[deletingLeave.leaveType]} ${deletingLeave.days} วัน`,
      });
      if (deletingLeave.status === 'APPROVED') {
        const runs = calculatedPayrollRunsNeedingRecalcAfterLeaveChange(deletingLeave, payrollRuns);
        if (runs.length > 0) {
          toast({
            title: 'แนะนำคำนวณงวดเงินเดือนใหม่',
            description: `ใบลาที่อนุมัติถูกลบแล้ว — งวด ${runs.map((r) => r.payrollRunNo).join(', ')} อาจต้องคำนวณใหม่`,
          });
        }
      }
      setDeletingLeave(null);
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'ลบไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setDeleteBusy(false);
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

        {pendingCountAll > 0 ? (
          <Alert className="border-amber-300 bg-amber-50/80 dark:bg-amber-950/20">
            <Info className="h-4 w-4" />
            <AlertTitle>มี {pendingCountAll} คำขอรออนุมัติ (ทั้งระบบ)</AlertTitle>
            <AlertDescription className="text-sm">
              {canApproveLeaves ? (
                <>
                  อนุมัติหรือไม่อนุมัติได้ที่{' '}
                  <Link href="/hr/approval-center/office-leaves" className="font-medium text-primary underline">
                    ศูนย์อนุมัติ → อนุมัติวันลา
                  </Link>
                  {' '}(ไม่ใช่ปุ่มอนุมัติในตารางด้านล่างสำหรับฝ่ายที่สร้างใบลา)
                </>
              ) : (
                <>
                  ส่งเข้าคิวแล้ว — รอผู้จัดการอนุมัติที่{' '}
                  <Link href="/hr/approval-center/office-leaves" className="font-medium text-primary underline">
                    ศูนย์อนุมัติวันลา
                  </Link>
                </>
              )}
            </AlertDescription>
          </Alert>
        ) : null}

        {calculatedOpenRuns.length > 0 ? (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>งวดเงินเดือนที่คำนวณแล้ว (ยังไม่ส่งอนุมัติ)</AlertTitle>
            <AlertDescription className="text-sm space-y-1">
              <p>
                {calculatedOpenRuns.map((r) => r.payrollRunNo).join(', ')} — ยังแก้ไขใบลา/วันลาได้
                (รวมใบที่อนุมัติแล้ว) เพื่อให้ยอดถูกต้องก่อนส่งอนุมัติงวดจ่าย
              </p>
              <p>
                หลังแก้ใบลาแล้ว กด{' '}
                <Link href="/office-payroll" className="font-medium text-primary underline">
                  คำนวณ/สร้างรายละเอียด
                </Link>{' '}
                ที่งวดเดิมอีกครั้ง
              </p>
            </AlertDescription>
          </Alert>
        ) : null}

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'summary' | 'requests')}>
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
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div className="space-y-1.5">
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
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 shrink-0 gap-2"
                  disabled={staffLoading || leavesLoading || printBusy}
                  onClick={() => setPrintDialogOpen(true)}
                >
                  <Printer className="h-4 w-4" /> พิมพ์รายการ
                </Button>
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
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div className="space-y-1.5">
                  <CardTitle className="text-base">คำขอลา ({filteredLeaves.length})</CardTitle>
                  <CardDescription>
                    อนุมัติ / ปฏิเสธคำขอที่รออยู่ — ลาที่ยกเลิกแล้วจะคงประวัติไว้
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 shrink-0 gap-2"
                  disabled={leavesLoading || printBusy || allLeaveRequests.length === 0}
                  onClick={() => setRequestsPrintDialogOpen(true)}
                >
                  <Printer className="h-4 w-4" /> พิมพ์รายการ
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {leavesQueryError ? (
                  <p className="py-10 px-4 text-center text-sm text-destructive">
                    โหลดคำขอลาไม่สำเร็จ — {leavesQueryError.message}
                  </p>
                ) : leavesLoading ? (
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
                          <TableHead>ผู้จัดทำใบลา</TableHead>
                          <TableHead>ผู้อนุมัติ</TableHead>
                          <TableHead>เหตุผล</TableHead>
                          <TableHead className="text-right">จัดการ</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredLeaves.map((r) => {
                          const rowEditable = canEditOfficeLeaveRequest(
                            r as OfficeLeaveRequestDoc,
                            payrollRuns,
                          );
                          return (
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
                              {officeLeaveDateRangeLabelTh(r)}
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
                            <TableCell className="text-xs whitespace-nowrap">
                              {officeLeaveCreatedByLabelTh(r)}
                            </TableCell>
                            <TableCell className="text-xs whitespace-nowrap">
                              {officeLeaveApproverLabelTh(r)}
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
                                    disabled={!rowEditable}
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
                                  {canApproveLeaves ? (
                                    <>
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
                                    </>
                                  ) : null}
                                  {canDeleteLeaves ? (
                                    <>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        disabled={deleteBusy}
                                        className="text-destructive focus:text-destructive"
                                        onSelect={() =>
                                          setDeletingLeave({ ...(r as OfficeLeaveRequestDoc), id: r.id })
                                        }
                                      >
                                        <Trash2 className="h-4 w-4 mr-2" /> ลบรายการ (ถังขยะ)
                                      </DropdownMenuItem>
                                    </>
                                  ) : null}
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                                    สร้างโดย {r.createdByName || r.createdByUid}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Dialog open={printDialogOpen} onOpenChange={setPrintDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>พิมพ์สรุปวันลา</DialogTitle>
              <DialogDescription>
                เลือกพิมพ์ตามตัวกรองปัจจุบัน ({summaryRows.length} คน) หรือพิมพ์ทุกพนักงานโดยไม่ใช้ตัวกรองย่อย (
                {summaryRowsAll.length} คน)
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 text-sm text-muted-foreground">
              {printFilterLines.length > 0 ? (
                printFilterLines.map((line) => <p key={line}>· {line}</p>)
              ) : (
                <p>· ไม่มีตัวกรองย่อย — แสดงทุกพนักงานตามชุดข้อมูล</p>
              )}
            </div>
            <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setPrintDialogOpen(false)} disabled={printBusy}>
                ยกเลิก
              </Button>
              <Button
                variant="outline"
                disabled={printBusy || summaryRowsAll.length === 0}
                onClick={() => void runLeaveSummaryPrint('all')}
              >
                {printBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                พิมพ์ทั้งหมด
              </Button>
              <Button disabled={printBusy || summaryRows.length === 0} onClick={() => void runLeaveSummaryPrint('filtered')}>
                {printBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                พิมพ์ตามตัวกรอง
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={requestsPrintDialogOpen} onOpenChange={setRequestsPrintDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>พิมพ์รายการคำขอลา</DialogTitle>
              <DialogDescription>
                เลือกพิมพ์ตามตัวกรองปัจจุบัน ({filteredLeaves.length} รายการ) หรือพิมพ์ทั้งหมดโดยไม่ใช้ตัวกรองย่อย (
                {allLeaveRequests.length} รายการ)
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 text-sm text-muted-foreground">
              {printFilterLines.length > 0 ? (
                printFilterLines.map((line) => <p key={line}>· {line}</p>)
              ) : (
                <p>· ไม่มีตัวกรองย่อย — แสดงทุกคำขอในชุดข้อมูล</p>
              )}
            </div>
            <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setRequestsPrintDialogOpen(false)} disabled={printBusy}>
                ยกเลิก
              </Button>
              <Button
                variant="outline"
                disabled={printBusy || allLeaveRequests.length === 0}
                onClick={() => void runLeaveRequestsPrint('all')}
              >
                {printBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                พิมพ์ทั้งหมด
              </Button>
              <Button
                disabled={printBusy || filteredLeaves.length === 0}
                onClick={() => void runLeaveRequestsPrint('filtered')}
              >
                {printBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                พิมพ์ตามตัวกรอง
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

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

        <AlertDialog
          open={!!deletingLeave}
          onOpenChange={(open) => {
            if (!open && !deleteBusy) setDeletingLeave(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ลบใบลานี้ถาวร?</AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <span>
                  จะลบคำขอของ <strong>{deletingLeave?.staffNameSnapshot}</strong> —{' '}
                  {deletingLeave && OFFICE_LEAVE_TYPE_LABELS[deletingLeave.leaveType]}{' '}
                  {deletingLeave?.days} วัน (
                  {deletingLeave ? formatDateThaiBE(deletingLeave.startDate) : ''}
                  {deletingLeave && deletingLeave.endDate !== deletingLeave.startDate
                    ? ` – ${formatDateThaiBE(deletingLeave.endDate)}`
                    : ''}
                  ) ออกจากระบบ
                </span>
                {deletingLeave?.status === 'APPROVED' ? (
                  <span className="block text-destructive text-xs">
                    ใบลานี้อนุมัติแล้ว — หากมีงวดเงินเดือนที่คำนวณไปแล้ว ให้คำนวณงวดใหม่หลังลบ
                  </span>
                ) : null}
                <span className="block text-xs text-muted-foreground">
                  การลบไม่สามารถกู้คืนได้ — ใช้เฉพาะเมื่อบันทึกผิดหรือทดสอบข้อมูล
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteBusy}>ยกเลิก</AlertDialogCancel>
              <Button
                variant="destructive"
                disabled={deleteBusy}
                onClick={() => void handleConfirmDeleteLeave()}
              >
                {deleteBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                ลบถาวร
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {firestore && currentUser && (
          <HrProxyLeaveDialog
            open={proxyDialogOpen}
            onOpenChange={handleProxyDialogOpenChange}
            firestore={firestore}
            currentUser={currentUser}
            officeStaff={officeStaff}
            entCfg={entCfg}
            editLeave={editingLeave}
            onLeavePersisted={handleLeavePersisted}
          />
        )}
      </div>
    </AppShell>
  );
}
