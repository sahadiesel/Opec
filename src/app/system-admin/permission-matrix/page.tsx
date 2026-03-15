'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  ShieldCheck, 
  Plus, 
  Search, 
  Filter, 
  CheckCircle2, 
  XCircle, 
  Edit2, 
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
  Trash2,
  History,
  Lock,
  Wand2,
  RefreshCcw,
  Zap,
  Sparkles
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
import { collection, doc, updateDoc, setDoc, query, orderBy, deleteDoc, writeBatch, getDocs } from 'firebase/firestore';
import { Badge } from '@/components/ui/badge';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from '@/components/ui/dialog';
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { isAdminUser, inferDeptAndLevel, getMigratedUserFields } from '@/lib/auth-mapping';
import { getBaselineProfiles } from '@/lib/permissions';

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

const MODULE_LIST = [
  { group: 'Overview', key: 'overview_dashboard', label: 'แดชบอร์ดหลัก (Main Dashboard)' },
  { group: 'Commercial', key: 'customers', label: 'ทะเบียนลูกค้า (Customers)' },
  { group: 'Commercial', key: 'main_contracts', label: 'สัญญาหลัก (Contracts)' },
  { group: 'Commercial', key: 'customer_pos', label: 'ใบสั่งซื้อลูกค้า (Customer POs)' },
  { group: 'HR & Payroll', key: 'positions', label: 'ตำแหน่งงาน (Positions)' },
  { group: 'HR & Payroll', key: 'workers', label: 'ทะเบียนคนงาน (Workers)' },
  { group: 'HR & Payroll', key: 'office_staff', label: 'พนักงานออฟฟิศ (Office Staff)' },
  { group: 'HR & Payroll', key: 'timesheets', label: 'ลงเวลาทำงาน (Timesheets)' },
  { group: 'HR & Payroll', key: 'worker_payroll', label: 'จ่ายเงินคนงาน (Worker Payroll)' },
  { group: 'HR & Payroll', key: 'office_payroll', label: 'เงินเดือนพนักงาน (Office Payroll)' },
  { group: 'Operations', key: 'waves', label: 'รอบการทำงาน (Waves)' },
  { group: 'Operations', key: 'assignments', label: 'การมอบหมาย (Assignments)' },
  { group: 'Operations', key: 'mobilization', label: 'การระดมพล (Mobilization)' },
  { group: 'Operations', key: 'vendors', label: 'คู่ค้า / ผู้ขาย (Vendors)' },
  { group: 'Operations', key: 'purchases', label: 'การซื้อ (Purchases)' },
  { group: 'Operations', key: 'store_inventory', label: 'คลังอุปกรณ์ (Store / Inventory)' },
  { group: 'Finance', key: 'billing_notes', label: 'ใบวางบิล (Billing Notes)' },
  { group: 'Finance', key: 'tax_invoices', label: 'ใบกำกับภาษี (Tax Invoices)' },
  { group: 'Finance', key: 'receipts', label: 'ใบเสร็จรับเงิน (Receipts)' },
  { group: 'Finance', key: 'ap_bills', label: 'วางบิลเจ้าหนี้ (AP Bills)' },
  { group: 'Finance', key: 'accounts_receivable', label: 'ลูกหนี้ (AR)' },
  { group: 'Finance', key: 'accounts_payable', label: 'เจ้าหนี้ (AP)' },
  { group: 'Finance', key: 'cashbook', label: 'รายรับรายจ่าย (Cashbook)' },
  { group: 'Finance', key: 'bank_accounts', label: 'บัญชีธนาคาร (Bank Accounts)' },
  { group: 'System', key: 'system_admin', label: 'จัดการระบบ (System Admin)' },
  { group: 'System', key: 'client_portal', label: 'พอร์ทัลลูกค้า (Client Portal)' },
];

const INITIAL_PERMISSIONS: Record<string, ModulePermission> = {};
MODULE_LIST.forEach(m => {
  INITIAL_PERMISSIONS[m.key] = { view: false, create: false, edit: false, delete: false, approve: false };
});

interface MigrationResult {
  userId: string;
  displayName: string;
  oldRoles: string[];
  newDept: string;
  newLevel: string;
  newProfile: string;
  status: 'migrated' | 'skipped' | 'failed';
  error?: string;
}

