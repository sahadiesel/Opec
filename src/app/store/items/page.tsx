'use client';

import { useState } from 'react';
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
import { StoreItem, User, StoreTransaction } from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccessDomain } from '@/lib/permission-core';
import { collection, doc, query, where, getDocs } from 'firebase/firestore';
import { addDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
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
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';

export default function StoreItemsPage() {
  type ItemKind = 'ppe' | 'tool' | 'general';
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const canAccess = canAccessDomain(currentUser, 'store');

  const itemsQuery = useMemoFirebase(() => {
    if (!firestore || userLoading || isUserLoading || !firebaseUser || !canAccess) return null;
    return collection(firestore, 'store_items');
  }, [firestore, userLoading, isUserLoading, firebaseUser, canAccess]);
  const { data: items, isLoading } = useCollection<StoreItem>(itemsQuery as any);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [newItemKind, setNewItemKind] = useState<ItemKind>('ppe');
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

  const resolveItemFlags = (kind: ItemKind) => ({
    isPPE: kind === 'ppe',
    isTool: kind === 'tool',
  });

  const resolveItemKind = (item: Partial<StoreItem>): ItemKind => {
    if (item.isPPE) return 'ppe';
    if (item.isTool) return 'tool';
    return 'general';
  };

  const handleCreate = async () => {
    if (!firestore) return;
    const colRef = collection(firestore, 'store_items');
    
    try {
      await addDocumentNonBlocking(colRef, {
        ...newItem,
        ...resolveItemFlags(newItemKind),
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      setIsCreateOpen(false);
      setNewItem({
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
      setNewItemKind('ppe');
      toast({ title: "เพิ่มอุปกรณ์สำเร็จ" });
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถบันทึกข้อมูลได้" });
    }
  };

  const handleUpdate = async () => {
    if (!firestore || !editingItemId) return;
    try {
      updateDocumentNonBlocking(doc(firestore, 'store_items', editingItemId), {
        ...newItem,
        ...resolveItemFlags(newItemKind),
        updatedAt: Date.now()
      });
      setIsEditOpen(false);
      setEditingItemId(null);
      toast({ title: 'แก้ไขอุปกรณ์สำเร็จ' });
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถแก้ไขข้อมูลได้" });
    }
  };

  const openCreateDialog = () => {
    setNewItem({
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
    setNewItemKind('ppe');
    setIsCreateOpen(true);
  };

  const openEditDialog = (item: StoreItem) => {
    setEditingItemId(item.id);
    setNewItem({
      itemCode: item.itemCode,
      itemName: item.itemName,
      category: item.category,
      unit: item.unit,
      minimumStock: item.minimumStock,
      currentStock: item.currentStock,
      isPPE: item.isPPE,
      isTool: item.isTool,
      active: item.active,
    });
    setNewItemKind(resolveItemKind(item));
    setIsEditOpen(true);
  };

  const handleDelete = async (item: StoreItem) => {
    if (!firestore) return;
    if (!confirm('ยืนยันการลบรายการอุปกรณ์?')) return;

    if (item.isTool) {
      try {
        const snap = await getDocs(
          query(collection(firestore, 'store_transactions'), where('itemId', '==', item.id))
        );
        let netOut = 0;
        snap.forEach((d) => {
          const tx = d.data() as StoreTransaction;
          if (tx.transactionType === 'ISSUE') netOut += tx.quantity;
          else if (tx.transactionType === 'RETURN') netOut -= tx.quantity;
        });
        if (netOut > 0) {
          toast({
            variant: 'destructive',
            title: 'ลบไม่ได้: ยังมีเครื่องมือเบิกออกไปคืนไม่ครบ',
            description: `คงเหลือนอกคลังประมาณ ${netOut} ${item.unit} กรุณาติดตามรับคืนให้ครบก่อนลบรายการ`,
          });
          return;
        }
      } catch (e) {
        console.error(e);
        toast({
          variant: 'destructive',
          title: 'ตรวจสอบไม่สำเร็จ',
          description: 'ไม่สามารถตรวจสอบประวัติการเบิกคืนได้',
        });
        return;
      }
    }

    deleteDocumentNonBlocking(doc(firestore, 'store_items', item.id));
    toast({ title: 'ลบรายการอุปกรณ์แล้ว' });
  };

  if (userLoading || isUserLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground text-sm">
        กำลังตรวจสอบสิทธิ์…
      </div>
    );
  }
  if (!currentUser || !canAccess) return null;

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
              <Button className="gap-2 h-11 px-6 bg-primary shadow-md font-bold" onClick={openCreateDialog}>
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
                <div className="grid gap-2 col-span-2">
                  <Label>ประเภทอุปกรณ์ (Type)</Label>
                  <Select value={newItemKind} onValueChange={(v) => setNewItemKind(v as ItemKind)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ppe">อุปกรณ์ PPE</SelectItem>
                      <SelectItem value="tool">เครื่องมือ (Tool)</SelectItem>
                      <SelectItem value="general">ทั่วไป (General)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>ยกเลิก</Button>
                <Button onClick={handleCreate} className="bg-primary font-bold">บันทึกข้อมูล (Save Item)</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>แก้ไขอุปกรณ์</DialogTitle>
                <DialogDescription>ปรับข้อมูลทะเบียนอุปกรณ์ในระบบ</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4 py-4">
                <div className="grid gap-2">
                  <Label>รหัสอุปกรณ์ (Item Code)</Label>
                  <Input value={newItem.itemCode || ''} onChange={e => setNewItem({...newItem, itemCode: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label>ชื่ออุปกรณ์ (Item Name)</Label>
                  <Input value={newItem.itemName || ''} onChange={e => setNewItem({...newItem, itemName: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label>หมวดหมู่ (Category)</Label>
                  <Select onValueChange={v => setNewItem({...newItem, category: v})} value={newItem.category || ''}>
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
                  <Input value={newItem.unit || ''} onChange={e => setNewItem({...newItem, unit: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label>สต็อกขั้นต่ำ (Alert Level)</Label>
                  <Input type="number" value={newItem.minimumStock || 0} onChange={e => setNewItem({...newItem, minimumStock: parseInt(e.target.value) || 0})} />
                </div>
                <div className="grid gap-2">
                  <Label>สต็อกปัจจุบัน</Label>
                  <Input type="number" value={newItem.currentStock || 0} onChange={e => setNewItem({...newItem, currentStock: parseInt(e.target.value) || 0})} />
                </div>
                <div className="grid gap-2 col-span-2">
                  <Label>ประเภทอุปกรณ์ (Type)</Label>
                  <Select value={newItemKind} onValueChange={(v) => setNewItemKind(v as ItemKind)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ppe">อุปกรณ์ PPE</SelectItem>
                      <SelectItem value="tool">เครื่องมือ (Tool)</SelectItem>
                      <SelectItem value="general">ทั่วไป (General)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsEditOpen(false)}>ยกเลิก</Button>
                <Button onClick={handleUpdate} className="bg-primary font-bold">บันทึกการแก้ไข</Button>
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
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => openEditDialog(item)}><Edit2 className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(item)}><Trash2 className="h-4 w-4" /></Button>
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
