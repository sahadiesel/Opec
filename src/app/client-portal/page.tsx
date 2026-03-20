'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ShieldCheck, Eye, FileText, CheckCircle2, XCircle, Users, AlertCircle } from 'lucide-react';
import { User, Assignment, Worker } from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, query, where } from 'firebase/firestore';
import { Badge } from '@/components/ui/badge';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription,
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import { CustomerQueryService } from '@/lib/services/customer-query-service';

export default function ClientPortalPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [reviewComment, setReviewComment] = useState('');

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const isClientAccess = useMemo(() => {
    return currentUser?.department === 'client' || currentUser?.department === 'admin' || currentUser?.userType === 'customer_portal';
  }, [currentUser]);

  // Standardized to scoped 'mobilizations' collection
  const mobilizationQuery = useMemoFirebase(() => {
    if (!firestore || !currentUser || !isClientAccess) return null;
    const service = new CustomerQueryService(firestore);
    const baseQuery = service.getScopedAssignmentsQuery(currentUser);
    
    // Add additional status filter for candidate review portal
    if (!baseQuery) return null;
    return query(
      baseQuery, 
      where('deploymentStatus', 'in', ['CLIENT_SUBMITTED', 'CLIENT_APPROVED', 'ACTIVE', 'MOBILIZING', 'READY'])
    );
  }, [firestore, currentUser, isClientAccess]);

  const { data: assignments, isLoading: isAssignmentsLoading } = useCollection<Assignment>(mobilizationQuery as any);

  const workersQuery = useMemoFirebase(() => {
    if (!firestore || !currentUser || !isClientAccess) return null;
    return collection(firestore, 'workers');
  }, [firestore, currentUser, isClientAccess]);
  
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  const handleApprove = (asgn: Assignment) => {
    if (!firestore) return;
    updateDocumentNonBlocking(doc(firestore, 'mobilizations', asgn.id), {
      deploymentStatus: 'CLIENT_APPROVED',
      clientApprovalStatus: 'APPROVED',
      clientComments: reviewComment,
      updatedAt: Date.now()
    });
    toast({ title: "อนุมัติผู้สมัครสำเร็จ", description: "แจ้งฝ่ายปฏิบัติการเพื่อดำเนินการระดมพลต่อไป" });
    setReviewComment('');
    setSelectedAssignment(null);
  };

  const handleReject = (asgn: Assignment) => {
    if (!firestore) return;
    updateDocumentNonBlocking(doc(firestore, 'mobilizations', asgn.id), {
      deploymentStatus: 'READINESS_CHECK', 
      clientApprovalStatus: 'REJECTED',
      clientComments: reviewComment,
      updatedAt: Date.now()
    });
    toast({ variant: "destructive", title: "ขอเปลี่ยนตัวผู้สมัคร", description: "ข้อมูลถูกส่งกลับไปให้ฝ่ายบุคคลจัดการใหม่" });
    setReviewComment('');
    setSelectedAssignment(null);
  };

  if (isUserLoading || !currentUser) return null;

  if (!isClientAccess) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <AlertCircle className="h-12 w-12 text-muted-foreground opacity-50" />
          <h2 className="text-xl font-bold">Access Denied</h2>
          <p className="text-muted-foreground">This portal is reserved for Client representatives.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary flex items-center gap-2">
              <ShieldCheck className="h-6 w-6" /> Client Portal: การพิจารณาตัวบุคคล
            </h1>
            <p className="text-muted-foreground">
              {currentUser.userType === 'internal' ? 'Internal Monitoring View' : `Customer Account: ${currentUser.displayName}`}
            </p>
          </div>
        </div>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardHeader className="bg-primary/5 border-b pb-4">
            <CardTitle className="text-lg">รายการพิจารณาผู้สมัคร (Candidate Review)</CardTitle>
            <CardDescription>ตรวจสอบประวัติและอนุมัติพนักงานเพื่อเริ่มงานตามรอบเวฟที่กำหนด</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {isAssignmentsLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลผู้สมัคร...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="pl-6 py-4 font-bold">คนงาน (Candidate)</TableHead>
                    <TableHead className="font-bold">ตำแหน่งงาน</TableHead>
                    <TableHead className="font-bold">สถานะโครงการ</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assignments?.map((asgn) => {
                    const worker = allWorkers?.find(w => w.id === asgn.workerId);
                    return (
                      <TableRow key={asgn.id} className="hover:bg-muted/20 transition-all">
                        <TableCell className="pl-6 py-4">
                          <div className="flex flex-col">
                            <span className="font-bold text-sm text-primary">{worker ? `${worker.firstName} ${worker.lastName}` : 'N/A'}</span>
                            <span className="text-[10px] text-muted-foreground font-mono uppercase">{asgn.projectName}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="bg-white text-primary border-primary/20 text-[10px] font-bold">
                            {asgn.positionId}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-[9px] font-black uppercase tracking-tighter">
                            {asgn.deploymentStatus}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button size="sm" variant="outline" onClick={() => setSelectedAssignment(asgn)} className="font-bold text-xs h-8">
                                <Eye className="h-3.5 w-3.5 mr-1.5" /> พิจารณาประวัติ
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-2xl">
                              <DialogHeader>
                                <DialogTitle>พิจารณาคุณสมบัติ: {worker?.firstName} {worker?.lastName}</DialogTitle>
                                <DialogDescription>ตรวจสอบรายละเอียดและความพร้อมก่อนยืนยันรับคนงานเข้าโครงการ</DialogDescription>
                              </DialogHeader>
                              <div className="space-y-4 py-4">
                                <div className="p-4 bg-muted/30 rounded-lg space-y-2">
                                  <p className="text-xs font-bold text-muted-foreground uppercase">ข้อมูลตำแหน่ง:</p>
                                  <p className="text-sm font-bold text-primary">{asgn.positionId} - {asgn.projectName}</p>
                                </div>
                                <div className="space-y-2">
                                  <Label className="font-bold">ความเห็นจากลูกค้า / คำร้องขอ (Client Remarks)</Label>
                                  <Textarea 
                                    placeholder="ระบุข้อความหากต้องการขอเปลี่ยนตัว หรือระบุเงื่อนไขเพิ่มเติม..." 
                                    value={reviewComment}
                                    onChange={(e) => setReviewComment(e.target.value)}
                                    className="min-h-[100px]"
                                  />
                                </div>
                              </div>
                              <DialogFooter className="gap-2 sm:gap-0">
                                {asgn.deploymentStatus === 'CLIENT_SUBMITTED' && (
                                  <div className="flex w-full gap-2">
                                    <Button variant="outline" className="flex-1 text-destructive border-destructive hover:bg-destructive/5" onClick={() => handleReject(asgn)}>
                                      <XCircle className="h-4 w-4 mr-2" /> ขอเปลี่ยนตัวคนงาน
                                    </Button>
                                    <Button className="flex-1 bg-green-600 hover:bg-green-700 font-bold" onClick={() => handleApprove(asgn)}>
                                      <CheckCircle2 className="h-4 w-4 mr-2" /> อนุมัติผู้สมัครรายนี้
                                    </Button>
                                  </div>
                                )}
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {(!assignments || assignments.length === 0) && !isAssignmentsLoading && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-20 text-muted-foreground italic">ไม่มีผู้สมัครที่รอดำเนินการในขณะนี้</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
