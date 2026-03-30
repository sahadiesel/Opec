'use client';

import { useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Waves, 
  ArrowLeft, 
  Users, 
  Truck, 
  HardHat, 
  Clock, 
  XCircle, 
  Calendar, 
  MapPin, 
  Building2,
  Briefcase,
  CheckCircle2,
  ClipboardCheck,
  Package,
  Save,
  Loader2,
  ChevronRight
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFirestore, useDoc, useCollection, useMemoFirebase } from '@/firebase';
import { doc, collection, query, where } from 'firebase/firestore';
import { updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Wave, User, Customer, Assignment, Worker } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import { useAppUser } from '@/hooks/use-app-user';
import { canView, canEdit } from '@/lib/permissions';

export default function WaveDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const canViewWaves = canView(currentUser, 'waves');
  const canEditWaves = canEdit(currentUser, 'waves');

  const waveRef = useMemoFirebase(() => (firestore && canViewWaves ? doc(firestore, 'waves', id) : null), [firestore, id, canViewWaves]);
  const { data: wave, isLoading: isWaveLoading } = useDoc<Wave>(waveRef as any);

  // Standardized to 'mobilizations' top-level collection
  const assignmentsQuery = useMemoFirebase(() => {
    if (!firestore || !canViewWaves) return null;
    return query(collection(firestore, 'mobilizations'), where('waveId', '==', id));
  }, [firestore, id, canViewWaves]);
  const { data: waveAssignments } = useCollection<Assignment>(assignmentsQuery as any);

  const workersQuery = useMemoFirebase(() => (firestore && canViewWaves ? collection(firestore, 'workers') : null), [firestore, canViewWaves]);
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  const customerRef = useMemoFirebase(() => (firestore && canViewWaves && wave ? doc(firestore, 'customers', wave.customerId) : null), [firestore, wave?.customerId, canViewWaves]);
  const { data: customer } = useDoc<Customer>(customerRef as any);

  const [isEditing, setIsEditing] = useState(false);
  const [editedWave, setEditedWave] = useState<Partial<Wave>>({});

  const handleSaveInfo = () => {
    if (!canEditWaves) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์แก้ไขข้อมูล Wave' });
      return;
    }
    if (!waveRef) return;
    updateDocumentNonBlocking(waveRef, { ...editedWave, updatedAt: Date.now(), updatedBy: currentUser?.id });
    setIsEditing(false);
    toast({ title: "บันทึกสำเร็จ", description: "ข้อมูลเวฟงานถูกอัปเดตเรียบร้อยแล้ว" });
  };

  if (userLoading || !currentUser) return null;
  if (!canViewWaves) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-5xl mx-auto py-10 text-center text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงเมนูนี้</div>
      </AppShell>
    );
  }
  if (isWaveLoading || !wave) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                <Waves className="h-7 w-7 text-primary" /> {wave.waveCode}
              </h1>
              <Badge variant="outline" className="font-mono text-primary border-primary/20">{wave.status}</Badge>
            </div>
            <p className="text-muted-foreground flex items-center gap-4 mt-1 text-sm">
              <span className="flex items-center gap-1 font-medium"><Building2 className="h-3.5 w-3.5" /> {customer?.name || '...'}</span>
              <span className="flex items-center gap-1 font-bold text-primary"><Briefcase className="h-3.5 w-3.5" /> {wave.projectName}</span>
            </p>
          </div>
          <div className="flex gap-2">
            {isEditing ? (
              <>
                <Button variant="outline" onClick={() => setIsEditing(false)}>ยกเลิก</Button>
                <Button className="gap-2" onClick={handleSaveInfo}><Save className="h-4 w-4" /> บันทึกข้อมูล</Button>
              </>
            ) : (
              canEditWaves ? <Button variant="outline" onClick={() => { setEditedWave(wave); setIsEditing(true); }}>แก้ไขข้อมูลเวฟ</Button> : null
            )}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <StatCard title="คนงานที่วางแผน (Planned)" value={wave.plannedWorkers} sub="Workers" icon={Users} colorClass="border-l-blue-600" />
          <StatCard title="มอบหมายแล้ว (Assigned)" value={wave.assignedWorkers} sub={`${Math.round((wave.assignedWorkers/wave.plannedWorkers)*100)}% of plan`} icon={CheckCircle2} colorClass="border-l-green-600" />
          <StatCard title="รอยืนยันความพร้อม" value="-" sub="Readiness check" icon={ClipboardCheck} colorClass="border-l-amber-500" />
          <StatCard title="อุปกรณ์ค้างคืน" value="0" sub="Equipment" icon={Package} colorClass="border-l-slate-400" />
        </div>

        <Tabs defaultValue="assignments" className="w-full">
          <TabsList className="grid grid-cols-6 w-full h-auto p-1 bg-muted/50">
            <TabsTrigger value="details">ข้อมูลเวฟ</TabsTrigger>
            <TabsTrigger value="assignments">คนในเวฟ</TabsTrigger>
            <TabsTrigger value="mobilization">การเตรียมส่งตัว</TabsTrigger>
            <TabsTrigger value="ppe">PPE / เครื่องมือ</TabsTrigger>
            <TabsTrigger value="timesheets">ลงเวลา</TabsTrigger>
            <TabsTrigger value="closeout">การปิดเวฟ</TabsTrigger>
          </TabsList>

          <TabsContent value="assignments" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>คนงานในเวฟนี้ (Personnel Assigned)</CardTitle>
                  <CardDescription>รายชื่อคนงานทั้งหมดที่ถูกมอบหมายในรอบการทำงานนี้</CardDescription>
                </div>
                <Button asChild><Link href="/assignments"><Plus className="h-4 w-4 mr-2" /> มอบหมายคนเพิ่ม</Link></Button>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>คนงาน (Worker)</TableHead>
                      <TableHead>ตำแหน่ง (Position)</TableHead>
                      <TableHead>สถานะความพร้อม</TableHead>
                      <TableHead>สถานะการมอบหมาย</TableHead>
                      <TableHead className="text-right">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {waveAssignments?.map(asgn => {
                      const worker = allWorkers?.find(w => w.id === asgn.workerId);
                      return (
                        <TableRow key={asgn.id}>
                          <TableCell className="font-bold">{worker ? `${worker.firstName} ${worker.lastName}` : 'N/A'}</TableCell>
                          <TableCell className="text-xs">{asgn.positionId}</TableCell>
                          <TableCell>
                            <Badge variant={worker?.readinessStatus === 'READY' ? 'default' : 'destructive'}>
                              {worker?.readinessStatus || 'UNKNOWN'}
                            </Badge>
                          </TableCell>
                          <TableCell className="capitalize">{asgn.deploymentStatus}</TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" asChild>
                              <Link href={`/assignments/${asgn.id}`}>ดูรายละเอียด <ChevronRight className="h-4 w-4" /></Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function StatCard({ title, value, sub, icon: Icon, colorClass }: any) {
  return (
    <Card className={`hover:shadow-md transition-all border-l-8 ${colorClass} shadow-sm`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 opacity-50" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-black text-primary">{value}</div>
        <p className="text-[10px] font-medium text-muted-foreground mt-1">{sub}</p>
      </CardContent>
    </Card>
  );
}

import { Plus } from 'lucide-react';