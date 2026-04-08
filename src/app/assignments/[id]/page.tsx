
'use client';

import { useState, use, useEffect, useMemo } from 'react';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccessOpsSchedulingModules, hasMinimumLevel } from '@/lib/permission-core';
import { canAccess, canView, isMatrixControlledRole } from '@/lib/permissions';
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
  FileText,
  Send,
  RotateCcw,
  Loader2
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useUser, useCollection } from '@/firebase';
import { doc, getDoc, collection, query, where } from 'firebase/firestore';
import { positionListPrimaryName, type PositionDoc } from '@/lib/position-display';
import { updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { formatDateTimeThaiBE, formatYmdLocalThaiBE } from '@/lib/date-thai';
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
  MainContract,
  ExceptionRequest
} from '@/lib/types';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ExceptionRequestService } from '@/lib/services/exception-request-service';

export default function AssignmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const useMatrixGuards = isMatrixControlledRole(currentUser);
  const canViewAssignments = useMatrixGuards ? canAccess(currentUser, 'assignments', 'view') : canView(currentUser, 'assignments');

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchAssignment() {
      if (!firestore || !canViewAssignments) {
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
  }, [firestore, id, canViewAssignments]);

  const workerRef = useMemoFirebase(() => (firestore && assignment ? doc(firestore, 'workers', assignment.workerId) : null), [firestore, assignment?.workerId]);
  const { data: worker } = useDoc<Worker>(workerRef as any);

  const customerRef = useMemoFirebase(() => (firestore && assignment ? doc(firestore, 'customers', assignment.customerId) : null), [firestore, assignment?.customerId]);
  const { data: customer } = useDoc<Customer>(customerRef as any);

  // Fetch pending exception requests for this assignment
  const requestsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(
      collection(firestore, 'exception_requests'),
      where('referenceId', '==', id),
      where('status', '==', 'PENDING')
    );
  }, [firestore, id]);
  const { data: pendingRequests } = useCollection<ExceptionRequest>(requestsQuery as any);

  const positionsQuery = useMemoFirebase(
    () => (firestore && canViewAssignments ? collection(firestore, 'positions') : null),
    [firestore, canViewAssignments]
  );
  const { data: allPositions } = useCollection<Position>(positionsQuery as any);

  const positionDisplayName = useMemo(() => {
    const pid = assignment?.positionId?.trim();
    if (!pid) return '—';
    const pos = allPositions?.find((p) => p.id === pid);
    return pos ? positionListPrimaryName(pos as PositionDoc) : pid;
  }, [assignment?.positionId, allPositions]);

  const isOpsOrSalesManager = useMemo(() => {
    if (!currentUser) return false;
    return (
      canAccessOpsSchedulingModules(currentUser) && hasMinimumLevel(currentUser, 'manager')
    );
  }, [currentUser]);

  const [reviewNote, setReviewNote] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleProcessRequest = async (requestId: string, status: 'APPROVED' | 'REJECTED') => {
    if (!firestore || !currentUser || !isOpsOrSalesManager) return;
    setIsProcessing(true);

    try {
      const service = new ExceptionRequestService(firestore);
      if (status === 'APPROVED') {
        await service.approveAssignmentChange(requestId, id, currentUser, reviewNote);
        toast({ title: "อนุมัติการเปลี่ยนแปลงสำเร็จ", description: "การมอบหมายเดิมถูกยกเลิกแล้วเพื่อรอส่งตัวพนักงานใหม่" });
      } else {
        await service.processRequest({ requestId, status: 'REJECTED', user: currentUser, internalNotes: reviewNote });
        toast({ title: "ปฏิเสธคำขอสำเร็จ" });
      }
      setReviewNote('');
      // Reload assignment data
      const snap = await getDoc(doc(firestore, 'mobilizations', id));
      if (snap.exists()) setAssignment(snap.data() as Assignment);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Action Failed", description: e.message });
    } finally {
      setIsProcessing(false);
    }
  };

  if (isLoading || userLoading || !currentUser) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-12 w-12 text-primary animate-spin" /></div>;
  }

  if (!canViewAssignments) {
    return (
      <AppShell user={currentUser as AppUser} onLogout={() => {}}>
        <div className="max-w-5xl mx-auto py-10 text-center text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงเมนูนี้</div>
      </AppShell>
    );
  }
  if (!assignment) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="text-center py-20">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <h2 className="text-xl font-bold">ไม่พบข้อมูลการมอบหมาย</h2>
        </div>
      </AppShell>
    );
  }

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
          <Badge variant="outline" className="text-sm py-1 px-4 border-primary/20 font-bold uppercase">
            DEPLOYMENT: {assignment.deploymentStatus}
          </Badge>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* Exception Review Card */}
            {pendingRequests && pendingRequests.length > 0 && (
              <Card className="border-amber-500 bg-amber-50/20 shadow-lg">
                <CardHeader className="bg-amber-100/50 border-b border-amber-200">
                  <CardTitle className="text-amber-800 flex items-center gap-2">
                    <RotateCcw className="h-5 w-5" /> คำขอเปลี่ยนแปลงพนักงาน (Pending Change Request)
                  </CardTitle>
                  <CardDescription className="text-amber-700">คำขอนี้ต้องการการอนุมัติจาก Operations/Sales Manager</CardDescription>
                </CardHeader>
                <CardContent className="pt-6 space-y-4">
                  {pendingRequests.map(req => (
                    <div key={req.id} className="space-y-4">
                      <div className="p-4 bg-white rounded-lg border border-amber-200">
                        <Label className="text-[10px] uppercase font-black text-amber-800 mb-2 block">เหตุผลการขอเปลี่ยนตัว (Reason):</Label>
                        <p className="text-sm italic text-slate-700">"{req.reason}"</p>
                        <div className="mt-2 text-[10px] text-muted-foreground">โดย {req.requestedBy} เมื่อ {formatDateTimeThaiBE(req.requestedAt)}</div>
                      </div>

                      {isOpsOrSalesManager ? (
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label className="font-bold">ความเห็นผู้พิจารณา (Internal Response)</Label>
                            <Textarea 
                              placeholder="ระบุความเห็นเพื่อแจ้งให้ลูกค้าทราบ..." 
                              value={reviewNote} 
                              onChange={e => setReviewNote(e.target.value)}
                              className="bg-white"
                            />
                          </div>
                          <div className="flex gap-3">
                            <Button 
                              className="flex-1 bg-green-600 hover:bg-green-700 font-bold" 
                              disabled={isProcessing}
                              onClick={() => handleProcessRequest(req.id, 'APPROVED')}
                            >
                              <CheckCircle2 className="h-4 w-4 mr-2" /> อนุมัติเปลี่ยนตัว (Approve Change)
                            </Button>
                            <Button 
                              variant="outline" 
                              className="flex-1 border-red-200 text-red-600 hover:bg-red-50 font-bold"
                              disabled={isProcessing}
                              onClick={() => handleProcessRequest(req.id, 'REJECTED')}
                            >
                              <XCircle className="h-4 w-4 mr-2" /> ปฏิเสธ (Keep Original)
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="p-4 bg-blue-50 rounded-lg border border-blue-100 flex gap-2">
                          <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                          <p className="text-xs text-blue-700">คุณไม่มีสิทธิ์พิจารณาคำขอนี้ (Manager Required)</p>
                        </div>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader><CardTitle className="text-lg">Deployment Summary</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <Label className="text-xs uppercase text-muted-foreground">ตำแหน่ง (Position):</Label>
                    <p className="font-bold">{positionDisplayName}</p>
                  </div>
                  <div>
                    <Label className="text-xs uppercase text-muted-foreground">โครงการ (Project):</Label>
                    <p className="font-bold">{assignment.projectName}</p>
                  </div>
                  <div>
                    <Label className="text-xs uppercase text-muted-foreground">เริ่มงาน:</Label>
                    <p className="font-bold">{formatYmdLocalThaiBE(assignment.startDate)}</p>
                  </div>
                  <div>
                    <Label className="text-xs uppercase text-muted-foreground">สิ้นสุด:</Label>
                    <p className="font-bold">{formatYmdLocalThaiBE(assignment.endDate)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-sm font-bold flex items-center gap-2 text-primary">
                  <User className="h-4 w-4" /> ข้อมูลพนักงาน
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                {worker ? (
                  <div className="space-y-2">
                    <p className="font-bold">{worker.firstName} {worker.lastName}</p>
                    <p className="text-xs text-muted-foreground font-mono">{worker.workerCode}</p>
                  </div>
                ) : <p className="text-xs">Loading...</p>}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
