'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, ClipboardList, ChevronRight, Building2, Info, ArrowRight, Filter } from 'lucide-react';
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

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

  if (isUserLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        {/* 1. Page Header & Description */}
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <ClipboardList className="h-8 w-8" /> สัญญาหลัก (Main Contracts)
          </h1>
          <p className="text-muted-foreground text-lg">
            บริหารจัดการสัญญาซื้อขายหลัก (Master Agreements) อัตราราคาตามตำแหน่ง และเงื่อนไขทางการเงิน
          </p>
        </div>

        {/* 2. Operational Notice */}
        <Alert className="bg-primary/5 border-primary/20">
          <Info className="h-4 w-4 text-primary" />
          <AlertTitle className="font-bold">การกำหนดอัตราราคา (Rate Management)</AlertTitle>
          <AlertDescription>
            กรุณาระบุราคาขาย (Sell Rate) และหน่วยการคิดเงิน (Billing Unit) ให้ถูกต้องตามเล่มสัญญา เพื่อการวางบิลที่แม่นยำ
          </AlertDescription>
        </Alert>

        {/* 3. Action Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="ค้นหาเลขที่สัญญาหรือชื่อสัญญา..." className="pl-9" />
            </div>
            <Button variant="outline" size="icon"><Filter className="h-4 w-4" /></Button>
          </div>
          
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 h-11 px-6 shadow-md bg-primary hover:bg-primary/90">
                <Plus className="h-5 w-5" /> สร้างสัญญาหลักใหม่ (New Main Contract)
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>สร้างสัญญาหลักใหม่ (New Contract)</DialogTitle>
                <DialogDescription>ระบุข้อมูลพื้นฐานของสัญญาเพื่อนำไปกำหนดอัตราราคาตามตำแหน่งในลำดับถัดไป</DialogDescription>
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
                <Button onClick={handleCreate} disabled={!newContract.title || !newContract.customerId || !newContract.contractNumber}>บันทึกข้อมูล (Confirm)</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* 4. Data Content */}
        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลสัญญา (Loading Contracts)...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold">รหัสสัญญา (Code)</TableHead>
                    <TableHead className="font-bold">ชื่อสัญญา (Contract Title)</TableHead>
                    <TableHead className="font-bold">ลูกค้า (Customer)</TableHead>
                    <TableHead className="font-bold">ระยะเวลา (Period)</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
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
                            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                            {customer?.name || 'N/A'}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {new Date(contract.startDate).toLocaleDateString('th-TH')} - {new Date(contract.endDate).toLocaleDateString('th-TH')}
                        </TableCell>
                        <TableCell>
                          <Badge variant={contract.status === 'active' ? 'default' : 'secondary'} className={contract.status === 'active' ? 'bg-green-600' : ''}>
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
                      <TableCell colSpan={6} className="text-center py-20 text-muted-foreground italic">ไม่พบข้อมูลสัญญาหลักในระบบ</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* 5. Next-Step Guidance */}
        <Card className="bg-primary/5 border-primary/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Info className="h-5 w-5 text-primary" /> ขั้นตอนถัดไป (Next Steps)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="flex items-start gap-3 p-3 bg-white rounded-md border shadow-sm">
                <div className="bg-primary/10 p-2 rounded text-primary font-bold">1</div>
                <div>
                  <p className="font-bold">ตั้งค่าอัตราราคา (Position Rates)</p>
                  <p className="text-muted-foreground text-xs">คลิกเข้าดูรายละเอียดเพื่อกำหนดราคาขายของแต่ละตำแหน่งตามสัญญา</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-white rounded-md border shadow-sm">
                <div className="bg-primary/10 p-2 rounded text-primary font-bold">2</div>
                <div>
                  <p className="font-bold">ออกใบสั่งซื้อ (Customer POs)</p>
                  <p className="text-muted-foreground text-xs">เมื่ออัตราราคาพร้อมแล้ว คุณสามารถสร้าง Customer PO เพื่อจองโควต้าคนงานได้</p>
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter className="pt-0 justify-end">
            <Button variant="link" className="gap-2" asChild>
              <a href="/purchase-orders">ไปยังใบสั่งซื้อลูกค้า (Go to Customer POs) <ArrowRight className="h-4 w-4" /></a>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </AppShell>
  );
}