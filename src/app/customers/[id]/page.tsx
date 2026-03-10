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
  Loader2
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
import { Customer, ContactPerson, MainContract, PurchaseOrder, User, ClientUser } from '@/lib/types';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail } from 'firebase/auth';
import { firebaseConfig } from '@/firebase/config';

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const auth = useAuth();
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

  const clientUserQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'client_users'), where('customerId', '==', id), limit(1));
  }, [firestore, id]);
  const { data: clientUsers } = useCollection<ClientUser>(clientUserQuery as any);
  const clientUser = clientUsers?.[0];

  const [isEditing, setIsEditing] = useState(false);
  const [editedCust, setEditedCust] = useState<Partial<Customer>>({});

  const [isAddContactOpen, setIsAddContactOpen] = useState(false);
  const [newContact, setNewContact] = useState<Partial<ContactPerson>>({ isPrimary: false });

  // Client Account State
  const [clientEmail, setClientEmail] = useState('');
  const [clientPassword, setClientPassword] = useState('');
  const [clientName, setClientName] = useState('');
  const [isCreatingClient, setIsCreatingClient] = useState(false);

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

  const handleAddContact = () => {
    if (!contactsQuery) return;
    addDocumentNonBlocking(contactsQuery, {
      ...newContact,
      name: newContact.name || '',
      department: newContact.department || '',
      role: newContact.role || '',
      phone: newContact.phone || '',
      email: newContact.email || '',
      isPrimary: newContact.isPrimary || false,
      notes: newContact.notes || ''
    });
    setIsAddContactOpen(false);
    setNewContact({ isPrimary: false });
    toast({ title: "เพิ่มผู้ติดต่อสำเร็จ" });
  };

  const deleteContact = (contactId: string) => {
    if (!firestore) return;
    if (confirm('ยืนยันการลบรายชื่อผู้ติดต่อ?')) {
      deleteDocumentNonBlocking(doc(firestore, 'customers', id, 'contact_persons', contactId));
      toast({ title: "ลบข้อมูลสำเร็จ" });
    }
  };

  const handleCreateClientAccount = async () => {
    if (!firestore || !auth || !clientEmail || !clientPassword || !clientName) return;
    setIsCreatingClient(true);
    
    try {
      // 1. Initialize secondary app to create user without logging out admin
      const secondaryApp = getApps().find(a => a.name === 'client-creator') || initializeApp(firebaseConfig, 'client-creator');
      const secondaryAuth = getAuth(secondaryApp);
      
      const cred = await createUserWithEmailAndPassword(secondaryAuth, clientEmail, clientPassword);
      const uid = cred.user.uid;
      await signOut(secondaryAuth);

      // 2. Create documents
      const now = Date.now();
      
      // client_users collection
      setDocumentNonBlocking(doc(firestore, 'client_users', uid), {
        id: uid,
        customerId: id,
        email: clientEmail,
        displayName: clientName,
        isSharedAccount: true,
        active: true,
        createdAt: now
      }, { merge: true });

      // standard users collection for login profile
      setDocumentNonBlocking(doc(firestore, 'users', uid), {
        id: uid,
        email: clientEmail,
        displayName: clientName,
        roleId: 'client',
        customerId: id,
        isActive: true,
        createdAt: now,
        updatedAt: now
      }, { merge: true });

      // role document for security rules check
      setDocumentNonBlocking(doc(firestore, 'roles_client_user', uid), {
        assignedAt: now
      }, { merge: true });

      toast({ title: "สร้างบัญชีลูกค้าสำเร็จ", description: `บัญชี ${clientEmail} พร้อมใช้งานแล้ว` });
      setClientEmail('');
      setClientPassword('');
      setClientName('');
    } catch (err: any) {
      toast({ variant: "destructive", title: "เกิดข้อผิดพลาด", description: err.message });
    } finally {
      setIsCreatingClient(false);
    }
  };

  const handleToggleClientStatus = (uid: string, currentStatus: boolean) => {
    if (!firestore) return;
    updateDocumentNonBlocking(doc(firestore, 'client_users', uid), { active: !currentStatus });
    updateDocumentNonBlocking(doc(firestore, 'users', uid), { isActive: !currentStatus });
    toast({ title: currentStatus ? "ปิดการใช้งานบัญชีแล้ว" : "เปิดการใช้งานบัญชีแล้ว" });
  };

  const handleResetClientPassword = (email: string) => {
    if (!auth) return;
    sendPasswordResetEmail(auth, email).then(() => {
      toast({ title: "ส่งลิงก์รีเซ็ตรหัสผ่านแล้ว", description: `ลิงก์ถูกส่งไปที่ ${email}` });
    }).catch(err => {
      toast({ variant: "destructive", title: "Error", description: err.message });
    });
  };

  if (isCustLoading || !customer || !currentUser) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="animate-pulse text-muted-foreground">กำลังโหลดข้อมูลลูกค้า...</div>
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
            <TabsTrigger value="client" className="gap-2 py-2 px-6"><ShieldAlert className="h-4 w-4" /> Client Login</TabsTrigger>
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

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>เครดิตเทอม (Credit Terms)</Label>
                    <Input disabled={!isEditing} value={isEditing ? editedCust.creditTerms : customer.creditTerms} onChange={e => setEditedCust({...editedCust, creditTerms: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>เงื่อนไขวางบิล (Billing Terms)</Label>
                    <Input disabled={!isEditing} value={isEditing ? editedCust.billingTerms : customer.billingTerms} onChange={e => setEditedCust({...editedCust, billingTerms: e.target.value})} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>หมายเหตุ</Label>
                  <Textarea disabled={!isEditing} value={isEditing ? editedCust.notes : customer.notes} onChange={e => setEditedCust({...editedCust, notes: e.target.value})} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="contacts" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>ผู้ติดต่อประสานงาน (Contact Persons)</CardTitle>
                  <CardDescription>รายชื่อเจ้าหน้าที่ฝั่งลูกค้าที่ใช้ประสานงาน</CardDescription>
                </div>
                <Dialog open={isAddContactOpen} onOpenChange={setIsAddContactOpen}>
                  <DialogTrigger asChild>
                    <Button className="gap-2"><Plus className="h-4 w-4" /> เพิ่มผู้ติดต่อ</Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>เพิ่มผู้ติดต่อรายใหม่</DialogTitle>
                      <DialogDescription>ระบุข้อมูลเพื่อใช้ในการประสานงาน วางบิล หรือส่งตัวคนงาน</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid gap-2">
                        <Label>ชื่อ-นามสกุล</Label>
                        <Input value={newContact.name || ''} onChange={e => setNewContact({...newContact, name: e.target.value})} />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label>แผนก</Label>
                          <Input value={newContact.department || ''} onChange={e => setNewContact({...newContact, department: e.target.value})} />
                        </div>
                        <div className="grid gap-2">
                          <Label>ตำแหน่ง</Label>
                          <Input value={newContact.role || ''} onChange={e => setNewContact({...newContact, role: e.target.value})} />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label>เบอร์โทรศัพท์</Label>
                          <Input value={newContact.phone || ''} onChange={e => setNewContact({...newContact, phone: e.target.value})} />
                        </div>
                        <div className="grid gap-2">
                          <Label>อีเมล</Label>
                          <Input value={newContact.email || ''} onChange={e => setNewContact({...newContact, email: e.target.value})} />
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox id="primary" checked={newContact.isPrimary} onCheckedChange={v => setNewContact({...newContact, isPrimary: !!v})} />
                        <Label htmlFor="primary">เป็นผู้ติดต่อหลัก (Primary Contact)</Label>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsAddContactOpen(false)}>ยกเลิก</Button>
                      <Button onClick={handleAddContact}>บันทึกผู้ติดต่อ</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ชื่อ-นามสกุล</TableHead>
                      <TableHead>แผนก / ตำแหน่ง</TableHead>
                      <TableHead>ข้อมูลติดต่อ</TableHead>
                      <TableHead className="text-right">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contacts?.map(c => (
                      <TableRow key={c.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{c.name}</span>
                            {c.isPrimary && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col text-xs">
                            <span>{c.department}</span>
                            <span className="text-muted-foreground">{c.role}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col text-xs gap-1">
                            <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {c.phone}</span>
                            <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {c.email}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deleteContact(c.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!contacts?.length && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-10 text-muted-foreground italic">ไม่มีข้อมูลผู้ติดต่อ</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="contracts" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>สัญญาหลัก (Main Contracts)</CardTitle>
                  <CardDescription>รายการสัญญาซื้อขายกำลังคนหลัก (Master Agreements)</CardDescription>
                </div>
                <Button variant="outline" className="gap-2" asChild>
                  <Link href={`/main-contracts?customerId=${id}`}><Plus className="h-4 w-4" /> สร้างสัญญาใหม่</Link>
                </Button>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>เลขที่สัญญา</TableHead>
                      <TableHead>หัวข้อสัญญา</TableHead>
                      <TableHead>ระยะเวลา</TableHead>
                      <TableHead>สถานะ</TableHead>
                      <TableHead className="text-right">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customerContracts?.map(contract => (
                      <TableRow key={contract.id}>
                        <TableCell className="font-mono text-xs">{contract.contractNumber}</TableCell>
                        <TableCell className="font-medium">{contract.title}</TableCell>
                        <TableCell className="text-xs">
                          {new Date(contract.startDate).toLocaleDateString('th-TH')} - {new Date(contract.endDate).toLocaleDateString('th-TH')}
                        </TableCell>
                        <TableCell>
                          <Badge variant={contract.status === 'active' ? 'default' : 'secondary'}>{contract.status.toUpperCase()}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" className="gap-2" onClick={() => router.push(`/main-contracts/${contract.id}`)}>
                            <ExternalLink className="h-4 w-4" /> ดูรายละเอียด
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!customerContracts?.length && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-10 text-muted-foreground italic">ไม่พบสัญญาหลักที่เชื่อมโยง</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="pos" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Customer POs (ใบสั่งซื้อจากลูกค้ารายนี้)</CardTitle>
                  <CardDescription>รายการจองโควต้ากำลังคนตามสัญญา</CardDescription>
                </div>
                <Button variant="outline" className="gap-2" asChild>
                  <Link href={`/purchase-orders?customerId=${id}`}><Plus className="h-4 w-4" /> สร้าง Customer PO</Link>
                </Button>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>เลขที่ PO</TableHead>
                      <TableHead>รายละเอียด</TableHead>
                      <TableHead>ระยะเวลา</TableHead>
                      <TableHead>สถานะ</TableHead>
                      <TableHead className="text-right">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customerPOs?.map(po => (
                      <TableRow key={po.id}>
                        <TableCell className="font-mono text-xs">{po.poNumber || po.poCode}</TableCell>
                        <TableCell className="font-medium">{po.title}</TableCell>
                        <TableCell className="text-xs">
                          {new Date(po.startDate).toLocaleDateString('th-TH')} - {new Date(po.endDate).toLocaleDateString('th-TH')}
                        </TableCell>
                        <TableCell>
                          <Badge variant={po.status === 'active' ? 'default' : 'secondary'}>{po.status.toUpperCase()}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" className="gap-2" onClick={() => router.push(`/purchase-orders/${po.id}`)}>
                            <ExternalLink className="h-4 w-4" /> ดูรายละเอียด
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!customerPOs?.length && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-10 text-muted-foreground italic">ไม่พบใบสั่งซื้อที่เชื่อมโยง</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="client" className="mt-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle>การจัดการบัญชีลูกค้า (Client Portal Login)</CardTitle>
                  <CardDescription>กำหนดบัญชีผู้ใช้งานสำหรับให้ลูกค้าเข้าดูระบบ Candidate และสถานะงาน</CardDescription>
                </CardHeader>
                <CardContent>
                  {clientUser ? (
                    <div className="space-y-6">
                      <div className="p-4 border rounded-lg bg-muted/30 flex items-start justify-between">
                        <div className="space-y-1">
                          <h4 className="font-bold text-lg">{clientUser.displayName}</h4>
                          <p className="text-sm text-muted-foreground flex items-center gap-2">
                            <Mail className="h-3.5 w-3.5" /> {clientUser.email}
                          </p>
                          <div className="flex gap-2 mt-2">
                            <Badge variant={clientUser.active ? "default" : "destructive"}>
                              {clientUser.active ? "สถานะ: พร้อมใช้งาน" : "สถานะ: ปิดใช้งาน"}
                            </Badge>
                            <Badge variant="outline" className="bg-blue-50 text-blue-700">Shared Account</Badge>
                          </div>
                        </div>
                        <div className="flex flex-col gap-2">
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="gap-2" 
                            onClick={() => handleResetClientPassword(clientUser.email)}
                          >
                            <KeyRound className="h-4 w-4" /> รีเซ็ตรหัสผ่าน
                          </Button>
                          <Button 
                            variant={clientUser.active ? "destructive" : "default"} 
                            size="sm" 
                            className="gap-2"
                            onClick={() => handleToggleClientStatus(clientUser.id, clientUser.active)}
                          >
                            {clientUser.active ? <UserMinus className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                            {clientUser.active ? "ระงับการใช้งาน" : "เปิดการใช้งาน"}
                          </Button>
                        </div>
                      </div>
                      
                      <div className="bg-amber-50 border border-amber-200 p-4 rounded-lg flex gap-3">
                        <ShieldAlert className="h-5 w-5 text-amber-600 shrink-0" />
                        <div className="text-xs text-amber-800 space-y-1">
                          <p className="font-bold">นโยบายความปลอดภัย (Security Policy)</p>
                          <p>บัญชีนี้มีสิทธิ์เข้าถึงข้อมูล Candidate และใบเซอร์ของคนงานที่ส่งให้พิจารณาเท่านั้น ไม่สามารถเข้าถึงข้อมูลต้นทุนหรือระบบฝ่ายบุคคลภายในได้</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>ชื่อแสดงผล (Display Name)</Label>
                          <Input 
                            placeholder="เช่น Shared Account - PTT Group" 
                            value={clientName} 
                            onChange={e => setClientName(e.target.value)} 
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>อีเมลเข้าใช้งาน (Email)</Label>
                          <Input 
                            type="email" 
                            placeholder="client@company.com" 
                            value={clientEmail} 
                            onChange={e => setClientEmail(e.target.value)} 
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>กำหนดรหัสผ่านเบื้องต้น</Label>
                          <Input 
                            type="password" 
                            placeholder="อย่างน้อย 6 ตัวอักษร" 
                            value={clientPassword} 
                            onChange={e => setClientPassword(e.target.value)} 
                          />
                        </div>
                      </div>
                      <div className="flex justify-end pt-4 border-t">
                        <Button 
                          className="gap-2" 
                          onClick={handleCreateClientAccount}
                          disabled={isCreatingClient || !clientEmail || !clientPassword || !clientName}
                        >
                          {isCreatingClient ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                          สร้างบัญชีผู้ใช้งานใหม่
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="space-y-6">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Client Portal Features</CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs space-y-3">
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5 bg-green-100 p-1 rounded text-green-700"><Plus className="h-3 w-3" /></div>
                      <p>พิจารณาตัวบุคคล (Candidate Review)</p>
                    </div>
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5 bg-green-100 p-1 rounded text-green-700"><Plus className="h-3 w-3" /></div>
                      <p>ตรวจสอบใบเซอร์และผลตรวจร่างกาย</p>
                    </div>
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5 bg-green-100 p-1 rounded text-green-700"><Plus className="h-3 w-3" /></div>
                      <p>แสดงความเห็นและขอเปลี่ยนตัวคนงาน</p>
                    </div>
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5 bg-green-100 p-1 rounded text-green-700"><Plus className="h-3 w-3" /></div>
                      <p>ดูประวัติการอนุมัติย้อนหลัง</p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
