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
  RefreshCw,
  Building2,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { User, BusinessRoleKey, ApprovalStatus, PermissionProfile } from '@/lib/types';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, writeBatch } from 'firebase/firestore';
import { deleteDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import { Textarea } from '@/components/ui/textarea';
import { 
  BUSINESS_ROLES, 
  isAdminUser, 
  getFieldsForBusinessRole,
  deriveBusinessRoleKey,
  getMigratedUserFields,
  normalizeUserAuthorizationFields,
  assertAtLeastOneOperationalAdminAfterChange,
  isOperationalSystemAdmin,
  countOperationalSystemAdmins,
} from '@/lib/auth-mapping';
import {
  getBaselineProfiles,
  SECURITY_SENSITIVE_FIELDS,
  profileAllowedForTargetUser,
  validateProfileAssignment,
  getUserFieldsFromPermissionProfile,
  deriveBusinessRoleKeyFromPermissionProfile,
} from '@/lib/permissions';
import { Separator } from '@/components/ui/separator';
import { sanitizeFirestorePayload } from '@/lib/utils';

export default function UsersPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [showConfirmCancel, setShowConfirmCancel] = useState(false);
  
  const [editedRole, setEditedRole] = useState<BusinessRoleKey | ''>('');
  /** Single primary profile key; filtered to same access group as target user. */
  const [editedProfileKey, setEditedProfileKey] = useState<string>('');
  const [editedStatus, setEditedStatus] = useState<ApprovalStatus>('PENDING');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const isUserAdmin = useMemo(() => isAdminUser(currentUser), [currentUser]);

  const usersQuery = useMemoFirebase(() => {
    if (!firestore || !currentUser || !isUserAdmin) return null;
    return collection(firestore, 'users');
  }, [firestore, currentUser, isUserAdmin]);

  const { data: users, isLoading: isCollectionLoading } = useCollection<User>(usersQuery as any);

  const profilesQuery = useMemoFirebase(() => {
    if (!firestore || !isUserAdmin) return null;
    return collection(firestore, 'permission_profiles');
  }, [firestore, isUserAdmin]);
  const { data: profiles } = useCollection<PermissionProfile>(profilesQuery as any);

  const eligibleProfilesForSelected = useMemo(() => {
    if (!profiles || !selectedUser) return [];
    return profiles.filter((p) => profileAllowedForTargetUser(p, selectedUser));
  }, [profiles, selectedUser]);

  const filteredUsers = useMemo(() => {
    if (!users) return [];
    return users.filter(u => {
      const name = u.displayName || '';
      const email = u.email || '';
      return name.toLowerCase().includes(searchTerm.toLowerCase()) || 
             email.toLowerCase().includes(searchTerm.toLowerCase());
    });
  }, [users, searchTerm]);

  /**
   * Detection of unsaved changes (Dirty state)
   */
  const isDirty = useMemo(() => {
    if (!selectedUser) return false;
    const initialRole = deriveBusinessRoleKey(selectedUser);
    const initialStatus = selectedUser.approvalStatus || (selectedUser.isActive ? 'ACTIVE' : 'PENDING');
    const initialNotes = selectedUser.notes || '';
    const initialProfileKey =
      selectedUser.permissionProfileKey ?? selectedUser.permissionProfileKeys?.[0] ?? '';

    const rolesChanged = editedRole !== initialRole;
    const statusChanged = editedStatus !== initialStatus;
    const notesChanged = notes !== initialNotes;
    const profileChanged = editedProfileKey !== initialProfileKey;

    return rolesChanged || statusChanged || notesChanged || profileChanged;
  }, [selectedUser, editedRole, editedStatus, notes, editedProfileKey]);

  const handleEditUser = (user: User) => {
    setSelectedUser(user);
    setEditedRole(deriveBusinessRoleKey(user));
    setEditedProfileKey(user.permissionProfileKey ?? user.permissionProfileKeys?.[0] ?? '');
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
    if (!editedRole && !editedProfileKey) {
      toast({ variant: 'destructive', title: 'ข้อมูลไม่ครบ', description: 'เลือกบทบาทหรือโปรไฟล์สิทธิ์อย่างน้อยหนึ่งรายการ' });
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
        let authPartial: Partial<User> = {};

        if (editedProfileKey && profiles) {
          const profile = profiles.find((p) => p.profileKey === editedProfileKey);
          if (!profile) {
            toast({ variant: 'destructive', title: 'ไม่พบโปรไฟล์', description: editedProfileKey });
            setIsSaving(false);
            return;
          }
          const check = validateProfileAssignment(profile, selectedUser);
          if (!check.ok) {
            toast({ variant: 'destructive', title: 'ไม่สามารถผูกโปรไฟล์นี้', description: check.message });
            setIsSaving(false);
            return;
          }
          const derivedRole = deriveBusinessRoleKeyFromPermissionProfile(profile);
          const roleFields = getFieldsForBusinessRole(derivedRole);
          const profileFields = getUserFieldsFromPermissionProfile(profile);
          authPartial = { ...roleFields, ...profileFields };
        } else if (editedRole) {
          authPartial = getFieldsForBusinessRole(editedRole as BusinessRoleKey);
        }

        authPartial = normalizeUserAuthorizationFields({
          ...authPartial,
          approvalStatus: editedStatus,
          isActive: editedStatus === 'ACTIVE',
        });

        const guard = users
          ? assertAtLeastOneOperationalAdminAfterChange(users, selectedUser.id, authPartial)
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
          title: "บันทึกข้อมูลสำเร็จ (Saved)", 
          description: `อัปเดตข้อมูลของ ${selectedUser.displayName} เรียบร้อยแล้ว` 
        });
      }, 150);

    } catch (err: any) {
      setIsSaving(false);
      toast({ variant: "destructive", title: "Save Failed", description: err.message });
    }
  };

  const handleAutoRepair = async () => {
    if (!firestore || !users || !currentUser) return;
    setIsRepairing(true);
    
    const batch = writeBatch(firestore);
    let repairedCount = 0;
    
    const baselineProfiles = getBaselineProfiles();
    const existingProfileKeys = new Set(profiles?.map(p => p.profileKey) || []);

    try {
      for (const user of users) {
        const migratedFields = getMigratedUserFields(user);
        const targetProfileKeys = migratedFields.permissionProfileKeys || [];

        for (const pk of targetProfileKeys) {
          if (!existingProfileKeys.has(pk)) {
            const baseline = baselineProfiles.find(p => p.profileKey === pk);
            if (baseline) {
              const profileRef = doc(firestore, 'permission_profiles', pk);
              batch.set(profileRef, {
                ...baseline,
                id: pk,
                updatedAt: Date.now(),
                updatedBy: currentUser.displayName + ' (Auto-Repair)'
              }, { merge: true });
              existingProfileKeys.add(pk);
            }
          }
        }

        const userRef = doc(firestore, 'users', user.id);
        batch.update(userRef, sanitizeFirestorePayload(migratedFields));
        repairedCount++;
      }

      await batch.commit();
      toast({ title: "Access Repair Complete", description: `Updated ${repairedCount} users.` });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Repair Failed", description: err.message });
    } finally {
      setIsRepairing(false);
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

  if (!isUserAdmin) {
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
              กำหนดบทบาทหรือโปรไฟล์สิทธิ์ — โปรไฟล์ต้องอยู่ในกลุ่มเดียวกับผู้ใช้ (accessGroup) เพื่อลดการมอบสิทธิ์ผิดกลุ่ม
            </p>
          </div>
          <Button variant="outline" className="gap-2 h-11 border-primary text-primary" onClick={handleAutoRepair} disabled={isRepairing}>
            {isRepairing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            ซ่อมสิทธิ์อัตโนมัติ (Full Access Repair)
          </Button>
        </div>

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
                    <TableHead>โปรไฟล์ / แผนก</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((u) => {
                    const rk = deriveBusinessRoleKey(u);
                    const dept = BUSINESS_ROLES[rk]?.dept;
                    const pk = u.permissionProfileKey ?? u.permissionProfileKeys?.[0];
                    
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
                          {u.approvalStatus === 'PENDING' && !u.assignedRoleKey && !u.permissionProfileKey ? (
                            <Badge variant="secondary" className="text-[9px] font-bold bg-amber-50 text-amber-900 border-amber-200">
                              รอแอดมินกำหนดบทบาท
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[9px] uppercase font-black bg-white border-primary/20 text-primary max-w-[280px] truncate">
                              {BUSINESS_ROLES[rk]?.labelTh || rk}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1 items-start">
                            {pk && (
                              <Badge variant="outline" className="text-[9px] font-mono max-w-[220px] truncate">
                                {pk}
                              </Badge>
                            )}
                            {dept && (
                              <Badge variant="secondary" className="text-[9px] capitalize font-bold flex items-center gap-1 bg-blue-50 text-blue-700 border-blue-100 w-fit">
                                <Building2 className="h-2 w-2" /> {dept}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full opacity-0 group-hover:opacity-100"><MoreHorizontal className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleEditUser(u)}>แก้ไขสิทธิ์ (Edit Access)</DropdownMenuItem>
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

        {/* Access Editor Modal */}
        <Dialog open={isEditDialogOpen} onOpenChange={handleOpenChange}>
          <DialogContent className="max-w-3xl border-t-8 border-t-primary max-h-[96vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-2xl flex items-center gap-3">
                <UserCog className="h-7 w-7 text-primary" /> จัดการสิทธิ์การเข้าถึง: {selectedUser?.displayName}
              </DialogTitle>
              <DialogDescription className="italic">
                เลือกโปรไฟล์สิทธิ์ (แนะนำ) หรือบทบาทเดิม — โปรไฟล์จะถูกกรองให้เหลือเฉพาะกลุ่มเดียวกับผู้ใช้
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
                    2. โปรไฟล์สิทธิ์ (Permission profile)
                  </Label>
                  <Select
                    disabled={!isUserAdmin}
                    value={editedProfileKey || '__none__'}
                    onValueChange={(v) => {
                      if (v === '__none__') {
                        setEditedProfileKey('');
                        return;
                      }
                      setEditedProfileKey(v);
                      const prof = profiles?.find((p) => p.profileKey === v);
                      if (prof) {
                        setEditedRole(deriveBusinessRoleKeyFromPermissionProfile(prof));
                      }
                    }}
                  >
                    <SelectTrigger className="h-12 font-bold border-2">
                      <SelectValue placeholder="เลือกโปรไฟล์ (กลุ่มเดียวกับผู้ใช้)" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[280px]">
                      <SelectItem value="__none__">— ไม่ใช้โปรไฟล์ (ใช้บทบาทด้านล่างแทน) —</SelectItem>
                      {eligibleProfilesForSelected.map((p) => (
                        <SelectItem key={p.profileKey} value={p.profileKey}>
                          <span className="font-mono text-xs">{p.profileKey}</span>
                          <span className="text-muted-foreground text-xs ml-2">{p.profileNameEn}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedUser && eligibleProfilesForSelected.length === 0 && (
                    <p className="text-[10px] text-amber-700">
                      ไม่มีโปรไฟล์ในกลุ่มของผู้ใช้ — สร้างโปรไฟล์ในเมนู Permission Profiles หรือใช้บทบาทด้านล่าง
                    </p>
                  )}
                </div>

                <div className="space-y-3">
                  <Label className="font-black text-primary uppercase tracking-wider text-[10px]">
                    3. บทบาทหน้าที่ (Role — เมื่อไม่ใช้โปรไฟล์)
                  </Label>
                  <Select
                    disabled={!isUserAdmin || !!editedProfileKey}
                    value={editedRole || undefined}
                    onValueChange={(v) => {
                      setEditedRole(v as BusinessRoleKey);
                      setEditedProfileKey('');
                    }}
                  >
                    <SelectTrigger className="h-12 font-bold border-2">
                      <SelectValue placeholder="เลือกบทบาทหนึ่งรายการ" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[280px]">
                      {Object.values(BUSINESS_ROLES).map((role) => (
                        <SelectItem key={role.key} value={role.key}>
                          <span className="font-medium">{role.labelTh}</span>
                          <span className="text-muted-foreground text-xs ml-2">({role.labelEn})</span>
                        </SelectItem>
                      ))}
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
                  {(editedRole || editedProfileKey) ? (
                    <div className="space-y-4">
                      {editedProfileKey && (
                        <div className="space-y-2">
                          <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-tighter">โปรไฟล์ที่เลือก</p>
                          <Badge variant="outline" className="font-mono text-[10px]">{editedProfileKey}</Badge>
                        </div>
                      )}
                      <div className="space-y-2">
                        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-tighter">แผนก / ระดับ (จากบทบาทที่เลือก)</p>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant="outline" className="bg-white capitalize text-[10px] font-black border-blue-200 text-blue-700">
                            <Building2 className="h-2.5 w-2.5 mr-1" /> {BUSINESS_ROLES[editedRole as BusinessRoleKey]?.dept}
                          </Badge>
                          <Badge variant="secondary" className="text-[10px]">
                            {BUSINESS_ROLES[editedRole as BusinessRoleKey]?.level}
                          </Badge>
                        </div>
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
                      <p className="text-xs text-muted-foreground italic">กรุณาเลือกโปรไฟล์หรือบทบาทหนึ่งรายการ</p>
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
                disabled={isSaving || (!editedRole && !editedProfileKey) || !isDirty} 
                className="bg-primary font-black h-12 px-10 shadow-lg text-lg"
              >
                {isSaving ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                บันทึกสิทธิ์
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
