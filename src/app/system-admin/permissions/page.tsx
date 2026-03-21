
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
  Edit2, 
  Copy, 
  ShieldAlert,
  ChevronRight,
  Loader2,
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
import { collection, doc, setDoc, query, orderBy } from 'firebase/firestore';
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
import { SYSTEM_MODULES, INITIAL_PERMISSIONS_TEMPLATE } from '@/lib/permissions';

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

/**
 * Transformed groups for the UI editor
 */
const MODULE_GROUPS = useMemo(() => {
  const groups: Record<string, any[]> = {};
  SYSTEM_MODULES.forEach(mod => {
    if (!groups[mod.group]) groups[mod.group] = [];
    groups[mod.group].push(mod);
  });
  return Object.entries(groups).map(([name, modules]) => ({ name, modules }));
}, []);

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
    permissions: { ...INITIAL_PERMISSIONS_TEMPLATE }
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
      permissions: JSON.parse(JSON.stringify(INITIAL_PERMISSIONS_TEMPLATE))
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

  const moduleGroups = [];
  const groups: Record<string, any[]> = {};
  SYSTEM_MODULES.forEach(mod => {
    if (!groups[mod.group]) groups[mod.group] = [];
    groups[mod.group].push(mod);
  });
  const finalModuleGroups = Object.entries(groups).map(([name, modules]) => ({ name, modules }));

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
              <LockKeyhole className="h-8 w-8 text-primary" /> จัดการสิทธิ์การใช้งาน (Permission Profiles)
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
          <TabsList className="grid grid-cols-2 w-full md:w-[400px] h-auto p-1 bg-muted/50">
            <TabsTrigger value="profiles" className="gap-2 py-2 px-6">1. โปรไฟล์ (Profiles)</TabsTrigger>
            <TabsTrigger value="audit" className="gap-2 py-2 px-6">2. ตรวจสอบ (Audit)</TabsTrigger>
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
                        <TableHead className="pl-6 py-4">Profile Key</TableHead>
                        <TableHead>ชื่อโปรไฟล์ (TH/EN)</TableHead>
                        <TableHead>แผนก / ระดับ</TableHead>
                        <TableHead>สถานะ</TableHead>
                        <TableHead>อัปเดตล่าสุด</TableHead>
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
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => handleEditProfile(p)}>
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

          <TabsContent value="audit" className="mt-6">
            <Card>
              <CardHeader><CardTitle>Access Audit Overview</CardTitle></CardHeader>
              <CardContent className="py-20 text-center text-muted-foreground italic">
                Please use the dedicated "Permission Audit" tool for detailed security analysis.
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
                  <div className="flex items-center justify-between p-3 border rounded-lg">
                    <Label className="font-bold">Active Status</Label>
                    <Checkbox checked={formData.isActive} onCheckedChange={(v) => setFormData({ ...formData, isActive: !!v })} />
                  </div>
                </div>
              </div>

              <div className="md:col-span-3 border-l pl-6">
                <div className="space-y-8">
                  {finalModuleGroups.map((group) => (
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
