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
  Filter, 
  ChevronRight, 
  PackageSearch, 
  Building2, 
  Calendar,
  AlertTriangle,
  Info,
  Loader2,
  Wallet,
  Trash2,
} from 'lucide-react';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { Input } from '@/components/ui/input';
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue } from '@/lib/date-thai';
import { Purchase, PurchaseType, User, Vendor, PurchaseStatus, PurchaseLineEntryMode } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canView, canApprovePurchaseAsManager, isSystemAdmin } from '@/lib/permissions';
import { collection, query, orderBy, where, getDocs, deleteDoc, doc, type Firestore } from 'firebase/firestore';
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
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/** Deletes linked top-level docs and subcollections, then the purchase document. */
async function deletePurchaseCascade(firestore: Firestore, purchaseId: string) {
  const vbSnap = await getDocs(
    query(collection(firestore, 'purchase_vendor_bills'), where('purchaseId', '==', purchaseId))
  );
  for (const d of vbSnap.docs) {
    await deleteDoc(d.ref);
  }

  const linesSnap = await getDocs(collection(firestore, 'purchases', purchaseId, 'lines'));
  for (const d of linesSnap.docs) {
    await deleteDoc(d.ref);
  }

  const milestonesSnap = await getDocs(collection(firestore, 'purchases', purchaseId, 'payment_milestones'));
  for (const d of milestonesSnap.docs) {
    await deleteDoc(d.ref);
  }

  const apSnap = await getDocs(
    query(collection(firestore, 'ap_bills'), where('purchaseId', '==', purchaseId))
  );
  for (const d of apSnap.docs) {
    await deleteDoc(d.ref);
  }

  await deleteDoc(doc(firestore, 'purchases', purchaseId));
}

