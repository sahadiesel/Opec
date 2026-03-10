'use client';

import { useState, use, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
  MoreHorizontal,
  Star
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
import { useFirestore, useDoc, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { doc, collection, query, where } from 'firebase/firestore';
import { updateDocumentNonBlocking, addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Customer, ContactPerson, MainContract, PurchaseOrder, User } from '@/lib/types';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const custRef = useMemoFirebase(() => (firestore ? doc(firestore, 'customers', id) : null), [firestore, id]);
  const { data: customer, isLoading: isCustLoading } = useDoc<Customer>(custRef as any);

  const contactsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'customers', id, 'contact_persons') : null), [firestore, id]);
  const { data: contacts } = useCollection<ContactPerson>(contactsQuery as any);

  // Cross-reference: Load contracts and POs linked to this customer
  const contractsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    // In our simplified logic, main_contracts might be under customers/{id}/main_contracts
    return collection(firestore, 'customers', id, 'main_contracts');
  }, [firestore, id]);
  const { data: contracts } = useCollection<MainContract>(contractsQuery as any);

  const poQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    // Purchase orders might also be hierarchical or shared
    return collection(firestore, 'customers', id, 'purchase_orders');
  }, [firestore, id]);
  const { data: pos } = useCollection<PurchaseOrder>(poQuery as any);

  const [isEditing, setIsEditing] = useState(false);
  const [editedCust, setEditedCust] = useState<Partial<Customer>>({});

  const [isAddContactOpen, setIsAddContactOpen] = useState(false);
  const [newContact, setNewContact] = useState<Partial<ContactPerson>>({ isPrimary: false });

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
          <TabsList className="grid grid-cols-4 w-full md:w-fit h-auto p-1 bg-muted/50">
            <TabsTrigger value="info" className="gap-2 py-2 px-6"><Building2 className="h-4 w-4" /> ข้อมูลบริษัท</TabsTrigger>
            <TabsTrigger value="contacts" className="gap-2 py-2 px-6"><Users className="h-4 w-4" /> ผู้ติดต่อ</TabsTrigger>
            <TabsTrigger value="contracts" className="gap-2 py-2 px-6"><FileText className="h-4 w-4" /> สัญญาหลัก</TabsTrigger>
            <TabsTrigger value="pos" className="gap-2 py-2 px-6"><ShoppingCart className="h-4 w-4" /> ใบสั่งซื้อ</TabsTrigger>
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
                  <Link href="/main-contracts"><Plus className="h-4 w-4" /> สร้างสัญญาใหม่</Link>
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
                      <TableHead className="text-right">ดูข้อมูล</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contracts?.map(contract => (
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
                          <Button variant="ghost" size="icon" asChild><Link href="/main-contracts"><ArrowLeft className="h-4 w-4 rotate-180" /></Link></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!contracts?.length && (
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
                  <CardTitle>ใบสั่งซื้อ (Purchase Orders)</CardTitle>
                  <CardDescription>รายการจองโควต้ากำลังคนตามสัญญา</CardDescription>
                </div>
                <Button variant="outline" className="gap-2" asChild>
                  <Link href="/purchase-orders"><Plus className="h-4 w-4" /> สร้างใบสั่งซื้อใหม่</Link>
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
                      <TableHead className="text-right">ดูข้อมูล</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pos?.map(po => (
                      <TableRow key={po.id}>
                        <TableCell className="font-mono text-xs">{po.poNumber}</TableCell>
                        <TableCell className="font-medium">{po.title}</TableCell>
                        <TableCell className="text-xs">
                          {new Date(po.startDate).toLocaleDateString('th-TH')} - {new Date(po.endDate).toLocaleDateString('th-TH')}
                        </TableCell>
                        <TableCell>
                          <Badge variant={po.status === 'active' ? 'default' : 'secondary'}>{po.status.toUpperCase()}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" asChild><Link href="/purchase-orders"><ArrowLeft className="h-4 w-4 rotate-180" /></Link></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!pos?.length && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-10 text-muted-foreground italic">ไม่พบใบสั่งซื้อที่เชื่อมโยง</TableCell>
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
