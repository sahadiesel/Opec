'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Landmark, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useFirestore } from '@/firebase';
import { addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, updateDoc } from 'firebase/firestore';
import type { BankNameCatalogItem, User } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import { useAppUser } from '@/hooks/use-app-user';
import { getEffectiveAccessGroup, isSystemAdmin } from '@/lib/permissions';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export default function BankRegistryPage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  // ทะเบียนธนาคารเป็น master data ฝั่ง HR — accounting/operations/store ไม่จำเป็นต้องเข้ามาแก้ไข
  // จำกัด UI gate ให้ตรงสิทธิ์จริง เพื่อไม่ให้ยิง Firestore แล้วโดน rules บล็อก -> overlay error
  const canManage = useMemo(() => {
    if (!currentUser) return false;
    if (isSystemAdmin(currentUser)) return true;
    return getEffectiveAccessGroup(currentUser) === 'hr';
  }, [currentUser]);

  const [banks, setBanks] = useState<BankNameCatalogItem[] | null>(null);
  const loadingBanks = banks === null;

  const loadBanks = useCallback(async () => {
    if (!firestore || !canManage) {
      setBanks([]);
      return;
    }
    try {
      const q = query(collection(firestore, 'bank_name_catalog'), orderBy('sortOrder', 'asc'));
      const snap = await getDocs(q);
      setBanks(snap.docs.map((d) => ({ id: d.id, ...d.data() } as BankNameCatalogItem)));
    } catch (e) {
      // กลืน permission-denied แบบเงียบ — UI gate ข้างบนจะแสดง "ไม่มีสิทธิ์" อยู่แล้ว ไม่ต้องดัน Next.js error overlay
      const code = (e as { code?: string } | undefined)?.code;
      if (code !== 'permission-denied') console.error(e);
      setBanks([]);
    }
  }, [firestore, canManage]);

  useEffect(() => {
    if (!canManage || !firestore) {
      setBanks([]);
      return;
    }
    void loadBanks();
  }, [canManage, firestore, loadBanks]);

  const [bankDialogOpen, setBankDialogOpen] = useState(false);
  const [bankForm, setBankForm] = useState<Partial<Pick<BankNameCatalogItem, 'nameTh' | 'isActive'>>>({
    nameTh: '',
    isActive: true,
  });
  const [editingBankId, setEditingBankId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteBankId, setDeleteBankId] = useState<string | null>(null);

  const nextBankSort = useMemo(() => {
    const list = banks ?? [];
    if (list.length === 0) return 0;
    return Math.max(...list.map((b) => b.sortOrder ?? 0)) + 1;
  }, [banks]);

  const openNewBank = () => {
    setEditingBankId(null);
    setBankForm({ nameTh: '', isActive: true });
    setBankDialogOpen(true);
  };

  const openEditBank = (b: BankNameCatalogItem) => {
    setEditingBankId(b.id);
    setBankForm({ nameTh: b.nameTh, isActive: b.isActive });
    setBankDialogOpen(true);
  };

  const saveBank = async () => {
    if (!firestore || !bankForm.nameTh?.trim()) {
      toast({ variant: 'destructive', title: 'ระบุชื่อธนาคาร' });
      return;
    }
    setSaving(true);
    try {
      const now = Date.now();
      const sortOrder =
        editingBankId != null
          ? ((banks ?? []).find((b) => b.id === editingBankId)?.sortOrder ?? 0)
          : nextBankSort;
      const payload = {
        nameTh: bankForm.nameTh.trim(),
        sortOrder,
        isActive: !!bankForm.isActive,
        updatedAt: now,
      };
      if (editingBankId) {
        await updateDoc(doc(firestore, 'bank_name_catalog', editingBankId), payload);
        toast({ title: 'อัปเดตธนาคารแล้ว' });
      } else {
        await addDoc(collection(firestore, 'bank_name_catalog'), { ...payload, createdAt: now });
        toast({ title: 'เพิ่มธนาคารแล้ว' });
      }
      setBankDialogOpen(false);
      void loadBanks();
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'บันทึกไม่สำเร็จ', description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteBank = async () => {
    if (!firestore || !deleteBankId) return;
    try {
      await deleteDoc(doc(firestore, 'bank_name_catalog', deleteBankId));
      toast({ title: 'ลบรายการแล้ว' });
      void loadBanks();
    } catch (e) {
      toast({ variant: 'destructive', title: 'ลบไม่สำเร็จ' });
    } finally {
      setDeleteBankId(null);
    }
  };

  if (userLoading || !currentUser) return null;

  if (!canManage) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-lg mx-auto py-20 text-center text-muted-foreground">ไม่มีสิทธิ์เข้าถึงทะเบียนนี้</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[900px] mx-auto">
        <div className="flex flex-col gap-2">
          <PayrollScopeTag scope="office" showHint={false} />
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <Landmark className="h-8 w-8 shrink-0" /> ทะเบียนธนาคาร
          </h1>
          <p className="text-muted-foreground">
            เก็บเฉพาะชื่อธนาคาร — ในฟอร์มพนักงาน/ลูกจ้างจะดึงไปแค่ชื่อเท่านั้น (พิมพ์เองได้หากไม่มีในรายการ)
          </p>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between border-b">
            <div>
              <CardTitle>รายชื่อธนาคาร</CardTitle>
              <CardDescription>เรียงลำดับอัตโนมัติตามการเพิ่มรายการ · ปิดใช้งานได้โดยไม่ลบข้อมูล</CardDescription>
            </div>
            <Button type="button" className="gap-2" onClick={openNewBank}>
              <Plus className="h-4 w-4" /> เพิ่ม
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {loadingBanks ? (
              <div className="py-16 flex justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ชื่อ</TableHead>
                    <TableHead className="w-28">สถานะ</TableHead>
                    <TableHead className="w-28 text-right">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(banks ?? []).map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">{b.nameTh}</TableCell>
                      <TableCell>
                        {b.isActive ? (
                          <Badge variant="outline" className="bg-green-50 text-green-800">
                            ใช้งาน
                          </Badge>
                        ) : (
                          <Badge variant="secondary">ปิด</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button type="button" variant="ghost" size="icon" onClick={() => openEditBank(b)} title="แก้ไข">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          onClick={() => setDeleteBankId(b.id)}
                          title="ลบ"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!banks || banks.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center py-12 text-muted-foreground">
                        ยังไม่มีรายการ — กด «เพิ่ม»
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Dialog open={bankDialogOpen} onOpenChange={setBankDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingBankId ? 'แก้ไขธนาคาร' : 'เพิ่มธนาคาร'}</DialogTitle>
              <DialogDescription>ระบุชื่อที่จะให้เลือกในฟอร์ม (บันทึกเป็นข้อความชื่อธนาคารเท่านั้น)</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="space-y-2">
                <Label>ชื่อธนาคาร *</Label>
                <Input value={bankForm.nameTh ?? ''} onChange={(e) => setBankForm({ ...bankForm, nameTh: e.target.value })} />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="bank-active"
                  checked={!!bankForm.isActive}
                  onCheckedChange={(c) => setBankForm({ ...bankForm, isActive: c === true })}
                />
                <Label htmlFor="bank-active" className="cursor-pointer">
                  ใช้งาน
                </Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setBankDialogOpen(false)} disabled={saving}>
                ยกเลิก
              </Button>
              <Button onClick={() => void saveBank()} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                บันทึก
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={deleteBankId !== null} onOpenChange={(o) => !o && setDeleteBankId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ลบธนาคารจากทะเบียน?</AlertDialogTitle>
              <AlertDialogDescription>ข้อมูลในฟอร์มที่พิมพ์ไว้แล้วไม่ถูกลบ — รายการเลือกจะไม่มีชื่อนี้</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
              <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={() => void confirmDeleteBank()}>
                ลบ
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppShell>
  );
}
