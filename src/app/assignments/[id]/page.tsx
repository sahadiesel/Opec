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
  MoreHorizontal
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useUser } from '@/firebase';
import { doc, collectionGroup, query, where, getDocs, limit } from 'firebase/firestore';
import { updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Assignment, Worker, POLine, PurchaseOrder, Customer, Position, User as AppUser, AssignmentStatus, ClientApprovalStatus } from '@/lib/types';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';

export default function AssignmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  // Fetch Assignment (using collectionGroup because path is nested)
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

  // Fetch Linked Data
  const workerRef = useMemoFirebase(() => (firestore && assignment ? doc(firestore, 'workers', assignment.workerId) : null), [firestore, assignment?.workerId]);
  const { data: worker } = useDoc<Worker>(workerRef as any);

  const poRef = useMemoFirebase(() => (firestore && assignment ? doc(firestore, 'purchase_orders', assignment.poId) : null), [firestore, assignment?.poId]);
  const { data: po } = useDoc<PurchaseOrder>(poRef as any);

  const customerRef = useMemoFirebase(() => (firestore && assignment ? doc(firestore, 'customers', assignment.customerId) : null), [firestore, assignment?.customerId]);
  const { data: customer } = useDoc<Customer>(customerRef as any);

  const positionRef = useMemoFirebase(() => (firestore && assignment ? doc(firestore, 'positions', assignment.positionId) : null), [firestore, assignment?.positionId]);
  const { data: position } = useDoc<Position>(positionRef as any);

  const handleUpdateStatus = (newStatus: AssignmentStatus, clientStatus?: ClientApprovalStatus) => {
    if (!firestore || !asgnPath) return;
    
    const updateData: any = { 
      status: newStatus, 
      updatedAt: Date.now() 
    };
    if (clientStatus) updateData.clientApprovalStatus = clientStatus;

    updateDocumentNonBlocking(doc(firestore, asgnPath), updateData);
    setAssignment(prev => prev ? ({ ...prev, ...updateData }) : null);
    
    toast({ 
      title: "อัปเดตสถานะสำเร็จ", 
      description: `เปลี่ยนสถานะเป็น ${newStatus.toUpperCase()} เรียบร้อยแล้ว` 
    });
  };

  if (isLoading || isUserLoading || !currentUser) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Clock className="h-12 w-12 text-primary animate-pulse" />
      </div>
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

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.back()}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Assignment Detail</h1>
              <p className="text-sm text-muted-foreground font-mono">ID: {assignment.id}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" className="text-lg py-1 px-4">
              {assignment.status.toUpperCase()}
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Main Info Column */}
          <div className="md:col-span-2 space-y-6">
            <Card>
              <CardHeader className="pb-3 border-b">
                <CardTitle className="flex items-center gap-2 text-primary">
                  <Briefcase className="h-5 w-5" /> ข้อมูลงานและสถานะ
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-6">
                <div className="grid grid-cols-2 gap-6 text-sm">
                  <div className="space-y-1">
                    <p className="text-muted-foreground">ตำแหน่งงานในโครงการ:</p>
                    <p className="font-bold text-lg">{position?.positionName || assignment.positionId}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-muted-foreground">สถานะการมอบหมาย:</p>
                    <div className="pt-1">
                      <Badge className={assignment.status === 'active' ? 'bg-green-600' : ''}>{assignment.status.toUpperCase()}</Badge>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-muted-foreground">วันที่เริ่มงาน:</p>
                    <p className="font-medium flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      {new Date(assignment.startDate).toLocaleDateString('th-TH')}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-muted-foreground">วันที่สิ้นสุดงาน:</p>
                    <p className="font-medium flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      {new Date(assignment.endDate).toLocaleDateString('th-TH')}
                    </p>
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <h4 className="font-semibold text-sm">การดำเนินการ (Quick Actions)</h4>
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
                      <Button className="gap-2 bg-green-600 hover:bg-green-700" onClick={() => handleUpdateStatus('active')}>
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

            <Card>
              <CardHeader className="pb-3 border-b">
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5 text-primary" /> ข้อมูลคนงาน (Worker Profile)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                {worker ? (
                  <div className="space-y-4">
                    <div className="flex items-start justify-between">
                      <div className="flex gap-4">
                        <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                          <User className="h-8 w-8 text-primary" />
                        </div>
                        <div>
                          <h3 className="text-xl font-bold">{worker.firstName} {worker.lastName}</h3>
                          <p className="text-sm text-muted-foreground">ID Card: {worker.thaiNationalId}</p>
                          <div className="flex gap-2 mt-2">
                            <Badge variant={worker.readinessStatus === 'READY' ? 'default' : 'destructive'} className={worker.readinessStatus === 'READY' ? 'bg-green-600' : ''}>
                              {worker.readinessStatus === 'READY' ? <CheckCircle2 className="h-3 w-3 mr-1" /> : <AlertCircle className="h-3 w-3 mr-1" />}
                              Readiness: {worker.readinessStatus}
                            </Badge>
                          </div>
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/workers/${worker.id}`}>ดูประวัติเต็ม <ChevronRight className="h-4 w-4 ml-1" /></Link>
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground italic">กำลังโหลดโปรไฟล์คนงาน...</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Project Sidebar Column */}
          <div className="space-y-6">
            <Card className="bg-muted/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
                  <Building2 className="h-4 w-4" /> ข้อมูลโครงการ
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-2">
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase">ลูกค้า (Customer):</p>
                  <p className="text-sm font-semibold">{customer?.name || '...'}</p>
                </div>
                <Separator />
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase">โครงการ (Project):</p>
                  <p className="text-sm font-semibold">{assignment.projectName}</p>
                </div>
                <Separator />
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase">รหัสใบสั่งซื้อ (Customer PO):</p>
                  <p className="text-sm font-mono font-bold text-primary">{po?.poCode || '...'}</p>
                </div>
                <div className="pt-4">
                  <Button variant="outline" className="w-full text-xs" asChild>
                    <Link href={`/purchase-orders/${assignment.poId}`}>ดูใบสั่งซื้อหลัก</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" /> สถานะอนุมัติ (Client)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm">สถานะปัจจุบัน:</span>
                  <Badge variant="outline">{assignment.clientApprovalStatus.toUpperCase()}</Badge>
                </div>
                <Separator />
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground italic font-medium">เปลี่ยนสถานะการพิจารณา:</p>
                  <div className="grid grid-cols-1 gap-2">
                    <Button variant="outline" size="sm" className="text-green-600" onClick={() => handleUpdateStatus('approved', 'approved')}>
                      อนุมัติ (Approve)
                    </Button>
                    <Button variant="outline" size="sm" className="text-orange-600" onClick={() => handleUpdateStatus('proposed', 'replacement_requested')}>
                      ขอเปลี่ยนตัว (Replace)
                    </Button>
                    <Button variant="outline" size="sm" className="text-destructive" onClick={() => handleUpdateStatus('cancelled', 'rejected')}>
                      ปฏิเสธ (Reject)
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}