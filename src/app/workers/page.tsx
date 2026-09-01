'use client';

import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Plus,
  Search,
  CheckCircle2,
  AlertCircle,
  FileQuestion,
  ShieldAlert,
  Trash2,
  HardHat,
  ChevronRight,
  ChevronDown,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Info,
  Loader2,
  Package,
  Printer,
} from 'lucide-react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Worker, ReadinessStatus, User, Position, DailyTimesheet, Assignment, WorkerStatus, Customer } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog';
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
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { deleteDocumentNonBlocking, addDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import { usePermissions } from '@/hooks/use-permissions';
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';
import { canAccess, isMatrixControlledRole, isSystemAdmin, isOperationsPillarExecutive } from '@/lib/permissions';
import { assertWorkerCanBeDeleted, deleteWorkerWithAuditLog } from '@/lib/services/worker-delete-service';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import { useAppUser } from '@/hooks/use-app-user';
import { sortPositionsByDisplayName } from '@/lib/position-display';
import { effectiveWorkerJobStatus, displayWorkerRegistryJobStatus, workerRegistryJobStatusBadgeProps, resolveWorkerOnSiteAssignment, resolveWorkerAssignedAssignment, formatWorkerOnSiteCompanyLocation, type WorkerRegistryJobStatusDisplay } from '@/lib/ops/worker-effective-job-status';
import { isWorkerDispatchReady } from '@/lib/worker-readiness';
import { formatWorkerNotReadyReasonDisplay } from '@/lib/hr/worker-not-ready-reason';
import { openStandardPrintWindow } from '@/lib/documents/standard-document-print';
import {
  buildWorkerListPrintHtml,
  capWorkerListPrintRows,
  describeWorkerListPrintFilters,
  type WorkerListPrintRow,
} from '@/lib/documents/worker-list-print';

type WorkerSortKey = 'name' | 'hours';
type WorkerSortDir = 'asc' | 'desc';

function readinessStatusPrintLabel(status: ReadinessStatus | undefined): string {
  switch (status) {
    case 'READY':
      return 'READY';
    case 'MISSING_CERTIFICATE':
      return 'เซอร์ไม่ครบ';
    case 'MEDICAL_EXPIRED':
      return 'MED EXPIRED';
    case 'DRUG_TEST_EXPIRED':
      return 'DRUG EXPIRED';
    case 'DOCUMENT_EXPIRED':
      return 'DOC EXPIRED';
    case 'BLOCKED':
      return 'BLOCKED';
    default:
      return status ? String(status) : 'PENDING';
  }
}

function workerDisplayNameKey(w: Worker): string {
  return `${w.firstName || ''} ${w.lastName || ''}`.trim() || w.workerCode || w.id;
}

function compareWorkersByName(a: Worker, b: Worker, dir: WorkerSortDir): number {
  const ka = workerDisplayNameKey(a);
  const kb = workerDisplayNameKey(b);
  const c = ka.localeCompare(kb, 'th', { sensitivity: 'base', numeric: true });
  if (c !== 0) return dir === 'asc' ? c : -c;
  const code = (a.workerCode || '').localeCompare(b.workerCode || '', 'th', { numeric: true });
  if (code !== 0) return dir === 'asc' ? code : -code;
  const idc = a.id.localeCompare(b.id);
  return dir === 'asc' ? idc : -idc;
}

function workerTotalHours(
  w: Worker,
  hoursMap: Map<string, { totalHours: number; firstWorkedAt: number | null; lastWorkedAt: number | null }>,
): number {
  return Number(hoursMap.get(w.id)?.totalHours || w.totalWorkedHours || 0);
}

/** ชั่วโมง: desc = มาก→น้อย, asc = น้อย→มาก — เทียบเท่ากันเรียงชื่อ A–Z */
function compareWorkersByHours(
  a: Worker,
  b: Worker,
  dir: WorkerSortDir,
  hoursMap: Map<string, { totalHours: number; firstWorkedAt: number | null; lastWorkedAt: number | null }>,
): number {
  const ha = workerTotalHours(a, hoursMap);
  const hb = workerTotalHours(b, hoursMap);
  if (ha !== hb) return dir === 'asc' ? ha - hb : hb - ha;
  return compareWorkersByName(a, b, 'asc');
}

type WorkerJobStatusFilter = 'all' | WorkerRegistryJobStatusDisplay;

const WORKER_JOB_STATUS_FILTER_OPTIONS: { value: WorkerJobStatusFilter; label: string }[] = [
  { value: 'all', label: 'ทุกสถานะงาน' },
  { value: 'AVAILABLE', label: 'AVAILABLE' },
  { value: 'NOT_READY_TO_ASSIGN', label: 'NOT READY TO ASSIGN' },
  { value: 'NOT_READY_TO_WORK', label: 'NOT READY TO WORK' },
  { value: 'ASSIGNED', label: 'ASSIGNED' },
  { value: 'ON_SITE', label: 'ON_SITE' },
  { value: 'ON_LEAVE', label: 'ON_LEAVE' },
  { value: 'INACTIVE', label: 'INACTIVE' },
  { value: 'BLACKLISTED', label: 'BLACKLISTED' },
];

function workerMatchesJobStatusFilter(
  worker: Worker,
  mobilizations: Assignment[] | null | undefined,
  filter: WorkerJobStatusFilter,
): boolean {
  if (filter === 'all') return true;
  return displayWorkerRegistryJobStatus(worker, mobilizations) === filter;
}

function getInitialNewWorker(): Partial<Worker> {
  return {
    workerCode: getPreviewPattern('worker') ?? '',
    firstName: '',
    lastName: '',
    thaiNationalId: '',
    currentPositionId: '',
    workerStatus: 'AVAILABLE',
    readinessStatus: 'INCOMPLETE',
    nationality: 'Thai',
    gender: 'MALE',
  };
}

export default function WorkersPage() {
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const { can, check, payroll, isLoading: isPermLoading } = usePermissions(currentUser);
  const useMatrixGuards = isMatrixControlledRole(currentUser);
  const canViewWorkers = useMatrixGuards ? canAccess(currentUser, 'workers', 'view') : can('workers').view;
  const canCreateWorkers = useMatrixGuards ? canAccess(currentUser, 'workers', 'create') : can('workers').create;

  const workersQuery = useMemoFirebase(() => {
    if (isUserLoading || !firebaseUser || !firestore || !currentUser || !canViewWorkers) return null;
    return collection(firestore, 'workers');
  }, [firestore, firebaseUser, isUserLoading, currentUser, canViewWorkers]);

  const { data: workers, isLoading: isCollectionLoading } = useCollection<Worker>(workersQuery as any);

  const positionsQuery = useMemoFirebase(() => {
    if (!firestore || !firebaseUser || !can('positions').view) return null;
    return collection(firestore, 'positions');
  }, [firestore, firebaseUser, can('positions').view]);
  const { data: positions } = useCollection<Position>(positionsQuery as any);

  const positionsSortedForFilter = useMemo(
    () => sortPositionsByDisplayName(positions ?? []),
    [positions]
  );

  const timesheetsQuery = useMemoFirebase(() => {
    if (!firestore || !firebaseUser || !canViewWorkers) return null;
    return collection(firestore, 'daily_timesheets');
  }, [firestore, firebaseUser, canViewWorkers]);
  const { data: allTimesheets } = useCollection<DailyTimesheet>(timesheetsQuery as any);

  const canDeleteWorkerRecord = useMemo(() => {
    if (!currentUser) return false;
    if (isSystemAdmin(currentUser) || isOperationsPillarExecutive(currentUser)) return true;
    return check('workers', 'delete');
  }, [currentUser, check]);

  const mobilizationsQuery = useMemoFirebase(() => {
    if (!firestore || !firebaseUser || !canViewWorkers) return null;
    return collection(firestore, 'mobilizations');
  }, [firestore, firebaseUser, canViewWorkers]);
  const { data: allMobilizations } = useCollection<Assignment>(mobilizationsQuery as any);

  const customersQuery = useMemoFirebase(() => {
    if (!firestore || !firebaseUser || !canViewWorkers) return null;
    return collection(firestore, 'customers');
  }, [firestore, firebaseUser, canViewWorkers]);
  const { data: allCustomers } = useCollection<Customer>(customersQuery as any);

  const customerNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of allCustomers ?? []) {
      const name = (c.name || '').trim();
      if (name) m.set(c.id, name);
    }
    return m;
  }, [allCustomers]);

  const workerHoursById = useMemo(() => {
    const bucket = new Map<string, { totalHours: number; firstWorkedAt: number | null; lastWorkedAt: number | null }>();
    (allTimesheets || []).forEach((ts) => {
      const workerId = ts.workerId;
      if (!workerId) return;
      const tsTime = ts.date ? new Date(ts.date).getTime() : NaN;
      const normalHours = Number(ts.normalHours || 0);
      const ot15Hours = Number(ts.ot15Hours || 0);
      const ot20Hours = Number(ts.ot20Hours || 0);
      const ot30Hours = Number(ts.ot30Hours || 0);
      const holidayHours = Number(ts.holidayHours || 0);
      const totalHours = normalHours + ot15Hours + ot20Hours + ot30Hours + holidayHours;
      const current = bucket.get(workerId) || { totalHours: 0, firstWorkedAt: null, lastWorkedAt: null };
      current.totalHours += totalHours;
      if (!Number.isNaN(tsTime)) {
        current.firstWorkedAt = current.firstWorkedAt === null ? tsTime : Math.min(current.firstWorkedAt, tsTime);
        current.lastWorkedAt = current.lastWorkedAt === null ? tsTime : Math.max(current.lastWorkedAt, tsTime);
      }
      bucket.set(workerId, current);
    });
    return bucket;
  }, [allTimesheets]);

  useEffect(() => {
    if (!firestore || !workers || workers.length === 0) return;
    workers.forEach((w) => {
      const agg = workerHoursById.get(w.id);
      const totalWorkedHours = Number(agg?.totalHours || 0);
      const firstWorkedAt = agg?.firstWorkedAt ?? null;
      const lastWorkedAt = agg?.lastWorkedAt ?? null;
      const changed =
        Number(w.totalWorkedHours || 0) !== totalWorkedHours ||
        Number(w.firstWorkedAt ?? -1) !== Number(firstWorkedAt ?? -1) ||
        Number(w.lastWorkedAt ?? -1) !== Number(lastWorkedAt ?? -1);
      if (changed) {
        updateDocumentNonBlocking(doc(firestore, 'workers', w.id), {
          totalWorkedHours,
          firstWorkedAt,
          lastWorkedAt,
          updatedAt: Date.now(),
        });
      }
    });
  }, [firestore, workers, workerHoursById]);

  useEffect(() => {
    if (!firestore || !workers?.length || allMobilizations == null) return;
    for (const w of workers) {
      const derived = effectiveWorkerJobStatus(w, allMobilizations);
      if (derived === w.workerStatus) continue;
      const frozen: WorkerStatus[] = ['BLACKLISTED', 'INACTIVE', 'ON_LEAVE'];
      if (frozen.includes(w.workerStatus)) continue;
      const upgrades: Partial<Record<WorkerStatus, WorkerStatus[]>> = {
        AVAILABLE: ['ASSIGNED', 'ON_SITE'],
        ASSIGNED: ['ON_SITE'],
      };
      const allowed = upgrades[w.workerStatus];
      if (!allowed?.includes(derived)) continue;
      updateDocumentNonBlocking(doc(firestore, 'workers', w.id), {
        workerStatus: derived,
        updatedAt: Date.now(),
      });
    }
  }, [firestore, workers, allMobilizations]);

  const [deleteTarget, setDeleteTarget] = useState<Worker | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [isDeletingWorker, setIsDeletingWorker] = useState(false);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);
  const [positionFilter, setPositionFilter] = useState('all');
  const [jobStatusFilter, setJobStatusFilter] = useState<WorkerJobStatusFilter>('all');
  const [workerSearchQuery, setWorkerSearchQuery] = useState('');
  const [workerSort, setWorkerSort] = useState<{ key: WorkerSortKey; dir: WorkerSortDir }>({
    key: 'name',
    dir: 'asc',
  });
  const [newWorker, setNewWorker] = useState<Partial<Worker>>(getInitialNewWorker);

  const positionFilteredWorkers = useMemo(() => {
    if (positionFilter === 'all') return workers ?? [];
    return (workers ?? []).filter((w) => w.currentPositionId === positionFilter);
  }, [workers, positionFilter]);

  const jobStatusFilteredWorkers = useMemo(() => {
    if (jobStatusFilter === 'all') return positionFilteredWorkers;
    return positionFilteredWorkers.filter((w) =>
      workerMatchesJobStatusFilter(w, allMobilizations ?? [], jobStatusFilter),
    );
  }, [positionFilteredWorkers, jobStatusFilter, allMobilizations]);

  const searchFilteredWorkers = useMemo(() => {
    const q = workerSearchQuery.trim().toLowerCase();
    if (!q) return jobStatusFilteredWorkers;
    return jobStatusFilteredWorkers.filter((w) => {
      const name = `${w.firstName || ''} ${w.lastName || ''}`.toLowerCase();
      const nid = (w.thaiNationalId || '').toLowerCase();
      const code = (w.workerCode || '').toLowerCase();
      return name.includes(q) || nid.includes(q) || code.includes(q);
    });
  }, [jobStatusFilteredWorkers, workerSearchQuery]);

  const filteredWorkers = useMemo(() => {
    const list = [...searchFilteredWorkers];
    list.sort((a, b) =>
      workerSort.key === 'name'
        ? compareWorkersByName(a, b, workerSort.dir)
        : compareWorkersByHours(a, b, workerSort.dir, workerHoursById),
    );
    const mobs = allMobilizations ?? [];
    /** เอกสารไม่ครบ (NOT READY TO ASSIGN) อยู่ในรายการหลัก — เฉพาะ HR hold (TO WORK) ไปท้าย */
    const active: Worker[] = [];
    const notReadyToWork: Worker[] = [];
    for (const w of list) {
      if (displayWorkerRegistryJobStatus(w, mobs) === 'NOT_READY_TO_WORK') notReadyToWork.push(w);
      else active.push(w);
    }
    return { active, notReadyToWork, all: [...active, ...notReadyToWork] };
  }, [searchFilteredWorkers, workerSort, workerHoursById, allMobilizations]);

  /** ลำดับเดียวกับตารางทะเบียน — ใช้กับพิมพ์ทั้งหมดให้ตรงเรียงบนหน้าจอ */
  const orderWorkersForPrint = useCallback(
    (source: Worker[]) => {
      const list = [...source];
      list.sort((a, b) =>
        workerSort.key === 'name'
          ? compareWorkersByName(a, b, workerSort.dir)
          : compareWorkersByHours(a, b, workerSort.dir, workerHoursById),
      );
      const mobs = allMobilizations ?? [];
      const active: Worker[] = [];
      const notReadyToWork: Worker[] = [];
      for (const w of list) {
        if (displayWorkerRegistryJobStatus(w, mobs) === 'NOT_READY_TO_WORK') notReadyToWork.push(w);
        else active.push(w);
      }
      return [...active, ...notReadyToWork];
    },
    [workerSort, workerHoursById, allMobilizations],
  );

  const toggleNameColumnSort = () => {
    setWorkerSort((prev) =>
      prev.key === 'name' ? { key: 'name', dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key: 'name', dir: 'asc' },
    );
  };

  const toggleHoursColumnSort = () => {
    setWorkerSort((prev) =>
      prev.key === 'hours'
        ? { key: 'hours', dir: prev.dir === 'desc' ? 'asc' : 'desc' }
        : { key: 'hours', dir: 'desc' },
    );
  };

  const mapWorkerToPrintRow = useCallback(
    (worker: Worker): WorkerListPrintRow => {
      const position = positions?.find((p) => p.id === worker.currentPositionId);
      const workedHours = Number(workerHoursById.get(worker.id)?.totalHours || worker.totalWorkedHours || 0);
      const displayJobStatus = displayWorkerRegistryJobStatus(worker, allMobilizations ?? []);
      const jobBadge = workerRegistryJobStatusBadgeProps(displayJobStatus);
      const onSiteAssignment =
        displayJobStatus === 'ON_SITE'
          ? resolveWorkerOnSiteAssignment(worker.id, allMobilizations ?? [])
          : null;
      const assignedAssignment =
        displayJobStatus === 'ASSIGNED'
          ? resolveWorkerAssignedAssignment(worker.id, allMobilizations ?? [])
          : null;
      const site = (() => {
        const a = onSiteAssignment || assignedAssignment;
        return a ? formatWorkerOnSiteCompanyLocation(a, customerNameById) : '';
      })();
      const holdReason = formatWorkerNotReadyReasonDisplay(
        worker.readinessManualHoldReason,
        worker.readinessManualHoldReasonNote,
      );
      let assignmentDetail = site;
      if (displayJobStatus === 'NOT_READY_TO_WORK') {
        assignmentDetail = holdReason || 'ยังไม่ระบุเหตุผล';
      } else if (displayJobStatus === 'NOT_READY_TO_ASSIGN') {
        assignmentDetail = 'เอกสาร/เซอร์ไม่ครบ';
      }
      const readinessLabel =
        worker.readinessManualHold && worker.readinessStatus === 'READY'
          ? `NOT READY TO WORK${holdReason ? ` · ${holdReason}` : ''}`
          : readinessStatusPrintLabel(worker.readinessStatus);

      return {
        workerCode: worker.workerCode || worker.id.slice(0, 8),
        fullName: `${worker.firstName || ''} ${worker.lastName || ''}`.trim() || '—',
        nationalId: (worker.thaiNationalId || '').trim(),
        hoursLabel: `${workedHours.toLocaleString()} ชม.`,
        positionLabel: position?.positionName || position?.positionNameTh || worker.currentPositionId || 'N/A',
        readinessLabel,
        jobStatusLabel: jobBadge.label,
        assignmentDetail,
      };
    },
    [positions, workerHoursById, allMobilizations, customerNameById],
  );

  const printFilterSummary = useMemo(() => {
    const positionLabel =
      positionFilter === 'all'
        ? 'ทุกตำแหน่ง'
        : positions?.find((p) => p.id === positionFilter)?.positionName ||
          positions?.find((p) => p.id === positionFilter)?.positionNameTh ||
          positionFilter;
    const jobStatusLabel =
      WORKER_JOB_STATUS_FILTER_OPTIONS.find((o) => o.value === jobStatusFilter)?.label || jobStatusFilter;
    const sortLabel =
      workerSort.key === 'name'
        ? workerSort.dir === 'asc'
          ? 'ชื่อ A–Z'
          : 'ชื่อ Z–A'
        : workerSort.dir === 'desc'
          ? 'ชั่วโมง มาก → น้อย'
          : 'ชั่วโมง น้อย → มาก';
    return {
      searchTerm: workerSearchQuery,
      positionFilterLabel: positionLabel,
      jobStatusFilterLabel: jobStatusLabel,
      sortLabel,
    };
  }, [positionFilter, positions, jobStatusFilter, workerSort, workerSearchQuery]);

  const runWorkerListPrint = useCallback(
    async (scope: 'filtered' | 'all') => {
      // ใช้ลำดับเดียวกับหน้าจอ: ตามตัวกรอง/เรียงที่เลือก (และ NOT READY TO WORK ไว้ท้าย)
      const source =
        scope === 'filtered' ? filteredWorkers.all : orderWorkersForPrint(workers ?? []);
      if (source.length === 0) {
        toast({
          variant: 'destructive',
          title: 'ไม่มีรายการให้พิมพ์',
          description:
            scope === 'filtered'
              ? 'ไม่พบคนงานตามตัวกรอง — ล้างตัวกรองหรือพิมพ์ทั้งหมด'
              : 'ยังไม่มีลูกจ้างในระบบ',
        });
        return;
      }

      setPrintBusy(true);
      try {
        const printRows = source.map(mapWorkerToPrintRow);
        const { rows: capped, truncated } = capWorkerListPrintRows(printRows);
        const generatedAt = new Date().toLocaleString('th-TH', {
          dateStyle: 'medium',
          timeStyle: 'short',
        });
        const filterLines =
          scope === 'filtered'
            ? describeWorkerListPrintFilters(printFilterSummary)
            : describeWorkerListPrintFilters({
                searchTerm: '',
                positionFilterLabel: 'ทุกตำแหน่ง',
                jobStatusFilterLabel: 'ทุกสถานะงาน',
                sortLabel: printFilterSummary.sortLabel,
              });
        const scopeTitle =
          scope === 'filtered' ? 'พิมพ์ตามตัวกรองปัจจุบัน' : 'พิมพ์ทั้งหมด (เรียงตามที่เลือกบนหน้าจอ)';

        const body = buildWorkerListPrintHtml({
          rows: capped,
          scopeTitle,
          filterLines,
          generatedAt,
          printedBy: currentUser?.displayName,
          truncated,
        });

        const ok = await openStandardPrintWindow({
          windowTitle: 'Worker-List',
          suggestedFileName: `Workers-${scope === 'filtered' ? 'Filtered' : 'All'}`,
          bodyInnerHtml: body,
          htmlLang: 'th',
        });

        if (!ok) {
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
      filteredWorkers.all,
      orderWorkersForPrint,
      workers,
      mapWorkerToPrintRow,
      printFilterSummary,
      currentUser?.displayName,
      toast,
    ],
  );

  const handleCreate = async () => {
    if (!canCreateWorkers) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์สร้างทะเบียนลูกจ้าง' });
      return;
    }
    if (!firestore || !currentUser) return;
    
    if (!newWorker.firstName || !newWorker.lastName || !newWorker.thaiNationalId) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาระบุชื่อ นามสกุล และเลขบัตรประชาชน" });
      return;
    }

    setIsCreating(true);
    try {
      // Atomic Worker Code Generation
      const { code: finalCode } = await generateNextDocumentCode(firestore, 'worker', { 
        actor: currentUser.displayName 
      });

      const workerRef = collection(firestore, 'workers');
      const docRef = await addDocumentNonBlocking(workerRef, {
        ...newWorker,
        workerCode: finalCode,
        dateOfBirth: newWorker.dateOfBirth ? new Date(newWorker.dateOfBirth).getTime() : Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      
      setIsCreateOpen(false);
      toast({ title: "ลงทะเบียนคนงานสำเร็จ", description: `รหัสคนงาน: ${finalCode}` });
      if (docRef) router.push(`/workers/${docRef.id}`);
    } catch (error) {
      console.error(error);
      toast({ variant: "destructive", title: "เกิดข้อผิดพลาด", description: "ไม่สามารถบันทึกข้อมูลได้" });
    } finally {
      setIsCreating(false);
    }
  };

  const handleConfirmDeleteWorker = async () => {
    if (!firestore || !currentUser || !deleteTarget) return;
    setIsDeletingWorker(true);
    try {
      const check = await assertWorkerCanBeDeleted(firestore, deleteTarget, allMobilizations ?? null);
      if (!check.ok) {
        toast({ variant: 'destructive', title: 'ลบไม่ได้', description: check.message });
        setIsDeletingWorker(false);
        return;
      }
      await deleteWorkerWithAuditLog(firestore, currentUser, deleteTarget, deleteReason);
      toast({ title: 'ลบทะเบียนคนงานแล้ว', description: `รหัส ${deleteTarget.workerCode || deleteTarget.id}` });
      setDeleteTarget(null);
      setDeleteReason('');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'ลบไม่สำเร็จ';
      toast({ variant: 'destructive', title: 'ลบไม่สำเร็จ', description: msg });
    } finally {
      setIsDeletingWorker(false);
    }
  };

  const getReadinessBadge = (status: ReadinessStatus) => {
    switch (status) {
      case 'READY': return <Badge className="bg-green-600 text-white"><CheckCircle2 className="h-3 w-3 mr-1" /> READY</Badge>;
      case 'MISSING_CERTIFICATE': return <Badge variant="outline" className="border-amber-500 text-amber-700 bg-amber-50" title="ใบเซอร์บังคับตามตำแหน่งยังไม่ครบ"><ShieldAlert className="h-3 w-3 mr-1" /> เซอร์ไม่ครบ</Badge>;
      case 'MEDICAL_EXPIRED': return <Badge variant="destructive"><AlertCircle className="h-3 w-3 mr-1" /> MED EXPIRED</Badge>;
      case 'DRUG_TEST_EXPIRED': return <Badge variant="outline" className="border-orange-500 text-orange-700 bg-orange-50"><AlertCircle className="h-3 w-3 mr-1" /> DRUG EXPIRED</Badge>;
      case 'DOCUMENT_EXPIRED': return <Badge variant="outline" className="border-rose-500 text-rose-700 bg-rose-50"><FileQuestion className="h-3 w-3 mr-1" /> DOC EXPIRED</Badge>;
      case 'BLOCKED': return <Badge variant="destructive"><ShieldAlert className="h-3 w-3 mr-1" /> BLOCKED</Badge>;
      default: return <Badge variant="secondary"><FileQuestion className="h-3 w-3 mr-1" /> PENDING</Badge>;
    }
  };

  /** คอลัมป์เดียว: สถานะความพร้อม + ข้อความแผงสารเสพติดเมื่อไม่ผ่าน */
  const renderReadinessCell = (worker: Worker) => {
    const kind = worker.drugPanelSummaryKind ?? 'none_panel';
    const drugText = (worker.drugPanelSummaryText ?? '').trim();
    const mobDrugExpired = worker.drugPanelMobValid === false;
    const showDrugHint =
      mobDrugExpired ||
      kind === 'positive' ||
      (kind === 'partial' && drugText);
    return (
      <div className="flex flex-col gap-1 items-start max-w-[240px]">
        {worker.readinessManualHold && worker.readinessStatus === 'READY' ? (
          <Badge variant="outline" className="border-orange-500 text-orange-900 bg-orange-50 font-semibold">
            <AlertCircle className="h-3 w-3 mr-1" /> NOT READY TO WORK
          </Badge>
        ) : (
          getReadinessBadge(worker.readinessStatus)
        )}
        {worker.readinessManualHold
          ? (() => {
              const reason = formatWorkerNotReadyReasonDisplay(
                worker.readinessManualHoldReason,
                worker.readinessManualHoldReasonNote,
              );
              return reason ? (
                <span className="text-[10px] leading-snug font-semibold text-orange-900">{reason}</span>
              ) : (
                <span className="text-[10px] leading-snug text-orange-800/80 italic">ยังไม่ระบุเหตุผล</span>
              );
            })()
          : null}
        {showDrugHint && drugText ? (
          <span className="text-[10px] leading-snug text-destructive font-medium">
            {mobDrugExpired ? 'รอตรวจใหม่ (mob)' : drugText}
          </span>
        ) : mobDrugExpired ? (
          <span className="text-[10px] leading-snug text-orange-700 font-medium">รอตรวจใหม่ (mob)</span>
        ) : null}
        {isWorkerDispatchReady(worker) && worker.storeEquipmentReadiness === 'pending' ? (
          <Link
            href="/store/issue"
            className="text-[10px] leading-snug font-semibold text-amber-800 inline-flex items-center gap-1 hover:underline underline-offset-2"
            onClick={(e) => e.stopPropagation()}
          >
            <Package className="h-3 w-3 shrink-0" />
            คลัง: PPE/อุปกรณ์ค้าง — ไปเบิกตามงานมอบหมาย
          </Link>
        ) : null}
      </div>
    );
  };

  if (isUserLoading || userLoading || isPermLoading || !currentUser) return null;

  if (!canViewWorkers) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-4">
          <ShieldAlert className="h-12 w-12 text-destructive opacity-50" />
          <h2 className="text-xl font-bold">Access Denied (จำกัดสิทธิ์เข้าถึง)</h2>
          <p className="text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงข้อมูลพนักงานหน้างาน กรุณาติดต่อผู้ดูแลระบบ</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="flex flex-col gap-1 min-w-0">
            <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
              <HardHat className="h-8 w-8 shrink-0" /> ทะเบียนลูกจ้าง (Field Workers)
            </h1>
            <p className="text-muted-foreground text-lg">
              จัดการฐานข้อมูลลูกจ้างหน้างาน — ใช้กับ <strong>Worker Payroll</strong> และ timesheet รายวัน
            </p>
          </div>
          <PayrollScopeTag scope="worker" className="shrink-0" />
        </div>

        <Alert className="bg-blue-50 border-blue-200 text-blue-800 shadow-sm">
          <Info className="h-5 w-5 text-blue-600" />
          <AlertTitle className="font-bold text-lg">การแยกประเภทบุคลากร (Personnel Silo Policy)</AlertTitle>
          <AlertDescription className="text-sm">
            หน้าจอนี้สำหรับ <b>ลูกจ้างหน้างาน (Field Labor)</b> เท่านั้น หากต้องการจัดการพนักงานออฟฟิศส่วนกลาง (HR, IT, Finance) กรุณาไปที่เมนู <b>"พนักงานออฟฟิศ"</b>
          </AlertDescription>
        </Alert>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="ค้นหาตามชื่อหรือเลขบัตรประชาชน..."
                className="pl-9 h-11"
                value={workerSearchQuery}
                onChange={(e) => setWorkerSearchQuery(e.target.value)}
                aria-label="ค้นหาคนงาน"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" className="h-11 gap-2 shrink-0">
                  เรียงลำดับ
                  <ChevronDown className="h-4 w-4 opacity-70" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[14rem]">
                <DropdownMenuItem onClick={() => setWorkerSort({ key: 'name', dir: 'asc' })}>ชื่อ A–Z</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setWorkerSort({ key: 'name', dir: 'desc' })}>ชื่อ Z–A</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setWorkerSort({ key: 'hours', dir: 'desc' })}>
                  ชั่วโมง มาก → น้อย
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setWorkerSort({ key: 'hours', dir: 'asc' })}>
                  ชั่วโมง น้อย → มาก
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Select value={positionFilter} onValueChange={setPositionFilter}>
              <SelectTrigger className="h-11 min-w-[220px]">
                <SelectValue placeholder="กรองตามตำแหน่ง" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">ทุกตำแหน่ง</SelectItem>
                {positionsSortedForFilter.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.positionName || p.positionNameTh}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={jobStatusFilter} onValueChange={(v) => setJobStatusFilter(v as WorkerJobStatusFilter)}>
              <SelectTrigger className="h-11 min-w-[220px]">
                <SelectValue placeholder="กรองตามสถานะงาน" />
              </SelectTrigger>
              <SelectContent>
                {WORKER_JOB_STATUS_FILTER_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 gap-2 whitespace-nowrap"
              disabled={!canViewWorkers || isCollectionLoading || printBusy || (workers?.length ?? 0) === 0}
              onClick={() => setPrintDialogOpen(true)}
            >
              {printBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4 shrink-0" />}
              พิมพ์รายชื่อ
            </Button>
            {canCreateWorkers && payroll('worker', 'create') && (
              <Dialog
                open={isCreateOpen}
                onOpenChange={(open) => {
                  setIsCreateOpen(open);
                  if (open) setNewWorker(getInitialNewWorker());
                }}
              >
                <DialogTrigger asChild>
                  <Button className="gap-2 h-11 px-6 shadow-md bg-primary hover:bg-primary/90 font-bold">
                    <Plus className="h-5 w-5" /> ลงทะเบียนลูกจ้างหน้างานใหม่
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-3xl">
                  <DialogHeader>
                    <DialogTitle>ลงทะเบียนคนงานหน้างานใหม่ (Worker Registration)</DialogTitle>
                    <DialogDescription>บันทึกประวัติลูกจ้างสำหรับงานโครงการหน้างาน (Onshore/Offshore Labor)</DialogDescription>
                  </DialogHeader>
                  <div className="grid grid-cols-2 gap-4 py-4">
                    <div className="grid gap-2 col-span-2">
                      <Label>รหัสคนงาน (Worker Code)</Label>
                      <Input value={newWorker.workerCode ?? ''} disabled className="bg-muted font-mono font-bold text-primary" />
                      <p className="text-[10px] text-muted-foreground italic">* ระบบจะออกรหัสจริงให้อัตโนมัติเมื่อกดบันทึก</p>
                    </div>
                    <div className="grid gap-2">
                      <Label>ชื่อ (First Name)</Label>
                      <Input value={newWorker.firstName ?? ''} onChange={(e) => setNewWorker({ ...newWorker, firstName: e.target.value })} />
                    </div>
                    <div className="grid gap-2">
                      <Label>นามสกุล (Last Name)</Label>
                      <Input value={newWorker.lastName ?? ''} onChange={(e) => setNewWorker({ ...newWorker, lastName: e.target.value })} />
                    </div>
                    <div className="grid gap-2">
                      <Label>เลขบัตรประชาชน (National ID)</Label>
                      <Input value={newWorker.thaiNationalId ?? ''} onChange={(e) => setNewWorker({ ...newWorker, thaiNationalId: e.target.value })} />
                    </div>
                    <div className="grid gap-2">
                      <Label>ตำแหน่งหลัก (Primary Position)</Label>
                      <Select
                        value={newWorker.currentPositionId || '__none__'}
                        onValueChange={(v) =>
                          setNewWorker({ ...newWorker, currentPositionId: v === '__none__' ? '' : v })
                        }
                      >
                        <SelectTrigger><SelectValue placeholder="เลือกตำแหน่งงาน..." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— เลือกตำแหน่งงาน —</SelectItem>
                          {positionsSortedForFilter.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.positionName || p.positionNameTh}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsCreateOpen(false)} disabled={isCreating}>ยกเลิก</Button>
                    <Button onClick={handleCreate} className="bg-primary font-bold" disabled={isCreating}>
                      {isCreating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      บันทึกประวัติลูกจ้าง (Save)
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isCollectionLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลคนงาน (Loading Worker Data)...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="py-2.5 pl-6">
                      <button
                        type="button"
                        onClick={toggleNameColumnSort}
                        className={cn(
                          'inline-flex max-w-full items-start gap-1.5 rounded-md px-1 py-0.5 -ml-1 text-left text-sm font-bold',
                          'hover:bg-muted/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                        )}
                      >
                        <span className="min-w-0 leading-tight flex flex-col">
                          <span>รหัส / ชื่อคนงาน</span>
                          <span className="text-[10px] font-semibold text-muted-foreground">Field Worker</span>
                        </span>
                        {workerSort.key === 'name' ? (
                          workerSort.dir === 'asc' ? (
                            <ArrowUp className="h-4 w-4 shrink-0 text-primary mt-0.5" aria-hidden />
                          ) : (
                            <ArrowDown className="h-4 w-4 shrink-0 text-primary mt-0.5" aria-hidden />
                          )
                        ) : (
                          <ArrowUpDown className="h-4 w-4 shrink-0 text-muted-foreground opacity-60 mt-0.5" aria-hidden />
                        )}
                      </button>
                    </TableHead>
                    <TableHead className="py-2.5 text-center">
                      <button
                        type="button"
                        onClick={toggleHoursColumnSort}
                        className={cn(
                          'inline-flex items-start justify-center gap-1.5 rounded-md px-1 py-0.5 text-sm font-bold mx-auto',
                          'hover:bg-muted/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                        )}
                      >
                        <span className="leading-tight flex flex-col items-center">
                          <span>ชั่วโมงสะสม</span>
                          <span className="text-[10px] font-semibold text-muted-foreground">Total Hours</span>
                        </span>
                        {workerSort.key === 'hours' ? (
                          workerSort.dir === 'desc' ? (
                            <ArrowDown className="h-4 w-4 shrink-0 text-primary mt-0.5" aria-hidden />
                          ) : (
                            <ArrowUp className="h-4 w-4 shrink-0 text-primary mt-0.5" aria-hidden />
                          )
                        ) : (
                          <ArrowUpDown className="h-4 w-4 shrink-0 text-muted-foreground opacity-60 mt-0.5" aria-hidden />
                        )}
                      </button>
                    </TableHead>
                    <TableHead className="py-2.5 text-center font-bold">
                      <span className="leading-tight flex flex-col items-center">
                        <span>ตำแหน่งหลัก</span>
                        <span className="text-[10px] font-semibold text-muted-foreground">Position</span>
                      </span>
                    </TableHead>
                    <TableHead className="py-2.5 font-bold min-w-[200px]">
                      <span className="leading-tight flex flex-col">
                        <span>ความพร้อม</span>
                        <span className="text-[10px] font-semibold text-muted-foreground">Readiness</span>
                      </span>
                    </TableHead>
                    <TableHead className="py-2.5 font-bold">
                      <span className="leading-tight flex flex-col">
                        <span>สถานะงาน</span>
                        <span className="text-[10px] font-semibold text-muted-foreground">Job Status</span>
                      </span>
                    </TableHead>
                    <TableHead className="py-2.5 text-right font-bold pr-6">
                      <span className="leading-tight inline-flex flex-col items-end">
                        <span>การจัดการ</span>
                        <span className="text-[10px] font-semibold text-muted-foreground">Actions</span>
                      </span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(() => {
                    const renderWorkerRow = (worker: Worker) => {
                      const position = positions?.find((p) => p.id === worker.currentPositionId);
                      const workedHours = Number(workerHoursById.get(worker.id)?.totalHours || worker.totalWorkedHours || 0);
                      const displayJobStatus = displayWorkerRegistryJobStatus(worker, allMobilizations ?? []);
                      const jobBadge = workerRegistryJobStatusBadgeProps(displayJobStatus);
                      const onSiteAssignment =
                        displayJobStatus === 'ON_SITE'
                          ? resolveWorkerOnSiteAssignment(worker.id, allMobilizations ?? [])
                          : null;
                      const assignedAssignment =
                        displayJobStatus === 'ASSIGNED'
                          ? resolveWorkerAssignedAssignment(worker.id, allMobilizations ?? [])
                          : null;
                      const jobSiteLabel = (() => {
                        const a = onSiteAssignment || assignedAssignment;
                        return a ? formatWorkerOnSiteCompanyLocation(a, customerNameById) : '';
                      })();
                      const notReadyToWorkReason =
                        displayJobStatus === 'NOT_READY_TO_WORK'
                          ? formatWorkerNotReadyReasonDisplay(
                              worker.readinessManualHoldReason,
                              worker.readinessManualHoldReasonNote,
                            )
                          : '';
                      return (
                        <TableRow
                          key={worker.id}
                          className="cursor-pointer hover:bg-muted/30 group transition-colors"
                          onClick={() => router.push(`/workers/${worker.id}`)}
                        >
                          <TableCell className="py-2.5 pl-6">
                            <div className="flex flex-col gap-0.5">
                              <span className="text-[10px] font-mono font-bold text-primary bg-primary/5 w-fit px-1.5 rounded border border-primary/10">
                                {worker.workerCode || 'NO CODE'}
                              </span>
                              <span className="font-bold text-sm text-primary leading-snug">
                                {worker.firstName} {worker.lastName}
                              </span>
                              <span className="text-[10px] text-muted-foreground font-mono leading-none">{worker.thaiNationalId}</span>
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5 text-center">
                            <div className="font-black text-primary">{workedHours.toLocaleString()} ชม.</div>
                          </TableCell>
                          <TableCell className="py-2.5 text-center">
                            <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20">
                              {position?.positionName || position?.positionNameTh || worker.currentPositionId || 'N/A'}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-2.5" onClick={(e) => e.stopPropagation()}>{renderReadinessCell(worker)}</TableCell>
                          <TableCell className="py-2.5">
                            <div className="flex flex-col gap-0.5 min-w-0 max-w-[16rem]">
                              <Badge variant={jobBadge.variant} className={cn(jobBadge.className, 'w-fit')}>
                                {jobBadge.label}
                              </Badge>
                              {jobSiteLabel ? (
                                <span
                                  className="text-[11px] leading-snug text-muted-foreground line-clamp-2"
                                  title={jobSiteLabel}
                                >
                                  {jobSiteLabel}
                                </span>
                              ) : null}
                              {displayJobStatus === 'NOT_READY_TO_WORK' ? (
                                notReadyToWorkReason ? (
                                  <span className="text-[11px] leading-snug font-semibold text-orange-800">
                                    {notReadyToWorkReason}
                                  </span>
                                ) : (
                                  <span className="text-[11px] leading-snug text-orange-700/80 italic">ยังไม่ระบุเหตุผล</span>
                                )
                              ) : displayJobStatus === 'NOT_READY_TO_ASSIGN' ? (
                                <span className="text-[11px] leading-snug text-amber-800/90">เอกสาร/เซอร์ไม่ครบ</span>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5 text-right pr-6">
                            <div className="flex items-center justify-end gap-1">
                              {canDeleteWorkerRecord && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                  title="ลบทะเบียนคนงาน (เฉพาะผู้จัดการ/แอดมิน)"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDeleteReason('');
                                    setDeleteTarget(worker);
                                  }}
                                >
                                  <Trash2 className="h-5 w-5" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="group-hover:text-primary transition-colors"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  router.push(`/workers/${worker.id}`);
                                }}
                              >
                                <ChevronRight className="h-5 w-5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    };

                    const rows: ReactNode[] = [];
                    if (filteredWorkers.active.length > 0) {
                      rows.push(...filteredWorkers.active.map(renderWorkerRow));
                    }
                    if (filteredWorkers.notReadyToWork.length > 0) {
                      if (filteredWorkers.active.length > 0) {
                        rows.push(
                          <TableRow key="__not-ready-to-work-section__" className="bg-orange-50/80 hover:bg-orange-50/80">
                            <TableCell colSpan={6} className="py-2.5 pl-6 text-xs font-bold uppercase tracking-wide text-orange-900">
                              ไม่พร้อมทำงาน (Not Ready to Work) — {filteredWorkers.notReadyToWork.length} คน
                            </TableCell>
                          </TableRow>,
                        );
                      }
                      rows.push(...filteredWorkers.notReadyToWork.map(renderWorkerRow));
                    }
                    return rows;
                  })()}
                  {filteredWorkers.all.length === 0 && !isCollectionLoading && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-20 text-muted-foreground italic">
                        {(workers?.length ?? 0) === 0
                          ? 'ยังไม่มีข้อมูลคนงานในระบบ'
                          : workerSearchQuery.trim()
                            ? 'ไม่พบข้อมูลตามคำค้นหา — ลองคำอื่นหรือล้างช่องค้นหา'
                            : positionFilter !== 'all' || jobStatusFilter !== 'all'
                              ? 'ไม่พบข้อมูลคนงานตามตัวกรองที่เลือก'
                              : 'ไม่พบข้อมูลคนงาน'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Dialog open={printDialogOpen} onOpenChange={setPrintDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>พิมพ์รายชื่อลูกจ้าง</DialogTitle>
              <DialogDescription>
                เลือกพิมพ์ตามตัวกรองปัจจุบัน หรือพิมพ์ทุกรายการในชุดข้อมูลล่าสุด (สูงสุด 500 รายการ)
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                ตามตัวกรองตอนนี้: <strong className="text-foreground">{filteredWorkers.all.length}</strong> คน
              </p>
              <p>
                ทั้งหมดในระบบ: <strong className="text-foreground">{workers?.length ?? 0}</strong> คน
              </p>
            </div>
            <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
              <Button
                type="button"
                className="w-full gap-2"
                disabled={printBusy || filteredWorkers.all.length === 0}
                onClick={() => void runWorkerListPrint('filtered')}
              >
                {printBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                พิมพ์ตามตัวกรอง ({filteredWorkers.all.length})
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                disabled={printBusy || (workers?.length ?? 0) === 0}
                onClick={() => void runWorkerListPrint('all')}
              >
                พิมพ์ทั้งหมด ({workers?.length ?? 0})
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={deleteTarget != null} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeleteReason(''); } }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ลบทะเบียนคนงาน</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3 text-left">
                  <p>
                    ลบได้เฉพาะเมื่อสถานะงานเป็น <strong>AVAILABLE</strong> และไม่มีการมอบหมายงานที่ยังไม่ปิด
                    (สถานะการส่งตัวต้องเป็น CLOSED หรือ DEMOBILIZED เท่านั้น)
                  </p>
                  {deleteTarget && (
                    <p className="font-mono text-sm">
                      {deleteTarget.workerCode} — {deleteTarget.firstName} {deleteTarget.lastName}
                    </p>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="delete-reason">เหตุผลการลบ (บันทึกใน audit log)</Label>
                    <Textarea
                      id="delete-reason"
                      value={deleteReason}
                      onChange={(e) => setDeleteReason(e.target.value)}
                      placeholder="ระบุเหตุผลเพื่อตรวจสอบย้อนหลัง..."
                      className="min-h-[100px]"
                    />
                  </div>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeletingWorker}>ยกเลิก</AlertDialogCancel>
              <Button
                type="button"
                variant="destructive"
                disabled={isDeletingWorker || !deleteReason.trim()}
                onClick={() => void handleConfirmDeleteWorker()}
              >
                {isDeletingWorker ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                ยืนยันลบ
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppShell>
  );
}