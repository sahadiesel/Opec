'use client';

import { useState, use, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { 
  Plus, 
  Trash2, 
  Save, 
  Users, 
  FileText, 
  ShoppingCart, 
  ArrowLeft,
  Building2,
  Phone,
  Mail,
  Star,
  ExternalLink,
  ShieldAlert,
  KeyRound,
  UserPlus,
  UserMinus,
  Lock,
  Loader2,
  CheckCircle2,
  Info
} from 'lucide-react';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { useFirestore, useDoc, useCollection, useMemoFirebase, useUser, useAuth } from '@/firebase';
import { doc, collection, query, where, limit, setDoc } from 'firebase/firestore';
import { updateDocumentNonBlocking, addDocumentNonBlocking, deleteDocumentNonBlocking, setDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Customer, ContactPerson, MainContract, PurchaseOrder, User, PortalRole } from '@/lib/types';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { CustomerProvisioningService } from '@/lib/services/customer-provisioning-service';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageGuidance } from '@/components/layout/page-guidance';

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const custRef = useMemoFirebase(() => (firestore ? doc(firestore, 'customers', id) : null), [firestore, id]);
  const { data: customer, isLoading: isCustLoading } = useDoc<Customer>(custRef as any);

  const contactsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'customers', id, 'contact_persons') : null), [firestore, id]);
  const { data: contacts } = useCollection<ContactPerson>(contactsQuery as any);

  const contractsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'main_contracts'), where('customerId', '==', id));
  }, [firestore, id]);
  const { data: customerContracts } = useCollection<MainContract>(contractsQuery as any);

  const poQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'purchase_orders'), where('customerId', '==', id));
  }, [firestore, id]);
  const { data: customerPOs } = useCollection<PurchaseOrder>(poQuery as any);

  // Portal Users Query
  const portalUsersQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'users'), where('customerId', '==', id), where('userType', '==', 'customer_portal'));
  }, [firestore, id]);
  const { data: portalUsers } = useCollection<User>(portalUsersQuery as any);

  const [isEditing, setIsEditing] = useState(false);
  const [editedCust, setEditedCust] = useState<Partial<Customer>>({});

  const [isAddContactOpen, setIsAddContactOpen] = useState(false);
  const [newContact, setNewContact] = useState<Partial<ContactPerson>>({ isPrimary: false });

  // Provisioning State
  const [isProvisioningOpen, setIsProvisioningOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newPortalUser, setNewPortalUser] = useState({
    email: '',
    displayName: '',
    portalRole: 'viewer' as PortalRole
  });

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const handleSaveMaster = () => {
    if (!custRef) return;
    updateDocumentNonBlocking(custRef, { ...editedCust, updatedAt: Date.now() });
    setIsEditing(false);
    toast({ title: "บันทึกสำเร็จ", description: "ข้อมูลลูกค้าถูกอัปเดตเรียบร้อยแล้ว" });
  };

  const handleProvisionPortalUser = async () => {
    if (!firestore || !currentUser || !customer) return;
    if (!newPortalUser.email || !newPortalUser.displayName) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาระบุอีเมลและชื่อแสดงผล" });
      return;
    }

    setIsSubmitting(true);
    const service = new CustomerProvisioningService(firestore);
    try {
      const { tempPassword } = await service.createCustomerPortalUser({
        ...newPortalUser,
        customerId: id,
        adminUser: currentUser
      });

      setIsProvisioningOpen(false);
      setNewPortalUser({ email: '', displayName: '', portalRole: 'viewer' });
      
      toast({ 
        title: "สร้างบัญชีลูกค้าสำเร็จ", 
        description: `รหัสผ่านชั่วคราวคือ: ${tempPassword} (กรุณาจดบันทึกและแจ้งลูกค้า)`,
        duration: 10000 
      });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Provisioning Error", description: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = (user: User) => {
    if (!firestore || !currentUser) return;
    const service = new CustomerProvisioningService(firestore);
    if (user.isActive) {
      service.deactivateUser(user.id, 'Manually deactivated by admin', currentUser);
      toast({ title: "ระงับการใช้งานสำเร็จ" });
    } else {
      service.activateUser(user.id, currentUser);
      toast({ title: "เปิดการใช้งานสำเร็จ" });
    }
  };

  if (isCustLoading || !customer || !currentUser) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-12 w-12 text-primary animate-spin" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/customers"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{customer.name}</h1>
              <Badge variant="outline" className="font-mono">{customer.customerCode || 'NO CODE'}</Badge>
              {customer.isActive ? (
                <Badge className="bg-green-600">Active</Badge>
              ) : (
                <Badge variant="secondary">Inactive</Badge>
              )}
            </div>
            <p className="text-muted-foreground flex items-center gap-2 mt-1">
              <Building2 className="h-4 w-4" /> Tax ID: {customer.taxId || 'N/A'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setEditedCust(customer); setIsEditing(!isEditing); }}>
              {isEditing ? 'ยกเลิก' : 'แก้ไขข้อมูล'}
            </Button>
            {isEditing && (
              <Button className="gap-2" onClick={handleSaveMaster}>
                <Save className="h-4 w-4" /> บันทึกการเปลี่ยนแปลง
              </Button>
            )}
          </div>
        </div>

        <Tabs defaultValue="info" className="w-full">
          <TabsList className="grid grid-cols-5 w-full md:w-fit h-auto p-1 bg-muted/50">
            <TabsTrigger value="info" className="gap-2 py-2 px-6"><Building2 className="h-4 w-4" /> ข้อมูลบริษัท</TabsTrigger>
            <TabsTrigger value="contacts" className="gap-2 py-2 px-6"><Users className="h-4 w-4" /> ผู้ติดต่อ</TabsTrigger>
            <TabsTrigger value="contracts" className="gap-2 py-2 px-6"><FileText className="h-4 w-4" /> สัญญาหลัก</TabsTrigger>
            <TabsTrigger value="pos" className="gap-2 py-2 px-6"><ShoppingCart className="h-4 w-4" /> ใบสั่งซื้อ (POs)</TabsTrigger>
            <TabsTrigger value="portal" className="gap-2 py-2 px-6"><Lock className="h-4 w-4" /> Portal Access</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="mt-6 space-y-6">
            <Card>
              <CardHeader><CardTitle>ข้อมูลบริษัท (Company Profile)</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>ชื่อลูกค้า / บริษัท</Label>
                    <Input disabled={!isEditing} value={isEditing ? editedCust.name : customer.name} onChange={e => setEditedCust({...editedCust, name: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>รหัสลูกค้า</Label>
                    <Input disabled={!isEditing} value={isEditing ? editedCust.customerCode : customer.customerCode} onChange={e => setEditedCust({...editedCust, customerCode: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>เลขประจำตัวผู้เสียภาษี</Label>
                    <Input disabled={!isEditing} value={isEditing ? editedCust.taxId : customer.taxId} onChange={e => setEditedCust({...editedCust, taxId: e.target.value})} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>เบอร์โทรศัพท์บริษัท</Label>
                      <Input disabled={!isEditing} value={isEditing ? editedCust.phone : customer.phone} onChange={e => setEditedCust({...editedCust, phone: e.target.value})} />
                    </div>
                    <div className="space-y-2">
                      <Label>อีเมลบริษัท</Label>
                      <Input disabled={!isEditing} value={isEditing ? editedCust.email : customer.email} onChange={e => setEditedCust({...editedCust, email: e.target.value})} />
                    </div>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>ที่อยู่จดทะเบียน (Registered Address)</Label>
                    <Textarea disabled={!isEditing} className="min-h-[100px]" value={isEditing ? editedCust.registeredAddress : customer.registeredAddress} onChange={e => setEditedCust({...editedCust, registeredAddress: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>ที่อยู่วางบิล (Billing Address)</Label>
                    <Textarea disabled={!isEditing} className="min-h-[100px]" value={isEditing ? editedCust.billingAddress : customer.billingAddress} onChange={e => setEditedCust({...editedCust, billingAddress: e.target.value})} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="portal" className="mt-6 space-y-6">
            <PageGuidance 
              title="การจัดการสิทธิ์ลูกค้า (Customer Portal Guidance)"
              tips={[
                "คุณสามารถสร้างบัญชีผู้ใช้ให้พนักงานฝั่งลูกค้าเพื่อเข้าดูความพร้อมของคนงาน (Candidate Review) หรืออนุมัติเวลา (Timesheet)",
                "บัญชีประเภท 'Approver' จะสามารถกดยืนยันรายการสำคัญได้ ส่วน 'Viewer' จะอ่านข้อมูลได้เพียงอย่างเดียว",
                "สิทธิ์ของลูกค้าถูกจำกัดให้เห็นเฉพาะข้อมูลที่มี Customer ID ตรงกันเท่านั้น เพื่อความปลอดภัยของข้อมูลโครงการอื่น"
              ]}
            />

            <Card className="shadow-md border-none overflow-hidden">
              <CardHeader className="bg-primary/5 border-b flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2 text-primary">
                    <ShieldAlert className="h-5 w-5" /> บัญชีผู้ใช้งานระบบลูกค้า (Customer Accounts)
                  </CardTitle>
                  <CardDescription>จัดการการเข้าถึงระบบ Customer Portal สำหรับบริษัทนี้</CardDescription>
                </div>
                <Dialog open={isProvisioningOpen} onOpenChange={setIsProvisioningOpen}>
                  <DialogTrigger asChild>
                    <Button className="gap-2 h-10 px-6 bg-primary font-bold shadow-sm">
                      <UserPlus className="h-4 w-4" /> สร้างบัญชีลูกค้าใหม่
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>สร้างบัญชี Customer Portal</DialogTitle>
                      <DialogDescription>ระบุข้อมูลเจ้าหน้าที่ฝั่งลูกค้าเพื่อออกสิทธิ์การเข้าใช้งาน</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label className="font-bold">ชื่อแสดงผล (Contact Name)</Label>
                        <Input 
                          placeholder="เช่น คุณสมชาย (PTT Representative)" 
                          value={newPortalUser.displayName} 
                          onChange={e => setNewPortalUser({...newPortalUser, displayName: e.target.value})} 
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="font-bold">อีเมลเข้าใช้งาน (Login Email)</Label>
                        <Input 
                          type="email" 
                          placeholder="customer@company.com" 
                          value={newPortalUser.email} 
                          onChange={e => setNewPortalUser({...newPortalUser, email: e.target.value})} 
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="font-bold">บทบาทในพอร์ทัล (Portal Role)</Label>
                        <Select 
                          value={newPortalUser.portalRole} 
                          onValueChange={(v: any) => setNewPortalUser({...newPortalUser, portalRole: v})}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="viewer">Viewer (ดูข้อมูลได้อย่างเดียว)</SelectItem>
                            <SelectItem value="approver">Approver (มีอำนาจอนุมัติงาน/เวลา)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsProvisioningOpen(false)} disabled={isSubmitting}>ยกเลิก</Button>
                      <Button onClick={handleProvisionPortalUser} className="bg-primary font-bold shadow-md" disabled={isSubmitting}>
                        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                        ยืนยันการสร้างบัญชี
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="pl-6 py-4">ชื่อผู้ใช้งาน</TableHead>
                      <TableHead>อีเมล (Login ID)</TableHead>
                      <TableHead>บทบาท (Role)</TableHead>
                      <TableHead>สถานะ</TableHead>
                      <TableHead>เข้าใช้งานล่าสุด</TableHead>
                      <TableHead className="text-right pr-6">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {portalUsers?.map(user => (
                      <TableRow key={user.id} className="hover:bg-muted/20">
                        <TableCell className="pl-6 font-bold text-primary">{user.displayName}</TableCell>
                        <TableCell className="text-xs font-medium">{user.email}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize bg-blue-50 text-blue-700 border-blue-200">
                            {user.portalRole || 'viewer'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={user.isActive ? "bg-green-600" : "bg-slate-300"}>
                            {user.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-[10px] text-muted-foreground">
                          {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('th-TH') : 'ไม่เคยเข้าใช้งาน'}
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="icon" title="Reset Password">
                              <KeyRound className="h-4 w-4 text-primary" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className={user.isActive ? "text-destructive" : "text-green-600"}
                              onClick={() => handleToggleActive(user)}
                            >
                              {user.isActive ? <UserMinus className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {(!portalUsers || portalUsers.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-20 text-muted-foreground italic">
                          ยังไม่มีบัญชีผู้ใช้งานระบบลูกค้าสำหรับบริษัทนี้
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
