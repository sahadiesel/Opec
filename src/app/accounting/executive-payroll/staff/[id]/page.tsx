'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Loader2, Save, ShieldAlert, ShieldCheck, History, Pencil, Briefcase } from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { collection, doc, setDoc, updateDoc, deleteField } from 'firebase/firestore';
import { ExecutivePayrollStaff, User } from '@/lib/types';
import { useAppUser } from '@/hooks/use-app-user';
import { canView, canCreate, canEdit } from '@/lib/permissions';
import { isSystemAdmin } from '@/lib/permission-core';
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';
import { useToast } from '@/hooks/use-toast';
import { sanitizeFirestorePayload } from '@/lib/utils';
import { formatDateTimeThaiBE } from '@/lib/date-thai';
import { buildUserAccessSummaryLines } from '@/lib/hr/user-access-display';

type ExecStaffFormState = Omit<ExecutivePayrollStaff, 'id' | 'createdAt' | 'updatedAt'> & {
  staffCode: string;
};

function emptyForm(): ExecStaffFormState {
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
    nationalId: '',
    taxId: '',
    address: '',
    bankName: '',
    bankAccountNumber: '',
    linkedUserId: '',
    linkedUserDisplayName: '',
    linkedUserDisplayEmail: '',
    linkedUserAccessSummary: [],
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
  const canAdminUserLink = useMemo(() => !!currentUser && isSystemAdmin(currentUser), [currentUser]);

  const staffRef = useMemoFirebase(
    () => (firestore && !isNew && isAuthorized ? doc(firestore, 'executive_payroll_staff', id) : null),
    [firestore, id, isNew, isAuthorized],
  );
  const { data: existing, isLoading: docLoading } = useDoc<ExecutivePayrollStaff>(staffRef as any);

  const usersQuery = useMemoFirebase(() => {
    if (!firestore || !canAdminUserLink || !isAuthorized) return null;
    return collection(firestore, 'users');
  }, [firestore, canAdminUserLink, isAuthorized]);
  const { data: allUsers } = useCollection<User>(usersQuery as any);

  const [form, setForm] = useState<ExecStaffFormState>(emptyForm());
  const [submitting, setSubmitting] = useState(false);
  const [integrationEditMode, setIntegrationEditMode] = useState(false);

  const linkedUserDocRef = useMemoFirebase(
    () =>
      firestore && form.linkedUserId?.trim() && canAdminUserLink
        ? doc(firestore, 'users', form.linkedUserId.trim())
        : null,
    [firestore, form.linkedUserId, canAdminUserLink],
  );
  const { data: linkedUserFromFirestore } = useDoc<User>(linkedUserDocRef as any);

  const integrationAccessLines = useMemo(() => {
    const uid = form.linkedUserId?.trim();
    if (!uid) return [] as string[];
    const u =
      linkedUserFromFirestore ?? (allUsers?.find((x) => x.id === uid) as User | undefined);
    if (u) return buildUserAccessSummaryLines(u);
    if (form.linkedUserAccessSummary?.length) return form.linkedUserAccessSummary;
    return [] as string[];
  }, [form.linkedUserId, form.linkedUserAccessSummary, linkedUserFromFirestore, allUsers]);

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
      nationalId: existing.nationalId ?? '',
      taxId: existing.taxId ?? '',
      address: existing.address ?? '',
      bankName: existing.bankName ?? '',
      bankAccountNumber: existing.bankAccountNumber ?? '',
      linkedUserId: existing.linkedUserId ?? '',
      linkedUserDisplayName: existing.linkedUserDisplayName ?? '',
      linkedUserDisplayEmail: existing.linkedUserDisplayEmail ?? '',
      linkedUserAccessSummary: existing.linkedUserAccessSummary ?? [],
    });
  }, [isNew, existing]);

  const buildUserLinkFirestorePatch = (): Record<string, unknown> => {
    if (!currentUser || !isSystemAdmin(currentUser)) {
      if (isNew) return {};
      return {
        linkedUserId: existing?.linkedUserId,
        linkedUserDisplayName: existing?.linkedUserDisplayName,
        linkedUserDisplayEmail: existing?.linkedUserDisplayEmail,
        linkedUserAccessSummary: existing?.linkedUserAccessSummary,
      };
    }
    const uid = (form.linkedUserId || '').trim();
    // setDoc() cannot include deleteField() — omit optional link fields on create
    if (isNew) {
      if (!uid) return {};
      const u =
        (allUsers?.find((x) => x.id === uid) as User | undefined) ?? linkedUserFromFirestore ?? undefined;
      if (!u) return { linkedUserId: uid };
      const lines = buildUserAccessSummaryLines(u);
      return {
        linkedUserId: uid,
        ...(u.displayName?.trim() ? { linkedUserDisplayName: u.displayName.trim() } : {}),
        ...(u.email?.trim() ? { linkedUserDisplayEmail: u.email.trim() } : {}),
        ...(lines.length ? { linkedUserAccessSummary: lines } : {}),
      };
    }
    if (!uid) {
      return {
        linkedUserId: deleteField(),
        linkedUserDisplayName: deleteField(),
        linkedUserDisplayEmail: deleteField(),
        linkedUserAccessSummary: deleteField(),
      };
    }
    const u =
      (allUsers?.find((x) => x.id === uid) as User | undefined) ?? linkedUserFromFirestore ?? undefined;
    if (!u) {
      if (existing?.linkedUserId === uid) {
        return {
          linkedUserId: uid,
          linkedUserDisplayName: existing.linkedUserDisplayName,
          linkedUserDisplayEmail: existing.linkedUserDisplayEmail,
          linkedUserAccessSummary: existing.linkedUserAccessSummary,
        };
      }
      return {
        linkedUserId: uid,
        linkedUserDisplayName: deleteField(),
        linkedUserDisplayEmail: deleteField(),
        linkedUserAccessSummary: deleteField(),
      };
    }
    const lines = buildUserAccessSummaryLines(u);
    return {
      linkedUserId: uid,
      linkedUserDisplayName: u.displayName?.trim() || deleteField(),
      linkedUserDisplayEmail: u.email?.trim() || deleteField(),
      linkedUserAccessSummary: lines.length ? lines : deleteField(),
    };
  };

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

    const userLinkPatch = buildUserLinkFirestorePatch();

    setSubmitting(true);
    const now = Date.now();
    try {
      if (isNew) {
        const { code } = await generateNextDocumentCode(firestore, 'executive_payroll_staff', {
          actor: currentUser.displayName,
        });
        const newRef = doc(collection(firestore, 'executive_payroll_staff'));
        const basePayload: Record<string, unknown> = {
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
          nationalId: form.nationalId?.trim() || undefined,
          taxId: form.taxId?.trim() || undefined,
          address: form.address?.trim() || undefined,
          bankName: form.bankName?.trim() || undefined,
          bankAccountNumber: form.bankAccountNumber?.trim() || undefined,
          createdAt: now,
          updatedAt: now,
          createdBy: currentUser.displayName,
          updatedBy: currentUser.id,
          ...userLinkPatch,
        };
        await setDoc(newRef, sanitizeFirestorePayload(basePayload));
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
            nationalId: form.nationalId?.trim() || undefined,
            taxId: form.taxId?.trim() || undefined,
            address: form.address?.trim() || undefined,
            bankName: form.bankName?.trim() || undefined,
            bankAccountNumber: form.bankAccountNumber?.trim() || undefined,
            updatedAt: now,
            updatedBy: currentUser.id,
            ...userLinkPatch,
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

  const saveDisabled = submitting || (isNew ? !canSaveNew : !canSaveEdit);

  return (
    <AppShell user={currentUser as User} onLogout={() => {}}>
      <div className="mx-auto max-w-5xl space-y-6">
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

        <Tabs defaultValue="employment" className="w-full">
          <TabsList className="flex flex-wrap w-full md:w-fit h-auto gap-1 bg-muted/50 p-1">
            <TabsTrigger value="employment" className="gap-2 py-2 px-6">
              <Briefcase className="h-4 w-4" />
              ข้อมูลการจ้างและเงินเดือน
            </TabsTrigger>
            <TabsTrigger value="system" className="gap-2 py-2 px-6">
              <ShieldCheck className="h-4 w-4" />
              การเชื่อมโยง (System)
            </TabsTrigger>
          </TabsList>

          <TabsContent value="employment" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">ข้อมูลการจ้างและเงินเดือน</CardTitle>
                <CardDescription>ฐานเงินเดือนและสถานะ — บันทึกด้วยปุ่มด้านบน</CardDescription>
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

                <div className="rounded-lg border border-dashed border-primary/25 bg-primary/[0.03] p-4 space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-primary">ข้อมูลสำหรับเอกสารหัก ณ ที่จ่าย (ภงด.)</p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      ข้อมูลที่กรอกในส่วนนี้จะถูกใช้ก่อน — ถ้าเว้นว่าง ระบบจะพยายามดึงจากทะเบียน office_staff เมื่อมีการอ้างอิงด้านล่าง
                    </p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="exec-national-id">เลขบัตรประชาชน</Label>
                      <Input
                        id="exec-national-id"
                        inputMode="numeric"
                        autoComplete="off"
                        className="font-mono"
                        placeholder="เช่น 1 2345 67890 12 1"
                        value={form.nationalId ?? ''}
                        onChange={(e) => setForm({ ...form, nationalId: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="exec-tax-id">เลขประจำตัวผู้เสียภาษี (ถ้ามี)</Label>
                      <Input
                        id="exec-tax-id"
                        className="font-mono"
                        placeholder="กรณีใช้เลขนิติบุคคลแทนบัตรประชาชน"
                        value={form.taxId ?? ''}
                        onChange={(e) => setForm({ ...form, taxId: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="exec-address">ที่อยู่ (ตามบัตร / สำหรับพิมพ์ใบหัก ณ ที่จ่าย)</Label>
                      <Textarea
                        id="exec-address"
                        rows={3}
                        placeholder="บ้านเลขที่ ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด รหัสไปรษณีย์"
                        value={form.address ?? ''}
                        onChange={(e) => setForm({ ...form, address: e.target.value })}
                      />
                    </div>
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
                  <p className="text-[11px] text-muted-foreground">
                    ถ้าไม่กรอกเลขบัตร/ที่อยู่ในทะเบียนผู้บริหารด้านบน ระบบจะดึงจากทะเบียน office_staff แทน (เมื่อกรอก Document ID ที่นี่)
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>หมายเหตุ</Label>
                  <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="system" className="mt-6">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <Card className="shadow-sm">
                <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0 border-b bg-primary/5">
                  <CardTitle className="flex items-center gap-2 text-lg text-primary">
                    <ShieldCheck className="h-5 w-5" /> การเชื่อมโยง (Integration)
                  </CardTitle>
                  {canAdminUserLink ? (
                    <Button
                      type="button"
                      variant={integrationEditMode ? 'secondary' : 'outline'}
                      size="sm"
                      className="shrink-0 gap-1"
                      onClick={() => setIntegrationEditMode((v) => !v)}
                    >
                      <Pencil className="h-4 w-4" />
                      {integrationEditMode ? 'เสร็จสิ้น' : 'แก้ไข'}
                    </Button>
                  ) : null}
                </CardHeader>
                <CardContent className="space-y-6 pt-6">
                  <div className="space-y-2">
                    <Label className="font-bold">เชื่อมโยงกับบัญชีผู้ใช้ (Linked User)</Label>
                    {canAdminUserLink && integrationEditMode ? (
                      <Select
                        value={form.linkedUserId?.trim() ? form.linkedUserId : '__none__'}
                        onValueChange={(v) =>
                          setForm({
                            ...form,
                            linkedUserId: v === '__none__' ? '' : v,
                          })
                        }
                      >
                        <SelectTrigger className="h-11">
                          <SelectValue placeholder="เลือกบัญชีที่ลิงก์กัน..." />
                        </SelectTrigger>
                        <SelectContent className="max-h-72">
                          <SelectItem value="__none__">ไม่เชื่อมโยง (None)</SelectItem>
                          {allUsers?.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.displayName} ({u.email})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <div className="rounded-md border bg-muted/40 px-3 py-2.5 text-sm">
                        {form.linkedUserId?.trim() ? (
                          <>
                            <p className="font-medium">
                              {form.linkedUserDisplayName?.trim() || form.linkedUserId}
                            </p>
                            <p className="break-all text-xs text-muted-foreground">
                              {form.linkedUserDisplayEmail?.trim() || `UID: ${form.linkedUserId}`}
                            </p>
                          </>
                        ) : (
                          <span className="text-muted-foreground">ยังไม่ผูกบัญชีผู้ใช้</span>
                        )}
                      </div>
                    )}
                    {canAdminUserLink && !integrationEditMode ? (
                      <p className="text-[11px] text-muted-foreground">
                        กด «แก้ไข» เพื่อเปลี่ยนบัญชีที่ผูก — บันทึกด้วยปุ่มด้านบนของหน้า
                      </p>
                    ) : null}
                    {!canAdminUserLink ? (
                      <p className="text-[11px] text-muted-foreground">
                        เฉพาะผู้ดูแลระบบสามารถเปลี่ยนการผูกบัญชีผู้ใช้ได้ (เหมือนทะเบียนพนักงานออฟฟิศ)
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <Label className="font-bold">สิทธิ์บัญชีที่ผูก</Label>
                    <div className="min-h-[4rem] space-y-1.5 rounded-md border bg-muted/20 px-3 py-2.5 text-sm">
                      {integrationAccessLines.length === 0 ? (
                        <span className="text-muted-foreground">
                          {form.linkedUserId?.trim()
                            ? '— (โหลดสิทธิ์จาก users หรือ snapshot หลังบันทึก)'
                            : '—'}
                        </span>
                      ) : (
                        integrationAccessLines.map((line, i) => (
                          <p key={`${line}-${i}`} className="leading-snug">
                            {line}
                          </p>
                        ))
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-muted/20 shadow-sm">
                <CardHeader className="border-b pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
                    <History className="h-4 w-4" /> ประวัติระบบ (System History)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 pt-4 text-xs">
                  {isNew ? (
                    <p className="text-muted-foreground">บันทึกรายการก่อน จึงจะแสดงวันที่สร้างและผู้บันทึก</p>
                  ) : (
                    <>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">สร้างเมื่อ (Created At):</span>
                        <span>{existing?.createdAt ? formatDateTimeThaiBE(existing.createdAt) : '-'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">ลงบันทึกโดย (Created By):</span>
                        <span>{existing?.createdBy || '-'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">แก้ไขล่าสุด (Last Update):</span>
                        <span>{existing?.updatedAt ? formatDateTimeThaiBE(existing.updatedAt) : '-'}</span>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
