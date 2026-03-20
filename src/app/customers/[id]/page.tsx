'use client';

import { useState, use, useEffect, useMemo } from 'react';
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
  ExternalLink,
  ShieldAlert,
  KeyRound,
  UserPlus,
  UserMinus,
  Lock,
  Loader2,
  CheckCircle2,
  Info,
  ChevronRight,
  XCircle,
  FileSignature
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
import { useFirestore, useDoc, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { doc, collection, query, where } from 'firebase/firestore';
import { updateDocumentNonBlocking, addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { 
  Customer, 
  ContactPerson, 
  MainContract, 
  PurchaseOrder, 
  User, 
  PortalRole,
  Assignment,
  Wave,
  WorkerWaveAcceptance,
  DailyTimesheet,
  Quotation
} from '@/lib/types';
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
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [isEditing, setIsEditing] = useState(false);
  const [editedCust, setEditedCust] = useState<Partial<Customer>>({});

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

  // --- Data Queries ---

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

  const portalUsersQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'users'), where('customerId', '==', id), where('userType', '==', 'customer_portal'));
  }, [firestore, id]);
  const { data: portalUsers } = useCollection<User>(portalUsersQuery as any);

  const quosQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'quotations'), where('customerId', '==', id));
  }, [firestore, id]);
  const { data: customerQuos } = useCollection<Quotation>(quosQuery as any);

  // --- Operational Queries for Summary ---

  const asgnQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'mobilizations'), where('customerId', '==', id), where('deploymentStatus', '==', 'ACTIVE'));
  }, [firestore, id]);
  const { data: activeAssignments } = useCollection<Assignment>(asgnQuery as any);

  const wavesQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'waves'), where('customerId', '==', id), where('status', '==', 'ACTIVE'));
  }, [firestore, id]);
  const { data: activeWaves } = useCollection<Wave>(wavesQuery as any);

  const acceptQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'worker_wave_acceptances'), where('customerId', '==', id), where('status', '==', 'pending'));
  }, [firestore, id]);
  const { data: pendingAcceptances } = useCollection<WorkerWaveAcceptance>(acceptQuery as any);

  const tsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'daily_timesheets'), where('customerId', '==', id), where('status', '==', 'OPS_REVIEWED'));
  }, [firestore, id]);
  const { data: pendingTimesheets } = useCollection<DailyTimesheet>(tsQuery as any);

  // --- Actions ---

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
        description: `รหัสผ่านชั่วคราวคือ: ${tempPassword} (กรุณาแจ้งลูกค้า)`,
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
      <div className="space-y-6 max-w-[1600px] mx-auto">
        {/* Header Section */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/customers"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{customer.name}</h1>
              <Badge variant="outline" className="font-mono text-primary bg-primary/5">{customer.customerCode || 'NO CODE'}</Badge>
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
              <Button className="gap-2 bg-primary font-bold shadow-md" onClick={handleSaveMaster}>
                <Save className="h-4 w-4" /> บันทึกการเปลี่ยนแปลง
              </Button>
            )}
          </div>
        </div>

        {/* Summary Area */}
        <div className="space-y-1.5 border-b border-dashed pb-4 mb-2">
          {/* Commercial Summary */}
          <div className="flex gap-8 px-2 text-[10px] uppercase font-black tracking-widest text-muted-foreground/60">
            <span>Quotations: <b className="text-primary">{customerQuos?.length || 0}</b></span>
            <span>Active Contracts: <b className="text-primary">{customerContracts?.filter(c => c.status === 'active').length || 0}</b></span>
            <span>Active POs: <b className="text-primary">{customerPOs?.filter(p => p.status === 'active').length || 0}</b></span>
            <span>Portal Users: <b className="text-primary">{portalUsers?.filter(u => u.isActive).length || 0}</b></span>
          </div>
          {/* Operations Summary */}
          <div className="flex gap-8 px-2 text-[10px] uppercase font-black tracking-widest text-muted-foreground/60">
            <span>Active Headcount: <b className="text-blue-600">{activeAssignments?.length || 0}</b></span>
            <span>Active Waves: <b className="text-blue-600">{activeWaves?.length || 0}</b></span>
            <span>Pending Approvals: <b className="text-amber-600">{(pendingAcceptances?.length || 0) + (pendingTimesheets?.length || 0)}</b></span>
          </div>
        </div>

        {/* Dashboard Tabs */}
        <Tabs defaultValue="info" className="w-full">
          <TabsList className="grid grid-cols-6 w-full md:w-fit h-auto p-1 bg-muted/50">
            <TabsTrigger value="info" className="gap-2 py-2 px-6"><Building2 className="h-4 w-4" /> ข้อมูลบริษัท</TabsTrigger>
            <TabsTrigger value="contacts" className="gap-2 py-2 px-6"><Users className="h-4 w-4" /> ผู้ติดต่อ</TabsTrigger>
            <TabsTrigger value="quotations" className="gap-2 py-2 px-6"><FileSignature className="h-4 w-4" /> ใบเสนอราคา</TabsTrigger>
            <TabsTrigger value="contracts" className="gap-2 py-2 px-6"><FileText className="h-4 w-4" /> สัญญาหลัก</TabsTrigger>
            <TabsTrigger value="pos" className="gap-2 py-2 px-6"><ShoppingCart className="h-4 w-4" /> ใบสั่งซื้อ (POs)</TabsTrigger>
            <TabsTrigger value="portal" className="gap-2 py-2 px-6"><Lock className="h-4 w-4" /> Portal Access</TabsTrigger>
          </TabsList>

          {/* Company Info Tab */}
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

          {/* Contacts Tab */}
          <TabsContent value="contacts" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>ผู้ติดต่อหลัก (Contact Persons)</CardTitle>
                  <CardDescription>รายชื่อเจ้าหน้าที่ฝั่งลูกค้าสำหรับการประสานงาน</CardDescription>
                </div>
                <Button className="gap-2"><Plus className="h-4 w-4" /> เพิ่มผู้ติดต่อ</Button>
              </CardHeader>
              <CardContent className="p-0 border-t">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="pl-6">ชื่อ-นามสกุล</TableHead>
                      <TableHead>ตำแหน่ง/แผนก</TableHead>
                      <TableHead>เบอร์โทรศัพท์</TableHead>
                      <TableHead>อีเมล</TableHead>
                      <TableHead className="text-right pr-6">สถานะ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contacts?.map(contact => (
                      <TableRow key={contact.id}>
                        <TableCell className="pl-6 font-bold text-primary">{contact.name}</TableCell>
                        <TableCell className="text-xs">{contact.role} ({contact.department})</TableCell>
                        <TableCell className="text-xs">{contact.phone}</TableCell>
                        <TableCell className="text-xs">{contact.email}</TableCell>
                        <TableCell className="text-right pr-6">
                          {contact.isPrimary && <Badge className="bg-blue-600">Primary</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                    {(!contacts || contacts.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-10 text-muted-foreground italic">ยังไม่มีข้อมูลผู้ติดต่อ</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Quotations Tab */}
          <TabsContent value="quotations" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>ประวัติการเสนอราคา (Quotation History)</CardTitle>
                  <CardDescription>รายการใบเสนอราคาที่ส่งให้ลูกค้าเพื่อพิจารณา</CardDescription>
                </div>
                <Button variant="outline" asChild><Link href="/quotations">จัดการทั้งหมด <ExternalLink className="h-4 w-4 ml-2" /></Link></Button>
              </CardHeader>
              <CardContent className="p-0 border-t">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="pl-6">เลขที่</TableHead>
                      <TableHead>หัวข้อโครงการ</TableHead>
                      <TableHead>วันที่ออก</TableHead>
                      <TableHead className="text-right">มูลค่ารวม</TableHead>
                      <TableHead className="text-right pr-6">สถานะ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customerQuos?.map(quo => (
                      <TableRow key={quo.id} className="cursor-pointer hover:bg-muted/5" onClick={() => router.push(`/quotations/${quo.id}`)}>
                        <TableCell className="pl-6 font-mono font-bold text-primary">{quo.quotationNo}</TableCell>
                        <TableCell className="text-sm font-medium">{quo.projectTitle}</TableCell>
                        <TableCell className="text-xs">{quo.issueDate}</TableCell>
                        <TableCell className="text-right font-bold text-primary">฿{(quo.grandTotal || 0).toLocaleString()}</TableCell>
                        <TableCell className="text-right pr-6">
                          <Badge variant={quo.status === 'accepted' ? 'default' : 'outline'} className={quo.status === 'accepted' ? 'bg-green-600' : ''}>
                            {quo.status.toUpperCase()}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                    {(!customerQuos || customerQuos.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-10 text-muted-foreground italic">ไม่พบประวัติใบเสนอราคา</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Main Contracts Tab */}
          <TabsContent value="contracts" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>สัญญาหลัก (Master Agreements)</CardTitle>
                  <CardDescription>รายการสัญญา MSA ที่กำหนดฐานราคาจ้างงาน</CardDescription>
                </div>
                <Button variant="outline" asChild><Link href="/main-contracts">ไปที่ระบบสัญญา <ExternalLink className="h-4 w-4 ml-2" /></Link></Button>
              </CardHeader>
              <CardContent className="p-0 border-t">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="pl-6">เลขที่สัญญา</TableHead>
                      <TableHead>หัวข้อสัญญา</TableHead>
                      <TableHead>ระยะเวลา</TableHead>
                      <TableHead>สกุลเงิน</TableHead>
                      <TableHead className="text-right pr-6">สถานะ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customerContracts?.map(contract => (
                      <TableRow key={contract.id} className="cursor-pointer hover:bg-muted/5" onClick={() => router.push(`/main-contracts/${contract.id}`)}>
                        <TableCell className="pl-6 font-mono font-bold text-primary">{contract.contractNumber}</TableCell>
                        <TableCell className="font-medium text-sm">{contract.title}</TableCell>
                        <TableCell className="text-[10px]">
                          {new Date(contract.startDate).toLocaleDateString('th-TH')} - {new Date(contract.endDate).toLocaleDateString('th-TH')}
                        </TableCell>
                        <TableCell>{contract.currency}</TableCell>
                        <TableCell className="text-right pr-6">
                          <Badge variant={contract.status === 'active' ? 'default' : 'secondary'}>{contract.status.toUpperCase()}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Customer POs Tab */}
          <TabsContent value="pos" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>ใบสั่งซื้อจากลูกค้า (Purchase Orders)</CardTitle>
                  <CardDescription>รายการโควต้าพนักงานและงบประมาณโครงการ</CardDescription>
                </div>
                <Button variant="outline" asChild><Link href="/purchase-orders">ไปที่ระบบใบสั่งซื้อ <ExternalLink className="h-4 w-4 ml-2" /></Link></Button>
              </CardHeader>
              <CardContent className="p-0 border-t">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="pl-6">รหัส PO</TableHead>
                      <TableHead>โครงการ</TableHead>
                      <TableHead>ระยะเวลา</TableHead>
                      <TableHead className="text-right pr-6">สถานะ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customerPOs?.map(po => (
                      <TableRow key={po.id} className="cursor-pointer hover:bg-muted/5" onClick={() => router.push(`/purchase-orders/${po.id}`)}>
                        <TableCell className="pl-6 font-mono font-bold text-primary">{po.poCode}</TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium text-sm">{po.title}</span>
                            <span className="text-[10px] text-muted-foreground uppercase">{po.projectName}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-[10px]">
                          {new Date(po.startDate).toLocaleDateString('th-TH')} - {new Date(po.endDate).toLocaleDateString('th-TH')}
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <Badge variant={po.status === 'active' ? 'default' : 'secondary'}>{po.status.toUpperCase()}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Portal Access Tab */}
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
                    <Lock className="h-5 w-5" /> บัญชีผู้ใช้งานระบบลูกค้า (Customer Accounts)
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
                              {user.isActive ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {(!portalUsers || portalUsers.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-20 text-muted-foreground italic">
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
