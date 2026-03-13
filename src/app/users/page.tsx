
'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, ShieldCheck, Mail, Clock, Trash2, UserCog, Info, Filter, ArrowRight, ShieldAlert, CheckCircle2, XCircle, Loader2, User as UserIcon, Sparkles, Building2, Briefcase, Lock } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { User, RoleType } from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, updateDoc, setDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';

const ROLE_GROUPS: { category: string; roles: { id: RoleType; label: string; desc: string }[] }[] = [
  {
    category: 'บริหาร / ระบบ (Admin/System)',
    roles: [
      { id: 'system_admin', label: 'System Admin', desc: 'สิทธิ์สูงสุด เข้าถึงได้ทุกเมนูและจัดการผู้ใช้งาน' }
    ]
  },
  {
    category: 'บุคคล / HR',
    roles: [
      { id: 'hr_manager', label: 'HR Manager', desc: 'จัดการข้อมูลคนงาน ตำแหน่งงาน และโครงสร้างแผนก' },
      { id: 'hr_officer', label: 'HR Officer', desc: 'จัดการประวัติคนงาน ใบเซอร์ และการมอบหมายงานพื้นฐาน' }
    ]
  },
  {
    category: 'ปฏิบัติการ / Operations',
    roles: [
      { id: 'operations_officer', label: 'Operations Officer', desc: 'จัดการ Wave, การระดมพล (Mobilization) และ PO Lines' }
    ]
  },
  {
    category: 'ความปลอดภัย / Safety',
    roles: [
      { id: 'safety_officer', label: 'Safety Officer', desc: 'ตรวจสอบความพร้อมความปลอดภัยและเกณฑ์ตำแหน่งงาน' }
    ]
  },
  {
    category: 'การขาย / Commercial',
    roles: [
      { id: 'sales_officer', label: 'Sales Officer', desc: 'จัดการลูกค้า สัญญาหลัก และใบสั่งซื้อ (Customer POs)' }
    ]
  },
  {
    category: 'บัญชีการเงิน / Finance',
    roles: [
      { id: 'finance_officer', label: 'Finance Officer', desc: 'อนุมัติการจ่ายเงิน ตรวจสอบต้นทุนและสัญญา' }
    ]
  },
  {
    category: 'เงินเดือน / Payroll',
    roles: [
      { id: 'payroll_officer', label: 'Payroll Officer', desc: 'ลงเวลาทำงาน (Timesheets) และคำนวณงวดการจ่ายเงิน' }
    ]
  },
  {
    category: 'คลังและจัดซื้อ / Store & Procurement',
    roles: [
      { id: 'store_officer', label: 'Store Officer', desc: 'จัดการคลังอุปกรณ์ การเบิก-คืน PPE และเครื่องมือ' }
    ]
  },
  {
    category: 'ลูกค้า / Client Access',
    roles: [
      { id: 'client_user', label: 'Client (Normal)', desc: 'ลูกค้าเข้าดูสถานะงานและคนงานของตัวเอง' },
      { id: 'client', label: 'Client (Shared)', desc: 'บัญชีส่วนกลางสำหรับลูกค้าพิจารณาคนงาน' }
    ]
  }
];

const ROLE_PRESETS = [
  { name: 'พี่โจ้ (Admin/Finance)', roles: ['system_admin', 'finance_officer'] },
  { name: 'นุช (HR Manager)', roles: ['hr_manager'] },
  { name: 'หญิง (HR/Ops)', roles: ['hr_officer', 'operations_officer'] },
  { name: 'โดม (Sales/Safety/Ops)', roles: ['sales_officer', 'safety_officer', 'operations_officer'] },
  { name: 'ก้อย (Payroll)', roles: ['payroll_officer'] },
  { name: 'ณัฐ (Store)', roles: ['store_officer'] },
];

