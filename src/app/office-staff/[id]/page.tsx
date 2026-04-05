'use client';

import { useState, use, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { Input } from '@/components/ui/input';
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue, formatDateTimeThaiBE } from '@/lib/date-thai';
import { Label } from '@/components/ui/label';
import { 
  ArrowLeft, 
  Save, 
  Loader2, 
  UserSearch,
  Building2,
  CreditCard,
  Briefcase,
  History,
  ShieldCheck,
  Info,
  UserCircle,
  Receipt
} from 'lucide-react';
import { OfficeStaffPayslipHistory } from '@/components/payroll/office-staff-payslip-history';
import { useFirestore, useDoc, useMemoFirebase, useUser, useCollection } from '@/firebase';
import {
  isSystemAdmin,
  isOperationsPillarExecutive,
  canViewPayrollPerFirestoreRules,
  canEditEmployeeCompensation,
} from '@/lib/permission-core';
import { doc, collection, setDoc, updateDoc } from 'firebase/firestore';
import { OfficeStaff, User, StaffStatus, EmploymentType, StaffSalaryType, Position } from '@/lib/types';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';

/** Preset แผนก — รวมกับค่าที่ดึงจาก office_staff ที่มีอยู่ */
const STANDARD_OFFICE_DEPARTMENTS: { value: string; label: string }[] = [
  { value: 'Administration', label: 'บริหาร (Administration)' },
  { value: 'HR', label: 'ทรัพยากรบุคคล (HR)' },
  { value: 'Accounting', label: 'บัญชี (Accounting)' },
  { value: 'Finance', label: 'การเงิน (Finance)' },
  { value: 'IT', label: 'เทคโนโลยีสารสนเทศ (IT)' },
  { value: 'Operations', label: 'ปฏิบัติการ (Operations)' },
  { value: 'Sales', label: 'งานขาย (Sales)' },
  { value: 'Store', label: 'คลัง / จัดซื้อ (Store)' },
  { value: 'Legal', label: 'กฎหมาย (Legal)' },
  { value: 'QA', label: 'ควบคุมคุณภาพ (QA)' },
];
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Link from 'next/link';
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';
import { sanitizeFirestorePayload } from '@/lib/utils';
import { useAppUser } from '@/hooks/use-app-user';
import { canView, canCreate, canEdit } from '@/lib/permissions';
import { sortPositionsByDisplayName } from '@/lib/position-display';

