'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Plus, 
  Search, 
  Store, 
  Trash2, 
  ChevronRight, 
  Info, 
  Phone,
  Tag,
  Building2
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Vendor, User } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';

export default function VendorsPage() {
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const canAccessVendors = canView(currentUser, 'vendors');

  const vendorsQuery = useMemoFirebase(() => {
    if (!firestore || isUserLoading || userLoading || !firebaseUser || !canAccessVendors) return null;
    return collection(firestore, 'vendors');
  }, [firestore, isUserLoading, userLoading, firebaseUser, canAccessVendors]);

  const { data: vendors, isLoading } = useCollection<Vendor>(vendorsQuery as any);

  const filteredVendors = useMemo(() => {
    if (!vendors) return [];
    return vendors.filter(v => {
      const keyword = searchTerm.toLowerCase();
      const vendorName = (v.vendorName || '').toLowerCase();
      const vendorCode = (v.vendorCode || '').toLowerCase();
      const matchesSearch = vendorName.includes(keyword) || vendorCode.includes(keyword);
      const matchesType = typeFilter === 'ALL' || v.vendorType === typeFilter;
      const matchesStatus = statusFilter === 'ALL' || v.status === statusFilter;
      return matchesSearch && matchesType && matchesStatus;
    });
  }, [vendors, searchTerm, typeFilter, statusFilter]);

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!firestore) return;
    if (confirm('ยืนยันการลบข้อมูลคู่ค้า? ข้อมูลย่อยทั้งหมดจะถูกลบด้วย')) {
      deleteDocumentNonBlocking(doc(firestore, 'vendors', id));
      toast({ title: "ลบข้อมูลสำเร็จ" });
    }
  };

  if (isUserLoading || userLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground text-sm">
        กำลังโหลดข้อมูลผู้ใช้งาน…
      </div>
    );
  }

  if (!currentUser) return null;

  return (
    <AppShell user={currentUser as User} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <Store className="h-8 w-8" /> คู่ค้า / ผู้ขาย (Vendors Suppliers)
          </h1>
          <p className="text-muted-foreground text-lg">
            ใช้จัดเก็บข้อมูลคู่ค้าและผู้ขายสินค้า/บริการ สำหรับการจัดซื้ออุปกรณ์ PPE เครื่องมือ และบริการหน้างาน
          </p>
        </div>

        <Alert className="bg-primary/5 border-primary/20 shadow-sm">
          <Info className="h-5 w-5 text-primary" />
          <AlertTitle className="font-bold text-lg">นโยบายข้อมูลคู่ค้า (Vendor Data Policy)</AlertTitle>
          <AlertDescription className="text-sm">
            ข้อมูลคู่ค้าที่บันทึกในระบบจะถูกนำไปใช้ในโมดูล คลังอุปกรณ์ (Store) และการบันทึกค่าใช้จ่าย (AP Bills) กรุณาตรวจสอบเลขประจำตัวผู้เสียภาษีให้ถูกต้อง
          </AlertDescription>
        </Alert>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="ค้นหาชื่อบริษัทหรือรหัสคู่ค้า..." 
                className="pl-9 h-11" 
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
            <Select onValueChange={setTypeFilter} value={typeFilter}>
              <SelectTrigger className="w-[200px] h-11">
                <SelectValue placeholder="ประเภทคู่ค้า" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">ทุกประเภท</SelectItem>
                <SelectItem value="PPE_SUPPLIER">PPE Supplier</SelectItem>
                <SelectItem value="TOOL_SUPPLIER">Tool Supplier</SelectItem>
                <SelectItem value="SERVICE_PROVIDER">Service Provider</SelectItem>
                <SelectItem value="GENERAL_SUPPLIER">General Supplier</SelectItem>
              </SelectContent>
            </Select>
            <Select onValueChange={setStatusFilter} value={statusFilter}>
              <SelectTrigger className="w-[150px] h-11">
                <SelectValue placeholder="สถานะ" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">ทุกสถานะ</SelectItem>
                <SelectItem value="ACTIVE">ACTIVE</SelectItem>
                <SelectItem value="INACTIVE">INACTIVE</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <Button className="gap-2 h-11 px-6 bg-primary shadow-md text-base font-bold" onClick={() => router.push('/vendors/new')}>
            <Plus className="h-5 w-5" /> เพิ่มคู่ค้าใหม่ (Add Vendor)
          </Button>
        </div>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลคู่ค้า...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4 pl-6">รหัส (Code)</TableHead>
                    <TableHead className="font-bold">ชื่อบริษัท (Vendor Name)</TableHead>
                    <TableHead className="font-bold">ประเภท</TableHead>
                    <TableHead className="font-bold">ผู้ติดต่อ & เบอร์โทร</TableHead>
                    <TableHead className="font-bold">Credit Terms</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                    <TableHead className="text-right font-bold pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredVendors.map((vendor) => (
                    <TableRow 
                      key={vendor.id} 
                      className="cursor-pointer hover:bg-muted/50 group transition-all"
                      onClick={() => router.push(`/vendors/${vendor.id}`)}
                    >
                      <TableCell className="py-4 pl-6 font-mono text-xs font-bold text-primary">{vendor.vendorCode || vendor.id.substring(0,6)}</TableCell>
                      <TableCell className="font-bold text-base text-primary">{vendor.vendorName}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] gap-1">
                          <Tag className="h-3 w-3" /> {vendor.vendorType.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col text-xs">
                          <span className="font-medium">{vendor.contactName || '-'}</span>
                          <span className="text-muted-foreground flex items-center gap-1"><Phone className="h-3 w-3" /> {vendor.phone || '-'}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs font-medium">{vendor.paymentTerms} ({vendor.creditDays} วัน)</TableCell>
                      <TableCell>
                        <Badge variant={vendor.status === 'ACTIVE' ? 'default' : 'secondary'} className={vendor.status === 'ACTIVE' ? 'bg-green-600' : ''}>
                          {vendor.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={(e) => handleDelete(vendor.id, e)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          <ChevronRight className="h-5 w-5 text-muted-foreground" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredVendors.length === 0 && !isLoading && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-20 text-muted-foreground italic">ไม่พบข้อมูลคู่ค้าในระบบ</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

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
                  <p className="font-bold">จัดการคลังสินค้า (Inventory Management)</p>
                  <p className="text-muted-foreground text-xs">หลังจากเพิ่มคู่ค้า คุณสามารถระบุ Vendor นี้ในการรับอุปกรณ์ PPE หรือเครื่องมือเข้าคลังในระบบ Store</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 bg-white rounded-md border shadow-sm">
                <div className="bg-primary/10 p-2 rounded text-primary font-bold">2</div>
                <div>
                  <p className="font-bold">ระบบบัญชีเจ้าหนี้ (Accounts Payable)</p>
                  <p className="text-muted-foreground text-xs">ข้อมูลเงื่อนไขการชำระเงิน (Payment Terms) จะถูกนำไปใช้คำนวณวันครบกำหนดในใบวางบิลเจ้าหนี้ในอนาคต</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
