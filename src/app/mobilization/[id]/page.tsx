'use client';

import { useState, use, useEffect } from 'react';
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
  ShieldCheck, 
  AlertCircle, 
  Clock, 
  CheckCircle2, 
  Truck,
  XCircle,
  ClipboardCheck,
  Info,
  ShieldAlert,
  Waves,
  HardHat,
  Package,
  History,
  CheckCircle,
  Loader2,
  FileText,
  Stethoscope,
  ChevronRight,
  MapPin,
  AlertTriangle
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
  ChecklistItemStatus,
  Wave,
  WorkerCertificate,
  PositionCertificateRequirement,
  WorkerMedicalRecord,
  MobilizationStatus,
  DeploymentStatus
} from '@/lib/types';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function MobilizationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
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

  const workerCertsQuery = useMemoFirebase(() => (firestore && assignment ? collection(firestore, 'workers', assignment.workerId, 'certificates') : null), [firestore, assignment?.workerId]);
  const { data: workerCerts } = useCollection<WorkerCertificate>(workerCertsQuery as any);

  const posRef = useMemoFirebase(() => (firestore && assignment ? doc(firestore, 'positions', assignment.positionId) : null), [firestore, assignment?.positionId]);
  const { data: position } = useDoc<Position>(posRef as any);

  const waveRef = useMemoFirebase(() => (firestore && assignment?.waveId ? doc(firestore, 'waves', assignment.waveId) : null), [firestore, assignment?.waveId]);
  const { data: wave } = useDoc<Wave>(waveRef as any);

  const customerRef = useMemoFirebase(() => (firestore && assignment ? doc(firestore, 'customers', assignment.customerId) : null), [firestore, assignment?.customerId]);
  const { data: customer } = useDoc<Customer>(customerRef as any);

  const handleUpdateMobStatus = (newStatus: MobilizationStatus, deploymentStatus?: DeploymentStatus) => {
    if (!firestore || !asgnPath) return;
    const updateData: any = { 
      mobilizationStatus: newStatus, 
      updatedAt: Date.now(),
      updatedBy: currentUser?.id
    };
    if (deploymentStatus) updateData.deploymentStatus = deploymentStatus;
    
    updateDocumentNonBlocking(doc(firestore, asgnPath), updateData);
    setAssignment(prev => prev ? ({ ...prev, ...updateData }) : null);
    toast({ title: "อัปเดตสถานะสำเร็จ", description: `เปลี่ยนสถานะเป็น ${newStatus} เรียบร้อยแล้ว` });
  };

  if (isLoading || !currentUser) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-12 w-12 text-primary animate-spin" /></div>;
  }

  if (!assignment) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="text-center py-20 space-y-4">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
          <h2 className="text-xl font-bold">ไม่พบข้อมูลการเตรียมความพร้อม</h2>
          <Button asChild variant="outline" onClick={() => router.push('/mobilization')}>กลับไปหน้ารายการ</Button>
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

  const isFullyReady = assignment.readinessStatus === 'ready';

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.push('/mobilization')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Mobilization Command Center (การเตรียมส่งตัว)</h1>
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <span className="font-mono">ID: {assignment.id}</span>
                <Separator orientation="vertical" className="h-3" />
                <span>{worker?.firstName} {worker?.lastName}</span>
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" className="text-sm py-1 px-4 border-primary/20 bg-primary/5 text-primary font-bold">
              MOB STATUS: {assignment.mobilizationStatus || 'PENDING'}
            </Badge>
            <Badge variant={isFullyReady ? 'default' : 'destructive'} className={isFullyReady ? 'bg-green-600' : ''}>
              READINESS: {assignment.readinessStatus.toUpperCase()}
            </Badge>
          </div>
        </div>

        {/* Readiness Warnings */}
        {!isFullyReady && (
          <Alert variant="destructive" className="bg-destructive/5 border-destructive/20">
            <AlertTriangle className="h-5 w-5" />
            <AlertTitle className="font-bold">ตรวจพบรายการที่ไม่สมบูรณ์ (Incomplete Readiness)</AlertTriangle>
            <AlertDescription>
              คนงานยังไม่ผ่านเกณฑ์ความพร้อมที่กำหนด กรุณาตรวจสอบแท็บ "ภาพรวมความพร้อม" เพื่อดูรายละเอียดสิ่งที่ขาดหายไป
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Area */}
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
                          <TableHead className="text-right">สถานะ</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <TableRow>
                          <TableCell>{getChecklistIcon(assignment.readinessSummary.passportValid)}</TableCell>
                          <TableCell className="font-medium text-sm">หนังสือเดินทาง / บัตรประชาชน (Passport/ID Valid)</TableCell>
                          <TableCell className="text-right capitalize text-xs">{assignment.readinessSummary.passportValid}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>{getChecklistIcon(assignment.readinessSummary.medicalValid)}</TableCell>
                          <TableCell className="font-medium text-sm">ใบรับรองแพทย์ (Medical Certificate Valid)</TableCell>
                          <TableCell className="text-right capitalize text-xs">{assignment.readinessSummary.medicalValid}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>{getChecklistIcon(assignment.readinessSummary.certificatesComplete)}</TableCell>
                          <TableCell className="font-medium text-sm">ใบเซอร์บังคับประจำตำแหน่ง (Position Certificates)</TableCell>
                          <TableCell className="text-right capitalize text-xs">{assignment.readinessSummary.certificatesComplete}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>{getChecklistIcon(assignment.readinessSummary.clientApproved)}</TableCell>
                          <TableCell className="font-medium text-sm">ได้รับการอนุมัติจากลูกค้า (Client Approval)</TableCell>
                          <TableCell className="text-right capitalize text-xs">{assignment.readinessSummary.clientApproved}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>{getChecklistIcon(assignment.readinessSummary.ppeIssued)}</TableCell>
                          <TableCell className="font-medium text-sm">เบิกอุปกรณ์ PPE ครบถ้วน (PPE Issued)</TableCell>
                          <TableCell className="text-right capitalize text-xs">{assignment.readinessSummary.ppeIssued}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>{getChecklistIcon(assignment.readinessSummary.toolsIssued)}</TableCell>
                          <TableCell className="font-medium text-sm">เบิกเครื่องมือช่าง (Tools Issued)</TableCell>
                          <TableCell className="text-right capitalize text-xs">{assignment.readinessSummary.toolsIssued}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card className="border-primary/20 bg-primary/5">
                  <CardHeader><CardTitle className="text-lg">การดำเนินการสุดท้าย (Final Clearance)</CardTitle></CardHeader>
                  <CardContent className="flex flex-wrap gap-3">
                    <Button 
                      disabled={!isFullyReady || assignment.mobilizationStatus === 'MOBILIZING'}
                      onClick={() => handleUpdateMobStatus('READY_TO_MOBILIZE', 'READY')}
                      className="bg-green-600 hover:bg-green-700 font-bold"
                    >
                      <CheckCircle2 className="h-4 w-4 mr-2" /> ยืนยันความพร้อมเดินทาง (Confirm Mob)
                    </Button>
                    <Button 
                      variant="outline"
                      className="border-blue-600 text-blue-600 hover:bg-blue-50"
                      onClick={() => handleUpdateMobStatus('MOBILIZING', 'MOBILIZING')}
                    >
                      <Truck className="h-4 w-4 mr-2" /> เริ่มระดมพล (Start Mobilizing)
                    </Button>
                    <Button 
                      disabled={assignment.mobilizationStatus !== 'MOBILIZING'}
                      className="bg-blue-900"
                      onClick={() => handleUpdateMobStatus('ACTIVE', 'ACTIVE')}
                    >
                      <CheckCircle className="h-4 w-4 mr-2" /> เข้าหน้างานแล้ว (Mark as Active)
                    </Button>
                  </CardContent>
                  <CardFooter className="border-t pt-4">
                    <p className="text-[10px] text-muted-foreground italic">หมายเหตุ: ปุ่ม Confirm Mob จะเปิดให้กดเมื่อรายการ Checklist ทั้งหมดเป็น 'pass'</p>
                  </CardFooter>
                </Card>
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
                              <p className="text-[10px] text-muted-foreground">Expires: {new Date(cert.expiryDate).toLocaleDateString('th-TH')}</p>
                            </div>
                          </div>
                          <Badge variant={cert.status === 'valid' ? 'outline' : 'destructive'} className={cert.status === 'valid' ? 'text-green-600 border-green-200' : ''}>
                            {cert.status.toUpperCase()}
                          </Badge>
                        </div>
                      ))}
                      {(!workerCerts || workerCerts.length === 0) && (
                        <div className="text-center py-10 text-muted-foreground italic border-2 border-dashed rounded-lg">
                          ไม่มีข้อมูลใบเซอร์ในระบบ
                        </div>
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
                  <Button asChild variant="outline" size="sm">
                    <Link href="/store" className="gap-2">ไปที่คลังอุปกรณ์ <ArrowRight className="h-4 w-4" /></Link>
                  </Button>
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
                          <p className="text-xs text-muted-foreground">{new Date(assignment.updatedAt).toLocaleString('th-TH')}</p>
                          <p className="text-xs mt-1">Personnel assigned to wave and entered mobilization queue</p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          {/* Sidebar */}
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
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="space-y-1">
                        <p className="text-muted-foreground uppercase text-[9px] font-bold">Passport No:</p>
                        <p className="font-medium">{worker.passportNo || 'N/A'}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-muted-foreground uppercase text-[9px] font-bold">Readiness:</p>
                        <Badge variant="outline" className="text-[9px] font-bold h-5">{worker.readinessStatus}</Badge>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" className="w-full text-xs h-8" asChild>
                      <Link href={`/workers/${worker.id}`}>ดูประวัติคนงานแบบเต็ม <ChevronRight className="h-3 w-3 ml-1" /></Link>
                    </Button>
                  </>
                ) : <div className="animate-pulse h-20 bg-muted rounded" />}
              </CardContent>
            </Card>

            <Card className="bg-primary/5 border-primary/10 shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">ข้อมูลโครงการ & เวฟ</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-2">
                <div className="space-y-1">
                  <p className="text-[9px] text-muted-foreground uppercase font-bold">ลูกค้า (Client):</p>
                  <p className="text-xs font-bold flex items-center gap-1"><Building2 className="h-3 w-3" /> {customer?.name || '...'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[9px] text-muted-foreground uppercase font-bold">รอบการส่งตัว (Wave):</p>
                  <p className="text-xs font-bold text-primary flex items-center gap-1"><Waves className="h-3 w-3" /> {wave?.waveCode || '...'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[9px] text-muted-foreground uppercase font-bold">สถานที่ (Site):</p>
                  <p className="text-xs font-medium flex items-center gap-1"><MapPin className="h-3 w-3" /> {wave?.siteLocation || '...'}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-dashed border-primary/30">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2 text-primary font-bold">
                  <Info className="h-4 w-4" /> ขั้นตอนถัดไป
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground leading-relaxed">
                {isFullyReady ? (
                  "พร้อมสำหรับ Mobilization: คุณสามารถกดยืนยันการส่งตัวเพื่อเปลี่ยนสถานะพนักงานเป็น 'MOBILIZING' และเริ่มจองตั๋วเดินทาง"
                ) : (
                  "รอการแก้ไข: ตรวจสอบรายการที่แสดงเป็น 'warning' หรือ 'fail' ในแท็บ Overview เพื่อดำเนินการแก้ไขให้ครบถ้วน"
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
