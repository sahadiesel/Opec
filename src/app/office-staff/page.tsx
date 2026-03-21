'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Plus, 
  Search, 
  Filter, 
  ChevronRight, 
  UserSearch, 
  Building2, 
  Briefcase,
  Calendar,
  AlertCircle,
  Info,
  Trash2,
  ShieldAlert
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { OfficeStaff, User, StaffStatus, EmploymentType } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function OfficeStaffPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const isStaff = useMemo(() => {
    return currentUser?.roleIds?.some(r => !['client', 'client_user'].includes(r as any)) || false;
  }, [currentUser]);

  const staffQuery = useMemoFirebase(() => {
    if (!firestore || isUserLoading || !firebaseUser || !isStaff) return null;
    return collection(firestore, 'office_staff');
  }, [firestore, isUserLoading, firebaseUser, isStaff]);

  const { data: staffList, isLoading } = useCollection<OfficeStaff>(staffQuery as any);

  const [searchTerm, setSearcherTerm] = useState('');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');

  const filteredStaff = useMemo(() => {
    if (!staffList) return [];
    return staffList.filter(s => {
      const matchesSearch = s.fullName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                           s.staffCode.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesDept = deptFilter === 'ALL' || s.department === deptFilter;
      const matchesType = typeFilter === 'ALL' || s.employmentType === typeFilter;
      return matchesSearch && matchesDept && matchesType;
    });
  }, [staffList, searchTerm, deptFilter, typeFilter]);

  const departments = useMemo(() => {
    if (!staffList) return [];
    return Array.from(new Set(staffList.map(s => s.department))).sort();
  }, [staffList]);

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!firestore) return;
    if (confirm('ยืนยันการลบข้อมูลพนักงานออฟฟิศ?')) {
      deleteDocumentNonBlocking(doc(firestore, 'office_staff', id));
      toast({ title: "ลบข้อมูลสำเร็จ" });
    }
  };

  const getStatusBadge = (status: StaffStatus) => {
    switch (status) {
      case 'ACTIVE': return <Badge className="bg-green-600">ACTIVE</Badge>;
      case 'INACTIVE': return <Badge variant="secondary">INACTIVE</Badge>;
      case 'RESIGNED': return <Badge variant="destructive">RESIGNED</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isUserLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <UserSearch className="h-8 w-8" /> พนักงานออฟฟิศ (Office Staff Directory)
          </h1>
          <p className="text-muted-foreground text-lg">
            จัดการข้อมูลพนักงานบริษัทส่วนกลาง (Internal Employees) รวมถึงตำแหน่งและฐานเงินเดือนรายเดือน
          </p>
        </div>

        <Alert className="bg-blue-50 border-blue-200 text-blue-800 shadow-sm">
          <ShieldAlert className="h-5 w-5 text-blue-600" />
          <AlertTitle className="font-bold text-lg">นโยบายการแยกข้อมูลพนักงาน (Strict Data Separation)</AlertTitle>
          <AlertDescription className="text-sm">
            ระบบแยกฐานข้อมูลพนักงานออฟฟิศ (Office Staff) ออกจากคนงานหน้างาน (Field Workers) อย่างเด็ดขาด <b>ห้ามใช้ประวัติในหมวดนี้สำหรับการมอบหมายงาน (Assignment) เข้าโครงการของลูกค้า</b>
          </AlertDescription>
        </Alert>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="ค้นหาตามชื่อ หรือ รหัสพนักงาน..." 
                className="pl-9 h-11" 
                value={searchTerm}
                onChange={e => setSearcherTerm(e.target.value)}
              />
            </div>
            <Select onValueChange={setDeptFilter} value={deptFilter}>
              <SelectTrigger className="w-[180px] h-11">
                <SelectValue placeholder="แผนกทั้งหมด" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">แผนกทั้งหมด</SelectItem>
                {departments.map(d => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select onValueChange={setTypeFilter} value={typeFilter}>
              <SelectTrigger className="w-[180px] h-11">
                <SelectValue placeholder="ประเภทการจ้าง" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">ประเภททั้งหมด</SelectItem>
                <SelectItem value="FULL_TIME">Full Time</SelectItem>
                <SelectItem value="PART_TIME">Part Time</SelectItem>
                <SelectItem value="CONTRACT">Contract</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button className="gap-2 h-11 px-6 bg-primary font-bold shadow-md" onClick={() => router.push('/office-staff/new')}>
            <Plus className="h-5 w-5" /> เพิ่มพนักงานออฟฟิศ (Add Staff)
          </Button>
        </div>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลพนักงาน...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4 pl-6">รหัส (Code)</TableHead>
                    <TableHead className="font-bold">ชื่อ-นามสกุล (Full Name)</TableHead>
                    <TableHead className="font-bold">แผนก & ตำแหน่ง</TableHead>
                    <TableHead className="font-bold">ประเภทการจ้าง</TableHead>
                    <TableHead className="font-bold">ฐานเงินเดือน</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredStaff.map((staff) => (
                    <TableRow 
                      key={staff.id} 
                      className="cursor-pointer hover:bg-muted/30 group transition-all"
                      onClick={() => router.push(`/office-staff/${staff.id}`)}
                    >
                      <TableCell className="py-4 pl-6 font-mono text-xs font-bold text-primary">{staff.staffCode}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-bold text-base text-primary">{staff.fullName}</span>
                          <span className="text-xs text-muted-foreground">ชื่อเล่น: {staff.nickname || '-'}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-sm font-medium flex items-center gap-1"><Building2 className="h-3 w-3" /> {staff.department}</span>
                          <span className="text-[10px] text-muted-foreground uppercase flex items-center gap-1"><Briefcase className="h-2.5 w-2.5" /> {staff.positionTitle}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] font-bold">
                          {staff.employmentType.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-bold text-sm">฿{staff.monthlySalary.toLocaleString()}</span>
                          <span className="text-[10px] text-muted-foreground">{staff.salaryType}</span>
                        </div>
                      </TableCell>
                      <TableCell>{getStatusBadge(staff.status)}</TableCell>
                      <TableCell className="text-right pr-6">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="icon" className="text-destructive h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => handleDelete(staff.id, e)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          <ChevronRight className="h-5 w-5 text-muted-foreground" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredStaff.length === 0 && !isLoading && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-20 text-muted-foreground italic">ไม่พบข้อมูลพนักงานในระบบ</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="bg-primary/5 border-primary/10 border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2 text-primary font-bold">
              <Info className="h-5 w-5" /> แนวทางปฏิบัติ (Staff Management Guide)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="flex items-start gap-3 p-4 bg-white rounded-md border shadow-sm">
                <div className="bg-blue-100 p-2 rounded text-blue-700 font-bold">1</div>
                <div>
                  <p className="font-bold">ระบบแยกประเภทบุคลากร (Staff Separation)</p>
                  <p className="text-muted-foreground text-xs"><b>Worker</b> = ลูกจ้าง offshore (Field labor) | <b>Office Staff</b> = พนักงานบริษัทส่วนกลาง ห้ามใช้ระบบลงเวลาร่วมกัน</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 bg-white rounded-md border shadow-sm">
                <div className="bg-green-100 p-2 rounded text-green-700 font-bold">2</div>
                <div>
                  <p className="font-bold">การเชื่อมโยงบัญชี (User Linking)</p>
                  <p className="text-muted-foreground text-xs">คุณสามารถเลือก 'Linked User' เพื่อเชื่อมประวัติพนักงานเข้ากับบัญชีล็อกอินของพนักงานรายนั้นได้</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}