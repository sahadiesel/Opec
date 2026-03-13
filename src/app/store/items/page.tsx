'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { 
  Package, 
  Plus, 
  Search, 
  Filter, 
  ArrowLeft,
  HardHat,
  Hammer,
  Trash2,
  Edit2
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { StoreItem, User } from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';

export default function StoreItemsPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const itemsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'store_items') : null), [firestore]);
  const { data: items, isLoading } = useCollection<StoreItem>(itemsQuery as any);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newItem, setNewItem] = useState<Partial<StoreItem>>({
    itemCode: '',
    itemName: '',
    category: 'PPE',
    unit: 'Unit',
    minimumStock: 5,
    currentStock: 0,
    isPPE: true,
    isTool: false,
    active: true
  });

  const handleCreate = async () => {
    if (!firestore) return;
    const colRef = collection(firestore, 'store_items');
    
    try {
      await addDocumentNonBlocking(colRef, {
        ...newItem,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      setIsCreateOpen(false);
      toast({ title: "เพิ่มอุปกรณ์สำเร็จ" });
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถบันทึกข้อมูลได้" });
    }
  };

  const handleDelete = (id: string) => {
    if (!firestore) return;
    if (confirm('ยืนยันการลบรายการอุปกรณ์?')) {
      deleteDocumentNonBlocking(doc(firestore, 'store_items', id));
    }
  };

  if (!currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/store"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div className="flex-1">
            <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
              <Package className="h-8 w-8" /> ทะเบียนอุปกรณ์ (Store Catalog)
            </h1>
            <p className="text-muted-foreground text-sm">จัดการข้อมูลหลัก PPE และเครื่องมือช่างสำหรับงาน Offshore</p>
          </div>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 h-11 px-6 bg-primary shadow-md font-bold">
                <Plus className="h-5 w-5" /> เพิ่มอุปกรณ์ใหม่ (Add Item)
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>ลงทะเบียนอุปกรณ์ใหม่</DialogTitle>
                <DialogDescription>เพิ่มข้อมูลอุปกรณ์เพื่อใช้ในระบบเบิกจ่าย</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4 py-4">
                <div className="grid gap-2">
                  <Label>รหัสอุปกรณ์ (Item Code)</Label>
                  <Input placeholder="PPE-001" value={newItem.itemCode} onChange={e => setNewItem({...newItem, itemCode: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label>ชื่ออุปกรณ์ (Item Name)</Label>
                  <Input placeholder="Welding Helmet" value={newItem.itemName} onChange={e => setNewItem({...newItem, itemName: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label>หมวดหมู่ (Category)</Label>
                  <Select onValueChange={v => setNewItem({...newItem, category: v})} value={newItem.category}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PPE">PPE</SelectItem>
                      <SelectItem value="Safety">Safety</SelectItem>
                      <SelectItem value="Mechanical">Mechanical</SelectItem>
                      <SelectItem value="Electrical">Electrical</SelectItem>
                      <SelectItem value="General">General</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>หน่วยนับ (Unit)</Label>
                  <Input placeholder="EA, Set, Pair" value={newItem.unit} onChange={e => setNewItem({...newItem, unit: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label>สต็อกขั้นต่ำ (Alert Level)</Label>
                  <Input type="number" value={newItem.minimumStock} onChange={e => setNewItem({...newItem, minimumStock: parseInt(e.target.value)})} />
                </div>
                <div className="grid gap-2">
                  <Label>สต็อกปัจจุบัน (Initial)</Label>
                  <Input type="number" value={newItem.currentStock} onChange={e => setNewItem({...newItem, currentStock: parseInt(e.target.value)})} />
                </div>
                <div className="flex items-center justify-between p-3 border rounded-md">
                  <div className="space-y-0.5">
                    <Label>เป็นอุปกรณ์ PPE</Label>
                    <p className="text-[10px] text-muted-foreground">ใช้ตรวจสอบกับ Position Requirement</p>
                  </div>
                  <Switch checked={newItem.isPPE} onCheckedChange={v => setNewItem({...newItem, isPPE: v})} />
                </div>
                <div className="flex items-center justify-between p-3 border rounded-md">
                  <div className="space-y-0.5">
                    <Label>เป็นเครื่องมือ (Tool)</Label>
                    <p className="text-[10px] text-muted-foreground">ใช้ตรวจสอบกับ Tool Requirement</p>
                  </div>
                  <Switch checked={newItem.isTool} onCheckedChange={v => setNewItem({...newItem, isTool: v})} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>ยกเลิก</Button>
                <Button onClick={handleCreate} className="bg-primary font-bold">บันทึกข้อมูล (Save Item)</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardHeader className="bg-muted/30">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="relative w-full max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="ค้นหาตามชื่อ หรือ รหัสอุปกรณ์..." className="pl-9 h-10" />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="gap-2"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-20 text-center text-muted-foreground animate-pulse">กำลังโหลดข้อมูล...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4 pl-6">รหัส (Code)</TableHead>
                    <TableHead className="font-bold">ชื่อรายการ (Name)</TableHead>
                    <TableHead className="font-bold">หมวดหมู่</TableHead>
                    <TableHead className="font-bold text-center">คงเหลือ (Stock)</TableHead>
                    <TableHead className="font-bold">ประเภท</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items?.map((item) => (
                    <TableRow key={item.id} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="pl-6 font-mono text-xs font-bold text-primary">{item.itemCode}</TableCell>
                      <TableCell className="font-bold text-primary">{item.itemName}</TableCell>
                      <TableCell><Badge variant="outline">{item.category}</Badge></TableCell>
                      <TableCell className="text-center">
                        <span className={`font-black text-lg ${item.currentStock <= item.minimumStock ? 'text-red-600' : 'text-primary'}`}>
                          {item.currentStock}
                        </span>
                        <span className="text-[10px] text-muted-foreground ml-1">{item.unit}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {item.isPPE && <HardHat className="h-4 w-4 text-orange-500" title="PPE" />}
                          {item.isTool && <Hammer className="h-4 w-4 text-blue-500" title="Tool" />}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={item.active ? "bg-green-600" : "bg-slate-200"}>
                          {item.active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right pr-6 space-x-2">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-primary"><Edit2 className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(item.id)}><Trash2 className="h-4 w-4" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!items || items.length === 0) && !isLoading && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-20 text-muted-foreground italic">ไม่มีรายการอุปกรณ์ในระบบ</TableCell>
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
