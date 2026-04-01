'use client';

import { useMemo, useState } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { addDocumentNonBlocking, updateDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { collection, doc } from 'firebase/firestore';
import { User, WorkerDocumentCatalogItem } from '@/lib/types';
import { usePermissions } from '@/hooks/use-permissions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { FileText, Plus, Pencil, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Textarea } from '@/components/ui/textarea';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccess, isMatrixControlledRole } from '@/lib/permissions';

type CatalogForm = Partial<WorkerDocumentCatalogItem>;

function toCatalogCode(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export default function WorkerDocumentCatalogPage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { can, isLoading: isPermLoading } = usePermissions(currentUser);
  const [isOpen, setIsOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<WorkerDocumentCatalogItem | null>(null);
  const [form, setForm] = useState<CatalogForm>({
    requirementType: 'certificate',
    hasExpiry: true,
    active: true,
    defaultValidityMonths: 12,
    alertBeforeExpiryDays: 120,
    blockBeforeExpiryDays: 90,
  });

  const useMatrixGuards = isMatrixControlledRole(currentUser);
  const canViewWorkers = useMatrixGuards ? canAccess(currentUser, 'worker_documents', 'view') : can('workers').view;
  const canCreateWorkers = useMatrixGuards ? canAccess(currentUser, 'worker_documents', 'create') : can('workers').create;
  const canEditWorkers = useMatrixGuards ? canAccess(currentUser, 'worker_documents', 'edit') : can('workers').edit;
  const canDeleteWorkers = useMatrixGuards ? canAccess(currentUser, 'worker_documents', 'delete') : can('workers').delete;
  const catalogQuery = useMemoFirebase(() => {
    if (userLoading || !currentUser || !firestore || !canViewWorkers) return null;
    return collection(firestore, 'worker_document_catalog');
  }, [userLoading, currentUser, firestore, canViewWorkers]);
  const { data: catalogItems, isLoading } = useCollection<WorkerDocumentCatalogItem>(catalogQuery as any);

  const sortedItems = useMemo(() => {
    return [...(catalogItems || [])].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  }, [catalogItems]);

  const handleCreate = () => {
    if (!canCreateWorkers) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์เพิ่มรายการเอกสารกลาง' });
      return;
    }
    if (!catalogQuery) return;
    if (!form.itemName) {
      toast({ variant: 'destructive', title: 'ข้อมูลไม่ครบ', description: 'กรุณาระบุชื่อเอกสารกลาง' });
      return;
    }
    const generatedCode = toCatalogCode(form.itemName);
    if (!generatedCode) {
      toast({ variant: 'destructive', title: 'ชื่อเอกสารไม่ถูกต้อง', description: 'กรุณาระบุชื่อเอกสารให้มีตัวอักษรหรือเลขอย่างน้อย 1 ตัว' });
      return;
    }
    const now = Date.now();
    addDocumentNonBlocking(catalogQuery, {
      itemName: form.itemName.trim(),
      itemCode: generatedCode,
      requirementType: form.requirementType || 'certificate',
      hasExpiry: form.hasExpiry ?? true,
      defaultValidityMonths: form.hasExpiry ? Number(form.defaultValidityMonths || 0) : 0,
      alertBeforeExpiryDays: form.hasExpiry ? Number(form.alertBeforeExpiryDays || 0) : 0,
      blockBeforeExpiryDays: form.hasExpiry ? Number(form.blockBeforeExpiryDays || 0) : 0,
      description: form.description || '',
      active: form.active ?? true,
      createdAt: now,
      updatedAt: now,
    });
    setIsOpen(false);
    setForm({ requirementType: 'certificate', hasExpiry: true, active: true, defaultValidityMonths: 12, alertBeforeExpiryDays: 120, blockBeforeExpiryDays: 90 });
    toast({ title: 'เพิ่มรายการสำเร็จ', description: 'บันทึกรายการเอกสารกลางเรียบร้อยแล้ว' });
  };

  const handleSaveEdit = () => {
    if (!canEditWorkers) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์แก้ไขรายการเอกสารกลาง' });
      return;
    }
    if (!firestore || !editingItem) return;
    if (!form.itemName) {
      toast({ variant: 'destructive', title: 'ข้อมูลไม่ครบ', description: 'กรุณาระบุชื่อเอกสารกลาง' });
      return;
    }
    const generatedCode = toCatalogCode(form.itemName);
    updateDocumentNonBlocking(doc(firestore, 'worker_document_catalog', editingItem.id), {
      itemName: form.itemName.trim(),
      itemCode: generatedCode,
      requirementType: form.requirementType || 'certificate',
      hasExpiry: form.hasExpiry ?? true,
      defaultValidityMonths: form.hasExpiry ? Number(form.defaultValidityMonths || 0) : 0,
      alertBeforeExpiryDays: form.hasExpiry ? Number(form.alertBeforeExpiryDays || 0) : 0,
      blockBeforeExpiryDays: form.hasExpiry ? Number(form.blockBeforeExpiryDays || 0) : 0,
      description: form.description || '',
      updatedAt: Date.now(),
    });
    setIsEditOpen(false);
    setEditingItem(null);
    setForm({ requirementType: 'certificate', hasExpiry: true, active: true, defaultValidityMonths: 12, alertBeforeExpiryDays: 120, blockBeforeExpiryDays: 90 });
    toast({ title: 'แก้ไขสำเร็จ', description: 'อัปเดตรายการเอกสารกลางแล้ว' });
  };

  const handleToggleActive = (item: WorkerDocumentCatalogItem) => {
    if (!canEditWorkers) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์แก้ไขสถานะรายการเอกสารกลาง' });
      return;
    }
    if (!firestore) return;
    updateDocumentNonBlocking(doc(firestore, 'worker_document_catalog', item.id), {
      active: !item.active,
      updatedAt: Date.now(),
    });
  };

  if (!currentUser || isPermLoading || userLoading) return null;
  if (!canViewWorkers) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-5xl mx-auto py-10 text-center text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงเมนูนี้</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1200px] mx-auto">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 space-y-2">
            <PayrollScopeTag scope="worker" showHint={false} />
            <h1 className="text-3xl font-bold tracking-tight text-primary">รายการเอกสารกลาง (ลูกจ้าง)</h1>
            <p className="text-muted-foreground">
              <strong>Worker Payroll</strong> — ใช้กับตำแหน่งงานและทะเบียนลูกจ้าง (ไม่ใช้กับพนักงานออฟฟิศ)
            </p>
          </div>
        </div>

        <Card>
          <CardHeader className="border-b bg-primary/5 flex flex-row items-center justify-between">
            <CardTitle className="text-primary flex items-center gap-2"><FileText className="h-5 w-5" /> เอกสารกลาง</CardTitle>
            {canCreateWorkers && (
              <Dialog open={isOpen} onOpenChange={setIsOpen}>
                <DialogTrigger asChild>
                  <Button className="bg-primary font-bold"><Plus className="h-4 w-4 mr-2" />เพิ่มรายการกลาง</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>เพิ่มรายการเอกสารกลาง</DialogTitle>
                    <DialogDescription>กำหนดชื่อเอกสาร, ประเภท, และนโยบายวันหมดอายุ</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3 py-2">
                    <div className="space-y-2">
                      <Label>ชื่อเอกสาร/ใบเซอร์</Label>
                      <Input value={form.itemName || ''} onChange={(e) => setForm({ ...form, itemName: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>รายละเอียดเอกสาร</Label>
                      <Textarea
                        value={form.description || ''}
                        onChange={(e) => setForm({ ...form, description: e.target.value })}
                        placeholder="อธิบายว่าเอกสารนี้ใช้เพื่ออะไร/ใช้ในงานประเภทไหน"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>ประเภท</Label>
                      <Select value={form.requirementType || 'certificate'} onValueChange={(v) => setForm({ ...form, requirementType: v as 'certificate' | 'document' })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="certificate">Certificate</SelectItem>
                          <SelectItem value="document">Document</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox id="has-exp" checked={form.hasExpiry ?? true} onCheckedChange={(v) => setForm({ ...form, hasExpiry: !!v })} />
                      <Label htmlFor="has-exp">เอกสารนี้มีวันหมดอายุ</Label>
                    </div>
                    <div className="space-y-2">
                      <Label>อายุแนะนำ (เดือน)</Label>
                      <Input type="number" disabled={!form.hasExpiry} value={form.defaultValidityMonths || 0} onChange={(e) => setForm({ ...form, defaultValidityMonths: Number(e.target.value || 0) })} />
                    </div>
                    <div className="space-y-2">
                      <Label>แจ้งเตือนก่อนหมดอายุ (วัน)</Label>
                      <Input type="number" disabled={!form.hasExpiry} value={form.alertBeforeExpiryDays || 0} onChange={(e) => setForm({ ...form, alertBeforeExpiryDays: Number(e.target.value || 0) })} />
                    </div>
                    <div className="space-y-2">
                      <Label>บล็อกการ Assign ก่อนหมดอายุ (วัน)</Label>
                      <Input type="number" disabled={!form.hasExpiry} value={form.blockBeforeExpiryDays || 0} onChange={(e) => setForm({ ...form, blockBeforeExpiryDays: Number(e.target.value || 0) })} />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsOpen(false)}>ยกเลิก</Button>
                    <Button onClick={handleCreate}>บันทึก</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="pl-6">ชื่อรายการ</TableHead>
                  <TableHead>รายละเอียด</TableHead>
                  <TableHead>ประเภท</TableHead>
                  <TableHead>อายุ</TableHead>
                  <TableHead>แจ้งเตือน</TableHead>
                  <TableHead>บล็อก Assign</TableHead>
                  <TableHead>สถานะ</TableHead>
                  <TableHead className="text-right pr-6">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(sortedItems || []).map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="pl-6 font-medium text-primary">{item.itemName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{item.description || '-'}</TableCell>
                    <TableCell className="uppercase text-xs">{item.requirementType}</TableCell>
                    <TableCell>{item.hasExpiry ? `${item.defaultValidityMonths || 0} เดือน` : 'ไม่มีวันหมดอายุ'}</TableCell>
                    <TableCell>{item.hasExpiry ? `${item.alertBeforeExpiryDays || 0} วัน` : '-'}</TableCell>
                    <TableCell>{item.hasExpiry ? `${item.blockBeforeExpiryDays || 0} วัน` : '-'}</TableCell>
                    <TableCell>
                      <Badge variant={item.active ? 'default' : 'secondary'} className={item.active ? 'bg-green-600 text-white' : ''}>
                        {item.active ? 'ACTIVE' : 'INACTIVE'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right pr-6">
                      {canEditWorkers && (
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditingItem(item);
                              setForm({
                                itemName: item.itemName,
                                requirementType: item.requirementType,
                                hasExpiry: item.hasExpiry,
                                defaultValidityMonths: item.defaultValidityMonths || 0,
                                alertBeforeExpiryDays: item.alertBeforeExpiryDays || 0,
                                blockBeforeExpiryDays: item.blockBeforeExpiryDays || 0,
                                description: item.description || '',
                                active: item.active,
                              });
                              setIsEditOpen(true);
                            }}
                          >
                            <Pencil className="h-3 w-3 mr-1" /> แก้ไข
                          </Button>
                          <Button variant="outline" size="sm" disabled={!canEditWorkers} onClick={() => handleToggleActive(item)}>
                            {item.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={!canDeleteWorkers}
                            onClick={() => {
                              if (!canDeleteWorkers) return;
                              if (!firestore) return;
                              if (confirm(`ยืนยันลบรายการ "${item.itemName}" ?`)) {
                                deleteDocumentNonBlocking(doc(firestore, 'worker_document_catalog', item.id));
                              }
                            }}
                          >
                            <Trash2 className="h-3 w-3 mr-1" /> ลบ
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {!isLoading && (!sortedItems || sortedItems.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">ยังไม่มีรายการเอกสารกลาง</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>แก้ไขรายการเอกสารกลาง</DialogTitle>
              <DialogDescription>ปรับรายละเอียดและเงื่อนไขการแจ้งเตือน/บล็อกก่อนหมดอายุ</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-2">
                <Label>ชื่อเอกสาร/ใบเซอร์</Label>
                <Input value={form.itemName || ''} onChange={(e) => setForm({ ...form, itemName: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>รายละเอียดเอกสาร</Label>
                <Textarea value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>ประเภท</Label>
                <Select value={form.requirementType || 'certificate'} onValueChange={(v) => setForm({ ...form, requirementType: v as 'certificate' | 'document' })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="certificate">Certificate</SelectItem>
                    <SelectItem value="document">Document</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="edit-has-exp" checked={form.hasExpiry ?? true} onCheckedChange={(v) => setForm({ ...form, hasExpiry: !!v })} />
                <Label htmlFor="edit-has-exp">เอกสารนี้มีวันหมดอายุ</Label>
              </div>
              <div className="space-y-2">
                <Label>อายุแนะนำ (เดือน)</Label>
                <Input type="number" disabled={!form.hasExpiry} value={form.defaultValidityMonths || 0} onChange={(e) => setForm({ ...form, defaultValidityMonths: Number(e.target.value || 0) })} />
              </div>
              <div className="space-y-2">
                <Label>แจ้งเตือนก่อนหมดอายุ (วัน)</Label>
                <Input type="number" disabled={!form.hasExpiry} value={form.alertBeforeExpiryDays || 0} onChange={(e) => setForm({ ...form, alertBeforeExpiryDays: Number(e.target.value || 0) })} />
              </div>
              <div className="space-y-2">
                <Label>บล็อกการ Assign ก่อนหมดอายุ (วัน)</Label>
                <Input type="number" disabled={!form.hasExpiry} value={form.blockBeforeExpiryDays || 0} onChange={(e) => setForm({ ...form, blockBeforeExpiryDays: Number(e.target.value || 0) })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsEditOpen(false)}>ยกเลิก</Button>
              <Button onClick={handleSaveEdit}>บันทึกการแก้ไข</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
