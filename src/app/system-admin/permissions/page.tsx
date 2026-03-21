'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  LockKeyhole, 
  Plus, 
  ShieldCheck, 
  Search, 
  Filter, 
  CheckCircle2, 
  XCircle, 
  MoreHorizontal, 
  Edit2, 
  Copy, 
  RefreshCcw,
  ShieldAlert,
  Info,
  ChevronRight,
  Loader2,
  AlertTriangle,
  UserCheck,
  Building2,
  Briefcase,
  Activity,
  Save,
  Trash2
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { 
  User, 
  DeptType, 
  AccessLevel, 
  PermissionProfile, 
  ModulePermission 
} from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, updateDoc, setDoc, query, orderBy, writeBatch } from 'firebase/firestore';
import { Badge } from '@/components/ui/badge';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { isAdminUser, inferDeptAndLevel } from '@/lib/auth-mapping';

const DEPARTMENTS: { id: DeptType; label: string }[] = [
  { id: 'admin', label: 'Admin (บริหาร)' },
  { id: 'hr', label: 'HR (บุคคล)' },
  { id: 'operations', label: 'Operations (ปฏิบัติการ)' },
  { id: 'sales', label: 'Sales (การขาย)' },
  { id: 'accounting', label: 'Accounting (บัญชี)' },
  { id: 'store', label: 'Store (คลัง)' },
  { id: 'client', label: 'Client (ลูกค้า)' },
];

const LEVELS: { id: AccessLevel; label: string }[] = [
  { id: 'viewer', label: 'Viewer' },
  { id: 'officer', label: 'Officer' },
  { id: 'manager', label: 'Manager' },
  { id: 'admin', label: 'Admin' },
];

const MODULE_GROUPS = [
  {
    name: 'Overview',
    modules: [
      { key: 'overview_dashboard', label: 'แดชบอร์ดหลัก (Main Dashboard)' }
    ]
  },
  {
    name: 'Commercial (การค้า)',
    modules: [
      { key: 'customers', label: 'ทะเบียนลูกค้า (Customers)' },
      { key: 'main_contracts', label: 'สัญญาหลัก (Contracts)' },
      { key: 'customer_pos', label: 'ใบสั่งซื้อลูกค้า (Customer POs)' }
    ]
  },
  {
    name: 'HR & Payroll (บุคคล)',
    modules: [
      { key: 'timesheets', label: 'ลงเวลาทำงาน (Timesheets)' },
      { key: 'worker_payroll', label: 'จ่ายเงินคนงาน (Worker Payroll)' },
      { key: 'office_payroll', label: 'เงินเดือนออฟฟิศ (Office Payroll)' },
      { key: 'positions', label: 'ตำแหน่งงาน (Positions)' },
      { key: 'workers', label: 'ทะเบียนคนงาน (Workers)' },
      { key: 'office_staff', label: 'พนักงานออฟฟิศ (Office Staff)' }
    ]
  },
  {
    name: 'Operations (ปฏิบัติการ)',
    modules: [
      { key: 'waves', label: 'กลุ่มรอบการทำงาน (Waves)' },
      { key: 'assignments', label: 'การมอบหมายงาน (Assignments)' },
      { key: 'mobilization', label: 'การเตรียมส่งตัว (Mobilization)' },
      { key: 'vendors', label: 'คู่ค้า/ผู้ขาย (Vendors)' },
      { key: 'purchases', label: 'การสั่งซื้อ (Purchases)' },
      { key: 'store_inventory', label: 'คลังอุปกรณ์ (Store / Inventory)' }
    ]
  },
  {
    name: 'Finance & Accounting (การเงิน)',
    modules: [
      { key: 'billing_notes', label: 'ใบวางบิลลูกหนี้ (Billing Notes)' },
      { key: 'tax_invoices', label: 'ใบกำกับภาษี (Tax Invoices)' },
      { key: 'receipts', label: 'ใบเสร็จรับเงิน (Receipts)' },
      { key: 'ap_bills', label: 'รับวางบิลเจ้าหนี้ (AP Bills)' },
      { key: 'accounts_receivable', label: 'ลูกหนี้การค้า (AR)' },
      { key: 'accounts_payable', label: 'เจ้าหนี้การค้า (AP)' },
      { key: 'cashbook', label: 'รายรับรายจ่าย (Cashbook)' },
      { key: 'bank_accounts', label: 'บัญชีธนาคาร (Bank Accounts)' }
    ]
  },
  {
    name: 'Administration (ระบบ)',
    modules: [
      { key: 'system_admin', label: 'จัดการผู้ใช้/ระบบ (System Admin)' },
      { key: 'client_portal', label: 'Client Portal (หน้าของลูกค้า)' }
    ]
  }
];

