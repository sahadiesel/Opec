'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, Trash2, ChevronRight, Briefcase, Activity, Info, Filter, ArrowRight, ShieldAlert, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Position, User, MainContract, PurchaseOrder } from '@/lib/types';
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
import { addDoc, collection, doc, collectionGroup, query, where, getDocs, getDoc } from 'firebase/firestore';
import { deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';
import { sanitizeFirestorePayload } from '@/lib/utils';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';

export default function PositionsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const positionsQuery = useMemoFirebase(() => {
    if (!firestore || !firebaseUser) return null;
    return collection(firestore, 'positions');
  }, [firestore, firebaseUser]);

  const { data: positions, isLoading } = useCollection<Position>(positionsQuery as any);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newPosition, setNewPosition] = useState<Partial<Position>>({
    positionNameTh: '',
    positionNameEn: '',
    positionCode: getPreviewPattern('position'),
    category: 'OFFSHORE',
    jobMode: 'ONSHORE',
    active: true,
    description: '',
    payrollBasis: 'DAILY',
  });

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setUser(JSON.parse(stored));
  }, []);

  const handleCreate = async () => {
    if (!firestore || !user || !firebaseUser) {
      toast({
        variant: 'destructive',
        title: 'ยังไม่พร้อมบันทึก',
        description: 'กรุณารอให้เข้าสู่ระบบครบถ้วนแล้วลองอีกครั้ง',
      });
      return;
    }

    setIsCreating(true);
    try {
      const { code: finalNo } = await generateNextDocumentCode(firestore, 'position', {
        actor: user.displayName,
        userId: firebaseUser.uid,
      });

      const posRef = collection(firestore, 'positions');
      const payload = sanitizeFirestorePayload({
        ...newPosition,
        positionCode: finalNo,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const docRef = await addDoc(posRef, payload);

      setIsCreateOpen(false);
      toast({
        title: 'สร้างตำแหน่งงานสำเร็จ',
        description: `รหัสตำแหน่ง: ${finalNo}`,
      });
      router.push(`/positions/${docRef.id}`);
    } catch (error) {
      console.error(error);
      const msg = error instanceof Error ? error.message : 'ไม่สามารถสร้างตำแหน่งงานได้';
      toast({
        variant: 'destructive',
        title: 'เกิดข้อผิดพลาด',
        description: msg,
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!firestore) return;
    if (!confirm('ยืนยันการลบตำแหน่งงานนี้?')) return;

    try {
      const blockingLabels = new Set<string>();

      const ratesSnap = await getDocs(
        query(collectionGroup(firestore, 'position_rates'), where('positionId', '==', id))
      );
      for (const d of ratesSnap.docs) {
        const contractRef = d.ref.parent.parent;
        if (!contractRef) continue;
        const cSnap = await getDoc(contractRef);
        const c = cSnap.data() as MainContract | undefined;
        if (c && (c.status === 'active' || c.status === 'pending')) {
          blockingLabels.add(c.contractNumber || contractRef.id);
        }
      }

      const poLinesSnap = await getDocs(
        query(collectionGroup(firestore, 'po_lines'), where('positionId', '==', id))
      );
      for (const d of poLinesSnap.docs) {
        const poRef = d.ref.parent.parent;
        if (!poRef) continue;
        const pSnap = await getDoc(poRef);
        const po = pSnap.data() as PurchaseOrder | undefined;
        if (po && (po.status === 'active' || po.status === 'pending')) {
          blockingLabels.add(po.poCode || poRef.id);
        }
      }

      if (blockingLabels.size > 0) {
        toast({
          variant: 'destructive',
          title: 'ลบไม่ได้: ตำแหน่งนี้ยังมีอยู่ในสัญญาที่ยังไม่จบ',
          description: `พบการอ้างอิงในเอกสารที่ยังใช้งานอยู่ เช่น ${Array.from(blockingLabels).slice(0, 5).join(', ')}${blockingLabels.size > 5 ? ' …' : ''}`,
        });
        return;
      }

      deleteDocumentNonBlocking(doc(firestore, 'positions', id));
      toast({ title: 'ลบตำแหน่งงานแล้ว' });
    } catch (err) {
      console.error(err);
      toast({
        variant: 'destructive',
        title: 'ตรวจสอบไม่สำเร็จ',
        description: 'ไม่สามารถตรวจสอบการอ้างอิงก่อนลบได้ กรุณาลองใหม่',
      });
    }
  };

  if (isUserLoading || !user) return null;

  return (
    <AppShell user={user} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        {/* 1. Page Header & Description */}
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="flex flex-col gap-2 min-w-0">
            <PayrollScopeTag scope="worker" showHint={false} />
            <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
              <Activity className="h-8 w-8 shrink-0" /> ตำแหน่งงาน (Positions)
            </h1>
            <p className="text-muted-foreground text-lg">
              ใช้กับมอบหมายงานและ <strong>Worker Payroll</strong> — ไม่ใช่ตำแหน่งพนักงานออฟฟิศ
            </p>
          </div>
        </div>

        {/* 2. Compliance Warning Box */}
        <Alert className="bg-amber-50 border-amber-200 text-amber-800 shadow-sm">
          <ShieldAlert className="h-5 w-5 text-amber-600" />
          <AlertTitle className="font-bold text-lg text-amber-900">เกณฑ์มาตรฐานความพร้อม (Readiness Compliance Standard)</AlertTitle>
          <AlertDescription className="text-sm">
            การกำหนดรายการใบรับรองในสถานะ "<b>บังคับ (Mandatory)</b>" จะมีผลโดยตรงต่อการคำนวณ Readiness Status ของคนงานทุกคนภายใต้ตำแหน่งนั้น หากคนงานมีใบเซอร์ไม่ครบหรือหมดอายุ ระบบจะไม่อนุญาตให้ส่งตัวเข้าหน้างาน (Mobilization)
          </AlertDescription>
        </Alert>

        {/* 3. Action Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="ค้นหาชื่อตำแหน่งหรือรหัสมาตรฐาน..." className="pl-9 h-11" />
            </div>
            <Button variant="outline" size="icon" className="h-11 w-11"><Filter className="h-4 w-4" /></Button>
          </div>
          
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 h-11 px-6 shadow-md bg-primary hover:bg-primary/90 text-base font-semibold">
                <Plus className="h-5 w-5" /> เพิ่มตำแหน่งงานมาตรฐาน (New Position)
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>สร้างตำแหน่งงานใหม่ (New Position Entry)</DialogTitle>
                <DialogDescription>ระบุข้อมูลพื้นฐานของตำแหน่งงานเพื่อนำไปกำหนดเกณฑ์มาตรฐานในขั้นตอนถัดไป</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">ชื่อตำแหน่ง (Position Name)</Label>
                  <Input id="name" value={newPosition.positionNameTh} onChange={e => setNewPosition({...newPosition, positionNameTh: e.target.value, positionNameEn: e.target.value || newPosition.positionNameEn})} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="code">รหัสตำแหน่ง (Code)</Label>
                  <Input id="code" value={newPosition.positionCode} disabled className="bg-muted font-mono font-bold text-primary" />
                  <p className="text-[10px] text-muted-foreground italic">* ระบบจะออกรหัสจริงให้อัตโนมัติเมื่อกดบันทึก</p>
                </div>
                <div className="grid gap-2">
                  <Label>หมวดหมู่ (Category)</Label>
                  <Select onValueChange={v => setNewPosition({...newPosition, category: v as any})} value={newPosition.category}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="OFFSHORE">Offshore</SelectItem>
                      <SelectItem value="ONSHORE">Onshore</SelectItem>
                      <SelectItem value="OFFICE">Office</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>ฐานการจ่ายเงิน (Payroll Basis)</Label>
                  <Select onValueChange={v => setNewPosition({...newPosition, payrollBasis: v as any})} value={newPosition.payrollBasis}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DAILY">Daily</SelectItem>
                      <SelectItem value="MONTHLY">Monthly</SelectItem>
                      <SelectItem value="HOURLY">Hourly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2 col-span-2">
                  <Label htmlFor="desc">รายละเอียดงาน (Description)</Label>
                  <Input id="desc" value={newPosition.description} onChange={e => setNewPosition({...newPosition, description: e.target.value})} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)} disabled={isCreating}>ยกเลิก</Button>
                <Button onClick={handleCreate} className="bg-primary font-bold" disabled={isCreating}>
                  {isCreating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  บันทึกและจัดการเกณฑ์มาตรฐาน (Save)
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* 4. Data Content */}
        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลเมทริกซ์ตำแหน่ง (Loading Matrix)...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4">ตำแหน่งงาน (Standard Position)</TableHead>
                    <TableHead className="font-bold">รหัส (Code)</TableHead>
                    <TableHead className="font-bold">หมวดหมู่ (Category)</TableHead>
                    <TableHead className="font-bold">ฐานการจ่าย (Payroll)</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positions?.map((pos) => (
                    <TableRow 
                      key={pos.id} 
                      className="cursor-pointer hover:bg-muted/50 group transition-all" 
                      onClick={() => router.push(`/positions/${pos.id}`)}
                    >
                      <TableCell className="py-4">
                        <div className="flex flex-col">
                          <span className="font-bold text-base text-primary">{pos.positionNameTh}</span>
                          <span className="text-[10px] text-muted-foreground uppercase tracking-tight">Standard Matrix Entry</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs font-bold text-primary">{pos.positionCode}</TableCell>
                      <TableCell>{pos.category}</TableCell>
                      <TableCell>{pos.payrollBasis}</TableCell>
                      <TableCell>
                        <Badge variant={pos.active ? 'default' : 'secondary'} className={pos.active ? 'bg-green-600' : ''}>
                          {pos.active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="text-destructive h-8 w-8" 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(pos.id, e);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          <ChevronRight className="h-5 w-5 text-muted-foreground" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!positions || positions.length === 0) && !isLoading && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-20 text-muted-foreground">ไม่พบข้อมูลตำแหน่งงานมาตรฐานในระบบ</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* 5. Next-Step Guidance */}
        <Card className="bg-primary/5 border-primary/10 border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2 text-primary font-bold">
              <Info className="h-5 w-5" /> แนวทางปฏิบัติถัดไป (Workflow Guidance)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="flex items-start gap-3 p-4 bg-white rounded-md border shadow-sm">
                <div className="bg-primary/10 p-2 rounded text-primary font-bold">1</div>
                <div>
                  <p className="font-bold">ตั้งค่าเกณฑ์ความพร้อม (Define Readiness Criteria)</p>
                  <p className="text-muted-foreground text-xs">คลิกที่ตำแหน่งงานเพื่อระบุรายการ "ใบเซอร์" และ "PPE" ที่คนงานในตำแหน่งนั้นต้องมีให้ครบถ้วน</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 bg-white rounded-md border shadow-sm">
                <div className="bg-primary/10 p-2 rounded text-primary font-bold">2</div>
                <div>
                  <p className="font-bold">ตรวจสอบฐานข้อมูลคนงาน (Sync Worker Data)</p>
                  <p className="text-muted-foreground text-xs">หลังจากกำหนดเกณฑ์แล้ว ระบบจะทำการ Re-calculate สถานะความพร้อมของคนงานทุกคนโดยอัตโนมัติ</p>
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter className="pt-0 justify-end">
            <Button variant="link" className="gap-2 text-primary font-bold" asChild>
              <a href="/workers">ไปยังระบบจัดการคนงาน (Go to Workers) <ArrowRight className="h-4 w-4" /></a>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </AppShell>
  );
}
