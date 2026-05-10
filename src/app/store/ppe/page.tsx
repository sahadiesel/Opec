'use client';

import { Fragment, useMemo, useState } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Plus, Search, Filter, ArrowLeft, HardHat, Trash2, Edit2, Layers } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { StoreItem, StoreTransaction, storeItemIsPpeCatalog } from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccessDomain } from '@/lib/permission-core';
import { collection, doc, query, where, getDocs, writeBatch } from 'firebase/firestore';
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
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import { generateNextDocumentCode } from '@/lib/services/numbering-service';
import { sanitizeFirestorePayload } from '@/lib/utils';

type PpeCreateMode = 'main' | 'variant' | 'standalone';

type PpeDisplayRow =
  | { kind: 'group'; header: StoreItem; children: StoreItem[] }
  | { kind: 'standalone'; item: StoreItem };

function matchesPpeSearch(item: StoreItem, qRaw: string): boolean {
  const q = qRaw.trim().toLowerCase();
  if (!q) return true;
  return (
    (item.itemName || '').toLowerCase().includes(q) ||
    (item.itemCode || '').toLowerCase().includes(q) ||
    (item.variantSpecification || '').toLowerCase().includes(q) ||
    (item.variantGroupKey || '').toLowerCase().includes(q)
  );
}

function matchesPpeCategory(item: StoreItem, categoryFilter: string): boolean {
  if (categoryFilter === 'all') return true;
  return (item.category || '') === categoryFilter;
}

function buildPpeDisplayRows(items: StoreItem[]): PpeDisplayRow[] {
  const headers = items.filter((i) => i.catalogGroupRole === 'header');
  const lines = items.filter((i) => i.catalogGroupRole === 'line');
  const standalones = items.filter(
    (i) => i.catalogGroupRole !== 'header' && i.catalogGroupRole !== 'line',
  );
  const byParent = new Map<string, StoreItem[]>();
  for (const line of lines) {
    const pid = line.parentStoreItemId || '';
    if (!pid) continue;
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid)!.push(line);
  }
  for (const [, arr] of byParent) {
    arr.sort((a, b) =>
      (a.variantSpecification || '').localeCompare(b.variantSpecification || '', 'th'),
    );
  }
  headers.sort((a, b) => (a.itemName || '').localeCompare(b.itemName || '', 'th'));
  standalones.sort((a, b) => (a.itemName || '').localeCompare(b.itemName || '', 'th'));

  const rows: PpeDisplayRow[] = [];
  for (const h of headers) {
    rows.push({ kind: 'group', header: h, children: byParent.get(h.id) || [] });
  }
  for (const it of standalones) {
    rows.push({ kind: 'standalone', item: it });
  }
  return rows;
}

function filterPpeDisplayRows(
  rows: PpeDisplayRow[],
  searchQuery: string,
  categoryFilter: string,
): PpeDisplayRow[] {
  const out: PpeDisplayRow[] = [];
  for (const row of rows) {
    if (row.kind === 'standalone') {
      const it = row.item;
      if (!matchesPpeCategory(it, categoryFilter)) continue;
      if (!matchesPpeSearch(it, searchQuery)) continue;
      out.push(row);
      continue;
    }
    const { header, children } = row;
    const catOk =
      categoryFilter === 'all' ||
      matchesPpeCategory(header, categoryFilter) ||
      children.some((c) => matchesPpeCategory(c, categoryFilter));
    if (!catOk) continue;

    if (!searchQuery.trim()) {
      out.push(row);
      continue;
    }

    const headMatch = matchesPpeSearch(header, searchQuery);
    const matchingChildren = children.filter((c) => matchesPpeSearch(c, searchQuery));
    if (headMatch) out.push(row);
    else if (matchingChildren.length) out.push({ kind: 'group', header, children: matchingChildren });
  }
  return out;
}

