'use client';

import { useState, use, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  ArrowLeft, 
  User, 
  Briefcase, 
  Calendar, 
  AlertCircle, 
  Clock, 
  CheckCircle2, 
  Truck, 
  XCircle,
  ClipboardCheck,
  Info,
  Waves,
  HardHat,
  Package,
  History,
  CheckCircle,
  Loader2,
  FileText,
  ChevronRight,
  MapPin,
  AlertTriangle,
  Building2,
  UserX,
  Pencil,
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection, getDoc, updateDoc, deleteField } from 'firebase/firestore';
import { updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import {
  formatDateThaiBE,
  formatDateTimeThaiBE,
  htmlDateValueToTimestampMs,
  timestampToHtmlDateValue,
} from '@/lib/date-thai';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import {
  Assignment,
  Worker,
  Customer,
  Position,
  User as AppUser,
  ChecklistItemStatus,
  Wave,
  WorkerCertificate,
  WorkerDrugTest,
  DeploymentStatus,
  PurchaseOrder,
  MainContract,
  POLine,
} from '@/lib/types';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccess, canEdit, canView, isMatrixControlledRole } from '@/lib/permissions';
import { syncPoActiveAutoDailyForAssignment } from '@/lib/timesheet/po-active-auto-daily-sync';
import {
  applyMobFinalClearanceWorkStartFill,
  deleteDraftMobFinalClearanceTimesheetsInRange,
  upsertMobClearanceDailyTimesheet,
} from '@/lib/timesheet/mobilization-clearance-timesheet';
import {
  addDaysToYmd,
  canRevertFinalClearanceStep1,
  canRunFinalClearanceStep,
  canSaveFinalClearanceStandby,
  canSaveFinalClearanceWorkStart,
  isFinalClearanceStep1Done,
  isFinalClearanceStep2Done,
  isFinalClearanceStep3Done,
  isMobUnassigned,
  thailandTodayYmd,
} from '@/lib/ops/mobilization-final-clearance';
import { isPoTimesheetScopeId } from '@/lib/constants/timesheet-po-scope';
import { normalizePoActiveBundleId, resolvePoActiveBundleKeyForPo } from '@/lib/ops/po-active-bundle';
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { computeMobDrugTestChecklistStatus, resolveMobReferenceDateYmd } from '@/lib/drug-test-panel';

