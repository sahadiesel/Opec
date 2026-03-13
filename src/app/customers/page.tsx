'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, Building2, Trash2, ChevronRight, Filter, Info, ArrowRight } from 'lucide-react';
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

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
      <div className="space-y-6 max-w-[1600px] mx-auto">
        {/* 1. Page Header & Description */}
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <Building2 className="h-8 w-8" /> ลูกค้า (Customers Directory)
          </h1>
          <p className="text-muted-foreground text-lg">
            บริหารจัดการฐานข้อมูลบริษัทคู่ค้า ข้อมูลการติดต่อ และที่อยู่จดทะเบียนเพื่อการดำเนินงานเชิงพาณิชย์
          </p>
        </div>

        {/* 2. Operational Notice Box */}
        <Alert className="bg-primary/5 border-primary/20 shadow-sm">
          <Info className="h-5 w-5 text-primary" />
          <AlertTitle className="font-bold text-lg">นโยบายข้อมูลคู่ค้า (Commercial Data Policy)</AlertTitle>
          <AlertDescription className="text-sm">
            การแก้ไขรหัสลูกค้า (Customer Code) จะมีผลต่อการอ้างอิงในสัญญาหลัก (Main Contracts) และใบสั่งซื้อทั้งหมด กรุณาตรวจสอบความถูกต้องของเลขประจำตัวผู้เสียภาษี (Tax ID) เพื่อความถูกต้องของการวางบิล
          </AlertDescription>
        </Alert>

        {/* 3. Action Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="ค้นหาชื่อบริษัทหรือรหัสคู่ค้า..." className="pl-9 h-11" />
            </div>
            <Button variant="outline" className="h-11 px-4 gap-2"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
          </div>
          
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 h-11 px-6 bg-primary shadow-md text-base font-bold">
                <Plus className="h-5 w-5" /> ลงทะเบียนลูกค้าใหม่ (New Registration)
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>ลงทะเบียนลูกค้าใหม่ (New Customer Registration)</DialogTitle>
                <DialogDescription>กรอกข้อมูลบริษัทเพื่อเริ่มต้นสร้างสัญญาและใบสั่งซื้อในลำดับถัดไป</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4 py-4">
                <div className="grid gap-2 col-span-2">
                  <Label>ชื่อบริษัท (Full Company Name)</Label>
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
                  <Label>อีเมลกลาง (Company Email)</Label>
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
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>ยกเลิก</Button>
                <Button onClick={handleCreate} className="bg-primary font-bold">บันทึกข้อมูลลูกค้า (Save Profile)</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* 4. Data Content */}
        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลลูกค้า (Loading Customers)...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4">รหัส (Code)</TableHead>
                    <TableHead className="font-bold">ชื่อบริษัท (Company Name)</TableHead>
                    <TableHead className="font-bold">Tax ID</TableHead>
                    <TableHead className="font-bold">สถานะ (Status)</TableHead>
                    <TableHead className="text-right font-bold pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers?.map((customer) => (
                    <TableRow 
                      key={customer.id} 
                      className="cursor-pointer hover:bg-muted/50 group transition-all"
                      onClick={() => router.push(`/customers/${customer.id}`)}
                    >
                      <TableCell className="py-4 font-mono text-xs font-bold text-primary">{customer.customerCode || customer.id.substring(0,6)}</TableCell>
                      <TableCell className="font-bold text-base text-primary">{customer.name}</TableCell>
                      <TableCell className="text-muted-foreground font-medium">{customer.taxId}</TableCell>
                      <TableCell>
                        <Badge variant={customer.isActive ? 'default' : 'secondary'} className={customer.isActive ? 'bg-green-600' : ''}>
                          {customer.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={(e) => handleDelete(customer.id, e)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          <ChevronRight className="h-5 w-5 text-muted-foreground" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!customers || customers.length === 0) && !isLoading && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-20 text-muted-foreground italic">ไม่พบข้อมูลลูกค้าในระบบ</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* 5. Next-Step Guidance */}
        <Card className="bg-primary/5 border-primary/10 border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2 text-primary font-bold">
              <Info className="h-5 w-5" /> แนวทางปฏิบัติถัดไป (Workflow Guidance)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="flex items-start gap-3 p-4 bg-white rounded-md border shadow-sm">
                <div className="bg-primary/10 p-2 rounded text-primary font-bold">1</div>
                <div>
                  <p className="font-bold">สร้างสัญญาหลัก (Define Main Contracts)</p>
                  <p className="text-muted-foreground text-xs">หลังจากเพิ่มลูกค้า ให้เริ่มสร้างสัญญาซื้อขาย (Master Agreement) เพื่อระบุราคากลางรายตำแหน่ง</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 bg-white rounded-md border shadow-sm">
                <div className="bg-primary/10 p-2 rounded text-primary font-bold">2</div>
                <div>
                  <p className="font-bold">จัดการใบสั่งซื้อ (Receive Customer POs)</p>
                  <p className="text-muted-foreground text-xs">เปิดใบสั่งซื้อเพื่อจองโควต้าพนักงานและบันทึกราคาสรุปสำหรับแต่ละโครงการ</p>
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter className="pt-0 justify-end">
            <Button variant="link" className="gap-2 text-primary font-bold" asChild>
              <a href="/main-contracts">ไปยังระบบสัญญาหลัก (Main Contracts) <ArrowRight className="h-4 w-4" /></a>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </AppShell>
  );
}
