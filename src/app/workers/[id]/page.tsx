'use client';

import { useState, use, useEffect } from 'react';
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
  Info
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
  User as AppUser, 
  Position, 
  PositionCertificateRequirement,
  ReadinessStatus
} from '@/lib/types';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';

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

  const [isEditing, setIsEditing] = useState(false);
  const [editedWorker, setEditedWorker] = useState<Partial<Worker>>({});

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

  // --- Readiness Calculation Logic ---
  const calculateAndStoreReadiness = async () => {
    if (!firestore || !worker) return;

    let newStatus: ReadinessStatus = 'READY';
    const now = Date.now();

    // 1. Check Position Requirements
    if (worker.currentPositionId) {
      const reqsRef = collection(firestore, 'positions', worker.currentPositionId, 'certificate_requirements');
      const reqsSnap = await getDocs(query(reqsRef, where('required', '==', true)));
      const mandatoryReqs = reqsSnap.docs.map(d => d.data() as PositionCertificateRequirement);

      for (const req of mandatoryReqs) {
        const hasCert = certs?.some(c => 
          c.certificateCode === req.certificateCode && 
          c.expiryDate > now && 
          c.status === 'valid'
        );
        if (!hasCert) {
          newStatus = 'MISSING_CERTIFICATE';
          break;
        }
      }
    }

    // 2. Check Medical
    if (newStatus === 'READY') {
      const latestMedical = medicals?.sort((a, b) => b.expiryDate - a.expiryDate)[0];
      if (!latestMedical || latestMedical.expiryDate < now || latestMedical.fitStatus === 'unfit') {
        newStatus = 'MEDICAL_EXPIRED';
      }
    }

    // 3. Check Drug Test (valid 6 months)
    if (newStatus === 'READY') {
      const latestDrug = drugTests?.sort((a, b) => b.testDate - a.testDate)[0];
      if (!latestDrug || latestDrug.expiryDate < now || latestDrug.result === 'positive') {
        newStatus = 'DRUG_TEST_EXPIRED';
      }
    }

    // 4. Update Worker
    if (worker.readinessStatus !== newStatus) {
      updateDocumentNonBlocking(workerRef!, { readinessStatus: newStatus });
    }
  };

  useEffect(() => {
    if (worker && certs && medicals && drugTests) {
      calculateAndStoreReadiness();
    }
  }, [worker?.currentPositionId, certs?.length, medicals?.length, drugTests?.length]);

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
              <Badge variant="outline" className="font-mono text-primary border-primary/20">
                ID: {worker.thaiNationalId}
              </Badge>
              {worker.readinessStatus === 'READY' ? (
                <Badge className="bg-green-600 gap-1 text-white"><CheckCircle2 className="h-3 w-3" /> READY (พร้อมทำงาน)</Badge>
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
          <TabsList className="grid grid-cols-5 w-full md:w-fit h-auto p-1 bg-muted/50">
            <TabsTrigger value="info" className="gap-2 py-2 px-6"><User className="h-4 w-4" /> ข้อมูลประวัติ (Info)</TabsTrigger>
            <TabsTrigger value="certs" className="gap-2 py-2 px-6"><FileText className="h-4 w-4" /> ใบเซอร์ (Certs)</TabsTrigger>
            <TabsTrigger value="medical" className="gap-2 py-2 px-6"><Stethoscope className="h-4 w-4" /> ตรวจร่างกาย (Medical)</TabsTrigger>
            <TabsTrigger value="drug" className="gap-2 py-2 px-6"><AlertCircle className="h-4 w-4" /> สารเสพติด (Drug Test)</TabsTrigger>
            <TabsTrigger value="docs" className="gap-2 py-2 px-6"><FileSearch className="h-4 w-4" /> เอกสาร (Docs)</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="mt-6 space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Column: Personal & Contact */}
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

              {/* Right Column: Financial & Meta */}
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
                      <span className="text-muted-foreground">ลงทะเบียนเมื่อ (Registered At):</span>
                      <span className="font-medium">{new Date(worker.createdAt).toLocaleDateString('th-TH')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">อัปเดตล่าสุด (Last Update):</span>
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

          {/* ... Rest of the tabs (certs, medical, drug, docs) remain with bilingual labels ... */}
          
          <TabsContent value="certs" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between border-b bg-primary/5 pb-4">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2 text-primary">
                    <FileText className="h-5 w-5" /> รายการใบรับรอง (Certificates Management)
                  </CardTitle>
                  <CardDescription>จัดเก็บใบเซอร์บังคับ (BOSIET, etc.) และติดตามวันหมดอายุ</CardDescription>
                </div>
                <Button className="bg-primary font-bold shadow-md" onClick={() => addDocumentNonBlocking(certsQuery!, { certificateName: 'ระบุชื่อใบเซอร์...', certificateCode: '', certificateNo: '', issueDate: Date.now(), expiryDate: Date.now() + 31536000000, status: 'valid' })}>
                  <Plus className="h-4 w-4 mr-2" /> เพิ่มใบเซอร์ (Add Cert)
                </Button>
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
                        <TableCell className={c.expiryDate < Date.now() ? 'text-destructive font-black' : 'font-medium'}>
                          {new Date(c.expiryDate).toLocaleDateString('th-TH')}
                        </TableCell>
                        <TableCell>
                          <Badge variant={c.status === 'valid' ? 'default' : 'destructive'} className={c.status === 'valid' ? 'bg-green-600' : ''}>
                            {c.status.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => { if(confirm('ลบรายการ?')) deleteDocumentNonBlocking(doc(firestore!, c._path)) }}><Trash2 className="h-4 w-4" /></Button>
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
                <Button className="bg-primary font-bold shadow-md" onClick={() => addDocumentNonBlocking(medicalsQuery!, { medicalType: 'General Health Exam', examDate: Date.now(), expiryDate: Date.now() + 31536000000, fitStatus: 'fit', hospitalOrClinic: '' })}>
                  <Plus className="h-4 w-4 mr-2" /> เพิ่มผลตรวจ (Add Medical)
                </Button>
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
                          <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => { if(confirm('ลบรายการ?')) deleteDocumentNonBlocking(doc(firestore!, m._path)) }}><Trash2 className="h-4 w-4" /></Button>
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
                <Button className="bg-primary font-bold shadow-md" onClick={() => addDocumentNonBlocking(drugTestsQuery!, { testDate: Date.now(), result: 'negative', expiryDate: Date.now() + 15552000000, laboratory: 'ระบุห้องแล็บ...' })}>
                  <Plus className="h-4 w-4 mr-2" /> เพิ่มผลตรวจ (Add Test)
                </Button>
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
                          <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => { if(confirm('ลบรายการ?')) deleteDocumentNonBlocking(doc(firestore!, d._path)) }}><Trash2 className="h-4 w-4" /></Button>
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
                <Button className="bg-primary font-bold shadow-md" onClick={() => addDocumentNonBlocking(docsQuery!, { documentType: 'other', documentNo: '-', issueDate: Date.now(), expiryDate: Date.now() + 31536000000 })}>
                  <Plus className="h-4 w-4 mr-2" /> เพิ่มเอกสาร (Add Doc)
                </Button>
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
                        <TableCell className="text-xs">{new Date(d.expiryDate).toLocaleDateString('th-TH')}</TableCell>
                        <TableCell className="text-right pr-6">
                          <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => { if(confirm('ลบรายการ?')) deleteDocumentNonBlocking(doc(firestore!, d._path)) }}><Trash2 className="h-4 w-4" /></Button>
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
        </Tabs>
      </div>
    </AppShell>
  );
}