function sumChildStock(children: StoreItem[]): number {
  return children.reduce((s, c) => s + (Number(c.currentStock) || 0), 0);
}

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

  const catalogHeaders = useMemo(
    () => ppeItems.filter((i) => i.catalogGroupRole === 'header'),
    [ppeItems],
  );

  const displayRows = useMemo(() => buildPpeDisplayRows(ppeItems), [ppeItems]);

  const categoryOptions = useMemo(() => {
    const s = new Set<string>();
    ppeItems.forEach((i) => {
      if ((i.category || '').trim()) s.add(i.category);
    });
    return Array.from(s).sort();
  }, [ppeItems]);

  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const filteredDisplayRows = useMemo(
    () => filterPpeDisplayRows(displayRows, searchQuery, categoryFilter),
    [displayRows, searchQuery, categoryFilter],
  );

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState<PpeCreateMode>('main');
  const [variantParentId, setVariantParentId] = useState('');

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingCatalogRole, setEditingCatalogRole] = useState<'header' | 'line' | 'standalone' | null>(
    null,
  );
  const [editingParentId, setEditingParentId] = useState<string | undefined>(undefined);

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

  const editingParent = useMemo(
    () => (editingParentId ? ppeItems.find((x) => x.id === editingParentId) : undefined),
    [ppeItems, editingParentId],
  );

  const resetNewItemForm = () => {
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
    setVariantParentId('');
  };

  const openCreate = (mode: PpeCreateMode) => {
    setCreateMode(mode);
    resetNewItemForm();
    setIsCreateOpen(true);
  };

  const handleCreate = async () => {
    if (!firestore || !currentUser) return;
    const colRef = collection(firestore, 'store_items');
    const actorName = currentUser.displayName?.trim() || currentUser.email || currentUser.id;

    try {
      if (createMode === 'variant') {
        if (!variantParentId) {
          toast({ variant: 'destructive', title: 'เลือกรายการหลัก', description: 'ระบุเมน PPE ที่จะเพิ่มรุ่นย่อย' });
          return;
        }
        const parent = ppeItems.find((i) => i.id === variantParentId);
        if (!parent || parent.catalogGroupRole !== 'header' || !storeItemIsPpeCatalog(parent)) {
          toast({ variant: 'destructive', title: 'ข้อมูลไม่ถูกต้อง', description: 'ไม่พบรายการหลัก PPE' });
          return;
        }
        const spec = (newItem.variantSpecification || '').trim();
        if (!spec) {
          toast({ variant: 'destructive', title: 'ระบุขนาด/รุ่น', description: 'รุ่นย่อยต้องมีขนาดหรือรุ่น' });
          return;
        }
        const { code: itemCode } = await generateNextDocumentCode(firestore, 'store_item_ppe', {
          actor: actorName,
          userId: currentUser.id,
        });
        const gk = ((parent.variantGroupKey || parent.itemCode || '') as string).trim();
        await addDocumentNonBlocking(
          colRef,
          sanitizeFirestorePayload({
            itemCode,
            itemName: parent.itemName,
            variantSpecification: spec,
            variantGroupKey: gk || itemCode,
            catalogGroupRole: 'line',
            parentStoreItemId: parent.id,
            category: parent.category || 'PPE',
            unit: parent.unit,
            minimumStock: Number(newItem.minimumStock) || 0,
            currentStock: Number(newItem.currentStock) || 0,
            isPPE: true,
            isTool: false,
            active: newItem.active !== false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }),
        );
        toast({ title: 'เพิ่มรุ่นย่อยแล้ว', description: itemCode });
      } else if (createMode === 'main') {
        if (!(newItem.itemName || '').trim()) {
          toast({
            variant: 'destructive',
            title: 'กรอกชื่อหลัก',
            description: 'ชื่อเมน PPE จำเป็นต้องมี',
          });
          return;
        }
        const { code: itemCode } = await generateNextDocumentCode(firestore, 'store_item_ppe', {
          actor: actorName,
          userId: currentUser.id,
        });
        const gk = ((newItem.variantGroupKey || '').trim() || itemCode) as string;
        await addDocumentNonBlocking(
          colRef,
          sanitizeFirestorePayload({
            itemCode,
            itemName: (newItem.itemName ?? '').trim(),
            variantSpecification: '',
            variantGroupKey: gk,
            catalogGroupRole: 'header',
            category: newItem.category || 'PPE',
            unit: newItem.unit || 'Unit',
            minimumStock: 0,
            currentStock: 0,
            isPPE: true,
            isTool: false,
            active: newItem.active !== false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }),
        );
        toast({ title: 'เพิ่มรายการหลักแล้ว', description: 'ใช้ «เพิ่มรุ่นย่อย» เพื่อลงไซส์และสต็อก' });
      } else {
        if (!(newItem.itemName || '').trim()) {
          toast({
            variant: 'destructive',
            title: 'กรอกชื่อหลัก',
            description: 'ชื่อหลัก (ไม่รวมไซส์) จำเป็นต้องมี',
          });
          return;
        }
        const { code: itemCode } = await generateNextDocumentCode(firestore, 'store_item_ppe', {
          actor: actorName,
          userId: currentUser.id,
        });
        await addDocumentNonBlocking(
          colRef,
          sanitizeFirestorePayload({
            ...newItem,
            itemCode,
            isPPE: true,
            isTool: false,
            category: newItem.category || 'PPE',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }),
        );
        toast({ title: 'เพิ่มรายการเดี่ยวสำเร็จ' });
      }

      setIsCreateOpen(false);
      resetNewItemForm();
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'Error', description: 'ไม่สามารถบันทึกข้อมูลได้' });
    }
  };

  const handleUpdate = async () => {
    if (!firestore || !editingItemId || !editingCatalogRole) return;
    let syncChildrenCount = 0;
    try {
      if (editingCatalogRole === 'header') {
        const headerRef = doc(firestore, 'store_items', editingItemId);
        const categoryNext = newItem.category || 'PPE';
        const headerPatch = sanitizeFirestorePayload({
          itemName: (newItem.itemName || '').trim(),
          variantGroupKey: ((newItem.variantGroupKey || '').trim() || newItem.itemCode || '').trim(),
          category: categoryNext,
          unit: newItem.unit,
          active: newItem.active !== false,
          isPPE: true,
          isTool: false,
          updatedAt: Date.now(),
        });
        const childrenSnap = await getDocs(
          query(collection(firestore, 'store_items'), where('parentStoreItemId', '==', editingItemId)),
        );
        syncChildrenCount = childrenSnap.size;
        const batch = writeBatch(firestore);
        batch.update(headerRef, headerPatch);
        const childSyncPatch = sanitizeFirestorePayload({
          category: categoryNext,
          unit: newItem.unit,
          isPPE: true,
          isTool: false,
          updatedAt: Date.now(),
        });
        childrenSnap.forEach((d) => {
          batch.update(d.ref, childSyncPatch);
        });
        await batch.commit();
      } else if (editingCatalogRole === 'line') {
        updateDocumentNonBlocking(
          doc(firestore, 'store_items', editingItemId),
          sanitizeFirestorePayload({
            variantSpecification: (newItem.variantSpecification || '').trim(),
            minimumStock: Number(newItem.minimumStock) || 0,
            currentStock: Number(newItem.currentStock) || 0,
            active: newItem.active !== false,
            updatedAt: Date.now(),
          }),
        );
      } else {
        updateDocumentNonBlocking(
          doc(firestore, 'store_items', editingItemId),
          sanitizeFirestorePayload({
            ...newItem,
            isPPE: true,
            isTool: false,
            category: newItem.category || 'PPE',
            updatedAt: Date.now(),
          }),
        );
      }
      setIsEditOpen(false);
      setEditingItemId(null);
      setEditingCatalogRole(null);
      setEditingParentId(undefined);
      toast({
        title: 'แก้ไข PPE สำเร็จ',
        ...(syncChildrenCount > 0
          ? {
              description: `ปรับหมวดหมู่และหน่วยของรุ่นย่อย ${syncChildrenCount} แถวให้ตรงเมน`,
            }
          : {}),
      });
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'Error', description: 'ไม่สามารถแก้ไขข้อมูลได้' });
    }
  };

  const openEditDialog = (item: StoreItem) => {
    setEditingItemId(item.id);
    if (item.catalogGroupRole === 'header') {
      setEditingCatalogRole('header');
      setEditingParentId(undefined);
    } else if (item.catalogGroupRole === 'line') {
      setEditingCatalogRole('line');
      setEditingParentId(item.parentStoreItemId);
    } else {
      setEditingCatalogRole('standalone');
      setEditingParentId(undefined);
    }
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

    if (item.catalogGroupRole === 'header') {
      const childrenSnap = await getDocs(
        query(collection(firestore, 'store_items'), where('parentStoreItemId', '==', item.id)),
      );
      if (!childrenSnap.empty) {
        toast({
          variant: 'destructive',
          title: 'ลบไม่ได้',
          description: 'มีรุ่นย่อยอยู่ภายใต้เมนนี้ — ลบรุ่นย่อยก่อน',
        });
        return;
      }
    }

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

  const stockTone = (stock: number, min: number) =>
    stock <= min ? 'text-red-600' : 'text-orange-700';

  if (userLoading || isUserLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground text-sm">
        กำลังตรวจสอบสิทธิ์…
      </div>
    );
  }
  if (!currentUser || !canAccess) return null;

  const createTitles: Record<PpeCreateMode, string> = {
    main: 'ลงทะเบียน — รายการหลัก PPE (เมน)',
    variant: 'ลงทะเบียน — รุ่นย่อย / ไซส์',
    standalone: 'ลงทะเบียน — รายการเดี่ยว',
  };

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/store">
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
                <HardHat className="h-8 w-8 text-orange-500" /> ทะเบียน PPE (จากคลัง Store)
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                สร้าง<strong>รายการหลัก</strong>ก่อน แล้วใช้<strong>รุ่นย่อย</strong>แยกไซส์และสต็อก — แสดงเป็นหัวข้อเดียวในรายการ · รายการเดี่ยวใช้เมื่อไม่ต้องแยกเมน ·{' '}
                <Link href="/store/items" className="text-primary underline font-medium">
                  ทะเบียนอุปกรณ์
                </Link>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            <Button
              className="gap-2 h-11 px-4 bg-orange-600 hover:bg-orange-700 shadow-md font-bold"
              onClick={() => openCreate('main')}
            >
              <Layers className="h-4 w-4" /> เพิ่มรายการหลัก
            </Button>
            <Button variant="secondary" className="gap-2 h-11 px-4 font-bold" onClick={() => openCreate('variant')}>
              <Plus className="h-4 w-4" /> เพิ่มรุ่นย่อย
            </Button>
            <Button variant="outline" className="gap-2 h-11 px-4" onClick={() => openCreate('standalone')}>
              <Plus className="h-4 w-4" /> รายการเดี่ยว
            </Button>
          </div>
        </div>

        <Dialog
          open={isCreateOpen}
          onOpenChange={(o) => {
            setIsCreateOpen(o);
            if (!o) resetNewItemForm();
          }}
        >
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>{createTitles[createMode]}</DialogTitle>
              <DialogDescription>
                {createMode === 'main' &&
                  'เมนไม่ถือสต็อก — ใช้เพื่อชื่อหลักและรหัสกลุ่มโควต้า · จากนั้นเพิ่มรุ่นย่อยแต่ละไซส์ (รหัส PPE-####)'}
                {createMode === 'variant' && 'เลือกเมน PPE ที่มีอยู่แล้ว แล้วระบุขนาด/รุ่นและสต็อก'}
                {createMode === 'standalone' &&
                  'หนึ่งแถวครบทุกฟิลด์ (ข้อมูลเก่าในระบบ) — ไม่ผูกเมนหลัก'}
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4 py-4">
              <div className="grid gap-2 col-span-2">
                <Label>รหัส (Item Code)</Label>
                <Input
                  readOnly
                  className="bg-muted/60 font-mono text-sm"
                  placeholder="ออกอัตโนมัติเมื่อบันทึก เช่น PPE-0001"
                  value=""
                />
                <p className="text-[11px] text-muted-foreground">
                  ระบบออกรหัสลำดับอัตโนมัติ prefix PPE- (แยกจากอุปกรณ์ทั่วไป EQM-)
                </p>
              </div>

              {createMode === 'variant' && (
                <div className="grid gap-2 col-span-2">
                  <Label>รายการหลัก (เมน) *</Label>
                  <Select value={variantParentId || undefined} onValueChange={setVariantParentId}>
                    <SelectTrigger>
                      <SelectValue placeholder={catalogHeaders.length ? 'เลือกเมน…' : 'ยังไม่มีเมน — สร้างรายการหลักก่อน'} />
                    </SelectTrigger>
                    <SelectContent>
                      {catalogHeaders.map((h) => (
                        <SelectItem key={h.id} value={h.id}>
                          {h.itemCode} · {h.itemName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {(createMode === 'main' || createMode === 'standalone') && (
                <div className="grid gap-2 col-span-2">
                  <Label>ชื่อหลัก (ไม่รวมไซส์) *</Label>
                  <Input
                    placeholder="เช่น ชุดหมี, รองเท้าเซฟตี้"
                    value={newItem.itemName}
                    onChange={(e) => setNewItem({ ...newItem, itemName: e.target.value })}
                  />
                </div>
              )}

              {createMode === 'variant' && (
                <div className="grid gap-2 col-span-2">
                  <Label>ขนาด / รุ่น *</Label>
                  <Input
                    placeholder="เช่น Size M, เบอร์ 8"
                    value={newItem.variantSpecification || ''}
                    onChange={(e) => setNewItem({ ...newItem, variantSpecification: e.target.value })}
                  />
                </div>
              )}

              {createMode === 'standalone' && (
                <>
                  <div className="grid gap-2 col-span-2">
                    <Label>ขนาด / รุ่น (ถ้ามี)</Label>
                    <Input
                      placeholder="เช่น Size M"
                      value={newItem.variantSpecification || ''}
                      onChange={(e) => setNewItem({ ...newItem, variantSpecification: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-2 col-span-2">
                    <Label>รหัสกลุ่มโควต้า (ไม่บังคับ)</Label>
                    <Input
                      placeholder="เช่น SHIRT-SHOP — หลายไซส์ใช้รหัสเดียวกันเพื่อนับโควต้ารวม"
                      value={newItem.variantGroupKey || ''}
                      onChange={(e) => setNewItem({ ...newItem, variantGroupKey: e.target.value })}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      ชื่อหลักเหมือนกัน + รหัสกลุ่มเดียวกันทุกไซส์ — สต็อกแยกตามแถว SKU · ตำแหน่งงานกำหนดจำนวนรวม · หน้าเบิกเลือกตัดจากไซส์ไหนก็ได้ให้ครบยอด
                    </p>
                  </div>
                </>
              )}

              {createMode === 'main' && (
                <div className="grid gap-2 col-span-2">
                  <Label>รหัสกลุ่มโควต้า (ไม่บังคับ)</Label>
                  <Input
                    placeholder="ว่าง = ใช้รหัส PPE ของเมนเป็นกลุ่มโควต้า"
                    value={newItem.variantGroupKey || ''}
                    onChange={(e) => setNewItem({ ...newItem, variantGroupKey: e.target.value })}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    รุ่นย่อยใต้เมนนี้จะใช้รหัสกลุ่มเดียวกันอัตโนมัติ — ใช้ผูกโควต้าตำแหน่งงาน / เบิกรวมหลายไซส์
                  </p>
                </div>
              )}

              {(createMode === 'main' || createMode === 'standalone') && (
                <>
                  <div className="grid gap-2">
                    <Label>หมวดหมู่</Label>
                    <Input
                      value={newItem.category || 'PPE'}
                      onChange={(e) => setNewItem({ ...newItem, category: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>หน่วยนับ</Label>
                    <Input
                      placeholder="ตัว, ชุด, คู่"
                      value={newItem.unit}
                      onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })}
                    />
                  </div>
                </>
              )}

              {(createMode === 'variant' || createMode === 'standalone') && (
                <>
                  <div className="grid gap-2">
                    <Label>สต็อกขั้นต่ำ</Label>
                    <Input
                      type="number"
                      value={newItem.minimumStock ?? 0}
                      onChange={(e) =>
                        setNewItem({ ...newItem, minimumStock: parseInt(e.target.value, 10) || 0 })
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>สต็อกเริ่มต้น</Label>
                    <Input
                      type="number"
                      value={newItem.currentStock ?? 0}
                      onChange={(e) =>
                        setNewItem({ ...newItem, currentStock: parseInt(e.target.value, 10) || 0 })
                      }
                    />
                  </div>
                </>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                ยกเลิก
              </Button>
              <Button onClick={() => void handleCreate()} className="bg-orange-600 hover:bg-orange-700 font-bold">
                บันทึก
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={isEditOpen}
          onOpenChange={(o) => {
            setIsEditOpen(o);
            if (!o) {
              setEditingCatalogRole(null);
              setEditingParentId(undefined);
              setEditingItemId(null);
            }
          }}
        >
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>
                {editingCatalogRole === 'header' && 'แก้ไข — รายการหลัก PPE'}
                {editingCatalogRole === 'line' && 'แก้ไข — รุ่นย่อย'}
                {editingCatalogRole === 'standalone' && 'แก้ไข PPE'}
              </DialogTitle>
              <DialogDescription>
                {editingCatalogRole === 'line' && editingParent && (
                  <span>
                    ภายใต้เมน: <strong>{editingParent.itemName}</strong> ({editingParent.itemCode})
                  </span>
                )}
                {editingCatalogRole === 'header' && 'ไม่แก้สต็อกที่เมน — สต็อกอยู่ที่แต่ละรุ่นย่อย'}
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4 py-4">
              <div className="grid gap-2">
                <Label>รหัส</Label>
                <Input value={newItem.itemCode || ''} disabled className="bg-muted/50 font-mono text-sm" />
              </div>

              {editingCatalogRole !== 'line' && (
                <div className="grid gap-2">
                  <Label>ชื่อหลัก</Label>
                  <Input
                    value={newItem.itemName || ''}
                    onChange={(e) => setNewItem({ ...newItem, itemName: e.target.value })}
                  />
                </div>
              )}

              {editingCatalogRole === 'line' && (
                <div className="grid gap-2">
                  <Label>ชื่อหลัก</Label>
                  <Input value={editingParent?.itemName || newItem.itemName || ''} disabled className="bg-muted/50" />
                </div>
              )}

              {(editingCatalogRole === 'standalone' || editingCatalogRole === 'line') && (
                <div className="grid gap-2 col-span-2">
                  <Label>ขนาด / รุ่น</Label>
                  <Input
                    value={newItem.variantSpecification || ''}
                    onChange={(e) => setNewItem({ ...newItem, variantSpecification: e.target.value })}
                  />
                </div>
              )}

              {editingCatalogRole === 'header' && (
                <div className="grid gap-2 col-span-2">
                  <Label>รหัสกลุ่มโควต้า</Label>
                  <Input
                    value={newItem.variantGroupKey || ''}
                    onChange={(e) => setNewItem({ ...newItem, variantGroupKey: e.target.value })}
                  />
                </div>
              )}

              {editingCatalogRole === 'standalone' && (
                <div className="grid gap-2 col-span-2">
                  <Label>รหัสกลุ่มโควต้า</Label>
                  <Input
                    value={newItem.variantGroupKey || ''}
                    onChange={(e) => setNewItem({ ...newItem, variantGroupKey: e.target.value })}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    หลาย SKU ไซส์ต่างกันใช้รหัสเดียวกัน → เบิกรวมเป็นชื่อหลักได้
                  </p>
                </div>
              )}

              {editingCatalogRole !== 'line' && (
                <>
                  <div className="grid gap-2">
                    <Label>หมวดหมู่</Label>
                    <Input
                      value={newItem.category || ''}
                      onChange={(e) => setNewItem({ ...newItem, category: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>หน่วยนับ</Label>
                    <Input value={newItem.unit || ''} onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })} />
                  </div>
                </>
              )}

              {(editingCatalogRole === 'standalone' || editingCatalogRole === 'line') && (
                <>
                  <div className="grid gap-2">
                    <Label>สต็อกขั้นต่ำ</Label>
                    <Input
                      type="number"
                      value={newItem.minimumStock ?? 0}
                      onChange={(e) =>
                        setNewItem({ ...newItem, minimumStock: parseInt(e.target.value, 10) || 0 })
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>สต็อกปัจจุบัน</Label>
                    <Input
                      type="number"
                      value={newItem.currentStock ?? 0}
                      onChange={(e) =>
                        setNewItem({ ...newItem, currentStock: parseInt(e.target.value, 10) || 0 })
                      }
                    />
                  </div>
                </>
              )}

              {editingCatalogRole === 'header' && (
                <div className="grid gap-2 col-span-2 text-sm text-muted-foreground border rounded-md p-3 bg-muted/30">
                  สต็อกรวมของรุ่นย่อยจะแสดงในตารางที่หัวข้อเมน — แก้จำนวนที่แถวรุ่นย่อยแต่ละแถว
                </div>
              )}

              <div className="flex flex-row items-center gap-2 col-span-2">
                <Checkbox
                  id="active-edit-ppe"
                  checked={newItem.active !== false}
                  onCheckedChange={(v) => setNewItem({ ...newItem, active: !!v })}
                />
                <Label htmlFor="active-edit-ppe" className="font-normal cursor-pointer">
                  Active
                </Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsEditOpen(false)}>
                ยกเลิก
              </Button>
              <Button onClick={() => void handleUpdate()} className="bg-orange-600 hover:bg-orange-700 font-bold">
                บันทึกการแก้ไข
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

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
                  {filteredDisplayRows.map((row) =>
                    row.kind === 'standalone' ? (
                      <TableRow key={row.item.id} className="hover:bg-muted/30 transition-colors">
                        <TableCell className="pl-6 font-mono text-xs font-bold text-orange-700">{row.item.itemCode}</TableCell>
                        <TableCell className="font-bold text-primary">{row.item.itemName}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {(row.item.variantSpecification || '').trim() || '—'}
                          {(row.item.variantGroupKey || '').trim() ? (
                            <span className="block text-[10px] font-mono text-orange-700 mt-0.5">กลุ่ม: {row.item.variantGroupKey}</span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{row.item.category}</Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={`font-black text-lg ${stockTone(row.item.currentStock, row.item.minimumStock)}`}>
                            {row.item.currentStock}
                          </span>
                          <span className="text-[10px] text-muted-foreground ml-1">{row.item.unit}</span>
                        </TableCell>
                        <TableCell>
                          <Badge className={row.item.active ? 'bg-green-600' : 'bg-slate-200'}>
                            {row.item.active ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right pr-6 space-x-2">
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => openEditDialog(row.item)}>
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => void handleDelete(row.item)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ) : (
                      <Fragment key={row.header.id}>
                        <TableRow className="bg-muted/50 hover:bg-muted/60 border-t-2 border-t-orange-500/30">
                          <TableCell className="pl-6 font-mono text-xs font-bold text-orange-700">{row.header.itemCode}</TableCell>
                          <TableCell className="font-bold text-primary">
                            {row.header.itemName}
                            <Badge variant="outline" className="ml-2 text-[10px] border-orange-300 text-orange-800">
                              เมน
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">—</TableCell>
                          <TableCell>
                            <Badge variant="outline">{row.header.category}</Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <span className="font-black text-lg text-orange-700">{sumChildStock(row.children)}</span>
                            <span className="text-[10px] text-muted-foreground ml-1">{row.header.unit}</span>
                            <div className="text-[10px] text-muted-foreground">รวมรุ่นย่อย</div>
                          </TableCell>
                          <TableCell>
                            <Badge className={row.header.active !== false ? 'bg-green-600' : 'bg-slate-200'}>
                              {row.header.active !== false ? 'Active' : 'Inactive'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right pr-6 space-x-2">
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => openEditDialog(row.header)}>
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => void handleDelete(row.header)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                        {row.children.map((child) => (
                          <TableRow key={child.id} className="hover:bg-muted/20 border-l-4 border-l-orange-400/40">
                            <TableCell className="pl-10 font-mono text-xs text-muted-foreground">{child.itemCode}</TableCell>
                            <TableCell className="text-muted-foreground text-sm italic pl-6">↳ รุ่นย่อย</TableCell>
                            <TableCell className="text-sm">
                              {(child.variantSpecification || '').trim() || '—'}
                              {(child.variantGroupKey || '').trim() ? (
                                <span className="block text-[10px] font-mono text-muted-foreground mt-0.5">
                                  กลุ่ม: {child.variantGroupKey}
                                </span>
                              ) : null}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="text-xs">
                                {child.category}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-center">
                              <span className={`font-bold ${stockTone(child.currentStock, child.minimumStock)}`}>
                                {child.currentStock}
                              </span>
                              <span className="text-[10px] text-muted-foreground ml-1">{child.unit}</span>
                            </TableCell>
                            <TableCell>
                              <Badge className={child.active !== false ? 'bg-green-600/90' : 'bg-slate-200'}>
                                {child.active !== false ? 'Active' : 'Inactive'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right pr-6 space-x-2">
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => openEditDialog(child)}>
                                <Edit2 className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => void handleDelete(child)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </Fragment>
                    ),
                  )}
                  {filteredDisplayRows.length === 0 && !isLoading && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-20 text-muted-foreground italic">
                        {ppeItems.length === 0
                          ? 'ยังไม่มีรายการ PPE — เพิ่มจากปุ่มด้านบน'
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
