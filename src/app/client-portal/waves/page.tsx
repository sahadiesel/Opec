
'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  ShieldCheck, 
  ChevronRight, 
  HardHat, 
  Search, 
  Filter, 
  Briefcase, 
  Calendar, 
  Waves,
  MapPin,
  Clock,
  User,
  ExternalLink,
  Info,
  Lock
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { User as AppUser, Worker, Assignment, Wave } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where, orderBy, doc } from 'firebase/firestore';
import { PageGuidance } from '@/components/layout/page-guidance';
import { CustomerQueryService } from '@/lib/services/customer-query-service';
import Link from 'next/link';

export default function ClientManpowerPage() {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const [searchTerm, setSearchTerm] = useState('');

  // 1. Data Queries using Scoping Service
  const queryService = useMemo(() => firestore ? new CustomerQueryService(firestore) : null, [firestore]);

  const wavesQuery = useMemoFirebase(() => queryService?.getScopedWavesQuery(currentUser), [queryService, currentUser]);
  const { data: waves, isLoading: isWavesLoading } = useCollection<Wave>(wavesQuery as any);

  const asgnQuery = useMemoFirebase(() => queryService?.getScopedAssignmentsQuery(currentUser), [queryService, currentUser]);
  const { data: assignments, isLoading: isAsgnLoading } = useCollection<Assignment>(asgnQuery as any);

  const workersQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'workers') : null), [firestore]);
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  const activePersonnel = useMemo(() => {
    if (!assignments) return [];
    return assignments.filter(a => ['ACTIVE', 'MOBILIZING', 'READY_TO_MOB', 'CONFIRMED'].includes(a.deploymentStatus));
  }, [assignments]);

  const filteredPersonnel = useMemo(() => {
    return activePersonnel.filter(asgn => {
      const worker = allWorkers?.find(w => w.id === asgn.workerId);
      const name = worker ? `${worker.firstName} ${worker.lastName}` : '';
      const combined = `${name} ${asgn.projectName} ${asgn.positionId}`.toLowerCase();
      return combined.includes(searchTerm.toLowerCase());
    });
  }, [activePersonnel, allWorkers, searchTerm]);

  if (isUserLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <HardHat className="h-8 w-8" /> รายชื่อพนักงานและรอบการทำงาน (Active Workforce)
          </h1>
          <p className="text-muted-foreground text-lg italic">
            ติดตามสถานะพนักงานที่กำลังปฏิบัติงานและรอบการระดมพล (Mobilization tracking).
          </p>
        </div>

        <PageGuidance 
          title="สถานะพนักงานหน้างาน"
          tips={[
            "รายการด้านล่างแสดงเฉพาะพนักงานที่กำลังปฏิบัติงานหรืออยู่ในระหว่างการระดมพล (Mobilizing)",
            "รายการที่ระบุ 'Operational Lock' คือพนักงานที่ยืนยันการลงงานแล้ว ไม่สามารถเปลี่ยนแปลงผ่านระบบพอร์ทัลได้",
            "หากท่านต้องการขอเปลี่ยนตัวพนักงานหรือมีข้อสงสัย กรุณาติดต่อฝ่ายปฏิบัติการ (Operations) ของ OPEC"
          ]}
        />

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-3 space-y-6">
            <div className="flex items-center gap-3 bg-card p-4 rounded-lg border shadow-sm">
              <div className="relative w-full max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="ค้นหาชื่อพนักงาน หรือ โครงการ..." 
                  className="pl-9 h-11" 
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
              </div>
              <Button variant="outline" className="h-11 gap-2"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
            </div>

            <Card className="shadow-lg border-none overflow-hidden">
              <CardHeader className="bg-muted/30 border-b">
                <CardTitle className="text-lg">รายชื่อกำลังพลปัจจุบัน (Current Roster)</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {isAsgnLoading ? (
                  <div className="py-20 text-center animate-pulse italic">กำลังโหลดข้อมูลพนักงาน...</div>
                ) : (
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="pl-6 py-4 font-bold">พนักงาน (Name)</TableHead>
                        <TableHead className="font-bold">ตำแหน่ง & โครงการ</TableHead>
                        <TableHead className="font-bold">ช่วงเวลา (Period)</TableHead>
                        <TableHead className="font-bold">สถานะปัจจุบัน</TableHead>
                        <TableHead className="text-right pr-6">จัดการ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredPersonnel.map((asgn) => {
                        const worker = allWorkers?.find(w => w.id === asgn.workerId);
                        const isOpLocked = ['CONFIRMED', 'ACTIVE', 'CLOSED'].includes(asgn.deploymentStatus);
                        
                        return (
                          <TableRow key={asgn.id} className={`${isOpLocked ? 'bg-slate-50/30' : ''} hover:bg-muted/20 transition-all group`}>
                            <TableCell className="pl-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary">
                                  {worker?.firstName.charAt(0)}
                                </div>
                                <div className="flex flex-col">
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-sm text-primary">{worker?.firstName} {worker?.lastName}</span>
                                    {isOpLocked && <Lock className="h-3 w-3 text-amber-600" title="Operational Lock - Finalized" />}
                                  </div>
                                  <span className="text-[10px] text-muted-foreground">National ID: {worker?.thaiNationalId.substring(0, 10)}...</span>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col">
                                <Badge variant="outline" className="w-fit text-[9px] font-black bg-white border-primary/20 text-primary mb-1">
                                  {asgn.positionId}
                                </Badge>
                                <span className="text-xs font-medium text-slate-600 truncate max-w-[150px]">{asgn.projectName}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-xs font-medium text-muted-foreground">
                              <div className="flex items-center gap-1.5">
                                <Calendar className="h-3 w-3" />
                                {asgn.startDate} - {asgn.endDate}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                <Badge variant={asgn.deploymentStatus === 'ACTIVE' ? 'default' : 'secondary'} className={asgn.deploymentStatus === 'ACTIVE' ? 'bg-green-600' : 'uppercase text-[9px]'}>
                                  {asgn.deploymentStatus}
                                </Badge>
                                {isOpLocked && <span className="text-[8px] text-amber-700 font-bold uppercase tracking-tighter">Operational Lock</span>}
                              </div>
                            </TableCell>
                            <TableCell className="text-right pr-6">
                              <Button size="sm" variant="ghost" className="font-bold text-xs h-8 group">
                                ดูประวัติ <ChevronRight className="h-4 w-4 ml-1 group-hover:translate-x-1 transition-all" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {filteredPersonnel.length === 0 && !isAsgnLoading && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-20 text-muted-foreground italic">ไม่มีรายชื่อพนักงานปฏิบัติงานในช่วงนี้</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="shadow-sm border-none bg-primary/5">
              <CardHeader className="pb-3 border-b border-primary/10">
                <CardTitle className="text-sm font-black uppercase text-primary flex items-center gap-2">
                  <Waves className="h-4 w-4" /> รอบงานปัจจุบัน (Active Waves)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                {waves?.filter(w => w.status === 'ACTIVE').map(wave => (
                  <div key={wave.id} className="p-3 bg-white rounded-lg border shadow-sm space-y-2">
                    <div className="flex justify-between items-start">
                      <p className="font-bold text-sm text-primary">{wave.waveCode}</p>
                      <Badge className="bg-green-600 text-[8px] h-4">ACTIVE</Badge>
                    </div>
                    <div className="text-[10px] text-muted-foreground space-y-1">
                      <p className="flex items-center gap-1.5"><MapPin className="h-3 w-3" /> {wave.siteLocation}</p>
                      <p className="flex items-center gap-1.5"><Users className="h-3 w-3" /> {wave.assignedWorkers} / {wave.plannedWorkers} Personnel</p>
                    </div>
                  </div>
                ))}
                {!waves?.filter(w => w.status === 'ACTIVE').length && (
                  <p className="text-center text-xs text-muted-foreground italic py-10">ไม่พบรอบงานที่เปิดอยู่</p>
                )}
              </CardContent>
            </Card>

            <Card className="border-dashed">
              <CardHeader className="pb-2"><CardTitle className="text-xs font-bold uppercase text-muted-foreground">สรุปจำนวนคน</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">พนักงานหน้างานรวม:</span>
                  <span className="font-black text-primary">{activePersonnel.length} คน</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">กำลังระดมพล:</span>
                  <span className="font-bold text-indigo-600">{activePersonnel.filter(a => a.deploymentStatus !== 'ACTIVE').length} คน</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