export default function PermissionMatrixPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState('profiles');
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Migration State
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationResults, setMigrationResults] = useState<MigrationResult[]>([]);
  const [baselineSummary, setBaselineSummary] = useState<{ profiles: number; users: number } | null>(null);

  // Editor Form State
  const [formData, setFormData] = useState<Partial<PermissionProfile>>({
    profileKey: '',
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
    return query(collection(firestore, 'permission_profiles'), orderBy('department', 'asc'));
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
    
    const key = formData.profileKey || `${formData.department}_${formData.level}`;
    if (!key) {
      toast({ variant: "destructive", title: "Error", description: "Invalid Profile Key" });
      return;
    }

    setIsSaving(true);
    try {
      const profileRef = doc(firestore, 'permission_profiles', key);
      const saveData = {
        ...formData,
        profileKey: key,
        id: key,
        updatedAt: Date.now(),
        updatedBy: currentUser.displayName
      };

      if (!formData.createdAt) {
        saveData.createdAt = Date.now();
        saveData.createdBy = currentUser.displayName;
      }

      await setDoc(profileRef, saveData, { merge: true });
      toast({ title: "บันทึกโปรไฟล์สำเร็จ", description: `โปรไฟล์ ${key} ถูกบันทึกแล้ว` });
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
      toast({ title: "Assign Success" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    }
  };

  const handleCreateBaseline = async () => {
    if (!firestore || !users) return;
    setIsMigrating(true);
    const batch = writeBatch(firestore);
    let profilesCreated = 0;
    let usersMigrated = 0;

    try {
      // 1. Create Baseline Profiles
      const baselineProfiles = getBaselineProfiles();
      for (const p of baselineProfiles) {
        const pRef = doc(firestore, 'permission_profiles', p.profileKey!);
        batch.set(pRef, {
          ...p,
          id: p.profileKey,
          createdAt: Date.now(),
          createdBy: 'System Migration',
          updatedAt: Date.now(),
          updatedBy: 'System Migration'
        }, { merge: true });
        profilesCreated++;
      }

      // 2. Migrate Users
      for (const user of users) {
        // Idempotency: Keep existing manually curated profile keys
        if (!user.permissionProfileKey || user.permissionProfileKey === "") {
          const migratedFields = getMigratedUserFields(user);
          const userRef = doc(firestore, 'users', user.id);
          batch.update(userRef, migratedFields);
          usersMigrated++;
        }
      }

      await batch.commit();
      setBaselineSummary({ profiles: profilesCreated, users: usersMigrated });
      toast({ title: "Baseline Ready", description: `Created ${profilesCreated} profiles and updated ${usersMigrated} users.` });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Migration Failed", description: e.message });
    } finally {
      setIsMigrating(false);
    }
  };

  const runMigration = async (force = false) => {
    if (!firestore || !users) return;
    setIsMigrating(true);
    const results: MigrationResult[] = [];
    const batch = writeBatch(firestore);
    let batchCount = 0;

    for (const user of users) {
      const { dept, level } = inferDeptAndLevel(user);
      const profileKey = `${dept}_${level}`;
      
      const res: MigrationResult = {
        userId: user.id,
        displayName: user.displayName,
        oldRoles: user.roleIds || [],
        newDept: dept,
        newLevel: level,
        newProfile: profileKey,
        status: 'skipped'
      };

      if (!user.permissionProfileKey || force) {
        try {
          const migratedFields = getMigratedUserFields(user);
          const userRef = doc(firestore, 'users', user.id);
          batch.update(userRef, migratedFields);
          res.status = 'migrated';
          batchCount++;
        } catch (e: any) {
          res.status = 'failed';
          res.error = e.message;
        }
      }
      results.push(res);
    }

    if (batchCount > 0) {
      await batch.commit();
    }

    setMigrationResults(results);
    setIsMigrating(false);
    toast({ title: "Migration Complete", description: `Successfully processed ${batchCount} users.` });
  };

  const auditStats = useMemo(() => {
    if (!users || !profiles) return { unassigned: 0, inactive: 0 };
    return {
      unassigned: users.filter(u => u.isActive && !u.permissionProfileKey).length,
      inactive: profiles.filter(p => !p.isActive).length,
    };
  }, [users, profiles]);

  if (isUserLoading || !currentUser) return null;

  if (!isUserAdmin) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <ShieldAlert className="h-12 w-12 text-destructive opacity-50" />
          <h2 className="text-xl font-bold">Access Restricted</h2>
          <p className="text-muted-foreground">This page is for full System Administrators only.</p>
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
              <ShieldCheck className="h-8 w-8 text-primary" /> เมทริกซ์การกำหนดสิทธิ์ (Permission Matrix)
            </h1>
            <p className="text-muted-foreground text-lg">
              ตั้งค่าสิทธิ์การใช้งานตามแผนกและระดับ (Department → Level → Module Permissions)
            </p>
          </div>
          <div className="flex gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="gap-2 border-primary text-primary" disabled={isMigrating}>
                  <Sparkles className="h-4 w-4" /> Create Baseline & Assign
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="max-w-md">
                <AlertDialogHeader>
                  <AlertDialogTitle>ยืนยันการสร้าง Baseline?</AlertDialogTitle>
                  <AlertDialogDescription>
                    ระบบจะสร้าง Permission Profile มาตรฐานทั้ง 8 ชุด และมอบหมายให้กับพนักงานที่ยังไม่มี Profile โดยอัตโนมัติตามตำแหน่งเดิม 
                    (ข้อมูลเดิมจะไม่ถูกเขียนทับ)
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
                  <AlertDialogAction onClick={handleCreateBaseline} className="bg-primary">ตกลง (Run Baseline Tool)</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button onClick={handleCreateProfile} className="gap-2 bg-primary font-bold shadow-md">
              <Plus className="h-4 w-4" /> สร้างโปรไฟล์สิทธิ์ใหม่
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid grid-cols-4 w-full md:w-[800px] h-auto p-1 bg-muted/50">
            <TabsTrigger value="profiles" className="gap-2 py-2">1. รายการโปรไฟล์ (Profiles)</TabsTrigger>
            <TabsTrigger value="assignment" className="gap-2 py-2">2. มอบหมายสิทธิ์ (Assignment)</TabsTrigger>
            <TabsTrigger value="audit" className="gap-2 py-2">3. ตรวจสอบ (Audit)</TabsTrigger>
            <TabsTrigger value="migration" className="gap-2 py-2">4. ย้ายข้อมูล (Migration)</TabsTrigger>
          </TabsList>

          <TabsContent value="profiles" className="mt-6 space-y-6">
            {baselineSummary && (
              <Alert className="bg-green-50 border-green-200 text-green-800">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertTitle className="font-bold">Baseline Process Summary</AlertTitle>
                <AlertDescription>
                  Created/Verified <b>{baselineSummary.profiles}</b> baseline profiles and migrated <b>{baselineSummary.users}</b> users.
                </AlertDescription>
              </Alert>
            )}
            <Card className="shadow-lg border-none overflow-hidden">
              <CardContent className="p-0">
                {isProfilesLoading ? (
                  <div className="py-20 text-center animate-pulse">Loading profiles...</div>
                ) : (
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="font-bold py-4 pl-6">แผนก (Department)</TableHead>
                        <TableHead className="font-bold">ระดับ (Level)</TableHead>
                        <TableHead className="font-bold">Profile Key</TableHead>
                        <TableHead className="font-bold">สถานะ</TableHead>
                        <TableHead className="font-bold">อัปเดตล่าสุด</TableHead>
                        <TableHead className="text-right pr-6">จัดการ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {profiles?.map((p) => (
                        <TableRow key={p.id} className="hover:bg-muted/30 transition-all">
                          <TableCell className="pl-6 py-4">
                            <Badge variant="outline" className="capitalize bg-blue-50 text-blue-700">{p.department}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="capitalize">{p.level}</Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs font-bold text-primary">{p.profileKey}</TableCell>
                          <TableCell>
                            <Badge className={p.isActive ? "bg-green-600" : "bg-slate-300"}>
                              {p.isActive ? 'ACTIVE' : 'INACTIVE'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-[10px] text-muted-foreground">
                            {new Date(p.updatedAt).toLocaleString()}<br/>โดย {p.updatedBy}
                          </TableCell>
                          <TableCell className="text-right pr-6">
                            <Button variant="ghost" size="icon" onClick={() => handleEditProfile(p)}>
                              <Edit2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="assignment" className="mt-6 space-y-6">
            <Card className="shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><UserCheck className="h-5 w-5" /> มอบหมายสิทธิ์ให้ผู้ใช้งาน</CardTitle>
                <CardDescription>เลือก Permission Profile ให้กับพนักงานแต่ละคน</CardDescription>
              </CardHeader>
              <CardContent className="p-0 border-t">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="pl-6 py-4">พนักงาน (User)</TableHead>
                      <TableHead>แผนก / ระดับปัจจุบัน</TableHead>
                      <TableHead>โปรไฟล์สิทธิ์ (Permission Profile)</TableHead>
                      <TableHead className="text-right pr-6">สถานะ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users?.filter(u => u.isActive).map((u) => {
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
                                  <SelectItem key={p.id} value={p.profileKey}>{p.profileKey}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="text-right pr-6">
                            {!u.permissionProfileKey && (
                              <Badge variant="destructive" className="animate-pulse">Missing Profile</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="audit" className="mt-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="border-l-8 border-l-red-600">
                <CardHeader>
                  <CardTitle className="text-sm font-bold uppercase text-muted-foreground">Users without Profile</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-black text-red-600">{auditStats.unassigned}</div>
                  <p className="text-xs text-muted-foreground mt-2 italic">เจ้าหน้าที่ที่มีสถานะ Active แต่ยังไม่ได้รับการกำหนดโปรไฟล์สิทธิ์</p>
                </CardContent>
              </Card>
              <Card className="border-l-8 border-l-amber-500">
                <CardHeader>
                  <CardTitle className="text-sm font-bold uppercase text-muted-foreground">Inactive Profiles</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-black text-amber-600">{auditStats.inactive}</div>
                  <p className="text-xs text-muted-foreground mt-2 italic">ชุดสิทธิ์ที่ถูกปิดการใช้งานชั่วคราว</p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="migration" className="mt-6 space-y-6">
            <div className="flex flex-col md:flex-row gap-4 justify-between items-start">
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-primary">Migration Tool (เครื่องมือย้ายข้อมูลสิทธิ์)</h3>
                <p className="text-sm text-muted-foreground">ใช้สำหรับย้ายข้อมูลผู้ใช้งานจากระบบ Role-based เดิม เข้าสู่ระบบ Permission Profile ใหม่</p>
              </div>
              <div className="flex gap-2">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" className="gap-2 border-primary text-primary hover:bg-primary/5">
                      <RefreshCcw className="h-4 w-4" /> Migration Scan
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>ยืนยันการย้ายข้อมูลสิทธิ์ผู้ใช้งาน?</AlertDialogTitle>
                      <AlertDialogDescription>
                        ระบบจะทำการสแกนผู้ใช้งานทั้งหมด และกำหนด Permission Profile ให้อัตโนมัติตามตำแหน่งและแผนกเดิม 
                        (จะไม่ทับข้อมูลเดิมหากผู้ใช้มี Profile Key อยู่แล้ว)
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
                      <AlertDialogAction onClick={() => runMigration(false)} className="bg-primary">เริ่มการย้ายข้อมูล (Normal)</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" className="gap-2">
                      <Zap className="h-4 w-4" /> Force Migration
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle className="text-destructive">คำเตือน: ยืนยันการบังคับย้ายข้อมูล (Force)?</AlertDialogTitle>
                      <AlertDialogDescription>
                        การทำ Force Migration จะทำการ **เขียนทับ (Overwrite)** Profile Key ของผู้ใช้งานทุกคนในระบบ 
                        กรุณาตรวจสอบให้แน่ใจก่อนดำเนินการ
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
                      <AlertDialogAction onClick={() => runMigration(true)} className="bg-destructive">ยืนยันเขียนทับข้อมูลทั้งหมด</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>

            {migrationResults.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="bg-blue-50 border-blue-200">
                  <CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-blue-700">Scanned</CardTitle></CardHeader>
                  <CardContent><div className="text-2xl font-black text-blue-900">{migrationResults.length}</div></CardContent>
                </Card>
                <Card className="bg-green-50 border-green-200">
                  <CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-green-700">Migrated</CardTitle></CardHeader>
                  <CardContent><div className="text-2xl font-black text-green-900">{migrationResults.filter(r => r.status === 'migrated').length}</div></CardContent>
                </Card>
                <Card className="bg-slate-50 border-slate-200">
                  <CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-slate-700">Skipped</CardTitle></CardHeader>
                  <CardContent><div className="text-2xl font-black text-slate-900">{migrationResults.filter(r => r.status === 'skipped').length}</div></CardContent>
                </Card>
                <Card className="bg-red-50 border-red-200">
                  <CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-red-700">Failed</CardTitle></CardHeader>
                  <CardContent><div className="text-2xl font-black text-red-900">{migrationResults.filter(r => r.status === 'failed').length}</div></CardContent>
                </Card>
              </div>
            )}

            {migrationResults.length > 0 && (
              <Card className="shadow-md overflow-hidden border-none">
                <CardHeader className="border-b bg-muted/20">
                  <CardTitle className="text-sm">รายละเอียดผลลัพธ์รายบุคคล (Per-User Results)</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="pl-6 py-3">ผู้ใช้งาน (User)</TableHead>
                        <TableHead>Legacy Roles</TableHead>
                        <TableHead>Derived Context</TableHead>
                        <TableHead>Assigned Profile</TableHead>
                        <TableHead className="text-right pr-6">ผลลัพธ์ (Status)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {migrationResults.map((res) => (
                        <TableRow key={res.userId}>
                          <TableCell className="pl-6 py-3 font-bold text-sm">{res.displayName}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {res.oldRoles.map(r => <Badge key={r} variant="outline" className="text-[8px] uppercase">{r}</Badge>)}
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="text-xs font-medium text-primary capitalize">{res.newDept} / {res.newLevel}</span>
                          </TableCell>
                          <TableCell className="font-mono text-[10px] text-primary font-bold">{res.newProfile}</TableCell>
                          <TableCell className="text-right pr-6">
                            <Badge variant={res.status === 'migrated' ? 'default' : res.status === 'skipped' ? 'secondary' : 'destructive'} className="text-[10px]">
                              {res.status.toUpperCase()}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        {/* Editor Dialog */}
        <Dialog open={isEditorOpen} onOpenChange={setIsEditorOpen}>
          <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-2xl flex items-center gap-2">
                <Lock className="h-6 w-6 text-primary" /> แก้ไขโปรไฟล์สิทธิ์ (Profile Editor)
              </DialogTitle>
              <DialogDescription>กำหนดการเข้าถึงรายโมดูลสำหรับโปรไฟล์นี้</DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 py-4">
              <div className="space-y-6">
                <div className="p-4 bg-muted/30 rounded-lg space-y-4">
                  <div className="space-y-2">
                    <Label className="font-bold">แผนก (Department)</Label>
                    <Select value={formData.department} onValueChange={(v: any) => setFormData({ ...formData, department: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {DEPARTMENTS.map(d => <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">ระดับ (Level)</Label>
                    <Select value={formData.level} onValueChange={(v: any) => setFormData({ ...formData, level: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {LEVELS.map(l => <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">Profile Key</Label>
                    <Input 
                      placeholder="e.g. hr_manager" 
                      value={formData.profileKey} 
                      onChange={e => setFormData({ ...formData, profileKey: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                    />
                    <p className="text-[10px] text-muted-foreground italic">แนะนำให้ใช้รูปแบบ แผนก_ระดับ</p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox id="isactive" checked={formData.isActive} onCheckedChange={(v) => setFormData({ ...formData, isActive: !!v })} />
                    <Label htmlFor="isactive" className="font-bold">เปิดใช้งานโปรไฟล์นี้</Label>
                  </div>
                </div>
              </div>

              <div className="md:col-span-3 border-l pl-6 overflow-hidden">
                <div className="bg-card border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="font-bold py-2 text-[10px] uppercase">Module / Feature</TableHead>
                        <TableHead className="text-center font-bold text-[10px] uppercase w-[60px]">View</TableHead>
                        <TableHead className="text-center font-bold text-[10px] uppercase w-[60px]">Create</TableHead>
                        <TableHead className="text-center font-bold text-[10px] uppercase w-[60px]">Edit</TableHead>
                        <TableHead className="text-center font-bold text-[10px] uppercase w-[60px]">Delete</TableHead>
                        <TableHead className="text-center font-bold text-[10px] uppercase w-[60px]">Approve</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {MODULE_LIST.map((mod) => (
                        <TableRow key={mod.key} className="hover:bg-muted/10 transition-colors">
                          <TableCell className="py-2">
                            <div className="flex flex-col">
                              <span className="text-xs font-bold text-primary">{mod.label}</span>
                              <span className="text-[9px] text-muted-foreground uppercase tracking-tighter">{mod.group}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <Checkbox checked={formData.permissions?.[mod.key]?.view || false} onCheckedChange={() => handleTogglePermission(mod.key, 'view')} />
                          </TableCell>
                          <TableCell className="text-center">
                            <Checkbox checked={formData.permissions?.[mod.key]?.create || false} onCheckedChange={() => handleTogglePermission(mod.key, 'create')} />
                          </TableCell>
                          <TableCell className="text-center">
                            <Checkbox checked={formData.permissions?.[mod.key]?.edit || false} onCheckedChange={() => handleTogglePermission(mod.key, 'edit')} />
                          </TableCell>
                          <TableCell className="text-center">
                            <Checkbox checked={formData.permissions?.[mod.key]?.delete || false} onCheckedChange={() => handleTogglePermission(mod.key, 'delete')} />
                          </TableCell>
                          <TableCell className="text-center">
                            <Checkbox checked={formData.permissions?.[mod.key]?.approve || false} onCheckedChange={() => handleTogglePermission(mod.key, 'approve')} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>

            <DialogFooter className="border-t pt-4">
              <Button variant="outline" onClick={() => setIsEditorOpen(false)}>ยกเลิก</Button>
              <Button onClick={handleSaveProfile} disabled={isSaving} className="bg-primary font-bold shadow-md">
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                บันทึกโปรไฟล์สิทธิ์
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
