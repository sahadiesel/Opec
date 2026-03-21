
'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  ShieldCheck, 
  Plus, 
  Edit2, 
  ShieldAlert,
  ChevronRight,
  Loader2,
  Save,
  Settings2,
  RefreshCw
} from 'lucide-react';
import { 
  User, 
  DeptType, 
  AccessLevel, 
  PermissionProfile, 
  ModulePermission 
} from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, query, orderBy, writeBatch, setDoc } from 'firebase/firestore';
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
import { isAdminUser } from '@/lib/auth-mapping';
import { getBaselineProfiles, INITIAL_PERMISSIONS_TEMPLATE, SYSTEM_MODULES } from '@/lib/permissions';

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

export default function PermissionMatrixPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);

  // Editor Form State
  const [formData, setFormData] = useState<Partial<PermissionProfile>>({
    profileKey: '',
    department: 'hr',
    level: 'viewer',
    isActive: true,
    notes: '',
    permissions: JSON.parse(JSON.stringify(INITIAL_PERMISSIONS_TEMPLATE))
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

  const handleResetToBaseline = async () => {
    if (!firestore) return;
    setIsMigrating(true);
    const batch = writeBatch(firestore);
    
    try {
      const baselines = getBaselineProfiles();
      for (const p of baselines) {
        const pRef = doc(firestore, 'permission_profiles', p.profileKey!);
        batch.set(pRef, {
          ...p,
          id: p.profileKey,
          updatedAt: Date.now(),
          updatedBy: 'System Baseline Tool'
        }, { merge: true });
      }
      await batch.commit();
      toast({ title: "กู้คืนโปรไฟล์มาตรฐานสำเร็จ (Baseline restored)" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Migration Failed", description: err.message });
    } finally {
      setIsMigrating(false);
    }
  };

  if (isUserLoading || !currentUser) return null;

  if (!isUserAdmin) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex items-center justify-center py-20 text-center space-y-4">
          <ShieldAlert className="h-12 w-12 text-destructive opacity-50" />
          <h2 className="text-xl font-bold">Access Restricted</h2>
          <p className="text-muted-foreground">Only system administrators can access advanced settings.</p>
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
              <Settings2 className="h-8 w-8 text-primary" /> จัดการแม่แบบสิทธิ์ (Advanced Permission Matrix)
            </h1>
            <p className="text-muted-foreground text-lg italic">
              กำหนดรายละเอียดสิทธิ์รายโมดูลสำหรับแต่ละแผนก (Internal module-level security configuration)
            </p>
          </div>
          <div className="flex gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="gap-2 border-primary text-primary" disabled={isMigrating}>
                  <RefreshCw className={`h-4 w-4 ${isMigrating ? 'animate-spin' : ''}`} />
                  Restore Baseline Profiles
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>ยืนยันการกู้คืนค่ามาตรฐาน?</AlertDialogTitle>
                  <AlertDialogDescription>
                    ระบบจะเขียนทับโปรไฟล์สิทธิ์มาตรฐานด้วยค่าเริ่มต้นที่กำหนดโดยระบบ เพื่อแก้ไขปัญหา "Profile Not Found" และสร้างโครงสร้างสิทธิ์ที่ถูกต้อง
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
                  <AlertDialogAction onClick={handleResetToBaseline}>ตกลง</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button onClick={handleCreateProfile} className="gap-2 bg-primary font-bold shadow-md">
              <Plus className="h-4 w-4" /> สร้างเทมเพลตใหม่
            </Button>
          </div>
        </div>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isProfilesLoading ? (
              <div className="py-20 text-center animate-pulse italic">กำลังโหลดข้อมูลโปรไฟล์...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="pl-6 py-4">โปรไฟล์ (Profile Key)</TableHead>
                    <TableHead>แผนก / ระดับ (Context)</TableHead>
                    <TableHead>สถานะ</TableHead>
                    <TableHead>อัปเดตล่าสุด</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profiles?.map((p) => (
                    <TableRow key={p.id} className="hover:bg-muted/30 transition-all">
                      <TableCell className="pl-6 py-4 font-mono text-xs font-bold text-primary">
                        {p.profileKey}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1.5">
                          <Badge variant="outline" className="capitalize bg-blue-50 text-blue-700 font-bold">{p.department}</Badge>
                          <Badge variant="secondary" className="capitalize font-bold">{p.level}</Badge>
                        </div>
                      </TableCell>
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
                      {SYSTEM_MODULES.map((mod) => (
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
