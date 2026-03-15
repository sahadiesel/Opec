'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Search, 
  ShieldCheck, 
  Mail, 
  Trash2, 
  UserCog, 
  Filter, 
  ShieldAlert, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  Sparkles, 
  Building2, 
  Briefcase,
  AlertTriangle,
  RefreshCcw,
  Info,
  UserCheck,
  UserX,
  Lock,
  Clock,
  Save
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { User, DeptType, AccessLevel, ApprovalStatus } from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, updateDoc } from 'firebase/firestore';
import { deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Badge } from '@/components/ui/badge';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { canSeeMenu, getLegacyRoles, inferDeptAndLevel, isAdminUser } from '@/lib/auth-mapping';

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
  { id: 'viewer', label: 'Viewer (ผู้ดู)', desc: 'อ่านข้อมูลได้อย่างเดียว ไม่สามารถบันทึกหรือแก้ไขได้' },
  { id: 'officer', label: 'Officer (เจ้าหน้าที่)', desc: 'เข้าถึงเมนูตามแผนก และบันทึกข้อมูลประจำวันได้' },
  { id: 'manager', label: 'Manager (ผู้จัดการ)', desc: 'อนุมัติรายการ ตรวจสอบรายงาน และจัดการข้อมูลสำคัญ' },
  { id: 'admin', label: 'Admin (ผู้ดูแลระบบ)', desc: 'สิทธิ์สูงสุด จัดการสิทธิ์ผู้อื่นและตั้งค่าระบบได้' },
];

