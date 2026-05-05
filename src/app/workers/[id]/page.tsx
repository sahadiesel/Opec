'use client';

import { useState, use, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  Save,
  ArrowLeft,
  AlertTriangle,
  User,
  FileText,
  Stethoscope,
  AlertCircle,
  FileSearch,
  History,
  Info,
  Package,
  HardHat,
  Wrench,
} from 'lucide-react';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import { useFirestore, useDoc, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { doc, collection, query, where, getDocs, updateDoc } from 'firebase/firestore';
import {
  computeWorkerStoreEquipmentReadiness,
  MOBILIZATION_STATUSES_NOT_CLOSED,
} from '@/lib/store/mobilization-fulfillment';
import { updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { sanitizeFirestorePayload } from '@/lib/utils';
import {
  Worker,
  WorkerCertificate,
  WorkerMedicalRecord,
  WorkerDrugTest,
  WorkerDocument,
  DailyTimesheet,
  User as AppUser,
  Position,
  PositionCertificateRequirement,
  PositionPPERequirement,
  PositionToolRequirement,
  ReadinessStatus,
  WorkerDocumentCatalogItem,
  DrugTestPanelConfig,
  Assignment,
  WorkerStoreEquipmentReadiness,
} from '@/lib/types';
import {
  computeDrugPanelWorkerFields,
  DRUG_TEST_PANEL_DOC_PATH,
} from '@/lib/drug-test-panel';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { usePermissions } from '@/hooks/use-permissions';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccess, canView, isMatrixControlledRole } from '@/lib/permissions';
import { canViewWorkerLaborCostFromUser, canEditWorkerLaborCostFromUser } from '@/lib/payroll/labor-cost-model';
import { WorkerInfoTab } from './_components/worker-info-tab';
import { WorkerCertsTab } from './_components/worker-certs-tab';
import { WorkerMedicalTab } from './_components/worker-medical-tab';
import { WorkerDrugTab } from './_components/worker-drug-tab';
import { WorkerDocsTab } from './_components/worker-docs-tab';
import { WorkerWorklogTab } from './_components/worker-worklog-tab';
import { WorkerPositionStoreTab } from './_components/worker-position-store-tab';

const DAY_MS = 24 * 60 * 60 * 1000;

const WORKER_TAB_VALUES = [
  'info',
  'certs',
  'medical',
  'drug',
  'docs',
  'worklog',
  'ppe_list',
  'tools_list',
] as const;
type WorkerProfileTab = (typeof WORKER_TAB_VALUES)[number];

function isWorkerProfileTab(s: string | null): s is WorkerProfileTab {
  return s != null && (WORKER_TAB_VALUES as readonly string[]).includes(s);
}

function WorkerDetailContent({ id }: { id: string }) {
  const searchParams = useSearchParams();
  const tabFromUrl = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<WorkerProfileTab>(() =>
    isWorkerProfileTab(tabFromUrl) ? tabFromUrl : 'info',
  );
  useEffect(() => {
    const t = searchParams.get('tab');
    if (isWorkerProfileTab(t)) setActiveTab(t);
  }, [searchParams]);
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { user: firebaseUser, isUserLoading: authHydrationLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const useMatrixGuards = isMatrixControlledRole(currentUser);
  const canViewWorkerProfile = useMatrixGuards ? canAccess(currentUser, 'workers', 'view') : canView(currentUser, 'workers');

  /** ห้าม subscribe Firestore ก่อน Auth + โปรไฟล์พร้อม — ไม่งั้น rules จะ deny list (หน้า /workers รอแบบนี้อยู่แล้ว) */
  const dataLayerReady = Boolean(
    firestore &&
      !authHydrationLoading &&
      firebaseUser &&
      !userLoading &&
      currentUser &&
      canViewWorkerProfile,
  );

  // --- Data queries (unchanged) ---
  const workerRef = useMemoFirebase(
    () => (dataLayerReady ? doc(firestore!, 'workers', id) : null),
    [firestore, id, dataLayerReady],
  );
  const { data: worker, isLoading: isWorkerLoading } = useDoc<Worker>(workerRef as any);

  const certsQuery = useMemoFirebase(
    () => (dataLayerReady ? collection(firestore!, 'workers', id, 'certificates') : null),
    [firestore, id, dataLayerReady],
  );
  const { data: certs } = useCollection<WorkerCertificate>(certsQuery as any);

  const medicalsQuery = useMemoFirebase(
    () => (dataLayerReady ? collection(firestore!, 'workers', id, 'medical_records') : null),
    [firestore, id, dataLayerReady],
  );
  const { data: medicals } = useCollection<WorkerMedicalRecord>(medicalsQuery as any);

  const drugTestsQuery = useMemoFirebase(
    () => (dataLayerReady ? collection(firestore!, 'workers', id, 'drug_tests') : null),
    [firestore, id, dataLayerReady],
  );
  const { data: drugTests } = useCollection<WorkerDrugTest>(drugTestsQuery as any);

  const docsQuery = useMemoFirebase(
    () => (dataLayerReady ? collection(firestore!, 'workers', id, 'documents') : null),
    [firestore, id, dataLayerReady],
  );
  const { data: workerDocs } = useCollection<WorkerDocument>(docsQuery as any);

  const positionsQuery = useMemoFirebase(
    () => (dataLayerReady ? collection(firestore!, 'positions') : null),
    [firestore, dataLayerReady],
  );
  const { data: allPositions } = useCollection<Position>(positionsQuery as any);
  const workerDocCatalogQuery = useMemoFirebase(
    () => (dataLayerReady ? collection(firestore!, 'worker_document_catalog') : null),
    [firestore, dataLayerReady],
  );
  const { data: workerDocCatalog } = useCollection<WorkerDocumentCatalogItem>(workerDocCatalogQuery as any);

  const drugPanelRef = useMemoFirebase(
    () =>
      dataLayerReady ? doc(firestore!, DRUG_TEST_PANEL_DOC_PATH[0], DRUG_TEST_PANEL_DOC_PATH[1]) : null,
    [firestore, dataLayerReady],
  );
  const { data: drugPanelConfig } = useDoc<DrugTestPanelConfig>(drugPanelRef as any);
  const workerTimesheetsQuery = useMemoFirebase(
    () =>
      dataLayerReady
        ? query(collection(firestore!, 'daily_timesheets'), where('workerId', '==', id))
        : null,
    [firestore, id, dataLayerReady],
  );
  const { data: workerTimesheetsAll } = useCollection<DailyTimesheet>(workerTimesheetsQuery as any);

  const workerMobsQuery = useMemoFirebase(() => {
    if (!dataLayerReady) return null;
    return query(
      collection(firestore!, 'mobilizations'),
      where('workerId', '==', id),
      where('deploymentStatus', 'in', [...MOBILIZATION_STATUSES_NOT_CLOSED]),
    );
  }, [firestore, id, dataLayerReady]);
  const { data: workerMobilizations } = useCollection<Assignment>(workerMobsQuery as any);

  const panelSubstances = drugPanelConfig?.substances ?? [];

  // --- UI state ---
  const [isEditing, setIsEditing] = useState(false);
  const [editedWorker, setEditedWorker] = useState<Partial<Worker>>({});
  const [activateLoginBusy, setActivateLoginBusy] = useState(false);

  // --- Derived data (unchanged) ---
  const workerTimesheets = useMemo(() => {
    return workerTimesheetsAll || [];
  }, [workerTimesheetsAll]);

  const workLogRows = useMemo(() => {
    const grouped = new Map<string, { assignmentId: string; projectName: string; startDate: string; endDate: string; totalHours: number }>();
    workerTimesheets.forEach((ts) => {
      const key = ts.assignmentId || ts.id;
      const hours = Number(ts.normalHours || 0)
        + Number(ts.ot15Hours || 0)
        + Number(ts.ot20Hours || 0)
        + Number(ts.ot30Hours || 0)
        + Number(ts.holidayHours || 0);
      const row = grouped.get(key) || {
        assignmentId: ts.assignmentId || '-',
        projectName: ts.remark || '-',
        startDate: ts.date,
        endDate: ts.date,
        totalHours: 0,
      };
      row.projectName = ts.remark || row.projectName || '-';
      row.startDate = row.startDate < ts.date ? row.startDate : ts.date;
      row.endDate = row.endDate > ts.date ? row.endDate : ts.date;
      row.totalHours += hours;
      grouped.set(key, row);
    });
    return [...grouped.values()].sort((a, b) => b.totalHours - a.totalHours);
  }, [workerTimesheets]);

  const totalWorkedHours = useMemo(() => {
    return workLogRows.reduce((sum, row) => sum + Number(row.totalHours || 0), 0);
  }, [workLogRows]);

  const { payroll } = usePermissions(currentUser);
  const canEditWorker = useMatrixGuards ? canAccess(currentUser, 'workers', 'edit') : payroll('worker', 'edit');
  const canViewLaborCost = useMemo(() => canViewWorkerLaborCostFromUser(currentUser), [currentUser]);
  const canEditLaborCost = useMemo(
    () => canEditWorkerLaborCostFromUser(currentUser) && canEditWorker,
    [currentUser, canEditWorker],
  );

  const currentPositionForLabor = useMemo(() => {
    const pid = (isEditing ? editedWorker.currentPositionId : worker?.currentPositionId) || '';
    if (!pid || !allPositions?.length) return null;
    return allPositions.find((p) => p.id === pid) ?? null;
  }, [isEditing, editedWorker.currentPositionId, worker?.currentPositionId, allPositions]);

  // --- Business logic: save master (unchanged) ---
  const handleActivateWorkerLogin = async () => {
    if (!firebaseUser || !worker || !canEditWorker) return;
    const loginEmail = String(worker.email ?? '').trim().toLowerCase();
    if (!loginEmail.includes('@')) {
      toast({
        variant: 'destructive',
        title: 'อีเมลไม่ถูกต้อง',
        description: 'บันทึกอีเมลในทะเบียนให้ครบก่อน (โหมดแก้ไข → บันทึก)',
      });
      return;
    }
    if (isEditing) {
      toast({
        variant: 'destructive',
        title: 'บันทึกการแก้ไขก่อน',
        description: 'ออกจากโหมดแก้ไขและบันทึกข้อมูล แล้วจึงกดเปิดใช้อีเมลล็อกอิน',
      });
      return;
    }
    setActivateLoginBusy(true);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch('/api/workers/activate-login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ workerId: worker.id, loginEmail }),
      });
      let data: { error?: string } = {};
      try {
        data = (await res.json()) as { error?: string };
      } catch {
        data = {};
      }
      if (!res.ok) {
        toast({
          variant: 'destructive',
          title: 'เปิดใช้บัญชีไม่สำเร็จ',
          description: data.error || res.statusText,
        });
        return;
      }
      toast({
        title: 'เปิดใช้อีเมลล็อกอินแล้ว',
        description:
          'รหัสเริ่มต้น: opecopec — แนะนำให้พนักงานเข้า My Profile เพื่อเปลี่ยนรหัส หรือใช้ Forgot password ที่หน้าเข้าสู่ระบบ',
      });
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'เกิดข้อผิดพลาด',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setActivateLoginBusy(false);
    }
  };

  const handleSaveMaster = () => {
    if (!canEditWorker) {
      toast({
        variant: 'destructive',
        title: 'ไม่มีสิทธิ์แก้ไข',
        description: 'ทะเบียนคนงานแก้ได้เฉพาะ HR Manager / Admin ตามนโยบายสิทธิ์',
      });
      return;
    }
    if (!workerRef) return;
    const base: Partial<Worker> & { updatedAt: number } = { ...editedWorker, updatedAt: Date.now() };
    if (!canViewLaborCost) {
      delete base.laborCostUsePositionDefault;
      delete base.laborCostCustomOnshore;
      delete base.laborCostCustomOffshore;
    }
    const payload = sanitizeFirestorePayload(base);
    updateDoc(workerRef, payload)
      .then(() => {
        setIsEditing(false);
        calculateAndStoreReadiness();
        toast({ title: 'บันทึกสำเร็จ', description: 'ข้อมูลประวัติคนงานถูกอัปเดตแล้ว' });
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        toast({
          variant: 'destructive',
          title: 'บันทึกไม่สำเร็จ',
          description: msg.includes('permission') || msg.includes('Permission')
            ? 'สิทธิ์ไม่เพียงพอ (Firestore) — ต้องใช้บัญชี HR/Operations ที่อนุญาตแก้ไขทะเบียนคนงาน'
            : msg,
        });
      });
  };

  const handleReadinessManualHoldChange = (hold: boolean) => {
    if (!canEditWorker || !workerRef) {
      toast({
        variant: 'destructive',
        title: 'ไม่มีสิทธิ์แก้ไข',
        description: 'เฉพาะผู้มีสิทธิ์แก้ทะเบียนคนงานเท่านั้น',
      });
      return;
    }
    updateDocumentNonBlocking(workerRef, {
      readinessManualHold: hold,
      updatedAt: Date.now(),
    });
    toast({
      title: hold ? 'ตั้งเป็นไม่พร้อม (Unready)' : 'ตั้งเป็นพร้อม (Ready)',
      description: hold
        ? 'คนงานจะไม่ปรากฏในรายการมอบหมายจนกว่าจะเปิดสวิตช์พร้อมอีกครั้ง'
        : 'ระบบใช้เกณฑ์เอกสารและความพร้อมตามที่คำนวณได้',
    });
  };

  // --- Business logic: readiness calculation (unchanged) ---
  const calculateAndStoreReadiness = async () => {
    if (!firestore || !worker) return;

    let newStatus: ReadinessStatus = 'READY';
    const now = Date.now();
    const compliance = { level: 'ok' as 'ok' | 'warning' | 'blocked' };
    let nearestExpiryInDays: number | null = null;
    let nearestExpiryAt: number | null = null;
    const catalogByCode = new Map((workerDocCatalog || []).map((x) => [(x.itemCode || '').toLowerCase(), x]));
    const markExpiryByPolicy = (code: string, expiryDate?: number) => {
      const exp = Number(expiryDate || 0);
      if (exp <= 0) return;
      const remainingDays = Math.ceil((exp - now) / DAY_MS);
      const policy = catalogByCode.get((code || '').toLowerCase());
      const alertBefore = Number(policy?.alertBeforeExpiryDays || 0);
      const blockBefore = Number(policy?.blockBeforeExpiryDays || 0);
      if (nearestExpiryInDays === null || remainingDays < nearestExpiryInDays) {
        nearestExpiryInDays = remainingDays;
        nearestExpiryAt = exp;
      }
      if (blockBefore > 0 && remainingDays <= blockBefore) {
        compliance.level = 'blocked';
      } else if (compliance.level !== 'blocked' && alertBefore > 0 && remainingDays <= alertBefore) {
        compliance.level = 'warning';
      }
    };

    if (worker.currentPositionId) {
      const reqsRef = collection(firestore, 'positions', worker.currentPositionId, 'certificate_requirements');
      const reqsSnap = await getDocs(query(reqsRef, where('required', '==', true)));
      const mandatoryReqs = reqsSnap.docs.map(d => d.data() as PositionCertificateRequirement);

      for (const req of mandatoryReqs) {
        const reqType = req.requirementType || 'certificate';
        const requiresExpiry = req.hasExpiry ?? true;
        if (reqType === 'document') {
          const matchedDoc = workerDocs?.find((d) => (d.documentType || '').toLowerCase() === (req.certificateCode || '').toLowerCase());
          const hasDoc = !!matchedDoc && (!requiresExpiry || Number(matchedDoc.expiryDate || 0) > now);
          if (!hasDoc) {
            newStatus = 'MISSING_CERTIFICATE';
            break;
          }
          if (matchedDoc && requiresExpiry) {
            markExpiryByPolicy(req.certificateCode, Number(matchedDoc.expiryDate || 0));
          }
        } else {
          const certRecord = certs?.find((c) => c.certificateCode === req.certificateCode && c.status === 'valid');
          const hasCert = !!certRecord && (requiresExpiry ? certRecord.expiryDate > now : true);
          if (!hasCert) {
            newStatus = 'MISSING_CERTIFICATE';
            break;
          }
          if (certRecord && requiresExpiry) {
            markExpiryByPolicy(req.certificateCode, certRecord.expiryDate);
          }
        }
      }
    }

    if (newStatus === 'READY') {
      const latestMedical = medicals?.sort((a, b) => b.expiryDate - a.expiryDate)[0];
      if (!latestMedical || latestMedical.expiryDate < now || latestMedical.fitStatus === 'unfit') {
        newStatus = 'MEDICAL_EXPIRED';
      }
    }

    const drugFields = computeDrugPanelWorkerFields(panelSubstances, drugTests || []);

    if (newStatus === 'READY' && panelSubstances.length > 0 && !drugFields.readinessDrugOk) {
      newStatus = 'DRUG_TEST_EXPIRED';
    }

    if (newStatus === 'READY') {
      const hasExpiredIdentityDoc = (workerDocs || []).some((d) =>
        Number(d.expiryDate || 0) > 0 && Number(d.expiryDate) < now
      );
      if (hasExpiredIdentityDoc) {
        newStatus = 'DOCUMENT_EXPIRED';
      }
    }

    if (newStatus === 'READY' && compliance.level === 'blocked') {
      newStatus = 'BLOCKED';
    }

    const complianceAlertLevel = compliance.level;

    let storeEquipmentReadiness: WorkerStoreEquipmentReadiness = 'na';
    try {
      const mobsSnap = await getDocs(
        query(
          collection(firestore, 'mobilizations'),
          where('workerId', '==', worker.id),
          where('deploymentStatus', 'in', [...MOBILIZATION_STATUSES_NOT_CLOSED]),
        ),
      );
      const openMobs = mobsSnap.docs.map((d) => ({ ...d.data(), id: d.id } as Assignment));
      const posReqCache = new Map<string, { ppe: PositionPPERequirement[]; tools: PositionToolRequirement[] }>();
      const loadPositionReqs = async (positionId: string) => {
        if (posReqCache.has(positionId)) return posReqCache.get(positionId)!;
        const ppeRef = collection(firestore, 'positions', positionId, 'ppe_requirements');
        const toolRef = collection(firestore, 'positions', positionId, 'tool_requirements');
        const [ppeSnap, toolSnap] = await Promise.all([getDocs(ppeRef), getDocs(toolRef)]);
        const ppe = ppeSnap.docs.map((d) => ({ ...d.data(), id: d.id } as PositionPPERequirement));
        const tools = toolSnap.docs.map((d) => ({ ...d.data(), id: d.id } as PositionToolRequirement));
        const v = { ppe, tools };
        posReqCache.set(positionId, v);
        return v;
      };
      storeEquipmentReadiness = await computeWorkerStoreEquipmentReadiness(
        firestore,
        worker.id,
        openMobs,
        async (pid) => loadPositionReqs(pid),
      );
    } catch (e) {
      console.error(e);
    }

    if (
      worker.readinessStatus !== newStatus ||
      (worker.complianceAlertLevel || 'ok') !== complianceAlertLevel ||
      Number(worker.nearestExpiryInDays ?? -1) !== Number(nearestExpiryInDays ?? -1) ||
      worker.drugPanelSummaryKind !== drugFields.drugPanelSummaryKind ||
      worker.drugPanelSummaryText !== drugFields.drugPanelSummaryText ||
      Number(worker.drugPanelPassedCount ?? -1) !== drugFields.drugPanelPassedCount ||
      Number(worker.drugPanelTotalCount ?? -1) !== drugFields.drugPanelTotalCount ||
      (worker.storeEquipmentReadiness || 'na') !== storeEquipmentReadiness
    ) {
      updateDocumentNonBlocking(workerRef!, {
        readinessStatus: newStatus,
        complianceAlertLevel,
        nearestExpiryInDays: nearestExpiryInDays ?? null,
        nearestExpiryAt: nearestExpiryAt ?? null,
        drugPanelSummaryKind: drugFields.drugPanelSummaryKind,
        drugPanelSummaryText: drugFields.drugPanelSummaryText,
        drugPanelPassedCount: drugFields.drugPanelPassedCount,
        drugPanelTotalCount: drugFields.drugPanelTotalCount,
        storeEquipmentReadiness,
      });
    }
  };

  useEffect(() => {
    if (worker && certs && medicals && drugTests) {
      calculateAndStoreReadiness();
    }
  }, [
    worker?.currentPositionId,
    worker?.id,
    certs?.length,
    medicals?.length,
    drugTests?.length,
    workerDocs?.length,
    workerDocCatalog?.length,
    panelSubstances.length,
    workerMobilizations?.length,
  ]);

  // --- Render ---
  if (authHydrationLoading || userLoading) {
    return (
      <AppShell user={currentUser as AppUser} onLogout={() => {}}>
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="animate-pulse text-muted-foreground">กำลังตรวจสอบสิทธิ์…</div>
        </div>
      </AppShell>
    );
  }
  if (!firebaseUser || !currentUser) {
    return (
      <AppShell user={currentUser as AppUser} onLogout={() => {}}>
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="animate-pulse text-muted-foreground">กำลังโหลดโปรไฟล์ผู้ใช้…</div>
        </div>
      </AppShell>
    );
  }
  if (!canViewWorkerProfile) {
    return (
      <AppShell user={currentUser as AppUser} onLogout={() => {}}>
        <div className="max-w-5xl mx-auto py-10 text-center text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงเมนูนี้</div>
      </AppShell>
    );
  }
  if (isWorkerLoading || !worker) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="animate-pulse text-muted-foreground">กำลังโหลดข้อมูลคนงาน (Loading Worker Data)...</div>
        </div>
      </AppShell>
    );
  }

  const workerProfileTabTriggerClassName =
    'gap-2 py-2.5 px-2 sm:px-3 w-full justify-center text-[11px] sm:text-sm whitespace-normal leading-snug min-h-10 sm:min-h-11 [&_svg]:shrink-0';

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1400px] mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/workers"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight text-primary">
                {worker.firstName} {worker.lastName}
              </h1>
              <Badge variant="outline" className="font-mono text-primary border-primary/20 bg-primary/5">
                CODE: {worker.workerCode || 'N/A'}
              </Badge>
              <Badge variant="secondary" className="font-mono">
                ID: {worker.thaiNationalId}
              </Badge>
              {worker.readinessStatus === 'READY' && worker.complianceAlertLevel === 'warning' && (
                <Badge variant="outline" className="gap-1 border-orange-500 text-orange-700 bg-orange-50">
                  <AlertTriangle className="h-3 w-3" /> WARNING ({worker.nearestExpiryInDays ?? '-'} วัน)
                </Badge>
              )}
              {worker.readinessStatus === 'READY' && worker.storeEquipmentReadiness === 'pending' && (
                <>
                  <Badge variant="outline" className="gap-1 border-amber-500 text-amber-900 bg-amber-50">
                    <Package className="h-3 w-3" /> คลัง: PPE/อุปกรณ์ค้าง
                  </Badge>
                  <Button variant="outline" size="sm" className="h-8 text-xs border-amber-500 text-amber-900" asChild>
                    <Link href="/store/issue">ไปเบิกคลัง</Link>
                  </Button>
                </>
              )}
            </div>
            <p className="text-muted-foreground mt-1 flex items-center gap-2">
              <Info className="h-4 w-4" /> <strong>Worker Payroll</strong> — ประวัติลูกจ้าง, ใบรับรอง และข้อมูลประกอบ timesheet
            </p>
            <PayrollScopeTag scope="worker" showHint={false} className="mt-2" />
          </div>
          <div className="flex gap-2">
            {canEditWorker && (
              <Button variant="outline" className="h-11" onClick={() => { setEditedWorker(worker); setIsEditing(!isEditing); }}>
                {isEditing ? 'ยกเลิก (Cancel)' : 'แก้ไขประวัติ (Edit Profile)'}
              </Button>
            )}
            {canEditWorker && isEditing && (
              <Button className="h-11 gap-2 bg-primary font-bold shadow-md" onClick={handleSaveMaster}>
                <Save className="h-4 w-4" /> บันทึกการเปลี่ยนแปลง (Save)
              </Button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab((v as WorkerProfileTab) || 'info')}
          className="w-full"
        >
          <TabsList className="grid w-full grid-cols-4 h-auto p-1.5 bg-muted/50 gap-1.5 rounded-md">
            <TabsTrigger value="info" className={workerProfileTabTriggerClassName}>
              <User className="h-4 w-4" /> ข้อมูลประวัติ (Info)
            </TabsTrigger>
            <TabsTrigger value="certs" className={workerProfileTabTriggerClassName}>
              <FileText className="h-4 w-4" /> ใบเซอร์ (Certs)
            </TabsTrigger>
            <TabsTrigger value="medical" className={workerProfileTabTriggerClassName}>
              <Stethoscope className="h-4 w-4" /> ตรวจร่างกาย (Medical)
            </TabsTrigger>
            <TabsTrigger value="drug" className={workerProfileTabTriggerClassName}>
              <AlertCircle className="h-4 w-4" /> สารเสพติด (Drug Test)
            </TabsTrigger>
            <TabsTrigger value="docs" className={workerProfileTabTriggerClassName}>
              <FileSearch className="h-4 w-4" /> เอกสาร (Docs)
            </TabsTrigger>
            <TabsTrigger value="worklog" className={workerProfileTabTriggerClassName}>
              <History className="h-4 w-4" /> ประวัติชั่วโมงงาน
            </TabsTrigger>
            <TabsTrigger value="ppe_list" className={workerProfileTabTriggerClassName}>
              <HardHat className="h-4 w-4" /> รายการ PPE
            </TabsTrigger>
            <TabsTrigger value="tools_list" className={workerProfileTabTriggerClassName}>
              <Wrench className="h-4 w-4" /> รายการอุปกรณ์
            </TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="mt-6 space-y-6">
            <WorkerInfoTab
              worker={worker}
              isEditing={isEditing}
              editedWorker={editedWorker}
              setEditedWorker={setEditedWorker}
              allPositions={allPositions}
              currentPosition={currentPositionForLabor}
              canViewLaborCost={canViewLaborCost}
              canEditLaborCost={canEditLaborCost}
              canEditWorkerReadiness={canEditWorker}
              onReadinessManualHoldChange={handleReadinessManualHoldChange}
              canActivateWorkerLogin={canEditWorker}
              onActivateWorkerLogin={handleActivateWorkerLogin}
              activateWorkerLoginBusy={activateLoginBusy}
            />
          </TabsContent>

          <TabsContent value="certs" className="mt-6">
            <WorkerCertsTab workerId={id} firestore={firestore} certs={certs} certsQuery={certsQuery as any} workerDocCatalog={workerDocCatalog} />
          </TabsContent>

          <TabsContent value="medical" className="mt-6">
            <WorkerMedicalTab workerId={id} firestore={firestore} medicals={medicals} medicalsQuery={medicalsQuery as any} />
          </TabsContent>

          <TabsContent value="drug" className="mt-6">
            <WorkerDrugTab workerId={id} firestore={firestore} drugTests={drugTests} drugTestsQuery={drugTestsQuery as any} panelSubstances={panelSubstances} />
          </TabsContent>

          <TabsContent value="docs" className="mt-6">
            <WorkerDocsTab workerId={id} firestore={firestore} workerDocs={workerDocs} docsQuery={docsQuery as any} workerDocCatalog={workerDocCatalog} />
          </TabsContent>

          <TabsContent value="worklog" className="mt-6">
            <WorkerWorklogTab workLogRows={workLogRows} totalWorkedHours={totalWorkedHours} />
          </TabsContent>

          <TabsContent value="ppe_list" className="mt-6">
            <WorkerPositionStoreTab
              firestore={firestore!}
              worker={worker}
              mobilizations={workerMobilizations ?? undefined}
              kind="ppe"
            />
          </TabsContent>

          <TabsContent value="tools_list" className="mt-6">
            <WorkerPositionStoreTab
              firestore={firestore!}
              worker={worker}
              mobilizations={workerMobilizations ?? undefined}
              kind="tool"
            />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

export default function WorkerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground text-sm">กำลังโหลด…</div>
      }
    >
      <WorkerDetailContent id={id} />
    </Suspense>
  );
}