export default function UsersPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editedRoles, setEditedRoles] = useState<RoleType[]>([]);
  const [isActive, setIsActive] = useState(false);
  const [dept, setDept] = useState('');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed.roleId && !parsed.roleIds) parsed.roleIds = [parsed.roleId];
        setCurrentUser(parsed);
      } catch (e) {
        console.error('Failed to parse user session', e);
      }
    }
  }, []);

  const usersQuery = useMemoFirebase(() => {
    if (isUserLoading || !firebaseUser || !firestore || !currentUser) return null;
    if (firebaseUser.uid !== currentUser.id || !currentUser.roleIds?.includes('system_admin')) return null;
    return collection(firestore, 'users');
  }, [firestore, isUserLoading, firebaseUser, currentUser]);

  const { data: users, isLoading: isCollectionLoading } = useCollection<User>(usersQuery as any);

  const handleEditUser = (user: User) => {
    setSelectedUser(user);
    setEditedRoles(user.roleIds || []);
    setIsActive(user.isActive);
    setDept(user.department || '');
    setNotes(user.notes || '');
    setIsEditDialogOpen(true);
  };

  const handleSaveRoles = async () => {
    if (!firestore || !selectedUser) return;
    setIsSaving(true);

    try {
      const userRef = doc(firestore, 'users', selectedUser.id);
      
      // Update User Profile with new fields
      await updateDoc(userRef, {
        roleIds: editedRoles,
        isActive: isActive,
        department: dept,
        notes: notes,
        updatedAt: Date.now()
      });

      // Update Role Collections (DBAC)
      const batch = writeBatch(firestore);
      
      // Flatten roles for the loop
      const allRoleIds = ROLE_GROUPS.flatMap(g => g.roles.map(r => r.id));
      
      for (const roleId of allRoleIds) {
        const roleDocRef = doc(firestore, `roles_${roleId}`, selectedUser.id);
        if (editedRoles.includes(roleId)) {
          batch.set(roleDocRef, { assignedAt: Date.now() }, { merge: true });
        } else {
          batch.delete(roleDocRef);
        }
      }

      await batch.commit();

      toast({ title: "บันทึกสำเร็จ", description: `อัปเดตสิทธิ์ของ ${selectedUser.displayName} เรียบร้อยแล้ว` });
      setIsEditDialogOpen(false);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = (id: string) => {
    if (!firestore) return;
    if (confirm('ยืนยันการลบผู้ใช้งานระบบรายนี้?')) {
      deleteDocumentNonBlocking(doc(firestore, 'users', id));
    }
  };

  const toggleRole = (role: RoleType) => {
    if (editedRoles.includes(role)) {
      setEditedRoles(editedRoles.filter(r => r !== role));
    } else {
      setEditedRoles([...editedRoles, role]);
    }
  };

  const applyPreset = (roles: string[]) => {
    setEditedRoles(roles as RoleType[]);
    toast({ title: "ใช้ชุดสิทธิ์สำเร็จ" });
  };

  const getMenuAccessSummary = (roles: RoleType[]) => {
    const access = {
      overview: roles.length > 0,
      master: roles.some(r => ['system_admin', 'hr_manager', 'hr_officer', 'safety_officer', 'sales_officer', 'store_officer'].includes(r)),
      commercial: roles.some(r => ['system_admin', 'sales_officer', 'finance_officer', 'operations_officer'].includes(r)),
      operations: roles.some(r => ['system_admin', 'hr_manager', 'hr_officer', 'operations_officer', 'safety_officer', 'payroll_officer', 'store_officer'].includes(r)),
      finance: roles.some(r => ['system_admin', 'finance_officer', 'payroll_officer', 'hr_manager'].includes(r)),
      admin: roles.includes('system_admin')
    };
    return access;
  };

  if (isUserLoading || !currentUser || (firebaseUser && firebaseUser.uid !== currentUser.id)) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-4">
          <ShieldCheck className="h-12 w-12 text-primary animate-pulse mx-auto" />
          <p className="text-muted-foreground">กำลังตรวจสอบสิทธิ์การเข้าถึง...</p>
        </div>
      </div>
    );
  }

  const accessMatrix = getMenuAccessSummary(editedRoles);
  const hasBroadAccess = editedRoles.length > 3 || editedRoles.includes('system_admin');

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <ShieldCheck className="h-8 w-8" /> จัดการระบบและสิทธิ์การใช้งาน (System Admin)
          </h1>
          <p className="text-muted-foreground text-lg">
            บริหารจัดการสิทธิ์การเข้าถึง (Access Control) และกำหนดบทบาทตามผังองค์กร
          </p>
        </div>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isCollectionLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลผู้ใช้งาน...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4 pl-6">เจ้าหน้าที่ (Staff Name)</TableHead>
                    <TableHead className="font-bold">แผนก (Dept)</TableHead>
                    <TableHead className="font-bold">สิทธิ์การใช้งาน (Current Roles)</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                    <TableHead className="font-bold">กิจกรรมล่าสุด</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users?.map((u) => {
                    const roles = u.roleIds || [];
                    const isSelf = firebaseUser?.uid === u.id;
                    const isOnline = isSelf || (u.lastLoginAt && (!u.lastLogoutAt || u.lastLoginAt > u.lastLogoutAt));
                    
                    return (
                      <TableRow key={u.id} className="hover:bg-muted/30 transition-all">
                        <TableCell className="py-4 pl-6">
                          <div className="flex flex-col">
                            <span className="font-bold text-base text-primary">{u.displayName}</span>
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1 font-medium"><Mail className="h-3 w-3" /> {u.email}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm font-medium">{u.department || '-'}</span>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1 max-w-[300px]">
                            {roles.length > 0 ? roles.map(role => (
                              <Badge key={role} variant="outline" className="bg-primary/5 text-primary border-primary/20 capitalize text-[10px] font-bold">
                                {(role || '').replace('_', ' ')}
                              </Badge>
                            )) : <span className="text-xs text-muted-foreground italic">ยังไม่มีสิทธิ์</span>}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            {isOnline ? (
                              <span className="flex items-center gap-1.5 text-green-600 text-xs font-bold">
                                <div className="h-2 w-2 rounded-full bg-green-600 animate-pulse" /> ออนไลน์
                              </span>
                            ) : (
                              <span className="flex items-center gap-1.5 text-muted-foreground text-xs font-bold">
                                <div className="h-2 w-2 rounded-full bg-slate-300" /> ออฟไลน์
                              </span>
                            )}
                            <Badge variant={u.isActive ? "default" : "secondary"} className="text-[9px] h-4 w-fit px-1">
                              {u.isActive ? "อนุมัติแล้ว" : "รอนุมัติ"}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-[10px] text-muted-foreground">
                          <p>Login: {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('th-TH') : '-'}</p>
                        </TableCell>
                        <TableCell className="text-right pr-6 space-x-2">
                          <Button variant="ghost" size="icon" className="hover:text-primary h-8 w-8" onClick={() => handleEditUser(u)}>
                            <UserCog className="h-4 w-4" />
                          </Button>
                          {!isSelf && (
                            <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => handleDelete(u.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Edit User Dialog */}
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-2xl flex items-center gap-2">
                <UserCog className="h-6 w-6 text-primary" /> จัดการสิทธิ์ผู้ใช้งาน
              </DialogTitle>
              <DialogDescription>
                ตั้งค่าบทบาทและสิทธิ์การเข้าถึงสำหรับ <b>{selectedUser?.displayName}</b>
              </DialogDescription>
            </DialogHeader>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 py-4">
              {/* Left Column: Basic Info & Presets */}
              <div className="space-y-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/20">
                    <Label className="font-bold">อนุมัติเข้าใช้งาน</Label>
                    <Switch checked={isActive} onCheckedChange={setIsActive} />
                  </div>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2"><Building2 className="h-4 w-4" /> แผนก (Department)</Label>
                    <Input value={dept} onChange={e => setDept(e.target.value)} placeholder="เช่น Human Resources" />
                  </div>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2"><Briefcase className="h-4 w-4" /> หมายเหตุ (Internal Notes)</Label>
                    <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="เช่น ระบุหน้าที่รับผิดชอบ..." className="min-h-[80px]" />
                  </div>
                </div>

                <div className="space-y-3">
                  <Label className="text-sm font-bold uppercase text-muted-foreground flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-amber-500" /> ชุดสิทธิ์แนะนำ (Presets)
                  </Label>
                  <div className="grid grid-cols-1 gap-2">
                    {ROLE_PRESETS.map(preset => (
                      <Button key={preset.name} variant="outline" size="sm" className="justify-start h-auto py-2 px-3 text-[11px]" onClick={() => applyPreset(preset.roles)}>
                        {preset.name}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="p-4 border rounded-lg bg-primary/5 space-y-3">
                  <Label className="text-xs font-black uppercase text-primary">Access Preview (ภาพรวมการเข้าถึง)</Label>
                  <div className="space-y-1.5">
                    <AccessBadge label="Overview" active={accessMatrix.overview} />
                    <AccessBadge label="Master Data" active={accessMatrix.master} />
                    <AccessBadge label="Commercial" active={accessMatrix.commercial} />
                    <AccessBadge label="Operations" active={accessMatrix.operations} />
                    <AccessBadge label="Finance" active={accessMatrix.finance} />
                    <AccessBadge label="System Admin" active={accessMatrix.admin} />
                  </div>
                </div>
              </div>

              {/* Right Columns: Role Matrix */}
              <div className="md:col-span-2 space-y-6 border-l pl-6">
                {hasBroadAccess && (
                  <Alert variant="destructive" className="bg-amber-50 border-amber-200 text-amber-800">
                    <ShieldAlert className="h-4 w-4 text-amber-600" />
                    <AlertTitle className="text-xs font-bold">Broad Access Warning</AlertTitle>
                    <AlertDescription className="text-[10px]">
                      ผู้ใช้รายนี้มีสิทธิ์ที่กว้างมาก กรุณาตรวจสอบให้แน่ใจว่าเป็นไปตามนโยบายความปลอดภัย (Principle of Least Privilege)
                    </AlertDescription>
                  </Alert>
                )}

                <div className="grid grid-cols-1 gap-6">
                  {ROLE_GROUPS.map((group) => (
                    <div key={group.category} className="space-y-3">
                      <h4 className="text-sm font-bold border-b pb-1 text-primary">{group.category}</h4>
                      <div className="grid grid-cols-1 gap-3">
                        {group.roles.map((role) => (
                          <div key={role.id} className="flex items-start space-x-3 p-2 rounded-md hover:bg-muted/30 transition-colors">
                            <Checkbox id={role.id} checked={editedRoles.includes(role.id)} onCheckedChange={() => toggleRole(role.id)} className="mt-1" />
                            <div className="grid gap-0.5">
                              <label htmlFor={role.id} className="text-sm font-bold leading-none cursor-pointer">
                                {role.label} <span className="text-[10px] text-muted-foreground font-mono">({role.id})</span>
                              </label>
                              <p className="text-[10px] text-muted-foreground leading-tight">{role.desc}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <DialogFooter className="bg-muted/30 p-4 -mx-6 -mb-6 border-t mt-4">
              <Button variant="outline" onClick={() => setIsEditDialogOpen(false)} disabled={isSaving}>ยกเลิก</Button>
              <Button onClick={handleSaveRoles} disabled={isSaving} className="bg-primary font-bold shadow-md">
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
                ยืนยันและบันทึกสิทธิ์ (Confirm Changes)
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}

function AccessBadge({ label, active }: { label: string; active: boolean }) {
  return (
    <div className={`flex items-center justify-between text-[10px] px-2 py-1 rounded ${active ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-400'}`}>
      <span>{label}</span>
      {active ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
    </div>
  );
}
