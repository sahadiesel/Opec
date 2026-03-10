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
  AlertTriangle
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
  User, 
  Position, 
  PositionCertificateRequirement,
  ReadinessStatus
} from '@/lib/types';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';

export default function WorkerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
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
          <div className="animate-pulse text-muted-foreground">กำลังโหลดข้อมูลคนงาน...</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/workers"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{worker.firstName} {worker.lastName}</h1>
              <Badge variant="outline" className="font-mono">{worker.thaiNationalId}</Badge>
              {worker.readinessStatus === 'READY' ? (
                <Badge className="bg-green-600 gap-1"><CheckCircle2 className="h-3 w-3" /> READY</Badge>
              ) : (
                <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" /> {worker.readinessStatus}</Badge>
              )}
            </div>
            <p className="text-muted-foreground">{worker.nickname ? `ชื่อเล่น: ${worker.nickname} | ` : ''}สถานะ: {worker.workerStatus.toUpperCase()}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setEditedWorker(worker); setIsEditing(!isEditing); }}>
              {isEditing ? 'ยกเลิก' : 'แก้ไขประวัติ'}
            </Button>
            {isEditing && (
              <Button className="gap-2" onClick={handleSaveMaster}>
                <Save className="h-4 w-4" /> บันทึก
              </Button>
            )}
          </div>
        </div>

        <Tabs defaultValue="info" className="w-full">
          <TabsList className="grid grid-cols-5 w-full md:w-fit h-auto p-1 bg-muted/50">
            <TabsTrigger value="info" className="gap-2 py-2 px-4"><ShieldCheck className="h-4 w-4" /> ข้อมูลประวัติ</TabsTrigger>
            <TabsTrigger value="certs" className="gap-2 py-2 px-4"><FileText className="h-4 w-4" /> ใบเซอร์</TabsTrigger>
            <TabsTrigger value="medical" className="gap-2 py-2 px-4"><Stethoscope className="h-4 w-4" /> ตรวจร่างกาย</TabsTrigger>
            <TabsTrigger value="drug" className="gap-2 py-2 px-4"><AlertCircle className="h-4 w-4" /> สารเสพติด</TabsTrigger>
            <TabsTrigger value="docs" className="gap-2 py-2 px-4"><FileSearch className="h-4 w-4" /> เอกสารอื่น ๆ</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="mt-6">
            <Card>
              <CardHeader><CardTitle>ข้อมูลประวัติส่วนบุคคล</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <Label>ชื่อจริง</Label>
                    <Input disabled={!isEditing} value={isEditing ? editedWorker.firstName : worker.firstName} onChange={e => setEditedWorker({...editedWorker, firstName: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>นามสกุล</Label>
                    <Input disabled={!isEditing} value={isEditing ? editedWorker.lastName : worker.lastName} onChange={e => setEditedWorker({...editedWorker, lastName: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>ชื่อเล่น</Label>
                    <Input disabled={!isEditing} value={isEditing ? editedWorker.nickname : worker.nickname} onChange={e => setEditedWorker({...editedWorker, nickname: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>เลขบัตรประชาชน</Label>
                    <Input disabled={!isEditing} value={isEditing ? editedWorker.thaiNationalId : worker.thaiNationalId} onChange={e => setEditedWorker({...editedWorker, thaiNationalId: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>เลขพาสปอร์ต</Label>
                    <Input disabled={!isEditing} value={isEditing ? editedWorker.passportNo : worker.passportNo} onChange={e => setEditedWorker({...editedWorker, passportNo: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>เบอร์โทรศัพท์</Label>
                    <Input disabled={!isEditing} value={isEditing ? editedWorker.contactPhone : worker.contactPhone} onChange={e => setEditedWorker({...editedWorker, contactPhone: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>ตำแหน่งหลัก (Primary)</Label>
                    <Select disabled={!isEditing} onValueChange={v => setEditedWorker({...editedWorker, currentPositionId: v})} value={isEditing ? editedWorker.currentPositionId : worker.currentPositionId}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {allPositions?.map(p => (
                          <SelectItem key={p.id} value={p.id}>{p.positionName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>ผู้ติดต่อฉุกเฉิน</Label>
                    <Input disabled={!isEditing} value={isEditing ? editedWorker.emergencyContactName : worker.emergencyContactName} onChange={e => setEditedWorker({...editedWorker, emergencyContactName: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>เบอร์โทรฉุกเฉิน</Label>
                    <Input disabled={!isEditing} value={isEditing ? editedWorker.emergencyContactPhone : worker.emergencyContactPhone} onChange={e => setEditedWorker({...editedWorker, emergencyContactPhone: e.target.value})} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>ที่อยู่ปัจจุบัน</Label>
                  <Textarea disabled={!isEditing} value={isEditing ? editedWorker.address : worker.address} onChange={e => setEditedWorker({...editedWorker, address: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>หมายเหตุ</Label>
                  <Textarea disabled={!isEditing} value={isEditing ? editedWorker.notes : worker.notes} onChange={e => setEditedWorker({...editedWorker, notes: e.target.value})} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="certs">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>รายการใบรับรอง (Certificates)</CardTitle>
                  <CardDescription>จัดการใบเซอร์และวันหมดอายุ</CardDescription>
                </div>
                <Button onClick={() => addDocumentNonBlocking(certsQuery!, { certificateName: 'New Certificate', issueDate: Date.now(), expiryDate: Date.now() + 31536000000, status: 'valid' })}>
                  <Plus className="h-4 w-4 mr-2" /> เพิ่มใบเซอร์
                </Button>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ชื่อใบเซอร์</TableHead>
                      <TableHead>เลขที่</TableHead>
                      <TableHead>วันหมดอายุ</TableHead>
                      <TableHead>สถานะ</TableHead>
                      <TableHead className="text-right">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {certs?.map(c => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.certificateName}</TableCell>
                        <TableCell>{c.certificateNo}</TableCell>
                        <TableCell className={c.expiryDate < Date.now() ? 'text-destructive font-bold' : ''}>
                          {new Date(c.expiryDate).toLocaleDateString('th-TH')}
                        </TableCell>
                        <TableCell><Badge>{c.status}</Badge></TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" onClick={() => deleteDocumentNonBlocking(doc(firestore!, c._path))}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="medical">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>ประวัติตรวจร่างกาย (Medical Records)</CardTitle>
                  <CardDescription>ข้อมูลการตรวจสุขภาพและผลความพร้อม</CardDescription>
                </div>
                <Button onClick={() => addDocumentNonBlocking(medicalsQuery!, { medicalType: 'General Health', examDate: Date.now(), expiryDate: Date.now() + 31536000000, fitStatus: 'fit' })}>
                  <Plus className="h-4 w-4 mr-2" /> เพิ่มผลตรวจ
                </Button>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ประเภทการตรวจ</TableHead>
                      <TableHead>วันที่ตรวจ</TableHead>
                      <TableHead>วันหมดอายุ</TableHead>
                      <TableHead>ผลการตรวจ</TableHead>
                      <TableHead className="text-right">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {medicals?.map(m => (
                      <TableRow key={m.id}>
                        <TableCell className="font-medium">{m.medicalType}</TableCell>
                        <TableCell>{new Date(m.examDate).toLocaleDateString('th-TH')}</TableCell>
                        <TableCell>{new Date(m.expiryDate).toLocaleDateString('th-TH')}</TableCell>
                        <TableCell>
                          <Badge variant={m.fitStatus === 'fit' ? 'default' : 'destructive'}>{m.fitStatus}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" onClick={() => deleteDocumentNonBlocking(doc(firestore!, m._path))}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="drug">
             <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>ผลตรวจสารเสพติด (Drug Tests)</CardTitle>
                  <CardDescription>การตรวจสอบเพื่อความปลอดภัยในการทำงาน</CardDescription>
                </div>
                <Button onClick={() => addDocumentNonBlocking(drugTestsQuery!, { testDate: Date.now(), result: 'negative', expiryDate: Date.now() + 15552000000, laboratory: 'Central Lab' })}>
                  <Plus className="h-4 w-4 mr-2" /> เพิ่มผลตรวจ
                </Button>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>วันที่ตรวจ</TableHead>
                      <TableHead>ห้องแล็บ</TableHead>
                      <TableHead>ผลตรวจ</TableHead>
                      <TableHead>วันหมดอายุ</TableHead>
                      <TableHead className="text-right">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {drugTests?.map(d => (
                      <TableRow key={d.id}>
                        <TableCell>{new Date(d.testDate).toLocaleDateString('th-TH')}</TableCell>
                        <TableCell>{d.laboratory}</TableCell>
                        <TableCell>
                          <Badge variant={d.result === 'negative' ? 'default' : 'destructive'}>{d.result}</Badge>
                        </TableCell>
                        <TableCell>{new Date(d.expiryDate).toLocaleDateString('th-TH')}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" onClick={() => deleteDocumentNonBlocking(doc(firestore!, d._path))}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="docs">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>เอกสารประจำตัวและอื่น ๆ (Documents)</CardTitle>
                  <CardDescription>จัดเก็บสำเนาบัตรประชาชน พาสปอร์ต และทะเบียนบ้าน</CardDescription>
                </div>
                <Button onClick={() => addDocumentNonBlocking(docsQuery!, { documentType: 'other', documentNo: '-', issueDate: Date.now(), expiryDate: Date.now() + 31536000000 })}>
                  <Plus className="h-4 w-4 mr-2" /> เพิ่มเอกสาร
                </Button>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ประเภทเอกสาร</TableHead>
                      <TableHead>เลขที่เอกสาร</TableHead>
                      <TableHead>วันหมดอายุ</TableHead>
                      <TableHead className="text-right">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {workerDocs?.map(d => (
                      <TableRow key={d.id}>
                        <TableCell className="capitalize">{d.documentType}</TableCell>
                        <TableCell>{d.documentNo}</TableCell>
                        <TableCell>{new Date(d.expiryDate).toLocaleDateString('th-TH')}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" onClick={() => deleteDocumentNonBlocking(doc(firestore!, d._path))}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
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
