'use client';

import { useState, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Plus, Search, Filter, ArrowLeft, HardHat, Trash2, Edit2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { StoreItem, StoreTransaction, storeItemIsPpeCatalog } from '@/lib/types';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';

export default function StorePpeCatalogPage() {
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

  const ppeItems = useMemo(() => (items || []).filter((i) => storeItemIsPpeCatalog(i)), [items]);

  const categoryOptions = useMemo(() => {
    const s = new Set<string>();
    ppeItems.forEach((i) => {
      if ((i.category || '').trim()) s.add(i.category);
    });
    return Array.from(s).sort();
  }, [ppeItems]);

  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const filteredPpe = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return ppeItems.filter((i) => {
      if (categoryFilter !== 'all' && (i.category || '') !== categoryFilter) return false;
      if (!q) return true;
      return (
        (i.itemName || '').toLowerCase().includes(q) ||
        (i.itemCode || '').toLowerCase().includes(q) ||
        (i.variantSpecification || '').toLowerCase().includes(q) ||
        (i.variantGroupKey || '').toLowerCase().includes(q)
      );
    });
  }, [ppeItems, searchQuery, categoryFilter]);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [newItem, setNewItem] = useState<Partial<StoreItem>>({
    itemCode: '',
    itemName: '',
    variantSpecification: '',
    variantGroupKey: '',
    category: 'PPE',
    unit: 'Unit',
    minimumStock: 5,
    currentStock: 0,
    isPPE: true,
    isTool: false,
    active: true,
  });

  const handleCreate = async () => {
    if (!firestore) return;
    try {
      await addDocumentNonBlocking(collection(firestore, 'store_items'), {
        ...newItem,
        isPPE: true,
        isTool: false,
        category: newItem.category || 'PPE',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      setIsCreateOpen(false);
      setNewItem({
        itemCode: '',
        itemName: '',
        variantSpecification: '',
        variantGroupKey: '',
        category: 'PPE',
        unit: 'Unit',
        minimumStock: 5,
        currentStock: 0,
        isPPE: true,
        isTool: false,
        active: true,
      });
      toast({ title: 'เพิ่ม PPE สำเร็จ' });
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'ไม่สามารถบันทึกข้อมูลได้' });
    }
  };

  const handleUpdate = async () => {
    if (!firestore || !editingItemId) return;
    try {
      updateDocumentNonBlocking(doc(firestore, 'store_items', editingItemId), {
        ...newItem,
        isPPE: true,
        isTool: false,
        category: newItem.category || 'PPE',
        updatedAt: Date.now(),
      });
      setIsEditOpen(false);
      setEditingItemId(null);
      toast({ title: 'แก้ไข PPE สำเร็จ' });
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'ไม่สามารถแก้ไขข้อมูลได้' });
    }
  };

  const openCreateDialog = () => {
    setNewItem({
      itemCode: '',
      itemName: '',
      variantSpecification: '',
      variantGroupKey: '',
      category: 'PPE',
      unit: 'Unit',
      minimumStock: 5,
      currentStock: 0,
      isPPE: true,
      isTool: false,
      active: true,
    });
    setIsCreateOpen(true);
  };

  const openEditDialog = (item: StoreItem) => {
    setEditingItemId(item.id);
    setNewItem({
      itemCode: item.itemCode,
      itemName: item.itemName,
      variantSpecification: item.variantSpecification ?? '',
      variantGroupKey: item.variantGroupKey ?? '',
      category: item.category || 'PPE',
      unit: item.unit,
      minimumStock: item.minimumStock,
      currentStock: item.currentStock,
      isPPE: true,
      isTool: false,
      active: item.active,
    });
    setIsEditOpen(true);
  };

  const handleDelete = async (item: StoreItem) => {
    if (!firestore) return;
    if (!confirm('ยืนยันการลบรายการ PPE?')) return;
    if (item.isTool) {
      try {
        const snap = await getDocs(
          query(collection(firestore, 'store_transactions'), where('itemId', '==', item.id)),
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
            title: 'ลบไม่ได้: ยังมียอดเบิกค้าง',
            description: `คงเหลือนอกคลังประมาณ ${netOut} ${item.unit}`,
          });
          return;
        }
      } catch (e) {
        console.error(e);
        toast({ variant: 'destructive', title: 'ตรวจสอบไม่สำเร็จ' });
        return;
      }
    }
    deleteDocumentNonBlocking(doc(firestore, 'store_items', item.id));
    toast({ title: 'ลบรายการแล้ว' });
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
            <Link href="/store">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex-1">
            <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
              <HardHat className="h-8 w-8 text-orange-500" /> ทะเบียน PPE (จากคลัง Store)
            </h1>
            <p className="text-muted-foreground text-sm">
              อุปกรณ์ป้องกันส่วนบุคคล — แยกชื่อกับขนาด/รุ่น; เครื่องมือทั่วไปที่{' '}
              <Link href="/store/items" className="text-primary underline font-medium">
                ทะเบียนอุปกรณ์
              </Link>
            </p>
          </div>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 h-11 px-6 bg-orange-600 hover:bg-orange-700 shadow-md font-bold" onClick={openCreateDialog}>
                <Plus className="h-5 w-5" /> เพิ่ม PPE
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>ลงทะเบียน PPE ใหม่</DialogTitle>
                <DialogDescription>ข้อมูลเดียวกับคอลเลกชัน store_items — ใช้ผูกตำแหน่งงานและการเบิก</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4 py-4">
                <div className="grid gap-2">
                  <Label>รหัส (Item Code)</Label>
                  <Input
                    placeholder="PPE-001-M"
                    value={newItem.itemCode}
                    onChange={(e) => setNewItem({ ...newItem, itemCode: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>ชื่อหลัก (ไม่รวมไซส์)</Label>
                  <Input
                    placeholder="เช่น ชุดหมี, รองเท้าเซฟตี้"
                    value={newItem.itemName}
                    onChange={(e) => setNewItem({ ...newItem, itemName: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>ขนาด / รุ่น</Label>
                  <Input
                    placeholder='เช่น Size M, เบอร์ 8'
                    value={newItem.variantSpecification || ''}
                    onChange={(e) => setNewItem({ ...newItem, variantSpecification: e.target.value })}
                  />
                </div>
                <div className="grid gap-2 col-span-2">
                  <Label>รหัสกลุ่มโควต้า (ไม่บังคับ)</Label>
                  <Input
                    placeholder="เช่น JUMPSUIT — หลายไซส์ใช้รหัสเดียวกันเพื่อนับโควต้ารวม"
                    value={newItem.variantGroupKey || ''}
                    onChange={(e) => setNewItem({ ...newItem, variantGroupKey: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>หมวดหมู่</Label>
                  <Input
                    value={newItem.category || 'PPE'}
                    onChange={(e) => setNewItem({ ...newItem, category: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>หน่วยนับ</Label>
                  <Input value={newItem.unit} onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>สต็อกขั้นต่ำ</Label>
                  <Input
                    type="number"
                    value={newItem.minimumStock}
                    onChange={(e) => setNewItem({ ...newItem, minimumStock: parseInt(e.target.value, 10) || 0 })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>สต็อกเริ่มต้น</Label>
                  <Input
                    type="number"
                    value={newItem.currentStock}
                    onChange={(e) => setNewItem({ ...newItem, currentStock: parseInt(e.target.value, 10) || 0 })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                  ยกเลิก
                </Button>
                <Button onClick={handleCreate} className="bg-orange-600 hover:bg-orange-700 font-bold">
                  บันทึก
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>แก้ไข PPE</DialogTitle>
                <DialogDescription>ปรับชื่อ ขนาด/รุ่น หรือรหัสกลุ่มโควต้า</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4 py-4">
                <div className="grid gap-2">
                  <Label>รหัส</Label>
                  <Input value={newItem.itemCode || ''} onChange={(e) => setNewItem({ ...newItem, itemCode: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>ชื่อหลัก</Label>
                  <Input value={newItem.itemName || ''} onChange={(e) => setNewItem({ ...newItem, itemName: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>ขนาด / รุ่น</Label>
                  <Input
                    value={newItem.variantSpecification || ''}
                    onChange={(e) => setNewItem({ ...newItem, variantSpecification: e.target.value })}
                  />
                </div>
                <div className="grid gap-2 col-span-2">
                  <Label>รหัสกลุ่มโควต้า</Label>
                  <Input
                    value={newItem.variantGroupKey || ''}
                    onChange={(e) => setNewItem({ ...newItem, variantGroupKey: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>หมวดหมู่</Label>
                  <Input value={newItem.category || ''} onChange={(e) => setNewItem({ ...newItem, category: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>หน่วยนับ</Label>
                  <Input value={newItem.unit || ''} onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>สต็อกขั้นต่ำ</Label>
                  <Input
                    type="number"
                    value={newItem.minimumStock || 0}
                    onChange={(e) => setNewItem({ ...newItem, minimumStock: parseInt(e.target.value, 10) || 0 })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>สต็อกปัจจุบัน</Label>
                  <Input
                    type="number"
                    value={newItem.currentStock || 0}
                    onChange={(e) => setNewItem({ ...newItem, currentStock: parseInt(e.target.value, 10) || 0 })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsEditOpen(false)}>
                  ยกเลิก
                </Button>
                <Button onClick={handleUpdate} className="bg-orange-600 hover:bg-orange-700 font-bold">
                  บันทึกการแก้ไข
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardHeader className="bg-muted/30">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="relative w-full max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="ค้นหาชื่อ, รหัส, ขนาด/รุ่น, รหัสกลุ่ม…"
                  className="pl-9 h-10"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="h-10 w-[200px]">
                    <SelectValue placeholder="หมวดหมู่" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">ทุกหมวดในรายการ PPE</SelectItem>
                    {categoryOptions.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                    <TableHead className="font-bold py-4 pl-6">รหัส</TableHead>
                    <TableHead className="font-bold">ชื่อหลัก</TableHead>
                    <TableHead className="font-bold">ขนาด/รุ่น</TableHead>
                    <TableHead className="font-bold">หมวดหมู่</TableHead>
                    <TableHead className="font-bold text-center">คงเหลือ</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPpe.map((item) => (
                    <TableRow key={item.id} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="pl-6 font-mono text-xs font-bold text-primary">{item.itemCode}</TableCell>
                      <TableCell className="font-bold text-primary">{item.itemName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {(item.variantSpecification || '').trim() || '—'}
                        {(item.variantGroupKey || '').trim() ? (
                          <span className="block text-[10px] font-mono text-orange-700 mt-0.5">กลุ่ม: {item.variantGroupKey}</span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{item.category}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <span
                          className={`font-black text-lg ${item.currentStock <= item.minimumStock ? 'text-red-600' : 'text-primary'}`}
                        >
                          {item.currentStock}
                        </span>
                        <span className="text-[10px] text-muted-foreground ml-1">{item.unit}</span>
                      </TableCell>
                      <TableCell>
                        <Badge className={item.active ? 'bg-green-600' : 'bg-slate-200'}>
                          {item.active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right pr-6 space-x-2">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => openEditDialog(item)}>
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(item)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredPpe.length === 0 && !isLoading && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-20 text-muted-foreground italic">
                        {ppeItems.length === 0
                          ? 'ยังไม่มีรายการ PPE — เพิ่มจากปุ่มด้านบน หรือย้ายรายการจากทะเบียนเดิมมาที่หมวด PPE'
                          : 'ไม่พบรายการตามตัวกรอง'}
                      </TableCell>
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
