'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Truck, 
  Search, 
  Filter, 
  ChevronRight, 
  ClipboardCheck, 
  AlertCircle, 
  ShieldAlert, 
  Info,
  HardHat,
  Waves,
  Calendar,
  Briefcase
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Assignment, Worker, User, Position, Wave } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection } from 'firebase/firestore';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function MobilizationPage() {
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();

  const isAuthorized = useMemo(() => canView(currentUser, 'mobilization'), [currentUser]);

  // Standardized to 'mobilizations' collection
  const mobilizationQuery = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return collection(firestore, 'mobilizations');
  }, [firestore, isAuthorized]);

  const { data: assignments, isLoading: isAssignmentsLoading } = useCollection<Assignment>(mobilizationQuery as any);

  const workersQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'workers') : null), [firestore, isAuthorized]);
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  const positionsQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'positions') : null), [firestore, isAuthorized]);
  const { data: allPositions } = useCollection<Position>(positionsQuery as any);

  const wavesQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'waves') : null), [firestore, isAuthorized]);
  const { data: allWaves } = useCollection<Wave>(wavesQuery as any);

  // Filter for workers in mobilization pipeline
  const mobilizationList = useMemo(() => {
    if (!assignments) return [];
    return assignments.filter(a => 
      ['CLIENT_APPROVED', 'READY', 'MOBILIZING', 'READINESS_CHECK'].includes(a.deploymentStatus) &&
      a.deploymentStatus !== 'CLOSED' &&
      a.deploymentStatus !== 'DEMOBILIZED' &&
      a.deploymentStatus !== 'ACTIVE'
    );
  }, [assignments]);

  if (isUserLoading || userLoading || !currentUser) return null;

  const getReadinessBadge = (asgn: Assignment) => {
    const status = asgn.readinessStatus;
    if (status === 'ready') return <Badge className="bg-green-600">READY</Badge>;
    return <Badge variant="outline" className="text-amber-600 border-amber-200 bg-amber-50">PARTIAL</Badge>;
  };

  const getMobStatusBadge = (status: string | undefined) => {
    switch (status) {
      case 'READY_TO_MOBILIZE': return <Badge className="bg-blue-600">READY TO MOB</Badge>;
      case 'MOBILIZING': return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">MOBILIZING</Badge>;
      case 'FAILED_CHECK': return <Badge variant="destructive">FAILED CHECK</Badge>;
      default: return <Badge variant="secondary">PENDING</Badge>;
    }
  };

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <Truck className="h-8 w-8" /> การเตรียมความพร้อม (Mobilization Management)
          </h1>
          <p className="text-muted-foreground text-lg">
            ใช้ตรวจสอบความพร้อมขั้นสุดท้ายก่อนส่งคนลงงาน โดยรวมข้อมูลจาก Worker, Position, Assignment และ Store
          </p>
        </div>

        {!isAuthorized ? (
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
            <ShieldAlert className="h-12 w-12 text-muted-foreground opacity-50" />
            <h2 className="text-xl font-bold">Access Pending (รอนุมัติสิทธิ์)</h2>
            <p className="text-muted-foreground max-w-md">บัญชีของคุณยังไม่ได้รับการกำหนดบทบาท กรุณาติดต่อผู้ดูแลระบบเพื่อเปิดสิทธิ์เข้าถึงโมดูล Mobilization</p>
          </div>
        ) : (
          <>
            <Alert variant="destructive" className="bg-destructive/5 border-destructive/20 shadow-sm">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              <AlertTitle className="font-bold text-lg">มาตรการความปลอดภัยหน้างาน (Pre-deployment Safety Policy)</AlertTitle>
              <AlertDescription className="text-sm">
                ห้ามยืนยัน Mobilization หากยังมีรายการ readiness ไม่ครบ หรือใบรับรองแพทย์หมดอายุ เจ้าหน้าที่ Operations ต้องตรวจสอบหลักฐานตัวจริงทุกครั้ง
              </AlertDescription>
            </Alert>

            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
              <div className="flex items-center gap-3 flex-1">
                <div className="relative w-full max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="ค้นหาคนงาน, โครงการ หรือรหัสเวฟ..." className="pl-9 h-11" />
                </div>
                <Button variant="outline" className="gap-2 h-11"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
              </div>
              <div className="flex gap-2">
                <Badge variant="outline" className="px-4 h-11 flex items-center gap-2 border-primary/20 bg-primary/5 text-primary font-bold">
                  <HardHat className="h-4 w-4" /> กำลังเตรียมการ: {mobilizationList.length} ราย
                </Badge>
              </div>
            </div>

            <Card className="shadow-lg border-none overflow-hidden">
              <CardContent className="p-0">
                {isAssignmentsLoading ? (
                  <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลการระดมพล...</div>
                ) : (
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="font-bold py-4">รหัส / คนงาน & ตำแหน่ง</TableHead>
                        <TableHead className="font-bold">เวฟ & โครงการ</TableHead>
                        <TableHead className="font-bold">กำหนดเดินทาง</TableHead>
                        <TableHead className="font-bold text-center">Compliance (ความพร้อม)</TableHead>
                        <TableHead className="font-bold">สถานะ Mobilization</TableHead>
                        <TableHead className="text-right pr-6">ดำเนินการ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {mobilizationList.map((asgn) => {
                        const worker = allWorkers?.find(w => w.id === asgn.workerId);
                        const pos = allPositions?.find(p => p.id === asgn.positionId);
                        const wave = allWaves?.find(w => w.id === asgn.waveId);

                        return (
                          <TableRow 
                            key={asgn.id} 
                            className="cursor-pointer hover:bg-muted/30 group transition-all" 
                            onClick={() => router.push(`/mobilization/${asgn.id}`)}
                          >
                            <TableCell className="py-4">
                              <div className="flex flex-col">
                                <span className="text-[10px] font-mono font-bold text-primary mb-1">{asgn.assignmentNo || asgn.id.substring(0,8)}</span>
                                <span className="font-bold text-base text-primary">{worker?.firstName} {worker?.lastName}</span>
                                <span className="text-xs text-muted-foreground flex items-center gap-1 font-medium"><Briefcase className="h-3 w-3" /> {(pos?.positionName || pos?.positionNameTh)}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="font-bold text-sm text-primary flex items-center gap-1"><Waves className="h-3.5 w-3.5" /> {wave?.waveCode || 'N/A'}</span>
                                <span className="text-[10px] text-muted-foreground font-mono uppercase truncate max-w-[150px]">{asgn.projectName}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-bold">
                                <Calendar className="h-3.5 w-3.5" />
                                {asgn.mobilizationDate || wave?.mobilizationDate || 'TBA'}
                              </div>
                            </TableCell>
                            <TableCell className="text-center">
                              <div className="flex flex-col items-center gap-1">
                                {getReadinessBadge(asgn)}
                                <div className="flex gap-1">
                                  <div className={`h-1 w-4 rounded-full ${asgn.readinessSummary.medicalValid === 'pass' ? 'bg-green-500' : 'bg-slate-200'}`} title="Medical" />
                                  <div className={`h-1 w-4 rounded-full ${asgn.readinessSummary.certificatesComplete === 'pass' ? 'bg-green-500' : 'bg-slate-200'}`} title="Certs" />
                                  <div className={`h-1 w-4 rounded-full ${asgn.readinessSummary.clientApproved === 'pass' ? 'bg-green-500' : 'bg-slate-200'}`} title="Client Approval" />
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>{getMobStatusBadge(asgn.mobilizationStatus)}</TableCell>
                            <TableCell className="text-right pr-6">
                              <Button variant="ghost" size="sm" className="gap-2 group-hover:text-primary">
                                <ClipboardCheck className="h-4 w-4" /> ตรวจสอบความพร้อม <ChevronRight className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {!isAssignmentsLoading && mobilizationList.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-20 text-muted-foreground italic">
                            ยังไม่มีรายการเตรียมความพร้อมในขณะนี้ เมื่อ Assignment พร้อมแล้ว ระบบจะแสดงรายการที่นี่
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card className="bg-primary/5 border-primary/10 border-dashed">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2 text-primary font-bold">
                  <Info className="h-5 w-5" /> แนวทางปฏิบัติ (Mobilization Workflow)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div className="flex items-start gap-3 p-4 bg-white rounded-md border shadow-sm">
                    <div className="bg-amber-100 p-2 rounded text-amber-700 font-bold">1</div>
                    <div>
                      <p className="font-bold">ขั้นตอนที่ 1: ตรวจความสมบูรณ์ (Verify Compliance)</p>
                      <p className="text-muted-foreground text-xs">หาก PPE หรือเครื่องมือยังไม่ครบ ให้ไปที่ คลังอุปกรณ์ (Store / Inventory) เพื่อดำเนินการเบิกจ่าย</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-4 bg-white rounded-md border shadow-sm">
                    <div className="bg-green-100 p-2 rounded text-green-700 font-bold">2</div>
                    <div>
                      <p className="font-bold">ขั้นตอนที่ 2: ยืนยันการส่งตัว (Final Dispatch)</p>
                      <p className="text-muted-foreground text-xs">เมื่อคนงานผ่าน Induction หน้างาน ให้กด "Confirm Mobilization" เพื่อเปลี่ยนสถานะเป็น Active และเริ่มคิดค่าจ้าง</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
