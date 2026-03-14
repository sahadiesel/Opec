'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, ShieldCheck, Mail, Trash2, UserCog, Filter, ShieldAlert, CheckCircle2, XCircle, Loader2, Sparkles, Building2, Briefcase } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { User, DeptType, AccessLevel } from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, updateDoc, writeBatch } from 'firebase/firestore';
import { deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MenuKey, canSeeMenu, getLegacyRoles } from '@/lib/auth-mapping';

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

const ORG_PRESETS = [
  { name: 'พี่โจ้ (Admin/Finance)', dept: 'admin', level: 'admin' },
  { name: 'นุช (HR Manager)', dept: 'hr', level: 'manager' },
  { name: 'หญิง (HR Officer)', dept: 'hr', level: 'officer' },
  { name: 'โดม (Sales Officer)', dept: 'sales', level: 'officer' },
  { name: 'ก้อย (HR Officer)', dept: 'hr', level: 'officer' },
  { name: 'ณัฐ (Store Officer)', dept: 'store', level: 'officer' },
];

export default function UsersPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editedDept, setEditedDept] = useState<DeptType>('hr');
  const [editedLevel, setEditedLevel] = useState<AccessLevel>('viewer');
  const [isActive, setIsActive] = useState(false);
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const usersQuery = useMemoFirebase(() => {
    if (!firestore || !currentUser || currentUser.department !== 'admin') return null;
    return collection(firestore, 'users');
  }, [firestore, currentUser]);

  const { data: users, isLoading: isCollectionLoading } = useCollection<User>(usersQuery as any);

  const handleEditUser = (user: User) => {
    setSelectedUser(user);
    setEditedDept(user.department || 'hr');
    setEditedLevel(user.level || 'viewer');
    setIsActive(user.isActive);
    setNotes(user.notes || '');
    setIsEditDialogOpen(true);
  };

  const handleSaveUser = async () => {
    if (!firestore || !selectedUser) return;
    setIsSaving(true);

    try {
      const legacyRoles = getLegacyRoles(editedDept, editedLevel);
      const userRef = doc(firestore, 'users', selectedUser.id);
      
      const batch = writeBatch(firestore);
      
      // Update User Doc
      batch.update(userRef, {
        department: editedDept,
        level: editedLevel,
        roleIds: legacyRoles,
        isActive: isActive,
        notes: notes,
        updatedAt: Date.now()
      });

      // Update Role Collections (Legacy DBAC Sync)
      // This ensures existing firestore.rules still work
      const allLegacyRoles: any[] = ['system_admin', 'hr_manager', 'hr_officer', 'finance_officer', 'operations_officer', 'sales_officer', 'store_officer', 'payroll_officer', 'client'];
      
      for (const role of allLegacyRoles) {
        const roleDocRef = doc(firestore, `roles_${role}`, selectedUser.id);
        if (legacyRoles.includes(role)) {
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

  if (isUserLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <ShieldCheck className="h-8 w-8" /> จัดการผู้ใช้งานและสิทธิ์ (User Auth Management)
          </h1>
          <p className="text-muted-foreground text-lg">
            กำหนดแผนกและระดับการเข้าถึงข้อมูลตามผังองค์กร
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
                    <TableHead className="font-bold">สถานะ</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users?.map((u) => (
                    <TableRow key={u.id} className="hover:bg-muted/30 transition-all">
                      <TableCell className="py-4 pl-6">
                        <div className="flex flex-col">
                          <span className="font-bold text-base text-primary">{u.displayName}</span>
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1 font-medium"><Mail className="h-3 w-3" /> {u.email}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          <Building2 className="h-3 w-3 mr-1" /> {u.department || 'Not Assigned'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={u.level === 'admin' ? 'default' : 'secondary'} className="capitalize">
                          <Briefcase className="h-3 w-3 mr-1" /> {u.level || 'None'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={u.isActive ? "default" : "secondary"}>
                          {u.isActive ? "Active" : "Pending"}
                        </Badge>
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
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-2xl flex items-center gap-2">
                <UserCog className="h-6 w-6 text-primary" /> ตั้งค่าระดับการเข้าถึง
              </DialogTitle>
              <DialogDescription>ตั้งค่าสิทธิ์สำหรับคุณ <b>{selectedUser?.displayName}</b></DialogDescription>
            </DialogHeader>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 py-4">
              {/* Left Panel: Basic Controls */}
              <div className="space-y-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/20">
                    <Label className="font-bold">เปิดใช้งานบัญชี (Active)</Label>
                    <Switch checked={isActive} onCheckedChange={setIsActive} />
                  </div>
                  
                  <div className="space-y-2">
                    <Label>แผนก (Department)</Label>
                    <Select value={editedDept} onValueChange={(v: DeptType) => setEditedDept(v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {DEPARTMENTS.map(d => <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>ระดับสิทธิ์ (Level)</Label>
                    <Select value={editedLevel} onValueChange={(v: AccessLevel) => setEditedLevel(v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {LEVELS.map(l => <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] text-muted-foreground italic">
                      {LEVELS.find(l => l.id === editedLevel)?.desc}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>หมายเหตุ</Label>
                    <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="ระบุตำแหน่งจริงหรือหน้าที่รับผิดชอบ..." className="min-h-[80px]" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                    <Sparkles className="h-3 w-3 text-amber-500" /> Presets แนะนำ
                  </Label>
                  <div className="grid grid-cols-1 gap-1.5">
                    {ORG_PRESETS.map(p => (
                      <Button key={p.name} variant="outline" size="sm" className="justify-start text-[10px] h-8" onClick={() => { setEditedDept(p.dept as any); setEditedLevel(p.level as any); }}>
                        {p.name}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right Panel: Access Preview */}
              <div className="md:col-span-2 space-y-6 border-l pl-6">
                {(editedDept === 'admin' && editedLevel === 'admin') && (
                  <Alert variant="destructive" className="bg-amber-50 border-amber-200">
                    <ShieldAlert className="h-4 w-4 text-amber-600" />
                    <AlertTitle className="text-xs font-bold">Privileged Access Warning</AlertTitle>
                    <AlertDescription className="text-[10px]">
                      สิทธิ์ Admin/Admin สามารถเข้าถึงและแก้ไขข้อมูลได้ทุกส่วนในระบบ รวมถึงการลบข้อมูลถาวร
                    </AlertDescription>
                  </Alert>
                )}

                <div className="space-y-4">
                  <Label className="text-sm font-bold flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" /> สรุปการเข้าถึงเมนู (Menu Access Matrix)
                  </Label>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 border rounded bg-slate-50 space-y-2">
                      <p className="text-xs font-bold border-b pb-1">Commercial & Ops</p>
                      <AccessIndicator label="Customers" active={canSeeMenu('customers', editedDept, editedLevel)} />
                      <AccessIndicator label="PO / Contracts" active={canSeeMenu('main_contracts', editedDept, editedLevel)} />
                      <AccessIndicator label="Waves / Assignments" active={canSeeMenu('waves', editedDept, editedLevel)} />
                      <AccessIndicator label="Store / Inventory" active={canSeeMenu('store', editedDept, editedLevel)} />
                    </div>
                    <div className="p-3 border rounded bg-slate-50 space-y-2">
                      <p className="text-xs font-bold border-b pb-1">HR & Finance</p>
                      <AccessIndicator label="Payroll preparation" active={canSeeMenu('worker_payroll', editedDept, editedLevel)} />
                      <AccessIndicator label="Staff / Workers" active={canSeeMenu('workers', editedDept, editedLevel)} />
                      <AccessIndicator label="Tax / Billing / Receipts" active={canSeeMenu('tax_invoices', editedDept, editedLevel)} />
                      <AccessIndicator label="Cashbook / Bank" active={canSeeMenu('cashbook', editedDept, editedLevel)} />
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-primary/5 rounded-lg border-dashed border-2 border-primary/20">
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    <b>Business Logic Note:</b> ระบบ OPEC จะทำการแมพสิทธิ์ (Legacy Roles) อัตโนมัติเพื่อให้สอดคล้องกับ Security Rules ของฐานข้อมูล เพื่อความเสถียรในการทำงานข้ามแผนก
                  </p>
                </div>
              </div>
            </div>

            <DialogFooter className="bg-muted/30 p-4 -mx-6 -mb-6 border-t mt-4">
              <Button variant="outline" onClick={() => setIsEditDialogOpen(false)} disabled={isSaving}>ยกเลิก</Button>
              <Button onClick={handleSaveUser} disabled={isSaving} className="bg-primary font-bold shadow-md">
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
                บันทึกการตั้งค่าสิทธิ์
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
    <div className={`flex items-center justify-between text-[10px] ${active ? 'text-primary' : 'text-muted-foreground/40'}`}>
      <span>{label}</span>
      {active ? <CheckCircle2 className="h-3 w-3 text-green-600" /> : <XCircle className="h-3 w-3" />}
    </div>
  );
}
