'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Truck, 
  Search, 
  Filter, 
  ChevronRight, 
  ClipboardCheck, 
  CheckCircle2, 
  AlertCircle, 
  ShieldAlert, 
  Info,
  ArrowRight,
  HardHat
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Assignment, Worker, User, Position } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collectionGroup, collection } from 'firebase/firestore';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useRouter } from 'next/navigation';

export default function MobilizationPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const assignmentsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return collectionGroup(firestore, 'assignments');
  }, [firestore]);

  const { data: assignments, isLoading: isAssignmentsLoading } = useCollection<Assignment>(assignmentsQuery as any);

  const workersQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'workers') : null), [firestore]);
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  const positionsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'positions') : null), [firestore]);
  const { data: allPositions } = useCollection<Position>(positionsQuery as any);

  // Filter for workers in deployment phase
  const mobilizationList = assignments?.filter(a => ['approved', 'mobilizing'].includes(a.status)) || [];

  if (isUserLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        {/* Page Header */}
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <Truck className="h-8 w-8" /> การระดมพล (Mobilization Management)
          </h1>
          <p className="text-muted-foreground text-lg">
            ควบคุมการจัดส่งตัวคนงานเข้าหน้างาน ตรวจสอบความพร้อมสุดท้าย (Final Checklist) และการออกเอกสารเดินทาง
          </p>
        </div>

        {/* Warning Notice */}
        <Alert className="bg-blue-50 border-blue-200 text-blue-800 shadow-sm">
          <ShieldAlert className="h-5 w-5 text-blue-600" />
          <AlertTitle className="font-bold text-lg text-blue-900">มาตรการความปลอดภัยหน้างาน (Pre-deployment Safety)</AlertTitle>
          <AlertDescription className="text-sm">
            ห้ามส่งตัวคนงานที่สถานะ Readiness ไม่เป็น <b className="underline">READY</b> ขึ้นแท่นหรือเข้าเขตพื้นที่ควบคุมโดยเด็ดขาด 
            เจ้าหน้าที่ Operations ต้องตรวจสอบตัวจริงของใบรับรองแพทย์ก่อนทำการ Mobilize
          </AlertDescription>
        </Alert>

        {/* Action Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="ค้นหาชื่อคนงาน, โครงการ หรือรหัส PO..." className="pl-9 h-11" />
            </div>
            <Button variant="outline" className="gap-2 h-11"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" className="px-4 h-11 flex items-center gap-2 border-blue-200 bg-blue-50 text-blue-700">
              <HardHat className="h-4 w-4" /> รอดำเนินการ: {mobilizationList.length} ราย
            </Badge>
          </div>
        </div>

        {/* Deployment Readiness Dashboard */}
        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isAssignmentsLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลการระดมพล...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4">คนงาน & ตำแหน่ง</TableHead>
                    <TableHead className="font-bold">โครงการ (Project)</TableHead>
                    <TableHead className="font-bold text-center">Checklist (ความพร้อม)</TableHead>
                    <TableHead className="font-bold">สถานะ Mobilization</TableHead>
                    <TableHead className="text-right pr-6">ดำเนินการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mobilizationList.map((asgn) => {
                    const worker = allWorkers?.find(w => w.id === asgn.workerId);
                    const pos = allPositions?.find(p => p.id === asgn.positionId);
                    const isReady = worker?.readinessStatus === 'READY';

                    return (
                      <TableRow key={asgn.id} className="cursor-pointer hover:bg-muted/30 group transition-all" onClick={() => router.push(`/assignments/${asgn.id}`)}>
                        <TableCell className="py-4">
                          <div className="flex flex-col">
                            <span className="font-bold text-base text-primary">{worker?.firstName} {worker?.lastName}</span>
                            <span className="text-xs text-muted-foreground flex items-center gap-1 font-medium">{pos?.positionName}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-semibold text-sm">{asgn.projectName}</span>
                            <span className="text-[10px] text-muted-foreground font-mono uppercase">PO: {asgn.poId.substring(0,8)}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-4">
                            <div className="flex flex-col items-center">
                              <div className={`h-2 w-8 rounded-full mb-1 ${isReady ? 'bg-green-500' : 'bg-red-400'}`} />
                              <span className="text-[10px] uppercase font-bold text-muted-foreground">Compliance</span>
                            </div>
                            <div className="flex flex-col items-center">
                              <div className="h-2 w-8 rounded-full mb-1 bg-amber-400" />
                              <span className="text-[10px] uppercase font-bold text-muted-foreground">Logistics</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={asgn.status === 'mobilizing' ? 'secondary' : 'outline'} className={asgn.status === 'mobilizing' ? 'bg-amber-100 text-amber-700 border-amber-200' : ''}>
                            {asgn.status === 'mobilizing' ? 'IN PROGRESS' : 'READY TO START'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <Button variant="ghost" size="sm" className="gap-2 group-hover:text-primary">
                            <ClipboardCheck className="h-4 w-4" /> จัดการความพร้อม <ChevronRight className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!isAssignmentsLoading && mobilizationList.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-20 text-muted-foreground italic">ไม่มีรายการคนงานที่ต้องระดมพลในขณะนี้</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Next-Step Guidance */}
        <Card className="bg-primary/5 border-primary/10 border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2 text-primary font-bold">
              <Info className="h-5 w-5" /> แนวทางปฏิบัติ (Mobilization Workflow)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="flex items-start gap-3 p-4 bg-white rounded-md border shadow-sm">
                <div className="bg-amber-100 p-2 rounded text-amber-700"><Truck className="h-4 w-4" /></div>
                <div>
                  <p className="font-bold">ขั้นที่ 1: เตรียมการระดมพล (Start Mobilizing)</p>
                  <p className="text-muted-foreground text-xs">เปลี่ยนสถานะเป็น Mobilizing เพื่อแจ้งให้คลังเตรียมอุปกรณ์ PPE และฝ่ายจัดจ้างจองตั๋วเดินทาง</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 bg-white rounded-md border shadow-sm">
                <div className="bg-green-100 p-2 rounded text-green-700"><CheckCircle2 className="h-4 w-4" /></div>
                <div>
                  <p className="font-bold">ขั้นที่ 2: ยืนยันการเข้าหน้างาน (Set Active)</p>
                  <p className="text-muted-foreground text-xs">เมื่อคนงานผ่านการตรวจหน้างาน (On-site Induction) ให้กด Set Active เพื่อเริ่มคิดค่าจ้างในระบบ</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
