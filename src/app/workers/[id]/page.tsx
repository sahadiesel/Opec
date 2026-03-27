'use client';

import { useState, use, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  Save,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  User,
  FileText,
  Stethoscope,
  AlertCircle,
  FileSearch,
  History,
  Info,
  Receipt,
} from 'lucide-react';
import { WorkerPayslipHistory } from '@/components/payroll/worker-payslip-history';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import { useFirestore, useDoc, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { doc, collection, query, where, getDocs, updateDoc } from 'firebase/firestore';
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
  ReadinessStatus,
  WorkerDocumentCatalogItem,
  DrugTestPanelConfig,
} from '@/lib/types';
import {
  computeDrugPanelWorkerFields,
  DRUG_TEST_PANEL_DOC_PATH,
} from '@/lib/drug-test-panel';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { usePermissions } from '@/hooks/use-permissions';

import { WorkerInfoTab } from './_components/worker-info-tab';
import { WorkerCertsTab } from './_components/worker-certs-tab';
import { WorkerMedicalTab } from './_components/worker-medical-tab';
import { WorkerDrugTab } from './_components/worker-drug-tab';
import { WorkerDocsTab } from './_components/worker-docs-tab';
import { WorkerWorklogTab } from './_components/worker-worklog-tab';

const DAY_MS = 24 * 60 * 60 * 1000;

export default function WorkerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const { user: firebaseUser, isUserLoading: isAuthLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  // --- Data queries (unchanged) ---
  const workerRef = useMemoFirebase(() => (firestore ? doc(firestore, 'workers', id) : null), [firestore, id]);
  const { data: worker, isLoading: isWorkerLoading } = useDoc<Worker>(workerRef as any);

  const certsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'workers', id, 'certificates') : null), [firestore, id]);
  const { data: certs } = useCollection<WorkerCertificate>(certsQuery as any);

  const medicalsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'workers', id, 'medical_records') : null), [firestore, id]);
  const { data: medicals } = useCollection<WorkerMedicalRecord>(medicalsQuery as any);

  const drugTestsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'workers', id, 'drug_tests') : null), [firestore, id]);
  const { data: drugTests } = useCollection<WorkerDrugTest>(drugTestsQuery as any);

  const docsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'workers', id, 'documents') : null), [firestore, id]);
  const { data: workerDocs } = useCollection<WorkerDocument>(docsQuery as any);

  const positionsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'positions') : null), [firestore]);
  const { data: allPositions } = useCollection<Position>(positionsQuery as any);
  const workerDocCatalogQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'worker_document_catalog') : null), [firestore]);
  const { data: workerDocCatalog } = useCollection<WorkerDocumentCatalogItem>(workerDocCatalogQuery as any);

  const drugPanelRef = useMemoFirebase(
    () => (firestore ? doc(firestore, DRUG_TEST_PANEL_DOC_PATH[0], DRUG_TEST_PANEL_DOC_PATH[1]) : null),
    [firestore]
  );
  const { data: drugPanelConfig } = useDoc<DrugTestPanelConfig>(drugPanelRef as any);
  const workerTimesheetsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'daily_timesheets') : null), [firestore]);
  const { data: workerTimesheetsAll } = useCollection<DailyTimesheet>(workerTimesheetsQuery as any);

  const panelSubstances = drugPanelConfig?.substances ?? [];

  // --- UI state ---
  const [isEditing, setIsEditing] = useState(false);
  const [editedWorker, setEditedWorker] = useState<Partial<Worker>>({});

  // --- Derived data (unchanged) ---
  const workerTimesheets = useMemo(() => {
    return (workerTimesheetsAll || []).filter((t) => t.workerId === id);
  }, [workerTimesheetsAll, id]);

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

  // --- Auth ---
  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const { payroll } = usePermissions(currentUser);
  const canEditWorker = payroll('worker', 'edit');

  // --- Business logic: save master (unchanged) ---
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
    const payload = sanitizeFirestorePayload({ ...editedWorker, updatedAt: Date.now() });
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

    if (
      worker.readinessStatus !== newStatus ||
      (worker.complianceAlertLevel || 'ok') !== complianceAlertLevel ||
      Number(worker.nearestExpiryInDays ?? -1) !== Number(nearestExpiryInDays ?? -1) ||
      worker.drugPanelSummaryKind !== drugFields.drugPanelSummaryKind ||
      worker.drugPanelSummaryText !== drugFields.drugPanelSummaryText ||
      Number(worker.drugPanelPassedCount ?? -1) !== drugFields.drugPanelPassedCount ||
      Number(worker.drugPanelTotalCount ?? -1) !== drugFields.drugPanelTotalCount
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
      });
    }
  };

  useEffect(() => {
    if (worker && certs && medicals && drugTests) {
      calculateAndStoreReadiness();
    }
  }, [
    worker?.currentPositionId,
    certs?.length,
    medicals?.length,
    drugTests?.length,
    workerDocs?.length,
    workerDocCatalog?.length,
    panelSubstances.length,
  ]);

  // --- Render ---
  if (isWorkerLoading || !worker || !currentUser) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="animate-pulse text-muted-foreground">กำลังโหลดข้อมูลคนงาน (Loading Worker Data)...</div>
        </div>
      </AppShell>
    );
  }

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
              {worker.readinessStatus === 'READY' ? (
                worker.complianceAlertLevel === 'warning' ? (
                  <Badge variant="outline" className="gap-1 border-orange-500 text-orange-700 bg-orange-50">
                    <AlertTriangle className="h-3 w-3" /> WARNING ({worker.nearestExpiryInDays ?? '-'} วัน)
                  </Badge>
                ) : (
                  <Badge className="bg-green-600 gap-1 text-white"><CheckCircle2 className="h-3 w-3" /> READY</Badge>
                )
              ) : (
                <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" /> {worker.readinessStatus}</Badge>
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
        <Tabs defaultValue="info" className="w-full">
          <TabsList className="flex flex-wrap w-full md:w-fit h-auto p-1 bg-muted/50 gap-1">
            <TabsTrigger value="info" className="gap-2 py-2 px-6"><User className="h-4 w-4" /> ข้อมูลประวัติ (Info)</TabsTrigger>
            <TabsTrigger value="certs" className="gap-2 py-2 px-6"><FileText className="h-4 w-4" /> ใบเซอร์ (Certs)</TabsTrigger>
            <TabsTrigger value="medical" className="gap-2 py-2 px-6"><Stethoscope className="h-4 w-4" /> ตรวจร่างกาย (Medical)</TabsTrigger>
            <TabsTrigger value="drug" className="gap-2 py-2 px-6"><AlertCircle className="h-4 w-4" /> สารเสพติด (Drug Test)</TabsTrigger>
            <TabsTrigger value="docs" className="gap-2 py-2 px-6"><FileSearch className="h-4 w-4" /> เอกสาร (Docs)</TabsTrigger>
            <TabsTrigger value="worklog" className="gap-2 py-2 px-6"><History className="h-4 w-4" /> ประวัติชั่วโมงงาน</TabsTrigger>
            <TabsTrigger value="payslips" className="gap-2 py-2 px-6"><Receipt className="h-4 w-4" /> สลิปเงินเดือน</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="mt-6 space-y-6">
            <WorkerInfoTab worker={worker} isEditing={isEditing} editedWorker={editedWorker} setEditedWorker={setEditedWorker} allPositions={allPositions} />
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

          <TabsContent value="payslips" className="mt-6">
            <WorkerPayslipHistory workerId={id} currentUser={currentUser} />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
