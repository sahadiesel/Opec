
'use client';

import { useState, use, useEffect, useMemo } from 'react';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccessOpsSchedulingModules, hasMinimumLevel } from '@/lib/permission-core';
import { canAccess, canEdit, canView, isMatrixControlledRole } from '@/lib/permissions';
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
  MapPin,
  Send,
  RotateCcw,
  Loader2,
  Pencil,
  Save,
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useUser, useCollection } from '@/firebase';
import {
  doc,
  collection,
  query,
  where,
  deleteField,
  updateDoc,
  type DocumentData,
} from 'firebase/firestore';
import { Input } from '@/components/ui/input';
import { positionListPrimaryName, type PositionDoc } from '@/lib/position-display';
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
  ExceptionRequest,
  POLine
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
  const canEditAssignments = useMemo(
    () => (useMatrixGuards ? canAccess(currentUser, 'assignments', 'edit') : canEdit(currentUser, 'assignments')),
    [currentUser, useMatrixGuards],
  );

  const mobRef = useMemoFirebase(
    () => (firestore && canViewAssignments ? doc(firestore, 'mobilizations', id) : null),
    [firestore, id, canViewAssignments],
  );
  const { data: assignment, isLoading: isMobLoading } = useDoc<Assignment>(mobRef as any);

  const workerRef = useMemoFirebase(() => (firestore && assignment ? doc(firestore, 'workers', assignment.workerId) : null), [firestore, assignment?.workerId]);
  const { data: worker } = useDoc<Worker>(workerRef as any);

  const poLineRef = useMemoFirebase(
    () =>
      firestore && assignment?.poId && assignment?.poLineId
        ? doc(firestore, 'purchase_orders', assignment.poId, 'po_lines', assignment.poLineId)
        : null,
    [firestore, assignment?.poId, assignment?.poLineId],
  );
  const { data: poLine } = useDoc<POLine>(poLineRef as any);

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

  const [workLocationDraft, setWorkLocationDraft] = useState('');
  const [deploymentEditing, setDeploymentEditing] = useState(false);
  const [isSavingDeployment, setIsSavingDeployment] = useState(false);
  const [isDemobilizing, setIsDemobilizing] = useState(false);

  useEffect(() => {
    if (!assignment || deploymentEditing) return;
    setWorkLocationDraft(
      (assignment.workLocation || poLine?.workLocation || '').toString().trim(),
    );
  }, [assignment?.id, assignment?.workLocation, poLine?.id, poLine?.workLocation, deploymentEditing]);

  const isDeploymentReleased = useMemo(
    () =>
      assignment
        ? assignment.deploymentStatus === 'DEMOBILIZED' || assignment.deploymentStatus === 'CLOSED'
        : false,
    [assignment],
  );

  const beginDeploymentEdit = () => {
    if (!assignment || isDeploymentReleased) return;
    setWorkLocationDraft(
      (assignment.workLocation || poLine?.workLocation || '').toString().trim(),
    );
    setDeploymentEditing(true);
  };

  const cancelDeploymentEdit = () => {
    if (!assignment) return;
    setDeploymentEditing(false);
    setWorkLocationDraft(
      (assignment.workLocation || poLine?.workLocation || '').toString().trim(),
    );
  };

  const handleSaveDeploymentSummary = async () => {
    if (!firestore || !currentUser || !canEditAssignments || !assignment || isDeploymentReleased) return;

    const trimmed = workLocationDraft.trim();
    const mobD = doc(firestore, 'mobilizations', id);
    setIsSavingDeployment(true);
    try {
      const patch: Record<string, unknown> = {
        updatedAt: Date.now(),
      };
      if (trimmed) {
        patch.workLocation = trimmed;
        patch.workLocationUpdatedAt = Date.now();
        patch.workLocationUpdatedByUserId = currentUser.id;
      } else {
        patch.workLocation = deleteField();
        patch.workLocationUpdatedAt = deleteField();
        patch.workLocationUpdatedByUserId = deleteField();
      }
      await updateDoc(mobD, patch as DocumentData);
      toast({ title: 'บันทึกข้อมูลแล้ว', description: 'สถานที่ปฏิบัติงานอัปเดตแล้ว (วัน Standby/ทำงานตั้งที่ Mobilization)' });
      setDeploymentEditing(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast({ variant: 'destructive', title: 'บันทึกไม่สำเร็จ', description: message });
    } finally {
      setIsSavingDeployment(false);
    }
  };

  const handleDemobilize = async () => {
    if (!firestore || !currentUser || !canEditAssignments || !assignment || isDeploymentReleased) return;
    if (
      !window.confirm(
        'บันทึกจบงาน (DEMOBILIZED) — รายนี้จะหลุดโควต้าและพร้อมมอบหมาย PO/งานอื่น ต้องการดำเนินการ?'
      )
    )
      return;
    setIsDemobilizing(true);
    try {
      await updateDoc(doc(firestore, 'mobilizations', id), {
        deploymentStatus: 'DEMOBILIZED',
        mobilizationStatus: 'DEMOBILIZED',
        updatedAt: Date.now(),
      });
      await updateDoc(doc(firestore, 'workers', assignment.workerId), {
        workerStatus: 'AVAILABLE',
        updatedAt: Date.now(),
      });
      toast({
        title: 'บันทึกจบงานแล้ว',
        description: 'รายนี้ไม่นับโควต้า — พร้อมมอบหมายงานอื่น',
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      toast({ variant: 'destructive', title: 'บันทึกไม่สำเร็จ', description: message });
    } finally {
      setIsDemobilizing(false);
    }
  };

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
    } catch (e: any) {
      toast({ variant: "destructive", title: "Action Failed", description: e.message });
    } finally {
      setIsProcessing(false);
    }
  };

  if (isMobLoading || userLoading || !currentUser) {
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
            <Card className="border-primary/35 bg-gradient-to-br from-primary/[0.06] via-background to-background shadow-md">
              <CardHeader className="space-y-1 pb-2">
                <CardTitle className="text-lg flex flex-wrap items-center gap-2">
                  <Truck className="h-5 w-5 text-primary shrink-0" aria-hidden />
                  เตรียมส่งตัว (Mobilization)
                </CardTitle>
                <CardDescription className="text-sm leading-relaxed">
                  ทำงานต่อจากการมอบหมาย: ตรวจความพร้อม เอกสาร PPE/เครื่องมือ และสถานะ MOB ของรายนี้ได้ทันที — ไม่ต้องกลับเมนูหลักแล้วหา Mobilization ใหม่
                </CardDescription>
              </CardHeader>
              <CardFooter className="flex flex-wrap items-center gap-3 pt-0 pb-5">
                <Button asChild size="lg" className="font-bold gap-2 shadow-sm">
                  <Link href={`/mobilization/${id}`}>
                    ไป Mobilization Command Center
                    <ChevronRight className="h-4 w-4" aria-hidden />
                  </Link>
                </Button>
                {assignment.mobilizationStatus ? (
                  <span className="text-xs text-muted-foreground">
                    สถานะ MOB ปัจจุบัน:{' '}
                    <span className="font-semibold text-foreground">{assignment.mobilizationStatus}</span>
                  </span>
                ) : null}
              </CardFooter>
            </Card>

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
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0 pb-4">
                <div className="space-y-1">
                  <CardTitle className="text-lg">Deployment Summary</CardTitle>
                  <CardDescription className="text-xs">
                    แก้สถานที่ปฏิบัติงานได้ที่นี่ — <strong>วัน Standby / เริ่มทำงาน</strong> ตั้งที่ Mobilization เท่านั้น
                    {poLine?.workLocation ? ` · ฐานจาก PO line: ${poLine.workLocation}` : ''}
                  </CardDescription>
                </div>
                {canEditAssignments && !isDeploymentReleased ? (
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    {!deploymentEditing ? (
                      <Button type="button" variant="outline" size="sm" className="font-bold" onClick={beginDeploymentEdit}>
                        <Pencil className="mr-1.5 h-4 w-4" />
                        แก้ไข
                      </Button>
                    ) : (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="font-bold"
                          onClick={cancelDeploymentEdit}
                          disabled={isSavingDeployment}
                        >
                          ยกเลิก
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="font-bold"
                          onClick={() => void handleSaveDeploymentSummary()}
                          disabled={isSavingDeployment}
                        >
                          {isSavingDeployment ? (
                            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                          ) : (
                            <Save className="mr-1.5 h-4 w-4" />
                          )}
                          บันทึก
                        </Button>
                      </>
                    )}
                  </div>
                ) : null}
              </CardHeader>
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
                  {!deploymentEditing ? (
                    <>
                      <div>
                        <Label className="text-xs uppercase text-muted-foreground">วันที่มอบหมาย:</Label>
                        <p className="font-bold">
                          {formatYmdLocalThaiBE((assignment.assignedDate || assignment.startDate || '').trim() || '—')}
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs uppercase text-muted-foreground">เพดาน PO (อ้างอิง):</Label>
                        <p className="font-bold text-muted-foreground">{formatYmdLocalThaiBE(assignment.endDate)}</p>
                      </div>
                      <div className="col-span-2">
                        <Label className="text-xs uppercase text-muted-foreground flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" /> สถานที่ (ปัจจุบัน)
                        </Label>
                        <p className="font-bold mt-0.5">
                          {(assignment.workLocation || poLine?.workLocation || '—').toString() || '—'}
                        </p>
                        {poLine?.workLocation && !assignment?.workLocation ? (
                          <p className="text-[10px] text-muted-foreground mt-1">
                            ใช้ค่าจาก PO line จนกว่าจะบันทึก override บนรายนี้
                          </p>
                        ) : null}
                        {typeof assignment.workLocationUpdatedAt === 'number' && assignment.workLocationUpdatedAt > 0 ? (
                          <p className="text-[10px] text-muted-foreground mt-1">
                            อัปเดตสถานที่ล่าสุด: {formatDateTimeThaiBE(assignment.workLocationUpdatedAt)}
                          </p>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="col-span-2 rounded-md border border-muted bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                        วันเริ่ม Standby / ทำงานแก้ได้ที่หน้า{' '}
                        <Link href={`/mobilization/${id}`} className="font-semibold text-primary underline">
                          Mobilization
                        </Link>{' '}
                        เท่านั้น
                      </div>
                      <div className="col-span-2 space-y-2">
                        <Label className="text-xs uppercase text-muted-foreground flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" /> สถานที่ปฏิบัติงาน
                        </Label>
                        <Input
                          value={workLocationDraft}
                          onChange={(e) => setWorkLocationDraft(e.target.value)}
                          placeholder="เช่น HXL / นิคมฯ ระยอง — ว่างได้เพื่อใช้ค่าจาก PO line"
                          className="font-medium"
                        />
                        {poLine?.workLocation ? (
                          <p className="text-[10px] text-muted-foreground">
                            PO line กำหนด: {poLine.workLocation} — บันทึกค่าที่นี่เพื่อ override เฉพาะรายนี้
                          </p>
                        ) : null}
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            {canEditAssignments && !isDeploymentReleased && (
              <Card className="border-amber-200/80">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Truck className="h-5 w-5 text-amber-700" />
                    จบงาน (Demobilize) เพื่อ re-assign
                  </CardTitle>
                  <CardDescription>
                    ใช้เมื่อรายนี้ต้องหลุดโควต้า / ปลดพนักงานออกจาก mobilization ก่อนมอบหมาย PO หรือลูกค้าใหม่
                  </CardDescription>
                </CardHeader>
                <CardFooter className="flex flex-col items-stretch gap-2 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="secondary"
                    className="font-bold"
                    onClick={handleDemobilize}
                    disabled={isDemobilizing}
                  >
                    {isDemobilizing ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                    )}
                    บันทึกจบงาน (DEMOBILIZED)
                  </Button>
                </CardFooter>
              </Card>
            )}
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
