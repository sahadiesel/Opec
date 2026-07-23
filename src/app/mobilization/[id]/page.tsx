'use client';

import { useState, use, useEffect, useMemo, useRef } from 'react';
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
  Printer,
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection, getDoc, updateDoc, deleteField } from 'firebase/firestore';
import { updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { ensureWorkerAssignedCustomerId } from '@/lib/client-portal/ensure-worker-assigned-customer';
import {
  formatDateThaiBE,
  formatDateTimeThaiBE,
  formatYmdLocalThaiBE,
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
  DrugTestPanelSubstance,
  MobDayChargeKind,
  MobDayChargeSpec,
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
  assignmentHasMobLocationForPhase1,
  canRunFinalClearanceStep,
  canSaveFinalClearanceMob,
  canSaveFinalClearancePreMob,
  canSaveFinalClearanceWorkStart,
  isFinalClearanceMobDone,
  isFinalClearancePreMobDone,
  isFinalClearanceStep1Done,
  isFinalClearanceStep2Done,
  isFinalClearanceStep3Done,
  isMobUnassigned,
  isTravelReadyDisplay,
  mobStandbyMobDayChoiceLabel,
  mobStandbyMobDayStatusCode,
  thailandTodayYmd,
} from '@/lib/ops/mobilization-final-clearance';
import type { MobStep2Choice } from '@/lib/ops/mob-day-charge';
import {
  defaultMobDayCharges,
  formatMobDayChargeSummary,
  mobDayChargeKindLabel,
  mobStep2ChoiceLabel,
  mobStep2ChoiceToLegacyEventType,
  normalizeMobDayChargeSpec,
} from '@/lib/ops/mob-day-charge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { isPoTimesheetScopeId } from '@/lib/constants/timesheet-po-scope';
import { isPdfAttachment } from '@/lib/storage/worker-credential-attachment';
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
import {
  computeDrugPanelMobDrugOk,
  computeMobDrugTestChecklistStatus,
  DRUG_TEST_PANEL_DOC_PATH,
  MOB_DRUG_TEST_GATE_MESSAGE_TH,
  resolveMobReferenceDateYmd,
} from '@/lib/drug-test-panel';
import {
  assignmentHasStaleFinalClearanceWhileAwaitingRemob,
  buildMobRemobClearanceDeleteFields,
} from '@/lib/timesheet/mob-finish-undo';

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
  const [preMobDateDraft, setPreMobDateDraft] = useState('');
  const [workingStartDateDraft, setWorkingStartDateDraft] = useState('');
  const [unassignDialogOpen, setUnassignDialogOpen] = useState(false);
  const [autoDailySyncing, setAutoDailySyncing] = useState(false);
  const [clearanceSavingStep, setClearanceSavingStep] = useState<0 | 2 | 3>(0);
  /** แก้ไขวันที่หลังบันทึกแล้ว — 2 = Mob, 3 = เริ่มงาน */
  const [clearanceEditMode, setClearanceEditMode] = useState<0 | 2 | 3>(0);
  const [step2CascadeOpen, setStep2CascadeOpen] = useState(false);
  const [preMobConfigOpen, setPreMobConfigOpen] = useState(false);
  const [step2ChoiceDraft, setStep2ChoiceDraft] = useState<MobStep2Choice>('MOB');
  const [billingChargeDraft, setBillingChargeDraft] = useState<MobDayChargeSpec>(() =>
    defaultMobDayCharges('MOB').billing,
  );
  const [payrollChargeDraft, setPayrollChargeDraft] = useState<MobDayChargeSpec>(() =>
    defaultMobDayCharges('MOB').payroll,
  );
  const [locationCustomDraft, setLocationCustomDraft] = useState('');
  const [locationSaving, setLocationSaving] = useState(false);
  const [locationEditing, setLocationEditing] = useState(false);
  const [viewingCert, setViewingCert] = useState<WorkerCertificate | null>(null);
  const certPreviewIframeRef = useRef<HTMLIFrameElement | null>(null);

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

  const panelDocRef = useMemoFirebase(
    () => (firestore ? doc(firestore, DRUG_TEST_PANEL_DOC_PATH[0], DRUG_TEST_PANEL_DOC_PATH[1]) : null),
    [firestore],
  );
  const { data: drugPanelDoc } = useDoc<{ substances?: DrugTestPanelSubstance[] }>(panelDocRef as any);
  const panelSubstances = useMemo(
    () => (drugPanelDoc?.substances ?? []).filter((s) => s?.id && (s.label || '').trim()),
    [drugPanelDoc?.substances],
  );

  const mobReferenceYmd = useMemo(() => {
    if (!assignment) return thailandTodayYmd();
    return resolveMobReferenceDateYmd(assignment);
  }, [assignment]);

  const mobDrugOk = useMemo(() => {
    return computeDrugPanelMobDrugOk(panelSubstances, workerDrugTests || [], mobReferenceYmd);
  }, [panelSubstances, workerDrugTests, mobReferenceYmd]);

  const drugTestChecklistStatus = useMemo((): ChecklistItemStatus => {
    return computeMobDrugTestChecklistStatus(panelSubstances, workerDrugTests || [], mobReferenceYmd);
  }, [panelSubstances, workerDrugTests, mobReferenceYmd]);

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
    const preMob = (assignment.mobPreMobDate || '').trim();
    setPreMobDateDraft(preMob || thailandTodayYmd());
    const standby = (assignment.mobStandbyDate || '').trim();
    setStandbyDateDraft(standby || thailandTodayYmd());
    const work = (assignment.mobWorkingStartDate || '').trim();
    const baseStandby = standby || thailandTodayYmd();
    setWorkingStartDateDraft(work || addDaysToYmd(baseStandby, 1));
  }, [assignment?.id, assignment?.mobPreMobDate, assignment?.mobStandbyDate, assignment?.mobWorkingStartDate]);

  useEffect(() => {
    if (!assignment) return;
    setLocationCustomDraft((assignment.workLocation || '').trim());
  }, [assignment?.id, assignment?.workLocation]);

  /** เมื่อสถานที่บันทึกแล้วและ checklist 1–4 ผ่านทีหลัง — stamp READY_TO_MOB อัตโนมัติ */
  useEffect(() => {
    if (!firestore || !assignment || !currentUser?.id || !canEditMobilization) return;
    if (isMobUnassigned(assignment)) return;
    if (!assignmentHasMobLocationForPhase1(assignment)) return;
    if (!isTravelReadyDisplay(assignment, mobDrugOk)) return;
    if (isFinalClearanceStep1Done(assignment)) return;
    if (isFinalClearanceMobDone(assignment)) return;
    const now = Date.now();
    const today = thailandTodayYmd();
    void updateDoc(doc(firestore, 'mobilizations', assignment.id), {
      mobReadyToTravelDate: today,
      mobReadyToTravelAt: now,
      mobReadyToTravelByUserId: currentUser.id,
      mobilizationStatus: 'READY_TO_MOBILIZE',
      deploymentStatus: 'READY_TO_MOB',
      updatedAt: now,
    }).catch((e) => console.warn('[mob] auto READY_TO_MOB stamp', e));
  }, [
    firestore,
    assignment,
    currentUser?.id,
    canEditMobilization,
    mobDrugOk,
  ]);

  /** Waiting MOB หลังจบงานแต่ยังมีค่า Final clearance / ไซต์รอบเก่าค้าง — เคลียร์ให้เริ่มรอบใหม่ */
  const remobStaleHealKeyRef = useRef<string>('');
  useEffect(() => {
    if (!firestore || !assignment || !canEditMobilization) return;
    if (!assignmentHasStaleFinalClearanceWhileAwaitingRemob(assignment)) return;
    const healKey = `${assignment.id}:${assignment.mobCycleNumber ?? 1}:${assignment.mobLocationEndDate ?? ''}`;
    if (remobStaleHealKeyRef.current === healKey) return;
    remobStaleHealKeyRef.current = healKey;
    const now = Date.now();
    void updateDoc(doc(firestore, 'mobilizations', assignment.id), {
      ...buildMobRemobClearanceDeleteFields(deleteField()),
      updatedAt: now,
    })
      .then(async () => {
        const snap = await getDoc(doc(firestore, 'mobilizations', assignment.id));
        if (snap.exists()) {
          setAssignment({ id: snap.id, ...(snap.data() as object) } as Assignment);
        }
        setPreMobDateDraft(thailandTodayYmd());
        setStandbyDateDraft(thailandTodayYmd());
        setWorkingStartDateDraft(addDaysToYmd(thailandTodayYmd(), 1));
        setLocationCustomDraft('');
        setClearanceEditMode(0);
        toast({
          title: 'เริ่มรอบ Mobilization ใหม่',
          description: 'เคลียร์ค่า Final clearance / ไซต์รอบเก่าแล้ว — ระบุสถานที่และวัน Pre-Mob/Mob ใหม่',
        });
      })
      .catch((e: unknown) => {
        remobStaleHealKeyRef.current = '';
        toast({
          variant: 'destructive',
          title: 'เคลียร์ค่ารอบเก่าไม่สำเร็จ',
          description: e instanceof Error ? e.message : String(e),
        });
      });
  }, [firestore, assignment, canEditMobilization, toast]);

  const patchMobilization = (patch: Record<string, unknown>) => {
    if (!firestore || !canEditMobilization) return;
    const mobRef = doc(firestore, 'mobilizations', id);
    const next = { ...patch, updatedAt: Date.now() };
    updateDocumentNonBlocking(mobRef, next);
    setAssignment((prev) => (prev ? ({ ...prev, ...next } as Assignment) : null));
  };

  const workerTimesheetName =
    worker?.firstName || worker?.lastName
      ? `${worker?.firstName || ''} ${worker?.lastName || ''}`.trim()
      : (assignment?.workerName || '').trim();

  const travelReady = useMemo(
    () => (assignment ? isTravelReadyDisplay(assignment, mobDrugOk) : false),
    [assignment, mobDrugOk],
  );

  const preMobSaveGate = useMemo(() => {
    if (!assignment) return { ok: false as const, message: '' };
    return canSaveFinalClearancePreMob(assignment, {
      drugOk: mobDrugOk,
      drugMessage: MOB_DRUG_TEST_GATE_MESSAGE_TH,
      travelReady,
    });
  }, [assignment, mobDrugOk, travelReady]);

  const mobSaveGate = useMemo(() => {
    if (!assignment) return { ok: false as const, message: '' };
    const drugOpts = { drugOk: mobDrugOk, drugMessage: MOB_DRUG_TEST_GATE_MESSAGE_TH, travelReady };
    if (clearanceEditMode === 2) return canSaveFinalClearanceMob(assignment, { editingExisting: true, ...drugOpts });
    return canSaveFinalClearanceMob(assignment, drugOpts);
  }, [assignment, clearanceEditMode, mobDrugOk, travelReady]);

  const step3SaveGate = useMemo(() => {
    if (!assignment) return { ok: false as const, message: '' };
    const drugOpts = { drugOk: mobDrugOk, drugMessage: MOB_DRUG_TEST_GATE_MESSAGE_TH };
    if (clearanceEditMode === 3) return canSaveFinalClearanceWorkStart(assignment, { editingExisting: true, ...drugOpts });
    return canRunFinalClearanceStep(assignment, 3, {
      readinessOk: true,
      ...drugOpts,
    });
  }, [assignment, clearanceEditMode, mobDrugOk]);

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
        description: 'แก้วัน Mob ได้ — บันทึกขั้นที่ 5 ใหม่หลังแก้เสร็จ',
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

  const runSavePreMob = async () => {
    if (!firestore || !assignment || !currentUser?.id || !po) return;
    const ymd = (preMobDateDraft || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      toast({ variant: 'destructive', title: 'วันที่ไม่ถูกต้อง', description: 'เลือกวัน Pre-Mob (รูปแบบ yyyy-mm-dd)' });
      return;
    }
    const gate = canSaveFinalClearancePreMob(assignment, {
      drugOk: mobDrugOk,
      drugMessage: MOB_DRUG_TEST_GATE_MESSAGE_TH,
      travelReady,
    });
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
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'ต้องมีสิทธิ์แก้ไข Timesheets เพื่อบันทึกลงตารางรายวัน' });
      return;
    }
    const defaults = defaultMobDayCharges('PRE_MOB');
    const billing = normalizeMobDayChargeSpec(defaults.billing);
    const payroll = normalizeMobDayChargeSpec(defaults.payroll);
    setClearanceSavingStep(2);
    try {
      await upsertMobClearanceDailyTimesheet(firestore, currentUser as AppUser, {
        assignment,
        po,
        line,
        workerDisplayName: workerTimesheetName || assignment.workerId,
        kind: 'standby_day',
        dateYmd: ymd,
        bypassPoMonthLock: true,
        billingCharge: billing,
        payrollCharge: payroll,
        remarkOverride: `Mob — Final clearance · Pre-Mob · SB 8 ชม. · วางบิล ${formatMobDayChargeSummary(billing)} · จ่าย ${formatMobDayChargeSummary(payroll)}`,
      });
      const now = Date.now();
      patchMobilization({
        mobPreMobDate: ymd,
        mobPreMobRecordedAt: now,
        mobPreMobRecordedByUserId: currentUser.id,
        mobPreMobSkipped: false,
        mobStep2Choice: 'PRE_MOB',
      });
      toast({
        title: 'บันทึก Pre-Mob แล้ว',
        description: `วันที่ ${ymd} · SB 8 ชม. (วางบิล / จ่ายลูกจ้าง)`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ variant: 'destructive', title: 'บันทึก Pre-Mob ไม่สำเร็จ', description: msg });
    } finally {
      setClearanceSavingStep(0);
    }
  };

  const runSkipPreMob = async () => {
    if (!firestore || !assignment || !currentUser?.id || !canEditMobilization) return;
    const gate = canSaveFinalClearancePreMob(assignment, {
      drugOk: mobDrugOk,
      drugMessage: MOB_DRUG_TEST_GATE_MESSAGE_TH,
      travelReady,
    });
    if (!gate.ok) {
      toast({ variant: 'destructive', title: 'ยังทำขั้นนี้ไม่ได้', description: gate.message });
      return;
    }
    setClearanceSavingStep(2);
    try {
      const now = Date.now();
      const mobRef = doc(firestore, 'mobilizations', id);
      await updateDoc(mobRef, {
        mobPreMobSkipped: true,
        mobPreMobRecordedAt: now,
        mobPreMobRecordedByUserId: currentUser.id,
        mobPreMobDate: deleteField(),
        updatedAt: now,
      });
      const snap = await getDoc(mobRef);
      if (snap.exists()) {
        setAssignment({ id: snap.id, ...(snap.data() as object) } as Assignment);
      }
      toast({
        title: 'ข้าม Pre-Mob แล้ว',
        description: 'ไม่มีวัน Pre-Mob — ไปขั้น Mob ได้',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ variant: 'destructive', title: 'ข้าม Pre-Mob ไม่สำเร็จ', description: msg });
    } finally {
      setClearanceSavingStep(0);
    }
  };

  /** ไม่มี Mob — ไม่บันทึกวัน M1 · ตารางเวลาจะเริ่มที่วันทำงานเลย */
  const runSkipMob = async () => {
    if (!firestore || !assignment || !currentUser?.id || !canEditMobilization) return;
    const gate = canSaveFinalClearanceMob(assignment, {
      drugOk: mobDrugOk,
      drugMessage: MOB_DRUG_TEST_GATE_MESSAGE_TH,
      travelReady,
    });
    if (!gate.ok) {
      toast({ variant: 'destructive', title: 'ยังทำขั้นนี้ไม่ได้', description: gate.message });
      return;
    }
    setClearanceSavingStep(2);
    try {
      const now = Date.now();
      const mobRef = doc(firestore, 'mobilizations', id);
      await updateDoc(mobRef, {
        mobMobSkipped: true,
        mobStandbyRecordedAt: now,
        mobStandbyRecordedByUserId: currentUser.id,
        mobStandbyDate: deleteField(),
        mobStandbyDayEventType: deleteField(),
        mobStep2Choice: deleteField(),
        mobStep2BillingCharge: deleteField(),
        mobStep2PayrollCharge: deleteField(),
        updatedAt: now,
      });
      const snap = await getDoc(mobRef);
      if (snap.exists()) {
        setAssignment({ id: snap.id, ...(snap.data() as object) } as Assignment);
      }
      toast({
        title: 'ข้าม Mob แล้ว',
        description: 'ไม่มีวัน M1 — ไปขั้น Start working day ได้เลย · ตารางเวลาจะเริ่มที่วันทำงาน',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ variant: 'destructive', title: 'ข้าม Mob ไม่สำเร็จ', description: msg });
    } finally {
      setClearanceSavingStep(0);
    }
  };

  const openPreMobChargeConfig = (choice: MobStep2Choice) => {
    if (choice === 'PRE_MOB') {
      void runSavePreMob();
      return;
    }
    setStep2ChoiceDraft(choice);
    const defaults = defaultMobDayCharges(choice);
    const existingBilling =
      assignment?.mobStep2Choice === choice && assignment.mobStep2BillingCharge
        ? normalizeMobDayChargeSpec(assignment.mobStep2BillingCharge)
        : defaults.billing;
    const existingPayroll =
      assignment?.mobStep2Choice === choice && assignment.mobStep2PayrollCharge
        ? normalizeMobDayChargeSpec(assignment.mobStep2PayrollCharge)
        : defaults.payroll;
    setBillingChargeDraft(existingBilling);
    setPayrollChargeDraft(existingPayroll);
    setPreMobConfigOpen(true);
  };

  const runFinalClearanceStep2 = async (
    choice: MobStep2Choice,
    billingCharge: MobDayChargeSpec,
    payrollCharge: MobDayChargeSpec,
  ) => {
    if (!firestore || !assignment || !currentUser?.id || !po) return;
    const ymd = (standbyDateDraft || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      toast({ variant: 'destructive', title: 'วันที่ไม่ถูกต้อง', description: 'เลือกวัน Mob (รูปแบบ yyyy-mm-dd)' });
      return;
    }
    const editing = clearanceEditMode === 2;
    const gate = canSaveFinalClearanceMob(assignment, {
      editingExisting: editing,
      drugOk: mobDrugOk,
      drugMessage: MOB_DRUG_TEST_GATE_MESSAGE_TH,
      travelReady,
    });
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
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'ต้องมีสิทธิ์แก้ไข Timesheets เพื่อบันทึกลงตารางรายวัน' });
      return;
    }
    /** Mob = ตามค่าที่เลือก (มาตรฐาน M1) — Pre-Mob บันทึกแยกผ่าน runSavePreMob */
    const dayKind = mobStep2ChoiceToLegacyEventType(choice === 'PRE_MOB' ? 'MOB' : choice);
    const mobChoice: MobStep2Choice = 'MOB';
    const billing = normalizeMobDayChargeSpec(billingCharge);
    const payroll = normalizeMobDayChargeSpec(payrollCharge);
    setPreMobConfigOpen(false);
    setClearanceSavingStep(2);
    const statusCode = mobStandbyMobDayStatusCode(dayKind)!;
    const kindLabel = mobStep2ChoiceLabel(mobChoice);
    try {
      const prevStandby = (assignment.mobStandbyDate || '').trim();
      if (editing && prevStandby && /^\d{4}-\d{2}-\d{2}$/.test(prevStandby) && prevStandby !== ymd) {
        await deleteDraftMobFinalClearanceTimesheetsInRange(firestore, assignment.workerId, assignment.id, prevStandby, prevStandby);
      }
      if (editing && /^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
        await deleteDraftMobFinalClearanceTimesheetsInRange(firestore, assignment.workerId, assignment.id, ymd, ymd);
      }
      await upsertMobClearanceDailyTimesheet(firestore, currentUser as AppUser, {
        assignment,
        po,
        line,
        workerDisplayName: workerTimesheetName || assignment.workerId,
        kind: dayKind,
        dateYmd: ymd,
        bypassPoMonthLock: true,
        billingCharge: billing,
        payrollCharge: payroll,
        remarkOverride: `Mob — Final clearance · Mob · วางบิล ${formatMobDayChargeSummary(billing)} · จ่าย ${formatMobDayChargeSummary(payroll)}`,
      });
      const now = Date.now();
      patchMobilization({
        mobStandbyDate: ymd,
        mobStandbyDayEventType: dayKind,
        mobStep2Choice: mobChoice,
        mobStep2BillingCharge: billing,
        mobStep2PayrollCharge: payroll,
        mobStandbyRecordedAt: now,
        mobStandbyRecordedByUserId: currentUser.id,
        mobilizationStatus: 'MOBILIZING',
        deploymentStatus: 'MOBILIZING',
      });
      setWorkingStartDateDraft((cur) => cur || addDaysToYmd(ymd, 1));
      setClearanceEditMode(0);
      toast({
        title: editing ? `แก้ไขวัน ${kindLabel} แล้ว` : `บันทึก ${kindLabel} (${statusCode}) แล้ว`,
        description: `วันที่ ${ymd} · วางบิล ${formatMobDayChargeSummary(billing)} · จ่าย ${formatMobDayChargeSummary(payroll)}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ variant: 'destructive', title: 'บันทึกไม่สำเร็จ', description: msg });
    } finally {
      setClearanceSavingStep(0);
    }
  };

  const runFinalClearanceStep3 = async () => {
    if (!firestore || !assignment || !currentUser?.id || !po) return;
    const mobSkipped = assignment.mobMobSkipped === true;
    const standbyYmd = (assignment.mobStandbyDate || '').trim();
    const hasStandby = /^\d{4}-\d{2}-\d{2}$/.test(standbyYmd);
    const workYmd = (workingStartDateDraft || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workYmd)) {
      toast({ variant: 'destructive', title: 'วันที่ไม่ถูกต้อง', description: 'เลือกวันเริ่มทำงาน' });
      return;
    }
    if (!hasStandby && !mobSkipped) {
      toast({ variant: 'destructive', title: 'ยังไม่มีวัน Mob', description: 'บันทึกขั้นที่ 4 หรือกด «ไม่มี Mob» ก่อน' });
      return;
    }
    if (hasStandby && workYmd <= standbyYmd) {
      toast({
        variant: 'destructive',
        title: 'วันเริ่มงานไม่ถูกต้อง',
        description: 'ต้องเลือกวันที่หลังวัน Mob — ช่วงว่างจะถูกบันทึกเป็น Standby อัตโนมัติ',
      });
      return;
    }
    const editing = clearanceEditMode === 3;
    const gate = canSaveFinalClearanceWorkStart(assignment, {
      editingExisting: editing,
      drugOk: mobDrugOk,
      drugMessage: MOB_DRUG_TEST_GATE_MESSAGE_TH,
    });
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
          if (hasStandby) {
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
          } else {
            await deleteDraftMobFinalClearanceTimesheetsInRange(
              firestore,
              assignment.workerId,
              assignment.id,
              oldW,
              oldW,
            );
          }
        }
      }

      if (hasStandby) {
        await applyMobFinalClearanceWorkStartFill(firestore, currentUser as AppUser, {
          assignment,
          po,
          line,
          workerDisplayName: workerTimesheetName || assignment.workerId,
          standbyYmd,
          workYmd,
        });
      } else {
        // ไม่มี Mob — บันทึกเฉพาะวันทำงานวันแรก ไม่เติมช่วง Standby
        await upsertMobClearanceDailyTimesheet(firestore, currentUser as AppUser, {
          assignment,
          po,
          line,
          workerDisplayName: workerTimesheetName || assignment.workerId,
          kind: 'work_day',
          dateYmd: workYmd,
          bypassPoMonthLock: true,
        });
      }

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
      if (firestore && assignment.workerId && assignment.customerId) {
        void ensureWorkerAssignedCustomerId(firestore, assignment.workerId, assignment.customerId).catch((e) =>
          console.error('[mob] assignedCustomerIds', e),
        );
      }
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
    if (isFinalClearanceMobDone(assignment)) {
      toast({
        variant: 'destructive',
        title: 'แก้สถานที่ไม่ได้',
        description: 'บันทึก Mob แล้ว — ไม่สามารถเปลี่ยนสถานที่ปฏิบัติงานได้',
      });
      return;
    }
    const custom = locationCustomDraft.trim();
    if (!custom) {
      toast({ variant: 'destructive', title: 'ระบุสถานที่', description: 'กรอกข้อความสถานที่ปฏิบัติงานก่อนบันทึก' });
      return;
    }
    setLocationSaving(true);
    try {
      const now = Date.now();
      const patch: Record<string, unknown> = {
        mobLocationKey: `custom:${custom.slice(0, 200)}`,
        workLocation: custom.slice(0, 500),
        workLocationUpdatedAt: now,
        workLocationUpdatedByUserId: currentUser.id,
        mobLocationPhase: 'location_selected',
      };
      if (isTravelReadyDisplay(assignment, mobDrugOk) && !isFinalClearanceStep1Done(assignment)) {
        const today = thailandTodayYmd();
        patch.mobReadyToTravelDate = today;
        patch.mobReadyToTravelAt = now;
        patch.mobReadyToTravelByUserId = currentUser.id;
        patch.mobilizationStatus = 'READY_TO_MOBILIZE';
        patch.deploymentStatus = 'READY_TO_MOB';
      }
      patchMobilization(patch);
      setLocationEditing(false);
      toast({
        title: 'บันทึกสถานที่แล้ว',
        description:
          isTravelReadyDisplay(assignment, mobDrugOk) && !isFinalClearanceStep1Done(assignment)
            ? `${custom} · พร้อมเดินทาง (READY_TO_MOB)`
            : custom,
      });
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
  const mobReturnPath = `/mobilization/${encodeURIComponent(assignment.id)}`;
  const workerManageHref = (tab: string) =>
    `/workers/${encodeURIComponent(workerId)}?tab=${encodeURIComponent(tab)}&returnTo=${encodeURIComponent(mobReturnPath)}`;

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
      <div className="w-full space-y-6">
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

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,48rem)_minmax(0,1fr)] gap-6">
          <div className="space-y-6">
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
                          <TableCell className="font-medium text-sm">
                            ผลตรวจสารเสพติด (Drug test)
                            <span className="block text-[10px] font-normal text-muted-foreground">
                              ผลตรวจใหม่ต้อง NEGATIVE และ Valid ภายใน 10 วันหลังวันตรวจ — ตรวจซ้ำผ่านแล้วสามารถ mob ได้
                            </span>
                          </TableCell>
                          <TableCell className="text-left capitalize text-xs">
                            {drugTestChecklistStatus === 'pass'
                              ? 'pass'
                              : drugTestChecklistStatus === 'fail'
                                ? 'fail'
                                : drugTestChecklistStatus === 'missing'
                                  ? 'missing (หมดอายุหรือยังไม่ครบ — ต้องตรวจซ้ำก่อนลง)'
                                  : drugTestChecklistStatus}
                          </TableCell>
                          <TableCell className="text-right p-2">
                            <Button variant="ghost" size="icon" className="h-8 w-8" asChild title="เปิดทะเบียน — สารเสพติด">
                              <Link href={workerManageHref('drug')}>
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
                            แก้ขั้นที่ {clearanceEditMode === 2 ? 4 : 5} — บันทึกใหม่เมื่อแก้เสร็จ หรือกด «ยกเลิกการแก้ไข»
                          </AlertDescription>
                        </Alert>
                      ) : null}

                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-xs font-bold text-muted-foreground uppercase">ขั้น 1 · สถานะความพร้อมเดินทาง</p>
                          {travelReady ? (
                            <Badge className="bg-green-600 hover:bg-green-600 text-white">พร้อมเดินทาง</Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="border-amber-500 bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
                            >
                              ยังไม่พร้อมเดินทาง
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          ต้องผ่าน checklist 1–4: พาส/บัตร · แพทย์ · ใบเซอร์ · สารเสพติด
                          {!travelReady ? (
                            <span className="block mt-1 text-amber-800 dark:text-amber-200">
                              {[
                                assignment.readinessSummary?.passportValid !== 'pass' ? 'พาส/บัตร' : null,
                                assignment.readinessSummary?.medicalValid !== 'pass' ? 'แพทย์' : null,
                                assignment.readinessSummary?.certificatesComplete !== 'pass' ? 'ใบเซอร์' : null,
                                !mobDrugOk ? 'สารเสพติด' : null,
                              ]
                                .filter(Boolean)
                                .join(' · ') || 'ตรวจ checklist'}
                              {' '}ยังไม่ผ่าน
                            </span>
                          ) : isFinalClearanceStep1Done(assignment) ? (
                            <span className="block mt-1">
                              stamp READY_TO_MOB แล้ว
                              {assignment.mobReadyToTravelAt
                                ? ` · ${formatDateTimeThaiBE(assignment.mobReadyToTravelAt)}`
                                : ''}
                            </span>
                          ) : null}
                        </p>
                      </div>

                      <Separator />

                      <div className="space-y-2">
                        <p className="text-xs font-bold text-muted-foreground uppercase">ขั้น 2 · กรุณาระบุสถานที่ที่จะ MOB งานนี้</p>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <Input
                            className="h-11 flex-1 min-w-0"
                            value={locationCustomDraft}
                            onChange={(e) => setLocationCustomDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                void saveMobLocation();
                              }
                            }}
                            placeholder="เช่น Rig A / ฐานส่งตัว"
                            disabled={
                              !locationEditing ||
                              !canEditMobilization ||
                              isMobUnassigned(assignment) ||
                              isFinalClearanceMobDone(assignment) ||
                              locationSaving
                            }
                          />
                          <Button
                            type="button"
                            variant="outline"
                            className="h-11 w-36 shrink-0"
                            disabled={
                              locationEditing ||
                              !canEditMobilization ||
                              isMobUnassigned(assignment) ||
                              isFinalClearanceMobDone(assignment) ||
                              locationSaving
                            }
                            onClick={() => setLocationEditing(true)}
                          >
                            <Pencil className="h-4 w-4 mr-1" />
                            แก้ไข
                          </Button>
                          <Button
                            type="button"
                            className="h-11 w-36 shrink-0"
                            disabled={
                              !locationEditing ||
                              !canEditMobilization ||
                              isMobUnassigned(assignment) ||
                              isFinalClearanceMobDone(assignment) ||
                              locationSaving ||
                              !locationCustomDraft.trim()
                            }
                            onClick={() => void saveMobLocation()}
                          >
                            {locationSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'บันทึก'}
                          </Button>
                        </div>
                        {(assignment.workLocation || '').trim() ? (
                          <p className="text-xs text-muted-foreground">
                            ปัจจุบัน: <strong>{assignment.workLocation}</strong>
                          </p>
                        ) : (
                          <p className="text-xs text-amber-800 dark:text-amber-200">
                            ยังไม่บันทึกสถานที่ — ต้องบันทึกก่อน Pre-Mob / Mob
                          </p>
                        )}
                      </div>

                      <Separator />

                      <div className="space-y-2">
                        <p className="text-xs font-bold text-muted-foreground uppercase">ขั้น 3 · เลือกวัน PRE-MOB</p>
                        {assignment.poLineId && !primaryPoLine ? (
                          <p className="text-xs text-amber-800 dark:text-amber-200">กำลังโหลดบรรทัด PO…</p>
                        ) : null}
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <DatePickerThaiBE
                            className="h-11 flex-1 min-w-0"
                            value={htmlDateValueToTimestampMs(preMobDateDraft)}
                            onChange={(ms) => {
                              const v = timestampToHtmlDateValue(ms);
                              setPreMobDateDraft(v);
                              if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
                                // Mob = Pre-Mob + 1 · Start work day = Mob + 1 (ปรับเองภายหลังได้)
                                if (!isFinalClearanceMobDone(assignment)) {
                                  setStandbyDateDraft(addDaysToYmd(v, 1));
                                }
                                if (!isFinalClearanceStep3Done(assignment)) {
                                  setWorkingStartDateDraft(addDaysToYmd(v, 2));
                                }
                              }
                            }}
                            disabled={
                              !canEditMobilization ||
                              isMobUnassigned(assignment) ||
                              clearanceSavingStep !== 0 ||
                              isFinalClearancePreMobDone(assignment) ||
                              isFinalClearanceMobDone(assignment)
                            }
                          />
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex shrink-0">
                                <Button
                                  variant="outline"
                                  className="border-amber-600 text-amber-800 h-11 w-36"
                                  disabled={
                                    !canEditMobilization ||
                                    isMobUnassigned(assignment) ||
                                    clearanceSavingStep !== 0 ||
                                    !primaryPoLine ||
                                    isFinalClearancePreMobDone(assignment) ||
                                    !preMobSaveGate.ok
                                  }
                                  onClick={() => openPreMobChargeConfig('PRE_MOB')}
                                >
                                  {clearanceSavingStep === 2 ? (
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  ) : (
                                    <Truck className="h-4 w-4 mr-2" />
                                  )}
                                  Pre-Mob
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-sm text-xs leading-relaxed">
                              {isFinalClearancePreMobDone(assignment)
                                ? 'บันทึก / ข้าม Pre-Mob แล้ว'
                                : !preMobSaveGate.ok
                                  ? preMobSaveGate.message
                                  : 'บันทึก SB 8 ชม. ในตารางรายวันทันที'}
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex shrink-0">
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="h-11 w-36"
                                  disabled={
                                    !canEditMobilization ||
                                    isMobUnassigned(assignment) ||
                                    clearanceSavingStep !== 0 ||
                                    isFinalClearancePreMobDone(assignment) ||
                                    !preMobSaveGate.ok
                                  }
                                  onClick={() => void runSkipPreMob()}
                                >
                                  ไม่มี Pre-Mob
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-sm text-xs leading-relaxed">
                              {isFinalClearancePreMobDone(assignment)
                                ? 'บันทึก / ข้าม Pre-Mob แล้ว'
                                : !preMobSaveGate.ok
                                  ? preMobSaveGate.message
                                  : 'ข้ามวัน Pre-Mob — ไปขั้น Mob ได้เลย'}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        {isFinalClearancePreMobDone(assignment) ? (
                          <p className="text-sm">
                            {assignment.mobPreMobSkipped ? (
                              <>ข้าม Pre-Mob แล้ว · {formatDateTimeThaiBE(assignment.mobPreMobRecordedAt)}</>
                            ) : (
                              <>
                                บันทึกแล้ว — วันที่ {formatYmdLocalThaiBE(assignment.mobPreMobDate)} · SB 8 ชม. ·{' '}
                                {formatDateTimeThaiBE(assignment.mobPreMobRecordedAt)}
                              </>
                            )}
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Pre-Mob = SB 8 ชม. · หรือกด «ไม่มี Pre-Mob» หากไม่ต้องการวัน Standby ·
                            เลือกวันแล้วระบบตั้งวัน Mob = +1 และวันเริ่มงาน = +2 ให้อัตโนมัติ
                          </p>
                        )}
                      </div>

                      <Separator />

                      <div className="space-y-2">
                        <p className="text-xs font-bold text-muted-foreground uppercase">ขั้น 4 · Mob</p>
                        {assignment.poLineId && !primaryPoLine ? (
                          <p className="text-xs text-amber-800 dark:text-amber-200">กำลังโหลดบรรทัด PO…</p>
                        ) : null}
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <DatePickerThaiBE
                            className="h-11 flex-1 min-w-0"
                            value={htmlDateValueToTimestampMs(standbyDateDraft)}
                            onChange={(ms) => {
                              const v = timestampToHtmlDateValue(ms);
                              setStandbyDateDraft(v);
                              if (/^\d{4}-\d{2}-\d{2}$/.test(v) && !isFinalClearanceStep3Done(assignment)) {
                                // Start work day = Mob + 1 (ปรับเองภายหลังได้)
                                setWorkingStartDateDraft(addDaysToYmd(v, 1));
                              }
                            }}
                            disabled={
                              !canEditMobilization ||
                              isMobUnassigned(assignment) ||
                              clearanceSavingStep !== 0 ||
                              (isFinalClearanceMobDone(assignment) && clearanceEditMode !== 2)
                            }
                          />
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex shrink-0">
                                <Button
                                  variant="outline"
                                  className="border-blue-600 text-blue-700 h-11 w-36"
                                  disabled={
                                    !canEditMobilization ||
                                    isMobUnassigned(assignment) ||
                                    clearanceSavingStep !== 0 ||
                                    !primaryPoLine ||
                                    (isFinalClearanceMobDone(assignment) && clearanceEditMode !== 2) ||
                                    !mobSaveGate.ok
                                  }
                                  onClick={() => openPreMobChargeConfig('MOB')}
                                >
                                  {clearanceSavingStep === 2 ? (
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  ) : (
                                    <Truck className="h-4 w-4 mr-2" />
                                  )}
                                  {clearanceEditMode === 2 ? 'Mob (แก้ไข)' : 'Mob'}
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-sm text-xs leading-relaxed">
                              {clearanceEditMode === 2
                                ? 'แก้ค่าวางบิล/จ่ายลูกจ้างแล้วบันทึกวัน Mob ใหม่'
                                : isFinalClearanceMobDone(assignment)
                                  ? 'บันทึกแล้ว — ใช้ปุ่มแก้ไขหากต้องการเปลี่ยนวันที่'
                                  : !mobSaveGate.ok
                                    ? mobSaveGate.message
                                    : 'เปิดหน้าต่างกำหนดค่า M1 แล้วบันทึก · ต้องทำ Pre-Mob หรือข้ามก่อน'}
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex shrink-0">
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="h-11 w-36"
                                  disabled={
                                    !canEditMobilization ||
                                    isMobUnassigned(assignment) ||
                                    clearanceSavingStep !== 0 ||
                                    isFinalClearanceMobDone(assignment) ||
                                    !mobSaveGate.ok
                                  }
                                  onClick={() => void runSkipMob()}
                                >
                                  ไม่มี Mob
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-sm text-xs leading-relaxed">
                              {isFinalClearanceMobDone(assignment)
                                ? 'บันทึก / ข้าม Mob แล้ว'
                                : !mobSaveGate.ok
                                  ? mobSaveGate.message
                                  : 'ข้ามวัน Mob — ไม่บันทึกวัน M1 · ตารางเวลาเริ่มที่วันทำงานเลย'}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        {isFinalClearanceMobDone(assignment) ? (
                          <div className="space-y-1 text-sm">
                            {assignment.mobMobSkipped ? (
                              <p>
                                ข้าม Mob แล้ว — ไม่มีวัน M1 · ตารางเวลาเริ่มที่วันทำงานเลย ·{' '}
                                {formatDateTimeThaiBE(assignment.mobStandbyRecordedAt)}
                              </p>
                            ) : (
                              <p>
                                บันทึกแล้ว — วันที่ {formatYmdLocalThaiBE(assignment.mobStandbyDate)} ·{' '}
                                {assignment.mobStep2Choice
                                  ? mobStep2ChoiceLabel(assignment.mobStep2Choice)
                                  : mobStandbyMobDayChoiceLabel(assignment.mobStandbyDayEventType ?? 'mobilization_day')}{' '}
                                ({mobStandbyMobDayStatusCode(assignment.mobStandbyDayEventType) ?? 'MO'}) ·{' '}
                                {formatDateTimeThaiBE(assignment.mobStandbyRecordedAt)}
                              </p>
                            )}
                            {assignment.mobStep2BillingCharge || assignment.mobStep2PayrollCharge ? (
                              <p className="text-xs text-muted-foreground">
                                วางบิล {formatMobDayChargeSummary(assignment.mobStep2BillingCharge)} · จ่ายลูกจ้าง{' '}
                                {formatMobDayChargeSummary(assignment.mobStep2PayrollCharge)}
                                <span className="text-muted-foreground/80"> — ใช้เฉพาะคนนี้ในงานนี้</span>
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Mob = วัน M1 (MO) · หรือกด «ไม่มี Mob» หากไม่ต้องการวันเดินทาง — ตารางเวลาจะเริ่มที่วันทำงานเลย
                          </p>
                        )}
                        {(isFinalClearanceMobDone(assignment) && !assignment.mobMobSkipped && clearanceEditMode !== 2) ||
                        clearanceEditMode === 2 ? (
                          <div className="flex flex-wrap items-center gap-2">
                            {isFinalClearanceMobDone(assignment) && !assignment.mobMobSkipped && clearanceEditMode !== 2 ? (
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
                        ) : null}
                      </div>

                      <Separator />

                      <div className="space-y-2">
                        <p className="text-xs font-bold text-muted-foreground uppercase">ขั้น 5 · Start working day</p>
                        {assignment.poLineId && !primaryPoLine ? (
                          <p className="text-xs text-amber-800 dark:text-amber-200">กำลังโหลดบรรทัด PO…</p>
                        ) : null}
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <DatePickerThaiBE
                            className="h-11 flex-1 min-w-0"
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
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex shrink-0">
                                <Button
                                  className="bg-blue-900 hover:bg-blue-950 h-11 w-[18.5rem]"
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
                                ? 'บันทึกใหม่ — ช่วงระหว่างวัน Mob กับวันเริ่มงานจะเป็น Standby อัตโนมัติ · ต่อเนื่องต้นเดือน (ถ้ามี)'
                                : isFinalClearanceStep3Done(assignment)
                                  ? 'เริ่มวันทำงานแล้ว — ใช้ปุ่มแก้ไขหากต้องการเปลี่ยนวันที่'
                                  : !step3SaveGate.ok
                                    ? step3SaveGate.message
                                    : 'วันเริ่มงานต้องหลังวัน Mob — ระบบจะเติมวัน Standby ในช่วงว่างอัตโนมัติ · ถ้าต่อจากเดือนก่อนจะเติมวันทำงานต้นเดือนจนถึงก่อนวัน Mob'}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        {isFinalClearanceStep3Done(assignment) ? (
                          <p className="text-sm">
                            เริ่มแล้ว — วันที่ {formatYmdLocalThaiBE(assignment.mobWorkingStartDate)} ·{' '}
                            {formatDateTimeThaiBE(assignment.mobWorkingStartedAt)}
                          </p>
                        ) : null}
                        {(isFinalClearanceStep3Done(assignment) && clearanceEditMode !== 3) || clearanceEditMode === 3 ? (
                          <div className="flex flex-wrap items-center gap-2">
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
                        ) : null}
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
                          className="h-11 w-[18.5rem] shrink-0"
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
              </TabsContent>

              <TabsContent value="docs" className="mt-6 space-y-6">
                <Card>
                  <CardHeader><CardTitle className="text-base">ใบรับรองและเอกสารที่เกี่ยวข้อง (Compliance Proofs)</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {workerCerts?.length ? (
                        workerCerts.map((cert) => (
                          <button
                            key={cert.id}
                            type="button"
                            className="flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors hover:bg-muted/30"
                            onClick={() => setViewingCert(cert)}
                          >
                            <div className="flex items-center gap-3">
                              <div className="rounded bg-blue-100 p-2 text-blue-700">
                                <FileText className="h-4 w-4" />
                              </div>
                              <div>
                                <p className="text-sm font-bold">{cert.certificateName}</p>
                                <p className="text-[10px] text-muted-foreground">
                                  หมดอายุ: {formatDateThaiBE(cert.expiryDate)}
                                  {cert.attachment?.downloadUrl ? ' · กดเพื่อดูเอกสาร' : ' · ยังไม่มีไฟล์แนบ'}
                                </p>
                              </div>
                            </div>
                            <Badge
                              variant={cert.status === 'valid' ? 'outline' : 'destructive'}
                              className={cert.status === 'valid' ? 'text-green-600 border-green-200' : ''}
                            >
                              {cert.status.toUpperCase()}
                            </Badge>
                          </button>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">ยังไม่มีใบรับรองในทะเบียน</p>
                      )}
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
                      <Link href={`/workers/${worker.id}?returnTo=${encodeURIComponent(mobReturnPath)}`}>
                        ดูประวัติคนงานแบบเต็ม <ChevronRight className="h-3 w-3 ml-1" />
                      </Link>
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

            <Card className="border-blue-200 bg-blue-50/80 text-blue-950">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Info className="h-4 w-4 shrink-0" />
                  Final clearance — 5 ขั้น (เฟส 3 · PO workflow)
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2 pt-0">
                <ol className="list-decimal pl-4 space-y-1.5">
                  <li>
                    <strong>พร้อมเดินทาง</strong> — แสดงผลจาก checklist 1–4 (พาส/บัตร · แพทย์ · ใบเซอร์ · สารเสพติด)
                  </li>
                  <li>
                    <strong>สถานที่</strong> — ระบุไซต์ปฏิบัติงาน · ถ้าพร้อมเดินทางจะ stamp{' '}
                    <span className="font-mono">READY_TO_MOB</span> อัตโนมัติ
                  </li>
                  <li>
                    <strong>Pre-Mob</strong> — SB 8 ชม. หรือกด «ไม่มี Pre-Mob»
                  </li>
                  <li>
                    <strong>Mob</strong> — วัน M1 (แก้ค่าวางบิล/จ่ายได้) →{' '}
                    <span className="font-mono">MOBILIZING</span> · หรือกด «ไม่มี Mob» — ตารางเวลาเริ่มที่วันทำงานเลย
                  </li>
                  <li>
                    <strong>Start working day</strong> — ค่าเริ่มต้น = วันรุ่งขึ้นหลัง Mob →{' '}
                    <span className="font-mono">ACTIVE</span>
                  </li>
                </ol>
                <p className="text-xs text-blue-900/90">
                  ห้ามข้ามขั้น — ถ้ากดเมื่อยังไม่ครบขั้นก่อนหน้า ระบบจะแจ้งเตือนและไม่บันทึก · ขั้น 3–5 จะเขียนลง{' '}
                  <span className="font-mono">daily_timesheets</span> ทันที (ไม่เขียนลงงวด PO+เดือนที่ล็อกแล้ว)
                </p>
              </CardContent>
            </Card>

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
                          แนะนำให้ทำขั้น 5 «Start working day» ให้ครบก่อนลงเวลา
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
          </div>
        </div>
      </div>


      <Dialog
        open={!!viewingCert}
        onOpenChange={(open) => {
          if (!open) setViewingCert(null);
        }}
      >
        <DialogContent className="!flex max-h-[90vh] max-w-4xl flex-col gap-3 overflow-hidden">
          <DialogHeader className="pr-8">
            <DialogTitle>{viewingCert?.certificateName || 'เอกสารใบรับรอง'}</DialogTitle>
            <DialogDescription>
              {viewingCert
                ? `หมดอายุ: ${formatDateThaiBE(viewingCert.expiryDate)}${
                    viewingCert.certificateNo ? ` · เลขที่ ${viewingCert.certificateNo}` : ''
                  }`
                : null}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/20">
            {viewingCert?.attachment?.downloadUrl ? (
              isPdfAttachment(viewingCert.attachment) ? (
                <iframe
                  ref={certPreviewIframeRef}
                  src={viewingCert.attachment.downloadUrl}
                  title={viewingCert.certificateName}
                  className="h-[min(70vh,720px)] w-full border-0"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={viewingCert.attachment.downloadUrl}
                  alt={viewingCert.certificateName}
                  className="mx-auto max-h-[min(70vh,720px)] w-auto max-w-full object-contain p-2"
                />
              )
            ) : (
              <div className="flex h-48 items-center justify-center px-4 text-center text-sm text-muted-foreground">
                ยังไม่มีไฟล์แนบสำหรับใบรับรองนี้ — ไปอัปโหลดที่ทะเบียนคนงาน
              </div>
            )}
          </div>

          <DialogFooter className="sm:justify-between">
            <Button
              type="button"
              variant="secondary"
              disabled={!viewingCert?.attachment?.downloadUrl}
              onClick={() => {
                const url = viewingCert?.attachment?.downloadUrl;
                if (!url || !viewingCert) return;
                const title = viewingCert.certificateName || 'certificate';
                const isPdf = isPdfAttachment(viewingCert.attachment);
                if (isPdf) {
                  const frame = certPreviewIframeRef.current;
                  try {
                    frame?.contentWindow?.focus();
                    frame?.contentWindow?.print();
                    return;
                  } catch {
                    /* cross-origin — fall through */
                  }
                  const w = window.open(url, '_blank', 'noopener,noreferrer');
                  if (!w) {
                    toast({
                      variant: 'destructive',
                      title: 'เปิดหน้าต่างพิมพ์ไม่ได้',
                      description: 'อนุญาต pop-up แล้วลองอีกครั้ง หรือเปิดเอกสารแล้วกด Ctrl+P',
                    });
                  }
                  return;
                }
                const w = window.open('', '_blank', 'noopener,noreferrer');
                if (!w) {
                  toast({
                    variant: 'destructive',
                    title: 'เปิดหน้าต่างพิมพ์ไม่ได้',
                    description: 'อนุญาต pop-up แล้วลองอีกครั้ง',
                  });
                  return;
                }
                w.document.write(
                  `<!DOCTYPE html><html><head><title>${title.replace(/[<>&"]/g, '')}</title>` +
                    '<style>html,body{margin:0;padding:0}img{display:block;max-width:100%;height:auto;margin:0 auto}' +
                    '@media print{html,body{margin:0}}</style></head><body>' +
                    `<img src="${url}" alt="" onload="window.focus();window.print()" />` +
                    '</body></html>',
                );
                w.document.close();
              }}
            >
              <Printer className="mr-2 h-4 w-4" />
              พิมพ์
            </Button>
            <Button type="button" variant="outline" onClick={() => setViewingCert(null)}>
              ปิด
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={preMobConfigOpen}
        onOpenChange={(open) => {
          if (!open && clearanceSavingStep !== 2) setPreMobConfigOpen(false);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              กำหนดค่า {mobStep2ChoiceLabel(step2ChoiceDraft)} — วางบิล / จ่ายลูกจ้าง
            </DialogTitle>
            <DialogDescription>
              ใช้เฉพาะคนนี้ในงานนี้ · ค่าเริ่มต้น{' '}
              M1 ตามตารางสัญญาทั้งสองฝั่ง — แก้ได้
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 text-sm">
            {(['billing', 'payroll'] as const).map((side) => {
              const draft = side === 'billing' ? billingChargeDraft : payrollChargeDraft;
              const setDraft = side === 'billing' ? setBillingChargeDraft : setPayrollChargeDraft;
              const title = side === 'billing' ? 'วางบิลลูกค้า' : 'จ่ายลูกจ้าง (payroll)';
              return (
                <div key={side} className="space-y-3 rounded-md border p-3">
                  <p className="font-semibold">{title}</p>
                  <div className="space-y-2">
                    <Label>รูปแบบ</Label>
                    <Select
                      value={draft.kind}
                      onValueChange={(v) => {
                        const kind = v as MobDayChargeKind;
                        if (kind === 'M1') setDraft({ kind: 'M1', m1AmountOverride: draft.m1AmountOverride });
                        else setDraft({ kind, hours: draft.hours && draft.hours > 0 ? draft.hours : 8 });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="STANDBY">{mobDayChargeKindLabel('STANDBY')}</SelectItem>
                        <SelectItem value="WORKING">{mobDayChargeKindLabel('WORKING')}</SelectItem>
                        <SelectItem value="M1">{mobDayChargeKindLabel('M1')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {draft.kind === 'STANDBY' || draft.kind === 'WORKING' ? (
                    <div className="space-y-2">
                      <Label>จำนวนชั่วโมง</Label>
                      <Input
                        type="number"
                        min={0.5}
                        max={24}
                        step={0.5}
                        value={draft.hours ?? 8}
                        onChange={(e) =>
                          setDraft({
                            kind: draft.kind,
                            hours: Number(e.target.value) || 0,
                          })
                        }
                      />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label>จำนวนเงิน M1 (บาท) — ว่าง = ตามตารางสัญญา</Label>
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        placeholder="ใช้ค่าสัญญา"
                        value={draft.m1AmountOverride ?? ''}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          if (!raw) {
                            setDraft({ kind: 'M1' });
                            return;
                          }
                          setDraft({ kind: 'M1', m1AmountOverride: Number(raw) });
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={clearanceSavingStep === 2}
              onClick={() => setPreMobConfigOpen(false)}
            >
              ยกเลิก
            </Button>
            <Button
              type="button"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={clearanceSavingStep === 2}
              onClick={() =>
                void runFinalClearanceStep2(step2ChoiceDraft, billingChargeDraft, payrollChargeDraft)
              }
            >
              {clearanceSavingStep === 2 ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              บันทึก {mobStep2ChoiceLabel(step2ChoiceDraft)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      <AlertDialog open={step2CascadeOpen} onOpenChange={setStep2CascadeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>แก้ไขวัน Mob หลังเริ่มงานแล้ว?</AlertDialogTitle>
            <AlertDialogDescription>
              ระบบจะย้อนขั้นที่ 5 (วันเริ่มทำงาน) และลบรายวันที่สร้างจาก Mob ในช่วงหลังวัน Mob จนถึงวันเริ่มงานเดิม (เฉพาะแถว Draft ที่มาจาก Final
              clearance) — จากนั้นให้บันทึก Mob และขั้นที่ 5 ใหม่
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
              ยืนยัน ย้อนขั้นที่ 5 และแก้ Mob
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
