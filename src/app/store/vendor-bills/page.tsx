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
import { Plus, ChevronRight, FileText, Loader2, PackageSearch } from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, orderBy, where, getDocs } from 'firebase/firestore';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';
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

function statusBadge(status: PurchaseVendorBillStatus) {
  switch (status) {
    case 'DRAFT':
      return <Badge variant="outline">ฉบับร่าง</Badge>;
    case 'SUBMITTED':
      return <Badge className="bg-amber-600">รอจ่ายเงิน</Badge>;
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

  const billsQuery = useMemoFirebase(() => {
    if (!firestore || !ok) return null;
    return query(collection(firestore, 'purchase_vendor_bills'), orderBy('createdAt', 'desc'));
  }, [firestore, ok]);

  const { data: bills, isLoading: billsLoading } = useCollection<PurchaseVendorBill>(billsQuery as any);

  const purchasesQuery = useMemoFirebase(() => {
    if (!firestore || !ok) return null;
    return query(collection(firestore, 'purchases'), where('status', '==', 'APPROVED'));
  }, [firestore, ok]);

  const { data: approvedPurchases } = useCollection<Purchase>(purchasesQuery as any);

  const vendorsQuery = useMemoFirebase(() => (firestore && ok ? collection(firestore, 'vendors') : null), [
    firestore,
    ok,
  ]);
  const { data: vendors } = useCollection<Vendor>(vendorsQuery as any);

  const billPurchaseIds = useMemo(() => new Set((bills || []).map((b) => b.purchaseId)), [bills]);

  const selectablePurchases = useMemo(() => {
    return (approvedPurchases || []).filter((p) => !billPurchaseIds.has(p.id));
  }, [approvedPurchases, billPurchaseIds]);

  const handleCreate = async () => {
    if (!firestore || !currentUser || !selectedPurchaseId) {
      toast({ variant: 'destructive', title: 'เลือกใบสั่งซื้อ', description: 'ต้องเป็นใบที่อนุมัติแล้วและยังไม่มีใบรับวางบิล' });
      return;
    }
    const p = approvedPurchases?.find((x) => x.id === selectedPurchaseId);
    if (!p) return;
    setCreating(true);
    try {
      const milestoneSnap = await getDocs(collection(firestore, 'purchases', selectedPurchaseId, 'payment_milestones'));
      if (!milestoneSnap.empty) {
        toast({
          variant: 'destructive',
          title: 'ใบสั่งซื้อนี้มีแผนงวดชำระ',
          description: 'สร้างใบรับวางบิลทีละงวดจากหน้ารายละเอียดใบสั่งซื้อ (การซื้อ)',
        });
        return;
      }
      const { code } = await generateNextDocumentCode(firestore, 'purchase_vendor_bill', {
        actor: currentUser.displayName,
      });
      const now = Date.now();
      const ref = await addDocumentNonBlocking(collection(firestore, 'purchase_vendor_bills'), {
        receiptNo: code,
        purchaseId: p.id,
        purchaseNo: p.purchaseNo,
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
              บันทึกฉบับร่างได้ — เมื่อกดส่งบัญชี (มียืนยัน) ถือว่าตรวจรับสินค้า/งานตามงวดแล้ว และไปคิว «ตรวจสอบรายจ่าย» / เจ้าหนี้
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
                  <DialogDescription>
                    แบบเต็มใบ: แต่ละใบสั่งซื้อสร้างได้หนึ่งใบ (เมื่อ PO ยังไม่มีแผนงวดชำระ) — ถ้า PO มีงวดแล้ว ให้สร้างใบทีละงวดจากหน้ารายละเอียดใบสั่งซื้อ
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

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">รายการใบรับวางบิล</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {billsLoading ? (
              <div className="py-16 text-center text-muted-foreground">กำลังโหลด…</div>
            ) : (
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
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(bills || []).map((b) => {
                    const v = vendors?.find((x) => x.id === b.vendorId);
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
                        <TableCell className="text-right pr-6">
                          <Button variant="ghost" size="icon">
                            <ChevronRight className="h-5 w-5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {(!bills || bills.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-16 text-muted-foreground">
                        ยังไม่มีใบรับวางบิล
                      </TableCell>
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
