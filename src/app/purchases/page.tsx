'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Plus, 
  Search, 
  Filter, 
  ChevronRight, 
  PackageSearch, 
  Building2, 
  Calendar,
  AlertTriangle,
  Info,
  Loader2,
  Wallet
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Purchase, PurchaseType, User, Vendor } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, orderBy } from 'firebase/firestore';
import { addDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription,
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function PurchasesPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const isAuthorized = useMemo(() => {
    const authRoles = ['system_admin', 'finance_officer', 'store_officer', 'operations_officer'];
    return currentUser?.roleIds?.some(r => authRoles.includes(r)) || false;
  }, [currentUser]);

  const purchasesQuery = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return query(collection(firestore, 'purchases'), orderBy('purchaseDate', 'desc'));
  }, [firestore, isAuthorized]);

  const { data: purchases, isLoading } = useCollection<Purchase>(purchasesQuery as any);

  const vendorsQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'vendors') : null), [firestore, isAuthorized]);
  const { data: vendors } = useCollection<Vendor>(vendorsQuery as any);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newPurchase, setNewPurchase] = useState<Partial<Purchase>>({
    purchaseNo: `PUR-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`,
    purchaseDate: new Date().toISOString().split('T')[0],
    purchaseType: 'CREDIT',
    storeReceiptStatus: 'PENDING',
    paymentStatus: 'UNPAID',
    status: 'DRAFT',
    notes: ''
  });

  const handleCreate = async () => {
    if (!firestore || !currentUser) return;
    if (!newPurchase.vendorId || !newPurchase.purchaseNo) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาระบุเลขที่การซื้อและคู่ค้า" });
      return;
    }

    try {
      const docRef = await addDocumentNonBlocking(collection(firestore, 'purchases'), {
        ...newPurchase,
        amountBeforeTax: 0,
        vatAmount: 0,
        totalAmount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      setIsDialogOpen(false);
      toast({ title: "สร้างรายการซื้อสำเร็จ", description: "กำลังนำคุณไปที่หน้าจัดการรายการสินค้า..." });
      if (docRef) router.push(`/purchases/${docRef.id}`);
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถสร้างรายการซื้อได้" });
    }
  };

  if (isUserLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <PackageSearch className="h-8 w-8" /> การซื้อสินค้า/บริการ (Purchases)
          </h1>
          <p className="text-muted-foreground text-lg">
            บันทึกการจัดซื้ออุปกรณ์ PPE เครื่องมือ และบริการต่าง ๆ เพื่อควบคุมสต็อกและต้นทุนบริษัท
          </p>
        </div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="ค้นหาเลขที่การซื้อ หรือ ชื่อคู่ค้า..." className="pl-9 h-11" />
            </div>
            <Button variant="outline" className="h-11 gap-2"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
          </div>
          
          <Dialog open={isAuthorized && isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 h-11 px-6 bg-primary shadow-md text-base font-bold">
                <Plus className="h-5 w-5" /> สร้างรายการซื้อใหม่ (New Purchase)
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>สร้างรายการซื้อใหม่ (Record Purchase)</DialogTitle>
                <DialogDescription>ระบุข้อมูลเบื้องต้นและคู่ค้าเพื่อเริ่มต้นบันทึกการซื้อ</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                <div className="space-y-2 md:col-span-2">
                  <Label>เลขที่การซื้อ (Purchase No.)</Label>
                  <Input value={newPurchase.purchaseNo} onChange={e => setNewPurchase({...newPurchase, purchaseNo: e.target.value})} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>คู่ค้า / ผู้ขาย (Vendor)</Label>
                  <Select onValueChange={v => setNewPurchase({...newPurchase, vendorId: v})}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="เลือกบริษัทคู่ค้า..." /></SelectTrigger>
                    <SelectContent>
                      {vendors?.map(v => (
                        <SelectItem key={v.id} value={v.id}>{v.vendorName} ({v.vendorCode})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>วันที่ซื้อ (Purchase Date)</Label>
                  <Input type="date" value={newPurchase.purchaseDate} onChange={e => setNewPurchase({...newPurchase, purchaseDate: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>ประเภทการซื้อ</Label>
                  <Select onValueChange={(v: PurchaseType) => setNewPurchase({...newPurchase, purchaseType: v})} defaultValue="CREDIT">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CASH">เงินสด (CASH)</SelectItem>
                      <SelectItem value="CREDIT">เงินเชื่อ (CREDIT)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>ยกเลิก</Button>
                <Button onClick={handleCreate} className="bg-primary font-bold">เริ่มบันทึกรายการ (Confirm)</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูล...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4 pl-6">เลขที่ (Purchase No.)</TableHead>
                    <TableHead className="font-bold">คู่ค้า (Vendor)</TableHead>
                    <TableHead className="font-bold">วันที่ซื้อ</TableHead>
                    <TableHead className="font-bold">ประเภท</TableHead>
                    <TableHead className="font-bold text-right">ยอดรวมสุทธิ</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchases?.map((p) => {
                    const vendor = vendors?.find(v => v.id === p.vendorId);
                    return (
                      <TableRow 
                        key={p.id} 
                        className="cursor-pointer hover:bg-muted/30 group transition-all" 
                        onClick={() => router.push(`/purchases/${p.id}`)}
                      >
                        <TableCell className="py-4 pl-6 font-bold text-primary font-mono">{p.purchaseNo}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-sm font-bold text-primary">
                            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                            {vendor?.vendorName || 'N/A'}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {p.purchaseDate}
                          </div>
                        </TableCell>
                        <TableCell><Badge variant="outline">{p.purchaseType}</Badge></TableCell>
                        <TableCell className="text-right font-black text-primary">
                          ฿ {p.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell>
                          <Badge variant={p.status === 'COMPLETED' ? 'default' : 'outline'} className={p.status === 'COMPLETED' ? 'bg-green-600' : ''}>
                            {p.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <Button variant="ghost" size="icon" className="group-hover:text-primary"><ChevronRight className="h-5 w-5" /></Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {(!purchases || purchases.length === 0) && !isLoading && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-20 text-muted-foreground italic">ไม่มีรายการซื้อในระบบ</TableCell>
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