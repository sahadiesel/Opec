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
  Calendar, 
  AlertCircle, 
  Clock, 
  CheckCircle2, 
  Truck,
  XCircle,
  ChevronRight,
  ClipboardCheck,
  Info,
  ShieldAlert,
  Waves,
  Package,
  History,
  CheckCircle,
  Building2,
  FileText
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useUser, useCollection } from '@/firebase';
import { doc, getDoc } from 'firebase/firestore';
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
  Wave,
  ChecklistItemStatus,
  MainContract
} from '@/lib/types';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function AssignmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
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

  const isAuthorized = useMemo(() => {
    return !!(currentUser?.roleIds && currentUser.roleIds.length > 0);
  }, [currentUser]);

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Standardized fetch from 'mobilizations' top-level collection
  useEffect(() => {
    async function fetchAssignment() {
      if (!firestore || !isAuthorized) {
        setIsLoading(false);
        return;
      }
      try {
        const mobRef = doc(firestore, 'mobilizations', id);
        const snap = await getDoc(mobRef);
        if (snap.exists()) {
          setAssignment(snap.data() as Assignment);
        }
      } catch (err) {
        console.error('Failed to fetch assignment', err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchAssignment();
  }, [firestore, id, isAuthorized]);

  const workerRef = useMemoFirebase(() => (firestore && assignment && isAuthorized ? doc(firestore, 'workers', assignment.workerId) : null), [firestore, assignment?.workerId, isAuthorized]);
  const { data: worker } = useDoc<Worker>(workerRef as any);

  const positionRef = useMemoFirebase(() => (firestore && assignment && isAuthorized ? doc(firestore, 'positions', assignment.positionId) : null), [firestore, assignment?.positionId, isAuthorized]);
  const { data: position } = useDoc<Position>(positionRef as any);

  const waveRef = useMemoFirebase(() => (firestore && assignment?.waveId && isAuthorized ? doc(firestore, 'waves', assignment.waveId) : null), [firestore, assignment?.waveId, isAuthorized]);
  const { data: wave } = useDoc<Wave>(waveRef as any);

  const customerRef = useMemoFirebase(() => (firestore && assignment?.customerId && isAuthorized ? doc(firestore, 'customers', assignment.customerId) : null), [firestore, assignment?.customerId, isAuthorized]);
  const { data: customer } = useDoc<Customer>(customerRef as any);

  const poRef = useMemoFirebase(() => (firestore && assignment?.poId && isAuthorized ? doc(firestore, 'purchase_orders', assignment.poId) : null), [firestore, assignment?.poId, isAuthorized]);
  const { data: po } = useDoc<PurchaseOrder>(poRef as any);

  const contractRef = useMemoFirebase(() => (firestore && assignment?.contractId && isAuthorized ? doc(firestore, 'main_contracts', assignment.contractId) : null), [firestore, assignment?.contractId, isAuthorized]);
  const { data: contract } = useDoc<MainContract>(contractRef as any);

  const handleUpdateStatus = (newStatus: DeploymentStatus) => {
    if (!firestore) return;
    const mobRef = doc(firestore, 'mobilizations', id);
    const updateData: any = { deploymentStatus: newStatus, updatedAt: Date.now() };
    updateDocumentNonBlocking(mobRef, updateData);
    setAssignment(prev => prev ? ({ ...prev, ...updateData }) : null);
    toast({ title: "อัปเดตสถานะสำเร็จ", description: `เปลี่ยนสถานะเป็น ${newStatus} เรียบร้อยแล้ว` });
  };

  if (isLoading || !currentUser) {
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.back()}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Assignment Detail (รายละเอียดการมอบหมาย)</h1>
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <span className="font-mono font-bold text-primary">{assignment.assignmentNo || assignment.id}</span>
                <Separator orientation="vertical" className="h-3" />
                <span>ลูกค้า: {customer?.name || '...'}</span>
              </div>
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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
                  <CardHeader><CardTitle className="text-lg">ข้อมูลงานและกำหนดการ (Operational Context)</CardTitle></CardHeader>
                  <CardContent className="space-y-6 text-sm">
                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <p className="text-muted-foreground uppercase text-[10px] font-bold">ตำแหน่งงาน (Position):</p>
                        <p className="font-bold text-lg text-primary">{position?.positionName || assignment.positionId}</p>
                        <Badge variant="secondary" className="mt-1 text-[9px]">{assignment.workMode} Mode</Badge>
                      </div>
                      <div>
                        <p className="text-muted-foreground uppercase text-[10px] font-bold">รอบการทำงาน (Wave):</p>
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 font-mono">{wave?.waveCode || 'N/A'}</Badge>
                      </div>
                      <div>
                        <p className="text-muted-foreground uppercase text-[10px] font-bold">ใบสั่งซื้ออ้างอิง (Purchase Order):</p>
                        <p className="font-mono font-bold text-primary flex items-center gap-1"><FileText className="h-3.5 w-3.5" /> {po?.poCode || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground uppercase text-[10px] font-bold">สัญญาหลัก (Main Contract):</p>
                        <p className="font-mono text-xs flex items-center gap-1"><Building2 className="h-3 w-3" /> {contract?.contractNumber || 'N/A'}</p>
                      </div>
                      <div className="col-span-2 border-t pt-4">
                        <p className="text-muted-foreground uppercase text-[10px] font-bold mb-2">ช่วงเวลาปฏิบัติงาน (Schedule):</p>
                        <div className="flex items-center gap-4">
                          <div className="flex flex-col">
                            <span className="text-[10px] text-muted-foreground">เริ่ม (Start)</span>
                            <span className="font-bold">{assignment.startDate}</span>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          <div className="flex flex-col">
                            <span className="text-[10px] text-muted-foreground">สิ้นสุด (End)</span>
                            <span className="font-bold">{assignment.endDate}</span>
                          </div>
                        </div>
                      </div>
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
                    <Button variant="outline" className="text-destructive border-destructive" onClick={() => handleUpdateStatus('CLOSED')}>
                      <XCircle className="h-4 w-4" /> ยกเลิก / ปิดงาน
                    </Button>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="readiness" className="mt-6">
                <Card>
                  <CardHeader><CardTitle className="text-lg">รายการตรวจสอบความพร้อม</CardTitle></CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableBody>
                        <TableRow>
                          <TableCell>{getChecklistIcon(assignment.readinessSummary.passportValid)}</TableCell>
                          <TableCell>หนังสือเดินทาง / บัตรประชาชน (Passport/ID Valid)</TableCell>
                          <TableCell className="text-right capitalize">{assignment.readinessSummary.passportValid}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>{getChecklistIcon(assignment.readinessSummary.medicalValid)}</TableCell>
                          <TableCell>ใบรับรองแพทย์ (Medical Certificate Valid)</TableCell>
                          <TableCell className="text-right capitalize">{assignment.readinessSummary.medicalValid}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="history" className="mt-6">
                <Card>
                  <CardHeader><CardTitle className="text-lg flex items-center gap-2"><History className="h-5 w-5" /> ประวัติการเปลี่ยนแปลง</CardTitle></CardHeader>
                  <CardContent>
                    <div className="text-sm space-y-4">
                      <div className="flex gap-4 border-l-2 border-primary/20 pl-4 relative">
                        <div className="absolute -left-[9px] top-0 h-4 w-4 rounded-full bg-primary" />
                        <div>
                          <p className="font-bold">CREATED</p>
                          <p className="text-xs text-muted-foreground">{new Date(assignment.createdAt).toLocaleString('th-TH')}</p>
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
                  <User className="h-4 w-4" /> ข้อมูลคนงาน (Worker Profile)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                {worker ? (
                  <div className="space-y-4 text-sm">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary">
                        {worker.firstName.charAt(0)}
                      </div>
                      <div>
                        <h3 className="font-bold">{worker.firstName} {worker.lastName}</h3>
                        <p className="text-[10px] text-muted-foreground">{worker.thaiNationalId}</p>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" className="w-full text-xs" asChild>
                      <Link href={`/workers/${worker.id}`}>ดูประวัติเต็ม <ChevronRight className="h-4 w-4 ml-1" /></Link>
                    </Button>
                  </div>
                ) : <p className="text-xs text-muted-foreground animate-pulse">Loading worker data...</p>}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
