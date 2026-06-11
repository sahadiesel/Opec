'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Search, 
  ShieldCheck, 
  UserCog, 
  Filter, 
  Loader2, 
  Save,
  MoreHorizontal,
  Shield,
  Clock,
  Mail,
  AlertTriangle,
  Building2,
  ShieldAlert,
  Pencil,
  Phone,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { User, BusinessRoleKey, ApprovalStatus } from '@/lib/types';
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
} from "@/components/ui/alert-dialog";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, deleteField, doc } from 'firebase/firestore';
import { deleteDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import { Textarea } from '@/components/ui/textarea';
import { 
  isAdminUser, 
  deriveBusinessRoleKey,
  getFieldsForBusinessRole,
  buildUserAuthFirestoreUpdate,
  assertAtLeastOneOperationalAdminAfterChange,
  isOperationalSystemAdmin,
  countOperationalSystemAdmins,
} from '@/lib/auth-mapping';
import {
  SECURITY_SENSITIVE_FIELDS,
  canView,
} from '@/lib/permissions';
import { Separator } from '@/components/ui/separator';
import { sanitizeFirestorePayload } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getBusinessRoleKeysSortedForSelect, getRoleCatalogEntry } from '@/lib/roles/role-catalog';
import {
  normalizeBusinessRoleKey,
} from '@/lib/role-key-normalizer';