export default function MobilizationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const useMatrixGuards = isMatrixControlledRole(currentUser);
  const canViewMobilization = useMatrixGuards ? canAccess(currentUser, 'mobilization', 'view') : canView(currentUser, 'mobilization');
  const canEditMobilization = useMatrixGuards ? canAccess(currentUser, 'mobilization', 'edit') : canEdit(currentUser, 'mobilization');
  const canEditTimesheets = useMatrixGuards ? canAccess(currentUser, 'timesheets', 'edit') : canEdit(currentUser, 'timesheets');

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [standbyDateDraft, setStandbyDateDraft] = useState('');
  const [workingStartDateDraft, setWorkingStartDateDraft] = useState('');
  const [unassignDialogOpen, setUnassignDialogOpen] = useState(false);
  const [autoDailySyncing, setAutoDailySyncing] = useState(false);
  const [clearanceSavingStep, setClearanceSavingStep] = useState<0 | 2 | 3>(0);
  /** แก้ไขวันที่หลังบันทึกแล้ว — 2 = Standby, 3 = เริ่มงาน */
  const [clearanceEditMode, setClearanceEditMode] = useState<0 | 2 | 3>(0);
  const [step2CascadeOpen, setStep2CascadeOpen] = useState(false);
  const [step1RevertOpen, setStep1RevertOpen] = useState(false);
  const [locationLineIdDraft, setLocationLineIdDraft] = useState<string>('');
  const [locationCustomDraft, setLocationCustomDraft] = useState('');
  const [locationSaving, setLocationSaving] = useState(false);

  // Standardized fetch from 'mobilizations' top-level collection
  useEffect(() => {
    async function fetchMobilization() {
      if (!firestore || !canViewMobilization) return;
      try {
        const mobRef = doc(firestore, 'mobilizations', id);
        const snap = await getDoc(mobRef);
        if (snap.exists()) {
          setAssignment({ id: snap.id, ...(snap.data() as object) } as Assignment);
        }
      } catch (err) {
        console.error('Failed to fetch mobilization data', err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchMobilization();
  }, [firestore, id, canViewMobilization]);

  const workerRef = useMemoFirebase(() => (firestore && assignment ? doc(firestore, 'workers', assignment.workerId) : null), [firestore, assignment?.workerId]);
  const { data: worker } = useDoc<Worker>(workerRef as any);

  const workerCertsQuery = useMemoFirebase(() => (firestore && assignment ? collection(firestore, 'workers', assignment.workerId, 'certificates') : null), [firestore, assignment?.workerId]);
  const { data: workerCerts } = useCollection<WorkerCertificate>(workerCertsQuery as any);

  const workerDrugTestsQuery = useMemoFirebase(
    () => (firestore && assignment ? collection(firestore, 'workers', assignment.workerId, 'drug_tests') : null),
    [firestore, assignment?.workerId],
  );
  const { data: workerDrugTests } = useCollection<WorkerDrugTest>(workerDrugTestsQuery as any);

  const drugTestChecklistStatus = useMemo((): ChecklistItemStatus => {
    if (!assignment) return 'missing';
    const mobYmd = resolveMobReferenceDateYmd(assignment);
    return computeMobDrugTestChecklistStatus(workerDrugTests || [], mobYmd);
  }, [assignment, workerDrugTests]);

  const posRef = useMemoFirebase(() => (firestore && assignment ? doc(firestore, 'positions', assignment.positionId) : null), [firestore, assignment?.positionId]);
  const { data: position } = useDoc<Position>(posRef as any);

  const waveRef = useMemoFirebase(() => (firestore && assignment?.waveId ? doc(firestore, 'waves', assignment.waveId) : null), [firestore, assignment?.waveId]);
  const { data: wave } = useDoc<Wave>(waveRef as any);

  const customerRef = useMemoFirebase(() => (firestore && assignment ? doc(firestore, 'customers', assignment.customerId) : null), [firestore, assignment?.customerId]);
  const { data: customer } = useDoc<Customer>(customerRef as any);

  const poRef = useMemoFirebase(() => (firestore && assignment?.poId ? doc(firestore, 'purchase_orders', assignment.poId) : null), [firestore, assignment?.poId]);
  const { data: po } = useDoc<PurchaseOrder>(poRef as any);

  const poLinesQuery = useMemoFirebase(
    () =>
      firestore && assignment?.poId
        ? collection(firestore, 'purchase_orders', assignment.poId, 'po_lines')
        : null,
    [firestore, assignment?.poId],
  );
  const { data: poLines } = useCollection<POLine>(poLinesQuery as any);

  const primaryPoLine = useMemo(() => {
    const lid = (assignment?.poLineId || '').trim();
    if (!lid || !poLines?.length) return undefined;
    return poLines.find((l) => l.id === lid);
  }, [assignment?.poLineId, poLines]);

  const contractRef = useMemoFirebase(() => (firestore && assignment?.contractId ? doc(firestore, 'main_contracts', assignment.contractId) : null), [firestore, assignment?.contractId]);
  const { data: contract } = useDoc<MainContract>(contractRef as any);

  useEffect(() => {
    if (!assignment) return;
    const standby = (assignment.mobStandbyDate || '').trim();
    setStandbyDateDraft(standby || thailandTodayYmd());
    const work = (assignment.mobWorkingStartDate || '').trim();
    const baseStandby = standby || thailandTodayYmd();
    setWorkingStartDateDraft(work || addDaysToYmd(baseStandby, 1));
  }, [assignment?.id, assignment?.mobStandbyDate, assignment?.mobWorkingStartDate]);

  useEffect(() => {
    if (!assignment) return;
    const key = (assignment.mobLocationKey || '').trim();
    if (key.startsWith('poLine:')) {
      setLocationLineIdDraft(key.slice('poLine:'.length));
      setLocationCustomDraft('');
      return;
    }
    if (key.startsWith('custom:')) {
      setLocationLineIdDraft('');
      setLocationCustomDraft(key.slice('custom:'.length));
      return;
    }
    setLocationLineIdDraft(assignment.poLineId || '');
    setLocationCustomDraft('');
  }, [assignment?.id, assignment?.mobLocationKey, assignment?.poLineId]);

  const patchMobilization = (patch: Record<string, unknown>) => {
    if (!firestore || !canEditMobilization) return;
    const mobRef = doc(firestore, 'mobilizations', id);
    const next = { ...patch, updatedAt: Date.now() };
    updateDocumentNonBlocking(mobRef, next);
    setAssignment((prev) => (prev ? ({ ...prev, ...next } as Assignment) : null));
  };

  const runFinalClearanceStep1 = () => {
    if (!assignment || !currentUser?.id) return;
    const gate = canRunFinalClearanceStep(assignment, 1, { readinessOk: assignment.readinessStatus === 'ready' });
    if (!gate.ok) {
      toast({ variant: 'destructive', title: 'ยังทำขั้นนี้ไม่ได้', description: gate.message });
      return;
    }
    const now = Date.now();
    patchMobilization({
      mobReadyToTravelAt: now,
      mobReadyToTravelByUserId: currentUser.id,
      mobilizationStatus: 'READY_TO_MOBILIZE',
      deploymentStatus: 'READY_TO_MOB',
    });
    toast({ title: 'ยืนยันขั้นที่ 1 แล้ว', description: 'พร้อมเดินทาง — ถัดไปบันทึกวัน Standby' });
  };

  const workerTimesheetName =
    worker?.firstName || worker?.lastName
      ? `${worker?.firstName || ''} ${worker?.lastName || ''}`.trim()
      : (assignment?.workerName || '').trim();

  const step2SaveGate = useMemo(() => {
    if (!assignment) return { ok: false as const, message: '' };
    if (clearanceEditMode === 2) return canSaveFinalClearanceStandby(assignment, { editingExisting: true });
    return canRunFinalClearanceStep(assignment, 2);
  }, [assignment, clearanceEditMode]);

  const step3SaveGate = useMemo(() => {
    if (!assignment) return { ok: false as const, message: '' };
    if (clearanceEditMode === 3) return canSaveFinalClearanceWorkStart(assignment, { editingExisting: true });
    return canRunFinalClearanceStep(assignment, 3);
  }, [assignment, clearanceEditMode]);

  const cancelClearanceEdit = () => setClearanceEditMode(0);

  const beginEditStandby = () => {
    if (!assignment) return;
    if (isFinalClearanceStep3Done(assignment)) {
      setStep2CascadeOpen(true);
      return;
    }
    setClearanceEditMode(2);
    setStandbyDateDraft((assignment.mobStandbyDate || '').trim() || thailandTodayYmd());
  };

  const confirmStep2CascadeAndEdit = async () => {
    if (!firestore || !assignment) return;
    try {
      const standby = (assignment.mobStandbyDate || '').trim();
      const oldWork = (assignment.mobWorkingStartDate || '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(standby) && /^\d{4}-\d{2}-\d{2}$/.test(oldWork)) {
        const after = addDaysToYmd(standby, 1);
        if (after <= oldWork) {
          await deleteDraftMobFinalClearanceTimesheetsInRange(
            firestore,
            assignment.workerId,
            assignment.id,
            after,
            oldWork,
          );
        }
      }
      const mobRef = doc(firestore, 'mobilizations', id);
      await updateDoc(mobRef, {
        mobWorkingStartDate: deleteField(),
        mobWorkingStartedAt: deleteField(),
        mobWorkingStartedByUserId: deleteField(),
        deploymentStatus: 'MOBILIZING',
        mobilizationStatus: 'MOBILIZING',
        mobLocationPhase: 'location_selected',
        updatedAt: Date.now(),
      });
      const snap = await getDoc(mobRef);
      if (snap.exists()) {
        setAssignment({ id: snap.id, ...(snap.data() as object) } as Assignment);
      }
      setClearanceEditMode(2);
      setStandbyDateDraft((assignment.mobStandbyDate || '').trim() || thailandTodayYmd());
      setStep2CascadeOpen(false);
      toast({
        title: 'ย้อนขั้นเริ่มงานแล้ว',
        description: 'แก้วัน Standby ได้ — บันทึกขั้นที่ 3 ใหม่หลังแก้เสร็จ',
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: 'destructive', title: 'ย้อนขั้นไม่สำเร็จ', description: msg });
    }
  };

  const beginEditWorkStart = () => {
    if (!assignment) return;
    setClearanceEditMode(3);
    const st = (assignment.mobStandbyDate || '').trim();
    const cur = (assignment.mobWorkingStartDate || '').trim();
    setWorkingStartDateDraft(
      /^\d{4}-\d{2}-\d{2}$/.test(cur) ? cur : /^\d{4}-\d{2}-\d{2}$/.test(st) ? addDaysToYmd(st, 1) : thailandTodayYmd(),
    );
  };

  const runRevertFinalClearanceStep1 = async () => {
    if (!firestore || !assignment || !canEditMobilization) return;
    const gate = canRevertFinalClearanceStep1(assignment);
    if (!gate.ok) {
      toast({ variant: 'destructive', title: 'แก้ขั้นที่ 1 ไม่ได้', description: gate.message });
      setStep1RevertOpen(false);
      return;
    }
    try {
      const mobRef = doc(firestore, 'mobilizations', id);
      await updateDoc(mobRef, {
        mobReadyToTravelAt: deleteField(),
        mobReadyToTravelByUserId: deleteField(),
        deploymentStatus: 'CONFIRMED',
        mobilizationStatus: 'PENDING',
        updatedAt: Date.now(),
      });
      const snap = await getDoc(mobRef);
      if (snap.exists()) {
        setAssignment({ id: snap.id, ...(snap.data() as object) } as Assignment);
      }
      setStep1RevertOpen(false);
      toast({ title: 'ย้อนขั้นที่ 1 แล้ว', description: 'กด «คอนเฟิร์มพร้อมเดินทาง» ใหม่เมื่อพร้อม' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: 'destructive', title: 'ย้อนขั้นไม่สำเร็จ', description: msg });
    }
  };

  const runFinalClearanceStep2 = async () => {
    if (!firestore || !assignment || !currentUser?.id || !po) return;
    const ymd = (standbyDateDraft || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      toast({ variant: 'destructive', title: 'วันที่ไม่ถูกต้อง', description: 'เลือกวัน Standby (รูปแบบ yyyy-mm-dd)' });
      return;
    }
    const editing = clearanceEditMode === 2;
    const gate = canSaveFinalClearanceStandby(assignment, { editingExisting: editing });
    if (!gate.ok) {
      toast({ variant: 'destructive', title: 'ยังทำขั้นนี้ไม่ได้', description: gate.message });
      return;
    }
    let line = primaryPoLine;
    if (!line && assignment.poId && assignment.poLineId) {
      const snap = await getDoc(doc(firestore, 'purchase_orders', assignment.poId, 'po_lines', assignment.poLineId));
      if (snap.exists()) line = { id: snap.id, ...(snap.data() as object) } as POLine;
    }
    if (!line?.id) {
      toast({
        variant: 'destructive',
        title: 'ไม่พบบรรทัด PO',
        description: 'ต้องมี poLineId และข้อมูลบรรทัด PO เพื่อบันทึก timesheet',
      });
      return;
    }
    if (!canEditTimesheets) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'ต้องมีสิทธิ์แก้ไข Timesheets เพื่อบันทึก Standby ลงตารางรายวัน' });
      return;
    }
    setClearanceSavingStep(2);
    try {
      const prevStandby = (assignment.mobStandbyDate || '').trim();
      if (editing && prevStandby && prevStandby !== ymd && /^\d{4}-\d{2}-\d{2}$/.test(prevStandby)) {
        await deleteDraftMobFinalClearanceTimesheetsInRange(firestore, assignment.workerId, assignment.id, prevStandby, prevStandby);
      }
      await upsertMobClearanceDailyTimesheet(firestore, currentUser as AppUser, {
        assignment,
        po,
        line,
        workerDisplayName: workerTimesheetName || assignment.workerId,
        kind: 'standby_day',
        dateYmd: ymd,
        bypassPoMonthLock: true,
      });
      const now = Date.now();
      patchMobilization({
        mobStandbyDate: ymd,
        mobStandbyRecordedAt: now,
        mobStandbyRecordedByUserId: currentUser.id,
        mobilizationStatus: 'MOBILIZING',
        deploymentStatus: 'MOBILIZING',
      });
      setWorkingStartDateDraft((cur) => cur || addDaysToYmd(ymd, 1));
      setClearanceEditMode(0);
      toast({
        title: editing ? 'แก้ไขวัน Standby แล้ว' : 'บันทึก Standby แล้ว',
        description: `วันที่ ${ymd} — ลง timesheet เป็น standby แล้ว · ถัดไปเริ่มวันทำงาน`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ variant: 'destructive', title: 'บันทึก Standby ไม่สำเร็จ', description: msg });
    } finally {
      setClearanceSavingStep(0);
    }
  };

  const runFinalClearanceStep3 = async () => {
    if (!firestore || !assignment || !currentUser?.id || !po) return;
    const standbyYmd = (assignment.mobStandbyDate || '').trim();
    const workYmd = (workingStartDateDraft || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workYmd)) {
      toast({ variant: 'destructive', title: 'วันที่ไม่ถูกต้อง', description: 'เลือกวันเริ่มทำงาน' });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(standbyYmd)) {
      toast({ variant: 'destructive', title: 'ยังไม่มีวัน Standby', description: 'บันทึกขั้นที่ 2 ก่อน' });
      return;
    }
    if (workYmd <= standbyYmd) {
      toast({
        variant: 'destructive',
        title: 'วันเริ่มงานไม่ถูกต้อง',
        description: 'ต้องเลือกวันที่หลังวัน Standby — ช่วงว่างจะถูกบันทึกเป็น Standby อัตโนมัติ',
      });
      return;
    }
    const editing = clearanceEditMode === 3;
    const gate = canSaveFinalClearanceWorkStart(assignment, { editingExisting: editing });
    if (!gate.ok) {
      toast({ variant: 'destructive', title: 'ยังทำขั้นนี้ไม่ได้', description: gate.message });
      return;
    }
    let line = primaryPoLine;
    if (!line && assignment.poId && assignment.poLineId) {
      const snap = await getDoc(doc(firestore, 'purchase_orders', assignment.poId, 'po_lines', assignment.poLineId));
      if (snap.exists()) line = { id: snap.id, ...(snap.data() as object) } as POLine;
    }
    if (!line?.id) {
      toast({
        variant: 'destructive',
        title: 'ไม่พบบรรทัด PO',
        description: 'ต้องมี poLineId และข้อมูลบรรทัด PO เพื่อบันทึก timesheet',
      });
      return;
    }
    if (!canEditTimesheets) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'ต้องมีสิทธิ์แก้ไข Timesheets เพื่อบันทึกวันทำงานลงตารางรายวัน' });
      return;
    }
    setClearanceSavingStep(3);
    try {
      if (editing) {
        const oldW = (assignment.mobWorkingStartDate || '').trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(oldW)) {
          const monthStart = `${standbyYmd.slice(0, 7)}-01`;
          const beforeStandby = addDaysToYmd(standbyYmd, -1);
          if (monthStart <= beforeStandby) {
            await deleteDraftMobFinalClearanceTimesheetsInRange(
              firestore,
              assignment.workerId,
              assignment.id,
              monthStart,
              beforeStandby,
            );
          }
          const afterStandby = addDaysToYmd(standbyYmd, 1);
          if (afterStandby <= oldW) {
            await deleteDraftMobFinalClearanceTimesheetsInRange(
              firestore,
              assignment.workerId,
              assignment.id,
              afterStandby,
              oldW,
            );
          }
        }
      }

      await applyMobFinalClearanceWorkStartFill(firestore, currentUser as AppUser, {
        assignment,
        po,
        line,
        workerDisplayName: workerTimesheetName || assignment.workerId,
        standbyYmd,
        workYmd,
      });

      const now = Date.now();
      patchMobilization({
        mobWorkingStartDate: workYmd,
        mobWorkingStartedAt: now,
        mobWorkingStartedByUserId: currentUser.id,
        mobilizationStatus: 'ACTIVE',
        deploymentStatus: 'ACTIVE',
        mobLocationPhase: 'active_at_location',
        poActiveAutoWorkSuspended: deleteField(),
        poActiveStandbyAutoStartYmd: deleteField(),
        poActiveStandbyAutoEndYmd: deleteField(),
      });
      setClearanceEditMode(0);
      toast({
        title: editing ? 'แก้ไขวันเริ่มงานแล้ว' : 'เริ่มวันทำงานแล้ว',
        description: `ACTIVE ตั้งแต่ ${workYmd} — เติมช่วง Standby / ต่อเนื่องต้นเดือน (ถ้ามี) แล้ว · ระบบจะเติมรายวันถัดไปให้อัตโนมัติ`,
      });
      void (async () => {
        try {
          const r = await syncPoActiveAutoDailyForAssignment(firestore, assignment.id, currentUser as AppUser, {
            ignoreBundleAutoDisabled: true,
          });
          if (r.created + r.updated > 0) {
            toast({
              title: 'เติมรายวันอัตโนมัติแล้ว',
              description: `สร้าง ${r.created} · อัปเดต ${r.updated} · ข้าม ${r.skipped}`,
            });
          }
        } catch (e) {
          console.warn('[mob] auto daily after step3', e);
        }
      })();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ variant: 'destructive', title: 'เริ่มวันทำงานไม่สำเร็จ', description: msg });
    } finally {
      setClearanceSavingStep(0);
    }
  };

  const saveMobLocation = async () => {
    if (!firestore || !assignment || !currentUser?.id || !canEditMobilization) return;
    if (assignment.mobWorkflowVersion !== 'po_active_v2') {
      toast({
        variant: 'destructive',
        title: 'ไม่จำเป็นต้องบันทึกแยก',
        description: 'การเลือกไซต์แบบบังคับใช้กับ mobilization รุ่น PO Active (po_active_v2) เท่านั้น',
      });
      return;
    }
    const custom = locationCustomDraft.trim();
    if (custom) {
      setLocationSaving(true);
      try {
        patchMobilization({
          mobLocationKey: `custom:${custom.slice(0, 200)}`,
          workLocation: custom.slice(0, 500),
          workLocationUpdatedAt: Date.now(),
          workLocationUpdatedByUserId: currentUser.id,
          mobLocationPhase: 'location_selected',
        });
        toast({ title: 'บันทึกสถานที่แล้ว', description: custom });
      } finally {
        setLocationSaving(false);
      }
      return;
    }
    const lid = (locationLineIdDraft || '').trim();
    if (!lid) {
      toast({ variant: 'destructive', title: 'เลือกบรรทัด PO หรือระบุข้อความสถานที่', description: 'ต้องมีอย่างใดอย่างหนึ่ง' });
      return;
    }
    const line = poLines?.find((l) => l.id === lid);
    const label = (line?.workLocation || '').trim() || lid;
    setLocationSaving(true);
    try {
      patchMobilization({
        mobLocationKey: `poLine:${lid}`,
        workLocation: label.slice(0, 500),
        workLocationUpdatedAt: Date.now(),
        workLocationUpdatedByUserId: currentUser.id,
        mobLocationPhase: 'location_selected',
      });
      toast({ title: 'บันทึกสถานที่แล้ว', description: label });
    } finally {
      setLocationSaving(false);
    }
  };

  const runUnassign = () => {
    if (!canEditMobilization) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'ไม่สามารถ Unassign ได้' });
      return;
    }
    if (!assignment || !currentUser?.id) return;
    if (isMobUnassigned(assignment)) {
      toast({ variant: 'destructive', title: 'Unassign แล้ว', description: 'รายการนี้คืนสถานะไปแล้ว' });
      return;
    }
    const now = Date.now();
    patchMobilization({
      unassignedAt: now,
      unassignedByUserId: currentUser.id,
      mobilizationStatus: 'DEMOBILIZED',
      deploymentStatus: 'CLOSED',
    });
    if (firestore && assignment.workerId) {
      void updateDoc(doc(firestore, 'workers', assignment.workerId), {
        workerStatus: 'AVAILABLE',
        updatedAt: now,
      }).catch((e) => console.error('[mob] worker status after unassign', e));
    }
    setUnassignDialogOpen(false);
    toast({
      title: 'Unassign สำเร็จ',
      description: 'คนงานว่างสำหรับ PO ชุดอื่น — ประวัติ timesheet เดิมไม่ถูกลบ',
    });
  };

  const runPoActiveAutoDailySync = async () => {
    if (!firestore || !currentUser || !assignment) return;
    if (!canEditTimesheets) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'ต้องมีสิทธิ์แก้ไข Timesheets' });
      return;
    }
    setAutoDailySyncing(true);
    try {
      const r = await syncPoActiveAutoDailyForAssignment(firestore, assignment.id, currentUser as AppUser, {
        ignoreBundleAutoDisabled: true,
      });
      toast({
        title: 'ซิงค์รายวัน PO Active แล้ว',
        description: `สร้าง ${r.created} · อัปเดต ${r.updated} · ข้าม ${r.skipped} (แถวที่ปิดบัญชีแล้วหรือแก้มือ)`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ variant: 'destructive', title: 'ซิงค์ไม่สำเร็จ', description: msg });
    } finally {
      setAutoDailySyncing(false);
    }
  };

  const step1Gate = useMemo(
    () => (assignment ? canRunFinalClearanceStep(assignment, 1, { readinessOk: assignment.readinessStatus === 'ready' }) : { ok: false as const, message: '' }),
    [assignment],
  );
  if (userLoading || !currentUser) return null;
  if (!canViewMobilization) {
    return (
      <AppShell user={currentUser as AppUser} onLogout={() => {}}>
        <div className="max-w-5xl mx-auto py-10 text-center text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงเมนูนี้</div>
      </AppShell>
    );
  }
  if (isLoading) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-12 w-12 text-primary animate-spin" /></div>;
  }

  if (!assignment) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="text-center py-20 space-y-4">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
          <h2 className="text-xl font-bold">ไม่พบข้อมูลการเตรียมความพร้อม</h2>
          <Button variant="outline" onClick={() => router.push('/mobilization')}>กลับไปหน้ารายการ</Button>
        </div>
      </AppShell>
    );
  }

  const getChecklistIcon = (status: ChecklistItemStatus) => {
    switch(status) {
      case 'pass': return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'warning': return <AlertCircle className="h-5 w-5 text-amber-500" />;
      case 'fail': return <XCircle className="h-5 w-5 text-red-600" />;
      default: return <Clock className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const workerId = assignment.workerId;
  const workerManageHref = (tab: string) => `/workers/${encodeURIComponent(workerId)}?tab=${encodeURIComponent(tab)}`;

  const isFullyReady = assignment.readinessStatus === 'ready';

  const finalClearanceDeploymentLabel = (() => {
    const ds = assignment.deploymentStatus;
    const ms = assignment.mobilizationStatus;
    if (ds === 'ACTIVE' || ms === 'ACTIVE') {
      return 'เข้าหน้างานแล้ว (ACTIVE) — timesheet รายวัน / ศูนย์ลงเวลา PO Active';
    }
    if (ds === 'MOBILIZING' || ms === 'MOBILIZING') {
      return 'กำลังระดมพล / เดินทาง (MOBILIZING)';
    }
    if (ds === 'READY_TO_MOB' || ms === 'READY_TO_MOBILIZE') {
      return 'พร้อมเดินทาง — ยืนยันความพร้อมแล้ว (READY_TO_MOB)';
    }
    const byDeployment: Partial<Record<DeploymentStatus, string>> = {
      DRAFT: 'ร่าง (DRAFT) — ยังไม่ผ่านขั้น Final',
      READINESS_CHECK: 'ตรวจความพร้อม (READINESS_CHECK)',
      CLIENT_SUBMITTED: 'ส่งลูกค้าพิจารณา (CLIENT_SUBMITTED)',
      CLIENT_APPROVED: 'ลูกค้าอนุมัติ (CLIENT_APPROVED)',
      CONFIRMED: 'ยืนยันมอบหมาย (CONFIRMED)',
      DEMOBILIZED: 'สิ้นสุดการส่งตัว (DEMOBILIZED)',
      CLOSED: 'ปิดรายการ (CLOSED)',
    };
    if (ds && byDeployment[ds]) return byDeployment[ds]!;
    if (ms === 'PENDING') return 'รอดำเนินการ (PENDING)';
    if (ms === 'DEMOBILIZED') return 'ถอนกำลังแล้ว (DEMOBILIZED)';
    return `${ds || '—'}${ms ? ` · ${ms}` : ''}`;
  })();

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.push('/mobilization')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Mobilization Command Center (การเตรียมส่งตัว)</h1>
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <span className="font-mono font-bold text-primary">{assignment.assignmentNo || assignment.id}</span>
                <Separator orientation="vertical" className="h-3" />
                <span>{worker?.firstName} {worker?.lastName}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" className="text-sm py-1.5 px-4 border-primary/20 bg-primary/5 text-primary font-bold">
              MOB STATUS: {assignment.mobilizationStatus || 'PENDING'}
            </Badge>
            <Badge variant={isFullyReady ? 'default' : 'destructive'} className={isFullyReady ? 'bg-green-600' : ''}>
              READINESS: {assignment.readinessStatus.toUpperCase()}
            </Badge>
          </div>
        </div>

        {!isFullyReady && (
          <Alert variant="destructive" className="bg-destructive/5 border-destructive/20">
            <AlertTriangle className="h-5 w-5" />
            <AlertTitle className="font-bold">ตรวจพบรายการที่ไม่สมบูรณ์ (Incomplete Readiness)</AlertTitle>
            <AlertDescription>
              คนงานยังไม่ผ่านเกณฑ์ความพร้อมที่กำหนด กรุณาตรวจสอบแท็บ "ภาพรวมความพร้อม" เพื่อดูรายละเอียดสิ่งที่ขาดหายไป
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Tabs defaultValue="overview" className="w-full">
              <TabsList className="grid grid-cols-5 w-full h-auto p-1 bg-muted/50">
                <TabsTrigger value="overview" className="gap-2 py-2 text-xs">ภาพรวมความพร้อม</TabsTrigger>
                <TabsTrigger value="docs" className="gap-2 py-2 text-xs">เอกสาร/ใบเซอร์</TabsTrigger>
                <TabsTrigger value="ppe" className="gap-2 py-2 text-xs">PPE/เครื่องมือ</TabsTrigger>
                <TabsTrigger value="approvals" className="gap-2 py-2 text-xs">การอนุมัติ</TabsTrigger>
                <TabsTrigger value="history" className="gap-2 py-2 text-xs">ประวัติ</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="mt-6 space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2 text-primary">
                      <ClipboardCheck className="h-5 w-5" /> รายการตรวจสอบความสมบูรณ์ (Compliance Checklist)
                    </CardTitle>
                    <CardDescription>สรุปสถานะเอกสารและอุปกรณ์ก่อนยืนยันการระดมพล</CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader className="bg-muted/30">
                        <TableRow>
                          <TableHead className="w-[50px]"></TableHead>
                          <TableHead>หัวข้อการตรวจสอบ (Operational Item)</TableHead>
                          <TableHead className="w-[120px] text-left">สถานะ</TableHead>
                          <TableHead className="w-[100px] text-right pr-4">การจัดการ</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <TableRow>
                          <TableCell>{getChecklistIcon(assignment.readinessSummary.passportValid)}</TableCell>
                          <TableCell className="font-medium text-sm">หนังสือเดินทาง / บัตรประชาชน (Passport/ID Valid)</TableCell>
                          <TableCell className="text-left capitalize text-xs">{assignment.readinessSummary.passportValid}</TableCell>
                          <TableCell className="text-right p-2">
                            <Button variant="ghost" size="icon" className="h-8 w-8" asChild title="เปิดทะเบียนลูกจ้าง — ข้อมูลบัตร/พาส">
                              <Link href={workerManageHref('info')}>
                                <ChevronRight className="h-4 w-4" />
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>{getChecklistIcon(assignment.readinessSummary.medicalValid)}</TableCell>
                          <TableCell className="font-medium text-sm">ใบรับรองแพทย์ (Medical Certificate Valid)</TableCell>
                          <TableCell className="text-left capitalize text-xs">{assignment.readinessSummary.medicalValid}</TableCell>
                          <TableCell className="text-right p-2">
                            <Button variant="ghost" size="icon" className="h-8 w-8" asChild title="เปิดทะเบียน — ตรวจร่างกาย">
                              <Link href={workerManageHref('medical')}>
                                <ChevronRight className="h-4 w-4" />
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>{getChecklistIcon(assignment.readinessSummary.certificatesComplete)}</TableCell>
                          <TableCell className="font-medium text-sm">ใบเซอร์บังคับประจำตำแหน่ง (Position Certificates)</TableCell>
                          <TableCell className="text-left capitalize text-xs">{assignment.readinessSummary.certificatesComplete}</TableCell>
                          <TableCell className="text-right p-2">
                            <Button variant="ghost" size="icon" className="h-8 w-8" asChild title="เปิดทะเบียน — ใบเซอร์">
                              <Link href={workerManageHref('certs')}>
                                <ChevronRight className="h-4 w-4" />
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>{getChecklistIcon(drugTestChecklistStatus)}</TableCell>
                          <TableCell className="font-medium text-sm">ผลตรวจสารเสพติด (Drug test)</TableCell>
                          <TableCell className="text-left capitalize text-xs">{drugTestChecklistStatus}</TableCell>
                          <TableCell className="text-right p-2">
                            <Button variant="ghost" size="icon" className="h-8 w-8" asChild title="เปิดทะเบียน — สารเสพติด">
                              <Link href={workerManageHref('drug')}>
                                <ChevronRight className="h-4 w-4" />
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>{getChecklistIcon(assignment.readinessSummary.clientApproved)}</TableCell>
                          <TableCell className="font-medium text-sm">ได้รับการอนุมัติจากลูกค้า (Client Approval)</TableCell>
                          <TableCell className="text-left capitalize text-xs">{assignment.readinessSummary.clientApproved}</TableCell>
                          <TableCell className="text-right p-2">
                            <Button variant="ghost" size="icon" className="h-8 w-8" asChild title="เปิดทะเบียน — เอกสาร/หลักฐาน">
                              <Link href={workerManageHref('docs')}>
                                <ChevronRight className="h-4 w-4" />
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>{getChecklistIcon(assignment.readinessSummary.ppeIssued)}</TableCell>
                          <TableCell className="font-medium text-sm">เบิกอุปกรณ์ PPE ครบถ้วน (PPE Issued)</TableCell>
                          <TableCell className="text-left capitalize text-xs">{assignment.readinessSummary.ppeIssued}</TableCell>
                          <TableCell className="text-right p-2">
                            <Button variant="ghost" size="icon" className="h-8 w-8" asChild title="เปิดทะเบียน — รายการ PPE">
                              <Link href={workerManageHref('ppe_list')}>
                                <ChevronRight className="h-4 w-4" />
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>{getChecklistIcon(assignment.readinessSummary.toolsIssued)}</TableCell>
                          <TableCell className="font-medium text-sm">เบิกเครื่องมือช่าง (Tools Issued)</TableCell>
                          <TableCell className="text-left capitalize text-xs">{assignment.readinessSummary.toolsIssued}</TableCell>
                          <TableCell className="text-right p-2">
                            <Button variant="ghost" size="icon" className="h-8 w-8" asChild title="เปิดทะเบียน — รายการอุปกรณ์">
                              <Link href={workerManageHref('tools_list')}>
                                <ChevronRight className="h-4 w-4" />
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <TooltipProvider delayDuration={300}>
                  <Card className="border-blue-200 bg-blue-50/80 text-blue-950">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Info className="h-4 w-4 shrink-0" />
                        Final clearance — ลำดับเดียว (เฟส 3 · PO workflow)
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm space-y-2 pt-0">
                      <ol className="list-decimal pl-4 space-y-1.5">
                        <li>
                          <strong>ยืนยันพร้อมเดินทาง</strong> — บันทึกเวลาและผู้ยืนยัน (<span className="font-mono">READY_TO_MOB</span>)
                        </li>
                        <li>
                          <strong>วัน Standby</strong> — เลือกวันที่ (ค่าเริ่มต้น = วันนี้ตาม{' '}
                          <span className="font-mono">Asia/Bangkok</span>) → <span className="font-mono">MOBILIZING</span>
                        </li>
                        <li>
                          <strong>เริ่มวันทำงาน</strong> — ค่าเริ่มต้น = วันรุ่งขึ้นหลัง Standby →{' '}
                          <span className="font-mono">ACTIVE</span> (เฟสถัดไป: auto รายวัน / timesheet)
                        </li>
                      </ol>
                      <p className="text-xs text-blue-900/90">
                        ห้ามข้ามขั้น — ถ้ากดเมื่อยังไม่ครบขั้นก่อนหน้า ระบบจะแจ้งเตือนและไม่บันทึก · ขั้น 2–3 จะเขียนลง{' '}
                        <span className="font-mono">daily_timesheets</span> ทันที (ไม่เขียนลงงวด PO+เดือนที่ล็อกแล้ว)
                      </p>
                    </CardContent>
                  </Card>

                  {assignment.mobWorkflowVersion === 'po_active_v2' ? (
                    <Card className="border-violet-200/80 bg-violet-50/40 dark:bg-violet-950/20">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                          <MapPin className="h-4 w-4 shrink-0" /> สถานที่ปฏิบัติงาน (ไซต์)
                        </CardTitle>
                        <CardDescription>
                          ต้องบันทึกก่อนกด «ยืนยันพร้อมเดินทาง» — เลือกจากบรรทัด PO หรือพิมพ์สถานที่เอง (การมอบหมายยังผูกบรรทัด PO เดิม — ใช้ระบุไซต์เท่านั้น)
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-2">
                            <Label className="text-xs font-semibold text-muted-foreground">จากบรรทัด PO</Label>
                            <Select
                              value={
                                locationCustomDraft.trim()
                                  ? '_line_placeholder_'
                                  : locationLineIdDraft || '_line_placeholder_'
                              }
                              onValueChange={(v) => {
                                if (v === '_line_placeholder_') return;
                                setLocationLineIdDraft(v);
                                setLocationCustomDraft('');
                              }}
                              disabled={
                                !canEditMobilization || isMobUnassigned(assignment) || isFinalClearanceStep1Done(assignment)
                              }
                            >
                              <SelectTrigger className="h-11">
                                <SelectValue placeholder="เลือกบรรทัด PO" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="_line_placeholder_" disabled>
                                  — เลือกบรรทัด —
                                </SelectItem>
                                {(poLines ?? []).map((ln) => (
                                  <SelectItem key={ln.id} value={ln.id}>
                                    {(ln.workLocation || '').trim() || ln.id}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs font-semibold text-muted-foreground">
                              หรือระบุข้อความสถานที่ (ถ้ากรอกช่องนี้ จะใช้แทนการเลือกบรรทัด)
                            </Label>
                            <Input
                              className="h-11"
                              value={locationCustomDraft}
                              onChange={(e) => setLocationCustomDraft(e.target.value)}
                              placeholder="เช่น Rig A /ฐานส่งตัว"
                              disabled={
                                !canEditMobilization || isMobUnassigned(assignment) || isFinalClearanceStep1Done(assignment)
                              }
                            />
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={
                              !canEditMobilization ||
                              isMobUnassigned(assignment) ||
                              isFinalClearanceStep1Done(assignment) ||
                              locationSaving
                            }
                            onClick={() => void saveMobLocation()}
                          >
                            {locationSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                            บันทึกสถานที่
                          </Button>
                          {(assignment.workLocation || '').trim() ? (
                            <span className="text-xs text-muted-foreground">
                              ปัจจุบัน: <strong>{assignment.workLocation}</strong>
                            </span>
                          ) : (
                            <span className="text-xs text-amber-800 dark:text-amber-200">
                              ยังไม่บันทึกสถานที่ — ขั้นที่ 1 จะไม่ให้กด
                            </span>
                          )}
                          {(assignment.mobLocationKey || '').trim() ? (
                            <span className="text-[10px] font-mono text-muted-foreground break-all">
                              ({assignment.mobLocationKey})
                            </span>
                          ) : null}
                        </div>
                      </CardContent>
                    </Card>
                  ) : null}

                  <Card className="border-primary/20 bg-primary/5">
                    <CardHeader>
                      <CardTitle className="text-lg flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span>Final Clearance</span>
                        <span className="text-sm font-normal text-muted-foreground">
                          รอบที่ {assignment.mobCycleNumber ?? 1} · {finalClearanceDeploymentLabel}
                        </span>
                      </CardTitle>
                      <CardDescription>
                        วันที่ใช้เขตเวลาไทย (Bangkok) · Unassign คืนคนให้ไป PO ชุดอื่นได้ — ไม่ลบ timesheet เดิม
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      {clearanceEditMode !== 0 ? (
                        <Alert className="border-amber-300 bg-amber-50/90 dark:bg-amber-950/30">
                          <AlertTriangle className="h-4 w-4 text-amber-800" />
                          <AlertTitle className="text-amber-950 dark:text-amber-100">โหมดแก้ไขวันที่</AlertTitle>
                          <AlertDescription className="text-xs text-amber-950/90 dark:text-amber-50/90">
                            แก้ขั้นที่ {clearanceEditMode} — บันทึกใหม่เมื่อแก้เสร็จ หรือกด «ยกเลิกการแก้ไข»
                          </AlertDescription>
                        </Alert>
                      ) : null}

                      <div className="flex flex-col gap-3 md:flex-row md:items-end md:flex-wrap">
                        <div className="space-y-2 flex-1 min-w-[200px]">
                          <p className="text-xs font-bold text-muted-foreground uppercase">ขั้น 1 · พร้อมเดินทาง</p>
                          {isFinalClearanceStep1Done(assignment) ? (
                            <p className="text-sm">
                              บันทึกแล้ว — {formatDateTimeThaiBE(assignment.mobReadyToTravelAt)}{' '}
                              <span className="text-muted-foreground font-mono text-xs">
                                ({assignment.mobReadyToTravelByUserId || '—'})
                              </span>
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground">ต้องผ่านความพร้อม (READY) ก่อนกดยืนยัน</p>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex">
                                <Button
                                  disabled={
                                    !canEditMobilization ||
                                    isMobUnassigned(assignment) ||
                                    isFinalClearanceStep1Done(assignment) ||
                                    !step1Gate.ok ||
                                    clearanceSavingStep !== 0
                                  }
                                  onClick={runFinalClearanceStep1}
                                  className="bg-green-600 hover:bg-green-700 font-bold"
                                >
                                  <CheckCircle2 className="h-4 w-4 mr-2" /> คอนเฟิร์มพร้อมเดินทาง
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-sm text-xs leading-relaxed">
                              {isFinalClearanceStep1Done(assignment)
                                ? 'ยืนยันขั้นนี้แล้ว — ปุ่มถูกปิดเพื่อไม่ให้กดซ้ำ'
                                : !step1Gate.ok
                                  ? step1Gate.message
                                  : 'ให้ตรวจเช็คความพร้อมตามเช็คลิสด้านบน เมื่อพร้อมแล้วให้กดยืนยัน — ระบบจะบันทึกเวลาไว้'}
                            </TooltipContent>
                          </Tooltip>
                          {isFinalClearanceStep1Done(assignment) &&
                          !isFinalClearanceStep2Done(assignment) &&
                          canRevertFinalClearanceStep1(assignment).ok ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={
                                !canEditMobilization || isMobUnassigned(assignment) || clearanceSavingStep !== 0
                              }
                              onClick={() => setStep1RevertOpen(true)}
                            >
                              <Pencil className="h-4 w-4 mr-1" />
                              แก้ไข
                            </Button>
                          ) : null}
                        </div>
                      </div>

                      <Separator />

                      <div className="flex flex-col gap-3 md:flex-row md:items-end md:flex-wrap">
                        <div className="space-y-2 flex-1 min-w-[220px]">
                          <p className="text-xs font-bold text-muted-foreground uppercase">ขั้น 2 · วัน Standby</p>
                          {assignment.poLineId && !primaryPoLine ? (
                            <p className="text-xs text-amber-800 dark:text-amber-200">กำลังโหลดบรรทัด PO…</p>
                          ) : null}
                          <DatePickerThaiBE
                            className="h-11 max-w-xs"
                            value={htmlDateValueToTimestampMs(standbyDateDraft)}
                            onChange={(ms) => setStandbyDateDraft(timestampToHtmlDateValue(ms))}
                            disabled={
                              !canEditMobilization ||
                              isMobUnassigned(assignment) ||
                              clearanceSavingStep !== 0 ||
                              (isFinalClearanceStep2Done(assignment) && clearanceEditMode !== 2)
                            }
                          />
                          {isFinalClearanceStep2Done(assignment) ? (
                            <p className="text-sm">
                              บันทึกแล้ว — วันที่ {assignment.mobStandbyDate} ·{' '}
                              {formatDateTimeThaiBE(assignment.mobStandbyRecordedAt)}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex">
                                <Button
                                  variant="outline"
                                  className="border-blue-600 text-blue-700"
                                  disabled={
                                    !canEditMobilization ||
                                    isMobUnassigned(assignment) ||
                                    clearanceSavingStep !== 0 ||
                                    !primaryPoLine ||
                                    (isFinalClearanceStep2Done(assignment) && clearanceEditMode !== 2) ||
                                    !step2SaveGate.ok
                                  }
                                  onClick={() => void runFinalClearanceStep2()}
                                >
                                  {clearanceSavingStep === 2 ? (
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  ) : (
                                    <Truck className="h-4 w-4 mr-2" />
                                  )}
                                  {clearanceEditMode === 2 ? 'บันทึกวัน Standby (แก้ไข)' : 'พร้อมเดินทาง (Standby)'}
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-sm text-xs leading-relaxed">
                              {clearanceEditMode === 2
                                ? 'บันทึกวัน Standby ใหม่ — งวด PO+เดือนล็อกแล้วยังบันทึกจาก Mob ได้'
                                : isFinalClearanceStep2Done(assignment)
                                  ? 'บันทึก Standby แล้ว — ใช้ปุ่มแก้ไขหากต้องการเปลี่ยนวันที่'
                                  : !step2SaveGate.ok
                                    ? step2SaveGate.message
                                    : 'กดยืนยันวันที่ลูกจ้างพร้อมเดินทาง — วันนี้จะเป็นวันที่ได้รับค่าจ้าง Standby Day เลือกวันที่ได้ (ค่าเริ่มต้นเป็นวันนี้) · ระบบจะลง timesheet เป็น standby อัตโนมัติ'}
                            </TooltipContent>
                          </Tooltip>
                          {isFinalClearanceStep2Done(assignment) && clearanceEditMode !== 2 ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={
                                !canEditMobilization || isMobUnassigned(assignment) || clearanceSavingStep !== 0
                              }
                              onClick={beginEditStandby}
                            >
                              <Pencil className="h-4 w-4 mr-1" />
                              แก้ไขวันที่
                            </Button>
                          ) : null}
                          {clearanceEditMode === 2 ? (
                            <Button type="button" variant="ghost" size="sm" onClick={cancelClearanceEdit}>
                              ยกเลิกการแก้ไข
                            </Button>
                          ) : null}
                        </div>
                      </div>

                      <Separator />

                      <div className="flex flex-col gap-3 md:flex-row md:items-end md:flex-wrap">
                        <div className="space-y-2 flex-1 min-w-[220px]">
                          <p className="text-xs font-bold text-muted-foreground uppercase">ขั้น 3 · เริ่มวันทำงาน</p>
                          {assignment.poLineId && !primaryPoLine ? (
                            <p className="text-xs text-amber-800 dark:text-amber-200">กำลังโหลดบรรทัด PO…</p>
                          ) : null}
                          <DatePickerThaiBE
                            className="h-11 max-w-xs"
                            value={htmlDateValueToTimestampMs(workingStartDateDraft)}
                            onChange={(ms) => setWorkingStartDateDraft(timestampToHtmlDateValue(ms))}
                            disabled={
                              !canEditMobilization ||
                              isMobUnassigned(assignment) ||
                              clearanceSavingStep !== 0 ||
                              !isFinalClearanceStep2Done(assignment) ||
                              (isFinalClearanceStep3Done(assignment) && clearanceEditMode !== 3)
                            }
                          />
                          {isFinalClearanceStep3Done(assignment) ? (
                            <p className="text-sm">
                              เริ่มแล้ว — วันที่ {assignment.mobWorkingStartDate} ·{' '}
                              {formatDateTimeThaiBE(assignment.mobWorkingStartedAt)}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex">
                                <Button
                                  className="bg-blue-900 hover:bg-blue-950"
                                  disabled={
                                    !canEditMobilization ||
                                    isMobUnassigned(assignment) ||
                                    clearanceSavingStep !== 0 ||
                                    !primaryPoLine ||
                                    !isFinalClearanceStep2Done(assignment) ||
                                    (isFinalClearanceStep3Done(assignment) && clearanceEditMode !== 3) ||
                                    !step3SaveGate.ok
                                  }
                                  onClick={() => void runFinalClearanceStep3()}
                                >
                                  {clearanceSavingStep === 3 ? (
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  ) : (
                                    <CheckCircle className="h-4 w-4 mr-2" />
                                  )}
                                  {clearanceEditMode === 3 ? 'บันทึกวันเริ่มงาน (แก้ไข)' : 'Start working day'}
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-sm text-xs leading-relaxed">
                              {clearanceEditMode === 3
                                ? 'บันทึกใหม่ — ช่วงระหว่างวัน Standby กับวันเริ่มงานจะเป็น Standby อัตโนมัติ · ต่อเนื่องต้นเดือน (ถ้ามี)'
                                : isFinalClearanceStep3Done(assignment)
                                  ? 'เริ่มวันทำงานแล้ว — ใช้ปุ่มแก้ไขหากต้องการเปลี่ยนวันที่'
                                  : !step3SaveGate.ok
                                    ? step3SaveGate.message
                                    : 'วันเริ่มงานต้องหลังวัน Standby — ระบบจะเติมวัน Standby ในช่วงว่างอัตโนมัติ · ถ้าต่อจากเดือนก่อนจะเติมวันทำงานต้นเดือนจนถึงก่อนวัน Standby'}
                            </TooltipContent>
                          </Tooltip>
                          {isFinalClearanceStep3Done(assignment) && clearanceEditMode !== 3 ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={
                                !canEditMobilization || isMobUnassigned(assignment) || clearanceSavingStep !== 0
                              }
                              onClick={beginEditWorkStart}
                            >
                              <Pencil className="h-4 w-4 mr-1" />
                              แก้ไขวันที่
                            </Button>
                          ) : null}
                          {clearanceEditMode === 3 ? (
                            <Button type="button" variant="ghost" size="sm" onClick={cancelClearanceEdit}>
                              ยกเลิกการแก้ไข
                            </Button>
                          ) : null}
                        </div>
                      </div>

                      <Separator />

                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="text-xs text-muted-foreground max-w-xl">
                          <strong>Unassign</strong> — คืนสถานะลูกจ้างให้ไปมอบหมาย PO Active ชุดอื่นได้ (ประวัติ timesheet ไม่ถูกลบ)
                          {isMobUnassigned(assignment) ? (
                            <span className="block mt-1 text-amber-800">
                              รายการนี้ Unassign แล้วเมื่อ {formatDateTimeThaiBE(assignment.unassignedAt)}
                            </span>
                          ) : null}
                        </div>
                        <Button
                          variant="destructive"
                          disabled={!canEditMobilization || isMobUnassigned(assignment)}
                          onClick={() => setUnassignDialogOpen(true)}
                        >
                          <UserX className="h-4 w-4 mr-2" />
                          Unassign
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </TooltipProvider>

                {assignment.poId && assignment.waveId && (
                  <Card className="border-green-200 bg-green-50/50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base text-green-900">ขั้นตอนถัดไป: ลงเวลา</CardTitle>
                      <CardDescription>
                        {isPoTimesheetScopeId(assignment.waveId)
                          ? 'โหมด PO (ไม่มี Wave จริง) — เปิด Wave Board ด้วยขอบเขต PO + synthetic wave'
                          : 'PO / Wave ของคนนี้ถูกผูกไว้แล้ว — เปิด Wave Board จากลิงก์นี้ได้ทันที'}
                        {assignment.deploymentStatus === 'ACTIVE' && (
                          <span className="block mt-1 text-green-800 font-medium">
                            สถานะ deployment = ACTIVE แล้ว — เหมาะสมสำหรับลงเวลาต่อเนื่อง
                          </span>
                        )}
                        {assignment.deploymentStatus &&
                          assignment.deploymentStatus !== 'ACTIVE' && (
                            <span className="block mt-1 text-amber-900/90 text-xs">
                              แนะนำให้ทำขั้น 3 «เริ่มวันทำงาน» ให้ครบก่อนลงเวลา
                            </span>
                          )}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-2">
                      <Button className="bg-green-700 hover:bg-green-800" asChild>
                        <Link
                          href={`/timesheets/wave-board?poId=${encodeURIComponent(assignment.poId)}&waveId=${encodeURIComponent(assignment.waveId)}`}
                        >
                          {isPoTimesheetScopeId(assignment.waveId)
                            ? 'ไป Wave Board (ขอบเขต PO)'
                            : 'ไปลงเวลา Wave Board (PO / Wave นี้)'}
                        </Link>
                      </Button>
                      <Button variant="outline" asChild>
                        <Link href="/timesheets">ดูศูนย์ลงเวลา</Link>
                      </Button>
                    </CardContent>
                  </Card>
                )}

                {assignment.poId && assignment.waveId && (
                  <Card className="border-amber-200/80 bg-amber-50/40">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base text-amber-950">สร้างรายวันอัตโนมัติ (เฟส 4 · PO Active)</CardTitle>
                      <CardDescription>
                        สร้าง/อัปเดต <span className="font-mono">daily_timesheets</span> แบบ <span className="font-mono">work_day</span> ตั้งแต่วันเริ่มทำงานจนถึงวันนี้ (
                        Bangkok) หรือจบงาน — ไม่ทับแถวที่ปิดการเงินแล้วหรือแถวที่ไม่ใช่ auto (
                        <span className="font-mono">poActiveAutoDaily</span>)
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={
                          !canEditTimesheets ||
                          !firestore ||
                          autoDailySyncing ||
                          assignment.deploymentStatus !== 'ACTIVE' ||
                          isMobUnassigned(assignment)
                        }
                        onClick={runPoActiveAutoDailySync}
                      >
                        {autoDailySyncing ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            กำลังซิงค์…
                          </>
                        ) : (
                          <>
                            <Calendar className="h-4 w-4 mr-2" />
                            ซิงค์รายวันอัตโนมัติ
                          </>
                        )}
                      </Button>
                      {assignment.deploymentStatus !== 'ACTIVE' ? (
                        <span className="text-xs text-muted-foreground">ใช้ได้เมื่อสถานะ deployment = ACTIVE</span>
                      ) : null}
                      {!canEditTimesheets ? (
                        <span className="text-xs text-muted-foreground">ต้องมีสิทธิ์แก้ไข Timesheets</span>
                      ) : null}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="docs" className="mt-6 space-y-6">
                <Card>
                  <CardHeader><CardTitle className="text-base">ใบรับรองและเอกสารที่เกี่ยวข้อง (Compliance Proofs)</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {workerCerts?.map(cert => (
                        <div key={cert.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30 transition-colors">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-blue-100 rounded text-blue-700"><FileText className="h-4 w-4" /></div>
                            <div>
                              <p className="text-sm font-bold">{cert.certificateName}</p>
                              <p className="text-[10px] text-muted-foreground">หมดอายุ: {formatDateThaiBE(cert.expiryDate)}</p>
                            </div>
                          </div>
                          <Badge variant={cert.status === 'valid' ? 'outline' : 'destructive'} className={cert.status === 'valid' ? 'text-green-600 border-green-200' : ''}>
                            {cert.status.toUpperCase()}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="ppe" className="mt-6">
                <div className="py-20 text-center space-y-4 border-2 border-dashed rounded-lg bg-muted/10">
                  <Package className="h-12 w-12 mx-auto text-muted-foreground/30" />
                  <div className="space-y-1">
                    <p className="font-bold text-muted-foreground">รายการเบิก-คืน PPE และเครื่องมือ</p>
                    <p className="text-xs text-muted-foreground">กรุณาจัดการที่โมดูล คลังอุปกรณ์ (Store / Inventory)</p>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="approvals" className="mt-6">
                <Card>
                  <CardHeader><CardTitle>สถานะการอนุมัติและหมายเหตุ</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="p-4 border rounded-lg bg-green-50/50 flex items-center justify-between">
                      <div className="space-y-1">
                        <p className="text-xs font-bold text-green-700 uppercase">Client Consideration</p>
                        <p className="text-sm font-medium">ลูกค้าอนุมัติพนักงานรายนี้เข้าโครงการแล้ว</p>
                      </div>
                      <Badge className="bg-green-600">{assignment.clientApprovalStatus}</Badge>
                    </div>
                    <Separator />
                    <div className="space-y-2">
                      <p className="text-xs font-bold text-muted-foreground uppercase">หมายเหตุจากการพิจารณา:</p>
                      <p className="text-sm italic">{assignment.clientComments || 'ไม่มีหมายเหตุเพิ่มเติม'}</p>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="history" className="mt-6">
                <Card>
                  <CardHeader><CardTitle className="text-lg flex items-center gap-2"><History className="h-5 w-5" /> ประวัติการดำเนินการ (Audit Trail)</CardTitle></CardHeader>
                  <CardContent>
                    <div className="text-sm space-y-6">
                      <div className="flex gap-4 border-l-2 border-primary/20 pl-4 relative pb-2">
                        <div className="absolute -left-[9px] top-0 h-4 w-4 rounded-full bg-primary" />
                        <div>
                          <p className="font-bold">MOBILIZATION PIPELINE START</p>
                          <p className="text-xs text-muted-foreground">{formatDateTimeThaiBE(assignment.updatedAt)}</p>
                          <p className="text-xs mt-1">Personnel entered mobilization queue</p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-sm font-bold flex items-center gap-2 text-primary">
                  <User className="h-4 w-4" /> ข้อมูลคนงาน (Worker Context)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                {worker ? (
                  <>
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-xl">
                        {worker.firstName.charAt(0)}
                      </div>
                      <div>
                        <h3 className="font-bold text-base">{worker.firstName} {worker.lastName}</h3>
                        <p className="text-[10px] text-muted-foreground font-mono">{worker.thaiNationalId}</p>
                      </div>
                    </div>
                    <Separator />
                    <Button variant="outline" size="sm" className="w-full text-xs h-8" asChild>
                      <Link href={`/workers/${worker.id}`}>ดูประวัติคนงานแบบเต็ม <ChevronRight className="h-3 w-3 ml-1" /></Link>
                    </Button>
                  </>
                ) : <div className="animate-pulse h-20 bg-muted rounded" />}
              </CardContent>
            </Card>

            <Card className="bg-primary/5 border-primary/10 shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">ข้อมูลโครงการ & สัญญา</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-2">
                <div className="space-y-1">
                  <p className="text-[9px] text-muted-foreground uppercase font-bold">ลูกค้า (Client):</p>
                  <p className="text-xs font-bold flex items-center gap-1"><Building2 className="h-3 w-3" /> {customer?.name || '...'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[9px] text-muted-foreground uppercase font-bold">ใบสั่งซื้อ (Purchase Order):</p>
                  <p className="text-xs font-bold text-primary flex items-center gap-1"><FileText className="h-3 w-3" /> {po?.poCode || '...'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[9px] text-muted-foreground uppercase font-bold">ชุด PO Active:</p>
                  <p className="text-xs font-mono font-medium break-all">
                    {assignment.poActiveBundleId
                      ? normalizePoActiveBundleId(assignment.poActiveBundleId)
                      : po
                        ? normalizePoActiveBundleId(resolvePoActiveBundleKeyForPo(po))
                        : '—'}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-[9px] text-muted-foreground uppercase font-bold">Wave (legacy):</p>
                  <p className="text-xs font-bold text-primary flex items-center gap-1">
                    <Waves className="h-3 w-3" />
                    {assignment.waveId && !isPoTimesheetScopeId(assignment.waveId)
                      ? wave?.waveCode || assignment.waveId.slice(0, 12) + '…'
                      : 'ไม่ใช้ Wave (PO scope)'}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-[9px] text-muted-foreground uppercase font-bold">สถานที่ปฏิบัติงาน:</p>
                  <p className="text-xs font-medium flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {(assignment.workLocation || wave?.siteLocation || '—').toString()}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <AlertDialog open={step1RevertOpen} onOpenChange={setStep1RevertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ย้อนยืนยันขั้นที่ 1?</AlertDialogTitle>
            <AlertDialogDescription>
              ระบบจะลบเวลาที่บันทึก «พร้อมเดินทาง» และคืนสถานะเป็นก่อนยืนยัน — ใช้เมื่อกดผิดเท่านั้น (ต้องยังไม่บันทึก Standby)
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void runRevertFinalClearanceStep1();
              }}
            >
              ยืนยันย้อน
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={step2CascadeOpen} onOpenChange={setStep2CascadeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>แก้ไขวัน Standby หลังเริ่มงานแล้ว?</AlertDialogTitle>
            <AlertDialogDescription>
              ระบบจะย้อนขั้นที่ 3 (วันเริ่มทำงาน) และลบรายวันที่สร้างจาก Mob ในช่วงหลังวัน Standbyจนถึงวันเริ่มงานเดิม (เฉพาะแถว Draft ที่มาจาก Final
              clearance) — จากนั้นให้บันทึก Standby และขั้นที่ 3 ใหม่
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmStep2CascadeAndEdit();
              }}
            >
              ยืนยัน ย้อนขั้นที่ 3 และแก้ Standby
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={unassignDialogOpen} onOpenChange={setUnassignDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unassign จาก PO นี้?</AlertDialogTitle>
            <AlertDialogDescription>
              คืนสถานะลูกจ้างให้ไปมอบหมาย PO Active ชุดอื่นได้ ประวัติ timesheet เดิมจะไม่ถูกลบ
              {assignment.deploymentStatus === 'ACTIVE' ? (
                <span className="mt-2 block font-medium text-amber-900">
                  คำเตือน: สถานะปัจจุบันเป็น ACTIVE — ตรวจสอบว่าปิดงาน / ลงเวลาครบก่อนปลดถ้าจำเป็น
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                runUnassign();
              }}
            >
              ยืนยัน Unassign
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