export default function PurchasesPage() {
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const isAuthorized = useMemo(
    () => !!currentUser && canView(currentUser, 'purchases'),
    [currentUser]
  );

  const purchasesQuery = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return query(collection(firestore, 'purchases'), orderBy('purchaseDate', 'desc'));
  }, [firestore, isAuthorized]);

  const { data: purchases, isLoading } = useCollection<Purchase>(purchasesQuery as any);

  const vendorsQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'vendors') : null), [firestore, isAuthorized]);
  const { data: vendors } = useCollection<Vendor>(vendorsQuery as any);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newLineMode, setNewLineMode] = useState<PurchaseLineEntryMode>('INVENTORY');
  const [newPurchase, setNewPurchase] = useState<Partial<Purchase>>({
    purchaseNo: getPreviewPattern('purchase'),
    purchaseDate: timestampToHtmlDateValue(Date.now()),
    purchaseType: 'CREDIT',
    storeReceiptStatus: 'PENDING',
    paymentStatus: 'UNPAID',
    status: 'DRAFT',
    notes: ''
  });

  const canApprove = useMemo(() => canApprovePurchaseAsManager(currentUser), [currentUser]);
  const showAdminDelete = useMemo(() => isSystemAdmin(currentUser), [currentUser]);
  const [deleteTarget, setDeleteTarget] = useState<Purchase | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const pendingApprovalCount = useMemo(
    () => (purchases || []).filter((p) => p.status === 'PENDING_APPROVAL').length,
    [purchases]
  );

  const handleCreate = async () => {
    if (!firestore || !currentUser) return;
    if (!newPurchase.vendorId) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาระบุคู่ค้า" });
      return;
    }

    setIsCreating(true);
    try {
      // Atomic Number Generation
      const { code: finalNo } = await generateNextDocumentCode(firestore, 'purchase', { actor: currentUser.displayName });

      const docRef = await addDocumentNonBlocking(collection(firestore, 'purchases'), {
        ...newPurchase,
        purchaseNo: finalNo,
        purchaseLineMode: newLineMode,
        amountBeforeTax: 0,
        vatAmount: 0,
        totalAmount: 0,
        createdByUid: currentUser.id,
        createdByName: currentUser.displayName || currentUser.email || '',
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      setIsDialogOpen(false);
      toast({ title: "สร้างรายการซื้อสำเร็จ", description: `เลขที่: ${finalNo}` });
      if (docRef) router.push(`/purchases/${docRef.id}`);
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถสร้างรายการซื้อได้" });
    } finally {
      setIsCreating(false);
    }
  };

  const handleConfirmDeletePurchase = async () => {
    if (!firestore || !deleteTarget) return;
    setIsDeleting(true);
    try {
      await deletePurchaseCascade(firestore, deleteTarget.id);
      toast({
        title: 'ลบรายการซื้อแล้ว',
        description: `เลขที่ ${deleteTarget.purchaseNo}`,
      });
      setDeleteTarget(null);
    } catch (e) {
      console.error(e);
      toast({
        variant: 'destructive',
        title: 'ไม่สามารถลบได้',
        description: 'ลองใหม่อีกครั้งหรือตรวจสอบสิทธิ์การเข้าถึง',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const getStatusBadge = (status: PurchaseStatus) => {
    switch (status) {
      case 'DRAFT':
        return <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200">ฉบับร่าง</Badge>;
      case 'PENDING_APPROVAL':
        return <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200">รออนุมัติ</Badge>;
      case 'RETURNED_FOR_REVISION':
        return <Badge variant="outline" className="bg-orange-50 text-orange-800 border-orange-200">ส่งกลับแก้ไข</Badge>;
      case 'APPROVED':
        return <Badge variant="outline" className="bg-green-50 text-green-800 border-green-200">อนุมัติแล้ว</Badge>;
      case 'REJECTED':
        return <Badge variant="destructive">ไม่อนุมัติ</Badge>;
      case 'ISSUED':
        return <Badge variant="outline" className="bg-blue-50 text-blue-600 border-blue-200">ISSUED</Badge>;
      case 'COMPLETED':
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">COMPLETED</Badge>;
      case 'CANCELLED':
        return <Badge variant="secondary">CANCELLED</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isUserLoading || userLoading || !currentUser) return null;

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

        {canApprove && pendingApprovalCount > 0 && (
          <Alert className="border-amber-300 bg-amber-50">
            <AlertTriangle className="h-4 w-4 text-amber-700" />
            <AlertTitle className="text-amber-900">มีใบสั่งซื้อรออนุมัติ</AlertTitle>
            <AlertDescription className="text-amber-800">
              จำนวน {pendingApprovalCount} รายการ — เปิดรายการแล้วใช้เมนูอนุมัติที่หน้ารายละเอียด
            </AlertDescription>
          </Alert>
        )}

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
                <DialogDescription>ระบุข้อมูลเบื้องต้นและคู่ค้า ระบบจะรันเลขที่อัตโนมัติเมื่อยืนยัน</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                <div className="space-y-2 md:col-span-2">
                  <Label>เลขที่การซื้อ (Purchase No.)</Label>
                  <Input value={newPurchase.purchaseNo} disabled className="bg-muted/50 font-mono font-bold" />
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
                  <DatePickerThaiBE
                    className="h-11"
                    value={htmlDateValueToTimestampMs(newPurchase.purchaseDate)}
                    onChange={(ms) => setNewPurchase({ ...newPurchase, purchaseDate: timestampToHtmlDateValue(ms) })}
                  />
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
                <div className="space-y-2 md:col-span-2">
                  <Label>แบบการบันทึกรายการ</Label>
                  <Select
                    value={newLineMode}
                    onValueChange={(v) => setNewLineMode(v as typeof newLineMode)}
                  >
                    <SelectTrigger className="h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="INVENTORY">
                        แบบที่ 1 — ซื้อสินค้า (เลือกจากทะเบียนคลัง — ถ้ายังไม่มีให้ไปเพิ่มที่คลังก่อน)
                      </SelectItem>
                      <SelectItem value="SERVICE">
                        แบบที่ 2 — สั่งจ้าง / คีย์รายการมือ
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isCreating}>ยกเลิก</Button>
                <Button onClick={handleCreate} className="bg-primary font-bold" disabled={isCreating}>
                  {isCreating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  เริ่มบันทึกรายการ (Confirm)
                </Button>
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
                        <TableCell>{getStatusBadge(p.status)}</TableCell>
                        <TableCell
                          className="text-right pr-6"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="inline-flex items-center justify-end gap-0.5">
                            {showAdminDelete && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                title="ลบรายการซื้อ (ผู้ดูแลระบบ)"
                                onClick={() => setDeleteTarget(p)}
                              >
                                <Trash2 className="h-5 w-5" />
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="group-hover:text-primary"
                              onClick={() => router.push(`/purchases/${p.id}`)}
                            >
                              <ChevronRight className="h-5 w-5" />
                            </Button>
                          </div>
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

        <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && !isDeleting && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ลบรายการซื้อนี้?</AlertDialogTitle>
              <AlertDialogDescription>
                {deleteTarget && (
                  <>
                    จะลบถาวรเลขที่ <span className="font-mono font-semibold">{deleteTarget.purchaseNo}</span> พร้อมรายการบรรทัด งวดชำระ
                    และเอกสารที่เกี่ยวข้อง (ถ้ามี) การกระทำนี้ไม่สามารถย้อนกลับได้
                  </>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting} type="button">
                ยกเลิก
              </AlertDialogCancel>
              <Button
                type="button"
                variant="destructive"
                disabled={isDeleting}
                onClick={() => void handleConfirmDeletePurchase()}
              >
                {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ลบ'}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppShell>
  );
}
