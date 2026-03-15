
'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Search, 
  ShieldCheck, 
  Mail, 
  UserCog, 
  Filter, 
  ShieldAlert, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  Building2, 
  Briefcase,
  RefreshCcw,
  UserCheck,
  Save,
  MoreHorizontal,
  Wand2
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { User, DeptType, AccessLevel, ApprovalStatus } from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, updateDoc } from 'firebase/firestore';
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
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getLegacyRoles, inferDeptAndLevel, isAdminUser, getMigratedUserFields, canSeeMenu } from '@/lib/auth-mapping';

const DEPARTMENTS: { id: DeptType; label: string }[] = [
  { id: 'admin', label: 'บริหาร / ระบบ (Admin)' },
  { id: 'hr', label: 'บุคคล / HR' },
  { id: 'operations', label: 'ปฏิบัติการ / Operations' },
  { id: 'sales', label: 'การขาย / Commercial' },
  { id: 'accounting', label: 'บัญชีการเงิน / Accounting' },
  { id: 'store', label: 'คลังและจัดซื้อ / Store' },
  { id: 'client', label: 'ลูกค้า / Client' },
];

const LEVELS: { id: AccessLevel; label: string; desc: string }[] = [
  { id: 'viewer', label: 'Viewer (ผู้ดู)', desc: 'อ่านข้อมูลได้อย่างเดียว' },
  { id: 'officer', label: 'Officer (เจ้าหน้าที่)', desc: 'บันทึกข้อมูลประจำวันได้' },
  { id: 'manager', label: 'Manager (ผู้จัดการ)', desc: 'อนุมัติรายการและจัดการข้อมูลสำคัญ' },
  { id: 'admin', label: 'Admin (ผู้ดูแลระบบ)', desc: 'สิทธิ์สูงสุดในแผนก' },
];

