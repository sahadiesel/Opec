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
  ShieldCheck
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useUser, useCollection } from '@/firebase';
import { doc, collection, setDoc, updateDoc } from 'firebase/firestore';
import { OfficeStaff, User, StaffStatus, EmploymentType, StaffSalaryType } from '@/lib/types';
import { setDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
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
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="animate-spin h-12 w-12 text-primary" /></div>;
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
              <h1 className="text-2xl font-bold tracking-tight">
                {isNew ? 'ลงทะเบียนพนักงานใหม่ (Add Office Staff)' : `แก้ไขข้อมูลพนักงาน: ${formData.fullName}`}
              </h1>
              <p className="text-sm text-muted-foreground">ทะเบียนประวัติพนักงานออฟฟิศเพื่อระบบบุคลากรและเงินเดือน</p>
            </div>
          </div>
          <Button className="gap-2 px-8 font-bold shadow-lg bg-primary" onClick={handleSave} disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isNew ? 'บันทึกพนักงานใหม่' : 'บันทึกการเปลี่ยนแปลง'}
          </Button>
        </div>

        <Tabs defaultValue="basic" className="w-full">
          <TabsList className="grid grid-cols-3 w-full md:w-fit h-auto p-1 bg-muted/50">
            <TabsTrigger value="basic" className="gap-2 py-2 px-6"><Briefcase className="h-4 w-4" /> ข้อมูลทั่วไป</TabsTrigger>
            <TabsTrigger value="financial" className="gap-2 py-2 px-6"><CreditCard className="h-4 w-4" /> ข้อมูลการเงิน</TabsTrigger>
            <TabsTrigger value="admin" className="gap-2 py-2 px-6"><ShieldCheck className="h-4 w-4" /> การเชื่อมโยงระบบ</TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="mt-6">
            <Card>
              <CardHeader><CardTitle>ข้อมูลประวัติและตำแหน่งงาน (Job Profile)</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <Label>รหัสพนักงาน (Staff Code)</Label>
                    <Input value={formData.staffCode} onChange={e => setFormData({...formData, staffCode: e.target.value})} placeholder=" เช่น OFF-001" />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>ชื่อ-นามสกุล (Full Name)</Label>
                    <Input value={formData.fullName} onChange={e => setFormData({...formData, fullName: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>ชื่อเล่น (Nickname)</Label>
                    <Input value={formData.nickname} onChange={e => setFormData({...formData, nickname: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>แผนก (Department)</Label>
                    <Input value={formData.department} onChange={e => setFormData({...formData, department: e.target.value})} placeholder="เช่น HR, IT, Finance" />
                  </div>
                  <div className="space-y-2">
                    <Label>ตำแหน่ง (Position Title)</Label>
                    <Input value={formData.positionTitle} onChange={e => setFormData({...formData, positionTitle: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>ประเภทการจ้าง</Label>
                    <Select onValueChange={(v: EmploymentType) => setFormData({...formData, employmentType: v})} value={formData.employmentType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="FULL_TIME">Full Time</SelectItem>
                        <SelectItem value="PART_TIME">Part Time</SelectItem>
                        <SelectItem value="CONTRACT">Contract</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>วันที่เริ่มงาน (Start Date)</Label>
                    <Input type="date" value={formData.startDate} onChange={e => setFormData({...formData, startDate: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>สถานะการทำงาน</Label>
                    <Select onValueChange={(v: StaffStatus) => setFormData({...formData, status: v})} value={formData.status}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ACTIVE">ACTIVE</SelectItem>
                        <SelectItem value="INACTIVE">INACTIVE</SelectItem>
                        <SelectItem value="RESIGNED">RESIGNED</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>หมายเหตุ</Label>
                  <Textarea value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} className="min-h-[100px]" />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="financial" className="mt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader><CardTitle>การจ่ายเงิน (Compensation)</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>รูปแบบเงินเดือน</Label>
                    <Select onValueChange={(v: StaffSalaryType) => setFormData({...formData, salaryType: v})} value={formData.salaryType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MONTHLY">รายเดือน (Monthly)</SelectItem>
                        <SelectItem value="DAILY">รายวัน (Daily)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>จำนวนเงินเดือนพื้นฐาน (Monthly Salary)</Label>
                    <Input type="number" value={formData.monthlySalary} onChange={e => setFormData({...formData, monthlySalary: parseFloat(e.target.value)})} className="text-lg font-bold" />
                  </div>
                  <div className="space-y-2">
                    <Label>เลขประจำตัวผู้เสียภาษี (Tax ID)</Label>
                    <Input value={formData.taxId} onChange={e => setFormData({...formData, taxId: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>เลขประกันสังคม (SSO No.)</Label>
                    <Input value={formData.socialSecurityNo} onChange={e => setFormData({...formData, socialSecurityNo: e.target.value})} />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>บัญชีธนาคาร (Bank Details)</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>ชื่อธนาคาร (Bank Name)</Label>
                    <Input value={formData.bankName} onChange={e => setFormData({...formData, bankName: e.target.value})} placeholder="เช่น กสิกรไทย, ไทยพาณิชย์" />
                  </div>
                  <div className="space-y-2">
                    <Label>ชื่อบัญชี (Account Name)</Label>
                    <Input value={formData.bankAccountName} onChange={e => setFormData({...formData, bankAccountName: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>เลขที่บัญชี (Account Number)</Label>
                    <Input value={formData.bankAccountNumber} onChange={e => setFormData({...formData, bankAccountNumber: e.target.value})} placeholder="000-0-00000-0" />
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="admin" className="mt-6">
            <Card>
              <CardHeader><CardTitle>การเชื่อมโยงระบบ (System Integration)</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2 max-w-md">
                  <Label>เชื่อมโยงกับบัญชีผู้ใช้ (Linked System User)</Label>
                  <Select onValueChange={v => setFormData({...formData, linkedUserId: v})} value={formData.linkedUserId}>
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder="เลือกบัญชีผู้ใช้เพื่อเชื่อมโยง..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">ไม่เชื่อมโยง</SelectItem>
                      {allUsers?.map(u => (
                        <SelectItem key={u.id} value={u.id}>{u.displayName} ({u.email})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    การเชื่อมโยงจะช่วยให้พนักงานสามารถเข้าดูสลิปเงินเดือนของตัวเองได้ในอนาคต (ถ้ามีการพัฒนามอดูลดังกล่าว)
                  </p>
                </div>

                <div className="p-4 border rounded-lg bg-muted/30 space-y-2">
                  <div className="flex items-center gap-2 font-bold text-sm">
                    <History className="h-4 w-4 text-primary" /> ประวัติการทำรายการ
                  </div>
                  <div className="text-xs space-y-1">
                    <p><span className="text-muted-foreground">สร้างเมื่อ:</span> {staffData?.createdAt ? new Date(staffData.createdAt).toLocaleString('th-TH') : '-'}</p>
                    <p><span className="text-muted-foreground">สร้างโดย:</span> {staffData?.createdBy || '-'}</p>
                    <p><span className="text-muted-foreground">อัปเดตล่าสุด:</span> {staffData?.updatedAt ? new Date(staffData.updatedAt).toLocaleString('th-TH') : '-'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
