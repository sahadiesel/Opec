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
  Save,
  Trash2,
  Sparkles,
  Zap,
  RefreshCw
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
  { group: 'Overview', key: 'overview_dashboard', label: 'Dashboard' },
  { group: 'Commercial', key: 'customers', label: 'Customers' },
  { group: 'Commercial', key: 'main_contracts', label: 'Contracts' },
  { group: 'Commercial', key: 'customer_pos', label: 'Customer POs' },
  { group: 'HR & Payroll', key: 'timesheets', label: 'Timesheets' },
  { group: 'HR & Payroll', key: 'worker_payroll', label: 'Worker Payroll' },
  { group: 'HR & Payroll', key: 'office_payroll', label: 'Office Payroll' },
  { group: 'HR & Payroll', key: 'positions', label: 'Positions' },
  { group: 'HR & Payroll', key: 'workers', label: 'Workers' },
  { group: 'HR & Payroll', key: 'office_staff', label: 'Office Staff' },
  { group: 'Operations', key: 'waves', label: 'Waves' },
  { group: 'Operations', key: 'assignments', label: 'Assignments' },
  { group: 'Operations', key: 'mobilization', label: 'Mobilization' },
  { group: 'Operations', key: 'vendors', label: 'Vendors' },
  { group: 'Operations', key: 'purchases', label: 'Purchases' },
  { group: 'Operations', key: 'store_inventory', label: 'Store / Inventory' },
  { group: 'Finance', key: 'billing_notes', label: 'Billing Notes' },
  { group: 'Finance', key: 'tax_invoices', label: 'Tax Invoices' },
  { group: 'Finance', key: 'receipts', label: 'Receipts' },
  { group: 'Finance', key: 'ap_bills', label: 'AP Bills' },
  { group: 'Finance', key: 'accounts_receivable', label: 'AR' },
  { group: 'Finance', key: 'accounts_payable', label: 'AP' },
  { group: 'Finance', key: 'cashbook', label: 'Cashbook' },
  { group: 'Finance', key: 'bank_accounts', label: 'Bank Accounts' },
  { group: 'System', key: 'system_admin', label: 'System Admin' },
  { group: 'System', key: 'client_portal', label: 'Client Portal' },
];

const INITIAL_PERMISSIONS: Record<string, ModulePermission> = {};
MODULE_LIST.forEach(m => {
  INITIAL_PERMISSIONS[m.key] = { view: false, create: false, edit: false, delete: false, approve: false };
});

