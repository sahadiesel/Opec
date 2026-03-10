'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, ShoppingCart, ChevronRight, Building2, FileText, Calendar } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { PurchaseOrder, User, Customer, MainContract } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { addDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newPO, setNewPO] = useState<Partial<PurchaseOrder>>({
    title: '',
    poNumber: '',
    customerId: '',
    contractId: '',
    startDate: Date.now(),
    endDate: Date.now() + 2592000000, // +30 days
    status: 'pending'
  });

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const poQuery = useMemoFirebase(() => {
    if (!firestore || !firebaseUser || !currentUser) return null;
    return collection(firestore, 'purchase_orders');
  }, [firestore, firebaseUser, currentUser]);

  const { data: pos, isLoading: isPOLoading } = useCollection<PurchaseOrder>(poQuery as any);

  const customersQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'customers') : null), [firestore]);
  const { data: customers } = useCollection<Customer>(customersQuery as any);

  const contractsQuery = useMemoFirebase(() => {
    if (!firestore || !newPO.customerId) return null;
    return query(collection(firestore, 'main_contracts'), where('customerId', '==', newPO.customerId));
  }, [firestore, newPO.customerId]);
  const { data: contracts } = useCollection<MainContract>(contractsQuery as any);

  const handleCreate = async () => {
    if (!firestore) return;
    const colRef = collection(firestore, 'purchase_orders');
    
    try {
      const docRef = await addDocumentNonBlocking(colRef, {
        ...newPO,
        createdAt: Date.now()
      });
      
      setIsCreateOpen(false);
      toast({ title: "สร้างใบสั่งซื้อสำเร็จ", description: "กำลังนำคุณไปที่หน้าจัดการรายละเอียด PO Lines..." });
      
      if (docRef) {
        router.push(`/purchase-orders/${docRef.id}`);
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถสร้างใบสั่งซื้อได้" });
    }
  };

  if (isUserLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary flex items-center gap-2">
              <ShoppingCart className="h-6 w-6" /> ใบสั่งซื้อ (Purchase Orders)
            </h1>
            <p className="text-muted-foreground">จัดการใบสั่งซื้อและการจองโควต้ากำลังคน (Quota Booking)</p>
          </div>
          
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" /> สร้างใบสั่งซื้อใหม่
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>สร้างใบสั่งซื้อใหม่</DialogTitle>
                <DialogDescription>เลือกคู่ค้าและสัญญาหลักที่อ้างอิงเพื่อจองโควต้ากำลังคน</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4 py-4">
                <div className="grid gap-2 col-span-2">
                  <Label>ชื่อใบสั่งซื้อ (PO Title)</Label>
                  <Input value={newPO.title} onChange={e => setNewPO({...newPO, title: e.target.value})} placeholder="เช่น สั่งจองกำลังคนรอบเดือน พ.ค. 2567" />
                </div>
                <div className="grid gap-2">
                  <Label>เลขที่ PO (PO Number)</Label>
                  <Input value={newPO.poNumber} onChange={e => setNewPO({...newPO, poNumber: e.target.value})} placeholder="PO-2024-001" />
                </div>
                <div className="grid gap-2">
                  <Label>ลูกค้า (Customer)</Label>
                  <Select onValueChange={v => setNewPO({...newPO, customerId: v, contractId: ''})} value={newPO.customerId}>
                    <SelectTrigger><SelectValue placeholder="เลือกบริษัท..." /></SelectTrigger>
                    <SelectContent>
                      {customers?.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2 col-span-2">
                  <Label>สัญญาหลักที่อ้างอิง (Main Contract)</Label>
                  <Select onValueChange={v => setNewPO({...newPO, contractId: v})} value={newPO.contractId} disabled={!newPO.customerId}>
                    <SelectTrigger><SelectValue placeholder="เลือกสัญญาหลัก..." /></SelectTrigger>
                    <SelectContent>
                      {contracts?.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.contractNumber} - {c.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>วันที่เริ่มงาน</Label>
                  <Input type="date" onChange={e => setNewPO({...newPO, startDate: new Date(e.target.value).getTime()})} />
                </div>
                <div className="grid gap-2">
                  <Label>วันที่สิ้นสุดงาน</Label>
                  <Input type="date" onChange={e => setNewPO({...newPO, endDate: new Date(e.target.value).getTime()})} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>ยกเลิก</Button>
                <Button onClick={handleCreate} disabled={!newPO.title || !newPO.customerId || !newPO.contractId}>บันทึกและจัดการ PO Lines</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle>รายการใบสั่งซื้อทั้งหมด</CardTitle>
              <div className="relative w-72">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input type="search" placeholder="ค้นหาเลขที่ PO..." className="pl-8" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isPOLoading ? (
              <div className="py-10 text-center text-muted-foreground italic">กำลังโหลดข้อมูล...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>เลขที่ PO</TableHead>
                    <TableHead>หัวข้อใบสั่งซื้อ</TableHead>
                    <TableHead>ลูกค้า</TableHead>
                    <TableHead>ระยะเวลา</TableHead>
                    <TableHead>สถานะ</TableHead>
                    <TableHead className="text-right">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pos?.map((po) => {
                    const customer = customers?.find(c => c.id === po.customerId);
                    return (
                      <TableRow 
                        key={po.id} 
                        className="cursor-pointer hover:bg-muted/50 group"
                        onClick={() => router.push(`/purchase-orders/${po.id}`)}
                      >
                        <TableCell className="font-mono text-xs">{po.poNumber}</TableCell>
                        <TableCell className="font-semibold">{po.title}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-xs">
                            <Building2 className="h-3 w-3 text-muted-foreground" />
                            {customer?.name || 'N/A'}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {new Date(po.startDate).toLocaleDateString('th-TH')} - {new Date(po.endDate).toLocaleDateString('th-TH')}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={po.status === 'active' ? 'default' : 'secondary'}>
                            {po.status.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <ChevronRight className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity ml-auto" />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!isPOLoading && (!pos || pos.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-10 text-muted-foreground italic">ไม่พบข้อมูลใบสั่งซื้อ</TableCell>
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
