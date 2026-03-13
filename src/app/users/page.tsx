'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, ShieldCheck, Mail, Clock, Trash2, UserCog, Info, Filter, ArrowRight, ShieldAlert, CheckCircle2, XCircle, Loader2, User as UserIcon } from 'lucide-react';
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

const AVAILABLE_ROLES: { id: RoleType; label: string }[] = [
  { id: 'system_admin', label: 'System Admin' },
  { id: 'hr_manager', label: 'HR Manager' },
  { id: 'hr_officer', label: 'HR Officer' },
  { id: 'operations_officer', label: 'Operations Officer' },
  { id: 'safety_officer', label: 'Safety Officer' },
  { id: 'sales_officer', label: 'Sales Officer' },
  { id: 'finance_officer', label: 'Finance Officer' },
  { id: 'payroll_officer', label: 'Payroll Officer' },
  { id: 'store_officer', label: 'Store Officer' },
  { id: 'client_user', label: 'Client (Normal)' },
  { id: 'client', label: 'Client (Shared)' },
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
    setIsEditDialogOpen(true);
  };

  const handleSaveRoles = async () => {
    if (!firestore || !selectedUser) return;
    setIsSaving(true);

    try {
      const userRef = doc(firestore, 'users', selectedUser.id);
      
      // Update User Profile
      await updateDoc(userRef, {
        roleIds: editedRoles,
        isActive: isActive,
        updatedAt: Date.now()
      });

      // Update Role Collections (DBAC)
      const batch = writeBatch(firestore);
      
      for (const role of AVAILABLE_ROLES) {
        const roleDocRef = doc(firestore, `roles_${role.id}`, selectedUser.id);
        if (editedRoles.includes(role.id)) {
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

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('opsflow_user');
    window.location.href = '/';
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

  if (!currentUser.roleIds?.includes('system_admin')) {
    return (
      <AppShell user={currentUser} onLogout={handleLogout}>
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-4">
          <ShieldCheck className="h-12 w-12 text-destructive opacity-50" />
          <h2 className="text-xl font-bold">Access Denied (จำกัดสิทธิ์เข้าถึง)</h2>
          <p className="text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงหน้าจัดการผู้ใช้งานระบบ กรุณาติดต่อ System Administrator</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={handleLogout}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <ShieldCheck className="h-8 w-8" /> จัดการระบบและสิทธิ์การใช้งาน (System Admin)
          </h1>
          <p className="text-muted-foreground text-lg">
            บริหารจัดการสิทธิ์การเข้าถึง (Access Control) และตรวจสอบสถานะการใช้งานของพนักงาน
          </p>
        </div>

        <Alert variant="destructive" className="bg-destructive/5 border-destructive/20 shadow-sm">
          <ShieldAlert className="h-5 w-5 text-destructive" />
          <AlertTitle className="font-bold text-lg">การจัดการสิทธิ์ความปลอดภัย (Access Control Policy)</AlertTitle>
          <AlertDescription className="text-sm">
            การแก้ไขสิทธิ์การใช้งาน (Roles) จะมีผลทันทีในการล็อกอินครั้งถัดไป สถานะออนไลน์จะคำนวณจากเวลาล็อกอินล่าสุดเทียบกับการล็อกเอาท์
          </AlertDescription>
        </Alert>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isCollectionLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลผู้ใช้งาน...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4 pl-6">เจ้าหน้าที่ (Staff Name)</TableHead>
                    <TableHead className="font-bold">สิทธิ์การใช้งาน (Current Roles)</TableHead>
                    <TableHead className="font-bold">สถานะ (Status)</TableHead>
                    <TableHead className="font-bold">กิจกรรมล่าสุด (Recent Activity)</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users?.map((u) => {
                    const roles = u.roleIds || [];
                    const isOnline = u.lastLoginAt && (!u.lastLogoutAt || u.lastLoginAt > u.lastLogoutAt);
                    
                    return (
                      <TableRow key={u.id} className="hover:bg-muted/30 transition-all">
                        <TableCell className="py-4 pl-6">
                          <div className="flex flex-col">
                            <span className="font-bold text-base text-primary">{u.displayName}</span>
                            <span className="text-xs text-muted-foreground flex items-center gap-1 font-medium"><Mail className="h-3 w-3" /> {u.email}</span>
                          </div>
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
                              {u.isActive ? "บัญชีอนุมัติแล้ว" : "รอนุมัติ"}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          <div className="space-y-1">
                            <p className="flex items-center gap-1"><Clock className="h-3 w-3" /> Login: {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('th-TH') : 'ไม่เคยเข้าใช้งาน'}</p>
                            <p className="flex items-center gap-1"><Clock className="h-3 w-3" /> Logout: {u.lastLogoutAt ? new Date(u.lastLogoutAt).toLocaleString('th-TH') : '-'}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-right pr-6 space-x-2">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="hover:text-primary h-8 w-8"
                            onClick={() => handleEditUser(u)}
                          >
                            <UserCog className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => handleDelete(u.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!isCollectionLoading && (!users || users.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-20 text-muted-foreground italic">ไม่พบข้อมูลผู้ใช้งานระบบในฐานข้อมูล</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Edit User Dialog */}
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>แก้ไขสิทธิ์และสถานะผู้ใช้งาน</DialogTitle>
              <DialogDescription>
                ผู้ใช้งาน: <b>{selectedUser?.displayName}</b> ({selectedUser?.email})
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-6 py-4">
              <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/20">
                <div className="space-y-0.5">
                  <Label className="text-base">สถานะบัญชี (Account Approval)</Label>
                  <p className="text-sm text-muted-foreground">เปิดหรือปิดการเข้าใช้งานระบบของพนักงานรายนี้</p>
                </div>
                <Switch 
                  checked={isActive} 
                  onCheckedChange={setIsActive}
                />
              </div>

              <div className="space-y-4">
                <Label className="text-base">บทบาทและหน้าที่ (Assigned Roles)</Label>
                <div className="grid grid-cols-2 gap-4">
                  {AVAILABLE_ROLES.map((role) => (
                    <div key={role.id} className="flex items-center space-x-2 p-2 border rounded hover:bg-muted/10 transition-colors">
                      <Checkbox 
                        id={role.id} 
                        checked={editedRoles.includes(role.id)} 
                        onCheckedChange={() => toggleRole(role.id)}
                      />
                      <label 
                        htmlFor={role.id} 
                        className="text-sm font-medium leading-none cursor-pointer flex-1"
                      >
                        {role.label}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setIsEditDialogOpen(false)} disabled={isSaving}>ยกเลิก</Button>
              <Button onClick={handleSaveRoles} disabled={isSaving}>
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
                บันทึกการเปลี่ยนแปลง
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
