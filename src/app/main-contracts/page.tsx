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
            <ClipboardList className="h-8 w-8" /> สัญญาหลัก (Main Contracts Management)
          </h1>
          <p className="text-muted-foreground text-lg">
            บริหารจัดการสัญญาจ้างกำลังคนหลัก (Master Service Agreements) และกำหนดฐานราคากลางแยกตามตำแหน่งงาน
          </p>
        </div>

        {/* 2. Operational Notice Box */}
        <Alert className="bg-primary/5 border-primary/20 shadow-sm">
          <Info className="h-5 w-5 text-primary" />
          <AlertTitle className="font-bold text-lg">การจัดการราคากลาง (Rate Management Policy)</AlertTitle>
          <AlertDescription className="text-sm">
            ราคาขาย (Sell Rate) และต้นทุน (Cost) ที่กำหนดในสัญญาหลักจะถูกใช้เป็นฐานในการสร้าง <b>Customer PO</b> และคำนวณกำไรเบื้องต้น (GP) กรุณาตรวจสอบหน่วยการคิดเงิน (Billing Unit) ให้ถูกต้องตามเล่มสัญญา
          </AlertDescription>
        </Alert>

        {/* 3. Action Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="ค้นหาเลขที่สัญญา หรือ ชื่อสัญญา..." className="pl-9 h-11" />
            </div>
            <Button variant="outline" className="h-11 gap-2"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
          </div>
          
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 h-11 px-6 shadow-md bg-primary hover:bg-primary/90 text-base font-bold">
                <Plus className="h-5 w-5" /> สร้างสัญญาหลักใหม่ (New Main Contract)
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>ลงทะเบียนสัญญาหลักใหม่ (New Contract Registration)</DialogTitle>
                <DialogDescription>ระบุข้อมูลพื้นฐานของสัญญาเพื่อใช้เป็นฐานในการกำหนดราคารายตำแหน่งในลำดับถัดไป</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4 py-4">
                <div className="grid gap-2 col-span-2">
                  <Label>ชื่อสัญญา (Contract Title)</Label>
                  <Input value={newContract.title} onChange={e => setNewContract({...newContract, title: e.target.value})} placeholder="เช่น สัญญาจ้างกำลังคนโครงการบำรุงรักษาแท่น X" />
                </div>
                <div className="grid gap-2">
                  <Label>เลขที่สัญญา/รหัสสัญญา (Contract Code)</Label>
                  <Input value={newContract.contractNumber} onChange={e => setNewContract({...newContract, contractNumber: e.target.value})} placeholder="OPEC-MC-2024-XXX" />
                </div>
                <div className="grid gap-2">
                  <Label>ลูกค้า (Customer)</Label>
                  <Select onValueChange={v => setNewContract({...newContract, customerId: v})} value={newContract.customerId}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="เลือกบริษัทคู่สัญญา..." /></SelectTrigger>
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
                  <Label>สกุลเงิน (Currency)</Label>
                  <Select onValueChange={v => setNewContract({...newContract, currency: v})} value={newContract.currency}>
                    <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="THB">THB - Thai Baht</SelectItem>
                      <SelectItem value="USD">USD - US Dollar</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>สถานะการลงนาม</Label>
                  <Select onValueChange={v => setNewContract({...newContract, status: v as any})} value={newContract.status}>
                    <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Pending (รอดำเนินการ)</SelectItem>
                      <SelectItem value="active">Active (ลงนามแล้ว/ใช้งาน)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>ยกเลิก</Button>
                <Button onClick={handleCreate} className="bg-primary font-bold" disabled={!newContract.title || !newContract.customerId || !newContract.contractNumber}>สร้างสัญญาและจัดการอัตราราคา (Confirm)</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* 4. Data Content */}
        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลสัญญาหลัก (Loading Contracts)...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4">รหัสสัญญา (Contract Code)</TableHead>
                    <TableHead className="font-bold">ชื่อสัญญา (Contract Title)</TableHead>
                    <TableHead className="font-bold">ลูกค้า (Client Name)</TableHead>
                    <TableHead className="font-bold">ระยะเวลา (Contract Period)</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contracts?.map((contract) => {
                    const customer = customers?.find(c => c.id === contract.customerId);
                    return (
                      <TableRow 
                        key={contract.id} 
                        className="cursor-pointer hover:bg-muted/50 group transition-all"
                        onClick={() => router.push(`/main-contracts/${contract.id}`)}
                      >
                        <TableCell className="py-4 font-mono font-bold text-primary">{contract.contractNumber}</TableCell>
                        <TableCell className="font-bold text-base text-primary">{contract.title}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground font-medium">
                            <Building2 className="h-3.5 w-3.5" />
                            {customer?.name || 'N/A'}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs font-medium text-muted-foreground">
                          {new Date(contract.startDate).toLocaleDateString('th-TH')} - {new Date(contract.endDate).toLocaleDateString('th-TH')}
                        </TableCell>
                        <TableCell>
                          <Badge variant={contract.status === 'active' ? 'default' : 'secondary'} className={contract.status === 'active' ? 'bg-green-600' : ''}>
                            {contract.status.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right pr-6">
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
                  <p className="font-bold">ตั้งค่าอัตราราคาตามตำแหน่ง (Set Position Rates)</p>
                  <p className="text-muted-foreground text-xs">คลิกเข้าดูสัญญาเพื่อระบุราคาขายแยกตามตำแหน่งงาน (Welder, Mechanic, etc.) ตามที่ระบุในสัญญา</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 bg-white rounded-md border shadow-sm">
                <div className="bg-primary/10 p-2 rounded text-primary font-bold">2</div>
                <div>
                  <p className="font-bold">ออกใบสั่งซื้ออ้างอิง (Link Customer POs)</p>
                  <p className="text-muted-foreground text-xs">เมื่ออัตราราคาพร้อมแล้ว คุณสามารถสร้าง Customer PO เพื่อจองโควต้าคนงานภายใต้ราคาสัญญานี้ได้</p>
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter className="pt-0 justify-end">
            <Button variant="link" className="gap-2 text-primary font-bold" asChild>
              <a href="/purchase-orders">ไปยังระบบใบสั่งซื้อลูกค้า (Customer POs) <ArrowRight className="h-4 w-4" /></a>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </AppShell>
  );
}
