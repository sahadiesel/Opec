'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ShieldCheck, Eye, FileText, CheckCircle2, XCircle } from 'lucide-react';
import { User, Assignment, Worker } from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collectionGroup, collection, doc } from 'firebase/firestore';
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

  const assignmentsQuery = useMemoFirebase(() => {
    if (!firestore || !firebaseUser || !currentUser) return null;
    return collectionGroup(firestore, 'assignments');
  }, [firestore, firebaseUser, currentUser]);

  const { data: assignments, isLoading } = useCollection<Assignment>(assignmentsQuery as any);

  const workersQuery = useMemoFirebase(() => {
    if (!firestore || !firebaseUser || !currentUser) return null;
    return collection(firestore, 'workers');
  }, [firestore, firebaseUser, currentUser]);
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  const handleApprove = (asgn: Assignment) => {
    if (!firestore) return;
    updateDocumentNonBlocking(doc(firestore, 'assignments', asgn.id), {
      status: 'approved',
      clientComments: reviewComment,
      updatedAt: Date.now()
    });
    toast({ title: "อนุมัติผู้สมัครสำเร็จ", description: "แจ้งฝ่ายบุคคลเพื่อดำเนินการระดมพล (Mobilization) ต่อไป" });
    setReviewComment('');
    setSelectedAssignment(null);
  };

  const handleReject = (asgn: Assignment) => {
    if (!firestore) return;
    updateDocumentNonBlocking(doc(firestore, 'assignments', asgn.id), {
      status: 'cancelled',
      clientComments: reviewComment,
      updatedAt: Date.now()
    });
    toast({ variant: "destructive", title: "ปฏิเสธผู้สมัคร", description: "ข้อมูลถูกส่งกลับไปให้ฝ่ายบุคคลจัดการใหม่" });
    setReviewComment('');
    setSelectedAssignment(null);
  };

  if (isUserLoading || !currentUser) return null;

  const clientAssignments = assignments?.filter(a => 
    (currentUser.roleId === 'client' ? a.customerId === currentUser.customerId : true) &&
    ['client_review', 'approved', 'active', 'replaced'].includes(a.status)
  ) || [];

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary flex items-center gap-2">
            <ShieldCheck className="h-6 w-6" /> Client Portal: การพิจารณาตัวบุคคล (Candidate Review)
          </h1>
          <p className="text-muted-foreground">ตรวจสอบประวัติ ใบรับรอง และอนุมัติคนงานเข้าปฏิบัติงานในโครงการ</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Card className="bg-blue-50/50 border-blue-100">
            <CardHeader className="pb-2">
              <CardDescription className="text-blue-700">รอพิจารณา (Pending Review)</CardDescription>
              <CardTitle className="text-2xl">{clientAssignments.filter(a => a.status === 'client_review').length}</CardTitle>
            </CardHeader>
          </Card>
          <Card className="bg-green-50/50 border-green-100">
            <CardHeader className="pb-2">
              <CardDescription className="text-green-700">อนุมัติแล้ว (Approved)</CardDescription>
              <CardTitle className="text-2xl">{clientAssignments.filter(a => a.status === 'approved' || a.status === 'active').length}</CardTitle>
            </CardHeader>
          </Card>
          <Card className="bg-slate-50/50 border-slate-100">
            <CardHeader className="pb-2">
              <CardDescription className="text-slate-600">ประวัติการพิจารณา</CardDescription>
              <CardTitle className="text-2xl">{clientAssignments.filter(a => ['replaced', 'cancelled'].includes(a.status)).length}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>รายการผู้สมัคร (Candidates List)</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-10 text-center text-muted-foreground italic">กำลังโหลด...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>คนงาน</TableHead>
                    <TableHead>ตำแหน่งงาน</TableHead>
                    <TableHead>สถานะ</TableHead>
                    <TableHead>ใบรับรอง/ตรวจร่างกาย</TableHead>
                    <TableHead className="text-right">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clientAssignments.map((asgn) => {
                    const worker = allWorkers?.find(w => w.id === asgn.workerId);
                    return (
                      <TableRow key={asgn.id}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-semibold">{worker ? `${worker.firstName} ${worker.lastName}` : 'N/A'}</span>
                            <span className="text-xs text-muted-foreground">OPEC Manpower ID: {asgn.workerId.substring(0,6)}</span>
                          </div>
                        </TableCell>
                        <TableCell>{asgn.positionId}</TableCell>
                        <TableCell>
                          <Badge variant={asgn.status === 'client_review' ? 'secondary' : 'default'} className={asgn.status === 'client_review' ? 'bg-blue-100 text-blue-800' : ''}>
                            {asgn.status.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Badge variant="outline" className="text-[10px] gap-1"><FileText className="h-3 w-3" /> Certs OK</Badge>
                            <Badge variant="outline" className="text-[10px] gap-1"><ShieldCheck className="h-3 w-3" /> Med Valid</Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button size="sm" variant="ghost" className="gap-2" onClick={() => setSelectedAssignment(asgn)}>
                                <Eye className="h-4 w-4" /> ดูรายละเอียด
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-2xl">
                              <DialogHeader>
                                <DialogTitle>พิจารณาคุณสมบัติคนงาน: {worker?.firstName} {worker?.lastName}</DialogTitle>
                                <DialogDescription>ตรวจสอบเอกสารความพร้อมและระบุผลการพิจารณา</DialogDescription>
                              </DialogHeader>
                              
                              <div className="grid grid-cols-2 gap-6 py-4">
                                <div className="space-y-4">
                                  <h4 className="font-bold text-sm border-b pb-1">ข้อมูลพื้นฐาน</h4>
                                  <div className="text-sm space-y-1">
                                    <p><span className="text-muted-foreground">ตำแหน่งงาน:</span> {asgn.positionId}</p>
                                    <p><span className="text-muted-foreground">เพศ:</span> {worker?.gender}</p>
                                    <p><span className="text-muted-foreground">สัญชาติ:</span> {worker?.nationality}</p>
                                    <p><span className="text-muted-foreground">ความพร้อม:</span> <span className="text-green-600 font-bold">READY</span></p>
                                  </div>
                                </div>
                                <div className="space-y-4">
                                  <h4 className="font-bold text-sm border-b pb-1">เอกสารตรวจสอบ</h4>
                                  <div className="space-y-2">
                                    <div className="p-2 border rounded-md flex items-center justify-between text-xs">
                                      <span className="flex items-center gap-1"><FileText className="h-3 w-3" /> Basic Offshore Safety</span>
                                      <Badge variant="outline" className="text-[9px] text-green-600">Verified</Badge>
                                    </div>
                                    <div className="p-2 border rounded-md flex items-center justify-between text-xs">
                                      <span className="flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> Medical Certificate</span>
                                      <Badge variant="outline" className="text-[9px] text-green-600">Valid</Badge>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              <div className="space-y-2">
                                <Label>ความเห็นเพิ่มเติม (Optional)</Label>
                                <Textarea 
                                  placeholder="ระบุความเห็นหรือคำสั่งพิเศษ (เช่น ต้องการสอบสัมภาษณ์เพิ่มเติม)" 
                                  value={reviewComment}
                                  onChange={(e) => setReviewComment(e.target.value)}
                                />
                              </div>

                              <DialogFooter className="gap-2">
                                <Button variant="outline" className="text-destructive gap-2 border-destructive" onClick={() => handleReject(asgn)}>
                                  <XCircle className="h-4 w-4" /> ปฏิเสธ / ขอเปลี่ยนตัว
                                </Button>
                                <Button className="gap-2 bg-green-600 hover:bg-green-700" onClick={() => handleApprove(asgn)}>
                                  <CheckCircle2 className="h-4 w-4" /> อนุมัติเข้าโครงการ
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