export default function UsersPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editedDept, setEditedDept] = useState<DeptType>('hr');
  const [editedLevel, setEditedLevel] = useState<AccessLevel>('viewer');
  const [editedStatus, setEditedStatus] = useState<ApprovalStatus>('PENDING');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);

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

  const handleEditUser = (user: User) => {
    const { dept, level } = inferDeptAndLevel(user);
    setSelectedUser(user);
    setEditedDept(dept);
    setEditedLevel(level);
    setEditedStatus(user.approvalStatus || (user.isActive ? 'ACTIVE' : 'PENDING'));
    setNotes(user.notes || '');
    setIsEditDialogOpen(true);
  };

  const handleSaveUser = (newStatus?: ApprovalStatus) => {
    if (!firestore || !selectedUser) return;
    setIsSaving(true);

    const finalStatus = newStatus || editedStatus;
    const finalIsActive = finalStatus === 'ACTIVE';
    const legacyRoles = getLegacyRoles(editedDept, editedLevel);
    const userRef = doc(firestore, 'users', selectedUser.id);
    
    const updateData: Partial<User> = {
      department: editedDept,
      level: editedLevel,
      roleIds: legacyRoles,
      permissionProfileKey: `${editedDept}_${editedLevel}`,
      isActive: finalIsActive,
      approvalStatus: finalStatus,
      notes: notes,
      updatedAt: Date.now()
    };

    if (finalStatus === 'ACTIVE' && selectedUser.approvalStatus !== 'ACTIVE') {
      updateData.approvedAt = Date.now();
      updateData.approvedBy = currentUser?.displayName || 'Admin';
    }

    updateDocumentNonBlocking(userRef, updateData);
    toast({ title: "บันทึกข้อมูลสำเร็จ", description: "ข้อมูลสิทธิ์เข้าถึงถูกอัปเดตเรียบร้อยแล้ว" });
    setIsSaving(false);
    setIsEditDialogOpen(false);
  };

  const handleBulkMigration = async () => {
    if (!firestore || !users || !isUserAdmin) return;
    setIsMigrating(true);
    let count = 0;

    for (const u of users) {
      if (!u.department || !u.level || !u.approvalStatus) {
        const migratedFields = getMigratedUserFields(u);
        updateDocumentNonBlocking(doc(firestore, 'users', u.id), migratedFields);
        count++;
      }
    }
    
    toast({ title: "Migration Complete", description: `Migrated ${count} users to the new authorization model.` });
    setIsMigrating(false);
  };

  const handleDelete = (id: string) => {
    if (!firestore) return;
    if (confirm('ยืนยันการลบผู้ใช้งาน?')) {
      deleteDocumentNonBlocking(doc(firestore, 'users', id));
    }
  };

  if (isUserLoading || !currentUser) return null;

  if (!isUserAdmin) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <ShieldAlert className="h-12 w-12 text-destructive opacity-50" />
          <h2 className="text-xl font-bold">Access Restricted</h2>
          <p className="text-muted-foreground">Only System Administrators can manage users.</p>
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
              <ShieldCheck className="h-8 w-8" /> จัดการผู้ใช้งานและสิทธิ์ (Access Control)
            </h1>
            <p className="text-muted-foreground text-lg">จัดการสิทธิ์เข้าถึงตามแผนกและระดับความสำคัญ</p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="gap-2 border-amber-200 text-amber-700 hover:bg-amber-50" disabled={isMigrating}>
                {isMigrating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                Migrate User Access Fields
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>ยืนยันการอัปเกรดฐานข้อมูล?</AlertDialogTitle>
                <AlertDialogDescription>ระบบจะทำการเติมข้อมูลแผนกและระดับสิทธิ์ให้กับพนักงานที่ยังเป็นระบบเดิมโดยอัตโนมัติ</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
                <AlertDialogAction onClick={handleBulkMigration} className="bg-amber-600">ตกลง (Run Migration)</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isCollectionLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลด...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="pl-6 py-4">ชื่อ-นามสกุล</TableHead>
                    <TableHead>แผนก (Dept)</TableHead>
                    <TableHead>ระดับ (Level)</TableHead>
                    <TableHead>สถานะ</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users?.map((u) => {
                    const { dept, level } = inferDeptAndLevel(u);
                    const isLegacy = !u.department || !u.level;
                    return (
                      <TableRow key={u.id} className="hover:bg-muted/30 group transition-all">
                        <TableCell className="py-4 pl-6">
                          <div className="flex flex-col">
                            <span className="font-bold text-base text-primary">{u.displayName}</span>
                            <span className="text-[10px] text-muted-foreground">{u.email}</span>
                            {isLegacy && <Badge variant="outline" className="w-fit mt-1 text-[8px] bg-amber-50">Legacy Data</Badge>}
                          </div>
                        </TableCell>
                        <TableCell><Badge variant="outline" className="capitalize"><Building2 className="h-3 w-3 mr-1" /> {dept}</Badge></TableCell>
                        <TableCell><Badge variant="secondary" className="capitalize"><Briefcase className="h-3 w-3 mr-1" /> {level}</Badge></TableCell>
                        <TableCell>
                          <Badge className={u.approvalStatus === 'ACTIVE' ? 'bg-green-600' : 'bg-amber-500'}>
                            {u.approvalStatus || (u.isActive ? 'ACTIVE' : 'PENDING')}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleEditUser(u)}>ดู</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleEditUser(u)}>แก้ไข</DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(u.id)}>ลบ</DropdownMenuItem>
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

        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle className="text-2xl flex items-center gap-2"><UserCog className="h-6 w-6 text-primary" /> ตั้งค่าสิทธิ์พนักงาน</DialogTitle>
              <DialogDescription>จัดการการเข้าถึงของ <b>{selectedUser?.displayName}</b></DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-4">
              <div className="space-y-4">
                <div className="p-4 border rounded-lg bg-primary/5 space-y-3">
                  <Label className="font-bold flex items-center gap-2"><UserCheck className="h-4 w-4" /> สถานะสมาชิก</Label>
                  <Select value={editedStatus} onValueChange={(v: ApprovalStatus) => setEditedStatus(v)}>
                    <SelectTrigger className="h-11 font-bold"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PENDING">PENDING (รออนุมัติ)</SelectItem>
                      <SelectItem value="ACTIVE">ACTIVE (เปิดใช้งาน)</SelectItem>
                      <SelectItem value="SUSPENDED">SUSPENDED (ระงับชั่วคราว)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>แผนก (Department)</Label>
                  <Select value={editedDept} onValueChange={(v: DeptType) => setEditedDept(v)}>
                    <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DEPARTMENTS.map(d => <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>ระดับ (Level)</Label>
                  <Select value={editedLevel} onValueChange={(v: AccessLevel) => setEditedLevel(v)}>
                    <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LEVELS.map(l => <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-4 border-l pl-6">
                <Label className="font-bold text-green-600 flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> สรุปการเข้าถึง</Label>
                <div className="grid grid-cols-2 gap-2">
                  <AccessIndicator label="Dashboard" active={canSeeMenu('dashboard', editedDept, editedLevel)} />
                  <AccessIndicator label="Customers" active={canSeeMenu('customers', editedDept, editedLevel)} />
                  <AccessIndicator label="Payroll" active={canSeeMenu('worker_payroll', editedDept, editedLevel)} />
                  <AccessIndicator label="Workers" active={canSeeMenu('workers', editedDept, editedLevel)} />
                  <AccessIndicator label="Store" active={canSeeMenu('store', editedDept, editedLevel)} />
                  <AccessIndicator label="Accounting" active={canSeeMenu('billing_notes', editedDept, editedLevel)} />
                </div>
                <div className="mt-4">
                  <Label>หมายเหตุเพิ่มเติม</Label>
                  <Textarea value={notes} onChange={e => setNotes(e.target.value)} className="mt-2 min-h-[100px]" />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>ยกเลิก</Button>
              <Button onClick={() => handleSaveUser()} disabled={isSaving} className="bg-primary font-bold">
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />} บันทึกสิทธิ์
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}

function AccessIndicator({ label, active }: { label: string; active: boolean }) {
  return (
    <div className={`flex items-center justify-between p-2 rounded border text-[10px] ${active ? 'bg-green-50 border-green-100 text-green-700' : 'bg-slate-50 border-slate-100 text-slate-400'}`}>
      <span>{label}</span>
      {active ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3 opacity-20" />}
    </div>
  );
}
