'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, ClipboardList, ChevronRight, Building2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { MainContract, User, Customer } from '@/lib/types';
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

export default function MainContractsPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newContract, setNewContract] = useState<Partial<MainContract>>({
    title: '',
    contractNumber: '',
    customerId: '',
    projectId: '',
    startDate: Date.now(),
    endDate: Date.now() + 31536000000, // 1 year later
    currency: 'THB',
    billingTerms: 'Monthly',
    paymentTerms: '30 Days',
    status: 'pending',
    notes: ''
  });

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) {
      try {
        setCurrentUser(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to parse user session', e);
      }
    }
  }, []);

  const contractsQuery = useMemoFirebase(() => {
    if (!firestore || isUserLoading || !firebaseUser || !currentUser) return null;
    return collection(firestore, 'main_contracts');
  }, [firestore, isUserLoading, firebaseUser, currentUser]);

  const { data: contracts, isLoading } = useCollection<MainContract>(contractsQuery as any);

  const customersQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return collection(firestore, 'customers');
  }, [firestore]);
  const { data: customers } = useCollection<Customer>(customersQuery as any);

  const handleCreate = async () => {
    if (!firestore) return;
    const colRef = collection(firestore, 'main_contracts');
    
    try {
      const docRef = await addDocumentNonBlocking(colRef, {
        ...newContract,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      
      setIsCreateOpen(false);
      toast({
        title: "สร้างสัญญาหลักสำเร็จ",
        description: "กำลังนำคุณไปที่หน้าจัดการรายละเอียดและอัตราราคา...",
      });
      
      if (docRef) {
        router.push(`/main-contracts/${docRef.id}`);
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "เกิดข้อผิดพลาด",
        description: "ไม่สามารถสร้างสัญญาได้",
      });
    }
  };

  if (isUserLoading || !currentUser || (firebaseUser && firebaseUser.uid !== currentUser.id)) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="text-muted-foreground">กำลังตรวจสอบสิทธิ์การเข้าถึง...</p>
        </div>
      </div>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary flex items-center gap-2">
              <ClipboardList className="h-6 w-6" /> สัญญาหลัก (Main Contracts)
            </h1>
            <p className="text-muted-foreground">จัดการสัญญาซื้อขายหลักและอัตราราคาบริการ (Master Agreements)</p>
          </div>
          
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" /> สร้างสัญญาหลักใหม่
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>สร้างสัญญาหลักใหม่</DialogTitle>
                <DialogDescription>ระบุข้อมูลพื้นฐานของสัญญาเพื่อนำไปกำหนดอัตราราคาตามตำแหน่ง</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4 py-4">
                <div className="grid gap-2 col-span-2">
                  <Label>ชื่อสัญญา (Contract Title)</Label>
                  <Input value={newContract.title} onChange={e => setNewContract({...newContract, title: e.target.value})} placeholder="เช่น สัญญาจ้างกำลังคนโครงการประมูล X" />
                </div>
                <div className="grid gap-2">
                  <Label>รหัสสัญญา (Contract Code)</Label>
                  <Input value={newContract.contractNumber} onChange={e => setNewContract({...newContract, contractNumber: e.target.value})} placeholder="OPEC-MC-2024-001" />
                </div>
                <div className="grid gap-2">
                  <Label>ลูกค้า (Customer)</Label>
                  <Select onValueChange={v => setNewContract({...newContract, customerId: v})} value={newContract.customerId}>
                    <SelectTrigger><SelectValue placeholder="เลือกบริษัทลูกค้า..." /></SelectTrigger>
                    <SelectContent>
                      {customers?.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>วันที่เริ่มสัญญา</Label>
                  <Input type="date" value={newContract.startDate ? new Date(newContract.startDate).toISOString().split('T')[0] : ''} onChange={e => setNewContract({...newContract, startDate: new Date(e.target.value).getTime()})} />
                </div>
                <div className="grid gap-2">
                  <Label>วันที่สิ้นสุดสัญญา</Label>
                  <Input type="date" value={newContract.endDate ? new Date(newContract.endDate).toISOString().split('T')[0] : ''} onChange={e => setNewContract({...newContract, endDate: new Date(e.target.value).getTime()})} />
                </div>
                <div className="grid gap-2">
                  <Label>สกุลเงิน</Label>
                  <Select onValueChange={v => setNewContract({...newContract, currency: v})} value={newContract.currency}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="THB">THB - Thai Baht</SelectItem>
                      <SelectItem value="USD">USD - US Dollar</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>สถานะ</Label>
                  <Select onValueChange={v => setNewContract({...newContract, status: v as any})} value={newContract.status}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Pending (รอดำเนินการ)</SelectItem>
                      <SelectItem value="active">Active (ใช้งาน)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>ยกเลิก</Button>
                <Button onClick={handleCreate} disabled={!newContract.title || !newContract.customerId || !newContract.contractNumber}>บันทึกและจัดการรายละเอียด</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle>รายการสัญญาหลัก</CardTitle>
              <div className="relative w-72">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input type="search" placeholder="ค้นหาเลขที่สัญญา..." className="pl-8" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-10 text-center text-muted-foreground italic">กำลังโหลดข้อมูลสัญญา...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>รหัสสัญญา (Code)</TableHead>
                    <TableHead>ชื่อสัญญา (Title)</TableHead>
                    <TableHead>ลูกค้า</TableHead>
                    <TableHead>ระยะเวลา</TableHead>
                    <TableHead>สถานะ</TableHead>
                    <TableHead className="text-right">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contracts?.map((contract) => {
                    const customer = customers?.find(c => c.id === contract.customerId);
                    return (
                      <TableRow 
                        key={contract.id} 
                        className="cursor-pointer hover:bg-muted/50 group"
                        onClick={() => router.push(`/main-contracts/${contract.id}`)}
                      >
                        <TableCell className="font-mono font-bold text-primary">{contract.contractNumber}</TableCell>
                        <TableCell className="font-semibold">{contract.title}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-xs">
                            <Building2 className="h-3 w-3 text-muted-foreground" />
                            {customer?.name || 'N/A'}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {new Date(contract.startDate).toLocaleDateString('th-TH')} - {new Date(contract.endDate).toLocaleDateString('th-TH')}
                        </TableCell>
                        <TableCell>
                          <Badge variant={contract.status === 'active' ? 'default' : 'secondary'}>
                            {contract.status.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <ChevronRight className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity ml-auto" />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!isLoading && (!contracts || contracts.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-10 text-muted-foreground italic">ไม่พบข้อมูลสัญญาหลัก</TableCell>
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
