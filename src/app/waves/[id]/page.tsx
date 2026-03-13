'use client';

import { useState, useEffect, use } from 'react';
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
  Briefcase,
  CheckCircle2,
  AlertTriangle,
  Info,
  ChevronRight,
  ClipboardCheck,
  Package,
  Save,
  Loader2
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useFirestore, useDoc, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { doc, collection, query, where } from 'firebase/firestore';
import { updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Wave, User, Customer, Assignment, Worker, Position } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import Link from 'next/link';

export default function WaveDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const waveRef = useMemoFirebase(() => (firestore ? doc(firestore, 'waves', id) : null), [firestore, id]);
  const { data: wave, isLoading: isWaveLoading } = useDoc<Wave>(waveRef as any);

  const assignmentsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'assignments'), where('waveId', '==', id));
  }, [firestore, id]);
  // Note: If assignments are strictly under PO Lines, we would use collectionGroup or link them by waveId property
  const { data: waveAssignments } = useCollection<Assignment>(assignmentsQuery as any);

  const workersQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'workers') : null), [firestore]);
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  const customerRef = useMemoFirebase(() => (firestore && wave ? doc(firestore, 'customers', wave.customerId) : null), [firestore, wave?.customerId]);
  const { data: customer } = useDoc<Customer>(customerRef as any);

  const [isEditing, setIsEditing] = useState(false);
  const [editedWave, setEditedWave] = useState<Partial<Wave>>({});

  const handleSaveInfo = () => {
    if (!waveRef) return;
    updateDocumentNonBlocking(waveRef, { ...editedWave, updatedAt: Date.now(), updatedBy: currentUser?.id });
    setIsEditing(false);
    toast({ title: "บันทึกสำเร็จ", description: "ข้อมูลเวฟงานถูกอัปเดตเรียบร้อยแล้ว" });
  };

  if (isWaveLoading || !wave || !currentUser) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        {/* Header Section */}
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
              <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {wave.siteLocation}</span>
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
              <Button variant="outline" onClick={() => { setEditedWave(wave); setIsEditing(true); }}>แก้ไขข้อมูลเวฟ</Button>
            )}
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard title="คนงานที่วางแผน (Planned)" value={wave.plannedWorkers} sub="Workers" icon={Users} colorClass="border-l-blue-600" />
          <StatCard title="มอบหมายแล้ว (Assigned)" value={wave.assignedWorkers} sub={`${Math.round((wave.assignedWorkers/wave.plannedWorkers)*100)}% of plan`} icon={CheckCircle2} colorClass="border-l-green-600" />
          <StatCard title="รอยืนยันความพร้อม (Readiness)" value="-" sub="Pending checks" icon={ClipboardCheck} colorClass="border-l-amber-500" />
          <StatCard title="อุปกรณ์ค้างคืน (Equipment)" value="0" sub="Outstanding items" icon={Package} colorClass="border-l-slate-400" />
        </div>

        <Tabs defaultValue="details" className="w-full">
          <TabsList className="grid grid-cols-6 w-full h-auto p-1 bg-muted/50">
            <TabsTrigger value="details" className="gap-2 py-2 px-4"><Info className="h-4 w-4" /> ข้อมูลเวฟ</TabsTrigger>
            <TabsTrigger value="assignments" className="gap-2 py-2 px-4"><Users className="h-4 w-4" /> คนในเวฟ</TabsTrigger>
            <TabsTrigger value="mobilization" className="gap-2 py-2 px-4"><Truck className="h-4 w-4" /> การเตรียมความพร้อม</TabsTrigger>
            <TabsTrigger value="ppe" className="gap-2 py-2 px-4"><HardHat className="h-4 w-4" /> PPE / เครื่องมือ</TabsTrigger>
            <TabsTrigger value="timesheets" className="gap-2 py-2 px-4"><Clock className="h-4 w-4" /> ลงเวลา</TabsTrigger>
            <TabsTrigger value="closeout" className="gap-2 py-2 px-4"><XCircle className="h-4 w-4" /> การปิดเวฟ</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="mt-6 space-y-6">
            <Card>
              <CardHeader><CardTitle>รายละเอียดรอบการทำงาน (Wave Logistics Details)</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <Label>รหัสเวฟงาน</Label>
                    <Input disabled={!isEditing} value={isEditing ? editedWave.waveCode : wave.waveCode} onChange={e => setEditedWave({...editedWave, waveCode: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>สถานที่ปฏิบัติงาน (Site)</Label>
                    <Input disabled={!isEditing} value={isEditing ? editedWave.siteLocation : wave.siteLocation} onChange={e => setEditedWave({...editedWave, siteLocation: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>รูปแบบกะงาน (Rotation)</Label>
                    <Input disabled={!isEditing} value={isEditing ? editedWave.rotationPattern : wave.rotationPattern} onChange={e => setEditedWave({...editedWave, rotationPattern: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>วันที่เริ่มงานจริง</Label>
                    <Input type="date" disabled={!isEditing} value={isEditing ? editedWave.startDate : wave.startDate} onChange={e => setEditedWave({...editedWave, startDate: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>วันที่สิ้นสุดงานจริง</Label>
                    <Input type="date" disabled={!isEditing} value={isEditing ? editedWave.endDate : wave.endDate} onChange={e => setEditedWave({...editedWave, endDate: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>สถานะเวฟ</Label>
                    <Select disabled={!isEditing} onValueChange={v => setEditedWave({...editedWave, status: v as any})} value={isEditing ? editedWave.status : wave.status}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PLANNING">PLANNING</SelectItem>
                        <SelectItem value="READY">READY</SelectItem>
                        <SelectItem value="MOBILIZING">MOBILIZING</SelectItem>
                        <SelectItem value="ACTIVE">ACTIVE</SelectItem>
                        <SelectItem value="DEMOBILIZING">DEMOBILIZING</SelectItem>
                        <SelectItem value="CLOSED">CLOSED</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>วันที่รวมพล (Mobilization Date)</Label>
                    <Input type="date" disabled={!isEditing} value={isEditing ? editedWave.mobilizationDate : wave.mobilizationDate} onChange={e => setEditedWave({...editedWave, mobilizationDate: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>วันที่ปิดเวฟ (Demob Date)</Label>
                    <Input type="date" disabled={!isEditing} value={isEditing ? editedWave.demobilizationDate : wave.demobilizationDate} onChange={e => setEditedWave({...editedWave, demobilizationDate: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>จำนวนคนตามแผน</Label>
                    <Input type="number" disabled={!isEditing} value={isEditing ? editedWave.plannedWorkers : wave.plannedWorkers} onChange={e => setEditedWave({...editedWave, plannedWorkers: parseInt(e.target.value)})} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>หมายเหตุเวฟงาน (Notes)</Label>
                  <Textarea disabled={!isEditing} value={isEditing ? editedWave.notes : wave.notes} onChange={e => setEditedWave({...editedWave, notes: e.target.value})} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

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
                            <Badge variant={worker?.readinessStatus === 'READY' ? 'default' : 'destructive'} className={worker?.readinessStatus === 'READY' ? 'bg-green-600' : ''}>
                              {worker?.readinessStatus || 'UNKNOWN'}
                            </Badge>
                          </TableCell>
                          <TableCell className="capitalize">{asgn.status}</TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" asChild>
                              <Link href={`/assignments/${asgn.id}`}>ดูรายละเอียด <ChevronRight className="h-4 w-4" /></Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {!waveAssignments?.length && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-10 text-muted-foreground italic">ไม่มีคนงานถูกมอบหมายในเวฟนี้</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="mobilization" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>ความพร้อมก่อนเดินทาง (Pre-deployment Readiness)</CardTitle>
                <CardDescription>ตรวจสอบความสมบูรณ์ของเอกสารและสุขภาพของคนงานทั้งเวฟ</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert className="bg-blue-50 border-blue-200">
                  <Info className="h-4 w-4 text-blue-600" />
                  <AlertTitle>การตรวจสอบหมู่ (Group Compliance)</AlertTitle>
                  <AlertDescription>คนงานทุกคนในเวฟนี้ต้องมีสถานะ READY ก่อนกดยืนยันการเริ่ม Mobilization</AlertDescription>
                </Alert>
                <div className="py-10 text-center text-muted-foreground italic border-2 border-dashed rounded-lg">
                  หน้าจอรวมความพร้อมรายบุคคล (Readiness Dashboard) จะแสดงที่นี่
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ppe" className="mt-6">
            <div className="py-20 text-center text-muted-foreground italic border-2 border-dashed rounded-lg">
              ระบบจัดการการเบิก-คืน PPE และเครื่องมือรายเวฟ (Wave Inventory) อยู่ในระหว่างการพัฒนา
            </div>
          </TabsContent>

          <TabsContent value="timesheets" className="mt-6">
            <div className="py-20 text-center text-muted-foreground italic border-2 border-dashed rounded-lg">
              หน้าสรุปการลงเวลาทำงานของคนงานทั้งกลุ่มในเวฟนี้ (Group Timesheets)
            </div>
          </TabsContent>

          <TabsContent value="closeout" className="mt-6">
            <Card className="border-destructive/20">
              <CardHeader>
                <CardTitle className="text-destructive">การปิดเวฟงาน (Final Closeout)</CardTitle>
                <CardDescription>ตรวจสอบความเรียบร้อยทั้งหมดก่อนยุติการทำงานในรอบนี้</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4">
                  <div className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="bg-green-100 p-2 rounded-full text-green-600"><Users className="h-4 w-4" /></div>
                      <div>
                        <p className="text-sm font-bold">การคืนตัวคนงาน (Personnel Released)</p>
                        <p className="text-xs text-muted-foreground">คนงานทุกคนในเวฟต้องได้รับการเปลี่ยนสถานะเป็น Demobilized</p>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-green-600 border-green-200">READY</Badge>
                  </div>
                  <div className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="bg-amber-100 p-2 rounded-full text-amber-600"><Package className="h-4 w-4" /></div>
                      <div>
                        <p className="text-sm font-bold">การคืนอุปกรณ์ (Equipment Returned)</p>
                        <p className="text-xs text-muted-foreground">ตรวจสอบว่าไม่มีเครื่องมือหรือ PPE ที่ยังค้างอยู่กับคนงาน</p>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-amber-600 border-amber-200">CHECKING</Badge>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="bg-muted/30 pt-6">
                <Button variant="destructive" disabled className="w-full h-12 font-bold">ปิดเวฟงานอย่างเป็นทางการ (Close Wave)</Button>
              </CardFooter>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Next Step Guidance */}
        <Card className="bg-primary/5 border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2 text-primary font-bold">
              <Info className="h-5 w-5" /> แนวทางปฏิบัติ (Next Step Guidance)
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            ขั้นตอนถัดไป: เพิ่ม Assignment ให้ครบตามจำนวนที่วางแผน ({wave.plannedWorkers} ราย) และตรวจสอบสถานะความพร้อม (Readiness) ของคนงานทุกคนให้เป็น READY ก่อนเริ่มขั้นตอน Mobilization
          </CardContent>
        </Card>
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
