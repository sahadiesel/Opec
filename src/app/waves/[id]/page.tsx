'use client';

import { useState, use, useMemo, useEffect } from 'react';
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
  Calendar,
  MapPin,
  Building2,
  Briefcase,
  CheckCircle2,
  ClipboardCheck,
  Package,
  Save,
  Loader2,
  ChevronRight,
  Plus,
  Info,
  Send,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFirestore, useDoc, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { doc, collection, query, where, writeBatch } from 'firebase/firestore';
import { updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Wave, User, Customer, Assignment, Worker, Position, WaveStatus, DeploymentStatus } from '@/lib/types';
import { totalPlannedWorkersOnWave } from '@/lib/ops/wave-allocation';
import { pickRosterLinePerWorker } from '@/lib/ops/assignment-roster';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import { useAppUser } from '@/hooks/use-app-user';
import { canView, canEdit } from '@/lib/permissions';
import { positionListPrimaryName, type PositionDoc } from '@/lib/position-display';
import { PageGuidance } from '@/components/layout/page-guidance';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { WAVE_TIMESHEET_DEPLOYMENT_STATUSES } from '@/lib/constants/timesheet-wave';
import { mobilizationWorkerNameFromWorker } from '@/lib/ops/mobilization-worker-name';

function deploymentStatusBadge(status: DeploymentStatus) {
  switch (status) {
    case 'DRAFT':
      return (
        <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200 uppercase font-bold text-[10px]">
          DRAFT
        </Badge>
      );
    case 'READY_TO_MOB':
      return (
        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 uppercase font-bold text-[10px]">
          Ready
        </Badge>
      );
    case 'MOBILIZING':
      return <Badge className="bg-blue-600 uppercase font-bold text-[10px]">Mobilizing</Badge>;
    case 'ACTIVE':
      return <Badge className="bg-green-600 uppercase font-bold text-[10px]">Active</Badge>;
    case 'CONFIRMED':
      return (
        <Badge variant="outline" className="bg-emerald-50 text-emerald-800 border-emerald-200 uppercase font-bold text-[10px]">
          Confirmed
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-[10px]">
          {status}
        </Badge>
      );
  }
}

