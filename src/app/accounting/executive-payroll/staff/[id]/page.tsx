'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, Loader2, Save, ShieldAlert } from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { collection, doc, setDoc, updateDoc } from 'firebase/firestore';
import { ExecutivePayrollStaff, User } from '@/lib/types';
import { useAppUser } from '@/hooks/use-app-user';
import { canView, canCreate, canEdit } from '@/lib/permissions';
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';
import { useToast } from '@/hooks/use-toast';
import { sanitizeFirestorePayload } from '@/lib/utils';

function emptyForm(): Omit<ExecutivePayrollStaff, 'id' | 'createdAt' | 'updatedAt'> & {
  staffCode: string;
} {
  return {
    staffCode: getPreviewPattern('executive_payroll_staff'),
    fullName: '',
    department: '',
    positionTitle: '',
    monthlySalary: 0,
    employmentType: 'FULL_TIME',
    salaryType: 'MONTHLY',
    excludeFromPayrollRuns: false,
    status: 'ACTIVE',
    notes: '',
    linkedOfficeStaffId: '',
  };
}

export default function ExecutivePayrollStaffEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();

  const isNew = id === 'new';

  const isAuthorized = useMemo(() => canView(currentUser, 'executive_payroll'), [currentUser]);
  const canSaveNew = useMemo(() => canCreate(currentUser, 'executive_payroll'), [currentUser]);
  const canSaveEdit = useMemo(() => canEdit(currentUser, 'executive_payroll'), [currentUser]);

  const staffRef = useMemoFirebase(
    () => (firestore && !isNew && isAuthorized ? doc(firestore, 'executive_payroll_staff', id) : null),
    [firestore, id, isNew, isAuthorized],
  );
  const { data: existing, isLoading: docLoading } = useDoc<ExecutivePayrollStaff>(staffRef as any);

  const [form, setForm] = useState(emptyForm());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isNew || !existing) return;
    setForm({
      staffCode: existing.staffCode,
      fullName: existing.fullName,
      department: existing.department,
      positionTitle: existing.positionTitle,
      monthlySalary: existing.monthlySalary ?? 0,
      employmentType: existing.employmentType ?? 'FULL_TIME',
      salaryType: existing.salaryType ?? 'MONTHLY',
      excludeFromPayrollRuns: !!existing.excludeFromPayrollRuns,
      status: existing.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
      notes: existing.notes ?? '',
      linkedOfficeStaffId: existing.linkedOfficeStaffId ?? '',
    });
  }, [isNew, existing]);

  const handleSave = async () => {
    if (!firestore || !currentUser) return;
    if (!form.fullName.trim() || !form.department.trim() || !form.positionTitle.trim()) {
      toast({
        variant: 'destructive',
        title: 'ข้อมูลไม่ครบ',
        description: 'กรุณากรอกชื่อ แผนก และตำแหน่ง',
      });
      return;
    }
    if (isNew && !canSaveNew) return;
    if (!isNew && !canSaveEdit) return;

    setSubmitting(true);
    const now = Date.now();
    try {
      if (isNew) {
        const { code } = await generateNextDocumentCode(firestore, 'executive_payroll_staff', {
          actor: currentUser.displayName,
        });
        const newRef = doc(collection(firestore, 'executive_payroll_staff'));
        const payload: ExecutivePayrollStaff = {
          id: newRef.id,
          staffCode: code,
          fullName: form.fullName.trim(),
          department: form.department.trim(),
          positionTitle: form.positionTitle.trim(),
          monthlySalary: Number(form.monthlySalary) || 0,
          employmentType: form.employmentType,
          salaryType: form.salaryType,
          excludeFromPayrollRuns: form.excludeFromPayrollRuns,
          status: form.status,
          notes: form.notes?.trim() || undefined,
          linkedOfficeStaffId: form.linkedOfficeStaffId?.trim() || undefined,
          createdAt: now,
          updatedAt: now,
          createdBy: currentUser.displayName,
          updatedBy: currentUser.id,
        };
        await setDoc(newRef, sanitizeFirestorePayload(payload));
        toast({ title: 'บันทึกแล้ว', description: `รหัส ${code}` });
        router.push('/accounting/executive-payroll/staff');
      } else {
        await updateDoc(
          doc(firestore, 'executive_payroll_staff', id),
          sanitizeFirestorePayload({
            fullName: form.fullName.trim(),
            department: form.department.trim(),
            positionTitle: form.positionTitle.trim(),
            monthlySalary: Number(form.monthlySalary) || 0,
            employmentType: form.employmentType,
            salaryType: form.salaryType,
            excludeFromPayrollRuns: form.excludeFromPayrollRuns,
            status: form.status,
            notes: form.notes?.trim() || undefined,
            linkedOfficeStaffId: form.linkedOfficeStaffId?.trim() || undefined,
            updatedAt: now,
            updatedBy: currentUser.id,
          }),
        );
        toast({ title: 'อัปเดตแล้ว' });
        router.push('/accounting/executive-payroll/staff');
      }
    } catch (e) {
      console.error(e);
      toast({
        variant: 'destructive',
        title: 'บันทึกไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (userLoading || !currentUser) return null;

  if (!isAuthorized) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="mx-auto max-w-5xl py-10 text-center text-muted-foreground">
          คุณไม่มีสิทธิ์เข้าถึงเมนูนี้
        </div>
      </AppShell>
    );
  }

  if (!isNew && docLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  if (!isNew && !existing) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="mx-auto max-w-lg py-20 text-center">
          <ShieldAlert className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <p className="font-bold">ไม่พบรายการ</p>
          <Button className="mt-4" variant="outline" onClick={() => router.push('/accounting/executive-payroll/staff')}>
            กลับ
          </Button>
        </div>
      </AppShell>
    );
  }

  const saveDisabled =
    submitting || (isNew ? !canSaveNew : !canSaveEdit);

  return (
    <AppShell user={currentUser as User} onLogout={() => {}}>
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.back()}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-primary">
                {isNew ? 'เพิ่มผู้บริหาร' : `แก้ไข: ${existing?.fullName}`}
              </h1>
              <p className="text-sm text-muted-foreground">
                ข้อมูลนี้ใช้สำหรับงวดเงินเดือนผู้บริหาร — หักภาษี/ประกันสังคมตามนโยบาย HR (office)
              </p>
            </div>
          </div>
          <Button className="gap-2 font-bold" disabled={saveDisabled} onClick={() => void handleSave()}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            บันทึก
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">ข้อมูลการจ้างและเงินเดือน</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {!isNew && (
              <div className="space-y-2">
                <Label>รหัสพนักงาน</Label>
                <Input value={form.staffCode} disabled className="font-mono" />
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>ชื่อ-นามสกุล</Label>
                <Input
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                  placeholder="ชื่อผู้บริหาร"
                />
              </div>
              <div className="space-y-2">
                <Label>แผนก</Label>
                <Input
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value })}
                  placeholder="เช่น สำนักบริหาร"
                />
              </div>
              <div className="space-y-2">
                <Label>ตำแหน่ง</Label>
                <Input
                  value={form.positionTitle}
                  onChange={(e) => setForm({ ...form, positionTitle: e.target.value })}
                  placeholder="เช่น กรรมการผู้จัดการ"
                />
              </div>
              <div className="space-y-2">
                <Label>เงินเดือนต่อเดือน (บาท)</Label>
                <Input
                  type="number"
                  min={0}
                  step={100}
                  value={form.monthlySalary}
                  onChange={(e) => setForm({ ...form, monthlySalary: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label>สถานะ</Label>
                <Select
                  value={form.status}
                  onValueChange={(v: 'ACTIVE' | 'INACTIVE') => setForm({ ...form, status: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">ACTIVE</SelectItem>
                    <SelectItem value="INACTIVE">INACTIVE</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>ประเภทการจ้าง</Label>
                <Select
                  value={form.employmentType}
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      employmentType: v as ExecutivePayrollStaff['employmentType'],
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FULL_TIME">FULL_TIME</SelectItem>
                    <SelectItem value="PART_TIME">PART_TIME</SelectItem>
                    <SelectItem value="CONTRACT">CONTRACT</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>ประเภทค่าจ้าง</Label>
                <Select
                  value={form.salaryType}
                  onValueChange={(v) =>
                    setForm({ ...form, salaryType: v as ExecutivePayrollStaff['salaryType'] })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MONTHLY">MONTHLY</SelectItem>
                    <SelectItem value="DAILY">DAILY</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="ex"
                checked={form.excludeFromPayrollRuns}
                onCheckedChange={(c) => setForm({ ...form, excludeFromPayrollRuns: c === true })}
              />
              <Label htmlFor="ex" className="cursor-pointer text-sm font-normal">
                ไม่นำเข้างวดคำนวณอัตโนมัติ
              </Label>
            </div>

            <div className="space-y-2">
              <Label>อ้างอิง office_staff (ถ้ามี)</Label>
              <Input
                value={form.linkedOfficeStaffId}
                onChange={(e) => setForm({ ...form, linkedOfficeStaffId: e.target.value })}
                placeholder="Document ID จากทะเบียนพนักงานออฟฟิศ"
                className="font-mono text-xs"
              />
            </div>

            <div className="space-y-2">
              <Label>หมายเหตุ</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