const STAFF_PRESETS = [
  { name: 'พี่โจ้ (Admin)', dept: 'admin', level: 'admin' },
  { name: 'นุช (HR Mgr)', dept: 'hr', level: 'manager' },
  { name: 'หญิง (HR Off)', dept: 'hr', level: 'officer' },
  { name: 'โดม (Sales Off)', dept: 'sales', level: 'officer' },
  { name: 'ก้อย (HR Off)', dept: 'hr', level: 'officer' },
  { name: 'ณัฐ (Store Off)', dept: 'store', level: 'officer' },
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
    setEditedStatus(user.approvalStatus || 'PENDING');
    setNotes(user.notes || '');
    setIsEditDialogOpen(true);
  };

  const handleSaveUser = async (newStatus?: ApprovalStatus) => {
    if (!firestore || !selectedUser) return;
    setIsSaving(true);

    try {
      const finalStatus = newStatus || editedStatus;
      const finalIsActive = finalStatus === 'ACTIVE';
      const legacyRoles = getLegacyRoles(editedDept, editedLevel);
      const userRef = doc(firestore, 'users', selectedUser.id);
      
      const updateData: Partial<User> = {
        department: editedDept,
        level: editedLevel,
        roleIds: legacyRoles,
        isActive: finalIsActive,
        approvalStatus: finalStatus,
        notes: notes,
        updatedAt: Date.now()
      };

      if (finalStatus === 'ACTIVE' && selectedUser.approvalStatus !== 'ACTIVE') {
        updateData.approvedAt = Date.now();
        updateData.approvedBy = currentUser?.displayName || 'Admin';
      }

      await updateDoc(userRef, updateData);

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

  const getStatusBadge = (status: ApprovalStatus, isActive: boolean) => {
    switch (status) {
      case 'ACTIVE': return <Badge className="bg-green-600">ACTIVE</Badge>;
      case 'PENDING': return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">PENDING</Badge>;
      case 'SUSPENDED': return <Badge variant="destructive">SUSPENDED</Badge>;
      case 'REJECTED': return <Badge variant="secondary">REJECTED</Badge>;
      default: return <Badge variant="outline">{isActive ? 'ACTIVE' : 'INACTIVE'}</Badge>;
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
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <ShieldCheck className="h-8 w-8" /> จัดการผู้ใช้งานและสิทธิ์ (Access Control)
          </h1>
          <p className="text-muted-foreground text-lg">
            บริหารจัดการสิทธิ์เข้าถึงตามแผนก (Department) และระดับ (Access Level)
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
                    <TableHead className="font-bold">แผนก (Department)</TableHead>
                    <TableHead className="font-bold">ระดับสิทธิ์ (Level)</TableHead>
                    <TableHead className="font-bold">สถานะการอนุมัติ</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users?.map((u) => {
                    const isLegacy = !u.department || !u.level;
                    const { dept, level } = inferDeptAndLevel(u);
                    
                    return (
                      <TableRow key={u.id} className="hover:bg-muted/30 transition-all group">
                        <TableCell className="py-4 pl-6">
                          <div className="flex flex-col">
                            <span className="font-bold text-base text-primary">{u.displayName}</span>
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1 font-medium"><Mail className="h-3 w-3" /> {u.email}</span>
                            {isLegacy && (
                              <Badge variant="outline" className="w-fit mt-1 text-[9px] bg-amber-50 text-amber-700 border-amber-200">
                                <RefreshCcw className="h-2 w-2 mr-1 animate-spin" /> Legacy / รอย้ายสิทธิ์
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={isLegacy ? "secondary" : "outline"} className="capitalize">
                            <Building2 className="h-3 w-3 mr-1" /> {dept}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={level === 'admin' ? "default" : "secondary"} className="capitalize">
                            <Briefcase className="h-3 w-3 mr-1" /> {level}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {getStatusBadge(u.approvalStatus, u.isActive)}
                        </TableCell>
                        <TableCell className="text-right pr-6 space-x-2">
                          <Button variant="ghost" size="icon" onClick={() => handleEditUser(u)}>
                            <UserCog className="h-4 w-4" />
                          </Button>
                          {currentUser.id !== u.id && (
                            <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(u.id)}>
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

        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-2xl flex items-center gap-2">
                <UserCog className="h-6 w-6 text-primary" /> จัดการสิทธิ์และการอนุมัติ
              </DialogTitle>
              <DialogDescription>ตั้งค่าสิทธิ์สำหรับคุณ <b>{selectedUser?.displayName}</b></DialogDescription>
            </DialogHeader>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 py-4">
              <div className="space-y-6">
                <div className="space-y-4">
                  <div className="p-4 border rounded-lg bg-primary/5 space-y-3">
                    <Label className="font-bold flex items-center gap-2"><UserCheck className="h-4 w-4" /> สถานะการอนุมัติ (Approval)</Label>
                    <Select value={editedStatus} onValueChange={(v: ApprovalStatus) => setEditedStatus(v)}>
                      <SelectTrigger className="h-11 font-bold"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PENDING">PENDING (รอพิจารณา)</SelectItem>
                        <SelectItem value="ACTIVE">ACTIVE (อนุมัติเข้าใช้งาน)</SelectItem>
                        <SelectItem value="SUSPENDED">SUSPENDED (ระงับสิทธิ์)</SelectItem>
                        <SelectItem value="REJECTED">REJECTED (ไม่อนุมัติ)</SelectItem>
                      </SelectContent>
                    </Select>
                    {selectedUser?.approvedBy && (
                      <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Approved by {selectedUser.approvedBy} on {new Date(selectedUser.approvedAt || 0).toLocaleDateString()}
                      </p>
                    )}
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
                    <Label>ระดับสิทธิ์ (Level)</Label>
                    <Select value={editedLevel} onValueChange={(v: AccessLevel) => setEditedLevel(v)}>
                      <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {LEVELS.map(l => <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] text-muted-foreground italic mt-1 leading-relaxed">
                      {LEVELS.find(l => l.id === editedLevel)?.desc}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>หมายเหตุ</Label>
                    <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="ระบุหน้าที่รับผิดชอบหรือสาเหตุที่ระงับสิทธิ์..." className="min-h-[80px]" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                    <Sparkles className="h-3 w-3 text-amber-500" /> Presets องค์กร
                  </Label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {STAFF_PRESETS.map(p => (
                      <Button key={p.name} variant="outline" size="sm" className="justify-start text-[9px] h-8 px-2" onClick={() => { setEditedDept(p.dept as any); setEditedLevel(p.level as any); }}>
                        {p.name}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="md:col-span-2 space-y-6 border-l pl-6">
                <div className="space-y-4">
                  <Label className="text-sm font-bold flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" /> สรุปการเข้าถึงเมนู (Menu Matrix)
                  </Label>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 border rounded bg-slate-50 space-y-2">
                      <p className="text-xs font-bold border-b pb-1 text-primary">Commercial & Ops</p>
                      <AccessIndicator label="Customers" active={canSeeMenu('customers', editedDept, editedLevel)} />
                      <AccessIndicator label="PO / Contracts" active={canSeeMenu('main_contracts', editedDept, editedLevel)} />
                      <AccessIndicator label="Waves / Assignments" active={canSeeMenu('waves', editedDept, editedLevel)} />
                      <AccessIndicator label="Store / Inventory" active={canSeeMenu('store', editedDept, editedLevel)} />
                    </div>
                    <div className="p-3 border rounded bg-slate-50 space-y-2">
                      <p className="text-xs font-bold border-b pb-1 text-primary">HR & Finance</p>
                      <AccessIndicator label="Payroll preparation" active={canSeeMenu('worker_payroll', editedDept, editedLevel)} />
                      <AccessIndicator label="Staff / Workers" active={canSeeMenu('workers', editedDept, editedLevel)} />
                      <AccessIndicator label="Tax / Billing / Receipts" active={canSeeMenu('tax_invoices', editedDept, editedLevel)} />
                      <AccessIndicator label="Cashbook / Bank" active={canSeeMenu('cashbook', editedDept, editedLevel)} />
                    </div>
                  </div>
                </div>

                {selectedUser?.roleIds && selectedUser.roleIds.length > 0 && (
                  <div className="p-4 bg-muted/20 rounded-lg">
                    <Label className="text-xs font-bold uppercase text-muted-foreground flex items-center gap-2 mb-2">
                      <Clock className="h-3 w-3" /> Legacy Role Reference
                    </Label>
                    <div className="flex flex-wrap gap-1">
                      {selectedUser.roleIds.map(role => (
                        <Badge key={role} variant="secondary" className="text-[9px] h-5">{role}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                <div className="p-4 bg-blue-50/50 rounded-lg border-dashed border-2 border-blue-200">
                  <div className="flex gap-2 mb-2">
                    <Info className="h-4 w-4 text-blue-600" />
                    <p className="text-xs font-bold text-blue-800">Operational Guidance</p>
                  </div>
                  <ul className="text-[10px] text-blue-700 list-disc pl-4 space-y-1">
                    <li>การตั้งสถานะเป็น <b>ACTIVE</b> จะเปิดสิทธิ์การล็อกอินทันที</li>
                    <li>หากต้องการยกเลิกการเข้าถึงชั่วคราว ให้ใช้สถานะ <b>SUSPENDED</b></li>
                    <li>สิทธิ์ทั้งหมดจะถูกบันทึกใน <b>User Registry</b> และ <b>Security Token</b></li>
                  </ul>
                </div>
              </div>
            </div>

            <DialogFooter className="bg-muted/30 p-4 -mx-6 -mb-6 border-t mt-4 flex flex-row items-center justify-between gap-4">
              <div className="flex gap-2">
                {editedStatus === 'PENDING' && (
                  <Button variant="default" className="bg-green-600 hover:bg-green-700 font-bold" onClick={() => handleSaveUser('ACTIVE')} disabled={isSaving}>
                    <UserCheck className="h-4 w-4 mr-2" /> อนุมัติทันที
                  </Button>
                )}
                {editedStatus === 'ACTIVE' && (
                  <Button variant="destructive" className="font-bold" onClick={() => handleSaveUser('SUSPENDED')} disabled={isSaving}>
                    <Lock className="h-4 w-4 mr-2" /> ระงับสิทธิ์
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setIsEditDialogOpen(false)} disabled={isSaving}>ยกเลิก</Button>
                <Button onClick={() => handleSaveUser()} disabled={isSaving} className="bg-primary font-bold shadow-md">
                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                  บันทึกการตั้งค่า
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}

function AccessIndicator({ label, active }: { label: string; active: boolean }) {
  return (
    <div className={`flex items-center justify-between text-[10px] ${active ? 'text-primary font-medium' : 'text-muted-foreground/40'}`}>
      <span>{label}</span>
      {active ? <CheckCircle2 className="h-3 w-3 text-green-600" /> : <XCircle className="h-3 w-3" />}
    </div>
  );
}