export default function UsersPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [showConfirmCancel, setShowConfirmCancel] = useState(false);
  
  const [editedRole, setEditedRole] = useState<BusinessRoleKey | ''>('');
  const [editedStatus, setEditedStatus] = useState<ApprovalStatus>('PENDING');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [listTab, setListTab] = useState<'all' | 'pending'>('pending');

  /** แก้ไขชื่อ / อีเมล / เบอร์ (ไม่รวมสิทธิ์) */
  const [detailsEditUser, setDetailsEditUser] = useState<User | null>(null);
  const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const [showDetailsConfirmCancel, setShowDetailsConfirmCancel] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const isUserAdmin = useMemo(() => isAdminUser(currentUser), [currentUser]);
  const canViewUsers = useMemo(
    () => !!currentUser && canView(currentUser, 'system_admin'),
    [currentUser],
  );

  const roleKeysForSelect = useMemo(() => getBusinessRoleKeysSortedForSelect(), []);

  const usersQuery = useMemoFirebase(() => {
    if (!firestore || !currentUser || !canViewUsers) return null;
    return collection(firestore, 'users');
  }, [firestore, currentUser, canViewUsers]);

  const { data: users, isLoading: isCollectionLoading } = useCollection<User>(usersQuery as any);

  const pendingCount = useMemo(
    () => (users || []).filter((u) => (u.approvalStatus || 'PENDING') === 'PENDING').length,
    [users]
  );

  const filteredUsers = useMemo(() => {
    if (!users) return [];
    const base =
      listTab === 'pending'
        ? users.filter((u) => (u.approvalStatus || 'PENDING') === 'PENDING')
        : [...users].sort((a, b) => {
            const pa = (a.approvalStatus || 'PENDING') === 'PENDING' ? 0 : 1;
            const pb = (b.approvalStatus || 'PENDING') === 'PENDING' ? 0 : 1;
            if (pa !== pb) return pa - pb;
            return (b.createdAt || 0) - (a.createdAt || 0);
          });
    return base.filter((u) => {
      const name = u.displayName || '';
      const email = u.email || '';
      return (
        name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        email.toLowerCase().includes(searchTerm.toLowerCase())
      );
    });
  }, [users, searchTerm, listTab]);

  /**
   * Detection of unsaved changes (Dirty state)
   */
  const isDirty = useMemo(() => {
    if (!selectedUser) return false;
    const initialRole =
      normalizeBusinessRoleKey(deriveBusinessRoleKey(selectedUser)) ??
      deriveBusinessRoleKey(selectedUser);
    const initialStatus = selectedUser.approvalStatus || (selectedUser.isActive ? 'ACTIVE' : 'PENDING');
    const initialNotes = selectedUser.notes || '';
    const editedRoleNorm =
      editedRole ? normalizeBusinessRoleKey(editedRole) ?? editedRole : '';
    const rolesChanged = editedRoleNorm !== initialRole;
    const statusChanged = editedStatus !== initialStatus;
    const notesChanged = notes !== initialNotes;

    return rolesChanged || statusChanged || notesChanged;
  }, [selectedUser, editedRole, editedStatus, notes]);

  const isDetailsDirty = useMemo(() => {
    if (!detailsEditUser) return false;
    const p0 = (detailsEditUser.phone || '').trim();
    const p1 = editPhone.trim();
    return (
      editDisplayName.trim() !== (detailsEditUser.displayName || '').trim() ||
      editEmail.trim() !== (detailsEditUser.email || '').trim() ||
      p1 !== p0
    );
  }, [detailsEditUser, editDisplayName, editEmail, editPhone]);

  const handleOpenDetailsEdit = (user: User) => {
    setDetailsEditUser(user);
    setEditDisplayName(user.displayName || '');
    setEditEmail(user.email || '');
    setEditPhone(user.phone || '');
    setIsDetailsDialogOpen(true);
  };

  const handleDetailsOpenChange = (open: boolean) => {
    if (!open && isDetailsDirty) {
      setShowDetailsConfirmCancel(true);
    } else if (!open) {
      setIsDetailsDialogOpen(false);
      setDetailsEditUser(null);
    } else {
      setIsDetailsDialogOpen(true);
    }
  };

  const handleConfirmDetailsCancel = () => {
    setShowDetailsConfirmCancel(false);
    setIsDetailsDialogOpen(false);
    setDetailsEditUser(null);
  };

  const handleSaveDetails = () => {
    if (!firestore || !detailsEditUser || !isUserAdmin) return;
    const dn = editDisplayName.trim();
    const em = editEmail.trim();
    if (!dn) {
      toast({ variant: 'destructive', title: 'กรุณากรอกชื่อ', description: 'ชื่อที่แสดงในระบบต้องไม่ว่าง' });
      return;
    }
    if (!em || !em.includes('@')) {
      toast({ variant: 'destructive', title: 'อีเมลไม่ถูกต้อง', description: 'กรุณากรอกอีเมลในรูปแบบที่ใช้งานได้' });
      return;
    }
    setIsSavingDetails(true);
    try {
      const userRef = doc(firestore, 'users', detailsEditUser.id);
      const phoneTrim = editPhone.trim();
      const payload = sanitizeFirestorePayload({
        displayName: dn,
        email: em,
        phone: phoneTrim ? phoneTrim : deleteField(),
        updatedAt: Date.now(),
      });
      updateDocumentNonBlocking(userRef, payload);
      setTimeout(() => {
        setIsSavingDetails(false);
        setIsDetailsDialogOpen(false);
        setDetailsEditUser(null);
        toast({
          title: 'บันทึกข้อมูลผู้ใช้แล้ว',
          description:
            'อัปเดตชื่อ อีเมล หรือเบอร์ในเอกสารผู้ใช้แล้ว — หากต้องการเปลี่ยนอีเมลสำหรับเข้าสู่ระบบจริง ให้ปรับที่ Firebase Authentication ด้วย',
        });
      }, 150);
    } catch (err: any) {
      setIsSavingDetails(false);
      toast({ variant: 'destructive', title: 'บันทึกไม่สำเร็จ', description: err?.message ?? String(err) });
    }
  };

  const handleEditUser = (user: User) => {
    setSelectedUser(user);
    const rk = deriveBusinessRoleKey(user);
    setEditedRole((normalizeBusinessRoleKey(rk) ?? rk) as BusinessRoleKey);
    setEditedStatus(user.approvalStatus || (user.isActive ? 'ACTIVE' : 'PENDING'));
    setNotes(user.notes || '');
    setIsEditDialogOpen(true);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open && isDirty) {
      setShowConfirmCancel(true);
    } else if (!open) {
      setIsEditDialogOpen(false);
      setSelectedUser(null);
    } else {
      setIsEditDialogOpen(true);
    }
  };

  const handleConfirmCancel = () => {
    setShowConfirmCancel(false);
    setIsEditDialogOpen(false);
    setSelectedUser(null);
  };

  /**
   * Secured Save Action: 
   * Construct update object and strictly filter sensitive fields if not a system_admin.
   */
  const handleSaveUser = async () => {
    if (!firestore || !selectedUser || !currentUser) return;
    if (!editedRole) {
      toast({ variant: 'destructive', title: 'ข้อมูลไม่ครบ', description: 'เลือกบทบาทหน้าที่ (หัวข้อ 2)' });
      return;
    }
    setIsSaving(true);

    try {
      const userRef = doc(firestore, 'users', selectedUser.id);
      
      // Constructing update object
      let updateData: any = {
        notes: notes,
        updatedAt: Date.now()
      };

      // ONLY system_admin can modify roles and statuses.
      // This is a client-side safeguard mirrored in Firestore Rules.
      if (isUserAdmin) {
        const rk = (normalizeBusinessRoleKey(editedRole) ?? editedRole) as BusinessRoleKey;
        const roleFields = getFieldsForBusinessRole(rk);
        const authPartial = buildUserAuthFirestoreUpdate(rk, {
          approvalStatus: editedStatus,
          isActive: editedStatus === 'ACTIVE',
        });

        const guard = users
          ? assertAtLeastOneOperationalAdminAfterChange(users, selectedUser.id, {
              assignedRoleKey: rk,
              accessGroup: roleFields.accessGroup,
              approvalStatus: editedStatus,
            })
          : { ok: true as const };
        if (!guard.ok) {
          toast({ variant: 'destructive', title: 'ไม่สามารถบันทึก', description: guard.message });
          setIsSaving(false);
          return;
        }

        updateData = {
          ...updateData,
          ...authPartial,
        };
      } else {
        // If somehow a non-admin gets here (e.g. self-editing from user list)
        // We strictly strip any sensitive fields.
        SECURITY_SENSITIVE_FIELDS.forEach(f => delete updateData[f]);
      }

      updateDocumentNonBlocking(userRef, sanitizeFirestorePayload(updateData));
      
      setTimeout(() => {
        setIsSaving(false);
        setIsEditDialogOpen(false);
        setSelectedUser(null);
        toast({
          title: 'บันทึกข้อมูลสำเร็จ (Saved)',
          description: `อัปเดตข้อมูลของ ${selectedUser.displayName} แล้ว — แนะนำให้ผู้ใช้คนนั้นออกจากระบบแล้วเข้าใหม่ (หรือรีเฟรช) เพื่อให้สิทธิ์ในเครื่องตรงกับฐานข้อมูล`,
        });
      }, 150);

    } catch (err: any) {
      setIsSaving(false);
      toast({ variant: "destructive", title: "Save Failed", description: err.message });
    }
  };

  const handleDelete = (id: string) => {
    if (!firestore || !isUserAdmin || !users) return;
    const victim = users.find((u) => u.id === id);
    if (victim && isOperationalSystemAdmin(victim) && countOperationalSystemAdmins(users) <= 1) {
      toast({
        variant: 'destructive',
        title: 'ลบไม่ได้',
        description: 'ไม่สามารถลบผู้ดูแลระบบคนสุดท้าย — ต้องมีบัญชี System Admin ที่ใช้งานได้อย่างน้อย 1 บัญชี',
      });
      return;
    }
    if (confirm('ยืนยันการลบผู้ใช้งาน?')) {
      deleteDocumentNonBlocking(doc(firestore, 'users', id));
      toast({ title: "ลบผู้ใช้เรียบร้อยแล้ว" });
    }
  };

  if (isUserLoading || !currentUser) return null;

  if (!canViewUsers) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4 max-w-lg mx-auto">
          <ShieldAlert className="h-12 w-12 text-destructive opacity-50" />
          <h2 className="text-xl font-bold">ไม่มีสิทธิ์เข้าถึง</h2>
          <p className="text-muted-foreground">
            หน้าจัดการผู้ใช้และสิทธิ์สำหรับผู้ดูแลระบบ (System Admin) เท่านั้น
          </p>
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
              <ShieldCheck className="h-8 w-8 text-primary" /> จัดการผู้ใช้งาน (User Access Management)
            </h1>
            <p className="text-muted-foreground text-lg">
              กำหนดสิทธิ์ด้วย <b>บทบาทหน้าที่ (Role)</b> อย่างเดียว — บันทึกเป็น{' '}
              <span className="font-mono text-sm">assignedRoleKey</span>,{' '}
              <span className="font-mono text-sm">accessGroup</span>,{' '}
              <span className="font-mono text-sm">accessLevel</span> และลบฟิลด์เก่าที่ซ้ำ (roleId, permissionProfileKey ฯลฯ) อัตโนมัติ
            </p>
          </div>
        </div>

        <Tabs value={listTab} onValueChange={(v) => setListTab(v as 'all' | 'pending')} className="space-y-4">
          <TabsList className="h-auto flex-wrap justify-start gap-1 bg-muted/50 p-1">
            <TabsTrigger value="pending" className="gap-2 data-[state=active]:bg-amber-100 data-[state=active]:text-amber-950">
              <Clock className="h-4 w-4" />
              รออนุมัติ / ลงทะเบียนใหม่
              {pendingCount > 0 && (
                <Badge variant="secondary" className="ml-1 bg-amber-600 text-white tabular-nums">
                  {pendingCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="all" className="gap-2">
              <UserCog className="h-4 w-4" />
              ผู้ใช้ทั้งหมด
            </TabsTrigger>
          </TabsList>

          <TabsContent value={listTab} className="mt-0 space-y-4">
        {listTab === 'pending' && (
          <Alert className="border-amber-200 bg-amber-50 text-amber-950">
            <AlertTriangle className="h-4 w-4 text-amber-700" />
            <AlertTitle className="text-amber-950">คิวอนุมัติผู้ใช้ใหม่</AlertTitle>
            <AlertDescription className="text-sm">
              บัญชีสถานะ <b>PENDING</b> — กด ⋮ → <b>แก้ไขสิทธิ์</b> เลือกบทบาทหน้าที่ แล้วตั้งสถานะเป็น <b>ACTIVE</b>
            </AlertDescription>
          </Alert>
        )}

        <div className="flex items-center gap-3 bg-card p-4 rounded-lg border shadow-sm">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="ค้นหาตามชื่อ หรือ อีเมล..." 
              className="pl-9 h-11" 
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <Button variant="outline" className="h-11 gap-2"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
        </div>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isCollectionLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลผู้ใช้งาน...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="pl-6 py-4">ผู้ใช้งาน (User)</TableHead>
                    <TableHead>สถานะบัญชี</TableHead>
                    <TableHead>บทบาทหน้าที่ (Role)</TableHead>
                    <TableHead>กลุ่มสิทธิ์</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((u) => {
                    const rk = deriveBusinessRoleKey(u);
                    const roleMeta = getRoleCatalogEntry(rk);
                    return (
                      <TableRow key={u.id} className="hover:bg-muted/30 group transition-all">
                        <TableCell className="py-4 pl-6">
                          <div className="flex flex-col">
                            <span className="font-bold text-base text-primary">{u.displayName}</span>
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1 font-medium">
                              <Mail className="h-2.5 w-2.5" /> {u.email}
                            </span>
                            {u.phone && (
                              <span className="text-[10px] text-muted-foreground">{u.phone}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={u.approvalStatus === 'ACTIVE' ? 'bg-green-600' : u.approvalStatus === 'PENDING' ? 'bg-amber-500' : 'bg-destructive'}>
                            {u.approvalStatus || 'PENDING'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {u.approvalStatus === 'PENDING' && !u.assignedRoleKey ? (
                            <Badge variant="secondary" className="text-[9px] font-bold bg-amber-50 text-amber-900 border-amber-200">
                              รอแอดมินกำหนดบทบาท
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[9px] font-semibold bg-white border-primary/20 text-primary max-w-[280px] truncate">
                              {roleMeta ? `${roleMeta.displayNameTh} (${roleMeta.displayNameEn})` : rk}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1 items-start">
                            <Badge variant="outline" className="text-[9px] font-mono">
                              {u.accessGroup || roleMeta?.accessGroup || '—'}
                            </Badge>
                            <Badge variant="secondary" className="text-[9px]">
                              {u.accessLevel || roleMeta?.accessLevel || '—'}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className={`h-8 w-8 rounded-full ${(u.approvalStatus || 'PENDING') === 'PENDING' ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleOpenDetailsEdit(u)}>
                                <Pencil className="h-4 w-4 mr-2" />
                                แก้ไขข้อมูล (Edit details)
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleEditUser(u)}>
                                แก้ไขสิทธิ์ (Edit Access)
                              </DropdownMenuItem>
                              {isUserAdmin && (
                                <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(u.id)}>ลบผู้ใช้ (Delete User)</DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
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
        </Tabs>

        {/* แก้ไขชื่อ / อีเมล / เบอร์ */}
        <Dialog open={isDetailsDialogOpen} onOpenChange={handleDetailsOpenChange}>
          <DialogContent className="max-w-md border-t-8 border-t-primary">
            <DialogHeader>
              <DialogTitle className="text-xl flex items-center gap-2">
                <Pencil className="h-6 w-6 text-primary" />
                แก้ไขข้อมูลผู้ใช้
              </DialogTitle>
              <DialogDescription>
                แก้ชื่อที่แสดง อีเมลในเอกสาร และเบอร์โทร — การเข้าสู่ระบบยังผูกกับ Firebase Authentication; หากต้องการเปลี่ยนอีเมลล็อกอินจริง ให้ดำเนินการที่ Console ด้วย
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="edit-display-name">ชื่อที่แสดง (Display name)</Label>
                <Input
                  id="edit-display-name"
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  className="h-11"
                  autoComplete="name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-email" className="flex items-center gap-1">
                  <Mail className="h-3.5 w-3.5" /> อีเมล (ในเอกสารผู้ใช้)
                </Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="h-11"
                  autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-phone" className="flex items-center gap-1">
                  <Phone className="h-3.5 w-3.5" /> เบอร์โทร (ไม่บังคับ)
                </Label>
                <Input
                  id="edit-phone"
                  type="tel"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="h-11"
                  placeholder="เช่น +66812345678"
                  autoComplete="tel"
                />
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => handleDetailsOpenChange(false)} disabled={isSavingDetails}>
                ยกเลิก
              </Button>
              <Button onClick={handleSaveDetails} disabled={isSavingDetails || !isDetailsDirty} className="font-semibold">
                {isSavingDetails ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                บันทึก
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={showDetailsConfirmCancel} onOpenChange={setShowDetailsConfirmCancel}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ยืนยันการยกเลิก</AlertDialogTitle>
              <AlertDialogDescription>
                มีการแก้ข้อมูลผู้ใช้ที่ยังไม่ได้บันทึก ต้องการปิดและทิ้งการเปลี่ยนแปลงหรือไม่?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setShowDetailsConfirmCancel(false)}>แก้ไขต่อ</AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirmDetailsCancel} className="bg-destructive text-destructive-foreground">
                ทิ้งข้อมูลและยกเลิก
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Access Editor Modal */}
        <Dialog open={isEditDialogOpen} onOpenChange={handleOpenChange}>
          <DialogContent className="max-w-3xl border-t-8 border-t-primary max-h-[96vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-2xl flex items-center gap-3">
                <UserCog className="h-7 w-7 text-primary" /> จัดการสิทธิ์การเข้าถึง: {selectedUser?.displayName}
              </DialogTitle>
              <DialogDescription>
                เลือกบทบาทหน้าที่หนึ่งรายการ — ระบบบันทึกเฉพาะ{' '}
                <span className="font-mono text-xs">assignedRoleKey</span>,{' '}
                <span className="font-mono text-xs">accessGroup</span>,{' '}
                <span className="font-mono text-xs">accessLevel</span> และลบฟิลด์เก่าที่ซ้ำ (โปรไฟล์สิทธิ์ / roleId ฯลฯ) อัตโนมัติ
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 py-4">
              <div className="space-y-6">
                <div className="space-y-3">
                  <Label className="font-black text-primary uppercase tracking-wider text-[10px]">1. สถานะบัญชี (Account status)</Label>
                  <Select 
                    disabled={!isUserAdmin}
                    value={editedStatus} 
                    onValueChange={(v: ApprovalStatus) => setEditedStatus(v)}
                  >
                    <SelectTrigger className="h-12 font-bold border-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PENDING">PENDING (รออนุมัติ)</SelectItem>
                      <SelectItem value="ACTIVE">ACTIVE (เปิดใช้งานปกติ)</SelectItem>
                      <SelectItem value="SUSPENDED">SUSPENDED (ระงับชั่วคราว)</SelectItem>
                      <SelectItem value="REJECTED">REJECTED (ไม่อนุมัติ)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-3">
                  <Label className="font-black text-primary uppercase tracking-wider text-[10px]">
                    2. บทบาทหน้าที่ (Role)
                  </Label>
                  <p className="text-[10px] text-muted-foreground -mt-1">
                    เลือกบทบาทเดียว — บันทึก assignedRoleKey + accessGroup/accessLevel และลบฟิลด์เก่าที่ซ้ำอัตโนมัติ
                  </p>
                  <Select
                    disabled={!isUserAdmin}
                    value={editedRole || undefined}
                    onValueChange={(v) => {
                      const rk = (normalizeBusinessRoleKey(v) ?? v) as BusinessRoleKey;
                      setEditedRole(rk);
                    }}
                  >
                    <SelectTrigger className="h-12 font-bold border-2">
                      <SelectValue placeholder="เลือกบทบาทหนึ่งรายการ" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[min(70vh,440px)] overflow-y-auto">
                      {roleKeysForSelect.map((roleKey) => {
                        const role = getRoleCatalogEntry(roleKey);
                        if (!role) return null;
                        return (
                        <SelectItem key={role.key} value={role.key}>
                          <span className="font-medium">{role.displayNameTh}</span>
                          <span className="text-muted-foreground text-xs ml-2">({role.displayNameEn})</span>
                        </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="bg-primary/5 p-6 rounded-xl border border-primary/10 space-y-4 flex flex-col">
                <Label className="font-black text-primary flex items-center gap-2 uppercase text-[10px] tracking-widest">
                  <Shield className="h-4 w-4" /> สรุป (ชั่วคราว)
                </Label>
                <Separator className="bg-primary/10" />
                <div className="space-y-4 flex-1">
                  {editedRole ? (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <p className="text-[9px] font-bold text-muted-foreground tracking-tight">
                          แผนก / ระดับ / คีย์ที่จะบันทึก
                        </p>
                        {(() => {
                          const selectedMeta = getRoleCatalogEntry(editedRole || null);
                          const saveKey =
                            (editedRole && (normalizeBusinessRoleKey(editedRole) ?? editedRole)) || '—';
                          return (
                        <div className="flex flex-wrap gap-1 items-center">
                          <Badge variant="outline" className="bg-white text-[10px] font-medium border-blue-200 text-blue-700">
                            <Building2 className="h-2.5 w-2.5 mr-1" /> {selectedMeta?.department || '—'}
                          </Badge>
                          <Badge variant="secondary" className="text-[10px]">
                            {selectedMeta?.accessLevel || '—'}
                          </Badge>
                          <Badge variant="outline" className="font-mono text-[10px] normal-case">
                            assignedRoleKey: {saveKey}
                          </Badge>
                        </div>
                          );
                        })()}
                      </div>
                      <Separator className="bg-primary/10" />
                      {!isUserAdmin && (
                        <Alert variant="destructive" className="bg-red-50 py-2 border-red-100">
                          <AlertTriangle className="h-3 w-3" />
                          <AlertDescription className="text-[9px] font-bold">เฉพาะแอดมินเท่านั้นที่สามารถเปลี่ยนบทบาทได้</AlertDescription>
                        </Alert>
                      )}
                    </div>
                  ) : (
                    <div className="py-20 text-center space-y-3">
                      <Clock className="h-10 w-10 mx-auto text-muted-foreground/30" />
                      <p className="text-xs text-muted-foreground italic">กรุณาเลือกบทบาทหน้าที่</p>
                    </div>
                  )}
                </div>
                
                <div className="pt-4 border-t border-primary/10">
                  <Label className="text-[10px] font-bold text-muted-foreground">บันทึกภายใน (Internal Notes)</Label>
                  <Textarea 
                    placeholder="ระบุเหตุผลการกำหนดสิทธิ์..." 
                    className="mt-2 text-xs bg-white min-h-[100px]" 
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <DialogFooter className="bg-muted/30 -mx-6 -mb-6 p-6 mt-4 gap-3 border-t">
              <Button 
                variant="outline" 
                className="h-12 px-8" 
                onClick={() => handleOpenChange(false)} 
                disabled={isSaving}
              >
                ยกเลิก
              </Button>
              <Button 
                onClick={handleSaveUser} 
                disabled={isSaving || !editedRole} 
                className="bg-primary font-black h-12 px-10 shadow-lg text-lg"
                title={isDirty ? 'บันทึกการเปลี่ยนแปลง' : 'บันทึกซ้ำเพื่อรีเฟรชฟิลด์สิทธิ์ (เช่นรอบ migrate rules)'}
              >
                {isSaving ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                {isDirty ? 'บันทึกสิทธิ์' : 'บันทึกสิทธิ์ (รีเฟรช)'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Unsaved Changes Confirmation */}
        <AlertDialog open={showConfirmCancel} onOpenChange={setShowConfirmCancel}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ยืนยันการยกเลิก</AlertDialogTitle>
              <AlertDialogDescription>
                มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก ต้องการยกเลิกและทิ้งข้อมูลที่แก้ไขหรือไม่?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setShowConfirmCancel(false)}>แก้ไขต่อ</AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirmCancel} className="bg-destructive text-destructive-foreground">ทิ้งข้อมูลและยกเลิก</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppShell>
  );
}
