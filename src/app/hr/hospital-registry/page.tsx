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
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { HeartPulse, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useFirestore } from '@/firebase';
import { addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, updateDoc } from 'firebase/firestore';
import type { SsoHospitalCatalogItem, User } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';
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

export default function HospitalRegistryPage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const canManage = useMemo(
    () => canView(currentUser, 'office_staff') || canView(currentUser, 'workers'),
    [currentUser],
  );

  const [hospitals, setHospitals] = useState<SsoHospitalCatalogItem[] | null>(null);
  const loadingHospitals = hospitals === null;

  const loadHospitals = useCallback(async () => {
    if (!firestore || !canManage) {
      setHospitals([]);
      return;
    }
    try {
      const q = query(collection(firestore, 'sso_hospital_catalog'), orderBy('sortOrder', 'asc'));
      const snap = await getDocs(q);
      setHospitals(snap.docs.map((d) => ({ id: d.id, ...d.data() } as SsoHospitalCatalogItem)));
    } catch (e) {
      console.error(e);
      setHospitals([]);
    }
  }, [firestore, canManage]);

  useEffect(() => {
    if (!canManage || !firestore) {
      setHospitals([]);
      return;
    }
    void loadHospitals();
  }, [canManage, firestore, loadHospitals]);

  const [hospitalDialogOpen, setHospitalDialogOpen] = useState(false);
  const [hospitalForm, setHospitalForm] = useState<
    Partial<Pick<SsoHospitalCatalogItem, 'nameTh' | 'address' | 'phone' | 'isActive'>>
  >({
    nameTh: '',
    address: '',
    phone: '',
    isActive: true,
  });
  const [editingHospitalId, setEditingHospitalId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteHospitalId, setDeleteHospitalId] = useState<string | null>(null);

  const nextHospitalSort = useMemo(() => {
    const list = hospitals ?? [];
    if (list.length === 0) return 0;
    return Math.max(...list.map((h) => h.sortOrder ?? 0)) + 1;
  }, [hospitals]);

  const openNewHospital = () => {
    setEditingHospitalId(null);
    setHospitalForm({ nameTh: '', address: '', phone: '', isActive: true });
    setHospitalDialogOpen(true);
  };

  const openEditHospital = (h: SsoHospitalCatalogItem) => {
    setEditingHospitalId(h.id);
    setHospitalForm({
      nameTh: h.nameTh,
      address: h.address ?? '',
      phone: h.phone ?? '',
      isActive: h.isActive,
    });
    setHospitalDialogOpen(true);
  };

  const saveHospital = async () => {
    if (!firestore || !hospitalForm.nameTh?.trim()) {
      toast({ variant: 'destructive', title: 'ระบุชื่อโรงพยาบาล' });
      return;
    }
    setSaving(true);
    try {
      const now = Date.now();
      const sortOrder =
        editingHospitalId != null
          ? ((hospitals ?? []).find((x) => x.id === editingHospitalId)?.sortOrder ?? 0)
          : nextHospitalSort;
      const payload = {
        nameTh: hospitalForm.nameTh.trim(),
        address: (hospitalForm.address || '').trim() || undefined,
        phone: (hospitalForm.phone || '').trim() || undefined,
        sortOrder,
        isActive: !!hospitalForm.isActive,
        updatedAt: now,
      };
      if (editingHospitalId) {
        await updateDoc(doc(firestore, 'sso_hospital_catalog', editingHospitalId), payload);
        toast({ title: 'อัปเดตโรงพยาบาลแล้ว' });
      } else {
        await addDoc(collection(firestore, 'sso_hospital_catalog'), { ...payload, createdAt: now });
        toast({ title: 'เพิ่มโรงพยาบาลแล้ว' });
      }
      setHospitalDialogOpen(false);
      void loadHospitals();
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'บันทึกไม่สำเร็จ', description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteHospital = async () => {
    if (!firestore || !deleteHospitalId) return;
    try {
      await deleteDoc(doc(firestore, 'sso_hospital_catalog', deleteHospitalId));
      toast({ title: 'ลบรายการแล้ว' });
      void loadHospitals();
    } catch (e) {
      toast({ variant: 'destructive', title: 'ลบไม่สำเร็จ' });
    } finally {
      setDeleteHospitalId(null);
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
      <div className="space-y-6 max-w-[1100px] mx-auto">
        <div className="flex flex-col gap-2">
          <PayrollScopeTag scope="office" showHint={false} />
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <HeartPulse className="h-8 w-8 shrink-0" /> ทะเบียนโรงพยาบาล (สปส.)
          </h1>
          <p className="text-muted-foreground">
            เก็บชื่อ ที่อยู่ และเบอร์โทรเพื่ออ้างอิง — ในฟอร์มพนักงาน/ลูกจ้างจะดึงไปใช้เฉพาะชื่อเท่านั้น
          </p>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between border-b">
            <div>
              <CardTitle>โรงพยาบาลประกันสังคม</CardTitle>
              <CardDescription>เรียงลำดับอัตโนมัติตามการเพิ่มรายการ · ใช้เลือกโรงพยาบาลหลักที่แจ้ง สปส.</CardDescription>
            </div>
            <Button type="button" className="gap-2" onClick={openNewHospital}>
              <Plus className="h-4 w-4" /> เพิ่ม
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {loadingHospitals ? (
              <div className="py-16 flex justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[140px]">ชื่อ</TableHead>
                    <TableHead className="min-w-[180px]">ที่อยู่</TableHead>
                    <TableHead className="w-36">เบอร์โทร</TableHead>
                    <TableHead className="w-28">สถานะ</TableHead>
                    <TableHead className="w-28 text-right">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(hospitals ?? []).map((h) => (
                    <TableRow key={h.id}>
                      <TableCell className="font-medium align-top">{h.nameTh}</TableCell>
                      <TableCell className="text-muted-foreground text-sm align-top whitespace-pre-wrap max-w-[320px]">
                        {h.address?.trim() || '—'}
                      </TableCell>
                      <TableCell className="align-top tabular-nums">{h.phone?.trim() || '—'}</TableCell>
                      <TableCell className="align-top">
                        {h.isActive ? (
                          <Badge variant="outline" className="bg-green-50 text-green-800">
                            ใช้งาน
                          </Badge>
                        ) : (
                          <Badge variant="secondary">ปิด</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right space-x-1 align-top">
                        <Button type="button" variant="ghost" size="icon" onClick={() => openEditHospital(h)} title="แก้ไข">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          onClick={() => setDeleteHospitalId(h.id)}
                          title="ลบ"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!hospitals || hospitals.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                        ยังไม่มีรายการ — กด «เพิ่ม»
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Dialog open={hospitalDialogOpen} onOpenChange={setHospitalDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingHospitalId ? 'แก้ไขโรงพยาบาล' : 'เพิ่มโรงพยาบาล'}</DialogTitle>
              <DialogDescription>ชื่อจะถูกส่งไปยังฟอร์มพนักงานเมื่อเลือกจากรายการ — ที่อยู่และเบอร์ใช้อ้างอิงในทะเบียนเท่านั้น</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="space-y-2">
                <Label>ชื่อโรงพยาบาล *</Label>
                <Input
                  value={hospitalForm.nameTh ?? ''}
                  onChange={(e) => setHospitalForm({ ...hospitalForm, nameTh: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>ที่อยู่</Label>
                <Textarea
                  rows={3}
                  className="resize-y min-h-[72px]"
                  value={hospitalForm.address ?? ''}
                  onChange={(e) => setHospitalForm({ ...hospitalForm, address: e.target.value })}
                  placeholder="ที่อยู่ตามทะเบียน (ไม่ถูกส่งไปฟอร์มพนักงาน)"
                />
              </div>
              <div className="space-y-2">
                <Label>เบอร์โทร</Label>
                <Input
                  type="tel"
                  value={hospitalForm.phone ?? ''}
                  onChange={(e) => setHospitalForm({ ...hospitalForm, phone: e.target.value })}
                  placeholder="เช่น 02-xxx-xxxx"
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="hosp-active"
                  checked={!!hospitalForm.isActive}
                  onCheckedChange={(c) => setHospitalForm({ ...hospitalForm, isActive: c === true })}
                />
                <Label htmlFor="hosp-active" className="cursor-pointer">
                  ใช้งาน
                </Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setHospitalDialogOpen(false)} disabled={saving}>
                ยกเลิก
              </Button>
              <Button onClick={() => void saveHospital()} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                บันทึก
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={deleteHospitalId !== null} onOpenChange={(o) => !o && setDeleteHospitalId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ลบโรงพยาบาลจากทะเบียน?</AlertDialogTitle>
              <AlertDialogDescription>ข้อความที่บันทึกในพนักงานไม่ถูกลบอัตโนมัติ</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
              <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={() => void confirmDeleteHospital()}>
                ลบ
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppShell>
  );
}
