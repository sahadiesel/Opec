
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
  CheckCircle2, 
  XCircle, 
  Loader2, 
  UserCheck,
  Save,
  MoreHorizontal,
  Info,
  Shield,
  Clock,
  Mail,
  AlertTriangle,
  RefreshCw
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
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, writeBatch } from 'firebase/firestore';
import { deleteDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  BUSINESS_ROLES, 
  isAdminUser, 
  getFieldsForBusinessRoles,
  deriveBusinessRoleKeys,
  getMigratedUserFields
} from '@/lib/auth-mapping';
import { getBaselineProfiles } from '@/lib/permissions';
import { Separator } from '@/components/ui/separator';

export default function UsersPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editedRoles, setEditedRoles] = useState<BusinessRoleKey[]>([]);
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

  const filteredUsers = useMemo(() => {
    if (!users) return [];
    return users.filter(u => {
      const name = u.displayName || '';
      const email = u.email || '';
      return name.toLowerCase().includes(searchTerm.toLowerCase()) || 
             email.toLowerCase().includes(searchTerm.toLowerCase());
    });
  }, [users, searchTerm]);

  const handleEditUser = (user: User) => {
    setSelectedUser(user);
    const roles = deriveBusinessRoleKeys(user);
    setEditedRoles(roles);
    setEditedStatus(user.approvalStatus || (user.isActive ? 'ACTIVE' : 'PENDING'));
    setNotes(user.notes || '');
    setIsEditDialogOpen(true);
  };

  const handleSaveUser = async () => {
    if (!firestore || !selectedUser || editedRoles.length === 0) return;
    setIsSaving(true);

    try {
      const userRef = doc(firestore, 'users', selectedUser.id);
      const mappedFields = getFieldsForBusinessRoles(editedRoles);
      
      const updateData: Partial<User> = {
        ...mappedFields,
        approvalStatus: editedStatus,
        isActive: editedStatus === 'ACTIVE',
        notes: notes,
        updatedAt: Date.now()
      };

      updateDocumentNonBlocking(userRef, updateData);
      
      setTimeout(() => {
        setIsSaving(false);
        setIsEditDialogOpen(false);
        toast({ 
          title: "บันทึกข้อมูลสำเร็จ (Saved)", 
          description: `อัปเดตสิทธิ์ของ ${selectedUser.displayName} เรียบร้อยแล้ว` 
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
        batch.update(userRef, migratedFields);
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
    if (!firestore) return;
    if (confirm('ยืนยันการลบผู้ใช้งาน?')) {
      deleteDocumentNonBlocking(doc(firestore, 'users', id));
      toast({ title: "ลบผู้ใช้เรียบร้อยแล้ว" });
    }
  };

  const toggleRole = (roleKey: BusinessRoleKey) => {
    setEditedRoles(prev => 
      prev.includes(roleKey) 
        ? prev.filter(r => r !== roleKey) 
        : [...prev, roleKey]
    );
  };

  if (isUserLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
              <ShieldCheck className="h-8 w-8 text-primary" /> จัดการผู้ใช้งาน (User Access Management)
            </h1>
            <p className="text-muted-foreground text-lg">
              กำหนดบทบาทหน้าที่และสิทธิ์การใช้งานระบบ (Multi-role support enabled).
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
                    <TableHead>บทบาทหน้าที่ (Assigned Roles)</TableHead>
                    <TableHead>สิทธิ์เชิงแผนก</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((u) => {
                    const roles = deriveBusinessRoleKeys(u);
                    const isInternal = u.userType !== 'customer_portal';
                    
                    return (
                      <TableRow key={u.id} className="hover:bg-muted/30 group transition-all">
                        <TableCell className="py-4 pl-6">
                          <div className="flex flex-col">
                            <span className="font-bold text-base text-primary">{u.displayName}</span>
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1 font-medium">
                              <Mail className="h-2.5 w-2.5" /> {u.email}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={u.approvalStatus === 'ACTIVE' ? 'bg-green-600' : u.approvalStatus === 'PENDING' ? 'bg-amber-500' : 'bg-destructive'}>
                            {u.approvalStatus || 'PENDING'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {roles.map(rk => {
                              const info = BUSINESS_ROLES[rk];
                              return (
                                <Badge key={rk} variant="outline" className="text-[9px] uppercase font-bold bg-white">
                                  {info?.labelTh || rk}
                                </Badge>
                              );
                            })}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Badge variant="secondary" className="text-[9px] capitalize">{u.department}</Badge>
                            <Badge variant="outline" className="text-[9px] capitalize">{u.level}</Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full opacity-0 group-hover:opacity-100"><MoreHorizontal className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleEditUser(u)}>แก้ไขสิทธิ์ (Edit Access)</DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(u.id)}>ลบผู้ใช้ (Delete User)</DropdownMenuItem>
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
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="max-w-3xl border-t-8 border-t-primary">
            <DialogHeader>
              <DialogTitle className="text-2xl flex items-center gap-3">
                <UserCog className="h-7 w-7 text-primary" /> จัดการสิทธิ์การเข้าถึง: {selectedUser?.displayName}
              </DialogTitle>
              <DialogDescription className="italic">
                กำหนดบทบาทหน้าที่ของพนักงาน (Multiple roles allowed).
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 py-6">
              <div className="space-y-6">
                <div className="space-y-3">
                  <Label className="font-black text-primary uppercase tracking-wider text-[10px]">1. สถานะบัญชี (Account Status)</Label>
                  <Select value={editedStatus} onValueChange={(v: ApprovalStatus) => setEditedStatus(v)}>
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
                  <Label className="font-black text-primary uppercase tracking-wider text-[10px]">2. บทบาทหน้าที่ (Assigned Roles)</Label>
                  <ScrollArea className="h-[300px] border rounded-md p-4 bg-muted/10">
                    <div className="space-y-4">
                      {Object.values(BUSINESS_ROLES).map(role => (
                        <div key={role.key} className="flex items-start space-x-3 p-2 hover:bg-white rounded transition-colors">
                          <Checkbox 
                            id={`role-${role.key}`} 
                            checked={editedRoles.includes(role.key)}
                            onCheckedChange={() => toggleRole(role.key)}
                          />
                          <div className="grid gap-1.5 leading-none">
                            <Label htmlFor={`role-${role.key}`} className="font-bold text-sm cursor-pointer">
                              {role.labelTh}
                            </Label>
                            <p className="text-[9px] text-muted-foreground uppercase">{role.labelEn}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              </div>

              <div className="bg-primary/5 p-6 rounded-xl border border-primary/10 space-y-4 flex flex-col">
                <Label className="font-black text-primary flex items-center gap-2 uppercase text-[10px] tracking-widest">
                  <Shield className="h-4 w-4" /> สรุปสิทธิ์ที่จะได้รับ (Access Preview)
                </Label>
                <Separator className="bg-primary/10" />
                <div className="space-y-4 flex-1">
                  {editedRoles.length > 0 ? (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <p className="text-[9px] font-bold text-muted-foreground uppercase">แผนกที่เกี่ยวข้อง (Departments):</p>
                        <div className="flex flex-wrap gap-1">
                          {Array.from(new Set(editedRoles.map(rk => BUSINESS_ROLES[rk]?.dept))).map(d => (
                            <Badge key={d} variant="outline" className="bg-white capitalize text-[10px]">{d}</Badge>
                          ))}
                        </div>
                      </div>
                      <Separator className="bg-primary/10" />
                      <p className="text-[10px] text-muted-foreground italic leading-relaxed">
                        ระบบจะรวมสิทธิ์การเข้าถึงจากทุกโปรไฟล์ที่เลือกแบบสะสม (Additive Permissions).
                      </p>
                    </div>
                  ) : (
                    <div className="py-20 text-center space-y-3">
                      <Clock className="h-10 w-10 mx-auto text-muted-foreground/30" />
                      <p className="text-xs text-muted-foreground italic">กรุณาเลือกบทบาทอย่างน้อย 1 รายการ</p>
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

            <DialogFooter className="bg-muted/30 -mx-6 -mb-6 p-6 mt-4 gap-3">
              <Button variant="outline" className="h-12 px-8" onClick={() => setIsEditDialogOpen(false)} disabled={isSaving}>ยกเลิก</Button>
              <Button 
                onClick={handleSaveUser} 
                disabled={isSaving || editedRoles.length === 0} 
                className="bg-primary font-black h-12 px-10 shadow-lg text-lg"
              >
                {isSaving ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Save className="h-5 w-5 mr-2" />}
                บันทึกสิทธิ์ (Apply Changes)
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
