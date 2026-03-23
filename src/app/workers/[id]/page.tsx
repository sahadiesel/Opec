'use client';

import { useState, use, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Plus, 
  Trash2, 
  Save, 
  FileText, 
  ShieldCheck, 
  Stethoscope, 
  ArrowLeft,
  FileSearch,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  CreditCard,
  User,
  Phone,
  History,
  Info,
  HardHat
} from 'lucide-react';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog';
import { useFirestore, useDoc, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { doc, collection, query, where, getDocs } from 'firebase/firestore';
import { updateDocumentNonBlocking, addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
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
  WorkerDocumentCatalogItem
} from '@/lib/types';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';

const DAY_MS = 24 * 60 * 60 * 1000;

export default function WorkerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const { user: firebaseUser, isUserLoading: isAuthLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

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
  const workerTimesheetsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'daily_timesheets') : null), [firestore]);
  const { data: workerTimesheetsAll } = useCollection<DailyTimesheet>(workerTimesheetsQuery as any);

  const [isEditing, setIsEditing] = useState(false);
  const [editedWorker, setEditedWorker] = useState<Partial<Worker>>({});
  const [isAddCertOpen, setIsAddCertOpen] = useState(false);
  const [isAddDocOpen, setIsAddDocOpen] = useState(false);
  const [newCertTemplateId, setNewCertTemplateId] = useState('');
  const [newDocTemplateId, setNewDocTemplateId] = useState('');
  const [newCertNo, setNewCertNo] = useState('');
  const [newCertIssueDate, setNewCertIssueDate] = useState('');
  const [newCertExpiryDate, setNewCertExpiryDate] = useState('');
  const [newDocNo, setNewDocNo] = useState('');
  const [newDocIssueDate, setNewDocIssueDate] = useState('');
  const [newDocExpiryDate, setNewDocExpiryDate] = useState('');
  const [editingCertId, setEditingCertId] = useState<string | null>(null);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [isAddMedicalOpen, setIsAddMedicalOpen] = useState(false);
  const [isAddDrugOpen, setIsAddDrugOpen] = useState(false);
  const [newMedicalType, setNewMedicalType] = useState('General Health Exam');
  const [newMedicalExamDate, setNewMedicalExamDate] = useState('');
  const [newMedicalExpiryDate, setNewMedicalExpiryDate] = useState('');
  const [newMedicalFitStatus, setNewMedicalFitStatus] = useState<'fit' | 'unfit' | 'conditional'>('fit');
  const [newMedicalHospital, setNewMedicalHospital] = useState('');
  const [newDrugTestDate, setNewDrugTestDate] = useState('');
  const [newDrugResult, setNewDrugResult] = useState<'negative' | 'positive'>('negative');
  const [newDrugExpiryDate, setNewDrugExpiryDate] = useState('');
  const [newDrugLaboratory, setNewDrugLaboratory] = useState('');

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
        projectName: ts.workerNameSnapshot ? '-' : '-', // placeholder to keep schema consistent
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

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const handleSaveMaster = () => {
    if (!workerRef) return;
    updateDocumentNonBlocking(workerRef, { ...editedWorker, updatedAt: Date.now() });
    setIsEditing(false);
    calculateAndStoreReadiness();
    toast({ title: "บันทึกสำเร็จ", description: "ข้อมูลประวัติคนงานถูกอัปเดตแล้ว" });
  };

  const calculateAndStoreReadiness = async () => {
    if (!firestore || !worker) return;

    let newStatus: ReadinessStatus = 'READY';
    const now = Date.now();
    let complianceAlertLevel: 'ok' | 'warning' | 'blocked' = 'ok';
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
        complianceAlertLevel = 'blocked';
      } else if (complianceAlertLevel !== 'blocked' && alertBefore > 0 && remainingDays <= alertBefore) {
        complianceAlertLevel = 'warning';
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

    if (newStatus === 'READY') {
      const latestDrug = drugTests?.sort((a, b) => b.testDate - a.testDate)[0];
      if (!latestDrug || latestDrug.expiryDate < now || latestDrug.result === 'positive') {
        newStatus = 'DRUG_TEST_EXPIRED';
      }
    }

    if (newStatus === 'READY') {
      const hasExpiredIdentityDoc = (workerDocs || []).some((d) =>
        Number(d.expiryDate || 0) > 0 && Number(d.expiryDate) < now
      );
      if (hasExpiredIdentityDoc) {
        newStatus = 'DOCUMENT_EXPIRED';
      }
    }

    if (newStatus === 'READY' && complianceAlertLevel === 'blocked') {
      newStatus = 'BLOCKED';
    }

    if (
      worker.readinessStatus !== newStatus ||
      (worker.complianceAlertLevel || 'ok') !== complianceAlertLevel ||
      Number(worker.nearestExpiryInDays ?? -1) !== Number(nearestExpiryInDays ?? -1)
    ) {
      updateDocumentNonBlocking(workerRef!, {
        readinessStatus: newStatus,
        complianceAlertLevel,
        nearestExpiryInDays: nearestExpiryInDays ?? null,
        nearestExpiryAt: nearestExpiryAt ?? null,
      });
    }
  };

  useEffect(() => {
    if (worker && certs && medicals && drugTests) {
      calculateAndStoreReadiness();
    }
  }, [worker?.currentPositionId, certs?.length, medicals?.length, drugTests?.length, workerDocs?.length, workerDocCatalog?.length]);

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
              <Info className="h-4 w-4" /> ดูและจัดการข้อมูลประวัติ (Worker Profile), ใบรับรอง และผลตรวจร่างกาย
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="h-11" onClick={() => { setEditedWorker(worker); setIsEditing(!isEditing); }}>
              {isEditing ? 'ยกเลิก (Cancel)' : 'แก้ไขประวัติ (Edit Profile)'}
            </Button>
            {isEditing && (
              <Button className="h-11 gap-2 bg-primary font-bold shadow-md" onClick={handleSaveMaster}>
                <Save className="h-4 w-4" /> บันทึกการเปลี่ยนแปลง (Save)
              </Button>
            )}
          </div>
        </div>

        <Tabs defaultValue="info" className="w-full">
          <TabsList className="grid grid-cols-6 w-full md:w-fit h-auto p-1 bg-muted/50">
            <TabsTrigger value="info" className="gap-2 py-2 px-6"><User className="h-4 w-4" /> ข้อมูลประวัติ (Info)</TabsTrigger>
            <TabsTrigger value="certs" className="gap-2 py-2 px-6"><FileText className="h-4 w-4" /> ใบเซอร์ (Certs)</TabsTrigger>
            <TabsTrigger value="medical" className="gap-2 py-2 px-6"><Stethoscope className="h-4 w-4" /> ตรวจร่างกาย (Medical)</TabsTrigger>
            <TabsTrigger value="drug" className="gap-2 py-2 px-6"><AlertCircle className="h-4 w-4" /> สารเสพติด (Drug Test)</TabsTrigger>
            <TabsTrigger value="docs" className="gap-2 py-2 px-6"><FileSearch className="h-4 w-4" /> เอกสาร (Docs)</TabsTrigger>
            <TabsTrigger value="worklog" className="gap-2 py-2 px-6"><History className="h-4 w-4" /> ประวัติชั่วโมงงาน</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="mt-6 space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <Card className="shadow-sm">
                  <CardHeader className="bg-primary/5 border-b">
                    <CardTitle className="text-lg flex items-center gap-2 text-primary">
                      <User className="h-5 w-5" /> ข้อมูลส่วนตัว (Personal Details)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="space-y-2">
                        <Label className="font-bold">รหัสคนงาน (Worker Code)</Label>
                        <Input disabled value={worker.workerCode || '(Auto-generated)'} className="bg-muted font-mono font-bold" />
                      </div>
                      <div className="space-y-2">
                        <Label className="font-bold">ชื่อจริง (First Name) *</Label>
                        <Input disabled={!isEditing} value={isEditing ? editedWorker.firstName : worker.firstName} onChange={e => setEditedWorker({...editedWorker, firstName: e.target.value})} />
                      </div>
                      <div className="space-y-2">
                        <Label className="font-bold">นามสกุล (Last Name) *</Label>
                        <Input disabled={!isEditing} value={isEditing ? editedWorker.lastName : worker.lastName} onChange={e => setEditedWorker({...editedWorker, lastName: e.target.value})} />
                      </div>
                      <div className="space-y-2">
                        <Label className="font-bold">ชื่อเล่น (Nickname)</Label>
                        <Input disabled={!isEditing} value={isEditing ? editedWorker.nickname : worker.nickname} onChange={e => setEditedWorker({...editedWorker, nickname: e.target.value})} />
                      </div>
                      <div className="space-y-2">
                        <Label className="font-bold">เลขบัตรประชาชน (ID Card No.) *</Label>
                        <Input disabled={!isEditing} value={isEditing ? editedWorker.thaiNationalId : worker.thaiNationalId} onChange={e => setEditedWorker({...editedWorker, thaiNationalId: e.target.value})} />
                      </div>
                      <div className="space-y-2">
                        <Label className="font-bold">เลขพาสปอร์ต (Passport No.)</Label>
                        <Input disabled={!isEditing} value={isEditing ? editedWorker.passportNo : worker.passportNo} onChange={e => setEditedWorker({...editedWorker, passportNo: e.target.value})} />
                      </div>
                      <div className="space-y-2">
                        <Label className="font-bold">สัญชาติ (Nationality)</Label>
                        <Input disabled={!isEditing} value={isEditing ? editedWorker.nationality : worker.nationality} onChange={e => setEditedWorker({...editedWorker, nationality: e.target.value})} />
                      </div>
                      <div className="space-y-2">
                        <Label className="font-bold">เบอร์โทรศัพท์ (Contact Phone) *</Label>
                        <Input disabled={!isEditing} value={isEditing ? editedWorker.contactPhone : worker.contactPhone} onChange={e => setEditedWorker({...editedWorker, contactPhone: e.target.value})} />
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <Label className="font-bold">ตำแหน่งงานหลัก (Primary Position) *</Label>
                        <Select disabled={!isEditing} onValueChange={v => setEditedWorker({...editedWorker, currentPositionId: v})} value={isEditing ? editedWorker.currentPositionId : worker.currentPositionId}>
                          <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {allPositions?.map(p => (
                              <SelectItem key={p.id} value={p.id}>{p.positionName}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <Label className="font-bold">ทักษะ / ความสามารถ (Skills / Trade)</Label>
                      <Input 
                        disabled={!isEditing} 
                        placeholder="เช่น Welder 6G, Rigger, Scaffolder..."
                        value={isEditing ? editedWorker.skills?.join(', ') : worker.skills?.join(', ')} 
                        onChange={e => setEditedWorker({...editedWorker, skills: e.target.value.split(',').map(s => s.trim()).filter(Boolean)})} 
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="font-bold">ที่อยู่ (Residential Address)</Label>
                      <Textarea disabled={!isEditing} value={isEditing ? editedWorker.address : worker.address} onChange={e => setEditedWorker({...editedWorker, address: e.target.value})} />
                    </div>
                  </CardContent>
                </Card>

                <Card className="shadow-sm">
                  <CardHeader className="bg-primary/5 border-b">
                    <CardTitle className="text-lg flex items-center gap-2 text-primary">
                      <Phone className="h-5 w-5" /> ผู้ติดต่อฉุกเฉิน (Emergency Contact)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <Label className="font-bold">ชื่อผู้ติดต่อ (Contact Name)</Label>
                        <Input disabled={!isEditing} value={isEditing ? editedWorker.emergencyContactName : worker.emergencyContactName} onChange={e => setEditedWorker({...editedWorker, emergencyContactName: e.target.value})} />
                      </div>
                      <div className="space-y-2">
                        <Label className="font-bold">เบอร์โทรฉุกเฉิน (Emergency Phone)</Label>
                        <Input disabled={!isEditing} value={isEditing ? editedWorker.emergencyContactPhone : worker.emergencyContactPhone} onChange={e => setEditedWorker({...editedWorker, emergencyContactPhone: e.target.value})} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-6">
                <Card className="shadow-sm border-blue-100 bg-blue-50/20">
                  <CardHeader className="bg-blue-100/50 border-b border-blue-100">
                    <CardTitle className="text-lg flex items-center gap-2 text-blue-800">
                      <CreditCard className="h-5 w-5" /> ข้อมูลการเงิน (Financial Profile)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6 space-y-4">
                    <div className="space-y-2">
                      <Label className="font-bold">ชื่อธนาคาร (Bank Name)</Label>
                      <Input disabled={!isEditing} value={isEditing ? editedWorker.bankName : worker.bankName} onChange={e => setEditedWorker({...editedWorker, bankName: e.target.value})} />
                    </div>
                    <div className="space-y-2">
                      <Label className="font-bold">ชื่อบัญชี (Account Holder Name)</Label>
                      <Input disabled={!isEditing} value={isEditing ? editedWorker.bankAccountName : worker.bankAccountName} onChange={e => setEditedWorker({...editedWorker, bankAccountName: e.target.value})} />
                    </div>
                    <div className="space-y-2">
                      <Label className="font-bold">เลขที่บัญชี (Bank Account No.)</Label>
                      <Input disabled={!isEditing} value={isEditing ? editedWorker.bankAccountNumber : worker.bankAccountNumber} onChange={e => setEditedWorker({...editedWorker, bankAccountNumber: e.target.value})} />
                    </div>
                  </CardContent>
                </Card>

                <Card className="shadow-sm">
                  <CardHeader className="bg-destructive/5 border-b border-destructive/10">
                    <CardTitle className="text-lg flex items-center gap-2 text-destructive">
                      <AlertTriangle className="h-5 w-5" /> บันทึกทางวินัย (Disciplinary Notes)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6">
                    <Textarea 
                      disabled={!isEditing} 
                      className="min-h-[120px] text-destructive border-destructive/20 focus:border-destructive"
                      placeholder="ระบุความผิดปกติ หรือเหตุการณ์สำคัญ..."
                      value={isEditing ? editedWorker.disciplinaryNotes : worker.disciplinaryNotes} 
                      onChange={e => setEditedWorker({...editedWorker, disciplinaryNotes: e.target.value})} 
                    />
                  </CardContent>
                </Card>

                <Card className="shadow-sm bg-muted/20">
                  <CardHeader className="pb-3 border-b">
                    <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                      <History className="h-4 w-4" /> ข้อมูลระบบ (System Meta)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4 space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">ลงทะเบียนเมื่อ:</span>
                      <span className="font-medium">{new Date(worker.createdAt).toLocaleDateString('th-TH')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">อัปเดตล่าสุด:</span>
                      <span className="font-medium">{new Date(worker.updatedAt).toLocaleString('th-TH')}</span>
                    </div>
                    <div className="flex justify-between border-t pt-2 mt-2">
                      <span className="text-muted-foreground">สถานะงาน (Job Status):</span>
                      <Badge variant="outline" className="text-[9px] uppercase font-bold">{worker.workerStatus}</Badge>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="certs" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between border-b bg-primary/5 pb-4">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2 text-primary">
                    <FileText className="h-5 w-5" /> รายการใบรับรอง (Certificates Management)
                  </CardTitle>
                  <CardDescription>จัดเก็บใบเซอร์บังคับ (BOSIET, etc.) และติดตามวันหมดอายุ</CardDescription>
                </div>
                <Dialog open={isAddCertOpen} onOpenChange={setIsAddCertOpen}>
                  <DialogTrigger asChild>
                    <Button
                      className="bg-primary font-bold shadow-md"
                      onClick={() => {
                        setEditingCertId(null);
                        setNewCertTemplateId('');
                        setNewCertNo('');
                        setNewCertIssueDate('');
                        setNewCertExpiryDate('');
                      }}
                    >
                      <Plus className="h-4 w-4 mr-2" /> เพิ่มใบเซอร์ (Add Cert)
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>เพิ่มใบเซอร์จากรายการกลาง</DialogTitle>
                      <DialogDescription>เลือกเฉพาะรายการประเภท Certificate จากเมนูรายการเอกสารกลาง</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2 py-2">
                      <Label>รายการเซอร์</Label>
                      <Select value={newCertTemplateId} onValueChange={setNewCertTemplateId}>
                        <SelectTrigger><SelectValue placeholder="เลือกใบเซอร์..." /></SelectTrigger>
                        <SelectContent>
                          {(workerDocCatalog || []).filter((x) => x.active !== false && x.requirementType === 'certificate').map((x) => (
                            <SelectItem key={x.id} value={x.id}>{x.itemName}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Label>เลขที่เอกสารใบเซอร์</Label>
                      <Input value={newCertNo} onChange={(e) => setNewCertNo(e.target.value)} placeholder="เช่น CERT-00123" />
                      <Label>วันที่ออกเอกสาร</Label>
                      <Input type="date" value={newCertIssueDate} onChange={(e) => setNewCertIssueDate(e.target.value)} />
                      <Label>วันหมดอายุ</Label>
                      <Input
                        type="date"
                        value={newCertExpiryDate}
                        disabled={!((workerDocCatalog || []).find((x) => x.id === newCertTemplateId)?.hasExpiry)}
                        onChange={(e) => setNewCertExpiryDate(e.target.value)}
                      />
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsAddCertOpen(false)}>ยกเลิก</Button>
                      <Button
                        onClick={() => {
                          const selected = (workerDocCatalog || []).find((x) => x.id === newCertTemplateId);
                          if (!selected || !certsQuery) return;
                          if (!newCertNo.trim()) {
                            toast({ variant: 'destructive', title: 'กรอกข้อมูลไม่ครบ', description: 'กรุณากรอกเลขที่เอกสารใบเซอร์' });
                            return;
                          }
                          if (selected.hasExpiry && !newCertExpiryDate) {
                            toast({ variant: 'destructive', title: 'กรอกข้อมูลไม่ครบ', description: 'เอกสารนี้ต้องระบุวันหมดอายุ' });
                            return;
                          }
                          const duplicateCert = (certs || []).find(
                            (c) =>
                              (c.certificateCode || '').toLowerCase() === (selected.itemCode || '').toLowerCase() &&
                              c.id !== editingCertId
                          );
                          if (duplicateCert) {
                            const shouldEdit = confirm('มีเอกสาร/ใบเซอร์รายการนี้อยู่แล้ว ต้องการแก้ไขรายการเดิมใช่ไหม?');
                            if (!shouldEdit) return;
                            setEditingCertId(duplicateCert.id);
                            setNewCertTemplateId(selected.id);
                            setNewCertNo(duplicateCert.certificateNo || '');
                            setNewCertIssueDate(duplicateCert.issueDate ? new Date(duplicateCert.issueDate).toISOString().slice(0, 10) : '');
                            setNewCertExpiryDate(duplicateCert.expiryDate ? new Date(duplicateCert.expiryDate).toISOString().slice(0, 10) : '');
                            toast({ title: 'เข้าสู่โหมดแก้ไข', description: 'ปรับข้อมูลและกดบันทึกอีกครั้งเพื่ออัปเดตรายการเดิม' });
                            return;
                          }
                          const now = Date.now();
                          const issueDate = newCertIssueDate ? new Date(newCertIssueDate).getTime() : now;
                          const expiryDate = selected.hasExpiry
                            ? (newCertExpiryDate ? new Date(newCertExpiryDate).getTime() : 0)
                            : 0;
                          if (editingCertId && firestore) {
                            updateDocumentNonBlocking(doc(firestore, 'workers', id, 'certificates', editingCertId), {
                              certificateName: selected.itemName,
                              certificateCode: selected.itemCode,
                              certificateNo: newCertNo.trim(),
                              issueDate,
                              expiryDate,
                              status: 'valid',
                            });
                          } else {
                            addDocumentNonBlocking(certsQuery, {
                              certificateName: selected.itemName,
                              certificateCode: selected.itemCode,
                              certificateNo: newCertNo.trim(),
                              issueDate,
                              expiryDate,
                              status: 'valid',
                            });
                          }
                          setIsAddCertOpen(false);
                          setEditingCertId(null);
                          setNewCertTemplateId('');
                          setNewCertNo('');
                          setNewCertIssueDate('');
                          setNewCertExpiryDate('');
                        }}
                      >
                        {editingCertId ? 'บันทึกการแก้ไข' : 'บันทึก'}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="pl-6 font-bold">ชื่อใบเซอร์ (Name)</TableHead>
                      <TableHead className="font-bold">เลขที่ใบเซอร์ (No.)</TableHead>
                      <TableHead className="font-bold">วันหมดอายุ (Expiry)</TableHead>
                      <TableHead className="font-bold">สถานะ (Status)</TableHead>
                      <TableHead className="text-right pr-6">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {certs?.map(c => (
                      <TableRow key={c.id}>
                        <TableCell className="pl-6 font-medium text-primary">{c.certificateName}</TableCell>
                        <TableCell className="font-mono text-xs">{c.certificateNo || '-'}</TableCell>
                        <TableCell className={c.expiryDate > 0 && c.expiryDate < Date.now() ? 'text-destructive font-black' : 'font-medium'}>
                          {c.expiryDate > 0 ? new Date(c.expiryDate).toLocaleDateString('th-TH') : '-'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={c.status === 'valid' ? 'default' : 'destructive'} className={c.status === 'valid' ? 'bg-green-600' : ''}>
                            {c.status.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive h-8 w-8"
                            onClick={() => {
                              if (!firestore) return;
                              if (confirm('ลบรายการ?')) {
                                deleteDocumentNonBlocking(doc(firestore, 'workers', id, 'certificates', c.id));
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {certs?.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-20 text-center text-muted-foreground italic">ไม่พบข้อมูลใบรับรอง</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="medical" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between border-b bg-primary/5 pb-4">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2 text-primary">
                    <Stethoscope className="h-5 w-5" /> ผลการตรวจร่างกาย (Medical Records)
                  </CardTitle>
                  <CardDescription>ข้อมูลความพร้อมทางร่างกายตามเกณฑ์มาตรฐานงาน Offshore</CardDescription>
                </div>
                <Dialog open={isAddMedicalOpen} onOpenChange={setIsAddMedicalOpen}>
                  <DialogTrigger asChild>
                    <Button
                      className="bg-primary font-bold shadow-md"
                      onClick={() => {
                        setNewMedicalType('General Health Exam');
                        setNewMedicalExamDate('');
                        setNewMedicalExpiryDate('');
                        setNewMedicalFitStatus('fit');
                        setNewMedicalHospital('');
                      }}
                    >
                      <Plus className="h-4 w-4 mr-2" /> เพิ่มผลตรวจ (Add Medical)
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>บันทึกผลตรวจร่างกาย</DialogTitle>
                      <DialogDescription>กรอกข้อมูลผลตรวจให้ครบก่อนบันทึก</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                      <div className="space-y-2">
                        <Label>ประเภทการตรวจ</Label>
                        <Input value={newMedicalType} onChange={(e) => setNewMedicalType(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label>วันที่ตรวจ</Label>
                        <Input type="date" value={newMedicalExamDate} onChange={(e) => setNewMedicalExamDate(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label>วันหมดอายุ</Label>
                        <Input type="date" value={newMedicalExpiryDate} onChange={(e) => setNewMedicalExpiryDate(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label>ผลการตรวจ</Label>
                        <Select value={newMedicalFitStatus} onValueChange={(v) => setNewMedicalFitStatus(v as 'fit' | 'unfit' | 'conditional')}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="fit">FIT</SelectItem>
                            <SelectItem value="unfit">UNFIT</SelectItem>
                            <SelectItem value="conditional">CONDITIONAL</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>สถานพยาบาล</Label>
                        <Input value={newMedicalHospital} onChange={(e) => setNewMedicalHospital(e.target.value)} />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsAddMedicalOpen(false)}>ยกเลิก</Button>
                      <Button
                        onClick={() => {
                          if (!medicalsQuery) return;
                          if (!newMedicalType.trim() || !newMedicalExamDate || !newMedicalExpiryDate) {
                            toast({ variant: 'destructive', title: 'กรอกข้อมูลไม่ครบ', description: 'กรุณาระบุประเภท วันที่ตรวจ และวันหมดอายุ' });
                            return;
                          }
                          addDocumentNonBlocking(medicalsQuery, {
                            medicalType: newMedicalType.trim(),
                            examDate: new Date(newMedicalExamDate).getTime(),
                            expiryDate: new Date(newMedicalExpiryDate).getTime(),
                            fitStatus: newMedicalFitStatus,
                            hospitalOrClinic: newMedicalHospital || '',
                          });
                          setIsAddMedicalOpen(false);
                        }}
                      >
                        บันทึก
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="pl-6 font-bold">ประเภทการตรวจ (Type)</TableHead>
                      <TableHead className="font-bold">วันที่ตรวจ (Exam Date)</TableHead>
                      <TableHead className="font-bold">วันหมดอายุ (Expiry)</TableHead>
                      <TableHead className="font-bold">ผลการตรวจ (Result)</TableHead>
                      <TableHead className="text-right pr-6">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {medicals?.map(m => (
                      <TableRow key={m.id}>
                        <TableCell className="pl-6 font-medium text-primary">{m.medicalType}</TableCell>
                        <TableCell className="text-xs">{new Date(m.examDate).toLocaleDateString('th-TH')}</TableCell>
                        <TableCell className={m.expiryDate < Date.now() ? 'text-destructive font-black' : 'font-medium'}>
                          {new Date(m.expiryDate).toLocaleDateString('th-TH')}
                        </TableCell>
                        <TableCell>
                          <Badge variant={m.fitStatus === 'fit' ? 'default' : 'destructive'} className={m.fitStatus === 'fit' ? 'bg-green-600' : ''}>
                            {m.fitStatus.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive h-8 w-8"
                            onClick={() => {
                              if (!firestore) return;
                              if (confirm('ลบรายการ?')) {
                                deleteDocumentNonBlocking(doc(firestore, 'workers', id, 'medical_records', m.id));
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {medicals?.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-20 text-center text-muted-foreground italic">ไม่พบประวัติการตรวจร่างกาย</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="drug" className="mt-6">
             <Card>
              <CardHeader className="flex flex-row items-center justify-between border-b bg-primary/5 pb-4">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2 text-primary">
                    <AlertCircle className="h-5 w-5" /> ผลตรวจสารเสพติด (Drug Tests)
                  </CardTitle>
                  <CardDescription>ความปลอดภัยและกฎระเบียบวินัยในหน้างาน</CardDescription>
                </div>
                <Dialog open={isAddDrugOpen} onOpenChange={setIsAddDrugOpen}>
                  <DialogTrigger asChild>
                    <Button
                      className="bg-primary font-bold shadow-md"
                      onClick={() => {
                        setNewDrugTestDate('');
                        setNewDrugExpiryDate('');
                        setNewDrugResult('negative');
                        setNewDrugLaboratory('');
                      }}
                    >
                      <Plus className="h-4 w-4 mr-2" /> เพิ่มผลตรวจ (Add Test)
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>บันทึกผลตรวจสารเสพติด</DialogTitle>
                      <DialogDescription>กรอกข้อมูลผลตรวจให้ครบก่อนบันทึก</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                      <div className="space-y-2">
                        <Label>วันที่ตรวจ</Label>
                        <Input type="date" value={newDrugTestDate} onChange={(e) => setNewDrugTestDate(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label>สถานตรวจ</Label>
                        <Input value={newDrugLaboratory} onChange={(e) => setNewDrugLaboratory(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label>ผลตรวจ</Label>
                        <Select value={newDrugResult} onValueChange={(v) => setNewDrugResult(v as 'negative' | 'positive')}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="negative">NEGATIVE</SelectItem>
                            <SelectItem value="positive">POSITIVE</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>วันหมดอายุ</Label>
                        <Input type="date" value={newDrugExpiryDate} onChange={(e) => setNewDrugExpiryDate(e.target.value)} />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsAddDrugOpen(false)}>ยกเลิก</Button>
                      <Button
                        onClick={() => {
                          if (!drugTestsQuery) return;
                          if (!newDrugTestDate || !newDrugExpiryDate) {
                            toast({ variant: 'destructive', title: 'กรอกข้อมูลไม่ครบ', description: 'กรุณาระบุวันที่ตรวจและวันหมดอายุ' });
                            return;
                          }
                          addDocumentNonBlocking(drugTestsQuery, {
                            testDate: new Date(newDrugTestDate).getTime(),
                            result: newDrugResult,
                            expiryDate: new Date(newDrugExpiryDate).getTime(),
                            laboratory: newDrugLaboratory || '',
                          });
                          setIsAddDrugOpen(false);
                        }}
                      >
                        บันทึก
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="pl-6 font-bold">วันที่ตรวจ (Test Date)</TableHead>
                      <TableHead className="font-bold">สถานตรวจ (Laboratory)</TableHead>
                      <TableHead className="font-bold">ผลตรวจ (Result)</TableHead>
                      <TableHead className="font-bold">วันหมดอายุ (Expiry)</TableHead>
                      <TableHead className="text-right pr-6">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {drugTests?.map(d => (
                      <TableRow key={d.id}>
                        <TableCell className="pl-6 font-medium text-primary">{new Date(d.testDate).toLocaleDateString('th-TH')}</TableCell>
                        <TableCell className="text-xs">{d.laboratory}</TableCell>
                        <TableCell>
                          <Badge variant={d.result === 'negative' ? 'default' : 'destructive'} className={d.result === 'negative' ? 'bg-green-600' : ''}>
                            {d.result.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className={d.expiryDate < Date.now() ? 'text-destructive font-black text-xs' : 'text-xs'}>
                          {new Date(d.expiryDate).toLocaleDateString('th-TH')}
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive h-8 w-8"
                            onClick={() => {
                              if (!firestore) return;
                              if (confirm('ลบรายการ?')) {
                                deleteDocumentNonBlocking(doc(firestore, 'workers', id, 'drug_tests', d.id));
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {drugTests?.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-20 text-center text-muted-foreground italic">ไม่พบประวัติการตรวจสารเสพติด</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="docs" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between border-b bg-primary/5 pb-4">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2 text-primary">
                    <FileSearch className="h-5 w-5" /> เอกสารอื่น ๆ (Identity & Documents)
                  </CardTitle>
                  <CardDescription>จัดเก็บสำเนาบัตรประชาชน พาสปอร์ต ทะเบียนบ้าน หรือสัญญาจ้างงาน</CardDescription>
                </div>
                <Dialog open={isAddDocOpen} onOpenChange={setIsAddDocOpen}>
                  <DialogTrigger asChild>
                    <Button
                      className="bg-primary font-bold shadow-md"
                      onClick={() => {
                        setEditingDocId(null);
                        setNewDocTemplateId('');
                        setNewDocNo('');
                        setNewDocIssueDate('');
                        setNewDocExpiryDate('');
                      }}
                    >
                      <Plus className="h-4 w-4 mr-2" /> เพิ่มเอกสาร (Add Doc)
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>เพิ่มเอกสารจากรายการกลาง</DialogTitle>
                      <DialogDescription>เลือกเฉพาะรายการประเภท Document จากเมนูรายการเอกสารกลาง</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2 py-2">
                      <Label>รายการเอกสาร</Label>
                      <Select value={newDocTemplateId} onValueChange={setNewDocTemplateId}>
                        <SelectTrigger><SelectValue placeholder="เลือกเอกสาร..." /></SelectTrigger>
                        <SelectContent>
                          {(workerDocCatalog || []).filter((x) => x.active !== false && x.requirementType === 'document').map((x) => (
                            <SelectItem key={x.id} value={x.id}>{x.itemName}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Label>เลขที่เอกสาร</Label>
                      <Input value={newDocNo} onChange={(e) => setNewDocNo(e.target.value)} placeholder="เช่น P1234567 / SB77889" />
                      <Label>วันที่ออกเอกสาร</Label>
                      <Input type="date" value={newDocIssueDate} onChange={(e) => setNewDocIssueDate(e.target.value)} />
                      <Label>วันหมดอายุ</Label>
                      <Input
                        type="date"
                        value={newDocExpiryDate}
                        disabled={!((workerDocCatalog || []).find((x) => x.id === newDocTemplateId)?.hasExpiry)}
                        onChange={(e) => setNewDocExpiryDate(e.target.value)}
                      />
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsAddDocOpen(false)}>ยกเลิก</Button>
                      <Button
                        onClick={() => {
                          const selected = (workerDocCatalog || []).find((x) => x.id === newDocTemplateId);
                          if (!selected || !docsQuery) return;
                          if (!newDocNo.trim()) {
                            toast({ variant: 'destructive', title: 'กรอกข้อมูลไม่ครบ', description: 'กรุณากรอกเลขที่เอกสาร' });
                            return;
                          }
                          if (selected.hasExpiry && !newDocExpiryDate) {
                            toast({ variant: 'destructive', title: 'กรอกข้อมูลไม่ครบ', description: 'เอกสารนี้ต้องระบุวันหมดอายุ' });
                            return;
                          }
                          const duplicateDoc = (workerDocs || []).find(
                            (d) =>
                              (d.documentType || '').toLowerCase() === (selected.itemCode || '').toLowerCase() &&
                              d.id !== editingDocId
                          );
                          if (duplicateDoc) {
                            const shouldEdit = confirm('มีเอกสารรายการนี้อยู่แล้ว ต้องการแก้ไขรายการเดิมใช่ไหม?');
                            if (!shouldEdit) return;
                            setEditingDocId(duplicateDoc.id);
                            setNewDocTemplateId(selected.id);
                            setNewDocNo(duplicateDoc.documentNo || '');
                            setNewDocIssueDate(duplicateDoc.issueDate ? new Date(duplicateDoc.issueDate).toISOString().slice(0, 10) : '');
                            setNewDocExpiryDate(duplicateDoc.expiryDate ? new Date(duplicateDoc.expiryDate).toISOString().slice(0, 10) : '');
                            toast({ title: 'เข้าสู่โหมดแก้ไข', description: 'ปรับข้อมูลและกดบันทึกอีกครั้งเพื่ออัปเดตรายการเดิม' });
                            return;
                          }
                          const now = Date.now();
                          const issueDate = newDocIssueDate ? new Date(newDocIssueDate).getTime() : now;
                          const expiryDate = selected.hasExpiry
                            ? (newDocExpiryDate ? new Date(newDocExpiryDate).getTime() : 0)
                            : 0;
                          if (editingDocId && firestore) {
                            updateDocumentNonBlocking(doc(firestore, 'workers', id, 'documents', editingDocId), {
                              documentType: selected.itemCode,
                              documentNo: newDocNo.trim(),
                              issueDate,
                              expiryDate,
                            });
                          } else {
                            addDocumentNonBlocking(docsQuery, {
                              documentType: selected.itemCode,
                              documentNo: newDocNo.trim(),
                              issueDate,
                              expiryDate,
                            });
                          }
                          setIsAddDocOpen(false);
                          setEditingDocId(null);
                          setNewDocTemplateId('');
                          setNewDocNo('');
                          setNewDocIssueDate('');
                          setNewDocExpiryDate('');
                        }}
                      >
                        {editingDocId ? 'บันทึกการแก้ไข' : 'บันทึก'}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="pl-6 font-bold">ประเภทเอกสาร (Type)</TableHead>
                      <TableHead className="font-bold">เลขที่เอกสาร (Doc No.)</TableHead>
                      <TableHead className="font-bold">วันหมดอายุ (Expiry)</TableHead>
                      <TableHead className="text-right pr-6">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {workerDocs?.map(d => (
                      <TableRow key={d.id}>
                        <TableCell className="pl-6 font-bold text-primary capitalize">{d.documentType.replace('_', ' ')}</TableCell>
                        <TableCell className="font-mono text-xs">{d.documentNo}</TableCell>
                        <TableCell className="text-xs">{d.expiryDate > 0 ? new Date(d.expiryDate).toLocaleDateString('th-TH') : '-'}</TableCell>
                        <TableCell className="text-right pr-6">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive h-8 w-8"
                            onClick={() => {
                              if (!firestore) return;
                              if (confirm('ลบรายการ?')) {
                                deleteDocumentNonBlocking(doc(firestore, 'workers', id, 'documents', d.id));
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {workerDocs?.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="py-20 text-center text-muted-foreground italic">ไม่พบเอกสารในระบบ</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="worklog" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between border-b bg-primary/5 pb-4">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2 text-primary">
                    <History className="h-5 w-5" /> ประวัติการลงงานและชั่วโมงสะสม
                  </CardTitle>
                  <CardDescription>คำนวณจาก Timesheet ที่บันทึกไว้ทั้งหมด</CardDescription>
                </div>
                <Badge className="bg-primary text-white">รวม {totalWorkedHours.toLocaleString()} ชั่วโมง</Badge>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="pl-6 font-bold">Assignment</TableHead>
                      <TableHead className="font-bold">วันที่เริ่ม</TableHead>
                      <TableHead className="font-bold">วันที่สิ้นสุด</TableHead>
                      <TableHead className="text-right pr-6 font-bold">ชั่วโมงรวม</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {workLogRows.map((row) => (
                      <TableRow key={`${row.assignmentId}-${row.startDate}-${row.endDate}`}>
                        <TableCell className="pl-6 font-mono text-xs">{row.assignmentId || '-'}</TableCell>
                        <TableCell className="text-xs">{row.startDate || '-'}</TableCell>
                        <TableCell className="text-xs">{row.endDate || '-'}</TableCell>
                        <TableCell className="text-right pr-6 font-bold text-primary">{Number(row.totalHours || 0).toLocaleString()} ชม.</TableCell>
                      </TableRow>
                    ))}
                    {workLogRows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="py-20 text-center text-muted-foreground italic">ยังไม่มีประวัติการลงเวลา</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
