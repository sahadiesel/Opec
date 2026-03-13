'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Plus, 
  Search, 
  Filter, 
  Waves, 
  ChevronRight, 
  Calendar, 
  Building2, 
  Info, 
  AlertCircle,
  Users,
  MapPin,
  ArrowRight
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Wave, User, Customer, PurchaseOrder, POLine, WaveStatus } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, collectionGroup } from 'firebase/firestore';
import { addDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function WavesPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const wavesQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'waves') : null), [firestore]);
  const { data: waves, isLoading: isWavesLoading } = useCollection<Wave>(wavesQuery as any);

  const customersQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'customers') : null), [firestore]);
  const { data: customers } = useCollection<Customer>(customersQuery as any);

  const poQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'purchase_orders') : null), [firestore]);
  const { data: allPOs } = useCollection<PurchaseOrder>(poQuery as any);

  const poLinesQuery = useMemoFirebase(() => (firestore ? collectionGroup(firestore, 'po_lines') : null), [firestore]);
  const { data: allPOLines } = useCollection<POLine>(poLinesQuery as any);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newWave, setNewWave] = useState<Partial<Wave>>({
    waveCode: '',
    status: 'PLANNING',
    plannedWorkers: 1,
    siteLocation: '',
    rotationPattern: '28/28',
    notes: ''
  });

  const handleCreate = async () => {
    if (!firestore || !currentUser) return;
    if (!newWave.poId || !newWave.poLineId) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาเลือก PO และ PO Line" });
      return;
    }

    const po = allPOs?.find(p => p.id === newWave.poId);
    const poLine = allPOLines?.find(l => l.id === newWave.poLineId);

    const waveRef = collection(firestore, 'waves');
    try {
      const docRef = await addDocumentNonBlocking(waveRef, {
        ...newWave,
        customerId: po?.customerId || '',
        projectName: po?.projectName || po?.title || '',
        assignedWorkers: 0,
        createdAt: Date.now(),
        createdBy: currentUser.id,
        updatedAt: Date.now(),
        updatedBy: currentUser.id
      });

      setIsCreateOpen(false);
      toast({ title: "สร้างเวฟงานสำเร็จ", description: "กำลังนำคุณไปที่หน้าจัดการรายละเอียด..." });
      if (docRef) router.push(`/waves/${docRef.id}`);
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถสร้างเวฟงานได้" });
    }
  };

  const getStatusBadge = (status: WaveStatus) => {
    switch (status) {
      case 'PLANNING': return <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200">PLANNING</Badge>;
      case 'READY': return <Badge variant="outline" className="bg-blue-50 text-blue-600 border-blue-200">READY</Badge>;
      case 'MOBILIZING': return <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-200">MOBILIZING</Badge>;
      case 'ACTIVE': return <Badge className="bg-green-600">ACTIVE</Badge>;
      case 'DEMOBILIZING': return <Badge variant="outline" className="bg-orange-50 text-orange-600 border-orange-200">DEMOBILIZING</Badge>;
      case 'CLOSED': return <Badge variant="secondary">CLOSED</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isUserLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        {/* Page Header */}
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <Waves className="h-8 w-8" /> เวฟงาน / รอบการทำงาน (Waves Management)
          </h1>
          <p className="text-muted-foreground text-lg">
            ใช้สำหรับบริหารรอบการส่งคนลงงานในแต่ละช่วงเวลา โดยเชื่อมกับ Customer PO, Assignment และการระดมพล
          </p>
        </div>

        {/* Operational Notice */}
        <Alert className="bg-amber-50 border-amber-200 text-amber-800 shadow-sm">
          <AlertCircle className="h-5 w-5 text-amber-600" />
          <AlertTitle className="font-bold">นโยบายการปิดเวฟ (Wave Closeout Policy)</AlertTitle>
          <AlertDescription className="text-sm">
            ไม่ควรปิด Wave หากยังมี Assignment ที่ยังไม่ปิดสถานะ หรือยังมีอุปกรณ์ PPE/เครื่องมือที่ค้างการรับคืนจากคนงาน
          </AlertDescription>
        </Alert>

        {/* Action Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="ค้นหารหัสเวฟ, ชื่อลูกค้า หรือโครงการ..." className="pl-9 h-11" />
            </div>
            <Button variant="outline" className="gap-2 h-11"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
          </div>
          
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 h-11 px-6 shadow-md bg-primary hover:bg-primary/90 text-base font-bold">
                <Plus className="h-5 w-5" /> สร้างเวฟงานใหม่ (Create Wave)
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>สร้างรอบการทำงานใหม่ (New Deployment Wave)</DialogTitle>
                <DialogDescription>ระบุข้อมูลพื้นฐานและเชื่อมต่อเข้ากับ Customer PO เพื่อเริ่มวางแผนส่งคน</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4 py-4">
                <div className="grid gap-2">
                  <Label>รหัสเวฟงาน (Wave Code)</Label>
                  <Input placeholder="WAVE-2024-XXX" value={newWave.waveCode} onChange={e => setNewWave({...newWave, waveCode: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label>สถานที่ปฏิบัติงาน (Site / Location)</Label>
                  <Input placeholder="เช่น Erawan Platform" value={newWave.siteLocation} onChange={e => setNewWave({...newWave, siteLocation: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label>เลือก Customer PO</Label>
                  <Select onValueChange={v => setNewWave({...newWave, poId: v, poLineId: ''})}>
                    <SelectTrigger><SelectValue placeholder="เลือก PO..." /></SelectTrigger>
                    <SelectContent>
                      {allPOs?.map(po => (
                        <SelectItem key={po.id} value={po.id}>{po.poCode} - {po.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>เลือกโควต้า (PO Line)</Label>
                  <Select onValueChange={v => setNewWave({...newWave, poLineId: v})} disabled={!newWave.poId}>
                    <SelectTrigger><SelectValue placeholder="เลือกรายการสั่งจอง..." /></SelectTrigger>
                    <SelectContent>
                      {allPOLines?.filter(l => l.poId === newWave.poId).map(line => (
                        <SelectItem key={line.id} value={line.id}>ID: {line.id.substring(0,8)} - Position: {line.positionId}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>วันที่เริ่มงาน (Start Date)</Label>
                  <Input type="date" value={newWave.startDate} onChange={e => setNewWave({...newWave, startDate: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label>วันที่สิ้นสุด (End Date)</Label>
                  <Input type="date" value={newWave.endDate} onChange={e => setNewWave({...newWave, endDate: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label>จำนวนคนงานที่วางแผน (Planned)</Label>
                  <Input type="number" min="1" value={newWave.plannedWorkers} onChange={e => setNewWave({...newWave, plannedWorkers: parseInt(e.target.value)})} />
                </div>
                <div className="grid gap-2">
                  <Label>รูปแบบกะงาน (Rotation)</Label>
                  <Input placeholder="เช่น 28/28" value={newWave.rotationPattern} onChange={e => setNewWave({...newWave, rotationPattern: e.target.value})} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>ยกเลิก</Button>
                <Button onClick={handleCreate} className="bg-primary font-bold">ยืนยันการสร้าง (Confirm)</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Data Table */}
        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isWavesLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลรอบการทำงาน...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4">รหัสเวฟ (Wave Code)</TableHead>
                    <TableHead className="font-bold">ลูกค้า & โครงการ (Context)</TableHead>
                    <TableHead className="font-bold">สถานที่ (Site)</TableHead>
                    <TableHead className="font-bold">ระยะเวลา (Period)</TableHead>
                    <TableHead className="font-bold text-center">คนงาน (Plan/Asgn)</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {waves?.map((wave) => {
                    const customer = customers?.find(c => c.id === wave.customerId);
                    return (
                      <TableRow 
                        key={wave.id} 
                        className="cursor-pointer hover:bg-muted/30 group transition-all"
                        onClick={() => router.push(`/waves/${wave.id}`)}
                      >
                        <TableCell className="py-4">
                          <div className="flex flex-col">
                            <span className="font-bold text-base text-primary">{wave.waveCode}</span>
                            <span className="text-[10px] text-muted-foreground uppercase">Pattern: {wave.rotationPattern}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-bold text-sm">{customer?.name || '...'}</span>
                            <span className="text-xs text-muted-foreground truncate max-w-[200px]">{wave.projectName}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 text-sm">
                            <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                            {wave.siteLocation}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                            <Calendar className="h-3.5 w-3.5" />
                            {wave.startDate} - {wave.endDate}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-2">
                            <Badge variant="outline" className="font-bold">{wave.assignedWorkers} / {wave.plannedWorkers}</Badge>
                          </div>
                        </TableCell>
                        <TableCell>{getStatusBadge(wave.status)}</TableCell>
                        <TableCell className="text-right pr-6">
                          <Button variant="ghost" size="icon" className="group-hover:text-primary"><ChevronRight className="h-5 w-5" /></Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {(!waves || waves.length === 0) && !isWavesLoading && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-20 text-muted-foreground italic">
                        ยังไม่มีเวฟงานในระบบ เริ่มต้นโดยกด 'สร้างเวฟงาน' เพื่อวางแผนการส่งคนลงงาน
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Workflow Guidance */}
        <Card className="bg-primary/5 border-primary/10 border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2 text-primary font-bold">
              <Info className="h-5 w-5" /> แนวทางปฏิบัติ (Next Steps)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="flex items-start gap-3 p-4 bg-white rounded-md border shadow-sm">
                <div className="bg-primary/10 p-2 rounded text-primary font-bold">1</div>
                <div>
                  <p className="font-bold">เพิ่มคนงานในเวฟ (Assign Workers)</p>
                  <p className="text-muted-foreground text-xs">คลิกที่เวฟงานและไปที่แท็บ 'คนในเวฟ' เพื่อเลือกคนงานที่มีสถานะ READY เข้าสู่รอบการทำงานนี้</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 bg-white rounded-md border shadow-sm">
                <div className="bg-primary/10 p-2 rounded text-primary font-bold">2</div>
                <div>
                  <p className="font-bold">เตรียมความพร้อม (Mobilization)</p>
                  <p className="text-muted-foreground text-xs">ตรวจสอบ Checklist ความพร้อมสุดท้ายและเบิกอุปกรณ์ PPE ก่อนที่เวฟงานจะเริ่ม (Start Date)</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
