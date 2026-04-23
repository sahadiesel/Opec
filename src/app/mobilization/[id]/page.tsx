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
  Building2
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection, getDoc } from 'firebase/firestore';
import { updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { formatDateThaiBE, formatDateTimeThaiBE } from '@/lib/date-thai';
import { 
  Assignment, 
  Worker, 
  Customer, 
  Position, 
  User as AppUser, 
  ChecklistItemStatus,
  Wave,
  WorkerCertificate,
  MobilizationStatus,
  DeploymentStatus,
  PurchaseOrder,
  MainContract
} from '@/lib/types';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccess, canEdit, canView, isMatrixControlledRole } from '@/lib/permissions';

export default function MobilizationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const useMatrixGuards = isMatrixControlledRole(currentUser);
  const canViewMobilization = useMatrixGuards ? canAccess(currentUser, 'mobilization', 'view') : canView(currentUser, 'mobilization');
  const canEditMobilization = useMatrixGuards ? canAccess(currentUser, 'mobilization', 'edit') : canEdit(currentUser, 'mobilization');

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Standardized fetch from 'mobilizations' top-level collection
  useEffect(() => {
    async function fetchMobilization() {
      if (!firestore || !canViewMobilization) return;
      try {
        const mobRef = doc(firestore, 'mobilizations', id);
        const snap = await getDoc(mobRef);
        if (snap.exists()) {
          setAssignment(snap.data() as Assignment);
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

  const posRef = useMemoFirebase(() => (firestore && assignment ? doc(firestore, 'positions', assignment.positionId) : null), [firestore, assignment?.positionId]);
  const { data: position } = useDoc<Position>(posRef as any);

  const waveRef = useMemoFirebase(() => (firestore && assignment?.waveId ? doc(firestore, 'waves', assignment.waveId) : null), [firestore, assignment?.waveId]);
  const { data: wave } = useDoc<Wave>(waveRef as any);

  const customerRef = useMemoFirebase(() => (firestore && assignment ? doc(firestore, 'customers', assignment.customerId) : null), [firestore, assignment?.customerId]);
  const { data: customer } = useDoc<Customer>(customerRef as any);

  const poRef = useMemoFirebase(() => (firestore && assignment?.poId ? doc(firestore, 'purchase_orders', assignment.poId) : null), [firestore, assignment?.poId]);
  const { data: po } = useDoc<PurchaseOrder>(poRef as any);

  const contractRef = useMemoFirebase(() => (firestore && assignment?.contractId ? doc(firestore, 'main_contracts', assignment.contractId) : null), [firestore, assignment?.contractId]);
  const { data: contract } = useDoc<MainContract>(contractRef as any);

  const handleUpdateMobStatus = (newStatus: MobilizationStatus, deploymentStatus?: DeploymentStatus) => {
    if (!canEditMobilization) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์แก้ไขสถานะ Mobilization' });
      return;
    }
    if (!firestore) return;
    const updateData: any = { 
      mobilizationStatus: newStatus, 
      updatedAt: Date.now(),
      updatedBy: currentUser?.id
    };
    if (deploymentStatus) updateData.deploymentStatus = deploymentStatus;
    
    const mobRef = doc(firestore, 'mobilizations', id);
    updateDocumentNonBlocking(mobRef, updateData);
    setAssignment(prev => prev ? ({ ...prev, ...updateData }) : null);
    toast({ title: "อัปเดตสถานะสำเร็จ", description: `เปลี่ยนสถานะเป็น ${newStatus} เรียบร้อยแล้ว` });
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
  const workerManageHref = (tab: string) => `/workers/${encodeURIComponent(workerId)}?tab=${encodeURIComponent(tab)}`;

  const isFullyReady = assignment.readinessStatus === 'ready';

  const finalClearanceDeploymentLabel = (() => {
    const ds = assignment.deploymentStatus;
    const ms = assignment.mobilizationStatus;
    if (ds === 'ACTIVE' || ms === 'ACTIVE') {
      return 'เข้าหน้างานแล้ว (ACTIVE) — ลงเวลา Wave Board ได้';
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

                <Card className="border-blue-200 bg-blue-50/80 text-blue-950">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Info className="h-4 w-4 shrink-0" />
                      ปุ่มสามขั้น — ทำอะไร แล้วไปต่อที่ไหน?
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm space-y-2 pt-0">
                    <ol className="list-decimal pl-4 space-y-1.5">
                      <li>
                        <strong>ยืนยันความพร้อมเดินทาง</strong> — ยืนยันว่าคนนี้ผ่านเกณฑ์ก่อนออกเดินทาง ระบบตั้งสถานะ deployment เป็น{' '}
                        <span className="font-mono">READY_TO_MOB</span> (ยังไม่ใช่ “ถึงไซต์”)
                      </li>
                      <li>
                        <strong>เริ่มระดมพล</strong> — กำลังเดินทาง / กำลังไปโครงการ (<span className="font-mono">MOBILIZING</span>)
                      </li>
                      <li>
                        <strong>เข้าหน้างานแล้ว</strong> — ถึงไซต์พร้อมลงเวลา (<span className="font-mono">ACTIVE</span>) ขั้นตอนถัดไปคือไปเมนู{' '}
                        <strong>ลงเวลา</strong> เพื่อบันทึกชั่วโมงรายวัน — ใช้ลิงก์ด้านล่างจะเปิด Wave Board ให้ตรง PO / Wave นี้โดยไม่ต้องเลือกซ้ำ
                      </li>
                    </ol>
                    <p className="text-xs text-blue-900/90">
                      รายชื่อใน Mobilization ยังอยู่ในระบบ — ถ้า “หาย” จากมุมมองหนึ่ง ให้ไปที่ Wave / Assignments หรือศูนย์ลงเวลา (ภาพรวม) เพื่อดูทั้งโครงการ
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-primary/20 bg-primary/5">
                  <CardHeader>
                    <CardTitle className="text-lg flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span>การดำเนินการสุดท้าย (Final Clearance)</span>
                      <span className="text-base font-semibold text-primary/90" title="สถานะ deployment ปัจจุบัน">
                        — {finalClearanceDeploymentLabel}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-3">
                    <Button 
                      disabled={!canEditMobilization || !isFullyReady || assignment.mobilizationStatus === 'MOBILIZING'}
                      onClick={() => handleUpdateMobStatus('READY_TO_MOBILIZE', 'READY_TO_MOB')}
                      className="bg-green-600 hover:bg-green-700 font-bold"
                    >
                      <CheckCircle2 className="h-4 w-4 mr-2" /> ยืนยันความพร้อมเดินทาง (Confirm Mob)
                    </Button>
                    <Button 
                      variant="outline"
                      className="border-blue-600 text-blue-600 hover:bg-blue-50"
                      disabled={!canEditMobilization}
                      onClick={() => handleUpdateMobStatus('MOBILIZING', 'MOBILIZING')}
                    >
                      <Truck className="h-4 w-4 mr-2" /> เริ่มระดมพล (Start Mobilizing)
                    </Button>
                    <Button 
                      disabled={!canEditMobilization || assignment.mobilizationStatus !== 'MOBILIZING'}
                      className="bg-blue-900"
                      onClick={() => handleUpdateMobStatus('ACTIVE', 'ACTIVE')}
                    >
                      <CheckCircle className="h-4 w-4 mr-2" /> เข้าหน้างานแล้ว (Mark as Active)
                    </Button>
                  </CardContent>
                </Card>

                {assignment.poId && assignment.waveId && (
                  <Card className="border-green-200 bg-green-50/50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base text-green-900">ขั้นตอนถัดไป: ลงเวลารายวัน</CardTitle>
                      <CardDescription>
                        PO / Wave ของคนนี้ถูกผูกไว้แล้ว — เปิด Wave Board จากลิงก์นี้ได้ทันที
                        {assignment.deploymentStatus === 'ACTIVE' && (
                          <span className="block mt-1 text-green-800 font-medium">
                            สถานะ deployment = ACTIVE แล้ว — เหมาะสมสำหรับลงเวลาต่อเนื่อง
                          </span>
                        )}
                        {assignment.deploymentStatus &&
                          assignment.deploymentStatus !== 'ACTIVE' && (
                            <span className="block mt-1 text-amber-900/90 text-xs">
                              แนะนำให้กด «เข้าหน้างานแล้ว (Mark as Active)» ก่อนลงเวลา หากยังเดินทางหรือยังไม่พร้อม
                            </span>
                          )}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-2">
                      <Button className="bg-green-700 hover:bg-green-800" asChild>
                        <Link
                          href={`/timesheets/wave-board?poId=${encodeURIComponent(assignment.poId)}&waveId=${encodeURIComponent(assignment.waveId)}`}
                        >
                          ไปลงเวลา Wave Board (PO / Wave นี้)
                        </Link>
                      </Button>
                      <Button variant="outline" asChild>
                        <Link href="/timesheets">ดูภาพรวมทุก PO / Wave</Link>
                      </Button>
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
                  <p className="text-[9px] text-muted-foreground uppercase font-bold">รอบการส่งตัว (Wave):</p>
                  <p className="text-xs font-bold text-primary flex items-center gap-1"><Waves className="h-3 w-3" /> {wave?.waveCode || '...'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[9px] text-muted-foreground uppercase font-bold">สถานที่ (Site):</p>
                  <p className="text-xs font-medium flex items-center gap-1"><MapPin className="h-3 w-3" /> {wave?.siteLocation || '...'}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
