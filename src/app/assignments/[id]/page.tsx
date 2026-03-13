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
  ShieldAlert,
  Waves,
  HardHat,
  Package,
  History,
  CheckCircle
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useUser, useCollection } from '@/firebase';
import { doc, collectionGroup, query, where, getDocs, limit, collection, updateDoc } from 'firebase/firestore';
import { updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { 
  Assignment, 
  Worker, 
  PurchaseOrder, 
  Customer, 
  Position, 
  User as AppUser, 
  DeploymentStatus, 
  ClientApprovalStatus,
  WorkerCertificate,
  WorkerMedicalRecord,
  WorkerDrugTest,
  PositionCertificateRequirement,
  Wave,
  ChecklistItemStatus
} from '@/lib/types';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

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

  const isAuthorized = useMemo(() => {
    return !!(currentUser?.roleIds && currentUser.roleIds.length > 0);
  }, [currentUser]);

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [asgnPath, setAsgnPath] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function findAssignment() {
      if (!firestore || !isAuthorized) {
        setIsLoading(false);
        return;
      }
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
  }, [firestore, id, isAuthorized]);

  const workerRef = useMemoFirebase(() => (firestore && assignment && isAuthorized ? doc(firestore, 'workers', assignment.workerId) : null), [firestore, assignment?.workerId, isAuthorized]);
  const { data: worker } = useDoc<Worker>(workerRef as any);

  const poRef = useMemoFirebase(() => (firestore && assignment && isAuthorized ? doc(firestore, 'purchase_orders', assignment.poId) : null), [firestore, assignment?.poId, isAuthorized]);
  const { data: po } = useDoc<PurchaseOrder>(poRef as any);

  const customerRef = useMemoFirebase(() => (firestore && assignment && isAuthorized ? doc(firestore, 'customers', assignment.customerId) : null), [firestore, assignment?.customerId, isAuthorized]);
  const { data: customer } = useDoc<Customer>(customerRef as any);

  const positionRef = useMemoFirebase(() => (firestore && assignment && isAuthorized ? doc(firestore, 'positions', assignment.positionId) : null), [firestore, assignment?.positionId, isAuthorized]);
  const { data: position } = useDoc<Position>(positionRef as any);

  const waveRef = useMemoFirebase(() => (firestore && assignment?.waveId && isAuthorized ? doc(firestore, 'waves', assignment.waveId) : null), [firestore, assignment?.waveId, isAuthorized]);
  const { data: wave } = useDoc<Wave>(waveRef as any);

  // Overlap Detection
  const overlapsQuery = useMemoFirebase(() => {
    if (!firestore || !assignment || !isAuthorized) return null;
    return query(collectionGroup(firestore, 'assignments'), where('workerId', '==', assignment.workerId));
  }, [firestore, assignment?.workerId, isAuthorized]);
  const { data: otherAssignments } = useCollection<Assignment>(overlapsQuery as any);

  const handleUpdateStatus = (newStatus: DeploymentStatus) => {
    if (!firestore || !asgnPath) return;
    const updateData: any = { deploymentStatus: newStatus, updatedAt: Date.now() };
    updateDocumentNonBlocking(doc(firestore, asgnPath), updateData);
    setAssignment(prev => prev ? ({ ...prev, ...updateData }) : null);
    toast({ title: "อัปเดตสถานะสำเร็จ", description: `เปลี่ยนสถานะเป็น ${newStatus} เรียบร้อยแล้ว` });
  };

  const handleUpdateClientStatus = (newStatus: ClientApprovalStatus) => {
    if (!firestore || !asgnPath) return;
    const updateData: any = { clientApprovalStatus: newStatus, updatedAt: Date.now() };
    updateDocumentNonBlocking(doc(firestore, asgnPath), updateData);
    setAssignment(prev => prev ? ({ ...prev, ...updateData }) : null);
    toast({ title: "อัปเดตการอนุมัติสำเร็จ", description: `เปลี่ยนสถานะเป็น ${newStatus} เรียบร้อยแล้ว` });
  };

  if (isLoading || isUserLoading || !currentUser) {
    return <div className="flex items-center justify-center min-h-screen"><Clock className="h-12 w-12 text-primary animate-pulse" /></div>;
  }

  if (!isAuthorized) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <ShieldAlert className="h-12 w-12 text-muted-foreground opacity-50" />
          <h2 className="text-xl font-bold">Access Pending (รอนุมัติสิทธิ์)</h2>
          <p className="text-muted-foreground max-w-md">บัญชีของคุณยังไม่ได้รับอนุญาตให้เข้าถึงข้อมูลรายละเอียดการมอบหมายงาน</p>
        </div>
      </AppShell>
    );
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

  const hasOverlap = otherAssignments?.some(a => 
    a.id !== assignment.id && 
    a.deploymentStatus !== 'CLOSED' && 
    a.deploymentStatus !== 'DEMOBILIZED' &&
    ((a.startDate >= assignment.startDate && a.startDate <= assignment.endDate) ||
     (a.endDate >= assignment.startDate && a.endDate <= assignment.endDate))
  );

  const getChecklistIcon = (status: ChecklistItemStatus) => {
    switch(status) {
      case 'pass': return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'warning': return <AlertCircle className="h-5 w-5 text-amber-500" />;
      case 'fail': return <XCircle className="h-5 w-5 text-red-600" />;
      default: return <Clock className="h-5 w-5 text-muted-foreground" />;
    }
  };

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
          <div className="flex gap-2">
            <Badge variant="outline" className="text-sm py-1 px-4 border-primary/20">
              DEPLOYMENT: {assignment.deploymentStatus}
            </Badge>
            <Badge variant={assignment.readinessStatus === 'ready' ? 'default' : 'destructive'} className={assignment.readinessStatus === 'ready' ? 'bg-green-600' : ''}>
              READINESS: {assignment.readinessStatus.toUpperCase()}
            </Badge>
          </div>
        </div>

        {/* Overlap Warning */}
        {hasOverlap && (
          <Alert variant="destructive" className="bg-destructive/5 border-destructive/20">
            <AlertCircle className="h-5 w-5" />
            <AlertTitle className="font-bold">ตรวจพบตารางงานทับซ้อน (Date Overlap Detected)</AlertTitle>
            <AlertDescription>
              Worker รายนี้มีตารางงานอื่นในช่วงเวลาเดียวกัน กรุณาตรวจสอบแผนงานเพื่อป้องกันความผิดพลาดในการส่งตัว
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content Area */}
          <div className="lg:col-span-2 space-y-6">
            <Tabs defaultValue="info" className="w-full">
              <TabsList className="grid grid-cols-5 w-full h-auto p-1 bg-muted/50">
                <TabsTrigger value="info" className="gap-2 py-2 text-xs">ข้อมูลมอบหมาย</TabsTrigger>
                <TabsTrigger value="readiness" className="gap-2 py-2 text-xs">ความพร้อม</TabsTrigger>
                <TabsTrigger value="approval" className="gap-2 py-2 text-xs">การอนุมัติ</TabsTrigger>
                <TabsTrigger value="ppe" className="gap-2 py-2 text-xs">PPE/เครื่องมือ</TabsTrigger>
                <TabsTrigger value="history" className="gap-2 py-2 text-xs">ประวัติ</TabsTrigger>
              </TabsList>

              <TabsContent value="info" className="mt-6 space-y-6">
                <Card>
                  <CardHeader><CardTitle className="text-lg">ข้อมูลงานและกำหนดการ (Assignment Schedule)</CardTitle></CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid grid-cols-2 gap-6 text-sm">
                      <div className="space-y-1">
                        <p className="text-muted-foreground uppercase text-[10px] font-bold">ตำแหน่งงาน:</p>
                        <p className="font-bold text-lg text-primary">{position?.positionName || assignment.positionId}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-muted-foreground uppercase text-[10px] font-bold">รอบการทำงาน (Wave):</p>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                            <Waves className="h-3 w-3 mr-1" /> {wave?.waveCode || 'N/A'}
                          </Badge>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <p className="text-muted-foreground uppercase text-[10px] font-bold">วันที่เริ่มงาน (Start):</p>
                        <p className="font-medium flex items-center gap-2"><Calendar className="h-4 w-4" /> {assignment.startDate}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-muted-foreground uppercase text-[10px] font-bold">วันที่สิ้นสุด (End):</p>
                        <p className="font-medium flex items-center gap-2"><Calendar className="h-4 w-4" /> {assignment.endDate}</p>
                      </div>
                    </div>
                    <Separator />
                    <div className="space-y-2">
                      <p className="text-muted-foreground uppercase text-[10px] font-bold">หมายเหตุ:</p>
                      <p className="text-sm italic">{assignment.notes || 'ไม่มีหมายเหตุ'}</p>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle className="text-lg">การดำเนินการ (Operational Actions)</CardTitle></CardHeader>
                  <CardContent className="flex flex-wrap gap-3">
                    {assignment.deploymentStatus === 'DRAFT' && (
                      <Button onClick={() => handleUpdateStatus('READINESS_CHECK')} className="gap-2 bg-amber-600 hover:bg-amber-700">
                        <ClipboardCheck className="h-4 w-4" /> เริ่มตรวจสอบความพร้อม
                      </Button>
                    )}
                    {assignment.deploymentStatus === 'READINESS_CHECK' && assignment.readinessStatus === 'ready' && (
                      <Button onClick={() => handleUpdateStatus('READY')} className="gap-2 bg-green-600 hover:bg-green-700">
                        <CheckCircle2 className="h-4 w-4" /> ยืนยันความพร้อม (Set Ready)
                      </Button>
                    )}
                    {assignment.deploymentStatus === 'CLIENT_APPROVED' && (
                      <Button onClick={() => handleUpdateStatus('MOBILIZING')} className="gap-2 bg-blue-600 hover:bg-blue-700">
                        <Truck className="h-4 w-4" /> เริ่มระดมพล (Mobilizing)
                      </Button>
                    )}
                    <Button variant="outline" className="text-destructive border-destructive" onClick={() => handleUpdateStatus('CLOSED')}>
                      <XCircle className="h-4 w-4" /> ยกเลิก / ปิดงาน
                    </Button>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="readiness" className="mt-6 space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <ClipboardCheck className="h-5 w-5 text-primary" /> รายการตรวจสอบความพร้อม (Readiness Checklist)
                    </CardTitle>
                    <CardDescription>การตรวจสอบความสมบูรณ์ก่อนส่งตัวคนงานเข้าหน้างานจริง</CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader className="bg-muted/30">
                        <TableRow>
                          <TableHead className="w-[50px]"></TableHead>
                          <TableHead>หัวข้อการตรวจสอบ (Compliance Item)</TableHead>
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
                          <TableCell className="font-medium text-sm">ใบเซอร์บังคับประจำตำแหน่ง (Mandatory Certificates)</TableCell>
                          <TableCell className="text-right capitalize text-xs">{assignment.readinessSummary.certificatesComplete}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>{getChecklistIcon(assignment.readinessSummary.overlapClear)}</TableCell>
                          <TableCell className="font-medium text-sm">ไม่มีงานทับซ้อน (No Schedule Overlap)</TableCell>
                          <TableCell className="text-right capitalize text-xs">{assignment.readinessSummary.overlapClear}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>{getChecklistIcon(assignment.readinessSummary.clientApproved)}</TableCell>
                          <TableCell className="font-medium text-sm">ได้รับการอนุมัติจากลูกค้า (Client Approved)</TableCell>
                          <TableCell className="text-right capitalize text-xs">{assignment.readinessSummary.clientApproved}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </CardContent>
                  <CardFooter className="bg-muted/20 py-4 flex justify-between border-t">
                    <p className="text-xs text-muted-foreground italic">อัปเดตล่าสุดเมื่อ: {assignment.readinessUpdatedAt ? new Date(assignment.readinessUpdatedAt).toLocaleString('th-TH') : '-'}</p>
                    <Button variant="outline" size="sm">ตรวจสอบใหม่อีกครั้ง (Re-verify)</Button>
                  </CardFooter>
                </Card>
              </TabsContent>

              <TabsContent value="approval" className="mt-6 space-y-6">
                <Card>
                  <CardHeader><CardTitle className="text-lg">สถานะการอนุมัติโดยลูกค้า (Client Consideration)</CardTitle></CardHeader>
                  <CardContent className="space-y-6">
                    <div className="flex items-center gap-4">
                      <p className="text-sm font-bold">สถานะปัจจุบัน:</p>
                      <Badge variant={assignment.clientApprovalStatus === 'APPROVED' ? 'default' : 'secondary'} className={assignment.clientApprovalStatus === 'APPROVED' ? 'bg-green-600' : ''}>
                        {assignment.clientApprovalStatus}
                      </Badge>
                    </div>
                    <Separator />
                    <div className="grid grid-cols-2 gap-4">
                      <Button onClick={() => handleUpdateClientStatus('SUBMITTED')} variant="outline" className="gap-2"><Send className="h-4 w-4" /> ส่งให้ลูกค้าพิจารณา</Button>
                      <Button onClick={() => handleUpdateClientStatus('APPROVED')} className="gap-2 bg-green-600 hover:bg-green-700"><CheckCircle2 className="h-4 w-4" /> บันทึกการอนุมัติ (Approved)</Button>
                      <Button onClick={() => handleUpdateClientStatus('REJECTED')} variant="outline" className="gap-2 text-destructive border-destructive"><XCircle className="h-4 w-4" /> ปฏิเสธ (Rejected)</Button>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="ppe" className="mt-6 space-y-6">
                <div className="py-20 text-center text-muted-foreground italic border-2 border-dashed rounded-lg bg-muted/10">
                  <Package className="h-12 w-12 mx-auto mb-4 opacity-20" />
                  ระบบจัดการเบิก-คืน PPE และเครื่องมือรายบุคคล อยู่ในระหว่างการพัฒนา
                </div>
              </TabsContent>

              <TabsContent value="history" className="mt-6 space-y-6">
                <Card>
                  <CardHeader><CardTitle className="text-lg flex items-center gap-2"><History className="h-5 w-5" /> ประวัติการเปลี่ยนแปลงสถานะ</CardTitle></CardHeader>
                  <CardContent>
                    <div className="text-sm space-y-4">
                      <div className="flex gap-4 border-l-2 border-primary/20 pl-4 relative">
                        <div className="absolute -left-[9px] top-0 h-4 w-4 rounded-full bg-primary" />
                        <div>
                          <p className="font-bold">CREATED</p>
                          <p className="text-xs text-muted-foreground">{new Date(assignment.createdAt).toLocaleString('th-TH')}</p>
                          <p className="text-xs mt-1">Assignment created in system</p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          {/* Sidebar Area: Context Cards */}
          <div className="space-y-6">
            <Card>
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <User className="h-4 w-4 text-primary" /> ข้อมูลคนงาน (Worker Profile)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                {worker ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-xl">
                        {worker.firstName.charAt(0)}
                      </div>
                      <div>
                        <h3 className="font-bold text-base">{worker.firstName} {worker.lastName}</h3>
                        <p className="text-xs text-muted-foreground font-mono">{worker.thaiNationalId}</p>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Readiness:</span>
                        <Badge variant="outline" className={worker.readinessStatus === 'READY' ? 'text-green-600 border-green-200' : 'text-red-600 border-red-200'}>
                          {worker.readinessStatus}
                        </Badge>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Status:</span>
                        <span className="font-bold capitalize">{worker.workerStatus}</span>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" className="w-full text-xs" asChild>
                      <Link href={`/workers/${worker.id}`}>ดูประวัติเต็ม <ChevronRight className="h-4 w-4 ml-1" /></Link>
                    </Button>
                  </div>
                ) : <p className="text-xs text-muted-foreground animate-pulse">Loading worker data...</p>}
              </CardContent>
            </Card>

            <Card className="bg-primary/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">ข้อมูลโครงการ & PO</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-2">
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase font-bold">ลูกค้า:</p>
                  <p className="text-sm font-semibold">{customer?.name || '...'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase font-bold">รหัสใบสั่งซื้อ (PO):</p>
                  <p className="text-sm font-mono font-bold text-primary">{po?.poCode || '...'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase font-bold">โครงการ:</p>
                  <p className="text-xs font-medium">{assignment.projectName}</p>
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
                {assignment.readinessStatus === 'incomplete' ? (
                  "ขั้นตอนถัดไป: ไปที่ Readiness Check หรือ Store เพื่อเตรียมเอกสารและอุปกรณ์ให้ครบ"
                ) : (
                  "สถานะพร้อมแล้ว: สามารถส่งต่อไปที่เมนู Mobilization เพื่อเตรียมเดินทางได้"
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
