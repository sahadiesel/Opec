'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, Trash2, Edit, ListChecks, HardHat, Hammer, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Position, RoleType, User } from '@/lib/types';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, addDoc } from 'firebase/firestore';
import { deleteDocumentNonBlocking, addDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Badge } from '@/components/ui/badge';

export default function PositionsPage() {
  const [user, setUser] = useState<User | null>(null);
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();

  const positionsQuery = useMemoFirebase(() => {
    if (!firestore || !firebaseUser || !user) return null;
    return collection(firestore, 'positions');
  }, [firestore, firebaseUser, user]);

  const { data: positions, isLoading } = useCollection<Position>(positionsQuery as any);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newPosition, setNewPosition] = useState({ name: '', code: '', description: '' });

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setUser(JSON.parse(stored));
  }, []);

  const handleCreate = () => {
    if (!firestore) return;
    const posRef = collection(firestore, 'positions');
    addDocumentNonBlocking(posRef, {
      ...newPosition,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    setIsCreateOpen(false);
    setNewPosition({ name: '', code: '', description: '' });
  };

  const handleDelete = (id: string) => {
    if (!firestore) return;
    if (confirm('ยืนยันการลบตำแหน่งงานนี้?')) {
      deleteDocumentNonBlocking(doc(firestore, 'positions', id));
    }
  };

  if (!user || isUserLoading) return null;

  return (
    <AppShell user={user} onLogout={() => {}}>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary">เมทริกซ์ตำแหน่งงาน (Position Matrix)</h1>
            <p className="text-muted-foreground">กำหนดเกณฑ์ความพร้อม มาตรฐานใบรับรอง PPE และอุปกรณ์สำหรับแต่ละตำแหน่ง</p>
          </div>
          
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" /> เพิ่มตำแหน่งงานใหม่
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>สร้างตำแหน่งงานใหม่</DialogTitle>
                <DialogDescription>ระบุข้อมูลพื้นฐานของตำแหน่งงานเพื่อนำไปกำหนดเกณฑ์มาตรฐาน</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">ชื่อตำแหน่ง (Position Name)</Label>
                  <Input id="name" value={newPosition.name} onChange={e => setNewPosition({...newPosition, name: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="code">รหัสตำแหน่ง (Code)</Label>
                  <Input id="code" value={newPosition.code} onChange={e => setNewPosition({...newPosition, code: e.target.value})} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>ยกเลิก</Button>
                <Button onClick={handleCreate}>บันทึกตำแหน่ง</Button>
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
              <div className="py-10 text-center text-muted-foreground italic">กำลังโหลดข้อมูลตำแหน่งงาน...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ตำแหน่ง (Position)</TableHead>
                    <TableHead>รหัส (Code)</TableHead>
                    <TableHead>สถานะ (Status)</TableHead>
                    <TableHead className="text-right">จัดการ (Actions)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positions?.map((pos) => (
                    <TableRow key={pos.id}>
                      <TableCell className="font-semibold">{pos.name}</TableCell>
                      <TableCell>{pos.code}</TableCell>
                      <TableCell>
                        <Badge variant={pos.isActive ? 'default' : 'secondary'}>
                          {pos.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button variant="outline" size="sm" className="gap-2">
                          <Edit className="h-4 w-4" /> เกณฑ์มาตรฐาน
                        </Button>
                        <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(pos.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
