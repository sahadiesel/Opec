'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Plus, ChevronRight, FileText, Loader2, PackageSearch, Search, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import { useAppUser } from '@/hooks/use-app-user';
import { canView, isSystemAdmin } from '@/lib/permissions';
import { isSimpleAdmin } from '@/lib/simple-tier-model';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Purchase,
  PurchaseVendorBill,
  PurchaseVendorBillStatus,
  User,
  Vendor,
} from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { addDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';
import Link from 'next/link';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

async function unlinkVendorBillFromPurchaseMilestones(firestore: Firestore, bill: PurchaseVendorBill) {
  const milestonesSnap = await getDocs(
    query(
      collection(firestore, 'purchases', bill.purchaseId, 'payment_milestones'),
      where('vendorBillId', '==', bill.id)
    )
  );
  const now = Date.now();
  for (const d of milestonesSnap.docs) {
    await updateDoc(d.ref, { vendorBillId: deleteField(), updatedAt: now });
  }
}

async function deleteVendorBillDraft(firestore: Firestore, bill: PurchaseVendorBill) {
  await unlinkVendorBillFromPurchaseMilestones(firestore, bill);
  await deleteDoc(doc(firestore, 'purchase_vendor_bills', bill.id));
}

function statusBadge(status: PurchaseVendorBillStatus) {
  switch (status) {
    case 'DRAFT':
      return <Badge variant="outline">ฉบับร่าง</Badge>;
    case 'SUBMITTED':
      return <Badge className="bg-amber-600">รอจ่ายเงิน</Badge>;
    case 'PARTIALLY_PAID':
      return <Badge className="bg-orange-600">จ่ายบางส่วน</Badge>;
    case 'PAID':
      return <Badge className="bg-green-600">จ่ายแล้ว</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export default function StoreVendorBillsPage() {
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selectedPurchaseId, setSelectedPurchaseId] = useState('');

  const ok = useMemo(
    () => !!currentUser && canView(currentUser, 'store_inventory'),
    [currentUser]
  );
  const showAdminDelete = useMemo(
    () => !!currentUser && (isSystemAdmin(currentUser) || isSimpleAdmin(currentUser)),
    [currentUser]
  );
  const showBillDeleteColumn = showAdminDelete || ok;
  const [deleteTarget, setDeleteTarget] = useState<PurchaseVendorBill | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [tab, setTab] = useState<'all' | 'DRAFT' | 'SUBMITTED' | 'PAID'>('DRAFT');
  const [billSearch, setBillSearch] = useState('');
  const [billMonth, setBillMonth] = useState<string>('all');
  const [billVendorId, setBillVendorId] = useState<string>('all');

  const billsQuery = useMemoFirebase(() => {
    if (!firestore || !ok) return null;
    return query(collection(firestore, 'purchase_vendor_bills'), orderBy('createdAt', 'desc'));
  }, [firestore, ok]);

  const { data: bills, isLoading: billsLoading } = useCollection<PurchaseVendorBill>(billsQuery as any);

  const purchasesQuery = useMemoFirebase(() => {
    if (!firestore || !ok) return null;
    return query(
      collection(firestore, 'purchases'),
      where('status', 'in', ['APPROVED', 'ISSUED', 'COMPLETED'])
    );
  }, [firestore, ok]);

  const { data: approvedPurchases } = useCollection<Purchase>(purchasesQuery as any);

  const vendorsQuery = useMemoFirebase(() => (firestore && ok ? collection(firestore, 'vendors') : null), [
    firestore,
    ok,
  ]);
  const { data: vendors } = useCollection<Vendor>(vendorsQuery as any);

  const billPurchaseIds = useMemo(() => new Set((bills || []).map((b) => b.purchaseId)), [bills]);

  const billMonthOptions = useMemo(() => {
    const set = new Set<string>();
    (bills || []).forEach((b) => {
      const d = new Date(b.createdAt);
      if (!Number.isFinite(d.getTime())) return;
      set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    });
    return [...set].sort().reverse();
  }, [bills]);

  const billsFiltered = useMemo(() => {
    if (!bills) return [];
    const qq = billSearch.trim().toLowerCase();
    let list =
      tab === 'all'
        ? bills
        : tab === 'SUBMITTED'
          ? bills.filter((b) => b.status === 'SUBMITTED' || b.status === 'PARTIALLY_PAID')
          : bills.filter((b) => b.status === tab);
    list = list.filter((b) => {
      if (billVendorId !== 'all' && b.vendorId !== billVendorId) return false;
      if (billMonth !== 'all') {
        const d = new Date(b.createdAt);
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (ym !== billMonth) return false;
      }
      if (!qq) return true;
      const v = vendors?.find((x) => x.id === b.vendorId);
      return (
        (b.receiptNo || '').toLowerCase().includes(qq) ||
        (b.purchaseNo || '').toLowerCase().includes(qq) ||
        (v?.vendorName || '').toLowerCase().includes(qq)
      );
    });
    return list;
  }, [bills, tab, billSearch, billMonth, billVendorId, vendors]);

  /** สรุปยอดในใบของรายการที่แสดง — ใช้เมื่อกรองคู่ค้า/เดือนเพื่อดูหลาย PO พร้อมกัน */
  const billsFilteredBillAmountSum = useMemo(() => {
    return billsFiltered.reduce((sum, b) => sum + (Number(b.billAmount) || 0), 0);
  }, [billsFiltered]);

  const selectablePurchases = useMemo(() => {
    return (approvedPurchases || []).filter((p) => {
      if (billPurchaseIds.has(p.id)) return false;
      return !!p.purchaseRequestId;
    });
  }, [approvedPurchases, billPurchaseIds]);

  const handleCreate = async () => {
    if (!firestore || !currentUser || !selectedPurchaseId) {
      toast({ variant: 'destructive', title: 'เลือกใบสั่งซื้อ', description: 'ต้องเป็นใบที่อนุมัติแล้วและยังไม่มีใบรับวางบิล' });
      return;
    }
    const p = approvedPurchases?.find((x) => x.id === selectedPurchaseId);
    if (!p) return;
    if (!p.purchaseRequestId) {
      toast({
        variant: 'destructive',
        title: 'PO นี้ไม่อ้าง PR',
        description: 'รับวางบิลได้เฉพาะใบสั่งซื้อที่อ้างอิง PR ที่อนุมัติแล้ว',
      });
      return;
    }
    setCreating(true);
    try {
      let purchaseRequestNo: string | undefined;
      if (p.purchaseRequestId) {
        const prSnap = await getDoc(doc(firestore, 'purchase_requests', p.purchaseRequestId));
        if (prSnap.exists()) {
          const rn = (prSnap.data() as { requestNo?: string }).requestNo?.trim();
          if (rn) purchaseRequestNo = rn;
        }
      }
      const { code } = await generateNextDocumentCode(firestore, 'purchase_vendor_bill', {
        actor: currentUser.displayName,
      });
      const now = Date.now();
      const ref = await addDocumentNonBlocking(collection(firestore, 'purchase_vendor_bills'), {
        receiptNo: code,
        purchaseId: p.id,
        purchaseNo: p.purchaseNo,
        ...(purchaseRequestNo ? { purchaseRequestNo } : {}),
        purchaseType: p.purchaseType,
        vendorId: p.vendorId,
        billAmount: p.totalAmount,
        billingReceivedDate: p.purchaseDate,
        plannedPaymentDate: p.purchaseDate,
        status: 'DRAFT' as PurchaseVendorBillStatus,
        notes: '',
        createdAt: now,
        updatedAt: now,
      });
      setOpen(false);
      setSelectedPurchaseId('');
      toast({ title: 'สร้างฉบับร่างแล้ว', description: code });
      if (ref?.id) router.push(`/store/vendor-bills/${ref.id}`);
    } catch (e: unknown) {
      console.error(e);
      toast({ variant: 'destructive', title: 'สร้างไม่สำเร็จ' });
    } finally {
      setCreating(false);
    }
  };

  const handleConfirmDeleteBill = async () => {
    if (!firestore || !deleteTarget) return;
    if (deleteTarget.status !== 'DRAFT') {
      toast({
        variant: 'destructive',
        title: 'ลบไม่ได้',
        description: 'ลบได้เฉพาะใบรับวางบิลฉบับร่าง',
      });
      setDeleteTarget(null);
      return;
    }
    setIsDeleting(true);
    try {
      await deleteVendorBillDraft(firestore, deleteTarget);
      toast({
        title: 'ลบใบรับวางบิลแล้ว',
        description: deleteTarget.receiptNo,
      });
      setDeleteTarget(null);
    } catch (e) {
      console.error(e);
      toast({
        variant: 'destructive',
        title: 'ลบไม่สำเร็จ',
        description: 'ตรวจสิทธิ์หรือสถานะเอกสาร',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  if (isUserLoading || userLoading || !currentUser) return null;

  if (!ok) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-3xl mx-auto py-16 text-center text-muted-foreground">
          คุณไม่มีสิทธิ์เข้าเมนูรับวางบิล
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-primary flex items-center gap-2">
              <FileText className="h-8 w-8" /> รับวางบิล (Vendor billing)
            </h1>
            <p className="text-muted-foreground mt-1">
              บันทึกฉบับร่างได้ — เมื่อกดส่งบัญชี (มียืนยัน) ถึงจะไปคิว «รอจ่ายเงิน» / ฝ่ายบัญชี — ร่างคนละคิวกับรอจ่าย
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/purchases">
                <PackageSearch className="h-4 w-4 mr-2" />
                ใบสั่งซื้อ
              </Link>
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button className="font-bold gap-2">
                  <Plus className="h-4 w-4" /> สร้างใบรับวางบิล
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>เลือกใบสั่งซื้อ (อนุมัติแล้ว)</DialogTitle>
                  <DialogDescription className="space-y-2">
                    <span className="block">
                      แบบเต็มใบ: แต่ละใบสั่งซื้อสร้างได้หนึ่งใบ (เมื่อ PO ยังไม่มีแผนงวดชำระ) — ถ้า PO มีงวดแล้ว
                      ให้สร้างใบทีละงวดจากหน้ารายละเอียดใบสั่งซื้อ
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      การจ่ายเงินยังเป็นทีละใบวางบิลตาม PO/งวด — ถ้าคู่ค้าเดียวกันหลาย PO ให้สร้างหลายใบ แล้วกรองคู่ค้าในรายการเพื่อดูยอดรวม
                      · ใบหัก ณ ที่จ่ายออกตาม PO ที่มีการหัก (เมื่อบันทึกจ่าย)
                    </span>
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2 py-2">
                  <Label>ใบสั่งซื้อ</Label>
                  <Select value={selectedPurchaseId} onValueChange={setSelectedPurchaseId}>
                    <SelectTrigger>
                      <SelectValue placeholder="เลือก PUR-..." />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {selectablePurchases.length === 0 ? (
                        <div className="p-3 text-sm text-muted-foreground">ไม่มีใบที่พร้อมสร้าง</div>
                      ) : (
                        selectablePurchases.map((p) => {
                          const v = vendors?.find((x) => x.id === p.vendorId);
                          return (
                            <SelectItem key={p.id} value={p.id}>
                              {p.purchaseNo} — {v?.vendorName || p.vendorId}
                            </SelectItem>
                          );
                        })
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    เลขที่อ้างอิง: {getPreviewPattern('purchase_vendor_bill')}
                  </p>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)} disabled={creating}>
                    ยกเลิก
                  </Button>
                  <Button onClick={handleCreate} disabled={creating || !selectedPurchaseId}>
                    {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    สร้างฉบับร่าง
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="space-y-3">
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList>
              <TabsTrigger value="all">ทั้งหมด</TabsTrigger>
              <TabsTrigger value="DRAFT">ฉบับร่าง</TabsTrigger>
              <TabsTrigger value="SUBMITTED">รอจ่าย (ส่งบัญชีแล้ว)</TabsTrigger>
              <TabsTrigger value="PAID">จ่ายแล้ว</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex flex-col sm:flex-row flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9 h-10"
                placeholder="ค้นหาเลขที่ใบรับวางบิล / PO / คู่ค้า…"
                value={billSearch}
                onChange={(e) => setBillSearch(e.target.value)}
              />
            </div>
            <Select value={billMonth} onValueChange={setBillMonth}>
              <SelectTrigger className="h-10 w-full sm:w-[200px]">
                <SelectValue placeholder="เดือน (สร้าง)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">ทุกเดือน</SelectItem>
                {billMonthOptions.map((ym) => (
                  <SelectItem key={ym} value={ym}>
                    {ym}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={billVendorId} onValueChange={setBillVendorId}>
              <SelectTrigger className="h-10 w-full sm:w-[220px]">
                <SelectValue placeholder="คู่ค้า" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="all">คู่ค้าทั้งหมด</SelectItem>
                {vendors?.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.vendorName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">รายการใบรับวางบิล</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {billsLoading ? (
              <div className="py-16 text-center text-muted-foreground">กำลังโหลด…</div>
            ) : (
              <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">เลขที่ใบรับวางบิล</TableHead>
                    <TableHead>ใบสั่งซื้อ</TableHead>
                    <TableHead>คู่ค้า</TableHead>
                    <TableHead>ยอดในใบ</TableHead>
                    <TableHead>วันรับวางบิล</TableHead>
                    <TableHead>วันจ่าย (แผน)</TableHead>
                    <TableHead>สถานะ</TableHead>
                    {showBillDeleteColumn && (
                      <TableHead className="w-14 px-2 text-center text-muted-foreground">ลบ</TableHead>
                    )}
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {billsFiltered.map((b) => {
                    const v = vendors?.find((x) => x.id === b.vendorId);
                    const billTrashVisible = showBillDeleteColumn && b.status === 'DRAFT';
                    return (
                      <TableRow
                        key={b.id}
                        className="cursor-pointer hover:bg-muted/40"
                        onClick={() => router.push(`/store/vendor-bills/${b.id}`)}
                      >
                        <TableCell className="pl-6 font-mono font-bold text-primary">{b.receiptNo}</TableCell>
                        <TableCell className="font-mono text-sm font-bold text-primary">
                          {b.purchaseNo || b.purchaseId}
                        </TableCell>
                        <TableCell>{v?.vendorName || '—'}</TableCell>
                        <TableCell className="text-right text-sm">
                          {b.billAmount != null && b.billAmount > 0 ? (
                            <span className="font-mono font-medium">
                              ฿{b.billAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </span>
                          ) : (
                            <span className="text-muted-foreground italic">ตาม PO</span>
                          )}
                        </TableCell>
                        <TableCell>{b.billingReceivedDate}</TableCell>
                        <TableCell>{b.plannedPaymentDate}</TableCell>
                        <TableCell>{statusBadge(b.status)}</TableCell>
                        {showBillDeleteColumn && (
                          <TableCell
                            className="w-14 px-2 text-center"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {billTrashVisible ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                title={showAdminDelete ? 'ลบใบรับวางบิลฉบับร่าง (ผู้ดูแลระบบ)' : 'ลบใบรับวางบิลฉบับร่าง'}
                                onClick={() => setDeleteTarget(b)}
                              >
                                <Trash2 className="h-5 w-5" />
                              </Button>
                            ) : null}
                          </TableCell>
                        )}
                        <TableCell className="text-right pr-6" onClick={(e) => e.stopPropagation()}>
                          <Button type="button" variant="ghost" size="icon" asChild>
                            <Link href={`/store/vendor-bills/${b.id}`}>
                              <ChevronRight className="h-5 w-5" />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {billsFiltered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={showBillDeleteColumn ? 9 : 8} className="text-center py-16 text-muted-foreground">
                        ยังไม่มีรายการในชุดนี้
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {billsFiltered.length > 0 && (billVendorId !== 'all' || billMonth !== 'all') ? (
                <div className="border-t px-6 py-3 bg-muted/25 text-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <span className="text-muted-foreground leading-snug">
                    ยอดรวมฟิลด์ «ยอดในใบ» ในรายการที่แสดง ({billsFiltered.length} ใบ)
                    {billVendorId !== 'all'
                      ? ` · คู่ค้า: ${vendors?.find((v) => v.id === billVendorId)?.vendorName ?? ''}`
                      : ''}
                    {billMonth !== 'all' ? ` · เดือนสร้าง ${billMonth}` : ''}
                  </span>
                  <span className="font-mono font-bold text-base tabular-nums">
                    ฿{billsFilteredBillAmountSum.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
              ) : null}
              </>
            )}
          </CardContent>
        </Card>

        <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && !isDeleting && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ลบใบรับวางบิลนี้?</AlertDialogTitle>
              <AlertDialogDescription>
                {deleteTarget && (
                  <>
                    จะลบถาวรเลขที่ <span className="font-mono font-semibold">{deleteTarget.receiptNo}</span>{' '}
                    และถอนการผูกจากงวดชำระ PO (ถ้ามี) — ใช้กับฉบับร่างเท่านั้น
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
                onClick={() => void handleConfirmDeleteBill()}
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
