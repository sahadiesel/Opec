'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, Building2, Trash2, ChevronRight, Filter } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Customer, User } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { deleteDocumentNonBlocking, addDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';

export default function CustomersPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const customersQuery = useMemoFirebase(() => {
    if (!firestore || isUserLoading || !firebaseUser) return null;
    return collection(firestore, 'customers');
  }, [firestore, isUserLoading, firebaseUser]);

  const { data: customers, isLoading } = useCollection<Customer>(customersQuery as any);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState<Partial<Customer>>({
    name: '',
    customerCode: '',
    taxId: '',
    registeredAddress: '',
    billingAddress: '',
    phone: '',
    email: '',
    billingTerms: '',
    creditTerms: '30 Days',
    isActive: true,
    notes: ''
  });

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) {
      try {
        setUser(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to parse user session', e);
      }
    }
  }, []);

  const handleCreate = async () => {
    if (!firestore) return;
    const custRef = collection(firestore, 'customers');
    
    try {
      const docRef = await addDocumentNonBlocking(custRef, {
        ...newCustomer,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      
      setIsCreateOpen(false);
      toast({
        title: "ลงทะเบียนลูกค้าสำเร็จ",
        description: "กำลังนำคุณไปที่หน้าจัดการข้อมูลผู้ติดต่อและสัญญา...",
      });
      
      if (docRef) {
        router.push(`/customers/${docRef.id}`);
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "เกิดข้อผิดพลาด",
        description: "ไม่สามารถบันทึกข้อมูลลูกค้าได้",
      });
    }
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!firestore) return;
    if (confirm('ยืนยันการลบข้อมูลลูกค้า? ข้อมูลย่อยทั้งหมดจะถูกลบด้วย')) {
      deleteDocumentNonBlocking(doc(firestore, 'customers', id));
      toast({ title: "ลบข้อมูลสำเร็จ" });
    }
  };

  if (isUserLoading || !user) return null;

  return (
    <AppShell user={user} onLogout={() => {}}>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary flex items-center gap-2">
              <Building2 className="h-6 w-6" /> ลูกค้า (Customer Management)
            </h1>
            <p className="text-muted-foreground">จัดการข้อมูลบริษัท คู่ค้า และผู้ติดต่อประสานงาน</p>
          </div>
          
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" /> ลงทะเบียนลูกค้าใหม่
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>ลงทะเบียนลูกค้าใหม่</DialogTitle>
                <DialogDescription>กรอกข้อมูลบริษัทเพื่อเริ่มต้นสร้างสัญญาและใบสั่งซื้อ</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4 py-4">
                <div className="grid gap-2 col-span-2">
                  <Label>ชื่อบริษัท (Company Name)</Label>
                  <Input value={newCustomer.name} onChange={e => setNewCustomer({...newCustomer, name: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label>รหัสลูกค้า (Customer Code)</Label>
                  <Input value={newCustomer.customerCode} onChange={e => setNewCustomer({...newCustomer, customerCode: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label>เลขประจำตัวผู้เสียภาษี (Tax ID)</Label>
                  <Input value={newCustomer.taxId} onChange={e => setNewCustomer({...newCustomer, taxId: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label>เบอร์โทรศัพท์บริษัท</Label>
                  <Input value={newCustomer.phone} onChange={e => setNewCustomer({...newCustomer, phone: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label>อีเมลกลาง</Label>
                  <Input value={newCustomer.email} onChange={e => setNewCustomer({...newCustomer, email: e.target.value})} />
                </div>
                <div className="grid gap-2 col-span-2">
                  <Label>ที่อยู่จดทะเบียน (Registered Address)</Label>
                  <Textarea value={newCustomer.registeredAddress} onChange={e => setNewCustomer({...newCustomer, registeredAddress: e.target.value})} />
                </div>
                <div className="grid gap-2 col-span-2">
                  <Label>ที่อยู่วางบิล (Billing Address)</Label>
                  <Textarea value={newCustomer.billingAddress} onChange={e => setNewCustomer({...newCustomer, billingAddress: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label>เครดิตเทอม (Credit Terms)</Label>
                  <Input value={newCustomer.creditTerms} onChange={e => setNewCustomer({...newCustomer, creditTerms: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label>เงื่อนไขวางบิล (Billing Terms)</Label>
                  <Input value={newCustomer.billingTerms} onChange={e => setNewCustomer({...newCustomer, billingTerms: e.target.value})} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>ยกเลิก</Button>
                <Button onClick={handleCreate}>บันทึกและจัดการรายละเอียด</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-4">
              <CardTitle>รายชื่อลูกค้า</CardTitle>
              <div className="flex gap-2">
                <div className="relative w-72">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input type="search" placeholder="ค้นหาลูกค้า..." className="pl-8" />
                </div>
                <Button variant="outline" size="icon"><Filter className="h-4 w-4" /></Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-10 text-center text-muted-foreground italic">กำลังโหลดข้อมูลลูกค้า...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>รหัส</TableHead>
                    <TableHead>ชื่อบริษัท</TableHead>
                    <TableHead>Tax ID</TableHead>
                    <TableHead>สถานะ</TableHead>
                    <TableHead className="text-right">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers?.map((customer) => (
                    <TableRow 
                      key={customer.id} 
                      className="cursor-pointer hover:bg-muted/50 group"
                      onClick={() => router.push(`/customers/${customer.id}`)}
                    >
                      <TableCell className="font-mono text-xs">{customer.customerCode || customer.id.substring(0,6)}</TableCell>
                      <TableCell className="font-semibold">{customer.name}</TableCell>
                      <TableCell>{customer.taxId}</TableCell>
                      <TableCell>
                        <Badge variant={customer.isActive ? 'default' : 'secondary'}>
                          {customer.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="icon" className="text-destructive" onClick={(e) => handleDelete(customer.id, e)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          <ChevronRight className="h-5 w-5 text-muted-foreground" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!customers || customers.length === 0) && !isLoading && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-10 text-muted-foreground italic">ไม่พบข้อมูลลูกค้าในระบบ</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
