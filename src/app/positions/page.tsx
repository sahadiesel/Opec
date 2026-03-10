'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, Trash2, ChevronRight, Briefcase } from 'lucide-react';
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
      
      // Navigate to detail page after a short delay
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
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary flex items-center gap-2">
              <Briefcase className="h-6 w-6" /> เมทริกซ์ตำแหน่งงาน (Position Matrix)
            </h1>
            <p className="text-muted-foreground">กำหนดมาตรฐานเกณฑ์ความพร้อม PPE และอุปกรณ์สำหรับกำลังคน</p>
          </div>
          
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" /> เพิ่มตำแหน่งงานใหม่
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>สร้างตำแหน่งงานใหม่</DialogTitle>
                <DialogDescription>ระบุข้อมูลพื้นฐานของตำแหน่งงานเพื่อนำไปกำหนดเกณฑ์มาตรฐาน</DialogDescription>
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
                <Button onClick={handleCreate}>บันทึกและจัดการรายละเอียด</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle>รายการตำแหน่งงาน</CardTitle>
              <div className="relative w-72">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input type="search" placeholder="ค้นหาตำแหน่ง..." className="pl-8" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-10 text-center text-muted-foreground italic">กำลังโหลดข้อมูล...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ตำแหน่ง (Position)</TableHead>
                    <TableHead>รหัส (Code)</TableHead>
                    <TableHead>หมวดหมู่</TableHead>
                    <TableHead>ฐานการจ่าย</TableHead>
                    <TableHead>สถานะ</TableHead>
                    <TableHead className="text-right">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positions?.map((pos) => (
                    <TableRow key={pos.id} className="cursor-pointer hover:bg-muted/50 group" asChild>
                      <Link href={`/positions/${pos.id}`}>
                        <TableCell className="font-semibold">{pos.positionName}</TableCell>
                        <TableCell className="font-mono text-xs">{pos.positionCode}</TableCell>
                        <TableCell>{pos.category}</TableCell>
                        <TableCell>{pos.payrollBasis}</TableCell>
                        <TableCell>
                          <Badge variant={pos.active ? 'default' : 'secondary'}>
                            {pos.active ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button variant="ghost" size="icon" className="text-destructive" onClick={(e) => handleDelete(pos.id, e)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                            <ChevronRight className="h-5 w-5 text-muted-foreground" />
                          </div>
                        </TableCell>
                      </Link>
                    </TableRow>
                  ))}
                  {(!positions || positions.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">ไม่พบข้อมูลตำแหน่งงาน</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
