'use client';

import { useState, use, useMemo } from 'react';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccessDomain, hasMinimumLevel, isSystemAdmin } from '@/lib/permission-core';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  ArrowLeft, 
  Calendar, 
  User, 
  FileCheck, 
  ShieldCheck, 
  RotateCcw, 
  History,
  CheckCircle2,
  XCircle,
  Clock,
  Info,
  PenTool,
  Loader2,
  Lock,
  MessageSquare,
  Building2,
  Briefcase
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useUser, useCollection } from '@/firebase';
import { doc, collection, query, where, updateDoc } from 'firebase/firestore';
import { DailyTimesheet, User as AppUser, ExceptionRequest, Worker, Position } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ExceptionRequestService } from '@/lib/services/exception-request-service';

export default function TimesheetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const tsRef = useMemoFirebase(() => (firestore ? doc(firestore, 'daily_timesheets', id) : null), [firestore, id]);
  const { data: ts, isLoading: isTsLoading } = useDoc<DailyTimesheet>(tsRef as any);

  const workerRef = useMemoFirebase(() => (firestore && ts ? doc(firestore, 'workers', ts.workerId) : null), [firestore, ts?.workerId]);
  const { data: worker } = useDoc<Worker>(workerRef as any);

  const posRef = useMemoFirebase(() => (firestore && ts ? doc(firestore, 'positions', ts.positionId) : null), [firestore, ts?.positionId]);
  const { data: position } = useDoc<Position>(posRef as any);

  // Fetch pending exception requests for this timesheet
  const requestsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(
      collection(firestore, 'exception_requests'),
      where('referenceId', '==', id),
      where('status', '==', 'PENDING')
    );
  }, [firestore, id]);
  const { data: pendingRequests } = useCollection<ExceptionRequest>(requestsQuery as any);

  const [reviewNote, setReviewNote] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const isHRManager = useMemo(() => {
    if (!currentUser) return false;
    return (
      isSystemAdmin(currentUser) ||
      (canAccessDomain(currentUser, 'hr') && hasMinimumLevel(currentUser, 'manager'))
    );
  }, [currentUser]);

  const handleProcessRequest = async (requestId: string, status: 'APPROVED' | 'REJECTED') => {
    if (!firestore || !currentUser || !isHRManager) return;
    setIsProcessing(true);

    try {
      const service = new ExceptionRequestService(firestore);
      if (status === 'APPROVED') {
        await service.approveTimesheetCorrection(requestId, id, currentUser, reviewNote);
        toast({ title: "อนุมัติการแก้ไขสำเร็จ", description: "ใบลงเวลาถูกเปิดให้อีกครั้งเพื่อแก้ไขข้อมูล" });
      } else {
        await service.processRequest({ requestId, status: 'REJECTED', user: currentUser, internalNotes: reviewNote });
        toast({ title: "ปฏิเสธคำขอสำเร็จ", description: "ใบลงเวลาจะยังคงสถานะเดิม" });
      }
      setReviewNote('');
    } catch (e: any) {
      toast({ variant: "destructive", title: "Action Failed", description: e.message });
    } finally {
      setIsProcessing(false);
    }
  };

  if (isTsLoading || userLoading || !ts || !currentUser) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-12 w-12 text-primary animate-spin" /></div>;
  }

  const isLocked = ts.status === 'LOCKED';

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.back()}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Timesheet Audit Detail (รายละเอียดการลงเวลา)</h1>
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <span className="font-mono font-bold text-primary">{ts.date}</span>
                <Separator orientation="vertical" className="h-3" />
                <span>พนักงาน: {ts.workerNameSnapshot}</span>
              </div>
            </div>
          </div>
          <Badge variant={isLocked ? 'default' : 'outline'} className={isLocked ? 'bg-primary py-1.5 px-4 font-bold' : 'py-1.5 px-4 font-bold uppercase'}>
            {isLocked && <Lock className="h-3 w-3 mr-2" />}
            STATUS: {ts.status}
          </Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-6">
            <Card>
              <CardHeader className="bg-muted/30 border-b">
                <CardTitle className="text-lg flex items-center gap-2"><FileCheck className="h-5 w-5 text-primary" /> ข้อมูลการทำงาน (Work Data)</CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground font-black">กิจกรรม (Event):</Label>
                    <p className="font-bold">{ts.eventType}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground font-black">ชั่วโมงปกติ:</Label>
                    <p className="text-xl font-black text-primary">{ts.normalHours} Hrs</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground font-black">OT 1.5:</Label>
                    <p className="font-bold">{ts.ot15Hours || 0} Hrs</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground font-black">ตำแหน่งงาน:</Label>
                    <p className="font-bold">{position?.positionNameTh || ts.positionId}</p>
                  </div>
                </div>
                
                <Separator />

                <div className="space-y-3">
                  <h4 className="text-xs font-black uppercase text-primary flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4" /> หลักฐานอ้างอิง (Audit Proof)
                  </h4>
                  <div className="grid grid-cols-2 gap-4 bg-primary/5 p-4 rounded-lg border border-primary/10">
                    <div className="space-y-1">
                      <span className="text-[10px] text-muted-foreground uppercase font-bold">Source Type:</span>
                      <p className="text-sm font-bold">{ts.sourceType || 'PAPER'}</p>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] text-muted-foreground uppercase font-bold">Slip No.:</span>
                      <p className="text-sm font-mono font-bold text-blue-700">{ts.sourceDocumentNo || 'N/A'}</p>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] text-muted-foreground uppercase font-bold">Client Signatory:</span>
                      <p className="text-sm">{ts.clientSignedBy || 'Verified on-site'}</p>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] text-muted-foreground uppercase font-bold">Entered By:</span>
                      <p className="text-sm">{ts.officeEnteredBy || 'System'}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Exception Review Section */}
            {pendingRequests && pendingRequests.length > 0 && (
              <Card className="border-amber-500 bg-amber-50/20 shadow-lg">
                <CardHeader className="bg-amber-100/50 border-b border-amber-200">
                  <CardTitle className="text-amber-800 flex items-center gap-2">
                    <RotateCcw className="h-5 w-5 text-amber-600" /> คำขอแก้ไขข้อมูลจากลูกค้า (Pending Correction)
                  </CardTitle>
                  <CardDescription className="text-amber-700">คำขอนี้ต้องการการพิจารณาจาก HR Manager เพื่อเปิดสิทธิ์การแก้ไข</CardDescription>
                </CardHeader>
                <CardContent className="pt-6 space-y-4">
                  {pendingRequests.map(req => (
                    <div key={req.id} className="space-y-4">
                      <div className="p-4 bg-white rounded-lg border border-amber-200 shadow-sm">
                        <Label className="text-[10px] uppercase font-black text-amber-800 mb-2 block">เหตุผลที่ขอแก้ไข (Reason):</Label>
                        <p className="text-sm italic text-slate-700">"{req.reason}"</p>
                        <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                          <User className="h-3 w-3" /> โดย {req.requestedBy}
                          <Clock className="h-3 w-3" /> เมื่อ {new Date(req.requestedAt).toLocaleString('th-TH')}
                        </div>
                      </div>

                      {isHRManager ? (
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label className="font-bold">ความเห็นผู้ตรวจสอบ (Reviewer Notes)</Label>
                            <Textarea 
                              placeholder="ระบุเหตุผลการอนุมัติหรือปฏิเสธ..." 
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
                              <CheckCircle2 className="h-4 w-4 mr-2" /> ยอมรับคำขอ (Approve)
                            </Button>
                            <Button 
                              variant="outline" 
                              className="flex-1 border-red-200 text-red-600 hover:bg-red-50 font-bold"
                              disabled={isProcessing}
                              onClick={() => handleProcessRequest(req.id, 'REJECTED')}
                            >
                              <XCircle className="h-4 w-4 mr-2" /> ปฏิเสธคำขอ (Reject)
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="p-4 bg-blue-50 rounded-lg border border-blue-100 flex gap-2">
                          <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                          <p className="text-xs text-blue-700">คุณไม่มีสิทธิ์พิจารณาคำขอนี้ (สงวนสิทธิ์สำหรับ HR Manager เท่านั้น)</p>
                        </div>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-sm font-bold flex items-center gap-2 text-primary">
                  <User className="h-4 w-4" /> ประวัติคนงาน
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                {worker ? (
                  <div className="space-y-2">
                    <p className="text-sm font-bold">{worker.firstName} {worker.lastName}</p>
                    <p className="text-xs text-muted-foreground font-mono">{worker.workerCode}</p>
                    <Badge variant="outline" className="text-[10px]">{worker.workerStatus}</Badge>
                  </div>
                ) : <p className="text-xs animate-pulse">Loading...</p>}
              </CardContent>
            </Card>

            <Card className="bg-muted/30 border-dashed">
              <CardHeader className="pb-2">
                <CardTitle className="text-[10px] font-black uppercase text-muted-foreground tracking-widest flex items-center gap-2">
                  <History className="h-3 w-3" /> Audit Log
                </CardTitle>
              </CardHeader>
              <CardContent className="text-[10px] space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ready for Payroll:</span>
                  <span className="font-bold">{ts.readyForPayroll ? 'YES' : 'NO'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ready for Billing:</span>
                  <span className="font-bold">{ts.readyForBilling ? 'YES' : 'NO'}</span>
                </div>
                <Separator />
                <div className="pt-1">
                  <p className="text-muted-foreground mb-1">Created At:</p>
                  <p className="font-medium">{new Date(ts.createdAt).toLocaleString('th-TH')}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
