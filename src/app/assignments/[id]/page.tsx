'use client';

import { useState, use, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  ArrowLeft, 
  User, 
  Briefcase, 
  Building2, 
  Calendar, 
  ShieldCheck, 
  AlertCircle, 
  Clock, 
  CheckCircle2, 
  FileText,
  Send,
  Truck,
  XCircle,
  ChevronRight,
  ClipboardCheck,
  Stethoscope,
  Info,
  ShieldAlert
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useUser, useCollection } from '@/firebase';
import { doc, collectionGroup, query, where, getDocs, limit, collection } from 'firebase/firestore';
import { updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { 
  Assignment, 
  Worker, 
  PurchaseOrder, 
  Customer, 
  Position, 
  User as AppUser, 
  AssignmentStatus, 
  ClientApprovalStatus,
  WorkerCertificate,
  WorkerMedicalRecord,
  WorkerDrugTest,
  PositionCertificateRequirement
} from '@/lib/types';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function AssignmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) {
      try {
        setCurrentUser(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to parse user session', e);
      }
    }
  }, []);

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [asgnPath, setAsgnPath] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function findAssignment() {
      if (!firestore) return;
      try {
        const q = query(collectionGroup(firestore, 'assignments'), where('id', '==', id), limit(1));
        const snap = await getDocs(q);
        if (!snap.empty) {
          setAssignment(snap.docs[0].data() as Assignment);
          setAsgnPath(snap.docs[0].ref.path);
        }
      } catch (err) {
        console.error('Failed to fetch assignment', err);
      } finally {
        setIsLoading(false);
      }
    }
    findAssignment();
  }, [firestore, id]);

  const workerRef = useMemoFirebase(() => (firestore && assignment ? doc(firestore, 'workers', assignment.workerId) : null), [firestore, assignment?.workerId]);
  const { data: worker } = useDoc<Worker>(workerRef as any);

  const poRef = useMemoFirebase(() => (firestore && assignment ? doc(firestore, 'purchase_orders', assignment.poId) : null), [firestore, assignment?.poId]);
  const { data: po } = useDoc<PurchaseOrder>(poRef as any);

  const customerRef = useMemoFirebase(() => (firestore && assignment ? doc(firestore, 'customers', assignment.customerId) : null), [firestore, assignment?.customerId]);
  const { data: customer } = useDoc<Customer>(customerRef as any);

  const positionRef = useMemoFirebase(() => (firestore && assignment ? doc(firestore, 'positions', assignment.positionId) : null), [firestore, assignment?.positionId]);
  const { data: position } = useDoc<Position>(positionRef as any);

  // Fetch Readiness Records
  const certsQuery = useMemoFirebase(() => (firestore && assignment ? collection(firestore, 'workers', assignment.workerId, 'certificates') : null), [firestore, assignment?.workerId]);
  const { data: workerCerts } = useCollection<WorkerCertificate>(certsQuery as any);

  const medicalsQuery = useMemoFirebase(() => (firestore && assignment ? collection(firestore, 'workers', assignment.workerId, 'medical_records') : null), [firestore, assignment?.workerId]);
  const { data: workerMedicals } = useCollection<WorkerMedicalRecord>(medicalsQuery as any);

  const drugTestsQuery = useMemoFirebase(() => (firestore && assignment ? collection(firestore, 'workers', assignment.workerId, 'drug_tests') : null), [firestore, assignment?.workerId]);
  const { data: workerDrugTests } = useCollection<WorkerDrugTest>(drugTestsQuery as any);

  const posReqsQuery = useMemoFirebase(() => (firestore && assignment ? collection(firestore, 'positions', assignment.positionId, 'certificate_requirements') : null), [firestore, assignment?.positionId]);
  const { data: posReqs } = useCollection<PositionCertificateRequirement>(posReqsQuery as any);

  const handleUpdateStatus = (newStatus: AssignmentStatus, clientStatus?: ClientApprovalStatus) => {
    if (!firestore || !asgnPath) return;
    const updateData: any = { status: newStatus, updatedAt: Date.now() };
    if (clientStatus) updateData.clientApprovalStatus = clientStatus;
    updateDocumentNonBlocking(doc(firestore, asgnPath), updateData);
    setAssignment(prev => prev ? ({ ...prev, ...updateData }) : null);
    toast({ title: "อัปเดตสถานะสำเร็จ", description: `เปลี่ยนสถานะเป็น ${newStatus.toUpperCase()} เรียบร้อยแล้ว` });
  };

  if (isLoading || isUserLoading || !currentUser) {
    return <div className="flex items-center justify-center min-h-screen"><Clock className="h-12 w-12 text-primary animate-pulse" /></div>;
  }

  if (!assignment) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="text-center py-20 space-y-4">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
          <h2 className="text-xl font-bold">ไม่พบข้อมูลการมอบหมาย</h2>
          <Button asChild variant="outline"><Link href="/assignments">กลับไปหน้ารายการ</Link></Button>
        </div>
      </AppShell>
    );
  }

  // Checklist Check Logic
  const now = Date.now();
  const mandatoryCerts = posReqs?.filter(r => r.required) || [];
  const certCheck = mandatoryCerts.every(req => 
    workerCerts?.some(c => c.certificateCode === req.certificateCode && c.expiryDate > now && c.status === 'valid')
  );
  const latestMed = workerMedicals?.sort((a,b) => b.expiryDate - a.expiryDate)[0];
  const medCheck = !!(latestMed && latestMed.expiryDate > now && latestMed.fitStatus === 'fit');
  const latestDrug = workerDrugTests?.sort((a,b) => b.testDate - a.testDate)[0];
  const drugCheck = !!(latestDrug && latestDrug.expiryDate > now && latestDrug.result === 'negative');

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.back()}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Assignment Detail (รายละเอียดการมอบหมาย)</h1>
              <p className="text-sm text-muted-foreground font-mono">ID: {assignment.id}</p>
            </div>
          </div>
          <Badge variant="outline" className="text-lg py-1 px-4">
            {assignment.status.toUpperCase()}
          </Badge>
        </div>

        {/* Warning Notice */}
        {assignment.status === 'mobilizing' && !worker?.readinessStatus.includes('READY') && (
          <Alert variant="destructive" className="bg-destructive/5">
            <ShieldAlert className="h-5 w-5" />
            <AlertTitle className="font-bold">คำเตือนด้านความปลอดภัย (Compliance Alert)</AlertTitle>
            <AlertDescription>
              คนงานยังไม่ผ่านเกณฑ์ความพร้อม (Readiness Matrix) กรุณาตรวจสอบ Checklist ด้านล่างก่อนเริ่มงานจริง
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Column 1: Main Info & Checklist */}
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader className="border-b bg-muted/20">
                <CardTitle className="flex items-center gap-2 text-primary">
                  <ClipboardCheck className="h-5 w-5" /> รายการตรวจสอบความพร้อม (Readiness Checklist)
                </CardTitle>
                <CardDescription>การตรวจสอบความพร้อมรายบุคคลตามเกณฑ์ Offshore มาตรฐาน</CardDescription>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-full ${certCheck ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                        <FileText className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-bold">ใบเซอร์บังคับ (Mandatory Certificates)</p>
                        <p className="text-xs text-muted-foreground">{mandatoryCerts.length} รายการที่ต้องมีตามตำแหน่ง {position?.positionName}</p>
                      </div>
                    </div>
                    {certCheck ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <AlertCircle className="h-5 w-5 text-red-600" />}
                  </div>

                  <div className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-full ${medCheck ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                        <Stethoscope className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-bold">การตรวจร่างกาย (Medical Fit-for-Duty)</p>
                        <p className="text-xs text-muted-foreground">ใบรับรองแพทย์ต้องไม่หมดอายุและระบุว่า "FIT"</p>
                      </div>
                    </div>
                    {medCheck ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <AlertCircle className="h-5 w-5 text-red-600" />}
                  </div>

                  <div className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-full ${drugCheck ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                        <ShieldCheck className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-bold">ผลตรวจสารเสพติด (Drug Test Result)</p>
                        <p className="text-xs text-muted-foreground">ต้องเป็นผลลบ (Negative) และอยู่ในระยะเวลา 6 เดือน</p>
                      </div>
                    </div>
                    {drugCheck ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <AlertCircle className="h-5 w-5 text-red-600" />}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3 border-b">
                <CardTitle className="flex items-center gap-2 text-primary">
                  <Briefcase className="h-5 w-5" /> ข้อมูลงานและสถานะ
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-6">
                <div className="grid grid-cols-2 gap-6 text-sm">
                  <div className="space-y-1">
                    <p className="text-muted-foreground">ตำแหน่งงาน:</p>
                    <p className="font-bold text-lg">{position?.positionName || assignment.positionId}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-muted-foreground">สถานะปัจจุบัน:</p>
                    <div className="pt-1">
                      <Badge className={assignment.status === 'active' ? 'bg-green-600' : ''}>{assignment.status.toUpperCase()}</Badge>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-muted-foreground">วันที่เริ่มงาน:</p>
                    <p className="font-medium flex items-center gap-2"><Calendar className="h-4 w-4" /> {new Date(assignment.startDate).toLocaleDateString('th-TH')}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-muted-foreground">วันที่สิ้นสุด:</p>
                    <p className="font-medium flex items-center gap-2"><Calendar className="h-4 w-4" /> {new Date(assignment.endDate).toLocaleDateString('th-TH')}</p>
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <h4 className="font-bold text-sm">การดำเนินการ (Quick Actions)</h4>
                  <div className="flex flex-wrap gap-2">
                    {assignment.status === 'proposed' && (
                      <Button className="gap-2 bg-blue-600 hover:bg-blue-700" onClick={() => handleUpdateStatus('client_review')}>
                        <Send className="h-4 w-4" /> ส่งพิจารณา (Client Review)
                      </Button>
                    )}
                    {assignment.status === 'approved' && (
                      <Button className="gap-2 bg-amber-600 hover:bg-amber-700" onClick={() => handleUpdateStatus('mobilizing')}>
                        <Truck className="h-4 w-4" /> เริ่มระดมพล (Mobilizing)
                      </Button>
                    )}
                    {assignment.status === 'mobilizing' && (
                      <Button disabled={!medCheck || !certCheck} className="gap-2 bg-green-600 hover:bg-green-700" onClick={() => handleUpdateStatus('active')}>
                        <CheckCircle2 className="h-4 w-4" /> เริ่มงานจริง (Set Active)
                      </Button>
                    )}
                    {['active', 'mobilizing', 'proposed', 'client_review', 'approved'].includes(assignment.status) && (
                      <Button variant="outline" className="text-destructive border-destructive" onClick={() => handleUpdateStatus('cancelled')}>
                        <XCircle className="h-4 w-4" /> ยกเลิกรายการ
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Column 2: Worker & Context */}
          <div className="space-y-6">
            <Card>
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <User className="h-4 w-4 text-primary" /> ข้อมูลคนงาน
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                {worker ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary">
                        {worker.firstName.charAt(0)}
                      </div>
                      <div>
                        <h3 className="font-bold text-base">{worker.firstName} {worker.lastName}</h3>
                        <p className="text-xs text-muted-foreground">{worker.thaiNationalId}</p>
                      </div>
                    </div>
                    <Badge variant={worker.readinessStatus === 'READY' ? 'default' : 'destructive'} className={worker.readinessStatus === 'READY' ? 'bg-green-600' : ''}>
                      System Status: {worker.readinessStatus}
                    </Badge>
                    <Button variant="outline" size="sm" className="w-full" asChild>
                      <Link href={`/workers/${worker.id}`}>ดูประวัติเต็ม <ChevronRight className="h-4 w-4 ml-1" /></Link>
                    </Button>
                  </div>
                ) : <p className="text-xs text-muted-foreground">Loading...</p>}
              </CardContent>
            </Card>

            <Card className="bg-muted/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">ข้อมูลโครงการ</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-2">
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase">ลูกค้า:</p>
                  <p className="text-sm font-semibold">{customer?.name || '...'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase">โครงการ:</p>
                  <p className="text-sm font-semibold">{assignment.projectName}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase">รหัสใบสั่งซื้อ:</p>
                  <p className="text-sm font-mono font-bold text-primary">{po?.poCode || '...'}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Guidance */}
        <Card className="bg-primary/5 border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2 text-primary font-bold">
              <Info className="h-5 w-5" /> แนวทางปฏิบัติขั้นตอนถัดไป (Next Steps)
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            ตรวจสอบรายการความพร้อมให้เป็นสีเขียวทั้งหมด เมื่อคนงานถึงหน้างานและผ่านการตรวจหน้างานเรียบร้อยแล้ว ให้กด <b>"เริ่มงานจริง (Set Active)"</b> เพื่อบันทึกเวลาทำงานในระบบ Timesheet ต่อไป
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
