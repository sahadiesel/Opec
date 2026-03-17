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
  AlertTriangle
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { User, BusinessRoleKey, ApprovalStatus } from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { deleteDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
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
import { useToast } from '@/hooks/use-toast';
import { Textarea } from '@/components/ui/textarea';
import { 
  BUSINESS_ROLES, 
  isAdminUser, 
  getFieldsForBusinessRole,
  deriveBusinessRoleKey
} from '@/lib/auth-mapping';
import { Separator } from '@/components/ui/separator';

export default function UsersPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editedRole, setEditedRole] = useState<BusinessRoleKey | ''>('');
  const [editedStatus, setEditedStatus] = useState<ApprovalStatus>('PENDING');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
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

  const filteredUsers = useMemo(() => {
    if (!users) return [];
    return users.filter(u => 
      u.displayName.toLowerCase().includes(searchTerm.toLowerCase()) || 
      u.email.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [users, searchTerm]);

  const handleEditUser = (user: User) => {
    setSelectedUser(user);
    const currentRole = user.assignedRoleKey || deriveBusinessRoleKey(user);
    setEditedRole(currentRole);
    setEditedStatus(user.approvalStatus || (user.isActive ? 'ACTIVE' : 'PENDING'));
    setNotes(user.notes || '');
    setIsEditDialogOpen(true);
  };

  const handleSaveUser = async () => {
    if (!firestore || !selectedUser || !editedRole) return;
    setIsSaving(true);

    try {
      const userRef = doc(firestore, 'users', selectedUser.id);
      
      // Get all mapped fields based on business role selection
      const mappedFields = getFieldsForBusinessRole(editedRole as BusinessRoleKey);
      
      const updateData: Partial<User> = {
        ...mappedFields,
        approvalStatus: editedStatus,
        isActive: editedStatus === 'ACTIVE',
        notes: notes,
        updatedAt: Date.now()
      };

      // Initiate the update (non-blocking)
      updateDocumentNonBlocking(userRef, updateData);
      
      // We use a small delay before closing the UI to ensure the "isSaving" state
      // is clearly visible and the UI state machine cleans up correctly.
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
      toast({ 
        variant: "destructive", 
        title: "ไม่สามารถบันทึกได้ (Save Failed)", 
        description: err.message 
      });
    }
  };

  const handleDelete = (id: string) => {
    if (!firestore) return;
    if (confirm('ยืนยันการลบผู้ใช้งาน?')) {
      deleteDocumentNonBlocking(doc(firestore, 'users', id));
      toast({ title: "ลบผู้ใช้เรียบร้อยแล้ว" });
    }
  };

  if (isUserLoading || !currentUser) return null;

  if (!isUserAdmin) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <ShieldCheck className="h-12 w-12 text-destructive opacity-50" />
          <h2 className="text-xl font-bold">Access Restricted</h2>
          <p className="text-muted-foreground">Only System Administrators can manage users.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <ShieldCheck className="h-8 w-8" /> จัดการผู้ใช้งาน (User Access Management)
          </h1>
          <p className="text-muted-foreground text-lg">
            เลือกบทบาทให้ผู้ใช้ ระบบจะกำหนดข้อมูลสิทธิ์ภายในให้อัตโนมัติ (Select a role and the system will apply internal access settings automatically).
          </p>
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
                    <TableHead>บทบาทหน้าที่ (Assigned Role)</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((u) => {
                    const roleKey = u.assignedRoleKey || deriveBusinessRoleKey(u);
                    const roleInfo = BUSINESS_ROLES[roleKey];
                    
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
                          <div className="flex flex-col">
                            <span className="font-bold text-sm text-primary">{roleInfo?.labelTh || roleKey}</span>
                            <span className="text-[10px] text-muted-foreground uppercase">{roleInfo?.labelEn || 'Custom Role'}</span>
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
                <UserCog className="h-7 w-7 text-primary" /> แก้ไขการเข้าใช้งาน: {selectedUser?.displayName}
              </DialogTitle>
              <DialogDescription className="italic">
                กำหนดบทบาทหลักของพนักงานเพื่อให้ระบบตั้งค่าสิทธิ์เข้าถึงโมดูลต่าง ๆ โดยอัตโนมัติ
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 py-6">
              <div className="space-y-6">
                <div className="space-y-3">
                  <Label className="font-black text-primary uppercase tracking-wider text-[10px]">1. สถานะบัญชี (Account Status)</Label>
                  <Select value={editedStatus} onValueChange={(v: ApprovalStatus) => setEditedStatus(v)}>
                    <SelectTrigger className="h-12 font-bold text-lg border-2">
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
                  <Label className="font-black text-primary uppercase tracking-wider text-[10px]">2. บทบาทหลัก (Primary Business Role)</Label>
                  <Select value={editedRole} onValueChange={(v: BusinessRoleKey) => setEditedRole(v)}>
                    <SelectTrigger className="h-12 font-bold text-lg border-2 border-primary/20">
                      <SelectValue placeholder="เลือกบทบาท..." />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.values(BUSINESS_ROLES).map(role => (
                        <SelectItem key={role.key} value={role.key}>
                          <div className="flex flex-col text-left py-1">
                            <span className="font-bold">{role.labelTh}</span>
                            <span className="text-[10px] text-muted-foreground uppercase">{role.labelEn}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {editedRole && (
                    <p className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-md border-l-4 border-primary">
                      <Info className="h-3.5 w-3.5 inline mr-1 text-primary" />
                      {BUSINESS_ROLES[editedRole as BusinessRoleKey].descriptionTh}
                    </p>
                  )}
                </div>
              </div>

              <div className="bg-primary/5 p-6 rounded-xl border border-primary/10 space-y-4">
                <Label className="font-black text-primary flex items-center gap-2 uppercase text-[10px] tracking-widest">
                  <Shield className="h-4 w-4" /> สรุปสิทธิ์ที่จะได้รับ (Access Preview)
                </Label>
                <Separator className="bg-primary/10" />
                <div className="space-y-3">
                  {editedRole ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">สิทธิ์ระดับแผนก (Dept):</span>
                        <Badge variant="outline" className="capitalize font-bold bg-white">{BUSINESS_ROLES[editedRole as BusinessRoleKey].dept}</Badge>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">ระดับความสำคัญ (Level):</span>
                        <Badge variant="secondary" className="capitalize font-bold">{BUSINESS_ROLES[editedRole as BusinessRoleKey].level}</Badge>
                      </div>
                      
                      <div className="pt-2">
                        <p className="text-[10px] font-bold text-muted-foreground uppercase mb-2">โมดูลหลัก (Key Access):</p>
                        <div className="grid grid-cols-2 gap-2">
                          <AccessBadge roleKey={editedRole as BusinessRoleKey} module="Workers" />
                          <AccessBadge roleKey={editedRole as BusinessRoleKey} module="Payroll" />
                          <AccessBadge roleKey={editedRole as BusinessRoleKey} module="Sales" />
                          <AccessBadge roleKey={editedRole as BusinessRoleKey} module="Accounting" />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="py-10 text-center space-y-3">
                      <Clock className="h-10 w-10 mx-auto text-muted-foreground/30" />
                      <p className="text-xs text-muted-foreground italic">กรุณาเลือกบทบาทเพื่อดูตัวอย่างสิทธิ์</p>
                    </div>
                  )}
                </div>
                
                <div className="mt-auto pt-4">
                  <Label className="text-[10px] font-bold text-muted-foreground">บันทึกภายใน (Internal Notes)</Label>
                  <Textarea 
                    placeholder="ระบุเหตุผลการกำหนดสิทธิ์ หรือข้อมูลเพิ่มเติม..." 
                    className="mt-2 text-xs bg-white min-h-[80px]" 
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
                disabled={isSaving || !editedRole} 
                className="bg-primary font-black h-12 px-10 shadow-lg text-lg"
              >
                {isSaving ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Save className="h-5 w-5 mr-2" />}
                บันทึกสิทธิ์ (Apply Role)
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}

function AccessBadge({ roleKey, module }: { roleKey: BusinessRoleKey, module: string }) {
  const hasAccess = useMemo(() => {
    if (roleKey === 'system_admin') return true;
    if (module === 'Workers' && ['hr_manager', 'hr_officer', 'operations_manager', 'operations_officer'].includes(roleKey)) return true;
    if (module === 'Payroll' && ['hr_manager', 'accounting_manager', 'accounting_officer'].includes(roleKey)) return true;
    if (module === 'Sales' && ['sales_manager', 'sales_officer', 'accounting_manager'].includes(roleKey)) return true;
    if (module === 'Accounting' && ['accounting_manager', 'accounting_officer', 'sales_manager'].includes(roleKey)) return true;
    return false;
  }, [roleKey, module]);

  return (
    <div className={`flex items-center gap-2 px-2 py-1.5 rounded border text-[10px] font-bold ${hasAccess ? 'bg-green-50 border-green-200 text-green-700' : 'bg-slate-50 border-slate-100 text-slate-400 opacity-50'}`}>
      {hasAccess ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {module}
    </div>
  );
}
