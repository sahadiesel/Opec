'use client';

import { useState, use, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
  UserCircle
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useUser, useCollection } from '@/firebase';
import { doc, collection, setDoc, updateDoc } from 'firebase/firestore';
import { OfficeStaff, User, StaffStatus, EmploymentType, StaffSalaryType } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Link from 'next/link';

export default function OfficeStaffDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const isNew = id === 'new';
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const firestore = useFirestore();
  const { toast } = useToast();

  const staffRef = useMemoFirebase(() => (firestore && !isNew ? doc(firestore, 'office_staff', id) : null), [firestore, id, isNew]);
  const { data: staffData, isLoading: isStaffLoading } = useDoc<OfficeStaff>(staffRef as any);

  const usersQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'users') : null), [firestore]);
  const { data: allUsers } = useCollection<User>(usersQuery as any);

  const staffQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'office_staff') : null), [firestore]);
  const { data: allOfficeStaff } = useCollection<OfficeStaff>(staffQuery as any);

  const [formData, setFormData] = useState<Partial<OfficeStaff>>({
    staffCode: '',
    fullName: '',
    nickname: '',
    department: '',
    positionTitle: '',
    employmentType: 'FULL_TIME',
    salaryType: 'MONTHLY',
    monthlySalary: 0,
    startDate: new Date().toISOString().split('T')[0],
    bankAccountName: '',
    bankAccountNumber: '',
    bankName: '',
    taxId: '',
    socialSecurityNo: '',
    status: 'ACTIVE',
    notes: ''
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  useEffect(() => {
    if (staffData) {
      setFormData(staffData);
    }
  }, [staffData]);

  const handleSave = async () => {
    if (!firestore || !currentUser) return;
    if (!formData.fullName || !formData.staffCode || !formData.department) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาระบุรหัสพนักงาน ชื่อ และแผนก" });
      return;
    }

    setIsSubmitting(true);
    const now = Date.now();
    
    try {
      if (isNew) {
        const newRef = doc(collection(firestore, 'office_staff'));
        await setDoc(newRef, {
          ...formData,
          id: newRef.id,
          createdAt: now,
          createdBy: currentUser.displayName,
          updatedAt: now,
          updatedBy: currentUser.id
        });
        toast({ title: "เพิ่มพนักงานสำเร็จ" });
        router.push('/office-staff');
      } else {
        await updateDoc(staffRef!, {
          ...formData,
          updatedAt: now,
          updatedBy: currentUser.id
        });
        toast({ title: "อัปเดตข้อมูลสำเร็จ" });
        router.back();
      }
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถบันทึกข้อมูลได้" });
    } finally {
      setIsSubmitting(false);
    }
  };

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
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-primary">
                {isNew ? 'ลงทะเบียนพนักงานออฟฟิศใหม่ (New Staff)' : `แก้ไขข้อมูลพนักงาน: ${formData.fullName}`}
              </h1>
              <p className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
                <Info className="h-4 w-4" /> ทะเบียนประวัติพนักงานส่วนกลาง (Office Staff) และฐานเงินเดือน
              </p>
            </div>
          </div>
          <Button className="gap-2 px-8 font-bold shadow-lg bg-primary h-11" onClick={handleSave} disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isNew ? 'บันทึกพนักงาน (Save New)' : 'บันทึกการเปลี่ยนแปลง (Save)'}
          </Button>
        </div>

        <Tabs defaultValue="basic" className="w-full">
          <TabsList className="grid grid-cols-3 w-full md:w-fit h-auto p-1 bg-muted/50">
            <TabsTrigger value="basic" className="gap-2 py-2 px-8"><Briefcase className="h-4 w-4" /> ข้อมูลทั่วไป (Profile)</TabsTrigger>
            <TabsTrigger value="financial" className="gap-2 py-2 px-8"><CreditCard className="h-4 w-4" /> ข้อมูลการเงิน (Finance)</TabsTrigger>
            <TabsTrigger value="admin" className="gap-2 py-2 px-8"><ShieldCheck className="h-4 w-4" /> การเชื่อมโยง (System)</TabsTrigger>
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
                    <Input value={formData.staffCode} onChange={e => setFormData({...formData, staffCode: e.target.value})} placeholder="OFF-XXX" />
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
                    <Input value={formData.department} onChange={e => setFormData({...formData, department: e.target.value})} placeholder="เช่น HR, IT, Finance" />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">ตำแหน่ง (Position Title) *</Label>
                    <Input value={formData.positionTitle} onChange={e => setFormData({...formData, positionTitle: e.target.value})} />
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
                    <Input type="date" value={formData.startDate} onChange={e => setFormData({...formData, startDate: e.target.value})} />
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
                  <div className="space-y-2">
                    <Label className="font-bold">รูปแบบเงินเดือน (Salary Type)</Label>
                    <Select onValueChange={(v: StaffSalaryType) => setFormData({...formData, salaryType: v})} value={formData.salaryType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MONTHLY">รายเดือน (Monthly)</SelectItem>
                        <SelectItem value="DAILY">รายวัน (Daily)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">เงินเดือนพื้นฐาน (Monthly Salary)</Label>
                    <Input type="number" value={formData.monthlySalary} onChange={e => setFormData({...formData, monthlySalary: parseFloat(e.target.value)})} className="text-lg font-black text-primary" />
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
                    <span>{staffData?.createdAt ? new Date(staffData.createdAt).toLocaleString('th-TH') : '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">ลงบันทึกโดย (Created By):</span>
                    <span>{staffData?.createdBy || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">แก้ไขล่าสุด (Last Update):</span>
                    <span>{staffData?.updatedAt ? new Date(staffData.updatedAt).toLocaleString('th-TH') : '-'}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
