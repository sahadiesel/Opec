'use client';

import { useState, use, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { Input } from '@/components/ui/input';
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue, formatDateTimeThaiBE } from '@/lib/date-thai';
import { Label } from '@/components/ui/label';
import { 
  ArrowLeft, 
  Save, 
  Loader2,
  Building2,
  CreditCard,
  Briefcase,
  History,
  ShieldCheck,
  Info,
  UserCircle,
  Receipt,
  Phone,
  MapPin,
  UsersRound,
  IdCard,
  Pencil,
  Clock,
} from 'lucide-react';
import { OfficeStaffPayslipHistory } from '@/components/payroll/office-staff-payslip-history';
import { useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import {
  isSystemAdmin,
  canViewPayrollPerFirestoreRules,
  canEditEmployeeCompensation,
} from '@/lib/permission-core';
import { doc, collection, setDoc, updateDoc, deleteField } from 'firebase/firestore';
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
import { useActiveBankNameCatalog, useActiveSsoHospitalCatalog } from '@/hooks/use-hrm-name-catalogs';
import { buildUserAccessSummaryLines } from '@/lib/hr/user-access-display';
import { SubjectAttendanceHistory } from '@/components/attendance/subject-attendance-history';
import {
  OFFICE_PAYROLL_TIME_DEDUCTION_BASIS_OPTIONS,
  officeStaffShowsTimeDeductionBasisField,
  type OfficePayrollTimeDeductionBasis,
} from '@/lib/payroll/office-staff-payroll-attendance-basis';

/** ตำแหน่งที่ผูกพนักงานออฟฟิศได้: หมวด Office ทั้งหมด หรือ Onshore/Offshore ที่ฐานเงินเดือนเป็นรายเดือน (เช่น Construction Manager) — ไม่ดึงคนงานรายวัน (DAILY/HOURLY) ทั้งแผง */
function positionEligibleForOfficeStaff(p: Position): boolean {
  if (p.active === false) return false;
  if (p.category === 'OFFICE') return true;
  if (p.payrollBasis === 'MONTHLY' && (p.category === 'ONSHORE' || p.category === 'OFFSHORE')) return true;
  return false;
}

type OfficePaymentKind = 'MONTHLY' | 'DAILY' | 'MONTHLY_NO_ATT' | 'NONE';

function paymentKindFromStaff(f: Partial<OfficeStaff>): OfficePaymentKind {
  if (f.excludeFromPayrollRuns) return 'NONE';
  if (f.salaryType === 'DAILY') return 'DAILY';
  if (f.salaryType === 'MONTHLY' && f.monthlyAttendanceExempt) return 'MONTHLY_NO_ATT';
  return 'MONTHLY';
}

function staffPatchForPaymentKind(kind: OfficePaymentKind, f: Partial<OfficeStaff>): Partial<OfficeStaff> {
  switch (kind) {
    case 'NONE':
      return { ...f, excludeFromPayrollRuns: true, salaryType: 'MONTHLY', monthlyAttendanceExempt: false };
    case 'DAILY':
      return { ...f, excludeFromPayrollRuns: false, salaryType: 'DAILY', monthlyAttendanceExempt: false };
    case 'MONTHLY_NO_ATT':
      return { ...f, excludeFromPayrollRuns: false, salaryType: 'MONTHLY', monthlyAttendanceExempt: true };
    default:
      return { ...f, excludeFromPayrollRuns: false, salaryType: 'MONTHLY', monthlyAttendanceExempt: false };
  }
}

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

  const canAdminUserLink = useMemo(() => !!currentUser && isSystemAdmin(currentUser), [currentUser]);

  /** รายชื่อ users สำหรับ dropdown ผูกบัญชี — เฉพาะผู้ดูแลระบบ (ตามสเปค) */
  const usersQuery = useMemoFirebase(() => {
    if (!firestore || !canAdminUserLink || !canViewOfficeStaff) return null;
    return collection(firestore, 'users');
  }, [firestore, canAdminUserLink, canViewOfficeStaff]);
  const { data: allUsers } = useCollection<User>(usersQuery as any);

  const staffQuery = useMemoFirebase(() => (firestore && canViewOfficeStaff ? collection(firestore, 'office_staff') : null), [firestore, canViewOfficeStaff]);
  const { data: allOfficeStaff } = useCollection<OfficeStaff>(staffQuery as any);

  const positionsQuery = useMemoFirebase(() => (firestore && canViewOfficeStaff ? collection(firestore, 'positions') : null), [firestore, canViewOfficeStaff]);
  const { data: allPositions } = useCollection<Position>(positionsQuery as any);

  const activeBankCatalog = useActiveBankNameCatalog();
  const activeHospitalCatalog = useActiveSsoHospitalCatalog();

  const officeCategoryPositions = useMemo(
    () => sortPositionsByDisplayName((allPositions || []).filter(positionEligibleForOfficeStaff)),
    [allPositions],
  );

  const [formData, setFormData] = useState<Partial<OfficeStaff>>({
    staffCode: isNew ? getPreviewPattern('office_staff') : '',
    fullName: '',
    nickname: '',
    phone: '',
    department: '',
    positionId: undefined,
    positionTitle: '',
    employmentType: 'FULL_TIME',
    salaryType: 'MONTHLY',
    monthlySalary: 0,
    dailyWage: 0,
    monthlyAttendanceExempt: false,
    officePayrollTimeDeductionBasis: 'SCAN',
    excludeFromPayrollRuns: false,
    startDate: timestampToHtmlDateValue(Date.now()),
    employmentEndDate: '',
    nationalId: '',
    address: '',
    emergencyContactName: '',
    emergencyContactRelation: '',
    emergencyContactPhone: '',
    bankAccountName: '',
    bankAccountNumber: '',
    bankName: '',
    taxId: '',
    socialSecurityNo: '',
    socialSecurityStatus: 'ENROLLED',
    socialSecurityHospital: '',
    status: 'ACTIVE',
    payrollBand: 'OFFICE',
    notes: '',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [integrationEditMode, setIntegrationEditMode] = useState(false);

  const linkedUserDocRef = useMemoFirebase(
    () =>
      firestore && !isNew && formData.linkedUserId?.trim() && canAdminUserLink
        ? doc(firestore, 'users', formData.linkedUserId.trim())
        : null,
    [firestore, isNew, formData.linkedUserId, canAdminUserLink],
  );
  const { data: linkedUserFromFirestore } = useDoc<User>(linkedUserDocRef as any);

  const integrationAccessLines = useMemo(() => {
    const uid = formData.linkedUserId?.trim();
    if (!uid) return [] as string[];
    const u =
      linkedUserFromFirestore ??
      (allUsers?.find((x) => x.id === uid) as User | undefined);
    if (u) return buildUserAccessSummaryLines(u);
    if (formData.linkedUserAccessSummary?.length) return formData.linkedUserAccessSummary;
    return [] as string[];
  }, [
    formData.linkedUserId,
    formData.linkedUserAccessSummary,
    linkedUserFromFirestore,
    allUsers,
  ]);

  const selectedPosition = useMemo(() => {
    const pid = formData.positionId;
    if (!pid || !allPositions?.length) return undefined;
    return allPositions.find((p) => p.id === pid);
  }, [formData.positionId, allPositions]);

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
        description: 'กรุณาเลือกตำแหน่งจากรายการตำแหน่งงาน (Office หรือสายสนามแบบรายเดือน)',
      });
      return;
    }
    const resolvedPositionId = posById ? posById.id : formData.positionId;

    setIsSubmitting(true);
    const now = Date.now();

    const buildUserLinkFirestorePatch = (): Record<string, unknown> => {
      if (!isSystemAdmin(currentUser)) {
        if (isNew) return {};
        return {
          linkedUserId: staffData?.linkedUserId,
          linkedUserDisplayName: staffData?.linkedUserDisplayName,
          linkedUserDisplayEmail: staffData?.linkedUserDisplayEmail,
          linkedUserAccessSummary: staffData?.linkedUserAccessSummary,
        };
      }
      const uid = (formData.linkedUserId || '').trim();
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
        if (!isNew && staffData?.linkedUserId === uid) {
          return {
            linkedUserId: uid,
            linkedUserDisplayName: staffData.linkedUserDisplayName,
            linkedUserDisplayEmail: staffData.linkedUserDisplayEmail,
            linkedUserAccessSummary: staffData.linkedUserAccessSummary,
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

    const userLinkPatch = buildUserLinkFirestorePatch();
    const {
      supervisorId: _discardSupervisor,
      linkedUserId: _stripLk,
      linkedUserDisplayName: _stripLn,
      linkedUserDisplayEmail: _stripLe,
      linkedUserAccessSummary: _stripLs,
      ...formBody
    } = formData as Partial<OfficeStaff> & { supervisorId?: string };

    const compensationPatch =
      !canEditMoneyFields && !isNew && staffData
        ? {
            monthlySalary: staffData.monthlySalary,
            salaryType: staffData.salaryType,
            payrollBand: staffData.payrollBand ?? 'OFFICE',
            dailyWage: staffData.dailyWage,
            monthlyAttendanceExempt: staffData.monthlyAttendanceExempt,
            officePayrollTimeDeductionBasis: staffData.officePayrollTimeDeductionBasis ?? 'SCAN',
            excludeFromPayrollRuns: staffData.excludeFromPayrollRuns,
          }
        : !canEditMoneyFields && isNew
          ? {
              monthlySalary: 0,
              dailyWage: 0,
              salaryType: 'MONTHLY' as StaffSalaryType,
              payrollBand: 'OFFICE' as const,
              monthlyAttendanceExempt: false,
              officePayrollTimeDeductionBasis: 'SCAN' as const,
              excludeFromPayrollRuns: false,
            }
          : {};

    const attendanceBasisPatch =
      !canAdminUserLink && !isNew && staffData
        ? { officePayrollTimeDeductionBasis: staffData.officePayrollTimeDeductionBasis ?? 'SCAN' }
        : !canAdminUserLink && isNew
          ? { officePayrollTimeDeductionBasis: 'SCAN' as const }
          : {};

    try {
      if (isNew) {
        // Atomic Code Generation
        const { code: finalCode } = await generateNextDocumentCode(firestore, 'office_staff', { actor: currentUser.displayName });

        const newRef = doc(collection(firestore, 'office_staff'));
        await setDoc(
          newRef,
          sanitizeFirestorePayload({
            ...formBody,
            ...compensationPatch,
            ...attendanceBasisPatch,
            ...userLinkPatch,
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
            ...formBody,
            staffCode: staffData!.staffCode,
            ...compensationPatch,
            ...attendanceBasisPatch,
            ...userLinkPatch,
            supervisorId: deleteField(),
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
            <TabsTrigger value="attendance" className="gap-2 py-2 px-8" disabled={isNew}>
              <Clock className="h-4 w-4" /> ประวัติลงเวลา (Kiosk)
            </TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="mt-6 space-y-6">
            <Card className="shadow-sm overflow-hidden">
              <CardHeader className="bg-primary/5 border-b">
                <CardTitle className="text-lg flex items-center gap-2 text-primary">
                  <UserCircle className="h-5 w-5" /> ข้อมูลบัญชีและตำแหน่ง
                </CardTitle>
                <CardDescription>รหัสพนักงานและรหัสตำแหน่งจากระบบ — ชื่อ แผนก และตำแหน่งงานจากทะเบียน</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 pt-6">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6">
                  <div className="md:col-span-4 space-y-2">
                    <Label className="font-bold">รหัสพนักงาน (Staff Code) *</Label>
                    <Input
                      value={formData.staffCode ?? ''}
                      readOnly
                      aria-readonly="true"
                      autoComplete="off"
                      className="bg-muted font-mono font-bold text-primary cursor-not-allowed"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      {isNew
                        ? 'ระบบออกรหัสเมื่อบันทึก — แก้เองไม่ได้'
                        : 'ออกโดยระบบ — แก้ไม่ได้'}
                    </p>
                  </div>
                  <div className="md:col-span-8 space-y-2">
                    <Label className="font-bold">ชื่อ-นามสกุล (Full Name) *</Label>
                    <Input value={formData.fullName} onChange={(e) => setFormData({ ...formData, fullName: e.target.value })} />
                  </div>
                  <div className="md:col-span-4 space-y-2">
                    <Label className="font-bold flex items-center gap-2">
                      <Phone className="h-3.5 w-3.5" /> เบอร์โทร
                    </Label>
                    <Input
                      value={formData.phone ?? ''}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      placeholder="0xx-xxx-xxxx"
                      inputMode="tel"
                    />
                  </div>
                  <div className="md:col-span-4 space-y-2">
                    <Label className="font-bold">ชื่อเล่น (Nickname)</Label>
                    <Input value={formData.nickname ?? ''} onChange={(e) => setFormData({ ...formData, nickname: e.target.value })} />
                  </div>
                  <div className="md:col-span-4 space-y-2">
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
                  </div>
                  <div className="md:col-span-8 space-y-2">
                    <Label className="font-bold">ตำแหน่งงาน (จากทะเบียน) *</Label>
                    <div className="flex flex-col sm:flex-row gap-2">
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
                        onValueChange={(pid) => {
                          const p = officeCategoryPositions.find((x: Position) => x.id === pid);
                          setFormData({
                            ...formData,
                            positionId: pid,
                            positionTitle: p ? (p.positionName || p.positionNameTh) : formData.positionTitle,
                          });
                        }}
                      >
                        <SelectTrigger className="h-10 flex-1">
                          <SelectValue
                            placeholder={
                              officeCategoryPositions.length
                                ? 'เลือกตำแหน่ง'
                                : 'ยังไม่มีตำแหน่งที่เข้าเงื่อนไข — ตรวจที่เมนูตำแหน่งงาน'
                            }
                          />
                        </SelectTrigger>
                        <SelectContent className="max-h-72">
                          {formData.positionId &&
                          !officeCategoryPositions.some((p: Position) => p.id === formData.positionId) ? (
                            <SelectItem value={formData.positionId}>
                              {formData.positionTitle || formData.positionId}{' '}
                              <span className="text-muted-foreground text-xs">(ไม่อยู่ในรายการที่เลือกได้ตอนนี้)</span>
                            </SelectItem>
                          ) : null}
                          {officeCategoryPositions.map((p: Position) => (
                            <SelectItem key={p.id} value={p.id}>
                              {`${p.positionCode} — ${p.positionName || p.positionNameTh}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        readOnly
                        value={selectedPosition?.positionCode ?? '—'}
                        className="h-10 w-full sm:w-36 shrink-0 bg-muted font-mono text-sm font-bold text-primary cursor-not-allowed"
                        title="รหัสตำแหน่ง (Position Code)"
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      ทะเบียน{' '}
                      <Link href="/positions" className="text-primary underline font-medium">
                        ตำแหน่งงาน
                      </Link>{' '}
                      — Office หรือสายสนามจ่ายรายเดือน
                    </p>
                  </div>
                  <div className="md:col-span-4 space-y-2">
                    <Label className="font-bold">ประเภทการจ้าง</Label>
                    <Select
                      onValueChange={(v: EmploymentType) => setFormData({ ...formData, employmentType: v })}
                      value={formData.employmentType}
                    >
                      <SelectTrigger className="h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="FULL_TIME">Full Time (ประจำ)</SelectItem>
                        <SelectItem value="PART_TIME">Part Time (ชั่วคราว)</SelectItem>
                        <SelectItem value="CONTRACT">Contract (ตามสัญญา)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="md:col-span-4 space-y-2">
                    <Label className="font-bold">วันที่เริ่มงาน</Label>
                    <DatePickerThaiBE
                      className="h-10"
                      value={htmlDateValueToTimestampMs(formData.startDate)}
                      onChange={(ms) => setFormData({ ...formData, startDate: timestampToHtmlDateValue(ms) })}
                    />
                  </div>
                  <div className="md:col-span-4 space-y-2">
                    <Label className="font-bold">วันที่สิ้นสุดการจ้าง</Label>
                    <DatePickerThaiBE
                      className="h-10"
                      placeholder="ยังไม่ระบุ"
                      allowClear
                      onClear={() => setFormData({ ...formData, employmentEndDate: '' })}
                      value={
                        formData.employmentEndDate
                          ? htmlDateValueToTimestampMs(formData.employmentEndDate)
                          : undefined
                      }
                      onChange={(ms) =>
                        setFormData({
                          ...formData,
                          employmentEndDate: ms ? timestampToHtmlDateValue(ms) : '',
                        })
                      }
                    />
                    <p className="text-[10px] text-muted-foreground">เว้นว่างได้ถ้ายังไม่มีวันสิ้นสุด</p>
                  </div>
                  <div className="md:col-span-4 space-y-2">
                    <Label className="font-bold">สถานะ (Status)</Label>
                    <Select onValueChange={(v: StaffStatus) => setFormData({ ...formData, status: v })} value={formData.status}>
                      <SelectTrigger className="h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ACTIVE">ACTIVE (ปกติ)</SelectItem>
                        <SelectItem value="INACTIVE">INACTIVE (ระงับ)</SelectItem>
                        <SelectItem value="RESIGNED">RESIGNED (ลาออก)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm overflow-hidden">
              <CardHeader className="bg-muted/40 border-b">
                <CardTitle className="text-base flex items-center gap-2">
                  <IdCard className="h-5 w-5 text-primary" /> ข้อมูลส่วนตัว
                </CardTitle>
                <CardDescription>เลขบัตรประชาชนและที่อยู่ติดต่อ</CardDescription>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                <div className="space-y-2">
                  <Label className="font-bold">เลขบัตรประชาชน (National ID)</Label>
                  <Input
                    value={formData.nationalId ?? ''}
                    onChange={(e) => setFormData({ ...formData, nationalId: e.target.value })}
                    placeholder="x-xxxx-xxxxx-xx-x"
                    className="font-mono"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="font-bold flex items-center gap-2">
                    <MapPin className="h-3.5 w-3.5" /> ที่อยู่
                    <span className="text-[10px] font-normal text-amber-700 dark:text-amber-400">(จำเป็นสำหรับงวดเงินเดือน/ภงด.1)</span>
                  </Label>
                  <Textarea
                    value={formData.address ?? ''}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="min-h-[88px]"
                    placeholder="บ้านเลขที่ ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด รหัสไปรษณีย์"
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm overflow-hidden">
              <CardHeader className="bg-muted/40 border-b">
                <CardTitle className="text-base flex items-center gap-2">
                  <UsersRound className="h-5 w-5 text-primary" /> ผู้ติดต่อฉุกเฉิน
                </CardTitle>
                <CardDescription>กรณีฉุกเฉินหรือติดต่อสำรอง</CardDescription>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label className="font-bold">ชื่อ</Label>
                    <Input
                      value={formData.emergencyContactName ?? ''}
                      onChange={(e) => setFormData({ ...formData, emergencyContactName: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">ความสัมพันธ์</Label>
                    <Input
                      value={formData.emergencyContactRelation ?? ''}
                      onChange={(e) => setFormData({ ...formData, emergencyContactRelation: e.target.value })}
                      placeholder="เช่น บิดา, คู่สมรส"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">เบอร์โทร</Label>
                    <Input
                      value={formData.emergencyContactPhone ?? ''}
                      onChange={(e) => setFormData({ ...formData, emergencyContactPhone: e.target.value })}
                      inputMode="tel"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm overflow-hidden">
              <CardHeader className="bg-muted/40 border-b">
                <CardTitle className="text-base">หมายเหตุทั่วไป</CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <Textarea
                  value={formData.notes ?? ''}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="min-h-[100px]"
                  placeholder="บันทึกเพิ่มเติมที่เกี่ยวกับพนักงานท่านนี้"
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="financial" className="mt-6 space-y-6">
            <Card className="shadow-sm overflow-hidden">
              <CardHeader className="bg-primary/5 border-b">
                <CardTitle className="text-lg flex items-center gap-2 text-primary">
                  <CreditCard className="h-5 w-5" /> ข้อมูลฝ่ายบุคคลและการจ่ายเงิน (HR / Payroll)
                </CardTitle>
                <CardDescription>ประเภทการจ่าย เงินเดือน/ค่าแรง ภาษี และประกันสังคม</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 pt-6">
                {!canEditMoneyFields && (
                  <p className="text-xs rounded-md border border-amber-200 bg-amber-50/80 p-3 dark:border-amber-900/50 dark:bg-amber-950/30">
                    แก้ยอดเงิน ประเภทการจ่าย และกลุ่มงวดจ่าย ได้เฉพาะ HR Manager, Operations Manager, เจ้าหน้าที่เงินเดือน (Payroll) หรือ Admin
                  </p>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2 md:col-span-2">
                    <Label className="font-bold">ประเภทการจ่ายเงิน</Label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Select
                        disabled={!canEditMoneyFields}
                        value={paymentKindFromStaff(formData)}
                        onValueChange={(k: OfficePaymentKind) =>
                          setFormData(staffPatchForPaymentKind(k, formData) as Partial<OfficeStaff>)
                        }
                      >
                        <SelectTrigger className="h-11">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="MONTHLY">รายเดือน</SelectItem>
                          <SelectItem value="DAILY">รายวัน</SelectItem>
                          <SelectItem value="MONTHLY_NO_ATT">รายเดือน (ไม่อ้างอิงสแกน/เวลาเข้างาน)</SelectItem>
                          <SelectItem value="NONE">ไม่คิดเงินเดือนผ่านงวดออฟฟิศ (จ่ายนอกระบบ / ฝึกงาน ฯลฯ)</SelectItem>
                        </SelectContent>
                      </Select>
                      {officeStaffShowsTimeDeductionBasisField(formData) ? (
                        <div className="space-y-1">
                          <Select
                            disabled={!canAdminUserLink}
                            value={formData.officePayrollTimeDeductionBasis ?? 'SCAN'}
                            onValueChange={(v: OfficePayrollTimeDeductionBasis) =>
                              setFormData({ ...formData, officePayrollTimeDeductionBasis: v })
                            }
                          >
                            <SelectTrigger className="h-11">
                              <SelectValue placeholder="ฐานคิดสาย/ขาด" />
                            </SelectTrigger>
                            <SelectContent>
                              {OFFICE_PAYROLL_TIME_DEDUCTION_BASIS_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {!canAdminUserLink ? (
                            <p className="text-[11px] text-muted-foreground">
                              เฉพาะ Admin เปลี่ยนฐานคิดสาย/ขาดจากการสแกนได้
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <div className="flex h-11 items-center rounded-md border border-dashed px-3 text-xs text-muted-foreground">
                          ใช้กับพนักงานรายเดือนที่ยังอ้างอิงเวลาเข้างาน
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      ช่องขวา: &quot;คำนวนจากฐานเงินเดือน&quot; ไม่หักสาย/ขาดจากสแกน แต่ยังหักวันลา/ขาดที่บันทึกในระบบตามปกติ
                      — เลือก &quot;ไม่คิดเงินเดือนผ่านงวด…&quot; จะไม่ดึงเข้าศูนย์งานจ่ายเงินออฟฟิศอัตโนมัติ
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">กลุ่มงวดเงินเดือน (Payroll band)</Label>
                    <Select
                      disabled={!canEditMoneyFields}
                      onValueChange={(v: 'OFFICE' | 'EXECUTIVE') => setFormData({ ...formData, payrollBand: v })}
                      value={formData.payrollBand ?? 'OFFICE'}
                    >
                      <SelectTrigger className="h-11">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="OFFICE">พนักงานสำนักงาน (Office payroll)</SelectItem>
                        <SelectItem value="EXECUTIVE">
                          ผู้บริหาร (งวดจ่ายที่บัญชี — ทะเบียน «รายชื่อผู้บริหาร» แยกจากหน้านี้)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">รูปแบบในระบบ (Salary type)</Label>
                    <Input
                      readOnly
                      value={
                        formData.salaryType === 'DAILY'
                          ? 'รายวัน (DAILY)'
                          : 'รายเดือน (MONTHLY)'
                      }
                      className="h-11 bg-muted font-mono text-sm cursor-not-allowed"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">เงินเดือน (บาท/เดือน)</Label>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      disabled={!canEditMoneyFields}
                      value={formData.monthlySalary ?? 0}
                      onChange={(e) => setFormData({ ...formData, monthlySalary: parseFloat(e.target.value) || 0 })}
                      className="h-11 text-lg font-semibold text-primary"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">ค่าแรงรายวัน (บาท/วัน)</Label>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      disabled={!canEditMoneyFields}
                      value={formData.dailyWage ?? 0}
                      onChange={(e) => setFormData({ ...formData, dailyWage: parseFloat(e.target.value) || 0 })}
                      className="h-11"
                    />
                  </div>
                </div>
                <Separator />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label className="font-bold">เลขผู้เสียภาษี (Tax ID)</Label>
                    <Input
                      value={formData.taxId ?? ''}
                      onChange={(e) => setFormData({ ...formData, taxId: e.target.value })}
                      className="font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">เลขประกันสังคม (SSO No.)</Label>
                    <Input
                      value={formData.socialSecurityNo ?? ''}
                      onChange={(e) => setFormData({ ...formData, socialSecurityNo: e.target.value })}
                      className="font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">สิทธิ์ประกันสังคม</Label>
                    <Select
                      value={formData.socialSecurityStatus ?? 'ENROLLED'}
                      onValueChange={(v: 'ENROLLED' | 'EXEMPT') =>
                        setFormData({ ...formData, socialSecurityStatus: v })
                      }
                    >
                      <SelectTrigger className="h-11">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ENROLLED">ยื่นประกันสังคม</SelectItem>
                        <SelectItem value="EXEMPT">ไม่ยื่นประกันสังคม / ได้รับยกเว้น</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">โรงพยาบาลประกันสังคม</Label>
                    <Input
                      list="hrm-hospital-datalist-office"
                      value={formData.socialSecurityHospital ?? ''}
                      onChange={(e) => setFormData({ ...formData, socialSecurityHospital: e.target.value })}
                      placeholder="พิมพ์หรือเลือกจากรายการ"
                    />
                    <datalist id="hrm-hospital-datalist-office">
                      {activeHospitalCatalog.map((h) => (
                        <option key={h.id} value={h.nameTh} />
                      ))}
                    </datalist>
                    <p className="text-[11px] text-muted-foreground">
                      <Link href="/hr/hospital-registry" className="text-primary underline hover:no-underline">
                        จัดการทะเบียนโรงพยาบาล
                      </Link>
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm overflow-hidden">
              <CardHeader className="bg-muted/40 border-b">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-primary" /> บัญชีธนาคาร
                </CardTitle>
                <CardDescription>สำหรับโอนเงินเดือน — เลือกจากทะเบียนหรือพิมพ์ชื่อเอง</CardDescription>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2 md:col-span-1">
                    <Label className="font-bold">ชื่อธนาคาร</Label>
                    <Input
                      list="hrm-bank-datalist-office"
                      value={formData.bankName ?? ''}
                      onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
                      placeholder="พิมพ์หรือเลือกจากรายการ"
                    />
                    <datalist id="hrm-bank-datalist-office">
                      {activeBankCatalog.map((b) => (
                        <option key={b.id} value={b.nameTh} />
                      ))}
                    </datalist>
                    <p className="text-[11px] text-muted-foreground">
                      <Link href="/hr/bank-registry" className="text-primary underline hover:no-underline">
                        จัดการทะเบียนธนาคาร
                      </Link>
                    </p>
                  </div>
                  <div className="space-y-2 md:col-span-1">
                    <Label className="font-bold">ชื่อบัญชี</Label>
                    <Input
                      value={formData.bankAccountName ?? ''}
                      onChange={(e) => setFormData({ ...formData, bankAccountName: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2 md:col-span-1">
                    <Label className="font-bold">เลขที่บัญชี</Label>
                    <Input
                      value={formData.bankAccountNumber ?? ''}
                      onChange={(e) => setFormData({ ...formData, bankAccountNumber: e.target.value })}
                      placeholder="000-0-00000-0"
                      className="font-mono"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="admin" className="mt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="shadow-sm">
                <CardHeader className="bg-primary/5 border-b flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
                  <CardTitle className="text-lg flex items-center gap-2 text-primary">
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
                        value={formData.linkedUserId?.trim() ? formData.linkedUserId : '__none__'}
                        onValueChange={(v) =>
                          setFormData({
                            ...formData,
                            linkedUserId: v === '__none__' ? undefined : v,
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
                        {formData.linkedUserId?.trim() ? (
                          <>
                            <p className="font-medium">
                              {formData.linkedUserDisplayName?.trim() || formData.linkedUserId}
                            </p>
                            <p className="text-muted-foreground text-xs break-all">
                              {formData.linkedUserDisplayEmail?.trim() || `UID: ${formData.linkedUserId}`}
                            </p>
                          </>
                        ) : (
                          <span className="text-muted-foreground">ยังไม่ผูกบัญชีผู้ใช้</span>
                        )}
                      </div>
                    )}
                    {canAdminUserLink && !integrationEditMode ? (
                      <p className="text-[11px] text-muted-foreground">กด «แก้ไข» เพื่อเปลี่ยนบัญชีที่ผูก — บันทึกด้วยปุ่มด้านบนของหน้า</p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <Label className="font-bold">สิทธิ์บัญชีที่ผูก</Label>
                    <div className="rounded-md border bg-muted/20 px-3 py-2.5 text-sm space-y-1.5 min-h-[4rem]">
                      {integrationAccessLines.length === 0 ? (
                        <span className="text-muted-foreground">
                          {formData.linkedUserId?.trim()
                            ? '— (ผู้ดูแลระบบบันทึกการผูกแล้วจะมี snapshot สิทธิ์ หรือเปิดจากบัญชีที่มีสิทธิ์อ่าน users)'
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

          <TabsContent value="attendance" className="mt-6">
            {isNew ? (
              <Card>
                <CardContent className="py-10 text-center text-muted-foreground text-sm">
                  บันทึกพนักงานก่อน จึงจะดูประวัติลงเวลาได้
                </CardContent>
              </Card>
            ) : firestore ? (
              <SubjectAttendanceHistory
                firestore={firestore}
                subjectType="office_staff"
                subjectId={id}
                title="ประวัติการลงเวลา (Kiosk)"
                description="บันทึกเข้า/ออกจากหน้ามือถือหลังสแกน QR ที่ Kiosk"
              />
            ) : null}
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