export default function OfficeStaffDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const isNew = id === 'new';
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const canViewOfficeStaff = useMemo(() => canView(currentUser, 'office_staff'), [currentUser]);
  const canCreateOfficeStaff = useMemo(() => canCreate(currentUser, 'office_staff'), [currentUser]);
  const canEditOfficeStaff = useMemo(() => canEdit(currentUser, 'office_staff'), [currentUser]);
  const canOpenPayslipTab = useMemo(() => canViewPayrollPerFirestoreRules(currentUser), [currentUser]);
  const canEditMoneyFields = useMemo(() => canEditEmployeeCompensation(currentUser), [currentUser]);

  const staffRef = useMemoFirebase(() => (firestore && !isNew && canViewOfficeStaff ? doc(firestore, 'office_staff', id) : null), [firestore, id, isNew, canViewOfficeStaff]);
  const { data: staffData, isLoading: isStaffLoading } = useDoc<OfficeStaff>(staffRef as any);

  // users list: Firestore rules allow list only for canManageSystem (admin)
  const usersQuery = useMemoFirebase(() => {
    const canListUsers =
      !!currentUser && (isSystemAdmin(currentUser) || isOperationsPillarExecutive(currentUser));
    if (!firestore || !canListUsers || !canViewOfficeStaff) return null;
    return collection(firestore, 'users');
  }, [firestore, currentUser, canViewOfficeStaff]);
  const { data: allUsers } = useCollection<User>(usersQuery as any);

  const staffQuery = useMemoFirebase(() => (firestore && canViewOfficeStaff ? collection(firestore, 'office_staff') : null), [firestore, canViewOfficeStaff]);
  const { data: allOfficeStaff } = useCollection<OfficeStaff>(staffQuery as any);

  const positionsQuery = useMemoFirebase(() => (firestore && canViewOfficeStaff ? collection(firestore, 'positions') : null), [firestore, canViewOfficeStaff]);
  const { data: allPositions } = useCollection<Position>(positionsQuery as any);

  const officeCategoryPositions = useMemo(
    () =>
      sortPositionsByDisplayName(
        (allPositions || []).filter((p) => p.category === 'OFFICE' && p.active !== false)
      ),
    [allPositions]
  );

  const [formData, setFormData] = useState<Partial<OfficeStaff>>({
    staffCode: isNew ? getPreviewPattern('office_staff') : '',
    fullName: '',
    nickname: '',
    department: '',
    positionId: undefined,
    positionTitle: '',
    employmentType: 'FULL_TIME',
    salaryType: 'MONTHLY',
    monthlySalary: 0,
    startDate: timestampToHtmlDateValue(Date.now()),
    bankAccountName: '',
    bankAccountNumber: '',
    bankName: '',
    taxId: '',
    socialSecurityNo: '',
    status: 'ACTIVE',
    payrollBand: 'OFFICE',
    notes: ''
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  const departmentOptions = useMemo(() => {
    const s = new Set<string>();
    for (const row of allOfficeStaff || []) {
      const d = (row.department || '').trim();
      if (d) s.add(d);
    }
    for (const { value } of STANDARD_OFFICE_DEPARTMENTS) s.add(value);
    const cur = (formData.department || '').trim();
    if (cur) s.add(cur);
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'th'));
  }, [allOfficeStaff, formData.department]);

  const departmentLabel = (value: string) =>
    STANDARD_OFFICE_DEPARTMENTS.find((x) => x.value === value)?.label ?? value;

  useEffect(() => {
    if (staffData) {
      setFormData(staffData);
    }
  }, [staffData]);

  const handleSave = async () => {
    if ((isNew && !canCreateOfficeStaff) || (!isNew && !canEditOfficeStaff)) {
      toast({ variant: "destructive", title: "ไม่มีสิทธิ์", description: "คุณไม่มีสิทธิ์บันทึกข้อมูลพนักงานออฟฟิศ" });
      return;
    }
    if (!firestore || !currentUser) return;
    if (!formData.fullName?.trim() || !formData.department?.trim()) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาระบุชื่อ และแผนก" });
      return;
    }
    const posById = formData.positionId
      ? officeCategoryPositions.find((x: Position) => x.id === formData.positionId)
      : undefined;
    const resolvedPositionTitle = (posById?.positionName || posById?.positionNameTh || formData.positionTitle || '').trim();
    if (!resolvedPositionTitle) {
      toast({
        variant: "destructive",
        title: "ข้อมูลไม่ครบ",
        description: "กรุณาเลือกตำแหน่งจากรายการตำแหน่งงาน (หมวด Office)",
      });
      return;
    }
    const resolvedPositionId = posById ? posById.id : formData.positionId;

    setIsSubmitting(true);
    const now = Date.now();

    const compensationPatch =
      !canEditMoneyFields && !isNew && staffData
        ? {
            monthlySalary: staffData.monthlySalary,
            salaryType: staffData.salaryType,
            payrollBand: staffData.payrollBand ?? 'OFFICE',
          }
        : !canEditMoneyFields && isNew
          ? { monthlySalary: 0, salaryType: 'MONTHLY' as StaffSalaryType, payrollBand: 'OFFICE' as const }
          : {};

    try {
      if (isNew) {
        // Atomic Code Generation
        const { code: finalCode } = await generateNextDocumentCode(firestore, 'office_staff', { actor: currentUser.displayName });

        const newRef = doc(collection(firestore, 'office_staff'));
        await setDoc(
          newRef,
          sanitizeFirestorePayload({
            ...formData,
            ...compensationPatch,
            staffCode: finalCode,
            id: newRef.id,
            positionId: resolvedPositionId,
            positionTitle: resolvedPositionTitle,
            createdAt: now,
            createdBy: currentUser.displayName,
            updatedAt: now,
            updatedBy: currentUser.id,
          })
        );
        toast({ title: "เพิ่มพนักงานสำเร็จ", description: `รหัสพนักงาน: ${finalCode}` });
        router.push('/office-staff');
      } else {
        await updateDoc(
          staffRef!,
          sanitizeFirestorePayload({
            ...formData,
            ...compensationPatch,
            positionId: resolvedPositionId,
            positionTitle: resolvedPositionTitle,
            updatedAt: now,
            updatedBy: currentUser.id,
          })
        );
        toast({ title: "อัปเดตข้อมูลสำเร็จ" });
        router.back();
      }
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถบันทึกข้อมูลได้" });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (userLoading || !currentUser) return null;
  if (!canViewOfficeStaff) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-5xl mx-auto py-10 text-center text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงเมนูนี้</div>
      </AppShell>
    );
  }
  if (!isNew && isStaffLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="animate-spin h-12 w-12 text-primary" />
      </div>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.back()}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="space-y-2">
              <PayrollScopeTag scope="office" showHint={false} />
              <h1 className="text-2xl font-bold tracking-tight text-primary">
                {isNew ? 'ลงทะเบียนพนักงานออฟฟิศใหม่ (New Staff)' : `แก้ไขข้อมูลพนักงาน: ${formData.fullName}`}
              </h1>
              <p className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
                <Info className="h-4 w-4" /> <strong>Office Payroll</strong> — ฐานเงินเดือนรายเดือน ไม่ใช้ timesheet รายวัน
              </p>
            </div>
          </div>
          <Button
            className="gap-2 px-8 font-bold shadow-lg bg-primary h-11"
            onClick={handleSave}
            disabled={isSubmitting || (isNew ? !canCreateOfficeStaff : !canEditOfficeStaff)}
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isNew ? 'บันทึกพนักงาน (Save New)' : 'บันทึกการเปลี่ยนแปลง (Save)'}
          </Button>
        </div>

        <Tabs defaultValue="basic" className="w-full">
          <TabsList className="flex flex-wrap w-full md:w-fit h-auto p-1 bg-muted/50 gap-1">
            <TabsTrigger value="basic" className="gap-2 py-2 px-8"><Briefcase className="h-4 w-4" /> ข้อมูลทั่วไป (Profile)</TabsTrigger>
            <TabsTrigger value="financial" className="gap-2 py-2 px-8"><CreditCard className="h-4 w-4" /> ข้อมูลการเงิน (Finance)</TabsTrigger>
            <TabsTrigger value="admin" className="gap-2 py-2 px-8"><ShieldCheck className="h-4 w-4" /> การเชื่อมโยง (System)</TabsTrigger>
            <TabsTrigger
              value="payslips"
              className="gap-2 py-2 px-8"
              disabled={isNew || !canOpenPayslipTab}
              title={isNew ? undefined : !canOpenPayslipTab ? 'คุณไม่มีสิทธ์ในการทำรายการ' : undefined}
            >
              <Receipt className="h-4 w-4" /> สลิปเงินเดือน
            </TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="mt-6">
            <Card className="shadow-sm">
              <CardHeader className="bg-primary/5 border-b">
                <CardTitle className="text-lg flex items-center gap-2 text-primary">
                  <UserCircle className="h-5 w-5" /> ข้อมูลประวัติและตำแหน่ง (Job Profile)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6 pt-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <Label className="font-bold">รหัสพนักงาน (Staff Code) *</Label>
                    <Input 
                      value={formData.staffCode} 
                      disabled={isNew} 
                      onChange={e => setFormData({...formData, staffCode: e.target.value})} 
                      className={isNew ? "bg-muted font-mono font-bold text-primary" : ""}
                    />
                    {isNew && <p className="text-[10px] text-muted-foreground italic">* ระบบจะออกรหัสจริงให้อัตโนมัติเมื่อกดบันทึก</p>}
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label className="font-bold">ชื่อ-นามสกุล (Full Name) *</Label>
                    <Input value={formData.fullName} onChange={e => setFormData({...formData, fullName: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">ชื่อเล่น (Nickname)</Label>
                    <Input value={formData.nickname} onChange={e => setFormData({...formData, nickname: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">แผนก (Department) *</Label>
                    <Select
                      value={formData.department?.trim() ? formData.department : undefined}
                      onValueChange={(v) => setFormData({ ...formData, department: v })}
                    >
                      <SelectTrigger className="h-10">
                        <SelectValue placeholder="เลือกแผนก" />
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        {departmentOptions.map((d: string) => (
                          <SelectItem key={d} value={d}>
                            {departmentLabel(d)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground">
                      รวมค่าแผนกจากพนักงานที่ลงทะเบียนแล้วในระบบ และรายการแผนกมาตรฐาน
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">ตำแหน่ง (จากตำแหน่งงาน — หมวด Office) *</Label>
                    <Select
                      value={
                        formData.positionId ||
                        officeCategoryPositions.find(
                          (p: Position) =>
                            (p.positionName || p.positionNameTh) === formData.positionTitle ||
                            (p.positionName || p.positionNameEn) === formData.positionTitle
                        )?.id ||
                        undefined
                      }
                      onValueChange={(id) => {
                        const p = officeCategoryPositions.find((x: Position) => x.id === id);
                        setFormData({
                          ...formData,
                          positionId: id,
                          positionTitle: p ? (p.positionName || p.positionNameTh) : formData.positionTitle,
                        });
                      }}
                    >
                      <SelectTrigger className="h-10">
                        <SelectValue placeholder={officeCategoryPositions.length ? 'เลือกตำแหน่ง' : 'ยังไม่มีตำแหน่งหมวด Office — สร้างที่เมนูตำแหน่งงาน'} />
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        {formData.positionId &&
                        !officeCategoryPositions.some((p: Position) => p.id === formData.positionId) ? (
                          <SelectItem value={formData.positionId}>
                            {formData.positionTitle || formData.positionId}{' '}
                            <span className="text-muted-foreground text-xs">(ไม่อยู่ในรายการ Office ปัจจุบัน)</span>
                          </SelectItem>
                        ) : null}
                        {officeCategoryPositions.map((p: Position) => (
                          <SelectItem key={p.id} value={p.id}>
                            {`${p.positionCode} — ${p.positionName || p.positionNameTh}${p.positionNameEn ? ` (${p.positionName || p.positionNameEn})` : ''}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground">
                      ดึงจากเมนู <Link href="/positions" className="text-primary underline font-medium">ตำแหน่งงาน</Link> เฉพาะรายการที่หมวดเป็น Office และสถานะใช้งาน
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">ประเภทการจ้าง (Employment Type)</Label>
                    <Select onValueChange={(v: EmploymentType) => setFormData({...formData, employmentType: v})} value={formData.employmentType}>
                      <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="FULL_TIME">Full Time (ประจำ)</SelectItem>
                        <SelectItem value="PART_TIME">Part Time (ชั่วคราว)</SelectItem>
                        <SelectItem value="CONTRACT">Contract (ตามสัญญา)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">วันที่เริ่มงาน (Start Date)</Label>
                    <DatePickerThaiBE
                      className="h-10"
                      value={htmlDateValueToTimestampMs(formData.startDate)}
                      onChange={(ms) => setFormData({ ...formData, startDate: timestampToHtmlDateValue(ms) })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">สถานะ (Status)</Label>
                    <Select onValueChange={(v: StaffStatus) => setFormData({...formData, status: v})} value={formData.status}>
                      <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ACTIVE">ACTIVE (ปกติ)</SelectItem>
                        <SelectItem value="INACTIVE">INACTIVE (ระงับ)</SelectItem>
                        <SelectItem value="RESIGNED">RESIGNED (ลาออก)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="font-bold">หมายเหตุ (Notes)</Label>
                  <Textarea value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} className="min-h-[100px]" />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="financial" className="mt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="shadow-sm">
                <CardHeader className="bg-primary/5 border-b">
                  <CardTitle className="text-lg flex items-center gap-2 text-primary">
                    <CreditCard className="h-5 w-5" /> การจ่ายเงิน (Compensation)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 pt-6">
                  {!canEditMoneyFields && (
                    <p className="text-xs text-muted-foreground rounded-md border border-amber-200 bg-amber-50/80 p-2 dark:border-amber-900/50 dark:bg-amber-950/30">
                      แก้เงินเดือน / รูปแบบเงินเดือน / กลุ่มงวดจ่าย ได้เฉพาะ HR Manager หรือ Operation Manager (หรือ Admin)
                    </p>
                  )}
                  <div className="space-y-2">
                    <Label className="font-bold">รูปแบบเงินเดือน (Salary Type)</Label>
                    <Select
                      disabled={!canEditMoneyFields}
                      onValueChange={(v: StaffSalaryType) => setFormData({...formData, salaryType: v})}
                      value={formData.salaryType}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MONTHLY">รายเดือน (Monthly)</SelectItem>
                        <SelectItem value="DAILY">รายวัน (Daily)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">กลุ่มงวดเงินเดือน (Payroll band)</Label>
                    <Select
                      disabled={!canEditMoneyFields}
                      onValueChange={(v: 'OFFICE' | 'EXECUTIVE') => setFormData({ ...formData, payrollBand: v })}
                      value={formData.payrollBand ?? 'OFFICE'}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="OFFICE">พนักงานสำนักงาน (Office payroll / HR เห็นได้)</SelectItem>
                        <SelectItem value="EXECUTIVE">ผู้บริหาร (Executive — งวดจ่ายแยกในเมนูบัญชีเท่านั้น)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground">
                      ผู้บริหารจะไม่ถูกดึงเข้างวดเงินเดือนพนักงานสำนักงาน และต้องใช้เมนูเงินเดือนผู้บริหารในฝ่ายบัญชี
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">เงินเดือนพื้นฐาน (Monthly Salary)</Label>
                    <Input
                      type="number"
                      disabled={!canEditMoneyFields}
                      value={formData.monthlySalary}
                      onChange={(e) => setFormData({ ...formData, monthlySalary: parseFloat(e.target.value) || 0 })}
                      className="text-lg font-black text-primary"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">เลขผู้เสียภาษี (Tax ID)</Label>
                    <Input value={formData.taxId} onChange={e => setFormData({...formData, taxId: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">เลขประกันสังคม (SSO No.)</Label>
                    <Input value={formData.socialSecurityNo} onChange={e => setFormData({...formData, socialSecurityNo: e.target.value})} />
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardHeader className="bg-primary/5 border-b">
                  <CardTitle className="text-lg flex items-center gap-2 text-primary">
                    <Building2 className="h-5 w-5" /> บัญชีธนาคาร (Bank Details)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 pt-6">
                  <div className="space-y-2">
                    <Label className="font-bold">ชื่อธนาคาร (Bank Name)</Label>
                    <Input value={formData.bankName} onChange={e => setFormData({...formData, bankName: e.target.value})} placeholder="เช่น กสิกรไทย, ไทยพาณิชย์" />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">ชื่อบัญชี (Account Name)</Label>
                    <Input value={formData.bankAccountName} onChange={e => setFormData({...formData, bankAccountName: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">เลขที่บัญชี (Account No.)</Label>
                    <Input value={formData.bankAccountNumber} onChange={e => setFormData({...formData, bankAccountNumber: e.target.value})} placeholder="000-0-00000-0" />
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="admin" className="mt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="shadow-sm">
                <CardHeader className="bg-primary/5 border-b">
                  <CardTitle className="text-lg flex items-center gap-2 text-primary">
                    <ShieldCheck className="h-5 w-5" /> การเชื่อมโยง (Integration)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6 pt-6">
                  <div className="space-y-2">
                    <Label className="font-bold">เชื่อมโยงกับบัญชีผู้ใช้ (Linked User)</Label>
                    <Select onValueChange={v => setFormData({...formData, linkedUserId: v})} value={formData.linkedUserId}>
                      <SelectTrigger className="h-11">
                        <SelectValue placeholder="เลือกบัญชีล็อกอิน..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">ไม่เชื่อมโยง (None)</SelectItem>
                        {allUsers?.map(u => (
                          <SelectItem key={u.id} value={u.id}>{u.displayName} ({u.email})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="font-bold">ผู้บังคับบัญชา (Supervisor / Approver)</Label>
                    <Select onValueChange={v => setFormData({...formData, supervisorId: v})} value={formData.supervisorId}>
                      <SelectTrigger className="h-11">
                        <SelectValue placeholder="เลือกผู้อนุมัติลำดับที่ 1..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">ไม่มี (None)</SelectItem>
                        {allOfficeStaff?.filter(s => s.id !== id).map(s => (
                          <SelectItem key={s.id} value={s.id}>{s.fullName} ({s.positionTitle})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-sm bg-muted/20">
                <CardHeader className="pb-3 border-b">
                  <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <History className="h-4 w-4" /> ประวัติระบบ (System History)
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">สร้างเมื่อ (Created At):</span>
                    <span>{staffData?.createdAt ? formatDateTimeThaiBE(staffData.createdAt) : '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">ลงบันทึกโดย (Created By):</span>
                    <span>{staffData?.createdBy || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">แก้ไขล่าสุด (Last Update):</span>
                    <span>{staffData?.updatedAt ? formatDateTimeThaiBE(staffData.updatedAt) : '-'}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="payslips" className="mt-6">
            {isNew ? (
              <Card>
                <CardContent className="py-10 text-center text-muted-foreground text-sm">
                  บันทึกพนักงานก่อน จึงจะดูประวัติสลิปได้
                </CardContent>
              </Card>
            ) : (
              <OfficeStaffPayslipHistory staffId={id} currentUser={currentUser} />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
