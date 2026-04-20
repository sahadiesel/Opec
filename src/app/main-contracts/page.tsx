'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, ClipboardList, ChevronRight, Building2, Info, ArrowRight, Filter, ShieldAlert, Loader2, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { MainContract, User, Customer } from '@/lib/types';
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
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, orderBy, addDoc, where, getDocs, writeBatch, doc, limit } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';
import { useAppUser } from '@/hooks/use-app-user';
import { canView, canCreate, isClient } from '@/lib/permissions';
import { isSystemAdmin } from '@/lib/permission-core';
import { formatDateRangeThaiBE } from '@/lib/date-thai';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { userMatchesBusinessRoleKey } from '@/lib/role-key-normalizer';

export default function MainContractsPage() {
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const isStaff = useMemo(() => canView(currentUser, 'main_contracts'), [currentUser]);
  const canCreateContracts = useMemo(() => canCreate(currentUser, 'main_contracts'), [currentUser]);
  const isClientUser = useMemo(() => isClient(currentUser), [currentUser]);
  const isAdmin = useMemo(() => isSystemAdmin(currentUser), [currentUser]);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MainContract | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [newContract, setNewContract] = useState<Partial<MainContract>>({
    title: '',
    contractNumber: getPreviewPattern('main_contract'),
    serviceAgreementNo: '',
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

  // Guard: If client tries to access the master list, redirect to portal
  useEffect(() => {
    if (!isUserLoading && !userLoading && isClientUser && !isStaff) {
      router.push('/client-portal');
    }
  }, [isClientUser, isStaff, isUserLoading, userLoading, router]);

  // Firestore Queries - Only initiate if staff to prevent permission errors on collection list
  const contractsQuery = useMemoFirebase(() => {
    if (!firestore || isUserLoading || !firebaseUser || !currentUser || !isStaff) return null;
    return query(collection(firestore, 'main_contracts'), orderBy('createdAt', 'desc'));
  }, [firestore, isUserLoading, firebaseUser, currentUser, isStaff]);

  const { data: contracts, isLoading } = useCollection<MainContract>(contractsQuery as any);
  const contractNumberById = useMemo(() => {
    const map = new Map<string, string>();
    (contracts || []).forEach((c) => map.set(c.id, c.contractNumber));
    return map;
  }, [contracts]);

  const customersQuery = useMemoFirebase(() => {
    if (!firestore || !isStaff) return null;
    return collection(firestore, 'customers');
  }, [firestore, isStaff]);
  const { data: customers } = useCollection<Customer>(customersQuery as any);

  const handleCreate = async () => {
    if (!canCreateContracts) {
      toast({ variant: "destructive", title: "ไม่มีสิทธิ์", description: "คุณไม่มีสิทธิ์สร้างสัญญาหลัก" });
      return;
    }
    if (!firestore || !currentUser) return;
    
    if (!newContract.title || !newContract.customerId) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาระบุชื่อสัญญาและลูกค้า" });
      return;
    }

    setIsCreating(true);
    try {
      // 1. Generate unique code atomically
      const { code: finalNo } = await generateNextDocumentCode(firestore, 'main_contract', { 
        actor: currentUser.displayName 
      });

      const isSalesCreator =
        currentUser.department === 'sales' ||
        userMatchesBusinessRoleKey(
          currentUser.assignedRoleKey,
          'sales_manager',
          'sales_officer'
        );

      // 2. Create the document using explicit awaited addDoc to catch errors
      const colRef = collection(firestore, 'main_contracts');
      const docRef = await addDoc(colRef, {
        ...newContract,
        status: 'pending',
        contractNumber: finalNo, // Use official sequential number
        commercialTermsOwner: isSalesCreator ? 'sales' : 'operations',
        // No position sell lines yet → no HR "missing cost" alert until sell rates exist
        costingStatus: 'COMPLETE',
        costingMissingPositionsCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      
      setIsCreateOpen(false);
      toast({
        title: "สร้างสัญญาหลักสำเร็จ",
        description: `เลขที่สัญญา: ${finalNo}`,
      });
      
      if (docRef) {
        router.push(`/main-contracts/${docRef.id}`);
      }
    } catch (error: any) {
      console.error('Create Main Contract Error:', error);
      toast({
        variant: "destructive",
        title: "เกิดข้อผิดพลาดในการบันทึกสัญญา",
        description: error.message || "ไม่สามารถบันทึกข้อมูลสัญญาหลักได้ กรุณาตรวจสอบสิทธิ์การใช้งาน",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteContract = async () => {
    if (!firestore || !deleteTarget || !isAdmin) return;
    setIsDeleting(true);
    try {
      const cid = deleteTarget.id;
      const poSnap = await getDocs(
        query(collection(firestore, 'purchase_orders'), where('contractId', '==', cid), limit(5)),
      );
      if (!poSnap.empty) {
        toast({
          variant: 'destructive',
          title: 'ลบไม่ได้',
          description: 'มี Customer PO อ้างอิงสัญญานี้อยู่ — ยกเลิกหรือย้าย PO ก่อน',
        });
        return;
      }
      const childSnap = await getDocs(
        query(collection(firestore, 'main_contracts'), where('parentContractId', '==', cid), limit(5)),
      );
      if (!childSnap.empty) {
        toast({
          variant: 'destructive',
          title: 'ลบไม่ได้',
          description: 'มีสัญญาฉบับแก้/เพิ่มเติมอ้างอิงสัญญานี้ — ลบรายการลูกก่อน',
        });
        return;
      }
      const ratesSnap = await getDocs(collection(firestore, 'main_contracts', cid, 'position_rates'));
      const refs = [...ratesSnap.docs.map((d) => d.ref), doc(firestore, 'main_contracts', cid)];
      const chunk = 400;
      for (let i = 0; i < refs.length; i += chunk) {
        const batch = writeBatch(firestore);
        refs.slice(i, i + chunk).forEach((r) => batch.delete(r));
        await batch.commit();
      }
      toast({ title: 'ลบสัญญาหลักแล้ว', description: deleteTarget.contractNumber });
      setDeleteTarget(null);
    } catch (error: unknown) {
      console.error(error);
      toast({
        variant: 'destructive',
        title: 'ลบไม่สำเร็จ',
        description: error instanceof Error ? error.message : 'กรุณาลองใหม่',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  if (isUserLoading || userLoading) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <ShieldAlert className="h-12 w-12 text-muted-foreground" />
        <div>
          <h2 className="text-lg font-bold">ยังไม่ได้เข้าสู่ระบบ</h2>
          <p className="text-sm text-muted-foreground">กรุณาเข้าสู่ระบบแล้วเปิดหน้านี้อีกครั้ง</p>
        </div>
        <Button asChild>
          <Link href="/">ไปหน้าแรก</Link>
        </Button>
      </div>
    );
  }

  // If not staff, don't render the content (redirect handled by useEffect)
  if (!isStaff && !isClientUser) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-4">
          <ShieldAlert className="h-12 w-12 text-destructive opacity-50" />
          <h2 className="text-xl font-bold">Access Pending (รอนุมัติสิทธิ์)</h2>
          <p className="text-muted-foreground max-w-md">บัญชีของคุณยังไม่ได้รับสิทธิ์เข้าถึงข้อมูลเชิงพาณิชย์ กรุณาติดต่อผู้ดูแลระบบเพื่อกำหนดบทบาท (Roles)</p>
        </div>
      </AppShell>
    );
  }

  if (isClientUser && !isStaff) return null; // Wait for redirect

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
          
          <Dialog open={isCreateOpen} onOpenChange={(open) => {
            if (!open) setIsCreating(false);
            setIsCreateOpen(open);
          }}>
            <DialogTrigger asChild>
              <Button className="gap-2 h-11 px-6 shadow-md bg-primary hover:bg-primary/90 text-base font-bold" disabled={!canCreateContracts}>
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
                  <Label>เลขที่สัญญา (Contract No.)</Label>
                  <Input 
                    value={newContract.contractNumber} 
                    disabled 
                    className="bg-muted font-mono font-bold text-primary" 
                  />
                  <p className="text-[10px] text-muted-foreground italic">* ระบบจะรันเลขที่จริงให้อัตโนมัติเมื่อกดบันทึก</p>
                </div>
                <div className="grid gap-2">
                  <Label>เลขที่สัญญาของลูกค้า (Service Agreement No.)</Label>
                  <Input
                    value={newContract.serviceAgreementNo ?? ''}
                    onChange={(e) => setNewContract({ ...newContract, serviceAgreementNo: e.target.value })}
                    placeholder="เช่น เลขที่เอกสารฝั่งลูกค้า / MSO / SA No."
                    className="h-11"
                  />
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
                  <DatePickerThaiBE
                    value={newContract.startDate}
                    onChange={(ts) => setNewContract({ ...newContract, startDate: ts })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>วันที่สิ้นสุดสัญญา</Label>
                  <DatePickerThaiBE
                    value={newContract.endDate}
                    onChange={(ts) => setNewContract({ ...newContract, endDate: ts })}
                  />
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
                  <Input value="Pending (ระบบกำหนดอัตโนมัติ)" disabled className="h-11 bg-muted/50" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)} disabled={isCreating}>ยกเลิก</Button>
                <Button onClick={handleCreate} className="bg-primary font-bold" disabled={isCreating || !newContract.title || !newContract.customerId}>
                  {isCreating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  สร้างสัญญาและจัดการอัตราราคา (Confirm)
                </Button>
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
                    <TableHead className="font-bold py-4 pl-6">รหัสสัญญา (Contract Code)</TableHead>
                    <TableHead className="font-bold">ชื่อสัญญา (Contract Title)</TableHead>
                    <TableHead className="font-bold">ประเภท</TableHead>
                    <TableHead className="font-bold">ความสัมพันธ์เอกสาร</TableHead>
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
                        <TableCell className="py-4 pl-6 font-mono font-bold text-primary">{contract.contractNumber}</TableCell>
                        <TableCell className="font-bold text-base text-primary">{contract.title}</TableCell>
                        <TableCell>
                          {(contract.contractType || 'master') === 'supplemental' ? (
                            <Badge variant="outline" className="text-[10px]">Supplemental</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px]">Master</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {contract.parentContractId ? (
                            <Badge variant="outline" className="text-[10px] border-violet-200 text-violet-700">
                              Revision of {contractNumberById.get(contract.parentContractId) || contract.parentContractId}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">ต้นฉบับ</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground font-medium">
                            <Building2 className="h-3.5 w-3.5" />
                            {customer?.name || 'N/A'}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs font-medium text-muted-foreground">
                          {formatDateRangeThaiBE(contract.startDate, contract.endDate)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={contract.status === 'active' ? 'default' : 'secondary'} className={contract.status === 'active' ? 'bg-green-600' : ''}>
                            {contract.status.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right pr-4">
                          <div className="flex items-center justify-end gap-0.5">
                            {isAdmin ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                title="ลบสัญญา (Admin)"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteTarget(contract);
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            ) : null}
                            <span
                              className="inline-flex h-8 w-8 items-center justify-center text-muted-foreground"
                              aria-hidden
                            >
                              <ChevronRight className="h-5 w-5 shrink-0" />
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!isLoading && (!contracts || contracts.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-20 text-muted-foreground italic">ไม่พบข้อมูลสัญญาหลักในระบบ</TableCell>
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
                  <p className="text-muted-foreground text-xs">เมื่ออัตราราคาพร้อมแล้ว คุณสามารถสร้าง Customer PO เพื่อจองโควต้าพนักงานภายใต้ราคาสัญญานี้ได้</p>
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

        <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && !isDeleting && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ลบสัญญาหลัก (Admin)</AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <span>
                  ยืนยันการลบ <strong className="font-mono text-foreground">{deleteTarget?.contractNumber}</strong> —{' '}
                  {deleteTarget?.title}
                </span>
                <span className="block text-destructive text-sm font-medium">
                  การลบไม่สามารถย้อนกลับได้ (รวมอัตราตามตำแหน่งในสัญญานี้)
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting}>ยกเลิก</AlertDialogCancel>
              <Button
                type="button"
                variant="destructive"
                disabled={isDeleting}
                onClick={() => void handleDeleteContract()}
              >
                {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ลบถาวร'}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppShell>
  );
}
