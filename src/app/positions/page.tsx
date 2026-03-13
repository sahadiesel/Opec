'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, Trash2, ChevronRight, Briefcase, Activity, Info, Filter, ArrowRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Position, User } from '@/lib/types';
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
import { collection, doc } from 'firebase/firestore';
import { deleteDocumentNonBlocking, addDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

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
  const [newPosition, setNewPosition] = useState<Partial<Position>>({
    positionName: '',
    positionCode: '',
    category: 'Offshore',
    active: true,
    description: '',
    payrollBasis: 'Daily',
    notes: ''
  });

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setUser(JSON.parse(stored));
  }, []);

  const handleCreate = async () => {
    if (!firestore) return;
    const posRef = collection(firestore, 'positions');
    
    try {
      const docRef = await addDocumentNonBlocking(posRef, {
        ...newPosition,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      
      setIsCreateOpen(false);
      toast({
        title: "สร้างตำแหน่งงานสำเร็จ",
        description: "กำลังนำคุณไปที่หน้าจัดการรายละเอียด...",
      });
      
      if (docRef) {
        router.push(`/positions/${docRef.id}`);
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "เกิดข้อผิดพลาด",
        description: "ไม่สามารถสร้างตำแหน่งงานได้",
      });
    }
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!firestore) return;
    if (confirm('ยืนยันการลบตำแหน่งงานนี้?')) {
      deleteDocumentNonBlocking(doc(firestore, 'positions', id));
    }
  };

  if (isUserLoading || !user) return null;

  return (
    <AppShell user={user} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        {/* 1. Page Header & Description */}
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <Activity className="h-8 w-8" /> เมทริกซ์ตำแหน่งงาน (Positions)
          </h1>
          <p className="text-muted-foreground text-lg">
            กำหนดมาตรฐานตำแหน่งงาน เกณฑ์ความพร้อม (Readiness), รายการใบเซอร์, PPE และอุปกรณ์ที่จำเป็น
          </p>
        </div>

        {/* 2. Operational Notice */}
        <Alert className="bg-primary/5 border-primary/20">
          <Info className="h-4 w-4 text-primary" />
          <AlertTitle className="font-bold">เกณฑ์มาตรฐานความปลอดภัย (Compliance Standards)</AlertTitle>
          <AlertDescription>
            การกำหนดรายการใบเซอร์ที่ "บังคับ (Mandatory)" จะส่งผลโดยตรงต่อการคำนวณ Readiness Status ของคนงานทุกคนในตำแหน่งนั้น
          </AlertDescription>
        </Alert>

        {/* 3. Action Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="ค้นหาชื่อตำแหน่งหรือรหัส..." className="pl-9" />
            </div>
            <Button variant="outline" size="icon"><Filter className="h-4 w-4" /></Button>
          </div>
          
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 h-11 px-6 shadow-md bg-primary hover:bg-primary/90">
                <Plus className="h-5 w-5" /> เพิ่มตำแหน่งงานใหม่ (New Position)
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
                  <Input id="name" value={newPosition.positionName} onChange={e => setNewPosition({...newPosition, positionName: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="code">รหัสตำแหน่ง (Code)</Label>
                  <Input id="code" value={newPosition.positionCode} onChange={e => setNewPosition({...newPosition, positionCode: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label>หมวดหมู่ (Category)</Label>
                  <Select onValueChange={v => setNewPosition({...newPosition, category: v})} value={newPosition.category}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Offshore">Offshore</SelectItem>
                      <SelectItem value="Onshore">Onshore</SelectItem>
                      <SelectItem value="Technical">Technical</SelectItem>
                      <SelectItem value="Administrative">Administrative</SelectItem>
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
                      <SelectItem value="Daily">Daily</SelectItem>
                      <SelectItem value="Monthly">Monthly</SelectItem>
                      <SelectItem value="Hourly">Hourly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2 col-span-2">
                  <Label htmlFor="desc">รายละเอียดงาน (Description)</Label>
                  <Input id="desc" value={newPosition.description} onChange={e => setNewPosition({...newPosition, description: e.target.value})} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>ยกเลิก</Button>
                <Button onClick={handleCreate} className="bg-primary">บันทึกและจัดการเกณฑ์มาตรฐาน (Save)</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* 4. Data Content */}
        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลตำแหน่ง (Loading Positions)...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold">ตำแหน่ง (Position Name)</TableHead>
                    <TableHead className="font-bold">รหัส (Code)</TableHead>
                    <TableHead className="font-bold">หมวดหมู่ (Category)</TableHead>
                    <TableHead className="font-bold">ฐานการจ่าย (Payroll)</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                    <TableHead className="text-right">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positions?.map((pos) => (
                    <TableRow 
                      key={pos.id} 
                      className="cursor-pointer hover:bg-muted/50 group" 
                      onClick={() => router.push(`/positions/${pos.id}`)}
                    >
                      <TableCell className="font-semibold">{pos.positionName}</TableCell>
                      <TableCell className="font-mono text-xs font-bold text-primary">{pos.positionCode}</TableCell>
                      <TableCell>{pos.category}</TableCell>
                      <TableCell>{pos.payrollBasis}</TableCell>
                      <TableCell>
                        <Badge variant={pos.active ? 'default' : 'secondary'} className={pos.active ? 'bg-green-600' : ''}>
                          {pos.active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="text-destructive" 
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
                      <TableCell colSpan={6} className="text-center py-20 text-muted-foreground">ไม่พบข้อมูลตำแหน่งงานในระบบ</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* 5. Next-Step Guidance */}
        <Card className="bg-primary/5 border-primary/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Info className="h-5 w-5 text-primary" /> ขั้นตอนถัดไป (Next Steps)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="flex items-start gap-3 p-3 bg-white rounded-md border shadow-sm">
                <div className="bg-primary/10 p-2 rounded text-primary font-bold">1</div>
                <div>
                  <p className="font-bold">ระบุเกณฑ์ความพร้อม (Readiness Matrix)</p>
                  <p className="text-muted-foreground text-xs">คลิกที่ตำแหน่งงานเพื่อเพิ่มรายการใบเซอร์และ PPE ที่ต้องใช้</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-white rounded-md border shadow-sm">
                <div className="bg-primary/10 p-2 rounded text-primary font-bold">2</div>
                <div>
                  <p className="font-bold">ตรวจสอบข้อมูลคนงาน (Workers)</p>
                  <p className="text-muted-foreground text-xs">ระบบจะเปรียบเทียบใบเซอร์ของคนงานกับเกณฑ์ที่กำหนดไว้โดยอัตโนมัติ</p>
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter className="pt-0 justify-end">
            <Button variant="link" className="gap-2" asChild>
              <a href="/workers">ไปยังทะเบียนคนงาน (Go to Workers) <ArrowRight className="h-4 w-4" /></a>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </AppShell>
  );
}