export default function PermissionMatrixPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState('profiles');
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationSummary, setMigrationSummary] = useState<any>(null);

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
    if (!key) return;

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
      toast({ title: "บันทึกโปรไฟล์สำเร็จ" });
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

  const handleBaselineMigration = async () => {
    if (!firestore || !users) return;
    setIsMigrating(true);
    
    const batch = writeBatch(firestore);
    let profilesCreated = 0;
    let usersMigrated = 0;
    let usersSkipped = 0;
    let usersFailed = 0;

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
        // Keep manual curation if already exists and looks valid
        if (user.permissionProfileKey && user.permissionProfileKey !== "") {
          usersSkipped++;
          continue;
        }

        try {
          const migratedFields = getMigratedUserFields(user);
          const userRef = doc(firestore, 'users', user.id);
          batch.update(userRef, migratedFields);
          usersMigrated++;
        } catch (e) {
          console.error('Migration failed for user:', user.id, e);
          usersFailed++;
        }
      }

      await batch.commit();
      setMigrationSummary({ profilesCreated, usersMigrated, usersSkipped, usersFailed });
      toast({ title: "Baseline Migration Complete" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Migration Failed", description: e.message });
    } finally {
      setIsMigrating(false);
    }
  };

  if (isUserLoading || !currentUser) return null;

  if (!isUserAdmin) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <ShieldAlert className="h-12 w-12 text-destructive opacity-50" />
          <h2 className="text-xl font-bold">Access Restricted</h2>
          <p className="text-muted-foreground">Only system administrators can access this page.</p>
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
                  {isMigrating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Create Baseline & Assign
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>ยืนยันการตั้งค่า Baseline?</AlertDialogTitle>
                  <AlertDialogDescription>
                    ระบบจะสร้าง Permission Profile มาตรฐาน (8 ชุด) และอัปเดตข้อมูลพนักงานทุกคนที่ยังไม่มี Profile 
                    โดยคำนวณจากตำแหน่งและแผนกเดิมที่มีอยู่ในระบบ ข้อมูลเดิมจะไม่ถูกลบ
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
                  <AlertDialogAction onClick={handleBaselineMigration} className="bg-primary">เริ่มการทำงาน</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button onClick={handleCreateProfile} className="gap-2 bg-primary font-bold shadow-md">
              <Plus className="h-4 w-4" /> สร้างโปรไฟล์สิทธิ์ใหม่
            </Button>
          </div>
        </div>

        {migrationSummary && (
          <Alert className="bg-green-50 border-green-200 text-green-800">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertTitle className="font-bold">Migration Summary</AlertTitle>
            <AlertDescription className="text-xs">
              Profiles Created: {migrationSummary.profilesCreated} | 
              Users Migrated: {migrationSummary.usersMigrated} | 
              Users Skipped: {migrationSummary.usersSkipped} | 
              Users Failed: {migrationSummary.usersFailed}
            </AlertDescription>
          </Alert>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid grid-cols-3 w-full md:w-[600px] h-auto p-1 bg-muted/50">
            <TabsTrigger value="profiles" className="gap-2 py-2">1. รายการโปรไฟล์ (Profiles)</TabsTrigger>
            <TabsTrigger value="assignment" className="gap-2 py-2">2. มอบหมายสิทธิ์ (Assignment)</TabsTrigger>
            <TabsTrigger value="audit" className="gap-2 py-2">3. ตรวจสอบ (Audit)</TabsTrigger>
          </TabsList>

          <TabsContent value="profiles" className="mt-6 space-y-6">
            <Card className="shadow-lg border-none overflow-hidden">
              <CardContent className="p-0">
                {isProfilesLoading ? (
                  <div className="py-20 text-center animate-pulse italic">กำลังโหลดข้อมูลโปรไฟล์...</div>
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
                            <Badge variant="outline" className="capitalize bg-blue-50 text-blue-700 font-bold">{p.department}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="capitalize font-bold">{p.level}</Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs font-bold text-primary">{p.profileKey}</TableCell>
                          <TableCell>
                            <Badge className={p.isActive ? "bg-green-600" : "bg-slate-300"}>
                              {p.isActive ? 'ACTIVE' : 'INACTIVE'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-[10px] text-muted-foreground leading-tight">
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
                <CardTitle className="flex items-center gap-2"><UserCheck className="h-5 w-5 text-primary" /> มอบหมายสิทธิ์ให้ผู้ใช้งาน</CardTitle>
                <CardDescription>ผูกโปรไฟล์การเข้าถึงให้กับพนักงานแต่ละคน</CardDescription>
              </CardHeader>
              <CardContent className="p-0 border-t">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="pl-6 py-4">ผู้ใช้งาน (User)</TableHead>
                      <TableHead>แผนก / ระดับ</TableHead>
                      <TableHead>Profile Assigned</TableHead>
                      <TableHead className="text-right pr-6">ดำเนินการ</TableHead>
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
                              <SelectTrigger className={`h-9 text-xs w-[250px] ${!u.permissionProfileKey ? 'border-amber-500 bg-amber-50 shadow-sm' : ''}`}>
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
                              <Badge variant="destructive" className="animate-pulse text-[8px]">Missing Profile</Badge>
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
              <Card className="border-l-8 border-l-red-600 shadow-md">
                <CardHeader>
                  <CardTitle className="text-sm font-bold uppercase text-muted-foreground">Unassigned Users (ยังไม่มีโปรไฟล์)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-black text-red-600">{users?.filter(u => u.isActive && !u.permissionProfileKey).length} ราย</div>
                  <p className="text-xs text-muted-foreground mt-2 italic">ควรได้รับมอบหมาย Profile Key เพื่อความปลอดภัยสูงสุด</p>
                </CardContent>
              </Card>
              <Card className="border-l-8 border-l-amber-500 shadow-md">
                <CardHeader>
                  <CardTitle className="text-sm font-bold uppercase text-muted-foreground">Inactive Profiles (โปรไฟล์ที่ปิดใช้งาน)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-black text-amber-600">{profiles?.filter(p => !p.isActive).length} ชุด</div>
                  <p className="text-xs text-muted-foreground mt-2 italic">ผู้ที่ถือโปรไฟล์นี้จะไม่มีสิทธิ์เข้าถึงโมดูลใด ๆ</p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        {/* Editor Dialog */}
        <Dialog open={isEditorOpen} onOpenChange={setIsEditorOpen}>
          <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-2xl flex items-center gap-2">
                <ShieldCheck className="h-6 w-6 text-primary" /> จัดการโปรไฟล์สิทธิ์ (Profile Editor)
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
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox id="isactive" checked={formData.isActive} onCheckedChange={(v) => setFormData({ ...formData, isActive: !!v })} />
                    <Label htmlFor="isactive" className="font-bold">เปิดใช้งาน (Active)</Label>
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
                บันทึกโปรไฟล์
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