export default function WaveDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const canViewWaves = canView(currentUser, 'waves');
  const canEditWaves = canEdit(currentUser, 'waves');

  const waveRef = useMemoFirebase(
    () => (firestore && canViewWaves ? doc(firestore, 'waves', id) : null),
    [firestore, id, canViewWaves]
  );
  const { data: wave, isLoading: isWaveLoading } = useDoc<Wave>(waveRef as any);

  const assignmentsQuery = useMemoFirebase(() => {
    if (!firestore || !canViewWaves) return null;
    return query(collection(firestore, 'mobilizations'), where('waveId', '==', id));
  }, [firestore, id, canViewWaves]);
  const { data: waveAssignments } = useCollection<Assignment>(assignmentsQuery as any);

  const workersQuery = useMemoFirebase(
    () => (firestore && canViewWaves ? collection(firestore, 'workers') : null),
    [firestore, canViewWaves]
  );
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  const positionsQuery = useMemoFirebase(
    () => (firestore && canViewWaves ? collection(firestore, 'positions') : null),
    [firestore, canViewWaves]
  );
  const { data: allPositions } = useCollection<Position>(positionsQuery as any);

  const positionLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of allPositions ?? []) {
      map.set(p.id, positionListPrimaryName(p as PositionDoc));
    }
    return (pid?: string) => {
      if (!pid?.trim()) return '—';
      return map.get(pid) ?? pid;
    };
  }, [allPositions]);

  const customerRef = useMemoFirebase(
    () => (firestore && canViewWaves && wave ? doc(firestore, 'customers', wave.customerId) : null),
    [firestore, wave?.customerId, canViewWaves]
  );
  const { data: customer } = useDoc<Customer>(customerRef as any);

  const [isEditing, setIsEditing] = useState(false);
  const [editedWave, setEditedWave] = useState<Partial<Wave>>({});
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSettingActive, setIsSettingActive] = useState(false);

  const draftCount = useMemo(
    () => (waveAssignments ?? []).filter((a) => a.deploymentStatus === 'DRAFT').length,
    [waveAssignments]
  );

  /** ซิงก์ workerName ลง mobilization ให้ client portal แสดงชื่อจริง (ไม่อ่าน workers โดยตรง) */
  useEffect(() => {
    if (!firestore || !waveAssignments?.length || !allWorkers?.length) return;
    const need = waveAssignments.filter((a) => {
      if ((a.workerName || '').trim() !== '') return false;
      return allWorkers.some((w) => w.id === a.workerId);
    });
    if (need.length === 0) return;

    const run = async () => {
      const now = Date.now();
      const chunkSize = 400;
      for (let i = 0; i < need.length; i += chunkSize) {
        const batch = writeBatch(firestore);
        for (const a of need.slice(i, i + chunkSize)) {
          const w = allWorkers.find((x) => x.id === a.workerId);
          const name = mobilizationWorkerNameFromWorker(w);
          if (!name) continue;
          batch.update(doc(firestore, 'mobilizations', a.id), { workerName: name, updatedAt: now });
        }
        await batch.commit();
      }
    };
    void run().catch((e) => console.error('wave mobilization workerName backfill', e));
  }, [firestore, waveAssignments, allWorkers]);

  const rosterForDisplay = useMemo(
    () => pickRosterLinePerWorker(waveAssignments ?? []),
    [waveAssignments],
  );

  const timesheetReadyCount = useMemo(
    () => rosterForDisplay.filter((a) => WAVE_TIMESHEET_DEPLOYMENT_STATUSES.includes(a.deploymentStatus)).length,
    [rosterForDisplay],
  );

  const handleSaveInfo = () => {
    if (!canEditWaves) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์แก้ไขข้อมูล Wave' });
      return;
    }
    if (!waveRef) return;
    updateDocumentNonBlocking(waveRef, { ...editedWave, updatedAt: Date.now(), updatedBy: currentUser?.id });
    setIsEditing(false);
    toast({ title: 'บันทึกสำเร็จ', description: 'ข้อมูลเวฟงานถูกอัปเดตเรียบร้อยแล้ว' });
  };

  /** ยืนยันมอบหมาย (DRAFT → READY_TO_MOB) + ตั้ง wave เป็น ACTIVE เพื่อให้ปรากฏใน Wave Board ลงเวลา */
  const handleConfirmForTimesheet = async () => {
    if (!firestore || !wave || !waveRef || !canEditWaves) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์หรือข้อมูลไม่ครบ' });
      return;
    }
    const drafts = (waveAssignments ?? []).filter((a) => a.deploymentStatus === 'DRAFT');
    if (drafts.length === 0) {
      toast({ title: 'ไม่มีรายการ DRAFT', description: 'มอบหมายทุกคนอยู่ในสถานะที่ลงเวลาได้แล้ว หรือยังไม่มีคนในเวฟ' });
      return;
    }

    setIsConfirming(true);
    try {
      const batch = writeBatch(firestore);
      const now = Date.now();
      for (const a of drafts) {
        const w = allWorkers?.find((x) => x.id === a.workerId);
        const workerName = mobilizationWorkerNameFromWorker(w) || (a.workerName || '').trim();
        batch.update(doc(firestore, 'mobilizations', a.id), {
          deploymentStatus: 'READY_TO_MOB' as DeploymentStatus,
          updatedAt: now,
          ...(workerName ? { workerName } : {}),
        });
      }
      if (wave.status === 'PLANNING' || wave.status === 'RECRUITING') {
        batch.update(waveRef, {
          status: 'ACTIVE' as WaveStatus,
          updatedAt: now,
        });
      }
      await batch.commit();
      toast({
        title: 'ยืนยันมอบหมายแล้ว',
        description: `อัปเดต ${drafts.length} รายการเป็น READY_TO_MOB — ไปแท็บ "ลงเวลา" แล้วเปิด Wave Board`,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ';
      toast({ variant: 'destructive', title: 'ไม่สำเร็จ', description: msg });
    } finally {
      setIsConfirming(false);
    }
  };

  /** กรณีไม่มี DRAFT ค้าง (มอบหมายยืนแล้ว) แต่สถานะเวฟยัง PLANNING — ยังลงเวลาได้ แต่ badge จะสอดคล้องเมื่อตั้ง ACTIVE */
  const handleSetWaveActiveOnly = async () => {
    if (!firestore || !wave || !waveRef || !canEditWaves) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์หรือข้อมูลไม่ครบ' });
      return;
    }
    if (wave.status !== 'PLANNING' && wave.status !== 'RECRUITING') {
      toast({ title: 'ไม่ต้องอัปเดต', description: `สถานะเวฟปัจจุบัน: ${wave.status}` });
      return;
    }
    setIsSettingActive(true);
    try {
      await updateDocumentNonBlocking(waveRef, {
        status: 'ACTIVE' as WaveStatus,
        updatedAt: Date.now(),
      });
      toast({
        title: 'ตั้งสถานะเวฟเป็น ACTIVE แล้ว',
        description: 'รายชื่อมอบหมายไม่ใช่ DRAFT อยู่แล้ว — ใช้ปุ่มนี้ให้สอดคล้องกับขั้นตอน (ยืนยันมอบหมายเดิมใช้เมื่อยังมี DRAFT ค้าง)',
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ';
      toast({ variant: 'destructive', title: 'ไม่สำเร็จ', description: msg });
    } finally {
      setIsSettingActive(false);
    }
  };

  if (isUserLoading || userLoading || !currentUser) return null;
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

  const waveBoardMonth = (wave.startDate || '').slice(0, 7) || new Date().toISOString().slice(0, 7);
  const waveBoardHref = `/timesheets/wave-board?poId=${encodeURIComponent(wave.poId)}&month=${encodeURIComponent(waveBoardMonth)}`;

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
              <Badge variant="outline" className="font-mono text-primary border-primary/20">
                {wave.status}
              </Badge>
            </div>
            <p className="text-muted-foreground flex items-center gap-4 mt-1 text-sm">
              <span className="flex items-center gap-1 font-medium">
                <Building2 className="h-3.5 w-3.5" /> {customer?.name || '...'}
              </span>
              <span className="flex items-center gap-1 font-bold text-primary">
                <Briefcase className="h-3.5 w-3.5" /> {wave.projectName}
              </span>
            </p>
          </div>
          <div className="flex gap-2">
            {isEditing ? (
              <>
                <Button variant="outline" onClick={() => setIsEditing(false)}>
                  ยกเลิก
                </Button>
                <Button className="gap-2" onClick={handleSaveInfo}>
                  <Save className="h-4 w-4" /> บันทึกข้อมูล
                </Button>
              </>
            ) : canEditWaves ? (
              <Button
                variant="outline"
                onClick={() => {
                  setEditedWave(wave);
                  setIsEditing(true);
                }}
              >
                แก้ไขข้อมูลเวฟ
              </Button>
            ) : null}
          </div>
        </div>

        <Alert className="border-primary/30 bg-primary/5">
          <Info className="h-4 w-4" />
          <AlertTitle>ขั้นตอนหลังมอบหมายครบ</AlertTitle>
          <AlertDescription className="text-sm space-y-1">
            <ol className="list-decimal pl-4 space-y-1">
              <li>
                เมื่อจำนวนคนครบตามเวฟ ให้กด <strong>ยืนยันมอบหมายเพื่อลงเวลา</strong> (เปลี่ยน DRAFT → READY_TO_MOB และตั้งสถานะเวฟเป็น
                ACTIVE)
              </li>
              <li>ไปแท็บ <strong>ลงเวลา</strong> แล้วเปิด Wave Board เพื่อบันทึก timesheet / แนบรูป</li>
              <li>
                ต่อด้วย payroll (อนุมัติ HR/Ops) และ <strong>Draft Invoice</strong> (เรียกเก็บ) ตาม flow — timesheet ต้องถึงสถานะที่ระบบกำหนดก่อนวางบิล
              </li>
            </ol>
          </AlertDescription>
        </Alert>

        <div className="grid gap-4 md:grid-cols-4">
          <StatCard
            title="คนงานที่วางแผน (Planned)"
            value={totalPlannedWorkersOnWave(wave)}
            sub="Workers"
            icon={Users}
            colorClass="border-l-blue-600"
          />
          <StatCard
            title="มอบหมายแล้ว (Assigned)"
            value={wave.assignedWorkers}
            sub={`${
              totalPlannedWorkersOnWave(wave) > 0
                ? Math.round((wave.assignedWorkers / totalPlannedWorkersOnWave(wave)) * 100)
                : 0
            }% of plan`}
            icon={CheckCircle2}
            colorClass="border-l-green-600"
          />
          <StatCard
            title="พร้อมลงเวลา (Timesheet roster)"
            value={timesheetReadyCount}
            sub={`จาก ${rosterForDisplay.length} ราย (หลังตัด demob/ซ้ำคนงาน)`}
            icon={Clock}
            colorClass="border-l-violet-600"
          />
          <StatCard title="อุปกรณ์ค้างคืน" value="0" sub="Equipment" icon={Package} colorClass="border-l-slate-400" />
        </div>

        {canEditWaves && draftCount > 0 && (
          <Card className="border-amber-200 bg-amber-50/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Send className="h-5 w-5 text-amber-700" />
                ยืนยันมอบหมายเพื่อเปิดใช้ลงเวลา
              </CardTitle>
              <CardDescription>
                มี {draftCount} รายการสถานะ <strong>DRAFT</strong> — Wave Board จะดึงเฉพาะคนที่ไม่ใช่ DRAFT (เช่น READY_TO_MOB)
                เมื่อกดปุ่มนี้ระบบจะอัปเดตทุกรายการ DRAFT ในเวฟนี้เป็น <strong>READY_TO_MOB</strong>
                {wave.status === 'PLANNING' || wave.status === 'RECRUITING' ? (
                  <> และตั้งสถานะเวฟเป็น <strong>ACTIVE</strong></>
                ) : null}
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <Button
                className="bg-amber-700 hover:bg-amber-800"
                disabled={isConfirming}
                onClick={() => void handleConfirmForTimesheet()}
              >
                {isConfirming ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                ยืนยันมอบหมายเพื่อลงเวลา ({draftCount} คน)
              </Button>
            </CardFooter>
          </Card>
        )}

        {canEditWaves && draftCount === 0 && (wave.status === 'PLANNING' || wave.status === 'RECRUITING') && (
          <Card className="border-slate-200 bg-slate-50/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">สถานะเวฟยัง {wave.status}</CardTitle>
              <CardDescription>
                รายมอบหมายทุกคนไม่อยู่ DRAFT แล้ว — ระบบจึง <strong>ลงเวลาได้</strong> บน Wave Board
                แม้เวฟยังแสดง PLANNING (กรณีเดิมไม่กด &quot;ยืนยันมอบหมาย&quot; หรือ import มาเป็นสถานะ ready แล้ว)
                กดปุ่มด้านล่างเพื่อ <strong>ตั้งเป็น ACTIVE</strong> ให้ตรงขั้นตอน; หรือแก้สถานะเวฟในแท็บ &quot;ข้อมูลเวฟ&quot;
                → แก้ไขข้อมูลเวฟ
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <Button
                variant="secondary"
                disabled={isSettingActive}
                onClick={() => void handleSetWaveActiveOnly()}
              >
                {isSettingActive ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                ตั้งสถานะเวฟเป็น ACTIVE
              </Button>
            </CardFooter>
          </Card>
        )}

        <Tabs defaultValue="assignments" className="w-full">
          <TabsList className="grid grid-cols-6 w-full h-auto p-1 bg-muted/50">
            <TabsTrigger value="details">ข้อมูลเวฟ</TabsTrigger>
            <TabsTrigger value="assignments">คนในเวฟ</TabsTrigger>
            <TabsTrigger value="mobilization">การเตรียมส่งตัว</TabsTrigger>
            <TabsTrigger value="ppe">PPE / เครื่องมือ</TabsTrigger>
            <TabsTrigger value="timesheets">ลงเวลา</TabsTrigger>
            <TabsTrigger value="closeout">การปิดเวฟ</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>ข้อมูล Wave</CardTitle>
                <CardDescription>สถานที่ วันที่ และสถานะเวฟ</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {isEditing ? (
                  <>
                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>สถานะเวฟ (Wave status)</Label>
                        <Select
                          value={editedWave.status ?? wave.status}
                          onValueChange={(v) => setEditedWave((w) => ({ ...w, status: v as WaveStatus }))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(
                              [
                                'PLANNING',
                                'READY',
                                'RECRUITING',
                                'MOBILIZING',
                                'ACTIVE',
                                'DEMOBILIZING',
                                'COMPLETED',
                                'CLOSED',
                              ] as WaveStatus[]
                            ).map((s) => (
                              <SelectItem key={s} value={s}>
                                {s}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>สถานที่ (Site)</Label>
                        <Input
                          value={editedWave.siteLocation ?? wave.siteLocation}
                          onChange={(e) => setEditedWave((w) => ({ ...w, siteLocation: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>หมายเหตุ</Label>
                      <Textarea
                        value={editedWave.notes ?? wave.notes ?? ''}
                        onChange={(e) => setEditedWave((w) => ({ ...w, notes: e.target.value }))}
                        rows={3}
                      />
                    </div>
                  </>
                ) : (
                  <div className="grid sm:grid-cols-2 gap-4 text-sm">
                    <div className="flex gap-2">
                      <MapPin className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      <div>
                        <div className="text-xs text-muted-foreground">สถานที่</div>
                        <div className="font-medium">{wave.siteLocation || '—'}</div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      <div>
                        <div className="text-xs text-muted-foreground">ช่วงวันที่</div>
                        <div className="font-medium">
                          {wave.startDate} — {wave.endDate}
                        </div>
                      </div>
                    </div>
                    {wave.notes ? (
                      <div className="sm:col-span-2">
                        <div className="text-xs text-muted-foreground">หมายเหตุ</div>
                        <p className="mt-1 whitespace-pre-wrap">{wave.notes}</p>
                      </div>
                    ) : null}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="assignments" className="mt-6">
            <PageGuidance
              title="การมอบหมาย → ลงเวลา"
              tips={[
                'คอลัมน์ตำแหน่งแสดงชื่อจากทะเบียนตำแหน่ง (เช่น Welder) ไม่ใช่รหัสเอกสาร',
                'ถ้าสถานะการมอบหมายเป็น DRAFT จะยังไม่ปรากฏใน Wave Board — ใช้ปุ่มยืนยันด้านบน หรือปรับสถานะในรายละเอียดการมอบหมาย',
                'ลงเวลาได้เมื่อ deployment อย่างน้อย READY_TO_MOB / MOBILIZING / ACTIVE (ตามที่ Wave Board รองรับ)',
              ]}
            />
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>คนงานในเวฟนี้ (Personnel Assigned)</CardTitle>
                  <CardDescription>รายชื่อคนงานที่มอบหมายในรอบนี้ — ตำแหน่งแสดงชื่อภาษาอังกฤษ/ไทยจาก Master Data</CardDescription>
                </div>
                <Button asChild>
                  <Link
                    href={`/assignments?poId=${encodeURIComponent(wave.poId)}&waveId=${encodeURIComponent(wave.id)}&openDialog=1`}
                  >
                    <Plus className="h-4 w-4 mr-2" /> มอบหมายคนเพิ่ม
                  </Link>
                </Button>
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
                    {rosterForDisplay.map((asgn) => {
                      const worker = allWorkers?.find((w) => w.id === asgn.workerId);
                      return (
                        <TableRow key={asgn.id}>
                          <TableCell className="font-bold">
                            {worker ? `${worker.firstName} ${worker.lastName}` : 'N/A'}
                          </TableCell>
                          <TableCell className="text-sm font-medium">{positionLabel(asgn.positionId)}</TableCell>
                          <TableCell>
                            <Badge variant={worker?.readinessStatus === 'READY' ? 'default' : 'destructive'}>
                              {worker?.readinessStatus || 'UNKNOWN'}
                            </Badge>
                          </TableCell>
                          <TableCell>{deploymentStatusBadge(asgn.deploymentStatus)}</TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" asChild>
                              <Link href={`/assignments/${asgn.id}`}>
                                ดูรายละเอียด <ChevronRight className="h-4 w-4" />
                              </Link>
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

          <TabsContent value="mobilization" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Truck className="h-5 w-5" /> การเตรียมส่งตัว (Mobilization)
                </CardTitle>
                <CardDescription>ติดตามรายการส่งตัวและเอกสารก่อนขึ้นเวลางาน</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  ใช้เมนู <strong>จัดคนงานตาม PO → การเตรียมส่งตัว</strong> เพื่อดูรายการ mobilization ทั้งหมด หรือกรองตาม PO นี้
                </p>
                <Button asChild variant="outline">
                  <Link href={`/mobilization?poId=${encodeURIComponent(wave.poId)}`}>เปิดหน้า Mobilization (กรอง PO)</Link>
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ppe" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <HardHat className="h-5 w-5" /> PPE / เครื่องมือ
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-2">
                <p>จัดเตรียมและติดตาม PPE / อุปกรณ์ตามนโยบายโครงการ — ใช้เมนูคลังและใบเบิกตาม workflow ภายในองค์กร</p>
                <Button asChild variant="outline" size="sm">
                  <Link href="/store">ไปคลังอุปกรณ์</Link>
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="timesheets" className="mt-6">
            <PageGuidance
              title="ลงเวลา (Timesheet)"
              tips={[
                'เลือก PO และ Wave เดียวกับเวฟนี้ใน Wave Board แล้วเลือกวันที่เพื่อกรอกชั่วโมง / แนบรูปถ่ายใบ timesheet',
                'ต้องไม่ใช่สถานะ DRAFT ในการมอบหมาย — ใช้ปุ่มยืนยันมอบหมายที่ด้านบนของหน้านี้ก่อน',
                'หลัง OPS/HR ตรวจ timesheet และลูกค้า approve (ถ้ามี) จะนำไป payroll และ Draft Invoice ตามลำดับ',
              ]}
            />
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-primary" /> Wave Board — ลงเวลารายวัน
                </CardTitle>
                <CardDescription>ลิงก์นี้เลือก PO และ Wave ให้อัตโนมัติ</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                <Button asChild size="lg" className="gap-2">
                  <Link href={waveBoardHref}>
                    เปิด Wave Board สำหรับเวฟนี้ <ChevronRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/timesheets/wave-month">สรุปลงเวลารายเดือน (Wave)</Link>
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="closeout" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>การปิดเวฟ</CardTitle>
                <CardDescription>สรุปโครงการและปิดสถานะเมื่องานจบ</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                เมื่องานครบกำหนดและ timesheet / billing ปิดครบ ให้ปรับสถานะเวฟเป็น <strong>COMPLETED</strong> /{' '}
                <strong>CLOSED</strong> ในแท็บข้อมูลเวฟ และตรวจสอบ Draft Invoice / ใบกำกับภาษีตามขั้นตอนบัญชี
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