const INITIAL_PERMISSIONS: Record<string, ModulePermission> = {};
MODULE_GROUPS.forEach(group => {
  group.modules.forEach(mod => {
    INITIAL_PERMISSIONS[mod.key] = { view: false, create: false, edit: false, delete: false, approve: false };
  });
});

export default function PermissionProfilesPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState('profiles');
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Editor Form State
  const [formData, setFormData] = useState<Partial<PermissionProfile>>({
    profileKey: '',
    profileNameTh: '',
    profileNameEn: '',
    department: 'hr',
    level: 'viewer',
    isActive: true,
    notes: '',
    permissions: { ...INITIAL_PERMISSIONS }
  });

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const isUserAdmin = useMemo(() => isAdminUser(currentUser), [currentUser]);

  // Queries
  const profilesQuery = useMemoFirebase(() => {
    if (!firestore || !isUserAdmin) return null;
    return query(collection(firestore, 'permission_profiles'), orderBy('profileKey', 'asc'));
  }, [firestore, isUserAdmin]);
  const { data: profiles, isLoading: isProfilesLoading } = useCollection<PermissionProfile>(profilesQuery as any);

  const usersQuery = useMemoFirebase(() => {
    if (!firestore || !isUserAdmin) return null;
    return collection(firestore, 'users');
  }, [firestore, isUserAdmin]);
  const { data: users, isLoading: isUsersLoading } = useCollection<User>(usersQuery as any);

  // Actions
  const handleCreateProfile = () => {
    setFormData({
      profileKey: '',
      profileNameTh: '',
      profileNameEn: '',
      department: 'hr',
      level: 'viewer',
      isActive: true,
      notes: '',
      permissions: JSON.parse(JSON.stringify(INITIAL_PERMISSIONS))
    });
    setIsEditorOpen(true);
  };

  const handleEditProfile = (profile: PermissionProfile) => {
    setFormData(JSON.parse(JSON.stringify(profile)));
    setIsEditorOpen(true);
  };

  const handleTogglePermission = (moduleKey: string, field: keyof ModulePermission) => {
    const newPermissions = { ...formData.permissions };
    if (!newPermissions[moduleKey]) {
      newPermissions[moduleKey] = { view: false, create: false, edit: false, delete: false, approve: false };
    }
    newPermissions[moduleKey][field] = !newPermissions[moduleKey][field];
    setFormData({ ...formData, permissions: newPermissions });
  };

  const handleSaveProfile = async () => {
    if (!firestore || !currentUser) return;
    if (!formData.profileKey || !formData.profileNameEn) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาระบุ Profile Key และชื่อภาษาอังกฤษ" });
      return;
    }

    setIsSaving(true);
    try {
      const profileKey = formData.profileKey!;
      const profileRef = doc(firestore, 'permission_profiles', profileKey);
      
      const saveData = {
        ...formData,
        id: profileKey,
        updatedAt: Date.now(),
        updatedBy: currentUser.displayName
      };

      if (!formData.createdAt) {
        saveData.createdAt = Date.now();
        saveData.createdBy = currentUser.displayName;
      }

      await setDoc(profileRef, saveData, { merge: true });
      toast({ title: "บันทึกโปรไฟล์สำเร็จ", description: `โปรไฟล์ ${profileKey} ถูกอัปเดตเรียบร้อยแล้ว` });
      setIsEditorOpen(false);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAssignProfile = async (userId: string, profileKey: string) => {
    if (!firestore) return;
    try {
      const userRef = doc(firestore, 'users', userId);
      await updateDoc(userRef, { 
        permissionProfileKey: profileKey === 'none' ? null : profileKey,
        updatedAt: Date.now()
      });
      toast({ title: "มอบหมายโปรไฟล์สำเร็จ" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    }
  };

  const auditSummary = useMemo(() => {
    if (!users || !profiles) return { unassigned: 0, inactive: 0, mismatches: 0 };
    return {
      unassigned: users.filter(u => u.isActive && !u.permissionProfileKey).length,
      inactive: profiles.filter(p => !p.isActive).length,
      mismatches: users.filter(u => {
        if (!u.permissionProfileKey) return false;
        const p = profiles.find(profile => profile.profileKey === u.permissionProfileKey);
        if (!p) return true;
        const { dept, level } = inferDeptAndLevel(u);
        return p.department !== dept || p.level !== level;
      }).length
    };
  }, [users, profiles]);

  if (isUserLoading || !currentUser) return null;

  if (!isUserAdmin) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <ShieldAlert className="h-12 w-12 text-destructive opacity-50" />
          <h2 className="text-xl font-bold">Access Denied</h2>
          <p className="text-muted-foreground">This area is reserved for full System Administrators.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
              <LockKeyhole className="h-8 w-8" /> จัดการสิทธิ์การใช้งาน (Permission Profiles)
            </h1>
            <p className="text-muted-foreground text-lg">
              กำหนดโปรไฟล์การเข้าถึงโมดูลต่าง ๆ ตามแผนกและระดับความสำคัญ
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleCreateProfile} className="gap-2 bg-primary font-bold shadow-md">
              <Plus className="h-4 w-4" /> สร้างโปรไฟล์ใหม่
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid grid-cols-3 w-full md:w-[600px] h-auto p-1 bg-muted/50">
            <TabsTrigger value="profiles" className="gap-2 py-2 px-6">1. โปรไฟล์ (Profiles)</TabsTrigger>
            <TabsTrigger value="assignments" className="gap-2 py-2 px-6">2. มอบหมาย (User Assignment)</TabsTrigger>
            <TabsTrigger value="audit" className="gap-2 py-2 px-6">3. ตรวจสอบ (Audit)</TabsTrigger>
          </TabsList>

          <TabsContent value="profiles" className="mt-6 space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
              <div className="flex items-center gap-3 flex-1">
                <div className="relative w-full max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="ค้นหาชื่อโปรไฟล์ หรือ Key..." className="pl-9 h-11" />
                </div>
                <Button variant="outline" className="h-11 gap-2"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
              </div>
            </div>

            <Card className="shadow-lg border-none overflow-hidden">
              <CardContent className="p-0">
                {isProfilesLoading ? (
                  <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลโปรไฟล์...</div>
                ) : (
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="font-bold py-4 pl-6">Profile Key</TableHead>
                        <TableHead className="font-bold">ชื่อโปรไฟล์ (TH/EN)</TableHead>
                        <TableHead className="font-bold">แผนก / ระดับ</TableHead>
                        <TableHead className="font-bold">สถานะ</TableHead>
                        <TableHead className="font-bold">อัปเดตล่าสุด</TableHead>
                        <TableHead className="text-right pr-6">จัดการ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {profiles?.map((p) => (
                        <TableRow key={p.id} className="hover:bg-muted/30 transition-all group">
                          <TableCell className="py-4 pl-6 font-mono text-xs font-bold text-primary">{p.profileKey}</TableCell>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-bold text-sm text-primary">{p.profileNameEn}</span>
                              <span className="text-[10px] text-muted-foreground">{p.profileNameTh}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1.5">
                              <Badge variant="outline" className="text-[9px] uppercase">{p.department}</Badge>
                              <Badge variant="secondary" className="text-[9px] uppercase">{p.level}</Badge>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={p.isActive ? "default" : "secondary"} className={p.isActive ? "bg-green-600" : ""}>
                              {p.isActive ? 'ACTIVE' : 'INACTIVE'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-[10px] text-muted-foreground">
                            <div className="flex flex-col">
                              <span>{new Date(p.updatedAt).toLocaleDateString()}</span>
                              <span>โดย {p.updatedBy}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right pr-6">
                            <div className="flex justify-end gap-2">
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => handleEditProfile(p)}>
                                <Edit2 className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                                <Copy className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                      {profiles?.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="py-20 text-center text-muted-foreground italic">ยังไม่มีโปรไฟล์ในระบบ กรุณาสร้างโปรไฟล์พื้นฐานเพื่อเริ่มต้น</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="assignments" className="mt-6 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserCheck className="h-5 w-5 text-primary" /> มอบหมายสิทธิ์ให้ผู้ใช้งาน (User Access Assignment)
                </CardTitle>
                <CardDescription>ระบุโปรไฟล์การเข้าถึงให้กับเจ้าหน้าที่แต่ละราย เพื่อควบคุมการใช้งานในระดับโมดูล</CardDescription>
              </CardHeader>
              <CardContent className="p-0 border-t">
                {isUsersLoading ? (
                  <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลผู้ใช้งาน...</div>
                ) : (
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="font-bold py-4 pl-6">เจ้าหน้าที่ (User)</TableHead>
                        <TableHead className="font-bold">แผนก / ระดับ (Context)</TableHead>
                        <TableHead className="font-bold">สิทธิ์ที่ได้รับ (Permission Profile)</TableHead>
                        <TableHead className="text-right pr-6">ดำเนินการ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users?.filter(u => u.approvalStatus === 'ACTIVE').map((u) => {
                        const { dept, level } = inferDeptAndLevel(u);
                        return (
                          <TableRow key={u.id}>
                            <TableCell className="pl-6 py-4">
                              <div className="flex flex-col">
                                <span className="font-bold text-sm">{u.displayName}</span>
                                <span className="text-[10px] text-muted-foreground">{u.email}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Badge variant="outline" className="text-[9px] capitalize">{dept}</Badge>
                                <Badge variant="secondary" className="text-[9px] capitalize">{level}</Badge>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Select 
                                value={u.permissionProfileKey || 'none'} 
                                onValueChange={(v) => handleAssignProfile(u.id, v)}
                              >
                                <SelectTrigger className={`h-9 text-xs w-[250px] ${!u.permissionProfileKey ? 'border-amber-500 bg-amber-50' : ''}`}>
                                  <SelectValue placeholder="เลือกโปรไฟล์..." />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">-- ไม่ได้มอบหมาย (No Profile) --</SelectItem>
                                  {profiles?.filter(p => p.isActive).map(p => (
                                    <SelectItem key={p.id} value={p.profileKey}>
                                      {p.profileKey} ({p.profileNameEn})
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {!u.permissionProfileKey && (
                                <p className="text-[9px] text-amber-600 font-bold mt-1 flex items-center gap-1">
                                  <AlertTriangle className="h-2.5 w-2.5" /> จำเป็นต้องระบุโปรไฟล์เพื่อใช้ระบบความปลอดภัยใหม่
                                </p>
                              )}
                            </TableCell>
                            <TableCell className="text-right pr-6">
                              <Button variant="ghost" size="sm" className="h-8">ดูประวัติ</Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="audit" className="mt-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="border-l-8 border-l-red-600">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-bold uppercase text-muted-foreground">Unassigned Users</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-black text-red-600">{auditSummary.unassigned} ราย</div>
                  <p className="text-[10px] text-muted-foreground mt-1">เจ้าหน้าที่ที่ยังไม่มีโปรไฟล์สิทธิ์</p>
                </CardContent>
              </Card>
              <Card className="border-l-8 border-l-amber-500">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-bold uppercase text-muted-foreground">Context Mismatches</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-black text-amber-600">{auditSummary.mismatches} ราย</div>
                  <p className="text-[10px] text-muted-foreground mt-1">โปรไฟล์ไม่ตรงกับแผนก/ระดับจริง</p>
                </CardContent>
              </Card>
              <Card className="border-l-8 border-l-slate-400">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-bold uppercase text-muted-foreground">Inactive Profiles</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-black text-slate-600">{auditSummary.inactive} ชุด</div>
                  <p className="text-[10px] text-muted-foreground mt-1">สิทธิ์ที่ถูกปิดใช้งานชั่วคราว</p>
                </CardContent>
              </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Permission Integrity Check</CardTitle>
                <CardDescription>ตรวจสอบความถูกต้องของการกำหนดสิทธิ์ในระบบ</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-4 bg-muted/30 rounded-lg flex items-start gap-3">
                  <Info className="h-5 w-5 text-primary shrink-0" />
                  <div className="space-y-1">
                    <p className="font-bold text-sm">การทำงานของระบบสิทธิ์ (Security Rules Integration)</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      โปรไฟล์ที่กำหนดที่นี่จะถูกส่งไปยัง Firebase Security Rules เพื่อควบคุมการเขียน/อ่านข้อมูลจริง 
                      หากเจ้าหน้าที่ไม่มีโปรไฟล์ ระบบจะใช้ Default Security Policy (Viewer Only) เพื่อความปลอดภัยสูงสุด
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Profile Editor Dialog */}
        <Dialog open={isEditorOpen} onOpenChange={setIsEditorOpen}>
          <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-2xl flex items-center gap-2">
                <ShieldCheck className="h-6 w-6 text-primary" /> แก้ไขโปรไฟล์การเข้าถึง (Profile Editor)
              </DialogTitle>
              <DialogDescription>กำหนดสิทธิ์การเข้าใช้งานรายโมดูลสำหรับโปรไฟล์นี้</DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 py-4">
              {/* Profile Meta Section */}
              <div className="space-y-6">
                <div className="space-y-4">
                  <div className="p-4 bg-primary/5 rounded-lg space-y-4 border border-primary/10">
                    <div className="space-y-2">
                      <Label className="font-bold">Profile Key (unique ID)</Label>
                      <Input 
                        placeholder="e.g. HR_OFFICER" 
                        value={formData.profileKey} 
                        onChange={e => setFormData({ ...formData, profileKey: e.target.value.toUpperCase().replace(/\s+/g, '_') })}
                        className="font-mono text-sm"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label className="text-[10px] font-bold">Dept (แผนก)</Label>
                        <Select value={formData.department} onValueChange={(v: any) => setFormData({ ...formData, department: v })}>
                          <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {DEPARTMENTS.map(d => <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-[10px] font-bold">Level (ระดับ)</Label>
                        <Select value={formData.level} onValueChange={(v: any) => setFormData({ ...formData, level: v })}>
                          <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {LEVELS.map(l => <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="font-bold">ชื่อโปรไฟล์ (ไทย)</Label>
                    <Input value={formData.profileNameTh} onChange={e => setFormData({ ...formData, profileNameTh: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">ชื่อโปรไฟล์ (English)</Label>
                    <Input value={formData.profileNameEn} onChange={e => setFormData({ ...formData, profileNameEn: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">หมายเหตุ (Internal Notes)</Label>
                    <Textarea value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} className="min-h-[80px]" />
                  </div>
                  <div className="flex items-center justify-between p-3 border rounded-lg">
                    <Label className="font-bold">Active Status</Label>
                    <Checkbox checked={formData.isActive} onCheckedChange={(v) => setFormData({ ...formData, isActive: !!v })} />
                  </div>
                </div>
              </div>

              {/* Permission Matrix Section */}
              <div className="md:col-span-3 border-l pl-6">
                <div className="space-y-8">
                  {MODULE_GROUPS.map((group) => (
                    <div key={group.name} className="space-y-3">
                      <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                        <ChevronRight className="h-3 w-3" /> {group.name}
                      </h3>
                      <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
                        <Table>
                          <TableHeader className="bg-muted/30">
                            <TableRow>
                              <TableHead className="text-[10px] font-bold py-2">Module Name</TableHead>
                              <TableHead className="text-center text-[10px] font-bold w-[60px]">VIEW</TableHead>
                              <TableHead className="text-center text-[10px] font-bold w-[60px]">CREATE</TableHead>
                              <TableHead className="text-center text-[10px] font-bold w-[60px]">EDIT</TableHead>
                              <TableHead className="text-center text-[10px] font-bold w-[60px]">DELETE</TableHead>
                              <TableHead className="text-center text-[10px] font-bold w-[60px]">APPROVE</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {group.modules.map((mod) => (
                              <TableRow key={mod.key} className="hover:bg-muted/10 transition-colors">
                                <TableCell className="py-2 text-[11px] font-medium text-primary">{mod.label}</TableCell>
                                <TableCell className="text-center">
                                  <Checkbox 
                                    checked={formData.permissions?.[mod.key]?.view || false} 
                                    onCheckedChange={() => handleTogglePermission(mod.key, 'view')} 
                                  />
                                </TableCell>
                                <TableCell className="text-center">
                                  <Checkbox 
                                    checked={formData.permissions?.[mod.key]?.create || false} 
                                    onCheckedChange={() => handleTogglePermission(mod.key, 'create')} 
                                  />
                                </TableCell>
                                <TableCell className="text-center">
                                  <Checkbox 
                                    checked={formData.permissions?.[mod.key]?.edit || false} 
                                    onCheckedChange={() => handleTogglePermission(mod.key, 'edit')} 
                                  />
                                </TableCell>
                                <TableCell className="text-center">
                                  <Checkbox 
                                    checked={formData.permissions?.[mod.key]?.delete || false} 
                                    onCheckedChange={() => handleTogglePermission(mod.key, 'delete')} 
                                  />
                                </TableCell>
                                <TableCell className="text-center">
                                  <Checkbox 
                                    checked={formData.permissions?.[mod.key]?.approve || false} 
                                    onCheckedChange={() => handleTogglePermission(mod.key, 'approve')} 
                                  />
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <DialogFooter className="bg-muted/30 p-4 -mx-6 -mb-6 border-t mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsEditorOpen(false)}>ยกเลิก</Button>
              <Button onClick={handleSaveProfile} disabled={isSaving} className="bg-primary font-bold shadow-md">
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                บันทึกโปรไฟล์
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
